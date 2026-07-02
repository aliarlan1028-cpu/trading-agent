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

  add("授权状态", ["running", "active"].includes(mandate.status), `当前状态：${mandate.status}`);
  add("交易对范围", mandate.allowedSymbols.includes(plan.symbol), `${plan.symbol} 必须在白名单内`);
  add("市场类型", mandate.marketTypes.includes(plan.marketType), `${plan.marketType} 必须在授权市场类型内`);
  add("策略范围", mandate.strategies.includes(plan.strategy), `${plan.strategy} 必须在策略 allowlist 内`);
  add("授权有效期", new Date(mandate.validUntil).getTime() > Date.now(), `有效期至 ${mandate.validUntil}`);

  const maxLeverage = mandate.maxLeverageBySymbol[plan.symbol] ?? 1;
  add("杠杆上限", Number(plan.leverage) <= maxLeverage, `计划 ${plan.leverage}x，上限 ${maxLeverage}x`);
  add("止损存在", Boolean(plan.stopLoss), "自主交易计划必须带止损");

  const riskPercent = Number(plan.entry?.riskPercent ?? plan.entry?.risk_percent ?? 999);
  add("单笔风险", riskPercent <= mandate.maxSingleTradeRiskPct, `计划 ${riskPercent}%，上限 ${mandate.maxSingleTradeRiskPct}%`);
  const remainingDailyLossUsdt = db.system.remainingDailyLossUsdt ?? db.portfolio.remainingDailyLossUsdt ?? null;
  if (remainingDailyLossUsdt === null || remainingDailyLossUsdt === undefined) {
    add("日亏损额度", false, "账户未同步，无法计算真实日亏损预算；实盘执行前必须完成私有账户同步", "warn");
  } else {
    add("日亏损额度", remainingDailyLossUsdt > 0, `今日剩余可亏损额度 ${remainingDailyLossUsdt} USDT`);
  }
  add("系统熔断", !db.system.killSwitch, db.system.killSwitch ? "一键熔断已开启" : "未熔断");

  const highImpactEvent = db.events.find((event) => event.impact >= 90 && event.relatedSymbols?.includes(plan.symbol));
  if (highImpactEvent) {
    add("事件风险", plan.leverage <= Math.max(2, Math.floor(maxLeverage / 2)), `${highImpactEvent.title} 影响分 ${highImpactEvent.impact}，高杠杆新仓受限`, "warn");
  } else {
    add("事件风险", true, "未发现阻断级事件");
  }

  // 组合相关性/集中度：主流币高度相关，同向叠加等于放大单一风险。
  const concentration = evaluateConcentration(db, plan, mandate);
  add("组合相关性", concentration.passed, concentration.detail, concentration.passed ? "ok" : "warn");

  return summarize(checks);
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
  const openPositions = (db.positions || []).filter((position) => group.includes(position.symbol) && planDirection(position) === planDir);
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
    summary: blockers.length > 0 ? `拒绝：${blockers.map((item) => item.name).join("、")}` : warnings.length > 0 ? `通过但需关注：${warnings.map((item) => item.name).join("、")}` : "全部风控检查通过"
  };
}
