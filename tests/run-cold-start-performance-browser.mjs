import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import express from "express";
import WebSocket from "ws";
import { installStaticDelivery } from "../server/staticDelivery.mjs";
import { KORDYN_V2_PRODUCTION_FIXTURE_JSON } from "./kordyn-v2-production-fixture.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const viewports = [[1440, 900], [1180, 820], [430, 932], [390, 844]];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function run(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    execFile(command, args, { ...options, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} ${args.join(" ")} failed\n${stdout}\n${stderr}`, { cause: error }));
      else resolve({ stdout, stderr });
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
  const listeners = new Map();
  let id = 0;
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
      const requestId = ++id;
      return await new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        socket.send(JSON.stringify({ id: requestId, method, params }));
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

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitExpression(cdp, expression, label) {
  const deadline = Date.now() + 20_000;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await delay(50);
  }
}

async function click(cdp, selector) {
  await waitExpression(cdp, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    node.scrollIntoView({ block: "center", inline: "center" });
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && (hit === node || node.contains(hit));
  })()`, `physical click target ${selector}`);
  const point = await evaluate(cdp, `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function press(cdp, key) {
  const windowsVirtualKeyCode = key === "Escape" ? 27 : key === "Tab" ? 9 : 0;
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode });
}

async function navigate(cdp, url, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: 1, mobile: width <= 800, screenWidth: width, screenHeight: height
  });
  await cdp.send("Page.navigate", { url });
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
}

function requestEvidence(rows) {
  return rows.map(({ url, at }) => {
    const parsed = new URL(url);
    return { host: parsed.host, path: `${parsed.pathname}${parsed.search}`, at };
  });
}

function noOverflowMessage(width, mode, proof) {
  return `${width}px ${mode} horizontal overflow: ${JSON.stringify(proof)}`;
}

const workspace = await mkdtemp(path.join(os.tmpdir(), "kordyn-cold-start-"));
const buildDir = path.join(workspace, "dist");
const chromeProfile = path.join(workspace, "chrome-profile");
const serverRequests = [];
const browserRequests = [];
const appPort = await freePort();
let server;
let chrome;
let cdp;
let coreMode = "guest";
let coreStartedAt = 0;
let coreCompletedAt = 0;
const authenticatedCoreEnabled = true;

