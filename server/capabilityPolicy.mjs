export const PENDING_ACTION_CAPABILITIES = Object.freeze({
  run_reconcile: Object.freeze(["write:exchange"]),
  kill_switch: Object.freeze(["risk.kill_switch"]),
  set_live_gate: Object.freeze(["approve:live_config"]),
  mandate: Object.freeze(["write:mandate"]),
  approve_plan: Object.freeze(["approve:trade_plan"])
});

export const TASK_HANDLER_CAPABILITIES = Object.freeze({
  reminder: Object.freeze({ userSchedulable: true, permissions: ["write:task"] }),
  agent_mission: Object.freeze({ userSchedulable: true, permissions: ["write:task", "market.read"] }),
  event_refresh: Object.freeze({ userSchedulable: true, permissions: ["write:task", "write:event"] }),
  market_signal_refresh: Object.freeze({ userSchedulable: true, permissions: ["write:task", "market.read"] }),
  strategy_research: Object.freeze({ userSchedulable: true, permissions: ["write:task", "write:review"] }),
  paper_forward: Object.freeze({ userSchedulable: true, permissions: ["write:task", "write:review"] }),
  trade_reflection: Object.freeze({ userSchedulable: true, permissions: ["write:task", "write:review"] }),
  missed_opportunity_review: Object.freeze({ userSchedulable: true, permissions: ["write:task", "write:review"] }),
  accounting_refresh: Object.freeze({ userSchedulable: false, permissions: ["admin:system"] }),
  reconcile: Object.freeze({ userSchedulable: false, permissions: ["write:exchange", "risk.kill_switch"] })
});

export function pendingActionCapabilities(type, args = {}) {
  if (type === "kill_switch" && args.enabled === true) return ["risk.check"];
  if (type === "set_live_gate" && args.enabled === false) return ["write:mandate"];
  return [...(PENDING_ACTION_CAPABILITIES[type] || [])];
}

export function taskHandlerPolicy(handler) {
  return TASK_HANDLER_CAPABILITIES[String(handler || "")] || null;
}

export function userHasCapabilities(db, user, permissions = []) {
  if (!user || user.status === "disabled") return false;
  const role = (db.roles || []).find((item) => item.name === user.role || item.id === user.roleId);
  const available = new Set(role?.permissions || []);
  return available.has("*") || permissions.every((permission) => available.has(permission));
}

export function storedTaskAuthorization(db, task) {
  if (task?.systemManaged === true) {
    const entitlement = task.tenantId
      ? resolveTenantEntitlement(db, { tenantId: task.tenantId })
      : { allowed: true };
    return entitlement.allowed
      ? { allowed: true, systemManaged: true, entitlement }
      : { allowed: false, reason: `task_tenant_${entitlement.reason}`, entitlement };
  }
  const policy = taskHandlerPolicy(task?.handler);
  if (!policy?.userSchedulable) return { allowed: false, reason: "handler_not_user_schedulable", policy };
  const user = (db.users || []).find((item) => item.id === task?.creatorUserId);
  if (!user) return { allowed: false, reason: "task_creator_unavailable", policy };
  if (task.tenantId && user.tenantId !== task.tenantId) return { allowed: false, reason: "task_creator_tenant_mismatch", policy };
  const entitlement = resolveTenantEntitlement(db, { user, tenantId: task.tenantId || user.tenantId });
  if (!entitlement.allowed) return { allowed: false, reason: `task_tenant_${entitlement.reason}`, policy, entitlement };
  if (Number(task.creatorSecurityVersion ?? user.securityVersion ?? 0) !== Number(user.securityVersion || 0)) {
    return { allowed: false, reason: "task_creator_security_version_changed", policy };
  }
  if (!userHasCapabilities(db, user, policy.permissions)) return { allowed: false, reason: "task_creator_capability_revoked", policy };
  return { allowed: true, user, policy, entitlement };
}
import { resolveTenantEntitlement } from "./entitlements.mjs";
