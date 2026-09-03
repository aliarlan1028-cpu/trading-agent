import React from "react";
import { createRoot } from "react-dom/client";
import { toPng } from "html-to-image";
import { August15AuthenticatedShell } from "../src/aug15/App.jsx";
import { ConfirmHost } from "../src/confirm.jsx";
import { TradingViewChart } from "../src/lib.jsx";
import "../src/aug15/styles.css";

// Test-only production-shaped synthetic fixture. Production never imports it.
document.documentElement.dataset.fixtureKind = "production-shaped-synthetic";

const now = "2026-09-03T08:00:00.000Z";
const hour = 3_600_000;
const iso = (offset) => new Date(new Date(now).getTime() + offset * hour).toISOString();
const symbols = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "SUI/USDT", "ADA/USDT"];
const prices = { "BTC/USDT": 114262.4, "ETH/USDT": 4382.18, "SOL/USDT": 219.84, "SUI/USDT": 4.26, "ADA/USDT": 1.03 };
const round = (value, digits = 4) => Number(Number(value).toFixed(digits));
const query = new URLSearchParams(location.search);
const chartFailureMode = query.get("chart") || "";
const chartLifecycleModes = new Set(["add-series-error", "candle-data-error", "fit-error", "refetch-candle-error", "refetch-volume-error", "update-error"]);
const chartFailureFixture = { removals: 0, runtimeErrors: 0, unhandledRejections: 0, candleSetDataCalls: 0, volumeSetDataCalls: 0, updateCalls: 0 };
window.__cockpitChartFailure = chartFailureFixture;
window.addEventListener("error", () => { chartFailureFixture.runtimeErrors += 1; });
window.addEventListener("unhandledrejection", (event) => { chartFailureFixture.unhandledRejections += 1; event.preventDefault(); });

function fixtureCandles(symbol) {
  const base = prices[symbol] ?? prices["BTC/USDT"];
  const start = new Date(now).getTime() - 72 * hour;
  return Array.from({ length: 72 }, (_, index) => {
    const drift = Math.sin(index / 5) * .009 + index * .00018;
    const open = base * (1 + drift);
    const close = base * (1 + drift + Math.sin(index * 1.7) * .0035);
    return { time: start + index * hour, open: round(open), high: round(Math.max(open, close) * 1.0028), low: round(Math.min(open, close) * .9972), close: round(close), volume: round(780 + index * 17 + Math.cos(index / 3) * 55, 2), confirm: "1" };
  });
}

// The real chart may try a public exchange WebSocket after the fixture fetch.
// This test-only inert implementation prevents network activity during capture.
class InertCockpitWebSocket {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  constructor(url) {
    this.url = url; this.readyState = InertCockpitWebSocket.CLOSED; this.protocol = ""; this.extensions = "";
    if (chartFailureMode === "update-error") setTimeout(() => { this.readyState = InertCockpitWebSocket.OPEN; this.onopen?.(); }, 40);
  }
  close() { this.readyState = InertCockpitWebSocket.CLOSED; }
  send(payload) {
    if (chartFailureMode === "update-error" && payload !== "ping") {
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ arg: { channel: "tickers" }, data: [{ last: "115000" }] }) }), 10);
    }
  }
  addEventListener() {} removeEventListener() {}
}
window.WebSocket = InertCockpitWebSocket;

const nativeFetch = window.fetch.bind(window);
const klineFixture = { requests: 0, symbols: [], queries: [] };
if (query.get("chart") === "init-error") {
  HTMLCanvasElement.prototype.getContext = function getContext() {
    throw new Error("synthetic chart initialization failure");
  };
}
if (["refetch-candle-error", "refetch-volume-error"].includes(chartFailureMode)) {
  const nativeSetInterval = window.setInterval.bind(window);
  window.setInterval = (callback, delay, ...args) => delay === 30000
    ? window.setTimeout(callback, 50, ...args)
    : nativeSetInterval(callback, delay, ...args);
}

