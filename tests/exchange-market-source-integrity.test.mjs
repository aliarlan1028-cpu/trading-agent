import assert from "node:assert/strict";
import test from "node:test";
import { syncPublicKlines, syncPublicMarket } from "../server/exchangeConnector.mjs";

test("a slower closed-candle sync cannot overwrite the newer OKX ticker price", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const start = Date.UTC(2025, 0, 1, 0, 0, 0);
  globalThis.fetch = async (url) => {
    const isTicker = String(url).includes("/market/ticker");
    return {
      ok: true,
      async json() {
        await new Promise((resolve) => setTimeout(resolve, isTicker ? 1 : 15));
        if (isTicker) return { data: [{ last: "101", open24h: "100", high24h: "105", low24h: "95", volCcy24h: "100000", ts: String(Date.now()) }] };
        return { data: [
          [String(start + 3_600_000), "98", "100", "97", "99", "10", "0", "0", "1"],
          [String(start), "97", "99", "96", "98", "10", "0", "0", "1"]
        ] };
      }
    };
  };
  const db = { markets: [], auditLogs: [], traces: [], meta: {} };
  await Promise.all([
    syncPublicMarket(db, "OKX", "BTC/USDT"),
    syncPublicKlines(db, "OKX", "BTC/USDT", "1h")
  ]);
  const market = db.markets[0];
  assert.equal(market.price, 101);
  assert.equal(market.lastClosedPrice, 99);
  assert.equal(market.changePct, 1);
  assert.ok(market.tickerSyncedAt);
  assert.ok(market.candlesByTf["1h"].syncedAt);
});
