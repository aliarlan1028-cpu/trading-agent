import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import WebSocket from "ws";
import { evaluateKordynV2VisualContract } from "./helpers/kordyn-v2-visual-contract.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const screenshotDir = process.env.KORDYN_V2_SCREENSHOT_DIR
  ? path.resolve(rootDir, process.env.KORDYN_V2_SCREENSHOT_DIR)
  : null;
const requestedMobileOnly = process.argv.includes("--mobile-only");
const requestedDesktopOnly = process.argv.includes("--desktop-only");
const runMobileAfterDesktop = !requestedMobileOnly && !requestedDesktopOnly;
const mobileOnly = requestedMobileOnly;
const desktopOnly = requestedDesktopOnly || runMobileAfterDesktop;
const desktopViewports = [[1440, 900], [1180, 800]];
const mobileViewports = [[390, 844], [430, 932]];
const domains = [
  ["ai", "missions"],
  ["account", "market"],
  ["assets", "relationships"],
  ["governance", "overview"]
];
const destinationCases = [
  { domain: "ai", workspace: "missions", title: "AI 交易员", kind: "mission" },
  { domain: "ai", workspace: "intelligence", title: "情报", kind: "boundary" },
  { domain: "ai", workspace: "watch", title: "观察哨", kind: "boundary" },
  { domain: "ai", workspace: "events", title: "事件日历", kind: "boundary" },
  { domain: "ai", workspace: "dialog", title: "对话", kind: "dialog" },
  { domain: "account", workspace: "market", title: "市场", kind: "boundary" },
  { domain: "assets", workspace: "relationships", title: "关系总览", kind: "boundary" },
  { domain: "governance", workspace: "overview", title: "运行总览", kind: "boundary" }
];
const contractFailures = [];
const legacyStyleProbeSource = `(() => {
  const legacyFiles = ${JSON.stringify([
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
let captureEvidenceRows = [];

function screenshotSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function initializeCaptureEvidence() {
  if (!screenshotDir || !mobileOnly) return;
  try {
    const existing = JSON.parse(await readFile(path.join(screenshotDir, "capture-evidence.json"), "utf8"));
    if (existing?.schemaVersion === 1
      && existing.runner === "tests/run-kordyn-v2-shell-browser.mjs"
      && existing.fixture === "tests/kordyn-v2-production-fixture.js"
      && Array.isArray(existing.captures)) {
      captureEvidenceRows = existing.captures.filter((capture) => capture?.device !== "mobile");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function recordCaptureEvidence({ file, viewport, device, width, height, sha256, geometry }) {
  if (!screenshotDir) return;
  const [clientWidth, scrollWidth] = geometry.document;
  captureEvidenceRows = captureEvidenceRows.filter((capture) => capture.file !== file);
  captureEvidenceRows.push({
    file,
    viewport,
    device,
    domainId: geometry.domain,
    workspaceId: geometry.workspace,
    sha256,
    viewportGeometry: { width, height },
    document: { clientWidth, scrollWidth },
    shell: {
      left: geometry.root.left,
      top: geometry.root.top,
      width: geometry.root.width,
      height: geometry.root.height
    },
    noProductionWrites: geometry.actions === 0,
    legacyProductStyles: geometry.legacyStyles === true
  });
}

async function writeCaptureEvidence() {
  if (!screenshotDir) return;
  await mkdir(screenshotDir, { recursive: true });
  const evidence = {
    schemaVersion: 1,
    runner: "tests/run-kordyn-v2-shell-browser.mjs",
    fixture: "tests/kordyn-v2-production-fixture.js",
    captures: captureEvidenceRows.slice().sort((left, right) => left.file.localeCompare(right.file))
  };
  await writeFile(path.join(screenshotDir, "capture-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
}

function contractEqual(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return;
  contractFailures.push(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
}

function contractTrue(label, value, evidence) {
  if (value) return;
  contractFailures.push(`${label}: ${evidence}`);
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
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let requestId = 0;
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
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  }
  return result.result.value;
}

async function waitForExpression(cdp, expression, label) {
  const deadline = Date.now() + 20_000;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) throw new Error(${JSON.stringify(`Missing click target: ${selector}`)});
    const rect = target.getBoundingClientRect();
    return { x:rect.left + rect.width / 2, y:rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function pressKey(cdp, key, { shift = false } = {}) {
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
    modifiers,
    text: textValue,
    unmodifiedText: textValue
  });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: eventKey, code: eventCode, windowsVirtualKeyCode: virtualKey, modifiers });
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function setViewport(cdp, url, width, height, shell = "desktop") {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height
  });
  await cdp.send("Page.navigate", { url });
  await waitForExpression(
    cdp,
    `window.__kordynV2ShellReady && document.querySelector('[data-kordyn-v2-shell=${shell}]')`,
    `${width}x${height} V2 ${shell} shell`
  );
}

async function resizeViewport(cdp, width, height, shell) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height
  });
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell=${shell}]')`, `${width}x${height} live ${shell} transition`);
}

async function captureMobile(cdp, width, height, filename) {
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  const bytes = Buffer.from(result.data, "base64");
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [width, height], `${width}: mobile screenshot dimensions`);
  let outputPath = null;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    outputPath = path.join(screenshotDir, filename);
    await writeFile(outputPath, bytes);
  }
  return { outputPath, width: metadata.width, height: metadata.height, sha256: screenshotSha256(bytes) };
}

async function capture(cdp, width, height, filename = `desktop-${width}x${height}.png`) {
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  const bytes = Buffer.from(result.data, "base64");
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [width, height], `${width}: screenshot dimensions`);
  const fidelity = await evaluateKordynV2VisualContract(bytes, width, height);
  let outputPath = null;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    outputPath = path.join(screenshotDir, filename);
    await writeFile(outputPath, bytes);
  }
  return { outputPath, sha256: screenshotSha256(bytes), ...fidelity };
}

