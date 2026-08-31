import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-assets-actions");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { createAssetsActions } from "./src/kordynV2/domains/assets/assetsActions.js";
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
const { createAssetsActions, createV2Actions } = require(outFile);

test("knowledge, strategy, capability, and release actions retain deployed endpoints", async () => {
  const calls = [];
  const assets = createAssetsActions({
    action: async (...args) => { calls.push(args); return { ok: true }; },
    confirm: async () => true
  });

  await assets.parseSource("source/1");
  await assets.convertSource("source/1", "Trading Systems");
  await assets.ignoreCandidate("candidate-1");
  await assets.adoptCandidate("candidate-1");
  await assets.approveCandidate("candidate-1", "v2");
  await assets.compileMethod("method-1");
  await assets.validateSkill("skill-1");
  await assets.startSkillPaper("skill-1");
  await assets.syncSkills();
  await assets.approveSkill("skill-1", "sha256:abc");
  await assets.runStrategyResearch();
  await assets.createStrategyDraft("Trade the validated breakout template");
  await assets.testStrategyDraft("draft-1");
  await assets.backtestStrategyDraft("draft-1", "BTC/USDT");
  await assets.publishStrategyDraft("draft-1", "v4");
  await assets.enableStrategy("strategy/v4");
  await assets.disableStrategy("strategy/v4");
  await assets.enableCapability("capability/1");
  await assets.disableCapability("capability/1");
  await assets.decideLesson("lesson-1", "approve", { note: "evidence retained" });
  await assets.decideImprovement("improvement-1", "verify", {
    ownerAttested: true,
    validationEvidence: [{ type: "regression_test", value: "assets suite passed" }]
  });
  await assets.startPureForwardSession("improvement-1", "ETH/USDT");

  assert.deepEqual(calls, [
    ["/api/knowledge/sources/source%2F1/parse-real", {}],
    ["/api/knowledge/convert", { sourceId: "source/1" }],
    ["/api/knowledge/candidates/candidate-1/ignore", {}],
    ["/api/knowledge/candidates/candidate-1/adopt", {}],
    ["/api/knowledge/candidates/candidate-1/approve-prompt", {}],
    ["/api/knowledge/methods/method-1/compile", {}],
    ["/api/knowledge/skills/skill-1/validate", {}],
    ["/api/knowledge/skills/skill-1/paper", {}],
    ["/api/knowledge/skills/sync", {}],
    ["/api/knowledge/skills/skill-1/approve", {}],
    ["/api/strategy/research", {}],
    ["/api/strategy/studio/drafts", { prompt: "Trade the validated breakout template" }],
    ["/api/strategy/studio/drafts/draft-1/tests", {}],
    ["/api/strategy/studio/drafts/draft-1/backtest", { symbol: "BTC/USDT" }],
    ["/api/strategy/studio/drafts/draft-1/publish", {}],
    ["/api/strategy/market/strategy%2Fv4/enable", {}],
    ["/api/strategy/market/strategy%2Fv4/disable", {}],
    ["/api/skills/capability%2F1/enable", {}],
    ["/api/skills/capability%2F1/disable", {}],
    ["/api/review/lessons/lesson-1/action", { action: "approve", note: "evidence retained" }],
    ["/api/review/improvements/improvement-1/action", {
      action: "verify",
      ownerAttested: true,
      validationEvidence: [{ type: "regression_test", value: "assets suite passed" }]
    }],
    ["/api/review/improvements/improvement-1/paper/start", { symbol: "ETH/USDT" }]
  ]);
});

test("release confirmations identify the selected object and version", async () => {
  const confirmations = [];
  const assets = createAssetsActions({
    action: async () => ({ ok: true }),
    confirm: async (...args) => { confirmations.push(args); return true; }
  });

  await assets.convertSource("source-1", "Trading Systems");
  await assets.approveCandidate("candidate-1", "v2");
  await assets.approveSkill("skill-1", "sha256:abc");
  await assets.publishStrategyDraft("draft-1", "v4");
  await assets.enableStrategy("strategy-v4");
  await assets.disableCapability("capability-1");
  await assets.decideImprovement("improvement-1", "reject", { version: "v7" });

  const text = confirmations.map(([message]) => message).join("\n");
  for (const value of ["Trading Systems", "source-1", "candidate-1", "v2", "skill-1", "sha256:abc", "draft-1", "v4", "strategy-v4", "capability-1", "improvement-1", "v7"]) {
    assert.match(text, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), value);
  }
});

