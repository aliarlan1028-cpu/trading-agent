import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const managed = [];

function parseRgb(value) {
  return value.match(/\d+(?:\.\d+)?/gu)?.slice(0, 3).map(Number) || null;
}

function contrastRatio(foreground, background) {
  const linear = (channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([red, green, blue]) => 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
  const [first, second] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (first + 0.05) / (second + 0.05);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function spawnManaged(command, args, options) {
  const output = [];
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => output.push(chunk.toString()));
  child.stderr.on("data", (chunk) => output.push(chunk.toString()));
  child.outputTail = () => output.join("").slice(-4_000);
  managed.push(child);
  return child;
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

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
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
      const id = ++nextId;
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
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await delay(50);
  }
}

async function trustedClick(cdp, selector) {
  await waitForExpression(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return false;
    const rect = target.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return rect.width > 0 && rect.height > 0 && (hit === target || target.contains(hit));
  })()`, `physical target ${selector}`);
  const point = await evaluate(cdp, `(() => {
    const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function startApp() {
  const [apiPort, vitePort] = await Promise.all([freePort(), freePort()]);
  const dataRoot = await mkdtemp("/tmp/kordyn-v2-release-overlay-");
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const appUrl = `http://127.0.0.1:${vitePort}/`;
  const backend = spawnManaged(process.execPath, ["server/index.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(apiPort), HOST: "127.0.0.1", NODE_ENV: "test", NODE_TEST_CONTEXT: "1",
      TEST_DATA_ROOT: dataRoot, AUTH_REQUIRED: "false", ADMIN_PASSWORD: "", SECRETS_MASTER_KEY: "",
      APP_RELEASE: "release-overlay-server"
    }
  });
  try {
    await waitFor(`${apiUrl}/api/health`);
  } catch (error) {
    throw new Error(`release overlay backend failed: ${backend.outputTail()}`, { cause: error });
  }
  const vite = spawnManaged(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      VITE_API_PROXY_TARGET: apiUrl,
      VITE_APP_RELEASE: "release-overlay-client",
      VITE_ALLOW_KORDYN_V2_PREVIEW: "true"
    }
  });
  try {
    await waitFor(appUrl);
  } catch (error) {
    throw new Error(`release overlay Vite server failed: ${vite.outputTail()}`, { cause: error });
  }
  return { appUrl, dataRoot };
}

async function mountV2(cdp, appUrl, width, height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height });
  await cdp.send("Page.navigate", { url: appUrl });
  await waitForExpression(cdp, "document.querySelector('.authenticatedAppFrame.kordynSystem')", `${width}px authenticated frame`);
  await evaluate(cdp, "sessionStorage.setItem('kordyn_ui_version', 'v2')");
  await cdp.send("Page.reload");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-root=\"mobile\"]')", `${width}px V2 root`);
  await evaluate(cdp, "window.dispatchEvent(new Event('focus'))");
  await waitForExpression(cdp, "document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice button')", `${width}px release notice`);
}

