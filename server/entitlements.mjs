const ENTITLED_SUBSCRIPTION_STATES = new Set(["active", "trial", "trialing"]);
const ENTITLED_TENANT_STATES = new Set(["active", "trial", "trialing", "owner"]);

const RECOVERY_ROUTES = new Map([
  ["GET /api/users/me", "account_status"],
  ["POST /api/auth/logout", "logout"],
  ["POST /api/auth/change-password", "account_security"],
  ["POST /api/account/mfa/enroll", "account_security"],
  ["POST /api/account/mfa/confirm", "account_security"],
  ["DELETE /api/account/mfa", "account_security"],
  ["PATCH /api/account/profile", "account_profile"],
  ["POST /api/payments/trc20/request", "subscription_renewal"]
]);

function timestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function subscriptionRank(subscription) {
  const end = timestamp(subscription?.currentPeriodEnd);
  if (end !== null) return end;
  return subscription?.planId === "owner" || subscription?.source === "owner_grant"
    ? Number.POSITIVE_INFINITY
    : Number.NEGATIVE_INFINITY;
}

export function resolveTenantEntitlement(db, { user = null, tenantId = null, at = Date.now() } = {}) {
  const now = at instanceof Date ? at.getTime() : Number(at);
  const resolvedTenantId = String(tenantId || user?.tenantId || "");
  if (user?.isOwner === true) {
    return { allowed: true, reason: null, tenantId: resolvedTenantId || "tenant_owner", ownerGrant: true };
  }
  const tenant = (db?.tenants || []).find((item) => item.id === resolvedTenantId) || null;
  if (!tenant) return { allowed: false, reason: "tenant_unavailable", tenantId: resolvedTenantId };
  if (!ENTITLED_TENANT_STATES.has(String(tenant.status || "").toLowerCase())) {
    return { allowed: false, reason: "tenant_inactive", tenantId: resolvedTenantId, tenantStatus: tenant.status || null };
  }
  const candidates = (db?.subscriptions || [])
    .filter((item) => item.tenantId === resolvedTenantId || (user?.id && item.userId === user.id))
    .filter((item) => ENTITLED_SUBSCRIPTION_STATES.has(String(item.status || "").toLowerCase()))
    .sort((left, right) => subscriptionRank(right) - subscriptionRank(left));
  const subscription = candidates[0] || null;
  if (!subscription) return { allowed: false, reason: "subscription_missing", tenantId: resolvedTenantId };
  const indefiniteOwnerGrant = resolvedTenantId === "tenant_owner"
    && (subscription.planId === "owner" || subscription.source === "owner_grant")
    && subscription.currentPeriodEnd == null;
  const periodEnd = timestamp(subscription.currentPeriodEnd);
  if (!indefiniteOwnerGrant && (periodEnd === null || periodEnd <= now)) {
    return {
      allowed: false,
      reason: periodEnd === null ? "subscription_period_unavailable" : "subscription_expired",
      tenantId: resolvedTenantId,
      subscriptionId: subscription.id || null,
      currentPeriodEnd: subscription.currentPeriodEnd || null
    };
  }
  return {
    allowed: true,
    reason: null,
    tenantId: resolvedTenantId,
    subscriptionId: subscription.id || null,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd || null,
    ownerGrant: indefiniteOwnerGrant
  };
}

export function entitlementRecoveryRoute(path, method = "GET") {
  return RECOVERY_ROUTES.get(`${String(method || "GET").toUpperCase()} ${String(path || "")}`) || null;
}

export function requestEntitlementPolicy(db, { user = null, tenantId = null, path = "", method = "GET", at = Date.now() } = {}) {
  const entitlement = resolveTenantEntitlement(db, { user, tenantId, at });
  if (entitlement.allowed) return { allowed: true, recoveryOnly: false, entitlement };
  const recoveryCapability = entitlementRecoveryRoute(path, method);
  if (recoveryCapability) return { allowed: true, recoveryOnly: true, recoveryCapability, entitlement };
  return { allowed: false, recoveryOnly: false, entitlement };
}
