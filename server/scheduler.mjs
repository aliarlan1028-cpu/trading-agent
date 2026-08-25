import cron from "node-cron";
import { acquireExecutionLease, appendAudit, appendTrace, id, nowIso, releaseExecutionLease, renewExecutionLease } from "./store.mjs";
import { isLeaseLostError, LeaseLostError } from "./leaseSafety.mjs";
import { storedTaskAuthorization, taskHandlerPolicy } from "./capabilityPolicy.mjs";

const runtime = {
  started: false,
  saveDb: null,
  cronJobs: new Map(),
  intervalJobs: new Map(),
  timeoutJobs: new Map(),
  activeRuns: new Map(),
  ownerId: `scheduler_${process.pid}_${Math.random().toString(36).slice(2)}`
};

// 真实任务处理器注册表：任务只有命中已注册处理器才算执行成功。
// 由 index.mjs 在启动时注册，禁止再用任务名称猜测行为。
const taskHandlers = new Map();

// 普通用户可创建的任务只允许调用这些确定存在、且不会绕过交易授权链的处理器。
// 系统任务仍可使用完整注册表，但必须由 ensureSystemTask 创建并标成 systemManaged。
export const USER_TASK_HANDLERS = Object.freeze([
  "reminder",
  "agent_mission",
  "event_refresh",
  "market_signal_refresh",
  "strategy_research",
  "paper_forward",
  "trade_reflection",
  "missed_opportunity_review"
]);
const USER_TASK_HANDLER_SET = new Set(USER_TASK_HANDLERS);
const MAX_TIMEOUT_MS = 2_147_000_000;

function sqliteContentionCode(error) {
  const code = String(error?.code || "");
  return /^SQLITE_(?:BUSY|LOCKED)(?:_|$)/.test(code) ? code : null;
}

function localLeaseApi(db) {
  return {
    acquire(resource, ownerId, ttlMs) {
      const now = Date.now();
      const current = (db.jobLocks || []).find((row) => row.leaseResource === resource && row.locked && new Date(row.expiresAt).getTime() > now);
      if (current) return { acquired: false, ownerId: current.ownerId, fencingToken: current.fencingToken, expiresAt: current.expiresAt };
      return { acquired: true, ownerId, fencingToken: Number(current?.fencingToken || 0) + 1, expiresAt: new Date(now + ttlMs).toISOString() };
    },
    renew(resource, ownerId, fencingToken, ttlMs) {
      const current = (db.jobLocks || []).find((row) => row.leaseResource === resource && row.ownerId === ownerId && row.fencingToken === fencingToken && row.locked);
      if (!current) return { renewed: false, expiresAt: null };
      current.expiresAt = new Date(Date.now() + ttlMs).toISOString();
      return { renewed: true, expiresAt: current.expiresAt };
    },
    release(resource, ownerId, fencingToken) {
      const current = (db.jobLocks || []).find((row) => row.leaseResource === resource && row.ownerId === ownerId && row.fencingToken === fencingToken && row.locked);
      if (!current) return false;
      current.locked = false;
      return true;
    }
  };
}

export function registerTaskHandler(name, fn) {
  taskHandlers.set(name, fn);
}

export function ensureSystemTask(db, task, saveDb) {
  const existing = (db.tasks || []).find((item) => item.id === task.id);
  if (existing) {
    // 系统任务升级时同步调度定义，但保留用户显式启停状态与运行历史。
    for (const key of ["name", "handler", "schedule", "type", "role", "concurrencyKey", "startupCatchup", "startupDelayMs", "timezone", "maxRunMs"]) {
      if (task[key] !== undefined) existing[key] = task[key];
    }
    existing.systemManaged = true;
    if (runtime.started) scheduleTask(db, existing, saveDb);
    return existing;
  }
  const created = { enabled: true, type: "Every", role: "系统", systemManaged: true, createdAt: nowIso(), ...task };
  db.tasks.push(created);
  if (runtime.started) scheduleTask(db, created, saveDb);
  return created;
}

