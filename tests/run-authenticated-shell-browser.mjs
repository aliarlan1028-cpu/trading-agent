import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

let appUrl = process.env.KORDYN_APP_URL ? new URL(process.env.KORDYN_APP_URL) : null;
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const managedServices = [];
let managedServiceRoot = null;

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
  const listeners = new Map();
  let requestId = 0;
  socket.on("message", (payload) => {
    const message = JSON.parse(payload.toString());
    if (!message.id && message.method) {
      for (const listener of listeners.get(message.method) || []) listener(message.params || {});
      return;
    }
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
    on(method, listener) {
      const handlers = listeners.get(method) || new Set();
      handlers.add(listener);
      listeners.set(method, handlers);
      return () => handlers.delete(listener);
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

function spawnManaged(command, args, options) {
  const output = [];
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  child.outputTail = () => output.join("").slice(-4_000);
  managedServices.push(child);
  return child;
}

async function startIsolatedProductionShell() {
  const [apiPort, vitePort] = await Promise.all([freePort(), freePort()]);
  managedServiceRoot = await mkdtemp(path.join("/tmp", "kordyn-authenticated-services-"));
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const webUrl = `http://127.0.0.1:${vitePort}/`;
  const backend = spawnManaged(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(apiPort), HOST: "127.0.0.1", NODE_ENV: "test", NODE_TEST_CONTEXT: "1",
      TEST_DATA_ROOT: managedServiceRoot, AUTH_REQUIRED: "false", ADMIN_PASSWORD: "", SECRETS_MASTER_KEY: "",
      APP_RELEASE: "authenticated-browser-server"
    }
  });
  try {
    await waitFor(`${apiUrl}/api/health`);
  } catch (error) {
    throw new Error(`Isolated KORDYN backend failed to start. ${backend.outputTail()}`, { cause: error });
  }
  const vite = spawnManaged(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(vitePort), VITE_API_PROXY_TARGET: apiUrl,
      VITE_APP_RELEASE: "authenticated-browser-client"
    }
  });
  try {
    await waitFor(webUrl);
  } catch (error) {
    throw new Error(`Isolated Vite product shell failed to start. ${vite.outputTail()}`, { cause: error });
  }
  process.stdout.write(`authenticated shell browser: isolated services ready backend=${apiUrl} app=${webUrl}\n`);
  return new URL(webUrl);
}

async function verifyProductionShellPreconditions(url) {
  const healthUrl = new URL("/api/health", url);
  const coreUrl = new URL("/api/bootstrap/core", url);
  const [health, core] = await Promise.all([fetch(healthUrl), fetch(coreUrl)]).catch((error) => {
    throw new Error(`Authenticated shell browser requires a reachable Vite proxy and KORDYN backend at ${url.href}. Run without KORDYN_APP_URL for the isolated self-contained environment.`, { cause: error });
  });
  if (!health.ok || !core.ok) {
    throw new Error(`Authenticated shell browser precondition failed: /api/health=${health.status}, /api/bootstrap/core=${core.status}. Run without KORDYN_APP_URL for an isolated AUTH_REQUIRED=false production shell.`);
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
}

async function waitForExpression(cdp, expression, label) {
  const deadline = Date.now() + 20_000;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function setViewport(cdp, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 900 });
  await cdp.send("Page.navigate", { url: appUrl.href });
  await waitForExpression(cdp, width <= 900 ? "document.querySelector('.mShell2.kordynSystem')" : "document.querySelector('.appShell.kordynSystem')", `${width}px authenticated product shell`);
}

async function clickPoint(cdp, point) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function trustedClick(cdp, selector) {
  await waitForExpression(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && (hit === target || target.contains(hit));
  })()`, `interactable click target ${selector}`);
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) throw new Error(${JSON.stringify(`Missing click target: ${selector}`)});
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await clickPoint(cdp, point);
}

async function trustedClickText(cdp, selector, label) {
  await waitForExpression(cdp, `(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.trim() === ${JSON.stringify(label)} || node.textContent.includes(${JSON.stringify(label)}));
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && (hit === target || target.contains(hit));
  })()`, `interactable click target ${selector} containing ${label}`);
  const point = await evaluate(cdp, `(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.trim() === ${JSON.stringify(label)} || node.textContent.includes(${JSON.stringify(label)}));
    if (!target) throw new Error(${JSON.stringify(`Missing click target ${selector} containing ${label}`)});
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await clickPoint(cdp, point);
}

