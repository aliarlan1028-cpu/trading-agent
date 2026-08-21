import assert from "node:assert/strict";
import test from "node:test";
import { marketFactFreshness, currentEvidenceReadiness } from "../server/marketFreshness.mjs";
import { applyTickerObservation } from "../server/marketObservation.mjs";
import { updateMarketFromTicker } from "../server/realtimeManager.mjs";
import { handleMarketStreamMessage } from "../server/marketStream.mjs";
import { syncPublicMarketQuiet } from "../server/exchangeConnector.mjs";

const ISO = (ms) => new Date(ms).toISOString();

function completeMarket(now) {
  return {
    symbol: "BTC/USDT",
    price: 60_000,
    tickerSourceAt: ISO(now - 1_000),
    tickerReceivedAt: ISO(now - 500),
    microReceivedAt: ISO(now - 1_000),
    bookSourceAt: ISO(now - 1_500),
    bookReceivedAt: ISO(now - 1_000),
    openInterestSourceAt: ISO(now - 2_000),
    openInterestReceivedAt: ISO(now - 1_000),
    fundingSourceAt: ISO(now - 60_000),
    fundingReceivedAt: ISO(now - 1_000)
  };
}

test("fresh local receipt cannot make an old exchange ticker fresh", () => {
  const now = Date.UTC(2026, 7, 15, 0, 0, 0);
  const market = completeMarket(now);
  market.tickerSourceAt = ISO(now - 86_400_000);
  market.tickerReceivedAt = ISO(now);
  const facts = marketFactFreshness(market, { now, tickerMaxAgeMs: 30_000 });
  assert.equal(facts.ticker.ok, false);
  assert.equal(facts.ticker.source.reason, "stale");
  assert.equal(facts.ticker.received.ok, true);
});

test("future and out-of-order exchange timestamps never overwrite the ticker watermark", () => {
  const now = Date.UTC(2026, 7, 15, 0, 0, 0);
  const market = completeMarket(now);
  const future = applyTickerObservation(market, { price: 70_000, sourceAt: now + 60_000 }, { now });
  assert.equal(future.applied, false);
  assert.equal(market.price, 60_000);

  const stale = applyTickerObservation(market, { price: 50_000, sourceAt: now - 2_000 }, { now });
  assert.equal(stale.applied, false);
  assert.equal(stale.reason, "out_of_order");
  assert.equal(market.price, 60_000);
});

test("both realtime ticker paths preserve OKX sourceAt and receivedAt", () => {
  const now = Date.UTC(2026, 7, 15, 0, 0, 0);
  const db = { markets: [{ symbol: "BTC/USDT", price: 1 }] };
  const direct = updateMarketFromTicker(db, "BTC-USDT-SWAP", { price: 60_000, source: "OKX_WS", sourceAt: now - 1_000 }, { now, receivedAt: now });
  assert.equal(direct.applied, true);
  assert.equal(db.markets[0].tickerSourceAt, ISO(now - 1_000));
  assert.equal(db.markets[0].tickerReceivedAt, ISO(now));

  const streamed = handleMarketStreamMessage(Buffer.from(JSON.stringify({
    arg: { channel: "tickers", instId: "BTC-USDT-SWAP" },
    data: [{ last: "61000", open24h: "60000", high24h: "62000", low24h: "59000", ts: String(now + 500) }]
  })), { db, now: now + 1_000, receivedAt: now + 1_000, broadcast: false });
  assert.equal(streamed.applied, true);
  assert.equal(db.markets[0].price, 61_000);
  assert.equal(db.markets[0].tickerSourceAt, ISO(now + 500));
  assert.equal(db.markets[0].tickerReceivedAt, ISO(now + 1_000));
});

test("ticker and microstructure timestamps cannot substitute for one another", () => {
  const now = Date.UTC(2026, 7, 15, 0, 0, 0);
  const tickerFreshMicroOld = completeMarket(now);
  tickerFreshMicroOld.bookSourceAt = ISO(now - 600_000);
  assert.equal(marketFactFreshness(tickerFreshMicroOld, { now }).ticker.ok, true);
  assert.equal(marketFactFreshness(tickerFreshMicroOld, { now }).micro.ok, false);

  const tickerOldMicroFresh = completeMarket(now);
  tickerOldMicroFresh.tickerSourceAt = ISO(now - 600_000);
  assert.equal(marketFactFreshness(tickerOldMicroFresh, { now }).ticker.ok, false);
  assert.equal(marketFactFreshness(tickerOldMicroFresh, { now }).micro.ok, true);
});

test("evidence readiness rejects a freshly fetched wrapper around an old ticker source", () => {
  const now = Date.UTC(2026, 7, 15, 0, 0, 0);
  const passed = { status: "fresh", quality: "passed", fetchedAt: ISO(now) };
  const bundle = {
    readiness: { "BTC/USDT": { ready: true, blockers: [] } },
    symbols: [{
      symbol: "BTC/USDT",
      ticker: { ...passed, sourceAt: ISO(now - 86_400_000) },
      microstructure: passed,
      candles: passed
    }]
  };
  assert.equal(currentEvidenceReadiness(bundle, "BTC/USDT", { now }).ok, false);
});

test("REST ticker with an old exchange source time remains stale despite a new HTTP response", async (t) => {
  const originalFetch = globalThis.fetch;
  const now = Date.now();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ code: "0", data: [{ instId: "BTC-USDT-SWAP", last: "60000", open24h: "59000", high24h: "61000", low24h: "58000", volCcy24h: "1", ts: String(now - 86_400_000) }] })
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  const db = { markets: [{ symbol: "BTC/USDT", price: 1 }] };
  await syncPublicMarketQuiet(db, "BTC/USDT");
  const facts = marketFactFreshness(db.markets[0], { now: Date.now(), tickerMaxAgeMs: 30_000 });
  assert.equal(facts.ticker.ok, false);
  assert.equal(facts.ticker.source.reason, "stale");
  assert.ok(new Date(db.markets[0].tickerReceivedAt).getTime() > new Date(db.markets[0].tickerSourceAt).getTime());
});

test("an older REST ticker is a harmless no-op when a newer WS ticker is already stored", async (t) => {
  const originalFetch = globalThis.fetch;
  const now = Date.now();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ code: "0", data: [{ instId: "BTC-USDT-SWAP", last: "59000", open24h: "58000", high24h: "60000", low24h: "57000", volCcy24h: "1", ts: String(now - 2_000) }] })
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  const db = { markets: [{ symbol: "BTC/USDT", price: 61_000, tickerSourceAt: ISO(now - 1_000), tickerReceivedAt: ISO(now - 500) }] };
  const result = await syncPublicMarketQuiet(db, "BTC/USDT");
  assert.equal(result.observationApplied, false);
  assert.equal(result.observationReason, "out_of_order");
  assert.equal(result.price, 61_000);
  assert.equal(result.rawTime, ISO(now - 1_000));
  assert.equal(db.markets[0].price, 61_000);
});

test("the market task caller can abort an in-flight REST ticker before it mutates state", async (t) => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const reason = new Error("scheduler_task_timeout");
  globalThis.fetch = (_url, options = {}) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  });
  t.after(() => { globalThis.fetch = originalFetch; });
  const db = { markets: [{ symbol: "BTC/USDT", price: 61_000 }] };
  const pending = syncPublicMarketQuiet(db, "BTC/USDT", { signal: controller.signal });

  controller.abort(reason);

  await assert.rejects(pending, (error) => error === reason);
  assert.equal(db.markets[0].price, 61_000);
  assert.equal(db.markets[0].tickerReceivedAt, undefined);
});
