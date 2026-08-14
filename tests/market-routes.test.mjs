import assert from "node:assert/strict";
import test from "node:test";
import { registerMarketRoutes } from "../server/routes/market.mjs";

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
}

function instrumentRoute(fetchPerpetualInstrumentCatalog) {
  const routes = new Map();
  const app = { get(path, handler) { routes.set(path, handler); } };
  registerMarketRoutes(app, {
    db: {}, persist() {}, activeMandate: () => null, fetchMarketRegime: async () => ({}), nowIso: () => "2026-08-15T00:00:00Z",
    fetchPerpetualInstruments: async () => [], fetchPerpetualInstrumentCatalog,
    normalizeSymbol: (value) => value, getHistoricalKlines: async () => [], fetchTokenProfile: async () => ({})
  });
  return routes.get("/api/market/instruments");
}

test("合约清单首次源故障和200空清单都返回503，不能误报暂无合约", async () => {
  for (const catalog of [
    { instruments: [], sourceStatus: "failed", asOf: null, stale: false, error: "OKX offline" },
    { instruments: [], sourceStatus: "healthy", asOf: "2026-08-15T00:00:00Z", stale: false }
  ]) {
    const res = response();
    await instrumentRoute(async () => catalog)({}, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.count, 0);
    assert.equal(res.payload.instruments.length, 0);
  }
});

test("OKX 故障但有历史缓存时明确下发 stale 与 asOf", async () => {
  const res = response();
  await instrumentRoute(async () => ({ instruments: [{ symbol: "BTC/USDT", exchanges: ["OKX"] }], sourceStatus: "stale", stale: true, asOf: "2026-08-14T00:00:00Z", source: "OKX" }))({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.stale, true);
  assert.equal(res.payload.sourceStatus, "stale");
  assert.equal(res.payload.asOf, "2026-08-14T00:00:00Z");
  assert.equal(res.payload.count, 1);
});
