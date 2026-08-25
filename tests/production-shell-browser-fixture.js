const due = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const createdAt = new Date(Date.now() - 60 * 1000).toISOString();

export const loadedResourceState = {
  chat: "loaded",
  cockpit: "loaded",
  researchCenter: "loaded",
  riskCenter: "loaded",
  operationsCenter: "loaded",
  systemSettings: "loaded"
};

export const productionShellBrowserFixture = {
  resourceState: loadedResourceState,
  user: { id: "owner-1", name: "Owner", isOwner: true, tenantName: "Browser contract" },
  system: { mode: "confirm_each", killSwitch: false, apiHealth: "healthy", dataFreshnessState: "fresh", dataFreshnessMs: 100, latencyMs: 10 },
  portfolio: { totalEquityUsdt: 10000, availableMarginUsdt: 8000, frozenMarginUsdt: 0 },
  markets: [{ symbol: "BTC/USDT", price: 64250, markPrice: 64250, change24hPct: 1.2, status: "fresh", updatedAt: createdAt }],
  positions: [{ positionId: "position-native-2", symbol: "BTC/USDT", status: "open", side: "long", size: 0.2, entryPrice: 63000, markPrice: 64250 }],
  events: [{ id: "event-5", title: "US CPI", shortTitle: "US CPI", status: "scheduled", due, startAt: due, impact: 100, source: "U.S. BLS", evidenceId: "evidence-ai-event" }],
  eventRiskWindows: [{ id: "event-5", eventId: "event-5", title: "US CPI", sourceId: "official_bls", sourceName: "U.S. BLS", dueAt: due, deltaMs: 600000, phase: "pre_release_blackout", blocking: true, impact: 100, marketWide: true, verified: true, evidenceId: "evidence-control-event" }],
  reviews: [{ id: "review-15", type: "trade", title: "BTC execution review", symbol: "BTC/USDT", direction: "long", status: "completed", summary: "Protected exit", lesson: "Keep the guard", netRealizedPnl: 42, completedAt: createdAt }],
  closedTradeLifecycles: [{ id: "trade-15", symbol: "BTC/USDT", direction: "long", netRealizedPnl: 42, createdAt }],
  skills: [{ id: "capability-18", name: "Order-book analyzer", kind: "analysis", status: "active", enabled: true, native: true }],
  strategyCatalog: {
    products: [{ id: "breakout", versionId: "breakout@4", version: 4, definition: { name: "Breakout product" }, deployment: { state: "owner_live_observation" } }],
    strategies: [{ id: "mean-reversion", name: "Mean reversion", lifecycle: { stage: "research" }, contract: {} }],
    research: []
  },
  backtestResearch: { historical: [{ id: "validation-6", name: "Breakout OOS", symbol: "BTC/USDT", timeframe: "1h", status: "passed", trades: 50, expectancyR: 0.3, profitFactor: 1.4, maxDrawdownPct: 8 }], forward: [] },
  tasks: [{ id: "task-9", name: "Reconcile fills", title: "Reconcile fills", status: "running", enabled: true, type: "Every", handler: "reconcile", schedule: "Every 5m" }],
  jobRuns: [{ id: "run-task-9", taskId: "task-9", taskName: "Reconcile fills", status: "completed", finishedAt: createdAt, durationMs: 120 }],
  auditLogs: [{ id: "audit-13", action: "ORDER_AUTHORIZED", actor: "Owner", resource: "plan-17", status: "recorded", createdAt, hash: "sha256:audit13", context: { source: "browser-contract" } }],
  mandates: [{ id: "mandate-main", name: "Owner mandate", status: "active", version: 3 }],
  riskRules: [],
  riskIncidents: [],
  notifications: [],
  eventSources: [],
  exchangeAccounts: [],
  traces: [
    { workspaceId: "ai", objectId: "event-5", objectType: "Event", stage: "sense", status: "complete", evidenceId: "trace-event" },
    { workspaceId: "live", objectId: "BTC/USDT", objectType: "Market", stage: "sense", status: "complete", evidenceId: "trace-market" },
    { workspaceId: "lab", objectId: "capability-18", objectType: "Capability", stage: "recall", status: "complete", evidenceId: "trace-capability" },
    { workspaceId: "lab", objectId: "breakout@4", objectType: "Strategy product", stage: "plan", status: "complete", evidenceId: "trace-product" },
    { workspaceId: "lab", objectId: "mean-reversion", objectType: "Strategy", stage: "plan", status: "complete", evidenceId: "trace-strategy" },
    { workspaceId: "lab", objectId: "validation-6", objectType: "Validation run", stage: "guard", status: "complete", evidenceId: "trace-validation" },
    { workspaceId: "lab", objectId: "review-15", objectType: "Review", stage: "review", status: "complete", evidenceId: "trace-review" },
    { workspaceId: "control", objectId: "event-5", objectType: "Event", stage: "guard", status: "complete", evidenceId: "trace-risk-event" },
    { workspaceId: "operations", objectId: "task-9", objectType: "Task", stage: "execute", status: "complete", evidenceId: "trace-task" },
    { workspaceId: "operations", objectId: "audit-13", objectType: "Audit log", stage: "review", status: "complete", evidenceId: "trace-audit" }
  ]
};
