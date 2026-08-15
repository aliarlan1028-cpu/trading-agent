import { dedupePositions } from "./accounting.mjs";
import { validatePlanKnowledgeSkills } from "./knowledgeSkills.mjs";
import { evaluateDynamicRiskRules } from "./dynamicRiskRules.mjs";
import { isAuthoritativeRiskEvent, isEventRiskActive } from "./eventRisk.mjs";
import { evaluateProfessionalPlanRisks } from "./professionalRiskGate.mjs";
import { evaluateProtections } from "./tradeProtections.mjs";
import { DEFAULT_WEEKLY_LOSS_PCT } from "./mandatePolicy.mjs";
import { currentRiskThresholds } from "./riskThresholds.mjs";
import { marketFactFreshness } from "./marketFreshness.mjs";

function firstTakeProfit(plan = {}) {
  const source = plan.takeProfits ?? plan.take_profits ?? plan.takeProfit ?? plan.take_profit;
  const value = Array.isArray(source) ? source[0] : source;
  const target = Number(value);
  return Number.isFinite(target) ? target : null;
}

export function minimumStopAtrForPlan(plan = {}) {
  const base = Math.max(0.5, Number(process.env.MIN_PLAN_STOP_ATR || 1.25));
  const snapshot = plan.decisionContext?.deterministicSetupSnapshot || {};
  const regime = snapshot.marketRegime || {};
  const label = String(regime.label || "").toLowerCase();
  const transition = String(regime.transition?.type || "").toLowerCase();
  const volatile = ["high_volatility", "low_liquidity"].includes(label)
    || transition === "volatility_expansion"
    || Number(regime.volatilityRatio || 0) >= 1.6;
  // 高波动扩张和低流动性下，1.25 ATR 仍常落在正常影线/滑点区。扩大到 1.5 ATR，
  // 风险金额不变，由仓位引擎同比缩小仓位，而不是放大单笔最大亏损。
  return volatile ? Math.max(base, Number(process.env.VOLATILE_MIN_PLAN_STOP_ATR || 1.5)) : base;
}

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
  // oneShotAuth：白名单外的扫描候选,由用户在计划卡上"确认下单"时一次性授权(仅本笔,不进常驻白名单)。
  // 它只放行"交易对范围"这一条正向白名单闸;deniedSymbols 显式黑名单、其余所有风控闸照常。
  // AI 自己 propose 的白名单外计划只会停在 awaiting_approval、永不自动执行——必须人工点确认才下单。
  const symbolAuthorized = (allowedSymbols.length > 0 && allowedSymbols.includes(plan.symbol)) || plan.oneShotAuth === true;
  add("交易对范围", symbolAuthorized, plan.oneShotAuth === true ? `${plan.symbol} 白名单外·用户一次性授权(仅本笔)` : `${plan.symbol} 必须在白名单内`);
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
  const minLeverage = Number(mandate.minLeverage ?? mandate.min_leverage ?? 1);
  add("杠杆上限", Number(plan.leverage) <= maxLeverage, `计划 ${plan.leverage}x，上限 ${maxLeverage}x`);
  // 用户配置的是允许区间而不是“偏好”。低杠杆本身更保守，但放行区间外计划会让
  // 前端承诺、Agent 决策与 OKX 实际仓位不一致，因此和上限一样作为授权硬边界。
  add("杠杆下限", Number(plan.leverage) >= minLeverage, `计划 ${plan.leverage}x，下限 ${minLeverage}x`);
  add("止损存在", Boolean(plan.stopLoss ?? plan.stop_loss), "自主交易计划必须带止损");

  // 新计划由确定性结构工具提供 ATR 与方向质量。把这两项落成执行硬闸，避免
  // LLM 口头说“给足缓冲”却仍把止损塞在正常噪声区，或拿 NEUTRAL/C 结构做
  // 趋势型真单。缺少旧版快照时保持兼容；所有新 Agent 计划都会携带这些字段。
  {
    const context = plan.decisionContext || {};
    const setupType = String(context.setupType || plan.scenarioType || "").toLowerCase();
    const structure = context.deterministicStructureRef;
    const directionalSetups = new Set(["trend_continuation", "trend_pullback", "breakout_retest", "breakdown_retest"]);
    if (structure && directionalSetups.has(setupType)) {
      const expectedBias = planDirection(plan) === "short" ? "SHORT" : "LONG";
      const actualBias = String(structure.bias || "").toUpperCase();
      const quality = String(structure.quality || "").toUpperCase();
      const aligned = actualBias === expectedBias && ["A", "B"].includes(quality);
      add(
        "确定性结构与计划方向",
        aligned,
        aligned
          ? `${setupType} 与 ${actualBias}/${quality} 级结构一致`
          : `${setupType} 要求 ${expectedBias} 且质量至少 B；当前为 ${actualBias || "未知"}/${quality || "未知"}，应继续观察而不是开仓`,
        aligned ? "ok" : (db.system.liveTradingEnabled ? "block" : "warn")
      );
    }

    const snapshot = context.deterministicSetupSnapshot;
    const atr14 = Number(snapshot?.referenceLevels?.atr14);
    const entryRange = plan.entry_range || [];
    const entryLow = Number(entryRange[0]);
    const entryHigh = Number(entryRange[1] ?? entryRange[0]);
    const stop = Number(plan.stopLoss ?? plan.stop_loss);
    if (Number.isFinite(atr14) && atr14 > 0 && Number.isFinite(entryLow) && Number.isFinite(entryHigh) && Number.isFinite(stop)) {
      const short = planDirection(plan) === "short";
      // 与定仓引擎保持同一口径：用计划入场中值衡量正常成交的噪声缓冲。
      // 入场边缘可能本身就是更优的贴近失效位成交，拿“最差边缘”一刀切会过度拒单。
      const entryMid = (entryLow + entryHigh) / 2;
      const stopDistance = short ? stop - entryMid : entryMid - stop;
      const stopAtr = stopDistance / atr14;
      const minimumStopAtr = minimumStopAtrForPlan(plan);
      const enough = stopDistance > 0 && stopAtr >= minimumStopAtr;
      add(
        "止损波动缓冲",
        enough,
        enough
          ? `计划入场中值至止损 ${stopAtr.toFixed(2)}×ATR14，达到 ≥${minimumStopAtr.toFixed(2)}×`
          : `仅 ${Math.max(0, stopAtr).toFixed(2)}×ATR14，低于 ${minimumStopAtr.toFixed(2)}×；止损应移到结构失效位外并等比例缩小仓位`,
        enough ? "ok" : (db.system.liveTradingEnabled ? "block" : "warn")
      );
    } else if (structure && db.system.liveTradingEnabled) {
      add(
        "止损波动证据",
        false,
        "新 Agent 计划缺少有效 ATR14/入场区间/止损快照，无法证明止损位在正常市场噪声之外",
        "block"
      );
    }
  }

  // 前端“最低盈亏比”必须是真正的硬风控，而不是只保存一个看起来生效的数字。
  // 用入场中值、止损和第一止盈确定性计算；缺失止盈同样不能通过。
  {
    const range = plan.entry_range || plan.entry?.range || [];
    const entry = Array.isArray(range) && range.length
      ? (Number(range[0]) + Number(range[1] ?? range[0])) / 2
      : Number(plan.entry?.price ?? plan.entryPrice ?? plan.price);
    const stop = Number(plan.stopLoss ?? plan.stop_loss);
    const target = firstTakeProfit(plan);
    const isShort = planDirection(plan) === "short";
    const riskDistance = Math.abs(entry - stop);
    const rewardDistance = isShort ? entry - target : target - entry;
    const rr = Number.isFinite(entry) && Number.isFinite(stop) && Number.isFinite(target) && riskDistance > 0 && rewardDistance > 0
      ? rewardDistance / riskDistance : null;
    const minimum = currentRiskThresholds().minRewardRisk;
    if (!Number.isFinite(target)) {
      // 系统允许由跟踪止损/结构退出管理的无固定止盈计划；这种计划不能伪称达到 RR，
      // 但也不能因新增配置把既有动态退出策略整体焊死。
      add("最低盈亏比", false, `未设置固定止盈，无法验证 ${minimum}R；继续受止损与动态退出管理`, "warn");
    } else {
      add("最低盈亏比", rr !== null && rr >= minimum, rr === null
        ? `止盈方向无效，无法形成正收益距离；要求 ≥ ${minimum}R`
        : `计划 ${rr.toFixed(2)}R，要求 ≥ ${minimum}R`);
    }
  }

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

  // freqtrade 式交易保护(连亏冷却 / 回撤锁仓)——只拦新开仓,实盘时为硬闸、非实盘仅提示。到期自动解除。
  const prot = evaluateProtections(db);
  if (prot.enabled) {
    const c = prot.cooldown;
    add("连亏冷却", !c.active, c.active ? `连续 ${c.streak} 笔亏损(≥${c.maxLosses}),暂停新开仓至 ${c.until}` : `尾部连亏 ${c.streak}/${c.maxLosses}，未触发`, c.active ? (db.system.liveTradingEnabled ? "block" : "warn") : "ok");
    const d = prot.drawdown;
    add("回撤锁仓", !d.active, d.active ? `回撤 ${d.drawdownPct}% ≥ 上限 ${d.maxDrawdownPct}%，暂停新开仓至 ${d.until}` : `近期成交回撤 ${d.drawdownPct ?? "—"}%（上限 ${d.maxDrawdownPct}%）`, d.active ? (db.system.liveTradingEnabled ? "block" : "warn") : "ok");
  }
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

  const blackoutMinutes = currentRiskThresholds().eventBlackoutMinutes;
  const highImpactEvent = db.events.find((event) => {
    if (!isAuthoritativeRiskEvent(event) || !isEventRiskActive(event) || Number(event.impact) < 90) return false;
    const related = !Array.isArray(event.relatedSymbols) || !event.relatedSymbols.length || event.relatedSymbols.includes(plan.symbol);
    const due = new Date(event.due || event.publishedAt).getTime();
    const delta = due - Date.now();
    const precision = String(event.timePrecision || event.time_precision || event.precision || "").toLowerCase();
    const exactTime = !["date", "day", "unknown"].includes(precision);
    // isEventRiskActive owns the post-release window (default 6h). The
    // configurable blackout threshold narrows only the pre-release side.
    return related && exactTime && Number.isFinite(delta) && delta <= blackoutMinutes * 60_000;
  });
  if (highImpactEvent) {
    const dueMs = new Date(highImpactEvent.due || highImpactEvent.publishedAt).getTime();
    const released = Number.isFinite(dueMs) && dueMs <= Date.now();
    add(
      "重大事件静默窗口",
      false,
      released
        ? `${highImpactEvent.title} 已公布但仍处事件后风险窗口，暂停所有新开仓；仅在权威事件状态已解决或后置窗口结束后重新评估`
        : `${highImpactEvent.title} 将在 ${blackoutMinutes} 分钟静默窗口内公布，暂停所有新开仓；事件落地并刷新事实后重新评估`,
      db.system.liveTradingEnabled ? "block" : "warn"
    );
  } else {
    add("重大事件静默窗口", true, `未来 ${blackoutMinutes} 分钟未发现具有精确时间的阻断级事件`);
  }

  // 组合相关性/集中度：主流币高度相关，同向叠加等于放大单一风险。
  const concentration = evaluateConcentration(db, plan, mandate);
  add("组合相关性", concentration.passed, concentration.detail, concentration.passed ? "ok" : (db.system.liveTradingEnabled && db.system.professionalRiskMode === true) ? "block" : "warn");

  const marginUtilizationPct = equity > 0 ? ((equity - margin) / equity) * 100 : null;
  const maxMarginUtilizationPct = Number(mandate.maxMarginUtilizationPct || 70);
  add(
    "保证金压力",
    marginUtilizationPct !== null && marginUtilizationPct <= maxMarginUtilizationPct,
    marginUtilizationPct === null ? "无法计算保证金使用率" : `当前使用率 ${marginUtilizationPct.toFixed(1)}%，上限 ${maxMarginUtilizationPct}%`,
    db.system.liveTradingEnabled ? "block" : "warn"
  );

  const market = (db.markets || []).find((item) => item.symbol === plan.symbol);
  const funding = strictFiniteFact(market?.fundingRate);
  const maxFundingRatePct = Number(mandate.maxAbsFundingRatePct || 0.1);
  add(
    "资金费率拥挤",
    Number.isFinite(funding) && Math.abs(funding) <= maxFundingRatePct,
    Number.isFinite(funding) ? `当前 ${funding.toFixed(4)}%，绝对值上限 ${maxFundingRatePct}%` : "资金费率未同步",
    db.system.liveTradingEnabled ? "block" : "warn"
  );
  const spreadBps = strictFiniteFact(market?.spreadBps);
  const maxSpreadBps = Number(mandate.maxSpreadBps || 12);
  add(
    "盘口点差",
    Number.isFinite(spreadBps) && spreadBps <= maxSpreadBps,
    Number.isFinite(spreadBps) ? `当前 ${spreadBps.toFixed(2)} bps，上限 ${maxSpreadBps} bps` : "盘口点差未同步",
    db.system.liveTradingEnabled ? "block" : "warn"
  );
  const marketFreshness = marketFactFreshness(market || {});
  add(
    "Ticker 价格新鲜度",
    marketFreshness.ticker.ok,
    marketFreshness.ticker.reason === "future_timestamp" ? "Ticker 时间戳异常超前" : marketFreshness.ticker.ok ? `价格事实约 ${Math.round(marketFreshness.ticker.ageMs / 1000)} 秒前` : "价格事实缺失或过期",
    db.system.liveTradingEnabled ? "block" : "warn"
  );
  const microAgeMs = marketFreshness.micro.ageMs;
  const maxMicroAgeMs = Number(process.env.MAX_MICROSTRUCTURE_AGE_MS || 3 * 60_000);
  add(
    "微观结构新鲜度",
    marketFreshness.micro.ok && Number.isFinite(microAgeMs) && microAgeMs <= maxMicroAgeMs,
    marketFreshness.micro.reason === "future_timestamp" ? "微观结构时间戳异常超前" : Number.isFinite(microAgeMs) ? `数据约 ${Math.round(microAgeMs / 1000)} 秒前` : "尚未同步微观结构",
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
  const maxWeeklyLossPct = Number(mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct ?? DEFAULT_WEEKLY_LOSS_PCT);
  const rollingStartEquity = equity > 0 && weekPnl !== null && Number.isFinite(weekPnl) ? equity - weekPnl : null;
  const weeklyLossPct = rollingStartEquity > 0 ? Math.max(0, (-weekPnl / rollingStartEquity) * 100) : null;
  add(
    "近7日亏损熔断",
    weeklyLossPct !== null && weeklyLossPct < maxWeeklyLossPct,
    weeklyLossPct === null ? "缺少近7日盈亏数据" : `近7日亏损 ${weeklyLossPct.toFixed(2)}%，上限 ${maxWeeklyLossPct}%`,
    db.system.liveTradingEnabled ? "block" : "warn"
  );
  const professional = evaluateProfessionalPlanRisks(db, plan, mandate);
  for (const check of professional.checks) add(check.name, check.passed, check.detail, check.severity);

  return { ...summarize(checks), professional };
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

// 六态统一风控裁决:把现有各闸(熔断/只减仓/硬风控/是否全自动/组合约束)收敛成单一状态,
// 供 Agent 播报、执行判定与前端统一口径使用。行为与既有闸一致,只是统一了返回。
export function riskGateDecision(db, plan) {
  if (db.system?.killSwitch) return { state: "EMERGENCY_STOP", reason: "已一键熔断，禁止一切开仓" };
  if (db.system?.reduceOnlyMode) return { state: "CLOSE_ONLY", reason: "只减仓模式，仅允许平仓/减仓/撤单" };
  const risk = evaluateTradePlan(db, plan);
  if (!risk.passed) return { state: "REJECT", reason: risk.summary, risk };
  const gray = (db.grayReleasePolicies || []).find((g) => g.enabled);
  const autoAll = db.system?.autonomyEnabled && db.system?.liveTradingEnabled && db.system?.orderWriteEnabled && gray && gray.requiresManualApproval === false;
  if (!autoAll) return { state: "REQUIRE_CONFIRMATION", reason: "非全自动：需人工批准后才可下单", risk };
  if ((risk.warnings || []).some((w) => /相关|波动预算|流动性|集中/.test(String(w.name || "") + String(w.detail || "")))) return { state: "REDUCE_SIZE", reason: "组合相关性/波动预算约束，建议缩量执行", risk };
  return { state: "ALLOW", reason: "全部风控通过，可自动执行", risk };
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
import { strictFiniteFact } from "./factValues.mjs";