function assertPrototypeStack(value, expected, label) {
  const normalized = String(value).replaceAll('"', "").replace(/\s+/g, " ").trim();
  assert.equal(normalized, expected, label);
}

async function readSurfaceContract(cdp, surfaceSelector, actionSelector = null) {
  return await evaluate(cdp, `(() => {
    const surface = document.querySelector(${JSON.stringify(surfaceSelector)});
    if (!surface) return null;
    const style = getComputedStyle(surface);
    const action = ${actionSelector ? `document.querySelector(${JSON.stringify(actionSelector)})` : "null"};
    const actionStyle = action ? getComputedStyle(action) : null;
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderTopWidth: style.borderTopWidth,
      borderTopStyle: style.borderTopStyle,
      borderTopColor: style.borderTopColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter || "none",
      minHeight: style.minHeight,
      action: actionStyle ? {
        backgroundColor: actionStyle.backgroundColor,
        color: actionStyle.color,
        borderTopWidth: actionStyle.borderTopWidth,
        borderTopStyle: actionStyle.borderTopStyle,
        borderTopColor: actionStyle.borderTopColor,
        borderRadius: actionStyle.borderRadius,
        minHeight: actionStyle.minHeight
      } : null
    };
  })()`);
}

function collectAuthenticatedSurfaceViolations(violations, label, surface, { shadowColor = "rgb(204, 255, 61)", requireAction = true } = {}) {
  const expect = (condition, detail) => { if (!condition) violations.push(`${label}: ${detail}`); };
  expect(Boolean(surface), "surface missing");
  if (!surface) return;
  expect(surface.backgroundColor === "rgb(244, 241, 233)", `Paper background expected, got ${surface.backgroundColor}`);
  expect(surface.color === "rgb(17, 19, 17)", `Ink foreground expected, got ${surface.color}`);
  expect(surface.borderTopWidth === "1px" && surface.borderTopStyle === "solid" && surface.borderTopColor === "rgb(17, 19, 17)", `1px Ink hard border expected, got ${surface.borderTopWidth} ${surface.borderTopStyle} ${surface.borderTopColor}`);
  expect(surface.borderRadius === "0px", `zero radius expected, got ${surface.borderRadius}`);
  expect(surface.backdropFilter === "none", `no blur expected, got ${surface.backdropFilter}`);
  expect(surface.boxShadow.includes("10px 10px 0px") && surface.boxShadow.includes(shadowColor), `10px hard offset ${shadowColor} expected, got ${surface.boxShadow}`);
  if (!requireAction) return;
  expect(Boolean(surface.action), "primary action missing");
  if (!surface.action) return;
  expect(surface.action.backgroundColor === "rgb(204, 255, 61)", `Acid CTA expected, got ${surface.action.backgroundColor}`);
  expect(surface.action.color === "rgb(17, 19, 17)", `Ink CTA label expected, got ${surface.action.color}`);
  expect(surface.action.borderTopWidth === "1px" && surface.action.borderTopStyle === "solid" && surface.action.borderTopColor === "rgb(17, 19, 17)", `1px Ink CTA border expected, got ${surface.action.borderTopWidth} ${surface.action.borderTopStyle} ${surface.action.borderTopColor}`);
  expect(surface.action.borderRadius === "0px", `zero-radius CTA expected, got ${surface.action.borderRadius}`);
  expect(Number.parseFloat(surface.action.minHeight) >= 44, `44px touch target expected, got ${surface.action.minHeight}`);
}

if (!appUrl) appUrl = await startIsolatedProductionShell();
await verifyProductionShellPreconditions(appUrl);
process.env.KORDYN_APP_URL = appUrl.href;

