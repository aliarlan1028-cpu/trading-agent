import cors from "cors";
import crypto from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performanceReport, refreshAccounting } from "./accounting.mjs";
import { applyStoredConfigToEnv, clearSecret, getConfigStatus, setConfig } from "./runtimeConfig.mjs";
import { activeProvider, runAgentChat, llmComplete } from "./agentChat.mjs";
import { addMemoryItem, recheckActivePlanRisk, runAgentCycle, updateStateFile } from "./agentRuntime.mjs";
import { closeExecution, executeApprovedPlan, pollExecutionOrders } from "./executionEngine.mjs";
import { monitorPositions } from "./positionManager.mjs";
import { activateMandate, changeAgentRunStatus, getAgentStatus, parseMandateCommand, runAgentCommand } from "./agentOrchestrator.mjs";
import { hashPassword, installAuth, invalidateSessions, requirePermission, verifyPassword } from "./auth.mjs";
import { exportAuditLogs, exportTraces } from "./auditExport.mjs";
import { executeTradePlan } from "./executor.mjs";
import { getHistoricalKlines, guardedPrivateExchangeAction, reconcileAccount, refreshApiKeyMetadata, syncMicrostructure, syncPrivateReadOnly, syncPublicKlines, syncPublicMarket } from "./exchangeConnector.mjs";
import { fetchMarketRegime, fetchPerpetualInstruments } from "./marketSignals.mjs";
import { fetchTokenProfile } from "./tokenProfile.mjs";
import { startMarketStream, addStreamListener, removeStreamListener, marketStreamStatus, setMarketTickHook, broadcastRaw } from "./marketStream.mjs";
import { runBacktest } from "./backtestEngine.mjs";
import { activeStrategyProfiles, runStrategyResearch } from "./strategyOptimizer.mjs";
import { listStrategies } from "./strategies.mjs";
import { buildPortfolioRisk } from "./portfolioRisk.mjs";
import { buildPaperReport, createPaperSession, ensurePaperSessionsFromProfiles, runPaperForward } from "./paperTrading.mjs";
import { larkStatus, notifyLark } from "./larkNotifier.mjs";
import { sendTelegramPositionPoster, telegramStatus } from "./telegramNotifier.mjs";
import { ensureDefaultEventSources, rankEvents, refreshEventSources, refreshOnchainSignals, runAgentMission } from "./eventSources.mjs";
import { embeddingStatus, importGithubKnowledge, importKnowledge as importKnowledgeReal, parseKnowledgeSource as parseKnowledgeRealSource, ragQuery, reembedAllChunks } from "./knowledgePipeline.mjs";
import { runExpertAnalysis } from "./knowledgeEngine.mjs";
import { runLlmAgent } from "./llmAgent.mjs";
import { installProxyFromEnv } from "./netProxy.mjs";
import { buildReadinessReport, createSystemBackup } from "./ops.mjs";
import { runReconciler } from "./reconciler.mjs";
import { backfillReviewFields, buildReviewAnalytics, createStrategyImprovementCycle, runTradeReflection } from "./reviewEngine.mjs";
import { realtimeStatus, startRealtimeManager, stopRealtimeManager } from "./realtimeManager.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { ensureSystemTask, registerTaskHandler, runTask, scheduleTask, schedulerStatus, startScheduler } from "./scheduler.mjs";
import { listVaultItems, runSafetyDrill, sendAlert, storeSecret } from "./securityOps.mjs";
import { installSkill, scanSkill } from "./skillManager.mjs";
import { seedSkillTools } from "./skillTools.mjs";
import { connectMcpServer, mcpStatus } from "./mcpClient.mjs";
import { fetchSkillPackage, runSkillSandbox } from "./skillSandbox.mjs";
import { appendAudit, appendTrace, getStorageInfo, id, loadDb, nowIso, resetOperationalData, saveDb, TRADER_PERMISSIONS, verifyAuditChain } from "./store.mjs";
import { describeGuardReason, executeTradeAction } from "./tradeActions.mjs";

dotenv.config();
installProxyFromEnv();

const app = express();
const db = loadDb();
app.locals.db = db;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../dist");

applyStoredConfigToEnv(db);
installProxyFromEnv();
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
// 实盘三道闸以 db.system 持久化值为准（存 sqlite，重启不丢）；仅在未初始化时用 env 兜底。
db.system.realTradingAck = db.system.realTradingAck ?? (process.env.I_UNDERSTAND_REAL_TRADING === "true");
db.system.orderWriteEnabled = db.system.orderWriteEnabled ?? (process.env.REAL_ORDER_WRITE_ENABLED === "true");
db.system.liveTradingEnabled = (db.system.liveTradingEnabled ?? (process.env.LIVE_TRADING_ENABLED === "true")) && db.system.realTradingAck === true;
// 交易用户角色对齐到最新权限集（除用户管理外与 Owner 一致）——覆盖旧库里被限制的种子。
const traderRole = (db.roles || []).find((role) => role.name === "交易用户" || role.id === "role_trader");
if (traderRole) traderRole.permissions = TRADER_PERMISSIONS;
refreshApiKeyMetadata(db);
seedSkillTools(db);
ensureDefaultEventSources(db);
// 一次性收敛历史重复告警：同一来源(source)的 open 事件只保留最新一条，累计计数，避免刷屏。
(function collapseDuplicateIncidents() {
  const groups = new Map();
  for (const inc of db.riskIncidents || []) {
    if (inc.status !== "open" || !inc.source) { continue; }
    const key = `${inc.source}|${String(inc.title || "").replace(/[·×].*$/, "").slice(0, 40)}`;
    const seen = groups.get(key);
    if (seen) {
      seen.count = (seen.count || 1) + (inc.count || 1);
      if (new Date(inc.createdAt) > new Date(seen.createdAt)) seen.lastSeenAt = inc.createdAt;
      inc.__drop = true;
    } else {
      groups.set(key, inc);
    }
  }
  const before = (db.riskIncidents || []).length;
  db.riskIncidents = (db.riskIncidents || []).filter((inc) => !inc.__drop);
  if (db.riskIncidents.length !== before) appendAudit(db, `收敛重复告警 ${before - db.riskIncidents.length} 条`, "startup", "Maintenance");
})();
saveDb(db);

app.use(cors());
app.use(express.json({ limit: "20mb" }));
app.use(express.static(publicDir));
app.get(/^\/(?!api(?:\/|$)).*/, (_req, res, next) => {
  res.sendFile(path.join(publicDir, "index.html"), (error) => {
    if (error) next(error);
  });
});
installAuth(app, db);

// 注册真实任务处理器并确保系统任务存在（执行轮询/持仓监控/核算/自主巡检/对账）
registerTaskHandler("execution_poll", (database) => pollExecutionOrders(database));
registerTaskHandler("position_monitor", (database) => monitorPositions(database));
registerTaskHandler("accounting_refresh", (database) => refreshAccounting(database));
registerTaskHandler("agent_cycle", async (database) => {
  const run = await runAgentCycle(database, {}, saveDb);
  recheckActivePlanRisk(database);
  return run;
});
registerTaskHandler("reconcile", (database) => runReconciler(database, { mode: "scheduled" }));
registerTaskHandler("strategy_research", (database) => runStrategyResearch(database, {}));
registerTaskHandler("paper_forward", (database) => runPaperForward(database));
// ② 平仓自动复盘：逐笔沉淀教训入记忆。
registerTaskHandler("trade_reflection", (database) => runTradeReflection(database));
// ① 策略改进闭环：每积累 N 笔平仓自动跑一次（找亏损簇→提假设→三段验证）。
registerTaskHandler("strategy_improvement", (database) => {
  const closes = (database.fills || []).filter((f) => f.kind === "close" && Number.isFinite(Number(f.realizedPnl))).length;
  const last = Number(database.system.lastImprovementCloses || 0);
  const need = Number(process.env.IMPROVEMENT_MIN_NEW_CLOSES || 10);
  if (closes - last < need) return { status: "skipped", reason: `新增平仓 ${closes - last}/${need} 未达触发线` };
  const cycle = createStrategyImprovementCycle(database);
  database.system.lastImprovementCloses = closes;
  return { status: "ok", experimentId: cycle.experiment?.id, hypothesis: cycle.experiment?.hypothesis };
});
registerTaskHandler("event_refresh", (database) => refreshEventSources(database));
registerTaskHandler("agent_mission", (database, task) => runAgentMission(database, task));
registerTaskHandler("payment_verify", (database) => verifyTrc20Payments(database));
registerTaskHandler("okx_readonly_sync", async (database) => {
  const accounts = (database.exchangeAccounts || []).filter((item) => item.readEnabled);
  if (!accounts.length) return { status: "no_read_account" };
  let synced = 0;
  for (const account of accounts) {
    try { await syncPrivateReadOnly(database, account.id); synced += 1; } catch { /* 单账户失败不阻断 */ }
  }
  return { status: "ok", synced };
});
// 定时刷新合约微观结构 + 大盘/聪明钱，让这些卡片近实时（配合前端 15s 轮询）。
registerTaskHandler("market_signal_refresh", async (database) => {
  const mandate = (database.mandates || []).find((m) => ["active", "running"].includes(m.status));
  // 始终刷 BTC/ETH（常作默认展示的 activeMarket）+ 授权交易对，避免卡片显示的币未被刷新。
  const symbols = [...new Set(["BTC/USDT", "ETH/USDT", ...(mandate?.allowedSymbols || [])])].slice(0, 4);
  let synced = 0;
  for (const symbol of symbols) {
    try { await syncMicrostructure(database, "OKX", symbol); synced += 1; } catch { /* 单交易对失败不阻断 */ }
  }
  try {
    const regime = await fetchMarketRegime(symbols[0] || "BTC/USDT");
    const prev = database.marketRegime || {};
    // 免费额度偶发 429 会返回 null；此时保留上一次的好值，避免主导率/聪明钱闪成"未取"。
    database.marketRegime = {
      ...regime,
      global: regime.global || prev.global || null,
      smartMoney: regime.smartMoney || prev.smartMoney || null,
      updatedAt: nowIso()
    };
  } catch { /* 大盘拉取失败不阻断 */ }
  return { status: "ok", synced };
});
ensureSystemTask(db, { id: "task_sys_okx_sync", name: "交易所余额同步", handler: "okx_readonly_sync", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_market_signal", name: "行情信号刷新", handler: "market_signal_refresh", schedule: "Every 2m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_execution_poll", name: "执行订单轮询", handler: "execution_poll", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_position_monitor", name: "持仓风险监控", handler: "position_monitor", schedule: "Every 2m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_accounting", name: "盈亏核算刷新", handler: "accounting_refresh", schedule: "Every 5m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_agent_cycle", name: "自主巡检决策", handler: "agent_cycle", schedule: "Every 15m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_reconcile", name: "账户对账", handler: "reconcile", schedule: "Every 10m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_strategy_research", name: "自适应策略研究", handler: "strategy_research", schedule: "Every 6h" }, saveDb);
ensureSystemTask(db, { id: "task_sys_paper_forward", name: "模拟盘前向验证", handler: "paper_forward", schedule: "Every 30m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_trade_reflection", name: "平仓自动复盘", handler: "trade_reflection", schedule: "Every 30m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_strategy_improvement", name: "策略改进闭环", handler: "strategy_improvement", schedule: "Every 6h" }, saveDb);
ensureSystemTask(db, { id: "task_sys_payment_verify", name: "TRC20 支付链上核验", handler: "payment_verify", schedule: "Every 2m" }, saveDb);

startScheduler(db, saveDb);
startRealtimeManager(db, saveDb);
startMarketStream(db); // 实时行情流（OKX 公有 WS）→ 内存更新 + SSE 推前端
refreshAccounting(db);

// 实时仓位/盈亏：每个价格 tick 立即重算浮盈亏与组合，并把「持仓+组合」实时推给前端；
// 同时节流地跑一次持仓管理（止盈止损/保本/跟踪，用实时价），作为交易所条件单之外的安全网。
let __lastPnlBroadcast = 0;
let __lastMonitorTick = 0;
let __monitorBusy = false;
setMarketTickHook((database, symbol, price) => {
  const positions = (database.positions || []).filter((p) => p.symbol === symbol);
  for (const p of positions) {
    const entry = Number(p.entry ?? p.entryPrice ?? p.avgPx);
    const size = Number(p.size ?? p.qty ?? p.pos);
    if (!Number.isFinite(entry) || !Number.isFinite(size)) continue;
    const short = p.direction === "空" || String(p.direction || p.side || p.posSide || "").toLowerCase().includes("short");
    p.mark = price;
    p.pnl = Number(((price - entry) * size * (short ? -1 : 1)).toFixed(2));
    p.unrealizedPnl = p.pnl;
    if (entry) p.roiPct = Number((((price - entry) / entry) * 100 * (short ? -1 : 1) * (Number(p.leverage) || 1)).toFixed(2));
  }
  const now = Date.now();
  // 组合浮盈亏最多每 1s 广播一次（tick 很密，避免过度渲染）。
  if (now - __lastPnlBroadcast > 1000) {
    __lastPnlBroadcast = now;
    try {
      refreshAccounting(database);
      broadcastRaw({
        type: "portfolio",
        portfolio: {
          unrealizedPnl: database.portfolio?.unrealizedPnl ?? null,
          todayPnl: database.portfolio?.todayPnl ?? null,
          todayPnlPct: database.portfolio?.todayPnlPct ?? null,
          totalEquityUsdt: database.portfolio?.totalEquityUsdt ?? null
        },
        positions: (database.positions || []).map((p) => ({ id: p.id, symbol: p.symbol, mark: p.mark, pnl: p.pnl, unrealizedPnl: p.unrealizedPnl, roiPct: p.roiPct }))
      });
    } catch { /* noop */ }
  }
  // 实时止盈止损安全网：最多每 3s 跑一次（用实时价），避免重入。
  if (!__monitorBusy && now - __lastMonitorTick > 3000 && (database.positions || []).some((p) => p.source === "execution_engine")) {
    __lastMonitorTick = now;
    __monitorBusy = true;
    Promise.resolve(monitorPositions(database)).catch(() => {}).finally(() => { __monitorBusy = false; });
  }
});

