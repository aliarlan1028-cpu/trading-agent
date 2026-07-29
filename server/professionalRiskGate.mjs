import { buildPortfolioRisk } from "./portfolioRisk.mjs";
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const ageMs = (value) => value ? Date.now() - new Date(value).getTime() : Infinity;
const finite = (value) => Number.isFinite(Number(value));

// SLO 默认放宽到与本系统真实数据管道匹配(行情按需/巡检同步、对账定时):15s/5min 会被 97s 微同步、
// 8 分钟对账秒杀→常态降级。默认 180s/30min;要更严自行调 env,或开 professionalRiskMode 后按需收紧。
export function assessOperationalDegradation(db) {
  const reasons = [];
  const live = db.system?.liveTradingEnabled === true;
  const marketMaxAge = Number(process.env.SLO_MARKET_FRESHNESS_MS || 180000);
  const mandate = activeMandate(db);
  const symbols = mandate?.allowedSymbols || [];
  const relevantMarkets = (db.markets || []).filter((m) => !symbols.length || symbols.includes(m.symbol));
  if (live && relevantMarkets.length && relevantMarkets.every((m) => ageMs(m.updatedAt || m.syncedAt || m.microSyncedAt) > marketMaxAge)) reasons.push("market_data_stale");
  if (live && db.realtimeStarted && (db.realtimeConnections || []).some((c) => c.streamType === "private" && c.status !== "connected")) reasons.push("private_ws_disconnected");
  if ((db.executionOrders || []).some((o) => String(o.status).toUpperCase() === "UNKNOWN")) reasons.push("unknown_order_state");
  const hasPrivateAccount = (db.exchangeAccounts || []).some((a) => a.readEnabled);
  const reconcile = db.reconciliationReports?.[0];
  const reconcileMaxAge = Number(process.env.SLO_RECONCILIATION_FRESHNESS_MS || 1800000);
  if (live && hasPrivateAccount && (!reconcile || reconcile.status !== "ok" || ageMs(reconcile.createdAt) > reconcileMaxAge)) reasons.push("reconciliation_unhealthy");
  if (db.meta?.auditChainBroken === true) reasons.push("audit_chain_invalid");
  return { degraded: reasons.length > 0, mode: reasons.length ? "reduce_only" : "normal", reasons, assessedAt: nowIso(), enforced: db.system?.professionalRiskMode === true };
}

// 只在 professionalRiskMode 开启时才真正"只减仓";且做成可恢复的——条件消失自动解除,不再永久缴械。
// 绝不再自动关 autonomy(只减仓已拦新开仓,还要保留观察/管理持仓)。默认(flag 关)仅记录,不改状态。
export function applyOperationalDegradation(db, actor = "ProfessionalRiskGate") {
  const assessment = assessOperationalDegradation(db);
  db.system ||= {};
  db.system.operationalDegradation = assessment;
  const enforce = db.system.professionalRiskMode === true;
  if (enforce && assessment.degraded) {
    const newlyActivated = db.system.reduceOnlyMode !== true;
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy = "professional_risk_gate";
    db.system.riskStatus = "只减仓";
    db.system.latestAction = `专业风险闸自动切换只减仓：${assessment.reasons.join("、")}`;
    db.system.updatedAt = nowIso();
    if (newlyActivated) {
      db.riskIncidents ||= [];
      db.riskIncidents.unshift({ id: id("incident"), severity: "critical", status: "open", title: "系统自动进入只减仓模式", source: "professional_risk_gate", reasons: assessment.reasons, createdAt: nowIso() });
      appendAudit(db, db.system.latestAction, "system.reduce_only", actor, "critical");
      appendTrace(db, "professional_risk", db.system.latestAction, "blocked");
    }
  } else if (!assessment.degraded && db.system.reduceOnlyMode === true && db.system.reduceOnlyBy === "professional_risk_gate") {
    // 自愈:降级条件消失且只减仓是本闸设的 → 自动解除(不影响用户手动设的只减仓)。
    db.system.reduceOnlyMode = false;
    db.system.reduceOnlyBy = null;
    db.system.latestAction = "专业风险闸:运行链路恢复正常,已解除只减仓";
    db.system.updatedAt = nowIso();
    appendTrace(db, "professional_risk", db.system.latestAction, "ok");
  }
  return assessment;
}

