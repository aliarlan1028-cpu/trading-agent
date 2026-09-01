import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewRoot = path.join(rootDir, ".impeccable/review/kordyn-v2");
const outputDir = path.resolve(rootDir, process.env.KORDYN_V2_SCREENSHOT_DIR || ".impeccable/review/kordyn-v2/assets");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pagePath = "/tests/kordyn-v2-assets-browser.html";
const runner = "tests/run-kordyn-v2-assets-browser.mjs";
const fixture = "tests/kordyn-v2-assets-browser.jsx";
const productionSourceCommit = execFileSync("git", ["log", "-1", "--format=%H", "--", "src/kordynV2"], { cwd: rootDir, encoding: "utf8" }).trim();
const captureTestSourceCommit = execFileSync("git", ["log", "-1", "--format=%H", "--", runner, fixture, "scripts/compare-kordyn-v2-concepts.mjs"], { cwd: rootDir, encoding: "utf8" }).trim();
assert.match(productionSourceCommit, /^[0-9a-f]{40}$/, "asset capture binds exact product source");
assert.match(captureTestSourceCommit, /^[0-9a-f]{40}$/, "asset capture binds exact capture-test source");

const viewports = Object.freeze({
  desktop1440: Object.freeze({ width: 1440, height: 900, device: "desktop" }),
  desktop1180: Object.freeze({ width: 1180, height: 800, device: "desktop" }),
  mobile390: Object.freeze({ width: 390, height: 844, device: "mobile" }),
  mobile430: Object.freeze({ width: 430, height: 932, device: "mobile" })
});
const markers = Object.freeze({
  relationships: '[data-kordyn-v2-assets-workspace="relationships"], [data-kordyn-v2-assets-mobile="relationships"]',
  strategies: '[data-kordyn-v2-assets-workspace="strategies"], [data-kordyn-v2-assets-mobile="strategies"]',
  knowledge: '[data-kordyn-v2-assets-workspace="knowledge"], [data-kordyn-v2-assets-mobile="knowledge"]',
  capabilities: '[data-kordyn-v2-assets-workspace="capabilities"], [data-kordyn-v2-assets-mobile="capabilities"]',
  reviews: '[data-kordyn-v2-assets-workspace="reviews"], [data-kordyn-v2-assets-mobile="reviews"]'
});
const legacyStyleFiles = Object.freeze(["styles.css", "product-foundation.css", "workspace.css", "workspace-additions.css", "product-system.css", "conceptPages.css", "conceptSettings.css", "zero-base-mobile.css", "zero-base-system.css", "zero-base-workbenches.css"]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const viewportName = (viewport) => `${viewport.width}x${viewport.height}`;
const inside = (parent, target) => {
  const relative = path.relative(parent, target);
  return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function prepareOutput() {
  assert.equal(inside(reviewRoot, outputDir), true, "asset screenshots remain inside review root");
  const existing = await lstat(outputDir).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existing) {
    assert.equal(existing.isDirectory() && !existing.isSymbolicLink(), true, "asset output is a regular directory");
    for (const name of await readdir(outputDir)) assert.equal((await lstat(path.join(outputDir, name))).isSymbolicLink(), false, `no output symlink: ${name}`);
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
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  const ready = new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
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
      const id = ++nextId;
      return await new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
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
async function waitForExpression(cdp, expression, label, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}
async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, screenWidth: viewport.width, screenHeight: viewport.height, deviceScaleFactor: 1, mobile: false });
}
async function flush(cdp) {
  await cdp.send("Page.bringToFront").catch(() => null);
  await cdp.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 45));
}
async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return { missing:true, text:document.body.textContent.trim().slice(0,700) };
    target.scrollIntoView({ block:"center", inline:"nearest" });
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1 && (hit === target || target.contains(hit))
      ? { x, y }
      : { blockedBy:hit?.outerHTML?.slice(0,180)||"none", rect:[rect.left,rect.top,rect.right,rect.bottom], viewport:[innerWidth,innerHeight] };
  })()`);
  assert.ok(Number.isFinite(point?.x) && Number.isFinite(point?.y), `trusted click: ${selector}; ${JSON.stringify(point)}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}
