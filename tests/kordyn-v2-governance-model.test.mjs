import assert from "node:assert/strict";
import test from "node:test";
import { buildConfigurationModel } from "../src/kordynV2/domains/governance/configurationModel.js";
import { buildGovernanceDomainModel } from "../src/kordynV2/domains/governance/governanceModel.js";

test("governance never collapses desired and effective mode", () => {
  const model = buildGovernanceDomainModel({
    system: { executionMode: "auto", effectiveMode: "observe", killSwitch: true }
  });
  assert.equal(model.boundary.selectedMode, "auto");
  assert.equal(model.boundary.effectiveMode, "observe");
  assert.equal(model.boundary.killSwitch, true);
});

test("governance composes deployed boundary and operations truth", () => {
  const model = buildGovernanceDomainModel({
    automationState: { requestedMode: "full_auto", mode: "observe", blockerDetails: [{ code: "snapshot_stale", label: "账户快照过期" }] },
    system: { apiHealth: "ok", killSwitch: false },
    tasks: [{ id: "task-1", name: "Event refresh", enabled: true }],
    jobRuns: [{ id: "run-1", taskId: "task-1", status: "failed", createdAt: "2026-08-31T09:00:00Z" }]
  }, { now: new Date("2026-08-31T09:01:00Z").getTime() });
  assert.equal(model.boundary.selectedMode, "full_auto");
  assert.equal(model.boundary.effectiveMode, "observe");
  assert.equal(model.boundary.blockers[0].code, "snapshot_stale");
  assert.equal(model.operations.tasks.items[0].runtime.code, "last_run_failed");
});

test("missing supplemental operations facts remain unavailable", () => {
  const model = buildConfigurationModel({ resourceState: { operationsCenter: "not_loaded" } });
  assert.equal(model.audit.kind, "not_loaded");
  assert.equal(model.audit.total, "Unavailable");
});

test("configuration keeps selected and effective values in separate labelled facts", () => {
  const model = buildConfigurationModel({
    automationState: { requestedMode: "full_auto", mode: "observe" },
    config: { liveTrading: { maxNotionalUsdt: 80 } },
    agentStatus: { activeMandate: { id: "mandate-1", maxOrderNotionalUsdt: 50 } },
    auditLogs: [{ id: "audit-1", action: "config.update" }],
    user: { id: "owner-1", isOwner: true }
  });
  assert.deepEqual(model.trading.mode, { selected: "full_auto", effective: "observe" });
  assert.deepEqual(model.trading.maxNotionalUsdt, { selected: 80, effective: 50 });
  assert.equal(model.audit.total, 1);
  assert.equal(model.permission.owner, true);
  assert.equal(model.scopes.length, 15);
});

