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
  const virtualKey = ({ Enter: 13, Escape: 27, Tab: 9 })[key] || 0;
  const modifiers = shift ? 8 : 0;
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: virtualKey, modifiers });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: virtualKey, modifiers });
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

async function capture(cdp, width, height) {
  if (!screenshotDir) return null;
  await mkdir(screenshotDir, { recursive: true });
  const result = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false
  });
  const bytes = Buffer.from(result.data, "base64");
  const metadata = await sharp(bytes).metadata();
  assert.deepEqual([metadata.width, metadata.height], [width, height], `${width}: screenshot dimensions`);
  const outputPath = path.join(screenshotDir, `desktop-${width}x${height}.png`);
  await writeFile(outputPath, bytes);
  return outputPath;
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
      legacyStyles:[...document.styleSheets].some((sheet) => /styles\.css|productStyles/i.test(sheet.href || ""))
    };
  })()`);
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

    await click(cdp, '[data-kordyn-v2-domain-target="ai"]');
    await waitForExpression(cdp, "document.querySelector('[data-kordyn-v2-shell=desktop]')?.dataset.kordynV2Workspace === 'missions'", `${width}: return to AI missions`);
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

    const screenshot = await capture(cdp, width, height);
    results.push({ width, height, navigation, geometry, screenshot });
  }

  process.stdout.write(`KORDYN V2 desktop shell browser PASS ${results.map((row) => `${row.width}x${row.height}:nav=4,focus=2,overflow=0`).join(" ")} screenshots=${results.filter((row) => row.screenshot).length}\n`);
} finally {
  cdp?.close();
  await Promise.all([stopProcess(chrome), stopProcess(vite)]);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
