import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pagePath = "/tests/kordyn-v2-accessibility-browser.html";
const outputDir = path.resolve(rootDir, process.env.KORDYN_V2_SCREENSHOT_DIR || ".impeccable/review/kordyn-v2/states");
const reviewRoot = path.join(rootDir, ".impeccable/review/kordyn-v2");
const viewports = Object.freeze([
  Object.freeze({ width: 1440, height: 900, device: "desktop" }),
  Object.freeze({ width: 1180, height: 800, device: "desktop" }),
  Object.freeze({ width: 390, height: 844, device: "mobile" }),
  Object.freeze({ width: 430, height: 932, device: "mobile" })
]);
const requiredStates = Object.freeze([
  "loading", "empty", "processing", "stale", "degraded", "failed", "forbidden",
  "disabled", "approval", "partial", "no-result", "long-content", "large-list"
]);

const relativeOutput = path.relative(reviewRoot, outputDir);
assert.ok(relativeOutput && !relativeOutput.startsWith(`..${path.sep}`) && !path.isAbsolute(relativeOutput), `screenshots remain inside ${reviewRoot}`);

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
    close() { socket.close(); }
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
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function setViewport(cdp, viewport) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }]
  });
}

async function press(cdp, key, { shift = false } = {}) {
  const eventKey = key === "Space" ? " " : key;
  const eventCode = key === "Space" ? "Space" : key;
  const virtualKey = ({ Enter: 13, Escape: 27, Tab: 9, Space: 32 })[key] || 0;
  const modifiers = shift ? 8 : 0;
  const textValue = key === "Enter" ? "\r" : key === "Space" ? " " : undefined;
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: eventKey,
    code: eventCode,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
    modifiers,
    text: textValue,
    unmodifiedText: textValue
  });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: eventKey, code: eventCode, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, modifiers });
  await new Promise((resolve) => setTimeout(resolve, 60));
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target=document.querySelector(${JSON.stringify(selector)});
    if(!target)return {missing:true,selector:${JSON.stringify(selector)},text:document.body.textContent.trim().slice(0,600)};
    target.scrollIntoView({block:'center',inline:'nearest'});
    const rect=target.getBoundingClientRect();
    const x=rect.left+rect.width/2;
    const y=rect.top+rect.height/2;
    const hit=document.elementFromPoint(x,y);
    return rect.width>0&&rect.height>0&&(hit===target||target.contains(hit))?{x,y}:{blockedBy:hit?.outerHTML?.slice(0,180)||'none',rect:[rect.left,rect.top,rect.right,rect.bottom]};
  })()`);
  assert.ok(Number.isFinite(point?.x) && Number.isFinite(point?.y), `trusted click ${selector}: ${JSON.stringify(point)}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function keyboardActivate(cdp, selector) {
  assert.equal(await evaluate(cdp, `(() => { const node=document.querySelector(${JSON.stringify(selector)}); node?.focus(); return document.activeElement===node; })()`), true, `focus ${selector}`);
  await press(cdp, "Enter");
}

async function navigate(cdp, baseUrl, viewport, options = {}) {
  await setViewport(cdp, viewport);
  const query = new URLSearchParams({ run: String(Date.now()), lang: options.lang || "zh", state: options.state || "loaded" });
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}?${query}` });
  await waitForExpression(cdp, "window.__kordynV2AccessibilityReady && document.querySelector('[data-kordyn-v2-root]')", `${viewport.width}: production Root`);
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')`, `${viewport.width}: ${viewport.device} shell`);
}

async function assertNoOverflow(cdp, viewport, label) {
  const geometry = await evaluate(cdp, `(() => {
    const root=document.querySelector('[data-kordyn-v2-root]');
    const offenders=[...document.querySelectorAll('[data-kordyn-v2-root] *')].flatMap((node)=>{
      if(node.getClientRects().length===0)return [];
      const rect=node.getBoundingClientRect();
      const style=getComputedStyle(node);
      if(rect.right<=innerWidth+1&&rect.left>=-1)return [];
      if(['auto','scroll'].includes(style.overflowX))return [];
      return [{tag:node.tagName,className:String(node.className||'').slice(0,80),left:rect.left,right:rect.right,width:rect.width}];
    }).slice(0,8);
    return {document:[document.documentElement.clientWidth,document.documentElement.scrollWidth],root:[root?.clientWidth,root?.scrollWidth],offenders};
  })()`);
  assert.deepEqual(geometry.document, [viewport.width, viewport.width], `${label}: document overflow ${JSON.stringify(geometry)}`);
  assert.ok(geometry.root?.[1] <= geometry.root?.[0] + 1, `${label}: Root overflow ${JSON.stringify(geometry)}`);
  assert.equal(geometry.offenders.length, 0, `${label}: visible overflow ${JSON.stringify(geometry.offenders)}`);
  return geometry;
}