try {
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-authenticated-shell-"));
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-extensions",
  "--disable-gpu",
  "--no-default-browser-check",
  "--no-first-run",
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${profileDir}`,
  "about:blank"
], { stdio: "ignore" });

let cdp;
try {
  const visualViolations = [];
  await waitFor(appUrl.href);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);

  const bootstrapProof = [];
  for (const [width, height] of [[1440, 900], [1180, 820], [390, 844], [430, 932]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 900 });
    let resolveCoreRequest;
    const coreRequestPaused = new Promise((resolve) => { resolveCoreRequest = resolve; });
    const stopListeningForCore = cdp.on("Fetch.requestPaused", (params) => {
      if (params.request?.url.includes("/api/bootstrap/core")) resolveCoreRequest(params.requestId);
      else cdp.send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
    });
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*api/bootstrap/core*", requestStage: "Request" }] });
    const startupProbeUrl = new URL(appUrl);
    startupProbeUrl.searchParams.set("authenticated_state_probe", `${width}-${height}-${Date.now()}`);
    await cdp.send("Page.navigate", { url: startupProbeUrl.href });
    const coreRequestId = await coreRequestPaused;
    const startupSelector = ".authenticatedAppFrame.kordynSystem [data-authenticated-state='startup'] .authenticatedStatePanel";
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(startupSelector)})`, `${width}x${height} authenticated startup loading state`);
    const startupFont = await evaluate(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(startupSelector)})).fontFamily`);
    assertPrototypeStack(startupFont, "Inter, Helvetica Neue, Arial, sans-serif", `${width}x${height} authenticated startup loading prototype stack`);
    collectAuthenticatedSurfaceViolations(visualViolations, `${width}x${height} authenticated startup loading`, await readSurfaceContract(cdp, startupSelector), { requireAction: false });
    await cdp.send("Fetch.failRequest", { requestId: coreRequestId, errorReason: "Failed" });
    const connectionSelector = ".authenticatedAppFrame.kordynSystem .mobileConnectPanel";
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(connectionSelector)})`, `${width}x${height} authenticated connection failure state`);
    const connectionFont = await evaluate(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(connectionSelector)})).fontFamily`);
    assertPrototypeStack(connectionFont, "Inter, Helvetica Neue, Arial, sans-serif", `${width}x${height} authenticated connection failure prototype stack`);
    collectAuthenticatedSurfaceViolations(visualViolations, `${width}x${height} authenticated connection failure`, await readSurfaceContract(cdp, connectionSelector, `${connectionSelector} .primaryButton`));
    stopListeningForCore();
    await cdp.send("Fetch.disable");
    bootstrapProof.push(`${width}x${height}:startup→connection-failed`);
  }

  await setViewport(cdp, 1440, 900);
  process.stdout.write("authenticated shell browser: desktop mounted\n");
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.authenticatedAppFrame.kordynSystem > .appShell.kordynSystem'))"), true, "desktop product shell and its sibling overlays must share an authenticated Kordyn inheritance frame");
  await trustedClick(cdp, "[data-shell-role='workspace-rail'] nav > button:nth-child(5)");
  await waitForExpression(cdp, "document.querySelector('[data-product-workspace=\"operations\"] .opxServiceLedger header button')", "Operations production overview");
  await trustedClick(cdp, "[data-product-workspace='operations'] .opxServiceLedger header button");
  await waitForExpression(cdp, "document.querySelector('[data-product-workspace=\"operations\"] .opxRecoveryTruth > button')", "Operations production recovery action");
  await trustedClick(cdp, "[data-product-workspace='operations'] .opxRecoveryTruth > button");
  await waitForExpression(cdp, "document.querySelector('.cfmHead')", "authenticated ConfirmHost");
  process.stdout.write("authenticated shell browser: confirm mounted\n");
  const overlayFonts = await evaluate(cdp, `(() => {
    const frame = document.querySelector('.authenticatedAppFrame.kordynSystem');
    const confirm = getComputedStyle(document.querySelector('.cfmHead'));
    const inherited = getComputedStyle(frame);
    return {
      confirm: confirm.fontFamily,
      sans: inherited.getPropertyValue('--kordyn-sans').trim(),
      display: inherited.getPropertyValue('--kordyn-display').trim(),
      mono: inherited.getPropertyValue('--kordyn-mono').trim()
    };
  })()`);
  assertPrototypeStack(overlayFonts.confirm, "Inter, Helvetica Neue, Arial, sans-serif", "ConfirmHost must inherit the immutable prototype sans stack");
  assertPrototypeStack(overlayFonts.sans, "Inter, Helvetica Neue, Arial, sans-serif", "authenticated sans token");
  assertPrototypeStack(overlayFonts.display, "Avenir Next, Helvetica Neue, Arial, sans-serif", "authenticated display token");
  assertPrototypeStack(overlayFonts.mono, "SFMono-Regular, Roboto Mono, Space Mono, ui-monospace, monospace", "authenticated mono token");
  collectAuthenticatedSurfaceViolations(visualViolations, "authenticated ordinary ConfirmHost", await readSurfaceContract(cdp, ".authenticatedAppFrame.kordynSystem .cfmCard--ordinary", ".authenticatedAppFrame.kordynSystem .cfmOk"));
  assert.equal(await evaluate(cdp, "document.activeElement?.classList.contains('cfmCancel')"), true, "ordinary ConfirmHost initially focuses the safe cancel action");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
  await waitForExpression(cdp, "document.activeElement?.classList.contains('cfmOk')", "ordinary ConfirmHost Tab advances to confirm");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
  await waitForExpression(cdp, "document.activeElement?.classList.contains('cfmCancel')", "ordinary ConfirmHost Tab wraps inside dialog");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", modifiers: 8 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", modifiers: 8 });
  await waitForExpression(cdp, "document.activeElement?.classList.contains('cfmOk')", "ordinary ConfirmHost Shift+Tab wraps inside dialog");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
  await waitForExpression(cdp, "document.activeElement?.classList.contains('cfmCancel')", "ordinary ConfirmHost returns to safe cancel before Escape");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await waitForExpression(cdp, "!document.querySelector('.cfmCard')", "ordinary ConfirmHost Escape close");
  await waitForExpression(cdp, "document.activeElement?.matches('[data-product-workspace=\"operations\"] .opxRecoveryTruth > button')", "ordinary ConfirmHost focus return");

  await evaluate(cdp, "window.dispatchEvent(new Event('focus'))");
  await waitForExpression(cdp, "document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice')", "production release mismatch notice");
  const releaseFont = await evaluate(cdp, "getComputedStyle(document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice')).fontFamily");
  assertPrototypeStack(releaseFont, "Inter, Helvetica Neue, Arial, sans-serif", "ReleaseUpdateNotice must inherit the immutable prototype sans stack");
  collectAuthenticatedSurfaceViolations(visualViolations, "authenticated ReleaseUpdateNotice", await readSurfaceContract(cdp, ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice", ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice button"));

  const viewportProof = ["1440x900:desktop"];
  await setViewport(cdp, 1180, 820);
  await evaluate(cdp, "window.dispatchEvent(new Event('focus'))");
  await waitForExpression(cdp, "document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice')", "1180px production release mismatch notice");
  collectAuthenticatedSurfaceViolations(visualViolations, "1180x820 authenticated ReleaseUpdateNotice", await readSurfaceContract(cdp, ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice", ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice button"));
  viewportProof.push("1180x820:desktop");

  for (const [width, height] of [[390, 844], [430, 932]]) {
    await setViewport(cdp, width, height);
    await evaluate(cdp, "window.dispatchEvent(new Event('focus'))");
    await waitForExpression(cdp, "document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice')", `${width}px production release mismatch notice`);
    collectAuthenticatedSurfaceViolations(visualViolations, `${width}x${height} authenticated ReleaseUpdateNotice`, await readSurfaceContract(cdp, ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice", ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice button"));
    process.stdout.write(`authenticated shell browser: ${width}x${height} mounted\n`);
    const geometry = await evaluate(cdp, `(() => {
      const tools = document.querySelector('.mShellTools');
      const tab = document.querySelector('.mNativeTabbar');
      const buttons = [...tools.querySelectorAll(':scope > .mShellToolButton')];
      const rect = (node) => { const value = node.getBoundingClientRect(); return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height }; };
      return { tools: rect(tools), tab: rect(tab), buttons: buttons.map(rect), scrollWidth: tools.scrollWidth, clientWidth: tools.clientWidth, scrollHeight: tools.scrollHeight, clientHeight: tools.clientHeight };
    })()`);
    process.stdout.write(`authenticated shell browser geometry ${width}x${height} ${JSON.stringify(geometry)}\n`);
    assert.equal(geometry.buttons.length, 3, `${width}px exposes Objects, Context and Trace exactly once`);
    assert.ok(geometry.buttons.every((button) => Math.abs(button.top - geometry.buttons[0].top) < 0.5 && Math.abs(button.bottom - geometry.buttons[0].bottom) < 0.5), `${width}px keeps all three tools in one row`);
    assert.ok(geometry.buttons.every((button) => button.height >= 44), `${width}px keeps every tool target at least 44px high`);
    assert.ok(geometry.buttons.at(-1).right <= geometry.tools.right + 0.5, `${width}px tools stay inside the row horizontally`);
    assert.ok(geometry.buttons[0].bottom <= geometry.tab.top + 0.5, `${width}px tools do not intrude into the tab bar`);
    assert.ok(geometry.scrollWidth <= geometry.clientWidth && geometry.scrollHeight <= geometry.clientHeight, `${width}px tool row does not overflow`);
    viewportProof.push(`${width}x${height}:${geometry.buttons.map((button) => `${button.width}x${button.height}`).join('/')}`);

    if (width === 390) {
      const stopListeningForUpdatedRelease = cdp.on("Fetch.requestPaused", (params) => {
        if (!params.request?.url.includes("/api/health?release_check=")) {
          cdp.send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
          return;
        }
        cdp.send("Fetch.fulfillRequest", {
          requestId: params.requestId,
          responseCode: 200,
          responseHeaders: [{ name: "Content-Type", value: "application/json" }],
          body: Buffer.from(JSON.stringify({ release: "authenticated-browser-client" })).toString("base64")
        }).catch(() => {});
      });
      await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*api/health?release_check=*", requestStage: "Request" }] });
      await trustedClick(cdp, ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice button");
      await waitForExpression(cdp, "document.querySelector('.mShell2.kordynSystem') && !document.querySelector('.releaseUpdateNotice')", "production MobileApp after release refresh");
      await evaluate(cdp, "window.dispatchEvent(new Event('focus'))");
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.releaseUpdateNotice'))"), false, "release refresh converges the production client/server version before work resumes");
      await trustedClick(cdp, ".mNativeTabbar > button:nth-child(5)");
      await waitForExpression(cdp, "document.querySelector('.mDrawer')", "production MobileApp More drawer");
      await trustedClickText(cdp, ".mDrawerItem", "运行与恢复");
      await waitForExpression(cdp, "document.querySelector('.mOperationsNative .mOpsRail')", "production MobileApp Operations");
      const recoveryInteraction = await evaluate(cdp, `(() => {
        const target = [...document.querySelectorAll('.mOpsRail > button')].find((node) => node.textContent.includes('恢复'));
        target?.scrollIntoView({ block: 'center', inline: 'center' });
        const rect = target?.getBoundingClientRect();
        const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
        const rail = document.querySelector('.mOpsRail');
        const notice = document.querySelector('.releaseUpdateNotice')?.getBoundingClientRect();
        const overlaps = rect && notice ? !(notice.right <= rect.left || notice.left >= rect.right || notice.bottom <= rect.top || notice.top >= rect.bottom) : false;
        return { hitTarget: hit === target || target?.contains(hit), overlaps, rail: rail && { scrollWidth: rail.scrollWidth, clientWidth: rail.clientWidth } };
      })()`);
      assert.equal(recoveryInteraction.overlaps, false, "release refresh restores unobstructed MobileApp Operations controls");
      assert.equal(recoveryInteraction.hitTarget, true, "MobileApp Recovery remains a trusted touch target after release refresh");
      assert.equal(recoveryInteraction.rail.scrollWidth, recoveryInteraction.rail.clientWidth, "MobileApp Operations rail remains contained at 390px");
      await trustedClickText(cdp, ".mOpsRail > button", "恢复");
      await waitForExpression(cdp, "document.querySelector('.mOpsRecoveryTruth > button')", "production MobileApp reconciliation action");
      await trustedClick(cdp, ".mOpsRecoveryTruth > button");
      await waitForExpression(cdp, "document.querySelector('.cfmCard--ordinary')", "production MobileApp ordinary ConfirmHost");
      collectAuthenticatedSurfaceViolations(visualViolations, "390x844 production MobileApp ordinary ConfirmHost", await readSurfaceContract(cdp, ".authenticatedAppFrame.kordynSystem .cfmCard--ordinary", ".authenticatedAppFrame.kordynSystem .cfmOk"));
      assert.equal(await evaluate(cdp, "document.activeElement?.classList.contains('cfmCancel')"), true, "MobileApp ordinary ConfirmHost initially focuses cancel");
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
      await waitForExpression(cdp, "document.activeElement?.classList.contains('cfmOk')", "MobileApp ordinary ConfirmHost Tab advances to confirm");
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
      await waitForExpression(cdp, "document.activeElement?.classList.contains('cfmCancel')", "MobileApp ordinary ConfirmHost Tab wraps inside dialog");
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", modifiers: 8 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", modifiers: 8 });
      await waitForExpression(cdp, "document.activeElement?.classList.contains('cfmOk')", "MobileApp ordinary ConfirmHost Shift+Tab wraps inside dialog");
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
      await waitForExpression(cdp, "document.activeElement?.classList.contains('cfmCancel')", "MobileApp ordinary ConfirmHost returns to safe cancel before Escape");
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
      await waitForExpression(cdp, "!document.querySelector('.cfmCard')", "MobileApp ordinary ConfirmHost Escape close");
      await waitForExpression(cdp, "document.activeElement?.matches('.mOpsRecoveryTruth > button')", "MobileApp ordinary ConfirmHost focus return");
      stopListeningForUpdatedRelease();
      await cdp.send("Fetch.disable");
    }
  }

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  let resolvePublicCore;
  let resolvePublicReleaseCheck;
  const publicCorePaused = new Promise((resolve) => { resolvePublicCore = resolve; });
  const publicReleaseCheckPaused = new Promise((resolve) => { resolvePublicReleaseCheck = resolve; });
  const stopListeningForPublicCore = cdp.on("Fetch.requestPaused", (params) => {
    if (params.request?.url.includes("/api/bootstrap/core")) resolvePublicCore(params.requestId);
    else if (params.request?.url.includes("/api/health?release_check=")) resolvePublicReleaseCheck(params.requestId);
    else cdp.send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
  });
  await cdp.send("Fetch.enable", { patterns: [
    { urlPattern: "*api/bootstrap/core*", requestStage: "Request" },
    { urlPattern: "*api/health?release_check=*", requestStage: "Request" }
  ] });
  const publicUrl = new URL(appUrl);
  publicUrl.searchParams.set("public_scope_probe", String(Date.now()));
  await cdp.send("Page.navigate", { url: publicUrl.href });
  const publicCoreRequestId = await publicCorePaused;
  await cdp.send("Fetch.fulfillRequest", { requestId: publicCoreRequestId, responseCode: 401, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from('{"error":"auth_required"}').toString("base64") });
  await waitForExpression(cdp, "document.querySelector('.publicAppFrame .lpRoot')", "real public login and marketing route");
  await new Promise((resolve) => setTimeout(resolve, 100));
  await evaluate(cdp, "window.dispatchEvent(new Event('focus'))");
  const publicReleaseRequestId = await publicReleaseCheckPaused;
  await cdp.send("Fetch.fulfillRequest", { requestId: publicReleaseRequestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from('{"release":"authenticated-browser-server"}').toString("base64") });
  await waitForExpression(cdp, "document.querySelector('.publicAppFrame .releaseUpdateNotice')", "public production release mismatch notice");
  assert.equal(await evaluate(cdp, "document.querySelector('.publicAppFrame').classList.contains('kordynSystem')"), false, "login and marketing inheritance must not be opted into the authenticated Kordyn scope");
  assert.match(await evaluate(cdp, "getComputedStyle(document.querySelector('.publicAppFrame .releaseUpdateNotice')).fontFamily"), /Space Grotesk|Public Sans/, "public overlay keeps the existing public font inheritance");
  assert.deepEqual(await readSurfaceContract(cdp, ".publicAppFrame .releaseUpdateNotice", ".publicAppFrame .releaseUpdateNotice button"), {
    backgroundColor: "rgba(255, 252, 246, 0.97)", color: "rgb(38, 33, 26)", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "rgba(180, 122, 39, 0.28)", borderRadius: "14px", boxShadow: "rgba(44, 31, 15, 0.18) 0px 12px 36px 0px", backdropFilter: "blur(12px)", minHeight: "0px",
    action: { backgroundColor: "rgb(216, 90, 29)", color: "rgb(255, 255, 255)", borderTopWidth: "0px", borderTopStyle: "none", borderTopColor: "rgb(255, 255, 255)", borderRadius: "10px", minHeight: "36px" }
  }, "public login and marketing release notice must retain its pre-existing visual contract");
  stopListeningForPublicCore();
  await cdp.send("Fetch.disable");

  if (visualViolations.length) {
    process.stderr.write(`authenticated shell visual contract RED ${visualViolations.length} violation(s)\n${visualViolations.map((item) => `- ${item}`).join("\n")}\n`);
  }
  assert.equal(visualViolations.length, 0, `authenticated shell visual contract has ${visualViolations.length} violation(s)`);
  process.stdout.write(`authenticated shell browser contract PASS ${appUrl.href} bootstrap=[${bootstrapProof.join(", ")}] viewports=[${viewportProof.join(', ')}] release=production-mismatch confirm=desktop+MobileApp public=unchanged\n`);
} finally {
  cdp?.close();
  await stopProcess(chrome);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

} finally {
  for (const child of managedServices.reverse()) await stopProcess(child);
  if (managedServiceRoot) await rm(managedServiceRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
