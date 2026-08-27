export const KORDYN_V2_PRODUCTION_FIXTURE_JSON = JSON.stringify({
  revision: 41,
  source: "Read-only exchange projection",
  asOf: "2026-08-27T06:32:11Z",
  user: { id: "fixture-user", name: "K0" },
  resourceState: {
    chat: "loaded",
    cockpit: "loaded",
    researchCenter: "loaded",
    riskCenter: "loaded",
    operationsCenter: "loaded",
    systemSettings: "loaded"
  },
  portfolio: {
    totalEquityUsdt: 28640.72,
    availableMarginUsdt: 13870.1,
    marginSyncedAt: "2026-08-27T06:32:11Z",
    source: "Read-only exchange projection"
  },
  positions: [
    { id: "position-eth", positionId: "position-eth", symbol: "ETH/USDT", direction: "long", quantity: 1.4, markPrice: 4358.86, notionalUsdt: 6102.4, status: "open" },
    { id: "position-btc", positionId: "position-btc", symbol: "BTC/USDT", direction: "long", quantity: 0.03, markPrice: 68200, notionalUsdt: 2046, status: "open" }
  ],
  accountSnapshots: [
    { id: "snapshot-current", status: "ok", createdAt: "2026-08-27T06:32:11Z" }
  ],
  automationState: {
    mode: "full_auto_small",
    requestedMode: "full_auto",
    label: "自动交易",
    runtimeStatus: "normal",
    blockerDetails: []
  },
  system: {
    killSwitch: false,
    reduceOnlyMode: false,
    autonomyEnabled: true,
    liveTradingEnabled: true,
    requestedOperatingMode: "full_auto",
    riskStatus: "normal",
    dataFreshnessState: "fresh"
  },
  portfolioRisk: { status: "normal" },
  currentRiskSnapshot: {
    controls: { killSwitch: false, reduceOnly: false, riskStatus: "normal" }
  },
  markets: [
    { id: "market-eth", symbol: "ETH/USDT", price: 4358.86, updatedAt: "2026-08-27T06:32:06Z" },
    { id: "market-btc", symbol: "BTC/USDT", price: 68200, updatedAt: "2026-08-27T06:32:06Z" },
    { id: "market-sol", symbol: "SOL/USDT", price: 186.42, updatedAt: "2026-08-27T06:32:06Z" },
    { id: "market-link", symbol: "LINK/USDT", price: 24.18, updatedAt: "2026-08-27T06:32:06Z" },
    { id: "market-avax", symbol: "AVAX/USDT", price: 38.72, updatedAt: "2026-08-27T06:32:06Z" }
  ],
  marketStructures: [
    { id: "structure-eth", symbol: "ETH/USDT", status: "confirmed" },
    { id: "structure-btc", symbol: "BTC/USDT", status: "range" },
    { id: "structure-sol", symbol: "SOL/USDT", status: "reclaim" }
  ],
  onchainSignals: [
    { id: "chain-1", symbol: "ETH/USDT", status: "available" },
    { id: "chain-2", symbol: "BTC/USDT", status: "available" },
    { id: "chain-3", symbol: "SOL/USDT", status: "available" },
    { id: "chain-4", symbol: "ETH/USDT", status: "available" }
  ],
  knowledge: {
    sources: [
      { id: "knowledge-volatility", title: "Volatility regime guide", status: "published" },
      { id: "knowledge-retest", title: "Breakout retest review", status: "published" }
    ]
  },
  pendingActions: [
    { id: "action-sol-allowlist", objectId: "watch-sol-allowlist", objectType: "Watch", title: "SOL 白名单机会", detail: "一次性授权", status: "pending", severity: "high" }
  ],
  agentRuns: [
    { id: "run-btc-analysis", title: "BTC 趋势延续结构", symbol: "BTC/USDT", status: "running", summary: "全市场快扫中", createdAt: "2026-08-27T06:21:07Z", updatedAt: "2026-08-27T06:32:11Z", durationMs: 664000 },
    { id: "run-btc-complete", title: "BTC 突破回踩机会", symbol: "BTC/USDT", status: "completed", summary: "+1.28%", createdAt: "2026-08-27T05:20:00Z", completedAt: "2026-08-27T05:43:00Z", durationMs: 1380000 }
  ],
  watchTriggers: [
    {
      id: "watch-eth-retest",
      title: "ETH 突破回踩机会",
      symbol: "ETH/USDT",
      status: "active",
      thesis: "正在监控入场条件，尚未下单",
      strategyName: "Breakout Retest v3",
      knowledgeSource: "波动环境指南 + 2 条真实复盘",
      capabilities: ["行情", "市场结构", "风控", "执行"],
      eventWindow: "FOMC · 6h",
      updatedAt: "2026-08-27T06:32:11Z"
    },
    { id: "watch-sol-allowlist", title: "SOL 白名单机会", symbol: "SOL/USDT", status: "awaiting_approval", thesis: "等待授权", updatedAt: "2026-08-27T06:31:00Z" }
  ],
  tradePlans: [
    { id: "plan-eth-follow", title: "ETH 趋势跟踪计划", symbol: "ETH/USDT", status: "approved", rationale: "已建仓 · 持有中", strategy: "Trend Follow v2", timeframe: "4h" },
    { id: "plan-sol-complete", title: "SOL 波段反弹计划", symbol: "SOL/USDT", status: "completed", rationale: "+2.35%", strategy: "Swing Reclaim v1", timeframe: "1h" }
  ],
  executionOrders: [
    { id: "execution-eth", symbol: "ETH/USDT", status: "filled" },
    { id: "execution-btc", symbol: "BTC/USDT", status: "filled" }
  ],
  traces: [
    { id: "trace-sense", workspaceId: "ai", objectType: "Watch", objectId: "watch-eth-retest", stage: "Sense", status: "complete", detail: "Five market snapshots read", evidenceId: "market-eth" },
    { id: "trace-recall", workspaceId: "ai", objectType: "Watch", objectId: "watch-eth-retest", stage: "Recall", status: "complete", detail: "Two published knowledge sources matched", evidenceId: "knowledge-retest" },
    { id: "trace-plan", workspaceId: "ai", objectType: "Watch", objectId: "watch-eth-retest", stage: "Plan", status: "complete", detail: "Breakout retest plan prepared", evidenceId: "plan-eth-follow" },
    { id: "trace-guard", workspaceId: "ai", objectType: "Watch", objectId: "watch-eth-retest", stage: "Guard", status: "complete", detail: "Hard controls passed", evidenceId: "risk-current" },
    { id: "trace-execute", workspaceId: "ai", objectType: "Watch", objectId: "watch-eth-retest", stage: "Execute", status: "waiting", detail: "No order submitted", evidenceId: "watch-eth-retest" },
    { id: "trace-monitor", workspaceId: "ai", objectType: "Watch", objectId: "watch-eth-retest", stage: "Monitor", status: "waiting", detail: "Waiting for retest", evidenceId: "watch-eth-retest" },
    { id: "trace-review", workspaceId: "ai", objectType: "Watch", objectId: "watch-eth-retest", stage: "Review", status: "waiting", detail: "Review begins after outcome", evidenceId: "watch-eth-retest" }
  ]
});

