import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-execution-workspaces");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => {
  try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ }
});

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { PlanWorkspace, planSelectionCandidate, runPlanDecision } from "./src/kordynV2/domains/account/PlanWorkspace.jsx";
      export { OrderWorkspace, orderSelectionCandidate, executionWorkspaceSelectionCandidate } from "./src/kordynV2/domains/account/OrderWorkspace.jsx";
      export { FillWorkspace, fillSelectionCandidate, closedTradeSelectionCandidate, reviewSelectionCandidate } from "./src/kordynV2/domains/account/FillWorkspace.jsx";
      export { ClosedTradeOutputSheet, closedTradePosterEligibility, runClosedTradePosterDownload } from "./src/kordynV2/domains/account/ClosedTradeOutputSheet.jsx";
      export { MobileExecutionScreen } from "./src/kordynV2/domains/account/MobileExecutionScreen.jsx";
      export { buildAccountDomainModel } from "./src/kordynV2/domains/account/accountModel.js";
      export { createV2Selection } from "./src/kordynV2/viewModels/selection.js";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "lucide-react"],
  outfile: outFile,
  logLevel: "silent"
});

const {
  PlanWorkspace,
  OrderWorkspace,
  FillWorkspace,
  ClosedTradeOutputSheet,
  MobileExecutionScreen,
  buildAccountDomainModel,
  createV2Selection,
  planSelectionCandidate,
  orderSelectionCandidate,
  executionWorkspaceSelectionCandidate,
  fillSelectionCandidate,
  closedTradeSelectionCandidate,
  reviewSelectionCandidate,
  closedTradePosterEligibility,
  runClosedTradePosterDownload,
  runPlanDecision
} = require(outFile);

const createdAt = "2026-08-30T06:00:00.000Z";
const completedAt = "2026-08-30T07:00:00.000Z";

const plan = (overrides = {}) => ({
  id: "plan-1",
  status: "awaiting_approval",
  symbol: "ETH/USDT",
  direction: "long",
  strategy: "breakout_guarded",
  agentRunId: "mission-1",
  createdAt,
  expiresAt: "2026-08-30T06:15:00.000Z",
  entry_range: [3420, 3440],
  stopLoss: 3365,
  takeProfit: [3515, 3590],
  quantity: 2.4,
  leverage: 3,
  riskPercent: 0.8,
  lastRiskCheck: { id: "risk-1", passed: true, summary: "风险边界通过", warnings: [], blockers: [] },
  evidenceIds: ["evidence-1"],
  accountImpact: {
    equityUsdt: 28640.72,
    availableMarginUsdt: 13870.1,
    openPositionCount: 1,
    projectedOpenPositionCount: 2,
    estimatedMaxLossUsdt: 229.13
  },
  ...overrides
});

const execution = (overrides = {}) => ({
  id: "execution-1",
  planId: "plan-1",
  positionId: "position-1",
  symbol: "ETH/USDT",
  direction: "long",
  status: "closed",
  exchange: "OKX",
  accountId: "account-okx",
  quantity: 2.4,
  filledQuantity: 2.4,
  entryPrice: 3430,
  stopLoss: 3365,
  createdAt,
  updatedAt: completedAt,
  ...overrides
});

const order = (overrides = {}) => ({
  id: "order-1",
  orderId: "okx-order-1",
  executionOrderId: "execution-1",
  planId: "plan-1",
  symbol: "ETH/USDT",
  side: "buy",
  type: "limit",
  status: "filled",
  source: "exchange_rest",
  exchange: "OKX",
  accountId: "account-okx",
  quantity: 2.4,
  filledQuantity: 2.4,
  remainingQuantity: 0,
  price: 3430,
  avgFillPrice: 3429.8,
  reduceOnly: false,
  clientOrderId: "client-order-1",
  createdAt,
  updatedAt: completedAt,
  ...overrides
});

