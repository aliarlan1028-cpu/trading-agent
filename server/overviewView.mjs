import { groupClosedTradeLifecycles } from "./tradeReviewQueue.mjs";
import { OPEN_EXECUTION_STATUS_LIST } from "./executionStates.mjs";

const ACTIVE_PLAN_STATES = new Set(["armed", "awaiting_approval", "approved", "executing", "monitoring"]);
const ACTIVE_ORDER_STATES = new Set(["pending", "awaiting_approval", "executing", ...OPEN_EXECUTION_STATUS_LIST]);
const ACTIVE_SETUP_STATES = new Set(["armed", "triggered", "fast_validating", "executing", "recovery_pending_reconciliation"]);
const REVIEW_ATTENTION_STATES = new Set(["pending", "processing", "failed", "error", "retry", "awaiting_approval"]);
const NATIVE_ATTENTION_REVIEW_LIMIT = 60;
const NATIVE_RECENT_REVIEW_LIMIT = 40;

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

function activePlusRecent(rows = [], activeStates, recentLimit) {
  const list = Array.isArray(rows) ? rows : [];
  const active = list.filter((row) => activeStates.has(String(row?.status || "").toLowerCase()));
  const activeKeys = new Set(active.map((row) => row?.id || row));
  const recent = list.filter((row) => !activeKeys.has(row?.id || row)).slice(0, recentLimit);
  return [...active, ...recent];
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
  const text = (value, limit = 240) => value == null ? value : String(value).slice(0, limit);
  return {
    id: row.id,
    traceId: row.traceId,
    sessionId: row.sessionId,
    source: text(row.source, 80),
    role: text(row.role, 80),
    status: text(row.status, 80),
    model: text(row.model, 120),
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    steps: (row.steps || []).slice(0, 8).map((step) => ({
      id: step.id,
      phase: text(step.phase, 80),
      title: text(step.title),
      status: text(step.status, 80),
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

function compactDailyBrief(brief) {
  if (!brief || typeof brief !== "object") return null;
  const macro = brief.macroContext || {};
  return {
    id: brief.id,
    date: brief.date,
    timeZone: brief.timeZone,
    asOf: brief.asOf,
    dataCutoff: brief.dataCutoff,
    version: brief.version,
    role: brief.role,
    mayTriggerTradeDirectly: brief.mayTriggerTradeDirectly === true,
    topNews: (brief.topNews || []).slice(0, 6).map((item) => ({
      factId: item.factId,
      title: item.title,
      summary: item.summary,
      symbols: (item.symbols || []).slice(0, 8),
      publishedAt: item.publishedAt,
      confidence: item.confidence,
      values: item.values ? { impact: item.values.impact, important: item.values.important } : undefined
    })),
    upcomingEvents: (brief.upcomingEvents || []).slice(0, 8).map(compactEvent),
    macroContext: {
      asOf: macro.asOf,
      economicCyclePhase: macro.economicCyclePhase,
      cryptoRiskAppetite: macro.cryptoRiskAppetite,
      confidence: macro.confidence,
      unknowns: (macro.unknowns || []).slice(0, 4),
      scenarios: (macro.scenarios || []).slice(0, 4)
    },
    constraints: (brief.constraints || []).slice(0, 6),
    dataQuality: brief.dataQuality || {},
    evidenceFactIds: (brief.evidenceFactIds || []).slice(0, 24),
    updatedAt: brief.updatedAt,
    createdAt: brief.createdAt
  };
}

function compactReview(row) {
  if (!row || typeof row !== "object") return row;
  const { analyticsSnapshot: _analyticsSnapshot, ...review } = row;
  return review;
}

function compactNativeReviews(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const attention = list.filter((row) => REVIEW_ATTENTION_STATES.has(String(row?.status || "").toLowerCase())).slice(0, NATIVE_ATTENTION_REVIEW_LIMIT);
  const attentionKeys = new Set(attention.map((row) => row?.id || row));
  const recentCompleted = list.filter((row) => !attentionKeys.has(row?.id || row)).slice(0, NATIVE_RECENT_REVIEW_LIMIT);
  // 轮询快照有总硬上限；完整异常/历史通过分页 API 获取，总量与分状态计数由 tradeDataStatus 提供。
  return [...attention, ...recentCompleted].map(compactReview);
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

function sampleSeries(values = [], limit = 48) {
  const list = Array.isArray(values) ? values : [];
  if (list.length <= limit) return list;
  return Array.from({ length: limit }, (_, index) => list[Math.round((index / (limit - 1)) * (list.length - 1))]);
}

function compactBacktestResearch(research = {}) {
  return {
    summary: research.summary || {},
    historical: (research.historical || []).slice(0, 24).map((row, index) => {
      const { diagnostics: _diagnostics, ...record } = row || {};
      return {
        ...record,
        id: record.id || `research-${index}`,
        equityCurve: sampleSeries(record.equityCurve),
        drawdownCurve: sampleSeries(record.drawdownCurve),
        folds: (record.folds || []).slice(0, 6),
        parameters: Object.fromEntries(Object.entries(record.parameters || {}).slice(0, 12))
      };
    }),
    forward: (research.forward || []).slice(0, 20)
  };
}

function compactStrategyCatalog(catalog = {}) {
  return {
    ...catalog,
    // Research contracts are small and are part of the strategy catalog's
    // factual identity. The old native payload replaced them with [], causing
    // App/Web counts and rows to diverge. Keep the contract/lifecycle facts,
    // while removing any accidentally attached long histories or curves.
    strategies: (catalog.strategies || []).map((row) => {
      const contract = row?.contract || {};
      const lifecycle = row?.lifecycle || {};
      const hasProfile = lifecycle.profile != null;
      const profile = lifecycle.profile || {};
      const oos = profile.oos || {};
      const { equityCurve: _equityCurve, drawdownCurve: _drawdownCurve, folds: _folds, ...oosMetrics } = oos;
      return {
        id: row?.id,
        name: row?.name,
        contractValid: row?.contractValid,
        contractErrors: row?.contractErrors || [],
        contract: {
          direction: contract.direction,
          timeframes: contract.timeframes || [],
          entryModel: contract.entryModel,
          family: contract.family,
          dataRequirements: contract.dataRequirements || []
        },
        lifecycle: {
          stage: lifecycle.stage,
          reason: lifecycle.reason,
          executionEligibility: lifecycle.executionEligibility,
          live: lifecycle.live || null,
          profile: hasProfile ? { chosenAt: profile.chosenAt, oos: oosMetrics } : null
        }
      };
    })
  };
}

function compactPaperReport(report = {}) {
  return {
    minForwardTrades: report.minForwardTrades,
    sessions: (report.sessions || []).map(({ trades: _trades, equityCurve: _equityCurve, ...session }) => session)
  };
}

const OVERVIEW_SECTIONS = new Set(["chat", "cockpit", "researchCenter", "riskCenter", "operationsCenter", "systemSettings"]);

function sharedSectionFields(overview) {
  return {
    user: overview.user,
    system: overview.system,
    systemRelease: overview.systemRelease,
    automationState: overview.automationState,
    agentStatus: compactAgentStatus(overview.agentStatus),
    portfolio: overview.portfolio,
    performance: overview.performance,
    positions: overview.positions || [],
    markets: (overview.markets || []).map(compactMarket),
    activeMarket: compactMarket(overview.activeMarket),
    marketRegime: overview.marketRegime || null,
    watchlist: overview.watchlist || [],
    mandates: overview.mandates || [],
    notifications: (overview.notifications || []).slice(0, 30),
    realtimeConnections: overview.realtimeConnections || [],
    realtimeStarted: overview.realtimeStarted,
    exchangeAccounts: overview.exchangeAccounts || [],
    subscriptions: overview.subscriptions || [],
    config: overview.config || {},
    readiness: overview.readiness || null
  };
}

/**
 * Returns one bounded desktop/mobile workspace payload. Non-terminal rows are never discarded:
 * limits apply only to historical rows, while the lightweight core remains the source of truth
 * during navigation and reconnects.
 */
export function projectOverviewSection(overview = {}, section = "chat") {
  const selectedSection = OVERVIEW_SECTIONS.has(section) ? section : "chat";
  const base = {
    overviewMode: "section_v1",
    section: selectedSection,
    loadedSections: [selectedSection],
    resourceState: { [selectedSection]: "loaded" },
    ...sharedSectionFields(overview)
  };
  const tradePlans = activePlusRecent(overview.tradePlans, ACTIVE_PLAN_STATES, 30).map(compactPlan);
  const executionOrders = activePlusRecent(overview.executionOrders, ACTIVE_ORDER_STATES, 50).map(compactExecutionOrder);
  const armedSetups = activePlusRecent(overview.armedSetups, ACTIVE_SETUP_STATES, 30).map(compactArmedSetup);

  if (selectedSection === "chat") return {
    ...base,
    tradePlans,
    executionOrders,
    armedSetups,
    fills: (overview.fills || []).slice(0, 60),
    pendingActions: (overview.pendingActions || []).slice(0, 20),
    watchTriggers: activePlusRecent(overview.watchTriggers, new Set(["active"]), 20),
    watchBoard: overview.watchBoard || [],
    agentRuns: (overview.agentRuns || []).slice(0, 10).map(compactAgentRun),
    tasks: (overview.tasks || []).slice(0, 40),
    events: (overview.events || []).slice(0, 30).map(compactEvent),
    newsFeed: (overview.newsFeed || []).slice(0, 30),
    missedOpportunities: (overview.missedOpportunities || []).slice(0, 20),
    opportunityCandidates: (overview.opportunityCandidates || []).slice(0, 20),
    strategyStudio: overview.strategyStudio || {}
  };

  if (selectedSection === "cockpit") return {
    ...base,
    tradePlans,
    executionOrders,
    armedSetups,
    orders: activePlusRecent(overview.orders, ACTIVE_ORDER_STATES, 100),
    fills: (overview.fills || []).slice(0, 150),
    closedTradeLifecycles: groupClosedTradeLifecycles(overview.fills || []).slice(0, 100).map(compactClosedTradeLifecycle),
    riskChecks: (overview.riskChecks || []).slice(0, 60).map(compactRiskCheck),
    reviews: compactNativeReviews(overview.reviews),
    accountSnapshots: (overview.accountSnapshots || []).slice(0, 12).map(compactAccountSnapshot),
    mediumTermAnalytics: overview.mediumTermAnalytics || {},
    marketMovers: overview.marketMovers || null,
    abnormalVolatility: (overview.abnormalVolatility || []).slice(0, 30),
    portfolioRisk: overview.portfolioRisk || null,
    professional: overview.professional || null,
    paperReport: compactPaperReport(overview.paperReport)
  };

  if (selectedSection === "researchCenter") return {
    ...base,
    knowledge: compactKnowledge(overview.knowledge),
    skills: overview.skills || [],
    tools: overview.tools || [],
    mcpServers: overview.mcpServers || [],
    strategyBoard: overview.strategyBoard || null,
    strategyCatalog: compactStrategyCatalog(overview.strategyCatalog),
    strategyStudio: overview.strategyStudio || {},
    backtestResearch: compactBacktestResearch(overview.backtestResearch),
    backtests: (overview.backtests || []).slice(0, 20),
    strategyProfiles: (overview.strategyProfiles || []).slice(0, 40),
    memoryItems: (overview.memoryItems || []).slice(0, 30),
    agentProfiles: overview.agentProfiles || [],
    analysisEngine: overview.analysisEngine || {},
    reviewAnalytics: overview.reviewAnalytics || {},
    reviewLearningAnalytics: overview.reviewLearningAnalytics || {},
    decisionCalibration: overview.decisionCalibration || {},
    embeddingStatus: overview.embeddingStatus || null
  };

  if (selectedSection === "riskCenter") return {
    ...base,
    tradePlans,
    executionOrders,
    riskThresholds: overview.riskThresholds || {},
    riskRules: overview.riskRules || [],
    riskChecks: (overview.riskChecks || []).slice(0, 100).map(compactRiskCheck),
    riskIncidents: activePlusRecent(overview.riskIncidents, new Set(["open"]), 60),
    currentRiskSnapshot: overview.currentRiskSnapshot || null,
    grayReleasePolicies: overview.grayReleasePolicies || [],
    notionalLimits: overview.notionalLimits || null,
    tradingCapacity: overview.tradingCapacity || null,
    portfolioRisk: overview.portfolioRisk || null,
    professional: overview.professional || null,
    apiKeyMetadata: overview.apiKeyMetadata || [],
    accountSnapshots: (overview.accountSnapshots || []).slice(0, 6).map(compactAccountSnapshot)
  };

  if (selectedSection === "operationsCenter") return {
    ...base,
    executionOrders,
    events: (overview.events || []).slice(0, 100).map(compactEvent),
    tasks: overview.tasks || [],
    jobRuns: (overview.jobRuns || []).slice(0, 50),
    riskIncidents: activePlusRecent(overview.riskIncidents, new Set(["open"]), 60),
    reconciliationReports: (overview.reconciliationReports || []).slice(0, 30),
    auditLogs: (overview.auditLogs || []).slice(0, 80),
    traces: (overview.traces || []).slice(0, 40),
    alerts: (overview.alerts || []).slice(0, 40),
    drillRuns: (overview.drillRuns || []).slice(0, 20),
    eventSources: overview.eventSources || [],
    marketCalendarEvents: (overview.marketCalendarEvents || []).slice(0, 120).map(compactEvent),
    dailyMarketBrief: compactDailyBrief(overview.dailyMarketBrief),
    marketIntelligenceSourceHealth: overview.marketIntelligenceSourceHealth || [],
    newsFeed: (overview.newsFeed || []).slice(0, 60),
    accountSnapshots: (overview.accountSnapshots || []).slice(0, 6).map(compactAccountSnapshot),
    marketStream: overview.marketStream || null,
    opportunityEngine: overview.opportunityEngine || null
  };

  return {
    ...base,
    users: overview.users || [],
    tenants: overview.tenants || [],
    subscriptionPlans: overview.subscriptionPlans || [],
    paymentRequests: (overview.paymentRequests || []).slice(0, 20),
    publicRegistrationEnabled: overview.publicRegistrationEnabled,
    registrationMode: overview.registrationMode,
    registrationCapacity: overview.registrationCapacity,
    registrationApplications: overview.registrationApplications || [],
    runtimeConfig: overview.runtimeConfig || {},
    apiKeyMetadata: overview.apiKeyMetadata || [],
    accountSnapshots: (overview.accountSnapshots || []).slice(0, 6).map(compactAccountSnapshot),
    tools: overview.tools || [],
    mcpServers: overview.mcpServers || [],
    eventSources: overview.eventSources || [],
    larkConfigured: overview.larkConfigured,
    telegramConfigured: overview.telegramConfigured,
    mcpStatus: overview.mcpStatus || null
  };
}

function compactClosedTradeLifecycle(lifecycle = {}) {
  const row = lifecycle.representative || {};
  return {
    ...row,
    id: `closed:${lifecycle.key}`,
    tradeLifecycleKey: lifecycle.key,
    fillIds: (lifecycle.fills || []).map((fill) => fill.id).filter(Boolean),
    closeCount: (lifecycle.fills || []).length,
    quantity: Number(lifecycle.quantity || row.quantity || 0),
    notionalUsdt: Number(lifecycle.notionalUsdt || row.notionalUsdt || 0),
    realizedPnl: Number(lifecycle.realizedPnl || 0),
    feeUsdt: Number(lifecycle.feeUsdt || 0),
    entryFeeUsdt: Number(lifecycle.entryFeeUsdt || 0),
    fundingFeeUsdt: Number(lifecycle.fundingFeeUsdt || 0),
    netRealizedPnl: lifecycle.netRealizedPnl === null || lifecycle.netRealizedPnl === undefined || lifecycle.netRealizedPnl === "" ? null : Number(lifecycle.netRealizedPnl),
    financialBasis: lifecycle.financialBasis || null,
    createdAt: lifecycle.lastClosedAt || row.createdAt
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
    closedTradeLifecycles: [],
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
    knowledge: {}, skills: [], tools: [], mcpServers: [], analysisEngine: {}, strategyCatalog: {}, strategyStudio: {}, backtestResearch: {}, newsFeed: [], dailyMarketBrief: null, marketIntelligenceSourceHealth: [], marketCalendarEvents: [],
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
    // The ledger may be bounded, but lifecycle accounting may never be. Aggregate
    // from the complete server-side fill set before slicing the recent lifecycle rows.
    closedTradeLifecycles: groupClosedTradeLifecycles(overview.fills || []).slice(0, 50).map(compactClosedTradeLifecycle),
    riskChecks: (overview.riskChecks || []).slice(0, 40).map(compactRiskCheck),
    riskIncidents: recentWithActive(overview.riskIncidents, new Set(["open"]), 30),
    events: (overview.events || []).slice(0, 30).map(compactEvent),
    newsFeed: (overview.newsFeed || []).slice(0, 24),
    notifications: (overview.notifications || []).slice(0, 30),
    accountSnapshots: (overview.accountSnapshots || []).slice(0, 3).map(compactAccountSnapshot),
    agentRuns: (overview.agentRuns || []).slice(0, 8).map(compactAgentRun),
    knowledge: compactKnowledge(overview.knowledge),
    reviews: compactNativeReviews(overview.reviews),
    executionOrders: (overview.executionOrders || []).map(compactExecutionOrder),
    analysisBundles: [],
    evidenceBundles: [],
    memoryItems: (overview.memoryItems || []).slice(0, 10),
    strategyCatalog: compactStrategyCatalog(strategyCatalog),
    // Keep desktop-only diagnostics out of the native snapshot. The App research page receives
    // a bounded evidence list with sampled curves instead of the full workbench payload.
    reviewAnalytics: {},
    professional: {},
    backtestResearch: compactBacktestResearch(overview.backtestResearch),
    strategyProfiles: [],
    decisionCalibration: {},
    agentStateFiles: {},
    marketCalendarEvents: (overview.marketCalendarEvents || []).map(compactEvent),
    dailyMarketBrief: compactDailyBrief(overview.dailyMarketBrief),
    toolExecutions: [],
    analysisEngine: {
      tools: (overview.analysisEngine?.tools || []).slice(0, 80),
      toolUsageStatsSince: overview.analysisEngine?.toolUsageStatsSince || null,
      toolUsageBackfilledAt: overview.analysisEngine?.toolUsageBackfilledAt || null
    },
    paperReport: compactPaperReport(overview.paperReport),
    opportunityCandidates: (overview.opportunityCandidates || []).slice(0, 10),
    agentStatus: compactAgentStatus(overview.agentStatus)
  };
  return native === "startup" ? startupOverview(compact) : compact;
}
