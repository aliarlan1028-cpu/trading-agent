import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCapabilityCatalogRows,
  buildEventRows,
  buildExecutionView,
  buildMarketRows,
  buildPositionView,
  buildStrategyCatalogRows,
  positionNotionalUsdt
} from "../src/viewData.js";

const t = (zh) => zh;

test("shared strategy catalog only publishes validated knowledge strategies", () => {
  const data = {
    strategyCatalog: {
      products: [{ id: "p", versionId: "v1", version: 1, definition: { name: "产品策略", direction: "long", timeframes: ["1h"] }, deployment: { state: "owner_live_observation" }, metrics: { closedTrades: 3 } }],
      strategies: [{ id: "rsi", name: "RSI 研究", contract: { direction: "both", timeframes: ["15m", "1h"], family: "rsi" }, lifecycle: { stage: "research", live: { trades: 0 } } }]
    },
    knowledge: { tradingSkills: [{ id: "distilled", name: "蒸馏策略", methodId: "m1", status: "compiled", spec: { direction: "short", timeframe: "4h" } }] },
    skills: [{ id: "imported", name: "导入策略", kind: "strategy", source: "github", status: "active" }]
  };
  const catalog = buildStrategyCatalogRows(data, t);
  assert.deepEqual(catalog.rows.map((row) => row.id), ["product_v1", "native_rsi", "imported"]);
  assert.deepEqual(catalog.rows.map((row) => row.origin), ["策略产品", "指标研究模型", "导入"]);
  assert.equal(catalog.products.length, 1);
  assert.equal(catalog.research.length, 1);
});

test("execution headline uses authoritative performance and never rebuilds lifecycles from bounded fills", () => {
  const fills = [
    { id: "entry", executionOrderId: "life", kind: "entry", feeUsdt: 1, createdAt: "2026-08-01T00:00:00Z" },
    { id: "part", executionOrderId: "life", kind: "close", partial: true, realizedPnl: 2, feeUsdt: .2, createdAt: "2026-08-01T01:00:00Z" },
    { id: "final", executionOrderId: "life", kind: "close", partial: false, realizedPnl: 8, feeUsdt: .3, fundingFeeUsdt: -.5, createdAt: "2026-08-01T02:00:00Z" }
  ];
  const authoritative = buildExecutionView({
    fills,
    closedTradeLifecycles: [{ id: "closed:life", tradeLifecycleKey: "life", netRealizedPnl: 8 }],
    performance: { trades: 7, totalPnlUsdt: 42.25, winRatePct: 57.1, avgPnlUsdt: 6.04 }
  });
  assert.equal(authoritative.performance.trades, 7);
  assert.equal(authoritative.performance.totalPnlUsdt, 42.25);
  assert.equal(authoritative.closedTrades[0].netRealizedPnl, 8);

  const notLoaded = buildExecutionView({ fills });
  assert.equal(notLoaded.lifecycleState, "not_loaded");
  assert.deepEqual(notLoaded.closedTrades, []);
  assert.equal(notLoaded.performance.trades, 0);
});

test("execution view excludes non-trade reviews and reports server totals for bounded native lists", () => {
  const view = buildExecutionView({
    fills: [{ id: "latest", kind: "entry", createdAt: "2026-08-02T00:00:00Z" }],
    reviews: [{ id: "trade", type: "trade" }, { id: "analysis", type: "analysis", executionOrderId: "eo" }],
    tradeDataStatus: { fillTotal: 80, tradeReviewTotal: 14 },
    executionOrderStatus: { total: 25 },
    executionOrders: [{ id: "visible" }]
  });
  assert.deepEqual(view.reviews.map((row) => row.id), ["trade"]);
  assert.deepEqual(view.totals, { orders: 25, fills: 80, reviews: 14 });
});

