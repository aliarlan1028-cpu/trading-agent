export function isEventRiskActive(event, now = Date.now()) {
  if (!event || ["已结束", "已关闭", "resolved", "closed"].includes(event.status)) return false;
  const raw = event.due || event.publishedAt || event.lastUpdatedAt || event.createdAt;
  const timestamp = new Date(raw).getTime();
  if (!Number.isFinite(timestamp)) return false;
  // env 填了非法值时 Number() 得 NaN，比较恒 false 会静默关闭事件风控——必须回落默认值。
  const envPast = Number(process.env.EVENT_RISK_PAST_WINDOW_MS);
  const envFuture = Number(process.env.EVENT_RISK_FUTURE_WINDOW_MS);
  const pastWindowMs = Number.isFinite(envPast) && envPast >= 0 ? envPast : 6 * 60 * 60_000;
  const futureWindowMs = Number.isFinite(envFuture) && envFuture >= 0 ? envFuture : 24 * 60 * 60_000;
  const delta = timestamp - now;
  return delta >= -pastWindowMs && delta <= futureWindowMs;
}

export function isAuthoritativeRiskEvent(event) {
  if (!event || event.kind === "unverified_manual" || event.autoTradingEligible === false) return false;
  return event.verified === true
    || event.provenance?.verifiedOrigin === true
    || event.autoTradingEligible === true
    || String(event.sourceId || "").startsWith("official_");
}
