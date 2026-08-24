import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
}

async function trustedClick(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) throw new Error(${JSON.stringify(`Missing click target: ${selector}`)});
    target.scrollIntoView({ block: "center" });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 50));
}

async function trustedKey(cdp, key, code) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: code === "ArrowDown" ? 40 : code === "ArrowUp" ? 38 : code === "Enter" ? 13 : 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: code === "ArrowDown" ? 40 : code === "ArrowUp" ? 38 : code === "Enter" ? 13 : 27 });
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-canonical-browser-"));
const pageUrl = `http://127.0.0.1:${vitePort}/tests/canonical-selection-browser.html`;
const vite = spawn(path.join(rootDir, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: rootDir, stdio: "ignore" });
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-extensions",
  "--disable-gpu",
  "--no-default-browser-check",
  "--no-first-run",
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${profileDir}`,
  pageUrl
], { stdio: "ignore" });

let cdp;
try {
  await waitFor(pageUrl);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page" && row.url === pageUrl));
  const target = targets.find((row) => row.type === "page" && row.url === pageUrl);
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  const deadline = Date.now() + 20_000;
  while (!await evaluate(cdp, "Boolean(window.__canonicalBrowserReady && document.querySelector('#canonical-browser-harness'))")) {
    if (Date.now() > deadline) throw new Error("Browser harness did not mount");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const cases = [
    { workspace: "ai", id: "event-5", type: "Event" },
    { workspace: "live", id: "position-native-2", type: "Position" },
    { workspace: "lab", id: "breakout@4", type: "Strategy product" },
    { workspace: "control", id: "mandate-main", type: "Mandate" },
    { workspace: "control-event-risk", id: "event-5", type: "Event" },
    { workspace: "operations", id: "task-9", type: "Task" }
  ];
  const results = [];
  for (const entry of cases) {
    const selector = `[data-browser-case="${entry.workspace}"] [data-shell-object-id="${entry.id}"][data-shell-object-type="${entry.type}"]`;
    await trustedClick(cdp, selector);
    const state = await evaluate(cdp, `(() => {
      const root = document.querySelector("#canonical-browser-harness");
      const context = document.querySelector('[data-shell-role="context-dock"]');
      const trace = document.querySelector('[data-shell-role="trace-rail"]');
      return {
        selectedObject: root?.dataset.shellSelectedObject,
        selectedType: root?.dataset.shellSelectedType,
        contextObject: context?.dataset.shellContextObject,
        traceObject: trace?.dataset.shellTraceObject
      };
    })()`);
    const identity = `${entry.type}:${entry.id}`;
    assert.deepEqual(state, {
      selectedObject: entry.id,
      selectedType: entry.type,
      contextObject: identity,
      traceObject: identity
    });
    results.push(`${entry.workspace}:${identity}`);
  }
  const appCases = [
    { surface: "app-market", id: "BTC/USDT", type: "Market" },
    { surface: "app-capability", id: "capability-18", type: "Capability", close: ".mCapabilitySheet .mSheetGrip" },
    { surface: "app-strategy", id: "breakout@4", type: "Strategy product", close: ".mLabRegistrySheet .mSheetGrip" },
    { surface: "app-strategy", id: "mean-reversion", type: "Strategy", close: ".mLabRegistrySheet .mSheetGrip" },
    { surface: "app-validation", id: "validation-6", type: "Validation run", close: ".mResearchSheet .mSheetGrip" },
    { surface: "app-event-risk", id: "event-5", type: "Event" }
  ];
  for (const entry of appCases) {
    const selector = `[data-browser-case="${entry.surface}"] [data-shell-object-id="${entry.id}"][data-shell-object-type="${entry.type}"]`;
    await trustedClick(cdp, selector);
    const state = await evaluate(cdp, `(() => {
      const root = document.querySelector("#canonical-browser-harness");
      const context = document.querySelector('[data-shell-role="context-dock"]');
      const trace = document.querySelector('[data-shell-role="trace-rail"]');
      return {
        selectedObject: root?.dataset.shellSelectedObject,
        selectedType: root?.dataset.shellSelectedType,
        contextObject: context?.dataset.shellContextObject,
        traceObject: trace?.dataset.shellTraceObject
      };
    })()`);
    const identity = `${entry.type}:${entry.id}`;
    assert.deepEqual(state, {
      selectedObject: entry.id,
      selectedType: entry.type,
      contextObject: identity,
      traceObject: identity
    });
    results.push(`${entry.surface}:${identity}`);
    if (entry.close) await trustedClick(cdp, `[data-browser-case="${entry.surface}"] ${entry.close}`);
  }
  await evaluate(cdp, `document.querySelector('[data-browser-case="app-object-sheet"] [role="combobox"]').focus()`);
  await trustedKey(cdp, "ArrowDown", "ArrowDown");
  const afterDown = await evaluate(cdp, `(() => {
    const input = document.querySelector('[data-browser-case="app-object-sheet"] [role="combobox"]');
    const active = input?.getAttribute("aria-activedescendant");
    return { active, selected: active ? document.getElementById(active)?.getAttribute("aria-selected") : null };
  })()`);
  assert.match(afterDown.active, /^mobile-shell-object-result-/);
  assert.equal(afterDown.selected, "true");
  await trustedKey(cdp, "ArrowUp", "ArrowUp");
  const afterUp = await evaluate(cdp, `document.querySelector('[data-browser-case="app-object-sheet"] [role="combobox"]')?.getAttribute("aria-activedescendant")`);
  assert.match(afterUp, /^mobile-shell-object-result-/);
  assert.notEqual(afterUp, afterDown.active);
  await trustedKey(cdp, "Enter", "Enter");
  assert.deepEqual(await evaluate(cdp, `(() => {
    const root = document.querySelector("#canonical-browser-harness");
    return {
      dialogOpen: Boolean(document.querySelector('[data-browser-case="app-object-sheet"] [data-shell-role="mobile-object-switcher"]')),
      selectedObject: root?.dataset.shellSelectedObject,
      selectedType: root?.dataset.shellSelectedType,
      contextObject: document.querySelector('[data-shell-role="context-dock"]')?.dataset.shellContextObject,
      traceObject: document.querySelector('[data-shell-role="trace-rail"]')?.dataset.shellTraceObject
    };
  })()`), { dialogOpen: false, selectedObject: "BTC/USDT", selectedType: "Market", contextObject: "Market:BTC/USDT", traceObject: "Market:BTC/USDT" });
  await trustedClick(cdp, `[data-browser-case="app-object-sheet"] .mShellTools .mShellToolButton`);
  await evaluate(cdp, `document.querySelector('[data-browser-case="app-object-sheet"] [role="combobox"]').focus()`);
  await trustedKey(cdp, "Escape", "Escape");
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector('[data-browser-case="app-object-sheet"] [data-shell-role="mobile-object-switcher"]'))`), false);
  results.push("app-object-sheet:ArrowDown/ArrowUp/Enter/Escape");
  process.stdout.write(`canonical browser click contract PASS ${results.join(", ")}\n`);
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
