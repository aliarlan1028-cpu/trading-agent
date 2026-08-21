import { groupClosedTradeLifecycles } from "./tradeLifecycle.mjs";
import { canonicalPositionDirection, canonicalSymbol } from "./positionIdentity.mjs";
import { OPEN_EXECUTION_STATES } from "./executionStates.mjs";

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

function result({ scope, origin, exitMode = null, executionOrderId = null, planId = null, method, reason = null, partial = null, fill = {}, executionOrder = null, evidence = null }) {
  return {
    schemaVersion: TRADE_ATTRIBUTION_SCHEMA_VERSION,
    scope,
    origin,
    exitMode,
    executionOrderId: stringValue(executionOrderId),
    planId: stringValue(planId),
    method,
    reason,
    partial,
    evidence: evidence || baseEvidence(fill, executionOrder, attributionEvidence(fill)),
    attributedAt: fill.tradeAttribution?.attributedAt || fill.createdAt || null
  };
}

function values(...items) {
  return unique(items.flatMap((item) => Array.isArray(item) ? item : [item]));
}

function orderRole(fill = {}) {
  if (fill.kind === "entry") return "entry";
  if (fill.kind === "close" || fill.kind === "exit") return "close";
  return null;
}

const CLOSE_IDENTITY_PREFIXES = ["close", "protection", "stop", "tp"];

function closeAliasValues(row = {}, suffix) {
  return values(...CLOSE_IDENTITY_PREFIXES.flatMap((prefix) => [
    row[`${prefix}${suffix}`],
    row[`${prefix}${suffix}s`]
  ]));
}

function orderIdentitySets(row = {}, role) {
  if (role === "close") {
    return {
      exchange: closeAliasValues(row, "ExchangeOrderId"),
      client: closeAliasValues(row, "ClientOrderId"),
      local: closeAliasValues(row, "OmsOrderId"),
      algo: closeAliasValues(row, "AlgoId")
    };
  }
  return {
    exchange: values(row.exchangeOrderId, row.entryExchangeOrderId, row.entryExchangeOrderIds),
    client: values(row.clientOrderId, row.entryClientOrderId, row.entryClientOrderIds),
    local: values(row.omsOrderId, row.entryOmsOrderId, row.entryOmsOrderIds),
    algo: values(row.entryAlgoId, row.entryAlgoIds)
  };
}

function fillOrderIdentitySets(fill = {}, evidence = {}) {
  return {
    exchange: values(fill.exchangeOrderId, fill.exchangeOrderIds, evidence.exchangeOrderId, evidence.exchangeOrderIds,
      closeAliasValues(fill, "ExchangeOrderId"), closeAliasValues(evidence, "ExchangeOrderId")),
    client: values(fill.clientOrderId, fill.clientOrderIds, fill.algoClientOrderId, fill.algoClientOrderIds,
      evidence.clientOrderId, evidence.clientOrderIds, evidence.algoClientOrderId, evidence.algoClientOrderIds,
      closeAliasValues(fill, "ClientOrderId"), closeAliasValues(evidence, "ClientOrderId")),
    local: values(fill.orderId, fill.orderIds, evidence.orderId, evidence.orderIds,
      closeAliasValues(fill, "OmsOrderId"), closeAliasValues(evidence, "OmsOrderId")),
    algo: values(fill.algoId, fill.algoIds, fill.exchangeAlgoId, fill.exchangeAlgoIds, evidence.algoId, evidence.algoIds, evidence.exchangeAlgoId, evidence.exchangeAlgoIds,
      closeAliasValues(fill, "AlgoId"), closeAliasValues(evidence, "AlgoId"))
  };
}

