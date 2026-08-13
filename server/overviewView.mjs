const ACTIVE_PLAN_STATES = new Set(["armed", "awaiting_approval", "approved", "executing", "monitoring"]);
const ACTIVE_ORDER_STATES = new Set(["pending", "awaiting_approval", "executing", "submitted", "entry_pending", "entry_partial", "entry_filled", "protecting"]);

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

/**
 * The web dashboard uses the broad overview as a compatibility snapshot. The native app has
 * a smaller, known data surface and must not download years of candles, tick histories and
 * full agent evidence on every 15-second refresh.
 */
export function compactOverviewForNative(overview = {}, native = false) {
  if (!native) return overview;
  const strategyCatalog = overview.strategyCatalog || {};
  return {
    ...overview,
    overviewMode: "native_compact",
    markets: (overview.markets || []).map(compactMarket),
    activeMarket: compactMarket(overview.activeMarket),
    tradePlans: recentWithActive(overview.tradePlans, ACTIVE_PLAN_STATES, 60).map(compactPlan),
    armedSetups: recentWithActive(overview.armedSetups, ACTIVE_ORDER_STATES, 30).map(compactArmedSetup),
    orders: recentWithActive(overview.orders, ACTIVE_ORDER_STATES, 60),
    riskChecks: (overview.riskChecks || []).slice(0, 60),
    riskIncidents: recentWithActive(overview.riskIncidents, new Set(["open"]), 60),
    events: (overview.events || []).slice(0, 50),
    newsFeed: (overview.newsFeed || []).slice(0, 12),
    notifications: (overview.notifications || []).slice(0, 60),
    accountSnapshots: (overview.accountSnapshots || []).slice(0, 3),
    agentRuns: (overview.agentRuns || []).slice(0, 8).map(compactAgentRun),
    analysisBundles: [],
    evidenceBundles: [],
    memoryItems: (overview.memoryItems || []).slice(0, 20),
    strategyCatalog: { ...strategyCatalog, strategies: [] }
  };
}
