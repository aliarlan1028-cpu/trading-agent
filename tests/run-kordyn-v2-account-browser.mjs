import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import WebSocket from "ws";
import { resolveAccountSourceProvenance } from "./helpers/kordyn-v2-account-source-provenance.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pagePath = "/tests/kordyn-v2-account-browser.html";
const reviewRoot = path.join(rootDir, ".impeccable/review/kordyn-v2");
const outputDir = path.resolve(rootDir, process.env.KORDYN_V2_SCREENSHOT_DIR || ".impeccable/review/kordyn-v2/account");
const runner = "tests/run-kordyn-v2-account-browser.mjs";
const fixture = "tests/kordyn-v2-account-browser.jsx";
const { productSourceCommit, captureTestSourceCommit } = resolveAccountSourceProvenance(rootDir);

const viewports = Object.freeze({
  desktop1440: Object.freeze({ width: 1440, height: 900, device: "desktop" }),
  desktop1180: Object.freeze({ width: 1180, height: 800, device: "desktop" }),
  mobile390: Object.freeze({ width: 390, height: 844, device: "mobile" }),
  mobile430: Object.freeze({ width: 430, height: 932, device: "mobile" })
});
const stateScenarios = Object.freeze([
  Object.freeze({ kind: "loading", viewport: viewports.desktop1440, workspaceId: "market" }),
  Object.freeze({ kind: "empty", viewport: viewports.mobile390, workspaceId: "market" }),
  Object.freeze({ kind: "processing", viewport: viewports.desktop1180, workspaceId: "plans" }),
  Object.freeze({ kind: "stale", viewport: viewports.mobile390, workspaceId: "positions", retainsFacts: true }),
  Object.freeze({ kind: "degraded", viewport: viewports.mobile430, workspaceId: "account", retainsFacts: true }),
  Object.freeze({ kind: "failed", viewport: viewports.desktop1440, workspaceId: "market" }),
  Object.freeze({ kind: "forbidden", viewport: viewports.mobile390, workspaceId: "account" }),
  Object.freeze({ kind: "disabled", viewport: viewports.desktop1180, workspaceId: "orders" }),
  Object.freeze({ kind: "approval", viewport: viewports.mobile430, workspaceId: "plans" }),
  Object.freeze({ kind: "partial", viewport: viewports.desktop1440, workspaceId: "plans" }),
  Object.freeze({ kind: "no-result", viewport: viewports.mobile390, workspaceId: "fills" }),
  Object.freeze({ kind: "long-content", viewport: viewports.mobile390, workspaceId: "fills" }),
  Object.freeze({ kind: "large-list", viewport: viewports.mobile430, workspaceId: "market" })
]);
const legacyStyleFiles = Object.freeze([
  "styles.css",
  "product-foundation.css",
  "workspace.css",
  "workspace-additions.css",
  "product-system.css",
  "conceptPages.css",
  "conceptSettings.css",
  "zero-base-mobile.css",
  "zero-base-system.css",
  "zero-base-workbenches.css"
]);
const mobileWorkspaceMarkers = Object.freeze({
  market: "[data-kordyn-v2-mobile-market-view]",
  account: "[data-kordyn-v2-mobile-account-view]",
  positions: "[data-kordyn-v2-position-mobile-view]",
  plans: "[data-kordyn-v2-execution-mobile-view]",
  orders: "[data-kordyn-v2-execution-mobile-view]",
  fills: "[data-kordyn-v2-execution-mobile-view]"
});
const desktopWorkspaceMarkers = Object.freeze({
  market: '[data-kordyn-v2-destination="account/market"]',
  account: '[data-kordyn-v2-destination="account/account"]',
  positions: '[data-kordyn-v2-destination="account/positions"]',
  plans: '[data-kordyn-v2-execution-workspace="plans"]',
  orders: '[data-kordyn-v2-execution-workspace="orders"]',
  fills: '[data-kordyn-v2-execution-workspace="fills"]'
});
const contentStateKinds = new Set(["ready", "processing", "stale", "degraded", "partial", "long-content", "large-list"]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function viewportName(viewport) {
  return `${viewport.width}x${viewport.height}`;
}

function relativeInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function rejectSymlinksBetween(parent, candidate) {
  if (!relativeInside(parent, candidate)) throw new Error(`unsafe_account_output:${candidate}`);
  let current = parent;
  for (const segment of path.relative(parent, candidate).split(path.sep)) {
    current = path.join(current, segment);
    let identity;
    try {
      identity = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (identity.isSymbolicLink()) throw new Error(`account_output_symlink:${current}`);
  }
}

async function prepareOutputDir() {
  await rejectSymlinksBetween(reviewRoot, outputDir);
  const identity = await lstat(outputDir).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (identity) {
    if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error(`invalid_account_output:${outputDir}`);
    for (const name of await readdir(outputDir)) {
      const child = path.join(outputDir, name);
      const childIdentity = await lstat(child);
      if (childIdentity.isSymbolicLink()) throw new Error(`account_output_contains_symlink:${name}`);
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

async function waitForExpression(cdp, expression, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function ensureActivePage(cdp) {
  await cdp.send("Page.bringToFront").catch(() => null);
  await cdp.send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true }).catch(() => null);
}

async function flush(cdp) {
  await ensureActivePage(cdp);
  await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 1, fromSurface: true, captureBeyondViewport: false });
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
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return {
      missing: true,
      shell: [...document.querySelectorAll("[data-kordyn-v2-shell]")].map((node) => ({
        device: node.dataset.kordynV2Shell,
        domain: node.dataset.kordynV2Domain,
        workspace: node.dataset.kordynV2Workspace,
        selectedId: node.dataset.kordynV2SelectedId,
        selectedType: node.dataset.kordynV2SelectedType
      })),
      objects: [...document.querySelectorAll("[data-kordyn-v2-object-id]")].map((node) => ({
        id: node.dataset.kordynV2ObjectId,
        type: node.dataset.kordynV2ObjectType,
        text: node.textContent.trim().slice(0, 80)
      })).slice(0, 40),
      text: document.body.textContent.trim().slice(0, 600)
    };
    target.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1 && (hit === target || target.contains(hit))
      ? { x, y }
      : { blockedBy: hit?.outerHTML?.slice(0, 240) || "none", rect: [rect.left, rect.top, rect.right, rect.bottom], viewport: [innerWidth, innerHeight] };
  })()`);
  assert.ok(Number.isFinite(point?.x) && Number.isFinite(point?.y), `trusted click target is visible and topmost: ${selector}; ${JSON.stringify(point)}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function press(cdp, key, modifiers = 0) {
  const keyCode = key === "Tab" ? 9 : key === "Escape" ? 27 : key === "Enter" ? 13 : key.charCodeAt(0);
  await cdp.send("Input.dispatchKeyEvent", { type: key === "Enter" ? "rawKeyDown" : "keyDown", key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
  if (key === "Enter") await cdp.send("Input.dispatchKeyEvent", { type: "char", key, code: key, text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
}

async function navigatePage(cdp, baseUrl, viewport, scenario = "ready") {
  await setViewport(cdp, viewport);
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}?scenario=${encodeURIComponent(scenario)}&run=${Date.now()}` });
  await flush(cdp);
  await waitForExpression(cdp, "window.__task5AccountReady && document.querySelector('[data-kordyn-v2-root]')", `${viewportName(viewport)} ${scenario} Root`);
}

async function navigateAccount(cdp, workspaceId, viewport, scenario = "ready") {
  await click(cdp, `[data-kordyn-v2-domain-target="account"]`);
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Domain === "account"`, `${viewportName(viewport)} account domain`);
  if (workspaceId !== "market") await click(cdp, `[data-kordyn-v2-workspace-target="${workspaceId}"]`);
  await waitForExpression(
    cdp,
    `document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]')?.dataset.kordynV2Workspace === ${JSON.stringify(workspaceId)}`,
    `${viewportName(viewport)} account/${workspaceId}`
  );
  if (!contentStateKinds.has(scenario)) {
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-state="${scenario}"]')`, `${viewportName(viewport)} account/${workspaceId} ${scenario} boundary`);
  } else if (viewport.device === "desktop") {
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(desktopWorkspaceMarkers[workspaceId] || '[data-kordyn-v2-destination^="account/"]')})`, `${viewportName(viewport)} account/${workspaceId} destination`);
  } else {
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(mobileWorkspaceMarkers[workspaceId] || "[data-kordyn-v2-mobile-account-view]")})`, `${viewportName(viewport)} account/${workspaceId} mobile content`);
  }
}