// 长间隔任务的启动补跑判定(纯函数,便于测试):
// setInterval 在每次进程重启后从零重新计时,部署/自动重启频繁的日子里,
// 6h 级任务(策略研究/改进闭环)可能永远轮不到执行。间隔 ≥ 30 分钟且已超期的任务,
// 启动后错峰补跑一次;短间隔任务本来 1-2 分钟内就会自然触发,不需要补。
export function overdueLongTasks(db, now = Date.now()) {
  const MIN_INTERVAL_MS = 30 * 60_000;
  return (db.tasks || []).filter((task) => {
    if (!task.enabled) return false;
    if (String(task.type || "").toLowerCase() === "cron") return cronStartupCatchupDue(task, now);
    if (String(task.type || "").toLowerCase() !== "every") return false;
    const intervalMs = parseEveryMs(task.schedule);
    if (!intervalMs) return false;
    if (intervalMs < MIN_INTERVAL_MS && task.startupCatchup !== true) return false;
    if (!task.lastRunAt) return true; // 从未跑过的长间隔任务也补
    return now - new Date(task.lastRunAt).getTime() > intervalMs;
  });
}

function zonedParts(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

// 仅支持系统使用的“每天 H:M”五段 cron；复杂 cron 仍交给 node-cron，不做猜测式补跑。
function cronStartupCatchupDue(task, now) {
  if (task.startupCatchup !== true) return false;
  const match = String(task.schedule || "").trim().match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!match) return false;
  const current = zonedParts(now, task.timezone);
  const scheduledMinutes = Number(match[2]) * 60 + Number(match[1]);
  const currentMinutes = Number(current.hour) * 60 + Number(current.minute);
  if (currentMinutes < scheduledMinutes) return false;
  if (!task.lastRunAt) return true;
  const previous = zonedParts(task.lastRunAt, task.timezone);
  const currentDay = `${current.year}-${current.month}-${current.day}`;
  const previousDay = `${previous.year}-${previous.month}-${previous.day}`;
  return previousDay !== currentDay;
}

export function startScheduler(db, saveDb) {
  if (runtime.started) return schedulerStatus(db);
  runtime.started = true;
  // 后续由 API/Agent 动态新增的任务只会调用 scheduleTask(db, task)，也必须继承
  // 启动时的持久化回调；否则定时器确实会跑，但运行历史/通知要等其他任务碰巧落盘。
  runtime.saveDb = saveDb || null;
  // 不再在启动时释放共享锁：蓝绿部署/双实例下，旧进程可能仍在合法运行。
  // 同理，重启后遗留的“运行中”只是旧进程最后一次写下的展示状态，不代表当前
  // 进程仍在执行。先归一为等待；本轮真正完成/失败后 recordRun 会写准确终态。
  for (const task of db.tasks || []) {
    if (task.status === "运行中") task.status = task.enabled === false ? "暂停" : "等待";
  }
  recoverFailedRuns(db, saveDb);
  for (const task of db.tasks || []) {
    try {
      scheduleTask(db, task, saveDb);
    } catch (error) {
      task.enabled = false;
      task.status = "调度无效";
      task.lastError = String(error.message || error);
      appendTrace(db, "scheduled_task", `${task.name || task.id} 未进入调度：${task.lastError}`, "error");
    }
  }
  // 超期长任务补跑:等启动稳定 2 分钟后开始,彼此错峰 90s,避免启动即 CPU 打满
  const overdue = overdueLongTasks(db);
  overdue.forEach((task, index) => {
    const configuredDelay = Number(task.startupDelayMs);
    const baseDelay = Number.isFinite(configuredDelay) ? Math.max(1_000, configuredDelay) : 120_000;
    const timer = setTimeout(() => {
      runtime.timeoutJobs.delete(`catchup_${task.id}`);
      if (!task.enabled) return;
      appendTrace(db, "scheduled_task", `${task.name} 启动补跑（上次运行 ${task.lastRunAt || "从未"}，超过间隔 ${task.schedule}）`, "ok");
      runTask(db, task.id, saveDb, "startup_catchup");
    }, baseDelay + index * 5_000);
    runtime.timeoutJobs.set(`catchup_${task.id}`, timer);
  });
  return schedulerStatus(db);
}

