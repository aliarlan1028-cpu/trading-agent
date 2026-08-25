import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

async function waitForExpression(cdp, expression, label) {
  const deadline = Date.now() + 20_000;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

async function click(cdp, selector, text = "") {
  const point = await evaluate(cdp, `(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => !${JSON.stringify(text)} || node.textContent.includes(${JSON.stringify(text)}));
    if (!target) throw new Error(${JSON.stringify(`Missing click target ${selector} ${text}`)});
    target.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 100));
}

async function setViewport(cdp, url, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  await cdp.send("Page.navigate", { url });
  await waitForExpression(cdp, "window.__zeroBaseShellBrowserReady && document.querySelector('[data-zero-base-shell=desktop]')", `${width}px zero-base shell`);
}

async function readGeometry(cdp) {
  return await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-zero-base-shell="desktop"]');
    const nav = root.querySelector('.zbNavigation');
    const top = root.querySelector('.zbTopbar');
    const main = root.querySelector('.zbPage');
    const rect = (node) => { const r = node.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height, scrollWidth:node.scrollWidth, clientWidth:node.clientWidth }; };
    return {
      viewport:[innerWidth,innerHeight], document:[document.documentElement.clientWidth,document.documentElement.scrollWidth],
      root:rect(root), nav:rect(nav), top:rect(top), main:rect(main),
      activeFamilies:root.querySelectorAll('.zbNavigation__item[aria-current="page"]').length,
      activeViews:root.querySelectorAll('.zbSubnav button[aria-current="page"]').length,
      family:root.dataset.zeroBaseFamily, view:root.dataset.zeroBaseView,
      today:Boolean(root.querySelector('[data-today-zone="ai-primary"]') && root.querySelector('[data-today-zone="account"]') && root.querySelector('[data-today-zone="intelligent-assets"]'))
    };
  })()`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null && !child.signalCode) { child.kill("SIGKILL"); await exited; }
}

const vitePort = await freePort();
const chromePort = await freePort();
const baseUrl = `http://127.0.0.1:${vitePort}/tests/zero-base-shell-browser.html`;
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-zero-base-shell-"));
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(vitePort)], { cwd: rootDir, stdio: "ignore" });
const chrome = spawn(chromeBinary, ["--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu", "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });

let cdp;
try {
  await waitFor(baseUrl);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);

  const responsive = [];
  for (const [width, height] of [[1440, 900], [1180, 800]]) {
    await setViewport(cdp, baseUrl, width, height);
    const geometry = await readGeometry(cdp);
    assert.deepEqual(geometry.document, [width, width], `${width}: no document overflow`);
    assert.equal(geometry.activeFamilies, 1, `${width}: one active family`);
    assert.equal(geometry.activeViews, 1, `${width}: one active view`);
    assert.equal(geometry.family, "today");
    assert.equal(geometry.today, true, `${width}: AI, account, and intelligent asset zones`);
    assert.ok(geometry.main.scrollWidth <= geometry.main.clientWidth + 1, `${width}: page content contained`);
    responsive.push({ width, family: geometry.family, mainWidth: geometry.main.width });
  }

  await click(cdp, '[data-zero-base-family="ai"]');
  await waitForExpression(cdp, "document.querySelector('[data-zero-base-shell=desktop]').dataset.zeroBaseFamily === 'ai' && document.querySelector('[data-browser-workbench=ai]')", "AI family navigation");
  await click(cdp, '[data-zero-base-family="strategy"]');
  await waitForExpression(cdp, "document.querySelector('[data-zero-base-shell=desktop]').dataset.zeroBaseFamily === 'strategy' && document.querySelector('[data-browser-workbench=strategy]')", "Strategy family navigation");

  await click(cdp, '[data-zero-base-tool="context"]');
  await waitForExpression(cdp, "document.querySelector('.zbShellContext:not([hidden])')", "Context drawer");
  await click(cdp, ".zbShellScrim");
  await waitForExpression(cdp, "document.querySelector('.zbShellContext[hidden]')", "Context drawer close");
  await click(cdp, '[data-zero-base-tool="trace"]');
  await waitForExpression(cdp, "document.querySelector('.zbShellTrace:not([hidden])')", "Trace drawer");
  await click(cdp, ".zbShellScrim");

  await click(cdp, ".commandRail__search input");
  await evaluate(cdp, `(() => {
    const input = document.querySelector('.commandRail__search input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'US CPI');
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'US CPI' }));
    input.focus();
    return input.value;
  })()`);
  await waitForExpression(cdp, "document.querySelector('.commandRail__results [data-shell-object-type=Event]')", "Event search result");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  const searchInteraction = await evaluate(cdp, `(() => ({
    input: document.querySelector('.commandRail__search input')?.value,
    focused: document.activeElement === document.querySelector('.commandRail__search input'),
    results: document.querySelectorAll('.commandRail__results [role="option"]').length,
    selected: document.querySelector('[data-zero-base-shell=desktop]')?.dataset.shellSelectedObject
  }))()`);
  if (searchInteraction.selected !== "event-5") console.error("zero-base search diagnostic", searchInteraction);
  await waitForExpression(cdp, "document.querySelector('[data-zero-base-shell=desktop]').dataset.shellSelectedObject === 'event-5'", "canonical selected Event");
  await click(cdp, '[data-zero-base-tool="context"]');
  await waitForExpression(cdp, "document.querySelector('.zbShellContext').dataset.shellContextObject === 'Event:event-5'", "selected Event Context identity");

  const states = {};
  for (const state of ["loading", "failed", "forbidden", "stale", "degraded"]) {
    const url = `${baseUrl}?state=${state}`;
    await setViewport(cdp, url, 1180, 800);
    await waitForExpression(cdp, `document.querySelector('.workspaceState--${state === "failed" ? "error" : state === "forbidden" ? "forbidden" : state === "loading" ? "loading" : "warning"}')`, `${state} state panel`);
    states[state] = await evaluate(cdp, `(() => ({
      panel:Boolean(document.querySelector('.workspaceState')),
      lastValid:Boolean(document.querySelector('.workspaceStateBoundary__lastValid')),
      disabled:document.querySelector('.workspaceStateBoundary__lastValid')?.getAttribute('aria-disabled') || null,
      overflow:document.documentElement.scrollWidth > document.documentElement.clientWidth
    }))()`);
    assert.equal(states[state].overflow, false, `${state}: no document overflow`);
    if (["stale", "degraded"].includes(state)) { assert.equal(states[state].lastValid, true); assert.equal(states[state].disabled, "true"); }
    else assert.equal(states[state].lastValid, false);
  }

  console.log(JSON.stringify({ result: "PASS", responsive, navigation: ["today", "ai", "strategy"], drawers: ["context", "trace"], selection: "Event:event-5", states }, null, 2));
} finally {
  cdp?.close();
  await stopProcess(chrome);
  await stopProcess(vite);
  await rm(profileDir, { recursive: true, force: true });
}