async function assertNoOverflow(cdp, viewport, label) {
  const geometry = await evaluate(cdp, `(() => {
    const shell = document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]');
    const canvas = shell?.querySelector('[data-kordyn-v2-work-canvas]');
    const offenders = [...document.body.querySelectorAll("*")].flatMap((node) => {
      const rect = node.getBoundingClientRect();
      if (rect.right <= innerWidth + 1 && rect.left >= -1) return [];
      return [{ tag: node.tagName, className: String(node.className || ""), text: node.textContent?.slice(0, 80) || "", left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }];
    }).slice(0, 12);
    return {
      innerWidth,
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      body: { clientWidth: document.body.clientWidth, scrollWidth: document.body.scrollWidth },
      shell: shell ? { clientWidth: shell.clientWidth, scrollWidth: shell.scrollWidth } : null,
      canvas: canvas ? { clientWidth: canvas.clientWidth, scrollWidth: canvas.scrollWidth } : null,
      offenders
    };
  })()`);
  assert.equal(geometry.document.clientWidth, viewport.width, `${label}: document client width`);
  assert.ok(geometry.document.scrollWidth <= geometry.document.clientWidth + 1, `${label}: document overflow ${JSON.stringify(geometry)}`);
  assert.ok(geometry.body.scrollWidth <= geometry.innerWidth + 1, `${label}: body overflow ${JSON.stringify(geometry)}`);
  assert.ok(geometry.shell && geometry.shell.scrollWidth <= geometry.shell.clientWidth + 1, `${label}: shell overflow ${JSON.stringify(geometry)}`);
  return geometry;
}

async function assertTouchTargets(cdp, label) {
  const small = await evaluate(cdp, `(() => [...document.querySelectorAll('[data-kordyn-v2-shell="mobile"] button:not([disabled])')].flatMap((button) => {
    const rect = button.getBoundingClientRect();
    return rect.width < 44 || rect.height < 44
      ? [{ text: button.textContent.trim().slice(0, 80), width: Math.round(rect.width), height: Math.round(rect.height), className: String(button.className || "") }]
      : [];
  }).slice(0, 20))()`);
  assert.deepEqual(small, [], `${label}: mobile controls stay >=44px`);
}

async function assertPriceBoundaryGeometry(cdp, label) {
  const geometry = await evaluate(cdp, `(() => {
    const rectFor = (tone) => {
      const node = document.querySelector('.kordynV2PositionPriceRail [data-price-tone="' + tone + '"]');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const entry = rectFor("entry");
    const mark = rectFor("mark");
    const overlaps = Boolean(entry && mark && entry.left < mark.right && entry.right > mark.left && entry.top < mark.bottom && entry.bottom > mark.top);
    return { entry, mark, overlaps };
  })()`);
  assert.ok(geometry.entry && geometry.mark, `${label}: open and mark price facts exist`);
  assert.equal(geometry.overlaps, false, `${label}: open and mark labels must not overlap ${JSON.stringify(geometry)}`);
  return geometry;
}

