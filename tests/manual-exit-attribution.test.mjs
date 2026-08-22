import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { applyOkxLifecycleFinancialEvidence, pollExecutionOrders, reconcilePendingClose } from "../server/executionEngine.mjs";
import { reconcilePendingOkxFillIdentities, upsertOkxOrder } from "../server/realtimeManager.mjs";
import * as projection from "../server/systemTradeProjection.mjs";

const ORIGINAL_OKX_API_KEY = process.env.OKX_API_KEY;
const API_KEY = "manual-exit-attribution-key";
const API_KEY_FINGERPRINT = crypto.createHash("sha256").update(API_KEY).digest("hex").slice(0, 16);
const ENTRY_AT = "2026-08-14T23:00:00.000Z";
const CLOSE_AT = "2026-08-15T01:00:00.000Z";

process.env.OKX_API_KEY = API_KEY;
test.after(() => {
  if (ORIGINAL_OKX_API_KEY === undefined) delete process.env.OKX_API_KEY;
  else process.env.OKX_API_KEY = ORIGINAL_OKX_API_KEY;
});

function addManagedExecution(db, options = {}) {
  const suffix = options.suffix || "1";
  const execution = {
    id: options.executionOrderId || `exec-${suffix}`,
    planId: options.planId || `plan-${suffix}`,
    exchange: "OKX",
    accountId: options.accountId || "account-a",
    environment: options.environment || "production",
    apiKeyFingerprint: API_KEY_FINGERPRINT,
    symbol: options.symbol || "BTC/USDT",
    direction: options.direction || "long",
    status: options.status || "protecting",
    quantity: options.quantity ?? 0.01,
    filledQuantity: options.quantity ?? 0.01,
    entryPrice: 59_000,
    filledPrice: 59_000,
    entryFilledAt: options.entryFilledAt || ENTRY_AT,
    closeSubmittedAt: "2026-08-15T00:30:00.000Z",
    exchangeOrderId: `entry-order-${suffix}`,
    clientOrderId: `entry-client-${suffix}`,
    events: []
  };
  const plan = {
    id: execution.planId,
    exchange: execution.exchange,
    accountId: execution.accountId,
    environment: execution.environment,
    symbol: execution.symbol,
    direction: execution.direction,
    status: "executing"
  };
  const entry = {
    id: `entry-fill-${suffix}`,
    executionOrderId: execution.id,
    planId: execution.planId,
    tradePlanId: execution.planId,
    exchange: "OKX",
    exchangeOrderId: execution.exchangeOrderId,
    exchangeTradeId: `entry-trade-${suffix}`,
    accountId: execution.accountId,
    environment: execution.environment,
    symbol: execution.symbol,
    direction: execution.direction,
    side: execution.direction === "short" ? "sell" : "buy",
    kind: "entry",
    price: execution.entryPrice,
    quantity: execution.filledQuantity,
    feeUsdt: 0.01,
    feeCostUsdt: 0.01,
    feeSchemaVersion: 2,
    feeSource: "okx_raw_fill_history",
    estimatedFee: false,
    exchangeFilledAt: execution.entryFilledAt,
    createdAt: execution.entryFilledAt,
    tradeAttribution: {
      schemaVersion: 1,
      scope: "system",
      origin: "execution_engine",
      exitMode: null,
      executionOrderId: execution.id,
      planId: execution.planId,
      method: "execution_writer",
      reason: null,
      evidence: {
        accountId: execution.accountId,
        environment: execution.environment,
        exchangeOrderId: execution.exchangeOrderId,
        exchangeTradeId: `entry-trade-${suffix}`,
        matchedEntryFillIds: [],
        attributedQuantity: execution.filledQuantity
      },
      attributedAt: execution.entryFilledAt
    }
  };
  db.executionOrders.push(execution);
  db.tradePlans.push(plan);
  db.fills.push(entry);
  db.positions.push({
    id: `engine-position-${suffix}`,
    source: "execution_engine",
    executionOrderId: execution.id,
    planId: execution.planId,
    exchange: "OKX",
    symbol: execution.symbol,
    direction: execution.direction,
    size: execution.filledQuantity
  });
  return execution;
}

function managedDb(options = {}) {
  const db = {
    user: { id: "owner", tenantId: "tenant-owner" },
    system: {},
    orders: [],
    fills: [],
    executionOrders: [],
    tradePlans: [],
    positions: [],
    riskIncidents: [],
    reviews: [],
    memoryItems: [],
    exchangeAccounts: [{
      id: "account-a",
      exchange: "OKX",
      readEnabled: true,
      tradeEnabled: true,
      apiKeyFingerprint: API_KEY_FINGERPRINT
    }],
    evidenceBundles: [{
      symbols: ["BTC/USDT", "ETH/USDT"].map((symbol) => ({ symbol, contractSpec: { data: { ctVal: 0.01 } } }))
    }]
  };
  const execution = addManagedExecution(db, options);
  return { db, execution };
}

function closePayload(overrides = {}) {
  return {
    ordId: "manual-close-order-1",
    clOrdId: "",
    instId: "BTC-USDT-SWAP",
    instType: "SWAP",
    side: "sell",
    posSide: "long",
    reduceOnly: "true",
    state: "filled",
    fillSz: "1",
    accFillSz: "1",
    fillPx: "60000",
    fillPnl: "10",
    tradeId: "manual-close-trade-1",
    fee: "-0.01",
    feeCcy: "USDT",
    fillTime: String(Date.parse(CLOSE_AT)),
    ...overrides
  };
}

function context(overrides = {}) {
  return {
    accountId: "account-a",
    apiKeyFingerprint: API_KEY_FINGERPRINT,
    environment: "production",
    ...overrides
  };
}

function insertClose(db, payload = closePayload(), binding = context()) {
  upsertOkxOrder(db, payload, binding);
  return db.fills.find((fill) => fill.exchangeTradeId === payload.tradeId && fill.kind === "close");
}

function addSystemClose(db, execution, options = {}) {
  const fill = {
    id: options.id || "system-close-fill",
    executionOrderId: execution.id,
    planId: execution.planId,
    tradePlanId: execution.planId,
    exchange: "OKX",
    exchangeOrderId: options.exchangeOrderId || "system-tp-order",
    exchangeTradeId: options.exchangeTradeId || "system-tp-trade",
    accountId: execution.accountId,
    environment: execution.environment,
    symbol: execution.symbol,
    direction: execution.direction,
    side: execution.direction === "short" ? "buy" : "sell",
    kind: "close",
    partial: options.partial ?? true,
    price: options.price ?? 61_000,
    quantity: options.quantity ?? 0.01,
    realizedPnl: options.realizedPnl ?? 4,
    feeUsdt: options.feeUsdt ?? 0.02,
    feeCostUsdt: options.feeUsdt ?? 0.02,
    feeSchemaVersion: 2,
    feeSource: "okx_raw_fill_history",
    estimatedFee: false,
    exchangeFilledAt: options.exchangeFilledAt || "2026-08-15T00:30:00.000Z",
    createdAt: options.exchangeFilledAt || "2026-08-15T00:30:00.000Z"
  };
  fill.tradeAttribution = {
    schemaVersion: 1,
    scope: "system",
    origin: "execution_engine",
    exitMode: "system_exit",
    executionOrderId: execution.id,
    planId: execution.planId,
    method: "execution_writer",
    reason: null,
    partial: fill.partial,
    evidence: {
      accountId: execution.accountId,
      environment: execution.environment,
      exchangeOrderId: fill.exchangeOrderId,
      exchangeTradeId: fill.exchangeTradeId,
      matchedEntryFillIds: ["entry-fill-1"],
      attributedQuantity: fill.quantity
    },
    attributedAt: fill.exchangeFilledAt
  };
  db.fills.unshift(fill);
  return fill;
}

test("known system close identities win before deterministic manual-exit matching", async (t) => {
  const cases = [
    ["close order", "closeExchangeOrderId", "exchangeOrderId"],
    ["protection order", "protectionExchangeOrderId", "exchangeOrderId"],
    ["stop order", "stopExchangeOrderId", "exchangeOrderId"],
    ["take-profit order", "tpExchangeOrderId", "exchangeOrderId"],
    ["close client", "closeClientOrderId", "clientOrderId"],
    ["protection client", "protectionClientOrderId", "clientOrderId"],
    ["stop client", "stopClientOrderId", "clientOrderId"],
    ["take-profit client", "tpClientOrderId", "clientOrderId"]
  ];
  for (const [name, executionField, fillField] of cases) await t.test(name, () => {
    const { db, execution } = managedDb();
    execution[executionField] = `managed-${executionField}`;
    const fill = {
      kind: "close",
      exchange: "OKX",
      accountId: "account-a",
      environment: "production",
      symbol: "BTC/USDT",
      side: "sell",
      quantity: 0.01,
      price: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      exchangeTradeId: `trade-${executionField}`,
      exchangeFilledAt: CLOSE_AT,
      [fillField]: execution[executionField]
    };

    const attribution = projection.buildExternalFillAttribution(db, fill);

    assert.equal(attribution.scope, "system");
    assert.equal(attribution.executionOrderId, execution.id);
    assert.equal(attribution.exitMode, "system_exit");
    assert.notEqual(attribution.method, "deterministic_manual_exit");
  });
});

test("an exact external close is projected as the managed execution's manual exit", () => {
  const { db } = managedDb();

  const close = insertClose(db);

  assert.equal(close.tradeAttribution.scope, "system");
  assert.equal(close.tradeAttribution.exitMode, "manual_exit");
  assert.equal(close.tradeAttribution.executionOrderId, "exec-1");
  assert.deepEqual(close.tradeAttribution.evidence.matchedEntryFillIds, ["entry-fill-1"]);
  assert.equal(projection.groupSystemClosedTradeLifecycles(db)[0].key, "exec-1");
});

test("partial external closes stay incomplete until the final close and aggregate under one lifecycle", () => {
  const { db } = managedDb({ quantity: 0.02 });

  const first = insertClose(db, closePayload({
    ordId: "manual-close-order-partial",
    tradeId: "manual-close-trade-partial",
    fillPnl: "3",
    fillTime: String(Date.parse("2026-08-15T00:50:00.000Z"))
  }));
  assert.equal(first.partial, undefined);
  const projectedFirst = projection.projectSystemTradeFill(db, first);
  assert.ok(projectedFirst, "the attributed partial close must enter the system projection");
  assert.equal(projectedFirst.partial, true);
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);

  const final = insertClose(db, closePayload({
    ordId: "manual-close-order-final",
    tradeId: "manual-close-trade-final",
    fillPnl: "7"
  }));
  assert.equal(final.partial, undefined);
  const projectedFinal = projection.projectSystemTradeFill(db, final);
  assert.ok(projectedFinal, "the attributed final close must enter the system projection");
  assert.equal(projectedFinal.partial, false);
  const lifecycle = projection.groupSystemClosedTradeLifecycles(db)[0];
  assert.equal(lifecycle.key, "exec-1");
  assert.deepEqual(lifecycle.fills.map((fill) => fill.exchangeTradeId).sort(), [
    "manual-close-trade-final", "manual-close-trade-partial"
  ]);
  assert.equal(lifecycle.quantity, 0.02);
  assert.equal(lifecycle.realizedPnl, 10);
});

