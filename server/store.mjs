import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

// 全部权限清单（种子）。
export const ALL_PERMISSIONS = [
  "market.read", "account.read", "trade.write_guarded", "risk.check", "risk.kill_switch",
  "write:mandate", "write:trade_plan", "write:risk", "write:knowledge", "write:skills",
  "write:event", "write:exchange", "write:realtime", "write:review", "write:mcp", "write:task",
  "admin:security", "admin:system", "critical:trade_execution", "critical:kill_switch",
  "knowledge.read", "knowledge.write", "skill.install", "mcp.register", "audit.export"
];

// 交易用户（非 Owner）：拥有除「用户管理 admin:system」外的全部功能——
// 可连交易所、开实盘、批准/执行交易、开熔断、装 skill、写知识等，与 Owner 一致，只是不能管理用户。
export const TRADER_PERMISSIONS = ALL_PERMISSIONS.filter((p) => p !== "admin:system");
const dataDir = path.resolve(rootDir, process.env.DATA_DIR || "data");
const jsonDbPath = path.join(dataDir, "db.json");
const sqliteDbPath = path.join(dataDir, "trading-agent.sqlite");
const defaultOwnerEmail = process.env.OWNER_EMAIL || "aliarlan1028@gmail.com";
const collectionNames = [
  "meta",
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
  "positionMonitors",
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

let sqlite;

export function nowIso() {
  return new Date().toISOString();
}

export function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeCandles() {
  const candles = [];
  let price = 65000;
  for (let i = 0; i < 96; i += 1) {
    const drift = Math.sin(i / 7) * 180 + Math.cos(i / 4) * 90 + (i > 66 ? 35 : 0);
    const open = price;
    const close = Math.max(60000, open + drift + (Math.random() - 0.45) * 210);
    const high = Math.max(open, close) + 160 + Math.random() * 260;
    const low = Math.min(open, close) - 140 - Math.random() * 230;
    candles.push({
      time: `07-${String(Math.floor(i / 24) + 1).padStart(2, "0")} ${String(i % 24).padStart(2, "0")}:00`,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: Number((240 + Math.random() * 980).toFixed(0))
    });
    price = close;
  }
  return candles;
}

function emptyKnowledge() {
  return {
    sources: [],
    conceptCards: [],
    ruleProposals: [],
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
      totalEquityUsdt: null,
      availableMarginUsdt: null,
      frozenUsdt: null,
      todayPnl: null,
      todayPnlPct: null,
      weekPnl: null,
      weekPnlPct: null,
      maxDrawdownPct: null,
      riskScore: null,
      riskLabel: "未同步",
      monthlyTrades: 0,
      monthlyTradeLimit: null
    },
    markets: [
      { symbol: "BTC/USDT", status: "not_synced", candles: [] },
      { symbol: "ETH/USDT", status: "not_synced", candles: [] },
      { symbol: "SOL/USDT", status: "not_synced", candles: [] }
    ],
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
    positionMonitors: [],
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
export function resealAuditChain(db) {
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

export function saveDb(db) {
  db.meta.updatedAt = nowIso();
  ensureSqlite();
  saveToSqlite(db);
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
  db.positionMonitors = [];
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
  const entry = { id: id("audit"), actor, action, target, severity, prevHash, createdAt: nowIso() };
  entry.hash = auditHash(entry);
  db.auditLogs.unshift(entry);
  db.meta.auditChainTip = entry.hash;
  writeAuditEntry(entry);
  return entry;
}

export function appendTrace(db, type, title, status = "ok", latencyMs = Math.floor(80 + Math.random() * 900)) {
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
  `);
  return sqlite;
}

function loadFromSqlite() {
  const rows = sqlite.prepare("select name, value from collections").all();
  if (!rows.length) return null;
  const db = {};
  for (const row of rows) db[row.name] = JSON.parse(row.value);
  db.auditLogs = sqlite.prepare("select doc from audit_log_entries order by created_at desc, rowid desc limit 1000").all().map((row) => JSON.parse(row.doc));
  db.traces = sqlite.prepare("select doc from trace_entries order by created_at desc, rowid desc limit 1000").all().map((row) => JSON.parse(row.doc));
  return db;
}

function saveToSqlite(db) {
  const updatedAt = nowIso();
  const upsert = sqlite.prepare(`
    insert into collections (name, value, updated_at)
    values (@name, @value, @updated_at)
    on conflict(name) do update set value = excluded.value, updated_at = excluded.updated_at
  `);
  const write = sqlite.transaction(() => {
    for (const name of collectionNames) {
      if (db[name] !== undefined) upsert.run({ name, value: JSON.stringify(db[name]), updated_at: updatedAt });
    }
    for (const entry of db.auditLogs || []) writeAuditEntry(entry);
    for (const entry of db.traces || []) writeTraceEntry(entry);
  });
  write();
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
  db.meta.schemaVersion = 2;
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
    { id: "role_trader", name: "交易用户", permissions: ["trade.read", "write:mandate", "write:knowledge"] },
    { id: "role_auditor", name: "审计员", permissions: ["audit.read", "trace.read"] }
  ];
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
    "knowledge.read",
    "knowledge.write",
    "skill.install",
    "mcp.register",
    "audit.export"
  ];
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
  db.positionMonitors ||= [];
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
  const canonical = JSON.stringify({
    id: entry.id,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    severity: entry.severity,
    prevHash: entry.prevHash || null,
    createdAt: entry.createdAt
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}
