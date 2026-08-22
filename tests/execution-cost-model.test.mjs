import assert from "node:assert/strict";
import test from "node:test";
import { buildSlippageCalibration, estimateExecutionCost, maxNotionalForImpact } from "../server/executionCostModel.mjs";
import { systemTradeFills } from "../server/systemTradeProjection.mjs";
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

test("full-account manual real fills keep the conservative execution-cost floor active", () => {
  const db = {
    fills: [20, 21, 22, 23, 24].map((slippageBps, index) => ({
      id: `manual-cost-fill-${index}`,
      symbol: "BTC/USDT",
      direction: "long",
      kind: "entry",
      quantity: 1,
      slippageBps
    }))
  };

  const calibration = buildSlippageCalibration(db, "BTC/USDT");
  assert.equal(calibration.samples, 5);
  assert.equal(calibration.ready, true);
  assert.equal(calibration.p75Bps, 23);
  assert.equal(maxNotionalForImpact(db, { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, maxImpactBps: 15 }), 0);
});

test("missing order-book fields are not coerced into zero-cost liquidity", () => {
  const db = { fills: [] };
  const estimate = estimateExecutionCost(db, { symbol: "BTC/USDT", spreadBps: null, depthUsdt: 100000, notionalUsdt: 100 });
  assert.equal(estimate.ok, false);
  assert.equal(estimate.expectedImpactBps, null);
  assert.equal(maxNotionalForImpact(db, { symbol: "BTC/USDT", spreadBps: null, depthUsdt: 100000, maxImpactBps: 15 }), null);
});

test("analytics can explicitly project system fills without weakening the full-account safety view", () => {
  const baseline = systemDb([1, 2, 3, 4, 5]);
  const fullAccountDb = structuredClone(baseline);
  fullAccountDb.fills.push(
    ...[20, 21, 22, 23, 24].map((slippageBps, index) => ({
      id: `manual-entry-${index}`, kind: "entry", symbol: "BTC/USDT", direction: "long", slippageBps
    })),
    { id: "pending-entry", kind: "entry", executionOrderId: "cost-exec", symbol: "BTC/USDT", direction: "long", slippageBps: 300,
      tradeAttribution: { schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", reason: "mixed_position_attribution" } }
  );
  const systemOnlyDb = { ...fullAccountDb, fills: systemTradeFills(fullAccountDb) };
  const capInput = { symbol: "BTC/USDT", spreadBps: 2, depthUsdt: 100000, maxImpactBps: 15 };

  assert.deepEqual(buildSlippageCalibration(systemOnlyDb, "BTC/USDT"), buildSlippageCalibration(baseline, "BTC/USDT"));
  assert.ok(buildSlippageCalibration(fullAccountDb, "BTC/USDT").p75Bps > buildSlippageCalibration(systemOnlyDb, "BTC/USDT").p75Bps);
  assert.equal(maxNotionalForImpact(fullAccountDb, capInput), 0);
  assert.ok(maxNotionalForImpact(systemOnlyDb, capInput) > 0);
});
