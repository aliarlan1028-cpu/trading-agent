import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { okxEnvironmentConfig } from "../server/okxEnvironment.mjs";
import { okxPrivateStreamBinding, reconcilePendingOkxFillIdentities, upsertOkxOrder } from "../server/realtimeManager.mjs";
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

function externalFillDb() {
  return {
    user: { id: "owner", tenantId: "tenant_owner" },
    orders: [], fills: [], executionOrders: [], tradePlans: [], positions: [],
    evidenceBundles: [{ symbols: [{ symbol: "BTC/USDT", contractSpec: { data: { ctVal: 0.01 } } }] }]
  };
}

function externalFillPayload(overrides = {}) {
  return {
    ordId: "external-order",
    clOrdId: "",
    instId: "BTC-USDT-SWAP",
    instType: "SWAP",
    side: "sell",
    posSide: "long",
    reduceOnly: "true",
    state: "filled",
    fillSz: "1",
    accFillSz: "1",
    fillPx: "60000",
    fillPnl: "10",
    fee: "-0.01",
    feeCcy: "USDT",
    fillTime: "1786752000000",
    ...overrides
  };
}

test("external OKX fills retain authoritative order identity and account binding", () => {
  const db = externalFillDb();
  upsertOkxOrder(db, externalFillPayload({ tradeId: "trade-1" }), {
    accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "production"
  });

  assert.equal(db.fills.length, 1);
  assert.deepEqual({
    exchangeTradeId: db.fills[0].exchangeTradeId,
    exchangeOrderId: db.fills[0].exchangeOrderId,
    accountId: db.fills[0].accountId,
    apiKeyFingerprint: db.fills[0].apiKeyFingerprint,
    environment: db.fills[0].environment
  }, {
    exchangeTradeId: "trade-1",
    exchangeOrderId: "external-order",
    accountId: "account-a",
    apiKeyFingerprint: "fingerprint-a",
    environment: "production"
  });
  assert.deepEqual({
    scope: db.fills[0].tradeAttribution.scope,
    origin: db.fills[0].tradeAttribution.origin,
    executionOrderId: db.fills[0].tradeAttribution.executionOrderId
  }, { scope: "manual", origin: "external_exchange", executionOrderId: null });
});

test("external OKX fills retain the exact WS client and algo identities", () => {
  const db = externalFillDb();
  upsertOkxOrder(db, externalFillPayload({
    ordId: "external-algo-child-order",
    clOrdId: "external-client-order",
    algoClOrdId: "external-algo-client",
    algoId: "external-algo-id",
    tradeId: "external-algo-trade"
  }), {
    accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "production"
  });

  assert.equal(db.fills.length, 1);
  assert.deepEqual({
    exchangeOrderId: db.fills[0].exchangeOrderId,
    clientOrderId: db.fills[0].clientOrderId,
    algoClientOrderId: db.fills[0].algoClientOrderId,
    algoId: db.fills[0].algoId
  }, {
    exchangeOrderId: "external-algo-child-order",
    clientOrderId: "external-client-order",
    algoClientOrderId: "external-algo-client",
    algoId: "external-algo-id"
  });
});

test("an order update without an authoritative tradeId cannot create duplicate financial fills", () => {
  const db = externalFillDb();
  const context = { accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "production" };
  const payload = externalFillPayload({ tradeId: "" });

  upsertOkxOrder(db, payload, context);
  upsertOkxOrder(db, payload, context);

  assert.equal(db.fills.length, 0);
  assert.equal(db.orders[0].financialReconciliationStatus, "authoritative_trade_identity_missing");
});

test("OKX tradeId zero is an order-status sentinel, not an authoritative fill identity", () => {
  const db = externalFillDb();
  const context = { accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "production" };

  upsertOkxOrder(db, externalFillPayload({ tradeId: "0" }), context);
  upsertOkxOrder(db, externalFillPayload({ tradeId: "0" }), context);

  assert.equal(db.fills.length, 0);
  assert.equal(db.orders[0].financialReconciliationStatus, "authoritative_trade_identity_missing");
});

test("tradeId remains the strict dedupe key while distinct authoritative fills are retained", () => {
  const db = externalFillDb();
  const context = { accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "production" };

  upsertOkxOrder(db, externalFillPayload({ tradeId: "trade-1" }), context);
  upsertOkxOrder(db, externalFillPayload({ tradeId: "trade-1" }), context);
  upsertOkxOrder(db, externalFillPayload({ tradeId: "trade-2", accFillSz: "2", fillTime: "1786752000001" }), context);

  assert.deepEqual(db.fills.map((fill) => fill.exchangeTradeId).sort(), ["trade-1", "trade-2"]);
});

