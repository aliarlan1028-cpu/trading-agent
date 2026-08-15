const ACTIONS = new Set(["open", "cancel", "amend", "close", "move_stop", "take_profit"]);
export const DEFAULT_WEEKLY_LOSS_PCT = 5;

const MANDATE_WRITE_FIELDS = new Set([
  "name", "exchanges", "marketTypes", "allowedSymbols", "symbol_whitelist", "deniedSymbols",
  "strategies", "allowedActions", "maxLeverageBySymbol", "maxLeverage", "max_leverage",
  "minLeverage", "min_leverage", "sizingMode", "positionPct", "equityPct",
  "maxSingleTradeRiskPct", "max_single_trade_risk_pct", "maxDailyLossPct", "max_daily_loss_pct",
  "maxWeeklyLossPct", "max_weekly_loss_pct", "maxOrderNotionalUsdt", "max_notional_usdt",
  "maxSymbolNotionalUsdt", "maxPortfolioNotionalUsdt", "maxConcurrentPositions",
  "maxMarginUtilizationPct", "max_margin_utilization_pct", "allowAddPosition", "allow_add_position",
  "validFrom", "valid_from", "validUntil", "valid_until", "humanApprovalNotionalUsdt",
  "manual_approval_threshold_usdt", "maxAbsFundingRatePct", "maxSpreadBps", "maintenanceMarginFraction"
]);
const MANDATE_SERVER_FIELDS = new Set([
  "id", "version", "status", "createdAt", "updatedAt", "activatedAt", "pausedAt", "revokedAt",
  "supersededAt", "supersededByMandateId", "weeklyLossSemanticMigration"
]);

export function sanitizeMandatePayload(input = {}) {
  const rejected = Object.keys(input).filter((key) => MANDATE_SERVER_FIELDS.has(key) || !MANDATE_WRITE_FIELDS.has(key));
  if (rejected.length) return { ok: false, error: "mandate_fields_not_writable", fields: rejected };
  return { ok: true, value: Object.fromEntries(Object.entries(input).filter(([key]) => MANDATE_WRITE_FIELDS.has(key))) };
}

const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

export function leverageBoundsForMandate(mandate = {}, symbol = "") {
  const normalizedSymbol = String(symbol || "").toUpperCase();
  const minimum = Number(mandate.minLeverage ?? mandate.min_leverage ?? 1);
  const maximum = Number(
    mandate.maxLeverageBySymbol?.[normalizedSymbol]
      ?? mandate.maxLeverage
      ?? mandate.max_leverage
      ?? 1
  );
  const valid = finitePositive(minimum) && finitePositive(maximum) && minimum <= maximum;
  return { valid, minimum, maximum, symbol: normalizedSymbol };
}

// Agent 的原始选择先在计划层贴合主人授权区间；所有后续定仓、保证金和强平压力
// 都只读取 applied。最终写单闸仍再次验证，防止旧计划或其他入口绕过计划层。
export function normalizePlanLeverage(mandate = {}, symbol = "", requested) {
  const bounds = leverageBoundsForMandate(mandate, symbol);
  if (!bounds.valid) return { ...bounds, requested: null, applied: null, adjusted: false, reason: "invalid_mandate_leverage_bounds" };
  const parsed = Number(requested);
  const hasRequested = Number.isFinite(parsed) && parsed > 0;
  const applied = hasRequested
    ? Math.min(bounds.maximum, Math.max(bounds.minimum, parsed))
    : bounds.minimum;
  const reason = !hasRequested
    ? "missing_defaulted_to_minimum"
    : parsed < bounds.minimum
      ? "raised_to_minimum"
      : parsed > bounds.maximum
        ? "lowered_to_maximum"
        : "within_range";
  return {
    ...bounds,
    requested: hasRequested ? parsed : null,
    applied,
    adjusted: !hasRequested || applied !== parsed,
    reason
  };
}

const MANDATE_ALIAS_PAIRS = Object.freeze([
  ["maxLeverage", "max_leverage"],
  ["minLeverage", "min_leverage"],
  ["maxSingleTradeRiskPct", "max_single_trade_risk_pct"],
  ["maxDailyLossPct", "max_daily_loss_pct"],
  ["maxWeeklyLossPct", "max_weekly_loss_pct"],
  ["maxOrderNotionalUsdt", "max_notional_usdt"],
  ["maxMarginUtilizationPct", "max_margin_utilization_pct"],
  ["allowAddPosition", "allow_add_position"],
  ["validFrom", "valid_from"],
  ["validUntil", "valid_until"]
]);

// PATCHing only one spelling must not be silently overridden by the stale alias
// already stored on the mandate. This keeps API clients and the UI on one value.
export function mergeMandatePatch(current = {}, patch = {}) {
  const synchronized = { ...patch };
  for (const [camel, snake] of MANDATE_ALIAS_PAIRS) {
    if (Object.hasOwn(patch, camel)) synchronized[snake] = patch[camel];
    else if (Object.hasOwn(patch, snake)) synchronized[camel] = patch[snake];
  }
  return { ...current, ...synchronized };
}

