import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const appUrl = new URL(process.env.KORDYN_APP_URL || "http://127.0.0.1:5178/");
const mobileFixtureUrl = new URL("/tests/production-mobile-app-browser.html", appUrl);
const desktopStateFixtureUrl = new URL("/tests/production-desktop-state-browser.html", appUrl);
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
    target.scrollIntoView({ block: 'center', inline: 'center' });
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
    target.scrollIntoView({ block: 'center', inline: 'center' });
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
    const matches = [...document.querySelectorAll(${JSON.stringify(`${rootSelector} [data-shell-object-type="${type}"]`)})].filter((node) => ${id == null ? "true" : `node.dataset.shellObjectId === ${JSON.stringify(id)}`});
    const target = matches.find((node) => node.matches('button,a,input,select,[role="button"],[role="option"]'))
      || matches.find((node) => node.matches('tr') && node.closest('table.rowClickable'))
      || matches[0];
    if (!target) throw new Error(${JSON.stringify(`Missing ${type} object row`)});
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, id: target.dataset.shellObjectId };
  })()`);
  await clickPoint(cdp, point);
  return point.id;
}

async function readDesktopStateGeometry(cdp, state) {
  return await evaluate(cdp, `(() => {
    const shell = document.querySelector('.appShell.kordynSystem');
    const command = shell?.querySelector(':scope > .appTopbar');
    const workspace = shell?.querySelector(':scope > [data-shell-role="workspace-rail"]');
    const main = shell?.querySelector(':scope > .mainArea');
    const context = shell?.querySelector(':scope > [data-shell-role="context-dock"]');
    const trace = shell?.querySelector(':scope > [data-shell-role="trace-rail"]');
    const boundary = shell?.querySelector('[data-resource-state="${state}"]');
    const banner = boundary?.querySelector('.workspaceState');
    const retry = banner?.querySelector('button');
    const truth = boundary?.querySelector('.workspaceStateBoundary__lastValid .uxCenter');
    const rect = (node) => { if (!node) return null; const value = node.getBoundingClientRect(); return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height }; };
    return {
      shell: rect(shell), command: rect(command), workspace: rect(workspace), main: rect(main), context: rect(context), trace: rect(trace), banner: rect(banner), retry: rect(retry), truth: rect(truth),
      documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth || document.documentElement.scrollHeight > document.documentElement.clientHeight
    };
  })()`);
}

function assertStateSurfacesClearContext(state, geometry, mode) {
  const contextOverlaps = [["banner", geometry.banner], ["retry", geometry.retry], ["truth", geometry.truth]]
    .filter(([, rect]) => rect?.right > geometry.context?.left + 1)
    .map(([surface, rect]) => ({ surface, right: rect.right, contextLeft: geometry.context.left }));
  assert.deepEqual(contextOverlaps, [], `${state} constrained surfaces do not render beneath the ${mode} Context dock`);
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

async function assertMobileIdentity(cdp, id, type, { inspector = null, closeInspector = null, scope = null } = {}) {
  const identity = `${type}:${id}`;
  await waitForExpression(cdp, `document.querySelector('.mShell2.kordynSystem')?.dataset.shellSelectedObject === ${JSON.stringify(id)} && document.querySelector('.mShell2.kordynSystem')?.dataset.shellSelectedType === ${JSON.stringify(type)}`, `${identity} MobileApp shell selection`);
  if (scope) {
    const rootScope = await evaluate(cdp, `(() => {
      const root = document.querySelector('.mShell2.kordynSystem');
      return { workspaceId: root?.dataset.shellSelectedWorkspace, sourceSection: root?.dataset.shellSelectedSource, route: root?.dataset.shellSelectedRoute, evidence: root?.dataset.shellSelectedEvidence };
    })()`);
    assert.deepEqual(rootScope, { workspaceId: scope.workspaceId, sourceSection: scope.sourceSection, route: scope.route, evidence: scope.objectEvidence });
  }
  if (inspector) await waitForExpression(cdp, `document.querySelector(${JSON.stringify(inspector)})`, `${type} local Inspector`);
  if (closeInspector) {
    await trustedClick(cdp, closeInspector);
    await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(inspector)})`, `${type} local Inspector close`);
  }
  await trustedClick(cdp, ".mShellTools > .mShellToolButton", { index: 1 });
  await waitForExpression(cdp, "document.querySelector('.mShellSheet [data-shell-role=\"context-dock\"]')", "MobileApp Context sheet");
  const contextScope = await evaluate(cdp, `(() => {
    const context = document.querySelector('.mShellSheet [data-shell-role="context-dock"]');
    return { object: context?.dataset.shellContextObject, workspaceId: context?.dataset.shellContextWorkspace, sourceSection: context?.dataset.shellContextSource, route: context?.dataset.shellContextRoute, evidence: context?.dataset.shellContextEvidence };
  })()`);
  assert.equal(contextScope.object, identity);
  if (scope) assert.deepEqual(contextScope, { object: identity, workspaceId: scope.workspaceId, sourceSection: scope.sourceSection, route: scope.route, evidence: scope.objectEvidence });
  await closeMobileSheet(cdp);
  await trustedClick(cdp, ".mShellTools > .mShellToolButton", { index: 2 });
  await waitForExpression(cdp, "document.querySelector('.mShellSheet [data-shell-role=\"trace-rail\"]')", "MobileApp Trace sheet");
  const traceScope = await evaluate(cdp, `(() => {
    const trace = document.querySelector('.mShellSheet [data-shell-role="trace-rail"]');
    return { object: trace?.dataset.shellTraceObject, workspaceId: trace?.dataset.shellTraceWorkspace, sourceSection: trace?.dataset.shellTraceSource, route: trace?.dataset.shellTraceRoute, evidence: trace?.dataset.shellTraceEvidence };
  })()`);
  assert.equal(traceScope.object, identity);
  if (scope) assert.deepEqual(traceScope, { object: identity, workspaceId: scope.workspaceId, sourceSection: scope.sourceSection, route: scope.route, evidence: scope.traceEvidence });
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
  await waitForExpression(cdp, "document.querySelector('.appShell .cp2EventsLayout [data-shell-object-type=\"Event\"]') || document.querySelector('.appShell .cp2EventsLayout .cp2Empty')", "AI Event registry result or authoritative empty state");
  const realAiEvent = await evaluate(cdp, "document.querySelector('.appShell .cp2EventsLayout [data-shell-object-type=\"Event\"]')?.dataset.shellObjectId || null");
  let id = null;
  if (realAiEvent) {
    id = await clickObject(cdp, ".appShell", "Event", realAiEvent);
    await assertDesktopIdentity(cdp, id, "Event");
  }
  desktopProof.push(realAiEvent ? `AI:Event:${id}` : "AI:Event:authoritative-empty");

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

  for (const [state, width, height] of [["stale", 1440, 900], ["degraded", 1180, 820]]) {
    const stateUrl = new URL(desktopStateFixtureUrl);
    stateUrl.searchParams.set("state", state);
    await setViewportAndNavigate(cdp, stateUrl.href, width, height);
    await waitForExpression(cdp, `window.__productionDesktopStateReady && document.querySelector('[data-resource-state="${state}"] .uxCenter')`, `${state} desktop last-valid workspace`);
    const shellGeometry = await readDesktopStateGeometry(cdp, state);
    assert.ok(shellGeometry.shell?.width >= width - 1 && shellGeometry.shell?.height >= height - 1, `${state} uses a viewport-sized production desktop shell`);
    assert.ok(shellGeometry.command?.width >= width - 1 && shellGeometry.command?.height >= 56, `${state} keeps the real Command rail visible`);
    assert.ok(shellGeometry.workspace?.width >= 150 && shellGeometry.workspace?.height >= 400, `${state} keeps the real Workspace rail visible`);
    assert.ok(shellGeometry.main?.width >= 500 && shellGeometry.main?.height >= 500, `${state} keeps a usable main workspace`);
    assert.ok(shellGeometry.context?.width >= 58 && shellGeometry.context?.height >= 400, `${state} keeps the real Context dock visible`);
    assert.ok(shellGeometry.trace?.width >= width - 1 && shellGeometry.trace?.height >= 56, `${state} keeps the real Trace rail visible`);
    assert.ok(shellGeometry.banner?.width >= 480 && shellGeometry.banner?.height >= 56, `${state} warning banner is visibly actionable`);
    assert.ok(shellGeometry.retry?.width >= 36 && shellGeometry.retry?.height >= 36, `${state} retry target is visibly reachable`);
    assert.ok(shellGeometry.truth?.width >= 480 && shellGeometry.truth?.height >= 240, `${state} last-valid production workspace remains visibly inspectable`);
    assertStateSurfacesClearContext(state, shellGeometry, width <= 1280 ? "collapsed" : "open");
    assert.equal(shellGeometry.documentOverflow, false, `${state} production desktop shell does not overflow the page`);
    const stateBoundary = await evaluate(cdp, `(() => {
      const boundary = document.querySelector('[data-resource-state="${state}"]');
      const content = boundary?.querySelector('.workspaceStateBoundary__lastValid');
      return { warning: Boolean(boundary?.querySelector('.workspaceState--warning')), inert: content?.hasAttribute('inert'), interaction: content?.dataset.lastValidInteraction, pointerEvents: getComputedStyle(content).pointerEvents };
    })()`);
    assert.deepEqual(stateBoundary, { warning: true, inert: true, interaction: "disabled", pointerEvents: "none" });
    await trustedClick(cdp, `[data-resource-state="${state}"] .workspaceState > button`);
    assert.equal(await evaluate(cdp, "window.__productionDesktopRetry?.at(-1)?.force"), true);
    desktopProof.push(`State:${state}:last-valid+retry:context=${shellGeometry.context.left}:banner=${shellGeometry.banner.right}:retry=${shellGeometry.retry.right}:truth=${shellGeometry.truth.right}`);
    if (width <= 1280) {
      assert.equal(Math.round(shellGeometry.context.width), 58, `${state} medium fixture starts with the production collapsed Context width`);
      await trustedClick(cdp, ".appShell.kordynSystem > [data-shell-role='context-dock'] > header > button");
      await waitForExpression(cdp, "document.querySelector('.appShell.kordynSystem > [data-shell-role=\"context-dock\"]:not(.collapsed)')", `${state} medium Context expansion`);
      const openGeometry = await readDesktopStateGeometry(cdp, state);
      assert.equal(Math.round(openGeometry.context.width), 304, `${state} medium fixture expands to the production Context width`);
      assertStateSurfacesClearContext(state, openGeometry, "open");
      assert.equal(openGeometry.documentOverflow, false, `${state} open medium Context does not overflow the page`);
      desktopProof.push(`State:${state}:open-context=${openGeometry.context.left}:banner=${openGeometry.banner.right}:retry=${openGeometry.retry.right}:truth=${openGeometry.truth.right}`);
    }
  }

  const forbiddenUrl = new URL(mobileFixtureUrl);
  forbiddenUrl.searchParams.set("state", "forbidden");
  await setViewportAndNavigate(cdp, forbiddenUrl.href, 390, 844);
  await waitForExpression(cdp, "window.__productionMobileAppBrowserReady && document.querySelector('.mShell2.kordynSystem')", "forbidden MobileApp fixture");
  await waitForExpression(cdp, "document.querySelector('.workspaceState--forbidden')", "production permission boundary");
  assert.equal(await evaluate(cdp, "document.querySelector('.mShell2.kordynSystem')?.dataset.shellSelectedObject"), "none");

  const mobileStateProof = [];
  for (const [state, width, height] of [["stale", 390, 844], ["degraded", 430, 932]]) {
    const stateUrl = new URL(mobileFixtureUrl);
    stateUrl.searchParams.set("state", state);
    await setViewportAndNavigate(cdp, stateUrl.href, width, height);
    await waitForExpression(cdp, `window.__productionMobileAppBrowserReady && document.querySelector('[data-resource-state="${state}"] .mChatContent')`, `${state} MobileApp last-valid workspace`);
    const stateBoundary = await evaluate(cdp, `(() => {
      const boundary = document.querySelector('[data-resource-state="${state}"]');
      const content = boundary?.querySelector('.workspaceStateBoundary__lastValid');
      return { warning: Boolean(boundary?.querySelector('.workspaceState--warning')), inert: content?.hasAttribute('inert'), interaction: content?.dataset.lastValidInteraction, pointerEvents: getComputedStyle(content).pointerEvents };
    })()`);
    assert.deepEqual(stateBoundary, { warning: true, inert: true, interaction: "disabled", pointerEvents: "none" });
    await trustedClick(cdp, `[data-resource-state="${state}"] .workspaceState > button`);
    assert.equal(await evaluate(cdp, "window.__productionMobileEnsureCalls?.at(-1)?.[1]?.force"), true);
    mobileStateProof.push(`${width}x${height}:${state}:last-valid+retry`);
  }

  await setViewportAndNavigate(cdp, mobileFixtureUrl.href, 390, 844);
  await waitForExpression(cdp, "window.__productionMobileAppBrowserReady && document.querySelector('.mShell2.kordynSystem')", "production MobileApp fixture");
  await waitForExpression(cdp, "document.querySelector('.workspaceState--loading')", "production loader boundary");
  await waitForExpression(cdp, "document.querySelector('.mWorkspaceRail--ai')", "loaded MobileApp AI workspace");

  const mobileProof = ["Boundary:forbidden", ...mobileStateProof, "Loader:loading→loaded"];
  await trustedClick(cdp, ".mWorkspaceRail--ai > button", { index: 3 });
  await waitForObject(cdp, ".mShell2", "Event", "event-5");
  await clickObject(cdp, ".mShell2", "Event", "event-5");
  await assertMobileIdentity(cdp, "event-5", "Event", { inspector: ".mEventDays button.selected", scope: { workspaceId: "ai", sourceSection: "chat", route: "eventsTasks:events", objectEvidence: "evidence-ai-event", traceEvidence: "trace-event" } });
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
  const assertControlRail = async (width, height) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
    const controlRail = await evaluate(cdp, `(() => {
      const rail = document.querySelector('.mWorkspaceRail--control');
      const buttons = [...(rail?.querySelectorAll(':scope > button') || [])];
      const viewport = document.documentElement.clientWidth;
      return {
        labels: buttons.map((button) => button.textContent.trim()),
        activeCount: buttons.filter((button) => button.classList.contains('active')).length,
        activeLabel: buttons.find((button) => button.classList.contains('active'))?.textContent.trim(),
        hasNestedTabs: Boolean(document.querySelector('.mHub > .mHubTabs')),
        overflow: Math.max(0, ...buttons.map((button) => button.getBoundingClientRect().right - viewport)),
        minHeight: Math.min(...buttons.map((button) => button.getBoundingClientRect().height))
      };
    })()`);
    assert.deepEqual(controlRail.labels, ["态势", "事件", "边界", "规则"]);
    assert.equal(controlRail.activeCount, 1);
    assert.equal(controlRail.hasNestedTabs, false);
    assert.equal(controlRail.overflow, 0);
    assert.ok(controlRail.minHeight >= 44, `${width}x${height} Control rail touch target is below 44px`);
    return controlRail;
  };
  const controlDestinations = [
    { label: "态势", selector: ".mControlTruth", subPage: "none" },
    { label: "事件", selector: ".mEventRiskScreen", subPage: "events" },
    { label: "边界", selector: ".mControlSymbols", subPage: "boundaries" },
    { label: "规则", selector: ".mControlRuleList", subPage: "rules" }
  ];
  for (const [width, height] of [[390, 844], [430, 932]]) {
    for (const destination of controlDestinations) {
      await trustedClickText(cdp, ".mWorkspaceRail--control > button", destination.label);
      await waitForExpression(cdp, `(() => {
        const root = document.querySelector('.mShell2.kordynSystem');
        const buttons = [...document.querySelectorAll('.mWorkspaceRail--control > button')];
        const active = buttons.filter((button) => button.classList.contains('active'));
        return root?.dataset.shellRoute === 'riskHub'
          && root?.dataset.shellSubpage === ${JSON.stringify(destination.subPage)}
          && Boolean(document.querySelector(${JSON.stringify(destination.selector)}))
          && active.length === 1
          && active[0].textContent.trim() === ${JSON.stringify(destination.label)}
          && !document.querySelector('.mHub > .mHubTabs');
      })()`, `${width}x${height} Control ${destination.label} route, active state and production view`);
      const controlRail = await assertControlRail(width, height);
      assert.equal(controlRail.activeLabel, destination.label);
    }
  }
  await trustedClickText(cdp, ".mWorkspaceRail--control > button", "事件");
  await waitForExpression(cdp, "document.querySelector('.mEventRiskScreen') && [...document.querySelectorAll('.mWorkspaceRail--control > button')].find((button) => button.textContent.trim() === '事件')?.classList.contains('active')", "MobileApp Event Risk authoritative rail destination");
  await waitForObject(cdp, ".mShell2", "Event", "event-5");
  await clickObject(cdp, ".mShell2", "Event", "event-5");
  await assertMobileIdentity(cdp, "event-5", "Event", { inspector: ".mEventRiskInspector", scope: { workspaceId: "control", sourceSection: "riskCenter", route: "eventRisk", objectEvidence: "evidence-control-event", traceEvidence: "trace-risk-event" } });
  mobileProof.push("Control:trusted-single-rail:390+430:Posture→Events→Boundaries→Rules", "Control:Event:event-5");

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

  process.stdout.write(`production shell selection browser PASS desktop-authoritative=[${desktopProof.join(", ")}] mobile-production-component-fixture=[${mobileProof.join(", ")}]\n`);
} finally {
  cdp?.close();
  await stopProcess(chrome);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
