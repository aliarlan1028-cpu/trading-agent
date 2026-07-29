import cors from "cors";
import crypto from "node:crypto";
import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performanceReport, refreshAccounting } from "./accounting.mjs";
import { applyStoredConfigToEnv, clearSecret, getConfigStatus, setConfig } from "./runtimeConfig.mjs";
import { activeProvider, runAgentChat, llmComplete, listAgentTools } from "./agentChat.mjs";
import { WEIGHTS as DECISION_WEIGHTS, THRESHOLDS as DECISION_THRESHOLDS, DEFAULTS as DECISION_DEFAULTS } from "./deterministicDecision.mjs";
import { addMemoryItem, recheckActivePlanRisk, runAgentCycle, updateStateFile } from "./agentRuntime.mjs";
import { cancelWatch, runWatchSentinel } from "./watchSentinel.mjs";
import { closeExecution, executeApprovedPlan, pollExecutionOrders } from "./executionEngine.mjs";
import { monitorPositions } from "./positionManager.mjs";
import { activateMandate, changeAgentRunStatus, expireStalePlans, getAgentStatus, parseMandateCommand, runAgentCommand } from "./agentOrchestrator.mjs";
import { validateRuntimeConfig } from "./schema.mjs";
import { registerAllRoutes } from "./routes/index.mjs";
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
import { buildProfessionalSnapshot } from "./professionalAnalytics.mjs";
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
  advanceSkillsThroughPaperLane,
  resetProbationSkillsToPaperLane,
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
// 模拟前向为主(主人选择):编译好的技能走「历史 OOS 预筛 → 纯前向模拟盘 → 已验证(模拟)」这条链,
// 用真实行情前向验证,而不是等那个几乎不产生成交的小账户——破解"零真实成交→零归因→永不采纳"的死锁。
db.system.skillPaperForwardMode ??= true;
// 专业风险闸(运营降级只减仓/流动性冲击/组合波动/强平距离)默认关:开启前它是"信息展示",
// 不硬拦交易、不自动只减仓;等数据管道(连续流+定时对账)达标再由主人显式开启来强制执行。
db.system.professionalRiskMode ??= false;
db.system.skillLiveValidationMode = false;
// 一次性迁移:关掉旧的"小额实盘验证=一把全扫进 live_probation"短路模式,并把因此死锁在
// live_probation、且没有任何真实(非模拟)成交归因的技能退回 compiled,重新进入模拟前向车道。
if (!db.meta.skillPaperForwardMigration) {
  db.system.skillLiveValidationMode = false;
  db.system.skillPaperForwardMode = true;
  try { resetProbationSkillsToPaperLane(db); } catch (error) { appendTrace(db, "system", `模拟前向迁移失败:${String(error.message || error).slice(0, 120)}`, "warning"); }
  db.meta.skillPaperForwardMigration = 1;
}
if (db.system.skillLiveValidationMode) {
  try { promoteCompiledToProbation(db); } catch (error) { appendTrace(db, "system", `技能上岗试用失败:${String(error.message || error).slice(0, 120)}`, "warning"); }
}
// 一次性清运营数据(用户要求:清掉旧交易痕迹,不让旧代码/旧数据污染新系统)。
// 保留:知识库(11本书)、技能流水线、系统配置、API密钥、风控规则、授权委托、Agent长期记忆、
// 系统任务/事件源。清:所有交易/执行/分析/对话/巡检痕迹。bump 版本号可再触发一次。
const OPERATIONAL_WIPE_VERSION = 1;
if ((db.meta.operationalWipeVersion || 0) < OPERATIONAL_WIPE_VERSION) {
  const wipeColls = [
    "tradePlans", "orders", "executionOrders", "exchangeOrders", "fills", "positions",
    "accountSnapshots", "agentRuns", "chatMessages", "chatSessions", "watchTriggers",
    "tradeIntents", "reconciliationReports", "riskChecks", "riskIncidents", "alerts",
    "drillRuns", "llmRuns", "toolExecutions", "skillRuns", "analysisBundles",
    "reviewReports", "strategyExperiments", "agentSteps", "agentToolCalls", "eventImpacts",
    "pendingActions", "positionMonitors", "notifications", "jobRuns"
  ];
  let cleared = 0;
  for (const c of wipeColls) { if (Array.isArray(db[c]) && db[c].length) { cleared += db[c].length; db[c] = []; } }
  // 组合权益归零:旧的成交/持仓已清,下次同步会从交易所拉真实值,避免残留旧数字。
  if (db.portfolio) { db.portfolio.totalEquityUsdt = null; db.portfolio.todayPnl = null; db.portfolio.unrealizedPnl = null; }
  db.system.remainingDailyLossUsdt = null;
  db.meta.operationalWipeVersion = OPERATIONAL_WIPE_VERSION;
  appendAudit(db, `一次性清空运营数据(${cleared} 条),保留知识库/技能/配置/密钥/风控规则/授权/记忆`, "operational_wipe", "System", "warning");
  appendTrace(db, "system", `运营数据已清空(${cleared} 条),系统进入干净状态`, "warning");
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
  // 模拟前向为主:把 compiled 技能推过历史 OOS → 起纯前向模拟盘;runPaperForward 步进、
  // syncKnowledgeSkillLifecycle 判 passed/failed → paper_validated/paper_rejected。
  if (database.system.skillPaperForwardMode !== false) {
    try { await advanceSkillsThroughPaperLane(database, saveDb); }
    catch (error) { appendTrace(database, "system", `模拟前向驱动失败:${String(error.message || error).slice(0, 120)}`, "warning"); }
  } else if (database.system.skillLiveValidationMode) {
    promoteCompiledToProbation(database);
  }
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

// system 路由组(readiness/backup/reset-operational-data/autonomy)已迁至 server/routes/system.mjs
// admin 用户/订阅/密码 + auth/change-password 路由组已迁至 server/routes/adminUsers.mjs
// payments(TRC20) 路由组已迁至 server/routes/payments.mjs

app.get("/api/overview", (_req, res) => {
  // 陈旧计划自动作废:隔夜/超期未成交的计划置为 expired,让"当前计划卡"与"暂无待处理计划"口径一致。
  if (expireStalePlans(db).length) saveDb(db);
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
    professional: buildProfessionalSnapshot(db),
    larkConfigured: larkStatus().configured,
    telegramConfigured: telegramStatus().configured,
    mcpStatus: mcpStatus(db),
    embeddingStatus: embeddingStatus(db),
    reviewAnalytics: buildReviewAnalytics(db),
    runtimeConfig: db.runtimeConfig || {},
    config: getConfigStatus(db),
    readiness: buildReadinessReport(db),
    // 分析透明度:如实汇总"当前真正在决策里起作用"的引擎配置(权重/阈值/兜底默认/SRTL 门槛/LLM/工具目录)。
    // 动态信号(regime/聪明钱/异动/技能)前端直接用上面已有字段,这里只补静态但真实的引擎常量。
    analysisEngine: {
      weights: DECISION_WEIGHTS,
      thresholds: DECISION_THRESHOLDS,
      defaults: DECISION_DEFAULTS,
      srtlMinR: Number(activeMandate(db)?.minRewardRisk ?? process.env.SRTL_MIN_R ?? 2.0),
      llmModel: process.env.DEEPSEEK_MODEL || db.runtimeConfig?.DEEPSEEK_MODEL || null,
      tools: listAgentTools()
    }
  });
});