test("rejected confirmations never cross a deployed write boundary", async () => {
  let writes = 0;
  const assets = createAssetsActions({
    action: async () => { writes += 1; return { ok: true }; },
    confirm: async () => false
  });

  for (const result of await Promise.all([
    assets.convertSource("source-1", "Book"),
    assets.approveCandidate("candidate-1", "v2"),
    assets.approveSkill("skill-1", "fingerprint"),
    assets.publishStrategyDraft("draft-1", "v4"),
    assets.enableStrategy("strategy-v4"),
    assets.disableCapability("capability-1"),
    assets.decideImprovement("improvement-1", "reject", { version: "v7" })
  ])) assert.deepEqual(result, { ok: false, cancelled: true });
  assert.equal(writes, 0);
});

test("Owner verification requires explicit attestation and evidence before the request", async () => {
  let writes = 0;
  const assets = createAssetsActions({
    action: async () => { writes += 1; return { ok: true }; },
    confirm: async () => true
  });

  assert.deepEqual(await assets.decideImprovement("improvement-1", "verify", {}), {
    ok: false,
    error: "owner_validation_attestation_required"
  });
  assert.deepEqual(await assets.decideImprovement("improvement-1", "verify", { ownerAttested: true }), {
    ok: false,
    error: "owner_validation_evidence_required"
  });
  assert.equal(writes, 0);
});

test("malformed identifiers, symbols, prompts, commands, and hostile dependency inputs fail closed", async () => {
  const calls = [];
  const assets = createAssetsActions({
    action: async (...args) => { calls.push(args); return { ok: true }; },
    confirm: async () => true
  });
  const invalidIds = [undefined, null, "", " bad", "bad id", "bad\n", 7, 7n, Symbol("id"), [], {}];

  for (const id of invalidIds) {
    assert.deepEqual(await assets.parseSource(id), { ok: false, error: "invalid_assets_action_input" });
    assert.deepEqual(await assets.enableCapability(id), { ok: false, error: "invalid_assets_action_input" });
  }
  assert.deepEqual(await assets.backtestStrategyDraft("draft-1", "BTC USDT"), { ok: false, error: "invalid_assets_action_input" });
  assert.deepEqual(await assets.createStrategyDraft("   "), { ok: false, error: "invalid_assets_action_input" });
  assert.deepEqual(await assets.decideLesson("lesson-1", "rewrite-live-strategy"), { ok: false, error: "invalid_assets_action_input" });
  assert.deepEqual(
    await assets.decideLesson("lesson-1", "approve", { action: "rewrite-live-strategy" }),
    { ok: true }
  );
  assert.deepEqual(calls.at(-1), ["/api/review/lessons/lesson-1/action", { action: "approve" }]);
  calls.length = 0;
  assert.equal(calls.length, 0);

  const throwing = {};
  Object.defineProperty(throwing, "action", { get() { throw new Error("hostile getter"); } });
  for (const deps of [null, 4, "bad", throwing]) {
    let safe;
    assert.doesNotThrow(() => { safe = createAssetsActions(deps); });
    assert.deepEqual(await safe.parseSource("source-1"), { ok: false, error: "action_unavailable" });
    assert.deepEqual(await safe.convertSource("source-1", "Book"), { ok: false, cancelled: true });
  }
});

test("the V2 action facade exposes the same frozen assets action identity", async () => {
  const actions = createV2Actions({ action: async () => ({ ok: true }), confirm: async () => true });

  assert.equal(typeof actions.assets.parseSource, "function");
  assert.equal(typeof actions.assets.publishStrategyDraft, "function");
  assert.equal(Object.isFrozen(actions.assets), true);
  assert.deepEqual(await actions.assets.parseSource("source-1"), { ok: true });
});

test("deployed server success and failure objects are returned without optimistic rewriting", async () => {
  const serverFailure = { ok: false, httpStatus: 409, error: "strategy_validation_evidence_incomplete" };
  const assets = createAssetsActions({ action: async () => serverFailure, confirm: async () => true });

  assert.equal(await assets.publishStrategyDraft("draft-1", "v4"), serverFailure);
  assert.equal(await assets.startPureForwardSession("improvement-1", "BTC/USDT"), serverFailure);
});
