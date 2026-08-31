import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(rootDir, "node_modules", ".cache", `kordyn-v2-operations-${process.pid}.cjs`);
require("esbuild").buildSync({
  stdin: { contents: `
    export { OperationsWorkspace } from "./src/kordynV2/domains/governance/OperationsWorkspace.jsx";
    export { TaskRunWorkspace } from "./src/kordynV2/domains/governance/TaskRunWorkspace.jsx";
    export { NotificationWorkspace } from "./src/kordynV2/domains/governance/NotificationWorkspace.jsx";
    export { AuditWorkspace } from "./src/kordynV2/domains/governance/AuditWorkspace.jsx";
    export { RecoveryWorkspace } from "./src/kordynV2/domains/governance/RecoveryWorkspace.jsx";
    export { MobileOperationsScreen } from "./src/kordynV2/domains/governance/MobileOperationsScreen.jsx";
    export { createElement } from "react";
    export { renderToStaticMarkup } from "react-dom/server";
  `, resolveDir: rootDir, loader: "jsx" },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime", "lucide-react"],
  outfile: outFile,
  logLevel: "silent"
});
const { AuditWorkspace, MobileOperationsScreen, NotificationWorkspace, OperationsWorkspace, RecoveryWorkspace, TaskRunWorkspace, createElement, renderToStaticMarkup } = require(outFile);

const operations = {
  overall: { tone: "warning", label: "degraded", openAttention: 2 },
  services: [
    { id: "market", labelZh: "行情输入", tone: "healthy", value: "240ms" },
    { id: "inputs", labelZh: "事件输入", tone: "warning", value: "15/17", detail: "2 sources failed" },
    { id: "audit", labelZh: "审计", tone: "healthy", value: "verified" }
  ],
  tasks: {
    items: [{ id: "task-1", name: "Auto Trade Cycle", enabled: true, systemManaged: true, runtime: { code: "last_run_failed", tone: "critical" }, latestRun: { id: "run-1", status: "failed", progress: 68 } }],
    recentRuns: [{ id: "run-1", taskId: "task-1", taskName: "Auto Trade Cycle", status: "failed", createdAt: "2026-08-31T09:00:00Z" }],
    total: 1,
    active: 1
  },
  inputs: { items: [], total: 0, unhealthy: 0 },
  attention: [{ id: "incident-1", kind: "incident", tone: "warning", titleZh: "Event Input degraded", detail: "2 sources failed", source: { id: "incident-1", status: "open" } }],
  notifications: { items: [{ id: "notice-1", title: "Telegram timeout", severity: "failed", read: false, tone: "critical" }], unread: 1, total: 1 },
  audit: { chain: "verified", worm: "configured", records: [{ id: "audit-1", actor: "system", action: "event.refresh", resource: "event_input", status: "partial", createdAt: "2026-08-31T09:00:00Z" }] },
  recovery: {
    latestReconciliation: { id: "reconcile-1", status: "partial", createdAt: "2026-08-31T09:00:00Z", differences: [{ id: "diff-1", field: "position" }] },
    differences: [{ id: "diff-1", field: "position" }],
    openIncidents: [{ id: "incident-1", title: "Event Input degraded", status: "open" }],
    unknownOrders: [{ id: "order-1", status: "recovery_pending" }],
    needsSchedulerRecovery: true
  }
};
const model = { operations, notifications: operations.notifications, audit: operations.audit, recovery: operations.recovery };
const actions = { runTask: async () => ({ ok: true }), pauseTask: async () => ({ ok: true }), markNotificationsRead: async () => ({ ok: true }), reconcile: async () => ({ ok: true }), recoverScheduler: async () => ({ ok: true }) };

test("system-managed ownership is not presented as runtime health", () => {
  const html = renderToStaticMarkup(createElement(TaskRunWorkspace, { model, actions, onSelect: () => {} }));
  assert.match(html, /系统托管|System-managed/);
  assert.match(html, /失败|Failed/);
  assert.doesNotMatch(html, /系统托管[^<]*(正常|Healthy)/);
});

test("audit records are immutable in the UI", () => {
  const source = readFileSync(path.join(rootDir, "src/kordynV2/domains/governance/AuditWorkspace.jsx"), "utf8");
  assert.doesNotMatch(source, /delete|edit|save|\/api\//i);
  const html = renderToStaticMarkup(createElement(AuditWorkspace, { model, onSelect: () => {} }));
  assert.match(html, /不可变|Immutable/);
  assert.match(html, /data-kordyn-v2-object-type="Audit log"/);
});

test("operations, notifications, and recovery expose canonical operational objects", () => {
  const ops = renderToStaticMarkup(createElement(OperationsWorkspace, { model, actions, onSelect: () => {}, onNavigate: () => {} }));
  const notices = renderToStaticMarkup(createElement(NotificationWorkspace, { model, actions, onSelect: () => {} }));
  const recovery = renderToStaticMarkup(createElement(RecoveryWorkspace, { model, actions, onSelect: () => {} }));
  assert.match(ops, /data-kordyn-v2-operation-service="market"/);
  assert.match(ops, /data-kordyn-v2-object-type="Risk incident"/);
  assert.match(notices, /data-kordyn-v2-object-type="Notification"/);
  assert.match(recovery, /data-kordyn-v2-object-type="Recovery"/);
});

test("mobile operations keeps the approved task-led operational composition", () => {
  const html = renderToStaticMarkup(createElement(MobileOperationsScreen, { model, actions, onSelect: () => {}, onNavigate: () => {} }));
  assert.match(html, /data-kordyn-v2-governance-mobile="runs"/);
  assert.match(html, /系统状态/);
  assert.match(html, /异常与恢复/);
});

