import assert from "node:assert/strict";
import test from "node:test";
import { buildProfessionalSnapshot, buildReplayBundles, buildStrategyDrift, buildTradingPermissionEvidence } from "../server/professionalAnalytics.mjs";
import { SKILL_TOOLS } from "../server/skillTools.mjs";
import { financiallyReconciledFills, installSystemTradeProvenance } from "./financial-fixtures.mjs";

const verifiedAuditStatus = Object.freeze({
  operationalReady: true,
  mode: "full_chain",
  confidence: "full_chain_local",
  legacyChainOk: true,
  externalAttestation: "deferred",
  failures: []
});

function fixture() {
  const now = new Date().toISOString();
  return { meta:{}, system:{autonomyEnabled:true,killSwitch:false,remainingDailyLossUsdt:10}, markets:[{symbol:"BTC/USDT",price:100,updatedAt:now,candles:[]}], positions:[], mandates:[{id:"m1",status:"active",allowedSymbols:["BTC/USDT"]}], accountSnapshots:[{status:"ok",createdAt:now}], reconciliationReports:[{status:"ok",createdAt:now}], executionOrders:[], fills:[], agentRuns:[], tradePlans:[], riskChecks:[], portfolio:{totalEquityUsdt:1000} };
}

test("统一交易许可证据逐项给出可审计结论", () => {
  const db = fixture();
  const evidence = buildTradingPermissionEvidence(db, { auditStatus: verifiedAuditStatus });
  assert.equal(evidence.decision, "allowed");
  db.system.killSwitch = true;
  assert.equal(buildTradingPermissionEvidence(db, { auditStatus: verifiedAuditStatus }).decision, "blocked");
});

test("专业快照包含 SLO、组合、执行质量和回放", () => {
  const snapshot = buildProfessionalSnapshot(fixture(), { auditStatus: verifiedAuditStatus });
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

test("策略漂移按完整生命周期净值计数，部分平仓不重复且计入开仓费", () => {
  const db = fixture();
  db.tradePlans = [{ id: "p1", strategy: "trend" }];
  db.fills = financiallyReconciledFills([
    { id: "entry", kind: "entry", executionOrderId: "e1", tradePlanId: "p1", feeUsdt: 0.8, createdAt: "2026-08-01T00:00:00Z" },
    { id: "partial", kind: "close", partial: true, executionOrderId: "e1", tradePlanId: "p1", realizedPnl: 0.6, feeUsdt: 0.2, createdAt: "2026-08-01T01:00:00Z" },
    { id: "final", kind: "close", executionOrderId: "e1", tradePlanId: "p1", realizedPnl: 0.4, feeUsdt: 0.4, createdAt: "2026-08-01T02:00:00Z" }
  ]);
  installSystemTradeProvenance(db);
  const report = buildStrategyDrift(db, { strategy: "trend" });
  assert.equal(report.diagnosis.trades, 1);
  assert.ok(Math.abs(report.diagnosis.recentExpectancy + 0.4) < 1e-9);
});

test("replay includes a projected external manual exit when only attribution carries the run binding", () => {
  const db = fixture();
  const execution = {
    id: "replay-exec", planId: "replay-plan", agentRunId: "replay-run", exchange: "OKX", accountId: "account-a",
    environment: "production", symbol: "BTC/USDT", direction: "long", status: "closed"
  };
  db.agentRuns = [{ id: "replay-run", tradePlanId: "replay-plan", status: "completed" }];
  db.executionOrders = [execution];
  db.tradePlans = [{ id: execution.planId, agentRunId: "replay-run", exchange: "OKX", accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long" }];
  db.fills = [{
    id: "external-manual-exit", kind: "close", symbol: "BTC/USDT", direction: "long", realizedPnl: 2,
    tradeAttribution: {
      schemaVersion: 1, scope: "system", origin: "external_exchange", exitMode: "manual_exit",
      executionOrderId: execution.id, planId: execution.planId, method: "deterministic_manual_exit", reason: null,
      evidence: { accountId: "account-a", environment: "production", exchangeOrderId: null, exchangeTradeId: null, matchedEntryFillIds: [], attributedQuantity: 1 }
    }
  }];
  assert.deepEqual(buildReplayBundles(db)[0].fillIds, ["external-manual-exit"]);
});
