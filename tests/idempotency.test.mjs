import test from "node:test";
import assert from "node:assert/strict";
import { findDuplicateClientOrder } from "../server/tradeActions.mjs";

test("client order ids remain idempotent after terminal states", () => {
  const db = { orders: [{ id: "o1", clientOrderId: "stable-1", status: "filled" }] };
  assert.equal(findDuplicateClientOrder(db, { clientOrderId: "stable-1" })?.id, "o1");
});

test("missing client order id cannot accidentally match another order", () => {
  assert.equal(findDuplicateClientOrder({ orders: [{ id: "o1" }] }, {}), null);
});
