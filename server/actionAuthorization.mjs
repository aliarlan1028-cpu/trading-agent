const ACTION_PERMISSIONS = Object.freeze({
  run_reconcile: "write:risk",
  kill_switch: "risk.kill_switch",
  set_live_gate: "approve:live_config",
  mandate: "write:mandate",
  approve_plan: "approve:trade_plan"
});

export function pendingActionRequiredPermission(record = {}) {
  if (record.type === "kill_switch") return record.args?.enabled === false ? "risk.kill_switch" : "risk.check";
  if (record.type === "set_live_gate" && record.args?.enabled === false) return "write:mandate";
  return ACTION_PERMISSIONS[record.type] || null;
}

export function canConfirmPendingAction(db, user, record) {
  const required = pendingActionRequiredPermission(record);
  if (!required) return { allowed: false, reason: "unknown_action_type", requiredPermission: null };
  const allowed = userHasPermission(db, user, required);
  return {
    allowed,
    reason: allowed ? null : "missing_action_permission",
    requiredPermission: required
  };
}

export function userHasPermission(db, user, required) {
  const role = (db.roles || []).find((item) => item.name === user?.role || item.id === user?.roleId);
  const permissions = role?.permissions || [];
  return user?.status !== "disabled" && (permissions.includes("*") || permissions.includes(required));
}
