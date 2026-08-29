import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { execFileSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pagePath = "/tests/kordyn-v2-ai-browser.html";
const reviewRoot = path.join(rootDir, ".impeccable/review/kordyn-v2");
const outputDir = path.resolve(rootDir, process.env.KORDYN_V2_SCREENSHOT_DIR || ".impeccable/review/kordyn-v2/ai");
const productionSourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: rootDir, encoding: "utf8" }).trim();
assert.match(productionSourceCommit, /^[0-9a-f]{40}$/, "Task 5 capture binds an exact production source commit");
const viewports = Object.freeze([
  Object.freeze({ width: 1440, height: 900, device: "desktop" }),
  Object.freeze({ width: 1180, height: 800, device: "desktop" }),
  Object.freeze({ width: 390, height: 844, device: "mobile" }),
  Object.freeze({ width: 430, height: 932, device: "mobile" })
]);
const stateScenarios = Object.freeze([
  Object.freeze({ kind: "loading", viewport: viewports[0], retainsFacts: false }),
  Object.freeze({ kind: "empty", viewport: viewports[2], retainsFacts: false }),
  Object.freeze({ kind: "processing", viewport: viewports[1], retainsFacts: true }),
  Object.freeze({ kind: "stale", viewport: viewports[2], retainsFacts: true, retained: true }),
  Object.freeze({ kind: "degraded", viewport: viewports[3], retainsFacts: true, retained: true }),
  Object.freeze({ kind: "failed", viewport: viewports[0], retainsFacts: false }),
  Object.freeze({ kind: "forbidden", viewport: viewports[2], retainsFacts: false }),
  Object.freeze({ kind: "disabled", viewport: viewports[1], retainsFacts: false }),
  Object.freeze({ kind: "approval", viewport: viewports[3], retainsFacts: false }),
  Object.freeze({ kind: "partial", viewport: viewports[0], retainsFacts: true }),
  Object.freeze({ kind: "no-result", viewport: viewports[2], retainsFacts: false }),
  Object.freeze({ kind: "long-content", viewport: viewports[2], retainsFacts: true }),
  Object.freeze({ kind: "large-list", viewport: viewports[3], retainsFacts: true })
]);
const legacyStyleProbeSource = `(() => {
  const legacyFiles = ${JSON.stringify([
    "styles.css", "product-foundation.css", "workspace.css", "workspace-additions.css",
    "product-system.css", "conceptPages.css", "conceptSettings.css", "zero-base-mobile.css",
    "zero-base-system.css", "zero-base-workbenches.css"
  ])};
  const owners = [];
  for (const sheet of document.styleSheets) {
    if (sheet.href) owners.push(sheet.href);
    const owner = sheet.ownerNode;
    if (owner?.getAttribute) {
      owners.push(owner.getAttribute('data-vite-dev-id') || '');
      owners.push(owner.getAttribute('href') || '');
    }
  }
  for (const owner of document.querySelectorAll('style[data-vite-dev-id], link[rel="stylesheet"]')) {
    owners.push(owner.getAttribute('data-vite-dev-id') || '');
    owners.push(owner.getAttribute('href') || '');
  }
  return owners.some((value) => {
    const clean = String(value).split('?')[0].split('#')[0].replaceAll('\\\\', '/');
    return clean.includes('productStyles') || legacyFiles.some((file) => clean === file || clean.endsWith('/' + file));
  });
})()`;
let navigationSequence = 0;

function assertSafeOutputDirectory() {
  const relative = path.relative(reviewRoot, outputDir);
  assert.ok(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `Task 5 output remains inside ${reviewRoot}`);
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
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let observedEvents = [];
  let requestId = 0;
  const ready = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.on("message", (payload) => {
    const message = JSON.parse(payload.toString());
    const request = pending.get(message.id);
    if (!request) {
      if (message.method) observedEvents.push(message);
      return;
    }
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
    takeEvents() {
      const events = observedEvents;
      observedEvents = [];
      return events;
    },
    close() { socket.close(); }
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

async function flushCompositorFrame(cdp) {
  await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 1, fromSurface: true, captureBeyondViewport: false });
}

async function waitForExpression(cdp, expression, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return null;
    target.scrollIntoView({ block:"center", inline:"nearest" });
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && (hit === target || target.contains(hit))
      ? { x, y }
      : { blockedBy: hit?.outerHTML?.slice(0, 240) || "none", rect: [rect.left, rect.top, rect.right, rect.bottom], viewport: [innerWidth, innerHeight] };
  })()`);
  assert.ok(Number.isFinite(point?.x) && Number.isFinite(point?.y), `trusted click target is visible and topmost: ${selector}; ${JSON.stringify(point)}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function press(cdp, key, modifiers = 0) {
  const code = key === "Tab" ? "Tab" : key === "Escape" ? "Escape" : key;
  const keyCode = key === "Tab" ? 9 : key === "Escape" ? 27 : key === "Enter" ? 13 : key.charCodeAt(0);
  await cdp.send("Input.dispatchKeyEvent", { type: key === "Enter" ? "rawKeyDown" : "keyDown", key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
  if (key === "Enter") await cdp.send("Input.dispatchKeyEvent", { type: "char", key, code, text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
}

async function typeInto(cdp, selector, value) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await flushCompositorFrame(cdp);
    await click(cdp, selector);
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(selector)})`)) break;
  }
  assert.equal(await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(selector)})`), true, `trusted typing target owns focus: ${selector}`);
  await cdp.send("Input.insertText", { text: value });
}

async function confirmProtectedAction(cdp, label) {
  await waitForExpression(cdp, "document.querySelector('.cfmCard')", `${label}: real ConfirmHost opens`);
  await waitForExpression(cdp, "document.querySelector('.cfmCard')?.contains(document.activeElement)", `${label}: ConfirmHost owns focus`);
  await press(cdp, "Tab");
  assert.equal(await evaluate(cdp, "document.activeElement?.matches('.cfmCard .cfmFoot .cfmBtn:last-child')"), true, `${label}: keyboard reaches protected confirmation`);
  await press(cdp, "Enter");
  await waitForExpression(cdp, "!document.querySelector('.cfmCard')", `${label}: confirmation accepted`);
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

async function navigatePage(cdp, baseUrl, viewport, scenario = "ready", options = {}) {
  await setViewport(cdp, viewport);
  const query = new URLSearchParams({ scenario, run: String(++navigationSequence) });
  if (options.approval) query.set("approval", options.approval);
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}?${query}` });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await flushCompositorFrame(cdp);
  await waitForExpression(
    cdp,
    `window.__task5Ready && document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')`,
    `${viewport.width}x${viewport.height} ${scenario} actual Root`,
    5_000
  ).catch(async (error) => {
    const diagnostic = await evaluate(cdp, `({ href:location.href, title:document.title, ready:window.__task5Ready, body:document.body?.innerText?.slice(0,800), root:Boolean(document.querySelector('[data-kordyn-v2-root]')) })`);
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
  });
  if (options.requireDestination !== false) {
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-destination=\"ai/missions\"]')", `${viewport.width}: lazy AI Mission destination`);
  }
}

async function navigateWorkspace(cdp, viewport, workspaceId, layout) {
  await click(cdp, `[data-kordyn-v2-workspace-target="${workspaceId}"]`);
  await waitForExpression(
    cdp,
    `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Workspace === ${JSON.stringify(workspaceId)} && document.querySelector('[data-kordyn-v2-layout="${layout}"]')`,
    `${viewport.width}: ${workspaceId} workspace`
  );
}