async function assertMobilePositionLabels(cdp, label) {
  const geometry = await evaluate(cdp, `(() => {
    const measure = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
      return {
        text: node.textContent.trim(),
        width: rect.width,
        height: rect.height,
        lineHeight,
        lines: Math.round(rect.height / lineHeight),
        overflowWrap: style.overflowWrap,
        wordBreak: style.wordBreak,
        whiteSpace: style.whiteSpace
      };
    };
    return {
      symbol: measure('.kordynV2PositionTruth.is-mobile > header h2'),
      ownership: measure('.kordynV2PositionTruth.is-mobile .kordynV2PositionOwnership'),
      source: measure('.kordynV2PositionTruth.is-mobile > footer > span:nth-child(2) strong')
    };
  })()`);
  for (const [name, fact] of Object.entries(geometry)) {
    assert.ok(fact, `${label}: ${name} exists`);
    assert.ok(fact.lines <= 1, `${label}: ${name} stays on one readable line ${JSON.stringify(fact)}`);
    assert.notEqual(fact.wordBreak, "break-all", `${label}: ${name} does not break every character`);
    assert.notEqual(fact.overflowWrap, "anywhere", `${label}: ${name} does not wrap at arbitrary characters`);
  }
  assert.equal(geometry.symbol.text, "ETH/USDT", `${label}: selected symbol remains intact`);
  return geometry;
}

async function styleOwnership(cdp) {
  return await evaluate(cdp, `(() => {
    const owners = [];
    for (const sheet of document.styleSheets) {
      if (sheet.href) owners.push(sheet.href);
      const owner = sheet.ownerNode;
      if (owner?.getAttribute) {
        owners.push(owner.getAttribute("data-vite-dev-id") || "");
        owners.push(owner.getAttribute("href") || "");
      }
    }
    for (const node of document.querySelectorAll('style[data-vite-dev-id], link[rel="stylesheet"]')) {
      owners.push(node.getAttribute("data-vite-dev-id") || "");
      owners.push(node.getAttribute("href") || "");
    }
    const clean = owners.map((value) => String(value).split("?")[0].split("#")[0].replaceAll("\\\\", "/"));
    return {
      accountCss: clean.some((value) => value.endsWith("/src/kordynV2/domains/account/account.css")),
      legacyProductStyles: clean.some((value) => value.includes("productStyles") || ${JSON.stringify(legacyStyleFiles)}.some((file) => value === file || value.endsWith("/" + file))),
      owners: clean.filter(Boolean).sort()
    };
  })()`);
}

async function readActionLedger(cdp) {
  return await evaluate(cdp, `(() => {
    const calls = window.__task5AccountCalls || {};
    return {
      actionRequests: Array.isArray(calls.actionRequests) ? calls.actionRequests.slice() : [],
      actionResults: Array.isArray(calls.actionResults) ? calls.actionResults.slice() : [],
      authorityWrites: Number.isInteger(calls.authorityWrites) ? calls.authorityWrites : 0,
      downloads: Array.isArray(calls.downloads) ? calls.downloads.slice() : []
    };
  })()`);
}

function mergeLedgers(ledgers) {
  return ledgers.reduce((merged, entry) => {
    const ledger = entry.ledger || {};
    merged.actionRequests.push(...(Array.isArray(ledger.actionRequests) ? ledger.actionRequests.map((row) => ({ ...row, phase: entry.phase })) : []));
    merged.actionResults.push(...(Array.isArray(ledger.actionResults) ? ledger.actionResults.map((row) => ({ ...row, phase: entry.phase })) : []));
    merged.downloads.push(...(Array.isArray(ledger.downloads) ? ledger.downloads.map((row) => ({ ...row, phase: entry.phase })) : []));
    merged.authorityWrites += Number.isInteger(ledger.authorityWrites) ? ledger.authorityWrites : 0;
    return merged;
  }, { actionRequests: [], actionResults: [], authorityWrites: 0, downloads: [] });
}

async function capturePng(cdp, file, viewport, extra = {}) {
  await flush(cdp);
  await ensureActivePage(cdp);
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const bytes = Buffer.from(screenshot.data, "base64");
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.width, viewport.width, `${file}: width`);
  assert.equal(metadata.height, viewport.height, `${file}: height`);
  await writeFile(path.join(outputDir, file), bytes);
  const shell = await evaluate(cdp, `(() => {
    const node = document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]');
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      domainId: node.dataset.kordynV2Domain,
      workspaceId: node.dataset.kordynV2Workspace,
      selectedId: node.dataset.kordynV2SelectedId,
      selectedType: node.dataset.kordynV2SelectedType
    };
  })()`);
  const documentGeometry = await evaluate(cdp, `({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight
  })`);
  const calls = await evaluate(cdp, "window.__task5AccountCalls");
  const styles = await styleOwnership(cdp);
  return {
    file,
    viewport: viewportName(viewport),
    device: viewport.device,
    domainId: shell?.domainId || "unknown",
    workspaceId: shell?.workspaceId || "unknown",
    viewportGeometry: { width: viewport.width, height: viewport.height },
    document: documentGeometry,
    shell,
    noProductionWrites: calls.authorityWrites === 0,
    actionRequestsAtCapture: calls.actionRequests.length,
    legacyProductStyles: styles.legacyProductStyles,
    accountCss: styles.accountCss,
    sha256: sha256(bytes),
    ...extra
  };
}

