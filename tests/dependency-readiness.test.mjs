import assert from "node:assert/strict";
import crypto from "node:crypto";
import { after, test } from "node:test";

import * as ops from "../server/ops.mjs";
import { runReconciler } from "../server/reconciler.mjs";
import { registerSystemRoutes } from "../server/routes/system.mjs";

const originalEnv = {
  OKX_API_KEY: process.env.OKX_API_KEY,
  OKX_API_SECRET: process.env.OKX_API_SECRET,
  OKX_API_PASSPHRASE: process.env.OKX_API_PASSPHRASE,
  OKX_DEMO_TRADING: process.env.OKX_DEMO_TRADING
};

process.env.OKX_API_KEY = "readiness-test-key";
process.env.OKX_API_SECRET = "readiness-test-secret";
process.env.OKX_API_PASSPHRASE = "readiness-test-passphrase";
process.env.OKX_DEMO_TRADING = "false";

after(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const fingerprint = crypto.createHash("sha256").update("readiness-test-key").digest("hex").slice(0, 16);
const verifiedAuditStatus = Object.freeze({
  operationalReady: true,
  mode: "full_chain",
  confidence: "full_chain_local",
  legacyChainOk: true,
  externalAttestation: "deferred",
  failures: []
});

function readyDb(nowMs = Date.now()) {
  const now = new Date(nowMs).toISOString();
  return {
    system: {},
    user: { id: "owner", tenantId: "tenant_owner" },
    users: [],
    exchangeAccounts: [{
      id: "okx-main",
      exchange: "OKX",
      readEnabled: true,
      tradeEnabled: true,
      apiKeyFingerprint: fingerprint,
      readSyncStatus: "ok",
      lastReadSyncAt: now
    }],
    realtimeConnections: [
      {
        id: "okx-public",
        exchange: "OKX",
        streamType: "public_market",
        status: "connected",
        lastMessageAt: now
      },
      {
        id: "okx-private",
        exchange: "OKX",
        streamType: "private_user",
        status: "connected",
        accountId: "okx-main",
        environment: "production",
        authenticatedAt: now,
        subscribedAt: now,
        authenticatedCredentialFingerprint: fingerprint
      }
    ],
    accountSnapshots: [{
      id: "snapshot-ready",
      exchange: "OKX",
      accountId: "okx-main",
      apiKeyFingerprint: fingerprint,
      environment: "production",
      status: "ok",
      balances: [{ totalEq: "1000", details: [{ ccy: "USDT", availEq: "900" }] }],
      positions: [],
      openOrders: [],
      algoOrders: [],
      openOrdersComplete: true,
      algoOrdersComplete: true,
      createdAt: now
    }],
    reconciliationReports: [{ id: "recon-ready", status: "ok", differences: [], createdAt: now }],
    tasks: [{
      id: "task_sys_market_signal",
      handler: "market_signal_refresh",
      status: "完成",
      lastRunAt: now,
      lastError: null,
      failureCount: 0
    }],
    executionOrders: [],
    positions: [],
    orders: [],
    tradePlans: [],
    armedSetups: [],
    opportunityCandidates: [],
    riskIncidents: [],
    auditLogs: [],
    traces: [],
    grayReleasePolicies: []
  };
}

function report(db, nowMs = Date.now(), overrides = {}) {
  return ops.buildReadinessReport(db, {
    now: nowMs,
    omsOrders: [],
    storageStatus: { ready: true, accessible: true, writable: true, integrity: "ok" },
    ...overrides
  });
}

test("public readiness becomes false after a formerly healthy stream disconnects and goes stale", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  const publicConnection = db.realtimeConnections.find((item) => item.streamType === "public_market");
  publicConnection.status = "reconnecting";
  publicConnection.lastMessageAt = new Date(nowMs - 18 * 60 * 60_000).toISOString();

  const result = report(db, nowMs);

  assert.equal(result.ready, false);
  assert.equal(result.dependencies.public_market.ready, false);
  assert.match(result.dependencies.public_market.status, /stale|reconnecting|disconnected/);

  publicConnection.status = "connected";
  publicConnection.lastMessageAt = new Date(nowMs).toISOString();
  const recovered = report(db, nowMs);
  assert.equal(recovered.dependencies.public_market.ready, true);
  assert.equal(recovered.ready, true);
});

