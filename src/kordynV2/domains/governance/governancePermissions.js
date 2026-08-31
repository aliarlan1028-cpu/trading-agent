const list = (value) => Array.isArray(value) ? value.map(String) : [];
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : "";

export function buildGovernancePermissions(data = {}) {
  const user = data?.user && typeof data.user === "object" ? data.user : {};
  const authenticated = Boolean(text(user.id) || text(user.email) || user.isOwner === true);
  const permissions = new Set(list(data?.permissions ?? data?.auth?.permissions));
  const owner = user.isOwner === true;
  const allows = (...required) => owner || permissions.has("*") || required.some((permission) => permissions.has(permission));
  return Object.freeze({
    authenticated,
    owner,
    readNotifications: authenticated && allows("account.read"),
    updateOwnProfile: authenticated,
    writeTask: allows("write:task"),
    writeEvent: allows("write:event"),
    writeRisk: allows("write:risk"),
    stopTrading: allows("risk.check", "risk.kill_switch"),
    flattenAll: allows("risk.kill_switch"),
    clearKillSwitch: allows("risk.kill_switch"),
    reconcile: allows("write:exchange"),
    writeExchange: allows("write:exchange"),
    configureSecurity: allows("admin:security"),
    approveLiveConfig: allows("approve:live_config", "admin:security"),
    writeMandate: allows("write:mandate"),
    writeKnowledge: allows("write:knowledge"),
    adminSystem: allows("admin:system"),
    auditRead: allows("audit.read", "admin:system")
  });
}

export function configurationTargetAllowed(permissions = {}, target = "") {
  return ({
    trading: permissions.configureSecurity === true && permissions.writeMandate === true,
    risk: permissions.writeRisk === true,
    environment: permissions.configureSecurity === true,
    network: permissions.configureSecurity === true,
    backup: permissions.adminSystem === true,
    security: permissions.configureSecurity === true,
    exchange: permissions.configureSecurity === true,
    "event-sources": permissions.writeEvent === true,
    notifications: permissions.configureSecurity === true,
    models: permissions.configureSecurity === true,
    agents: permissions.writeKnowledge === true,
    users: permissions.adminSystem === true,
    account: permissions.updateOwnProfile === true
  })[target] === true;
}
