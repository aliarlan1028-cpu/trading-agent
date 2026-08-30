import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizePositionsForUi } from "../server/positionView.mjs";
import AccountDomain from "../src/kordynV2/domains/account/index.jsx";
import { KordynV2Root } from "../src/kordynV2/KordynV2Root.jsx";
import { createV2Selection } from "../src/kordynV2/viewModels/selection.js";

const asOf = new Date().toISOString();
const openedAt = new Date(Date.parse(asOf) - 60_000).toISOString();
const longFinancialBasis = [
  "exchange_fills_and_okx_funding_bills_reconciled",
  "fees: entry and close separated",
  "funding bills checked",
  "poster output remains a bounded server-download action"
].join(" · ").repeat(6);
const rawPositionMirrors = Object.freeze([
  Object.freeze({
    positionId: "position-1", symbol: "ETH/USDT", instId: "ETH-USDT-SWAP", direction: "long",
    source: "execution_engine", quantity: 2.4, entry: 3420.5, mark: 3468.2,
    liquidationPrice: 1980, unrealizedPnl: 114.48, notional: 8323.68, margin: 2774.56,
    leverage: 3, liqDistancePct: 42.6, stopLossPrice: 3365, takeProfits: Object.freeze([3515, 3590]),
    executionOrderId: "execution-1", openedAt
  }),
  Object.freeze({
    id: "exchange-position-1", positionId: "exchange-position-1", symbol: "ETH/USDT", instId: "ETH-USDT-SWAP",
    source: "exchange_rest", direction: "long", posSide: "long", coinSize: 2.4, mark: 3468.2,
    entry: 3420.5, liqPx: 1980, leverage: 3, pnl: 114.48, accountId: "ex-okx-main",
    exchange: "OKX", rawSyncedAt: asOf
  })
]);
const rawExecutionOrders = Object.freeze([Object.freeze({
  id: "execution-1", positionId: "position-1", symbol: "ETH/USDT", direction: "long",
  status: "protecting", filledQuantity: 2.4, stopClientOrderId: "stop-execution-1",
  exchange: "OKX", accountId: "ex-okx-main"
}), Object.freeze({
  id: "execution-2", planId: "plan-2", positionId: "position-2", symbol: "BTC/USDT", direction: "short",
  status: "closed", quantity: 0.3, filledQuantity: 0.3, entryPrice: 68600, stopLoss: 69240,
  exchange: "OKX", accountId: "ex-okx-main", createdAt: openedAt, updatedAt: asOf
})]);
const normalizedPositions = Object.freeze(normalizePositionsForUi(rawPositionMirrors, {
  executionOrders: rawExecutionOrders
}).map((position) => Object.freeze(position)));
const data = Object.freeze({
  resourceState: Object.freeze({ cockpit: "loaded", researchCenter: "loaded" }),
  source: "OKX",
  asOf,
  portfolio: Object.freeze({ totalEquityUsdt: 12000, availableMarginUsdt: 8600, marginSyncedAt: asOf }),
  tradePlans: Object.freeze([Object.freeze({
    id: "plan-2",
    status: "awaiting_approval",
    symbol: "BTC/USDT",
    direction: "short",
    strategy: "breakdown_guarded",
    agentRunId: "mission-2",
    executionOrderId: "execution-2",
    createdAt: openedAt,
    expiresAt: asOf,
    entry_range: Object.freeze([68600, 68420]),
    stopLoss: 69240,
    takeProfit: Object.freeze([67200, 66000]),
    quantity: 0.3,
    leverage: 2,
    riskPercent: 0.7,
    evidenceIds: Object.freeze(["evidence-2"]),
    lastRiskCheck: Object.freeze({ id: "risk-2", passed: true, summary: "账户保证金、最大亏损与事件窗口均已核对。", warnings: Object.freeze([]), blockers: Object.freeze([]) })
  }), Object.freeze({
    id: "plan-orphan",
    status: "awaiting_approval",
    symbol: "DOGE/USDT",
    direction: "long",
    strategy: "orphan_execution_guard",
    agentRunId: "mission-orphan",
    executionOrderId: "execution-missing",
    createdAt: openedAt,
    expiresAt: asOf,
    entry_range: Object.freeze([0.188, 0.19]),
    stopLoss: 0.181,
    takeProfit: Object.freeze([0.198, 0.206]),
    quantity: 1200,
    leverage: 2,
    riskPercent: 0.4,
    evidenceIds: Object.freeze(["evidence-orphan"]),
    lastRiskCheck: Object.freeze({ id: "risk-orphan", passed: true, summary: "计划自身有效，但关联 Execution 未在权威对象表中唯一解析。", warnings: Object.freeze([]), blockers: Object.freeze([]) })
  }), Object.freeze({
    id: "plan-3",
    status: "awaiting_approval",
    symbol: "SOL/USDT",
    direction: "long",
    strategy: "mean_reversion_guarded",
    agentRunId: "mission-3",
    createdAt: openedAt,
    expiresAt: asOf,
    entry_range: Object.freeze([188, 190]),
    stopLoss: 181,
    takeProfit: Object.freeze([198, 206]),
    quantity: 12,
    leverage: 2,
    riskPercent: 0.4,
    evidenceIds: Object.freeze(["evidence-3"]),
    lastRiskCheck: Object.freeze({ id: "risk-3", passed: true, summary: "账户权益、保证金和持仓数量均来自当前账户事实。", warnings: Object.freeze([]), blockers: Object.freeze([]) })
  })]),
  positions: normalizedPositions,
  markets: Object.freeze([Object.freeze({ symbol: "BTC/USDT", price: 68230, changePct: -0.4, high24h: 69000, low24h: 67100, updatedAt: asOf, source: "OKX" })]),
  watchlist: Object.freeze([]),
  exchangeAccounts: Object.freeze([Object.freeze({ id: "ex-okx-main", exchange: "OKX", label: "OKX 统一账户", status: "configured", updatedAt: asOf })]),
  accountSnapshots: Object.freeze([Object.freeze({
    id: "snapshot-current", accountId: "ex-okx-main", exchange: "OKX", status: "ok", createdAt: asOf,
    algoOrdersComplete: true,
    algoOrders: Object.freeze([Object.freeze({ instId: "ETH-USDT-SWAP", algoClOrdId: "stop-execution-1", slTriggerPx: "3365" })])
  })]),
  executionOrders: rawExecutionOrders,
  orders: Object.freeze([Object.freeze({
    id: "order-2",
    orderId: "okx-order-2",
    executionOrderId: "execution-2",
    planId: "plan-2",
    symbol: "BTC/USDT",
    side: "sell",
    type: "limit",
    status: "filled",
    source: "exchange_rest",
    exchange: "OKX",
    accountId: "ex-okx-main",
    quantity: 0.3,
    filledQuantity: 0.3,
    remainingQuantity: 0,
    price: 68540,
    avgFillPrice: 68535.2,
    reduceOnly: false,
    clientOrderId: "client-order-2",
    exchangeOrderId: "okx-order-2",
    createdAt: openedAt,
    updatedAt: asOf
  })]),
  fills: Object.freeze([Object.freeze({
    id: "fill-2",
    tradeId: "okx-trade-2",
    executionOrderId: "execution-2",
    orderId: "order-2",
    tradePlanId: "plan-2",
    tradeLifecycleKey: "execution-2",
    kind: "close",
    symbol: "BTC/USDT",
    direction: "short",
    quantity: 0.3,
    price: 67180,
    realizedPnl: 406.56,
    feeUsdt: 1.8,
    source: "exchange_rest",
    createdAt: asOf
  })]),
  reviews: Object.freeze([Object.freeze({
    id: "review-2",
    type: "trade",
    status: "completed",
    title: "BTC 执行复盘",
    symbol: "BTC/USDT",
    executionOrderId: "execution-2",
    tradeLifecycleKey: "execution-2",
    fillIds: Object.freeze(["fill-2"]),
    netRealizedPnl: 402.96,
    summary: "事件窗口内按保护边界退出。",
    completedAt: asOf
  })]),
  closedTradeLifecycles: Object.freeze([Object.freeze({
    id: "closed:execution-2",
    executionOrderId: "execution-2",
    tradeLifecycleKey: "execution-2",
    fillIds: Object.freeze(["fill-2"]),
    symbol: "BTC/USDT",
    direction: "short",
    quantity: 0.3,
    entryPrice: 68540,
    exitPrice: 67180,
    realizedPnl: 406.56,
    entryFeeUsdt: 1.8,
    feeUsdt: 1.8,
    fundingFeeUsdt: 0,
    netRealizedPnl: 402.96,
    closeCount: 1,
    financialBasisComplete: true,
    financialBasis: longFinancialBasis,
    createdAt: asOf
  })]),
  reconciliationReports: Object.freeze([]),
  riskIncidents: Object.freeze([])
});
const truth = Object.freeze({ mode: "full", equity: 12000, available: 8600, exposure: 0, risk: "normal" });
const state = Object.freeze({ kind: "ready", source: "OKX", lastValidAt: asOf });
const calls = { selections: [], watchlist: 0, reconcile: 0, unhandled: 0 };
window.__kordynV2AccountInteractionCalls = calls;
window.__kordynV2AccountPositionFixture = Object.freeze({
  rawCount: rawPositionMirrors.length,
  normalizedCount: normalizedPositions.length,
  rawSyncedAt: normalizedPositions[0]?.rawSyncedAt,
  accountId: normalizedPositions[0]?.accountId,
  exchange: normalizedPositions[0]?.exchange
});
window.addEventListener("unhandledrejection", (event) => { calls.unhandled += 1; event.preventDefault(); });