let app;
let chrome;
let cdp;
let profileDir;
try {
  app = await startApp();
  const chromePort = await freePort();
  profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-release-overlay-chrome-"));
  chrome = spawn(chromeBinary, [
    "--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu", "--no-first-run",
    `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profileDir}`, "about:blank"
  ], { stdio: "ignore" });
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);

  const evidence = [];
  for (const [width, height] of [[390, 844], [430, 932]]) {
    await mountV2(cdp, app.appUrl, width, height);
    assert.equal(await evaluate(cdp, `(() => {
      const button = document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice button');
      button.focus();
      return document.activeElement === button;
    })()`), true, `${width}px release action must retain keyboard focusability`);
    const viewportEvidence = await evaluate(cdp, `(() => {
      const button = document.querySelector('.authenticatedAppFrame.kordynSystem .releaseUpdateNotice button');
      const notice = button.closest('.releaseUpdateNotice');
      const shell = document.querySelector('[data-kordyn-v2-shell="mobile"]');
      const rect = button.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      const buttonStyle = getComputedStyle(button);
      const noticeStyle = getComputedStyle(notice);
      const titleStyle = getComputedStyle(notice.querySelector('strong'));
      const detailStyle = getComputedStyle(notice.querySelector('span'));
      return {
        viewport: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
        shell: [shell.clientWidth, shell.scrollWidth],
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        hitIsButton: hit === button,
        position: noticeStyle.position,
        zIndex: noticeStyle.zIndex,
        display: noticeStyle.display,
        backgroundImage: noticeStyle.backgroundImage,
        borderColor: noticeStyle.borderTopColor,
        titleColor: titleStyle.color,
        detailColor: detailStyle.color,
        buttonColor: buttonStyle.color,
        buttonBackground: buttonStyle.backgroundColor,
        minHeight: buttonStyle.minHeight,
        active: document.activeElement === button
      };
    })()`);
    viewportEvidence.contrast = {
      title: contrastRatio(parseRgb(viewportEvidence.titleColor), [5, 13, 25]),
      detail: contrastRatio(parseRgb(viewportEvidence.detailColor), [5, 13, 25]),
      button: contrastRatio(parseRgb(viewportEvidence.buttonColor), parseRgb(viewportEvidence.buttonBackground))
    };
    process.stdout.write(`V2 release overlay colors ${width}x${height} ${JSON.stringify(viewportEvidence)}\n`);
    assert.deepEqual(viewportEvidence.viewport, [width, width], `${width}px release notice must not create document overflow`);
    assert.ok(viewportEvidence.shell[1] <= viewportEvidence.shell[0] + 1, `${width}px release notice must not create shell overflow`);
    assert.equal(viewportEvidence.position, "fixed", `${width}px release notice must be fixed above the V2 root`);
    assert.equal(viewportEvidence.zIndex, "1000", `${width}px release notice must retain its V2 overlay layer`);
    assert.equal(viewportEvidence.display, "flex", `${width}px release notice must retain its compact layout`);
    assert.equal(viewportEvidence.borderColor, "rgba(135, 164, 205, 0.28)", `${width}px release notice must retain its visible V2 border`);
    assert.equal(viewportEvidence.titleColor, "rgb(242, 246, 253)", `${width}px release title must retain V2 light text`);
    assert.equal(viewportEvidence.detailColor, "rgb(194, 206, 222)", `${width}px release detail must retain V2 soft text`);
    assert.equal(viewportEvidence.buttonColor, "rgb(3, 9, 20)", `${width}px release action must retain contrast-safe V2 ink`);
    assert.equal(viewportEvidence.buttonBackground, "rgb(52, 120, 255)", `${width}px release action must retain V2 cobalt`);
    assert.match(viewportEvidence.backgroundImage, /rgb\(13, 24, 39\).*rgb\(5, 13, 25\)/u, `${width}px release notice must retain the V2 dark surface gradient`);
    assert.ok(viewportEvidence.contrast.title >= 7, `${width}px release title contrast must remain high`);
    assert.ok(viewportEvidence.contrast.detail >= 4.5, `${width}px release detail contrast must remain adequate`);
    assert.ok(viewportEvidence.contrast.button >= 4.5, `${width}px release action contrast must remain adequate`);
    assert.ok(Number.parseFloat(viewportEvidence.minHeight) >= 44, `${width}px release action must retain a 44px touch target`);
    assert.ok(viewportEvidence.rect.height >= 44 && viewportEvidence.rect.width >= 44, `${width}px release action must have an actual 44px hit rect`);
    assert.equal(viewportEvidence.hitIsButton, true, `${width}px physical hit test must resolve the release button`);
    await trustedClick(cdp, ".authenticatedAppFrame.kordynSystem .releaseUpdateNotice button");
    await waitForExpression(cdp, "performance.getEntriesByType('navigation')[0]?.type === 'reload'", `${width}px release action reload`);
    evidence.push(viewportEvidence);
  }
  process.stdout.write(`V2 release overlay browser PASS ${JSON.stringify(evidence)}\n`);
} finally {
  cdp?.close();
  await stop(chrome);
  await Promise.all(managed.map(stop));
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
  if (app?.dataRoot) await rm(app.dataRoot, { recursive: true, force: true });
}