export function scheduleTask(db, task, saveDb) {
  clearScheduledCoreTask(task.id);
  if (!task.enabled) return;
  const persistDb = saveDb || runtime.saveDb;
  const validation = validateTaskDefinition(task, { allowSystemHandlers: task.systemManaged === true });
  if (!validation.valid) throw new Error(validation.errors.join("；"));
  const type = String(task.type || "").toLowerCase();
  if (type === "every") {
    const intervalMs = parseEveryMs(task.schedule);
    const timer = setInterval(() => {
      runTask(db, task.id, persistDb, "scheduler");
    }, intervalMs);
    runtime.intervalJobs.set(task.id, timer);
    task.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    return;
  }
  if (type === "at") {
    armAtTask(db, task, persistDb);
    return;
  }
  if (type === "cron") {
    const expression = normalizeCron(task.schedule);
    const options = task.timezone ? { timezone: task.timezone } : undefined;
    const job = cron.schedule(expression, () => runTask(db, task.id, persistDb, "scheduler"), options);
    runtime.cronJobs.set(task.id, job);
    task.normalizedCron = expression;
    task.nextRunAt = null; // node-cron 不暴露可靠的下一次时间，避免沿用旧值误导前端。
  }
}

function armAtTask(db, task, saveDb) {
  const dueAt = new Date(task.schedule).getTime();
  const remaining = dueAt - Date.now();
  if (remaining <= 0) {
    task.enabled = false;
    task.status = "已过期";
    task.nextRunAt = null;
    return;
  }
  const delayMs = Math.min(remaining, MAX_TIMEOUT_MS);
  const timer = setTimeout(() => {
    runtime.timeoutJobs.delete(task.id);
    if (!task.enabled) return;
    if (dueAt - Date.now() > 500) return armAtTask(db, task, saveDb);
    runTask(db, task.id, saveDb, "scheduler");
  }, delayMs);
  runtime.timeoutJobs.set(task.id, timer);
  task.nextRunAt = new Date(dueAt).toISOString();
}

export function stopScheduler() {
  for (const job of runtime.cronJobs.values()) job.stop();
  for (const timer of runtime.intervalJobs.values()) clearInterval(timer);
  for (const timer of runtime.timeoutJobs.values()) clearTimeout(timer);
  runtime.cronJobs.clear();
  runtime.intervalJobs.clear();
  runtime.timeoutJobs.clear();
  runtime.started = false;
  runtime.saveDb = null;
}

function clearScheduledCoreTask(taskId) {
  const cronJob = runtime.cronJobs.get(taskId);
  if (cronJob) cronJob.stop();
  runtime.cronJobs.delete(taskId);

  const interval = runtime.intervalJobs.get(taskId);
  if (interval) clearInterval(interval);
  runtime.intervalJobs.delete(taskId);

  const timeout = runtime.timeoutJobs.get(taskId);
  if (timeout) clearTimeout(timeout);
  runtime.timeoutJobs.delete(taskId);
}

// 暂停/删除必须同时清掉主计时器、启动补跑和所有待重试计时器。
export function unscheduleTask(taskId) {
  clearScheduledCoreTask(taskId);
  for (const [key, timer] of runtime.timeoutJobs) {
    if (key === `catchup_${taskId}` || key.startsWith(`${taskId}:retry:`)) {
      clearTimeout(timer);
      runtime.timeoutJobs.delete(key);
    }
  }
}

export function schedulerStatus(db) {
  return {
    started: runtime.started,
    cronJobs: runtime.cronJobs.size,
    intervalJobs: runtime.intervalJobs.size,
    timeoutJobs: runtime.timeoutJobs.size,
    enabledTasks: (db.tasks || []).filter((task) => task.enabled).length,
    failedRuns: (db.jobRuns || []).filter((run) => run.status === "failed").length,
    retryingRuns: (db.jobRuns || []).filter((run) => run.status === "retry_scheduled").length
  };
}

