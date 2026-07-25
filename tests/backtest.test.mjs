import test from "node:test";
import assert from "node:assert/strict";
import { simulate } from "../server/backtestEngine.mjs";

test("ambiguous OHLC bars are resolved conservatively", () => {
  const candles = [
    { open: 100, high: 101, low: 99, close: 100 },
    { open: 100, high: 101, low: 99, close: 100 },
    { open: 100, high: 101, low: 99, close: 100 },
    { open: 100, high: 103, low: 97, close: 101 }
  ];
  const result = simulate(candles, [false, true, false, false], {
    stopLossPct: 2,
    takeProfitR: 1,
    feePct: 0,
    slippagePct: 0,
    fundingPct8h: 0
  });
  assert.equal(result.trades, 1);
  assert.ok(result.expectancyR < 0);
});

test("backtest reports uncertainty around expectancy", () => {
  const candles = Array.from({ length: 8 }, (_, i) => ({
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i
  }));
  const result = simulate(candles, [false, true, false, true, false, true, false, false], {
    stopLossPct: 10,
    takeProfitR: 10,
    feePct: 0,
    slippagePct: 0,
    fundingPct8h: 0
  });
  assert.ok("expectancyStdErrR" in result);
  assert.ok("expectancyLower90R" in result);
});