async function assertNoOverflow(cdp, viewport, label) {
  const geometry = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]');
    const canvas = root?.querySelector('[data-kordyn-v2-work-canvas]');
    return {
      document:[document.documentElement.clientWidth,document.documentElement.scrollWidth],
      root:root ? [root.clientWidth,root.scrollWidth] : null,
      canvas:canvas ? [canvas.clientWidth,canvas.scrollWidth] : null,
      offenders:[...document.querySelectorAll('*')].map((node)=>{
        const rect=node.getBoundingClientRect();
        const style=getComputedStyle(node);
        return {
          tag:node.tagName,
          className:typeof node.className==='string'?node.className:'',
          id:node.getAttribute?.('data-kordyn-v2-object-id')||node.closest?.('[data-kordyn-v2-object-id]')?.getAttribute('data-kordyn-v2-object-id')||'',
          parent:node.parentElement ? node.parentElement.tagName+'.'+(typeof node.parentElement.className==='string'?node.parentElement.className:'') : '',
          ancestry:[...function*(){let current=node;for(let index=0;current&&index<5;index+=1,current=current.parentElement)yield current.tagName+'.'+(typeof current.className==='string'?current.className:'');}()],
          text:node.textContent?.slice(0,90)||'',
          left:rect.left,
          right:rect.right,
          width:rect.width,
          scrollWidth:node.scrollWidth,
          clientWidth:node.clientWidth,
          style:{ display:style.display, width:style.width, minWidth:style.minWidth, whiteSpace:style.whiteSpace, overflow:style.overflow, overflowWrap:style.overflowWrap, wordBreak:style.wordBreak }
        };
      }).filter((row)=>row.right > ${viewport.width + 1} || row.width > ${viewport.width + 1}).sort((a,b)=>b.right-a.right).slice(0,8)
    };
  })()`);
  const diagnostic = JSON.stringify(geometry);
  assert.deepEqual(geometry.document, [viewport.width, viewport.width], `${label}: no document horizontal overflow; geometry=${diagnostic}`);
  assert.ok(geometry.root && geometry.root[1] <= geometry.root[0] + 1, `${label}: no Root overflow; geometry=${diagnostic}`);
  if (geometry.canvas) assert.ok(geometry.canvas[1] <= geometry.canvas[0] + 1, `${label}: no canvas overflow; geometry=${diagnostic}`);
}

async function assertMobileApprovalIsolation(cdp, viewport) {
  assert.equal(viewport.device, "mobile", `${viewport.width}: approval isolation is an APP contract`);
  const geometry = await evaluate(cdp, `(() => {
    const support=document.querySelector('[data-kordyn-v2-ai-support-trigger]');
    const primary=document.querySelector('[data-kordyn-v2-approval-primary]');
    const nav=document.querySelector('[data-kordyn-v2-mobile-navigation]');
    const sheet=document.querySelector('[data-kordyn-v2-ai-approval-sheet]');
    const renderedRect=(node)=>{
      if(!node||node.getClientRects().length===0)return null;
      const rect=node.getBoundingClientRect();
      return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height};
    };
    const overlap=(a,b)=>!a||!b?0:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    const supportStyle=support?getComputedStyle(support):null;
    const supportRect=renderedRect(support);
    const primaryRect=renderedRect(primary);
    const navRect=renderedRect(nav);
    return {
      support:{
        exists:Boolean(support),
        rendered:Boolean(supportRect),
        display:supportStyle?.display||null,
        visibility:supportStyle?.visibility||null,
        active:document.activeElement===support
      },
      primary:primaryRect,
      nav:navRect,
      focusInsideApproval:Boolean(sheet?.contains(document.activeElement)),
      overlaps:{
        supportPrimary:overlap(supportRect,primaryRect),
        supportNav:overlap(supportRect,navRect),
        primaryNav:overlap(primaryRect,navRect)
      }
    };
  })()`);
  assert.deepEqual(
    geometry.support,
    { exists: true, rendered: false, display: "none", visibility: "visible", active: false },
    `${viewport.width}: approval removes support from layout, focus, and the accessible interaction path; geometry=${JSON.stringify(geometry)}`
  );
  assert.ok(geometry.primary?.width >= 44 && geometry.primary?.height >= 44, `${viewport.width}: approval primary remains a 44px target; geometry=${JSON.stringify(geometry)}`);
  assert.ok(geometry.nav?.width >= 44 && geometry.nav?.height >= 44, `${viewport.width}: bottom navigation geometry remains measurable; geometry=${JSON.stringify(geometry)}`);
  assert.equal(geometry.focusInsideApproval, true, `${viewport.width}: approval retains protected focus; geometry=${JSON.stringify(geometry)}`);
  assert.deepEqual(geometry.overlaps, { supportPrimary: 0, supportNav: 0, primaryNav: 0 }, `${viewport.width}: approval, support, and nav have zero intersection; geometry=${JSON.stringify(geometry)}`);
  return geometry;
}

async function closeApprovalAndVerifySupportRestoration(cdp, viewport) {
  await press(cdp, "Escape");
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-ai-approval-sheet]')", `${viewport.width}: approval closes after capture`);
  const restored = await evaluate(cdp, `(() => {
    const support=document.querySelector('[data-kordyn-v2-ai-support-trigger]');
    const style=support?getComputedStyle(support):null;
    const rect=support?.getBoundingClientRect();
    return { rendered:Boolean(support&&support.getClientRects().length), display:style?.display||null, width:rect?.width||0, height:rect?.height||0, disabled:Boolean(support?.disabled), ariaHidden:support?.getAttribute('aria-hidden') };
  })()`);
  assert.deepEqual(
    restored,
    { rendered: true, display: "grid", width: 56, height: 56, disabled: false, ariaHidden: null },
    `${viewport.width}: support returns to its normal visible, enabled 56px target; restored=${JSON.stringify(restored)}`
  );
  await click(cdp, "[data-kordyn-v2-ai-support-trigger]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet=\"support\"]')", `${viewport.width}: restored support accepts a trusted click`);
  await press(cdp, "Escape");
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-mobile-sheet=\"support\"]')", `${viewport.width}: restored support sheet closes`);
  assert.equal(await evaluate(cdp, "document.activeElement?.matches('[data-kordyn-v2-ai-support-trigger]')"), true, `${viewport.width}: support regains focus after its restored sheet closes`);
}

async function verifyStateScenarios(cdp, baseUrl) {
  const evidence = [];
  for (const scenario of stateScenarios) {
    await navigatePage(cdp, baseUrl, scenario.viewport, scenario.kind, {
      requireDestination: scenario.retainsFacts
    });
    const selector = `[data-kordyn-v2-state="${scenario.kind}"]`;
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})`, `${scenario.kind}: canonical StateBoundary`);
    assert.equal(
      await evaluate(cdp, `document.querySelector('[data-kordyn-v2-state]')?.dataset.kordynV2State`),
      scenario.kind,
      `${scenario.kind}: actual Root exposes canonical resource state`
    );
    await assertNoOverflow(cdp, scenario.viewport, `${scenario.kind} actual Root state`);
    const state = await evaluate(cdp, `(() => {
      const boundary = document.querySelector(${JSON.stringify(selector)});
      const retained = boundary?.querySelector('.kordynV2RetainedNotice');
      const mutationControls = [...(boundary?.querySelectorAll('[data-kordyn-v2-open-approval], [data-kordyn-v2-open-output], [data-kordyn-v2-context-action]') || [])];
      const missionIds = [...(boundary?.querySelectorAll('[data-kordyn-v2-object-id^="run-large-"]') || [])].map((node)=>node.dataset.kordynV2ObjectId);
      return {
        heading:boundary?.querySelector('[data-kordyn-v2-state-heading]')?.textContent?.trim() || '',
        destination:Boolean(boundary?.querySelector('[data-kordyn-v2-destination="ai/missions"]')),
        retainedText:retained?.textContent?.trim() || '',
        retainedMeta:retained?.querySelector('small')?.textContent?.trim() || '',
        mutationCount:mutationControls.length,
        mutationsDisabled:mutationControls.every((node)=>node.disabled),
        actionStates:[...(boundary?.querySelectorAll('[data-kordyn-v2-action-state]') || [])].map((node)=>node.dataset.kordynV2ActionState),
        longText:boundary?.querySelector('[data-kordyn-v2-object-id="run-long-content"]')?.textContent || '',
        missionIds:[...new Set(missionIds)],
        authorityWrites:window.__task5Calls?.authorityWrites,
        legacyStyles:${legacyStyleProbeSource}
      };
    })()`);
    assert.equal(state.destination, scenario.retainsFacts, `${scenario.kind}: last-valid/content fact visibility follows canonical state semantics`);
    assert.equal(state.authorityWrites, 0, `${scenario.kind}: state presentation performs no authoritative write`);
    assert.equal(state.legacyStyles, false, `${scenario.kind}: state presentation has no legacy authenticated styles`);
    assert.equal(state.actionStates.includes("succeeded"), false, `${scenario.kind}: no optimistic action success`);

    if (!scenario.retainsFacts) {
      assert.ok(state.heading, `${scenario.kind}: shell-blocking state has a visible semantic heading`);
      assert.equal(state.retainedText, "", `${scenario.kind}: shell-blocking state does not reuse last-valid provenance`);
      assert.equal(state.mutationCount, 0, `${scenario.kind}: protected mutation presenters are not exposed`);
    }
    if (scenario.retained) {
      assert.ok(state.retainedMeta.includes("Task 5 bounded production-shaped authority"), `${scenario.kind}: exact last-valid source remains visible`);
      assert.ok(state.retainedMeta.includes("2026-08-30T00:12:00.000Z"), `${scenario.kind}: exact last-valid as-of remains visible`);
      assert.ok(state.mutationCount > 0, `${scenario.kind}: retained facts expose real protected controls`);
      assert.equal(state.mutationsDisabled, true, `${scenario.kind}: all retained-fact mutations are disabled`);
      const protectedSelector = '[data-kordyn-v2-open-approval="run-sol-approval"]';
      assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(protectedSelector)})?.disabled`), true, `${scenario.kind}: approval is disabled`);
      await click(cdp, protectedSelector);
      await flushCompositorFrame(cdp);
      assert.deepEqual(
        await evaluate(cdp, `({ writes:window.__task5Calls.authorityWrites, approval:Boolean(document.querySelector('[data-kordyn-v2-ai-approval-sheet]')) })`),
        { writes: 0, approval: false },
        `${scenario.kind}: trusted click on disabled protection cannot mutate or open approval`
      );
    }
    if (scenario.kind === "long-content") {
      const expected = `ETH 长内容证据 ${"完整来源、风险、能力与复盘关系。".repeat(120)}`;
      assert.ok(state.longText.includes(expected), "long-content: actual Mission row preserves the entire authority string");
    }
    if (scenario.kind === "large-list") {
      assert.equal(state.missionIds.length, 64, "large-list: all 64 authoritative Mission identities remain rendered");
      assert.equal(state.missionIds[0], "run-large-1", "large-list: first Mission remains present");
      assert.equal(state.missionIds[63], "run-large-64", "large-list: last Mission remains present");
    }
    const filename = `state-${scenario.kind}--${scenario.viewport.width}x${scenario.viewport.height}.png`;
    evidence.push({ state: scenario.kind, ...(await captureVisual(cdp, scenario.viewport, filename)) });

    if (scenario.retained) {
      await click(cdp, '[data-kordyn-v2-dialog-trigger]');
      await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-destination=\"ai/dialog\"]')", `${scenario.kind}: retained read-only dialog`);
      await waitForExpression(cdp, "document.querySelector('#kordyn-v2-ai-dialog-input')", `${scenario.kind}: real dialog composer`);
      assert.deepEqual(
        await evaluate(cdp, `({ input:document.querySelector('#kordyn-v2-ai-dialog-input')?.disabled, send:document.querySelector('.kordynV2AiDialogComposer button[type="submit"]')?.disabled, writes:window.__task5Calls.authorityWrites })`),
        { input: true, send: true, writes: 0 },
        `${scenario.kind}: retained dialog is read-only and performs no write`
      );
    }
  }
  await writeFile(path.join(outputDir, "state-evidence.json"), `${JSON.stringify({
    schemaVersion: 1,
    runner: "tests/run-kordyn-v2-ai-browser.mjs",
    fixture: "tests/kordyn-v2-production-fixture.js",
    productionSourceCommit,
    states: evidence
  }, null, 2)}\n`);
  return evidence.map(({ state }) => state);
}

async function captureVisual(cdp, viewport, filename) {
  const geometry = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]');
    const rect = root.getBoundingClientRect();
    return {
      domain:root.dataset.kordynV2Domain,
      workspace:root.dataset.kordynV2Workspace,
      document:{ clientWidth:document.documentElement.clientWidth, scrollWidth:document.documentElement.scrollWidth },
      root:{ left:rect.left, top:rect.top, width:rect.width, height:rect.height },
      authorityWrites:window.__task5Calls?.authorityWrites,
      legacyStyles:${legacyStyleProbeSource}
    };
  })()`);
  assert.equal(geometry.authorityWrites, 0, `${filename}: captured before any authoritative write`);
  assert.equal(geometry.legacyStyles, false, `${filename}: legacy product styles are absent`);
  assert.deepEqual(geometry.document, { clientWidth: viewport.width, scrollWidth: viewport.width }, `${filename}: exact immutable viewport without overflow`);
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const bytes = Buffer.from(result.data, "base64");
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [viewport.width, viewport.height], `${filename}: exact raster dimensions`);
  await writeFile(path.join(outputDir, filename), bytes);
  return {
    file: filename,
    viewport: `${viewport.width}x${viewport.height}`,
    device: viewport.device,
    domainId: geometry.domain,
    workspaceId: geometry.workspace,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    viewportGeometry: { width: viewport.width, height: viewport.height },
    document: geometry.document,
    shell: geometry.root,
    noProductionWrites: true,
    legacyProductStyles: false
  };
}

