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
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(url, predicate = () => true) {
  const deadline = Date.now() + 10_000;
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

async function trustedClick(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) throw new Error(${JSON.stringify(`Missing click target: ${selector}`)});
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-cutover-browser-"));
const pageUrl = `http://127.0.0.1:${vitePort}/tests/kordyn-v2-cutover-browser.html`;
const vite = spawn(path.join(rootDir, "node_modules/.bin/vite"), ["--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: rootDir, stdio: "ignore" });
const chrome = spawn(chromeBinary, [
  "--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu",
  "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${profileDir}`, pageUrl
], { stdio: "ignore" });

let cdp;
try {
  await waitFor(pageUrl);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page" && row.url === pageUrl));
  cdp = connectCdp(targets.find((row) => row.type === "page" && row.url === pageUrl).webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");

  const deadline = Date.now() + 5_000;
  while (!await evaluate(cdp, "Boolean(document.querySelector('[data-authenticated-state=\"v2-load-failed\"]'))")) {
    if (Date.now() > deadline) assert.fail("Rejected V2 lazy loader did not render an accessible recovery boundary");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  const recovery = await evaluate(cdp, `(() => {
    const alert = document.querySelector('[data-authenticated-state="v2-load-failed"]');
    const label = alert?.getAttribute("aria-labelledby");
    return {
      role: alert?.getAttribute("role"),
      label,
      heading: label ? document.getElementById(label)?.textContent.trim() : "",
      text: alert?.textContent || "",
      actions: [...alert.querySelectorAll("button")].map((button) => button.dataset.v2RecoveryAction)
    };
  })()`);
  assert.equal(recovery.role, "alert");
  assert.ok(recovery.label && recovery.heading);
  assert.deepEqual(recovery.actions, ["retry", "legacy"]);
  assert.doesNotMatch(recovery.text, /success|ready/i);

  await trustedClick(cdp, '[data-v2-recovery-action="retry"]');
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2RecoveryCalls"), { api: 0, retry: 1, legacy: 0 });
  await trustedClick(cdp, '[data-v2-recovery-action="legacy"]');
  assert.equal(await evaluate(cdp, "document.querySelector('[data-authenticated-state=\"legacy-recovery\"]')?.textContent"), "Legacy interface");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2RecoveryCalls"), { api: 0, retry: 1, legacy: 1 });
  process.stdout.write("KORDYN V2 rejected-loader recovery browser PASS retry=1 legacy=1 api=0\n");
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
