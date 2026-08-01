import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import "dotenv/config";
import { currentRequestContext } from "./requestContext.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// 全部权限清单（种子）。
export const ALL_PERMISSIONS = [
  "market.read", "account.read", "trade.write_guarded", "risk.check", "risk.kill_switch",
  "write:mandate", "write:trade_plan", "write:risk", "write:knowledge", "write:skills",
  "write:event", "write:exchange", "write:realtime", "write:review", "write:mcp", "write:task",
  "admin:security", "admin:system", "critical:trade_execution", "critical:kill_switch",
  "approve:trade_plan", "approve:live_config", "approve:knowledge_skill",
  "knowledge.read", "knowledge.write", "skill.install", "mcp.register", "audit.read", "trace.read", "audit.export"
];

// 最小权限交易员：可以研究、创建计划和请求风控，但不能管理密钥/插件，
// 也不能直接跨过“批准者/执行者”职责边界。Owner 仍通过管理员角色拥有全部权限。
export const TRADER_PERMISSIONS = [
  "market.read", "account.read", "risk.check", "knowledge.read", "knowledge.write",
  "write:mandate", "write:trade_plan", "write:knowledge",
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
  "paymentRequests",
  "paymentWebhooks",
  "authSessions",
  "system",
  "portfolio",
  "markets",
  "watchlist",
  "mandates",
  "positions",
  "orders",
  "fills",
  "tradePlans",
  "events",
  "tasks",
  "jobRuns",
  "jobLocks",
  "knowledge",
  "analysisBundles",
  "backtests",
  "skills",
  "tools",
  "mcpServers",
  "exchangeAccounts",
  "apiKeyMetadata",
  "accountSnapshots",
  "realtimeConnections",
  "reconciliationReports",
  "vaultItems",
  "runtimeConfig",
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
  "reviews",
  "pendingActions"
];
// High-value trading objects are also persisted one row per entity. This avoids
// rewriting an entire JSON collection for every fill/order/risk update and gives
// tenant/resource indexes for recovery and future repository-only operation.
const entityCollectionNames = [
  "mandates", "positions", "orders", "fills", "tradePlans", "events", "tasks",
  "riskChecks", "riskIncidents", "executionOrders", "accountSnapshots",
  "reconciliationReports", "reviews", "agentRuns", "paperSessions", "strategyProfiles"
];

let sqlite;

export function nowIso() {
  return new Date().toISOString();
}