async function captureApprovedSurfaces(cdp, baseUrl) {
  const evidence = [];
  for (const viewport of viewports) {
    await navigatePage(cdp, baseUrl, viewport);
    await assertNoOverflow(cdp, viewport, `${viewport.width} Mission visual`);
    const missionConcept = viewport.device === "desktop" ? "desktop-ai-mission-control" : "mobile-ai-mission-home";
    if (viewport.device === "desktop") {
      const groupCounts = await evaluate(cdp, `Object.fromEntries([...document.querySelectorAll('[data-mission-group]')].map((node)=>[node.dataset.missionGroup,Number(node.dataset.missionCount)]))`);
      for (const group of ["analysis", "monitoring", "approval", "executing", "completed"]) assert.ok(groupCounts[group] > 0, `${viewport.width}: representative ${group} queue is non-empty ${JSON.stringify(groupCounts)}`);
      if (viewport.width === 1440) {
        for (const id of ["run-btc-analysis-fixture", "run-eth-monitor", "run-sol-approval", "run-eth-executing-fixture", "run-eth-completed-fixture"]) {
          await click(cdp, `button[data-kordyn-v2-object-id="${id}"][data-kordyn-v2-object-type="Agent run"]`);
          await waitForExpression(cdp, `(() => { const root=document.querySelector('[data-kordyn-v2-shell="desktop"]'); return root?.dataset.kordynV2SelectedId === ${JSON.stringify(id)} && root?.dataset.kordynV2SelectedType === 'Agent run'; })()`, `${id}: representative Mission reaches Root canonical identity`);
        }
        await click(cdp, 'button[data-kordyn-v2-object-id="run-eth-monitor"][data-kordyn-v2-object-type="Agent run"]');
      }
      await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-selected-mission=\"run-eth-monitor\"]')", `${viewport.width}: representative active Mission selected`);
      if (viewport.width === 1180) {
        const readableFacts = await evaluate(cdp, `(() => {
          const read=(selector)=>{ const node=document.querySelector(selector); if(!node)return null; const style=getComputedStyle(node); return {text:node.textContent.trim(),title:node.getAttribute('title'),aria:node.getAttribute('aria-label'),scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,scrollHeight:node.scrollHeight,clientHeight:node.clientHeight,overflow:style.overflow,textOverflow:style.textOverflow,whiteSpace:style.whiteSpace}; };
          return {
            capability:read('[data-kordyn-v2-mission-context-fact="Capability"] dd'),
            position:read('[data-kordyn-v2-mission-context-fact="Position"] dd'),
            created:read('[data-kordyn-v2-mission-receipt-fact="createdAt"] dd'),
            updated:read('[data-kordyn-v2-mission-receipt-fact="updatedAt"] dd'),
            completed:read('[data-kordyn-v2-mission-receipt-fact="completedAt"] dd')
          };
        })()`);
        assert.equal(readableFacts.capability?.text, "行情 · 市场结构 · 风控 · 执行", `1180: Capability keeps all real items visible ${JSON.stringify(readableFacts)}`);
        assert.equal(readableFacts.capability?.title, readableFacts.capability?.text, `1180: Capability preserves exact accessible text ${JSON.stringify(readableFacts)}`);
        assert.ok(readableFacts.capability?.scrollHeight <= readableFacts.capability?.clientHeight + 1 && readableFacts.capability?.textOverflow !== "ellipsis", `1180: Capability never clips into an ellipsis ${JSON.stringify(readableFacts)}`);
        assert.equal(readableFacts.position?.text, "position-eth", `1180: Position stays complete ${JSON.stringify(readableFacts)}`);
        for (const [key, display, exact] of [["created", "08-30 00:01:07", "2026-08-30T00:01:07.000Z"], ["updated", "08-30 00:12:11", "2026-08-30T00:12:11.000Z"], ["completed", "Unavailable", "Unavailable"]]) {
          const fact = readableFacts[key];
          assert.deepEqual({ text:fact?.text, title:fact?.title }, { text:display, title:exact }, `1180: ${key} receipt is compact and exact ${JSON.stringify(readableFacts)}`);
          assert.ok(fact?.aria?.includes(exact) && !fact?.text.includes("…") && fact?.scrollWidth <= fact?.clientWidth + 1 && fact?.textOverflow !== "ellipsis", `1180: ${key} receipt is fully readable ${JSON.stringify(readableFacts)}`);
        }

        await click(cdp, '[data-kordyn-v2-mission-proof="run-eth-monitor"]');
        await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"proof\"]')", "1180: active Mission Proof opens");
        const proofReceipt = await evaluate(cdp, `(() => {
          const overlay = document.querySelector('[data-kordyn-v2-overlay="proof"]');
          return {
            identity: overlay?.querySelector('.kordynV2OverlayIdentity')?.textContent?.trim() || '',
            text: overlay?.querySelector('[data-kordyn-v2-proof-details]')?.textContent || ''
          };
        })()`);
        assert.match(proofReceipt.identity, /Agent run \/ run-eth-monitor/, `1180: active Mission Proof keeps canonical identity ${JSON.stringify(proofReceipt)}`);
        assert.match(proofReceipt.text, /2026-08-30T00:01:07\.000Z/, `1180: active Mission Proof exposes exact createdAt ISO ${JSON.stringify(proofReceipt)}`);
        assert.match(proofReceipt.text, /2026-08-30T00:12:11\.000Z/, `1180: active Mission Proof exposes exact updatedAt ISO ${JSON.stringify(proofReceipt)}`);
        assert.match(proofReceipt.text, /完成\s*Unavailable/, `1180: missing completedAt stays explicit ${JSON.stringify(proofReceipt)}`);
        await closeOverlay(cdp, '[data-kordyn-v2-overlay="proof"]');
      }
      const footerTrack = await evaluate(cdp, `(() => [...document.querySelectorAll('[data-kordyn-v2-selected-mission="run-eth-monitor"] .kordynV2AiMissionInspectorFooter button')].map((node)=>{ const rect=node.getBoundingClientRect(); return {kind:node.dataset.kordynV2MissionContext ? 'context' : node.dataset.kordynV2MissionProof ? 'proof' : 'other',left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}; }))()`);
      assert.deepEqual(footerTrack.map((row) => row.kind), ["context", "proof"], `${viewport.width}: active footer carries only the two real evidence actions`);
      assert.ok(footerTrack.every((row) => row.height >= 44), `${viewport.width}: active footer actions retain accessible targets ${JSON.stringify(footerTrack)}`);
      assert.ok(footerTrack[0].right <= footerTrack[1].left, `${viewport.width}: active footer actions never overlap ${JSON.stringify(footerTrack)}`);
      if (viewport.width === 1180) {
        const expected = [{ left: 401, width: 116, top: 625 }, { left: 743, width: 140, top: 625 }];
        footerTrack.forEach((row, index) => Object.entries(expected[index]).forEach(([key, value]) => assert.ok(Math.abs(row[key] - value) <= (index === 0 && key === "left" ? 1 : 4), `1180: ${row.kind} ${key} follows approved action track ${JSON.stringify(footerTrack)}`)));
      } else {
        assert.ok(footerTrack[0].left < footerTrack[1].left && footerTrack[1].right < viewport.width, `1440: active footer ordering does not regress ${JSON.stringify(footerTrack)}`);
      }
    }
    evidence.push(await captureVisual(cdp, viewport, `${missionConcept}--${viewport.width}x${viewport.height}.png`));
    if (viewport.device === "desktop") {
      await navigateWorkspace(cdp, viewport, "intelligence", "signals-registry-inspector");
      await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-selected-context=\"signal-cpi-flow\"]')", `${viewport.width}: Signals visual facts`);
      await assertNoOverflow(cdp, viewport, `${viewport.width} Signals visual`);
      evidence.push(await captureVisual(cdp, viewport, `desktop-ai-signals--${viewport.width}x${viewport.height}.png`));
    } else {
      await click(cdp, 'button[data-kordyn-v2-object-id="run-sol-approval"][data-kordyn-v2-object-type="Agent run"]');
      await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="mobile"]')?.dataset.kordynV2SelectedId === 'run-sol-approval'`, `${viewport.width}: SOL Mission selected`);
      await click(cdp, '[data-kordyn-v2-open-approval="run-sol-approval"]');
      await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]')", `${viewport.width}: approval visual`);
      await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]')?.contains(document.activeElement)", `${viewport.width}: approval visual owns protected focus`);
      await assertNoOverflow(cdp, viewport, `${viewport.width} approval visual`);
      await assertMobileApprovalIsolation(cdp, viewport);
      evidence.push(await captureVisual(cdp, viewport, `mobile-ai-task-approval--${viewport.width}x${viewport.height}.png`));
      await closeApprovalAndVerifySupportRestoration(cdp, viewport);
    }
  }
  assert.equal(evidence.length, 8, "exactly four approved AI concepts across eight immutable captures");
  await writeFile(path.join(outputDir, "capture-evidence.json"), `${JSON.stringify({
    schemaVersion: 1,
    runner: "tests/run-kordyn-v2-ai-browser.mjs",
    fixture: "tests/kordyn-v2-production-fixture.js",
    productionSourceCommit,
    representativeAgentRunFixtures: [
      { id: "run-btc-analysis-fixture", stage: "analysis", authority: "Task 5 production-shaped fixture" },
      { id: "run-eth-monitor", stage: "monitoring", authority: "Task 5 production-shaped fixture" },
      { id: "run-sol-approval", stage: "approval", authority: "Task 5 production-shaped fixture" },
      { id: "run-eth-executing-fixture", stage: "executing", authority: "Task 5 production-shaped fixture" },
      { id: "run-eth-completed-fixture", stage: "completed", authority: "Task 5 production-shaped fixture" }
    ],
    captures: evidence.slice().sort((left, right) => left.file.localeCompare(right.file))
  }, null, 2)}\n`);
  return evidence;
}

