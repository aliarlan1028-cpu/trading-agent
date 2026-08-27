import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-ai-support");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { AiSupport } from "./src/kordynV2/shell/AiSupport.jsx";
      export { MobileSheet } from "./src/kordynV2/shell/MobileSheet.jsx";
      export {
        buildAiSupportContext,
        buildAiSupportSuggestions,
        resolveAiSupportDestination
      } from "./src/kordynV2/viewModels/aiSupport.js";
      export { v2LocationForWorkspace } from "./src/kordynV2/architecture/routes.js";
      export { createV2Selection } from "./src/kordynV2/viewModels/selection.js";
      export { normalizeResourceState } from "./src/kordynV2/viewModels/state.js";
      export { parseJsonResponseText } from "./src/jsonResponseProvenance.js";
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

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  AiSupport,
  MobileSheet,
  buildAiSupportContext,
  buildAiSupportSuggestions,
  createV2Selection,
  normalizeResourceState,
  parseJsonResponseText,
  resolveAiSupportDestination,
  v2LocationForWorkspace
} = require(outFile);

const trustedData = () => parseJsonResponseText(JSON.stringify({
  source: "Read-only exchange projection",
  asOf: "2026-08-27T06:32:11Z",
  apiKey: "sk-never-project",
  credentials: { secret: "credential-never-project" },
  portfolio: {
    totalEquityUsdt: 28640.72,
    availableMarginUsdt: 13870.1,
    source: "Read-only exchange projection",
    marginSyncedAt: "2026-08-27T06:32:11Z"
  },
  automationState: { label: "自动交易", runtimeStatus: "normal" },
  system: { riskStatus: "normal" },
  watchTriggers: [
    { id: "watch-eth-retest", title: "ETH 突破回踩机会", status: "active" }
  ]
}));

const location = v2LocationForWorkspace("ai", "missions", "desktop");
const selectionData = trustedData();
const selection = createV2Selection({
  data: selectionData,
  candidate: { id: "watch-eth-retest", type: "Watch" }
});
const stateFor = (resourceState) => normalizeResourceState({
  resourceState,
  data: {
    source: "Read-only exchange projection",
    asOf: "2026-08-27T06:32:11Z"
  }
});
const readyState = stateFor("loaded");

test("AI support projects only registered JSON-safe facts with exact top-level keys", () => {
  const context = buildAiSupportContext({ data: trustedData(), location, selection, state: readyState });

  assert.deepEqual(Object.keys(context).sort(), ["facts", "location", "selection", "state"]);
  assert.deepEqual(context.location, {
    domainId: "ai",
    domainLabel: "AI 交易员",
    workspaceId: "missions",
    workspaceLabel: "任务"
  });
  assert.deepEqual(context.selection, {
    id: "watch-eth-retest",
    type: "Watch",
    label: "ETH 突破回踩机会",
    status: "active"
  });
  assert.deepEqual(context.facts, {
    account: "28,640.72 USDT · 可用 13,870.10 USDT",
    asOf: "2026-08-27T06:32:11Z",
    risk: "normal",
    runtime: "自动交易 · normal",
    source: "Read-only exchange projection"
  });
  const serialized = JSON.stringify(context);
  assert.doesNotMatch(serialized, /sk-never-project|credential-never-project|apiKey|credentials/i);
  assert.deepEqual(JSON.parse(serialized), context);
});

