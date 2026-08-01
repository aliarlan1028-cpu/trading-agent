import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pct(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(1)}%` : "暂无数据";
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
    const pnl = number(item.realizedPnl, 0);
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
  const losses = closes.filter((fill) => number(fill.realizedPnl, 0) < 0);
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
      matcher: (fill) => Math.abs(number(fill.slippageBps, 0)) >= 8 || Math.abs(number(fill.feeUsdt, 0)) > Math.abs(number(fill.realizedPnl, 0)) * 0.25,
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
    const pnl = items.reduce((sum, item) => sum + number(item.realizedPnl, 0), 0);
    return { key: cluster.key, count: items.length, pnl: Number(pnl.toFixed(2)), suggestion: cluster.suggestion };
  }).filter((item) => item.count > 0);
}

export function buildReviewAnalytics(db) {
  // ④ AI 绩效只统计可归因到 AI 计划/执行单的成交;手动/外部单(无归因)不计入 AI 战绩
  const closes = (db.fills || []).filter((fill) => fill.kind === "close" && Number.isFinite(Number(fill.realizedPnl)) && (fill.tradePlanId || fill.planId || fill.executionOrderId));
  const enriched = closes.map((fill) => {
    const plan = (db.tradePlans || []).find((item) => item.id === fill.tradePlanId || item.id === fill.planId) || {};
    const market = (db.markets || []).find((item) => item.symbol === (fill.symbol || plan.symbol));
    return {
      ...fill,
      strategy: fill.strategy || plan.strategy || plan.strategy_type || "manual_review",
      symbol: fill.symbol || plan.symbol || "未知",
      regime: inferRegime(fill, market),
      entryRationale: fill.entryRationale || plan.rationale || plan.analysis || "",
      exitReason: fill.exitReason || fill.reason || "未记录"
    };
  });
  const totalLoss = enriched.filter((fill) => number(fill.realizedPnl, 0) < 0).reduce((sum, fill) => sum + number(fill.realizedPnl, 0), 0);
  const strategy = groupStats(enriched, (fill) => fill.strategy);
  const symbol = groupStats(enriched, (fill) => fill.symbol);
  const session = groupStats(enriched, (fill) => hourBucket(fill.createdAt));
  const regime = groupStats(enriched, (fill) => fill.regime);
  const cost = {
    avgMaeUsdt: average(enriched, "maeUsdt"),
    avgMfeUsdt: average(enriched, "mfeUsdt"),
    avgSlippageBps: average(enriched, "slippageBps"),
    totalFeesUsdt: Number(enriched.reduce((sum, fill) => sum + number(fill.feeUsdt, 0), 0).toFixed(2)),
    totalFundingUsdt: Number(enriched.reduce((sum, fill) => sum + number(fill.fundingFeeUsdt, 0), 0).toFixed(2)),
    avgHoldingMinutes: average(enriched, "holdingMinutes")
  };
  const entryExitBias = enriched.slice(0, 12).map((fill) => ({
    id: fill.id,
    symbol: fill.symbol,
    strategy: fill.strategy,
    pnl: number(fill.realizedPnl, 0),
    entryRationale: fill.entryRationale || "未记录入场理由",
    exitReason: fill.exitReason || "未记录出场原因",
    bias: !fill.entryRationale || fill.exitReason === "未记录" ? "缺少可验证字段" : number(fill.realizedPnl, 0) < 0 ? "需验证入场假设是否失效" : "入场假设暂时有效"
  }));
  const lossClusters = buildLossClusters(enriched);
  const ruleContribution = (db.riskRules || []).map((rule) => {
    const checks = (db.riskChecks || []).filter((check) => JSON.stringify(check).includes(rule.id) || JSON.stringify(check).includes(rule.name));
    const blocked = checks.filter((check) => /block|reject|阻断|拒绝/i.test(String(check.decision || check.result || check.status))).length;
    return { id: rule.id, name: rule.name, checks: checks.length, blocked, contribution: blocked ? "减少坏交易暴露" : "待积累样本" };
  });
  const extensionSkillContribution = (db.skills || []).map((skill) => {
    const runs = (db.skillRuns || []).filter((run) => run.skillId === skill.id);
    const ok = runs.filter((run) => ["ok", "completed"].includes(String(run.status).toLowerCase())).length;
    return { id: skill.id, name: skill.name, runs: runs.length, successRatePct: runs.length ? Number(((ok / runs.length) * 100).toFixed(1)) : null, contribution: runs.length ? "有运行样本" : "未验证" };
  });
  const knowledgeSkillContribution = (db.knowledge?.tradingSkills || []).map((skill) => {
    const metrics = skill.liveMetrics || {};
    return {
      id: skill.id,
      name: `${skill.name} v${skill.version}`,
      runs: Number(metrics.trades || 0),
      successRatePct: metrics.winRatePct ?? null,
      contribution: metrics.trades
        ? `加权盈亏 ${metrics.weightedPnl ?? 0} · PF ${metrics.profitFactor ?? "-"} · ${skill.status}`
        : `尚无已平仓归因样本 · ${skill.status}`
    };
  });
  const skillContribution = [...knowledgeSkillContribution, ...extensionSkillContribution];
  const validation = db.strategyExperiments || [];
  const confidence = (db.agentRuns || []).slice(0, 20).map((run) => ({
    id: run.id,
    goal: run.goal,
    before: number(run.confidenceBefore),
    after: number(run.confidenceAfter),
    status: run.status,
    memoryWritten: Boolean((db.memoryItems || []).some((item) => item.sourceRunId === run.id || item.agentRunId === run.id))
  }));
  return {
    generatedAt: nowIso(),
    sampleSize: enriched.length,
    breakdowns: { strategy, symbol, session, regime },
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

export function backfillReviewFields(db) {
  let updated = 0;
  const plans = db.tradePlans || [];
  for (const executionOrder of db.executionOrders || []) {
    const plan = plans.find((item) => item.id === executionOrder.planId) || {};
    if (!executionOrder.strategy) {
      executionOrder.strategy = plan.strategy || plan.strategy_type || "manual_review";
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
  for (const fill of db.fills || []) {
    const executionOrder = (db.executionOrders || []).find((item) => item.id === fill.executionOrderId || item.planId === fill.planId);
    const plan = plans.find((item) => item.id === fill.tradePlanId || item.id === fill.planId || item.id === executionOrder?.planId) || {};
    const market = (db.markets || []).find((item) => item.symbol === (fill.symbol || executionOrder?.symbol || plan.symbol));
    if (!fill.tradePlanId && (fill.planId || executionOrder?.planId)) {
      fill.tradePlanId = fill.planId || executionOrder.planId;
      updated += 1;
    }
    if (!fill.strategy) {
      fill.strategy = executionOrder?.strategy || plan.strategy || plan.strategy_type || "manual_review";
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
      fill.feeUsdt = parsedFee ?? Number((Math.abs(number(fill.notionalUsdt, number(fill.price, 0) * number(fill.quantity || fill.size, 0))) * 0.0004).toFixed(6));
      fill.estimatedFee = parsedFee === null;
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
  return { updated, fills: (db.fills || []).length, executionOrders: (db.executionOrders || []).length };
}

function parseFeeUsdt(fill = {}) {
  if (fill.feeUsdt !== undefined && fill.feeUsdt !== null) return number(fill.feeUsdt);
  const match = String(fill.fee || "").match(/(-?\d+(?:\.\d+)?)\s*USDT/i);
  return match ? Math.abs(Number(match[1])) : null;
}

export function createStrategyImprovementCycle(db, payload = {}) {
  const analytics = buildReviewAnalytics(db);
  const weakest = analytics.lossClusters[0] || analytics.breakdowns.strategy.slice().sort((a, b) => a.pnl - b.pnl)[0];
  const hypothesis = payload.hypothesis || (weakest
    ? `针对「${weakest.key}」降低亏损暴露，并验证胜率/盈亏比是否改善。`
    : "建立第一轮策略验证样本，确认策略是否具备正期望。");
  const experiment = {
    id: id("experiment"),
    status: "draft",
    hypothesis,
    sourceReviewId: payload.reviewId || null,
    stages: [
      { name: "backtest", label: "回测", status: "pending", metrics: ["winRatePct", "profitFactor", "maxDrawdownPct"] },
      { name: "paper", label: "模拟盘", status: "pending", metrics: ["slippageBps", "ruleBlocked", "agentConfidenceDelta"] },
      { name: "small_live", label: "小额实盘", status: "pending", metrics: ["realizedPnl", "feeUsdt", "reconcileOk"] }
    ],
    successCriteria: payload.successCriteria || {
      minTrades: 20,
      minProfitFactor: 1.2,
      maxDrawdownPct: 3,
      requireManualApproval: true
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  db.strategyExperiments ||= [];
  db.strategyExperiments.unshift(experiment);
  const review = {
    id: id("review"),
    title: "策略改进闭环",
    summary: `${hypothesis} 已创建三段验证：回测 → 模拟盘 → 小额实盘。`,
    tags: ["策略改进", "闭环验证"],
    experimentId: experiment.id,
    analyticsSnapshot: analytics,
    createdAt: nowIso()
  };
  db.reviews ||= [];
  db.reviews.unshift(review);
  appendAudit(db, "创建策略改进闭环", experiment.id, "ReviewEngine", "info");
  appendTrace(db, "review", "策略改进闭环", "ok");
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
      "",
      ctx.win
        ? "回答三点，每点一句：①这次信号/判断【对在哪】（具体到结构/方向/时机）；②这套「策略×品种×regime」为什么奏效、可复用的关键；③下次同类情形如何保持并放大优势。"
        : "回答三点，每点一句：①这次信号/判断【错在哪】（具体到：是不是把流动性扫荡当成了突破？方向读反？时机太早？止损太紧？）；②根因是策略/执行/市场异常哪一类，为什么；③下次遇到类似情形【具体怎么做】才能避免重犯。"
    ].filter(Boolean).join("\n");
    const out = await llmComplete(prompt, sys);
    return out ? String(out).replace(/\s+\n/g, "\n").trim().slice(0, 700) : null;
  } catch { return null; }
}

// 平仓后自动复盘：逐笔对比"入场依据/计划 vs 真实结果"，沉淀教训进长期记忆，供决策时读取。
// 幂等：处理过的成交打 reflectedAt，不重复。只把亏损+显著盈利写记忆，避免小额刷屏决策上下文。
// #3/#4：亏损与显著盈利叠加 LLM 深度复盘(为什么读对/读错)，模板作兜底。
export async function runTradeReflection(db) {
  const closes = (db.fills || []).filter((f) => f.kind === "close" && Number.isFinite(Number(f.realizedPnl)) && !f.reflectedAt);
  if (!closes.length) return { reflected: 0, memorized: 0, lessons: [] };
  db.memoryItems ||= [];
  const lessons = [];
  let memorized = 0;
  let deepBudget = Number(process.env.REFLECTION_LLM_MAX_PER_RUN || 6); // 每轮 LLM 深度复盘上限,控成本
  const minMemo = Number(process.env.REFLECTION_MIN_MEMO_USDT || 1);
  for (const fill of closes.slice(0, 15)) {
    const plan = (db.tradePlans || []).find((p) => p.id === fill.planId) || {};
    const pnl = Number(fill.realizedPnl);
    const win = pnl > 0;
    const dir = fill.direction === "short" || fill.direction === "空" ? "做空" : "做多";
    const slip = Number(fill.slippageBps);
    const facts = [`${fill.symbol} ${dir}（${fill.strategy || "手动"}）${win ? "盈利" : "亏损"} ${pnl.toFixed(2)} USDT`];
    if (fill.regime) facts.push(`regime ${fill.regime}`);
    if (fill.holdingMinutes != null) facts.push(`持仓 ${Math.round(Number(fill.holdingMinutes))} 分钟`);
    if (Number.isFinite(slip) && Math.abs(slip) >= 15) facts.push(`滑点 ${slip.toFixed(0)}bps 偏大`);
    if (fill.exitReason) facts.push(`出场：${fill.exitReason}`);
    const rationale = fill.entryRationale || plan.rationale || plan.reasoningSummary || "未记录入场理由";
    // 亏损归因拆分:是"策略(setup 本身错)/执行(滑点·成交质量)/市场异常(突发消息·异常波动)"哪一类。
    // 用途:执行问题→改执行,市场异常→不苛责策略,策略问题→才降权该 setup。避免"一笔亏损就否定策略"。
    let attribution = null;
    if (!win) {
      const bigSlip = Number.isFinite(slip) && Math.abs(slip) >= 15;
      const newsShock = (db.events || []).some((e) => e.intel && e.intel.fakeRisk !== "high" && /即时|数小时/.test(e.intel.impactHorizon || "") && (e.intel.credibility || 0) >= 0.7 && (e.intel.affectedSymbols || []).some((s) => { const u = String(s).toUpperCase(); const base = String(fill.symbol).split(/[/-]/)[0].toUpperCase(); return u.includes(base) || base.includes(u); }));
      attribution = bigSlip ? "执行" : newsShock ? "市场异常" : "策略";
      fill.lossAttribution = attribution;
    }
    const attribNote = attribution ? `｜亏损归因：${attribution}（${attribution === "执行" ? "滑点/成交质量,改执行而非否定 setup" : attribution === "市场异常" ? "突发消息/异常波动,非策略之过" : "setup 未兑现,考虑降权该组合"}）` : "";
    const lesson = win
      ? `盈利复盘：${facts.join("；")}。入场依据「${rationale}」本次兑现——该「策略×品种×regime」组合在相似条件下可保持。`
      : `亏损复盘：${facts.join("；")}${attribNote}。入场依据「${rationale}」未兑现${Number.isFinite(slip) && Math.abs(slip) >= 15 ? "，且滑点偏大侵蚀收益" : ""}。后续同类信号需更严格确认（多周期/聪明钱一致）或减小仓位。`;
    fill.reflectedAt = nowIso();
    lessons.push({ fillId: fill.id, symbol: fill.symbol, win, pnl: Number(pnl.toFixed(2)) });
    if (!win || Math.abs(pnl) >= minMemo) {
      // 亏损与显著盈利:调 LLM 做深度复盘,写进 fill + 记忆(模板作兜底)。
      let deep = null;
      if (deepBudget > 0) {
        deep = await llmDeepReflection(fill, { win, dir, pnl, facts, rationale, attribution });
        if (deep) { deepBudget -= 1; fill.deepReflection = deep; }
      }
      db.memoryItems.unshift({
        id: id("mem"),
        layer: "episodic",
        title: `复盘 ${fill.symbol} ${win ? "✓ 盈" : "✗ 亏"}`,
        content: deep ? `${lesson}\n\n【深度复盘】${deep}` : lesson,
        tags: ["auto_reflection", fill.strategy || "manual", win ? "win" : "loss", ...(deep ? ["llm_deep"] : [])],
        source: "auto_reflection",
        fillId: fill.id,
        createdAt: nowIso()
      });
      memorized += 1;
    }
  }
  if (db.memoryItems.length > 200) db.memoryItems = db.memoryItems.slice(0, 200);
  if (lessons.length) {
    appendAudit(db, `平仓自动复盘 ${lessons.length} 笔，沉淀 ${memorized} 条教训入记忆`, "trade_reflection", "ReflectionEngine", "info");
    appendTrace(db, "reflection", `复盘 ${lessons.length} 笔`, "ok");
  }
  return { reflected: lessons.length, memorized, lessons };
}