async function closeOverlay(cdp, selector) {
  await click(cdp, `${selector} [data-kordyn-v2-overlay-close], ${selector} [data-kordyn-v2-mobile-sheet-close]`);
  await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(selector)})`, `close ${selector}`);
}

async function selectCanonical(cdp, viewport, type, id) {
  const selector = `button[data-kordyn-v2-object-id="${id}"][data-kordyn-v2-object-type="${type}"]`;
  const hasRow = await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  if (hasRow) {
    assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.dataset.kordynV2ObjectType`), type, `${id}: clicked row exposes canonical type`);
    await click(cdp, selector);
  } else {
    assert.equal(viewport.device, "mobile", `${id}: only APP may select the current inspected hero`);
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-selected-context="${id}"]')`, `${id}: current APP inspector`);
    await click(cdp, `[data-kordyn-v2-selected-context="${id}"] footer button:first-child`);
  }
  await waitForExpression(
    cdp,
    `(() => { const root=document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]'); return root?.dataset.kordynV2SelectedId === ${JSON.stringify(id)} && root?.dataset.kordynV2SelectedType === ${JSON.stringify(type)}; })()`,
    `${viewport.width}: Root selects ${type}/${id}`
  );
}

async function verifyContextProofIdentity(cdp, viewport, type, id, evidenceText) {
  const trigger = `[data-kordyn-v2-context-proof="${id}"]`;
  await click(cdp, trigger);
  const overlay = viewport.device === "desktop" ? '[data-kordyn-v2-overlay="proof"]' : '[data-kordyn-v2-mobile-sheet="evidence"]';
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(overlay)})`, `${type}/${id}: Proof opens`);
  await flushCompositorFrame(cdp);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(overlay)})?.contains(document.activeElement)`, `${type}/${id}: Proof owns focus`, 2_000).catch(async (error) => {
    const diagnostic = await evaluate(cdp, `(() => { const active=document.activeElement; return { active:active?.outerHTML?.slice(0,400), overlay:Boolean(document.querySelector(${JSON.stringify(overlay)})), confirms:document.querySelectorAll('.cfmCard').length }; })()`);
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
  });
  const proof = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]');
    const overlay = document.querySelector(${JSON.stringify(overlay)});
    return {
      rootId:root.dataset.kordynV2SelectedId,
      rootType:root.dataset.kordynV2SelectedType,
      identity:overlay.querySelector('.kordynV2OverlayIdentity, .kordynV2MobileSheetIdentity')?.textContent?.trim() || '',
      text:overlay.textContent
    };
  })()`);
  assert.equal(proof.rootId, id, `${type}/${id}: Root ID remains aligned`);
  assert.equal(proof.rootType, type, `${type}/${id}: Root canonical type remains aligned`);
  assert.match(proof.identity, new RegExp(`${type} / ${id}`), `${type}/${id}: Proof canonical identity`);
  assert.ok(proof.text.includes(evidenceText), `${type}/${id}: Proof contains authoritative evidence`);
  if (viewport.device === "desktop") {
    await press(cdp, "Escape");
    await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(overlay)})`, `${type}/${id}: Proof Escape close`);
    assert.equal(await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(trigger)})`), true, `${type}/${id}: Proof returns focus`);
    await click(cdp, "[data-kordyn-v2-context-trigger]");
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"context\"]')", `${type}/${id}: Context opens`);
    await flushCompositorFrame(cdp);
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"context\"]')?.contains(document.activeElement)", `${type}/${id}: Context owns focus`);
    const contextIdentity = await evaluate(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"context\"] .kordynV2OverlayIdentity')?.textContent?.trim()");
    assert.match(contextIdentity, new RegExp(`${type} / ${id}`), `${type}/${id}: Context canonical identity`);
    await press(cdp, "Escape");
    await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-overlay=\"context\"]')", `${type}/${id}: Context Escape close`);
  } else {
    await click(cdp, '[data-kordyn-v2-evidence-tab="context"]');
    assert.match(
      await evaluate(cdp, "document.querySelector('.kordynV2MobileSheetIdentity')?.textContent?.trim()"),
      new RegExp(`${type} / ${id}`),
      `${type}/${id}: APP Context canonical identity`
    );
    await click(cdp, '[data-kordyn-v2-evidence-tab="proof"]');
    await press(cdp, "Escape");
    await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(overlay)})`, `${type}/${id}: APP sheet Escape close`);
    assert.equal(await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(trigger)})`), true, `${type}/${id}: APP sheet returns focus`);
  }
}

async function runContextAction(cdp, { selector, finalKind, expectedText, confirm = false }) {
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.disabled`), false, `${selector}: protected action is enabled after canonical selection`);
  await click(cdp, selector);
  if (confirm) {
    await confirmProtectedAction(cdp, selector);
  }
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-action-state=\"processing\"]')", `${selector}: processing first`);
  assert.equal(await evaluate(cdp, `Boolean(document.querySelector('[data-kordyn-v2-action-state="${finalKind}"]'))`), false, `${selector}: no terminal state before authority responds`);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-action-state]:not([data-kordyn-v2-action-state=\"processing\"])')", `${selector}: terminal authority state`, 2_000).catch(async (error) => {
    const diagnostic = await evaluate(cdp, `({ states:[...document.querySelectorAll('[data-kordyn-v2-action-state]')].map((node)=>({kind:node.dataset.kordynV2ActionState,text:node.textContent})), calls:window.__task5Calls })`);
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
  });
  const terminal = await evaluate(cdp, `(() => { const node=document.querySelector('[data-kordyn-v2-action-state]:not([data-kordyn-v2-action-state="processing"])'); return { kind:node?.dataset.kordynV2ActionState, text:node?.textContent || '', calls:window.__task5Calls?.actionRequests }; })()`);
  assert.equal(terminal.kind, finalKind, `${selector}: exact terminal kind; ${JSON.stringify(terminal)}`);
  const textValue = terminal.text;
  assert.ok(textValue.includes(expectedText), `${selector}: terminal authority detail remains visible`);
}

