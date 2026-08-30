import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeBinary = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const pagePath = "/tests/kordyn-v2-account-interactions-browser.html";

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); });
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

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  const ready = new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
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
      const requestId = ++id;
      return await new Promise((resolve, reject) => { pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); });
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
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function click(cdp, selector) {
  const clicked = await evaluate(cdp, `(() => { const node=document.querySelector(${JSON.stringify(selector)}); if(!node)return false; node.click(); return true; })()`);
  assert.equal(clicked, true, `click target exists: ${selector}`);
}

async function pause(cdp, ms = 80) {
  await evaluate(cdp, `new Promise((resolve) => setTimeout(resolve, ${Number(ms)}))`);
}

async function viewport(cdp, width, height, mobile = false) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
}

async function isolateRoot(cdp, selector) {
  const found = await evaluate(cdp, `(() => {
    const selector = ${JSON.stringify(selector)};
    const roots = [...document.querySelectorAll("[data-browser-v2-root], [data-browser-account-workspace]")];
    for (const root of roots) root.hidden = !root.matches(selector);
    document.body.style.margin = "0";
    return Boolean(document.querySelector(selector));
  })()`);
  assert.equal(found, true, `isolated root exists: ${selector}`);
}

async function assertNoOverflow(cdp, selector, label) {
  const geometry = await evaluate(cdp, `(() => {
    const root = document.querySelector(${JSON.stringify(selector)});
    if (!root) return null;
    return {
      innerWidth: window.innerWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      offenders: [...document.body.querySelectorAll("*")].flatMap((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.right <= window.innerWidth + 1 && rect.left >= -1) return [];
        return [{
          tag: node.tagName,
          className: String(node.className || ""),
          role: node.getAttribute("role") || "",
          right: Math.round(rect.right),
          left: Math.round(rect.left),
          width: Math.round(rect.width)
        }];
      }).slice(0, 8)
    };
  })()`);
  assert.ok(geometry, `${label} geometry root exists`);
  assert.ok(geometry.documentScrollWidth <= geometry.innerWidth + 1, `${label} document overflow: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.bodyScrollWidth <= geometry.innerWidth + 1, `${label} body overflow: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.rootScrollWidth <= geometry.rootClientWidth + 1, `${label} root overflow: ${JSON.stringify(geometry)}`);
}

