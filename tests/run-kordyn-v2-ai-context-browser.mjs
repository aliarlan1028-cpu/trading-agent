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
const outputDir = path.resolve(process.env.KORDYN_V2_TASK3_SCREENSHOT_DIR || "/private/tmp/kordyn-v2-task3");
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
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return null;
    target.scrollIntoView({ block:'center', inline:'center' });
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.left < -1 || rect.right > innerWidth + 1 || rect.top < -1 || rect.bottom > innerHeight + 1) return null;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return hit === target || target.contains(hit) ? { x, y } : { blockedBy:[hit?.tagName, hit?.className, hit?.getAttribute?.('aria-label'), hit?.parentElement?.className, hit?.textContent?.trim()].filter(Boolean).join(':').slice(0,180) || 'unknown' };
  })()`);
  assert.ok(Number.isFinite(point?.x) && Number.isFinite(point?.y), `click target is visibly laid out and topmost: ${selector}; blockedBy=${point?.blockedBy || 'geometry'}`);
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

async function resetScroll(cdp) {
  await evaluate(cdp, `(() => {
    window.scrollTo(0, 0);
    for (const node of document.querySelectorAll('*')) {
      if (node.scrollTop) node.scrollTop = 0;
      if (node.scrollLeft) node.scrollLeft = 0;
    }
    return true;
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 40));
}

async function setViewport(cdp, { width, height }) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    screenWidth: width,
    screenHeight: height,
    deviceScaleFactor: 1,
    mobile: false
  });
}

async function navigatePage(cdp, baseUrl, viewport, scenario = "default") {
  await setViewport(cdp, viewport);
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}?scenario=${encodeURIComponent(scenario)}` });
  await waitForExpression(
    cdp,
    `window.__kordynV2ShellReady && document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')`,
    `${viewport.width}x${viewport.height} ${scenario} shell`
  );
}

async function navigateWorkspace(cdp, device, workspaceId, layout) {
  await click(cdp, `[data-kordyn-v2-workspace-target="${workspaceId}"]`);
  await waitForExpression(
    cdp,
    `document.querySelector('[data-kordyn-v2-shell="${device}"]')?.dataset.kordynV2Workspace === ${JSON.stringify(workspaceId)} && document.querySelector('[data-kordyn-v2-layout="${layout}"]')`,
    `${device} ${workspaceId} workspace`
  );
}

async function assertNoOverflow(cdp, device, width, label) {
  const geometry = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="${device}"]');
    const canvas = root.querySelector('[data-kordyn-v2-work-canvas]');
    return {
      document:[document.documentElement.clientWidth,document.documentElement.scrollWidth],
      root:[root.clientWidth,root.scrollWidth],
      canvas:canvas ? [canvas.clientWidth,canvas.scrollWidth] : null
    };
  })()`);
  assert.deepEqual(geometry.document, [width, width], `${label}: no document overflow`);
  assert.ok(geometry.root[1] <= geometry.root[0] + 1, `${label}: no root overflow`);
  if (geometry.canvas) assert.ok(geometry.canvas[1] <= geometry.canvas[0] + 1, `${label}: no canvas overflow`);
}

async function selectCanonical(cdp, { device, type, id }) {
  if (device === "mobile") {
    const heroOwnsObject = await evaluate(cdp, `Boolean(document.querySelector('[data-kordyn-v2-selected-context="${id}"]'))`);
    if (heroOwnsObject) {
      await click(cdp, `[data-kordyn-v2-selected-context="${id}"] footer button:first-child`);
    } else {
      await click(cdp, `button[data-kordyn-v2-object-id="${id}"][data-kordyn-v2-object-type="${type}"]`);
    }
  } else {
    await click(cdp, `button[data-kordyn-v2-object-id="${id}"][data-kordyn-v2-object-type="${type}"]`);
  }
  await waitForExpression(
    cdp,
    `document.querySelector('[data-kordyn-v2-shell="${device}"]')?.dataset.kordynV2SelectedId === ${JSON.stringify(id)}`,
    `${device} selects ${type}/${id}`
  );
}

async function closeOverlay(cdp, selector) {
  const closeSelector = `${selector} [data-kordyn-v2-overlay-close], ${selector} [data-kordyn-v2-mobile-sheet-close]`;
  await click(cdp, closeSelector);
  await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(selector)})`, `close ${selector}`);
}

