import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import "dotenv/config";
import { currentRequestContext } from "./requestContext.mjs";
import { backfillToolUsage, migrateToolUsageStats } from "./toolUsage.mjs";
import { syncNativeStrategyProducts } from "./strategyProducts.mjs";
import { applyDerivedProfitGoals } from "./profitGoals.mjs";
import { clearReduceOnlyReason, setReduceOnlyReason } from "./reduceOnlyState.mjs";
import { scrubSecrets } from "./secretRedaction.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// 全部权限清单（种子）。
export const ALL_PERMISSIONS = [
  "market.read", "account.read", "trade.write_guarded", "risk.check", "risk.kill_switch",
  "write:mandate", "write:trade_plan", "write:risk", "write:risk_thresholds", "write:knowledge", "write:skills",
  "write:event", "write:exchange", "write:realtime", "write:review", "write:mcp", "write:task",
  "admin:security", "admin:system", "critical:trade_execution", "critical:kill_switch",
  "approve:trade_plan", "approve:live_config", "approve:knowledge_skill",
  "knowledge.read", "knowledge.write", "skill.install", "mcp.register", "audit.read", "trace.read", "audit.export"
];

// 最小权限交易员：可以研究、创建计划和请求风控，但不能管理密钥/插件，
// 也不能直接跨过“批准者/执行者”职责边界。Owner 仍通过管理员角色拥有全部权限。
export const TRADER_PERMISSIONS = [
  "market.read", "account.read", "risk.check", "knowledge.read", "knowledge.write",
  "assistant.use",
  "write:mandate", "write:trade_plan", "write:risk_thresholds", "write:knowledge",
  "write:event", "write:review", "write:task"
];
const dataDir = path.resolve(rootDir, process.env.DATA_DIR || "data");
const jsonDbPath = path.join(dataDir, "db.json");
const sqliteDbPath = path.join(dataDir, "trading-agent.sqlite");
const defaultOwnerEmail = process.env.OWNER_EMAIL || "aliarlan1028@gmail.com";
const collectionNames = [
  "meta",
  "assistantMemory",
  "user",
  "tenants",
  "users",
  "roles",
  "permissions",
  "subscriptionPlans",
  "subscriptions",
  "subscriptionTerms",
  "paymentRequests",
  "paymentWebhooks",
  "registrationApplications",
  "registrationInvites",
  "registrationRateLimits",
  "authSessions",
  "system",
  "portfolio",
  "markets",
  "watchlist",
  "watchTriggers",
  "armedSetups",
  "opportunityCandidates",
  "opportunityEvents",
  "missedOpportunities",
  "marketFeatureState",
  "eventVolatilityObservations",
  "marketNarratives",
  "structureAnalysisCache",
  "mandates",
  "positions",
  "orders",
  "fills",
  "tradePlans",
  "events",
  "marketIntelligenceFacts",
  "marketCalendarEvents",
  "marketIntelligenceSourceHealth",
  "dailyBriefs",
  "telegramWatchOutbox",
  "telegramPosterOutbox",
  "tasks",
  "jobRuns",
  "jobLocks",
  "knowledge",
  "analysisBundles",
  "evidenceBundles",
  "backtests",
  "skills",
  "tools",
  "mcpServers",
  "exchangeAccounts",
  "apiKeyMetadata",
  "accountSnapshots",
  "accountingAnchors",
  "realtimeConnections",
  "reconciliationReports",
  "vaultItems",
  "runtimeConfig",
  "clearedRuntimeSecrets",
  "toolCallStats",
  "alerts",
  "drillRuns",
  "grayReleasePolicies",
  "llmRuns",
  "agentSteps",
  "agentToolCalls",
  "tradeIntents",
  "executionOrders",
  "exchangeOrders",
  "reviewReports",
  "strategyExperiments",
  "strategyVersions",
  "strategyDeployments",
  "strategyVersionEvents",
  "strategyStudioDrafts",
  "strategyBlueprintVersions",
  "strategyStudioBacktests",
  "strategyMarketplaceListings",
  "strategyAssignments",
  "eventImpacts",
  "toolExecutions",
  "eventSources",
  "skillRuns",
  "riskRules",
  "riskChecks",
  "riskIncidents",
  "notifications",
  "agentProfiles",
  "agentStateFiles",
  "memoryItems",
  "chatSessions",
  "chatMessages",
  "agentRuns",
  "decisionAuditRecords",
  "decisionFactSnapshots",
  "ownerImprovementItems",
  "reviews",
  "pendingActions"
];
// High-value trading objects are also persisted one row per entity. This avoids
// rewriting an entire JSON collection for every fill/order/risk update and gives
// tenant/resource indexes for recovery and future repository-only operation.
const entityCollectionNames = [
  "mandates", "positions", "orders", "fills", "tradePlans", "events", "tasks",
  "riskChecks", "riskIncidents", "executionOrders", "accountSnapshots",
  "reconciliationReports", "reviews", "agentRuns", "decisionFactSnapshots", "ownerImprovementItems", "paperSessions", "strategyProfiles",
  "armedSetups", "strategyVersions", "strategyDeployments", "strategyVersionEvents",
  "strategyStudioDrafts", "strategyBlueprintVersions", "strategyStudioBacktests",
  "strategyMarketplaceListings", "strategyAssignments"
];

let sqlite;

export function nowIso() {
  return new Date().toISOString();
}

export function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// trading_entities 重载顺序按 updated_at/resource_id，不等于业务 createdAt 顺序。
// 所有账户事实必须显式取 createdAt 最新的成功快照，禁止依赖数组第一个元素。
export function latestSuccessfulAccountSnapshot(db, filters = {}) {
  let latest = null;
  let latestAt = -Infinity;
  for (const snapshot of db.accountSnapshots || []) {
    if (snapshot?.status !== "ok") continue;
    // 兼容早期未写 exchange 字段的单账户快照；明确标成其他交易所的仍排除。
    if (filters.exchange && snapshot.exchange && snapshot.exchange !== filters.exchange) continue;
    if (filters.accountId && snapshot.accountId !== filters.accountId) continue;
    const timestamp = new Date(snapshot.createdAt || 0).getTime();
    const comparable = Number.isFinite(timestamp) ? timestamp : 0;
    if (!latest || comparable > latestAt) {
      latest = snapshot;
      latestAt = comparable;
    }
  }
  return latest;
}

function emptyKnowledge() {
  return {
    sources: [],
    conceptCards: [],
    ruleProposals: [],
    tradingMethods: [],
    tradingSkills: [],
    skillInvocations: [],
    skillAttributions: [],
    strategyHypotheses: [],
    reviewTemplates: [],
    sourceVersions: [],
    documentNodes: [],
    chunks: [],
    bookCards: [],
    chapterCards: [],
    theoryFrameworks: [],
    caseCards: [],
    conflicts: [],
    expertGraphNodes: [],
    expertGraphEdges: [],
    masteryTests: [],
    runtimeCitations: []
  };
}

function defaultAgentProfiles(createdAt) {
  const declaration = "我不是来替你冒险的，我是来把风险变得可见、可控、可复盘的。";
  return [
    {
      id: "agent_market_observer",
      order: 10,
      name: "市场观察员",
      role: "Market Observer",
      phase: "observe",
      enabled: true,
      canProposeTrade: false,
      canApproveRisk: false,
      canExecuteTrade: false,
      tools: ["market.read", "event.read"],
      declaration,
      personality: "冷静、克制、证据优先；只描述市场状态，不把噪声包装成机会。",
      mission: "读取行情、资金费率、成交量、波动率和订单簿，形成结构化市场观察。",
      boundaries: ["不得给出下单指令", "必须标注数据来源与同步时间", "证据不足时输出继续观察"],
      outputSchema: "market_observation",
      memoryPolicy: "只写入高置信、可复盘的市场状态变化。",
      createdAt
    },
    {
      id: "agent_event_analyst",
      order: 20,
      name: "事件分析员",
      role: "Event Analyst",
      phase: "event",
      enabled: true,
      canProposeTrade: false,
      canApproveRisk: false,
      canExecuteTrade: false,
      tools: ["event.read", "knowledge.query", "market.read"],
      declaration,
      personality: "警觉、保守、重视尾部风险；宁可提前降噪，也不忽略黑天鹅。",
      mission: "分析宏观、链上、交易所公告和突发新闻对授权交易对的影响。",
      boundaries: ["不得独立生成交易计划", "高影响事件必须触发风险提示", "必须区分事实、推断和未知"],
      outputSchema: "event_impact_assessment",
      memoryPolicy: "记录事件前后市场反应和误判来源。",
      createdAt
    },
    {
      id: "agent_macro_strategist",
      order: 25,
      name: "宏观环境分析员",
      role: "Macro Regime Analyst",
      phase: "macro_context",
      enabled: true,
      canProposeTrade: false,
      canApproveRisk: false,
      canExecuteTrade: false,
      tools: ["event.read", "market.read", "knowledge.query"],
      declaration,
      personality: "重证据、重时效、区分事实与推断；不会用宏观叙事替代入场信号。",
      mission: "识别流动性、增长、通胀与风险偏好的环境，给日内和波段角色提供情景背景。",
      boundaries: ["只输出背景与情景，不直接生成订单", "必须标注数据缺口和置信度", "未来事件不得冒充今日新闻"],
      outputSchema: "macro_regime_context",
      memoryPolicy: "只沉淀已被后续市场验证的宏观情景，不把临时观点写成事实。",
      createdAt
    },
    {
      id: "agent_strategy_researcher",
      order: 30,
      name: "策略研究员",
      role: "Strategy Researcher",
      phase: "research",
      enabled: true,
      canProposeTrade: false,
      canApproveRisk: false,
      canExecuteTrade: false,
      tools: ["knowledge.query", "market.read", "review.read"],
      declaration,
      personality: "好奇但不冲动；把假设当假设，把证据当证据。",
      mission: "从知识库、历史复盘和行情结构中提出可验证的交易假设。",
      boundaries: ["不得跳过样本和失败条件", "不得把研究结论直接变成订单", "必须写清失效条件"],
      outputSchema: "strategy_hypothesis",
      memoryPolicy: "把被验证或被否定的策略假设写入长期记忆。",
      createdAt
    },
    {
      id: "agent_trade_planner",
      order: 40,
      name: "交易计划员",
      role: "Trade Planner",
      phase: "planning",
      enabled: true,
      canProposeTrade: true,
      canApproveRisk: false,
      canExecuteTrade: false,
      tools: ["market.read", "risk.check", "mandate.read"],
      declaration,
      personality: "结构化、耐心、尊重授权边界；没有止损就不算计划。",
      mission: "把交易假设转成结构化计划：方向、入场、止损、止盈、杠杆、仓位理由。",
      boundaries: ["必须包含止损", "必须绑定授权委托", "必须交给风控官审查", "不得直接调用交易写接口"],
      outputSchema: "trade_plan",
      memoryPolicy: "记录计划参数与最终表现之间的差异。",
      createdAt
    },
    {
      id: "agent_day_trader",
      order: 42,
      name: "日内交易员",
      role: "Day Trader",
      phase: "horizon_planning",
      enabled: true,
      canProposeTrade: true,
      canApproveRisk: false,
      canExecuteTrade: false,
      tools: ["market.read", "event.read", "risk.check", "mandate.read"],
      declaration,
      personality: "反应快但不追价；关注 5m/15m 入场质量、流动性和当日事件窗口。",
      mission: "构造当日结束的短周期计划，并将等待条件编译为代码可验证规则。",
      boundaries: ["计划周期仅 5m/15m/1h", "等待计划最长12小时", "不得绕过组合裁决和统一风控"],
      outputSchema: "intraday_trade_plan",
      memoryPolicy: "按时段、滑点、入场延迟和当日波动环境复盘。",
      createdAt
    },
    {
      id: "agent_swing_trader",
      order: 44,
      name: "波段交易员",
      role: "Swing Trader",
      phase: "horizon_planning",
      enabled: true,
      canProposeTrade: true,
      canApproveRisk: false,
      canExecuteTrade: false,
      tools: ["market.read", "event.read", "risk.check", "mandate.read"],
      declaration,
      personality: "耐心、结构优先；以 4H/1D 方向为主，用较低周期改善入场。",
      mission: "构造可跨日持有的波段计划，明确周期、失效位和事件风险。",
      boundaries: ["计划周期仅 1h/4h/1d", "等待计划最长48小时", "不得把长期叙事当即时入场信号"],
      outputSchema: "swing_trade_plan",
      memoryPolicy: "按市场周期、持有时长、最大不利波动和退出质量复盘。",
      createdAt
    },
    {
      id: "agent_portfolio_arbiter",
      order: 48,
      name: "组合裁决员",
      role: "Portfolio Arbiter",
      phase: "portfolio_arbitration",
      enabled: true,
      canProposeTrade: false,
      canApproveRisk: false,
      canExecuteTrade: false,
      tools: ["account.read", "risk.check", "mandate.read"],
      declaration,
      personality: "机械、中立、全局优先；不允许不同角色各自正确却让组合互相打架。",
      mission: "在计划落库和执行前检查同币种方向冲突、共享敞口与授权容量。",
      boundaries: ["不得修改风险阈值", "不得替代硬风控", "冲突必须给出可追溯的计划或持仓ID"],
      outputSchema: "portfolio_intent_decision",
      memoryPolicy: "记录被拒绝的角色冲突和最终处理方式。",
      createdAt
    },
    {
      id: "agent_risk_officer",
      order: 50,
      name: "风控官",
      role: "Risk Officer",
      phase: "risk_checking",
      enabled: true,
      canProposeTrade: false,
      canApproveRisk: true,
      canExecuteTrade: false,
      tools: ["risk.check", "account.read", "audit.read"],
      declaration,
      personality: "怀疑、严格、保护型；默认先问这笔交易怎么亏。",
      mission: "检查授权边界、单笔风险、日亏损、杠杆、事件窗口、相关性和止损。",
      boundaries: ["只能批准/拒绝/要求降风险", "不得为了收益放宽硬规则", "风控失败必须写审计"],
      outputSchema: "risk_decision",
      memoryPolicy: "把被拦截计划和真实损失案例沉淀为风控经验。",
      createdAt
    },
    {
      id: "agent_execution_supervisor",
      order: 60,
      name: "执行监督员",
      role: "Execution Supervisor",
      phase: "execution",
      enabled: true,
      canProposeTrade: false,
      canApproveRisk: false,
      canExecuteTrade: false,
      tools: ["execution.read", "order.read", "risk.check"],
      declaration,
      personality: "谨慎、机械、关注细节；只相信执行引擎和交易所回执。",
      mission: "监督计划进入执行引擎后的订单状态、滑点、保护单、撤单和平仓条件。",
      boundaries: ["不能绕过执行引擎", "不能直接下单", "订单异常必须升级给风控官"],
      outputSchema: "execution_supervision",
      memoryPolicy: "记录滑点、拒单、保护单失败等执行质量问题。",
      createdAt
    },
    {
      id: "agent_position_manager",
      order: 70,
      name: "持仓管理员",
      role: "Position Manager",
      phase: "position_management",
      enabled: true,
      canProposeTrade: false,
      canApproveRisk: false,
      canExecuteTrade: false,
      tools: ["account.read", "position.read", "risk.check"],
      declaration,
      personality: "防守优先、少做动作；盈利时保护利润，亏损时尊重止损。",
      mission: "监控已有仓位，建议移动止损、减仓、止盈或关闭风险仓位。",
      boundaries: ["加仓默认禁止", "只能建议降风险动作", "不得扩大未授权风险敞口"],
      outputSchema: "position_management_advice",
      memoryPolicy: "记录持仓管理动作对回撤和利润回吐的影响。",
      createdAt
    },
    {
      id: "agent_review_memory",
      order: 80,
      name: "复盘/记忆管理员",
      role: "Review & Memory Manager",
      phase: "review",
      enabled: true,
      canProposeTrade: false,
      canApproveRisk: false,
      canExecuteTrade: false,
      tools: ["review.write", "knowledge.write", "memory.write"],
      declaration,
      personality: "诚实、细致、不找借口；把亏损变成规则，把盈利变成可验证方法。",
      mission: "交易后总结原因、执行质量、错误类型，并决定是否写入长期记忆或更新规则。",
      boundaries: ["不得篡改历史记录", "不得只记录盈利样本", "复盘结论必须可验证"],
      outputSchema: "review_memory_update",
      memoryPolicy: "负责长期记忆质量，定期清理低质量或过期经验。",
      createdAt
    }
  ];
}

