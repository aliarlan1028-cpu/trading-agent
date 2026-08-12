import assert from "node:assert/strict";
import test from "node:test";
import { assessOhlcvQuality, enforceOhlcvQuality } from "../server/ohlcvQuality.mjs";

const HOUR = 60 * 60 * 1000;
const candle = (time, extra = {}) => ({ time, open: 100, high: 102, low: 99, close: 101, volume: 10, confirmed: true, ...extra });

test("OHLCV gate sorts, deduplicates and drops only the trailing open candle", () => {
  const nowMs = 10 * HOUR;
  const result = assessOhlcvQuality([
    candle(8 * HOUR),
    candle(7 * HOUR),
    candle(8 * HOUR),
    candle(9 * HOUR, { confirmed: false })
  ], { timeframe: "1h", nowMs, minCandles: 2 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.candles.map((row) => row.time), [7 * HOUR, 8 * HOUR]);
  assert.equal(result.report.duplicatesRemoved, 1);
  assert.equal(result.report.openCandlesDropped, 1);
  assert.equal(result.report.status, "repaired");
});

test("OHLCV gate fails closed on missing bars and impossible prices", () => {
  const rows = [
    candle(5 * HOUR),
    candle(7 * HOUR),
    candle(8 * HOUR, { high: 100 })
  ];
  const result = assessOhlcvQuality(rows, { timeframe: "1h", nowMs: 20 * HOUR });
  assert.equal(result.ok, false);
  assert.equal(result.report.gaps.length, 1);
  assert.equal(result.report.invalidRows[0].issue, "high_below_body");
  assert.throws(() => enforceOhlcvQuality(rows, { timeframe: "1h", nowMs: 20 * HOUR }), (error) => error.code === "OHLCV_INTEGRITY_FAILED");
});

test("an unconfirmed candle inside closed history is never silently repaired", () => {
  const result = assessOhlcvQuality([
    candle(5 * HOUR),
    candle(6 * HOUR, { confirmed: false }),
    candle(7 * HOUR)
  ], { timeframe: "1h", nowMs: 20 * HOUR });
  assert.equal(result.ok, false);
  assert.ok(result.report.issues.some((issue) => issue.type === "unclosed_historical_candle"));
});

test("missing OHLCV fields are invalid rather than coerced to zero", () => {
  const result = assessOhlcvQuality([
    candle(5 * HOUR, { volume: null }),
    candle(6 * HOUR, { close: null })
  ], { timeframe: "1h", nowMs: 20 * HOUR });
  assert.equal(result.ok, false);
  assert.equal(result.report.invalidRows.length, 2);
  assert.ok(result.report.invalidRows.every((row) => row.issue === "non_finite_value"));
});