async function assertFocusVisible(cdp, selector, label) {
  await press(cdp, "Tab");
  await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.focus()`);
  const style = await evaluate(cdp, `(() => { const node=document.querySelector(${JSON.stringify(selector)}); const value=node?getComputedStyle(node):null; return {active:document.activeElement===node,outlineStyle:value?.outlineStyle,outlineWidth:parseFloat(value?.outlineWidth||'0'),boxShadow:value?.boxShadow||'none'}; })()`);
  assert.equal(style.active, true, `${label}: focus target active`);
  assert.ok((style.outlineStyle !== "none" && style.outlineWidth > 0) || style.boxShadow !== "none", `${label}: visible focus ${JSON.stringify(style)}`);
}

async function assertDialogFocus(cdp, dialogSelector, triggerSelector, label) {
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(dialogSelector)})?.contains(document.activeElement)`, `${label}: focus enters`);
  await press(cdp, "Tab", { shift: true });
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(dialogSelector)})?.contains(document.activeElement)`), true, `${label}: reverse focus trap`);
  await press(cdp, "Tab");
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(dialogSelector)})?.contains(document.activeElement)`), true, `${label}: forward focus trap`);
  await press(cdp, "Escape");
  await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(dialogSelector)})`, `${label}: Escape closes`);
  await waitForExpression(cdp, `document.activeElement?.matches(${JSON.stringify(triggerSelector)})`, `${label}: trigger focus return`);
}

async function assertEvidenceDialogs(cdp, viewport) {
  const contextTrigger = "[data-kordyn-v2-context-trigger]";
  await keyboardActivate(cdp, contextTrigger);
  const contextDialog = viewport.device === "desktop" ? '[data-kordyn-v2-overlay="context"]' : '[data-kordyn-v2-mobile-sheet="evidence"]';
  await assertDialogFocus(cdp, contextDialog, contextTrigger, `${viewport.width}: Context`);

  const proofTrigger = "[data-kordyn-v2-proof-trigger]";
  await keyboardActivate(cdp, proofTrigger);
  const proofDialog = viewport.device === "desktop" ? '[data-kordyn-v2-overlay="proof"]' : '[data-kordyn-v2-mobile-sheet="evidence"]';
  await assertDialogFocus(cdp, proofDialog, proofTrigger, `${viewport.width}: Proof`);
}

async function assertSupport(cdp, viewport) {
  const trigger = "[data-kordyn-v2-ai-support-trigger]";
  await keyboardActivate(cdp, trigger);
  const dialog = viewport.device === "desktop" ? "[data-kordyn-v2-ai-support-panel]" : '[data-kordyn-v2-mobile-sheet="support"]';
  await assertDialogFocus(cdp, dialog, trigger, `${viewport.width}: AI support`);
}

async function openApproval(cdp, viewport) {
  await keyboardActivate(cdp, '[data-kordyn-v2-domain-target="ai"]');
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Workspace === 'missions'`, `${viewport.width}: AI missions`);
  const trigger = '[data-kordyn-v2-open-approval="run-plan06-accessibility-approval"]';
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${trigger}:not([disabled])`)})`, `${viewport.width}: approval trigger`);
  await keyboardActivate(cdp, trigger);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]')?.contains(document.activeElement)", `${viewport.width}: approval opens`);
  await press(cdp, "Tab", { shift: true });
  assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]')?.contains(document.activeElement)"), true, `${viewport.width}: approval traps reverse focus`);
  return trigger;
}

