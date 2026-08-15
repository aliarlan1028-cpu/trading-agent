import test from "node:test";
import assert from "node:assert/strict";
import { registerTaskHandler, runTask } from "../server/scheduler.mjs";

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

test("fencing owner mismatch cannot renew or release another scheduler run", () => {
  const leases = leaseApi();
  const first = leases.acquire("scheduler:key", "owner-a");
  assert.equal(leases.renew("scheduler:key", "owner-b", first.fencingToken).renewed, false);
  assert.equal(leases.release("scheduler:key", "owner-b", first.fencingToken), false);
  assert.equal(leases.active.has("scheduler:key"), true);
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
