export function isEventRiskActive(event, now = Date.now()) {
  if (!event || ["已结束", "已关闭", "resolved", "closed"].includes(event.status)) return false;
  const raw = event.due || event.publishedAt || event.lastUpdatedAt || event.createdAt;
  const timestamp = new Date(raw).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const pastWindowMs = Number(process.env.EVENT_RISK_PAST_WINDOW_MS || 6 * 60 * 60_000);
  const futureWindowMs = Number(process.env.EVENT_RISK_FUTURE_WINDOW_MS || 24 * 60 * 60_000);
  const delta = timestamp - now;
  return delta >= -pastWindowMs && delta <= futureWindowMs;
}