async function readGeometry(cdp) {
  return await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="desktop"]');
    const primary = root.querySelector('[data-kordyn-v2-primary-nav]');
    const local = root.querySelector('[data-kordyn-v2-workspace-nav]');
    const truth = root.querySelector('[data-kordyn-v2-account-truth-mode]');
    const canvas = root.querySelector('[data-kordyn-v2-work-canvas]');
    const mission = root.querySelector('.kordynV2MissionGrid');
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      return {
        left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom,
        width:rect.width, height:rect.height,
        clientWidth:node.clientWidth, scrollWidth:node.scrollWidth,
        clientHeight:node.clientHeight, scrollHeight:node.scrollHeight
      };
    };
    const maybeBox = (selector) => {
      const node = root.querySelector(selector);
      return node ? box(node) : null;
    };
    const localButtons = [...local.querySelectorAll('[data-kordyn-v2-workspace-target]')].map(box);
    return {
      viewport:[innerWidth,innerHeight],
      document:[document.documentElement.clientWidth,document.documentElement.scrollWidth],
      root:box(root), primary:box(primary), local:box(local), truth:box(truth), canvas:box(canvas), mission:box(mission),
      localButtons,
      activeDomains:root.querySelectorAll('[data-kordyn-v2-domain-target][aria-current="page"]').length,
      activeWorkspaces:root.querySelectorAll('[data-kordyn-v2-workspace-target][aria-current="page"]').length,
      domain:root.dataset.kordynV2Domain,
      workspace:root.dataset.kordynV2Workspace,
      selectedId:root.dataset.kordynV2SelectedId,
      actions:window.__kordynV2BrowserCalls.actions,
      legacyStyles:${legacyStyleProbeSource},
      landmarks:{
        identity:maybeBox('[data-kordyn-v2-identity]'),
        notification:maybeBox('[data-kordyn-v2-notification]'),
        workbenchFooter:maybeBox('[data-kordyn-v2-workbench-footer]'),
        audit:maybeBox('[data-kordyn-v2-audit-control]'),
        poster:maybeBox('[data-kordyn-v2-poster-control]'),
        assistant:maybeBox('[data-kordyn-v2-ai-support-trigger]'),
        prompt:maybeBox('.kordynV2MissionPrompt'),
        evidenceDock:maybeBox('.kordynV2EvidenceDock'),
        runtime:maybeBox('.kordynV2WorkspaceHeading > em'),
        missionFocus:maybeBox('[data-kordyn-v2-mission-focus]'),
        decisionSummary:maybeBox('.kordynV2DecisionSummary'),
        lastDecisionFact:maybeBox('.kordynV2DecisionFact:last-child')
      }
    };
  })()`);
}

function ranges(value, minimum, maximum) {
  return typeof value === "number" && value >= minimum && value <= maximum;
}

function rectanglesOverlap(first, second) {
  if (!first || !second) return true;
  return first.left < second.right
    && first.right > second.left
    && first.top < second.bottom
    && first.bottom > second.top;
}

async function verifyFidelityLandmarks(cdp, geometry, width, height) {
  const { landmarks } = geometry;
  for (const name of ["identity", "notification", "workbenchFooter", "audit", "poster", "assistant"]) {
    contractTrue(`${width}: ${name} comp landmark exists`, Boolean(landmarks[name]), `received ${JSON.stringify(landmarks[name])}`);
  }

  const semantics = await evaluate(cdp, `(() => {
    const read = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      const opacity = Number.parseFloat(style.opacity);
      return {
        tag:node.tagName,
        disabled:node.matches(':disabled'),
        ariaDisabled:node.getAttribute('aria-disabled'),
        hasPopup:node.getAttribute('aria-haspopup'),
        text:node.textContent.trim(),
        name:node.getAttribute('aria-label') || '',
        paint:{
          display:style.display,
          visibility:style.visibility,
          opacity,
          width:rect.width,
          height:rect.height,
          painted:style.display !== 'none' && style.visibility === 'visible' && opacity >= 0.5 && rect.width >= 24 && rect.height >= 24
        }
      };
    };
    return {
      identity:read('[data-kordyn-v2-identity]'),
      notification:read('[data-kordyn-v2-notification]'),
      audit:read('[data-kordyn-v2-audit-control]'),
      poster:read('[data-kordyn-v2-poster-control]'),
      assistant:read('[data-kordyn-v2-ai-support-trigger]'),
      workbenchFooter:read('[data-kordyn-v2-workbench-footer]'),
      prompt:read('.kordynV2MissionPrompt')
    };
  })()`);

  for (const name of ["identity", "workbenchFooter", "prompt", "assistant"]) {
    contractTrue(
      `${width}: ${name} landmark is computed and visibly painted`,
      semantics[name]?.paint?.painted === true,
      `received ${JSON.stringify(semantics[name]?.paint)}`
    );
  }

  contractTrue(
    `${width}: authenticated identity uses fixture truth`,
    semantics.identity?.text.includes("K0"),
    `received ${JSON.stringify(semantics.identity)}`
  );
  contractTrue(
    `${width}: absent notification facts stay unavailable`,
    semantics.notification?.text.includes("Unavailable") && semantics.notification.disabled,
    `received ${JSON.stringify(semantics.notification)}`
  );
  contractTrue(
    `${width}: audit chain is a real Proof control`,
    semantics.audit?.tag === "BUTTON" && !semantics.audit.disabled && semantics.audit.hasPopup === "dialog",
    `received ${JSON.stringify(semantics.audit)}`
  );
  contractTrue(
    `${width}: poster capability is truthfully disabled`,
    semantics.poster?.tag === "BUTTON" && semantics.poster.disabled && /Unavailable/i.test(`${semantics.poster.text} ${semantics.poster.name}`),
    `received ${JSON.stringify(semantics.poster)}`
  );
  contractTrue(
    `${width}: read-only assistant is an available dialog control`,
    semantics.assistant?.tag === "BUTTON" && !semantics.assistant.disabled && semantics.assistant.hasPopup === "dialog" && /AI 客服|只读助理/i.test(`${semantics.assistant.text} ${semantics.assistant.name}`),
    `received ${JSON.stringify(semantics.assistant)}`
  );

  if (semantics.audit) {
    await click(cdp, '[data-kordyn-v2-audit-control]');
    const auditOpened = await evaluate(cdp, `(() => ({
      proof:Boolean(document.querySelector('[data-kordyn-v2-overlay="proof"]')),
      focused:Boolean(document.querySelector('[data-kordyn-v2-overlay="proof"]')?.contains(document.activeElement)),
      actions:window.__kordynV2BrowserCalls.actions
    }))()`);
    contractEqual(`${width}: audit chain opens read-only Proof without a write`, auditOpened, {
      proof: true,
      focused: true,
      actions: 0
    });
    if (auditOpened.proof) {
      await pressKey(cdp, "Escape");
      contractEqual(
        `${width}: audit Proof returns focus to footer control`,
        await evaluate(cdp, "document.activeElement === document.querySelector('[data-kordyn-v2-audit-control]')"),
        true
      );
      await evaluate(cdp, "document.activeElement?.blur() || true");
    }
  }

  const expected = width === 1440
    ? { promptLeft:[238, 285], promptRight:[1090, 1170], assistantLeft:[1170, 1210], assistantWidth:[210, 250] }
    : { promptLeft:[195, 230], promptRight:[915, 945], assistantLeft:[955, 985], assistantWidth:[175, 205] };
  contractTrue(
    `${width}: identity occupies the top-right truth rail`,
    landmarks.identity && ranges(landmarks.identity.top, 0, 2) && ranges(width - landmarks.identity.right, 0, 2) && landmarks.identity.height >= 60,
    `received ${JSON.stringify(landmarks.identity)}`
  );
  contractTrue(
    `${width}: notification keeps a 44px top-rail target`,
    landmarks.notification && landmarks.notification.width >= 44 && landmarks.notification.height >= 44 && landmarks.notification.right <= landmarks.identity.left + 1,
    `received notification=${JSON.stringify(landmarks.notification)} identity=${JSON.stringify(landmarks.identity)}`
  );
  contractTrue(
    `${width}: workbench footer is continuous with mission focus`,
    landmarks.workbenchFooter && landmarks.missionFocus && landmarks.decisionSummary
      && landmarks.workbenchFooter.left >= landmarks.missionFocus.left
      && landmarks.workbenchFooter.right <= landmarks.missionFocus.right
      && landmarks.workbenchFooter.bottom <= landmarks.missionFocus.bottom
      && landmarks.workbenchFooter.height >= 44
      && landmarks.workbenchFooter.top - landmarks.decisionSummary.bottom <= 14,
    `received footer=${JSON.stringify(landmarks.workbenchFooter)} focus=${JSON.stringify(landmarks.missionFocus)} summary=${JSON.stringify(landmarks.decisionSummary)}`
  );
  contractTrue(
    `${width}: decision facts fill the continuous workbench field`,
    landmarks.lastDecisionFact && landmarks.decisionSummary
      && landmarks.decisionSummary.bottom - landmarks.lastDecisionFact.bottom <= 4,
    `received summary=${JSON.stringify(landmarks.decisionSummary)} lastFact=${JSON.stringify(landmarks.lastDecisionFact)}`
  );
  contractTrue(
    `${width}: command bar aligns with the comp workbench inset`,
    landmarks.prompt
      && ranges(landmarks.prompt.left, ...expected.promptLeft)
      && ranges(landmarks.prompt.right, ...expected.promptRight)
      && landmarks.prompt.bottom <= height - 18,
    `received ${JSON.stringify(landmarks.prompt)}`
  );
  contractTrue(
    `${width}: assistant reserves the lower-right lane`,
    landmarks.assistant
      && ranges(landmarks.assistant.left, ...expected.assistantLeft)
      && ranges(landmarks.assistant.width, ...expected.assistantWidth)
      && ranges(height - landmarks.assistant.bottom, 16, 34),
    `received ${JSON.stringify(landmarks.assistant)}`
  );
  contractTrue(
    `${width}: command and assistant lanes do not overlap`,
    landmarks.prompt && landmarks.assistant && landmarks.prompt.right + 14 <= landmarks.assistant.left,
    `received prompt=${JSON.stringify(landmarks.prompt)} assistant=${JSON.stringify(landmarks.assistant)}`
  );
  contractTrue(
    `${width}: Context and Proof reserve space beside runtime`,
    landmarks.runtime && landmarks.evidenceDock && !rectanglesOverlap(landmarks.runtime, landmarks.evidenceDock) && landmarks.runtime.right + 10 <= landmarks.evidenceDock.left,
    `received runtime=${JSON.stringify(landmarks.runtime)} evidence=${JSON.stringify(landmarks.evidenceDock)}`
  );
}

async function verifyDesktopAiSupport(cdp, width, height) {
  const trigger = '[data-kordyn-v2-ai-support-trigger]';
  await evaluate(cdp, `(() => { const node = document.querySelector(${JSON.stringify(trigger)}); node?.focus(); return document.activeElement === node; })()`);
  await pressKey(cdp, "Enter");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-support-panel]')", `${width}: desktop AI support opens`);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-support-panel]')?.contains(document.activeElement)", `${width}: desktop AI support receives focus`);
  const opened = await evaluate(cdp, `(() => {
    const trigger = document.querySelector('[data-kordyn-v2-ai-support-trigger]');
    const panel = document.querySelector('[data-kordyn-v2-ai-support-panel]');
    const scroll = panel?.querySelector('[data-kordyn-v2-ai-support-scroll]');
    const rect = panel?.getBoundingClientRect();
    return {
      expanded:trigger?.getAttribute('aria-expanded'),
      role:panel?.getAttribute('role'),
      ariaModal:panel?.getAttribute('aria-modal'),
      label:panel?.textContent?.includes('只读助理') || false,
      boundary:panel?.textContent?.includes('不能下单、授权或修改配置') || false,
      scope:panel?.textContent?.includes('AI 交易员') && panel?.textContent?.includes('任务'),
      selection:panel?.textContent?.includes('watch-eth-retest') || false,
      state:panel?.textContent?.includes('ready') || false,
      focusInPanel:panel?.contains(document.activeElement) || false,
      bounds:rect ? {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height} : null,
      scroll:scroll ? {clientHeight:scroll.clientHeight,scrollHeight:scroll.scrollHeight} : null,
      targets:[...panel.querySelectorAll('[data-kordyn-v2-ai-support-target]')].map((node) => node.getAttribute('data-kordyn-v2-ai-support-target')),
      actions:window.__kordynV2BrowserCalls.actions
    };
  })()`);
  assert.deepEqual(opened.targets, ["governance/overview"], `${width}: ready support offers only its registered governance destination`);
  assert.equal(opened.expanded, "true", `${width}: support trigger publishes expanded state`);
  assert.equal(opened.role, "dialog", `${width}: support panel declares dialog semantics`);
  assert.equal(opened.ariaModal, null, `${width}: desktop support truthfully remains modeless`);
  assert.equal(opened.label && opened.boundary && opened.scope && opened.selection && opened.state && opened.focusInPanel, true, `${width}: support exposes governed current context`);
  assert.ok(opened.bounds.left >= 0 && opened.bounds.top >= 0 && opened.bounds.right <= width && opened.bounds.bottom <= height, `${width}: support panel is viewport bounded`);
  assert.ok(opened.bounds.width <= 380 && opened.bounds.height < height, `${width}: support panel remains compact`);
  assert.ok(opened.scroll.scrollHeight > opened.scroll.clientHeight, `${width}: long support content scrolls inside the bounded panel`);
  assert.equal(opened.actions, 0, `${width}: opening support invokes no production action`);

  const screenshot = await captureMobile(cdp, width, height, `desktop-${width}x${height}-ai-support-open.png`);
  await evaluate(cdp, `(() => {
    const scroll = document.querySelector('[data-kordyn-v2-ai-support-scroll]');
    scroll.scrollTop = scroll.scrollHeight;
    return new Promise((resolve) => requestAnimationFrame(resolve));
  })()`);
  await click(cdp, '[data-kordyn-v2-ai-support-target="governance/overview"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Domain === 'governance' && document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Workspace === 'overview'", `${width}: support registered navigation`);
  assert.equal(await evaluate(cdp, "window.__kordynV2BrowserCalls.actions"), 0, `${width}: support navigation is zero-write`);
  await pressKey(cdp, "Escape");
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-ai-support-panel]') && document.activeElement === document.querySelector('[data-kordyn-v2-ai-support-trigger]')", `${width}: support Escape close and focus return`);
  await click(cdp, '[data-kordyn-v2-domain-target="ai"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Workspace === 'missions'", `${width}: support returns to AI mission workspace`);
  return screenshot;
}

async function verifyDialog(cdp, panel) {
  const trigger = `[data-kordyn-v2-${panel}-trigger]`;
  await evaluate(cdp, `(() => { const node = document.querySelector(${JSON.stringify(trigger)}); node.focus(); return document.activeElement === node; })()`);
  await pressKey(cdp, "Enter");
  const opened = await evaluate(cdp, `(() => ({
    triggerFocused:document.activeElement === document.querySelector(${JSON.stringify(trigger)}),
    expanded:document.querySelector(${JSON.stringify(trigger)})?.getAttribute('aria-expanded'),
    overlay:Boolean(document.querySelector('[data-kordyn-v2-overlay=${panel}]')),
    activeTag:document.activeElement?.tagName,
    activeText:document.activeElement?.textContent?.trim()
  }))()`);
  if (!opened.overlay) throw new Error(`${panel} keyboard activation failed: ${JSON.stringify(opened)}`);
  await waitForExpression(
    cdp,
    `document.querySelector('[data-kordyn-v2-overlay=${panel}]')?.contains(document.activeElement)`,
    `${panel} keyboard open and focus`
  );
  await pressKey(cdp, "Tab");
  assert.equal(
    await evaluate(cdp, `document.querySelector('[data-kordyn-v2-overlay=${panel}]').contains(document.activeElement)`),
    true,
    `${panel}: Tab remains in dialog`
  );
  await pressKey(cdp, "Escape");
  await waitForExpression(
    cdp,
    `!document.querySelector('[data-kordyn-v2-overlay=${panel}]') && document.activeElement === document.querySelector(${JSON.stringify(trigger)})`,
    `${panel} Escape close and focus return`
  );
}

async function readDestination(cdp) {
  return await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="desktop"]');
    const surface = root?.querySelector('[data-kordyn-v2-destination]');
    const dialog = root?.querySelector('[data-kordyn-v2-dialog-surface][role="dialog"]');
    return {
      destination:surface?.getAttribute('data-kordyn-v2-destination') || null,
      mission:Boolean(root?.querySelector('[data-kordyn-v2-mission-control]')),
      boundary:Boolean(root?.querySelector('[data-kordyn-v2-destination-boundary]')),
      dialog:Boolean(dialog),
      dialogFocused:Boolean(dialog?.contains(document.activeElement)),
      title:root?.querySelector('[data-kordyn-v2-destination-title]')?.textContent?.trim() || null
    };
  })()`);
}

