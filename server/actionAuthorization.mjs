import { pendingActionCapabilities } from "./capabilityPolicy.mjs";

export function pendingActionRequiredPermission(record = {}) {
  return pendingActionCapabilities(record.type, record.args)[0] || null;
}

export function canConfirmPendingAction(db, user, record) {
  const requiredPermissions = pendingActionCapabilities(record.type, record.args);
  const required = requiredPermissions[0] || null;
  if (!required) return { allowed: false, reason: "unknown_action_type", requiredPermission: null, requiredPermissions: [] };
  const allowed = requiredPermissions.every((permission) => userHasPermission(db, user, permission));
  return {
    allowed,
    reason: allowed ? null : "missing_action_permission",
    requiredPermission: required,
    requiredPermissions
  };
}

export function userHasPermission(db, user, required) {
  const role = (db.roles || []).find((item) => item.name === user?.role || item.id === user?.roleId);
  const permissions = role?.permissions || [];
  return user?.status !== "disabled" && (permissions.includes("*") || permissions.includes(required));
}