const fill = (overrides = {}) => ({
  id: "fill-1",
  tradeId: "okx-trade-1",
  executionOrderId: "execution-1",
  orderId: "order-1",
  tradePlanId: "plan-1",
  tradeLifecycleKey: "execution-1",
  kind: "close",
  symbol: "ETH/USDT",
  direction: "long",
  quantity: 2.4,
  price: 3510,
  realizedPnl: 192,
  feeUsdt: 1.2,
  source: "exchange_rest",
  createdAt: completedAt,
  ...overrides
});

const lifecycle = (overrides = {}) => ({
  id: "closed:execution-1",
  executionOrderId: "execution-1",
  tradeLifecycleKey: "execution-1",
  fillIds: ["fill-1"],
  symbol: "ETH/USDT",
  direction: "long",
  quantity: 2.4,
  entryPrice: 3430,
  exitPrice: 3510,
  realizedPnl: 192,
  entryFeeUsdt: 0.8,
  feeUsdt: 1.2,
  fundingFeeUsdt: -0.5,
  netRealizedPnl: 189.5,
  closeCount: 1,
  financialBasisComplete: true,
  financialBasis: "exchange_fills_and_okx_funding_bills_reconciled",
  createdAt: completedAt,
  ...overrides
});

const review = (overrides = {}) => ({
  id: "review-1",
  type: "trade",
  status: "completed",
  title: "ETH 执行复盘",
  symbol: "ETH/USDT",
  executionOrderId: "execution-1",
  tradeLifecycleKey: "execution-1",
  fillIds: ["fill-1"],
  netRealizedPnl: 189.5,
  summary: "保护边界内完成",
  completedAt,
  ...overrides
});

const dataFixture = (overrides = {}) => ({
  resourceState: { cockpit: "loaded", researchCenter: "loaded" },
  tradePlans: [plan()],
  executionOrders: [execution()],
  orders: [order()],
  fills: [fill()],
  reviews: [review()],
  closedTradeLifecycles: [lifecycle()],
  ...overrides
});

const modelFixture = (overrides = {}) => buildAccountDomainModel(dataFixture(overrides));
const selection = (id, type) => ({ object: { id, type }, context: { objectId: id }, trace: { objectId: id } });
const readyState = { kind: "ready", source: "OKX cockpit", lastValidAt: completedAt };
const truth = { mode: "full", equity: 28640.72, available: 13870.1, exposure: 8232 };

test("account execution model projects distinct bounded Trade plan, Execution, Order, Fill, Review, and Closed trade records", () => {
  const model = modelFixture();
  assert.deepEqual(model.plans.map((row) => row.id), ["plan-1"]);
  assert.deepEqual(model.execution.orders.map((row) => row.id), ["execution-1"]);
  assert.deepEqual(model.orders.map((row) => row.id), ["order-1"]);
  assert.deepEqual(model.fills.map((row) => row.id), ["fill-1"]);
  assert.deepEqual(model.reviews.map((row) => row.id), ["review-1"]);
  assert.deepEqual(model.closedTrades.map((row) => row.id), ["closed:execution-1"]);
  assert.equal(model.closedTrades[0].netRealizedPnl, 189.5);
  assert.equal(model.closedTrades[0].entryFeeUsdt, 0.8);
  assert.equal(model.closedTrades[0].closeFeeUsdt, 1.2);
  assert.equal(model.closedTrades[0].fundingFeeUsdt, -0.5);
  assert.equal(model.closedTrades[0].review?.id, "review-1");
  assert.deepEqual(model.closedTrades[0].poster, { state: "eligible", executionId: "execution-1" });
  assert.doesNotThrow(() => JSON.stringify(model));
});

