import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import KordynV2Root from "../src/kordynV2/entry.jsx";
import { ConfirmHost } from "../src/confirm.jsx";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";
import { KORDYN_V2_PRODUCTION_FIXTURE_JSON } from "./kordyn-v2-production-fixture.js";

const query = new URLSearchParams(location.search);
const scenario = query.get("scenario") || "ready";
const approvalMode = ["success", "failure", "partial"].includes(query.get("approval")) ? query.get("approval") : "partial";
const base = JSON.parse(KORDYN_V2_PRODUCTION_FIXTURE_JSON);
const ethMonitorRun = {
  id: "run-eth-monitor",
  goal: "ETH 突破回踩机会",
  status: "observing",
  evidenceCount: 5,
  presentation: { nextAction: "继续监控入场条件，尚未下单" },
  strategyName: "Breakout Retest v3",
  knowledgeSource: "波动环境指南 + 2 条真实复盘",
  capabilities: ["行情", "市场结构", "风控", "执行"],
  eventWindow: "FOMC · 6h",
  positionId: "position-eth",
  createdAt: "2026-08-30T00:01:07.000Z",
  updatedAt: "2026-08-30T00:12:11.000Z",
  steps: [{ id: "step-eth-monitor", phase: "watch", title: "监控入场条件", summary: "正在监控入场条件，尚未下单" }]
};
const representativeAnalysisRun = {
  id: "run-btc-analysis-fixture",
  goal: "BTC 波动结构分析",
  status: "running",
  evidenceCount: 4,
  presentation: { nextAction: "继续核对证据与账户敞口" },
  strategyName: "Regime Filter v2",
  knowledgeSource: "波动环境指南",
  capabilities: ["行情", "账户", "知识检索"],
  eventWindow: "CPI · 18h",
  positionId: "position-btc",
  createdAt: "2026-08-30T00:02:00.000Z",
  updatedAt: "2026-08-30T00:09:00.000Z",
  steps: [{ id: "step-btc-analysis-fixture", phase: "analyzing", title: "核对市场与证据", summary: "正在检查市场并核对相关证据" }]
};
const representativeExecutingRun = {
  id: "run-eth-executing-fixture",
  goal: "ETH 已授权计划执行",
  status: "approved",
  evidenceCount: 6,
  presentation: { nextAction: "等待权威执行结果" },
  strategyName: "Breakout Retest v3",
  knowledgeSource: "ETH 执行清单",
  capabilities: ["执行", "风控"],
  eventWindow: "FOMC · 6h",
  positionId: "position-eth",
  createdAt: "2026-08-30T00:03:00.000Z",
  updatedAt: "2026-08-30T00:10:00.000Z",
  steps: [{ id: "step-eth-executing-fixture", phase: "approved", title: "等待执行回执", summary: "计划已获授权，等待权威执行结果" }]
};
const representativeCompletedRun = {
  id: "run-eth-completed-fixture",
  goal: "ETH 计划结果复盘",
  status: "completed",
  evidenceCount: 5,
  presentation: { nextAction: "查看实盘复盘证据" },
  strategyName: "Breakout Retest v3",
  knowledgeSource: "ETH 实盘复盘",
  capabilities: ["复盘", "证据"],
  eventWindow: "FOMC · 已结束",
  positionId: "position-eth",
  createdAt: "2026-08-29T23:32:00.000Z",
  updatedAt: "2026-08-30T00:05:00.000Z",
  completedAt: "2026-08-30T00:05:00.000Z",
  steps: [{ id: "step-eth-completed-fixture", phase: "decision", title: "整理复盘证据", summary: "执行结果已进入复盘" }]
};
const solRun = {
  id: "run-sol-approval",
  goal: "SOL 白名单外机会",
  status: "awaiting_approval",
  tradePlanId: "plan-sol-approval",
  evidenceCount: 3,
  presentation: { nextAction: "等待一次性人工授权" },
  steps: [
    { id: "step-sol-sense", phase: "observe", title: "发现机会", summary: "结构与量能比达标" },
    { id: "step-sol-risk", phase: "risk_checking", title: "硬风控", summary: "12/12 通过" },
    { id: "step-sol-approval", phase: "awaiting_approval", title: "等待确认", summary: "SOL 不在常驻授权范围" }
  ]
};
const solPlan = {
  id: "plan-sol-approval",
  agentRunId: "run-sol-approval",
  status: "awaiting_approval",
  symbol: "SOL/USDT",
  direction: "long",
  entry: { range: "142.20–143.10", riskPercent: 0.3 },
  entry_range: [142.2, 143.1],
  stopLoss: 138.8,
  takeProfit: [149.5, 154],
  leverage: 2,
  max_loss_pct: 0.3,
  strategy: "Breakout Retest v3",
  evidenceIds: ["market-sol", "account-snapshot", "mandate-sol"],
  analysisBundleId: "bundle-sol",
  lastRiskCheck: { id: "risk-sol", passed: true, summary: "12/12 通过", warnings: ["SOL 不会加入常驻白名单"] }
};
const initialMessage = {
  id: "message-sol-initial",
  sessionId: "chat-manual",
  agentRunId: "run-sol-approval",
  planId: "plan-sol-approval",
  role: "agent",
  content: "### SOL 结构复核\n结构与量能比达标，但 SOL 不在常驻授权范围。当前尚未下单。",
  createdAt: "2026-08-30T00:00:00.000Z",
  model: "production-shaped-fixture"
};

