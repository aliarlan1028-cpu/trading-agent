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
const pagePath = "/tests/kordyn-v2-canonical-selection-browser.html";
const viewports = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900, device: "desktop" }),
  mobile390: Object.freeze({ width: 390, height: 844, device: "mobile" }),
  mobile430: Object.freeze({ width: 430, height: 932, device: "mobile" })
});

const desktopCases = Object.freeze([
  { contract: "Mission", domain: "ai", workspace: "missions", type: "Agent run", id: "run-btc-analysis" },
  { contract: "Signal", domain: "ai", workspace: "intelligence", type: "Signal", id: "signal-cpi-flow" },
  { contract: "Event", domain: "ai", workspace: "events", type: "Event", id: "event-fomc-date" },
  { contract: "Watch", domain: "ai", workspace: "watch", type: "Watch", id: "watch-eth-retest" },
  { contract: "Market", domain: "account", workspace: "market", type: "Market", id: "BTC/USDT" },
  { contract: "Account", domain: "account", workspace: "account", type: "Account", id: "ex-okx-main" },
  { contract: "Position", domain: "account", workspace: "positions", type: "Position", id: "position-eth" },
  { contract: "Plan", domain: "account", workspace: "plans", type: "Trade plan", id: "plan-btc" },
  { contract: "Order", domain: "account", workspace: "orders", type: "Order", id: "order-btc" },
  { contract: "Fill", domain: "account", workspace: "fills", type: "Fill", id: "fill-btc" },
  { contract: "Strategy product", domain: "assets", workspace: "strategies", type: "Strategy product", id: "breakout@3.4" },
  { contract: "Strategy", domain: "assets", workspace: "strategies", type: "Strategy", id: "mean-reversion" },
  { contract: "Knowledge source", domain: "assets", workspace: "knowledge", type: "Knowledge", id: "source-market" },
  { contract: "Evidence", domain: "assets", workspace: "knowledge", type: "Evidence", id: "evidence-depth" },
  { contract: "Capability", domain: "assets", workspace: "capabilities", type: "Capability", id: "native-risk" },
  { contract: "Review", domain: "assets", workspace: "reviews", type: "Review", id: "review-btc" },
  { contract: "Owner candidate", domain: "assets", workspace: "reviews", type: "Owner candidate", id: "owner-candidate" },
  { contract: "Validation run", domain: "assets", workspace: "reviews", type: "Validation run", id: "backtest-owner" },
  { contract: "Mandate", domain: "governance", workspace: "overview", type: "Mandate", id: "mandate-core" },
  { contract: "Risk rule", domain: "governance", workspace: "overview", type: "Risk check", id: "risk-check-1" },
  { contract: "Risk incident", domain: "governance", workspace: "overview", type: "Risk incident", id: "risk-incident-1" },
  { contract: "Task", domain: "governance", workspace: "runs", type: "Task", id: "task-1" },
  { contract: "Agent run", domain: "governance", workspace: "runs", type: "Agent run", id: "job-run-1" },
  { contract: "Event source", domain: "governance", workspace: "event-inputs", type: "Event source", id: "event-source-fed" },
  { contract: "Notification", domain: "governance", workspace: "notifications", type: "Notification", id: "notification-1" },
  { contract: "Audit log", domain: "governance", workspace: "audit", type: "Audit log", id: "audit-1" },
  { contract: "Recovery record", domain: "governance", workspace: "recovery", type: "Recovery", id: "recovery-1" },
  { contract: "Configuration item", domain: "governance", workspace: "configuration", type: "Configuration item", id: "trading" }
]);

const mobileCases = Object.freeze([
  { ...desktopCases[0], viewport: viewports.mobile390 },
  { ...desktopCases[4], viewport: viewports.mobile390 },
  { ...desktopCases[10], viewport: viewports.mobile430 },
  { ...desktopCases[21], viewport: viewports.mobile430 }
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
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let requestId = 0;
  const ready = new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
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
    close() { socket.close(); }
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
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    deviceScaleFactor: 1,
    mobile: false
  });
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return { missing:true, objects:[...document.querySelectorAll('button[data-kordyn-v2-object-id]')].map((node)=>({id:node.dataset.kordynV2ObjectId,type:node.dataset.kordynV2ObjectType,text:node.textContent.trim().slice(0,60)})).slice(0,80), text:document.body.textContent.trim().slice(0,700) };
    target.scrollIntoView({ block:'center', inline:'nearest' });
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return rect.width > 0 && rect.height > 0 && (hit === target || target.contains(hit)) ? { x, y } : { blockedBy:hit?.outerHTML?.slice(0,180)||'none', rect:[rect.left,rect.top,rect.right,rect.bottom], viewport:[innerWidth,innerHeight] };
  })()`);
  assert.ok(Number.isFinite(point?.x) && Number.isFinite(point?.y), `trusted click ${selector}: ${JSON.stringify(point)}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

const attrValue = (value) => String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
const objectSelector = ({ type, id }) => `button[data-kordyn-v2-object-type="${attrValue(type)}"][data-kordyn-v2-object-id="${attrValue(id)}"]`;