export async function runTask(db, taskId, saveDb, trigger = "manual", options = {}) {
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return { status: "missing_task", taskId };
  if (task.enabled === false) return { status: "skipped_disabled", taskId, trigger };
  const currentAuthorization = storedTaskAuthorization(db, task);
  if (!currentAuthorization.allowed) {
    task.enabled = false;
    task.status = "暂停";
    task.lastError = currentAuthorization.reason;
    appendAudit(db, `任务创建者权限已失效，任务已暂停：${currentAuthorization.reason}`, task.id, "Scheduler", "critical");
    return recordRun(db, task, "unauthorized", currentAuthorization.reason, trigger, saveDb);
  }

  const concurrencyKey = task.concurrencyKey || task.id;
  if (runtime.activeRuns.has(concurrencyKey)) {
    return recordRun(db, task, "skipped_locked", "任务在本进程中仍运行", trigger, saveDb);
  }
  const leaseApi = options.leaseApi || (db.__sqliteBacked
    ? { acquire: acquireExecutionLease, renew: renewExecutionLease, release: releaseExecutionLease }
    : localLeaseApi(db));
  const leaseTtlMs = Math.max(5_000, Number(options.leaseTtlMs || 60_000));
  const leaseResource = `scheduler:${concurrencyKey}`;
  const ownerId = `${runtime.ownerId}:${id("jobowner")}`;
  let lease;
  try {
    lease = leaseApi.acquire(leaseResource, ownerId, leaseTtlMs);
  } catch (error) {
    // A second maintenance/read-only process can briefly hold SQLite past its
    // busy timeout. Missing one scheduler tick is safer than letting an
    // unhandled lease-acquisition rejection terminate the server process.
    const code = sqliteContentionCode(error);
    if (!code) throw error;
    task.lastError = `scheduler_lease_acquire_failed:${code}`;
    appendTrace(db, "scheduled_task", `${task.name || task.id} 暂未取得调度租约：${code}`, "warning");
    return { status: "lease_unavailable", taskId: task.id, error: code };
  }
  if (!lease?.acquired) return recordRun(db, task, "skipped_locked", "任务共享租约由另一运行实例持有", trigger, saveDb);
  const abortController = new AbortController();
  const maxRunMs = Number(task.maxRunMs);
  const deadline = Number.isFinite(maxRunMs) && maxRunMs > 0
    ? setTimeout(() => {
      const error = new Error("scheduler_task_timeout");
      error.code = "scheduler_task_timeout";
      abortController.abort(error);
    }, maxRunMs)
    : null;
  deadline?.unref?.();
  const executionContext = {
    signal: abortController.signal,
    ownerId,
    fencingToken: lease.fencingToken,
    assertLease() {
      if (abortController.signal.aborted) {
        const reason = abortController.signal.reason;
        if (reason instanceof Error) throw reason;
        throw new Error(String(reason || "scheduler_task_aborted"));
      }
      let renewed;
      try {
        renewed = leaseApi.renew(leaseResource, ownerId, lease.fencingToken, leaseTtlMs);
      } catch (error) {
        if (!sqliteContentionCode(error)) throw error;
        const leaseError = new LeaseLostError("scheduler_lease_renewal_failed");
        abortController.abort(leaseError);
        throw leaseError;
      }
      if (!renewed?.renewed) {
        abortController.abort(new LeaseLostError());
        throw new LeaseLostError();
      }
      lockEntry.heartbeatAt = nowIso();
      lockEntry.expiresAt = renewed.expiresAt;
      return true;
    }
  };
  runtime.activeRuns.set(concurrencyKey, executionContext);
  const lockEntry = {
    id: id("lock"), concurrencyKey, leaseResource, locked: true, taskId, ownerId,
    fencingToken: lease.fencingToken, createdAt: nowIso(), expiresAt: lease.expiresAt
  };
  db.jobLocks.unshift(lockEntry);
  const heartbeat = setInterval(() => {
    try {
      const renewed = leaseApi.renew(leaseResource, ownerId, lease.fencingToken, leaseTtlMs);
      if (!renewed?.renewed) {
        abortController.abort(new LeaseLostError());
        lockEntry.locked = false;
        lockEntry.leaseLostAt = nowIso();
      } else {
        lockEntry.heartbeatAt = nowIso();
        lockEntry.expiresAt = renewed.expiresAt;
      }
    } catch {
      abortController.abort(new LeaseLostError("scheduler_lease_renewal_failed"));
      lockEntry.locked = false;
      lockEntry.leaseLostAt = nowIso();
    }
  }, Math.max(1_000, Math.floor(leaseTtlMs / 3)));
  heartbeat.unref?.();
  try {
    if (task.forceFailure) throw new Error("任务被配置为强制失败，用于测试重试机制。");
    if (!task.handler || !taskHandlers.has(task.handler)) {
      throw new Error(task.handler ? `任务处理器未注册：${task.handler}` : "任务未配置可执行处理器");
    }
    let output;
    if (task.handler && taskHandlers.has(task.handler)) {
      const result = await taskHandlers.get(task.handler)(db, task, executionContext);
      executionContext.assertLease();
      const resultStatus = result && typeof result === "object" ? String(result.status || "").toLowerCase() : "";
      if (["failed", "error"].includes(resultStatus)) {
        const handlerError = new Error(result.error || result.reason || `${task.handler} 返回失败状态`);
        if (Array.isArray(result.persistCollections)) handlerError.persistCollections = result.persistCollections;
        throw handlerError;
      }
      output = typeof result === "string" ? result : summarizeHandlerResult(task.handler, result);
      const skipPersist = result && typeof result === "object" && result.skipPersist === true && trigger !== "manual";
      const persistCollections = result && typeof result === "object" && Array.isArray(result.persistCollections)
        ? result.persistCollections
        : null;
      task.failureCount = 0;
      task.lastError = null;
      const completionStatus = resultStatus === "partial" ? "partial" : resultStatus === "skipped" ? "skipped" : "ok";
      const run = recordRun(db, task, completionStatus, output, trigger, saveDb, { skipPersist, persistCollections });
      return run;
    }
  } catch (error) {
    if (isLeaseLostError(error)) {
      task.lastError = "scheduler_lease_lost";
      return recordRun(db, task, "lease_lost", "任务失去 fencing 租约，已停止后续副作用", trigger, saveDb);
    }
    task.failureCount = Number(task.failureCount || 0) + 1;
    task.lastError = error.message;
    const persistCollections = Array.isArray(error.persistCollections) ? error.persistCollections : undefined;
    const run = recordRun(db, task, "failed", error.message, trigger, saveDb, { persistCollections });
    scheduleRetryIfNeeded(db, task, saveDb, run.run);
    return run;
  } finally {
    if (deadline) clearTimeout(deadline);
    clearInterval(heartbeat);
    runtime.activeRuns.delete(concurrencyKey);
    try {
      leaseApi.release(leaseResource, ownerId, lease.fencingToken);
    } catch (error) {
      const code = sqliteContentionCode(error);
      if (!code) throw error;
      // The fenced lease expires naturally. A transient release failure must
      // not overturn a handler result or crash a detached scheduler callback.
      lockEntry.releaseError = code;
      appendTrace(db, "scheduled_task", `${task.name || task.id} 调度租约等待自动过期：${lockEntry.releaseError}`, "warning");
    }
    lockEntry.locked = false;
    lockEntry.releasedAt = nowIso();
    // 落盘统一由 recordRun 负责(skipPersist 语义才能生效);此前 finally 无条件再全量
    // 落盘一次 → 每次任务双写、空转优化被完全抵消(审计发现)。锁状态随下次落盘持久化。
  }
}

