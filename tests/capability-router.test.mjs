import assert from "node:assert/strict";
import test from "node:test";

import { buildCapabilityPlan, recordCapabilityResult, validateProposalCapabilityCoverage } from "../server/capabilityRouter.mjs";
import { advanceDecisionContext, createDecisionContext } from "../server/decisionCoordinator.mjs";

test("capability router emits distinct day and swing evidence contracts without deciding direction", () => {
  const plan = buildCapabilityPlan({ trigger: "early_opportunity", symbols: ["BTC-USDT", "BTC/USDT"] });
  assert.deepEqual(plan.symbols, ["BTC/USDT"]);
  assert.deepEqual(plan.rolePacks.day_trader.timeframes, { context: "1h", structure: "15m", confirmation: "5m" });
  assert.deepEqual(plan.rolePacks.swing_trader.timeframes, { context: "1d", structure: "4h", confirmation: "1h" });
  assert.equal(plan.routingPolicy.roleSuitabilityControlsExecution, false);
});

test("proposal coverage requires fresh deterministic structure for the selected role and symbol", () => {
  const run = {};
  const missing = validateProposalCapabilityCoverage(run, { symbol: "BTC/USDT", timeframe: "15m", traderRole: "day_trader" });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "role_structure_capability_missing");
  recordCapabilityResult(run, "analyze_market_structure", { symbol: "BTC/USDT" }, {
    available: true, deterministic: true, version: 3, analyzedAt: new Date().toISOString(),
    roleViews: { day_trader: { structure: { available: true } }, swing_trader: { structure: { available: true } } }
  });
  const ready = validateProposalCapabilityCoverage(run, { symbol: "BTC/USDT", timeframe: "15m", traderRole: "day_trader" });
  assert.equal(ready.ok, true);
  assert.equal(ready.evidence.deterministic, true);
});

test("decision coordinator advances monotonically and never claims trading authority", () => {
  const context = createDecisionContext({ trigger: "watch_trigger", symbols: ["SUI/USDT"] });
  advanceDecisionContext(context, "base_facts_ready", "evidence ready");
  advanceDecisionContext(context, "deep_analysis", "role facts ready");
  advanceDecisionContext(context, "triggered", "must not rewind");
  assert.equal(context.state, "deep_analysis");
  assert.equal(context.guardrails.decidesDirection, false);
  assert.equal(context.guardrails.changesRisk, false);
});
