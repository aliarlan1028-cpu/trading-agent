import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmHost } from "../src/confirm.jsx";
import KordynV2Root from "../src/kordynV2/entry.jsx";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";
import { KORDYN_V2_PRODUCTION_FIXTURE_JSON } from "./kordyn-v2-production-fixture.js";

const query = new URLSearchParams(location.search);
const scenario = query.get("scenario") || "ready";
const resultMode = ["success", "partial", "failure"].includes(query.get("result")) ? query.get("result") : "success";
const asOf = "2026-08-31T11:30:00.000Z";

function buildFixture() {
  const base = JSON.parse(KORDYN_V2_PRODUCTION_FIXTURE_JSON);
  const loaded = !["loading", "stale", "degraded"].includes(scenario);
  const data = {
    ...base,
    revision: 705,
    source: "Plan 05 system governance production-shaped fixture",
    asOf,
    lastValidSource: "Plan 05 system governance production-shaped fixture",
    lastValidAt: asOf,
    user: { ...base.user, name: "Owner K0", role: scenario === "forbidden" ? "viewer" : "owner", isOwner: scenario !== "forbidden" },
    permissions: scenario === "forbidden" ? ["account.read", "audit.read"] : ["*"],
    resourceState: {
      ...base.resourceState,
      riskCenter: loaded ? "loaded" : scenario,
      operationsCenter: loaded ? "loaded" : scenario,
      systemSettings: loaded ? "loaded" : scenario
    },
    notificationCount: 2,
    system: { ...base.system, apiHealth: "healthy", executionMode: "full_auto", effectiveMode: "observe", latestAction: "risk gate revalidation" },
    automationState: {
      ...base.automationState,
      requestedMode: "full_auto",
      selectedMode: "full_auto",
      mode: "observe",
      effectiveMode: "observe",
      runtimeStatus: "opening_paused",
      blockerDetails: [{ code: "event_window", label: "FOMC 前暂停新风险", detail: "高影响事件窗口生效", recovery: "窗口结束后由服务端重新验证" }]
    },
    mandates: [{ id: "mandate-core-17", version: 17, name: "Core governed mandate", status: "active", allowedSymbols: ["BTC/USDT", "ETH/USDT"], maxLeverage: 3, maxOrderNotionalUsdt: 2_500, maxPortfolioNotionalUsdt: 25_000 }],
    readiness: { checks: [
      { key: "private_rest_positions", configured: true },
      { key: "withdraw_permission_detection", configured: true },
      { key: "audit_chain", configured: true },
      { key: "audit_worm", configured: true }
    ] },
    riskRules: [
      { id: "rule-notional", name: "Maximum order notional", enabled: true, action: "block", systemManaged: true },
      { id: "rule-event-window", name: "High-impact event window", enabled: true, action: "reduce_only" }
    ],
    riskChecks: [
      { id: "risk-check-event-91", ruleId: "rule-event-window", ruleName: "High-impact event window", status: "blocked", reason: "FOMC window", createdAt: asOf },
      { id: "risk-check-notional-88", ruleId: "rule-notional", ruleName: "Maximum order notional", status: "passed", createdAt: asOf }
    ],
    eventRiskWindows: [
      { id: "event-window-fomc", eventId: "event-window-fomc", title: "FOMC 利率决议", dueAt: "2026-09-17T18:00:00Z", blocking: true, relatedSymbols: ["BTC/USDT", "ETH/USDT"] },
      { id: "event-window-payrolls", eventId: "event-window-payrolls", title: "美国非农就业数据", dueAt: "2026-09-18T12:30:00Z", blocking: false, relatedSymbols: ["BTC/USDT"] }
    ],
    eventSources: [
      { id: "event-source-fed", name: "Federal Reserve", enabled: true, status: scenario === "failed" ? "failed" : "healthy", lastSuccessAt: asOf },
      { id: "event-source-bls", name: "BLS", enabled: true, status: "healthy", lastSuccessAt: asOf }
    ],
    marketIntelligenceSourceHealth: [
      { id: "event-source-fed", sourceId: "event-source-fed", health: scenario === "failed" ? "failed" : "healthy", checkedAt: asOf, lastSuccessAt: asOf, error: scenario === "failed" ? "upstream_timeout" : null },
      { id: "event-source-bls", sourceId: "event-source-bls", health: "healthy", checkedAt: asOf, lastSuccessAt: asOf }
    ],
    tasks: [
      { id: "task-governance-patrol", name: "自主巡检", handler: "governance_patrol", enabled: true, systemManaged: true },
      { id: "task-reconcile", name: "账户对账", handler: "account_reconcile", enabled: scenario !== "disabled", systemManaged: true }
    ],
    jobRuns: [
      { id: "job-run-patrol-42", taskId: "task-governance-patrol", taskName: "自主巡检", status: "success", createdAt: asOf, finishedAt: asOf, durationMs: 842, stages: [
        { id: "market", label: "检查市场", status: "completed" },
        { id: "account", label: "核对账户", status: "completed" },
        { id: "evidence", label: "验证证据", status: "completed" },
        { id: "risk", label: "风险边界", status: "completed" },
        { id: "monitor", label: "继续监控", status: "completed" }
      ] },
      { id: "job-run-reconcile-41", taskId: "task-reconcile", taskName: "账户对账", status: "failed", error: "exchange_snapshot_stale", createdAt: "2026-08-31T11:20:00.000Z", finishedAt: "2026-08-31T11:20:08.000Z" }
    ],
    notifications: [
      { id: "notification-risk-12", title: "事件窗口已限制新开仓", status: "delivered", severity: "warning", read: false, source: "risk", createdAt: asOf },
      { id: "notification-run-11", title: "账户对账需要处理", status: "delivery_failed", severity: "critical", read: false, source: "operations", createdAt: "2026-08-31T11:20:09.000Z" }
    ],
    auditLogs: [
      { id: "audit-mode-33", action: "operating_mode.evaluate", actor: "system", resource: "automation", status: "recorded", traceId: "trace-mode-33", createdAt: asOf },
      { id: "audit-task-32", action: "task.run.failed", actor: "scheduler", resource: "task-reconcile", status: "recorded", traceId: "trace-task-32", createdAt: "2026-08-31T11:20:09.000Z" }
    ],
    reconciliationReports: [
      { id: "recovery-report-28", title: "Account reconciliation 28", status: "partial", createdAt: "2026-08-31T11:20:09.000Z", differences: [{ id: "diff-order-7", type: "order", status: "open" }] },
      { id: "recovery-report-27", title: "Account reconciliation 27", status: "completed", createdAt: "2026-08-31T11:05:00.000Z", differences: [] }
    ],
    riskIncidents: [{ id: "risk-incident-16", title: "账户快照过期", severity: "high", status: "open", source: "account_sync", createdAt: "2026-08-31T11:20:09.000Z" }],
    executionOrders: [...(base.executionOrders || []), { id: "execution-recovery-5", symbol: "BTC/USDT", status: "recovery_pending", updatedAt: asOf }],
    realtimeStarted: true,
    realtimeConnections: [{ id: "ws-private", status: "connected" }, { id: "ws-public", status: "connected" }],
    accountSnapshots: [{ id: "snapshot-governance", status: "healthy", createdAt: asOf }],
    config: {
      liveTrading: { maxNotionalUsdt: 3_000 },
      backup: { retentionDays: 14 },
      llm: { providers: {
        gemini: { hasKey: true, model: "google/gemini-3.1-pro-preview" },
        classifier: { hasKey: true, model: "google/gemini-3.1-pro-preview" },
        deepseek: { hasKey: true, model: "deepseek-v4-pro" }
      } },
      integrations: { telegram: { configured: true, hasBotToken: true, chatId: "-1001234567890", profitPosterEnabled: true, watchLanguage: "zh" }, lark: { hasWebhook: false } },
      runtime: { authRequired: true, adminPasswordSet: true, skillSandboxImage: "node:20-alpine", okxMarketType: "perpetual_swap", httpProxySet: false, httpsProxySet: false, port: "8787" },
      secretsMasterKeySet: true
    },
    backupStatus: { status: "verified", completedAt: "2026-08-31T06:00:00.000Z" },
    security: { mfaRequired: true, mfaEnabled: true, credentialStatus: "masked" },
    exchangeAccounts: [{ id: "exchange-okx-main", exchange: "OKX", status: "connected", keySuffix: "K7Q2" }],
    exchangeApiKeyMetadata: [{ id: "exchange-okx-main", withdrawalPermission: false, keySuffix: "K7Q2" }],
    integrations: { telegram: { configured: true, hasBotToken: true, chatId: "-1001234567890", profitPosterEnabled: true, watchLanguage: "zh" }, lark: { hasWebhook: false } },
    llmModels: [{ id: "gpt-5.6", name: "GPT-5.6", label: "GPT-5.6" }],
    agentProfiles: [{ id: "agent-primary", name: "KORDYN Primary", role: "trading", enabled: true }],
    users: [{ id: "fixture-user", name: "Owner K0", roleId: "owner" }],
    subscriptions: [{ id: "subscription-owner", userId: "fixture-user", status: "active", planId: "owner" }]
  };
  if (scenario === "empty") {
    for (const key of ["mandates", "riskRules", "riskChecks", "eventRiskWindows", "eventSources", "marketIntelligenceSourceHealth", "tasks", "jobRuns", "notifications", "auditLogs", "reconciliationReports", "riskIncidents"]) data[key] = [];
  }
  if (scenario === "long-content") data.auditLogs[0].action = "recovery.context." + "evidence-chain-".repeat(560);
  if (scenario === "large-list") data.auditLogs = Array.from({ length: 72 }, (_, index) => ({ id: `audit-large-${index + 1}`, action: `configuration.inspect.${index + 1}`, actor: "owner", resource: `scope-${index + 1}`, status: "recorded", traceId: `trace-large-${index + 1}`, createdAt: asOf }));
  return parseJsonResponseText(JSON.stringify(data));
}