test("AI support fails closed without invoking getters, proxies, or polluted prototypes", () => {
  let getterReads = 0;
  const getterData = {};
  Object.defineProperty(getterData, "source", {
    enumerable: true,
    get() { getterReads += 1; return "getter-secret"; }
  });
  let proxyReads = 0;
  const proxyData = new Proxy({}, {
    get() { proxyReads += 1; return "proxy-secret"; },
    getOwnPropertyDescriptor() { proxyReads += 1; throw new Error("blocked proxy descriptor"); }
  });
  const pollutedData = parseJsonResponseText('{"__proto__":{"source":"polluted"},"source":"trusted"}');

  for (const data of [getterData, proxyData]) {
    const context = buildAiSupportContext({ data, location, selection, state: readyState });
    assert.deepEqual(context.facts, {
      account: "Unavailable",
      asOf: "Unavailable",
      risk: "Unavailable",
      runtime: "Unavailable",
      source: "Unavailable"
    });
  }
  assert.equal(getterReads, 0);
  assert.equal(proxyReads, 0);
  assert.equal(buildAiSupportContext({ data: pollutedData, location, selection, state: readyState }).facts.source, "trusted");
});

test("AI support fails closed across malformed location, selection, and state without navigation callbacks", () => {
  let accessorReads = 0;
  let proxyTraps = 0;
  let nestedAccessorReads = 0;
  let nestedProxyTraps = 0;
  let navigationCalls = 0;
  const accessor = (value) => {
    const record = {};
    Object.defineProperty(record, "domainId", {
      enumerable: true,
      get() { accessorReads += 1; return value; }
    });
    Object.defineProperty(record, "kind", {
      enumerable: true,
      get() { accessorReads += 1; return "ready"; }
    });
    Object.defineProperty(record, "object", {
      enumerable: true,
      get() { accessorReads += 1; return { id: "hidden-object", type: "Order" }; }
    });
    return record;
  };
  const blockedProxy = new Proxy({}, {
    get() { proxyTraps += 1; return "hidden"; },
    getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error("blocked proxy descriptor"); }
  });
  const nestedAccessor = {};
  Object.defineProperty(nestedAccessor, "id", {
    enumerable: true,
    get() { nestedAccessorReads += 1; return "hidden-order"; }
  });
  Object.defineProperty(nestedAccessor, "type", {
    enumerable: true,
    get() { nestedAccessorReads += 1; return "Order"; }
  });
  const nestedProxy = new Proxy({}, {
    get() { nestedProxyTraps += 1; return "hidden"; },
    getOwnPropertyDescriptor() { nestedProxyTraps += 1; throw new Error("blocked nested proxy descriptor"); }
  });
  const nestedSelection = { object: nestedAccessor, context: nestedProxy };
  const inheritedLocation = Object.create({ domainId: "governance", workspaceId: "configuration" });
  const inheritedSelection = Object.create({ object: { id: "hidden-order", type: "Order" } });
  const inheritedState = Object.create({ kind: "ready", message: "hidden state" });

  for (const malformed of [accessor("governance"), blockedProxy, nestedSelection]) {
    const context = buildAiSupportContext({
      data: trustedData(),
      location: malformed,
      selection: malformed,
      state: malformed
    });
    assert.deepEqual(context.location, {
      domainId: "Unavailable",
      domainLabel: "Unavailable",
      workspaceId: "Unavailable",
      workspaceLabel: "Unavailable"
    });
    assert.deepEqual(context.selection, {
      id: "Unavailable",
      type: "Unavailable",
      label: "Unavailable",
      status: "Unavailable"
    });
    assert.equal(context.state.kind, "not_loaded");
    assert.deepEqual(buildAiSupportSuggestions({ state: malformed, selection: malformed }), []);
    const html = renderToStaticMarkup(React.createElement(AiSupport, {
      context,
      onNavigate: () => { navigationCalls += 1; },
      presentation: "content"
    }));
    assert.doesNotMatch(html, /data-kordyn-v2-ai-support-target=/);
  }

  const inherited = buildAiSupportContext({
    data: trustedData(),
    location: inheritedLocation,
    selection: inheritedSelection,
    state: inheritedState
  });
  assert.equal(inherited.location.domainId, "Unavailable");
  assert.equal(inherited.selection.id, "Unavailable");
  assert.equal(inherited.state.kind, "not_loaded");
  assert.equal(resolveAiSupportDestination(inheritedLocation), null);
  assert.equal(resolveAiSupportDestination(blockedProxy), null);
  assert.equal(accessorReads, 0);
  assert.equal(proxyTraps, 0);
  assert.equal(nestedAccessorReads, 0);
  assert.equal(nestedProxyTraps, 0);
  assert.equal(navigationCalls, 0);
});