function defaultSubscriptionPlans(createdAt) {
  return [
    { id: "plan_monthly", name: "月度订阅", interval: "month", months: 1, priceUsdt: 49, enabled: true, features: ["交易驾驶舱", "Agent 团队", "知识库", "基础通知"], createdAt },
    { id: "plan_quarterly", name: "季度订阅", interval: "quarter", months: 3, priceUsdt: 129, enabled: true, features: ["月度全部功能", "季度复盘模板"], createdAt },
    { id: "plan_half_year", name: "半年订阅", interval: "half_year", months: 6, priceUsdt: 239, enabled: true, features: ["季度全部功能", "优先功能体验"], createdAt },
    { id: "plan_yearly", name: "年度订阅", interval: "year", months: 12, priceUsdt: 399, enabled: true, features: ["半年全部功能", "年度策略复盘"], createdAt }
  ];
}

function cleanSeedDatabase(createdAt) {
  const hasOkx = Boolean(process.env.OKX_API_KEY);
  const hasOkxSecret = Boolean(process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE);
  return {
    meta: { version: 1, createdAt, updatedAt: createdAt },
    user: {
      id: "user_local_admin",
      tenantId: "tenant_owner",
      name: "Owner",
      email: defaultOwnerEmail,
      role: "管理员",
      riskMode: "medium",
      locale: "zh-CN"
    },
    tenants: [{ id: "tenant_owner", name: "Owner 工作区", ownerUserId: "user_local_admin", planId: "owner", status: "owner", createdAt }],
    users: [{ id: "user_local_admin", tenantId: "tenant_owner", name: "Owner", email: defaultOwnerEmail, role: "管理员", status: "active", isOwner: true, createdAt }],
    roles: [
      { id: "role_admin", name: "管理员", permissions: ["*"] },
      { id: "role_trader", name: "交易用户", permissions: TRADER_PERMISSIONS },
      { id: "role_auditor", name: "审计员", permissions: ["audit.read", "trace.read"] }
    ],
    permissions: [
      "market.read", "account.read", "trade.write_guarded", "risk.check", "risk.kill_switch",
      "write:mandate", "write:trade_plan", "write:risk", "write:knowledge", "write:skills",
      "write:event", "write:exchange", "write:realtime", "write:review", "write:mcp", "write:task",
      "admin:security", "admin:system", "critical:trade_execution", "critical:kill_switch",
      "approve:knowledge_skill",
      "knowledge.read", "knowledge.write", "assistant.use", "skill.install", "mcp.register", "audit.export"
    ],
    subscriptionPlans: defaultSubscriptionPlans(createdAt),
    subscriptions: [{ id: "sub_owner", tenantId: "tenant_owner", userId: "user_local_admin", planId: "owner", status: "active", source: "owner_grant", startedAt: createdAt, currentPeriodEnd: null }],
    subscriptionTerms: [],
    paymentRequests: [],
    paymentWebhooks: [],
    registrationApplications: [],
    registrationInvites: [],
    registrationRateLimits: [],
    authSessions: [],
    system: {
      // Every product mode runs the analysis loop. Whether orders are submitted
      // is decided exclusively by requestedOperatingMode, not a second pause
      // switch layered on top of it.
      autonomyEnabled: true,
      liveTradingEnabled: false,
      requestedOperatingMode: "observe",
      operatingModeSchemaVersion: 2,
      dailyGoalUsdt: null,
      monthlyGoalUsdt: null,
      dailyGoalBreakevenEnabled: false,
      killSwitch: false,
      apiHealth: "待配置",
      riskStatus: "等待配置",
      latestAction: "等待配置交易所 API 与 LLM API",
      remainingDailyLossUsdt: null
    },
    portfolio: {
      // 全部初始为 null——缺失即"未同步/未评估"，由前端如实展示；
      // 尤其 riskLabel 不能给 "未同步" 这种 truthy 字符串，否则会毒化前端"按真实分数回退"的逻辑。
      totalEquityUsdt: null,
      availableMarginUsdt: null,
      frozenMarginUsdt: null,
      todayPnl: null,
      todayPnlPct: null,
      weekPnl: null,
      weekPnlPct: null,
      maxDrawdownPct: null,
      riskScore: null,
      riskLabel: null
    },
    markets: [
      { symbol: "BTC/USDT", status: "not_synced", candles: [] },
      { symbol: "ETH/USDT", status: "not_synced", candles: [] },
      { symbol: "SOL/USDT", status: "not_synced", candles: [] }
    ],
    watchlist: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    watchTriggers: [],
    armedSetups: [],
    opportunityCandidates: [],
    opportunityEvents: [],
    missedOpportunities: [],
    marketFeatureState: {},
    mediumTermSamples: [],
    eventVolatilityObservations: [],
    marketNarratives: {},
    structureAnalysisCache: {},
    mandates: [],
    positions: [],
    orders: [],
    fills: [],
    tradePlans: [],
    events: [],
    marketIntelligenceFacts: [],
    marketCalendarEvents: [],
    marketIntelligenceSourceHealth: {},
    dailyBriefs: [],
    telegramWatchOutbox: [],
    telegramPosterOutbox: [],
    tasks: [],
    jobRuns: [],
    jobLocks: [],
    knowledge: emptyKnowledge(),
    analysisBundles: [],
    evidenceBundles: [],
    skills: [],
    tools: [
      { id: "tool_okx", name: "OKX Connector", type: "exchange", status: hasOkx ? "configured" : "missing_credentials", permissions: ["market.read", "account.read", "trade.write_guarded"] },
      { id: "tool_llm", name: "Gemini + DeepSeek Agent", type: "model", status: process.env.OPENROUTER_API_KEY && process.env.DEEPSEEK_API_KEY ? "configured" : "missing_credentials", permissions: ["agent.reasoning", "agent.critic"] },
      { id: "tool_public_market", name: "Public Market Data", type: "data", status: "available_without_key", permissions: ["market.read"] }
    ],
    mcpServers: [],
    exchangeAccounts: [
      {
        id: "ex_okx_main",
        exchange: "OKX",
        label: "OKX 统一账户",
        accountType: "unified",
        readEnabled: hasOkx,
        tradeEnabled: hasOkx && hasOkxSecret,
        withdrawEnabled: false,
        ipWhitelist: "建议开启",
        status: hasOkx ? "configured" : "missing_credentials",
        lastReconciledAt: null
      }
    ],
    apiKeyMetadata: [
      { id: "key_okx", exchange: "OKX", accountId: "ex_okx_main", hasApiKey: hasOkx, hasSecret: hasOkxSecret, withdrawPermission: false, secretInLogs: false, updatedAt: createdAt }
    ],
    accountSnapshots: [],
    accountingAnchors: [],
    realtimeConnections: [
      { id: "rt_okx_public", exchange: "OKX", streamType: "public_market", status: "stopped", symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"], lastMessageAt: null, reconnects: 0 },
      { id: "rt_okx_private", exchange: "OKX", streamType: "private_user", status: hasOkx ? "stopped" : "missing_credentials", symbols: [], lastMessageAt: null, reconnects: 0 }
    ],
    reconciliationReports: [],
    vaultItems: [],
    runtimeConfig: {},
    clearedRuntimeSecrets: [],
    toolCallStats: {},
    alerts: [],
    drillRuns: [],
    grayReleasePolicies: [
      {
        id: "gray_live_small_notional",
        name: "小额度实盘灰度",
        enabled: false,
        maxNotionalUsdt: Number(process.env.MAX_LIVE_NOTIONAL_USDT || 50),
        allowedSymbols: ["BTC/USDT", "ETH/USDT"],
        requiresManualApproval: true,
        createdAt
      }
    ],
    llmRuns: [],
    agentSteps: [],
    agentToolCalls: [],
    tradeIntents: [],
    executionOrders: [],
    exchangeOrders: [],
    reviewReports: [],
    strategyExperiments: [],
    strategyVersions: [],
    strategyDeployments: [],
    strategyVersionEvents: [],
    strategyStudioDrafts: [],
    strategyBlueprintVersions: [],
    strategyStudioBacktests: [],
    strategyMarketplaceListings: [],
    strategyAssignments: [],
    eventImpacts: [],
    toolExecutions: [],
    eventSources: [
      { id: "src_binance_ann", name: "Binance 公告", type: "html", url: "https://www.binance.com/en/support/announcement", enabled: true, trustScore: 82 },
      { id: "src_okx_ann", name: "OKX 公告", type: "html", url: "https://www.okx.com/help/section/announcements-latest-announcements", enabled: true, trustScore: 82 },
      { id: "src_fed_press", name: "Federal Reserve Press Releases", type: "rss", url: "https://www.federalreserve.gov/feeds/press_all.xml", enabled: true, trustScore: 92 }
    ],
    skillRuns: [],
    riskRules: [
      { id: "risk_stop_required", name: "自主交易必须带止损", scope: "trade", level: "L4", enabled: true, systemManaged: true, action: "reject_entry", enforcementStatus: "entry_enforced", description: "无止损交易计划不得进入执行器。" },
      { id: "risk_no_withdraw", name: "API Key 禁止提现权限", scope: "account", level: "L5", enabled: true, systemManaged: true, action: "reject_entry", enforcementStatus: "entry_enforced", description: "检测到提现权限时拒绝当前入场，并要求人工启用全局熔断。" }
    ],
    riskChecks: [],
    riskIncidents: [],
    notifications: [],
    agentProfiles: defaultAgentProfiles(createdAt),
    agentStateFiles: {
      USER: { id: "state_user", title: "USER.md", content: "尚未配置交易目标。请先配置交易所 API、模型 API，并创建授权委托。", updatedAt: createdAt },
      AGENT: { id: "state_agent", title: "AGENT.md", content: "Agent 当前处于待配置状态；真实交易必须经过 Mandate、RiskEngine、灰度策略与 live guard。", updatedAt: createdAt },
      HISTORY: { id: "state_history", title: "HISTORY.md", content: "暂无真实运行历史。", updatedAt: createdAt }
    },
    memoryItems: [],
    agentRuns: [],
    decisionAuditRecords: [],
    decisionFactSnapshots: [],
    ownerImprovementItems: [],
    reviews: [],
    auditLogs: [],
    traces: []
  };
}

export function seedDatabase() {
  return cleanSeedDatabase(nowIso());
}

export function loadDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  ensureSqlite();
  const sqliteState = loadFromSqlite();
  const normalized = sqliteState
    ? normalizeDatabase(sqliteState)
    : normalizeDatabase(fs.existsSync(jsonDbPath) ? JSON.parse(fs.readFileSync(jsonDbPath, "utf8")) : seedDatabase());
  Object.defineProperty(normalized, "__sqliteBacked", { value: true, enumerable: false, configurable: false });
  // 必须先只读校验审计链，再做任何常规保存。发现断裂只标记故障并进入只减仓，
  // 绝不通过重算历史 hash 让异常“看起来恢复正常”。
  inspectAuditChainIntegrity(normalized);
  saveDb(normalized);
  try {
    const pruned = pruneLogRetention(normalized); // 启动收口:裁掉超额日志行(trace>2万 / audit>5万)
    if (pruned.traceDeleted || pruned.auditDeleted) {
      appendTrace(normalized, "system", `日志保留裁剪:trace -${pruned.traceDeleted} 行、audit -${pruned.auditDeleted} 行`, "ok");
    }
  } catch { /* 裁剪失败不阻断启动 */ }
  return normalized;
}

