import assert from "node:assert/strict";
import test from "node:test";

import { auditRequiredCapabilityCoverage, buildCapabilityPlan, recordCapabilityResult, requiredCapabilityCalls, validateProposalCapabilityCoverage } from "../server/capabilityRouter.mjs";
import { advanceDecisionContext, createDecisionContext } from "../server/decisionCoordinator.mjs";

test("capability router emits distinct day and swing evidence contracts without deciding direction", () => {
  const plan = buildCapabilityPlan({ trigger: "early_opportunity", symbols: ["BTC-USDT", "BTC/USDT"] });
  assert.deepEqual(plan.symbols, ["BTC/USDT"]);
  assert.deepEqual(plan.rolePacks.day_trader.timeframes, { context: "1h", structure: "15m", confirmation: "5m" });
  assert.deepEqual(plan.rolePacks.swing_trader.timeframes, { context: "1d", structure: "4h", confirmation: "1h" });
  assert.equal(plan.routingPolicy.roleSuitabilityControlsExecution, false);
});

test("scheduled patrol deterministically preflights relevant built-in capabilities for every whitelist symbol", () => {
  const plan = buildCapabilityPlan({
    trigger: "scheduled_patrol",
    symbols: ["BTC/USDT", "SUI/USDT", "ADA/USDT", "DOGE/USDT"],
    marketAnalysis: true
  });
  const available = [
    "get_global_market", "scan_market_opportunities", "analyze_market_structure", "get_microstructure",
    "funding_extremes_scanner", "relative_strength", "support_resistance_levels"
  ];
  const calls = requiredCapabilityCalls(plan, available);
  assert.equal(calls.filter((item) => item.name === "analyze_market_structure").length, 4);
  assert.equal(calls.filter((item) => item.name === "get_microstructure").length, 4);
  assert.ok(calls.some((item) => item.name === "funding_extremes_scanner"));
  assert.ok(calls.some((item) => item.name === "relative_strength"));
  assert.ok(calls.some((item) => item.name === "scan_market_opportunities"));
  assert.equal(calls.some((item) => item.name === "strategy_drift"), false, "无关能力不应为了凑调用量而执行");
});

test("capability preflight audit exposes omissions instead of silently accepting them", () => {
  const required = [
    { name: "analyze_market_structure", args: { symbol: "BTC/USDT" }, reason: "结构" },
    { name: "get_microstructure", args: { symbol: "BTC/USDT" }, reason: "微观" }
  ];
  const audit = auditRequiredCapabilityCoverage(required, [{ name: "analyze_market_structure", args: { symbol: "BTC/USDT" }, summary: "确定性结构 LONG" }]);
  assert.equal(audit.ok, false);
  assert.equal(audit.covered, 1);
  assert.equal(audit.missing[0].name, "get_microstructure");
});

test("required but disabled capability stays visible as an auditable gap", () => {
  const plan = buildCapabilityPlan({ trigger: "watch_trigger", symbols: ["BTC/USDT"], marketAnalysis: true });
  const calls = requiredCapabilityCalls(plan, ["analyze_market_structure", "get_microstructure"]);
  const disabled = calls.find((item) => item.name === "support_resistance_levels");
  assert.equal(disabled.available, false);
  const audit = auditRequiredCapabilityCoverage(calls, [
    { name: "analyze_market_structure", args: { symbol: "BTC/USDT" }, summary: "确定性结构 LONG" },
    { name: "get_microstructure", args: { symbol: "BTC/USDT" }, summary: "资金费率 0.01%" }
  ]);
  assert.equal(audit.ok, false);
  assert.equal(audit.missing[0].unavailable, true);
});

test("manual account-only questions do not fan out into unrelated market tools", () => {
  const plan = buildCapabilityPlan({ trigger: "manual", symbols: ["BTC/USDT"], marketAnalysis: false });
  assert.deepEqual(requiredCapabilityCalls(plan, ["get_global_market", "analyze_market_structure", "get_microstructure"]), []);
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
