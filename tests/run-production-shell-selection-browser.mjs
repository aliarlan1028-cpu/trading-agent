import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const appUrl = new URL(process.env.KORDYN_APP_URL || "http://127.0.0.1:5178/");
const mobileFixtureUrl = new URL("/tests/production-mobile-app-browser.html", appUrl);
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let requestId = 0;
  socket.on("message", (payload) => {
    const message = JSON.parse(payload.toString());
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const ready = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
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

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
    await exited;
  }
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function setViewportAndNavigate(cdp, url, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 900 });
  await cdp.send("Page.navigate", { url });
}

async function clickPoint(cdp, point) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function trustedClick(cdp, selector, { index = 0 } = {}) {
  await waitForExpression(cdp, `(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})][${index}];
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && (hit === target || target.contains(hit));
  })()`, `interactable click target ${selector}`);
  const point = await evaluate(cdp, `(() => {
    const targets = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const target = targets[${index}];
    if (!target) throw new Error(${JSON.stringify(`Missing click target ${selector} at index ${index}`)});
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await clickPoint(cdp, point);
}

async function trustedClickText(cdp, selector, text) {
  await waitForExpression(cdp, `(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.trim() === ${JSON.stringify(text)} || node.textContent.includes(${JSON.stringify(text)}));
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && (hit === target || target.contains(hit));
  })()`, `interactable click target ${selector} containing ${text}`);
  const point = await evaluate(cdp, `(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.trim() === ${JSON.stringify(text)} || node.textContent.includes(${JSON.stringify(text)}));
    if (!target) throw new Error(${JSON.stringify(`Missing click target ${selector} containing ${text}`)});
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await clickPoint(cdp, point);
}

async function waitForObject(cdp, rootSelector, type, id = null) {
  const idClause = id == null ? "true" : `node.dataset.shellObjectId === ${JSON.stringify(id)}`;
  await waitForExpression(cdp, `(() => [...document.querySelectorAll(${JSON.stringify(`${rootSelector} [data-shell-object-type="${type}"]`)})].some((node) => ${idClause}))()`, `${type} Registry row`);
}

async function clickObject(cdp, rootSelector, type, id = null) {
  const point = await evaluate(cdp, `(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(`${rootSelector} button[data-shell-object-type="${type}"]`)})].find((node) => ${id == null ? "true" : `node.dataset.shellObjectId === ${JSON.stringify(id)}`});
    if (!target) throw new Error(${JSON.stringify(`Missing ${type} object row`)});
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, id: target.dataset.shellObjectId };
  })()`);
  await clickPoint(cdp, point);
  return point.id;
}

async function assertDesktopIdentity(cdp, id, type) {
  const identity = `${type}:${id}`;
  await waitForExpression(cdp, `document.querySelector('.appShell.kordynSystem')?.dataset.shellSelectedObject === ${JSON.stringify(id)} && document.querySelector('.appShell.kordynSystem')?.dataset.shellSelectedType === ${JSON.stringify(type)}`, `${identity} desktop shell selection`);
  const state = await evaluate(cdp, `(() => ({
    object: document.querySelector('.appShell.kordynSystem')?.dataset.shellSelectedObject,
    type: document.querySelector('.appShell.kordynSystem')?.dataset.shellSelectedType,
    context: document.querySelector('[data-shell-role="context-dock"]')?.dataset.shellContextObject,
    trace: document.querySelector('[data-shell-role="trace-rail"]')?.dataset.shellTraceObject
  }))()`);
  assert.deepEqual(state, { object: id, type, context: identity, trace: identity });
}

async function closeMobileSheet(cdp) {
  await trustedClick(cdp, ".mShellSheet > header > button");
  await waitForExpression(cdp, "!document.querySelector('.mShellSheetOverlay')", "mobile shell sheet close");
}