// 部署预检专用：读取一致的 SQLite/WAL 快照，但绝不运行迁移、保存、裁剪或审计链自愈。
// 生产服务运行期间若用 loadDb() 做预检，会形成第二个写入者并让审计链分叉。
export function loadDbReadOnlySnapshot() {
  if (!fs.existsSync(sqliteDbPath)) throw new Error(`SQLite database not found: ${sqliteDbPath}`);
  const reader = new Database(sqliteDbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = reader.prepare("select name, value from collections").all();
    if (!rows.length) throw new Error("SQLite collections are empty");
    const db = {};
    for (const row of rows) db[row.name] = JSON.parse(row.value);
    // 候选版本预检会先以只读方式打开“旧版本”生产库；新表尚未由候选进程迁移时
    // 必须向后兼容，否则一次正常的新增表会反过来阻断部署。
    try {
      db.mediumTermSamples = reader.prepare("select doc from medium_term_samples where bucket_at >= ? order by bucket_at desc").all(Date.now() - 30 * 86_400_000).map((row) => JSON.parse(row.doc));
    } catch (error) {
      if (!/no such table:\s*medium_term_samples/i.test(String(error?.message || error))) throw error;
      db.mediumTermSamples = [];
    }
    const entityRows = reader.prepare(`
      select resource_type, doc from trading_entities
      order by resource_type asc, updated_at desc, resource_id asc
    `).all();
    if (entityRows.length) {
      const grouped = new Map();
      for (const row of entityRows) {
        if (!grouped.has(row.resource_type)) grouped.set(row.resource_type, []);
        grouped.get(row.resource_type).push(JSON.parse(row.doc));
      }
      for (const [resourceType, items] of grouped) db[resourceType] = items;
    }
    db.auditLogs = reader.prepare("select doc from audit_log_entries order by created_at desc, rowid desc limit 1000").all().map((row) => JSON.parse(row.doc));
    db.traces = reader.prepare("select doc from trace_entries order by created_at desc, rowid desc limit 1000").all().map((row) => JSON.parse(row.doc));
    return normalizeDatabase(db);
  } finally {
    reader.close();
  }
}

// 启动时只读校验。断链属于安全事件：保留原始证据、标记降级、阻断新的自动开仓。
// 历史链修复只能走 repairAuditChainExplicit，并且必须先产出原库备份。
function inspectAuditChainIntegrity(db) {
  db.meta ||= {};
  const result = verifyAuditChain(db);
  const tip = latestAuditHash();
  if (result.ok) {
    db.meta.auditChainBroken = false;
    db.meta.auditChainCheckedAt = nowIso();
    db.meta.auditChainCheckedEntries = result.checked;
    delete db.meta.auditChainBreaks;
    if (tip) db.meta.auditChainTip = tip;
    if (db.system?.reduceOnlyBy === "audit_chain_integrity") {
      db.system.reduceOnlyMode = false;
      db.system.reduceOnlyBy = null;
      db.system.riskStatus = "正常";
      db.system.latestAction = "审计链完整性已由可信状态恢复，恢复新开仓评估";
      for (const incident of db.riskIncidents || []) {
        if (incident.status === "open" && incident.source === "audit_chain_integrity") {
          incident.status = "resolved";
          incident.resolvedAt = nowIso();
          incident.resolvedBy = "AuditIntegrityCheck";
        }
      }
    }
    clearReduceOnlyReason(db, "audit_chain_integrity", { resolvedBy: "AuditIntegrityCheck", resolution: "audit_chain_verified" });
    return result;
  }
  db.meta.auditChainBroken = true;
  db.meta.auditChainDetectedAt ||= nowIso();
  db.meta.auditChainCheckedAt = nowIso();
  db.meta.auditChainCheckedEntries = result.checked;
  db.meta.auditChainBreaks = result.breaks.slice(0, 20);
  if (tip) db.meta.auditChainTip = tip; // 只移动后续追加锚点，不改写任何历史记录。
  db.system ||= {};
  db.system.reduceOnlyMode = true;
  db.system.reduceOnlyBy = "audit_chain_integrity";
  setReduceOnlyReason(db, "audit_chain_integrity", { sticky: true, sourceId: "AuditIntegrityCheck" });
  db.system.riskStatus = "审计链异常·暂停新开仓";
  db.system.latestAction = `审计链校验失败（${result.breaks.length} 处），已保留原始证据并禁止新开仓`;
  db.riskIncidents ||= [];
  if (!db.riskIncidents.some((item) => item.status === "open" && item.source === "audit_chain_integrity")) {
    db.riskIncidents.unshift({
      id: id("incident"), severity: "critical", status: "open", title: "审计哈希链完整性校验失败",
      source: "audit_chain_integrity", breakCount: result.breaks.length,
      detail: "系统未修改历史哈希；请先保存原库证据，再由管理员执行显式修复或恢复可信备份。",
      createdAt: nowIso()
    });
  }
  return result;
}

function latestAuditHash() {
  try {
    ensureSqlite();
    const row = sqlite.prepare("select doc from audit_log_entries order by rowid desc limit 1").get();
    return row ? JSON.parse(row.doc).hash || null : null;
  } catch {
    return null;
  }
}

// 危险运维操作：仅供显式修复命令使用。调用者必须先备份原始 SQLite 并传入确认语句。
function resealAuditChainForExplicitRepair(db) {
  ensureSqlite();
  const rows = sqlite.prepare("select rowid as rid, doc from audit_log_entries order by rowid asc").all();
  const update = sqlite.prepare("update audit_log_entries set doc = @doc, severity = @severity where rowid = @rid");
  let previous = null;
  const tx = sqlite.transaction(() => {
    for (const row of rows) {
      const entry = JSON.parse(row.doc);
      entry.prevHash = previous;
      entry.hash = auditHash(entry);
      update.run({ rid: row.rid, doc: JSON.stringify(entry), severity: entry.severity || "info" });
      previous = entry.hash;
    }
  });
  tx();
  db.meta ||= {};
  db.meta.auditChainTip = previous;
  db.meta.auditChainLastExplicitRepairAt = nowIso();
  db.auditLogs = sqlite.prepare("select doc from audit_log_entries order by created_at desc, rowid desc limit 1000").all().map((row) => JSON.parse(row.doc));
  return { resealed: rows.length, tip: previous };
}

export async function repairAuditChainExplicit(db, { acknowledgement, backupPath, actor = "SecurityAdmin" } = {}) {
  if (acknowledgement !== "I_HAVE_PRESERVED_THE_ORIGINAL_AUDIT_DATABASE") {
    throw new Error("缺少显式修复确认；不会重写任何审计哈希");
  }
  const destination = String(backupPath || "").trim();
  if (!destination) throw new Error("显式修复前必须提供原始 SQLite 备份路径");
  await backupSqlite(destination);
  const before = verifyAuditChain(db);
  const repaired = resealAuditChainForExplicitRepair(db);
  db.meta.auditChainBroken = false;
  delete db.meta.auditChainBreaks;
  appendAudit(db, `管理员显式重建审计链：修复前 ${before.breaks.length} 处断裂；原库备份 ${destination}`, "audit_chain", actor, "critical");
  saveDb(db);
  return { before, repaired, backupPath: destination, after: verifyAuditChain(db) };
}

