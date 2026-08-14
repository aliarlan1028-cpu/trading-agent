import crypto from "node:crypto";

const MAX_SUMMARY = 500;
const BLOCKED_STATUSES = new Set([
  "blocked", "risk_rejected", "rejected", "invalid", "invalid_exchange",
  "missing_account", "missing_credentials", "incomplete", "unavailable",
  "insufficient_sample", "auto_blocked"
]);

const SOURCE_BUCKETS = Object.freeze(["model", "preflight", "system", "evaluation", "historical"]);

export function toolExecutionSourceBucket(source = "agent") {
  const value = String(source || "agent").toLowerCase();
  if (/preflight/.test(value)) return "preflight";
  if (/evaluation|eval|health_check/.test(value)) return "evaluation";
  if (/historical|backfill|legacy/.test(value)) return "historical";
  if (/system|scheduler|post_trade|direct_api|ui_action/.test(value)) return "system";
  return "model";
}

function iso(value, fallback = null) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : fallback;
}

export function classifyToolOutcome(result = {}, summary = "") {
  const status = String(result?.status || "").toLowerCase();
  const text = String(summary || "");
  if (Array.isArray(result?.violations) && result.violations.length) return "blocked";
  if (result?.error || /^失败[:：]/.test(text) || status === "error" || status === "failed") return "error";
  if (BLOCKED_STATUSES.has(status) || result?.available === false || /^(?:阻断|拒绝)[:：]/.test(text)) return "blocked";
  return "success";
}

function ensureStat(db, name, observedAt) {
  db.toolCallStats ||= {};
  const stat = db.toolCallStats[name] ||= {
    calls: 0,
    success: 0,
    blocked: 0,
    error: 0,
    totalLatencyMs: 0,
    latencySamples: 0,
    lastLatencyMs: null,
    lastStatus: null,
    sourceCalls: Object.fromEntries(SOURCE_BUCKETS.map((source) => [source, 0])),
    firstAt: observedAt || null,
    lastAt: null
  };
  for (const key of ["calls", "success", "blocked", "error", "totalLatencyMs", "latencySamples"]) {
    stat[key] = Number(stat[key] || 0);
  }
  if (!stat.sourceCalls) {
    stat.legacyUnsplitCalls = Number(stat.legacyUnsplitCalls || stat.calls || 0);
    stat.sourceCalls = {};
  }
  for (const source of SOURCE_BUCKETS) stat.sourceCalls[source] = Number(stat.sourceCalls[source] || 0);
  stat.firstAt ||= observedAt || null;
  return stat;
}

function addToStat(db, { name, status, latencyMs, observedAt, source = "agent" }) {
  const stat = ensureStat(db, name, observedAt);
  stat.calls += 1;
  stat[status] = Number(stat[status] || 0) + 1;
  const bucket = toolExecutionSourceBucket(source);
  stat.sourceCalls[bucket] = Number(stat.sourceCalls[bucket] || 0) + 1;
  if (Number.isFinite(Number(latencyMs))) {
    const latency = Math.max(0, Number(latencyMs));
    stat.totalLatencyMs += latency;
    stat.latencySamples += 1;
    stat.lastLatencyMs = latency;
  }
  stat.lastStatus = status;
  stat.lastAt = observedAt;
  return stat;
}

