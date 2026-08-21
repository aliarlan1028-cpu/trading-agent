import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExecutionFillAttribution,
  buildExternalFillAttribution,
  classifyTradeFill,
  groupSystemClosedTradeLifecycles,
  projectSystemTradeFill,
  systemTradeFills
} from "../server/systemTradeProjection.mjs";

function baseDb() {
  return { fills: [], executionOrders: [], tradePlans: [] };
}

function financiallyCompletePair(options = {}) {
  const executionOrderId = options.executionOrderId === undefined ? "exec-1" : options.executionOrderId;
  const planId = options.planId === undefined ? "plan-1" : options.planId;
  const common = {
    executionOrderId,
    planId,
    tradePlanId: planId,
    exchange: "OKX",
    exchangeOrderId: options.exchangeOrderId ?? "order-1",
    accountId: options.accountId ?? "account-a",
    environment: options.environment ?? "production",
    symbol: options.symbol ?? "BTC/USDT",
    direction: options.direction ?? "long",
    origin: options.origin,
    tradeAttribution: options.tradeAttribution,
    quantity: .01
  };
  return [
    {
      ...common,
      id: "entry-1",
      kind: "entry",
      feeUsdt: 0,
      feeSchemaVersion: 2,
      feeSource: "fixture_exchange_fill",
      estimatedFee: false,
      createdAt: "2026-08-01T00:00:00.000Z"
    },
    {
      ...common,
      id: "close-1",
      kind: "close",
      feeUsdt: 0,
      feeSchemaVersion: 2,
      feeSource: "fixture_exchange_fill",
      estimatedFee: false,
      fundingFeeUsdt: 0,
      fundingReconciled: true,
      realizedPnl: 10,
      createdAt: "2026-08-01T01:00:00.000Z"
    }
  ];
}

function systemDb(options = {}) {
  const db = baseDb();
  const execution = {
    id: options.executionOrderId || "exec-1",
    planId: options.planId || "plan-1",
    exchange: "OKX",
    exchangeOrderId: options.exchangeOrderId || "order-1",
    accountId: options.accountId || "account-a",
    environment: options.environment || "production",
    symbol: options.symbol || "BTC/USDT",
    direction: options.direction || "long",
    status: "closed"
  };
  db.executionOrders.push(execution);
  db.tradePlans.push({ id: execution.planId, symbol: execution.symbol, direction: execution.direction });
  db.fills = financiallyCompletePair(options);
  return db;
}

test("fully manual exchange lifecycle stays raw but is absent from system projection", () => {
  const db = baseDb();
  db.fills = financiallyCompletePair({ executionOrderId: null, planId: null, origin: "external" });
  const before = structuredClone(db.fills);

  assert.equal(systemTradeFills(db).length, 0);
  assert.equal(groupSystemClosedTradeLifecycles(db).length, 0);
  assert.equal(classifyTradeFill(db, db.fills[0]).scope, "manual");
  assert.deepEqual(db.fills, before);
});

test("persisted execution and plan evidence admit one system lifecycle", () => {
  const db = systemDb({ executionOrderId: "exec-1", planId: "plan-1" });

  assert.equal(systemTradeFills(db).length, 2);
  assert.equal(groupSystemClosedTradeLifecycles(db)[0].key, "exec-1");
});

test("forged system metadata without matching persisted execution fails closed", () => {
  const db = baseDb();
  db.fills = financiallyCompletePair({
    executionOrderId: "missing",
    tradeAttribution: { schemaVersion: 1, scope: "system", executionOrderId: "missing", planId: "missing" }
  });

  assert.equal(systemTradeFills(db).length, 0);
  assert.equal(classifyTradeFill(db, db.fills[0]).scope, "attribution_pending");
});

test("binding conflict excludes a superficially linked fill", () => {
  const db = systemDb({ executionOrderId: "exec-1", planId: "plan-1", accountId: "account-a" });
  db.fills[0].accountId = "account-b";

  assert.equal(classifyTradeFill(db, db.fills[0]).reason, "trade_account_binding_conflict");
  assert.equal(projectSystemTradeFill(db, db.fills[0]), null);
});

for (const [name, mutate, reason] of [
  ["symbol", (db) => { db.fills[0].symbol = "ETH/USDT"; }, "trade_symbol_binding_conflict"],
  ["environment", (db) => { db.fills[0].environment = "sandbox"; }, "trade_environment_binding_conflict"],
  ["direction", (db) => { db.fills[0].direction = "short"; }, "trade_direction_binding_conflict"],
  ["plan", (db) => { db.fills[0].planId = "plan-2"; }, "trade_plan_binding_conflict"],
  ["exchange order identity", (db) => { db.fills[0].exchangeOrderId = "order-2"; }, "trade_exchange_order_binding_conflict"]
]) {
  test(`${name} binding conflicts fail closed`, () => {
    const db = systemDb();
    mutate(db);

    assert.deepEqual(classifyTradeFill(db, db.fills[0]).scope, "attribution_pending");
    assert.equal(classifyTradeFill(db, db.fills[0]).reason, reason);
  });
}

test("unmodified legacy positive-provenance row is projected without rewriting the raw fill", () => {
  const db = systemDb();
  const fill = db.fills[0];
  const before = structuredClone(fill);

  const projected = projectSystemTradeFill(db, fill);

  assert.equal(projected.executionOrderId, "exec-1");
  assert.equal(projected.planId, "plan-1");
  assert.equal(projected.tradeAttribution.method, "legacy_positive_provenance");
  assert.deepEqual(fill, before);
});

test("legacy exchange-order identity resolves its persisted execution and plan", () => {
  const db = systemDb();
  db.fills = financiallyCompletePair({ executionOrderId: null, planId: null, exchangeOrderId: "order-1" });

  const attribution = classifyTradeFill(db, db.fills[0]);

  assert.deepEqual({ scope: attribution.scope, executionOrderId: attribution.executionOrderId, planId: attribution.planId }, {
    scope: "system", executionOrderId: "exec-1", planId: "plan-1"
  });
});

test("attribution builders preserve authoritative bindings and classify external fills manually", () => {
  const db = systemDb();
  const execution = db.executionOrders[0];
  const systemAttribution = buildExecutionFillAttribution(db, execution, db.fills[0]);
  const externalAttribution = buildExternalFillAttribution(baseDb(), {
    kind: "entry", accountId: "account-a", environment: "production", exchangeOrderId: "manual-1", exchangeTradeId: "trade-1", quantity: .01
  });

  assert.deepEqual({
    scope: systemAttribution.scope,
    executionOrderId: systemAttribution.executionOrderId,
    planId: systemAttribution.planId,
    method: systemAttribution.method
  }, { scope: "system", executionOrderId: "exec-1", planId: "plan-1", method: "execution_writer" });
  assert.deepEqual({
    scope: externalAttribution.scope,
    origin: externalAttribution.origin,
    method: externalAttribution.method
  }, { scope: "manual", origin: "external_exchange", method: "external_unmanaged" });
});
