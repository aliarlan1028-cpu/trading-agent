// Shared execution-cost model. The deterministic order-book estimate remains the
// base; sufficiently large real fill samples can only raise (never lower) that
// estimate. This prevents optimistic self-calibration from weakening safeguards.

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

function quantile(values, q) {
  const rows = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  const position = (rows.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return rows[lower];
  return rows[lower] + (rows[upper] - rows[lower]) * (position - lower);
}

export function buildSlippageCalibration(db, symbol, options = {}) {
  const normalized = String(symbol || "").toUpperCase();
  const limit = Math.max(5, Number(options.limit || 100));
  const samples = (db.fills || [])
    .filter((fill) => String(fill.symbol || "").toUpperCase() === normalized)
    .filter((fill) => fill.kind === "entry" && finite(fill.slippageBps))
    .slice(0, limit)
    // Price improvement must not cancel adverse fills in a safety estimate.
    .map((fill) => Math.max(0, Number(fill.slippageBps)));
  const minSamples = Math.max(3, Number(options.minSamples || 5));
  return {
    symbol: normalized,
    samples: samples.length,
    ready: samples.length >= minSamples,
    p50Bps: samples.length ? Number(quantile(samples, 0.5).toFixed(3)) : null,
    p75Bps: samples.length ? Number(quantile(samples, 0.75).toFixed(3)) : null,
    p95Bps: samples.length ? Number(quantile(samples, 0.95).toFixed(3)) : null,
    minSamples
  };
}

export function estimateExecutionCost(db, input = {}) {
  if (!finite(input.spreadBps) || !finite(input.depthUsdt) || !finite(input.notionalUsdt ?? 0)) {
    return { ok: false, reason: "invalid_or_missing_orderbook", expectedImpactBps: null };
  }
  const spreadBps = Number(input.spreadBps);
  const depthUsdt = Number(input.depthUsdt);
  const notionalUsdt = Math.max(0, Number(input.notionalUsdt || 0));
  const impactCoefficientBps = Math.max(1, Number(input.impactCoefficientBps || 100));
  if (!finite(spreadBps) || spreadBps < 0 || !finite(depthUsdt) || depthUsdt <= 0 || !finite(notionalUsdt)) {
    return { ok: false, reason: "invalid_or_missing_orderbook", expectedImpactBps: null };
  }
  const participation = notionalUsdt / depthUsdt;
  const halfSpreadBps = spreadBps / 2;
  const bookImpactBps = halfSpreadBps + impactCoefficientBps * Math.sqrt(Math.max(0, participation));
  const calibration = buildSlippageCalibration(db, input.symbol, input);
  const calibratedFloorBps = calibration.ready ? calibration.p75Bps : null;
  const expectedImpactBps = Math.max(bookImpactBps, calibratedFloorBps ?? 0);
  return {
    ok: true,
    model: calibration.ready ? "square_root_with_real_fill_floor" : "square_root_uncalibrated",
    spreadBps,
    depthUsdt,
    notionalUsdt,
    participationPct: Number((participation * 100).toFixed(4)),
    bookImpactBps: Number(bookImpactBps.toFixed(3)),
    calibratedFloorBps,
    expectedImpactBps: Number(expectedImpactBps.toFixed(3)),
    calibration
  };
}

export function maxNotionalForImpact(db, input = {}) {
  if (!finite(input.spreadBps) || !finite(input.depthUsdt) || !finite(input.maxImpactBps)) return null;
  const spreadBps = Number(input.spreadBps);
  const depthUsdt = Number(input.depthUsdt);
  const maxImpactBps = Number(input.maxImpactBps);
  const impactCoefficientBps = Math.max(1, Number(input.impactCoefficientBps || 100));
  const calibration = buildSlippageCalibration(db, input.symbol, input);
  if (![spreadBps, depthUsdt, maxImpactBps].every(finite) || depthUsdt <= 0 || maxImpactBps <= 0) return null;
  if (calibration.ready && Number(calibration.p75Bps) > maxImpactBps) return 0;
  const remainingBps = maxImpactBps - spreadBps / 2;
  if (remainingBps <= 0) return 0;
  return Number((depthUsdt * (remainingBps / impactCoefficientBps) ** 2).toFixed(2));
}

export function estimateNetRewardRisk(input = {}) {
  const direction = String(input.direction || "long").toLowerCase() === "short" ? "short" : "long";
  const entry = Number(input.entryPrice);
  const stop = Number(input.stopPrice);
  const target = Number(input.targetPrice);
  const quantity = Math.abs(Number(input.quantity));
  if (![entry, stop, target, quantity].every(Number.isFinite) || entry <= 0 || stop <= 0 || target <= 0 || quantity <= 0) {
    return { ok: false, reason: "invalid_net_rr_inputs" };
  }
  const expectedImpactBps = Math.max(0, Number(input.expectedImpactBps) || 0);
  const entrySlippageBps = Math.max(expectedImpactBps, Math.max(0, Number(input.maxEntrySlippageBps) || 0));
  const targetSlippageBps = Math.max(expectedImpactBps, Math.max(0, Number(input.targetSlippageBps) || 0));
  const stopSlippageBps = Math.max(entrySlippageBps * 1.5, Math.max(0, Number(input.stopSlippageBps) || 12));
  const feeRate = Math.max(0, Number(input.takerFeeRate) || 0.0005);
  const fundingRatePct = Math.abs(Number(input.fundingRatePct) || 0);
  const fundingPeriods = Math.max(0, Number(input.fundingPeriods) || 0);
  const entrySlip = entrySlippageBps / 10_000;
  const targetSlip = targetSlippageBps / 10_000;
  const stopSlip = stopSlippageBps / 10_000;
  const worstEntry = direction === "short" ? entry * (1 - entrySlip) : entry * (1 + entrySlip);
  const worstTarget = direction === "short" ? target * (1 + targetSlip) : target * (1 - targetSlip);
  const worstStop = direction === "short" ? stop * (1 + stopSlip) : stop * (1 - stopSlip);
  const grossRewardUsdt = (direction === "short" ? worstEntry - worstTarget : worstTarget - worstEntry) * quantity;
  const grossRiskUsdt = (direction === "short" ? worstStop - worstEntry : worstEntry - worstStop) * quantity;
  if (!(grossRewardUsdt > 0) || !(grossRiskUsdt > 0)) return { ok: false, reason: "non_positive_cost_adjusted_distance" };
  const entryFeeUsdt = worstEntry * quantity * feeRate;
  const targetExitFeeUsdt = worstTarget * quantity * feeRate;
  const stopExitFeeUsdt = worstStop * quantity * feeRate;
  // Funding credits are deliberately ignored. The pre-trade gate budgets the
  // absolute published rate for the expected holding periods as an adverse cost.
  const fundingCostUsdt = worstEntry * quantity * (fundingRatePct / 100) * fundingPeriods;
  const netRewardUsdt = grossRewardUsdt - entryFeeUsdt - targetExitFeeUsdt - fundingCostUsdt;
  const netRiskUsdt = grossRiskUsdt + entryFeeUsdt + stopExitFeeUsdt + fundingCostUsdt;
  const netRewardRisk = netRiskUsdt > 0 ? netRewardUsdt / netRiskUsdt : null;
  return {
    ok: Number.isFinite(netRewardRisk),
    model: "worst_acceptable_fill_plus_fees_slippage_funding_v1",
    direction,
    prices: { plannedEntry: entry, worstEntry, plannedStop: stop, worstStop, plannedTarget: target, worstTarget },
    quantity,
    assumptions: { expectedImpactBps, entrySlippageBps, targetSlippageBps, stopSlippageBps, takerFeeRate: feeRate, fundingRatePct, fundingPeriods },
    costs: { entryFeeUsdt, targetExitFeeUsdt, stopExitFeeUsdt, fundingCostUsdt },
    grossRewardUsdt,
    grossRiskUsdt,
    netRewardUsdt,
    netRiskUsdt,
    grossRewardRisk: grossRiskUsdt > 0 ? grossRewardUsdt / grossRiskUsdt : null,
    netRewardRisk
  };
}

export function netRewardRiskGate(estimate, minimum, options = {}) {
  if (options.live !== true) return { allowed: true, reason: "not_live" };
  const threshold = Number(minimum);
  if (!estimate?.ok || !Number.isFinite(Number(estimate.netRewardRisk))) {
    return { allowed: false, reason: "net_reward_risk_unverifiable" };
  }
  if (!(Number.isFinite(threshold) && threshold > 0)) {
    return { allowed: false, reason: "net_reward_risk_threshold_invalid" };
  }
  if (Number(estimate.netRewardRisk) < threshold) {
    return { allowed: false, reason: "net_reward_risk_below_minimum", actual: Number(estimate.netRewardRisk), minimum: threshold };
  }
  return { allowed: true, reason: "net_reward_risk_passed", actual: Number(estimate.netRewardRisk), minimum: threshold };
}
