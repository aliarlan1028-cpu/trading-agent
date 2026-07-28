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
import { cancelWatch, runWatchSentinel } from "./watchSentinel.mjs";
import { closeExecution, executeApprovedPlan, pollExecutionOrders } from "./executionEngine.mjs";
import { monitorPositions } from "./positionManager.mjs";
import { activateMandate, changeAgentRunStatus, getAgentStatus, parseMandateCommand, runAgentCommand } from "./agentOrchestrator.mjs";
import { authRequired, hashPassword, installAuth, invalidateSessions, requirePermission, verifyPassword } from "./auth.mjs";
import { canConfirmPendingAction, userHasPermission } from "./actionAuthorization.mjs";
import { exportAuditLogs, exportTraces } from "./auditExport.mjs";
import { executeTradePlan } from "./executor.mjs";
import { getHistoricalKlines, guardedPrivateExchangeAction, reconcileAccount, refreshApiKeyMetadata, syncMicrostructure, syncPrivateReadOnly, syncPublicKlines, syncPublicMarket } from "./exchangeConnector.mjs";
import { fetchMarketRegime, fetchPerpetualInstruments } from "./marketSignals.mjs";
import { escortPositions, refreshMarketMovers } from "./marketScan.mjs";
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
import { consolidateRuleProposals, embeddingStatus, importGithubKnowledge, importKnowledge as importKnowledgeReal, parseKnowledgeSource as parseKnowledgeRealSource, ragQuery, reembedAllChunks } from "./knowledgePipeline.mjs";
import { runExpertAnalysis } from "./knowledgeEngine.mjs";
import {
  approveKnowledgeSkill,
  bindKnowledgeSkillsToPlan,
  compileTradingMethod,
  ensureCuratedSkills,
  validateAllCompiledSkills,
  knowledgeSkillSummary,
  retireKnowledgeSkill,
  retireSkillsForSource,
  startKnowledgeSkillPaper,
  syncKnowledgeSkillLifecycle,
  promoteCompiledToProbation,
  validateKnowledgeSkill
} from "./knowledgeSkills.mjs";
import { installProxyFromEnv } from "./netProxy.mjs";
import { buildReadinessReport, createSystemBackup, deriveAutomationState } from "./ops.mjs";
import { buildStrategyBoard, refreshTrustedSkillMetrics } from "./strategyBoard.mjs";
import { runReconciler } from "./reconciler.mjs";
import { backfillReviewFields, buildReviewAnalytics, createStrategyImprovementCycle, runTradeReflection } from "./reviewEngine.mjs";
import { realtimeStatus, startRealtimeManager, stopRealtimeManager } from "./realtimeManager.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { compileNaturalRiskCondition, validateConditionSpec } from "./dynamicRiskRules.mjs";
import { ensureSystemTask, registerTaskHandler, runTask, scheduleTask, schedulerStatus, startScheduler } from "./scheduler.mjs";
import { listVaultItems, runSafetyDrill, sendAlert, storeSecret } from "./securityOps.mjs";
import { installSkill, scanSkill } from "./skillManager.mjs";
import { seedSkillTools } from "./skillTools.mjs";
import { connectMcpServer, ensureCoingeckoMcp, mcpStatus } from "./mcpClient.mjs";
import { fetchSkillPackage, readSkillInstructions, runSkillSandbox } from "./skillSandbox.mjs";
import { activeMandate, appendAudit, appendTrace, getStorageInfo, id, loadDb, nowIso, resetOperationalData, saveDb, TRADER_PERMISSIONS, verifyAuditChain } from "./store.mjs";
import { describeGuardReason, executeTradeAction } from "./tradeActions.mjs";
import { isPublicMarketStreamUpdate } from "./streamPolicy.mjs";
import { dispatchOutbox } from "./outboxDispatcher.mjs";
import { shipAuditToWorm } from "./auditSink.mjs";
import { recoverUncertainOrders } from "./omsRecovery.mjs";
import { requestContextMiddleware } from "./requestContext.mjs";

dotenv.config();
installProxyFromEnv();