async function assertEvidencePanel(cdp, viewport, id, type, panel, label) {
  const triggerSelector = `[data-kordyn-v2-${panel}-trigger]`;
  await click(cdp, triggerSelector);
  const identityText = `${type} / ${id}`;
  const isMobile = viewport.device === "mobile";
  const overlaySelector = isMobile
    ? '[data-kordyn-v2-mobile-sheet="evidence"]'
    : `[data-kordyn-v2-overlay="${panel}"]`;
  const identitySelector = isMobile
    ? `${overlaySelector} .kordynV2MobileSheetIdentity`
    : `${overlaySelector} .kordynV2OverlayIdentity`;
  const closeSelector = isMobile
    ? `${overlaySelector} [data-kordyn-v2-mobile-sheet-close]`
    : `${overlaySelector} [data-kordyn-v2-overlay-close]`;
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(identitySelector)})?.textContent.includes(${JSON.stringify(identityText)})`, `${label}: ${panel} identity`);
  if (isMobile) {
    await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${overlaySelector} [data-kordyn-v2-evidence-tab="${panel}"]`)})?.getAttribute("aria-selected") === "true"`, `${label}: mobile ${panel} tab`);
  }
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(closeSelector)}) === document.activeElement`, `${label}: ${panel} close focus`);
  const visible = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]');
    const identity = document.querySelector(${JSON.stringify(identitySelector)});
    return {
      viewport: ${JSON.stringify(viewportName(viewport))},
      root: { id: root?.dataset.kordynV2SelectedId, type: root?.dataset.kordynV2SelectedType },
      visibleIdentity: identity?.textContent?.trim() || "",
      tab: ${JSON.stringify(panel)}
    };
  })()`);
  assert.deepEqual(visible.root, { id, type }, `${label}: ${panel} Root identity remains canonical`);
  assert.ok(visible.visibleIdentity.includes(identityText), `${label}: ${panel} visible identity`);
  const closeMethod = panel === "context" ? "Escape" : "close-button";
  if (closeMethod === "Escape") await press(cdp, "Escape");
  else await click(cdp, closeSelector);
  await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(overlaySelector)})`, `${label}: ${panel} close`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(triggerSelector)}) === document.activeElement`, `${label}: ${panel} return focus`);
  return { ...visible, closeMethod, focusReturned: true };
}

async function assertSelection(cdp, viewport, id, type, label, { proof = false } = {}) {
  await waitForExpression(
    cdp,
    `(() => { const root = document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]'); return root?.dataset.kordynV2SelectedId === ${JSON.stringify(id)} && root?.dataset.kordynV2SelectedType === ${JSON.stringify(type)}; })()`,
    label
  );
  const current = await evaluate(cdp, `(() => { const root = document.querySelector('[data-kordyn-v2-shell="${viewport.device}"]'); return { id: root?.dataset.kordynV2SelectedId, type: root?.dataset.kordynV2SelectedType, workspace: root?.dataset.kordynV2Workspace }; })()`);
  assert.deepEqual({ id: current.id, type: current.type }, { id, type }, label);
  const evidence = proof
    ? {
        context: await assertEvidencePanel(cdp, viewport, id, type, "context", label),
        proof: await assertEvidencePanel(cdp, viewport, id, type, "proof", label)
      }
    : { context: null, proof: null };
  return {
    viewport: viewportName(viewport),
    device: viewport.device,
    id: current.id,
    type: current.type,
    workspace: current.workspace,
    root: current,
    ...evidence
  };
}

async function acceptConfirm(cdp, label) {
  await waitForExpression(cdp, "document.querySelector('.cfmCard')", `${label}: confirmation opens`);
  await waitForExpression(cdp, "document.querySelector('.cfmCard')?.contains(document.activeElement)", `${label}: confirmation owns focus`);
  await click(cdp, ".cfmCard .cfmFoot .cfmBtn:last-child");
  await waitForExpression(cdp, "!document.querySelector('.cfmCard')", `${label}: confirmation closes`);
}

