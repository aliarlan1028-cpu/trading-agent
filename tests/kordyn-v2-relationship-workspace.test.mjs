import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-relationship-workspace");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { default as React } from "react";
      export { renderToStaticMarkup } from "react-dom/server";
      export { buildAssetsDomainModel } from "./src/kordynV2/domains/assets/assetsModel.js";
      export { RelationshipWorkspace } from "./src/kordynV2/domains/assets/RelationshipWorkspace.jsx";
      export { MobileRelationshipScreen } from "./src/kordynV2/domains/assets/MobileRelationshipScreen.jsx";
      export { RelationshipInspector } from "./src/kordynV2/domains/assets/RelationshipInspector.jsx";
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
const {
  React,
  renderToStaticMarkup,
  buildAssetsDomainModel,
  RelationshipWorkspace,
  MobileRelationshipScreen,
  RelationshipInspector
} = require(outFile);

const data = {
  resourceState: { researchCenter: "loaded", chat: "loaded", cockpit: "loaded" },
  agentRuns: [{ id: "mission-1", goal: "监控 BTC 突破机会", status: "running", strategyVersionId: "native-v3", capabilityIds: ["capability-1"], sourceIds: ["source-1"] }],
  strategyCatalog: {
    products: [{
      id: "native",
      versionId: "native-v3",
      version: 3,
      definition: { name: "Breakout Retest", family: "breakout", timeframes: ["1h"] },
      deployment: { state: "active" }
    }]
  },
  knowledge: {
    sources: [{ id: "source-1", title: "Trading Systems", type: "book", status: "parsed" }],
    chunks: [{ id: "evidence-1", sourceId: "source-1", text: "A validated breakout requires retest evidence." }]
  },
  analysisEngine: { tools: [{ id: "capability-1", name: "Market structure", native: true, status: "ready" }] },
  reviews: [{ id: "review-1", type: "trade", status: "completed", title: "BTC closed-trade review", strategyVersionId: "native-v3" }],
  ownerReviewLoop: { summary: { pendingOwner: 2 }, lessons: [], improvements: [] }
};
const model = buildAssetsDomainModel(data);
const noop = () => {};

test("relationship overview renders every canonical asset type and only source-backed edges", () => {
  const html = renderToStaticMarkup(React.createElement(RelationshipWorkspace, {
    model,
    selectedNodeId: "Strategy:product_native-v3",
    onSelect: noop,
    onNavigate: noop
  }));

  for (const type of ["Mission", "Strategy", "Knowledge source", "Capability", "Review"]) {
    assert.match(html, new RegExp(`data-kordyn-v2-object-type="${type}"`));
  }
  assert.equal((html.match(/data-kordyn-v2-relation=/g) || []).length, model.relationships.edges.length);
  assert.match(html, /data-kordyn-v2-assets-workspace="relationships"/);
  assert.match(html, /data-kordyn-v2-relationship-inspector="Strategy:product_native-v3"/);
  assert.match(html, /System native/);
  assert.match(html, /Open strategy registry|打开策略库/);
});

test("the APP relationship surface is a touch thread, not a squeezed SVG topology", () => {
  const html = renderToStaticMarkup(React.createElement(MobileRelationshipScreen, {
    model,
    selectedNodeId: "Mission:mission-1",
    onSelect: noop,
    onNavigate: noop
  }));

  assert.match(html, /data-kordyn-v2-assets-mobile="relationships"/);
  assert.match(html, /data-kordyn-v2-relationship-thread/);
  assert.doesNotMatch(html, /<svg[^>]*data-kordyn-v2-relationship-graph/);
  assert.equal((html.match(/data-kordyn-v2-mobile-relation=/g) || []).length, model.relationships.nodes.length);
  assert.match(html, /AI 交易员正在使用什么，以及为什么/);
  assert.match(html, /data-kordyn-v2-mobile-object-detail="Mission:mission-1"/);
});

test("relationship inspector keeps unavailable provenance unavailable and routes by object family", () => {
  const unknown = {
    id: "Strategy:unknown",
    objectId: "unknown",
    type: "Strategy",
    label: "Unknown strategy",
    status: "unavailable",
    provenance: { kind: "unknown", label: "Unavailable", sourceId: null, sourceTitle: null, methodId: null },
    raw: {}
  };
  const html = renderToStaticMarkup(React.createElement(RelationshipInspector, { node: unknown, onNavigate: noop }));

  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /Verified|已验证/);
  assert.match(html, /data-kordyn-v2-authoritative-workspace="strategies"/);
});

test("an empty relationship model explains no result without inventing nodes or actions", () => {
  const emptyModel = buildAssetsDomainModel({ knowledge: { sources: [] } });
  const desktop = renderToStaticMarkup(React.createElement(RelationshipWorkspace, { model: emptyModel, onSelect: noop, onNavigate: noop }));
  const mobile = renderToStaticMarkup(React.createElement(MobileRelationshipScreen, { model: emptyModel, onSelect: noop, onNavigate: noop }));

  assert.match(desktop, /No loaded relationships|暂无已加载关系/);
  assert.match(mobile, /No loaded relationships|暂无已加载关系/);
  assert.equal((desktop.match(/data-kordyn-v2-object-type=/g) || []).length, 0);
  assert.equal((mobile.match(/data-kordyn-v2-mobile-relation=/g) || []).length, 0);
});

test("the authenticated V2 root lazy-loads the real intelligent-assets domain", () => {
  const source = fs.readFileSync(path.join(rootDir, "src/kordynV2/KordynV2Root.jsx"), "utf8");

  assert.match(source, /assets:\s*\(\) => import\("\.\/domains\/assets\/index\.jsx"\)/);
  assert.match(source, /const LazyAssetsDomain = lazy\(domainLoaders\.assets\)/);
  assert.match(source, /<LazyAssetsDomain/);
  assert.match(source, /actions=\{actions\.assets\}/);
  assert.match(source, /location\.domainId === "assets"/);
});
