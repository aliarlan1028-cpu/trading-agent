import test from "node:test";
import assert from "node:assert/strict";
import { canConfirmPendingAction, pendingActionRequiredPermission, userHasPermission } from "../server/actionAuthorization.mjs";
import { TRADER_PERMISSIONS } from "../server/store.mjs";

const db = {
  roles: [
    { id: "role_trader", name: "交易用户", permissions: TRADER_PERMISSIONS },
    { id: "role_risk", name: "风控审批员", permissions: ["approve:trade_plan", "risk.kill_switch", "approve:live_config", "write:risk"] }
  ]
};

test("pending Agent actions preserve separation of duties", () => {
  const trader = { id: "u1", role: "交易用户", status: "active" };
  for (const type of ["approve_plan", "set_execution_mode", "set_live_gate"]) {
    assert.equal(canConfirmPendingAction(db, trader, { type }).allowed, false, type);
  }
  assert.equal(canConfirmPendingAction(db, trader, { type: "kill_switch", args: { enabled: true } }).allowed, true);
  assert.equal(canConfirmPendingAction(db, trader, { type: "kill_switch", args: { enabled: false } }).allowed, false);
  assert.equal(canConfirmPendingAction(db, trader, { type: "set_live_gate", args: { enabled: false } }).allowed, true);
  assert.equal(canConfirmPendingAction(db, trader, { type: "mandate" }).allowed, true);
  assert.equal(userHasPermission(db, trader, "approve:live_config"), false);
  assert.equal(userHasPermission(db, trader, "write:mandate"), true);
});

test("pending Agent actions use action-specific permissions and reject unknown types", () => {
  const approver = { id: "u2", role: "风控审批员", status: "active" };
  assert.equal(pendingActionRequiredPermission({ type: "approve_plan" }), "approve:trade_plan");
  assert.equal(canConfirmPendingAction(db, approver, { type: "approve_plan" }).allowed, true);
  assert.equal(canConfirmPendingAction(db, approver, { type: "set_execution_mode", args: { mode: "full_auto" } }).allowed, true);
  assert.equal(canConfirmPendingAction(db, approver, { type: "unknown" }).allowed, false);
});
