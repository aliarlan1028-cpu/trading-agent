// 渲染冒烟测试：esbuild 打包前端组件 + renderToString 逐页/逐 tab/逐面板渲染。
// 背景：vite build 抓不到未导入的 JSX 标识符；这里直接打包并渲染当前真实工作区组件。
// 本测试用真实形状的 fixture 数据把桌面页、移动端、面板全部渲染一遍，ReferenceError/数据形状崩溃在 CI 即暴露。
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
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
      export { ConceptGraph } from "./src/conceptGraph.jsx";
      export { AiTraderCenter, TradingCenter, ResearchCenter, RiskCenter, OperationsCenter } from "./src/workspacePages.jsx";
      export { resolveApiBase, apiUrl, automationPresentation } from "./src/lib.jsx";
      export { setLang } from "./src/i18n.js";
      export { ChatPage, DecisionBrief, PlanCard, ToolTrace, buildCurrentExecutionSnapshot, cleanPresentationText } from "./src/chat.jsx";
      export { ConfigPanel } from "./src/panels.jsx";
      export { AssistantWidget } from "./src/assistant.jsx";
      export { NativeAuthPage } from "./src/landing.jsx";
      export { MobileApp, NavDrawer, MobileCapabilities, MobileBacktestResearch, MobileExecution, MobileStrategy, MobileTasks, MobileIntelligence, MobilePairSheet, MobileRiskPermissionEditor, buildMobileRiskPermissionPayload, submitMobileRiskChange, loadMobileInstrumentList, refreshMobileEventCalendar, refreshMobileIntelligence, shiftMobileCalendarSelection } from "./src/mobile.jsx";
      export { ExecutionLedgerConcept, ExecutionReviewConcept, IntelligenceConcept, KnowledgeConcept, LiveConcept, MandateConcept, OperationsOverviewConcept, RiskPostureConcept, SettingsConcept, WatchMonitorConcept, TradingOverviewConcept, PositionsConcept } from "./src/conceptPages.jsx";
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

