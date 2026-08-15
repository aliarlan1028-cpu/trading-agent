import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "oms-secrets-"));
const { getOmsOrder, reserveOmsOrder, transitionOmsOrder } = await import("../server/store.mjs");
const { guardedPrivateExchangeAction } = await import("../server/exchangeConnector.mjs");

const payload = {
  symbol: "BTC/USDT",
  quantity: 1,
  apiKey: "K_VISIBLE",
  api_secret: "S_VISIBLE",
  Authorization: "Bearer SECRET_VISIBLE",
  nested: [{ authorization: "Bearer NESTED_VISIBLE", pass_phrase: "PHRASE_VISIBLE" }],
  callback: "https://example.test/cb?access_token=QUERY_VISIBLE"
};

test("private action summaries deep-scrub aliases, nested values and URL query credentials", () => {
  const result = guardedPrivateExchangeAction({ system: { liveTradingEnabled: false } }, "probe", payload);
  const encoded = JSON.stringify(result.payloadSummary);
  for (const value of ["K_VISIBLE", "S_VISIBLE", "SECRET_VISIBLE", "NESTED_VISIBLE", "PHRASE_VISIBLE", "QUERY_VISIBLE"]) {
    assert.equal(encoded.includes(value), false, value);
  }
  assert.equal(result.payloadSummary.symbol, "BTC/USDT");
  assert.equal(result.payloadSummary.quantity, 1);
});

test("OMS request/response docs never persist secrets and secrets do not affect the business idempotency hash", () => {
  const first = reserveOmsOrder({
    tenantId: "tenant", exchange: "OKX", clientOrderId: "secret-test-1", action: "place_order", payload
  });
  assert.equal(first.status, "reserved");
  const stored = getOmsOrder(first.order.id);
  const encodedRequest = JSON.stringify(stored.request);
  for (const value of ["K_VISIBLE", "S_VISIBLE", "SECRET_VISIBLE", "NESTED_VISIBLE", "PHRASE_VISIBLE", "QUERY_VISIBLE"]) {
    assert.equal(encodedRequest.includes(value), false, value);
  }

  const retry = reserveOmsOrder({
    tenantId: "tenant", exchange: "OKX", clientOrderId: "secret-test-1", action: "place_order",
    payload: {
      ...payload,
      apiKey: "DIFFERENT_KEY",
      api_secret: "DIFFERENT_SECRET",
      Authorization: "Bearer DIFFERENT_BEARER",
      nested: [{ authorization: "Bearer DIFFERENT_NESTED", pass_phrase: "DIFFERENT_PHRASE" }],
      callback: "https://example.test/cb?access_token=DIFFERENT_QUERY"
    }
  });
  assert.notEqual(retry.status, "conflict");

  transitionOmsOrder(first.order.id, "UNKNOWN", {
    eventType: "test_response",
    response: { api_secret: "RESPONSE_SECRET", nested: { authorization: "Bearer RESPONSE_BEARER" } }
  });
  const response = JSON.stringify(getOmsOrder(first.order.id).response);
  assert.equal(response.includes("RESPONSE_SECRET"), false);
  assert.equal(response.includes("RESPONSE_BEARER"), false);
});
