# Trading Cockpit High-Fidelity Reference Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the five desktop Trading Cockpit pages so their component anatomy, density, geometry, charts, typography, and interaction states closely match the five 1448×1086 reference images while preserving every production data, permission, risk, execution, route, and action boundary.

**Architecture:** Keep `src/aug15/tradingCockpit.jsx` as the public facade consumed by `workspacePages.jsx`, but move presentation selectors, shared primitives, visualizations, and each page into focused modules under `src/aug15/tradingCockpit/`. Production components continue to consume `data`, `action`, and `ui`; deterministic high-volume fixtures and intercepted K-line responses exist only in the browser validation harness.

**Tech Stack:** React 18, existing Vite application, CSS variables and scoped CSS, `lightweight-charts` through the existing `TradingViewChart`, Lucide React, Node test runner, Chrome/CDP browser validation.

**Spec:** `docs/superpowers/specs/2026-09-03-trading-cockpit-reference-redesign-design.md`

## Global Constraints

- Do not modify API contracts, database schema, authentication, permissions, trading logic, Agent logic, risk logic, exchange execution, OKX/WebSocket ownership, accounting, financial calculations, existing routes, or mobile UI.
- Reference-image numbers and objects never enter production code.
- Production renders only current real data; absent values use explicit unavailable, empty, loading, stale, degraded, failed, forbidden, or disabled states.
- Test fixtures are production-shaped, deterministic, synthetic, browser-only, and never call a production write endpoint.
- Existing dangerous actions continue through `executionExitAction` and `requestExecutionExit`; unsupported reference actions are not rendered as working controls.
- The five reference images remain the visual source of truth. Passing automated tests without a close 1440 visual match is not completion.
- No `!important`, no new legacy global CSS override layer, and no static-image replacement for the real K-line chart.
- The main visual gate is 1440×1080; 1280×960 and 1024×768 must have zero document-level horizontal overflow.

---

### Task 1: Build the presentation model and canonical joins

**Files:**
- Create: `src/aug15/tradingCockpit/model.js`
- Create: `tests/trading-cockpit-model.test.mjs`
- Modify: `src/aug15/tradingCockpit.jsx`

**Interfaces:**
- Consumes: existing `buildExecutionView`, `buildMarketRows`, `buildPositionView`, `findReviewTrade`, `netReviewResult`, and `positionNotionalUsdt` from `src/viewData.js`.
- Produces: `cockpitObjectId(row)`, `buildOverviewTradeFlow(data)`, `buildOverviewPresentation(data)`, `buildPositionPresentation(data)`, `buildReviewPresentation(data)`, `buildLedgerPresentation(data)`, and `buildSelectedExecutionStages(data, order)`.

- [ ] **Step 1: Write failing behavioral tests for identity joins, deduplication, and truthful metrics**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLedgerPresentation,
  buildOverviewPresentation,
  buildOverviewTradeFlow,
  buildPositionPresentation,
  buildReviewPresentation,
  buildSelectedExecutionStages,
  cockpitObjectId
} from "../src/aug15/tradingCockpit/model.js";

test("canonical cockpit identity supports real position shapes", () => {
  assert.equal(cockpitObjectId({ positionId: "p-1" }), "p-1");
  assert.equal(cockpitObjectId({ instId: "BTC-USDT-SWAP" }), "BTC-USDT-SWAP");
});

test("overview shows a fill once instead of duplicating its order", () => {
  const rows = buildOverviewTradeFlow({
    executionOrders: [{ id: "o-1", symbol: "BTC/USDT", status: "filled" }],
    fills: [{ id: "f-1", orderId: "o-1", symbol: "BTC/USDT" }]
  });
  assert.deepEqual(rows.map((row) => row.id), ["f-1"]);
});

test("overview presentation keeps system and market notices distinct", () => {
  const model = buildOverviewPresentation({
    notifications: [{ id: "n-1", title: "账户对账完成" }],
    events: [{ id: "e-1", title: "非农数据" }],
    markets: [{ symbol: "BTC/USDT", price: 100 }],
    positions: []
  });
  assert.equal(model.systemNotice.title, "账户对账完成");
  assert.equal(model.marketNotice.title, "非农数据");
});

test("position protection is joined only from the matching plan or order", () => {
  const model = buildPositionPresentation({
    positions: [{ positionId: "p-1", symbol: "BTC/USDT", executionOrderId: "o-1", quantity: 1 }],
    executionOrders: [{ id: "o-1", tradePlanId: "plan-1" }, { id: "o-2", tradePlanId: "plan-2" }],
    tradePlans: [{ id: "plan-1", stopLoss: 90, takeProfit: [120] }, { id: "plan-2", stopLoss: 1, takeProfit: [2] }]
  });
  assert.equal(model.positions[0].stopLoss, 90);
  assert.deepEqual(model.positions[0].takeProfits, [120]);
});

