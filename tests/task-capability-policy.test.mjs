import assert from "node:assert/strict";
import test from "node:test";

import { canConfirmPendingAction } from "../server/actionAuthorization.mjs";
import { pendingActionCapabilities, storedTaskAuthorization, taskHandlerPolicy } from "../server/capabilityPolicy.mjs";
import { agentToolPolicy, authorizeAgentTool } from "../server/agentToolAuthorization.mjs";
import { registerObservabilityRoutes } from "../server/routes/observability.mjs";
import { validateTaskDefinition } from "../server/scheduler.mjs";

function database(permissions = []) {
  return {
    roles: [{ id: "role_custom", name: "custom", permissions }],
    users: [{ id: "user_1", roleId: "role_custom", tenantId: "tenant_1", status: "active", securityVersion: 3 }],
    tenants: [{ id: "tenant_1", status: "active" }],
    subscriptions: [{ id: "sub_1", tenantId: "tenant_1", status: "active", currentPeriodEnd: "2099-01-01T00:00:00.000Z" }]
  };
}

function task(handler = "reminder") {
  const policy = taskHandlerPolicy(handler);
  return {
    id: "task_1",
    handler,
    creatorUserId: "user_1",
    tenantId: "tenant_1",
    creatorSecurityVersion: 3,
    requiredPermissions: [...(policy?.permissions || [])]
  };
}

test("run_reconcile pending action uses the same write:exchange capability as the REST route", () => {
  let db = database(["write:risk"]);
  assert.equal(canConfirmPendingAction(db, db.users[0], { type: "run_reconcile", args: {} }).allowed, false);
  db = database(["write:exchange"]);
  const authorized = canConfirmPendingAction(db, db.users[0], { type: "run_reconcile", args: {} });
  assert.equal(authorized.allowed, true);
  assert.deepEqual(authorized.requiredPermissions, ["write:exchange"]);

  assert.deepEqual(agentToolPolicy(db, "request_action", { type: "run_reconcile" }).requiredPermissions, pendingActionCapabilities("run_reconcile"));
  assert.equal(authorizeAgentTool(db, { permissions: ["write:risk"] }, "request_action", { type: "run_reconcile" }).allowed, false);
  assert.equal(authorizeAgentTool(db, { permissions: ["write:exchange"] }, "request_action", { type: "run_reconcile" }).allowed, true);

  const routePermissions = [];
  const app = { post(_path, ...handlers) { void handlers; }, get(_path, ...handlers) { void handlers; }, delete() {} };
  registerObservabilityRoutes(app, {
    db: {}, saveDb() {}, persist() {}, normalizeSymbol() {}, runReconciler() {}, exportTraces() {}, exportAuditLogs() {}, schedulerStatus() {}, startScheduler() {},
    requirePermission(permission) { routePermissions.push(permission); return (_req, _res, next) => next(); }
  });
  assert.equal(routePermissions[2], pendingActionCapabilities("run_reconcile")[0]);
});

test("reconcile is system-only and cannot be laundered through a user task", () => {
  assert.equal(taskHandlerPolicy("reconcile").userSchedulable, false);
  assert.equal(validateTaskDefinition({
    name: "privilege bridge", type: "Every", schedule: "Every 1m", handler: "reconcile", enabled: true
  }).valid, false);
  assert.equal(storedTaskAuthorization(database(["write:task", "write:exchange", "risk.kill_switch"]), task("reconcile")).allowed, false);
});

test("a stored user task is reauthorized against the creator's current permissions and security version", () => {
  const authorizedDb = database(["write:task", "market.read"]);
  const stored = task("agent_mission");
  assert.equal(storedTaskAuthorization(authorizedDb, stored).allowed, true);

  authorizedDb.roles[0].permissions = ["write:task"];
  assert.equal(storedTaskAuthorization(authorizedDb, stored).reason, "task_creator_capability_revoked");

  authorizedDb.roles[0].permissions = ["write:task", "market.read"];
  authorizedDb.users[0].securityVersion = 4;
  assert.equal(storedTaskAuthorization(authorizedDb, stored).reason, "task_creator_security_version_changed");

  authorizedDb.users[0].securityVersion = 3;
  authorizedDb.users[0].status = "disabled";
  assert.equal(storedTaskAuthorization(authorizedDb, stored).reason, "task_creator_capability_revoked");
});

test("a stored user task is paused when its tenant entitlement expires", () => {
  const db = database(["write:task", "market.read"]);
  db.subscriptions[0].currentPeriodEnd = "2020-01-01T00:00:00.000Z";
  assert.equal(storedTaskAuthorization(db, task("agent_mission")).reason, "task_tenant_subscription_expired");
});
