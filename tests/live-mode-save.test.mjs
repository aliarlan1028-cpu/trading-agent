import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "live-mode-save-test-"));
process.env.PRODUCTION_SECURITY_PROFILE = "bitlaunch_single_server";
process.env.OPENROUTER_API_KEY = "test-openrouter-key";
process.env.DEEPSEEK_API_KEY = "test-deepseek-key";
delete process.env.REQUIRE_MFA_FOR_LIVE;

const { registerSecurityConfigRoutes } = await import("../server/routes/securityConfig.mjs");

function fixture() {
  return {
    user: { name: "Owner" },
    system: { autonomyEnabled: true, liveTradingEnabled: true, realTradingAck: true, orderWriteEnabled: true, professionalRiskMode: true },
    runtimeConfig: {},
    grayReleasePolicies: [{ id: "gray_live_small_notional", enabled: true, requiresManualApproval: false, maxNotionalUsdt: 200 }],
    mandates: [{ id: "m1", status: "active", version: 1, validUntil: new Date(Date.now() + 86400000).toISOString() }],
    apiKeyMetadata: [{ exchange: "OKX", hasApiKey: true, hasSecret: true, withdrawPermission: false, permissionVerifiedAt: new Date().toISOString() }],
    exchangeAccounts: [{ id: "okx", exchange: "OKX", readEnabled: true }],
    realtimeConnections: [{ exchange: "OKX", streamType: "private_user", status: "disconnected" }],
    reconciliationReports: [{ id: "r1", status: "needs_attention", createdAt: new Date().toISOString() }],
    executionOrders: [],
    auditLogs: [],
    traces: []
  };
}

function liveHandler(db) {
  const routes = new Map();
  const app = {
    get() {}, delete() {},
    post(route, ...handlers) { routes.set(route, handlers.at(-1)); }
  };
  registerSecurityConfigRoutes(app, {
    db,
    requirePermission: () => (_req, _res, next) => next(),
    setConfig(database, entries) {
      database.runtimeConfig ||= {};
      Object.assign(database.runtimeConfig, entries);
      for (const [key, value] of Object.entries(entries)) process.env[key] = String(value);
      return Object.keys(entries);
    },
    nowIso: () => new Date().toISOString(),
    appendAudit() {}, appendTrace() {}, saveDb() {},
    getConfigStatus: () => ({ liveTrading: {} })
  });
  return routes.get("/api/config/live-trading");
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

test("对账和私有 WS 临时异常不再让自动交易配置保存失败", () => {
  const db = fixture();
  const res = response();
  liveHandler(db)({
    body: { requestedMode: "full_auto", acknowledged: true, maxNotionalUsdt: 200 },
    user: { name: "Owner", mfaEnabled: false }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.system.requestedOperatingMode, "full_auto");
  assert.equal(db.system.liveTradingEnabled, true);
  assert.equal(db.grayReleasePolicies[0].requiresManualApproval, false);
  assert.deepEqual(res.payload.pendingBlockers, ["OKX 私有 WebSocket 未连接", "OKX 账户对账未通过"]);
});

test("缺少有效交易权限仍然拒绝自动交易，且不写入期望模式", () => {
  const db = fixture();
  db.mandates = [];
  const res = response();
  liveHandler(db)({ body: { requestedMode: "full_auto", acknowledged: true }, user: { name: "Owner" } }, res);
  assert.equal(res.statusCode, 412);
  assert.equal(db.system.requestedOperatingMode, undefined);
  assert.ok(res.payload.blockers.includes("没有当前有效的 OKX Mandate"));
});
