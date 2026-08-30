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

  const result = await evaluate(cdp, `(() => ({...window.__kordynV2AccountInteractionCalls,text:document.body.textContent,marketDisabled:document.querySelector(${JSON.stringify(`${marketRoot} [data-kordyn-v2-watchlist-action]`)})?.disabled,accountDisabled:document.querySelector(${JSON.stringify(`${accountRoot} [data-kordyn-v2-reconcile-action]`)})?.disabled}))()`);
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