test("different external orders with blank clOrdId never share one local order identity", () => {
  const db = externalFillDb();
  const context = { accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "production" };

  upsertOkxOrder(db, externalFillPayload({ ordId: "external-order-1", clOrdId: "", tradeId: "trade-1" }), context);
  upsertOkxOrder(db, externalFillPayload({ ordId: "external-order-2", clOrdId: "", tradeId: "trade-2" }), context);

  assert.equal(db.orders.length, 2);
  assert.deepEqual(db.orders.map((order) => order.exchangeOrderId).sort(), ["external-order-1", "external-order-2"]);
  assert.deepEqual(db.fills.map((fill) => fill.exchangeOrderId).sort(), ["external-order-1", "external-order-2"]);
});

test("a pending WS observation is recovered from authoritative fills-history without duplicates", async () => {
  const db = externalFillDb();
  const context = { accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "production" };
  upsertOkxOrder(db, externalFillPayload({ tradeId: "" }), context);
  const paths = [];
  const options = {
    resolveBinding: () => ({ ok: true, account: { id: "account-a" }, fingerprint: "fingerprint-a", environment: "production" }),
    request: async (path) => {
      paths.push(path);
      return {
        code: "0",
        data: [{
          ordId: "external-order", tradeId: "trade-rest-1", instId: "BTC-USDT-SWAP", instType: "SWAP",
          side: "sell", posSide: "long", fillSz: "1", fillPx: "60000", fillPnl: "10",
          fee: "-0.01", feeCcy: "USDT", fillTime: "1786752000000"
        }]
      };
    }
  };

  const first = await reconcilePendingOkxFillIdentities(db, options);
  const second = await reconcilePendingOkxFillIdentities(db, options);

  assert.equal(first.reconciled, 1);
  assert.equal(second.checked, 0);
  assert.match(paths[0], /\/api\/v5\/trade\/fills-history\?/);
  assert.match(paths[0], /ordId=external-order/);
  assert.equal(db.fills.length, 1);
  assert.equal(db.fills[0].exchangeTradeId, "trade-rest-1");
  assert.equal(db.fills[0].exchangeOrderId, "external-order");
  assert.equal(db.orders[0].financialReconciliationStatus, undefined);
});

test("a later identified partial fill cannot hide an earlier unidentified fill on the same order", async () => {
  const db = externalFillDb();
  const context = { accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "production" };
  upsertOkxOrder(db, externalFillPayload({ tradeId: "", accFillSz: "1" }), context);
  upsertOkxOrder(db, externalFillPayload({
    tradeId: "trade-2", accFillSz: "2", fillTime: "1786752000001"
  }), context);

  assert.equal(db.fills.length, 1);
  assert.equal(db.orders[0].financialReconciliationStatus, "authoritative_trade_identity_missing");

  const result = await reconcilePendingOkxFillIdentities(db, {
    resolveBinding: () => ({ ok: true, account: { id: "account-a" }, fingerprint: "fingerprint-a", environment: "production" }),
    request: async () => ({
      code: "0",
      data: [
        { ...externalFillPayload({ tradeId: "trade-2", accFillSz: "2", fillTime: "1786752000001" }) },
        { ...externalFillPayload({ tradeId: "trade-1", accFillSz: "1" }) }
      ]
    })
  });

  assert.equal(result.reconciled, 1);
  assert.deepEqual(db.fills.map((fill) => fill.exchangeTradeId).sort(), ["trade-1", "trade-2"]);
  assert.equal(db.orders[0].financialReconciliationStatus, undefined);
});

test("incomplete authoritative fill evidence stays fail-closed", async () => {
  const db = externalFillDb();
  upsertOkxOrder(db, externalFillPayload({ tradeId: "" }), {
    accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "production"
  });

  const result = await reconcilePendingOkxFillIdentities(db, {
    resolveBinding: () => ({ ok: true, account: { id: "account-a" }, fingerprint: "fingerprint-a", environment: "production" }),
    request: async () => ({ code: "0", data: [{ ordId: "external-order", tradeId: "", fillSz: "1" }] })
  });

  assert.equal(result.reconciled, 0);
  assert.equal(db.fills.length, 0);
  assert.equal(db.orders[0].financialReconciliationStatus, "authoritative_trade_identity_missing");
});

test("a tradeId without complete size, price, and exchange time cannot clear the pending observation", async () => {
  const db = externalFillDb();
  upsertOkxOrder(db, externalFillPayload({ tradeId: "" }), {
    accountId: "account-a", apiKeyFingerprint: "fingerprint-a", environment: "production"
  });

  const result = await reconcilePendingOkxFillIdentities(db, {
    resolveBinding: () => ({ ok: true, account: { id: "account-a" }, fingerprint: "fingerprint-a", environment: "production" }),
    request: async () => ({
      code: "0",
      data: [{
        ordId: "external-order", tradeId: "trade-rest-incomplete", instId: "BTC-USDT-SWAP",
        fillSz: "1", fillPx: "", fillTime: "1786752000000"
      }]
    })
  });

  assert.equal(result.reconciled, 0);
  assert.equal(db.fills.length, 0);
  assert.equal(db.orders[0].financialReconciliationStatus, "authoritative_trade_identity_missing");
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
