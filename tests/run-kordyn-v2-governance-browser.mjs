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
const outputDir = path.resolve(rootDir, process.env.KORDYN_V2_SCREENSHOT_DIR || ".impeccable/review/kordyn-v2/governance");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pagePath = "/tests/kordyn-v2-governance-browser.html";
const runner = "tests/run-kordyn-v2-governance-browser.mjs";
const fixture = "tests/kordyn-v2-governance-browser.jsx";
const productionSourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim();

const viewports = Object.freeze({
  desktop1440: Object.freeze({ width: 1440, height: 900, device: "desktop" }),
  desktop1180: Object.freeze({ width: 1180, height: 800, device: "desktop" }),
  mobile390: Object.freeze({ width: 390, height: 844, device: "mobile" }),
  mobile430: Object.freeze({ width: 430, height: 932, device: "mobile" })
});
const markers = Object.freeze({
  overview: '[data-kordyn-v2-governance-workspace="overview"], [data-kordyn-v2-governance-mobile="overview"]',
  runs: '[data-kordyn-v2-governance-workspace="operations"], [data-kordyn-v2-governance-mobile="runs"]',
  "event-inputs": '[data-kordyn-v2-governance-workspace="event-inputs"], [data-kordyn-v2-governance-mobile="event-inputs"]',
  notifications: '[data-kordyn-v2-governance-workspace="notifications"], [data-kordyn-v2-governance-mobile="notifications"]',
  audit: '[data-kordyn-v2-governance-workspace="audit"], [data-kordyn-v2-governance-mobile="audit"]',
  recovery: '[data-kordyn-v2-governance-workspace="recovery"], [data-kordyn-v2-governance-mobile="recovery"]',
  configuration: '[data-kordyn-v2-governance-workspace="configuration"], [data-kordyn-v2-governance-mobile="configuration"]'
});
const legacyStyleFiles = Object.freeze(["styles.css", "product-foundation.css", "workspace.css", "workspace-additions.css", "product-system.css", "conceptPages.css", "conceptSettings.css", "zero-base-mobile.css", "zero-base-system.css", "zero-base-workbenches.css"]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const viewportName = (viewport) => `${viewport.width}x${viewport.height}`;
const inside = (parent, target) => {
  const relative = path.relative(parent, target);
  return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

async function prepareOutput() {
  assert.equal(inside(reviewRoot, outputDir), true, "governance screenshots remain inside review root");
  const existing = await lstat(outputDir).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existing) {
    assert.equal(existing.isDirectory() && !existing.isSymbolicLink(), true, "governance output is a regular directory");
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
async function flush(cdp, delay = 55) {
  await cdp.send("Page.bringToFront").catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, delay));
}
async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return { missing:true, text:document.body.textContent.trim().slice(0,900) };
    target.scrollIntoView({ block:"center", inline:"nearest" });
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1 && (hit === target || target.contains(hit))
      ? { x, y }
      : { blockedBy:hit?.outerHTML?.slice(0,200)||"none", rect:[rect.left,rect.top,rect.right,rect.bottom], viewport:[innerWidth,innerHeight] };
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
  await waitForExpression(cdp, `window.__plan05GovernanceReady && document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')`, `${viewportName(viewport)} Root`).catch(async (error) => {
    const diagnostic = await evaluate(cdp, `({ href:location.href, ready:window.__plan05GovernanceReady, state:document.readyState, body:document.body?.innerText?.slice(0,1100), html:document.body?.innerHTML?.slice(0,900) })`);
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
  });
}
async function navigateGovernance(cdp, viewport, workspace = "overview") {
  await click(cdp, '[data-kordyn-v2-domain-target="governance"]');
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Domain === "governance"`, `${viewportName(viewport)} governance`);
  if (workspace !== "overview") await click(cdp, `[data-kordyn-v2-workspace-target="${workspace}"]`);
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
    if (!button.getClientRects().length || button.closest('[inert]')) return [];
    const rect=button.getBoundingClientRect();
    return rect.width < 44 || rect.height < 44 ? [{ text:button.textContent.trim().slice(0,60), width:Math.round(rect.width), height:Math.round(rect.height), className:String(button.className||"") }] : [];
  }).slice(0,30))()`);
  assert.deepEqual(failures, [], `${label}: touch targets ${JSON.stringify(failures)}`);
}
async function assertConfigurationGeometry(cdp, label) {
  const geometry = await evaluate(cdp, `(() => {
    const body=document.querySelector('.kordynV2ConfigurationEditorBody');
    const nodes=body?[...body.querySelectorAll('label,.kordynV2MandateEditor>header')].filter((node)=>node.getClientRects().length):[];
    const rows=nodes.map((node,index)=>{const rect=node.getBoundingClientRect();return {index,text:node.textContent.trim().slice(0,60),left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom};});
    const overlaps=[];
    for(let left=0;left<rows.length;left+=1){
      for(let right=left+1;right<rows.length;right+=1){
        const a=rows[left],b=rows[right];
        const x=Math.min(a.right,b.right)-Math.max(a.left,b.left);
        const y=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
        if(x>1&&y>1) overlaps.push({a:a.text,b:b.text,x:Math.round(x),y:Math.round(y)});
      }
    }
    return {overlaps,scrollHeight:body?.scrollHeight||0,clientHeight:body?.clientHeight||0};
  })()`);
  assert.deepEqual(geometry.overlaps, [], `${label}: configuration controls overlap ${JSON.stringify(geometry)}`);
  return geometry;
}
async function styleOwnership(cdp) {
  return await evaluate(cdp, `(() => {
    const values=[];
    for (const sheet of document.styleSheets) values.push(sheet.href||sheet.ownerNode?.getAttribute?.('data-vite-dev-id')||'');
    for (const node of document.querySelectorAll('style[data-vite-dev-id],link[rel="stylesheet"]')) values.push(node.getAttribute('data-vite-dev-id')||node.getAttribute('href')||'');
    const clean=values.map((value)=>String(value).split('?')[0].replaceAll('\\\\','/'));
    return { governanceCss:clean.some((value)=>value.endsWith('/src/kordynV2/domains/governance/governance.css')), legacyProductStyles:clean.some((value)=>value.includes('productStyles')||${JSON.stringify(legacyStyleFiles)}.some((file)=>value===file||value.endsWith('/'+file))), owners:clean.filter(Boolean).sort() };
  })()`);
}
async function capture(cdp, file, viewport, extra = {}) {
  const { expectGovernanceCss = true, ...evidence } = extra;
  await flush(cdp);
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const bytes = Buffer.from(result.data, "base64");
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [viewport.width, viewport.height], `${file}: dimensions`);
  await writeFile(path.join(outputDir, file), bytes);
  const shell = await evaluate(cdp, `(() => { const node=document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]'); return node?{domainId:node.dataset.kordynV2Domain,workspaceId:node.dataset.kordynV2Workspace,selectedId:node.dataset.kordynV2SelectedId,selectedType:node.dataset.kordynV2SelectedType}:null; })()`);
  const document = await assertNoOverflow(cdp, viewport, file);
  const styles = await styleOwnership(cdp);
  if (expectGovernanceCss !== null) assert.equal(styles.governanceCss, expectGovernanceCss, `${file}: governance CSS ownership`);
  assert.equal(styles.legacyProductStyles, false, `${file}: no legacy authenticated CSS`);
  return { file, viewport: viewportName(viewport), device: viewport.device, domainId: shell.domainId, workspaceId: shell.workspaceId, viewportGeometry: { width: viewport.width, height: viewport.height }, document: { clientWidth: document.document[0], scrollWidth: document.document[1] }, shell, noProductionWrites: true, legacyProductStyles: false, governanceCss: styles.governanceCss, sha256: sha256(bytes), ...evidence };
}

