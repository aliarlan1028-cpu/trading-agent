import assert from "node:assert/strict";
import test from "node:test";
import { summarizeOkxSwapBreadth } from "../server/marketSignals.mjs";

test("OKX market breadth ignores non-USDT swaps and summarizes direction without external data", () => {
  const result = summarizeOkxSwapBreadth([
    { instId: "BTC-USDT-SWAP", last: "105", open24h: "100" },
    { instId: "ETH-USDT-SWAP", last: "90", open24h: "100" },
    { instId: "SOL-USDT-SWAP", last: "110", open24h: "100" },
    { instId: "BTC-USD-SWAP", last: "200", open24h: "100" },
    { instId: "BROKEN-USDT-SWAP", last: "0", open24h: "100" }
  ]);
  assert.equal(result.instruments, 3);
  assert.equal(result.advancing, 2);
  assert.equal(result.declining, 1);
  assert.equal(result.breadthPct, 66.7);
  assert.equal(result.medianChangePct, 5);
  assert.equal(result.btcChangePct, 5);
  assert.equal(result.bias, "risk_on");
});