// 日志型集合上限：防止长期累积把 saveDb 的全库序列化拖垮（曾累积到 accountSnapshots 22K / jobRuns 95K
// / jobLocks 90K，导致每次 saveDb 序列化上百 MB → 100% CPU + OOM）。超限时按时间戳保留最近 N 条。
const LOG_CAPS = {
  accountSnapshots: 500, jobRuns: 1000, reconciliationReports: 200, agentRuns: 300, decisionAuditRecords: 200,
  decisionFactSnapshots: 2000, ownerImprovementItems: 500,
  accountingAnchors: 4500,
  agentSteps: 800, agentToolCalls: 800, llmRuns: 500, toolExecutions: 500,
  executionOrders: 1000, exchangeOrders: 1000, skillRuns: 300, drillRuns: 200,
  eventImpacts: 500, reviewReports: 300, notifications: 500, riskChecks: 800, riskIncidents: 500,
  // 审计补:此前无上限、长期运行必然膨胀且每次 saveDb 全量重写的集合(fills 留足核算窗口)。
  chatMessages: 400, chatSessions: 100, memoryItems: 500, analysisBundles: 200, evidenceBundles: 50,
  tradeIntents: 500, backtests: 100, strategyExperiments: 200, orders: 3000, fills: 5000, traces: 1000,
  watchTriggers: 100, armedSetups: 200, opportunityCandidates: 200, opportunityEvents: 1000,
  reviews: 2000,
  missedOpportunities: 100,
  marketIntelligenceFacts: 2000, marketCalendarEvents: 500, dailyBriefs: 90,
  telegramWatchOutbox: 500, telegramPosterOutbox: 500
};
function capLogCollections(db) {
  const tsOf = (o) => new Date(o?.createdAt || o?.at || o?.startedAt || o?.finishedAt || o?.updatedAt || 0).getTime() || 0;
  for (const [name, cap] of Object.entries(LOG_CAPS)) {
    const arr = db[name];
    if (Array.isArray(arr) && arr.length > cap) {
      db[name] = arr.slice().sort((a, b) => tsOf(b) - tsOf(a)).slice(0, cap);
    }
  }
  // jobLocks 应每个锁一条，按锁标识去重（历史上因未原地更新累积到 9 万条）。
  if (Array.isArray(db.jobLocks) && db.jobLocks.length > 100) {
    const seen = new Map();
    for (const l of db.jobLocks.slice().sort((a, b) => tsOf(b) - tsOf(a))) {
      const k = l.name || l.resource || l.taskId || l.id || l.key;
      if (!seen.has(k)) seen.set(k, l);
    }
    db.jobLocks = [...seen.values()];
  }
}

// 当前生效授权的唯一选择器(全站统一)。历史 bug:多条 active 并存时各处 find() 取数组
// 第一条(往往是最旧的 v1),计划从此绑旧版本被风控永久拒绝("计划绑定 v1,当前授权 v4")。
// 规则:在 active/running 中取 version 最高者,同版本取激活时间最新者。
export function activeMandate(db) {
  const list = (db.mandates || []).filter((m) => {
    if (!["active", "running"].includes(m.status)) return false;
    const start = m.validFrom || m.valid_from;
    if (start && new Date(start).getTime() > Date.now()) return false;
    // (P2-7)过期授权不再当作生效:过期后仍驱动 15 分钟一次的巡检提计划再被风控拒,空烧 token。
    const exp = m.validUntil || m.valid_until;
    return !exp || new Date(exp).getTime() > Date.now();
  });
  if (!list.length) return null;
  return list.slice().sort((a, b) =>
    (Number(b.version || 1) - Number(a.version || 1)) ||
    (new Date(b.activatedAt || b.createdAt || 0) - new Date(a.activatedAt || a.createdAt || 0))
  )[0];
}

let saveDbObserver = null;

export function setSaveDbObserver(observer) {
  saveDbObserver = typeof observer === "function" ? observer : null;
}

export function saveDb(db, options = {}) {
  db.meta.updatedAt = nowIso();
  capLogCollections(db);
  ensureSqlite();
  saveToSqlite(db, options);
  try { saveDbObserver?.({ updatedAt: db.meta.updatedAt, reason: options.reason || null }); } catch { /* UI invalidation must never fail persistence */ }
}

export function resetOperationalData(db, options = {}) {
  const seed = seedDatabase();
  const keepAudit = options.keepAudit !== false;
  Object.assign(db.portfolio, seed.portfolio);
  db.system.autonomyEnabled = true;
  db.system.requestedOperatingMode = "observe";
  db.system.operatingModeSchemaVersion = 2;
  db.system.killSwitch = false;
  db.system.riskStatus = "等待配置";
  db.system.latestAction = "已清空工作数据，等待真实配置与授权";
  db.system.remainingDailyLossUsdt = null;
  db.markets = seed.markets;
  db.mandates = [];
  db.positions = [];
  db.orders = [];
  db.fills = [];
  db.tradePlans = [];
  db.watchTriggers = [];
  db.armedSetups = [];
  db.opportunityCandidates = [];
  db.opportunityEvents = [];
  db.missedOpportunities = [];
  db.marketFeatureState = {};
  db.mediumTermSamples = [];
  try { ensureSqlite().prepare("delete from medium_term_samples").run(); } catch { /* 清理表失败交给上层持久化错误处理 */ }
  db.eventVolatilityObservations = [];
  db.marketNarratives = {};
  db.structureAnalysisCache = {};
  db.events = [];
  db.marketIntelligenceFacts = [];
  db.marketCalendarEvents = [];
  db.marketIntelligenceSourceHealth = {};
  db.dailyBriefs = [];
  db.telegramWatchOutbox = [];
  db.telegramPosterOutbox = [];
  db.tasks = [];
  db.jobRuns = [];
  db.jobLocks = [];
  db.knowledge = emptyKnowledge();
  db.analysisBundles = [];
  db.evidenceBundles = [];
  db.skills = [];
  db.mcpServers = [];
  db.accountSnapshots = [];
  db.reconciliationReports = [];
  db.alerts = [];
  db.drillRuns = [];
  db.llmRuns = [];
  db.chatMessages = [];
  db.agentSteps = [];
  db.agentToolCalls = [];
  db.tradeIntents = [];
  db.executionOrders = [];
  db.exchangeOrders = [];
  db.reviewReports = [];
  db.strategyExperiments = [];
  // 交易证据被清空时，策略验证状态也必须一并重置；否则会留下“无样本但已验证运行”的幽灵状态。
  db.strategyVersions = [];
  db.strategyDeployments = [];
  db.strategyVersionEvents = [];
  db.strategyStudioDrafts = [];
  db.strategyBlueprintVersions = [];
  db.strategyStudioBacktests = [];
  db.strategyMarketplaceListings = [];
  db.strategyAssignments = [];
  syncNativeStrategyProducts(db);
  db.eventImpacts = [];
  db.toolExecutions = [];
  db.toolCallStats = {};
  delete db.meta.toolUsageBackfilledAt;
  delete db.meta.toolUsageStatsSince;
  delete db.meta.toolUsageBackfillSource;
  db.skillRuns = [];
  db.riskChecks = [];
  db.riskIncidents = [];
  db.notifications = [];
  db.memoryItems = [];
  db.agentRuns = [];
  db.decisionFactSnapshots = [];
  db.ownerImprovementItems = [];
  db.reviews = [];
  db.agentStateFiles = seed.agentStateFiles;
  if (!keepAudit) {
    db.auditLogs = [];
    db.traces = [];
  }
  appendAudit(db, "清空工作数据，保留配置/密钥/用户/风控规则", "system.reset", options.actor || "Admin", "warning");
  return db;
}

export function appendAudit(db, action, target, actor = "System", severity = "info") {
  db.meta ||= {};
  const request = currentRequestContext();
  ensureSqlite();
  // 审计链尾必须由 SQLite 在同一个 IMMEDIATE 写事务中串行读取和追加。此前依赖每个
  // Node 进程各自的 db.meta.auditChainTip：主服务与临时通知/运维进程并发时会从同一旧
  // hash 各写一个子节点，形成分叉。rowid 是数据库实际提交顺序，也是 WORM 游标口径。
  const append = sqlite.transaction(() => {
    const latest = sqlite.prepare("select doc from audit_log_entries order by rowid desc limit 1").get();
    const prevHash = latest ? JSON.parse(latest.doc).hash || null : null;
    const entry = {
      id: id("audit"), actor: scrubSecrets(actor), action: scrubSecrets(action), target: scrubSecrets(target), severity, prevHash, createdAt: nowIso(),
      ...(request?.actor ? { requestedBy: request.actor, requestedByUserId: request.userId, tenantId: request.tenantId } : {})
    };
    entry.hash = auditHash(entry);
    writeAuditEntry(entry);
    return entry;
  });
  const entry = append.immediate();
  db.auditLogs.unshift(entry);
  db.meta.auditChainTip = entry.hash;
  return entry;
}

// latencyMs 只接受真实测量值；不传就是 null（此前默认随机数 80-980ms，会被前端当真实延迟画进 P95 图）。
export function appendTrace(db, type, title, status = "ok", latencyMs = null) {
  const entry = { id: id("trace"), type: scrubSecrets(type), title: scrubSecrets(title), status, latencyMs, createdAt: nowIso() };
  db.traces.unshift(entry);
  writeTraceEntry(entry);
  return entry;
}

// trace 可按保留策略裁剪；审计日志不得在运行时自动删除或重链。
// 达到阈值只标记容量告警，由外部 WORM/归档流程显式处理。
const TRACE_KEEP = Number(process.env.TRACE_RETENTION || 20000);
const AUDIT_KEEP = Number(process.env.AUDIT_RETENTION || 50000);
let traceInsertsSincePrune = 0;

function pruneTraceRows() {
  if (!sqlite) return 0;
  return sqlite.prepare(
    "delete from trace_entries where rowid in (select rowid from trace_entries order by created_at desc, rowid desc limit -1 offset @keep)"
  ).run({ keep: TRACE_KEEP }).changes;
}

// 启动时只裁剪 trace；审计超限仅记录容量状态，不删除、不重链。
export function pruneLogRetention(db) {
  ensureSqlite();
  let traceDeleted = 0;
  const auditDeleted = 0;
  try { traceDeleted = pruneTraceRows(); } catch { /* 裁剪失败不阻断 */ }
  try {
    const auditCount = sqlite.prepare("select count(*) as c from audit_log_entries").get().c;
    db.meta ||= {};
    db.meta.auditRetentionExceeded = auditCount > AUDIT_KEEP;
    db.meta.auditEntryCount = auditCount;
  } catch { /* 审计裁剪失败保持原样,不阻断启动 */ }
  // 一次性回收:历史膨胀裁掉后,SQLite 只是把页标为空闲、文件不缩;VACUUM 把空洞还给 OS。
  // 用 meta 标记锁成"永远只跑一次",避免每次启动都 VACUUM(重写整库、阻塞事件循环)。
  try {
    db.meta ||= {};
    if (!db.meta.logVacuumV1 && traceDeleted > 5000) {
      sqlite.exec("VACUUM");
      db.meta.logVacuumV1 = nowIso();
      saveDb(db);
    }
  } catch { /* VACUUM 失败(如磁盘不足)不阻断启动,下次仍会尝试 */ }
  return { traceDeleted, auditDeleted };
}

export function getStorageInfo() {
  ensureSqlite();
  const collectionCount = sqlite.prepare("select count(*) as count from collections").get().count;
  const auditCount = sqlite.prepare("select count(*) as count from audit_log_entries").get().count;
  const traceCount = sqlite.prepare("select count(*) as count from trace_entries").get().count;
  return {
    type: "sqlite",
    sqlitePath: sqliteDbPath,
    legacyJsonPath: jsonDbPath,
    collectionCount,
    auditCount,
    traceCount
  };
}

export function getStorageRuntimeStatus() {
  try {
    const database = ensureSqlite();
    const accessible = database.prepare("select 1 as ok").get()?.ok === 1;
    const integrity = database.pragma("quick_check", { simple: true });
    let writable = false;
    try {
      fs.accessSync(sqliteDbPath, fs.constants.R_OK | fs.constants.W_OK);
      fs.accessSync(dataDir, fs.constants.W_OK);
      if (database.readonly === true) throw new Error("sqlite_readonly");
      database.exec("BEGIN IMMEDIATE");
      database.exec("ROLLBACK");
      writable = true;
    } catch {
      if (database.inTransaction) {
        try { database.exec("ROLLBACK"); } catch { /* status remains not writable */ }
      }
    }
    return {
      ready: accessible && writable && integrity === "ok",
      accessible,
      writable,
      integrity
    };
  } catch {
    return { ready: false, accessible: false, writable: false, integrity: "unavailable", reason: "sqlite_unavailable" };
  }
}