async function exerciseInteractions(cdp, baseUrl) {
  const interactions = [];
  const adverseInteractions = [];
  await navigatePage(cdp, baseUrl, viewports.desktop1440, "ready");
  await navigateAccount(cdp, "market", viewports.desktop1440);
  await click(cdp, '[data-kordyn-v2-object-id="BTC/USDT"][data-kordyn-v2-object-type="Market"]');
  interactions.push({ label: "Market", ...(await assertSelection(cdp, viewports.desktop1440, "BTC/USDT", "Market", "desktop Market selection", { proof: true })) });

  await click(cdp, '[data-kordyn-v2-workspace-target="account"]');
  await click(cdp, '[data-kordyn-v2-object-id="ex-okx-main"][data-kordyn-v2-object-type="Account"]');
  interactions.push({ label: "Account", ...(await assertSelection(cdp, viewports.desktop1440, "ex-okx-main", "Account", "desktop Account selection", { proof: true })) });

  const writesBeforeReconcile = await evaluate(cdp, "window.__task5AccountCalls.authorityWrites");
  await click(cdp, '[data-kordyn-v2-reconcile-action]');
  await acceptConfirm(cdp, "reconcile");
  await waitForExpression(cdp, "window.__task5AccountCalls.actionResults.some((row) => row.endpoint === '/api/reconciler/run')", "reconcile authoritative result");
  assert.equal(await evaluate(cdp, "window.__task5AccountCalls.authorityWrites"), writesBeforeReconcile + 1);

  await click(cdp, '[data-kordyn-v2-workspace-target="positions"]');
  await click(cdp, '[data-kordyn-v2-object-id="position-eth"][data-kordyn-v2-object-type="Position"]');
  interactions.push({ label: "Position", ...(await assertSelection(cdp, viewports.desktop1440, "position-eth", "Position", "desktop Position selection", { proof: true })) });
  const writesBeforeExit = await evaluate(cdp, "window.__task5AccountCalls.authorityWrites");
  await click(cdp, '[data-kordyn-v2-position-exit="close_position"]');
  await acceptConfirm(cdp, "execution exit");
  await waitForExpression(cdp, "window.__task5AccountCalls.actionResults.some((row) => row.endpoint === '/api/execution-orders/execution-eth/close') && window.__task5AccountCalls.actionResults.some((row) => row.endpoint === '/api/execution-orders/poll')", "execution exit 409 poll");
  assert.equal(await evaluate(cdp, "window.__task5AccountCalls.authorityWrites"), writesBeforeExit + 2);

  await click(cdp, '[data-kordyn-v2-workspace-target="plans"]');
  await click(cdp, '[data-kordyn-v2-object-id="plan-btc-task5"][data-kordyn-v2-object-type="Trade plan"]');
  interactions.push({ label: "Trade plan", ...(await assertSelection(cdp, viewports.desktop1440, "plan-btc-task5", "Trade plan", "desktop Trade plan selection", { proof: true })) });
  const writesBeforePlan = await evaluate(cdp, "window.__task5AccountCalls.authorityWrites");
  await click(cdp, ".kordynV2ExecutionInspector footer button:last-child");
  await waitForExpression(cdp, "document.querySelector('[role=\"status\"][data-action-state=\"processing\"]') && !document.body.textContent.includes('执行成功')", "plan decision processing before terminal");
  await acceptConfirm(cdp, "plan approval");
  await waitForExpression(cdp, `window.__task5AccountCalls.authorityWrites === ${writesBeforePlan + 1} && window.__task5AccountCalls.actionRequests.some((row) => row.endpoint === '/api/trade-plans/plan-btc-task5/approve')`, "plan decision authoritative write");
  await waitForExpression(cdp, "document.querySelector('[role=\"status\"][data-action-state=\"partial\"]')", "plan decision partial authoritative result");

  await click(cdp, '[data-kordyn-v2-object-id="plan-orphan-task5"][data-kordyn-v2-object-type="Trade plan"]');
  const beforeRejected = await assertSelection(cdp, viewports.desktop1440, "plan-orphan-task5", "Trade plan", "desktop orphan plan selection");
  await click(cdp, '[data-kordyn-v2-object-id="execution-missing"][data-kordyn-v2-object-type="Execution"]');
  await new Promise((resolve) => setTimeout(resolve, 120));
  const desktopRejectedAfter = await evaluate(cdp, `(() => { const root = document.querySelector('[data-kordyn-v2-shell="desktop"]'); return { id: root?.dataset.kordynV2SelectedId, type: root?.dataset.kordynV2SelectedType, workspace: root?.dataset.kordynV2Workspace }; })()`);
  assert.deepEqual(desktopRejectedAfter, beforeRejected.root);
  adverseInteractions.push({ label: "Desktop missing Execution", viewport: viewportName(viewports.desktop1440), device: "desktop", candidate: { id: "execution-missing", type: "Execution" }, before: beforeRejected.root, after: desktopRejectedAfter, failClosed: true });

  const desktop1440Ledger = await readActionLedger(cdp);

  await navigatePage(cdp, baseUrl, viewports.desktop1180, "ready");
  await navigateAccount(cdp, "plans", viewports.desktop1180);

  await click(cdp, '[data-kordyn-v2-object-id="plan-btc-task5"][data-kordyn-v2-object-type="Trade plan"]');
  await click(cdp, '[data-kordyn-v2-object-id="execution-btc"][data-kordyn-v2-object-type="Execution"]');
  interactions.push({ label: "Execution", ...(await assertSelection(cdp, viewports.desktop1180, "execution-btc", "Execution", "desktop 1180 Execution related selection", { proof: true })) });

  await click(cdp, '[data-kordyn-v2-object-id="order-btc-task5"][data-kordyn-v2-object-type="Order"]');
  interactions.push({ label: "Order", ...(await assertSelection(cdp, viewports.desktop1180, "order-btc-task5", "Order", "desktop 1180 Order selection", { proof: true })) });

  await click(cdp, '[data-kordyn-v2-workspace-target="fills"]');
  await click(cdp, '[data-kordyn-v2-object-id="fill-btc-task5"][data-kordyn-v2-object-type="Fill"]');
  interactions.push({ label: "Fill", ...(await assertSelection(cdp, viewports.desktop1180, "fill-btc-task5", "Fill", "desktop 1180 Fill selection", { proof: true })) });
  await click(cdp, '[data-kordyn-v2-object-id="closed:execution-btc"][data-kordyn-v2-object-type="Closed trade"]');
  interactions.push({ label: "Closed trade", ...(await assertSelection(cdp, viewports.desktop1180, "closed:execution-btc", "Closed trade", "desktop 1180 Closed trade selection", { proof: true })) });
  const downloadsBefore = await evaluate(cdp, "window.__task5AccountCalls.downloads.length");
  await click(cdp, ".kordynV2ExecutionPrimaryAction");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-closed-trade-output-scrim]')", "closed trade output sheet");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-closed-output-close]') === document.activeElement", "closed trade output focus");
  await click(cdp, ".kordynV2ClosedTradeOutputSheet footer button");
  await waitForExpression(cdp, "document.querySelector('[data-output-state=\"returned\"]')", "closed trade poster returned");
  assert.equal(await evaluate(cdp, "window.__task5AccountCalls.downloads.length"), downloadsBefore + 1);
  await press(cdp, "Escape");
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-closed-trade-output-scrim]')", "closed trade output Escape close");

  await click(cdp, '[data-kordyn-v2-object-id="review-btc-task5"][data-kordyn-v2-object-type="Review"]');
  interactions.push({ label: "Review", ...(await assertSelection(cdp, viewports.desktop1180, "review-btc-task5", "Review", "desktop 1180 Review selection", { proof: true })) });
  const desktop1180Ledger = await readActionLedger(cdp);

  await navigatePage(cdp, baseUrl, viewports.mobile390, "ready");
  await navigateAccount(cdp, "positions", viewports.mobile390);
  await assertNoOverflow(cdp, viewports.mobile390, "mobile positions ready");
  await assertTouchTargets(cdp, "mobile positions ready");
  await click(cdp, '[data-kordyn-v2-object-id="position-eth"][data-kordyn-v2-object-type="Position"]');
  interactions.push({ label: "Mobile Position", ...(await assertSelection(cdp, viewports.mobile390, "position-eth", "Position", "mobile 390 Position selection", { proof: true })) });
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-position-mobile-view=\"detail\"] h2')", "mobile 390 position detail remains visible after evidence review");
  await click(cdp, '[data-kordyn-v2-position-back]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-object-id=\"position-eth\"][data-kordyn-v2-object-type=\"Position\"]') === document.activeElement", "mobile 390 position back focus");
  const mobile390Ledger = await readActionLedger(cdp);

  await navigatePage(cdp, baseUrl, viewports.mobile430, "ready");
  await navigateAccount(cdp, "plans", viewports.mobile430);
  await assertNoOverflow(cdp, viewports.mobile430, "mobile 430 plans ready");
  await assertTouchTargets(cdp, "mobile 430 plans ready");
  await click(cdp, '[data-kordyn-v2-object-id="plan-btc-task5"][data-kordyn-v2-object-type="Trade plan"]');
  interactions.push({ label: "Mobile Trade plan", ...(await assertSelection(cdp, viewports.mobile430, "plan-btc-task5", "Trade plan", "mobile 430 Trade plan selection", { proof: true })) });
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-execution-mobile-view=\"detail\"] h2')", "mobile execution detail remains visible after evidence review");
  await click(cdp, '[data-kordyn-v2-execution-back="plans"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-object-id=\"plan-btc-task5\"][data-kordyn-v2-object-type=\"Trade plan\"]') === document.activeElement", "mobile execution back focus");
  await click(cdp, '[data-kordyn-v2-object-id="plan-orphan-task5"][data-kordyn-v2-object-type="Trade plan"]');
  const mobileBeforeRejected = await assertSelection(cdp, viewports.mobile430, "plan-orphan-task5", "Trade plan", "mobile 430 orphan plan selection");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-execution-mobile-view=\"detail\"]')", "mobile 430 orphan plan detail");
  await click(cdp, '[data-kordyn-v2-object-id="execution-missing"][data-kordyn-v2-object-type="Execution"]');
  await new Promise((resolve) => setTimeout(resolve, 120));
  const mobileRejectedAfter = await evaluate(cdp, `(() => { const root = document.querySelector('[data-kordyn-v2-shell="mobile"]'); return { id: root?.dataset.kordynV2SelectedId, type: root?.dataset.kordynV2SelectedType, workspace: root?.dataset.kordynV2Workspace }; })()`);
  assert.deepEqual(mobileRejectedAfter, mobileBeforeRejected.root);
  adverseInteractions.push({ label: "Mobile missing Execution", viewport: viewportName(viewports.mobile430), device: "mobile", candidate: { id: "execution-missing", type: "Execution" }, before: mobileBeforeRejected.root, after: mobileRejectedAfter, failClosed: true });
  const mobile430Ledger = await readActionLedger(cdp);
  const ledgers = [
    { phase: "desktop-1440", ledger: desktop1440Ledger },
    { phase: "desktop-1180", ledger: desktop1180Ledger },
    { phase: "mobile-390", ledger: mobile390Ledger },
    { phase: "mobile-430", ledger: mobile430Ledger }
  ];
  return { interactions, adverseInteractions, ledgers, actionLedger: mergeLedgers(ledgers) };
}

