import { isEventRiskActive } from "./eventRisk.mjs";

const ALLOWED_FIELDS = new Set([
  "plan.leverage",
  "plan.riskPercent",
  "market.fundingRate",
  "market.spreadBps",
  "event.maxImpact",
  "account.remainingDailyLossUsdt"
]);

const BLOCKING_ACTIONS = new Set(["block", "kill_switch", "pause_opening", "reduce", "restrict"]);

function readFact(facts, field) {
  return String(field || "").split(".").reduce((value, key) => value?.[key], facts);
}

function compare(actual, operator, expected) {
  const a = Number(actual);
  const b = Number(expected);
  if (operator === "eq") return actual === expected || (Number.isFinite(a) && Number.isFinite(b) && a === b);
  if (operator === "in") return Array.isArray(expected) && expected.includes(actual);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (operator === "gt") return a > b;
  if (operator === "gte") return a >= b;
  if (operator === "lt") return a < b;
  if (operator === "lte") return a <= b;
  if (operator === "abs_gt") return Math.abs(a) > b;
  if (operator === "abs_gte") return Math.abs(a) >= b;
  return false;
}

export function validateConditionSpec(spec) {
  if (!spec || typeof spec !== "object") return { valid: false, reason: "missing_condition_spec" };
  if (!ALLOWED_FIELDS.has(spec.field)) return { valid: false, reason: "unsupported_condition_field" };
  if (!["eq", "in", "gt", "gte", "lt", "lte", "abs_gt", "abs_gte"].includes(spec.operator)) {
    return { valid: false, reason: "unsupported_condition_operator" };
  }
  return { valid: true };
}

export function compileNaturalRiskCondition(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const leverage = text.match(/(?:杠杆|leverage).*?(?:>|高于|大于|超过)\s*(\d+(?:\.\d+)?)/i);
  if (leverage) return { field: "plan.leverage", operator: "gt", value: Number(leverage[1]) };
  const funding = text.match(/(?:资金费率|funding).*?(?:绝对值|\|)?.*?(?:>|高于|大于|超过)\s*(\d+(?:\.\d+)?)\s*%?/i);
  if (funding) return { field: "market.fundingRate", operator: "abs_gt", value: Number(funding[1]) };
  const impact = text.match(/(?:影响分|impact).*?(?:>=|≥|高于|大于|超过)\s*(\d+(?:\.\d+)?)/i);
  if (impact) return { field: "event.maxImpact", operator: "gte", value: Number(impact[1]) };
  const spread = text.match(/(?:点差|spread).*?(?:>|高于|大于|超过)\s*(\d+(?:\.\d+)?)\s*(?:bps?)?/i);
  if (spread) return { field: "market.spreadBps", operator: "gt", value: Number(spread[1]) };
  const risk = text.match(/(?:单笔风险|risk).*?(?:>|高于|大于|超过)\s*(\d+(?:\.\d+)?)\s*%?/i);
  if (risk) return { field: "plan.riskPercent", operator: "gt", value: Number(risk[1]) };
  if (/(?:剩余日亏损|remaining daily loss).*?(?:<=|≤|耗尽|为零|0)/i.test(text)) {
    return { field: "account.remainingDailyLossUsdt", operator: "lte", value: 0 };
  }
  return null;
}

function builtInTriggered(rule, facts) {
  if (rule.id === "risk_stop_required") return !facts.plan.stopLoss;
  if (rule.id === "risk_no_withdraw") return facts.account.withdrawPermission === true;
  return null;
}

export function evaluateDynamicRiskRules(db, plan) {
  const market = (db.markets || []).find((item) => item.symbol === plan.symbol) || {};
  const relatedEvents = (db.events || []).filter((event) => isEventRiskActive(event) && event.relatedSymbols?.includes(plan.symbol));
  const metadata = (db.apiKeyMetadata || []).find((item) => String(item.exchange || "").toUpperCase() === String(plan.exchange || "BINANCE").toUpperCase()) || {};
  const facts = {
    plan: {
      leverage: Number(plan.leverage),
      riskPercent: Number(plan.entry?.riskPercent ?? plan.entry?.risk_percent ?? plan.max_loss_pct),
      stopLoss: plan.stopLoss ?? plan.stop_loss
    },
    market: {
      fundingRate: Number(market.fundingRate),
      spreadBps: Number(market.spreadBps)
    },
    event: {
      maxImpact: relatedEvents.reduce((max, event) => Math.max(max, Number(event.impact || 0)), 0)
    },
    account: {
      remainingDailyLossUsdt: Number(db.system?.remainingDailyLossUsdt ?? db.portfolio?.remainingDailyLossUsdt),
      withdrawPermission: metadata.withdrawPermission === true
    }
  };

  const results = [];
  for (const rule of db.riskRules || []) {
    if (rule.enabled === false) continue;
    const builtIn = builtInTriggered(rule, facts);
    const validation = validateConditionSpec(rule.conditionSpec);
    const enforceable = builtIn !== null || validation.valid;
    const triggered = builtIn !== null ? builtIn : validation.valid ? compare(readFact(facts, rule.conditionSpec.field), rule.conditionSpec.operator, rule.conditionSpec.value) : false;
    results.push({
      id: rule.id,
      name: rule.name,
      action: rule.action || "notify",
      enforceable,
      triggered,
      blocking: triggered && BLOCKING_ACTIONS.has(rule.action),
      detail: enforceable
        ? triggered ? `动态规则已触发：${rule.name}` : `动态规则未触发：${rule.name}`
        : `规则缺少受支持的结构化条件，仅作为提示：${rule.name}`
    });
  }
  return results;
}