test("public readiness is true only for a connected stream with fresh messages", () => {
  const nowMs = Date.now();
  const result = report(readyDb(nowMs), nowMs);

  assert.equal(result.dependencies.public_market.ready, true);
  assert.equal(result.dependencies.public_market.status, "ready");
});

test("connected public stream with an old last message is stale rather than ready", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.realtimeConnections.find((item) => item.streamType === "public_market").lastMessageAt = new Date(nowMs - 181_000).toISOString();

  const result = report(db, nowMs);

  assert.equal(result.dependencies.public_market.ready, false);
  assert.equal(result.dependencies.public_market.status, "stale");
});

test("private readiness is false when the private stream is disconnected or unauthenticated", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  const privateConnection = db.realtimeConnections.find((item) => item.streamType === "private_user");
  privateConnection.status = "reconnecting";
  privateConnection.authenticatedAt = null;
  privateConnection.subscribedAt = null;

  const result = report(db, nowMs);

  assert.equal(result.dependencies.private_user.ready, false);
  assert.notEqual(result.dependencies.private_user.status, "ready");
});

test("connected private stream without completed authentication is not ready", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  const privateConnection = db.realtimeConnections.find((item) => item.streamType === "private_user");
  privateConnection.authenticatedAt = null;
  privateConnection.subscribedAt = null;

  const result = report(db, nowMs);

  assert.equal(result.dependencies.private_user.ready, false);
  assert.equal(result.dependencies.private_user.status, "unauthenticated");
});

test("private readiness is true for an authenticated stream bound to the current account and environment", () => {
  const nowMs = Date.now();
  const result = report(readyDb(nowMs), nowMs);

  assert.equal(result.dependencies.private_user.ready, true);
  assert.equal(result.dependencies.private_user.status, "ready");
});

test("stale account snapshot is not ready", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.accountSnapshots[0].createdAt = new Date(nowMs - 11 * 60_000).toISOString();

  const result = report(db, nowMs);

  assert.equal(result.dependencies.account_snapshot.ready, false);
  assert.equal(result.dependencies.account_snapshot.status, "stale");
});

test("fresh complete account snapshot with current binding is ready", () => {
  const nowMs = Date.now();
  const result = report(readyDb(nowMs), nowMs);

  assert.equal(result.dependencies.account_snapshot.ready, true);
  assert.equal(result.dependencies.account_snapshot.status, "ready");
});

test("fresh but incomplete authoritative order snapshot is not ready", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.accountSnapshots[0].algoOrdersComplete = false;

  const result = report(db, nowMs);

  assert.equal(result.dependencies.account_snapshot.ready, false);
  assert.equal(result.dependencies.account_snapshot.status, "incomplete");
});

test("account readiness rejects missing, blank, non-numeric, and non-finite position quantities", async (t) => {
  const invalidPositions = [
    ["empty pos", { pos: "", contractSize: null, coinSize: null, positionQuantityComplete: false }],
    ["blank pos", { pos: "   ", contractSize: null, coinSize: null, positionQuantityComplete: false }],
    ["null quantity", { pos: null, contractSize: null, size: null, coinSize: null, positionQuantityComplete: false }],
    ["undefined quantity", { pos: undefined, contractSize: undefined, size: undefined, coinSize: null, positionQuantityComplete: false }],
    ["non-numeric pos", { pos: "abc", contractSize: null, coinSize: null, positionQuantityComplete: false }],
    ["NaN pos", { pos: Number.NaN, contractSize: null, coinSize: null, positionQuantityComplete: false }],
    ["infinite pos", { pos: Number.POSITIVE_INFINITY, contractSize: null, coinSize: null, positionQuantityComplete: false }],
    ["negative infinite pos", { pos: Number.NEGATIVE_INFINITY, contractSize: null, coinSize: null, positionQuantityComplete: false }],
    ["empty coin size", { pos: "1", positionQuantityComplete: true, coinSize: "" }],
    ["blank coin size", { pos: "1", positionQuantityComplete: true, coinSize: "   " }]
  ];

  for (const [name, position] of invalidPositions) {
    await t.test(name, () => {
      const nowMs = Date.now();
      const db = readyDb(nowMs);
      db.accountSnapshots[0].positions = [position];
      const result = report(db, nowMs);
      assert.equal(result.dependencies.account_snapshot.ready, false);
      assert.equal(result.dependencies.account_snapshot.status, "incomplete");
      assert.equal(result.ready, false);
    });
  }
});

