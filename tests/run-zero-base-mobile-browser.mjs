import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
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
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let requestId = 0;
  socket.on("message", (payload) => {
    const message = JSON.parse(payload.toString());
    if (message.method === "Runtime.exceptionThrown") {
      console.error("[browser exception]", message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "unknown");
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      console.error("[browser console]", (message.params.args || []).map((arg) => arg.value || arg.description || "").join(" "));
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return {
    async send(method, params = {}) {
      await ready;
      const id = ++requestId;
      return await new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
    },
    close() { socket.close(); }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
}

async function waitForExpression(cdp, expression, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

async function click(cdp, selector) {
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})`, `click target ${selector}`);
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    target.scrollIntoView({ block:"center", inline:"center" });
    const rect = target.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!(hit === target || target.contains(hit))) throw new Error(${JSON.stringify(`Target is obscured: ${selector}`)});
    return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type:"mousePressed", x:point.x, y:point.y, button:"left", clickCount:1 });
  await cdp.send("Input.dispatchMouseEvent", { type:"mouseReleased", x:point.x, y:point.y, button:"left", clickCount:1 });
  await new Promise((resolve) => setTimeout(resolve, 120));
}

async function setViewport(cdp, url, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor:1, mobile:true, screenWidth:width, screenHeight:height });
  await cdp.send("Page.navigate", { url });
  await waitForExpression(cdp, "window.__zeroBaseMobileBrowserReady && document.querySelector('[data-zero-base-shell=\"mobile\"]')", `${width}px MobileApp shell`);
}

async function capture(cdp, name) {
  const outputDir = process.env.KORDYN_ZERO_BASE_MOBILE_SCREENSHOT_DIR;
  if (!outputDir) return;
  await mkdir(outputDir, { recursive:true });
  const result = await cdp.send("Page.captureScreenshot", { format:"png", fromSurface:true, captureBeyondViewport:false });
  await writeFile(path.join(outputDir, `${name}.png`), Buffer.from(result.data, "base64"));
}

async function shellState(cdp) {
  return await evaluate(cdp, `(() => {
    const root=document.querySelector('[data-zero-base-shell="mobile"]');
    const main=root?.querySelector(':scope > .mMain2');
    const tabbar=root?.querySelector(':scope > .zbMobileTabbar');
    const rect=(node)=>{if(!node)return null;const r=node.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};};
    return { root:root?.dataset.zeroBaseMobileRoot, family:root?.dataset.zeroBaseMobileFamily, view:root?.dataset.zeroBaseMobileView,
      route:root?.dataset.shellRoute, subPage:root?.dataset.shellSubpage, selected:root?.dataset.shellSelectedObject, type:root?.dataset.shellSelectedType,
      activeRoots:root?.querySelectorAll('.zbMobileTabbar [aria-current="page"]').length,
      rootTargets:[...root?.querySelectorAll('.zbMobileTabbar [data-zero-base-mobile-root-target]')||[]].map(node=>node.dataset.zeroBaseMobileRootTarget),
      activeLocal:root?.querySelectorAll('.zbMobileFamilyRail [aria-current="page"]').length||0,
      main:rect(main),tabbar:rect(tabbar),document:[document.documentElement.clientWidth,document.documentElement.scrollWidth],body:[document.body.clientWidth,document.body.scrollWidth]
    };
  })()`);
}

async function assertLocation(cdp, root, family, view, contentSelector) {
  await waitForExpression(cdp, `(() => { const node=document.querySelector('[data-zero-base-shell="mobile"]'); return node?.dataset.zeroBaseMobileRoot===${JSON.stringify(root)} && node?.dataset.zeroBaseMobileFamily===${JSON.stringify(family)} && node?.dataset.zeroBaseMobileView===${JSON.stringify(view)} && document.querySelector(${JSON.stringify(contentSelector)}); })()`, `${root}/${family}/${view}`);
  const state = await shellState(cdp);
  assert.equal(state.activeRoots, 1);
  assert.equal(state.document[0], state.document[1]);
  assert.equal(state.body[0], state.body[1]);
  return state;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
}

const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-zero-base-mobile-"));
const vite = spawn("npm", ["exec", "vite", "--", "--host", "127.0.0.1", "--port", String(vitePort)], { cwd:rootDir, stdio:"ignore" });
const chrome = spawn(chromeBinary, ["--headless=new","--disable-background-networking","--disable-extensions","--disable-gpu","--no-default-browser-check","--no-first-run",`--remote-debugging-port=${chromePort}`,`--user-data-dir=${profileDir}`,"about:blank"], { stdio:"ignore" });

let cdp;
try {
  const baseUrl = `http://127.0.0.1:${vitePort}/tests/zero-base-mobile-browser.html`;
  await waitFor(baseUrl);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);

  const responsive = [];
  for (const [width,height] of [[390,844],[430,932]]) {
    await setViewport(cdp, baseUrl, width, height);
    const state = await assertLocation(cdp, "today", "today", "owner", ".zbMobileToday__ai");
    assert.deepEqual(state.rootTargets, ["today","ai","assets","intelligent","more"]);
    assert.equal(state.main.width, width);
    responsive.push({ width, height, root:state.root, mainWidth:state.main.width, tabbarWidth:state.tabbar.width });
    await capture(cdp, `mobile-${width}-today`);
  }

  await click(cdp, '[data-zero-base-mobile-root-target="ai"]');
  await assertLocation(cdp, "ai", "ai", "dialog", ".mobileChatShell");
  await click(cdp, '[data-zero-base-mobile-view-target="patrol"]');
  await assertLocation(cdp, "ai", "ai", "patrol", '[data-ai-surface="patrol"] .patrolReceipt');
  assert.equal(await evaluate(cdp, `document.querySelector('[data-ai-surface="patrol"] .agInputBar')===null`), true);
  await capture(cdp, "mobile-430-ai-patrol");
  await click(cdp, '[data-zero-base-mobile-view-target="poster"]');
  await assertLocation(cdp, "ai", "ai", "poster", '[data-ai-surface="poster"] .agPosterBtn');
  assert.equal(await evaluate(cdp, `document.querySelector('[data-ai-surface="poster"] .agInputBar')===null`), true);
  await click(cdp, '[data-ai-surface="poster"] .agPosterBtn');
  await waitForExpression(cdp, `document.querySelector('.posterModal')`, "real PosterModal");
  await capture(cdp, "mobile-430-ai-poster");
  await click(cdp, '.posterClose');
  await click(cdp, '[data-zero-base-mobile-view-target="intelligence"]');
  await assertLocation(cdp, "ai", "ai", "intelligence", ".mIntelPage");
  await capture(cdp, "mobile-430-ai-intelligence");

  await click(cdp, '[data-zero-base-mobile-root-target="assets"]');
  await assertLocation(cdp, "assets", "portfolio", "overview", ".marketQuoteEvidence");
  await click(cdp, '[data-zero-base-mobile-view-target="positions"]');
  await assertLocation(cdp, "assets", "portfolio", "positions", ".mPositions");

  await click(cdp, '[data-zero-base-mobile-root-target="intelligent"]');
  await assertLocation(cdp, "intelligent", "hub", "hub", '[data-zero-base-mobile-surface="intelligent-hub"]');
  assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll('[data-zero-base-mobile-surface="intelligent-hub"] [data-zero-base-mobile-family-target]')].map(node=>node.dataset.zeroBaseMobileFamilyTarget)`), ["strategy","knowledge","capability","reviews"]);
  await capture(cdp, "mobile-430-intelligent-hub");
  await click(cdp, '[data-zero-base-mobile-family-target="strategy"]');
  await assertLocation(cdp, "intelligent", "strategy", "catalog", ".mStrategyTabs");
  await click(cdp, '[data-zero-base-mobile-view-target="historical"]');
  await assertLocation(cdp, "intelligent", "strategy", "historical", ".mResearchMobile");
  await capture(cdp, "mobile-430-strategy-historical");

  await click(cdp, '[data-zero-base-mobile-root-target="intelligent"]');
  await click(cdp, '[data-zero-base-mobile-family-target="knowledge"]');
  await click(cdp, '[data-zero-base-mobile-view-target="workflows"]');
  await assertLocation(cdp, "intelligent", "knowledge", "workflows", ".mSubPage");
  assert.equal(await evaluate(cdp, `document.querySelector('.mSubPage .mChips button.active')?.textContent.includes('工具工作流')||document.querySelector('.mSubPage .mChips button.active')?.textContent.includes('Tool')`), true);

  await click(cdp, '[data-zero-base-mobile-root-target="intelligent"]');
  await click(cdp, '[data-zero-base-mobile-family-target="capability"]');
  await click(cdp, '[data-zero-base-mobile-view-target="mcp"]');
  await assertLocation(cdp, "intelligent", "capability", "mcp", ".mCapabilityScreen");

  await click(cdp, '[data-zero-base-mobile-root-target="more"]');
  await assertLocation(cdp, "more", "hub", "hub", '[data-zero-base-mobile-surface="more-hub"]');
  assert.deepEqual(await evaluate(cdp, `[...document.querySelectorAll('[data-zero-base-mobile-surface="more-hub"] [data-zero-base-mobile-family-target]')].map(node=>node.dataset.zeroBaseMobileFamilyTarget)`), ["guard","operations","configuration"]);
  await capture(cdp, "mobile-430-more-hub");
  await click(cdp, '[data-zero-base-mobile-family-target="guard"]');
  await click(cdp, '[data-zero-base-mobile-view-target="events"]');
  await assertLocation(cdp, "more", "guard", "events", ".mEventRiskRegistry");
  await click(cdp, '.mEventRiskRegistry [data-shell-object-type="Event"]');
  await waitForExpression(cdp, `document.querySelector('[data-zero-base-shell="mobile"]')?.dataset.shellSelectedObject==='event-5'`, "canonical Event selection");
  await click(cdp, '.mShellTools .mShellToolButton:nth-child(2)');
  await waitForExpression(cdp, `document.querySelector('.mShellSheet [data-shell-role="context-dock"]')?.dataset.shellContextObject==='Event:event-5'`, "Context identity");
  await click(cdp, '.mShellSheet > header > button');
  await click(cdp, '.mShellTools .mShellToolButton:nth-child(3)');
  await waitForExpression(cdp, `document.querySelector('.mShellSheet [data-shell-role="trace-rail"]')?.dataset.shellTraceObject==='Event:event-5'`, "Trace identity");
  await click(cdp, '.mShellSheet > header > button');
  await capture(cdp, "mobile-430-event-risk");

  await click(cdp, '[data-zero-base-mobile-root-target="more"]');
  await click(cdp, '[data-zero-base-mobile-family-target="operations"]');
  await click(cdp, '[data-zero-base-mobile-view-target="tasks"]');
  await assertLocation(cdp, "more", "operations", "tasks", ".mOperationsTasks");

  await click(cdp, '[data-zero-base-mobile-root-target="more"]');
  await click(cdp, '[data-zero-base-mobile-family-target="configuration"]');
  await click(cdp, '[data-zero-base-mobile-view-target="security"]');
  await assertLocation(cdp, "more", "configuration", "security", ".mConfigurationDetail");
  await capture(cdp, "mobile-430-configuration-security");

  const stateProof = {};
  for (const state of ["loading","failed","forbidden","stale","degraded"]) {
    await setViewport(cdp, `${baseUrl}?state=${state}`, 390, 844);
    const boundarySelector = ({ loading: ".workspaceState--loading", failed: ".workspaceState--error", forbidden: ".workspaceState--forbidden", stale: '[data-resource-state="stale"]', degraded: '[data-resource-state="degraded"]' })[state];
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(boundarySelector)})`, `${state} boundary`);
    const proof = await shellState(cdp);
    stateProof[state] = { root:proof.root, activeRoots:proof.activeRoots, overflow:proof.document[0] !== proof.document[1] };
  }

  console.log(JSON.stringify({ result:"PASS", responsive, navigation:["today","ai/dialog","ai/patrol","ai/poster","ai/intelligence","assets/positions","intelligent/strategy/historical","intelligent/knowledge/workflows","intelligent/capability/mcp","more/guard/events","more/operations/tasks","more/configuration/security"], selection:"Event:event-5", sheets:["context","trace"], states:stateProof }, null, 2));
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive:true, force:true });
}