test("Trade plan authorization derives bounded account impact from authoritative portfolio and positions when deployed plans omit accountImpact", () => {
  const model = modelFixture({
    portfolio: { totalEquityUsdt: 10_000, availableMarginUsdt: 7_200 },
    positions: [
      { positionId: "pos-open-1", symbol: "ETH/USDT", quantity: 1, markPrice: 3420, margin: 900 },
      { positionId: "pos-open-2", instId: "BTC-USDT-SWAP", quantity: "0.1", mark: "68200", initialMargin: "1200" }
    ],
    tradePlans: [plan({ accountImpact: undefined })]
  });
  assert.deepEqual(model.plans[0].accountImpact, {
    equityUsdt: 10_000,
    availableMarginUsdt: 7_200,
    openPositionCount: 2,
    projectedOpenPositionCount: 3,
    estimatedMaxLossUsdt: 80
  });
  assert.equal(model.plans[0].approval.valid, true);
  assert.deepEqual(model.plans[0].approval.missingFacts, []);
});

test("execution projections retain authoritative zero while missing finance remains null", () => {
  const model = modelFixture({
    fills: [fill({ realizedPnl: 0, feeUsdt: 0 })],
    closedTradeLifecycles: [lifecycle({ realizedPnl: 0, entryFeeUsdt: 0, feeUsdt: 0, fundingFeeUsdt: 0, netRealizedPnl: 0 })]
  });
  assert.equal(model.fills[0].grossRealizedPnl, 0);
  assert.equal(model.fills[0].feeUsdt, 0);
  assert.equal(model.closedTrades[0].netRealizedPnl, 0);

  const missing = modelFixture({
    fills: [fill({ realizedPnl: undefined, feeUsdt: undefined })],
    closedTradeLifecycles: [lifecycle({ realizedPnl: undefined, entryFeeUsdt: undefined, feeUsdt: undefined, fundingFeeUsdt: undefined, netRealizedPnl: undefined, financialBasisComplete: false })]
  });
  assert.equal(missing.fills[0].grossRealizedPnl, null);
  assert.equal(missing.fills[0].feeUsdt, null);
  assert.equal(missing.closedTrades[0].netRealizedPnl, null);
  assert.equal(missing.closedTrades[0].poster.state, "finance_unreconciled");
});

test("missing lifecycle is not reconstructed from fills and keeps not_loaded truth", () => {
  const model = modelFixture({ closedTradeLifecycles: undefined });
  assert.equal(model.execution.lifecycleState, "not_loaded");
  assert.deepEqual(model.closedTrades, []);
  assert.equal(model.availability.closedTrades.state, "absent");
});

test("hostile and duplicate execution records fail closed while valid siblings remain serializable", () => {
  const hostile = {};
  Object.defineProperty(hostile, "id", { enumerable: true, get() { throw new Error("SECRET_EXECUTION_ID"); } });
  const nested = fill({ id: "hostile-fill" });
  Object.defineProperty(nested, "metadata", { enumerable: true, value: { toJSON() { throw new Error("SECRET_TO_JSON"); } } });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const model = modelFixture({
    tradePlans: [plan({ id: "duplicate-plan" }), plan({ id: "duplicate-plan" }), hostile, plan()],
    orders: [order({ id: "duplicate-order" }), order({ id: "duplicate-order" }), revoked.proxy, order()],
    fills: [nested, revoked.proxy, fill()],
    reviews: [review({ id: "duplicate-review" }), review({ id: "duplicate-review" }), hostile, review()],
    closedTradeLifecycles: [lifecycle({ id: "duplicate-close" }), lifecycle({ id: "duplicate-close" }), hostile, lifecycle()]
  });
  assert.deepEqual(model.plans.map((row) => row.id), ["plan-1"]);
  assert.deepEqual(model.orders.map((row) => row.id), ["order-1"]);
  assert.deepEqual(model.fills.map((row) => row.id), ["hostile-fill", "fill-1"]);
  assert.deepEqual(model.reviews.map((row) => row.id), ["review-1"]);
  assert.deepEqual(model.closedTrades.map((row) => row.id), ["closed:execution-1"]);
  assert.doesNotThrow(() => JSON.stringify(model));
  assert.doesNotMatch(JSON.stringify(model), /SECRET_/u);
});

