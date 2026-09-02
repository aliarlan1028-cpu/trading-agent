import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

let appUrl = process.env.KORDYN_APP_URL ? new URL(process.env.KORDYN_APP_URL) : null;
const externalAppUrl = Boolean(appUrl);
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const entryOutputDir = process.env.KORDYN_AUTH_ENTRY_OUTPUT_DIR ? path.resolve(process.env.KORDYN_AUTH_ENTRY_OUTPUT_DIR) : null;
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
      VITE_APP_RELEASE: "authenticated-browser-client",
      VITE_ALLOW_KORDYN_V2_PREVIEW: "true"
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

async function waitForSignal(signal, label, timeoutMs = 20_000) {
  let timeoutId;
  try {
    return await Promise.race([
      signal,
      new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

let expectedAuthenticatedMode = "legacy";

async function setViewport(cdp, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 900 });
  await cdp.send("Page.navigate", { url: appUrl.href });
  try {
    const shellExpression = expectedAuthenticatedMode === "v2"
      ? width <= 900
        ? "document.querySelector('.authenticatedAppFrame.kordynSystem > [data-kordyn-v2-root=\"mobile\"]')"
        : "document.querySelector('.authenticatedAppFrame.kordynSystem > [data-kordyn-v2-root=\"desktop\"]')"
      : width <= 900
        ? "document.querySelector('.authenticatedAppFrame.kordynSystem > .mShell2[data-classic-mobile-shell=\"true\"]')"
        : "document.querySelector('.authenticatedAppFrame.kordynSystem > .appShell[data-classic-shell=\"desktop\"]')";
    await waitForExpression(cdp, shellExpression, `${width}px ${expectedAuthenticatedMode} authenticated product shell`);
  } catch (error) {
    const state = await evaluate(cdp, `({
      href: location.href,
      title: document.title,
      startup: Boolean(document.querySelector('[data-authenticated-state]')),
      connection: Boolean(document.querySelector('.mobileConnectPanel')),
      publicSurface: Boolean(document.querySelector('.publicAppFrame .lpRoot')),
      text: document.body.innerText.slice(0, 240),
      styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.href)
    })`);
    throw new Error(`${error.message}; state=${JSON.stringify(state)}`, { cause: error });
  }
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

async function clickMarketingIframeAction(cdp, action) {
  const selector = `[data-action="${action}"]`;
  await waitForExpression(cdp, `(() => {
    const frame = document.querySelector('.lpFrame');
    return frame?.contentDocument?.readyState === 'complete' && frame.contentDocument.querySelector(${JSON.stringify(selector)});
  })()`, `real marketing iframe ${action} action`);
  await evaluate(cdp, `document.querySelector('.lpFrame').contentDocument.querySelector(${JSON.stringify(selector)}).click()`);
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

function assertFontStack(value, expected, label) {
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
      backgroundImage: style.backgroundImage,
      color: style.color,
      borderTopWidth: style.borderTopWidth,
      borderTopStyle: style.borderTopStyle,
      borderTopColor: style.borderTopColor,
      borderRadius: style.borderRadius,
      boxShadow: style.boxShadow,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter || "none",
      position: style.position,
      zIndex: style.zIndex,
      display: style.display,
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

async function captureEntryState(cdp, name) {
  if (!entryOutputDir) return;
  await mkdir(entryOutputDir, { recursive: true });
  const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true });
  await writeFile(path.join(entryOutputDir, `${name}.png`), Buffer.from(shot.data, "base64"));
}

function collectV2AuthenticatedSurfaceViolations(violations, label, surface, { requireAction = true } = {}) {
  const expect = (condition, detail) => { if (!condition) violations.push(`${label}: ${detail}`); };
  expect(Boolean(surface), "surface missing");
  if (!surface) return;
  expect(surface.backgroundColor === "rgb(9, 19, 33)", `V2 field background expected, got ${surface.backgroundColor}`);
  expect(surface.color === "rgb(242, 246, 253)", `V2 light foreground expected, got ${surface.color}`);
  expect(surface.borderTopWidth === "1px" && surface.borderTopStyle === "solid" && surface.borderTopColor === "rgba(135, 164, 205, 0.34)", `V2 strong border expected, got ${surface.borderTopWidth} ${surface.borderTopStyle} ${surface.borderTopColor}`);
  expect(surface.borderRadius === "18px", `18px V2 dialog radius expected, got ${surface.borderRadius}`);
  expect(surface.backdropFilter === "none", `no blur expected, got ${surface.backdropFilter}`);
  expect(surface.boxShadow.includes("0px 28px 90px"), `V2 deep dialog shadow expected, got ${surface.boxShadow}`);
  if (!requireAction) return;
  expect(Boolean(surface.action), "primary action missing");
  if (!surface.action) return;
  expect(surface.action.backgroundColor === "rgb(52, 120, 255)", `V2 cobalt CTA expected, got ${surface.action.backgroundColor}`);
  expect(surface.action.color === "rgb(255, 255, 255)", `V2 white CTA label expected, got ${surface.action.color}`);
  expect(surface.action.borderTopWidth === "1px" && surface.action.borderTopStyle === "solid" && surface.action.borderTopColor === "rgba(52, 120, 255, 0.56)", `V2 cobalt CTA border expected, got ${surface.action.borderTopWidth} ${surface.action.borderTopStyle} ${surface.action.borderTopColor}`);
  expect(surface.action.borderRadius === "12px", `12px V2 CTA radius expected, got ${surface.action.borderRadius}`);
  expect(Number.parseFloat(surface.action.minHeight) >= 44, `44px touch target expected, got ${surface.action.minHeight}`);
}

function collectV2ReleaseSurfaceViolations(violations, label, surface) {
  const expect = (condition, detail) => { if (!condition) violations.push(`${label}: ${detail}`); };
  expect(Boolean(surface), "surface missing");
  if (!surface) return;
  expect(surface.position === "fixed" && surface.zIndex === "1000" && surface.display === "flex", `fixed V2 overlay layer expected, got ${surface.position}/${surface.zIndex}/${surface.display}`);
  expect(surface.backgroundImage.includes("rgb(13, 24, 39)") && surface.backgroundImage.includes("rgb(5, 13, 25)"), `V2 dark gradient expected, got ${surface.backgroundImage}`);
  expect(surface.color === "rgb(242, 246, 253)", `V2 light foreground expected, got ${surface.color}`);
  expect(surface.borderTopWidth === "1px" && surface.borderTopStyle === "solid" && surface.borderTopColor === "rgba(135, 164, 205, 0.28)", `V2 release border expected, got ${surface.borderTopWidth} ${surface.borderTopStyle} ${surface.borderTopColor}`);
  expect(surface.borderRadius === "12px", `12px V2 release radius expected, got ${surface.borderRadius}`);
  expect(surface.boxShadow.includes("0px 18px 48px"), `V2 release depth expected, got ${surface.boxShadow}`);
  expect(Boolean(surface.action), "release action missing");
  if (!surface.action) return;
  expect(surface.action.backgroundColor === "rgb(52, 120, 255)", `V2 release cobalt action expected, got ${surface.action.backgroundColor}`);
  expect(surface.action.color === "rgb(3, 9, 20)", `V2 release contrast-safe ink expected, got ${surface.action.color}`);
  expect(surface.action.borderTopWidth === "1px" && surface.action.borderTopStyle === "solid" && surface.action.borderTopColor === "rgb(106, 153, 255)", `V2 release action border expected, got ${surface.action.borderTopWidth} ${surface.action.borderTopStyle} ${surface.action.borderTopColor}`);
  expect(surface.action.borderRadius === "9px", `9px V2 release action radius expected, got ${surface.action.borderRadius}`);
  expect(Number.parseFloat(surface.action.minHeight) >= 44, `44px release touch target expected, got ${surface.action.minHeight}`);
}

function collectAugust15EntrySurfaceViolations(violations, label, surface, { release = false, requireAction = false } = {}) {
  const expect = (condition, detail) => { if (!condition) violations.push(`${label}: ${detail}`); };
  expect(Boolean(surface), "surface missing");
  if (!surface) return;
  const warmBackground = release
    ? surface.backgroundColor.startsWith("rgba(255, 252, 246")
    : surface.backgroundColor.startsWith("rgba(255, 253, 249") || surface.backgroundColor === "rgb(255, 253, 249)";
  expect(warmBackground, `warm ivory background expected, got ${surface.backgroundColor}`);
  expect(["rgb(38, 33, 26)", "rgb(30, 27, 22)", "rgb(23, 21, 18)"].includes(surface.color), `warm ink foreground expected, got ${surface.color}`);
  expect(surface.borderTopWidth === "1px" && surface.borderTopStyle === "solid", `one-pixel warm border expected, got ${surface.borderTopWidth} ${surface.borderTopStyle}`);
  expect(release ? surface.borderRadius === "14px" : ["20px", "28px"].includes(surface.borderRadius), `${release ? "14" : "20/28"}px August 15 radius expected, got ${surface.borderRadius}`);
  expect(surface.backdropFilter.includes("blur"), `soft August 15 depth expected, got ${surface.backdropFilter}`);
  expect(surface.boxShadow !== "none" && !surface.boxShadow.includes("10px 10px 0px"), `soft shadow expected instead of hard offset, got ${surface.boxShadow}`);
  if (!requireAction) return;
  expect(Boolean(surface.action), "primary action missing");
  if (!surface.action) return;
  expect(["rgb(231, 120, 47)", "rgb(208, 106, 34)"].includes(surface.action.backgroundColor), `orange primary action expected, got ${surface.action.backgroundColor}`);
  expect(surface.action.color === "rgb(255, 255, 255)", `white primary action label expected, got ${surface.action.color}`);
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

  entryLifecycleValidation: {
  const bootstrapProof = [];
  for (const [width, height] of [[1440, 900], [1180, 820], [390, 844], [430, 932]]) {
    process.stdout.write(`authenticated shell browser: probing ${width}x${height} startup\n`);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 900 });
    let resolveInitialCoreRequest;
    let resolveAuthenticatedCoreRequest;
    let resolveLoginRequest;
    let failCoreRequests = false;
    let coreRequestCount = 0;
    const initialCoreRequestPaused = new Promise((resolve) => { resolveInitialCoreRequest = resolve; });
    const authenticatedCoreRequestPaused = new Promise((resolve) => { resolveAuthenticatedCoreRequest = resolve; });
    const loginRequestPaused = new Promise((resolve) => { resolveLoginRequest = resolve; });
    const stopListeningForCore = cdp.on("Fetch.requestPaused", (params) => {
      if (params.request?.url.includes("/api/bootstrap/core")) {
        coreRequestCount += 1;
        if (coreRequestCount === 1) resolveInitialCoreRequest(params.requestId);
        else resolveAuthenticatedCoreRequest(params.requestId);
        if (failCoreRequests) cdp.send("Fetch.failRequest", { requestId: params.requestId, errorReason: "Failed" }).catch(() => {});
      }
      else if (params.request?.url.includes("/api/auth/login")) resolveLoginRequest(params.requestId);
      else cdp.send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
    });
    await cdp.send("Fetch.enable", { patterns: [
      { urlPattern: "*api/bootstrap/core*", requestStage: "Request" },
      { urlPattern: "*api/auth/login*", requestStage: "Request" }
    ] });
    const startupProbeUrl = new URL(appUrl);
    startupProbeUrl.searchParams.set("authenticated_state_probe", `${width}-${height}-${Date.now()}`);
    await cdp.send("Page.navigate", { url: startupProbeUrl.href });
    const initialCoreRequestId = await waitForSignal(initialCoreRequestPaused, `${width}x${height} unresolved-session core request`);
    const publicSelector = ".publicAppFrame .lpRoot";
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(publicSelector)})`, `${width}x${height} public marketing while session is unresolved`);
    assert.equal(await evaluate(cdp, "Boolean(document.querySelector('[data-authenticated-state=\"startup\"]'))"), false, `${width}x${height} unresolved web session must not cover marketing with the authenticated startup screen`);
    await captureEntryState(cdp, `public-unresolved-${width}x${height}`);
    await cdp.send("Fetch.fulfillRequest", {
      requestId: initialCoreRequestId,
      responseCode: 401,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from('{"error":"auth_required"}').toString("base64")
    });
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(publicSelector)})`, `${width}x${height} public marketing after guest session result`);
    await clickMarketingIframeAction(cdp, "login");
    await waitForExpression(cdp, "document.querySelector('.lpLoginForm')", `${width}x${height} real public login form`);
    await evaluate(cdp, "document.querySelector('.lpLoginForm').requestSubmit()");
    const loginRequestId = await waitForSignal(loginRequestPaused, `${width}x${height} web login request`);
    await cdp.send("Fetch.fulfillRequest", {
      requestId: loginRequestId,
      responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from('{"ok":true}').toString("base64")
    });
    const authenticatedCoreRequestId = await waitForSignal(authenticatedCoreRequestPaused, `${width}x${height} authenticated startup core request`);
    const startupSelector = ".authenticatedAppFrame.kordynSystem [data-authenticated-state='startup'] .authenticatedStatePanel";
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(startupSelector)})`, `${width}x${height} authenticated startup loading state`);
    const startupFont = await evaluate(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(startupSelector)})).fontFamily`);
    assertFontStack(startupFont, "Public Sans, Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif", `${width}x${height} zero-base authenticated startup font stack`);
    collectAugust15EntrySurfaceViolations(visualViolations, `${width}x${height} authenticated startup loading`, await readSurfaceContract(cdp, startupSelector));
    await captureEntryState(cdp, `startup-${width}x${height}`);
    failCoreRequests = true;
    await cdp.send("Fetch.failRequest", { requestId: authenticatedCoreRequestId, errorReason: "Failed" });
    const connectionSelector = ".authenticatedAppFrame.kordynSystem .mobileConnectPanel";
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(connectionSelector)})`, `${width}x${height} authenticated connection failure state`);
    const connectionFont = await evaluate(cdp, `getComputedStyle(document.querySelector(${JSON.stringify(connectionSelector)})).fontFamily`);
    assertFontStack(connectionFont, "Space Grotesk, Public Sans, Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif", `${width}x${height} August 15 authenticated connection failure product font stack`);
    collectAugust15EntrySurfaceViolations(visualViolations, `${width}x${height} authenticated connection failure`, await readSurfaceContract(cdp, connectionSelector, `${connectionSelector} .primaryButton`), { requireAction: true });
    await captureEntryState(cdp, `connection-failed-${width}x${height}`);
    stopListeningForCore();
    await cdp.send("Fetch.disable");
    bootstrapProof.push(`${width}x${height}:public-unresolved→startup→connection-failed`);
  }

  if (process.env.KORDYN_AUTH_ENTRY_ONLY === "true") {
    if (visualViolations.length) throw new Error(`August 15 entry visual contract has ${visualViolations.length} violation(s):\n${visualViolations.join("\n")}`);
    process.stdout.write(`authenticated entry browser contract PASS bootstrap=[${bootstrapProof.join(", ")}] output=${entryOutputDir || "disabled"}\n`);
    break entryLifecycleValidation;
  }

  await evaluate(cdp, "sessionStorage.setItem('kordyn_ui_version', 'v2')");
  expectedAuthenticatedMode = "v2";
  try {
    await setViewport(cdp, 1440, 900);
  } catch (error) {
    if (externalAppUrl) {
      throw new Error("External KORDYN_APP_URL must be built with VITE_ALLOW_KORDYN_V2_PREVIEW=true so the runner can validate legacy entry → v2 authenticated contracts.", { cause: error });
    }
    throw error;
  }
  process.stdout.write("authenticated shell browser: legacy entry → v2 authenticated contracts; desktop mounted\n");
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.authenticatedAppFrame.kordynSystem > [data-kordyn-v2-root=\"desktop\"]'))"), true, "desktop product shell and its sibling overlays must share an authenticated Kordyn inheritance frame");
  const desktopFoundation = await evaluate(cdp, `(() => {
    const shell = document.querySelector('[data-kordyn-v2-shell="desktop"]');
    const tools = [...shell.querySelectorAll('[data-kordyn-v2-context-trigger],[data-kordyn-v2-proof-trigger],[data-kordyn-v2-ai-support-trigger]')];
    return {
      document: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
      shell: [shell.clientWidth, shell.scrollWidth],
      tools: tools.map((node) => node.hasAttribute('data-kordyn-v2-context-trigger') ? 'Context' : node.hasAttribute('data-kordyn-v2-proof-trigger') ? 'Proof' : 'AI support')
    };
  })()`);
  assert.deepEqual(desktopFoundation.document, [1440, 1440], "1440px V2 desktop has no document overflow");
  assert.ok(desktopFoundation.shell[1] <= desktopFoundation.shell[0] + 1, "1440px V2 desktop shell has no horizontal overflow");
  assert.deepEqual(desktopFoundation.tools, ["Context", "Proof", "AI support"], "current V2 maps the former Objects/Context/Trace rail to selected-object Context, Proof and read-only AI support");

  await trustedClick(cdp, "[data-kordyn-v2-context-trigger]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"context\"]')?.contains(document.activeElement)", "V2 Context overlay focus");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
  assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"context\"]')?.contains(document.activeElement)"), true, "V2 Context traps focus");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-overlay]') && document.activeElement === document.querySelector('[data-kordyn-v2-context-trigger]')", "V2 Context Escape close and focus return");

  await trustedClick(cdp, "[data-kordyn-v2-ai-support-trigger]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-support-panel]')?.contains(document.activeElement)", "V2 AI support overlay focus");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-ai-support-panel]') && document.activeElement === document.querySelector('[data-kordyn-v2-ai-support-trigger]')", "V2 AI support Escape close and focus return");

  await trustedClick(cdp, "[data-kordyn-v2-domain-target=governance]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=\"desktop\"]')?.dataset.kordynV2Domain === 'governance'", "V2 Governance domain");
  await trustedClick(cdp, "[data-kordyn-v2-workspace-target=recovery]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-governance-workspace=\"recovery\"]')", "V2 Governance recovery workspace");
  await trustedClick(cdp, ".kordynV2RecoveryActions > button:nth-of-type(1)");
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
  assertFontStack(overlayFonts.confirm, "Inter, Helvetica Neue, Arial, sans-serif", "ConfirmHost zero-base product sans stack");
  assertFontStack(overlayFonts.sans, "Inter, Helvetica Neue, Arial, sans-serif", "authenticated product sans token");
  assertFontStack(overlayFonts.display, "Avenir Next, Helvetica Neue, Arial, sans-serif", "authenticated product display token");
  assertFontStack(overlayFonts.mono, "SFMono-Regular, Roboto Mono, Space Mono, ui-monospace, monospace", "authenticated product mono token");
  collectV2AuthenticatedSurfaceViolations(visualViolations, "authenticated ordinary ConfirmHost", await readSurfaceContract(cdp, ".authenticatedAppFrame.kordynSystem .cfmCard--ordinary", ".authenticatedAppFrame.kordynSystem .cfmOk"));
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
  await waitForExpression(cdp, "document.activeElement?.matches('.kordynV2RecoveryActions > button:nth-of-type(1)')", "ordinary ConfirmHost focus return");

  await evaluate(cdp, "window.dispatchEvent(new Event('focus'))");
  await waitForExpression(cdp, "document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice')", "production release mismatch notice");
  const releaseFont = await evaluate(cdp, "getComputedStyle(document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice')).fontFamily");
  assertFontStack(releaseFont, "Inter, Helvetica Neue, Arial, sans-serif", "ReleaseUpdateNotice zero-base product sans stack");
  collectV2ReleaseSurfaceViolations(visualViolations, "authenticated ReleaseUpdateNotice", await readSurfaceContract(cdp, ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice", ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice button"));

  const viewportProof = ["1440x900:desktop,tools=Context/Proof/AI-support,overflow=0"];
  await setViewport(cdp, 1180, 820);
  const desktop1180Overflow = await evaluate(cdp, "document.documentElement.scrollWidth-document.documentElement.clientWidth");
  assert.equal(desktop1180Overflow, 0, "1180px V2 desktop has no horizontal overflow");
  await evaluate(cdp, "window.dispatchEvent(new Event('focus'))");
  await waitForExpression(cdp, "document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice')", "1180px production release mismatch notice");
  collectV2ReleaseSurfaceViolations(visualViolations, "1180x820 authenticated ReleaseUpdateNotice", await readSurfaceContract(cdp, ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice", ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice button"));
  viewportProof.push("1180x820:desktop,overflow=0");

  for (const [width, height] of [[390, 844], [430, 932]]) {
    await setViewport(cdp, width, height);
    process.stdout.write(`authenticated shell browser: ${width}x${height} mounted\n`);
    const geometry = await evaluate(cdp, `(() => {
      const shell = document.querySelector('[data-kordyn-v2-shell="mobile"]');
      const nav = shell.querySelector('[data-kordyn-v2-mobile-navigation]');
      const visibleButtons = [...shell.querySelectorAll('button:not([disabled])')].filter((node) => node.getClientRects().length && !node.closest('[inert]'));
      return {
        document: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
        shell: [shell.clientWidth, shell.scrollWidth],
        navCount: nav.querySelectorAll(':scope > button').length,
        supportCount: shell.querySelectorAll('[data-kordyn-v2-ai-support-trigger]').length,
        evidenceCount: shell.querySelectorAll('[data-kordyn-v2-context-trigger],[data-kordyn-v2-proof-trigger]').length,
        selectedId: shell.dataset.kordynV2SelectedId,
        undersized: visibleButtons.map((node) => { const rect=node.getBoundingClientRect(); return { label:node.textContent.trim().slice(0,30), width:rect.width, height:rect.height }; }).filter((row) => row.width < 44 || row.height < 44)
      };
    })()`);
    process.stdout.write(`authenticated shell browser geometry ${width}x${height} ${JSON.stringify(geometry)}\n`);
    assert.deepEqual(geometry.document, [width, width], `${width}px V2 mobile has no document overflow`);
    assert.ok(geometry.shell[1] <= geometry.shell[0] + 1, `${width}px V2 mobile shell has no horizontal overflow`);
    assert.equal(geometry.navCount, 4, `${width}px exposes four distinct current V2 domain destinations`);
    assert.equal(geometry.supportCount, 1, `${width}px exposes one read-only AI support entry`);
    assert.equal(geometry.evidenceCount, geometry.selectedId === "none" ? 0 : 2, `${width}px only exposes Context and Proof when a canonical object is selected`);
    assert.deepEqual(geometry.undersized, [], `${width}px keeps visible mobile controls at least 44x44`);

    await trustedClick(cdp, "[data-kordyn-v2-ai-support-trigger]");
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet=\"support\"]')?.contains(document.activeElement)", `${width}px V2 AI support sheet focus`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab" });
    assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet=\"support\"]')?.contains(document.activeElement)"), true, `${width}px V2 AI support sheet traps focus`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
    await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-mobile-sheet]') && document.activeElement === document.querySelector('[data-kordyn-v2-ai-support-trigger]')", `${width}px V2 AI support Escape close and focus return`);

    await evaluate(cdp, "window.dispatchEvent(new Event('focus'))");
    await waitForExpression(cdp, "document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice')", `${width}px production release mismatch notice`);
    collectV2ReleaseSurfaceViolations(visualViolations, `${width}x${height} authenticated ReleaseUpdateNotice`, await readSurfaceContract(cdp, ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice", ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice button"));
    viewportProof.push(`${width}x${height}:mobile,nav=4,support=1,evidence=${geometry.evidenceCount},overflow=0,targets=44`);

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
      const releaseInteraction = await evaluate(cdp, `(() => {
        const button = document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice button');
        const notice = button?.closest('.releaseUpdateNotice');
        const rect = button?.getBoundingClientRect();
        const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;
        return { button:button?.outerHTML, notice:notice?.outerHTML.slice(0,240), rect:rect&&{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom}, hit:hit?.outerHTML?.slice(0,240), noticeStyle:notice&&{position:getComputedStyle(notice).position,zIndex:getComputedStyle(notice).zIndex,display:getComputedStyle(notice).display} };
      })()`);
      process.stdout.write(`authenticated shell browser release interaction ${JSON.stringify(releaseInteraction)}\n`);
      await trustedClick(cdp, ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice button");
      await waitForExpression(cdp, "document.querySelector('.authenticatedAppFrame.kordynSystem > [data-kordyn-v2-root=\"mobile\"]') && !document.querySelector('.releaseUpdateNotice')", "production MobileApp after release refresh");
      await evaluate(cdp, "window.dispatchEvent(new Event('focus'))");
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.releaseUpdateNotice'))"), false, "release refresh converges the production client/server version before work resumes");
      await trustedClick(cdp, "[data-kordyn-v2-domain-target=governance]");
      await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=\"mobile\"]')?.dataset.kordynV2Domain === 'governance'", "V2 mobile Governance domain");
      await trustedClick(cdp, "[data-kordyn-v2-workspace-target=runs]");
      await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-governance-mobile=\"runs\"]')", "V2 mobile Governance runs");
      await trustedClick(cdp, ".kordynV2GovernanceMobile[data-kordyn-v2-governance-mobile=\"runs\"] > .kordynV2MobilePrimary");
      await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-governance-mobile=\"recovery\"]')", "V2 mobile Governance recovery");
      assert.equal(await evaluate(cdp, "document.documentElement.scrollWidth"), 390, "V2 mobile recovery never creates document overflow");
      await trustedClick(cdp, "[data-kordyn-v2-governance-mobile=\"recovery\"] > .kordynV2MobilePrimary");
      await waitForExpression(cdp, "document.querySelector('.cfmCard--ordinary')", "production MobileApp ordinary ConfirmHost");
      collectV2AuthenticatedSurfaceViolations(visualViolations, "390x844 production MobileApp ordinary ConfirmHost", await readSurfaceContract(cdp, ".authenticatedAppFrame.kordynSystem .cfmCard--ordinary", ".authenticatedAppFrame.kordynSystem .cfmOk"));
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
      await waitForExpression(cdp, "document.activeElement?.matches('[data-kordyn-v2-governance-mobile=\"recovery\"] > .kordynV2MobilePrimary')", "MobileApp ordinary ConfirmHost focus return");
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
  assert.match(await evaluate(cdp, "getComputedStyle(document.querySelector('.publicAppFrame .releaseUpdateNotice')).fontFamily"), /Public Sans/, "public overlay uses the zero-base public font inheritance");
  assert.deepEqual(await readSurfaceContract(cdp, ".publicAppFrame .releaseUpdateNotice", ".publicAppFrame .releaseUpdateNotice button"), {
    backgroundColor: "rgb(255, 253, 249)", backgroundImage: "none", color: "rgb(38, 33, 26)", borderTopWidth: "1px", borderTopStyle: "solid", borderTopColor: "rgba(180, 122, 39, 0.28)", borderRadius: "14px", boxShadow: "rgba(44, 31, 15, 0.18) 0px 12px 36px 0px", backdropFilter: "blur(12px)", position: "fixed", zIndex: "220", display: "flex", minHeight: "0px",
    action: { backgroundColor: "rgb(231, 120, 47)", color: "rgb(255, 255, 255)", borderTopWidth: "0px", borderTopStyle: "none", borderTopColor: "rgb(255, 255, 255)", borderRadius: "10px", minHeight: "44px" }
  }, "public login and marketing release notice must use the August 15 warm visual contract");
  stopListeningForPublicCore();
  await cdp.send("Fetch.disable");

  if (visualViolations.length) {
    process.stderr.write(`authenticated shell visual contract RED ${visualViolations.length} violation(s)\n${visualViolations.map((item) => `- ${item}`).join("\n")}\n`);
  }
  assert.equal(visualViolations.length, 0, `authenticated shell visual contract has ${visualViolations.length} violation(s)`);
  process.stdout.write(`authenticated shell browser contract PASS ${appUrl.href} bootstrap=[${bootstrapProof.join(", ")}] viewports=[${viewportProof.join(', ')}] release=production-mismatch confirm=desktop+MobileApp public=august15-warm\n`);
  }
} finally {
  cdp?.close();
  await stopProcess(chrome);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

} finally {
  for (const child of managedServices.reverse()) await stopProcess(child);
  if (managedServiceRoot) await rm(managedServiceRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