async function captureProductionSurfaces(cdp, baseUrl) {
  const captures = [];
  await navigatePage(cdp, baseUrl, viewports.desktop1440, "ready");
  await navigateAccount(cdp, "positions", viewports.desktop1440);
  await click(cdp, '[data-kordyn-v2-object-id="position-eth"][data-kordyn-v2-object-type="Position"]');
  await assertSelection(cdp, viewports.desktop1440, "position-eth", "Position", "desktop 1440 position capture");
  await assertNoOverflow(cdp, viewports.desktop1440, "desktop 1440 position capture");
  const desktop1440PriceBoundary = await assertPriceBoundaryGeometry(cdp, "desktop 1440 position capture");
  captures.push(await capturePng(cdp, "desktop-account-position--1440x900.png", viewports.desktop1440, { priceBoundaryGeometry: desktop1440PriceBoundary }));

  await navigatePage(cdp, baseUrl, viewports.desktop1180, "ready");
  await navigateAccount(cdp, "positions", viewports.desktop1180);
  await click(cdp, '[data-kordyn-v2-object-id="position-eth"][data-kordyn-v2-object-type="Position"]');
  await assertSelection(cdp, viewports.desktop1180, "position-eth", "Position", "desktop 1180 position capture");
  await assertNoOverflow(cdp, viewports.desktop1180, "desktop 1180 position capture");
  const desktop1180PriceBoundary = await assertPriceBoundaryGeometry(cdp, "desktop 1180 position capture");
  captures.push(await capturePng(cdp, "desktop-account-position--1180x800.png", viewports.desktop1180, { priceBoundaryGeometry: desktop1180PriceBoundary }));

  await navigatePage(cdp, baseUrl, viewports.mobile390, "ready");
  await navigateAccount(cdp, "positions", viewports.mobile390);
  await click(cdp, '[data-kordyn-v2-object-id="position-eth"][data-kordyn-v2-object-type="Position"]');
  await assertSelection(cdp, viewports.mobile390, "position-eth", "Position", "mobile 390 position capture");
  await waitForExpression(cdp, "document.querySelector('.kordynV2PositionTruth.is-mobile > header h2')?.textContent.trim() === 'ETH/USDT'", "mobile 390 position detail");
  await assertTouchTargets(cdp, "mobile 390 position capture");
  await assertNoOverflow(cdp, viewports.mobile390, "mobile 390 position capture");
  const mobile390LabelGeometry = await assertMobilePositionLabels(cdp, "mobile 390 position capture");
  captures.push(await capturePng(cdp, "mobile-account-position--390x844.png", viewports.mobile390, { structuralOnly: true, labelGeometry: mobile390LabelGeometry }));

  await navigatePage(cdp, baseUrl, viewports.mobile430, "ready");
  await navigateAccount(cdp, "account", viewports.mobile430);
  await click(cdp, '[data-kordyn-v2-object-id="ex-okx-main"][data-kordyn-v2-object-type="Account"]');
  await assertSelection(cdp, viewports.mobile430, "ex-okx-main", "Account", "mobile 430 account capture");
  await assertTouchTargets(cdp, "mobile 430 account capture");
  await assertNoOverflow(cdp, viewports.mobile430, "mobile 430 account capture");
  captures.push(await capturePng(cdp, "mobile-account-detail--430x932.png", viewports.mobile430, { structuralOnly: true }));
  return captures;
}

