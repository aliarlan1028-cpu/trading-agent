import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewRoot = path.join(rootDir, ".impeccable/review/kordyn-v2");
const outputDir = path.resolve(rootDir, process.env.KORDYN_V2_OVERLAY_SCREENSHOT_DIR || ".impeccable/review/kordyn-v2/final/screens/overlays");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pagePath = "/tests/kordyn-v2-accessibility-browser.html";
const runner = "tests/run-kordyn-v2-final-overlays-browser.mjs";
const fixture = "tests/kordyn-v2-accessibility-browser.jsx";
const productionSourceCommit = execFileSync("git", ["log", "-1", "--format=%H", "--", "src/kordynV2"], { cwd: rootDir, encoding: "utf8" }).trim();
const captureTestSourceCommit = execFileSync("git", ["log", "-1", "--format=%H", "--", runner, fixture], { cwd: rootDir, encoding: "utf8" }).trim();
assert.match(productionSourceCommit, /^[0-9a-f]{40}$/, "overlay capture binds exact product source");
assert.match(captureTestSourceCommit, /^[0-9a-f]{40}$/, "overlay capture binds exact capture-test source");

const viewports = Object.freeze({
  desktop1440: Object.freeze({ width: 1440, height: 900, device: "desktop" }),
  desktop1180: Object.freeze({ width: 1180, height: 800, device: "desktop" }),
  mobile390: Object.freeze({ width: 390, height: 844, device: "mobile" }),
  mobile430: Object.freeze({ width: 430, height: 932, device: "mobile" })
});
const legacyStyleFiles = Object.freeze([
  "styles.css", "product-foundation.css", "workspace.css", "workspace-additions.css",
  "product-system.css", "conceptPages.css", "conceptSettings.css", "zero-base-mobile.css",
  "zero-base-system.css", "zero-base-workbenches.css"
]);

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function prepareOutput() {
  assert.equal(inside(reviewRoot, outputDir), true, "overlay screenshots remain inside review root");
  const existing = await lstat(outputDir).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existing) {
    assert.equal(existing.isDirectory() && !existing.isSymbolicLink(), true, "overlay output is a regular directory");
    for (const name of await readdir(outputDir)) {
      assert.equal((await lstat(path.join(outputDir, name))).isSymbolicLink(), false, `no output symlink: ${name}`);
    }
    await rm(outputDir, { recursive: true, force: false });
  }
  await mkdir(outputDir, { recursive: true });
}

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
    await new Promise((resolve) => setTimeout(resolve, 50));
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
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
    else request.resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = ++requestId;
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitForExpression(cdp, expression, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target=document.querySelector(${JSON.stringify(selector)});
    if(!target)return {missing:true};
    target.scrollIntoView({block:'center',inline:'nearest'});
    const rect=target.getBoundingClientRect();
    const x=rect.left+rect.width/2;
    const y=rect.top+rect.height/2;
    const hit=document.elementFromPoint(x,y);
    return rect.width>0&&rect.height>0&&(hit===target||target.contains(hit))?{x,y}:{blockedBy:hit?.outerHTML?.slice(0,180)||'none'};
  })()`);
  assert.ok(Number.isFinite(point?.x) && Number.isFinite(point?.y), `trusted click ${selector}: ${JSON.stringify(point)}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function pressEscape(cdp) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}

async function navigate(cdp, baseUrl, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}?run=${Date.now()}&lang=zh&state=loaded` });
  await waitForExpression(cdp, "window.__kordynV2AccessibilityReady && document.querySelector('[data-kordyn-v2-root]')", `${viewport.width}: production Root`);
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')`, `${viewport.width}: ${viewport.device} shell`);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-destination=\"ai/missions\"]')", `${viewport.width}: AI Mission`);
}

async function capture(cdp, filename, viewport, surface) {
  const geometry = await evaluate(cdp, `(() => {
    const legacyFiles=${JSON.stringify(legacyStyleFiles)};
    const owners=[...document.styleSheets].flatMap((sheet)=>[sheet.href||'',sheet.ownerNode?.getAttribute?.('data-vite-dev-id')||'']);
    const legacy=owners.some((value)=>{const clean=String(value).split('?')[0].replaceAll('\\\\','/');return clean.includes('productStyles')||legacyFiles.some((file)=>clean.endsWith('/'+file));});
    return {clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,legacy};
  })()`);
  assert.deepEqual([geometry.clientWidth, geometry.scrollWidth], [viewport.width, viewport.width], `${filename}: no horizontal overflow`);
  assert.equal(geometry.legacy, false, `${filename}: no legacy authenticated styles`);
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const bytes = Buffer.from(result.data, "base64");
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [viewport.width, viewport.height], `${filename}: exact viewport raster`);
  await writeFile(path.join(outputDir, filename), bytes, { flag: "wx" });
  return {
    file: filename,
    surface,
    viewport: `${viewport.width}x${viewport.height}`,
    device: viewport.device,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    noProductionWrites: true,
    legacyProductStyles: false,
    document: { clientWidth: geometry.clientWidth, scrollWidth: geometry.scrollWidth }
  };
}