const data = buildFixture();
const calls = { actionRequests: [], actionResults: [], authorityWrites: 0 };
window.__plan05GovernanceCalls = calls;
window.__plan05GovernanceScenario = scenario;

function resultFor(endpoint) {
  if (resultMode === "failure") return { ok: false, status: "failed", error: "authoritative_governance_rejection", endpoint };
  if (resultMode === "partial") return { ok: false, status: "partial", completed: ["snapshot_refreshed"], failed: ["order_difference_open"], endpoint };
  if (endpoint === "/api/config/live-trading") return { message: "live trading target applied", applied: ["LIVE_TRADING_MODE", "LIVE_TRADING_MAX_NOTIONAL_USDT"] };
  if (endpoint === "/api/account/profile") return { user: { id: "fixture-user", name: "Owner K0" } };
  if (endpoint.startsWith("/api/risk/incidents/")) return { incident: { id: endpoint.split("/").at(-2), status: "resolved" }, message: "incident resolved" };
  if (endpoint.startsWith("/api/notifications/")) return { notification: { deliveryStatus: "delivered" }, message: "notification request completed" };
  if (endpoint.startsWith("/api/exchange/accounts/")) return { account: { id: endpoint.split("/").at(-1) }, message: "exchange account updated" };
  if (endpoint.startsWith("/api/tasks/")) return { run: { id: `server-${endpoint.replaceAll("/", "-")}`, status: "accepted" }, message: "task action accepted" };
  return { message: "governance action completed", result: { id: `server-${endpoint.replaceAll("/", "-")}` } };
}

function BrowserHarness() {
  const api = useMemo(() => ({
    data,
    action: async (endpoint, payload = {}, method = "POST") => {
      calls.actionRequests.push({ endpoint, payload, method, resultMode });
      if (method !== "GET") calls.authorityWrites += 1;
      await new Promise((resolve) => setTimeout(resolve, scenario === "processing" ? 2_500 : 180));
      const result = resultFor(endpoint);
      calls.actionResults.push({ endpoint, result });
      return result;
    },
    ensureSection: async () => data,
    notify: () => {},
    connectionError: ""
  }), []);
  return <><KordynV2Root api={api} lang="zh" /><ConfirmHost /></>;
}

createRoot(document.getElementById("root")).render(<BrowserHarness />);
window.__plan05GovernanceReady = true;
