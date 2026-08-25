import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const appUrl = new URL(process.env.KORDYN_APP_URL || "http://127.0.0.1:5178/");
const overlayFixtureUrl = new URL("/tests/authenticated-overlay-browser.html", appUrl);
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

async function trustedClick(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) throw new Error(${JSON.stringify(`Missing click target: ${selector}`)});
    target.scrollIntoView({ block: 'center' });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

function assertPrototypeStack(value, expected, label) {
  const normalized = String(value).replaceAll('"', "").replace(/\s+/g, " ").trim();
  assert.equal(normalized, expected, label);
}

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
  await waitFor(appUrl.href);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);

  let resolveCoreRequest;
  const coreRequestPaused = new Promise((resolve) => { resolveCoreRequest = resolve; });
  const stopListeningForCore = cdp.on("Fetch.requestPaused", (params) => {
    if (params.request?.url.includes("/api/bootstrap/core")) resolveCoreRequest(params.requestId);
    else cdp.send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
  });
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*api/bootstrap/core*", requestStage: "Request" }] });
  const startupProbeUrl = new URL(appUrl);
  startupProbeUrl.searchParams.set("authenticated_state_probe", String(Date.now()));
  await cdp.send("Page.navigate", { url: startupProbeUrl.href });
  const coreRequestId = await coreRequestPaused;
  await waitForExpression(cdp, "document.querySelector('.authenticatedAppFrame.kordynSystem > .loading')", "authenticated startup loading state");
  const startupFont = await evaluate(cdp, "getComputedStyle(document.querySelector('.authenticatedAppFrame.kordynSystem > .loading')).fontFamily");
  assertPrototypeStack(startupFont, "Inter, Helvetica Neue, Arial, sans-serif", "authenticated startup loading must use the prototype sans stack");
  await cdp.send("Fetch.failRequest", { requestId: coreRequestId, errorReason: "Failed" });
  await waitForExpression(cdp, "document.querySelector('.authenticatedAppFrame.kordynSystem .mobileConnectPanel')", "authenticated connection failure state");
  const connectionFont = await evaluate(cdp, "getComputedStyle(document.querySelector('.authenticatedAppFrame.kordynSystem .mobileConnectPanel')).fontFamily");
  assertPrototypeStack(connectionFont, "Inter, Helvetica Neue, Arial, sans-serif", "authenticated connection failure must use the prototype sans stack");
  stopListeningForCore();
  await cdp.send("Fetch.disable");

  await setViewport(cdp, 1440, 900);
  process.stdout.write("authenticated shell browser: desktop mounted\n");
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.authenticatedAppFrame.kordynSystem > .appShell.kordynSystem'))"), true, "desktop product shell and its sibling overlays must share an authenticated Kordyn inheritance frame");
  await trustedClick(cdp, ".topEmergencyActions > button.danger:first-child");
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
  await evaluate(cdp, "document.querySelector('.cfmCancel')?.click()");

  await cdp.send("Page.navigate", { url: overlayFixtureUrl.href });
  await waitForExpression(cdp, "window.__authenticatedOverlayReady && document.querySelector('.releaseUpdateNotice')", "real ReleaseUpdateNotice content component");
  const releaseFont = await evaluate(cdp, "getComputedStyle(document.querySelector('.releaseUpdateNotice')).fontFamily");
  assertPrototypeStack(releaseFont, "Inter, Helvetica Neue, Arial, sans-serif", "ReleaseUpdateNotice must inherit the immutable prototype sans stack");

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.navigate", { url: overlayFixtureUrl.href });
  await waitForExpression(cdp, "window.__authenticatedOverlayReady && document.querySelector('.releaseUpdateNotice')", "390px authenticated overlay fixture");
  await trustedClick(cdp, "[data-browser-action='confirm']");
  await waitForExpression(cdp, "document.querySelector('.cfmHead')", "390px authenticated ConfirmHost");
  const mobileOverlayFonts = await evaluate(cdp, `({
    confirm: getComputedStyle(document.querySelector('.cfmHead')).fontFamily,
    release: getComputedStyle(document.querySelector('.releaseUpdateNotice')).fontFamily
  })`);
  assertPrototypeStack(mobileOverlayFonts.confirm, "Inter, Helvetica Neue, Arial, sans-serif", "390px ConfirmHost prototype stack");
  assertPrototypeStack(mobileOverlayFonts.release, "Inter, Helvetica Neue, Arial, sans-serif", "390px ReleaseUpdateNotice prototype stack");

  const publicFixtureUrl = new URL(overlayFixtureUrl);
  publicFixtureUrl.searchParams.set("scope", "public");
  await cdp.send("Page.navigate", { url: publicFixtureUrl.href });
  await waitForExpression(cdp, "window.__authenticatedOverlayReady && document.querySelector('.publicAppFrame .releaseUpdateNotice')", "public overlay inheritance fixture");
  assert.equal(await evaluate(cdp, "document.querySelector('.publicAppFrame').classList.contains('kordynSystem')"), false, "login and marketing inheritance must not be opted into the authenticated Kordyn scope");
  assert.match(await evaluate(cdp, "getComputedStyle(document.querySelector('.publicAppFrame .releaseUpdateNotice')).fontFamily"), /Space Grotesk|Public Sans/, "public overlay keeps the existing public font inheritance");

  const viewportProof = [];
  for (const [width, height] of [[390, 844], [430, 932]]) {
    await setViewport(cdp, width, height);
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
  }

  process.stdout.write(`authenticated shell browser contract PASS ${appUrl.href} ${viewportProof.join(', ')}\n`);
} finally {
  cdp?.close();
  await stopProcess(chrome);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// Keep the authenticated shell contract as the single reproducible gate: the
// imported runner mounts /tests/production-mobile-app-browser.html and proves
// real App/MobileApp navigation, Registry clicks, state boundaries, Context,
// and Trace with trusted CDP input.
await import("./run-production-shell-selection-browser.mjs");