async function verifyMobileClosedTradePoster(cdp, root, width, height) {
  await viewport(cdp, width, height, true);
  await assertNoOverflow(cdp, root, `APP fills ${width}`);
  const posterBefore = await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.poster?.length || 0");
  await click(cdp, `${root} .kordynV2ExecutionPrimaryAction`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${root} [data-kordyn-v2-closed-trade-output-scrim]`)})`, `APP ${width} Closed trade output sheet`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${root} [data-kordyn-v2-closed-output-close]`)}) === document.activeElement`, `APP ${width} Closed trade output initial focus`);
  const mobileSheetGeometry = await evaluate(cdp, `(() => {
    const sheet = document.querySelector(${JSON.stringify(`${root} .kordynV2ClosedTradeOutputSheet`)});
    const body = document.querySelector(${JSON.stringify(`${root} .kordynV2ClosedTradeOutputBody`)});
    if (!sheet || !body) return null;
    const rect = sheet.getBoundingClientRect();
    const style = getComputedStyle(body);
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      bottom: Math.round(rect.bottom),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      bodyClientHeight: body.clientHeight,
      bodyScrollHeight: body.scrollHeight,
      bodyOverflowY: style.overflowY
    };
  })()`);
  assert.ok(mobileSheetGeometry, `APP ${width} closed-trade sheet geometry exists`);
  assert.ok(mobileSheetGeometry.left >= -1 && mobileSheetGeometry.right <= mobileSheetGeometry.innerWidth + 1, `APP ${width} closed-trade sheet horizontal geometry: ${JSON.stringify(mobileSheetGeometry)}`);
  assert.ok(Math.abs(mobileSheetGeometry.bottom - mobileSheetGeometry.innerHeight) <= 2, `APP ${width} closed-trade sheet docks to bottom: ${JSON.stringify(mobileSheetGeometry)}`);
  assert.ok(mobileSheetGeometry.bodyScrollHeight > mobileSheetGeometry.bodyClientHeight, `APP ${width} closed-trade body scrolls long content: ${JSON.stringify(mobileSheetGeometry)}`);
  assert.match(mobileSheetGeometry.bodyOverflowY, /auto|scroll/u);
  const trapResult = await evaluate(cdp, `(() => {
    const sheet = document.querySelector(${JSON.stringify(`${root} .kordynV2ClosedTradeOutputSheet`)});
    const close = document.querySelector(${JSON.stringify(`${root} [data-kordyn-v2-closed-output-close]`)});
    const action = document.querySelector(${JSON.stringify(`${root} .kordynV2ClosedTradeOutputSheet footer button`)});
    close.focus();
    const event = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    sheet.dispatchEvent(event);
    return { prevented: event.defaultPrevented, activeIsAction: document.activeElement === action };
  })()`);
  assert.deepEqual(trapResult, { prevented: true, activeIsAction: true });
  await click(cdp, `${root} .kordynV2ClosedTradeOutputSheet footer button`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${root} [data-output-state="returned"]`)})`, `APP ${width} Closed trade poster returned`);
  assert.equal(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.poster?.length || 0"), posterBefore + 1);
  const escapeResult = await evaluate(cdp, `(() => {
    const sheet = document.querySelector(${JSON.stringify(`${root} .kordynV2ClosedTradeOutputSheet`)});
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    sheet.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  assert.equal(escapeResult, true);
  await waitForExpression(cdp, `!document.querySelector(${JSON.stringify(`${root} [data-kordyn-v2-closed-trade-output-scrim]`)})`, `APP ${width} Closed trade sheet keyboard close`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${root} .kordynV2ExecutionPrimaryAction`)}) === document.activeElement`, `APP ${width} Closed trade output returns trigger focus`);
  await evaluate(cdp, `(() => {
    window.__kordynV2AccountInteractionCalls.mobilePosterProofWidths = [...(window.__kordynV2AccountInteractionCalls.mobilePosterProofWidths || []), ${width}];
  })()`);
}

async function stop(process) {
  if (!process || process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => process.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 2_000))]);
}

const vitePort = await freePort();
const chromePort = await freePort();
const profileDir = await mkdtemp(path.join(os.tmpdir(), "kordyn-v2-account-chrome-"));
const vite = spawn(process.execPath, [path.join(rootDir, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], { cwd: rootDir, stdio: "ignore" });
const chrome = spawn(chromeBinary, ["--headless=new", "--disable-background-networking", "--disable-extensions", "--disable-gpu", "--no-default-browser-check", "--no-first-run", `--remote-debugging-port=${chromePort}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });
let cdp;
try {
  const baseUrl = `http://127.0.0.1:${vitePort}`;
  await waitFor(baseUrl);
  const targets = await waitFor(`http://127.0.0.1:${chromePort}/json`, (rows) => rows.some((row) => row.type === "page"));
  cdp = connect(targets.find((row) => row.type === "page").webSocketDebuggerUrl);
  await Promise.all([cdp.send("Runtime.enable"), cdp.send("Page.enable")]);
  await cdp.send("Page.navigate", { url: `${baseUrl}${pagePath}` });
  await waitForExpression(cdp, "window.__kordynV2AccountInteractionsReady", "account harness ready");
  const positionFixture = await evaluate(cdp, "window.__kordynV2AccountPositionFixture");
  assert.deepEqual(
    { rawCount: positionFixture.rawCount, normalizedCount: positionFixture.normalizedCount, accountId: positionFixture.accountId, exchange: positionFixture.exchange },
    { rawCount: 2, normalizedCount: 1, accountId: "ex-okx-main", exchange: "OKX" }
  );
  assert.equal(Number.isFinite(Date.parse(positionFixture.rawSyncedAt)), true);

  const marketRoot = '[data-browser-account-workspace="market"]';
  await click(cdp, `${marketRoot} [data-kordyn-v2-object-id="BTC/USDT"]`);
  await waitForExpression(cdp, `${JSON.stringify(marketRoot)} && document.querySelector(${JSON.stringify(`${marketRoot} [data-kordyn-v2-mobile-market-view="detail"] h2`)}) === document.activeElement`, "Market detail focus");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections[0]"), { id: "BTC/USDT", type: "Market", contextId: "BTC/USDT", traceId: "BTC/USDT" });
  await click(cdp, `${marketRoot} .kordynV2AccountMobileNav button`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${marketRoot} [data-kordyn-v2-object-id="BTC/USDT"]`)}) === document.activeElement`, "Market Back focus restoration");
  await click(cdp, `${marketRoot} [data-kordyn-v2-object-id="BTC/USDT"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${marketRoot} [data-kordyn-v2-mobile-market-view="detail"]`)})`, "Market detail reopen");
  await click(cdp, `${marketRoot} [data-kordyn-v2-watchlist-action]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${marketRoot} [role="status"]`)})?.textContent.includes("操作未完成")`, "safe watchlist rejection");

  const accountRoot = '[data-browser-account-workspace="account"]';
  await click(cdp, `${accountRoot} [data-kordyn-v2-object-type="Account"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(accountRoot)})?.dataset.selectedId === "ex-okx-main"`, "canonical Account selection");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "ex-okx-main", type: "Account", contextId: "ex-okx-main", traceId: "ex-okx-main" });
  await click(cdp, `${accountRoot} .kordynV2MobileReconciliationLink`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${accountRoot} [data-kordyn-v2-mobile-reconciliation-detail="true"] h2`)}) === document.activeElement`, "Account detail focus");
  await click(cdp, `${accountRoot} .kordynV2AccountMobileNav button`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${accountRoot} .kordynV2MobileReconciliationLink`)}) === document.activeElement`, "Account Back focus restoration");
  await click(cdp, `${accountRoot} .kordynV2MobileReconciliationLink`);
  await click(cdp, `${accountRoot} [data-kordyn-v2-reconcile-action]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${accountRoot} [role="status"]`)})?.textContent.includes("操作未完成")`, "safe reconcile throw");

  const positionRoot = '[data-browser-account-workspace="positions"]';
  await click(cdp, `${positionRoot} [data-kordyn-v2-object-id="position-1"][data-kordyn-v2-object-type="Position"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${positionRoot} [data-kordyn-v2-position-mobile-view="detail"] h2`)}) === document.activeElement`, "Position detail focus");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "position-1", type: "Position", contextId: "position-1", traceId: "position-1" });
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(`${positionRoot} [data-protection-surface="mobile-header"]`)})?.dataset.protectionState`), "verified");
  await click(cdp, `${positionRoot} [data-kordyn-v2-position-back="true"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${positionRoot} [data-kordyn-v2-object-id="position-1"][data-kordyn-v2-object-type="Position"]`)}) === document.activeElement`, "Position Back focus restoration");

  await viewport(cdp, 1440, 900, false);
  const planDesktopRoot = '[data-browser-account-workspace="desktop-plans"]';
  await isolateRoot(cdp, planDesktopRoot);
  await assertNoOverflow(cdp, planDesktopRoot, "desktop plans 1440");
  await click(cdp, `${planDesktopRoot} [data-kordyn-v2-object-id="plan-2"][data-kordyn-v2-object-type="Trade plan"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(planDesktopRoot)})?.dataset.selectedId === "plan-2"`, "desktop Trade plan canonical selection");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "plan-2", type: "Trade plan", contextId: "plan-2", traceId: "plan-2" });
  await click(cdp, `${planDesktopRoot} .kordynV2ExecutionInspector footer button:last-child`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${planDesktopRoot} [role="status"][data-action-state="partial"]`)})`, "desktop Trade plan partial authority result");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.approvePlan"), ["plan-2"]);

  await viewport(cdp, 1180, 820, false);
  const orderDesktopRoot = '[data-browser-account-workspace="desktop-orders"]';
  await isolateRoot(cdp, orderDesktopRoot);
  await assertNoOverflow(cdp, orderDesktopRoot, "desktop orders 1180");
  await click(cdp, `${orderDesktopRoot} [data-kordyn-v2-object-id="execution-2"][data-kordyn-v2-object-type="Execution"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(orderDesktopRoot)})?.dataset.selectedId === "execution-2"`, "desktop Execution canonical selection");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "execution-2", type: "Execution", contextId: "execution-2", traceId: "execution-2" });
  await click(cdp, `${orderDesktopRoot} [data-kordyn-v2-object-id="order-2"][data-kordyn-v2-object-type="Order"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(orderDesktopRoot)})?.dataset.selectedId === "order-2"`, "desktop Order canonical selection");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "order-2", type: "Order", contextId: "order-2", traceId: "order-2" });

  const fillDesktopRoot = '[data-browser-account-workspace="desktop-fills"]';
  await isolateRoot(cdp, fillDesktopRoot);
  await assertNoOverflow(cdp, fillDesktopRoot, "desktop fills 1180");
  await click(cdp, `${fillDesktopRoot} [data-kordyn-v2-object-id="fill-2"][data-kordyn-v2-object-type="Fill"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(fillDesktopRoot)})?.dataset.selectedId === "fill-2"`, "desktop Fill canonical selection");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "fill-2", type: "Fill", contextId: "fill-2", traceId: "fill-2" });
  await click(cdp, `${fillDesktopRoot} [data-kordyn-v2-object-id="closed:execution-2"][data-kordyn-v2-object-type="Closed trade"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(fillDesktopRoot)})?.dataset.selectedId === "closed:execution-2"`, "desktop Closed trade canonical selection");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "closed:execution-2", type: "Closed trade", contextId: "closed:execution-2", traceId: "closed:execution-2" });
  await click(cdp, `${fillDesktopRoot} .kordynV2ExecutionPrimaryAction`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${fillDesktopRoot} [data-kordyn-v2-closed-trade-output-scrim]`)})`, "desktop Closed trade output sheet");
  await click(cdp, `${fillDesktopRoot} .kordynV2ClosedTradeOutputSheet footer button`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${fillDesktopRoot} [data-output-state="returned"]`)})`, "desktop Closed trade poster returned");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.poster"), ["execution-2"]);
  await click(cdp, `${fillDesktopRoot} [data-kordyn-v2-closed-output-close]`);
  await click(cdp, `${fillDesktopRoot} [data-kordyn-v2-object-id="fill-2"][data-kordyn-v2-object-type="Fill"]`);
  await click(cdp, `${fillDesktopRoot} [data-kordyn-v2-object-id="review-2"][data-kordyn-v2-object-type="Review"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(fillDesktopRoot)})?.dataset.selectedId === "review-2"`, "desktop Review canonical selection");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "review-2", type: "Review", contextId: "review-2", traceId: "review-2" });

  await viewport(cdp, 1440, 900, false);
  const rootShell = '[data-browser-v2-root]';
  await isolateRoot(cdp, rootShell);
  await click(cdp, `${rootShell} [data-kordyn-v2-domain-target="account"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${rootShell} [data-kordyn-v2-shell="desktop"]`)})?.dataset.kordynV2Workspace === "market"`, "root account market workspace");
  await click(cdp, `${rootShell} [data-kordyn-v2-workspace-target="plans"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${rootShell} [data-kordyn-v2-shell="desktop"]`)})?.dataset.kordynV2Workspace === "plans"`, "root plans workspace");
  await assertNoOverflow(cdp, rootShell, "desktop root account plans 1440");
  await click(cdp, `${rootShell} [data-kordyn-v2-object-id="plan-orphan"][data-kordyn-v2-object-type="Trade plan"]`);
  await waitForExpression(cdp, `(() => { const root = document.querySelector(${JSON.stringify(`${rootShell} [data-kordyn-v2-shell="desktop"]`)}); return root?.dataset.kordynV2Workspace === "plans" && root?.dataset.kordynV2SelectedId === "plan-orphan" && root?.dataset.kordynV2SelectedType === "Trade plan"; })()`, "root orphan Trade plan selection");
  const rootBeforeRejectedSelection = await evaluate(cdp, `(() => { const root = document.querySelector(${JSON.stringify(`${rootShell} [data-kordyn-v2-shell="desktop"]`)}); return { workspace: root?.dataset.kordynV2Workspace, id: root?.dataset.kordynV2SelectedId, type: root?.dataset.kordynV2SelectedType }; })()`);
  await click(cdp, `${rootShell} .kordynV2ExecutionRelatedLink[data-kordyn-v2-object-id="execution-missing"][data-kordyn-v2-object-type="Execution"]`);
  await pause(cdp);
  assert.deepEqual(await evaluate(cdp, `(() => { const root = document.querySelector(${JSON.stringify(`${rootShell} [data-kordyn-v2-shell="desktop"]`)}); return { workspace: root?.dataset.kordynV2Workspace, id: root?.dataset.kordynV2SelectedId, type: root?.dataset.kordynV2SelectedType }; })()`), rootBeforeRejectedSelection);
  await click(cdp, `${rootShell} [data-kordyn-v2-object-id="plan-2"][data-kordyn-v2-object-type="Trade plan"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${rootShell} [data-kordyn-v2-shell="desktop"]`)})?.dataset.kordynV2SelectedId === "plan-2"`, "root Trade plan selection");
  await click(cdp, `${rootShell} .kordynV2ExecutionRelatedLink[data-kordyn-v2-object-type="Execution"]`);
  await waitForExpression(cdp, `(() => { const root = document.querySelector(${JSON.stringify(`${rootShell} [data-kordyn-v2-shell="desktop"]`)}); return root?.dataset.kordynV2Workspace === "orders" && root?.dataset.kordynV2SelectedId === "execution-2" && root?.dataset.kordynV2SelectedType === "Execution"; })()`, "root related Execution lands in orders");
  await click(cdp, `${rootShell} [data-kordyn-v2-object-id="fill-2"][data-kordyn-v2-object-type="Fill"]`);
  await waitForExpression(cdp, `(() => { const root = document.querySelector(${JSON.stringify(`${rootShell} [data-kordyn-v2-shell="desktop"]`)}); return root?.dataset.kordynV2Workspace === "fills" && root?.dataset.kordynV2SelectedId === "fill-2" && root?.dataset.kordynV2SelectedType === "Fill"; })()`, "root related Fill lands in fills");

  await viewport(cdp, 390, 844, true);
  const planMobileRoot = '[data-browser-account-workspace="plans"]';
  await isolateRoot(cdp, planMobileRoot);
  await assertNoOverflow(cdp, planMobileRoot, "APP plans 390");
  await click(cdp, `${planMobileRoot} [data-kordyn-v2-object-id="plan-2"][data-kordyn-v2-object-type="Trade plan"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${planMobileRoot} [data-kordyn-v2-execution-mobile-view="detail"] h2`)}) === document.activeElement`, "APP Trade plan detail focus");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "plan-2", type: "Trade plan", contextId: "plan-2", traceId: "plan-2" });
  const plan2ApproveCalls = await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.approvePlan?.filter((id) => id === 'plan-2').length || 0");
  await click(cdp, `${planMobileRoot} .kordynV2ExecutionInspector footer button:last-child`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${planMobileRoot} [role="status"][data-action-state="processing"]`)})`, "APP Trade plan processing authority state");
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(`${planMobileRoot} .kordynV2ExecutionInspector footer button:last-child`)})?.disabled`), true);
  await click(cdp, `${planMobileRoot} .kordynV2ExecutionInspector footer button:last-child`);
  assert.equal(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.approvePlan?.filter((id) => id === 'plan-2').length || 0"), plan2ApproveCalls + 1);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${planMobileRoot} [role="status"][data-action-state="partial"]`)})`, "APP Trade plan partial authority result");
  await click(cdp, `${planMobileRoot} [data-kordyn-v2-execution-back="plans"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${planMobileRoot} [data-kordyn-v2-object-id="plan-2"][data-kordyn-v2-object-type="Trade plan"]`)}) === document.activeElement`, "APP Trade plan Back focus restoration");
  await click(cdp, `${planMobileRoot} [data-kordyn-v2-object-id="plan-3"][data-kordyn-v2-object-type="Trade plan"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${planMobileRoot} [data-kordyn-v2-execution-mobile-view="detail"] h2`)}) === document.activeElement`, "APP second Trade plan detail focus");
  assert.equal(await evaluate(cdp, `document.querySelector(${JSON.stringify(`${planMobileRoot} [role="status"][data-action-state]`)}) === null`), true);
  await click(cdp, `${planMobileRoot} .kordynV2ExecutionInspector footer button:first-child`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${planMobileRoot} [role="status"][data-action-state="succeeded"]`)})`, "APP Trade plan reject terminal result");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.rejectPlan"), ["plan-3"]);

  const orderMobileRoot = '[data-browser-account-workspace="orders"]';
  await isolateRoot(cdp, orderMobileRoot);
  await assertNoOverflow(cdp, orderMobileRoot, "APP orders 390");
  await click(cdp, `${orderMobileRoot} [data-kordyn-v2-object-id="execution-2"][data-kordyn-v2-object-type="Execution"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${orderMobileRoot} [data-kordyn-v2-execution-mobile-view="detail"] h2`)}) === document.activeElement`, "APP Execution detail focus");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "execution-2", type: "Execution", contextId: "execution-2", traceId: "execution-2" });
  await click(cdp, `${orderMobileRoot} [data-kordyn-v2-execution-back="orders"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${orderMobileRoot} [data-kordyn-v2-object-id="execution-2"][data-kordyn-v2-object-type="Execution"]`)}) === document.activeElement`, "APP Execution Back focus restoration");
  await click(cdp, `${orderMobileRoot} [data-kordyn-v2-object-id="order-2"][data-kordyn-v2-object-type="Order"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${orderMobileRoot} [data-kordyn-v2-execution-mobile-view="detail"] h2`)}) === document.activeElement`, "APP Order detail focus");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "order-2", type: "Order", contextId: "order-2", traceId: "order-2" });

  await viewport(cdp, 430, 932, true);
  const fillMobileRoot = '[data-browser-account-workspace="fills"]';
  await isolateRoot(cdp, fillMobileRoot);
  await assertNoOverflow(cdp, fillMobileRoot, "APP fills 430");
  await click(cdp, `${fillMobileRoot} [data-kordyn-v2-object-id="fill-2"][data-kordyn-v2-object-type="Fill"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${fillMobileRoot} [data-kordyn-v2-execution-mobile-view="detail"] h2`)}) === document.activeElement`, "APP Fill detail focus");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "fill-2", type: "Fill", contextId: "fill-2", traceId: "fill-2" });
  await click(cdp, `${fillMobileRoot} [data-kordyn-v2-execution-back="fills"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${fillMobileRoot} [data-kordyn-v2-object-id="fill-2"][data-kordyn-v2-object-type="Fill"]`)}) === document.activeElement`, "APP Fill Back focus restoration");
  await click(cdp, `${fillMobileRoot} [data-kordyn-v2-object-id="closed:execution-2"][data-kordyn-v2-object-type="Closed trade"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${fillMobileRoot} [data-kordyn-v2-execution-mobile-view="detail"] h2`)}) === document.activeElement`, "APP Closed trade detail focus");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "closed:execution-2", type: "Closed trade", contextId: "closed:execution-2", traceId: "closed:execution-2" });
  await verifyMobileClosedTradePoster(cdp, fillMobileRoot, 390, 844);
  await verifyMobileClosedTradePoster(cdp, fillMobileRoot, 430, 932);
  await click(cdp, `${fillMobileRoot} [data-kordyn-v2-execution-back="fills"]`);
  await click(cdp, `${fillMobileRoot} [data-kordyn-v2-object-id="review-2"][data-kordyn-v2-object-type="Review"]`);
  await waitForExpression(cdp, `document.querySelector(${JSON.stringify(`${fillMobileRoot} [data-kordyn-v2-execution-mobile-view="detail"] h2`)}) === document.activeElement`, "APP Review detail focus");
  assert.deepEqual(await evaluate(cdp, "window.__kordynV2AccountInteractionCalls.selections.at(-1)"), { id: "review-2", type: "Review", contextId: "review-2", traceId: "review-2" });

  const result = await evaluate(cdp, `(() => ({...window.__kordynV2AccountInteractionCalls,text:document.body.textContent,marketDisabled:document.querySelector(${JSON.stringify(`${marketRoot} [data-kordyn-v2-watchlist-action]`)})?.disabled,accountDisabled:document.querySelector(${JSON.stringify(`${accountRoot} [data-kordyn-v2-reconcile-action]`)})?.disabled}))()`);
  assert.deepEqual(result.mobilePosterProofWidths, [390, 430]);
  assert.deepEqual({ watchlist: result.watchlist, reconcile: result.reconcile, unhandled: result.unhandled }, { watchlist: 1, reconcile: 1, unhandled: 0 });
  assert.equal(result.marketDisabled, false);
  assert.equal(result.accountDisabled, false);
  assert.doesNotMatch(result.text, /WATCHLIST_SECRET_NEVER_RENDER|RECONCILE_SECRET_NEVER_RENDER/);
  console.log("Kordyn V2 account production interaction browser checks passed");
} finally {
  cdp?.close();
  await Promise.all([stop(chrome), stop(vite)]);
  await rm(profileDir, { recursive: true, force: true });
}