async function pressEscape(cdp) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}

async function navigatePage(cdp, baseUrl, viewport, scenario = "ready", result = "success") {
  await setViewport(cdp, viewport);
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}?scenario=${encodeURIComponent(scenario)}&result=${encodeURIComponent(result)}&run=${Date.now()}` });
  await flush(cdp);
  await waitForExpression(cdp, `window.__plan04AssetsReady && document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')`, `${viewportName(viewport)} Root`).catch(async (error) => {
    const diagnostic = await evaluate(cdp, `({ href:location.href, ready:window.__plan04AssetsReady, state:document.readyState, body:document.body?.innerText?.slice(0,900), html:document.body?.innerHTML?.slice(0,900) })`);
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
  });
}
async function navigateAssets(cdp, viewport, workspace = "relationships") {
  await click(cdp, '[data-kordyn-v2-domain-target="assets"]');
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Domain === "assets"`, `${viewportName(viewport)} assets`);
  if (workspace !== "relationships") await click(cdp, `[data-kordyn-v2-workspace-target="${workspace}"]`);
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Workspace === ${JSON.stringify(workspace)}`, `${viewportName(viewport)} ${workspace}`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers[workspace])})`, `${viewportName(viewport)} ${workspace} content`);
}
async function assertNoOverflow(cdp, viewport, label) {
  const geometry = await evaluate(cdp, `(() => {
    const shell=document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]');
    return { innerWidth, document:[document.documentElement.clientWidth,document.documentElement.scrollWidth], body:[document.body.clientWidth,document.body.scrollWidth], shell:shell?[shell.clientWidth,shell.scrollWidth]:null };
  })()`);
  assert.deepEqual(geometry.document, [viewport.width, viewport.width], `${label}: document overflow ${JSON.stringify(geometry)}`);
  assert.ok(geometry.body[1] <= geometry.innerWidth + 1, `${label}: body overflow ${JSON.stringify(geometry)}`);
  assert.ok(geometry.shell && geometry.shell[1] <= geometry.shell[0] + 1, `${label}: shell overflow ${JSON.stringify(geometry)}`);
  return geometry;
}
async function assertTouchTargets(cdp, label) {
  const failures = await evaluate(cdp, `(() => [...document.querySelectorAll('[data-kordyn-v2-shell="mobile"] button:not([disabled])')].flatMap((button) => {
    if (!button.getClientRects().length) return [];
    const rect=button.getBoundingClientRect();
    return rect.width < 44 || rect.height < 44 ? [{ text:button.textContent.trim().slice(0,60), width:Math.round(rect.width), height:Math.round(rect.height), className:String(button.className||"") }] : [];
  }).slice(0,20))()`);
  assert.deepEqual(failures, [], `${label}: touch targets ${JSON.stringify(failures)}`);
}
async function styleOwnership(cdp) {
  return await evaluate(cdp, `(() => {
    const values=[];
    for (const sheet of document.styleSheets) values.push(sheet.href||sheet.ownerNode?.getAttribute?.('data-vite-dev-id')||'');
    for (const node of document.querySelectorAll('style[data-vite-dev-id],link[rel="stylesheet"]')) values.push(node.getAttribute('data-vite-dev-id')||node.getAttribute('href')||'');
    const clean=values.map((value)=>String(value).split('?')[0].replaceAll('\\\\','/'));
    return { assetsCss:clean.some((value)=>value.endsWith('/src/kordynV2/domains/assets/assets.css')), legacyProductStyles:clean.some((value)=>value.includes('productStyles')||${JSON.stringify(legacyStyleFiles)}.some((file)=>value===file||value.endsWith('/'+file))), owners:clean.filter(Boolean).sort() };
  })()`);
}
async function capture(cdp, file, viewport, extra = {}) {
  const { expectAssetsCss = true, ...evidence } = extra;
  await flush(cdp);
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const bytes = Buffer.from(result.data, "base64");
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [viewport.width, viewport.height], `${file}: dimensions`);
  await writeFile(path.join(outputDir, file), bytes);
  const shell = await evaluate(cdp, `(() => { const node=document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]'); return node?{domainId:node.dataset.kordynV2Domain,workspaceId:node.dataset.kordynV2Workspace,selectedId:node.dataset.kordynV2SelectedId,selectedType:node.dataset.kordynV2SelectedType}:null; })()`);
  const document = await assertNoOverflow(cdp, viewport, file);
  const styles = await styleOwnership(cdp);
  if (expectAssetsCss !== null) assert.equal(styles.assetsCss, expectAssetsCss, `${file}: assets CSS ownership`);
  assert.equal(styles.legacyProductStyles, false, `${file}: no legacy authenticated CSS`);
  return { file, viewport: viewportName(viewport), device: viewport.device, domainId: shell.domainId, workspaceId: shell.workspaceId, viewportGeometry: { width: viewport.width, height: viewport.height }, document: { clientWidth: document.document[0], scrollWidth: document.document[1] }, shell, noProductionWrites: true, legacyProductStyles: false, assetsCss: styles.assetsCss, sha256: sha256(bytes), ...evidence };
}