test("a manual residual closes after a verified system partial close and settles aggregate economics", () => {
  const { db, execution } = managedDb({ quantity: 0.02, status: "close_reconciliation_pending" });
  const systemPartial = addSystemClose(db, execution);
  const systemBefore = structuredClone(systemPartial);

  const manualResidual = insertClose(db, closePayload({ fillPnl: "6" }));

  assert.equal(manualResidual.tradeAttribution.scope, "system");
  assert.equal(manualResidual.tradeAttribution.exitMode, "manual_exit");
  assert.equal(projection.projectSystemTradeFill(db, manualResidual).partial, false);
  const closure = projection.buildAttributedManualExitClosure(db, execution);
  assert.equal(closure.complete, true);
  assert.equal(closure.quantity, 0.02);
  assert.equal(closure.weightedPrice, 60_500);
  assert.equal(closure.realizedPnl, 10);
  assert.equal(closure.feeUsdt, 0.03);

  const manualBefore = structuredClone(manualResidual);
  const result = reconcilePendingClose(db, execution, {
    snapshot: {
      id: "snapshot-after-residual",
      exchange: "OKX",
      accountId: "account-a",
      environment: "production",
      apiKeyFingerprint: API_KEY_FINGERPRINT,
      status: "ok",
      positions: [],
      createdAt: "2026-08-15T02:00:00.000Z"
    }
  });

  assert.equal(result.status, "closed");
  assert.equal(execution.realizedPnl, 10);
  assert.equal(execution.closeFeeUsdt, 0.03);
  assert.equal(db.fills.filter((fill) => fill.kind === "close").length, 2);
  for (const [actual, before] of [[systemPartial, systemBefore], [manualResidual, manualBefore]]) {
    assert.deepEqual({
      price: actual.price,
      quantity: actual.quantity,
      realizedPnl: actual.realizedPnl,
      feeUsdt: actual.feeUsdt,
      exchangeOrderId: actual.exchangeOrderId,
      exchangeTradeId: actual.exchangeTradeId,
      exchangeFilledAt: actual.exchangeFilledAt,
      createdAt: actual.createdAt
    }, {
      price: before.price,
      quantity: before.quantity,
      realizedPnl: before.realizedPnl,
      feeUsdt: before.feeUsdt,
      exchangeOrderId: before.exchangeOrderId,
      exchangeTradeId: before.exchangeTradeId,
      exchangeFilledAt: before.exchangeFilledAt,
      createdAt: before.createdAt
    });
  }
  assert.equal(systemPartial.tradeAttribution.exitMode, "system_exit");
  assert.notEqual(systemPartial.exitReason, "manual_exit");
});

test("the real OKX writer recognizes a persisted close client ID before inserting an external fill", () => {
  const { db, execution } = managedDb();
  execution.closeClientOrderId = "managed-close-client";

  upsertOkxOrder(db, closePayload({
    ordId: "not-yet-bound-close-order",
    clOrdId: execution.closeClientOrderId,
    tradeId: "managed-close-client-trade"
  }), context());

  const raw = db.fills.find((fill) => fill.exchangeTradeId === "managed-close-client-trade");
  assert.ok(raw, "the authoritative system close must be persisted before reconciliation");
  assert.equal(raw.tradeAttribution.scope, "system");
  assert.equal(raw.tradeAttribution.exitMode, "system_exit");
  const order = db.orders.find((row) => row.exchangeOrderId === "not-yet-bound-close-order");
  assert.equal(order.clientOrderId, "managed-close-client");
  assert.equal(order.executionOrderId, execution.id);
});

test("the real OKX writer recognizes persisted protection client and algo IDs", async (t) => {
  for (const [name, executionField, payloadField, value] of [
    ["algo client", "stopClientOrderId", "algoClOrdId", "managed-stop-client"],
    ["algo ID", "stopAlgoId", "algoId", "managed-stop-algo"]
  ]) await t.test(name, () => {
    const { db, execution } = managedDb();
    execution[executionField] = value;
    const tradeId = `managed-${name.replace(" ", "-")}-trade`;

    upsertOkxOrder(db, closePayload({
      ordId: `unbound-${name.replace(" ", "-")}-order`,
      clOrdId: "",
      tradeId,
      [payloadField]: value
    }), context());

    const raw = db.fills.find((fill) => fill.exchangeTradeId === tradeId);
    assert.ok(raw, "the authoritative protection close must be persisted before reconciliation");
    assert.equal(raw.tradeAttribution.scope, "system");
    assert.equal(raw.tradeAttribution.exitMode, "system_exit");
    assert.equal(db.orders[0].executionOrderId, execution.id);
  });
});

test("a system WS close remains a lossless raw fact when reconciliation fetch fails and duplicate echoes arrive", async () => {
  const { db, execution } = managedDb({ status: "close_reconciliation_pending" });
  execution.closeClientOrderId = "lossless-close-client";
  execution.stopClientOrderId = "lossless-close-algo-client";
  execution.stopAlgoId = "lossless-close-algo";
  const payload = closePayload({
    ordId: "lossless-close-order",
    clOrdId: execution.closeClientOrderId,
    algoClOrdId: "lossless-close-algo-client",
    algoId: "lossless-close-algo",
    tradeId: "lossless-close-trade"
  });

  upsertOkxOrder(db, payload, context());
  upsertOkxOrder(db, payload, context());
  let outboundActions = 0;
  const result = await pollExecutionOrders(db, {
    snapshot: {
      id: "snapshot-before-lossless-close",
      exchange: "OKX",
      accountId: "account-a",
      environment: "production",
      apiKeyFingerprint: API_KEY_FINGERPRINT,
      status: "ok",
      positions: [{ instId: "BTC-USDT-SWAP", posSide: "long", pos: "1" }],
      createdAt: "2026-08-15T00:45:00.000Z"
    },
    nowMs: Date.parse("2026-08-15T02:00:00.000Z"),
    closeProgressSlaMs: 0,
    maxCloseRetries: 1,
    executeTradeAction: async () => { outboundActions += 1; throw new Error("system fill must suppress outbound retry"); },
    fetchManualClosure: async () => { throw new Error("fills history unavailable"); }
  });

  const raw = db.fills.filter((fill) => fill.exchangeTradeId === payload.tradeId);
  assert.equal(raw.length, 1, "duplicate WS echoes must retain one raw trade fact");
  assert.deepEqual({
    price: raw[0].price,
    quantity: raw[0].quantity,
    rawContracts: raw[0].rawContracts,
    realizedPnl: raw[0].realizedPnl,
    feeUsdt: raw[0].feeUsdt,
    rawFee: raw[0].rawFee,
    feeCurrency: raw[0].feeCurrency,
    exchangeOrderId: raw[0].exchangeOrderId,
    clientOrderId: raw[0].clientOrderId,
    algoClientOrderId: raw[0].algoClientOrderId,
    algoId: raw[0].algoId,
    exchangeTradeId: raw[0].exchangeTradeId,
    exchangeFilledAt: raw[0].exchangeFilledAt
  }, {
    price: 60_000,
    quantity: 0.01,
    rawContracts: 1,
    realizedPnl: 10,
    feeUsdt: 0.01,
    rawFee: -0.01,
    feeCurrency: "USDT",
    exchangeOrderId: "lossless-close-order",
    clientOrderId: "lossless-close-client",
    algoClientOrderId: "lossless-close-algo-client",
    algoId: "lossless-close-algo",
    exchangeTradeId: "lossless-close-trade",
    exchangeFilledAt: CLOSE_AT
  });
  assert.equal(raw[0].tradeAttribution.scope, "system");
  assert.equal(raw[0].tradeAttribution.exitMode, "system_exit");
  assert.equal(outboundActions, 0);
  assert.equal(result.results[0].status, "poll_error");
});

test("a repeated system entry echo is not persisted as a close after the execution starts protecting", () => {
  const { db, execution } = managedDb({ status: "protecting" });
  upsertOkxOrder(db, closePayload({
    ordId: execution.exchangeOrderId,
    clOrdId: execution.clientOrderId,
    side: "buy",
    posSide: "long",
    reduceOnly: "false",
    fillPnl: "0",
    tradeId: "repeated-system-entry-trade"
  }), context());

  assert.equal(db.fills.some((fill) => fill.exchangeTradeId === "repeated-system-entry-trade"), false);
});

test("a conflicting duplicate system echo preserves the first raw fact and blocks settlement", () => {
  const { db, execution } = managedDb({ status: "close_reconciliation_pending" });
  execution.closeExchangeOrderId = "duplicate-conflict-order";
  const payload = closePayload({ ordId: execution.closeExchangeOrderId, tradeId: "duplicate-conflict-trade" });
  upsertOkxOrder(db, payload, context());
  upsertOkxOrder(db, { ...payload, fillPx: "60001" }, context());

  const result = reconcilePendingClose(db, execution, {
    snapshot: {
      id: "snapshot-after-duplicate-conflict",
      exchange: "OKX",
      accountId: "account-a",
      environment: "production",
      apiKeyFingerprint: API_KEY_FINGERPRINT,
      status: "ok",
      positions: [],
      createdAt: "2026-08-15T02:00:00.000Z"
    }
  });

  const raw = db.fills.filter((fill) => fill.exchangeTradeId === payload.tradeId);
  assert.equal(raw.length, 1);
  assert.equal(raw[0].price, 60_000);
  assert.equal(result.status, "close_reconciliation_pending");
  assert.equal(result.settlement, "fill_evidence_incomplete");
});

