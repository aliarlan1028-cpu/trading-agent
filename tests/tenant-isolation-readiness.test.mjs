import assert from "node:assert/strict";
import test from "node:test";
import { tenantIsolationReadiness, tenantWorkspaceAccess } from "../server/tenantIsolation.mjs";

test("owner workspace remains available in the single-instance architecture", () => {
  assert.equal(tenantWorkspaceAccess("tenant_owner").allowed, true);
});

test("setting TENANT_ISOLATION_V2 cannot expose a non-owner tenant before resource isolation is complete", () => {
  const previous = process.env.TENANT_ISOLATION_V2;
  process.env.TENANT_ISOLATION_V2 = "true";
  try {
    const readiness = tenantIsolationReadiness();
    assert.equal(readiness.ready, false);
    assert.ok(readiness.missingDomains.includes("execution_orders"));
    assert.ok(readiness.missingDomains.includes("payments"));
    const access = tenantWorkspaceAccess("tenant_a");
    assert.equal(access.allowed, false);
    assert.equal(access.reason, "tenant_isolation_not_ready");
  } finally {
    if (previous === undefined) delete process.env.TENANT_ISOLATION_V2;
    else process.env.TENANT_ISOLATION_V2 = previous;
  }
});

test("client supplied tenant identifiers never make a second workspace accessible", () => {
  const previous = process.env.TENANT_ISOLATION_V2;
  process.env.TENANT_ISOLATION_V2 = "true";
  try {
    for (const tenantId of ["tenant_a", "tenant_b", "tenant_owner_evil", "*"]) {
      assert.equal(tenantWorkspaceAccess(tenantId).allowed, false, tenantId);
    }
  } finally {
    if (previous === undefined) delete process.env.TENANT_ISOLATION_V2;
    else process.env.TENANT_ISOLATION_V2 = previous;
  }
});
