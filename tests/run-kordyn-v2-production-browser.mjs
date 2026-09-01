import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { KORDYN_V2_WORKSPACES } from "../src/kordynV2/architecture/domains.js";

const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const appUrl = new URL(process.env.KORDYN_PRODUCTION_APP_URL || "http://127.0.0.1:5173/");
const version = process.env.KORDYN_UI_VERSION;
const phase = process.env.KORDYN_ROLLBACK_PHASE || "verify";
const resultPath = path.resolve(process.env.KORDYN_PRODUCTION_RESULT_PATH || "");
const expectedRelease = process.env.KORDYN_EXPECTED_RELEASE || "plan06-production-gate";
const marker = "LINK/USDT";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

assert.ok(["v2", "legacy"].includes(version), "KORDYN_UI_VERSION must be v2 or legacy");
assert.ok(["write", "verify"].includes(phase), "KORDYN_ROLLBACK_PHASE must be write or verify");
assert.ok(["127.0.0.1", "localhost"].includes(appUrl.hostname), "production browser gate only targets localhost");
assert.ok(process.env.KORDYN_PRODUCTION_RESULT_PATH, "KORDYN_PRODUCTION_RESULT_PATH is required");

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
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
    await delay(75);
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

async function waitForExpression(cdp, expression, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (!await evaluate(cdp, `Boolean(${expression})`)) {
    if (Date.now() >= deadline) {
      const diagnostic = await evaluate(cdp, "({href:location.href, title:document.title, text:document.body?.innerText?.slice(0,900)})");
      throw new Error(`Timed out waiting for ${label}; ${JSON.stringify(diagnostic)}`);
    }
    await delay(50);
  }
}

