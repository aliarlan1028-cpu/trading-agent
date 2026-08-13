import { id, nowIso } from "./store.mjs";

function finite(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

export function tradeLifecycleKey(fill = {}) {
  return String(fill.executionOrderId || fill.tradePlanId || fill.planId || fill.positionId || fill.id || "");
}

export function groupClosedTradeLifecycles(fills = [], options = {}) {
  const onlyUnreflected = options.onlyUnreflected === true;
  const groups = new Map();
  const entryFeesByKey = new Map();
  for (const fill of fills || []) {
    if (fill?.kind !== "entry" || !finite(fill.feeUsdt)) continue;
    const key = tradeLifecycleKey(fill);
    if (key) entryFeesByKey.set(key, (entryFeesByKey.get(key) || 0) + Math.abs(Number(fill.feeUsdt)));
  }
  for (const fill of fills || []) {
    if (fill?.kind !== "close" || !finite(fill.realizedPnl)) continue;
    if (onlyUnreflected && fill.reflectedAt) continue;
    const key = tradeLifecycleKey(fill);
    if (!key) continue;
    const current = groups.get(key) || {
      key,
      fills: [],
      realizedPnl: 0,
      feeUsdt: 0,
      fundingFeeUsdt: 0,
      notionalUsdt: 0,
      quantity: 0,
      firstClosedAt: null,
      lastClosedAt: null
    };
    current.fills.push(fill);
    current.realizedPnl += Number(fill.realizedPnl);
    if (finite(fill.feeUsdt)) current.feeUsdt += Math.abs(Number(fill.feeUsdt));
    if (finite(fill.fundingFeeUsdt)) current.fundingFeeUsdt += Number(fill.fundingFeeUsdt);
    if (finite(fill.notionalUsdt)) current.notionalUsdt += Math.abs(Number(fill.notionalUsdt));
    if (finite(fill.quantity ?? fill.size)) current.quantity += Number(fill.quantity ?? fill.size);
    const at = fill.createdAt || fill.closedAt || null;
    if (at && (!current.firstClosedAt || new Date(at) < new Date(current.firstClosedAt))) current.firstClosedAt = at;
    if (at && (!current.lastClosedAt || new Date(at) > new Date(current.lastClosedAt))) current.lastClosedAt = at;
    groups.set(key, current);
  }
  return [...groups.values()].filter((group) => options.completedOnly === false || group.fills.some((fill) => fill.partial !== true)).map((group) => {
    const representative = group.fills.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || {};
    const entryFeeUsdt = entryFeesByKey.get(group.key) || 0;
    const netRealizedPnl = group.realizedPnl - group.feeUsdt - entryFeeUsdt + group.fundingFeeUsdt;
    return {
      ...group,
      // realizedPnl 是交易所价格盈亏；绩效、连亏保护和复盘应按记录成本后的
      // 实得结果判断。费用仍单列保留，避免 UI 看不到成本。
      entryFeeUsdt: Number(entryFeeUsdt.toFixed(8)),
      netRealizedPnl: Number(netRealizedPnl.toFixed(8)),
      representative: {
        ...representative,
        realizedPnl: Number(group.realizedPnl.toFixed(8)),
        netRealizedPnl: Number(netRealizedPnl.toFixed(8)),
        entryFeeUsdt: Number(entryFeeUsdt.toFixed(8)),
        feeUsdt: Number(group.feeUsdt.toFixed(8)),
        fundingFeeUsdt: Number(group.fundingFeeUsdt.toFixed(8)),
        notionalUsdt: Number(group.notionalUsdt.toFixed(8)),
        quantity: Number(group.quantity.toFixed(8)),
        createdAt: group.lastClosedAt || representative.createdAt
      }
    };
  }).sort((a, b) => new Date(b.lastClosedAt || 0) - new Date(a.lastClosedAt || 0));
}

export function ensureTradeReviewQueued(db, fill) {
  if (fill?.kind !== "close" || !finite(fill.realizedPnl)) return null;
  db.reviews ||= [];
  const key = tradeLifecycleKey(fill);
  if (!key) return null;
  let review = db.reviews.find((item) => item.type === "trade" && item.tradeLifecycleKey === key);
  // 只有部分减仓时仓位生命周期尚未结束；先留在成交记录，等最终平仓再创建复盘。
  if (!review && fill.partial === true) return null;
  if (!review) {
    review = {
      id: id("trade_review"),
      type: "trade",
      tradeLifecycleKey: key,
      tradePlanId: fill.tradePlanId || fill.planId || null,
      executionOrderId: fill.executionOrderId || null,
      fillIds: [],
      symbol: fill.symbol || null,
      direction: fill.direction || null,
      title: `${fill.symbol || "交易"} 平仓复盘`,
      summary: "已进入自动复盘队列，等待事实回补与归因。",
      status: "pending",
      queuedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.reviews.unshift(review);
  }
  review.fillIds ||= [];
  if (fill.id && !review.fillIds.includes(fill.id)) review.fillIds.push(fill.id);
  review.symbol ||= fill.symbol || null;
  review.direction ||= fill.direction || null;
  review.updatedAt = nowIso();
  return review;
}

export function syncTradeReviewQueue(db) {
  let queued = 0;
  const closes = (db.fills || []).filter((fill) => fill?.kind === "close" && finite(fill.realizedPnl));
  // 先用最终平仓创建生命周期，再把更早的部分平仓 fillId 补进同一条复盘，避免依赖数组顺序。
  const ordered = [...closes.filter((fill) => fill.partial !== true), ...closes.filter((fill) => fill.partial === true)];
  for (const fill of ordered) {
    const before = db.reviews?.length || 0;
    const review = ensureTradeReviewQueued(db, fill);
    if (review && (db.reviews?.length || 0) > before) queued += 1;
  }
  const reconciled = reconcileReflectedTradeReviews(db);
  return { queued, reconciled };
}

function reflectionMemoryForLifecycle(db, review, lifecycle) {
  const fillIds = new Set((lifecycle?.fills || []).map((fill) => fill.id).filter(Boolean));
  return (db.memoryItems || []).find((item) => (
    (review?.memoryItemId && item.id === review.memoryItemId)
    || (item.fillId && fillIds.has(item.fillId))
    || (item.fillIds || []).some((fillId) => fillIds.has(fillId))
  )) || null;
}

// 升级前已经完成自动复盘的成交带 reflectedAt，但当时还没有页面复盘队列。
// 新队列回填后不能再次调用 LLM，也不能永久停在 pending；以真实成交和既有记忆做幂等对账。
export function reconcileReflectedTradeReviews(db) {
  let reconciled = 0;
  const lifecycles = groupClosedTradeLifecycles(db.fills || []);
  for (const lifecycle of lifecycles) {
    if (!lifecycle.fills.length || !lifecycle.fills.every((fill) => Boolean(fill.reflectedAt))) continue;
    const review = (db.reviews || []).find((item) => item.type === "trade" && item.tradeLifecycleKey === lifecycle.key);
    if (!review || review.status === "completed") continue;
    const fill = lifecycle.representative;
    const memory = reflectionMemoryForLifecycle(db, review, lifecycle);
    const pnl = Number(lifecycle.realizedPnl || 0);
    const direction = fill.direction === "short" || fill.direction === "空" ? "做空" : "做多";
    const fallbackLesson = `该交易生命周期已在旧版本完成自动复盘；已根据 ${lifecycle.fills.length} 条真实平仓成交恢复队列状态，未重复调用 LLM。`;
    completeTradeReview(review, lifecycle, {
      summary: `${fill.symbol || "交易"} ${direction}${pnl >= 0 ? "盈利" : "亏损"} ${pnl.toFixed(2)} USDT，历史自动复盘状态已对账。`,
      lesson: memory?.content || fill.deepReflection || fallbackLesson,
      deepReflection: fill.deepReflection || null,
      memoryItemId: memory?.id || null,
      attribution: fill.lossAttribution || null
    });
    review.reconciledFromLegacyReflection = true;
    review.reconciledAt = review.completedAt;
    reconciled += 1;
  }
  return reconciled;
}

export function markTradeReviewProcessing(db, lifecycle) {
  const fill = lifecycle?.representative || lifecycle;
  const review = ensureTradeReviewQueued(db, fill);
  if (!review) return null;
  review.status = "processing";
  review.processingAt = nowIso();
  review.updatedAt = review.processingAt;
  review.fillIds = [...new Set([...(review.fillIds || []), ...(lifecycle?.fills || []).map((item) => item.id).filter(Boolean)])];
  return review;
}

export function completeTradeReview(review, lifecycle, payload = {}) {
  if (!review) return null;
  review.status = "completed";
  review.realizedPnl = Number(lifecycle?.realizedPnl ?? payload.realizedPnl ?? 0);
  review.feeUsdt = Number(lifecycle?.feeUsdt || 0);
  review.fundingFeeUsdt = Number(lifecycle?.fundingFeeUsdt || 0);
  review.partialCloseCount = lifecycle?.fills?.length || 1;
  review.summary = payload.summary || review.summary;
  review.lesson = payload.lesson || null;
  review.deepReflection = payload.deepReflection || null;
  review.memoryItemId = payload.memoryItemId || null;
  review.attribution = payload.attribution || null;
  review.completedAt = nowIso();
  review.updatedAt = review.completedAt;
  delete review.error;
  return review;
}

export function failTradeReview(review, error) {
  if (!review) return null;
  review.status = "failed";
  review.error = String(error?.message || error || "unknown").slice(0, 240);
  review.failedAt = nowIso();
  review.updatedAt = review.failedAt;
  return review;
}
