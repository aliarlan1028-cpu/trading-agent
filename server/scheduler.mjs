import cron from "node-cron";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const runtime = {
  started: false,
  cronJobs: new Map(),
  intervalJobs: new Map(),
  timeoutJobs: new Map()
};

export function startScheduler(db, saveDb) {
  if (runtime.started) return schedulerStatus(db);
  runtime.started = true;
  recoverFailedRuns(db, saveDb);
  for (const task of db.tasks || []) {
    scheduleTask(db, task, saveDb);
  }
  return schedulerStatus(db);
}

export function scheduleTask(db, task, saveDb) {
  clearScheduledTask(task.id);
  if (!task.enabled) return;
  const type = String(task.type || "").toLowerCase();
  if (type === "every") {
    const intervalMs = parseEveryMs(task.schedule);
    const timer = setInterval(() => {
      runTask(db, task.id, saveDb, "scheduler");
    }, intervalMs);
    runtime.intervalJobs.set(task.id, timer);
    task.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
    return;
  }
  if (type === "at") {
    const delayMs = Math.max(0, new Date(task.schedule).getTime() - Date.now());
    const timer = setTimeout(() => runTask(db, task.id, saveDb, "scheduler"), delayMs);
    runtime.timeoutJobs.set(task.id, timer);
    task.nextRunAt = new Date(Date.now() + delayMs).toISOString();
    return;
  }
  if (type === "cron") {
    const expression = normalizeCron(task.schedule);
    if (cron.validate(expression)) {
      const job = cron.schedule(expression, () => runTask(db, task.id, saveDb, "scheduler"));
      runtime.cronJobs.set(task.id, job);
      task.normalizedCron = expression;
    } else {
      task.status = "调度表达式无效";
    }
  }
}

export function stopScheduler() {
  for (const job of runtime.cronJobs.values()) job.stop();
  for (const timer of runtime.intervalJobs.values()) clearInterval(timer);
  for (const timer of runtime.timeoutJobs.values()) clearTimeout(timer);
  runtime.cronJobs.clear();
  runtime.intervalJobs.clear();
  runtime.timeoutJobs.clear();
  runtime.started = false;
}