function findExecutionByExchangeIdentity(db = {}, fill = {}) {
  const role = orderRole(fill);
  const ids = fillOrderIdentitySets(fill);
  if (!role || !Object.values(ids).some((values) => values.length)) return [];
  return (db.executionOrders || []).filter((executionOrder) => {
    const entry = orderIdentitySets(executionOrder, "entry");
    const close = orderIdentitySets(executionOrder, "close");
    return Object.keys(ids).some((type) => ids[type].some((id) => entry[type].includes(id) || close[type].includes(id)));
  });
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

  if (conflict([fill.accountId, evidence.accountId, executionOrder.accountId, plan?.accountId])) return "trade_account_binding_conflict";
  if (conflict([fill.environment, evidence.environment, executionOrder.environment, plan?.environment], normalizedEnvironment)) return "trade_environment_binding_conflict";
  if (conflict([fill.exchange, executionOrder.exchange, plan?.exchange], normalizedExchange)) return "trade_exchange_binding_conflict";
  if (conflict([fill.symbol, executionOrder.symbol, plan?.symbol], canonicalSymbol)) return "trade_symbol_binding_conflict";
  if (conflict([fill.direction, executionOrder.direction, plan?.direction], canonicalPositionDirection)) return "trade_direction_binding_conflict";

  const role = orderRole(fill);
  if (role) {
    const identities = fillOrderIdentitySets(fill, evidence);
    const externalManualExit = role === "close" && attribution.exitMode === "manual_exit";
    const expected = externalManualExit
      ? { exchange: [], client: [], local: [], algo: [] }
      : orderIdentitySets(executionOrder, role);
    const opposite = orderIdentitySets(executionOrder, role === "entry" ? "close" : "entry");
    for (const type of Object.keys(identities)) {
      if (identities[type].some((id) => opposite[type].includes(id))) return "trade_exchange_order_binding_conflict";
      if (identities[type].length && expected[type].length && identities[type].some((id) => !expected[type].includes(id))) {
        return "trade_exchange_order_binding_conflict";
      }
    }
  }
  return null;
}

export function classifyTradeFill(db = {}, fill = {}) {
  const attribution = fill.tradeAttribution || {};
  if (attribution.schemaVersion === TRADE_ATTRIBUTION_SCHEMA_VERSION && attribution.scope === "attribution_pending") {
    return result({
      scope: "attribution_pending",
      origin: attribution.origin === "execution_engine" ? "execution_engine" : "external_exchange",
      executionOrderId: attribution.executionOrderId,
      planId: attribution.planId,
      method: "unresolved",
      reason: attribution.reason || "trade_attribution_unresolved",
      partial: attribution.partial,
      fill,
      evidence: attribution.evidence
    });
  }
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
    partial: attribution.partial,
    fill,
    executionOrder
  });
}

function positiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function finiteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function authoritativeFillTime(fill = {}) {
  if (!populated(fill.exchangeFilledAt)) return null;
  const at = new Date(fill.exchangeFilledAt).getTime();
  return Number.isFinite(at) ? at : null;
}

function closeDirection(fill = {}) {
  const side = String(fill.side || "").trim().toLowerCase();
  if (side === "sell") return "long";
  if (side === "buy") return "short";
  return null;
}

function entryDirection(fill = {}) {
  const explicit = canonicalPositionDirection(fill.direction);
  if (explicit) return explicit;
  const side = String(fill.side || "").trim().toLowerCase();
  if (side === "buy") return "long";
  if (side === "sell") return "short";
  return null;
}

function executionEntryFills(db, executionOrder) {
  return (db.fills || []).filter((fill) => {
    if (fill?.kind !== "entry") return false;
    const attribution = classifyTradeFill(db, fill);
    return attribution.scope === "system" && attribution.executionOrderId === stringValue(executionOrder.id);
  });
}

function systemCloseFills(db, executionOrder) {
  return (db.fills || []).filter((fill) => {
    if (fill?.kind !== "close") return false;
    const attribution = classifyTradeFill(db, fill);
    return attribution.scope === "system"
      && attribution.executionOrderId === stringValue(executionOrder.id);
  });
}

function executionManagedQuantity(db, executionOrder, entryFills = executionEntryFills(db, executionOrder)) {
  const entryQuantity = entryFills.reduce((sum, fill) => sum + (positiveNumber(fill.quantity ?? fill.size) || 0), 0);
  return entryQuantity > 0 ? entryQuantity : null;
}

