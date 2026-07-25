import test from "node:test";
import assert from "node:assert/strict";
import {
  exchangeContractCapabilities,
  normalizeExchangeOrderState,
  validateExchangeOrderContract
} from "../server/exchangeContract.mjs";

test("new long and short entries require correctly placed native stops", () => {
  assert.equal(validateExchangeOrderContract("place_order", {
    exchange: "OKX", side: "BUY", price: 100, stopLoss: 99, quantity: 1
  }).ok, true);
  assert.equal(validateExchangeOrderContract("place_order", {
    exchange: "OKX", side: "BUY", price: 100, stopLoss: 101, quantity: 1
  }).reason, "long_stop_must_be_below_entry");
  assert.equal(validateExchangeOrderContract("place_order", {
    exchange: "BINANCE", side: "SELL", price: 100, stopLoss: 99, quantity: 1
  }).reason, "short_stop_must_be_above_entry");
});

test("exchange states normalize into the OMS vocabulary", () => {
  assert.equal(normalizeExchangeOrderState("BINANCE", "PARTIALLY_FILLED"), "PARTIAL");
  assert.equal(normalizeExchangeOrderState("OKX", "live"), "ACKNOWLEDGED");
  assert.equal(normalizeExchangeOrderState("OKX", "unexpected"), "UNKNOWN");
});

test("capabilities declare exchange-specific protection semantics", () => {
  assert.equal(exchangeContractCapabilities("BINANCE").nativeStop, "closePosition");
  assert.equal(exchangeContractCapabilities("OKX").nativeStop, "attachAlgoOrds");
});
