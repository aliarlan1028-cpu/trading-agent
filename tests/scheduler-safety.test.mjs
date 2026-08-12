import assert from "node:assert/strict";
import test from "node:test";
import {
  parseEveryMs,
  registerTaskHandler,
  runTask,
  scheduleTask,
  schedulerStatus,
  startScheduler,
  stopScheduler,
  unscheduleTask,
  validateTaskDefinition
} from "../server/scheduler.mjs";

function dbWith(task) {
  return { tasks: [task], jobLocks: [], jobRuns: [], auditLogs: [], traces: [], meta: {} };
}

test("Every 表达式严格校验，不再把拼错表达式静默当 5 分钟", () => {
  assert.equal(parseEveryMs("Every 15m"), 15 * 60_000);
  assert.equal(parseEveryMs("15m"), null);
  assert.equal(parseEveryMs("Every bananas"), null);
  assert.equal(validateTaskDefinition({ name: "x", type: "Every", schedule: "Every bananas", handler: "reminder" }).valid, false);
  assert.equal(validateTaskDefinition({ name: "x", type: "Every", schedule: "Every 30s", handler: "reminder" }).valid, false);
});

test("普通任务只允许白名单处理器且 At 必须在未来", () => {
  assert.equal(validateTaskDefinition({ name: "x", type: "Every", schedule: "Every 5m", handler: "execution_poll" }).valid, false);
  assert.equal(validateTaskDefinition({ name: "x", type: "At", schedule: new Date(Date.now() - 1000).toISOString(), handler: "reminder" }).valid, false);
  assert.equal(validateTaskDefinition({ name: "x", type: "At", schedule: new Date(Date.now() + 60_000).toISOString(), handler: "reminder" }).valid, true);
});

test("停用任务即使被旧 scheduler/retry 回调命中也不会执行", async () => {
  let calls = 0;
  registerTaskHandler("test_disabled_guard", async () => { calls += 1; return { status: "ok" }; });
  const task = { id: "disabled", name: "disabled", type: "Every", schedule: "Every 5m", handler: "test_disabled_guard", enabled: false, systemManaged: true };
  const result = await runTask(dbWith(task), task.id, null, "scheduler");
  assert.equal(result.status, "skipped_disabled");
  assert.equal(calls, 0);
});

test("未注册处理器会记录失败而不是假成功", async () => {
  const task = { id: "missing-handler", name: "missing", type: "Every", schedule: "Every 5m", handler: "does_not_exist", enabled: true, systemManaged: true, retryPolicy: { maxRetries: 0 } };
  const db = dbWith(task);
  const result = await runTask(db, task.id, null, "manual");
  assert.equal(result.run.status, "failed");
  assert.match(result.run.output, /未注册/);
  assert.equal(task.status, "失败");
});

test("处理器返回 failed/error 不能被调度器记为成功", async () => {
  registerTaskHandler("test_result_failed", async () => ({ status: "failed", error: "upstream unavailable" }));
  const task = { id: "result-failed", name: "result failed", type: "Every", schedule: "Every 5m", handler: "test_result_failed", enabled: true, systemManaged: true, retryPolicy: { maxRetries: 0 } };
  const result = await runTask(dbWith(task), task.id, null, "manual");
  assert.equal(result.run.status, "failed");
  assert.match(result.run.output, /upstream unavailable/);
});

test("处理器部分成功会如实记录为 partial", async () => {
  registerTaskHandler("test_result_partial", async () => ({ status: "partial", succeeded: 1, failed: 1 }));
  const task = { id: "result-partial", name: "result partial", type: "Every", schedule: "Every 5m", handler: "test_result_partial", enabled: true, systemManaged: true };
  const result = await runTask(dbWith(task), task.id, null, "manual");
  assert.equal(result.run.status, "partial");
  assert.equal(task.status, "部分完成");
});

test("暂停会移除真实 interval，恢复可以重新调度", () => {
  registerTaskHandler("test_schedule_lifecycle", async () => ({ status: "ok" }));
  const task = { id: "lifecycle", name: "lifecycle", type: "Every", schedule: "Every 5m", handler: "test_schedule_lifecycle", enabled: true, systemManaged: true };
  const db = dbWith(task);
  scheduleTask(db, task);
  assert.ok(task.nextRunAt);
  assert.equal(schedulerStatus(db).intervalJobs, 1);
  unscheduleTask(task.id);
  assert.equal(schedulerStatus(db).intervalJobs, 0);
  stopScheduler();
});

test("动态新增任务继承调度器持久化回调，一次性部分成功也正常收口", async () => {
  registerTaskHandler("test_dynamic_persist", async () => ({ status: "partial", reason: "one source unavailable" }));
  const db = { tasks: [], jobLocks: [], jobRuns: [], auditLogs: [], traces: [], meta: {} };
  let saves = 0;
  startScheduler(db, () => { saves += 1; });
  const task = {
    id: "dynamic-at", name: "dynamic at", type: "At", schedule: new Date(Date.now() + 80).toISOString(),
    handler: "test_dynamic_persist", enabled: true, systemManaged: true
  };
  db.tasks.push(task);
  scheduleTask(db, task);
  await new Promise((resolve) => setTimeout(resolve, 140));
  assert.ok(saves >= 1);
  assert.equal(task.enabled, false);
  assert.equal(task.status, "已完成");
  assert.equal(db.jobRuns[0].status, "partial");
  stopScheduler();
});