function persist(res, payload) {
  saveDb(db);
  res.json(payload);
}

function sanitizeUserRecord(user = {}) {
  const { password, passwordHash, passwordSalt, ...safe } = user;
  return safe;
}

function addMonthsIso(months = 0, fallbackDays = 0) {
  const date = new Date();
  if (months) date.setMonth(date.getMonth() + Number(months));
  if (fallbackDays) date.setDate(date.getDate() + Number(fallbackDays));
  return date.toISOString();
}

function publicBootstrap() {
  return {
    registrationEnabled: process.env.PUBLIC_REGISTRATION_ENABLED === "true",
    trc20Configured: Boolean(process.env.TRC20_USDT_RECEIVE_ADDRESS || db.runtimeConfig?.TRC20_USDT_RECEIVE_ADDRESS),
    subscriptionPlans: (db.subscriptionPlans || []).filter((item) => item.enabled !== false).map((plan) => ({
      id: plan.id,
      name: plan.name,
      interval: plan.interval,
      months: plan.months,
      priceUsdt: plan.priceUsdt,
      features: plan.features || []
    }))
  };
}

function activateSubscriptionFromPayment(payment) {
  const plan = (db.subscriptionPlans || []).find((item) => item.id === payment.planId);
  const months = Number(plan?.months || 1);
  db.subscriptions ||= [];
  const existing = db.subscriptions.find((item) => item.tenantId === payment.tenantId);
  const payload = {
    tenantId: payment.tenantId,
    userId: payment.userId,
    planId: payment.planId,
    status: "active",
    source: "trc20_usdt",
    paymentId: payment.id,
    startedAt: nowIso(),
    currentPeriodEnd: addMonthsIso(months)
  };
  if (existing) Object.assign(existing, payload, { updatedAt: nowIso() });
  else db.subscriptions.unshift({ id: id("sub"), ...payload });
  const tenant = (db.tenants || []).find((item) => item.id === payment.tenantId);
  if (tenant) Object.assign(tenant, { planId: payment.planId, status: "active", updatedAt: nowIso() });
}

// 真·链上验证：查 TronGrid 上收款地址的 USDT(TRC20) 转入，金额匹配的待支付单自动确认。
// 无 TRC20 地址则跳过；无 TRONGRID_API_KEY 也能查（有 key 更稳、限流更高）。
const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
async function verifyTrc20Payments(db) {
  const address = process.env.TRC20_USDT_RECEIVE_ADDRESS || db.runtimeConfig?.TRC20_USDT_RECEIVE_ADDRESS;
  const pending = (db.paymentRequests || []).filter((item) => item.status === "pending");
  if (!address) return { status: "skipped", reason: "no_receive_address" };
  if (!pending.length) return { status: "ok", checked: 0, confirmed: 0 };
  const apiKey = process.env.TRONGRID_API_KEY;
  const url = `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?only_to=true&limit=50&contract_address=${USDT_TRC20_CONTRACT}`;
  try {
    const response = await fetch(url, { headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : {} });
    if (!response.ok) return { status: "failed", error: `TronGrid HTTP ${response.status}` };
    const json = await response.json();
    const txs = (json.data || []).map((tx) => ({ txid: tx.transaction_id, value: Number(tx.value) / 1e6, from: tx.from, at: tx.block_timestamp }));
    const usedTx = new Set((db.paymentRequests || []).map((item) => item.txid).filter(Boolean));
    let confirmed = 0;
    for (const payment of pending) {
      const match = txs.find((tx) => !usedTx.has(tx.txid) && Math.abs(tx.value - Number(payment.amount || 0)) < 0.01);
      if (match) {
        payment.status = "confirmed";
        payment.txid = match.txid;
        payment.confirmedAt = nowIso();
        payment.verifiedOnChain = true;
        usedTx.add(match.txid);
        activateSubscriptionFromPayment(payment);
        appendAudit(db, `TRC20 链上确认订阅：${match.txid}`, payment.id, "PaymentVerifier");
        confirmed++;
      }
    }
    if (confirmed) saveDb(db);
    return { status: "ok", checked: txs.length, confirmed };
  } catch (error) {
    return { status: "failed", error: error.message };
  }
}

async function importAndMaybeParseKnowledge(payload = {}) {
  const source = await importKnowledgeReal(db, payload);
  if (payload.autoParse === false) return { message: "知识来源已导入，尚未解析", source };
  const parsed = await parseKnowledgeRealSource(db, source.id);
  return { message: parsed.message || "知识来源已导入并解析", source: parsed.source || source, parsed };
}

// 先把来源落库并立即响应，再在后台做可能长耗时（LLM 按书名蒸馏 / 抓取网页）的解析——
// 避免请求超时把已创建的来源“丢掉”，失败也会以 status/error 显式呈现在知识库。
async function handleKnowledgeImport(req, res) {
  try {
    const source = await importKnowledgeReal(db, req.body);
    if (req.body.autoParse === false) { persist(res, { message: "知识来源已导入，尚未解析", source }); return; }
    source.status = "processing";
    saveDb(db);
    res.json({ message: "知识来源已导入，正在后台蒸馏，稍后自动出现在知识库", source, parsed: { status: "processing" } });
    parseKnowledgeRealSource(db, source.id)
      .then(() => { saveDb(db); try { broadcastRaw({ type: "knowledge_updated", sourceId: source.id, status: source.status }); } catch { /* SSE 可选 */ } })
      .catch((err) => {
        source.status = "failed";
        source.error = err.message;
        appendAudit(db, `知识后台蒸馏失败：${err.message}`, source.id, "KnowledgePipeline", "warning");
        saveDb(db);
        try { broadcastRaw({ type: "knowledge_updated", sourceId: source.id, status: "failed" }); } catch { /* SSE 可选 */ }
      });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, liveTradingEnabled: db.system.liveTradingEnabled, updatedAt: db.meta.updatedAt, storage: getStorageInfo() });
});

app.get("/api/public/bootstrap", (_req, res) => {
  res.json(publicBootstrap());
});

app.get("/api/storage", (_req, res) => {
  res.json(getStorageInfo());
});

app.get("/api/system/readiness", (_req, res) => {
  res.json(buildReadinessReport(db));
});

app.post("/api/system/backup", requirePermission("admin:system"), async (_req, res) => {
  try {
    const result = await createSystemBackup(db);
    persist(res, result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/system/reset-operational-data", requirePermission("admin:system"), (req, res) => {
  resetOperationalData(db, { actor: req.user?.name || db.user.name, keepAudit: req.body.keepAudit !== false });
  persist(res, { message: "已清空工作数据，保留用户、密钥、配置、风控规则与订阅设置。", storage: getStorageInfo() });
});

app.get("/api/admin/users", requirePermission("admin:system"), (_req, res) => {
  res.json({
    tenants: db.tenants || [],
    users: (db.users || []).map(({ passwordHash, password, ...safe }) => safe),
    subscriptions: db.subscriptions || []
  });
});

app.post("/api/admin/users", requirePermission("admin:system"), (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const name = String(req.body.name || email.split("@")[0] || "新用户").trim();
  const password = String(req.body.password || "");
  const role = String(req.body.role || "交易用户").trim();
  const freeMonths = Number(req.body.freeMonths || 0);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "请输入有效邮箱" });
  if (password.length < 10) return res.status(400).json({ error: "初始密码至少 10 位" });
  db.users ||= [];
  if (db.users.some((item) => String(item.email || "").toLowerCase() === email)) return res.status(409).json({ error: "该邮箱已存在" });
  const createdAt = nowIso();
  const userId = id("user");
  const tenantId = id("tenant");
  const tenant = { id: tenantId, name: `${name} 的工作区`, ownerUserId: userId, planId: freeMonths > 0 ? "owner_free" : "trial", status: freeMonths > 0 ? "active" : "trial", createdAt };
  const user = { id: userId, tenantId, name, email, role, status: "active", passwordHash: hashPassword(password), createdAt };
  db.tenants ||= [];
  db.subscriptions ||= [];
  db.tenants.push(tenant);
  db.users.push(user);
  db.subscriptions.unshift({
    id: id("sub"),
    tenantId,
    userId,
    planId: freeMonths > 0 ? "owner_free" : "trial",
    status: freeMonths > 0 ? "active" : "trialing",
    source: freeMonths > 0 ? "owner_grant" : "admin_create",
    startedAt: createdAt,
    currentPeriodEnd: addMonthsIso(freeMonths || 0, freeMonths ? 0 : 7)
  });
  appendAudit(db, `Owner 创建用户：${email}`, user.id, req.user?.name || db.user.name);
  persist(res, { user: sanitizeUserRecord(user), tenant });
});

app.patch("/api/admin/users/:id", requirePermission("admin:system"), (req, res) => {
  const user = (db.users || []).find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const allowed = ["name", "role", "status", "isOwner"];
  for (const key of allowed) {
    if (req.body[key] !== undefined) user[key] = req.body[key];
  }
  user.updatedAt = nowIso();
  appendAudit(db, `更新用户：${user.email || user.id}`, user.id, req.user?.name || db.user.name);
  persist(res, { user: sanitizeUserRecord(user) });
});

// 用户自助修改密码（校验原密码）。Owner 密码由 ADMIN_PASSWORD 环境变量管理，不在此改。
app.post("/api/auth/change-password", (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: "未登录" });
  if (user.isOwner || !user.passwordHash) return res.status(400).json({ error: "Owner 密码通过 ADMIN_PASSWORD 环境变量管理，不在此修改" });
  const oldPassword = String(req.body?.oldPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  if (!verifyPassword(oldPassword, user.passwordHash)) return res.status(401).json({ error: "原密码不正确" });
  if (newPassword.length < 10) return res.status(400).json({ error: "新密码至少 10 位" });
  user.passwordHash = hashPassword(newPassword);
  user.mustChangePassword = false;
  user.updatedAt = nowIso();
  appendAudit(db, "用户自助修改密码", user.id, user.name || user.email);
  persist(res, { ok: true });
});

// Admin 重置某用户密码为临时密码（用户登录后应自行修改）。
app.post("/api/admin/users/:id/reset-password", requirePermission("admin:system"), (req, res) => {
  const user = (db.users || []).find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.isOwner) return res.status(400).json({ error: "Owner 密码由 ADMIN_PASSWORD 管理，无法在此重置" });
  const password = String(req.body?.password || "");
  if (password.length < 10) return res.status(400).json({ error: "临时密码至少 10 位" });
  user.passwordHash = hashPassword(password);
  user.mustChangePassword = true;
  user.updatedAt = nowIso();
  appendAudit(db, `重置用户密码：${user.email || user.id}`, user.id, req.user?.name || db.user.name, "warning");
  persist(res, { ok: true });
});

