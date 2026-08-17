import crypto from "node:crypto";

const DEFAULT_MAX_INTERVAL_MS = 60 * 60_000;
const DEFAULT_MATERIAL_COOLDOWN_MS = 30 * 60_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 60_000;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function finiteDuration(value, fallback, minimum = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function bucket(value, size) {
  const number = finite(value);
  if (number === null || !(size > 0)) return null;
  return Math.round(number / size) * size;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function normalizedSymbol(value) {
  const raw = String(value || "").toUpperCase().replace(/-SWAP$/, "").replace(/-/g, "/");
  if (/^[A-Z0-9]{2,15}\/USDT$/.test(raw)) return raw;
  return null;
}

function marketDecisionRow(db, symbol) {
  const market = (db.markets || []).find((row) => normalizedSymbol(row.symbol) === symbol) || {};
  const oneHour = market.candlesByTf?.["1h"] || {};
  const candles = oneHour.candles || market.candles || [];
  const lastClosed = candles.filter((row) => row?.closed !== false).at(-1) || null;
  const price = finite(market.price ?? lastClosed?.close ?? lastClosed?.c);
  const high = finite(market.high24h);
  const low = finite(market.low24h);
  const rangePosition = price !== null && high !== null && low !== null && high > low
    ? Math.round(((price - low) / (high - low)) * 10) * 10
    : null;
  return {
    symbol,
    // 只跟踪闭合 1H K 线和粗粒度状态；不把每个 tick 写进指纹，否则定时巡检永远被唤醒。
    lastClosedAt: lastClosed?.time || lastClosed?.timestamp || lastClosed?.ts || oneHour.lastClosedAt || null,
    change24hBucket: bucket(market.changePct ?? market.change24hPct, 1),
    rangePositionBucket: rangePosition,
    fundingBucket: bucket(market.fundingRatePct, 0.01),
    spreadBucket: bucket(market.spreadBps, 2),
    bookSide: finite(market.bookImbalancePct) === null ? null : Number(market.bookImbalancePct) >= 55 ? "buy" : Number(market.bookImbalancePct) <= 45 ? "sell" : "balanced"
  };
}

export function buildAgentDecisionSnapshot(db, options = {}) {
  const symbols = [...new Set((options.symbols || []).map(normalizedSymbol).filter(Boolean))].sort();
  const positions = (db.positions || [])
    .filter((row) => Number(row.size ?? row.pos ?? 0) !== 0)
    .map((row) => ({
      symbol: normalizedSymbol(row.symbol || row.instId),
      direction: String(row.direction || row.posSide || row.side || "unknown").toLowerCase(),
      size: finite(row.size ?? row.pos),
      entryBucket: bucket(row.entry ?? row.avgPx ?? row.avgPrice, 0.01)
    }))
    .filter((row) => row.symbol)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const movers = (db.marketMovers?.movers || []).slice(0, 5).map((row) => ({
    symbol: normalizedSymbol(row.symbol),
    direction: Number(row.changePct) > 0 ? "up" : Number(row.changePct) < 0 ? "down" : "flat",
    magnitudeBucket: bucket(Math.abs(Number(row.changePct)), 2)
  })).filter((row) => row.symbol).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const global = db.marketRegime?.global || {};
  const smart = db.marketRegime?.smartMoney || {};
  return {
    version: 1,
    symbols: symbols.map((symbol) => marketDecisionRow(db, symbol)),
    global: {
      breadthBucket: bucket(global.breadthPct, 10),
      medianChangeBucket: bucket(global.medianChangePct, 1),
      btcChangeBucket: bucket(global.btcChangePct, 1),
      topTraderBias: finite(smart.topTraderLongShortRatio) === null ? null : Number(smart.topTraderLongShortRatio) >= 1.1 ? "long" : Number(smart.topTraderLongShortRatio) <= 0.9 ? "short" : "balanced"
    },
    movers,
    positions,
    runtime: {
      killSwitch: db.system?.killSwitch === true,
      riskStatus: String(db.system?.riskStatus || "unknown"),
      executionMode: String(db.system?.executionMode || "unknown"),
      operationalState: String(db.system?.operationalState || db.system?.automationState || "unknown")
    }
  };
}

export function evaluateAgentDecisionWake(db, input = {}) {
  const requestedNow = Number(input.now ?? Date.now());
  const now = Number.isFinite(requestedNow) ? requestedNow : Date.now();
  const trigger = String(input.trigger || "scheduled_patrol");
  const snapshot = buildAgentDecisionSnapshot(db, { symbols: input.symbols || [] });
  const currentFingerprint = fingerprint(snapshot);
  const stored = db.system?.agentDecisionWakeState || null;
  const parsedLastDecisionAt = new Date(stored?.decisionAt || 0).getTime();
  // A persisted time from the future can happen after clock rollback or state
  // migration. Treat it as unverifiable so the system wakes once and repairs the
  // watermark; clamping it to age=0 could suppress reasoning for years.
  const lastDecisionAt = Number.isFinite(parsedLastDecisionAt) && parsedLastDecisionAt <= now + MAX_FUTURE_CLOCK_SKEW_MS
    ? parsedLastDecisionAt
    : NaN;
  const ageMs = Number.isFinite(lastDecisionAt) ? Math.max(0, now - lastDecisionAt) : Infinity;
  const maxIntervalMs = finiteDuration(
    input.maxIntervalMs ?? process.env.AGENT_SCHEDULED_MAX_INTERVAL_MS,
    DEFAULT_MAX_INTERVAL_MS,
    5 * 60_000
  );
  const materialCooldownMs = finiteDuration(
    input.materialCooldownMs ?? process.env.AGENT_MATERIAL_CHANGE_COOLDOWN_MS,
    DEFAULT_MATERIAL_COOLDOWN_MS,
    0
  );
  const urgent = input.force === true || trigger !== "scheduled_patrol";
  const materialChanged = Boolean(stored?.fingerprint && stored.fingerprint !== currentFingerprint);

  let shouldWake = false;
  let reason = "decision_context_unchanged";
  if (urgent) {
    shouldWake = true;
    reason = input.force === true ? "forced" : `event_trigger:${trigger}`;
  } else if (!stored?.fingerprint || !Number.isFinite(lastDecisionAt)) {
    shouldWake = true;
    reason = "initial_scheduled_decision";
  } else if (ageMs >= maxIntervalMs) {
    shouldWake = true;
    reason = "scheduled_max_interval_elapsed";
  } else if (materialChanged && ageMs >= materialCooldownMs) {
    shouldWake = true;
    reason = "material_decision_context_changed";
  } else if (materialChanged) {
    reason = "material_change_cooling_down";
  }

  return {
    shouldWake,
    reason,
    trigger,
    fingerprint: currentFingerprint,
    previousFingerprint: stored?.fingerprint || null,
    materialChanged,
    ageMs: Number.isFinite(ageMs) ? ageMs : null,
    maxIntervalMs,
    materialCooldownMs,
    snapshot,
    evaluatedAt: new Date(now).toISOString()
  };
}

export function recordAgentDecisionWake(db, evaluation, run = {}) {
  db.system ||= {};
  db.system.agentDecisionWakeState = {
    version: 1,
    fingerprint: evaluation?.fingerprint || fingerprint(evaluation?.snapshot || {}),
    snapshot: evaluation?.snapshot || null,
    decisionAt: run.completedAt || new Date().toISOString(),
    trigger: evaluation?.trigger || run.decisionContext?.trigger || "unknown",
    runId: run.id || null,
    outcome: run.tradePlanId ? "trade_plan" : run.decisionBlocked ? "blocked" : "analysis"
  };
  return db.system.agentDecisionWakeState;
}