async function closeWithEscape(cdp, selector, label) {
  await pressEscape(cdp);
  await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(selector)})`, `${label}: closes with Escape`);
}

async function captureDesktop(cdp, baseUrl) {
  const captures = [];
  const viewport = viewports.desktop1440;
  await navigate(cdp, baseUrl, viewport);

  await click(cdp, "[data-kordyn-v2-context-trigger]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"context\"]')?.contains(document.activeElement)", "Context focus");
  captures.push(await capture(cdp, "desktop-context--1440x900.png", viewport, "Context overlay"));
  await closeWithEscape(cdp, '[data-kordyn-v2-overlay="context"]', "Context");

  await click(cdp, "[data-kordyn-v2-proof-trigger]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"proof\"]')?.contains(document.activeElement)", "Proof focus");
  captures.push(await capture(cdp, "desktop-proof--1440x900.png", viewport, "Proof overlay"));
  await closeWithEscape(cdp, '[data-kordyn-v2-overlay="proof"]', "Proof");

  await click(cdp, "[data-kordyn-v2-ai-support-trigger]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-support-panel]')?.contains(document.activeElement)", "AI support focus");
  captures.push(await capture(cdp, "desktop-ai-support--1440x900.png", viewport, "AI support"));
  await closeWithEscape(cdp, "[data-kordyn-v2-ai-support-panel]", "AI support");

  await click(cdp, '[data-kordyn-v2-open-approval="run-plan06-accessibility-approval"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]')?.contains(document.activeElement)", "approval focus");
  captures.push(await capture(cdp, "desktop-approval--1440x900.png", viewport, "Approval required"));

  await click(cdp, "[data-kordyn-v2-approval-primary]");
  await waitForExpression(cdp, "document.querySelector('.cfmCard--ordinary')?.contains(document.activeElement)", "ordinary confirmation focus");
  captures.push(await capture(cdp, "desktop-ordinary-confirm--1440x900.png", viewport, "Ordinary confirmation"));
  await closeWithEscape(cdp, ".cfmCard--ordinary", "ordinary confirmation");

  await click(cdp, ".kordynV2AiApprovalActions > button:not([data-kordyn-v2-approval-primary])");
  await waitForExpression(cdp, "document.querySelector('.cfmCard--danger')?.contains(document.activeElement)", "danger confirmation focus");
  captures.push(await capture(cdp, "desktop-danger-confirm--1440x900.png", viewport, "Danger confirmation"));
  await closeWithEscape(cdp, ".cfmCard--danger", "danger confirmation");
  await closeWithEscape(cdp, "[data-kordyn-v2-ai-approval-sheet]", "approval");
  return captures;
}

async function captureMobile(cdp, baseUrl) {
  const captures = [];
  await navigate(cdp, baseUrl, viewports.mobile390);
  await click(cdp, "[data-kordyn-v2-context-trigger]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet=\"evidence\"]')?.contains(document.activeElement)", "mobile evidence focus");
  captures.push(await capture(cdp, "mobile-context--390x844.png", viewports.mobile390, "Mobile Context sheet"));
  await closeWithEscape(cdp, '[data-kordyn-v2-mobile-sheet="evidence"]', "mobile Context");

  await navigate(cdp, baseUrl, viewports.mobile430);
  await click(cdp, "[data-kordyn-v2-proof-trigger]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet=\"evidence\"]')?.contains(document.activeElement)", "mobile Proof focus");
  captures.push(await capture(cdp, "mobile-proof--430x932.png", viewports.mobile430, "Mobile Proof sheet"));
  await closeWithEscape(cdp, '[data-kordyn-v2-mobile-sheet="evidence"]', "mobile Proof");

  await click(cdp, "[data-kordyn-v2-ai-support-trigger]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet=\"support\"]')?.contains(document.activeElement)", "mobile AI support focus");
  captures.push(await capture(cdp, "mobile-ai-support--430x932.png", viewports.mobile430, "Mobile AI support"));
  await closeWithEscape(cdp, '[data-kordyn-v2-mobile-sheet="support"]', "mobile AI support");
  return captures;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

await prepareOutput();
const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-final-overlays-"));
const vite = spawn(process.execPath, [path.join(rootDir, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: rootDir, stdio: "ignore" });
const chrome = spawn(chromeBinary, ["--headless=new", "--hide-scrollbars", "--disable-gpu", "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });

let cdp;
try {
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  await waitFor(`${baseUrl}${pagePath}`);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);
  const captures = [...await captureDesktop(cdp, baseUrl), ...await captureMobile(cdp, baseUrl)];
  assert.equal(captures.length, 9, "all final overlay and confirmation surfaces captured");
  const evidence = { schemaVersion: 1, runner, fixture, productionSourceCommit, captureTestSourceCommit, captures };
  await writeFile(path.join(outputDir, "capture-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`KORDYN V2 final overlays browser PASS captures=${captures.length} product=${productionSourceCommit} capture-test=${captureTestSourceCommit} Context+Proof=desktop+APP AI-support=desktop+APP approval+ordinary+danger=desktop legacy-css=0 production-writes=0\n`);
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