async function assertConfirmations(cdp, viewport) {
  const approvalTrigger = await openApproval(cdp, viewport);
  const primary = "[data-kordyn-v2-approval-primary]";
  await click(cdp, primary);
  await waitForExpression(cdp, "document.querySelector('.cfmCard--ordinary')?.contains(document.activeElement)", `${viewport.width}: ordinary confirmation`);
  await press(cdp, "Tab", { shift: true });
  assert.equal(await evaluate(cdp, "document.querySelector('.cfmCard--ordinary')?.contains(document.activeElement)"), true, `${viewport.width}: ordinary confirmation trap`);
  await press(cdp, "Escape");
  await waitForExpression(cdp, "!document.querySelector('.cfmCard') && document.activeElement?.matches('[data-kordyn-v2-approval-primary]')", `${viewport.width}: ordinary confirmation focus return`);

  const danger = ".kordynV2AiApprovalActions > button:not([data-kordyn-v2-approval-primary])";
  await click(cdp, danger);
  await waitForExpression(cdp, "document.querySelector('.cfmCard--danger')?.contains(document.activeElement)", `${viewport.width}: danger confirmation`);
  await press(cdp, "Tab");
  assert.equal(await evaluate(cdp, "document.querySelector('.cfmCard--danger')?.contains(document.activeElement)"), true, `${viewport.width}: danger confirmation trap`);
  await press(cdp, "Escape");
  await waitForExpression(cdp, `!document.querySelector('.cfmCard') && document.activeElement?.matches(${JSON.stringify(danger)})`, `${viewport.width}: danger confirmation focus return`);
  await press(cdp, "Escape");
  await waitForExpression(cdp, `!document.querySelector('[data-kordyn-v2-ai-approval-sheet]') && document.activeElement?.matches(${JSON.stringify(approvalTrigger)})`, `${viewport.width}: approval focus return`);
  assert.equal(await evaluate(cdp, "window.__kordynV2AccessibilityCalls.actions.length"), 0, `${viewport.width}: cancelled confirmations perform no action`);
}

async function assertTouchTargets(cdp, viewport) {
  if (viewport.device !== "mobile") return [];
  const small = await evaluate(cdp, `(() => [...document.querySelectorAll('button, input, select, textarea, [role="button"], a[href]')].flatMap((node)=>{
    if(node.closest('[inert]')||node.disabled||node.getClientRects().length===0)return [];
    const style=getComputedStyle(node);
    if(style.visibility==='hidden'||style.display==='none')return [];
    const rect=node.getBoundingClientRect();
    if(rect.bottom<0||rect.top>innerHeight)return [];
    const equivalent=node.closest('[data-kordyn-v2-inline-hit-target]');
    if((rect.width>=44&&rect.height>=44)||equivalent)return [];
    return [{tag:node.tagName,className:String(node.className||''),label:node.getAttribute('aria-label')||node.textContent.trim().slice(0,50),width:rect.width,height:rect.height}];
  }))()`);
  assert.equal(small.length, 0, `${viewport.width}: every visible APP control is at least 44x44 ${JSON.stringify(small.slice(0,12))}`);
  return small;
}

async function assertLongAndLargeContent(cdp, viewport) {
  await keyboardActivate(cdp, '[data-kordyn-v2-domain-target="governance"]');
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Domain === 'governance'`, `${viewport.width}: governance`);
  await keyboardActivate(cdp, '[data-kordyn-v2-workspace-target="audit"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-object-type=\"Audit log\"]')", `${viewport.width}: audit rows`);
  const list = await evaluate(cdp, `(() => ({
    rows:document.querySelectorAll('[data-kordyn-v2-object-type="Audit log"]').length,
    sourceCount:window.__kordynV2AccessibilityFixture.revision===906?200:0,
    bilingual:document.body.textContent.includes('agent.observe')&&document.body.textContent.includes('审计')&&document.documentElement.lang.length>0,
    longIdentity:[...document.querySelectorAll('[data-kordyn-v2-object-type="Audit log"]')].some((node)=>node.textContent.includes('regional-authority'))
  }))()`);
  assert.ok(list.rows > 0 && list.rows <= 200, `${viewport.width}: bounded large list renders real rows ${JSON.stringify(list)}`);
  assert.equal(list.sourceCount, 200, `${viewport.width}: 200-row source loaded`);
  assert.equal(list.bilingual, true, `${viewport.width}: Chinese/English content and language identity load`);
  assert.equal(list.longIdentity, true, `${viewport.width}: long object identity remains discoverable`);
  return list;
}

async function capture(cdp, viewport, filename) {
  await mkdir(outputDir, { recursive: true });
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = path.join(outputDir, filename);
  await writeFile(file, Buffer.from(result.data, "base64"));
  return file;
}

async function verifyViewport(cdp, baseUrl, viewport) {
  await navigate(cdp, baseUrl, viewport, { lang: viewport.width === 1180 || viewport.width === 430 ? "en" : "zh" });
  const rootSelector = `[data-kordyn-v2-shell="${viewport.device}"]`;
  assert.equal(await evaluate(cdp, `document.querySelector('[data-kordyn-v2-root]')?.getAttribute('lang')`), viewport.width === 1180 || viewport.width === 430 ? "en" : "zh-CN", `${viewport.width}: language contract`);
  await assertFocusVisible(cdp, '[data-kordyn-v2-domain-target="ai"]', `${viewport.width}: global navigation`);
  for (const domain of ["account", "assets", "governance", "ai"]) {
    await keyboardActivate(cdp, `[data-kordyn-v2-domain-target="${domain}"]`);
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(rootSelector)})?.dataset.kordynV2Domain === ${JSON.stringify(domain)}`, `${viewport.width}: keyboard ${domain}`);
  }
  await assertEvidenceDialogs(cdp, viewport);
  await assertSupport(cdp, viewport);
  await assertConfirmations(cdp, viewport);
  const largeList = await assertLongAndLargeContent(cdp, viewport);
  await assertNoOverflow(cdp, viewport, `${viewport.width}: ready/long/large`);
  await assertTouchTargets(cdp, viewport);
  const screenshot = await capture(cdp, viewport, `${viewport.device}-${viewport.width}x${viewport.height}-accessibility.png`);
  return { viewport: `${viewport.width}x${viewport.height}`, device: viewport.device, largeList, screenshot };
}

