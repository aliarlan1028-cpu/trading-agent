import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cdpCommandTimeoutMs = 15_000;
const viewports = [[1440, 1080], [1280, 960], [1024, 768]];
const allViews = ["overview", "market", "positions", "execution", "ledger"];
const requestedViews = String(process.env.KORDYN_COCKPIT_VIEWS || "").split(",").map((value) => value.trim()).filter(Boolean);
const views = requestedViews.length ? requestedViews.filter((view) => allViews.includes(view)) : allViews;
const outputDir = process.env.KORDYN_COCKPIT_OUTPUT_DIR ? path.resolve(process.env.KORDYN_COCKPIT_OUTPUT_DIR) : "";
const emptyMode = process.env.KORDYN_COCKPIT_EMPTY === "1";
const enrichedMode = process.env.KORDYN_COCKPIT_ENRICHED === "1";
const stateMode = String(process.env.KORDYN_COCKPIT_STATE || "").trim().toLowerCase();
const marketCase = String(process.env.KORDYN_COCKPIT_MARKET_CASE || "").trim().toLowerCase();
const positionCase = String(process.env.KORDYN_COCKPIT_POSITION_CASE || "").trim().toLowerCase();
const resourceStateModes = new Set(["not_loaded", "loading", "loaded", "ready", "stale", "degraded", "error", "failed", "forbidden", "disabled", "unknown"]);
const chartStatusByMode = new Map([
  ["chart-error", "error"], ["chart-empty", "empty"], ["chart-init-error", "error"],
  ["chart-add-series-error", "error"], ["chart-candle-data-error", "error"], ["chart-fit-error", "error"],
  ["chart-refetch-candle-error", "error"], ["chart-refetch-volume-error", "error"], ["chart-update-error", "error"]
]);
const chartLifecycleFailureModes = new Set(["chart-add-series-error", "chart-candle-data-error", "chart-fit-error", "chart-refetch-candle-error", "chart-refetch-volume-error", "chart-update-error"]);
const retainedBodyModes = new Set(["loading", "stale", "degraded"]);
const expectedResourceState = stateMode === "ready" ? "loaded" : stateMode === "unknown" ? "not_loaded" : stateMode || "loaded";
const regularChartMode = !stateMode || ["loaded", "ready"].includes(stateMode);
const marketIntervalSequence = ["1h", "4h", "1D"];
assert.ok(!stateMode || resourceStateModes.has(stateMode) || chartStatusByMode.has(stateMode), `Unsupported KORDYN_COCKPIT_STATE: ${stateMode}`);
assert.ok(!marketCase || ["malformed", "mismatched"].includes(marketCase), `Unsupported KORDYN_COCKPIT_MARKET_CASE: ${marketCase}`);
assert.ok(!positionCase || positionCase === "malformed", `Unsupported KORDYN_COCKPIT_POSITION_CASE: ${positionCase}`);
assert.ok(views.length, "KORDYN_COCKPIT_VIEWS must name at least one canonical cockpit view");