test("a forged raw system scope cannot reopen an execution when persisted bindings conflict", () => {
  const { db, execution } = managedDb({ status: "closed" });
  const plan = db.tradePlans.find((row) => row.id === execution.planId);
  plan.status = "completed";
  const forged = {
    id: "forged-conflict-fill",
    executionOrderId: execution.id,
    planId: execution.planId,
    tradePlanId: execution.planId,
    exchange: "OKX",
    exchangeOrderId: "forged-conflict-order",
    exchangeTradeId: "forged-conflict-trade",
    accountId: "account-a",
    environment: "production",
    symbol: "ETH/USDT",
    direction: "long",
    side: "sell",
    kind: "close",
    partial: false,
    price: 2_000,
    quantity: 0.01,
    realizedPnl: 1,
    feeUsdt: 0.01,
    feeCostUsdt: 0.01,
    estimatedFee: false,
    exchangeFilledAt: CLOSE_AT,
    createdAt: CLOSE_AT,
    tradeAttribution: {
      scope: "system",
      executionOrderId: execution.id,
      planId: execution.planId,
      exitMode: "system_exit",
      method: "forged"
    }
  };
  db.fills.unshift(forged);
  assert.equal(projection.projectSystemTradeFill(db, forged), null);

  upsertOkxOrder(db, closePayload({
    ordId: forged.exchangeOrderId,
    instId: "ETH-USDT-SWAP",
    fillPx: "2001",
    tradeId: forged.exchangeTradeId
  }), context());

  assert.equal(forged.financialEvidenceConflict, true);
  assert.equal(execution.status, "closed");
  assert.equal(plan.status, "completed");
});

test("validated legacy positive provenance reopens on a conflicting duplicate without raw attribution metadata", () => {
  const { db, execution } = managedDb({ status: "closed" });
  const plan = db.tradePlans.find((row) => row.id === execution.planId);
  plan.status = "completed";
  execution.closeExchangeOrderId = "legacy-positive-close-order";
  const legacy = addSystemClose(db, execution, {
    partial: false,
    exchangeOrderId: execution.closeExchangeOrderId,
    exchangeTradeId: "legacy-positive-close-trade",
    price: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    exchangeFilledAt: CLOSE_AT
  });
  delete legacy.tradeAttribution;
  assert.equal(projection.projectSystemTradeFill(db, legacy)?.executionOrderId, execution.id);

  upsertOkxOrder(db, closePayload({
    ordId: execution.closeExchangeOrderId,
    fillPx: "60001",
    tradeId: legacy.exchangeTradeId
  }), context());

  assert.equal(legacy.financialEvidenceConflict, true);
  assert.equal(execution.status, "close_reconciliation_pending");
  assert.equal(execution.closeReconciliationReason, "fill_evidence_conflict");
  assert.equal(plan.status, "executing");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
});

test("a late conflicting echo reopens a settled system lifecycle until consistent evidence resolves it", async () => {
  const { db, execution } = managedDb({ status: "close_pending" });
  execution.closeExchangeOrderId = "late-conflict-close-order";
  const payload = closePayload({
    ordId: execution.closeExchangeOrderId,
    tradeId: "late-conflict-close-trade"
  });
  const snapshot = {
    id: "snapshot-after-late-conflict-close",
    exchange: "OKX",
    accountId: "account-a",
    environment: "production",
    apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok",
    positions: [],
    createdAt: "2026-08-15T02:00:00.000Z"
  };
  const matchingClosure = {
    complete: true,
    accountId: "account-a",
    environment: "production",
    exchange: "OKX",
    symbol: "BTC/USDT",
    quantity: 0.01,
    weightedPrice: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    closedAt: CLOSE_AT,
    exchangeOrderIds: [payload.ordId],
    tradeIds: [payload.tradeId],
    breakdown: [{
      accountId: "account-a",
      environment: "production",
      exchange: "OKX",
      symbol: "BTC/USDT",
      exchangeOrderId: payload.ordId,
      tradeId: payload.tradeId,
      quantity: 0.01,
      price: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT
    }],
    evidencePath: "okx_remote_fills_history"
  };

  upsertOkxOrder(db, payload, context());
  const settled = await pollExecutionOrders(db, {
    snapshot,
    fetchManualClosure: async () => matchingClosure
  });
  assert.equal(settled.results[0].status, "closed");
  assert.equal(execution.status, "closed");
  assert.equal(db.tradePlans.find((plan) => plan.id === execution.planId).status, "completed");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 1);
  const raw = db.fills.find((fill) => fill.exchangeTradeId === payload.tradeId);
  const authoritativeBefore = {
    price: raw.price,
    quantity: raw.quantity,
    realizedPnl: raw.realizedPnl,
    feeUsdt: raw.feeUsdt,
    exchangeOrderId: raw.exchangeOrderId,
    exchangeTradeId: raw.exchangeTradeId,
    exchangeFilledAt: raw.exchangeFilledAt,
    createdAt: raw.createdAt
  };

  upsertOkxOrder(db, {
    ...payload,
    ordId: "late-conflict-different-order",
    fillPx: "61000",
    fillPnl: "99",
    fee: "-0.5",
    fillTime: String(Date.parse("2026-08-15T01:05:00.000Z"))
  }, context());

  assert.equal(raw.financialEvidenceConflict, true);
  assert.deepEqual({
    price: raw.price,
    quantity: raw.quantity,
    realizedPnl: raw.realizedPnl,
    feeUsdt: raw.feeUsdt,
    exchangeOrderId: raw.exchangeOrderId,
    exchangeTradeId: raw.exchangeTradeId,
    exchangeFilledAt: raw.exchangeFilledAt,
    createdAt: raw.createdAt
  }, authoritativeBefore);
  assert.equal(execution.status, "close_reconciliation_pending");
  assert.equal(execution.closeReconciliationReason, "fill_evidence_conflict");
  assert.equal(db.tradePlans.find((plan) => plan.id === execution.planId).status, "executing");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
  assert.equal(db.fills.filter((fill) => fill.exchangeTradeId === payload.tradeId).length, 1);

  let outboundActions = 0;
  const resolved = await pollExecutionOrders(db, {
    snapshot,
    executeTradeAction: async () => { outboundActions += 1; return { status: "submitted" }; },
    fetchManualClosure: async () => matchingClosure
  });

  assert.equal(resolved.results[0].status, "closed");
  assert.equal(execution.status, "closed");
  assert.equal(db.tradePlans.find((plan) => plan.id === execution.planId).status, "completed");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 1);
  assert.equal(db.fills.filter((fill) => fill.exchangeTradeId === payload.tradeId).length, 1);
  assert.equal(outboundActions, 0);
});

test("a late conflicting echo resolves a settled manual-exit lifecycle without recording a duplicate close", async () => {
  const { db, execution } = managedDb({ status: "close_reconciliation_pending" });
  const payload = closePayload({
    ordId: "late-manual-conflict-order",
    tradeId: "late-manual-conflict-trade"
  });
  const snapshot = {
    id: "snapshot-after-late-manual-conflict",
    exchange: "OKX",
    accountId: "account-a",
    environment: "production",
    apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok",
    positions: [],
    createdAt: "2026-08-15T02:00:00.000Z"
  };
  const matchingClosure = {
    complete: true,
    accountId: "account-a",
    environment: "production",
    exchange: "OKX",
    symbol: "BTC/USDT",
    quantity: 0.01,
    weightedPrice: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    closedAt: CLOSE_AT,
    exchangeOrderIds: [payload.ordId],
    tradeIds: [payload.tradeId],
    breakdown: [{
      accountId: "account-a",
      environment: "production",
      exchange: "OKX",
      symbol: "BTC/USDT",
      exchangeOrderId: payload.ordId,
      tradeId: payload.tradeId,
      quantity: 0.01,
      price: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT
    }]
  };

  upsertOkxOrder(db, payload, context());
  const raw = db.fills.find((fill) => fill.exchangeTradeId === payload.tradeId);
  assert.equal(raw.tradeAttribution.exitMode, "manual_exit");
  const settled = await pollExecutionOrders(db, { snapshot });
  assert.equal(settled.results[0].status, "closed");
  assert.equal(db.fills.filter((fill) => fill.kind === "close").length, 1);

  upsertOkxOrder(db, { ...payload, fillPx: "61000" }, context());
  assert.equal(raw.financialEvidenceConflict, true);
  assert.equal(execution.status, "close_reconciliation_pending");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
  assert.equal(projection.buildAttributedManualExitClosure(db, execution).reason, "manual_exit_financial_evidence_conflict");
  const conflictedManualClosure = projection.buildAttributedManualExitClosure(db, execution, { includeConflictedEvidence: true });
  assert.deepEqual({
    complete: conflictedManualClosure.complete,
    quantity: conflictedManualClosure.quantity,
    weightedPrice: conflictedManualClosure.weightedPrice,
    realizedPnl: conflictedManualClosure.realizedPnl,
    feeUsdt: conflictedManualClosure.feeUsdt,
    closedAt: conflictedManualClosure.closedAt,
    exchangeOrderIds: conflictedManualClosure.exchangeOrderIds,
    tradeIds: conflictedManualClosure.tradeIds,
    breakdown: conflictedManualClosure.breakdown.map((row) => ({
      exchangeOrderId: row.exchangeOrderId,
      tradeId: row.tradeId,
      quantity: row.quantity,
      price: row.price,
      realizedPnl: row.realizedPnl,
      feeUsdt: row.feeUsdt,
      closedAt: row.closedAt
    }))
  }, {
    complete: true,
    quantity: 0.01,
    weightedPrice: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    closedAt: CLOSE_AT,
    exchangeOrderIds: [payload.ordId],
    tradeIds: [payload.tradeId],
    breakdown: [{
      exchangeOrderId: payload.ordId,
      tradeId: payload.tradeId,
      quantity: 0.01,
      price: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT
    }]
  });
  const resolved = { results: [reconcilePendingClose(db, execution, { snapshot, closure: matchingClosure })] };

  assert.equal(resolved.results[0].status, "closed");
  assert.equal(resolved.results[0].closure.evidencePath, "attributed_external_exchange_fills");
  assert.equal(execution.status, "closed");
  assert.equal(db.tradePlans.find((plan) => plan.id === execution.planId).status, "completed");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 1);
  assert.equal(db.fills.filter((fill) => fill.kind === "close").length, 1);
  assert.equal(db.fills[0], raw);
});

