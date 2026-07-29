import assert from "node:assert/strict";
import test from "node:test";
import { buildProfessionalSnapshot, buildTradingPermissionEvidence } from "../server/professionalAnalytics.mjs";
import { SKILL_TOOLS } from "../server/skillTools.mjs";

function fixture() {
  const now = new Date().toISOString();
  return { meta:{}, system:{autonomyEnabled:true,killSwitch:false,remainingDailyLossUsdt:10}, markets:[{symbol:"BTC/USDT",price:100,updatedAt:now,candles:[]}], positions:[], mandates:[{id:"m1",status:"active",allowedSymbols:["BTC/USDT"]}], accountSnapshots:[{status:"ok",createdAt:now}], reconciliationReports:[{status:"ok",createdAt:now}], executionOrders:[], fills:[], agentRuns:[], tradePlans:[], riskChecks:[], portfolio:{totalEquityUsdt:1000} };
}

test("统一交易许可证据逐项给出可审计结论", () => {
  const db = fixture();
  const evidence = buildTradingPermissionEvidence(db);
  assert.equal(evidence.decision, "allowed");
  db.system.killSwitch = true;
  assert.equal(buildTradingPermissionEvidence(db).decision, "blocked");
});

test("专业快照包含 SLO、组合、执行质量和回放", () => {
  const snapshot = buildProfessionalSnapshot(fixture());
  assert.ok(snapshot.slo.checks.length >= 4);
  assert.ok(snapshot.portfolioRisk);
  assert.ok(snapshot.executionQuality);
  assert.ok(Array.isArray(snapshot.replayBundles));
});

test("八个专业原生 Skill 都声明输入输出、新鲜度和失败策略", () => {
  const ids = ["contract_risk_profile","portfolio_exposure","liquidity_impact","funding_basis","deterministic_market_regime","execution_quality","strategy_drift","exchange_degradation"];
  for (const name of ids) {
    const skill = SKILL_TOOLS.find((item) => item.toolName === name);
    assert.ok(skill, name);
    assert.ok(skill.schema);
    assert.ok(skill.outputSchema);
    assert.ok(Number.isFinite(skill.freshnessMs));
    assert.equal(typeof skill.failClosed, "boolean");
    assert.match(skill.version, /^\d+\.\d+\.\d+$/);
  }
});
