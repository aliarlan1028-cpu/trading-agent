import assert from "node:assert/strict";
import test from "node:test";

import { analyzeMultiTimeframeStructure, analyzeStructureFrame } from "../server/marketStructureFacts.mjs";

function candles({ count = 80, start = 100, drift = 0.4, wave = 2, intervalMs = 60_000 } = {}) {
  const rows = [];
  for (let index = 0; index < count; index += 1) {
    const center = start + drift * index + Math.sin(index / 3) * wave;
    const open = center - drift * 0.2;
    const close = center + drift * 0.2;
    rows.push({
      time: 1_700_000_000_000 + index * intervalMs,
      open, high: Math.max(open, close) + 0.8, low: Math.min(open, close) - 0.8, close,
      volume: 1000 + index * 5
    });
  }
  return rows;
}

test("closed-candle structure facts expose pivots, trend, events and evidence timestamps", () => {
  const result = analyzeStructureFrame(candles(), "15m");
  assert.equal(result.available, true);
  assert.equal(result.deterministic, true);
  assert.equal(result.timeframe, "15m");
  assert.ok(["up", "range"].includes(result.trend.direction));
  assert.ok(result.confirmedSwings.highs.length > 0);
  assert.ok(result.confirmedSwings.lows.length > 0);
  assert.match(result.lastClosedAt, /^\d{4}-/);
  if (result.latestEvent) {
    assert.ok(["BOS", "CHoCH", "STRUCTURE_BREAK"].includes(result.latestEvent.kind));
    assert.equal(result.latestEvent.closeBeyondLevel, true);
    assert.match(result.latestEvent.breakTime, /^\d{4}-/);
  }
});

test("role-aware analysis uses distinct day and swing timeframe stacks without controlling execution", () => {
  const byTf = {
    "1d": candles({ drift: 1, intervalMs: 86_400_000 }),
    "4h": candles({ drift: 0.8, intervalMs: 14_400_000 }),
    "1h": candles({ drift: 0.5, intervalMs: 3_600_000 }),
    "15m": candles({ drift: 0.3, intervalMs: 900_000 }),
    "5m": candles({ drift: 0.2, intervalMs: 300_000 })
  };
  const result = analyzeMultiTimeframeStructure(byTf, { symbol: "BTC/USDT", traderRole: "day_trader", market: { spreadBps: 1.2 } });
  assert.equal(result.selectedRole, "day_trader");
  assert.deepEqual(result.roleViews.day_trader.timeframes, { context: "1h", structure: "15m", confirmation: "5m" });
  assert.deepEqual(result.roleViews.swing_trader.timeframes, { context: "1d", structure: "4h", confirmation: "1h" });
  assert.equal(result.roleSuitability.mode, "shadow");
  assert.equal(result.roleSuitability.controlsExecution, false);
  assert.ok(Number.isFinite(result.roleSuitability.scores.day_trader.score));
  assert.ok(Number.isFinite(result.roleSuitability.scores.swing_trader.score));
});

test("future candles cannot change structure facts emitted before their confirmation boundary", () => {
  const base = candles({ count: 70 });
  const original = analyzeStructureFrame(base, "1h");
  const mutatedFuture = [...base, ...candles({ count: 8, start: 10, drift: -3 }).map((row, index) => ({ ...row, time: base.at(-1).time + (index + 1) * 3_600_000 }))];
  const extended = analyzeStructureFrame(mutatedFuture, "1h");
  const cutoff = base.at(-1).time;
  const originalEvents = original.recentEvents.filter((event) => new Date(event.breakTime).getTime() <= cutoff);
  const extendedPastEvents = extended.recentEvents.filter((event) => new Date(event.breakTime).getTime() <= cutoff);
  assert.deepEqual(extendedPastEvents, originalEvents.slice(0, extendedPastEvents.length));
});
