const ACTIVE_PLAN_STATES = new Set(["armed", "awaiting_approval", "approved", "executing", "monitoring"]);
const ACTIVE_ORDER_STATES = new Set(["pending", "awaiting_approval", "executing", "submitted", "entry_pending", "entry_partial", "entry_filled", "protecting"]);
const ACTIVE_SETUP_STATES = new Set(["armed", "triggered", "fast_validating", "executing", "recovery_pending_reconciliation"]);

function recentWithActive(rows = [], activeStates, limit) {
  const list = Array.isArray(rows) ? rows : [];
  const selected = [];
  const seen = new Set();
  const add = (row) => {
    if (!row || seen.has(row.id || row)) return;
    seen.add(row.id || row);
    selected.push(row);
  };
  for (const row of list) if (activeStates.has(String(row?.status || "").toLowerCase())) add(row);
  for (const row of list) {
    if (selected.length >= limit) break;
    add(row);
  }
  return selected.slice(0, limit);
}

function compactMarket(row) {
  if (!row || typeof row !== "object") return row;
  // 手机行情图直接从 TradingView/实时价格流取数据，overview 不需要重复携带
  // 65 个币对 × 多周期 K 线。生产上这部分单独就接近 3 MB。
  const { candles: _candles, candlesByTf: _candlesByTf, opportunitySetup: _opportunitySetup, ...market } = row;
  return market;
}

function compactArmedSetup(row) {
  if (!row || typeof row !== "object") return row;
  // events 是观察过程的逐 tick 历史，strategyInstance 是可重新构建的完整策略快照；
  // 手机只需当前阶段、触发条件与状态。详细审计仍由独立 API/桌面端提供。
  const { events: _events, strategyInstance: _strategyInstance, ...setup } = row;
  return setup;
}

function compactAgentRun(row) {
  if (!row || typeof row !== "object") return row;
  return {
    id: row.id,
    traceId: row.traceId,
    sessionId: row.sessionId,
    source: row.source,
    role: row.role,
    status: row.status,
    model: row.model,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    steps: (row.steps || []).slice(0, 8).map((step) => ({
      id: step.id,
      phase: step.phase,
      title: step.title,
      status: step.status,
      createdAt: step.createdAt,
      completedAt: step.completedAt
    }))
  };
}

function compactPlan(row) {
  if (!row || typeof row !== "object") return row;
  const active = ACTIVE_PLAN_STATES.has(String(row.status || "").toLowerCase());
  // 历史计划的完整风控检查会重复保存大量事实；只有活跃/待批准计划的卡片需要展开它。
  return active ? row : { ...row, lastRiskCheck: undefined };
}

function compactRiskCheck(row) {
  if (!row || typeof row !== "object") return row;
  return {
    id: row.id,
    tradePlanId: row.tradePlanId,
    agentRunId: row.agentRunId,
    symbol: row.symbol,
    decision: row.decision,
    passed: row.passed,
    summary: row.summary,
    blockers: (row.blockers || []).slice(0, 4),
    warnings: (row.warnings || []).slice(0, 4),
    createdAt: row.createdAt
  };
}

function compactKnowledge(knowledge = {}) {
  return {
    ...knowledge,
    // lifecycle is an append-only transition history. One production skill had thousands of
    // repeated validation transitions (~93 KB); the mobile UI renders the current status only.
    tradingSkills: (knowledge.tradingSkills || []).map(({ lifecycle: _lifecycle, validation: _validation, ...skill }) => skill)
  };
}

function compactEvent(row) {
  if (!row || typeof row !== "object") return row;
  const { timeline: _timeline, intel: _intel, ...event } = row;
  return event;
}

function compactReview(row) {
  if (!row || typeof row !== "object") return row;
  const { analyticsSnapshot: _analyticsSnapshot, ...review } = row;
  return review;
}

function compactExecutionOrder(row) {
  if (!row || typeof row !== "object") return row;
  const { strategyInstance: _strategyInstance, reviewLearning: _reviewLearning, events: _events, ...order } = row;
  return order;
}

function compactAccountSnapshot(row) {
  if (!row || typeof row !== "object") return row;
  const { balances: _balances, ...snapshot } = row;
  return snapshot;
}

function compactAgentStatus(status = {}) {
  return {
    id: status.id,
    name: status.name,
    state: status.state,
    stateLabel: status.stateLabel,
    authorized: status.authorized,
    riskWall: status.riskWall,
    activeMandate: status.activeMandate,
    nextActions: (status.nextActions || []).slice(0, 3),
    reasonNotTrading: status.reasonNotTrading,
    updatedAt: status.updatedAt
  };
}

