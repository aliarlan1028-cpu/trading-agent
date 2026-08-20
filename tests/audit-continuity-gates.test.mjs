import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { buildCurrentRiskSnapshot } from "../server/currentRiskSnapshot.mjs";
import { autonomousProductionBlockers } from "../server/liveModeService.mjs";
import { buildReadinessReport, deriveAutomationState } from "../server/ops.mjs";
import { buildOverviewPrincipalScope } from "../server/overviewPrincipalScope.mjs";
import { buildProfessionalSnapshot, buildTradingPermissionEvidence } from "../server/professionalAnalytics.mjs";
import { assessOperationalDegradation } from "../server/professionalRiskGate.mjs";
import { registerSecurityConfigRoutes } from "../server/routes/securityConfig.mjs";
import { effectiveAuditOperationalStatus } from "../server/store.mjs";
import { validateWriteGuard } from "../server/tradeActions.mjs";

const validAudit = Object.freeze({
  operationalReady: true,
  mode: "incident_adjudicated_local_continuity",
  confidence: "local_integrity_only",
  deploymentMode: "owner_risk_accepted_standalone",
  legacyChainOk: false,
  legacyClassification: "legacy_forensic_integrity_limited",
  legacyStoredLinkBreaks: 674,
  legacyBreakIslands: 282,
  legacyPrefixDigest: "d596ecebe7400d5b221ce959a5b7cf173fd093c53ca88fe0fe736798c9640672",
  cutoffRowid: 127399,
  cutoffHeadHash: "3415f657226bd46be4ae38f4b9a1ff49cb67c0f9953800c5e57429937350b3b0",
  tailRowsChecked: 10,
  externalAttestation: "deferred",
  failures: [],
});
const invalidAudit = Object.freeze({
  ...validAudit,
  operationalReady: false,
  mode: "invalid",
  confidence: "none",
  failures: [{ code: "tail_invalid", detail: "new break" }],
});

function tradeFixture() {
  process.env.OKX_API_KEY = "audit-continuity-gate-key";
  const fingerprint = crypto.createHash("sha256").update(process.env.OKX_API_KEY).digest("hex").slice(0, 16);
  const now = new Date().toISOString();
  return {
    meta: { auditChainBroken: true },
    system: { liveTradingEnabled: true, realTradingAck: true, orderWriteEnabled: true, killSwitch: false },
    mandates: [{
      id: "m1", status: "active", version: 1, allowedSymbols: ["BTC/USDT"], allowedActions: ["open"],
      marketTypes: ["perpetual_usdt"], maxLeverage: 5, maxLeverageBySymbol: { "BTC/USDT": 5 },
      maxOrderNotionalUsdt: 100, maxSymbolNotionalUsdt: 150, maxPortfolioNotionalUsdt: 180,
      maxConcurrentPositions: 2, validFrom: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    }],
    positions: [],
    markets: [{ symbol: "BTC/USDT", price: 100 }],
    apiKeyMetadata: [{ exchange: "OKX", withdrawPermission: false, permissionVerifiedAt: now }],
    accountSnapshots: [{
      id: "snapshot", accountId: "okx-main", apiKeyFingerprint: fingerprint, exchange: "OKX", status: "ok", createdAt: now,
      positions: [], openOrders: [], algoOrders: [], openOrdersComplete: true, algoOrdersComplete: true,
      balances: [{ totalEq: "1000", details: [{ ccy: "USDT", availEq: "1000" }] }],
    }],
    grayReleasePolicies: [{ id: "g1", enabled: true, requiresManualApproval: true, maxNotionalUsdt: 100 }],
    auditLogs: [], executionOrders: [], reconciliationReports: [],
    exchangeAccounts: [{ id: "okx-main", exchange: "OKX", readEnabled: true, tradeEnabled: true, apiKeyFingerprint: fingerprint }],
    realtimeConnections: [],
  };
}

const entryPayload = {
  exchange: "OKX", marketType: "perpetual_usdt", symbol: "BTC/USDT", side: "BUY", price: 100, quantity: 0.5,
  stopLoss: 95, leverage: 2, clientOrderId: "coid1", agentRunId: "a1", analysisBundleId: "b1",
  tradePlanId: "p1", riskCheckId: "r1", mandateId: "m1", manualApproval: true,
};