test("App 登录前只显示精简登录与注册入口，不渲染 Web 营销页", () => {
  const props = {
    login: async () => {}, registerAccount: async () => {}, toast: "", apiBase: "https://yegidawir.xyz", setApiBase: () => {},
    publicInfo: { registrationEnabled: true, subscriptionPlans: [{ id: "p1", name: "月度订阅", months: 1, priceUsdt: 99 }] }
  };
  const html = renderToString(React.createElement(C.NativeAuthPage, props));
  assert.match(html, /nativeAuthScreen/);
  assert.match(html, /kordyn-logo\.svg/);
  assert.match(html, /登录/);
  assert.match(html, /注册/);
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

test("AI display cleanup hides evidence IDs, humanizes enums, and preserves correction time", () => {
  const original = "4h 标记 leverage_build_up，现价 123[fresh·ev:ticker:BTC/USDT:2026-08-14T13:59:04.538Z]，[fresh/passed·ev:structure:BTC/USDT:2026-08-14T13:59:09.221Z]，4H LH/LL · BOS down @63280，short_covering，bullish_price_cvd。事实守卫（ev:ticker:BTC/USDT:2026-08-14T13:59:04.538Z，2026/8/14 21:59:04 UTC+8）。〔已按 ev:ticker:BTC/USDT:2026-08-14T13:59:59.261Z 更正；2026/8/14 21:59:59（UTC+8）〕";
  const audit = { content: original, violations: [{ evidenceId: "ev:ticker:BTC/USDT:2026-08-14T13:59:04.538Z" }] };
  const cleaned = C.cleanPresentationText(audit.content);
  assert.doesNotMatch(cleaned, /ev:|evb_|leverage_build_up|short_covering|bullish_price_cvd|LH\/LL|BOS down/);
  assert.match(cleaned, /杠杆堆积但价格尚未确认/);
  assert.match(cleaned, /数据为最新/);
  assert.match(cleaned, /数据新鲜度与校验均通过/);
  assert.match(cleaned, /跌破结构位 63280/);
  assert.match(cleaned, /校正于 2026\/8\/14 21:59:59（UTC\+8）/);
  assert.equal(audit.content, original, "presentation cleanup must not mutate stored content");
  assert.equal(audit.violations[0].evidenceId, "ev:ticker:BTC/USDT:2026-08-14T13:59:04.538Z", "audit violations must remain intact");
});

test("AI display cleanup humanizes unavailable evidence states without empty evidence punctuation", () => {
  const original = "**事实守卫**：OKX 当前价格无法确认（证据 ev:ticker:BTC/USDT:2026-08-14T13:59:04.538Z，状态 stale/failed）。\n现价不可用[stale/failed·ev:ticker:BTC/USDT:2026-08-14T13:59:04.538Z]；深度数据状态 missing，接口状态 error。";
  const cleaned = C.cleanPresentationText(original);
  assert.doesNotMatch(cleaned, /ev:|stale|failed|missing|error|证据\s*[，,]/i);
  assert.match(cleaned, /事实校验/);
  assert.match(cleaned, /状态 数据陈旧且获取失败/);
  assert.match(cleaned, /现价不可用（数据陈旧且获取失败）/);
  assert.match(cleaned, /数据缺失/);
  assert.match(cleaned, /获取出错/);
  assert.equal(original.includes("ev:ticker"), true, "stored input remains untouched");
});

test("AI display cleanup does not translate ordinary English trading prose", () => {
  const prose = "The breakout failed because momentum was missing; wait for a fresh setup after the error is resolved.";
  assert.equal(C.cleanPresentationText(prose), prose);
});

test("AI display cleanup uses English labels in English mode", () => {
  C.setLang("en");
  try {
    const cleaned = C.cleanPresentationText("4H LH/LL · BOS down @63280, leverage_build_up [fresh·ev:ticker:BTC/USDT:2026-08-14T13:59:04.538Z]");
    assert.match(cleaned, /lower highs and lower lows/);
    assert.match(cleaned, /bearish structure break at 63280/);
    assert.match(cleaned, /leverage is building without price confirmation/);
    assert.match(cleaned, /data is fresh/);
    assert.doesNotMatch(cleaned, /[\u3400-\u9fff]/);
  } finally {
    C.setLang("zh");
  }
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

test("自主巡检能力覆盖以一行紧凑摘要展示，原始工具详情保持折叠", () => {
  const html = renderToString(React.createElement(C.ToolTrace, {
    trace: [
      { name: "scan_market_opportunities", summary: "全市场扫 431 个", latencyMs: 120, origin: "model" },
      { name: "analyze_market_structure", summary: "预检 BTC", latencyMs: 80, origin: "system_preflight" }
    ],
    callSummary: { totalCalls: 2, modelCalls: 1, preflightCalls: 1 },
    coverage: {
      covered: 16, required: 16,
      whitelist: { analyzed: 4, expected: 4 },
      watches: { analyzed: 3, expected: 3 },
      marketScan: { completed: true, universe: 431 },
      externalCandidates: [{ symbol: "DOGE/USDT", analyzed: true }, { symbol: "ETH/USDT", analyzed: true }]
    }
  }));
  assert.match(html, /本轮证据检查 16\/16/);
  assert.match(html, /模型主动 1/);
  assert.match(html, /系统预检 1/);
  assert.match(html, /白名单 4\/4/);
  assert.match(html, /全市场 431/);
  assert.match(html, /视野外复核 2\/2/);
  assert.doesNotMatch(html, /全市场扫 431 个/, "详情默认应折叠，不能重新堆满首屏");
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
  assert.match(html, /回复生成时仓位快照/, "undefined live override must fall back to the saved presentation position snapshot");
  const liveHtml = renderToString(React.createElement(C.DecisionBrief, {
    presentation,
    content: "### 结论\n交易已完成",
    currentState: "closed",
    currentExecution: { ...presentation.execution, status: "closed", realizedPnl: 8.2 }
  }));
  assert.match(liveHtml, /生成时[\s\S]*当前/);
  assert.match(liveHtml, /已平仓/);

  const feeFlipData = {
    executionOrders: [{ id: "eo-fee", planId: "plan-fee", status: "closed", realizedPnl: 1, quantity: 1, notionalUsdt: 100 }],
    closedTradeLifecycles: [{ tradeLifecycleKey: "eo-fee", executionOrderId: "eo-fee", realizedPnl: 1, netRealizedPnl: -0.2, entryFeeUsdt: 0.8, feeUsdt: 0.4 }],
    fills: [
      { id: "entry-fee", executionOrderId: "eo-fee", tradePlanId: "plan-fee", kind: "entry", price: 100, quantity: 1, feeUsdt: 0.8 },
      { id: "close-fee", executionOrderId: "eo-fee", tradePlanId: "plan-fee", kind: "close", realizedPnl: 1, feeUsdt: 0.4 }
    ]
  };
  const currentExecution = C.buildCurrentExecutionSnapshot(feeFlipData, { executionOrderId: "eo-fee", planId: "plan-fee" });
  assert.equal(currentExecution.grossRealizedPnl, 1);
  assert.ok(Math.abs(currentExecution.netRealizedPnl + 0.2) < 1e-9);
  assert.ok(Math.abs(currentExecution.realizedPnl + 0.2) < 1e-9);
  const dynamicHtml = renderToString(React.createElement(C.DecisionBrief, {
    presentation: { ...presentation, linked: { executionOrderId: "eo-fee", planId: "plan-fee" } },
    content: "### 结论\n交易已完成",
    currentState: "closed",
    currentExecution,
    currentPosition: null
  }));
  assert.match(dynamicHtml, /净已实现盈亏/);
  assert.match(dynamicHtml, /-0\.20/);
  assert.match(dynamicHtml, /class="mono negative"/);
  assert.doesNotMatch(dynamicHtml, /当前真实仓位|回复生成时仓位快照/, "an explicit null live position must hide a position that no longer exists");

  const planHtml = renderToString(React.createElement(C.PlanCard, {
    plan: { id: "plan-fee", symbol: "BTC/USDT", direction: "long", status: "completed", lastRiskCheck: { checks: [] } },
    executionOrder: feeFlipData.executionOrders[0], data: { ...feeFlipData, armedSetups: [], system: {} },
    action, ui, markets: []
  }));
  assert.match(planHtml, /净盈亏/);
  assert.match(planHtml, /-0\.20/);
  assert.doesNotMatch(planHtml, /价格毛盈亏[\s\S]*1\.00/);

  const boundedSnapshot = C.buildCurrentExecutionSnapshot({ ...feeFlipData, closedTradeLifecycles: [] }, { executionOrderId: "eo-fee", planId: "plan-fee" });
  assert.equal(boundedSnapshot.netRealizedPnl, null, "an explicit server lifecycle array must disable reconstruction from bounded fills");
  assert.equal(boundedSnapshot.grossRealizedPnl, 1);
  assert.equal(boundedSnapshot.financialBasis, "gross_only_costs_unreconciled");
  const boundedHtml = renderToString(React.createElement(C.DecisionBrief, { presentation, content: "交易已完成", currentState: "closed", currentExecution: boundedSnapshot, currentPosition: null }));
  assert.match(boundedHtml, /价格毛盈亏/);
  assert.match(boundedHtml, /成本待对账/);
  assert.doesNotMatch(boundedHtml, /净已实现盈亏/);

  const serverSnapshot = C.buildCurrentExecutionSnapshot({
    ...feeFlipData,
    closedTradeLifecycles: [{ tradeLifecycleKey: "eo-fee", executionOrderId: "eo-fee", realizedPnl: 4, netRealizedPnl: -2, entryFeeUsdt: 3, feeUsdt: 3 }]
  }, { executionOrderId: "eo-fee", planId: "plan-fee" });
  assert.equal(serverSnapshot.grossRealizedPnl, 4);
  assert.equal(serverSnapshot.netRealizedPnl, -2, "a matching server lifecycle must override bounded fill reconstruction");
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
      { id: "cc1", name: "趋势", category: "技术", relatedTo: ["突破"], tradingMeaning: "顺势", sourceRefs: ["s1"] },
      { id: "cc2", name: "突破", category: "技术", relatedTo: [], tradingMeaning: "越过关键位", sourceRefs: ["s1"] },
      { id: "cc3", name: "趋势", category: "技术", relatedTo: ["止损"], tradingMeaning: "", sourceRefs: ["s2"] }, // 重名 → 去重合并
      { id: "cc4", name: "止损", category: "风控", relatedTo: [], tradingMeaning: "预设离场", sourceRefs: ["s2"] }
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
    AiTraderCenter: C.AiTraderCenter,
    TradingCenter: C.TradingCenter,
    ResearchCenter: C.ResearchCenter,
    RiskCenter: C.RiskCenter,
    OperationsCenter: C.OperationsCenter
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

test("risk overview renders authoritative event windows instead of generic risk incidents", () => {
  const riskData = {
    ...data,
    automationState: { mode: "reduce_only", label: "暂停新开仓", requestedMode: "full_auto", blockers: ["账户核算基线或费用对账未完成"] },
    eventRiskWindows: [{ id: "cpi", title: "CPI 公布", sourceName: "U.S. BLS", dueAt: "2026-08-16T12:30:00Z", deltaMs: 600000, phase: "pre_release_blackout", blocking: true, impact: 100, marketWide: true }],
    riskIncidents: [{ id: "recon", title: "账户对账异常", status: "open", severity: "high" }]
  };
  const html = render(React.createElement(C.RiskPostureConcept, { data: riskData, action, ui }));
  assert.match(html, /事件风险窗口/);
  assert.match(html, /CPI 公布/);
  assert.match(html, /公布前静默/);
  assert.match(html, /1 个正在阻断/);
  assert.doesNotMatch(html, /账户对账异常/);
  assert.doesNotMatch(html, /应急操作/);
  assert.doesNotMatch(html, /密钥安全/);
  assert.doesNotMatch(html, /账户安全|打开 OKX 配置/);
});

test("unified automation presentation separates the saved target from the effective safety state", () => {
  const view = C.automationPresentation({
    automationState: {
      mode: "reduce_only",
      label: "暂停新开仓",
      requestedMode: "full_auto",
      runtimeStatus: "opening_paused",
      resumesAutomatically: true,
      blockerDetails: [{ code: "financial_reconciliation_pending", label: "账户核算基线或费用对账未完成" }]
    },
    system: { autonomyEnabled: false, reduceOnlyMode: true }
  });
  assert.equal(view.label, "暂停新开仓");
  assert.equal(view.targetLabel, "自动交易");
  assert.equal(view.entryPolicy, "禁止新开仓");
  assert.equal(view.targetIsEffective, false);
  assert.deepEqual(view.blockers, ["账户核算基线或费用对账未完成"]);
  assert.equal(view.runtimeStatus, "opening_paused");
  assert.equal(view.openingPaused, true);
  assert.equal(view.resumesAutomatically, true);
  assert.equal(view.recoveryLabel, "原因解除后自动恢复");
  assert.equal(view.primaryBlocker, "账户核算基线或费用对账未完成");
  assert.equal("reduceOnlyControlState" in view, false, "产品层不再暴露第四种手工模式");
});

test("current runtime card does not repeat the same opening pause as a second badge", () => {
  const runtimeData = {
    ...data,
    automationState: {
      mode: "reduce_only", label: "暂停新开仓", requestedMode: "full_auto", runtimeStatus: "opening_paused",
      blockerDetails: [{ code: "financial_reconciliation_pending", label: "账户核算基线或费用对账未完成" }]
    }
  };
  const html = render(React.createElement(C.MandateConcept, { data: runtimeData, action, ui }));
  assert.match(html, /当前运行状态/);
  assert.match(html, /暂停新开仓/);
  assert.doesNotMatch(html, /禁止新开仓/);
});

test("operations overview receives audit readiness and labels it as the hash chain", () => {
  const html = render(React.createElement(C.OperationsOverviewConcept, {
    data: {
      ...data,
      system: { ...data.system, apiHealth: "正常" },
      realtimeStarted: true,
      markets: [{ symbol: "BTC/USDT", updatedAt: new Date().toISOString() }],
      accountSnapshots: [{ id: "snap", status: "ok" }],
      readiness: { checks: [{ key: "audit_chain", configured: true }] }
    },
    action,
    ui
  }));
  assert.match(html, /审计链校验/);
  assert.match(html, /哈希链/);
  assert.doesNotMatch(html, /前后端契约/);
  assert.doesNotMatch(html, /待同步/);
});

test("analysis-only setup failures are not presented as a trading safety pause", () => {
  const view = C.automationPresentation({
    automationState: {
      mode: "analysis_blocked",
      label: "分析暂不可用",
      requestedMode: "observe",
      runtimeStatus: "analysis_unavailable",
      blockers: ["未配置 LLM"]
    },
    system: { requestedOperatingMode: "observe", autonomyEnabled: true }
  });
  assert.equal(view.targetLabel, "只分析");
  assert.equal(view.entryPolicy, "只分析 · 不下单");
  assert.equal(view.openingPaused, false);
  assert.equal(view.recoveryLabel, "配置模型后恢复分析");
});

test("chat and trading overview show the effective opening pause instead of a fourth operating mode", () => {
  const runtimeData = {
    ...data,
    system: { ...data.system, autonomyEnabled: true, reduceOnlyMode: true, manualReduceOnly: false },
    automationState: { mode: "reduce_only", label: "暂停新开仓", requestedMode: "full_auto", runtimeStatus: "opening_paused", detail: "账户核算基线或费用对账未完成" }
  };
  const chat = render(React.createElement(C.ChatPage, { data: runtimeData, action, ui }));
  assert.doesNotMatch(chat, /agRunBadge/, "AI 交易员内部不应重复顶部的全局运行状态");
  assert.doesNotMatch(chat, /调整运行模式/, "运行方式只在全局顶部和资金边界页管理");
  assert.doesNotMatch(chat, /暂停自主|启动自主交易|只减仓/);

  const overview = render(React.createElement(C.TradingOverviewConcept, { data: runtimeData, action, ui }));
  assert.match(overview, /当前运行/);
  assert.match(overview, /暂停新开仓/);
  assert.match(overview, /禁止新开仓/);
  assert.doesNotMatch(overview, /只减仓/);
});

test("Agent rail explains the Gemini, evidence, DeepSeek, and hard-risk chain from real facts", () => {
  const decisionData = {
    ...data,
    agentRuns: [{
      id: "run-decision", modelArchitecture: "gemini_primary_deepseek_critic",
      primaryAttribution: { actualModel: "google/gemini-3.1-pro-preview", actualProvider: "Google AI Studio", providerAttributionVerified: true },
      criticReview: { verdict: "approve", approved: true, confidence: .92, objections: [] },
      evidenceBundleId: "ev-bundle", decisionAudit: { recordId: "audit", rootHash: "a".repeat(64), schemaVersion: 2 }, steps: []
    }],
    tradePlans: [{
      id: "plan-chain", symbol: "BTC/USDT", status: "awaiting_approval", evidenceIds: ["ticker", "candles"], knowledgeSkillIds: ["skill-1"],
      decisionProvenance: {
        primary: { actualModel: "google/gemini-3.1-pro-preview", actualProvider: "Google AI Studio", providerAttributionVerified: true },
        critic: { verdict: "approve", approved: true, confidence: .92, objections: [] },
        evidence: { bundleId: "ev-bundle" }, auditChain: { recordId: "audit", rootHash: "a".repeat(64), schemaVersion: 2 }
      },
      lastRiskCheck: { passed: true, summary: "全部硬闸通过" }
    }]
  };
  const html = render(React.createElement(C.ChatPage, { data: decisionData, action, ui }));
  assert.match(html, /一次决策是怎样形成的/);
  assert.match(html, /Gemini 负责收集与综合/);
  assert.match(html, /Google AI Studio/);
  assert.match(html, /实时证据 2 · 知识技能 1/);
  assert.match(html, /独立反驳与风险审查/);
  assert.match(html, /账户事实、授权与硬风控裁决/);
  assert.match(html, /可重算审计链/);
});

test("intelligence workspace exposes Gemini grounding links without treating them as trade authority", () => {
  const currentAt = new Date().toISOString();
  const intelData = {
    ...data,
    marketMovers: { scannedAt: currentAt, movers: [{
      symbol: "BTC/USDT", changePct: 8.2, quoteVolUsdt: 10_000_000,
      narrative: {
        evidenceId: "mover-evidence", confidence: "high", searchProvider: "Google AI Studio", providerAttributionVerified: true, attributedAt: currentAt,
        untrustedDisplay: { narrative: "ETF flows accelerated", risk: "headline may reverse" },
        citations: [{ url: "https://example.com/btc", title: "BTC source", source: "example.com" }]
      }
    }] }
  };
  const html = render(React.createElement(C.IntelligenceConcept, { data: intelData, action, ui }));
  assert.match(html, /Gemini 搜索证据/);
  assert.match(html, /Google AI Studio · 提供商已归因/);
  assert.match(html, /BTC source/);
  assert.match(html, /外部网页内容永远不直接下单/);
});

test("capital settings distinguish configured auto mode from the current safety state", () => {
  const html = render(React.createElement(C.MandateConcept, {
    data: {
      ...data,
      automationState: {
        mode: "reduce_only", label: "暂停新开仓", requestedMode: "full_auto", runtimeStatus: "opening_paused", resumesAutomatically: true,
        detail: "账户核算基线或费用对账未完成；当前仅允许降风险动作",
        blockerDetails: [{
          code: "financial_reconciliation_pending",
          label: "近 7 日风险窗口尚未建立",
          detail: "成交费用：已完成；今日基线：已完成；近 7 日窗口：正在读取并核验 OKX 历史。",
          recovery: "系统会优先用 OKX 权威账单、仓位历史和窗口起点标记价格自动重建。"
        }]
      },
      system: { ...data.system, reduceOnlyMode: true }
    },
    action, ui
  }));
  assert.match(html, /资金与交易控制/);
  assert.match(html, /自动交易/);
  assert.match(html, /当前实际状态/);
  assert.match(html, /暂停新开仓/);
  assert.match(html, /原因解除后自动恢复/);
  assert.doesNotMatch(html, /只减仓/);
  assert.match(html, /你选择的模式/);
  assert.match(html, /近 7 日风险窗口尚未建立/);
  assert.match(html, /成交费用：已完成/);
  assert.match(html, /系统会优先用 OKX 权威账单/);
  assert.match(html, /系统异常会自动暂停新开仓/);
  assert.doesNotMatch(html, /为什么最终是这个金额/);
  assert.doesNotMatch(html, /1 · 选择执行方式/);
});

test("execution and review renders every workflow zone on one page", () => {
  const html = render(React.createElement(C.ExecutionReviewConcept, { data, action, ui }));
  for (const id of ["attention", "performance", "reviews", "diagnostics", "improvements", "behavior"]) assert.ok(html.includes(`id="er-${id}"`), `missing single-page zone ${id}`);
  assert.ok(!html.includes("id=\"er-fills\""), "raw fill ledger belongs on its own subpage");
  assert.ok(!html.includes("AI 委托记录"), "raw AI order records belong on their own subpage");
  assert.ok(html.includes("持仓时长与收益率"));
  assert.ok(html.includes("绩效拆解"));
  assert.ok(!html.includes("role=\"tablist\""), "single-page workbench must not hide sections behind tabs");
});

test("Owner review loop renders candidate lessons and routed improvements without claiming automatic changes", () => {
  const html = render(React.createElement(C.ExecutionReviewConcept, {
    data: {
      ...data,
      ownerReviewLoop: {
        summary: { structuredReviews: 4, candidateLessons: 1, pendingOwner: 1, validating: 0 },
        lessons: [{
          id: "lesson-1", reviewId: "r1", status: "candidate", title: "等待回踩确认", content: "候选教训正文", symbol: "BTC/USDT", createdAt: new Date().toISOString(),
          origin: "llm_deep_review", hasLlmAdvice: true, factSummary: "BTC 做多净亏损 2.00 U", lessonText: "入场确认不足。",
          llmAdvice: "下次等待 15m 回踩确认后再入场。", diagnosis: { label: "入场时机或确认不足", confidence: 0.82, evidence: "开仓后先逆行" },
          assessment: { matrixLabel: "过程有缺口，结果亏损", processScore: 64, evidenceQuality: "adequate", outcome: "loss", netRealizedPnl: -2 },
          applicability: { symbol: "BTC/USDT", direction: "long", timeframe: "15m", setupType: "pullback", strategyProductId: "trend", regime: "uptrend" }
        }],
        improvements: [{ id: "improvement-1", state: "pending_owner", destination: "strategy", title: "入场时机或确认不足", problem: "3 笔复盘重复出现", proposal: "创建版本化对照实验", evidenceCount: 3, successCriteria: ["历史样本外验证通过"] }]
      }
    }, action, ui
  }));
  assert.match(html, /Owner 优化清单/);
  assert.match(html, /先看依据和建议，再决定是否用于相似行情/);
  assert.match(html, /LLM 深度复盘/);
  assert.match(html, /LLM 给出的复盘建议/);
  assert.match(html, /下次等待 15m 回踩确认后再入场/);
  assert.match(html, /批准后只在以下场景参考/);
  assert.match(html, /确认用于相似行情/);
  assert.match(html, /入场时机或确认不足/);
  assert.match(html, /策略库/);
  assert.match(html, /接受建议/);
  assert.match(html, /系统自行修改/);
});

test("Owner validation UI selects authoritative evidence instead of asking for free-text pass claims", () => {
  const now = new Date().toISOString();
  const html = render(React.createElement(C.ExecutionReviewConcept, {
    data: {
      ...data,
      ownerReviewLoop: {
        summary: { structuredReviews: 3, candidateLessons: 1, pendingOwner: 0, validating: 1 },
        lessons: [{ id: "legacy-lesson", status: "candidate_legacy", title: "旧版待审核", content: "尚未获批", symbol: "BTC/USDT", createdAt: now }],
        improvements: [{
          id: "validation-1", state: "validating", destination: "strategy", title: "策略候选验证", problem: "需要权威证据", proposal: "按三阶段验证", evidenceCount: 3,
          validation: {
            stages: [{ name: "backtest", label: "回测", status: "pending" }, { name: "paper", label: "模拟盘", status: "pending" }, { name: "small_live", label: "小额实盘", status: "pending" }],
            readyForOwnerVerification: false,
            availableEvidence: { candidateVersions: [{ id: "candidate-v2", label: "候选 V2", definitionHash: "hash-v2", backtestId: "bt-v2" }], paperSessions: [], liveReviews: [] }
          }
        }]
      }
    }, action, ui
  }));
  assert.match(html, /候选策略版本（来自策略库）/);
  assert.match(html, /候选 V2/);
  assert.match(html, /candidate-v2/);
  assert.match(html, /系统会自动核对版本 Hash 与其权威样本外回测/);
  assert.match(html, /核验并记录通过/);
  assert.match(html, /旧版待审核/);
  assert.doesNotMatch(html, /请输入本次回测对应的候选策略版本 ID/);
});

test("execution review distinguishes not-run reconciliation and never renders unknown costs as zero performance", () => {
  const html = render(React.createElement(C.ExecutionReviewConcept, {
    data: {
      ...data,
      reconciliationReports: [],
      tradeDataStatus: { fillTotal: 4, closedLifecycleTotal: 2, financiallyReconciledTrades: 0, pendingFinancialReconciliation: 2 }
    },
    action,
    ui
  }));
  assert.match(html, /尚未运行/);
  assert.match(html, /不能把它显示成‘对账失败’/);
  assert.match(html, /已平仓 2 笔，其中 0 笔已完成费用核算/);
  assert.match(html, /已核算净盈亏/);
  assert.match(html, /等待费用核算/);
  assert.match(html, /已有真实平仓，但费用核算尚未完整；完成前不显示假 0 曲线/);
});

test("orders and fills render together on the dedicated ledger subpage", () => {
  const html = render(React.createElement(C.ExecutionLedgerConcept, { data, action, ui }));
  assert.ok(html.includes("id=\"el-orders\""));
  assert.ok(html.includes("id=\"el-fills\""));
  assert.ok(html.includes("AI 委托记录"));
  assert.ok(html.includes("成交流水"));
  assert.match(html, /价格毛盈亏/);
  assert.doesNotMatch(html, /已实现盈亏/);
});

test("concept graph dedupes duplicate names and renders", () => {
  const html = render(React.createElement(C.ConceptGraph, { concepts: data.knowledge.conceptCards }));
  // 重名"趋势"合并后只应出现一个节点文本(每个节点一个 <text>)
  const count = (html.match(/趋势/g) || []).length;
  assert.ok(count >= 1, "概念图谱应包含趋势节点");
  assert.ok(html.includes("止损"), "合并后关系并集应保留 止损 节点");
});

test("desktop knowledge page exposes the full concept graph workspace and source filters", () => {
  const html = render(React.createElement(C.KnowledgeConcept, { data, action, ui }));
  assert.match(html, /知识库下一步/);
  assert.match(html, /资料已导入/);
  assert.match(html, /可检索/);
  assert.match(html, /已形成知识网络/);
  assert.match(html, /概念与知识网络/);
  assert.match(html, /知识网络概览/);
  assert.match(html, /按知识来源筛选概念/);
  assert.match(html, /海龟交易法则/);
  assert.match(html, /以交易为生/);
  assert.match(html, /生效中的条令/);
  assert.match(html, /知识库只负责让内容可检索、可引用、可关联/);
  assert.match(html, /管理来源/);
  assert.match(html, /扩展候选（可选）/);
  assert.match(html, /规则库与实际作用/);
  assert.match(html, /每份知识现在能做什么/);
  assert.match(html, /策略库承接/);
  assert.match(html, /能力库承接/);
  assert.doesNotMatch(html, /打开技能流水线|查看技能流水线|阶段 8\/8/);
  assert.match(html, /趋势/);
  assert.match(html, /止损/);
});

test("knowledge source cards treat empty imports as incomplete rather than parsed", () => {
  const html = render(React.createElement(C.KnowledgeConcept, {
    data: { ...data, knowledge: { ...data.knowledge, sources: [{ id: "empty-source", title: "空白书籍", type: "pdf", status: "无可用文本" }], tradingMethods: [], tradingSkills: [] } },
    action,
    ui
  }));
  assert.match(html, /空白书籍/);
  assert.match(html, /导入未完成/);
  assert.match(html, /当前不会影响分析或交易/);
});

test("system settings gives OKX and notifications one explicit home without leaking runtime state into subscriptions", () => {
  const settingsData = {
    ...data,
    system: { ...data.system, reduceOnlyMode: true, manualReduceOnly: false },
    automationState: { mode: "reduce_only", label: "暂停新开仓", requestedMode: "full_auto" },
    config: { ...data.config, integrations: { telegram: { configured: true }, lark: { hasWebhook: false }, alerts: { hasWebhook: true } } }
  };
  const overview = render(React.createElement(C.SettingsConcept, { data: settingsData, action, ui, activeTab: "overview", onTabChange: () => {} }));
  assert.match(overview, /OKX 配置/);
  assert.match(overview, /通知渠道/);
  assert.match(overview, /Owner 工作区/);
  assert.doesNotMatch(overview, /用户与订阅<\/b>[\s\S]{0,300}只减仓/);

  const notifications = render(React.createElement(C.SettingsConcept, { data: settingsData, action, ui, activeTab: "notifications", onTabChange: () => {} }));
  assert.match(notifications, /保存通知设置|飞书通知|Telegram/);

  const basics = render(React.createElement(C.SettingsConcept, { data: settingsData, action, ui, activeTab: "base", onTabChange: () => {} }));
  assert.match(basics, /四个基础模块/);
  assert.doesNotMatch(basics, /五个基础模块/);
});

test("Agent settings renders real profiles and an explicit loading state instead of a blank editor", () => {
  const profile = { id: "agent-owner", order: 1, name: "Owner Agent", role: "主交易 Agent", mission: "综合事实", enabled: true };
  const populated = render(React.createElement(C.SettingsConcept, { data: { ...data, agentProfiles: [profile] }, action, ui, activeTab: "agents", onTabChange: () => {} }));
  assert.match(populated, /Agent 列表/);
  assert.match(populated, /Owner Agent/);
  assert.match(populated, /主交易 Agent/);

  const empty = render(React.createElement(C.SettingsConcept, { data: { ...data, agentProfiles: [], resourceState: { systemSettings: "loading" } }, action, ui, activeTab: "agents", onTabChange: () => {} }));
  assert.match(empty, /Agent 配置尚未加载/);
  assert.match(empty, /不会显示空白编辑器/);
  assert.match(empty, /重新加载/);
});

test("desktop runtime controls fit the two true emergency actions without empty columns", () => {
  const css = fs.readFileSync(path.join(rootDir, "src/styles.css"), "utf8");
  const desktopMedia = css.match(/@media \(max-width: 1280px\) and \(min-width: 901px\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(desktopMedia, /topEmergencyActions button span\s*\{\s*display:\s*none/);
  assert.match(desktopMedia, /repeat\(2,minmax\(64px,1fr\)\)/);
});

test("public product preview teaches the same three modes as the real cockpit", () => {
  const html = fs.readFileSync(path.join(rootDir, "public/landing.html"), "utf8");
  const script = fs.readFileSync(path.join(rootDir, "public/landing.js"), "utf8");
  const preview = `${html}\n${script}`;
  assert.match(preview, /自动交易/);
  assert.match(preview, /只分析/);
  assert.match(preview, /逐笔确认/);
  assert.match(preview, /AI 交易员/);
  assert.match(preview, /产品演示数据/);
  assert.match(preview, /紧急停止可随时接管/);
  assert.match(preview, /归因、对账与审计/);
  assert.doesNotMatch(preview, /只减仓|暂停自主/);
});

test("mobile drawer keeps settings visible without duplicate status and close footer", () => {
  const html = render(React.createElement(C.NavDrawer, {
    open: true,
    route: "knowledgeBase",
    onNavigate: () => {},
    onClose: () => {},
    lang: "zh",
    switchLang: () => {}
  }));
  assert.match(html, /设置/);
  assert.doesNotMatch(html, /关闭菜单/);
  assert.doesNotMatch(html, /只减仓/);
  assert.match(html, /mDrawerSettings/);
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

test("mobile capability library and backtest research render as native lists", () => {
  const ui = { setActive: () => {}, notify: () => {}, openPanel: () => {} };
  const capabilityData = {
    skills: [{ id: "tool-skill", name: "结构扫描", kind: "tool", status: "enabled" }, { id: "strategy", name: "突破策略", kind: "strategy", status: "active" }],
    toolCallStats: { 结构扫描: { calls: 0, success: 0, blocked: 0, error: 0, sourceCalls: {} } },
    tools: [{ id: "tool_market", name: "行情连接", type: "data", status: "configured" }],
    mcpServers: [{ id: "mcp_news", serverName: "新闻 MCP", transport: "stdio", status: "registered" }, { id: "mcp_news_duplicate", serverName: "新闻 MCP", transport: "stdio", status: "registered" }]
  };
  const capabilityHtml = render(React.createElement(C.MobileCapabilities, { data: capabilityData, action, ui }));
  assert.match(capabilityHtml, /AI 可调用的能力/);
  assert.match(capabilityHtml, /结构扫描/);
  assert.match(capabilityHtml, /未有运行证据/);
  assert.doesNotMatch(capabilityHtml, /突破策略/);
  assert.equal((capabilityHtml.match(/新闻 MCP/g) || []).length, 1, "duplicate MCP registrations should collapse to one capability");
  assert.doesNotMatch(capabilityHtml, /cp2CapabilitiesLayout|cp2SideFilter/);

  const researchHtml = render(React.createElement(C.MobileBacktestResearch, {
    data: { backtestResearch: { summary: { totalHistoricalEvidence: 1, optimizerOos: 1, studioOos: 0 }, historical: [{ id: "bt1", name: "BTC 唐奇安", evidenceType: "optimizer_oos", status: "oos_ok", symbol: "BTC/USDT", timeframe: "1h", trades: 18, expectancyR: 0.2, profitFactor: 1.35, maxDrawdownPct: 4.2, equityCurve: [100, 101, 103] }], forward: [] } },
    action
  }));
  assert.match(researchHtml, /研究记录/);
  assert.match(researchHtml, /BTC 唐奇安/);
  assert.match(researchHtml, /纯前向模拟/);
  assert.doesNotMatch(researchHtml, /cp2StrategyLayout|ConceptTable/);
});

test("mobile strategy studio identifies AI-chat drafts as the same authoring pipeline", () => {
  const html = render(React.createElement(C.MobileStrategy, {
    data: {
      strategyStudio: {
        drafts: [{
          id: "studio-agent-draft",
          status: "tests_passed",
          authoring: { channel: "agent_chat", toolName: "create_skill_from_idea" },
          blueprint: { name: "BTC 回踩策略", symbols: ["BTC/USDT"], timeframe: "1h", direction: "long", exitPolicy: { stopLossPct: 2, takeProfitR: 2.5 }, params: {} },
          generatedTests: { status: "passed", passed: 1, total: 1, tests: [] }
        }],
        backtests: [],
        marketplace: { listings: [], summary: {} }
      },
      strategyCatalog: { products: [] },
      knowledge: { tradingSkills: [] },
      skills: []
    },
    action,
    initialTab: "studio"
  }));
  assert.match(html, /自然语言创建策略/);
  assert.match(html, /AI 对话创建/);
  assert.match(html, /草稿不会下单/);
});

test("mobile strategy catalog and execution ledger use the same factual rows as desktop", () => {
  const strategyHtml = render(React.createElement(C.MobileStrategy, {
    data: {
      strategyStudio: { drafts: [], backtests: [], marketplace: { listings: [], summary: {} } },
      strategyCatalog: {
        products: [{ id: "p", versionId: "v1", definition: { name: "产品策略", direction: "long", timeframes: ["1h"] }, deployment: { state: "owner_live_observation" } }],
        strategies: [{ id: "rsi", name: "RSI 研究模型", contract: { direction: "both", timeframes: ["15m"] }, lifecycle: { stage: "research" } }]
      },
      knowledge: { tradingSkills: [] }, skills: []
    }, action, initialTab: "catalog"
  }));
  assert.match(strategyHtml, /产品策略/);
  assert.match(strategyHtml, /RSI 研究模型/);
  assert.match(strategyHtml, /研究模型/);

  const executionData = {
    executionOrders: [{ id: "eo", symbol: "BTC\/USDT", status: "entry_partial", createdAt: "2026-08-01T00:00:00Z" }],
    executionOrderStatus: { total: 8 },
    fills: [
      { id: "entry", executionOrderId: "eo", kind: "entry", symbol: "BTC/USDT", price: 60000, feeUsdt: 1, createdAt: "2026-08-01T00:00:00Z" },
      { id: "partial", executionOrderId: "eo", kind: "close", partial: true, symbol: "BTC/USDT", price: 60500, realizedPnl: 3, feeUsdt: .2, createdAt: "2026-08-01T01:00:00Z" },
      { id: "final", executionOrderId: "eo", kind: "close", partial: false, symbol: "BTC/USDT", price: 61000, realizedPnl: 7, feeUsdt: .3, createdAt: "2026-08-01T02:00:00Z" }
    ],
    tradeDataStatus: { fillTotal: 12, tradeReviewTotal: 1 },
    performance: { trades: 4, totalPnlUsdt: 42.25, winRatePct: 75 },
    reviews: [{ id: "review", type: "trade", tradeLifecycleKey: "eo", status: "completed" }, { id: "other", type: "analysis", executionOrderId: "eo" }]
  };
  const overviewHtml = render(React.createElement(C.MobileExecution, { data: executionData, action, initialTab: "overview" }));
  assert.match(overviewHtml, /42\.25/);
  assert.match(overviewHtml, /75%/);
  const fillsHtml = render(React.createElement(C.MobileExecution, { data: executionData, action, initialTab: "fills" }));
  assert.match(fillsHtml, /最近 3 \/ 12/);
  assert.match(fillsHtml, /开仓/);
  assert.match(fillsHtml, /平仓/);
  assert.match(fillsHtml, /价格毛盈亏/);
  C.setLang("en");
  try {
    const englishFillsHtml = render(React.createElement(C.MobileExecution, { data: executionData, action, initialTab: "fills" }));
    assert.match(englishFillsHtml, /Gross price PnL/);
    assert.doesNotMatch(englishFillsHtml, /Realized PnL/);
  } finally {
    C.setLang("zh");
  }
});

test("mobile review never labels gross or missing financials as a net result", () => {
  const html = render(React.createElement(C.MobileExecution, {
    data: {
      executionOrders: [], fills: [], closedTradeLifecycles: [], performance: {},
      reviews: [{ id: "legacy", type: "trade", symbol: "ADA/USDT", status: "completed", realizedPnl: 5, feeUsdt: 1, summary: "旧复盘" }],
      tradeDataStatus: { fillTotal: 0, tradeReviewTotal: 1 }
    }, action, initialTab: "reviews"
  }));
  assert.match(html, /mReviewRowTop[\s\S]*?>—<\/b>/);
  assert.doesNotMatch(html, /\+4\.00|\+5\.00|\+0\.00/);
});

test("mobile event calendar keeps date-only events untimed and month selection aligned", () => {
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const html = render(React.createElement(C.MobileTasks, {
    data: { marketCalendarEvents: [{ id: "fomc", title: "FOMC", due: `${date}T00:00:00.000Z`, startAt: `${date}T00:00:00.000Z`, timePrecision: "date", importance: "high", sourceName: "Federal Reserve" }], tasks: [], riskRules: [] },
    action
  }));
  assert.match(html, /mEventCalendar/);
  assert.match(html, /全天 · 时间待定/);
  assert.doesNotMatch(html, />08:00</, "a UTC placeholder for a date-only event must not be rendered as an exact local time");

  const shifted = C.shiftMobileCalendarSelection(new Date(2026, 0, 1), "2026-01-31", 1);
  assert.equal(shifted.monthAnchor.getMonth(), 1);
  assert.equal(shifted.selectedDate, "2026-02-28", "selected day must clamp into and stay within the target month");
});

test("mobile risk payload preserves heterogeneous pair caps across unrelated edits", () => {
  const mandate = {
    id: "m1", name: "异构杠杆授权", allowedSymbols: ["BTC/USDT", "ETH/USDT"],
    maxLeverageBySymbol: { "BTC/USDT": 2, "ETH/USDT": 5 }, max_leverage: 5, min_leverage: 1,
    strategies: ["breakout"]
  };
  const form = {
    symbols: ["BTC/USDT", "ETH/USDT"], minLeverage: 1, newSymbolMaxLeverage: 1,
    maxLeverageBySymbol: { "BTC/USDT": 2, "ETH/USDT": 5 }, positionPct: 30, singleRisk: 1,
    dailyLoss: 0.5, weeklyLoss: 5, maxOrderNotional: 50, maxSymbolNotional: 100,
    maxPortfolioNotional: 150, maxConcurrentPositions: 2, maxMarginUtilizationPct: 50, validDays: 7
  };
  const unchanged = C.buildMobileRiskPermissionPayload(mandate, { ...form, dailyLoss: 0.8 }, { nowMs: 0 });
  assert.deepEqual(unchanged.maxLeverageBySymbol, { "BTC/USDT": 2, "ETH/USDT": 5 });
  assert.equal(unchanged.max_leverage, 5);

  const removed = C.buildMobileRiskPermissionPayload(mandate, { ...form, symbols: ["BTC/USDT"] }, { nowMs: 0 });
  assert.deepEqual(removed.maxLeverageBySymbol, { "BTC/USDT": 2 }, "removed pairs must also be removed from the authorization map");
  assert.equal(removed.max_leverage, 2);

  const added = C.buildMobileRiskPermissionPayload(mandate, { ...form, symbols: [...form.symbols, "SOL/USDT"], newSymbolMaxLeverage: 3 }, { nowMs: 0 });
  assert.deepEqual(added.maxLeverageBySymbol, { "BTC/USDT": 2, "ETH/USDT": 5, "SOL/USDT": 3 });
  assert.ok(added.maxLeverageBySymbol["SOL/USDT"] <= 3, "a new pair cannot exceed the explicitly authorized new-pair cap");
});

test("mobile risk edits preserve paused/revoked state and failed saves keep the editor open", async () => {
  const form = { symbols: ["BTC/USDT"], maxLeverageBySymbol: { "BTC/USDT": 2 }, minLeverage: 1, newSymbolMaxLeverage: 1, validDays: 7 };
  assert.equal(C.buildMobileRiskPermissionPayload({ id: "paused", status: "paused", allowedSymbols: ["BTC/USDT"], maxLeverageBySymbol: { "BTC/USDT": 2 } }, form, { nowMs: 0 }).status, "paused");
  assert.equal(C.buildMobileRiskPermissionPayload({ id: "revoked", status: "revoked", allowedSymbols: ["BTC/USDT"], maxLeverageBySymbol: { "BTC/USDT": 2 } }, form, { nowMs: 0 }).status, "revoked");
  assert.equal(C.buildMobileRiskPermissionPayload({}, form, { nowMs: 0 }).status, "active", "only a newly created mandate defaults active");
  for (const endpoint of ["/api/mandates/m1", "/api/config/live-trading", "/api/system/goals"]) {
    assert.equal(await C.submitMobileRiskChange(async () => ({ ok: false, error: "400" }), endpoint, {}), false);
    assert.equal(await C.submitMobileRiskChange(async () => ({ ok: true }), endpoint, {}), true);
  }
  const source = fs.readFileSync(path.join(rootDir, "src/mobile.jsx"), "utf8");
  assert.match(source, /const saved = await action\(mandate\.id \? `\/api\/mandates\/\$\{mandate\.id\}` : "\/api\/mandates"/);
  assert.match(source, /if \(saved\?\.ok === false\) return;/);
  assert.match(source, /submitMobileRiskChange\(action, "\/api\/config\/live-trading"/);
  assert.match(source, /submitMobileRiskChange\(action, "\/api\/system\/goals"/);
  assert.equal((source.match(/if \(ok\) onDone\(\);/g) || []).length, 2);
  for (const status of ["paused", "revoked"]) {
    const html = render(React.createElement(C.MobileRiskPermissionEditor, {
      data: { mandates: [{ id: status, status, allowedSymbols: ["BTC/USDT"], maxLeverageBySymbol: { "BTC/USDT": 2 } }] },
      action, ui, onDone: () => {}
    }));
    assert.match(html, /保存设置/);
    assert.doesNotMatch(html, /保存并立即生效/);
  }
  C.setLang("en");
  try {
    const html = render(React.createElement(C.MobileRiskPermissionEditor, {
      data: { mandates: [{ id: "paused-en", status: "paused", allowedSymbols: ["BTC/USDT"], maxLeverageBySymbol: { "BTC/USDT": 2 } }] },
      action, ui, onDone: () => {}
    }));
    assert.match(html, /Save settings/);
    assert.doesNotMatch(html, /Save and apply/);
  } finally {
    C.setLang("zh");
  }
});

test("mobile refresh controls invoke the intelligence and calendar refresh chains they display", async () => {
  const intelligenceCalls = [];
  await C.refreshMobileIntelligence(async (endpoint, body) => { intelligenceCalls.push([endpoint, body]); return { ok: true }; });
  assert.deepEqual(intelligenceCalls, [["/api/market-intelligence/refresh", {}]], "intelligence refresh must use the full intelligence pipeline");

  const calendarCalls = [];
  await C.refreshMobileEventCalendar(async (endpoint, body) => { calendarCalls.push([endpoint, body]); return { ok: true, endpoint }; });
  assert.deepEqual(calendarCalls, [
    ["/api/event-sources/refresh", {}],
    ["/api/market-intelligence/refresh", {}]
  ], "calendar refresh must update RSS events before rebuilding official calendar and intelligence-derived rows");

  const mobileSource = fs.readFileSync(path.join(rootDir, "src/mobile.jsx"), "utf8");
  const tasksSource = mobileSource.slice(mobileSource.indexOf("export function MobileTasks"), mobileSource.indexOf("function mobileIntelHealth"));
  const intelligenceSource = mobileSource.slice(mobileSource.indexOf("export function MobileIntelligence"), mobileSource.indexOf("function MobileAccountHealth"));
  assert.match(tasksSource, /onClick=\{\(\) => refreshMobileEventCalendar\(action\)\}/, "MobileTasks refresh button must stay bound to the calendar refresh chain");
  assert.match(intelligenceSource, /onClick=\{\(\) => refreshMobileIntelligence\(action\)\}/, "MobileIntelligence refresh button must stay bound to the intelligence refresh chain");
  assert.doesNotMatch(intelligenceSource, /event-sources\/refresh/, "the intelligence component must not regress to the RSS-only endpoint");
});

test("mobile intelligence uses derived stale source health and separates brief from audit-heavy details", () => {
  const html = render(React.createElement(C.MobileIntelligence, {
    data: {
      dailyMarketBrief: { version: 2, asOf: "2026-08-14T12:00:00Z", macroContext: { economicCyclePhase: "insufficient_verified_macro_data", cryptoRiskAppetite: "分化" }, evidenceFactIds: [], constraints: [] },
      marketIntelligenceSourceHealth: [{ sourceId: "old-ok", name: "Old feed", status: "ok", health: "stale", lastSuccessAt: "2026-08-01T00:00:00Z" }],
      newsFeed: [], marketCalendarEvents: [], events: []
    }, action, ui
  }));
  assert.match(html, /情报中心|只作为分析背景/);
  assert.match(html, /0(?:<!-- -->)?\/(?:<!-- -->)?1/);
  assert.match(html, /1 个情报来源已陈旧/);
  assert.match(html, /可验证宏观数据不足，不下结论/);
});

test("mobile pair sheet pins the selected pair above the search field", () => {
  const html = render(React.createElement(C.MobilePairSheet, { instruments: ["BTC/USDT", "ETH/USDT"], current: "BTC/USDT", onClose: () => {}, onPick: () => {} }));
  assert.match(html, /mSheetSelection/);
  assert.match(html, /当前币对/);
  assert.match(html, /搜索全部 USDT 永续/);
});

test("mobile instrument loader exposes rejected and non-2xx failures instead of loading forever", async () => {
  await assert.rejects(() => C.loadMobileInstrumentList(async () => { throw new Error("offline"); }, "/api/market/instruments"), /offline/);
  await assert.rejects(() => C.loadMobileInstrumentList(async () => ({ ok: false, status: 503 }), "/api/market/instruments"), /503/);
  const html = render(React.createElement(C.MobilePairSheet, { instruments: [], current: "BTC/USDT", error: "offline", onRetry: () => {}, onClose: () => {}, onPick: () => {} }));
  assert.match(html, /完整合约清单加载失败/);
  assert.match(html, /仅保留当前已选项，不代表完整可交易范围/);
  assert.match(html, /重试/);
});

test("mobile instrument loader rejects 200-empty and discloses stale cached lists", async () => {
  await assert.rejects(() => C.loadMobileInstrumentList(async () => ({ ok: true, json: async () => ({ instruments: [], sourceStatus: "healthy" }) }), "/api/market/instruments"), /无法确认|Unable to confirm/);
  const stale = await C.loadMobileInstrumentList(async () => ({ ok: true, json: async () => ({ instruments: [{ symbol: "BTC/USDT" }], sourceStatus: "stale", stale: true, asOf: "2026-08-14T00:00:00Z" }) }), "/api/market/instruments");
  assert.deepEqual(stale, { instruments: ["BTC/USDT"], sourceStatus: "stale", stale: true, asOf: "2026-08-14T00:00:00Z" });
  const html = render(React.createElement(C.MobilePairSheet, { instruments: ["BTC/USDT"], current: "BTC/USDT", stale: true, asOf: "2026-08-14T00:00:00Z", onRetry: () => {}, onClose: () => {}, onPick: () => {} }));
  assert.match(html, /当前使用缓存合约清单|Using a cached contract list/);
  const source = fs.readFileSync(path.join(rootDir, "src/mobile.jsx"), "utf8");
  const permissionSource = source.slice(source.indexOf("function MobileRiskPermissionEditor"), source.indexOf("function MobileRiskLiveEditor"));
  assert.match(permissionSource, /instrumentsStale=\{instrumentState\.stale\}/);
  assert.match(permissionSource, /instrumentsAsOf=\{instrumentState\.asOf\}/);
});

test("web orphan review uses persisted lifecycle net and includes entry plus close fees", () => {
  const html = render(React.createElement(C.ExecutionReviewConcept, {
    data: {
      executionOrders: [], fills: [], closedTradeLifecycles: [], performance: {}, positions: [], tradePlans: [],
      reviews: [{ id: "orphan", type: "trade", status: "completed", symbol: "ADA/USDT", realizedPnl: 5, netRealizedPnl: 3.5, entryFeeUsdt: 1, feeUsdt: 0.5, completedAt: "2026-08-14T00:00:00Z" }],
      behaviorProfile: {}, reviewLearningAnalytics: {}, reconciliationReports: []
    }, action, ui
  }));
  assert.match(html, /\+3\.50 U/);
  assert.match(html, /1\.50 U/);
  assert.doesNotMatch(html, /\+4\.50 U/);
});

test("desktop goal guardrails use lifecycle net PnL and allocation uses shared notional semantics", () => {
  const now = new Date().toISOString();
  const overview = render(React.createElement(C.TradingOverviewConcept, {
    data: {
      system: { dailyGoalUsdt: 8, monthlyGoalUsdt: 240, monthlyGoalDays: 30 }, portfolio: {},
      fills: [
        { id: "entry", kind: "entry", executionOrderId: "goal-life", feeUsdt: 1, createdAt: now },
        { id: "part", kind: "close", executionOrderId: "goal-life", partial: true, realizedPnl: 4, feeUsdt: 1, createdAt: now },
        { id: "final", kind: "close", executionOrderId: "goal-life", realizedPnl: 6, feeUsdt: 1, createdAt: now }
      ],
      closedTradeLifecycles: [{ id: "closed:goal-life", tradeLifecycleKey: "goal-life", netRealizedPnl: 7, createdAt: now }],
      positions: [], orders: [], executionOrders: [], markets: [], riskRules: [], accountSnapshots: [], mediumTermAnalytics: {}
    }, action, ui
  }));
  assert.doesNotMatch(overview, /已达今日盈利目标/, "gross 10 must not trip an 8 USDT goal when lifecycle net is 7");
  assert.match(overview, />7\.00(?:<!-- -->)? \/ (?:<!-- -->)?8\.00</);

  const positions = render(React.createElement(C.PositionsConcept, { data: { positions: [{ symbol: "ADA/USDT", quantity: 100, markPrice: 1.25, notionalUsdt: 125 }], portfolio: { totalEquityUsdt: 1000 }, accountSnapshots: [] } }));
  assert.match(positions, /125\.00 U/);
});
