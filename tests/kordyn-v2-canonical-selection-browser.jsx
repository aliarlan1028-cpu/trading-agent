import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import KordynV2Root from "../src/kordynV2/entry.jsx";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";
import { KORDYN_V2_PRODUCTION_FIXTURE_JSON } from "./kordyn-v2-production-fixture.js";

const asOf = "2026-09-01T02:30:00.000Z";
const base = JSON.parse(KORDYN_V2_PRODUCTION_FIXTURE_JSON);
const data = parseJsonResponseText(JSON.stringify({
  ...base,
  revision: 806,
  source: "Plan 06 canonical convergence production-shaped fixture",
  asOf,
  lastValidSource: "Plan 06 canonical convergence production-shaped fixture",
  lastValidAt: asOf,
  user: { ...base.user, id: "owner-fixture", name: "Owner K0", role: "owner", isOwner: true },
  permissions: ["*"],
  resourceState: {
    chat: "loaded",
    cockpit: "loaded",
    operationsCenter: "loaded",
    researchCenter: "loaded",
    riskCenter: "loaded",
    systemSettings: "loaded"
  },
  exchangeAccounts: [{ id: "ex-okx-main", exchange: "OKX", label: "OKX Unified", status: "connected", updatedAt: asOf }],
  accountSnapshots: [{ id: "snapshot-main", accountId: "ex-okx-main", status: "ok", createdAt: asOf, algoOrdersComplete: true, algoOrders: [] }],
  positions: [{ id: "position-eth", positionId: "position-eth", symbol: "ETH/USDT", instId: "ETH-USDT-SWAP", direction: "long", quantity: 1.4, entryPrice: 3400, markPrice: 3468, notionalUsdt: 4855.2, margin: 1618.4, leverage: 3, accountId: "ex-okx-main", exchange: "OKX", rawSyncedAt: asOf, status: "open" }],
  tradePlans: [{ id: "plan-btc", title: "BTC guarded continuation", symbol: "BTC/USDT", direction: "long", status: "awaiting_approval", strategy: "Breakout Retest v3.4", agentRunId: "run-btc-analysis", entry_range: [68000, 68200], stopLoss: 67200, takeProfit: [69400], quantity: 0.1, leverage: 2, evidenceIds: ["signal-cpi-flow"], lastRiskCheck: { id: "risk-check-1", passed: true, summary: "Boundaries verified", warnings: [], blockers: [] }, accountImpact: { equityUsdt: 28640.72, availableMarginUsdt: 13870.1, openPositionCount: 1, projectedOpenPositionCount: 2, estimatedMaxLossUsdt: 100 }, createdAt: asOf }],
  executionOrders: [{ id: "execution-btc", planId: "plan-btc", positionId: "position-eth", symbol: "BTC/USDT", direction: "long", status: "filled", exchange: "OKX", accountId: "ex-okx-main", createdAt: asOf, updatedAt: asOf }],
  orders: [{ id: "order-btc", orderId: "order-btc", executionOrderId: "execution-btc", planId: "plan-btc", symbol: "BTC/USDT", side: "buy", orderType: "limit", status: "filled", source: "exchange_rest", exchange: "OKX", accountId: "ex-okx-main", quantity: 0.1, filledQuantity: 0.1, price: 68100, createdAt: asOf, updatedAt: asOf }],
  fills: [{ id: "fill-btc", tradeId: "fill-btc", executionOrderId: "execution-btc", orderId: "order-btc", tradePlanId: "plan-btc", tradeLifecycleKey: "execution-btc", kind: "close", symbol: "BTC/USDT", direction: "long", quantity: 0.1, price: 69000, realizedPnl: 90, feeUsdt: 1.2, source: "exchange_rest", createdAt: asOf }],
  reviews: [{ id: "review-btc", type: "trade", status: "completed", title: "BTC execution review", symbol: "BTC/USDT", strategyVersionId: "breakout@3.4", strategyName: "Breakout Retest v3.4", executionOrderId: "execution-btc", fillIds: ["fill-btc"], netRealizedPnl: 88.8, avgSlippagePct: 0.06, summary: "Execution respected the governed boundary.", completedAt: asOf, evidence: [{ id: "fill-btc", type: "fill", label: "Fill evidence", status: "verified" }] }],
  strategyCatalog: {
    products: [{ id: "breakout-retest", version: "3.4", versionId: "breakout@3.4", immutable: true, definition: { name: "Breakout Retest v3.4", family: "breakout_retest", direction: "both", timeframes: ["1h"], summary: "Governed breakout retest.", stages: ["sense", "guard"], regimes: ["trend"], roles: ["trader"], invalidation: ["low_depth"], exits: ["risk_stop"] }, deployment: { state: "validated_active", evidenceStatus: "verified", reason: "Owner approved" }, metrics: { profitFactor: 1.8, winRatePct: 58, closedTrades: 42, lastClosedAt: asOf }, evidence: { backtestId: "backtest-owner" } }],
    strategies: [{ id: "mean-reversion", name: "Mean Reversion Core", contract: { direction: "both", timeframes: ["5m"], entryModel: "range reversion", family: "mean_reversion", dataRequirements: [{ source: "market", dataset: "candles" }] }, lifecycle: { stage: "active", executionEligibility: true, reason: "system native", live: { profitFactor: 1.3, winRatePct: 54, trades: 29 }, profile: { chosenAt: asOf, oos: { status: "passed" } } } }]
  },
  strategyStudio: {
    drafts: [{ id: "draft-owner", title: "Breakout v3.5", status: "testing", version: "v3.5", generatedTests: { status: "passed", total: 20, passed: 20 } }],
    backtests: [{ id: "backtest-owner", improvementId: "owner-candidate", draftId: "draft-owner", strategyName: "Breakout v3.5", symbol: "BTC/USDT", split: "oos", status: "passed" }]
  },
  backtests: [{ id: "backtest-owner", improvementId: "owner-candidate", draftId: "draft-owner", strategyName: "Breakout v3.5", symbol: "BTC/USDT", split: "oos", status: "passed" }],
  knowledge: {
    sources: [{ id: "source-market", title: "Market Microstructure Playbook", type: "pdf", status: "parsed", parserVersion: "2.4", updatedAt: asOf }],
    chunks: [{ id: "evidence-depth", sourceId: "source-market", page: 84, type: "source_excerpt", text: "Depth must be verified before execution." }],
    candidates: [{ id: "candidate-workflow", sourceId: "source-market", type: "workflow", status: "candidate", title: "Depth Preflight Workflow" }],
    tradingMethods: [], ruleProposals: [], workflows: [], tradingSkills: []
  },
  analysisEngine: { tools: [{ id: "native-risk", name: "风险预检", native: true, status: "ready", version: "3.2", permission: "account.read", runs: 416 }] },
  skills: [], tools: [], mcpServers: [],
  ownerReviewLoop: {
    summary: { structuredReviews: 1, pendingOwner: 1, validating: 1 }, lessons: [],
    improvements: [{ id: "owner-candidate", reviewId: "review-btc", state: "validating", destination: "strategy", title: "Breakout v3.5", problem: "Low-depth slippage", proposal: "Add depth preflight", evidenceCount: 4, version: "v3.5", validation: { ready: true, readyForOwnerVerification: true, stages: [{ name: "oos", status: "passed" }] }, validationEvidence: [{ type: "backtest", value: "passed" }] }]
  },
  paperReport: { sessions: [] },
  mandates: [{ id: "mandate-core", name: "Core governed mandate", version: 17, status: "active", maxLeverage: 3, maxOrderNotionalUsdt: 2500 }],
  riskRules: [{ id: "rule-event", name: "High-impact event window", enabled: true, action: "reduce_only" }],
  riskChecks: [{ id: "risk-check-1", ruleId: "rule-event", ruleName: "High-impact event window", status: "blocked", reason: "Event window", createdAt: asOf }],
  riskIncidents: [{ id: "risk-incident-1", title: "Account snapshot stale", severity: "high", status: "open", source: "account_sync", createdAt: asOf }],
  eventSources: [{ id: "event-source-fed", name: "Federal Reserve", enabled: true, status: "healthy", lastSuccessAt: asOf }],
  marketIntelligenceSourceHealth: [{ id: "event-source-fed", sourceId: "event-source-fed", health: "healthy", checkedAt: asOf, lastSuccessAt: asOf }],
  eventRiskWindows: [{ id: "event-window-fomc", eventId: "event-window-fomc", title: "FOMC decision", dueAt: "2026-09-17T18:00:00Z", blocking: true, relatedSymbols: ["BTC/USDT"] }],
  tasks: [{ id: "task-1", name: "自主巡检", handler: "governance_patrol", enabled: true, systemManaged: true }],
  jobRuns: [{ id: "job-run-1", taskId: "task-1", taskName: "自主巡检", status: "success", createdAt: asOf, finishedAt: asOf }],
  notifications: [{ id: "notification-1", title: "事件窗口已限制新风险", status: "delivered", severity: "warning", read: false, source: "risk", createdAt: asOf }],
  auditLogs: [{ id: "audit-1", action: "risk.evaluate", actor: "system", resource: "rule-event", status: "recorded", traceId: "trace-audit-1", createdAt: asOf }],
  reconciliationReports: [{ id: "recovery-1", title: "Account reconciliation", status: "completed", createdAt: asOf, differences: [] }],
  system: { ...base.system, executionMode: "full_auto", effectiveMode: "observe", apiHealth: "healthy" },
  automationState: { ...base.automationState, requestedMode: "full_auto", selectedMode: "full_auto", mode: "observe", effectiveMode: "observe", runtimeStatus: "opening_paused", blockerDetails: [] },
  readiness: { checks: [] },
  config: { liveTrading: { maxNotionalUsdt: 3000 }, runtime: { authRequired: true, adminPasswordSet: true }, llm: { providers: {} }, integrations: {} },
  backupStatus: { status: "verified", completedAt: asOf },
  security: { mfaRequired: true, mfaEnabled: true },
  exchangeApiKeyMetadata: [{ id: "ex-okx-main", withdrawalPermission: false, keySuffix: "K7Q2" }],
  llmModels: [], agentProfiles: [], users: [{ id: "owner-fixture", name: "Owner K0", roleId: "owner" }], subscriptions: []
}));

window.__kordynV2ConvergenceData = data;

function BrowserHarness() {
  const api = useMemo(() => ({
    data,
    action: async () => ({ ok: false, status: "not_exercised_by_selection_gate" }),
    ensureSection: async () => data,
    notify: () => {},
    connectionError: ""
  }), []);
  return <KordynV2Root api={api} lang="zh" />;
}

createRoot(document.getElementById("root")).render(<BrowserHarness />);
window.__kordynV2CanonicalSelectionReady = true;
