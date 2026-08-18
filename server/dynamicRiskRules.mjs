import { isEventRiskActive } from "./eventRisk.mjs";
import { appendAudit, id, nowIso } from "./store.mjs";
import { strictFiniteFact } from "./factValues.mjs";
import { refreshOwnerImprovementRegistry } from "./ownerReviewLoop.mjs";

const ALLOWED_FIELDS = new Set([
  "plan.leverage",
  "plan.riskPercent",
  "market.fundingRate",
  "market.spreadBps",
  "event.maxImpact",
  "account.remainingDailyLossUsdt"
]);

export const DYNAMIC_RISK_ACTIONS = Object.freeze(["notify", "reject_entry", "pause_opening"]);
const BLOCKING_ACTIONS = new Set(["reject_entry", "pause_opening", "block", "kill_switch", "restrict"]);
const NUMERIC_RANGES = Object.freeze({
  "plan.leverage": [0, 100],
  "plan.riskPercent": [0, 100],
  "market.fundingRate": [-100, 100],
  "market.spreadBps": [0, 100_000],
  "event.maxImpact": [0, 100],
  "account.remainingDailyLossUsdt": [-1_000_000_000_000, 1_000_000_000_000]
});

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
  if (spec.operator === "in") {
    if (!Array.isArray(spec.value) || !spec.value.length || spec.value.length > 50) return { valid: false, reason: "invalid_condition_value" };
  } else {
    const value = Number(spec.value);
    const range = NUMERIC_RANGES[spec.field];
    if (spec.value === null || spec.value === "" || !Number.isFinite(value)) return { valid: false, reason: "invalid_condition_value" };
    if (range && (value < range[0] || value > range[1])) return { valid: false, reason: "condition_value_out_of_range" };
    if (["abs_gt", "abs_gte"].includes(spec.operator) && value < 0) return { valid: false, reason: "absolute_threshold_must_be_non_negative" };
  }
  return { valid: true };
}

export function validateDynamicRiskAction(action) {
  return DYNAMIC_RISK_ACTIONS.includes(String(action || ""));
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
  const metadata = (db.apiKeyMetadata || []).find((item) => String(item.exchange || "").toUpperCase() === String(plan.exchange || "OKX").toUpperCase()) || {};
  const facts = {
    plan: {
      leverage: strictFiniteFact(plan.leverage),
      riskPercent: strictFiniteFact(plan.entry?.riskPercent ?? plan.entry?.risk_percent ?? plan.max_loss_pct),
      stopLoss: plan.stopLoss ?? plan.stop_loss
    },
    market: {
      fundingRate: strictFiniteFact(market.fundingRate),
      spreadBps: strictFiniteFact(market.spreadBps)
    },
    event: {
      maxImpact: relatedEvents.reduce((max, event) => Math.max(max, Number(event.impact || 0)), 0)
    },
    account: {
      remainingDailyLossUsdt: strictFiniteFact(db.system?.remainingDailyLossUsdt ?? db.portfolio?.remainingDailyLossUsdt),
      withdrawPermission: metadata.withdrawPermission === true
    }
  };

  const results = [];
  for (const rule of db.riskRules || []) {
    if (rule.enabled === false) continue;
    const builtIn = builtInTriggered(rule, facts);
    const validation = validateConditionSpec(rule.conditionSpec);
    const enforceable = builtIn !== null || validation.valid;
    const actual = validation.valid ? readFact(facts, rule.conditionSpec.field) : undefined;
    const dataAvailable = builtIn !== null || (actual !== undefined && actual !== null && actual !== "" && (rule.conditionSpec.operator === "in" || Number.isFinite(Number(actual))));
    const triggered = builtIn !== null ? builtIn : validation.valid && dataAvailable ? compare(actual, rule.conditionSpec.operator, rule.conditionSpec.value) : false;
    const legacyAction = !validateDynamicRiskAction(rule.action);
    results.push({
      id: rule.id,
      name: rule.name,
      action: rule.action || "notify",
      enforceable,
      dataAvailable,
      triggered,
      blocking: triggered && BLOCKING_ACTIONS.has(rule.action),
      detail: enforceable
        ? !dataAvailable ? `动态规则缺少指标数据，未触发：${rule.name}`
          : triggered ? `动态规则已触发：${rule.name}${legacyAction ? "（旧动作按当前计划阻断处理，不会触发全局熔断）" : ""}` : `动态规则未触发：${rule.name}`
        : `规则缺少受支持的结构化条件，仅作为提示：${rule.name}`
    });
  }
  applyDynamicRiskRuleEffects(db, plan, results);
  return results;
}

