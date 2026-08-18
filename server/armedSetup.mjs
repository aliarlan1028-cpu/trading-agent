import { latestSuccessfulAccountSnapshot, activeMandate, appendAudit, appendTrace, id, listOmsOrdersForPlan, nowIso } from "./store.mjs";
import { syncMicrostructure, syncPrivateReadOnly, syncPublicKlines } from "./exchangeConnector.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { deriveAutomationState } from "./ops.mjs";
import { conditionAlreadyTrue, crossed } from "./watchSentinel.mjs";
import { createNotification } from "./notificationStore.mjs";
import { TIMEFRAME_MS } from "./ohlcvQuality.mjs";
import { ensurePlanStrategyBinding, strategyProductExecutionGate } from "./strategyProducts.mjs";
import { setReduceOnlyReason } from "./reduceOnlyState.mjs";
import { refreshOwnerImprovementRegistry } from "./ownerReviewLoop.mjs";

const ACTIVE = new Set(["ARMED", "TRIGGERED", "FAST_VALIDATING"]);
const processing = new Set();

export const ARMED_SETUP_LIMITS = Object.freeze({
  maxActive: 8,
  maxPerSymbol: 2,
  defaultTtlHours: 12,
  maxTtlHours: 48,
  maxTriggerDeviationPct: 15,
  maxTickerAgeMs: 10_000,
  maxAccountAgeMs: 30_000,
  maxRecoveryTriggerAgeMs: Number(process.env.ARMED_RECOVERY_TRIGGER_MAX_AGE_MS || 2 * 60_000)
});

const CONFIRMATION_KINDS = new Set(["rejection_wick", "engulfing", "volume_contraction", "volume_expansion", "close_above", "close_below"]);
const CONFIRMATION_TIMEFRAMES = new Set(["5m", "15m", "1h", "4h", "1d"]);
export const SCENARIO_TYPES = Object.freeze([
  "trend_pullback",
  "breakout_retest",
  "breakdown_retest",
  "reversal_reclaim",
  "fake_breakout",
  "range_rejection",
  "custom"
]);
const SCENARIO_TYPE_SET = new Set(SCENARIO_TYPES);

function finite(value) { return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)); }
function normalizeSymbol(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/-SWAP$/, "");
  if (raw.includes("/")) return raw;
  if (raw.includes("-")) return raw.replace("-", "/");
  return raw.endsWith("USDT") ? `${raw.slice(0, -4)}/USDT` : raw;
}

function confirmationTimeframe(text, fallback = "1h", signalIndex = null) {
  const source = String(text || "").toLowerCase();
  const mentions = [];
  const pattern = /(?:^|[^0-9])(5m|15m|1h|4h|1d)(?=[^a-z0-9]|$)/g;
  let matched;
  while ((matched = pattern.exec(source))) mentions.push({ timeframe: matched[1], index: matched.index + matched[0].indexOf(matched[1]) });
  if (mentions.length) {
    if (Number.isFinite(signalIndex)) {
      mentions.sort((a, b) => Math.abs(a.index - signalIndex) - Math.abs(b.index - signalIndex));
    }
    return mentions[0].timeframe;
  }
  return CONFIRMATION_TIMEFRAMES.has(String(fallback).toLowerCase()) ? String(fallback).toLowerCase() : "1h";
}

function normalizeConfirmationRule(rule = {}, context = {}) {
  const kind = String(rule.kind || "").trim();
  if (!CONFIRMATION_KINDS.has(kind)) return { valid: false, error: "confirmation_kind_invalid" };
  const timeframe = CONFIRMATION_TIMEFRAMES.has(String(rule.timeframe || "").toLowerCase())
    ? String(rule.timeframe).toLowerCase()
    : confirmationTimeframe(context.description, context.timeframe);
  const normalized = {
    kind,
    timeframe,
    direction: String(context.direction || rule.direction || "").toLowerCase(),
    level: finite(rule.level) ? Number(rule.level) : null,
    lookback: Math.min(50, Math.max(3, Number(rule.lookback) || 20)),
    threshold: finite(rule.threshold) ? Number(rule.threshold) : null
  };
  normalized.negate = rule.negate === true;
  const defaultCandleDirection = ["rejection_wick", "engulfing"].includes(kind)
    ? (normalized.direction === "short" ? "bearish" : "bullish")
    : "any";
  normalized.candleDirection = ["bullish", "bearish", "any"].includes(String(rule.candleDirection || "").toLowerCase())
    ? String(rule.candleDirection).toLowerCase()
    : defaultCandleDirection;
  if (["close_above", "close_below"].includes(kind) && (!finite(normalized.level) || normalized.level <= 0)) {
    return { valid: false, error: "confirmation_level_invalid" };
  }
  if (kind === "rejection_wick") normalized.threshold = normalized.threshold ?? 0.35;
  if (kind === "volume_contraction") normalized.threshold = normalized.threshold ?? 0.8;
  if (kind === "volume_expansion") normalized.threshold = normalized.threshold ?? 1.3;
  return { valid: true, rule: normalized };
}

export function compileConfirmationText(description, context = {}) {
  const text = String(description || "").trim();
  if (!text || /^(price[_\s-]?cross|价格穿越|仅价格|none)$/i.test(text)) return { valid: true, rules: [], mode: "all" };
  const lower = text.toLowerCase();
  const rules = [];
  const addTextRule = (kind, match, extra = {}) => {
    if (!match) return;
    const index = Number(match.index || 0);
    const local = lower.slice(Math.max(0, index - 16), Math.min(lower.length, index + String(match[0]).length + 20));
    const negate = /不出现|不得出现|未出现|避免出现|不能有|without|must\s+not|no\s+/.test(local);
    const candleDirection = /阴线|看跌|下跌|上影|bearish/.test(local) ? "bearish"
      : /阳线|看涨|上涨|下影|bullish/.test(local) ? "bullish"
      : ["rejection_wick", "engulfing"].includes(kind)
        ? (String(context.direction || "").toLowerCase() === "short" ? "bearish" : "bullish")
        : "any";
    rules.push({ kind, timeframe: confirmationTimeframe(text, context.timeframe, index), negate, candleDirection, ...extra });
  };
  const rejectionMatch = /pin\s*bar|拒绝|滞涨|滞跌|上影|下影|rejection|wick/.exec(lower);
  if (rejectionMatch) {
    const nearby = lower.slice(Math.max(0, rejectionMatch.index - 8), rejectionMatch.index + rejectionMatch[0].length + 18);
    const pct = nearby.match(/(?:≥|>=|不少于|至少)?\s*(\d+(?:\.\d+)?)\s*%/);
    const threshold = pct && Number(pct[1]) > 0 && Number(pct[1]) <= 100 ? Number(pct[1]) / 100 : 0.35;
    addTextRule("rejection_wick", rejectionMatch, { threshold });
  }
  const engulfingMatch = /吞没|反包|engulf/.exec(lower);
  if (engulfingMatch) addTextRule("engulfing", engulfingMatch);
  const contractionMatch = /量缩|缩量|成交量萎缩|volume\s*(dry|contract|shrink)/.exec(lower);
  if (contractionMatch) {
    addTextRule("volume_contraction", contractionMatch, { lookback: 20, threshold: 0.8 });
  }
  const expansionMatch = /放量|增量|成交量放大|volume\s*(expand|surge|spike)/.exec(lower);
  if (expansionMatch) {
    addTextRule("volume_expansion", expansionMatch, { lookback: 20, threshold: 1.3 });
  }
  const referenceHigh = finite(context.levelHigh) ? Number(context.levelHigh) : finite(context.level) ? Number(context.level) : null;
  const referenceLow = finite(context.levelLow) ? Number(context.levelLow) : finite(context.level) ? Number(context.level) : null;
  if (/收盘.{0,8}(上方|站上|突破)|close.{0,8}above/.test(lower) && referenceHigh) {
    rules.push({ kind: "close_above", timeframe: confirmationTimeframe(text, context.timeframe, lower.search(/收盘.{0,8}(上方|站上|突破)|close.{0,8}above/)), level: referenceHigh, negate: false, candleDirection: "any" });
  }
  if (/收盘.{0,8}(下方|跌破|失守)|close.{0,8}below/.test(lower) && referenceLow) {
    rules.push({ kind: "close_below", timeframe: confirmationTimeframe(text, context.timeframe, lower.search(/收盘.{0,8}(下方|跌破|失守)|close.{0,8}below/)), level: referenceLow, negate: false, candleDirection: "any" });
  }
  if (/假突破|false\s*break/.test(lower)) {
    const short = String(context.direction || "").toLowerCase() === "short";
    const kind = short ? "close_below" : "close_above";
    const level = short ? referenceHigh : referenceLow;
    if (level && !rules.some((rule) => rule.kind === kind && Number(rule.level) === level)) {
      rules.push({ kind, timeframe: confirmationTimeframe(text, context.timeframe, lower.search(/假突破|false\s*break/)), level, negate: false, candleDirection: "any" });
    }
  }
  if (!rules.length) return { valid: false, error: "confirmation_not_executable", description: text };
  const mode = /\/|或|任一|any|either/i.test(text) ? "any" : "all";
  return { valid: true, rules, mode };
}