function boundedPolicyLimit(value, fallback) {
  return finitePositive(value) && Number(value) <= 100 ? Number(value) : fallback;
}

// These are policy ceilings, not live risk values. Defaults remain conservative;
// an existing higher-risk mandate is accepted only when production explicitly
// declares matching ceilings, so an upgrade never silently weakens the policy.
export function mandateRiskPolicyLimits(env = process.env) {
  return {
    maxSingleTradeRiskPct: boundedPolicyLimit(env.MANDATE_POLICY_MAX_SINGLE_RISK_PCT, 5),
    maxDailyLossPct: boundedPolicyLimit(env.MANDATE_POLICY_MAX_DAILY_LOSS_PCT, 10),
    maxWeeklyLossPct: boundedPolicyLimit(env.MANDATE_POLICY_MAX_WEEKLY_LOSS_PCT, 20)
  };
}

// 一次性安全迁移：旧版本曾把 maxWeeklyDrawdownPct 误当作近7日累计亏损，
// 并可能把 20 写入新字段。只要仍带冲突旧字段，就按原设计恢复保守 5%，
// 删除歧义字段并提升授权版本，使迁移前生成的待执行计划自动失效。
export function migrateLegacyWeeklyLossMandates(db) {
  db.meta ||= {};
  if (Number(db.meta.weeklyLossSemanticMigrationVersion || 0) >= 1) return { migrated: 0, mandates: [] };
  const migrated = [];
  for (const mandate of db.mandates || []) {
    const hasLegacyField = Object.hasOwn(mandate, "maxWeeklyDrawdownPct") || Object.hasOwn(mandate, "max_weekly_drawdown_pct");
    if (!hasLegacyField) continue;
    const previous = mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct ?? mandate.maxWeeklyDrawdownPct ?? mandate.max_weekly_drawdown_pct;
    mandate.maxWeeklyLossPct = DEFAULT_WEEKLY_LOSS_PCT;
    mandate.max_weekly_loss_pct = DEFAULT_WEEKLY_LOSS_PCT;
    delete mandate.maxWeeklyDrawdownPct;
    delete mandate.max_weekly_drawdown_pct;
    mandate.version = Math.max(1, Number(mandate.version || 1)) + 1;
    mandate.updatedAt = new Date().toISOString();
    mandate.weeklyLossSemanticMigration = {
      from: Number.isFinite(Number(previous)) ? Number(previous) : null,
      to: DEFAULT_WEEKLY_LOSS_PCT,
      reason: "legacy_drawdown_field_is_not_rolling_7d_loss",
      migratedAt: mandate.updatedAt
    };
    migrated.push(mandate.id || "unknown");
  }
  db.meta.weeklyLossSemanticMigrationVersion = 1;
  db.meta.weeklyLossSemanticMigratedAt = new Date().toISOString();
  return { migrated: migrated.length, mandates: migrated };
}

