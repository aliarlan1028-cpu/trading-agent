import assert from "node:assert/strict";
import test from "node:test";
import { prepareAmendOrderFacts, trustedEntryNotional } from "../server/tradeActions.mjs";

test("market entry notional ignores attacker supplied markPrice", () => {
  const result = trustedEntryNotional({ type: "MARKET", quantity: 10, markPrice: 0.000001 }, { price: 60_000 });
  assert.equal(result.allowed, true);
  assert.equal(result.riskPrice, 60_600);
  assert.equal(result.notional, 606_000);
});

test("entry notional fails closed without a trusted ticker and rejects extreme limit prices", () => {
  assert.equal(trustedEntryNotional({ type: "MARKET", quantity: 1 }, { price: null }).reason, "trusted_ticker_price_unavailable");
  assert.equal(trustedEntryNotional({ type: "LIMIT", quantity: 1, price: 1 }, { price: 60_000 }).reason, "order_price_deviation_exceeded");
});

test("amend converts coin quantity to aligned contracts and inherits authoritative price", () => {
  const result = prepareAmendOrderFacts({
    payload: { newSize: 0.05 },
    order: { sz: "10", accFillSz: "2", px: "60000" },
    spec: { ctVal: 0.01, lotSz: 1, tickSz: 0.1 },
    market: { price: 60_000 }
  });
  assert.equal(result.allowed, true);
  assert.equal(result.targetContracts, 5);
  assert.equal(result.targetCoinQuantity, 0.05);
  assert.equal(result.targetPrice, 60_000);
  assert.equal(result.notional, 3_030);
});

test("amend cannot enlarge risk or shrink total size below already filled contracts", () => {
  const common = {
    order: { sz: "10", accFillSz: "2", px: "60000" },
    spec: { ctVal: 0.01, lotSz: 1, tickSz: 0.1 },
    market: { price: 60_000 }
  };
  assert.equal(prepareAmendOrderFacts({ ...common, payload: { newSize: 1_000_000 } }).reason, "amend_risk_increase_requires_new_approval");
  assert.equal(prepareAmendOrderFacts({ ...common, payload: { newSize: 0.01 } }).reason, "amend_size_below_already_filled");
  assert.equal(prepareAmendOrderFacts({ ...common, payload: { newPrice: 100_000 } }).reason, "amend_price_deviation_exceeded");
});

test("non-integer lot sizes are aligned before exchange submission", () => {
  const result = prepareAmendOrderFacts({
    payload: { newSize: 0.023 },
    order: { sz: "3", accFillSz: "1.2", px: "100" },
    spec: { ctVal: 0.01, lotSz: 0.1, tickSz: 0.01 },
    market: { price: 100 }
  });
  assert.equal(result.allowed, true);
  assert.equal(result.targetContracts, 2.3);
  assert.equal(result.targetCoinQuantity, 0.023);
});
