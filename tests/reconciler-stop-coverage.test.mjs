import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { checkStopLossCoverage, runReconciler } from "../server/reconciler.mjs";

process.env.OKX_API_KEY = "reconciler-stop-test-key";
const apiKeyFingerprint = crypto.createHash("sha256").update(process.env.OKX_API_KEY).digest("hex").slice(0, 16);
const verifiedAuditStatus = Object.freeze({
  operationalReady: true,
  mode: "full_chain",
  confidence: "full_chain_local",
  legacyChainOk: true,
  externalAttestation: "deferred",
  failures: []
});

function fixture(algoOrders) {
  const db = {
    positions: [{
      id: "position-1",
      source: "execution_engine",
      executionOrderId: "execution-1",
      symbol: "BTC/USDT",
      size: 0.01,
      stopLoss: 90000
    }],
    executionOrders: [{ id: "execution-1", stopClientOrderId: "stopExecution1" }]
  };
  const snapshot = {
    id: "snapshot-1",
    accountId: "okx-main",
    exchange: "OKX",
    status: "ok",
    algoOrders
  };
  return { db, snapshots: new Map([[snapshot.accountId, snapshot]]) };
}

test("OKX 未触发策略委托中存在同一止损才算真实受保护", () => {
  const { db, snapshots } = fixture([{
    instId: "BTC-USDT-SWAP",
    algoClOrdId: "stopExecution1",
    slTriggerPx: "90000",
    state: "live"
  }]);
  assert.deepEqual(checkStopLossCoverage(db, snapshots), []);
});

test("本地有止损价格但 OKX 策略委托已不存在时判定为 critical", () => {
  const { db, snapshots } = fixture([]);
  const [difference] = checkStopLossCoverage(db, snapshots);
  assert.equal(difference.type, "exchange_stop_missing");
  assert.equal(difference.severity, "critical");
});

test("旧快照没有策略委托字段时不能把止损当成已核验", () => {
  const { db, snapshots } = fixture(undefined);
  const [difference] = checkStopLossCoverage(db, snapshots);
  assert.equal(difference.type, "stop_coverage_unverified");
  assert.equal(difference.severity, "critical");
});

test("armed OMS 恢复在对账确认无差异后自动退出只减仓并收口状态", () => {
  const now = new Date().toISOString();
  const db = {
    system: { reduceOnlyMode: true, reduceOnlyBy: "armed_setup_recovery" },
    positions: [], orders: [], executionOrders: [],
    tradePlans: [{ id: "plan-armed", status: "recovery_pending_reconciliation" }],
    armedSetups: [{ id: "armed-1", planId: "plan-armed", omsOrderId: "oms-1", status: "RECOVERY_PENDING_RECONCILIATION", events: [] }],
    opportunityCandidates: [{ id: "opp-1", planId: "plan-armed", status: "RECOVERY_PENDING_RECONCILIATION" }],
    accountSnapshots: [{ id: "snap-1", accountId: "okx", apiKeyFingerprint, exchange: "OKX", status: "ok", positions: [], openOrders: [], algoOrders: [], openOrdersComplete: true, algoOrdersComplete: true, createdAt: now }],
    exchangeAccounts: [{ id: "okx", exchange: "OKX", readEnabled: true, apiKeyFingerprint }],
    realtimeConnections: [{ id: "rt", exchange: "OKX", streamType: "public_market", status: "connected", lastMessageAt: now }],
    reconciliationReports: [], riskIncidents: [{ id: "inc-1", source: "oms-1", status: "open" }], auditLogs: [], traces: []
  };
  const report = runReconciler(db);
  assert.equal(report.status, "ok");
  assert.equal(db.system.reduceOnlyMode, false);
  assert.equal(db.armedSetups[0].status, "RECOVERED_RECONCILED");
  assert.equal(db.tradePlans[0].status, "failed");
  assert.equal(db.riskIncidents[0].status, "resolved");
});

test("成功对账会立即复评并解除专业风险闸留下的陈旧只减仓", () => {
  const previousProfile = process.env.PRODUCTION_SECURITY_PROFILE;
  process.env.PRODUCTION_SECURITY_PROFILE = "bitlaunch_single_server";
  const now = new Date().toISOString();
  const db = {
    meta: {},
    system: {
      liveTradingEnabled: true,
      autonomyEnabled: true,
      orderWriteEnabled: true,
      professionalRiskMode: true,
      reduceOnlyMode: true,
      reduceOnlyBy: "professional_risk_gate"
    },
    realtimeStarted: true,
    positions: [], orders: [], executionOrders: [], tradePlans: [], armedSetups: [], opportunityCandidates: [],
    accountSnapshots: [{ id: "snap-live", accountId: "okx", apiKeyFingerprint, exchange: "OKX", status: "ok", positions: [], openOrders: [], algoOrders: [], openOrdersComplete: true, algoOrdersComplete: true, createdAt: now }],
    exchangeAccounts: [{ id: "okx", exchange: "OKX", readEnabled: true, apiKeyFingerprint }],
    realtimeConnections: [
      { id: "public", exchange: "OKX", streamType: "public_market", status: "connected", lastMessageAt: now },
      { id: "private", exchange: "OKX", streamType: "private_user", status: "connected", lastMessageAt: now, authenticatedCredentialFingerprint: apiKeyFingerprint }
    ],
    markets: [{
      symbol: "BTC/USDT", price: 100,
      tickerSourceAt: now, tickerReceivedAt: now,
      bookSourceAt: now, bookReceivedAt: now,
      openInterestSourceAt: now, openInterestReceivedAt: now,
      fundingSourceAt: now, fundingReceivedAt: now,
      updatedAt: now, microSyncedAt: now
    }],
    mandates: [{ id: "mandate", status: "active", allowedSymbols: ["BTC/USDT"] }],
    grayReleasePolicies: [{ enabled: true, requiresManualApproval: false }],
    reconciliationReports: [], riskIncidents: [], auditLogs: [], traces: []
  };
  try {
    const report = runReconciler(db, { auditStatus: verifiedAuditStatus });
    assert.equal(report.status, "ok");
    assert.equal(db.system.operationalDegradation.degraded, false);
    assert.equal(db.system.reduceOnlyMode, false);
    assert.equal(db.system.reduceOnlyBy, null);
  } finally {
    if (previousProfile === undefined) delete process.env.PRODUCTION_SECURITY_PROFILE;
    else process.env.PRODUCTION_SECURITY_PROFILE = previousProfile;
  }
});