function confirmationRuleSignature(rule = {}) {
  return [
    rule.kind,
    rule.timeframe,
    rule.negate === true,
    rule.candleDirection || "any",
    finite(rule.level) ? Number(rule.level) : null,
    finite(rule.threshold) ? Number(rule.threshold) : null,
    Number(rule.lookback || 20)
  ].join("|");
}

function confirmationRulesMatchText(text, context, explicitRules, explicitMode = "all") {
  if (!String(text || "").trim() || /^(price[_\s-]?cross|价格穿越|仅价格|none)$/i.test(String(text).trim())) return explicitRules.length === 0;
  const compiled = compileConfirmationText(text, context);
  if (!compiled.valid) return false;
  if (explicitRules.length > 1 && compiled.mode !== explicitMode) return false;
  const compiledSignatures = compiled.rules.map((rule) => confirmationRuleSignature(normalizeConfirmationRule(rule, context).rule)).sort();
  const explicitSignatures = explicitRules.map(confirmationRuleSignature).sort();
  return compiledSignatures.length === explicitSignatures.length
    && compiledSignatures.every((signature, index) => signature === explicitSignatures[index]);
}

export function normalizeTriggerSpec(input = {}, context = {}) {
  const kind = String(input.kind || input.triggerKind || "");
  const spec = {
    kind,
    level: finite(input.level ?? input.triggerLevel) ? Number(input.level ?? input.triggerLevel) : null,
    levelLow: finite(input.levelLow ?? input.triggerLevelLow) ? Number(input.levelLow ?? input.triggerLevelLow) : null,
    levelHigh: finite(input.levelHigh ?? input.triggerLevelHigh) ? Number(input.levelHigh ?? input.triggerLevelHigh) : null,
    confirmation: String(input.confirmation || "price_cross").slice(0, 240),
    confirmationMode: input.confirmationMode === "any" ? "any" : "all",
    confirmations: []
  };
  if (!["price_above", "price_below", "enter_zone"].includes(kind)) return { valid: false, error: "trigger_kind_invalid", spec };
  if (kind === "enter_zone") {
    if (!finite(spec.levelLow) || !finite(spec.levelHigh) || spec.levelLow <= 0 || spec.levelHigh <= spec.levelLow) {
      return { valid: false, error: "trigger_zone_invalid", spec };
    }
  } else if (!finite(spec.level) || spec.level <= 0) {
    return { valid: false, error: "trigger_level_invalid", spec };
  }
  const confirmationContext = { ...context, description: spec.confirmation, level: spec.level, levelLow: spec.levelLow, levelHigh: spec.levelHigh };
  if (Array.isArray(input.confirmations) && input.confirmations.length) {
    for (const rawRule of input.confirmations.slice(0, 4)) {
      const checked = normalizeConfirmationRule(rawRule, confirmationContext);
      if (!checked.valid) return { valid: false, error: checked.error, spec };
      spec.confirmations.push(checked.rule);
    }
    if (!confirmationRulesMatchText(spec.confirmation, confirmationContext, spec.confirmations, spec.confirmationMode)) {
      return { valid: false, error: "confirmation_rules_mismatch_text", spec };
    }
  } else {
    const compiled = compileConfirmationText(spec.confirmation, confirmationContext);
    if (!compiled.valid) return { valid: false, error: compiled.error, spec };
    spec.confirmations = compiled.rules.map((rule) => normalizeConfirmationRule(rule, confirmationContext).rule);
    spec.confirmationMode = compiled.mode;
  }
  return { valid: true, spec };
}

export function normalizeScenarioSpec(input = {}, context = {}, fallbackTrigger = null) {
  const rawType = String(input.type || input.scenarioType || context.setupType || "custom").trim().toLowerCase();
  const type = rawType === "trend_continuation" ? "trend_pullback" : rawType;
  if (!SCENARIO_TYPE_SET.has(type)) return { valid: false, error: "scenario_type_invalid" };
  const rawStages = Array.isArray(input.stages) && input.stages.length
    ? input.stages
    : fallbackTrigger ? [{ id: "entry", label: "等待入场条件", trigger: fallbackTrigger }] : [];
  if (!rawStages.length || rawStages.length > 4) return { valid: false, error: "scenario_stages_invalid" };
  const stages = [];
  for (let index = 0; index < rawStages.length; index += 1) {
    const raw = rawStages[index] || {};
    const checked = normalizeTriggerSpec(raw.trigger || raw, context);
    if (!checked.valid) return { valid: false, error: `scenario_stage_${index + 1}_${checked.error}` };
    stages.push({
      id: String(raw.id || `stage_${index + 1}`).slice(0, 48),
      label: String(raw.label || `第 ${index + 1} 阶段`).slice(0, 80),
      trigger: checked.spec
    });
  }
  let invalidation = null;
  const rawInvalidation = input.invalidation || (input.invalidationKind ? {
    kind: input.invalidationKind,
    level: input.invalidationLevel,
    levelLow: input.invalidationLevelLow,
    levelHigh: input.invalidationLevelHigh,
    confirmation: "price_cross"
  } : null);
  if (rawInvalidation) {
    const checked = normalizeTriggerSpec({ ...rawInvalidation, confirmation: "price_cross", confirmations: [] }, context);
    if (!checked.valid) return { valid: false, error: `scenario_invalidation_${checked.error}` };
    invalidation = checked.spec;
  }
  const currentStageIndex = Math.min(stages.length - 1, Math.max(0, Number(input.currentStageIndex) || 0));
  return {
    valid: true,
    scenario: {
      version: 1,
      type,
      groupId: String(input.groupId || input.scenarioGroupId || context.groupId || "").slice(0, 80) || null,
      branchId: String(input.branchId || input.scenarioBranchId || context.branchId || "primary").slice(0, 80),
      state: String(input.state || "WAITING_FOR_PRICE"),
      currentStageIndex,
      stages,
      invalidation,
      legacySingleStage: input.legacySingleStage === true,
      history: Array.isArray(input.history) ? input.history.slice(-20) : []
    }
  };
}

function currentScenarioStage(setup) {
  return setup?.scenario?.stages?.[Number(setup.scenario.currentStageIndex) || 0] || null;
}

function scenarioFinalStage(setup) {
  const stages = setup?.scenario?.stages || [];
  return stages.length <= 1 || Number(setup.scenario.currentStageIndex || 0) >= stages.length - 1;
}

function rangesOverlap(a = [], b = []) {
  const aLow = Number(a[0]); const aHigh = Number(a[1] ?? a[0]);
  const bLow = Number(b[0]); const bHigh = Number(b[1] ?? b[0]);
  return [aLow, aHigh, bLow, bHigh].every(Number.isFinite) && Math.max(aLow, bLow) <= Math.min(aHigh, bHigh);
}

