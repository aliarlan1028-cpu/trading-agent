import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pagePath = "/tests/kordyn-v2-accessibility-browser.html";
const domainEntrypoints = Object.freeze({
  ai: Object.freeze(["/src/kordynV2/domains/ai/index.jsx", "/src/kordynV2/domains/ai/ai.css"]),
  account: Object.freeze(["/src/kordynV2/domains/account/index.jsx", "/src/kordynV2/domains/account/account.css"]),
  assets: Object.freeze(["/src/kordynV2/domains/assets/index.jsx", "/src/kordynV2/domains/assets/assets.css"]),
  governance: Object.freeze(["/src/kordynV2/domains/governance/index.jsx", "/src/kordynV2/domains/governance/governance.css"])
});
const forbiddenLegacy = Object.freeze([
  "/src/productStyles.js",
  "/src/classicStyles.js",
  "/src/styles.css",
  "/src/product-foundation.css",
  "/src/zero-base-styles.css"
]);

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
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
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
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
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
    else request.resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = ++requestId;
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitForExpression(cdp, expression, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target=document.querySelector(${JSON.stringify(selector)});
    if(!target)return {missing:true};
    target.scrollIntoView({block:'center',inline:'nearest'});
    const rect=target.getBoundingClientRect();
    const x=rect.left+rect.width/2;
    const y=rect.top+rect.height/2;
    const hit=document.elementFromPoint(x,y);
    return rect.width>0&&rect.height>0&&(hit===target||target.contains(hit))?{x,y}:{blockedBy:hit?.outerHTML?.slice(0,160)||'none'};
  })()`);
  assert.ok(Number.isFinite(point?.x) && Number.isFinite(point?.y), `trusted click ${selector}: ${JSON.stringify(point)}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function resourcePaths(cdp) {
  return await evaluate(cdp, `performance.getEntriesByType('resource').map((entry)=>new URL(entry.name).pathname).sort()`);
}

function assertNoLegacy(paths, label) {
  const found = paths.filter((name) => forbiddenLegacy.some((legacy) => name.endsWith(legacy)));
  assert.deepEqual(found, [], `${label}: V2 must not request legacy authenticated CSS entrypoints`);
}

function requestedDomainEntrypoint(paths, domainId) {
  return paths.some((name) => domainEntrypoints[domainId].some((entrypoint) => name.endsWith(entrypoint)));
}

