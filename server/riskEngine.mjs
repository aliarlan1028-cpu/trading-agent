import { dedupePositions } from "./accounting.mjs";
import { validatePlanKnowledgeSkills } from "./knowledgeSkills.mjs";
import { evaluateDynamicRiskRules } from "./dynamicRiskRules.mjs";
import { isEventRiskActive } from "./eventRisk.mjs";

export function evaluateTradePlan(db, plan) {
  const mandate = db.mandates.find((item) => item.id === plan.mandateId);
  const checks = [];

  function add(name, passed, detail, severity = passed ? "ok" : "block") {
    checks.push({ name, passed, detail, severity });
  }

  if (!mandate) {
    add("授权委托", false, "未找到可用 Mandate");
    return summarize(checks);
  }
  add(
    "授权版本",
    Number(plan.mandateVersion || 1) === Number(mandate.version || 1),
    `计划绑定 v${plan.mandateVersion || 1}，当前授权 v${mandate.version || 1}`
  );

  const allowedSymbols = arrayValue(mandate.allowedSymbols, mandate.symbol_whitelist);
  const marketTypes = arrayValue(mandate.marketTypes, mandate.market_scope);
  const strategies = arrayValue(mandate.strategies, mandate.strategy_scope);
  const validUntil = mandate.validUntil || mandate.valid_until;
  const marketType = plan.marketType || plan.market_type;
  const strategy = plan.strategy || plan.strategy_type || "manual_review";

  add("授权状态", ["running", "active"].includes(mandate.status), `当前状态：${mandate.status}`);
  add("交易对范围", allowedSymbols.length > 0 && allowedSymbols.includes(plan.symbol), `${plan.symbol} 必须在白名单内`);
  add("市场类型", marketTypes.length > 0 && marketTypes.includes(marketType), `${marketType} 必须在授权市场类型内`);
  add("策略范围", strategies.length > 0 && strategies.includes(strategy), `${strategy} 必须在策略 allowlist 内`);
  add("授权有效期", validUntil && new Date(validUntil).getTime() > Date.now(), `有效期至 ${validUntil || "未设置"}`);

  // 计划新鲜度(用户实锤:ADA 计划入场 0.193 挂到现价 0.1647——现价已跌穿止损,
  // 批准会立即以市价成交且止损在成交价错误一侧,一开仓即触发止损)。
  {
    const market = (db.markets || []).find((m) => m.symbol === plan.symbol);
    const price = Number(market?.price);
    const entryLow = Number(plan.entry_range?.[0]);
    const entryHigh = Number(plan.entry_range?.[1] ?? entryLow);
    const stop = Number(plan.stopLoss ?? plan.stop_loss);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(stop)) {
      const isShort = String(plan.direction).toLowerCase() === "short";
      const stopIntact = isShort ? price < stop : price > stop;
      add("现价在止损安全侧", stopIntact, stopIntact ? `现价 ${price} 在止损 ${stop} 的安全侧` : `现价 ${price} 已越过止损 ${stop}——计划已失效,批准会一开仓即触发止损`);
      if (Number.isFinite(entryLow) && entryLow > 0) {
        const mid = (entryLow + entryHigh) / 2;
        const devPct = Math.abs(mid - price) / price * 100;
        add("入场区间贴近现价", devPct <= 8, `入场中值 ${mid} 偏离现价 ${devPct.toFixed(1)}%（>8% 视为陈旧计划,须重新生成）`);
      }
    }
  }

  const maxLeverageBySymbol = mandate.maxLeverageBySymbol || {};
  const maxLeverage = Number(maxLeverageBySymbol[plan.symbol] ?? mandate.maxLeverage ?? mandate.max_leverage ?? 1);
  add("杠杆上限", Number(plan.leverage) <= maxLeverage, `计划 ${plan.leverage}x，上限 ${maxLeverage}x`);
  add("止损存在", Boolean(plan.stopLoss), "自主交易计划必须带止损");

  const riskPercent = Number(plan.entry?.riskPercent ?? plan.entry?.risk_percent ?? plan.max_loss_pct ?? 999);
  const maxSingleTradeRiskPct = Number(mandate.maxSingleTradeRiskPct ?? mandate.max_single_trade_risk_pct ?? 0);
  add("单笔风险", maxSingleTradeRiskPct > 0 && riskPercent <= maxSingleTradeRiskPct, `计划 ${riskPercent}%，上限 ${maxSingleTradeRiskPct || "未设置"}%`);
  const remainingDailyLossUsdt = db.system.remainingDailyLossUsdt ?? db.portfolio.remainingDailyLossUsdt ?? null;
  if (remainingDailyLossUsdt === null || remainingDailyLossUsdt === undefined) {
    add(
      "日亏损额度",
      false,
      "账户未同步，无法计算真实日亏损预算；实盘执行前必须完成私有账户同步",
      db.system.liveTradingEnabled ? "block" : "warn"
    );
  } else {
    add("日亏损额度", remainingDailyLossUsdt > 0, `今日剩余可亏损额度 ${remainingDailyLossUsdt} USDT`);
  }
  const equity = Number(db.portfolio.totalEquityUsdt);
  const margin = Number(db.portfolio.availableMarginUsdt);
  const hasAccountRiskBasis = Number.isFinite(equity) && equity > 0 && Number.isFinite(margin) && margin >= 0;
  add(
    "账户权益与保证金",
    hasAccountRiskBasis,
    hasAccountRiskBasis ? `权益 ${equity} USDT，可用保证金 ${margin} USDT` : "缺少有效权益或可用保证金，无法据实计算仓位",
    db.system.liveTradingEnabled ? "block" : "warn"
  );
  add("系统熔断", !db.system.killSwitch, db.system.killSwitch ? "一键熔断已开启" : "未熔断");
  for (const rule of evaluateDynamicRiskRules(db, plan)) {
    if (!rule.enforceable) {
      add(`动态规则：${rule.name}`, true, rule.detail, "ok");
    } else {
      add(`动态规则：${rule.name}`, !rule.blocking, rule.detail, rule.blocking ? "block" : "ok");
    }
  }
  if ((plan.knowledgeSkills || []).length) {
    const knowledgeSkills = validatePlanKnowledgeSkills(db, plan);
    add(
      "知识技能版本",
      knowledgeSkills.valid,
      knowledgeSkills.valid ? `已验证 ${plan.knowledgeSkills.length} 个 active 技能及其版本指纹` : knowledgeSkills.violations.join("；")
    );
  }

  const highImpactEvent = db.events.find((event) => isEventRiskActive(event) && event.impact >= 90 && event.relatedSymbols?.includes(plan.symbol));
  if (highImpactEvent) {
    add(
      "事件风险",
      plan.leverage <= Math.max(2, Math.floor(maxLeverage / 2)),
      `${highImpactEvent.title} 影响分 ${highImpactEvent.impact}，高杠杆新仓受限`,
      db.system.liveTradingEnabled ? "block" : "warn"
    );
  } else {
    add("事件风险", true, "未发现阻断级事件");
  }

  // 组合相关性/集中度：主流币高度相关，同向叠加等于放大单一风险。
  const concentration = evaluateConcentration(db, plan, mandate);
  add("组合相关性", concentration.passed, concentration.detail, concentration.passed ? "ok" : "warn");

  const marginUtilizationPct = equity > 0 ? ((equity - margin) / equity) * 100 : null;
  const maxMarginUtilizationPct = Number(mandate.maxMarginUtilizationPct || 70);
  add(
    "保证金压力",
    marginUtilizationPct !== null && marginUtilizationPct <= maxMarginUtilizationPct,
    marginUtilizationPct === null ? "无法计算保证金使用率" : `当前使用率 ${marginUtilizationPct.toFixed(1)}%，上限 ${maxMarginUtilizationPct}%`,
    db.system.liveTradingEnabled ? "block" : "warn"
  );

  const market = (db.markets || []).find((item) => item.symbol === plan.symbol);
  const funding = Number(market?.fundingRate);
  const maxFundingRatePct = Number(mandate.maxAbsFundingRatePct || 0.1);
  add(
    "资金费率拥挤",
    Number.isFinite(funding) && Math.abs(funding) <= maxFundingRatePct,
    Number.isFinite(funding) ? `当前 ${funding.toFixed(4)}%，绝对值上限 ${maxFundingRatePct}%` : "资金费率未同步",
    db.system.liveTradingEnabled ? "block" : "warn"
  );
  const spreadBps = Number(market?.spreadBps);
  const maxSpreadBps = Number(mandate.maxSpreadBps || 12);
  add(
    "盘口点差",
    Number.isFinite(spreadBps) && spreadBps <= maxSpreadBps,
    Number.isFinite(spreadBps) ? `当前 ${spreadBps.toFixed(2)} bps，上限 ${maxSpreadBps} bps` : "盘口点差未同步",
    db.system.liveTradingEnabled ? "block" : "warn"
  );
  const microAgeMs = market?.microSyncedAt ? Date.now() - new Date(market.microSyncedAt).getTime() : Infinity;
  const maxMicroAgeMs = Number(process.env.MAX_MICROSTRUCTURE_AGE_MS || 3 * 60_000);
  add(
    "微观结构新鲜度",
    Number.isFinite(microAgeMs) && microAgeMs <= maxMicroAgeMs,
    Number.isFinite(microAgeMs) ? `数据约 ${Math.round(microAgeMs / 1000)} 秒前` : "尚未同步微观结构",
    db.system.liveTradingEnabled ? "block" : "warn"
  );

  const entryRange = plan.entry_range || plan.entry?.range;
  const entryPrice = Array.isArray(entryRange)
    ? (Number(entryRange[0]) + Number(entryRange[1] ?? entryRange[0])) / 2
    : Number(plan.entry?.price || plan.price);
  const stopPrice = Number(plan.stopLoss || plan.stop_loss);
  const leverage = Math.max(1, Number(plan.leverage || 1));
  const maintenanceMarginFraction = Number(mandate.maintenanceMarginFraction || 0.005);
  const short = planDirection(plan) === "short";
  const estimatedLiquidation = Number.isFinite(entryPrice) && entryPrice > 0
    ? entryPrice * (short ? 1 + 1 / leverage - maintenanceMarginFraction : 1 - 1 / leverage + maintenanceMarginFraction)
    : null;
  const stopBeforeLiquidation = estimatedLiquidation !== null && Number.isFinite(stopPrice)
    && (short ? stopPrice < estimatedLiquidation : stopPrice > estimatedLiquidation);
  add(
    "强平缓冲",
    stopBeforeLiquidation,
    estimatedLiquidation === null
      ? "缺少有效入场价，无法估算强平距离"
      : `估算强平价 ${estimatedLiquidation.toFixed(4)}，止损 ${Number.isFinite(stopPrice) ? stopPrice : "未设置"}`,
    db.system.liveTradingEnabled ? "block" : "warn"
  );

  const weekPnl = db.portfolio.weekPnl === null || db.portfolio.weekPnl === undefined ? null : Number(db.portfolio.weekPnl);
  const maxWeeklyLossPct = Number(mandate.maxWeeklyLossPct || 5);
  const weeklyLossPct = equity > 0 && weekPnl !== null && Number.isFinite(weekPnl) ? Math.max(0, (-weekPnl / equity) * 100) : null;
  add(
    "周亏损熔断",
    weeklyLossPct !== null && weeklyLossPct < maxWeeklyLossPct,
    weeklyLossPct === null ? "缺少周盈亏数据" : `本周亏损 ${weeklyLossPct.toFixed(2)}%，上限 ${maxWeeklyLossPct}%`,
    db.system.liveTradingEnabled ? "block" : "warn"
  );
  const closedFills = (db.fills || [])
    .filter((fill) => fill.kind === "close" && Number.isFinite(Number(fill.realizedPnl)))
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  let lossStreak = 0;
  for (const fill of closedFills) {
    if (Number(fill.realizedPnl) < 0) lossStreak += 1;
    else break;
  }
  const maxLossStreak = Number(mandate.maxConsecutiveLosses || 4);
  add("连续亏损熔断", lossStreak < maxLossStreak, `当前连续亏损 ${lossStreak} 笔，上限 ${maxLossStreak} 笔`);

  return summarize(checks);
}

