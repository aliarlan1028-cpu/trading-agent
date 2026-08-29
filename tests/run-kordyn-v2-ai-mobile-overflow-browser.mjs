import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createServer as createViteServer } from "vite";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outputDir = path.resolve(process.env.KORDYN_V2_MOBILE_OVERFLOW_SCREENSHOT_DIR || "/private/tmp/kordyn-v2-mobile-overflow");
const longTitle = `需要确认：${"BTC 永续合约风险边界与授权证据完整性检查 · ".repeat(420)}`;
const viewports = [
  { width: 390, height: 844 },
  { width: 430, height: 932 }
];

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createNetServer();
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
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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

function fixturePlugin() {
  const virtualId = "virtual:kordyn-v2-mobile-overflow";
  const resolvedId = `\0${virtualId}`;
  const fixture = `
    import React from "react";
    import { createRoot } from "react-dom/client";
    import { MobileAiMissionScreen } from "/src/kordynV2/domains/ai/MobileAiMissionScreen.jsx";
    import "/src/kordynV2/domains/ai/ai.css";
    const longTitle = ${JSON.stringify(longTitle)};
    const mission = {
      id: "run-overflow-regression",
      title: longTitle,
      summary: "保留完整 Mission 事实，同时在移动任务流中限制可视标题宽度。",
      stage: { id: "approval", label: "需要你确认", tone: "warning" },
      evidenceCount: 8,
      nextAction: "核对风险边界后确认计划",
      approval: { planId: "plan-overflow-regression" }
    };
    const model = { missions: [mission] };
    const selection = { object: { id: mission.id, type: "Agent run" }, context: { title: longTitle } };
    createRoot(document.getElementById("root")).render(React.createElement(MobileAiMissionScreen, {
      model,
      selection,
      truth: { risk: "边界内", exposure: "12.4%" }
    }));
    window.__kordynV2MobileOverflowReady = true;
  `;
  return {
    name: "kordyn-v2-mobile-overflow-regression",
    resolveId(id) { return id === virtualId ? resolvedId : null; },
    load(id) { return id === resolvedId ? fixture : null; },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== "/__kordyn-v2-mobile-overflow") return next();
        const html = await server.transformIndexHtml(request.url, `<!doctype html>
          <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>
          *{box-sizing:border-box}:root{--v2-mobile-nav-height:74px}html,body,#root{width:100%;min-height:100%;margin:0}body{background:#07111f;color:#eef5ff;overflow-x:hidden}
          </style></head><body><main id="root"></main><script type="module">import "${virtualId}";</script></body></html>`);
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(html);
      });
    }
  };
}