async function verifyDestinations(cdp, width) {
  for (const destination of destinationCases) {
    await click(cdp, `[data-kordyn-v2-domain-target="${destination.domain}"]`);
    await waitForExpression(
      cdp,
      `document.querySelector('[data-kordyn-v2-shell="desktop"]')?.dataset.kordynV2Domain === '${destination.domain}'`,
      `${width}: ${destination.domain} domain`
    );
    if (destination.workspace !== domains.find(([domain]) => domain === destination.domain)?.[1]) {
      await click(cdp, `[data-kordyn-v2-workspace-target="${destination.workspace}"]`);
    }
    await waitForExpression(
      cdp,
      `document.querySelector('[data-kordyn-v2-shell="desktop"]')?.dataset.kordynV2Workspace === '${destination.workspace}'`,
      `${width}: ${destination.domain}/${destination.workspace} destination`
    );
    const actual = await readDestination(cdp);
    contractEqual(`${width}: ${destination.domain}/${destination.workspace} honest destination`, actual, {
      destination: `${destination.domain}/${destination.workspace}`,
      mission: destination.kind === "mission",
      boundary: destination.kind === "boundary",
      dialog: destination.kind === "dialog",
      dialogFocused: destination.kind === "dialog",
      title: destination.title
    });
  }

  await click(cdp, '[data-kordyn-v2-domain-target="ai"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Workspace === 'missions'", `${width}: mission prompt origin`);
  await click(cdp, ".kordynV2MissionPrompt");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Workspace === 'dialog'", `${width}: mission prompt dialog route`);
  const promptDestination = await readDestination(cdp);
  contractTrue(
    `${width}: mission prompt opens dialog surface`,
    promptDestination.destination === "ai/dialog" && promptDestination.dialog && promptDestination.dialogFocused && !promptDestination.mission,
    `received ${JSON.stringify(promptDestination)}`
  );
  if (promptDestination.dialog) {
    await pressKey(cdp, "Escape");
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Workspace === 'missions'", `${width}: dialog Escape close`);
    contractEqual(
      `${width}: dialog Escape returns focus to mission prompt`,
      await evaluate(cdp, "document.activeElement === document.querySelector('[data-kordyn-v2-dialog-trigger]')"),
      true
    );
  }
}

async function verifyUrgentSelection(cdp, width) {
  await click(cdp, '[data-kordyn-v2-domain-target="ai"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Workspace === 'missions'", `${width}: urgent selection origin`);
  const before = await evaluate(cdp, `(() => {
    const item = document.querySelector('.kordynV2AttentionItem');
    window.__kordynV2UrgentActivationClicks = 0;
    item?.addEventListener('click', () => { window.__kordynV2UrgentActivationClicks += 1; }, { once:true });
    item?.focus();
    return {
      tag:item?.tagName || null,
      target:item?.getAttribute('data-kordyn-v2-attention-target') || null,
      focused:document.activeElement === item
    };
  })()`);
  contractEqual(`${width}: urgent row is canonical button`, before, {
    tag: "BUTTON",
    target: "watch-sol-allowlist",
    focused: true
  });
  if (before.tag) {
    await pressKey(cdp, "Enter");
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  const after = await evaluate(cdp, `(() => ({
    selectedId:document.querySelector('[data-kordyn-v2-shell="desktop"]')?.dataset.kordynV2SelectedId || null,
    missionTitle:document.querySelector('.kordynV2MissionTitle h2')?.textContent?.trim() || null,
    actions:window.__kordynV2BrowserCalls.actions,
    activationClicks:window.__kordynV2UrgentActivationClicks
  }))()`);
  contractEqual(`${width}: urgent row selects authoritative object without a write`, after, {
    selectedId: "watch-sol-allowlist",
    missionTitle: "SOL 白名单机会",
    actions: 0,
    activationClicks: 1
  });

  await click(cdp, '[data-kordyn-v2-object-target="watch-eth-retest"]');
  await evaluate(cdp, `(() => {
    const item = document.querySelector('.kordynV2AttentionItem');
    window.__kordynV2UrgentSpaceClicks = 0;
    item?.addEventListener('click', () => { window.__kordynV2UrgentSpaceClicks += 1; }, { once:true });
    item?.focus();
  })()`);
  await pressKey(cdp, "Space");
  const afterSpace = await evaluate(cdp, `(() => ({
    selectedId:document.querySelector('[data-kordyn-v2-shell="desktop"]')?.dataset.kordynV2SelectedId || null,
    actions:window.__kordynV2BrowserCalls.actions,
    activationClicks:window.__kordynV2UrgentSpaceClicks
  }))()`);
  contractEqual(`${width}: urgent row supports Space without a write`, afterSpace, {
    selectedId: "watch-sol-allowlist",
    actions: 0,
    activationClicks: 1
  });
}

async function readHealth(cdp) {
  return await evaluate(cdp, `(() => {
    const nodes = {
      connection:document.querySelector('.kordynV2PrimaryFooter'),
      runtime:document.querySelector('.kordynV2TruthFact.is-runtime'),
      risk:document.querySelector('.kordynV2TruthFact.is-risk'),
      realtime:document.querySelector('.kordynV2TruthPulse')
    };
    return Object.fromEntries(Object.entries(nodes).map(([key, node]) => [key, {
      text:node?.textContent?.trim() || "",
      tone:node?.getAttribute('data-health-tone') || null,
      role:node?.getAttribute('role') || null,
      name:node?.getAttribute('aria-label') || ""
    }]));
  })()`);
}

async function verifyHealth(cdp, pageUrl, scenario, expectedTones) {
  const url = scenario === "default" ? pageUrl : `${pageUrl}?scenario=${scenario}`;
  await setViewport(cdp, url, 1440, 900);
  const health = await readHealth(cdp);
  for (const [kind, indicator] of Object.entries(health)) {
    const expectedTone = expectedTones[kind];
    contractEqual(`${scenario}: ${kind} health tone`, indicator.tone, expectedTone);
    contractEqual(`${scenario}: ${kind} semantic role`, indicator.role, "status");
    contractTrue(`${scenario}: ${kind} accessible name`, Boolean(indicator.name), `received ${JSON.stringify(indicator)}`);
    if (expectedTone === "unavailable") {
      contractTrue(
        `${scenario}: ${kind} names unavailable truth`,
        `${indicator.text} ${indicator.name}`.includes("Unavailable"),
        `received ${JSON.stringify(indicator)}`
      );
    }
  }
  return health;
}

async function verifyContradictionHealth(cdp, pageUrl) {
  const cases = [
    {
      scenario: "health-kill-normal",
      tones: { connection: "mint", runtime: "danger", risk: "danger", realtime: "mint" },
      riskLabel: /kill_switch|紧急停止/i
    },
    {
      scenario: "health-reduce-normal",
      tones: { connection: "mint", runtime: "mint", risk: "danger", realtime: "mint" },
      riskLabel: /reduce_only|仅减仓/i
    },
    {
      scenario: "health-adverse-source-conflict",
      tones: { connection: "mint", runtime: "mint", risk: "danger", realtime: "danger" },
      riskLabel: /critical|严重|高风险/i
    },
    {
      scenario: "health-reconciliation-stale",
      tones: { connection: "mint", runtime: "mint", risk: "danger", realtime: "danger" },
      riskLabel: /账户对账锁定/
    },
    {
      scenario: "health-emergency-stale",
      tones: { connection: "mint", runtime: "mint", risk: "danger", realtime: "danger" },
      riskLabel: /紧急停止/
    },
    {
      scenario: "health-consistent-normal-fresh",
      tones: { connection: "mint", runtime: "mint", risk: "mint", realtime: "mint" },
      riskLabel: /风险正常/
    },
    {
      scenario: "health-pending-false",
      tones: { connection: "mint", runtime: "mint", risk: "unavailable", realtime: "unavailable" },
      riskLabel: /Unavailable/
    },
    {
      scenario: "health-novel-false",
      tones: { connection: "mint", runtime: "mint", risk: "unavailable", realtime: "unavailable" },
      riskLabel: /Unavailable/
    },
    {
      scenario: "health-normal-novel-conflict",
      tones: { connection: "mint", runtime: "mint", risk: "unavailable", realtime: "mint" },
      riskLabel: /Unavailable/
    }
  ];
  for (const contract of cases) {
    const health = await verifyHealth(cdp, pageUrl, contract.scenario, contract.tones);
    contractTrue(
      `${contract.scenario}: risk presentation preserves authoritative precedence`,
      contract.riskLabel.test(`${health.risk.text} ${health.risk.name}`),
      `received ${JSON.stringify(health.risk)}`
    );
  }
}

async function readQueueGroups(cdp) {
  return await evaluate(cdp, `(() => [...document.querySelectorAll('.kordynV2QueueGroup')].map((group) => ({
    label:group.querySelector('h3')?.childNodes?.[1]?.textContent?.trim() || group.querySelector('h3')?.textContent?.replace(/\\s*\\(\\d+\\)\\s*$/, '').trim() || null,
    targets:[...group.querySelectorAll('[data-kordyn-v2-object-target]')].map((node) => node.getAttribute('data-kordyn-v2-object-target'))
  })))()`);
}

async function verifyUnknownQueue(cdp, pageUrl) {
  await setViewport(cdp, pageUrl, 1440, 900);
  contractEqual("recognized queue facts retain their explicit activity groups", await readQueueGroups(cdp), [
    { label: "正在分析", targets: ["run-btc-analysis"] },
    { label: "正在监控", targets: ["watch-eth-retest", "watch-sol-allowlist"] },
    { label: "执行中", targets: ["plan-eth-follow"] },
    { label: "已完成", targets: ["run-btc-complete", "plan-sol-complete"] }
  ]);
  await setViewport(cdp, `${pageUrl}?scenario=queue-unknown`, 1440, 900);
  const groups = await readQueueGroups(cdp);
  contractEqual("status-less and novel queue facts render only in truthful unavailable group", groups, [
    {
      label: "事实待定",
      targets: [
        "agent-status-missing",
        "agent-status-novel",
        "watch-status-missing",
        "plan-status-missing"
      ]
    }
  ]);
  const positiveTargets = groups
    .filter((group) => ["正在分析", "正在监控", "执行中", "已完成"].includes(group.label))
    .flatMap((group) => group.targets);
  contractEqual("unknown queue facts never imply positive activity", positiveTargets, []);
}

async function readAttentionSummary(cdp) {
  return await evaluate(cdp, `(() => {
    const card = document.querySelector('.kordynV2AttentionCard.is-urgent');
    return {
      aggregate:card?.querySelector(':scope > header span')?.textContent?.trim() || null,
      empty:card?.querySelector(':scope > p')?.textContent?.trim() || null,
      items:[...card.querySelectorAll('.kordynV2AttentionItem')].map((node) => node.querySelector('strong')?.textContent?.trim() || null)
    };
  })()`);
}

async function verifyAttentionCompleteness(cdp, pageUrl) {
  const cases = [
    ["attention-pending-only-empty", { aggregate: "Unavailable", empty: "Unavailable", items: [] }],
    ["attention-risk-only-empty", { aggregate: "Unavailable", empty: "Unavailable", items: [] }],
    ["attention-both-empty", { aggregate: "0", empty: "当前没有待处理的权威事项。", items: [] }],
    ["attention-present-partial", { aggregate: "Unavailable", empty: null, items: ["Authoritative pending item"] }]
  ];
  for (const [scenario, expected] of cases) {
    await setViewport(cdp, `${pageUrl}?scenario=${scenario}`, 1440, 900);
    contractEqual(`${scenario}: attention aggregate preserves collection completeness`, await readAttentionSummary(cdp), expected);
  }
}

async function readMissionSemantics(cdp) {
  return await evaluate(cdp, `(() => ({
    missionStatus:document.querySelector('.kordynV2MissionTitle em')?.textContent?.trim() || null,
    signal:document.querySelector('.kordynV2MissionSignal')?.textContent?.trim() || null,
    relationships:[...document.querySelectorAll('.kordynV2AttentionCard.is-context dd')].map((node) => node.textContent.trim()),
    stages:[...document.querySelectorAll('.kordynV2PipelineStage')].map((node) => ({
      id:node.getAttribute('data-stage-id'),
      label:node.querySelector('strong')?.textContent?.trim() || null,
      status:node.getAttribute('data-stage-state'),
      completeMark:Boolean(node.querySelector(':scope > svg'))
    }))
  }))()`);
}

async function verifyUnknownMission(cdp, pageUrl) {
  await setViewport(cdp, `${pageUrl}?scenario=mission-empty`, 1440, 900);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mission-focus]')", "empty mission facts");
  const empty = await readMissionSemantics(cdp);
  contractEqual("unknown mission status remains unavailable", empty.missionStatus, "Unavailable");
  contractEqual("unknown mission signal remains unavailable", empty.signal, "Unavailable");
  contractEqual("absent relationship collections remain unavailable", empty.relationships, [
    "Unavailable", "Unavailable", "Unavailable", "Unavailable", "Unavailable"
  ]);
  contractEqual("missing pipeline facts remain unavailable", empty.stages, [
    { id: "sense", label: "全市场快扫", status: "unavailable", completeMark: false },
    { id: "plan", label: "检验市场结构", status: "unavailable", completeMark: false },
    { id: "execute", label: "核对账户", status: "unavailable", completeMark: false },
    { id: "guard", label: "硬风控", status: "unavailable", completeMark: false },
    { id: "monitor", label: "等待回踩", status: "unavailable", completeMark: false }
  ]);

  await setViewport(cdp, `${pageUrl}?scenario=facts-unknown`, 1440, 900);
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mission-focus]')", "explicit mission trace facts");
  const explicit = await readMissionSemantics(cdp);
  contractEqual("visible pipeline maps explicit canonical stage identities", explicit.stages, [
    { id: "sense", label: "全市场快扫", status: "blocked", completeMark: false },
    { id: "plan", label: "检验市场结构", status: "complete", completeMark: true },
    { id: "execute", label: "核对账户", status: "waiting", completeMark: false },
    { id: "guard", label: "硬风控", status: "unavailable", completeMark: false },
    { id: "monitor", label: "等待回踩", status: "complete", completeMark: true }
  ]);
}

async function verifyDefaultMissionStages(cdp, width) {
  const stages = await readMissionSemantics(cdp);
  contractEqual(`${width}: pinned ETH trace renders explicit stage facts`, stages.stages, [
    { id: "sense", label: "全市场快扫", status: "complete", completeMark: true },
    { id: "plan", label: "检验市场结构", status: "complete", completeMark: true },
    { id: "execute", label: "核对账户", status: "waiting", completeMark: false },
    { id: "guard", label: "硬风控", status: "complete", completeMark: true },
    { id: "monitor", label: "等待回踩", status: "waiting", completeMark: false }
  ]);
}

async function verifyUnresolvedAttention(cdp, pageUrl) {
  await setViewport(cdp, `${pageUrl}?scenario=attention-unresolved`, 1440, 900);
  await waitForExpression(cdp, "document.querySelector('.kordynV2AttentionItem')", "unresolved attention boundary");
  const actual = await evaluate(cdp, `(() => {
    const item = document.querySelector('.kordynV2AttentionItem');
    return {
      tag:item?.tagName || null,
      target:item?.getAttribute('data-kordyn-v2-attention-target') || null,
      name:item?.getAttribute('aria-label') || "",
      selectedId:document.querySelector('[data-kordyn-v2-shell="desktop"]')?.dataset.kordynV2SelectedId || null,
      actions:window.__kordynV2BrowserCalls.actions
    };
  })()`);
  contractEqual("unresolved urgent identity fails closed without actionable semantics", actual, {
    tag: "DIV",
    target: null,
    name: "未解析事项：Unavailable",
    selectedId: "watch-eth-retest",
    actions: 0
  });
}

async function readMobileGeometry(cdp) {
  return await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell="mobile"]');
    const nav = root.querySelector('[data-kordyn-v2-mobile-navigation]');
    const state = root.querySelector('.kordynV2StateBoundary');
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth};
    };
    const maybeBox = (selector) => {
      const node = root.querySelector(selector);
      return node ? box(node) : null;
    };
    const fontSize = (node) => node ? Number.parseFloat(getComputedStyle(node).fontSize) || 0 : 0;
    const loadedCssRules = [...document.styleSheets].flatMap((sheet) => {
      const walk = (rules) => [...(rules || [])].flatMap((rule) => rule.cssRules ? walk(rule.cssRules) : [rule]);
      try { return walk(sheet.cssRules); } catch { return []; }
    });
    const loadedStyleText = [...document.querySelectorAll('style')].map((node) => node.textContent || '').join('\\n');
    const structural = new Set([
      root,
      root.querySelector('.kordynV2MobileHeader'),
      root.querySelector('[data-kordyn-v2-account-truth-mode]'),
      root.querySelector('[data-kordyn-v2-workspace-nav]'),
      state,
      root.querySelector('[data-kordyn-v2-work-canvas]'),
      root.querySelector('.kordynV2MissionGrid'),
      root.querySelector('[data-kordyn-v2-destination-boundary]'),
      root.querySelector('.kordynV2DialogSurface'),
      root.querySelector('[data-kordyn-v2-mobile-sheet]'),
      root.querySelector('.kordynV2MobileSheetScroll')
    ].filter(Boolean));
    const overflow = [root, ...root.querySelectorAll('*')].filter((node) => {
      const style = getComputedStyle(node);
      const scrollOwner = structural.has(node) || ['auto','scroll'].includes(style.overflowX);
      return scrollOwner && style.display !== 'none' && node.clientWidth > 0 && node.scrollWidth > node.clientWidth + 1;
    }).map((node) => ({tag:node.tagName,className:typeof node.className === 'string' ? node.className : '',clientWidth:node.clientWidth,scrollWidth:node.scrollWidth}));
    const visibleTargets = [...root.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')]
      .filter((node) => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node); return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; })
      .map((node) => ({name:node.textContent.trim() || node.getAttribute('aria-label'),...box(node)}));
    const sheet = root.querySelector('[data-kordyn-v2-mobile-sheet]');
    const sheetScroll = root.querySelector('.kordynV2MobileSheetScroll');
    return {
      viewport:[innerWidth,innerHeight],
      document:[document.documentElement.clientWidth,document.documentElement.scrollWidth],
      root:box(root),nav:box(nav),state:box(state),sheet:sheet ? box(sheet) : null,
      sheetScroll:sheetScroll ? {clientHeight:sheetScroll.clientHeight,scrollHeight:sheetScroll.scrollHeight} : null,
      overflow,visibleTargets,
      activeDomains:root.querySelectorAll('[data-kordyn-v2-domain-target][aria-current="page"]').length,
      activeWorkspaces:root.querySelectorAll('[data-kordyn-v2-workspace-target][aria-current="page"]').length,
      domain:root.dataset.kordynV2Domain,
      workspace:root.dataset.kordynV2Workspace,
      selectedId:root.dataset.kordynV2SelectedId,
      actions:window.__kordynV2BrowserCalls.actions,
      legacyStyles:${legacyStyleProbeSource},
      paddingBottom:Number.parseFloat(getComputedStyle(root).paddingBottom) || 0,
      foundation:{
        identity:maybeBox('[data-kordyn-v2-mobile-identity]'),
        header:maybeBox('.kordynV2MobileHeader'),
        title:maybeBox('[data-kordyn-v2-mobile-title]'),
        destinations:maybeBox('[data-kordyn-v2-workspace-nav]'),
        truth:maybeBox('[data-kordyn-v2-account-truth-mode]'),
        traderFrame:maybeBox('[data-kordyn-v2-mobile-trader-frame]'),
        traderHeader:maybeBox('[data-kordyn-v2-mobile-trader-header]'),
        mission:maybeBox('[data-kordyn-v2-mobile-active-mission]'),
        needsYou:maybeBox('[data-kordyn-v2-mobile-needs-you]'),
        accountImpact:maybeBox('[data-kordyn-v2-mobile-account-impact]'),
        recent:maybeBox('[data-kordyn-v2-mobile-recent]'),
        recentRows:[...root.querySelectorAll('[data-kordyn-v2-mobile-recent] > div')].map(box),
        prompt:maybeBox('.kordynV2MissionPrompt'),
        evidence:maybeBox('[data-kordyn-v2-mobile-evidence-trigger]'),
        notification:maybeBox('[data-kordyn-v2-notification-target="governance/notifications"]'),
        missionFacts:[...root.querySelectorAll('.kordynV2MobileMissionFacts dd')].map((node) => node.textContent.trim()),
        missionNested:Boolean(root.querySelector('[data-kordyn-v2-mobile-trader-frame] > [data-kordyn-v2-mobile-active-mission]')),
        coreFontMin:Math.min(...[...root.querySelectorAll('.kordynV2MobileMissionStages strong, .kordynV2MobileMissionStages small, .kordynV2MobileMissionFacts dt, .kordynV2MobileMissionFacts dd')].map(fontSize)),
        stageProjection:[...root.querySelectorAll('.kordynV2MobileMissionStages > [data-stage-id]')].map((node) => ({
          id:node.getAttribute('data-stage-id'),
          label:node.querySelector('strong')?.textContent.trim() || null,
          statusText:node.querySelector('small')?.textContent.trim() || null,
          status:node.getAttribute('data-stage-state'),
          connector:node.getAttribute('data-stage-connector'),
          connectorPaint:getComputedStyle(node, '::after').backgroundColor
        })),
        legacyMissionOverrideCount:Math.max(
          loadedCssRules.filter((rule) => /\\.kordynV2MobileShell \\.kordynV2(?:MissionControl|MissionGrid|MissionFocus|AttentionRail|MissionQueue|MissionTitle|MissionPipeline|PipelineStage|DecisionSummary|DecisionFact|WorkbenchFooter|WorkbenchIdentity)/.test(rule.selectorText || '')).length,
          loadedStyleText.includes('.kordynV2MobileShell .kordynV2MissionControl') ? 1 : 0
        ),
        evidenceDock:Boolean(root.querySelector('.kordynV2MobileEvidenceDock')),
        standaloneEvidenceTriggers:root.querySelectorAll('.kordynV2MobileHeader [data-kordyn-v2-context-trigger], .kordynV2MobileHeader [data-kordyn-v2-proof-trigger]').length,
        evidenceInsideMission:Boolean(root.querySelector('[data-kordyn-v2-mobile-active-mission] [data-kordyn-v2-mobile-evidence-trigger]')),
        readingOrder:(() => {
          const selectors = [
            '[data-kordyn-v2-mobile-identity]',
            '[data-kordyn-v2-mobile-title]',
            '[data-kordyn-v2-workspace-nav]',
            '[data-kordyn-v2-account-truth-mode]',
            '[data-kordyn-v2-mobile-active-mission]',
            '[data-kordyn-v2-mobile-needs-you]',
            '[data-kordyn-v2-mobile-account-impact]',
            '[data-kordyn-v2-mobile-recent]',
            '.kordynV2MissionPrompt',
            '[data-kordyn-v2-mobile-navigation]'
          ];
          const nodes = selectors.map((selector) => root.querySelector(selector));
          return nodes.every(Boolean) && nodes.every((node, index) => index === 0 || Boolean(nodes[index - 1].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
        })()
      }
    };
  })()`);
}

async function verifyLegacyStyleOwnershipProbe(cdp, read, label) {
  await evaluate(cdp, `(() => {
    const sentinel = document.createElement('style');
    sentinel.dataset.viteDevId = '/src/styles.css';
    sentinel.dataset.kordynV2LegacySentinel = 'true';
    sentinel.textContent = ':root{}';
    document.head.append(sentinel);
    return true;
  })()`);
  const injected = await read(cdp);
  assert.equal(injected.legacyStyles, true, `${label}: Vite data-vite-dev-id legacy owner is detected`);
  await evaluate(cdp, "document.querySelector('[data-kordyn-v2-legacy-sentinel]')?.remove() || true");
  const restored = await read(cdp);
  assert.equal(restored.legacyStyles, false, `${label}: removing the legacy owner restores a clean V2 graph`);
}

async function assertMobileSheet(cdp, width, navTop, panel) {
  await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-mobile-sheet="${panel}"]')`, `${width}: ${panel} mobile sheet`);
  const geometry = await readMobileGeometry(cdp);
  assert.ok(geometry.sheet.top >= 0 && geometry.sheet.bottom <= navTop + 1, `${width}: ${panel} sheet is bounded above navigation`);
  assert.ok(geometry.sheet.height < geometry.viewport[1] && geometry.sheet.height <= navTop, `${width}: ${panel} sheet height is bounded`);
  assert.ok(geometry.visibleTargets.every((target) => target.width >= 44 && target.height >= 44), `${width}: visible navigation and sheet targets are at least 44x44`);
  assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet]')?.contains(document.activeElement)"), true, `${width}: ${panel} sheet contains focus`);
  await pressKey(cdp, "Tab");
  assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet]')?.contains(document.activeElement)"), true, `${width}: ${panel} traps forward focus`);
  await pressKey(cdp, "Tab", { shift: true });
  assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet]')?.contains(document.activeElement)"), true, `${width}: ${panel} traps reverse focus`);
  const isolation = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell=mobile]');
    const sheet = root.querySelector('[data-kordyn-v2-mobile-sheet]');
    const background = root.querySelector('[data-kordyn-v2-mobile-background]');
    const outside = [...root.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !sheet.contains(node));
    const task = root.querySelector('[data-kordyn-v2-workspace-target="missions"]');
    task.focus();
    return {
      inert:background?.hasAttribute('inert') || false,
      ariaHidden:background?.getAttribute('aria-hidden') || null,
      isolated:Boolean(background) && outside.length > 0 && outside.every((node) => node.closest('[inert][aria-hidden="true"]') === background),
      taskFocused:document.activeElement === task,
      focusInSheet:sheet.contains(document.activeElement),
      domain:root.dataset.kordynV2Domain
    };
  })()`);
  assert.deepEqual(isolation, { inert: true, ariaHidden: "true", isolated: true, taskFocused: false, focusInSheet: true, domain: "ai" }, `${width}: ${panel} declaratively isolates every non-sheet control`);
  await click(cdp, '[data-kordyn-v2-domain-target="account"]');
  assert.deepEqual(await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell=mobile]');
    const sheet = root.querySelector('[data-kordyn-v2-mobile-sheet]');
    return {domain:root.dataset.kordynV2Domain,panel:Boolean(sheet),focusInSheet:sheet.contains(document.activeElement)};
  })()`), { domain: "ai", panel: true, focusInSheet: true }, `${width}: ${panel} blocks pointer navigation and retains modal focus`);
  return geometry;
}

