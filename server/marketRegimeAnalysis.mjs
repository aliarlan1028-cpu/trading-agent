// Deterministic regime diagnostics focused on transition risk. The existing
// strategy label remains intact; this module adds volatility expansion,
// directional efficiency and previous-vs-current state evidence.

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function stdev(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function returnsOf(candles) {
  const closes = candles.map((candle) => Number(candle.close)).filter((value) => finite(value) && value > 0);
  const returns = [];
  for (let index = 1; index < closes.length; index += 1) returns.push(Math.log(closes[index] / closes[index - 1]));
  return { closes, returns };
}

function classify(candles, spreadBps = null) {
  const { closes, returns } = returnsOf(candles);
  if (closes.length < 20 || returns.length < 19) return { label: "insufficient", confidence: 0, sampleBars: closes.length };
  const recentReturns = returns.slice(-Math.min(10, returns.length));
  const baselineReturns = returns.slice(-Math.min(60, returns.length));
  const recentVol = stdev(recentReturns) || 0;
  const baselineVol = stdev(baselineReturns) || 0;
  const volRatio = baselineVol > 0 ? recentVol / baselineVol : 1;
  const trendPct = (closes.at(-1) / closes[0] - 1) * 100;
  let traveled = 0;
  for (let index = 1; index < closes.length; index += 1) traveled += Math.abs(closes[index] - closes[index - 1]);
  const efficiency = traveled > 0 ? Math.abs(closes.at(-1) - closes[0]) / traveled : 0;
  const noiseMovePct = baselineVol * Math.sqrt(returns.length) * 100;
  const directionalScore = Math.abs(trendPct) / Math.max(0.0001, noiseMovePct);
  const lowLiquidity = finite(spreadBps) && Number(spreadBps) > 5;

  let label;
  let margin;
  if (lowLiquidity) {
    label = "low_liquidity";
    margin = (Number(spreadBps) - 5) / 5;
  } else if (volRatio >= 1.6) {
    label = "high_volatility";
    margin = volRatio - 1.6;
  } else if (directionalScore >= 1 && efficiency >= 0.25) {
    label = trendPct >= 0 ? "uptrend" : "downtrend";
    margin = Math.min(directionalScore - 1, efficiency - 0.25 + 0.2);
  } else {
    label = "range";
    margin = Math.min(Math.max(0, 1 - directionalScore), Math.max(0, 0.35 - efficiency) + 0.1);
  }
  const confidence = clamp(0.5 + margin * 0.35, 0.35, 0.95);
  return {
    label,
    confidence: Number(confidence.toFixed(3)),
    sampleBars: closes.length,
    trendPct: Number(trendPct.toFixed(3)),
    directionalEfficiency: Number(efficiency.toFixed(3)),
    directionalScore: Number(directionalScore.toFixed(3)),
    recentVolPct: Number((recentVol * 100).toFixed(4)),
    baselineVolPct: Number((baselineVol * 100).toFixed(4)),
    volatilityRatio: Number(volRatio.toFixed(3)),
    spreadBps: finite(spreadBps) ? Number(spreadBps) : null
  };
}

export function analyzeMarketRegime(candles = [], options = {}) {
  const rows = Array.isArray(candles) ? candles.filter((candle) => finite(candle?.close) && Number(candle.close) > 0) : [];
  const currentRows = rows.slice(-Math.min(120, rows.length));
  const current = classify(currentRows, options.spreadBps);
  if (current.label === "insufficient") return { ...current, transition: { detected: false, type: "insufficient_data", confidence: 0 } };

  const shiftBars = Math.max(5, Math.min(10, Math.floor(currentRows.length / 4)));
  const priorRows = currentRows.slice(0, -shiftBars).slice(-Math.min(120, currentRows.length));
  const previous = classify(priorRows, options.spreadBps);
  const reasons = [];
  if (previous.label !== "insufficient" && previous.label !== current.label) reasons.push(`label:${previous.label}->${current.label}`);
  if (current.volatilityRatio >= 1.6) reasons.push("volatility_expansion");
  if (current.volatilityRatio <= 0.6) reasons.push("volatility_contraction");
  if (["uptrend", "downtrend"].includes(previous.label) && ["uptrend", "downtrend"].includes(current.label) && previous.label !== current.label) reasons.push("direction_reversal");
  const transitionConfidence = reasons.length
    ? clamp(Math.max(current.confidence, Math.abs(current.volatilityRatio - 1)), 0, 0.99)
    : 0;
  return {
    ...current,
    previousLabel: previous.label,
    transition: {
      detected: reasons.length > 0,
      type: reasons.includes("direction_reversal") ? "direction_reversal"
        : reasons.includes("volatility_expansion") ? "volatility_expansion"
        : reasons.includes("volatility_contraction") ? "volatility_contraction"
        : reasons[0] || "stable",
      reasons,
      confidence: Number(transitionConfidence.toFixed(3))
    }
  };
}