function clearScheduledTask(taskId) {
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

export function runTask(db, taskId, saveDb, trigger = "manual") {
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return { status: "missing_task", taskId };

  const lock = db.jobLocks.find((item) => item.concurrencyKey === (task.concurrencyKey || task.id) && item.locked);
  if (lock) {
    return recordRun(db, task, "skipped_locked", "任务并发锁未释放", trigger, saveDb);
  }

  const lockEntry = { id: id("lock"), concurrencyKey: task.concurrencyKey || task.id, locked: true, taskId, createdAt: nowIso() };
  db.jobLocks.unshift(lockEntry);
  try {
    if (task.forceFailure) throw new Error("任务被配置为强制失败，用于测试重试机制。");
    let output = `${task.name} 已完成一次运行。`;
    if (task.id.includes("market") || task.name.includes("行情")) {
      const syncedMarkets = (db.markets || []).filter((market) => market.status === "synced" || market.price);
      output = syncedMarkets.length
        ? `已检查 ${syncedMarkets.map((market) => market.symbol).join("、")} 的已同步公开行情。`
        : "未同步真实行情；请先刷新公开行情或配置交易所 API。";
    }
    if (task.id.includes("reconcile") || task.name.includes("仓位")) {
      output = (db.exchangeAccounts || []).some((account) => account.readEnabled)
        ? "已完成持仓、挂单、止损和风控状态心跳检查。"
        : "未配置交易所 API，跳过私有账户对账。";
    }
    if (task.id.includes("event") || task.name.includes("事件")) {
      const event = db.events[0];
      if (event) {
        event.progress ||= [];
        event.progress.unshift(`自动刷新：${new Date().toLocaleString("zh-CN")}`);
        event.latestUpdateAt = nowIso();
      }
      output = event ? "已刷新重要事件进度并更新事件卡。" : "暂无真实事件卡；可先刷新事件源。";
    }
    if (task.id.includes("daily") || task.name.includes("复盘")) {
      db.reviews.unshift({ id: id("review"), title: "自动日终复盘", summary: "当前没有真实交易记录；复盘仅汇总系统状态、任务日志与风控配置。", tags: ["自动复盘"], createdAt: nowIso() });
      output = "已生成无交易日终复盘草案。";
    }
    if (task.name.includes("知识")) {
      output = "已检查知识来源版本、过期状态和待审批规则。";
    }
    const run = recordRun(db, task, "ok", output, trigger, saveDb);
    task.failureCount = 0;
    task.lastError = null;
    return run;
  } catch (error) {
    task.failureCount = Number(task.failureCount || 0) + 1;
    task.lastError = error.message;
    const run = recordRun(db, task, "failed", error.message, trigger, saveDb);
    scheduleRetryIfNeeded(db, task, saveDb, run.run);
    return run;
  } finally {
    lockEntry.locked = false;
    lockEntry.releasedAt = nowIso();
  }
}

function recordRun(db, task, status, output, trigger, saveDb) {
  task.lastRun = "刚刚";
  task.lastRunAt = nowIso();
  task.status = task.enabled ? "运行中" : "暂停";
  const intervalMs = parseEveryMs(task.schedule);
  if (String(task.type).toLowerCase() === "every") task.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  const run = { id: id("run"), taskId: task.id, taskName: task.name, trigger, status, output, createdAt: nowIso() };
  db.jobRuns.unshift(run);
  appendAudit(db, trigger === "manual" ? "立即运行任务" : "后台运行任务", task.id, "调度员", status === "ok" ? "info" : "warning");
  appendTrace(db, "scheduled_task", `${task.name} 运行`, status);
  if (saveDb) saveDb(db);
  return { task, run };
}

function scheduleRetryIfNeeded(db, task, saveDb, failedRun) {
  const policy = task.retryPolicy || task.retry_policy || { maxRetries: 2, backoffSeconds: 30 };
  const maxRetries = Number(policy.maxRetries ?? policy.max_retries ?? 2);
  const backoffSeconds = Number(policy.backoffSeconds ?? policy.backoff_seconds ?? 30);
  const retryCount = Number(failedRun.retryCount || 0);
  if (retryCount >= maxRetries) {
    task.status = "失败";
    return;
  }
  failedRun.status = "retry_scheduled";
  failedRun.nextRetryAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();
  failedRun.retryCount = retryCount + 1;
  const timer = setTimeout(() => {
    const retryResult = runTask(db, task.id, saveDb, "retry");
    if (retryResult.run) retryResult.run.retryOf = failedRun.id;
  }, backoffSeconds * 1000);
  runtime.timeoutJobs.set(`${task.id}:retry:${failedRun.id}`, timer);
}

function recoverFailedRuns(db, saveDb) {
  const pending = (db.jobRuns || []).filter((run) => run.status === "retry_scheduled" && run.nextRetryAt && new Date(run.nextRetryAt).getTime() <= Date.now());
  for (const run of pending.slice(0, 20)) {
    const task = db.tasks.find((item) => item.id === run.taskId);
    if (!task || !task.enabled) continue;
    run.status = "retry_recovered";
    setTimeout(() => runTask(db, task.id, saveDb, "recovered_retry"), 250);
  }
}

function parseEveryMs(schedule = "") {
  const text = String(schedule);
  const minuteMatch = text.match(/(\d+)\s*(m|分钟|min)/i);
  if (minuteMatch) return Math.max(30_000, Number(minuteMatch[1]) * 60_000);
  const secondMatch = text.match(/(\d+)\s*(s|秒|sec)/i);
  if (secondMatch) return Math.max(30_000, Number(secondMatch[1]) * 1000);
  const hourMatch = text.match(/(\d+)\s*(h|小时|hour)/i);
  if (hourMatch) return Number(hourMatch[1]) * 3_600_000;
  return 300_000;
}

function normalizeCron(schedule = "") {
  const text = String(schedule).trim();
  if (/^(\S+\s+){4}\S+$/.test(text)) return text;
  const daily = text.match(/每天\s*(\d{1,2}):(\d{2})/);
  if (daily) return `${Number(daily[2])} ${Number(daily[1])} * * *`;
  return text;
}
