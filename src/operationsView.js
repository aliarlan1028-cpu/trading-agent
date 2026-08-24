const list = (value) => Array.isArray(value) ? value : [];

const timeValue = (value) => {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const latestFirst = (rows, field = "createdAt") => [...list(rows)].sort((a, b) =>
  timeValue(b?.[field] || b?.finishedAt || b?.updatedAt) - timeValue(a?.[field] || a?.finishedAt || a?.updatedAt)
);

const statusText = (value) => String(value || "").trim().toLowerCase();

export function operationsTone(value, fallback = "neutral") {
  const text = statusText(value);
  if (!text) return fallback;
  if (/critical|failed|failure|error|timeout|reject|broken|mismatch|needs_attention|blocked|异常|失败|断点|不一致/.test(text)) return "critical";
  if (/degraded|partial|pending|retry|paused|stale|warning|warn|unknown|待|暂停|陈旧|降级/.test(text)) return "warning";
  if (/ok|healthy|normal|success|succeeded|done|completed|connected|running|live|实时|正常|成功|完成|已连接|执行中/.test(text)) return "healthy";
  return fallback;
}

function taskRunFor(task, runs) {
  return latestFirst(runs).find((run) => run.taskId === task.id
    || (run.handler && run.handler === (task.handler || task.type))
    || (run.taskName && run.taskName === task.name)) || null;
}

function taskState(task, run) {
  if (task.enabled === false) return { code: "paused", tone: "warning" };
  if (!run) return { code: "awaiting_first_run", tone: "neutral" };
  const tone = operationsTone(run.status);
  if (tone === "critical") return { code: "last_run_failed", tone };
  if (tone === "warning") return { code: "attention", tone };
  if (/running|processing/i.test(String(run.status))) return { code: "running", tone: "healthy" };
  return { code: "healthy", tone: "healthy" };
}

function sourceRows(data) {
  const health = list(data.marketIntelligenceSourceHealth);
  const configured = list(data.eventSources);
  const configuredById = new Map(configured.map((item) => [item.id, item]));
  const rows = health.length ? health.map((item) => ({ ...configuredById.get(item.sourceId || item.id), ...item })) : configured;
  return rows.map((source, index) => {
    const enabled = source.enabled !== false;
    const status = enabled ? (source.health || source.status || source.lastStatus || "unknown") : "disabled";
    return {
      ...source,
      id: source.id || source.sourceId || `source_${index}`,
      name: source.name || source.label || source.sourceId || source.id || "Event source",
      enabled,
      status,
      tone: enabled ? operationsTone(status) : "neutral",
      checkedAt: source.checkedAt || source.lastCheckedAt || source.lastRunAt || source.updatedAt || null,
      lastSuccessAt: source.lastSuccessAt || source.lastFetchedAt || null,
      error: source.error || source.lastError || null
    };
  });
}

function newestMarketAge(data, now) {
  const ages = list(data.markets)
    .map((item) => now - timeValue(item.updatedAt || item.syncedAt || item.microSyncedAt))
    .filter((age) => Number.isFinite(age) && age >= 0 && age < 6e10);
  return ages.length ? Math.min(...ages) : null;
}

function service(id, labelZh, labelEn, tone, value, detail, route) {
  return { id, labelZh, labelEn, tone, value, detail, route };
}

function activityRows(data) {
  const runs = list(data.jobRuns).map((row) => ({
    id: row.id, type: "run", createdAt: row.finishedAt || row.createdAt,
    title: row.taskName || row.name || row.handler || "System task", detail: row.durationMs ? `${row.durationMs} ms` : row.handler,
    status: row.status, tone: operationsTone(row.status)
  }));
  const reconciliations = list(data.reconciliationReports).map((row) => ({
    id: row.id, type: "reconcile", createdAt: row.createdAt, title: "Reconciliation", detail: `${list(row.differences).length} differences`,
    status: row.status, tone: operationsTone(row.status)
  }));
  const audits = list(data.auditLogs).map((row) => ({
    id: row.id, type: "audit", createdAt: row.createdAt, title: row.action || "Audit event", detail: row.actor || row.resource || row.target,
    status: row.status || row.severity || "recorded", tone: operationsTone(row.status || row.severity, "healthy")
  }));
  const notifications = list(data.notifications).map((row) => ({
    id: row.id, type: "notification", createdAt: row.createdAt, title: row.title || "System notice", detail: row.source || row.category,
    status: row.severity || row.level || (row.read ? "read" : "unread"), tone: operationsTone(row.severity || row.level, row.read ? "neutral" : "warning")
  }));
  return latestFirst([...runs, ...reconciliations, ...audits, ...notifications]).slice(0, 20);
}

export function buildOperationsView(data = {}, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const runs = latestFirst(data.jobRuns);
  const tasks = list(data.tasks).map((task) => {
    const latestRun = taskRunFor(task, runs);
    return { ...task, latestRun, runtime: taskState(task, latestRun) };
  });
  const sources = sourceRows(data);
  const reconciliations = latestFirst(data.reconciliationReports);
  const latestReconciliation = reconciliations[0] || null;
  const incidents = latestFirst(list(data.riskIncidents).filter((item) => String(item.status || "open").toLowerCase() === "open"));
  const unknownOrders = list(data.executionOrders).filter((item) => /unknown|recovery_pending|emergency_close_pending|close_reconciliation_pending/i.test(String(item.status)));
  const auditCheck = list(data.readiness?.checks).find((item) => item.key === "audit_chain");
  const wormCheck = list(data.readiness?.checks).find((item) => item.key === "audit_worm");
  const latestSnapshot = latestFirst(data.accountSnapshots)[0] || null;
  const marketAgeMs = newestMarketAge(data, now);
  const failedRuns = runs.filter((row) => operationsTone(row.status) === "critical");
  const retryingRuns = runs.filter((row) => /retry|pending/i.test(String(row.status)));
  const terminalRuns = runs.filter((row) => !/running|processing/i.test(String(row.status)));
  const successfulRuns = terminalRuns.filter((row) => operationsTone(row.status) === "healthy");
  const connectedRealtime = list(data.realtimeConnections).filter((row) => /connected|ok|healthy/i.test(String(row.status))).length;
  const realtimeTotal = list(data.realtimeConnections).length;
  const unhealthySources = sources.filter((row) => row.enabled && ["critical", "warning"].includes(row.tone));
  const enabledSources = sources.filter((row) => row.enabled);

  const apiTone = operationsTone(data.system?.apiHealth, data.system?.apiHealth ? "warning" : "neutral");
  const realtimeTone = data.realtimeStarted === true && (!realtimeTotal || connectedRealtime === realtimeTotal) ? "healthy" : data.realtimeStarted ? "warning" : "critical";
  const marketTone = marketAgeMs == null ? "neutral" : marketAgeMs < 8_000 ? "healthy" : marketAgeMs < 180_000 ? "warning" : "critical";
  const accountTone = latestSnapshot ? operationsTone(latestSnapshot.status, "warning") : "neutral";
  const auditTone = auditCheck?.configured === true ? "healthy" : auditCheck ? "critical" : "neutral";
  const failedTasks = tasks.filter((row) => row.runtime.tone === "critical");
  const taskTone = failedTasks.length ? "critical" : retryingRuns.length || tasks.some((row) => row.enabled === false) ? "warning" : tasks.length ? "healthy" : "neutral";
  const sourceTone = unhealthySources.some((row) => row.tone === "critical") ? "critical" : unhealthySources.length ? "warning" : enabledSources.length ? "healthy" : "neutral";

  const services = [
    service("api", "API 入口", "API gateway", apiTone, data.system?.apiHealth || "unknown", data.system?.latestAction || null, "systemSettings:base"),
    service("realtime", "实时连接", "Realtime link", realtimeTone, realtimeTotal ? `${connectedRealtime}/${realtimeTotal}` : (data.realtimeStarted ? "started" : "stopped"), null, "systemSettings:base:proxy"),
    service("market", "市场数据", "Market data", marketTone, marketAgeMs == null ? "unknown" : `${Math.max(0, Math.round(marketAgeMs / 1000))}s`, data.marketStream?.status || null, "chat:intelligence"),
    service("account", "账户同步", "Account sync", accountTone, latestSnapshot?.status || "unavailable", latestSnapshot?.createdAt || null, "marketAccount"),
    service("scheduler", "任务调度", "Task scheduler", taskTone, `${tasks.filter((row) => row.enabled !== false).length}/${tasks.length}`, failedRuns[0]?.status || null, "eventsTasks:tasks"),
    service("audit", "审计完整性", "Audit integrity", auditTone, auditCheck?.configured === true ? "verified" : auditCheck ? "broken" : "unknown", null, "auditSystem"),
    service("inputs", "事件输入", "Event inputs", sourceTone, `${enabledSources.length}/${sources.length}`, unhealthySources[0]?.error || null, "systemSettings:event-sources")
  ];

  const attention = [];
  if (latestReconciliation && operationsTone(latestReconciliation.status) !== "healthy") attention.push({
    id: latestReconciliation.id || "reconciliation", kind: "reconciliation", tone: operationsTone(latestReconciliation.status),
    titleZh: "最新对账需要处理", titleEn: "Latest reconciliation needs attention",
    detail: `${list(latestReconciliation.differences).length} differences`, route: "operationsCenter:recovery", createdAt: latestReconciliation.createdAt
  });
  if (unknownOrders.length) attention.push({
    id: "execution_recovery", kind: "execution", tone: "critical",
    titleZh: `${unknownOrders.length} 笔执行等待恢复`, titleEn: `${unknownOrders.length} executions await recovery`,
    detail: unknownOrders[0]?.status || null, route: "tradeJournal", createdAt: unknownOrders[0]?.updatedAt || unknownOrders[0]?.createdAt
  });
  for (const incident of incidents.slice(0, 8)) attention.push({
    id: incident.id, kind: "incident", tone: operationsTone(incident.severity, "warning"),
    titleZh: incident.title || "风险事件", titleEn: incident.titleEn || incident.title || "Risk incident",
    detail: incident.source || incident.kind || null, route: "riskCenter", createdAt: incident.createdAt, source: incident
  });
  for (const run of failedRuns.slice(0, 4)) attention.push({
    id: run.id, kind: "run", tone: "critical", titleZh: run.taskName || run.name || run.handler || "任务运行失败",
    titleEn: run.taskNameEn || run.taskName || run.name || run.handler || "Task run failed", detail: run.error || run.status,
    route: "eventsTasks:tasks", createdAt: run.finishedAt || run.createdAt
  });
  for (const source of unhealthySources.slice(0, 4)) attention.push({
    id: source.id, kind: "source", tone: source.tone, titleZh: `${source.name} 输入异常`, titleEn: `${source.name} input issue`,
    detail: source.error || source.status, route: "systemSettings:event-sources", createdAt: source.checkedAt
  });
  attention.sort((a, b) => (a.tone === "critical" ? -1 : 0) - (b.tone === "critical" ? -1 : 0) || timeValue(b.createdAt) - timeValue(a.createdAt));

  const criticalServices = services.filter((row) => row.tone === "critical").length;
  const warningServices = services.filter((row) => row.tone === "warning").length;
  const unknownServices = services.filter((row) => row.tone === "neutral").length;
  const overallTone = criticalServices || attention.some((row) => row.tone === "critical") ? "critical" : warningServices || unknownServices || attention.length ? "warning" : "healthy";
  const notifications = list(data.notifications).map((row) => ({
    ...row,
    tone: operationsTone(row.severity || row.level, row.read ? "neutral" : "warning")
  }));

  return {
    overall: {
      tone: overallTone,
      criticalServices,
      warningServices,
      unknownServices,
      openAttention: attention.length,
      label: overallTone === "critical" ? "action_required" : overallTone === "warning" ? "degraded" : "healthy"
    },
    services,
    tasks: {
      items: tasks,
      total: tasks.length,
      active: tasks.filter((row) => row.enabled !== false).length,
      failedRuns: failedRuns.length,
      runningRuns: runs.filter((row) => /running|processing/i.test(String(row.status))).length,
      retryingRuns: retryingRuns.length,
      successPct: terminalRuns.length ? (successfulRuns.length / terminalRuns.length) * 100 : null,
      recentRuns: runs
    },
    inputs: {
      items: sources,
      total: sources.length,
      enabled: enabledSources.length,
      unhealthy: unhealthySources.length
    },
    attention,
    activity: activityRows(data),
    recovery: {
      latestReconciliation,
      reports: reconciliations,
      differences: list(latestReconciliation?.differences),
      healthy: Boolean(latestReconciliation) && operationsTone(latestReconciliation.status) === "healthy",
      openIncidents: incidents,
      unknownOrders,
      needsSchedulerRecovery: failedTasks.length > 0 || retryingRuns.length > 0
    },
    audit: {
      chain: auditCheck?.configured === true ? "verified" : auditCheck ? "broken" : "unknown",
      worm: wormCheck?.configured === true ? "configured" : wormCheck ? "missing" : "unknown",
      records: latestFirst(data.auditLogs)
    },
    notifications: {
      items: latestFirst(notifications),
      total: notifications.length,
      unread: notifications.filter((row) => !row.read).length,
      critical: notifications.filter((row) => operationsTone(row.severity || row.level) === "critical").length,
      read: notifications.filter((row) => row.read).length,
      muted: notifications.filter((row) => row.muted).length
    }
  };
}
