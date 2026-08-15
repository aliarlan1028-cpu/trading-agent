// The current process still keeps many trading resources in global in-memory
// collections. Until every list/get/mutation/background path is backed by a
// tenant-keyed repository, V2 must remain unavailable regardless of an env flag.
// This compile-time checklist cannot be bypassed by a deployment typo.
const REQUIRED_RESOURCE_DOMAINS = Object.freeze([
  "exchange_accounts", "mandates", "trade_plans", "execution_orders", "positions",
  "orders", "fills", "risk_incidents", "agent_runs", "knowledge", "notifications",
  "payments", "background_jobs"
]);

const IMPLEMENTED_RESOURCE_DOMAINS = Object.freeze([]);

export function tenantIsolationReadiness() {
  const implemented = new Set(IMPLEMENTED_RESOURCE_DOMAINS);
  const missingDomains = REQUIRED_RESOURCE_DOMAINS.filter((domain) => !implemented.has(domain));
  return {
    ready: missingDomains.length === 0,
    schemaVersion: 0,
    requiredDomains: [...REQUIRED_RESOURCE_DOMAINS],
    missingDomains
  };
}

export function tenantWorkspaceAccess(tenantId) {
  if (!tenantId || tenantId === "tenant_owner") return { allowed: true, ownerWorkspace: true };
  const readiness = tenantIsolationReadiness();
  if (process.env.TENANT_ISOLATION_V2 !== "true") {
    return { allowed: false, reason: "tenant_isolation_disabled", readiness };
  }
  if (!readiness.ready) {
    return { allowed: false, reason: "tenant_isolation_not_ready", readiness };
  }
  return { allowed: true, ownerWorkspace: false, readiness };
}