test("a conflicted manual-exit fill suppresses stale close watchdog retries while the position remains open", async () => {
  const { db, execution } = managedDb({ status: "close_reconciliation_pending" });
  execution.closeAttemptedAt = execution.closeSubmittedAt;
  const payload = closePayload({ ordId: "manual-conflict-no-retry-order", tradeId: "manual-conflict-no-retry-trade" });
  upsertOkxOrder(db, payload, context());
  const absentSnapshot = {
    exchange: "OKX", accountId: "account-a", environment: "production", apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok", positions: [], createdAt: "2026-08-15T02:00:00.000Z"
  };
  await pollExecutionOrders(db, { snapshot: absentSnapshot });
  upsertOkxOrder(db, { ...payload, fillPx: "61000" }, context());

  let outboundActions = 0;
  const result = await pollExecutionOrders(db, {
    snapshot: {
      ...absentSnapshot,
      positions: [{ instId: "BTC-USDT-SWAP", posSide: "long", pos: "1" }],
      createdAt: "2026-08-15T03:00:00.000Z"
    },
    nowMs: Date.parse("2026-08-15T03:00:00.000Z"),
    closeProgressSlaMs: 0,
    executeTradeAction: async () => { outboundActions += 1; return { status: "submitted" }; },
    fetchManualClosure: async () => ({ complete: false })
  });

  assert.equal(result.results[0].settlement, "position_still_open");
  assert.equal(outboundActions, 0);
  assert.equal(execution.closeRetryCount || 0, 0);
  assert.equal(execution.status, "close_reconciliation_pending");
  assert.equal(execution.closeReconciliationReason, "fill_evidence_conflict");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
});

for (const exitMode of ["manual", "system"]) {
  test(`consistent ${exitMode} close evidence cannot resolve a conflict with a different authoritative entry fee`, async () => {
    const { db, execution } = managedDb({
      suffix: `entry-fee-resolution-${exitMode}`,
      status: exitMode === "system" ? "close_pending" : "close_reconciliation_pending"
    });
    const payload = closePayload({
      ordId: `${exitMode}-entry-fee-resolution-order`,
      tradeId: `${exitMode}-entry-fee-resolution-trade`
    });
    if (exitMode === "system") execution.closeExchangeOrderId = payload.ordId;
    upsertOkxOrder(db, payload, context());
    const snapshot = {
      exchange: "OKX", accountId: "account-a", environment: "production", apiKeyFingerprint: API_KEY_FINGERPRINT,
      status: "ok", positions: [], createdAt: "2026-08-15T02:00:00.000Z"
    };
    await pollExecutionOrders(db, { snapshot, fetchManualClosure: async () => null });
    upsertOkxOrder(db, { ...payload, fillPx: "61000" }, context());
    const entry = db.fills.find((fill) => fill.kind === "entry");
    const entryBefore = structuredClone(entry);
    const rawClose = db.fills.find((fill) => fill.exchangeTradeId === payload.tradeId);
    const resolution = reconcilePendingClose(db, execution, {
      snapshot,
      closure: {
        complete: true,
        accountId: "account-a",
        environment: "production",
        exchange: "OKX",
        symbol: "BTC/USDT",
        entryFeeUsdt: 0.5,
        quantity: 0.01,
        weightedPrice: 60_000,
        realizedPnl: 10,
        feeUsdt: 0.01,
        closedAt: CLOSE_AT,
        exchangeOrderIds: [payload.ordId],
        tradeIds: [payload.tradeId],
        breakdown: [{
          exchangeOrderId: payload.ordId,
          tradeId: payload.tradeId,
          quantity: 0.01,
          price: 60_000,
          realizedPnl: 10,
          feeUsdt: 0.01,
          closedAt: CLOSE_AT
        }]
      }
    });

    assert.equal(resolution.status, "close_reconciliation_pending");
    assert.equal(resolution.settlement, "fill_evidence_conflict");
    assert.equal(rawClose.financialEvidenceConflict, true);
    assert.equal(execution.closeReconciliationReason, "fill_evidence_conflict");
    assert.deepEqual(entry, entryBefore);
    assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
  });
}

test("a filled system echo suppresses close retries until a post-fill authoritative absence settles it", async () => {
  const { db, execution } = managedDb({ status: "close_pending" });
  execution.closeAttemptedAt = execution.closeSubmittedAt;
  execution.closeExchangeOrderId = "snapshot-gated-close-order";
  const payload = closePayload({ ordId: execution.closeExchangeOrderId, tradeId: "snapshot-gated-close-trade" });
  upsertOkxOrder(db, payload, context());
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0,
    "the raw WS fact remains lifecycle-partial until authoritative position absence");
  let outboundActions = 0;
  let evidenceFetches = 0;
  const poll = (snapshot) => pollExecutionOrders(db, {
    snapshot,
    nowMs: Date.parse("2026-08-15T02:00:00.000Z"),
    closeProgressSlaMs: 0,
    maxCloseRetries: 2,
    executeTradeAction: async () => { outboundActions += 1; return { status: "submitted" }; },
    fetchManualClosure: async () => { evidenceFetches += 1; return { complete: false }; }
  });
  const boundSnapshot = (overrides) => ({
    exchange: "OKX",
    accountId: "account-a",
    environment: "production",
    apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok",
    ...overrides
  });

  const beforeFill = await poll(boundSnapshot({
    id: "snapshot-before-system-fill",
    positions: [{ instId: "BTC-USDT-SWAP", posSide: "long", pos: "1" }],
    createdAt: "2026-08-15T00:45:00.000Z"
  }));
  assert.equal(beforeFill.results[0].settlement, "authoritative_snapshot_pending");
  assert.equal(execution.status, "close_pending");

  const afterFillOpen = await poll(boundSnapshot({
    id: "snapshot-after-system-fill-open",
    positions: [{ instId: "BTC-USDT-SWAP", posSide: "long", pos: "1" }],
    createdAt: "2026-08-15T01:30:00.000Z"
  }));
  assert.equal(afterFillOpen.results[0].settlement, "position_still_open");
  assert.equal(execution.status, "close_pending");

  const afterFillAbsent = await poll(boundSnapshot({
    id: "snapshot-after-system-fill-absent",
    positions: [],
    createdAt: "2026-08-15T02:00:00.000Z"
  }));
  assert.equal(afterFillAbsent.results[0].status, "closed");
  assert.equal(execution.status, "closed");
  assert.equal(outboundActions, 0, "a persisted filled close must never be submitted again");
  assert.equal(evidenceFetches, 3, "read-only evidence lookup remains allowed");
  assert.equal(db.fills.filter((fill) => fill.exchangeTradeId === payload.tradeId).length, 1);
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 1);
});

test("financial backfill rejects a conflicting remote closure without rewriting an authoritative system WS close", async () => {
  const { db, execution } = managedDb({ status: "closed" });
  const plan = db.tradePlans.find((row) => row.id === execution.planId);
  plan.status = "completed";
  const entry = db.fills.find((fill) => fill.kind === "entry");
  entry.estimatedFee = true;
  entry.feeSource = "estimated";
  const close = addSystemClose(db, execution, {
    partial: false,
    exchangeOrderId: "local-close-order",
    exchangeTradeId: "local-close-trade",
    price: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    exchangeFilledAt: "2026-08-15T01:00:00.000Z"
  });
  close.fundingReconciled = false;
  close.fundingFeeUsdt = null;
  db.accountSnapshots = [{
    id: "snapshot-after-local-close",
    exchange: "OKX",
    accountId: "account-a",
    environment: "production",
    apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok",
    positions: [],
    createdAt: "2026-08-15T02:00:00.000Z"
  }];
  const rawBefore = structuredClone(close);
  let fundingQueries = 0;

  const result = await pollExecutionOrders(db, {
    nowMs: Date.parse("2026-08-15T03:00:00.000Z"),
    fundingReconciliationGraceMs: 0,
    fetchLifecycleClosure: async () => ({
      complete: true,
      accountId: "account-a",
      environment: "production",
      exchange: "OKX",
      symbol: "BTC/USDT",
      entryFeeUsdt: 0.02,
      quantity: 0.01,
      weightedPrice: 61_000,
      realizedPnl: 99,
      feeUsdt: 0.5,
      closedAt: "2026-08-15T01:05:00.000Z",
      exchangeOrderIds: ["remote-close-order"],
      tradeIds: ["remote-close-trade"],
      breakdown: [{
        accountId: "account-a",
        environment: "production",
        exchange: "OKX",
        symbol: "BTC/USDT",
        exchangeOrderId: "remote-close-order",
        tradeId: "remote-close-trade",
        quantity: 0.01,
        price: 61_000,
        realizedPnl: 99,
        feeUsdt: 0.5,
        closedAt: "2026-08-15T01:05:00.000Z"
      }],
      evidencePath: "okx_remote_fills_history"
    }),
    fetchFundingBills: async () => {
      fundingQueries += 1;
      return { complete: true, fundingFeeUsdt: 0, billIds: [] };
    }
  });

  assert.equal(result.financialReconciliation.results[0].status, "fill_evidence_conflict");
  assert.deepEqual(close, rawBefore, "the complete non-estimated WS close remains byte-for-byte unchanged");
  assert.equal(entry.estimatedFee, true, "conflicting evidence cannot backfill even the entry fee");
  assert.equal(execution.status, "close_reconciliation_pending");
  assert.equal(plan.status, "executing");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
  assert.equal(fundingQueries, 0);
});

test("financial backfill treats authoritative system close quantity disagreement as a lifecycle conflict", async () => {
  const { db, execution } = managedDb({ status: "closed" });
  const plan = db.tradePlans.find((row) => row.id === execution.planId);
  plan.status = "completed";
  const entry = db.fills.find((fill) => fill.kind === "entry");
  entry.estimatedFee = true;
  const close = addSystemClose(db, execution, {
    partial: false,
    exchangeOrderId: "quantity-conflict-close-order",
    exchangeTradeId: "quantity-conflict-close-trade",
    quantity: 0.01,
    price: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    exchangeFilledAt: CLOSE_AT
  });
  close.fundingReconciled = false;
  close.fundingFeeUsdt = null;
  db.accountSnapshots = [{
    exchange: "OKX", accountId: "account-a", environment: "production", apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok", positions: [], createdAt: "2026-08-15T02:00:00.000Z"
  }];
  const closeBefore = structuredClone(close);
  let fundingQueries = 0;

  const result = await pollExecutionOrders(db, {
    nowMs: Date.parse("2026-08-15T03:00:00.000Z"),
    fundingReconciliationGraceMs: 0,
    fetchLifecycleClosure: async () => ({
      complete: true,
      accountId: "account-a",
      environment: "production",
      exchange: "OKX",
      symbol: "BTC/USDT",
      entryFeeUsdt: 0.02,
      entryQuantity: 0.01,
      expectedQuantity: 0.01,
      quantity: 0.02,
      weightedPrice: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT,
      exchangeOrderIds: [close.exchangeOrderId],
      tradeIds: [close.exchangeTradeId],
      breakdown: [{
        exchangeOrderId: close.exchangeOrderId,
        tradeId: close.exchangeTradeId,
        quantity: 0.02,
        price: 60_000,
        realizedPnl: 10,
        feeUsdt: 0.01,
        closedAt: CLOSE_AT
      }]
    }),
    fetchFundingBills: async () => {
      fundingQueries += 1;
      return { complete: true, fundingFeeUsdt: 0, billIds: [] };
    }
  });

  assert.equal(result.financialReconciliation.results[0].status, "fill_evidence_conflict");
  assert.deepEqual(close, closeBefore);
  assert.equal(execution.status, "close_reconciliation_pending");
  assert.equal(plan.status, "executing");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
  assert.equal(fundingQueries, 0);
});