async function assertEvidencePanel(cdp, viewport, id, type, panel, label) {
  await click(cdp, `[data-kordyn-v2-${panel}-trigger]`);
  const overlay = viewport.device === "mobile" ? '[data-kordyn-v2-mobile-sheet="evidence"]' : `[data-kordyn-v2-overlay="${panel}"]`;
  const identity = viewport.device === "mobile" ? `${overlay} .kordynV2MobileSheetIdentity` : `${overlay} .kordynV2OverlayIdentity`;
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(identity)})?.textContent.includes(${JSON.stringify(`${type} / ${id}`)})`, `${label} ${panel}`);
  const visible = await evaluate(cdp, `document.querySelector(${JSON.stringify(identity)})?.textContent.trim()`);
  if (viewport.device === "mobile" || panel === "proof") await click(cdp, `${overlay} [data-kordyn-v2-${viewport.device === "mobile" ? "mobile-sheet" : "overlay"}-close]`);
  else { await waitForExpression(cdp, `document.querySelector(${JSON.stringify(overlay)})?.contains(document.activeElement)`, `${label} ${panel} focus`); await pressEscape(cdp); }
  await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(overlay)})`, `${label} close ${panel}`);
  return visible;
}
async function assertSelection(cdp, viewport, id, type, label) {
  await waitForExpression(cdp, `(() => { const root=document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]'); return root?.dataset.kordynV2SelectedId===${JSON.stringify(id)}&&root?.dataset.kordynV2SelectedType===${JSON.stringify(type)}; })()`, label);
  const root = await evaluate(cdp, `(() => { const root=document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]'); return {id:root?.dataset.kordynV2SelectedId,type:root?.dataset.kordynV2SelectedType,workspace:root?.dataset.kordynV2Workspace}; })()`);
  assert.deepEqual({ id: root.id, type: root.type }, { id, type }, label);
  return { label, viewport: viewportName(viewport), device: viewport.device, root, context: await assertEvidencePanel(cdp, viewport, id, type, "context", label), proof: await assertEvidencePanel(cdp, viewport, id, type, "proof", label) };
}
async function acceptConfirm(cdp, label) {
  await waitForExpression(cdp, "document.querySelector('.cfmCard')", `${label} confirm`);
  await click(cdp, ".cfmCard .cfmFoot .cfmBtn:last-child");
  await waitForExpression(cdp, "!document.querySelector('.cfmCard')", `${label} confirm close`);
}