function quantityTolerance(executionOrder, expectedQuantity) {
  return Math.max(1e-10, Number(expectedQuantity || 0) * 0.005, Number(executionOrder.okxCtVal || 0) * 0.0001);
}

function executionEntryTime(executionOrder, entryFills) {
  const times = [executionOrder.entryFilledAt, ...entryFills.map((fill) => fill.exchangeFilledAt || fill.createdAt)]
    .map((value) => new Date(value || 0).getTime())
    .filter((value) => Number.isFinite(value) && value > 0);
  return times.length ? Math.min(...times) : null;
}

function sameBoundSlot(fill, executionOrder) {
  return stringValue(fill.accountId) === stringValue(executionOrder.accountId)
    && normalizedEnvironment(fill.environment) === normalizedEnvironment(executionOrder.environment)
    && canonicalSymbol(fill.symbol) === canonicalSymbol(executionOrder.symbol);
}

function hasMixedExternalEntry(db, executionOrder, closeFill, entryAt, closeAt) {
  const closeTradeId = stringValue(closeFill.exchangeTradeId ?? closeFill.tradeId);
  return (db.fills || []).some((fill) => {
    if (fill?.kind !== "entry" || !sameBoundSlot(fill, executionOrder)) return false;
    const attribution = classifyTradeFill(db, fill);
    if (attribution.scope === "system") return false;
    if (entryDirection(fill) !== canonicalPositionDirection(executionOrder)) return false;
    const tradeId = stringValue(fill.exchangeTradeId ?? fill.tradeId);
    if (closeTradeId && tradeId === closeTradeId) return false;
    const at = authoritativeFillTime(fill);
    return at === null || (at >= entryAt && at <= closeAt);
  });
}

function manualExitCandidate(db, executionOrder, fill) {
  const entryFills = executionEntryFills(db, executionOrder);
  const managedQuantity = executionManagedQuantity(db, executionOrder, entryFills);
  const priorCloseQuantity = systemCloseFills(db, executionOrder)
    .reduce((sum, row) => sum + (positiveNumber(row.quantity ?? row.size) || 0), 0);
  const remainingQuantity = managedQuantity === null ? null : Math.max(0, managedQuantity - priorCloseQuantity);
  const fillQuantity = positiveNumber(fill.quantity ?? fill.size);
  const fillAt = authoritativeFillTime(fill);
  const entryAt = executionEntryTime(executionOrder, entryFills);
  const tolerance = quantityTolerance(executionOrder, managedQuantity);
  const checks = {
    account: populated(fill.accountId) && populated(executionOrder.accountId)
      && stringValue(fill.accountId) === stringValue(executionOrder.accountId),
    environment: populated(fill.environment) && populated(executionOrder.environment)
      && normalizedEnvironment(fill.environment) === normalizedEnvironment(executionOrder.environment),
    symbol: populated(fill.symbol) && populated(executionOrder.symbol)
      && canonicalSymbol(fill.symbol) === canonicalSymbol(executionOrder.symbol),
    direction: closeDirection(fill) !== null && closeDirection(fill) === canonicalPositionDirection(executionOrder),
    time: fillAt !== null && entryAt !== null && fillAt > entryAt,
    quantity: fillQuantity !== null && remainingQuantity !== null && remainingQuantity > tolerance
      && fillQuantity <= remainingQuantity + tolerance
  };
  return {
    executionOrder,
    entryFills,
    managedQuantity,
    remainingQuantity,
    fillQuantity,
    fillAt,
    entryAt,
    tolerance,
    checks,
    exact: Object.values(checks).every(Boolean),
    matchCount: Object.values(checks).filter(Boolean).length
  };
}

