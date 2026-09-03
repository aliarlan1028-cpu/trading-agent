import assert from "node:assert/strict";
import fs from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findReviewTrade } from "../src/viewData.js";
import {
  cockpitPathForRoute,
  cockpitRouteFromHistory,
  cockpitRouteFromPath,
  syncCockpitHistory
} from "../src/cockpitUrlState.js";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache");
const componentBundle = path.join(cacheDir, `trading-cockpit-primitives-${process.pid}.cjs`);
const positionsModulePath = path.join(rootDir, "src/aug15/tradingCockpit/PositionsPage.jsx");
const positionsModuleExists = fs.existsSync(positionsModulePath);
const reviewModulePath = path.join(rootDir, "src/aug15/tradingCockpit/ReviewPage.jsx");
const reviewModuleExists = fs.existsSync(reviewModulePath);
const ledgerModulePath = path.join(rootDir, "src/aug15/tradingCockpit/LedgerPage.jsx");
const ledgerModuleExists = fs.existsSync(ledgerModulePath);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => {
  try { fs.rmSync(componentBundle, { force: true }); } catch { /* noop */ }
});
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { CockpitTable } from "./src/aug15/tradingCockpit/shared.jsx";
      export { AreaTrend, BreadthBars, DistributionPlot, DonutChart, GaugeChart } from "./src/aug15/tradingCockpit/visuals.jsx";
      export { OverviewPage } from "./src/aug15/tradingCockpit/OverviewPage.jsx";
      export { MarketPage } from "./src/aug15/tradingCockpit/MarketPage.jsx";
      ${positionsModuleExists
        ? 'export { PositionsPage } from "./src/aug15/tradingCockpit/PositionsPage.jsx";'
        : "export const PositionsPage = undefined;"}
      ${reviewModuleExists
        ? 'export { ReviewPage } from "./src/aug15/tradingCockpit/ReviewPage.jsx";'
        : "export const ReviewPage = undefined;"}
      ${ledgerModuleExists
        ? 'export { LedgerPage } from "./src/aug15/tradingCockpit/LedgerPage.jsx";'
        : "export const LedgerPage = undefined;"}
      export { createElement } from "react";
      export { renderToStaticMarkup } from "react-dom/server";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime", "lucide-react"],
  outfile: componentBundle,
  logLevel: "silent"
});
const {
  AreaTrend,
  BreadthBars,
  CockpitTable,
  DistributionPlot,
  DonutChart,
  GaugeChart,
  MarketPage,
  LedgerPage,
  OverviewPage,
  PositionsPage,
  ReviewPage,
  createElement,
  renderToStaticMarkup
} = require(componentBundle);
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));

async function exists(url) {
  try { await access(url); return true; } catch { return false; }
}

const app = await readFile(new URL("../src/aug15/App.jsx", import.meta.url), "utf8");
const workspaces = await readFile(new URL("../src/aug15/workspacePages.jsx", import.meta.url), "utf8");
const cockpit = await readFile(new URL("../src/aug15/tradingCockpit.jsx", import.meta.url), "utf8").catch(() => "");
const overviewSource = await readFile(new URL("../src/aug15/tradingCockpit/OverviewPage.jsx", import.meta.url), "utf8").catch(() => "");
const marketSource = await readFile(new URL("../src/aug15/tradingCockpit/MarketPage.jsx", import.meta.url), "utf8").catch(() => "");
const positionsSource = await readFile(new URL("../src/aug15/tradingCockpit/PositionsPage.jsx", import.meta.url), "utf8").catch(() => "");
const reviewSource = await readFile(new URL("../src/aug15/tradingCockpit/ReviewPage.jsx", import.meta.url), "utf8").catch(() => "");
const ledgerSource = await readFile(new URL("../src/aug15/tradingCockpit/LedgerPage.jsx", import.meta.url), "utf8").catch(() => "");
const cockpitCss = await readFile(new URL("../src/aug15/tradingCockpit.css", import.meta.url), "utf8").catch(() => "");
const librarySource = await readFile(new URL("../src/lib.jsx", import.meta.url), "utf8").catch(() => "");
const browserHarness = await readFile(new URL("./trading-cockpit-browser.jsx", import.meta.url), "utf8").catch(() => "");
const browserRunner = await readFile(new URL("./run-trading-cockpit-browser.mjs", import.meta.url), "utf8").catch(() => "");

