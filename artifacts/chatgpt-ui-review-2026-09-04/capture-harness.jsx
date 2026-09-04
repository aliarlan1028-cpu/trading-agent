import React from "react";
import { createRoot } from "react-dom/client";
import { August15AuthenticatedShell } from "../../src/aug15/App.jsx";
import { appPathForRoute } from "../../src/appUrlState.js";
import { ConfigPanel } from "../../src/aug15/panels.jsx";
import { loadedResourceState, productionShellBrowserFixture } from "../../tests/production-shell-browser-fixture.js";
import "../../src/aug15/styles.css";

document.documentElement.dataset.fixtureKind = "production-shaped-synthetic";

const now = "2026-09-04T08:00:00.000Z";
const hour = 3_600_000;
const iso = (offset) => new Date(new Date(now).getTime() + offset * hour).toISOString();
const markets = [
  { id: "market-btc", symbol: "BTC/USDT", price: 113820.4, markPrice: 113818.8, changePct: 2.42, change24hPct: 2.42, high24h: 115240, low24h: 109640, volume24h: 1830000000, openInterest: 2743000000, fundingRate: 0.0081, updatedAt: now },
  { id: "market-eth", symbol: "ETH/USDT", price: 4378.12, markPrice: 4377.91, changePct: 1.86, change24hPct: 1.86, high24h: 4431, low24h: 4238, volume24h: 1290000000, openInterest: 1910000000, fundingRate: 0.0064, updatedAt: now },
  { id: "market-sol", symbol: "SOL/USDT", price: 218.74, markPrice: 218.7, changePct: -1.12, change24hPct: -1.12, high24h: 224.8, low24h: 214.2, volume24h: 821000000, openInterest: 742000000, fundingRate: -0.0032, updatedAt: now }
];
const positions = [
  { id: "position-btc", positionId: "position-btc", executionOrderId: "order-btc", symbol: "BTC/USDT", source: "execution_engine", direction: "long", side: "buy", quantity: 0.18, size: 0.18, entryPrice: 110820, markPrice: 113818.8, unrealizedPnl: 539.78, leverage: 3, liquidationPrice: 82410, liqDistancePct: 27.6, margin: 6829.13, initialMargin: 6829.13, notionalUsdt: 20487.38, stopLoss: 108920, takeProfits: [116180], openedAt: iso(-22), updatedAt: now },
  { id: "position-eth", positionId: "position-eth", executionOrderId: "order-eth", symbol: "ETH/USDT", source: "exchange_rest", direction: "long", side: "buy", quantity: 1.4, size: 1.4, entryPrice: 4258, markPrice: 4377.91, unrealizedPnl: 167.87, leverage: 3, liquidationPrice: 3184, liqDistancePct: 27.3, margin: 2043.02, initialMargin: 2043.02, notionalUsdt: 6129.07, stopLoss: 4180, takeProfits: [4471], openedAt: iso(-15), updatedAt: now },
  { id: "position-sol", positionId: "position-sol", executionOrderId: "order-sol", symbol: "SOL/USDT", source: "exchange_ws", direction: "short", side: "sell", quantity: 18, size: 18, entryPrice: 223.1, markPrice: 218.7, unrealizedPnl: 79.2, leverage: 2, liquidationPrice: 318.2, liqDistancePct: 45.5, margin: 1968.3, initialMargin: 1968.3, notionalUsdt: 3936.6, stopLoss: 226.2, takeProfits: [214.1], openedAt: iso(-8), updatedAt: now }
];
const executionOrders = [
  { id: "order-btc", orderId: "order-btc", tradePlanId: "plan-btc", positionId: "position-btc", symbol: "BTC/USDT", side: "buy", direction: "long", type: "limit", orderType: "limit", quantity: 0.18, filledQuantity: 0.18, price: 110820, exchange: "OKX", source: "execution_engine", status: "filled", createdAt: iso(-23), updatedAt: iso(-22) },
  { id: "order-eth", orderId: "order-eth", tradePlanId: "plan-eth", positionId: "position-eth", symbol: "ETH/USDT", side: "buy", direction: "long", type: "market", orderType: "market", quantity: 1.4, filledQuantity: 1.4, price: 4258, exchange: "OKX", source: "execution_engine", status: "filled", createdAt: iso(-16), updatedAt: iso(-15) },
  { id: "order-sol", orderId: "order-sol", tradePlanId: "plan-sol", positionId: "position-sol", symbol: "SOL/USDT", side: "sell", direction: "short", type: "stop", orderType: "stop", purpose: "stop_loss", quantity: 18, filledQuantity: 0, price: 226.2, exchange: "OKX", source: "execution_engine", status: "open", reduceOnly: true, createdAt: iso(-8), updatedAt: now }
];
const fills = executionOrders.slice(0, 2).map((order, index) => ({
  id: `fill-${index + 1}`, fillId: `fill-${index + 1}`, orderId: order.id, executionOrderId: order.id,
  symbol: order.symbol, side: order.side, direction: order.direction, quantity: order.quantity,
  price: order.price, feeUsdt: index ? -2.18 : -7.04, liquidity: index ? "taker" : "maker",
  exchange: "OKX", createdAt: order.updatedAt, updatedAt: order.updatedAt
}));
const closedTradeLifecycles = [
  { id: "trade-btc-1", tradeLifecycleId: "trade-btc-1", executionOrderId: "closed-order-btc", orderId: "closed-order-btc", symbol: "BTC/USDT", direction: "long", side: "buy", status: "closed", quantity: 0.12, entryPrice: 108420, exitPrice: 110310, grossRealizedPnl: 226.8, totalFeeUsdt: 7.4, netRealizedPnl: 219.4, openedAt: iso(-120), closedAt: iso(-114), createdAt: iso(-120), updatedAt: iso(-114) },
  { id: "trade-eth-1", tradeLifecycleId: "trade-eth-1", executionOrderId: "closed-order-eth", orderId: "closed-order-eth", symbol: "ETH/USDT", direction: "short", side: "sell", status: "closed", quantity: 1.1, entryPrice: 4210, exitPrice: 4258, grossRealizedPnl: -52.8, totalFeeUsdt: 3.8, netRealizedPnl: -56.6, openedAt: iso(-96), closedAt: iso(-91), createdAt: iso(-96), updatedAt: iso(-91) },
  { id: "trade-sol-1", tradeLifecycleId: "trade-sol-1", executionOrderId: "closed-order-sol", orderId: "closed-order-sol", symbol: "SOL/USDT", direction: "long", side: "buy", status: "closed", quantity: 14, entryPrice: 202.3, exitPrice: 211.9, grossRealizedPnl: 134.4, totalFeeUsdt: 4.2, netRealizedPnl: 130.2, openedAt: iso(-72), closedAt: iso(-67), createdAt: iso(-72), updatedAt: iso(-67) }
];
const reviews = closedTradeLifecycles.map((trade, index) => ({
  id: `review-${index + 1}`, type: "trade", tradeLifecycleId: trade.id, executionOrderId: trade.executionOrderId,
  orderId: trade.orderId, symbol: trade.symbol, direction: trade.direction, status: "completed",
  netRealizedPnl: trade.netRealizedPnl, totalFeeUsdt: trade.totalFeeUsdt,
  summary: "脱敏验收数据：展示真实产品复盘结构，不对应任何真实账户交易。",
  deepReflection: "证据、风险约束和执行结果均保持独立呈现。",
  rootCause: index === 1 ? "事件窗口内入场时机偏早。" : "结构确认与保护条件执行一致。",
  improvement: "下一次同类机会继续保留确认与保护证据。",
  lesson: "先验证风险收益比，再申请执行。", confidence: 78 + index,
  createdAt: trade.closedAt, completedAt: trade.closedAt, updatedAt: trade.closedAt
}));