async function verifyViewport(cdp, baseUrl, { width, height }) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    screenWidth: width,
    screenHeight: height,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Page.navigate", { url: `${baseUrl}/__kordyn-v2-mobile-overflow` });
  await waitForExpression(cdp, "window.__kordynV2MobileOverflowReady && document.querySelector('.kordynV2AiMobileAttention > article > button.kordynV2AiMobileAction > span > strong')", `${width}: actual MobileAiMissionScreen article approval row`);

  const geometry = await evaluate(cdp, `(() => {
    const root = document.querySelector('#root');
    const mobile = document.querySelector('.kordynV2AiMobile');
    const article = document.querySelector('.kordynV2AiMobileAttention > article');
    const action = article.querySelector('button.kordynV2AiMobileAction');
    const label = action.querySelector('span');
    const strong = label.querySelector('strong');
    const support = document.querySelector('.kordynV2AiMobilePrompt');
    const fullTitle = ${JSON.stringify(longTitle)};
    const rect = (node) => { const value = node.getBoundingClientRect(); return { left:value.left, right:value.right, top:value.top, bottom:value.bottom, width:value.width, height:value.height }; };
    const supportRect = rect(support);
    const navTop = innerHeight - 74;
    const supportOverlap = Math.max(0, Math.min(supportRect.bottom, navTop) - Math.max(supportRect.top, navTop));
    return {
      document: [document.documentElement.clientWidth, document.documentElement.scrollWidth],
      root: [root.clientWidth, root.scrollWidth],
      mobile: [mobile.clientWidth, mobile.scrollWidth],
      article: rect(article),
      action: rect(action),
      label: rect(label),
      actionScroll: [action.clientWidth, action.scrollWidth],
      labelScroll: [label.clientWidth, label.scrollWidth],
      targetHeight: action.getBoundingClientRect().height,
      titleInDom: document.body.textContent.includes(fullTitle),
      titleLength: strong.textContent.length,
      expectedTitleLength: fullTitle.length,
      ellipsis: getComputedStyle(strong).textOverflow,
      whiteSpace: getComputedStyle(strong).whiteSpace,
      supportOverlap,
      supportBottom: supportRect.bottom,
      navTop
    };
  })()`);

  assert.equal(geometry.titleInDom, true, `${width}: full authoritative long title remains in the DOM`);
  assert.equal(geometry.titleLength, geometry.expectedTitleLength, `${width}: Mission title is not truncated in data or markup`);
  assert.deepEqual(geometry.document, [width, width], `${width}: no document horizontal overflow`);
  assert.ok(geometry.root[1] <= geometry.root[0] + 1, `${width}: fixture root has no horizontal overflow`);
  assert.ok(geometry.mobile[1] <= geometry.mobile[0] + 1, `${width}: actual MobileAiMissionScreen has no horizontal overflow`);
  assert.ok(geometry.action.right <= width + 0.5, `${width}: article-wrapped Mission action remains inside viewport`);
  assert.ok(geometry.label.width <= geometry.action.width, `${width}: long label shrinks inside the action grid`);
  assert.ok(geometry.actionScroll[1] <= geometry.actionScroll[0] + 1, `${width}: approval action contains its grid content`);
  assert.equal(geometry.ellipsis, "ellipsis", `${width}: intended title ellipsis presentation remains active`);
  assert.equal(geometry.whiteSpace, "nowrap", `${width}: approval row stays a bounded list presentation`);
  assert.ok(geometry.targetHeight >= 44, `${width}: primary Mission target remains at least 44px`);
  assert.equal(geometry.supportOverlap, 0, `${width}: AI support prompt does not overlap the bottom navigation region`);

  const screenshotResult = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const screenshot = Buffer.from(screenshotResult.data, "base64");
  const metadata = await sharp(screenshot).metadata();
  assert.deepEqual([metadata.width, metadata.height], [width, height], `${width}: original-size screenshot`);
  const screenshotPath = path.join(outputDir, `mobile-ai-long-content-${width}x${height}.png`);
  await writeFile(screenshotPath, screenshot);
  return { width, height, geometry, screenshotPath };
}

await mkdir(outputDir, { recursive: true });
const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-mobile-overflow-"));
const vite = await createViteServer({
  root: rootDir,
  appType: "custom",
  logLevel: "error",
  plugins: [fixturePlugin()],
  server: { host: "127.0.0.1", port: vitePort, strictPort: true }
});
await vite.listen();

const { spawn } = await import("node:child_process");
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
], { cwd: rootDir, stdio: "ignore" });

let cdp;
try {
  const pages = await waitFor(`http://127.0.0.1:${chromePort}/json`, (value) => value.some((entry) => entry.type === "page"));
  const page = pages.find((entry) => entry.type === "page");
  cdp = connectCdp(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  const results = [];
  for (const viewport of viewports) results.push(await verifyViewport(cdp, baseUrl, viewport));
  process.stdout.write(`KORDYN V2 mobile Mission overflow PASS ${results.map((row) => `${row.width}x${row.height}:document=${row.geometry.document.join("/")},mobile=${row.geometry.mobile.join("/")},target=${Math.round(row.geometry.targetHeight)}px`).join(" ")} screenshots=${outputDir}\n`);
} finally {
  cdp?.close();
  await stopProcess(chrome);
  await vite.close();
  await rm(profileDir, { recursive: true, force: true });
}
