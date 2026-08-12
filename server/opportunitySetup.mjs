import { analyzeMarketRegime } from "./marketRegimeAnalysis.mjs";

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function atr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const rows = candles.slice(-(period + 1));
  let total = 0;
  for (let index = 1; index < rows.length; index += 1) {
    const high = Number(rows[index].high), low = Number(rows[index].low), prev = Number(rows[index - 1].close);
    if (![high, low, prev].every(Number.isFinite)) return null;
    total += Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev));
  }
  return total / period;
}

function rangePosition(price, low, high) {
  return finite(price) && finite(low) && finite(high) && Number(high) > Number(low)
    ? clamp((Number(price) - Number(low)) / (Number(high) - Number(low)), 0, 1)
    : null;
}

function locationLabel(position) {
  if (position == null) return "unknown";
  if (position <= 0.2) return "lower_extreme";
  if (position < 0.4) return "lower_quartile";
  if (position <= 0.6) return "middle";
  if (position < 0.8) return "upper_quartile";
  return "upper_extreme";
}

export function buildOpportunitySetupSnapshot({ market = {}, candles = [], early = null, reversal = null } = {}) {
  const rows = (Array.isArray(candles) ? candles : []).filter((row) => finite(row?.close));
  const price = finite(market.price) ? Number(market.price) : Number(rows.at(-1)?.close);
  const position = rangePosition(price, market.low24h, market.high24h);
  const regime = analyzeMarketRegime(rows, { spreadBps: market.spreadBps });
  const bias = regime.label === "uptrend" ? "long"
    : regime.label === "downtrend" ? "short"
    : early?.ready && ["long", "short"].includes(early.direction) ? early.direction
    : "neutral";
  const recent = rows.slice(-21, -1);
  const recentHigh = recent.length ? Math.max(...recent.map((row) => Number(row.high))) : null;
  const recentLow = recent.length ? Math.min(...recent.map((row) => Number(row.low))) : null;
  const currentAtr = atr(rows);
  const nearHigh = finite(recentHigh) && finite(currentAtr) && Math.abs(Number(recentHigh) - price) <= currentAtr;
  const nearLow = finite(recentLow) && finite(currentAtr) && Math.abs(price - Number(recentLow)) <= currentAtr;

  let trendState = "inactive";
  let trendReason = "市场状态不是明确趋势";
  if (bias === "long") {
    const late = position != null && position >= 0.85;
    const aligned = early?.ready && early.direction === "long";
    trendState = late ? "late_do_not_chase" : aligned ? "ready_for_deep_validation" : "waiting_pullback_confirmation";
    trendReason = late ? "多头偏置仍在，但价格贴近上沿，等待回踩而非原地追多" : aligned ? "趋势偏多且短周期重新向上" : "趋势偏多，等待回踩企稳或短周期重新向上";
  } else if (bias === "short") {
    const late = position != null && position <= 0.15;
    const aligned = early?.ready && early.direction === "short";
    trendState = late ? "late_do_not_chase" : aligned ? "ready_for_deep_validation" : "waiting_rebound_confirmation";
    trendReason = late ? "空头偏置仍在，但价格贴近下沿，等待反弹而非原地追空" : aligned ? "趋势偏空且短周期重新向下" : "趋势偏空，等待反弹衰竭或短周期重新向下";
  }

  let breakoutState = "watching_key_level";
  let breakoutDirection = "neutral";
  if (bias === "long" && finite(recentHigh)) {
    breakoutDirection = "long";
    breakoutState = price > recentHigh ? "breakout_seen_awaiting_retest" : nearHigh ? "near_breakout_level" : "watching_key_level";
  } else if (bias === "short" && finite(recentLow)) {
    breakoutDirection = "short";
    breakoutState = price < recentLow ? "breakdown_seen_awaiting_retest" : nearLow ? "near_breakdown_level" : "watching_key_level";
  }

  const reversalState = reversal?.qualified ? "candidate_for_deep_validation"
    : reversal?.ready ? "watching_confirmations"
    : "inactive";

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    symbol: market.symbol || null,
    marketRegime: regime,
    directionBias: bias,
    location: { rangePosition24h: position == null ? null : Number(position.toFixed(3)), label: locationLabel(position) },
    referenceLevels: {
      recentHigh: finite(recentHigh) ? Number(recentHigh) : null,
      recentLow: finite(recentLow) ? Number(recentLow) : null,
      atr14: finite(currentAtr) ? Number(currentAtr.toFixed(8)) : null
    },
    setupChannels: {
      trendContinuation: { direction: bias, state: trendState, reason: trendReason },
      breakoutRetest: { direction: breakoutDirection, state: breakoutState, requiresRetest: true },
      reversalReclaim: {
        direction: reversal?.direction || "neutral",
        state: reversalState,
        score: reversal?.score ?? null,
        confirmations: reversal?.confirmations || [],
        missing: reversal?.missing || []
      }
    },
    discipline: "区间位置只描述入场位置，不单独决定多空；趋势偏置、当前入场质量与反转候选必须分开。"
  };
}
