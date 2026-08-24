const FAILED_TRACE = /^(?:失败|阻断|拒绝)[:：]|不可用|未完成|\berror\b|\bfailed\b|\bblocked\b/i;

const OPERATION_TOOLS = new Set([
  "propose_trade_plan",
  "register_watch",
  "cancel_watch",
  "record_watch_review"
]);

const compactList = (values = []) => [...new Set((values || []).filter(Boolean).map(String))];

function metric(value, total, extra = {}) {
  const normalizedValue = Number(value || 0);
  const normalizedTotal = Number(total || 0);
  return {
    value: normalizedValue,
    total: normalizedTotal,
    complete: normalizedTotal === 0 || normalizedValue >= normalizedTotal,
    ...extra
  };
}

export function traceSucceeded(trace = {}) {
  return !FAILED_TRACE.test(String(trace.summary || ""));
}

export function buildPatrolView(message = {}) {
  const coverage = message.capabilityCoverage;
  if (message.sessionId !== "chat_autocycle" || !coverage) return null;

  const traces = Array.isArray(message.toolTrace) ? message.toolTrace : [];
  const callSummary = message.toolCallSummary || {};
  const whitelist = coverage.whitelist || {};
  const watches = coverage.watches || {};
  const scan = coverage.marketScan || {};
  const candidates = Array.isArray(coverage.externalCandidates) ? coverage.externalCandidates : [];
  const operations = traces
    .filter((trace) => OPERATION_TOOLS.has(trace.name))
    .map((trace) => ({
      name: trace.name,
      summary: String(trace.summary || "").trim() || null,
      symbol: trace.args?.symbol || null,
      origin: trace.origin || null,
      latencyMs: Number.isFinite(Number(trace.latencyMs)) ? Number(trace.latencyMs) : null,
      succeeded: traceSucceeded(trace)
    }));
  const failures = traces.filter((trace) => !traceSucceeded(trace));
  const required = metric(coverage.covered, coverage.required, {
    missing: Array.isArray(coverage.missing) ? coverage.missing : []
  });
  const marketComplete = scan.completed === true;
  const attention = coverage.ok !== true || !required.complete || failures.length > 0 || !marketComplete;

  return {
    kind: "autonomous_patrol",
    status: attention ? "attention" : "complete",
    checkedAt: coverage.checkedAt || message.createdAt || null,
    headline: message.presentation?.headline || null,
    scope: {
      evidence: required,
      whitelist: metric(whitelist.analyzed, whitelist.expected, { symbols: compactList(whitelist.symbols) }),
      watches: metric(watches.analyzed, watches.expected, { symbols: compactList(watches.symbols) }),
      market: {
        completed: marketComplete,
        universe: Number(scan.universe || 0),
        candidates: Number(scan.candidates || 0),
        error: scan.error || null
      },
      externalCandidates: candidates.map((candidate) => ({
        symbol: candidate.symbol || null,
        side: candidate.side || null,
        score: candidate.score ?? null,
        analyzed: candidate.analyzed === true
      }))
    },
    calls: {
      total: Number(callSummary.totalCalls ?? traces.length),
      model: Number(callSummary.modelCalls ?? traces.filter((trace) => trace.origin !== "system_preflight").length),
      preflight: Number(callSummary.preflightCalls ?? traces.filter((trace) => trace.origin === "system_preflight").length)
    },
    operations,
    failures: failures.map((trace) => ({ name: trace.name, summary: trace.summary || null })),
    nextAction: message.presentation?.nextAction || null,
    linked: Object.fromEntries(Object.entries(message.presentation?.linked || {}).filter(([, value]) => Boolean(value))),
    traces: traces.map((trace) => ({
      name: trace.name,
      summary: trace.summary || null,
      origin: trace.origin || null,
      latencyMs: Number.isFinite(Number(trace.latencyMs)) ? Number(trace.latencyMs) : null,
      succeeded: traceSucceeded(trace)
    }))
  };
}