async function click(cdp, selector) {
  const point = await evaluate(cdp, `(() => {
    const target = document.querySelector(${JSON.stringify(selector)});
    if (!target) return null;
    target.scrollIntoView({block:"center",inline:"nearest"});
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return rect.width > 0 && rect.height > 0 && (hit === target || target.contains(hit))
      ? {x,y}
      : {blockedBy:hit?.outerHTML?.slice(0,180)||"none",rect:[rect.left,rect.top,rect.right,rect.bottom]};
  })()`);
  assert.ok(Number.isFinite(point?.x) && Number.isFinite(point?.y), `trusted click target visible and topmost: ${selector}; ${JSON.stringify(point)}`);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function apiRequest(cdp, pathname, options = {}) {
  return await evaluate(cdp, `(async () => {
    const response = await fetch(${JSON.stringify(pathname)}, ${JSON.stringify(options)});
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return {status:response.status,body};
  })()`);
}

function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function styleClassification(owners) {
  const normalized = owners.map((value) => String(value || "").split("?")[0].replaceAll("\\", "/"));
  const legacyFiles = [
    "styles.css", "workspace.css", "workspace-additions.css", "conceptPages.css",
    "conceptSettings.css", "classic-shell.css"
  ];
  const v2 = normalized.filter((value) => value.includes("/src/kordynV2/") || value.includes("src/kordynV2/"));
  const legacy = normalized.filter((value) => value.includes("classicStyles.js") || legacyFiles.some((file) => value.endsWith(`/${file}`)));
  return { v2: [...new Set(v2)], legacy: [...new Set(legacy)] };
}

const chromeInfo = await lstat(chromeBinary);
assert.ok(chromeInfo.isFile(), `Chrome binary is available: ${chromeBinary}`);
const trustedResultRoot = await realpath("/tmp");
const resultRelative = path.relative(trustedResultRoot, resultPath);
assert.ok(
  resultRelative && !resultRelative.startsWith(`..${path.sep}`) && !path.isAbsolute(resultRelative),
  `production gate result stays inside the trusted temporary root: ${resultPath}`
);
const trustedProfileRoot = await realpath(os.tmpdir());
const profile = await mkdtemp(path.join(trustedProfileRoot, `kordyn-plan06-${version}-`));
const debugPort = await freePort();
let chrome;
let cdp;

try {
  chrome = spawn(chromeBinary, [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    "--window-size=1440,900",
    "about:blank"
  ], { stdio: "ignore" });
  const targets = await waitFor(`http://127.0.0.1:${debugPort}/json`, (rows) => rows.some((row) => row.type === "page"));
  const page = targets.find((row) => row.type === "page");
  cdp = connectCdp(page.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, screenWidth: 1440, screenHeight: 900, deviceScaleFactor: 1, mobile: false
  });
  await cdp.send("Page.navigate", { url: appUrl.href });
  const rootSelector = version === "v2" ? '[data-kordyn-v2-shell="desktop"]' : '[data-classic-shell="desktop"]';
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(rootSelector)})`, `${version} actual authenticated production shell`, 30_000);

  const visited = [];
  const mobileVisited = [];
  let objectSearch = null;
  if (version === "v2") {
    for (const [domainId, workspaces] of Object.entries(KORDYN_V2_WORKSPACES)) {
      await click(cdp, `[data-kordyn-v2-domain-target="${domainId}"]`);
      await waitForExpression(cdp, `document.querySelector('[data-kordyn-v2-shell="desktop"]')?.dataset.kordynV2Domain === ${JSON.stringify(domainId)}`, `${domainId} domain`);
      for (const workspace of workspaces) {
        await click(cdp, `[data-kordyn-v2-workspace-target="${workspace.id}"]`);
        await waitForExpression(cdp, `(() => {
          const root=document.querySelector('[data-kordyn-v2-shell="desktop"]');
          const active=[...document.querySelectorAll('[data-kordyn-v2-workspace-target][aria-current="page"]')];
          return root?.dataset.kordynV2Domain===${JSON.stringify(domainId)}
            && root?.dataset.kordynV2Workspace===${JSON.stringify(workspace.id)}
            && active.length===1 && active[0]?.dataset.kordynV2WorkspaceTarget===${JSON.stringify(workspace.id)};
        })()`, `${domainId}/${workspace.id} trusted workspace navigation`);
        const geometry = await evaluate(cdp, "({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})");
        assert.ok(geometry.scroll <= geometry.client + 1, `${domainId}/${workspace.id} has no document overflow: ${JSON.stringify(geometry)}`);
        visited.push(`${domainId}/${workspace.id}`);
      }
    }
  } else {
    await waitForExpression(cdp, `document.querySelector('.agLaunchBtn') && document.querySelectorAll('[aria-label="AI 交易员 子页面"] button').length === 3`, "classic August 15 AI workspace ready", 30_000);
    const august15Desktop = await evaluate(cdp, `(() => ({
      topbar:Boolean(document.querySelector('[data-august15-topbar="true"]')),
      searchWidth:Math.round(document.querySelector('.appTopbar .commandRail')?.getBoundingClientRect().width||0),
      primaryTabs:[...document.querySelectorAll('[aria-label="AI 交易员 子页面"] button')].map((node)=>node.textContent.trim()),
      laterRuntimePill:Boolean(document.querySelector('.runtimeStatePill')),
      laterEmergencyActions:Boolean(document.querySelector('.topEmergencyActions')),
      runBadge:Boolean(document.querySelector('.agRunBadge')),
      launchAction:Boolean(document.querySelector('.agLaunchBtn'))
    }))()`);
    assert.deepEqual(august15Desktop.primaryTabs, ["对话", "情报", "盯盘"], `classic desktop exposes the August 15 AI tab set: ${JSON.stringify(august15Desktop)}`);
    assert.equal(august15Desktop.topbar, true, "classic desktop mounts the August 15 topbar");
    assert.equal(august15Desktop.searchWidth, 340, "classic desktop restores the August 15 search geometry");
    assert.equal(august15Desktop.laterRuntimePill, false, "classic desktop omits the later two-state runtime pill");
    assert.equal(august15Desktop.laterEmergencyActions, false, "classic desktop omits the later emergency-action cluster");
    assert.equal(august15Desktop.runBadge, true, "classic desktop restores the AI runtime badge");
    assert.equal(august15Desktop.launchAction, true, "classic desktop restores the AI autonomy primary action");
    await click(cdp, '.appTopbar .commandRail__search input');
    await cdp.send("Input.insertText", { text: "Research" });
    await waitForExpression(cdp, `document.querySelector('.appTopbar .commandRail__results [data-shell-result-state="available"]')`, "classic real object and feature search results");
    const availableResults = await evaluate(cdp, `document.querySelectorAll('.appTopbar .commandRail__results [data-shell-result-state="available"]').length`);
    await click(cdp, '.appTopbar .commandRail__results [data-shell-result-state="available"]');
    await waitForExpression(cdp, `document.querySelector('[data-classic-shell="desktop"]')?.dataset.classicView === "researchCenter"`, "classic search result navigation");
    await click(cdp, '.appTopbar .commandRail__search input');
    await cdp.send("Input.insertText", { text: "自主巡检" });
    await waitForExpression(cdp, `[...document.querySelectorAll('.appTopbar .commandRail__results [data-shell-result-state="available"]')].some((node)=>node.textContent.includes('自主巡检'))`, "classic hidden patrol feature search result");
    await click(cdp, '.appTopbar .commandRail__results [data-shell-result-state="available"]');
    await waitForExpression(cdp, `document.querySelector('[data-ai-surface="patrol"]')`, "classic hidden patrol feature navigation");
    objectSearch = { query: "Research", availableResults, destination: "researchCenter", hiddenFeature: "patrol" };
    for (const viewId of ["chat", "cockpit", "researchCenter", "riskCenter", "operationsCenter", "systemSettings"]) {
      await click(cdp, `[data-classic-target="${viewId}"]`);
      await waitForExpression(cdp, `(() => {
        const root=document.querySelector('[data-classic-shell="desktop"]');
        const active=[...document.querySelectorAll('[data-classic-target][aria-current="page"]')];
        return root?.dataset.classicView===${JSON.stringify(viewId)}
          && active.length===1 && active[0]?.dataset.classicTarget===${JSON.stringify(viewId)};
      })()`, `classic ${viewId} workspace`);
      visited.push(viewId);
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, screenWidth: 390, screenHeight: 844, deviceScaleFactor: 1, mobile: true
    });
    await cdp.send("Page.reload", { ignoreCache: true });
    await waitForExpression(cdp, `document.querySelector('[data-classic-mobile-shell="true"]')`, "classic actual authenticated mobile shell", 30_000);
    const august15Mobile = await evaluate(cdp, `(() => ({
      title:document.querySelector('.classicMobileHeader .mHeaderMid strong')?.textContent.trim(),
      code:document.querySelector('.classicMobileHeader .mHeaderMid small')?.textContent.trim(),
      tabs:[...document.querySelectorAll('.classicMobileTabbar button')].map((node)=>node.textContent.trim()),
      persistentTools:Boolean(document.querySelector('.classicMobileShell > .mShellTools')),
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth
    }))()`);
    assert.equal(august15Mobile.title, "AI 交易员", `classic mobile restores the August 15 trader title: ${JSON.stringify(august15Mobile)}`);
    assert.equal(august15Mobile.code, "ALPHA-01", "classic mobile restores the August 15 trader code");
    assert.deepEqual(august15Mobile.tabs, ["交易员", "盯盘", "市场", "风控", "更多"], "classic mobile restores the August 15 five-entry tab bar");
    assert.equal(august15Mobile.persistentTools, false, "classic mobile removes the later persistent Objects/Context/Trace row");
    assert.ok(august15Mobile.overflow <= 1, `classic mobile initial shell has no overflow: ${JSON.stringify(august15Mobile)}`);
    await click(cdp, ".classicMobileHeader .mMenuBtn");
    await waitForExpression(cdp, `(() => {
      const drawer=document.querySelector('.classicNavDrawer');
      if (!drawer) return false;
      const rect=drawer.getBoundingClientRect();
      return rect.width>0 && rect.height>0 && rect.left>=-1;
    })()`, "August 15 More drawer is visible");
    const drawerTouchMin = await evaluate(cdp, `Math.min(...[...document.querySelectorAll('.classicNavDrawer button')].map((node)=>node.getBoundingClientRect().height))`);
    assert.ok(drawerTouchMin >= 44, `classic mobile drawer touch targets stay at least 44px: ${drawerTouchMin}`);
    await click(cdp, '.classicNavDrawer [data-classic-mobile-family-target="strategy"][data-classic-mobile-view-target="catalog"]');
    await waitForExpression(cdp, `document.querySelector('[data-classic-mobile-shell="true"]')?.dataset.shellRoute === "strategyLib"`, "classic mobile strategy registry");
    mobileVisited.push("strategy/catalog");
    for (const [tabIndex, familyId, expectedRoute] of [[0, "ai", "chat"], [2, "portfolio", "cockpit"], [3, "guard", "riskHub"]]) {
      await click(cdp, `.classicMobileTabbar button:nth-child(${tabIndex + 1})`);
      await waitForExpression(cdp, `(() => { const root=document.querySelector('[data-classic-mobile-shell="true"]'); return root?.dataset.classicMobileFamily===${JSON.stringify(familyId)} && root?.dataset.shellRoute===${JSON.stringify(expectedRoute)}; })()`, `classic mobile ${familyId}`);
      const geometry = await evaluate(cdp, "({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth})");
      assert.ok(geometry.scroll <= geometry.client + 1, `classic mobile ${familyId} has no document overflow: ${JSON.stringify(geometry)}`);
      mobileVisited.push(`${familyId}/${expectedRoute}`);
    }
    await click(cdp, ".classicMobileHeader .mMenuBtn");
    await waitForExpression(cdp, `(() => { const drawer=document.querySelector('.classicNavDrawer'); if(!drawer)return false; const rect=drawer.getBoundingClientRect(); return rect.width>0&&rect.height>0&&rect.left>=-1; })()`, "classic mobile More drawer reopens");
    await click(cdp, '.classicNavDrawer [data-classic-mobile-family-target="operations"][data-classic-mobile-view-target="events"]');
    await waitForExpression(cdp, `document.querySelector('[data-classic-mobile-shell="true"]')?.dataset.shellRoute === "eventsTasks"`, "classic mobile operations events and tasks");
    mobileVisited.push("operations/events");
  }

  const core = await apiRequest(cdp, "/api/bootstrap/core");
  assert.equal(core.status, 200, `${version}: authoritative core read remains available`);
  assert.equal(core.body?.systemRelease, expectedRelease, `${version}: same backend release identity`);
  const publicBootstrap = await apiRequest(cdp, "/api/public/bootstrap");
  assert.equal(publicBootstrap.status, 200, `${version}: public bootstrap remains available`);
  const authProbe = await apiRequest(cdp, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "rollback-gate@example.invalid", password: "invalid" })
  });
  assert.equal(authProbe.status, 503, `${version}: auth boundary is unchanged and fail-closed in the isolated gate`);

  let markerMutation = null;
  if (phase === "write") {
    markerMutation = await apiRequest(cdp, "/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: marker })
    });
    assert.equal(markerMutation.status, 200, "V2 presentation can invoke the existing watchlist action contract");
  }
  const afterMarker = await apiRequest(cdp, "/api/bootstrap/core");
  assert.equal(afterMarker.status, 200, `${version}: core remains readable after presentation phase`);
  assert.ok(afterMarker.body?.watchlist?.includes(marker), `${version}: marker persists through the same authoritative backend`);

  const invalid = await apiRequest(cdp, "/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol: "INVALID SYMBOL!" })
  });
  assert.equal(invalid.status, 400, `${version}: validation failure semantics remain unchanged`);

  const operations = await apiRequest(cdp, "/api/overview?view=section&section=operationsCenter");
  assert.equal(operations.status, 200, `${version}: operations section is readable`);
  const protectedTask = operations.body?.tasks?.find((task) => task?.systemManaged === true);
  assert.ok(protectedTask?.id, `${version}: a system-managed task is available for the permission-boundary probe`);
  const forbidden = await apiRequest(cdp, `/api/tasks/${encodeURIComponent(protectedTask.id)}`, { method: "DELETE" });
  assert.equal(forbidden.status, 403, `${version}: protected task definition remains forbidden`);

  const owners = await evaluate(cdp, `(() => {
    const values=[];
    for (const node of document.querySelectorAll('style[data-vite-dev-id],link[rel="stylesheet"]')) {
      values.push(node.getAttribute('data-vite-dev-id')||node.getAttribute('href')||'');
    }
    return values;
  })()`);
  const styles = styleClassification(owners);
  if (version === "v2") {
    assert.ok(styles.v2.length > 0, "V2 production shell owns V2 styles");
    assert.equal(styles.legacy.length, 0, `V2 production shell excludes legacy product styles: ${JSON.stringify(styles.legacy)}`);
  } else {
    assert.ok(styles.legacy.length > 0, "legacy rollback shell owns legacy product styles");
    assert.equal(styles.v2.length, 0, `legacy rollback shell excludes V2 styles: ${JSON.stringify(styles.v2)}`);
  }

  const result = {
    version,
    phase,
    rootSelector,
    visited,
    mobileVisited,
    objectSearch,
    backendIdentity: {
      overviewMode: core.body?.overviewMode,
      systemRelease: core.body?.systemRelease,
      userId: core.body?.user?.id || null
    },
    marker: { symbol: marker, present: true, mutationStatus: markerMutation?.status || null },
    publicFingerprint: stableHash(publicBootstrap.body),
    authFingerprint: stableHash({ status: authProbe.status, body: authProbe.body }),
    boundaries: { invalidStatus: invalid.status, forbiddenStatus: forbidden.status },
    styles: { v2Count: styles.v2.length, legacyCount: styles.legacy.length },
    documentOverflow: await evaluate(cdp, "document.documentElement.scrollWidth-document.documentElement.clientWidth")
  };
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const persisted = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(persisted.version, version, "result file is readable before browser cleanup");
  console.log(`kordyn-v2 production browser PASS ${JSON.stringify(result)}`);
} finally {
  cdp?.close();
  if (chrome && chrome.exitCode === null && !chrome.signalCode) {
    chrome.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), delay(2_000)]);
    if (chrome.exitCode === null && !chrome.signalCode) chrome.kill("SIGKILL");
  }
  await rm(profile, { recursive: true, force: true });
}
