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
      export { MarketAccountPage, EventsTasksPage, KnowledgeSkillsPage, RiskAuthPage, AuditSystemPage, AgentProfilesPanel, AdminPage, ConceptGraph } from "./src/pages.jsx";
      export { resolveApiBase, apiUrl } from "./src/lib.jsx";
      export { ChatPage, DecisionBrief, cleanPresentationText } from "./src/chat.jsx";
      export { ConfigPanel } from "./src/panels.jsx";
      export { AssistantWidget } from "./src/assistant.jsx";
      export { NativeAuthPage } from "./src/landing.jsx";
      export { MobileApp, groupMobileClosedTrades } from "./src/mobile.jsx";
      export { ExecutionLedgerConcept, ExecutionReviewConcept, MandateConcept, WatchMonitorConcept } from "./src/conceptPages.jsx";
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

test("网页版 API 始终同源，不受浏览器残留后端地址影响", () => {
  assert.equal(C.resolveApiBase({ native: false, stored: "http://127.0.0.1:8787", configured: "" }), "");
  assert.equal(C.resolveApiBase({ native: false, stored: "https://old.example.com", configured: "" }), "");
  assert.equal(C.resolveApiBase({ native: false, stored: "https://old.example.com", configured: "https://api.example.com/" }), "https://api.example.com");
  assert.equal(C.resolveApiBase({ native: true, stored: "https://customer.example.com/", configured: "" }), "https://customer.example.com");
  assert.equal(C.resolveApiBase({ native: true, stored: "http://127.0.0.1:8787", configured: "" }), "https://yegidawir.xyz");
});

test("App 登录前只显示精简登录与订阅入口，不渲染 Web 营销页", () => {
  const props = {
    login: async () => {}, registerAccount: async () => {}, toast: "", apiBase: "https://yegidawir.xyz", setApiBase: () => {},
    publicInfo: { registrationEnabled: true, subscriptionPlans: [{ id: "p1", name: "月度订阅", months: 1, priceUsdt: 99 }] }
  };
  const html = renderToString(React.createElement(C.NativeAuthPage, props));
  assert.match(html, /nativeAuthScreen/);
  assert.match(html, /kordyn-logo\.svg/);
  assert.match(html, /登录/);
  assert.match(html, /订阅/);
  assert.match(html, /服务器设置/);
  assert.doesNotMatch(html, /lpFrame|landing\.html|把你的交易书|landingMarketing/);
});

test("AI display cleanup removes process narration without deleting trading facts", () => {
  const cleaned = C.cleanPresentationText("计划已武装。现在汇总全貌。\n\n### 结论\n状态：系统正在等待入场条件，尚未向 OKX 下单。\n依据：BTC 1H 结构保持向上。");
  assert.doesNotMatch(cleaned, /计划已武装|汇总全貌/);
  assert.match(cleaned, /系统正在等待入场条件，尚未向 OKX 下单/);
  assert.match(cleaned, /BTC 1H 结构保持向上/);
  assert.equal(C.cleanPresentationText("状态：计划已登记，等待价格条件。"), "状态：计划已登记，等待价格条件。");
  assert.equal(C.cleanPresentationText("✅ 计划已武装，现在汇总全貌。"), "");
  assert.equal(C.cleanPresentationText("The plan is armed. Now I will summarize the full picture.\n\nConclusion: Wait for confirmation."), "Conclusion: Wait for confirmation.");
});

test("AI conclusion summary uses compact text rows without large bold cards", () => {
  const html = renderToString(React.createElement(C.DecisionBrief, {
    presentation: { layout: "decision_brief", kind: "market_analysis", headline: "本轮无交易计划", symbols: ["BTC/USDT", "SUI/USDT"], decision: { state: "analysis_only", direction: "neutral" } },
    content: "白名单：BTC、SUI、ADA\n总结：大盘偏弱，白名单币种多周期冲突。\n结论：本轮无交易计划，继续观察。"
  }));
  assert.match(html, /richMetric--conclusion/);
  assert.match(html, /richMetricGrid--conclusion/);
  assert.match(html, /白名单/);
  assert.match(html, /总结/);
  assert.match(html, /本轮无交易计划/);
});

