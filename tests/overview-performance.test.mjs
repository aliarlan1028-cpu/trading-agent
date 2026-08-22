import assert from "node:assert/strict";
import test from "node:test";
import { buildCoreOverview } from "../server/coreOverview.mjs";
import { projectOverviewSection } from "../server/overviewView.mjs";
import { currentUiRevision, uiSyncEvent } from "../server/uiSync.mjs";
import { seedDatabase } from "../server/store.mjs";
import { installSystemTradeProvenance } from "./financial-fixtures.mjs";

function history(prefix, count, status) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    status,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 2, 0, 0, index % 60)).toISOString()
  }));
}

test("core overview remains bounded without dropping old non-terminal risk state", () => {
  const db = seedDatabase();
  const oldOpen = { id: "execution-old-open", status: "close_unknown_pending", symbol: "BTC/USDT", createdAt: "2020-01-01T00:00:00.000Z" };
  const recovering = { id: "execution-old-recovery", status: "recovery_pending_reconciliation", symbol: "ETH/USDT", createdAt: "2019-01-01T00:00:00.000Z" };
  const emergency = { id: "execution-old-emergency", status: "emergency_close_pending", symbol: "SOL/USDT", createdAt: "2018-01-01T00:00:00.000Z" };
  db.executionOrders = [
    ...history("closed", 1400, "closed"),
    { ...oldOpen, exchangeResponse: "x".repeat(800_000), events: [{ output: "y".repeat(800_000) }] },
    recovering,
    emergency
  ];
  const oldPlan = { id: "plan-old-executing", status: "executing", symbol: "BTC/USDT", reasoningSummary: "r".repeat(800_000), createdAt: "2020-01-01T00:00:00.000Z" };
  db.tradePlans = [...history("completed-plan", 800, "completed"), oldPlan];
  db.agentRuns = Array.from({ length: 300 }, (_, index) => ({
    id: `run-${index}`,
    status: "completed",
    steps: [{ id: `step-${index}`, output: "x".repeat(20000) }],
    toolTrace: [{ payload: "y".repeat(20000) }]
  }));
  db.analysisBundles = [{ id: "analysis-large", summary: "a".repeat(800_000), toolTrace: [{ body: "b".repeat(800_000) }] }];

  const core = buildCoreOverview(db, { revision: 7 });
  const bytes = Buffer.byteLength(JSON.stringify(core));

  assert.equal(core.revision, 7);
  assert.ok(core.executionOrders.some((row) => row.id === oldOpen.id));
  assert.ok(core.executionOrders.some((row) => row.id === recovering.id));
  assert.ok(core.executionOrders.some((row) => row.id === emergency.id));
  assert.equal(core.executionOrders.find((row) => row.id === oldOpen.id).exchangeResponse, undefined);
  assert.ok(core.tradePlans.some((row) => row.id === oldPlan.id));
  assert.equal("agentRuns" in core, false);
  assert.ok(core.executionOrders.length <= 11, `expected non-terminal rows plus 8 history rows, got ${core.executionOrders.length}`);
  assert.ok(bytes < 250_000, `core payload exceeded 250 KB: ${bytes}`);
  assert.equal(core.agentStatus.currentPlan, undefined);
  assert.ok(core.agentStatus.timeline.length <= 5);
  assert.equal(core.resourceState.cockpit, "not_loaded");
});

test("workspace projection bounds heavy history and preserves every active execution", () => {
  const active = history("active", 75, "entry_pending");
  const overview = {
    executionOrders: [...history("closed", 500, "closed"), ...active],
    tradePlans: history("plan", 100, "completed"),
    armedSetups: [],
    agentRuns: Array.from({ length: 200 }, (_, index) => ({
      id: `run-${index}`,
      status: "completed",
      steps: Array.from({ length: 20 }, (__, step) => ({ id: `${index}-${step}`, title: "z".repeat(10000) })),
      toolTrace: [{ body: "x".repeat(100000) }]
    })),
    tasks: [],
    events: [],
    fills: [],
    markets: [],
    positions: []
  };

  const chat = projectOverviewSection(overview, "chat");
  const bytes = Buffer.byteLength(JSON.stringify(chat));

  assert.equal(chat.section, "chat");
  assert.equal(chat.executionOrders.filter((row) => row.status === "entry_pending").length, active.length);
  assert.equal(chat.agentRuns.length, 10);
  assert.ok(chat.agentRuns.every((row) => !Object.hasOwn(row, "toolTrace")));
  assert.ok(bytes < 500_000, `chat payload exceeded 500 KB: ${bytes}`);
});

