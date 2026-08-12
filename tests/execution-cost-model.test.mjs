import assert from "node:assert/strict";
import test from "node:test";
import { buildSlippageCalibration, estimateExecutionCost, maxNotionalForImpact } from "../server/executionCostModel.mjs";

function fills(values) {
  return values.map((slippageBps) => ({ symbol: "BTC/USDT", kind: "entry", slippageBps }));
}

test("execution cost stays uncalibrated until enough real fills exist", () => {
  const db = { fills: fills([1, 2, 3, 4]) };
  const estimate = estimateExecutionCost(db, { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, notionalUsdt: 100 });
  assert.equal(estimate.ok, true);
  assert.equal(estimate.calibration.ready, false);
  assert.equal(estimate.model, "square_root_uncalibrated");
});

test("real adverse fills may raise but never lower the order-book estimate", () => {
  const high = { fills: fills([8, 9, 10, 11, 12, 14]) };
  const highEstimate = estimateExecutionCost(high, { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, notionalUsdt: 100 });
  assert.equal(buildSlippageCalibration(high, "BTC/USDT").ready, true);
  assert.ok(highEstimate.expectedImpactBps >= highEstimate.bookImpactBps);
  assert.ok(highEstimate.expectedImpactBps >= 11);

  const low = { fills: fills([-2, 0, 0.5, 1, 1.5, 2]) };
  const lowEstimate = estimateExecutionCost(low, { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, notionalUsdt: 100 });
  assert.equal(lowEstimate.expectedImpactBps, lowEstimate.bookImpactBps);
});

test("calibrated slippage above the mandate impact cap yields zero capacity", () => {
  const db = { fills: fills([20, 21, 22, 23, 24]) };
  assert.equal(maxNotionalForImpact(db, { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, maxImpactBps: 15 }), 0);
});

test("missing order-book fields are not coerced into zero-cost liquidity", () => {
  const db = { fills: [] };
  const estimate = estimateExecutionCost(db, { symbol: "BTC/USDT", spreadBps: null, depthUsdt: 100000, notionalUsdt: 100 });
  assert.equal(estimate.ok, false);
  assert.equal(estimate.expectedImpactBps, null);
  assert.equal(maxNotionalForImpact(db, { symbol: "BTC/USDT", spreadBps: null, depthUsdt: 100000, maxImpactBps: 15 }), null);
});
