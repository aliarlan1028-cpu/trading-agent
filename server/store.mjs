import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = path.resolve(rootDir, process.env.DATA_DIR || "data");
const jsonDbPath = path.join(dataDir, "db.json");
const sqliteDbPath = path.join(dataDir, "trading-agent.sqlite");
const collectionNames = [
  "meta",
  "user",
  "users",
  "roles",
  "permissions",
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
  "agentStateFiles",
  "memoryItems",
  "agentRuns",
  "reviews"
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

function cleanSeedDatabase(createdAt) {
  const hasBinance = Boolean(process.env.BINANCE_API_KEY);
  const hasBinanceSecret = Boolean(process.env.BINANCE_API_SECRET);
  const hasOkx = Boolean(process.env.OKX_API_KEY);
  const hasOkxSecret = Boolean(process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE);
  return {
    meta: { version: 1, createdAt, updatedAt: createdAt },
    user: {
      id: "user_local_admin",
      name: "本地管理员",
      role: "管理员",
      riskMode: "medium",
      locale: "zh-CN"
    },
    users: [{ id: "user_local_admin", name: "本地管理员", email: "admin@example.local", role: "管理员", status: "active" }],
    roles: [
      { id: "role_admin", name: "管理员", permissions: ["*"] },
      { id: "role_trader", name: "交易用户", permissions: ["trade.read", "write:mandate", "write:knowledge"] },
      { id: "role_auditor", name: "审计员", permissions: ["audit.read", "trace.read"] }
    ],
    permissions: [
      "market.read", "account.read", "trade.write_guarded", "risk.check", "risk.kill_switch",
      "write:mandate", "write:trade_plan", "write:risk", "write:knowledge", "write:skills",
      "write:event", "write:exchange", "write:realtime", "write:review", "write:mcp", "write:task",
      "admin:security", "admin:system", "critical:trade_execution", "critical:kill_switch",
      "knowledge.read", "knowledge.write", "skill.install", "mcp.register", "audit.export"
    ],
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
  if (sqliteState) {
    const normalized = normalizeDatabase(sqliteState);
    saveDb(normalized);
    return normalized;
  }
  const db = fs.existsSync(jsonDbPath) ? JSON.parse(fs.readFileSync(jsonDbPath, "utf8")) : seedDatabase();
  const normalized = normalizeDatabase(db);
  saveDb(normalized);
  return normalized;
}

export function saveDb(db) {
  db.meta.updatedAt = nowIso();
  ensureSqlite();
  saveToSqlite(db);
}

export function appendAudit(db, action, target, actor = "System", severity = "info") {
  const entry = { id: id("audit"), actor, action, target, severity, prevHash: db.auditLogs?.[0]?.hash || null, createdAt: nowIso() };
  entry.hash = auditHash(entry);
  db.auditLogs.unshift(entry);
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
  db.auditLogs = sqlite.prepare("select doc from audit_log_entries order by created_at desc limit 1000").all().map((row) => JSON.parse(row.doc));
  db.traces = sqlite.prepare("select doc from trace_entries order by created_at desc limit 1000").all().map((row) => JSON.parse(row.doc));
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

  db.users ||= [{ ...db.user, email: "admin@example.local", status: "active" }];
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

  db.agentStateFiles ||= {
    USER: { id: "state_user", title: "USER.md", content: "尚未配置交易目标。请先配置交易所 API、模型 API，并创建授权委托。", updatedAt: nowIso() },
    AGENT: { id: "state_agent", title: "AGENT.md", content: "Agent 当前处于待配置状态；真实交易必须经过 Mandate、RiskEngine、灰度策略与 live guard。", updatedAt: nowIso() },
    HISTORY: { id: "state_history", title: "HISTORY.md", content: "暂无真实运行历史。", updatedAt: nowIso() }
  };
  db.memoryItems ||= [];
  db.agentRuns ||= [];

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

  normalizeAuditChain(db);
  return db;
}

export function verifyAuditChain(db) {
  const logs = [...(db.auditLogs || [])].reverse();
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

function normalizeAuditChain(db) {
  const chronological = [...(db.auditLogs || [])].reverse();
  let previous = null;
  for (const entry of chronological) {
    entry.prevHash = previous;
    entry.hash = auditHash(entry);
    previous = entry.hash;
  }
  db.auditLogs = chronological.reverse();
}
