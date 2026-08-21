import { activeMandate, effectiveAuditOperationalStatus, latestSuccessfulAccountSnapshot, nowIso } from "./store.mjs";
import { buildPortfolioRisk } from "./portfolioRisk.mjs";
import { assessOperationalDegradation } from "./professionalRiskGate.mjs";
import { buildSlippageCalibration } from "./executionCostModel.mjs";
import { groupSystemClosedTradeLifecycles, systemTradeFills } from "./systemTradeProjection.mjs";

const ageMs = (value) => value ? Math.max(0, Date.now() - new Date(value).getTime()) : null;
const pct = (n, d = 2) => Number.isFinite(Number(n)) ? Number(Number(n).toFixed(d)) : null;
const quantile = (values, q) => {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  return rows[Math.min(rows.length - 1, Math.floor((rows.length - 1) * q))];
};

export function buildSloReport(db) {
  const marketAges = (db.markets || []).map((m) => ageMs(m.updatedAt || m.syncedAt)).filter(Number.isFinite);
  const ackLatencies = (db.executionOrders || []).map((o) => {
    const start = new Date(o.submittedAt || o.createdAt).getTime();
    const end = new Date(o.acknowledgedAt || o.entrySubmittedAt || 0).getTime();
    return start > 0 && end >= start ? end - start : null;
  }).filter(Number.isFinite);
  const protectedOrders = (db.executionOrders || []).filter((o) => ["entry_filled", "protecting", "protected", "closed"].includes(o.status));
  const covered = protectedOrders.filter((o) => o.protection === "confirmed" || o.protection === "stop_only" || o.stopOrderId || o.stopClientOrderId).length;
  const reconcileAge = ageMs(db.reconciliationReports?.[0]?.createdAt);
  const objectives = {
    marketFreshnessMs: Number(process.env.SLO_MARKET_FRESHNESS_MS || 15000),
    orderAckP95Ms: Number(process.env.SLO_ORDER_ACK_P95_MS || 3000),
    protectionCoveragePct: Number(process.env.SLO_PROTECTION_COVERAGE_PCT || 100),
    reconciliationFreshnessMs: Number(process.env.SLO_RECONCILIATION_FRESHNESS_MS || 300000)
  };
  const metrics = {
    marketFreshnessMs: marketAges.length ? Math.max(...marketAges) : null,
    orderAckP95Ms: quantile(ackLatencies, 0.95),
    protectionCoveragePct: protectedOrders.length ? pct(covered / protectedOrders.length * 100, 1) : null,
    reconciliationFreshnessMs: reconcileAge
  };
  const checks = Object.entries(objectives).map(([key, target]) => ({
    key, target, value: metrics[key],
    status: metrics[key] === null ? "unknown" : key === "protectionCoveragePct" ? (metrics[key] >= target ? "met" : "breached") : (metrics[key] <= target ? "met" : "breached")
  }));
  return { generatedAt: nowIso(), objectives, metrics, checks, status: checks.some((c) => c.status === "breached") ? "breached" : checks.some((c) => c.status === "unknown") ? "unknown" : "met" };
}