async function assertMobileIdentity(cdp, id, type, { inspector = null, closeInspector = null } = {}) {
  const identity = `${type}:${id}`;
  await waitForExpression(cdp, `document.querySelector('.mShell2.kordynSystem')?.dataset.shellSelectedObject === ${JSON.stringify(id)} && document.querySelector('.mShell2.kordynSystem')?.dataset.shellSelectedType === ${JSON.stringify(type)}`, `${identity} MobileApp shell selection`);
  if (inspector) await waitForExpression(cdp, `document.querySelector(${JSON.stringify(inspector)})`, `${type} local Inspector`);
  if (closeInspector) {
    await trustedClick(cdp, closeInspector);
    await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(inspector)})`, `${type} local Inspector close`);
  }
  await trustedClick(cdp, ".mShellTools > .mShellToolButton", { index: 1 });
  await waitForExpression(cdp, "document.querySelector('.mShellSheet [data-shell-role=\"context-dock\"]')", "MobileApp Context sheet");
  assert.equal(await evaluate(cdp, "document.querySelector('.mShellSheet [data-shell-role=\"context-dock\"]')?.dataset.shellContextObject"), identity);
  await closeMobileSheet(cdp);
  await trustedClick(cdp, ".mShellTools > .mShellToolButton", { index: 2 });
  await waitForExpression(cdp, "document.querySelector('.mShellSheet [data-shell-role=\"trace-rail\"]')", "MobileApp Trace sheet");
  assert.equal(await evaluate(cdp, "document.querySelector('.mShellSheet [data-shell-role=\"trace-rail\"]')?.dataset.shellTraceObject"), identity);
  await closeMobileSheet(cdp);
}

const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-production-shell-selection-"));
const chrome = spawn(chromeBinary, [
  "--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu",
  "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${profileDir}`, "about:blank"
], { stdio: "ignore" });

