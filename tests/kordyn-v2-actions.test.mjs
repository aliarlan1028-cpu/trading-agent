import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-actions");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `export { createV2Actions } from "./src/kordynV2/actions/createV2Actions.js";`,
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
const { createV2Actions } = require(outFile);

test("protected V2 actions call the existing confirm and endpoint once", async () => {
  const calls = [];
  const serverResult = { ok: true, reportId: "report-1" };
  const actions = createV2Actions({
    action: async (...args) => { calls.push(["action", ...args]); return serverResult; },
    confirm: async (...args) => { calls.push(["confirm", ...args]); return true; },
    notify: () => {}, download: () => {}, navigate: () => {}
  });
  const result = await actions.global.reconcile();
  assert.equal(calls[0][0], "confirm");
  assert.deepEqual(calls[1], ["action", "/api/reconciler/run", { mode: "manual_ui" }]);
  assert.equal(calls.length, 2);
  assert.equal(result, serverResult);
});

test("cancelled confirmation produces no write", async () => {
  let writes = 0;
  const actions = createV2Actions({ action: async () => { writes += 1; }, confirm: async () => false });
  await actions.global.flattenAll();
  assert.equal(writes, 0);
});

test("Flatten and Kill remain distinct deployed protected actions", async () => {
  const calls = [];
  const actions = createV2Actions({
    action: async (...args) => { calls.push(args); return { accepted: true }; },
    confirm: async () => true
  });
  await actions.global.flattenAll();
  await actions.global.setKillSwitch(true, "operator test");
  assert.deepEqual(calls, [
    ["/api/risk/emergency-flatten", {}],
    ["/api/risk/kill-switch", { enabled: true, reason: "operator test" }]
  ]);
});

test("Kill accepts only boolean state and preserves both deployed boolean payloads", async () => {
  const calls = [];
  const actions = createV2Actions({
    action: async (...args) => { calls.push(["action", ...args]); return { accepted: true }; },
    confirm: async (...args) => { calls.push(["confirm", ...args]); return true; }
  });
  await actions.global.setKillSwitch(true, "stop");
  await actions.global.setKillSwitch(false, "resume");
  assert.deepEqual(calls.filter(([type]) => type === "action"), [
    ["action", "/api/risk/kill-switch", { enabled: true, reason: "stop" }],
    ["action", "/api/risk/kill-switch", { enabled: false, reason: "resume" }]
  ]);

  calls.length = 0;
  const result = await actions.global.setKillSwitch("false", "malformed");
  assert.deepEqual(result, { ok: false, error: "invalid_kill_switch_state" });
  assert.deepEqual(calls, []);
});

test("V2 action namespaces and global actions are stable and frozen", () => {
  const actions = createV2Actions({ action: async () => ({}), confirm: async () => false });
  assert.deepEqual(Object.keys(actions), ["ai", "account", "assets", "governance", "global"]);
  assert.deepEqual(Object.keys(actions.global), ["reconcile", "flattenAll", "setKillSwitch", "navigate", "download"]);
  for (const value of [actions, actions.ai, actions.account, actions.assets, actions.governance, actions.global]) {
    assert.equal(Object.isFrozen(value), true);
  }
});
