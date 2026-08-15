import { performanceReport } from "./accounting.mjs";
import { getAgentStatus } from "./agentOrchestrator.mjs";
import { OPEN_EXECUTION_STATES } from "./executionStates.mjs";
import { normalizePositionsForUi } from "./positionView.mjs";
import { profitGoalSnapshot } from "./profitGoals.mjs";
import { realtimeStatus } from "./realtimeManager.mjs";
import { activeMandate } from "./store.mjs";

const ACTIVE_PLAN_STATES = new Set(["armed", "awaiting_approval", "approved", "executing", "monitoring", "recovery_pending_reconciliation"]);
const ACTIVE_SETUP_STATES = new Set(["armed", "triggered", "fast_validating", "executing", "recovery_pending_reconciliation"]);

function timestamp(row = {}) {
  return new Date(row.updatedAt || row.lastPolledAt || row.closedAt || row.createdAt || 0).getTime() || 0;
}

function activeAndRecent(rows = [], activeStates, recentLimit) {
  const ordered = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => timestamp(b) - timestamp(a));
  const selected = [];
  const seen = new Set();
  const add = (row) => {
    const key = row?.id || row;
    if (!row || seen.has(key)) return;
    seen.add(key);
    selected.push(row);
  };
  for (const row of ordered) if (activeStates.has(String(row?.status || "").toLowerCase())) add(row);
  let recentAdded = 0;
  for (const row of ordered) {
    if (activeStates.has(String(row?.status || "").toLowerCase())) continue;
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
  const { lastRiskCheck: _lastRiskCheck, evidenceBundle: _evidenceBundle, analysisBundle: _analysisBundle, strategyInstance: _strategyInstance, events: _events, ...plan } = row;
  return plan;
}

function compactExecution(row) {
  if (!row || typeof row !== "object") return row;
  const { strategyInstance: _strategyInstance, reviewLearning: _reviewLearning, events: _events, ...execution } = row;
  return execution;
}

export function buildCoreOverview(db, options = {}) {
  const positions = normalizePositionsForUi(db.positions || []);
  const activePlans = activeAndRecent(db.tradePlans, ACTIVE_PLAN_STATES, 6).map(compactPlan);
  const executions = activeAndRecent(db.executionOrders, OPEN_EXECUTION_STATES, 8).map(compactExecution);
  const setups = activeAndRecent(db.armedSetups, ACTIVE_SETUP_STATES, 6).map((row) => {
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
  return {
    overviewMode: "core_v1",
    revision: options.revision,
    generatedAt: new Date().toISOString(),
    loadedSections: [],
    user: options.user || null,
    system: profitGoalSnapshot(db.system),
    systemRelease: options.systemRelease || "dev",
    automationState: options.automationState || null,
    agentStatus: getAgentStatus(db),
    portfolio: db.portfolio,
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
    fills: (db.fills || []).slice(0, 20),
    pendingActions: (db.pendingActions || []).filter((row) => row.status === "awaiting_confirmation").slice(0, 10),
    watchTriggers: activeAndRecent(db.watchTriggers, new Set(["active"]), 6),
    riskIncidents: activeAndRecent(db.riskIncidents, new Set(["open"]), 8),
    notifications: (db.notifications || []).slice(0, 20),
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