function summarizeHandlerResult(handler, result = {}) {
  if (handler === "execution_poll") return `执行订单轮询：检查 ${result.checked || 0} 个在途执行单。`;
  if (handler === "position_monitor") return `持仓监控：${result.monitored || 0} 个受管持仓，动作 ${result.actions?.length || 0} 项。`;
  if (handler === "accounting_refresh") return `核算刷新：今日盈亏 ${result.todayPnl ?? "-"} USDT，剩余亏损预算 ${result.remainingDailyLossUsdt ?? "未授权"}。`;
  if (handler === "agent_cycle") return `自主巡检：AgentRun ${result.id || "-"}（${result.status || "完成"}）。`;
  if (handler === "reconcile") return `对账：${result.status || "-"}，差异 ${result.differences?.length || 0} 项。`;
  if (handler === "trade_reflection") return `平仓复盘：复盘 ${result.reflected || 0} 笔，沉淀 ${result.memorized || 0} 条教训。`;
  if (handler === "missed_opportunity_review") return `错过机会复盘：扫 ${result.reviewed || 0} 个异动，复盘 ${result.missed || 0} 个未交易的大波动。`;
  return JSON.stringify(result).slice(0, 200);
}

function recordRun(db, task, status, output, trigger, saveDb, opts = {}) {
  task.lastRun = "刚刚";
  task.lastRunAt = nowIso();
  // 这是“本次运行结束”时记录状态，不能永远写成运行中；否则前端会把已经完成、
  // 已失败或被并发锁跳过的任务全部误报为正在执行。
  const oneShotComplete = String(task.type).toLowerCase() === "at" && ["ok", "partial"].includes(status) && trigger !== "manual";
  if (oneShotComplete) {
    task.enabled = false;
    task.status = "已完成";
    task.nextRunAt = null;
  } else {
    task.status = !task.enabled ? "暂停" : status === "ok" ? "完成" : status === "partial" ? "部分完成" : status === "failed" ? "失败" : "等待";
  }
  const intervalMs = parseEveryMs(task.schedule);
  if (String(task.type).toLowerCase() === "every" && intervalMs) task.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  // 空转任务(如未配置 WORM 的外送、无待办的支付核验)不写 jobRun/审计、不触发全库落盘——
  // 此前每分钟 3 个任务空跑也各做一次全库序列化(审计 §7.5)。仅后台触发时生效,手动运行仍完整记录。
  if (opts.skipPersist) return { task, run: null, skipped: "noop_not_persisted" };
  const run = { id: id("run"), taskId: task.id, taskName: task.name, trigger, status, output, createdAt: nowIso() };
  db.jobRuns.unshift(run);
  appendAudit(db, trigger === "manual" ? "立即运行任务" : "后台运行任务", task.id, "调度员", status === "ok" ? "info" : "warning");
  appendTrace(db, "scheduled_task", `${task.name} 运行`, status);
  if (saveDb) {
    const schedulerCollections = ["meta", "tasks", "jobRuns", "jobLocks"];
    const collections = Array.isArray(opts.persistCollections)
      ? [...new Set([...schedulerCollections, ...opts.persistCollections])]
      : ["ok", "partial"].includes(status) ? null : schedulerCollections;
    saveDb(db, collections ? { collections } : undefined);
  }
  return { task, run };
}

