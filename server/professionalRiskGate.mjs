import { buildPortfolioRisk } from "./portfolioRisk.mjs";
import { activeMandate, appendAudit, appendTrace, effectiveAuditOperationalStatus, id, nowIso } from "./store.mjs";
import { estimateExecutionCost, maxNotionalForImpact } from "./executionCostModel.mjs";
import { analyzeMarketRegime } from "./marketRegimeAnalysis.mjs";
import { requiresExternalSecurityInfrastructure } from "./securityProfile.mjs";
import { externalAlertConfigured, recentExternalAlertSucceeded } from "./alertHealth.mjs";
import { reconcileRiskIncidentLifecycle } from "./riskIncidentLifecycle.mjs";
import { clearReduceOnlyReason, setReduceOnlyReason, syncReduceOnlyState } from "./reduceOnlyState.mjs";
import { currentOkxCredentialFingerprint } from "./exchangeConnector.mjs";
import { marketFactFreshness } from "./marketFreshness.mjs";
import { canonicalPositionDirection, canonicalPositionKey } from "./positionIdentity.mjs";
import { newestAuthoritativePosition } from "./positionView.mjs";
import { refreshOwnerImprovementRegistry } from "./ownerReviewLoop.mjs";

const ageMs = (value) => value ? Date.now() - new Date(value).getTime() : Infinity;
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

export function fullAutoSafetyEnforced(db) {
  const gray = (db.grayReleasePolicies || []).find((item) => item.enabled);
  return db.system?.professionalRiskMode === true
    || (db.system?.liveTradingEnabled === true
      && db.system?.autonomyEnabled === true
      && db.system?.orderWriteEnabled === true
      && gray?.requiresManualApproval === false);
}

// SLO 默认放宽到与本系统真实数据管道匹配(行情按需/巡检同步、对账定时):15s/5min 会被 97s 微同步、
// 8 分钟对账秒杀→常态降级。默认 180s/30min;要更严自行调 env,或开 professionalRiskMode 后按需收紧。
export function assessOperationalDegradation(db, options = {}) {
  const reasons = [];
  const live = db.system?.liveTradingEnabled === true;
  const gray = (db.grayReleasePolicies || []).find((item) => item.enabled);
  const fullAutoActive = live && db.system?.autonomyEnabled === true
    && db.system?.orderWriteEnabled === true && gray?.requiresManualApproval === false;
  const marketMaxAge = Number(process.env.SLO_MARKET_FRESHNESS_MS || 180000);
  const mandate = activeMandate(db);
  const symbols = mandate?.allowedSymbols || [];
  const relevantMarkets = (db.markets || []).filter((m) => !symbols.length || symbols.includes(m.symbol));
  if (live && relevantMarkets.length && relevantMarkets.every((m) => !marketFactFreshness(m, { tickerMaxAgeMs: marketMaxAge }).ticker.ok)) reasons.push("market_data_stale");
  if (live && relevantMarkets.length && relevantMarkets.every((m) => !marketFactFreshness(m).micro.ok)) reasons.push("microstructure_data_stale");
  const hasPrivateAccount = (db.exchangeAccounts || []).some((a) => a.exchange === "OKX" && a.readEnabled);
  const okxPrivate = (db.realtimeConnections || []).find((c) => c.exchange === "OKX" && c.streamType === "private_user");
  if (live && hasPrivateAccount && (!okxPrivate || okxPrivate.status !== "connected")) reasons.push("private_ws_disconnected");
  if (live && hasPrivateAccount && okxPrivate?.authenticatedCredentialFingerprint !== currentOkxCredentialFingerprint()) reasons.push("private_ws_credential_mismatch");
  if ((db.executionOrders || []).some((o) => String(o.status).toUpperCase() === "UNKNOWN")) reasons.push("unknown_order_state");
  const reconcile = db.reconciliationReports?.[0];
  const reconcileMaxAge = Number(process.env.SLO_RECONCILIATION_FRESHNESS_MS || 1800000);
  if (live && hasPrivateAccount && (!reconcile || reconcile.status !== "ok" || ageMs(reconcile.createdAt) > reconcileMaxAge)) reasons.push("reconciliation_unhealthy");
  const auditStatus = effectiveAuditOperationalStatus(db, options.auditStatus);
  if (!auditStatus.operationalReady) reasons.push("audit_chain_invalid");
  // 全自主运行不能只在“切换模式那一刻”检查外部控制面；每次开仓前都要确认
  // WORM 审计与告警仍存活。失联即暂停新开仓，恢复后由同一闸自动解锁。
  if (fullAutoActive) {
    if (requiresExternalSecurityInfrastructure()) {
      const wormAge = ageMs(db.system?.wormAuditLastSuccessAt);
      if (!process.env.WORM_AUDIT_ENDPOINT || wormAge > 15 * 60_000) reasons.push("worm_audit_unhealthy");
    }
    if (requiresExternalSecurityInfrastructure()) {
      const alertConfigured = externalAlertConfigured();
      const alertHealthy = recentExternalAlertSucceeded(db);
      if (!alertConfigured || !alertHealthy) reasons.push("external_alert_unhealthy");
    }
  }
  return { degraded: reasons.length > 0, mode: reasons.length ? "reduce_only" : "normal", reasons, assessedAt: nowIso(), enforced: fullAutoSafetyEnforced(db) };
}

