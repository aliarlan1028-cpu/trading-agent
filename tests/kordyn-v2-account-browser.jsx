import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmHost } from "../src/confirm.jsx";
import KordynV2Root from "../src/kordynV2/entry.jsx";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";
import { KORDYN_V2_PRODUCTION_FIXTURE_JSON } from "./kordyn-v2-production-fixture.js";

const query = new URLSearchParams(location.search);
const scenario = query.get("scenario") || "ready";
const approvalMode = ["success", "failure", "partial"].includes(query.get("approval")) ? query.get("approval") : "partial";
const stateKind = scenario === "ready" ? "loaded" : scenario;
const base = JSON.parse(KORDYN_V2_PRODUCTION_FIXTURE_JSON);
const asOf = "2026-08-30T00:12:00.000Z";
const openedAt = "2026-08-29T23:42:00.000Z";
const financialBasis = [
  "exchange fills reconciled",
  "entry fee separated",
  "close fee separated",
  "funding bill checked",
  "server PNG is the only output boundary"
].join(" · ");

function longText(seed, repeat = 60) {
  return Array.from({ length: repeat }, (_, index) => `${seed} #${index + 1}`).join(" · ");
}

function accountData() {
  const data = {
    ...base,
    revision: 503,
    source: "Task 5 account bounded production-shaped authority",
    asOf,
    lastValidSource: "Task 5 account bounded production-shaped authority",
    lastValidAt: asOf,
    resourceState: {
      ...base.resourceState,
      chat: "loaded",
      cockpit: stateKind
    },
    portfolio: {
      totalEquityUsdt: 28640.72,
      availableMarginUsdt: 13870.1,
      marginSyncedAt: asOf,
      source: "Task 5 account bounded production-shaped authority"
    },
    markets: [
      { id: "market-btc", symbol: "BTC/USDT", price: 68230, changePct: -0.4, high24h: 69000, low24h: 67100, updatedAt: asOf, source: "OKX" },
      { id: "market-eth", symbol: "ETH/USDT", price: 3468.2, changePct: 1.2, high24h: 3515, low24h: 3390, updatedAt: asOf, source: "OKX" },
      { id: "market-sol", symbol: "SOL/USDT", price: 186.42, changePct: 8.6, high24h: 190, low24h: 169, updatedAt: asOf, source: "OKX" }
    ],
    watchlist: ["ETH/USDT"],
    exchangeAccounts: [
      { id: "ex-okx-main", exchange: "OKX", label: "OKX Unified Account", status: "configured", updatedAt: asOf, source: "OKX" }
    ],
    accountSnapshots: [
      {
        id: "snapshot-task5-current",
        accountId: "ex-okx-main",
        exchange: "OKX",
        status: "ok",
        createdAt: asOf,
        algoOrdersComplete: true,
        algoOrders: [{ instId: "ETH-USDT-SWAP", algoClOrdId: "stop-execution-eth", slTriggerPx: "3365" }]
      }
    ],
    positions: [
      {
        id: "position-eth",
        positionId: "position-eth",
        symbol: "ETH/USDT",
        instId: "ETH-USDT-SWAP",
        direction: "long",
        source: "exchange_rest",
        quantity: 2.4,
        entryPrice: 3420.5,
        markPrice: 3468.2,
        liquidationPrice: 1980,
        unrealizedPnl: 114.48,
        notionalUsdt: 8323.68,
        margin: 2774.56,
        leverage: 3,
        liqDistancePct: 42.6,
        stopLossPrice: 3365,
        executionOrderId: "execution-eth",
        openedAt,
        rawSyncedAt: asOf,
        accountId: "ex-okx-main",
        exchange: "OKX"
      },
      {
        id: "position-btc",
        positionId: "position-btc",
        symbol: "BTC/USDT",
        instId: "BTC-USDT-SWAP",
        direction: "short",
        source: "exchange_rest",
        quantity: 0.3,
        entryPrice: 68600,
        markPrice: 67180,
        liquidationPrice: 74200,
        unrealizedPnl: 426,
        notionalUsdt: 20154,
        margin: 10077,
        leverage: 2,
        liqDistancePct: 9.3,
        executionOrderId: "execution-btc",
        openedAt,
        rawSyncedAt: asOf,
        accountId: "ex-okx-main",
        exchange: "OKX"
      }
    ],
    executionOrders: [
      {
        id: "execution-eth",
        positionId: "position-eth",
        planId: "plan-eth",
        symbol: "ETH/USDT",
        direction: "long",
        status: "protecting",
        filledQuantity: 2.4,
        stopClientOrderId: "stop-execution-eth",
        exchange: "OKX",
        accountId: "ex-okx-main",
        createdAt: openedAt,
        updatedAt: asOf
      },
      {
        id: "execution-btc",
        planId: "plan-btc-task5",
        positionId: "position-btc",
        symbol: "BTC/USDT",
        direction: "short",
        status: "closed",
        quantity: 0.3,
        filledQuantity: 0.3,
        entryPrice: 68600,
        stopLoss: 69240,
        exchange: "OKX",
        accountId: "ex-okx-main",
        createdAt: openedAt,
        updatedAt: asOf
      }
    ],
    tradePlans: [
      {
        id: "plan-btc-task5",
        title: "BTC continuation approval",
        status: "awaiting_approval",
        symbol: "BTC/USDT",
        direction: "short",
        strategy: "Breakdown guarded v2",
        agentRunId: "run-btc-task5",
        executionOrderId: "execution-btc",
        createdAt: openedAt,
        expiresAt: asOf,
        entry_range: [68600, 68420],
        stopLoss: 69240,
        takeProfit: [67200, 66000],
        quantity: 0.3,
        leverage: 2,
        riskPercent: 0.7,
        evidenceIds: ["market-btc", "snapshot-task5-current", "risk-task5"],
        lastRiskCheck: { id: "risk-task5", passed: true, summary: "账户权益、保证金、事件窗口与硬风控已核对。", warnings: [], blockers: [] },
        accountImpact: { equityUsdt: 28640.72, availableMarginUsdt: 13870.1, openPositionCount: 2, projectedOpenPositionCount: 3, estimatedMaxLossUsdt: 200.49 }
      },
      {
        id: "plan-orphan-task5",
        title: "Orphan execution guard",
        status: "awaiting_approval",
        symbol: "DOGE/USDT",
        direction: "long",
        strategy: "identity guard",
        agentRunId: "run-orphan-task5",
        executionOrderId: "execution-missing",
        createdAt: openedAt,
        expiresAt: asOf,
        entry_range: [0.188, 0.19],
        stopLoss: 0.181,
        takeProfit: [0.198, 0.206],
        quantity: 1200,
        leverage: 2,
        riskPercent: 0.4,
        evidenceIds: ["evidence-orphan"],
        lastRiskCheck: { id: "risk-orphan", passed: true, summary: "计划自身有效，但关联 Execution 未在权威对象表中唯一解析。", warnings: [], blockers: [] },
        accountImpact: { equityUsdt: 28640.72, availableMarginUsdt: 13870.1, openPositionCount: 2, projectedOpenPositionCount: 3, estimatedMaxLossUsdt: 114.56 }
      }
    ],
    orders: [
      {
        id: "order-btc-task5",
        orderId: "okx-order-btc-task5",
        executionOrderId: "execution-btc",
        planId: "plan-btc-task5",
        symbol: "BTC/USDT",
        side: "sell",
        orderType: "limit",
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
        clientOrderId: "client-order-btc-task5",
        exchangeOrderId: "okx-order-btc-task5",
        createdAt: openedAt,
        updatedAt: asOf
      }
    ],
    fills: [
      {
        id: "fill-btc-task5",
        tradeId: "okx-trade-btc-task5",
        executionOrderId: "execution-btc",
        orderId: "order-btc-task5",
        tradePlanId: "plan-btc-task5",
        tradeLifecycleKey: "execution-btc",
        kind: "close",
        symbol: "BTC/USDT",
        direction: "short",
        quantity: 0.3,
        price: 67180,
        realizedPnl: 406.56,
        feeUsdt: 1.8,
        source: "exchange_rest",
        createdAt: asOf
      }
    ],
    reviews: [
      {
        id: "review-btc-task5",
        type: "trade",
        status: "completed",
        title: "BTC execution review",
        symbol: "BTC/USDT",
        executionOrderId: "execution-btc",
        tradeLifecycleKey: "execution-btc",
        fillIds: ["fill-btc-task5"],
        netRealizedPnl: 402.96,
        summary: "事件窗口内按保护边界退出。",
        completedAt: asOf
      }
    ],
    closedTradeLifecycles: [
      {
        id: "closed:execution-btc",
        executionOrderId: "execution-btc",
        tradeLifecycleKey: "execution-btc",
        fillIds: ["fill-btc-task5"],
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
        financialBasis,
        createdAt: asOf
      }
    ],
    reconciliationReports: [
      { id: "reconcile-task5", status: "partial", severity: "warning", createdAt: asOf, differences: [{ type: "funding_fee", severity: "warning", message: "One funding bill required a retry." }] }
    ],
    riskIncidents: [
      { id: "risk-incident-task5", title: "Stop mirror stale guard", status: "resolved", positionId: "position-eth", severity: "info", createdAt: asOf }
    ],
    agentRuns: [
      ...base.agentRuns,
      { id: "run-btc-task5", goal: "BTC continuation approval", status: "awaiting_approval", tradePlanId: "plan-btc-task5", evidenceCount: 3, presentation: { nextAction: "等待一次性人工授权" }, createdAt: openedAt, updatedAt: asOf }
    ],
    traces: [
      ...(base.traces || []),
      { id: "trace-market-btc", workspaceId: "live", objectType: "Market", objectId: "BTC/USDT", stage: "Sense", status: "complete", detail: "OKX market fact loaded", evidenceId: "market-btc" },
      { id: "trace-account-main", workspaceId: "live", objectType: "Account", objectId: "ex-okx-main", stage: "Recall", status: "complete", detail: "Account snapshot loaded", evidenceId: "snapshot-task5-current" },
      { id: "trace-position-eth", workspaceId: "live", objectType: "Position", objectId: "position-eth", stage: "Monitor", status: "complete", detail: "Protection mirror verified", evidenceId: "stop-execution-eth" },
      { id: "trace-plan-btc", workspaceId: "live", objectType: "Trade plan", objectId: "plan-btc-task5", stage: "Guard", status: "waiting", detail: "Waiting for owner approval", evidenceId: "risk-task5" },
      { id: "trace-execution-btc", workspaceId: "live", objectType: "Execution", objectId: "execution-btc", stage: "Execute", status: "complete", detail: "Execution closed", evidenceId: "execution-btc" },
      { id: "trace-order-btc", workspaceId: "live", objectType: "Order", objectId: "order-btc-task5", stage: "Execute", status: "complete", detail: "Exchange order filled", evidenceId: "okx-order-btc-task5" },
      { id: "trace-fill-btc", workspaceId: "live", objectType: "Fill", objectId: "fill-btc-task5", stage: "Review", status: "complete", detail: "Fill linked to review", evidenceId: "review-btc-task5" },
      { id: "trace-closed-btc", workspaceId: "live", objectType: "Closed trade", objectId: "closed:execution-btc", stage: "Review", status: "complete", detail: "Closed lifecycle reconciled", evidenceId: "closed:execution-btc" },
      { id: "trace-review-btc", workspaceId: "live", objectType: "Review", objectId: "review-btc-task5", stage: "Review", status: "complete", detail: "Trade review exists", evidenceId: "review-btc-task5" }
    ]
  };
  if (scenario === "empty") {
    data.markets = [];
    data.watchlist = [];
    data.exchangeAccounts = [];
    data.accountSnapshots = [];
    data.positions = [];
    data.executionOrders = [];
    data.tradePlans = [];
    data.orders = [];
    data.fills = [];
    data.reviews = [];
    data.closedTradeLifecycles = [];
    data.reconciliationReports = [];
  }
  if (scenario === "long-content") {
    data.closedTradeLifecycles = data.closedTradeLifecycles.map((row) => ({ ...row, financialBasis: longText("完整财务证据链", 72) }));
  }
  if (scenario === "large-list") {
    data.markets = Array.from({ length: 64 }, (_, index) => ({
      id: `market-large-${index + 1}`,
      symbol: `ASSET${index + 1}/USDT`,
      price: 100 + index,
      changePct: (index % 7) - 3,
      high24h: 110 + index,
      low24h: 90 + index,
      updatedAt: asOf,
      source: "OKX"
    }));
  }
  return parseJsonResponseText(JSON.stringify(data));
}

