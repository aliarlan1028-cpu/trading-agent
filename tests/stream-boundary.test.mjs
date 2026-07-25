import test from "node:test";
import assert from "node:assert/strict";
import { isPublicMarketStreamUpdate } from "../server/streamPolicy.mjs";

test("public SSE accepts only market-shaped updates", () => {
  assert.equal(isPublicMarketStreamUpdate({ symbol: "BTC/USDT", price: 100, fundingRate: 0.01 }), true);
  assert.equal(isPublicMarketStreamUpdate({ type: "portfolio", portfolio: { totalEquityUsdt: 1000 } }), false);
  assert.equal(isPublicMarketStreamUpdate({ symbol: "BTC/USDT", positions: [{ size: 1 }] }), false);
  assert.equal(isPublicMarketStreamUpdate({ symbol: "BTC/USDT", price: 100, secret: "x" }), false);
});