test("non-risk-reducing writes accept only a current operational audit result", () => {
  const previousRequire = process.env.REQUIRE_AUDIT_CHAIN_OK;
  delete process.env.REQUIRE_AUDIT_CHAIN_OK;
  try {
    const valid = validateWriteGuard(tradeFixture(), "place_order", entryPayload, { auditStatus: validAudit });
    assert.notEqual(valid.reason, "audit_chain_invalid");
    const invalid = validateWriteGuard(tradeFixture(), "place_order", entryPayload, { auditStatus: invalidAudit });
    assert.equal(invalid.reason, "audit_chain_invalid");
    assert.equal(invalid.failures[0].code, "tail_invalid");
  } finally {
    if (previousRequire === undefined) delete process.env.REQUIRE_AUDIT_CHAIN_OK;
    else process.env.REQUIRE_AUDIT_CHAIN_OK = previousRequire;
  }
});

test("risk-reducing emergency action remains independent of the audit exception", () => {
  const db = tradeFixture();
  db.system.killSwitch = true;
  db.accountSnapshots[0].openOrders = [{ ordId: "order-1", clOrdId: "entry123", instId: "BTC-USDT-SWAP", reduceOnly: false, state: "live" }];
  const result = validateWriteGuard(db, "cancel_order", {
    exchange: "OKX", symbol: "BTC/USDT", orderId: "order-1", clientOrderId: "entry123", emergencyActionId: "emergency_audit_1",
  }, { auditStatus: invalidAudit });
  assert.equal(result.allowed, true, JSON.stringify(result));
  assert.equal(result.riskReducing, true);
});

function operatingFixture() {
  const now = new Date().toISOString();
  return {
    meta: { auditChainBroken: true, auditContinuityReady: true },
    user: { id: "owner", tenantId: "tenant_owner" },
    users: [{ id: "owner", isOwner: true, mfaEnabled: true }],
    system: { liveTradingEnabled: false, autonomyEnabled: true, orderWriteEnabled: false, killSwitch: false, professionalRiskMode: true },
    portfolio: { totalEquityUsdt: 1000 },
    positions: [], orders: [], executionOrders: [], auditLogs: [], traces: [], riskIncidents: [],
    markets: [{ symbol: "BTC/USDT", price: 100, updatedAt: now }],
    mandates: [{ id: "m1", status: "active", allowedSymbols: ["BTC/USDT"] }],
    grayReleasePolicies: [{ id: "g1", enabled: true, requiresManualApproval: true, maxNotionalUsdt: 50 }],
    accountSnapshots: [{ id: "snapshot", exchange: "OKX", status: "ok", createdAt: now }],
    reconciliationReports: [{ id: "recon", status: "ok", createdAt: now }],
    exchangeAccounts: [], realtimeConnections: [], apiKeyMetadata: [], notifications: [],
  };
}

test("autonomous blocker and professional degradation use effective continuity without hiding other reasons", () => {
  const db = operatingFixture();
  const validBlockers = autonomousProductionBlockers(db, { allowModeToEnableSafety: true, auditStatus: validAudit });
  const invalidBlockers = autonomousProductionBlockers(db, { allowModeToEnableSafety: true, auditStatus: invalidAudit });
  assert.equal(validBlockers.includes("本地审计链校验失败"), false);
  assert.equal(invalidBlockers.includes("本地审计链校验失败"), true);

  const validRisk = assessOperationalDegradation(db, { auditStatus: validAudit });
  const invalidRisk = assessOperationalDegradation(db, { auditStatus: invalidAudit });
  assert.equal(validRisk.reasons.includes("audit_chain_invalid"), false);
  assert.equal(invalidRisk.reasons.includes("audit_chain_invalid"), true);
  assert.deepEqual(invalidRisk.reasons.filter((reason) => reason !== "audit_chain_invalid"), validRisk.reasons);
});

test("SQLite-backed production state never trusts a cached auditContinuityReady flag", () => {
  const db = operatingFixture();
  Object.defineProperty(db, "__sqliteBacked", { value: true, enumerable: false });
  Object.defineProperty(db, "__sqlitePath", { value: "/private/tmp/does-not-exist-audit-continuity.sqlite", enumerable: false });
  const blockers = autonomousProductionBlockers(db, { allowModeToEnableSafety: true });
  assert.equal(blockers.includes("本地审计链校验失败"), true);
});

test("a scoped non-backed production view cannot self-authorize from cached audit metadata", () => {
  const db = operatingFixture();
  Object.defineProperty(db, "__sqliteBacked", { value: true, enumerable: false });
  Object.defineProperty(db, "__sqlitePath", { value: "/private/tmp/does-not-exist-audit-continuity.sqlite", enumerable: false });
  const { scoped } = buildOverviewPrincipalScope(db, {
    tenantId: "tenant_owner",
    userId: "owner",
    isOwner: true,
  });

  assert.equal(scoped.__sqliteBacked, undefined);
  const status = effectiveAuditOperationalStatus(scoped);
  assert.equal(status.operationalReady, false);
  assert.ok(status.failures.some((failure) => failure.code === "audit_status_unverified"));
});