test("execution stages never borrow evidence from another order", () => {
  const stages = buildSelectedExecutionStages({
    executionOrders: [{ id: "o-1", tradePlanId: "p-1" }, { id: "o-2", tradePlanId: "p-2" }],
    tradePlans: [{ id: "p-2", status: "approved" }],
    riskChecks: [{ executionOrderId: "o-2", status: "passed" }],
    fills: [{ orderId: "o-2", id: "f-2" }]
  }, { id: "o-1", tradePlanId: "p-1", status: "open" });
  assert.equal(stages.find((stage) => stage.id === "risk").done, false);
  assert.equal(stages.find((stage) => stage.id === "fill").done, false);
});

test("review labels absent drawdown as unavailable instead of inventing it", () => {
  const model = buildReviewPresentation({ performance: { trades: 1, profitFactor: 1.4 }, reviews: [], closedTradeLifecycles: [] });
  assert.equal(model.metrics.maxDrawdownPct, null);
  assert.equal(model.metrics.profitFactor, 1.4);
});

test("ledger derives counts and fees from real rows", () => {
  const model = buildLedgerPresentation({
    executionOrders: [{ id: "o-1", status: "filled" }, { id: "o-2", status: "open" }],
    fills: [{ id: "f-1", orderId: "o-1", feeUsdt: -0.5 }]
  });
  assert.deepEqual(model.metrics, { total: 2, working: 1, filled: 1, blocked: 0, fillRatePct: 50, feesUsdt: -0.5 });
});
```

- [ ] **Step 2: Run the new model test and verify RED**

Run: `node --test tests/trading-cockpit-model.test.mjs`

Expected: FAIL because `src/aug15/tradingCockpit/model.js` does not exist.

- [ ] **Step 3: Implement the presentation selectors with fail-closed joins**

```js
import { buildExecutionView, buildMarketRows, buildPositionView, findReviewTrade, netReviewResult, positionNotionalUsdt } from "../../viewData.js";

const rows = (value) => Array.isArray(value) ? value : [];
const timeOf = (row) => new Date(row.updatedAt ?? row.completedAt ?? row.createdAt ?? 0).getTime() || 0;
const byNewest = (a, b) => timeOf(b) - timeOf(a);

export function cockpitObjectId(row = {}) {
  return row.id ?? row.positionId ?? row.instId ?? row.orderId ?? row.tradeLifecycleId ?? row.symbol ?? null;
}

export function buildOverviewTradeFlow(data = {}) {
  const fills = Array.isArray(data.fills) ? data.fills : [];
  const filledOrderIds = new Set(fills.map((row) => row.orderId).filter(Boolean).map(String));
  const remainingOrders = (Array.isArray(data.executionOrders) ? data.executionOrders : [])
    .filter((row) => !filledOrderIds.has(String(row.id)));
  return [...fills, ...remainingOrders].sort(byNewest);
}

export function buildOverviewPresentation(data = {}) {
  const positions = buildPositionPresentation(data);
  const markets = buildMarketRows(data);
  return {
    portfolio: data.portfolio ?? {},
    market: data.activeMarket ?? markets[0] ?? null,
    markets,
    positions,
    allocation: positions.positions,
    tradeFlow: buildOverviewTradeFlow(data),
    systemNotice: rows(data.notifications)[0] ?? (data.automationState ? { title: data.automationState.detail ?? data.automationState.label } : null),
    marketNotice: rows(data.events)[0] ?? null,
    aiRead: data.marketRegime ?? null,
    activities: [...rows(data.agentRuns), ...rows(data.jobRuns)].sort(byNewest),
    strategyProducts: rows(data.strategyCatalog?.products),
    accountSnapshots: rows(data.accountSnapshots)
  };
}

export function buildSelectedExecutionStages(data = {}, order = {}) {
  const orderId = String(order.id ?? order.orderId ?? "");
  const planId = String(order.tradePlanId ?? order.planId ?? "");
  const plan = rows(data.tradePlans).find((row) => String(row.id) === planId) ?? null;
  const risk = rows(data.riskChecks).find((row) => String(row.executionOrderId ?? "") === orderId || (planId && String(row.tradePlanId ?? row.planId ?? "") === planId)) ?? null;
  const fills = rows(data.fills).filter((row) => String(row.orderId ?? row.executionOrderId ?? "") === orderId);
  const protectedOrder = /stop|protect|take_profit|止损|止盈/i.test(String(order.type ?? order.kind ?? order.purpose ?? ""));
  return [
    { id: "signal", done: Boolean(plan), detail: plan?.signal ?? plan?.strategy ?? null },
    { id: "risk", done: /pass|approved/i.test(String(risk?.status ?? "")), detail: risk?.summary ?? null },
    { id: "routing", done: Boolean(order.exchange ?? order.venue), detail: order.exchange ?? order.venue ?? null },
    { id: "order", done: Boolean(orderId), detail: order.status ?? null },
    { id: "fill", done: fills.length > 0, detail: fills.length ? String(fills.length) : null },
    { id: "protection", done: protectedOrder, detail: protectedOrder ? order.type ?? order.kind : null }
  ];
}

