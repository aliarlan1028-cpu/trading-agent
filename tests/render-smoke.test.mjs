// 渲染冒烟测试：esbuild 打包前端组件 + renderToString 逐页/逐 tab/逐面板渲染。
// 背景：vite build 抓不到未导入的 JSX 标识符（曾因 pages.jsx 缺 Trash2 导致全站白屏，commit 3ebbf9c）。
// 本测试用真实形状的 fixture 数据把桌面页、移动端、面板全部渲染一遍，ReferenceError/数据形状崩溃在 CI 即暴露。
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// —— 浏览器全局 stub（renderToString 不跑 effect，不需要 document）——
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  location: { origin: "http://localhost", host: "localhost", protocol: "http:" },
  localStorage: globalThis.localStorage,
  addEventListener: () => {},
  removeEventListener: () => {},
  confirm: () => false,
  setTimeout,
  clearTimeout
};

const React = require("react");
const { renderToString } = require("react-dom/server");

// 打字机等基于 setInterval 的 hook 在 SSR 下不运行，无需 stub timer 细节。
// KnowledgeSkillsPage 的 tab 初始值是 useState("methods")——为逐 tab 渲染，把该初始值替换为目标 tab。
const origUseState = React.useState;
let TAB_OVERRIDE = null;
React.useState = function (init) {
  if (TAB_OVERRIDE && init === "methods") return origUseState.call(this, TAB_OVERRIDE);
  return origUseState.call(this, init);
};