function scheduleRetryIfNeeded(db, task, saveDb, failedRun) {
  if (!failedRun || task.enabled === false) return;
  const policy = task.retryPolicy || task.retry_policy || { maxRetries: 2, backoffSeconds: 30 };
  const maxRetries = Math.max(0, Math.min(10, Number(policy.maxRetries ?? policy.max_retries ?? 2) || 0));
  const backoffSeconds = Math.max(1, Math.min(86_400, Number(policy.backoffSeconds ?? policy.backoff_seconds ?? 30) || 30));
  const retryCount = Math.max(0, Number(task.failureCount || 1) - 1);
  failedRun.retryCount = retryCount;
  if (retryCount >= maxRetries) {
    task.status = "失败";
    if (String(task.type).toLowerCase() === "at") {
      task.enabled = false;
      task.nextRunAt = null;
    }
    if (saveDb) saveDb(db, { collections: ["meta", "tasks", "jobRuns", "jobLocks"] });
    return;
  }
  failedRun.status = "retry_scheduled";
  failedRun.nextRetryAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
  failedRun.retryCount = retryCount + 1;
  const timer = setTimeout(async () => {
    runtime.timeoutJobs.delete(`${task.id}:retry:${failedRun.id}`);
    if (task.enabled === false) return;
    const retryResult = await runTask(db, task.id, saveDb, "retry"); // runTask 是 async,此前不 await 导致 retryOf 永远写不上
    if (retryResult?.run) {
      retryResult.run.retryOf = failedRun.id;
      if (saveDb) saveDb(db, { collections: ["meta", "tasks", "jobRuns", "jobLocks"] });
    }
  }, backoffSeconds * 1000);
  runtime.timeoutJobs.set(`${task.id}:retry:${failedRun.id}`, timer);
  if (saveDb) saveDb(db, { collections: ["meta", "tasks", "jobRuns", "jobLocks"] });
}