async function verifyMobileViewport(cdp, pageUrl, width, height) {
  await setViewport(cdp, pageUrl, width, height, "mobile");
  const destinations = [];
  let minimumWorkspaceTarget = Number.POSITIVE_INFINITY;
  for (const [domain, workspace] of domains) {
    await click(cdp, `[data-kordyn-v2-domain-target="${domain}"]`);
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Domain === '${domain}' && document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === '${workspace}'`, `${width}: mobile ${domain}/${workspace}`);
    const result = await evaluate(cdp, `(() => {
      const root = document.querySelector('[data-kordyn-v2-shell=mobile]');
      const destination = root.querySelector('[data-kordyn-v2-destination]');
      const local = root.querySelector('[data-kordyn-v2-workspace-nav]');
      const localBox = local.getBoundingClientRect();
      const workspaceTargets = [...local.querySelectorAll('[data-kordyn-v2-workspace-target]')].map((node) => {
        const rect = node.getBoundingClientRect();
        return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height};
      });
      return {
        activeDomains:root.querySelectorAll('[data-kordyn-v2-domain-target][aria-current="page"]').length,
        activeWorkspaces:root.querySelectorAll('[data-kordyn-v2-workspace-target][aria-current="page"]').length,
        destination:destination?.getAttribute('data-kordyn-v2-destination') || null,
        mission:Boolean(root.querySelector('[data-kordyn-v2-mission-control]')),
        boundary:Boolean(root.querySelector('[data-kordyn-v2-destination-boundary]')),
        title:root.querySelector('[data-kordyn-v2-destination-title]')?.textContent?.trim() || null,
        localBox:{left:localBox.left,top:localBox.top,right:localBox.right,bottom:localBox.bottom},
        workspaceTargets
      };
    })()`);
    assert.deepEqual([result.activeDomains, result.activeWorkspaces], [1, 1], `${width}: ${domain} has one active root and workspace`);
    assert.equal(result.destination, `${domain}/${workspace}`, `${width}: ${domain} publishes an honest destination`);
    assert.equal(domain === "ai" ? result.mission : result.boundary, true, `${width}: ${domain} renders its distinct workspace body`);
    assert.ok(result.workspaceTargets.every((target) => target.width >= 44 && target.height >= 44), `${width}: ${domain} workspace targets are at least 44x44`);
    minimumWorkspaceTarget = Math.min(minimumWorkspaceTarget, ...result.workspaceTargets.flatMap((target) => [target.width, target.height]));
    assert.ok(result.workspaceTargets.every((target) => target.left >= result.localBox.left && target.right <= result.localBox.right + 1 && target.top >= result.localBox.top && target.bottom <= result.localBox.bottom + 1), `${width}: ${domain} workspace targets stay contained`);
    if (["ai", "assets"].includes(domain)) {
      assert.equal(new Set(result.workspaceTargets.map((target) => Math.round(target.top))).size, 1, `${width}: ${domain} five workspace targets remain in one row`);
    }
    destinations.push(result.destination);

    const alternate = await evaluate(cdp, `(() => [...document.querySelectorAll('[data-kordyn-v2-workspace-target]')].map((node) => node.getAttribute('data-kordyn-v2-workspace-target')).find((id) => id !== ${JSON.stringify(workspace)}))()`);
    assert.ok(alternate, `${width}: ${domain} exposes domain-local navigation`);
    await click(cdp, `[data-kordyn-v2-workspace-target="${alternate}"]`);
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === ${JSON.stringify(alternate)}`, `${width}: ${domain}/${alternate} local navigation`);
  }
  assert.deepEqual(destinations, ["ai/missions", "account/market", "assets/relationships", "governance/overview"], `${width}: four distinct destination identities`);

  await click(cdp, '[data-kordyn-v2-domain-target="ai"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === 'missions'", `${width}: return to mobile missions`);
  const aiDestinations = await evaluate(cdp, "[...document.querySelectorAll('[data-kordyn-v2-workspace-target]')].map((node) => node.getAttribute('data-kordyn-v2-workspace-target'))");
  assert.deepEqual(aiDestinations, ["missions", "intelligence", "watch", "events", "dialog"], `${width}: all five AI-local destinations remain exposed`);
  for (const workspace of aiDestinations) {
    await click(cdp, `[data-kordyn-v2-workspace-target="${workspace}"]`);
    await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === ${JSON.stringify(workspace)}`, `${width}: clicks AI-local ${workspace}`);
  }
  await click(cdp, '[data-kordyn-v2-workspace-target="missions"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === 'missions'", `${width}: restores mobile mission home`);

  const base = await readMobileGeometry(cdp);
  assert.deepEqual(base.viewport, [width, height], `${width}: mobile viewport retained`);
  assert.deepEqual(base.document, [width, width], `${width}: no document overflow`);
  assert.equal(base.overflow.length, 0, `${width}: no shell-owned horizontal overflow: ${JSON.stringify(base.overflow)}`);
  assert.ok(base.state.bottom <= base.nav.top + 1, `${width}: content region clears persistent navigation`);
  assert.ok(base.paddingBottom >= base.nav.height - 1, `${width}: shell reserves persistent navigation height`);
  assert.ok(base.visibleTargets.every((target) => target.width >= 44 && target.height >= 44), `${width}: mobile controls are at least 44x44`);
  assert.equal(base.actions, 0, `${width}: mobile navigation invokes no production action`);
  assert.equal(base.foundation.readingOrder, true, `${width}: approved mobile foundation reading order`);
  assert.equal(base.foundation.evidenceDock, false, `${width}: standalone Context/Proof dock is absent`);
  assert.equal(base.foundation.standaloneEvidenceTriggers, 0, `${width}: header contains no standalone evidence trigger`);
  assert.equal(base.foundation.evidenceInsideMission, true, `${width}: Mission owns the single governed evidence trigger`);
  contractTrue(`${width}: approved AI Trader frame contains a nested Mission card`, base.foundation.missionNested, `received ${base.foundation.missionNested}`);
  contractTrue(`${width}: outer AI Trader frame retains approved card rhythm`, base.foundation.traderFrame?.height >= 190, `received ${base.foundation.traderFrame?.height}`);
  contractTrue(`${width}: nested Mission card remains substantial`, base.foundation.mission?.height >= 148, `received ${base.foundation.mission?.height}`);
  contractTrue(`${width}: core Mission stages and facts stay readable`, base.foundation.coreFontMin >= 11, `received ${base.foundation.coreFontMin}px`);
  contractTrue(`${width}: evidence remains a secondary control`, base.foundation.evidence?.width <= 80, `received ${base.foundation.evidence?.width}px`);
  contractEqual(`${width}: unreachable legacy mobile MissionControl overrides are absent from the loaded CSSOM`, base.foundation.legacyMissionOverrideCount, 0);
  contractEqual(`${width}: mobile progress follows canonical stage identity and real status`, base.foundation.stageProjection.map(({ id, label, status, connector }) => ({ id, label, status, connector })), [
    { id: "sense", label: "快扫", status: "complete", connector: "complete" },
    { id: "plan", label: "结构", status: "complete", connector: "complete" },
    { id: "guard", label: "风控", status: "complete", connector: "complete" },
    { id: "execute", label: "执行", status: "waiting", connector: "unavailable" },
    { id: "monitor", label: "等待回踩", status: "waiting", connector: "none" }
  ]);
  const completeConnectorPaint = base.foundation.stageProjection.find((stage) => stage.connector === "complete")?.connectorPaint;
  const unavailableConnectorPaint = base.foundation.stageProjection.find((stage) => stage.connector === "unavailable")?.connectorPaint;
  contractTrue(`${width}: complete and unavailable connectors have distinct painted states`, completeConnectorPaint !== unavailableConnectorPaint, `received complete=${completeConnectorPaint} unavailable=${unavailableConnectorPaint}`);
  assert.ok(base.foundation.header?.bottom <= 214, `${width}: compact header bottom ${base.foundation.header?.bottom} is at or above 214px`);
  assert.ok(base.foundation.mission?.top < 250, `${width}: active Mission begins before 250px, received ${base.foundation.mission?.top}`);
  for (const [name, landmark] of Object.entries({ needsYou: base.foundation.needsYou, accountImpact: base.foundation.accountImpact, recent: base.foundation.recent })) {
    assert.ok(landmark && landmark.top < height && landmark.bottom > 0, `${width}: ${name} intersects the first viewport, received ${JSON.stringify(landmark)}`);
  }
  assert.ok(base.foundation.prompt && base.foundation.prompt.bottom <= base.nav.top + 1, `${width}: task prompt remains above bottom navigation`);
  assert.ok(base.foundation.recentRows.length >= 2, `${width}: two loaded recent-completion rows are present`);
  assert.ok(base.foundation.recentRows.slice(0, 2).every((row) => row.bottom <= base.foundation.prompt.top - 4), `${width}: two recent-completion rows remain meaningfully visible above the prompt, received rows=${JSON.stringify(base.foundation.recentRows)} prompt=${JSON.stringify(base.foundation.prompt)}`);
  assert.ok(base.foundation.prompt.top - base.foundation.recentRows[1].bottom <= 16, `${width}: recent completion and prompt retain the approved compact continuity`);
  assert.ok(base.foundation.notification?.width >= 44 && base.foundation.notification?.height >= 44, `${width}: notification is touch sized`);
  assert.deepEqual(base.foundation.missionFacts, ["normal", "Breakout Retest v3", "FOMC · 6h"], `${width}: active Mission projects loaded risk, strategy, and event facts`);

  await click(cdp, '[data-kordyn-v2-notification-target="governance/notifications"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Domain === 'governance' && document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === 'notifications'", `${width}: notification opens governed notifications`);
  assert.equal(await evaluate(cdp, "window.__kordynV2BrowserCalls.actions"), 0, `${width}: notification navigation is zero-write`);
  await click(cdp, '[data-kordyn-v2-domain-target="ai"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === 'missions'", `${width}: notification returns to missions`);

  const baseScreenshot = await captureMobile(cdp, width, height, `mobile-${width}x${height}.png`);
  recordCaptureEvidence({
    file: `mobile-${width}x${height}.png`,
    viewport: `${width}x${height}`,
    device: "mobile",
    width,
    height,
    sha256: baseScreenshot.sha256,
    geometry: base
  });
  await click(cdp, '[data-kordyn-v2-mobile-evidence-trigger]');
  const evidence = await assertMobileSheet(cdp, width, base.nav.top, "evidence");
  const evidenceTabs = await evaluate(cdp, `(() => ({
    labels:[...document.querySelectorAll('[data-kordyn-v2-evidence-tab]')].map((node) => node.textContent.trim()),
    targets:[...document.querySelectorAll('[data-kordyn-v2-evidence-tab]')].map((node) => { const rect=node.getBoundingClientRect(); return [rect.width,rect.height]; }),
    active:document.querySelector('[data-kordyn-v2-evidence-tab][aria-selected="true"]')?.getAttribute('data-kordyn-v2-evidence-tab') || null,
    selectedId:document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2SelectedId
  }))()`);
  contractEqual(`${width}: governed evidence sheet exposes Details, Context, and Proof tabs`, evidenceTabs.labels, ["详情", "Context", "Proof"]);
  assert.ok(evidenceTabs.targets.every(([targetWidth, targetHeight]) => targetWidth >= 44 && targetHeight >= 44), `${width}: evidence tabs are touch sized`);
  contractEqual(`${width}: Mission disclosure opens its full decision details`, evidenceTabs.active, "details");
  assert.equal(evidenceTabs.selectedId, base.selectedId, `${width}: opening evidence preserves canonical selection`);
  const hasDetailsTab = evidenceTabs.labels.includes("详情");
  contractTrue(`${width}: governed mobile details tab is present`, hasDetailsTab, `received tabs ${JSON.stringify(evidenceTabs.labels)}`);
  if (hasDetailsTab) {
    const details = await evaluate(cdp, `(() => ({
      facts:[...document.querySelectorAll('.kordynV2MobileDecisionFacts > div')].map((row) => [row.querySelector('dt')?.textContent.trim(), row.querySelector('dd')?.textContent.trim()]),
      tabs:[...document.querySelectorAll('[data-kordyn-v2-evidence-tab]')].map((tab) => ({
        id:tab.id,
        tab:tab.getAttribute('data-kordyn-v2-evidence-tab'),
        controls:tab.getAttribute('aria-controls'),
        selected:tab.getAttribute('aria-selected'),
        tabIndex:tab.tabIndex
      })),
      panel:{
        role:document.querySelector('#kordyn-v2-evidence-panel')?.getAttribute('role'),
        labelledBy:document.querySelector('#kordyn-v2-evidence-panel')?.getAttribute('aria-labelledby')
      }
    }))()`);
    assert.deepEqual(details.facts, [
      ["策略", "Breakout Retest v3"],
      ["知识来源", "波动环境指南 + 2 条真实复盘"],
      ["能力", "行情 / 市场结构 / 风控 / 执行"],
      ["事件", "FOMC · 6h"],
      ["持仓影响", "long 1.4"]
    ], `${width}: governed details restores every full decision fact from loaded data`);
    assert.deepEqual(details.tabs.map(({ tab, controls, tabIndex }) => ({ tab, controls, tabIndex })), [
      { tab: "details", controls: "kordyn-v2-evidence-panel", tabIndex: 0 },
      { tab: "context", controls: "kordyn-v2-evidence-panel", tabIndex: -1 },
      { tab: "proof", controls: "kordyn-v2-evidence-panel", tabIndex: -1 }
    ], `${width}: evidence tabs expose one roving stop and panel controls`);
    assert.deepEqual(details.panel, { role: "tabpanel", labelledBy: "kordyn-v2-evidence-tab-details" }, `${width}: active details tab labels its tabpanel`);
    await evaluate(cdp, "document.querySelector('[data-kordyn-v2-evidence-tab=details]').focus() || true");
    await pressKey(cdp, "ArrowRight");
    assert.equal(await evaluate(cdp, "document.activeElement?.getAttribute('data-kordyn-v2-evidence-tab')"), "context", `${width}: ArrowRight advances and focuses the evidence tab`);
    await pressKey(cdp, "End");
    assert.equal(await evaluate(cdp, "document.activeElement?.getAttribute('data-kordyn-v2-evidence-tab')"), "proof", `${width}: End focuses the final evidence tab`);
    await pressKey(cdp, "Home");
    assert.equal(await evaluate(cdp, "document.activeElement?.getAttribute('data-kordyn-v2-evidence-tab')"), "details", `${width}: Home restores the first evidence tab`);
  }
  await click(cdp, '[data-kordyn-v2-evidence-tab="context"]');
  assert.equal(await evaluate(cdp, "Boolean(document.querySelector('.kordynV2MobileContextFacts'))"), true, `${width}: Context tab exposes governed context`);
  assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2SelectedId"), base.selectedId, `${width}: Context tab preserves canonical selection`);
  await pressKey(cdp, "Escape");
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-mobile-sheet]')", `${width}: evidence sheet closes by Escape`);
  assert.equal(await evaluate(cdp, "document.activeElement === document.querySelector('[data-kordyn-v2-mobile-evidence-trigger]')"), true, `${width}: evidence focus returns`);
  assert.deepEqual(await evaluate(cdp, `(() => {
    const background = document.querySelector('[data-kordyn-v2-mobile-background]');
    return {inert:background.hasAttribute('inert'),ariaHidden:background.getAttribute('aria-hidden')};
  })()`), { inert: false, ariaHidden: null }, `${width}: evidence close removes background isolation`);
  await click(cdp, '[data-kordyn-v2-domain-target="account"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Domain === 'account'", `${width}: navigation restored after evidence closes`);
  await click(cdp, '[data-kordyn-v2-domain-target="ai"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === 'missions'", `${width}: return after restored navigation`);

  await evaluate(cdp, "document.querySelector('[data-kordyn-v2-mobile-evidence-trigger]').focus() || true");
  await pressKey(cdp, "Enter");
  await assertMobileSheet(cdp, width, base.nav.top, "evidence");
  await click(cdp, '[data-kordyn-v2-evidence-tab="proof"]');
  const proof = await readMobileGeometry(cdp);
  assert.ok(proof.sheetScroll.scrollHeight > proof.sheetScroll.clientHeight, `${width}: Proof long content exceeds the bounded sheet viewport`);
  const scrolled = await evaluate(cdp, `(() => {
    const node = document.querySelector('.kordynV2MobileSheetScroll');
    node.scrollTop = node.scrollHeight;
    return new Promise((resolve) => requestAnimationFrame(() => resolve({top:node.scrollTop,max:node.scrollHeight-node.clientHeight})));
  })()`);
  assert.ok(scrolled.max > 0 && Math.abs(scrolled.top - scrolled.max) <= 1, `${width}: Proof long content scrolls to its real bottom`);
  const sheetScreenshot = width === 390
    ? await captureMobile(cdp, width, height, `mobile-${width}x${height}-proof-sheet.png`)
    : null;
  await click(cdp, '[data-kordyn-v2-mobile-sheet-close]');
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-mobile-sheet]')", `${width}: proof sheet closes by pointer`);
  assert.equal(await evaluate(cdp, "document.activeElement === document.querySelector('[data-kordyn-v2-mobile-evidence-trigger]')"), true, `${width}: Proof focus returns`);
  assert.equal(await evaluate(cdp, "document.querySelector('[data-kordyn-v2-mobile-background]').hasAttribute('inert')"), false, `${width}: Proof close removes background isolation`);
  assert.equal(await evaluate(cdp, "window.__kordynV2BrowserCalls.actions"), 0, `${width}: sheets invoke no production action`);

  await click(cdp, '[data-kordyn-v2-ai-support-trigger]');
  const support = await assertMobileSheet(cdp, width, base.nav.top, "support");
  const supportSemantics = await evaluate(cdp, `(() => {
    const sheet = document.querySelector('[data-kordyn-v2-mobile-sheet="support"]');
    return {
      label:sheet?.textContent?.includes('只读助理') || false,
      boundary:sheet?.textContent?.includes('不能下单、授权或修改配置') || false,
      scope:sheet?.textContent?.includes('AI 交易员') && sheet?.textContent?.includes('任务'),
      selection:sheet?.textContent?.includes('watch-eth-retest') || false,
      target:sheet?.querySelector('[data-kordyn-v2-ai-support-target]')?.getAttribute('data-kordyn-v2-ai-support-target') || null,
      roots:document.querySelectorAll('[data-kordyn-v2-mobile-navigation] [data-kordyn-v2-domain-target]').length,
      actions:window.__kordynV2BrowserCalls.actions
    };
  })()`);
  assert.deepEqual(supportSemantics, {
    label: true,
    boundary: true,
    scope: true,
    selection: true,
    target: "governance/overview",
    roots: 4,
    actions: 0
  }, `${width}: APP support exposes governed current context without becoming a fifth root`);
  const supportReadability = await evaluate(cdp, `(() => {
    const sheet = document.querySelector('[data-kordyn-v2-mobile-sheet="support"]');
    const values = [...sheet.querySelectorAll('.kordynV2AiSupportFacts dd')];
    const navigationMeta = [...sheet.querySelectorAll('.kordynV2AiSupportSuggestions small')];
    const triggerMeta = document.querySelector('[data-kordyn-v2-ai-support-trigger] small');
    const fontSize = (node) => node ? Number.parseFloat(getComputedStyle(node).fontSize) : 0;
    const wrappingNodes = [...values, ...navigationMeta];
    return {
      factsMin:Math.min(...values.map(fontSize)),
      navigationMin:Math.min(...navigationMeta.map(fontSize)),
      triggerMeta:fontSize(triggerMeta),
      horizontalTextOverflows:wrappingNodes.filter((node) => node.scrollWidth > node.clientWidth + 1).length
    };
  })()`);
  assert.ok(supportReadability.factsMin >= 11, `${width}: APP support fact values are readable at 11px or larger`);
  assert.ok(supportReadability.navigationMin >= 11, `${width}: APP support navigation explanation is readable at 11px or larger`);
  assert.ok(supportReadability.triggerMeta >= 10, `${width}: APP floating support metadata is readable at 10px or larger`);
  assert.equal(supportReadability.horizontalTextOverflows, 0, `${width}: support fact and navigation text wraps without horizontal overflow`);
  assert.ok(support.sheetScroll.scrollHeight > support.sheetScroll.clientHeight, `${width}: APP support long content scrolls inside the governed sheet`);
  if (width === 430) {
    const supportCaptureScrollTop = await evaluate(cdp, `(() => {
      const content = document.querySelector('[data-kordyn-v2-mobile-sheet="support"] .kordynV2MobileSheetScroll');
      if (content) content.scrollTop = 0;
      return content?.scrollTop ?? -1;
    })()`);
    assert.equal(supportCaptureScrollTop, 0, "430: support-open evidence captures the identity and boundary from the top");
  }
  const supportScreenshot = await captureMobile(cdp, width, height, `mobile-${width}x${height}-ai-support-open.png`);
  await evaluate(cdp, `document.querySelector('[data-kordyn-v2-ai-support-target="governance/overview"]')?.scrollIntoView({block:'center'})`);
  await click(cdp, '[data-kordyn-v2-ai-support-target="governance/overview"]');
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-mobile-sheet]') && document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Domain === 'governance' && document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === 'overview'", `${width}: APP support registered navigation and sheet close`);
  assert.equal(await evaluate(cdp, "document.activeElement === document.querySelector('[data-kordyn-v2-ai-support-trigger]')"), true, `${width}: APP support navigation returns trigger focus`);
  assert.equal(await evaluate(cdp, "window.__kordynV2BrowserCalls.actions"), 0, `${width}: APP support navigation invokes no production action`);
  await click(cdp, '[data-kordyn-v2-domain-target="ai"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === 'missions'", `${width}: APP support returns to mission workspace`);

  await click(cdp, '.kordynV2MissionPrompt');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === 'dialog'", `${width}: mobile prompt opens dialog workspace`);
  const dialogGeometry = await readMobileGeometry(cdp);
  assert.ok(dialogGeometry.visibleTargets.every((target) => target.width >= 44 && target.height >= 44), `${width}: every visible dialog control is at least 44x44`);
  await pressKey(cdp, "Escape");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2Workspace === 'missions' && document.activeElement === document.querySelector('.kordynV2MissionPrompt')", `${width}: mobile prompt Escape returns focus`);
  return { width, height, base, evidence, proof, support, minimumWorkspaceTarget, baseScreenshot, sheetScreenshot, supportScreenshot };
}

async function verifyViewportTransition(cdp, pageUrl) {
  await setViewport(cdp, pageUrl, 1180, 800, "desktop");
  await click(cdp, '[data-kordyn-v2-workspace-target="intelligence"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Workspace === 'intelligence'", "desktop intelligence before viewport transition");
  await evaluate(cdp, "window.__kordynV2BrowserCalls.sections.length = 0");
  await resizeViewport(cdp, 390, 844, "mobile");
  await waitForExpression(cdp, "window.__kordynV2BrowserCalls.sections.length > 0", "mobile route section after viewport transition");
  const transition = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell=mobile]');
    return {domain:root?.dataset.kordynV2Domain,workspace:root?.dataset.kordynV2Workspace,sections:window.__kordynV2BrowserCalls.sections,actions:window.__kordynV2BrowserCalls.actions};
  })()`);
  assert.deepEqual(transition, {
    domain: "ai",
    workspace: "intelligence",
    sections: [{ section: "operationsCenter", force: false }],
    actions: 0
  }, "viewport transition retains canonical workspace and loads its mobile resource section exactly once");
  return transition;
}