async function verifyProof(cdp, { device, type, id, evidence }) {
  await click(cdp, `[data-kordyn-v2-context-proof="${id}"]`);
  const overlaySelector = device === "desktop" ? '[data-kordyn-v2-overlay="proof"]' : '[data-kordyn-v2-mobile-sheet="evidence"]';
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(overlaySelector)})`, `${type}/${id} Proof opens`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(overlaySelector)})?.contains(document.activeElement)`, `${type}/${id} Proof focus`);
  const proof = await evaluate(cdp, `(() => {
    const overlay = document.querySelector(${JSON.stringify(overlaySelector)});
    const identity = overlay.querySelector('.kordynV2OverlayIdentity, .kordynV2MobileSheetIdentity')?.textContent?.trim() || '';
    return { identity, text:overlay.textContent, focused:overlay.contains(document.activeElement) };
  })()`);
  assert.match(proof.identity, new RegExp(`${type} / ${id}`));
  assert.ok(proof.text.includes(evidence), `${type}/${id}: Proof includes authoritative evidence`);
  assert.equal(proof.focused, true, `${type}/${id}: Proof receives focus`);
  await closeOverlay(cdp, overlaySelector);

  if (device === "desktop") {
    await click(cdp, "[data-kordyn-v2-context-trigger]");
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-overlay="context"]')`, `${type}/${id} Context opens`);
    const identity = await evaluate(cdp, `document.querySelector('[data-kordyn-v2-overlay="context"] .kordynV2OverlayIdentity')?.textContent?.trim()`);
    assert.match(identity, new RegExp(`${type} / ${id}`));
    await closeOverlay(cdp, '[data-kordyn-v2-overlay="context"]');
  }
}

async function verifyReadonly(cdp, { device, expectedTitle, canonicalId }) {
  await click(cdp, "button[data-kordyn-v2-readonly-fact=\"true\"]");
  await waitForExpression(
    cdp,
    `[...document.querySelectorAll('[data-kordyn-v2-selected-context]')].some((node) => node.textContent.includes(${JSON.stringify(expectedTitle)}))`,
    `${device} readonly ${expectedTitle} detail`
  );
  const state = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="${device}"]');
    const local = [...document.querySelectorAll('[data-kordyn-v2-selected-context]')].find((node) => node.textContent.includes(${JSON.stringify(expectedTitle)}));
    return {
      globalId:root.dataset.kordynV2SelectedId,
      localIdentity:local?.dataset.kordynV2SelectedContext,
      hasCanonicalAttrs:Boolean(local?.querySelector('[data-kordyn-v2-object-id], [data-kordyn-v2-object-type]')),
      proofEnabled:Boolean(local?.querySelector('[data-kordyn-v2-context-proof]:not([disabled])'))
    };
  })()`);
  assert.equal(state.globalId, canonicalId, `${device}: readonly inspection does not mutate global selection`);
  assert.equal(state.localIdentity, "Unavailable", `${device}: readonly detail does not invent an identity`);
  assert.equal(state.hasCanonicalAttrs, false, `${device}: readonly detail exposes no canonical attributes`);
  assert.equal(state.proofEnabled, false, `${device}: readonly detail cannot open Proof`);
}

async function runContextAction(cdp, selector, processingKind, finalKind, expectedText) {
  const disabled = await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.disabled`);
  assert.equal(disabled, false, `${selector}: action is enabled only after canonical selection`);
  await click(cdp, selector);
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-action-state="${processingKind}"]')`, `${selector} processing`);
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-action-state="${finalKind}"]')`, `${selector} ${finalKind}`);
  const text = await evaluate(cdp, `document.querySelector('[data-kordyn-v2-action-state="${finalKind}"]')?.textContent || ''`);
  assert.ok(text.includes(expectedText), `${selector}: exposes bounded authoritative outcome`);
}

