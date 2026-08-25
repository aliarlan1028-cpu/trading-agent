import test from "node:test";
import assert from "node:assert/strict";
import { ensureSystemTask, registerTaskHandler, runTask } from "../server/scheduler.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function dbWith(task) {
  task.systemManaged = true;
  return { tasks: [task], jobLocks: [], jobRuns: [], auditLogs: [], traces: [], meta: {} };
}

function leaseApi() {
  let token = 0;
  const active = new Map();
  return {
    acquire(resource, ownerId) {
      if (active.has(resource)) return { acquired: false, ...active.get(resource) };
      const lease = { ownerId, fencingToken: ++token, expiresAt: new Date(Date.now() + 60_000).toISOString() };
      active.set(resource, lease);
      return { acquired: true, ...lease };
    },
    renew(resource, ownerId, fencingToken) {
      const current = active.get(resource);
      return { renewed: current?.ownerId === ownerId && current?.fencingToken === fencingToken, expiresAt: new Date(Date.now() + 60_000).toISOString() };
    },
    release(resource, ownerId, fencingToken) {
      const current = active.get(resource);
      if (current?.ownerId !== ownerId || current?.fencingToken !== fencingToken) return false;
      active.delete(resource);
      return true;
    },
    active
  };
}

test("a still-running handler cannot be stolen after an arbitrary wall-clock age", async () => {
  const gate = deferred();
  let calls = 0;
  registerTaskHandler("lease_long_running", async () => { calls += 1; await gate.promise; return { status: "ok" }; });
  const task = { id: "task_lease", name: "lease", enabled: true, handler: "lease_long_running", concurrencyKey: "agent_cycle", type: "Every", schedule: "15m" };
  const db = dbWith(task);
  const leases = leaseApi();
  const first = runTask(db, task.id, null, "manual", { leaseApi: leases, leaseTtlMs: 5_000 });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await runTask(db, task.id, null, "manual", { leaseApi: leases, leaseTtlMs: 5_000 });
  assert.equal(second.run.status, "skipped_locked");
  assert.equal(calls, 1);
  gate.resolve();
  await first;
  const third = await runTask(db, task.id, null, "manual", { leaseApi: leases, leaseTtlMs: 5_000 });
  assert.equal(third.run.status, "ok");
  assert.equal(calls, 2);
});

test("a locked scheduler tick persists only scheduler bookkeeping", async () => {
  const gate = deferred();
  registerTaskHandler("locked_tick_scoped_persistence", async () => {
    await gate.promise;
    return { status: "ok", persistCollections: ["system"] };
  });
  const task = {
    id: "task_locked_tick_scoped_persistence",
    name: "locked tick persistence",
    enabled: true,
    handler: "locked_tick_scoped_persistence",
    type: "Every",
    schedule: "1m"
  };
  const db = dbWith(task);
  const leases = leaseApi();
  const saves = [];
  const save = (_database, options) => saves.push(options);
  const first = runTask(db, task.id, save, "scheduler", { leaseApi: leases });
  await new Promise((resolve) => setImmediate(resolve));

  const second = await runTask(db, task.id, save, "scheduler", { leaseApi: leases });

  assert.equal(second.run.status, "skipped_locked");
  assert.deepEqual(saves, [{ collections: ["meta", "tasks", "jobRuns", "jobLocks"] }]);
  gate.resolve();
  await first;
});

test("a failed scheduler handler persists only scheduler bookkeeping", async () => {
  registerTaskHandler("failed_tick_scoped_persistence", async () => {
    throw new Error("upstream unavailable");
  });
  const task = {
    id: "task_failed_tick_scoped_persistence",
    name: "failed tick persistence",
    enabled: true,
    handler: "failed_tick_scoped_persistence",
    type: "Every",
    schedule: "30s",
    retryPolicy: { maxRetries: 0, backoffSeconds: 1 }
  };
  const db = dbWith(task);
  const saves = [];

  const result = await runTask(db, task.id, (_database, options) => saves.push(options), "scheduler", { leaseApi: leaseApi() });

  assert.equal(result.run.status, "failed");
  assert.equal(saves.length, 2);
  assert.ok(saves.every((options) => JSON.stringify(options) === JSON.stringify({
    collections: ["meta", "tasks", "jobRuns", "jobLocks"]
  })));
});

