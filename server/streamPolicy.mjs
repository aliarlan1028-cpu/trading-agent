// Anonymous SSE is deliberately limited to public market data. Account and
// portfolio payloads must use an authenticated channel.
export function isPublicMarketStreamUpdate(update) {
  if (!update || typeof update !== "object" || update.type === "portfolio" || update.positions || update.portfolio) return false;
  const allowed = ["symbol", "price", "changePct", "high24h", "low24h", "fundingRate", "openInterest"];
  return Boolean(update.symbol) && Object.keys(update).every((key) => allowed.includes(key));
}
