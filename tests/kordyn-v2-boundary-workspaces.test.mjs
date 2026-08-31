import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(rootDir, "node_modules", ".cache", `kordyn-v2-boundary-${process.pid}.cjs`);
require("esbuild").buildSync({
  stdin: { contents: `
    export { BoundaryWorkspace } from "./src/kordynV2/domains/governance/BoundaryWorkspace.jsx";
    export { EventInputWorkspace } from "./src/kordynV2/domains/governance/EventInputWorkspace.jsx";
    export { MobileBoundaryScreen } from "./src/kordynV2/domains/governance/MobileBoundaryScreen.jsx";
    export { MobileEventInputScreen } from "./src/kordynV2/domains/governance/MobileEventInputScreen.jsx";
    export { renderToStaticMarkup } from "react-dom/server";
    export { createElement } from "react";
  `, resolveDir: rootDir, loader: "jsx" },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime", "lucide-react"],
  outfile: outFile,
  logLevel: "silent"
});
const { BoundaryWorkspace, EventInputWorkspace, MobileBoundaryScreen, MobileEventInputScreen, createElement, renderToStaticMarkup } = require(outFile);

const model = {
  boundary: {
    selectedMode: "full_auto",
    effectiveMode: "observe",
    killSwitch: false,
    runtimeStatus: "opening_paused",
    blockers: [{ id: "snapshot", code: "snapshot_stale", label: "账户快照超过 10 分钟", recovery: "同步成功后自动恢复", route: "systemSettings:exchange" }],
    mandate: { id: "mandate-1", allowedSymbols: ["BTC-USDT-SWAP"], maxLeverage: 5, effectiveOrderLimitUsdt: 500 },
    readiness: [{ id: "mandate", label: "交易权限已生效", ok: true }, { id: "account", label: "OKX 账户已同步", ok: false }],
    rules: { total: 8, enabled: 8, recentHits: [{ id: "check-1", status: "passed", ruleId: "rule-1" }] },
    events: { windows: [{ id: "event-fomc", title: "FOMC", blocking: true, relatedSymbols: ["BTC-USDT-SWAP"], dueAt: "2026-09-16T18:00:00Z" }], blocking: 1 },
    incidents: { items: [{ id: "incident-1", title: "Snapshot stale", status: "open" }], open: 1 }
  },
  operations: {
    inputs: { items: [{ id: "source-fed", name: "Federal Reserve", status: "degraded", tone: "warning", lastSuccessAt: "2026-08-31T09:00:00Z" }], unhealthy: 1 }
  },
  eventInputs: {
    sources: [{ id: "source-fed", name: "Federal Reserve", status: "degraded", tone: "warning", lastSuccessAt: "2026-08-31T09:00:00Z" }],
    windows: [{ id: "event-fomc", title: "FOMC", blocking: true, relatedSymbols: ["BTC-USDT-SWAP"], dueAt: "2026-09-16T18:00:00Z" }],
    unhealthy: 1,
    blocking: 1
  }
};

test("effective boundary is read-only and links to configuration", () => {
  const html = renderToStaticMarkup(createElement(BoundaryWorkspace, { model, onNavigate: () => {}, onSelect: () => {} }));
  assert.match(html, /当前生效|Effective now/);
  assert.match(html, /data-kordyn-v2-navigate="governance:configuration"/);
  assert.doesNotMatch(html, /<input|<select|data-kordyn-v2-action="save"/);
  assert.match(html, /保存目标/);
  assert.match(html, /就绪链路/);
});

test("event input keeps source health and event window distinct", () => {
  const html = renderToStaticMarkup(createElement(EventInputWorkspace, { model, onSelect: () => {} }));
  assert.match(html, /data-kordyn-v2-object-type="Event"/);
  assert.match(html, /data-kordyn-v2-object-type="Event source"/);
  assert.match(html, /事件窗口/);
  assert.match(html, /来源健康/);
});

test("mobile boundary and event-input flows retain touch-first destinations", () => {
  const boundary = renderToStaticMarkup(createElement(MobileBoundaryScreen, { model, onNavigate: () => {}, onSelect: () => {} }));
  const eventInput = renderToStaticMarkup(createElement(MobileEventInputScreen, { model, onNavigate: () => {}, onSelect: () => {} }));
  assert.match(boundary, /data-kordyn-v2-governance-mobile="overview"/);
  assert.match(boundary, /data-kordyn-v2-navigate="governance:configuration"/);
  assert.match(eventInput, /data-kordyn-v2-governance-mobile="event-inputs"/);
  assert.match(eventInput, /data-kordyn-v2-mobile-action="refresh-event-sources"/);
});