export const KORDYN_V2_UNKNOWN_FACTS_FIXTURE_JSON = JSON.stringify({
  revision: 42,
  source: "Read-only mission projection",
  asOf: "2026-08-27T06:42:11Z",
  user: { id: "fixture-user-unknown", name: "K0" },
  resourceState: { chat: "loaded" },
  watchTriggers: [
    { id: "watch-unknown", title: "ETH 事实待定", symbol: "ETH/USDT" }
  ],
  traces: [
    { evidenceId: "evidence-monitor", workspaceId: "ai", objectType: "Watch", objectId: "watch-unknown", stage: "Monitor", status: "complete", detail: "Monitor fact is explicit" },
    { evidenceId: "evidence-plan", workspaceId: "ai", objectType: "Watch", objectId: "watch-unknown", stage: "Plan", status: "complete", detail: "Plan fact is explicit" },
    { evidenceId: "evidence-sense", workspaceId: "ai", objectType: "Watch", objectId: "watch-unknown", stage: "Sense", status: "blocked", detail: "Sense fact is explicit" },
    { evidenceId: "evidence-execute", workspaceId: "ai", objectType: "Watch", objectId: "watch-unknown", stage: "Execute", status: "waiting", detail: "Execute fact is explicit" },
    { evidenceId: "evidence-guard", workspaceId: "ai", objectType: "Watch", objectId: "watch-unknown", stage: "Guard", detail: "Guard status is absent" }
  ]
});

export const KORDYN_V2_EMPTY_MISSION_FIXTURE_JSON = JSON.stringify({
  revision: 45,
  source: "Read-only empty mission projection",
  asOf: "2026-08-27T06:43:11Z",
  user: { id: "fixture-user-empty", name: "K0" },
  resourceState: { chat: "loaded" }
});

export const KORDYN_V2_UNKNOWN_HEALTH_FIXTURE_JSON = JSON.stringify({
  revision: 43,
  user: { id: "fixture-user-health-unknown", name: "K0" },
  resourceState: { chat: "not_loaded" }
});

