import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-strategy-workspace");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { default as React } from "react";
      export { renderToStaticMarkup } from "react-dom/server";
      export { buildAssetsDomainModel } from "./src/kordynV2/domains/assets/assetsModel.js";
      export { StrategyWorkspace } from "./src/kordynV2/domains/assets/StrategyWorkspace.jsx";
      export { StrategyRegistry } from "./src/kordynV2/domains/assets/StrategyRegistry.jsx";
      export { StrategyStudio } from "./src/kordynV2/domains/assets/StrategyStudio.jsx";
      export { MobileStrategyScreen } from "./src/kordynV2/domains/assets/MobileStrategyScreen.jsx";
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
const { React, renderToStaticMarkup, buildAssetsDomainModel, StrategyWorkspace, StrategyRegistry, StrategyStudio, MobileStrategyScreen } = require(outFile);

const data = {
  strategyCatalog: {
    products: [{
      id: "breakout",
      versionId: "breakout-v3",
      version: 3,
      definition: {
        name: "Breakout Retest",
        family: "breakout",
        direction: "both",
        timeframes: ["15m", "1h"],
        regimes: ["trend"],
        invalidation: ["failed retest"]
      },
      deployment: { state: "active", evidenceStatus: "live_validated" },
      metrics: { plans: 20, closedTrades: 12, winRatePct: 58, profitFactor: 1.7 }
    }]
  },
  knowledge: {
    tradingSkills: [{
      id: "knowledge-strategy",
      name: "Liquidity Sweep Reversal",
      version: "0.7",
      status: "live_probation",
      methodId: "method-1",
      sourceId: "source-1",
      approval: { approved: true }
    }]
  },
  skills: [{ id: "imported-strategy", name: "Event Drift Guard", kind: "strategy", status: "active", source: "github", version: "0.3" }],
  strategyStudio: {
    drafts: [{
      id: "draft-incomplete",
      status: "tests_passed",
      contentHash: "draft-hash",
      blueprint: {
        name: "BTC Retest Draft",
        symbols: ["BTC/USDT", "ETH/USDT"],
        timeframe: "1h",
        direction: "long",
        templateName: "Breakout retest",
        exitPolicy: { stopLossPct: 2, takeProfitR: 2.5 }
      },
      generatedTests: { status: "passed", passed: 6, total: 6, tests: [{ id: "schema", passed: true, name: "Schema" }] },
      backtestIdsBySymbol: { "BTC/USDT": "bt-1", "ETH/USDT": "bt-2" }
    }],
    backtests: [
      { id: "bt-1", draftId: "draft-incomplete", draftHash: "draft-hash", symbol: "BTC/USDT", passed: true },
      { id: "bt-2", draftId: "draft-incomplete", draftHash: "old-hash", symbol: "ETH/USDT", passed: true }
    ],
    marketplace: { listings: [{ id: "listing-1", title: "Trend Pro", strategyVersionId: "trend-v2", source: "strategy_studio", enabled: false }] }
  }
};
const model = buildAssetsDomainModel(data);
const actions = {
  runStrategyResearch: () => {},
  createStrategyDraft: () => {},
  testStrategyDraft: () => {},
  backtestStrategyDraft: () => {},
  publishStrategyDraft: () => {},
  enableStrategy: () => {},
  disableStrategy: () => {}
};
const noop = () => {};

test("strategy registry labels native, imported, and knowledge-derived provenance explicitly", () => {
  const html = renderToStaticMarkup(React.createElement(StrategyRegistry, { rows: model.strategies, selectedId: "product_breakout-v3", onSelect: noop }));

  for (const kind of ["system-native", "imported", "knowledge-derived"]) {
    assert.match(html, new RegExp(`data-provenance="${kind}"`));
  }
  assert.match(html, /Breakout Retest/);
  assert.match(html, /Liquidity Sweep Reversal/);
  assert.match(html, /Event Drift Guard/);
});

test("strategy publish stays disabled until generated tests and every-symbol current OOS pass", () => {
  const incomplete = renderToStaticMarkup(React.createElement(StrategyStudio, { drafts: model.studio.drafts, actions }));
  assert.match(incomplete, /data-kordyn-v2-action="publish"[^>]*disabled/);
  assert.match(incomplete, /<small>ETH\/USDT<\/small><strong>stale<\/strong>/);

  const readyDraft = {
    ...model.studio.drafts[0],
    validation: {
      testsPassed: true,
      oos: { complete: true, rows: [{ symbol: "BTC/USDT", status: "passed", passed: true }] }
    },
    release: { ready: true, state: "ready", versionId: null }
  };
  const ready = renderToStaticMarkup(React.createElement(StrategyStudio, { drafts: [readyDraft], actions }));
  assert.match(ready, /data-kordyn-v2-action="publish"/);
  assert.doesNotMatch(ready, /data-kordyn-v2-action="publish"[^>]*disabled/);
});

test("desktop strategy workbench keeps registry, selected truth, lineage, validation and Studio together", () => {
  const html = renderToStaticMarkup(React.createElement(StrategyWorkspace, {
    model,
    actions,
    selectedStrategyId: "product_breakout-v3",
    onSelect: noop,
    onNavigate: noop
  }));

  assert.match(html, /data-kordyn-v2-assets-workspace="strategies"/);
  assert.match(html, /data-kordyn-v2-strategy-registry/);
  assert.match(html, /data-kordyn-v2-strategy-inspector="product_breakout-v3"/);
  assert.match(html, /data-kordyn-v2-strategy-studio/);
  assert.match(html, /策略工作室/);
  assert.match(html, /不会直接启动实盘/);
});

test("mobile strategy flow is registry to detail to validation/release, not a desktop table", () => {
  const html = renderToStaticMarkup(React.createElement(MobileStrategyScreen, {
    model,
    actions,
    selectedStrategyId: "knowledge-strategy",
    onSelect: noop,
    onNavigate: noop
  }));

  assert.match(html, /data-kordyn-v2-assets-mobile="strategies"/);
  assert.match(html, /data-kordyn-v2-mobile-strategy-detail="knowledge-strategy"/);
  assert.match(html, /data-kordyn-v2-mobile-strategy-validation/);
  assert.doesNotMatch(html, /<table/);
  assert.match(html, /知识派生|Knowledge derived/);
});

test("system-native strategy availability is not presented as a user toggle", () => {
  const html = renderToStaticMarkup(React.createElement(StrategyWorkspace, {
    model,
    actions,
    selectedStrategyId: "product_breakout-v3",
    onSelect: noop,
    onNavigate: noop
  }));

  assert.match(html, /data-kordyn-v2-strategy-toggle="system-managed"[^>]*disabled/);
  assert.doesNotMatch(html, /data-kordyn-v2-strategy-toggle="system-managed"[^>]*>[^<]*(Disable|停用)/);
});
