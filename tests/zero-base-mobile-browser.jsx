import React from "react";
import { createRoot } from "react-dom/client";
import { AppFrame } from "../src/appFrame.jsx";
import { MobileApp } from "../src/mobile.jsx";
import { productionShellBrowserFixture } from "./production-shell-browser-fixture.js";
import "../src/styles.css";
import "../src/product-foundation.css";
import "../src/zero-base-system.css";

const scenario = new URLSearchParams(window.location.search).get("state") || "loaded";
const fixture = {
  ...productionShellBrowserFixture,
  resourceState: Object.fromEntries(Object.keys(productionShellBrowserFixture.resourceState).map((key) => [key, scenario === "loaded" ? "loaded" : scenario])),
  portfolio: { ...productionShellBrowserFixture.portfolio, todayPnl: 42.5 },
  agentStatus: { state: "watching", nextActions: ["Review plan evidence"] },
  agentRuns: [{ id: "run-1", title: "Market patrol", status: "completed", summary: "No forced action" }],
  watchTriggers: [{ id: "watch-3", symbol: "SOL/USDT", status: "active" }],
  knowledge: {
    sources: [{ id: "source-1", title: "Market structure", status: "ready" }],
    tradingMethods: [], tradingSkills: [], ruleProposals: [], candidates: [], workflows: []
  },
  ownerReviewLoop: { summary: {}, improvements: [], lessons: [{ id: "lesson-1", status: "candidate", title: "Wait for confirmation", content: "Use only in matching regimes" }] }
};

const noop = () => {};
const patrolMessage = {
  id: "msg-patrol-1", role: "agent", sessionId: "chat_autocycle", createdAt: "2026-08-26T01:10:00.000Z",
  content: "### 巡检结论\nBTC 仍在计划范围内，证据覆盖完整，当前维持观察并等待确认。",
  capabilityCoverage: {
    ok:true, covered:6, required:6, missing:[], checkedAt:"2026-08-26T01:11:00.000Z",
    whitelist:{ analyzed:2, expected:2, symbols:["BTC/USDT","ETH/USDT"] },
    watches:{ analyzed:1, expected:1, symbols:["BTC/USDT"] },
    marketScan:{ completed:true, universe:431, candidates:8, error:null },
    externalCandidates:[{ symbol:"SOL/USDT", side:"long", analyzed:true }]
  },
  toolCallSummary:{ totalCalls:3, modelCalls:1, preflightCalls:2 },
  toolTrace:[{ name:"scan_market_opportunities", summary:"扫描 431 个合约", latencyMs:31, origin:"system_preflight" }],
  presentation:{ headline:"等待 BTC 突破后回踩确认", linked:{} }
};
const analysisMessage = {
  id:"msg-analysis-1", role:"agent", sessionId:"chat-manual", createdAt:"2026-08-26T01:20:00.000Z",
  content:"### 市场结论\nBTC 结构保持完整，但当前价格接近计划边界。证据尚不足以支持追价，建议继续观察成交量与回踩确认，并保持既有风险上限不变。若关键价位失效，应先撤销原计划，再根据新的市场结构重新评估，不以短期波动代替完整证据。",
  toolTrace:[], presentation:{ linked:{} }
};
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/api/agent/chat")) return new Response(JSON.stringify({ messages:[patrolMessage, analysisMessage], sessions:[], activeSessionId:"chat-manual", provider:{ name:"Production fixture", model:"real-component-contract" } }), { status:200, headers:{ "Content-Type":"application/json" } });
  return nativeFetch(input, init);
};
const api = {
  data: fixture,
  action: async (...args) => { (window.__zeroBaseMobileActions ||= []).push(args); return { ok: true }; },
  toast: "",
  busy: false,
  notify: (message) => { (window.__zeroBaseMobileNotices ||= []).push(message); },
  download: noop,
  refresh: async () => { window.__zeroBaseMobileRefresh = true; },
  ensureSection: (...args) => { (window.__zeroBaseMobileEnsure ||= []).push(args); },
  connectionError: ""
};

createRoot(document.getElementById("root")).render(<AppFrame authenticated><MobileApp api={api} lang="en" switchLang={noop}/></AppFrame>);
window.__zeroBaseMobileBrowserReady = true;