test("core publishes authoritative lifecycle finance from the complete fill ledger", () => {
  const db = seedDatabase();
  db.fills = [
    { id: "final", executionOrderId: "life", kind: "close", partial: false, realizedPnl: 8, feeUsdt: .3, estimatedFee: false, fundingFeeUsdt: -.5, fundingReconciled: true, createdAt: "2026-01-01T02:00:00Z" },
    ...history("unrelated", 50, "recorded").map((row) => ({ ...row, kind: "entry" })),
    { id: "entry", executionOrderId: "life", kind: "entry", feeUsdt: 1, estimatedFee: false, createdAt: "2026-01-01T00:00:00Z" },
    { id: "partial", executionOrderId: "life", kind: "close", partial: true, realizedPnl: 2, feeUsdt: .2, estimatedFee: false, fundingFeeUsdt: 0, fundingReconciled: true, createdAt: "2026-01-01T01:00:00Z" }
  ];
  installSystemTradeProvenance(db);
  const core = buildCoreOverview(db, { revision: 12 });
  assert.equal(core.fills.some((fill) => fill.id === "entry"), true, "system-only history no longer spends its bound on unrelated raw exchange rows");
  assert.equal(core.fills.length, 3);
  const lifecycle = core.closedTradeLifecycles.find((row) => row.tradeLifecycleKey === "life");
  assert.equal(lifecycle.netRealizedPnl, 8);
  assert.equal(lifecycle.financialBasisComplete, true);
  assert.equal(core.tradeDataStatus.closedLifecycleTotal, 1);
});

test("cockpit preserves old live and partially-filled exchange orders beyond the history limit", () => {
  const live = { id: "exchange-live", source: "exchange_rest", state: "live" };
  const partial = { id: "exchange-partial", source: "exchange_ws", status: "partially_filled" };
  const recoveryPlan = { id: "plan-recovery", status: "recovery_pending_reconciliation" };
  const cockpit = projectOverviewSection({
    orders: [...history("filled-order", 500, "filled"), live, partial],
    tradePlans: [...history("completed-plan", 500, "completed"), recoveryPlan],
    executionOrders: [],
    armedSetups: [],
    fills: []
  }, "cockpit");

  assert.ok(cockpit.orders.some((row) => row.id === live.id));
  assert.ok(cockpit.orders.some((row) => row.id === partial.id));
  assert.ok(cockpit.tradePlans.some((row) => row.id === recoveryPlan.id));
  assert.equal(cockpit.orders.filter((row) => row.status === "filled").length, 100);
});

test("risk workspace receives authoritative event windows separately from generic incidents", () => {
  const eventRiskWindows = [{ id: "cpi", eventId: "cpi", title: "CPI", phase: "pre_release_blackout", blocking: true }];
  const risk = projectOverviewSection({
    eventRiskWindows,
    riskIncidents: [{ id: "recon", title: "账户对账异常", status: "open" }]
  }, "riskCenter");
  assert.deepEqual(risk.eventRiskWindows, eventRiskWindows);
  assert.equal(risk.riskIncidents[0].id, "recon");
});

test("workspace projections retain the facts required by review, readiness, and Agent settings", () => {
  const cockpit = projectOverviewSection({
    fills: [],
    reconciliationReports: [{ id: "recon-1", status: "passed" }],
    behaviorProfile: { totalTrades: 7 },
    behaviorNarrative: { summary: "disciplined" },
    reviewLearningAnalytics: { queued: 2 },
    tradeDataStatus: { closedLifecycleTotal: 4, financiallyReconciledTrades: 3, pendingFinancialReconciliation: 1 },
    executionOrderStatus: { total: 6, lastChangedAt: "2026-01-01T00:00:00.000Z" }
  }, "cockpit");
  assert.equal(cockpit.reconciliationReports[0].id, "recon-1");
  assert.equal(cockpit.behaviorProfile.totalTrades, 7);
  assert.equal(cockpit.behaviorNarrative.summary, "disciplined");
  assert.equal(cockpit.reviewLearningAnalytics.queued, 2);
  assert.equal(cockpit.tradeDataStatus.pendingFinancialReconciliation, 1);
  assert.equal(cockpit.executionOrderStatus.total, 6);

  const readiness = { operatingStage: { id: "small_live_ready" }, checks: [{ key: "okx", configured: true }] };
  const risk = projectOverviewSection({ readiness }, "riskCenter");
  assert.deepEqual(risk.readiness, readiness);
  const operations = projectOverviewSection({ readiness }, "operationsCenter");
  assert.deepEqual(operations.readiness, readiness);

  const profiles = [{ id: "agent-owner", name: "Owner Agent" }];
  const settings = projectOverviewSection({ agentProfiles: profiles }, "systemSettings");
  assert.deepEqual(settings.agentProfiles, profiles);
});

test("UI revisions are strictly monotonic", () => {
  const before = currentUiRevision();
  const first = uiSyncEvent("core_invalidated");
  const second = uiSyncEvent("portfolio");
  assert.ok(first.revision > before);
  assert.ok(second.revision > first.revision);
});

test("core uses the authenticated user's projected notification read state", () => {
  const db = seedDatabase();
  db.notifications = [{ id: "notice", read: false, readByUserIds: ["owner"] }];
  const projected = [{ ...db.notifications[0], read: true }];
  const core = buildCoreOverview(db, { revision: 20, notifications: projected });
  assert.equal(core.notifications[0].read, true);
});