async function assertEvidencePanel(cdp, viewport, id, type, panel, label) {
  await click(cdp, `[data-kordyn-v2-${panel}-trigger]`);
  const overlay = viewport.device === "mobile" ? '[data-kordyn-v2-mobile-sheet="evidence"]' : `[data-kordyn-v2-overlay="${panel}"]`;
  const identity = viewport.device === "mobile" ? `${overlay} .kordynV2MobileSheetIdentity` : `${overlay} .kordynV2OverlayIdentity`;
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(identity)})?.textContent.includes(${JSON.stringify(`${type} / ${id}`)})`, `${label} ${panel}`);
  const visible = await evaluate(cdp, `document.querySelector(${JSON.stringify(identity)})?.textContent.trim()`);
  if (viewport.device === "mobile" || panel === "proof") {
    const close = viewport.device === "mobile" ? `${overlay} [data-kordyn-v2-mobile-sheet-close]` : `${overlay} [data-kordyn-v2-overlay-close]`;
    await click(cdp, close);
  } else {
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(overlay)})?.contains(document.activeElement)`, `${label} ${panel} focus`);
    await pressEscape(cdp);
  }
  await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(overlay)})`, `${label} close ${panel}`);
  return visible;
}
async function assertSelection(cdp, viewport, id, type, label, panels = true) {
  await waitForExpression(cdp, `(() => { const root=document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]'); return root?.dataset.kordynV2SelectedId===${JSON.stringify(id)}&&root?.dataset.kordynV2SelectedType===${JSON.stringify(type)}; })()`, label);
  const root = await evaluate(cdp, `(() => { const root=document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]'); return {id:root?.dataset.kordynV2SelectedId,type:root?.dataset.kordynV2SelectedType,workspace:root?.dataset.kordynV2Workspace}; })()`);
  assert.deepEqual({ id: root.id, type: root.type }, { id, type }, label);
  const evidence = panels ? { context: await assertEvidencePanel(cdp, viewport, id, type, "context", label), proof: await assertEvidencePanel(cdp, viewport, id, type, "proof", label) } : {};
  return { label, viewport: viewportName(viewport), device: viewport.device, root, ...evidence };
}
async function acceptConfirm(cdp, label) {
  await waitForExpression(cdp, "document.querySelector('.cfmCard')", `${label} confirm`);
  await click(cdp, ".cfmCard .cfmFoot .cfmBtn:last-child");
  await waitForExpression(cdp, "!document.querySelector('.cfmCard')", `${label} confirm close`);
}