test("a structured failed result preserves its declared fail-closed business state", async () => {
  registerTaskHandler("failed_result_scoped_persistence", async () => ({
    status: "failed",
    error: "authoritative sync unavailable",
    persistCollections: ["riskIncidents", "system"]
  }));
  const task = {
    id: "task_failed_result_scoped_persistence",
    name: "failed result persistence",
    enabled: true,
    handler: "failed_result_scoped_persistence",
    type: "Every",
    schedule: "1m",
    retryPolicy: { maxRetries: 0, backoffSeconds: 1 }
  };
  const db = dbWith(task);
  const saves = [];

  const result = await runTask(db, task.id, (_database, options) => saves.push(options), "scheduler", { leaseApi: leaseApi() });

  assert.equal(result.run.status, "failed");
  assert.deepEqual(saves[0], {
    collections: ["meta", "tasks", "jobRuns", "jobLocks", "riskIncidents", "system"]
  });
  assert.deepEqual(saves[1], { collections: ["meta", "tasks", "jobRuns", "jobLocks"] });
});

test("fencing owner mismatch cannot renew or release another scheduler run", () => {
  const leases = leaseApi();
  const first = leases.acquire("scheduler:key", "owner-a");
  assert.equal(leases.renew("scheduler:key", "owner-b", first.fencingToken).renewed, false);
  assert.equal(leases.release("scheduler:key", "owner-b", first.fencingToken), false);
  assert.equal(leases.active.has("scheduler:key"), true);
});

test("a transient SQLite lease acquisition failure does not reject or run the task", async () => {
  let calls = 0;
  registerTaskHandler("lease_busy_acquire", async () => {
    calls += 1;
    return { status: "ok" };
  });
  const busy = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
  const api = {
    acquire() { throw busy; },
    renew() { throw new Error("renew must not run"); },
    release() { throw new Error("release must not run"); }
  };
  const task = { id: "task_busy", name: "busy", enabled: true, handler: "lease_busy_acquire", type: "Every", schedule: "1m" };
  const db = dbWith(task);

  const result = await runTask(db, task.id, null, "scheduler", { leaseApi: api });

  assert.equal(result.status, "lease_unavailable");
  assert.equal(result.error, "SQLITE_BUSY");
  assert.equal(calls, 0);
  assert.equal(db.jobRuns.length, 0);
});

test("a non-SQLite lease acquisition defect is not hidden as transient contention", async () => {
  const defect = new Error("lease adapter defect");
  const api = {
    acquire() { throw defect; },
    renew() { throw new Error("renew must not run"); },
    release() { throw new Error("release must not run"); }
  };
  const task = { id: "task_defect", name: "defect", enabled: true, handler: "lease_busy_acquire", type: "Every", schedule: "1m" };

  await assert.rejects(
    runTask(dbWith(task), task.id, null, "scheduler", { leaseApi: api }),
    (error) => error === defect
  );
});

test("a transient lease renewal exception is handled as lease loss", async () => {
  registerTaskHandler("lease_busy_renew", async (_db, _task, context) => {
    context.assertLease();
    return { status: "ok" };
  });
  const api = {
    acquire: (_resource, ownerId) => ({ acquired: true, ownerId, fencingToken: 4, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    renew() { throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }); },
    release: () => true
  };
  const task = { id: "task_busy_renew", name: "busy renew", enabled: true, handler: "lease_busy_renew", type: "Every", schedule: "1m" };

  const result = await runTask(dbWith(task), task.id, null, "scheduler", { leaseApi: api });

  assert.equal(result.run.status, "lease_lost");
  assert.equal(task.lastError, "scheduler_lease_lost");
});