test("review and lifecycle linkage requires exact unique source-backed evidence and never symbol-only matching", () => {
  const symbolOnly = modelFixture({
    fills: [fill({ executionOrderId: undefined, orderId: undefined, tradePlanId: undefined, tradeLifecycleKey: undefined })],
    reviews: [review({ executionOrderId: undefined, tradeLifecycleKey: undefined, fillIds: [] })],
    closedTradeLifecycles: [lifecycle({ executionOrderId: undefined, tradeLifecycleKey: "other", fillIds: [] })]
  });
  assert.equal(symbolOnly.fills[0].review, null);
  assert.equal(symbolOnly.fills[0].closedTrade, null);

  const ambiguous = modelFixture({ reviews: [review(), review({ id: "review-2" })] });
  assert.equal(ambiguous.fills[0].review, null);
  assert.equal(ambiguous.closedTrades[0].review, null);
});

test("conflicting explicit lifecycle, execution, or fill identifiers fail closed instead of OR-linking related records", () => {
  const model = modelFixture({
    fills: [fill({ executionOrderId: "execution-1", tradeLifecycleKey: "execution-1" })],
    reviews: [review({ executionOrderId: "execution-1", tradeLifecycleKey: "conflicting-lifecycle", fillIds: ["fill-1"] })],
    closedTradeLifecycles: [lifecycle({ executionOrderId: "conflicting-execution", tradeLifecycleKey: "execution-1", fillIds: ["other-fill"] })]
  });
  assert.equal(model.fills[0].review, null);
  assert.equal(model.fills[0].closedTrade, null);
  assert.equal(model.closedTrades[0].review, null);
});

test("exchange acceptance, fill receipt, and financial reconciliation remain separate finality facts", () => {
  const model = modelFixture({
    orders: [order({ status: "accepted", filledQuantity: 0, remainingQuantity: 2.4 })],
    fills: [fill({ kind: "close", partial: false })],
    closedTradeLifecycles: [lifecycle({ financialBasisComplete: false, netRealizedPnl: null })]
  });
  assert.equal(model.orders[0].finality, "exchange_accepted");
  assert.equal(model.fills[0].finality, "exchange_fill_recorded");
  assert.equal(model.closedTrades[0].finality, "finance_unreconciled");
});

test("selection candidates use exact deployed object types and routes", () => {
  assert.equal(planSelectionCandidate(modelFixture().plans[0]).type, "Trade plan");
  assert.equal(executionWorkspaceSelectionCandidate(modelFixture().execution.orders[0]).type, "Execution");
  assert.equal(orderSelectionCandidate(modelFixture().orders[0]).type, "Order");
  assert.equal(fillSelectionCandidate(modelFixture().fills[0]).type, "Fill");
  assert.equal(closedTradeSelectionCandidate(modelFixture().closedTrades[0]).type, "Closed trade");
  assert.equal(reviewSelectionCandidate(modelFixture().reviews[0]).type, "Review");
  assert.equal(planSelectionCandidate({ id: "Unavailable" }), null);
  assert.equal(closedTradeSelectionCandidate({ id: "unknown" }), null);
});

test("canonical Root selection keeps Object Context and Trace identity aligned for every execution object", () => {
  const data = dataFixture();
  const candidates = [
    ["plan-1", "Trade plan"], ["execution-1", "Execution"], ["order-1", "Order"],
    ["fill-1", "Fill"], ["closed:execution-1", "Closed trade"], ["review-1", "Review"]
  ];
  for (const [id, type] of candidates) {
    const resolved = createV2Selection({ data, candidate: { id, type, workspaceId: "account" } });
    assert.equal(resolved?.object.id, id, type);
    assert.equal(resolved?.object.type, type, type);
    assert.equal(resolved?.context.objectId, id, type);
    assert.equal(resolved?.trace.objectId, id, type);
  }
});