function arrayValue(primary, fallback) {
  if (Array.isArray(primary)) return primary;
  if (Array.isArray(fallback)) return fallback;
  return [];
}

// BTC/ETH/SOL/BNB 等主流币相关性高（常 >0.7）；同向叠加需要作为一个风险簇看待。
const CORRELATION_GROUPS = [
  ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "AVAX/USDT", "MATIC/USDT", "LINK/USDT"]
];

function correlationGroupOf(symbol) {
  return CORRELATION_GROUPS.find((group) => group.includes(symbol)) || [symbol];
}

function planDirection(item) {
  const dir = String(item.direction || item.side || "").toLowerCase();
  if (dir.includes("short") || item.direction === "空") return "short";
  return "long";
}

function evaluateConcentration(db, plan, mandate) {
  const group = correlationGroupOf(plan.symbol);
  const planDir = planDirection(plan);
  const openPositions = dedupePositions(db.positions).filter((position) => group.includes(position.symbol) && planDirection(position) === planDir); // 去重:同仓双记录曾使集中度双计
  const openPlans = (db.tradePlans || []).filter((item) =>
    item.id !== plan.id
    && group.includes(item.symbol)
    && planDirection(item) === planDir
    && ["approved", "executing", "awaiting_approval"].includes(item.status));
  const correlatedCount = openPositions.length + openPlans.length + 1; // 含本计划
  const maxCorrelated = Number(mandate?.maxCorrelatedPositions || 3);
  if (correlatedCount > maxCorrelated) {
    return { passed: false, detail: `已有 ${correlatedCount - 1} 个同向相关主流币仓位，再开将达 ${correlatedCount} 个（上限 ${maxCorrelated}）：相关性集中，等于放大单一 Beta 风险` };
  }
  return { passed: true, detail: correlatedCount > 1 ? `同向相关仓位 ${correlatedCount}/${maxCorrelated}，在可控范围` : "无相关性集中" };
}

function summarize(checks) {
  const blockers = checks.filter((check) => !check.passed && check.severity === "block");
  const warnings = checks.filter((check) => !check.passed && check.severity === "warn");
  return {
    id: `risk_${Date.now().toString(36)}`,
    passed: blockers.length === 0,
    decision: blockers.length > 0 ? "blocked" : warnings.length > 0 ? "allowed_with_warnings" : "allowed",
    checks,
    blockers,
    warnings,
    // 拒绝理由用 detail(具体到"现价已越过止损 X")而非 check 名——名字如"现价在止损安全侧"
    // 当拒绝时单看名字反而读不通,detail 才是给用户看的可执行原因。
    summary: blockers.length > 0 ? `拒绝：${blockers.map((item) => item.detail || item.name).join("；")}` : warnings.length > 0 ? `通过但需关注：${warnings.map((item) => item.detail || item.name).join("；")}` : "全部风控检查通过"
  };
}
