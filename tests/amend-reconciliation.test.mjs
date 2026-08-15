import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "amend-reconciliation-"));
process.env.OKX_API_KEY = "test-key";
process.env.OKX_API_SECRET = "test-secret";
process.env.OKX_API_PASSPHRASE = "test-passphrase";

const { getOmsOrder, reserveOmsOrder, seedDatabase, transitionOmsOrder } = await import("../server/store.mjs");
const { reconcileAmendOmsOrder, recoverUncertainOrders } = await import("../server/omsRecovery.mjs");
const { upsertOkxOrder } = await import("../server/realtimeManager.mjs");
const { executeOkxAction } = await import("../server/tradeActions.mjs");

let sequence = 0;
function pendingAmend(db, overrides = {}) {
  sequence += 1;
  const reqId = `amendreq${sequence}`;
  const reservation = reserveOmsOrder({
    tenantId: "tenant_owner",
    exchange: "OKX",
    clientOrderId: `amend_order:attempt${sequence}`,
    action: "amend_order",
    planId: "plan-1",
    payload: {
      accountId: "account-a", symbol: "BTC/USDT", marketType: "perpetual_usdt",
      authoritativeOrderId: `order-${sequence}`, clientOrderId: `entry-${sequence}`,
      amendRequestId: reqId, preparedAmendContracts: 8, preparedAmendPrice: 60_100,
      ...overrides
    }
  });
  transitionOmsOrder(reservation.order.id, "ACKNOWLEDGED", {
    eventType: "exchange_acknowledged",
    exchangeOrderId: `order-${sequence}`,
    response: { status: "amend_pending", reqId, desiredContracts: 8, desiredPrice: 60_100 }
  });
  db.orders.unshift({ id: `history-${sequence}`, type: "amend_order", omsOrderId: reservation.order.id, amendRequestId: reqId, status: "amend_pending" });
  return { id: reservation.order.id, reqId, orderId: `order-${sequence}` };
}

test("REST amend acknowledgement remains pending rather than final success", async () => {
  const writes = [];
  const result = await executeOkxAction("amend_order", {
    symbol: "BTC/USDT", marketType: "perpetual_usdt", authoritativeOrderId: "order-1",
    preparedAmendContracts: 8, preparedAmendPrice: 60_100, amendRequestId: "req1"
  }, { signedRequest: async (route, _method, body) => { writes.push({ route, body: JSON.parse(body) }); return { code: "0", data: [{ sCode: "0" }] }; } });
  assert.equal(result.status, "amend_pending");
  assert.equal(result.reqId, "req1");
  assert.equal(writes.length, 1);
});

test("matching amendResult=0 and authoritative targets finalize OMS as AMENDED", () => {
  const db = seedDatabase();
  const amend = pendingAmend(db);
  const result = reconcileAmendOmsOrder(db, getOmsOrder(amend.id), {
    exchangeOrderId: amend.orderId, reqId: amend.reqId, amendResult: "0", contracts: 8, price: 60_100
  });
  assert.equal(result.status, "amended");
  assert.equal(getOmsOrder(amend.id).state, "AMENDED");
  assert.equal(db.orders[0].status, "amended");
});

test("asynchronous amend failure and target mismatch never become success", () => {
  const db = seedDatabase();
  const failed = pendingAmend(db);
  const failedResult = reconcileAmendOmsOrder(db, getOmsOrder(failed.id), {
    exchangeOrderId: failed.orderId, reqId: failed.reqId, amendResult: "-1", contracts: 5, price: 60_000
  });
  assert.equal(failedResult.status, "amend_failed");
  assert.equal(getOmsOrder(failed.id).state, "REJECTED");

  const mismatch = pendingAmend(db);
  const mismatchResult = reconcileAmendOmsOrder(db, getOmsOrder(mismatch.id), {
    exchangeOrderId: mismatch.orderId, reqId: mismatch.reqId, amendResult: "0", contracts: 7, price: 60_100
  });
  assert.equal(mismatchResult.status, "amend_target_unconfirmed");
  assert.equal(getOmsOrder(mismatch.id).state, "UNKNOWN");
  assert.equal(db.system.reduceOnlyMode, true);
});

test("private orders WS amendResult closes the matching durable amend intent", () => {
  const db = seedDatabase();
  const amend = pendingAmend(db);
  upsertOkxOrder(db, {
    instId: "BTC-USDT-SWAP", ordId: amend.orderId, clOrdId: "entry-1", reqId: amend.reqId,
    amendResult: "0", state: "live", sz: "8", px: "60100", uTime: String(Date.now())
  }, { accountId: "account-a" });
  assert.equal(getOmsOrder(amend.id).state, "AMENDED");
  assert.equal(db.orders.find((row) => row.omsOrderId === amend.id).status, "amended");
});

test("restart recovery scans ACKNOWLEDGED amend intents and verifies final targets", async () => {
  const db = seedDatabase();
  const amend = pendingAmend(db);
  const result = await recoverUncertainOrders(db, {
    minAgeMs: -1,
    queryRemoteOrder: async (order) => order.id === amend.id
      ? { exchangeOrderId: amend.orderId, reqId: amend.reqId, amendResult: "0", contracts: 8, price: 60_100, state: "live" }
      : null
  });
  assert.ok(result.results.some((row) => row.id === amend.id && row.status === "amended"));
  assert.equal(getOmsOrder(amend.id).state, "AMENDED");
});

test("unconfirmed amend exceeds SLA into UNKNOWN and remains risk-visible", () => {
  const db = seedDatabase();
  const amend = pendingAmend(db);
  const result = reconcileAmendOmsOrder(db, getOmsOrder(amend.id), {
    exchangeOrderId: amend.orderId, reqId: amend.reqId, amendResult: "", contracts: 5, price: 60_000
  }, { amendTimeoutMs: -1 });
  assert.equal(result.status, "amend_unknown");
  assert.equal(getOmsOrder(amend.id).state, "UNKNOWN");
  assert.equal(db.system.reduceOnlyMode, true);
});
