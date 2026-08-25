import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

const chromeBinary = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const baseUrl = process.env.KORDYN_VISUAL_BASE_URL || "http://127.0.0.1:5178/";
const outputDir = process.env.KORDYN_VISUAL_OUTPUT_DIR || path.join(os.tmpdir(), "kordyn-event-risk-visual");

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
    await new Promise((resolve) => setTimeout(resolve, 100));
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
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  return result.result.value;
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
    await exited;
  }
}

async function trustedClick(cdp, selector, text = "") {
  const point = await evaluate(cdp, `(() => {
    const matches = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const target = matches.find((node) => !${JSON.stringify(text)} || node.textContent.includes(${JSON.stringify(text)}));
    if (!target) throw new Error(${JSON.stringify(`Missing click target: ${selector} ${text}`)});
    target.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await new Promise((resolve) => setTimeout(resolve, 120));
}

async function waitForSelector(cdp, selector) {
  const deadline = Date.now() + 20_000;
  while (!await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${selector}`);
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

async function setViewport(cdp, width, height, mobile) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height
  });
  await cdp.send("Page.navigate", { url: baseUrl });
  await waitForSelector(cdp, mobile ? ".mShell2.kordynSystem" : ".appShell.kordynSystem");
}

async function capture(cdp, name) {
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const file = path.join(outputDir, name);
  await writeFile(file, Buffer.from(screenshot.data, "base64"));
  return file;
}

async function openDesktopEventRisk(cdp) {
  await trustedClick(cdp, '[data-zero-base-family="guard"]');
  await waitForSelector(cdp, '[data-product-workspace="control"]');
  await trustedClick(cdp, '.zbSubnav [data-zero-base-view="events"]');
  await waitForSelector(cdp, '.productWorkspace [data-surface-role="event-risk"]');
}

async function openMobileEventRisk(cdp) {
  await trustedClick(cdp, '[data-zero-base-mobile-root-target="more"]');
  await waitForSelector(cdp, '[data-zero-base-mobile-surface="more-hub"]');
  await trustedClick(cdp, '[data-zero-base-mobile-family-target="guard"]');
  await waitForSelector(cdp, '[data-zero-base-mobile-local-nav="guard"]');
  await trustedClick(cdp, '[data-zero-base-mobile-view-target="events"]');
  await waitForSelector(cdp, '.mEventRiskScreen[data-surface-role="event-risk"]');
}

function geometryExpression(kind) {
  const tabs = kind === "mobile" ? '[data-zero-base-mobile-local-nav="guard"] nav' : ".zbSubnav";
  const tabButtons = kind === "mobile" ? ":scope > button" : "button[data-zero-base-view]";
  const actions = kind === "mobile" ? ".mEventRiskActions" : ".eventRiskActions";
  const surface = kind === "mobile" ? ".mEventRiskScreen" : ".eventRiskWorkbench";
  return `(() => {
    const tabs = document.querySelector(${JSON.stringify(tabs)});
    const actions = document.querySelector(${JSON.stringify(actions)});
    const surface = document.querySelector(${JSON.stringify(surface)});
    const box = (node) => node ? ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      left: Math.round(node.getBoundingClientRect().left),
      right: Math.round(node.getBoundingClientRect().right)
    }) : null;
    const actionBox = actions?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      tabs: box(tabs),
      tabCount: tabs?.querySelectorAll(${JSON.stringify(tabButtons)}).length || 0,
      tabButtons: [...(tabs?.querySelectorAll(${JSON.stringify(tabButtons)}) || [])].map(box),
      surface: box(surface),
      actions: box(actions),
      actionCount: actions?.querySelectorAll(":scope > button").length || 0,
      actionButtons: [...(actions?.querySelectorAll(":scope > button") || [])].map((node) => {
        const rect = node.getBoundingClientRect();
        return { clientWidth: node.clientWidth, scrollWidth: node.scrollWidth, left: Math.round(rect.left), right: Math.round(rect.right), contained: !actionBox || (rect.left >= actionBox.left - .5 && rect.right <= actionBox.right + .5) };
      }),
      mobileContract: ${kind === "mobile" ? `(() => {
        const shell = document.querySelector(".mShell2.kordynSystem");
        const active = [...document.querySelectorAll('[data-zero-base-mobile-local-nav="guard"] [data-zero-base-mobile-view-target][aria-current="page"]')];
        return {
          route: shell?.dataset.shellRoute,
          subPage: shell?.dataset.shellSubpage,
          activeCount: active.length,
          activeText: active[0]?.textContent.trim(),
          activeCurrent: active[0]?.getAttribute("aria-current"),
          innerHubTabs: document.querySelectorAll(".mHub .mHubTabs").length,
          eventRiskContent: Boolean(document.querySelector('.mEventRiskScreen[data-surface-role="event-risk"] .mEventRiskRegistry') && document.querySelector('.mEventRiskScreen .mEventRiskActions'))
        };
      })()` : "null"}
    };
  })()`;
}

