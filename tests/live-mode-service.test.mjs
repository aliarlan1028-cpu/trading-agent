import assert from "node:assert/strict";
import test from "node:test";

import { applyLiveTradingConfiguration, liveConfigurationFingerprint } from "../server/liveModeService.mjs";

function fixture() {
  const now = new Date().toISOString();
  return {
    meta: {},
    system: { autonomyEnabled: true, liveTradingEnabled: false, realTradingAck: false, orderWriteEnabled: false, professionalRiskMode: true, killSwitch: false, requestedOperatingMode: "observe" },
    runtimeConfig: {},
    grayReleasePolicies: [{ id: "gray_live_small_notional", enabled: false, requiresManualApproval: true, maxNotionalUsdt: 50, allowedSymbols: ["BTC/USDT"] }],
    mandates: [{ id: "m1", status: "active", version: 1, validUntil: new Date(Date.now() + 86400000).toISOString() }],
    apiKeyMetadata: [{ exchange: "OKX", hasApiKey: true, hasSecret: true, withdrawPermission: false, permissionVerifiedAt: now }],
    exchangeAccounts: [{ id: "okx", exchange: "OKX", readEnabled: true }],
    realtimeConnections: [{ exchange: "OKX", streamType: "private_user", status: "connected" }],
    reconciliationReports: [{ status: "ok", createdAt: now }],
    executionOrders: [],
    auditLogs: []
  };
}

function context(overrides = {}) {
  return {
    user: { name: "Owner", mfaEnabled: true },
    actor: "Owner",
    setConfig(db, entries) { Object.assign(db.runtimeConfig, entries); },
    nowIso: () => "2026-08-15T00:00:00.000Z",
    ...overrides
  };
}

test("MFA-required live enable fails without changing runtime or database gates", () => {
  const previous = process.env.REQUIRE_MFA_FOR_LIVE;
  process.env.REQUIRE_MFA_FOR_LIVE = "true";
  try {
    const db = fixture();
    let writes = 0;
    const result = applyLiveTradingConfiguration(db, {
      liveTradingEnabled: true,
      acknowledged: true
    }, context({ user: { name: "Owner", mfaEnabled: false }, setConfig() { writes += 1; } }));
    assert.equal(result.status, 412);
    assert.equal(result.error, "mfa_required_for_live_trading");
    assert.equal(writes, 0);
    assert.equal(db.system.liveTradingEnabled, false);
    assert.equal(db.system.realTradingAck, false);
  } finally {
    if (previous === undefined) delete process.env.REQUIRE_MFA_FOR_LIVE;
    else process.env.REQUIRE_MFA_FOR_LIVE = previous;
  }
});

test("full-auto hard blockers fail before any live gate mutation", () => {
  const db = fixture();
  db.mandates = [];
  const result = applyLiveTradingConfiguration(db, {
    requestedMode: "full_auto",
    acknowledged: true
  }, context());
  assert.equal(result.status, 412);
  assert.equal(result.error, "autonomous_production_blocked");
  assert.ok(result.blockers.includes("没有当前有效的 OKX Mandate"));
  assert.equal(db.system.liveTradingEnabled, false);
  assert.deepEqual(db.runtimeConfig, {});
});

test("successful live configuration keeps runtime and persisted gates consistent", () => {
  const db = fixture();
  const result = applyLiveTradingConfiguration(db, {
    liveTradingEnabled: true,
    acknowledged: true
  }, context());
  assert.equal(result.ok, true);
  assert.equal(db.system.liveTradingEnabled, true);
  assert.equal(db.system.realTradingAck, true);
  assert.equal(db.runtimeConfig.LIVE_TRADING_ENABLED, "true");
  assert.equal(db.runtimeConfig.I_UNDERSTAND_REAL_TRADING, "true");

  const disabled = applyLiveTradingConfiguration(db, {
    liveTradingEnabled: false,
    acknowledged: false,
    orderWriteEnabled: false
  }, context());
  assert.equal(disabled.ok, true);
  assert.equal(db.system.liveTradingEnabled, false);
  assert.equal(db.system.realTradingAck, false);
  assert.equal(db.system.orderWriteEnabled, false);
  assert.equal(db.runtimeConfig.LIVE_TRADING_ENABLED, "false");
});

test("a confirmation snapshot cannot be replayed after live safety state changes", () => {
  const db = fixture();
  const expectedFingerprint = liveConfigurationFingerprint(db);
  db.system.killSwitch = true;
  const result = applyLiveTradingConfiguration(db, { liveTradingEnabled: true, acknowledged: true }, context({ expectedFingerprint }));
  assert.equal(result.status, 409);
  assert.equal(result.error, "live_config_changed_since_confirmation_request");
  assert.equal(db.system.liveTradingEnabled, false);
});