export function normalizeAndValidateMandate(input = {}, options = {}) {
  const errors = [];
  const riskLimits = { ...mandateRiskPolicyLimits(), ...(options.riskLimits || {}) };
  const symbols = [...new Set((input.allowedSymbols || input.symbol_whitelist || [])
    .map((symbol) => String(symbol).trim().toUpperCase())
    .filter(Boolean))];
  if (!symbols.length) errors.push("allowedSymbols 至少需要一个交易对");
  if (symbols.some((symbol) => !/^[A-Z0-9]+\/USDT$/.test(symbol))) errors.push("自主交易仅支持 XXX/USDT 交易对");

  const maxLeverage = Number(input.max_leverage ?? input.maxLeverage ?? Math.max(1, ...Object.values(input.maxLeverageBySymbol || { default: 1 }).map(Number)));
  if (!finitePositive(maxLeverage) || maxLeverage > 20) errors.push("maxLeverage 必须在 1–20 之间");
  const minLeverage = Number(input.min_leverage ?? input.minLeverage ?? 1);
  if (!finitePositive(minLeverage) || minLeverage > 20) errors.push("minLeverage 必须在 1–20 之间");
  if (finitePositive(minLeverage) && finitePositive(maxLeverage) && minLeverage > maxLeverage) errors.push("minLeverage 不能高于 maxLeverage");
  const symbolLeverages = symbols.map((symbol) => Number(input.maxLeverageBySymbol?.[symbol] ?? maxLeverage));
  if (symbolLeverages.some((value) => !finitePositive(value) || value > 20)) errors.push("各交易对杠杆上限必须在 1–20 之间");
  if (finitePositive(minLeverage) && symbolLeverages.some((value) => finitePositive(value) && value < minLeverage)) errors.push("各交易对杠杆上限不能低于最低杠杆");
  const singleRisk = Number(input.maxSingleTradeRiskPct ?? input.max_single_trade_risk_pct);
  if (!finitePositive(singleRisk) || singleRisk > riskLimits.maxSingleTradeRiskPct) errors.push(`maxSingleTradeRiskPct 必须在 0–${riskLimits.maxSingleTradeRiskPct}% 之间`);
  const dailyLoss = Number(input.maxDailyLossPct ?? input.max_daily_loss_pct);
  if (!finitePositive(dailyLoss) || dailyLoss > riskLimits.maxDailyLossPct) errors.push(`maxDailyLossPct 必须在 0–${riskLimits.maxDailyLossPct}% 之间`);
  // maxWeeklyDrawdownPct 是历史“最大回撤”字段，不等于“近7日累计亏损”。
  // 禁止把两者做别名兼容；旧授权缺少新字段时只能回到保守默认 5%。
  const weeklyLoss = Number(input.maxWeeklyLossPct ?? input.max_weekly_loss_pct ?? DEFAULT_WEEKLY_LOSS_PCT);
  if (!finitePositive(weeklyLoss) || weeklyLoss > riskLimits.maxWeeklyLossPct) errors.push(`maxWeeklyLossPct 必须在 0–${riskLimits.maxWeeklyLossPct}% 之间`);

  const defaultNotional = finitePositive(options.defaultNotionalUsdt) ? Number(options.defaultNotionalUsdt) : 50;
  const maxOrderNotional = Number(input.maxOrderNotionalUsdt ?? input.max_notional_usdt ?? defaultNotional);
  const maxSymbolNotional = Number(input.maxSymbolNotionalUsdt ?? maxOrderNotional);
  const maxPortfolioNotional = Number(input.maxPortfolioNotionalUsdt ?? maxSymbolNotional);
  if (!finitePositive(maxOrderNotional)) errors.push("maxOrderNotionalUsdt 必须大于 0");
  if (!finitePositive(maxSymbolNotional) || maxSymbolNotional < maxOrderNotional) errors.push("maxSymbolNotionalUsdt 不能小于单笔上限");
  if (!finitePositive(maxPortfolioNotional) || maxPortfolioNotional < maxSymbolNotional) errors.push("maxPortfolioNotionalUsdt 不能小于单品种上限");
  const maxConcurrentPositions = Number(input.maxConcurrentPositions ?? 3);
  if (!Number.isInteger(maxConcurrentPositions) || maxConcurrentPositions < 1 || maxConcurrentPositions > 20) errors.push("maxConcurrentPositions 必须是 1–20 的整数");
  const maxMarginUtilizationPct = Number(input.maxMarginUtilizationPct ?? input.max_margin_utilization_pct ?? 70);
  if (!finitePositive(maxMarginUtilizationPct) || maxMarginUtilizationPct > 100) errors.push("maxMarginUtilizationPct 必须在 0–100% 之间");
  const allowAddPosition = input.allowAddPosition === true || input.allow_add_position === true;

  const validFrom = input.validFrom || input.valid_from || new Date().toISOString();
  const validUntil = input.validUntil || input.valid_until;
  const fromMs = new Date(validFrom).getTime();
  const untilMs = validUntil ? new Date(validUntil).getTime() : NaN;
  if (!Number.isFinite(fromMs)) errors.push("validFrom 非法");
  if (!Number.isFinite(untilMs) || untilMs <= fromMs) errors.push("validUntil 必须晚于 validFrom");

  const allowedActions = (input.allowedActions || ["open", "cancel", "amend", "close", "move_stop", "take_profit"])
    .filter((action) => ACTIONS.has(action));
  if (!allowedActions.includes("close")) errors.push("自主 Mandate 必须允许 close，确保永远可退出");

  const normalized = {
      ...input,
      exchanges: ["OKX"],
      exchange_scope: ["OKX"],
      marketTypes: ["perpetual_usdt"],
      market_scope: ["perpetual"],
      allowedSymbols: symbols,
      symbol_whitelist: symbols,
      allowedActions,
      max_leverage: maxLeverage,
      maxLeverage,
      min_leverage: minLeverage,
      minLeverage,
      maxLeverageBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, Number(input.maxLeverageBySymbol?.[symbol] ?? maxLeverage)])),
      maxSingleTradeRiskPct: singleRisk,
      max_single_trade_risk_pct: singleRisk,
      maxDailyLossPct: dailyLoss,
      max_daily_loss_pct: dailyLoss,
      maxWeeklyLossPct: weeklyLoss,
      max_weekly_loss_pct: weeklyLoss,
      maxOrderNotionalUsdt: maxOrderNotional,
      max_notional_usdt: maxOrderNotional,
      maxSymbolNotionalUsdt: maxSymbolNotional,
      maxPortfolioNotionalUsdt: maxPortfolioNotional,
      maxConcurrentPositions,
      maxMarginUtilizationPct,
      max_margin_utilization_pct: maxMarginUtilizationPct,
      allowAddPosition,
      allow_add_position: allowAddPosition,
      validFrom: new Date(fromMs).toISOString(),
      valid_from: new Date(fromMs).toISOString(),
      validUntil: Number.isFinite(untilMs) ? new Date(untilMs).toISOString() : validUntil,
      valid_until: Number.isFinite(untilMs) ? new Date(untilMs).toISOString() : validUntil
  };
  // 即使输入来自旧库，也不要把语义冲突字段继续写回新授权。
  delete normalized.maxWeeklyDrawdownPct;
  delete normalized.max_weekly_drawdown_pct;

  return {
    valid: errors.length === 0,
    errors,
    normalized
  };
}