test("account readiness accepts explicit zero and complete finite position quantities", async (t) => {
  const validPositions = [
    ["numeric zero", { pos: 0, positionQuantityComplete: true, coinSize: null }],
    ["string zero", { pos: "0", positionQuantityComplete: true, coinSize: null }],
    ["positive contracts", { pos: "1", positionQuantityComplete: true, coinSize: "0.01" }],
    ["negative contracts", { pos: "-1", positionQuantityComplete: true, coinSize: "0.01" }],
    ["fractional contracts", { pos: "0.5", positionQuantityComplete: true, coinSize: "0.005" }],
    ["normalized contract fallback", { pos: null, contractSize: "1", positionQuantityComplete: true, coinSize: "0.01" }],
    ["size fallback", { pos: undefined, contractSize: undefined, size: "1", positionQuantityComplete: true, coinSize: "0.01" }]
  ];

  for (const [name, position] of validPositions) {
    await t.test(name, () => {
      const nowMs = Date.now();
      const db = readyDb(nowMs);
      db.accountSnapshots[0].positions = [position];
      const result = report(db, nowMs);
      assert.equal(result.dependencies.account_snapshot.ready, true);
      assert.equal(result.ready, true);
    });
  }
});

test("account readiness recovers when an incomplete position snapshot becomes complete", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.accountSnapshots[0].positions = [{ pos: "", contractSize: null, coinSize: null, positionQuantityComplete: false }];

  const invalid = report(db, nowMs);
  db.accountSnapshots[0].positions = [{ pos: "1", positionQuantityComplete: true, coinSize: "0.01" }];
  const recovered = report(db, nowMs);

  assert.equal(invalid.dependencies.account_snapshot.ready, false);
  assert.equal(invalid.ready, false);
  assert.equal(recovered.dependencies.account_snapshot.ready, true);
  assert.equal(recovered.ready, true);
});

test("stale and failing reconciliation evidence is not ready", () => {
  const nowMs = Date.now();
  const staleDb = readyDb(nowMs);
  staleDb.reconciliationReports[0].createdAt = new Date(nowMs - 31 * 60_000).toISOString();
  const failingDb = readyDb(nowMs);
  failingDb.reconciliationReports[0].status = "needs_attention";

  assert.equal(report(staleDb, nowMs).dependencies.reconciliation.status, "stale");
  assert.equal(report(failingDb, nowMs).dependencies.reconciliation.status, "failed");
});

test("all production-required dependencies ready produces aggregate ready true", () => {
  const nowMs = Date.now();
  const result = report(readyDb(nowMs), nowMs);

  assert.equal(result.ready, true);
  assert.deepEqual(Object.values(result.dependencies).filter((item) => !item.ready), []);
});

test("readiness response identifies each failing dependency rather than returning only a boolean", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.realtimeConnections.find((item) => item.streamType === "public_market").status = "reconnecting";
  db.tasks[0].status = "失败";
  db.tasks[0].lastError = "OKX market REST unavailable";

  const result = report(db, nowMs);

  assert.equal(result.ready, false);
  assert.equal(result.dependencies.public_market.ready, false);
  assert.equal(result.dependencies.okx_rest.ready, false);
  assert.match(result.dependencies.okx_rest.reason, /REST|market|行情/i);
});

test("latest failed private REST attempt is not hidden by an older successful snapshot", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.accountSnapshots.push({
    ...db.accountSnapshots[0],
    id: "snapshot-failed-latest",
    status: "request_failed",
    createdAt: new Date(nowMs + 1).toISOString()
  });

  const result = report(db, nowMs);

  assert.equal(result.dependencies.account_snapshot.ready, true);
  assert.equal(result.dependencies.okx_rest.ready, false);
  assert.equal(result.dependencies.okx_rest.status, "failed");
});