let cdp;
try {
  await waitFor(appUrl.href);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);

  const desktopProof = [];
  await setViewportAndNavigate(cdp, appUrl.href, 1440, 900);
  await waitForExpression(cdp, "document.querySelector('.appShell.kordynSystem')", "real local desktop App");
  await waitForExpression(cdp, "document.querySelectorAll('.uxTabsInline button').length >= 4", "AI workspace lazy loader");

  await trustedClick(cdp, ".uxTabsInline button", { index: 3 });
  await waitForObject(cdp, ".appShell", "Event");
  let id = await clickObject(cdp, ".appShell", "Event");
  await assertDesktopIdentity(cdp, id, "Event");
  desktopProof.push(`AI:Event:${id}`);

  await trustedClick(cdp, "[data-shell-role='workspace-rail'] nav > button", { index: 1 });
  await waitForExpression(cdp, "document.querySelector('[data-product-workspace=\"live\"]')", "Live workspace loader");
  await trustedClickText(cdp, "[data-product-workspace='live'] .productWorkspaceFrame__nav button", "行情");
  await waitForObject(cdp, ".appShell", "Market");
  id = await clickObject(cdp, ".appShell", "Market");
  await assertDesktopIdentity(cdp, id, "Market");
  desktopProof.push(`Live:Market:${id}`);

  await trustedClick(cdp, "[data-shell-role='workspace-rail'] nav > button", { index: 2 });
  await waitForExpression(cdp, "document.querySelector('[data-product-workspace=\"lab\"]')", "Lab workspace loader");
  await trustedClickText(cdp, "[data-product-workspace='lab'] .productWorkspaceFrame__nav button", "策略资产");
  await waitForObject(cdp, ".appShell", "Strategy product");
  id = await clickObject(cdp, ".appShell", "Strategy product");
  await assertDesktopIdentity(cdp, id, "Strategy product");
  desktopProof.push(`Lab:Strategy product:${id}`);

  await trustedClick(cdp, "[data-shell-role='workspace-rail'] nav > button", { index: 3 });
  await waitForExpression(cdp, "document.querySelector('[data-product-workspace=\"control\"]')", "Control workspace loader");
  await trustedClickText(cdp, "[data-product-workspace='control'] .productWorkspaceFrame__nav button", "事件风险");
  await waitForExpression(cdp, "document.querySelector('.eventRiskEmpty,.cp2Empty') || document.querySelector('[data-product-workspace=\"control\"] [data-shell-object-type=\"Event\"]')", "real Control Event Risk result or authoritative empty state");
  const realControlEvent = await evaluate(cdp, "document.querySelector('[data-product-workspace=\"control\"] [data-shell-object-type=\"Event\"]')?.dataset.shellObjectId || null");
  desktopProof.push(realControlEvent ? `Control:Event:${realControlEvent}` : "Control:Event Risk:authoritative-empty");

  await trustedClick(cdp, "[data-shell-role='workspace-rail'] nav > button", { index: 4 });
  await waitForExpression(cdp, "document.querySelector('[data-product-workspace=\"operations\"]')", "Operations workspace loader");
  await trustedClickText(cdp, "[data-product-workspace='operations'] .productWorkspaceFrame__nav button", "任务与运行");
  await waitForObject(cdp, ".appShell", "Task");
  id = await clickObject(cdp, ".appShell", "Task");
  await assertDesktopIdentity(cdp, id, "Task");
  desktopProof.push(`Operations:Task:${id}`);

  await trustedClickText(cdp, "[data-product-workspace='operations'] .productWorkspaceFrame__nav button", "审计证据");
  await waitForObject(cdp, ".appShell", "Audit log");
  id = await clickObject(cdp, ".appShell", "Audit log");
  await assertDesktopIdentity(cdp, id, "Audit log");
  desktopProof.push(`Operations:Audit log:${id}`);

  const forbiddenUrl = new URL(mobileFixtureUrl);
  forbiddenUrl.searchParams.set("state", "forbidden");
  await setViewportAndNavigate(cdp, forbiddenUrl.href, 390, 844);
  await waitForExpression(cdp, "window.__productionMobileAppBrowserReady && document.querySelector('.mShell2.kordynSystem')", "forbidden MobileApp fixture");
  await waitForExpression(cdp, "document.querySelector('.workspaceState--forbidden')", "production permission boundary");
  assert.equal(await evaluate(cdp, "document.querySelector('.mShell2.kordynSystem')?.dataset.shellSelectedObject"), "none");

  await setViewportAndNavigate(cdp, mobileFixtureUrl.href, 390, 844);
  await waitForExpression(cdp, "window.__productionMobileAppBrowserReady && document.querySelector('.mShell2.kordynSystem')", "production MobileApp fixture");
  await waitForExpression(cdp, "document.querySelector('.workspaceState--loading')", "production loader boundary");
  await waitForExpression(cdp, "document.querySelector('.mWorkspaceRail--ai')", "loaded MobileApp AI workspace");

  const mobileProof = ["Boundary:forbidden", "Loader:loading→loaded"];
  await trustedClick(cdp, ".mWorkspaceRail--ai > button", { index: 3 });
  await waitForObject(cdp, ".mShell2", "Event", "event-5");
  await clickObject(cdp, ".mShell2", "Event", "event-5");
  await assertMobileIdentity(cdp, "event-5", "Event", { inspector: ".mEventDays button.selected" });
  mobileProof.push("AI:Event:event-5");

  await trustedClick(cdp, ".mNativeTabbar > button", { index: 1 });
  await waitForExpression(cdp, "document.querySelector('.mWorkspaceRail--trade')", "MobileApp Live navigation");
  await waitForObject(cdp, ".mShell2", "Market", "BTC/USDT");
  await clickObject(cdp, ".mShell2", "Market", "BTC/USDT");
  await assertMobileIdentity(cdp, "BTC/USDT", "Market", { inspector: '.mSymPills [data-shell-object-id="BTC/USDT"].active' });
  mobileProof.push("Live:Market:BTC/USDT");

  await trustedClick(cdp, ".mNativeTabbar > button", { index: 2 });
  await waitForExpression(cdp, "document.querySelector('.mWorkspaceRail--lab')", "MobileApp Lab navigation");
  await trustedClick(cdp, ".mWorkspaceRail--lab > button", { index: 3 });
  await waitForObject(cdp, ".mShell2", "Capability", "capability-18");
  await clickObject(cdp, ".mShell2", "Capability", "capability-18");
  await assertMobileIdentity(cdp, "capability-18", "Capability", { inspector: ".mCapabilitySheet", closeInspector: ".mCapabilitySheet .mSheetGrip" });
  mobileProof.push("Lab:Capability:capability-18");

  await trustedClick(cdp, ".mWorkspaceRail--lab > button", { index: 2 });
  await waitForObject(cdp, ".mShell2", "Strategy product", "breakout@4");
  await clickObject(cdp, ".mShell2", "Strategy product", "breakout@4");
  await assertMobileIdentity(cdp, "breakout@4", "Strategy product", { inspector: ".mLabRegistrySheet", closeInspector: ".mLabRegistrySheet .mSheetGrip" });
  mobileProof.push("Lab:Strategy product:breakout@4");
  await waitForObject(cdp, ".mShell2", "Strategy", "mean-reversion");
  await clickObject(cdp, ".mShell2", "Strategy", "mean-reversion");
  await assertMobileIdentity(cdp, "mean-reversion", "Strategy", { inspector: ".mLabRegistrySheet", closeInspector: ".mLabRegistrySheet .mSheetGrip" });
  mobileProof.push("Lab:Strategy:mean-reversion");

  await trustedClickText(cdp, ".mStrategyTabs > button", "回测研究");
  await waitForObject(cdp, ".mShell2", "Validation run", "validation-6");
  await clickObject(cdp, ".mShell2", "Validation run", "validation-6");
  await assertMobileIdentity(cdp, "validation-6", "Validation run", { inspector: ".mResearchSheet", closeInspector: ".mResearchSheet .mSheetGrip" });
  mobileProof.push("Lab:Validation run:validation-6");

  await trustedClick(cdp, ".mWorkspaceRail--lab > button", { index: 4 });
  await waitForObject(cdp, ".mShell2", "Review", "review-15");
  await clickObject(cdp, ".mShell2", "Review", "review-15");
  await assertMobileIdentity(cdp, "review-15", "Review", { inspector: ".mReviewSheet", closeInspector: ".mReviewSheet .mSheetGrip" });
  mobileProof.push("Lab:Review:review-15");

  await trustedClick(cdp, ".mNativeTabbar > button", { index: 3 });
  await waitForExpression(cdp, "document.querySelector('.mWorkspaceRail--control')", "MobileApp Control navigation");
  await trustedClick(cdp, ".mWorkspaceRail--control > button", { index: 2 });
  await waitForObject(cdp, ".mShell2", "Event", "event-5");
  await clickObject(cdp, ".mShell2", "Event", "event-5");
  await assertMobileIdentity(cdp, "event-5", "Event", { inspector: ".mEventRiskInspector" });
  mobileProof.push("Control:Event:event-5");

  await trustedClick(cdp, ".mNativeTabbar > button", { index: 4 });
  await waitForExpression(cdp, "document.querySelector('.mDrawer')", "MobileApp More drawer");
  await trustedClickText(cdp, ".mDrawerItem", "运行与恢复");
  await waitForExpression(cdp, "document.querySelector('.mOperationsNative')", "MobileApp Operations navigation");
  await trustedClickText(cdp, ".mOpsRail > button", "任务");
  await waitForObject(cdp, ".mShell2", "Task", "task-9");
  await clickObject(cdp, ".mShell2", "Task", "task-9");
  await assertMobileIdentity(cdp, "task-9", "Task", { inspector: ".mOpsTaskHero" });
  mobileProof.push("Operations:Task:task-9");
  await trustedClick(cdp, ".mOpsDetailNav > button");

  await trustedClickText(cdp, ".mOpsRail > button", "审计");
  await waitForObject(cdp, ".mShell2", "Audit log", "audit-13");
  await clickObject(cdp, ".mShell2", "Audit log", "audit-13");
  await assertMobileIdentity(cdp, "audit-13", "Audit log", { inspector: ".mOpsAuditDetail" });
  mobileProof.push("Operations:Audit log:audit-13");

  process.stdout.write(`production shell selection browser PASS desktop=[${desktopProof.join(", ")}] mobile=[${mobileProof.join(", ")}]\n`);
} finally {
  cdp?.close();
  await stopProcess(chrome);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
