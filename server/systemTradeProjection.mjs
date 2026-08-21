import { groupClosedTradeLifecycles } from "./tradeLifecycle.mjs";
import { canonicalPositionDirection, canonicalSymbol } from "./positionIdentity.mjs";

export const TRADE_ATTRIBUTION_SCHEMA_VERSION = 1;

function populated(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function stringValue(value) {
  return populated(value) ? String(value).trim() : null;
}

function normalizedEnvironment(value) {
  const text = stringValue(value);
  return text ? text.toLowerCase() : null;
}

function normalizedExchange(value) {
  const text = stringValue(value);
  return text ? text.toUpperCase() : null;
}

function unique(values, normalize = stringValue) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function conflict(values, normalize) {
  return unique(values, normalize).length > 1;
}

function attributionEvidence(fill = {}) {
  return fill.tradeAttribution?.evidence || {};
}

function baseEvidence(fill = {}, executionOrder = null, previous = {}) {
  const quantity = Number(fill.quantity ?? fill.size);
  return {
    accountId: stringValue(executionOrder?.accountId ?? fill.accountId ?? previous.accountId),
    environment: stringValue(executionOrder?.environment ?? fill.environment ?? previous.environment),
    exchangeOrderId: stringValue(fill.exchangeOrderId ?? previous.exchangeOrderId),
    exchangeTradeId: stringValue(fill.exchangeTradeId ?? fill.tradeId ?? previous.exchangeTradeId),
    matchedEntryFillIds: Array.isArray(previous.matchedEntryFillIds) ? [...previous.matchedEntryFillIds] : [],
    attributedQuantity: Number.isFinite(quantity) && quantity !== 0 ? quantity : null
  };
}

function result({ scope, origin, exitMode = null, executionOrderId = null, planId = null, method, reason = null, fill = {}, executionOrder = null, evidence = null }) {
  return {
    schemaVersion: TRADE_ATTRIBUTION_SCHEMA_VERSION,
    scope,
    origin,
    exitMode,
    executionOrderId: stringValue(executionOrderId),
    planId: stringValue(planId),
    method,
    reason,
    evidence: evidence || baseEvidence(fill, executionOrder, attributionEvidence(fill)),
    attributedAt: fill.tradeAttribution?.attributedAt || fill.createdAt || null
  };
}

function executionOrderIds(executionOrder = {}) {
  return unique([
    executionOrder.exchangeOrderId,
    executionOrder.closeExchangeOrderId,
    executionOrder.clientOrderId,
    executionOrder.closeClientOrderId,
    executionOrder.omsOrderId
  ]);
}

function findExecutionByExchangeIdentity(db = {}, fill = {}) {
  const ids = unique([fill.exchangeOrderId, fill.clientOrderId, fill.orderId]);
  if (!ids.length) return [];
  return (db.executionOrders || []).filter((executionOrder) => executionOrderIds(executionOrder).some((id) => ids.includes(id)));
}

function pending(fill, reason, executionOrder = null, planId = null) {
  return result({
    scope: "attribution_pending",
    origin: fill.tradeAttribution?.origin === "execution_engine" ? "execution_engine" : "external_exchange",
    executionOrderId: executionOrder?.id ?? fill.executionOrderId ?? fill.tradeAttribution?.executionOrderId,
    planId: planId ?? executionOrder?.planId ?? fill.planId ?? fill.tradePlanId ?? fill.tradeAttribution?.planId,
    method: "unresolved",
    reason,
    fill,
    executionOrder
  });
}

function manual(fill) {
  return result({
    scope: "manual",
    origin: "external_exchange",
    method: "external_unmanaged",
    fill
  });
}

function bindingConflict(fill, executionOrder, plan) {
  const attribution = fill.tradeAttribution || {};
  const evidence = attributionEvidence(fill);
  const fillExecutionIds = unique([fill.executionOrderId, attribution.executionOrderId]);
  if (fillExecutionIds.length > 1 || (fillExecutionIds.length && fillExecutionIds[0] !== stringValue(executionOrder.id))) {
    return "trade_execution_order_binding_conflict";
  }

  const planIds = unique([fill.planId, fill.tradePlanId, attribution.planId]);
  if (planIds.length > 1 || (planIds.length && planIds[0] !== stringValue(executionOrder.planId))) {
    return "trade_plan_binding_conflict";
  }
  if (plan && stringValue(plan.id) !== stringValue(executionOrder.planId)) return "trade_plan_binding_conflict";

  if (conflict([fill.accountId, evidence.accountId, executionOrder.accountId])) return "trade_account_binding_conflict";
  if (conflict([fill.environment, evidence.environment, executionOrder.environment], normalizedEnvironment)) return "trade_environment_binding_conflict";
  if (conflict([fill.exchange, executionOrder.exchange], normalizedExchange)) return "trade_exchange_binding_conflict";
  if (conflict([fill.symbol, executionOrder.symbol, plan?.symbol], canonicalSymbol)) return "trade_symbol_binding_conflict";
  if (conflict([fill.direction, executionOrder.direction, plan?.direction], canonicalPositionDirection)) return "trade_direction_binding_conflict";

  const fillExchangeOrderIds = unique([fill.exchangeOrderId, evidence.exchangeOrderId]);
  const knownExecutionOrderIds = executionOrderIds(executionOrder);
  if (fillExchangeOrderIds.length > 1 || (fillExchangeOrderIds.length && knownExecutionOrderIds.length
    && !fillExchangeOrderIds.every((id) => knownExecutionOrderIds.includes(id)))) {
    return "trade_exchange_order_binding_conflict";
  }
  return null;
}

export function classifyTradeFill(db = {}, fill = {}) {
  const attribution = fill.tradeAttribution || {};
  const directExecutionIds = unique([fill.executionOrderId, attribution.executionOrderId]);
  if (directExecutionIds.length > 1) return pending(fill, "trade_execution_order_binding_conflict");

  let executionOrder = null;
  if (directExecutionIds.length) {
    executionOrder = (db.executionOrders || []).find((row) => stringValue(row?.id) === directExecutionIds[0]) || null;
    if (!executionOrder) return pending(fill, "execution_order_missing");
  } else {
    const candidates = findExecutionByExchangeIdentity(db, fill);
    if (candidates.length > 1) return pending(fill, "trade_execution_order_ambiguous");
    executionOrder = candidates[0] || null;
  }

  const planIds = unique([fill.planId, fill.tradePlanId, attribution.planId]);
  const claimsSystemOwnership = Boolean(directExecutionIds.length || planIds.length || attribution.scope === "system");
  if (!executionOrder) return claimsSystemOwnership ? pending(fill, "execution_order_missing") : manual(fill);

  const planId = stringValue(executionOrder.planId);
  const plan = planId ? (db.tradePlans || []).find((row) => stringValue(row?.id) === planId) || null : null;
  if (planId && !plan) return pending(fill, "trade_plan_missing", executionOrder, planId);

  const reason = bindingConflict(fill, executionOrder, plan);
  if (reason) return pending(fill, reason, executionOrder, planId);

  const legacy = attribution.schemaVersion !== TRADE_ATTRIBUTION_SCHEMA_VERSION || attribution.scope !== "system";
  return result({
    scope: "system",
    origin: attribution.origin === "external_exchange" ? "external_exchange" : "execution_engine",
    exitMode: attribution.exitMode ?? (fill.kind === "close" ? "system_exit" : null),
    executionOrderId: executionOrder.id,
    planId,
    method: legacy ? "legacy_positive_provenance" : (attribution.method || "execution_writer"),
    fill,
    executionOrder
  });
}

export function buildExecutionFillAttribution(db = {}, executionOrder = {}, fill = {}) {
  const attribution = classifyTradeFill(db, {
    ...fill,
    executionOrderId: executionOrder.id,
    planId: executionOrder.planId,
    tradePlanId: executionOrder.planId,
    tradeAttribution: {
      ...(fill.tradeAttribution || {}),
      schemaVersion: TRADE_ATTRIBUTION_SCHEMA_VERSION,
      scope: "system",
      origin: "execution_engine",
      executionOrderId: executionOrder.id,
      planId: executionOrder.planId,
      method: "execution_writer",
      evidence: baseEvidence(fill, executionOrder, attributionEvidence(fill))
    }
  });
  return {
    ...attribution,
    origin: "execution_engine",
    exitMode: fill.kind === "close" ? "system_exit" : null,
    method: attribution.scope === "system" ? "execution_writer" : "unresolved"
  };
}

export function buildExternalFillAttribution(db = {}, fill = {}) {
  const attribution = classifyTradeFill(db, fill);
  return {
    ...attribution,
    origin: "external_exchange",
    method: attribution.scope === "manual" ? "external_unmanaged" : attribution.method
  };
}

export function projectSystemTradeFill(db, fill) {
  const attribution = classifyTradeFill(db, fill);
  if (attribution.scope !== "system") return null;
  return {
    ...fill,
    executionOrderId: attribution.executionOrderId,
    planId: attribution.planId,
    tradePlanId: attribution.planId,
    tradeAttribution: structuredClone(attribution)
  };
}

export function systemTradeFills(db, options = {}) {
  const fills = options.fills || db.fills || [];
  return fills.map((fill) => projectSystemTradeFill(db, fill)).filter(Boolean);
}

export function groupSystemClosedTradeLifecycles(db, options = {}) {
  const { fills = db.fills || [], ...lifecycleOptions } = options;
  return groupClosedTradeLifecycles(systemTradeFills(db, { fills }), lifecycleOptions);
}