async function verifyMissionIdentity(cdp, baseUrl, viewport) {
  await navigatePage(cdp, baseUrl, viewport);
  const id = "run-btc-complete";
  const selector = `button[data-kordyn-v2-object-id="${id}"][data-kordyn-v2-object-type="Agent run"]`;
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(selector)})`, `${viewport.width}: Mission selectable row`);
  const clickedType = await evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.dataset.kordynV2ObjectType`);
  await click(cdp, selector);
  await waitForExpression(cdp, `(() => { const root=document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]'); return root?.dataset.kordynV2SelectedId === ${JSON.stringify(id)} && root?.dataset.kordynV2SelectedType === 'Agent run'; })()`, `${viewport.width}: Mission reaches Root selection`);
  assert.equal(clickedType, "Agent run", `${viewport.width}: Mission row canonical type`);
  const trigger = `[data-kordyn-v2-mission-proof="${id}"]`;
  await click(cdp, trigger);
  const overlay = viewport.device === "desktop" ? '[data-kordyn-v2-overlay="proof"]' : '[data-kordyn-v2-mobile-sheet="evidence"]';
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(overlay)})`, `${viewport.width}: Mission Proof opens`);
  await flushCompositorFrame(cdp);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(overlay)})?.contains(document.activeElement)`, `${viewport.width}: Mission Proof owns focus`);
  const identity = await evaluate(cdp, `document.querySelector(${JSON.stringify(overlay)})?.querySelector('.kordynV2OverlayIdentity, .kordynV2MobileSheetIdentity')?.textContent?.trim()`);
  assert.match(identity, /Agent run \/ run-btc-complete/, `${viewport.width}: Mission Proof identity`);
  if (viewport.device === "mobile") {
    await click(cdp, '[data-kordyn-v2-evidence-tab="context"]');
    assert.match(await evaluate(cdp, "document.querySelector('.kordynV2MobileSheetIdentity')?.textContent?.trim()"), /Agent run \/ run-btc-complete/, `${viewport.width}: Mission Context identity`);
  }
  await press(cdp, "Escape");
  await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(overlay)})`, `${viewport.width}: Mission Proof Escape close`);
  assert.equal(await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(trigger)})`), true, `${viewport.width}: Mission Proof returns focus`);
}

