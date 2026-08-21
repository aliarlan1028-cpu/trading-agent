import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { fetchTradeWindowNews } from "./marketScan.mjs";
import { getHistoricalKlines } from "./exchangeConnector.mjs";
import {
  completeTradeReview,
  findTradeEntryFill,
  isFinanciallyReconciledLifecycle,
  markTradeReviewProcessing,
  resolveAuthoritativeTradeStrategyRef,
  resolveTradeContext,
  syncTradeReviewQueue
} from "./tradeReviewQueue.mjs";
import { groupSystemClosedTradeLifecycles } from "./systemTradeProjection.mjs";
import { stampReviewMemoryContext } from "./reviewLearning.mjs";
import { buildStructuredTradeAssessment, isOwnerReviewRow, migrateLegacyOwnerReviewProvenance, refreshOwnerImprovementRegistry } from "./ownerReviewLoop.mjs";
import { belongsToPrincipal } from "./principalScope.mjs";

export function storedTradeWindowNews(db, symbol, openAt, closeAt) {
  const base = String(symbol || "").split(/[/-]/)[0].toUpperCase();
  if (!base || !openAt || !closeAt) return null;
  const start = new Date(openAt || 0).getTime();
  const end = new Date(closeAt || 0).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end < start) return null;
  const facts = (db.marketIntelligenceFacts || []).filter((fact) => {
    const at = new Date(fact.publishedAt || fact.observedAt || fact.createdAt || 0).getTime();
    if (!Number.isFinite(at) || at < start - 3_600_000 || at > end) return false;
    if (fact.type !== "news" && !["news", "flash_news", "币圈事件", "宏观事件"].includes(fact.category)) return false;
    const symbols = fact.affectedSymbols || fact.symbols || [];
    const text = `${fact.title || ""} ${fact.summary || ""} ${fact.content || ""}`.toUpperCase();
    const symbolBases = symbols.map((value) => String(value || "").toUpperCase().replace(/-SWAP$/, "").split(/[\/_-]/)[0]).filter(Boolean);
    if (symbolBases.length) return symbolBases.includes(base);
    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^A-Z0-9])${escapedBase}(?:/|-)?(?:USDT)?(?:$|[^A-Z0-9])`, "i").test(text);
  }).filter((fact) => {
    const values = fact.values || {};
    const explicitlyVerified = fact.verifiedOrigin === true || values.verifiedOrigin === true;
    const trustTier = String(fact.trustTier || values.trustTier || "");
    const trustedTier = trustTier === "verified_official" || trustTier === "verified_publisher";
    const fakeRisk = fact.fakeRisk || values.fakeRisk;
    return explicitlyVerified && trustedTier && fakeRisk !== "high" && values.aggregator !== true;
  }).slice(0, 5);
  if (!facts.length) return null;
  const safeFacts = facts.map((fact) => reviewNewsFactDescriptor(fact));
  const news = safeFacts.map((fact) => `factId=${fact.factId} category=${fact.category} impact=${fact.impact ?? "unknown"} sentiment=${fact.sentiment}`).join("；").slice(0, 900);
  if (!news) return null;
  const sentiments = safeFacts.map((fact) => fact.sentiment).filter(Boolean);
  const impacts = safeFacts.map((fact) => fact.impact).filter((value) => Number.isFinite(value));
  return {
    verified: true,
    source: "stored_market_intelligence",
    factIds: safeFacts.map((fact) => fact.factId).filter(Boolean),
    facts: safeFacts,
    news,
    sentiment: sentiments.includes("利空") ? "利空" : sentiments.includes("利多") ? "利多" : "中性",
    maxImpact: impacts.length ? Math.max(...impacts) : null,
    highImpact: impacts.some((value) => value >= 80)
  };
}

function reviewNewsFactDescriptor(fact = {}) {
  const values = fact.values || {};
  const factId = String(fact.id || fact.factId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "unknown";
  const category = String(fact.category || fact.type || "news").replace(/[^a-zA-Z0-9_\-一-龥]/g, "").slice(0, 40) || "news";
  const rawSentiment = fact.sentiment || values.sentiment;
  const sentiment = ["利多", "利空", "中性", "不确定"].includes(rawSentiment) ? rawSentiment : "不确定";
  const impact = Number(values.impact ?? fact.impact);
  return {
    factId,
    category,
    sentiment,
    impact: Number.isFinite(impact) ? Math.max(0, Math.min(100, impact)) : null,
    publishedAt: fact.publishedAt || fact.observedAt || null
  };
}

// #4 开仓后轨迹重建:平仓后按开仓→平仓时间窗回补 K 线,还原"价格怎么走的"——
// 先顺行还是先逆行、最高逼近止盈多少、何时见顶、之后反转几次、最深不利多少。
// 只用真实 K 线(交易所历史),LLM 复盘据此判断"离场太早/太晚、止盈太贪、方向读反"。取数失败返回 null,不阻断复盘。
async function computeTradeTrajectory(db, fill, plan) {
  try {
    const entryFill = findTradeEntryFill(db.fills || [], fill);
    const eo = resolveTradeContext(db, fill).executionOrder || {};
    const entry = number(entryFill?.price ?? plan.entry ?? eo.entry);
    const exit = number(fill.price ?? eo.lastMark);
    const openMs = new Date(entryFill?.createdAt || plan.createdAt || fill.openedAt || fill.createdAt).getTime();
    const closeMs = new Date(fill.createdAt).getTime();
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(openMs) || !Number.isFinite(closeMs) || closeMs <= openMs) return null;
    const isShort = fill.direction === "short" || fill.direction === "空";
    const dirSign = isShort ? -1 : 1;
    const tp1 = number((plan.takeProfit || plan.take_profit || eo.takeProfits || [])[0]);
    const stop = number(plan.stopLoss ?? plan.stop_loss ?? eo.stopLoss);
    const holdMin = Math.max(1, (closeMs - openMs) / 60000);
    // 周期自适应:短持仓用细粒度,长持仓放粗,控制根数 ≤ 300。
    const tf = holdMin <= 90 ? "5m" : holdMin <= 360 ? "15m" : holdMin <= 1440 ? "1h" : "4h";
    const tfMin = tf === "5m" ? 5 : tf === "15m" ? 15 : tf === "1h" ? 60 : 240;
    const limit = Math.min(300, Math.ceil(holdMin / tfMin) + 6);
    const all = await getHistoricalKlines(fill.symbol, tf, limit, (eo.exchange || "OKX"));
    if (!Array.isArray(all) || all.length < 2) return null;
    const win = all.filter((c) => c.time >= openMs - tfMin * 60000 && c.time <= closeMs + tfMin * 60000);
    const candles = (win.length >= 2 ? win : all).slice(-Math.min(300, limit));
    if (candles.length < 2) return null;
    const tpDist = Number.isFinite(tp1) ? Math.abs(tp1 - entry) : null;
    const stopDist = Number.isFinite(stop) ? Math.abs(entry - stop) : null;
    // 顺行/逆行的极值(用 high/low 取当根内的最有利/最不利):
    let maxFav = 0, maxAdv = 0, peakMs = openMs;         // 以价格相对入场的有利/不利幅度(USDT价差)
    const closesFav = [];                                 // 每根收盘的有利幅度序列(判反转)
    for (const c of candles) {
      const favExtreme = isShort ? (entry - c.low) : (c.high - entry);   // 当根最有利
      const advExtreme = isShort ? (c.high - entry) : (entry - c.low);   // 当根最不利
      if (favExtreme > maxFav) { maxFav = favExtreme; peakMs = c.time; }
      if (advExtreme > maxAdv) maxAdv = advExtreme;
      closesFav.push((c.close - entry) * dirSign);
    }
    // 反转次数:有利幅度序列的显著摆动次数(阈值 = TP距离的15%,无TP则用入场价的0.3%)。
    const swingThresh = (tpDist || entry * 0.003) * 0.15;
    let reversals = 0, lastPivot = closesFav[0], up = null;
    for (const v of closesFav) {
      if (up === null) { if (Math.abs(v - lastPivot) >= swingThresh) { up = v > lastPivot; lastPivot = v; } continue; }
      if (up && v < lastPivot - swingThresh) { reversals += 1; up = false; lastPivot = v; }
      else if (!up && v > lastPivot + swingThresh) { reversals += 1; up = true; lastPivot = v; }
      else if (up && v > lastPivot) lastPivot = v;
      else if (!up && v < lastPivot) lastPivot = v;
    }
    const firstLegFav = closesFav.slice(0, Math.max(1, Math.round(closesFav.length * 0.2))).some((v) => v > (tpDist || entry * 0.003) * 0.1);
    const reachedTpPct = tpDist ? Math.round((maxFav / tpDist) * 100) : null;
    const maxAdvStopPct = stopDist ? Math.round((maxAdv / stopDist) * 100) : null;
    const minsToPeak = Math.round((peakMs - openMs) / 60000);
    const finalFav = (exit - entry) * dirSign;
    const gaveBackFromPeak = maxFav > 0 ? Math.round((1 - Math.max(0, finalFav) / maxFav) * 100) : null;
    const parts = [];
    parts.push(`开仓后${firstLegFav ? "先顺行" : "先逆行"}`);
    if (reachedTpPct != null) parts.push(`最高逼近止盈 ${reachedTpPct}%（约第 ${minsToPeak} 分钟见顶）`);
    if (gaveBackFromPeak != null && reachedTpPct != null && reachedTpPct >= 60) parts.push(`见顶后回吐约 ${gaveBackFromPeak}% 的浮盈`);
    if (reversals > 0) parts.push(`方向反转 ${reversals} 次`);
    if (maxAdvStopPct != null) parts.push(`最深不利到止损方向 ${maxAdvStopPct}%`);
    return { note: parts.join("；"), reachedTpPct, minsToPeak, reversals, maxAdvStopPct, gaveBackFromPeak, firstLegFav, tf, candles: candles.length };
  } catch {
    return null;
  }
}

function number(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hourBucket(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return "未知";
  const hour = date.getHours();
  return `${String(hour).padStart(2, "0")}:00-${String((hour + 1) % 24).padStart(2, "0")}:00`;
}

function inferRegime(fill = {}, market = {}) {
  if (fill.regime) return fill.regime;
  const change = number(fill.changePct ?? market.changePct, 0);
  const funding = number(fill.fundingRate ?? market.fundingRate, 0);
  if (Math.abs(change) >= 4) return "高波动趋势";
  if (Math.abs(change) <= 0.8) return "震荡低波动";
  if (Math.abs(funding) >= 0.03) return "资金费率拥挤";
  return change >= 0 ? "上行趋势" : "下行趋势";
}

function groupStats(items, keyFn) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item) || "未分类";
    const bucket = groups.get(key) || { key, trades: 0, wins: 0, losses: 0, pnl: 0, grossWin: 0, grossLoss: 0 };
    const pnl = number(item.netRealizedPnl, 0);
    bucket.trades += 1;
    bucket.pnl += pnl;
    if (pnl > 0) {
      bucket.wins += 1;
      bucket.grossWin += pnl;
    }
    if (pnl < 0) {
      bucket.losses += 1;
      bucket.grossLoss += Math.abs(pnl);
    }
    groups.set(key, bucket);
  }
  return [...groups.values()].map((item) => ({
    ...item,
    pnl: Number(item.pnl.toFixed(2)),
    winRatePct: item.trades ? Number(((item.wins / item.trades) * 100).toFixed(1)) : null,
    profitFactor: item.grossLoss > 0 ? Number((item.grossWin / item.grossLoss).toFixed(2)) : null
  })).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
}

function average(items, key) {
  const values = items.map((item) => number(item[key])).filter((item) => item !== null);
  if (!values.length) return null;
  return Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(4));
}

function buildLossClusters(closes) {
  const losses = closes.filter((fill) => number(fill.netRealizedPnl, 0) < 0);
  const clusters = [
    {
      key: "止损/风控缺失",
      matcher: (fill) => !fill.stopLoss && !fill.stopPrice && !fill.riskCheckId,
      suggestion: "强制要求入场计划绑定止损、风险检查 ID 和最大亏损金额。"
    },
    {
      key: "持仓过久",
      matcher: (fill) => number(fill.holdingMinutes, 0) >= 240,
      suggestion: "增加时间止损或趋势失效退出规则。"
    },
    {
      key: "滑点/成本侵蚀",
      matcher: (fill) => Math.abs(number(fill.slippageBps, 0)) >= 8
        || (Math.abs(number(fill.feeUsdt, 0)) + Math.abs(number(fill.entryFeeUsdt, 0))) > Math.abs(number(fill.grossRealizedPnl, 0)) * 0.25,
      suggestion: "复核订单类型、成交深度、拆单和手续费等级。"
    },
    {
      key: "逆行情 regime",
      matcher: (fill) => /下行/.test(fill.regime || "") && /long|buy|多/i.test(fill.side || fill.direction || ""),
      suggestion: "增加 regime 过滤器，避免在趋势相反时开仓。"
    }
  ];
  return clusters.map((cluster) => {
    const items = losses.filter(cluster.matcher);
    const pnl = items.reduce((sum, item) => sum + number(item.netRealizedPnl, 0), 0);
    return { key: cluster.key, count: items.length, pnl: Number(pnl.toFixed(2)), suggestion: cluster.suggestion };
  }).filter((item) => item.count > 0);
}

export function buildReviewAnalytics(db, options = {}) {
  if (Object.hasOwn(options, "ownerOnly")) throw new Error("review_analytics_explicit_principal_required");
  const principal = options.principal || null;
  if (!principal?.tenantId || !(principal.userId || principal.id)) throw new Error("review_analytics_explicit_principal_required");
  const belongs = (row) => belongsToPrincipal(row, principal);
  // ④ AI 绩效只统计可归因到 AI 计划/执行单的成交;手动/外部单(无归因)不计入 AI 战绩
  const scopedFills = (db.fills || []).filter(belongs);
  const allLifecycles = groupSystemClosedTradeLifecycles(db, { fills: scopedFills });
  const pendingFinancialReconciliation = allLifecycles.filter((row) => !isFinanciallyReconciledLifecycle(row)).length;
  const closes = allLifecycles.filter(isFinanciallyReconciledLifecycle)
    .map((lifecycle) => {
      const representative = { ...lifecycle.representative };
      delete representative.realizedPnl;
      return {
        ...representative,
        grossRealizedPnl: number(lifecycle.realizedPnl, 0),
        netRealizedPnl: number(lifecycle.netRealizedPnl),
        entryFeeUsdt: number(lifecycle.entryFeeUsdt, 0),
        feeUsdt: number(lifecycle.feeUsdt, 0),
        fundingFeeUsdt: number(lifecycle.fundingFeeUsdt, 0)
      };
    })
    .filter((fill) => fill.tradePlanId || fill.planId || fill.executionOrderId);
  const enriched = closes.map((fill) => {
    const plan = resolveTradeContext(db, fill).plan || {};
    const market = (db.markets || []).find((item) => item.symbol === (fill.symbol || plan.symbol));
    return {
      ...fill,
      strategy: fill.strategy || plan.strategy || plan.strategy_type || "manual_review",
      strategyRef: fill.strategyRef || plan.strategyRef || null,
      strategyBlueprintRef: fill.strategyBlueprintRef || plan.strategyBlueprintRef || null,
      strategyVersionKey: fill.strategyVersionId || fill.strategyRef?.versionId || plan.strategyVersionId || plan.strategyRef?.versionId || "unversioned",
      symbol: fill.symbol || plan.symbol || "未知",
      regime: inferRegime(fill, market),
      entryRationale: fill.entryRationale || plan.rationale || plan.analysis || "",
      exitReason: fill.exitReason || fill.reason || "未记录"
    };
  });
  const totalLoss = enriched.filter((fill) => number(fill.netRealizedPnl, 0) < 0).reduce((sum, fill) => sum + number(fill.netRealizedPnl, 0), 0);
  const strategy = groupStats(enriched, (fill) => fill.strategy);
  const strategyVersion = groupStats(enriched, (fill) => fill.strategyVersionKey);
  const symbol = groupStats(enriched, (fill) => fill.symbol);
  const session = groupStats(enriched, (fill) => hourBucket(fill.createdAt));
  const regime = groupStats(enriched, (fill) => fill.regime);
  const cost = {
    avgMaeUsdt: average(enriched, "maeUsdt"),
    avgMfeUsdt: average(enriched, "mfeUsdt"),
    avgSlippageBps: average(enriched, "slippageBps"),
    totalFeesUsdt: Number(enriched.reduce((sum, fill) => sum + number(fill.feeUsdt, 0) + number(fill.entryFeeUsdt, 0), 0).toFixed(2)),
    totalEntryFeesUsdt: Number(enriched.reduce((sum, fill) => sum + number(fill.entryFeeUsdt, 0), 0).toFixed(2)),
    totalCloseFeesUsdt: Number(enriched.reduce((sum, fill) => sum + number(fill.feeUsdt, 0), 0).toFixed(2)),
    totalFundingUsdt: Number(enriched.reduce((sum, fill) => sum + number(fill.fundingFeeUsdt, 0), 0).toFixed(2)),
    avgHoldingMinutes: average(enriched, "holdingMinutes")
  };
  const entryExitBias = enriched.slice(0, 12).map((fill) => ({
    id: fill.id,
    symbol: fill.symbol,
    strategy: fill.strategy,
    strategyVersionKey: fill.strategyVersionKey,
    pnl: number(fill.netRealizedPnl, 0),
    entryRationale: fill.entryRationale || "未记录入场理由",
    exitReason: fill.exitReason || "未记录出场原因",
    bias: !fill.entryRationale || fill.exitReason === "未记录" ? "缺少可验证字段" : number(fill.netRealizedPnl, 0) < 0 ? "需验证入场假设是否失效" : "入场假设暂时有效"
  }));
  const lossClusters = buildLossClusters(enriched);
  const ruleContribution = (db.riskRules || []).map((rule) => {
    const checks = (db.riskChecks || []).filter(belongs).filter((check) => JSON.stringify(check).includes(rule.id) || JSON.stringify(check).includes(rule.name));
    const blocked = checks.filter((check) => /block|reject|阻断|拒绝/i.test(String(check.decision || check.result || check.status))).length;
    return { id: rule.id, name: rule.name, checks: checks.length, blocked, contribution: blocked ? "减少坏交易暴露" : "待积累样本" };
  });
  const extensionSkillContribution = (db.skills || []).filter((skill) => skill.native === true || belongs(skill)).map((skill) => {
    const runs = (db.skillRuns || []).filter(belongs).filter((run) => run.skillId === skill.id);
    const ok = runs.filter((run) => ["ok", "completed"].includes(String(run.status).toLowerCase())).length;
    return { id: skill.id, name: skill.name, runs: runs.length, successRatePct: runs.length ? Number(((ok / runs.length) * 100).toFixed(1)) : null, contribution: runs.length ? "有运行样本" : "未验证" };
  });
  const knowledgeSkillContribution = (db.knowledge?.tradingSkills || []).filter(belongs).map((skill) => {
    const rows = (db.knowledge?.skillAttributions || []).filter(belongs)
      .filter((row) => row.skillId === skill.id && row.skillVersion === skill.version && Number.isFinite(Number(row.weightedPnl)));
    const wins = rows.filter((row) => Number(row.netRealizedPnl) > 0);
    const grossWin = rows.filter((row) => Number(row.netRealizedPnl) > 0).reduce((sum, row) => sum + Number(row.weightedPnl), 0);
    const grossLoss = Math.abs(rows.filter((row) => Number(row.netRealizedPnl) < 0).reduce((sum, row) => sum + Number(row.weightedPnl), 0));
    const weightedPnl = rows.reduce((sum, row) => sum + Number(row.weightedPnl), 0);
    return {
      id: skill.id,
      name: `${skill.name} v${skill.version}`,
      runs: rows.length,
      successRatePct: rows.length ? Number(((wins.length / rows.length) * 100).toFixed(1)) : null,
      contribution: rows.length
        ? `加权盈亏 ${Number(weightedPnl.toFixed(8))} · PF ${grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : "-"} · ${skill.status}`
        : `尚无已平仓归因样本 · ${skill.status}`
    };
  });
  const skillContribution = [...knowledgeSkillContribution, ...extensionSkillContribution];
  const validation = (db.strategyExperiments || []).filter(belongs);
  const confidence = (db.agentRuns || []).filter(belongs).slice(0, 20).map((run) => ({
    id: run.id,
    goal: run.goal,
    before: number(run.confidenceBefore),
    after: number(run.confidenceAfter),
    status: run.status,
    memoryWritten: Boolean((db.memoryItems || []).some((item) => item.sourceRunId === run.id || item.agentRunId === run.id))
  }));
  return {
    pendingFinancialReconciliation,
    financiallyReconciledTrades: enriched.length,
    generatedAt: nowIso(),
    sampleSize: enriched.length,
    breakdowns: { strategy, strategyVersion, symbol, session, regime },
    cost,
    entryExitBias,
    lossClusters,
    attribution: { rules: ruleContribution, skills: skillContribution },
    validation,
    confidence,
    summary: {
      totalLossUsdt: Number(totalLoss.toFixed(2)),
      bestSegment: strategy[0]?.key || "暂无样本",
      weakestSegment: strategy.slice().reverse()[0]?.key || "暂无样本",
      sampleNote: enriched.length ? `${enriched.length} 笔已平仓交易进入复盘` : "暂无已平仓交易，先建立交易闭环"
    }
  };
}

export function backfillReviewFields(db, options = {}) {
  const principal = options.principal || null;
  const belongs = (row) => belongsToPrincipal(row, principal);
  let updated = 0;
  const plans = db.tradePlans || [];
  for (const executionOrder of (db.executionOrders || []).filter(belongs)) {
    const plan = plans.find((item) => item.id === executionOrder.planId) || {};
    if (!executionOrder.strategy) {
      executionOrder.strategy = plan.strategy || plan.strategy_type || "manual_review";
      updated += 1;
    }
    if (!executionOrder.strategyRef && plan.strategyRef) {
      executionOrder.strategyRef = { ...plan.strategyRef };
      executionOrder.strategyProductId = plan.strategyProductId || plan.strategyRef.productId || null;
      executionOrder.strategyVersion = plan.strategyVersion || plan.strategyRef.version || null;
      executionOrder.strategyVersionId = plan.strategyVersionId || plan.strategyRef.versionId || null;
      updated += 1;
    }
    if (!executionOrder.entryRationale) {
      executionOrder.entryRationale = plan.rationale || plan.analysis || plan.reason || plan.summary || "未记录入场理由";
      updated += 1;
    }
    if (!executionOrder.regime) {
      executionOrder.regime = inferRegime({ symbol: executionOrder.symbol }, (db.markets || []).find((item) => item.symbol === executionOrder.symbol));
      updated += 1;
    }
  }
  for (const fill of (db.fills || []).filter(belongs)) {
    let { executionOrder, plan } = resolveTradeContext(db, fill);
    // 没有 executionOrderId 的旧 fill 才允许按明确的计划 ID 找执行单。
    const fillPlanId = fill.tradePlanId || fill.planId || null;
    if (!executionOrder && !fill.executionOrderId && fillPlanId) {
      executionOrder = (db.executionOrders || []).find((item) => item.planId === fillPlanId) || null;
      plan ||= executionOrder?.planId ? plans.find((item) => item.id === executionOrder.planId) || null : null;
    }
    plan ||= {};
    const market = (db.markets || []).find((item) => item.symbol === (fill.symbol || executionOrder?.symbol || plan.symbol));
    if (!fill.tradePlanId && (fill.planId || executionOrder?.planId)) {
      fill.tradePlanId = fill.planId || executionOrder.planId;
      updated += 1;
    }
    if (!fill.strategy) {
      fill.strategy = executionOrder?.strategy || plan.strategy || plan.strategy_type || "manual_review";
      updated += 1;
    }
    if (!fill.strategyRef && (executionOrder?.strategyRef || plan.strategyRef)) {
      fill.strategyRef = { ...(executionOrder?.strategyRef || plan.strategyRef) };
      fill.strategyProductId = executionOrder?.strategyProductId || plan.strategyProductId || fill.strategyRef.productId || null;
      fill.strategyVersion = executionOrder?.strategyVersion || plan.strategyVersion || fill.strategyRef.version || null;
      fill.strategyVersionId = executionOrder?.strategyVersionId || plan.strategyVersionId || fill.strategyRef.versionId || null;
      updated += 1;
    }
    if (!fill.regime) {
      fill.regime = inferRegime(fill, market);
      updated += 1;
    }
    if (!fill.entryRationale) {
      fill.entryRationale = executionOrder?.entryRationale || plan.rationale || plan.analysis || "未记录入场理由";
      updated += 1;
    }
    if (fill.feeUsdt === undefined) {
      const parsedFee = parseFeeUsdt(fill);
      const recordedNotional = number(fill.notionalUsdt);
      const price = number(fill.price);
      const quantity = number(fill.quantity ?? fill.size);
      const estimatedNotional = recordedNotional !== null
        ? Math.abs(recordedNotional)
        : (price !== null && quantity !== null ? Math.abs(price * quantity) : null);
      if (parsedFee !== null) {
        fill.feeUsdt = parsedFee;
        fill.estimatedFee = false;
        fill.feeBasis = "recorded";
      } else if (estimatedNotional !== null) {
        fill.feeUsdt = Number((estimatedNotional * 0.0004).toFixed(6));
        fill.estimatedFee = true;
        fill.feeBasis = recordedNotional !== null ? "estimated_from_notional" : "estimated_from_price_quantity";
      } else {
        fill.feeUsdt = null;
        fill.estimatedFee = false;
        fill.feeBasis = "unknown";
      }
      updated += 1;
    }
    if (fill.kind === "entry" && fill.slippageBps === undefined && executionOrder?.entryPrice) {
      fill.expectedPrice = executionOrder.entryPrice;
      fill.slippageBps = Number((((number(fill.price, executionOrder.entryPrice) - executionOrder.entryPrice) / executionOrder.entryPrice) * 10000).toFixed(2));
      updated += 1;
    }
    if (fill.kind === "close") {
      if (fill.holdingMinutes === undefined) {
        const openedAt = new Date(executionOrder?.entryFilledAt || executionOrder?.createdAt || fill.createdAt).getTime();
        const closedAt = new Date(fill.createdAt).getTime();
        fill.holdingMinutes = Number.isFinite(openedAt) && Number.isFinite(closedAt) ? Math.max(0, Math.round((closedAt - openedAt) / 60000)) : null;
        updated += 1;
      }
      if (fill.maeUsdt === undefined) {
        fill.maeUsdt = executionOrder?.maeUsdt ?? null;
        fill.mfeUsdt = executionOrder?.mfeUsdt ?? null;
        updated += 1;
      }
      if (!fill.exitReason) {
        fill.exitReason = executionOrder?.exitReason || "未记录出场原因";
        updated += 1;
      }
    }
  }
  return {
    updated,
    fills: (db.fills || []).filter(belongs).length,
    executionOrders: (db.executionOrders || []).filter(belongs).length
  };
}

function parseFeeUsdt(fill = {}) {
  if (fill.feeUsdt !== undefined && fill.feeUsdt !== null) return number(fill.feeUsdt);
  const match = String(fill.fee || "").match(/(-?\d+(?:\.\d+)?)\s*USDT/i);
  return match ? Math.abs(Number(match[1])) : null;
}

function resolveStrategyImprovementCycle(db, payload = {}, options = {}) {
  const sourceImprovement = payload.sourceImprovementId
    ? (db.ownerImprovementItems || []).find((item) => item.id === payload.sourceImprovementId && isOwnerReviewRow(db, item))
    : null;
  if (payload.sourceImprovementId && !sourceImprovement) {
    throw Object.assign(new Error("owner_improvement_not_found"), { status: 404, code: "owner_improvement_not_found" });
  }
  if (sourceImprovement && sourceImprovement.destination !== "strategy") {
    throw Object.assign(new Error("strategy_improvement_required"), { status: 409, code: "strategy_improvement_required" });
  }
  const attempts = payload.sourceImprovementId
    ? (db.strategyExperiments || []).filter((item) => item.sourceImprovementId === payload.sourceImprovementId && isOwnerReviewRow(db, item))
    : [];
  const existing = attempts.find((item) => !["failed", "ineffective", "superseded"].includes(String(item.status || "").toLowerCase()));
  if (existing && options.ignoreExisting !== true) return { sourceImprovement, attempts, existing };
  const requestedRef = payload.strategyRef || null;
  const productId = requestedRef?.productId || sourceImprovement?.scope?.strategyProductId || null;
  const scopedBaselineId = sourceImprovement?.scope?.strategyProductVersionId || sourceImprovement?.scope?.nativeStrategyVersionId || sourceImprovement?.scope?.strategyVersionId || null;
  const scopedVersionId = requestedRef?.versionId
    || ((db.strategyVersions || []).some((row) => row.id === scopedBaselineId) ? scopedBaselineId : null);
  const activeDeployments = (db.strategyDeployments || []).filter((row) => row.productId === productId
    && ["validated_active", "owner_live_observation"].includes(String(row.state || "")))
    .sort((left, right) => {
      const delta = new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0);
      return delta || String(right.versionId || "").localeCompare(String(left.versionId || ""));
    });
  if (!scopedVersionId && activeDeployments.length > 1) {
    const firstAt = new Date(activeDeployments[0].updatedAt || activeDeployments[0].createdAt || 0).getTime();
    const secondAt = new Date(activeDeployments[1].updatedAt || activeDeployments[1].createdAt || 0).getTime();
    if (firstAt === secondAt && activeDeployments[0].versionId !== activeDeployments[1].versionId) {
      throw Object.assign(new Error("strategy_baseline_deployment_ambiguous"), { status: 409, code: "strategy_baseline_deployment_ambiguous" });
    }
  }
  const deploymentVersionId = activeDeployments[0]?.versionId || null;
  const productVersions = (db.strategyVersions || []).filter((row) => row.productId === productId);
  if (!scopedVersionId && !deploymentVersionId && productVersions.length > 1) {
    throw Object.assign(new Error("strategy_baseline_version_ambiguous"), { status: 409, code: "strategy_baseline_version_ambiguous" });
  }
  const baselineVersionId = scopedVersionId || deploymentVersionId || productVersions[0]?.id || null;
  const baseline = (db.strategyVersions || []).find((row) => row.id === baselineVersionId);
  if (!baseline || !productId || baseline.productId !== productId) {
    throw Object.assign(new Error("strategy_baseline_version_not_found"), { status: 409, code: "strategy_baseline_version_not_found" });
  }
  if (requestedRef?.definitionHash && requestedRef.definitionHash !== baseline.contentHash) {
    throw Object.assign(new Error("strategy_baseline_hash_mismatch"), { status: 409, code: "strategy_baseline_hash_mismatch" });
  }
  return { sourceImprovement, attempts, existing: null, baseline };
}

// Pure preflight for routes that need to guarantee that a rejected Owner action
// has no state, audit or trace side effects. It deliberately does not run legacy
// migrations or create records.
export function validateStrategyImprovementCycle(db, payload = {}) {
  return resolveStrategyImprovementCycle(db, payload, { ignoreExisting: true });
}

export function createStrategyImprovementCycle(db, payload = {}, options = {}) {
  db.strategyExperiments ||= [];
  migrateLegacyOwnerReviewProvenance(db);
  const resolved = resolveStrategyImprovementCycle(db, payload);
  if (resolved.existing) {
    const review = (db.reviews || []).find((item) => item.experimentId === resolved.existing.id) || null;
    return { message: "该 Owner 优化项已有进行中的验证实验", review, experiment: resolved.existing, analytics: buildReviewAnalytics(db, { principal: { tenantId: db.user?.tenantId, userId: db.user?.id, isOwner: true } }), reused: true };
  }
  const { sourceImprovement, attempts, baseline } = resolved;
  const analytics = buildReviewAnalytics(db, { principal: { tenantId: db.user?.tenantId, userId: db.user?.id, isOwner: true } });
  const weakest = analytics.lossClusters[0] || analytics.breakdowns.strategy.slice().sort((a, b) => a.pnl - b.pnl)[0];
  const hypothesis = payload.hypothesis || (weakest
    ? `针对「${weakest.key}」降低亏损暴露，并验证胜率/盈亏比是否改善。`
    : "建立第一轮策略验证样本，确认策略是否具备正期望。");
  const experiment = {
    id: id("experiment"),
    status: "draft",
    hypothesis,
    sourceReviewId: payload.reviewId || null,
    sourceReviewIds: [...new Set([...(payload.sourceReviewIds || []), payload.reviewId].filter(Boolean))],
    sourceImprovementId: payload.sourceImprovementId || null,
    attemptNumber: Math.max(0, ...attempts.map((item) => Number(item.attemptNumber || 0))) + 1,
    previousExperimentIds: [...new Set([
      ...(sourceImprovement?.previousExperimentIds || []),
      ...attempts.map((item) => item.id)
    ].filter(Boolean))],
    tenantId: db.user?.tenantId || "tenant_owner",
    ownerUserId: db.user?.id || null,
    strategyRef: {
      type: "native_strategy_product",
      productId: baseline.productId,
      versionId: baseline.id,
      version: baseline.version || null,
      definitionHash: baseline.contentHash
    },
    candidateStrategyRef: null,
    ownerApprovalRequired: true,
    stages: [
      { name: "backtest", label: "回测", status: "pending", metrics: ["winRatePct", "profitFactor", "maxDrawdownPct"] },
      { name: "paper", label: "模拟盘", status: "pending", metrics: ["slippageBps", "ruleBlocked", "agentConfidenceDelta"] },
      { name: "small_live", label: "小额实盘", status: "pending", metrics: ["realizedPnl", "feeUsdt", "reconcileOk"] }
    ],
    successCriteria: payload.successCriteria || {
      minTrades: 20,
      minSmallLiveTrades: 3,
      minProfitFactor: 1.2,
      maxDrawdownPct: 3,
      requireManualApproval: true
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  db.strategyExperiments.unshift(experiment);
  const review = {
    id: id("review"),
    type: "strategy_experiment",
    status: "draft",
    tenantId: experiment.tenantId,
    ownerUserId: experiment.ownerUserId,
    title: "策略改进闭环",
    summary: `${hypothesis} 已创建三段验证：回测 → 模拟盘 → 小额实盘。`,
    tags: ["策略改进", "闭环验证"],
    experimentId: experiment.id,
    analyticsSnapshot: analytics,
    createdAt: nowIso()
  };
  db.reviews ||= [];
  db.reviews.unshift(review);
  if (options.suppressAudit !== true) {
    appendAudit(db, "创建策略改进闭环", experiment.id, "ReviewEngine", "info");
    appendTrace(db, "review", "策略改进闭环", "ok");
  }
  return { message: "已创建策略改进闭环", review, experiment, analytics };
}

// LLM 深度复盘(#3/#4):让模型真正回看这笔交易——信号哪里对/错、根因、下次怎么改。
// 只对亏损与显著盈利调用(控成本),每轮上限 6 笔;LLM 不可用则返回 null,回落模板教训。
async function llmDeepReflection(fill, ctx) {
  try {
    const { llmComplete } = await import("./agentChat.mjs");
    const sys = "你是严格的加密永续交易复盘专家。只根据给定事实复盘，不编造行情。输出必须具体、可执行、直指根因，禁止空话套话。";
    const prompt = [
      `复盘这笔已平仓交易（${ctx.win ? "盈利" : "亏损"}）：`,
      `- 品种/方向/策略：${fill.symbol} ${ctx.dir}（${fill.strategy || "手动"}）`,
      `- 入场依据（当时的判断）：${ctx.rationale}`,
      `- 结果：${ctx.win ? "盈利" : "亏损"} ${ctx.pnl.toFixed(2)} USDT｜${ctx.facts.join("；")}`,
      ctx.attribution ? `- 系统初判归因：${ctx.attribution}` : "",
      ctx.trajectoryNote ? `- 持仓期间价格轨迹（真实K线回补）：${ctx.trajectoryNote}` : "",
      ctx.newsContext?.news ? `- 持仓期间真实消息面（系统已采集并核验）：${ctx.newsContext.news}（${ctx.newsContext.sentiment || "中性"}）` : "",
      "",
      ctx.win
        ? "回答三点，每点一句：①这次信号/判断【对在哪】（具体到结构/方向/时机）；②这套「策略×品种×regime」为什么奏效、可复用的关键；③结合价格轨迹判断【离场时机】是否合理（是否过早落袋、是否本可让利润奔跑），下次如何保持并放大优势。"
        : "回答三点，每点一句：①这次信号/判断【错在哪】（结合轨迹：先顺行后反转说明方向对但离场太晚/止盈太贪？先逆行说明时机太早或方向读反？把流动性扫荡当突破？）；②根因是策略/执行/市场异常哪一类，为什么；③下次遇到类似情形【具体怎么做】才能避免重犯。"
    ].filter(Boolean).join("\n");
    const out = await llmComplete(prompt, sys);
    return out ? String(out).replace(/\s+\n/g, "\n").trim().slice(0, 700) : null;
  } catch { return null; }
}

// 平仓后自动复盘：逐笔对比"入场依据/计划 vs 真实结果"，沉淀教训进长期记忆，供决策时读取。
// 幂等：处理过的成交打 reflectedAt，不重复。只把亏损+显著盈利写记忆，避免小额刷屏决策上下文。
// #3/#4：亏损与显著盈利叠加 LLM 深度复盘(为什么读对/读错)，模板作兜底。
export async function runTradeReflection(db) {
  migrateLegacyOwnerReviewProvenance(db);
  // 先把所有真实平仓补入页面可见队列；部分平仓按执行单/计划聚合为一个交易生命周期。
  syncTradeReviewQueue(db);
  const pendingLifecycles = groupSystemClosedTradeLifecycles(db, { onlyUnreflected: true }).filter(isFinanciallyReconciledLifecycle);
  const allByKey = new Map(groupSystemClosedTradeLifecycles(db).map((item) => [item.key, item]));
  const lifecycles = pendingLifecycles.map((item) => allByKey.get(item.key) || item);
  if (!lifecycles.length) return { reflected: 0, memorized: 0, lessons: [] };
  db.memoryItems ||= [];
  const lessons = [];
  let memorized = 0;
  let deepBudget = Number(process.env.REFLECTION_LLM_MAX_PER_RUN || 2); // 只为高价值异常生成叙事，每轮严格限额
  let newsBudget = Number(process.env.REFLECTION_NEWS_MAX_PER_RUN || 4); // ② 每轮消息面归因上限(Gemini,控配额)
  let trajBudget = Number(process.env.REFLECTION_TRAJ_MAX_PER_RUN || 6); // #4 每轮轨迹回补上限(K线请求,控网络)
  const minMemo = Number(process.env.REFLECTION_MIN_MEMO_USDT || 1);
  for (const lifecycle of lifecycles.slice(0, 15)) {
    if (!isFinanciallyReconciledLifecycle(lifecycle)) continue;
    const fill = lifecycle.representative;
    const review = markTradeReviewProcessing(db, lifecycle);
    const plan = resolveTradeContext(db, lifecycle).plan || {};
    // 复盘成败、摘要与学习必须使用完整生命周期净值（开/平仓费 + 资金费），
    // 不能拿交易所价格毛盈亏给用户或策略学习链路下结论。
    const pnl = Number(lifecycle.netRealizedPnl);
    const outcome = pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat";
    const win = outcome === "win";
    const loss = outcome === "loss";
    const outcomeLabel = win ? "盈利" : loss ? "亏损" : "持平";
    const ownerEligible = isOwnerReviewRow(db, fill);
    const dir = fill.direction === "short" || fill.direction === "空" ? "做空" : "做多";
    const slip = Number(fill.slippageBps);
    const facts = [`${fill.symbol} ${dir}（${fill.strategy || "手动"}）${outcomeLabel} ${pnl.toFixed(2)} USDT`];
    if (fill.regime) facts.push(`regime ${fill.regime}`);
    if (fill.holdingMinutes != null) facts.push(`持仓 ${Math.round(Number(fill.holdingMinutes))} 分钟`);
    if (Number.isFinite(slip) && Math.abs(slip) >= 15) facts.push(`滑点 ${slip.toFixed(0)}bps 偏大`);
    if (fill.exitReason) facts.push(`出场：${fill.exitReason}`);
    const rationale = fill.entryRationale || plan.rationale || plan.reasoningSummary || "未记录入场理由";
    let deep = null;
    let memoryItemId = null;
    let newsContext = null;
    let trajectory = null;
    let structuredAssessment = null;
    if (loss || (win && Math.abs(pnl) >= minMemo)) {
      const entryFill = findTradeEntryFill(db.fills || [], fill);
      const openTime = entryFill?.createdAt || plan.createdAt || fill.openedAt;
      newsContext = storedTradeWindowNews(db, fill.symbol, openTime, fill.createdAt);
      if (newsContext) fill.newsContext = newsContext;
      // 价格轨迹是确定性复盘事实，不依赖 LLM 配额；即使关闭深度文案也必须尽量回补。
      if (trajBudget > 0) {
        trajBudget -= 1;
        trajectory = await computeTradeTrajectory(db, fill, plan);
        if (trajectory) fill.trajectory = trajectory;
      }
      structuredAssessment = buildStructuredTradeAssessment(db, lifecycle, { plan, trajectory, newsContext });
    }
    structuredAssessment ||= buildStructuredTradeAssessment(db, lifecycle, { plan, trajectory, newsContext });
    const primaryRoot = structuredAssessment.rootCauses?.[0] || null;
    const attribution = primaryRoot?.label || null;
    const matrixLabel = structuredAssessment.matrix?.label || "证据不足，暂不下结论";
    const createsCandidateLesson = ownerEligible && (loss || (win && Math.abs(pnl) >= minMemo));
    const lesson = win
      ? `盈利复盘：${facts.join("；")}。过程判断为「${matrixLabel}」；入场依据「${rationale}」。${createsCandidateLesson ? "该结论先作为候选教训" : "该结论仅作为观察记录"}，不能仅凭盈利自动证明方法有效。`
      : loss ? `亏损复盘：${facts.join("；")}。过程判断为「${matrixLabel}」${attribution ? `，主要待查原因是「${attribution}」` : ""}；入场依据「${rationale}」。单笔亏损不会自动触发策略、仓位或风控修改。`
        : `持平复盘：${facts.join("；")}。过程判断为「${matrixLabel}」；入场依据「${rationale}」。净结果为 0，不归入盈利或亏损样本，也不自动生成候选教训。`;
    lessons.push({ fillId: fill.id, fillIds: lifecycle.fills.map((item) => item.id), symbol: fill.symbol, outcome, win: outcome === "flat" ? null : win, pnl: Number(pnl.toFixed(2)) });
    if (createsCandidateLesson) {
      const narrativeRoots = new Set(["model_reasoning", "strategy_regime", "entry_timing", "exit_discipline", "market_shock"]);
      const materialPnl = Math.abs(pnl) >= Number(process.env.REFLECTION_DEEP_MIN_USDT || 10);
      const needsNarrative = materialPnl || structuredAssessment.rootCauses.some((root) => narrativeRoots.has(root.code));
      // 亏损与显著盈利:调 LLM 做深度复盘,写进 fill + 记忆(模板作兜底)。
      if (deepBudget > 0 && needsNarrative) {
        // 默认复用系统已经通过 API/事件源采集的事实，不为每笔复盘重复联网。
        // 只有显式开启缺口回补且本地没有任何相关事实时，才允许一次针对性搜索。
        if (!newsContext && newsBudget > 0 && process.env.REFLECTION_ALLOW_WEB_GAP_FILL === "true") {
          const entryFill = findTradeEntryFill(db.fills || [], fill);
          const openTime = entryFill?.createdAt || plan.createdAt || fill.openedAt;
          newsBudget -= 1;
          try { newsContext = await fetchTradeWindowNews(fill.symbol, openTime, fill.createdAt); } catch { newsContext = null; }
          // 联网结果只补充叙事证据，不能反向改写已经由交易时事实生成的结构化归因。
        }
        if (newsContext) fill.newsContext = newsContext;
        deepBudget -= 1;
        deep = await llmDeepReflection(fill, { win, dir, pnl, facts, rationale, attribution, newsContext, trajectoryNote: trajectory?.note || null });
        if (deep) fill.deepReflection = deep;
      }
      const existingMemory = review?.memoryItemId ? db.memoryItems.find((item) => item.id === review.memoryItemId) : null;
      const memoryItem = existingMemory || {
        id: id("mem"),
        layer: "episodic",
        title: `复盘 ${fill.symbol} ${win ? "✓ 盈" : "✗ 亏"}`,
        tags: ["auto_reflection", fill.strategy || "manual", win ? "win" : "loss", ...(deep ? ["llm_deep"] : [])],
        source: "auto_reflection",
        fillId: fill.id,
        tenantId: fill.tenantId || null,
        ownerUserId: fill.ownerUserId || fill.createdByUserId || fill.userId || null,
        learningStatus: "candidate",
        createdAt: nowIso()
      };
      memoryItem.content = deep ? `${lesson}\n\n【深度复盘】${deep}` : lesson;
      memoryItem.fillIds = lifecycle.fills.map((item) => item.id).filter(Boolean);
      stampReviewMemoryContext(memoryItem, { fill, plan, review, lifecycle });
      if (!existingMemory) {
        memoryItem.patternKey = [
          fill.strategyProductId || plan.strategyProductId || plan.strategyRef?.productId || fill.strategy || plan.strategy || "unclassified",
          plan.timeframe || fill.timeframe || "unknown",
          fill.regime || plan.regime || "unknown",
          win ? "positive_process_candidate" : "loss_candidate"
        ].join("|");
      }
      memoryItem.updatedAt = nowIso();
      if (!existingMemory) db.memoryItems.unshift(memoryItem);
      memoryItemId = memoryItem.id;
      if (!existingMemory) memorized += 1;
    }
    if (memoryItemId) {
      const memory = db.memoryItems.find((item) => item.id === memoryItemId);
      if (memory?.learningStatus === "candidate") {
        memory.patternKey = [
          fill.strategyProductId || plan.strategyProductId || plan.strategyRef?.productId || fill.strategy || plan.strategy || "unclassified",
          plan.timeframe || fill.timeframe || "unknown",
          fill.regime || plan.regime || "unknown",
          primaryRoot?.code || (win ? "positive_process_candidate" : "unknown")
        ].join("|");
      }
    }
    const finalAttribution = primaryRoot?.label || attribution;
    if (loss && finalAttribution) fill.lossAttribution = finalAttribution;
    completeTradeReview(review, lifecycle, {
      summary: `${fill.symbol} ${dir}${outcomeLabel} ${pnl.toFixed(2)} USDT，自动复盘已完成。`,
      lesson: deep ? `${lesson}\n\n【深度复盘】${deep}` : lesson,
      deepReflection: deep,
      memoryItemId,
      attribution: finalAttribution
    });
    review.structuredAssessment = structuredAssessment;
    review.lessonCandidateId = memoryItemId;
    const strategyBlueprint = resolveAuthoritativeTradeStrategyRef(db, lifecycle);
    review.improvementScope = {
      strategyProductId: strategyBlueprint.ok ? strategyBlueprint.ref.productId : (fill.strategyProductId || plan.strategyProductId || plan.strategyRef?.productId || null),
      strategyVersionId: strategyBlueprint.ok ? strategyBlueprint.ref.versionId : null,
      strategyDefinitionHash: strategyBlueprint.ok ? strategyBlueprint.ref.contentHash : null,
      strategyProductVersionId: plan.strategyRef?.versionId || plan.strategyVersionId || null,
      timeframe: plan.timeframe || fill.timeframe || null,
      regime: fill.regime || plan.regime || null
    };
    // 完整落库后才标记已处理。若中途抛出异常，下轮仍能重试，不会出现“成交已 reflected、复盘却永久 processing”。
    const reflectedAt = nowIso();
    for (const closeFill of lifecycle.fills) {
      const rawFill = (db.fills || []).find((item) => item?.id && item.id === closeFill.id);
      if (rawFill) rawFill.reflectedAt = reflectedAt;
    }
  }
  if (db.memoryItems.length > 200) db.memoryItems = db.memoryItems.slice(0, 200);
  const improvementRegistry = refreshOwnerImprovementRegistry(db);
  if (lessons.length) {
    appendAudit(db, `平仓自动复盘 ${lessons.length} 笔，沉淀 ${memorized} 条教训入记忆`, "trade_reflection", "ReflectionEngine", "info");
    appendTrace(db, "reflection", `复盘 ${lessons.length} 笔`, "ok");
  }
  return { reflected: lessons.length, memorized, lessons, improvementRegistry };
}
