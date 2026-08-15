import { strictFiniteFact } from "./factValues.mjs";

export function exchangeTimestampIso(value) {
  if (value === null || value === undefined || value === "") return null;
  let timestampMs;
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    timestampMs = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  } else {
    timestampMs = new Date(value).getTime();
  }
  return Number.isFinite(timestampMs) ? new Date(timestampMs).toISOString() : null;
}

export function timestampEvidence(value, options = {}) {
  const now = Number(options.now ?? Date.now());
  const maxAgeMs = Number(options.maxAgeMs ?? Infinity);
  const maxFutureSkewMs = Number(options.maxFutureSkewMs ?? process.env.MAX_MARKET_FUTURE_SKEW_MS ?? 30_000);
  const observedAt = exchangeTimestampIso(value);
  if (!observedAt) return { ok: false, reason: "missing", observedAt: null, ageMs: Infinity };
  const observedAtMs = new Date(observedAt).getTime();
  const ageMs = now - observedAtMs;
  if (ageMs < -maxFutureSkewMs) return { ok: false, reason: "future_timestamp", observedAt, ageMs };
  if (ageMs > maxAgeMs) return { ok: false, reason: "stale", observedAt, ageMs };
  return { ok: true, reason: null, observedAt, ageMs: Math.max(0, ageMs) };
}

export function applyTickerObservation(market, observation = {}, options = {}) {
  const now = Number(options.now ?? Date.now());
  const receivedAt = exchangeTimestampIso(options.receivedAt ?? now);
  const sourceAt = exchangeTimestampIso(observation.sourceAt ?? observation.rawTime ?? observation.ts);
  const source = timestampEvidence(sourceAt, {
    now,
    maxAgeMs: Number(options.maxSourceAgeMs ?? Infinity),
    maxFutureSkewMs: options.maxFutureSkewMs
  });
  const received = timestampEvidence(receivedAt, {
    now,
    maxAgeMs: Number(options.maxReceivedAgeMs ?? Infinity),
    maxFutureSkewMs: options.maxFutureSkewMs
  });
  if (!source.ok || !received.ok) {
    market.tickerRejectedAt = exchangeTimestampIso(now);
    market.tickerRejectionReason = !source.ok ? `source_${source.reason}` : `received_${received.reason}`;
    return { applied: false, reason: market.tickerRejectionReason, source, received };
  }
  const previousSourceMs = new Date(market.tickerSourceAt || 0).getTime();
  const nextSourceMs = new Date(source.observedAt).getTime();
  if (Number.isFinite(previousSourceMs) && previousSourceMs > nextSourceMs) {
    market.tickerRejectedAt = exchangeTimestampIso(now);
    market.tickerRejectionReason = "out_of_order";
    return { applied: false, reason: "out_of_order", source, received };
  }

  const price = strictFiniteFact(observation.price);
  if (!Number.isFinite(price) || price <= 0) return { applied: false, reason: "price_unavailable", source, received };
  market.price = price;
  for (const field of ["high24h", "low24h", "changePct", "streamVolume24h"]) {
    const value = strictFiniteFact(observation[field]);
    if (Number.isFinite(value)) market[field] = value;
  }
  if (observation.volume24h !== null && observation.volume24h !== undefined && observation.volume24h !== "") {
    market.volume24h = options.formatVolume ? options.formatVolume(observation.volume24h) : observation.volume24h;
  }
  market.tickerSourceAt = source.observedAt;
  market.tickerReceivedAt = received.observedAt;
  market.tickerSyncedAt = received.observedAt;
  if (options.realtime === true) market.lastRealtimeAt = received.observedAt;
  if (observation.source) market.lastRealtimeSource = observation.source;
  market.tickerRejectionReason = null;
  market.status = "synced";
  return { applied: true, source, received };
}

export function applyScalarMarketObservation(market, field, value, options = {}) {
  const parsed = strictFiniteFact(value);
  const sourceAt = exchangeTimestampIso(options.sourceAt);
  const receivedAt = exchangeTimestampIso(options.receivedAt ?? options.now ?? Date.now());
  const prefix = String(options.prefix || field);
  const source = timestampEvidence(sourceAt, { now: options.now, maxAgeMs: options.maxSourceAgeMs ?? Infinity, maxFutureSkewMs: options.maxFutureSkewMs });
  const received = timestampEvidence(receivedAt, { now: options.now, maxAgeMs: options.maxReceivedAgeMs ?? Infinity, maxFutureSkewMs: options.maxFutureSkewMs });
  if (!Number.isFinite(parsed) || !source.ok || !received.ok) return { applied: false, reason: !source.ok ? `source_${source.reason}` : !received.ok ? `received_${received.reason}` : "value_unavailable" };
  const sourceField = `${prefix}SourceAt`;
  const previousMs = new Date(market[sourceField] || 0).getTime();
  const nextMs = new Date(source.observedAt).getTime();
  if (Number.isFinite(previousMs) && previousMs > nextMs) return { applied: false, reason: "out_of_order" };
  market[field] = parsed;
  market[sourceField] = source.observedAt;
  market[`${prefix}ReceivedAt`] = received.observedAt;
  return { applied: true, source, received };
}