test("Desktop execution workspaces render distinct registries, dominant truth, and bounded evidence rails", () => {
  const model = modelFixture();
  const props = { model, truth, state: readyState, actions: {}, actionsDisabled: false, onSelect() {} };
  const plans = renderToStaticMarkup(React.createElement(PlanWorkspace, { ...props, selection: selection("plan-1", "Trade plan") }));
  const orders = renderToStaticMarkup(React.createElement(OrderWorkspace, { ...props, selection: selection("order-1", "Order") }));
  const fills = renderToStaticMarkup(React.createElement(FillWorkspace, { ...props, selection: selection("fill-1", "Fill") }));
  assert.match(plans, /data-kordyn-v2-object-type="Trade plan"/u);
  assert.match(plans, /交易意图|风险与授权证据/u);
  assert.match(orders, /data-kordyn-v2-execution-lane/u);
  assert.match(orders, /data-kordyn-v2-order-lane/u);
  assert.match(orders, /交易所接受不代表成交或财务最终性/u);
  assert.match(fills, /data-kordyn-v2-object-type="Fill"/u);
  assert.match(fills, /已平仓生命周期|净实现盈亏/u);
  assert.doesNotMatch(fills, /data-kordyn-v2-object-type="Position"/u);
});

test("execution workspaces preserve absent and invalid resource states instead of showing loaded-empty copy", () => {
  const props = { truth, state: readyState, actions: {}, actionsDisabled: false, selection: null, onSelect() {} };
  const absent = modelFixture({
    executionOrders: undefined,
    orders: undefined,
    fills: undefined,
    reviews: undefined,
    closedTradeLifecycles: undefined
  });
  const absentOrders = renderToStaticMarkup(React.createElement(OrderWorkspace, { ...props, model: absent }));
  const absentMobile = renderToStaticMarkup(React.createElement(MobileExecutionScreen, { ...props, model: absent, workspaceId: "orders", view: "list" }));
  assert.match(absentOrders, /Execution 意图明确未加载|Order 交易所事实明确未加载/u);
  assert.match(absentMobile, /Execution 意图明确未加载|Order 交易所事实明确未加载/u);
  assert.doesNotMatch(absentOrders, /当前没有可用的 Execution 对象|当前没有可用的 Order 对象/u);

  const invalid = modelFixture({
    executionOrders: [{}],
    orders: [{}],
    fills: [{}],
    reviews: [{}],
    closedTradeLifecycles: [{}]
  });
  const invalidOrders = renderToStaticMarkup(React.createElement(OrderWorkspace, { ...props, model: invalid }));
  const invalidFills = renderToStaticMarkup(React.createElement(MobileExecutionScreen, { ...props, model: invalid, workspaceId: "fills", view: "list" }));
  assert.match(invalidOrders, /Execution 意图事实不可用|Order 交易所事实不可用/u);
  assert.match(invalidFills, /Fill 流水事实不可用|Closed trade 事实不可用|Review 事实不可用/u);
  assert.doesNotMatch(invalidFills, /当前没有成交|暂无真实交易复盘对象/u);
});

test("plan decisions reuse the authoritative settlement classifier without optimistic success", async () => {
  const projectedPlan = modelFixture().plans[0];
  const states = [];
  const partial = await runPlanDecision({
    kind: "approve",
    plan: projectedPlan,
    actions: { approvePlan: async () => ({ plan: { id: "plan-1", status: "approved" }, approvalGranted: true, executionSubmitted: false }) },
    onState: (state) => states.push(state)
  });
  assert.equal(partial.executionSubmitted, false);
  assert.deepEqual(states.map((state) => state.kind), ["processing", "partial"]);

  const failedStates = [];
  await runPlanDecision({
    kind: "approve",
    plan: projectedPlan,
    actions: { approvePlan: async () => ({ ok: false, error: "risk_blocked" }) },
    onState: (state) => failedStates.push(state)
  });
  assert.deepEqual(failedStates.map((state) => state.kind), ["processing", "failed"]);
});