export function buildPositionPresentation(data = {}) {
  const base = buildPositionView(data);
  const orders = rows(data.executionOrders);
  const plans = rows(data.tradePlans);
  return {
    ...base,
    positions: base.positions.map((position) => {
      const order = orders.find((row) =>
        String(row.id ?? "") === String(position.executionOrderId ?? "") ||
        String(row.positionId ?? "") === String(position.positionId ?? "")
      ) ?? null;
      const planId = order?.tradePlanId ?? order?.planId ?? position.tradePlanId ?? position.planId;
      const plan = plans.find((row) => planId != null && String(row.id) === String(planId)) ?? null;
      return {
        ...position,
        id: cockpitObjectId(position),
        notionalUsdt: positionNotionalUsdt(position),
        stopLoss: position.stopLoss ?? position.stopLossPrice ?? plan?.stopLoss ?? plan?.stop_loss ?? null,
        takeProfits: rows(position.takeProfits ?? position.takeProfit ?? plan?.takeProfit ?? plan?.take_profit)
      };
    })
  };
}

export function buildReviewPresentation(data = {}) {
  const execution = buildExecutionView(data);
  const reviewRows = execution.reviews.map((review) => {
    const trade = findReviewTrade(review, execution.closedTrades);
    return { ...review, trade, netPnlUsdt: netReviewResult(review, trade) };
  });
  return {
    ...execution,
    reviews: reviewRows,
    metrics: {
      totalPnlUsdt: execution.performance.totalPnlUsdt,
      trades: execution.performance.trades,
      winRatePct: execution.performance.winRatePct,
      avgPnlUsdt: execution.performance.avgPnlUsdt,
      maxDrawdownPct: Number.isFinite(Number(execution.performance.maxDrawdownPct)) ? Number(execution.performance.maxDrawdownPct) : null,
      profitFactor: Number.isFinite(Number(execution.performance.profitFactor)) ? Number(execution.performance.profitFactor) : null
    }
  };
}

