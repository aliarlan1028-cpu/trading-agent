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
const reviewCase = String(process.env.KORDYN_COCKPIT_REVIEW_CASE || "").trim().toLowerCase();
const ledgerCase = String(process.env.KORDYN_COCKPIT_LEDGER_CASE || "").trim().toLowerCase();
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
assert.ok(!positionCase || ["malformed", "partial"].includes(positionCase), `Unsupported KORDYN_COCKPIT_POSITION_CASE: ${positionCase}`);
assert.ok(!reviewCase || ["malformed"].includes(reviewCase), `Unsupported KORDYN_COCKPIT_REVIEW_CASE: ${reviewCase}`);
assert.ok(!ledgerCase || ["adversarial", "malformed", "long", "identity", "risk-counterexamples", "status-counterexamples", "collections-missing", "collections-malformed"].includes(ledgerCase), `Unsupported KORDYN_COCKPIT_LEDGER_CASE: ${ledgerCase}`);
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

  let historyFacts = null;
  const runHistoryGate = !emptyMode && !enrichedMode && !stateMode && !marketCase && !positionCase && !reviewCase && !ledgerCase;
  if (runHistoryGate) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1080, screenWidth: 1440, screenHeight: 1080, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `${baseUrl}/tests/trading-cockpit-browser.html?view=overview&historyCase=1` });
    await waitForExpression(cdp, `location.pathname === '/app' && document.querySelector('[data-classic-view="chat"]')`, "history gate starts at app root in AI chat");
    const steps = [await evaluate(cdp, `({ step: 'start', path: location.pathname, view: document.querySelector('.appShell')?.dataset.classicView || '' })`)];

    await evaluate(cdp, `document.querySelector('[data-classic-target="cockpit"]')?.click()`);
    await waitForExpression(cdp, `location.pathname === '/app/trade/overview' && document.querySelector('[data-cockpit-page="overview"]')`, "history gate enters real cockpit");
    steps.push(await evaluate(cdp, `({ step: 'enter', path: location.pathname, view: document.querySelector('.appShell')?.dataset.classicView || '' })`));

    await evaluate(cdp, `history.back()`);
    await waitForExpression(cdp, `location.pathname === '/app' && document.querySelector('[data-classic-view="chat"]')`, "Back restores AI chat UI");
    steps.push(await evaluate(cdp, `({ step: 'back', path: location.pathname, view: document.querySelector('.appShell')?.dataset.classicView || '' })`));

    await evaluate(cdp, `history.forward()`);
    await waitForExpression(cdp, `location.pathname === '/app/trade/overview' && document.querySelector('[data-cockpit-page="overview"]')`, "Forward restores cockpit UI");
    steps.push(await evaluate(cdp, `({ step: 'forward', path: location.pathname, view: document.querySelector('.appShell')?.dataset.classicView || '' })`));

    await evaluate(cdp, `document.querySelector('.cockpitBrand')?.click()`);
    await waitForExpression(cdp, `location.pathname === '/app' && document.querySelector('[data-classic-view="chat"]')`, "cockpit brand exits to AI chat and app root");
    steps.push(await evaluate(cdp, `({ step: 'brand-exit', path: location.pathname, view: document.querySelector('.appShell')?.dataset.classicView || '' })`));
    await evaluate(cdp, `history.back()`);
    await waitForExpression(cdp, `location.pathname === '/app/trade/overview' && document.querySelector('[data-cockpit-page="overview"]')`, "Back returns from brand exit to cockpit");
    await evaluate(cdp, `history.forward()`);
    await waitForExpression(cdp, `location.pathname === '/app' && document.querySelector('[data-classic-view="chat"]')`, "Forward restores brand destination");

    await evaluate(cdp, `history.back()`);
    await waitForExpression(cdp, `document.querySelector('[data-cockpit-page="overview"]')`, "settings exit starts in cockpit");
    await evaluate(cdp, `document.querySelector('.cockpitIconButton[aria-label="系统设置"]')?.click()`);
    await waitForExpression(cdp, `location.pathname === '/app' && document.querySelector('[data-classic-view="systemSettings"]')`, "settings exit clears cockpit URL and preserves UI destination");
    steps.push(await evaluate(cdp, `({ step: 'settings-exit', path: location.pathname, view: document.querySelector('.appShell')?.dataset.classicView || '', route: document.querySelector('.appShell')?.dataset.classicCapability || '' })`));
    await evaluate(cdp, `history.back()`);
    await waitForExpression(cdp, `location.pathname === '/app/trade/overview' && document.querySelector('[data-cockpit-page="overview"]')`, "Back restores cockpit after settings exit");
    await evaluate(cdp, `history.forward()`);
    await waitForExpression(cdp, `location.pathname === '/app' && document.querySelector('[data-classic-view="systemSettings"]')`, "Forward restores settings UI from history state");
    steps.push(await evaluate(cdp, `({ step: 'settings-forward', path: location.pathname, view: document.querySelector('.appShell')?.dataset.classicView || '', route: document.querySelector('.appShell')?.dataset.classicCapability || '' })`));

    await evaluate(cdp, `document.querySelector('[data-classic-target="chat"]')?.click()`);
    await waitForExpression(cdp, `location.pathname === '/app' && document.querySelector('[data-classic-view="chat"]')`, "alias gate starts from app-root chat");
    const aliasCases = [
      { query: "synthetic-okx", objectId: "synthetic-okx", objectType: "Account", route: "marketAccount", path: "/app/trade/overview", page: "overview" },
      { query: "plan-0", objectId: "plan-0", objectType: "Trade plan", route: "signalHub", path: "/app/trade/execution-review", page: "execution" },
      { query: "ord-00", objectId: "ord-00", objectType: "Execution", route: "executionReview", path: "/app/trade/execution-review", page: "execution" },
      { query: "review-00", objectId: "review-00", objectType: "Review", route: "labReviews", path: "/app/trade/execution-review", page: "execution" },
      { query: "tradeReviewDetail", featureRoute: "tradeReviewDetail", route: "tradeReviewDetail", path: "/app/trade/execution-review", page: "execution" },
      { query: "ownerReviewWorkspace", featureRoute: "ownerReviewWorkspace", route: "ownerReviewWorkspace", path: "/app/trade/execution-review", page: "execution" },
      { query: "tradeLedger", featureRoute: "tradeLedger", route: "tradeLedger", path: "/app/trade/orders-fills", page: "ledger" },
      { dispatchRoute: true, route: "portfolioProtection", path: "/app/trade/positions", page: "positions" },
      { dispatchRoute: true, route: "tradeOrders", path: "/app/trade/orders-fills", page: "ledger" },
      { dispatchRoute: true, route: "tradeFills", path: "/app/trade/orders-fills", page: "ledger" }
    ];
    const aliasFacts = [];
    for (const aliasCase of aliasCases) {
      if (aliasCase.dispatchRoute) {
        const dispatched = await evaluate(cdp, `(() => { const host = document.querySelector('.appTopbar'); const key = host && Object.keys(host).find((name) => name.startsWith('__reactFiber$')); let fiber = key ? host[key] : null; while (fiber) { const setActive = fiber.memoizedProps?.setActive || fiber.memoizedProps?.ui?.setActive; if (typeof setActive === 'function') { setActive(${JSON.stringify(aliasCase.route)}); return true; } fiber = fiber.return; } return false; })()`);
        assert.equal(dispatched, true, `${aliasCase.route} dispatches through the mounted production shell setActive entry`);
      } else {
        await evaluate(cdp, `(() => { const input = document.querySelector('[aria-label="全局搜索"]'); if (!input) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(aliasCase.query)}); input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
        const resultExpression = aliasCase.featureRoute
          ? `(() => [...document.querySelectorAll('#august15-search-results [role="option"]')].some((node) => node.querySelector('code')?.textContent === ${JSON.stringify(aliasCase.featureRoute)}))()`
          : `Boolean(document.querySelector('#august15-search-results [data-shell-object-id=${JSON.stringify(aliasCase.objectId)}][data-shell-object-type=${JSON.stringify(aliasCase.objectType)}]'))`;
        await waitForExpression(cdp, resultExpression, `${aliasCase.route} production search result`);
        await evaluate(cdp, aliasCase.featureRoute
          ? `([...document.querySelectorAll('#august15-search-results [role="option"]')].find((node) => node.querySelector('code')?.textContent === ${JSON.stringify(aliasCase.featureRoute)}))?.click()`
          : `document.querySelector('#august15-search-results [data-shell-object-id=${JSON.stringify(aliasCase.objectId)}][data-shell-object-type=${JSON.stringify(aliasCase.objectType)}]')?.click()`);
      }
      await waitForExpression(cdp, `location.pathname === ${JSON.stringify(aliasCase.path)} && document.querySelector('[data-cockpit-page=${JSON.stringify(aliasCase.page)}]')`, `${aliasCase.route} canonical cockpit destination`);
      aliasFacts.push({ requestedRoute: aliasCase.route, provenance: aliasCase.dispatchRoute ? "mounted-production-shell-setActive" : "production-search", ...await evaluate(cdp, `({ activeRoute: document.querySelector('.appShell')?.dataset.classicCapability || '', path: location.pathname, page: document.querySelector('[data-cockpit-page]')?.dataset.cockpitPage || '' })`) });
      await evaluate(cdp, `document.querySelector('.cockpitBrand')?.click()`);
      await waitForExpression(cdp, `location.pathname === '/app' && document.querySelector('[data-classic-view="chat"]')`, `${aliasCase.route} returns to app-root chat`);
    }

    const forgedFacts = [];
    for (const forgedRoute of ["marketAccount", "tradeReviewDetail:review-18", "retiredCockpitAlias"]) {
      await evaluate(cdp, `(() => { const state = { kordynRoute: ${JSON.stringify(forgedRoute)} }; history.replaceState(state, '', '/app'); window.dispatchEvent(new PopStateEvent('popstate', { state })); })()`);
      await waitForExpression(cdp, `location.pathname === '/app' && document.querySelector('[data-classic-view="chat"]') && document.querySelector('.appShell')?.dataset.classicCapability === 'chat'`, `${forgedRoute} fails closed at app root`);
      forgedFacts.push(await evaluate(cdp, `({ stateRoute: history.state?.kordynRoute || '', path: location.pathname, view: document.querySelector('.appShell')?.dataset.classicView || '', route: document.querySelector('.appShell')?.dataset.classicCapability || '' })`));
    }
    historyFacts = { steps, aliasFacts, forgedFacts };
  }

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
      if (reviewCase) fixtureParams.set("reviewCase", reviewCase);
      if (ledgerCase) fixtureParams.set("ledgerCase", ledgerCase);
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
      let reviewInteractionFacts = null;
      if (view === "execution" && !emptyMode && !reviewCase && (!resourceStateModes.has(stateMode) || ["loaded", "ready"].includes(stateMode))) {
        const before = await evaluate(cdp, `(() => { const detail = document.querySelector('[data-review-detail-id]'); return { selectedId: document.querySelector('[data-cockpit-page="execution"]')?.dataset.selectedReviewId || '', detailId: detail?.dataset.reviewDetailId || '', detailText: detail?.textContent || '', pathText: document.querySelector('[data-cockpit-region="trade-path"]')?.textContent || '' }; })()`);
        assert.match(before.pathText, /(?:未记录逐时路径|No intratrade path recorded)/, `${width}x${height} review initially exposes the honest no-path state`);
        await evaluate(cdp, `document.querySelector('[data-review-page-next]')?.click()`);
        await waitForExpression(cdp, `document.querySelector('[data-review-page="2"]')`, `${width}x${height} review page two`);
        const pageTwoId = await evaluate(cdp, `document.querySelector('[data-review-page="2"] [data-review-id]')?.dataset.reviewId || ''`);
        assert.ok(pageTwoId, `${width}x${height} review page two contains a canonical review`);
        await evaluate(cdp, `document.querySelector('[data-review-page="2"] [data-review-id]')?.focus()`);
        await evaluate(cdp, `document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`);
        await waitForExpression(cdp, `document.querySelector('[data-review-detail-id]')?.dataset.reviewDetailId === ${JSON.stringify(pageTwoId)}`, `${width}x${height} review page-two selection`);
        const after = await evaluate(cdp, `(() => { const page = document.querySelector('[data-cockpit-page="execution"]'); const detail = document.querySelector('[data-review-detail-id]'); return { selectedId: page?.dataset.selectedReviewId || '', detailId: detail?.dataset.reviewDetailId || '', detailText: detail?.textContent || '', pathSamples: Number(document.querySelector('[data-review-path-samples]')?.dataset.reviewPathSamples || 0), path: location.pathname }; })()`);
        assert.equal(after.selectedId, pageTwoId, `${width}x${height} selected identity follows the clicked page-two review`);
        assert.equal(after.detailId, pageTwoId, `${width}x${height} detail identity follows the clicked page-two review`);
        assert.notEqual(after.detailText, before.detailText, `${width}x${height} clicked review changes real detail content`);
        assert.equal(after.path, `/app/trade/reviews/${encodeURIComponent(pageTwoId)}`, `${width}x${height} onReviewSelect updates the canonical deep link`);
        assert.ok(after.pathSamples >= 2, `${width}x${height} selected review draws only its recorded path samples`);

        const filterTarget = await evaluate(cdp, `(() => {
          const selectedRow = document.querySelector('[data-review-id=${JSON.stringify(pageTwoId)}]')?.closest('tr');
          const selectedSymbol = selectedRow?.querySelector('td:nth-child(2) b')?.textContent?.trim() || '';
          const select = document.querySelector('[data-review-filter="symbol"]');
          const target = [...(select?.options || [])].map((option) => option.value).find((value) => value && value !== 'all' && value !== selectedSymbol) || '';
          if (select && target) { select.value = target; select.dispatchEvent(new Event('change', { bubbles: true })); }
          return { selectedSymbol, target };
        })()`);
        assert.ok(filterTarget.target && filterTarget.target !== filterTarget.selectedSymbol, `${width}x${height} fixture exposes an excluding review filter`);
        await waitForExpression(cdp, `document.querySelector('[data-cockpit-page="execution"]')?.dataset.selectedReviewId === '' && !document.querySelector('[data-review-detail-id]')`, `${width}x${height} review filter clears excluded detail`);
        const filteredFacts = await evaluate(cdp, `(() => ({
          selectedId: document.querySelector('[data-cockpit-page="execution"]')?.dataset.selectedReviewId || '',
          detailCount: document.querySelectorAll('[data-review-detail-id]').length,
          rowSymbols: [...document.querySelectorAll('[data-review-id]')].map((node) => node.closest('tr')?.querySelector('td:nth-child(2) b')?.textContent?.trim() || '')
        }))()`);
        assert.equal(filteredFacts.selectedId, "", `${width}x${height} excluded review identity fails closed`);
        assert.equal(filteredFacts.detailCount, 0, `${width}x${height} excluded review has no stale detail`);
        assert.ok(filteredFacts.rowSymbols.length > 0 && filteredFacts.rowSymbols.every((symbol) => symbol === filterTarget.target), `${width}x${height} review list and detail share the filtered visible set`);

        const reloadParams = new URLSearchParams({ view: "execution", reviewId: pageTwoId });
        await cdp.send("Page.navigate", { url: `${baseUrl}/tests/trading-cockpit-browser.html?${reloadParams}` });
        await waitForExpression(cdp, `document.querySelector('[data-review-detail-id]')?.dataset.reviewDetailId === ${JSON.stringify(pageTwoId)}`, `${width}x${height} review deep-link reload`);
        const restored = await evaluate(cdp, `({ selectedId: document.querySelector('[data-cockpit-page="execution"]')?.dataset.selectedReviewId || '', detailId: document.querySelector('[data-review-detail-id]')?.dataset.reviewDetailId || '', listPage: document.querySelector('[data-review-page]')?.dataset.reviewPage || '', path: location.pathname })`);
        assert.deepEqual(restored, { selectedId: pageTwoId, detailId: pageTwoId, listPage: "2", path: `/app/trade/reviews/${encodeURIComponent(pageTwoId)}` }, `${width}x${height} deep-link fixture restores the same canonical review and list page`);

        const invalidParams = new URLSearchParams({ view: "execution", reviewId: "review-does-not-exist" });
        await cdp.send("Page.navigate", { url: `${baseUrl}/tests/trading-cockpit-browser.html?${invalidParams}` });
        await waitForExpression(cdp, `document.querySelector('[data-cockpit-page="execution"]')`, `${width}x${height} unmatched review deep link`);
        const invalid = await evaluate(cdp, `({ selectedId: document.querySelector('[data-cockpit-page="execution"]')?.dataset.selectedReviewId || '', detailCount: document.querySelectorAll('[data-review-detail-id]').length })`);
        assert.deepEqual(invalid, { selectedId: "", detailCount: 0 }, `${width}x${height} unmatched review id fails closed`);

        await cdp.send("Page.navigate", { url: `${baseUrl}/tests/trading-cockpit-browser.html?${reloadParams}` });
        await waitForExpression(cdp, `document.querySelector('[data-review-detail-id]')?.dataset.reviewDetailId === ${JSON.stringify(pageTwoId)}`, `${width}x${height} review restoration after fail-closed check`);
        reviewInteractionFacts = { before, after, filterTarget, filteredFacts, restored, invalid };
      }
      let ledgerInteractionFacts = null;
      if (view === "ledger" && !emptyMode && !["adversarial", "malformed", "identity", "risk-counterexamples", "status-counterexamples", "collections-missing", "collections-malformed"].includes(ledgerCase) && (!resourceStateModes.has(stateMode) || ["loaded", "ready"].includes(stateMode))) {
        await evaluate(cdp, `document.querySelector('[data-order-select="ord-01"]')?.click()`);
        await waitForExpression(cdp, `document.querySelector('[data-order-detail-id="ord-01"]') && document.querySelector('[data-order-exit="close_position"]')`, `${width}x${height} ledger selects its exact actionable canonical order`);
        await waitForExpression(cdp, `document.querySelector('[data-execution-stage="protection"]')?.dataset.stageState === 'complete'`, `${width}x${height} ledger verifies persisted selected-order protection`);
        await evaluate(cdp, `document.querySelector('[data-order-exit="close_position"]')?.click()`);
        await waitForExpression(cdp, `document.querySelector('.cfmCard[role="dialog"]')`, `${width}x${height} ledger canonical exit confirmation`);
        const exitConfirmation = await evaluate(cdp, `({ text: document.querySelector('.cfmCard')?.textContent || '', beforeAction: window.__cockpitLastAction || null })`);
        assert.match(exitConfirmation.text, /ETH\/USDT/, `${width}x${height} ledger confirmation identifies the authoritative order`);
        assert.equal(exitConfirmation.beforeAction, null, `${width}x${height} ledger does not write before confirmation`);
        await evaluate(cdp, `document.querySelector('.cfmOk')?.click()`);
        await waitForExpression(cdp, `window.__cockpitLastAction?.path === '/api/execution-orders/ord-01/close'`, `${width}x${height} ledger exact canonical exit request`);
        const exitAction = await evaluate(cdp, `window.__cockpitLastAction`);
        assert.deepEqual(exitAction, { path: "/api/execution-orders/ord-01/close", payload: { reason: "manual_ui", intent: "close_position", expectedStatus: "protecting" } }, `${width}x${height} ledger sends the unchanged protected exit payload`);
        await evaluate(cdp, `document.querySelector('[data-order-page-next]')?.click()`);
        await waitForExpression(cdp, `document.querySelector('[data-order-page="2"]')`, `${width}x${height} ledger order page two`);
        const pageTwoOrderId = await evaluate(cdp, `document.querySelector('[data-order-page="2"] [data-order-select]')?.dataset.orderSelect || ''`);
        assert.ok(pageTwoOrderId, `${width}x${height} ledger order page two contains a canonical order`);
        await evaluate(cdp, `document.querySelector('[data-order-select=${JSON.stringify(pageTwoOrderId)}]')?.focus()`);
        await evaluate(cdp, `document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))`);
        await waitForExpression(cdp, `document.querySelector('[data-order-detail-id]')?.dataset.orderDetailId === ${JSON.stringify(pageTwoOrderId)}`, `${width}x${height} ledger keyboard order selection`);

        const selectedSymbol = await evaluate(cdp, `document.querySelector('[data-order-detail-id]')?.dataset.orderDetailSymbol || ''`);
        const symbolTarget = await evaluate(cdp, `(() => { const selected = document.querySelector('[data-order-detail-id]')?.dataset.orderDetailSymbol || ''; const select = document.querySelector('[data-order-filter="symbol"]'); const target = [...(select?.options || [])].map((option) => option.value).find((value) => value && value !== 'all' && value !== selected) || ''; if (select && target) { select.value = target; select.dispatchEvent(new Event('change', { bubbles: true })); } return target; })()`);
        assert.ok(symbolTarget && symbolTarget !== selectedSymbol, `${width}x${height} ledger fixture exposes an excluding order symbol`);
        await waitForExpression(cdp, `!document.querySelector('[data-cockpit-page="ledger"]')?.hasAttribute('data-selected-order-id') && !document.querySelector('[data-order-detail-id]')`, `${width}x${height} ledger filter clears excluded detail`);
        await evaluate(cdp, `(() => { const select = document.querySelector('[data-order-filter="symbol"]'); select.value = 'all'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await waitForExpression(cdp, `document.querySelector('[data-order-page="1"]')`, `${width}x${height} ledger order filter resets pagination`);
        await waitForExpression(cdp, `Boolean(document.querySelector('[data-order-detail-id]'))`, `${width}x${height} ledger order filter restores a valid default selection`);

        await evaluate(cdp, `(() => { const select = document.querySelector('[data-order-filter="status"]'); select.value = 'working'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await waitForExpression(cdp, `document.querySelectorAll('[data-order-id]').length > 0 && [...document.querySelectorAll('[data-order-id]')].every((node) => node.dataset.orderStatusFamily === 'working')`, `${width}x${height} ledger working-order filter`);
        await evaluate(cdp, `(() => { const select = document.querySelector('[data-order-filter="status"]'); select.value = 'canceled'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await waitForExpression(cdp, `document.querySelectorAll('[data-order-id]').length > 0 && [...document.querySelectorAll('[data-order-id]')].every((node) => node.dataset.orderStatusFamily === 'canceled')`, `${width}x${height} ledger canceled-order filter`);
        const canceledFamilies = await evaluate(cdp, `[...document.querySelectorAll('[data-order-id]')].map((node) => node.dataset.orderStatusFamily)`);
        await evaluate(cdp, `(() => { const select = document.querySelector('[data-order-filter="status"]'); select.value = 'blocked'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await waitForExpression(cdp, `document.querySelectorAll('[data-order-id]').length > 0 && [...document.querySelectorAll('[data-order-id]')].every((node) => node.dataset.orderStatusFamily === 'blocked')`, `${width}x${height} ledger rejected/risk-blocked filter`);
        const blockedFamilies = await evaluate(cdp, `[...document.querySelectorAll('[data-order-id]')].map((node) => node.dataset.orderStatusFamily)`);
        await evaluate(cdp, `(() => { const select = document.querySelector('[data-order-filter="status"]'); select.value = 'all'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);

        await evaluate(cdp, `document.querySelector('[data-fill-page-next]')?.click()`);
        await waitForExpression(cdp, `document.querySelector('[data-fill-page="2"]')`, `${width}x${height} ledger fill page two`);
        await evaluate(cdp, `(() => { const select = document.querySelector('[data-fill-filter="liquidity"]'); select.value = 'taker'; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await waitForExpression(cdp, `document.querySelector('[data-fill-page="1"]') && document.querySelectorAll('[data-fill-id]').length > 0 && [...document.querySelectorAll('[data-fill-id]')].every((node) => node.dataset.fillLiquidity === 'taker')`, `${width}x${height} ledger liquidity filter`);
        await evaluate(cdp, `(() => { const select = document.querySelector('[data-fill-filter="liquidity"]'); select.value = 'all'; select.dispatchEvent(new Event('change', { bubbles: true })); const intent = document.querySelector('[data-fill-filter="intent"]'); intent.value = 'reduce'; intent.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await waitForExpression(cdp, `document.querySelectorAll('[data-fill-id]').length > 0 && [...document.querySelectorAll('[data-fill-id]')].every((node) => node.dataset.fillIntent === 'reduce')`, `${width}x${height} ledger reduce-fill filter`);
        await evaluate(cdp, `(() => { const intent = document.querySelector('[data-fill-filter="intent"]'); intent.value = 'all'; intent.dispatchEvent(new Event('change', { bubbles: true })); const side = document.querySelector('[data-fill-filter="side"]'); side.value = 'sell'; side.dispatchEvent(new Event('change', { bubbles: true })); })()`);
        await waitForExpression(cdp, `document.querySelectorAll('[data-fill-id]').length > 0 && [...document.querySelectorAll('[data-fill-id]')].every((node) => /sell|short|空|卖/i.test(node.textContent || ''))`, `${width}x${height} ledger fill-side filter`);
        await evaluate(cdp, `(() => { const side = document.querySelector('[data-fill-filter="side"]'); side.value = 'all'; side.dispatchEvent(new Event('change', { bubbles: true })); const row = document.querySelector('[data-order-select]'); row?.click(); return row?.dataset.orderSelect || ''; })()`);
        await waitForExpression(cdp, `Boolean(document.querySelector('[data-order-detail-id]'))`, `${width}x${height} ledger detail restoration`);
        ledgerInteractionFacts = { pageTwoOrderId, selectedSymbol, symbolTarget, canceledFamilies, blockedFamilies, exitAction };
      }
      if (view === "ledger" && ledgerCase === "status-counterexamples") {
        const heroCounts = await evaluate(cdp, `[...document.querySelectorAll('[data-cockpit-region="execution-hero"] .cockpitMetric')].slice(0, 4).map((node) => Number(node.querySelector('b')?.textContent || NaN))`);
        const familyCounts = {};
        for (const family of ["working", "filled", "canceled", "blocked", "other"]) {
          await evaluate(cdp, `(() => { const select = document.querySelector('[data-order-filter="status"]'); select.value = ${JSON.stringify(family)}; select.dispatchEvent(new Event('change', { bubbles: true })); })()`);
          await waitForExpression(cdp, `document.querySelectorAll('[data-order-id]').length > 0 && [...document.querySelectorAll('[data-order-id]')].every((node) => node.dataset.orderStatusFamily === ${JSON.stringify(family)})`, `${width}x${height} ledger ${family} counterexample filter`);
          familyCounts[family] = await evaluate(cdp, `document.querySelectorAll('[data-order-id]').length`);
        }
        assert.deepEqual(familyCounts, { working: 2, filled: 2, canceled: 2, blocked: 2, other: 3 }, `${width}x${height} exact status families reject substring counterexamples`);
        assert.deepEqual(heroCounts, [11, familyCounts.working, familyCounts.filled, familyCounts.blocked], `${width}x${height} Hero and mounted family filters use one status classifier`);
        assert.equal(heroCounts[0], Object.values(familyCounts).reduce((sum, value) => sum + value, 0), `${width}x${height} all five filter families reconcile to Hero total`);
        ledgerInteractionFacts = { heroCounts, familyCounts };
      }
      if (view === "ledger" && ledgerCase === "identity") {
        const identityRows = await evaluate(cdp, `[...document.querySelectorAll('[data-order-select]')].map((node) => node.dataset.orderSelect)`);
        assert.deepEqual(identityRows, ["execution-alias-77", "execution-alias-blank"], `${width}x${height} mounted ledger drops duplicate identity rows but retains non-actionable aliases`);
        await evaluate(cdp, `(() => { document.querySelector('[data-order-exit]')?.click(); document.querySelector('[data-order-select="execution-alias-blank"]')?.click(); })()`);
        await waitForExpression(cdp, `document.querySelector('[data-order-select="execution-alias-blank"]')?.getAttribute('aria-pressed') === 'true' && !document.querySelector('[data-order-detail-id]') && !document.querySelector('[data-cockpit-page="ledger"]')?.hasAttribute('data-selected-order-id')`, `${width}x${height} mounted blank-canonical alias stays a local noncanonical row only`);
        await evaluate(cdp, `document.querySelector('[data-order-exit]')?.click()`);
        ledgerInteractionFacts = await evaluate(cdp, `({ selectedRow: document.querySelector('[data-order-select][aria-pressed="true"]')?.dataset.orderSelect || '', detailCount: document.querySelectorAll('[data-order-detail-id]').length, exitCount: document.querySelectorAll('[data-order-exit]').length, lastAction: window.__cockpitLastAction || null })`);
        assert.deepEqual(ledgerInteractionFacts, { selectedRow: "execution-alias-blank", detailCount: 0, exitCount: 0, lastAction: null }, `${width}x${height} real alias row clicks remain local, fail-closed, and never reach the API`);
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
        const allocationRegion = page?.querySelector('[data-cockpit-region="position-allocation"]');
        const longShortRegion = page?.querySelector('[data-cockpit-region="long-short"]');
        const concentrationRegion = page?.querySelector('[data-cockpit-region="concentration"]');
        return {
          state: page?.dataset.resourceState || null,
          statePanel: page?.querySelector('[data-position-resource-state]')?.dataset.positionResourceState || null,
          regions: [...(page?.querySelectorAll('[data-cockpit-region]') || [])].map((node) => node.dataset.cockpitRegion),
          rowCount: page?.querySelectorAll('[data-position-id]').length || 0,
          positionOnlyText: positionRow?.textContent || '',
          positionOnlyExecution: positionRow?.dataset.executionId || null,
          wrongProtectionVisible: /13\.37|14\.88/.test(tableRegion?.textContent || ''),
          exitCount: page?.querySelectorAll('[data-position-exit]').length || 0,
          allocationText: allocationRegion?.textContent || '',
          longShortText: longShortRegion?.textContent || '',
          concentrationText: concentrationRegion?.textContent || '',
          lastAction: window.__cockpitLastAction || null,
          tableHeight: tableRegion?.getBoundingClientRect().height || 0,
          trendWidthRatio: trendRegion && trend ? trend.getBoundingClientRect().width / trendRegion.getBoundingClientRect().width : null,
          columnPct: totalWidth ? columns.map((value) => value / totalWidth * 100) : [],
          minTargetPx: targetFacts.length ? Math.min(...targetFacts.map((row) => row.size)) : null,
          smallestTarget: targetFacts.sort((a, b) => a.size - b.size)[0] || null
        };
      })()`) : null;
      const reviewStateFacts = view === "execution" ? await evaluate(cdp, `(() => {
        const page = document.querySelector('[data-cockpit-page="execution"]');
        const workspace = page?.querySelector('.reviewWorkbench');
        const columns = workspace ? [...workspace.children].slice(0, 2).map((node) => node.getBoundingClientRect().width) : [];
        const totalWidth = columns.reduce((sum, value) => sum + value, 0);
        const targets = page ? [...page.querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])')].filter((node) => !node.disabled && getComputedStyle(node).display !== 'none') : [];
        const targetFacts = targets.map((node) => { const rect = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label') || node.textContent?.trim() || node.className, size: Math.min(rect.width, rect.height) }; }).filter((row) => Number.isFinite(row.size));
        const focused = page?.querySelector('[data-review-id]'); focused?.focus(); const focusStyle = focused ? getComputedStyle(focused) : null;
        return {
          state: page?.dataset.resourceState || null,
          statePanel: page?.querySelector('[data-review-resource-state]')?.dataset.reviewResourceState || null,
          regions: [...(page?.querySelectorAll('[data-cockpit-region]') || [])].map((node) => node.dataset.cockpitRegion),
          rowCount: page?.querySelectorAll('[data-review-id]').length || 0,
          detailId: page?.querySelector('[data-review-detail-id]')?.dataset.reviewDetailId || '',
          columnPct: totalWidth ? columns.map((value) => value / totalWidth * 100) : [],
          minTargetPx: targetFacts.length ? Math.min(...targetFacts.map((row) => row.size)) : null,
          focusActive: document.activeElement === focused,
          focusOutline: focusStyle ? focusStyle.outlineStyle + ' ' + focusStyle.outlineWidth : null
        };
      })()`) : null;
      if (view === "ledger" && await evaluate(cdp, `Boolean(document.querySelector('[data-order-select]'))`)) {
        await evaluate(cdp, `(() => { document.activeElement?.blur(); const row = document.querySelector('[data-order-select]'); row.focus(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true })); })()`);
        await waitForExpression(cdp, `document.querySelector('[data-order-select]')?.classList.contains('focusVisible')`, `${width}x${height} ledger focus indicator`);
      }
      const ledgerStateFacts = view === "ledger" ? await evaluate(cdp, `(() => {
        const page = document.querySelector('[data-cockpit-page="ledger"]');
        const workspace = page?.querySelector('.ledgerWorkbenchV2');
        const columns = workspace ? [...workspace.children].slice(0, 2).map((node) => node.getBoundingClientRect().width) : [];
        const totalWidth = columns.reduce((sum, value) => sum + value, 0);
        const targets = page ? [...page.querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])')].filter((node) => !node.disabled && getComputedStyle(node).display !== 'none') : [];
        const targetFacts = targets.map((node) => { const rect = node.getBoundingClientRect(); return { label: node.getAttribute('aria-label') || node.textContent?.trim() || node.className, size: Math.min(rect.width, rect.height) }; }).filter((row) => Number.isFinite(row.size));
        const focused = page?.querySelector('[data-order-select]'); const focusStyle = focused ? getComputedStyle(focused) : null;
        return {
          state: page?.dataset.resourceState || null,
          statePanel: page?.querySelector('[data-ledger-resource-state]')?.dataset.ledgerResourceState || null,
          regions: [...(page?.querySelectorAll('[data-cockpit-region]') || [])].map((node) => node.dataset.cockpitRegion),
          orderRowCount: page?.querySelectorAll('[data-order-id]').length || 0,
          fillRowCount: page?.querySelectorAll('[data-fill-id]').length || 0,
          selectedId: page?.dataset.selectedOrderId || '',
          detailId: page?.querySelector('[data-order-detail-id]')?.dataset.orderDetailId || '',
          stageStates: Object.fromEntries([...(page?.querySelectorAll('[data-execution-stage]') || [])].map((node) => [node.dataset.executionStage, node.dataset.stageState])),
          exitCount: page?.querySelectorAll('[data-order-exit]').length || 0,
          hasSelectedIdentity: Boolean(page?.hasAttribute('data-selected-order-id')),
          lastAction: window.__cockpitLastAction || null,
          heroMetrics: [...(page?.querySelectorAll('[data-cockpit-region="execution-hero"] .cockpitMetric') || [])].map((node) => node.getAttribute('aria-label') || ''),
          siblingTextVisible: /sibling-only-signal|sibling-only-risk|ledger-sibling-fill/.test([
            page?.querySelector('[data-cockpit-region="order-detail"]')?.textContent,
            page?.querySelector('[data-cockpit-region="execution-timeline"]')?.textContent
          ].filter(Boolean).join(' ')),
          columnPct: totalWidth ? columns.map((value) => value / totalWidth * 100) : [],
          columnTops: workspace ? [...workspace.children].slice(0, 2).map((node) => node.getBoundingClientRect().top) : [],
          minTargetPx: targetFacts.length ? Math.min(...targetFacts.map((row) => row.size)) : null,
          smallestTarget: targetFacts.sort((a, b) => a.size - b.size)[0] || null,
          focusActive: document.activeElement === focused,
          focusOutline: focusStyle ? focusStyle.outlineStyle + ' ' + focusStyle.outlineWidth : null,
          focusShadow: focusStyle?.boxShadow || null,
          workbenchHeight: workspace?.getBoundingClientRect().height || 0,
          fillLedgerHeight: page?.querySelector('[data-cockpit-region="fill-ledger"]')?.getBoundingClientRect().height || 0,
          fillLedgerBottom: page?.querySelector('[data-cockpit-region="fill-ledger"]')?.getBoundingClientRect().bottom || 0,
          fillPaginationBottom: page?.querySelector('[data-cockpit-region="fill-ledger"] .ledgerPagination')?.getBoundingClientRect().bottom || 0,
          retryHeight: page?.querySelector('.ledgerResourceState button')?.getBoundingClientRect().height || 0,
          minOperationalTextPx: (() => { const sizes = [...(page?.querySelectorAll('.ledgerNotices small, .ledgerNotices b, .ledgerFilters, .ledgerOrderTable th, .ledgerOrderTable td, .ledgerFillTable th, .ledgerFillTable td, .ledgerPagination, .ledgerOrderFacts dt, .ledgerOrderFacts dd, .ledgerTimeline b, .ledgerTimeline small') || [])].filter((node) => getComputedStyle(node).display !== 'none').map((node) => Number.parseFloat(getComputedStyle(node).fontSize)).filter(Number.isFinite); return sizes.length ? Math.min(...sizes) : null; })(),
          longTextContained: [...(page?.querySelectorAll('[data-cockpit-region="execution-notices"] article') || [])].every((node) => node.scrollWidth <= node.clientWidth + 1)
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
          assert.equal(positionStateFacts.rowCount, 3, `${width}x${height} malformed action fixture retains only its three identity-bearing position facts`);
          assert.equal(positionStateFacts.exitCount, 0, `${width}x${height} malformed positions cannot authorize an exit`);
          assert.equal(positionStateFacts.wrongProtectionVisible, false, `${width}x${height} malformed positions does not render unrelated protection`);
          assert.equal(positionStateFacts.lastAction, null, `${width}x${height} malformed and ambiguous executions issue no request`);
        } else if (positionCase === "partial") {
          assert.equal(positionStateFacts.rowCount, 2, `${width}x${height} partial positions retains both real rows`);
          assert.equal(positionStateFacts.exitCount, 0, `${width}x${height} partial positions exposes no unrelated action`);
          assert.match(positionStateFacts.allocationText, /持仓分布不完整/, `${width}x${height} partial allocation is explicitly incomplete`);
          assert.match(positionStateFacts.longShortText, /多空分布不完整/, `${width}x${height} partial long-short composition is explicitly incomplete`);
          assert.doesNotMatch(positionStateFacts.longShortText, /100\.0%/, `${width}x${height} partial long-short does not turn known remainder into 100%`);
          assert.match(positionStateFacts.concentrationText, /集中度数据不完整/, `${width}x${height} partial concentration is explicitly incomplete`);
          assert.doesNotMatch(positionStateFacts.concentrationText, /空仓，无集中度风险/, `${width}x${height} partial concentration is not mislabeled flat`);
          assert.equal(positionStateFacts.lastAction, null, `${width}x${height} partial fixture issues no request`);
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
      if (view === "execution") {
        const requiredRegions = ["review-hero", "ai-review-conclusion", "review-filters", "trade-list", "trade-detail", "trade-path", "hold-pnl-distribution", "behavior-insights", "next-actions"];
        if (resourceStateModes.has(stateMode) && !["loaded", "ready"].includes(stateMode)) {
          assert.equal(reviewStateFacts.state, expectedResourceState, `${width}x${height} review normalizes ${stateMode} to ${expectedResourceState}`);
          assert.equal(reviewStateFacts.statePanel, expectedResourceState, `${width}x${height} review renders its ${stateMode} state boundary`);
          assert.equal(reviewStateFacts.regions.includes("review-hero"), retainedBodyModes.has(stateMode), `${width}x${height} ${stateMode} review ${retainedBodyModes.has(stateMode) ? "retains" : "blocks"} last-valid facts`);
        } else if (emptyMode) {
          assert.equal(reviewStateFacts.rowCount, 0, `${width}x${height} empty review renders no fabricated row`);
          assert.equal(reviewStateFacts.detailId, "", `${width}x${height} empty review renders no fabricated detail`);
        } else if (reviewCase === "malformed") {
          assert.equal(reviewStateFacts.rowCount, 1, `${width}x${height} malformed review fixture retains only its canonical review`);
          assert.equal(reviewStateFacts.detailId, "review-safe", `${width}x${height} malformed review selects only the canonical review`);
        } else {
          for (const region of requiredRegions) assert.ok(reviewStateFacts.regions.includes(region), `${width}x${height} review renders ${region}`);
          assert.ok(reviewInteractionFacts, `${width}x${height} review completes page-two/deep-link interaction`);
          assert.ok(reviewStateFacts.minTargetPx >= 36, `${width}x${height} review control target ${reviewStateFacts.minTargetPx}px is at least 36px`);
          assert.equal(reviewStateFacts.focusActive, true, `${width}x${height} review row receives keyboard focus`);
          assert.notEqual(reviewStateFacts.focusOutline, "none 0px", `${width}x${height} review rows have a visible focus ring: ${JSON.stringify(reviewStateFacts)}`);
          if (width === 1440) {
            const expected = [36, 64];
            reviewStateFacts.columnPct.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 8, `1440 review column ${index + 1} is ${value.toFixed(2)}%, near ${expected[index]}%`));
          }
        }
      }
      if (view === "ledger") {
        const requiredRegions = ["execution-hero", "execution-notices", "order-filters", "order-list", "order-detail", "execution-timeline", "fill-filters", "fill-ledger"];
        if (resourceStateModes.has(stateMode) && !["loaded", "ready"].includes(stateMode)) {
          assert.equal(ledgerStateFacts.state, expectedResourceState, `${width}x${height} ledger normalizes ${stateMode} to ${expectedResourceState}`);
          assert.equal(ledgerStateFacts.statePanel, expectedResourceState, `${width}x${height} ledger renders its ${stateMode} state boundary`);
          assert.equal(ledgerStateFacts.exitCount, 0, `${width}x${height} ${stateMode} ledger exposes no execution action`);
          assert.equal(ledgerStateFacts.regions.includes("execution-hero"), retainedBodyModes.has(stateMode), `${width}x${height} ${stateMode} ledger ${retainedBodyModes.has(stateMode) ? "retains" : "blocks"} last-valid facts`);
          if (["error", "failed", "forbidden", "disabled"].includes(expectedResourceState)) assert.equal(ledgerStateFacts.hasSelectedIdentity, false, `${width}x${height} ${stateMode} ledger hides terminal selected identity`);
          if (["error", "failed", "stale", "degraded"].includes(expectedResourceState)) assert.ok(ledgerStateFacts.retryHeight >= 36, `${width}x${height} ${stateMode} ledger retry target is at least 36px`);
        } else if (emptyMode) {
          assert.equal(ledgerStateFacts.orderRowCount, 0, `${width}x${height} empty ledger renders no fabricated order`);
          assert.equal(ledgerStateFacts.fillRowCount, 0, `${width}x${height} empty ledger renders no fabricated fill`);
          assert.equal(ledgerStateFacts.detailId, "", `${width}x${height} empty ledger renders no fabricated detail`);
          assert.equal(ledgerStateFacts.exitCount, 0, `${width}x${height} empty ledger renders no exit action`);
          assert.ok(ledgerStateFacts.workbenchHeight > 0 && ledgerStateFacts.workbenchHeight < 370, `${width}x${height} empty ledger uses a compact workbench (${ledgerStateFacts.workbenchHeight}px)`);
          assert.deepEqual(ledgerStateFacts.heroMetrics, ["全部委托: 0", "进行中: 0", "已成交: 0", "拒绝 / 风控阻断: 0", "成交成功率: 不可用", "手续费: 0.00 U"], `${width}x${height} explicit loaded empty collections render truthful zero facts`);
        } else if (ledgerCase === "malformed") {
          assert.equal(ledgerStateFacts.orderRowCount, 1, `${width}x${height} malformed ledger retains only one canonical unique order`);
          assert.equal(ledgerStateFacts.fillRowCount, 1, `${width}x${height} malformed ledger retains only one canonical unique fill`);
          assert.equal(ledgerStateFacts.selectedId, "ledger-valid", `${width}x${height} malformed ledger selects only the unique canonical order`);
          assert.equal(ledgerStateFacts.detailId, "ledger-valid", `${width}x${height} malformed ledger detail follows the unique canonical order`);
          assert.equal(ledgerStateFacts.exitCount, 0, `${width}x${height} malformed ledger exposes no execution action`);
        } else if (ledgerCase === "adversarial") {
          assert.equal(ledgerStateFacts.selectedId, "ledger-selected", `${width}x${height} adversarial ledger selects the newest exact order`);
          assert.equal(ledgerStateFacts.detailId, "ledger-selected", `${width}x${height} adversarial detail stays on the exact selected order`);
          for (const stage of ["signal", "risk", "routing", "fill", "protection"]) assert.equal(ledgerStateFacts.stageStates[stage], "incomplete", `${width}x${height} selected ${stage} stage cannot borrow sibling evidence`);
          assert.equal(ledgerStateFacts.siblingTextVisible, false, `${width}x${height} selected detail/timeline hides sibling-only facts`);
        } else if (ledgerCase === "identity") {
          assert.equal(ledgerStateFacts.exitCount, 0, `${width}x${height} alias-only, blank-canonical, and duplicate executions expose no exit`);
          assert.equal(ledgerStateFacts.lastAction, null, `${width}x${height} invalid canonical execution never reaches the API action`);
          assert.equal(ledgerStateFacts.stageStates.order, "incomplete", `${width}x${height} alias-only selection cannot complete the order stage`);
          assert.equal(ledgerStateFacts.stageStates.fill, "incomplete", `${width}x${height} alias-linked fill cannot complete without a canonical order id`);
        } else if (ledgerCase === "risk-counterexamples") {
          assert.equal(ledgerStateFacts.stageStates.risk, "incomplete", `${width}x${height} explicit negative risk cannot borrow a plan pass`);
          assert.equal(ledgerStateFacts.stageStates.protection, "incomplete", `${width}x${height} inactive protection cannot complete from identifiers`);
          assert.equal(ledgerStateFacts.siblingTextVisible, false, `${width}x${height} risk/protection counterexample hides weaker evidence`);
        } else if (["collections-missing", "collections-malformed"].includes(ledgerCase)) {
          assert.equal(ledgerStateFacts.heroMetrics.length, 6, `${width}x${height} unavailable collections retain all six hero metric slots`);
          assert.ok(ledgerStateFacts.heroMetrics.every((label) => /不可用|Unavailable/.test(label)), `${width}x${height} unavailable collections never render zero hero facts: ${JSON.stringify(ledgerStateFacts.heroMetrics)}`);
          assert.equal(ledgerStateFacts.orderRowCount, 0, `${width}x${height} unavailable orders fabricate no rows`);
          assert.equal(ledgerStateFacts.fillRowCount, 0, `${width}x${height} unavailable fills fabricate no rows`);
        } else {
          for (const region of requiredRegions) assert.ok(ledgerStateFacts.regions.includes(region), `${width}x${height} ledger renders ${region}`);
          assert.ok(ledgerInteractionFacts, `${width}x${height} ledger completes filter, pagination, and keyboard selection interactions`);
          assert.ok(ledgerStateFacts.minTargetPx >= 36, `${width}x${height} ledger control target ${ledgerStateFacts.minTargetPx}px is at least 36px: ${JSON.stringify(ledgerStateFacts.smallestTarget)}`);
          assert.equal(ledgerStateFacts.focusActive, true, `${width}x${height} ledger order receives keyboard focus`);
          assert.notEqual(ledgerStateFacts.focusShadow, "none", `${width}x${height} ledger rows have a visible focus ring: ${JSON.stringify(ledgerStateFacts)}`);
          assert.ok(ledgerStateFacts.minOperationalTextPx >= 11, `${width}x${height} ledger operational text ${ledgerStateFacts.minOperationalTextPx}px is at least 11px`);
          if (ledgerCase === "long") assert.equal(ledgerStateFacts.longTextContained, true, `${width}x${height} ledger long notice content stays contained`);
          if ([1440, 1280].includes(width)) {
            const expected = [53, 47];
            ledgerStateFacts.columnPct.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= 8, `${width} ledger column ${index + 1} is ${value.toFixed(2)}%, near ${expected[index]}%`));
          }
          if (width === 1440) {
            assert.ok(ledgerStateFacts.fillLedgerBottom <= 1080 && ledgerStateFacts.fillPaginationBottom <= 1080, `1440 ledger complete fill panel and pagination fit primary frame: ${JSON.stringify(ledgerStateFacts)}`);
          }
          if (width === 1024) assert.ok(ledgerStateFacts.columnTops[1] > ledgerStateFacts.columnTops[0], `1024 ledger purposefully stacks order detail below the list: ${JSON.stringify(ledgerStateFacts.columnTops)}`);
        }
        if (emptyMode || ["identity", "collections-missing", "collections-malformed"].includes(ledgerCase)) {
          for (const region of requiredRegions) assert.ok(ledgerStateFacts.regions.includes(region), `${width}x${height} no-selection ledger retains ${region}`);
          assert.deepEqual(Object.keys(ledgerStateFacts.stageStates), ["signal", "risk", "routing", "order", "fill", "protection"], `${width}x${height} no-selection ledger retains all six stages`);
          assert.ok(Object.values(ledgerStateFacts.stageStates).every((value) => value === "incomplete"), `${width}x${height} no-selection ledger keeps every stage incomplete`);
          assert.equal(ledgerStateFacts.exitCount, 0, `${width}x${height} no-selection ledger exposes no action`);
          assert.equal(ledgerStateFacts.lastAction, null, `${width}x${height} no-selection ledger reaches no API action`);
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
      results.push({ width, height, view, charts: facts.regionCharts, klineRequests: facts.klineRequests, overflow: facts.overflow, resourceState: facts.resourceState, chartStatus: facts.chartStatus, volumeSeries: facts.volumeSeries, chartRemovals: facts.chartRemovals, chartRuntimeErrors: facts.chartRuntimeErrors, chartUnhandledRejections: facts.chartUnhandledRejections, minKeyboardTargetPx: facts.minKeyboardTargetPx, minMarketTargetPx: facts.minMarketTargetPx, minOverviewTextPx: facts.minOverviewTextPx, maxOverviewTextPx: facts.maxOverviewTextPx, mainRailRatio: facts.mainRailRatio, marketChartWorkspaceRatio: facts.marketChartWorkspaceRatio, marketCanonicalSymbol: facts.marketCanonicalSymbol, marketRegions: marketStateFacts?.regions, positionStateFacts, positionActionFacts, reviewStateFacts, reviewInteractionFacts, ledgerStateFacts, ledgerInteractionFacts, lastRegionTop: facts.lastRegionTop, overviewRegions: facts.overviewRegions });
    }
  }
  console.log(`trading cockpit browser PASS ${JSON.stringify({ historyFacts, results })}`);
} finally {
  cdp?.close();
  await stop(chrome);
  await stop(vite);
  await rm(profile, { recursive: true, force: true });
  console.log("trading cockpit browser cleanup PASS chrome/vite stopped and profile removed");
}
