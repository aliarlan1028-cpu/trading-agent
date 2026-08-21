import assert from "node:assert/strict";
import test from "node:test";
import { buildSlippageCalibration, estimateExecutionCost, maxNotionalForImpact } from "../server/executionCostModel.mjs";
import { addSystemExecution, stampFixtureSystemAttribution } from "./helpers/system-trade-fixtures.mjs";

function systemDb(values) {
  const db = { fills: [] };
  const execution = addSystemExecution(db, { executionOrderId: "cost-exec", planId: "cost-plan", quantity: values.length });
  db.fills = values.map((slippageBps, index) => stampFixtureSystemAttribution({
    id: `cost-fill-${index}`, symbol: "BTC/USDT", direction: "long", kind: "entry", quantity: 1, slippageBps
  }, execution));
  return db;
}

test("execution cost stays uncalibrated until enough real fills exist", () => {
  const db = systemDb([1, 2, 3, 4]);
  const estimate = estimateExecutionCost(db, { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, notionalUsdt: 100 });
  assert.equal(estimate.ok, true);
  assert.equal(estimate.calibration.ready, false);
  assert.equal(estimate.model, "square_root_uncalibrated");
});

test("real adverse fills may raise but never lower the order-book estimate", () => {
  const high = systemDb([8, 9, 10, 11, 12, 14]);
  const highEstimate = estimateExecutionCost(high, { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, notionalUsdt: 100 });
  assert.equal(buildSlippageCalibration(high, "BTC/USDT").ready, true);
  assert.ok(highEstimate.expectedImpactBps >= highEstimate.bookImpactBps);
  assert.ok(highEstimate.expectedImpactBps >= 11);

  const low = systemDb([-2, 0, 0.5, 1, 1.5, 2]);
  const lowEstimate = estimateExecutionCost(low, { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, notionalUsdt: 100 });
  assert.equal(lowEstimate.expectedImpactBps, lowEstimate.bookImpactBps);
});

test("calibrated slippage above the mandate impact cap yields zero capacity", () => {
  const db = systemDb([20, 21, 22, 23, 24]);
  assert.equal(maxNotionalForImpact(db, { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, maxImpactBps: 15 }), 0);
});

test("missing order-book fields are not coerced into zero-cost liquidity", () => {
  const db = { fills: [] };
  const estimate = estimateExecutionCost(db, { symbol: "BTC/USDT", spreadBps: null, depthUsdt: 100000, notionalUsdt: 100 });
  assert.equal(estimate.ok, false);
  assert.equal(estimate.expectedImpactBps, null);
  assert.equal(maxNotionalForImpact(db, { symbol: "BTC/USDT", spreadBps: null, depthUsdt: 100000, maxImpactBps: 15 }), null);
});

test("manual and pending entries cannot change system calibration, reward-risk, or capacity", () => {
  const baseline = systemDb([20, 21, 22, 23, 24]);
  const db = structuredClone(baseline);
  db.fills.push(
    { id: "manual-entry", kind: "entry", symbol: "BTC/USDT", direction: "long", slippageBps: 200 },
    { id: "pending-entry", kind: "entry", executionOrderId: "cost-exec", symbol: "BTC/USDT", direction: "long", slippageBps: 300,
      tradeAttribution: { schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", reason: "mixed_position_attribution" } }
  );
  const input = { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, notionalUsdt: 100 };
  const capInput = { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, maxImpactBps: 15 };
  assert.deepEqual(buildSlippageCalibration(db, "BTC/USDT"), buildSlippageCalibration(baseline, "BTC/USDT"));
  assert.deepEqual(estimateExecutionCost(db, input), estimateExecutionCost(baseline, input));
  assert.equal(maxNotionalForImpact(db, capInput), maxNotionalForImpact(baseline, capInput));
});