function assertNoOverflow(geometry, label, expectedTabCount) {
  assert.equal(geometry.document.scrollWidth, geometry.document.clientWidth, `${label}: document overflow`);
  assert.equal(geometry.tabCount, expectedTabCount, `${label}: tab count`);
  assert.ok(geometry.tabs.scrollWidth <= geometry.tabs.clientWidth + 1, `${label}: tabs overflow`);
  assert.ok(geometry.surface.scrollWidth <= geometry.surface.clientWidth + 1, `${label}: Event Risk surface overflow`);
  assert.equal(geometry.actionCount, 3, `${label}: action count`);
  assert.ok(geometry.actions.scrollWidth <= geometry.actions.clientWidth + 1, `${label}: action rail overflow`);
  for (const [index, row] of geometry.actionButtons.entries()) {
    assert.ok(row.contained, `${label}: action ${index + 1} escapes its rail`);
    assert.ok(row.scrollWidth <= row.clientWidth + 1, `${label}: action ${index + 1} content overflows`);
  }
}

function assertMobileEventRiskContract(geometry, label) {
  assert.equal(geometry.mobileContract.route, "riskHub", `${label}: canonical Control route`);
  assert.equal(geometry.mobileContract.subPage, "events", `${label}: canonical Event Risk subpage`);
  assert.equal(geometry.mobileContract.activeCount, 1, `${label}: one active Control destination`);
  assert.match(geometry.mobileContract.activeText, /事件|Events/, `${label}: Event Risk destination is active`);
  assert.equal(geometry.mobileContract.activeCurrent, "page", `${label}: active destination exposes aria-current`);
  assert.equal(geometry.mobileContract.innerHubTabs, 0, `${label}: no duplicate inner Hub tabs`);
  assert.equal(geometry.mobileContract.eventRiskContent, true, `${label}: Event Risk registry and actions are rendered`);
}

await rm(outputDir, { recursive: true, force: true });
await import("node:fs/promises").then(({ mkdir }) => mkdir(outputDir, { recursive: true }));
await waitFor(baseUrl);
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-event-risk-production-"));
const chrome = spawn(chromeBinary, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-extensions",
  "--disable-gpu",
  "--no-default-browser-check",
  "--no-first-run",
  `--remote-debugging-port=${chromePort}`,
  `--user-data-dir=${profileDir}`,
  baseUrl
], { stdio: "ignore" });

let cdp;
try {
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  const target = targets.find((row) => row.type === "page");
  cdp = connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  const evidence = [];
  await setViewport(cdp, 1440, 900, false);
  await openDesktopEventRisk(cdp);
  const desktop = await evaluate(cdp, geometryExpression("desktop"));
  assertNoOverflow(desktop, "desktop-1440", 4);
  evidence.push({ label: "desktop-1440", screenshot: await capture(cdp, "desktop-event-risk-1440x900.png"), geometry: desktop });

  for (const [width, height] of [[390, 844], [430, 932]]) {
    await setViewport(cdp, width, height, true);
    await openMobileEventRisk(cdp);
    const geometry = await evaluate(cdp, geometryExpression("mobile"));
    assertNoOverflow(geometry, `app-${width}`, 4);
    assertMobileEventRiskContract(geometry, `app-${width}`);
    evidence.push({ label: `app-${width}`, screenshot: await capture(cdp, `app-event-risk-${width}x${height}.png`), geometry });
  }
  process.stdout.write(`event risk production visual PASS\n${JSON.stringify(evidence, null, 2)}\n`);
} finally {
  cdp?.close();
  await stopProcess(chrome);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