test("a transient lease release exception cannot overturn a completed task", async () => {
  registerTaskHandler("lease_busy_release", async () => ({ status: "ok" }));
  const api = {
    acquire: (_resource, ownerId) => ({ acquired: true, ownerId, fencingToken: 5, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    renew: () => ({ renewed: true, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    release() { throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }); }
  };
  const task = { id: "task_busy_release", name: "busy release", enabled: true, handler: "lease_busy_release", type: "Every", schedule: "1m" };

  const result = await runTask(dbWith(task), task.id, null, "scheduler", { leaseApi: api });

  assert.equal(result.run.status, "ok");
  assert.equal(task.lastError, null);
});

test("lease loss inside a handler fences every later side effect", async () => {
  const effects = [];
  registerTaskHandler("lease_fenced_effects", async (_db, _task, context) => {
    context.assertLease();
    effects.push("first");
    context.assertLease();
    effects.push("second");
    return { status: "ok" };
  });
  let renewals = 0;
  const api = {
    acquire: (_resource, ownerId) => ({ acquired: true, ownerId, fencingToken: 9, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    renew: () => ({ renewed: ++renewals === 1, expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    release: () => true
  };
  const task = { id: "task_fenced", name: "fenced", enabled: true, handler: "lease_fenced_effects", concurrencyKey: "fenced", type: "Every", schedule: "15m" };
  const result = await runTask(dbWith(task), task.id, null, "manual", { leaseApi: api });
  assert.deepEqual(effects, ["first"]);
  assert.equal(result.run.status, "lease_lost");
  assert.equal(task.lastError, "scheduler_lease_lost");
});

test("a bounded task aborts cooperatively, releases its lock, and can run again", async () => {
  let calls = 0;
  registerTaskHandler("lease_bounded_runtime", async (_db, _task, context) => {
    calls += 1;
    if (calls > 1) return { status: "ok" };
    return new Promise((resolve, reject) => {
      const fallback = setTimeout(() => resolve({ status: "ok" }), 150);
      context.signal.addEventListener("abort", () => {
        clearTimeout(fallback);
        reject(context.signal.reason);
      }, { once: true });
    });
  });
  const task = {
    id: "task_bounded",
    name: "bounded",
    enabled: true,
    handler: "lease_bounded_runtime",
    concurrencyKey: "bounded",
    maxRunMs: 20,
    retryPolicy: { maxRetries: 0 },
    type: "Every",
    schedule: "2m"
  };
  const db = dbWith(task);
  const leases = leaseApi();

  const first = await runTask(db, task.id, null, "manual", { leaseApi: leases });
  assert.equal(first.run.status, "failed");
  assert.equal(first.run.output, "scheduler_task_timeout");
  assert.equal(task.lastError, "scheduler_task_timeout");
  assert.equal(leases.active.size, 0);

  const second = await runTask(db, task.id, null, "manual", { leaseApi: leases });
  assert.equal(second.run.status, "ok");
  assert.equal(calls, 2);
});

test("system task upgrades persist the approved runtime bound", () => {
  const db = dbWith({
    id: "task_market",
    name: "old market",
    enabled: true,
    handler: "market_signal_refresh",
    type: "Every",
    schedule: "2m"
  });

  ensureSystemTask(db, {
    id: "task_market",
    name: "market",
    handler: "market_signal_refresh",
    schedule: "Every 2m",
    maxRunMs: 90_000
  });

  assert.equal(db.tasks[0].maxRunMs, 90_000);
});

test("a scoped handler persists its business collections plus scheduler bookkeeping", async () => {
  registerTaskHandler("scoped_scheduler_persistence", async () => ({
    status: "ok",
    persistCollections: ["opportunityCandidates", "system"]
  }));
  const task = {
    id: "task_scoped_scheduler_persistence",
    name: "scoped scheduler persistence",
    enabled: true,
    handler: "scoped_scheduler_persistence",
    type: "Every",
    schedule: "1m"
  };
  const db = dbWith(task);
  const saves = [];

  await runTask(db, task.id, (_database, options) => saves.push(options), "scheduler", { leaseApi: leaseApi() });

  assert.equal(saves.length, 1);
  assert.deepEqual(saves[0].collections.slice().sort(), [
    "jobLocks", "jobRuns", "meta", "opportunityCandidates", "system", "tasks"
  ]);
});
