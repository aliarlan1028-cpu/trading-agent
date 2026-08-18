const present = (value) => value !== null && value !== undefined && value !== "";

const sameLifecycle = (row = {}, review = {}) => {
  const reviewFillIds = new Set(Array.isArray(review.fillIds) ? review.fillIds.map(String) : []);
  if (row.id && reviewFillIds.has(String(row.id))) return true;
  if (present(row.executionOrderId) && present(review.executionOrderId)) {
    return String(row.executionOrderId) === String(review.executionOrderId);
  }
  const rowIds = [row.executionOrderId, row.tradePlanId, row.planId, row.positionId, row.tradeLifecycleKey]
    .filter(present).map(String);
  const reviewIds = [review.tradeLifecycleKey, review.executionOrderId, review.tradePlanId, review.planId, review.positionId]
    .filter(present).map(String);
  return rowIds.length > 0 && reviewIds.some((value) => rowIds.includes(value));
};

const completeCostBasis = (review = {}, trade = {}) => {
  return ["entryFeeUsdt", "feeUsdt", "fundingFeeUsdt", "netRealizedPnl"].every((key) => {
    const value = trade?.[key] ?? review?.[key];
    return present(value) && Number.isFinite(Number(value));
  });
};

// Every green step needs persisted evidence. Missing or ambiguous facts stay
// pending; the UI must never infer a verified lifecycle merely from review existence.
export function buildReviewTimelineStatus({ review = {}, trade = {}, plan = {}, order = {}, fills = [], completed = false } = {}) {
  const lifecycleFills = (Array.isArray(fills) ? fills : []).filter((fill) => sameLifecycle(fill, review));
  const hasEntryFill = lifecycleFills.some((fill) => fill?.kind === "entry");
  const hasCloseFill = lifecycleFills.some((fill) => fill?.kind === "close");
  const snapshotRef = plan?.decisionFactSnapshotRef || review?.decisionFactSnapshotRef || null;
  const hasDecisionFacts = Boolean(snapshotRef?.id && snapshotRef?.hash);
  const hasFrozenPlan = hasDecisionFacts && Boolean(plan?.id || review?.tradePlanId || review?.planId);
  const hasRealFills = hasEntryFill && hasCloseFill;
  const hasProtectedExit = hasCloseFill && Boolean(
    order?.protectionVerifiedAt
    || order?.protectionVerified === true
    || review?.protectionVerifiedAt
    || review?.protectionVerified === true
    || trade?.protectionVerifiedAt
    || trade?.protectionVerified === true
  );
  const hasCosts = completeCostBasis(review, trade);
  return [
    { key: "decision", verified: hasDecisionFacts },
    { key: "plan", verified: hasFrozenPlan },
    { key: "fills", verified: hasRealFills },
    { key: "protection", verified: hasProtectedExit },
    { key: "costs", verified: hasCosts },
    { key: "review", verified: completed && hasCosts }
  ];
}
