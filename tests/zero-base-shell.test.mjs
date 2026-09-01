import assert from "node:assert/strict";
import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ZERO_BASE_FAMILIES } from "../src/zeroBaseArchitecture.js";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToString } = require("react-dom/server");
const esbuild = require("esbuild");
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "zero-base-shell-test");
fs.mkdirSync(cacheDir, { recursive: true });
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
esbuild.buildSync({
  stdin: {
    contents: `
      export { ZeroBaseDesktopShell } from "./src/zeroBaseShell.jsx";
      export { ZeroBaseToday, buildZeroBaseTodayModel } from "./src/zeroBaseToday.jsx";
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
const { ZeroBaseDesktopShell, ZeroBaseToday, buildZeroBaseTodayModel } = require(outFile);

const mainSource = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");

const fixture = {
  user: { id: "owner-1", name: "Owner", isOwner: true, tenantName: "KORDYN" },
  portfolio: { totalEquityUsdt: 12486.3, todayPnl: null, availableMarginUsdt: 9032.1 },
  positions: [{ id: "position-1", symbol: "BTC/USDT", status: "open" }],
  tradePlans: [{ id: "plan-1", symbol: "BTC/USDT", status: "awaiting_approval" }],
  pendingActions: [{ id: "action-1", title: "Confirm mandate", status: "pending" }],
  riskIncidents: [{ id: "risk-1", title: "Protection drift", status: "open", severity: "high" }],
  reviews: [{ id: "review-1", title: "BTC review", status: "pending" }],
  watchTriggers: [{ id: "watch-1", symbol: "ETH/USDT", status: "active" }],
  events: [{ id: "event-1", title: "FOMC", status: "scheduled" }],
  strategyCatalog: { products: [{ id: "strategy-product-1", name: "Trend" }] },
  knowledge: { sources: [{ id: "knowledge-1", title: "Trading book" }], tradingSkills: [{ id: "skill-1", name: "ATR" }] },
  analysisEngine: { tools: [{ id: "tool-1", name: "Regime" }] },
  tasks: [{ id: "task-1", title: "Market refresh", status: "running" }],
  agentStatus: { state: "watching", nextActions: ["Review plan evidence"] },
  agentRuns: [{ id: "run-1", title: "Market patrol", status: "completed", summary: "No forced action" }],
  resourceState: { chat: "loaded", cockpit: "loaded", researchCenter: "loaded", riskCenter: "loaded", operationsCenter: "loaded", systemSettings: "loaded" }
};

test("Today model is role-aware and never turns missing account facts into zero", () => {
  const owner = buildZeroBaseTodayModel(fixture);
  assert.equal(owner.role, "owner");
  assert.equal(owner.account.totalEquity, "12,486.30 USDT");
  assert.equal(owner.account.todayPnl, "Unavailable");
  assert.equal(owner.account.positions, 1);
  assert.equal(owner.assets.strategy, 1);
  assert.equal(owner.assets.knowledge, 1);
  assert.equal(owner.assets.capability, 2);
  assert.equal(owner.attention.length, 4);
  assert.equal(owner.ai.state, "watching");

  const unavailable = buildZeroBaseTodayModel({ user: { role: "trader" } });
  assert.equal(unavailable.role, "trader");
  assert.equal(unavailable.account.totalEquity, "Unavailable");
  assert.equal(unavailable.account.positions, "Unavailable");
  assert.equal(unavailable.assets.strategy, "Unavailable");
});

test("desktop shell renders one coherent grouped family navigation and keeps the real workbench", () => {
  const markup = renderToString(React.createElement(ZeroBaseDesktopShell, {
    data: fixture,
    activeFamilyId: "today",
    activeViewId: "owner",
    onFamilyNavigate: () => {},
    renderTopbar: ({ shellTools }) => React.createElement("header", { className: "appTopbar zbTopbar" }, shellTools),
    context: { title: "KORDYN", status: "ready", objectStatus: "ready", workspaceId: "ai" },
    trace: []
  }, React.createElement("div", null, "REAL WORKBENCH")));

  for (const family of ZERO_BASE_FAMILIES) assert.match(markup, new RegExp(`data-zero-base-family="${family.id}"`));
  assert.equal((markup.match(/aria-current="page"/g) || []).length, 2, "one active family and one active view");
  assert.match(markup, /核心产品/);
  assert.match(markup, /智能资产/);
  assert.match(markup, /治理/);
  assert.match(markup, /REAL WORKBENCH/);
  assert.match(markup, /data-zero-base-tool="context"/);
  assert.match(markup, /data-zero-base-tool="trace"/);
  assert.doesNotMatch(markup, /智能表单|DAO 治理/);
});

test("Today surface makes AI primary while exposing account and intelligent assets", () => {
  const markup = renderToString(React.createElement(ZeroBaseToday, { data: fixture, onNavigate: () => {} }));
  assert.match(markup, /data-zero-base-today="owner"/);
  assert.match(markup, /data-today-zone="ai-primary"/);
  assert.match(markup, /data-today-zone="account"/);
  assert.match(markup, /data-today-zone="intelligent-assets"/);
  assert.match(markup, /12,486\.30 USDT/);
  assert.match(markup, /Unavailable/);
  assert.match(markup, /Market patrol/);
});

test("production App uses the post-OpenRouter classic shell while retaining zero-base components off-path", () => {
  assert.match(mainSource, /data-classic-shell="desktop"/);
  assert.match(mainSource, /data-classic-shell="mobile"/);
  assert.match(mainSource, /<ClassicSidebar\b/);
  assert.match(mainSource, /<MobileApp key=\{lang\} classic\b/);
  assert.doesNotMatch(mainSource, /<ZeroBaseDesktopShell\b/);
  assert.doesNotMatch(mainSource, /<ZeroBaseToday\b/);
});