const candleSeriesType = Symbol("CandlestickSeries");
const volumeSeriesType = Symbol("HistogramSeries");
const chartLibraryFixture = {
  CandlestickSeries: candleSeriesType,
  HistogramSeries: volumeSeriesType,
  createChart(holder) {
    const canvas = document.createElement("canvas");
    holder.append(canvas);
    return {
      addSeries(type) {
        if (chartFailureMode === "add-series-error") throw new Error("synthetic add-series failure");
        const volume = type === volumeSeriesType;
        return {
          setData() {
            const key = volume ? "volumeSetDataCalls" : "candleSetDataCalls";
            chartFailureFixture[key] += 1;
            if ((!volume && chartFailureMode === "candle-data-error")
              || (!volume && chartFailureMode === "refetch-candle-error" && chartFailureFixture[key] > 1)
              || (volume && chartFailureMode === "refetch-volume-error" && chartFailureFixture[key] > 1)) {
              throw new Error(`synthetic ${volume ? "volume" : "candle"} data failure`);
            }
          },
          update() {
            chartFailureFixture.updateCalls += 1;
            if (chartFailureMode === "update-error") throw new Error("synthetic live update failure");
          }
        };
      },
      priceScale() { return { applyOptions() {} }; },
      timeScale() {
        return { fitContent() { if (chartFailureMode === "fit-error") throw new Error("synthetic fit failure"); } };
      },
      remove() { chartFailureFixture.removals += 1; holder.replaceChildren(); }
    };
  }
};
const loadChartLibraryFixture = async () => chartLibraryFixture;
window.__cockpitKlineFixture = klineFixture;
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("/api/market/klines")) {
    const requestUrl = new URL(url, location.origin);
    const symbol = requestUrl.searchParams.get("symbol") || "BTC/USDT";
    const tf = requestUrl.searchParams.get("tf") || "";
    klineFixture.requests += 1;
    klineFixture.symbols.push(symbol);
    klineFixture.queries.push({ symbol, tf });
    if (query.get("chart") === "error") return new Response(JSON.stringify({ error: "synthetic chart failure" }), { status: 503, headers: { "content-type": "application/json" } });
    if (query.get("chart") === "empty") return new Response(JSON.stringify({ candles: [] }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ candles: fixtureCandles(symbol) }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return nativeFetch(input, init);
};

const fixtureMarket = (symbol, index) => {
  const price = prices[symbol], changePct = [2.42, 1.86, -1.12, 3.74, .42][index];
  return { id: `market-${symbol}`, symbol, price, last: price, changePct, change24hPct: changePct, high24h: round(price * 1.016), low24h: round(price * .973), volume24h: 18_300 - index * 2_110, quoteTurnover24h: 1_830_000_000 - index * 211_000_000, openInterest: 2_743_000_000 - index * 330_000_000, fundingRate: [.0081, .0064, -.0032, .012, .0019][index], candles: fixtureCandles(symbol), updatedAt: now };
};

const positions = [
  { positionId: "ord-04", symbol: "BTC/USDT", source: "execution_engine", direction: "long", side: "buy", quantity: .18, size: .18, entryPrice: 110820, markPrice: 114262.4, unrealizedPnl: 619.63, pnl: 619.63, leverage: 3, liquidationPrice: 82410, liqDistancePct: 27.8, margin: 6855.74, initialMargin: 6855.74, notionalUsdt: 20567.23, notional: 20567.23, openedAt: iso(-22), updatedAt: now },
  { id: "pos-eth", positionId: "pos-eth", executionOrderId: "ord-01", symbol: "ETH/USDT", source: "execution_engine", direction: "long", side: "buy", quantity: 1.4, size: 1.4, entryPrice: 4258, markPrice: 4382.18, unrealizedPnl: 173.85, pnl: 173.85, leverage: 3, liquidationPrice: 3184, liqDistancePct: 27.3, margin: 2044.98, initialMargin: 2044.98, notionalUsdt: 6135.05, notional: 6135.05, stopLoss: 4180, takeProfits: [4471], openedAt: iso(-15), updatedAt: now },
  { id: "pos-sol", positionId: "pos-sol", executionOrderId: "ord-02", instId: "SOL-USDT-SWAP", symbol: "SOL/USDT", source: "exchange_rest", direction: "short", side: "sell", quantity: 18, size: 18, entryPrice: 223.1, markPrice: 219.84, unrealizedPnl: 58.68, pnl: 58.68, leverage: 2, liquidationPrice: 318.2, liqDistancePct: 44.7, margin: 1978.56, initialMargin: 1978.56, notionalUsdt: 3957.12, notional: 3957.12, stopLoss: 226.2, takeProfits: [214.1], openedAt: iso(-8), updatedAt: now },
  { id: "pos-sui", positionId: "pos-sui", executionOrderId: "ord-03", instId: "SUI-USDT-SWAP", symbol: "SUI/USDT", source: "exchange_ws", direction: "long", side: "buy", quantity: 960, size: 960, entryPrice: 4.08, markPrice: 4.26, unrealizedPnl: 172.8, pnl: 172.8, leverage: 2, liquidationPrice: 2.17, liqDistancePct: 49.1, margin: 2044.8, initialMargin: 2044.8, notionalUsdt: 4089.6, notional: 4089.6, stopLoss: 4.01, takeProfits: [4.35], openedAt: iso(-5), updatedAt: now }
];

const executionOrders = Array.from({ length: 32 }, (_, index) => {
  const symbol = symbols[index % symbols.length], side = index % 3 === 2 ? "sell" : "buy", price = prices[symbol];
  const quantity = symbol === "BTC/USDT" ? .03 + index / 1000 : symbol === "ETH/USDT" ? .4 + index / 10 : 8 + index;
  const status = index === 1 ? "protecting" : index < 24 ? "filled" : index % 3 === 0 ? "open" : index % 3 === 1 ? "pending" : "canceled";
  const type = index % 7 === 0 ? "stop" : index % 4 === 0 ? "market" : "limit";
  return { id: `ord-${String(index).padStart(2, "0")}`, orderId: `ord-${String(index).padStart(2, "0")}`, tradePlanId: `plan-${index % 8}`, planId: `plan-${index % 8}`, positionId: index < positions.length ? positions[index].positionId : `historical-position-${index}`, symbol, side, direction: side, type, orderType: type, purpose: type === "stop" ? "stop_loss" : "entry", quantity, size: quantity, filledQuantity: status === "filled" ? quantity : 0, accFillSz: status === "filled" ? quantity : 0, price: round(price * (1 + (index % 5 - 2) * .001)), exchange: "OKX", venue: "OKX", source: "execution_engine", status, reduceOnly: type === "stop", createdAt: iso(-96 + index * 2), updatedAt: iso(-96 + index * 2 + .2) };
});

const fills = Array.from({ length: 24 }, (_, index) => {
  const order = executionOrders[index], price = round(order.price * (1 + (index % 3 - 1) * .0002)), fee = round(-Math.max(1.2, order.price * order.quantity * .00035), 4);
  return { id: `fill-${String(index).padStart(2, "0")}`, fillId: `fill-${String(index).padStart(2, "0")}`, orderId: order.id, executionOrderId: order.id, symbol: order.symbol, side: order.side, direction: order.side, quantity: order.quantity, size: order.quantity, fillSz: order.quantity, price, fillPx: price, fee, feeUsdt: fee, liquidity: index % 2 ? "taker" : "maker", execType: index % 2 ? "taker" : "maker", exchange: "OKX", venue: "OKX", createdAt: iso(-96 + index * 2 + .1), updatedAt: iso(-96 + index * 2 + .1) };
});

const closedTradeLifecycles = Array.from({ length: 27 }, (_, index) => {
  const symbol = symbols[index % symbols.length], netRealizedPnl = round((index % 4 === 1 ? -1 : 1) * (48 + index * 11.37), 2), orderId = `ord-${String(index % 24).padStart(2, "0")}`;
  return { id: `trade-${String(index).padStart(2, "0")}`, tradeLifecycleId: `trade-${String(index).padStart(2, "0")}`, executionOrderId: orderId, orderId, symbol, direction: index % 3 === 2 ? "short" : "long", side: index % 3 === 2 ? "sell" : "buy", status: "closed", quantity: index % 5 + 1, entryPrice: prices[symbol] * .986, exitPrice: prices[symbol] * (index % 4 === 1 ? .978 : 1.012), grossRealizedPnl: round(netRealizedPnl + 4.12, 2), totalFeeUsdt: 4.12, netRealizedPnl, holdMinutes: 90 + index * 7, strategy: "browser_validation", signal: "synthetic_fixture", ...(index === 18 ? { pathSamples: [{ at: iso(-174), pnlUsdt: -22 }, { at: iso(-173), pnlUsdt: 18 }, { at: iso(-172), pnlUsdt: netRealizedPnl }] } : {}), openedAt: iso(-300 + index * 7), closedAt: iso(-296 + index * 7), createdAt: iso(-300 + index * 7), updatedAt: iso(-296 + index * 7) };
});

const reviews = Array.from({ length: 27 }, (_, index) => {
  const trade = closedTradeLifecycles[index];
  return { id: `review-${String(index).padStart(2, "0")}`, type: "trade", tradeLifecycleId: trade.id, executionOrderId: trade.executionOrderId, orderId: trade.orderId, symbol: trade.symbol, direction: trade.direction, side: trade.side, status: index % 6 === 0 ? "processing" : index % 2 ? "completed" : "reflected", netRealizedPnl: trade.netRealizedPnl, totalFeeUsdt: trade.totalFeeUsdt, summary: `Synthetic ${trade.symbol} lifecycle ${index + 1} remains deterministic for visual validation.`, deepReflection: "Synthetic fixture preserves the production review shape without representing an account event.", rootCause: index % 4 === 1 ? "Synthetic event-window timing review." : "Synthetic market-structure review.", improvement: "Synthetic fixture: apply the recorded guard before the next comparable setup.", lesson: "Synthetic fixture: preserve entry and protection evidence.", attribution: index % 2 ? "strategy_execution" : "risk_timing", holdMinutes: 90 + index * 7, confidence: 68 + index % 27, createdAt: trade.closedAt, completedAt: index % 6 === 0 ? undefined : iso(-295 + index * 7), updatedAt: iso(-295 + index * 7) };
});

const accountSnapshots = Array.from({ length: 48 }, (_, index) => ({ id: `snapshot-${String(index).padStart(2, "0")}`, createdAt: iso(-48 + index), updatedAt: iso(-48 + index), totalEquityUsdt: round(69040 + index * 76 + Math.sin(index / 3) * 192, 2), availableMarginUsdt: round(54400 + index * 41, 2), unrealizedPnl: round(180 + Math.cos(index / 4) * 120, 2), source: "synthetic_browser_fixture" }));
const realizedPnl = closedTradeLifecycles.reduce((total, row) => total + row.netRealizedPnl, 0);
const wins = closedTradeLifecycles.filter((row) => row.netRealizedPnl > 0).length;

const data = {
  resourceState: { cockpit: "loaded" }, user: { id: "synthetic-browser-user", name: "Ely", displayName: "Ely" }, exchangeAccounts: [{ id: "synthetic-okx", exchange: "OKX", connected: true, tradingAvailable: true, source: "synthetic_browser_fixture", updatedAt: now }], system: { killSwitch: false, remainingDailyLossUsdt: 1360, updatedAt: now }, automationState: { mode: "observe", label: "观察运行", detail: "Synthetic browser fixture; no production write is permitted.", updatedAt: now }, portfolio: { totalEquityUsdt: 72450.82, todayPnl: 826.42, todayPnlPct: 1.15, unrealizedPnl: 1024.96, availableMarginUsdt: 56540.13, updatedAt: now }, portfolioRisk: { utilizationPct: 37, status: "ok", portfolioVolPct: 1.11, budgetPct: 3 },
  notifications: [{ id: "n1", title: "Synthetic fixture: market observation updated.", unread: true, createdAt: iso(-1), updatedAt: iso(-1) }],
  markets: symbols.map(fixtureMarket), activeMarket: fixtureMarket("BTC/USDT", 0), watchlist: symbols, marketRegime: { summary: "Synthetic fixture: trend is positive while leverage remains observed.", global: { label: "趋势偏多 · 波动扩张", summary: "Synthetic market regime for browser-only visual validation.", confidence: 78, breadthPct: 64 }, smartMoney: { topTraderLongShortRatio: 1.36 }, updatedAt: now }, mediumTermAnalytics: { symbols: symbols.slice(0, 3).map((symbol) => ({ symbol, windows: { "15m": { status: "ok", leverageState: "long_build" }, "1h": { status: "ok", leverageState: "long_build_crowded" }, "4h": { status: "ok", leverageState: "stable_or_mixed" } }, updatedAt: now })) },
  positions, accountSnapshots, tradePlans: Array.from({ length: 8 }, (_, index) => ({ id: `plan-${index}`, symbol: symbols[index % symbols.length], status: "approved", signal: "synthetic_fixture", strategy: "browser_validation", stopLoss: prices[symbols[index % symbols.length]] * .97, takeProfit: [prices[symbols[index % symbols.length]] * 1.02], createdAt: iso(-100 + index) })), riskChecks: executionOrders.map((order) => ({ id: `risk-${order.id}`, tradePlanId: order.tradePlanId, executionOrderId: order.id, status: "passed", summary: "Synthetic browser fixture risk gate passed.", createdAt: order.createdAt })), executionOrders, fills, closedTradeLifecycles, reviews, performance: { trades: closedTradeLifecycles.length, totalPnlUsdt: round(realizedPnl, 2), winRatePct: round(wins / closedTradeLifecycles.length * 100, 1), profitFactor: 2.14, avgPnlUsdt: round(realizedPnl / closedTradeLifecycles.length, 2), expectancyUsdt: round(realizedPnl / closedTradeLifecycles.length, 2), maxDrawdownPct: 4.6 }, behaviorProfile: { overall: { expectancyUsdt: round(realizedPnl / closedTradeLifecycles.length, 2) }, strengths: ["Synthetic fixture records deterministic entry and protection context."], flags: [{ key: "event", title: "Synthetic event timing", detail: "Synthetic fixture preserves a complete review shape for visual density." }] }
};

const enrichment = {
  riskRules: ["r1", "r2", "r3", "r4"].map((id, index) => ({ id, enabled: true, name: `Synthetic risk rule ${index + 1}`, updatedAt: now })),
  events: [{ id: "e1", title: "Synthetic employment data window", due: iso(26), importance: "high", source: "synthetic_browser_fixture" }, { id: "e2", title: "Synthetic central-bank speech", due: iso(43), importance: "high", source: "synthetic_browser_fixture" }],
  agentRuns: Array.from({ length: 6 }, (_, index) => ({ id: `run-${index}`, goal: `Synthetic browser validation run ${index + 1}`, status: index === 0 ? "running" : "completed", createdAt: iso(-index - .2), completedAt: index === 0 ? undefined : iso(-index - .1) })),
  jobRuns: Array.from({ length: 4 }, (_, index) => ({ id: `job-${index}`, name: `Synthetic reconciliation ${index + 1}`, status: "completed", createdAt: iso(-index - 1.5), completedAt: iso(-index - 1.4) })),
  strategyCatalog: { products: [{ id: "trend-v3", versionId: "trend-v3", deployment: { state: "active" } }, { id: "breakout-v2", versionId: "breakout-v2", deployment: { state: "live_probation" } }] }
};
if (query.get("enriched") === "1") Object.assign(data, enrichment);
if (query.get("empty") === "1") Object.assign(data, { portfolio: {}, portfolioRisk: { utilizationPct: null, status: "no_equity" }, markets: [], activeMarket: null, watchlist: [], marketRegime: null, notifications: [], positions: [], executionOrders: [], fills: [], closedTradeLifecycles: [], reviews: [], accountSnapshots: [] });
if (query.get("marketCase") === "malformed") Object.assign(data, {
  markets: [
    { id: "bad-space", symbol: " ", price: 1 },
    { id: "bad-base", symbol: "/USDT", price: 2 },
    { id: "bad-quote", symbol: "BTC/", price: 3 },
    { id: "bad-object", symbol: {}, price: 4 },
    { id: "bad-array", symbol: [], price: 5 },
    { ...fixtureMarket("BTC/USDT", 0), symbol: " BTC/USDT " },
    fixtureMarket("ETH/USDT", 1)
  ],
  activeMarket: { ...fixtureMarket("BTC/USDT", 0), symbol: " BTC/USDT " },
  watchlist: [" ", "/USDT", "BTC/", {}, [], " BTC/USDT ", "ETH/USDT"],
  events: [
    null,
    {},
    [],
    "event",
    { title: " " },
    { id: "severity-shell", importance: "high", impact: "systemic" },
    { id: "date-shell", due: iso(12), createdAt: iso(-12) }
  ]
});
if (query.get("marketCase") === "mismatched") Object.assign(data, {
  markets: [fixtureMarket("BTC/USDT", 0), fixtureMarket("ETH/USDT", 1)],
  activeMarket: fixtureMarket("BTC/USDT", 0),
  watchlist: [" BTC/USDT ", { symbol: " DOGE/USDT " }, "/USDT"]
});
if (query.get("positionCase") === "malformed") Object.assign(data, {
  portfolio: {},
  portfolioRisk: {},
  positions: [
    null, "bad", {},
    { positionId: "malformed-explicit", executionOrderId: "alias-explicit", symbol: "BTC/USDT", direction: "long", notionalUsdt: 100 },
    { positionId: "malformed-fallback", symbol: "ETH/USDT", direction: "short", notionalUsdt: 80 },
    { positionId: "malformed-ambiguous", symbol: "SOL/USDT", direction: "long", notionalUsdt: 60 }
  ],
  executionOrders: [
    { orderId: "alias-explicit", positionId: "malformed-explicit", tradePlanId: "wrong-malformed", status: "protecting" },
    { orderId: "alias-fallback", positionId: "malformed-fallback", status: "protecting" },
    { id: "ambiguous-one", positionId: "malformed-ambiguous", status: "protecting" },
    { id: "ambiguous-two", positionId: "malformed-ambiguous", status: "protecting" }
  ],
  tradePlans: [{ id: "wrong-malformed", stopLoss: 13.37, takeProfit: [14.88] }],
  accountSnapshots: []
});
if (query.get("positionCase") === "partial") Object.assign(data, {
  portfolio: {},
  portfolioRisk: {},
  positions: [
    { positionId: "partial-known", symbol: "BTC/USDT", direction: "long", notionalUsdt: 100, unrealizedPnl: 2 },
    { positionId: "partial-unknown", symbol: "ETH/USDT", quantity: 1, unrealizedPnl: -1 }
  ],
  executionOrders: [],
  tradePlans: [],
  accountSnapshots: []
});
if (query.get("reviewCase") === "malformed") Object.assign(data, {
  closedTradeLifecycles: [null, "bad", {}, { id: "trade-safe", symbol: "BTC/USDT", netRealizedPnl: 2, holdMinutes: 20 }],
  reviews: [null, "bad", {}, { id: "", type: "trade" }, { id: "review-safe", type: "trade", tradeLifecycleId: "trade-safe", symbol: "BTC/USDT", status: "completed", summary: "Synthetic valid review among malformed rows." }]
});
const requestedResourceState = query.get("resource");
if (["not_loaded", "loading", "ready", "error", "failed", "forbidden", "disabled", "stale", "degraded"].includes(requestedResourceState)) data.resourceState.cockpit = requestedResourceState;
if (requestedResourceState === "unknown") data.resourceState.cockpit = "future_state";
window.__cockpitFixtureFields = Object.keys(data);
const initialTab = ["overview", "market", "positions", "execution", "ledger"].includes(query.get("view")) ? query.get("view") : "overview";
const action = async (path, payload, method) => { window.__cockpitLastAction = { path, payload, method }; return {}; };
const captureUrl = location.href;
const requestedReviewId = query.has("reviewId") ? query.get("reviewId") : null;
const initialPath = initialTab === "execution" && requestedReviewId !== null
  ? `/app/trade/reviews/${encodeURIComponent(requestedReviewId)}`
  : ({ overview: "/app/trade/overview", market: "/app/trade/market", positions: "/app/trade/positions", execution: "/app/trade/execution-review", ledger: "/app/trade/orders-fills" })[initialTab];
history.replaceState(null, "", initialPath);
const api = { data, action, toast: "", busy: false, notify() {}, download() {}, refresh() {}, ensureSection() {}, connectionError: "" };
const browserContent = chartLifecycleModes.has(chartFailureMode)
  ? <div className="cockpitPage" data-cockpit-page="overview"><div data-cockpit-region="market-chart"><TradingViewChart symbol="BTC/USDT" interval="60" showVolume chartLibraryLoader={loadChartLibraryFixture}/></div></div>
  : <><August15AuthenticatedShell api={api} lang="zh" switchLang={() => {}}/><ConfirmHost/></>;
createRoot(document.getElementById("root")).render(browserContent);

const captureCockpitVisual = async () => {
  const node = document.querySelector(".appShell.cockpitMode"), cockpit = document.querySelector(".tradingCockpit"), width = Math.max(node.scrollWidth, cockpit.scrollWidth), height = Math.max(node.scrollHeight, cockpit.scrollHeight);
  document.body.dataset.captureState = "processing";
  try { const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 1, backgroundColor: "#fbfaf8", width, height }); const result = document.createElement("meta"); result.id = "cockpit-capture-result"; result.dataset.image = dataUrl; document.head.append(result); document.body.dataset.captureState = "done"; } catch (error) { document.body.dataset.captureState = "failed"; document.body.dataset.captureError = String(error?.message || error); }
};
if (query.get("capture") === "1") { setTimeout(() => history.replaceState(null, "", captureUrl), 1500); setTimeout(captureCockpitVisual, 2000); }