async function captureStateScenarios(cdp, baseUrl) {
  const states = [];
  for (const item of stateScenarios) {
    const scenario = ["processing", "partial"].includes(item.kind) ? "ready" : item.kind;
    await navigatePage(cdp, baseUrl, item.viewport, scenario);
    await navigateAccount(cdp, item.workspaceId, item.viewport, scenario);
    if (item.kind === "processing") {
      await click(cdp, '[data-kordyn-v2-object-id="plan-btc-task5"][data-kordyn-v2-object-type="Trade plan"]');
      await assertSelection(cdp, item.viewport, "plan-btc-task5", "Trade plan", "processing plan selection");
      await click(cdp, ".kordynV2ExecutionInspector footer button:last-child");
      await waitForExpression(cdp, "document.querySelector('[role=\"status\"][data-action-state=\"processing\"]')", "processing action state visible");
      await waitForExpression(cdp, "document.querySelector('.cfmCard')", "processing confirmation boundary open");
      const processingEvidence = await evaluate(cdp, `(() => {
        const status = document.querySelector('[role="status"][data-action-state="processing"]');
        const calls = window.__task5AccountCalls || {};
        return {
          actionState: status?.dataset.actionState || "",
          statusText: status?.textContent?.trim() || "",
          confirmationOpen: Boolean(document.querySelector(".cfmCard")),
          terminalSuccessAbsent: !document.body.textContent.includes("执行成功") && !document.body.textContent.includes("交易成功"),
          authorityWrites: calls.authorityWrites || 0,
          approveRequests: (calls.actionRequests || []).filter((row) => row.endpoint === "/api/trade-plans/plan-btc-task5/approve").length
        };
      })()`);
      assert.deepEqual(
        {
          actionState: processingEvidence.actionState,
          confirmationOpen: processingEvidence.confirmationOpen,
          terminalSuccessAbsent: processingEvidence.terminalSuccessAbsent,
          authorityWrites: processingEvidence.authorityWrites,
          approveRequests: processingEvidence.approveRequests
        },
        {
          actionState: "processing",
          confirmationOpen: true,
          terminalSuccessAbsent: true,
          authorityWrites: 0,
          approveRequests: 0
        },
        "processing visual evidence stays pre-authoritative"
      );
      const geometry = await assertNoOverflow(cdp, item.viewport, "state processing");
      const file = `state-${item.kind}--${viewportName(item.viewport)}.png`;
      states.push({
        ...(await capturePng(cdp, file, item.viewport, { state: item.kind, processingEvidence })),
        geometry
      });
      await press(cdp, "Escape");
      await waitForExpression(cdp, "!document.querySelector('.cfmCard')", "processing confirmation closes");
      continue;
    }
    if (item.kind === "partial") {
      await click(cdp, '[data-kordyn-v2-object-id="plan-btc-task5"][data-kordyn-v2-object-type="Trade plan"]');
      await assertSelection(cdp, item.viewport, "plan-btc-task5", "Trade plan", "partial plan selection");
      await click(cdp, ".kordynV2ExecutionInspector footer button:last-child");
      await waitForExpression(cdp, "document.querySelector('[role=\"status\"][data-action-state=\"processing\"]')", "partial action processing before confirm");
      await acceptConfirm(cdp, "partial approval");
      await waitForExpression(cdp, "document.querySelector('[role=\"status\"][data-action-state=\"partial\"]')", "partial action outcome");
      const partialEvidence = await evaluate(cdp, `(() => {
        const status = document.querySelector('[role="status"][data-action-state="partial"]');
        const calls = window.__task5AccountCalls || {};
        const request = (calls.actionRequests || []).find((row) => row.endpoint === "/api/trade-plans/plan-btc-task5/approve") || null;
        const result = (calls.actionResults || []).find((row) => row.endpoint === "/api/trade-plans/plan-btc-task5/approve")?.result || {};
        return {
          actionState: status?.dataset.actionState || "",
          statusText: status?.textContent?.trim() || "",
          request,
          result,
          completedEffects: result?.plan?.status === "approved" && result.approvalGranted === true ? ["approval consumed"] : [],
          failedEffects: result?.executionSubmitted === false ? [result?.execution?.reason || result.error || "execution not submitted"] : [],
          executionSubmitted: result?.executionSubmitted,
          authorityWrites: calls.authorityWrites || 0,
          approveRequests: (calls.actionRequests || []).filter((row) => row.endpoint === "/api/trade-plans/plan-btc-task5/approve").length
        };
      })()`);
      assert.deepEqual(
        {
          actionState: partialEvidence.actionState,
          completedEffects: partialEvidence.completedEffects.length,
          failedEffects: partialEvidence.failedEffects.length,
          executionSubmitted: partialEvidence.executionSubmitted,
          approveRequests: partialEvidence.approveRequests
        },
        {
          actionState: "partial",
          completedEffects: 1,
          failedEffects: 1,
          executionSubmitted: false,
          approveRequests: 1
        },
        "partial visual evidence separates consumed approval from failed execution"
      );
      const geometry = await assertNoOverflow(cdp, item.viewport, "state partial");
      const file = `state-${item.kind}--${viewportName(item.viewport)}.png`;
      states.push({
        ...(await capturePng(cdp, file, item.viewport, {
          state: item.kind,
          partialEvidence,
          fixtureAuthorityWrite: true,
          noProductionWrites: true
        })),
        geometry
      });
      continue;
    }
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-state="${item.kind}"]')`, `${item.kind} state marker`);
    const geometry = await assertNoOverflow(cdp, item.viewport, `state ${item.kind}`);
    if (item.viewport.device === "mobile") await assertTouchTargets(cdp, `state ${item.kind}`);
    if (item.retainsFacts) {
      await waitForExpression(cdp, "document.querySelector('.kordynV2RetainedNotice')?.textContent.includes('Task 5 account bounded production-shaped authority')", `${item.kind} retained source`);
      assert.equal(await evaluate(cdp, "Boolean(document.querySelector('[data-kordyn-v2-work-canvas] button:not([disabled])'))"), true, `${item.kind}: read-only inspection remains available`);
      assert.equal(await evaluate(cdp, "Boolean(document.querySelector('[data-kordyn-v2-position-exit]:not([disabled]), [data-kordyn-v2-reconcile-action]:not([disabled])'))"), false, `${item.kind}: protected mutation disabled`);
    }
    if (item.kind === "large-list") {
      assert.ok(await evaluate(cdp, "document.body.textContent.includes('ASSET64/USDT')"), "large-list keeps final authoritative item");
    }
    if (item.kind === "long-content") {
      await click(cdp, '[data-kordyn-v2-object-id="closed:execution-btc"][data-kordyn-v2-object-type="Closed trade"]');
      await assertSelection(cdp, item.viewport, "closed:execution-btc", "Closed trade", "long-content closed trade detail");
      if (item.viewport.device === "mobile") {
        await waitForExpression(cdp, 'document.querySelector(\'[data-kordyn-v2-execution-mobile-view="detail"]\')', "long-content mobile detail view");
      }
      const longContent = await evaluate(cdp, `(() => {
        const body = document.body.textContent;
        const shell = document.querySelector('[data-kordyn-v2-shell="${item.viewport.device}"]');
        return {
          selectedId: shell?.dataset.kordynV2SelectedId,
          selectedType: shell?.dataset.kordynV2SelectedType,
          includesFirst: body.includes("完整财务证据链 #1"),
          includesLast: body.includes("完整财务证据链 #72"),
          text: body.slice(Math.max(0, body.indexOf("完整财务证据链") - 120), body.indexOf("完整财务证据链") + 900)
        };
      })()`);
      assert.ok(longContent.includesLast, `long-content keeps full bounded authoritative body ${JSON.stringify(longContent)}`);
    }
    const file = `state-${item.kind}--${viewportName(item.viewport)}.png`;
    states.push({
      ...(await capturePng(cdp, file, item.viewport, { state: item.kind, retainsFacts: item.retainsFacts === true })),
      geometry
    });
  }
  return states;
}

