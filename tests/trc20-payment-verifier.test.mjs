import assert from "node:assert/strict";
import test from "node:test";

import { allocateUniquePaymentAmount, USDT_TRC20_CONTRACT, verifyTrc20PaymentIntents } from "../server/trc20Payments.mjs";

const ADDRESS = "TReceiver";
const NOW = Date.parse("2026-08-15T12:00:00.000Z");

function payment(overrides = {}) {
  return {
    id: "pay_1", tenantId: "tenant_1", status: "pending", amount: 100.000001,
    exactAmount: true, amountIntentVersion: 1,
    createdAt: "2026-08-15T10:00:00.000Z", expiresAt: "2026-08-15T13:00:00.000Z",
    ...overrides
  };
}

function transfer(overrides = {}) {
  return {
    transaction_id: "tx_1",
    token_info: { address: USDT_TRC20_CONTRACT },
    to: ADDRESS,
    from: "TSender",
    value: "100000001",
    block_timestamp: Date.parse("2026-08-15T11:00:00.000Z"),
    confirmed: true,
    ...overrides
  };
}

function response(data, meta = {}) {
  return { ok: true, async json() { return { success: true, data, meta }; } };
}

function verifier(db, pages, extra = {}) {
  let call = 0;
  const claimed = new Map();
  return verifyTrc20PaymentIntents(db, {
    address: ADDRESS,
    nowMs: NOW,
    nowIso: () => new Date(NOW).toISOString(),
    fetchImpl: async (url) => {
      extra.urls?.push(String(url));
      return pages[call++] || response([]);
    },
    claimTransaction({ txid, paymentId }) {
      const existing = claimed.get(txid);
      if (existing && existing !== paymentId) return { claimed: false, paymentId: existing };
      claimed.set(txid, paymentId);
      return { claimed: true, txid, paymentId };
    },
    onConfirmed: extra.onConfirmed,
    saveDb: extra.saveDb
  });
}

test("all payment intents receive a globally unique exact six-decimal amount", () => {
  const db = { paymentRequests: [payment({ amount: 100.000001 })] };
  const next = allocateUniquePaymentAmount(db, 100);
  assert.equal(next, 100.000002);
});

test("a confirmed transfer is paged by fingerprint and matched only inside its intent window", async () => {
  const urls = [];
  const db = { paymentRequests: [payment()] };
  const result = await verifier(db, [response([], { fingerprint: "page-2" }), response([transfer()])], { urls });
  assert.equal(result.status, "ok");
  assert.equal(result.confirmed, 1);
  assert.equal(db.paymentRequests[0].status, "confirmed");
  assert.equal(db.paymentRequests[0].chainEvidence.blockTimestamp, transfer().block_timestamp);
  assert.match(urls[0], /only_confirmed=true/);
  assert.match(urls[0], /limit=200/);
  assert.match(urls[1], /fingerprint=page-2/);
});

test("an old same-amount transfer from before order creation cannot activate a new order", async () => {
  const db = { paymentRequests: [payment()] };
  const result = await verifier(db, [response([transfer({ block_timestamp: Date.parse("2026-08-15T09:59:59.999Z") })])]);
  assert.equal(result.confirmed, 0);
  assert.equal(db.paymentRequests[0].status, "pending");
});

test("same-amount concurrent legacy intents fail closed instead of assigning by array order", async () => {
  const db = { paymentRequests: [payment(), payment({ id: "pay_2" })] };
  const result = await verifier(db, [response([transfer()])]);
  assert.equal(result.status, "partial");
  assert.equal(result.ambiguous, 1);
  assert.deepEqual(db.paymentRequests.map((item) => item.status), ["pending", "pending"]);
});

test("unconfirmed, wrong-contract, wrong-address and post-expiry transfers never activate", async () => {
  for (const row of [
    transfer({ confirmed: false }),
    transfer({ token_info: { address: "TOtherToken" } }),
    transfer({ to: "TOtherReceiver" }),
    transfer({ block_timestamp: Date.parse("2026-08-15T13:00:00.001Z") })
  ]) {
    const db = { paymentRequests: [payment()] };
    const result = await verifier(db, [response([row])]);
    assert.equal(result.confirmed, 0);
    assert.equal(db.paymentRequests[0].status, "pending");
  }
});

test("pagination failure or a repeated cursor keeps every payment pending", async () => {
  const db = { paymentRequests: [payment()] };
  const result = await verifier(db, [response([transfer()], { fingerprint: "same" }), response([], { fingerprint: "same" })]);
  assert.equal(result.status, "failed");
  assert.equal(result.error, "trongrid_pagination_cursor_repeated");
  assert.equal(db.paymentRequests[0].status, "pending");
});