test("financial backfill rejects conflicts in populated fields of an incomplete system WS close", async () => {
  const { db, execution } = managedDb({ status: "closed" });
  const plan = db.tradePlans.find((row) => row.id === execution.planId);
  plan.status = "completed";
  const close = addSystemClose(db, execution, {
    partial: false,
    exchangeOrderId: "incomplete-local-close-order",
    exchangeTradeId: "incomplete-local-close-trade",
    price: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    exchangeFilledAt: "2026-08-15T01:00:00.000Z"
  });
  close.feeUsdt = null;
  close.feeCostUsdt = null;
  close.fundingReconciled = false;
  close.fundingFeeUsdt = null;
  db.accountSnapshots = [{
    id: "snapshot-after-incomplete-local-close",
    exchange: "OKX",
    accountId: "account-a",
    environment: "production",
    apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok",
    positions: [],
    createdAt: "2026-08-15T02:00:00.000Z"
  }];
  const rawBefore = structuredClone(close);
  let fundingQueries = 0;

  const result = await pollExecutionOrders(db, {
    nowMs: Date.parse("2026-08-15T03:00:00.000Z"),
    fundingReconciliationGraceMs: 0,
    fetchLifecycleClosure: async () => ({
      complete: true,
      accountId: "account-a",
      environment: "production",
      exchange: "OKX",
      symbol: "BTC/USDT",
      entryFeeUsdt: 0.01,
      quantity: 0.01,
      weightedPrice: 61_000,
      realizedPnl: 99,
      feeUsdt: 0.5,
      closedAt: "2026-08-15T01:05:00.000Z",
      exchangeOrderIds: ["incomplete-remote-close-order"],
      tradeIds: ["incomplete-remote-close-trade"],
      breakdown: [{
        accountId: "account-a",
        environment: "production",
        exchange: "OKX",
        symbol: "BTC/USDT",
        exchangeOrderId: "incomplete-remote-close-order",
        tradeId: "incomplete-remote-close-trade",
        quantity: 0.01,
        price: 61_000,
        realizedPnl: 99,
        feeUsdt: 0.5,
        closedAt: "2026-08-15T01:05:00.000Z"
      }]
    }),
    fetchFundingBills: async () => {
      fundingQueries += 1;
      return { complete: true, fundingFeeUsdt: 0, billIds: [] };
    }
  });

  assert.equal(result.financialReconciliation.results[0].status, "fill_evidence_conflict");
  assert.deepEqual(close, rawBefore);
  assert.equal(execution.status, "close_reconciliation_pending");
  assert.equal(plan.status, "executing");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
  assert.equal(fundingQueries, 0);
});

test("an authoritative system close with a missing normalized fee reopens financial reconciliation without mutating raw", async () => {
  const { db, execution } = managedDb({ status: "closed" });
  const plan = db.tradePlans.find((row) => row.id === execution.planId);
  plan.status = "completed";
  const close = addSystemClose(db, execution, {
    partial: false,
    exchangeOrderId: "missing-normalized-fee-order",
    exchangeTradeId: "missing-normalized-fee-trade",
    quantity: 0.01,
    price: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    exchangeFilledAt: CLOSE_AT
  });
  close.feeUsdt = null;
  close.feeCostUsdt = null;
  close.fundingReconciled = false;
  close.fundingFeeUsdt = null;
  db.accountSnapshots = [{
    exchange: "OKX", accountId: "account-a", environment: "production", apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok", positions: [], createdAt: "2026-08-15T02:00:00.000Z"
  }];
  const rawBefore = structuredClone(close);
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 1);
  let fundingQueries = 0;
  let outboundActions = 0;

  const result = await pollExecutionOrders(db, {
    nowMs: Date.parse("2026-08-15T03:00:00.000Z"),
    fundingReconciliationGraceMs: 0,
    executeTradeAction: async () => { outboundActions += 1; return { status: "submitted" }; },
    fetchLifecycleClosure: async () => ({
      complete: true,
      accountId: "account-a",
      environment: "production",
      exchange: "OKX",
      symbol: "BTC/USDT",
      entryFeeUsdt: 0.01,
      quantity: 0.01,
      weightedPrice: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT,
      exchangeOrderIds: [close.exchangeOrderId],
      tradeIds: [close.exchangeTradeId],
      breakdown: [{
        exchangeOrderId: close.exchangeOrderId,
        tradeId: close.exchangeTradeId,
        quantity: 0.01,
        price: 60_000,
        realizedPnl: 10,
        feeUsdt: 0.01,
        closedAt: CLOSE_AT
      }]
    }),
    fetchFundingBills: async () => {
      fundingQueries += 1;
      return { complete: true, fundingFeeUsdt: 0, billIds: [] };
    }
  });

  assert.equal(result.financialReconciliation.results[0].status, "authoritative_close_evidence_incomplete");
  assert.deepEqual(close, rawBefore);
  assert.equal(execution.status, "close_reconciliation_pending");
  assert.equal(execution.closeReconciliationReason, "authoritative_close_evidence_incomplete");
  assert.equal(plan.status, "executing");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
  assert.equal(db.fills.filter((fill) => fill.kind === "close").length, 1);
  assert.equal(fundingQueries, 0);
  assert.equal(outboundActions, 0);
});

