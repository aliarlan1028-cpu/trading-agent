import assert from "node:assert/strict";
import test from "node:test";
import { projectOverviewSection } from "../server/overviewView.mjs";
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

test("overview deduplicates production entry and close fills by executionOrderId and classifies their origin", () => {
  const rows = buildOverviewTradeFlow({
    executionOrders: [{ id: "o-1", symbol: "BTC/USDT", status: "filled" }, { id: "o-2", symbol: "ETH/USDT", status: "open" }],
    fills: [
      { id: "f-close", kind: "close", executionOrderId: "o-1", symbol: "BTC/USDT", createdAt: "2026-09-03T09:00:00Z" },
      { id: "f-entry", kind: "entry", executionOrderId: "o-1", symbol: "BTC/USDT", createdAt: "2026-09-03T08:00:00Z" }
    ]
  });
  assert.deepEqual(rows.map((row) => [row.id, row.kind, row.recordType]), [
    ["f-close", "close", "fill"],
    ["f-entry", "entry", "fill"],
    ["o-2", undefined, "order"]
  ]);
});

test("production cockpit projection omits cross-workspace enrichment", () => {
  const payload = projectOverviewSection({
    notifications: [],
    events: [],
    agentRuns: [],
    jobRuns: [],
    riskRules: [],
    strategyCatalog: { products: [] },
    portfolioRisk: { utilizationPct: 37, status: "ok" },
    accountSnapshots: []
  }, "cockpit");
  assert.deepEqual(payload.resourceState, { cockpit: "loaded" });
  assert.equal(Object.hasOwn(payload, "notifications"), true);
  assert.equal(Object.hasOwn(payload, "portfolioRisk"), true);
  assert.equal(Object.hasOwn(payload, "accountSnapshots"), true);
  for (const field of ["events", "agentRuns", "jobRuns", "riskRules", "strategyCatalog"]) {
    assert.equal(Object.hasOwn(payload, field), false, `${field} belongs to another workspace payload`);
  }
});

test("overview distinguishes absent enrichment from loaded empty collections", () => {
  const unavailable = buildOverviewPresentation({ markets: [], positions: [] });
  assert.deepEqual(unavailable.collectionState, {
    systemNotice: "unavailable",
    marketNotice: "unavailable",
    activities: "unavailable",
    strategyProducts: "unavailable",
    riskRules: "unavailable"
  });

  const empty = buildOverviewPresentation({
    markets: [], positions: [], notifications: [], events: [], agentRuns: [], jobRuns: [],
    strategyCatalog: { products: [] }, riskRules: []
  });
  assert.deepEqual(empty.collectionState, {
    systemNotice: "loaded",
    marketNotice: "loaded",
    activities: "loaded",
    strategyProducts: "loaded",
    riskRules: "loaded"
  });
  assert.equal(empty.activeRiskRuleCount, 0);
});

test("overview uses only authoritative portfolio risk utilization and status", () => {
  const available = buildOverviewPresentation({
    portfolio: { totalEquityUsdt: 100, availableMarginUsdt: 1 },
    portfolioRisk: { utilizationPct: 37, status: "no_positions" },
    positions: [], markets: []
  });
  assert.deepEqual(available.portfolioRisk, { utilizationPct: 37, status: "no_positions" });

  const unavailable = buildOverviewPresentation({ portfolio: { totalEquityUsdt: 100, availableMarginUsdt: 1 }, positions: [], markets: [] });
  assert.equal(unavailable.portfolioRisk, null);
});

test("overview normalizes the closed cockpit resource-state set and fails unknown values closed", () => {
  for (const state of ["not_loaded", "loading", "stale", "degraded", "error", "failed", "forbidden", "disabled"]) {
    const model = buildOverviewPresentation({ resourceState: { cockpit: state }, markets: [{ symbol: "BTC/USDT", price: 100 }], positions: [] });
    assert.equal(model.resourceState, state);
    assert.equal(model.marketReady, false);
  }
  const loaded = buildOverviewPresentation({ resourceState: { cockpit: "loaded" }, markets: [{ symbol: "BTC/USDT", price: 100 }], positions: [] });
  assert.equal(loaded.marketReady, true);
  const ready = buildOverviewPresentation({ resourceState: { cockpit: " READY " }, markets: [{ symbol: "BTC/USDT", price: 100 }], positions: [] });
  assert.equal(ready.resourceState, "loaded");
  assert.equal(ready.marketReady, true);
  const unknown = buildOverviewPresentation({ resourceState: { cockpit: "future_state" }, markets: [{ symbol: "BTC/USDT", price: 100 }], positions: [] });
  assert.equal(unknown.resourceState, "not_loaded");
  assert.equal(unknown.marketReady, false);
});

test("overview identifies last-valid facts so loading can retain only real content", () => {
  const retained = buildOverviewPresentation({
    resourceState: { cockpit: "loading" },
    portfolio: { totalEquityUsdt: 100 },
    markets: [{ symbol: "BTC/USDT", price: 100 }],
    positions: []
  });
  assert.equal(retained.hasLastValidFacts, true);
  const initial = buildOverviewPresentation({ resourceState: { cockpit: "loading" } });
  assert.equal(initial.hasLastValidFacts, false);
});