app.post("/api/admin/users/:id/grant-free", requirePermission("admin:system"), (req, res) => {
  const user = (db.users || []).find((item) => item.id === req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const months = Math.max(1, Number(req.body.months || 1));
  const planId = String(req.body.planId || "owner_free");
  db.subscriptions ||= [];
  const existing = db.subscriptions.find((item) => item.tenantId === user.tenantId);
  const subscription = {
    tenantId: user.tenantId,
    userId: user.id,
    planId,
    status: "active",
    source: "owner_grant",
    grantedBy: req.user?.id || db.user.id,
    startedAt: nowIso(),
    currentPeriodEnd: addMonthsIso(months)
  };
  if (existing) Object.assign(existing, subscription, { updatedAt: nowIso() });
  else db.subscriptions.unshift({ id: id("sub"), ...subscription });
  const tenant = (db.tenants || []).find((item) => item.id === user.tenantId);
  if (tenant) Object.assign(tenant, { status: "active", planId, updatedAt: nowIso() });
  appendAudit(db, `Owner 赠送免费授权：${user.email || user.name} ${months} 个月`, user.id, req.user?.name || db.user.name);
  persist(res, { message: `已赠送 ${months} 个月免费授权`, user: sanitizeUserRecord(user), subscription: existing || db.subscriptions[0] });
});

app.post("/api/admin/password", requirePermission("admin:security"), (req, res) => {
  const nextPassword = String(req.body.password || "");
  if (nextPassword.length < 12) return res.status(400).json({ error: "管理员密码至少 12 位" });
  setConfig(db, { ADMIN_PASSWORD: nextPassword });
  appendAudit(db, "修改管理员登录密码", "admin_password", req.user?.name || db.user.name, "warning");
  invalidateSessions(db);
  saveDb(db);
  res.json({ message: "管理员密码已更新，已退出当前登录，请用新密码重新登录。", logoutRequired: true, status: getConfigStatus(db) });
});

app.get("/api/admin/subscription-plans", requirePermission("admin:system"), (_req, res) => {
  res.json(db.subscriptionPlans || []);
});

app.post("/api/admin/subscription-plans", requirePermission("admin:system"), (req, res) => {
  const plan = {
    id: req.body.id || id("plan"),
    name: req.body.name || "新套餐",
    interval: req.body.interval || "month",
    months: Number(req.body.months || 1),
    priceUsdt: Number(req.body.priceUsdt || 0),
    enabled: req.body.enabled !== false,
    features: Array.isArray(req.body.features) ? req.body.features : [],
    createdAt: nowIso()
  };
  db.subscriptionPlans ||= [];
  db.subscriptionPlans.unshift(plan);
  appendAudit(db, `创建订阅套餐：${plan.name}`, plan.id, req.user?.name || db.user.name);
  persist(res, plan);
});

app.patch("/api/admin/subscription-plans/:id", requirePermission("admin:system"), (req, res) => {
  const plan = (db.subscriptionPlans || []).find((item) => item.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  for (const key of ["name", "interval", "months", "priceUsdt", "enabled", "features"]) {
    if (req.body[key] !== undefined) plan[key] = key === "months" || key === "priceUsdt" ? Number(req.body[key]) : req.body[key];
  }
  plan.updatedAt = nowIso();
  appendAudit(db, `更新订阅套餐：${plan.name}`, plan.id, req.user?.name || db.user.name);
  persist(res, plan);
});

app.post("/api/payments/trc20/request", requirePermission("write:mandate"), (req, res) => {
  const plan = (db.subscriptionPlans || []).find((item) => item.id === req.body.planId && item.enabled !== false);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  const address = process.env.TRC20_USDT_RECEIVE_ADDRESS || db.runtimeConfig?.TRC20_USDT_RECEIVE_ADDRESS;
  if (!address) return res.status(503).json({ error: "TRC20_USDT_RECEIVE_ADDRESS is not configured" });
  const payment = {
    id: id("pay"),
    tenantId: req.tenantId || req.user?.tenantId || "tenant_owner",
    userId: req.user?.id,
    planId: plan.id,
    network: "TRON",
    asset: "USDT",
    amount: Number(plan.priceUsdt || 0),
    address,
    status: "pending",
    expiresAt: addMonthsIso(0, 30),
    createdAt: nowIso()
  };
  db.paymentRequests ||= [];
  db.paymentRequests.unshift(payment);
  appendAudit(db, `创建 TRC20 USDT 支付请求：${plan.name}`, payment.id, req.user?.name || db.user.name);
  persist(res, payment);
});

app.post("/api/payments/trc20/verify", requirePermission("admin:system"), async (_req, res) => {
  const result = await verifyTrc20Payments(db);
  persist(res, result);
});

app.post("/api/payments/trc20/webhook", (req, res) => {
  const payload = req.body || {};
  const txid = payload.txid || payload.transactionId || payload.hash;
  const paymentId = payload.paymentId || payload.orderId;
  const event = { id: id("payhook"), provider: payload.provider || "trc20", txid, paymentId, payload, createdAt: nowIso() };
  db.paymentWebhooks ||= [];
  db.paymentWebhooks.unshift(event);
  // 安全：只有配置了 PAYMENT_WEBHOOK_SECRET 且签名匹配，回调才允许开通订阅；
  // 否则只记录回调、不自动开通（真正的开通走 TronGrid 链上核验 payment_verify）。
  const secret = process.env.PAYMENT_WEBHOOK_SECRET;
  const signatureOk = secret && (req.headers["x-webhook-secret"] === secret || payload.secret === secret);
  const payment = paymentId ? (db.paymentRequests || []).find((item) => item.id === paymentId) : null;
  if (payment && signatureOk && (payload.status === "confirmed" || payload.confirmed === true)) {
    payment.status = "confirmed";
    payment.txid = txid;
    payment.confirmedAt = nowIso();
    payment.verifiedBy = "webhook_signed";
    activateSubscriptionFromPayment(payment);
  }
  appendAudit(db, `收到 TRC20 支付回调：${txid || paymentId || "unknown"}${signatureOk ? "（已验签开通）" : "（未验签，仅记录）"}`, event.id, "PaymentWebhook", signatureOk ? "info" : "warning");
  saveDb(db);
  res.json({ ok: true, activated: Boolean(payment && signatureOk) });
});

app.post("/api/system/autonomy", requirePermission("write:mandate"), (req, res) => {
  db.system.autonomyEnabled = req.body.enabled !== false;
  if (db.system.autonomyEnabled && db.system.killSwitch) db.system.killSwitch = false;
  db.system.riskStatus = db.system.autonomyEnabled ? "正常" : "人工暂停";
  db.system.latestAction = db.system.autonomyEnabled ? "恢复 AI 交易员观察与计划" : "暂停 AI 交易员自动推进";
  db.system.updatedAt = nowIso();
  appendAudit(db, db.system.autonomyEnabled ? "恢复自动交易推进" : "暂停自动交易推进", "system.autonomy", db.user.name, db.system.autonomyEnabled ? "info" : "warning");
  appendTrace(db, "system", db.system.latestAction, db.system.autonomyEnabled ? "ok" : "paused");
  persist(res, db.system);
});

app.get("/api/overview", (_req, res) => {
  // 实时计算 API 健康度（原来是固定种子值 "待配置"，配置后也不变，属显示 bug）。
  {
    const cfgStatus = getConfigStatus(db);
    const configured = (db.exchangeAccounts || []).some((a) => a.readEnabled) || cfgStatus?.exchange?.okx?.hasKey || cfgStatus?.exchange?.binance?.hasKey;
    const criticalOpen = (db.riskIncidents || []).some((i) => i.status === "open" && (i.severity === "critical" || i.severity === "high"));
    db.system.apiHealth = db.system?.killSwitch ? "熔断停机" : criticalOpen ? "异常" : configured ? "正常" : "待配置";
  }
  res.json({
    user: db.user,
    users: (db.users || []).map(sanitizeUserRecord),
    tenants: db.tenants || [],
    subscriptionPlans: db.subscriptionPlans || [],
    subscriptions: db.subscriptions || [],
    paymentRequests: db.paymentRequests?.slice(0, 20) || [],
    system: db.system,
    publicRegistrationEnabled: process.env.PUBLIC_REGISTRATION_ENABLED === "true",
    agentStatus: getAgentStatus(db),
    agentProfiles: db.agentProfiles || [],
    portfolio: db.portfolio,
    markets: db.markets,
    watchlist: (db.watchlist && db.watchlist.length) ? db.watchlist : ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    activeMarket: db.markets.find((market) => market.status === "synced" || market.price) || db.markets[0],
    positions: db.positions,
    mandates: db.mandates,
    tradePlans: db.tradePlans,
    events: db.events,
    tasks: db.tasks,
    knowledge: db.knowledge,
    skills: db.skills,
    tools: db.tools,
    mcpServers: db.mcpServers,
    traces: db.traces.slice(0, 10),
    auditLogs: db.auditLogs.slice(0, 20),
    analysisBundles: db.analysisBundles,
    reviews: db.reviews
    ,
    exchangeAccounts: db.exchangeAccounts,
    apiKeyMetadata: db.apiKeyMetadata,
    accountSnapshots: db.accountSnapshots?.slice(0, 10) || [],
    orders: db.orders,
    fills: db.fills,
    riskRules: db.riskRules,
    riskChecks: db.riskChecks,
    riskIncidents: db.riskIncidents,
    realtimeConnections: db.realtimeConnections,
    marketRegime: db.marketRegime || null,
    realtimeStarted: realtimeStatus(db).started,
    marketStream: marketStreamStatus(),
    pendingActions: (db.pendingActions || []).filter((item) => item.status === "awaiting_confirmation").slice(0, 10),
    reconciliationReports: db.reconciliationReports?.slice(0, 10) || [],
    jobRuns: db.jobRuns.slice(0, 20),
    notifications: db.notifications,
    alerts: db.alerts?.slice(0, 20) || [],
    drillRuns: db.drillRuns?.slice(0, 10) || [],
    grayReleasePolicies: db.grayReleasePolicies || [],
    llmRuns: db.llmRuns?.slice(0, 10) || [],
    tradeIntents: db.tradeIntents?.slice(0, 20) || [],
    executionOrders: db.executionOrders?.slice(0, 20) || [],
    exchangeOrders: db.exchangeOrders?.slice(0, 20) || [],
    reviewReports: db.reviewReports?.slice(0, 20) || [],
    toolExecutions: db.toolExecutions?.slice(0, 20) || [],
    eventSources: db.eventSources || [],
    skillRuns: db.skillRuns?.slice(0, 10) || [],
    agentStateFiles: db.agentStateFiles,
    memoryItems: db.memoryItems,
    agentRuns: db.agentRuns,
    performance: performanceReport(db),
    backtests: db.backtests?.slice(0, 10) || [],
    strategyProfiles: db.strategyProfiles || [],
    paperReport: buildPaperReport(db),
    portfolioRisk: buildPortfolioRisk(db, db.mandates.find((m) => ["active", "running"].includes(m.status))),
    larkConfigured: larkStatus().configured,
    telegramConfigured: telegramStatus().configured,
    mcpStatus: mcpStatus(db),
    embeddingStatus: embeddingStatus(db),
    reviewAnalytics: buildReviewAnalytics(db),
    runtimeConfig: db.runtimeConfig || {},
    config: getConfigStatus(db),
    readiness: buildReadinessReport(db)
  });
});

app.get("/api/market/regime", async (_req, res) => {
  try {
    const symbol = db.mandates?.find((m) => ["active", "running"].includes(m.status))?.allowedSymbols?.[0] || "BTC/USDT";
    const regime = await fetchMarketRegime(symbol);
    const prev = db.marketRegime || {};
    db.marketRegime = {
      ...regime,
      global: regime.global || prev.global || null,
      smartMoney: regime.smartMoney || prev.smartMoney || null,
      updatedAt: nowIso()
    };
    persist(res, db.marketRegime);
  } catch (error) {
    res.status(500).json({ error: `全局大盘/聪明钱同步失败：${error.message}` });
  }
});

app.get("/api/market/instruments", async (_req, res) => {
  try {
    const instruments = await fetchPerpetualInstruments();
    res.json({ instruments, count: instruments.length });
  } catch (error) {
    res.status(500).json({ error: `合约清单获取失败：${error.message}`, instruments: [] });
  }
});

// 悬浮 AI 助手：把系统里的账户/自主状态/今日活动/待办/风险汇成一段可读总结。
app.post("/api/assistant/summarize", async (req, res) => {
  refreshAccounting(db);
  const pf = db.portfolio || {};
  const positions = db.positions || [];
  const sys = db.system || {};
  const awaitingPlans = (db.tradePlans || []).filter((p) => ["awaiting_approval", "risk_checked", "draft"].includes(p.status));
  const pendingActions = (db.pendingActions || []).filter((a) => !a.status || a.status === "pending");
  const openIncidents = (db.riskIncidents || []).filter((i) => i.status === "open");
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const runsToday = (db.agentRuns || []).filter((r) => new Date(r.createdAt) >= dayStart).length;
  const auditsToday = (db.auditLogs || []).filter((a) => new Date(a.createdAt) >= dayStart).length;
  const lastSnap = (db.accountSnapshots || [])[0];
  const digest = {
    account: {
      totalEquityUsdt: pf.totalEquityUsdt ?? null,
      todayPnl: pf.todayPnl ?? null,
      unrealizedPnl: pf.unrealizedPnl ?? null,
      positions: positions.length,
      lastSyncAt: lastSnap?.createdAt || null
    },
    autonomy: { enabled: sys.autonomyEnabled === true, killSwitch: sys.killSwitch === true, liveTrading: sys.liveTradingEnabled === true },
    todayActivity: { agentRuns: runsToday, auditEvents: auditsToday },
    todos: { plansAwaitingApproval: awaitingPlans.length, pendingActions: pendingActions.length },
    risk: { openIncidents: openIncidents.length, topIncident: openIncidents[0]?.title || null }
  };
  const facts = [
    `账户：总资产 ${digest.account.totalEquityUsdt ?? "未同步"} USDT，今日盈亏 ${digest.account.todayPnl ?? "未同步"} USDT，未实现 ${digest.account.unrealizedPnl ?? "未同步"} USDT，持仓 ${digest.account.positions} 个，最后同步 ${digest.account.lastSyncAt || "从未"}`,
    `自主：${digest.autonomy.killSwitch ? "已熔断" : digest.autonomy.enabled ? "自主运行中" : "已暂停"}，实盘写入 ${digest.autonomy.liveTrading ? "开启" : "关闭"}`,
    `今日活动：自主巡检 ${digest.todayActivity.agentRuns} 次，审计事件 ${digest.todayActivity.auditEvents} 条`,
    `待办：待批准计划 ${digest.todos.plansAwaitingApproval} 个，待确认操作 ${digest.todos.pendingActions} 个`,
    `风险：未处理告警 ${digest.risk.openIncidents} 条${digest.risk.topIncident ? `（最新：${digest.risk.topIncident}）` : ""}`
  ].join("\n");
  const system = "你是用户的交易系统助手。用中文把下面的系统状态总结成 3-5 条简洁要点（账户、自主状态、今日活动、待办、风险），并在最后给一句最该关注的行动建议。只基于给定事实，不要编造任何数字，不确定的写『未同步』。";
  let summary = null;
  try { summary = await llmComplete(facts, system); } catch { summary = null; }
  res.json({ summary: summary || facts, digest, llm: Boolean(summary) });
});

// 关注列表：独立于授权白名单的自选币对（从 OKX 永续合约里增删）。
function normalizeSymbol(raw) {
  const s = String(raw || "").trim().toUpperCase().replace(/-SWAP$/i, "").replace(/-/g, "/");
  if (!/^[A-Z0-9]+\/[A-Z0-9]+$/.test(s)) return null;
  return s;
}
app.post("/api/watchlist", requirePermission("write:realtime"), (req, res) => {
  const symbol = normalizeSymbol(req.body.symbol);
  if (!symbol) return res.status(400).json({ error: "无效的交易对" });
  db.watchlist = (db.watchlist && db.watchlist.length) ? db.watchlist : ["BTC/USDT", "ETH/USDT", "SOL/USDT"];
  if (!db.watchlist.includes(symbol)) db.watchlist = [...db.watchlist, symbol];
  saveDb(db);
  res.json({ ok: true, watchlist: db.watchlist });
});
app.delete("/api/watchlist/:symbol", requirePermission("write:realtime"), (req, res) => {
  const symbol = normalizeSymbol(decodeURIComponent(req.params.symbol));
  db.watchlist = ((db.watchlist && db.watchlist.length) ? db.watchlist : ["BTC/USDT", "ETH/USDT", "SOL/USDT"]).filter((s) => s !== symbol);
  saveDb(db);
  res.json({ ok: true, watchlist: db.watchlist });
});

// 公有 K 线（给自绘图表用真实 OKX 数据）。公开数据，走鉴权白名单。
app.get("/api/market/klines", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "BTC/USDT").toUpperCase();
    const tf = String(req.query.tf || "1h");
    const limit = Math.min(Number(req.query.limit || 200), 500);
    const candles = await getHistoricalKlines(symbol, tf, limit);
    res.json({ symbol, tf, candles: candles || [] });
  } catch (error) {
    res.status(500).json({ error: `K线获取失败：${error.message}`, candles: [] });
  }
});

