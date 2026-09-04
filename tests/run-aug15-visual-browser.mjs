import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const baseUrl = new URL(process.env.KORDYN_AUG15_BASE_URL || "http://127.0.0.1:56802/app/ai/dialog");
const outputDir = path.resolve(process.env.KORDYN_AUG15_OUTPUT_DIR || "/tmp/kordyn-aug15-restore");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

assert.ok(["127.0.0.1", "localhost"].includes(baseUrl.hostname), "visual gate only targets localhost");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
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
  const ready = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.on("message", (payload) => {
    const message = JSON.parse(payload.toString());
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = ++requestId;
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { socket.close(); }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitForExpression(cdp, expression, label) {
  const deadline = Date.now() + 20_000;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) {
      const state = await evaluate(cdp, "({href:location.href,text:document.body?.innerText?.slice(0,800)})");
      throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
    }
    await delay(60);
  }
}

async function click(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node)return false; node.click(); return true; })()`);
  assert.equal(clicked, true, `click target exists: ${selector}`);
}

async function clickText(cdp, selector, text) {
  const clicked = await evaluate(cdp, `(() => {
    const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.trim()===${JSON.stringify(text)}||item.textContent.includes(${JSON.stringify(text)}));
    if(!node)return false; node.click(); return true;
  })()`);
  assert.equal(clicked, true, `click target exists: ${selector} / ${text}`);
}

async function replaceSearch(cdp, query) {
  const selector = ".appTopbar .commandRail__search input";
  await evaluate(cdp, `(() => { const input=document.querySelector(${JSON.stringify(selector)}); input.focus(); input.value=""; input.dispatchEvent(new Event("input",{bubbles:true})); return true; })()`);
  await cdp.send("Input.insertText", { text: query });
  await waitForExpression(cdp, `document.querySelectorAll('.aug15SearchResults [data-shell-result-state="available"]').length > 0`, `search results for ${query}`);
}

async function clickSearchResult(cdp, routeId) {
  const clicked = await evaluate(cdp, `(() => {
    const node=[...document.querySelectorAll('.aug15SearchResults [data-shell-result-state="available"]')].find((item)=>item.textContent.includes(${JSON.stringify(routeId)}));
    if(!node)return false; node.click(); return true;
  })()`);
  assert.equal(clicked, true, `available search result exists for ${routeId}`);
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
}

await mkdir(outputDir, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), "kordyn-aug15-visual-"));
const port = await freePort();
let chrome;
let cdp;
try {
  chrome = spawn(chromeBinary, [
    "--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu",
    "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"
  ], { stdio: "ignore" });
  const targets = await waitFor(`http://127.0.0.1:${port}/json`, (rows) => rows.some((row) => row.type === "page"));
  const page = targets.find((row) => row.type === "page");
  cdp = connectCdp(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const realFetch = window.fetch.bind(window);
    const reviewFixture = [
      { id: "browser-review-a", type: "trade", symbol: "BTC/USDT", status: "completed", summary: "Browser review A", completedAt: "2026-09-01T00:00:00Z", netRealizedPnl: 1 },
      { id: "browser-review-b", type: "trade", symbol: "ETH/USDT", status: "completed", summary: "Browser review B", completedAt: "2026-09-02T00:00:00Z", netRealizedPnl: -2 }
    ];
    window.fetch = async (...args) => {
      const response = await realFetch(...args);
      const input = args[0];
      const url = new URL(typeof input === "string" ? input : input?.url || "", location.origin);
      if (url.pathname === "/api/overview" && url.searchParams.get("view") === "section" && url.searchParams.get("section") === "cockpit" && response.ok) {
        const payload = await response.clone().json();
        return new Response(JSON.stringify({ ...payload, reviews: reviewFixture }), { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      return response;
    };
  })();` });

  const results = [];
  for (const viewport of [
    { name: "desktop-1440", width: 1440, height: 900, mobile: false },
    { name: "desktop-1180", width: 1180, height: 800, mobile: false },
    { name: "app-430", width: 430, height: 932, mobile: true },
    { name: "app-390", width: 390, height: 844, mobile: true }
  ]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width, height: viewport.height, screenWidth: viewport.width, screenHeight: viewport.height,
      deviceScaleFactor: 1, mobile: viewport.mobile
    });
    await cdp.send("Page.navigate", { url: baseUrl.href });
    const selector = viewport.mobile ? ".mShell2" : ".appShell";
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})`, viewport.name);
    await delay(900);
    const facts = await evaluate(cdp, `(() => ({
      width: innerWidth,
      path: location.pathname,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      shell: document.querySelector(${JSON.stringify(selector)})?.className || "",
      nav: [...document.querySelectorAll(${JSON.stringify(viewport.mobile ? ".mNativeTabbar button" : ".navItem")})].map((node) => node.innerText.trim()),
      tabs: [...document.querySelectorAll(${JSON.stringify(viewport.mobile ? ".mSegment button" : ".uxTabs button")})].slice(0,8).map((node) => node.innerText.trim()),
      hardPatrol: Boolean(document.querySelector(".patrolReceipt,.kTruthBand,.kEvidenceLedger")),
      bodyBackground: getComputedStyle(document.body).backgroundColor
    }))()`);
    assert.equal(facts.overflow, 0, `${viewport.name} has no horizontal overflow`);
    assert.equal(facts.path, "/app/ai/dialog", `${viewport.name} starts from the canonical AI route`);
    if (!viewport.mobile) assert.deepEqual(facts.nav.slice(0, 5), ["AI 交易员", "交易驾驶舱", "研究中心", "风控中心", "系统运营"]);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
    await writeFile(path.join(outputDir, `${viewport.name}.png`), Buffer.from(shot.data, "base64"));
    if (viewport.name === "desktop-1440") {
      for (const [target, expectedPath, expectedView] of [
        ["cockpit", "/app/trade/overview", "cockpit"],
        ["researchCenter", "/app/research/overview", "researchCenter"],
        ["riskCenter", "/app/risk/overview", "riskCenter"]
      ]) {
        await click(cdp, `[data-classic-target="${target}"]`);
        await waitForExpression(cdp, `location.pathname === ${JSON.stringify(expectedPath)} && document.querySelector('[data-classic-shell="desktop"]')?.dataset.classicView === ${JSON.stringify(expectedView)}`, `${target} canonical URL`);
      }
      await waitForExpression(cdp, `[...document.querySelectorAll('.uxTabs button')].some((node)=>node.textContent.includes('资金与交易边界'))`, "risk workspace tabs");
      await clickText(cdp, ".uxTabs button", "资金与交易边界");
      await waitForExpression(cdp, `location.pathname === "/app/risk/boundaries" && document.querySelector('.tcEffective')`, "risk boundary canonical URL");
      const boundarySummary = await evaluate(cdp, `(() => { const style=getComputedStyle(document.querySelector('.tcEffective')); return {background:style.backgroundColor,color:style.color}; })()`);
      assert.deepEqual(boundarySummary, { background: "rgb(255, 255, 255)", color: "rgb(30, 27, 22)" }, "desktop summary uses the shared light surface");
      await click(cdp, '[data-classic-target="operationsCenter"]');
      await waitForExpression(cdp, `location.pathname === "/app/operations/overview"`, "operations canonical URL");
      await evaluate(cdp, "history.back()");
      await waitForExpression(cdp, `location.pathname === "/app/risk/boundaries" && document.querySelector('[data-classic-shell="desktop"]')?.dataset.classicView === "riskCenter"`, "browser Back restores the prior workspace and tab");
      await click(cdp, '[data-classic-target="chat"]');
      await clickText(cdp, ".uxTabs button", "盯盘");
      await waitForExpression(cdp, `location.pathname === "/app/ai/watch" && document.querySelector('.wmHero')`, "watch canonical URL");
      assert.equal(await evaluate(cdp, `getComputedStyle(document.querySelector('.wmHero')).backgroundColor`), "rgb(255, 255, 255)", "watch summary uses the shared light surface");
      await replaceSearch(cdp, "自主巡检");
      const searchShot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
      await writeFile(path.join(outputDir, "desktop-search.png"), Buffer.from(searchShot.data, "base64"));
      await clickSearchResult(cdp, "patrol");
      await waitForExpression(cdp, `location.pathname === "/app/ai/patrol" && document.querySelector('[data-classic-shell="desktop"]')?.dataset.classicCapability?.includes("patrol") && document.querySelector('[data-ai-surface="patrol"]')`, "patrol mapped into August 15 AI workspace");
      await replaceSearch(cdp, "eventRisk");
      await clickSearchResult(cdp, "eventRisk");
      await waitForExpression(cdp, `location.pathname === "/app/risk/events" && document.querySelector('[data-classic-shell="desktop"]')?.dataset.classicView === "riskCenter" && document.querySelector('[data-aug15-risk-view="events"]')`, "event risk mapped into its exact August 15 risk view");
      await replaceSearch(cdp, "ownerReviewWorkspace");
      await clickSearchResult(cdp, "ownerReviewWorkspace");
      await waitForExpression(cdp, `location.pathname === "/app/trade/execution-review" && document.querySelector('[data-classic-shell="desktop"]')?.dataset.classicView === "cockpit" && [...document.querySelectorAll('.uxTabs button')].some((node)=>node.classList.contains('active')&&node.textContent.includes('执行与复盘'))`, "owner review truthfully resolves to the unified August 15 execution-review workspace");
      assert.ok(await evaluate(cdp, `document.querySelectorAll('.erReviewIndex button').length >= 2`), "controlled production-shaped fixture exposes two reviews in the real desktop shell");
      await evaluate(cdp, `document.querySelectorAll('.erReviewIndex button')[0].click()`);
      await waitForExpression(cdp, `location.pathname.startsWith("/app/trade/reviews/") && document.querySelector('.erReviewIndex button.active')`, "desktop review selection writes an object deep link");
      const firstReview = await evaluate(cdp, `({path:location.pathname,text:document.querySelector('.erReviewIndex button.active')?.innerText})`);
      await evaluate(cdp, `document.querySelectorAll('.erReviewIndex button')[1].click()`);
      await waitForExpression(cdp, `location.pathname.startsWith("/app/trade/reviews/") && location.pathname !== ${JSON.stringify(firstReview.path)}`, "desktop second review writes a distinct object deep link");
      const secondReview = await evaluate(cdp, `({path:location.pathname,text:document.querySelector('.erReviewIndex button.active')?.innerText})`);
      assert.notEqual(secondReview.path, firstReview.path, "each review owns a distinct URL");
      assert.notEqual(secondReview.text, firstReview.text, "each review selects distinct content");
      await evaluate(cdp, "history.back()");
      await waitForExpression(cdp, `location.pathname === ${JSON.stringify(firstReview.path)}`, "desktop browser Back restores the prior review URL");
      assert.equal(await evaluate(cdp, `document.querySelector('.erReviewIndex button.active')?.innerText`), firstReview.text, "desktop browser Back restores the prior selected review");
      await cdp.send("Page.reload", { ignoreCache: true });
      await waitForExpression(cdp, `document.querySelector('.appShell') && location.pathname === ${JSON.stringify(firstReview.path)}`, "desktop review deep link reload");
      assert.equal(await evaluate(cdp, `document.querySelector('.erReviewIndex button.active')?.innerText`), firstReview.text, "desktop review deep link restores the selected review after reload");
      await replaceSearch(cdp, "systemSettings:event-sources");
      await clickSearchResult(cdp, "systemSettings:event-sources");
      await waitForExpression(cdp, `location.pathname === "/app/settings/event-sources" && document.querySelector('[data-classic-shell="desktop"]')?.dataset.classicView === "systemSettings" && document.querySelector('[data-aug15-settings-view="event_sources"]')`, "event-source configuration mapped into its exact August 15 settings view");
    }
    if (viewport.name === "app-390") {
      await click(cdp, ".mNativeTabbar button:last-child");
      await waitForExpression(cdp, `document.querySelector('.classicNavDrawer')`, "August 15 More drawer");
      const touchMin = await evaluate(cdp, `Math.min(...[...document.querySelectorAll('.classicNavDrawer button')].map((node)=>node.getBoundingClientRect().height))`);
      assert.ok(touchMin >= 44, `mobile drawer touch targets are at least 44px: ${touchMin}`);
      await click(cdp, '.classicNavDrawer [data-classic-mobile-family-target="strategy"][data-classic-mobile-view-target="catalog"]');
      await waitForExpression(cdp, `location.pathname === "/app/research/strategies" && document.querySelector('[data-classic-mobile-shell="true"]')?.dataset.classicMobileFamily === "strategy"`, "mobile strategy registry navigation");
      await evaluate(cdp, "history.back()");
      await waitForExpression(cdp, `location.pathname === "/app/ai/dialog" && document.querySelector('[data-classic-mobile-shell="true"]')?.dataset.shellRoute === "chat"`, "mobile browser Back restores AI Trader");
      await click(cdp, ".mNativeTabbar button:last-child");
      await click(cdp, '.classicNavDrawer [data-classic-mobile-family-target="configuration"]');
      await waitForExpression(cdp, `location.pathname === "/app/settings/overview" && document.querySelector('[data-classic-mobile-shell="true"]')?.dataset.shellRoute === "systemSettings"`, "mobile settings index URL");
      await clickText(cdp, ".mCfgRow", "运行参数");
      await waitForExpression(cdp, `location.pathname === "/app/settings/runtime" && document.querySelector('.settingsPage[data-aug15-config-section="runtime"]')`, "mobile runtime settings retain their exact URL and content");
      await evaluate(cdp, `history.pushState({}, "", "/app/risk/events"); dispatchEvent(new PopStateEvent("popstate"));`);
      await waitForExpression(cdp, `document.querySelector('[data-classic-mobile-shell="true"]')?.dataset.classicMobileView === "events" && document.querySelector('[data-aug15-risk-view="events"]')`, "mobile Event Risk deep link restores exact content");
      await evaluate(cdp, `history.pushState({}, "", "/app/risk/boundaries"); dispatchEvent(new PopStateEvent("popstate"));`);
      await waitForExpression(cdp, `document.querySelector('[data-classic-mobile-shell="true"]')?.dataset.classicMobileView === "boundaries" && document.querySelector('[data-aug15-risk-view="boundaries"]')`, "mobile boundary deep link restores exact content");
      await evaluate(cdp, `history.pushState({}, "", "/app/risk/rules"); dispatchEvent(new PopStateEvent("popstate"));`);
      await waitForExpression(cdp, `document.querySelector('[data-classic-mobile-shell="true"]')?.dataset.classicMobileView === "rules" && document.querySelector('[data-aug15-risk-view="rules"]') && document.querySelector('.mRuleGrid2') && !document.body.innerText.includes("当前硬边界")`, "mobile rule deep link restores rule content instead of boundaries");
      const riskRulesShot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
      await writeFile(path.join(outputDir, "app-390-risk-rules.png"), Buffer.from(riskRulesShot.data, "base64"));
      await evaluate(cdp, `history.pushState({}, "", "/app/operations/notifications"); dispatchEvent(new PopStateEvent("popstate"));`);
      await waitForExpression(cdp, `document.querySelector('[data-classic-mobile-shell="true"]')?.dataset.classicMobileView === "notifications" && document.querySelector('[data-aug15-operations-view="notifications"]')`, "mobile notifications deep link restores the notification inbox");
      const notificationsShot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
      await writeFile(path.join(outputDir, "app-390-notifications.png"), Buffer.from(notificationsShot.data, "base64"));
      const mobileGeometry = await evaluate(cdp, `({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})`);
      assert.ok(mobileGeometry.scroll <= mobileGeometry.client + 1, `mobile post-navigation has no overflow: ${JSON.stringify(mobileGeometry)}`);
    }
    results.push({ viewport: viewport.name, ...facts });
  }
  console.log(`aug15 visual browser PASS ${JSON.stringify(results)}`);
} finally {
  cdp?.close();
  await stop(chrome);
}