async function verifyMobileStates(cdp, pageUrl) {
  for (const kind of ["stale", "degraded", "failed", "forbidden", "disabled"]) {
    await setViewport(cdp, `${pageUrl}?scenario=mobile-${kind}`, 390, 844, "mobile");
    const state = await evaluate(cdp, `(() => {
      const root = document.querySelector('[data-kordyn-v2-shell=mobile]');
      const boundary = root.querySelector('.kordynV2StateBoundary');
      return {
        kind:boundary?.getAttribute('data-kordyn-v2-state'),
        retained:Boolean(root.querySelector('.kordynV2RetainedNotice')),
        panel:Boolean(root.querySelector('.kordynV2StatePanel')),
        document:[document.documentElement.clientWidth,document.documentElement.scrollWidth],
        actions:window.__kordynV2BrowserCalls.actions
      };
    })()`);
    assert.equal(state.kind, kind, `mobile ${kind}: real StateBoundary kind`);
    assert.equal(state.retained, ["stale", "degraded"].includes(kind), `mobile ${kind}: retained-data presentation`);
    assert.equal(state.panel, !["stale", "degraded"].includes(kind), `mobile ${kind}: blocking presentation`);
    assert.deepEqual(state.document, [390, 390], `mobile ${kind}: no document overflow`);
    assert.equal(state.actions, 0, `mobile ${kind}: no production action`);
    const geometry = await readMobileGeometry(cdp);
    assert.ok(geometry.visibleTargets.every((target) => target.width >= 44 && target.height >= 44), `mobile ${kind}: every visible state control is at least 44x44`);
    const triggerSafety = await evaluate(cdp, `(() => {
      const trigger = document.querySelector('[data-kordyn-v2-ai-support-trigger]');
      const protectedTargets = [...document.querySelectorAll('.kordynV2StatePanel button, [data-kordyn-v2-retry]')];
      const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      const triggerRect = trigger?.getBoundingClientRect();
      return {
        trigger:Boolean(trigger),
        target:[triggerRect?.width || 0, triggerRect?.height || 0],
        protectedCount:protectedTargets.length,
        overlaps:triggerRect ? protectedTargets.filter((node) => overlap(triggerRect, node.getBoundingClientRect())).length : -1
      };
    })()`);
    assert.equal(triggerSafety.trigger, true, `mobile ${kind}: support trigger remains available`);
    assert.ok(triggerSafety.target[0] >= 44 && triggerSafety.target[1] >= 44, `mobile ${kind}: support trigger remains touch sized`);
    assert.equal(triggerSafety.overlaps, 0, `mobile ${kind}: support trigger does not cover retry or protected state controls`);
    await click(cdp, '[data-kordyn-v2-ai-support-trigger]');
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet=\"support\"]')", `mobile ${kind}: support sheet opens`);
    const supportState = await evaluate(cdp, `(() => {
      const sheet = document.querySelector('[data-kordyn-v2-mobile-sheet="support"]');
      return {
        kind:sheet?.querySelector('[data-kordyn-v2-ai-support-state]')?.getAttribute('data-kordyn-v2-ai-support-state') || null,
        selection:sheet?.textContent?.includes('未选择对象') || false,
        boundary:sheet?.textContent?.includes('不能下单、授权或修改配置') || false,
        isolated:document.querySelector('[data-kordyn-v2-mobile-background]')?.hasAttribute('inert') || false,
        actions:window.__kordynV2BrowserCalls.actions
      };
    })()`);
    assert.deepEqual(supportState, {
      kind,
      selection: true,
      boundary: true,
      isolated: true,
      actions: 0
    }, `mobile ${kind}: support explains the actual fail-closed state without hidden selection`);
    await pressKey(cdp, "Escape");
    await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-mobile-sheet]') && document.activeElement === document.querySelector('[data-kordyn-v2-ai-support-trigger]')", `mobile ${kind}: support Escape close and focus return`);
  }
}