export function resolveManualExitAttribution(db = {}, fill = {}) {
  const empty = {
    executionOrderId: null,
    planId: null,
    matchedEntryFillIds: [],
    remainingQuantity: null,
    partial: false
  };
  if (fill?.kind !== "close") return { status: "manual", reason: "not_external_close", ...empty };
  if (!stringValue(fill.exchangeTradeId ?? fill.tradeId)) {
    return { status: "pending", reason: "manual_exit_trade_id_missing", ...empty };
  }
  if (authoritativeFillTime(fill) === null) {
    return { status: "pending", reason: "manual_exit_exchange_time_missing", ...empty };
  }
  const openExecutions = (db.executionOrders || []).filter((executionOrder) => OPEN_EXECUTION_STATES.has(String(executionOrder.status || "")));
  if (!openExecutions.length) return { status: "manual", reason: "no_managed_manual_exit_candidate", ...empty };
  const candidates = openExecutions.map((executionOrder) => manualExitCandidate(db, executionOrder, fill));
  const exact = candidates.filter((candidate) => candidate.exact);
  if (exact.length > 1) {
    return { status: "pending", reason: "manual_exit_candidate_ambiguous", ...empty };
  }
  if (exact.length === 1) {
    const candidate = exact[0];
    if (hasMixedExternalEntry(db, candidate.executionOrder, fill, candidate.entryAt, candidate.fillAt)) {
      return {
        status: "pending",
        reason: "mixed_position_attribution",
        executionOrderId: candidate.executionOrder.id,
        planId: candidate.executionOrder.planId || null,
        matchedEntryFillIds: candidate.entryFills.map((entry) => entry.id).filter(Boolean),
        remainingQuantity: candidate.remainingQuantity,
        partial: true
      };
    }
    return {
      status: "matched",
      reason: "deterministic_manual_exit_match",
      executionOrderId: candidate.executionOrder.id,
      planId: candidate.executionOrder.planId || null,
      matchedEntryFillIds: candidate.entryFills.map((entry) => entry.id).filter(Boolean),
      remainingQuantity: candidate.remainingQuantity,
      partial: candidate.fillQuantity + candidate.tolerance < candidate.remainingQuantity
    };
  }
  const conflict = candidates.filter((candidate) => candidate.matchCount >= 5);
  if (conflict.length) {
    const failedChecks = Object.entries(conflict[0].checks).filter(([, matched]) => !matched).map(([name]) => name);
    return {
      status: "pending",
      reason: failedChecks.length === 1 ? `manual_exit_${failedChecks[0]}_mismatch` : "manual_exit_candidate_conflict",
      executionOrderId: conflict.length === 1 ? conflict[0].executionOrder.id : null,
      planId: conflict.length === 1 ? conflict[0].executionOrder.planId || null : null,
      matchedEntryFillIds: conflict.length === 1 ? conflict[0].entryFills.map((entry) => entry.id).filter(Boolean) : [],
      remainingQuantity: conflict.length === 1 ? conflict[0].remainingQuantity : null,
      partial: false
    };
  }
  return { status: "manual", reason: "no_managed_manual_exit_candidate", ...empty };
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
  const classified = classifyTradeFill(db, fill);
  if (classified.scope !== "manual") {
    return {
      ...classified,
      origin: "external_exchange",
      partial: classified.partial ?? fill.partial ?? null
    };
  }
  if (fill.kind === "close" && !fill.executionOrderId && !fill.tradeAttribution?.executionOrderId) {
    const resolution = resolveManualExitAttribution(db, fill);
    if (resolution.status === "matched") {
      const executionOrder = (db.executionOrders || []).find((row) => stringValue(row.id) === stringValue(resolution.executionOrderId));
      return result({
        scope: "system",
        origin: "external_exchange",
        exitMode: "manual_exit",
        executionOrderId: resolution.executionOrderId,
        planId: resolution.planId,
        method: "deterministic_manual_exit",
        reason: null,
        partial: resolution.partial,
        fill,
        executionOrder,
        evidence: {
          ...baseEvidence(fill, executionOrder, attributionEvidence(fill)),
          matchedEntryFillIds: [...resolution.matchedEntryFillIds],
          attributedQuantity: Number(fill.quantity ?? fill.size),
          remainingQuantity: resolution.remainingQuantity
        }
      });
    }
    if (resolution.status === "pending") {
      const executionOrder = (db.executionOrders || []).find((row) => stringValue(row.id) === stringValue(resolution.executionOrderId));
      return result({
        scope: "attribution_pending",
        origin: "external_exchange",
        executionOrderId: resolution.executionOrderId,
        planId: resolution.planId,
        method: "unresolved",
        reason: resolution.reason,
        partial: resolution.partial,
        fill,
        executionOrder,
        evidence: {
          ...baseEvidence(fill, executionOrder, attributionEvidence(fill)),
          matchedEntryFillIds: [...resolution.matchedEntryFillIds],
          attributedQuantity: Number(fill.quantity ?? fill.size),
          remainingQuantity: resolution.remainingQuantity
        }
      });
    }
  }
  return {
    ...classified,
    origin: "external_exchange",
    method: "external_unmanaged"
  };
}