function scenarioData() {
  const data = {
    ...base,
    revision: 205,
    source: "Task 5 bounded production-shaped authority",
    asOf: "2026-08-30T00:12:00.000Z",
    lastValidSource: "Task 5 bounded production-shaped authority",
    lastValidAt: "2026-08-30T00:12:00.000Z",
    agentRuns: [ethMonitorRun, representativeAnalysisRun, representativeExecutingRun, representativeCompletedRun, ...base.agentRuns, solRun],
    tradePlans: [...base.tradePlans, solPlan],
    chatMessages: [initialMessage],
    resourceState: { ...base.resourceState }
  };
  const kind = scenario === "ready" ? "loaded" : scenario;
  data.resourceState.chat = kind;
  data.resourceState.operationsCenter = kind;
  if (scenario === "empty") {
    data.agentRuns = [];
    data.tradePlans = [];
    data.watchTriggers = [];
    data.newsFeed = [];
    data.marketMovers = { movers: [] };
    data.marketCalendarEvents = [];
    data.chatMessages = [];
  }
  if (scenario === "long-content") {
    data.agentRuns = [{
      ...solRun,
      id: "run-long-content",
      tradePlanId: "",
      status: "running",
      goal: `ETH 长内容证据 ${"完整来源、风险、能力与复盘关系。".repeat(120)}`,
      presentation: { nextAction: "继续监控全部已加载事实" }
    }];
    data.tradePlans = [];
  }
  if (scenario === "large-list") {
    data.agentRuns = Array.from({ length: 64 }, (_, index) => ({
      id: `run-large-${index + 1}`,
      goal: `权威 Mission ${index + 1}`,
      status: index % 3 === 0 ? "completed" : "running",
      evidenceCount: index + 1,
      presentation: { nextAction: `检查第 ${index + 1} 项` },
      steps: [{ id: `step-${index + 1}`, phase: index % 3 === 0 ? "decision" : "observe", title: "权威阶段", summary: `完整事实 ${index + 1}` }]
    }));
    data.tradePlans = [];
  }
  return parseJsonResponseText(JSON.stringify(data));
}

const data = scenarioData();
const calls = {
  actionRequests: [],
  actionResults: [],
  authorityWrites: 0,
  downloads: [],
  chatReads: 0,
  chatWrites: 0
};
let messages = [initialMessage];
const sessions = [{ id: "chat-manual", title: "SOL 风险复核", status: "active", updatedAt: "2026-08-30T00:00:00.000Z" }];

window.__task5Calls = calls;
window.__task5Scenario = scenario;
window.__task5ApprovalMode = approvalMode;
window.__task5DiagnosticToPng = async (timeoutMs = 6_000) => {
  const node = document.querySelector("[data-kordyn-v2-poster-canvas]");
  if (!node) return { status: "missing-poster" };
  const startedAt = performance.now();
  const operation = import("html-to-image")
    .then(({ toPng }) => toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor: "#07111f" }))
    .then((value) => ({ status: "resolved", prefix: String(value).slice(0, 22), elapsedMs: performance.now() - startedAt }))
    .catch((error) => ({ status: "rejected", error: error?.message || String(error), elapsedMs: performance.now() - startedAt }));
  return await Promise.race([
    operation,
    new Promise((resolve) => setTimeout(() => resolve({ status: "timeout", elapsedMs: performance.now() - startedAt }), timeoutMs))
  ]);
};

