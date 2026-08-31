import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-knowledge-capability");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { default as React } from "react";
      export { renderToStaticMarkup } from "react-dom/server";
      export { buildAssetsDomainModel } from "./src/kordynV2/domains/assets/assetsModel.js";
      export { KnowledgeWorkspace } from "./src/kordynV2/domains/assets/KnowledgeWorkspace.jsx";
      export { CapabilityWorkspace } from "./src/kordynV2/domains/assets/CapabilityWorkspace.jsx";
      export { CapabilityInspector } from "./src/kordynV2/domains/assets/CapabilityInspector.jsx";
      export { MobileKnowledgeScreen } from "./src/kordynV2/domains/assets/MobileKnowledgeScreen.jsx";
      export { MobileCapabilityScreen } from "./src/kordynV2/domains/assets/MobileCapabilityScreen.jsx";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  outfile: outFile,
  logLevel: "silent"
});
const { React, renderToStaticMarkup, buildAssetsDomainModel, KnowledgeWorkspace, CapabilityWorkspace, CapabilityInspector, MobileKnowledgeScreen, MobileCapabilityScreen } = require(outFile);

const data = {
  knowledge: {
    sources: [
      { id: "source-book", title: "Algorithmic Trading Systems", type: "pdf", status: "parsed", parserVersion: "2.4", updatedAt: "2026-08-22T14:11:00Z" },
      { id: "source-failed", title: "Event Risk Playbook", type: "web", status: "parse_failed" }
    ],
    chunks: [
      { id: "evidence-1", sourceId: "source-book", page: 84, text: "Breakout confirmation requires volume expansion and retest evidence." },
      { id: "evidence-2", sourceId: "source-book", page: 131, text: "Slippage constraints belong in deterministic preflight." }
    ],
    candidates: [
      { id: "candidate-strategy", sourceId: "source-book", type: "strategy", status: "candidate", title: "Volume-confirmed Breakout" },
      { id: "candidate-lens", sourceId: "source-book", type: "lens", status: "adopted", title: "Evidence Retrieval Lens" },
      { id: "candidate-workflow", sourceId: "source-book", type: "workflow", status: "candidate", title: "Preflight Evidence Workflow" },
      { id: "candidate-imported", sourceId: "source-book", type: "imported_skill", status: "candidate", title: "Research Summary Skill" }
    ],
    tradingMethods: [{ id: "method-1", sourceId: "source-book", name: "Volume retest", status: "candidate" }],
    ruleProposals: [{ id: "rule-1", sourceId: "source-book", title: "Slippage preflight", status: "candidate" }]
  },
  analysisEngine: { tools: [{ id: "native-risk", name: "风险预检", native: true, status: "ready", version: "3.2", permission: "account.read", runs: 416 }] },
  skills: [{ id: "imported-summary", name: "研究摘要 Skill", kind: "analysis", status: "trusted", version: "0.6", source: "uploaded" }],
  mcpServers: [{ id: "event-mcp", serverName: "Event MCP", transport: "stdio", status: "registered", version: "1.1", grant: null, tools: ["events.read"] }],
  toolCallStats: { "风险预检": { calls: 416, success: 410, blocked: 4, error: 2, latencySamples: 416, totalLatencyMs: 39000 } }
};
const model = buildAssetsDomainModel(data);
const actions = {
  parseSource: () => {}, convertSource: () => {}, ignoreCandidate: () => {}, adoptCandidate: () => {}, approveCandidate: () => {},
  compileMethod: () => {}, enableCapability: () => {}, disableCapability: () => {}
};
const noop = () => {};

test("knowledge workspace exposes only deployed artifact destinations and bounded graduation actions", () => {
  const html = renderToStaticMarkup(React.createElement(KnowledgeWorkspace, { model, actions, onSelect: noop, onNavigate: noop }));

  for (const type of ["strategy_draft", "knowledge_lens", "knowledge_workflow", "imported_skill_record"]) {
    assert.match(html, new RegExp(`data-artifact-type="${type}"`));
  }
  assert.doesNotMatch(html, /任意代码|arbitrary executable|generate tool code/i);
  assert.match(html, /data-kordyn-v2-knowledge-source="source-book"/);
  assert.match(html, /data-kordyn-v2-evidence-id="evidence-1"/);
  assert.match(html, /data-kordyn-v2-candidate-id="candidate-strategy"/);
  assert.match(html, /原文证据/);
});

test("MCP grants are explicit and fail closed", () => {
  const capability = model.capabilities.find((row) => row.category === "mcp");
  const html = renderToStaticMarkup(React.createElement(CapabilityInspector, { capability, actions }));

  assert.match(html, /未授权|Not granted/);
  assert.match(html, /data-kordyn-v2-mcp-grant="not-granted"/);
  assert.doesNotMatch(html, /可调用|Available to call/);
  assert.match(html, /disabled/);
});

test("capability registry keeps provenance, health, version, calls, permissions and explicit MCP boundary", () => {
  const html = renderToStaticMarkup(React.createElement(CapabilityWorkspace, { model, actions, selectedCapabilityId: "native-risk", onSelect: noop, onNavigate: noop }));

  assert.match(html, /data-kordyn-v2-assets-workspace="capabilities"/);
  assert.match(html, /data-kordyn-v2-capability-registry/);
  assert.match(html, /风险预检/);
  assert.match(html, /416/);
  assert.match(html, /Event MCP/);
  assert.match(html, /未知工具默认拒绝/);
});

test("APP keeps knowledge source/candidate and capability/grant as separate touch flows", () => {
  const knowledge = renderToStaticMarkup(React.createElement(MobileKnowledgeScreen, { model, actions, onSelect: noop, onNavigate: noop }));
  const capability = renderToStaticMarkup(React.createElement(MobileCapabilityScreen, { model, actions, onSelect: noop, onNavigate: noop }));

  assert.match(knowledge, /data-kordyn-v2-assets-mobile="knowledge"/);
  assert.match(knowledge, /data-kordyn-v2-mobile-source-flow/);
  assert.match(knowledge, /data-kordyn-v2-mobile-candidate-flow/);
  assert.match(capability, /data-kordyn-v2-assets-mobile="capabilities"/);
  assert.match(capability, /data-kordyn-v2-mobile-capability-flow/);
  assert.match(capability, /data-kordyn-v2-mobile-grant-flow/);
  assert.doesNotMatch(knowledge + capability, /<table/);
});

test("failed source and missing grant never become healthy or enabled UI facts", () => {
  const knowledge = renderToStaticMarkup(React.createElement(KnowledgeWorkspace, { model, actions, onSelect: noop, onNavigate: noop }));
  const mcp = model.capabilities.find((row) => row.category === "mcp");
  const capability = renderToStaticMarkup(React.createElement(CapabilityInspector, { capability: mcp, actions }));

  assert.match(knowledge, /data-source-stage="failed"/);
  assert.doesNotMatch(knowledge, /data-kordyn-v2-knowledge-source="source-failed"[^>]*data-source-stage="active"/);
  assert.match(capability, /data-kordyn-v2-capability-action="toggle"[^>]*disabled/);
});