test("AI support withholds current facts for forbidden and unproven stale states", () => {
  for (const state of [
    stateFor("forbidden"),
    normalizeResourceState({ resourceState: "stale", data: {} })
  ]) {
    const context = buildAiSupportContext({ data: trustedData(), location, selection, state });
    assert.deepEqual(context.facts, {
      account: "Unavailable",
      asOf: "Unavailable",
      risk: "Unavailable",
      runtime: "Unavailable",
      source: "Unavailable"
    });
  }
});

test("AI support keeps registered navigation for a trusted missing-selection context", () => {
  const context = buildAiSupportContext({
    data: {},
    location,
    selection: null,
    state: readyState
  });
  assert.equal(context.selection.id, "Unavailable");
  assert.deepEqual(buildAiSupportSuggestions(context).map((item) => `${item.domainId}/${item.workspaceId}`), [
    "governance/overview"
  ]);
});

test("AI support navigation resolves registered V2 destinations and rejects guesses", () => {
  const ready = buildAiSupportContext({ data: trustedData(), location, selection, state: readyState });
  const [registered] = buildAiSupportSuggestions(ready);
  assert.deepEqual(resolveAiSupportDestination(registered), {
    domainId: "governance",
    workspaceId: "overview",
    label: "查看运行总览"
  });
  assert.equal(resolveAiSupportDestination({ domainId: "governance", workspaceId: "overview" }), null);
  assert.equal(resolveAiSupportDestination({ domainId: "unknown", workspaceId: "invented" }), null);
  assert.equal(resolveAiSupportDestination({ domainId: "governance", workspaceId: "invented" }), null);

  const failed = buildAiSupportContext({
    data: trustedData(),
    location,
    selection,
    state: stateFor("failed")
  });
  assert.deepEqual(buildAiSupportSuggestions(failed).map((item) => `${item.domainId}/${item.workspaceId}`), [
    "governance/overview",
    "governance/recovery"
  ]);
});

test("AI support visibly identifies its read-only boundary and only renders registered navigation", () => {
  const context = buildAiSupportContext({ data: trustedData(), location, selection, state: readyState });
  const html = renderToStaticMarkup(React.createElement(AiSupport, {
    context,
    onNavigate: () => {},
    presentation: "content"
  }));

  assert.match(html, /AI 客服/);
  assert.match(html, /只读助理/);
  assert.match(html, /不能下单、授权或修改配置/);
  assert.match(html, /data-kordyn-v2-ai-support-target="governance\/overview"/);
  assert.doesNotMatch(html, /data-kordyn-v2-ai-support-target="unknown\//);
});

test("MobileSheet rejects unknown non-null panels instead of impersonating AI support", () => {
  const html = renderToStaticMarkup(React.createElement(MobileSheet, {
    panel: "invented-panel",
    selection,
    supportContext: buildAiSupportContext({ data: trustedData(), location, selection, state: readyState }),
    onSupportNavigate: () => assert.fail("unknown panels cannot navigate"),
    onClose: () => {}
  }));

  assert.equal(html, "");
});

test("AI support production modules expose no API, credential, action, or protected write authority", () => {
  const targets = [
    "src/kordynV2/shell/AiSupport.jsx",
    "src/kordynV2/viewModels/aiSupport.js"
  ].map((file) => fs.readFileSync(path.join(rootDir, file), "utf8")).join("\n");

  assert.doesNotMatch(targets, /createV2Actions|\/api\/|api\?\.|api\.|onApprove|onReject|onTrade|onOrder|onPublish|credential|secret|privateKey/i);
});