test("scoped risk, professional, and automation builders use an explicitly verified current audit status", () => {
  const scoped = operatingFixture();
  const now = Date.now();
  const invalidRisk = buildCurrentRiskSnapshot(scoped, now, { auditStatus: invalidAudit });
  const validRisk = buildCurrentRiskSnapshot(scoped, now, { auditStatus: validAudit });
  assert.equal(invalidRisk.operationalDegradation.reasons.includes("audit_chain_invalid"), true);
  assert.equal(validRisk.operationalDegradation.reasons.includes("audit_chain_invalid"), false);

  const invalidProfessional = buildProfessionalSnapshot(scoped, { auditStatus: invalidAudit });
  const validProfessional = buildProfessionalSnapshot(scoped, { auditStatus: validAudit });
  assert.equal(invalidProfessional.permissionEvidence.checks.find((item) => item.key === "audit").passed, false);
  assert.equal(validProfessional.permissionEvidence.checks.find((item) => item.key === "audit").passed, true);

  scoped.system.liveTradingEnabled = true;
  scoped.system.realTradingAck = true;
  scoped.system.orderWriteEnabled = true;
  scoped.system.requestedOperatingMode = "full_auto";
  scoped.system.remainingDailyLossUsdt = 100;
  scoped.apiKeyMetadata = [{ exchange: "OKX", hasApiKey: true, hasSecret: true, withdrawPermission: false, permissionVerifiedAt: new Date(now).toISOString() }];
  scoped.grayReleasePolicies[0].requiresManualApproval = false;
  const invalidAutomation = deriveAutomationState(scoped, { hasProvider: true, auditStatus: invalidAudit });
  const validAutomation = deriveAutomationState(scoped, { hasProvider: true, auditStatus: validAudit });
  assert.equal(invalidAutomation.blockers.includes("运行降级:audit_chain_invalid"), true);
  assert.equal(validAutomation.blockers.includes("运行降级:audit_chain_invalid"), false);
});

test("trading permission evidence describes local continuity without calling legacy history normal", () => {
  const evidence = buildTradingPermissionEvidence(operatingFixture(), { auditStatus: validAudit });
  const audit = evidence.checks.find((item) => item.key === "audit");
  assert.equal(audit.passed, true);
  assert.match(audit.evidence, /仅本地完整性/);
  assert.doesNotMatch(audit.evidence, /^正常$/);

  const invalid = buildTradingPermissionEvidence(operatingFixture(), { auditStatus: invalidAudit });
  assert.equal(invalid.checks.find((item) => item.key === "audit").passed, false);
});

test("ops readiness uses operational continuity and keeps the assurance limitation visible", () => {
  const report = buildReadinessReport(operatingFixture(), { auditStatus: validAudit, nowMs: Date.now() });
  const audit = report.checks.find((item) => item.key === "audit_chain");
  assert.equal(audit.configured, true);
  assert.match(audit.note, /legacy_forensic_integrity_limited/);
  assert.match(audit.note, /local_integrity_only/);
  assert.match(audit.note, /external attestation/i);
});

test("audit status route preserves raw failure and adds operational evidence", () => {
  const routes = new Map();
  const app = {
    get(route, ...handlers) { routes.set(route, handlers.at(-1)); },
    post() {}, delete() {},
  };
  const payload = {
    ok: false, checked: 70548, breaks: [{ id: "legacy-break" }],
    operationalReady: true, mode: validAudit.mode, confidence: validAudit.confidence,
    externalAttestation: "deferred",
    legacy: { classification: "legacy_forensic_integrity_limited", storedLinkBreaks: 674, breakIslands: 282 },
    tail: { fromRowidExclusive: 127399, valid: true, rowsChecked: 10 }, failures: [],
  };
  registerSecurityConfigRoutes(app, {
    db: operatingFixture(),
    requirePermission: () => (_req, _res, next) => next(),
    auditChainStatus: () => payload,
  });
  const res = { value: null, json(value) { this.value = value; return this; } };
  routes.get("/api/security/audit-chain")({}, res);
  assert.deepEqual(res.value, payload);
  assert.equal(res.value.ok, false);
  assert.equal(res.value.operationalReady, true);
});