async function captureSurfaces(cdp, baseUrl) {
  const captures = [];
  const desktop = [
    ["relationships", "desktop-assets-relationship"], ["strategies", "desktop-strategy-registry"], ["knowledge", "desktop-knowledge-incubator"],
    ["capabilities", "desktop-capability-registry"], ["reviews", "desktop-review-owner-release"]
  ];
  for (const [workspace, prefix] of desktop) {
    for (const viewport of [viewports.desktop1440, viewports.desktop1180]) {
      await navigatePage(cdp, baseUrl, viewport);
      await navigateAssets(cdp, viewport, workspace);
      captures.push(await capture(cdp, `${prefix}--${viewportName(viewport)}.png`, viewport));
    }
  }
  for (const viewport of [viewports.mobile390, viewports.mobile430]) {
    await navigatePage(cdp, baseUrl, viewport);
    await navigateAssets(cdp, viewport, "relationships");
    await assertTouchTargets(cdp, `mobile relationships ${viewport.width}`);
    captures.push(await capture(cdp, `mobile-intelligent-assets--${viewportName(viewport)}.png`, viewport));
  }
  for (const workspace of ["knowledge", "capabilities", "reviews"]) {
    for (const viewport of [viewports.mobile390, viewports.mobile430]) {
      await navigatePage(cdp, baseUrl, viewport);
      await navigateAssets(cdp, viewport, workspace);
      await assertTouchTargets(cdp, `mobile ${workspace} ${viewport.width}`);
      captures.push(await capture(cdp, `mobile-${workspace}--${viewportName(viewport)}.png`, viewport, { structuralOnly: true }));
    }
  }
  return captures;
}

async function captureStates(cdp, baseUrl) {
  const states = [];
  const scenarios = ["loading", "empty", "processing", "stale", "degraded", "failed", "forbidden", "disabled", "approval", "partial", "no-result", "long-content", "large-list"];
  for (let index = 0; index < scenarios.length; index += 1) {
    const scenario = scenarios[index];
    const viewport = [viewports.desktop1440, viewports.desktop1180, viewports.mobile390, viewports.mobile430][index % 4];
    await navigatePage(cdp, baseUrl, viewport, scenario);
    await click(cdp, '[data-kordyn-v2-domain-target="assets"]');
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Domain === "assets"`, `${scenario} assets`);
    if (["long-content", "large-list"].includes(scenario)) {
      await click(cdp, '[data-kordyn-v2-workspace-target="knowledge"]');
      await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.knowledge)})`, `${scenario} content`);
    } else await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-state="${scenario}"]')`, `${scenario} state`);
    if (viewport.device === "mobile") await assertTouchTargets(cdp, `${scenario} ${viewport.width}`);
    states.push(await capture(cdp, `state-${scenario}--${viewportName(viewport)}.png`, viewport, {
      state: scenario,
      structuralOnly: true,
      expectAssetsCss: ["long-content", "large-list"].includes(scenario) ? true : null
    }));
  }
  return states;
}

