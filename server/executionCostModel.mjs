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
  const samples = (db?.fills || [])
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
