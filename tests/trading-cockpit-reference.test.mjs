import assert from "node:assert/strict";
import fs from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findReviewTrade } from "../src/viewData.js";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache");
const componentBundle = path.join(cacheDir, `trading-cockpit-primitives-${process.pid}.cjs`);
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
  OverviewPage,
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
  for (const landmark of [
    "data-cockpit-page=\"market\"",
    "data-cockpit-page=\"positions\"",
    "data-cockpit-page=\"execution\"",
    "data-cockpit-page=\"ledger\"",
    "region=\"market-chart\"",
    "region=\"position-table\"",
    "data-cockpit-region=\"review-workbench\"",
    "region=\"execution-timeline\""
  ]) assert.match(cockpit, new RegExp(landmark));
  assert.match(cockpit, /CockpitEmpty/);
  assert.match(cockpit, /buildPositionView/);
  assert.match(cockpit, /buildExecutionView/);
  assert.match(cockpit, /TradingViewChart/);
  assert.doesNotMatch(cockpit, /72,450|8,234|\+12\.4%|0\.0007/);
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

test("production sources never import the synthetic cockpit fixture", async () => {
  const productionSources = await Promise.all([
    "../src/aug15/tradingCockpit.jsx",
    "../src/aug15/tradingCockpit/OverviewPage.jsx",
    "../src/aug15/workspacePages.jsx"
  ].map((url) => readFile(new URL(url, import.meta.url), "utf8")));
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
