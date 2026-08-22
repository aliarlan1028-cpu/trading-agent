import crypto from "node:crypto";

import { recordedFeeCost } from "./financialValues.mjs";
import { canonicalPositionDirection, canonicalSymbol } from "./positionIdentity.mjs";
import { groupPositionMirrors, newestAuthoritativePosition } from "./positionView.mjs";
import { authoritativeFillIdentity, systemTradeFills } from "./systemTradeProjection.mjs";

const QUANTITY_EPSILON = 1e-8;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positive(value) {
  const parsed = finite(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function normalizedEnvironment(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizedExchange(value) {
  return String(value || "OKX").trim().toUpperCase();
}

function fillTime(fill = {}) {
  const at = new Date(fill.exchangeFilledAt || fill.createdAt || fill.closedAt || 0).getTime();
  return Number.isFinite(at) && at > 0 ? at : null;
}

function sameBinding(row = {}, binding = {}) {
  return String(row.accountId || "") === String(binding.accountId || "")
    && normalizedEnvironment(row.environment) === normalizedEnvironment(binding.environment)
    && normalizedExchange(row.exchange) === normalizedExchange(binding.exchange || "OKX");
}

function executionForFill(db, fill, projection = null) {
  if (projection?.executionsById) {
    return projection.executionsById.get(String(fill?.executionOrderId || "")) || null;
  }
  return (db.executionOrders || []).find((row) => String(row?.id || "") === String(fill?.executionOrderId || "")) || null;
}

function fillMatchesBinding(db, fill, binding, projection = null) {
  if (!binding) return true;
  const execution = executionForFill(db, fill, projection);
  return sameBinding({
    accountId: fill.accountId ?? execution?.accountId,
    environment: fill.environment ?? execution?.environment,
    exchange: fill.exchange ?? execution?.exchange
  }, binding);
}

export function createSystemTradeAccountingProjection(db) {
  const fills = systemTradeFills(db);
  const identities = new Map();
  for (const fill of fills) identities.set(fill, authoritativeFillIdentity(db, fill));
  return {
    sourceDb: db,
    fills,
    identities,
    executionsById: new Map((db.executionOrders || []).map((row) => [String(row?.id || ""), row]))
  };
}

function resolveSystemTradeAccountingProjection(db, projection) {
  return projection?.sourceDb === db ? projection : createSystemTradeAccountingProjection(db);
}

export function realizedPnlForFills(fills = [], sinceMs, untilMs = Date.now()) {
  let knownTotal = 0;
  let knownFacts = 0;
  let pending = 0;
  let total = 0;
  for (const fill of fills) {
    if (!["entry", "close"].includes(fill?.kind)) continue;
    const at = fillTime(fill);
    if (at === null || at < sinceMs || at > untilMs) continue;
    total += 1;
    const fee = recordedFeeCost(fill);
    const feeKnown = fee !== null && fill.estimatedFee !== true;
    if (fill.kind === "entry") {
      if (feeKnown) { knownTotal -= fee; knownFacts += 1; }
      else pending += 1;
      continue;
    }
    const gross = finite(fill.realizedPnl);
    if (gross !== null) { knownTotal += gross; knownFacts += 1; }
    else pending += 1;
    if (feeKnown) { knownTotal -= fee; knownFacts += 1; }
    else pending += 1;
    const funding = finite(fill.fundingFeeUsdt);
    if (fill.fundingReconciled === true && funding !== null) {
      knownTotal += funding;
      knownFacts += 1;
    } else {
      pending += 1;
    }
  }
  return { value: knownTotal, knownTotal, reconciled: knownFacts, pending, total };
}

function financialFingerprint(fill = {}) {
  return JSON.stringify({
    kind: fill.kind ?? null,
    quantity: fill.quantity ?? fill.size ?? null,
    price: fill.price ?? null,
    realizedPnl: fill.realizedPnl ?? null,
    feeCostUsdt: fill.feeCostUsdt ?? null,
    feeUsdt: fill.feeUsdt ?? null,
    estimatedFee: fill.estimatedFee === true,
    fundingFeeUsdt: fill.fundingFeeUsdt ?? null,
    fundingReconciled: fill.fundingReconciled === true,
    exchangeFilledAt: fill.exchangeFilledAt ?? null
  });
}

function unresolvedFinancialFacts(fill = {}) {
  const base = {
    fillId: fill.id || null,
    executionOrderId: fill.executionOrderId || null,
    symbol: canonicalSymbol(fill.symbol || fill.instId) || null,
    kind: fill.kind || null
  };
  const facts = [];
  const fee = recordedFeeCost(fill);
  if (fee === null || fill.estimatedFee === true) {
    facts.push({ ...base, reason: fill.kind === "entry" ? "entry_fee_unresolved" : "close_fee_unresolved" });
  }
  if (fill.kind === "close") {
    if (finite(fill.realizedPnl) === null) facts.push({ ...base, reason: "close_realized_pnl_unresolved" });
    if (fill.fundingReconciled !== true || finite(fill.fundingFeeUsdt) === null) {
      facts.push({ ...base, reason: "close_funding_unresolved" });
    }
  }
  return facts;
}

function dedupeSystemAccountingFills(db, options = {}) {
  const accountingProjection = resolveSystemTradeAccountingProjection(db, options.projection);
  const groups = [];
  for (const fill of accountingProjection.fills) {
    const at = fillTime(fill);
    if (Number.isFinite(options.untilMs) && at !== null && at > options.untilMs) continue;
    const identity = accountingProjection.identities.get(fill) || authoritativeFillIdentity(db, fill);
    const tradeIds = new Set(identity.tradeIds);
    const fallbackId = tradeIds.size ? null : String(fill.id || "");
    const compatible = (group) => group.kind === fill.kind
      && group.exchange === identity.exchange
      && group.accountId === identity.accountId
      && group.environment === identity.environment
      && group.symbol === identity.symbol
      && (tradeIds.size
        ? [...tradeIds].some((tradeId) => group.tradeIds.has(tradeId))
        : fallbackId && group.fallbackId === fallbackId);
    const matching = groups.filter(compatible);
    const group = matching.shift() || {
      kind: fill.kind,
      exchange: identity.exchange,
      accountId: identity.accountId,
      environment: identity.environment,
      symbol: identity.symbol,
      tradeIds: new Set(),
      fallbackId,
      fills: []
    };
    if (!groups.includes(group)) groups.push(group);
    for (const extra of matching) {
      extra.tradeIds.forEach((tradeId) => group.tradeIds.add(tradeId));
      group.fills.push(...extra.fills);
      groups.splice(groups.indexOf(extra), 1);
    }
    tradeIds.forEach((tradeId) => group.tradeIds.add(tradeId));
    group.fills.push(fill);
  }

  const fills = [];
  const conflicts = [];
  for (const group of groups) {
    const fingerprints = new Set(group.fills.map(financialFingerprint));
    const explicitConflict = group.fills.some((fill) => {
      const execution = executionForFill(db, fill, accountingProjection);
      return fill.financialEvidenceConflict === true
        || (execution?.status === "close_reconciliation_pending"
          && ["fill_evidence_conflict", "authoritative_close_evidence_incomplete"].includes(execution.closeReconciliationReason));
    });
    if (explicitConflict || fingerprints.size > 1) {
      conflicts.push({
        reason: "system_fill_financial_evidence_conflict",
        exchange: group.exchange,
        accountId: group.accountId,
        environment: group.environment,
        symbol: group.symbol,
        fillIds: group.fills.map((fill) => fill.id || null),
        tradeIds: [...group.tradeIds],
        fillTimes: group.fills.map((fill) => fillTime(fill)).filter((at) => at !== null)
      });
      continue;
    }
    fills.push(group.fills[0]);
  }
  return { fills, conflicts, accountingProjection };
}

export function systemRealizedPnlSince(db, sinceMs, untilMs = Date.now(), options = {}) {
  const projected = dedupeSystemAccountingFills(db, { untilMs, projection: options.projection });
  const fills = projected.fills.filter((fill) => fillMatchesBinding(db, fill, options.binding, projected.accountingProjection));
  const state = realizedPnlForFills(fills, sinceMs, untilMs);
  const pendingFacts = fills.filter((fill) => {
    const at = fillTime(fill);
    return at !== null && at >= sinceMs && at <= untilMs;
  }).flatMap(unresolvedFinancialFacts);
  const conflicts = projected.conflicts.filter((conflict) => (
    (!options.binding || sameBinding(conflict, options.binding))
    && conflict.fillTimes.some((at) => at >= sinceMs && at <= untilMs)
  ));
  return {
    ...state,
    pending: state.pending + conflicts.length,
    pendingFacts: [...pendingFacts, ...conflicts],
    conflicts
  };
}

function slotIdentity(row = {}) {
  const accountId = String(row.accountId || "").trim();
  const environment = normalizedEnvironment(row.environment);
  const exchange = normalizedExchange(row.exchange);
  const symbol = canonicalSymbol(row.symbol || row.instId);
  const direction = canonicalPositionDirection(row);
  if (!accountId || !environment || !exchange || !symbol || !direction) return null;
  return `${accountId}|${environment}|${exchange}|${symbol}|${direction}`;
}

function quantityTolerance(value) {
  return Math.max(QUANTITY_EPSILON, Math.abs(Number(value || 0)) * 0.000001);
}

function executionEntryExpectedAt(execution = {}, atMs) {
  const quantity = positive(execution.filledQuantity);
  const entryAt = new Date(execution.entryFilledAt || 0).getTime();
  return quantity !== null && Number.isFinite(entryAt) && entryAt > 0 && entryAt <= atMs;
}

function uniqueFacts(values, normalize = (value) => String(value || "").trim()) {
  return [...new Set(values.map((value) => normalize(value)).filter(Boolean))];
}

function resolvedExecutionFacts(execution, rows) {
  const fields = {
    accountId: uniqueFacts([execution.accountId, ...rows.map((row) => row.accountId)]),
    environment: uniqueFacts([execution.environment, ...rows.map((row) => row.environment)], normalizedEnvironment),
    exchange: uniqueFacts([execution.exchange, ...rows.map((row) => row.exchange)], normalizedExchange),
    symbol: uniqueFacts([execution.symbol, ...rows.map((row) => row.symbol)], canonicalSymbol),
    direction: uniqueFacts([execution.direction, ...rows.map((row) => row.direction)], canonicalPositionDirection)
  };
  if (Object.values(fields).some((values) => values.length > 1)) return { ok: false, reason: "managed_position_binding_conflict" };
  const row = Object.fromEntries(Object.entries(fields).map(([key, values]) => [key, values[0] || null]));
  return { ok: Boolean(slotIdentity(row)), reason: "managed_position_binding_incomplete", row };
}

function managedSlotsAt(db, atMs, binding, projection = null) {
  const projected = dedupeSystemAccountingFills(db, { untilMs: atMs, projection });
  const fills = projected.fills.filter((fill) => {
    const at = fillTime(fill);
    return at !== null && at <= atMs;
  });
  const byExecution = new Map();
  for (const fill of fills) {
    const id = String(fill.executionOrderId || "");
    if (!id) continue;
    const rows = byExecution.get(id) || [];
    rows.push(fill);
    byExecution.set(id, rows);
  }

  const slots = new Map();
  const pending = projected.conflicts
    .filter((conflict) => !binding || sameBinding(conflict, binding))
    .map((conflict) => ({ ...conflict }));
  for (const execution of db.executionOrders || []) {
    const rows = byExecution.get(String(execution.id || "")) || [];
    const resolved = resolvedExecutionFacts(execution, rows);
    if (!resolved.ok) {
      if (rows.length || executionEntryExpectedAt(execution, atMs)) {
        pending.push({ executionOrderId: execution.id || null, reason: resolved.reason });
      }
      continue;
    }
    if (binding && !sameBinding(resolved.row, binding)) continue;
    const entries = rows.filter((fill) => fill.kind === "entry");
    const closes = rows.filter((fill) => fill.kind === "close");
    const entryQuantity = entries.reduce((sum, fill) => sum + (positive(fill.quantity ?? fill.size) || 0), 0);
    const closeQuantity = closes.reduce((sum, fill) => sum + (positive(fill.quantity ?? fill.size) || 0), 0);
    if (!(entryQuantity > 0)) {
      if (executionEntryExpectedAt(execution, atMs)) {
        pending.push({ executionOrderId: execution.id || null, reason: "managed_entry_provenance_incomplete" });
      }
      continue;
    }
    const tolerance = quantityTolerance(entryQuantity);
    if (closeQuantity > entryQuantity + tolerance) {
      pending.push({ executionOrderId: execution.id || null, reason: "managed_close_quantity_conflict" });
      continue;
    }
    const remaining = Math.max(0, entryQuantity - closeQuantity);
    if (remaining <= tolerance) continue;
    const identity = slotIdentity(resolved.row);
    if (!identity) {
      pending.push({ executionOrderId: execution.id || null, reason: "managed_position_binding_incomplete" });
      continue;
    }
    const slot = slots.get(identity) || {
      identity,
      accountId: resolved.row.accountId,
      environment: resolved.row.environment,
      exchange: resolved.row.exchange,
      symbol: resolved.row.symbol,
      direction: resolved.row.direction,
      quantity: 0,
      executions: []
    };
    slot.quantity += remaining;
    slot.executions.push({ id: execution.id || null, quantity: remaining, okxCtVal: positive(execution.okxCtVal) });
    slots.set(identity, slot);
  }
  return { slots, pending };
}

function currentAuthoritativeRows(positions = [], options = {}) {
  const rows = [];
  for (const mirrors of groupPositionMirrors(positions).values()) {
    const authority = newestAuthoritativePosition(mirrors, options);
    if (authority.row) rows.push({ row: authority.row, authority });
  }
  return rows;
}

function snapshotRows(snapshot = {}) {
  return (snapshot.positions || []).map((row) => ({
    row: {
      ...row,
      exchange: snapshot.exchange || "OKX",
      accountId: snapshot.accountId,
      environment: snapshot.environment,
      symbol: row.symbol || row.instId
    },
    authority: { fresh: true, reason: null }
  }));
}

function positionQuantity(row = {}, slot = {}) {
  const coinSize = positive(row.coinSize);
  if (coinSize !== null) return coinSize;
  const rawContracts = positive(row.rawPos ?? row.pos ?? row.size);
  const explicitCtVal = positive(row.ctVal ?? row.contractMultiplier);
  const executionCtVals = [...new Set((slot.executions || []).map((item) => item.okxCtVal).filter((value) => value !== null))];
  const ctVal = explicitCtVal ?? (executionCtVals.length === 1 ? executionCtVals[0] : null);
  return rawContracts !== null && ctVal !== null ? rawContracts * ctVal : null;
}

function positionPnl(row = {}) {
  return finite(row.pnl ?? row.upl ?? row.unrealizedPnl);
}

function evidenceHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function systemUnrealizedPnl(db, options = {}) {
  const atMs = Number(options.atMs ?? options.now ?? Date.now());
  const binding = options.binding || null;
  const managed = managedSlotsAt(db, atMs, binding, options.projection);
  const candidates = options.snapshot
    ? snapshotRows(options.snapshot)
    : currentAuthoritativeRows(options.positions || db.positions || [], { now: atMs, maxAgeMs: options.maxAgeMs });
  const pendingPositions = [...managed.pending];
  const evidence = [];
  let knownTotal = 0;

  for (const slot of managed.slots.values()) {
    const matches = candidates.filter(({ row }) => slotIdentity(row) === slot.identity);
    if (matches.length !== 1) {
      pendingPositions.push({ identity: slot.identity, reason: matches.length ? "managed_position_ambiguous" : "managed_position_unavailable" });
      continue;
    }
    const { row, authority } = matches[0];
    if (!authority.fresh) {
      pendingPositions.push({ identity: slot.identity, reason: authority.reason || "managed_position_stale", positionId: row.id || null });
      continue;
    }
    const quantity = positionQuantity(row, slot);
    if (quantity === null) {
      pendingPositions.push({ identity: slot.identity, reason: "managed_position_quantity_unavailable", positionId: row.id || null });
      continue;
    }
    if (Math.abs(quantity - slot.quantity) > quantityTolerance(slot.quantity)) {
      pendingPositions.push({
        identity: slot.identity,
        reason: "managed_position_quantity_mismatch",
        positionId: row.id || null,
        managedQuantity: slot.quantity,
        authoritativeQuantity: quantity
      });
      continue;
    }
    const pnl = positionPnl(row);
    if (pnl === null) {
      pendingPositions.push({ identity: slot.identity, reason: "managed_position_pnl_unavailable", positionId: row.id || null });
      continue;
    }
    knownTotal += pnl;
    evidence.push({
      identity: slot.identity,
      executionOrders: slot.executions.map((item) => ({ id: item.id, quantity: item.quantity })),
      managedQuantity: slot.quantity,
      authoritativeQuantity: quantity,
      unrealizedPnlUsdt: pnl,
      positionId: row.id || row.posId || null
    });
  }

  const complete = pendingPositions.length === 0;
  return {
    knownTotal,
    pendingPositions,
    complete,
    attributionEvidenceHash: complete ? evidenceHash({
      at: new Date(atMs).toISOString(),
      binding: binding ? {
        accountId: binding.accountId,
        environment: normalizedEnvironment(binding.environment),
        exchange: normalizedExchange(binding.exchange || "OKX")
      } : null,
      positions: evidence.sort((a, b) => a.identity.localeCompare(b.identity))
    }) : null
  };
}
