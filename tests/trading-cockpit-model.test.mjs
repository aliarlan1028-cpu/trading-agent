import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLedgerPresentation,
  buildOverviewPresentation,
  buildOverviewTradeFlow,
  buildPositionPresentation,
  buildReviewPresentation,
  buildSelectedExecutionStages,
  cockpitObjectId
} from "../src/aug15/tradingCockpit/model.js";

test("canonical cockpit identity supports real position shapes", () => {
  assert.equal(cockpitObjectId({ positionId: "p-1" }), "p-1");
  assert.equal(cockpitObjectId({ instId: "BTC-USDT-SWAP" }), "BTC-USDT-SWAP");
});

test("overview shows a fill once instead of duplicating its order", () => {
  const rows = buildOverviewTradeFlow({
    executionOrders: [{ id: "o-1", symbol: "BTC/USDT", status: "filled" }],
    fills: [{ id: "f-1", orderId: "o-1", symbol: "BTC/USDT" }]
  });
  assert.deepEqual(rows.map((row) => row.id), ["f-1"]);
});

test("overview presentation keeps system and market notices distinct", () => {
  const model = buildOverviewPresentation({
    notifications: [{ id: "n-1", title: "账户对账完成" }],
    events: [{ id: "e-1", title: "非农数据" }],
    markets: [{ symbol: "BTC/USDT", price: 100 }],
    positions: []
  });
  assert.equal(model.systemNotice.title, "账户对账完成");
  assert.equal(model.marketNotice.title, "非农数据");
});

test("overview preserves an unavailable market instead of inventing a default symbol", () => {
  const model = buildOverviewPresentation({ markets: [], positions: [] });
  assert.equal(model.market, null);
  assert.deepEqual(model.markets, []);
});

test("overview rejects an identity-less active market instead of mounting it as current", () => {
  const model = buildOverviewPresentation({ activeMarket: {}, markets: [], positions: [] });
  assert.equal(model.market, null);
});

test("position protection is joined only from the matching plan or order", () => {
  const model = buildPositionPresentation({
    positions: [{ positionId: "p-1", symbol: "BTC/USDT", executionOrderId: "o-1", quantity: 1 }],
    executionOrders: [{ id: "o-1", tradePlanId: "plan-1" }, { id: "o-2", tradePlanId: "plan-2" }],
    tradePlans: [{ id: "plan-1", stopLoss: 90, takeProfit: [120] }, { id: "plan-2", stopLoss: 1, takeProfit: [2] }]
  });
  assert.equal(model.positions[0].stopLoss, 90);
  assert.deepEqual(model.positions[0].takeProfits, [120]);
});

test("execution stages never borrow evidence from another order", () => {
  const stages = buildSelectedExecutionStages({
    executionOrders: [{ id: "o-1", tradePlanId: "p-1" }, { id: "o-2", tradePlanId: "p-2" }],
    tradePlans: [{ id: "p-2", status: "approved" }],
    riskChecks: [{ executionOrderId: "o-2", status: "passed" }],
    fills: [{ orderId: "o-2", id: "f-2" }]
  }, { id: "o-1", tradePlanId: "p-1", status: "open" });
  assert.equal(stages.find((stage) => stage.id === "risk").done, false);
  assert.equal(stages.find((stage) => stage.id === "fill").done, false);
});

test("execution stages fail closed when the selected order has no identity", () => {
  const stages = buildSelectedExecutionStages({ riskChecks: [{ status: "passed" }], fills: [{ id: "f-1" }] }, { status: "open" });
  assert.equal(stages.find((stage) => stage.id === "risk").done, false);
  assert.equal(stages.find((stage) => stage.id === "fill").done, false);
});

test("position protection fails closed when no order or position link exists", () => {
  const model = buildPositionPresentation({
    positions: [{ instId: "BTC-USDT-SWAP", quantity: 1 }],
    executionOrders: [{ id: "o-1", tradePlanId: "plan-1" }],
    tradePlans: [{ id: "plan-1", stopLoss: 90 }]
  });
  assert.equal(model.positions[0].stopLoss, null);
});

test("review labels absent drawdown as unavailable instead of inventing it", () => {
  const model = buildReviewPresentation({ performance: { trades: 1, profitFactor: 1.4 }, reviews: [], closedTradeLifecycles: [] });
  assert.equal(model.metrics.maxDrawdownPct, null);
  assert.equal(model.metrics.profitFactor, 1.4);
});

test("review preserves explicit null metrics as unavailable", () => {
  const model = buildReviewPresentation({ performance: { maxDrawdownPct: null, profitFactor: null }, reviews: [], closedTradeLifecycles: [] });
  assert.equal(model.metrics.maxDrawdownPct, null);
  assert.equal(model.metrics.profitFactor, null);
});

test("ledger derives counts and fees from real rows", () => {
  const model = buildLedgerPresentation({
    executionOrders: [{ id: "o-1", status: "filled" }, { id: "o-2", status: "open" }],
    fills: [{ id: "f-1", orderId: "o-1", feeUsdt: -0.5 }]
  });
  assert.deepEqual(model.metrics, { total: 2, working: 1, filled: 1, blocked: 0, fillRatePct: 50, feesUsdt: -0.5 });
});

test("ledger counts canceled orders in its rejected or canceled metric", () => {
  const model = buildLedgerPresentation({
    executionOrders: [{ id: "o-1", status: "canceled" }, { id: "o-2", status: "cancelled" }, { id: "o-3", status: "rejected" }]
  });
  assert.equal(model.metrics.blocked, 3);
});

test("ledger fails closed when only an unmodeled raw order list exists", () => {
  const model = buildLedgerPresentation({ orders: [{ id: "unmodeled-order", status: "open" }] });
  assert.deepEqual(model.orders, []);
  assert.equal(model.metrics.total, 0);
});