export function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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
  const hasBinance = Boolean(process.env.BINANCE_API_KEY);
  const hasBinanceSecret = Boolean(process.env.BINANCE_API_SECRET);
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
      "knowledge.read", "knowledge.write", "skill.install", "mcp.register", "audit.export"
    ],
    subscriptionPlans: defaultSubscriptionPlans(createdAt),
    subscriptions: [{ id: "sub_owner", tenantId: "tenant_owner", userId: "user_local_admin", planId: "owner", status: "active", source: "owner_grant", startedAt: createdAt, currentPeriodEnd: null }],
    paymentRequests: [],
    paymentWebhooks: [],
    authSessions: [],
    system: {
      autonomyEnabled: false,
      liveTradingEnabled: false,
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
    mandates: [],
    positions: [],
    orders: [],
    fills: [],
    tradePlans: [],
    events: [],
    tasks: [],
    jobRuns: [],
    jobLocks: [],
    knowledge: emptyKnowledge(),
    analysisBundles: [],
    skills: [],
    tools: [
      { id: "tool_binance", name: "Binance Connector", type: "exchange", status: hasBinance ? "configured" : "missing_credentials", permissions: ["market.read", "account.read", "trade.write_guarded"] },
      { id: "tool_okx", name: "OKX Connector", type: "exchange", status: hasOkx ? "configured" : "missing_credentials", permissions: ["market.read", "account.read", "trade.write_guarded"] },
      { id: "tool_llm", name: "LLM Agent", type: "model", status: process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY ? "configured" : "missing_credentials", permissions: ["agent.reasoning"] },
      { id: "tool_public_market", name: "Public Market Data", type: "data", status: "available_without_key", permissions: ["market.read"] }
    ],
    mcpServers: [],
    exchangeAccounts: [
      {
        id: "ex_binance_main",
        exchange: "BINANCE",
        label: "Binance 主账户",
        accountType: "unified",
        readEnabled: hasBinance,
        tradeEnabled: hasBinance && hasBinanceSecret,
        withdrawEnabled: false,
        ipWhitelist: "建议开启",
        status: hasBinance ? "configured" : "missing_credentials",
        lastReconciledAt: null
      },
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
      { id: "key_binance", exchange: "BINANCE", accountId: "ex_binance_main", hasApiKey: hasBinance, hasSecret: hasBinanceSecret, withdrawPermission: false, secretInLogs: false, updatedAt: createdAt },
      { id: "key_okx", exchange: "OKX", accountId: "ex_okx_main", hasApiKey: hasOkx, hasSecret: hasOkxSecret, withdrawPermission: false, secretInLogs: false, updatedAt: createdAt }
    ],
    accountSnapshots: [],
    realtimeConnections: [
      { id: "rt_binance_public", exchange: "BINANCE", streamType: "public_market", status: "stopped", symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"], lastMessageAt: null, reconnects: 0 },
      { id: "rt_okx_public", exchange: "OKX", streamType: "public_market", status: "stopped", symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"], lastMessageAt: null, reconnects: 0 },
      { id: "rt_binance_private", exchange: "BINANCE", streamType: "private_user", status: hasBinance ? "stopped" : "missing_credentials", symbols: [], lastMessageAt: null, reconnects: 0 },
      { id: "rt_okx_private", exchange: "OKX", streamType: "private_user", status: hasOkx ? "stopped" : "missing_credentials", symbols: [], lastMessageAt: null, reconnects: 0 }
    ],
    reconciliationReports: [],
    vaultItems: [],
    runtimeConfig: {},
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
    eventImpacts: [],
    toolExecutions: [],
    eventSources: [
      { id: "src_binance_ann", name: "Binance 公告", type: "html", url: "https://www.binance.com/en/support/announcement", enabled: true, trustScore: 82 },
      { id: "src_okx_ann", name: "OKX 公告", type: "html", url: "https://www.okx.com/help/section/announcements-latest-announcements", enabled: true, trustScore: 82 },
      { id: "src_fed_press", name: "Federal Reserve Press Releases", type: "rss", url: "https://www.federalreserve.gov/feeds/press_all.xml", enabled: true, trustScore: 92 }
    ],
    skillRuns: [],
    riskRules: [
      { id: "risk_stop_required", name: "自主交易必须带止损", scope: "trade", level: "L4", enabled: true, action: "block", description: "无止损交易计划不得进入执行器。" },
      { id: "risk_no_withdraw", name: "API Key 禁止提现权限", scope: "account", level: "L5", enabled: true, action: "kill_switch", description: "检测到提现权限时禁止交易并触发熔断。" }
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
  saveDb(normalized); // 确保所有集合（含审计条目）已落入 SQLite，再校准审计链
  ensureAuditChainIntegrity(normalized);
  return normalized;
}

// 审计链完整性：历史数据一次性重链（修复排序缺陷造成的 prevHash 断裂），之后每次启动
// 只把链尾 hash 同步回 db.meta.auditChainTip，供 appendAudit 续链。
function ensureAuditChainIntegrity(db) {
  db.meta ||= {};
  if (!db.meta.auditChainResealedV2) {
    const result = resealAuditChain(db);
    appendAudit(db, `审计链重建：修复历史 prevHash 断裂，共重链 ${result.resealed} 条`, "audit_chain", "System", "warning");
    saveDb(db);
    return;
  }
  // 已做过历史重链,但若又出现新断点(同秒批量写/跨进程写竞态造成的 prevHash 错位),再自愈一次。
  // 只重写 prevHash+hash 使链自洽,不改任何条目内容。断点过多(疑似真问题)则不自愈、留待人工。
  const fresh = verifyAuditChain(db);
  if (!fresh.ok) {
    const cap = Number(process.env.AUDIT_RESEAL_MAX_BREAKS || 20);
    if (fresh.breaks.length <= cap) {
      const result = resealAuditChain(db);
      appendAudit(db, `审计链自愈：修复新出现的 ${fresh.breaks.length} 处 prevHash 断裂(写入竞态),重链 ${result.resealed} 条,未改条目内容`, "audit_chain", "System", "warning");
      saveDb(db);
      return;
    }
  }
  const tip = latestAuditHash();
  if (tip && db.meta.auditChainTip !== tip) {
    db.meta.auditChainTip = tip;
    saveDb(db);
  }
}

function latestAuditHash() {
  try {
    ensureSqlite();
    const row = sqlite.prepare("select doc from audit_log_entries order by created_at desc, rowid desc limit 1").get();
    return row ? JSON.parse(row.doc).hash || null : null;
  } catch {
    return null;
  }
}

// 按校验所用的规范顺序（created_at asc, rowid asc）重新计算整条链的 prevHash 与 hash，
// 使 verifyAuditChain 必然通过。仅在检测到旧版本未重链时运行一次。
function resealAuditChain(db) {
  ensureSqlite();
  const rows = sqlite.prepare("select rowid as rid, doc from audit_log_entries order by created_at asc, rowid asc").all();
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
  db.meta.auditChainResealedV2 = nowIso();
  db.auditLogs = sqlite.prepare("select doc from audit_log_entries order by created_at desc, rowid desc limit 1000").all().map((row) => JSON.parse(row.doc));
  return { resealed: rows.length, tip: previous };
}

// 日志型集合上限：防止长期累积把 saveDb 的全库序列化拖垮（曾累积到 accountSnapshots 22K / jobRuns 95K
// / jobLocks 90K，导致每次 saveDb 序列化上百 MB → 100% CPU + OOM）。超限时按时间戳保留最近 N 条。
const LOG_CAPS = {
  accountSnapshots: 500, jobRuns: 1000, reconciliationReports: 200, agentRuns: 300,
  agentSteps: 800, agentToolCalls: 800, llmRuns: 500, toolExecutions: 500,
  executionOrders: 1000, exchangeOrders: 1000, skillRuns: 300, drillRuns: 200,
  eventImpacts: 500, reviewReports: 300, notifications: 500, riskChecks: 800, riskIncidents: 500,
  // 审计补:此前无上限、长期运行必然膨胀且每次 saveDb 全量重写的集合(fills 留足核算窗口)。
  chatMessages: 400, chatSessions: 100, memoryItems: 500, analysisBundles: 200,
  tradeIntents: 500, backtests: 100, strategyExperiments: 200, orders: 3000, fills: 5000, traces: 1000
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

export function saveDb(db, options = {}) {
  db.meta.updatedAt = nowIso();
  capLogCollections(db);
  ensureSqlite();
  saveToSqlite(db, options);
}

export function resetOperationalData(db, options = {}) {
  const seed = seedDatabase();
  const keepAudit = options.keepAudit !== false;
  Object.assign(db.portfolio, seed.portfolio);
  db.system.autonomyEnabled = false;
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
  db.events = [];
  db.tasks = [];
  db.jobRuns = [];
  db.jobLocks = [];
  db.knowledge = emptyKnowledge();
  db.analysisBundles = [];
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
  db.eventImpacts = [];
  db.toolExecutions = [];
  db.skillRuns = [];
  db.riskChecks = [];
  db.riskIncidents = [];
  db.notifications = [];
  db.memoryItems = [];
  db.agentRuns = [];
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
  // 用显式持久化的链尾 hash 作为 prevHash，而不是依赖 db.auditLogs[0]（内存窗口在
  // created_at 相同的批量写入/重启边界上顺序不确定，会与校验时的 created_at asc, rowid asc
  // 排序产生分叉，导致 prevHash 断裂）。
  const prevHash = db.meta.auditChainTip ?? db.auditLogs?.[0]?.hash ?? null;
  const request = currentRequestContext();
  const entry = {
    id: id("audit"),
    actor,
    action,
    target,
    severity,
    prevHash,
    createdAt: nowIso(),
    ...(request?.actor ? { requestedBy: request.actor, requestedByUserId: request.userId, tenantId: request.tenantId } : {})
  };
  entry.hash = auditHash(entry);
  db.auditLogs.unshift(entry);
  db.meta.auditChainTip = entry.hash;
  writeAuditEntry(entry);
  return entry;
}

// latencyMs 只接受真实测量值；不传就是 null（此前默认随机数 80-980ms，会被前端当真实延迟画进 P95 图）。
export function appendTrace(db, type, title, status = "ok", latencyMs = null) {
  const entry = { id: id("trace"), type, title, status, latencyMs, createdAt: nowIso() };
  db.traces.unshift(entry);
  writeTraceEntry(entry);
  return entry;
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

function ensureSqlite() {
  if (sqlite) return sqlite;
  sqlite = new Database(sqliteDbPath);
  sqlite.pragma("journal_mode = WAL");
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

function stablePayloadHash(payload = {}) {
  const normalized = {};
  for (const key of Object.keys(payload).sort()) {
    if (["apiSecret", "secret", "passphrase", "manualApproval"].includes(key)) continue;
    normalized[key] = payload[key];
  }
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
    return {
      status: existing.payload_hash === payloadHash ? "replay" : "conflict",
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
  const responseDoc = details.response === undefined ? current.response_doc : JSON.stringify(details.response);
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
    `).run(orderId, current.state, toState, details.eventType || "state_changed", JSON.stringify(details), updatedAt);
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
  const safe = { ...payload };
  for (const key of ["apiSecret", "secret", "passphrase", "password", "apiKey"]) delete safe[key];
  return safe;
}

function loadFromSqlite() {
  const rows = sqlite.prepare("select name, value from collections").all();
  if (!rows.length) return null;
  const db = {};
  for (const row of rows) db[row.name] = JSON.parse(row.value);
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
    for (const entry of db.auditLogs || []) writeAuditEntry(entry);
    for (const entry of db.traces || []) writeTraceEntry(entry);
    persistTradingEntities(db, updatedAt);
  });
  write();
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
      const doc = { ...item, tenantId };
      upsert.run({
        tenant_id: tenantId,
        resource_type: resourceType,
        resource_id: item.id,
        status: item.status || null,
        symbol: item.symbol || null,
        created_at: createdAt,
        updated_at: item.updatedAt || updatedAt,
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
}

export function normalizeDatabase(db) {
  const seed = seedDatabase();
  db.meta ||= seed.meta;
  db.meta.schemaVersion = 3;
  db.user ||= seed.user;
  db.system ||= seed.system;
  db.portfolio ||= seed.portfolio;
  db.markets ||= seed.markets;
  db.mandates ||= seed.mandates;
  db.positions ||= seed.positions;
  db.tradePlans ||= seed.tradePlans;
  db.events ||= seed.events;
  db.tasks ||= seed.tasks;
  db.knowledge ||= seed.knowledge;
  db.analysisBundles ||= seed.analysisBundles;
  db.skills ||= seed.skills;
  db.tools ||= seed.tools;
  db.mcpServers ||= seed.mcpServers;
  db.traces ||= seed.traces;
  db.auditLogs ||= seed.auditLogs;
  db.reviews ||= seed.reviews;

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
  // 迁移:交易用户可确认下单(扫描候选→确认→直接下单)。给存量库补交易执行权限(幂等)。
  const traderRole = db.roles.find((role) => role.id === "role_trader");
  if (traderRole) traderRole.permissions = [...new Set([...(traderRole.permissions || []), "approve:trade_plan", "critical:trade_execution", "risk.check"])];
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
  db.authSessions ||= [];
  db.authSessions = db.authSessions.filter((session) => !session.expiresAt || new Date(session.expiresAt).getTime() > Date.now());

  db.exchangeAccounts ||= [
    {
      id: "ex_binance_main",
      exchange: "BINANCE",
      label: "Binance 主账户",
      accountType: "unified",
      readEnabled: Boolean(process.env.BINANCE_API_KEY),
      tradeEnabled: Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET),
      withdrawEnabled: false,
      ipWhitelist: "建议开启",
      status: process.env.BINANCE_API_KEY ? "configured" : "missing_credentials",
      lastReconciledAt: null
    },
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
    { id: "key_binance", exchange: "BINANCE", accountId: "ex_binance_main", hasApiKey: Boolean(process.env.BINANCE_API_KEY), hasSecret: Boolean(process.env.BINANCE_API_SECRET), withdrawPermission: false, secretInLogs: false, updatedAt: nowIso() },
    { id: "key_okx", exchange: "OKX", accountId: "ex_okx_main", hasApiKey: Boolean(process.env.OKX_API_KEY), hasSecret: Boolean(process.env.OKX_API_SECRET), withdrawPermission: false, secretInLogs: false, updatedAt: nowIso() }
  ];
  db.accountSnapshots ||= [];
  db.realtimeConnections ||= [
    { id: "rt_binance_public", exchange: "BINANCE", streamType: "public_market", status: "stopped", symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"], lastMessageAt: null, reconnects: 0 },
    { id: "rt_okx_public", exchange: "OKX", streamType: "public_market", status: "stopped", symbols: ["BTC/USDT", "ETH/USDT", "SOL/USDT"], lastMessageAt: null, reconnects: 0 },
    { id: "rt_binance_private", exchange: "BINANCE", streamType: "private_user", status: "missing_credentials", symbols: [], lastMessageAt: null, reconnects: 0 },
    { id: "rt_okx_private", exchange: "OKX", streamType: "private_user", status: "missing_credentials", symbols: [], lastMessageAt: null, reconnects: 0 }
  ];
  db.reconciliationReports ||= [];
  db.vaultItems ||= [];
  db.runtimeConfig ||= {};
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
  db.riskChecks ||= [];
  db.riskIncidents ||= [];

  db.jobRuns ||= [];
  db.jobLocks ||= [];
  db.notifications ||= [];
  db.agentProfiles ||= defaultAgentProfiles(nowIso());

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

  return db;
}

export function verifyAuditChain(db) {
  const logs = auditLogsForVerification(db);
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
    const rows = sqlite.prepare("select doc from audit_log_entries order by created_at asc, rowid asc").all();
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