test("poster eligibility requires an exact reconciled lifecycle and a unique closed Execution", () => {
  const eligible = modelFixture().closedTrades[0];
  assert.deepEqual(closedTradePosterEligibility(eligible), { state: "eligible", executionId: "execution-1" });
  assert.equal(modelFixture({ executionOrders: [] }).closedTrades[0].poster.state, "execution_unavailable");
  assert.equal(modelFixture({ executionOrders: [execution({ status: "protecting" })] }).closedTrades[0].poster.state, "execution_not_closed");
  assert.equal(modelFixture({ closedTradeLifecycles: [lifecycle({ financialBasisComplete: false, netRealizedPnl: null })] }).closedTrades[0].poster.state, "finance_unreconciled");
});

test("closed-trade output invokes only downloadClosedTradePoster with the exact Execution id", async () => {
  const calls = [];
  const states = [];
  const result = await runClosedTradePosterDownload({
    closedTrade: modelFixture().closedTrades[0],
    actions: { downloadClosedTradePoster: async (id) => { calls.push(id); return { ok: true }; } },
    onState: (state) => states.push(state)
  });
  assert.deepEqual(calls, ["execution-1"]);
  assert.deepEqual(states.map((state) => state.kind), ["processing", "returned"]);
  assert.deepEqual(result, { ok: true });
});

test("closed-trade output surface makes no translation, preview-generation, or automatic delivery claim", () => {
  const html = renderToStaticMarkup(React.createElement(ClosedTradeOutputSheet, {
    closedTrade: modelFixture().closedTrades[0], actions: {}, actionsDisabled: true
  }));
  assert.match(html, /服务端 PNG|浏览器下载/u);
  assert.doesNotMatch(html, /English|翻译|Telegram|自动投递|PosterCanvas|html-to-image/u);
});

test("APP execution screen uses list-detail flows with canonical controls and focusable detail headings", () => {
  const model = modelFixture();
  for (const [workspaceId, objectId, objectType] of [
    ["plans", "plan-1", "Trade plan"], ["orders", "order-1", "Order"], ["fills", "fill-1", "Fill"]
  ]) {
    const html = renderToStaticMarkup(React.createElement(MobileExecutionScreen, {
      workspaceId,
      model,
      view: "detail",
      selection: selection(objectId, objectType),
      detailHeadingRef: { current: null },
      onOpenList() {}, onSelect() {}
    }));
    assert.match(html, new RegExp(`data-kordyn-v2-execution-back="${workspaceId}"`, "u"));
    assert.match(html, /tabindex="-1"/u, workspaceId);
  }
  const html = renderToStaticMarkup(React.createElement(MobileExecutionScreen, { workspaceId: "orders", model, view: "list", selection: null }));
  assert.doesNotMatch(html, /<table/u);
});

test("APP execution controls have the Account-owned 44px touch contract and no horizontal escape", () => {
  const css = fs.readFileSync(path.join(rootDir, "src/kordynV2/domains/account/account.css"), "utf8");
  assert.match(css, /\.kordynV2ExecutionMobile[\s\S]*min-height:\s*44px/u);
  assert.doesNotMatch(css, /\.kordynV2ExecutionMobile[^}]*100vw/u);
  assert.doesNotMatch(css, /\.kordynV2ExecutionMobile[^}]*overflow-x:\s*(?:auto|scroll)/u);
});

test("ClosedTradeOutputSheet body is the scroll container for long reconciled output while shell focus remains trapped", () => {
  const css = fs.readFileSync(path.join(rootDir, "src/kordynV2/domains/account/account.css"), "utf8");
  assert.match(css, /\.kordynV2ClosedTradeOutputBody\s*\{[\s\S]*min-height:\s*0/u);
  assert.match(css, /\.kordynV2ClosedTradeOutputBody\s*\{[\s\S]*overflow-y:\s*auto/u);
  assert.doesNotMatch(css, /\.kordynV2ClosedTradeOutputSheet\s*>\s*section\s*\{[\s\S]*overflow-y:\s*auto/u);
});