test("financial backfill cannot replace an authoritative non-estimated entry fee", () => {
  const { db, execution } = managedDb({ status: "closed" });
  const entry = db.fills.find((fill) => fill.kind === "entry");
  const close = addSystemClose(db, execution, {
    partial: false,
    exchangeOrderId: "entry-fee-close-order",
    exchangeTradeId: "entry-fee-close-trade",
    price: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    exchangeFilledAt: CLOSE_AT
  });
  const entryBefore = structuredClone(entry);
  const closeBefore = structuredClone(close);

  const result = applyOkxLifecycleFinancialEvidence(db, execution, {
    complete: true,
    accountId: "account-a",
    environment: "production",
    exchange: "OKX",
    symbol: "BTC/USDT",
    entryFeeUsdt: 0.02,
    quantity: 0.01,
    weightedPrice: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    closedAt: CLOSE_AT,
    exchangeOrderIds: ["entry-fee-close-order"],
    tradeIds: ["entry-fee-close-trade"],
    breakdown: [{
      exchangeOrderId: "entry-fee-close-order",
      tradeId: "entry-fee-close-trade",
      quantity: 0.01,
      price: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT
    }]
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "fill_evidence_conflict");
  assert.deepEqual(entry, entryBefore);
  assert.deepEqual(close, closeBefore);
});

test("financial backfill rejects a non-estimated close whose persisted binding cannot be validated", () => {
  const { db, execution } = managedDb({ status: "closed" });
  const entry = db.fills.find((fill) => fill.kind === "entry");
  entry.estimatedFee = true;
  const close = addSystemClose(db, execution, {
    partial: false,
    exchangeOrderId: "binding-conflict-close-order",
    exchangeTradeId: "binding-conflict-close-trade",
    price: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    exchangeFilledAt: CLOSE_AT
  });
  close.accountId = "different-account";
  const entryBefore = structuredClone(entry);
  const closeBefore = structuredClone(close);

  const result = applyOkxLifecycleFinancialEvidence(db, execution, {
    complete: true,
    accountId: "account-a",
    environment: "production",
    exchange: "OKX",
    symbol: "BTC/USDT",
    entryFeeUsdt: 0.02,
    quantity: 0.01,
    weightedPrice: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    closedAt: CLOSE_AT,
    exchangeOrderIds: [close.exchangeOrderId],
    tradeIds: [close.exchangeTradeId],
    breakdown: [{
      exchangeOrderId: close.exchangeOrderId,
      tradeId: close.exchangeTradeId,
      quantity: 0.01,
      price: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT
    }]
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, "fill_evidence_conflict");
  assert.deepEqual(entry, entryBefore);
  assert.deepEqual(close, closeBefore);
});

test("a recognized system WS close is reconciled into exactly one financial fact", () => {
  const { db, execution } = managedDb({ status: "close_reconciliation_pending" });
  execution.closeExchangeOrderId = "managed-system-close-order";
  const payload = closePayload({
    ordId: execution.closeExchangeOrderId,
    clOrdId: "managed-system-close-client",
    tradeId: "managed-system-close-trade"
  });

  upsertOkxOrder(db, payload, context());
  const rawBefore = db.fills.find((fill) => fill.exchangeTradeId === payload.tradeId);
  assert.ok(rawBefore, "reconciliation must begin with the persisted WS fact");
  const authoritativeBefore = structuredClone({
    price: rawBefore.price,
    quantity: rawBefore.quantity,
    realizedPnl: rawBefore.realizedPnl,
    feeUsdt: rawBefore.feeUsdt,
    rawFee: rawBefore.rawFee,
    feeCurrency: rawBefore.feeCurrency,
    exchangeOrderId: rawBefore.exchangeOrderId,
    clientOrderId: rawBefore.clientOrderId,
    exchangeTradeId: rawBefore.exchangeTradeId,
    exchangeFilledAt: rawBefore.exchangeFilledAt,
    createdAt: rawBefore.createdAt
  });
  const result = reconcilePendingClose(db, execution, {
    snapshot: {
      id: "snapshot-after-system-close",
      exchange: "OKX",
      accountId: "account-a",
      environment: "production",
      apiKeyFingerprint: API_KEY_FINGERPRINT,
      status: "ok",
      positions: [],
      createdAt: "2026-08-15T02:00:00.000Z"
    },
    closure: {
      complete: true,
      quantity: 0.01,
      weightedPrice: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT,
      exchangeOrderIds: [execution.closeExchangeOrderId],
      tradeIds: [payload.tradeId],
      breakdown: [{
        exchangeOrderId: execution.closeExchangeOrderId,
        tradeId: payload.tradeId,
        quantity: 0.01,
        price: 60_000,
        realizedPnl: 10,
        feeUsdt: 0.01,
        closedAt: CLOSE_AT
      }],
      evidencePath: "okx_raw_fill_history"
    }
  });

  assert.equal(result.status, "closed");
  const closes = db.fills.filter((fill) => fill.kind === "close");
  assert.equal(closes.length, 1);
  assert.equal(closes.reduce((sum, fill) => sum + Number(fill.realizedPnl), 0), 10);
  assert.equal(closes.reduce((sum, fill) => sum + Number(fill.feeUsdt), 0), 0.01);
  assert.equal(closes.filter((fill) => fill.exchangeTradeId === payload.tradeId
    || fill.exchangeTradeIds?.includes(payload.tradeId)
    || fill.exitBreakdown?.some((row) => row.tradeId === payload.tradeId)).length, 1);
  const lifecycles = projection.groupSystemClosedTradeLifecycles(db);
  assert.equal(lifecycles.length, 1);
  const lifecycle = lifecycles[0];
  assert.equal(lifecycle.quantity, 0.01);
  assert.equal(lifecycle.realizedPnl, 10);
  assert.deepEqual({
    price: closes[0].price,
    quantity: closes[0].quantity,
    realizedPnl: closes[0].realizedPnl,
    feeUsdt: closes[0].feeUsdt,
    rawFee: closes[0].rawFee,
    feeCurrency: closes[0].feeCurrency,
    exchangeOrderId: closes[0].exchangeOrderId,
    clientOrderId: closes[0].clientOrderId,
    exchangeTradeId: closes[0].exchangeTradeId,
    exchangeFilledAt: closes[0].exchangeFilledAt,
    createdAt: closes[0].createdAt
  }, authoritativeBefore);
});

test("a REST-settled system close absorbs the same late WS trade without changing lifecycle totals", () => {
  const { db, execution } = managedDb({ status: "close_reconciliation_pending" });
  execution.closeExchangeOrderId = "rest-first-close-order";
  const payload = closePayload({
    ordId: execution.closeExchangeOrderId,
    tradeId: "rest-first-close-trade"
  });
  const closure = {
    complete: true,
    accountId: execution.accountId,
    environment: execution.environment,
    exchange: execution.exchange,
    symbol: execution.symbol,
    quantity: 0.01,
    weightedPrice: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    closedAt: CLOSE_AT,
    exchangeOrderIds: [execution.closeExchangeOrderId],
    tradeIds: [payload.tradeId],
    breakdown: [{
      exchangeOrderId: execution.closeExchangeOrderId,
      tradeId: payload.tradeId,
      quantity: 0.01,
      price: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT
    }],
    evidencePath: "okx_raw_fill_history"
  };
  const snapshot = {
    id: "snapshot-after-rest-first-close",
    exchange: "OKX",
    accountId: execution.accountId,
    environment: execution.environment,
    apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok",
    positions: [],
    createdAt: "2026-08-15T02:00:00.000Z"
  };

  assert.equal(reconcilePendingClose(db, execution, { snapshot, closure }).status, "closed");
  const authoritative = db.fills.find((fill) => fill.kind === "close");
  assert.deepEqual({
    exchange: authoritative.exchange,
    accountId: authoritative.accountId,
    environment: authoritative.environment,
    exchangeOrderId: authoritative.exchangeOrderId,
    exchangeTradeId: authoritative.exchangeTradeId
  }, {
    exchange: "OKX",
    accountId: "account-a",
    environment: "production",
    exchangeOrderId: execution.closeExchangeOrderId,
    exchangeTradeId: payload.tradeId
  });
  const rawBefore = structuredClone(authoritative);
  const lifecycleBefore = structuredClone(projection.groupSystemClosedTradeLifecycles(db)[0]);

  upsertOkxOrder(db, payload, context());

  const closes = db.fills.filter((fill) => fill.kind === "close");
  const lifecycleAfter = projection.groupSystemClosedTradeLifecycles(db)[0];
  assert.equal(closes.length, 1);
  assert.deepEqual(closes[0], rawBefore);
  assert.deepEqual({
    quantity: lifecycleAfter.quantity,
    realizedPnl: lifecycleAfter.realizedPnl,
    feeUsdt: lifecycleAfter.feeUsdt
  }, {
    quantity: lifecycleBefore.quantity,
    realizedPnl: lifecycleBefore.realizedPnl,
    feeUsdt: lifecycleBefore.feeUsdt
  });
});

test("a conflicting late WS payload for a REST-settled trade preserves raw evidence and reopens settlement", () => {
  const { db, execution } = managedDb({ status: "close_reconciliation_pending" });
  execution.closeExchangeOrderId = "rest-conflict-close-order";
  const tradeId = "rest-conflict-close-trade";
  const snapshot = {
    id: "snapshot-after-rest-conflict-close",
    exchange: "OKX",
    accountId: execution.accountId,
    environment: execution.environment,
    apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok",
    positions: [],
    createdAt: "2026-08-15T02:00:00.000Z"
  };
  const closure = {
    complete: true,
    accountId: execution.accountId,
    environment: execution.environment,
    exchange: execution.exchange,
    symbol: execution.symbol,
    quantity: 0.01,
    weightedPrice: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    closedAt: CLOSE_AT,
    exchangeOrderIds: [execution.closeExchangeOrderId],
    tradeIds: [tradeId],
    breakdown: [{
      exchangeOrderId: execution.closeExchangeOrderId,
      tradeId,
      quantity: 0.01,
      price: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT
    }],
    evidencePath: "okx_raw_fill_history"
  };
  assert.equal(reconcilePendingClose(db, execution, { snapshot, closure }).status, "closed");
  const authoritative = db.fills.find((fill) => fill.kind === "close");
  const financialBefore = structuredClone({
    price: authoritative.price,
    quantity: authoritative.quantity,
    realizedPnl: authoritative.realizedPnl,
    feeUsdt: authoritative.feeUsdt,
    exchangeOrderIds: authoritative.exchangeOrderIds,
    exchangeTradeIds: authoritative.exchangeTradeIds,
    exitBreakdown: authoritative.exitBreakdown
  });

  upsertOkxOrder(db, closePayload({
    ordId: execution.closeExchangeOrderId,
    tradeId,
    fillPnl: "99"
  }), context());

  assert.equal(db.fills.filter((fill) => fill.kind === "close").length, 1);
  assert.equal(authoritative.financialEvidenceConflict, true);
  assert.equal(execution.status, "close_reconciliation_pending");
  assert.deepEqual({
    price: authoritative.price,
    quantity: authoritative.quantity,
    realizedPnl: authoritative.realizedPnl,
    feeUsdt: authoritative.feeUsdt,
    exchangeOrderIds: authoritative.exchangeOrderIds,
    exchangeTradeIds: authoritative.exchangeTradeIds,
    exitBreakdown: authoritative.exitBreakdown
  }, financialBefore);
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
});

test("a protecting execution reuses its persisted WS protection fill during polling", async () => {
  const { db, execution } = managedDb({ status: "protecting" });
  execution.stopAlgoId = "poll-protection-algo";
  execution.okxCtVal = 0.01;
  const payload = closePayload({
    ordId: "poll-protection-child-order",
    clOrdId: "",
    algoId: execution.stopAlgoId,
    tradeId: "poll-protection-trade"
  });
  upsertOkxOrder(db, payload, context());
  db.accountSnapshots = [{
    id: "fresh-protection-absence",
    exchange: "OKX",
    accountId: "account-a",
    environment: "production",
    apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok",
    positions: [],
    createdAt: new Date().toISOString()
  }];
  const remoteClosure = {
    complete: true,
    quantity: 0.01,
    weightedPrice: 60_000,
    realizedPnl: 10,
    feeUsdt: 0.01,
    closedAt: CLOSE_AT,
    exchangeOrderIds: [payload.ordId],
    tradeIds: [payload.tradeId],
    breakdown: [{
      exchangeOrderId: payload.ordId,
      tradeId: payload.tradeId,
      quantity: 0.01,
      price: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT
    }],
    evidencePath: "orders-algo-history->ordId->fills-history:tradeId"
  };

  const result = await pollExecutionOrders(db, {
    fetchOrderState: async () => ({ state: "filled", avgPrice: 59_000, filledContracts: 1 }),
    fetchProtectionClosure: async () => remoteClosure
  });

  assert.equal(result.results[0].status, "closed");
  assert.equal(execution.status, "closed");
  assert.equal(execution.exitReason, "exchange_protection_filled");
  const closes = db.fills.filter((fill) => fill.kind === "close");
  assert.equal(closes.length, 1);
  assert.equal(closes[0].exchangeTradeId, payload.tradeId);
  assert.equal(closes.reduce((sum, fill) => sum + Number(fill.realizedPnl), 0), 10);
  assert.equal(closes.reduce((sum, fill) => sum + Number(fill.feeUsdt), 0), 0.01);
});

test("conflicting remote evidence for a persisted system trade ID fails closed", () => {
  const { db, execution } = managedDb({ status: "close_reconciliation_pending" });
  execution.closeExchangeOrderId = "conflict-close-order";
  const payload = closePayload({ ordId: execution.closeExchangeOrderId, tradeId: "conflict-close-trade" });
  upsertOkxOrder(db, payload, context());

  const result = reconcilePendingClose(db, execution, {
    snapshot: {
      id: "snapshot-after-conflicting-close",
      exchange: "OKX",
      accountId: "account-a",
      environment: "production",
      apiKeyFingerprint: API_KEY_FINGERPRINT,
      status: "ok",
      positions: [],
      createdAt: "2026-08-15T02:00:00.000Z"
    },
    closure: {
      complete: true,
      quantity: 0.01,
      weightedPrice: 60_001,
      realizedPnl: 10,
      feeUsdt: 0.01,
      closedAt: CLOSE_AT,
      exchangeOrderIds: [execution.closeExchangeOrderId],
      tradeIds: [payload.tradeId],
      evidencePath: "okx_raw_fill_history"
    }
  });

  assert.equal(result.status, "close_reconciliation_pending");
  assert.equal(result.settlement, "fill_evidence_conflict");
  assert.equal(execution.status, "close_reconciliation_pending");
  assert.equal(db.fills.filter((fill) => fill.exchangeTradeId === payload.tradeId).length, 1);
  assert.equal(db.fills.find((fill) => fill.exchangeTradeId === payload.tradeId).price, 60_000);
});

test("same-trade remote system evidence with a conflicting execution binding fails closed", async (t) => {
  for (const [name, override] of [
    ["account", { accountId: "account-b" }],
    ["environment", { environment: "demo" }],
    ["symbol", { symbol: "ETH/USDT" }]
  ]) await t.test(name, () => {
    const { db, execution } = managedDb({ status: "close_reconciliation_pending" });
    execution.closeExchangeOrderId = `binding-close-order-${name}`;
    const payload = closePayload({ ordId: execution.closeExchangeOrderId, tradeId: `binding-close-trade-${name}` });
    upsertOkxOrder(db, payload, context());
    const result = reconcilePendingClose(db, execution, {
      snapshot: {
        id: `snapshot-after-binding-conflict-${name}`,
        exchange: "OKX",
        accountId: "account-a",
        environment: "production",
        apiKeyFingerprint: API_KEY_FINGERPRINT,
        status: "ok",
        positions: [],
        createdAt: "2026-08-15T02:00:00.000Z"
      },
      closure: {
        complete: true,
        accountId: "account-a",
        environment: "production",
        symbol: "BTC/USDT",
        quantity: 0.01,
        weightedPrice: 60_000,
        realizedPnl: 10,
        feeUsdt: 0.01,
        closedAt: CLOSE_AT,
        exchangeOrderIds: [execution.closeExchangeOrderId],
        tradeIds: [payload.tradeId],
        evidencePath: "okx_raw_fill_history",
        ...override
      }
    });

    assert.equal(result.status, "close_reconciliation_pending");
    assert.equal(result.settlement, "fill_evidence_conflict");
    assert.equal(db.fills.filter((fill) => fill.exchangeTradeId === payload.tradeId).length, 1);
  });
});

test("system entry identities on a close fail closed before manual-exit matching", async (t) => {
  for (const [name, fillField, value] of [
    ["entry order", "exchangeOrderId", "entry-order-1"],
    ["entry client", "clientOrderId", "entry-client-1"]
  ]) await t.test(name, () => {
    const { db } = managedDb();
    const attribution = projection.buildExternalFillAttribution(db, {
      kind: "close",
      exchange: "OKX",
      accountId: "account-a",
      environment: "production",
      symbol: "BTC/USDT",
      side: "sell",
      quantity: 0.01,
      price: 60_000,
      realizedPnl: 10,
      feeUsdt: 0.01,
      exchangeTradeId: `trade-${name.replace(" ", "-")}`,
      exchangeFilledAt: CLOSE_AT,
      [fillField]: value
    });

    assert.equal(attribution.scope, "attribution_pending");
    assert.equal(attribution.reason, "trade_exchange_order_binding_conflict");
    assert.notEqual(attribution.exitMode, "manual_exit");
  });
});

test("a net reversal attributes only its close component to the managed execution", () => {
  const { db } = managedDb();
  db.positions.push({
    id: "exchange-position",
    exchange: "OKX",
    source: "exchange_rest",
    accountId: "account-a",
    environment: "production",
    symbol: "BTC/USDT",
    positionMode: "net_mode",
    rawPosSide: "net",
    direction: "long",
    coinSize: 0.01,
    contractMultiplier: 0.01,
    exchangeObservedAt: "2026-08-15T00:59:00.000Z"
  });

  upsertOkxOrder(db, closePayload({ posSide: "net", reduceOnly: "false", fillSz: "1.5", accFillSz: "1.5" }), context());

  const close = db.fills.find((fill) => fill.netFillComponent === "reversal_close");
  const entry = db.fills.find((fill) => fill.netFillComponent === "reversal_entry");
  assert.equal(close.quantity, 0.01);
  assert.equal(close.tradeAttribution.scope, "system");
  assert.equal(close.tradeAttribution.exitMode, "manual_exit");
  assert.equal(Number(entry.quantity.toFixed(8)), 0.005);
  assert.equal(entry.tradeAttribution.scope, "manual");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db)[0].key, "exec-1");
});