const data = accountData();
const calls = {
  actionRequests: [],
  actionResults: [],
  authorityWrites: 0,
  downloads: []
};

window.__task5AccountCalls = calls;
window.__task5AccountScenario = scenario;
window.__task5AccountApprovalMode = approvalMode;

function BrowserHarness() {
  const api = useMemo(() => ({
    data,
    action: async (endpoint, payload = {}, method = "POST") => {
      calls.actionRequests.push({ endpoint, payload, method });
      if (method !== "GET") calls.authorityWrites += 1;
      await new Promise((resolve) => setTimeout(resolve, endpoint.includes("approve") ? 220 : 80));
      if (endpoint === "/api/reconciler/run") {
        const result = { ok: false, status: "partial", completed: ["orders"], failed: ["funding"], message: "partial reconciliation" };
        calls.actionResults.push({ endpoint, result });
        return result;
      }
      if (endpoint === "/api/watchlist") {
        const result = { ok: true, symbol: payload.symbol };
        calls.actionResults.push({ endpoint, result });
        return result;
      }
      if (endpoint === "/api/trade-plans/plan-btc-task5/approve") {
        const result = approvalMode === "failure"
          ? { ok: false, error: "risk_blocked" }
          : approvalMode === "success"
            ? { plan: { id: "plan-btc-task5", status: "approved" }, approvalGranted: true, executionSubmitted: true, execution: { status: "entry_pending" }, message: "entry submitted" }
            : { ok: false, error: "execution_not_submitted", plan: { id: "plan-btc-task5", status: "approved" }, approvalGranted: true, executionSubmitted: false, execution: { status: "risk_recheck_failed", reason: "capacity_changed" }, message: "approval consumed, order not submitted" };
        calls.actionResults.push({ endpoint, result });
        return result;
      }
      if (endpoint === "/api/trade-plans/plan-btc-task5/cancel") {
        const result = { id: "plan-btc-task5", status: "cancelled" };
        calls.actionResults.push({ endpoint, result });
        return result;
      }
      if (endpoint === "/api/execution-orders/execution-eth/close") {
        const result = { ok: false, error: "position_refresh_required", httpStatus: 409 };
        calls.actionResults.push({ endpoint, result });
        return result;
      }
      if (endpoint === "/api/execution-orders/poll") {
        const result = { ok: false, polled: true };
        calls.actionResults.push({ endpoint, result });
        return result;
      }
      const result = { ok: false, error: "unsupported_task5_fixture_action" };
      calls.actionResults.push({ endpoint, result });
      return result;
    },
    ensureSection: async () => data,
    notify: () => {},
    download: async (endpoint, filename) => {
      calls.downloads.push({ endpoint, filename });
      return { ok: true };
    },
    connectionError: scenario === "failed" ? "Task 5 account source failed" : ""
  }), []);
  return <><KordynV2Root api={api} lang="zh" /><ConfirmHost /></>;
}

createRoot(document.getElementById("root")).render(<BrowserHarness />);
window.__task5AccountReady = true;