export function buildTradingPermissionEvidence(db, options = {}) {
  const mandate = activeMandate(db);
  const snapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX" });
  const latestMarket = (db.markets || []).filter((m) => m.price).sort((a, b) => new Date(b.updatedAt || b.syncedAt || 0) - new Date(a.updatedAt || a.syncedAt || 0))[0];
  const latestReconcile = db.reconciliationReports?.[0];
  const auditStatus = effectiveAuditOperationalStatus(db, options.auditStatus);
  const auditHealthy = auditStatus.operationalReady === true;
  const degradation = assessOperationalDegradation(db, { auditStatus });
  const auditEvidence = auditStatus.mode === "incident_adjudicated_local_continuity"
    ? "连续性可用（仅本地完整性；历史为 legacy_forensic_integrity_limited）"
    : auditHealthy ? "本地链完整" : "审计连续性异常";
  const checks = [
    ["kill_switch", "一键熔断未开启", !db.system?.killSwitch, db.system?.killSwitch ? "系统处于熔断" : "未熔断"],
    ["autonomy", "自主推进已开启", db.system?.autonomyEnabled === true, db.system?.autonomyEnabled ? "已开启" : "人工暂停"],
    ["mandate", "存在有效授权", Boolean(mandate), mandate ? `${(mandate.allowedSymbols || []).join("、") || "已授权"}` : "无激活授权"],
    ["market", "行情数据新鲜", ageMs(latestMarket?.updatedAt || latestMarket?.syncedAt) !== null && ageMs(latestMarket?.updatedAt || latestMarket?.syncedAt) <= 15000, latestMarket ? `${latestMarket.symbol} · ${Math.round(ageMs(latestMarket.updatedAt || latestMarket.syncedAt) / 1000)}秒前` : "无行情"],
    ["account", "账户风险基准新鲜", Boolean(snapshot) && ageMs(snapshot.createdAt) <= 300000, snapshot ? `${Math.round(ageMs(snapshot.createdAt) / 1000)}秒前` : "无账户快照"],
    ["reconcile", "最近对账正常", latestReconcile?.status === "ok" && ageMs(latestReconcile.createdAt) <= 300000, latestReconcile ? `${latestReconcile.status} · ${Math.round(ageMs(latestReconcile.createdAt) / 1000)}秒前` : "未对账"],
    ["loss_budget", "日亏损预算未耗尽", db.system?.remainingDailyLossUsdt == null || Number(db.system.remainingDailyLossUsdt) > 0, db.system?.remainingDailyLossUsdt == null ? "未配置/未知" : `${db.system.remainingDailyLossUsdt} USDT`],
    ["audit", auditStatus.mode === "incident_adjudicated_local_continuity" ? "审计连续性可用" : "审计链正常", auditHealthy, auditEvidence]
    ,["operational", "交易运行链路正常", !degradation.degraded && !db.system?.reduceOnlyMode, degradation.degraded ? degradation.reasons.join("、") : db.system?.reduceOnlyMode ? "当前暂停新开仓" : "正常"]
  ].map(([key, label, passed, evidence]) => ({ key, label, passed, evidence }));
  const blocking = checks.filter((c) => !c.passed);
  return { generatedAt: nowIso(), decision: blocking.length ? "blocked" : "allowed", summary: blocking.length ? `当前禁止新开仓：${blocking.map((c) => c.label).join("、")}` : "当前满足新开仓前置条件；具体计划仍需逐单风控", checks };
}

export function buildExecutionQuality(db) {
  const fills = systemTradeFills(db).filter((f) => Number.isFinite(Number(f.slippageBps)));
  const systemFillScope = { ...db, fills: systemTradeFills(db) };
  const slips = fills.map((f) => Number(f.slippageBps));
  const orders = db.executionOrders || [];
  const partial = orders.filter((o) => /partial/.test(String(o.status)) || Number(o.filledQuantity || 0) > 0 && Number(o.filledQuantity) < Number(o.quantity)).length;
  const symbols = [...new Set(fills.map((fill) => String(fill.symbol || "").toUpperCase()).filter(Boolean))];
  const calibrationBySymbol = symbols.map((symbol) => buildSlippageCalibration(systemFillScope, symbol));
  return { fills: fills.length, avgSlippageBps: slips.length ? pct(slips.reduce((a, b) => a + b, 0) / slips.length) : null, p95SlippageBps: quantile(slips, .95), partialFillRatePct: orders.length ? pct(partial / orders.length * 100) : null, calibrationBySymbol };
}