export function recordToolExecution(db, {
  runId = null,
  sessionId = null,
  name,
  args = {},
  result = {},
  summary = "",
  latencyMs = null,
  startedAt = null,
  finishedAt = null,
  source = "agent"
} = {}) {
  if (!name) return null;
  const completedAt = iso(finishedAt, new Date().toISOString());
  const beganAt = iso(startedAt, completedAt);
  const status = classifyToolOutcome(result, summary);
  const record = {
    id: `toolx_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
    toolName: String(name),
    agentRunId: runId,
    sessionId,
    source,
    status,
    args,
    summary: String(summary || "").slice(0, MAX_SUMMARY),
    latencyMs: Number.isFinite(Number(latencyMs)) ? Math.max(0, Number(latencyMs)) : null,
    startedAt: beganAt,
    finishedAt: completedAt,
    createdAt: completedAt
  };
  db.toolExecutions ||= [];
  db.toolExecutions.unshift(record);
  addToStat(db, { name: record.toolName, status, latencyMs: record.latencyMs, observedAt: completedAt, source });
  db.meta ||= {};
  db.meta.toolUsageStatsSince ||= beganAt;
  return record;
}

function statusFromHistoricalTrace(trace = {}) {
  const summary = String(trace.summary || "");
  if (/^失败[:：]/.test(summary)) return "error";
  if (/^(?:阻断|拒绝)[:：]/.test(summary)) return "blocked";
  return "success";
}

function historicalExecutionId(messageId, index, trace) {
  const digest = crypto.createHash("sha256")
    .update(`${messageId}:${index}:${trace?.name || "unknown"}:${trace?.summary || ""}`)
    .digest("hex").slice(0, 20);
  return `toolx_hist_${digest}`;
}

// 一次性迁移：从仍在保留窗口内的聊天工具轨迹回填“可追溯累计”。
// 不把 agentRuns 再累加一遍，因为同一次调用通常也保存在 chatMessages，避免双计。
export function backfillToolUsage(db, { now = new Date().toISOString(), maxExecutions = 500 } = {}) {
  db.meta ||= {};
  db.toolCallStats ||= {};
  db.toolExecutions ||= [];
  if (db.meta.toolUsageBackfilledAt) return { applied: false, calls: 0, since: db.meta.toolUsageStatsSince || null };

  const messages = (db.chatMessages || []).slice().sort((a, b) =>
    new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  );
  const existingIds = new Set(db.toolExecutions.map((row) => row.id));
  let calls = 0;
  let since = null;
  const historicalRecords = [];
  for (const message of messages) {
    const observedAt = iso(message.createdAt, now);
    for (const [index, trace] of (message.toolTrace || []).entries()) {
      const name = String(trace?.name || "").trim();
      if (!name) continue;
      const status = statusFromHistoricalTrace(trace);
      addToStat(db, { name, status, latencyMs: trace.latencyMs, observedAt, source: "historical_chat_trace" });
      calls += 1;
      since = !since || observedAt < since ? observedAt : since;
      const recordId = historicalExecutionId(message.id || observedAt, index, trace);
      if (!existingIds.has(recordId)) {
        historicalRecords.push({
          id: recordId,
          toolName: name,
          agentRunId: message.runId || null,
          sessionId: message.sessionId || null,
          source: "historical_chat_trace",
          status,
          args: trace.args || {},
          summary: String(trace.summary || "").slice(0, MAX_SUMMARY),
          latencyMs: Number.isFinite(Number(trace.latencyMs)) ? Math.max(0, Number(trace.latencyMs)) : null,
          startedAt: observedAt,
          finishedAt: observedAt,
          createdAt: observedAt
        });
        existingIds.add(recordId);
      }
    }
  }

  // 原生 Skill 有独立的长期 evalMetrics；若其可追溯次数高于聊天窗口统计，采用较大的真实值，绝不相加。
  for (const skill of db.skills || []) {
    const name = skill.toolName;
    const evaluatedCalls = Number(skill.evalMetrics?.calls || 0);
    if (!name || evaluatedCalls <= 0) continue;
    const stat = ensureStat(db, name, iso(skill.lastCalledAt, now));
    stat.sourceCalls.evaluation = Math.max(Number(stat.sourceCalls.evaluation || 0), evaluatedCalls);
    if (evaluatedCalls > stat.calls) {
      const delta = evaluatedCalls - stat.calls;
      stat.calls = evaluatedCalls;
      stat.success = Number(skill.evalMetrics?.passed || 0);
      stat.blocked = Number(skill.evalMetrics?.blocked || 0);
      stat.error = Number(skill.evalMetrics?.failed || 0);
      const classified = stat.success + stat.blocked + stat.error;
      if (classified < stat.calls) stat.success += stat.calls - classified;
      stat.lastAt = iso(skill.lastCalledAt, stat.lastAt || now);
      calls += delta;
    }
  }

  db.toolExecutions = [...historicalRecords.reverse(), ...db.toolExecutions]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, Math.max(1, maxExecutions));
  db.meta.toolUsageStatsSince = since || db.meta.toolUsageStatsSince || now;
  db.meta.toolUsageBackfilledAt = now;
  db.meta.toolUsageBackfillSource = "retained_chat_tool_traces+skill_eval_metrics";
  return { applied: true, calls, since: db.meta.toolUsageStatsSince };
}

export function toolUsageView(stat = null) {
  if (!stat) return { calls: 0, success: 0, blocked: 0, error: 0, successRatePct: null, avgLatencyMs: null, lastAt: null, health: "untested", legacyUnsplit: false, legacyUnsplitCalls: 0, sourceCalls: Object.fromEntries(SOURCE_BUCKETS.map((source) => [source, 0])) };
  const calls = Number(stat.calls || 0);
  const success = Number(stat.success || 0);
  const error = Number(stat.error || 0);
  const blocked = Number(stat.blocked || 0);
  const sourceCalls = Object.fromEntries(SOURCE_BUCKETS.map((source) => [source, Number(stat.sourceCalls?.[source] || 0)]));
  const health = !calls ? "untested"
    : stat.lastStatus === "error" || error / calls >= 0.2 ? "degraded"
      : stat.lastStatus === "blocked" && !success ? "blocked"
        : "healthy";
  return {
    calls,
    success,
    blocked,
    error,
    successRatePct: calls ? Number((success / calls * 100).toFixed(1)) : null,
    avgLatencyMs: Number(stat.latencySamples || 0) > 0 && Number.isFinite(Number(stat.totalLatencyMs))
      ? Math.round(Number(stat.totalLatencyMs) / Number(stat.latencySamples))
      : null,
    lastStatus: stat.lastStatus || null,
    firstAt: stat.firstAt || null,
    lastAt: stat.lastAt || null,
    health,
    legacyUnsplit: Number(stat.legacyUnsplitCalls || 0) > 0,
    legacyUnsplitCalls: Number(stat.legacyUnsplitCalls || 0),
    sourceCalls
  };
}

export function buildToolCallSummary(toolTrace = [], coverage = null) {
  const traces = Array.isArray(toolTrace) ? toolTrace : [];
  const count = (origin) => traces.filter((item) => item.origin === origin).length;
  const preflightCalls = count("system_preflight");
  const fallbackCalls = count("local_fallback");
  const modelCalls = traces.filter((item) => !["system_preflight", "local_fallback"].includes(item.origin)).length;
  return {
    totalCalls: traces.length,
    modelCalls,
    preflightCalls,
    fallbackCalls,
    required: Number(coverage?.required || 0),
    covered: Number(coverage?.covered || 0),
    complete: coverage ? coverage.ok === true : null
  };
}

export function appendToolCallDisclosure(content = "", summary = null, language = "zh") {
  const text = String(content || "").trim();
  if (!summary || Number(summary.preflightCalls || 0) <= 0) return text;
  const claimsOnlyOnePath = /(?:本次|本轮)?(?:仅|只)(?:调用|使用)(?:了)?[^。.!！\n]{0,100}(?:工具|能力|[a-z][a-z0-9_]+)/i.test(text)
    || /(?:only|just)\s+(?:called|used|invoked)[^.!\n]{0,100}(?:tool|capabilit|[a-z][a-z0-9_]+)/i.test(text);
  if (!claimsOnlyOnePath || /系统调用记录[:：]/.test(text)) return text;
  const disclosure = language === "en"
    ? `System call record: ${summary.modelCalls} model-selected, ${summary.preflightCalls} deterministic preflight, ${summary.totalCalls} total.`
    : `系统调用记录：模型主动调用 ${summary.modelCalls} 项，确定性预检 ${summary.preflightCalls} 项，合计 ${summary.totalCalls} 项。`;
  return `${text}\n\n${disclosure}`;
}