function chatPayload(sessionId = "chat-manual") {
  return {
    sessions,
    activeSessionId: sessionId,
    messages: messages.filter((message) => message.sessionId === sessionId),
    provider: { name: "Production-shaped authority", model: "bounded-contract" },
    messageScope: "single-session"
  };
}

function BrowserHarness() {
  const api = useMemo(() => ({
    data,
    action: async (endpoint, payload = {}, method = "POST") => {
      calls.actionRequests.push({ endpoint, payload, method });
      if (method !== "GET") calls.authorityWrites += 1;
      if (method === "GET" && endpoint.startsWith("/api/agent/chat")) {
        calls.chatReads += 1;
        const sessionId = new URL(endpoint, location.origin).searchParams.get("sessionId") || "chat-manual";
        await new Promise((resolve) => setTimeout(resolve, 45));
        return chatPayload(sessionId);
      }
      if (endpoint === "/api/agent/chat") {
        calls.chatWrites += 1;
        await new Promise((resolve) => setTimeout(resolve, 180));
        const sessionId = payload.sessionId || "chat-manual";
        messages = [...messages,
          { id: `user-${calls.chatWrites}`, sessionId, role: "user", content: payload.message, createdAt: "2026-08-30T00:15:00.000Z" },
          { id: `agent-${calls.chatWrites}`, sessionId, role: "agent", content: "服务器权威回复：继续等待风险边界。", createdAt: "2026-08-30T00:15:02.000Z", model: "bounded-contract" }
        ];
        return { accepted: true };
      }
      if (endpoint === "/api/agent/memory") {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { id: "memory-task5", stored: true };
      }
      if (endpoint === "/api/watch-triggers/watch-eth-retest/cancel") {
        await new Promise((resolve) => setTimeout(resolve, 120));
        const result = { message: "watch cancelled", watch: { id: "watch-eth-retest", status: "cancelled" } };
        calls.actionResults.push({ endpoint, result });
        return result;
      }
      if (endpoint === "/api/event-sources/refresh") {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return { status: "partial", attempted: 3, succeeded: 2, failed: 1, ingested: 4, reason: "one_source_failed" };
      }
      if (endpoint === "/api/trade-plans/plan-sol-approval/approve") {
        await new Promise((resolve) => setTimeout(resolve, 420));
        if (window.__task5ApprovalMode === "failure") return { ok: false, error: "risk_blocked" };
        if (window.__task5ApprovalMode === "partial") return {
          ok: false,
          error: "execution_not_submitted",
          httpStatus: 409,
          plan: { id: "plan-sol-approval", status: "approved" },
          approvalGranted: true,
          executionSubmitted: false,
          execution: { status: "risk_recheck_failed", reason: "capacity_changed" },
          guard: { label: "账户容量已变化", fix: "刷新账户事实" },
          message: "批准已消费，但订单未提交。"
        };
        return {
          plan: { id: "plan-sol-approval", status: "approved" },
          approvalGranted: true,
          executionSubmitted: true,
          execution: { status: "entry_pending" },
          message: "计划已批准，入场单已提交到交易所。"
        };
      }
      if (endpoint === "/api/trade-plans/plan-sol-approval/cancel") {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { id: "plan-sol-approval", status: "cancelled" };
      }
      if (endpoint === "/api/posters/translate") {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { translated: "SOL structure review. Structure and volume qualify; no order has been placed." };
      }
      return { ok: false, error: "unsupported_fixture_action" };
    },
    ensureSection: async () => data,
    notify: () => {},
    download: async (url, filename) => {
      calls.downloads.push({ prefix: String(url).slice(0, 22), filename });
      return { ok: true };
    },
    connectionError: ""
  }), []);
  return <><KordynV2Root api={api} lang="zh" /><ConfirmHost /></>;
}

createRoot(document.getElementById("root")).render(<BrowserHarness />);
window.requestAnimationFrame(() => { window.__task5Ready = true; });