async function verifyMobileReviewStates(cdp, pageUrl) {
  await setViewport(cdp, `${pageUrl}?scenario=position-mirrors`, 390, 844, "mobile");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-account-impact]')", "server-normalized production position projection");
  const positionImpact = await evaluate(cdp, `(() => {
    const section = document.querySelector('[data-kordyn-v2-mobile-account-impact]');
    const facts = Object.fromEntries([...section.querySelectorAll(':scope > dl > div')].map((row) => [row.querySelector('dt')?.textContent.trim(), row.querySelector('dd')?.textContent.trim()]));
    const row = section.querySelector('.kordynV2MobilePositionRow');
    return {
      rawMirrorCount:window.__kordynV2RawPositionMirrorCount,
      facts,
      positionRows:section.querySelectorAll('.kordynV2MobilePositionRow').length,
      symbol:row?.querySelector('span:nth-child(2) strong')?.textContent.trim() || null,
      quantity:row?.querySelector('span:nth-child(2) small')?.textContent.trim() || null,
      notional:row?.querySelector('span:nth-child(3) strong')?.textContent.trim() || null,
      fabricatesZero:[...section.querySelectorAll('dd, strong')].some((node) => node.textContent.trim() === '0.00'),
      actions:window.__kordynV2BrowserCalls.actions
    };
  })()`);
  contractEqual("server overview projection dedupes REST/WS/engine mirrors before real Root Account Impact", positionImpact, {
    rawMirrorCount: 3,
    facts: { "持仓数量": "1", "总持仓价值": "3,400.00", "未实现盈亏": "123.45" },
    positionRows: 1,
    symbol: "BTC/USDT",
    quantity: "多 · 0.05",
    notional: "3,400.00",
    fabricatesZero: false,
    actions: 0
  });

  await setViewport(cdp, `${pageUrl}?scenario=recent-partial`, 390, 844, "mobile");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-recent]')", "partial Recent projection");
  const recent = await evaluate(cdp, `(() => {
    const section = document.querySelector('[data-kordyn-v2-mobile-recent]');
    const warning = section?.querySelector('[data-kordyn-v2-recent-partial-warning]');
    const row = section?.querySelector(':scope > div');
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    return {
      completeness:section?.getAttribute('data-kordyn-v2-recent-completeness') || null,
      warning:warning?.textContent.trim() || null,
      warningVisible:visible(warning),
      rows:section?.querySelectorAll(':scope > div').length || 0,
      rowVisible:visible(row),
      actions:window.__kordynV2BrowserCalls.actions
    };
  })()`);
  contractEqual("partial Recent keeps known rows but visibly discloses unavailable completeness", recent, {
    completeness: "unavailable",
    warning: "Unavailable",
    warningVisible: true,
    rows: 1,
    rowVisible: true,
    actions: 0
  });

  await setViewport(cdp, `${pageUrl}?scenario=mission-empty`, 390, 844, "mobile");
  await waitForExpression(cdp, "document.querySelector('.kordynV2MobileMissionStages')", "unavailable mobile stage projection");
  const unavailable = await readMobileGeometry(cdp);
  contractEqual("unavailable mobile stages preserve canonical order without positive connectors", unavailable.foundation.stageProjection.map(({ id, label, status, connector }) => ({ id, label, status, connector })), [
    { id: "sense", label: "快扫", status: "unavailable", connector: "unavailable" },
    { id: "plan", label: "结构", status: "unavailable", connector: "unavailable" },
    { id: "guard", label: "风控", status: "unavailable", connector: "unavailable" },
    { id: "execute", label: "执行", status: "unavailable", connector: "unavailable" },
    { id: "monitor", label: "等待回踩", status: "unavailable", connector: "none" }
  ]);
  const unavailablePaint = unavailable.foundation.stageProjection.slice(0, -1).map((stage) => stage.connectorPaint);
  contractTrue("unavailable mobile connectors are painted uniformly non-positive", new Set(unavailablePaint).size === 1, `received ${JSON.stringify(unavailablePaint)}`);

  await setViewport(cdp, `${pageUrl}?scenario=facts-unknown`, 390, 844, "mobile");
  await waitForExpression(cdp, "document.querySelector('.kordynV2MobileMissionStages')", "partial mobile stage projection");
  const partial = await readMobileGeometry(cdp);
  contractEqual("partial mobile stages bind only their real canonical statuses", partial.foundation.stageProjection.map(({ id, label, status, connector }) => ({ id, label, status, connector })), [
    { id: "sense", label: "快扫", status: "blocked", connector: "blocked" },
    { id: "plan", label: "结构", status: "complete", connector: "complete" },
    { id: "guard", label: "风控", status: "unavailable", connector: "unavailable" },
    { id: "execute", label: "执行", status: "waiting", connector: "unavailable" },
    { id: "monitor", label: "等待回踩", status: "complete", connector: "none" }
  ]);
  contractEqual("canonical waiting is translated in the Chinese Mobile Mission while semantics stay waiting", partial.foundation.stageProjection.find((stage) => stage.id === "execute"), {
    ...partial.foundation.stageProjection.find((stage) => stage.id === "execute"),
    statusText: "等待",
    status: "waiting"
  });
}

