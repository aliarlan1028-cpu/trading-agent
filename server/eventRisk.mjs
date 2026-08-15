function finiteNonNegative(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function eventTimestamp(event = {}) {
  return new Date(event.due || event.publishedAt || event.lastUpdatedAt || event.createdAt).getTime();
}

function eventTimeIsExact(event = {}) {
  const precision = String(event.timePrecision || event.time_precision || event.precision || "").toLowerCase();
  return !["date", "day", "unknown"].includes(precision);
}

export function eventRiskPolicy() {
  return {
    pastWindowMs: finiteNonNegative(process.env.EVENT_RISK_PAST_WINDOW_MS, 6 * 60 * 60_000),
    futureWindowMs: finiteNonNegative(process.env.EVENT_RISK_FUTURE_WINDOW_MS, 24 * 60 * 60_000)
  };
}

export function isEventRiskActive(event, now = Date.now()) {
  if (!event || ["已结束", "已关闭", "resolved", "closed"].includes(event.status)) return false;
  const timestamp = eventTimestamp(event);
  if (!Number.isFinite(timestamp)) return false;
  const { pastWindowMs, futureWindowMs } = eventRiskPolicy();
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

// 唯一的“事件风险窗口”投影：风控引擎和 UI 都消费这份结果，避免页面显示空白、
// 但执行链已经阻断（或反过来）的口径分裂。监控窗口可以早于真正的开仓静默期，
// blocking 仅在精确时点、高影响、同标的且进入配置的前置/后置窗口时成立。
export function projectEventRiskWindow(event, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const minimumImpact = finiteNonNegative(options.minimumImpact, 90);
  const blackoutMinutes = finiteNonNegative(options.blackoutMinutes, 30);
  const timestamp = eventTimestamp(event);
  const impact = Number(event?.impact ?? event?.values?.impact);
  if (!isAuthoritativeRiskEvent(event)
    || !isEventRiskActive(event, now)
    || !Number.isFinite(timestamp)
    || !Number.isFinite(impact)
    || impact < minimumImpact) return null;

  const relatedSymbols = Array.isArray(event.relatedSymbols)
    ? event.relatedSymbols.filter(Boolean)
    : Array.isArray(event.symbols) ? event.symbols.filter(Boolean) : [];
  const symbol = String(options.symbol || "").toUpperCase();
  const related = !symbol || !relatedSymbols.length || relatedSymbols.map((item) => String(item).toUpperCase()).includes(symbol);
  if (!related) return null;

  const exactTime = eventTimeIsExact(event);
  const deltaMs = timestamp - now;
  const blackoutMs = blackoutMinutes * 60_000;
  const blocking = exactTime && deltaMs <= blackoutMs;
  const phase = !exactTime
    ? "time_unconfirmed"
    : deltaMs <= 0
      ? "post_release"
      : blocking
        ? "pre_release_blackout"
        : "monitoring";
  const { pastWindowMs } = eventRiskPolicy();
  return {
    id: event.id,
    eventId: event.id,
    title: event.shortTitle || event.title || "高影响事件",
    dueAt: new Date(timestamp).toISOString(),
    timePrecision: exactTime ? "minute" : "date",
    impact,
    impactLabel: event.impactLabel || (impact >= 90 ? "高影响" : "中影响"),
    relatedSymbols,
    marketWide: event.marketWide === true || relatedSymbols.length === 0,
    sourceId: event.sourceId || null,
    sourceName: event.sourceName || event.source || event.sourceId || "已验证来源",
    verified: true,
    phase,
    blocking,
    deltaMs,
    windowStartAt: exactTime ? new Date(timestamp - blackoutMs).toISOString() : null,
    windowEndAt: exactTime ? new Date(timestamp + pastWindowMs).toISOString() : null
  };
}

export function deriveEventRiskWindows(events = [], options = {}) {
  return (Array.isArray(events) ? events : [])
    .map((event) => projectEventRiskWindow(event, options))
    .filter(Boolean)
    .sort((a, b) => Number(b.blocking) - Number(a.blocking) || Math.abs(a.deltaMs) - Math.abs(b.deltaMs));
}