async function captureSurfaces(cdp, baseUrl) {
  const captures = [];
  const desktop = [["overview", "desktop-governance-boundary"], ["runs", "desktop-governance-operations"], ["configuration", "desktop-governance-configuration"]];
  for (const [workspace, prefix] of desktop) {
    for (const viewport of [viewports.desktop1440, viewports.desktop1180]) {
      await navigatePage(cdp, baseUrl, viewport);
      await navigateGovernance(cdp, viewport, workspace);
      if (workspace === "configuration") await assertConfigurationGeometry(cdp, `${viewportName(viewport)} configuration`);
      captures.push(await capture(cdp, `${prefix}--${viewportName(viewport)}.png`, viewport));
    }
  }
  await navigatePage(cdp, baseUrl, viewports.desktop1440);
  await navigateGovernance(cdp, viewports.desktop1440, "overview");
  await click(cdp, '[data-kordyn-v2-danger-action="kill-switch"]');
  await waitForExpression(cdp, "document.querySelector('.cfmCard')", "danger confirmation");
  captures.push(await capture(cdp, "desktop-governance-danger-confirm--1440x900.png", viewports.desktop1440, { dangerConfirmation: "kill-switch", noActionAccepted: true }));
  await pressEscape(cdp);
  for (const viewport of [viewports.mobile390, viewports.mobile430]) {
    await navigatePage(cdp, baseUrl, viewport);
    await navigateGovernance(cdp, viewport, "runs");
    await click(cdp, "[data-kordyn-v2-ai-support-trigger]");
    await waitForExpression(cdp, 'document.querySelector(\'[data-kordyn-v2-mobile-sheet="support"]\')', `${viewportName(viewport)} support`);
    const support = await evaluate(cdp, `({ state:document.querySelector('[data-kordyn-v2-ai-support-state]')?.dataset.kordynV2AiSupportState, forms:document.querySelectorAll('[data-kordyn-v2-mobile-sheet="support"] form').length, editable:document.querySelectorAll('[data-kordyn-v2-mobile-sheet="support"] input,[data-kordyn-v2-mobile-sheet="support"] textarea').length })`);
    assert.deepEqual({ forms: support.forms, editable: support.editable }, { forms: 0, editable: 0 }, `${viewportName(viewport)} read-only AI support`);
    await assertTouchTargets(cdp, `${viewportName(viewport)} governance support`);
    captures.push(await capture(cdp, `mobile-system-governance--${viewportName(viewport)}.png`, viewport, { aiSupport: "open-read-only", supportState: support.state }));
  }
  const supporting = [["event-inputs", "desktop-governance-event-inputs"], ["notifications", "desktop-governance-notifications"], ["audit", "desktop-governance-audit"], ["recovery", "desktop-governance-recovery"]];
  for (const [workspace, prefix] of supporting) {
    await navigatePage(cdp, baseUrl, viewports.desktop1440);
    await navigateGovernance(cdp, viewports.desktop1440, workspace);
    captures.push(await capture(cdp, `${prefix}--1440x900.png`, viewports.desktop1440, { supportingSurface: true }));
  }
  return captures;
}

