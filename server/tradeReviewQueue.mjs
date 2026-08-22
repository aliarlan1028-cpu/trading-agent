import { id, nowIso } from "./store.mjs";
import {
  findTradeEntryFill,
  isFinanciallyReconciledLifecycle,
  resolveTradeContext,
  sameTradeLifecycle,
  tradeLifecycleKey
} from "./tradeLifecycle.mjs";
import { groupSystemClosedTradeLifecycles, projectSystemTradeFill, systemTradeFills } from "./systemTradeProjection.mjs";

export {
  findTradeEntryFill,
  groupClosedTradeLifecycles,
  isFinanciallyReconciledLifecycle,
  resolveTradeContext,
  sameTradeLifecycle,
  tradeLifecycleKey
} from "./tradeLifecycle.mjs";

function finite(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

// A review may only claim a Studio strategy version when the same immutable
// version/hash/product binding can be reconstructed from persisted trade facts.
// Conflicting refs fail closed instead of silently preferring whichever object
// happened to be read first.
export function resolveAuthoritativeTradeStrategyRef(db = {}, source = {}) {
  const { fill, executionOrder, plan } = resolveTradeContext(db, source);
  const refs = [
    fill?.strategyBlueprintRef,
    executionOrder?.strategyBlueprintRef,
    plan?.strategyBlueprintRef
  ].filter(Boolean);
  if (!refs.length) return { ok: false, error: "strategy_blueprint_ref_missing", ref: null };
  const normalized = refs.map((ref) => ({
    versionId: String(ref.versionId || ""),
    contentHash: String(ref.contentHash || ref.definitionHash || ""),
    productId: String(ref.baseProductId || ref.productId || "")
  }));
  if (normalized.some((ref) => !ref.versionId || !ref.contentHash)) {
    return { ok: false, error: "strategy_blueprint_ref_incomplete", ref: null };
  }
  const first = normalized[0];
  if (normalized.some((ref) => ref.versionId !== first.versionId || ref.contentHash !== first.contentHash
    || (ref.productId && first.productId && ref.productId !== first.productId))) {
    return { ok: false, error: "strategy_blueprint_ref_conflict", ref: null };
  }
  const version = (db.strategyBlueprintVersions || []).find((row) => String(row.id || "") === first.versionId);
  if (!version || String(version.contentHash || "") !== first.contentHash) {
    return { ok: false, error: "strategy_blueprint_version_unverified", ref: null };
  }
  const productId = String(version.definition?.baseProductId || version.productId || first.productId || "");
  if (!productId || (first.productId && first.productId !== productId)) {
    return { ok: false, error: "strategy_blueprint_product_mismatch", ref: null };
  }
  return {
    ok: true,
    ref: {
      schema: "trading.strategy.blueprint.review-ref",
      schemaVersion: 1,
      versionId: version.id,
      contentHash: version.contentHash,
      productId
    }
  };
}

function stampTradeReviewStrategyRef(db, review, source) {
  const resolved = resolveAuthoritativeTradeStrategyRef(db, source);
  if (!resolved.ok) {
    review.strategyBlueprintAttribution = { verified: false, error: resolved.error };
    return false;
  }
  if (review.strategyBlueprintRef
    && (review.strategyBlueprintRef.versionId !== resolved.ref.versionId
      || review.strategyBlueprintRef.contentHash !== resolved.ref.contentHash
      || review.strategyBlueprintRef.productId !== resolved.ref.productId)) {
    review.strategyBlueprintAttribution = { verified: false, error: "review_strategy_blueprint_ref_conflict" };
    delete review.strategyBlueprintRef;
    delete review.strategyVersionId;
    return false;
  }
  review.strategyBlueprintRef = resolved.ref;
  review.strategyVersionId = resolved.ref.versionId;
  review.strategyBlueprintAttribution = { verified: true };
  const { plan } = resolveTradeContext(db, source);
  review.improvementScope = {
    ...(review.improvementScope || {}),
    strategyProductId: resolved.ref.productId,
    strategyVersionId: resolved.ref.versionId,
    strategyDefinitionHash: resolved.ref.contentHash,
    strategyProductVersionId: plan?.strategyRef?.versionId || plan?.strategyVersionId || review.improvementScope?.strategyProductVersionId || null
  };
  return true;
}

export function ensureTradeReviewQueued(db, fill) {
  fill = projectSystemTradeFill(db, fill);
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
      tenantId: fill.tenantId || fill.ownerTenantId || null,
      ownerUserId: fill.ownerUserId || fill.createdByUserId || fill.userId || null,
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
  review.tenantId ||= fill.tenantId || fill.ownerTenantId || null;
  review.ownerUserId ||= fill.ownerUserId || fill.createdByUserId || fill.userId || null;
  stampTradeReviewStrategyRef(db, review, fill);
  review.updatedAt = nowIso();
  if (fill.fundingReconciled === false) {
    review.status = "pending_financial_reconciliation";
    review.financialBasis = fill.financialBasis || "funding_unreconciled";
  }
  return review;
}

export function syncTradeReviewQueue(db, options = {}) {
  let queued = 0;
  const fillFilter = typeof options.fillFilter === "function" ? options.fillFilter : () => true;
  const closes = systemTradeFills(db).filter((fill) => fill?.kind === "close" && finite(fill.realizedPnl) && fillFilter(fill));
  // 先用最终平仓创建生命周期，再把更早的部分平仓 fillId 补进同一条复盘，避免依赖数组顺序。
  const ordered = [...closes.filter((fill) => fill.partial !== true), ...closes.filter((fill) => fill.partial === true)];
  for (const fill of ordered) {
    const before = db.reviews?.length || 0;
    const review = ensureTradeReviewQueued(db, fill);
    if (review && (db.reviews?.length || 0) > before) queued += 1;
  }
  const reconciled = reconcileReflectedTradeReviews(db);
  let financialsBackfilled = 0;
  const lifecycles = groupSystemClosedTradeLifecycles(db);
  for (const lifecycle of lifecycles) {
    const review = (db.reviews || []).find((item) => item.type === "trade" && item.tradeLifecycleKey === lifecycle.key);
    if (review) stampTradeReviewStrategyRef(db, review, lifecycle);
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
  const lifecycles = groupSystemClosedTradeLifecycles(db);
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