test("canonical system market task failure is not hidden by a successful user task", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.tasks = [
    { id: "task_user_market", handler: "market_signal_refresh", systemManaged: false, status: "完成", lastRunAt: new Date(nowMs).toISOString() },
    { ...db.tasks[0], status: "失败" }
  ];

  const result = report(db, nowMs);

  assert.equal(result.dependencies.okx_rest.ready, false);
  assert.equal(result.dependencies.okx_rest.status, "failed");
  assert.equal(result.ready, false);
});

test("canonical system market task success ignores failing user duplicates regardless of order", () => {
  const nowMs = Date.now();
  const systemTask = readyDb(nowMs).tasks[0];
  const userTasks = [
    { id: "task_user_market_a", handler: "market_signal_refresh", systemManaged: false, status: "失败", lastRunAt: new Date(nowMs).toISOString() },
    { id: "task_user_market_b", handler: "market_signal_refresh", systemManaged: false, status: "等待", lastRunAt: new Date(nowMs).toISOString() }
  ];

  for (const tasks of [[...userTasks, systemTask], [...userTasks].reverse().concat(systemTask), [systemTask, ...userTasks]]) {
    const db = readyDb(nowMs);
    db.tasks = tasks;
    const result = report(db, nowMs);
    assert.equal(result.dependencies.okx_rest.ready, true);
    assert.equal(result.ready, true);
  }
});

test("canonical system market task readiness recovers after its later success", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  const systemTask = db.tasks[0];
  systemTask.status = "失败";
  db.tasks.unshift({ id: "task_user_market", handler: "market_signal_refresh", systemManaged: false, status: "完成", lastRunAt: new Date(nowMs).toISOString() });

  const failed = report(db, nowMs);
  systemTask.status = "完成";
  systemTask.lastRunAt = new Date(nowMs).toISOString();
  const recovered = report(db, nowMs);

  assert.equal(failed.dependencies.okx_rest.ready, false);
  assert.equal(failed.ready, false);
  assert.equal(recovered.dependencies.okx_rest.ready, true);
  assert.equal(recovered.ready, true);
});

test("current private REST credentials are required even with fresh historical success", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  delete process.env.OKX_API_KEY;
  delete process.env.OKX_API_SECRET;
  delete process.env.OKX_API_PASSPHRASE;
  try {
    const result = report(db, nowMs);
    assert.equal(result.dependencies.okx_rest.ready, false);
    assert.equal(result.dependencies.okx_rest.status, "credentials_missing");
    assert.equal(result.dependencies.private_user.ready, false);
    assert.equal(result.dependencies.private_user.status, "binding_mismatch");
    assert.equal(result.dependencies.account_snapshot.ready, false);
    assert.equal(result.dependencies.account_snapshot.status, "binding_mismatch");
  } finally {
    process.env.OKX_API_KEY = "readiness-test-key";
    process.env.OKX_API_SECRET = "readiness-test-secret";
    process.env.OKX_API_PASSPHRASE = "readiness-test-passphrase";
  }
});

test("private REST readiness requires each signed credential component to be present and non-blank", async (t) => {
  const cases = [
    ["missing secret", undefined, "readiness-test-passphrase"],
    ["missing passphrase", "readiness-test-secret", undefined],
    ["empty secret", "", "readiness-test-passphrase"],
    ["blank secret", "   ", "readiness-test-passphrase"],
    ["empty passphrase", "readiness-test-secret", ""],
    ["blank passphrase", "readiness-test-secret", "   "]
  ];

  for (const [name, secret, passphrase] of cases) {
    await t.test(name, () => {
      const nowMs = Date.now();
      const db = readyDb(nowMs);
      if (secret === undefined) delete process.env.OKX_API_SECRET;
      else process.env.OKX_API_SECRET = secret;
      if (passphrase === undefined) delete process.env.OKX_API_PASSPHRASE;
      else process.env.OKX_API_PASSPHRASE = passphrase;
      try {
        const result = report(db, nowMs);
        assert.equal(result.dependencies.okx_rest.ready, false);
        assert.equal(result.dependencies.okx_rest.status, "credentials_missing");
        assert.equal(result.ready, false);
        assert.equal(result.dependencies.private_user.ready, true);
        assert.equal(result.dependencies.account_snapshot.ready, true);
      } finally {
        process.env.OKX_API_SECRET = "readiness-test-secret";
        process.env.OKX_API_PASSPHRASE = "readiness-test-passphrase";
      }
    });
  }
});

