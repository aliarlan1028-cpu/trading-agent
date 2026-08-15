import assert from "node:assert/strict";
import test from "node:test";
import { buildCoreOverview } from "../server/coreOverview.mjs";
import { projectOverviewSection } from "../server/overviewView.mjs";
import { currentUiRevision, uiSyncEvent } from "../server/uiSync.mjs";
import { seedDatabase } from "../server/store.mjs";

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
  db.executionOrders = [...history("closed", 1400, "closed"), oldOpen];
  const oldPlan = { id: "plan-old-executing", status: "executing", symbol: "BTC/USDT", createdAt: "2020-01-01T00:00:00.000Z" };
  db.tradePlans = [...history("completed-plan", 800, "completed"), oldPlan];
  db.agentRuns = Array.from({ length: 300 }, (_, index) => ({
    id: `run-${index}`,
    status: "completed",
    steps: [{ id: `step-${index}`, output: "x".repeat(20000) }],
    toolTrace: [{ payload: "y".repeat(20000) }]
  }));

  const core = buildCoreOverview(db, { revision: 7 });
  const bytes = Buffer.byteLength(JSON.stringify(core));

  assert.equal(core.revision, 7);
  assert.ok(core.executionOrders.some((row) => row.id === oldOpen.id));
  assert.ok(core.tradePlans.some((row) => row.id === oldPlan.id));
  assert.equal("agentRuns" in core, false);
  assert.ok(core.executionOrders.length <= 9, `expected open rows plus 8 history rows, got ${core.executionOrders.length}`);
  assert.ok(bytes < 300_000, `core payload exceeded 300 KB: ${bytes}`);
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

test("risk workspace receives authoritative event windows separately from generic incidents", () => {
  const eventRiskWindows = [{ id: "cpi", eventId: "cpi", title: "CPI", phase: "pre_release_blackout", blocking: true }];
  const risk = projectOverviewSection({
    eventRiskWindows,
    riskIncidents: [{ id: "recon", title: "账户对账异常", status: "open" }]
  }, "riskCenter");
  assert.deepEqual(risk.eventRiskWindows, eventRiskWindows);
  assert.equal(risk.riskIncidents[0].id, "recon");
});

test("UI revisions are strictly monotonic", () => {
  const before = currentUiRevision();
  const first = uiSyncEvent("core_invalidated");
  const second = uiSyncEvent("portfolio");
  assert.ok(first.revision > before);
  assert.ok(second.revision > first.revision);
});