async function exerciseSelections(cdp, baseUrl) {
  const viewport = viewports.desktop1440;
  const interactions = [];
  await navigatePage(cdp, baseUrl, viewport);
  await navigateAssets(cdp, viewport, "knowledge");
  await click(cdp, '[data-kordyn-v2-knowledge-source="source-market-microstructure"] .kordynV2KnowledgeSourceSelect');
  interactions.push(await assertSelection(cdp, viewport, "source-market-microstructure", "Knowledge", "Knowledge source"));
  await click(cdp, '[data-kordyn-v2-evidence-id="evidence-depth-84"]');
  interactions.push(await assertSelection(cdp, viewport, "evidence-depth-84", "Evidence", "Evidence"));

  await click(cdp, '[data-kordyn-v2-workspace-target="strategies"]');
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.strategies)})`, "strategies content");
  await click(cdp, '[data-kordyn-v2-strategy-id="product_breakout@3.4"]');
  interactions.push(await assertSelection(cdp, viewport, "breakout@3.4", "Strategy product", "Strategy product"));

  await click(cdp, '[data-kordyn-v2-workspace-target="capabilities"]');
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.capabilities)})`, "capabilities content");
  await click(cdp, '[data-kordyn-v2-capability-id="native-risk-preflight"]');
  interactions.push(await assertSelection(cdp, viewport, "native-risk-preflight", "Capability", "Capability"));

  await click(cdp, '[data-kordyn-v2-workspace-target="reviews"]');
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.reviews)})`, "reviews content");
  await click(cdp, '[data-kordyn-v2-review-id="review-btc-assets"]');
  interactions.push(await assertSelection(cdp, viewport, "review-btc-assets", "Review", "Review"));
  await click(cdp, '[data-kordyn-v2-owner-candidate="owner-capability-18"] .kordynV2OwnerSelect');
  interactions.push(await assertSelection(cdp, viewport, "owner-capability-18", "Owner candidate", "Owner candidate"));
  await click(cdp, '[data-kordyn-v2-validation-run="paper-owner-18"]');
  interactions.push(await assertSelection(cdp, viewport, "paper-owner-18", "Paper run", "Validation run"));

  const mobile = viewports.mobile390;
  await navigatePage(cdp, baseUrl, mobile);
  await navigateAssets(cdp, mobile, "relationships");
  await click(cdp, '[data-kordyn-v2-object-id="product_breakout@3.4"][data-kordyn-v2-object-type="Strategy"]');
  interactions.push(await assertSelection(cdp, mobile, "breakout@3.4", "Strategy product", "APP Strategy product"));
  return interactions;
}

async function exerciseActions(cdp, baseUrl) {
  const results = [];
  for (const mode of ["failure", "partial", "success"]) {
    await navigatePage(cdp, baseUrl, viewports.desktop1440, "ready", mode);
    await navigateAssets(cdp, viewports.desktop1440, "knowledge");
    await click(cdp, '[data-kordyn-v2-knowledge-source="source-market-microstructure"] footer button:last-child');
    await acceptConfirm(cdp, `${mode} source conversion`);
    await waitForExpression(cdp, "window.__plan04AssetCalls.actionResults.some((row) => row.endpoint === '/api/knowledge/convert')", `${mode} source result`);
    await click(cdp, '[data-kordyn-v2-workspace-target="reviews"]');
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.reviews)})`, `${mode} review content`);
    await click(cdp, '[data-kordyn-v2-owner-candidate="owner-candidate-35"] footer button:nth-child(2)');
    await acceptConfirm(cdp, `${mode} Owner decision`);
    await waitForExpression(cdp, "window.__plan04AssetCalls.actionResults.some((row) => row.endpoint === '/api/review/improvements/owner-candidate-35/action')", `${mode} Owner result`);
    const ledger = await evaluate(cdp, "window.__plan04AssetCalls");
    assert.equal(ledger.actionRequests.length, 2, `${mode}: exactly two bounded writes`);
    assert.deepEqual(ledger.actionRequests.map((row) => row.endpoint), ["/api/knowledge/convert", "/api/review/improvements/owner-candidate-35/action"]);
    results.push({ mode, ledger });
  }
  return results;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2_000))]);
}

await prepareOutput();
const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-assets-chrome-"));
const vite = spawn(process.execPath, [path.join(rootDir, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: rootDir, stdio: "ignore" });
let chrome;
let cdp;
try {
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  await waitFor(baseUrl);
  chrome = spawn(chromeBinary, ["--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu", "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profileDir}`, `${baseUrl}${pagePath}?scenario=ready`], { stdio: "ignore" });
  await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  const targets = await fetch(`http://127.0.0.1:${chromePort}/json`).then((response) => response.json());
  const target = targets.find((row) => row.type === "page" && row.url.startsWith(baseUrl)) || targets.find((row) => row.type === "page");
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);

  const captures = await captureSurfaces(cdp, baseUrl);
  const states = await captureStates(cdp, baseUrl);
  const interactions = await exerciseSelections(cdp, baseUrl);
  const actionResults = await exerciseActions(cdp, baseUrl);
  const styles = await styleOwnership(cdp);
  assert.equal(styles.assetsCss, true);
  assert.equal(styles.legacyProductStyles, false);
  const evidence = { schemaVersion: 1, runner, fixture, productionSourceCommit, captureTestSourceCommit, captures, interactions, actionResults, styleOwnership: styles };
  await writeFile(path.join(outputDir, "capture-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(path.join(outputDir, "state-evidence.json"), `${JSON.stringify({ schemaVersion: 1, runner, fixture, productionSourceCommit, captureTestSourceCommit, states }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ productionSourceCommit, captureTestSourceCommit, captures: captures.length, states: states.length, interactions: interactions.length, actionModes: actionResults.length, assetsCss: true, legacyProductStyles: false, outputDir: path.relative(rootDir, outputDir) }, null, 2)}\n`);
} finally {
  cdp?.close();
  await Promise.allSettled([stop(chrome), stop(vite)]);
  await rm(profileDir, { recursive: true, force: true });
}
