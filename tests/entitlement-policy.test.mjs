import assert from "node:assert/strict";
import test from "node:test";

import {
  entitlementRecoveryRoute,
  requestEntitlementPolicy,
  resolveTenantEntitlement
} from "../server/entitlements.mjs";
import { consumeStreamTicket, issueStreamTicket } from "../server/streamTickets.mjs";

function database(end = "2026-08-15T00:00:00.001Z", status = "trialing") {
  return {
    tenants: [{ id: "tenant_trial", status: "trial" }],
    subscriptions: [{
      id: "sub_trial",
      tenantId: "tenant_trial",
      status,
      currentPeriodEnd: end
    }]
  };
}

test("trial and paid entitlement use a strict millisecond boundary", () => {
  const db = database();
  assert.equal(resolveTenantEntitlement(db, { tenantId: "tenant_trial", at: Date.parse("2026-08-15T00:00:00.000Z") }).allowed, true);
  const boundary = resolveTenantEntitlement(db, { tenantId: "tenant_trial", at: Date.parse("2026-08-15T00:00:00.001Z") });
  assert.equal(boundary.allowed, false);
  assert.equal(boundary.reason, "subscription_expired");
});

test("expired sessions are restricted to renewal and personal security endpoints", () => {
  const db = database("2026-08-14T00:00:00.000Z", "active");
  const base = { tenantId: "tenant_trial", at: Date.parse("2026-08-15T00:00:00.000Z") };
  assert.equal(requestEntitlementPolicy(db, { ...base, path: "/api/positions", method: "GET" }).allowed, false);
  for (const [method, path] of [
    ["GET", "/api/users/me"],
    ["POST", "/api/auth/logout"],
    ["POST", "/api/auth/change-password"],
    ["POST", "/api/payments/trc20/request"]
  ]) {
    const policy = requestEntitlementPolicy(db, { ...base, path, method });
    assert.equal(policy.allowed, true, `${method} ${path}`);
    assert.equal(policy.recoveryOnly, true, `${method} ${path}`);
  }
  assert.equal(entitlementRecoveryRoute("/api/stream/ticket", "POST"), null);
});

test("renewal immediately restores access while the owner grant never expires", () => {
  const db = database("2026-08-14T00:00:00.000Z", "active");
  const at = Date.parse("2026-08-15T00:00:00.000Z");
  assert.equal(resolveTenantEntitlement(db, { tenantId: "tenant_trial", at }).allowed, false);
  db.subscriptions[0].currentPeriodEnd = "2026-09-15T00:00:00.000Z";
  assert.equal(resolveTenantEntitlement(db, { tenantId: "tenant_trial", at }).allowed, true);

  db.tenants.push({ id: "tenant_owner", status: "owner" });
  db.subscriptions.push({ id: "sub_owner", tenantId: "tenant_owner", planId: "owner", source: "owner_grant", status: "active", currentPeriodEnd: null });
  assert.equal(resolveTenantEntitlement(db, { tenantId: "tenant_owner", at: Date.parse("2099-01-01T00:00:00.000Z") }).allowed, true);
});

test("stream tickets seal tenant, permission scope and security version", () => {
  const issued = issueStreamTicket({
    userId: "user_1",
    sessionId: "session_1",
    tenantId: "tenant_trial",
    securityVersion: 7,
    scopes: ["account.read", "account.read", "market.read"],
    ttlMs: 60_000
  });
  const info = consumeStreamTicket(issued.ticket);
  assert.equal(info.tenantId, "tenant_trial");
  assert.equal(info.securityVersion, 7);
  assert.deepEqual(info.scopes, ["account.read", "market.read"]);
  assert.equal(consumeStreamTicket(issued.ticket), null, "ticket remains single use");
});