// —— esbuild 打包（react 外置，保证与本测试同一实例）——
const esbuild = require("esbuild");
// bundle 必须落在仓库内(而非系统 tmp)，external 的 react 才能沿 node_modules 解析到。
const cacheDir = path.join(rootDir, "node_modules", ".cache", "render-smoke");
fs.mkdirSync(cacheDir, { recursive: true });
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
esbuild.buildSync({
  stdin: {
    contents: `
      export { MarketAccountPage, EventsTasksPage, KnowledgeSkillsPage, RiskAuthPage, AuditSystemPage, ReviewPage, AgentProfilesPanel, AdminPage, ConceptGraph } from "./src/pages.jsx";
      export { ChatPage } from "./src/chat.jsx";
      export { ConfigPanel } from "./src/panels.jsx";
      export { AssistantWidget } from "./src/assistant.jsx";
      export { MobileApp } from "./src/mobile.jsx";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  outfile: outFile,
  logLevel: "silent"
});
const C = require(outFile);

// —— 真实形状 fixture：技能覆盖全部 11 个状态、概念含重名（触发去重）、计划/执行单覆盖典型状态 ——
function skill(id, status, extra = {}) {
  return {
    id, lineageKey: `src:${id}:long`, name: `技能${id}`, version: 1, status,
    executable: status === "active", sourceMethodId: "m1", sourceId: "s1", sourceTitle: "海龟交易法则", sourceType: "pdf",
    spec: { schemaVersion: 1, templateId: "breakout", templateLabel: "突破", lowTrust: id === "k2", direction: "long", timeframe: "1h", params: {}, marketRegimes: ["上行趋势"] },
    compileErrors: status === "compile_failed" ? ["缺少明确入场条件"] : [],
    compileWarnings: [], fingerprint: `fp_${id}`,
    validation: ["historical_validated", "paper_validating", "paper_validated", "active"].includes(status)
      ? { methodology: "40/30/30 chronological holdout", train: { trades: 12 }, validation: { trades: 5 }, test: { trades: 4 } } : null,
    liveMetrics: status === "active" ? { trades: 10, winRatePct: 60, profitFactor: 1.4 } : null,
    lifecycle: [], createdAt: "2026-07-01T00:00:00Z", updatedAt: "2026-07-20T00:00:00Z", ...extra
  };
}
const STATUSES = ["compile_failed", "compiled", "historical_rejected", "historical_validated", "paper_validating", "paper_rejected", "paper_validated", "active", "degraded", "superseded", "retired"];
const data = {
  user: { id: "u1", name: "测试", email: "t@example.com", isOwner: true },
  users: [], tenants: [], subscriptionPlans: [], subscriptions: [], paymentRequests: [],
  system: { autonomyEnabled: true, killSwitch: false, liveTradingEnabled: false, apiHealth: "正常", riskStatus: "正常", dailyLossCapUsdt: 100, remainingDailyLossUsdt: 80 },
  agentStatus: { state: "observing", activeMandate: { id: "md1", status: "active", exchanges: ["OKX"], allowedSymbols: ["BTC/USDT"], maxLeverageBySymbol: { "BTC/USDT": 5 }, maxDailyLossPct: 2 } },
  agentProfiles: [{ id: "p1", name: "主交易员", role: "trader", enabled: true, order: 1 }],
  portfolio: { totalEquityUsdt: 10000, availableBalanceUsdt: 8000, frozenMarginUsdt: 100, todayPnl: 12.5, todayPnlPct: 0.12, weekPnl: 30, unrealizedPnl: 5, riskLabel: "低风险" },
  markets: [{ symbol: "BTC/USDT", price: 60000, changePct: 1.2, high24h: 61000, low24h: 59000, status: "synced", candles: Array.from({ length: 60 }, (_, i) => ({ time: i * 3600000, open: 60000, high: 60100, low: 59900, close: 60050, volume: 10 })), candlesTimeframe: "1h" }],
  watchlist: ["BTC/USDT"], activeMarket: { symbol: "BTC/USDT", price: 60000 },
  positions: [{ symbol: "BTC/USDT", direction: "long", size: 0.1, entry: 59000, mark: 60000, pnl: 100, roiPct: 1.7, leverage: 3 }],
  mandates: [{ id: "md1", status: "active", exchanges: ["OKX"], allowedSymbols: ["BTC/USDT"], maxDailyLossPct: 2, humanApprovalNotionalUsdt: 500 }],
  tradePlans: [
    { id: "tp1", symbol: "BTC/USDT", direction: "long", status: "awaiting_approval", strategy: "trend_following", entry_range: [59000, 59500], stop_loss: 58000, take_profit: [61000], leverage: 3, max_loss_pct: 0.5, createdAt: "2026-07-25T00:00:00Z" },
    { id: "tp2", symbol: "BTC/USDT", direction: "short", status: "risk_rejected", createdAt: "2026-07-24T00:00:00Z" }
  ],
  events: [{ id: "ev1", title: "CPI 公布", severity: "high", status: "open", createdAt: "2026-07-25T00:00:00Z", timeline: [], topicTags: ["宏观"] }],
  tasks: [{ id: "t1", name: "自主巡检", schedule: "Every 15m", enabled: true, status: "active" }],
  knowledge: {
    sources: [{ id: "s1", title: "海龟交易法则", type: "pdf", status: "parsed" }, { id: "s2", title: "以交易为生", type: "book_title", status: "parsed" }],
    chunks: [{ id: "c1", sourceId: "s1" }, { id: "c2", sourceId: "s2" }],
    tradingMethods: [
      { id: "m1", name: "唐奇安突破", marketRegime: "上行趋势", symbolScope: "BTC", timeframe: "1H", direction: "long", entry: "突破20日高", stop: "2%", takeProfit: "2R", source: { id: "s1", title: "海龟交易法则" } },
      { id: "m2", name: "均线回踩", marketRegime: "通用", timeframe: "4H", direction: "both", entry: "回踩均线", stop: "1.5%", takeProfit: "3R", source: { id: "s2", title: "以交易为生" } }
    ],
    tradingSkills: STATUSES.map((st, i) => skill(`k${i + 1}`, st)),
    ruleProposals: [
      { id: "r1", name: "重大事件前禁止开仓", category: "事件", status: "已批准", description: "CPI 前 2 小时停止开仓", action: "pause_opening", level: "L3" },
      { id: "r2", name: "单笔风险不超过2%", category: "账户", status: "待审批", description: "每笔最大亏损 2%", action: "block", level: "L4" },
      { id: "r3", name: "重要数据公布前暂停交易", category: "事件", status: "待审批", description: "重大数据前暂停", action: "pause_opening", level: "L3" }
    ],
    conceptCards: [
      { id: "cc1", name: "趋势", category: "技术", relatedTo: ["突破"], tradingMeaning: "顺势" },
      { id: "cc2", name: "突破", category: "技术", relatedTo: [], tradingMeaning: "越过关键位" },
      { id: "cc3", name: "趋势", category: "技术", relatedTo: ["止损"], tradingMeaning: "" }, // 重名 → 去重合并
      { id: "cc4", name: "止损", category: "风控", relatedTo: [], tradingMeaning: "预设离场" }
    ],
    skillInvocations: [], skillAttributions: []
  },
  skills: [{ id: "sk1", name: "复盘助手", version: "1.0", status: "已启用", native: false, scan: "已扫描" }],
  tools: [], mcpServers: [{ id: "mcp1", name: "示例", status: "disconnected" }],
  traces: [{ id: "tr1", kind: "agent_chat", label: "测试", status: "ok", createdAt: "2026-07-25T00:00:00Z" }],
  auditLogs: [{ id: "a1", action: "测试审计", createdAt: "2026-07-25T00:00:00Z", actor: "系统" }],
  analysisBundles: [], reviews: [{ id: "rv1", summary: "测试复盘", createdAt: "2026-07-25T00:00:00Z" }],
  exchangeAccounts: [{ id: "ex1", exchange: "OKX", readEnabled: true, tradeEnabled: false, withdrawEnabled: false, ipWhitelist: "1.2.3.4" }],
  apiKeyMetadata: [{ exchange: "OKX", hasApiKey: true, hasSecret: true, withdrawPermission: false, permissionVerifiedAt: "2026-07-20T00:00:00Z" }],
  accountSnapshots: [{ id: "sn1", status: "ok", createdAt: "2026-07-26T00:00:00Z" }],
  orders: [], fills: [],
  riskRules: [{ id: "rr1", name: "单日亏损上限", scope: "账户", enabled: true }],
  riskChecks: [{ id: "rc1", decision: "allowed", createdAt: "2026-07-25T00:00:00Z" }],
  riskIncidents: [{ id: "ri1", severity: "high", status: "open", title: "测试告警", createdAt: "2026-07-25T00:00:00Z" }],
  realtimeConnections: [{ id: "ws1", status: "connected", exchange: "OKX" }],
  marketRegime: { global: { label: "多头趋势" }, smartMoney: { label: "偏多" } },
  marketMovers: { movers: [{ symbol: "PEPE/USDT", changePct: 20, quoteVolUsdt: 5000000, last: 0.001 }], scannedAt: "2026-07-26T10:00:00Z" },
  positionEscort: { positions: [], note: "当前无持仓，护航休眠", at: "2026-07-26T10:00:00Z" },
  realtimeStarted: true, marketStream: { started: true },
  pendingActions: [{ id: "pa1", status: "awaiting_confirmation", title: "确认减仓" }],
  reconciliationReports: [], jobRuns: [], notifications: [], alerts: [], drillRuns: [], grayReleasePolicies: [],
  llmRuns: [], tradeIntents: [], executionOrders: [
    { id: "eo1", status: "protecting", symbol: "BTC/USDT", planId: "tp1" },
    { id: "eo2", status: "filled", symbol: "BTC/USDT" }
  ],
  exchangeOrders: [], reviewReports: [], toolExecutions: [], eventSources: [], skillRuns: [],
  agentStateFiles: [], memoryItems: [], agentRuns: [{ id: "ar1", status: "completed", goal: "测试", source: "cycle", createdAt: "2026-07-25T00:00:00Z", steps: [] }],
  performance: { trades: 5, winRatePct: 60, profitFactor: 1.5, openExecutions: 1 },
  backtests: [], strategyProfiles: [], paperReport: { sessions: [] },
  portfolioRisk: {}, larkConfigured: false, telegramConfigured: false,
  mcpStatus: { connected: 0 }, embeddingStatus: { mode: "lexical", totalChunks: 2, embeddedChunks: 0, coveragePct: 0 },
  reviewAnalytics: { breakdowns: {}, cost: {}, attribution: {} },
  runtimeConfig: {}, config: { exchange: { okx: { hasKey: true }, binance: {} }, integrations: {}, llm: {}, liveTrading: {}, runtime: {} },
  readiness: { checks: [], configurationCompletionPct: 40, operatingStage: { id: "observation", label: "观察模式可用", tone: "warning" } },
  publicRegistrationEnabled: false
};

const ui = { openPanel: () => {}, closePanel: () => {}, setActive: () => {}, notify: () => {}, download: () => {}, refresh: () => {} };
const action = async () => ({});
const render = (el) => renderToString(el);

test("desktop pages render with realistic data (all statuses)", () => {
  const pages = {
    MarketAccountPage: C.MarketAccountPage,
    EventsTasksPage: C.EventsTasksPage,
    RiskAuthPage: C.RiskAuthPage,
    AuditSystemPage: C.AuditSystemPage,
    ReviewPage: C.ReviewPage,
    AgentProfilesPanel: C.AgentProfilesPanel,
    ChatPage: C.ChatPage
  };
  for (const [name, Comp] of Object.entries(pages)) {
    const html = render(React.createElement(Comp, { data, action, ui }));
    assert.ok(html.length > 100, `${name} 渲染输出过短`);
  }
});

test("knowledge page renders every tab (methods/skills/rules/graph/ext)", () => {
  for (const tab of ["methods", "skills", "rules", "graph", "ext"]) {
    TAB_OVERRIDE = tab;
    try {
      const html = render(React.createElement(C.KnowledgeSkillsPage, { data, action, ui }));
      assert.ok(html.length > 100, `knowledge tab=${tab} 渲染输出过短`);
    } finally {
      TAB_OVERRIDE = null;
    }
  }
});

test("concept graph dedupes duplicate names and renders", () => {
  const html = render(React.createElement(C.ConceptGraph, { concepts: data.knowledge.conceptCards }));
  // 重名"趋势"合并后只应出现一个节点文本(每个节点一个 <text>)
  const count = (html.match(/趋势/g) || []).length;
  assert.ok(count >= 1, "概念图谱应包含趋势节点");
  assert.ok(html.includes("止损"), "合并后关系并集应保留 止损 节点");
});

test("config panels render for every live key", () => {
  const keys = ["mandate", "riskRules", "ip", "eventRule", "knowledgeImport", "knowledgeList", "ruleLibrary", "skillImport", "taskManager", "eventSources", "auditChain", "executionDetail"];
  for (const key of keys) {
    const html = render(React.createElement(C.ConfigPanel, { panel: key, data, action, ui }));
    assert.ok(html.length > 50, `panel=${key} 渲染输出过短`);
  }
});

test("mobile app and assistant render", () => {
  const api = { data, action, toast: "", busy: false, notify: () => {}, download: () => {}, refresh: () => {} };
  const mobile = render(React.createElement(C.MobileApp, { api }));
  assert.ok(mobile.length > 100, "MobileApp 渲染输出过短");
  const asst = render(React.createElement(C.AssistantWidget, { data }));
  assert.ok(asst.length > 20, "AssistantWidget 渲染输出过短");
});
