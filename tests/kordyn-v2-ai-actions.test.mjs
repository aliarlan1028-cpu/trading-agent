import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createAiActions } from "../src/kordynV2/domains/ai/aiActions.js";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-ai-actions");
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

test("AI approval and rejection retain deployed endpoints and raw results", async () => {
  const calls = [];
  const results = [
    { plan: { id: "plan-1", status: "approved" }, executionSubmitted: false },
    { id: "plan-1", status: "cancelled" },
    { message: "watch cancelled", watch: { id: "watch-1", status: "cancelled" } }
  ];
  const ai = createAiActions({
    action: async (...args) => { calls.push(args); return results[calls.length - 1]; },
    confirm: async () => true
  });

  assert.equal(await ai.approvePlan("plan-1"), results[0]);
  assert.equal(await ai.rejectPlan("plan-1"), results[1]);
  assert.equal(await ai.cancelWatch("watch-1", "BTC/USDT"), results[2]);
  assert.deepEqual(calls, [
    ["/api/trade-plans/plan-1/approve", {}],
    ["/api/trade-plans/plan-1/cancel", { reason: "user_rejected" }],
    ["/api/watch-triggers/watch-1/cancel", {}]
  ]);
});

test("AI non-trading actions retain deployed request shapes and dependency results", async () => {
  const calls = [];
  const downloads = [];
  const navigations = [];
  const memory = {
    layer: "semantic",
    title: "情报上下文：CPI",
    content: "CPI 发布后只重新分析，不自动下单。",
    tags: ["情报", "上下文"],
    source: "intel"
  };
  const ai = createAiActions({
    action: async (...args) => { calls.push(args); return { route: args[0], body: args[1] }; },
    confirm: async () => true,
    download: (...args) => { downloads.push(args); return "download-result"; },
    navigate: (...args) => { navigations.push(args); return "navigate-result"; }
  });

  const remembered = await ai.rememberIntelligence(memory);
  const refreshed = await ai.refreshEvents();
  const translated = await ai.translatePoster("BTC 计划复核");

  assert.deepEqual(calls, [
    ["/api/agent/memory", memory],
    ["/api/event-sources/refresh", {}],
    ["/api/posters/translate", { text: "BTC 计划复核" }]
  ]);
  assert.deepEqual(remembered, { route: "/api/agent/memory", body: memory });
  assert.deepEqual(refreshed, { route: "/api/event-sources/refresh", body: {} });
  assert.deepEqual(translated, { route: "/api/posters/translate", body: { text: "BTC 计划复核" } });
  assert.equal(ai.downloadPoster("poster-node", "btc.png"), "download-result");
  assert.equal(ai.navigate("ai", "events"), "navigate-result");
  assert.deepEqual(downloads, [["poster-node", "btc.png"]]);
  assert.deepEqual(navigations, [["ai", "events"]]);
});

test("protected AI actions fail closed when confirmation is cancelled", async () => {
  let writes = 0;
  const ai = createAiActions({
    action: async () => { writes += 1; return { ok: true }; },
    confirm: async () => false
  });

  assert.deepEqual(await ai.approvePlan("plan-1"), { ok: false, cancelled: true });
  assert.deepEqual(await ai.rejectPlan("plan-1"), { ok: false, cancelled: true });
  assert.deepEqual(await ai.cancelWatch("watch-1", "BTC/USDT"), { ok: false, cancelled: true });
  assert.equal(writes, 0);
});

test("malformed AI action input cannot reach a production write", async () => {
  const calls = [];
  let confirmations = 0;
  const ai = createAiActions({
    action: async (...args) => { calls.push(args); return { ok: true }; },
    confirm: async () => { confirmations += 1; return true; }
  });

  for (const result of [
    await ai.approvePlan(null),
    await ai.rejectPlan(""),
    await ai.cancelWatch({ id: "watch-1" }),
    await ai.rememberIntelligence(null),
    await ai.translatePoster("   ")
  ]) {
    assert.deepEqual(result, { ok: false, error: "invalid_ai_action_input" });
  }
  assert.deepEqual(calls, []);
  assert.equal(confirmations, 0);
});

test("createV2Actions exposes the frozen AI adapter without changing namespace identity", () => {
  const actions = createV2Actions({ action: async () => ({}), confirm: async () => false });

  assert.deepEqual(Object.keys(actions), ["ai", "account", "assets", "governance", "global"]);
  assert.deepEqual(Object.keys(actions.ai), [
    "approvePlan",
    "rejectPlan",
    "cancelWatch",
    "rememberIntelligence",
    "refreshEvents",
    "translatePoster",
    "downloadPoster",
    "navigate"
  ]);
  assert.equal(Object.isFrozen(actions.ai), true);
});
