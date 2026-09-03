import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const viewports = [[1440, 1080], [1280, 960], [1024, 768]];
const views = ["overview", "market", "positions", "execution", "ledger"];

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
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
    await delay(80);
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
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
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

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
}

async function waitForExpression(cdp, expression, label) {
  const deadline = Date.now() + 20_000;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) {
      const state = await evaluate(cdp, "({href:location.href,text:document.body?.innerText?.slice(0,800),fixture:document.documentElement?.dataset?.fixtureKind})");
      throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
    }
    await delay(60);
  }
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
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
  return child;
}

const vitePort = await freePort();
const cdpPort = await freePort();
const profile = await mkdtemp(path.join(os.tmpdir(), "trading-cockpit-browser-"));
const baseUrl = `http://127.0.0.1:${vitePort}`;
let vite;
let chrome;
let cdp;
try {
  vite = spawnManaged(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: process.cwd(), env: { ...process.env, VITE_APP_RELEASE: "trading-cockpit-browser-fixture" } });
  const vitePid = vite.pid;
  process.stdout.write(`trading cockpit browser: Vite pid=${vitePid} url=${baseUrl}\n`);
  try { await waitFor(`${baseUrl}/tests/trading-cockpit-browser.html`); }
  catch (error) { throw new Error(`Isolated Vite failed to start: ${vite.outputTail()}`, { cause: error }); }

  chrome = spawnManaged(chromeBinary, ["--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, "about:blank"], { cwd: process.cwd() });
  const chromePid = chrome.pid;
  process.stdout.write(`trading cockpit browser: Chrome pid=${chromePid} cdp=${cdpPort}\n`);
  let targets;
  try { targets = await waitFor(`http://127.0.0.1:${cdpPort}/json`, (rows) => rows.some((row) => row.type === "page")); }
  catch (error) { throw new Error(`Chrome failed to start: ${chrome.outputTail()}`, { cause: error }); }
  const page = targets.find((target) => target.type === "page");
  cdp = connectCdp(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  const results = [];
  for (const [width, height] of viewports) {
    for (const view of views) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: false });
      await cdp.send("Page.navigate", { url: `${baseUrl}/tests/trading-cockpit-browser.html?view=${view}` });
      await waitForExpression(cdp, `document.querySelector('[data-cockpit-page="${view}"]')`, `${width}x${height} ${view} cockpit page`);
      await waitForExpression(cdp, "!document.body.innerText.includes('加载 K 线') && !document.body.innerText.includes('Loading candlesticks')", `${width}x${height} ${view} chart load`);
      const facts = await evaluate(cdp, "(() => ({ fixture: document.documentElement.dataset.fixtureKind, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, charts: document.querySelectorAll('.tvChart canvas').length, page: document.querySelector('[data-cockpit-page]')?.dataset.cockpitPage }))()");
      assert.equal(facts.fixture, "production-shaped-synthetic", `${width}x${height} ${view} uses the marked test-only fixture`);
      assert.equal(facts.page, view, `${width}x${height} renders the requested real cockpit view`);
      assert.equal(facts.overflow, 0, `${width}x${height} ${view} has no document overflow`);
      if (["overview", "market"].includes(view)) assert.ok(facts.charts >= 1, `${width}x${height} ${view} renders at least one real chart canvas`);
      results.push({ width, height, view, charts: facts.charts, overflow: facts.overflow });
    }
  }
  console.log(`trading cockpit browser PASS ${JSON.stringify(results)}`);
} finally {
  cdp?.close();
  await stop(chrome);
  await stop(vite);
  await rm(profile, { recursive: true, force: true });
  console.log("trading cockpit browser cleanup PASS chrome/vite stopped and profile removed");
}