export function buildLedgerPresentation(data = {}) {
  const execution = buildExecutionView(data);
  const working = execution.orders.filter((row) => /open|pending|working|partial/i.test(String(row.status))).length;
  const filled = execution.orders.filter((row) => /filled|complete/i.test(String(row.status))).length;
  const blocked = execution.orders.filter((row) => /reject|blocked|risk/i.test(String(row.status))).length;
  const feesUsdt = execution.fills.reduce((sum, row) => sum + (Number.isFinite(Number(row.feeUsdt ?? row.fee)) ? Number(row.feeUsdt ?? row.fee) : 0), 0);
  return {
    ...execution,
    metrics: {
      total: execution.orders.length,
      working,
      filled,
      blocked,
      fillRatePct: execution.orders.length ? Number((filled / execution.orders.length * 100).toFixed(1)) : null,
      feesUsdt: Number(feesUsdt.toFixed(8))
    }
  };
}
```

Keep all joins exact and fail closed. Preserve `null` for unavailable metrics and return new objects without mutating input data.

- [ ] **Step 4: Run focused model and existing view-data tests**

Run: `node --test tests/trading-cockpit-model.test.mjs tests/position-view.test.mjs tests/performance-review-integrity.test.mjs`

Expected: PASS with no warning output.

- [ ] **Step 5: Commit the presentation model**

```bash
git add src/aug15/tradingCockpit/model.js tests/trading-cockpit-model.test.mjs src/aug15/tradingCockpit.jsx
git commit -m "refactor: add truthful cockpit presentation model"
```

### Task 2: Make the browser harness dense, deterministic, and chart-ready

**Files:**
- Modify: `tests/trading-cockpit-browser.jsx`
- Modify: `tests/trading-cockpit-reference.test.mjs`
- Create: `tests/run-trading-cockpit-browser.mjs`

**Interfaces:**
- Consumes: the real `August15AuthenticatedShell` and real `TradingViewChart` production components.
- Produces: a self-contained browser gate with 1440/1280/1024 viewports and synthetic K-line responses in the production API schema.

- [ ] **Step 1: Add failing harness contracts**

```js
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
```

- [ ] **Step 2: Run the reference test and verify RED**

Run: `node --test tests/trading-cockpit-reference.test.mjs`

Expected: FAIL on the missing fixture marker, K-line interception, and required counts.

- [ ] **Step 3: Expand only the test fixture and intercept the chart request**

```js
document.documentElement.dataset.fixtureKind = "production-shaped-synthetic";
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.includes("/api/market/klines")) {
    const symbol = new URL(url, location.origin).searchParams.get("symbol") || "BTC/USDT";
    return new Response(JSON.stringify({ candles: fixtureCandles(symbol) }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  return nativeFetch(input, init);
};
```

Generate 4 positions, 27 closed lifecycle/review pairs, 32 orders, 24 fills, and 48 account snapshots from deterministic helper functions. Every row must use fields already accepted by production selectors. Override `WebSocket` only inside the harness with a no-network inert test class so the chart cannot open a public socket during capture.

- [ ] **Step 4: Create the self-contained Chrome runner**

```js
const viewports = [[1440, 1080], [1280, 960], [1024, 768]];
const views = ["overview", "market", "positions", "execution", "ledger"];
for (const [width, height] of viewports) {
  for (const view of views) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}/tests/trading-cockpit-browser.html?view=${view}`);
    await page.waitForSelector(`[data-cockpit-page="${view}"]`);
    await page.waitForFunction(() => !document.body.innerText.includes("加载 K 线"));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.equal(overflow, 0);
  }
}
```

Follow the repository's existing Chrome/CDP runner pattern, start Vite on an isolated port, record its PID, and stop Vite and Chrome in `finally`.

- [ ] **Step 5: Run harness tests and the browser gate**

Run: `node --test tests/trading-cockpit-reference.test.mjs`

Run: `node tests/run-trading-cockpit-browser.mjs`

Expected: both PASS; overview and market report at least one rendered chart canvas and every viewport reports document overflow `0`.

- [ ] **Step 6: Commit the validation foundation**

```bash
git add tests/trading-cockpit-browser.jsx tests/trading-cockpit-reference.test.mjs tests/run-trading-cockpit-browser.mjs
git commit -m "test: make cockpit visual evidence deterministic"
```

### Task 3: Rebuild the shared shell, visual primitives, and scoped tokens

**Files:**
- Create: `src/aug15/tradingCockpit/shared.jsx`
- Create: `src/aug15/tradingCockpit/visuals.jsx`
- Modify: `src/aug15/tradingCockpit.css`
- Modify: `src/aug15/tradingCockpit.jsx`
- Modify: `tests/trading-cockpit-reference.test.mjs`

**Interfaces:**
- Consumes: translation `t`, existing display formatters, Lucide icons, and presentation selectors from Task 1.
- Produces: `CockpitHeader`, `CockpitPanel`, `CockpitMetric`, `CockpitTable`, `CockpitEmpty`, `Tone`, `DonutChart`, `GaugeChart`, `AreaTrend`, `DistributionPlot`, and `BreadthBars`.

- [ ] **Step 1: Add failing module and visual-token contracts**

```js
import { access } from "node:fs/promises";

async function exists(url) {
  try { await access(url); return true; } catch { return false; }
}

for (const modulePath of [
  "../src/aug15/tradingCockpit/shared.jsx",
  "../src/aug15/tradingCockpit/visuals.jsx"
]) assert.equal(await exists(new URL(modulePath, import.meta.url)), true);

for (const token of [
  "--cockpit-canvas", "--cockpit-surface", "--cockpit-text",
  "--cockpit-text-2", "--cockpit-text-3", "--cockpit-brand",
  "--cockpit-positive", "--cockpit-negative", "--cockpit-warning",
  "--cockpit-border", "--cockpit-hairline", "--cockpit-radius"
]) assert.match(cockpitCss, new RegExp(token));

assert.doesNotMatch(cockpitCss, /!important/);
assert.doesNotMatch(cockpit, /function (?:Panel|Metric|MiniTrend|DataTable)\(/);
```

- [ ] **Step 2: Run the reference test and verify RED**

Run: `node --test tests/trading-cockpit-reference.test.mjs`

Expected: FAIL because the modules and new token contract do not exist.

- [ ] **Step 3: Implement shared primitives and visualization components**

```jsx
function normalizedSegments(segments = []) {
  const clean = segments.filter((segment) => Number(segment.value) > 0);
  const total = clean.reduce((sum, segment) => sum + Number(segment.value), 0);
  return clean.map((segment) => ({ ...segment, pct: total ? Number(segment.value) / total * 100 : 0 }));
}

function conicGradient(segments = []) {
  let cursor = 0;
  const stops = normalizedSegments(segments).map((segment) => {
    const start = cursor;
    cursor += segment.pct;
    return `${segment.color} ${start}% ${cursor}%`;
  });
  return stops.length ? `conic-gradient(${stops.join(",")})` : "conic-gradient(#ece8e2 0 100%)";
}

function lineGeometry(values = [], width = 100, height = 36) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (clean.length < 2) return null;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const points = clean.map((value, index) => [index / (clean.length - 1) * width, height - ((value - min) / range * (height - 4) + 2)]);
  const line = `M ${points.map(([x, y]) => `${x} ${y}`).join(" L ")}`;
  return { line, area: `${line} L ${width} ${height} L 0 ${height} Z` };
}

export function DonutChart({ segments, value, label, ariaLabel }) {
  const gradient = conicGradient(segments);
  return <div className="cockpitDonut" role="img" aria-label={ariaLabel} style={{ background: gradient }}>
    <span><b>{value}</b><small>{label}</small></span>
  </div>;
}

export function AreaTrend({ values, tone = "positive", label }) {
  const geometry = lineGeometry(values, 100, 36);
  return geometry ? <svg className={`cockpitAreaTrend ${tone}`} role="img" aria-label={label} viewBox="0 0 100 36" preserveAspectRatio="none">
    <path className="area" d={geometry.area}/><path className="line" d={geometry.line}/>
  </svg> : <span className="cockpitChartUnavailable">数据不足</span>;
}
```

Build the primitives with semantic markup, explicit accessible labels, tabular numerals, and no invented values. Replace the duplicate primitive functions in the facade with imports.

- [ ] **Step 4: Rebuild the scoped visual tokens and header geometry**

```css
.tradingCockpit {
  --cockpit-canvas: #fbfaf8;
  --cockpit-surface: #fff;
  --cockpit-text: #24211e;
  --cockpit-text-2: #69635c;
  --cockpit-text-3: #989087;
  --cockpit-brand: #ee7026;
  --cockpit-positive: #21875a;
  --cockpit-negative: #df554d;
  --cockpit-warning: #d88a22;
  --cockpit-border: #e4ded7;
  --cockpit-hairline: #efebe6;
  --cockpit-radius: 9px;
  color: var(--cockpit-text);
  background: var(--cockpit-canvas);
  font-variant-numeric: tabular-nums;
}
```

Set the 1440 header to approximately 60px, retain the real KORDYN brand asset, and match the reference's tab spacing, subtle borders, light elevation, focus visibility, and responsive contraction.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/trading-cockpit-reference.test.mjs tests/trading-cockpit-model.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit the visual foundation**

```bash
git add src/aug15/tradingCockpit.jsx src/aug15/tradingCockpit.css src/aug15/tradingCockpit/shared.jsx src/aug15/tradingCockpit/visuals.jsx tests/trading-cockpit-reference.test.mjs
git commit -m "refactor: establish cockpit visual foundation"
```

### Task 4: Rebuild the Overview page at reference density

**Files:**
- Create: `src/aug15/tradingCockpit/OverviewPage.jsx`
- Modify: `src/aug15/tradingCockpit.jsx`
- Modify: `src/aug15/tradingCockpit.css`
- Modify: `tests/trading-cockpit-reference.test.mjs`
- Modify: `tests/run-trading-cockpit-browser.mjs`

**Interfaces:**
- Consumes: `buildOverviewPresentation`, existing market/position selectors, real `TradingViewChart`, shared primitives, `data` and `ui`.
- Produces: `[data-cockpit-page="overview"]` with `portfolio-hero`, `dual-notice`, `overview-market`, `ai-market-read`, `portfolio-allocation`, `recent-trades`, `agent-activity`, and `strategy-footer` regions.

- [ ] **Step 1: Add failing overview landmark and geometry assertions**

```js
const overviewSource = await readFile(new URL("../src/aug15/tradingCockpit/OverviewPage.jsx", import.meta.url), "utf8");
for (const region of [
  "portfolio-hero", "dual-notice", "overview-market", "ai-market-read",
  "portfolio-allocation", "recent-trades", "agent-activity", "strategy-footer"
]) assert.match(overviewSource, new RegExp(`data-cockpit-region=["'{]+${region}`));
```

In the browser runner, assert at 1440 that the overview main/rail width ratio is between `1.30` and `1.55`, the chart canvas is visible, and the page's last region begins before `1070px`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/trading-cockpit-reference.test.mjs`

Expected: FAIL on the missing page module and regions.

- [ ] **Step 3: Implement the reference-specific Overview composition**

```jsx
export function OverviewPage({ data, ui }) {
  const model = buildOverviewPresentation(data);
  return <div className="cockpitPage cockpitOverview" data-cockpit-page="overview">
    <PortfolioHero model={model.portfolio}/>
    <DualNotice system={model.systemNotice} market={model.marketNotice}/>
    <div className="overviewGrid">
      <section className="overviewPrimary">
        <OverviewMarket model={model.market}/>
        <RecentTrades rows={model.tradeFlow}/>
      </section>
      <aside className="overviewRail">
        <AiMarketRead model={model.aiRead} onOpen={() => ui.setActive("chat")}/>
        <PortfolioAllocation model={model.allocation} onOpen={() => ui.setActive("positions")}/>
        <AgentActivity rows={model.activities}/>
      </aside>
    </div>
    <StrategyFooter products={model.strategyProducts} onOpen={() => ui.setActive("strategyLib")}/>
  </div>;
}
```

Fill each named region with real values. Use account snapshots for the Hero background trend, notional-based position segments for the portfolio donut, fills-first deduplicated trade flow, and distinct system/market notice content.

- [ ] **Step 4: Run overview browser assertions**

Run: `KORDYN_COCKPIT_VIEWS=overview node tests/run-trading-cockpit-browser.mjs`

Expected: PASS at 1440/1280/1024 with a rendered chart, no document overflow, and all regions visible.

- [ ] **Step 5: Commit Overview**

```bash
git add src/aug15/tradingCockpit/OverviewPage.jsx src/aug15/tradingCockpit.jsx src/aug15/tradingCockpit.css tests/trading-cockpit-reference.test.mjs tests/run-trading-cockpit-browser.mjs
git commit -m "feat: rebuild trading cockpit overview"
```

### Task 5: Rebuild the Market page around the real chart

**Files:**
- Create: `src/aug15/tradingCockpit/MarketPage.jsx`
- Modify: `src/aug15/tradingCockpit.jsx`
- Modify: `src/aug15/tradingCockpit.css`
- Modify: `tests/trading-cockpit-reference.test.mjs`
- Modify: `tests/run-trading-cockpit-browser.mjs`

**Interfaces:**
- Consumes: `buildMarketRows`, real `TradingViewChart`, `marketRegime`, `mediumTermAnalytics`, `events`, `watchlist`, and existing watchlist actions.
- Produces: `market-header`, `market-chart-workspace`, `market-state`, `watchlist`, `derivatives`, `breadth`, `event-catalysts`, `ai-market-view`, and `market-ticker` regions.

- [ ] **Step 1: Add failing Market behavior and geometry assertions**

```js
const marketSource = await readFile(new URL("../src/aug15/tradingCockpit/MarketPage.jsx", import.meta.url), "utf8");
for (const region of [
  "market-header", "market-chart-workspace", "market-state", "watchlist",
  "derivatives", "breadth", "event-catalysts", "ai-market-view", "market-ticker"
]) assert.match(marketSource, new RegExp(region));
```

The browser test clicks `1h`, `4h`, and `1D`, verifies one active interval, changes the symbol through the real selector, and asserts the chart's bounding box occupies at least 65% of the primary workspace width.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/trading-cockpit-reference.test.mjs`

Expected: FAIL on the new Market module contract.

- [ ] **Step 3: Implement Market with supported controls only**

```jsx
<MarketChartFrame
  symbol={symbol}
  interval={interval}
  intervals={["1m", "5m", "15m", "1h", "4h", "1D"]}
  onIntervalChange={setInterval}
>
  <TradingViewChart symbol={symbol} interval={interval}/>
</MarketChartFrame>
```

Render the market header, chart/rail grid, market state, watchlist, derivatives facts, breadth bars, event catalysts, AI view, key levels when present, and ticker. Do not render clickable indicator/save tools unless the existing chart exposes a working handler.

- [ ] **Step 4: Run Market browser assertions**

Run: `KORDYN_COCKPIT_VIEWS=market node tests/run-trading-cockpit-browser.mjs`

Expected: PASS with chart-ready state, working symbol/interval controls, no overflow, and no permanent loading text.

- [ ] **Step 5: Commit Market**

```bash
git add src/aug15/tradingCockpit/MarketPage.jsx src/aug15/tradingCockpit.jsx src/aug15/tradingCockpit.css tests/trading-cockpit-reference.test.mjs tests/run-trading-cockpit-browser.mjs
git commit -m "feat: rebuild trading cockpit market workspace"
```

### Task 6: Rebuild Positions with protection and risk evidence

**Files:**
- Create: `src/aug15/tradingCockpit/PositionsPage.jsx`
- Modify: `src/aug15/tradingCockpit.jsx`
- Modify: `src/aug15/tradingCockpit.css`
- Modify: `tests/trading-cockpit-reference.test.mjs`
- Modify: `tests/run-trading-cockpit-browser.mjs`

**Interfaces:**
- Consumes: `buildPositionPresentation`, shared charts, existing exit-action helpers, and account snapshots.
- Produces: `position-hero`, `account-constraints`, `position-allocation`, `long-short`, `pnl-distribution`, `position-table`, `portfolio-pnl-trend`, `risk-health`, `margin-safety`, and `concentration` regions.

- [ ] **Step 1: Add failing Positions contracts**

```js
const positionSource = await readFile(new URL("../src/aug15/tradingCockpit/PositionsPage.jsx", import.meta.url), "utf8");
for (const region of [
  "position-hero", "account-constraints", "position-allocation", "long-short",
  "pnl-distribution", "position-table", "portfolio-pnl-trend", "risk-health",
  "margin-safety", "concentration"
]) assert.match(positionSource, new RegExp(region));

assert.match(positionSource, /stopLoss/);
assert.match(positionSource, /takeProfits/);
assert.match(positionSource, /executionExitAction/);
```

The browser test verifies that a `positionId`-only fixture row renders its matched stop/targets and that the empty fixture contains no fake position row.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/trading-cockpit-reference.test.mjs tests/trading-cockpit-model.test.mjs`

Expected: FAIL on the page module and protection presentation contract.

- [ ] **Step 3: Implement the three-column Positions workbench**

```jsx
<PositionTable
  rows={model.positions}
  columns={["symbol", "size", "entry", "mark", "pnl", "leverage", "liquidation", "margin"]}
  secondaryFields={["stopLoss", "takeProfits", "marginRatio"]}
  onExit={(row) => requestExecutionExit(action, row, "manual_ui")}
/>
```

Compute allocation and long/short splits by real notional, distribution from real unrealized PnL, and trend from real account snapshots. Render “未登记” for absent protection facts and a compact structured empty state for a flat account.

- [ ] **Step 4: Run Positions browser assertions**

Run: `KORDYN_COCKPIT_VIEWS=positions node tests/run-trading-cockpit-browser.mjs`

Expected: PASS at all viewports; no large vacant fixed-height table, protection facts match the correct position, and the empty case contains no fabricated numbers.

- [ ] **Step 5: Commit Positions**

```bash
git add src/aug15/tradingCockpit/PositionsPage.jsx src/aug15/tradingCockpit.jsx src/aug15/tradingCockpit.css tests/trading-cockpit-reference.test.mjs tests/run-trading-cockpit-browser.mjs
git commit -m "feat: rebuild cockpit position risk workbench"
```

### Task 7: Rebuild Execution & Review with truthful analytical depth

**Files:**
- Create: `src/aug15/tradingCockpit/ReviewPage.jsx`
- Modify: `src/aug15/tradingCockpit.jsx`
- Modify: `src/aug15/tradingCockpit.css`
- Modify: `tests/trading-cockpit-reference.test.mjs`
- Modify: `tests/run-trading-cockpit-browser.mjs`

**Interfaces:**
- Consumes: `buildReviewPresentation`, canonical review/lifecycle joins, `behaviorProfile`, `initialReviewId`, `onReviewSelect`, and `ui`.
- Produces: `review-hero`, `ai-review-conclusion`, `review-filters`, `trade-list`, `trade-detail`, `trade-path`, `hold-pnl-distribution`, `behavior-insights`, and `next-actions` regions.

- [ ] **Step 1: Add failing Review contracts**

```js
const reviewSource = await readFile(new URL("../src/aug15/tradingCockpit/ReviewPage.jsx", import.meta.url), "utf8");
for (const region of [
  "review-hero", "ai-review-conclusion", "review-filters", "trade-list",
  "trade-detail", "trade-path", "hold-pnl-distribution",
  "behavior-insights", "next-actions"
]) assert.match(reviewSource, new RegExp(region));

assert.doesNotMatch(reviewSource, /profitFactor[^\n]+平均盈亏比/);
assert.match(reviewSource, /onReviewSelect/);
```

The browser test clicks a review on page two, verifies the selected identity and detail change, reloads the deep link, and confirms the same review is restored.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/trading-cockpit-reference.test.mjs tests/aug15-review-deep-link.test.mjs`

Expected: FAIL because the reference-depth Review module is absent.

- [ ] **Step 3: Implement the seven-metric Hero and master/detail workbench**

```jsx
<ReviewWorkbench
  rows={filteredRows}
  selectedId={selectedId}
  page={page}
  pageSize={8}
  onSelect={(row) => {
    setSelectedId(row.id);
    onReviewSelect?.(row.id);
  }}
/>
```

Render only metrics with truthful labels. Use `null`/unavailable for absent drawdown or expectancy, draw the hold-time/PnL distribution from real review points, and show a trade-path chart only when real path samples exist. Otherwise render the explicit “未记录逐时路径” state.

- [ ] **Step 4: Run Review browser assertions**

Run: `KORDYN_COCKPIT_VIEWS=execution node tests/run-trading-cockpit-browser.mjs`

Expected: PASS with filter/pagination/selection/deep-link behavior and no oversized empty detail region.

- [ ] **Step 5: Commit Execution & Review**

```bash
git add src/aug15/tradingCockpit/ReviewPage.jsx src/aug15/tradingCockpit.jsx src/aug15/tradingCockpit.css tests/trading-cockpit-reference.test.mjs tests/run-trading-cockpit-browser.mjs
git commit -m "feat: rebuild cockpit execution review workbench"
```

### Task 8: Rebuild Orders & Fills as an identity-correct Execution Monitor

**Files:**
- Create: `src/aug15/tradingCockpit/LedgerPage.jsx`
- Modify: `src/aug15/tradingCockpit.jsx`
- Modify: `src/aug15/tradingCockpit.css`
- Modify: `tests/trading-cockpit-reference.test.mjs`
- Modify: `tests/run-trading-cockpit-browser.mjs`

**Interfaces:**
- Consumes: `buildLedgerPresentation`, `buildSelectedExecutionStages`, existing AI navigation, and existing exit-action helpers.
- Produces: `execution-hero`, `execution-notices`, `order-filters`, `order-list`, `order-detail`, `execution-timeline`, `fill-filters`, and `fill-ledger` regions.

- [ ] **Step 1: Add failing Ledger contracts**

```js
const ledgerSource = await readFile(new URL("../src/aug15/tradingCockpit/LedgerPage.jsx", import.meta.url), "utf8");
for (const region of [
  "execution-hero", "execution-notices", "order-filters", "order-list",
  "order-detail", "execution-timeline", "fill-filters", "fill-ledger"
]) assert.match(ledgerSource, new RegExp(region));

assert.match(ledgerSource, /buildSelectedExecutionStages/);
assert.match(ledgerSource, /requestExecutionExit/);
```

The browser test clicks an order whose sibling has a fill and proves the selected order still shows its own Fill stage as incomplete. It also exercises order/fill filters and keyboard row selection.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/trading-cockpit-reference.test.mjs tests/trading-cockpit-model.test.mjs`

Expected: FAIL on the new Ledger module contract.

- [ ] **Step 3: Implement the Execution Monitor**

```jsx
<ExecutionTimeline stages={buildSelectedExecutionStages(data, selectedOrder)}/>
<FillLedger
  rows={model.fills}
  filters={fillFilters}
  page={fillPage}
  pageSize={10}
/>
```

Compute Hero metrics from real orders/fills, keep orders and exchange-confirmed fills visually separate, add local filters and pagination, bind the detail/timeline to the selected order identity, and preserve existing AI and exit actions.

- [ ] **Step 4: Run Ledger browser assertions**

Run: `KORDYN_COCKPIT_VIEWS=ledger node tests/run-trading-cockpit-browser.mjs`

Expected: PASS with correct selected-order stages, working filters/pagination, keyboard selection, and no document overflow.

- [ ] **Step 5: Commit Orders & Fills**

```bash
git add src/aug15/tradingCockpit/LedgerPage.jsx src/aug15/tradingCockpit.jsx src/aug15/tradingCockpit.css tests/trading-cockpit-reference.test.mjs tests/run-trading-cockpit-browser.mjs
git commit -m "feat: rebuild cockpit execution monitor"
```

### Task 9: Perform bounded visual convergence and final verification

**Files:**
- Modify: `src/aug15/tradingCockpit.css`
- Modify: `tests/run-trading-cockpit-browser.mjs`
- Modify: `docs/trading-cockpit-reference-redesign-report.md`
- Create: `.impeccable/review/trading-cockpit-v2-overview-1440.png`
- Create: `.impeccable/review/trading-cockpit-v2-market-1440.png`
- Create: `.impeccable/review/trading-cockpit-v2-positions-1440.png`
- Create: `.impeccable/review/trading-cockpit-v2-execution-1440.png`
- Create: `.impeccable/review/trading-cockpit-v2-ledger-1440.png`
- Create: `.impeccable/review/trading-cockpit-v2-market-1280.png`
- Create: `.impeccable/review/trading-cockpit-v2-ledger-1024.png`
- Create: `.impeccable/review/trading-cockpit-v2-positions-empty-1440.png`

**Interfaces:**
- Consumes: all five completed pages, reference images, the browser runner, and the Impeccable craft floor.
- Produces: two bounded visual inspection rounds, final screenshots, a truthful residual-difference report, and fresh test/build evidence.

- [ ] **Step 1: Add final browser geometry and interaction assertions before CSS convergence**

```js
assert.ok(header.height >= 56 && header.height <= 64);
assert.ok(page.left >= 16 && page.rightGap >= 16);
assert.equal(documentOverflow, 0);
assert.equal(activeTabs, 1);
assert.ok(primaryFontSize >= 11);
assert.ok(chartCanvasCount >= 1);
assert.ok(lastMeaningfulRegion.bottom <= viewport.height + allowedScroll);

const targetRatios = {
  overview: [58, 42],
  market: [74, 26],
  positions: [24, 52, 24],
  execution: [36, 64],
  ledger: [53, 47]
};
for (const [view, expected] of Object.entries(targetRatios)) {
  const actual = await readGridPercentages(page, view);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 8));
}
```

Define `readGridPercentages(page, view)` in the runner by reading the named page region bounding boxes and dividing each width by the total named-grid width.

- [ ] **Step 2: Run the browser gate and verify RED where current geometry still diverges**

Run: `node tests/run-trading-cockpit-browser.mjs`

Expected: at least one new geometry assertion fails before the convergence CSS pass; record the exact measured ratios in the command output.

- [ ] **Step 3: Run visual inspection round one and batch-fix material differences**

Run: `KORDYN_COCKPIT_CAPTURE_DIR=.impeccable/review node tests/run-trading-cockpit-browser.mjs`

Open all five 1440 captures beside their matching reference images. In one CSS/component batch, correct header height, canvas margins, Hero height, grid ratios, panel padding, title and number scale, table row height, chart height, border/radius/shadow, semantic colors, density, and empty-state height. Do not make repeated one-property screenshot loops.

- [ ] **Step 4: Run visual inspection round two and validate every artifact**

Run: `KORDYN_COCKPIT_CAPTURE_DIR=.impeccable/review KORDYN_COCKPIT_FINAL=1 node tests/run-trading-cockpit-browser.mjs`

Open every output image once. Confirm correct page, expected viewport, nonblank chart, no half-loaded state, no clipped text, and no wrong capture behind the filename. Record unavoidable differences caused only by real content in `docs/trading-cockpit-reference-redesign-report.md`.

- [ ] **Step 5: Run the mechanical detector exactly once on changed UI targets**

Run: `node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/aug15/tradingCockpit`

Expected: JSON `[]`. Fix mechanical findings before continuing; do not rerun the detector after it is clean.

- [ ] **Step 6: Run fresh focused and full verification**

Run: `node --test tests/trading-cockpit-model.test.mjs tests/trading-cockpit-reference.test.mjs tests/aug15-review-deep-link.test.mjs`

Run: `node tests/run-trading-cockpit-browser.mjs`

Run: `npm test`

Run: `npm run lint`

Run: `npm run build`

Run: `git diff --check`

Expected: every command exits `0`; full test count is reported exactly rather than assumed.

- [ ] **Step 7: Complete a fresh visual finish review**

Provide the reviewer with the five reference images, all final capture paths, the approved spec, `src/aug15/tradingCockpit.jsx`, `src/aug15/tradingCockpit/`, `src/aug15/tradingCockpit.css`, and the immutable business boundaries. A release verdict requires Critical `0`, Important `0`, valid screenshot evidence, and no claim of pixel parity where dynamic real data creates a documented difference.

- [ ] **Step 8: Commit final convergence evidence and report**

```bash
git add src/aug15/tradingCockpit.jsx src/aug15/tradingCockpit src/aug15/tradingCockpit.css tests/trading-cockpit-browser.jsx tests/trading-cockpit-reference.test.mjs tests/trading-cockpit-model.test.mjs tests/run-trading-cockpit-browser.mjs docs/trading-cockpit-reference-redesign-report.md .impeccable/review/trading-cockpit-v2-*.png
git commit -m "feat: complete high-fidelity trading cockpit rebuild"
```