export function projectSystemTradeFill(db, fill) {
  const attribution = classifyTradeFill(db, fill);
  if (attribution.scope !== "system") return null;
  const executionOrder = (db.executionOrders || []).find((row) => stringValue(row?.id) === stringValue(attribution.executionOrderId));
  const financialEvidencePending = fill?.kind === "close"
    && executionOrder?.status === "close_reconciliation_pending"
    && executionOrder?.closeReconciliationReason === "fill_evidence_conflict";
  const projectedAttribution = structuredClone(attribution);
  if (financialEvidencePending) projectedAttribution.partial = true;
  return {
    ...fill,
    executionOrderId: attribution.executionOrderId,
    planId: attribution.planId,
    tradePlanId: attribution.planId,
    partial: financialEvidencePending ? true : (attribution.partial ?? fill.partial),
    tradeAttribution: projectedAttribution
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

function buildAttributedCloseClosure(db = {}, executionOrder = {}, requiredExitMode, options = {}) {
  const reasonPrefix = requiredExitMode === "manual_exit" ? "manual_exit" : "system_exit";
  const systemCloses = (db.fills || []).map((raw) => ({ raw, projected: projectSystemTradeFill(db, raw) }))
    .filter(({ raw, projected }) => raw?.kind === "close" && projected
      && stringValue(projected.executionOrderId) === stringValue(executionOrder.id));
  const requiredCloses = systemCloses.filter(({ projected }) => projected.tradeAttribution?.exitMode === requiredExitMode);
  if (!requiredCloses.length) {
    return { complete: false, reason: `${reasonPrefix}_fills_missing`, fills: [], quantity: 0, tradeIds: [] };
  }
  const matched = systemCloses;
  const fills = matched.map(({ raw }) => raw);
  const quantity = matched.reduce((sum, { raw }) => sum + (positiveNumber(raw.quantity ?? raw.size) || 0), 0);
  const authoritativeTimes = matched.map(({ raw }) => authoritativeFillTime(raw));
  const latestCloseAt = authoritativeTimes.every((value) => value !== null)
    ? new Date(Math.max(...authoritativeTimes)).toISOString()
    : null;
  const expectedQuantity = executionManagedQuantity(db, executionOrder);
  if (!(expectedQuantity > 0)) {
    return {
      complete: false,
      reason: `${reasonPrefix}_managed_quantity_unavailable`,
      fills,
      quantity,
      tradeIds: [],
      closedAt: latestCloseAt
    };
  }
  const tradeIds = matched.map(({ raw }) => stringValue(raw.exchangeTradeId ?? raw.tradeId));
  const financialEvidenceConflict = matched.some(({ raw }) => raw.financialEvidenceConflict === true);
  if (financialEvidenceConflict && options.includeConflictedEvidence !== true) {
    return {
      complete: false,
      reason: `${reasonPrefix}_financial_evidence_conflict`,
      fills,
      quantity,
      tradeIds: tradeIds.filter(Boolean),
      closedAt: latestCloseAt
    };
  }
  if (tradeIds.some((tradeId) => !tradeId) || new Set(tradeIds).size !== tradeIds.length) {
    return {
      complete: false,
      reason: `${reasonPrefix}_trade_identity_incomplete`,
      fills,
      quantity,
      tradeIds: tradeIds.filter(Boolean),
      closedAt: latestCloseAt
    };
  }
  for (const { raw } of matched) {
    const quantity = positiveNumber(raw.quantity ?? raw.size);
    const price = positiveNumber(raw.price);
    const fee = raw.feeCostUsdt ?? raw.feeUsdt;
    if (quantity === null || price === null || !finiteNumber(raw.realizedPnl) || !finiteNumber(fee)
      || raw.estimatedFee === true || authoritativeFillTime(raw) === null) {
      return {
        complete: false,
        reason: `${reasonPrefix}_financial_evidence_incomplete`,
        fills,
        quantity,
        tradeIds,
        closedAt: latestCloseAt
      };
    }
  }
  const entryFills = executionEntryFills(db, executionOrder);
  const entryAt = executionEntryTime(executionOrder, entryFills);
  if (requiredExitMode === "manual_exit"
    && requiredCloses.some(({ raw }) => hasMixedExternalEntry(db, executionOrder, raw, entryAt, authoritativeFillTime(raw)))) {
    return { complete: false, reason: "mixed_position_attribution", fills, quantity, tradeIds, closedAt: latestCloseAt };
  }
  const tolerance = quantityTolerance(executionOrder, expectedQuantity);
  if (Math.abs(quantity - expectedQuantity) > tolerance
    || (requiredExitMode === "manual_exit" && options.includeConflictedEvidence !== true
      && matched.every(({ projected }) => projected.partial === true))) {
    return {
      complete: false,
      reason: `${reasonPrefix}_quantity_incomplete`,
      fills,
      quantity,
      expectedQuantity,
      tradeIds,
      closedAt: latestCloseAt
    };
  }
  const notional = matched.reduce((sum, { raw }) => sum + Number(raw.price) * Number(raw.quantity ?? raw.size), 0);
  return {
    complete: true,
    reason: null,
    fills,
    quantity,
    expectedQuantity,
    weightedPrice: notional / quantity,
    realizedPnl: matched.reduce((sum, { raw }) => sum + Number(raw.realizedPnl), 0),
    feeUsdt: matched.reduce((sum, { raw }) => sum + Number(raw.feeCostUsdt ?? raw.feeUsdt), 0),
    closedAt: latestCloseAt,
    tradeIds,
    exchangeOrderIds: unique(matched.map(({ raw }) => raw.exchangeOrderId)),
    breakdown: matched.map(({ raw }) => ({
      fillId: raw.id || null,
      exchangeOrderId: raw.exchangeOrderId || null,
      tradeId: stringValue(raw.exchangeTradeId ?? raw.tradeId),
      quantity: Number(raw.quantity ?? raw.size),
      price: Number(raw.price),
      realizedPnl: Number(raw.realizedPnl),
      feeUsdt: Number(raw.feeCostUsdt ?? raw.feeUsdt),
      rawFee: finiteNumber(raw.rawFee) ? Number(raw.rawFee) : null,
      feeCurrency: raw.feeCurrency || raw.rawFeeCcy || null,
      closedAt: raw.exchangeFilledAt
    })),
    financialEvidenceConflict,
    evidencePath: requiredExitMode === "manual_exit"
      ? "attributed_external_exchange_fills"
      : "attributed_system_exchange_fills"
  };
}

export function buildAttributedManualExitClosure(db = {}, executionOrder = {}, options = {}) {
  return buildAttributedCloseClosure(db, executionOrder, "manual_exit", options);
}

export function buildAttributedSystemExitClosure(db = {}, executionOrder = {}, options = {}) {
  return buildAttributedCloseClosure(db, executionOrder, "system_exit", options);
}
