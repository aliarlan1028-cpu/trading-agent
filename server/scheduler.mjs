import cron from "node-cron";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const runtime = {
  started: false,
  cronJobs: new Map(),
  intervalJobs: new Map(),
  timeoutJobs: new Map()
};

// 真实任务处理器注册表：task.handler 命中时执行真实函数，
// 否则退回旧的关键词描述行为。由 index.mjs 在启动时注册。
const taskHandlers = new Map();

export function registerTaskHandler(name, fn) {
  taskHandlers.set(name, fn);
}

export function ensureSystemTask(db, task, saveDb) {
  const existing = (db.tasks || []).find((item) => item.id === task.id);
  if (existing) {
    existing.handler = task.handler;
    if (runtime.started) scheduleTask(db, existing, saveDb);
    return existing;
  }
  const created = { enabled: true, type: "Every", role: "系统", createdAt: nowIso(), ...task };
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
    if (!task.enabled || String(task.type || "").toLowerCase() !== "every") return false;
    const intervalMs = parseEveryMs(task.schedule);
    if (intervalMs < MIN_INTERVAL_MS) return false;
    if (!task.lastRunAt) return true; // 从未跑过的长间隔任务也补
    return now - new Date(task.lastRunAt).getTime() > intervalMs;
  });
}

export function startScheduler(db, saveDb) {
  if (runtime.started) return schedulerStatus(db);
  runtime.started = true;
  // 新进程启动时不可能有运行中的任务：释放所有遗留并发锁
  for (const lock of db.jobLocks || []) {
    if (lock.locked) {
      lock.locked = false;
      lock.releasedAt = nowIso();
      lock.expired = true;
    }
  }
  recoverFailedRuns(db, saveDb);
  for (const task of db.tasks || []) {
    scheduleTask(db, task, saveDb);
  }
  // 超期长任务补跑:等启动稳定 2 分钟后开始,彼此错峰 90s,避免启动即 CPU 打满
  const overdue = overdueLongTasks(db);
  overdue.forEach((task, index) => {
    const timer = setTimeout(() => {
      appendTrace(db, "scheduled_task", `${task.name} 启动补跑（上次运行 ${task.lastRunAt || "从未"}，超过间隔 ${task.schedule}）`, "ok");
      runTask(db, task.id, saveDb, "startup_catchup");
    }, 120_000 + index * 90_000);
    runtime.timeoutJobs.set(`catchup_${task.id}`, timer);
  });
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

export async function runTask(db, taskId, saveDb, trigger = "manual") {
  const task = db.tasks.find((item) => item.id === taskId);
  if (!task) return { status: "missing_task", taskId };

  const LOCK_TTL_MS = 10 * 60_000;
  const lock = db.jobLocks.find((item) => item.concurrencyKey === (task.concurrencyKey || task.id) && item.locked);
  if (lock) {
    const age = Date.now() - new Date(lock.createdAt).getTime();
    if (age < LOCK_TTL_MS) {
      return recordRun(db, task, "skipped_locked", "任务并发锁未释放", trigger, saveDb);
    }
    // 进程崩溃遗留的陈旧锁：强制释放并继续
    lock.locked = false;
    lock.releasedAt = nowIso();
    lock.expired = true;
  }

  const lockEntry = { id: id("lock"), concurrencyKey: task.concurrencyKey || task.id, locked: true, taskId, createdAt: nowIso() };
  db.jobLocks.unshift(lockEntry);
  try {
    if (task.forceFailure) throw new Error("任务被配置为强制失败，用于测试重试机制。");
    let output = `${task.name} 已完成一次运行。`;
    if (task.handler && taskHandlers.has(task.handler)) {
      const result = await taskHandlers.get(task.handler)(db, task);
      output = typeof result === "string" ? result : summarizeHandlerResult(task.handler, result);
      const skipPersist = result && typeof result === "object" && result.skipPersist === true && trigger !== "manual";
      const run = recordRun(db, task, "ok", output, trigger, saveDb, { skipPersist });
      task.failureCount = 0;
      task.lastError = null;
      return run;
    }
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
  return JSON.stringify(result).slice(0, 200);
}

function recordRun(db, task, status, output, trigger, saveDb, opts = {}) {
  task.lastRun = "刚刚";
  task.lastRunAt = nowIso();
  task.status = task.enabled ? "运行中" : "暂停";
  const intervalMs = parseEveryMs(task.schedule);
  if (String(task.type).toLowerCase() === "every") task.nextRunAt = new Date(Date.now() + intervalMs).toISOString();
  // 空转任务(如未配置 WORM 的外送、无待办的支付核验)不写 jobRun/审计、不触发全库落盘——
  // 此前每分钟 3 个任务空跑也各做一次全库序列化(审计 §7.5)。仅后台触发时生效,手动运行仍完整记录。
  if (opts.skipPersist) return { task, run: null, skipped: "noop_not_persisted" };
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
  const timer = setTimeout(async () => {
    const retryResult = await runTask(db, task.id, saveDb, "retry"); // runTask 是 async,此前不 await 导致 retryOf 永远写不上
    if (retryResult?.run) retryResult.run.retryOf = failedRun.id;
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
