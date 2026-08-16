import assert from "node:assert/strict";
import test from "node:test";

import { applyKillSwitch } from "../server/riskControlService.mjs";

function fixture() {
  return {
    system: { autonomyEnabled: true, killSwitch: false, riskStatus: "正常" },
    executionOrders: [
      { id: "entry-unknown", status: "entry_unknown_pending" },
      { id: "entry-partial", status: "entry_partial" },
      { id: "position", status: "protecting" },
      { id: "terminal", status: "closed" }
    ],
    riskIncidents: []
  };
}

test("the shared kill-switch service pauses autonomy and submits every entry/position risk reduction", async () => {
  const db = fixture();
  const calls = [];
  const notices = [];
  const result = await applyKillSwitch(db, { enabled: true, reason: "operator", actor: "Owner" }, {
    closeExecution: async (_db, id, reason, options) => {
      calls.push({ id, reason, options });
      return { status: id === "position" ? "close_pending" : "cancel_pending" };
    },
    cancelOrphans: async (_db, reason, actionId) => ({
      requested: [{ orderId: "orphan", status: "cancel_pending", reason, actionId }],
      unknown: [],
      failed: []
    }),
    notifyLark: async (_db, notice) => notices.push(notice),
    id: () => "incident-1",
    nowIso: () => "2026-08-15T00:00:00.000Z"
  });
  assert.equal(result.ok, true);
  assert.equal(db.system.killSwitch, true);
  assert.equal(db.system.autonomyEnabled, false);
  assert.deepEqual(calls.map((call) => call.id), ["entry-unknown", "entry-partial", "position"]);
  assert.equal(calls[0].options.intent, "emergency_close_if_filled");
  assert.equal(calls[2].options.intent, "close_position");
  assert.equal(db.system.lastKillSwitchCancellation.requested, 4);
  assert.equal(db.riskIncidents.length, 1);
  assert.equal(notices.length, 1);
  assert.match(notices[0].body, /未确认/);
});

test("disabling the shared kill switch never re-enables autonomy or submits exchange actions", async () => {
  const db = fixture();
  db.system.killSwitch = true;
  db.system.autonomyEnabled = false;
  let calls = 0;
  const result = await applyKillSwitch(db, { enabled: false, actor: "Owner" }, {
    closeExecution: async () => { calls += 1; },
    cancelOrphans: async () => { calls += 1; return { requested: [], unknown: [], failed: [] }; }
  });
  assert.equal(result.ok, true);
  assert.equal(db.system.killSwitch, false);
  assert.equal(db.system.autonomyEnabled, false);
  assert.equal(calls, 0);
});

test("clearing an emergency stop resumes the saved mode but keeps unresolved OMS safety pauses", async () => {
  const db = fixture();
  db.system.killSwitch = true;
  db.system.autonomyEnabled = false;
  db.system.requestedOperatingMode = "full_auto";
  const result = await applyKillSwitch(db, { enabled: false, actor: "Owner" }, {
    closeExecution: async () => { throw new Error("must not submit on clear"); },
    cancelOrphans: async () => { throw new Error("must not cancel on clear"); }
  });
  assert.equal(result.ok, true);
  assert.equal(db.system.killSwitch, false);
  assert.equal(db.system.autonomyEnabled, true, "the saved automatic mode resumes");
  assert.equal(db.system.requestedOperatingMode, "full_auto");
  assert.equal(db.system.openingPaused, true, "unresolved entry facts still block new entries");
  assert.ok(db.system.openingPauseReasons.includes("execution:entry_unknown_pending"));
  assert.equal(db.system.riskStatus, "暂停新开仓");
});