// 只在 professionalRiskMode 开启时才真正暂停新开仓；条件消失自动解除，不再永久缴械。
// 绝不再自动关 autonomy（开仓闸已拦截，还要保留观察与持仓管理）。默认仅记录，不改状态。
export function applyOperationalDegradation(db, actor = "ProfessionalRiskGate") {
  const assessment = assessOperationalDegradation(db);
  db.system ||= {};
  db.system.operationalDegradation = assessment;
  const enforce = fullAutoSafetyEnforced(db);
  if (enforce && assessment.degraded) {
    const newlyActivated = db.system.reduceOnlyMode !== true;
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy = "professional_risk_gate";
    setReduceOnlyReason(db, "professional_risk_gate", { sticky: false, sourceId: actor });
    db.system.riskStatus = "暂停新开仓";
    db.system.latestAction = `专业风险闸已暂停新开仓：${assessment.reasons.join("、")}`;
    db.system.updatedAt = nowIso();
    if (newlyActivated) {
      db.riskIncidents ||= [];
      db.riskIncidents.unshift({ id: id("incident"), severity: "critical", status: "open", title: "系统已自动暂停新开仓", source: "professional_risk_gate", reasons: assessment.reasons, tenantId: db.user?.tenantId || "tenant_owner", ownerUserId: db.user?.id || null, createdAt: nowIso() });
      refreshOwnerImprovementRegistry(db);
      appendAudit(db, db.system.latestAction, "system.reduce_only", actor, "critical");
      appendTrace(db, "professional_risk", db.system.latestAction, "blocked");
    }
  } else if (!assessment.degraded) {
    // 自愈：降级条件消失且限制由本闸设置 → 自动解除。
    if (clearReduceOnlyReason(db, "professional_risk_gate", { resolvedBy: actor, resolution: "operational_health_restored" })) {
      db.system.latestAction = "专业风险闸：运行链路恢复正常，已恢复新开仓评估";
      db.system.updatedAt = nowIso();
      appendTrace(db, "professional_risk", db.system.latestAction, "ok");
    }
  }
  // 风险闸是可恢复状态。运行链路恢复后，旧的 open 事件也必须同步闭环，
  // 否则 LLM/前端会继续把历史故障当成当前事实。
  reconcileRiskIncidentLifecycle(db, { degradation: assessment });
  syncReduceOnlyState(db);
  return assessment;
}