test("repeated exchange trade IDs preserve one close fact and one lifecycle PnL", () => {
  const { db } = managedDb();
  const payload = closePayload();

  insertClose(db, payload);
  insertClose(db, payload);

  const lifecycle = projection.groupSystemClosedTradeLifecycles(db)[0];
  assert.equal(db.fills.filter((fill) => fill.kind === "close").length, 1);
  assert.ok(lifecycle, "the exact manual exit must form one system lifecycle");
  assert.equal(lifecycle.fills.length, 1);
  assert.equal(lifecycle.realizedPnl, 10);
});

test("raw trade ID deduplication remains isolated by account and environment", () => {
  const { db } = managedDb();
  db.executionOrders = [];
  db.tradePlans = [];
  db.fills = [];
  db.positions = [];

  insertClose(db, closePayload({ ordId: "account-a-order" }), context());
  insertClose(db, closePayload({ ordId: "account-b-order" }), context({ accountId: "account-b" }));

  assert.equal(db.fills.length, 2);
  assert.deepEqual(db.fills.map((fill) => fill.accountId).sort(), ["account-a", "account-b"]);
});

test("near managed candidates with one mismatched identity remain attribution-pending", async (t) => {
  const cases = [
    ["account", closePayload(), context({ accountId: "account-b" })],
    ["environment", closePayload(), context({ environment: "demo" })],
    ["symbol", closePayload({ instId: "ETH-USDT-SWAP" }), context()],
    ["side/direction", closePayload({ side: "buy", posSide: "short" }), context()],
    ["time", closePayload({ fillTime: String(Date.parse("2026-08-14T22:00:00.000Z")) }), context()],
    ["quantity", closePayload({ fillSz: "2", accFillSz: "2" }), context()]
  ];
  for (const [name, payload, binding] of cases) await t.test(name, () => {
    const { db } = managedDb();
    const close = insertClose(db, payload, binding);
    assert.equal(close.tradeAttribution.scope, "attribution_pending");
    assert.equal(projection.projectSystemTradeFill(db, close), null);
    assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
  });
});

test("two exact open executions in one slot leave the close attribution-pending", () => {
  const { db } = managedDb();
  addManagedExecution(db, { suffix: "2" });

  const close = insertClose(db);

  assert.equal(close.tradeAttribution.scope, "attribution_pending");
  assert.equal(close.tradeAttribution.reason, "manual_exit_candidate_ambiguous");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
});

test("explicit server reconciliation promotes an out-of-order pending close only after unique entry evidence arrives", () => {
  const { db } = managedDb();
  const entry = db.fills.find((fill) => fill.kind === "entry");
  db.fills = db.fills.filter((fill) => fill !== entry);
  const close = insertClose(db);
  assert.equal(close.tradeAttribution.scope, "attribution_pending");

  db.fills.push(entry);
  assert.equal(projection.classifyTradeFill(db, close).scope, "attribution_pending",
    "ordinary consumers must never promote persisted pending metadata");
  const financialBefore = structuredClone({
    price: close.price,
    quantity: close.quantity,
    realizedPnl: close.realizedPnl,
    feeUsdt: close.feeUsdt,
    rawFee: close.rawFee,
    exchangeTradeId: close.exchangeTradeId,
    exchangeOrderId: close.exchangeOrderId,
    exchangeFilledAt: close.exchangeFilledAt
  });

  const result = projection.reconcilePendingTradeAttributions(db);

  assert.deepEqual(result, { checked: 1, resolved: 1, pending: 0 });
  assert.equal(close.tradeAttribution.scope, "system");
  assert.equal(close.tradeAttribution.exitMode, "manual_exit");
  assert.equal(close.tradeAttribution.method, "deterministic_manual_exit_reconciliation");
  assert.equal(close.tradeAttribution.executionOrderId, "exec-1");
  assert.deepEqual({
    price: close.price,
    quantity: close.quantity,
    realizedPnl: close.realizedPnl,
    feeUsdt: close.feeUsdt,
    rawFee: close.rawFee,
    exchangeTradeId: close.exchangeTradeId,
    exchangeOrderId: close.exchangeOrderId,
    exchangeFilledAt: close.exchangeFilledAt
  }, financialBefore);
});

test("explicit server reconciliation leaves ambiguous and conflicting pending fills fail-closed", () => {
  const { db } = managedDb();
  addManagedExecution(db, { suffix: "2" });
  const close = insertClose(db);
  const before = structuredClone(close);
  assert.equal(close.tradeAttribution.reason, "manual_exit_candidate_ambiguous");

  const result = projection.reconcilePendingTradeAttributions(db);

  assert.deepEqual(result, { checked: 1, resolved: 0, pending: 1 });
  assert.deepEqual(close, before);
  assert.equal(projection.projectSystemTradeFill(db, close), null);

  const { db: conflictDb } = managedDb();
  const conflict = insertClose(conflictDb, closePayload(), context({ accountId: "account-b" }));
  const conflictBefore = structuredClone(conflict);
  assert.equal(conflict.tradeAttribution.reason, "manual_exit_account_mismatch");
  assert.deepEqual(projection.reconcilePendingTradeAttributions(conflictDb), { checked: 1, resolved: 0, pending: 1 });
  assert.deepEqual(conflict, conflictBefore);
});

test("restart reconciliation re-evaluates pending attribution after out-of-order evidence", async () => {
  const { db } = managedDb();
  const entry = db.fills.find((fill) => fill.kind === "entry");
  db.fills = db.fills.filter((fill) => fill !== entry);
  const close = insertClose(db);
  assert.equal(close.tradeAttribution.scope, "attribution_pending");
  db.fills.push(entry);
  const restartedDb = structuredClone(db);

  const result = await reconcilePendingOkxFillIdentities(restartedDb, {
    request: async () => { throw new Error("no fills-history request expected"); }
  });
  const restartedClose = restartedDb.fills.find((fill) => fill.id === close.id);

  assert.equal(result.checked, 0);
  assert.equal(result.attributions.resolved, 1);
  assert.equal(restartedClose.tradeAttribution.scope, "system");
  assert.equal(restartedClose.tradeAttribution.exitMode, "manual_exit");
});

test("an unmatched external entry mixed into the managed slot blocks close attribution", () => {
  const { db } = managedDb();
  upsertOkxOrder(db, {
    ...closePayload({
      ordId: "manual-entry-order",
      side: "buy",
      posSide: "long",
      reduceOnly: "false",
      fillPnl: "0",
      tradeId: "manual-entry-trade",
      fillTime: String(Date.parse("2026-08-15T00:00:00.000Z"))
    })
  }, context());

  const close = insertClose(db);

  assert.equal(db.fills.find((fill) => fill.exchangeTradeId === "manual-entry-trade").tradeAttribution.scope, "manual");
  assert.equal(close.tradeAttribution.scope, "attribution_pending");
  assert.equal(close.tradeAttribution.reason, "mixed_position_attribution");
  assert.equal(projection.groupSystemClosedTradeLifecycles(db).length, 0);
});