test("native execution uses server-aggregated lifecycles instead of rebuilding from a bounded fill ledger", () => {
  const view = buildExecutionView({
    fills: [{ id: "final", executionOrderId: "life", kind: "close", partial: false, realizedPnl: 8, feeUsdt: .3 }],
    closedTradeLifecycles: [{ id: "closed:life", tradeLifecycleKey: "life", realizedPnl: 10, feeUsdt: .5, entryFeeUsdt: 1, fundingFeeUsdt: -.5, netRealizedPnl: 8 }]
  });
  assert.equal(view.closedTrades.length, 1);
  assert.equal(view.closedTrades[0].netRealizedPnl, 8);
  assert.equal(view.performance.totalPnlUsdt, 8);
});

test("positions use normalized quantity, notional and PnL fields and hide closed exchange orders", () => {
  const view = buildPositionView({
    positions: [
      { symbol: "BTC/USDT", quantity: .01, mark: 60000, unrealizedPnl: 12, margin: 60 },
      { symbol: "ETH/USDT", quantity: 0, mark: 3000, unrealizedPnl: 99 }
    ],
    orders: [
      { id: "partial", source: "exchange_rest", status: "partially_filled" },
      { id: "done", source: "exchange_rest", status: "filled" },
      { id: "local-history", source: "local", status: "ok" }
    ]
  });
  assert.equal(view.positions.length, 1);
  assert.equal(view.exposureUsdt, 600);
  assert.equal(view.unrealizedPnlUsdt, 12);
  assert.equal(view.marginUsdt, 60);
  assert.deepEqual(view.openOrders.map((row) => row.id), ["partial"]);
  assert.equal(positionNotionalUsdt({ notionalUsdt: 125 }), 125);
  assert.equal(positionNotionalUsdt({ quantity: .5, markPrice: 300 }), 150);
});

test("capabilities, market aliases, and official events have one cross-layout mapping", () => {
  const capabilities = buildCapabilityCatalogRows({
    analysisEngine: { tools: [{ id: "a", name: "scan", runs: 3 }] },
    mcpServers: [{ id: "m1", serverName: "news", tools: ["fetch"] }, { id: "m2", serverName: "news", tools: ["fetch"] }],
    toolCallStats: { fetch: { calls: 2, success: 2 } }
  }, t);
  assert.equal(capabilities.length, 2);
  assert.equal(capabilities.find((row) => row.serverName === "news").calls, 2);

  const failedMcp = buildCapabilityCatalogRows({
    mcpServers: [{ id: "mcp_bad", serverName: "bad-news", status: "connected", tools: ["fetch", "search"] }],
    toolCallStats: {
      fetch: { calls: 5, success: 0, blocked: 0, error: 5, totalLatencyMs: 500, latencySamples: 5, lastStatus: "error", lastAt: "2026-08-14T10:00:00Z" },
      search: { calls: 5, success: 0, blocked: 0, error: 5, totalLatencyMs: 700, latencySamples: 5, lastStatus: "error", lastAt: "2026-08-14T10:01:00Z" }
    }
  }, t)[0];
  assert.deepEqual({ calls: failedMcp.calls, success: failedMcp.usage.success, error: failedMcp.usage.error, latency: failedMcp.usage.avgLatencyMs }, { calls: 10, success: 0, error: 10, latency: 120 });
  assert.equal(failedMcp.health, "degraded", "an all-failed MCP server must never be marked healthy");

  const markets = buildMarketRows({ markets: [{ symbol: "BTC/USDT", last: 60000, change24hPct: 2, quoteVolume: 99, high: 61000, low: 59000 }] });
  assert.deepEqual({ price: markets[0].price, change: markets[0].changePct, volume: markets[0].volume24h, high: markets[0].high24h, low: markets[0].low24h }, { price: 60000, change: 2, volume: 99, high: 61000, low: 59000 });

  const events = buildEventRows({
    events: [{ id: "local", title: "CPI", due: "2026-08-15T12:30:00Z" }],
    marketCalendarEvents: [{ id: "duplicate", title: "CPI", startAt: "2026-08-15T12:30:00Z", importance: "high" }, { id: "fed", title: "FOMC", startAt: "2026-08-16T18:00:00Z", importance: "high" }]
  }, t);
  assert.deepEqual(events.map((row) => row.id), ["local", "fed"]);
});
