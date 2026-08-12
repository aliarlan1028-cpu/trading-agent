// Deterministic OHLCV integrity gate for the OKX market-data path.
// It repairs only harmless transport artifacts (ordering and duplicate timestamps),
// drops an explicitly unconfirmed/current candle, and fails closed on malformed or
// discontinuous closed-bar history. No price is interpolated or invented.

export const TIMEFRAME_MS = Object.freeze({
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000
});

const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

function numeric(value) {
  return finite(value) ? Number(value) : Number.NaN;
}

function normalizedCandle(candle) {
  return {
    ...candle,
    time: numeric(candle?.time),
    open: numeric(candle?.open),
    high: numeric(candle?.high),
    low: numeric(candle?.low),
    close: numeric(candle?.close),
    volume: numeric(candle?.volume)
  };
}

function structuralIssue(candle) {
  if (![candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume].every(finite)) return "non_finite_value";
  if (candle.time <= 0) return "invalid_timestamp";
  if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) return "non_positive_price";
  if (candle.volume < 0) return "negative_volume";
  if (candle.high < candle.low) return "high_below_low";
  if (candle.high < Math.max(candle.open, candle.close)) return "high_below_body";
  if (candle.low > Math.min(candle.open, candle.close)) return "low_above_body";
  return null;
}

export function assessOhlcvQuality(input, options = {}) {
  const timeframe = String(options.timeframe || "1h").toLowerCase();
  const intervalMs = TIMEFRAME_MS[timeframe];
  if (!intervalMs) throw new Error(`Unsupported OHLCV timeframe: ${timeframe}`);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const minCandles = Math.max(1, Number(options.minCandles || 1));
  const rows = Array.isArray(input) ? input : [];
  const issues = [];
  const invalidRows = [];
  const byTime = new Map();
  let duplicates = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const candle = normalizedCandle(rows[index]);
    const issue = structuralIssue(candle);
    if (issue) {
      invalidRows.push({ index, time: finite(candle.time) ? candle.time : null, issue });
      continue;
    }
    if (candle.time > nowMs + intervalMs) {
      invalidRows.push({ index, time: candle.time, issue: "future_timestamp" });
      continue;
    }
    if (byTime.has(candle.time)) duplicates += 1;
    // Prefer the confirmed copy when an OKX page boundary repeats a candle.
    const previous = byTime.get(candle.time);
    if (!previous || previous.confirmed !== true || candle.confirmed === true) byTime.set(candle.time, candle);
  }

  let candles = [...byTime.values()].sort((a, b) => a.time - b.time);
  let droppedOpenCandles = 0;
  const closed = [];
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const explicitlyOpen = candle.confirmed === false;
    const clockOpen = candle.time + intervalMs > nowMs;
    if (explicitlyOpen || clockOpen) {
      // Only a trailing current candle is safe to discard. An unconfirmed candle
      // in the middle of history indicates inconsistent source data.
      if (index === candles.length - 1 && options.dropOpenCandle !== false) {
        droppedOpenCandles += 1;
        continue;
      }
      issues.push({ type: "unclosed_historical_candle", at: candle.time });
    }
    closed.push(candle);
  }
  candles = closed;

  const gaps = [];
  for (let index = 1; index < candles.length; index += 1) {
    const delta = candles[index].time - candles[index - 1].time;
    if (delta !== intervalMs) {
      gaps.push({
        after: candles[index - 1].time,
        before: candles[index].time,
        deltaMs: delta,
        missingBars: delta > intervalMs ? Math.max(0, Math.round(delta / intervalMs) - 1) : null,
        issue: delta < intervalMs ? "irregular_interval" : "missing_interval"
      });
    }
  }

  if (invalidRows.length) issues.push({ type: "invalid_candles", count: invalidRows.length });
  if (gaps.length) issues.push({ type: "time_discontinuities", count: gaps.length });
  if (candles.length < minCandles) issues.push({ type: "insufficient_valid_candles", got: candles.length, need: minCandles });

  const ok = issues.length === 0;
  const report = {
    status: ok ? (duplicates || droppedOpenCandles ? "repaired" : "passed") : "failed",
    timeframe,
    intervalMs,
    received: rows.length,
    accepted: candles.length,
    duplicatesRemoved: duplicates,
    openCandlesDropped: droppedOpenCandles,
    invalidRows: invalidRows.slice(0, 20),
    gaps: gaps.slice(0, 20),
    issues,
    checkedAt: new Date(nowMs).toISOString()
  };
  return { ok, candles, report };
}

export function enforceOhlcvQuality(input, options = {}) {
  const assessed = assessOhlcvQuality(input, options);
  if (assessed.ok) return assessed;
  const error = new Error(`OHLCV integrity failed: ${assessed.report.issues.map((issue) => issue.type).join(",")}`);
  error.code = "OHLCV_INTEGRITY_FAILED";
  error.report = assessed.report;
  throw error;
}