async function assertMobileActionClearance(cdp, actionSelector, label) {
  const geometry = await evaluate(cdp, `(() => {
    const selectors = {
      action:${JSON.stringify(actionSelector)},
      prompt:'[data-kordyn-v2-dialog-trigger]',
      support:'[data-kordyn-v2-ai-support-trigger]',
      navigation:'.kordynV2MobileBottomNavigation'
    };
    const rects = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
      const node = document.querySelector(selector);
      if (!node) return [key, null];
      const rect = node.getBoundingClientRect();
      return [key, { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height }];
    }));
    const overlap = (left, right) => !left || !right ? null : Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left)) * Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
    return {
      rects,
      overlaps:{
        actionPrompt:overlap(rects.action, rects.prompt),
        actionSupport:overlap(rects.action, rects.support),
        actionNavigation:overlap(rects.action, rects.navigation),
        promptSupport:overlap(rects.prompt, rects.support),
        promptNavigation:overlap(rects.prompt, rects.navigation),
        supportNavigation:overlap(rects.support, rects.navigation)
      }
    };
  })()`);
  for (const [name, rect] of Object.entries(geometry.rects)) assert.ok(rect && rect.width >= 44 && rect.height >= 44, `${label}: ${name} exists with a 44px target`);
  for (const [name, overlap] of Object.entries(geometry.overlaps)) assert.equal(overlap, 0, `${label}: ${name} has zero overlap`);
}

async function assertDesktopPromptClearance(cdp, label) {
  const geometry = await evaluate(cdp, `(() => {
    const prompt = document.querySelector('[data-kordyn-v2-dialog-trigger]')?.getBoundingClientRect();
    const support = document.querySelector('[data-kordyn-v2-ai-support-trigger]')?.getBoundingClientRect();
    if (!prompt || !support) return null;
    const width = Math.max(0, Math.min(prompt.right, support.right) - Math.max(prompt.left, support.left));
    const height = Math.max(0, Math.min(prompt.bottom, support.bottom) - Math.max(prompt.top, support.top));
    return { prompt:{ width:prompt.width, height:prompt.height }, support:{ width:support.width, height:support.height }, overlap:width * height };
  })()`);
  assert.ok(geometry, `${label}: prompt and support exist`);
  assert.ok(geometry.prompt.width >= 44 && geometry.prompt.height >= 44, `${label}: prompt is actionable`);
  assert.ok(geometry.support.width >= 44 && geometry.support.height >= 44, `${label}: support is actionable`);
  assert.equal(geometry.overlap, 0, `${label}: prompt and support have zero overlap`);
}

async function verifyDialogPrompt(cdp, device, label) {
  await click(cdp, "[data-kordyn-v2-dialog-trigger]");
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-dialog-surface][data-kordyn-v2-destination="ai/dialog"]')`, `${label}: real AI dialog opens`);
  await click(cdp, '[data-kordyn-v2-dialog-surface] button[aria-label="关闭对话并返回任务"]');
  await waitForExpression(cdp, `!document.querySelector('[data-kordyn-v2-dialog-surface]') && document.querySelector('[data-kordyn-v2-shell="${device}"]')?.dataset.kordynV2Workspace === 'missions'`, `${label}: dialog returns to Mission`);
}

