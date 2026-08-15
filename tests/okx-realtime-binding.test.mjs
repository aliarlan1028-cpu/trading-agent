import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { okxEnvironmentConfig } from "../server/okxEnvironment.mjs";
import { okxPrivateStreamBinding, upsertOkxOrder } from "../server/realtimeManager.mjs";
import { registerExchangeRoutes } from "../server/routes/exchange.mjs";

const ORIGINAL_KEY = process.env.OKX_API_KEY;
const ORIGINAL_DEMO = process.env.OKX_DEMO_TRADING;

function fingerprint(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

test.after(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.OKX_API_KEY; else process.env.OKX_API_KEY = ORIGINAL_KEY;
  if (ORIGINAL_DEMO === undefined) delete process.env.OKX_DEMO_TRADING; else process.env.OKX_DEMO_TRADING = ORIGINAL_DEMO;
});

test("OKX demo and production resolve REST/WS as a single explicit environment", () => {
  const production = okxEnvironmentConfig({});
  const demo = okxEnvironmentConfig({ OKX_DEMO_TRADING: "true" });
  assert.equal(production.name, "production");
  assert.match(production.privateWs, /^wss:\/\/ws\.okx\.com/);
  assert.match(production.publicWs, /^wss:\/\/ws\.okx\.com/);
  assert.equal(demo.name, "demo");
  assert.match(demo.privateWs, /^wss:\/\/wspap\.okx\.com/);
  assert.match(demo.publicWs, /^wss:\/\/wspap\.okx\.com/);
});

test("private WS requires exactly one read-authorized account bound to the current credential", () => {
  process.env.OKX_API_KEY = "key-a";
  const account = { id: "account-a", exchange: "OKX", readEnabled: true, tradeEnabled: false, apiKeyFingerprint: fingerprint("key-a") };
  const db = { exchangeAccounts: [account] };
  assert.equal(okxPrivateStreamBinding(db).ok, true);
  account.readEnabled = false;
  assert.equal(okxPrivateStreamBinding(db).reason, "private_ws_account_binding_required");
  account.readEnabled = true;
  process.env.OKX_API_KEY = "key-b";
  assert.equal(okxPrivateStreamBinding(db).reason, "private_ws_credential_mismatch");
});

test("environment/account/fingerprint changes invalidate delayed private messages", () => {
  process.env.OKX_API_KEY = "key-a";
  process.env.OKX_DEMO_TRADING = "false";
  const account = { id: "account-a", exchange: "OKX", readEnabled: true, apiKeyFingerprint: fingerprint("key-a") };
  const db = { exchangeAccounts: [account] };
  const expected = { accountId: "account-a", fingerprint: fingerprint("key-a"), environment: "production" };
  assert.equal(okxPrivateStreamBinding(db, expected).ok, true);
  process.env.OKX_DEMO_TRADING = "true";
  assert.equal(okxPrivateStreamBinding(db, expected).reason, "private_ws_environment_mismatch");
});

test("private order facts retain account, credential and environment binding", () => {
  const db = { orders: [], fills: [], executionOrders: [], tradePlans: [], positions: [], evidenceBundles: [] };
  upsertOkxOrder(db, { ordId: "order-1", instId: "BTC-USDT-SWAP", state: "live" }, {
    accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "demo"
  });
  assert.deepEqual(
    { accountId: db.orders[0].accountId, apiKeyFingerprint: db.orders[0].apiKeyFingerprint, environment: db.orders[0].environment },
    { accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "demo" }
  );
});

test("disabling account authorization forces the realtime generation to restart", () => {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "patch"]) app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers.at(-1));
  const account = { id: "account-a", exchange: "OKX", readEnabled: true, tradeEnabled: false, credentialPresent: true };
  const db = { user: { name: "Owner" }, exchangeAccounts: [account], apiKeyMetadata: [] };
  const restarts = [];
  registerExchangeRoutes(app, {
    db,
    persist(res, payload) { res.payload = payload; },
    saveDb() {},
    requirePermission: () => (_req, _res, next) => next(),
    id: () => "id",
    nowIso: () => "2026-08-15T00:00:00.000Z",
    appendAudit() {}, appendTrace() {},
    refreshApiKeyMetadata() {},
    startRealtimeManager(_db, _save, options) { restarts.push(options); }
  });
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } };
  routes.get("PATCH /api/exchange/accounts/:id")({ params: { id: account.id }, body: { readEnabled: false } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(account.readEnabled, false);
  assert.deepEqual(restarts, [{ force: true }]);
});