app.get("/api/market/token-profile", async (req, res) => {
  try {
    const profile = await fetchTokenProfile(req.query.symbol || "BTC/USDT", req.query.timeframe || "1h");
    res.json(profile);
  } catch (error) {
    res.status(500).json({ error: `币种画像失败：${error.message}`, ok: false });
  }
});

// 实时行情 SSE：把 OKX WS 逐笔更新推给前端（公有行情，无需鉴权）。
app.get("/api/stream", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 3000\n\n");
  const send = (update) => { try { res.write(`data: ${JSON.stringify(update)}\n\n`); } catch { /* noop */ } };
  addStreamListener(send);
  const keepAlive = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* noop */ } }, 25000);
  req.on("close", () => { clearInterval(keepAlive); removeStreamListener(send); });
});

app.get("/api/markets", (_req, res) => res.json(db.markets));
app.get("/api/positions", (_req, res) => res.json(db.positions));
app.get("/api/orders", (_req, res) => res.json(db.orders));
app.get("/api/fills", (_req, res) => res.json(db.fills));
app.get("/api/mandates", (_req, res) => res.json(db.mandates));

app.post("/api/mandates/parse", requirePermission("write:mandate"), (req, res) => {
  res.json(parseMandateCommand(db, req.body.command || req.body.text || ""));
});

app.post("/api/mandates", requirePermission("write:mandate"), (req, res) => {
  const mandate = {
    id: id("mandate"),
    status: "active",
    createdAt: nowIso(),
    allowedActions: ["open", "cancel", "amend", "close", "move_stop", "take_profit"],
    ...req.body
  };
  db.mandates.unshift(mandate);
  appendAudit(db, "创建自主交易授权", mandate.id, db.user.name);
  appendTrace(db, "mandate", `创建授权 ${mandate.name || mandate.id}`);
  persist(res, mandate);
});

app.get("/api/mandates/:id", (req, res) => {
  const mandate = db.mandates.find((item) => item.id === req.params.id);
  if (!mandate) return res.status(404).json({ error: "Mandate not found" });
  res.json(mandate);
});

app.patch("/api/mandates/:id", requirePermission("write:mandate"), (req, res) => {
  const mandate = db.mandates.find((item) => item.id === req.params.id);
  if (!mandate) return res.status(404).json({ error: "Mandate not found" });
  Object.assign(mandate, req.body, { updatedAt: nowIso() });
  appendAudit(db, `更新授权状态：${req.body.status || "updated"}`, mandate.id, db.user.name);
  persist(res, mandate);
});

app.post("/api/mandates/:id/activate", requirePermission("write:mandate"), (req, res) => {
  const mandate = activateMandate(db, req.params.id);
  if (!mandate) return res.status(404).json({ error: "Mandate not found" });
  persist(res, mandate);
});

app.post("/api/mandates/:id/pause", requirePermission("write:mandate"), (req, res) => {
  const mandate = db.mandates.find((item) => item.id === req.params.id);
  if (!mandate) return res.status(404).json({ error: "Mandate not found" });
  mandate.status = "paused";
  mandate.pausedAt = nowIso();
  appendAudit(db, "暂停授权委托", mandate.id, db.user.name, "warning");
  persist(res, mandate);
});

app.post("/api/mandates/:id/revoke", requirePermission("write:mandate"), (req, res) => {
  const mandate = db.mandates.find((item) => item.id === req.params.id);
  if (!mandate) return res.status(404).json({ error: "Mandate not found" });
  mandate.status = "revoked";
  mandate.revokedAt = nowIso();
  appendAudit(db, "撤销授权委托", mandate.id, db.user.name, "warning");
  persist(res, mandate);
});

app.get("/api/events", (_req, res) => res.json(db.events));

// 热点情报流：按影响度+热度+时效+与持仓/授权标的相关性排序的事件专题
app.get("/api/events/intel", (_req, res) => {
  const watchSymbols = [
    ...(db.positions || []).map((p) => p.symbol),
    ...(db.mandates || []).flatMap((m) => m.allowedSymbols || []),
    db.activeMarket?.symbol
  ].filter(Boolean);
  res.json(rankEvents(db, { watchSymbols }));
});

app.post("/api/events", requirePermission("write:event"), (req, res) => {
  const event = {
    id: id("event"),
    status: "待确认",
    confidence: 60,
    impact: 50,
    progress: [],
    ...req.body,
    createdAt: nowIso()
  };
  db.events.unshift(event);
  appendAudit(db, "创建事件卡", event.id, "事件分析员");
  appendTrace(db, "event", `事件建档：${event.title}`);
  persist(res, event);
});

app.patch("/api/events/:id", requirePermission("write:event"), (req, res) => {
  const event = db.events.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  Object.assign(event, req.body, { latestUpdateAt: nowIso() });
  appendAudit(db, "更新事件进度", event.id, "事件分析员");
  persist(res, event);
});

app.delete("/api/events/:id", requirePermission("write:event"), (req, res) => {
  const exists = (db.events || []).some((item) => item.id === req.params.id);
  if (!exists) return res.status(404).json({ error: "Event not found" });
  db.events = (db.events || []).filter((item) => item.id !== req.params.id);
  appendAudit(db, "删除情报事件专题", req.params.id, req.user?.name || "Owner");
  persist(res, { ok: true });
});

app.post("/api/events/:id/progress", requirePermission("write:event"), (req, res) => {
  const event = db.events.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  event.progress ||= [];
  const item = req.body.text || req.body.progress || "追加事件进度";
  event.progress.push(item);
  event.latestUpdateAt = nowIso();
  if (req.body.status) event.status = req.body.status;
  appendAudit(db, "追加事件进度", event.id, "事件分析员");
  appendTrace(db, "event_progress", `${event.title}: ${item}`);
  persist(res, event);
});

app.post("/api/events/:id/review", requirePermission("write:review"), (req, res) => {
  const event = db.events.find((item) => item.id === req.params.id);
  if (!event) return res.status(404).json({ error: "Event not found" });
  const review = {
    id: id("event_review"),
    eventId: event.id,
    title: req.body.title || `${event.title} 事件复盘`,
    summary: req.body.summary || "事件影响已记录，等待人工补充验证结论。",
    tradingImpact: req.body.tradingImpact || event.action,
    createdAt: nowIso()
  };
  db.reviews.unshift(review);
  appendAudit(db, "创建事件复盘", review.id, "复盘员");
  persist(res, review);
});

app.get("/api/tasks", (_req, res) => res.json(db.tasks));
app.get("/api/job-runs", (_req, res) => res.json(db.jobRuns));
app.get("/api/scheduler/status", (_req, res) => res.json(schedulerStatus(db)));
app.post("/api/scheduler/recover", requirePermission("write:task"), (_req, res) => {
  const status = startScheduler(db, saveDb);
  persist(res, status);
});

app.post("/api/tasks", requirePermission("write:task"), (req, res) => {
  const task = {
    id: id("task"),
    type: "Every",
    enabled: true,
    status: "等待中",
    allowlist: [],
    ...req.body,
    createdAt: nowIso()
  };
  // 带自然语言 mission 的任务 → 走通用 Agent 情报任务处理器
  if (task.mission && !task.handler) { task.handler = "agent_mission"; task.role = task.role || "情报"; }
  db.tasks.unshift(task);
  appendAudit(db, "创建定时任务", task.id, db.user.name);
  scheduleTask(db, task, saveDb);
  persist(res, task);
});

app.patch("/api/tasks/:id", requirePermission("write:task"), (req, res) => {
  const task = db.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  Object.assign(task, req.body, { updatedAt: nowIso() });
  appendAudit(db, "更新定时任务", task.id, db.user.name);
  if (task.enabled) scheduleTask(db, task, saveDb);
  persist(res, task);
});

