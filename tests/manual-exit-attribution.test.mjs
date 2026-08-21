import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { reconcilePendingClose } from "../server/executionEngine.mjs";
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