export function evaluateProfessionalPlanRisks(db, plan, mandate = activeMandate(db)) {
  const live = db.system?.liveTradingEnabled === true;
  // 只有开了 professionalRiskMode 才把这些专业检查当硬闸;否则一律 warn(信息展示,不拦交易)。
  // 缺数据(如盘口深度未同步)一律 warn,绝不因"数据没到"就 block 把交易焊死。
  const enforce = fullAutoSafetyEnforced(db) && live;
  const market = (db.markets || []).find((m) => m.symbol === plan.symbol) || {};
  const checks = [];
  const push = (name, passed, detail, severity = passed ? "ok" : enforce ? "block" : "warn") => checks.push({ name, passed, detail, severity });

  const degradation = assessOperationalDegradation(db);
  push("运行降级状态", !degradation.degraded && !db.system?.reduceOnlyMode, degradation.degraded ? `暂停新开仓：${degradation.reasons.join("、")}` : db.system?.reduceOnlyMode ? "系统已暂停新开仓" : "运行链路正常");

  const marketMaxAge = Number(process.env.SLO_MARKET_FRESHNESS_MS || 180000);
  const facts = marketFactFreshness(market, { tickerMaxAgeMs: marketMaxAge });
  const tickerAge = facts.ticker.ageMs;
  push("Ticker 新鲜度 SLO", facts.ticker.ok, tickerAge === Infinity ? "缺少独立 ticker 时间戳" : facts.ticker.reason === "future_timestamp" ? "ticker 时间戳超前" : `ticker ${Math.round(tickerAge / 1000)} 秒前，目标 ≤${Math.round(marketMaxAge / 1000)} 秒`, facts.ticker.ok ? "ok" : enforce ? "block" : "warn");
  push("微观结构新鲜度 SLO", facts.micro.ok, facts.micro.ageMs === Infinity ? "缺少独立微观结构时间戳" : facts.micro.reason === "future_timestamp" ? "微观结构时间戳超前" : `微观结构 ${Math.round(facts.micro.ageMs / 1000)} 秒前`, facts.micro.ok ? "ok" : enforce ? "block" : "warn");

  const regimeRows = market?.candlesByTf?.[plan.timeframe || "1h"]?.candles || market.candles || [];
  const regime = analyzeMarketRegime(regimeRows, { spreadBps: market.spreadBps });
  const unstableTransition = regime.transition?.detected === true && Number(regime.transition.confidence) >= 0.65;
  push("行情状态稳定性", !unstableTransition, unstableTransition
    ? `检测到 ${regime.transition.type}，置信度 ${(regime.transition.confidence * 100).toFixed(0)}%，作为计划警告与置信度输入`
    : regime.label === "insufficient" ? "状态样本不足，保持中性" : `当前 ${regime.label}，未检测到高置信状态切换`, unstableTransition ? "warn" : "ok");

  const portfolio = buildPortfolioRisk(db, mandate);
  const utilization = finite(portfolio.utilizationPct) ? Number(portfolio.utilizationPct) : Number.NaN;
  push("组合波动预算", !finite(utilization) || utilization < 100, finite(utilization) ? `组合波动预算使用 ${utilization}%` : "无持仓或数据不足", finite(utilization) && utilization >= 100 ? (enforce ? "block" : "warn") : finite(utilization) && utilization >= 80 ? "warn" : "ok");

  const maxImpactBps = Number(mandate?.maxImpactBps || 15);
  const rawSpread = market.spreadBps;
  const rawDepth = market.depthUsdt ?? market.orderBookDepthUsdt ?? market.depth5Usdt;
  const spread = finite(rawSpread) ? Number(rawSpread) : Number.NaN;
  const depth = finite(rawDepth) ? Number(rawDepth) : Number.NaN;
  const requestedNotional = Number(plan.notionalUsdt || plan.notional || db.grayReleasePolicies?.find((p) => p.enabled)?.maxNotionalUsdt || 50);
  const costEstimate = estimateExecutionCost(db, { symbol: plan.symbol, spreadBps: spread, depthUsdt: depth, notionalUsdt: requestedNotional });
  const impact = costEstimate.ok ? costEstimate.expectedImpactBps : null;
  // 缺盘口深度 → 无法校验 → warn(不 block);有深度且超限才在 enforce 下 block。
  push("流动性与冲击成本", impact === null || impact <= maxImpactBps, impact === null ? "缺少可验证的盘口点差或深度（未校验）" : `预计冲击 ${impact.toFixed(2)} bps，上限 ${maxImpactBps} bps`, impact === null ? "warn" : impact <= maxImpactBps ? "ok" : enforce ? "block" : "warn");

  const minLiquidationDistancePct = Number(mandate?.minLiquidationDistancePct || 12);
  const liqFactMaxAgeMs = Number(process.env.MAX_LIQUIDATION_FACT_AGE_MS || 120_000);
  const groupedPositions = new Map();
  for (const position of db.positions || []) {
    const key = canonicalPositionKey(position);
    if (!key) continue;
    const quantity = finite(position.coinSize) ? Math.abs(Number(position.coinSize))
      : position.source === "execution_engine" && finite(position.quantity ?? position.size) ? Math.abs(Number(position.quantity ?? position.size)) : null;
    if (!(quantity > 0)) continue;
    const group = groupedPositions.get(key) || [];
    group.push(position);
    groupedPositions.set(key, group);
  }
  const safePositions = [], threatened = [], unknownLiquidation = [];
  for (const [key, rows] of groupedPositions) {
    const authorityFact = newestAuthoritativePosition(rows, { maxAgeMs: liqFactMaxAgeMs });
    const authority = authorityFact.row;
    const fresh = authorityFact.fresh;
    const mark = finite(authority?.mark ?? authority?.markPrice) ? Number(authority.mark ?? authority.markPrice) : null;
    const liq = finite(authority?.liquidationPrice ?? authority?.liqPx) ? Number(authority.liquidationPrice ?? authority.liqPx) : null;
    const direction = canonicalPositionDirection(authority || rows[0]);
    const relationValid = mark > 0 && liq > 0 && (direction === "short" ? liq > mark : direction === "long" ? liq < mark : false);
    if (!authority || !fresh || !relationValid) {
      unknownLiquidation.push({ key, symbol: rows[0].symbol, reason: !authority ? "exchange_position_unavailable" : !fresh ? authorityFact.reason : "liquidation_fact_invalid" });
      continue;
    }
    const distancePct = Math.abs(mark - liq) / mark * 100;
    (distancePct < minLiquidationDistancePct ? threatened : safePositions).push({ key, symbol: rows[0].symbol, distancePct });
  }
  const liquidationPassed = threatened.length === 0 && unknownLiquidation.length === 0;
  const liquidationDetail = threatened.length
    ? `${threatened.map((p) => p.symbol).join("、")} 强平距离低于 ${minLiquidationDistancePct}%`
    : unknownLiquidation.length
      ? `${unknownLiquidation.map((p) => p.symbol).join("、")} 强平价/标记价或快照不可验证`
      : safePositions.length ? `全部 ${safePositions.length} 个权威持仓强平距离 ≥${minLiquidationDistancePct}%` : "当前无开放持仓";
  push("现有持仓强平距离", liquidationPassed, liquidationDetail, liquidationPassed ? "ok" : enforce ? "block" : "warn");

  return { checks, portfolio, degradation, regime, liquidity: { spreadBps: finite(spread) ? spread : null, depthUsdt: finite(depth) ? depth : null, expectedImpactBps: impact, maxImpactBps, model: costEstimate.ok ? costEstimate.model : null, calibration: costEstimate.ok ? costEstimate.calibration : null } };
}