async function navigateDomain(cdp, domainId) {
  const before = new Set(await resourcePaths(cdp));
  const started = Date.now();
  await click(cdp, `[data-kordyn-v2-domain-target="${domainId}"]`);
  await waitForExpression(
    cdp,
    `document.querySelector('[data-kordyn-v2-shell]')?.dataset.kordynV2Domain===${JSON.stringify(domainId)}`,
    `${domainId}: route ready`
  );
  await waitForExpression(
    cdp,
    `!document.querySelector('[class*="DomainLoading"]')`,
    `${domainId}: domain interaction ready`
  );
  const elapsedMs = Date.now() - started;
  const after = await resourcePaths(cdp);
  const transferred = after.filter((name) => !before.has(name));
  assert.ok(requestedDomainEntrypoint(after, domainId), `${domainId}: domain entrypoint requested after navigation`);
  assert.ok(elapsedMs < 5_000, `${domainId}: local interaction readiness ${elapsedMs}ms`);
  assertNoLegacy(after, domainId);
  return { domainId, elapsedMs, transferred };
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-performance-browser-"));
const vite = spawn(process.execPath, [path.join(rootDir, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: rootDir, stdio: "ignore" });
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--hide-scrollbars",
  "--disable-gpu",
  "--no-default-browser-check",
  "--no-first-run",
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${profileDir}`,
  "about:blank"
], { stdio: "ignore" });

let cdp;
try {
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  await waitFor(`${baseUrl}${pagePath}`);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    screenWidth: 1440,
    screenHeight: 900,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__kordynV2LongTasks=[];try{new PerformanceObserver((list)=>{for(const entry of list.getEntries())window.__kordynV2LongTasks.push({name:entry.name,startTime:entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:true});}catch(error){window.__kordynV2LongTaskObserverError=String(error);}`
  });
  const initialStarted = Date.now();
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}?run=${Date.now()}&lang=zh&state=loaded` });
  await waitForExpression(cdp, "window.__kordynV2AccessibilityReady && document.querySelector('[data-kordyn-v2-shell]')?.dataset.kordynV2Domain==='ai'", "initial AI route");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-destination=\"ai/missions\"]')", "initial AI mission interaction ready");
  const initialElapsedMs = Date.now() - initialStarted;
  const initialResources = await resourcePaths(cdp);
  assert.ok(requestedDomainEntrypoint(initialResources, "ai"), "initial AI domain requested");
  for (const domainId of ["account", "assets", "governance"]) {
    assert.equal(requestedDomainEntrypoint(initialResources, domainId), false, `initial AI route must not request inactive ${domainId} entrypoint`);
  }
  assert.ok(initialElapsedMs < 5_000, `initial AI interaction readiness ${initialElapsedMs}ms`);
  assertNoLegacy(initialResources, "initial AI");

  const account = await navigateDomain(cdp, "account");
  let paths = await resourcePaths(cdp);
  for (const domainId of ["assets", "governance"]) {
    assert.equal(requestedDomainEntrypoint(paths, domainId), false, `account route must not prefetch inactive ${domainId}`);
  }

  const assets = await navigateDomain(cdp, "assets");
  paths = await resourcePaths(cdp);
  assert.equal(paths.some((name) => name.endsWith("/src/kordynV2/domains/assets/strategy.css")), false, "relationship workspace must defer strategy CSS");
  assert.equal(paths.some((name) => name.includes("/src/kordynV2/domains/assets/StrategyWorkspace.jsx")), false, "relationship workspace must defer Strategy workspace component");
  assert.equal(requestedDomainEntrypoint(paths, "governance"), false, "assets route must not prefetch inactive governance");

  const strategyStarted = Date.now();
  await click(cdp, '[data-kordyn-v2-workspace-target="strategies"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-assets-workspace=\"strategies\"]')", "strategy workspace ready");
  const strategyElapsedMs = Date.now() - strategyStarted;
  paths = await resourcePaths(cdp);
  assert.ok(paths.some((name) => name.endsWith("/src/kordynV2/domains/assets/strategy.css")), "strategy CSS loads only when Strategy workspace opens");
  assert.ok(paths.some((name) => name.includes("/src/kordynV2/domains/assets/StrategyWorkspace.jsx")), "Strategy workspace component loads on demand");
  assert.ok(strategyElapsedMs < 5_000, `strategy interaction readiness ${strategyElapsedMs}ms`);

  const governance = await navigateDomain(cdp, "governance");
  const longTasks = await evaluate(cdp, "window.__kordynV2LongTasks || []");
  const blocking = longTasks.filter((entry) => entry.duration > 200);
  assert.deepEqual(blocking, [], `no V2 main-thread task may exceed 200ms: ${JSON.stringify(blocking)}`);
  assertNoLegacy(await resourcePaths(cdp), "complete V2 navigation");

  const paint = await evaluate(cdp, `(() => {
    const navigation=performance.getEntriesByType('navigation')[0];
    const paints=Object.fromEntries(performance.getEntriesByType('paint').map((entry)=>[entry.name,Math.round(entry.startTime)]));
    return {domContentLoaded:Math.round(navigation?.domContentLoadedEventEnd||0),load:Math.round(navigation?.loadEventEnd||0),paints};
  })()`);
  process.stdout.write(`KORDYN V2 performance browser PASS fixture=production-root initialAI=${initialElapsedMs}ms account=${account.elapsedMs}ms assets=${assets.elapsedMs}ms strategy=${strategyElapsedMs}ms governance=${governance.elapsedMs}ms inactive-before-navigation=0 legacy-requests=0 longtasks-over-200ms=0 paint=${JSON.stringify(paint)}\n`);
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
