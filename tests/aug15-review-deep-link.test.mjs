import assert from "node:assert/strict";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const React = require("react");
const { renderToString } = require("react-dom/server");
const esbuild = require("esbuild");
const cache = path.join(root, "node_modules", ".cache", "aug15-review-deep-link");
const output = path.join(cache, `bundle-${process.pid}.cjs`);
mkdirSync(cache, { recursive: true });
process.on("exit", () => { try { rmSync(output, { force: true }); } catch { /* noop */ } });

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { location: { origin: "http://localhost", protocol: "http:" }, matchMedia: () => ({ matches: false }) };

esbuild.buildSync({
  stdin: {
    contents: `
      export { ExecutionReviewConcept } from "./src/aug15/conceptPages.jsx";
      export { MobileExecution, MobileNotifications, MobileRisk } from "./src/aug15/mobile.jsx";
    `,
    resolveDir: root,
    loader: "jsx"
  },
  bundle: true,
  external: ["react", "react-dom", "react/jsx-runtime"],
  format: "cjs",
  jsx: "automatic",
  loader: { ".css": "empty", ".svg": "text" },
  logLevel: "silent",
  outfile: output,
  platform: "node"
});

const { ExecutionReviewConcept, MobileExecution, MobileNotifications, MobileRisk } = require(output);
const action = async () => ({});
const ui = { setActive: () => {}, openPanel: () => {}, notify: () => {} };
const data = {
  executionOrders: [], fills: [], closedTradeLifecycles: [], positions: [], tradePlans: [],
  performance: { trades: 2, totalPnlUsdt: 4, winRatePct: 50, avgPnlUsdt: 2 },
  reviews: [
    { id: "review-a", type: "trade", symbol: "BTC/USDT", status: "completed", summary: "BTC review", completedAt: "2026-09-01T00:00:00Z", netRealizedPnl: 1 },
    { id: "review-b", type: "trade", symbol: "ETH/USDT", status: "completed", summary: "ETH review", completedAt: "2026-09-02T00:00:00Z", netRealizedPnl: 3 }
  ]
};

test("desktop review deep link selects the requested real review", () => {
  const html = renderToString(React.createElement(ExecutionReviewConcept, { data, action, ui, initialReviewId: "review-a" }));
  assert.match(html, /class="active"><span><b>BTC\/USDT/);
  assert.match(html, /交易复盘详情[\s\S]*BTC review/);
});

test("mobile review deep link opens the requested review sheet", () => {
  const html = renderToString(React.createElement(MobileExecution, { data, action, initialTab: "reviews", initialReviewId: "review-a" }));
  assert.match(html, /role="dialog"/);
  assert.match(html, /BTC\/USDT/);
  assert.match(html, /BTC review/);
});

test("mobile risk-rules deep link renders rule content rather than the boundary editor", () => {
  const html = renderToString(React.createElement(MobileRisk, {
    data: {
      system: {}, portfolio: {}, mandates: [], riskIncidents: [],
      riskRules: [{ id: "rule-a", name: "最大杠杆", scope: "trade", enabled: true }]
    },
    action,
    ui,
    view: "rules"
  }));
  assert.match(html, /风险规则/);
  assert.match(html, /1 条已启用/);
  assert.doesNotMatch(html, /当前硬边界/);
});

test("mobile notifications deep link renders the notification inbox", () => {
  const html = renderToString(React.createElement(MobileNotifications, {
    data: {
      notifications: [{ id: "notice-a", title: "风险预算更新", message: "新的风险预算已经生效", createdAt: "2026-09-01T00:00:00Z", read: false }]
    },
    action
  }));
  assert.match(html, /data-aug15-operations-view="notifications"/);
  assert.match(html, /通知收件箱/);
  assert.match(html, /风险预算更新/);
  assert.match(html, /新的风险预算已经生效/);
});
