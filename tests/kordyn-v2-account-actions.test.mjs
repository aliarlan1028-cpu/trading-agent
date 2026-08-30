import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-account-actions");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { createAccountActions } from "./src/kordynV2/domains/account/accountActions.js";
      export { createV2Actions } from "./src/kordynV2/actions/createV2Actions.js";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  outfile: outFile,
  logLevel: "silent"
});
const { createAccountActions, createV2Actions } = require(outFile);

test("account exit delegates to the deployed execution exit contract including conflict polling", async () => {
  const calls = [];
  const account = createAccountActions({
    action: async (...args) => {
      calls.push(args);
      return calls.length === 1
        ? { ok: false, httpStatus: 409, error: "execution_state_changed" }
        : { ok: true };
    }
  });

  const result = await account.exitExecutionOrder(
    { id: "eo-1", status: "entry_pending", symbol: "BTC/USDT" },
    "desktop"
  );

  assert.deepEqual(calls, [
    ["/api/execution-orders/eo-1/close", { reason: "manual_ui", intent: "cancel_entry", expectedStatus: "entry_pending" }],
    ["/api/execution-orders/poll", {}]
  ]);
  assert.equal(result.stateChanged, true);
  assert.equal(result.httpStatus, 409);
});

test("non-actionable execution exits are rejected without a write", async () => {
  let writes = 0;
  const account = createAccountActions({ action: async () => { writes += 1; } });

  const result = await account.exitExecutionOrder({ id: "eo-closed", status: "closed" }, "mobile");

  assert.deepEqual(result, { ok: false, error: "execution_not_actionable" });
  assert.equal(writes, 0);
});

test("reconcile uses confirmation and the real manual UI mode", async () => {
  const calls = [];
  const account = createAccountActions({
    action: async (...args) => { calls.push(["action", ...args]); return { ok: true }; },
    confirm: async (...args) => { calls.push(["confirm", ...args]); return true; }
  });

  await account.reconcile();

  assert.equal(calls[0][0], "confirm");
  assert.deepEqual(calls[1], ["action", "/api/reconciler/run", { mode: "manual_ui" }]);
  assert.equal(calls.length, 2);
});

test("watchlist, review navigation, and closed-trade output use deployed boundaries", async () => {
  const calls = [];
  const account = createAccountActions({
    action: async (...args) => { calls.push(["action", ...args]); return { ok: true }; },
    navigate: (...args) => { calls.push(["navigate", ...args]); return "navigated"; },
    download: (...args) => { calls.push(["download", ...args]); return "downloaded"; }
  });

  await account.addWatchlist("BTC/USDT");
  await account.removeWatchlist("BTC/USDT:SWAP");
  assert.equal(account.openReviews(), "navigated");
  assert.equal(account.downloadClosedTradePoster("eo/closed"), "downloaded");

  assert.deepEqual(calls, [
    ["action", "/api/watchlist", { symbol: "BTC/USDT" }],
    ["action", "/api/watchlist/BTC%2FUSDT%3ASWAP", {}, "DELETE"],
    ["navigate", "assets", "reviews"],
    ["download", "/api/posters/trades/eo%2Fclosed", "closed-trade-eo-closed.png"]
  ]);
});

test("account plan decisions are the established AI action functions", async () => {
  const actions = createV2Actions({
    action: async () => ({ ok: true }),
    confirm: async () => true
  });

  assert.equal(actions.account.approvePlan, actions.ai.approvePlan);
  assert.equal(actions.account.rejectPlan, actions.ai.rejectPlan);
  assert.equal(Object.isFrozen(actions.account), true);
});

test("null, hostile, and invalid dependency containers produce bounded unavailable actions", async () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const throwing = {};
  Object.defineProperty(throwing, "action", {
    enumerable: true,
    get() { throw new Error("hostile dependency getter"); }
  });
  const dependencyInputs = [null, 42, "invalid", revoked.proxy, throwing, {
    action: {}, confirm: {}, navigate: {}, download: {}, ai: null
  }];

  for (const deps of dependencyInputs) {
    let account;
    assert.doesNotThrow(() => { account = createAccountActions(deps); });
    assert.deepEqual(await account.addWatchlist("BTC/USDT"), { ok: false, error: "action_unavailable" });
    assert.deepEqual(await account.reconcile(), { ok: false, cancelled: true });
    assert.deepEqual(await account.approvePlan("plan-1"), { ok: false, error: "action_unavailable" });
    assert.deepEqual(account.openReviews(), { ok: false, error: "action_unavailable" });
    assert.deepEqual(account.downloadClosedTradePoster("eo-1"), { ok: false, error: "action_unavailable" });
  }
});

test("malformed and hostile watchlist symbols and poster IDs never invoke deployed boundaries", async () => {
  const calls = [];
  const throwing = new Proxy({}, { get() { throw new Error("must not coerce hostile input"); } });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const invalidInputs = [undefined, null, "", " BTC/USDT", "BTC USDT", "BTC/USDT\n", 7, 7n, Symbol("id"), [], {}, throwing, revoked.proxy];
  const account = createAccountActions({
    action: async (...args) => { calls.push(["action", ...args]); return { ok: true }; },
    download: (...args) => { calls.push(["download", ...args]); return "downloaded"; }
  });

  for (const value of invalidInputs) {
    assert.doesNotThrow(() => account.addWatchlist(value));
    assert.doesNotThrow(() => account.removeWatchlist(value));
    assert.doesNotThrow(() => account.downloadClosedTradePoster(value));
    assert.deepEqual(await account.addWatchlist(value), { ok: false, error: "invalid_account_action_input" });
    assert.deepEqual(await account.removeWatchlist(value), { ok: false, error: "invalid_account_action_input" });
    assert.deepEqual(account.downloadClosedTradePoster(value), { ok: false, error: "invalid_account_action_input" });
  }
  assert.deepEqual(calls, []);
});

test("rejected reconciliation confirmation cannot write", async () => {
  let confirmations = 0;
  let writes = 0;
  const account = createAccountActions({
    action: async () => { writes += 1; return { ok: true }; },
    confirm: async () => { confirmations += 1; return false; }
  });

  const result = await account.reconcile();

  assert.deepEqual(result, { ok: false, cancelled: true });
  assert.equal(confirmations, 1);
  assert.equal(writes, 0);
});

test("reconcile and watchlist writes preserve exact raw server success and error results", async () => {
  const reconcileResult = { ok: true, reportId: "report-raw" };
  const addError = { ok: false, httpStatus: 409, error: "watchlist_conflict" };
  const removeResult = { ok: true, removed: "BTC/USDT" };
  const account = createAccountActions({
    action: async (endpoint) => {
      if (endpoint === "/api/reconciler/run") return reconcileResult;
      if (endpoint === "/api/watchlist") return addError;
      return removeResult;
    },
    confirm: async () => true
  });

  assert.equal(await account.reconcile(), reconcileResult);
  assert.equal(await account.addWatchlist("BTC/USDT"), addError);
  assert.equal(await account.removeWatchlist("BTC/USDT"), removeResult);
});