try {
  process.stderr.write(`cold-start browser: build stage pid=${process.pid} output=${buildDir}\n`);
  await run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", buildDir, "--emptyOutDir"], {
    cwd: rootDir,
    env: { ...process.env, VITE_API_BASE_URL: `http://127.0.0.1:${appPort}` }
  });
  const manifest = JSON.parse(await readFile(path.join(buildDir, ".vite", "manifest.json"), "utf8"));
  const landingEntry = manifest["landing.html"];
  const appEntry = manifest["index.html"];
  const augustEntry = Object.values(manifest).find((entry) => entry?.name === "App" && entry?.isDynamicEntry === true);
  const productStylesEntry = Object.values(manifest).find((entry) => entry?.name === "productStyles" && entry?.isDynamicEntry === true);
  assert.ok(landingEntry?.file, "built marketing entry asset is required");
  assert.ok(appEntry?.file, "built product entry asset is required");
  assert.ok(augustEntry?.file, "built August 15 authenticated entry asset is required");
  assert.ok(productStylesEntry?.file, "built deferred August 15 productStyles entry asset is required");
  const productStylesCss = (productStylesEntry.assets || []).filter((file) => file.endsWith(".css"));
  assert.equal(productStylesCss.length, 1, `deferred productStyles must own one real CSS asset, got ${JSON.stringify(productStylesEntry.assets || [])}`);
  const [augustStylesheet] = productStylesCss;

  const landingFiles = ["landing.html", landingEntry.file, ...(landingEntry.css || [])];
  const assetMetrics = {};
  for (const file of landingFiles) {
    const bytes = await readFile(path.join(buildDir, file));
    assetMetrics[file] = { bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
  }
  const landingGzipBytes = Object.values(assetMetrics).reduce((sum, item) => sum + item.gzipBytes, 0);
  assert.ok(landingGzipBytes < 75 * 1024, `marketing HTML + CSS + JS must stay under 75 KiB gzip, got ${landingGzipBytes}`);
  const productAssetMetrics = {};
  for (const file of [appEntry.file, augustEntry.file, productStylesEntry.file, augustStylesheet]) {
    const bytes = await readFile(path.join(buildDir, file));
    productAssetMetrics[file] = { bytes: bytes.length, gzipBytes: gzipSync(bytes).length };
  }

  const app = express();
  app.use((req, _res, next) => {
    serverRequests.push({ host: req.get("host"), path: req.originalUrl, at: Date.now() });
    next();
  });
  app.get("/api/public/ticker-bar", (_req, res) => res.json({ items: [] }));
  app.get("/api/public/bootstrap", (_req, res) => res.json({
    registrationEnabled: true,
    trc20Configured: true,
    subscriptionPlans: [
      { id: "monthly", interval: "month", months: 1 },
      { id: "quarterly", interval: "quarter", months: 3 },
      { id: "semiannual", interval: "half_year", months: 6 },
      { id: "annual", interval: "year", months: 12 }
    ]
  }));
  app.get("/api/bootstrap/core", async (_req, res) => {
    coreStartedAt = Date.now();
    if (coreMode !== "authenticated" || !authenticatedCoreEnabled) return res.status(401).json({ error: "auth_required" });
    await delay(1_200);
    coreCompletedAt = Date.now();
    res.type("json").send(KORDYN_V2_PRODUCTION_FIXTURE_JSON);
  });
  app.get("/api/overview", (_req, res) => res.type("json").send(KORDYN_V2_PRODUCTION_FIXTURE_JSON));
  app.get("/api/stream", (_req, res) => {
    res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.end(": fixture\n\n");
  });
  installStaticDelivery(app, { publicDir: buildDir });

  server = app.listen(appPort, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitFor(`${baseUrl}/`);

  const chromePort = await freePort();
  const { spawn } = await import("node:child_process");
  chrome = spawn(chromeBinary, [
    "--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu",
    "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${chromeProfile}`, "about:blank"
  ], { stdio: "ignore" });
  process.stderr.write(`cold-start browser: chrome stage pid=${chrome.pid} app=${baseUrl} cdp=${chromePort}\n`);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable"), cdp.send("Network.enable")]);
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => process.stderr.write(`browser exception: ${exceptionDetails?.exception?.description || exceptionDetails?.text}\n`));
  cdp.on("Network.requestWillBeSent", ({ request }) => browserRequests.push({ url: request.url, at: Date.now() }));
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `
    let assignedCapacitor;
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      get: () => assignedCapacitor,
      set: (value) => {
        assignedCapacitor = value;
        value.isNativePlatform = () => new URLSearchParams(location.search).has("native_probe");
        value.getPlatform = () => new URLSearchParams(location.search).has("native_probe") ? "ios" : "web";
      }
    });
  ` });

  const publicResults = [];
  const modalResults = [];
  for (const [width, height] of viewports) {
    coreMode = "guest";
    let requestStart = browserRequests.length;
    await navigate(cdp, `${baseUrl}/?public_probe=${width}-${Date.now()}`, width, height);
    await waitExpression(cdp, "document.querySelector('h1')?.textContent.includes('TO THE')", `${width}px TO THE MOON marketing heading`);
    await delay(250);
    const publicProof = await evaluate(cdp, `(() => ({
      heading: document.querySelector("h1")?.textContent.replace(/\\s+/g, " ").trim(),
      overflow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth)
    }))()`);
    assert.match(publicProof.heading, /TO THE\s+MOON\./, `${width}px public marketing renders TO THE MOON`);
    assert.equal(publicProof.overflow, 0, noOverflowMessage(width, "public", publicProof));
    const publicRequests = requestEvidence(browserRequests.slice(requestStart));
    assert.equal(publicRequests.some((row) => /(^|\.)googleapis\.com$|(^|\.)gstatic\.com$/.test(row.host)), false, `${width}px public marketing requests no Google font host`);
    const productAssets = [appEntry.file, augustEntry.file, productStylesEntry.file, augustStylesheet];
    assert.equal(publicRequests.some((row) => productAssets.some((file) => row.path.split("?")[0] === `/${file}`)), false, `${width}px public marketing requests no product JS or CSS asset`);
    assert.equal(publicRequests.some((row) => row.path.startsWith("/api/bootstrap/core")), false, `${width}px public marketing requests no core bootstrap`);
    publicResults.push({ width, height, overflow: publicProof.overflow, requestCount: publicRequests.length, requests: publicRequests });

    for (const mode of ["login", "subscribe"]) {
      requestStart = browserRequests.length;
      await navigate(cdp, `${baseUrl}/?${mode}_probe=${width}-${Date.now()}`, width, height);
      await waitExpression(cdp, `document.readyState === "complete" && document.querySelector('[data-action="${mode}"]')`, `${width}px marketing ${mode} action`);
      await delay(150);
      await click(cdp, `[data-action="${mode}"]`);
      await waitExpression(cdp, `location.pathname === "/app" && document.querySelector('.lpModal--${mode}[role="dialog"][aria-labelledby="web-auth-title"]')`, `${width}px real ${mode} modal`);
      await press(cdp, "Tab");
      const modalProof = await evaluate(cdp, `(() => {
        const modal = document.querySelector('.lpModal--${mode}');
        const focused = document.activeElement;
        const style = getComputedStyle(focused);
        return {
          pathname: location.pathname,
          search: location.search,
          title: document.getElementById("web-auth-title")?.textContent,
          focusInside: modal.contains(focused),
          focusVisible: focused.matches(":focus-visible") && parseFloat(style.outlineWidth) > 0,
          overflow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth)
        };
      })()`);
      assert.equal(modalProof.pathname, "/app", `${width}px ${mode} navigates to /app`);
      assert.equal(modalProof.search.includes("auth="), false, `${width}px ${mode} one-shot auth query is removed`);
      assert.equal(modalProof.title, mode === "login" ? "Start Trading" : "Subscribe", `${width}px ${mode} labelled modal title`);
      assert.equal(modalProof.focusInside, true, `${width}px ${mode} keyboard focus stays inside real modal`);
      assert.equal(modalProof.focusVisible, true, `${width}px ${mode} keyboard focus is visibly styled`);
      assert.equal(modalProof.overflow, 0, noOverflowMessage(width, mode, modalProof));
      await press(cdp, "Escape");
      await waitExpression(cdp, `!document.querySelector('.lpModal--${mode}')`, `${width}px ${mode} Escape close`);
      const modalRequests = requestEvidence(browserRequests.slice(requestStart));
      modalResults.push({ width, height, mode, ...modalProof, requestCount: modalRequests.length, requests: modalRequests, escapeClosed: true });
    }
  }

  coreMode = "guest";
  const nativeStart = browserRequests.length;
  await navigate(cdp, `${baseUrl}/app?native_probe=1`, 390, 844);
  await waitExpression(cdp, "document.querySelector('.nativeAuthCard')", "Capacitor no-token NativeAuthPage");
  await delay(250);
  const nativeRequests = requestEvidence(browserRequests.slice(nativeStart));
  const nativeProof = await evaluate(cdp, `(() => ({
    label: document.querySelector('.nativeAuthCard')?.getAttribute('aria-label'),
    overflow: Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.body.scrollWidth - document.body.clientWidth)
  }))()`);
  const nativeCoreRequestCount = nativeRequests.filter((row) => row.path.startsWith("/api/bootstrap/core")).length;
  assert.match(nativeProof.label, /KORDYN/, "Capacitor no-token entry renders the real labelled NativeAuthPage");
  assert.equal(nativeCoreRequestCount, 0, "Capacitor no-token entry makes zero core bootstrap requests");
  assert.equal(nativeRequests.some((row) => row.host && row.host !== new URL(baseUrl).host), false, "Capacitor fixture traffic stays on the production-shaped local server");
  assert.equal(nativeProof.overflow, 0, noOverflowMessage(390, "native", nativeProof));

  coreMode = "authenticated";
  coreStartedAt = 0;
  coreCompletedAt = 0;
  const authStart = browserRequests.length;
  await navigate(cdp, `${baseUrl}/app?authenticated_probe=${Date.now()}`, 1440, 900);
  await waitExpression(cdp, "document.querySelector('[data-classic-shell]')", "real authenticated August 15 shell");
  const authenticatedRequests = requestEvidence(browserRequests.slice(authStart));
  const augustRequest = authenticatedRequests.find((row) => row.path.split("?")[0] === `/${augustEntry.file}`);
  const productStylesRequest = authenticatedRequests.find((row) => row.path.split("?")[0] === `/${productStylesEntry.file}`);
  const stylesheetRequest = authenticatedRequests.find((row) => row.path.split("?")[0] === `/${augustStylesheet}`);
  assert.ok(coreStartedAt > 0, "authenticated product entry requests the core fixture");
  assert.ok(coreCompletedAt > coreStartedAt, "authenticated core fixture completes after its configured delay");
  assert.ok(augustRequest, `authenticated product requests the August 15 entry ${augustEntry.file}`);
  assert.ok(productStylesRequest, `authenticated product requests the deferred style loader ${productStylesEntry.file}`);
  assert.ok(stylesheetRequest, `authenticated product requests the deferred stylesheet ${augustStylesheet}`);
  assert.ok(augustRequest.at < coreCompletedAt, `August 15 entry request must begin before delayed core completes: ${JSON.stringify({ augustAt: augustRequest.at, coreStartedAt, coreCompletedAt })}`);
  assert.ok(coreCompletedAt < productStylesRequest.at, `deferred style loader must begin after delayed core completes: ${JSON.stringify({ coreCompletedAt, productStylesAt: productStylesRequest.at })}`);
  assert.ok(coreCompletedAt < stylesheetRequest.at, `App JS < core completion < CSS request ordering is required: ${JSON.stringify({ augustAt: augustRequest.at, coreCompletedAt, stylesheetAt: stylesheetRequest.at })}`);

  console.log(JSON.stringify({
    result: "PASS",
    buildDir,
    assets: { landing: landingEntry.file, product: appEntry.file, august15: augustEntry.file, productStyles: productStylesEntry.file, augustStylesheet, assetCount: landingFiles.length, landingGzipBytes, marketingFiles: assetMetrics, productFiles: productAssetMetrics },
    public: publicResults,
    modals: modalResults,
    native: { ...nativeProof, coreRequestCount: nativeCoreRequestCount, requestCount: nativeRequests.length, requests: nativeRequests },
    authenticated: { coreStartedAt, coreCompletedAt, augustRequest, productStylesRequest, stylesheetRequest, timingOrder: "App JS < core completion < CSS request", requestCount: authenticatedRequests.length, requests: authenticatedRequests },
    serverRequestCount: serverRequests.length
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ result: "FAIL", error: error.message, pid: process.pid }, null, 2));
  process.exitCode = 1;
} finally {
  cdp?.close();
  await Promise.all([stop(chrome), new Promise((resolve) => server ? server.close(resolve) : resolve())]);
  await rm(workspace, { recursive: true, force: true });
}