test("private REST readiness recovers after missing signed credentials are restored", async (t) => {
  const cases = [
    ["secret recovery", "OKX_API_SECRET"],
    ["passphrase recovery", "OKX_API_PASSPHRASE"]
  ];

  for (const [name, missingKey] of cases) {
    await t.test(name, () => {
      const nowMs = Date.now();
      const db = readyDb(nowMs);
      delete process.env[missingKey];
      try {
        const missing = report(db, nowMs);
        process.env.OKX_API_SECRET = "readiness-test-secret";
        process.env.OKX_API_PASSPHRASE = "readiness-test-passphrase";
        const recovered = report(db, nowMs);

        assert.equal(missing.dependencies.okx_rest.ready, false);
        assert.equal(missing.ready, false);
        assert.equal(recovered.dependencies.okx_rest.ready, true);
        assert.equal(recovered.ready, true);
      } finally {
        process.env.OKX_API_SECRET = "readiness-test-secret";
        process.env.OKX_API_PASSPHRASE = "readiness-test-passphrase";
      }
    });
  }
});

test("read-only OKX capability remains sufficient for private REST readiness", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.exchangeAccounts[0].tradeEnabled = false;

  const result = report(db, nowMs);

  assert.equal(result.dependencies.okx_rest.ready, true);
  assert.equal(result.ready, true);
});

test("private REST readiness rejects credential rotation and recovers after correct rebinding", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  process.env.OKX_API_KEY = "readiness-rotated-key";
  const rotatedFingerprint = crypto.createHash("sha256").update(process.env.OKX_API_KEY).digest("hex").slice(0, 16);
  try {
    const mismatched = report(db, nowMs);
    db.exchangeAccounts[0].apiKeyFingerprint = rotatedFingerprint;
    db.accountSnapshots[0].apiKeyFingerprint = rotatedFingerprint;
    db.realtimeConnections.find((item) => item.streamType === "private_user").authenticatedCredentialFingerprint = rotatedFingerprint;
    const recovered = report(db, nowMs);

    assert.equal(mismatched.dependencies.okx_rest.ready, false);
    assert.equal(mismatched.ready, false);
    assert.equal(recovered.dependencies.okx_rest.ready, true);
    assert.equal(recovered.dependencies.private_user.ready, true);
    assert.equal(recovered.dependencies.account_snapshot.ready, true);
    assert.equal(recovered.ready, true);
  } finally {
    process.env.OKX_API_KEY = "readiness-test-key";
  }
});

test("private REST readiness rejects current account conflicts", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.exchangeAccounts.push({
    id: "okx-secondary",
    exchange: "OKX",
    readEnabled: true,
    tradeEnabled: false,
    apiKeyFingerprint: fingerprint
  });

  const result = report(db, nowMs);

  assert.equal(result.dependencies.okx_rest.ready, false);
  assert.equal(result.dependencies.okx_rest.status, "binding_mismatch");
});

test("private REST historical environment must match current production environment", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.accountSnapshots[0].environment = "demo";

  const result = report(db, nowMs);

  assert.equal(result.dependencies.okx_rest.ready, false);
  assert.equal(result.dependencies.okx_rest.status, "binding_mismatch");
  assert.equal(result.dependencies.private_user.ready, true);
  assert.equal(result.dependencies.account_snapshot.ready, false);
  assert.equal(result.dependencies.account_snapshot.status, "binding_mismatch");
});

test("old UNKNOWN OMS orders prevent readiness without changing recovery semantics", () => {
  const nowMs = Date.now();
  const result = report(readyDb(nowMs), nowMs, {
    omsOrders: [{ id: "oms-unknown", state: "UNKNOWN", updatedAt: new Date(nowMs - 31_000).toISOString() }]
  });

  assert.equal(result.dependencies.oms.ready, false);
  assert.equal(result.dependencies.oms.status, "blocked");
});

