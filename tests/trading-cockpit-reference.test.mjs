import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { findReviewTrade } from "../src/viewData.js";

async function exists(url) {
  try { await access(url); return true; } catch { return false; }
}

const app = await readFile(new URL("../src/aug15/App.jsx", import.meta.url), "utf8");
const workspaces = await readFile(new URL("../src/aug15/workspacePages.jsx", import.meta.url), "utf8");
const cockpit = await readFile(new URL("../src/aug15/tradingCockpit.jsx", import.meta.url), "utf8").catch(() => "");
const cockpitCss = await readFile(new URL("../src/aug15/tradingCockpit.css", import.meta.url), "utf8").catch(() => "");
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
    "data-cockpit-page=\"overview\"",
    "data-cockpit-page=\"market\"",
    "data-cockpit-page=\"positions\"",
    "data-cockpit-page=\"execution\"",
    "data-cockpit-page=\"ledger\"",
    "data-cockpit-region=\"portfolio-hero\"",
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

test("production sources never import the synthetic cockpit fixture", async () => {
  const productionSources = await Promise.all([
    "../src/aug15/tradingCockpit.jsx",
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
