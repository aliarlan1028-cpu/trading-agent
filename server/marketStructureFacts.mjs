import { analyzeMarketRegime } from "./marketRegimeAnalysis.mjs";
import { scoreRoleSuitability } from "./roleSuitability.mjs";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const round = (value, digits = 8) => finite(value) ? Number(Number(value).toFixed(digits)) : null;

function normalizeCandles(candles = []) {
  const byTime = new Map();
  for (const raw of candles || []) {
    const time = new Date(raw.time ?? raw.t ?? raw.ts ?? 0).getTime();
    const row = {
      time,
      open: Number(raw.open ?? raw.o), high: Number(raw.high ?? raw.h),
      low: Number(raw.low ?? raw.l), close: Number(raw.close ?? raw.c),
      volume: finite(raw.volume ?? raw.v) ? Number(raw.volume ?? raw.v) : null
    };
    if (Number.isFinite(time) && [row.open, row.high, row.low, row.close].every(Number.isFinite)
      && row.high >= Math.max(row.open, row.close, row.low) && row.low <= Math.min(row.open, row.close, row.high)) byTime.set(time, row);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function atr(rows, period = 14) {
  if (rows.length < period + 1) return null;
  let total = 0;
  for (let index = rows.length - period; index < rows.length; index += 1) {
    const row = rows[index], previous = rows[index - 1];
    total += Math.max(row.high - row.low, Math.abs(row.high - previous.close), Math.abs(row.low - previous.close));
  }
  return total / period;
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function pivots(rows, wing = 2) {
  const highs = [], lows = [];
  for (let index = wing; index < rows.length - wing; index += 1) {
    const left = rows.slice(index - wing, index), right = rows.slice(index + 1, index + wing + 1), row = rows[index];
    if ([...left, ...right].every((item) => row.high > item.high)) highs.push({ type: "high", index, time: row.time, price: row.high, candle: row });
    if ([...left, ...right].every((item) => row.low < item.low)) lows.push({ type: "low", index, time: row.time, price: row.low, candle: row });
  }
  return { highs, lows };
}

function trendFromPivots(found) {
  const highs = found.highs.slice(-2), lows = found.lows.slice(-2);
  if (highs.length < 2 || lows.length < 2) return { direction: "range", sequence: "insufficient_confirmed_swings" };
  const higherHigh = highs[1].price > highs[0].price, higherLow = lows[1].price > lows[0].price;
  const lowerHigh = highs[1].price < highs[0].price, lowerLow = lows[1].price < lows[0].price;
  if (higherHigh && higherLow) return { direction: "up", sequence: "HH/HL" };
  if (lowerHigh && lowerLow) return { direction: "down", sequence: "LH/LL" };
  return { direction: "range", sequence: `${higherHigh ? "HH" : lowerHigh ? "LH" : "EH"}/${higherLow ? "HL" : lowerLow ? "LL" : "EL"}` };
}

function volumeRatioAt(rows, index, lookback = 20) {
  const current = Number(rows[index]?.volume);
  const baseline = average(rows.slice(Math.max(0, index - lookback), index).map((row) => Number(row.volume)));
  return Number.isFinite(current) && Number.isFinite(baseline) && baseline > 0 ? current / baseline : null;
}

function structureEvents(rows, found, wing = 2) {
  const events = [];
  for (const pivot of [...found.highs, ...found.lows]) {
    const start = pivot.index + wing + 1;
    for (let index = start; index < rows.length; index += 1) {
      const direction = pivot.type === "high" ? "up" : "down";
      const broken = direction === "up" ? rows[index].close > pivot.price : rows[index].close < pivot.price;
      if (!broken) continue;
      // A swing at index N only becomes observable after `wing` later candles.
      // Classifying a historical break with a pivot that had not yet been
      // confirmed at that break would leak future candles into BOS/CHoCH.
      const before = {
        highs: found.highs.filter((item) => item.index + wing <= index),
        lows: found.lows.filter((item) => item.index + wing <= index)
      };
      const priorTrend = trendFromPivots(before).direction;
      const kind = priorTrend === direction ? "BOS" : ["up", "down"].includes(priorTrend) ? "CHoCH" : "STRUCTURE_BREAK";
      const distance = Math.abs(rows[index].close - pivot.price);
      // Freeze normalization at the break candle. Using the latest ATR would
      // let future volatility rewrite an already-emitted historical event.
      const eventAtr = atr(rows.slice(0, index + 1));
      events.push({
        kind, direction, pivotType: pivot.type, pivotIndex: pivot.index,
        pivotTime: new Date(pivot.time).toISOString(), breakIndex: index,
        breakTime: new Date(rows[index].time).toISOString(), level: round(pivot.price),
        close: round(rows[index].close), closeBeyondLevel: true,
        distance: round(distance), distanceAtr: eventAtr ? round(distance / eventAtr, 3) : null,
        volumeRatio: round(volumeRatioAt(rows, index), 3), priorTrend
      });
      break;
    }
  }
  return events.sort((a, b) => (b.breakIndex - a.breakIndex) || (b.pivotIndex - a.pivotIndex));
}

function zones(found) {
  const make = (pivot, type) => {
    if (!pivot) return null;
    const bodyLow = Math.min(pivot.candle.open, pivot.candle.close), bodyHigh = Math.max(pivot.candle.open, pivot.candle.close);
    return type === "supply"
      ? { type, from: round(bodyLow), to: round(pivot.candle.high), sourceTime: new Date(pivot.time).toISOString(), source: "confirmed_swing_high_candle" }
      : { type, from: round(pivot.candle.low), to: round(bodyHigh), sourceTime: new Date(pivot.time).toISOString(), source: "confirmed_swing_low_candle" };
  };
  return [make(found.highs.at(-1), "supply"), make(found.lows.at(-1), "demand")].filter(Boolean);
}

export function analyzeStructureFrame(candles = [], timeframe = "1h") {
  const rows = normalizeCandles(candles);
  if (rows.length < 24) return { available: false, timeframe, sampleBars: rows.length, reason: "insufficient_closed_candles" };
  const currentAtr = atr(rows), found = pivots(rows), trend = trendFromPivots(found);
  const events = structureEvents(rows, found);
  const latestEvent = events[0] || null;
  const last = rows.at(-1), recent = rows.slice(-24);
  const rangeLow = Math.min(...recent.map((row) => row.low)), rangeHigh = Math.max(...recent.map((row) => row.high));
  const rangePosition = rangeHigh > rangeLow ? (last.close - rangeLow) / (rangeHigh - rangeLow) : null;
  const sma20 = average(rows.slice(-20).map((row) => row.close));
  const phase = trend.direction === "up" ? (last.close < sma20 ? "pullback" : "continuation")
    : trend.direction === "down" ? (last.close > sma20 ? "rebound" : "continuation") : "range";
  const latestVolumeRatio = volumeRatioAt(rows, rows.length - 1);
  return {
    available: true, version: 1, deterministic: true, timeframe, sampleBars: rows.length,
    lastClosedAt: new Date(last.time).toISOString(), lastClose: round(last.close), atr14: round(currentAtr),
    trend, phase, regime: analyzeMarketRegime(rows), latestEvent,
    recentEvents: events.slice(0, 5),
    confirmedSwings: {
      highs: found.highs.slice(-3).map((item) => ({ time: new Date(item.time).toISOString(), price: round(item.price) })),
      lows: found.lows.slice(-3).map((item) => ({ time: new Date(item.time).toISOString(), price: round(item.price) }))
    },
    referenceZones: zones(found),
    range: { low: round(rangeLow), high: round(rangeHigh), position: round(rangePosition, 3) },
    volume: {
      latestRatioTo20: round(latestVolumeRatio, 3),
      state: !Number.isFinite(latestVolumeRatio) ? "unavailable" : latestVolumeRatio >= 1.5 ? "expansion" : latestVolumeRatio <= 0.65 ? "contraction" : "normal"
    }
  };
}

function buildRoleView(frames, role) {
  const mapping = role === "day_trader"
    ? { context: "1h", structure: "15m", confirmation: "5m" }
    : { context: "1d", structure: "4h", confirmation: "1h" };
  const view = { role, timeframes: mapping, context: frames[mapping.context], structure: frames[mapping.structure], confirmation: frames[mapping.confirmation] };
  const contextTrend = view.context?.trend?.direction, structureTrend = view.structure?.trend?.direction;
  view.alignment = ["up", "down"].includes(contextTrend) && contextTrend === structureTrend ? "aligned"
    : ["up", "down"].includes(contextTrend) && ["up", "down"].includes(structureTrend) ? "conflict" : "mixed";
  view.bias = view.alignment === "aligned" ? structureTrend === "up" ? "LONG" : "SHORT"
    : view.structure?.latestEvent?.kind === "CHoCH" ? view.structure.latestEvent.direction === "up" ? "LONG" : "SHORT" : "NEUTRAL";
  return view;
}

function entryIdea(view) {
  const frame = view?.structure;
  if (!frame?.available || view.bias === "NEUTRAL") return "没有确定性同向结构；比较区间边界、微观结构与角色确认周期后再决定，禁止仅凭位置开仓。";
  const desired = view.bias === "LONG" ? "demand" : "supply";
  const zone = frame.referenceZones?.find((item) => item.type === desired);
  const invalidation = view.bias === "LONG" ? frame.confirmedSwings?.lows?.at(-1)?.price : frame.confirmedSwings?.highs?.at(-1)?.price;
  return `${view.bias === "LONG" ? "多头" : "空头"}结构事实占优；等待${zone ? `${zone.from}-${zone.to} ${desired}参考区` : "结构位"}的${view.timeframes.confirmation}确认，结构失效参考 ${invalidation ?? "未形成"}。这不是订单，仍需微观结构、成本与硬风控。`;
}

function compactFrame(frame) {
  if (!frame?.available) return { available: false, timeframe: frame?.timeframe, reason: frame?.reason || "unavailable" };
  return {
    available: true,
    timeframe: frame.timeframe,
    lastClosedAt: frame.lastClosedAt,
    lastClose: frame.lastClose,
    atr14: frame.atr14,
    trend: frame.trend,
    phase: frame.phase,
    latestEvent: frame.latestEvent,
    regime: frame.regime,
    referenceZones: frame.referenceZones,
    range: frame.range,
    volume: frame.volume
  };
}

function compactRoleView(view) {
  return {
    role: view.role,
    timeframes: view.timeframes,
    alignment: view.alignment,
    bias: view.bias,
    context: compactFrame(view.context),
    structure: compactFrame(view.structure),
    confirmation: compactFrame(view.confirmation)
  };
}

export function analyzeMultiTimeframeStructure(candlesByTf = {}, options = {}) {
  const frames = {};
  for (const timeframe of ["1d", "4h", "1h", "15m", "5m"]) frames[timeframe] = analyzeStructureFrame(candlesByTf[timeframe] || [], timeframe);
  const fullRoleViews = { day_trader: buildRoleView(frames, "day_trader"), swing_trader: buildRoleView(frames, "swing_trader") };
  const roleSuitability = scoreRoleSuitability(fullRoleViews, options.market || {});
  const selectedRole = ["day_trader", "swing_trader"].includes(options.traderRole)
    ? options.traderRole
    : ["day_trader", "swing_trader"].includes(roleSuitability.recommendation) ? roleSuitability.recommendation : "swing_trader";
  const selected = fullRoleViews[selectedRole];
  const roleViews = { day_trader: compactRoleView(fullRoleViews.day_trader), swing_trader: compactRoleView(fullRoleViews.swing_trader) };
  const qualityScore = roleSuitability.scores[selectedRole].score;
  const h4 = frames["4h"], h1 = frames["1h"];
  return {
    available: Object.values(frames).some((frame) => frame.available),
    deterministic: true,
    source: "OKX_CLOSED_OHLCV_DETERMINISTIC",
    symbol: options.symbol || null,
    directionRequested: options.direction || null,
    selectedRole,
    roleSuitability,
    selectedView: roleViews[selectedRole],
    roleViews,
    frames,
    bias: selected.bias,
    structure4h: h4?.available ? `${h4.trend.sequence} · ${h4.latestEvent ? `${h4.latestEvent.kind} ${h4.latestEvent.direction} @ ${h4.latestEvent.level}` : "无新结构突破"}` : "4H证据不足",
    phase: selected.structure?.phase || "unknown",
    keyZones: selected.structure?.referenceZones || [],
    liquidity1h: h1?.latestEvent ? `${h1.latestEvent.kind} ${h1.latestEvent.direction}，收盘越过 ${h1.latestEvent.level}` : "1H 无已确认结构突破",
    volumeContext: selected.structure?.volume?.state || "unavailable",
    entryIdea: entryIdea(selected),
    quality: qualityScore >= 70 ? "A" : qualityScore >= 50 ? "B" : "C",
    note: `${selectedRole === "day_trader" ? "日内" : "波段"}周期对齐=${selected.alignment}；角色适配为影子评分，不控制交易。`
  };
}