test("desktop cockpit owns an immersive shell without changing the other authenticated workspaces", () => {
  assert.match(app, /const immersiveCockpit = active === "cockpit"/);
  assert.match(app, /className=\{`appShell \$\{immersiveCockpit \? "cockpitMode" : ""\}`\}/);
  assert.match(app, /\{!immersiveCockpit && <Sidebar/);
  assert.match(app, /\{!immersiveCockpit && <AppTopbar/);
  assert.match(app, /<AssistantWidget/);
});

test("all five canonical trading routes render inside one shared cockpit shell", () => {
  assert.match(workspaces, /TradingCockpitShell/);
  assert.match(workspaces, /data-cockpit-view=\{tab\}/);
  for (const id of ["overview", "market", "positions", "execution", "ledger"]) {
    assert.match(workspaces, new RegExp(`\\[?"${id}"`), id);
  }
  for (const route of ["cockpit", "market", "positions", "tradeJournal", "tradeLedger"]) {
    assert.match(workspaces, new RegExp(`"${route}"`), route);
  }
});

test("reference-driven pages expose distinct real product landmarks and honest empty states", () => {
  const pageSources = `${cockpit}\n${marketSource}\n${overviewSource}\n${positionsSource}\n${reviewSource}\n${ledgerSource}`;
  for (const landmark of [
    "data-cockpit-page=\"market\"",
    "data-cockpit-page=\"positions\"",
    "data-cockpit-page=\"execution\"",
    "data-cockpit-page=\"ledger\"",
    "region=\"market-chart\"",
    "region=\"position-table\"",
    "data-cockpit-region=\"review-workbench\"",
    "region=\"execution-timeline\""
  ]) assert.match(pageSources, new RegExp(landmark));
  assert.match(pageSources, /CockpitEmpty/);
  assert.match(cockpit, /buildPositionView/);
  assert.match(cockpit, /buildExecutionView/);
  assert.match(pageSources, /TradingViewChart/);
  assert.doesNotMatch(pageSources, /72,450|8,234|\+12\.4%|0\.0007/);
});

test("overview page exposes the complete reference composition as dedicated regions", () => {
  assert.match(overviewSource, /data-cockpit-page="overview"/);
  for (const region of [
    "portfolio-hero", "dual-notice", "overview-market", "ai-market-read",
    "portfolio-allocation", "recent-trades", "agent-activity", "strategy-footer"
  ]) assert.match(overviewSource, new RegExp(`(?:data-cockpit-region|region)=["'{]+${region}`));
  assert.match(overviewSource, /buildOverviewPresentation/);
  assert.match(overviewSource, /TradingViewChart/);
  assert.doesNotMatch(overviewSource, /72,450|8,234|\+12\.4%|0\.0007/);
});

test("market page exposes the complete reference workspace with real supported controls", () => {
  assert.match(marketSource, /data-cockpit-page="market"/);
  for (const region of [
    "market-header", "market-chart-workspace", "market-state", "watchlist",
    "derivatives", "breadth", "event-catalysts", "ai-market-view", "market-ticker"
  ]) assert.match(marketSource, new RegExp(`(?:data-cockpit-region|region)=["'{]+${region}`));
  assert.match(marketSource, /buildMarketRows/);
  assert.match(marketSource, /TradingViewChart/);
  assert.match(marketSource, /\["1m",\s*"5m",\s*"15m",\s*"1h",\s*"4h",\s*"1D"\]/);
  assert.match(marketSource, /aria-pressed/);
  assert.doesNotMatch(marketSource, /showVolume|\b(?:indicator|save|screenshot|fullscreen)\b/i);
  assert.doesNotMatch(marketSource, /72,450|8,234|\+12\.4%|0\.0007/);
});

test("positions page exposes the complete reference risk workbench", () => {
  assert.equal(positionsModuleExists, true);
  assert.match(positionsSource, /data-cockpit-page="positions"/);
  for (const region of [
    "position-hero", "account-constraints", "position-allocation", "long-short",
    "pnl-distribution", "position-table", "portfolio-pnl-trend", "risk-health",
    "margin-safety", "concentration"
  ]) assert.match(positionsSource, new RegExp(`(?:data-cockpit-region|region)=["'{]+${region}`));
  assert.match(positionsSource, /buildPositionPresentation/);
  assert.match(positionsSource, /stopLoss/);
  assert.match(positionsSource, /takeProfits/);
  assert.match(positionsSource, /executionExitAction/);
  assert.match(positionsSource, /requestExecutionExit/);
});

test("review page exposes the complete reference workbench without mislabeled analytics", () => {
  assert.equal(reviewModuleExists, true);
  assert.match(reviewSource, /data-cockpit-page="execution"/);
  for (const region of [
    "review-hero", "ai-review-conclusion", "review-filters", "trade-list",
    "trade-detail", "trade-path", "hold-pnl-distribution", "behavior-insights", "next-actions"
  ]) assert.match(reviewSource, new RegExp(`(?:data-cockpit-region|region)=["'{]+${region}`));
  assert.match(reviewSource, /buildReviewPresentation/);
  assert.match(reviewSource, /onReviewSelect/);
  assert.doesNotMatch(reviewSource, /profitFactor[^\n]+平均盈亏比/);
});

test("ledger page exposes all eight reference regions and preserves production actions", () => {
  assert.equal(ledgerModuleExists, true);
  assert.match(ledgerSource, /data-cockpit-page="ledger"/);
  for (const region of [
    "execution-hero", "execution-notices", "order-filters", "order-list",
    "order-detail", "execution-timeline", "fill-filters", "fill-ledger"
  ]) assert.match(ledgerSource, new RegExp(`(?:data-cockpit-region|region)=["'{]+${region}`));
  assert.match(ledgerSource, /buildLedgerPresentation/);
  assert.match(ledgerSource, /buildSelectedExecutionStages/);
  assert.match(ledgerSource, /executionExitAction/);
  assert.match(ledgerSource, /requestExecutionExit/);
  assert.match(ledgerSource, /ui\.setActive\("chat"\)/);
  assert.doesNotMatch(ledgerSource, /Awaiting approval|待审批/);
});

test("ledger hero reports the six truthful execution metrics from loaded facts", () => {
  assert.ok(LedgerPage, "LedgerPage must be independently renderable");
  const html = render(LedgerPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      executionOrders: [
        { id: "order-filled", status: "filled", createdAt: "2026-09-03T08:00:00Z" },
        { id: "order-working", status: "open", createdAt: "2026-09-03T07:00:00Z" },
        { id: "order-blocked", status: "risk_blocked", createdAt: "2026-09-03T06:00:00Z" }
      ],
      fills: [{ id: "fill-one", executionOrderId: "order-filled", feeUsdt: -0.75 }],
      tradePlans: [], riskChecks: []
    },
    action() {}, ui: { setActive() {}, refresh() {} }
  });
  const hero = html.match(/<section[^>]*data-cockpit-region="execution-hero"[^]*?<\/section>/)?.[0] || "";
  for (const label of ["全部委托", "进行中", "已成交", "拒绝 / 风控阻断", "成交成功率", "手续费"]) assert.match(hero, new RegExp(label));
  for (const value of ["3", "1", "1", "1", "33\.3%", "-0\.75"]) assert.match(hero, new RegExp(value));
  assert.doesNotMatch(hero, /待审批/);
});

test("ledger selected-order stages never borrow sibling facts and reject ambiguous identities", () => {
  assert.ok(LedgerPage, "LedgerPage must be independently renderable");
  const html = render(LedgerPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      executionOrders: [
        { id: "order-selected", symbol: "BTC/USDT", side: "buy", status: "open", createdAt: "2026-09-03T09:00:00Z" },
        { id: "order-sibling", symbol: "BTC/USDT", side: "buy", status: "filled", tradePlanId: "plan-sibling", exchange: "OKX", createdAt: "2026-09-03T08:00:00Z" }
      ],
      fills: [{ id: "fill-sibling", executionOrderId: "order-sibling", symbol: "BTC/USDT", feeUsdt: -0.2 }],
      tradePlans: [{ id: "plan-sibling", signal: "sibling-only-signal" }],
      riskChecks: [{ id: "risk-sibling", executionOrderId: "order-sibling", tradePlanId: "plan-sibling", status: "passed", summary: "sibling-only-risk" }]
    },
    action() {}, ui: { setActive() {}, refresh() {} }
  });
  assert.match(html, /data-selected-order-id="order-selected"/);
  const timeline = html.match(/<section[^>]*data-cockpit-region="execution-timeline"[^]*?<\/section>/)?.[0] || "";
  for (const stage of ["signal", "risk", "routing", "fill", "protection"]) {
    assert.match(timeline, new RegExp(`data-execution-stage="${stage}"[^>]*data-stage-state="incomplete"`));
  }
  assert.doesNotMatch(timeline, /sibling-only-signal|sibling-only-risk|fill-sibling/);

  const ambiguous = render(LedgerPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      executionOrders: [
        { id: "duplicate", symbol: "SOL/USDT", status: "open" },
        { id: "duplicate", symbol: "ETH/USDT", status: "filled" },
        { id: " ", symbol: "ADA/USDT", status: "open" }
      ],
      fills: [], tradePlans: [], riskChecks: []
    },
    action() {}, ui: { setActive() {}, refresh() {} }
  });
  assert.match(ambiguous, /data-selected-order-id=""/);
  assert.doesNotMatch(ambiguous, /data-order-id=/);
});

test("ledger keeps retained facts visible but blocks actions and terminal stale facts", () => {
  assert.ok(LedgerPage, "LedgerPage must be independently renderable");
  const facts = {
    executionOrders: [{ id: "state-order", symbol: "ETH/USDT", status: "protecting", createdAt: "2026-09-03T08:00:00Z" }],
    fills: [], tradePlans: [], riskChecks: []
  };
  const loaded = render(LedgerPage, { data: { ...facts, resourceState: { cockpit: "loaded" } }, action() {}, ui: { setActive() {}, refresh() {} } });
  assert.match(loaded, /data-order-exit="close_position"/);
  for (const state of ["loading", "stale", "degraded"]) {
    const html = render(LedgerPage, { data: { ...facts, resourceState: { cockpit: state } }, action() {}, ui: { setActive() {}, refresh() {} } });
    assert.match(html, new RegExp(`data-ledger-resource-state="${state}"`));
    assert.match(html, /data-order-id="state-order"/);
    assert.doesNotMatch(html, /data-order-exit/);
  }
  for (const state of ["error", "failed", "forbidden", "disabled"]) {
    const html = render(LedgerPage, { data: { ...facts, resourceState: { cockpit: state } }, action() {}, ui: { setActive() {}, refresh() {} } });
    assert.match(html, new RegExp(`data-ledger-resource-state="${state}"`));
    assert.doesNotMatch(html, /data-order-id="state-order"/);
  }
  const initial = render(LedgerPage, { data: { resourceState: { cockpit: "loading" } }, action() {}, ui: { setActive() {}, refresh() {} } });
  assert.match(initial, /data-ledger-resource-state="loading"/);
  assert.doesNotMatch(initial, /data-cockpit-region="execution-hero"/);
});