// SQLite 在线备份 API 会在 WAL 活跃时获取一致快照；禁止直接 tar/cp 正在写入的 data 目录。
export async function backupSqlite(destination) {
  ensureSqlite();
  await sqlite.backup(destination);
  return destination;
}

function ensureSqlite() {
  if (sqlite) return sqlite;
  sqlite = new Database(sqliteDbPath, { timeout: 5000 });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(`
    create table if not exists migrations (
      id text primary key,
      applied_at text not null
    );
    create table if not exists collections (
      name text primary key,
      value text not null,
      updated_at text not null
    );
    create table if not exists audit_log_entries (
      id text primary key,
      actor text not null,
      action text not null,
      target text not null,
      severity text not null,
      created_at text not null,
      doc text not null
    );
    create index if not exists idx_audit_created_at on audit_log_entries(created_at);
    create index if not exists idx_audit_target on audit_log_entries(target);
    create table if not exists trace_entries (
      id text primary key,
      type text not null,
      title text not null,
      status text not null,
      latency_ms integer,
      created_at text not null,
      doc text not null
    );
    create index if not exists idx_trace_created_at on trace_entries(created_at);
    create index if not exists idx_trace_type on trace_entries(type);
    create table if not exists medium_term_samples (
      symbol text not null,
      bucket_at integer not null,
      observed_at text,
      doc text not null,
      primary key (symbol, bucket_at)
    );
    create index if not exists idx_medium_term_bucket on medium_term_samples(bucket_at);
    create table if not exists oms_orders (
      id text primary key,
      tenant_id text not null,
      exchange text not null,
      client_order_id text not null,
      action text not null,
      state text not null,
      exchange_order_id text,
      plan_id text,
      payload_hash text not null,
      request_doc text,
      response_doc text,
      version integer not null default 1,
      created_at text not null,
      updated_at text not null,
      unique (tenant_id, exchange, client_order_id)
    );
    create index if not exists idx_oms_orders_plan on oms_orders(tenant_id, plan_id);
    create index if not exists idx_oms_orders_state on oms_orders(tenant_id, state);
    create table if not exists oms_order_events (
      id integer primary key autoincrement,
      order_id text not null,
      from_state text,
      to_state text not null,
      event_type text not null,
      doc text,
      created_at text not null,
      foreign key(order_id) references oms_orders(id)
    );
    create index if not exists idx_oms_events_order on oms_order_events(order_id, id);
    create table if not exists outbox_events (
      id text primary key,
      tenant_id text not null,
      aggregate_type text not null,
      aggregate_id text not null,
      event_type text not null,
      payload_doc text not null,
      status text not null default 'pending',
      attempts integer not null default 0,
      available_at text not null,
      created_at text not null,
      published_at text
    );
    create index if not exists idx_outbox_pending on outbox_events(status, available_at, id);
    create table if not exists execution_leases (
      resource text primary key,
      owner_id text not null,
      fencing_token integer not null,
      expires_at text not null,
      updated_at text not null
    );
    create table if not exists payment_tx_claims (
      txid text primary key,
      payment_id text not null unique,
      tenant_id text,
      evidence_doc text not null,
      claimed_at text not null
    );
    create table if not exists audit_sink_offsets (
      sink_id text primary key,
      last_rowid integer not null default 0,
      updated_at text not null
    );
    create table if not exists tenant_resources (
      tenant_id text not null,
      resource_type text not null,
      resource_id text not null,
      version integer not null default 1,
      doc text not null,
      created_at text not null,
      updated_at text not null,
      primary key (tenant_id, resource_type, resource_id)
    );
    create index if not exists idx_tenant_resource_list
      on tenant_resources(tenant_id, resource_type, updated_at desc);
    create table if not exists trading_entities (
      tenant_id text not null,
      resource_type text not null,
      resource_id text not null,
      version integer not null default 1,
      status text,
      symbol text,
      created_at text not null,
      updated_at text not null,
      doc text not null,
      primary key (tenant_id, resource_type, resource_id)
    );
    create index if not exists idx_trading_entities_type_status
      on trading_entities(tenant_id, resource_type, status, updated_at desc);
    create index if not exists idx_trading_entities_symbol
      on trading_entities(tenant_id, resource_type, symbol, updated_at desc);
  `);
  ensureColumn(sqlite, "oms_orders", "request_doc", "text");
  return sqlite;
}

function ensureColumn(database, table, column, definition) {
  const columns = database.prepare(`pragma table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) {
    database.exec(`alter table ${table} add column ${column} ${definition}`);
  }
}

export function putTenantResource(tenantId, resourceType, resource, expectedVersion = null) {
  ensureSqlite();
  if (!tenantId || !resourceType || !resource?.id) throw new Error("tenantId, resourceType and resource.id are required");
  const existing = sqlite.prepare(`
    select version, created_at from tenant_resources
    where tenant_id = ? and resource_type = ? and resource_id = ?
  `).get(tenantId, resourceType, resource.id);
  if (expectedVersion !== null && Number(existing?.version || 0) !== Number(expectedVersion)) {
    const error = new Error("Tenant resource optimistic version conflict");
    error.code = "VERSION_CONFLICT";
    throw error;
  }
  const version = Number(existing?.version || 0) + 1;
  const updatedAt = nowIso();
  const createdAt = existing?.created_at || resource.createdAt || updatedAt;
  const doc = { ...resource, tenantId, version, updatedAt, createdAt };
  sqlite.prepare(`
    insert into tenant_resources
      (tenant_id, resource_type, resource_id, version, doc, created_at, updated_at)
    values (?, ?, ?, ?, ?, ?, ?)
    on conflict(tenant_id, resource_type, resource_id) do update set
      version = excluded.version, doc = excluded.doc, updated_at = excluded.updated_at
  `).run(tenantId, resourceType, resource.id, version, JSON.stringify(doc), createdAt, updatedAt);
  return doc;
}

export function listTenantResources(tenantId, resourceType, limit = 500) {
  ensureSqlite();
  return sqlite.prepare(`
    select doc from tenant_resources
    where tenant_id = ? and resource_type = ?
    order by updated_at desc, resource_id asc limit ?
  `).all(tenantId, resourceType, Math.max(1, Math.min(Number(limit) || 500, 2000)))
    .map((row) => JSON.parse(row.doc));
}

export function getTenantResource(tenantId, resourceType, resourceId) {
  ensureSqlite();
  const row = sqlite.prepare(`
    select doc from tenant_resources
    where tenant_id = ? and resource_type = ? and resource_id = ?
  `).get(tenantId, resourceType, resourceId);
  return row ? JSON.parse(row.doc) : null;
}

// 用 trading_entities 的类型化列(status/symbol)+ 索引直接查实体，替代"整集合装内存再 filter"。
// 例：queryEntities("tradePlans", { status: "approved" })、queryEntities("orders", { symbol: "BTC/USDT" })。
// 命中 idx_trading_entities_type_status / _symbol 两个索引，规模大时远快于全量扫描内存数组。
export function queryEntities(resourceType, { status, symbol, tenantId = "tenant_owner", limit = 500 } = {}) {
  ensureSqlite();
  const where = ["resource_type = ?", "tenant_id = ?"];
  const params = [resourceType, tenantId];
  if (status != null) { where.push("status = ?"); params.push(status); }
  if (symbol != null) { where.push("symbol = ?"); params.push(symbol); }
  params.push(Math.max(1, Math.min(Number(limit) || 500, 5000)));
  return sqlite.prepare(
    `select doc from trading_entities where ${where.join(" and ")} order by updated_at desc, resource_id asc limit ?`
  ).all(...params).map((row) => JSON.parse(row.doc));
}

export function deleteTenantResource(tenantId, resourceType, resourceId, expectedVersion = null) {
  ensureSqlite();
  const sql = expectedVersion === null
    ? "delete from tenant_resources where tenant_id = ? and resource_type = ? and resource_id = ?"
    : "delete from tenant_resources where tenant_id = ? and resource_type = ? and resource_id = ? and version = ?";
  const params = expectedVersion === null
    ? [tenantId, resourceType, resourceId]
    : [tenantId, resourceType, resourceId, Number(expectedVersion)];
  return sqlite.prepare(sql).run(...params).changes === 1;
}

export function migrateOwnerResourcesToTenantStore(db) {
  const types = [
    "mandates", "positions", "orders", "fills", "tradePlans", "riskChecks",
    "executionOrders", "reviews", "events", "tasks", "knowledgeSources"
  ];
  let migrated = 0;
  for (const type of types) {
    const items = type === "knowledgeSources" ? (db.knowledge?.sources || []) : (db[type] || []);
    for (const item of items) {
      if (!item?.id) continue;
      putTenantResource(item.tenantId || "tenant_owner", type, item);
      migrated += 1;
    }
  }
  return { migrated, types };
}

export function readAuditSinkBatch(sinkId = "primary", limit = 100) {
  ensureSqlite();
  const offset = sqlite.prepare("select last_rowid from audit_sink_offsets where sink_id = ?").get(sinkId)?.last_rowid || 0;
  return sqlite.prepare(`
    select rowid as cursor, doc from audit_log_entries
    where rowid > ? order by rowid asc limit ?
  `).all(offset, Math.max(1, Math.min(Number(limit) || 100, 500))).map((row) => ({
    cursor: row.cursor,
    entry: JSON.parse(row.doc)
  }));
}

export function commitAuditSinkCursor(sinkId, cursor) {
  ensureSqlite();
  sqlite.prepare(`
    insert into audit_sink_offsets (sink_id, last_rowid, updated_at)
    values (?, ?, ?)
    on conflict(sink_id) do update set
      last_rowid = case when excluded.last_rowid > last_rowid then excluded.last_rowid else last_rowid end,
      updated_at = excluded.updated_at
  `).run(sinkId, Number(cursor), nowIso());
}

export function acquireExecutionLease(resource, ownerId, ttlMs = 30_000) {
  ensureSqlite();
  const now = Date.now();
  const expiresAt = new Date(now + Math.max(5_000, Number(ttlMs) || 30_000)).toISOString();
  const tx = sqlite.transaction(() => {
    const current = sqlite.prepare("select * from execution_leases where resource = ?").get(resource);
    if (current && new Date(current.expires_at).getTime() > now && current.owner_id !== ownerId) {
      return { acquired: false, ownerId: current.owner_id, fencingToken: current.fencing_token, expiresAt: current.expires_at };
    }
    const fencingToken = Number(current?.fencing_token || 0) + 1;
    sqlite.prepare(`
      insert into execution_leases (resource, owner_id, fencing_token, expires_at, updated_at)
      values (?, ?, ?, ?, ?)
      on conflict(resource) do update set
        owner_id = excluded.owner_id,
        fencing_token = excluded.fencing_token,
        expires_at = excluded.expires_at,
        updated_at = excluded.updated_at
    `).run(resource, ownerId, fencingToken, expiresAt, nowIso());
    return { acquired: true, ownerId, fencingToken, expiresAt };
  });
  return tx();
}

export function releaseExecutionLease(resource, ownerId, fencingToken) {
  ensureSqlite();
  const result = sqlite.prepare(`
    update execution_leases set expires_at = ?, updated_at = ?
    where resource = ? and owner_id = ? and fencing_token = ?
  `).run(new Date(0).toISOString(), nowIso(), resource, ownerId, fencingToken);
  return result.changes === 1;
}

export function renewExecutionLease(resource, ownerId, fencingToken, ttlMs = 30_000) {
  ensureSqlite();
  const expiresAt = new Date(Date.now() + Math.max(5_000, Number(ttlMs) || 30_000)).toISOString();
  const result = sqlite.prepare(`
    update execution_leases set expires_at = ?, updated_at = ?
    where resource = ? and owner_id = ? and fencing_token = ? and expires_at > ?
  `).run(expiresAt, nowIso(), resource, ownerId, fencingToken, nowIso());
  return { renewed: result.changes === 1, expiresAt };
}

export function claimPaymentTransaction({ txid, paymentId, tenantId = null, evidence = {} }) {
  ensureSqlite();
  const claimedAt = nowIso();
  const claim = sqlite.transaction(() => {
    const existing = sqlite.prepare("select txid, payment_id, tenant_id, claimed_at from payment_tx_claims where txid = ? or payment_id = ? limit 1").get(txid, paymentId);
    if (existing) return {
      claimed: existing.txid === txid && existing.payment_id === paymentId,
      txid: existing.txid,
      paymentId: existing.payment_id,
      tenantId: existing.tenant_id,
      claimedAt: existing.claimed_at,
      replay: existing.txid === txid && existing.payment_id === paymentId
    };
    sqlite.prepare(`
      insert into payment_tx_claims (txid, payment_id, tenant_id, evidence_doc, claimed_at)
      values (?, ?, ?, ?, ?)
    `).run(txid, paymentId, tenantId, JSON.stringify(evidence), claimedAt);
    return { claimed: true, txid, paymentId, tenantId, claimedAt, replay: false };
  });
  return claim();
}

function stablePayloadHash(payload = {}) {
  const sortDeep = (value) => {
    if (Array.isArray(value)) return value.map(sortDeep);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
  };
  const normalized = sortDeep(sanitizeStoredPayload(payload));
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

// 在调用交易所之前用唯一约束预留 clientOrderId。即使进程在 HTTP 请求后崩溃，
// 重启后的同一请求也会命中这条持久记录，而不是再次下单。
export function reserveOmsOrder({ tenantId = "tenant_owner", exchange, clientOrderId, action, planId, payload = {} }) {
  if (!clientOrderId) return { status: "not_applicable" };
  ensureSqlite();
  const existing = sqlite.prepare(`
    select * from oms_orders where tenant_id = ? and exchange = ? and client_order_id = ?
  `).get(tenantId, exchange, clientOrderId);
  const payloadHash = stablePayloadHash(payload);
  if (existing) {
    if (existing.payload_hash !== payloadHash) return { status: "conflict", order: deserializeOmsOrder(existing) };
    const state = String(existing.state || "").toUpperCase();
    if (["SUBMITTING", "UNKNOWN"].includes(state)) {
      return { status: "unknown", order: deserializeOmsOrder(existing) };
    }
    if (state === "REJECTED") {
      const updatedAt = nowIso();
      const tx = sqlite.transaction(() => {
        const changed = sqlite.prepare(`
          update oms_orders set state = 'SUBMITTING', response_doc = null, version = version + 1, updated_at = ?
          where id = ? and version = ?
        `).run(updatedAt, existing.id, existing.version);
        if (changed.changes !== 1) return false;
        sqlite.prepare(`
          insert into oms_order_events (order_id, from_state, to_state, event_type, doc, created_at)
          values (?, 'REJECTED', 'SUBMITTING', 'explicit_retry_after_rejection', ?, ?)
        `).run(existing.id, JSON.stringify({ action, planId }), updatedAt);
        return true;
      });
      if (!tx()) return { status: "unknown", order: getOmsOrder(existing.id) };
      return { status: "retry", order: getOmsOrder(existing.id) };
    }
    return {
      status: "replay",
      order: deserializeOmsOrder(existing)
    };
  }
  const createdAt = nowIso();
  const orderId = id("oms");
  const tx = sqlite.transaction(() => {
    sqlite.prepare(`
      insert into oms_orders
        (id, tenant_id, exchange, client_order_id, action, state, plan_id, payload_hash, request_doc, created_at, updated_at)
      values (?, ?, ?, ?, ?, 'SUBMITTING', ?, ?, ?, ?, ?)
    `).run(orderId, tenantId, exchange, clientOrderId, action, planId || null, payloadHash, JSON.stringify(sanitizeStoredPayload(payload)), createdAt, createdAt);
    sqlite.prepare(`
      insert into oms_order_events (order_id, from_state, to_state, event_type, doc, created_at)
      values (?, null, 'SUBMITTING', 'order_reserved', ?, ?)
    `).run(orderId, JSON.stringify({ action, planId }), createdAt);
  });
  tx();
  return { status: "reserved", order: { id: orderId, tenantId, exchange, clientOrderId, action, state: "SUBMITTING", planId, createdAt } };
}

export function transitionOmsOrder(orderId, toState, details = {}) {
  ensureSqlite();
  const current = sqlite.prepare("select * from oms_orders where id = ?").get(orderId);
  if (!current) return null;
  const updatedAt = nowIso();
  const responseDoc = details.response === undefined ? current.response_doc : JSON.stringify(scrubSecrets(details.response));
  const exchangeOrderId = details.exchangeOrderId ?? current.exchange_order_id;
  const outboxId = id("outbox");
  const tx = sqlite.transaction(() => {
    const result = sqlite.prepare(`
      update oms_orders
      set state = ?, exchange_order_id = ?, response_doc = ?, version = version + 1, updated_at = ?
      where id = ? and version = ?
    `).run(toState, exchangeOrderId || null, responseDoc || null, updatedAt, orderId, current.version);
    if (result.changes !== 1) throw new Error("OMS optimistic version conflict");
    sqlite.prepare(`
      insert into oms_order_events (order_id, from_state, to_state, event_type, doc, created_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(orderId, current.state, toState, details.eventType || "state_changed", JSON.stringify(scrubSecrets(details)), updatedAt);
    sqlite.prepare(`
      insert into outbox_events
        (id, tenant_id, aggregate_type, aggregate_id, event_type, payload_doc, status, available_at, created_at)
      values (?, ?, 'order', ?, ?, ?, 'pending', ?, ?)
    `).run(outboxId, current.tenant_id, orderId, details.eventType || "order_state_changed", JSON.stringify({
      orderId,
      fromState: current.state,
      toState,
      exchangeOrderId
    }), updatedAt, updatedAt);
  });
  tx();
  return getOmsOrder(orderId);
}