async function verifyViewport(cdp, baseUrl, viewport) {
  const { width, height, device } = viewport;
  await navigatePage(cdp, baseUrl, viewport);

  await navigateWorkspace(cdp, device, "intelligence", device === "desktop" ? "signals-registry-inspector" : "signals-task-flow");
  await assertNoOverflow(cdp, device, width, `${width} Signals`);
  await selectCanonical(cdp, { device, type: "Signal", id: "signal-cpi-flow" });
  await verifyProof(cdp, { device, type: "Signal", id: "signal-cpi-flow", evidence: "Authoritative intelligence fact loaded" });
  await verifyReadonly(cdp, { device, expectedTitle: "未识别来源事实", canonicalId: "signal-cpi-flow" });
  await selectCanonical(cdp, { device, type: "Signal", id: "signal-cpi-flow" });
  let signalTopShot = null;
  if (device === "mobile") {
    await resetScroll(cdp);
    signalTopShot = await capture(cdp, `${device}-${width}x${height}-signals-top.png`, width, height);
  }
  await runContextAction(cdp, '[data-kordyn-v2-context-action="remember"]', "processing", "succeeded", "memory-browser-1");
  const signalShot = await capture(cdp, `${device}-${width}x${height}-signals.png`, width, height);

  await navigateWorkspace(cdp, device, "watch", device === "desktop" ? "watch-registry-inspector" : "watch-task-flow");
  await assertNoOverflow(cdp, device, width, `${width} Watch`);
  await selectCanonical(cdp, { device, type: "Watch", id: "watch-eth-retest" });
  await verifyProof(cdp, { device, type: "Watch", id: "watch-eth-retest", evidence: "Waiting for retest" });
  await verifyReadonly(cdp, { device, expectedTitle: "未识别观察哨事实", canonicalId: "watch-eth-retest" });
  await selectCanonical(cdp, { device, type: "Watch", id: "watch-eth-retest" });
  let watchTopShot = null;
  if (device === "mobile") {
    await resetScroll(cdp);
    watchTopShot = await capture(cdp, `${device}-${width}x${height}-watch-top.png`, width, height);
  }
  await runContextAction(cdp, '[data-kordyn-v2-context-action="cancel-watch"]', "processing", "succeeded", "watch-eth-retest");
  const watchTruth = await evaluate(cdp, `document.querySelector('[data-kordyn-v2-selected-context="watch-eth-retest"]')?.textContent || ''`);
  assert.match(watchTruth, /active/, `${width}: Watch stays authoritative and visible after server result`);
  const watchShot = await capture(cdp, `${device}-${width}x${height}-watch.png`, width, height);

  await navigateWorkspace(cdp, device, "events", device === "desktop" ? "events-calendar-inspector" : "events-task-flow");
  await assertNoOverflow(cdp, device, width, `${width} Events`);
  await selectCanonical(cdp, { device, type: "Event", id: "event-fomc-date" });
  await verifyProof(cdp, { device, type: "Event", id: "event-fomc-date", evidence: "Official calendar fact loaded" });
  await verifyReadonly(cdp, { device, expectedTitle: "未识别日历事实", canonicalId: "event-fomc-date" });
  await selectCanonical(cdp, { device, type: "Event", id: "event-fomc-date" });
  let eventTopShot = null;
  if (device === "mobile") {
    await resetScroll(cdp);
    await assertMobileActionClearance(cdp, '[data-kordyn-v2-context-action="refresh-events"]', `${width} Event protected action clearance`);
    eventTopShot = await capture(cdp, `${device}-${width}x${height}-events-top.png`, width, height);
  } else {
    await assertDesktopPromptClearance(cdp, `${width} Event prompt clearance`);
  }
  await runContextAction(cdp, '[data-kordyn-v2-context-action="refresh-events"]', "processing", "partial", "成功 2/3");
  const eventShot = await capture(cdp, `${device}-${width}x${height}-events.png`, width, height);

  await verifyDialogPrompt(cdp, device, `${width} Event prompt`);
  const globalBeforeProof = await evaluate(cdp, `document.querySelector('[data-kordyn-v2-shell="${device}"]')?.dataset.kordynV2SelectedId`);
  assert.equal(globalBeforeProof, "event-fomc-date", `${width}: non-Mission selection survives Mission navigation`);
  await click(cdp, '[data-kordyn-v2-mission-proof="run-btc-analysis"]');
  const missionOverlay = device === "desktop" ? '[data-kordyn-v2-overlay="proof"]' : '[data-kordyn-v2-mobile-sheet="evidence"]';
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(missionOverlay)})`, `${width}: Mission Proof after non-Mission selection`);
  const missionProof = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="${device}"]');
    const overlay = document.querySelector(${JSON.stringify(missionOverlay)});
    return {
      globalId:root.dataset.kordynV2SelectedId,
      identity:overlay.querySelector('.kordynV2OverlayIdentity, .kordynV2MobileSheetIdentity')?.textContent?.trim() || ''
    };
  })()`);
  assert.equal(missionProof.globalId, "event-fomc-date", `${width}: Mission Proof does not mutate non-Mission selection`);
  assert.match(missionProof.identity, /Agent run \/ run-btc-analysis/, `${width}: Mission Proof snapshots visible Mission`);
  await closeOverlay(cdp, missionOverlay);

  const calls = await evaluate(cdp, "window.__kordynV2BrowserCalls");
  assert.deepEqual(calls.actionRequests.map((row) => row.endpoint), [
    "/api/agent/memory",
    "/api/watch-triggers/watch-eth-retest/cancel",
    "/api/event-sources/refresh",
    "/api/agent/chat"
  ]);
  if (device === "mobile") {
    const minimumTarget = await evaluate(cdp, `Math.min(...[...document.querySelectorAll('.kordynV2AiMobileAction')].map((node) => node.getBoundingClientRect().height))`);
    assert.ok(minimumTarget >= 44, `${width}: APP action targets are at least 44px`);
  }
  return { width, height, device, signalShot, watchShot, eventShot, signalTopShot, watchTopShot, eventTopShot };
}