async function captureStates(cdp, baseUrl) {
  const states = [];
  const scenarios = [
    { id: "loading", workspace: "overview", selector: '[data-kordyn-v2-state="loading"]', semanticSurface: "authoritative resource loading", structuralOnly: true },
    { id: "empty", workspace: "audit", selector: '.kordynV2AuditLedger p', semanticSurface: "empty Audit ledger" },
    { id: "processing", workspace: "runs", selector: '[data-kordyn-v2-governance-action-state="processing"]', semanticSurface: "Task run awaiting server result", click: '[data-kordyn-v2-object-id="task-governance-patrol"] + div button:first-child' },
    { id: "stale", workspace: "overview", selector: '[data-kordyn-v2-state="stale"] .kordynV2RetainedNotice', semanticSurface: "last-valid Boundary facts" },
    { id: "degraded", workspace: "overview", selector: '[data-kordyn-v2-state="degraded"] .kordynV2RetainedNotice', semanticSurface: "degraded last-valid Boundary facts" },
    { id: "failed", workspace: "event-inputs", selector: '.kordynV2SourceHealth article[data-source-tone="critical"]', semanticSurface: "failed Event source" },
    { id: "forbidden", workspace: "configuration", selector: '[data-kordyn-v2-config-editor="trading"] [data-kordyn-v2-config-action="save-live-trading"]:disabled', semanticSurface: "forbidden live-trading configuration", setupClick: '[data-kordyn-v2-config-target="trading"]' },
    { id: "disabled", workspace: "runs", selector: '[data-kordyn-v2-object-id="task-reconcile"] + div button:first-child:disabled', semanticSurface: "disabled Task action" },
    { id: "approval", workspace: "recovery", selector: '.cfmCard', semanticSurface: "Recovery approval confirmation", click: '.kordynV2RecoveryActions > button:nth-of-type(1)' },
    { id: "partial", workspace: "recovery", selector: '[data-kordyn-v2-governance-action-state="partial"]', semanticSurface: "partial authoritative reconciliation", result: "partial", click: '.kordynV2RecoveryActions > button:nth-of-type(1)', confirm: true },
    { id: "no-result", workspace: "recovery", selector: '[data-kordyn-v2-object-type="Recovery"][data-kordyn-v2-object-id="recovery-current"]', semanticSurface: "Recovery without a report" },
    { id: "long-content", workspace: "audit", selector: '[data-kordyn-v2-object-id="audit-mode-33"]', semanticSurface: "long Audit action content" },
    { id: "large-list", workspace: "audit", selector: '.kordynV2AuditLedger [data-kordyn-v2-object-type="Audit log"]:nth-of-type(50)', semanticSurface: "large Audit ledger" }
  ];
  for (let index = 0; index < scenarios.length; index += 1) {
    const spec = scenarios[index];
    const scenario = spec.id;
    const viewport = [viewports.desktop1440, viewports.desktop1180, viewports.mobile390, viewports.mobile430][index % 4];
    await navigatePage(cdp, baseUrl, viewport, scenario, spec.result || "success");
    if (scenario === "loading") {
      await click(cdp, '[data-kordyn-v2-domain-target="governance"]');
      await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Domain === "governance"`, `${scenario} governance`);
    } else if (viewport.device === "mobile" && spec.workspace === "recovery") {
      await navigateGovernance(cdp, viewport, "runs");
      await click(cdp, '.kordynV2GovernanceMobile[data-kordyn-v2-governance-mobile="runs"] > .kordynV2MobilePrimary');
      await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.recovery)})`, `${scenario} recovery`);
    } else {
      await navigateGovernance(cdp, viewport, spec.workspace);
    }
    if (spec.setupClick) await click(cdp, spec.setupClick);
    if (spec.click) await click(cdp, spec.click);
    if (spec.confirm) await acceptConfirm(cdp, `${scenario} action`);
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(spec.selector)})`, `${scenario} semantic surface`);
    if (viewport.device === "mobile") await assertTouchTargets(cdp, `${scenario} ${viewport.width}`);
    states.push(await capture(cdp, `state-${scenario}--${viewportName(viewport)}.png`, viewport, { state: scenario, semanticSurface: spec.semanticSurface, structuralOnly: spec.structuralOnly === true, expectGovernanceCss: scenario === "loading" ? null : true }));
  }
  return states;
}

async function exerciseNavigation(cdp, baseUrl) {
  const rows = [];
  const mobileWorkspaces = ["overview", "runs", "audit", "configuration"];
  for (const viewport of [viewports.mobile390, viewports.mobile430]) {
    await navigatePage(cdp, baseUrl, viewport);
    await navigateGovernance(cdp, viewport, "overview");
    for (const workspace of mobileWorkspaces) {
      await click(cdp, `[data-kordyn-v2-workspace-target="${workspace}"]`);
      await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers[workspace])})`, `${viewportName(viewport)} ${workspace}`);
      const contract = await evaluate(cdp, `(() => { const nav=document.querySelector('[data-kordyn-v2-workspace-nav]'); return { workspace:document.querySelector('[data-kordyn-v2-shell="mobile"]')?.dataset.kordynV2Workspace, count:nav?.querySelectorAll('button').length, targets:[...nav?.querySelectorAll('button')||[]].map((node)=>node.dataset.kordynV2WorkspaceTarget), active:nav?.querySelectorAll('[aria-current="page"]').length, duplicate:document.querySelectorAll('[data-kordyn-v2-governance-local-nav]').length, overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth }; })()`);
      assert.deepEqual({ workspace: contract.workspace, count: contract.count, targets: contract.targets, active: contract.active, duplicate: contract.duplicate, overflow: contract.overflow }, { workspace, count: 4, targets: ["overview", "runs", "audit", "configuration"], active: 1, duplicate: 0, overflow: 0 }, `${viewportName(viewport)} ${workspace} navigation`);
      rows.push({ viewport: viewportName(viewport), workspace, ...contract });
    }
    for (const flow of [
      { id: "event-inputs", from: "runs", selector: '[data-kordyn-v2-operation-service="inputs"]', active: "overview" },
      { id: "notifications", from: "runs", selector: '[data-kordyn-v2-notification-target="governance/notifications"]', active: "runs" },
      { id: "recovery", from: "runs", selector: '.kordynV2GovernanceMobile[data-kordyn-v2-governance-mobile="runs"] > .kordynV2MobilePrimary', active: "runs" }
    ]) {
      await navigatePage(cdp, baseUrl, viewport);
      await navigateGovernance(cdp, viewport, flow.from);
      await click(cdp, flow.selector);
      await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers[flow.id])})`, `${viewportName(viewport)} ${flow.id} flow`);
      const active = await evaluate(cdp, `document.querySelector('[data-kordyn-v2-workspace-nav] [aria-current="page"]')?.dataset.kordynV2WorkspaceTarget`);
      assert.equal(active, flow.active, `${viewportName(viewport)} ${flow.id} parent destination`);
      rows.push({ viewport: viewportName(viewport), workspace: flow.id, flow: true, active });
    }
  }
  return rows;
}

async function exerciseSelections(cdp, baseUrl) {
  const viewport = viewports.desktop1440;
  const interactions = [];
  await navigatePage(cdp, baseUrl, viewport);
  await navigateGovernance(cdp, viewport, "overview");
  await click(cdp, '[data-kordyn-v2-object-type="Mandate"][data-kordyn-v2-object-id="mandate-core-17"]');
  interactions.push(await assertSelection(cdp, viewport, "mandate-core-17", "Mandate", "Mandate"));
  await click(cdp, '[data-kordyn-v2-object-type="Risk incident"][data-kordyn-v2-object-id="risk-incident-16"]');
  interactions.push(await assertSelection(cdp, viewport, "risk-incident-16", "Risk incident", "Risk incident"));

  await click(cdp, '[data-kordyn-v2-workspace-target="event-inputs"]');
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers["event-inputs"])})`, "event input content");
  await click(cdp, '[data-kordyn-v2-object-type="Event"][data-kordyn-v2-object-id="event-window-fomc"]');
  interactions.push(await assertSelection(cdp, viewport, "event-window-fomc", "Event", "Event"));

  await click(cdp, '[data-kordyn-v2-workspace-target="runs"]');
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.runs)})`, "runs content");
  await click(cdp, '[data-kordyn-v2-object-type="Task"][data-kordyn-v2-object-id="task-governance-patrol"]');
  interactions.push(await assertSelection(cdp, viewport, "task-governance-patrol", "Task", "Task"));
  await click(cdp, '[data-kordyn-v2-object-type="Agent run"][data-kordyn-v2-object-id="job-run-patrol-42"]');
  interactions.push(await assertSelection(cdp, viewport, "job-run-patrol-42", "Agent run", "Agent run"));

  await click(cdp, '[data-kordyn-v2-workspace-target="notifications"]');
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.notifications)})`, "notifications content");
  await click(cdp, '[data-kordyn-v2-object-type="Notification"][data-kordyn-v2-object-id="notification-risk-12"]');
  interactions.push(await assertSelection(cdp, viewport, "notification-risk-12", "Notification", "Notification"));

  await click(cdp, '[data-kordyn-v2-workspace-target="audit"]');
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.audit)})`, "audit content");
  await click(cdp, '[data-kordyn-v2-object-type="Audit log"][data-kordyn-v2-object-id="audit-mode-33"]');
  interactions.push(await assertSelection(cdp, viewport, "audit-mode-33", "Audit log", "Audit log"));

  await click(cdp, '[data-kordyn-v2-workspace-target="recovery"]');
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.recovery)})`, "recovery content");
  await click(cdp, '[data-kordyn-v2-object-type="Recovery"][data-kordyn-v2-object-id="recovery-report-28"] button');
  interactions.push(await assertSelection(cdp, viewport, "recovery-report-28", "Recovery", "Recovery"));

  await click(cdp, '[data-kordyn-v2-workspace-target="configuration"]');
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.configuration)})`, "configuration content");
  await click(cdp, '[data-kordyn-v2-config-target="event-sources"]');
  await waitForExpression(cdp, 'document.querySelector(\'[data-kordyn-v2-config-editor="event-sources"]\')', "event source editor");
  await click(cdp, '[data-kordyn-v2-config-editor="event-sources"] [data-kordyn-v2-object-type="Event source"][data-kordyn-v2-object-id="event-source-fed"]');
  interactions.push(await assertSelection(cdp, viewport, "event-source-fed", "Event source", "Configuration record"));
  return interactions;
}

async function actionOutcome(cdp, expected, label) {
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-governance-action-state="${expected}"]')`, `${label} ${expected}`);
  return await evaluate(cdp, `(() => { const node=document.querySelector('[data-kordyn-v2-governance-action-state="${expected}"]'); return { state:node?.dataset.kordynV2GovernanceActionState, action:node?.dataset.kordynV2GovernanceAction, text:node?.textContent.trim() }; })()`);
}
async function exerciseActions(cdp, baseUrl) {
  const results = [];
  for (const mode of ["failure", "partial", "success"]) {
    await navigatePage(cdp, baseUrl, viewports.desktop1440, "ready", mode);
    await navigateGovernance(cdp, viewports.desktop1440, "runs");
    await click(cdp, '[data-kordyn-v2-object-id="task-governance-patrol"] + div button:first-child');
    const processing = await actionOutcome(cdp, "processing", `${mode} task run`);
    await waitForExpression(cdp, "window.__plan05GovernanceCalls.actionResults.length === 1", `${mode} task result`);
    const finalState = mode === "failure" ? "failed" : mode;
    const outcome = await actionOutcome(cdp, finalState, `${mode} task run`);
    const ledger = await evaluate(cdp, "window.__plan05GovernanceCalls");
    assert.deepEqual(ledger.actionRequests.map((row) => row.endpoint), ["/api/tasks/task-governance-patrol/run"], `${mode}: bounded task write`);
    results.push({ mode, processing, outcome, ledger });
  }

  await navigatePage(cdp, baseUrl, viewports.desktop1440, "ready", "success");
  await navigateGovernance(cdp, viewports.desktop1440, "notifications");
  await click(cdp, '.kordynV2SingleRegistryWorkspace .kordynV2GovernanceTitle > button');
  await waitForExpression(cdp, "window.__plan05GovernanceCalls.actionResults.length === 1", "notification result");
  await actionOutcome(cdp, "success", "notification acknowledge");

  await click(cdp, '[data-kordyn-v2-workspace-target="recovery"]');
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.recovery)})`, "recovery actions");
  await click(cdp, ".kordynV2RecoveryActions > button:nth-of-type(1)");
  await acceptConfirm(cdp, "reconcile");
  await waitForExpression(cdp, "window.__plan05GovernanceCalls.actionResults.length === 2", "reconcile result");
  await actionOutcome(cdp, "success", "reconcile");
  await click(cdp, ".kordynV2RecoveryActions > button:nth-of-type(2)");
  await acceptConfirm(cdp, "scheduler recovery");
  await waitForExpression(cdp, "window.__plan05GovernanceCalls.actionResults.length === 3", "scheduler result");
  await actionOutcome(cdp, "success", "scheduler recovery");

  await click(cdp, '[data-kordyn-v2-workspace-target="configuration"]');
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(markers.configuration)})`, "configuration action");
  await click(cdp, '[data-kordyn-v2-config-editor="trading"] [data-kordyn-v2-action="apply"]');
  await acceptConfirm(cdp, "configuration save");
  await waitForExpression(cdp, "window.__plan05GovernanceCalls.actionResults.length === 4", "configuration result");
  await actionOutcome(cdp, "success", "configuration save");
  const ledger = await evaluate(cdp, "window.__plan05GovernanceCalls");
  assert.deepEqual(ledger.actionRequests.map((row) => row.endpoint), ["/api/notifications/read", "/api/reconciler/run", "/api/scheduler/recover", "/api/config/live-trading"], "all deployed governance action endpoints");
  results.push({ mode: "deployed-actions", ledger });
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
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-governance-chrome-"));
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
  const navigation = await exerciseNavigation(cdp, baseUrl);
  const interactions = await exerciseSelections(cdp, baseUrl);
  const actionResults = await exerciseActions(cdp, baseUrl);
  const styles = await styleOwnership(cdp);
  assert.equal(styles.governanceCss, true);
  assert.equal(styles.legacyProductStyles, false);
  const evidence = { schemaVersion: 1, runner, fixture, productionSourceCommit, captures, interactions, navigation, actionResults, styleOwnership: styles };
  await writeFile(path.join(outputDir, "capture-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(path.join(outputDir, "state-evidence.json"), `${JSON.stringify({ schemaVersion: 1, runner, fixture, productionSourceCommit, states }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ productionSourceCommit, captures: captures.length, states: states.length, navigation: navigation.length, interactions: interactions.length, actionModes: actionResults.length, governanceCss: true, legacyProductStyles: false, outputDir: path.relative(rootDir, outputDir) }, null, 2)}\n`);
} finally {
  cdp?.close();
  await Promise.allSettled([stop(chrome), stop(vite)]);
  await rm(profileDir, { recursive: true, force: true });
}