export const KORDYN_V2_ADVERSE_HEALTH_FIXTURE_JSON = JSON.stringify({
  revision: 44,
  source: "Read-only degraded projection",
  asOf: "2026-08-27T06:45:11Z",
  user: { id: "fixture-user-health-adverse", name: "K0" },
  resourceState: { chat: "loaded" },
  portfolio: { marginSyncedAt: "2026-08-27T06:45:11Z" },
  accountSnapshots: [
    { id: "snapshot-adverse", status: "critical", createdAt: "2026-08-27T06:45:11Z" }
  ],
  automationState: { mode: "halted", runtimeStatus: "failed", blockerDetails: [] },
  system: { killSwitch: true, riskStatus: "critical", dataFreshnessState: "stale" },
  portfolioRisk: { status: "critical" },
  currentRiskSnapshot: {
    controls: { killSwitch: true, reduceOnly: true, riskStatus: "critical" }
  }
});

export const KORDYN_V2_UNRESOLVED_ATTENTION_FIXTURE_JSON = JSON.stringify({
  revision: 46,
  source: "Read-only attention projection",
  asOf: "2026-08-27T06:47:11Z",
  user: { id: "fixture-user-attention-unresolved", name: "K0" },
  resourceState: { chat: "loaded" },
  watchTriggers: [
    { id: "watch-eth-retest", title: "ETH 突破回踩机会", symbol: "ETH/USDT", status: "active" }
  ],
  pendingActions: [
    { id: "action-missing", objectId: "watch-missing", objectType: "Watch", title: "未解析事项", status: "pending" }
  ]
});

export const KORDYN_V2_UNKNOWN_QUEUE_FIXTURE_JSON = JSON.stringify({
  revision: 47,
  source: "Read-only queue truth projection",
  asOf: "2026-08-27T06:48:11Z",
  user: { id: "fixture-user-queue-unknown", name: "K0" },
  resourceState: { chat: "loaded" },
  agentRuns: [
    { id: "agent-status-missing", title: "Agent status missing" },
    { id: "agent-status-novel", title: "Agent status novel", status: "calibrating" }
  ],
  watchTriggers: [
    { id: "watch-status-missing", title: "Watch status missing" }
  ],
  tradePlans: [
    { id: "plan-status-missing", title: "Plan status missing" }
  ],
  pendingActions: [],
  riskIncidents: []
});

export const KORDYN_V2_ATTENTION_PENDING_ONLY_EMPTY_FIXTURE_JSON = JSON.stringify({
  revision: 48,
  source: "Read-only partial attention projection",
  user: { id: "fixture-user-attention-pending-only", name: "K0" },
  resourceState: { chat: "loaded" },
  pendingActions: []
});

export const KORDYN_V2_ATTENTION_RISK_ONLY_EMPTY_FIXTURE_JSON = JSON.stringify({
  revision: 49,
  source: "Read-only partial attention projection",
  user: { id: "fixture-user-attention-risk-only", name: "K0" },
  resourceState: { chat: "loaded" },
  riskIncidents: []
});

export const KORDYN_V2_ATTENTION_BOTH_EMPTY_FIXTURE_JSON = JSON.stringify({
  revision: 50,
  source: "Read-only complete attention projection",
  user: { id: "fixture-user-attention-both", name: "K0" },
  resourceState: { chat: "loaded" },
  pendingActions: [],
  riskIncidents: []
});

export const KORDYN_V2_ATTENTION_PRESENT_PARTIAL_FIXTURE_JSON = JSON.stringify({
  revision: 51,
  source: "Read-only partial attention projection",
  user: { id: "fixture-user-attention-present", name: "K0" },
  resourceState: { chat: "loaded" },
  watchTriggers: [
    { id: "watch-attention-present", title: "Authoritative watch", status: "active" }
  ],
  pendingActions: [
    {
      id: "action-attention-present",
      objectId: "watch-attention-present",
      objectType: "Watch",
      title: "Authoritative pending item",
      status: "pending"
    }
  ]
});

export const KORDYN_V2_STALE_HEALTH_FIXTURE_JSON = JSON.stringify({
  revision: 52,
  source: "Read-only stale health projection",
  user: { id: "fixture-user-health-stale", name: "K0" },
  resourceState: { chat: "loaded" },
  portfolio: { marginSyncedAt: "2026-08-27T06:45:11Z" },
  automationState: { mode: "observe", runtimeStatus: "normal", blockerDetails: [] },
  system: { killSwitch: false, riskStatus: "normal", dataFreshnessState: "stale" },
  portfolioRisk: { status: "normal" }
});

export const KORDYN_V2_MISSING_HEALTH_FIXTURE_JSON = JSON.stringify({
  revision: 53,
  source: "Read-only missing health projection",
  user: { id: "fixture-user-health-missing", name: "K0" },
  resourceState: { chat: "loaded" },
  portfolio: { marginSyncedAt: "2026-08-27T06:45:11Z" }
});

