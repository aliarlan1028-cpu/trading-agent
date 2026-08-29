import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outputDir = path.resolve(process.env.KORDYN_V2_TASK2_SCREENSHOT_DIR || "/private/tmp/kordyn-v2-task2-fix");
const pagePath = "/tests/kordyn-v2-shell-browser.html";
const viewports = [
  { width: 1440, height: 900, device: "desktop" },
  { width: 1180, height: 820, device: "desktop" },
  { width: 390, height: 844, device: "mobile" },
  { width: 430, height: 932, device: "mobile" }
];

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
    await new Promise((resolve) => setTimeout(resolve, 60));
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
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function waitForExpression(cdp, expression, label) {
  const deadline = Date.now() + 20_000;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return null;
    target.scrollIntoView({ block:'center', inline:'nearest' });
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.right > innerWidth || rect.top < 0 || rect.bottom > innerHeight) return null;
    return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
  })()`);
  assert.ok(point, `click target is visibly laid out: ${selector}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
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

async function capture(cdp, filename, width, height) {
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  const bytes = Buffer.from(result.data, "base64");
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [width, height]);
  const outputPath = path.join(outputDir, filename);
  await writeFile(outputPath, bytes);
  return outputPath;
}

async function verifyViewport(cdp, baseUrl, { width, height, device }) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    screenWidth: width,
    screenHeight: height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}` });
  await waitForExpression(
    cdp,
    `window.__kordynV2ShellReady && document.querySelector('[data-kordyn-v2-shell="${device}"]')`,
    `${width}x${height} ${device} shell`
  );
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-selected-mission=\"run-btc-analysis\"]')", `${width}: projected Mission`);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });

  const initial = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="${device}"]');
    const mission = root.querySelector('[data-kordyn-v2-selected-mission="run-btc-analysis"]');
    const progress = mission.querySelector('.kordynV2AiMissionProgress');
    const actions = [...root.querySelectorAll('.kordynV2AiMobileAction')];
    const focusTarget = mission.querySelector('[data-kordyn-v2-mission-proof="run-btc-analysis"]');
    const relatedContext = root.querySelector('section[data-kordyn-v2-mission-related-context="run-btc-analysis"]');
    const evidenceFact = [...(relatedContext?.querySelectorAll('dt') || mission.querySelectorAll('dt'))].find((node) => ['Evidence','证据'].includes(node.textContent.trim()));
    focusTarget.focus();
    const focusStyle = getComputedStyle(focusTarget);
    const text = mission.textContent;
    return {
      document:[document.documentElement.clientWidth,document.documentElement.scrollWidth],
      canvas:[root.querySelector('[data-kordyn-v2-work-canvas]').clientWidth,root.querySelector('[data-kordyn-v2-work-canvas]').scrollWidth],
      selectedId:root.dataset.kordynV2SelectedId,
      missionText:text,
      contextEvidence:evidenceFact?.nextElementSibling?.textContent?.trim() || null,
      planVisible:root.textContent.includes('plan-btc-mission'),
      progressCount:progress.querySelectorAll('li').length,
      currentCount:progress.querySelectorAll('[aria-current="step"]').length,
      currentStage:progress.querySelector('[aria-current="step"]')?.dataset.stageId || null,
      minimumTarget:actions.length ? Math.min(...actions.map((node) => node.getBoundingClientRect().height)) : null,
      focusVisible:focusTarget.matches(':focus-visible'),
      focusPaint:focusStyle.outlineStyle !== 'none' || focusStyle.boxShadow !== 'none'
    };
  })()`);

  assert.deepEqual(initial.document, [width, width], `${width}: no document overflow`);
  assert.ok(initial.canvas[1] <= initial.canvas[0] + 1, `${width}: no canvas overflow`);
  assert.equal(initial.selectedId, "run-btc-analysis");
  for (const text of ["BTC 趋势延续结构", "账户、证据与硬风控已核对", "确认计划后继续监控"]) {
    assert.ok(initial.missionText.includes(text), `${width}: projected Mission exposes ${text}`);
  }
  assert.equal(initial.contextEvidence, "3", `${width}: projected Mission Evidence remains visible in related Context`);
  assert.equal(initial.planVisible, true, `${width}: approval link remains visible`);
  assert.equal(initial.progressCount, 5, `${width}: five-stage density`);
  assert.equal(initial.currentCount, 1, `${width}: one current stage`);
  assert.equal(initial.currentStage, "approval", `${width}: current approval stage`);
  assert.equal(initial.focusVisible || initial.focusPaint, true, `${width}: visible focus paint`);
  if (device === "mobile") assert.ok(initial.minimumTarget >= 44, `${width}: APP targets are at least 44px`);

  const rowSelector = device === "desktop"
    ? '.kordynV2AiMissionRegistry [data-kordyn-v2-object-id="run-btc-complete"]'
    : '.kordynV2AiMobileRecent [data-kordyn-v2-object-id="run-btc-complete"]';
  await click(cdp, rowSelector);
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${device}"]')?.dataset.kordynV2SelectedId === 'run-btc-complete'`, `${width}: real Mission selection`);

  const selected = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="${device}"]');
    const mission = root.querySelector('[data-kordyn-v2-selected-mission="run-btc-complete"]');
    const relatedContext = root.querySelector('section[data-kordyn-v2-mission-related-context="run-btc-complete"]');
    const evidenceFact = [...(relatedContext?.querySelectorAll('dt') || mission.querySelectorAll('dt'))].find((node) => ['Evidence','证据'].includes(node.textContent.trim()));
    return {
      id:root.dataset.kordynV2SelectedId,
      text:mission.textContent,
      evidence:evidenceFact?.nextElementSibling?.textContent?.trim() || null,
      stage:mission.querySelector('[aria-current="step"]')?.dataset.stageId || null
    };
  })()`);
  assert.equal(selected.id, "run-btc-complete");
  assert.equal(selected.stage, "review");
  for (const text of ["BTC 突破回踩机会", "本轮结果已进入复盘", "查看实盘复盘"]) {
    assert.ok(selected.text.includes(text), `${width}: selected Mission exposes ${text}`);
  }
  assert.equal(selected.evidence, "2", `${width}: selected Mission Evidence remains visible in its device-specific Context`);

  await click(cdp, '[data-kordyn-v2-selected-mission="run-btc-complete"] [data-kordyn-v2-mission-proof="run-btc-complete"]');

  const overlaySelector = device === "desktop" ? '[data-kordyn-v2-overlay="proof"]' : '[data-kordyn-v2-mobile-sheet="evidence"]';
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(overlaySelector)})`, `${width}: Mission Proof opens`);
  await waitForExpression(
    cdp,
    `document.querySelector(${JSON.stringify(overlaySelector)})?.contains(document.activeElement)`,
    `${width}: Mission Proof receives focus`
  );
  const proof = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="${device}"]');
    const overlay = document.querySelector(${JSON.stringify(overlaySelector)});
    const identity = overlay.querySelector('.kordynV2OverlayIdentity, .kordynV2MobileSheetIdentity')?.textContent?.trim() || '';
    const close = overlay.querySelector('[data-kordyn-v2-overlay-close], [data-kordyn-v2-mobile-sheet-close]');
    return {
      globalId:root.dataset.kordynV2SelectedId,
      globalType:root.dataset.kordynV2SelectedType,
      identity,
      text:overlay.textContent,
      closeFocused:close === document.activeElement
    };
  })()`);
  assert.equal(proof.globalId, "run-btc-complete", `${width}: Proof does not mutate global selection`);
  assert.equal(proof.globalType, "Agent run", `${width}: Root exposes the selected canonical Mission type`);
  assert.match(proof.identity, /Agent run \/ run-btc-complete/, `${width}: Proof snapshots visible Mission identity`);
  for (const exact of ["2026-08-27T05:20:00Z", "Unavailable", "2026-08-27T05:43:00Z"]) {
    assert.ok(proof.text.includes(exact), `${width}: actual Mission Proof exposes receipt ${exact}`);
  }
  assert.equal(proof.closeFocused, true, `${width}: Proof moves focus inside dialog`);

  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(overlaySelector)})`, `${width}: Proof closes`);
  const focusReturned = await evaluate(cdp, `document.activeElement === document.querySelector('[data-kordyn-v2-mission-proof="run-btc-complete"]')`);
  assert.equal(focusReturned, true, `${width}: Proof restores trigger focus`);

  const screenshot = await capture(cdp, `${device}-${width}x${height}.png`, width, height);
  return { width, height, device, screenshot, initial, proof };
}

await mkdir(outputDir, { recursive: true });
const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-task2-browser-"));
const vite = spawn(process.execPath, [
  path.join(rootDir, "node_modules/vite/bin/vite.js"),
  "--host", "127.0.0.1",
  "--port", String(vitePort),
  "--strictPort"
], { cwd: rootDir, stdio: "ignore" });
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-default-apps",
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
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  await waitFor(`${baseUrl}${pagePath}`);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);
  const results = [];
  for (const viewport of viewports) results.push(await verifyViewport(cdp, baseUrl, viewport));
  process.stdout.write(`KORDYN V2 AI Mission browser PASS ${results.map((row) => `${row.width}x${row.height}:${row.device},overflow=0,stage=${row.initial.currentStage},proof=run-btc-complete`).join(" ")} screenshots=${outputDir}\n`);
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