function withCdpCommandTimeout(promise, method) {
  let timeout;
  return new Promise((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`CDP command timed out: ${method}`)), cdpCommandTimeoutMs);
    promise.then((result) => { clearTimeout(timeout); resolve(result); }, (error) => { clearTimeout(timeout); reject(error); });
  });
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitFor(url, predicate = () => true) {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const value = url.endsWith("/json") ? await response.json() : await response.text();
        if (predicate(value)) return value;
      }
    } catch (error) { lastError = error; }
    await delay(80);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let requestId = 0;
  let opened = false;
  let terminalError = null;
  let resolveReady;
  let rejectReady;
  const toError = (cause, fallback) => cause instanceof Error ? cause : new Error(fallback);
  const rejectPending = (cause) => {
    terminalError ||= toError(cause, "CDP socket closed");
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(terminalError);
    }
    pending.clear();
  };
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  socket.on("open", () => { opened = true; resolveReady(); });
  socket.on("error", (error) => {
    if (!opened) rejectReady(error);
    rejectPending(error);
  });
  socket.on("close", (code, reason) => {
    const error = new Error(`CDP socket closed (${code})${reason ? `: ${reason}` : ""}`);
    if (!opened) rejectReady(error);
    rejectPending(error);
  });
  socket.on("message", (payload) => {
    const message = JSON.parse(payload.toString());
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      await withCdpCommandTimeout(ready, method);
      if (terminalError) throw terminalError;
      const id = ++requestId;
      return await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP command timed out: ${method}`));
        }, cdpCommandTimeoutMs);
        pending.set(id, { resolve, reject, timeout });
        try { socket.send(JSON.stringify({ id, method, params })); }
        catch (error) {
          clearTimeout(timeout);
          pending.delete(id);
          reject(error);
        }
      });
    },
    close() { rejectPending(new Error("CDP socket closed by runner")); socket.close(); }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
}

async function waitForExpression(cdp, expression, label) {
  const deadline = Date.now() + 20_000;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) {
      const state = await evaluate(cdp, "({href:location.href,text:document.body?.innerText?.slice(0,800),fixture:document.documentElement?.dataset?.fixtureKind})");
      throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
    }
    await delay(60);
  }
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
    await exited;
  }
}

function spawnManaged(command, args, options) {
  const output = [];
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  child.outputTail = () => output.join("").slice(-4_000);
  return child;
}

const vitePort = await freePort();
const cdpPort = await freePort();
const profile = await mkdtemp(path.join(os.tmpdir(), "trading-cockpit-browser-"));
const baseUrl = `http://127.0.0.1:${vitePort}`;
if (outputDir) await mkdir(outputDir, { recursive: true });
let vite;
let chrome;
let cdp;
try {
  vite = spawnManaged(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: process.cwd(), env: { ...process.env, VITE_APP_RELEASE: "trading-cockpit-browser-fixture" } });
  const vitePid = vite.pid;
  process.stdout.write(`trading cockpit browser: Vite pid=${vitePid} url=${baseUrl}\n`);
  try { await waitFor(`${baseUrl}/tests/trading-cockpit-browser.html`); }
  catch (error) { throw new Error(`Isolated Vite failed to start: ${vite.outputTail()}`, { cause: error }); }

  chrome = spawnManaged(chromeBinary, ["--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, "about:blank"], { cwd: process.cwd() });
  const chromePid = chrome.pid;
  process.stdout.write(`trading cockpit browser: Chrome pid=${chromePid} cdp=${cdpPort}\n`);
  let targets;
  try { targets = await waitFor(`http://127.0.0.1:${cdpPort}/json`, (rows) => rows.some((row) => row.type === "page")); }
  catch (error) { throw new Error(`Chrome failed to start: ${chrome.outputTail()}`, { cause: error }); }
  const page = targets.find((target) => target.type === "page");
  cdp = connectCdp(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const results = [];
  for (const [width, height] of viewports) {
    for (const view of views) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: false });
      const fixtureParams = new URLSearchParams({ view });
      if (emptyMode) fixtureParams.set("empty", "1");
      if (enrichedMode) fixtureParams.set("enriched", "1");
      if (resourceStateModes.has(stateMode)) fixtureParams.set("resource", stateMode);
      if (chartStatusByMode.has(stateMode)) fixtureParams.set("chart", stateMode.replace("chart-", ""));
      if (marketCase) fixtureParams.set("marketCase", marketCase);
      if (positionCase) fixtureParams.set("positionCase", positionCase);
      await cdp.send("Page.navigate", { url: `${baseUrl}/tests/trading-cockpit-browser.html?${fixtureParams}` });
      await waitForExpression(cdp, `document.querySelector('[data-cockpit-page="${view}"]')`, `${width}x${height} ${view} cockpit page`);
      const chartSelector = `[data-cockpit-page="${view}"] [data-cockpit-region="market-chart"]`;
      if (!emptyMode && (regularChartMode || chartStatusByMode.has(stateMode)) && ["overview", "market"].includes(view)) {
        const readyExpression = chartStatusByMode.has(stateMode)
          ? `(() => { const chart = document.querySelector(${JSON.stringify(`${chartSelector} .tvChart`)}); return chart?.dataset.chartStatus === ${JSON.stringify(chartStatusByMode.get(stateMode))}; })()`
          : `(() => { const region = document.querySelector(${JSON.stringify(chartSelector)}); const kline = window.__cockpitKlineFixture; const chart = region?.querySelector(".tvChart"); const expectedVolume = ${JSON.stringify(view === "overview" ? "ready" : "disabled")}; return Boolean(region && kline?.requests > 0 && kline.symbols.includes("BTC/USDT") && chart?.querySelector("canvas") && chart.dataset.volumeSeries === expectedVolume); })()`;
        await waitForExpression(cdp, readyExpression, `${width}x${height} ${view} fixture-backed chart state`);
      }
      if (view === "market" && !emptyMode && regularChartMode) {
        for (const label of marketIntervalSequence) {
          const before = await evaluate(cdp, "window.__cockpitKlineFixture?.requests || 0");
          const wasActive = await evaluate(cdp, `document.querySelector('[data-market-interval][aria-pressed="true"]')?.textContent.trim() === ${JSON.stringify(label)}`);
          await evaluate(cdp, `(() => { const button = [...document.querySelectorAll('[data-market-interval]')].find((node) => node.textContent.trim() === ${JSON.stringify(label)}); button?.click(); return Boolean(button); })()`);
          if (!wasActive) await waitForExpression(cdp, `(window.__cockpitKlineFixture?.requests || 0) > ${before}`, `${width}x${height} market ${label} chart request`);
          await waitForExpression(cdp, `document.querySelector('[data-market-interval][aria-pressed="true"]')?.textContent.trim() === ${JSON.stringify(label)}`, `${width}x${height} market ${label} active interval`);
        }
        const beforeSymbol = await evaluate(cdp, "window.__cockpitKlineFixture?.requests || 0");
        await evaluate(cdp, `(() => { const select = document.querySelector('[data-market-symbol-select]'); if (!select) return false; select.value = 'ETH/USDT'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await waitForExpression(cdp, `(window.__cockpitKlineFixture?.requests || 0) > ${beforeSymbol} && window.__cockpitKlineFixture.queries.some((row) => row.symbol === 'ETH/USDT' && row.tf === '1d')`, `${width}x${height} market canonical ETH/USDT request`);
      }
      if (view === "market" && marketCase === "mismatched") {
        const orphanFacts = await evaluate(cdp, `(() => { const row = document.querySelector('[data-market-watch-unavailable="DOGE/USDT"]'); const select = document.querySelector('[data-market-watch-select="DOGE/USDT"]'); const remove = row?.querySelector('button[aria-label*="DOGE/USDT"]'); return { exists: Boolean(row), selectable: Boolean(select), text: row?.textContent || '', remove: Boolean(remove) }; })()`);
        assert.equal(orphanFacts.exists, true, `${width}x${height} orphaned saved pair remains visible`);
        assert.equal(orphanFacts.selectable, false, `${width}x${height} orphaned saved pair is not selectable`);
        assert.equal(orphanFacts.remove, true, `${width}x${height} orphaned saved pair remains removable`);
        assert.match(orphanFacts.text, /(?:行情不可用|Quote unavailable)/, `${width}x${height} orphaned pair has an honest unavailable quote`);
        assert.doesNotMatch(orphanFacts.text, /\d+(?:\.\d+)?%/, `${width}x${height} orphaned pair does not fabricate change`);
        await evaluate(cdp, `document.querySelector('[data-market-watch-unavailable="DOGE/USDT"] button[aria-label*="DOGE/USDT"]')?.click()`);
        await waitForExpression(cdp, `window.__cockpitLastAction?.path === '/api/watchlist/DOGE%2FUSDT' && window.__cockpitLastAction?.method === 'DELETE'`, `${width}x${height} orphaned watchlist DELETE action`);
        const orphanRequest = await evaluate(cdp, `window.__cockpitKlineFixture?.queries?.some((row) => row.symbol === 'DOGE/USDT')`);
        assert.equal(orphanRequest, false, `${width}x${height} orphaned saved pair never becomes a chart request`);
      }
      let positionActionFacts = null;
      if (view === "positions" && !emptyMode && !positionCase && regularChartMode) {
        const exitExists = await evaluate(cdp, `Boolean(document.querySelector('[data-position-exit][data-execution-id="ord-01"]'))`);
        assert.equal(exitExists, true, `${width}x${height} positions exposes the production exit for its exact execution object`);
        await evaluate(cdp, `document.querySelector('[data-position-exit][data-execution-id="ord-01"]')?.focus()`);
        const exitFocus = await evaluate(cdp, `(() => { const node = document.querySelector('[data-position-exit][data-execution-id="ord-01"]'); const style = node ? getComputedStyle(node) : null; return style ? style.outlineStyle + ' ' + style.outlineWidth : null; })()`);
        assert.notEqual(exitFocus, "none 0px", `${width}x${height} positions exit action has a visible focus ring`);
        await evaluate(cdp, `document.querySelector('[data-position-exit][data-execution-id="ord-01"]')?.click()`);
        await waitForExpression(cdp, `document.querySelector('.cfmCard[role="dialog"]')`, `${width}x${height} positions canonical exit confirmation`);
        const confirmation = await evaluate(cdp, `(() => ({ text: document.querySelector('.cfmCard')?.textContent || '', beforeAction: window.__cockpitLastAction || null, activeClass: document.activeElement?.className || '' }))()`);
        assert.match(confirmation.text, /ETH\/USDT/, `${width}x${height} confirmation identifies the selected position's exact execution object`);
        assert.equal(confirmation.beforeAction, null, `${width}x${height} positions never writes before confirmation`);
        assert.match(confirmation.activeClass, /cfmCancel/, `${width}x${height} confirmation moves focus into the dialog`);
        await evaluate(cdp, `document.querySelector('.cfmOk')?.click()`);
        await waitForExpression(cdp, `window.__cockpitLastAction?.path === '/api/execution-orders/ord-01/close'`, `${width}x${height} positions canonical execution exit request`);
        positionActionFacts = await evaluate(cdp, `window.__cockpitLastAction`);
        assert.deepEqual(positionActionFacts, {
          path: "/api/execution-orders/ord-01/close",
          payload: { reason: "manual_ui", intent: "close_position", expectedStatus: "protecting" }
        }, `${width}x${height} positions preserves the canonical execution action payload`);
      }
      const facts = await evaluate(cdp, `(() => { const page = document.querySelector('[data-cockpit-page]'); const region = document.querySelector(${JSON.stringify(chartSelector)}); const chart = region?.querySelector('.tvChart'); const kline = window.__cockpitKlineFixture || {}; const lifecycle = window.__cockpitChartFailure || {}; const main = document.querySelector('[data-cockpit-page="overview"] .overviewPrimary'); const rail = document.querySelector('[data-cockpit-page="overview"] .overviewRail'); const lastRegion = document.querySelector('[data-cockpit-page="overview"] [data-cockpit-region="strategy-footer"]'); const marketWorkspace = document.querySelector('[data-cockpit-page="market"] .marketWorkspace'); const marketChartWorkspace = document.querySelector('[data-cockpit-page="market"] [data-cockpit-region="market-chart-workspace"]'); const marketInterval = document.querySelector('[data-market-interval][aria-pressed="true"]'); marketInterval?.focus(); const marketFocusedStyle = marketInterval ? getComputedStyle(marketInterval) : null; const canvas = chart?.querySelector('canvas'); const overviewRegions = Object.fromEntries([...document.querySelectorAll('[data-cockpit-page="overview"] [data-cockpit-region]')].map((node) => { const rect = node.getBoundingClientRect(); return [node.dataset.cockpitRegion, { top: Math.round(rect.top * 100) / 100, height: Math.round(rect.height * 100) / 100 }]; })); const targets = ['overview', 'market'].includes(page?.dataset.cockpitPage) ? [...page.querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])')].filter((node) => !node.disabled && !node.closest('.tvChart') && getComputedStyle(node).display !== 'none') : []; const targetFacts = targets.map((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return { label: node.getAttribute('aria-label') || node.textContent?.trim() || node.className, tag: node.tagName, className: node.className, width: rect.width, height: rect.height, minWidth: style.minWidth, minHeight: style.minHeight, size: Math.min(rect.width, rect.height) }; }).filter((row) => Number.isFinite(row.size)); const targetSizes = targetFacts.map((row) => row.size); const smallestTarget = targetFacts.sort((a, b) => a.size - b.size)[0] || null; const readableText = page?.dataset.cockpitPage === 'overview' ? [...page.querySelectorAll('small, p, time, em, th, td, button, .cockpitTone')].filter((node) => !node.matches('.overviewMarketQuote > div > b, .overviewHeroEquity b, .overviewHeroFact b, .overviewAiLead b, .cockpitGauge b')) : []; const textFacts = readableText.filter((node) => getComputedStyle(node).display !== 'none').map((node) => ({ label: node.textContent?.trim() || node.className, size: Number.parseFloat(getComputedStyle(node).fontSize) })).filter((row) => Number.isFinite(row.size)); const textSizes = textFacts.map((row) => row.size); const smallestText = textFacts.sort((a, b) => a.size - b.size)[0] || null; const fixtureFields = window.__cockpitFixtureFields || []; return ({ fixture: document.documentElement.dataset.fixtureKind, fixtureFields, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, resourceState: page?.dataset.resourceState || null, statePanel: page?.querySelector('[data-overview-resource-state]')?.dataset.overviewResourceState || page?.querySelector('[data-market-resource-state]')?.dataset.marketResourceState || null, regionCharts: region?.querySelectorAll(".tvChart canvas").length || 0, chartVisible: Boolean(canvas && canvas.getBoundingClientRect().width > 0 && canvas.getBoundingClientRect().height > 0), chartStatus: chart?.dataset.chartStatus || null, volumeSeries: chart?.dataset.volumeSeries || null, chartRemovals: lifecycle.removals || 0, chartRuntimeErrors: lifecycle.runtimeErrors || 0, chartUnhandledRejections: lifecycle.unhandledRejections || 0, candleSetDataCalls: lifecycle.candleSetDataCalls || 0, volumeSetDataCalls: lifecycle.volumeSetDataCalls || 0, chartUpdateCalls: lifecycle.updateCalls || 0, minKeyboardTargetPx: targetSizes.length ? Math.min(...targetSizes) : null, minMarketTargetPx: page?.dataset.cockpitPage === 'market' && targetSizes.length ? Math.min(...targetSizes) : null, smallestTarget, minOverviewTextPx: textSizes.length ? Math.min(...textSizes) : null, maxOverviewTextPx: textSizes.length ? Math.max(...textSizes) : null, smallestText, mainRailRatio: main && rail ? main.getBoundingClientRect().width / rail.getBoundingClientRect().width : null, lastRegionTop: lastRegion?.getBoundingClientRect().top ?? null, overviewRegions, marketActiveIntervals: document.querySelectorAll('[data-market-interval][aria-pressed="true"]').length, marketChartWorkspaceRatio: marketWorkspace && marketChartWorkspace ? marketChartWorkspace.getBoundingClientRect().width / marketWorkspace.getBoundingClientRect().width : null, marketCanonicalSymbol: page?.dataset.marketSymbol || null, marketFocusedOutline: marketFocusedStyle ? marketFocusedStyle.outlineStyle + ' ' + marketFocusedStyle.outlineWidth : null, klineRequests: kline.requests || 0, klineSymbols: kline.symbols || [], klineQueries: kline.queries || [], page: page?.dataset.cockpitPage }); })()`);
      const marketStateFacts = view === "market" ? await evaluate(cdp, `(() => { const page = document.querySelector('[data-cockpit-page="market"]'); const regions = [...page.querySelectorAll('[data-cockpit-region]')].map((node) => node.dataset.cockpitRegion); return { regions, symbolSelectDisabled: Boolean(page.querySelector('[data-market-symbol-select]')?.disabled), hasChartLoadingText: /加载 K 线|Loading candlesticks/.test(page.textContent || '') }; })()`) : null;
      const positionStateFacts = view === "positions" ? await evaluate(cdp, `(() => {
        const page = document.querySelector('[data-cockpit-page="positions"]');
        const workspace = page?.querySelector('.positionWorkspace');
        const columns = workspace ? [...workspace.children].slice(0, 3).map((node) => node.getBoundingClientRect().width) : [];
        const totalWidth = columns.reduce((sum, value) => sum + value, 0);
        const targets = page ? [...page.querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])')].filter((node) => !node.disabled && getComputedStyle(node).display !== 'none') : [];
        const targetFacts = targets.map((node) => { const rect = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label') || node.textContent?.trim() || node.className, size: Math.min(rect.width, rect.height) }; }).filter((row) => Number.isFinite(row.size));
        const positionRow = page?.querySelector('[data-position-id="ord-04"]');
        const tableRegion = page?.querySelector('[data-cockpit-region="position-table"]');
        const trendRegion = page?.querySelector('[data-cockpit-region="portfolio-pnl-trend"]');
        const trend = trendRegion?.querySelector('.cockpitAreaTrend');
        return {
          state: page?.dataset.resourceState || null,
          statePanel: page?.querySelector('[data-position-resource-state]')?.dataset.positionResourceState || null,
          regions: [...(page?.querySelectorAll('[data-cockpit-region]') || [])].map((node) => node.dataset.cockpitRegion),
          rowCount: page?.querySelectorAll('[data-position-id]').length || 0,
          positionOnlyText: positionRow?.textContent || '',
          positionOnlyExecution: positionRow?.dataset.executionId || null,
          wrongProtectionVisible: /13\.37|14\.88/.test(positionRow?.textContent || ''),
          exitCount: page?.querySelectorAll('[data-position-exit]').length || 0,
          tableHeight: tableRegion?.getBoundingClientRect().height || 0,
          trendWidthRatio: trendRegion && trend ? trend.getBoundingClientRect().width / trendRegion.getBoundingClientRect().width : null,
          columnPct: totalWidth ? columns.map((value) => value / totalWidth * 100) : [],
          minTargetPx: targetFacts.length ? Math.min(...targetFacts.map((row) => row.size)) : null,
          smallestTarget: targetFacts.sort((a, b) => a.size - b.size)[0] || null
        };
      })()`) : null;
      assert.equal(facts.fixture, "production-shaped-synthetic", `${width}x${height} ${view} uses the marked test-only fixture`);
      assert.equal(facts.page, view, `${width}x${height} renders the requested real cockpit view`);
      assert.equal(facts.overflow, 0, `${width}x${height} ${view} has no document overflow`);
      if (view === "overview") {
        for (const field of ["notifications", "portfolioRisk", "accountSnapshots"]) assert.equal(facts.fixtureFields.includes(field), true, `${width}x${height} production-shaped cockpit fixture includes ${field}`);
        for (const field of ["events", "agentRuns", "jobRuns", "riskRules", "strategyCatalog"]) assert.equal(facts.fixtureFields.includes(field), enrichedMode, `${width}x${height} cockpit fixture ${enrichedMode ? "includes opt-in" : "omits"} ${field}`);
      }
      if (!emptyMode && regularChartMode && ["overview", "market"].includes(view)) {
        assert.ok(facts.klineRequests > 0, `${width}x${height} ${view} intercepted a K-line request`);
        assert.ok(facts.klineSymbols.includes("BTC/USDT"), `${width}x${height} ${view} intercepted its BTC/USDT fixture candles`);
        assert.ok(facts.regionCharts >= 1, `${width}x${height} ${view} renders fixture candles in its market-chart region`);
        assert.equal(facts.chartVisible, true, `${width}x${height} ${view} chart canvas is visible`);
        assert.equal(facts.volumeSeries, view === "overview" ? "ready" : "disabled", `${width}x${height} ${view} exposes its ${view === "overview" ? "opt-in" : "default-off"} volume contract`);
      }
      if (resourceStateModes.has(stateMode) && view === "overview") {
        assert.equal(facts.resourceState, expectedResourceState, `${width}x${height} overview normalizes ${stateMode} to ${expectedResourceState}`);
        assert.equal(facts.statePanel, ["loaded", "ready"].includes(stateMode) ? null : expectedResourceState, `${width}x${height} overview renders the expected ${stateMode} state boundary`);
        if (!["loaded", "ready"].includes(stateMode)) {
          assert.equal(facts.klineRequests, 0, `${width}x${height} ${stateMode} overview does not request a current chart`);
          assert.equal(facts.regionCharts, 0, `${width}x${height} ${stateMode} overview does not mount a current chart`);
          assert.equal(Boolean(facts.overviewRegions["portfolio-hero"]), retainedBodyModes.has(stateMode), `${width}x${height} ${stateMode} overview ${retainedBodyModes.has(stateMode) ? "retains" : "blocks"} last-valid body facts`);
        }
      }
      if (resourceStateModes.has(stateMode) && view === "market") {
        assert.equal(facts.resourceState, expectedResourceState, `${width}x${height} market normalizes ${stateMode} to ${expectedResourceState}`);
        assert.equal(facts.statePanel, ["loaded", "ready"].includes(stateMode) ? null : expectedResourceState, `${width}x${height} market renders the expected ${stateMode} state boundary`);
        if (!["loaded", "ready"].includes(stateMode)) {
          assert.equal(facts.klineRequests, 0, `${width}x${height} ${stateMode} market does not request current candles`);
          assert.equal(facts.regionCharts, 0, `${width}x${height} ${stateMode} market does not mount a current chart`);
          assert.equal(marketStateFacts.regions.includes("market-header"), retainedBodyModes.has(stateMode), `${width}x${height} ${stateMode} market ${retainedBodyModes.has(stateMode) ? "retains" : "blocks"} last-valid body facts`);
        }
      }
      if (chartStatusByMode.has(stateMode) && view === "overview") {
        assert.equal(facts.chartStatus, chartStatusByMode.get(stateMode), `${width}x${height} overview exposes honest ${stateMode} status`);
        assert.equal(facts.volumeSeries, chartStatusByMode.get(stateMode), `${width}x${height} overview propagates ${stateMode} to its volume layer`);
        if (stateMode === "chart-init-error" || chartLifecycleFailureModes.has(stateMode)) assert.equal(facts.regionCharts, 0, `${width}x${height} overview removes the partially initialized chart`);
        if (chartLifecycleFailureModes.has(stateMode)) {
          assert.ok(facts.chartRemovals >= 1, `${width}x${height} ${stateMode} invokes chart cleanup after partial creation`);
          assert.equal(facts.chartRuntimeErrors, 0, `${width}x${height} ${stateMode} creates no unhandled runtime error`);
          assert.equal(facts.chartUnhandledRejections, 0, `${width}x${height} ${stateMode} creates no unhandled promise rejection`);
          if (stateMode === "chart-candle-data-error") assert.ok(facts.candleSetDataCalls >= 1, `${width}x${height} exercises candle data setup before cleanup`);
          if (stateMode === "chart-fit-error") {
            assert.ok(facts.candleSetDataCalls >= 1, `${width}x${height} fit failure follows candle setup`);
            assert.ok(facts.volumeSetDataCalls >= 1, `${width}x${height} fit failure follows volume setup`);
          }
          if (stateMode === "chart-refetch-candle-error") assert.ok(facts.candleSetDataCalls >= 2, `${width}x${height} exercises the timed candle refetch`);
          if (stateMode === "chart-refetch-volume-error") assert.ok(facts.volumeSetDataCalls >= 2, `${width}x${height} exercises the timed volume refetch`);
          if (stateMode === "chart-update-error") assert.ok(facts.chartUpdateCalls >= 1, `${width}x${height} exercises a live series update`);
        }
      }
      if (chartStatusByMode.has(stateMode) && view === "market") {
        assert.equal(facts.chartStatus, chartStatusByMode.get(stateMode), `${width}x${height} market exposes honest ${stateMode} status`);
        assert.equal(facts.volumeSeries, "disabled", `${width}x${height} market preserves the default-off volume contract during ${stateMode}`);
        assert.equal(marketStateFacts.hasChartLoadingText, false, `${width}x${height} market ${stateMode} settles without permanent loading text`);
      }
      if (view === "overview" && !chartLifecycleFailureModes.has(stateMode) && width === 1440 && (!resourceStateModes.has(stateMode) || ["loaded", "ready"].includes(stateMode))) {
        process.stdout.write(`trading cockpit overview geometry ${JSON.stringify({ mainRailRatio: facts.mainRailRatio, lastRegionTop: facts.lastRegionTop, regions: facts.overviewRegions })}\n`);
        assert.ok(facts.mainRailRatio >= 1.30 && facts.mainRailRatio <= 1.55, `1440 overview main/rail ratio ${facts.mainRailRatio} is within 1.30–1.55`);
        assert.ok(facts.lastRegionTop != null && facts.lastRegionTop < 1070, `1440 overview final region begins before 1070px (received ${facts.lastRegionTop})`);
      }
      if (view === "overview" && !chartLifecycleFailureModes.has(stateMode) && (!resourceStateModes.has(stateMode) || ["loaded", "ready"].includes(stateMode) || retainedBodyModes.has(stateMode))) {
        assert.ok(facts.minKeyboardTargetPx >= 36, `${width}x${height} overview keyboard target minimum ${facts.minKeyboardTargetPx}px is at least 36px: ${JSON.stringify(facts.smallestTarget)}`);
        assert.ok(facts.minOverviewTextPx >= 11 && facts.maxOverviewTextPx <= 13, `${width}x${height} overview copy/table text ${facts.minOverviewTextPx}–${facts.maxOverviewTextPx}px stays within 11–13px: ${JSON.stringify(facts.smallestText)}`);
      }
      if (view === "market" && !chartLifecycleFailureModes.has(stateMode) && (!resourceStateModes.has(stateMode) || ["loaded", "ready"].includes(stateMode) || retainedBodyModes.has(stateMode))) {
        assert.equal(facts.marketActiveIntervals, 1, `${width}x${height} market has exactly one active interval`);
        assert.ok(facts.marketChartWorkspaceRatio >= .65, `${width}x${height} market chart workspace ratio ${facts.marketChartWorkspaceRatio} is at least 65%`);
        if (!emptyMode) {
          assert.ok(facts.minMarketTargetPx >= 36, `${width}x${height} market keyboard target minimum ${facts.minMarketTargetPx}px is at least 36px: ${JSON.stringify(facts.smallestTarget)}`);
          assert.notEqual(facts.marketFocusedOutline, "none 0px", `${width}x${height} market focused interval has a visible outline`);
        } else {
          assert.equal(marketStateFacts.symbolSelectDisabled, true, `${width}x${height} empty market disables its symbol selector`);
          assert.equal(facts.klineRequests, 0, `${width}x${height} empty market does not request an identity-less chart`);
          assert.equal(facts.regionCharts, 0, `${width}x${height} empty market renders no fabricated chart`);
        }
        if (!emptyMode && regularChartMode) {
          assert.equal(facts.marketCanonicalSymbol, "ETH/USDT", `${width}x${height} market canonical identity follows the real symbol selector`);
          assert.ok(facts.klineQueries.some((row) => row.symbol === "BTC/USDT" && row.tf === "1h"), `${width}x${height} market requested the 1h canonical interval`);
          assert.ok(facts.klineQueries.some((row) => row.symbol === "BTC/USDT" && row.tf === "4h"), `${width}x${height} market requested the 4h canonical interval`);
          assert.ok(facts.klineQueries.some((row) => row.symbol === "BTC/USDT" && row.tf === "1d"), `${width}x${height} market requested the 1D canonical interval`);
        }
      }
      if (view === "market" && marketCase === "malformed") {
        assert.ok(facts.klineQueries.every((row) => /^(?:[^/\s]+)\/(?:[^/\s]+)$/.test(row.symbol)), `${width}x${height} malformed market fixture emits only canonical pair requests`);
        assert.ok(facts.klineQueries.every((row) => row.symbol === row.symbol.trim()), `${width}x${height} market chart requests use trimmed identities`);
        const selectorSymbols = await evaluate(cdp, `[...document.querySelectorAll('[data-market-symbol-select] option')].map((node) => node.value)`);
        assert.deepEqual(selectorSymbols, ["BTC/USDT", "ETH/USDT"], `${width}x${height} selector contains only normalized canonical identities`);
        const eventRows = await evaluate(cdp, `document.querySelectorAll('[data-cockpit-region="event-catalysts"] .marketEventRows article').length`);
        assert.equal(eventRows, 0, `${width}x${height} severity-only and date-only shells do not render as event catalysts`);
      }
      if (view === "positions") {
        const requiredRegions = ["position-hero", "account-constraints", "position-allocation", "long-short", "pnl-distribution", "position-table", "portfolio-pnl-trend", "risk-health", "margin-safety", "concentration"];
        if (resourceStateModes.has(stateMode) && !["loaded", "ready"].includes(stateMode)) {
          assert.equal(positionStateFacts.state, expectedResourceState, `${width}x${height} positions normalizes ${stateMode} to ${expectedResourceState}`);
          assert.equal(positionStateFacts.statePanel, expectedResourceState, `${width}x${height} positions renders its ${stateMode} state boundary`);
          assert.equal(positionStateFacts.exitCount, 0, `${width}x${height} ${stateMode} positions exposes no action against non-current facts`);
          const retains = retainedBodyModes.has(stateMode);
          assert.equal(positionStateFacts.regions.includes("position-hero"), retains, `${width}x${height} ${stateMode} positions ${retains ? "retains" : "blocks"} last-valid facts`);
          if (positionStateFacts.minTargetPx !== null) assert.ok(positionStateFacts.minTargetPx >= 36, `${width}x${height} ${stateMode} positions control target ${positionStateFacts.minTargetPx}px is at least 36px`);
        } else if (emptyMode) {
          assert.equal(positionStateFacts.rowCount, 0, `${width}x${height} empty positions renders no fabricated row`);
          assert.equal(positionStateFacts.exitCount, 0, `${width}x${height} empty positions renders no exit action`);
          assert.ok(positionStateFacts.tableHeight > 0 && positionStateFacts.tableHeight < 260, `${width}x${height} empty positions uses a compact table state (${positionStateFacts.tableHeight}px)`);
        } else if (positionCase === "malformed") {
          assert.equal(positionStateFacts.rowCount, 0, `${width}x${height} malformed positions renders no identity-less row`);
          assert.equal(positionStateFacts.exitCount, 0, `${width}x${height} malformed positions cannot authorize an exit`);
          assert.equal(positionStateFacts.wrongProtectionVisible, false, `${width}x${height} malformed positions does not render unrelated protection`);
        } else {
          for (const region of requiredRegions) assert.ok(positionStateFacts.regions.includes(region), `${width}x${height} positions renders ${region}`);
          assert.equal(positionStateFacts.positionOnlyExecution, "ord-00", `${width}x${height} positionId-only row resolves the exact position-linked execution, not colliding order id ord-04`);
          assert.match(positionStateFacts.positionOnlyText, /110,834\.53/, `${width}x${height} positionId-only row renders its exact joined stop`);
          assert.match(positionStateFacts.positionOnlyText, /116,547\.65/, `${width}x${height} positionId-only row renders its exact joined target`);
          assert.equal(positionStateFacts.wrongProtectionVisible, false, `${width}x${height} positionId-only row cannot borrow wrong-row protection`);
          assert.ok(positionStateFacts.minTargetPx >= 36, `${width}x${height} positions keyboard target minimum ${positionStateFacts.minTargetPx}px is at least 36px: ${JSON.stringify(positionStateFacts.smallestTarget)}`);
          assert.ok(positionStateFacts.trendWidthRatio >= .9, `${width}x${height} positions PnL trend uses the available panel width (${positionStateFacts.trendWidthRatio})`);
          if (width === 1440) {
            assert.equal(positionStateFacts.columnPct.length, 3, "1440 positions exposes its three workbench columns");
            const expected = [24, 52, 24];
            positionStateFacts.columnPct.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 8, `1440 positions column ${index + 1} is ${value.toFixed(2)}%, near ${expected[index]}%`));
          }
        }
      }
      if (outputDir && view === "market" && !emptyMode && regularChartMode) {
        const beforeCaptureReset = await evaluate(cdp, "window.__cockpitKlineFixture?.requests || 0");
        await evaluate(cdp, `(() => { const select = document.querySelector('[data-market-symbol-select]'); if (!select) return false; select.value = 'BTC/USDT'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
        await waitForExpression(cdp, `document.querySelector('[data-cockpit-page="market"]')?.dataset.marketSymbol === 'BTC/USDT' && (window.__cockpitKlineFixture?.requests || 0) > ${beforeCaptureReset}`, `${width}x${height} market capture reset`);
      }
      if (outputDir && view === "positions") await evaluate(cdp, `(() => { const scroller = document.querySelector('.positionTableScroll'); if (!scroller) return false; scroller.scrollLeft = 0; return true; })()`);
      if (outputDir) {
        const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
        await writeFile(path.join(outputDir, `${view}-${width}x${height}${emptyMode ? "-empty" : stateMode ? `-${stateMode}` : enrichedMode ? "-enriched" : ""}.png`), Buffer.from(shot.data, "base64"));
      }
      results.push({ width, height, view, charts: facts.regionCharts, klineRequests: facts.klineRequests, overflow: facts.overflow, resourceState: facts.resourceState, chartStatus: facts.chartStatus, volumeSeries: facts.volumeSeries, chartRemovals: facts.chartRemovals, chartRuntimeErrors: facts.chartRuntimeErrors, chartUnhandledRejections: facts.chartUnhandledRejections, minKeyboardTargetPx: facts.minKeyboardTargetPx, minMarketTargetPx: facts.minMarketTargetPx, minOverviewTextPx: facts.minOverviewTextPx, maxOverviewTextPx: facts.maxOverviewTextPx, mainRailRatio: facts.mainRailRatio, marketChartWorkspaceRatio: facts.marketChartWorkspaceRatio, marketCanonicalSymbol: facts.marketCanonicalSymbol, marketRegions: marketStateFacts?.regions, positionStateFacts, positionActionFacts, lastRegionTop: facts.lastRegionTop, overviewRegions: facts.overviewRegions });
    }
  }
  console.log(`trading cockpit browser PASS ${JSON.stringify(results)}`);
} finally {
  cdp?.close();
  await stop(chrome);
  await stop(vite);
  await rm(profile, { recursive: true, force: true });
  console.log("trading cockpit browser cleanup PASS chrome/vite stopped and profile removed");
}