async function verifyState(cdp, baseUrl, viewport, scenario, kind, workspaceId, layout) {
  await navigatePage(cdp, baseUrl, viewport, scenario);
  await click(cdp, `[data-kordyn-v2-workspace-target="${workspaceId}"]`);
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-state="${kind}"]')`, `${viewport.width} ${kind} state`);
  await assertNoOverflow(cdp, viewport.device, viewport.width, `${viewport.width} ${kind}`);
  const state = await evaluate(cdp, `(() => {
    const boundary = document.querySelector('[data-kordyn-v2-state="${kind}"]');
    const workspace = document.querySelector('[data-kordyn-v2-layout="${layout}"]');
    const actions = [...document.querySelectorAll('[data-kordyn-v2-context-action]')];
    return {
      workspaceVisible:Boolean(workspace),
      actionCount:actions.length,
      enabledCount:actions.filter((node) => !node.disabled).length,
      text:boundary.textContent
    };
  })()`);
  if (kind === "forbidden") {
    assert.equal(state.workspaceVisible, false, "forbidden hides protected workspace facts");
    assert.equal(state.actionCount, 0, "forbidden exposes no protected actions");
    assert.match(state.text, /无权访问/);
  } else {
    assert.equal(state.workspaceVisible, true, `${kind} retains last-valid facts`);
    assert.ok(state.actionCount > 0, `${kind} retains visible actions`);
    assert.equal(state.enabledCount, 0, `${kind} disables every write`);
    const callsBefore = await evaluate(cdp, "window.__kordynV2BrowserCalls.actions");
    await evaluate(cdp, "document.querySelector('[data-kordyn-v2-context-action]')?.click()");
    await new Promise((resolve) => setTimeout(resolve, 120));
    const callsAfter = await evaluate(cdp, "window.__kordynV2BrowserCalls.actions");
    assert.equal(callsAfter, callsBefore, `${kind}: disabled action cannot produce a production request`);
  }
  return await capture(cdp, `${viewport.device}-${viewport.width}x${viewport.height}-${kind}.png`, viewport.width, viewport.height);
}

await mkdir(outputDir, { recursive: true });
const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-task3-browser-"));
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
  const stateShots = [
    await verifyState(cdp, baseUrl, viewports[0], "ai-context-stale", "stale", "intelligence", "signals-registry-inspector"),
    await verifyState(cdp, baseUrl, viewports[1], "ai-context-degraded", "degraded", "watch", "watch-registry-inspector"),
    await verifyState(cdp, baseUrl, viewports[2], "ai-context-forbidden", "forbidden", "events", "events-task-flow")
  ];
  const screenshotCount = results.reduce((sum, row) => sum + 3 + [row.signalTopShot, row.watchTopShot, row.eventTopShot].filter(Boolean).length, 0) + stateShots.length;
  process.stdout.write(`KORDYN V2 AI Context browser PASS ${results.map((row) => `${row.width}x${row.height}:${row.device},overflow=0,Signal+Watch+Event+actions+Proof`).join(" ")} states=stale+degraded+forbidden screenshots=${screenshotCount}:${outputDir}\n`);
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