async function stop(process) {
  if (!process || process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => process.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2_000))]);
}

await prepareOutputDir();

const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-account-chrome-"));
const vite = spawn(process.execPath, [path.join(rootDir, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: rootDir, stdio: "ignore" });
let chrome;
let cdp;
try {
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  await waitFor(baseUrl);
  chrome = spawn(chromeBinary, ["--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu", "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profileDir}`, `${baseUrl}${pagePath}?scenario=ready&run=start`], { stdio: "ignore" });
  await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  const targets = await fetch(`http://127.0.0.1:${chromePort}/json`).then((item) => item.json());
  const target = targets.find((row) => row.type === "page" && row.url.startsWith(baseUrl)) || targets.find((row) => row.type === "page");
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);

  const captures = await captureProductionSurfaces(cdp, baseUrl);
  const states = await captureStateScenarios(cdp, baseUrl);
  const interactionEvidence = await exerciseInteractions(cdp, baseUrl);
  const calls = interactionEvidence.actionLedger;
  const styles = await styleOwnership(cdp);
  assert.equal(styles.legacyProductStyles, false, "Account V2 must not load legacy authenticated styles");
  assert.equal(styles.accountCss, true, "Account lazy CSS must be loaded after Account navigation");
  assert.equal(calls.downloads.length, 1, "closed-trade output uses exactly one server download in the interaction gate");
  assert.ok(calls.actionRequests.some((row) => row.endpoint === "/api/reconciler/run"), "reconcile action exercised");
  assert.ok(calls.actionRequests.some((row) => row.endpoint === "/api/execution-orders/execution-eth/close"), "execution exit exercised");
  assert.ok(calls.actionResults.some((row) => row.endpoint === "/api/execution-orders/poll"), "409 exit refresh poll exercised");
  assert.ok(calls.actionRequests.some((row) => row.endpoint === "/api/trade-plans/plan-btc-task5/approve"), "plan approval exercised");

  const captureEvidence = {
    schemaVersion: 1,
    runner,
    fixture,
    productSourceCommit,
    captureTestSourceCommit,
    captures,
    interactions: interactionEvidence.interactions,
    adverseInteractions: interactionEvidence.adverseInteractions,
    actionLedgers: interactionEvidence.ledgers,
    actionLedger: calls,
    styleOwnership: styles
  };
  const stateEvidence = {
    schemaVersion: 1,
    runner,
    fixture,
    productSourceCommit,
    captureTestSourceCommit,
    states
  };
  await writeFile(path.join(outputDir, "capture-evidence.json"), `${JSON.stringify(captureEvidence, null, 2)}\n`);
  await writeFile(path.join(outputDir, "state-evidence.json"), `${JSON.stringify(stateEvidence, null, 2)}\n`);
  const summary = {
    productSourceCommit,
    captureTestSourceCommit,
    captures: captures.length,
    states: states.length,
    interactions: interactionEvidence.interactions.length,
    writes: calls.authorityWrites,
    downloads: calls.downloads.length,
    accountCss: styles.accountCss,
    legacyProductStyles: styles.legacyProductStyles,
    outputDir: path.relative(rootDir, outputDir)
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  cdp?.close();
  await Promise.allSettled([stop(chrome), stop(vite)]);
  await rm(profileDir, { recursive: true, force: true });
}