// market/regime · market/instruments 路由已迁至 server/routes/market.mjs

// 悬浮 AI 助手：把系统里的账户/自主状态/今日活动/待办/风险汇成一段可读总结。
// assistant 路由组(状态总结 + 只读 copilot 问答)已迁至 server/routes/assistant.mjs

// 关注列表：独立于授权白名单的自选币对（从 OKX 永续合约里增删）。
function normalizeSymbol(raw) {
  const s = String(raw || "").trim().toUpperCase().replace(/-SWAP$/i, "").replace(/-/g, "/");
  if (!/^[A-Z0-9]+\/[A-Z0-9]+$/.test(s)) return null;
  return s;
}
// watchlist 路由已迁至 server/routes/observability.mjs（见文件末尾 registerObservabilityRoutes）

// 公有 K 线（给自绘图表用真实 OKX 数据）。公开数据，走鉴权白名单。
// market/klines · market/token-profile 路由已迁至 server/routes/market.mjs（klineCache 亦移入该模块）

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

// markets/positions/orders/fills 路由已迁至 server/routes/tradingData.mjs
// mandates 路由组已迁至 server/routes/mandates.mjs（见文件末尾 registerMandateRoutes）

// 观察哨：主人手动撤销（登记/自动撤销走 AI 工具与哨兵，均带审计）
app.post("/api/watch-triggers/:id/cancel", requirePermission("write:mandate"), (req, res) => {
  const result = cancelWatch(db, req.params.id, db.user?.name || "Owner", String(req.body?.reason || "主人手动撤销"));
  if (!result.ok) return res.status(404).json({ error: result.error });
  persist(res, { message: `已撤销观察哨：${req.params.id}`, watch: result.watch });
});

// events / tasks(含 job-runs) 路由组已迁至 server/routes/events.mjs 与 server/routes/tasks.mjs

// knowledge 导入/RAG 路由已迁至 server/routes/knowledgeImport.mjs

// knowledge 技能流水线路由已迁至 server/routes/knowledgeSkills.mjs

// knowledge 概念/框架/规则路由已迁至 server/routes/knowledgeRules.mjs

// agent 对话路由(chat/sessions/reset/command)已迁至 server/routes/agentChatRoutes.mjs
// agent 运行/状态/画像/记忆/runs 路由已迁至 server/routes/agentRuns.mjs

// exchange klines/microstructure 路由已迁至 server/routes/exchange.mjs

