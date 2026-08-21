import assert from "node:assert/strict";
import test from "node:test";
import { refreshMarketSignalSymbol } from "../server/marketSignalRefresh.mjs";
import { refreshMarketMovers } from "../server/marketScan.mjs";
import { fetchSmartMoney } from "../server/marketSignals.mjs";

test("ticker failure never starves the independent microstructure refresh", async () => {
  let microCalls = 0;
  const db = {};
  const result = await refreshMarketSignalSymbol(db, "BTC/USDT", {
    syncTicker: async () => { throw new Error("ticker_observation_rejected:out_of_order"); },
    syncMicro: async () => { microCalls += 1; return { openInterest: 10, fundingRatePct: 0.01 }; },
    syncSmartMoney: async () => ({}),
    recordSample: () => { throw new Error("no ticker means no sample"); }
  });
  assert.equal(microCalls, 1);
  assert.equal(result.microSynced, true);
  assert.equal(result.tickerSynced, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.errors, [{ source: "ticker", error: "ticker_observation_rejected:out_of_order" }]);
});

test("microstructure failure is reported instead of being hidden as a fully synced symbol", async () => {
  let recorded = 0;
  const result = await refreshMarketSignalSymbol({}, "BTC/USDT", {
    syncTicker: async () => ({ price: 60_000, rawTime: Date.now() }),
    syncMicro: async () => { throw new Error("OKX books timeout"); },
    syncSmartMoney: async () => ({}),
    recordSample: () => { recorded += 1; }
  });
  assert.equal(recorded, 1);
  assert.equal(result.complete, false);
  assert.equal(result.tickerSynced, true);
  assert.equal(result.microSynced, false);
  assert.deepEqual(result.errors, [{ source: "microstructure", error: "OKX books timeout" }]);
});

test("smart-money failure remains optional when ticker and microstructure are healthy", async () => {
  const result = await refreshMarketSignalSymbol({}, "BTC/USDT", {
    syncTicker: async () => ({ price: 60_000, rawTime: Date.now() }),
    syncMicro: async () => ({ openInterest: 10, fundingRatePct: 0.01 }),
    syncSmartMoney: async () => { throw new Error("Rubik rate limited"); },
    recordSample: () => {}
  });
  assert.equal(result.complete, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.warnings, [{ source: "smart_money", error: "Rubik rate limited" }]);
});

test("caller cancellation stops the current source and prevents later market mutations", async () => {
  const controller = new AbortController();
  const reason = new Error("scheduler_task_timeout");
  let microCalls = 0;
  let smartMoneyCalls = 0;
  const pending = refreshMarketSignalSymbol({}, "BTC/USDT", {
    signal: controller.signal,
    syncTicker: async (_db, _symbol, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }),
    syncMicro: async () => { microCalls += 1; return {}; },
    syncSmartMoney: async () => { smartMoneyCalls += 1; return {}; },
    recordSample: () => {}
  });

  controller.abort(reason);

  await assert.rejects(pending, (error) => error === reason);
  assert.equal(microCalls, 0);
  assert.equal(smartMoneyCalls, 0);
});

test("smart-money fetches settle on caller abort even when fetch ignores the signal", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  t.after(() => { globalThis.fetch = originalFetch; });
  const controller = new AbortController();
  const reason = new Error("scheduler_task_timeout");
  const pending = fetchSmartMoney("BTC/USDT", { signal: controller.signal });

  controller.abort(reason);

  const outcome = await Promise.race([
    pending.then((value) => ({ type: "resolved", value }), (error) => ({ type: "rejected", error })),
    new Promise((resolve) => setTimeout(() => resolve({ type: "still_pending" }), 50))
  ]);
  assert.equal(outcome.type, "rejected");
  assert.equal(outcome.error, reason);
});

test("market-mover scan settles on caller abort even when fetch ignores the signal", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => new Promise(() => {});
  t.after(() => { globalThis.fetch = originalFetch; });
  const controller = new AbortController();
  const reason = new Error("scheduler_task_timeout");
  const db = { traces: [] };
  const pending = refreshMarketMovers(db, { attributeTop: 0, signal: controller.signal });

  controller.abort(reason);

  const outcome = await Promise.race([
    pending.then((value) => ({ type: "resolved", value }), (error) => ({ type: "rejected", error })),
    new Promise((resolve) => setTimeout(() => resolve({ type: "still_pending" }), 50))
  ]);
  assert.equal(outcome.type, "rejected");
  assert.equal(outcome.error, reason);
  assert.equal(db.marketMovers, undefined);
});