export function buildStrategyDrift(db, { strategy } = {}) {
  let lifecycles = groupSystemClosedTradeLifecycles(db).filter((row) => row.netRealizedPnl !== null && row.netRealizedPnl !== undefined && row.netRealizedPnl !== "" && Number.isFinite(Number(row.netRealizedPnl)));
  if (strategy) lifecycles = lifecycles.filter((lifecycle) => {
    const fill = lifecycle.representative;
    const executionOrder = (db.executionOrders || []).find((item) => item.id === fill.executionOrderId);
    const plan = (db.tradePlans || []).find((item) => item.id === (fill.tradePlanId || fill.planId || executionOrder?.planId));
    return (fill.strategy || executionOrder?.strategy || plan?.strategy || plan?.strategy_type) === strategy;
  });
  const values = lifecycles.map((lifecycle) => Number(lifecycle.netRealizedPnl));
  const recent = values.slice(0, 10);
  const baseline = values.slice(10, 40);
  const mean = (rows) => rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : null;
  const variance = (rows, average) => rows.length > 1 ? rows.reduce((sum, value) => sum + (value - average) ** 2, 0) / (rows.length - 1) : null;
  const recentExpectancy = mean(recent);
  const baselineExpectancy = mean(baseline);
  let tStat = null;
  let significant = false;
  if (recent.length >= 5 && baseline.length >= 5 && recentExpectancy !== null && baselineExpectancy !== null) {
    const recentVariance = variance(recent, recentExpectancy);
    const baselineVariance = variance(baseline, baselineExpectancy);
    const standardError = Math.sqrt((recentVariance / recent.length) + (baselineVariance / baseline.length));
    tStat = standardError > 0 ? Number(((recentExpectancy - baselineExpectancy) / standardError).toFixed(2)) : null;
    significant = tStat !== null && Math.abs(tStat) >= 2;
  }
  const performanceDrift = significant && recentExpectancy < baselineExpectancy;
  return {
    status: lifecycles.length < 20 ? "insufficient_sample" : "ok",
    diagnosis: {
      strategy: strategy || null,
      trades: lifecycles.length,
      recentExpectancy,
      baselineExpectancy,
      tStat,
      significant,
      performanceDrift,
      note: !significant ? "近期与基线差异不显著,可能只是正常波动" : performanceDrift ? "近期显著弱于基线,存在表现漂移" : "近期显著强于基线",
      executionQuality: buildExecutionQuality(db)
    }
  };
}

export function buildReplayBundles(db, limit = 20) {
  return (db.agentRuns || []).slice(0, limit).map((run) => {
    const plan = (db.tradePlans || []).find((p) => p.id === run.tradePlanId);
    const risk = (db.riskChecks || []).find((r) => r.id === run.riskCheckId || r.tradePlanId === plan?.id);
    const executions = (db.executionOrders || []).filter((o) => o.agentRunId === run.id || o.planId === plan?.id);
    const fills = systemTradeFills(db).filter((fill) => fill.agentRunId === run.id || fill.tradePlanId === plan?.id);
    return {
      traceId: run.traceId || run.id, agentRunId: run.id, tradePlanId: plan?.id || null, riskCheckId: risk?.id || null,
      executionOrderIds: executions.map((o) => o.id), fillIds: fills.map((f) => f.id), positionIds: (db.positions || []).filter((p) => executions.some((o) => o.id === p.executionOrderId)).map((p) => p.id),
      versions: { model: run.model || db.runtimeConfig?.DEEPSEEK_MODEL || null, prompt: run.promptVersion || "agent-chat-v1", toolSchema: "agent-tools-v1", knowledge: (plan?.knowledgeSkills || []).map((s) => ({ id: s.skillId, version: s.version, fingerprint: s.fingerprint })), strategy: plan?.strategyVersion || plan?.strategy || null },
      createdAt: run.createdAt, status: run.status
    };
  });
}

export function buildProfessionalSnapshot(db, options = {}) {
  return { permissionEvidence: buildTradingPermissionEvidence(db, { auditStatus: options.auditStatus }), slo: buildSloReport(db), executionQuality: buildExecutionQuality(db), portfolioRisk: buildPortfolioRisk(db, activeMandate(db)), replayBundles: buildReplayBundles(db) };
}