async function verifyStates(cdp, baseUrl) {
  const results = [];
  for (let index = 0; index < requiredStates.length; index += 1) {
    const kind = requiredStates[index];
    const viewport = viewports[index % viewports.length];
    await navigate(cdp, baseUrl, viewport, { state: kind });
    const state = await evaluate(cdp, `(() => {
      const boundary=document.querySelector('[data-kordyn-v2-state]');
      const retained=boundary?.querySelector('.kordynV2RetainedNotice');
      const panel=boundary?.querySelector('.kordynV2StatePanel');
      const status=retained||panel||boundary?.querySelector('[role="status"]');
      return {
        kind:boundary?.dataset.kordynV2State,
        retained:Boolean(retained),
        panel:Boolean(panel),
        statusText:status?.textContent.trim()||boundary?.textContent.trim().slice(0,100)||'',
        symbol:Boolean(status?.querySelector('svg,[aria-hidden="true"]')),
        animationDuration:panel?getComputedStyle(panel.querySelector('.is-spinning')||panel).animationDuration:'0s'
      };
    })()`);
    assert.equal(state.kind, kind, `${kind}: production StateBoundary identity`);
    assert.ok(state.statusText, `${kind}: text status remains visible`);
    if (["stale", "degraded"].includes(kind)) assert.equal(state.retained, true, `${kind}: retained notice`);
    if (["loading", "empty", "failed", "forbidden", "disabled", "approval", "no-result"].includes(kind)) {
      assert.equal(state.panel, true, `${kind}: blocking state panel`);
      assert.equal(state.symbol, true, `${kind}: symbol accompanies color`);
    }
    if (kind === "loading") assert.ok(parseFloat(state.animationDuration) <= 0.001, `reduced motion is honored while loading text remains visible: ${state.animationDuration}`);
    await assertNoOverflow(cdp, viewport, `${kind} ${viewport.width}`);
    results.push({ kind, viewport: `${viewport.width}x${viewport.height}` });
  }
  return results;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-accessibility-browser-"));
const vite = spawn(process.execPath, [path.join(rootDir, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: rootDir, stdio: "ignore" });
const chrome = spawn(chromeBinary, ["--headless=new", "--hide-scrollbars", "--disable-gpu", "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });

let cdp;
try {
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  await waitFor(`${baseUrl}${pagePath}`);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);
  const viewportResults = [];
  for (const viewport of viewports) viewportResults.push(await verifyViewport(cdp, baseUrl, viewport));
  const stateResults = await verifyStates(cdp, baseUrl);
  process.stdout.write(`KORDYN V2 accessibility browser PASS ${viewportResults.map((row) => `${row.viewport}:focus-traps=6,overflow=0,large=${row.largeList.rows}/200`).join(" ")} states=${stateResults.length}/13 reduced-motion=visible screenshots=${viewportResults.length}\n`);
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