test("ledger empty and malformed collections never fabricate order or fill rows", () => {
  assert.ok(LedgerPage, "LedgerPage must be independently renderable");
  const empty = render(LedgerPage, { data: { resourceState: { cockpit: "loaded" }, executionOrders: [], fills: [], tradePlans: [], riskChecks: [] }, action() {}, ui: { setActive() {}, refresh() {} } });
  assert.match(empty, /(?:暂无委托|No orders)/);
  assert.match(empty, /(?:暂无成交|No fills)/);
  assert.doesNotMatch(empty, /data-order-id=/);
  assert.doesNotMatch(empty, /data-fill-id=/);

  const malformed = render(LedgerPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      executionOrders: [null, "bad", {}, { id: "", status: "open" }, { id: "order-valid", symbol: "SUI/USDT", status: "open" }],
      fills: [null, "bad", {}, { id: "", executionOrderId: "order-valid" }, { id: "fill-valid", executionOrderId: "order-valid", symbol: "SUI/USDT" }],
      tradePlans: [null], riskChecks: [null]
    },
    action() {}, ui: { setActive() {}, refresh() {} }
  });
  assert.equal((malformed.match(/data-order-id=/g) || []).length, 1);
  assert.equal((malformed.match(/data-fill-id=/g) || []).length, 1);
});

test("review deep link selects an exact canonical review and matched lifecycle facts", () => {
  const html = render(ReviewPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      performance: { trades: 2, totalPnlUsdt: 10, winRatePct: 50, expectancyUsdt: 5, maxDrawdownPct: 2.4, profitFactor: 1.5 },
      closedTradeLifecycles: [
        { id: "trade-a", symbol: "BTC/USDT", entryPrice: 90, exitPrice: 101, netRealizedPnl: 11, holdMinutes: 45 },
        { id: "trade-b", symbol: "ETH/USDT", entryPrice: 1900, exitPrice: 1940, netRealizedPnl: -1, holdMinutes: 80, strategy: "mean-revert", signal: "retest", pathSamples: [{ at: "2026-09-01T00:00:00Z", pnlUsdt: -2 }, { at: "2026-09-01T01:00:00Z", pnlUsdt: -1 }] }
      ],
      reviews: [
        { id: "review-a", type: "trade", tradeLifecycleId: "trade-a", symbol: "BTC/USDT", status: "completed", summary: "BTC exact review", netRealizedPnl: 999, holdMinutes: 45 },
        { id: "review-b", type: "trade", tradeLifecycleId: "trade-b", symbol: "ETH/USDT", status: "completed", summary: "ETH exact review", netRealizedPnl: 999, holdMinutes: 80, improvement: "Wait for the recorded retest." }
      ],
      behaviorProfile: { strengths: ["Risk guard held."], flags: [{ key: "timing", title: "Timing", detail: "Entry timing repeated." }] }
    },
    initialReviewId: "review-b",
    onReviewSelect() {},
    ui: {}
  });
  assert.match(html, /data-selected-review-id="review-b"/);
  assert.match(html, /data-review-detail-id="review-b"/);
  assert.match(html, /ETH exact review/);
  assert.match(html, /-1\.00/);
  assert.doesNotMatch(html, /999\.00/);
  assert.match(html, /data-review-path-samples="2"/);
});

test("review malformed or unmatched deep links fail closed instead of selecting another review", () => {
  const data = {
    resourceState: { cockpit: "loaded" },
    performance: {}, closedTradeLifecycles: [],
    reviews: [{ id: "review-real", type: "trade", symbol: "BTC/USDT", status: "completed", summary: "Must not be selected" }]
  };
  for (const initialReviewId of ["review-missing", "   ", { id: "review-real" }]) {
    const html = render(ReviewPage, { data, initialReviewId, onReviewSelect() {}, ui: {} });
    assert.match(html, /data-selected-review-id=""/);
    assert.doesNotMatch(html, /data-review-detail-id="review-real"/);
  }
});

test("review keeps unavailable analytics unavailable and never turns aggregate trajectory metadata into a path", () => {
  const html = render(ReviewPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      performance: { trades: 1, totalPnlUsdt: 3, winRatePct: 100, avgPnlUsdt: 3 },
      closedTradeLifecycles: [{ id: "trade-one", symbol: "SOL/USDT", netRealizedPnl: 3, holdMinutes: 12, trajectory: { note: "aggregate only", candles: 9 } }],
      reviews: [{ id: "review-one", type: "trade", tradeLifecycleId: "trade-one", symbol: "SOL/USDT", status: "completed", summary: "Recorded outcome", trajectory: { note: "aggregate only", candles: 9 } }],
      behaviorProfile: {}
    },
    ui: {}
  });
  const hero = html.match(/<section[^>]*data-cockpit-region="review-hero"[^]*?<\/section>/)?.[0] || "";
  assert.match(hero, /(?:单笔期望|Expectancy)/);
  assert.match(hero, /(?:最大回撤|Max drawdown)/);
  assert.match(hero, /Profit Factor/);
  assert.ok((hero.match(/(?:不可用|Unavailable)/g) || []).length >= 3);
  assert.match(html, /(?:未记录逐时路径|No intratrade path recorded)/);
  assert.doesNotMatch(html, /data-review-path-samples="[1-9]/);
  assert.match(html, /(?:暂无已记录行动|No recorded next actions)/);
});

test("review system health is unavailable without a real health fact", () => {
  const base = {
    resourceState: { cockpit: "loaded" },
    performance: { trades: 1, totalPnlUsdt: 3, winRatePct: 100, expectancyUsdt: 3, maxDrawdownPct: 1, profitFactor: 2 },
    closedTradeLifecycles: [{ id: "trade-health", netRealizedPnl: 3 }],
    reviews: [{ id: "review-health", type: "trade", tradeLifecycleId: "trade-health", status: "completed" }]
  };
  const unavailableHtml = render(ReviewPage, { data: base, ui: {} });
  const unavailableHero = unavailableHtml.match(/<section[^>]*data-cockpit-region="review-hero"[^]*?<\/section>/)?.[0] || "";
  assert.match(unavailableHero, /(?:系统状态|System health)[^]*?(?:不可用|Unavailable)/);
  assert.doesNotMatch(unavailableHero, /(?:正常|Healthy)/);

  const degradedHtml = render(ReviewPage, { data: { ...base, system: { apiHealth: "degraded" } }, ui: {} });
  const degradedHero = degradedHtml.match(/<section[^>]*data-cockpit-region="review-hero"[^]*?<\/section>/)?.[0] || "";
  assert.match(degradedHero, /(?:degraded|降级)/i);
});

test("cockpit URL state scopes review restoration without rewriting unknown routes", () => {
  assert.equal(cockpitRouteFromPath("/app/trade/reviews/REV%3A389%2Falpha"), "tradeReviewDetail:REV:389/alpha");
  assert.equal(cockpitPathForRoute("tradeReviewDetail:REV:389/alpha"), "/app/trade/reviews/REV%3A389%2Falpha");
  assert.equal(cockpitRouteFromPath("/app/trade/execution-review"), "tradeJournal");
  assert.equal(cockpitRouteFromPath("/app/settings/security"), null);
  assert.equal(cockpitPathForRoute("unknown-route"), null);
  assert.equal(cockpitRouteFromPath("/app/trade/reviews/%E0%A4%A"), null);
  const calls = [];
  assert.equal(syncCockpitHistory("unknown-route", { history: { pushState: (...args) => calls.push(args) }, location: { pathname: "/custom", search: "", hash: "" } }), false);
  assert.deepEqual(calls, []);
});

