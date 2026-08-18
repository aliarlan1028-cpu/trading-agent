import { belongsToPrincipal, principalKey, principalUserId } from "./principalScope.mjs";

export const OVERVIEW_PRIVATE_COLLECTIONS = Object.freeze([
  "positions", "mandates", "realtimeConnections", "exchangeAccounts", "subscriptions",
  "tradePlans", "executionOrders", "armedSetups", "fills", "pendingActions", "watchTriggers",
  "agentRuns", "tasks", "missedOpportunities", "opportunityCandidates", "orders", "riskChecks",
  "reviews", "reconciliationReports", "accountSnapshots", "riskIncidents", "auditLogs", "traces",
  "alerts", "drillRuns", "jobRuns", "analysisBundles", "evidenceBundles", "backtests",
  "strategyProfiles", "memoryItems", "tradeIntents", "exchangeOrders", "reviewReports",
  "toolExecutions", "skillRuns", "llmRuns", "grayReleasePolicies", "apiKeyMetadata", "riskRules"
]);

// One projection is shared by Core, section-v2 and the legacy overview. A row
// without trustworthy provenance fails closed except for the configured
// single-owner account that created pre-migration records.
export function buildOverviewPrincipalScope(db, principalInput = {}) {
  const principal = {
    tenantId: String(principalInput.tenantId || ""),
    userId: String(principalInput.userId || principalInput.id || ""),
    isOwner: principalInput.isOwner === true
  };
  const configuredOwner = principal.isOwner
    && principal.tenantId === db.user?.tenantId
    && principal.userId === db.user?.id;
  const visiblePrivateRow = (row) => {
    if (!row || typeof row !== "object") return false;
    if (belongsToPrincipal(row, principal)) return true;
    return configuredOwner && !row.tenantId && !principalUserId(row);
  };
  const scoped = { ...db };
  for (const key of OVERVIEW_PRIVATE_COLLECTIONS) scoped[key] = (db[key] || []).filter(visiblePrivateRow);
  scoped.portfolio = visiblePrivateRow(db.portfolio) ? db.portfolio : {};
  // Always clone. Overview is a GET path; request-local derivations must never
  // mutate the configured Owner's persisted system object by reference.
  scoped.system = configuredOwner ? { ...(db.system || {}) } : {};
  scoped.agentStateFiles = configuredOwner
    ? db.agentStateFiles
    : (db.agentStateFilesByPrincipal?.[principalKey(principal)] || {});
  return { principal, scoped, visiblePrivateRow, configuredOwner };
}

export function deriveOverviewApiHealth(scopedDb, options = {}) {
  const configured = (scopedDb.exchangeAccounts || []).some((account) => account.exchange === "OKX" && account.readEnabled)
    || (options.configuredOwner === true && options.hasStoredOkxCredentials === true);
  const realtimeStarted = scopedDb.realtimeStarted === true || (scopedDb.realtimeConnections || []).length > 0;
  const realtimeConnected = (scopedDb.realtimeConnections || []).some((connection) => connection.status === "connected");
  if (scopedDb.system?.killSwitch === true) return "熔断停机";
  if (!configured) return "待配置";
  return realtimeStarted && !realtimeConnected ? "连接异常" : "正常";
}
