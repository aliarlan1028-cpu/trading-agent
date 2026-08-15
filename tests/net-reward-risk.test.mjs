import assert from "node:assert/strict";
import test from "node:test";
import { estimateNetRewardRisk, netRewardRiskGate } from "../server/executionCostModel.mjs";

test("net RR includes adverse fills, both-side fees and funding", () => {
  const result = estimateNetRewardRisk({
    direction: "long",
    entryPrice: 100,
    stopPrice: 98,
    targetPrice: 104,
    quantity: 10,
    expectedImpactBps: 5,
    maxEntrySlippageBps: 8,
    stopSlippageBps: 12,
    targetSlippageBps: 5,
    takerFeeRate: 0.0005,
    fundingRatePct: 0.01,
    fundingPeriods: 2
  });
  assert.equal(result.ok, true);
  assert.ok(result.netRewardRisk < result.grossRewardRisk);
  assert.ok(result.costs.entryFeeUsdt > 0);
  assert.ok(result.costs.stopExitFeeUsdt > 0);
  assert.ok(result.costs.targetExitFeeUsdt > 0);
  assert.ok(result.costs.fundingCostUsdt > 0);
});

test("a gross 2R setup can fail after conservative execution costs", () => {
  const result = estimateNetRewardRisk({
    direction: "long", entryPrice: 100, stopPrice: 99, targetPrice: 102, quantity: 10,
    expectedImpactBps: 12, maxEntrySlippageBps: 12, stopSlippageBps: 20,
    targetSlippageBps: 12, takerFeeRate: 0.0005, fundingRatePct: 0.02, fundingPeriods: 3
  });
  assert.equal(result.ok, true);
  assert.ok(result.grossRewardRisk < 2);
  assert.ok(result.netRewardRisk < result.grossRewardRisk);
  assert.ok(result.netRewardRisk < 2);
});

test("short-side worst fills are direction aware", () => {
  const result = estimateNetRewardRisk({
    direction: "short", entryPrice: 100, stopPrice: 102, targetPrice: 96, quantity: 5,
    expectedImpactBps: 5, maxEntrySlippageBps: 8, stopSlippageBps: 12,
    targetSlippageBps: 5, takerFeeRate: 0.0005, fundingRatePct: -0.01, fundingPeriods: 1
  });
  assert.equal(result.ok, true);
  assert.ok(result.prices.worstEntry < 100);
  assert.ok(result.prices.worstStop > 102);
  assert.ok(result.prices.worstTarget > 96);
  assert.ok(result.netRewardRisk > 0);
});

test("missing target cannot produce a net RR", () => {
  const result = estimateNetRewardRisk({ direction: "long", entryPrice: 100, stopPrice: 98, quantity: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "invalid_net_rr_inputs");
});

test("live net RR gate passes the exact boundary and rejects one tick below it", () => {
  assert.equal(netRewardRiskGate({ ok: true, netRewardRisk: 1.5 }, 1.5, { live: true }).allowed, true);
  const below = netRewardRiskGate({ ok: true, netRewardRisk: 1.499999 }, 1.5, { live: true });
  assert.equal(below.allowed, false);
  assert.equal(below.reason, "net_reward_risk_below_minimum");
});

test("live net RR gate fails closed on missing evidence while dry-run remains available", () => {
  assert.equal(netRewardRiskGate({ ok: false, reason: "missing_target" }, 1.5, { live: true }).allowed, false);
  assert.equal(netRewardRiskGate({ ok: false, reason: "missing_target" }, 1.5, { live: false }).allowed, true);
});