function recoverFailedRuns(db, saveDb) {
  const pending = (db.jobRuns || []).filter((run) => run.status === "retry_scheduled" && run.nextRetryAt);
  for (const run of pending.slice(0, 20)) {
    const task = db.tasks.find((item) => item.id === run.taskId);
    if (!task || !task.enabled) continue;
    const key = `${task.id}:retry:recovered:${run.id}`;
    const runRecoveredRetry = () => {
      runtime.timeoutJobs.delete(key);
      if (!task.enabled) return;
      const remaining = new Date(run.nextRetryAt).getTime() - Date.now();
      if (remaining > MAX_TIMEOUT_MS) {
        const later = setTimeout(runRecoveredRetry, MAX_TIMEOUT_MS);
        runtime.timeoutJobs.set(key, later);
        return;
      }
      run.status = "retry_recovered";
      runTask(db, task.id, saveDb, "recovered_retry");
    };
    const delayMs = Math.max(250, Math.min(MAX_TIMEOUT_MS, new Date(run.nextRetryAt).getTime() - Date.now()));
    const timer = setTimeout(runRecoveredRetry, delayMs);
    runtime.timeoutJobs.set(key, timer);
  }
}

export function parseEveryMs(schedule = "") {
  const text = String(schedule).trim();
  const minuteMatch = text.match(/^Every\s+(\d+)\s*(m|分钟|min)$/i);
  if (minuteMatch) return Math.max(30_000, Number(minuteMatch[1]) * 60_000);
  const secondMatch = text.match(/^Every\s+(\d+)\s*(s|秒|sec)$/i);
  if (secondMatch) return Math.max(30_000, Number(secondMatch[1]) * 1000);
  const hourMatch = text.match(/^Every\s+(\d+)\s*(h|小时|hour)$/i);
  if (hourMatch) return Number(hourMatch[1]) * 3_600_000;
  const dayMatch = text.match(/^Every\s+(\d+)\s*(d|天|day)$/i);
  if (dayMatch) return Number(dayMatch[1]) * 86_400_000;
  return null;
}

function normalizeCron(schedule = "") {
  const text = String(schedule).trim();
  if (/^(\S+\s+){4}\S+$/.test(text)) return text;
  const daily = text.match(/每天\s*(\d{1,2}):(\d{2})/);
  if (daily) return `${Number(daily[2])} ${Number(daily[1])} * * *`;
  return text;
}

export function validateTaskDefinition(task = {}, { allowSystemHandlers = false, now = Date.now() } = {}) {
  const errors = [];
  const name = String(task.name || "").trim();
  const type = String(task.type || "").trim();
  const handler = String(task.handler || "").trim();
  if (!name || name.length > 80) errors.push("任务名称必须为 1–80 个字符");
  if (task.enabled !== undefined && typeof task.enabled !== "boolean") errors.push("enabled 必须是布尔值");
  if (!["Every", "Cron", "At"].includes(type)) errors.push("任务类型必须是 Every / Cron / At");
  if (!handler) errors.push("任务必须选择可执行处理器");
  else if (!allowSystemHandlers && !USER_TASK_HANDLER_SET.has(handler)) errors.push(`不允许使用任务处理器：${handler}`);
  else if (!allowSystemHandlers && taskHandlerPolicy(handler)?.userSchedulable !== true) errors.push(`任务处理器不允许由用户调度：${handler}`);
  else if (allowSystemHandlers && !taskHandlers.has(handler)) errors.push(`系统任务处理器未注册：${handler}`);
  if (type === "Every") {
    const intervalMs = parseEveryMs(task.schedule);
    if (!intervalMs) errors.push("Every 表达式无效，例如 Every 15m / Every 1h");
    else if (!allowSystemHandlers && intervalMs < 60_000) errors.push("普通任务最短间隔为 1 分钟");
  }
  if (type === "Cron") {
    const expression = normalizeCron(task.schedule);
    if (!cron.validate(expression)) errors.push("Cron 表达式无效");
    else if (!allowSystemHandlers && expression.split(/\s+/).length !== 5) errors.push("普通任务只允许分钟级 5 段 Cron");
  }
  if (type === "At") {
    const at = new Date(task.schedule).getTime();
    if (!Number.isFinite(at)) errors.push("一次性运行时间无效");
    else if (at <= now) errors.push("一次性运行时间必须晚于当前时间");
  }
  if (task.timezone) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: task.timezone }).format(); }
    catch { errors.push("时区无效"); }
  }
  if (handler === "agent_mission") {
    const mission = String(task.mission || "").trim();
    if (!mission || mission.length > 1000) errors.push("情报任务目标必须为 1–1000 个字符");
  }
  return { valid: errors.length === 0, errors };
}