test("every desktop cockpit alias owns one truthful canonical URL", () => {
  const aliases = new Map([
    ["cockpit", "/app/trade/overview"],
    ["marketAccount", "/app/trade/overview"],
    ["market", "/app/trade/market"],
    ["positions", "/app/trade/positions"],
    ["portfolioProtection", "/app/trade/positions"],
    ["signalHub", "/app/trade/execution-review"],
    ["tradeJournal", "/app/trade/execution-review"],
    ["executionReview", "/app/trade/execution-review"],
    ["tradeReviewDetail", "/app/trade/execution-review"],
    ["labReviews", "/app/trade/execution-review"],
    ["ownerReviewWorkspace", "/app/trade/execution-review"],
    ["tradeLedger", "/app/trade/orders-fills"],
    ["tradeOrders", "/app/trade/orders-fills"],
    ["tradeFills", "/app/trade/orders-fills"]
  ]);
  for (const [route, path] of aliases) {
    assert.equal(cockpitPathForRoute(route), path, `${route} canonicalizes to ${path}`);
  }
});

test("cockpit history exits through app root and restores safe popstate routes", () => {
  const calls = [];
  const history = {
    state: { retained: true },
    pushState: (...args) => calls.push(["push", ...args]),
    replaceState: (...args) => calls.push(["replace", ...args])
  };
  const cockpitLocation = { pathname: "/app/trade/overview", search: "?tenant=owner", hash: "#trace", protocol: "https:" };

  assert.equal(syncCockpitHistory("riskOverview", { history, location: cockpitLocation }), true);
  assert.deepEqual(calls[0], ["push", { retained: true, kordynRoute: "riskOverview" }, "", "/app?tenant=owner#trace"]);
  const recognizedNonCockpit = new Set(["chat", "riskOverview", "systemSettings"]);
  const historyOptions = { isRecognizedRoute: (route) => recognizedNonCockpit.has(route) };
  assert.equal(cockpitRouteFromHistory("/app", { kordynRoute: "riskOverview" }, historyOptions), "riskOverview");
  assert.equal(cockpitRouteFromHistory("/app", { kordynRoute: "systemSettings" }, historyOptions), "systemSettings");
  assert.equal(cockpitRouteFromHistory("/app/", null), "chat");
  assert.equal(cockpitRouteFromHistory("/app", { kordynRoute: { unsafe: true } }), "chat");
  assert.equal(cockpitRouteFromHistory("/app", { kordynRoute: " ../outside " }), "chat");
  assert.equal(cockpitRouteFromHistory("/app", { kordynRoute: "retiredCockpitAlias" }, historyOptions), "chat");
  for (const forgedRoute of [
    "cockpit", "market", "marketAccount", "positions", "portfolioProtection",
    "signalHub", "tradeJournal", "executionReview", "tradeReviewDetail", "labReviews",
    "ownerReviewWorkspace", "tradeLedger", "tradeOrders", "tradeFills",
    "tradeReviewDetail:review-18"
  ]) {
    assert.equal(cockpitRouteFromHistory("/app", { kordynRoute: forgedRoute }, historyOptions), "chat", `${forgedRoute} cannot restore cockpit under /app`);
  }
  assert.equal(cockpitRouteFromHistory("/outside", { kordynRoute: "chat" }), null);

  const externalCalls = [];
  assert.equal(syncCockpitHistory("chat", {
    history: { pushState: (...args) => externalCalls.push(args) },
    location: { pathname: "/outside", search: "", hash: "", protocol: "https:" }
  }), false);
  assert.equal(syncCockpitHistory("marketAccount", {
    history: { pushState: (...args) => externalCalls.push(args) },
    location: { pathname: "/outside", search: "", hash: "", protocol: "https:" }
  }), false);
  assert.deepEqual(externalCalls, []);
});

test("review survives malformed collections and preserves retained versus terminal resource states", () => {
  const facts = {
    performance: { trades: 1, totalPnlUsdt: 2 },
    closedTradeLifecycles: [null, "bad", { id: "trade-state", netRealizedPnl: 2, holdMinutes: 20 }],
    reviews: [null, {}, { id: "", type: "trade" }, { id: "review-state", type: "trade", tradeLifecycleId: "trade-state", status: "completed", summary: "Retained review" }],
    behaviorProfile: { strengths: null, flags: [null, {}] }
  };
  for (const state of ["loading", "stale", "degraded"]) {
    assert.doesNotThrow(() => render(ReviewPage, { data: { ...facts, resourceState: { cockpit: state } }, ui: {} }));
    const html = render(ReviewPage, { data: { ...facts, resourceState: { cockpit: state } }, ui: {} });
    assert.match(html, new RegExp(`data-review-resource-state="${state}"`));
    assert.match(html, /data-cockpit-region="review-hero"/);
  }
  for (const state of ["error", "failed", "forbidden", "disabled"]) {
    const html = render(ReviewPage, { data: { ...facts, resourceState: { cockpit: state } }, ui: {} });
    assert.match(html, new RegExp(`data-review-resource-state="${state}"`));
    assert.doesNotMatch(html, /data-cockpit-region="review-hero"/);
  }
  const initial = render(ReviewPage, { data: { resourceState: { cockpit: "loading" } }, ui: {} });
  assert.match(initial, /data-review-resource-state="loading"/);
  assert.doesNotMatch(initial, /data-cockpit-region="review-hero"/);
});

test("positions renders a positionId-only row with only its exact protection and execution identity", () => {
  const html = render(PositionsPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      portfolio: { totalEquityUsdt: 10_000, availableMarginUsdt: 8_000 },
      portfolioRisk: { utilizationPct: 20, status: "ok" },
      positions: [
        { positionId: "ord-collision", symbol: "BTC/USDT", source: "execution_engine", direction: "long", quantity: 1, markPrice: 100, entryPrice: 98, unrealizedPnl: 2, margin: 20, leverage: 3, liquidationPrice: 70 },
        { positionId: "other-position", executionOrderId: "ord-collision", symbol: "BTC/USDT", source: "execution_engine", direction: "short", quantity: 2, markPrice: 100, entryPrice: 102, unrealizedPnl: -4, margin: 40, leverage: 2, liquidationPrice: 140 }
      ],
      executionOrders: [
        { id: "ord-collision", positionId: "other-position", tradePlanId: "wrong-plan", symbol: "BTC/USDT", status: "protecting" },
        { id: "exact-execution", positionId: "ord-collision", tradePlanId: "exact-plan", symbol: "BTC/USDT", status: "protecting" }
      ],
      tradePlans: [
        { id: "exact-plan", stopLoss: 91.25, takeProfit: [112.5, 118.75] },
        { id: "wrong-plan", stopLoss: 13.37, takeProfit: [14.88] }
      ],
      accountSnapshots: [
        { id: "s1", createdAt: "2026-09-03T08:00:00Z", totalEquityUsdt: 9_980 },
        { id: "s2", createdAt: "2026-09-03T09:00:00Z", totalEquityUsdt: 10_000 }
      ]
    },
    action() {},
    ui: { ensureSection() {}, refresh() {} }
  });
  assert.match(html, /data-position-id="ord-collision"/);
  assert.match(html, /data-execution-id="exact-execution"/);
  assert.match(html, /91\.25/);
  assert.match(html, /112\.50/);
  assert.match(html, /118\.75/);
  const exactRow = html.match(/<tbody data-position-id="ord-collision"[^]*?<\/tbody>/)?.[0] || "";
  assert.doesNotMatch(exactRow, /13\.37|14\.88/);
  assert.match(html, /(?:市价平仓|Close at market)/);
});