// backtests/strategies/portfolio-risk/backtest-run 路由已迁至 server/routes/tradingData.mjs
// paper 模拟盘路由组已迁至 server/routes/paper.mjs
// strategy 路由组(profiles/research/board)已迁至 server/routes/strategy.mjs

// notifications 路由组已迁至 server/routes/notifications.mjs

// agent command/memory/runs 路由已迁至 server/routes/agentChatRoutes.mjs 与 agentRuns.mjs

// skills 路由组(列表/导入/拉取/扫描/安装/停用/删除/信任/撤信任/回滚/沙箱)已迁至 server/routes/skills.mjs

// mcp 路由组已迁至 server/routes/mcp.mjs

// exchange accounts/api-key/reconcile/sync/ticker/private-action 路由已迁至 server/routes/exchange.mjs

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

// realtime status/start/stop 路由已迁至 server/routes/realtime.mjs

// reconciler 路由已迁至 server/routes/observability.mjs

// trade-plans 路由组已迁至 server/routes/tradePlans.mjs（agent/actions 确认路由与
// executePendingAction 因与对话确认强耦合，仍留在本文件）

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

// trade-plans cancel/execute 路由已迁至 server/routes/tradePlans.mjs

// execution-orders 路由已迁至 server/routes/executionOrders.mjs
// performance / accounting/refresh 路由已迁至 server/routes/tradingData.mjs

// risk 路由组(计划校验/熔断/状态/规则/灰度/只减仓/事件收尾)已迁至 server/routes/risk.mjs

// event-sources 路由组已迁至 server/routes/eventSources.mjs

// security & config 路由组（vault/交易所凭证/LLM 配置/实盘开关/密钥删除/告警/演练/审计链）
// 已迁至 server/routes/securityConfig.mjs（见文件末尾 registerSecurityConfigRoutes）

// reviews / review 路由组已迁至 server/routes/review.mjs
// traces / audit-logs 路由已迁至 server/routes/observability.mjs

// —— 已按 registrar 范式抽出的所有路由组，统一在此一处注册（ctx 为各组依赖并集）——
registerAllRoutes(app, {
  db, saveDb, persist, requirePermission,
  normalizeSymbol, runReconciler, exportTraces, exportAuditLogs, schedulerStatus, startScheduler,
  parseMandateCommand, activateMandate, id, nowIso, appendAudit, appendTrace,
  rankEvents, scheduleTask, runTask,
  larkStatus, telegramStatus, notifyLark, sendTelegramPositionPoster,
  buildPaperReport, createPaperSession, ensurePaperSessionsFromProfiles, runPaperForward, syncKnowledgeSkillLifecycle,
  storeSecret, connectMcpServer, refreshEventSources, refreshOnchainSignals,
  listVaultItems, clearSecret, refreshApiKeyMetadata, syncPrivateReadOnly, startRealtimeManager,
  getConfigStatus, validateRuntimeConfig, setConfig, sendAlert, runSafetyDrill, verifyAuditChain,
  addMonthsIso, verifyTrc20Payments, activateSubscriptionFromPayment,
  activeStrategyProfiles, runStrategyResearch, buildStrategyBoard,
  buildReviewAnalytics, backfillReviewFields, createStrategyImprovementCycle,
  hashPassword, verifyPassword, sanitizeUserRecord, invalidateSessions,
  syncPublicKlines, syncMicrostructure, reconcileAccount, syncPrivateReadOnly, syncPublicMarket, guardedPrivateExchangeAction,
  evaluateTradePlan, userHasPermission, closeExecution, notifyLark, validateConditionSpec,
  runExpertAnalysis, bindKnowledgeSkillsToPlan, executeApprovedPlan, describeGuardReason, executeTradePlan,
  fetchSkillPackage, scanSkill, installSkill, readSkillInstructions, runSkillSandbox,
  fetchMarketRegime, fetchPerpetualInstruments, getHistoricalKlines, fetchTokenProfile,
  listStrategies, buildPortfolioRisk, runBacktest, performanceReport, refreshAccounting,
  realtimeStatus, stopRealtimeManager, pollExecutionOrders, activeMandate,
  handleKnowledgeImport, importGithubKnowledge, parseKnowledgeRealSource, retireSkillsForSource, ragQuery, embeddingStatus, reembedAllChunks,
  knowledgeSkillSummary, compileTradingMethod, validateKnowledgeSkill, startKnowledgeSkillPaper, validateAllCompiledSkills, approveKnowledgeSkill, retireKnowledgeSkill,
  compileNaturalRiskCondition, consolidateRuleProposals, broadcastRaw,
  activeProvider, runAgentChat, runAgentCommand, updateStateFile, getAgentStatus, addMemoryItem, changeAgentRunStatus, runAgentCycle,
  buildReadinessReport, createSystemBackup, resetOperationalData, getStorageInfo, userHasPermission, llmComplete
});

app.listen(port, host, () => {
  console.log(`AI Trading Agent API listening on http://${host}:${port}`);
});