function applyDynamicRiskRuleEffects(db, plan, results) {
  const now = Date.now();
  const symbol = String(plan.symbol || "UNKNOWN");
  const cooldownMs = Math.max(60_000, Number(process.env.DYNAMIC_RISK_ALERT_COOLDOWN_MS || 15 * 60_000));
  db.notifications ||= [];
  db.riskIncidents ||= [];
  db.auditLogs ||= [];
  db.meta ||= {};
  db.meta.dynamicRiskAlertAt ||= {};
  const byRule = new Map(results.map((result) => [result.id, result]));
  const resolved = [];
  for (const incident of db.riskIncidents) {
    if (incident.status !== "open" || incident.source !== "dynamic_risk_rule" || incident.symbol !== symbol) continue;
    const current = byRule.get(incident.ruleId);
    // 指标暂时缺失时保持事件打开，不能把“未知”误报成“风险已消失”。规则已删除/停用，
    // 或有完整新事实且条件明确不再成立时，才自动关闭。
    const shouldResolve = !current || (current.enforceable && current.dataAvailable && (!current.triggered || !current.blocking));
    if (!shouldResolve) continue;
    incident.status = "resolved";
    incident.resolvedAt = nowIso();
    incident.resolvedBy = "DynamicRiskEngine";
    incident.resolution = current ? "condition_cleared" : "rule_disabled_or_removed";
    resolved.push(incident);
  }
  if (resolved.length) appendAudit(db, `动态风控恢复：${symbol} · ${resolved.map((item) => item.ruleId).join("、")}`, symbol, "DynamicRiskEngine");
  for (const result of results) {
    if (!result.triggered) continue;
    if (result.id === "risk_stop_required") continue; // “止损存在”已有独立硬检查，避免同一缺陷重复通知。
    const blocking = result.blocking;
    if (blocking && !db.riskIncidents.some((item) => item.status === "open" && item.ruleId === result.id && item.symbol === symbol)) {
      db.riskIncidents.unshift({
        id: id("incident"), severity: "high", status: "open", title: `动态风控阻断 ${symbol}：${result.name}`,
        source: "dynamic_risk_rule", ruleId: result.id, symbol, action: result.action,
        tenantId: db.user?.tenantId || "tenant_owner", ownerUserId: db.user?.id || null, createdAt: nowIso()
      });
      refreshOwnerImprovementRegistry(db);
    }
    const key = `${result.id}:${symbol}`;
    const lastAt = new Date(db.meta.dynamicRiskAlertAt[key] || 0).getTime();
    if (Number.isFinite(lastAt) && now - lastAt < cooldownMs) continue;
    db.meta.dynamicRiskAlertAt[key] = nowIso();
    db.notifications.unshift({
      id: id("notif"), type: "dynamic_risk_rule", eventType: "risk_rule_triggered",
      severity: blocking ? "warning" : "info", title: `风控规则触发：${result.name}`,
      body: `${symbol} · ${blocking ? "当前入场已阻断" : "仅通知，不阻断"} · ${result.detail}`,
      ruleId: result.id, symbol, read: false, createdAt: nowIso()
    });
    appendAudit(db, `${blocking ? "动态风控阻断" : "动态风控通知"}：${result.name} · ${symbol}`, result.id, "DynamicRiskEngine", blocking ? "warning" : "info");
  }
  if (db.notifications.length > 200) db.notifications = db.notifications.slice(0, 200);
}