test("positions keeps absent financial and protection facts unavailable", () => {
  const html = render(PositionsPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      portfolio: {},
      portfolioRisk: {},
      positions: [{ positionId: "missing-facts", symbol: "ETH/USDT", direction: "long", quantity: 1 }],
      executionOrders: [],
      tradePlans: [],
      accountSnapshots: []
    },
    action() {},
    ui: { ensureSection() {}, refresh() {} }
  });
  assert.match(html, /data-position-id="missing-facts"/);
  assert.match(html, /(?:未登记|Not registered)/);
  assert.match(html, /(?:不可用|Unavailable)/);
  assert.doesNotMatch(html, /data-position-id="missing-facts"[^]*>0\.00\s*(?:U|USDT|%|x)/);
  assert.doesNotMatch(html, /(?:市价平仓|Close at market)/);
});

test("positions authorizes exits only from one exact execution with a canonical id", () => {
  const html = render(PositionsPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      positions: [
        { positionId: "p-explicit", executionOrderId: "alias-explicit", symbol: "BTC/USDT", direction: "long", notionalUsdt: 100 },
        { positionId: "p-fallback", symbol: "ETH/USDT", direction: "short", notionalUsdt: 80 },
        { positionId: "p-ambiguous", symbol: "SOL/USDT", direction: "long", notionalUsdt: 60 }
      ],
      executionOrders: [
        { orderId: "alias-explicit", positionId: "p-explicit", status: "protecting" },
        { orderId: "alias-fallback", positionId: "p-fallback", status: "protecting" },
        { id: "ambiguous-one", positionId: "p-ambiguous", status: "protecting" },
        { id: "ambiguous-two", positionId: "p-ambiguous", status: "protecting" }
      ],
      tradePlans: [], accountSnapshots: [], portfolio: {}, portfolioRisk: {}
    },
    action() {},
    ui: {}
  });
  assert.equal((html.match(/data-position-exit/g) || []).length, 0);
  assert.doesNotMatch(html, /(?:市价平仓|Close at market)/);
});

test("positions labels partial composition instead of calculating a known-row remainder", () => {
  const partial = render(PositionsPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      positions: [
        { positionId: "known-long", symbol: "BTC/USDT", direction: "long", notionalUsdt: 100, unrealizedPnl: 2 },
        { positionId: "unknown-composition", symbol: "ETH/USDT", quantity: 1, unrealizedPnl: -1 }
      ],
      executionOrders: [], tradePlans: [], accountSnapshots: [], portfolio: {}, portfolioRisk: {}
    },
    action() {},
    ui: {}
  });
  const allocation = partial.match(/<section[^>]*data-cockpit-region="position-allocation"[^]*?<\/section>/)?.[0] || "";
  const longShort = partial.match(/<section[^>]*data-cockpit-region="long-short"[^]*?<\/section>/)?.[0] || "";
  const concentration = partial.match(/<section[^>]*data-cockpit-region="concentration"[^]*?<\/section>/)?.[0] || "";
  assert.match(allocation, /(?:持仓分布不完整|Position allocation incomplete)/);
  assert.match(longShort, /(?:多空分布不完整|Long \/ short distribution incomplete)/);
  assert.doesNotMatch(longShort, /100\.0%/);
  assert.match(concentration, /(?:集中度数据不完整|Concentration data incomplete)/);
  assert.doesNotMatch(concentration, /(?:空仓，无集中度风险|Flat; no concentration risk)/);

  const flat = render(PositionsPage, {
    data: { resourceState: { cockpit: "loaded" }, positions: [], executionOrders: [], tradePlans: [], accountSnapshots: [], portfolio: {}, portfolioRisk: {} },
    action() {}, ui: {}
  });
  assert.match(flat, /(?:当前空仓，暂无持仓分布|Currently flat; no position allocation)/);
  assert.match(flat, /(?:当前空仓，暂无方向敞口|Currently flat; no directional exposure)/);
});

test("positions requires every notional-bearing row to have a valid direction", () => {
  const html = render(PositionsPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      positions: [
        { positionId: "known-long", symbol: "BTC/USDT", direction: "long", notionalUsdt: 100 },
        { positionId: "unknown-side", symbol: "ETH/USDT", notionalUsdt: 100 }
      ],
      executionOrders: [], tradePlans: [], accountSnapshots: [], portfolio: {}, portfolioRisk: {}
    },
    action() {}, ui: {}
  });
  const longShort = html.match(/<section[^>]*data-cockpit-region="long-short"[^]*?<\/section>/)?.[0] || "";
  const concentration = html.match(/<section[^>]*data-cockpit-region="concentration"[^]*?<\/section>/)?.[0] || "";
  assert.match(longShort, /(?:多空分布不完整|Long \/ short distribution incomplete)/);
  assert.doesNotMatch(longShort, /100\.0%/);
  assert.match(concentration, /(?:集中度数据不完整|Concentration data incomplete)/);
});

test("positions empty and malformed inputs cannot fabricate rows, metrics, protection, or actions", () => {
  const base = { resourceState: { cockpit: "loaded" }, portfolio: {}, portfolioRisk: {}, executionOrders: [], tradePlans: [], accountSnapshots: [] };
  const empty = render(PositionsPage, { data: { ...base, positions: [] }, action() {}, ui: {} });
  assert.match(empty, /(?:暂无持仓|No positions)/);
  assert.doesNotMatch(empty, /data-position-id=/);
  assert.doesNotMatch(empty, /(?:市价平仓|Close at market)/);

  const malformed = { ...base, positions: [null, "bad", {}, { id: "", symbol: "", status: "protecting" }, { symbol: " ", status: "protecting" }] };
  assert.doesNotThrow(() => render(PositionsPage, { data: malformed, action() {}, ui: {} }));
  const malformedHtml = render(PositionsPage, { data: malformed, action() {}, ui: {} });
  assert.doesNotMatch(malformedHtml, /data-position-id=/);
  assert.doesNotMatch(malformedHtml, /(?:市价平仓|Close at market)/);
});

test("positions honors loaded, retained, and terminal resource boundaries", () => {
  const facts = {
    portfolio: { totalEquityUsdt: 10_000, availableMarginUsdt: 8_000 },
    portfolioRisk: { utilizationPct: 20, status: "ok" },
    positions: [{ positionId: "state-position", symbol: "SOL/USDT", direction: "long", quantity: 1, markPrice: 100 }],
    executionOrders: [{ id: "state-execution", positionId: "state-position", status: "protecting" }],
    tradePlans: [], accountSnapshots: []
  };
  for (const state of ["loading", "stale", "degraded"]) {
    const html = render(PositionsPage, { data: { ...facts, resourceState: { cockpit: state } }, action() {}, ui: {} });
    assert.match(html, new RegExp(`data-position-resource-state="${state}"`));
    assert.match(html, /data-position-id="state-position"/);
    assert.doesNotMatch(html, /(?:市价平仓|Close at market)/);
  }
  for (const state of ["error", "failed", "forbidden", "disabled"]) {
    const html = render(PositionsPage, { data: { ...facts, resourceState: { cockpit: state } }, action() {}, ui: {} });
    assert.match(html, new RegExp(`data-position-resource-state="${state}"`));
    assert.doesNotMatch(html, /data-position-id="state-position"/);
    assert.doesNotMatch(html, /(?:市价平仓|Close at market)/);
  }
  const initial = render(PositionsPage, { data: { resourceState: { cockpit: "loading" } }, action() {}, ui: {} });
  assert.match(initial, /data-position-resource-state="loading"/);
  assert.doesNotMatch(initial, /data-cockpit-region="position-hero"/);
});