export function evaluateProfessionalPlanRisks(db, plan, mandate = activeMandate(db)) {
  const live = db.system?.liveTradingEnabled === true;
  // 只有开了 professionalRiskMode 才把这些专业检查当硬闸;否则一律 warn(信息展示,不拦交易)。
  // 缺数据(如盘口深度未同步)一律 warn,绝不因"数据没到"就 block 把交易焊死。
  const enforce = db.system?.professionalRiskMode === true && live;
  const market = (db.markets || []).find((m) => m.symbol === plan.symbol) || {};
  const checks = [];
  const push = (name, passed, detail, severity = passed ? "ok" : enforce ? "block" : "warn") => checks.push({ name, passed, detail, severity });

  const degradation = assessOperationalDegradation(db);
  push("运行降级状态", !degradation.degraded && !db.system?.reduceOnlyMode, degradation.degraded ? `建议只减仓：${degradation.reasons.join("、")}` : db.system?.reduceOnlyMode ? "系统处于只减仓模式" : "运行链路正常");

  const marketAge = ageMs(market.updatedAt || market.syncedAt || market.microSyncedAt);
  const marketMaxAge = Number(process.env.SLO_MARKET_FRESHNESS_MS || 180000);
  push("行情新鲜度 SLO", marketAge <= marketMaxAge, marketAge === Infinity ? "缺少行情时间戳" : `行情 ${Math.round(marketAge / 1000)} 秒前，目标 ≤${Math.round(marketMaxAge / 1000)} 秒`, marketAge <= marketMaxAge ? "ok" : enforce ? "block" : "warn");

  const portfolio = buildPortfolioRisk(db, mandate);
  const utilization = Number(portfolio.utilizationPct);
  push("组合波动预算", !finite(utilization) || utilization < 100, finite(utilization) ? `组合波动预算使用 ${utilization}%` : "无持仓或数据不足", finite(utilization) && utilization >= 100 ? (enforce ? "block" : "warn") : finite(utilization) && utilization >= 80 ? "warn" : "ok");

  const maxImpactBps = Number(mandate?.maxImpactBps || 15);
  const spread = Number(market.spreadBps);
  const depth = Number(market.depthUsdt || market.orderBookDepthUsdt || market.depth5Usdt);
  const requestedNotional = Number(plan.notionalUsdt || plan.notional || db.grayReleasePolicies?.find((p) => p.enabled)?.maxNotionalUsdt || 50);
  const impact = finite(spread) && finite(depth) && depth > 0 ? spread / 2 + requestedNotional / depth * 10000 : null;
  // 缺盘口深度 → 无法校验 → warn(不 block);有深度且超限才在 enforce 下 block。
  push("流动性与冲击成本", impact === null || impact <= maxImpactBps, impact === null ? "缺少可验证盘口深度(未校验)" : `预计冲击 ${impact.toFixed(2)} bps，上限 ${maxImpactBps} bps`, impact === null ? "warn" : impact <= maxImpactBps ? "ok" : enforce ? "block" : "warn");

  const minLiquidationDistancePct = Number(mandate?.minLiquidationDistancePct || 12);
  const threatened = (db.positions || []).filter((p) => {
    const mark = Number(p.mark || p.markPrice), liq = Number(p.liquidationPrice || p.liqPx);
    return finite(mark) && mark > 0 && finite(liq) && liq > 0 && Math.abs(mark - liq) / mark * 100 < minLiquidationDistancePct;
  });
  push("现有持仓强平距离", threatened.length === 0, threatened.length ? `${threatened.map((p) => p.symbol).join("、")} 强平距离低于 ${minLiquidationDistancePct}%` : `所有可计算持仓强平距离 ≥${minLiquidationDistancePct}%`);

  return { checks, portfolio, degradation, liquidity: { spreadBps: finite(spread) ? spread : null, depthUsdt: finite(depth) ? depth : null, expectedImpactBps: impact, maxImpactBps } };
}

export function professionalNotionalCap(db, plan, proposedNotional) {
  const mandate = db.mandates?.find((m) => m.id === plan.mandateId) || activeMandate(db);
  const market = (db.markets || []).find((m) => m.symbol === plan.symbol) || {};
  let cap = Number(proposedNotional);
  const reasons = [];
  const spread = Number(market.spreadBps), depth = Number(market.depthUsdt || market.orderBookDepthUsdt || market.depth5Usdt);
  const maxImpactBps = Number(mandate?.maxImpactBps || 15);
  if (finite(spread) && finite(depth) && depth > 0) {
    const liquidityCap = depth * Math.max(0, maxImpactBps - spread / 2) / 10000;
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
