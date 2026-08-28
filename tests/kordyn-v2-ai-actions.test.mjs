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
  const memoryResult = Object.freeze({ id: "memory-1", stored: true });
  const memory = {
    layer: "semantic",
    title: "情报上下文：CPI",
    content: "CPI 发布后只重新分析，不自动下单。",
    tags: ["情报", "上下文"],
    source: "intel"
  };
  const ai = createAiActions({
    action: async (...args) => {
      calls.push(args);
      return args[0] === "/api/agent/memory" ? memoryResult : { route: args[0], body: args[1] };
    },
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
  assert.notEqual(calls[0][1], memory);
  assert.deepEqual(calls[0][1], memory);
  assert.equal(remembered, memoryResult);
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

test("AI action identifiers reject internal whitespace and control characters before confirmation", async () => {
  let confirmations = 0;
  let writes = 0;
  const ai = createAiActions({
    action: async () => { writes += 1; return { ok: true }; },
    confirm: async () => { confirmations += 1; return true; }
  });

  for (const result of [
    await ai.approvePlan("plan 1"),
    await ai.rejectPlan("plan\n1"),
    await ai.cancelWatch("watch\t1"),
    await ai.cancelWatch("watch-1", "BTC /USDT"),
    await ai.cancelWatch("watch-1", "BTC\u0000/USDT"),
    await ai.approvePlan("plan\u00851")
  ]) {
    assert.deepEqual(result, { ok: false, error: "invalid_ai_action_input" });
  }
  assert.equal(confirmations, 0);
  assert.equal(writes, 0);
});

test("intelligence memory rejects malformed and inherited payload facts before writing", async () => {
  let confirmations = 0;
  let writes = 0;
  let accessorReads = 0;
  const accessorPayload = {};
  Object.defineProperties(accessorPayload, {
    title: { enumerable: true, get() { accessorReads += 1; return "CPI"; } },
    content: { enumerable: true, get() { accessorReads += 1; return "context"; } }
  });
  const inheritedPayload = Object.create({ title: "CPI", content: "context" });
  const ai = createAiActions({
    action: async () => { writes += 1; return { ok: true }; },
    confirm: async () => { confirmations += 1; return true; }
  });
  const invalidPayloads = [
    {},
    new Date(),
    [],
    accessorPayload,
    inheritedPayload,
    { title: "CPI", content: " " },
    { title: "CPI", content: "context", tags: "intel" },
    { title: "CPI", content: "context", tags: ["intel", 7] },
    { title: "CPI", content: "context", tags: [" intel"] },
    { title: "CPI", content: "context", layer: 3 },
    { title: "CPI", content: "context", layer: "semantic layer" },
    { title: "CPI", content: "context", source: {} },
    { title: "CPI", content: "context", source: "intel\nfeed" },
    { title: "CPI", content: "context", unexpected: true }
  ];

  for (const payload of invalidPayloads) {
    assert.deepEqual(
      await ai.rememberIntelligence(payload),
      { ok: false, error: "invalid_ai_action_input" }
    );
  }
  assert.equal(accessorReads, 0);
  assert.equal(confirmations, 0);
  assert.equal(writes, 0);
});

test("intelligence memory writes a stable descriptor snapshot instead of a mutable Proxy", async () => {
  let writtenBody;
  let releaseWrite;
  let proxyGets = 0;
  const rawResult = Object.freeze({ id: "memory-proxy", stored: true });
  const target = {
    layer: "semantic",
    title: "CPI context",
    content: "reanalyze only",
    tags: ["intel", "context"],
    source: "intel"
  };
  const payload = new Proxy(target, {
    get(object, key, receiver) {
      proxyGets += 1;
      if (key === "content") return `attacker-value-${proxyGets}`;
      return Reflect.get(object, key, receiver);
    }
  });
  const ai = createAiActions({
    action: (_endpoint, body) => {
      writtenBody = body;
      return new Promise((resolve) => { releaseWrite = () => resolve(rawResult); });
    }
  });

  const pending = ai.rememberIntelligence(payload);
  target.title = "mutated after validation";
  target.content = "mutated after validation";
  target.tags.push("mutated");
  releaseWrite();

  assert.equal(await pending, rawResult);
  assert.notEqual(writtenBody, payload);
  assert.deepEqual(writtenBody, {
    layer: "semantic",
    title: "CPI context",
    content: "reanalyze only",
    tags: ["intel", "context"],
    source: "intel"
  });
  assert.equal(proxyGets, 0);
});

test("revoked memory payload and tags proxies return the exact frozen invalid result without writes", () => {
  let writes = 0;
  const ai = createAiActions({
    action: async () => { writes += 1; return { ok: true }; }
  });
  const expected = ai.rememberIntelligence(null);
  const revokedPayload = Proxy.revocable({ title: "CPI", content: "context" }, {});
  const revokedTags = Proxy.revocable(["intel"], {});
  const nestedPayload = { title: "CPI", content: "context", tags: revokedTags.proxy };
  revokedPayload.revoke();
  revokedTags.revoke();

  let payloadResult;
  let tagsResult;
  assert.doesNotThrow(() => { payloadResult = ai.rememberIntelligence(revokedPayload.proxy); });
  assert.doesNotThrow(() => { tagsResult = ai.rememberIntelligence(nestedPayload); });
  assert.equal(Object.isFrozen(expected), true);
  assert.equal(payloadResult, expected);
  assert.equal(tagsResult, expected);
  assert.equal(writes, 0);
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