export function professionalNotionalCap(db, plan, proposedNotional) {
  const mandate = db.mandates?.find((m) => m.id === plan.mandateId) || activeMandate(db);
  const market = (db.markets || []).find((m) => m.symbol === plan.symbol) || {};
  let cap = Number(proposedNotional);
  const reasons = [];
  const rawSpread = market.spreadBps;
  const rawDepth = market.depthUsdt ?? market.orderBookDepthUsdt ?? market.depth5Usdt;
  const spread = finite(rawSpread) ? Number(rawSpread) : Number.NaN;
  const depth = finite(rawDepth) ? Number(rawDepth) : Number.NaN;
  const maxImpactBps = Number(mandate?.maxImpactBps || 15);
  if (finite(spread) && finite(depth) && depth > 0) {
    const liquidityCap = maxNotionalForImpact(db, { symbol: plan.symbol, spreadBps: spread, depthUsdt: depth, maxImpactBps });
    if (liquidityCap < cap) { cap = liquidityCap; reasons.push("liquidity_impact_capped"); }
  }
  const portfolio = buildPortfolioRisk(db, mandate);
  if (finite(portfolio.utilizationPct) && portfolio.utilizationPct >= 80) {
    const multiplier = Math.max(0, (100 - portfolio.utilizationPct) / 20);
    const adjusted = cap * multiplier;
    if (adjusted < cap) { cap = adjusted; reasons.push("portfolio_budget_capped"); }
  }
  const highCorrelation = (portfolio.correlations || []).some((c) => Math.abs(Number(c.rho)) >= Number(mandate?.highCorrelationThreshold || .8));
  if (highCorrelation) { cap *= .5; reasons.push("correlation_capped_50pct"); }
  return { cap: Math.max(0, cap), reasons };
}
