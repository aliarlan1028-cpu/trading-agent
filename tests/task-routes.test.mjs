import assert from "node:assert/strict";
import test from "node:test";
import { registerTaskRoutes } from "../server/routes/tasks.mjs";
import { validateTaskDefinition } from "../server/scheduler.mjs";

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function harness({ tasks = [], runs = [], admin = false } = {}) {
  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "patch", "delete"]) {
    app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers.at(-1));
  }
  const calls = { scheduled: [], unscheduled: [] };
  const routeUser = { id: "user_member", name: "member", roleId: "role_member", tenantId: "tenant_owner", status: "active", securityVersion: 1 };
  const db = {
    user: { name: "Owner" }, users: [routeUser], roles: [{ id: "role_member", permissions: ["*"] }],
    tenants: [{ id: "tenant_owner", status: "owner" }],
    subscriptions: [{ id: "sub_owner", tenantId: "tenant_owner", planId: "owner", status: "active", source: "owner_grant", currentPeriodEnd: null }],
    tasks, jobRuns: runs, auditLogs: [], traces: [], meta: {}
  };
  registerTaskRoutes(app, {
    db,
    persist(res, payload) { res.payload = payload; },
    saveDb() {},
    requirePermission: () => (_req, _res, next) => next(),
    id: () => "task_new",
    nowIso: () => "2026-08-13T00:00:00.000Z",
    appendAudit() {},
    scheduleTask(_db, task) { calls.scheduled.push(task.id); },
    unscheduleTask(taskId) { calls.unscheduled.push(taskId); },
    runTask: async () => ({ status: "ok" }),
    validateTaskDefinition,
    userHasPermission: () => admin
  });
  return { routes, db, calls, routeUser };
}

test("普通任务不能伪装系统任务或选择高权限处理器", () => {
  const { routes, db, routeUser } = harness();
  const res = response();
  routes.get("POST /api/tasks")({
    user: routeUser,
    body: { name: "poll orders", type: "Every", schedule: "Every 5m", handler: "execution_poll", systemManaged: true }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(db.tasks.length, 0);
});

test("情报任务强制绑定证据化 mission 处理器", () => {
  const { routes, db, calls, routeUser } = harness();
  const res = response();
  routes.get("POST /api/tasks")({
    user: routeUser,
    body: { name: "ETF follow", mission: "跟踪 BTC ETF 进展", type: "Every", schedule: "Every 1h", handler: "reconcile" }
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.tasks[0].handler, "agent_mission");
  assert.equal(db.tasks[0].systemManaged, false);
  assert.deepEqual(calls.scheduled, ["task_new"]);
});

test("删除普通任务保留历史运行证据", () => {
  const task = {
    id: "user_task", name: "user task", type: "Every", schedule: "Every 5m", handler: "reminder", enabled: true,
    creatorUserId: "user_member", tenantId: "tenant_owner", creatorSecurityVersion: 1, requiredPermissions: ["write:task"]
  };
  const run = { id: "run_1", taskId: task.id, status: "ok" };
  const { routes, db, calls, routeUser } = harness({ tasks: [task], runs: [run] });
  const res = response();
  routes.get("DELETE /api/tasks/:id")({ params: { id: task.id }, user: routeUser }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(db.tasks.length, 0);
  assert.equal(db.jobRuns[0].taskDeletedAt, "2026-08-13T00:00:00.000Z");
  assert.deepEqual(calls.unscheduled, [task.id]);
});

test("系统任务定义不可修改，生命周期操作只允许管理员", () => {
  const task = { id: "task_sys_safe", name: "system task", type: "Every", schedule: "Every 5m", handler: "reminder", enabled: true, systemManaged: true };
  let setup = harness({ tasks: [task], admin: false });
  let res = response();
  setup.routes.get("PATCH /api/tasks/:id")({ params: { id: task.id }, body: { schedule: "Every 1h" } }, res);
  assert.equal(res.statusCode, 403);
  res = response();
  setup.routes.get("POST /api/tasks/:id/pause")({ params: { id: task.id }, user: { name: "member" }, body: {} }, res);
  assert.equal(res.statusCode, 403);

  setup = harness({ tasks: [task], admin: true });
  res = response();
  setup.routes.get("POST /api/tasks/:id/pause")({ params: { id: task.id }, user: { name: "admin" }, body: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(task.enabled, false);
  assert.deepEqual(setup.calls.unscheduled, [task.id]);
});