test("结构化决策简报以克制叙事展示，不重复堆叠指标卡和引用装饰", () => {
  const presentation = {
    schemaVersion: 1,
    layout: "decision_brief",
    kind: "trade_plan",
    generatedAt: "2026-08-13T02:00:00Z",
    headline: "等待回踩确认，不追多",
    symbol: "BTC/USDT",
    symbols: ["BTC/USDT", "ETH/USDT"],
    decision: { state: "awaiting_approval", direction: "long", role: "day_trader", primaryTimeframe: "1h", hasOrder: false, hasPosition: false },
    nextAction: { code: "approve_or_reject" },
    timeframes: ["15m", "1h", "4h"].map((timeframe) => ({
      timeframe, status: "complete",
      structure: { direction: "long", sequence: "HH/HL", phase: timeframe === "15m" ? "pullback" : "continuation" },
      flow: { priceChangePct: 0.5, oiChangePct: 1.2, fundingEndPct: 0.01, leverageState: "long_build", cvd: 120, flowCoveragePct: 100, divergence: "none" }
    })),
    evidence: { coverage: { passed: 7, total: 7, criticalReady: true, complete: true }, btcRisk: { status: "ok", window: "7d", correlation: 0.91, beta: 1.08 }, eventVolatility: [], supportingFactors: ["1H 结构保持 HH/HL"], conflictingFactors: ["15m 主动买盘仍需确认"] },
    linked: { planId: "tp1" }, watch: null,
    execution: { status: "protecting", quantity: 0.01, notionalUsdt: 650, filledPrice: 65000, protection: { attachedAlgoStop: true } },
    position: { direction: "long", size: 0.01, entryPrice: 65000, markPrice: 65500, unrealizedPnl: 5, leverage: 2 }
  };
  const html = renderToString(React.createElement(C.DecisionBrief, { presentation, content: "### 结论\n> 等待回踩确认，不追多\n\n### 消息面\nALLO 消息面归因暂时失败（Gemini 429 rate limited），本轮不编造催化剂。\n\n### 确认清单\n- [x] 1H 结构保持 HH/HL\n- [ ] 15m CVD 转为主动买入\n\n### 指标对比\n| 周期 | OI | CVD |\n| --- | --- | --- |\n| 15m | +1.2% | 120K |\n\n### 全市场扫描 — 无加白候选\nTop 候选均在白名单外且位置不佳，本轮不加白。" }));
  assert.match(html, /交易计划/);
  assert.match(html, /等待回踩确认，不追多/);
  assert.match(html, /\+1 币种/);
  assert.match(html, /richHeading--summary/);
  assert.match(html, /richMessageGroup--summary/);
  assert.match(html, /richMessageGroup--marketScan/);
  assert.match(html, /richConclusion/);
  assert.doesNotMatch(html, /richQuote|posterQuote|decisionTfGrid|decisionEvidenceGrid|decisionNext/);
  assert.match(html, /richNotice danger/);
  assert.match(html, /richChecklist/);
  assert.match(html, /richCheck checked/);
  assert.match(html, /richTable/);
  assert.match(html, /Top 候选均在白名单外/);
  const liveHtml = renderToString(React.createElement(C.DecisionBrief, {
    presentation,
    content: "### 结论\n交易已完成",
    currentState: "closed",
    currentExecution: { ...presentation.execution, status: "closed", realizedPnl: 8.2 }
  }));
  assert.match(liveHtml, /生成时[\s\S]*当前/);
  assert.match(liveHtml, /已平仓/);
});

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
  analysisBundles: [], reviews: [{ id: "rv1", type: "trade", symbol: "BTC/USDT", direction: "long", status: "completed", title: "BTC 平仓复盘", summary: "真实成交结果摘要", lesson: "下次等待回踩确认后再进场。", deepReflection: "结构方向正确，但入场时机过早；持仓期价格轨迹显示先回踩止损附近再启动。", attribution: "策略", realizedPnl: 12.5, feeUsdt: 0.4, fundingFeeUsdt: -0.1, fillIds: ["f1"], tradeLifecycleKey: "eo1", completedAt: "2026-07-25T01:00:00Z", createdAt: "2026-07-25T00:00:00Z" }],
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
data.watchTriggers = [{ id: "w1", symbol: "BTC/USDT", kind: "price_above", level: 61000, status: "active", note: "突破后重新评估", createdAt: "2026-07-25T00:00:00Z", expiresAt: "2099-07-26T00:00:00Z" }];
data.watchBoard = [{
  symbol: "BTC/USDT", count: 2, analysisId: "run_watch", analysisAt: "2026-07-25T00:05:00Z", analysisTitle: "BTC 1H 结构等待突破确认",
  primary: { id: "w1", symbol: "BTC/USDT", kind: "price_above", level: 61000, direction: "long", displayThesis: "1H 保持 HH/HL，等待突破后评估顺势做多", displayTriggerMeaning: "站稳后复核主动买盘；目前不是入场信号", status: "active", priority: "primary", purpose: "decision", note: "突破后重新评估", createdAt: "2026-07-25T00:00:00Z", expiresAt: "2099-07-26T00:00:00Z" },
  secondary: [{ id: "w2", symbol: "BTC/USDT", kind: "price_below", level: 59000, direction: "long", displayThesis: "1H 保持 HH/HL，等待突破后评估顺势做多", displayTriggerMeaning: "跌破后原做多判断失效", status: "active", priority: "secondary", purpose: "invalidation", note: "跌破则当前多头假设失效", createdAt: "2026-07-25T00:00:00Z", expiresAt: "2099-07-26T00:00:00Z" }]
}];
data.abnormalVolatility = [{ symbol: "BTC/USDT", status: "elevated", riskScore: 78, realizedMovePct: 2.4, caveat: "异常波动风险升高。", caveatEn: "Abnormal-move risk is elevated." }];
data.behaviorProfile = {
  trades: 3,
  overall: { winRatePct: 67, profitFactor: 1.8, expectancyUsdt: 4.2, avgHoldMinutes: 95 },
  scatter: [
    { symbol: "BTC/USDT", direction: "long", holdMinutes: 45, roiPct: 3.2, leverage: 3, pnl: 12.5, win: true, regime: "趋势", closedAt: "2026-07-25T01:00:00Z" },
    { symbol: "BTC/USDT", direction: "short", holdMinutes: 160, roiPct: -1.4, leverage: 5, pnl: -4.2, win: false, regime: "震荡", lossAttribution: "策略", closedAt: "2026-07-24T01:00:00Z" },
    { symbol: "ETH/USDT", direction: "long", holdMinutes: 80, roiPct: 2.1, leverage: 4, pnl: 7.1, win: true, regime: "趋势", closedAt: "2026-07-23T01:00:00Z" }
  ],
  flags: [{ key: "sample", severity: "mid", title: "等待更多样本", detail: "当前仅有 3 笔完整生命周期" }]
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
    AgentProfilesPanel: C.AgentProfilesPanel,
    ChatPage: C.ChatPage
  };
  for (const [name, Comp] of Object.entries(pages)) {
    const html = render(React.createElement(Comp, { data, action, ui }));
    assert.ok(html.length > 100, `${name} 渲染输出过短`);
  }
});