function supersedeDuplicateSetups(db, plan, actor, mandate = null) {
  const singleSymbolEntry = !(mandate?.allow_add_position === true || mandate?.allowAddPosition === true);
  const duplicates = listActiveArmedSetups(db).filter((setup) => {
    if (setup.symbol !== normalizeSymbol(plan.symbol)) return false;
    if (singleSymbolEntry) return true;
    if (setup.direction !== plan.direction) return false;
    const previousPlan = (db.tradePlans || []).find((row) => row.id === setup.planId);
    return previousPlan && rangesOverlap(previousPlan.entry_range, plan.entry_range);
  });
  if (!duplicates.length) return { ok: true, superseded: [] };
  const incomingRisk = Number(plan.max_loss_pct);
  const safestExistingRisk = Math.min(...duplicates.map((setup) => {
    const previousPlan = (db.tradePlans || []).find((row) => row.id === setup.planId);
    return Number(previousPlan?.max_loss_pct);
  }).filter(Number.isFinite));
  if (!singleSymbolEntry && Number.isFinite(safestExistingRisk) && (!Number.isFinite(incomingRisk) || incomingRisk > safestExistingRisk)) {
    return { ok: false, error: "duplicate_armed_setup_higher_risk", existingRiskPct: safestExistingRisk };
  }
  const at = nowIso();
  for (const setup of duplicates) {
    setup.status = "SUPERSEDED";
    setup.closedAt = at;
    setup.updatedAt = at;
    setup.closeReason = `superseded_by:${plan.id}`;
    setup.events ||= [];
    setup.events.push({ at, event: "SUPERSEDED", detail: plan.id });
    const previousPlan = (db.tradePlans || []).find((row) => row.id === setup.planId);
    if (previousPlan?.status === "armed") {
      previousPlan.status = "cancelled";
      previousPlan.executionBlock = { reason: singleSymbolEntry ? "replaced_by_latest_symbol_plan" : "superseded_by_safer_equivalent_plan", source: "armed_setup", at };
    }
    updateOpportunityCandidate(db, setup, "SUPERSEDED", { closeReason: setup.closeReason });
    appendAudit(db, `${singleSymbolEntry ? "同币种旧计划" : "重复条件计划"}已替换：${setup.symbol} ${setup.direction}`, setup.id, actor || "AI 交易员", "warning");
  }
  return { ok: true, superseded: duplicates };
}

export function listActiveArmedSetups(db) {
  return (db.armedSetups || []).filter((setup) => ACTIVE.has(setup.status));
}