test("SQLite runtime failure is surfaced as a dependency failure", () => {
  const nowMs = Date.now();
  const result = report(readyDb(nowMs), nowMs, {
    storageStatus: { ready: false, accessible: true, writable: false, integrity: "ok", reason: "not_writable" }
  });

  assert.equal(result.dependencies.sqlite.ready, false);
  assert.equal(result.dependencies.sqlite.status, "failed");
});

test("liveness payload remains process-only and keeps its existing response contract", () => {
  assert.equal(typeof ops.buildLivenessReport, "function");
  assert.deepEqual(ops.buildLivenessReport("release-test"), { ok: true, release: "release-test" });
});

test("the existing authenticated system readiness route returns explainable dependency state", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.realtimeConnections.find((item) => item.streamType === "private_user").status = "disconnected";
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers); }
  };
  registerSystemRoutes(app, {
    db,
    persist() {},
    requirePermission() { return (_req, _res, next) => next?.(); },
    nowIso: () => new Date(nowMs).toISOString(),
    appendAudit() {},
    buildReadinessReport: (value) => report(value, nowMs),
    createSystemBackup: async () => ({}),
    resetOperationalData() {},
    getStorageInfo: () => ({})
  });
  let payload;

  routes.get("GET /api/system/readiness").at(-1)({}, { json(value) { payload = value; } });

  assert.equal(payload.ready, false);
  assert.equal(payload.dependencies.private_user.status, "disconnected");
});

test("readiness-only public disconnect diagnostics do not change reconciliation trading health", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  const publicConnection = db.realtimeConnections.find((item) => item.streamType === "public_market");
  publicConnection.status = "reconnecting";
  publicConnection.lastMessageAt = new Date(nowMs - 18 * 60 * 60_000).toISOString();
  db.system = { liveTradingEnabled: true, professionalRiskMode: true, reduceOnlyMode: false };

  const readiness = report(db, nowMs);
  db.reconciliationReports = [];
  const reconciliation = runReconciler(db, { mode: "readiness_test", auditStatus: verifiedAuditStatus });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.dependencies.public_market.ready, false);
  assert.equal(reconciliation.status, "ok");
  assert.equal(reconciliation.differences.some((item) => item.type.startsWith("realtime_")), false);
  assert.equal(db.system.operationalDegradation.reasons.includes("reconciliation_unhealthy"), false);
  assert.equal(db.system.reduceOnlyMode, false);
});

test("readiness-only public staleness does not change reconciliation trading health", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  db.realtimeConnections.find((item) => item.streamType === "public_market").lastMessageAt = new Date(nowMs - 181_000).toISOString();
  db.system = { liveTradingEnabled: true, professionalRiskMode: true, reduceOnlyMode: false };

  const readiness = report(db, nowMs);
  db.reconciliationReports = [];
  const reconciliation = runReconciler(db, { mode: "readiness_test", auditStatus: verifiedAuditStatus });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.dependencies.public_market.status, "stale");
  assert.equal(reconciliation.status, "ok");
  assert.equal(reconciliation.differences.some((item) => item.type === "realtime_stale"), false);
  assert.equal(db.system.operationalDegradation.reasons.includes("reconciliation_unhealthy"), false);
  assert.equal(db.system.reduceOnlyMode, false);
});

test("the pre-existing never-connected realtime reconciliation gate remains unchanged", () => {
  const nowMs = Date.now();
  const db = readyDb(nowMs);
  const publicConnection = db.realtimeConnections.find((item) => item.streamType === "public_market");
  publicConnection.status = "reconnecting";
  publicConnection.lastMessageAt = null;
  db.system = { liveTradingEnabled: true, professionalRiskMode: true, reduceOnlyMode: false };
  db.reconciliationReports = [];

  const reconciliation = runReconciler(db, { mode: "readiness_test", auditStatus: verifiedAuditStatus });

  assert.equal(reconciliation.status, "degraded");
  assert.equal(reconciliation.differences.some((item) => item.type === "realtime_not_connected"), true);
  assert.equal(db.system.operationalDegradation.reasons.includes("reconciliation_unhealthy"), true);
  assert.equal(db.system.reduceOnlyMode, true);
});
