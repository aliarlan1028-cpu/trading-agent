import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import KordynV2Root from "../src/kordynV2/entry.jsx";
import { exportPosterPng } from "../src/kordynV2/domains/ai/AiOutputSheet.jsx";
import { ConfirmHost } from "../src/confirm.jsx";
import { parseJsonResponseText } from "../src/jsonResponseProvenance.js";

const fixture = {
  revision: 104,
  source: "Task 4 production-shaped authority",
  asOf: "2026-08-29T08:00:00.000Z",
  resourceState: { chat: "loaded" },
  user: { id: "owner-task4", name: "K0" },
  portfolio: { totalEquityUsdt: 28640.72, availableMarginUsdt: 13870.1, marginSyncedAt: "2026-08-29T08:00:00.000Z", source: "Task 4 production-shaped authority" },
  positions: [
    { id: "position-btc", symbol: "BTC/USDT", notionalUsdt: 2200, status: "open" },
    { id: "position-eth", symbol: "ETH/USDT", notionalUsdt: 1600, status: "open" },
    { id: "position-link", symbol: "LINK/USDT", notionalUsdt: 480, status: "open" }
  ],
  system: { killSwitch: false, reduceOnlyMode: false, riskStatus: "normal", dataFreshnessState: "fresh" },
  automationState: { mode: "approval_required", runtimeStatus: "normal", blockerDetails: [] },
  portfolioRisk: { status: "normal" },
  currentRiskSnapshot: { controls: { killSwitch: false, reduceOnly: false, riskStatus: "normal" } },
  agentRuns: [{
    id: "run-sol-approval", goal: "SOL 白名单外机会", status: "awaiting_approval", tradePlanId: "plan-sol-approval",
    presentation: { nextAction: "等待一次性人工授权" },
    steps: [
      { id: "step-sense", phase: "observe", title: "发现机会", summary: "结构与量能比达标" },
      { id: "step-risk", phase: "risk_checking", title: "硬风控", summary: "12/12 通过" },
      { id: "step-approval", phase: "awaiting_approval", title: "等待确认", summary: "SOL 不在常驻授权范围" }
    ]
  }],
  tradePlans: [{
    id: "plan-sol-approval", agentRunId: "run-sol-approval", status: "awaiting_approval", symbol: "SOL/USDT", direction: "long",
    entry: { range: "142.20–143.10", riskPercent: 0.3 }, entry_range: [142.2, 143.1], stopLoss: 138.8,
    takeProfit: [149.5, 154], leverage: 2, max_loss_pct: 0.3, strategy: "Breakout Retest v3",
    evidenceIds: ["market-sol", "account-snapshot", "mandate-sol"], analysisBundleId: "bundle-sol",
    lastRiskCheck: { id: "risk-sol", passed: true, summary: "12/12 通过", warnings: ["SOL 不会加入常驻白名单"] }
  }],
  traces: [{ id: "trace-sol", agentRunId: "run-sol-approval", evidenceId: "market-sol" }],
  chatMessages: [{
    id: "message-sol-initial", sessionId: "chat-manual", agentRunId: "run-sol-approval", planId: "plan-sol-approval", role: "agent",
    content: "### SOL 结构复核\n结构与量能比达标，但 SOL 不在常驻授权范围。当前尚未下单。",
    createdAt: "2026-08-29T08:00:00.000Z", model: "production-fixture"
  }]
};

const requestedState = new URLSearchParams(location.search).get("state") || "loaded";
const data = parseJsonResponseText(JSON.stringify({ ...fixture, resourceState: { ...fixture.resourceState, chat: requestedState } }));
const calls = { actionRequests: [], downloads: [], confirms: [], chatReads: 0, chatReadResults: 0, chatWrites: 0 };
let messages = fixture.chatMessages.slice();
const sessions = [{ id: "chat-manual", title: "SOL 复核", status: "active", updatedAt: "2026-08-29T08:00:00.000Z" }];