async function verifyMobileEvidenceRefreshSnapshot(cdp, pageUrl) {
  await setViewport(cdp, `${pageUrl}?scenario=evidence-refresh`, 390, 844, "mobile");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2SelectedId === 'watch-evidence-rev-a'", "initial evidence selection revision A");
  await click(cdp, '[data-kordyn-v2-mobile-evidence-trigger]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet=evidence]')", "revision A evidence sheet");
  await evaluate(cdp, "window.__kordynV2ApplyLiveRefresh()");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2SelectedId === 'watch-evidence-rev-b'", "background selection refreshes to revision B");

  const readEvidence = async () => await evaluate(cdp, `(() => ({
    shellSelectedId:document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2SelectedId || null,
    identity:document.querySelector('.kordynV2MobileSheetIdentity')?.textContent.trim() || null,
    active:document.querySelector('[data-kordyn-v2-evidence-tab][aria-selected=true]')?.getAttribute('data-kordyn-v2-evidence-tab') || null,
    details:[...document.querySelectorAll('.kordynV2MobileDecisionFacts dd')].map((node) => node.textContent.trim()),
    context:Object.fromEntries([...document.querySelectorAll('.kordynV2MobileContextFacts > div')].map((row) => [row.querySelector('dt')?.textContent.trim(), row.querySelector('dd')?.textContent.trim()])),
    proof:[...document.querySelectorAll('.kordynV2MobileProofStages li')].map((row) => row.textContent.trim()),
    inert:document.querySelector('[data-kordyn-v2-mobile-background]')?.hasAttribute('inert') || false,
    actions:window.__kordynV2BrowserCalls.actions
  }))()`);

  contractEqual("open evidence keeps one immutable selection snapshot after live Root refresh", await readEvidence(), {
    shellSelectedId: "watch-evidence-rev-b",
    identity: "Watch / watch-evidence-rev-a",
    active: "details",
    details: ["Immutable Strategy A", "Immutable Knowledge A", "行情 A / 风控 A", "A window", "Unavailable"],
    context: {},
    proof: [],
    inert: true,
    actions: 0
  });
  await click(cdp, '[data-kordyn-v2-evidence-tab="context"]');
  const contextA = await readEvidence();
  contractEqual("open evidence Context retains revision A", {
    identity: contextA.identity,
    object: contextA.context["对象"],
    version: contextA.context["版本"],
    actions: contextA.actions
  }, { identity: "Watch / watch-evidence-rev-a", object: "watch-evidence-rev-a", version: "revision-a", actions: 0 });
  await click(cdp, '[data-kordyn-v2-evidence-tab="proof"]');
  const proofA = await readEvidence();
  contractEqual("open evidence Proof retains revision A", {
    identity: proofA.identity,
    ownsA: proofA.proof.some((row) => row.includes("Immutable proof A")),
    ownsB: proofA.proof.some((row) => row.includes("Fresh proof B")),
    actions: proofA.actions
  }, { identity: "Watch / watch-evidence-rev-a", ownsA: true, ownsB: false, actions: 0 });
  await pressKey(cdp, "Escape");
  await waitForExpression(cdp, "!document.querySelector('[data-kordyn-v2-mobile-sheet]') && document.activeElement === document.querySelector('[data-kordyn-v2-mobile-evidence-trigger]')", "snapshot evidence focus return");
  await click(cdp, '[data-kordyn-v2-mobile-evidence-trigger]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet=evidence]')", "reopened revision B evidence sheet");
  const reopened = await readEvidence();
  contractEqual("reopened evidence atomically adopts refreshed revision B", {
    identity: reopened.identity,
    details: reopened.details,
    inert: reopened.inert,
    actions: reopened.actions
  }, {
    identity: "Watch / watch-evidence-rev-b",
    details: ["Fresh Strategy B", "Fresh Knowledge B", "行情 B / 风控 B", "B window", "Unavailable"],
    inert: true,
    actions: 0
  });
  await pressKey(cdp, "Escape");

  await setViewport(cdp, `${pageUrl}?scenario=evidence-refresh-null`, 390, 844, "mobile");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2SelectedId === 'none'", "initial null evidence selection");
  await click(cdp, '[data-kordyn-v2-mobile-evidence-trigger]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet=evidence]')", "null-selection evidence sheet");
  await evaluate(cdp, "window.__kordynV2ApplyLiveRefresh()");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2SelectedId === 'watch-evidence-rev-b'", "null-selection background refresh");
  contractEqual("explicit null evidence snapshot never falls through to a later live selection", await evaluate(cdp, `(() => ({
    identity:document.querySelector('.kordynV2MobileSheetIdentity')?.textContent.trim() || null,
    details:[...document.querySelectorAll('.kordynV2MobileDecisionFacts dd')].map((node) => node.textContent.trim()),
    inert:document.querySelector('[data-kordyn-v2-mobile-background]')?.hasAttribute('inert') || false,
    actions:window.__kordynV2BrowserCalls.actions
  }))()`), {
    identity: "Unavailable / Unavailable",
    details: ["Unavailable", "Unavailable", "Unavailable", "Unavailable", "Unavailable"],
    inert: true,
    actions: 0
  });
  await pressKey(cdp, "Escape");
}

async function verifyMobileSelectionDisclosure(cdp, pageUrl) {
  await setViewport(cdp, `${pageUrl}?scenario=selection-outside-slice`, 390, 844, "mobile");
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-attention-target=watch-canonical-outside]')", "outside-slice canonical attention target");
  await click(cdp, '[data-kordyn-v2-attention-target="watch-canonical-outside"]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2SelectedId === 'watch-canonical-outside'", "outside-slice canonical selection");

  const mission = await evaluate(cdp, `(() => ({
    selectedId:document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2SelectedId || null,
    symbol:document.querySelector('.kordynV2MobileMissionSymbol')?.textContent.trim() || null,
    title:document.querySelector('.kordynV2MobileMissionCopy strong')?.textContent.trim() || null,
    signal:document.querySelector('.kordynV2MobileMissionCopy small')?.textContent.trim() || null,
    facts:[...document.querySelectorAll('.kordynV2MobileMissionFacts dd')].map((node) => node.textContent.trim()),
    stages:[...document.querySelectorAll('.kordynV2MobileMissionStages > div')].map((node) => [node.getAttribute('data-stage-id'),node.getAttribute('data-stage-state')]),
    actions:window.__kordynV2BrowserCalls.actions
  }))()`);
  contractEqual("explicit outside-slice selection owns the visible Mission projection", mission, {
    selectedId: "watch-canonical-outside",
    symbol: "LIN",
    title: "LINK canonical outside-slice Mission",
    signal: "Canonical LINK thesis from the explicit selection",
    facts: ["normal", "Canonical Strategy 11", "CPI · 12h"],
    stages: [["sense", "complete"], ["plan", "complete"], ["guard", "complete"], ["execute", "waiting"], ["monitor", "waiting"]],
    actions: 0
  });

  await click(cdp, '[data-kordyn-v2-mobile-evidence-trigger]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-mobile-sheet=evidence]')", "outside-slice governed Details");
  const readDisclosure = async () => await evaluate(cdp, `(() => ({
    selectedId:document.querySelector('[data-kordyn-v2-shell=mobile]')?.dataset.kordynV2SelectedId || null,
    identity:document.querySelector('.kordynV2MobileSheetIdentity')?.textContent.trim() || null,
    active:document.querySelector('[data-kordyn-v2-evidence-tab][aria-selected=true]')?.getAttribute('data-kordyn-v2-evidence-tab') || null,
    facts:[...document.querySelectorAll('.kordynV2MobileDecisionFacts > div')].map((row) => [row.querySelector('dt')?.textContent.trim(),row.querySelector('dd')?.textContent.trim()]),
    proofOwnsSelection:["Canonical target sense","Canonical target plan","Canonical target guard","Canonical target execute"].every((value) => [...document.querySelectorAll('.kordynV2MobileProofStages li small')].some((node) => node.textContent.trim() === value)),
    proofContainsUnrelated:[...document.querySelectorAll('.kordynV2MobileProofStages li small')].some((node) => node.textContent.includes('Unrelated visible row')),
    actions:window.__kordynV2BrowserCalls.actions
  }))()`);
  contractEqual("governed Details uses exactly the outside-slice canonical selection", await readDisclosure(), {
    selectedId: "watch-canonical-outside",
    identity: "Watch / watch-canonical-outside",
    active: "details",
    facts: [
      ["策略", "Canonical Strategy 11"],
      ["知识来源", "Canonical Knowledge 11"],
      ["能力", "行情 / 市场结构 / 审计"],
      ["事件", "CPI · 12h"],
      ["持仓影响", "short 3.5"]
    ],
    proofOwnsSelection: false,
    proofContainsUnrelated: false,
    actions: 0
  });

  await click(cdp, '[data-kordyn-v2-evidence-tab="context"]');
  contractEqual("governed Context preserves the outside-slice canonical identity", await readDisclosure(), {
    selectedId: "watch-canonical-outside",
    identity: "Watch / watch-canonical-outside",
    active: "context",
    facts: [],
    proofOwnsSelection: false,
    proofContainsUnrelated: false,
    actions: 0
  });

  await click(cdp, '[data-kordyn-v2-evidence-tab="proof"]');
  contractEqual("governed Proof preserves the outside-slice canonical identity and trace", await readDisclosure(), {
    selectedId: "watch-canonical-outside",
    identity: "Watch / watch-canonical-outside",
    active: "proof",
    facts: [],
    proofOwnsSelection: true,
    proofContainsUnrelated: false,
    actions: 0
  });
  await pressKey(cdp, "Escape");
}

async function verifyDesktopLongContentSupport(cdp, pageUrl) {
  await setViewport(cdp, `${pageUrl}?scenario=support-long-content`, 1440, 900, "desktop");
  await click(cdp, '[data-kordyn-v2-ai-support-trigger]');
  await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-ai-support-panel]')", "desktop long-content support opens");
  const result = await evaluate(cdp, `(() => {
    const panel = document.querySelector('[data-kordyn-v2-ai-support-panel]');
    const state = panel?.querySelector('[data-kordyn-v2-ai-support-state]');
    const scroll = panel?.querySelector('[data-kordyn-v2-ai-support-scroll]');
    return {
      kind:state?.getAttribute('data-kordyn-v2-ai-support-state') || null,
      explanation:state?.textContent?.includes('完整权威内容已经加载') || false,
      facts:panel?.textContent?.includes('regional failover checkpoint') || false,
      scroll:scroll ? [scroll.clientHeight,scroll.scrollHeight] : [0,0],
      actions:window.__kordynV2BrowserCalls.actions
    };
  })()`);
  assert.equal(result.kind, "long-content", "desktop long-content support keeps production state identity");
  assert.equal(result.explanation, true, "desktop long-content support uses its accurate product explanation");
  assert.equal(result.facts, true, "desktop long-content support keeps authorized visible facts");
  assert.ok(result.scroll[1] > result.scroll[0], "desktop long-content support scrolls inside its bounded panel");
  assert.equal(result.actions, 0, "desktop long-content support remains zero-write");
  await pressKey(cdp, "Escape");
  return result;
}

async function verifyMobileLongContentSupport(cdp, pageUrl, width, height) {
  await setViewport(cdp, `${pageUrl}?scenario=support-long-content`, width, height, "mobile");
  await click(cdp, '[data-kordyn-v2-ai-support-trigger]');
  const navTop = (await readMobileGeometry(cdp)).nav.top;
  const sheetContract = await assertMobileSheet(cdp, width, navTop, "support");
  const result = await evaluate(cdp, `(() => {
    const root = document.querySelector('[data-kordyn-v2-shell=mobile]');
    const sheet = document.querySelector('[data-kordyn-v2-mobile-sheet="support"]');
    const state = sheet?.querySelector('[data-kordyn-v2-ai-support-state]');
    const scroll = sheet?.querySelector('.kordynV2MobileSheetScroll');
    const values = [...sheet.querySelectorAll('.kordynV2AiSupportFacts dd')];
    const navigationMeta = [...sheet.querySelectorAll('.kordynV2AiSupportSuggestions small')];
    const fontSize = (node) => node ? Number.parseFloat(getComputedStyle(node).fontSize) : 0;
    return {
      kind:state?.getAttribute('data-kordyn-v2-ai-support-state') || null,
      explanation:state?.textContent?.includes('完整权威内容已经加载') || false,
      facts:sheet?.textContent?.includes('regional failover checkpoint') || false,
      factsMin:Math.min(...values.map(fontSize)),
      navigationMin:Math.min(...navigationMeta.map(fontSize)),
      textOverflows:[...values,...navigationMeta].filter((node) => node.scrollWidth > node.clientWidth + 1).length,
      scroll:scroll ? [scroll.clientHeight,scroll.scrollHeight] : [0,0],
      document:[document.documentElement.clientWidth,document.documentElement.scrollWidth],
      roots:root?.querySelectorAll('[data-kordyn-v2-mobile-navigation] [data-kordyn-v2-domain-target]').length || 0,
      actions:window.__kordynV2BrowserCalls.actions
    };
  })()`);
  assert.equal(result.kind, "long-content", `${width}: APP long-content support keeps production state identity`);
  assert.equal(result.explanation, true, `${width}: APP long-content support uses its accurate product explanation`);
  assert.equal(result.facts, true, `${width}: APP long-content support keeps authorized visible facts`);
  assert.ok(result.factsMin >= 11 && result.navigationMin >= 11, `${width}: APP long-content facts and navigation remain readable`);
  assert.equal(result.textOverflows, 0, `${width}: APP long source and navigation values wrap without horizontal overflow`);
  assert.ok(result.scroll[1] > result.scroll[0] && sheetContract.sheetScroll.scrollHeight > sheetContract.sheetScroll.clientHeight, `${width}: APP long-content support scrolls inside the governed sheet`);
  assert.deepEqual(result.document, [width, width], `${width}: APP long-content has no document overflow`);
  assert.equal(result.roots, 4, `${width}: APP long-content retains four roots`);
  assert.equal(result.actions, 0, `${width}: APP long-content support remains zero-write`);
  await evaluate(cdp, `(() => {
    const content = document.querySelector('[data-kordyn-v2-mobile-sheet="support"] .kordynV2MobileSheetScroll');
    if (content) content.scrollTop = 0;
  })()`);
  const screenshot = await captureMobile(cdp, width, height, `mobile-${width}x${height}-ai-support-long-content.png`);
  await pressKey(cdp, "Escape");
  return { ...result, screenshot };
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
    await exited;
  }
}