test("market rejects malformed pair identities", () => {
  const ui = { ensureSection() {}, refresh() {} };
  const malformed = [" ", "/USDT", "BTC/", {}, []];
  for (const symbol of malformed) {
    const data = {
      resourceState: { cockpit: "loaded" },
      markets: [{ id: "bad-market", symbol, price: 100 }],
      activeMarket: { id: "bad-active", symbol, price: 100 },
      watchlist: [symbol],
      events: []
    };
    assert.doesNotThrow(() => render(MarketPage, { data, ui }), `malformed ${JSON.stringify(symbol)} cannot crash Market`);
    const html = render(MarketPage, { data, ui });
    assert.match(html, /data-market-symbol=""/);
    assert.doesNotMatch(html, /class="tvChart"/);
  }
});

test("market trims a valid pair into one canonical identity", () => {
  const canonical = render(MarketPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      markets: [{ id: "btc", symbol: "  BTC/USDT  ", price: 100 }],
      activeMarket: { id: "btc-active", symbol: " BTC/USDT ", price: 100 },
      watchlist: [" BTC/USDT "],
      events: []
    },
    ui: { ensureSection() {}, refresh() {} }
  });
  assert.match(canonical, /data-market-symbol="BTC\/USDT"/);
  assert.match(canonical, /<option value="BTC\/USDT" selected="">BTC\/USDT<\/option>/);
  assert.doesNotMatch(canonical, /data-market-symbol="\s+BTC\/USDT/);
});

test("market loading retains a real event but rejects an empty event shell as evidence", () => {
  const ui = { ensureSection() {}, refresh() {} };
  const valid = render(MarketPage, {
    data: {
      resourceState: { cockpit: "loading" },
      events: [{ id: "event-cpi", title: "CPI release", due: "2026-09-05T00:00:00Z", importance: "high", source: "official-calendar" }]
    },
    ui
  });
  assert.match(valid, /data-market-resource-state="loading"/);
  assert.match(valid, /data-cockpit-region="market-header"/);
  assert.match(valid, /CPI release/);

  const emptyShell = render(MarketPage, { data: { resourceState: { cockpit: "loading" }, events: [{}] }, ui });
  assert.match(emptyShell, /data-market-resource-state="loading"/);
  assert.doesNotMatch(emptyShell, /data-cockpit-region="market-header"/);
  assert.doesNotMatch(emptyShell, /(?:Market event|Recorded)/);
});

test("market rejects an importance-only event as catalyst evidence", () => {
  const ui = { ensureSection() {}, refresh() {} };
  const loading = render(MarketPage, {
    data: { resourceState: { cockpit: "loading" }, events: [{ id: "severity-shell", importance: "high", impact: 90 }] },
    ui
  });
  assert.match(loading, /data-market-resource-state="loading"/);
  assert.doesNotMatch(loading, /data-cockpit-region="market-header"/);

  const loaded = render(MarketPage, {
    data: { resourceState: { cockpit: "loaded" }, markets: [], activeMarket: null, watchlist: [], events: [{ id: "severity-shell", importance: "high", impact: 90 }] },
    ui
  });
  assert.match(loaded, /(?:暂无已记录事件|No recorded events)/);
  assert.doesNotMatch(loaded, /class="marketEventRows"/);
});

test("market rejects a date-only event as catalyst evidence", () => {
  const ui = { ensureSection() {}, refresh() {} };
  const loading = render(MarketPage, {
    data: { resourceState: { cockpit: "loading" }, events: [{ id: "date-shell", due: "2026-09-05T00:00:00Z", startAt: "2026-09-05T00:00:00Z" }] },
    ui
  });
  assert.match(loading, /data-market-resource-state="loading"/);
  assert.doesNotMatch(loading, /data-cockpit-region="market-header"/);

  const loaded = render(MarketPage, {
    data: { resourceState: { cockpit: "loaded" }, markets: [], activeMarket: null, watchlist: [], events: [{ id: "date-shell", createdAt: "2026-09-05T00:00:00Z" }] },
    ui
  });
  assert.match(loaded, /(?:暂无已记录事件|No recorded events)/);
  assert.doesNotMatch(loaded, /class="marketEventRows"/);
});

test("market accepts a title-only event as descriptive catalyst evidence", () => {
  const html = render(MarketPage, {
    data: { resourceState: { cockpit: "loading" }, events: [{ id: "title-only", shortTitle: "FOMC decision" }] },
    ui: { ensureSection() {}, refresh() {} }
  });
  assert.match(html, /data-cockpit-region="market-header"/);
  assert.match(html, /FOMC decision/);
  assert.match(html, /class="marketEventRows"/);
});

test("market accepts a detail-only event as descriptive catalyst evidence", () => {
  const html = render(MarketPage, {
    data: { resourceState: { cockpit: "loading" }, events: [{ id: "detail-only", summary: "Official policy guidance updated" }] },
    ui: { ensureSection() {}, refresh() {} }
  });
  assert.match(html, /data-cockpit-region="market-header"/);
  assert.match(html, /Official policy guidance updated/);
  assert.match(html, /class="marketEventRows"/);
});

test("market event renderer filters malformed shells without inventing catalyst facts", () => {
  const html = render(MarketPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      markets: [],
      activeMarket: null,
      watchlist: [],
      events: [null, {}, [], "event", { title: "  " }]
    },
    ui: { ensureSection() {}, refresh() {} }
  });
  assert.match(html, /(?:暂无已记录事件|No recorded events)/);
  assert.doesNotMatch(html, /(?:Market event|Recorded)/);
});

test("market preserves an orphaned saved pair as removable unavailable evidence", () => {
  const html = render(MarketPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      markets: [{ id: "btc", symbol: "BTC/USDT", price: 100 }],
      activeMarket: { id: "btc-active", symbol: "BTC/USDT", price: 100 },
      watchlist: [" BTC/USDT ", { symbol: " DOGE/USDT " }],
      events: []
    },
    action() {},
    ui: { ensureSection() {}, refresh() {} }
  });
  assert.match(html, /data-market-watch-unavailable="DOGE\/USDT"/);
  assert.match(html, /DOGE\/USDT/);
  assert.match(html, /(?:从自选移除 DOGE\/USDT|Remove DOGE\/USDT from watchlist)/);
  assert.match(html, /(?:行情不可用|Quote unavailable)/);
  assert.doesNotMatch(html, /data-market-watch-select="DOGE\/USDT"/);
});