export const KORDYN_V2_PENDING_HEALTH_FIXTURE_JSON = JSON.stringify({
  revision: 54,
  source: "Read-only pending health projection",
  user: { id: "fixture-user-health-pending", name: "K0" },
  resourceState: { chat: "loaded" },
  portfolio: { marginSyncedAt: "2026-08-27T06:45:11Z" },
  automationState: { mode: "observe", runtimeStatus: "normal", blockerDetails: [] },
  system: { killSwitch: false, riskStatus: "pending", dataFreshnessState: "pending" },
  portfolioRisk: { status: "pending" }
});

export const KORDYN_V2_NOVEL_HEALTH_FIXTURE_JSON = JSON.stringify({
  revision: 55,
  source: "Read-only novel health projection",
  user: { id: "fixture-user-health-novel", name: "K0" },
  resourceState: { chat: "loaded" },
  portfolio: { marginSyncedAt: "2026-08-27T06:45:11Z" },
  automationState: { mode: "observe", runtimeStatus: "normal", blockerDetails: [] },
  system: { killSwitch: false, riskStatus: "quantum", dataFreshnessState: "quantum" },
  portfolioRisk: { status: "quantum" }
});

function contradictionHealthFixture(revision, { system, marketStatus, portfolioRisk, controls }) {
  return JSON.stringify({
    revision,
    source: "Read-only contradictory health projection",
    user: { id: `fixture-user-health-contradiction-${revision}`, name: "K0" },
    resourceState: { chat: "loaded" },
    portfolio: { marginSyncedAt: "2026-08-27T06:50:11Z" },
    automationState: { mode: "observe", runtimeStatus: "normal", blockerDetails: [] },
    system,
    ...(marketStatus ? { marketStatus } : {}),
    ...(portfolioRisk ? { portfolioRisk } : {}),
    ...(controls ? { currentRiskSnapshot: { controls } } : {})
  });
}

export const KORDYN_V2_KILL_NORMAL_CONTRADICTION_FIXTURE_JSON = contradictionHealthFixture(56, {
  system: {
    killSwitch: true,
    riskStatus: "normal",
    dataFreshnessState: "fresh",
    dataStale: false
  },
  portfolioRisk: { status: "normal" }
});

export const KORDYN_V2_REDUCE_NORMAL_CONTRADICTION_FIXTURE_JSON = contradictionHealthFixture(57, {
  system: {
    reduceOnlyMode: true,
    riskStatus: "normal",
    dataFreshnessState: "fresh",
    dataStale: false
  },
  portfolioRisk: { status: "normal" }
});

export const KORDYN_V2_ADVERSE_SOURCE_CONTRADICTION_FIXTURE_JSON = contradictionHealthFixture(58, {
  system: { riskStatus: "normal", dataFreshnessState: "fresh" },
  marketStatus: { dataFreshnessState: "stale" },
  portfolioRisk: { status: "critical" }
});

export const KORDYN_V2_RECONCILIATION_STALE_CONTRADICTION_FIXTURE_JSON = contradictionHealthFixture(59, {
  system: { dataFreshnessState: "fresh", dataStale: true },
  portfolioRisk: { status: "账户对账锁定" }
});

export const KORDYN_V2_EMERGENCY_STALE_CONTRADICTION_FIXTURE_JSON = contradictionHealthFixture(60, {
  system: { dataFreshnessState: "stale", dataStale: false },
  portfolioRisk: { status: "紧急停止" }
});

export const KORDYN_V2_CONSISTENT_NORMAL_FRESH_FIXTURE_JSON = contradictionHealthFixture(61, {
  system: { riskStatus: "normal", dataFreshnessState: "fresh", dataStale: false },
  marketStatus: { dataFreshnessState: "fresh", dataStale: false },
  portfolioRisk: { status: "ok" }
});

export const KORDYN_V2_PENDING_FALSE_CONTRADICTION_FIXTURE_JSON = contradictionHealthFixture(62, {
  system: { riskStatus: "pending", dataFreshnessState: "pending", dataStale: false },
  portfolioRisk: { status: "pending" }
});

export const KORDYN_V2_NOVEL_FALSE_CONTRADICTION_FIXTURE_JSON = contradictionHealthFixture(63, {
  system: { riskStatus: "quantum", dataFreshnessState: "quantum", dataStale: false },
  portfolioRisk: { status: "quantum" }
});

export const KORDYN_V2_NORMAL_NOVEL_CONTRADICTION_FIXTURE_JSON = contradictionHealthFixture(64, {
  system: { riskStatus: "normal", dataFreshnessState: "fresh", dataStale: false },
  marketStatus: { dataFreshnessState: "fresh", dataStale: false },
  portfolioRisk: { status: "quantum" }
});