function startupOverview(overview) {
  const relevantSymbols = new Set([
    "BTC/USDT",
    ...(overview.positions || []).map((row) => row.symbol),
    ...(overview.tradePlans || []).filter((row) => ACTIVE_PLAN_STATES.has(String(row?.status || "").toLowerCase())).map((row) => row.symbol)
  ].filter(Boolean));
  const startupPlans = recentWithActive(overview.tradePlans, ACTIVE_PLAN_STATES, 12).map(compactPlan);
  const startupOrders = recentWithActive(overview.executionOrders, ACTIVE_ORDER_STATES, 12).map(compactExecutionOrder);
  const startupSetups = recentWithActive(overview.armedSetups, ACTIVE_SETUP_STATES, 12).map(compactArmedSetup);
  const startupWatches = recentWithActive(overview.watchTriggers, new Set(["active"]), 12);
  return {
    overviewMode: "native_startup",
    user: overview.user,
    system: overview.system,
    systemRelease: overview.systemRelease,
    automationState: overview.automationState,
    agentStatus: compactAgentStatus(overview.agentStatus),
    portfolio: overview.portfolio,
    performance: overview.performance,
    mandates: overview.mandates || [],
    positions: overview.positions || [],
    markets: (overview.markets || []).filter((row) => relevantSymbols.has(row.symbol)).slice(0, 8),
    activeMarket: overview.activeMarket,
    watchlist: overview.watchlist || [],
    tradePlans: startupPlans,
    armedSetups: startupSetups,
    executionOrders: startupOrders,
    fills: (overview.fills || []).slice(0, 20),
    pendingActions: overview.pendingActions || [],
    watchTriggers: startupWatches,
    watchBoard: overview.watchBoard || [],
    agentRuns: (overview.agentRuns || []).slice(0, 2),
    notifications: (overview.notifications || []).slice(0, 20),
    realtimeConnections: overview.realtimeConnections || [],
    realtimeStarted: overview.realtimeStarted,
    exchangeAccounts: overview.exchangeAccounts || [],
    config: overview.config || {},
    subscriptions: overview.subscriptions || [],
    // Keep stable empty shapes so tapping a drawer item during the background refresh never
    // crashes. The explicit full request replaces this snapshot shortly afterwards.
    orders: [], reviews: [], riskChecks: [], riskIncidents: [], riskRules: [], events: [], tasks: [],
    knowledge: {}, skills: [], strategyCatalog: {}, strategyStudio: {}, newsFeed: [],
    abnormalVolatility: [], opportunityCandidates: [], reconciliationReports: [], accountSnapshots: [],
    traces: [], auditLogs: [], mediumTermAnalytics: {}
  };
}

/**
 * The web dashboard uses the broad overview as a compatibility snapshot. The native app has
 * a smaller, known data surface and must not download years of candles, tick histories and
 * full agent evidence on every 15-second refresh.
 */
export function compactOverviewForNative(overview = {}, native = false) {
  if (!native) return overview;
  const strategyCatalog = overview.strategyCatalog || {};
  const compact = {
    ...overview,
    overviewMode: "native_compact",
    markets: (overview.markets || []).map(compactMarket),
    activeMarket: compactMarket(overview.activeMarket),
    tradePlans: recentWithActive(overview.tradePlans, ACTIVE_PLAN_STATES, 30).map(compactPlan),
    armedSetups: recentWithActive(overview.armedSetups, ACTIVE_SETUP_STATES, 20).map(compactArmedSetup),
    orders: recentWithActive(overview.orders, ACTIVE_ORDER_STATES, 40),
    fills: (overview.fills || []).slice(0, 50),
    riskChecks: (overview.riskChecks || []).slice(0, 40).map(compactRiskCheck),
    riskIncidents: recentWithActive(overview.riskIncidents, new Set(["open"]), 30),
    events: (overview.events || []).slice(0, 30).map(compactEvent),
    newsFeed: (overview.newsFeed || []).slice(0, 12),
    notifications: (overview.notifications || []).slice(0, 30),
    accountSnapshots: (overview.accountSnapshots || []).slice(0, 3).map(compactAccountSnapshot),
    agentRuns: (overview.agentRuns || []).slice(0, 8).map(compactAgentRun),
    knowledge: compactKnowledge(overview.knowledge),
    reviews: (overview.reviews || []).map(compactReview),
    executionOrders: (overview.executionOrders || []).map(compactExecutionOrder),
    analysisBundles: [],
    evidenceBundles: [],
    memoryItems: (overview.memoryItems || []).slice(0, 10),
    strategyCatalog: { ...strategyCatalog, strategies: [] },
    // Desktop research/diagnostic workbenches are not part of the native IA. Keep their
    // dedicated APIs authoritative and do not make every mobile refresh carry the snapshots.
    reviewAnalytics: {},
    professional: {},
    backtestResearch: {},
    strategyProfiles: [],
    decisionCalibration: {},
    agentStateFiles: {},
    marketCalendarEvents: [],
    dailyMarketBrief: null,
    toolExecutions: [],
    analysisEngine: {},
    paperReport: {},
    opportunityCandidates: (overview.opportunityCandidates || []).slice(0, 10),
    agentStatus: compactAgentStatus(overview.agentStatus)
  };
  return native === "startup" ? startupOverview(compact) : compact;
}
