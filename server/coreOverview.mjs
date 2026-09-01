import { performanceReport } from "./accounting.mjs";
import { getAgentStatus } from "./agentOrchestrator.mjs";
import { isTerminalExecution } from "./executionStates.mjs";
import { isTerminalArmedSetup } from "./armedSetupStates.mjs";
import { normalizePositionsForUi } from "./positionView.mjs";
import { profitGoalSnapshot } from "./profitGoals.mjs";
import { realtimeStatus } from "./realtimeManager.mjs";
import { activeMandate } from "./store.mjs";
import { isTerminalTradePlan } from "./tradePlanLifecycle.mjs";
import { groupSystemClosedTradeLifecycles, systemTradeFills } from "./systemTradeProjection.mjs";
import { compactClosedTradeLifecycle } from "./overviewTradeHistory.mjs";

function timestamp(row = {}) {
  return new Date(row.updatedAt || row.lastPolledAt || row.closedAt || row.createdAt || 0).getTime() || 0;
}

function nonTerminalAndRecent(rows = [], isTerminal, recentLimit) {
  const ordered = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => timestamp(b) - timestamp(a));
  const selected = [];
  const seen = new Set();
  const add = (row) => {
    const key = row?.id || row;
    if (!row || seen.has(key)) return;
    seen.add(key);
    selected.push(row);
  };
  for (const row of ordered) if (!isTerminal(row)) add(row);
  let recentAdded = 0;
  for (const row of ordered) {
    if (!isTerminal(row)) continue;
    if (recentAdded >= recentLimit) break;
    add(row);
    recentAdded += 1;
  }
  return selected;
}

function compactMarket(row) {
  if (!row || typeof row !== "object") return row;
  const { candles: _candles, candlesByTf: _candlesByTf, opportunitySetup: _opportunitySetup, ...market } = row;
  return market;
}