test("overview recognizes every rendered last-valid fact without accepting empty shells", () => {
  const truthfulCases = [
    ["notification", { notifications: [{ id: "n-1", title: "Account reconciliation complete" }] }],
    ["automation boundary", { automationState: { mode: "observe", label: "Observe only" } }],
    ["kill switch", { system: { killSwitch: true } }],
    ["daily-loss boundary", { system: { remainingDailyLossUsdt: 0 } }],
    ["Agent activity", { agentRuns: [{ id: "run-1", goal: "Refresh market evidence", status: "completed" }] }],
    ["job activity", { jobRuns: [{ id: "job-1", name: "Reconcile account", status: "completed" }] }],
    ["market notice", { events: [{ id: "event-1", title: "Employment report window" }] }],
    ["strategy product", { strategyCatalog: { products: [{ id: "trend-v3" }] } }],
    ["risk rule", { riskRules: [{ id: "rule-1", enabled: true }] }]
  ];
  for (const [label, facts] of truthfulCases) {
    const model = buildOverviewPresentation({ resourceState: { cockpit: "loading" }, ...facts });
    assert.equal(model.hasLastValidFacts, true, `${label} retains the loading body`);
  }

  const emptyCases = [
    {},
    { notifications: [null, {}, { id: "n-empty", title: "   " }] },
    { automationState: { mode: "", label: " ", detail: null } },
    { system: {} },
    { system: { killSwitch: false, remainingDailyLossUsdt: "\t" } },
    { agentRuns: [null, {}, { id: "run-empty" }], jobRuns: ["bad", { id: "job-empty", name: " " }] },
    { marketRegime: {} },
    { marketRegime: { summary: " ", global: {} } },
    { events: [null, {}, { title: " " }] },
    { strategyCatalog: { products: [{}, { id: " " }] } },
    { riskRules: [{}, { enabled: true }] }
  ];
  for (const facts of emptyCases) {
    const model = buildOverviewPresentation({ resourceState: { cockpit: "loading" }, ...facts });
    assert.equal(model.hasLastValidFacts, false, `empty or malformed facts block the loading body: ${JSON.stringify(facts)}`);
  }
});

test("overview never infers a loaded cockpit resource from a core market symbol", () => {
  const model = buildOverviewPresentation({
    markets: [{ symbol: "BTC/USDT", price: 100 }],
    activeMarket: { symbol: "BTC/USDT", price: 100 },
    positions: []
  });
  assert.equal(model.resourceState, "not_loaded");
  assert.equal(model.marketReady, false);
});

test("overview labels quote turnover and base volume with truthful units", () => {
  const quote = buildOverviewPresentation({ markets: [{ symbol: "BTC/USDT", volume24h: 12, quoteTurnover24h: 340 }], positions: [] });
  assert.deepEqual(quote.marketVolume, { kind: "quote", value: 340, unit: "USDT" });
  const base = buildOverviewPresentation({ markets: [{ symbol: "BTC/USDT", volume24h: 12 }], positions: [] });
  assert.deepEqual(base.marketVolume, { kind: "base", value: 12, unit: "BTC" });
  const missing = buildOverviewPresentation({ markets: [{ symbol: "BTC/USDT" }], positions: [] });
  assert.deepEqual(missing.marketVolume, { kind: "unavailable", value: null, unit: null });
});

test("overview preserves positions with unknown notional without calling the account flat", () => {
  const model = buildOverviewPresentation({ positions: [{ positionId: "p-1", symbol: "BTC/USDT", quantity: 1 }], markets: [] });
  assert.equal(model.allocation.length, 1);
  assert.equal(model.allocation[0].notionalUsdt, null);
  assert.equal(model.hasPositions, true);
  assert.equal(model.hasAllocatablePositions, false);
});

test("overview rejects whitespace-only numeric facts instead of coercing them to zero", () => {
  const model = buildOverviewPresentation({
    resourceState: { cockpit: "loaded" },
    portfolioRisk: { utilizationPct: "   ", status: "ok" },
    markets: [{ symbol: "BTC/USDT", volume24h: "\t" }],
    positions: [{ positionId: "p-blank", symbol: "BTC/USDT", quantity: 1, markPrice: "  ", unrealizedPnl: " " }],
    accountSnapshots: [{ id: "s-blank", createdAt: "2026-09-03T08:00:00Z", totalEquityUsdt: "\n" }]
  });
  assert.deepEqual(model.portfolioRisk, { utilizationPct: null, status: "ok" });
  assert.deepEqual(model.marketVolume, { kind: "unavailable", value: null, unit: null });
  assert.equal(model.allocation[0].notionalUsdt, null);
  assert.deepEqual(model.accountSnapshots, []);
});

test("overview counts only explicitly enabled risk rules", () => {
  const model = buildOverviewPresentation({ riskRules: [{ id: "unknown" }, { id: "off", enabled: false }, { id: "on", enabled: true }], positions: [], markets: [] });
  assert.equal(model.activeRiskRuleCount, 1);
});