// TENANT_ISOLATION_V2 fail-closed:该开关承诺的按租户数据隔离尚未在 chat/plans/notifications
// 等读路径实现(审计发现)。开着它对外注册等于把 owner 全量数据暴露给任意租户——拒绝启动。
if (process.env.TENANT_ISOLATION_V2 === "true") {
  console.error("TENANT_ISOLATION_V2=true 但按租户隔离尚未实现(chat/plans/notifications 等读路径未过滤)。请保持 false 并用一客户一实例(Path A)交付。");
  process.exit(1);
}

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
for (const server of db.mcpServers || []) {
  const legacyApiKey = server.apiKey || server.headers?.Authorization?.replace(/^Bearer\s+/i, "");
  if (!legacyApiKey) continue;
  try {
    const secretName = server.apiKeySecretName || `MCP_${server.id}_API_KEY`;
    storeSecret(db, secretName, legacyApiKey, "mcp");
    server.apiKeySecretName = secretName;
    server.credentialMigration = "encrypted";
  } catch {
    server.enabled = false;
    server.status = "secret_migration_required";
    server.credentialMigration = "removed_plaintext_reenter_required";
  }
  delete server.apiKey;
  if (server.headers) {
    delete server.headers.Authorization;
    delete server.headers.authorization;
    if (!Object.keys(server.headers).length) delete server.headers;
  }
}
// 方法首次编译只种一次(用户实锤:每次启动都重编"没存活技能"的方法,导致清理掉的 compile_failed
// 一重启又复活、又必然编译失败)。新导入书本由蒸馏管道当场编译,不靠这段;老库已播过种直接跳过。
(function seedCompileMethodsOnce() {
  db.meta ||= {};
  if (db.meta.methodsSeedCompiledVersion === 1) return;
  // 已存在任何技能 = 之前播过种(老库升级):只打标记,绝不重建被用户清理掉的
  if ((db.knowledge?.tradingSkills || []).length > 0) { db.meta.methodsSeedCompiledVersion = 1; return; }
  for (const method of db.knowledge?.tradingMethods || []) {
    try {
      if (method.direction === "both") {
        compileTradingMethod(db, method.id, { direction: "long" }, "StartupMigration");
        compileTradingMethod(db, method.id, { direction: "short" }, "StartupMigration");
      } else {
        compileTradingMethod(db, method.id, {}, "StartupMigration");
      }
    } catch { /* 保留为不可执行顾问知识 */ }
  }
  db.meta.methodsSeedCompiledVersion = 1;
})();
// 存量数据自愈:多条 active 授权并存(activateMandate 旧实现从不废弃旧条)导致
// 计划绑旧版本被风控永久拒绝。保留 version 最高/激活最新的一条,其余置 superseded。
(function collapseDuplicateActiveMandates() {
  const actives = (db.mandates || []).filter((m) => ["active", "running"].includes(m.status));
  if (actives.length <= 1) return;
  const keep = actives.slice().sort((a, b) =>
    (Number(b.version || 1) - Number(a.version || 1)) ||
    (new Date(b.activatedAt || b.createdAt || 0) - new Date(a.activatedAt || a.createdAt || 0))
  )[0];
  for (const m of actives) {
    if (m.id === keep.id) continue;
    m.status = "superseded";
    m.supersededAt = nowIso();
    appendAudit(db, `启动自愈:多 active 授权收敛,${m.id} 被 ${keep.id}(v${keep.version || 1}) 取代`, m.id, "StartupMigration", "warning");
  }
})();
// 存量数据自愈:历史巡检散会话(每 15 分钟新建一个)并入固定"自主巡检"会话。
(function mergeAutocycleSessions() {
  const strays = (db.chatSessions || []).filter((c) => c.id !== "chat_autocycle" && String(c.title || "").startsWith("【定时巡检】"));
  if (!strays.length) return;
  db.chatSessions ||= [];
  if (!db.chatSessions.some((c) => c.id === "chat_autocycle")) {
    db.chatSessions.unshift({ id: "chat_autocycle", title: "自主巡检 · 自动汇总", status: "active", system: true, createdAt: nowIso(), updatedAt: nowIso() });
  }
  const strayIds = new Set(strays.map((c) => c.id));
  for (const msg of db.chatMessages || []) {
    if (strayIds.has(msg.sessionId)) msg.sessionId = "chat_autocycle";
  }
  db.chatSessions = db.chatSessions.filter((c) => !strayIds.has(c.id));
  appendAudit(db, `启动自愈:${strays.length} 个巡检散会话并入自主巡检汇总`, "chat_autocycle", "StartupMigration");
})();
// 编译器修订迁移:止损语义修复(compilerRev 2)后,旧版编译的技能(仅限
// compiled/historical_rejected,不动模拟中/已上岗)自动重编译成新版本,
// 用户重跑「一键历史验证」即可用正确的止损口径重新考试。
(function recompileStaleCompilerRev() {
  const stale = new Map();
  for (const skill of db.knowledge?.tradingSkills || []) {
    if (!["compiled", "historical_rejected"].includes(skill.status)) continue;
    if (Number(skill.spec?.compilerRev || 1) >= 2) continue;
    if (skill.sourceMethodId) stale.set(skill.sourceMethodId + "|" + (skill.spec?.direction || ""), skill);
  }
  if (!stale.size) return;
  let redone = 0;
  for (const [key, skill] of stale) {
    const method = (db.knowledge?.tradingMethods || []).find((m) => m.id === skill.sourceMethodId);
    if (!method) continue;
    try {
      compileTradingMethod(db, method.id, { direction: skill.spec?.direction }, "CompilerRevMigration");
      redone += 1;
    } catch { /* 单条失败不阻断启动 */ }
  }
  if (redone) appendAudit(db, `编译器修订迁移:${redone} 个旧止损口径技能已重编译(待重新历史验证)`, "compiler_rev_2", "StartupMigration");
})();
// 精选手写技能入列(幂等):参数明确、信号频率足够的规范 spec,与书本方法同闸验证。
try { ensureCuratedSkills(db); } catch (error) { appendTrace(db, "system", `精选技能入列失败:${String(error.message || error).slice(0, 120)}`, "warning"); }
// 小额实盘验证模式(主人选择:用小资金当验证器):默认开启,编译好的技能直接上岗试用,
// 真实成绩决定转正/退役,不再被历史验证/前向/人工批准三道墙卡死。可通过 system.skillLiveValidationMode 关闭。
db.system.skillLiveValidationMode ??= true;
if (db.system.skillLiveValidationMode) {
  try { promoteCompiledToProbation(db); } catch (error) { appendTrace(db, "system", `技能上岗试用失败:${String(error.message || error).slice(0, 120)}`, "warning"); }
}
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

const corsAllowlist = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",").map((item) => item.trim()).filter(Boolean);
// Capacitor 原生 App 的 WebView 源：App 端所有 fetch 都带这个 Origin，拒了 App 就整体断连。
const NATIVE_APP_ORIGINS = new Set(["capacitor://localhost", "ionic://localhost"]);
app.use((req, res, next) => cors({
  origin(origin, callback) {
    if (!origin || corsAllowlist.includes(origin) || NATIVE_APP_ORIGINS.has(origin)) return callback(null, true);
    // 同源必须放行：ES module 的 <script> 与同源 fetch 也会带 Origin 头——
    // 曾因未配 CORS_ALLOWED_ORIGINS + HOST=0.0.0.0 兜底不命中，把自己的 JS 资源 403 掉导致全站白屏。
    try {
      if (new URL(origin).host === req.headers.host) return callback(null, true);
    } catch { /* 非法 Origin 走拒绝分支 */ }
    if (corsAllowlist.length === 0 && host === "127.0.0.1") return callback(null, true);
    return callback(new Error("CORS origin denied"));
  },
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
})(req, res, next));
// CORS 拒绝返回干净的 403，而不是落进默认错误处理器变 500（可能带栈信息）。
app.use((err, _req, res, next) => {
  if (err && err.message === "CORS origin denied") return res.status(403).json({ error: "Origin not allowed" });
  next(err);
});
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' https: wss:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'");
  next();
});
app.use(express.json({ limit: "20mb" }));
app.use(express.static(publicDir));
app.get(/^\/(?!api(?:\/|$)).*/, (_req, res, next) => {
  res.sendFile(path.join(publicDir, "index.html"), (error) => {
    if (error) next(error);
  });
});
installAuth(app, db);
app.use(requestContextMiddleware);