export function getOmsOrder(orderId) {
  ensureSqlite();
  const row = sqlite.prepare("select * from oms_orders where id = ?").get(orderId);
  return row ? deserializeOmsOrder(row) : null;
}

export function listOmsOrdersByState(states = ["UNKNOWN"], limit = 100) {
  ensureSqlite();
  const wanted = [...new Set(states.map(String))].slice(0, 20);
  if (!wanted.length) return [];
  const placeholders = wanted.map(() => "?").join(",");
  return sqlite.prepare(`
    select * from oms_orders where state in (${placeholders})
    order by updated_at asc limit ?
  `).all(...wanted, Math.max(1, Math.min(Number(limit) || 100, 500))).map(deserializeOmsOrder);
}

export function listOmsOrdersForPlan(planId, limit = 20) {
  ensureSqlite();
  if (!planId) return [];
  return sqlite.prepare(`
    select * from oms_orders where tenant_id = ? and plan_id = ?
    order by updated_at desc limit ?
  `).all("tenant_owner", String(planId), Math.max(1, Math.min(Number(limit) || 20, 100))).map(deserializeOmsOrder);
}

export function findPendingOmsAmend({ reqId = null, exchangeOrderId = null, clientOrderId = null } = {}) {
  ensureSqlite();
  const rows = sqlite.prepare(`
    select * from oms_orders
    where action = 'amend_order' and state in ('SUBMITTING', 'UNKNOWN', 'ACKNOWLEDGED')
    order by updated_at desc limit 200
  `).all().map(deserializeOmsOrder);
  return rows.find((order) => {
    const request = order.request || {};
    const response = order.response || {};
    const storedReqId = response.reqId || request.amendRequestId || request.actionAttemptId || null;
    const storedOrderId = request.authoritativeOrderId || request.orderId || order.exchangeOrderId || null;
    const storedClientOrderId = request.clientOrderId || null;
    if (reqId && storedReqId && String(reqId) === String(storedReqId)) return true;
    if (exchangeOrderId && storedOrderId && String(exchangeOrderId) === String(storedOrderId)) return true;
    return Boolean(clientOrderId && storedClientOrderId && String(clientOrderId) === String(storedClientOrderId));
  }) || null;
}

export function pendingOutboxEvents(limit = 100) {
  ensureSqlite();
  return sqlite.prepare(`
    select * from outbox_events
    where status = 'pending' and available_at <= ?
    order by created_at asc, id asc limit ?
  `).all(nowIso(), Math.max(1, Math.min(Number(limit) || 100, 500))).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: JSON.parse(row.payload_doc),
    attempts: row.attempts,
    createdAt: row.created_at
  }));
}

export function markOutboxPublished(eventId) {
  ensureSqlite();
  const publishedAt = nowIso();
  const result = sqlite.prepare(`
    update outbox_events set status = 'published', published_at = ? where id = ? and status = 'pending'
  `).run(publishedAt, eventId);
  return result.changes === 1;
}

// 发布失败：attempts+1 并线性退避 available_at（30s×次数，上限 10 分钟），
// 避免坏事件每分钟无限原地重试刷日志。
export function deferOutboxEvent(eventId, attempts = 0) {
  ensureSqlite();
  const delayMs = Math.min(10 * 60_000, 30_000 * Math.max(1, Number(attempts) + 1));
  const result = sqlite.prepare(`
    update outbox_events set attempts = attempts + 1, available_at = ? where id = ? and status = 'pending'
  `).run(new Date(Date.now() + delayMs).toISOString(), eventId);
  return result.changes === 1;
}