test("a different external entry at the close timestamp blocks attribution", () => {
  const { db } = managedDb();
  upsertOkxOrder(db, closePayload({
    ordId: "same-time-manual-entry",
    side: "buy",
    posSide: "long",
    reduceOnly: "false",
    fillPnl: "0",
    tradeId: "same-time-manual-entry-trade"
  }), context());

  const close = insertClose(db);

  assert.equal(close.tradeAttribution.scope, "attribution_pending");
  assert.equal(close.tradeAttribution.reason, "mixed_position_attribution");
});

test("a close at the exact entry timestamp remains attribution-pending", () => {
  const { db } = managedDb();

  const close = insertClose(db, closePayload({ fillTime: String(Date.parse(ENTRY_AT)) }));

  assert.equal(close.tradeAttribution.scope, "attribution_pending");
  assert.equal(close.tradeAttribution.reason, "manual_exit_time_mismatch");
  assert.equal(projection.projectSystemTradeFill(db, close), null);
});

test("missing authoritative trade identity or exchange time cannot resolve a manual exit", async (t) => {
  assert.equal(typeof projection.resolveManualExitAttribution, "function");
  for (const [name, mutate, reason] of [
    ["trade ID", (fill) => { fill.exchangeTradeId = null; }, "manual_exit_trade_id_missing"],
    ["exchange time", (fill) => { fill.exchangeFilledAt = null; fill.createdAt = null; }, "manual_exit_exchange_time_missing"]
  ]) await t.test(name, () => {
    const { db } = managedDb();
    const fill = {
      kind: "close", exchange: "OKX", accountId: "account-a", environment: "production",
      symbol: "BTC/USDT", side: "sell", quantity: 0.01, price: 60_000,
      realizedPnl: 10, feeUsdt: 0.01, exchangeTradeId: "trade", exchangeFilledAt: CLOSE_AT
    };
    mutate(fill);
    const result = projection.resolveManualExitAttribution(db, fill);
    assert.equal(result.status, "pending");
    assert.equal(result.reason, reason);
  });

  const { db } = managedDb();
  db.executionOrders = [];
  db.tradePlans = [];
  db.fills = [];
  const unmatched = projection.resolveManualExitAttribution(db, {
    kind: "close", exchange: "OKX", accountId: "account-a", environment: "production",
    symbol: "BTC/USDT", side: "sell", quantity: 0.01, price: 60_000,
    realizedPnl: 10, feeUsdt: 0.01, exchangeTradeId: null, exchangeFilledAt: CLOSE_AT
  });
  assert.equal(unmatched.status, "pending");
  assert.equal(unmatched.reason, "manual_exit_trade_id_missing");
});

test("execution quantity without a persisted system entry fill cannot claim an external close", () => {
  const { db } = managedDb();
  db.fills = [];
  const result = projection.resolveManualExitAttribution(db, {
    kind: "close", exchange: "OKX", accountId: "account-a", environment: "production",
    symbol: "BTC/USDT", side: "sell", quantity: 0.01, price: 60_000,
    realizedPnl: 10, feeUsdt: 0.01, exchangeTradeId: "manual-close-trade", exchangeFilledAt: CLOSE_AT
  });

  assert.equal(result.status, "pending");
  assert.equal(result.reason, "manual_exit_quantity_mismatch");
  assert.deepEqual(result.matchedEntryFillIds, []);
});

test("manual-exit closure is built only from complete, unique authoritative raw fill evidence", async (t) => {
  assert.equal(typeof projection.buildAttributedManualExitClosure, "function");
  const { db, execution } = managedDb();
  insertClose(db);
  const complete = projection.buildAttributedManualExitClosure(db, execution);
  assert.equal(complete.complete, true);
  assert.equal(complete.quantity, 0.01);
  assert.equal(complete.weightedPrice, 60_000);
  assert.equal(complete.realizedPnl, 10);
  assert.equal(complete.feeUsdt, 0.01);
  assert.equal(complete.closedAt, CLOSE_AT);
  assert.deepEqual(complete.tradeIds, ["manual-close-trade-1"]);

  const raw = db.fills.find((fill) => fill.kind === "close");
  for (const [name, mutate] of [
    ["price", (fill) => { fill.price = null; }],
    ["quantity", (fill) => { fill.quantity = null; fill.size = null; }],
    ["realized PnL", (fill) => { fill.realizedPnl = null; }],
    ["fee", (fill) => { fill.feeUsdt = null; fill.feeCostUsdt = null; }],
    ["trade ID", (fill) => { fill.exchangeTradeId = null; }],
    ["exchange time", (fill) => { fill.exchangeFilledAt = null; }]
  ]) await t.test(name, () => {
    const before = structuredClone(raw);
    mutate(raw);
    assert.equal(projection.buildAttributedManualExitClosure(db, execution).complete, false);
    Object.assign(raw, before);
  });

  db.fills.push(structuredClone(raw));
  assert.equal(projection.buildAttributedManualExitClosure(db, execution).complete, false);
});

test("partial attributed evidence cannot settle an execution", () => {
  assert.equal(typeof projection.buildAttributedManualExitClosure, "function");
  const { db, execution } = managedDb({ quantity: 0.02 });
  insertClose(db);
  const closure = projection.buildAttributedManualExitClosure(db, execution);
  assert.equal(closure.complete, false);
  assert.equal(closure.reason, "manual_exit_quantity_incomplete");
  assert.equal(execution.status, "protecting");
});

test("manual-exit settlement requires an account, environment, credential, and exchange-bound snapshot", async (t) => {
  const cases = [
    ["account", { accountId: "account-b" }],
    ["environment", { environment: "demo" }],
    ["credential", { apiKeyFingerprint: "wrong-fingerprint" }],
    ["exchange", { exchange: "BINANCE" }]
  ];
  for (const [name, override] of cases) await t.test(name, () => {
    const { db, execution } = managedDb({ status: "close_reconciliation_pending" });
    insertClose(db);
    const result = reconcilePendingClose(db, execution, {
      snapshot: {
        id: `snapshot-${name}-mismatch`,
        exchange: "OKX",
        accountId: "account-a",
        environment: "production",
        apiKeyFingerprint: API_KEY_FINGERPRINT,
        status: "ok",
        positions: [],
        createdAt: "2026-08-15T02:00:00.000Z",
        ...override
      }
    });

    assert.equal(result.status, "close_reconciliation_pending");
    assert.equal(execution.status, "close_reconciliation_pending");
    assert.equal(db.positions.some((position) => position.executionOrderId === execution.id), true);
    assert.equal(db.tradePlans.find((plan) => plan.id === execution.planId).status, "executing");
  });
});

test("a complete manual closure waits for a post-fill snapshot without retrying an outbound close", async () => {
  const { db, execution } = managedDb({ status: "close_pending" });
  execution.closeAttemptedAt = execution.closeSubmittedAt;
  insertClose(db);
  let outboundActions = 0;
  let remoteClosures = 0;
  const result = await pollExecutionOrders(db, {
    snapshot: {
      id: "snapshot-before-manual-fill",
      exchange: "OKX",
      accountId: "account-a",
      environment: "production",
      apiKeyFingerprint: API_KEY_FINGERPRINT,
      status: "ok",
      positions: [{ instId: "BTC-USDT-SWAP", posSide: "long", pos: "1" }],
      createdAt: "2026-08-15T00:45:00.000Z"
    },
    nowMs: Date.parse("2026-08-15T02:00:00.000Z"),
    closeProgressSlaMs: 0,
    maxCloseRetries: 1,
    executeTradeAction: async () => { outboundActions += 1; return { status: "submitted" }; },
    fetchManualClosure: async () => { remoteClosures += 1; return { complete: false }; }
  });

  assert.equal(outboundActions, 0);
  assert.equal(result.results[0].settlement, "authoritative_snapshot_pending");
  assert.equal(execution.status, "close_pending");
  assert.equal(remoteClosures, 0);
  assert.equal(db.fills.filter((fill) => fill.kind === "close").length, 1);
  assert.equal(db.positions.some((position) => position.executionOrderId === execution.id), true);
});

test("authoritative position absence settles from the existing manual-exit fill without an outbound action", () => {
  assert.equal(typeof projection.buildAttributedManualExitClosure, "function");
  const { db, execution } = managedDb({ status: "close_reconciliation_pending" });
  const unrelated = addManagedExecution(db, { suffix: "2", symbol: "ETH/USDT" });
  execution.affectedExecutionOrderIds = [unrelated.id];
  db.riskIncidents.push({
    id: "incident-close", kind: "close_reconciliation", source: execution.id, status: "open"
  });
  const close = insertClose(db);
  const authoritativeBefore = {
    price: close.price,
    quantity: close.quantity,
    realizedPnl: close.realizedPnl,
    feeUsdt: close.feeUsdt,
    exchangeOrderId: close.exchangeOrderId,
    exchangeTradeId: close.exchangeTradeId,
    exchangeFilledAt: close.exchangeFilledAt,
    createdAt: close.createdAt
  };
  let outboundActions = 0;
  const snapshot = {
    id: "snapshot-after-close",
    exchange: "OKX",
    accountId: "account-a",
    environment: "production",
    apiKeyFingerprint: API_KEY_FINGERPRINT,
    status: "ok",
    positions: [],
    createdAt: "2026-08-15T02:00:00.000Z"
  };

  const result = reconcilePendingClose(db, execution, {
    snapshot,
    executeTradeAction: () => { outboundActions += 1; throw new Error("unexpected outbound action"); }
  });

  assert.equal(result.status, "closed");
  assert.equal(execution.status, "closed");
  assert.equal(execution.exitReason, "manual_exit");
  assert.equal(db.fills.filter((fill) => fill.kind === "close").length, 1);
  assert.equal(db.fills.find((fill) => fill.kind === "close").exchangeTradeId, "manual-close-trade-1");
  assert.deepEqual({
    price: close.price,
    quantity: close.quantity,
    realizedPnl: close.realizedPnl,
    feeUsdt: close.feeUsdt,
    exchangeOrderId: close.exchangeOrderId,
    exchangeTradeId: close.exchangeTradeId,
    exchangeFilledAt: close.exchangeFilledAt,
    createdAt: close.createdAt
  }, authoritativeBefore);
  assert.equal(db.positions.some((position) => position.source === "execution_engine" && position.executionOrderId === execution.id), false);
  assert.equal(db.positions.some((position) => position.source === "execution_engine" && position.executionOrderId === unrelated.id), true);
  assert.equal(unrelated.status, "protecting");
  assert.equal(db.tradePlans.find((plan) => plan.id === unrelated.planId).status, "executing");
  assert.equal(db.tradePlans.find((plan) => plan.id === execution.planId).status, "completed");
  assert.equal(db.riskIncidents.find((incident) => incident.id === "incident-close").status, "resolved");
  assert.equal(outboundActions, 0);
});