async function verifyApproval(cdp, baseUrl, viewport, outcome) {
  await navigatePage(cdp, baseUrl, viewport, "ready", { approval: outcome });
  await selectCanonical(cdp, viewport, "Agent run", "run-sol-approval");
  const trigger = '[data-kordyn-v2-open-approval="run-sol-approval"]';
  await click(cdp, trigger);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]')", `${viewport.width}: approval opens`);
  await flushCompositorFrame(cdp);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]')?.contains(document.activeElement)", `${viewport.width}: approval owns focus`);
  const ready = await evaluate(cdp, `(() => {
    const sheet=document.querySelector('[data-kordyn-v2-ai-approval-sheet]');
    const buttons=[...sheet.querySelectorAll('button')];
    return { text:sheet.textContent, primaryDisabled:sheet.querySelector('[data-kordyn-v2-approval-primary]').disabled, overflow:Math.max(0,sheet.scrollWidth-sheet.clientWidth), minimum:Math.min(...buttons.map((node)=>Math.min(node.getBoundingClientRect().width,node.getBoundingClientRect().height))) };
  })()`);
  assert.equal(ready.primaryDisabled, false, `${viewport.width}: valid plan enables one-shot approval`);
  assert.equal(ready.overflow, 0, `${viewport.width}: approval sheet no overflow`);
  assert.match(ready.text, /12\/12 通过/);
  assert.match(ready.text, /plan-sol-approval/i);
  if (viewport.device === "mobile") assert.ok(ready.minimum >= 44, `${viewport.width}: approval targets are at least 44px`);
  const writesBefore = await evaluate(cdp, "window.__task5Calls.authorityWrites");
  await click(cdp, "[data-kordyn-v2-approval-primary]");
  await confirmProtectedAction(cdp, `${viewport.width}: approval`);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-approval-outcome=\"processing\"]')", `${viewport.width}: approval processing first`);
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('[data-kordyn-v2-approval-outcome=\"failed\"], [data-kordyn-v2-approval-outcome=\"partial\"], [data-kordyn-v2-approval-outcome=\"succeeded\"]'))"), false, `${viewport.width}: no optimistic approval success`);
  const expected = outcome === "partial" ? "partial" : outcome === "success" ? "succeeded" : "failed";
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-approval-outcome="${expected}"]')`, `${viewport.width}: approval ${expected}`);
  const terminal = await evaluate(cdp, `document.querySelector('[data-kordyn-v2-approval-outcome="${expected}"]')?.textContent || ''`);
  if (expected === "failed") assert.match(terminal, /风控复核未通过.*未提交订单/s);
  if (expected === "partial") assert.match(terminal, /订单未提交/);
  if (expected === "succeeded") assert.match(terminal, /入场单已提交/);
  assert.equal(await evaluate(cdp, "window.__task5Calls.authorityWrites"), writesBefore + 1, `${viewport.width}: exactly one approval write`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.ok((await evaluate(cdp, `document.querySelector('[data-kordyn-v2-approval-outcome="${expected}"]')?.textContent?.length || 0`)) > 0, `${viewport.width}: ${expected} remains visible`);
  await flushCompositorFrame(cdp);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]').contains(document.activeElement)", `${viewport.width}: approval regains focus after authority response`);
  await press(cdp, "Tab", 8);
  assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-ai-approval-sheet]').contains(document.activeElement)"), true, `${viewport.width}: approval focus trap`);
  await press(cdp, "Escape");
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-ai-approval-sheet]')", `${viewport.width}: approval Escape close`);
  assert.equal(await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(trigger)})`), true, `${viewport.width}: approval returns focus`);
  return expected;
}

async function verifyDialogAndOutput(cdp, baseUrl, viewport) {
  await navigatePage(cdp, baseUrl, viewport);
  const dialogTrigger = "[data-kordyn-v2-dialog-trigger]";
  await click(cdp, dialogTrigger);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-dialog-surface]') && window.__task5Calls.chatReads>0", `${viewport.width}: real AI dialog reads authority`);
  await flushCompositorFrame(cdp);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-dialog-surface]')?.contains(document.activeElement)", `${viewport.width}: dialog owns focus`);
  const initialCount = await evaluate(cdp, "document.querySelectorAll('[data-kordyn-v2-message-id]').length");
  await typeInto(cdp, "#kordyn-v2-ai-dialog-input", "复核 SOL 风险边界");
  await click(cdp, ".kordynV2AiDialogComposer > button");
  await waitForExpression(cdp, "document.querySelector('[data-dialog-state=\"processing\"]')", `${viewport.width}: dialog processing first`);
  assert.equal(await evaluate(cdp, "document.querySelectorAll('[data-kordyn-v2-message-id]').length"), initialCount, `${viewport.width}: no optimistic dialog message`);
  await waitForExpression(cdp, `document.querySelectorAll('[data-kordyn-v2-message-id]').length>${initialCount} && document.querySelector('.kordynV2AiDialogMessages')?.textContent.includes('继续等待风险边界')`, `${viewport.width}: authoritative dialog reread`);
  assert.equal(await evaluate(cdp, "window.__task5Calls.chatWrites"), 1, `${viewport.width}: one chat write`);
  assert.ok((await evaluate(cdp, "window.__task5Calls.chatReads")) >= 2, `${viewport.width}: authoritative GET follows POST`);
  await press(cdp, "Tab", 8);
  assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-dialog-surface]').contains(document.activeElement)"), true, `${viewport.width}: dialog focus trap`);
  await press(cdp, "Escape");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-destination=\"ai/missions\"]')", `${viewport.width}: dialog Escape returns Mission`);
  await flushCompositorFrame(cdp);
  await waitForExpression(cdp, `document.activeElement?.matches(${JSON.stringify(dialogTrigger)})`, `${viewport.width}: dialog returns focus`);

  await selectCanonical(cdp, viewport, "Agent run", "run-sol-approval");
  const outputTrigger = '[data-kordyn-v2-open-output="run-sol-approval"]';
  await click(cdp, outputTrigger);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-output-sheet]')", `${viewport.width}: output opens from real Mission`);
  await flushCompositorFrame(cdp);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-output-sheet]')?.contains(document.activeElement)", `${viewport.width}: output owns focus`);
  await click(cdp, ".kordynV2AiOutputToolbar div > button:nth-child(2)");
  await waitForExpression(cdp, "document.querySelector('[data-output-state=\"translating\"]')", `${viewport.width}: translation processing`);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-poster-canvas][data-language=\"en\"]')", `${viewport.width}: authoritative English output`);
  const exportFonts = await fontsDiagnostic(cdp);
  assert.equal(exportFonts.result, "resolved", `${viewport.width}: export fonts settle before PNG`);
  await flushCompositorFrame(cdp);
  const downloadsBefore = await evaluate(cdp, "window.__task5Calls.downloads.length");
  await click(cdp, "[data-kordyn-v2-output-png]");
  await waitForExpression(cdp, "document.querySelector('[data-output-state=\"exporting\"]')", `${viewport.width}: PNG processing`);
  await waitForExpression(cdp, `window.__task5Calls.downloads.length>${downloadsBefore}`, `${viewport.width}: PNG delivered`, 30_000).catch(async (error) => {
    const diagnostic = await evaluate(cdp, `({ output:[...document.querySelectorAll('[data-output-state]')].map((node)=>({state:node.dataset.outputState,text:node.textContent})), downloads:window.__task5Calls.downloads, actions:window.__task5Calls.actionRequests })`);
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
  });
  const download = await evaluate(cdp, "window.__task5Calls.downloads.at(-1)");
  assert.match(download.prefix, /^data:image\/png/);
  assert.match(download.filename, /\.png$/);
  const outputGeometry = await evaluate(cdp, `(() => { const sheet=document.querySelector('[data-kordyn-v2-ai-output-sheet]'); return { overflow:Math.max(0,sheet.scrollWidth-sheet.clientWidth), minimum:Math.min(...[...sheet.querySelectorAll('button')].map((node)=>Math.min(node.getBoundingClientRect().width,node.getBoundingClientRect().height))) }; })()`);
  assert.equal(outputGeometry.overflow, 0, `${viewport.width}: output has no horizontal overflow`);
  if (viewport.device === "mobile") assert.ok(outputGeometry.minimum >= 44, `${viewport.width}: output targets are at least 44px`);
  await flushCompositorFrame(cdp);
  await waitForExpression(
    cdp,
    "document.querySelector('[data-kordyn-v2-ai-output-sheet]')?.contains(document.activeElement)",
    `${viewport.width}: output retains focus after real PNG completion`,
    2_000
  ).catch(async (error) => {
    const diagnostic = await evaluate(cdp, `({ active:document.activeElement?.outerHTML?.slice(0,400), output:Boolean(document.querySelector('[data-kordyn-v2-ai-output-sheet]')) })`);
    throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
  });
  await press(cdp, "Escape");
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-ai-output-sheet]')", `${viewport.width}: output Escape close`);
  assert.equal(await evaluate(cdp, `document.activeElement?.matches(${JSON.stringify(outputTrigger)})`), true, `${viewport.width}: output returns focus`);
}

function summarizeObservedEvents(events) {
  const requests = new Map();
  const completed = new Set();
  const failed = [];
  const exceptions = [];
  const consoleErrors = [];
  for (const event of events) {
    if (event.method === "Network.requestWillBeSent") requests.set(event.params.requestId, event.params.request?.url || "unknown");
    if (event.method === "Network.loadingFinished") completed.add(event.params.requestId);
    if (event.method === "Network.loadingFailed") {
      completed.add(event.params.requestId);
      failed.push({ url: requests.get(event.params.requestId) || "unknown", error: event.params.errorText });
    }
    if (event.method === "Runtime.exceptionThrown") exceptions.push(event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text || "unknown");
    if (event.method === "Runtime.consoleAPICalled" && event.params.type === "error") consoleErrors.push(event.params.args?.map((arg) => arg.value || arg.description).join(" "));
    if (event.method === "Log.entryAdded" && event.params.entry?.level === "error") consoleErrors.push(event.params.entry.text);
  }
  return {
    requests: requests.size,
    pending: [...requests].filter(([id]) => !completed.has(id)).map(([, url]) => url),
    failed,
    exceptions,
    consoleErrors
  };
}

async function fontsDiagnostic(cdp) {
  return await evaluate(cdp, `(() => {
    const before=document.fonts?.status || 'unavailable';
    const started=performance.now();
    return Promise.race([
      document.fonts?.ready?.then(() => ({ before, result:'resolved', after:document.fonts.status, elapsedMs:performance.now()-started })) || Promise.resolve({ before, result:'unavailable', after:'unavailable', elapsedMs:0 }),
      new Promise((resolve)=>setTimeout(()=>resolve({ before, result:'timeout', after:document.fonts?.status || 'unavailable', elapsedMs:performance.now()-started }),3000))
    ]);
  })()`);
}

async function prepareMissionOutput(cdp, baseUrl, viewport, { english = false, longSequence = false } = {}) {
  await navigatePage(cdp, baseUrl, viewport);
  if (longSequence) {
    await click(cdp, "[data-kordyn-v2-dialog-trigger]");
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-dialog-surface]') && window.__task5Calls.chatReads>0 && document.querySelector('[data-dialog-state=\"ready\"]')", "diagnostic dialog authority read");
    await flushCompositorFrame(cdp);
    await typeInto(cdp, "#kordyn-v2-ai-dialog-input", "复核 SOL 风险边界");
    await waitForExpression(cdp, "document.querySelector('#kordyn-v2-ai-dialog-input')?.value.includes('复核 SOL 风险边界')", "diagnostic dialog input accepted");
    await waitForExpression(cdp, "document.querySelector('.kordynV2AiDialogComposer > button')?.disabled === false", "diagnostic dialog send enabled");
    await click(cdp, ".kordynV2AiDialogComposer > button");
    await waitForExpression(cdp, "document.querySelector('.kordynV2AiDialogMessages')?.textContent.includes('继续等待风险边界')", "diagnostic authoritative dialog reply").catch(async (error) => {
      const diagnostic = await evaluate(cdp, `({ dialog:document.querySelector('[data-dialog-state]')?.dataset.dialogState, text:document.querySelector('[data-dialog-state]')?.textContent, calls:window.__task5Calls })`);
      throw new Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);
    });
    await press(cdp, "Escape");
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-destination=\"ai/missions\"]')", "diagnostic dialog closes");
  }
  await selectCanonical(cdp, viewport, "Agent run", "run-sol-approval");
  await click(cdp, '[data-kordyn-v2-open-output="run-sol-approval"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-output-sheet]')", "diagnostic Mission output opens");
  await flushCompositorFrame(cdp);
  if (english) {
    await click(cdp, ".kordynV2AiOutputToolbar div > button:nth-child(2)");
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-poster-canvas][data-language=\"en\"]')", "diagnostic English poster");
  }
}

async function diagnosePngCase(cdp, baseUrl, viewport, configuration) {
  await prepareMissionOutput(cdp, baseUrl, viewport, configuration);
  const handlerFonts = await fontsDiagnostic(cdp);
  cdp.takeEvents();
  const downloadsBefore = await evaluate(cdp, "window.__task5Calls.downloads.length");
  const handlerStartedAt = Date.now();
  await click(cdp, "[data-kordyn-v2-output-png]");
  await waitForExpression(cdp, "document.querySelector('[data-output-state=\"exporting\"]')", "diagnostic real handler exporting");
  while (Date.now() - handlerStartedAt < 7_000) {
    const terminal = await evaluate(cdp, "Boolean(document.querySelector('[data-output-state=\"succeeded\"], [data-output-state=\"failed\"]'))");
    if (terminal) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const handler = await evaluate(cdp, `({
    output:[...document.querySelectorAll('[data-output-state]')].map((node)=>({state:node.dataset.outputState,text:node.textContent})),
    downloads:window.__task5Calls.downloads.length,
    downloadDelta:window.__task5Calls.downloads.length-${downloadsBefore},
    elapsedMs:${Date.now() - handlerStartedAt}
  })`);
  const handlerEvents = summarizeObservedEvents(cdp.takeEvents());

  await prepareMissionOutput(cdp, baseUrl, viewport, configuration);
  const fonts = await fontsDiagnostic(cdp);
  cdp.takeEvents();
  const direct = fonts.result === "resolved"
    ? await evaluate(cdp, "window.__task5DiagnosticToPng(6000)")
    : { status: "skipped-fonts-not-ready" };
  const directEvents = summarizeObservedEvents(cdp.takeEvents());
  return { configuration, fonts, direct, directEvents, handlerFonts, handler, handlerEvents };
}

async function runPngDiagnosticMatrix(cdp, baseUrl) {
  const viewport = viewports[0];
  const matrix = [];
  const requestedCase = process.argv.find((argument) => argument.startsWith("--png-case="))?.split("=").slice(1).join("=");
  const configurations = [
    { name: "fresh-chinese", english: false, longSequence: false },
    { name: "fresh-english", english: true, longSequence: false },
    { name: "dialog-then-english", english: true, longSequence: true }
  ].filter((configuration) => !requestedCase || configuration.name === requestedCase);
  assert.ok(configurations.length, `known PNG diagnostic case: ${requestedCase}`);
  for (const configuration of configurations) {
    const row = await diagnosePngCase(cdp, baseUrl, viewport, configuration);
    matrix.push(row);
    process.stdout.write(`KORDYN V2 AI PNG diagnostic row ${JSON.stringify(row)}\n`);
  }
  return matrix;
}

async function assertActionClearance(cdp, viewport, protectedSelector) {
  const geometry = await evaluate(cdp, `(() => {
    const selectors = {
      action:${JSON.stringify(protectedSelector)},
      prompt:'[data-kordyn-v2-dialog-trigger]',
      support:'[data-kordyn-v2-ai-support-trigger]',
      nav:'[data-kordyn-v2-mobile-navigation]'
    };
    const rects = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
      const node = document.querySelector(selector);
      if (!node) return [key, null];
      const rect = node.getBoundingClientRect();
      return [key, { left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height }];
    }));
    const overlap = (a,b) => !a || !b ? 0 : Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
    return { rects, overlaps:{ actionPrompt:overlap(rects.action,rects.prompt), actionSupport:overlap(rects.action,rects.support), actionNav:overlap(rects.action,rects.nav), promptSupport:overlap(rects.prompt,rects.support), promptNav:overlap(rects.prompt,rects.nav), supportNav:overlap(rects.support,rects.nav) } };
  })()`);
  for (const key of ["prompt", "support"]) assert.ok(geometry.rects[key]?.width >= 44 && geometry.rects[key]?.height >= 44, `${viewport.width}: ${key} target is at least 44px`);
  if (viewport.device === "mobile") {
    for (const key of ["action", "nav"]) assert.ok(geometry.rects[key]?.width >= 44 && geometry.rects[key]?.height >= 44, `${viewport.width}: ${key} target is at least 44px`);
  }
  for (const [key, overlap] of Object.entries(geometry.overlaps)) assert.equal(overlap, 0, `${viewport.width}: ${key} intersection is zero`);
}

async function verifyContextWorkspaces(cdp, baseUrl, viewport) {
  const cases = [
    { workspace: "intelligence", layout: viewport.device === "desktop" ? "signals-registry-inspector" : "signals-task-flow", type: "Signal", id: "signal-cpi-flow", evidence: "Authoritative intelligence fact loaded", action: { selector: '[data-kordyn-v2-context-action="remember"]', finalKind: "succeeded", text: "memory-task5" } },
    { workspace: "watch", layout: viewport.device === "desktop" ? "watch-registry-inspector" : "watch-task-flow", type: "Watch", id: "watch-eth-retest", evidence: "Waiting for retest", action: { selector: '[data-kordyn-v2-context-action="cancel-watch"]', finalKind: "succeeded", text: "watch-eth-retest", confirm: true } },
    { workspace: "events", layout: viewport.device === "desktop" ? "events-calendar-inspector" : "events-task-flow", type: "Event", id: "event-fomc-date", evidence: "Official calendar fact loaded", action: { selector: '[data-kordyn-v2-context-action="refresh-events"]', finalKind: "partial", text: "成功 2/3" } }
  ];
  const endpoints = [];
  for (const row of cases) {
    await navigatePage(cdp, baseUrl, viewport);
    await navigateWorkspace(cdp, viewport, row.workspace, row.layout);
    await assertNoOverflow(cdp, viewport, `${viewport.width} ${row.workspace}`);
    await selectCanonical(cdp, viewport, row.type, row.id);
    await verifyContextProofIdentity(cdp, viewport, row.type, row.id, row.evidence);
    await assertActionClearance(cdp, viewport, row.action.selector);
    await runContextAction(cdp, { selector: row.action.selector, finalKind: row.action.finalKind, expectedText: row.action.text, confirm: row.action.confirm });
    const currentEndpoints = await evaluate(cdp, "window.__task5Calls.actionRequests.filter((request)=>request.method!=='GET').map((request)=>request.endpoint)");
    assert.equal(currentEndpoints.length, 1, `${viewport.width} ${row.type}: one bounded authoritative write`);
    endpoints.push(currentEndpoints[0]);
  }
  assert.deepEqual(endpoints, [
    "/api/agent/memory",
    "/api/watch-triggers/watch-eth-retest/cancel",
    "/api/event-sources/refresh"
  ], `${viewport.width}: exact bounded production action endpoints`);
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

assertSafeOutputDirectory();
const outputIdentity = await lstat(outputDir).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
assert.equal(outputIdentity?.isSymbolicLink?.() || false, false, "Task 5 output cannot be a symlink");
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-task5-browser-"));
const vite = spawn(process.execPath, [
  path.join(rootDir, "node_modules/vite/bin/vite.js"),
  "--host", "127.0.0.1",
  "--port", String(vitePort),
  "--strictPort"
], { cwd: rootDir, stdio: "ignore" });
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--hide-scrollbars",
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
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable"), cdp.send("Network.enable"), cdp.send("Log.enable")]);
  if (process.argv.includes("--png-diagnostic")) {
    const matrix = await runPngDiagnosticMatrix(cdp, baseUrl);
    process.stdout.write(`KORDYN V2 AI PNG diagnostic ${JSON.stringify(matrix)}\n`);
  } else {
    await verifyDialogAndOutput(cdp, baseUrl, viewports[0]);
    await verifyDialogAndOutput(cdp, baseUrl, viewports[2]);
    const captures = await captureApprovedSurfaces(cdp, baseUrl);
    const desktop = viewports[0];
    await navigatePage(cdp, baseUrl, desktop);
  await waitForExpression(cdp, "document.querySelector('button[data-kordyn-v2-object-id=\"run-btc-complete\"][data-kordyn-v2-object-type=\"Agent run\"]')", "lazy production AI Mission Registry");
  await click(cdp, 'button[data-kordyn-v2-object-id="run-btc-complete"][data-kordyn-v2-object-type="Agent run"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=\"desktop\"]')?.dataset.kordynV2SelectedId === 'run-btc-complete'", "Mission selection reaches Root");
  const identityChain = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="desktop"]');
    const selectedRow = document.querySelector('button[data-kordyn-v2-object-id="run-btc-complete"]');
    return {
      id: root.dataset.kordynV2SelectedId,
      type: root.dataset.kordynV2SelectedType,
      clickedType: selectedRow?.dataset.kordynV2ObjectType || null
    };
  })()`);
  assert.deepEqual(identityChain, { id: "run-btc-complete", type: "Agent run", clickedType: "Agent run" }, "trusted Mission row type and Root canonical identity align");
  await click(cdp, '[data-kordyn-v2-mission-proof="run-btc-complete"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"proof\"]')", "Mission Proof overlay");
  assert.match(
    await evaluate(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"proof\"] .kordynV2OverlayIdentity')?.textContent?.trim()"),
    /Agent run \/ run-btc-complete/,
    "Mission Proof identity aligns with the real clicked row and Root ID"
  );
  await closeOverlay(cdp, '[data-kordyn-v2-overlay="proof"]');
  await click(cdp, "[data-kordyn-v2-context-trigger]");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"context\"]')", "Mission Context overlay");
  assert.match(
    await evaluate(cdp, "document.querySelector('[data-kordyn-v2-overlay=\"context\"] .kordynV2OverlayIdentity')?.textContent?.trim()"),
    /Agent run \/ run-btc-complete/,
    "Mission Context identity aligns with the real clicked row and Root ID"
  );
  await closeOverlay(cdp, '[data-kordyn-v2-overlay="context"]');
  await verifyContextWorkspaces(cdp, baseUrl, desktop);
  await verifyContextWorkspaces(cdp, baseUrl, viewports[2]);
  await verifyMissionIdentity(cdp, baseUrl, desktop);
  await verifyMissionIdentity(cdp, baseUrl, viewports[2]);
  const approvalStates = [
    await verifyApproval(cdp, baseUrl, desktop, "failure"),
    await verifyApproval(cdp, baseUrl, viewports[2], "partial")
  ];
    const states = await verifyStateScenarios(cdp, baseUrl);
    process.stdout.write(`KORDYN V2 AI master browser PASS captures=${captures.length} context=desktop+APP:Mission+Signal+Watch+Event approval=${approvalStates.join("+")} dialog+output=desktop+APP states=${states.length}/13:${outputDir}\n`);
  }
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