// 注册真实任务处理器并确保系统任务存在（执行轮询/持仓监控/核算/自主巡检/对账）
registerTaskHandler("execution_poll", (database) => pollExecutionOrders(database));
registerTaskHandler("position_monitor", async (database) => {
  const r = await monitorPositions(database);
  // 带消息面的持仓护航（有持仓才跑，节省 LLM 额度）：只产建议/告警，不自动下单。
  try { if ((database.positions || []).some((p) => Number(p.size ?? p.pos ?? 0) !== 0)) await escortPositions(database); } catch { /* 护航失败不阻断监控 */ }
  return r;
});
registerTaskHandler("accounting_refresh", (database) => refreshAccounting(database));
registerTaskHandler("agent_cycle", async (database) => {
  const run = await runAgentCycle(database, {}, saveDb);
  recheckActivePlanRisk(database);
  return run;
});
registerTaskHandler("reconcile", (database) => runReconciler(database, { mode: "scheduled" }));
// 观察哨哨兵:每分钟机械核对已登记的价格条件,命中即通过 agent_cycle 任务(同锁同风控)触发完整巡检。
registerTaskHandler("watch_sentinel", (database) => runWatchSentinel(database, saveDb));
registerTaskHandler("strategy_research", (database) => runStrategyResearch(database, {}));
registerTaskHandler("paper_forward", async (database) => {
  const paper = await runPaperForward(database);
  // 小额实盘验证模式:新编译的技能(如新导入书本产出的)自动上岗试用;syncLifecycle 里含转正/退役复盘。
  if (database.system.skillLiveValidationMode) promoteCompiledToProbation(database);
  const skills = syncKnowledgeSkillLifecycle(database);
  const trusted = refreshTrustedSkillMetrics(database); // 受信任导入 skill 复盘 + 差了自动撤信任
  return { ...paper, knowledgeSkills: skills, trustedSkills: trusted };
});
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
registerTaskHandler("payment_verify", async (database) => {
  const r = await verifyTrc20Payments(database);
  return { ...r, skipPersist: r.status === "skipped" || (r.status === "ok" && !r.checked) };
});
registerTaskHandler("outbox_dispatch", (database) => dispatchOutbox(database));
registerTaskHandler("audit_worm_ship", async (database) => {
  const r = await shipAuditToWorm(database);
  return { ...r, skipPersist: ["not_configured", "up_to_date"].includes(r.status) };
});
registerTaskHandler("oms_recovery", async (database) => {
  const r = await recoverUncertainOrders(database);
  return { ...r, skipPersist: !r.checked };
});
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
  const mandate = activeMandate(database);
  // 刷 BTC/ETH（默认展示）+ 授权交易对 + 自选列表——此前不含自选，自选里非授权币的
  // 买盘占比/微观结构永远"未同步"。
  const symbols = [...new Set(["BTC/USDT", "ETH/USDT", ...(mandate?.allowedSymbols || []), ...(database.watchlist || [])])].slice(0, 6);
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
  // 全市场异动扫描 + 重大异动消息面归因（环境感知，注入决策上下文）。
  try { await refreshMarketMovers(database, {}); } catch { /* 异动扫描失败不阻断 */ }
  // 知识技能声明的非默认周期（4h/1d 等）也要有 K 线，否则技能信号永远无法评估。
  try {
    const skillTfs = [...new Set((database.knowledge?.tradingSkills || [])
      .filter((s) => ["active", "paper_validating", "paper_validated"].includes(s.status))
      .map((s) => s.spec?.timeframe)
      .filter((tf) => tf && tf !== "1h"))].slice(0, 3);
    for (const tf of skillTfs) {
      for (const symbol of symbols.slice(0, 2)) {
        try { await syncPublicKlines(database, "OKX", symbol, tf, { sharedSlot: false }); } catch { /* 单周期失败不阻断 */ } // 只写 candlesByTf,不翻转共享 1h 槽
      }
    }
  } catch { /* 技能周期补拉失败不阻断 */ }
  return { status: "ok", synced };
});
ensureSystemTask(db, { id: "task_sys_okx_sync", name: "交易所余额同步", handler: "okx_readonly_sync", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_market_signal", name: "行情信号刷新", handler: "market_signal_refresh", schedule: "Every 2m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_execution_poll", name: "执行订单轮询", handler: "execution_poll", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_position_monitor", name: "持仓风险监控", handler: "position_monitor", schedule: "Every 2m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_accounting", name: "盈亏核算刷新", handler: "accounting_refresh", schedule: "Every 5m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_agent_cycle", name: "自主巡检决策", handler: "agent_cycle", schedule: "Every 15m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_watch_sentinel", name: "观察哨哨兵", handler: "watch_sentinel", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_reconcile", name: "账户对账", handler: "reconcile", schedule: "Every 10m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_strategy_research", name: "自适应策略研究", handler: "strategy_research", schedule: "Every 6h" }, saveDb);
ensureSystemTask(db, { id: "task_sys_paper_forward", name: "模拟盘前向验证", handler: "paper_forward", schedule: "Every 30m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_trade_reflection", name: "平仓自动复盘", handler: "trade_reflection", schedule: "Every 30m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_strategy_improvement", name: "策略改进闭环", handler: "strategy_improvement", schedule: "Every 6h" }, saveDb);
ensureSystemTask(db, { id: "task_sys_payment_verify", name: "TRC20 支付链上核验", handler: "payment_verify", schedule: "Every 2m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_outbox", name: "交易事件 Outbox 派发", handler: "outbox_dispatch", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_audit_worm", name: "审计日志 WORM 外送", handler: "audit_worm_ship", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_oms_recovery", name: "不确定订单恢复", handler: "oms_recovery", schedule: "Every 1m" }, saveDb);

startScheduler(db, saveDb);
// 接入 CoinGecko 官方免费 MCP(行业领先只读行情源),启动后台连接并自动放行只读工具;失败不阻断。
ensureCoingeckoMcp(db);
setTimeout(() => { connectMcpServer(db, "mcp_coingecko").then((r) => { if (r.status === "connected") saveDb(db); }).catch(() => {}); }, 8000);
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
    // OKX 张数必须乘合约面值 ctVal；面值未知时不重算，保留交易所快照的权威 upl（防止放大 100 倍）。
    const multiplier = p.contractMultiplier != null ? Number(p.contractMultiplier) : (p.exchange === "OKX" ? null : 1);
    p.mark = price;
    if (multiplier != null) {
      p.pnl = Number(((price - entry) * size * multiplier * (short ? -1 : 1)).toFixed(2));
      p.unrealizedPnl = p.pnl;
    }
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

app.post("/api/system/autonomy", (req, res) => {
  const requiredPermission = req.body.enabled === false ? "write:mandate" : "approve:live_config";
  if (!userHasPermission(db, req.user, requiredPermission)) {
    return res.status(403).json({ error: `Missing permission: ${requiredPermission}` });
  }
  db.system.autonomyEnabled = req.body.enabled !== false;
  db.system.riskStatus = db.system.killSwitch ? "熔断停机" : db.system.autonomyEnabled ? "正常" : "人工暂停";
  db.system.latestAction = db.system.autonomyEnabled
    ? db.system.killSwitch ? "AI 交易员保持熔断，仅恢复非交易观察" : "恢复 AI 交易员观察与计划"
    : "暂停 AI 交易员自动推进";
  db.system.updatedAt = nowIso();
  appendAudit(db, db.system.autonomyEnabled ? "恢复自动交易推进" : "暂停自动交易推进", "system.autonomy", req.user?.name || db.user.name, db.system.autonomyEnabled ? "info" : "warning");
  appendTrace(db, "system", db.system.latestAction, db.system.autonomyEnabled ? "ok" : "paused");
  persist(res, db.system);
});

app.get("/api/overview", (_req, res) => {
  // 实时计算 API 健康度（原来是固定种子值 "待配置"，配置后也不变，属显示 bug）。
  {
    const cfgStatus = getConfigStatus(db);
    const configured = (db.exchangeAccounts || []).some((a) => a.readEnabled) || cfgStatus?.exchange?.okx?.hasKey || cfgStatus?.exchange?.binance?.hasKey;
    // API 健康只反映系统/交易所连通性，不受风控告警影响——被风控挡下的计划是风控在正常工作，不是 API 故障。
    // 仅当实时连接已启动却全部断开时判为「连接异常」；风控事件在「风控状态」单独呈现。
    const rtStarted = Boolean(db.realtimeStarted) || (db.realtimeConnections || []).length > 0;
    const rtConnected = (db.realtimeConnections || []).some((c) => c.status === "connected");
    db.system.apiHealth = db.system?.killSwitch ? "熔断停机" : !configured ? "待配置" : (rtStarted && !rtConnected) ? "连接异常" : "正常";
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
    automationState: deriveAutomationState(db, { hasProvider: Boolean(activeProvider()) }),
    strategyBoard: buildStrategyBoard(db),
    agentStatus: getAgentStatus(db),
    agentProfiles: db.agentProfiles || [],
    portfolio: db.portfolio,
    markets: db.markets,
    watchlist: (db.watchlist && db.watchlist.length) ? db.watchlist : ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    activeMarket: db.markets.find((market) => market.status === "synced" || market.price) || db.markets[0],
    positions: db.positions,
    mandates: db.mandates,
    tradePlans: db.tradePlans,
    watchTriggers: (db.watchTriggers || []).slice(0, 20),
    events: db.events,
    tasks: db.tasks,
    // 蒸馏出的 chunk 正文/词频向量（导入 11 本书后达 ~1.4MB）客户端并不渲染，只用到条数；
    // 这里剥掉 chunk 重字段，overview 从 ~1.5MB 降到几十 KB，移动端才不会超时。RAG 检索在服务端做。
    knowledge: { ...db.knowledge, chunks: (db.knowledge.chunks || []).map((c) => ({ id: c.id, sourceId: c.sourceId })) },
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
    marketMovers: db.marketMovers ? { movers: (db.marketMovers.movers || []).slice(0, 12), scannedAt: db.marketMovers.scannedAt || db.marketMovers.updatedAt || null } : null,
    positionEscort: db.positionEscort || null,
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
    portfolioRisk: buildPortfolioRisk(db, activeMandate(db)),
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
    const symbol = activeMandate(db)?.allowedSymbols?.[0] || "BTC/USDT";
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

// 悬浮 AI 助手（只读 copilot）：只读账户/行情/知识回答问题，绝不下单/改配置/生成计划，
// 也不写入「AI 交易员」的会话历史（不建 chatMessage/agentRun）——与交易员职责彻底分开。
app.post("/api/assistant/chat", async (req, res) => {
  const question = String(req.body?.message || "").trim();
  if (!question) return res.status(400).json({ error: "问题不能为空" });
  try {
    refreshAccounting(db);
    const pf = db.portfolio || {};
    const sys = db.system || {};
    const positions = (db.positions || []).filter((p) => Number(p.size ?? p.pos ?? 0) !== 0);
    const awaiting = (db.tradePlans || []).filter((p) => ["awaiting_approval", "risk_checked", "draft"].includes(p.status)).length;
    const pending = (db.pendingActions || []).filter((a) => !a.status || a.status === "pending" || a.status === "awaiting_confirmation").length;
    const incidents = (db.riskIncidents || []).filter((i) => i.status === "open");
    const regime = db.marketRegime || {};
    const movers = (db.marketMovers?.movers || []).slice(0, 6).map((m) => `${m.symbol} ${m.changePct >= 0 ? "+" : ""}${m.changePct}%`).join("、");
    const ctx = [
      `账户：总资产 ${pf.totalEquityUsdt ?? "未同步"} USDT，今日盈亏 ${pf.todayPnl ?? "未同步"}，未实现 ${pf.unrealizedPnl ?? "未同步"}，持仓 ${positions.length} 个`,
      positions.length ? `持仓明细：${positions.map((p) => `${p.symbol} ${p.direction || ""} 浮盈 ${p.pnl ?? p.upl ?? "?"} ROI ${p.roiPct ?? "?"}%`).join("；")}` : "当前无持仓",
      `自主：${sys.killSwitch ? "已熔断" : sys.autonomyEnabled ? "自主运行中" : "已暂停"}，实盘写入 ${sys.liveTradingEnabled ? "开启" : "关闭"}`,
      `待办：待批准计划 ${awaiting}，待确认操作 ${pending}；未处理风险告警 ${incidents.length}${incidents[0] ? `（最新：${incidents[0].title || ""}）` : ""}`,
      regime.global || regime.smartMoney ? `大盘：${regime.global?.label || regime.global?.trend || "?"}${regime.smartMoney?.label ? ` · 聪明钱 ${regime.smartMoney.label}` : ""}` : "",
      movers ? `今日异动：${movers}` : ""
    ].filter(Boolean).join("\n");

    // 知识问答：轻量 RAG 召回相关片段做接地（服务端 chunk 有正文）。
    let knowledge = "";
    let citations = [];
    try {
      const bundle = await ragQuery(db, question, { topK: 4 });
      const refs = bundle.retrievedRefs || [];
      citations = refs.map((r) => r.citationLocator).filter(Boolean);
      const chunkById = new Map((db.knowledge?.chunks || []).map((c) => [c.id, c]));
      const snippets = refs.map((r) => { const c = chunkById.get(r.chunkId); return c ? `【${r.citationLocator}】${String(c.text || c.content || "").slice(0, 400)}` : null; }).filter(Boolean);
      if (snippets.length) knowledge = snippets.join("\n");
    } catch { /* 知识召回失败不阻断问答 */ }

    const system = "你是交易系统的【只读助手 copilot】。职责：帮用户理解账户状态、行情与知识库，做解读与建议。"
      + "你不能下单、撤单、改配置或生成交易计划——那是『AI 交易员』的职责；用户要执行交易/改授权时，引导他去主对话『AI 交易员』操作。"
      + "只依据下面给定的真实上下文与知识片段回答，不编造任何数字，不确定就说『未同步/未知』。用中文，简洁，可用 Markdown。";
    const prompt = `用户问题：${question}\n\n【系统只读上下文】\n${ctx}${knowledge ? `\n\n【相关知识片段】\n${knowledge}` : ""}`;
    let reply = null;
    try { reply = await llmComplete(prompt, system); } catch { reply = null; }
    appendTrace(db, "assistant_chat", question.slice(0, 60), reply ? "ok" : "warning", 0);
    res.json({ reply: reply || "助手暂时不可用（未配置模型或调用失败）。你可以先用上方的『总结状态 / 今日异动 / 持仓护航 / 待办』查看真实数据。", citations, llm: Boolean(reply) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
// 服务端→OKX REST 拉一次 ~4s，移动端易超时；这里加 10s 内存缓存，重复请求即时返回。
const klineCache = new Map(); // key -> { at, payload }
// 纯公开 OKX K 线（无账户数据）：保持免鉴权——前端图表 fetch 不带 Authorization 头。
app.get("/api/market/klines", async (req, res) => {
  try {
    const symbol = normalizeSymbol(String(req.query.symbol || "BTC/USDT"));
    if (!symbol) return res.status(400).json({ error: "无效的交易对", candles: [] });
    const tf = String(req.query.tf || "1h");
    if (!["5m", "15m", "1h", "4h", "1d"].includes(tf)) return res.status(400).json({ error: "无效的 K 线周期", candles: [] });
    const requestedLimit = Number(req.query.limit || 200);
    const limit = Number.isFinite(requestedLimit) ? Math.max(20, Math.min(requestedLimit, 500)) : 200;
    const key = `${symbol}|${tf}|${limit}`;
    const hit = klineCache.get(key);
    if (hit && Date.now() - hit.at < 10000) { res.json(hit.payload); return; }
    const candles = await getHistoricalKlines(symbol, tf, limit);
    const payload = { symbol, tf, candles: candles || [] };
    if (candles && candles.length) {
      klineCache.set(key, { at: Date.now(), payload });
      while (klineCache.size > 100) klineCache.delete(klineCache.keys().next().value);
    }
    res.json(payload);
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

// 实时行情 SSE：匿名端点只能发送公有市场字段。
// 组合/持仓广播也共用内部 listener，因此必须在边界显式过滤，防止账户数据泄露。
// 鉴权流票据：EventSource 无法携带 Authorization 头。登录后先领短票，再以 ?ticket= 连流。
// 票据只授权“读取实时流”（不是会话令牌，泄漏面远小于 token）；有效期内可复用，
// 浏览器断线自动重连沿用同一 URL 也能续上。匿名连接仍只收公开行情白名单字段。
const streamTickets = new Map(); // ticket -> { userId, expiresAt }
const STREAM_TICKET_TTL_MS = 12 * 3600 * 1000;
app.post("/api/stream/ticket", (req, res) => {
  if (authRequired() && !req.user) return res.status(401).json({ error: "Authentication required" });
  for (const [t, info] of streamTickets) if (info.expiresAt <= Date.now()) streamTickets.delete(t); // 顺带清理过期票
  const ticket = crypto.randomBytes(24).toString("hex");
  streamTickets.set(ticket, { userId: req.user?.id || db.user?.id || "owner", expiresAt: Date.now() + STREAM_TICKET_TTL_MS });
  res.json({ ticket, expiresInMs: STREAM_TICKET_TTL_MS });
});

app.get("/api/stream", (req, res) => {
  const ticketInfo = req.query.ticket ? streamTickets.get(String(req.query.ticket)) : null;
  const authenticated = !authRequired() || Boolean(ticketInfo && ticketInfo.expiresAt > Date.now());
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 3000\n\n");
  const send = (update) => {
    // 匿名连接只放行公开行情；持有效票据的连接可收 portfolio/knowledge_updated 等本人数据。
    if (!authenticated && !isPublicMarketStreamUpdate(update)) return;
    try { res.write(`data: ${JSON.stringify(update)}\n\n`); } catch { /* noop */ }
  };
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
    version: 1,
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
  Object.assign(mandate, req.body, { version: Number(mandate.version || 1) + 1, updatedAt: nowIso() });
  appendAudit(db, `更新授权状态：${req.body.status || "updated"}`, mandate.id, db.user.name);
  persist(res, mandate);
});

app.post("/api/mandates/:id/activate", requirePermission("write:mandate"), (req, res) => {
  const mandate = activateMandate(db, req.params.id);
  if (!mandate) return res.status(404).json({ error: "Mandate not found" });
  // 激活不抬版本(P0):版本语义=内容变更(PATCH 时 +1)。此前激活即 +1,
  // 激活前提出的计划立刻全部"版本过期"被风控拒——标准主流程直接跑不通。
  mandate.version = Number(mandate.version || 1);
  persist(res, mandate);
});

app.post("/api/mandates/:id/pause", requirePermission("write:mandate"), (req, res) => {
  const mandate = db.mandates.find((item) => item.id === req.params.id);
  if (!mandate) return res.status(404).json({ error: "Mandate not found" });
  mandate.status = "paused";
  mandate.version = Number(mandate.version || 1) + 1;
  mandate.pausedAt = nowIso();
  appendAudit(db, "暂停授权委托", mandate.id, db.user.name, "warning");
  persist(res, mandate);
});

app.post("/api/mandates/:id/revoke", requirePermission("write:mandate"), (req, res) => {
  const mandate = db.mandates.find((item) => item.id === req.params.id);
  if (!mandate) return res.status(404).json({ error: "Mandate not found" });
  mandate.status = "revoked";
  mandate.version = Number(mandate.version || 1) + 1;
  mandate.revokedAt = nowIso();
  appendAudit(db, "撤销授权委托", mandate.id, db.user.name, "warning");
  persist(res, mandate);
});

// 观察哨：主人手动撤销（登记/自动撤销走 AI 工具与哨兵，均带审计）
app.post("/api/watch-triggers/:id/cancel", requirePermission("write:mandate"), (req, res) => {
  const result = cancelWatch(db, req.params.id, db.user?.name || "Owner", String(req.body?.reason || "主人手动撤销"));
  if (!result.ok) return res.status(404).json({ error: result.error });
  persist(res, { message: `已撤销观察哨：${req.params.id}`, watch: result.watch });
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

app.post("/api/knowledge/import-real", requirePermission("write:knowledge"), handleKnowledgeImport);

app.post("/api/knowledge/github-import", requirePermission("write:knowledge"), async (req, res) => {
  try {
    const result = await importGithubKnowledge(db, req.body.repoUrl, req.body.subPath || "");
    persist(res, { ...result, message: result.message || `已导入 GitHub 知识：${req.body.repoUrl}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
  const retiredSkills = retireSkillsForSource(db, sid, db.user.name, "knowledge_source_deleted");
  db.knowledge.sources = db.knowledge.sources.filter((item) => item.id !== sid);
  db.knowledge.documentNodes = (db.knowledge.documentNodes || []).filter((node) => node.sourceId !== sid);
  db.knowledge.chunks = (db.knowledge.chunks || []).filter((chunk) => chunk.sourceId !== sid);
  db.knowledge.conceptCards = (db.knowledge.conceptCards || []).filter((concept) => !concept.sourceRefs?.includes(sid));
  db.knowledge.tradingMethods = (db.knowledge.tradingMethods || []).filter((method) => method.source?.id !== sid && method.sourceId !== sid);
  // 已批准纪律是注入 AI 提示词的硬闸(审计 P2):删来源不得静默撤掉;多来源合并规则只摘引用。
  db.knowledge.ruleProposals = (db.knowledge.ruleProposals || []).filter((rule) => {
    if (rule.status === "已批准" || !rule.sourceRefs?.includes(sid)) return true;
    if (rule.sourceRefs.length > 1) { rule.sourceRefs = rule.sourceRefs.filter((x) => x !== sid); return true; }
    return false;
  });
  db.knowledge.theoryFrameworks = (db.knowledge.theoryFrameworks || []).filter((fw) => !fw.sourceRefs?.includes(sid));
  appendAudit(db, "删除知识来源", sid, "Curator");
  appendTrace(db, "knowledge_delete", `删除知识来源 ${source.title}`);
  persist(res, { removed: sid, retiredSkills });
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

app.get("/api/knowledge/skills", (_req, res) => {
  // knowledgeSkillSummary 内部会做生命周期同步（paper_validated/degraded 转移+归因），
  // 这些状态变更必须落盘——否则重启即丢，且与 POST 路由一律 persist 的约定不一致。
  const summary = knowledgeSkillSummary(db);
  saveDb(db);
  res.json(summary);
});

app.post("/api/knowledge/methods/:id/compile", requirePermission("write:knowledge"), (req, res) => {
  try {
    const skill = compileTradingMethod(db, req.params.id, req.body || {}, req.user?.name || db.user.name);
    persist(res, { skill });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/knowledge/skills/:id/validate", requirePermission("write:review"), async (req, res) => {
  try {
    const result = await validateKnowledgeSkill(db, req.params.id, req.body || {}, req.user?.name || db.user.name);
    persist(res, result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/knowledge/skills/:id/paper", requirePermission("write:review"), async (req, res) => {
  try {
    const result = await startKnowledgeSkillPaper(db, req.params.id, req.body || {}, req.user?.name || db.user.name);
    persist(res, result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/knowledge/skills/validate-all", requirePermission("write:review"), (req, res) => {
  const result = validateAllCompiledSkills(db, saveDb, req.user?.name || db.user.name);
  const message = result.started
    ? `已开始批量历史验证 ${result.total} 个技能(后台执行,数分钟内按门槛自动流转,完成后审计日志有汇总)`
    : result.reason === "already_running" ? "批量验证已在进行中" : "没有待历史验证的技能";
  res.json({ ...result, message });
});

app.post("/api/knowledge/skills/sync", requirePermission("write:review"), (req, res) => {
  persist(res, syncKnowledgeSkillLifecycle(db, req.user?.name || db.user.name));
});

app.post("/api/knowledge/skills/:id/approve", requirePermission("approve:knowledge_skill"), (req, res) => {
  try {
    const skill = approveKnowledgeSkill(db, req.params.id, req.user?.name || db.user.name, req.body.note);
    persist(res, { skill });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/knowledge/skills/:id/retire", requirePermission("approve:knowledge_skill"), (req, res) => {
  try {
    const skill = retireKnowledgeSkill(db, req.params.id, req.user?.name || db.user.name, req.body.reason);
    persist(res, { skill });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// 清理归档：删除"编译失败"和"已被替代"的技能（这些不参与任何决策，纯噪音）。
// 已退役(retired)默认保留(那是你主动退役的),除非显式 includeRetired。审计日志仍留有历史事件。
app.post("/api/knowledge/skills/purge-archived", requirePermission("approve:knowledge_skill"), (req, res) => {
  const includeRetired = req.body?.includeRetired === true;
  const junk = new Set(includeRetired ? ["compile_failed", "superseded", "retired"] : ["compile_failed", "superseded"]);
  const before = (db.knowledge?.tradingSkills || []).length;
  db.knowledge.tradingSkills = (db.knowledge.tradingSkills || []).filter((s) => !junk.has(s.status));
  const removed = before - db.knowledge.tradingSkills.length;
  appendAudit(db, `清理归档技能 ${removed} 个（${[...junk].join("/")}）`, "skills_purge", req.user?.name || db.user.name, "warning");
  persist(res, { ok: true, removed, message: `已清理 ${removed} 个归档技能` });
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
  const rule = {
    id: id("rule"),
    name: req.body.name || "新交易规则草案",
    description: String(req.body.description || ""), // (审计 H4)此前不读,用户写的依据全部丢失
    category: String(req.body.category || ""),
    condition: String(req.body.condition || ""),
    level: req.body.level || "L2",
    status: "待审批",
    action: req.body.action || "notify",
    sourceRefs: req.body.sourceRefs || [],
    createdAt: nowIso()
  };
  db.knowledge.ruleProposals.unshift(rule);
  appendAudit(db, "提交知识规则草案", rule.id, "Rule Compiler");
  persist(res, rule);
});

app.post("/api/knowledge/rules/:id/approve", requirePermission("approve:knowledge_skill"), (req, res) => {
  const rule = db.knowledge.ruleProposals.find((item) => item.id === req.params.id);
  if (!rule) return res.status(404).json({ error: "Rule not found" });
  rule.status = req.body.approved === false ? "已拒绝" : "已批准";
  rule.reviewedAt = nowIso();
  rule.reviewedBy = req.user?.name || db.user.name;
  let enforcementWarning = null;
  if (rule.status === "已批准") {
    const conditionSpec = rule.conditionSpec || compileNaturalRiskCondition(rule.condition);
    const conditionValidation = validateConditionSpec(conditionSpec);
    if (!conditionValidation.valid) {
      // 显式告知：这条规则编译不成结构化条件，只会作为提示注入提示词、不会被风控引擎硬拦截。
      // 否则运维会以为"配上了就在拦"，实际是静默放行。
      enforcementWarning = "该规则的自然语言条件无法编译为结构化拦截条件，批准后仅注入 AI 提示词作纪律提醒，不会被风控引擎硬性拦截；如需硬拦截请在规则库补充结构化条件（conditionSpec）。";
      appendAudit(db, `知识规则「${rule.name}」批准为仅提示（条件不可编译，无硬拦截）`, rule.id, "RiskCompiler", "warning");
    }
    db.riskRules.unshift({
      id: `risk_from_${rule.id}`,
      name: rule.name,
      scope: "knowledge",
      level: rule.level,
      enabled: true,
      action: rule.action,
      condition: rule.condition || "",
      conditionSpec: conditionValidation.valid ? conditionSpec : null,
      enforcementStatus: conditionValidation.valid ? "enforced" : "advisory_uncompiled",
      description: `来自专家知识库规则 ${rule.id}${conditionValidation.valid ? "" : "；自然语言条件尚未编译，当前仅作提示"}`
    });
  }
  appendAudit(db, `${rule.status}知识规则`, rule.id, req.user?.name || db.user.name);
  persist(res, { ...rule, enforcementWarning });
});

app.delete("/api/knowledge/rules/:id", requirePermission("write:knowledge"), (req, res) => {
  const before = (db.knowledge.ruleProposals || []).length;
  db.knowledge.ruleProposals = (db.knowledge.ruleProposals || []).filter((r) => r.id !== req.params.id);
  if ((db.knowledge.ruleProposals || []).length === before) return res.status(404).json({ error: "Rule not found" });
  db.riskRules = (db.riskRules || []).filter((r) => r.id !== `risk_from_${req.params.id}`);
  appendAudit(db, "删除知识规则草案", req.params.id, db.user.name);
  persist(res, { removed: 1 });
});

// 一键去重（智能合并）：把同类别下语义重复的待审批草案用 LLM 合并成精简规范集，
// 阈值冲突取更严格；已批准的一律保留。LLM 调用较慢（数十秒），先立即响应、后台执行，
// 前端 15s 轮询会自动刷新结果。无 LLM 时退回按名称精确去重。
app.post("/api/knowledge/rules/dedup", requirePermission("write:knowledge"), (_req, res) => {
  const pendingCount = (db.knowledge.ruleProposals || []).filter((r) => r.status !== "已批准").length;
  res.json({ message: "规则库去重进行中，稍后自动刷新", status: "processing", pending: pendingCount });
  consolidateRuleProposals(db)
    .then((r) => {
      if (r.method !== "llm") {
        // 无 LLM：退回按 类别+名称+依据 精确去重
        const norm = (s) => String(s || "").toLowerCase().replace(/[\s\p{P}]/gu, "");
        const seen = new Set(); const kept = []; const removedIds = [];
        for (const rule of db.knowledge.ruleProposals || []) {
          const key = `${norm(rule.category)}|${norm(rule.name)}|${norm(rule.description).slice(0, 40)}`;
          if (rule.status === "已批准" || !seen.has(key)) { seen.add(key); kept.push(rule); } else removedIds.push(rule.id);
        }
        db.knowledge.ruleProposals = kept;
      }
      saveDb(db);
      try { broadcastRaw({ type: "knowledge_updated", status: "rules_deduped" }); } catch { /* SSE 可选 */ }
    })
    .catch((err) => { appendAudit(db, `规则库去重失败：${err.message}`, "rule_dedup", "System", "warning"); });
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

// 一次性清空聊天历史：早期悬浮助手复用 /api/agent/chat 时把只读问答混进了交易员历史，
// 且无标记无法逐条区分。此端点清空全部对话(会话+消息+chat 来源的 agentRun)，
// 但不动交易计划/授权/审计/成交——那些是独立持久记录。仅 Owner 可用。
app.post("/api/agent/chat/reset", requirePermission("admin:system"), (req, res) => {
  const removedSessions = (db.chatSessions || []).length;
  const removedMessages = (db.chatMessages || []).length;
  db.chatSessions = [];
  db.chatMessages = [];
  db.agentRuns = (db.agentRuns || []).filter((r) => r.source !== "chat");
  appendAudit(db, `清空聊天历史（会话 ${removedSessions} · 消息 ${removedMessages}）`, "chat_reset", req.user?.name || "Owner", "warning");
  persist(res, { ok: true, removedSessions, removedMessages, message: `已清空 ${removedSessions} 个对话、${removedMessages} 条消息` });
});

app.post("/api/agent/chat", requirePermission("write:mandate"), async (req, res) => {
  try {
    const result = await runAgentChat(db, {
      message: req.body.message,
      sessionId: req.body.sessionId,
      tenantId: req.tenantId,
      userId: req.user?.id,
      userName: req.user?.name
    }, saveDb);
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
  const mandate = activeMandate(db);
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
    const knowledgeSkills = syncKnowledgeSkillLifecycle(db, db.user.name);
    persist(res, { ...result, knowledgeSkills });
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

app.post("/api/skills/:id/install", requirePermission("skill.install"), (req, res) => {
  try {
    const skill = installSkill(db, req.params.id, req.user?.name || db.user.name, {
      securityApproved: req.body.securityApproved === true
    });
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

app.delete("/api/skills/:id", requirePermission("write:skills"), (req, res) => {
  const idx = (db.skills || []).findIndex((item) => item.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: "Skill not found" });
  const [removed] = db.skills.splice(idx, 1);
  appendAudit(db, `删除 Skill「${removed.name}」`, removed.id, db.user?.name || "Owner", "warning");
  persist(res, { message: `已删除 Skill：${removed.name}`, id: removed.id });
});

// 信任导入 skill:把它的 SKILL.md 方法论注入 AI 决策提示词(不走 Docker 沙箱——本机无 Docker,
// 且 ClawHub/Claude skill 本就是"给 LLM 的方法说明书")。必须扫描通过 + 二次确认;进小额试用生命周期。
app.post("/api/skills/:id/trust", requirePermission("skill.install"), async (req, res) => {
  const skill = (db.skills || []).find((item) => item.id === req.params.id);
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  if (skill.native) return res.status(400).json({ error: "内置技能无需信任,直接启用即可" });
  if (!["通过", "需复核"].includes(skill.scan)) return res.status(400).json({ error: "必须先安全扫描通过才能信任" });
  const instructions = await readSkillInstructions(skill).catch(() => "");
  if (!instructions.trim()) return res.status(400).json({ error: "读不到该 skill 的方法论正文(SKILL.md),无法注入决策——请确认导入内容非空" });
  skill.instructions = instructions;
  skill.trusted = true;
  skill.trustedAt = nowIso();
  skill.trustedBy = db.user?.name || "Owner";
  skill.trustStatus = "live_probation";
  skill.status = "已启用";
  appendAudit(db, `信任导入 Skill（方法论注入 AI 决策，进小额试用）「${skill.name}」`, skill.id, db.user?.name || "Owner", "warning");
  persist(res, { message: `已信任「${skill.name}」，其方法论已注入 AI 决策；进入小额试用，按真实成绩转正/退役`, skill });
});

app.post("/api/skills/:id/untrust", requirePermission("write:skills"), (req, res) => {
  const skill = (db.skills || []).find((item) => item.id === req.params.id);
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  skill.trusted = false;
  skill.untrustedAt = nowIso();
  appendAudit(db, `撤销信任导入 Skill「${skill.name}」`, skill.id, db.user?.name || "Owner", "warning");
  persist(res, { message: `已撤销信任「${skill.name}」，已移出 AI 决策方法论`, skill });
});

app.get("/api/strategy-board", (_req, res) => res.json(buildStrategyBoard(db)));

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

app.get("/api/mcp", (_req, res) => res.json((db.mcpServers || []).map(({ apiKey, apiKeySecretName, headers, ...server }) => ({
  ...server,
  hasApiKey: Boolean(apiKeySecretName || apiKey)
}))));

app.post("/api/mcp", requirePermission("write:mcp"), (req, res) => {
  const serverId = id("mcp");
  const { apiKey, headers: _headers, ...safeBody } = req.body || {};
  const server = { id: serverId, status: "registered", toolCount: 0, tools: [], enabled: true, permissions: [], allowedTools: [], ...safeBody };
  if (apiKey) {
    const secretName = `MCP_${serverId}_API_KEY`;
    storeSecret(db, secretName, apiKey, "mcp");
    server.apiKeySecretName = secretName;
  }
  db.mcpServers.unshift(server);
  appendAudit(db, "注册 MCP Server", server.id, req.user?.name || db.user.name);
  const { apiKeySecretName, ...safeServer } = server;
  persist(res, { ...safeServer, hasApiKey: Boolean(apiKeySecretName) });
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
  const selectedMandate = req.body.mandateId
    ? db.mandates.find((item) => item.id === req.body.mandateId)
    : db.mandates[0];
  const plan = {
    id: id("plan"),
    mandateId: selectedMandate?.id,
    exchange: "BINANCE",
    marketType: "perpetual_usdt",
    strategy: "manual_review",
    status: "draft",
    ...req.body,
    mandateVersion: Number(selectedMandate?.version || 1),
    createdAt: nowIso()
  };
  const bundle = runExpertAnalysis(db, {
    trigger_type: "autonomous_trade_precheck",
    question: `${plan.symbol} ${plan.direction} 计划前置审查`,
    symbol: plan.symbol
  });
  plan.analysisBundleId = bundle.id;
  bindKnowledgeSkillsToPlan(db, plan, {
    timeframe: req.body.timeframe || "1h",
    regime: db.marketRegime?.regime || db.marketRegime?.label || ""
  }, db.user.name);
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

app.post("/api/trade-plans/:id/risk-check", requirePermission("risk.check"), (req, res) => {
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

app.post("/api/trade-plans/:id/approve", requirePermission("approve:trade_plan"), async (req, res) => {
  const plan = db.tradePlans.find((item) => item.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Trade plan not found" });
  // (P1-7)状态守卫:completed/cancelled 的计划此前可被再次批准并再次真实下单(幂等键随新执行单失效)。
  const APPROVABLE = new Set(["awaiting_approval", "risk_checked", "draft", "approved"]);
  const retryUnlock = plan.status === "protection_failed" && req.body?.retry === true;
  if (!APPROVABLE.has(plan.status) && !retryUnlock) {
    return res.status(400).json({ error: `计划状态 ${plan.status} 不可批准(终态计划禁止重复执行;protection_failed 需显式 retry)` });
  }
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
  plan.approvedBy = req.user?.name || db.user.name;
  appendAudit(db, "人工批准交易计划", plan.id, req.user?.name || db.user.name, "warning");
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
async function executePendingAction(db, record, actor = "Owner") {
  const a = record.args || {};
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
    // 激活必须走 activateMandate(单一激活不变量):此前直接赋值 status="active",
    // 旧 active 不被废弃 → 多 active 并存的老故障在对话确认路径复活。
    if (a.op === "activate") activateMandate(db, m.id);
    else if (a.op === "pause") m.status = "paused";
    else if (a.op === "revoke") m.status = "revoked";
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

app.post("/api/agent/actions/:id/confirm", async (req, res) => {
  const record = (db.pendingActions || []).find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ error: "待确认操作不存在" });
  if (record.status !== "awaiting_confirmation") return res.status(400).json({ error: "该操作已处理" });
  if (record.tenantId && record.tenantId !== (req.tenantId || "tenant_owner")) {
    return res.status(404).json({ error: "待确认操作不存在" });
  }
  const authorization = canConfirmPendingAction(db, req.user, record);
  if (!authorization.allowed) {
    return res.status(403).json({ error: `Missing permission: ${authorization.requiredPermission || "unknown_action"}` });
  }
  const actor = req.user?.name || "Unknown user";
  const result = await executePendingAction(db, record, actor);
  record.status = result.ok ? "executed" : "failed";
  record.result = result;
  record.resolvedByUserId = req.user?.id || null;
  record.resolvedBy = actor;
  record.resolvedAt = nowIso();
  persist(res, { action: record, result });
});

app.post("/api/agent/actions/:id/cancel", requirePermission("write:mandate"), (req, res) => {
  const record = (db.pendingActions || []).find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ error: "待确认操作不存在" });
  if (record.tenantId && record.tenantId !== (req.tenantId || "tenant_owner")) return res.status(404).json({ error: "待确认操作不存在" });
  if (record.status !== "awaiting_confirmation") return res.status(400).json({ error: "该操作已处理" });
  record.status = "cancelled";
  record.resolvedByUserId = req.user?.id || null;
  record.resolvedBy = req.user?.name || "Unknown user";
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

app.post("/api/accounting/refresh", requirePermission("risk.check"), (_req, res) => {
  persist(res, refreshAccounting(db));
});

app.post("/api/risk/check-trade-plan", requirePermission("risk.check"), (req, res) => {
  const plan = req.body.tradePlanId ? db.tradePlans.find((item) => item.id === req.body.tradePlanId) : req.body;
  if (!plan) return res.status(404).json({ error: "Trade plan not found" });
  const result = evaluateTradePlan(db, plan);
  result.tradePlanId = plan.id;
  result.createdAt = nowIso();
  db.riskChecks.unshift(result);
  persist(res, result);
});

app.post("/api/risk/kill-switch", async (req, res) => {
  const requiredPermission = req.body.enabled === false ? "risk.kill_switch" : "risk.check";
  if (!userHasPermission(db, req.user, requiredPermission)) {
    return res.status(403).json({ error: `Missing permission: ${requiredPermission}` });
  }
  db.system.killSwitch = Boolean(req.body.enabled);
  // (P1-6)开启熔断时暂停自主;解除熔断不强制重开(此前会覆盖用户手动暂停/日亏自动暂停)。
  if (db.system.killSwitch) db.system.autonomyEnabled = false;
  db.system.riskStatus = db.system.killSwitch ? "熔断停机" : "正常";
  if (db.system.killSwitch) {
    const cancellationResults = [];
    for (const executionOrder of db.executionOrders || []) {
      if (!["entry_pending", "entry_partial", "entry_filled", "protecting"].includes(executionOrder.status)) continue;
      const result = await closeExecution(db, executionOrder.id, "kill_switch");
      cancellationResults.push({
        executionOrderId: executionOrder.id,
        status: result.status,
        detail: result.result?.reason || result.result?.status || null
      });
    }
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
    if (cancelRequested.length || cancellationResults.length) {
      db.riskIncidents.unshift({
        id: id("incident"),
        severity: "critical",
        status: "open",
        title: "一键熔断触发撤单请求",
        source: "risk.kill_switch",
        affectedOrders: cancelRequested,
        cancellationResults,
        unconfirmed: cancellationResults.filter((item) => !["cancelled", "closed"].includes(item.status)),
        createdAt: nowIso()
      });
    }
    db.system.lastKillSwitchCancellation = {
      requested: cancellationResults.length,
      confirmed: cancellationResults.filter((item) => ["cancelled", "closed"].includes(item.status)).length,
      unconfirmed: cancellationResults.filter((item) => !["cancelled", "closed"].includes(item.status)).length,
      results: cancellationResults,
      checkedAt: nowIso()
    };
  }
  const killReason = String(req.body.reason || "").trim();
  appendAudit(db, `${db.system.killSwitch ? "启用一键熔断" : "解除一键熔断"}${killReason ? `：${killReason}` : ""}`, "risk.kill_switch", req.user?.name || db.user.name, db.system.killSwitch ? "critical" : "info");
  appendTrace(db, "risk", db.system.killSwitch ? "一键熔断开启" : "一键熔断解除", db.system.killSwitch ? "blocked" : "ok");
  await notifyLark(db, {
    severity: db.system.killSwitch ? "critical" : "info",
    title: db.system.killSwitch ? "🛑 一键熔断已触发" : "🟢 熔断已解除",
    body: `${db.system.killSwitch
      ? `所有新开仓已被阻断；风险降低动作确认 ${db.system.lastKillSwitchCancellation?.confirmed || 0} 笔，未确认 ${db.system.lastKillSwitchCancellation?.unconfirmed || 0} 笔。未确认项必须人工检查交易所。`
      : "熔断解除，系统恢复正常风控运行。"}${killReason ? `\n原因：${killReason}` : ""}`
  });
  persist(res, db.system);
});

app.get("/api/risk/status", (_req, res) => {
  res.json({ system: db.system, rules: db.riskRules, incidents: db.riskIncidents, checks: db.riskChecks.slice(0, 20) });
});

app.get("/api/risk/rules", (_req, res) => res.json(db.riskRules));
app.post("/api/risk/rules", requirePermission("write:risk"), (req, res) => {
  const conditionValidation = validateConditionSpec(req.body.conditionSpec);
  const action = req.body.action || "notify";
  if (action !== "notify" && !conditionValidation.valid) {
    return res.status(400).json({ error: `阻断型规则必须提供受支持的 conditionSpec：${conditionValidation.reason}` });
  }
  const rule = {
    id: id("risk"),
    name: req.body.name || "新风控规则",
    scope: req.body.scope || "trade",
    level: req.body.level || "L2",
    enabled: true,
    action,
    description: req.body.description || "",
    event: req.body.event || "",
    condition: req.body.condition || "",
    conditionSpec: conditionValidation.valid ? req.body.conditionSpec : null,
    enforcementStatus: conditionValidation.valid ? "enforced" : "advisory_uncompiled",
    createdAt: nowIso()
  };
  db.riskRules.unshift(rule);
  appendAudit(db, "创建风控规则", rule.id, req.user?.name || db.user.name);
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

app.get("/api/traces", requirePermission("trace.read"), (_req, res) => res.json(db.traces));
app.get("/api/audit-logs", requirePermission("audit.read"), (_req, res) => res.json(db.auditLogs));
app.get("/api/audit-logs/export", requirePermission("audit.export"), (req, res) => {
  const format = req.query.format === "csv" ? "csv" : "json";
  res.type(format === "csv" ? "text/csv" : "application/json").send(exportAuditLogs(db, format));
});
app.get("/api/traces/export", requirePermission("audit.export"), (req, res) => {
  const format = req.query.format === "csv" ? "csv" : "json";
  res.type(format === "csv" ? "text/csv" : "application/json").send(exportTraces(db, format));
});

app.listen(port, host, () => {
  console.log(`AI Trading Agent API listening on http://${host}:${port}`);
});
