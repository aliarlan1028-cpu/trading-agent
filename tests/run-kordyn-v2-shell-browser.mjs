import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
const viewports = [[1440, 900], [1180, 800]];
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

async function setViewport(cdp, url, width, height) {
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
    "window.__kordynV2ShellReady && document.querySelector('[data-kordyn-v2-shell=desktop]')",
    `${width}x${height} V2 shell`
  );
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
  return { outputPath, ...fidelity };
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
      legacyStyles:[...document.styleSheets].some((sheet) => /styles\.css|productStyles/i.test(sheet.href || "")),
      landmarks:{
        identity:maybeBox('[data-kordyn-v2-identity]'),
        notification:maybeBox('[data-kordyn-v2-notification]'),
        workbenchFooter:maybeBox('[data-kordyn-v2-workbench-footer]'),
        audit:maybeBox('[data-kordyn-v2-audit-control]'),
        poster:maybeBox('[data-kordyn-v2-poster-control]'),
        assistant:maybeBox('[data-kordyn-v2-assistant-reserve]'),
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
      assistant:read('[data-kordyn-v2-assistant-reserve]'),
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
    `${width}: reserved assistant is truthfully disabled`,
    semantics.assistant?.tag === "BUTTON" && semantics.assistant.disabled && /Unavailable|待开放|只读/i.test(`${semantics.assistant.text} ${semantics.assistant.name}`),
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

assert.ok(process.argv.includes("--desktop-only") || process.argv.length >= 2, "desktop runner invocation");
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

  const results = [];
  for (const [width, height] of viewports) {
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

    const screenshot = await capture(cdp, width, height);
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
    results.push({ width, height, navigation, geometry, screenshot });
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

  process.stdout.write(`KORDYN V2 desktop shell browser PASS ${results.map((row) => `${row.width}x${row.height}:nav=4,focus=2,overflow=0,mae=${row.screenshot.metric.toFixed(6)}`).join(" ")} screenshots=${results.filter((row) => row.screenshot.outputPath).length + (independentHero?.outputPath ? 1 : 0)}${independentHero ? ` hero-mae=${independentHero.metric.toFixed(6)}` : ""}\n`);
  process.stdout.write(`KORDYN V2 landmarks ${results.map((row) => {
    const { identity, notification, workbenchFooter, prompt, assistant, runtime, evidenceDock, decisionSummary } = row.geometry.landmarks;
    const box = (value) => [value.left, value.top, value.right, value.bottom].map(Math.round).join(",");
    return `${row.width}:identity=${box(identity)} notification=${box(notification)} footer=${box(workbenchFooter)} continuity=${Math.round(workbenchFooter.top - decisionSummary.bottom)} prompt=${box(prompt)} assistant=${box(assistant)} runtime-gap=${Math.round(evidenceDock.left - runtime.right)}`;
  }).join(" | ")}\n`);
  process.stdout.write(`KORDYN V2 structure ${results.map((row) => `${row.width}:${Object.entries(row.screenshot.structure.regions).map(([name, value]) => `${name}=l${value.luminanceVarianceRatio.toFixed(3)}/c${value.colorVarianceRatio.toFixed(3)}/e${value.edgeCosine.toFixed(3)}/d${value.edgeDensityRatio.toFixed(3)}`).join(",")}`).join(" | ")}\n`);
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
