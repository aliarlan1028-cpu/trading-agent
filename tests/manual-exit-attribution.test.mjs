import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { pollExecutionOrders, reconcilePendingClose } from "../server/executionEngine.mjs";
import { upsertOkxOrder } from "../server/realtimeManager.mjs";
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