test("overview sorts valid account snapshots chronologically for its hero trend", () => {
  const model = buildOverviewPresentation({
    accountSnapshots: [
      { id: "new", createdAt: "2026-09-03T10:00:00Z", totalEquityUsdt: 103 },
      null,
      { id: "old", createdAt: "2026-09-03T08:00:00Z", totalEquityUsdt: 101 },
      "malformed",
      { id: "mid", createdAt: "2026-09-03T09:00:00Z", totalEquityUsdt: 102 }
    ],
    positions: [], markets: []
  });
  assert.deepEqual(model.accountSnapshots.map((row) => row.id), ["old", "mid", "new"]);
});

test("overview rejects malformed trade, position, and activity rows", () => {
  assert.doesNotThrow(() => buildOverviewPresentation({
    fills: [null, "bad", { id: "f-1", kind: "fill", executionOrderId: "o-1" }],
    executionOrders: [null, 42, { id: "o-1" }],
    positions: [null, "bad", { positionId: "p-1", symbol: "BTC/USDT", quantity: 1 }],
    agentRuns: [null, "bad", { id: "run-1" }],
    jobRuns: [undefined, { id: "job-1" }],
    markets: []
  }));
  const model = buildOverviewPresentation({ fills: [null, {}], executionOrders: [null, {}], positions: [null, {}], agentRuns: [null, {}], jobRuns: [null, {}], markets: [] });
  assert.deepEqual(model.tradeFlow, []);
  assert.deepEqual(model.allocation, []);
  assert.deepEqual(model.activities, []);
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

test("position protection never falls back when an explicit execution id is missing", () => {
  const model = buildPositionPresentation({
    positions: [{ positionId: "p-1", executionOrderId: "missing-order", symbol: "BTC/USDT", quantity: 1 }],
    executionOrders: [{ id: "fallback-order", positionId: "p-1", tradePlanId: "fallback-plan" }],
    tradePlans: [{ id: "fallback-plan", stopLoss: 13.37, takeProfit: [14.88] }]
  });
  assert.equal(model.positions[0].stopLoss, null);
  assert.deepEqual(model.positions[0].takeProfits, []);
});

test("position protection rejects duplicate explicit execution identities", () => {
  const model = buildPositionPresentation({
    positions: [{ positionId: "p-1", executionOrderId: "duplicate-order", symbol: "BTC/USDT", quantity: 1 }],
    executionOrders: [
      { id: "duplicate-order", tradePlanId: "first-plan" },
      { id: "duplicate-order", tradePlanId: "second-plan" }
    ],
    tradePlans: [
      { id: "first-plan", stopLoss: 91 },
      { id: "second-plan", stopLoss: 92 }
    ]
  });
  assert.equal(model.positions[0].stopLoss, null);
});

test("position protection rejects duplicate position-linked executions", () => {
  const model = buildPositionPresentation({
    positions: [{ positionId: "duplicate-position", symbol: "BTC/USDT", quantity: 1 }],
    executionOrders: [
      { id: "first-order", positionId: "duplicate-position", tradePlanId: "first-plan" },
      { id: "second-order", positionId: "duplicate-position", tradePlanId: "second-plan" }
    ],
    tradePlans: [
      { id: "first-plan", stopLoss: 91 },
      { id: "second-plan", stopLoss: 92 }
    ]
  });
  assert.equal(model.positions[0].stopLoss, null);
});

test("position protection rejects duplicate and blank plan identities", () => {
  const duplicate = buildPositionPresentation({
    positions: [{ positionId: "p-duplicate-plan", symbol: "BTC/USDT", quantity: 1 }],
    executionOrders: [{ id: "order-1", positionId: "p-duplicate-plan", tradePlanId: "duplicate-plan" }],
    tradePlans: [{ id: "duplicate-plan", stopLoss: 91 }, { id: "duplicate-plan", stopLoss: 92 }]
  });
  const blank = buildPositionPresentation({
    positions: [{ positionId: "p-blank-plan", executionOrderId: " ", symbol: "ETH/USDT", quantity: 1 }],
    executionOrders: [{ id: "order-2", positionId: "p-blank-plan", tradePlanId: " " }],
    tradePlans: [{ id: "", stopLoss: 13.37 }, { id: " ", stopLoss: 14.88 }]
  });
  assert.equal(duplicate.positions[0].stopLoss, null);
  assert.equal(blank.positions[0].stopLoss, null);
});

test("position protection uses one unique position fallback and one unique plan", () => {
  const model = buildPositionPresentation({
    positions: [{ positionId: "unique-position", symbol: "SOL/USDT", quantity: 1 }],
    executionOrders: [{ id: "unique-order", positionId: "unique-position", tradePlanId: "unique-plan" }],
    tradePlans: [{ id: "unique-plan", stopLoss: 88, takeProfit: [123] }]
  });
  assert.equal(model.positions[0].stopLoss, 88);
  assert.deepEqual(model.positions[0].takeProfits, [123]);
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
