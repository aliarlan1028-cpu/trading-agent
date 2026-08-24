import assert from "node:assert/strict";
import test from "node:test";
import { buildOperationsView, operationsTone } from "../src/operationsView.js";

const NOW = new Date("2026-08-24T08:00:00.000Z").getTime();

test("operations view separates task ownership from actual runtime outcome", () => {
  const view = buildOperationsView({
    tasks: [
      { id: "task_sys", name: "Agent cycle", handler: "agent_cycle", systemManaged: true, enabled: true },
      { id: "task_user", name: "Daily reconcile", handler: "reconcile", enabled: false }
    ],
    jobRuns: [
      { id: "run_old", taskId: "task_sys", status: "ok", createdAt: "2026-08-24T06:00:00.000Z" },
      { id: "run_new", taskId: "task_sys", status: "failed", createdAt: "2026-08-24T07:00:00.000Z" }
    ]
  }, { now: NOW });
  assert.equal(view.tasks.items[0].systemManaged, true);
  assert.equal(view.tasks.items[0].latestRun.id, "run_new");
  assert.deepEqual(view.tasks.items[0].runtime, { code: "last_run_failed", tone: "critical" });
  assert.deepEqual(view.tasks.items[1].runtime, { code: "paused", tone: "warning" });
  assert.equal(view.tasks.failedRuns, 1);
  assert.equal(view.overall.tone, "critical");
});

test("operations view builds a priority recovery queue from authoritative facts", () => {
  const view = buildOperationsView({
    reconciliationReports: [{ id: "recon_1", status: "needs_attention", severity: "high", differences: [{ field: "position", severity: "high" }], createdAt: "2026-08-24T07:59:00.000Z" }],
    executionOrders: [{ id: "order_1", status: "entry_unknown_pending", updatedAt: "2026-08-24T07:58:00.000Z" }],
    riskIncidents: [{ id: "incident_1", status: "open", severity: "critical", title: "Protection unconfirmed", createdAt: "2026-08-24T07:57:00.000Z" }]
  }, { now: NOW });
  assert.equal(view.recovery.latestReconciliation.id, "recon_1");
  assert.equal(view.recovery.differences.length, 1);
  assert.equal(view.recovery.unknownOrders.length, 1);
  assert.equal(view.recovery.openIncidents.length, 1);
  assert.equal(view.attention[0].tone, "critical");
  assert.ok(view.attention.some((item) => item.route === "operationsCenter:recovery"));
  assert.ok(view.attention.some((item) => item.route === "tradeJournal"));
});

test("event input health and notifications retain real source state", () => {
  const view = buildOperationsView({
    eventSources: [{ id: "calendar", name: "Macro calendar", enabled: true }],
    marketIntelligenceSourceHealth: [{ sourceId: "calendar", health: "failed", lastError: "timeout", checkedAt: "2026-08-24T07:50:00.000Z" }],
    notifications: [{ id: "n1", severity: "critical", read: false }, { id: "n2", severity: "info", read: true }]
  }, { now: NOW });
  assert.equal(view.inputs.total, 1);
  assert.equal(view.inputs.unhealthy, 1);
  assert.equal(view.inputs.items[0].error, "timeout");
  assert.equal(view.notifications.unread, 1);
  assert.equal(view.notifications.critical, 1);
  assert.equal(view.notifications.items[0].tone, "critical");
});

test("healthy operational evidence does not fabricate an attention queue", () => {
  const view = buildOperationsView({
    system: { apiHealth: "ok" }, realtimeStarted: true,
    markets: [{ updatedAt: "2026-08-24T07:59:58.000Z" }],
    accountSnapshots: [{ status: "ok", createdAt: "2026-08-24T07:59:30.000Z" }],
    readiness: { checks: [{ key: "audit_chain", configured: true }, { key: "audit_worm", configured: true }] },
    tasks: [{ id: "task_1", enabled: true, handler: "reconcile" }],
    jobRuns: [{ id: "run_1", taskId: "task_1", status: "ok", createdAt: "2026-08-24T07:59:00.000Z" }],
    eventSources: [{ id: "source_1", enabled: true, status: "healthy" }],
    reconciliationReports: [{ id: "recon_ok", status: "ok", differences: [], createdAt: "2026-08-24T07:59:00.000Z" }]
  }, { now: NOW });
  assert.equal(view.overall.tone, "healthy");
  assert.equal(view.attention.length, 0);
  assert.equal(view.recovery.healthy, true);
  assert.equal(operationsTone("retry_scheduled"), "warning");
});

test("operations projections preserve real run, recovery, audit, and notification evidence", () => {
  const view = buildOperationsView({
    jobRuns: [{ id: "run_1", taskName: "Agent patrol", status: "ok", finishedAt: "2026-08-24T07:55:00.000Z" }],
    reconciliationReports: [{ id: "recon_1", status: "ok", differences: [], createdAt: "2026-08-24T07:56:00.000Z" }],
    auditLogs: [{ id: "audit_1", action: "scheduler.recover", actor: "owner", createdAt: "2026-08-24T07:57:00.000Z" }],
    notifications: [{ id: "notice_1", title: "Recovery completed", read: false, createdAt: "2026-08-24T07:58:00.000Z" }]
  }, { now: NOW });

  assert.deepEqual(view.activity.map((row) => row.type), ["notification", "audit", "reconcile", "run"]);
  assert.equal(view.recovery.latestReconciliation.id, "recon_1");
  assert.equal(view.audit.records[0].id, "audit_1");
  assert.equal(view.notifications.items[0].id, "notice_1");
  assert.equal(view.notifications.unread, 1);
});
