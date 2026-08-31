import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-assets-model");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { buildAssetsDomainModel } from "./src/kordynV2/domains/assets/assetsModel.js";
      export { assetProvenance } from "./src/kordynV2/domains/assets/provenance.js";
      export { assetLifecycle } from "./src/kordynV2/domains/assets/lifecycle.js";
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
const { assetLifecycle, assetProvenance, buildAssetsDomainModel } = require(outFile);

const fixture = {
  strategyCatalog: {
    products: [{
      id: "native-product",
      versionId: "native-v3",
      version: 3,
      definition: { name: "Native Breakout", family: "breakout", timeframes: ["1h"] },
      deployment: { state: "active" }
    }]
  },
  knowledge: {
    sources: [{ id: "source-1", title: "Trading Systems", status: "parsed", type: "book" }],
    chunks: [{ id: "evidence-1", sourceId: "source-1", text: "Evidence" }],
    candidates: [{ id: "candidate-1", sourceId: "source-1", type: "strategy", status: "candidate", title: "Candidate" }],
    tradingSkills: [{
      id: "knowledge-strategy",
      name: "Evidence Trend",
      status: "active",
      methodId: "method-1",
      sourceId: "source-1",
      approval: { approved: true }
    }],
    workflows: [{
      id: "knowledge-workflow",
      title: "Evidence packet",
      sourceId: "source-1",
      sourceTitle: "Trading Systems",
      runtimeApproved: true,
      publishedEligible: true
    }]
  },
  skills: [
    { id: "imported-strategy", name: "Imported Mean Reversion", kind: "strategy", status: "active", source: "github" },
    { id: "imported-capability", name: "Imported Scanner", kind: "analysis", status: "trusted", source: "uploaded" }
  ],
  analysisEngine: { tools: [{ id: "native-capability", name: "Market regime", native: true, status: "ready" }] },
  strategyStudio: {
    drafts: [{
      id: "draft-1",
      contentHash: "draft-hash",
      generatedTests: { status: "passed" },
      blueprint: { symbols: ["BTC/USDT", "ETH/USDT"] },
      backtestIdsBySymbol: { "BTC/USDT": "bt-1", "ETH/USDT": "bt-2" }
    }],
    backtests: [
      { id: "bt-1", draftId: "draft-1", draftHash: "draft-hash", symbol: "BTC/USDT", passed: true },
      { id: "bt-2", draftId: "draft-1", draftHash: "stale-hash", symbol: "ETH/USDT", passed: true }
    ]
  },
  reviews: [{ id: "review-1", status: "completed", type: "trade", strategyVersionId: "native-v3" }],
  ownerReviewLoop: {
    lessons: [{ id: "lesson-1", status: "candidate", reviewId: "review-1" }],
    improvements: [{ id: "improvement-1", state: "pending_owner", reviewId: "review-1", destination: "strategy" }]
  },
  missions: [{ id: "mission-1", title: "Check BTC", strategyVersionId: "native-v3" }]
};

test("native, imported, and knowledge-derived products remain distinct", () => {
  const before = structuredClone(fixture);
  const model = buildAssetsDomainModel(fixture);
  const provenance = Object.fromEntries(model.strategies.map((row) => [row.id, row.provenance]));

  assert.equal(provenance["product_native-v3"].kind, "system-native");
  assert.equal(provenance["imported-strategy"].kind, "imported");
  assert.equal(provenance["knowledge-strategy"].kind, "knowledge-derived");
  assert.equal(provenance["knowledge-strategy"].sourceId, "source-1");
  assert.deepEqual(fixture, before, "asset projection must not mutate production facts");
});

test("knowledge candidates remain in incubation until a deployed registry row exists", () => {
  const model = buildAssetsDomainModel({
    knowledge: { candidates: [{ id: "c-1", type: "strategy", status: "candidate", sourceId: "s-1" }] }
  });

  assert.equal(model.strategyRegistry.some((row) => row.id === "c-1"), false);
  assert.equal(model.capabilityRegistry.some((row) => row.id === "c-1"), false);
  assert.equal(model.incubation.candidates[0].lifecycle.stage, "candidate");
  assert.equal(model.incubation.candidates[0].provenance.kind, "knowledge-derived");
});

test("capability provenance separates native, imported, and approved knowledge workflows", () => {
  const model = buildAssetsDomainModel(fixture);
  const provenance = Object.fromEntries(model.capabilities.map((row) => [row.id, row.provenance.kind]));

  assert.equal(provenance["native-capability"], "system-native");
  assert.equal(provenance["imported-capability"], "imported");
  assert.equal(provenance["knowledge-workflow"], "knowledge-derived");
});

test("strategy drafts retain generated-test truth and per-symbol OOS coverage", () => {
  const draft = buildAssetsDomainModel(fixture).studio.drafts[0];

  assert.equal(draft.generatedTests.status, "passed");
  assert.equal(draft.validation.oos.complete, false);
  assert.deepEqual(draft.validation.oos.rows.map((row) => [row.symbol, row.status]), [
    ["BTC/USDT", "passed"],
    ["ETH/USDT", "stale"]
  ]);
  assert.equal(draft.release.ready, false);
});

test("relationship edges are emitted only for explicit identities present in the model", () => {
  const relationships = buildAssetsDomainModel(fixture).relationships;
  const ids = new Set(relationships.nodes.map((node) => node.id));

  assert.ok(relationships.edges.length > 0);
  for (const edge of relationships.edges) {
    assert.equal(ids.has(edge.from), true, edge.id);
    assert.equal(ids.has(edge.to), true, edge.id);
    assert.notEqual(edge.inferred, true, edge.id);
  }
  assert.ok(relationships.edges.some((edge) => edge.from === "Knowledge source:source-1" && edge.to === "Strategy:knowledge-strategy"));
  assert.ok(relationships.edges.some((edge) => edge.from === "Mission:mission-1" && edge.to === "Strategy:product_native-v3"));
});

test("provenance and lifecycle fail closed for missing or unsupported facts", () => {
  assert.deepEqual(assetProvenance({}), {
    kind: "unknown",
    label: "Unavailable",
    sourceId: null,
    sourceTitle: null,
    methodId: null
  });
  assert.equal(assetLifecycle({}).stage, "unavailable");
  assert.equal(assetLifecycle({ status: "candidate" }).stage, "candidate");
  assert.equal(assetLifecycle({ status: "live_probation" }).stage, "active");
  assert.equal(assetLifecycle({ status: "compile_failed" }).stage, "failed");
});

test("invalid root inputs are bounded and do not invent loaded registries", () => {
  for (const value of [null, undefined, 7, "bad", [], Symbol("bad")]) {
    let model;
    assert.doesNotThrow(() => { model = buildAssetsDomainModel(value); });
    assert.deepEqual(model.strategies, []);
    assert.deepEqual(model.capabilities, []);
    assert.deepEqual(model.incubation.candidates, []);
    assert.deepEqual(model.relationships.edges, []);
  }
});
