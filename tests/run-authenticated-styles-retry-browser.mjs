import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import WebSocket from "ws";
import { installStaticDelivery } from "../server/staticDelivery.mjs";
import { KORDYN_V2_PRODUCTION_FIXTURE_JSON } from "./kordyn-v2-production-fixture.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const retryMode = process.env.KORDYN_AUTH_RESOURCE_RETRY_MODE || "stylesheet";
assert.ok(["app-module", "styles-module", "stylesheet"].includes(retryMode), `unsupported retry mode ${retryMode}`);
const viewport = retryMode === "stylesheet"
  ? { width: 390, height: 844, mobile: true }
  : { width: 1440, height: 900, mobile: false };
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

async function physicalClick(cdp, selector, { touch = false } = {}) {
  const point = await evaluate(cdp, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    node.scrollIntoView({ block: "center", inline: "center" });
    const rect = node.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hit: hit === node || node.contains(hit), width: rect.width, height: rect.height };
  })()`);
  assert.ok(point?.hit && point.width >= 44 && point.height >= 44, `${selector} must be physically hit-testable with a 44px target`);
  if (touch) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, radiusX: 1, radiusY: 1, force: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
}

async function pressKey(cdp, key) {
  const code = key === "Tab" ? "Tab" : key === "Enter" ? "Enter" : key;
  const windowsVirtualKeyCode = key === "Tab" ? 9 : key === "Enter" ? 13 : 0;
  await cdp.send("Input.dispatchKeyEvent", { type: key === "Enter" ? "rawKeyDown" : "keyDown", key, code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode });
  if (key === "Enter") await cdp.send("Input.dispatchKeyEvent", { type: "char", key, code, text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode });
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null && !child.signalCode) child.kill("SIGKILL");
}

const workspace = await mkdtemp(path.join(os.tmpdir(), "kordyn-authenticated-styles-retry-"));
const buildDir = path.join(workspace, "dist");
const chromeProfile = path.join(workspace, "chrome-profile");
const appPort = await freePort();
let server;
let chrome;
let cdp;
let resourceRequests = 0;
const requestEvents = [];

try {
  await run(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", buildDir, "--emptyOutDir"], { cwd: rootDir });
  const manifest = JSON.parse(await readFile(path.join(buildDir, ".vite", "manifest.json"), "utf8"));
  const appModule = Object.values(manifest).find((entry) => entry?.name === "App" && entry?.isDynamicEntry)?.file;
  const stylesModule = manifest["src/aug15/productStyles.js"]?.file;
  const stylesheet = manifest["src/aug15/productStyles.js"]?.assets?.find((asset) => asset.endsWith(".css"));
  assert.match(appModule || "", /\.js$/, "production build must expose the retryable authenticated App module");
  assert.match(stylesModule || "", /\.js$/, "production build must expose the retryable productStyles module");
  assert.match(stylesheet || "", /\.css$/, "production build must expose the retryable authenticated stylesheet asset");
  const targetResource = retryMode === "app-module" ? appModule : retryMode === "styles-module" ? stylesModule : stylesheet;

  const app = express();
  app.use((req, res, next) => {
    if (req.path === `/${targetResource}`) {
      resourceRequests += 1;
      requestEvents.push({ attempt: resourceRequests, at: Date.now(), path: req.path });
      if (resourceRequests === 1) return res.status(503).type("text/plain").send("deliberate first authenticated resource failure");
    }
    next();
  });
  app.get("/api/public/ticker-bar", (_req, res) => res.json({ items: [] }));
  app.get("/api/public/bootstrap", (_req, res) => res.json({ registrationEnabled: true, trc20Configured: true, subscriptionPlans: [] }));
  app.get("/api/bootstrap/core", (_req, res) => res.type("json").send(KORDYN_V2_PRODUCTION_FIXTURE_JSON));
  app.get("/api/overview", (_req, res) => res.type("json").send(KORDYN_V2_PRODUCTION_FIXTURE_JSON));
  app.get("/api/stream", (_req, res) => res.type("text/event-stream").send(": fixture\n\n"));
  installStaticDelivery(app, { publicDir: buildDir });
  server = app.listen(appPort, "127.0.0.1");
  const baseUrl = `http://127.0.0.1:${appPort}`;
  await waitFor(`${baseUrl}/`);

  const chromePort = await freePort();
  chrome = spawn(chromeBinary, [
    "--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu",
    "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${chromeProfile}`, "about:blank"
  ], { stdio: "ignore" });
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);
  await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 });
  if (viewport.mobile) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const route = `/app?authenticated_resource_retry=${retryMode}`;
  await cdp.send("Page.navigate", { url: `${baseUrl}${route}` });

  await waitExpression(cdp, `document.querySelector('[data-authenticated-state="styles"] button')`, "truthful authenticated stylesheet failure UI");
  const failure = await evaluate(cdp, `(() => ({
    message: document.querySelector('[data-authenticated-state="styles"] b')?.textContent.trim(),
    retry: document.querySelector('[data-authenticated-state="styles"] button')?.textContent.trim(),
    retryDisabled: document.querySelector('[data-authenticated-state="styles"] button')?.disabled,
    resourceRequests: ${resourceRequests},
    location: location.pathname + location.search
  }))()`);
  assert.match(failure.message || "", /界面资源加载失败|Interface assets failed to load/, "first resource failure must retain the existing error copy");
  assert.match(failure.retry || "", /重试|Retry/, "first resource failure must retain the existing retry action");
  assert.equal(failure.retryDisabled, false, "resource retry remains enabled after a recoverable delivery failure");
  assert.equal(resourceRequests, 1, `only the first ${retryMode} request fails`);
  assert.equal(failure.location, route, "resource failure preserves the current product route");

  await pressKey(cdp, "Tab");
  const keyboardProof = await evaluate(cdp, `(() => {
    const button = document.querySelector('[data-authenticated-state="styles"] button');
    const style = getComputedStyle(button);
    const rect = button.getBoundingClientRect();
    return {
      focused: document.activeElement === button,
      focusVisible: button.matches(':focus-visible') && (parseFloat(style.outlineWidth) > 0 || style.boxShadow !== 'none'),
      width: rect.width,
      height: rect.height,
      hit: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === button
    };
  })()`);
  assert.equal(keyboardProof.focused, true, "Tab reaches the real retry control");
  assert.equal(keyboardProof.focusVisible, true, "retry exposes visible keyboard focus");
  assert.ok(keyboardProof.hit && keyboardProof.width >= 44 && keyboardProof.height >= 44, "retry is physically hit-testable with a 44px touch target");
  if (retryMode === "styles-module") await pressKey(cdp, "Enter");
  else await physicalClick(cdp, `[data-authenticated-state="styles"] button`, { touch: viewport.mobile });
  const shellSelector = viewport.mobile ? "[data-classic-mobile-shell=\"true\"]" : "[data-classic-shell]";
  await waitExpression(cdp, `document.querySelector(${JSON.stringify(shellSelector)})`, `authenticated shell after ${retryMode} retry`);
  const proof = await evaluate(cdp, `(() => ({
    resourceRequests: ${resourceRequests},
    loadedLink: [...document.querySelectorAll('link[rel="stylesheet"]')].some((node) => node.href.includes(${JSON.stringify(stylesheet)})),
    font: getComputedStyle(document.documentElement).fontFamily,
    fontToken: getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim(),
    shell: Boolean(document.querySelector(${JSON.stringify(shellSelector)})),
    location: location.pathname + location.search
  }))()`);
  assert.equal(proof.resourceRequests, 2, `retry must make a second ${retryMode} request after the failed first request`);
  assert.equal(proof.loadedLink, true, "retry must apply the authenticated stylesheet through a loaded link");
  assert.match(proof.fontToken, /Space Grotesk/, "retry must apply the authenticated global font token");
  assert.match(proof.font, /Space Grotesk/, "retry must apply the authenticated computed font");
  assert.equal(proof.shell, true, "retry must render the real authenticated shell");
  assert.equal(proof.location, route, "resource retry preserves route and presentation state");
  assert.equal(/[?&#](?:email|password|passwd|pwd|token|credential)=/i.test(proof.location), false, "resource retry never places credentials in the URL");
  console.log(JSON.stringify({ result: "PASS", retryMode, viewport, targetResource, stylesheet, failure, keyboardProof, proof, requestEvents }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ result: "FAIL", error: error.message, retryMode, resourceRequests, requestEvents, pid: process.pid }, null, 2));
  process.exitCode = 1;
} finally {
  cdp?.close();
  await Promise.all([stop(chrome), new Promise((resolve) => server ? server.close(resolve) : resolve())]);
  await rm(workspace, { recursive: true, force: true });
}