function compactPlan(row) {
  if (!row || typeof row !== "object") return row;
  return {
    id: row.id,
    status: row.status,
    symbol: row.symbol,
    direction: row.direction,
    timeframe: row.timeframe,
    executionMode: row.executionMode,
    entry_range: row.entry_range,
    stopLoss: row.stopLoss,
    takeProfit: row.takeProfit,
    leverage: row.leverage,
    notionalUsdt: row.notionalUsdt,
    executionOrderId: row.executionOrderId,
    reasoningSummary: row.reasoningSummary == null ? null : String(row.reasoningSummary).slice(0, 320),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function compactExecution(row) {
  if (!row || typeof row !== "object") return row;
  return {
    id: row.id,
    planId: row.planId,
    tradePlanId: row.tradePlanId,
    status: row.status,
    exchange: row.exchange,
    accountId: row.accountId,
    symbol: row.symbol,
    direction: row.direction,
    side: row.side,
    posSide: row.posSide,
    type: row.type,
    quantity: row.quantity,
    filledQuantity: row.filledQuantity,
    notionalUsdt: row.notionalUsdt,
    entryPrice: row.entryPrice,
    price: row.price,
    filledPrice: row.filledPrice,
    stopLoss: row.stopLoss,
    takeProfits: (row.takeProfits || []).slice(0, 6),
    realizedPnl: row.realizedPnl,
    clientOrderId: row.clientOrderId,
    exchangeOrderId: row.exchangeOrderId,
    projectedMargin: row.projectedMargin ? {
      incrementalMargin: row.projectedMargin.incrementalMargin,
      projectedUtilizationPct: row.projectedMargin.projectedUtilizationPct
    } : null,
    protection: row.protection ? {
      status: row.protection.status,
      stopLoss: row.protection.stopLoss,
      takeProfits: (row.protection.takeProfits || []).slice(0, 6),
      verifiedAt: row.protection.verifiedAt
    } : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    closedAt: row.closedAt
  };
}

function compactCoreAgentStatus(status = {}) {
  const text = (value, limit = 320) => value == null ? value : String(value).slice(0, limit);
  return {
    id: status.id,
    name: status.name,
    state: status.state,
    stateLabel: status.stateLabel,
    authorized: status.authorized,
    currentGoal: text(status.currentGoal),
    currentObservation: text(status.currentObservation),
    reasonNotTrading: text(status.reasonNotTrading),
    nextActions: (status.nextActions || []).slice(0, 3).map((item) => text(item, 160)),
    riskWall: status.riskWall ? {
      mandateStatus: status.riskWall.mandateStatus,
      validUntil: status.riskWall.validUntil,
      symbols: (status.riskWall.symbols || []).slice(0, 20),
      maxLeverage: status.riskWall.maxLeverage,
      singleRiskPct: status.riskWall.singleRiskPct,
      dailyLossPct: status.riskWall.dailyLossPct,
      remainingDailyLossUsdt: status.riskWall.remainingDailyLossUsdt
    } : null,
    timeline: (status.timeline || []).slice(0, 5).map((item) => ({
      id: item.id,
      phase: text(item.phase, 60),
      title: text(item.title, 120),
      status: text(item.status, 60),
      createdAt: item.createdAt
    })),
    updatedAt: status.updatedAt
  };
}

function compactCorePortfolio(portfolio = {}) {
  if (!portfolio || typeof portfolio !== "object") return portfolio;
  const {
    // These collections are audit/reconciliation history. They can contain
    // thousands of rows in production and are not required to render account
    // truth during startup. They remain server-side; recovery and accounting
    // surfaces receive only their bounded, derived status summaries.
    systemAccountingAnchors: _systemAccountingAnchors,
    accountingHistoryBackfill: _accountingHistoryBackfill,
    ...currentPortfolio
  } = portfolio;
  return currentPortfolio;
}

export function buildCoreOverview(db, options = {}) {
  const positions = normalizePositionsForUi(db.positions || []);
  const activePlans = nonTerminalAndRecent(db.tradePlans, isTerminalTradePlan, 6).map(compactPlan);
  const executions = nonTerminalAndRecent(db.executionOrders, isTerminalExecution, 8).map(compactExecution);
  const setups = nonTerminalAndRecent(db.armedSetups, isTerminalArmedSetup, 6).map((row) => {
    const { events: _events, strategyInstance: _strategyInstance, ...setup } = row || {};
    return setup;
  });
  const relevantSymbols = new Set([
    "BTC/USDT",
    ...positions.map((row) => row.symbol),
    ...activePlans.map((row) => row.symbol)
  ].filter(Boolean));
  const markets = (db.markets || []).filter((row) => relevantSymbols.has(row.symbol)).slice(0, 12).map(compactMarket);
  const executionTimes = (db.executionOrders || []).map(timestamp).filter(Boolean).sort((a, b) => b - a);
  const systemFills = systemTradeFills(db);
  const allClosedTradeLifecycles = groupSystemClosedTradeLifecycles(db, { fills: systemFills });
  const closedTradeLifecycles = allClosedTradeLifecycles.slice(0, 20).map(compactClosedTradeLifecycle);
  return {
    overviewMode: "core_v1",
    revision: options.revision,
    generatedAt: new Date().toISOString(),
    loadedSections: [],
    user: options.user || null,
    system: profitGoalSnapshot(db.system),
    systemRelease: options.systemRelease || "dev",
    automationState: options.automationState || null,
    agentStatus: compactCoreAgentStatus(getAgentStatus(db)),
    portfolio: compactCorePortfolio(db.portfolio),
    performance: performanceReport(db),
    mandates: activeMandate(db) ? [activeMandate(db)] : [],
    positions,
    markets,
    activeMarket: markets.find((row) => row.status === "synced" || row.price) || markets[0] || null,
    marketRegime: db.marketRegime || null,
    watchlist: db.watchlist || [],
    tradePlans: activePlans,
    executionOrders: executions,
    executionOrderStatus: { total: (db.executionOrders || []).length, lastChangedAt: executionTimes[0] ? new Date(executionTimes[0]).toISOString() : null },
    armedSetups: setups,
    fills: systemFills.slice(0, 20),
    // Always server-aggregated from the complete ledger. The UI must never infer a
    // lifecycle result from the bounded fills above.
    closedTradeLifecycles,
    tradeDataStatus: {
      source: "server_complete_lifecycle_aggregation",
      fillTotal: systemFills.length,
      closedLifecycleTotal: allClosedTradeLifecycles.length,
      tradeReviewTotal: (db.reviews || []).filter((review) => review?.type === "trade").length
    },
    pendingActions: (db.pendingActions || []).filter((row) => row.status === "awaiting_confirmation").slice(0, 10),
    watchTriggers: nonTerminalAndRecent(db.watchTriggers, (row) => String(row?.status || "").toLowerCase() !== "active", 6),
    riskIncidents: nonTerminalAndRecent(db.riskIncidents, (row) => String(row?.status || "").toLowerCase() !== "open", 8),
    notifications: (options.notifications || db.notifications || []).slice(0, 20),
    realtimeConnections: db.realtimeConnections || [],
    realtimeStarted: realtimeStatus(db).started,
    exchangeAccounts: db.exchangeAccounts || [],
    subscriptions: db.subscriptions || [],
    config: options.config || {},
    // Stable placeholders are explicitly marked not loaded. They keep legacy components safe
    // without presenting an empty list as an authoritative "zero" result.
    resourceState: {
      chat: "not_loaded",
      cockpit: "not_loaded",
      researchCenter: "not_loaded",
      riskCenter: "not_loaded",
      operationsCenter: "not_loaded",
      systemSettings: "not_loaded"
    }
  };
}