assert.ok(!requestedMobileOnly || !requestedDesktopOnly, "choose at most one of --desktop-only or --mobile-only");
await initializeCaptureEvidence();
const vitePort = await freePort();
const chromePort = await freePort();
const pageUrl = `http://127.0.0.1:${vitePort}/tests/kordyn-v2-shell-browser.html`;
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-shell-"));
const viteBin = path.join(rootDir, "node_modules", "vite", "bin", "vite.js");
const vite = spawn(process.execPath, [viteBin, "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
  cwd: rootDir,
  stdio: "ignore"
});
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--disable-background-networking",
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
  await waitFor(pageUrl);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connectCdp(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);

  if (mobileOnly) {
    const transition = await verifyViewportTransition(cdp, pageUrl);
    await verifyLegacyStyleOwnershipProbe(cdp, readMobileGeometry, "mobile stylesheet ownership probe");
    const mobileResults = [];
    for (const [width, height] of mobileViewports) {
      mobileResults.push(await verifyMobileViewport(cdp, pageUrl, width, height));
    }
    await verifyMobileStates(cdp, pageUrl);
    await verifyMobileReviewStates(cdp, pageUrl);
    await verifyMobileSelectionDisclosure(cdp, pageUrl);
    await verifyMobileEvidenceRefreshSnapshot(cdp, pageUrl);
    const longContentResults = [];
    for (const [width, height] of mobileViewports) {
      longContentResults.push(await verifyMobileLongContentSupport(cdp, pageUrl, width, height));
    }
    assert.equal(
      contractFailures.length,
      0,
      `KORDYN V2 Task5 mobile semantic contract failures:\n- ${contractFailures.join("\n- ")}`
    );
    process.stdout.write(`KORDYN V2 mobile shell browser PASS ${mobileResults.map((row) => `${row.width}x${row.height}:nav=4,focus=3,overflow=0,targets=44`).join(" ")} states=5 long-content=${longContentResults.length} screenshots=${mobileResults.filter((row) => row.baseScreenshot.outputPath).length + mobileResults.filter((row) => row.sheetScreenshot?.outputPath).length + mobileResults.filter((row) => row.supportScreenshot?.outputPath).length + longContentResults.filter((row) => row.screenshot?.outputPath).length}\n`);
    process.stdout.write(`KORDYN V2 mobile geometry ${mobileResults.map((row) => `${row.width}:stateBottom=${Math.round(row.base.state.bottom)},navTop=${Math.round(row.base.nav.top)},reserve=${Math.round(row.base.paddingBottom)},workspaceMin=${row.minimumWorkspaceTarget.toFixed(1)},headerBottom=${Math.round(row.base.foundation.header.bottom)},missionTop=${Math.round(row.base.foundation.mission.top)},needsTop=${Math.round(row.base.foundation.needsYou.top)},impactTop=${Math.round(row.base.foundation.accountImpact.top)},recentTop=${Math.round(row.base.foundation.recent.top)},recentRowsBottom=${Math.round(row.base.foundation.recentRows[1].bottom)},promptTop=${Math.round(row.base.foundation.prompt.top)},sheet=${Math.round(row.proof.sheet.top)}-${Math.round(row.proof.sheet.bottom)},proofScroll=${row.proof.sheetScroll.clientHeight}/${row.proof.sheetScroll.scrollHeight}`).join(" | ")} transition=${transition.domain}/${transition.workspace}:${transition.sections.map((item) => item.section).join(",")}\n`);
  } else {
  await setViewport(cdp, pageUrl, 1440, 900);
  await verifyLegacyStyleOwnershipProbe(cdp, readGeometry, "desktop stylesheet ownership probe");
  const results = [];
  for (const [width, height] of desktopViewports) {
    await setViewport(cdp, pageUrl, width, height);

    const navigation = [];
    for (const [domain, workspace] of domains) {
      await click(cdp, `[data-kordyn-v2-domain-target="${domain}"]`);
      await waitForExpression(
        cdp,
        `document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Domain === '${domain}' && document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Workspace === '${workspace}'`,
        `${width}: ${domain}/${workspace} navigation`
      );
      const active = await evaluate(cdp, `(() => {
        const root = document.querySelector('[data-kordyn-v2-shell=desktop]');
        return [
          root.querySelectorAll('[data-kordyn-v2-domain-target][aria-current="page"]').length,
          root.querySelectorAll('[data-kordyn-v2-workspace-target][aria-current="page"]').length
        ];
      })()`);
      assert.deepEqual(active, [1, 1], `${width}: ${domain} has one global and local active target`);
      navigation.push(`${domain}/${workspace}`);
    }

    if (width === 1440) {
      await verifyDestinations(cdp, width);
      await verifyUrgentSelection(cdp, width);
    }

    await click(cdp, '[data-kordyn-v2-domain-target="ai"]');
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Workspace === 'missions'", `${width}: return to AI missions`);
    await click(cdp, '[data-kordyn-v2-object-target="watch-eth-retest"]');
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2SelectedId === 'watch-eth-retest'", `${width}: pinned visual object selection`);
    await verifyDefaultMissionStages(cdp, width);
    await verifyDialog(cdp, "context");
    await verifyDialog(cdp, "proof");

    const geometry = await readGeometry(cdp);
    assert.deepEqual(geometry.document, [width, width], `${width}: no document overflow`);
    assert.deepEqual(geometry.viewport, [width, height], `${width}: viewport retained`);
    assert.equal(geometry.activeDomains, 1, `${width}: one active global target`);
    assert.equal(geometry.activeWorkspaces, 1, `${width}: one active local target`);
    assert.equal(geometry.domain, "ai");
    assert.equal(geometry.workspace, "missions");
    assert.notEqual(geometry.selectedId, "none", `${width}: canonical selection published`);
    assert.equal(geometry.actions, 0, `${width}: no production action invoked`);
    assert.equal(geometry.legacyStyles, false, `${width}: no legacy product stylesheet`);
    assert.deepEqual(
      [Math.round(geometry.root.width), Math.round(geometry.root.height)],
      [width, height],
      `${width}: shell fills viewport`
    );
    assert.ok(geometry.primary.width >= 138 && geometry.primary.height === height, `${width}: primary navigation retained`);
    assert.ok(geometry.local.height >= 49 && geometry.truth.height >= 61, `${width}: both navigation levels visible`);
    assert.ok(geometry.localButtons.length >= 5 && geometry.localButtons.every((button) => button.width > 0 && button.bottom <= geometry.local.bottom + 1), `${width}: local targets visible`);
    assert.ok(geometry.canvas.scrollWidth <= geometry.canvas.clientWidth + 1, `${width}: canvas width contained`);
    assert.ok(geometry.mission.width > 0 && geometry.mission.height > 0, `${width}: mission canvas rendered`);
    await verifyFidelityLandmarks(cdp, geometry, width, height);
    const supportScreenshot = await verifyDesktopAiSupport(cdp, width, height);

    const screenshot = await capture(cdp, width, height);
    recordCaptureEvidence({
      file: `desktop-${width}x${height}.png`,
      viewport: `${width}x${height}`,
      device: "desktop",
      width,
      height,
      sha256: screenshot.sha256,
      geometry
    });
    contractTrue(
      `${width}: pinned-reference weighted RGB MAE stays within the fidelity floor`,
      screenshot.metric <= screenshot.threshold,
      `metric=${screenshot.metric.toFixed(6)} threshold=${screenshot.threshold.toFixed(6)} regions=${JSON.stringify(Object.fromEntries(Object.entries(screenshot.regions).map(([name, value]) => [name, Number(value.toFixed(6))])))}`
    );
    contractTrue(
      `${width}: combined pinned-reference visual contract rejects structure-free frames`,
      screenshot.accepted,
      `maeAccepted=${screenshot.maeAccepted} structure=${JSON.stringify(Object.fromEntries(Object.entries(screenshot.structure.regions).map(([name, value]) => [name, {
        accepted:value.accepted,
        luminance:Number(value.luminanceVarianceRatio.toFixed(4)),
        color:Number(value.colorVarianceRatio.toFixed(4)),
        edge:Number(value.edgeCosine.toFixed(4)),
        density:Number(value.edgeDensityRatio.toFixed(4))
      }])))}`
    );
    for (const name of ["identity-rail", "workbench-footer", "command-bar", "support"]) {
      contractTrue(
        `${width}: ${name} screenshot region retains nontrivial painted structure`,
        screenshot.structure.regions[name]?.accepted,
        `received ${JSON.stringify(screenshot.structure.regions[name])}`
      );
    }
    results.push({ width, height, navigation, geometry, screenshot, supportScreenshot });
  }

  await verifyUnknownMission(cdp, pageUrl);
  await verifyUnresolvedAttention(cdp, pageUrl);
  await verifyUnknownQueue(cdp, pageUrl);
  await verifyAttentionCompleteness(cdp, pageUrl);
  await verifyHealth(cdp, pageUrl, "default", {
    connection: "mint", runtime: "mint", risk: "mint", realtime: "mint"
  });
  await verifyHealth(cdp, pageUrl, "health-adverse", {
    connection: "danger", runtime: "danger", risk: "danger", realtime: "danger"
  });
  await verifyHealth(cdp, pageUrl, "health-missing", {
    connection: "mint", runtime: "unavailable", risk: "unavailable", realtime: "unavailable"
  });
  await verifyHealth(cdp, pageUrl, "health-pending", {
    connection: "mint", runtime: "mint", risk: "unavailable", realtime: "unavailable"
  });
  await verifyHealth(cdp, pageUrl, "health-novel", {
    connection: "mint", runtime: "mint", risk: "unavailable", realtime: "unavailable"
  });
  await verifyHealth(cdp, pageUrl, "health-stale", {
    connection: "mint", runtime: "mint", risk: "mint", realtime: "danger"
  });
  await verifyHealth(cdp, pageUrl, "health-unknown", {
    connection: "unavailable", runtime: "unavailable", risk: "unavailable", realtime: "unavailable"
  });
  await verifyContradictionHealth(cdp, pageUrl);
  const longContentSupport = await verifyDesktopLongContentSupport(cdp, pageUrl);
  let independentHero = null;
  if (screenshotDir) {
    await setViewport(cdp, pageUrl, 1440, 900);
    await waitForExpression(
      cdp,
      "document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2SelectedId === 'watch-eth-retest'",
      "independent 1440 evidence selection"
    );
    independentHero = await capture(cdp, 1440, 900, "hero-repro.png");
    contractTrue(
      "independent 1440 evidence meets pinned-reference fidelity floor",
      independentHero.accepted,
      `metric=${independentHero.metric.toFixed(6)} threshold=${independentHero.threshold.toFixed(6)} structure=${independentHero.structure.accepted}`
    );
  }
  assert.equal(
    contractFailures.length,
    0,
    `KORDYN V2 Task4 semantic contract failures:\n- ${contractFailures.join("\n- ")}`
  );

  process.stdout.write(`KORDYN V2 desktop shell browser PASS ${results.map((row) => `${row.width}x${row.height}:nav=4,focus=3,overflow=0,mae=${row.screenshot.metric.toFixed(6)}`).join(" ")} long-content=${longContentSupport.kind} screenshots=${results.filter((row) => row.screenshot.outputPath).length + results.filter((row) => row.supportScreenshot?.outputPath).length + (independentHero?.outputPath ? 1 : 0)}${independentHero ? ` hero-mae=${independentHero.metric.toFixed(6)}` : ""}\n`);
  process.stdout.write(`KORDYN V2 landmarks ${results.map((row) => {
    const { identity, notification, workbenchFooter, prompt, assistant, runtime, evidenceDock, decisionSummary } = row.geometry.landmarks;
    const box = (value) => [value.left, value.top, value.right, value.bottom].map(Math.round).join(",");
    return `${row.width}:identity=${box(identity)} notification=${box(notification)} footer=${box(workbenchFooter)} continuity=${Math.round(workbenchFooter.top - decisionSummary.bottom)} prompt=${box(prompt)} assistant=${box(assistant)} runtime-gap=${Math.round(evidenceDock.left - runtime.right)}`;
  }).join(" | ")}\n`);
  process.stdout.write(`KORDYN V2 structure ${results.map((row) => `${row.width}:${Object.entries(row.screenshot.structure.regions).map(([name, value]) => `${name}=l${value.luminanceVarianceRatio.toFixed(3)}/c${value.colorVarianceRatio.toFixed(3)}/e${value.edgeCosine.toFixed(3)}/d${value.edgeDensityRatio.toFixed(3)}`).join(",")}`).join(" | ")}\n`);
  }
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

await writeCaptureEvidence();

if (runMobileAfterDesktop) {
  const mobile = spawn(process.execPath, [fileURLToPath(import.meta.url), "--mobile-only"], {
    cwd: rootDir,
    env: process.env,
    stdio: "inherit"
  });
  const status = await new Promise((resolve, reject) => {
    mobile.once("error", reject);
    mobile.once("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });
  assert.equal(status, 0, "combined shell capture mobile phase");
}