window.__task4Calls = calls;
window.__task4ApprovalMode = "success";
window.__task4TranslationFails = false;
window.__task4MalformedPng = async () => {
  try {
    await exportPosterPng({
      node: document.body,
      filename: "malformed.png",
      fonts: { ready: Promise.resolve() },
      toPng: async () => "data:image/png-invalid;base64,AAAA",
      download: async () => { calls.downloads.push({ prefix: "malformed", filename: "malformed.png" }); }
    });
    return "accepted";
  } catch (error) {
    return error?.message || String(error);
  }
};

function chatPayload(sessionId = "chat-manual") {
  return { sessions, activeSessionId: sessionId, messages: messages.filter((message) => message.sessionId === sessionId), provider: { name: "Production fixture", model: "authority-contract" }, messageScope: "single-session" };
}

function BrowserHarness() {
  const api = useMemo(() => ({
    data,
    action: async (endpoint, payload = {}, method = "POST") => {
      calls.actionRequests.push({ endpoint, payload, method });
      if (method === "GET" && endpoint.startsWith("/api/agent/chat")) {
        calls.chatReads += 1;
        const sessionId = new URL(endpoint, location.origin).searchParams.get("sessionId") || "chat-manual";
        await new Promise((resolve) => setTimeout(resolve, 40));
        calls.chatReadResults += 1;
        return chatPayload(sessionId);
      }
      if (endpoint === "/api/agent/chat") {
        calls.chatWrites += 1;
        const sessionId = payload.sessionId || "chat-manual";
        const userMessage = { id: `user-${calls.chatWrites}`, sessionId, role: "user", content: payload.message, createdAt: "2026-08-29T08:10:00.000Z" };
        const agentMessage = { id: `agent-${calls.chatWrites}`, sessionId, role: "agent", content: `服务器权威回复 ${calls.chatWrites}：继续等待风险边界。`, createdAt: "2026-08-29T08:10:02.000Z", model: "production-fixture" };
        await new Promise((resolve) => setTimeout(resolve, 180));
        messages = [...messages, userMessage, agentMessage];
        return { userMessage, agentMessage };
      }
      if (endpoint === "/api/trade-plans/plan-sol-approval/approve") {
        await new Promise((resolve) => setTimeout(resolve, 220));
        if (window.__task4ApprovalMode === "failure") return { ok: false, error: "risk_blocked" };
        if (window.__task4ApprovalMode === "partial") return { ok: false, error: "execution_not_submitted", httpStatus: 409, plan: { id: "plan-sol-approval", status: "approved" }, approvalGranted: true, executionSubmitted: false, execution: { status: "risk_recheck_failed", reason: "capacity_changed" }, guard: { label: "账户容量已变化", fix: "刷新账户事实" }, message: "批准已消费，但订单未提交。" };
        return { plan: { id: "plan-sol-approval", status: "approved" }, approvalGranted: true, executionSubmitted: true, execution: { status: "entry_pending" }, message: "计划已批准，入场单已提交到交易所。" };
      }
      if (endpoint === "/api/trade-plans/plan-sol-approval/cancel") {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { id: "plan-sol-approval", status: "cancelled" };
      }
      if (endpoint === "/api/posters/translate") {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return window.__task4TranslationFails ? { ok: false, error: "translation_unavailable" } : { translated: "### SOL structure review\nStructure and volume qualify, but SOL is outside the standing mandate. No order has been placed." };
      }
      return { ok: false, error: "unsupported_fixture_action" };
    },
    ensureSection: async () => data,
    notify: () => {},
    download: async (url, filename) => { calls.downloads.push({ prefix: String(url).slice(0, 22), filename }); return { ok: true }; },
    connectionError: ""
  }), []);
  return <><KordynV2Root api={api} lang="zh" /><ConfirmHost /></>;
}

createRoot(document.getElementById("root")).render(<BrowserHarness />);
window.requestAnimationFrame(() => { window.__task4Ready = true; });