test("cockpit visual tokens and responsive contracts match the approved reference family", () => {
  for (const token of [
    "--cockpit-canvas",
    "--cockpit-surface",
    "--cockpit-text",
    "--cockpit-text-2",
    "--cockpit-text-3",
    "--cockpit-brand",
    "--cockpit-positive",
    "--cockpit-negative",
    "--cockpit-warning",
    "--cockpit-border",
    "--cockpit-hairline",
    "--cockpit-radius"
  ]) assert.match(cockpitCss, new RegExp(token));
  assert.match(cockpitCss, /\.tradingCockpit/);
  assert.match(cockpitCss, /@media \(max-width: 1280px\)/);
  assert.match(cockpitCss, /@media \(max-width: 1100px\)/);
  assert.match(cockpitCss, /:focus-visible/);
  assert.doesNotMatch(cockpitCss, /!important/);
  assert.doesNotMatch(cockpitCss, /#[Cc][Cc][Ff][Ff]3[Dd]|box-shadow:\s*\d+px\s+\d+px\s+0/);
});

test("cockpit primitives live in dedicated shared and visual modules", async () => {
  for (const modulePath of [
    "../src/aug15/tradingCockpit/shared.jsx",
    "../src/aug15/tradingCockpit/visuals.jsx"
  ]) assert.equal(await exists(new URL(modulePath, import.meta.url)), true);

  assert.doesNotMatch(cockpit, /function (?:Panel|Metric|MiniTrend|DataTable)\(/);
});

test("cockpit visuals reject null and blank financial values instead of coercing them to zero", () => {
  for (const value of [null, "", " "]) {
    assert.match(render(GaugeChart, { value, label: "Risk" }), /cockpitChartUnavailable/);
  }
  assert.match(render(AreaTrend, { values: [null, ""], label: "Equity" }), /cockpitChartUnavailable/);
  assert.match(render(DistributionPlot, { values: [null, ""], label: "Returns" }), /cockpitChartUnavailable/);
  assert.match(render(BreadthBars, { items: [{ label: "Up", value: null }, { label: "Down", value: "" }], ariaLabel: "Breadth" }), /cockpitChartUnavailable/);
  assert.match(render(DonutChart, { segments: [], value: "—", label: "Allocation", ariaLabel: "Allocation unavailable" }), /cockpitChartUnavailable/);
});

test("cockpit visuals tolerate explicit null collections and malformed collection entries", () => {
  for (const [Component, props] of [
    [DonutChart, { segments: null, value: "—", label: "Allocation", ariaLabel: "Allocation unavailable" }],
    [AreaTrend, { values: null, label: "Equity" }],
    [DistributionPlot, { values: null, label: "Returns" }],
    [BreadthBars, { items: null, ariaLabel: "Breadth" }]
  ]) {
    assert.doesNotThrow(() => render(Component, props));
    assert.match(render(Component, props), /cockpitChartUnavailable/);
  }

  assert.doesNotThrow(() => render(DonutChart, {
    segments: [null, { value: 2, color: "#21875a" }],
    value: "2",
    label: "Positions",
    ariaLabel: "Position allocation"
  }));
  assert.doesNotThrow(() => render(BreadthBars, {
    items: [null, { label: "Advancing", value: 25 }],
    ariaLabel: "Market breadth"
  }));
});

test("a populated cockpit table uses a data-purpose name, never its empty-state title", () => {
  const props = {
    columns: [{ key: "symbol", label: "Pair" }],
    rows: [{ id: "row-1", symbol: "BTC/USDT" }],
    emptyTitle: "No orders"
  };
  const fallback = render(CockpitTable, props);
  assert.match(fallback, /aria-label="(?:交易数据|Trading data)"/);
  assert.doesNotMatch(fallback, /aria-label="No orders"/);
  assert.match(render(CockpitTable, { ...props, label: "Active orders" }), /aria-label="Active orders"/);
});

test("the authenticated browser harness can prove honest empty states without production writes", () => {
  assert.match(browserHarness, /query\.get\("empty"\) === "1"/);
  assert.match(browserHarness, /positions:\s*\[\]/);
  assert.match(browserHarness, /executionOrders:\s*\[\]/);
  assert.match(browserHarness, /closedTradeLifecycles:\s*\[\]/);
  assert.match(browserHarness, /query\.get\("capture"\) === "1"/);
  assert.match(browserHarness, /window\.__cockpitLastAction/);
});

test("browser fixture is dense, synthetic, and serves the real K-line schema", () => {
  assert.match(browserHarness, /dataset\.fixtureKind\s*=\s*"production-shaped-synthetic"/);
  assert.match(browserHarness, /\/api\/market\/klines/);
  assert.match(browserHarness, /candles:\s*fixtureCandles/);
  assert.match(browserHarness, /Array\.from\(\{ length: 32 \}/);
  assert.match(browserHarness, /Array\.from\(\{ length: 24 \}/);
  assert.match(browserHarness, /Array\.from\(\{ length: 27 \}/);
});

test("overview browser fixture keeps production cockpit shape distinct from opt-in enrichment", () => {
  assert.match(browserHarness, /query\.get\("enriched"\) === "1"/);
  assert.match(browserHarness, /const enrichment =/);
  assert.match(browserHarness, /resourceState:\s*\{\s*cockpit:\s*"loaded"\s*\}/);
  assert.match(browserHarness, /query\.get\("resource"\)/);
  assert.match(browserHarness, /query\.get\("chart"\)/);
});

test("overview enables the optional real candle-volume chart layer and honest chart statuses", () => {
  assert.match(overviewSource, /showVolume/);
  assert.match(librarySource, /showVolume\s*=\s*false/);
  assert.match(librarySource, /HistogramSeries/);
  assert.match(librarySource, /volume:\s*c\.volume == null/);
  assert.match(librarySource, /data-volume-series/);
  assert.match(librarySource, /status === "error"/);
});

test("overview renderer survives production-shaped missing and malformed collections", () => {
  const props = {
    data: {
      resourceState: { cockpit: "loaded" },
      portfolio: { totalEquityUsdt: 100, availableMarginUsdt: 99 },
      portfolioRisk: { utilizationPct: 37, status: "ok" },
      markets: [{ symbol: "BTC/USDT", price: 100, volume24h: 12 }],
      activeMarket: { symbol: "BTC/USDT", price: 100, volume24h: 12 },
      positions: [null, { positionId: "p-1", symbol: "BTC/USDT", quantity: 1 }],
      fills: [null, { id: "f-1", kind: "trade_fill", executionOrderId: "o-1" }],
      executionOrders: [null, { id: "o-1" }],
      accountSnapshots: [null, { id: "s-1", createdAt: "2026-09-03T08:00:00Z", totalEquityUsdt: 100 }]
    },
    ui: { setActive() {}, ensureSection() {}, refresh() {} }
  };
  assert.doesNotThrow(() => render(OverviewPage, props));
  const html = render(OverviewPage, props);
  assert.match(html, /data-resource-state="loaded"/);
  assert.match(html, /data-volume-series="loading"/);
  assert.match(html, />37</);

  const failed = render(OverviewPage, { ...props, data: { ...props.data, resourceState: { cockpit: "error" } } });
  assert.match(failed, /data-overview-resource-state="error"/);
  assert.doesNotMatch(failed, /class="tvChart"/);
});

test("overview renders loading with last-valid facts but blocks initial loading and terminal resource states", () => {
  const ui = { setActive() {}, ensureSection() {}, refresh() {} };
  const facts = {
    portfolio: { totalEquityUsdt: 100, availableMarginUsdt: 80 },
    portfolioRisk: { utilizationPct: 20, status: "ok" },
    markets: [{ symbol: "BTC/USDT", price: 100 }],
    activeMarket: { symbol: "BTC/USDT", price: 100 },
    positions: [],
    notifications: [],
    accountSnapshots: []
  };
  const loadingWithFacts = render(OverviewPage, { data: { ...facts, resourceState: { cockpit: "loading" } }, ui });
  assert.match(loadingWithFacts, /data-overview-resource-state="loading"/);
  assert.match(loadingWithFacts, /data-cockpit-region="portfolio-hero"/);
  assert.doesNotMatch(loadingWithFacts, /class="tvChart"/);

  const initialLoading = render(OverviewPage, { data: { resourceState: { cockpit: "loading" } }, ui });
  assert.match(initialLoading, /data-overview-resource-state="loading"/);
  assert.doesNotMatch(initialLoading, /data-cockpit-region="portfolio-hero"/);

  for (const state of ["failed", "forbidden", "disabled"]) {
    const html = render(OverviewPage, { data: { ...facts, resourceState: { cockpit: state } }, ui });
    assert.match(html, new RegExp(`data-overview-resource-state="${state}"`));
    assert.doesNotMatch(html, /data-cockpit-region="portfolio-hero"/);
  }

  const unknown = render(OverviewPage, { data: { ...facts, resourceState: { cockpit: "future_state" } }, ui });
  assert.match(unknown, /data-resource-state="not_loaded"/);
  assert.match(unknown, /data-overview-resource-state="not_loaded"/);
  assert.doesNotMatch(unknown, /data-cockpit-region="portfolio-hero"/);
});

test("overview loading retains each truthful notice, boundary, and activity fact but rejects empty shells", () => {
  const ui = { setActive() {}, ensureSection() {}, refresh() {} };
  const retainedCases = [
    ["notification", { notifications: [{ id: "n-1", title: "Account reconciliation complete" }] }, /Account reconciliation complete/],
    ["kill switch", { system: { killSwitch: true } }, /overviewHeroRuntime/],
    ["daily loss", { system: { remainingDailyLossUsdt: 12.5 } }, /12\.50 U/],
    ["Agent activity", { agentRuns: [{ id: "run-1", goal: "Refresh market evidence", status: "completed" }] }, /Refresh market evidence/],
    ["job activity", { jobRuns: [{ id: "job-1", name: "Reconcile account", status: "completed" }] }, /Reconcile account/]
  ];
  for (const [label, facts, renderedFact] of retainedCases) {
    const html = render(OverviewPage, { data: { resourceState: { cockpit: "loading" }, ...facts }, ui });
    assert.match(html, /data-overview-resource-state="loading"/, `${label} keeps the truthful loading banner`);
    assert.match(html, /data-cockpit-region="portfolio-hero"/, `${label} retains the Overview body`);
    assert.match(html, renderedFact, `${label} remains visible`);
    assert.doesNotMatch(html, /class="tvChart"/, `${label} does not authorize current candles while loading`);
  }

  for (const facts of [{ system: {} }, { marketRegime: {} }, { system: {}, marketRegime: { global: {} } }]) {
    const html = render(OverviewPage, { data: { resourceState: { cockpit: "loading" }, ...facts }, ui });
    assert.match(html, /data-overview-resource-state="loading"/);
    assert.doesNotMatch(html, /data-cockpit-region="portfolio-hero"/);
  }
});

test("overview keeps blank PnL and risk numbers unavailable in rendered output", () => {
  const html = render(OverviewPage, {
    data: {
      resourceState: { cockpit: "loaded" },
      portfolio: { totalEquityUsdt: 100, todayPnl: " ", todayPnlPct: "\t", unrealizedPnl: "\n", availableMarginUsdt: 80 },
      portfolioRisk: { utilizationPct: "   ", status: "ok" },
      markets: [{ symbol: "BTC/USDT", price: 100, changePct: " ", volume24h: "\t" }],
      activeMarket: { symbol: "BTC/USDT", price: 100, changePct: " ", volume24h: "\t" },
      positions: [{ positionId: "p-blank", symbol: "BTC/USDT", quantity: 1, notionalUsdt: 50, unrealizedPnl: " " }],
      accountSnapshots: []
    },
    ui: { setActive() {}, ensureSection() {}, refresh() {} }
  });
  assert.doesNotMatch(html, /\+0\.00/);
  assert.doesNotMatch(html, />0\.00%</);
  assert.match(html, /cockpitChartUnavailable/);
});

test("overview browser gate covers resource states, readable text, and keyboard target geometry", () => {
  assert.match(browserRunner, /KORDYN_COCKPIT_STATE/);
  assert.match(browserRunner, /resourceState/);
  assert.match(browserRunner, /minOverviewTextPx/);
  assert.match(browserRunner, /minKeyboardTargetPx/);
  assert.match(browserRunner, /volumeSeries/);
});

test("market browser gate exercises canonical symbol and interval changes with reference geometry", () => {
  assert.match(browserHarness, /klineFixture\.queries\.push/);
  assert.match(browserRunner, /marketIntervalSequence/);
  assert.match(browserRunner, /marketActiveIntervals/);
  assert.match(browserRunner, /marketChartWorkspaceRatio/);
  assert.match(browserRunner, /marketCanonicalSymbol/);
  assert.match(browserRunner, /marketFocusedOutline/);
  assert.match(browserRunner, /facts\.minMarketTargetPx >= 36/);
});

test("production sources never import the synthetic cockpit fixture", async () => {
  const productionSources = await Promise.all([
    "../src/aug15/tradingCockpit.jsx",
    "../src/aug15/tradingCockpit/OverviewPage.jsx",
    "../src/aug15/tradingCockpit/MarketPage.jsx",
    "../src/aug15/workspacePages.jsx"
  ].map((url) => readFile(new URL(url, import.meta.url), "utf8").catch(() => "")));
  productionSources.forEach((source) => assert.doesNotMatch(source, /trading-cockpit-browser/));
});

test("browser gate proves the requested market region consumed synthetic K-lines", () => {
  assert.match(browserHarness, /window\.__cockpitKlineFixture/);
  assert.match(browserHarness, /requests:\s*0/);
  assert.match(browserHarness, /klineFixture\.requests \+= 1/);
  assert.match(browserRunner, /klineRequests/);
  assert.match(browserRunner, /regionCharts/);
  assert.match(browserRunner, /\[data-cockpit-region="market-chart"\]/);
  assert.match(browserRunner, /facts\.klineRequests > 0/);
  assert.match(browserRunner, /facts\.regionCharts >= 1/);
});

test("browser CDP transport bounds commands and rejects pending work on disconnect", () => {
  assert.match(browserRunner, /const cdpCommandTimeoutMs =/);
  assert.match(browserRunner, /CDP command timed out/);
  assert.match(browserRunner, /socket\.on\("close"/);
  assert.match(browserRunner, /socket\.on\("error"/);
  assert.match(browserRunner, /rejectPending/);
});

test("review-to-trade resolution never matches two missing identities", () => {
  const trades = [
    { id: "trade-new", netRealizedPnl: 113.9 },
    { id: "trade-btc", netRealizedPnl: 284.62 }
  ];
  assert.equal(findReviewTrade({ id: "review-orphan" }, trades), null);
  assert.equal(findReviewTrade({ tradeLifecycleId: "trade-btc" }, trades)?.netRealizedPnl, 284.62);
});

test("review-to-trade resolution uses strict unique identity precedence", () => {
  const trades = [
    { id: "trade-weak-first", executionOrderId: "exec-match", orderId: "order-match" },
    { id: "trade-strong", executionOrderId: "exec-other", orderId: "order-other" },
    { id: "trade-duplicate", executionOrderId: "exec-duplicate", orderId: "order-duplicate" },
    { id: "trade-duplicate", executionOrderId: "exec-duplicate", orderId: "order-duplicate" }
  ];

  assert.equal(findReviewTrade({ tradeLifecycleId: "trade-strong", executionOrderId: "exec-match" }, trades)?.id, "trade-strong");
  assert.equal(findReviewTrade({ tradeLifecycleId: "missing", executionOrderId: "exec-match", orderId: "order-match" }, trades), null);
  assert.equal(findReviewTrade({ tradeLifecycleId: "trade-duplicate", executionOrderId: "exec-match" }, trades), null);
  assert.equal(findReviewTrade({ executionOrderId: "missing", orderId: "order-match" }, trades), null);
  assert.equal(findReviewTrade({ executionOrderId: "exec-duplicate", orderId: "order-match" }, trades), null);
  assert.equal(findReviewTrade({ tradeLifecycleId: "  ", executionOrderId: "exec-match" }, trades)?.id, "trade-weak-first");
  assert.equal(findReviewTrade({ executionOrderId: "", orderId: "order-other" }, trades)?.id, "trade-strong");
  assert.equal(findReviewTrade({ orderId: "order-duplicate" }, trades), null);
  assert.equal(findReviewTrade({ tradeLifecycleId: "", executionOrderId: " ", orderId: "" }, trades), null);
});