function deserializeOmsOrder(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    exchange: row.exchange,
    clientOrderId: row.client_order_id,
    action: row.action,
    state: row.state,
    exchangeOrderId: row.exchange_order_id,
    planId: row.plan_id,
    request: row.request_doc ? JSON.parse(row.request_doc) : null,
    response: row.response_doc ? JSON.parse(row.response_doc) : null,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sanitizeStoredPayload(payload = {}) {
  return scrubSecrets(payload);
}

function loadFromSqlite() {
  const rows = sqlite.prepare("select name, value from collections").all();
  if (!rows.length) return null;
  const db = {};
  for (const row of rows) db[row.name] = JSON.parse(row.value);
  // 高频中频事实使用独立行存储，避免每2分钟重写一个数十MB的JSON collection。
  db.mediumTermSamples = sqlite.prepare("select doc from medium_term_samples where bucket_at >= ? order by bucket_at desc").all(Date.now() - 30 * 86_400_000).map((row) => JSON.parse(row.doc));
  const entityRows = sqlite.prepare(`
    select resource_type, doc from trading_entities
    order by resource_type asc, updated_at desc, resource_id asc
  `).all();
  if (entityRows.length) {
    const grouped = new Map();
    for (const row of entityRows) {
      if (!grouped.has(row.resource_type)) grouped.set(row.resource_type, []);
      grouped.get(row.resource_type).push(JSON.parse(row.doc));
    }
    for (const [resourceType, items] of grouped) db[resourceType] = items;
  }
  db.auditLogs = sqlite.prepare("select doc from audit_log_entries order by created_at desc, rowid desc limit 1000").all().map((row) => JSON.parse(row.doc));
  db.traces = sqlite.prepare("select doc from trace_entries order by created_at desc, rowid desc limit 1000").all().map((row) => JSON.parse(row.doc));
  return db;
}

function saveToSqlite(db, options = {}) {
  const updatedAt = nowIso();
  const upsert = sqlite.prepare(`
    insert into collections (name, value, updated_at)
    values (@name, @value, @updated_at)
    on conflict(name) do update set value = excluded.value, updated_at = excluded.updated_at
  `);
  const upsertMediumTerm = sqlite.prepare(`
    insert into medium_term_samples (symbol, bucket_at, observed_at, doc)
    values (@symbol, @bucket_at, @observed_at, @doc)
    on conflict(symbol, bucket_at) do update set observed_at = excluded.observed_at, doc = excluded.doc
  `);
  // lightweight 模式(高频后台落盘用,如行情 WS 8s 节流):
  // - 跳过 knowledge 巨 blob(全文 chunk+1536 维向量,几十 MB;行情 tick 不会改知识,沿用上次落盘值)
  // - markets 剥离 K 线数组(candles/candlesByTf 每次全量重写是 CPU 大头;K 线由巡检任务全量落盘)
  // 任何业务路由的 persist() 仍是全量落盘,知识/K 线变更不会丢。
  const lightweight = options.lightweight === true;
  const write = sqlite.transaction(() => {
    for (const name of collectionNames) {
      if (db[name] === undefined) continue;
      // lightweight:knowledge/markets 都整体跳过(沿用上次全量值)。
      // 教训:曾写入剥离 K 线的 slim markets,高频覆盖使磁盘上几乎永远是无 K 线版本,
      // 重启后 1h K 线无人补 → 技能信号/风控复查/相关性静默失效。
      if (lightweight && (name === "knowledge" || name === "markets")) continue;
      upsert.run({ name, value: JSON.stringify(db[name]), updated_at: updatedAt });
    }
    // 只写最近可能新增/被 Rubik 最终值修订的桶；历史桶是不可变事实，避免每2分钟全量JSON重写。
    const recentCutoff = Date.now() - 20 * 60_000;
    for (const row of db.mediumTermSamples || []) {
      if (!row?.symbol || !Number.isFinite(Number(row.bucketAt))) continue;
      if (Number(row.bucketAt) < recentCutoff && row.persistPending !== true) continue;
      // persistPending 只是内存中的“首次回填待落盘”标记，不属于市场事实本身。
      const stored = row.persistPending === true ? { ...row, persistPending: undefined } : row;
      upsertMediumTerm.run({ symbol: row.symbol, bucket_at: Number(row.bucketAt), observed_at: row.observedAt || row.updatedAt || updatedAt, doc: JSON.stringify(stored) });
    }
    sqlite.prepare("delete from medium_term_samples where bucket_at < ?").run(Date.now() - 30 * 86_400_000);
    for (const entry of db.auditLogs || []) writeAuditEntry(entry);
    for (const entry of db.traces || []) writeTraceEntry(entry);
    persistTradingEntities(db, updatedAt);
  });
  write();
  // 事务成功后才清标记；失败时保留，下一次 saveDb 可安全重试。
  for (const row of db.mediumTermSamples || []) if (row.persistPending === true) delete row.persistPending;
}

function persistTradingEntities(db, updatedAt) {
  const upsert = sqlite.prepare(`
    insert into trading_entities
      (tenant_id, resource_type, resource_id, version, status, symbol, created_at, updated_at, doc)
    values (@tenant_id, @resource_type, @resource_id, 1, @status, @symbol, @created_at, @updated_at, @doc)
    on conflict(tenant_id, resource_type, resource_id) do update set
      version = trading_entities.version + 1,
      status = excluded.status,
      symbol = excluded.symbol,
      updated_at = excluded.updated_at,
      doc = excluded.doc
  `);
  // 删除必须按 (resource_type, tenant_id) 限定：内存 db 只装载当前租户（单实例即 tenant_owner），
  // 无条件按类型全删会把其他租户的行一并清掉（跨租户数据丢失）。
  const removeTypeForTenant = sqlite.prepare("delete from trading_entities where resource_type = ? and tenant_id = ?");
  for (const resourceType of entityCollectionNames) {
    const rows = (db[resourceType] || []).filter((item) => item?.id);
    const tenants = [...new Set(rows.map((item) => item.tenantId || "tenant_owner"))];
    for (const tenant of tenants.length ? tenants : ["tenant_owner"]) removeTypeForTenant.run(resourceType, tenant);
    for (const item of rows) {
      const tenantId = item.tenantId || "tenant_owner";
      const createdAt = item.createdAt || item.startedAt || updatedAt;
      // Reconciliation reports are immutable chronological facts. Using the
      // enclosing save timestamp for every row made all 200 rows tie on each
      // save; a read-only reload then fell back to resource_id order and could
      // expose a day-old report as the latest one. Preserve their fact time.
      const entityUpdatedAt = resourceType === "reconciliationReports"
        ? createdAt
        : item.updatedAt || updatedAt;
      const doc = { ...item, tenantId };
      upsert.run({
        tenant_id: tenantId,
        resource_type: resourceType,
        resource_id: item.id,
        status: item.status || null,
        symbol: item.symbol || null,
        created_at: createdAt,
        updated_at: entityUpdatedAt,
        doc: JSON.stringify(doc)
      });
    }
  }
}

function writeAuditEntry(entry) {
  if (!sqlite) return;
  sqlite.prepare(`
    insert or ignore into audit_log_entries (id, actor, action, target, severity, created_at, doc)
    values (@id, @actor, @action, @target, @severity, @created_at, @doc)
  `).run({
    id: entry.id,
    actor: entry.actor || "System",
    action: entry.action || "",
    target: entry.target || "",
    severity: entry.severity || "info",
    created_at: entry.createdAt || nowIso(),
    doc: JSON.stringify(entry)
  });
}

function writeTraceEntry(entry) {
  if (!sqlite) return;
  sqlite.prepare(`
    insert or ignore into trace_entries (id, type, title, status, latency_ms, created_at, doc)
    values (@id, @type, @title, @status, @latency_ms, @created_at, @doc)
  `).run({
    id: entry.id,
    type: entry.type || "unknown",
    title: entry.title || "",
    status: entry.status || "ok",
    latency_ms: entry.latencyMs || null,
    created_at: entry.createdAt || nowIso(),
    doc: JSON.stringify(entry)
  });
  // 运行期兜底:每 2000 条 trace 裁一次,保证重启之间也不会重新膨胀(纯 DELETE,索引支撑,开销小)。
  if ((++traceInsertsSincePrune % 2000) === 0) {
    try { pruneTraceRows(); } catch { /* 裁剪失败忽略,下次再试 */ }
  }
}

export function normalizeDatabase(db) {
  const seed = seedDatabase();
  db.meta ||= seed.meta;
  db.meta.schemaVersion = 5;
  db.user ||= seed.user;
  db.system ||= seed.system;
  // v2 retires the independent autonomy pause. It made “只分析” appear selected
  // while the analysis loop was actually stopped, and there is no longer a UI
  // control capable of resuming that hidden fourth state. Preserve emergency
  // stop, but otherwise make the selected three-mode intent authoritative.
  if (Number(db.system.operatingModeSchemaVersion || 0) < 2) {
    if (!Object.hasOwn({ observe: true, semi_auto: true, full_auto: true }, db.system.requestedOperatingMode)) {
      const enabledGray = (db.grayReleasePolicies || []).find((item) => item.enabled);
      db.system.requestedOperatingMode = db.system.liveTradingEnabled !== true
        ? "observe"
        : enabledGray?.requiresManualApproval === false ? "full_auto" : "semi_auto";
    }
    db.system.autonomyEnabled = db.system.killSwitch !== true;
    db.system.operatingModeSchemaVersion = 2;
  }
  applyDerivedProfitGoals(db.system);
  db.portfolio ||= seed.portfolio;
  db.markets ||= seed.markets;
  db.watchlist ||= seed.watchlist;
  db.watchTriggers ||= seed.watchTriggers;
  db.armedSetups ||= seed.armedSetups;
  db.opportunityCandidates ||= seed.opportunityCandidates;
  db.opportunityEvents ||= seed.opportunityEvents;
  db.missedOpportunities ||= seed.missedOpportunities;
  db.marketFeatureState ||= seed.marketFeatureState;
  db.mediumTermSamples ||= seed.mediumTermSamples || [];
  db.eventVolatilityObservations ||= seed.eventVolatilityObservations || [];
  db.marketNarratives ||= seed.marketNarratives;
  db.structureAnalysisCache ||= seed.structureAnalysisCache;
  db.mandates ||= seed.mandates;
  db.positions ||= seed.positions;
  db.tradePlans ||= seed.tradePlans;
  db.events ||= seed.events;
  db.marketIntelligenceFacts ||= seed.marketIntelligenceFacts || [];
  db.marketCalendarEvents ||= seed.marketCalendarEvents || [];
  db.marketIntelligenceSourceHealth ||= seed.marketIntelligenceSourceHealth || {};
  db.dailyBriefs ||= seed.dailyBriefs || [];
  db.telegramWatchOutbox ||= seed.telegramWatchOutbox || [];
  db.telegramPosterOutbox ||= seed.telegramPosterOutbox || [];
  db.tasks ||= seed.tasks;
  db.knowledge ||= seed.knowledge;
  db.analysisBundles ||= seed.analysisBundles;
  db.evidenceBundles ||= seed.evidenceBundles;
  db.skills ||= seed.skills;
  db.tools ||= seed.tools;
  db.mcpServers ||= seed.mcpServers;
  // 行情分析与交易执行已经统一使用 OKX。清除旧版本自动种下的 CoinGecko
  // 行情 MCP，避免跨交易所价格口径污染以及无意义的错误状态。
  db.mcpServers = db.mcpServers.filter((server) => server.id !== "mcp_coingecko");
  db.traces ||= seed.traces;
  db.auditLogs ||= seed.auditLogs;
  db.reviews ||= seed.reviews;
  db.decisionFactSnapshots ||= seed.decisionFactSnapshots || [];
  db.ownerImprovementItems ||= seed.ownerImprovementItems || [];
  db.strategyVersions ||= seed.strategyVersions;
  db.strategyDeployments ||= seed.strategyDeployments;
  db.strategyVersionEvents ||= seed.strategyVersionEvents;
  db.strategyStudioDrafts ||= seed.strategyStudioDrafts;
  db.strategyBlueprintVersions ||= seed.strategyBlueprintVersions;
  db.strategyStudioBacktests ||= seed.strategyStudioBacktests;
  db.strategyMarketplaceListings ||= seed.strategyMarketplaceListings;
  db.strategyAssignments ||= seed.strategyAssignments;
  // 内置策略版本按「产品ID@语义版本」不可变落库。相同版本内容发生漂移时只报告，
  // 不覆盖历史定义；升级必须发布新版本，确保计划/成交/复盘能永久还原当时规则。
  const strategySync = syncNativeStrategyProducts(db);
  if (strategySync.drift.length) {
    db.meta.strategyVersionDrift = strategySync.drift;
  } else {
    delete db.meta.strategyVersionDrift;
  }

  db.users ||= [{ ...db.user, email: defaultOwnerEmail, status: "active", isOwner: true }];
  db.roles ||= [
    { id: "role_admin", name: "管理员", permissions: ["*"] },
    { id: "role_trader", name: "交易用户", permissions: ["trade.read", "write:mandate", "write:knowledge", "approve:trade_plan", "critical:trade_execution", "risk.check"] },
    { id: "role_risk_approver", name: "风控审批员", permissions: ["market.read", "account.read", "risk.check", "write:risk", "approve:trade_plan", "approve:knowledge_skill", "risk.kill_switch", "audit.export"] },
    { id: "role_auditor", name: "审计员", permissions: ["audit.read", "trace.read"] }
  ];
  if (!db.roles.some((role) => role.id === "role_risk_approver")) {
    db.roles.push({ id: "role_risk_approver", name: "风控审批员", permissions: ["market.read", "account.read", "risk.check", "write:risk", "approve:trade_plan", "approve:knowledge_skill", "risk.kill_switch", "audit.export"] });
  }
  const riskApproverRole = db.roles.find((role) => role.id === "role_risk_approver");
  if (riskApproverRole) riskApproverRole.permissions = [...new Set([...(riskApproverRole.permissions || []), "approve:knowledge_skill"])];
  // 交易员只能研究/建计划，不能在迁移时被静默提升为审批者或执行者。
  const traderRole = db.roles.find((role) => role.id === "role_trader");
  if (traderRole) traderRole.permissions = [...TRADER_PERMISSIONS];
  db.permissions ||= [
    "market.read",
    "account.read",
    "trade.write_guarded",
    "risk.check",
    "risk.kill_switch",
    "write:mandate",
    "write:trade_plan",
    "write:risk",
    "write:knowledge",
    "write:skills",
    "write:event",
    "write:exchange",
    "write:realtime",
    "write:review",
    "write:mcp",
    "write:task",
    "admin:security",
    "admin:system",
    "critical:trade_execution",
    "critical:kill_switch",
    "approve:trade_plan",
    "approve:live_config",
    "approve:knowledge_skill",
    "knowledge.read",
    "knowledge.write",
    "skill.install",
    "mcp.register",
    "audit.export"
  ];
  db.permissions = [...new Set([...db.permissions, ...ALL_PERMISSIONS])];
  db.tenants ||= [{ id: "tenant_owner", name: "Owner 工作区", ownerUserId: "user_local_admin", planId: "owner", status: "owner", createdAt: db.meta.createdAt || nowIso() }];
  db.users = (db.users || [{ ...db.user, email: defaultOwnerEmail, status: "active", isOwner: true }]).map((user) => ({
    tenantId: user.tenantId || "tenant_owner",
    ...user
  }));
  const normalizedOwnerEmail = String(defaultOwnerEmail || "aliarlan1028@gmail.com").trim().toLowerCase();
  const ownerUser = db.users.find((user) => String(user.email || "").toLowerCase() === normalizedOwnerEmail)
    || db.users.find((user) => user.isOwner)
    || db.users.find((user) => user.id === "user_local_admin")
    || db.users[0];
  if (ownerUser) {
    ownerUser.email = normalizedOwnerEmail;
    ownerUser.name ||= "Owner";
    ownerUser.tenantId = "tenant_owner";
    ownerUser.role = "管理员";
    ownerUser.status = "active";
    ownerUser.isOwner = true;
  }
  const ownerTenant = db.tenants.find((tenant) => tenant.id === "tenant_owner") || { id: "tenant_owner", createdAt: db.meta.createdAt || nowIso() };
  Object.assign(ownerTenant, {
    name: ownerTenant.name || "Owner 工作区",
    ownerUserId: ownerUser?.id || "user_local_admin",
    planId: "owner",
    status: "owner"
  });
  if (!db.tenants.includes(ownerTenant)) db.tenants.unshift(ownerTenant);
  if (db.user) {
    db.user.email = normalizedOwnerEmail;
    db.user.tenantId = "tenant_owner";
    db.user.role = "管理员";
    db.user.isOwner = true;
  }
  db.subscriptionPlans ||= defaultSubscriptionPlans(nowIso());
  db.subscriptions ||= [];
  db.subscriptionTerms ||= [];
  const ownerSubscription = db.subscriptions.find((subscription) => subscription.id === "sub_owner")
    || db.subscriptions.find((subscription) => subscription.tenantId === "tenant_owner" || subscription.userId === ownerUser?.id);
  const ownerSubscriptionPayload = {
    tenantId: "tenant_owner",
    userId: ownerUser?.id || "user_local_admin",
    planId: "owner",
    status: "active",
    source: "owner_grant",
    startedAt: ownerSubscription?.startedAt || nowIso(),
    currentPeriodEnd: null
  };
  if (ownerSubscription) Object.assign(ownerSubscription, ownerSubscriptionPayload, { id: ownerSubscription.id || "sub_owner" });
  else db.subscriptions.unshift({ id: "sub_owner", ...ownerSubscriptionPayload });
  db.paymentRequests ||= [];
  db.paymentWebhooks ||= [];
  db.registrationApplications ||= [];
  db.registrationInvites ||= [];
  db.registrationRateLimits ||= [];
  db.authSessions ||= [];
  db.authSessions = db.authSessions.filter((session) => !session.expiresAt || new Date(session.expiresAt).getTime() > Date.now());

  db.exchangeAccounts ||= [
    {
      id: "ex_okx_main",
      exchange: "OKX",
      label: "OKX 统一账户",
      accountType: "unified",
      readEnabled: Boolean(process.env.OKX_API_KEY),
      tradeEnabled: Boolean(process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE),
      withdrawEnabled: false,
      ipWhitelist: "建议开启",
      status: process.env.OKX_API_KEY ? "configured" : "missing_credentials",
      lastReconciledAt: null
    }
  ];
  db.apiKeyMetadata ||= [
    { id: "key_okx", exchange: "OKX", accountId: "ex_okx_main", hasApiKey: Boolean(process.env.OKX_API_KEY), hasSecret: Boolean(process.env.OKX_API_SECRET), withdrawPermission: false, secretInLogs: false, updatedAt: nowIso() }
  ];
  db.accountSnapshots ||= [];
  db.accountingAnchors ||= [];
  db.realtimeConnections ||= [
    { id: "rt_okx_public", exchange: "OKX", streamType: "public_market", status: "stopped", symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"], lastMessageAt: null, reconnects: 0 },
    { id: "rt_okx_private", exchange: "OKX", streamType: "private_user", status: "missing_credentials", symbols: [], lastMessageAt: null, reconnects: 0 }
  ];
  // 升级迁移：配置/分析链仅保留 OKX，避免旧 Binance 元数据重新进入自动同步与状态判断。
  db.exchangeAccounts = db.exchangeAccounts.filter((item) => item.exchange === "OKX");
  db.apiKeyMetadata = db.apiKeyMetadata.filter((item) => item.exchange === "OKX");
  db.realtimeConnections = db.realtimeConnections.filter((item) => item.exchange === "OKX");
  db.tools = (db.tools || []).filter((item) => item.id !== "tool_binance");
  db.reconciliationReports ||= [];
  db.vaultItems ||= [];
  db.runtimeConfig ||= {};
  db.clearedRuntimeSecrets ||= [];
  db.toolCallStats ||= {};
  db.alerts ||= [];
  db.drillRuns ||= [];
  db.grayReleasePolicies ||= [
    {
      id: "gray_live_small_notional",
      name: "小额度实盘灰度",
      enabled: false,
      maxNotionalUsdt: Number(process.env.MAX_LIVE_NOTIONAL_USDT || 50),
      allowedSymbols: ["BTC/USDT", "ETH/USDT"],
      requiresManualApproval: true,
      createdAt: nowIso()
    }
  ];
  db.llmRuns ||= [];
  db.chatSessions ||= [];
  db.chatMessages ||= [];
  db.agentSteps ||= [];
  db.agentToolCalls ||= [];
  db.tradeIntents ||= [];
  db.executionOrders ||= [];
  db.exchangeOrders ||= [];
  db.reviewReports ||= [];
  db.strategyExperiments ||= [];
  db.eventImpacts ||= [];
  db.toolExecutions ||= [];
  db.eventSources ||= [
    { id: "src_binance_ann", name: "Binance 公告", type: "html", url: "https://www.binance.com/en/support/announcement", enabled: true, trustScore: 82 },
    { id: "src_okx_ann", name: "OKX 公告", type: "html", url: "https://www.okx.com/help/section/announcements-latest-announcements", enabled: true, trustScore: 82 },
    { id: "src_fed_press", name: "Federal Reserve Press Releases", type: "rss", url: "https://www.federalreserve.gov/feeds/press_all.xml", enabled: true, trustScore: 92 }
  ];
  db.skillRuns ||= [];

  db.orders ||= [];
  db.fills ||= [];

  db.riskRules ||= seed.riskRules;
  for (const rule of db.riskRules) {
    if (["risk_stop_required", "risk_no_withdraw"].includes(rule.id)) {
      rule.systemManaged = true;
      rule.enabled = true;
      rule.enforcementStatus = "entry_enforced";
      if (["block", "kill_switch", "restrict"].includes(rule.action)) {
        rule.action = "reject_entry";
        rule.migratedFromLegacyActionAt ||= nowIso();
      }
    }
  }
  db.riskChecks ||= [];
  db.riskIncidents ||= [];

  db.jobRuns ||= [];
  db.jobLocks ||= [];
  db.notifications ||= [];
  const requiredProfiles = defaultAgentProfiles(nowIso());
  db.agentProfiles ||= [];
  const existingProfileIds = new Set(db.agentProfiles.map((profile) => profile.id));
  for (const profile of requiredProfiles) {
    if (!existingProfileIds.has(profile.id)) db.agentProfiles.push(profile);
  }

  db.agentStateFiles ||= {
    USER: { id: "state_user", title: "USER.md", content: "尚未配置交易目标。请先配置交易所 API、模型 API，并创建授权委托。", updatedAt: nowIso() },
    AGENT: { id: "state_agent", title: "AGENT.md", content: "Agent 当前处于待配置状态；真实交易必须经过 Mandate、RiskEngine、灰度策略与 live guard。", updatedAt: nowIso() },
    HISTORY: { id: "state_history", title: "HISTORY.md", content: "暂无真实运行历史。", updatedAt: nowIso() }
  };
  db.memoryItems ||= [];
  db.agentRuns ||= [];
  if (!db.chatSessions.length) {
    const sessionId = "chat_default";
    db.chatSessions.push({
      id: sessionId,
      title: "默认对话",
      status: "active",
      createdAt: db.chatMessages[0]?.createdAt || nowIso(),
      updatedAt: db.chatMessages.at(-1)?.createdAt || nowIso()
    });
    for (const message of db.chatMessages || []) message.sessionId ||= sessionId;
  }
  for (const message of db.chatMessages || []) {
    message.sessionId ||= db.chatSessions[0]?.id || "chat_default";
  }

  db.knowledge.sourceVersions ||= [];
  db.knowledge.tradingMethods ||= [];
  db.knowledge.tradingSkills ||= [];
  db.knowledge.skillInvocations ||= [];
  db.knowledge.skillAttributions ||= [];
  db.knowledge.documentNodes ||= [];
  db.knowledge.chunks ||= [];
  db.knowledge.bookCards ||= [];
  db.knowledge.chapterCards ||= [];
  db.knowledge.theoryFrameworks ||= [];
  db.knowledge.caseCards ||= [];
  db.knowledge.conflicts ||= [];
  db.knowledge.expertGraphNodes ||= [];
  db.knowledge.expertGraphEdges ||= [];
  db.knowledge.masteryTests ||= [];
  db.knowledge.runtimeCitations ||= [];

  // 调用量旧实现只写内存，部署/重启后全部归零。首次升级时从仍保留的工具轨迹
  // 和原生 Skill 评估计数回填；之后 toolCallStats 作为正式集合持久化。
  backfillToolUsage(db);
  migrateToolUsageStats(db);

  return db;
}

export function verifyAuditChain(db) {
  const logs = auditLogsForVerification(db);
  return verifyAuditEntries(logs);
}

export function verifyAuditChainReadOnly() {
  if (!fs.existsSync(sqliteDbPath)) return { ok: false, checked: 0, breaks: [{ error: "sqlite_missing" }] };
  const reader = new Database(sqliteDbPath, { readonly: true, fileMustExist: true });
  try {
    const logs = reader.prepare("select doc from audit_log_entries order by rowid asc").all().map((row) => JSON.parse(row.doc));
    return verifyAuditEntries(logs);
  } finally {
    reader.close();
  }
}

function verifyAuditEntries(logs) {
  let previous = null;
  const breaks = [];
  for (const entry of logs) {
    if (entry.prevHash !== previous) {
      breaks.push({ id: entry.id, expectedPrevHash: previous, actualPrevHash: entry.prevHash });
    }
    if (entry.hash) {
      const expectedHash = auditHash(entry);
      if (entry.hash !== expectedHash) breaks.push({ id: entry.id, expectedHash, actualHash: entry.hash });
    }
    previous = entry.hash || auditHash(entry);
  }
  return { ok: breaks.length === 0, checked: logs.length, breaks };
}

function auditLogsForVerification(db) {
  try {
    ensureSqlite();
    const rows = sqlite.prepare("select doc from audit_log_entries order by rowid asc").all();
    if (rows.length) return rows.map((row) => JSON.parse(row.doc));
  } catch {
    // Fall through to the in-memory window when SQLite is unavailable.
  }
  return [...(db.auditLogs || [])].reverse();
}

function auditHash(entry) {
  const payload = {
    id: entry.id,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    severity: entry.severity,
    prevHash: entry.prevHash || null,
    createdAt: entry.createdAt
  };
  if (entry.requestedBy) {
    payload.requestedBy = entry.requestedBy;
    payload.requestedByUserId = entry.requestedByUserId || null;
    payload.tenantId = entry.tenantId || null;
  }
  const canonical = JSON.stringify(payload);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