// 启动时把旧版等待计划迁移到当前可执行定义，并收敛历史重复项。
// 旧数据不能因为创建于修复前，就继续绕过 K 线确认或同时触发两次下单。
export function reconcileArmedSetupDefinitions(db) {
  const result = { normalized: [], invalidated: [], superseded: [] };
  const candidates = listActiveArmedSetups(db);
  const mandate = activeMandate(db);
  for (const setup of candidates) {
    const plan = (db.tradePlans || []).find((row) => row.id === setup.planId);
    if (!plan) {
      setup.status = "INVALIDATED";
      setup.closedAt = nowIso();
      setup.updatedAt = setup.closedAt;
      setup.closeReason = "missing_trade_plan";
      result.invalidated.push(setup);
      continue;
    }
    const symbol = normalizeSymbol(setup.symbol || plan.symbol);
    const boundMandateId = setup.mandateId || plan.mandateId;
    const boundMandateVersion = setup.mandateVersion ?? plan.mandateVersion;
    if (!mandate
      || boundMandateId !== mandate.id
      || Number(boundMandateVersion || 1) !== Number(mandate.version || 1)
      || !mandate.allowedSymbols?.includes(symbol)) {
      setup.status = "INVALIDATED";
      setup.closedAt = nowIso();
      setup.updatedAt = setup.closedAt;
      setup.closeReason = "mandate_changed";
      setup.events ||= [];
      setup.events.push({ at: setup.closedAt, event: "INVALIDATED", detail: "mandate_changed" });
      transitionPlanForTerminalSetup(db, setup, "INVALIDATED", "mandate_changed");
      updateOpportunityCandidate(db, setup, "INVALIDATED", { closeReason: "mandate_changed" });
      appendAudit(db, `等待入场计划已停用：交易权限版本或范围已变化（${symbol}）`, setup.id, "StartupMigration", "warning");
      result.invalidated.push(setup);
      continue;
    }
    setup.mandateId = boundMandateId;
    setup.mandateVersion = Number(boundMandateVersion || 1);
    const triggerNormalized = normalizeTriggerSpec(setup.trigger || {}, { direction: plan.direction, timeframe: plan.timeframe || "1h" });
    const scenarioNormalized = triggerNormalized.valid
      ? normalizeScenarioSpec(setup.scenario || { type: plan.scenarioType || plan.setupType || "custom", legacySingleStage: !setup.scenario }, { direction: plan.direction, timeframe: plan.timeframe || "1h" }, triggerNormalized.spec)
      : { valid: false, error: triggerNormalized.error };
    if (!scenarioNormalized.valid) {
      setup.status = "INVALIDATED";
      setup.closedAt = nowIso();
      setup.updatedAt = setup.closedAt;
      setup.closeReason = scenarioNormalized.error;
      setup.events ||= [];
      setup.events.push({ at: setup.closedAt, event: "INVALIDATED", detail: scenarioNormalized.error });
      transitionPlanForTerminalSetup(db, setup, "INVALIDATED", scenarioNormalized.error);
      updateOpportunityCandidate(db, setup, "INVALIDATED", { closeReason: scenarioNormalized.error });
      appendAudit(db, `旧等待计划已停用：确认条件无法可靠执行（${setup.symbol}）`, setup.id, "StartupMigration", "warning");
      result.invalidated.push(setup);
      continue;
    }
    const normalizedScenario = scenarioNormalized.scenario;
    const normalizedTrigger = normalizedScenario.stages[normalizedScenario.currentStageIndex].trigger;
    if (JSON.stringify(setup.trigger) !== JSON.stringify(normalizedTrigger) || JSON.stringify(setup.scenario) !== JSON.stringify(normalizedScenario)) {
      setup.scenario = normalizedScenario;
      setup.trigger = normalizedTrigger;
      setup.updatedAt = nowIso();
      setup.events ||= [];
      setup.events.push({ at: setup.updatedAt, event: "SCENARIO_NORMALIZED", detail: `${normalizedScenario.stages.length} stage(s)` });
      plan.armedTrigger = normalizedTrigger;
      plan.scenario = normalizedScenario;
      result.normalized.push(setup);
    }
  }

  const singleSymbolEntry = !(mandate?.allow_add_position === true || mandate?.allowAddPosition === true);
  const eligible = candidates.filter((setup) => ACTIVE.has(setup.status)).sort((a, b) => {
    if (singleSymbolEntry) return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    const pa = (db.tradePlans || []).find((row) => row.id === a.planId);
    const pb = (db.tradePlans || []).find((row) => row.id === b.planId);
    const riskDelta = Number(pa?.max_loss_pct ?? Infinity) - Number(pb?.max_loss_pct ?? Infinity);
    return riskDelta || String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
  const retained = [];
  for (const setup of eligible) {
    const plan = (db.tradePlans || []).find((row) => row.id === setup.planId);
    const duplicateOf = retained.find((kept) => {
      const keptPlan = (db.tradePlans || []).find((row) => row.id === kept.planId);
      return kept.symbol === setup.symbol && (singleSymbolEntry || (kept.direction === setup.direction && rangesOverlap(keptPlan?.entry_range, plan?.entry_range)));
    });
    if (!duplicateOf) {
      retained.push(setup);
      continue;
    }
    const at = nowIso();
    setup.status = "SUPERSEDED";
    setup.closedAt = at;
    setup.updatedAt = at;
    setup.closeReason = `duplicate_of:${duplicateOf.id}`;
    setup.events ||= [];
    setup.events.push({ at, event: "SUPERSEDED", detail: duplicateOf.id });
    if (plan?.status === "armed") {
      plan.status = "cancelled";
      plan.executionBlock = { reason: singleSymbolEntry ? "single_symbol_entry_policy" : "duplicate_waiting_entry_plan", source: "startup_reconciliation", at };
    }
    updateOpportunityCandidate(db, setup, "SUPERSEDED", { closeReason: setup.closeReason });
    appendAudit(db, `重复等待计划已停用：${setup.symbol} ${setup.direction}`, setup.id, "StartupMigration", "warning");
    result.superseded.push(setup);
  }
  return result;
}

export function armedSetupAutomationAllowed(automation, liveTradingEnabled) {
  return automation?.mode === "full_auto_small" || (!liveTradingEnabled && automation?.mode === "observe");
}

export function armTradeSetup(db, options = {}) {
  const plan = options.plan;
  if (!plan?.id) return { ok: false, error: "missing_plan" };
  // 武装不是绕过提案风控的第二入口：只接受刚通过硬风控、仍在待执行态的完整计划。
  if (plan.lastRiskCheck?.passed !== true || plan.status !== "awaiting_approval") {
    return { ok: false, error: "plan_not_risk_approved" };
  }
  const mandate = activeMandate(db);
  const symbol = normalizeSymbol(plan.symbol);
  if (!mandate || !mandate.allowedSymbols?.includes(symbol)) return { ok: false, error: "symbol_not_in_active_mandate" };
  if (plan.mandateId !== mandate.id || Number(plan.mandateVersion || 1) !== Number(mandate.version || 1)) {
    return { ok: false, error: "mandate_version_stale" };
  }
  const strategyBinding = ensurePlanStrategyBinding(db, plan, { source: "armed_setup" });
  // 新 Agent 计划不允许把“自定义场景”当作匿名策略进入自动等待；历史/API 计划仍可保留，
  // 但 agent_chat 来源必须明确钉住策略版本。
  if (!strategyBinding.ok && plan.source === "agent_chat" && !strategyBinding.legacyCompatible) return { ok: false, error: strategyBinding.error || "strategy_product_required" };
  if (strategyBinding.ok) {
    const strategyGate = strategyProductExecutionGate(db, plan);
    if (!strategyGate.allowed) return { ok: false, error: strategyGate.reason };
  }
  const triggerResult = normalizeTriggerSpec(options.trigger || {}, { direction: plan.direction, timeframe: plan.timeframe || "1h" });
  if (!triggerResult.valid) return { ok: false, error: triggerResult.error };
  const scenarioResult = normalizeScenarioSpec(options.scenario || plan.scenario || {
    type: plan.scenarioType || plan.setupType || "custom",
    groupId: `${symbol}:${plan.analysisBundleId || plan.agentRunId || plan.id}`
  }, { direction: plan.direction, timeframe: plan.timeframe || "1h" }, triggerResult.spec);
  if (!scenarioResult.valid) return { ok: false, error: scenarioResult.error };
  const scenario = scenarioResult.scenario;
  const trigger = scenario.stages[0].trigger;
  const price = Number(options.currentPrice);
  if (!finite(price) || price <= 0) return { ok: false, error: "current_price_unavailable" };
  if (conditionAlreadyTrue(trigger, price)) return { ok: false, error: "trigger_already_true" };
  if (scenario.invalidation && conditionAlreadyTrue(scenario.invalidation, price)) return { ok: false, error: "scenario_already_invalid" };

  const refLevel = trigger.kind === "enter_zone"
    ? (price > trigger.levelHigh ? trigger.levelHigh : trigger.levelLow)
    : trigger.level;
  const deviationPct = Math.abs(refLevel - price) / price * 100;
  if (deviationPct > ARMED_SETUP_LIMITS.maxTriggerDeviationPct) return { ok: false, error: "trigger_too_far", deviationPct };

  db.armedSetups ||= [];
  const deduplicated = supersedeDuplicateSetups(db, plan, options.actor, mandate);
  if (!deduplicated.ok) return deduplicated;
  const active = listActiveArmedSetups(db);
  if (active.length >= ARMED_SETUP_LIMITS.maxActive) return { ok: false, error: "armed_setup_limit_reached" };
  if (active.filter((row) => row.symbol === symbol).length >= ARMED_SETUP_LIMITS.maxPerSymbol) {
    return { ok: false, error: "armed_setup_symbol_limit_reached" };
  }

  const ttlHours = Math.min(ARMED_SETUP_LIMITS.maxTtlHours, Math.max(1, Number(options.ttlHours) || ARMED_SETUP_LIMITS.defaultTtlHours));
  const setup = {
    id: id("armed"),
    planId: plan.id,
    agentRunId: plan.agentRunId || null,
    mandateId: mandate.id,
    mandateVersion: Number(mandate.version || 1),
    riskCheckId: plan.riskCheckId || plan.lastRiskCheck?.id || null,
    evidenceBundleId: plan.evidenceBundleId || null,
    analysisBundleId: plan.analysisBundleId || null,
    symbol,
    direction: plan.direction,
    strategyRef: plan.strategyRef ? { ...plan.strategyRef } : null,
    strategyBlueprintRef: plan.strategyBlueprintRef ? { ...plan.strategyBlueprintRef } : null,
    strategyProductId: plan.strategyProductId || null,
    strategyVersion: plan.strategyVersion || null,
    strategyVersionId: plan.strategyVersionId || null,
    strategyInstance: plan.strategyInstance ? { ...plan.strategyInstance } : null,
    scenario,
    trigger,
    lastPrice: price,
    priceAtArming: price,
    status: "ARMED",
    createdBy: options.actor || "AI 交易员",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    expiresAt: new Date(Date.now() + ttlHours * 3_600_000).toISOString(),
    events: [{ at: nowIso(), event: "ARMED", detail: `price=${price}; scenario=${scenario.type}; stage=1/${scenario.stages.length}` }]
  };
  if (deduplicated.superseded.length) setup.supersedes = deduplicated.superseded.map((row) => row.id);
  db.armedSetups.unshift(setup);
  plan.status = "armed";
  plan.armedSetupId = setup.id;
  plan.armedTrigger = trigger;
  plan.scenario = scenario;
  plan.armedExpiresAt = setup.expiresAt;
  plan.executionMode = "armed";
  appendAudit(db, `等待入场计划已启动：${symbol} ${plan.direction}（尚未下单）`, setup.id, options.actor || "AI 交易员", "warning");
  appendTrace(db, "armed_setup", `${symbol} ${plan.direction} waiting for entry`, "ok");
  return { ok: true, setup };
}

export function cancelArmedSetup(db, setupId, actor = "System", reason = "cancelled") {
  const setup = (db.armedSetups || []).find((row) => row.id === setupId && ACTIVE.has(row.status));
  if (!setup) return { ok: false, error: "active_setup_not_found" };
  setup.status = "CANCELLED";
  setup.closedAt = nowIso();
  setup.updatedAt = setup.closedAt;
  setup.closeReason = reason;
  setup.events ||= [];
  setup.events.push({ at: setup.closedAt, event: "CANCELLED", detail: reason });
  const plan = (db.tradePlans || []).find((row) => row.id === setup.planId);
  if (plan?.status === "armed") plan.status = "cancelled";
  updateOpportunityCandidate(db, setup, "CANCELLED", { closeReason: reason });
  appendAudit(db, `条件交易撤销：${setup.symbol}（${reason}）`, setup.id, actor, "warning");
  return { ok: true, setup };
}

export function observeArmedSetupPrice(db, symbolInput, priceInput, now = Date.now()) {
  const symbol = normalizeSymbol(symbolInput);
  const price = Number(priceInput);
  const triggered = [];
  const expired = [];
  const invalidated = [];
  if (!finite(price) || price <= 0) return { triggered, expired, invalidated };
  const mandate = activeMandate(db);
  for (const setup of (db.armedSetups || []).filter((row) => row.status === "ARMED" && row.symbol === symbol)) {
    if (new Date(setup.expiresAt).getTime() <= now) {
      setup.status = "EXPIRED";
      setup.closedAt = nowIso();
      setup.updatedAt = setup.closedAt;
      setup.closeReason = "armed_setup_expired";
      setup.events ||= [];
      setup.events.push({ at: setup.closedAt, event: "EXPIRED", detail: setup.closeReason });
      expired.push(setup);
      transitionPlanForTerminalSetup(db, setup, "EXPIRED", "armed_setup_expired");
      updateOpportunityCandidate(db, setup, "EXPIRED", { closeReason: "armed_setup_expired" });
      continue;
    }
    if (!mandate || setup.mandateId !== mandate.id || Number(setup.mandateVersion) !== Number(mandate.version || 1) || !mandate.allowedSymbols?.includes(symbol)) {
      setup.status = "INVALIDATED";
      setup.closedAt = nowIso();
      setup.closeReason = "mandate_changed";
      setup.updatedAt = setup.closedAt;
      setup.events ||= [];
      setup.events.push({ at: setup.closedAt, event: "INVALIDATED", detail: setup.closeReason });
      invalidated.push(setup);
      transitionPlanForTerminalSetup(db, setup, "INVALIDATED", "mandate_changed");
      updateOpportunityCandidate(db, setup, "INVALIDATED", { closeReason: "mandate_changed" });
      continue;
    }
    const plan = (db.tradePlans || []).find((row) => row.id === setup.planId);
    const stop = Number(plan?.stopLoss ?? plan?.stop_loss);
    const short = String(setup.direction).toLowerCase() === "short";
    const stopBreached = Number.isFinite(stop) && (short ? price >= stop : price <= stop);
    const explicitInvalidation = setup.scenario?.invalidation && conditionAlreadyTrue(setup.scenario.invalidation, price);
    if (stopBreached || explicitInvalidation) {
      const reason = stopBreached ? "stop_already_breached" : "scenario_invalidation_triggered";
      setup.status = "INVALIDATED";
      setup.closedAt = nowIso();
      setup.closeReason = reason;
      setup.updatedAt = setup.closedAt;
      setup.events ||= [];
      setup.events.push({ at: setup.closedAt, event: "INVALIDATED", detail: reason });
      invalidated.push(setup);
      transitionPlanForTerminalSetup(db, setup, "INVALIDATED", reason);
      updateOpportunityCandidate(db, setup, "INVALIDATED", { closeReason: reason });
      continue;
    }
    const waitingForConfirmation = setup.confirmationPending === true
      && conditionAlreadyTrue(setup.trigger, price)
      && (!setup.nextConfirmationCheckAt || new Date(setup.nextConfirmationCheckAt).getTime() <= now);
    const newlyCrossed = crossed(setup.trigger, Number(setup.lastPrice), price);
    if (newlyCrossed || waitingForConfirmation) {
      setup.status = "TRIGGERED";
      setup.confirmationRecheck = waitingForConfirmation;
      setup.triggeredAt = nowIso();
      if (newlyCrossed) setup.confirmationWindowStartedAt = setup.triggeredAt;
      setup.triggerPrice = price;
      setup.updatedAt = setup.triggeredAt;
      setup.events ||= [];
      setup.events.push({ at: setup.triggeredAt, event: "TRIGGERED", detail: `price=${price}` });
      triggered.push(setup);
    } else {
      if (setup.confirmationPending && !conditionAlreadyTrue(setup.trigger, price)) {
        setup.confirmationPending = false;
        setup.nextConfirmationCheckAt = null;
        setup.confirmationWindowStartedAt = null;
      }
      setup.lastPrice = price;
      setup.updatedAt = nowIso();
    }
  }
  return { triggered, expired, invalidated };
}

function entryStillValid(plan, price) {
  const range = plan.entry_range || [];
  const low = Number(range[0]);
  const high = Number(range[1] ?? range[0]);
  const stop = Number(plan.stopLoss ?? plan.stop_loss);
  if (![low, high, stop, price].every(Number.isFinite) || low <= 0 || high < low || price <= 0) return { valid: false, reason: "invalid_plan_prices" };
  const short = String(plan.direction).toLowerCase() === "short";
  if (short ? price >= stop : price <= stop) return { valid: false, reason: "stop_already_breached" };
  const mid = (low + high) / 2;
  const maxDeviationPct = Number(process.env.ARMED_ENTRY_MAX_DEVIATION_PCT || 1);
  const deviationPct = Math.abs(price - mid) / mid * 100;
  return deviationPct <= maxDeviationPct
    ? { valid: true, deviationPct }
    : { valid: false, reason: "entry_price_moved", deviationPct, maxDeviationPct };
}

function candleConfirmationResult(db, setup) {
  const rules = Array.isArray(setup?.trigger?.confirmations) ? setup.trigger.confirmations : [];
  if (!rules.length) return { passed: true, mode: "all", checks: [] };
  const market = (db.markets || []).find((row) => row.symbol === setup.symbol);
  const checks = rules.map((rule) => {
    const timeframe = String(rule.timeframe || "1h").toLowerCase();
    const candles = market?.candlesByTf?.[timeframe]?.candles || (market?.candlesTimeframe === timeframe ? market.candles : []);
    const latest = candles.at(-1);
    if (!latest) return { kind: rule.kind, timeframe, passed: false, reason: "confirmation_candles_unavailable" };
    const candleOpenAt = Number(latest.time);
    const confirmationStartedAt = new Date(setup.confirmationWindowStartedAt || setup.triggeredAt || 0).getTime();
    if (candleOpenAt > 1_000_000_000_000 && Number.isFinite(confirmationStartedAt)) {
      const candleCloseAt = candleOpenAt + Number(TIMEFRAME_MS[timeframe] || 0);
      if (candleCloseAt < confirmationStartedAt) {
        return { kind: rule.kind, timeframe, passed: false, reason: "confirmation_candle_predates_trigger", candleCloseAt, confirmationStartedAt };
      }
    }
    if (rule.kind === "close_above" || rule.kind === "close_below") {
      const close = Number(latest.close); const level = Number(rule.level);
      const basePassed = rule.kind === "close_above" ? close > level : close < level;
      const passed = rule.negate === true ? !basePassed : basePassed;
      return { kind: rule.kind, timeframe, passed, value: close, threshold: level, reason: passed ? null : "close_not_confirmed" };
    }
    if (rule.kind === "rejection_wick") {
      const open = Number(latest.open); const high = Number(latest.high); const low = Number(latest.low); const close = Number(latest.close);
      const range = high - low;
      if (![open, high, low, close].every(Number.isFinite) || range <= 0) return { kind: rule.kind, timeframe, passed: false, reason: "confirmation_candle_invalid" };
      const requestedDirection = rule.candleDirection === "any"
        ? (setup.direction === "short" ? "bearish" : "bullish")
        : rule.candleDirection;
      const bearish = requestedDirection === "bearish";
      const wick = bearish ? high - Math.max(open, close) : Math.min(open, close) - low;
      const ratio = wick / range;
      const directionalClose = bearish ? close <= open : close >= open;
      const basePassed = ratio >= Number(rule.threshold || 0.35) && directionalClose;
      const passed = rule.negate === true ? !basePassed : basePassed;
      return { kind: rule.kind, timeframe, passed, value: Number(ratio.toFixed(4)), threshold: Number(rule.threshold || 0.35), reason: passed ? null : "rejection_not_confirmed" };
    }
    if (rule.kind === "engulfing") {
      const previous = candles.at(-2);
      if (!previous) return { kind: rule.kind, timeframe, passed: false, reason: "confirmation_previous_candle_unavailable" };
      const prevOpen = Number(previous.open); const prevClose = Number(previous.close);
      const open = Number(latest.open); const close = Number(latest.close);
      if (![prevOpen, prevClose, open, close].every(Number.isFinite)) return { kind: rule.kind, timeframe, passed: false, reason: "confirmation_candle_invalid" };
      const requestedDirection = rule.candleDirection === "any"
        ? (setup.direction === "short" ? "bearish" : "bullish")
        : rule.candleDirection;
      const bullishEngulfing = prevClose < prevOpen && close > open && open <= prevClose && close >= prevOpen;
      const bearishEngulfing = prevClose > prevOpen && close < open && open >= prevClose && close <= prevOpen;
      const basePassed = requestedDirection === "bearish" ? bearishEngulfing : bullishEngulfing;
      const passed = rule.negate === true ? !basePassed : basePassed;
      return { kind: rule.kind, timeframe, passed, value: requestedDirection, reason: passed ? null : "engulfing_not_confirmed" };
    }
    const lookback = Math.min(50, Math.max(3, Number(rule.lookback) || 20));
    const history = candles.slice(-(lookback + 1), -1).map((row) => Number(row.volume)).filter(Number.isFinite);
    const currentVolume = Number(latest.volume);
    if (history.length < Math.min(3, lookback) || !Number.isFinite(currentVolume)) return { kind: rule.kind, timeframe, passed: false, reason: "confirmation_volume_unavailable" };
    const average = history.reduce((sum, value) => sum + value, 0) / history.length;
    const ratio = average > 0 ? currentVolume / average : Number.POSITIVE_INFINITY;
    const threshold = Number(rule.threshold || (rule.kind === "volume_expansion" ? 1.3 : 0.8));
    const bullish = Number(latest.close) >= Number(latest.open);
    const directionMatched = rule.candleDirection === "bullish" ? bullish : rule.candleDirection === "bearish" ? !bullish : true;
    const basePassed = directionMatched && (rule.kind === "volume_expansion" ? ratio >= threshold : ratio <= threshold);
    const passed = rule.negate === true ? !basePassed : basePassed;
    return { kind: rule.kind, timeframe, passed, value: Number(ratio.toFixed(4)), threshold, reason: passed ? null : "volume_not_confirmed" };
  });
  const mode = setup.trigger.confirmationMode === "any" ? "any" : "all";
  return { passed: mode === "any" ? checks.some((row) => row.passed) : checks.every((row) => row.passed), mode, checks };
}

function rearmForConfirmation(db, setup, result) {
  const at = nowIso();
  setup.status = "ARMED";
  setup.confirmationPending = true;
  // The trigger price is now the comparison baseline. Leaving lastPrice at the
  // pre-cross value makes every subsequent market tick look like a brand-new
  // crossing while we wait for the confirming candle, producing a notification
  // storm and repeatedly resetting the confirmation window.
  if (finite(setup.triggerPrice)) setup.lastPrice = Number(setup.triggerPrice);
  setup.nextConfirmationCheckAt = new Date(Date.now() + 15_000).toISOString();
  setup.updatedAt = at;
  setup.events ||= [];
  setup.events.push({ at, event: "CONFIRMATION_PENDING", detail: JSON.stringify(result.checks || []).slice(0, 500) });
  const plan = (db.tradePlans || []).find((row) => row.id === setup.planId);
  if (plan) plan.status = "armed";
  updateOpportunityCandidate(db, setup, "ARMED", { confirmationPending: true });
  appendTrace(db, "armed_setup", `${setup.symbol} 价格已到，等待可计算的K线确认`, "warning");
  return { status: "CONFIRMATION_PENDING", reason: "confirmation_not_met", confirmation: result, setup };
}

async function refreshFastFacts(db, setup) {
  const symbol = setup.symbol;
  const timeframes = [...new Set((setup.trigger?.confirmations || []).map((rule) => String(rule.timeframe || "1h").toLowerCase()))];
  const jobs = [syncMicrostructure(db, "OKX", symbol), ...timeframes.map((timeframe) => syncPublicKlines(db, "OKX", symbol, timeframe, { sharedSlot: false }))];
  const account = (db.exchangeAccounts || []).find((row) => row.exchange === "OKX" && row.readEnabled);
  const snapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX" });
  const accountAge = snapshot?.createdAt ? Date.now() - new Date(snapshot.createdAt).getTime() : Infinity;
  if (db.system?.liveTradingEnabled && account && accountAge > ARMED_SETUP_LIMITS.maxAccountAgeMs) jobs.push(syncPrivateReadOnly(db, account.id));
  const results = await Promise.allSettled(jobs);
  const fulfilled = results.every((row) => row.status === "fulfilled");
  const privateIndex = 1 + timeframes.length;
  const privateSnapshot = results.length > privateIndex && results[privateIndex].status === "fulfilled" ? results[privateIndex].value : null;
  const privateOk = !db.system?.liveTradingEnabled
    || (Boolean(account) && (accountAge <= ARMED_SETUP_LIMITS.maxAccountAgeMs || privateSnapshot?.status === "ok"));
  return { ok: fulfilled && privateOk, results, reason: !fulfilled ? "fast_fact_refresh_failed" : !privateOk ? "private_account_refresh_failed" : null };
}

function freshEntryState(db, setup) {
  const plan = (db.tradePlans || []).find((row) => row.id === setup.planId);
  const market = (db.markets || []).find((row) => row.symbol === setup.symbol);
  const price = Number(market?.price ?? setup.triggerPrice);
  const tickerAge = market?.lastRealtimeAt ? Date.now() - new Date(market.lastRealtimeAt).getTime() : Infinity;
  if (!finite(price) || tickerAge < 0 || tickerAge > ARMED_SETUP_LIMITS.maxTickerAgeMs) {
    return { valid: false, reason: "ticker_not_fresh", price, tickerAge };
  }
  if (!scenarioFinalStage(setup)) {
    const stop = Number(plan?.stopLoss ?? plan?.stop_loss);
    const short = String(plan?.direction).toLowerCase() === "short";
    if (!Number.isFinite(stop)) return { valid: false, reason: "invalid_plan_prices", price, tickerAge };
    if (short ? price >= stop : price <= stop) return { valid: false, reason: "stop_already_breached", price, tickerAge };
    return { valid: true, price, tickerAge, stageOnly: true };
  }
  return { ...entryStillValid(plan || {}, price), price, tickerAge };
}

function advanceScenarioStage(db, setup, plan, confirmation, price) {
  const scenario = setup.scenario;
  const completedIndex = Number(scenario.currentStageIndex || 0);
  const completed = scenario.stages[completedIndex];
  const nextIndex = completedIndex + 1;
  const next = scenario.stages[nextIndex];
  const nextPriceConditionAlreadyMet = conditionAlreadyTrue(next.trigger, price);
  const nextHasIndependentConfirmation = Array.isArray(next.trigger?.confirmations) && next.trigger.confirmations.length > 0;
  if (nextPriceConditionAlreadyMet && !nextHasIndependentConfirmation) {
    return finalize(db, setup, "INVALIDATED", "next_scenario_stage_already_true", { nextStage: next });
  }
  const at = nowIso();
  scenario.history ||= [];
  scenario.history.push({ at, stageId: completed.id, stageIndex: completedIndex, event: "CONFIRMED", price, confirmation: confirmation.checks });
  scenario.currentStageIndex = nextIndex;
  scenario.state = "WAITING_FOR_PRICE";
  setup.trigger = next.trigger;
  setup.lastPrice = price;
  setup.status = "ARMED";
  // A separate final confirmation stage may share the retest price condition.
  // Preserve the stage boundary and start a new evidence window instead of
  // invalidating it or silently treating an old candle as confirmation.
  setup.confirmationPending = nextPriceConditionAlreadyMet && nextHasIndependentConfirmation;
  setup.nextConfirmationCheckAt = setup.confirmationPending ? at : null;
  setup.triggeredAt = null;
  setup.triggerPrice = null;
  setup.confirmationWindowStartedAt = setup.confirmationPending ? at : null;
  setup.updatedAt = at;
  setup.events ||= [];
  setup.events.push({ at, event: "SCENARIO_STAGE_ADVANCED", detail: `${completed.id}->${next.id}; ${nextIndex + 1}/${scenario.stages.length}` });
  plan.status = "armed";
  plan.armedTrigger = next.trigger;
  plan.scenario = scenario;
  updateOpportunityCandidate(db, setup, "ARMED", { currentStageIndex: nextIndex, scenarioState: scenario.state });
  appendAudit(db, `交易场景进入下一阶段：${setup.symbol} ${next.label}（${nextIndex + 1}/${scenario.stages.length}）`, setup.id, "ArmedSetup", "info");
  return { status: "SCENARIO_STAGE_ADVANCED", setup, completedStage: completed, nextStage: next, confirmation };
}

function supersedeScenarioPeers(db, setup) {
  const groupId = setup.scenario?.groupId;
  if (!groupId) return [];
  const at = nowIso();
  const peers = listActiveArmedSetups(db).filter((row) => row.id !== setup.id && row.scenario?.groupId === groupId);
  for (const peer of peers) {
    peer.status = "SUPERSEDED";
    peer.closedAt = at;
    peer.updatedAt = at;
    peer.closeReason = `scenario_branch_selected:${setup.id}`;
    peer.events ||= [];
    peer.events.push({ at, event: "SUPERSEDED", detail: peer.closeReason });
    transitionPlanForTerminalSetup(db, peer, "INVALIDATED", peer.closeReason);
    updateOpportunityCandidate(db, peer, "SUPERSEDED", { closeReason: peer.closeReason });
  }
  return peers;
}

function updateOpportunityCandidate(db, setup, status, extra = {}) {
  const candidate = (db.opportunityCandidates || []).find((row) => row.planId === setup.planId);
  if (!candidate) return;
  candidate.status = status;
  candidate.armedSetupId = setup.id;
  candidate.updatedAt = nowIso();
  Object.assign(candidate, extra);
}

export async function validateAndExecuteTriggeredSetup(db, setup, options = {}) {
  if (!setup || setup.status !== "TRIGGERED") return { status: "not_triggered" };
  if (processing.has(setup.id)) return { status: "already_processing" };
  processing.add(setup.id);
  try {
    setup.status = "FAST_VALIDATING";
    setup.validationStartedAt = nowIso();
    setup.updatedAt = setup.validationStartedAt;
    // 先持久化“已触发/校验中”，外部刷新或进程崩溃后才能从同一状态恢复。
    if (options.saveDb) options.saveDb(db);
    const plan = (db.tradePlans || []).find((row) => row.id === setup.planId);
    if (!plan || plan.status !== "armed") return finalize(db, setup, "INVALIDATED", "armed_plan_missing_or_changed");
    let entry = freshEntryState(db, setup);
    if (!entry.valid) return finalize(db, setup, "INVALIDATED", entry.reason, entry);

    const refreshed = await (options.refreshFacts ? options.refreshFacts(db, setup.symbol, setup) : refreshFastFacts(db, setup));
    if (refreshed?.ok === false) return finalize(db, setup, "BLOCKED", refreshed.reason || "fast_fact_refresh_failed");
    // 微观结构/账户刷新可能耗时，期间价格仍在变；下硬风控前再次检查 ticker 与入场有效性。
    entry = freshEntryState(db, setup);
    if (!entry.valid) return finalize(db, setup, "INVALIDATED", entry.reason, entry);
    const confirmation = candleConfirmationResult(db, setup);
    if (!confirmation.passed) return rearmForConfirmation(db, setup, confirmation);
    setup.confirmationPending = false;
    setup.confirmedAt = nowIso();
    setup.confirmationEvidence = confirmation.checks;
    if (!scenarioFinalStage(setup)) return advanceScenarioStage(db, setup, plan, confirmation, entry.price);
    const supersededPeers = supersedeScenarioPeers(db, setup);
    const evaluate = options.evaluateTradePlan || evaluateTradePlan;
    const risk = evaluate(db, plan);
    risk.tradePlanId = plan.id;
    risk.tenantId = plan.tenantId || plan.ownerTenantId || db.user?.tenantId || "tenant_owner";
    risk.ownerUserId = plan.ownerUserId || plan.createdByUserId || plan.userId || db.user?.id || null;
    risk.createdAt = nowIso();
    db.riskChecks ||= [];
    db.riskChecks.unshift(risk);
    plan.lastRiskCheck = risk;
    plan.riskCheckId = risk.id;
    if (!risk.passed) return finalize(db, setup, "RISK_REJECTED", risk.summary, { riskCheckId: risk.id });

    const hasProvider = options.hasProvider ?? Boolean(process.env.OPENROUTER_API_KEY);
    const derive = options.deriveAutomationState || deriveAutomationState;
    const automation = derive(db, { hasProvider });
    const allowedMode = armedSetupAutomationAllowed(automation, db.system?.liveTradingEnabled === true);
    if (!allowedMode) return finalize(db, setup, "BLOCKED", `automation:${automation.mode}`, { automation });

    if (typeof options.executeApprovedPlan !== "function") return finalize(db, setup, "BLOCKED", "executor_unavailable");
    plan.status = "approved";
    plan.approvedAt = nowIso();
    plan.approvedBy = "ArmedSetupFastPath";
    plan.autoApproved = true;
    setup.status = "EXECUTING";
    setup.executionStartedAt = nowIso();
    setup.updatedAt = setup.executionStartedAt;
    const execution = await options.executeApprovedPlan(db, plan.id, { manualApproval: false, autoExecuted: true, source: "armed_setup" });
    const success = ["submitted", "entry_pending", "entry_filled", "protecting", "already_executing"].includes(execution?.status);
    const dryRun = execution?.status === "dry_run";
    const deferred = execution?.status === "execution_lease_held";
    const riskRejected = execution?.status === "risk_recheck_failed";
    const blocked = ["operational_degraded_reduce_only", "blocked", "mandate_not_active", "mandate_version_stale"].includes(execution?.status);
    setup.status = success ? "EXECUTING" : dryRun ? "DRY_RUN" : deferred ? "TRIGGERED" : riskRejected ? "RISK_REJECTED" : blocked ? "BLOCKED" : "EXECUTION_FAILED";
    if (deferred) {
      plan.status = "armed";
      setup.retryCount = Number(setup.retryCount || 0) + 1;
      const retryDelayMs = Math.min(10_000, 1_000 * (2 ** Math.min(3, setup.retryCount - 1)));
      setup.retryAfter = new Date(Date.now() + retryDelayMs).toISOString();
    }
    setup.executionOrderId = execution?.executionOrder?.id || execution?.executionOrderId || null;
    setup.executionStatus = execution?.status || "unknown";
    setup.updatedAt = nowIso();
    setup.closedAt = success || deferred ? null : setup.updatedAt;
    setup.events.push({ at: setup.updatedAt, event: setup.status, detail: execution?.status || "unknown" });
    if (riskRejected) transitionPlanForTerminalSetup(db, setup, "RISK_REJECTED", execution?.status);
    else if (blocked) transitionPlanForTerminalSetup(db, setup, "BLOCKED", execution?.reason || execution?.status);
    else if (!success && !dryRun && !deferred) transitionPlanForTerminalSetup(db, setup, "EXECUTION_FAILED", execution?.reason || execution?.status || "unknown");
    updateOpportunityCandidate(db, setup, success ? "EXECUTING" : dryRun ? "DRY_RUN" : deferred ? "TRIGGERED" : setup.status, { executionStatus: execution?.status || "unknown" });
    if (deferred) {
      appendTrace(db, "armed_setup", `${setup.symbol} 执行租约占用，等待下一 tick 重试`, "warning");
    } else {
      appendAudit(db, `条件交易快速路径：${setup.symbol} ${setup.status}（${execution?.status || "unknown"}）`, setup.id, "ArmedSetup", success ? "critical" : "warning");
      createNotification(db, { eventType: "armed_setup_execution", severity: success ? "critical" : "warning", title: success ? "条件交易已提交" : "条件交易未执行", body: `${setup.symbol} ${plan.direction}：${execution?.status || "unknown"}` });
    }
    if (options.saveDb) options.saveDb(db);
    return { status: setup.status, setup, execution, risk, supersededPeers };
  } catch (error) {
    return finalize(db, setup, "EXECUTION_FAILED", String(error.message || error).slice(0, 180));
  } finally {
    processing.delete(setup.id);
  }
}

function finalize(db, setup, status, reason, extra = {}) {
  setup.status = status;
  setup.closeReason = reason;
  setup.closedAt = nowIso();
  setup.updatedAt = setup.closedAt;
  setup.events ||= [];
  setup.events.push({ at: setup.closedAt, event: status, detail: reason });
  transitionPlanForTerminalSetup(db, setup, status, reason);
  updateOpportunityCandidate(db, setup, status, { closeReason: reason });
  appendTrace(db, "armed_setup", `${setup.symbol} ${status}: ${reason}`, status === "INVALIDATED" ? "warning" : "blocked");
  return { status, reason, setup, ...extra };
}

function transitionPlanForTerminalSetup(db, setup, status, reason) {
  const plan = (db.tradePlans || []).find((row) => row.id === setup.planId);
  if (!plan || !["armed", "approved"].includes(plan.status)) return;
  const next = {
    EXPIRED: "expired",
    INVALIDATED: "cancelled",
    RISK_REJECTED: "risk_rejected",
    BLOCKED: "auto_blocked",
    EXECUTION_FAILED: "failed"
  }[status];
  if (!next) return;
  plan.status = next;
  plan.executionBlock = { reason, source: "armed_setup", at: nowIso() };
}

export async function processArmedSetupTick(db, symbol, price, options = {}) {
  const observed = observeArmedSetupPrice(db, symbol, price);
  const executions = [];
  // 触发状态必须先落盘，再进行任何外部 API/交易所调用。
  if (observed.triggered.length && options.saveDb) options.saveDb(db);
  const deferredRetries = (db.armedSetups || []).filter((setup) =>
    setup.status === "TRIGGERED" && setup.symbol === normalizeSymbol(symbol)
      && !observed.triggered.includes(setup)
      && (!setup.retryAfter || new Date(setup.retryAfter).getTime() <= Date.now())
  );
  for (const setup of [...observed.triggered, ...deferredRetries]) {
    const newlyTriggered = observed.triggered.includes(setup);
    updateOpportunityCandidate(db, setup, "TRIGGERED", { triggerPrice: setup.triggerPrice });
    const stage = currentScenarioStage(setup);
    const stageKey = `${Number(setup.scenario?.currentStageIndex || 0)}:${stage?.id || "entry"}`;
    const lastNoticeAt = new Date(setup.lastTriggerNotificationAt || 0).getTime();
    // A root-state fix above prevents continuous re-crossing. This persisted
    // cooldown is a second idempotency barrier across restarts/concurrent ticks.
    const triggerNoticeAllowed = setup.lastTriggerNotificationStageKey !== stageKey
      || !Number.isFinite(lastNoticeAt)
      || Date.now() - lastNoticeAt >= 5 * 60_000;
    if (newlyTriggered && !setup.confirmationRecheck && triggerNoticeAllowed) {
      appendAudit(db, `条件交易触发：${setup.symbol} ${setup.direction} @ ${setup.triggerPrice}`, setup.id, "ArmedSetup", "warning");
      createNotification(db, { eventType: "armed_setup_trigger", severity: "warning", title: scenarioFinalStage(setup) ? "入场条件已触发" : "交易场景进入下一步", body: `${setup.symbol} ${setup.direction}：${stage?.label || "价格条件"}已触发，正在核验。` });
      setup.lastTriggerNotificationAt = nowIso();
      setup.lastTriggerNotificationStageKey = stageKey;
    }
    setup.confirmationRecheck = false;
    executions.push(await validateAndExecuteTriggeredSetup(db, setup, options));
  }
  if ((observed.triggered.length || observed.expired.length || observed.invalidated.length || deferredRetries.length) && options.saveDb) options.saveDb(db);
  return { ...observed, executions };
}

export function reconcileArmedSetupExecutions(db) {
  const changed = [];
  for (const setup of (db.armedSetups || []).filter((row) => row.status === "EXECUTING")) {
    const execution = (db.executionOrders || []).find((row) => row.id === setup.executionOrderId || row.planId === setup.planId);
    if (!execution) continue;
    const status = String(execution.status || "").toLowerCase();
    let next = null;
    if (status === "closed") next = "COMPLETED";
    else if (status === "dry_run") next = "DRY_RUN";
    else if (["failed", "cancelled", "canceled", "protection_failed", "slippage_rejected", "setup_rejected"].includes(status)) next = status.includes("cancel") ? "CANCELLED" : "EXECUTION_FAILED";
    if (!next) continue;
    setup.status = next;
    setup.closedAt = nowIso();
    setup.updatedAt = setup.closedAt;
    setup.executionStatus = status;
    setup.events ||= [];
    setup.events.push({ at: setup.closedAt, event: next, detail: `execution=${status}` });
    updateOpportunityCandidate(db, setup, next, { executionStatus: status });
    changed.push(setup);
  }
  return changed;
}

export async function recoverTriggeredSetups(db, options = {}) {
  const pending = (db.armedSetups || []).filter((row) => ["TRIGGERED", "FAST_VALIDATING"].includes(row.status));
  const results = [];
  for (const setup of pending) {
    const existing = (db.executionOrders || []).find((row) => row.planId === setup.planId);
    const existingStatus = String(existing?.status || "").toLowerCase();
    if (existing && existingStatus === "dry_run") {
      setup.status = "DRY_RUN";
      setup.executionOrderId = existing.id;
      setup.closedAt = nowIso();
      setup.updatedAt = setup.closedAt;
      updateOpportunityCandidate(db, setup, "DRY_RUN", { executionStatus: existingStatus });
      results.push({ status: "reconciled_dry_run", setupId: setup.id, executionOrderId: existing.id });
      continue;
    }
    if (existing && existingStatus === "closed") {
      setup.status = "COMPLETED";
      setup.executionOrderId = existing.id;
      setup.closedAt = nowIso();
      setup.updatedAt = setup.closedAt;
      updateOpportunityCandidate(db, setup, "COMPLETED", { executionStatus: existingStatus });
      results.push({ status: "reconciled_completed", setupId: setup.id, executionOrderId: existing.id });
      continue;
    }
    if (existing && ["failed", "cancelled", "canceled", "protection_failed", "slippage_rejected", "setup_rejected"].includes(existingStatus)) {
      setup.status = existingStatus.includes("cancel") ? "CANCELLED" : "EXECUTION_FAILED";
      setup.executionOrderId = existing.id;
      setup.closedAt = nowIso();
      setup.updatedAt = setup.closedAt;
      updateOpportunityCandidate(db, setup, setup.status, { executionStatus: existingStatus });
      results.push({ status: "reconciled_terminal_execution", setupId: setup.id, executionOrderId: existing.id, executionStatus: existingStatus });
      continue;
    }
    const activeExecution = existing && ["created", "submitted", "entry_pending", "entry_filled", "protecting", "executing", "partial"].includes(existingStatus);
    if (activeExecution) {
      setup.status = "EXECUTING";
      setup.executionOrderId = existing.id;
      setup.updatedAt = nowIso();
      results.push({ status: "reconciled_existing_execution", setupId: setup.id, executionOrderId: existing.id });
      continue;
    }
    // 交易所调用前 OMS 会事务性预留/更新。若本地 executionOrder 尚未来得及落盘但 OMS 已有
    // 非终态入场记录，绝不重新执行；进入只减仓并等待 OMS/账户对账恢复，避免灾难性重复开仓。
    const omsEntry = listOmsOrdersForPlan(setup.planId).find((row) => row.action === "place_order" && !["REJECTED", "CANCELLED"].includes(row.state));
    if (omsEntry) {
      setup.status = "RECOVERY_PENDING_RECONCILIATION";
      setup.omsOrderId = omsEntry.id;
      setup.updatedAt = nowIso();
      const plan = (db.tradePlans || []).find((row) => row.id === setup.planId);
      if (plan) {
        plan.status = "recovery_pending_reconciliation";
        plan.executionBlock = { reason: "oms_entry_exists_after_restart", omsOrderId: omsEntry.id, at: nowIso() };
      }
      db.system ||= {};
      // 不覆盖主人手动或其他恢复流程已经设置的只减仓来源，避免本流程对账后误解除别人的安全锁。
      if (!db.system.reduceOnlyMode) {
        db.system.reduceOnlyMode = true;
        db.system.reduceOnlyBy = "armed_setup_recovery";
        setReduceOnlyReason(db, "armed_setup_recovery", { sticky: false, sourceId: omsEntry.id });
        setup.recoveryAppliedReduceOnly = true;
      } else {
        setup.recoveryAppliedReduceOnly = false;
      }
      db.riskIncidents ||= [];
      if (!db.riskIncidents.some((row) => row.status === "open" && row.source === omsEntry.id)) {
        db.riskIncidents.unshift({ id: id("incident"), severity: "critical", status: "open", title: "条件交易重启恢复发现 OMS 在途单，已禁止重复下单并暂停新开仓", source: omsEntry.id, tenantId: omsEntry.tenantId || db.user?.tenantId || "tenant_owner", ownerUserId: omsEntry.ownerUserId || db.user?.id || null, createdAt: nowIso() });
        refreshOwnerImprovementRegistry(db);
      }
      appendAudit(db, `条件交易恢复发现 OMS ${omsEntry.state}，禁止重复执行并等待对账`, setup.id, "ArmedSetupRecovery", "critical");
      results.push({ status: "recovery_pending_reconciliation", setupId: setup.id, omsOrderId: omsEntry.id, omsState: omsEntry.state });
      continue;
    }
    const triggerAge = setup.triggeredAt ? Date.now() - new Date(setup.triggeredAt).getTime() : Infinity;
    if (!Number.isFinite(triggerAge) || triggerAge > ARMED_SETUP_LIMITS.maxRecoveryTriggerAgeMs) {
      results.push(finalize(db, setup, "INVALIDATED", "stale_trigger_after_restart", { triggerAgeMs: triggerAge }));
      continue;
    }
    setup.status = "TRIGGERED";
    results.push(await validateAndExecuteTriggeredSetup(db, setup, options));
  }
  if (pending.length && options.saveDb) options.saveDb(db);
  return results;
}