const data = {
  ...productionShellBrowserFixture,
  resourceState: { ...loadedResourceState },
  user: { id: "review-owner", name: "界面审阅账户", displayName: "界面审阅账户", isOwner: true, tenantName: "KORDYN 脱敏验收环境" },
  system: { mode: "confirm_each", killSwitch: false, autonomyEnabled: true, liveTradingEnabled: false, remainingDailyLossUsdt: 1360, dailyGoalUsdt: 500, monthlyGoalUsdt: 15000, apiHealth: "healthy", dataFreshnessState: "fresh", dataFreshnessMs: 120, latencyMs: 18, updatedAt: now },
  automationState: { mode: "observe", label: "观察运行", detail: "脱敏界面审阅环境，不会提交真实交易。", updatedAt: now },
  portfolio: { totalEquityUsdt: 72450.82, todayPnl: 826.42, todayPnlPct: 1.15, unrealizedPnl: 786.85, availableMarginUsdt: 56540.13, frozenMarginUsdt: 0, updatedAt: now },
  markets,
  activeMarket: markets[0],
  watchlist: markets.map((row) => row.symbol),
  positions,
  accountSnapshots: Array.from({ length: 32 }, (_, index) => ({ id: `snapshot-${index}`, createdAt: iso(-32 + index), totalEquityUsdt: 69800 + index * 82 + Math.round(Math.sin(index / 3) * 140), source: "synthetic_review_fixture" })),
  executionOrders,
  fills,
  closedTradeLifecycles,
  reviews,
  performance: { trades: 26, totalPnlUsdt: 293.0, winRatePct: 65.4, profitFactor: 1.82, avgPnlUsdt: 11.27, maxDrawdownPct: 4.6 },
  behaviorProfile: { strengths: ["保护条件执行一致", "交易前证据完整"], flags: [{ key: "event", title: "事件窗口时机", detail: "高影响事件前减少主动风险。" }] },
  tradePlans: [
    { id: "plan-btc", symbol: "BTC/USDT", direction: "long", status: "awaiting_approval", strategy: "breakout-v4", confidence: 82, entryPrice: 113600, stopLoss: 110900, takeProfit: [118400], createdAt: iso(-1) },
    { id: "plan-eth", symbol: "ETH/USDT", direction: "long", status: "risk_checked", strategy: "trend-follow", confidence: 76, entryPrice: 4350, stopLoss: 4210, takeProfit: [4550], createdAt: iso(-2) }
  ],
  riskChecks: [{ id: "risk-check-1", tradePlanId: "plan-btc", status: "passed", summary: "订单规模、杠杆和事件窗口检查通过。", createdAt: iso(-1) }],
  pendingActions: [{ id: "pending-1", title: "确认 BTC/USDT 交易计划", status: "pending", createdAt: iso(-1) }],
  events: [
    { id: "event-cpi", title: "美国 CPI 公布", shortTitle: "CPI", category: "宏观", status: "scheduled", due: iso(28), startAt: iso(28), impact: 100, confidence: 94, source: "U.S. BLS", relatedSymbols: ["BTC/USDT", "ETH/USDT"], evidenceId: "evidence-cpi" },
    { id: "event-fomc", title: "FOMC 官员讲话", shortTitle: "FOMC", category: "宏观", status: "scheduled", due: iso(43), startAt: iso(43), impact: 85, confidence: 88, source: "Federal Reserve", relatedSymbols: ["BTC/USDT"], evidenceId: "evidence-fomc" }
  ],
  eventRiskWindows: [{ id: "risk-window-cpi", eventId: "event-cpi", title: "美国 CPI 公布", sourceId: "official_bls", sourceName: "U.S. BLS", dueAt: iso(28), deltaMs: 600000, phase: "pre_release_blackout", blocking: true, impact: 100, marketWide: true, verified: true, evidenceId: "evidence-control-cpi" }],
  watchTriggers: [
    { id: "watch-btc", symbol: "BTC/USDT", status: "active", priority: "primary", purpose: "confirmation", direction: "long", kind: "price_above", level: 114200, thesis: "等待价格突破并由成交结构确认。", triggerMeaning: "重新检查结构与风险收益比。", createdAt: iso(-3), analysisAt: iso(-1), expiresAt: iso(12) },
    { id: "watch-eth", symbol: "ETH/USDT", status: "active", priority: "primary", purpose: "invalidation", direction: "long", kind: "price_below", level: 4210, thesis: "趋势仍偏多，但失效位必须保持。", triggerMeaning: "触发后撤销当前方向判断。", createdAt: iso(-4), analysisAt: iso(-2), expiresAt: iso(18) }
  ],
  abnormalVolatility: [{ symbol: "BTC/USDT", status: "normal", realizedMovePct: 1.4, riskScore: 24, caveat: "当前未触发异常波动阈值。" }, { symbol: "SOL/USDT", status: "elevated", realizedMovePct: -4.2, riskScore: 71, caveat: "流动性和杠杆变化需要继续观察。" }],
  newsFeed: [{ id: "news-1", title: "美国通胀数据公布窗口临近", sourceName: "ME News", publishedAt: iso(-1), confidence: 91, symbols: ["BTC/USDT"], values: { important: true, impact: 85 } }],
  marketMovers: { scannedAt: now, movers: markets.map((row) => ({ symbol: row.symbol, changePct: row.changePct })) },
  marketRegime: { summary: "趋势偏多，但宏观事件窗口临近，维持确认优先。", global: { label: "趋势偏多 · 波动扩张", summary: "市场广度改善，但事件风险尚未解除。", confidence: 78, breadthPct: 64, advancing: 42, instruments: 66 }, smartMoney: { topTraderLongShortRatio: 1.36 }, updatedAt: now },
  mediumTermAnalytics: { symbols: markets.map((row) => ({ symbol: row.symbol, windows: { "15m": { status: "ok", leverageState: "long_build", priceChangePct: 0.8, oiChangePct: 1.4, fundingEndPct: 0.008, cvdImbalancePct: 7.2 }, "1h": { status: "ok", leverageState: "long_build_crowded", priceChangePct: 1.6, oiChangePct: 2.1, fundingEndPct: 0.009, cvdImbalancePct: 12.4 }, "4h": { status: "ok", leverageState: "stable_or_mixed", priceChangePct: 2.4, oiChangePct: 1.2, fundingEndPct: 0.008, cvdImbalancePct: 5.1 } } })) },
  knowledge: {
    sources: [{ id: "source-book", title: "交易纪律手册（脱敏示例）", type: "document", status: "indexed" }, { id: "source-doctrine", title: "账户风险条令", type: "doctrine", status: "active" }],
    tradingMethods: [{ id: "method-1", name: "突破确认法", category: "entry", status: "recorded" }],
    candidates: [{ id: "candidate-1", name: "事件窗口降杠杆", type: "workflow", status: "candidate" }],
    tradingSkills: [{ id: "skill-knowledge", name: "结构确认", kind: "analysis", status: "active", enabled: true, scanStatus: "passed", backtestStatus: "passed" }],
    ruleProposals: [{ id: "rule-doctrine", name: "禁止无止损开仓", status: "approved", rule: "任何新风险必须同时具备有效保护条件。" }],
    lenses: [{ id: "lens-1", name: "风险优先透镜", active: true, description: "先解释风险，再解释机会。" }],
    conceptCards: [{ id: "concept-1", name: "市场结构" }, { id: "concept-2", name: "事件风险" }, { id: "concept-3", name: "执行纪律" }]
  },
  memoryItems: [{ id: "memory-1", name: "CPI 前降低风险", category: "review", status: "recorded" }],
  skills: [
    { id: "capability-risk", name: "确定性风险检查", kind: "analysis", status: "active", enabled: true, native: true, version: "2.1", source: "system", permission: "guarded", runs: 286, lastRunAt: iso(-1) },
    { id: "capability-reconcile", name: "成交对账工作流", kind: "workflow", status: "active", enabled: true, native: true, version: "1.8", source: "system", permission: "operator", runs: 94, lastRunAt: iso(-2) },
    { id: "capability-mcp", name: "研究数据 MCP", kind: "MCP", status: "connected", enabled: true, version: "1.0", source: "registry", permission: "read_only", runs: 33, lastRunAt: iso(-4) }
  ],
  strategyCatalog: {
    products: [{ id: "breakout", versionId: "breakout@4", version: 4, definition: { name: "突破确认策略", description: "价格、量能和风险收益共同确认。" }, deployment: { state: "owner_live_observation" } }, { id: "trend", versionId: "trend@2", version: 2, definition: { name: "趋势跟随策略" }, deployment: { state: "validated_active" } }],
    strategies: [{ id: "mean-reversion", name: "均值回归研究", lifecycle: { stage: "research" }, contract: { direction: "both" } }],
    research: [{ id: "research-1", name: "波动率过滤研究", status: "running" }]
  },
  strategyStudio: { drafts: [{ id: "draft-1", name: "事件风险过滤器", status: "draft", updatedAt: now }] },
  backtestResearch: { historical: [{ id: "validation-historical", name: "突破策略 OOS", symbol: "BTC/USDT", timeframe: "1h", status: "passed", trades: 64, expectancyR: 0.31, profitFactor: 1.48, maxDrawdownPct: 7.8 }], forward: [{ id: "validation-forward", name: "趋势策略纯前向", symbol: "ETH/USDT", status: "running", trades: 18, expectancyR: 0.18 }] },
  backtests: [{ id: "backtest-1", status: "passed" }],
  mandates: [{ id: "mandate-main", name: "主账户交易授权", status: "active", version: 3, maxOrderNotionalUsdt: 5000, maxLeverage: 3, maxDailyLossUsdt: 1500, symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"] }],
  riskRules: [{ id: "risk-rule-1", name: "单笔名义金额上限", status: "active", enabled: true, threshold: 5000, updatedAt: now }, { id: "risk-rule-2", name: "事件窗口禁止新开仓", status: "active", enabled: true, updatedAt: now }],
  riskIncidents: [{ id: "incident-1", title: "SOL 波动风险升高", status: "open", severity: "high", source: "market_guard", createdAt: iso(-1) }],
  exchangeAccounts: [{ id: "exchange-okx", exchange: "OKX", connected: true, readEnabled: true, tradeEnabled: false, noWithdrawConfirmed: true, source: "synthetic_review_fixture", updatedAt: now }],
  tasks: [{ id: "task-reconcile", name: "成交对账", title: "成交对账", status: "running", enabled: true, type: "Every", handler: "reconcile", schedule: "Every 5m" }, { id: "task-events", name: "事件源同步", title: "事件源同步", status: "healthy", enabled: true, type: "Every", handler: "event_refresh", schedule: "Every 15m" }],
  jobRuns: [{ id: "run-reconcile", taskId: "task-reconcile", taskName: "成交对账", status: "completed", finishedAt: iso(-1), durationMs: 182 }, { id: "run-events", taskId: "task-events", taskName: "事件源同步", status: "completed", finishedAt: iso(-2), durationMs: 243 }],
  auditLogs: [{ id: "audit-1", action: "ORDER_AUTHORIZED", actor: "Owner", resource: "plan-btc", status: "recorded", createdAt: iso(-1), hash: "sha256:review-audit-1", context: { source: "synthetic_review_fixture" } }, { id: "audit-2", action: "RECONCILIATION_COMPLETED", actor: "System", resource: "account-main", status: "recorded", createdAt: iso(-2), hash: "sha256:review-audit-2" }],
  notifications: [{ id: "notification-1", title: "事件风险窗口即将开始", message: "CPI 公布前暂停增加主动风险。", category: "风控", severity: "high", source: "event_guard", read: false, createdAt: iso(-1) }, { id: "notification-2", title: "账户对账完成", message: "账户余额、持仓和委托事实一致。", category: "系统", severity: "normal", source: "reconciler", read: true, createdAt: iso(-2) }],
  eventSources: [{ id: "source-bls", name: "U.S. BLS", type: "official", status: "healthy", enabled: true, lastSuccessAt: iso(-2) }, { id: "source-fed", name: "Federal Reserve", type: "official", status: "healthy", enabled: true, lastSuccessAt: iso(-3) }],
  agentProfiles: [{ id: "agent-trader", order: 1, name: "主交易 Agent", role: "交易决策", mission: "基于证据形成计划并遵守硬风控。", declaration: "不越权、不编造、不绕过确认。", personality: "克制、审慎、证据优先", status: "active", enabled: true, model: "configured-model", boundaries: ["不得绕过硬风控", "不得读取密钥原文"] }],
  users: [{ id: "review-owner", name: "界面审阅账户", email: "review@example.invalid", role: "owner", status: "active" }],
  subscriptions: [{ id: "subscription-1", userId: "review-owner", planName: "Owner", status: "active", startedAt: iso(-720), expiresAt: iso(720) }],
  readiness: { operatingStage: { label: "运行就绪" } },
  config: { runtime: { environment: "review" }, llm: { activeProvider: "Configured provider", embeddingModel: "Configured embedding", providers: { primary: { hasKey: true } } }, integrations: { alerts: { hasWebhook: true } } },
  analysisEngine: { toolUsageStatsSince: iso(-720) },
  larkConfigured: true,
  telegramConfigured: false,
  reconciliationReports: [{ id: "reconcile-1", status: "completed", createdAt: iso(-1) }]
};

class InertWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) { this.url = url; this.readyState = InertWebSocket.CLOSED; }
  close() {}
  send() {}
  addEventListener() {}
  removeEventListener() {}
}
window.WebSocket = InertWebSocket;