app.delete("/api/tasks/:id", requirePermission("write:task"), (req, res) => {
  const index = db.tasks.findIndex((item) => item.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Task not found" });
  const [task] = db.tasks.splice(index, 1);
  db.jobRuns = (db.jobRuns || []).filter((run) => run.taskId !== task.id);
  appendAudit(db, "删除定时任务", task.id, db.user.name, "warning");
  persist(res, { message: `${task.name || task.id} 已删除`, task });
});

app.post("/api/tasks/:id/pause", requirePermission("write:task"), (req, res) => {
  const task = db.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  task.enabled = false;
  task.status = "已暂停";
  task.pauseReason = req.body.reason || "manual_pause";
  task.updatedAt = nowIso();
  appendAudit(db, "暂停定时任务", task.id, db.user.name);
  persist(res, task);
});

app.post("/api/tasks/:id/resume", requirePermission("write:task"), (req, res) => {
  const task = db.tasks.find((item) => item.id === req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  task.enabled = true;
  task.status = "运行中";
  task.updatedAt = nowIso();
  appendAudit(db, "恢复定时任务", task.id, db.user.name);
  scheduleTask(db, task, saveDb);
  persist(res, task);
});

app.post("/api/tasks/:id/run", requirePermission("write:task"), async (req, res) => {
  const result = await runTask(db, req.params.id, saveDb, "manual");
  if (result.status === "missing_task") return res.status(404).json({ error: "Task not found" });
  res.json(result);
});

app.post("/api/knowledge/import", requirePermission("write:knowledge"), handleKnowledgeImport);

app.post("/api/knowledge/import-real", requirePermission("write:knowledge"), handleKnowledgeImport);

app.post("/api/knowledge/github-import", requirePermission("write:knowledge"), async (req, res) => {
  try {
    const result = await importGithubKnowledge(db, req.body.repoUrl, req.body.subPath || "");
    persist(res, { ...result, message: result.message || `已导入 GitHub 知识：${req.body.repoUrl}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/knowledge/sources/:id/parse", requirePermission("write:knowledge"), (req, res) => {
  const source = db.knowledge.sources.find((item) => item.id === req.params.id);
  if (!source) return res.status(404).json({ error: "Knowledge source not found" });
  source.status = "已解析";
  source.parsedAt = nowIso();
  const node = { id: id("node"), sourceId: source.id, parentId: null, nodeType: "document", title: source.title, orderIndex: 1, pageRange: "N/A" };
  const chunk = { id: id("chunk"), sourceId: source.id, nodeId: node.id, citationLocator: "导入文本", qualityScore: source.trustScore || 70, text: req.body.text || `${source.title} 的结构化摘要。` };
  db.knowledge.documentNodes.unshift(node);
  db.knowledge.chunks.unshift(chunk);
  appendAudit(db, "解析知识来源", source.id, "Parser");
  appendTrace(db, "knowledge_parse", `解析 ${source.title}`);
  persist(res, { source, node, chunk });
});

app.post("/api/knowledge/sources/:id/parse-real", requirePermission("write:knowledge"), async (req, res) => {
  try {
    const result = await parseKnowledgeRealSource(db, req.params.id);
    persist(res, result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/knowledge/sources/:id", requirePermission("write:knowledge"), (req, res) => {
  const source = db.knowledge.sources.find((item) => item.id === req.params.id);
  if (!source) return res.status(404).json({ error: "Knowledge source not found" });
  const sid = source.id;
  db.knowledge.sources = db.knowledge.sources.filter((item) => item.id !== sid);
  db.knowledge.documentNodes = (db.knowledge.documentNodes || []).filter((node) => node.sourceId !== sid);
  db.knowledge.chunks = (db.knowledge.chunks || []).filter((chunk) => chunk.sourceId !== sid);
  db.knowledge.conceptCards = (db.knowledge.conceptCards || []).filter((concept) => !concept.sourceRefs?.includes(sid));
  db.knowledge.ruleProposals = (db.knowledge.ruleProposals || []).filter((rule) => !rule.sourceRefs?.includes(sid));
  db.knowledge.theoryFrameworks = (db.knowledge.theoryFrameworks || []).filter((fw) => !fw.sourceRefs?.includes(sid));
  appendAudit(db, "删除知识来源", sid, "Curator");
  appendTrace(db, "knowledge_delete", `删除知识来源 ${source.title}`);
  persist(res, { removed: sid });
});

app.post("/api/knowledge/rag-query", async (req, res) => {
  const result = await ragQuery(db, req.body.query || req.body.question || "", req.body);
  persist(res, result);
});

app.get("/api/knowledge/embedding-status", (_req, res) => res.json(embeddingStatus(db)));
app.post("/api/knowledge/reembed", requirePermission("write:knowledge"), async (_req, res) => {
  try {
    const result = await reembedAllChunks(db);
    persist(res, { ...result, embeddingStatus: embeddingStatus(db) });
  } catch (error) {
    res.status(500).json({ error: `语义向量化失败：${error.message}` });
  }
});

// B 路：回测一条书本策略假设（用最接近的内置策略近似验证其方向/周期是否有历史边际）。
// 硬闸：只有回测通过（正期望 + 足够样本 + 盈亏比>1）才把 executable 置 true。
app.post("/api/knowledge/hypotheses/:id/backtest", requirePermission("write:knowledge"), async (req, res) => {
  const hypo = (db.knowledge?.strategyHypotheses || []).find((item) => item.id === req.params.id);
  if (!hypo) return res.status(404).json({ error: "策略假设不存在" });
  const kindMap = { price_action: "trend", trend: "trend", breakout: "breakout", mean_reversion: "meanrev", intraday_setup: "trend", momentum: "macd", other: "trend" };
  let strat = kindMap[hypo.kind] || "trend";
  if (hypo.direction === "short" && strat === "trend") strat = "death_cross";
  const symbol = /\//.test(hypo.symbolScope) ? hypo.symbolScope.split(/[，,、\s/]+/).filter(Boolean).slice(0, 1).map((s) => (s.includes("/") ? s : `${s}/USDT`))[0] || "BTC/USDT" : "BTC/USDT";
  const symbolFixed = symbol.includes("/") ? symbol : `${symbol}/USDT`;
  const tfMap = { "1m": "1m", "5m": "5m", "15m": "15m", "1H": "1h", "4H": "4h", "1D": "1d" };
  const result = await runBacktest(db, { symbol: symbolFixed, timeframe: tfMap[hypo.timeframe] || "1h", strategy: strat });
  if (result.status !== "ok") {
    hypo.backtest = { status: result.status, at: nowIso() };
    hypo.status = "回测失败";
    return persist(res, { ok: false, error: `回测失败：${result.status}`, hypothesis: hypo });
  }
  const passed = result.expectancyR > 0 && result.trades >= 20 && (result.profitFactor == null || result.profitFactor > 1);
  hypo.backtest = { at: nowIso(), approxStrategy: strat, symbol: symbolFixed, timeframe: result.timeframe, trades: result.trades, winRatePct: result.winRatePct, expectancyR: result.expectancyR, profitFactor: result.profitFactor, netReturnPct: result.netReturnPct, maxDrawdownPct: result.maxDrawdownPct, approx: true };
  hypo.status = passed ? "已验证" : "未通过";
  hypo.executable = passed;
  appendAudit(db, `策略假设回测「${hypo.name}」：${passed ? "通过" : "未通过"}（期望 ${result.expectancyR}R · ${result.trades} 笔 · 胜率 ${result.winRatePct}%）`, hypo.id, "KnowledgeBacktest", passed ? "ok" : "warning");
  persist(res, { ok: true, passed, result, hypothesis: hypo });
});

app.post("/api/knowledge/cards/concept", requirePermission("write:knowledge"), (req, res) => {
  const card = {
    id: id("concept"),
    name: req.body.name || "新概念",
    domain: req.body.domain || "综合",
    indicators: req.body.indicators || [],
    tradingMeaning: req.body.tradingMeaning || "待补充交易含义。",
    sourceRefs: req.body.sourceRefs || [],
    createdAt: nowIso()
  };
  db.knowledge.conceptCards.unshift(card);
  appendAudit(db, "创建概念卡", card.id, "AI 研究员");
  persist(res, card);
});

app.post("/api/knowledge/frameworks", requirePermission("write:knowledge"), (req, res) => {
  const framework = { id: id("fw"), name: req.body.name || "新理论框架", domain: req.body.domain || "综合", inputs: req.body.inputs || [], outputs: req.body.outputs || [], failureModes: req.body.failureModes || [], createdAt: nowIso() };
  db.knowledge.theoryFrameworks.unshift(framework);
  appendAudit(db, "创建理论框架", framework.id, "AI 研究员");
  persist(res, framework);
});

app.post("/api/knowledge/rules/proposals", requirePermission("write:knowledge"), (req, res) => {
  const rule = { id: id("rule"), name: req.body.name || "新交易规则草案", level: req.body.level || "L2", status: "待审批", action: req.body.action || "notify", sourceRefs: req.body.sourceRefs || [], createdAt: nowIso() };
  db.knowledge.ruleProposals.unshift(rule);
  appendAudit(db, "提交知识规则草案", rule.id, "Rule Compiler");
  persist(res, rule);
});

app.post("/api/knowledge/rules/:id/approve", requirePermission("write:risk"), (req, res) => {
  const rule = db.knowledge.ruleProposals.find((item) => item.id === req.params.id);
  if (!rule) return res.status(404).json({ error: "Rule not found" });
  rule.status = req.body.approved === false ? "已拒绝" : "已批准";
  rule.reviewedAt = nowIso();
  rule.reviewedBy = db.user.name;
  if (rule.status === "已批准") {
    db.riskRules.unshift({ id: `risk_from_${rule.id}`, name: rule.name, scope: "knowledge", level: rule.level, enabled: true, action: rule.action, description: `来自专家知识库规则 ${rule.id}` });
  }
  appendAudit(db, `${rule.status}知识规则`, rule.id, db.user.name);
  persist(res, rule);
});

app.post("/api/knowledge/runtime-query", requirePermission("write:knowledge"), (req, res) => {
  const bundle = runExpertAnalysis(db, req.body);
  appendAudit(db, "生成运行时专家分析", bundle.id, "专家知识库");
  appendTrace(db, "analysis_bundle", `知识召回：${bundle.question}`);
  persist(res, bundle);
});

app.get("/api/agent/state-files", (_req, res) => res.json(db.agentStateFiles));
app.patch("/api/agent/state-files/:name", requirePermission("admin:system"), (req, res) => {
  try {
    const file = updateStateFile(db, req.params.name, req.body.content || "");
    persist(res, file);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/agent/status", (_req, res) => {
  res.json(getAgentStatus(db));
});

app.get("/api/agent/profiles", (_req, res) => {
  res.json((db.agentProfiles || []).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0)));
});

app.patch("/api/agent/profiles/:id", requirePermission("write:knowledge"), (req, res) => {
  const profile = (db.agentProfiles || []).find((item) => item.id === req.params.id);
  if (!profile) return res.status(404).json({ error: "Agent profile not found" });
  const allowed = ["name", "role", "enabled", "declaration", "personality", "mission", "boundaries", "tools", "outputSchema", "memoryPolicy"];
  for (const key of allowed) {
    if (req.body[key] !== undefined) profile[key] = req.body[key];
  }
  profile.updatedAt = nowIso();
  appendAudit(db, `更新 Agent Profile：${profile.name}`, profile.id, req.user?.name || db.user.name);
  persist(res, profile);
});

function chatSessionsSorted() {
  return (db.chatSessions || []).slice().sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

app.get("/api/agent/chat", (req, res) => {
  const sessions = chatSessionsSorted();
  const activeSessionId = req.query.sessionId || sessions[0]?.id || null;
  res.json({
    sessions,
    activeSessionId,
    messages: (db.chatMessages || []).filter((message) => !activeSessionId || message.sessionId === activeSessionId).slice(-100),
    provider: activeProvider(),
    llmConfigured: Boolean(activeProvider())
  });
});

app.post("/api/agent/chat/sessions", requirePermission("write:mandate"), (req, res) => {
  const title = String(req.body.title || "新对话").trim().slice(0, 32) || "新对话";
  const session = { id: id("chat"), title, status: "active", createdAt: nowIso(), updatedAt: nowIso() };
  db.chatSessions ||= [];
  db.chatSessions.unshift(session);
  persist(res, { session, sessions: chatSessionsSorted() });
});

app.patch("/api/agent/chat/sessions/:id", requirePermission("write:mandate"), (req, res) => {
  const session = (db.chatSessions || []).find((item) => item.id === req.params.id);
  if (!session) return res.status(404).json({ error: "Chat session not found" });
  if (req.body.title !== undefined) session.title = String(req.body.title || "未命名对话").trim().slice(0, 32);
  if (req.body.status !== undefined) session.status = String(req.body.status);
  session.updatedAt = nowIso();
  persist(res, { session, sessions: chatSessionsSorted() });
});

app.delete("/api/agent/chat/sessions/:id", requirePermission("write:mandate"), (req, res) => {
  const exists = (db.chatSessions || []).some((item) => item.id === req.params.id);
  if (!exists) return res.status(404).json({ error: "Chat session not found" });
  db.chatSessions = (db.chatSessions || []).filter((item) => item.id !== req.params.id);
  db.chatMessages = (db.chatMessages || []).filter((message) => message.sessionId !== req.params.id);
  appendAudit(db, "删除对话会话", req.params.id, req.user?.name || "Owner");
  persist(res, { ok: true, sessions: chatSessionsSorted() });
});

app.post("/api/agent/chat", requirePermission("write:mandate"), async (req, res) => {
  try {
    const result = await runAgentChat(db, { message: req.body.message, sessionId: req.body.sessionId }, saveDb);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/exchange/:exchange/klines", async (req, res) => {
  try {
    const result = await syncPublicKlines(db, req.params.exchange, req.query.symbol || "BTC/USDT", req.query.timeframe || "1h");
    saveDb(db);
    const market = db.markets.find((item) => item.symbol === result.symbol);
    res.json({ ...result, candles: market?.candles || [] });
  } catch (error) {
    res.status(502).json({ error: `K 线同步失败：${error.message}` });
  }
});

app.get("/api/exchange/:exchange/microstructure", async (req, res) => {
  try {
    const result = await syncMicrostructure(db, req.params.exchange, req.query.symbol || "BTC/USDT");
    persist(res, result);
  } catch (error) {
    res.status(502).json({ error: `微观结构同步失败：${error.message}` });
  }
});

app.get("/api/backtests", (_req, res) => res.json(db.backtests || []));
app.get("/api/strategies", (_req, res) => res.json(listStrategies()));
app.get("/api/portfolio/risk", (_req, res) => {
  const mandate = db.mandates.find((m) => ["active", "running"].includes(m.status));
  res.json(buildPortfolioRisk(db, mandate));
});

app.get("/api/paper/sessions", (_req, res) => res.json(buildPaperReport(db)));
app.post("/api/paper/start", requirePermission("write:review"), async (req, res) => {
  try {
    const result = await createPaperSession(db, req.body || {});
    persist(res, result);
  } catch (error) {
    res.status(500).json({ error: `开模拟盘失败：${error.message}` });
  }
});
app.post("/api/paper/spawn-from-profiles", requirePermission("write:review"), async (req, res) => {
  const created = await ensurePaperSessionsFromProfiles(db, req.body || {});
  persist(res, { message: `已从已验证画像开出 ${created.length} 个模拟盘会话`, created });
});
app.post("/api/paper/run", requirePermission("write:review"), async (_req, res) => {
  try {
    const result = await runPaperForward(db);
    persist(res, result);
  } catch (error) {
    res.status(500).json({ error: `前向推进失败：${error.message}` });
  }
});
app.get("/api/strategy/profiles", (_req, res) => res.json(activeStrategyProfiles(db)));
app.post("/api/strategy/research", requirePermission("write:review"), async (req, res) => {
  try {
    const result = await runStrategyResearch(db, req.body || {});
    persist(res, result);
  } catch (error) {
    res.status(500).json({ error: `策略研究失败：${error.message}` });
  }
});
app.post("/api/backtest/run", requirePermission("write:review"), async (req, res) => {
  try {
    const result = await runBacktest(db, req.body || {});
    persist(res, result);
  } catch (error) {
    res.status(500).json({ error: `回测失败：${error.message}` });
  }
});

app.get("/api/notifications", (_req, res) => res.json((db.notifications || []).slice(0, 50)));

// 打开通知中心即把未读标为已读（清除未读徽章）
app.post("/api/notifications/read", (_req, res) => {
  let marked = 0;
  for (const item of db.notifications || []) { if (!item.read) { item.read = true; marked++; } }
  if (marked) saveDb(db);
  res.json({ ok: true, marked });
});
app.get("/api/notifications/lark-status", (_req, res) => res.json(larkStatus()));
app.get("/api/notifications/telegram-status", (_req, res) => res.json(telegramStatus()));
app.post("/api/notifications/lark-test", requirePermission("admin:security"), async (_req, res) => {
  const result = await notifyLark(db, {
    severity: "info",
    title: "🔔 飞书通知测试",
    body: "如果你在飞书里看到这条消息，说明 AI 交易员的主动通知已打通。",
    fields: [{ label: "来源", value: "AI 交易员" }, { label: "状态", value: "测试" }]
  });
  saveDb(db);
  res.json({ message: `飞书通知：${result.deliveryStatus}`, notification: result });
});
app.post("/api/notifications/telegram-test", requirePermission("admin:security"), async (_req, res) => {
  const position = db.positions?.find((item) => Number(item.pnl ?? item.upl ?? item.unrealizedPnl) > 0) || {
    id: "telegram_test_position",
    exchange: "OKX",
    symbol: "BTC/USDT",
    direction: "long",
    size: 0.01,
    entry: 100000,
    mark: 103500,
    leverage: 5,
    pnl: 35,
    updatedAt: nowIso()
  };
  const result = await sendTelegramPositionPoster(db, position, { caption: "Telegram 盈利仓位海报测试" });
  saveDb(db);
  res.json({ message: `Telegram 海报：${result.status}`, ...result });
});

app.post("/api/agent/command", requirePermission("write:mandate"), (req, res) => {
  const result = runAgentCommand(db, req.body || {});
  persist(res, result);
});

app.get("/api/agent/memory", (_req, res) => res.json(db.memoryItems));
app.post("/api/agent/memory", requirePermission("write:knowledge"), (req, res) => {
  const item = addMemoryItem(db, req.body);
  persist(res, item);
});

app.get("/api/agent-runs", (_req, res) => res.json(db.agentRuns));
app.get("/api/agent/runs", (_req, res) => res.json(db.agentRuns));
app.get("/api/agent/runs/:id", (req, res) => {
  const run = db.agentRuns.find((item) => item.id === req.params.id);
  if (!run) return res.status(404).json({ error: "AgentRun not found" });
  res.json(run);
});
app.post("/api/agent/runs/:id/pause", requirePermission("write:mandate"), (req, res) => {
  const run = changeAgentRunStatus(db, req.params.id, "paused");
  if (!run) return res.status(404).json({ error: "AgentRun not found" });
  persist(res, run);
});
app.post("/api/agent/runs/:id/resume", requirePermission("write:mandate"), (req, res) => {
  const run = changeAgentRunStatus(db, req.params.id, "observing");
  if (!run) return res.status(404).json({ error: "AgentRun not found" });
  persist(res, run);
});
app.post("/api/agent/runs/:id/stop", requirePermission("write:mandate"), (req, res) => {
  const run = changeAgentRunStatus(db, req.params.id, "stopped");
  if (!run) return res.status(404).json({ error: "AgentRun not found" });
  persist(res, run);
});
app.post("/api/agent-runs", requirePermission("write:mandate"), async (req, res) => {
  try {
    const run = await runAgentCycle(db, req.body, saveDb);
    persist(res, run);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/llm-agent/run", requirePermission("write:mandate"), async (req, res) => {
  try {
    const run = await runLlmAgent(db, req.body, saveDb);
    persist(res, run);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/skills", (_req, res) => res.json(db.skills));

app.post("/api/skills/import", requirePermission("write:skills"), (req, res) => {
  const skill = {
    id: id("skill"),
    name: req.body.name || "Imported Skill",
    source: req.body.source || "GitHub",
    version: req.body.version || "0.1.0",
    status: "待扫描",
    scan: "未扫描",
    permissions: req.body.permissions || ["web.read"],
    lastCalled: "从未"
  };
  db.skills.unshift(skill);
  appendAudit(db, "导入 Skill", skill.id, "Skill Manager");
  persist(res, skill);
});

app.post("/api/skills/fetch", requirePermission("write:skills"), async (req, res) => {
  try {
    const skill = await fetchSkillPackage(db, req.body);
    persist(res, skill);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/skills/:id/scan", requirePermission("write:skills"), (req, res) => {
  const skill = scanSkill(db, req.params.id);
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  persist(res, skill);
});

app.post("/api/skills/:id/install", requirePermission("write:skills"), (req, res) => {
  try {
    const skill = installSkill(db, req.params.id, db.user.name);
    if (!skill) return res.status(404).json({ error: "Skill not found" });
    persist(res, skill);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post("/api/skills/:id/disable", requirePermission("write:skills"), (req, res) => {
  const skill = db.skills.find((item) => item.id === req.params.id);
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  skill.status = "已禁用";
  skill.disabledAt = nowIso();
  skill.disabledBy = db.user.name;
  appendAudit(db, "禁用 Skill", skill.id, db.user.name);
  persist(res, skill);
});

app.post("/api/skills/:id/rollback", requirePermission("write:skills"), (req, res) => {
  const skill = db.skills.find((item) => item.id === req.params.id);
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  skill.status = "已回滚";
  skill.rollbackTo = req.body.version || skill.previousVersion || "previous";
  skill.rolledBackAt = nowIso();
  appendAudit(db, "回滚 Skill", skill.id, db.user.name, "warning");
  persist(res, skill);
});

app.post("/api/skills/:id/run-sandbox", requirePermission("write:skills"), async (req, res) => {
  const run = await runSkillSandbox(db, req.params.id, req.body || {});
  persist(res, run);
});

app.get("/api/mcp", (_req, res) => res.json(db.mcpServers));

app.post("/api/mcp", requirePermission("write:mcp"), (req, res) => {
  const server = { id: id("mcp"), status: "registered", toolCount: 0, tools: [], enabled: true, permissions: [], ...req.body };
  db.mcpServers.unshift(server);
  appendAudit(db, "注册 MCP Server", server.id, db.user.name);
  persist(res, server);
});

app.post("/api/mcp/:id/connect", requirePermission("write:mcp"), async (req, res) => {
  const result = await connectMcpServer(db, req.params.id);
  if (result.status === "missing_server") return res.status(404).json({ error: "MCP server not found" });
  persist(res, { ...result, message: result.status === "connected" ? `已连接，发现 ${result.server.toolCount} 个工具` : `连接失败：${result.error || result.status}` });
});

app.post("/api/mcp/:id/disable", requirePermission("write:mcp"), (req, res) => {
  const server = db.mcpServers.find((item) => item.id === req.params.id);
  if (!server) return res.status(404).json({ error: "MCP server not found" });
  server.enabled = false;
  appendAudit(db, "停用 MCP Server", server.id, db.user.name);
  persist(res, { message: `${server.name} 已停用`, server });
});

app.patch("/api/mcp/:id/permissions", requirePermission("admin:security"), (req, res) => {
  const server = db.mcpServers.find((item) => item.id === req.params.id);
  if (!server) return res.status(404).json({ error: "MCP server not found" });
  server.permissions = req.body.permissions || server.permissions || [];
  server.updatedAt = nowIso();
  appendAudit(db, "更新 MCP 权限", server.id, db.user.name);
  persist(res, server);
});

app.get("/api/exchange/accounts", (_req, res) => {
  refreshApiKeyMetadata(db);
  res.json(db.exchangeAccounts);
});

app.post("/api/exchange/accounts", requirePermission("admin:security"), (req, res) => {
  const account = {
    id: id("ex"),
    exchange: req.body.exchange || "BINANCE",
    label: req.body.label || "新交易所账户",
    accountType: req.body.accountType || "unified",
    readEnabled: false,
    tradeEnabled: false,
    withdrawEnabled: false,
    ipWhitelist: "建议开启",
    status: "missing_credentials",
    createdAt: nowIso()
  };
  db.exchangeAccounts.unshift(account);
  appendAudit(db, "创建交易所账户元数据", account.id, db.user.name);
  persist(res, account);
});

app.patch("/api/exchange/accounts/:id", requirePermission("admin:security"), (req, res) => {
  const account = db.exchangeAccounts.find((item) => item.id === req.params.id);
  if (!account) return res.status(404).json({ error: "Exchange account not found" });
  const allowed = ["label", "accountType", "readEnabled", "tradeEnabled", "ipWhitelist", "status"];
  for (const key of allowed) {
    if (req.body[key] !== undefined) account[key] = req.body[key];
  }
  account.withdrawEnabled = false;
  account.updatedAt = nowIso();
  appendAudit(db, "更新交易所账户安全配置", account.id, db.user.name, "warning");
  persist(res, { message: `${account.exchange} 账户配置已更新`, account });
});

app.get("/api/exchange/api-key-metadata", (_req, res) => {
  persist(res, refreshApiKeyMetadata(db));
});

app.post("/api/exchange/api-key-metadata/:id/confirm-no-withdraw", requirePermission("admin:security"), (req, res) => {
  const item = (db.apiKeyMetadata || []).find((key) => key.id === req.params.id);
  if (!item) return res.status(404).json({ error: "API key metadata not found" });
  const currentApiKey = item.exchange === "BINANCE"
    ? process.env.BINANCE_API_KEY
    : item.exchange === "OKX"
      ? process.env.OKX_API_KEY
      : "";
  item.apiKeyFingerprint = currentApiKey
    ? crypto.createHash("sha256").update(currentApiKey).digest("hex").slice(0, 16)
    : null;
  item.withdrawPermission = false;
  item.permissionVerifiedAt = nowIso();
  item.permissionVerificationStatus = "manual_confirmed";
  item.permissionVerificationNote = req.body.note || "用户已在交易所 API 管理页面确认该 Key 未开启提现权限。";
  item.manualWithdrawPermissionConfirmedAt = nowIso();
  item.manualWithdrawPermissionConfirmedBy = db.user?.name || "local_admin";
  appendAudit(db, `人工确认 ${item.exchange} API Key 无提现权限`, item.id, db.user?.name || "local_admin", "warning");
  persist(res, { message: `${item.exchange} API Key 已标记为无提现权限`, item });
});

app.post("/api/exchange/:accountId/reconcile", requirePermission("write:exchange"), (req, res) => {
  const result = reconcileAccount(db, req.params.accountId);
  persist(res, result);
});

app.post("/api/exchange/:accountId/sync-readonly", requirePermission("write:exchange"), async (req, res) => {
  const result = await syncPrivateReadOnly(db, req.params.accountId);
  persist(res, result);
});

app.get("/api/exchange/:exchange/ticker", async (req, res) => {
  const symbol = req.query.symbol || "BTC/USDT";
  try {
    const ticker = await syncPublicMarket(db, req.params.exchange, symbol);
    persist(res, ticker);
  } catch (error) {
    const cached = db.markets.find((market) => market.symbol === symbol) || db.markets[0];
    appendAudit(db, "公开行情同步失败，返回缓存行情", `${req.params.exchange}:${symbol}`, "ExchangeConnector", "warning");
    appendTrace(db, "exchange_market", "公开行情同步失败", "error");
    saveDb(db);
    res.json({
      exchange: String(req.params.exchange).toUpperCase(),
      symbol,
      status: "fallback_cached",
      error: error.message,
      message: cached?.price ? "公开行情同步失败，已显示最近缓存行情。" : "公开行情同步失败，当前没有可用缓存行情。",
      price: cached?.price ?? null,
      high24h: cached?.high24h ?? null,
      low24h: cached?.low24h ?? null,
      volume24h: cached?.volume24h ?? null,
      cachedAt: cached?.lastSyncedAt || db.meta.updatedAt
    });
  }
});

app.post("/api/exchange/private-action", requirePermission("critical:trade_execution"), (req, res) => {
  const result = guardedPrivateExchangeAction(db, req.body.action || "unknown", req.body.payload || {});
  appendAudit(db, `私有交易所动作：${result.status}`, req.body.action || "unknown", "ExchangeConnector", result.status.startsWith("blocked") ? "warning" : "info");
  appendTrace(db, "exchange_private", req.body.action || "private_action", result.status);
  persist(res, result);
});

app.post("/api/trade-actions/:action", requirePermission("critical:trade_execution"), async (req, res) => {
  try {
    const result = await executeTradeAction(db, req.params.action, req.body || {});
    persist(res, result);
  } catch (error) {
    appendAudit(db, "交易写操作异常", req.params.action, "TradeExecutor", "critical");
    saveDb(db);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/realtime/status", (_req, res) => {
  res.json(realtimeStatus(db));
});

app.post("/api/realtime/start", requirePermission("write:realtime"), (req, res) => {
  const status = startRealtimeManager(db, saveDb, { force: true });
  persist(res, status);
});

app.post("/api/realtime/stop", requirePermission("write:realtime"), (req, res) => {
  const status = stopRealtimeManager(db, req.body.reason || "manual_stop");
  persist(res, status);
});

app.post("/api/reconciler/run", requirePermission("write:exchange"), (req, res) => {
  const report = runReconciler(db, req.body || {});
  persist(res, report);
});

app.get("/api/reconciler/reports", (_req, res) => {
  res.json(db.reconciliationReports || []);
});

app.post("/api/trade-plans", requirePermission("write:trade_plan"), (req, res) => {
  const plan = {
    id: id("plan"),
    mandateId: db.mandates[0]?.id,
    exchange: "BINANCE",
    marketType: "perpetual_usdt",
    strategy: "manual_review",
    status: "draft",
    ...req.body,
    createdAt: nowIso()
  };
  const bundle = runExpertAnalysis(db, {
    trigger_type: "autonomous_trade_precheck",
    question: `${plan.symbol} ${plan.direction} 计划前置审查`,
    symbol: plan.symbol
  });
  plan.analysisBundleId = bundle.id;
  db.tradePlans.unshift(plan);
  appendAudit(db, "创建交易计划", plan.id, "AI 交易员");
  persist(res, { plan, analysisBundle: bundle });
});

app.get("/api/trade-plans", (_req, res) => res.json(db.tradePlans));
app.get("/api/trade-plans/:id", (req, res) => {
  const plan = db.tradePlans.find((item) => item.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Trade plan not found" });
  res.json(plan);
});

app.post("/api/trade-plans/:id/risk-check", requirePermission("write:risk"), (req, res) => {
  const plan = db.tradePlans.find((item) => item.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Trade plan not found" });
  const result = evaluateTradePlan(db, { ...plan, ...req.body });
  result.tradePlanId = plan.id;
  result.createdAt = nowIso();
  db.riskChecks.unshift(result);
  plan.lastRiskCheck = result;
  plan.riskCheckId = result.id;
  appendAudit(db, result.passed ? "通过交易风控" : "拒绝交易计划", plan.id, "RiskEngine", result.passed ? "info" : "warning");
  appendTrace(db, "risk_check", `${plan.symbol} 风控检查`, result.passed ? "ok" : "blocked");
  persist(res, result);
});

app.post("/api/trade-plans/:id/request-approval", requirePermission("write:trade_plan"), (req, res) => {
  const plan = db.tradePlans.find((item) => item.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Trade plan not found" });
  plan.status = "awaiting_approval";
  plan.approvalRequestedAt = nowIso();
  appendAudit(db, "交易计划请求人工确认", plan.id, "AgentOrchestrator");
  persist(res, plan);
});

app.post("/api/trade-plans/:id/approve", requirePermission("write:trade_plan"), async (req, res) => {
  const plan = db.tradePlans.find((item) => item.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Trade plan not found" });
  if (!plan.lastRiskCheck) return res.status(400).json({ error: "计划尚未通过风控检查，先运行 risk-check" });
  if (!plan.lastRiskCheck.passed) return res.status(400).json({ error: `风控未通过，禁止批准：${plan.lastRiskCheck.summary}` });
  const freshRisk = evaluateTradePlan(db, plan);
  freshRisk.tradePlanId = plan.id;
  freshRisk.createdAt = nowIso();
  db.riskChecks.unshift(freshRisk);
  plan.lastRiskCheck = freshRisk;
  plan.riskCheckId = freshRisk.id;
  if (!freshRisk.passed) {
    appendAudit(db, `批准前风控复查失败：${freshRisk.summary}`, plan.id, "RiskEngine", "warning");
    persist(res.status(400), { error: `批准前风控复查失败：${freshRisk.summary}`, riskCheck: freshRisk });
    return;
  }
  plan.status = "approved";
  plan.approvedAt = nowIso();
  plan.approvedBy = db.user.name;
  appendAudit(db, "人工批准交易计划", plan.id, db.user.name, "warning");
  // 批准即进入执行引擎：实盘开启则真实下单，关闭则记录干跑结果。
  const execution = await executeApprovedPlan(db, plan.id, { manualApproval: true });
  const guard = describeGuardReason(execution.reason);
  const messages = {
    dry_run: "计划已批准。实盘写入关闭，执行引擎完成了数量与价格计算（干跑），未向交易所提交。",
    submitted: "计划已批准，入场单已提交到交易所。",
    blocked: guard ? `计划已批准，但执行被安全闸拦截：${guard.label}。${guard.fix ? "开启方式：" + guard.fix : ""}` : "计划已批准，但执行被安全闸拦截。",
    already_executing: "该计划已有在途执行单。"
  };
  persist(res, { plan, execution, guard, message: messages[execution.status] || `执行状态：${execution.status}` });
});

// AI 交易员代操作：待确认操作的执行（点确认后）。真钱/授权动作仍受各自的硬闸约束（防御纵深）。
async function executePendingAction(db, record) {
  const a = record.args || {};
  const actor = db.user?.name || "Owner";
  if (record.type === "run_reconcile") {
    return { ok: true, result: runReconciler(db, { mode: "agent_confirm" }) };
  }
  if (record.type === "kill_switch") {
    db.system.killSwitch = a.enabled !== false;
    appendAudit(db, db.system.killSwitch ? "对话确认：开启熔断" : "对话确认：解除熔断", "kill_switch", actor, "warning");
    return { ok: true, killSwitch: db.system.killSwitch };
  }
  if (record.type === "set_live_gate") {
    const entries = {};
    if (a.gate === "live") { entries.LIVE_TRADING_ENABLED = a.enabled !== false ? "true" : "false"; entries.I_UNDERSTAND_REAL_TRADING = a.enabled !== false ? "true" : "false"; }
    if (a.gate === "order_write") entries.REAL_ORDER_WRITE_ENABLED = a.enabled !== false ? "true" : "false";
    if (Object.keys(entries).length) await setConfig(db, entries);
    db.system.liveTradingEnabled = process.env.LIVE_TRADING_ENABLED === "true" && process.env.I_UNDERSTAND_REAL_TRADING === "true";
    if (a.gate === "gray") {
      db.grayReleasePolicies ||= [];
      let policy = db.grayReleasePolicies[0];
      if (!policy) { policy = { id: id("gray"), maxNotionalUsdt: Number(process.env.MAX_LIVE_NOTIONAL_USDT || 50), allowedSymbols: [] }; db.grayReleasePolicies.unshift(policy); }
      policy.enabled = a.enabled !== false;
    }
    appendAudit(db, `对话确认：设置实盘闸 ${a.gate}=${a.enabled !== false}`, "live_gate", actor, "warning");
    return { ok: true, liveTradingEnabled: db.system.liveTradingEnabled };
  }
  if (record.type === "mandate") {
    const m = (db.mandates || []).find((x) => x.id === (a.resolvedTargetId || a.mandateId)) || db.mandates?.[0];
    if (!m) return { ok: false, error: "mandate_not_found" };
    m.status = a.op === "activate" ? "active" : a.op === "pause" ? "paused" : a.op === "revoke" ? "revoked" : m.status;
    m.updatedAt = nowIso();
    appendAudit(db, `对话确认：${a.op} Mandate ${m.id}`, m.id, actor, "warning");
    return { ok: true, mandate: { id: m.id, status: m.status } };
  }
  if (record.type === "approve_plan") {
    const plan = (db.tradePlans || []).find((p) => p.id === (a.resolvedTargetId || a.planId))
      || (db.tradePlans || []).find((p) => ["awaiting_approval", "risk_checked", "draft"].includes(p.status));
    if (!plan) return { ok: false, error: "plan_not_found" };
    const fresh = evaluateTradePlan(db, plan);
    fresh.tradePlanId = plan.id; fresh.createdAt = nowIso();
    db.riskChecks.unshift(fresh); plan.lastRiskCheck = fresh; plan.riskCheckId = fresh.id;
    if (!fresh.passed) return { ok: false, error: "risk_blocked", summary: fresh.summary };
    plan.status = "approved"; plan.approvedAt = nowIso(); plan.approvedBy = actor;
    appendAudit(db, "对话确认：批准交易计划", plan.id, actor, "warning");
    const execution = await executeApprovedPlan(db, plan.id, { manualApproval: true });
    return { ok: true, execution, guard: describeGuardReason(execution.reason) };
  }
  return { ok: false, error: "unknown_action_type" };
}

app.post("/api/agent/actions/:id/confirm", requirePermission("write:mandate"), async (req, res) => {
  const record = (db.pendingActions || []).find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ error: "待确认操作不存在" });
  if (record.status !== "awaiting_confirmation") return res.status(400).json({ error: "该操作已处理" });
  const result = await executePendingAction(db, record);
  record.status = result.ok ? "executed" : "failed";
  record.result = result;
  record.resolvedAt = nowIso();
  persist(res, { action: record, result });
});

app.post("/api/agent/actions/:id/cancel", requirePermission("write:mandate"), (req, res) => {
  const record = (db.pendingActions || []).find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ error: "待确认操作不存在" });
  record.status = "cancelled";
  record.resolvedAt = nowIso();
  persist(res, { action: record });
});

app.post("/api/trade-plans/:id/cancel", requirePermission("write:trade_plan"), (req, res) => {
  const plan = db.tradePlans.find((item) => item.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Trade plan not found" });
  plan.status = "cancelled";
  plan.cancelledAt = nowIso();
  plan.cancelReason = req.body.reason || "user_cancelled";
  appendAudit(db, "取消交易计划", plan.id, db.user.name);
  persist(res, plan);
});

app.post("/api/trade-plans/:id/execute", requirePermission("critical:trade_execution"), (req, res) => {
  const plan = db.tradePlans.find((item) => item.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Trade plan not found" });
  const result = executeTradePlan(db, plan, plan.lastRiskCheck);
  appendAudit(db, "拒绝直接执行交易计划接口", plan.id, "ExecutionEngine", "warning");
  appendTrace(db, "trade_execution", `${plan.symbol} direct execute rejected`, "blocked");
  persist(res, result);
});

app.get("/api/execution-orders", (_req, res) => res.json(db.executionOrders || []));

app.post("/api/execution-orders/poll", requirePermission("write:trade_plan"), async (_req, res) => {
  try {
    const result = await pollExecutionOrders(db);
    refreshAccounting(db);
    persist(res, result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/execution-orders/:id/close", requirePermission("critical:trade_execution"), async (req, res) => {
  try {
    const result = await closeExecution(db, req.params.id, req.body.reason || "manual_ui");
    refreshAccounting(db);
    persist(res, result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/performance", (_req, res) => {
  res.json(performanceReport(db));
});

app.post("/api/accounting/refresh", requirePermission("write:risk"), (_req, res) => {
  persist(res, refreshAccounting(db));
});

app.post("/api/risk/check-trade-plan", requirePermission("write:risk"), (req, res) => {
  const plan = req.body.tradePlanId ? db.tradePlans.find((item) => item.id === req.body.tradePlanId) : req.body;
  if (!plan) return res.status(404).json({ error: "Trade plan not found" });
  const result = evaluateTradePlan(db, plan);
  result.tradePlanId = plan.id;
  result.createdAt = nowIso();
  db.riskChecks.unshift(result);
  persist(res, result);
});

app.post("/api/risk/kill-switch", requirePermission("risk.kill_switch"), async (req, res) => {
  db.system.killSwitch = Boolean(req.body.enabled);
  db.system.autonomyEnabled = !db.system.killSwitch;
  db.system.riskStatus = db.system.killSwitch ? "熔断停机" : "正常";
  if (db.system.killSwitch) {
    const cancelRequested = [];
    for (const order of db.orders || []) {
      const open = ["open", "new", "partially_filled", "submitted"].includes(String(order.status || "").toLowerCase());
      if (open && !order.reduceOnly) {
        order.status = "cancel_requested";
        order.cancelReason = "kill_switch";
        order.updatedAt = nowIso();
        cancelRequested.push(order.id);
      }
    }
    if (cancelRequested.length) {
      db.riskIncidents.unshift({
        id: id("incident"),
        severity: "critical",
        status: "open",
        title: "一键熔断触发撤单请求",
        source: "risk.kill_switch",
        affectedOrders: cancelRequested,
        createdAt: nowIso()
      });
    }
  }
  const killReason = String(req.body.reason || "").trim();
  appendAudit(db, `${db.system.killSwitch ? "启用一键熔断" : "解除一键熔断"}${killReason ? `：${killReason}` : ""}`, "risk.kill_switch", db.user.name, db.system.killSwitch ? "critical" : "info");
  appendTrace(db, "risk", db.system.killSwitch ? "一键熔断开启" : "一键熔断解除", db.system.killSwitch ? "blocked" : "ok");
  await notifyLark(db, {
    severity: db.system.killSwitch ? "critical" : "info",
    title: db.system.killSwitch ? "🛑 一键熔断已触发" : "🟢 熔断已解除",
    body: `${db.system.killSwitch ? "所有新开仓已被阻断，在途委托已请求撤单。请检查账户与市场。" : "熔断解除，系统恢复正常风控运行。"}${killReason ? `\n原因：${killReason}` : ""}`
  });
  persist(res, db.system);
});

app.get("/api/risk/status", (_req, res) => {
  res.json({ system: db.system, rules: db.riskRules, incidents: db.riskIncidents, checks: db.riskChecks.slice(0, 20) });
});

app.get("/api/risk/rules", (_req, res) => res.json(db.riskRules));
app.post("/api/risk/rules", requirePermission("write:risk"), (req, res) => {
  const rule = { id: id("risk"), name: req.body.name || "新风控规则", scope: req.body.scope || "trade", level: req.body.level || "L2", enabled: true, action: req.body.action || "notify", description: req.body.description || "", event: req.body.event || "", condition: req.body.condition || "", createdAt: nowIso() };
  db.riskRules.unshift(rule);
  appendAudit(db, "创建风控规则", rule.id, db.user.name);
  persist(res, rule);
});

app.patch("/api/risk/rules/:id", requirePermission("write:risk"), (req, res) => {
  const rule = db.riskRules.find((item) => item.id === req.params.id);
  if (!rule) return res.status(404).json({ error: "Risk rule not found" });
  const allowed = ["name", "scope", "level", "enabled", "action", "description", "event", "condition"];
  for (const key of allowed) {
    if (req.body[key] !== undefined) rule[key] = req.body[key];
  }
  rule.updatedAt = nowIso();
  appendAudit(db, "更新风控规则", rule.id, db.user.name, rule.enabled === false ? "warning" : "info");
  persist(res, { message: `${rule.name} 已更新`, rule });
});

app.post("/api/risk/gray-policies/:id", requirePermission("write:risk"), (req, res) => {
  const policy = db.grayReleasePolicies.find((item) => item.id === req.params.id);
  if (!policy) return res.status(404).json({ error: "Gray policy not found" });
  Object.assign(policy, {
    enabled: req.body.enabled ?? policy.enabled,
    maxNotionalUsdt: req.body.maxNotionalUsdt ?? policy.maxNotionalUsdt,
    allowedSymbols: req.body.allowedSymbols || policy.allowedSymbols,
    requiresManualApproval: req.body.requiresManualApproval ?? policy.requiresManualApproval,
    updatedAt: nowIso()
  });
  appendAudit(db, "更新灰度实盘策略", policy.id, db.user.name, policy.enabled ? "warning" : "info");
  persist(res, policy);
});

app.post("/api/risk/reduce-only", requirePermission("risk.kill_switch"), (req, res) => {
  db.system.reduceOnlyMode = req.body.enabled !== false;
  db.system.autonomyEnabled = false;
  db.system.riskStatus = db.system.reduceOnlyMode ? "只减仓" : "人工暂停";
  db.system.latestAction = db.system.reduceOnlyMode ? "启用只减仓模式" : "关闭只减仓模式";
  db.system.updatedAt = nowIso();
  appendAudit(db, db.system.latestAction, "system.reduce_only", db.user.name, "warning");
  appendTrace(db, "risk", db.system.latestAction, db.system.reduceOnlyMode ? "warning" : "paused");
  persist(res, { message: db.system.latestAction, system: db.system });
});

app.get("/api/risk/incidents", (_req, res) => res.json(db.riskIncidents));

// 关闭单个风险事件（标记已处理/已读）。
app.post("/api/risk/incidents/:id/close", requirePermission("write:risk"), (req, res) => {
  const incident = (db.riskIncidents || []).find((item) => item.id === req.params.id);
  if (!incident) return res.status(404).json({ error: "Incident not found" });
  incident.status = "resolved";
  incident.resolvedAt = nowIso();
  incident.resolvedBy = db.user?.name || "user";
  if (req.body?.note) incident.resolveNote = String(req.body.note).slice(0, 500);
  appendAudit(db, `关闭风险事件：${incident.title || incident.id}`, incident.id, db.user?.name || "user");
  persist(res, { incident, message: "已标记为已处理" });
});

// 批量关闭所有未处理事件（用户"全部标记已处理"或 AI 分析完成后统一收尾）。
app.post("/api/risk/incidents/close-all", requirePermission("write:risk"), (req, res) => {
  const open = (db.riskIncidents || []).filter((item) => item.status === "open");
  const now = nowIso();
  const by = db.user?.name || "user";
  for (const incident of open) {
    incident.status = "resolved";
    incident.resolvedAt = now;
    incident.resolvedBy = by;
    if (req.body?.note) incident.resolveNote = String(req.body.note).slice(0, 500);
  }
  if (open.length) appendAudit(db, `批量关闭 ${open.length} 个风险事件`, "risk.incidents", by, "info");
  persist(res, { closed: open.length, message: `已标记 ${open.length} 个事件为已处理` });
});

app.post("/api/event-sources", requirePermission("write:event"), (req, res) => {
  const source = {
    id: id("event_source"),
    name: req.body.name || "新事件源",
    type: req.body.type || "rss",
    url: req.body.url || "",
    enabled: req.body.enabled !== false,
    trustScore: Number(req.body.trustScore || 70),
    createdAt: nowIso()
  };
  db.eventSources.unshift(source);
  appendAudit(db, "新增事件源", source.id, db.user.name);
  persist(res, source);
});

app.post("/api/event-sources/refresh", requirePermission("write:event"), async (_req, res) => {
  const result = await refreshEventSources(db);
  persist(res, result);
});

app.post("/api/event-sources/onchain", requirePermission("write:event"), async (_req, res) => {
  const result = await refreshOnchainSignals(db);
  persist(res, result);
});

app.get("/api/event-sources", (_req, res) => res.json(db.eventSources || []));

app.get("/api/security/vault", (_req, res) => res.json(listVaultItems(db)));
app.post("/api/security/vault", requirePermission("admin:security"), (req, res) => {
  try {
    const result = storeSecret(db, req.body.name, req.body.value, req.body.scope);
    persist(res, result);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.post("/api/security/exchange-credentials", requirePermission("admin:security"), async (req, res) => {
  try {
    const exchange = String(req.body.exchange || "").toUpperCase();
    if (!["BINANCE", "OKX"].includes(exchange)) return res.status(400).json({ error: "exchange must be BINANCE or OKX" });
    const account = db.exchangeAccounts.find((item) => item.exchange === exchange);
    if (!account) return res.status(404).json({ error: "Exchange account not found" });

    const saved = [];
    function saveSecret(envName, value) {
      if (!value) return;
      saved.push(storeSecret(db, envName, value, "exchange"));
      process.env[envName] = String(value);
    }

    if (exchange === "BINANCE") {
      saveSecret("BINANCE_API_KEY", req.body.apiKey);
      saveSecret("BINANCE_API_SECRET", req.body.apiSecret);
    } else {
      saveSecret("OKX_API_KEY", req.body.apiKey);
      saveSecret("OKX_API_SECRET", req.body.apiSecret);
      saveSecret("OKX_API_PASSPHRASE", req.body.passphrase);
    }

    if (req.body.ipWhitelist !== undefined) account.ipWhitelist = req.body.ipWhitelist || "建议开启";
    account.readEnabled = exchange === "BINANCE"
      ? Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET)
      : Boolean(process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE);
    account.tradeEnabled = account.readEnabled;
    account.withdrawEnabled = false;
    account.status = account.readEnabled ? "configured" : "missing_credentials";
    account.lastCredentialUpdateAt = nowIso();
    refreshApiKeyMetadata(db);
    const validation = account.readEnabled
      ? await syncPrivateReadOnly(db, account.id)
      : { status: "missing_credentials", error: exchange === "OKX" ? "OKX 需要 API Key、Secret 和 Passphrase 才能同步账户。" : "Binance 需要 API Key 和 Secret 才能同步账户。" };
    appendAudit(db, `配置 ${exchange} API 凭证`, account.id, db.user.name, "warning");
    persist(res, {
      message: validation.status === "ok"
        ? `${exchange} API 配置已保存，并已成功同步账户数据。`
        : `${exchange} API 配置已保存，但账户同步未成功：${validation.error || validation.status}`,
      account,
      validation,
      saved: saved.map((item) => ({ id: item.id, name: item.name, scope: item.scope }))
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get("/api/config", (_req, res) => {
  res.json(getConfigStatus(db));
});

// 通用配置写入：LLM 密钥/模型、非敏感开关。敏感项加密入库，不回传明文。
app.post("/api/config", requirePermission("admin:security"), async (req, res) => {
  try {
    const applied = setConfig(db, req.body || {});
    refreshApiKeyMetadata(db);
    const exchangeValidations = [];
    for (const account of db.exchangeAccounts || []) {
      const names = account.exchange === "OKX"
        ? ["OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE"]
        : ["BINANCE_API_KEY", "BINANCE_API_SECRET"];
      if (names.some((name) => applied.includes(name)) && account.readEnabled) {
        exchangeValidations.push(await syncPrivateReadOnly(db, account.id));
      }
    }
    // 交易所密钥变动后立即重连实时 WS（含私有用户流），让持仓/订单/账户实时推送生效，不必等重启。
    if (applied.some((name) => /API_KEY|API_SECRET|API_PASSPHRASE/.test(name))) {
      try { startRealtimeManager(db, saveDb, { force: true }); } catch { /* noop */ }
    }
    saveDb(db);
    const failedValidation = exchangeValidations.find((item) => item.status !== "ok");
    res.json({
      message: failedValidation
        ? `已保存配置，但交易所账户同步未成功：${failedValidation.error || failedValidation.status}`
        : applied.length ? `已保存：${applied.join("、")}` : "无变更",
      applied,
      exchangeValidations,
      status: getConfigStatus(db)
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// 实盘开关 + 灰度额度（高危，集中一处并写审计）。
app.post("/api/config/live-trading", requirePermission("admin:security"), (req, res) => {
  const entries = {};
  if (req.body.liveTradingEnabled !== undefined) entries.LIVE_TRADING_ENABLED = req.body.liveTradingEnabled ? "true" : "false";
  if (req.body.acknowledged !== undefined) entries.I_UNDERSTAND_REAL_TRADING = req.body.acknowledged ? "true" : "false";
  if (req.body.orderWriteEnabled !== undefined) entries.REAL_ORDER_WRITE_ENABLED = req.body.orderWriteEnabled ? "true" : "false";
  if (req.body.maxNotionalUsdt !== undefined) entries.MAX_LIVE_NOTIONAL_USDT = String(Number(req.body.maxNotionalUsdt) || 50);
  setConfig(db, entries);

  // 同步持久化到 db.system（存 sqlite，重启不丢，作为实盘闸的权威源）。
  if (req.body.acknowledged !== undefined) db.system.realTradingAck = Boolean(req.body.acknowledged);
  if (req.body.orderWriteEnabled !== undefined) db.system.orderWriteEnabled = Boolean(req.body.orderWriteEnabled);
  if (req.body.liveTradingEnabled !== undefined) db.system.liveTradingEnabled = Boolean(req.body.liveTradingEnabled) && db.system.realTradingAck === true;
  else db.system.liveTradingEnabled = db.system.liveTradingEnabled === true && db.system.realTradingAck === true;

  const gray = (db.grayReleasePolicies || []).find((item) => item.id === "gray_live_small_notional");
  if (gray) {
    if (req.body.grayEnabled !== undefined) gray.enabled = Boolean(req.body.grayEnabled);
    if (req.body.maxNotionalUsdt !== undefined) gray.maxNotionalUsdt = Number(req.body.maxNotionalUsdt) || gray.maxNotionalUsdt;
    if (req.body.grayRequiresApproval !== undefined) gray.requiresManualApproval = Boolean(req.body.grayRequiresApproval);
    gray.updatedAt = nowIso();
  }
  appendAudit(db, "更新实盘交易开关与灰度额度", "live_trading_config", db.user.name, "warning");
  saveDb(db);
  res.json({ message: "实盘配置已更新", status: getConfigStatus(db) });
});

app.delete("/api/config/secret/:key", requirePermission("admin:security"), (req, res) => {
  const ok = clearSecret(db, req.params.key);
  refreshApiKeyMetadata(db);
  saveDb(db);
  res.json({ message: ok ? `已移除 ${req.params.key}` : "未知密钥", status: getConfigStatus(db) });
});

app.post("/api/security/alerts", requirePermission("admin:security"), async (req, res) => {
  const result = await sendAlert(db, req.body);
  persist(res, result);
});

app.post("/api/security/drills/:type", requirePermission("admin:security"), (req, res) => {
  const result = runSafetyDrill(db, req.params.type);
  persist(res, result);
});

app.get("/api/security/audit-chain", (_req, res) => {
  res.json(verifyAuditChain(db));
});

app.post("/api/reviews", requirePermission("write:review"), (req, res) => {
  const review = { id: id("review"), title: req.body.title || "交易复盘", summary: req.body.summary || "", tags: req.body.tags || [], tradePlanId: req.body.tradePlanId, createdAt: nowIso() };
  db.reviews.unshift(review);
  appendAudit(db, "创建复盘", review.id, "复盘员");
  persist(res, review);
});

app.get("/api/review/analytics", (_req, res) => {
  res.json(buildReviewAnalytics(db));
});

app.post("/api/review/backfill-fields", requirePermission("write:review"), (_req, res) => {
  const result = backfillReviewFields(db);
  appendAudit(db, "补全复盘字段", "review_backfill", "ReviewEngine");
  persist(res, { message: `已补全复盘字段：${result.updated} 处`, ...result, analytics: buildReviewAnalytics(db) });
});

app.post("/api/review/strategy-improvement", requirePermission("write:review"), async (req, res) => {
  // 记录改进假设/成功标准（复盘产物），并真正发起研究 → 自动开模拟盘（前向验证）。
  const cycle = createStrategyImprovementCycle(db, req.body || {});
  let research = null;
  try {
    research = await runStrategyResearch(db, req.body?.symbols ? { symbols: req.body.symbols } : {});
  } catch (error) {
    research = { status: "research_failed", error: error.message };
  }
  persist(res, {
    ...cycle,
    research,
    message: research?.status === "ok"
      ? `已发起改进闭环：研究 ${research.updated?.length || 0} 个交易对，自动开模拟盘 ${research.paperSpawned || 0} 个`
      : `已创建改进假设；研究未完成（${research?.error || research?.status || "unknown"}）`
  });
});

app.get("/api/traces", (_req, res) => res.json(db.traces));
app.get("/api/audit-logs", (_req, res) => res.json(db.auditLogs));
app.get("/api/audit-logs/export", (req, res) => {
  const format = req.query.format === "csv" ? "csv" : "json";
  res.type(format === "csv" ? "text/csv" : "application/json").send(exportAuditLogs(db, format));
});
app.get("/api/traces/export", (req, res) => {
  const format = req.query.format === "csv" ? "csv" : "json";
  res.type(format === "csv" ? "text/csv" : "application/json").send(exportTraces(db, format));
});

app.listen(port, host, () => {
  console.log(`AI Trading Agent API listening on http://${host}:${port}`);
});
