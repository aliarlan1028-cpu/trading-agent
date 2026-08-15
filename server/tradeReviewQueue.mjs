import { id, nowIso } from "./store.mjs";
import { recordedFeeCost } from "./financialValues.mjs";

function finite(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

export function tradeLifecycleKey(fill = {}) {
  return String(fill.executionOrderId || fill.tradePlanId || fill.planId || fill.positionId || fill.id || "");
}

function identityValues(row = {}, fields = []) {
  return fields.map((field) => row?.[field]).filter((value) => value !== null && value !== undefined && value !== "").map(String);
}

// 生命周期关联必须只比较双方都真实存在的键。不能让 undefined === undefined
// 把两个旧计划的 entry/close 串成同一笔交易；高优先级键双方都有但不相等时也不得降级碰撞。
export function sameTradeLifecycle(left = {}, right = {}) {
  for (const fields of [["executionOrderId"], ["tradePlanId", "planId"], ["positionId"]]) {
    const leftValues = identityValues(left, fields);
    const rightValues = identityValues(right, fields);
    if (!leftValues.length || !rightValues.length) continue;
    return leftValues.some((value) => rightValues.includes(value));
  }
  return false;
}

export function findTradeEntryFill(fills = [], reference = {}) {
  return (fills || []).find((fill) => fill?.kind === "entry" && sameTradeLifecycle(fill, reference)) || null;
}

// 生命周期消费者统一通过执行单解析计划。历史成交常只有 executionOrderId，
// 不能把执行单 ID 当计划 ID，也不能让各模块复制不同的 OR 规则。
export function resolveTradeContext(db = {}, source = {}) {
  const fill = source?.representative || source || {};
  const executionOrderId = fill.executionOrderId === null || fill.executionOrderId === undefined || fill.executionOrderId === ""
    ? null : String(fill.executionOrderId);
  const executionOrder = executionOrderId
    ? (db.executionOrders || []).find((row) => String(row?.id || "") === executionOrderId) || null
    : null;
  const rawPlanId = fill.tradePlanId || fill.planId || executionOrder?.planId || null;
  const planId = rawPlanId === null || rawPlanId === undefined || rawPlanId === "" ? null : String(rawPlanId);
  const plan = planId
    ? (db.tradePlans || []).find((row) => String(row?.id || "") === planId) || null
    : null;
  return { fill, executionOrder, plan, executionOrderId, planId };
}

export function groupClosedTradeLifecycles(fills = [], options = {}) {
  const onlyUnreflected = options.onlyUnreflected === true;
  const groups = new Map();
  const entryCostsByKey = new Map();
  for (const fill of fills || []) {
    if (fill?.kind !== "entry") continue;
    const key = tradeLifecycleKey(fill);
    if (!key) continue;
    const current = entryCostsByKey.get(key) || { count: 0, feeUsdt: 0, complete: true };
    current.count += 1;
    const feeCost = recordedFeeCost(fill);
    if (feeCost !== null) current.feeUsdt += feeCost;
    else current.complete = false;
    if (fill.estimatedFee === true) current.complete = false;
    entryCostsByKey.set(key, current);
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
      lastClosedAt: null,
      financialBasisComplete: true,
      financialBasisIssues: []
    };
    current.fills.push(fill);
    current.realizedPnl += Number(fill.realizedPnl);
    const feeCost = recordedFeeCost(fill);
    if (feeCost !== null) current.feeUsdt += feeCost;
    else {
      current.financialBasisComplete = false;
      current.financialBasisIssues.push("close_fee_unreconciled");
    }
    if (fill.estimatedFee === true) {
      current.financialBasisComplete = false;
      current.financialBasisIssues.push("estimated_fee_unreconciled");
    }
    if (finite(fill.fundingFeeUsdt)) current.fundingFeeUsdt += Number(fill.fundingFeeUsdt);
    if (fill.fundingReconciled !== true || !finite(fill.fundingFeeUsdt)) {
      current.financialBasisComplete = false;
      current.financialBasisIssues.push("funding_unreconciled");
    }
    if (finite(fill.notionalUsdt)) current.notionalUsdt += Math.abs(Number(fill.notionalUsdt));
    if (finite(fill.quantity ?? fill.size)) current.quantity += Number(fill.quantity ?? fill.size);
    const at = fill.createdAt || fill.closedAt || null;
    if (at && (!current.firstClosedAt || new Date(at) < new Date(current.firstClosedAt))) current.firstClosedAt = at;
    if (at && (!current.lastClosedAt || new Date(at) > new Date(current.lastClosedAt))) current.lastClosedAt = at;
    groups.set(key, current);
  }
  return [...groups.values()].filter((group) => options.completedOnly === false || group.fills.some((fill) => fill.partial !== true)).map((group) => {
    const representative = group.fills.slice().sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || {};
    const entryCosts = entryCostsByKey.get(group.key) || { count: 0, feeUsdt: 0, complete: false };
    if (!entryCosts.count || !entryCosts.complete) {
      group.financialBasisComplete = false;
      group.financialBasisIssues.push(entryCosts.count ? "entry_fee_unreconciled" : "entry_fill_unavailable");
    }
    group.financialBasisIssues = [...new Set(group.financialBasisIssues)];
    const entryFeeUsdt = entryCosts.feeUsdt;
    const netRealizedPnl = group.financialBasisComplete
      ? group.realizedPnl - group.feeUsdt - entryFeeUsdt + group.fundingFeeUsdt
      : null;
    return {
      ...group,
      // realizedPnl 是交易所价格盈亏；绩效、连亏保护和复盘应按记录成本后的
      // 实得结果判断。费用仍单列保留，避免 UI 看不到成本。
      entryFeeUsdt: Number(entryFeeUsdt.toFixed(8)),
      netRealizedPnl: netRealizedPnl === null ? null : Number(netRealizedPnl.toFixed(8)),
      financialBasis: group.financialBasisComplete ? "recorded_costs" : group.financialBasisIssues.join("+") || "financial_basis_unreconciled",
      representative: {
        ...representative,
        realizedPnl: Number(group.realizedPnl.toFixed(8)),
        netRealizedPnl: netRealizedPnl === null ? null : Number(netRealizedPnl.toFixed(8)),
        financialBasis: group.financialBasisComplete ? "recorded_costs" : group.financialBasisIssues.join("+") || "financial_basis_unreconciled",
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

export function isFinanciallyReconciledLifecycle(lifecycle = {}) {
  return lifecycle.financialBasisComplete !== false
    && lifecycle.netRealizedPnl !== null
    && lifecycle.netRealizedPnl !== undefined
    && lifecycle.netRealizedPnl !== ""
    && Number.isFinite(Number(lifecycle.netRealizedPnl));
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
  if (fill.fundingReconciled === false) {
    review.status = "pending_financial_reconciliation";
    review.financialBasis = fill.financialBasis || "funding_unreconciled";
  }
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
  let financialsBackfilled = 0;
  const lifecycles = groupClosedTradeLifecycles(db.fills || []);
  for (const lifecycle of lifecycles) {
    const review = (db.reviews || []).find((item) => item.type === "trade" && item.tradeLifecycleKey === lifecycle.key);
    if (review && !isFinanciallyReconciledLifecycle(lifecycle)) {
      review.status = "pending_financial_reconciliation";
      review.netRealizedPnl = null;
      review.outcome = null;
      review.financialBasis = lifecycle.financialBasis || "funding_unreconciled";
    } else if (review && stampTradeReviewFinancials(review, lifecycle)) financialsBackfilled += 1;
  }
  return { queued, reconciled, financialsBackfilled };
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
    if (!isFinanciallyReconciledLifecycle(lifecycle)) continue;
    if (!lifecycle.fills.length || !lifecycle.fills.every((fill) => Boolean(fill.reflectedAt))) continue;
    const review = (db.reviews || []).find((item) => item.type === "trade" && item.tradeLifecycleKey === lifecycle.key);
    if (!review || review.status === "completed") continue;
    const fill = lifecycle.representative;
    const memory = reflectionMemoryForLifecycle(db, review, lifecycle);
    const pnl = Number(lifecycle.netRealizedPnl || 0);
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
  if (!isFinanciallyReconciledLifecycle(lifecycle)) return null;
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
  stampTradeReviewFinancials(review, lifecycle || payload);
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

export function stampTradeReviewFinancials(review, lifecycle = {}) {
  if (!review) return false;
  const fields = ["realizedPnl", "feeUsdt", "entryFeeUsdt", "fundingFeeUsdt", "netRealizedPnl"];
  let changed = false;
  for (const field of fields) {
    if (!finite(lifecycle[field])) continue;
    const value = Number(Number(lifecycle[field]).toFixed(8));
    if (!finite(review[field]) || Number(review[field]) !== value) { review[field] = value; changed = true; }
  }
  if (changed) review.updatedAt = nowIso();
  return changed;
}

export function failTradeReview(review, error) {
  if (!review) return null;
  review.status = "failed";
  review.error = String(error?.message || error || "unknown").slice(0, 240);
  review.failedAt = nowIso();
  review.updatedAt = review.failedAt;
  return review;
}