window.fetch = async (input) => {
  const url = new URL(typeof input === "string" ? input : input?.url || "", location.origin);
  if (url.pathname === "/api/market/instruments") return Response.json({ instruments: markets.map((row) => ({ symbol: row.symbol })) });
  if (url.pathname === "/api/market/klines") return Response.json({ candles: [] });
  if (url.pathname === "/api/agent/chat") return Response.json({ messages: [], sessions: [], activeSessionId: "review-session" });
  if (url.pathname.startsWith("/api/assistant/")) return Response.json({ reply: "脱敏审阅环境中的只读示例回复。", citations: ["当前界面数据"] });
  return Response.json({ ok: true });
};

const search = new URLSearchParams(location.search);
const requestedRoute = search.get("route") || "chat";
const requestedPanel = search.get("panel") || "";
history.replaceState({ captureRoute: requestedRoute }, "", `${appPathForRoute(requestedRoute)}?captureRoute=${encodeURIComponent(requestedRoute)}`);

const action = async (path, payload, method = "POST") => {
  (window.__uiReviewActions ||= []).push({ path, payload, method });
  return { ok: true };
};
const api = {
  data,
  action,
  toast: "",
  busy: false,
  notify(message) { window.__uiReviewNotice = message; },
  download() {},
  refresh() {},
  ensureSection() {},
  connectionError: "",
  isNativeApp: false
};

createRoot(document.getElementById("root")).render(
  <React.Suspense fallback={<div className="authenticatedEntryLoading">正在准备交易工作区</div>}>
    <August15AuthenticatedShell api={api} lang="zh" switchLang={() => {}} />
    {requestedPanel && <ConfigPanel panel={requestedPanel} data={data} action={action} ui={{ closePanel() {}, openPanel() {}, notify: api.notify }} />}
  </React.Suspense>
);
window.__currentUiInventoryReady = true;