function ProductionHarness({ workspaceId, device = "mobile" }) {
  const [selection, setSelection] = useState(null);
  const actions = {
    addWatchlist: () => { calls.watchlist += 1; return Promise.reject(new Error("WATCHLIST_SECRET_NEVER_RENDER")); },
    removeWatchlist: () => ({ ok: true }),
    reconcile: () => { calls.reconcile += 1; throw new Error("RECONCILE_SECRET_NEVER_RENDER"); },
    exitExecutionOrder: () => ({ ok: true }),
    approvePlan: (planId) => {
      calls.approvePlan = [...(calls.approvePlan || []), planId];
      return new Promise((resolve) => window.setTimeout(() => resolve({ plan: { id: planId, status: "approved" }, approvalGranted: true, executionSubmitted: false }), 80));
    },
    rejectPlan: (planId) => {
      calls.rejectPlan = [...(calls.rejectPlan || []), planId];
      return new Promise((resolve) => window.setTimeout(() => resolve({ id: planId, status: "cancelled" }), 60));
    },
    downloadClosedTradePoster: (executionId) => { calls.poster = [...(calls.poster || []), executionId]; return Promise.resolve({ ok: true }); }
  };
  const onSelect = (candidate) => {
    const resolved = createV2Selection({ data, candidate });
    calls.selections.push(resolved ? { id: resolved.object.id, type: resolved.object.type, contextId: resolved.context.objectId, traceId: resolved.trace.objectId } : null);
    if (resolved) setSelection(resolved);
  };
  return (
    <section data-browser-account-workspace={device === "mobile" ? workspaceId : `${device}-${workspaceId}`} data-selected-id={selection?.object?.id || "none"}>
      <AccountDomain device={device} workspaceId={workspaceId} data={data} actions={actions} truth={truth} state={state} selection={selection} onSelect={onSelect} />
    </section>
  );
}

function RootHarness() {
  const api = {
    data,
    ensureSection: () => Promise.resolve(),
    action: () => Promise.resolve({ ok: true }),
    notify: () => {},
    download: (endpoint, filename) => {
      calls.rootDownloads = [...(calls.rootDownloads || []), { endpoint, filename }];
      return Promise.resolve({ ok: true });
    }
  };
  return <section data-browser-v2-root><KordynV2Root api={api} lang="zh" /></section>;
}

createRoot(document.getElementById("root")).render(<>
  <RootHarness />
  <ProductionHarness workspaceId="market" />
  <ProductionHarness workspaceId="account" />
  <ProductionHarness workspaceId="positions" />
  <ProductionHarness device="desktop" workspaceId="plans" />
  <ProductionHarness device="desktop" workspaceId="orders" />
  <ProductionHarness device="desktop" workspaceId="fills" />
  <ProductionHarness workspaceId="plans" />
  <ProductionHarness workspaceId="orders" />
  <ProductionHarness workspaceId="fills" />
</>);
window.__kordynV2AccountInteractionsReady = true;