test("new capital flow, review workbench, ledger, and watch page render with realistic data", () => {
  for (const Comp of [C.MandateConcept, C.ExecutionReviewConcept, C.ExecutionLedgerConcept, C.WatchMonitorConcept]) {
    const html = render(React.createElement(Comp, { data, action, ui }));
    assert.ok(html.length > 500);
  }
  const watchHtml = render(React.createElement(C.WatchMonitorConcept, { data, action, ui }));
  assert.match(watchHtml, /做多情景/);
  assert.match(watchHtml, /当前原判断/);
  assert.match(watchHtml, /1H 保持 HH\/HL/);
  assert.match(watchHtml, /命中意味着/);
  assert.match(watchHtml, /失效条件/);
});

test("execution and review renders every workflow zone on one page", () => {
  const html = render(React.createElement(C.ExecutionReviewConcept, { data, action, ui }));
  for (const id of ["attention", "performance", "reviews", "diagnostics", "behavior"]) assert.ok(html.includes(`id="er-${id}"`), `missing single-page zone ${id}`);
  assert.ok(!html.includes("id=\"er-fills\""), "raw fill ledger belongs on its own subpage");
  assert.ok(!html.includes("AI 委托记录"), "raw AI order records belong on their own subpage");
  assert.ok(html.includes("持仓时长与收益率"));
  assert.ok(html.includes("绩效拆解"));
  assert.ok(!html.includes("role=\"tablist\""), "single-page workbench must not hide sections behind tabs");
});

test("orders and fills render together on the dedicated ledger subpage", () => {
  const html = render(React.createElement(C.ExecutionLedgerConcept, { data, action, ui }));
  assert.ok(html.includes("id=\"el-orders\""));
  assert.ok(html.includes("id=\"el-fills\""));
  assert.ok(html.includes("AI 委托记录"));
  assert.ok(html.includes("成交流水"));
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

test("mobile closed-trade ledger excludes entries and incomplete partial closes", () => {
  const closed = C.groupMobileClosedTrades([
    { id: "entry-1", executionOrderId: "life-1", kind: "entry", symbol: "BTC/USDT", direction: "long", feeUsdt: 1, quantity: 1, createdAt: "2026-08-01T00:00:00Z" },
    { id: "partial-1", executionOrderId: "life-1", kind: "close", symbol: "BTC/USDT", direction: "long", partial: true, realizedPnl: -2, feeUsdt: .2, quantity: .4, createdAt: "2026-08-01T01:00:00Z" },
    { id: "final-1", executionOrderId: "life-1", kind: "close", symbol: "BTC/USDT", direction: "long", partial: false, realizedPnl: 8, feeUsdt: .3, quantity: .6, createdAt: "2026-08-01T02:00:00Z" },
    { id: "entry-2", executionOrderId: "life-2", kind: "entry", symbol: "SUI/USDT", direction: "short", quantity: 5, createdAt: "2026-08-02T00:00:00Z" },
    { id: "partial-2", executionOrderId: "life-2", kind: "close", symbol: "SUI/USDT", direction: "short", partial: true, realizedPnl: 3, quantity: 2, createdAt: "2026-08-02T01:00:00Z" }
  ]);
  assert.equal(closed.length, 1);
  assert.equal(closed[0].symbol, "BTC/USDT");
  assert.equal(closed[0].closeCount, 2);
  assert.equal(closed[0].realizedPnl, 6);
  assert.equal(closed[0].netRealizedPnl, 4.5);
});
