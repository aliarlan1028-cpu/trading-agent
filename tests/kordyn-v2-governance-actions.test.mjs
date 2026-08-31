import assert from "node:assert/strict";
import test from "node:test";
import { createGovernanceActions } from "../src/kordynV2/domains/governance/governanceActions.js";

test("operational actions retain deployed endpoints", async () => {
  const calls = [];
  const governance = createGovernanceActions({
    action: async (...args) => { calls.push(args); return { ok: true }; },
    confirm: async () => true
  });
  await governance.runTask("task-1");
  await governance.pauseTask("task-1");
  await governance.resumeTask("task-1");
  await governance.markNotificationsRead();
  assert.deepEqual(calls, [
    ["/api/tasks/task-1/run", {}],
    ["/api/tasks/task-1/pause", { reason: "manual_ui" }],
    ["/api/tasks/task-1/resume", {}],
    ["/api/notifications/read", {}]
  ]);
});

test("protected governance actions confirm and return authoritative results unchanged", async () => {
  const calls = [];
  const governance = createGovernanceActions({
    action: async (...args) => { calls.push(args); return { ok: false, status: "partial", completed: ["snapshot"], failed: ["orders"] }; },
    confirm: async () => true
  });
  const result = await governance.reconcile();
  assert.deepEqual(calls, [["/api/reconciler/run", { mode: "manual_ui" }]]);
  assert.deepEqual(result, { ok: false, status: "partial", completed: ["snapshot"], failed: ["orders"] });
});

test("danger governance actions retain deployed endpoints and reject invalid switch state", async () => {
  const calls = [];
  const governance = createGovernanceActions({ action: async (...args) => { calls.push(args); return { message: "accepted" }; }, confirm: async () => true });
  await governance.flattenAll();
  await governance.setKillSwitch(true, "operator test");
  assert.deepEqual(governance.setKillSwitch("true"), { ok: false, error: "invalid_kill_switch_state" });
  assert.deepEqual(calls, [
    ["/api/risk/emergency-flatten", {}],
    ["/api/risk/kill-switch", { enabled: true, reason: "operator test" }]
  ]);
});

test("destructive actions fail closed when confirmation is declined", async () => {
  const calls = [];
  const governance = createGovernanceActions({
    action: async (...args) => { calls.push(args); return { ok: true }; },
    confirm: async () => false
  });
  assert.deepEqual(await governance.deleteEventSource("source-1", "Macro calendar"), { ok: false, cancelled: true });
  assert.deepEqual(await governance.clearSecret("OPENAI_API_KEY"), { ok: false, cancelled: true });
  assert.deepEqual(calls, []);
});

test("configuration actions preserve deployed HTTP methods and endpoints", async () => {
  const calls = [];
  const governance = createGovernanceActions({
    action: async (...args) => { calls.push(args); return { ok: true, id: "server-result" }; },
    confirm: async () => true
  });
  await governance.saveConfig({ LIVE_TRADING_MODE: "full_auto" });
  await governance.saveMandate({ id: "mandate-1", allowedSymbols: ["BTC-USDT-SWAP"] });
  await governance.activateMandate("mandate-1");
  await governance.updateRiskRule("rule-1", { enabled: false });
  await governance.updateAgentProfile("agent-1", { enabled: true });
  await governance.updateUser("user-1", { roleId: "role_admin" });
  await governance.grantSubscription("user-1", { planId: "owner" });
  assert.deepEqual(calls, [
    ["/api/config", { LIVE_TRADING_MODE: "full_auto" }],
    ["/api/mandates/mandate-1", { allowedSymbols: ["BTC-USDT-SWAP"] }, "PATCH"],
    ["/api/mandates/mandate-1/activate", {}],
    ["/api/risk/rules/rule-1", { enabled: false }, "PATCH"],
    ["/api/agent/profiles/agent-1", { enabled: true }, "PATCH"],
    ["/api/admin/users/user-1", { roleId: "role_admin" }, "PATCH"],
    ["/api/admin/users/user-1/grant-free", { planId: "owner" }]
  ]);
});