async function navigate(cdp, spec, viewport) {
  await click(cdp, `[data-kordyn-v2-domain-target="${spec.domain}"]`);
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Domain === ${JSON.stringify(spec.domain)}`, `${viewport.device} ${spec.domain}`);
  const currentWorkspace = await evaluate(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Workspace`);
  if (currentWorkspace !== spec.workspace) await click(cdp, `[data-kordyn-v2-workspace-target="${spec.workspace}"]`);
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Workspace === ${JSON.stringify(spec.workspace)}`, `${viewport.device} ${spec.domain}/${spec.workspace}`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(objectSelector(spec))})`, `${spec.contract} production row`);
}

async function assertDesktopContextProof(cdp, spec) {
  await click(cdp, "[data-kordyn-v2-context-trigger]");
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-context-id="${attrValue(spec.id)}"][data-kordyn-v2-context-type="${attrValue(spec.type)}"]')`, `${spec.contract} Context`);
  await click(cdp, '[data-kordyn-v2-overlay="context"] [data-kordyn-v2-overlay-close]');
  await waitForExpression(cdp, `!document.querySelector('[data-kordyn-v2-overlay="context"]')`, `${spec.contract} Context close`);
  await click(cdp, "[data-kordyn-v2-proof-trigger]");
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-proof-id="${attrValue(spec.id)}"][data-kordyn-v2-proof-type="${attrValue(spec.type)}"]')`, `${spec.contract} Proof`);
  await click(cdp, '[data-kordyn-v2-overlay="proof"] [data-kordyn-v2-overlay-close]');
  await waitForExpression(cdp, `!document.querySelector('[data-kordyn-v2-overlay="proof"]')`, `${spec.contract} Proof close`);
}

async function assertMobileContextProof(cdp, spec) {
  await click(cdp, "[data-kordyn-v2-context-trigger]");
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-context-id="${attrValue(spec.id)}"][data-kordyn-v2-context-type="${attrValue(spec.type)}"]')`, `${spec.contract} APP Context`);
  await click(cdp, '[data-kordyn-v2-evidence-tab="proof"]');
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-proof-id="${attrValue(spec.id)}"][data-kordyn-v2-proof-type="${attrValue(spec.type)}"]')`, `${spec.contract} APP Proof`);
  await click(cdp, "[data-kordyn-v2-mobile-sheet-close]");
  await waitForExpression(cdp, `!document.querySelector('[data-kordyn-v2-mobile-sheet="evidence"]')`, `${spec.contract} APP sheet close`);
}

async function exercise(cdp, spec, viewport) {
  await navigate(cdp, spec, viewport);
  await click(cdp, objectSelector(spec));
  await waitForExpression(cdp, `(() => { const root=document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]'); return root?.dataset.kordynV2SelectedId === ${JSON.stringify(spec.id)} && root?.dataset.kordynV2SelectedType === ${JSON.stringify(spec.type)}; })()`, `${spec.contract} Root identity`);
  if (viewport.device === "desktop") await assertDesktopContextProof(cdp, spec);
  else await assertMobileContextProof(cdp, spec);
  return { contract: spec.contract, canonicalType: spec.type, id: spec.id, domain: spec.domain, workspace: spec.workspace, viewport: `${viewport.width}x${viewport.height}` };
}

async function navigatePage(cdp, baseUrl, viewport) {
  await setViewport(cdp, viewport);
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}?run=${Date.now()}` });
  await waitForExpression(cdp, "window.__kordynV2CanonicalSelectionReady && document.querySelector('[data-kordyn-v2-root]')", `${viewport.device} Root`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-convergence-browser-"));
const vite = spawn(process.execPath, [path.join(rootDir, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: rootDir, stdio: "ignore" });
const chrome = spawn(chromeBinary, ["--headless=new", "--hide-scrollbars", "--disable-gpu", "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });

let cdp;
try {
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  await waitFor(`${baseUrl}${pagePath}`);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);

  await navigatePage(cdp, baseUrl, viewports.desktop);
  const desktop = [];
  for (const spec of desktopCases) desktop.push(await exercise(cdp, spec, viewports.desktop));

  const mobile = [];
  for (const spec of mobileCases) {
    await navigatePage(cdp, baseUrl, spec.viewport);
    mobile.push(await exercise(cdp, spec, spec.viewport));
  }

  assert.equal(desktop.length, 28, "every required object contract clicked on a real Desktop surface");
  assert.deepEqual([...new Set(desktop.map((row) => row.contract))], desktopCases.map((row) => row.contract), "no object contract is represented by a helper-only assertion");
  assert.deepEqual([...new Set(mobile.map((row) => row.domain))].sort(), ["account", "ai", "assets", "governance"], "APP clicks represent all four domains");
  process.stdout.write(`KORDYN V2 canonical selection browser PASS desktop=${desktop.length}/28 APP=${mobile.length}/4 Context+Proof=matched ${JSON.stringify({ desktop, mobile })}\n`);
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
