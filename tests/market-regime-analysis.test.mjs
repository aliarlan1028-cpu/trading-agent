import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMarketRegime } from "../server/marketRegimeAnalysis.mjs";

function candlesFromReturns(returns) {
  let close = 100;
  return [{ close, open: close, high: close, low: close, volume: 1 }].concat(returns.map((ret) => {
    const open = close;
    close *= 1 + ret;
    return { open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
  }));
}

test("regime analysis reports stable low-noise trend with confidence", () => {
  const rows = candlesFromReturns(Array.from({ length: 80 }, (_, index) => 0.002 + (index % 2 ? 0.0002 : -0.0002)));
  const result = analyzeMarketRegime(rows, { spreadBps: 1 });
  assert.equal(result.label, "uptrend");
  assert.ok(result.confidence >= 0.5);
  assert.equal(result.transition.detected, false);
});

test("recent volatility expansion is explicitly marked as a transition", () => {
  const calm = Array.from({ length: 70 }, (_, index) => index % 2 ? 0.001 : -0.001);
  const shock = [0.03, -0.025, 0.035, -0.03, 0.04, -0.02, 0.03, -0.025, 0.04, -0.03];
  const result = analyzeMarketRegime(candlesFromReturns([...calm, ...shock]), { spreadBps: 1 });
  assert.equal(result.transition.detected, true);
  assert.ok(result.transition.reasons.includes("volatility_expansion"));
});

test("wide spread has priority and is classified as low liquidity", () => {
  const rows = candlesFromReturns(Array.from({ length: 40 }, () => 0.001));
  assert.equal(analyzeMarketRegime(rows, { spreadBps: 8 }).label, "low_liquidity");
});

test("missing spread stays missing instead of being reported as zero", () => {
  const rows = candlesFromReturns(Array.from({ length: 40 }, () => 0.001));
  assert.equal(analyzeMarketRegime(rows, { spreadBps: null }).spreadBps, null);
});
