import cors from "cors";
import dotenv from "dotenv";
import "express-async-errors";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performanceReport, refreshAccounting, refreshAccountingAuthoritatively } from "./accounting.mjs";
import { applyStoredConfigToEnv, clearSecret, getConfigStatus, setConfig } from "./runtimeConfig.mjs";
import { normalizePositionsForUi } from "./positionView.mjs";
import { computeBehaviorProfile } from "./behaviorProfile.mjs";
import { activeProvider, runAgentChat, llmComplete, listAgentTools } from "./agentChat.mjs";
import { WEIGHTS as DECISION_WEIGHTS, THRESHOLDS as DECISION_THRESHOLDS, DEFAULTS as DECISION_DEFAULTS } from "./deterministicDecision.mjs";
import { addMemoryItem, approveStateFile, recheckActivePlanRisk, runAgentCycle, updateStateFile } from "./agentRuntime.mjs";
import { buildWatchBoard, cancelWatch, presentWatch, publishWatchSweep, requestPendingAgentCycle, runWatchSentinel, sentinelGate, sweepWatches } from "./watchSentinel.mjs";
import { cancelArmedSetup, processArmedSetupTick, reconcileArmedSetupDefinitions, reconcileArmedSetupExecutions, recoverTriggeredSetups } from "./armedSetup.mjs";
import { abnormalVolatilityBoard, opportunityEngineStatus, recordOpportunityTick, runBroadOpportunityScan } from "./earlyOpportunityEngine.mjs";
import { closeExecution, executeApprovedPlan, pollExecutionOrders } from "./executionEngine.mjs";
import { monitorPositions } from "./positionManager.mjs";
import { activateMandate, changeAgentRunStatus, expireStalePlans, getAgentStatus, parseMandateCommand, runAgentCommand } from "./agentOrchestrator.mjs";
import { validateRuntimeConfig } from "./schema.mjs";
import { registerAllRoutes } from "./routes/index.mjs";
import { transportSecurityPolicy, TRUSTED_REVERSE_PROXY_RANGES } from "./transportSecurity.mjs";
import { compareOverviewShadowFacts, overviewShadowFacts } from "./overviewShadow.mjs";
import { authRequired, hashPassword, installAuth, invalidateSessions, invalidateUserSessions, requirePermission, resolvePermissions, verifyPassword } from "./auth.mjs";
import { consumeStreamTicket, issueStreamTicket, STREAM_TICKET_TTL_MS } from "./streamTickets.mjs";
import { resolveTenantEntitlement } from "./entitlements.mjs";
import { canConfirmPendingAction, userHasPermission } from "./actionAuthorization.mjs";
import { approveTradePlan, validateApprovalSnapshot } from "./tradePlanLifecycle.mjs";
import { systemAgentInvocation } from "./agentInvocation.mjs";
import { exportAuditLogs, exportTraces } from "./auditExport.mjs";
import { executeTradePlan } from "./executor.mjs";
import { getHistoricalKlines, guardedPrivateExchangeAction, invalidateOkxCredentialCaches, reconcileAccount, refreshApiKeyMetadata, syncMicrostructure, syncPrivateReadOnly, syncPublicKlines, syncPublicMarket, validateOkxCredentialCandidate } from "./exchangeConnector.mjs";
import { fetchMarketRegime, fetchPerpetualInstruments, fetchPerpetualInstrumentCatalog } from "./marketSignals.mjs";
import { backfillMediumTermPriceHistory, buildMediumTermAnalytics, captureEventVolatilityObservations, mediumTermPriceHistoryReady, mediumTermSymbolsForCollection } from "./mediumTermAnalytics.mjs";
import { refreshMarketSignalSymbol } from "./marketSignalRefresh.mjs";
import { escortPositions, refreshMarketMovers } from "./marketScan.mjs";
import { fetchTokenProfile } from "./tokenProfile.mjs";
import { startMarketStream, stopMarketStream, addStreamListener, removeStreamListener, marketStreamStatus, setMarketTickHook, broadcastRaw } from "./marketStream.mjs";
import { runBacktest } from "./backtestEngine.mjs";
import { strategyDraftsReferencedByChat, strategyStudioSnapshot } from "./strategyStudio.mjs";
import { activeStrategyProfiles, runStrategyResearch } from "./strategyOptimizer.mjs";
import { buildBacktestResearch } from "./strategyResearchView.mjs";
import { compactOverviewForNative, projectOverviewSection } from "./overviewView.mjs";
import { buildCoreOverview } from "./coreOverview.mjs";
import { projectSystemOverviewTradeHistory } from "./overviewTradeHistory.mjs";
import { httpPerformanceSnapshot, recordHttpPerformance, recordStartupPhase, recordStartupReady } from "./performanceMetrics.mjs";
import { currentUiRevision, uiSyncEvent } from "./uiSync.mjs";
import { listStrategies, STRATEGIES } from "./strategies.mjs";
import { buildStrategyCatalog } from "./strategyContracts.mjs";
import { buildPortfolioRisk } from "./portfolioRisk.mjs";
import { applyOperationalDegradation } from "./professionalRiskGate.mjs";
import { refreshMarketContextResearch } from "./marketContextResearch.mjs";
import { buildProfessionalSnapshot } from "./professionalAnalytics.mjs";
import { buildDecisionCalibrationReport } from "./decisionCalibration.mjs";
import { buildPaperReport, createPaperSession, ensurePaperSessionsFromProfiles, runPaperForward, startOwnerCandidatePaperSession } from "./paperTrading.mjs";
import { larkStatus, notifyLark } from "./larkNotifier.mjs";
import { processClosedTradeProfitPosters, sendTelegramPositionPoster, telegramStatus } from "./telegramNotifier.mjs";
import { dispatchTelegramWatchOutbox, queueWatchTelegramEvent, retireTelegramWatchDigest, telegramWatchDeliveryHealth, telegramWatchStatus } from "./telegramWatchNotifier.mjs";
import { ensureDefaultEventSources, rankEvents, refreshEventSources, refreshOnchainSignals, runAgentMission, testEventSource } from "./eventSources.mjs";
import { buildDailyBrief, refreshMarketIntelligence, removeLegacyPaidFlowData, sourceHealthSummary } from "./marketIntelligence.mjs";
import { refreshMeNewsFlash } from "./newsFlashFeed.mjs";
import { prepareScheduledEventMilestones } from "./scheduledEvents.mjs";
import { toolUsageView } from "./toolUsage.mjs";
import { consolidateRuleProposals, embeddingStatus, importGithubKnowledge, importKnowledge as importKnowledgeReal, parseKnowledgeSource as parseKnowledgeRealSource, ragQuery, reembedAllChunks, removeManagedKnowledgeFile } from "./knowledgePipeline.mjs";
import { runExpertAnalysis } from "./knowledgeEngine.mjs";
import {
  approveKnowledgeSkill,
  bindKnowledgeSkillsToPlan,
  compileTradingMethod,
  ensureCuratedSkills,
  ensureTurtleStrategy,
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
import { buildLivenessReport, buildReadinessReport, createSystemBackup, deriveAutomationState } from "./ops.mjs";
import { visibleNotificationsForUser } from "./notificationStore.mjs";
import { buildStrategyBoard, refreshTrustedSkillMetrics } from "./strategyBoard.mjs";
import { runReconciler } from "./reconciler.mjs";
import { backfillReviewFields, buildReviewAnalytics, createStrategyImprovementCycle, runTradeReflection, validateStrategyImprovementCycle } from "./reviewEngine.mjs";
import { syncTradeReviewQueue } from "./tradeReviewQueue.mjs";
import { reviewMissedOpportunities } from "./missedOpportunity.mjs";
import { reconcilePendingOkxFillIdentities, realtimeStatus, startRealtimeManager, stopRealtimeManager } from "./realtimeManager.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { applyProtections } from "./tradeProtections.mjs";
import { currentRiskThresholds } from "./riskThresholds.mjs";
import { deriveEventRiskWindows } from "./eventRisk.mjs";
import { profitGoalSnapshot } from "./profitGoals.mjs";
import { buildCurrentRiskSnapshot } from "./currentRiskSnapshot.mjs";
import { reconcileRiskIncidentLifecycle } from "./riskIncidentLifecycle.mjs";
import { backfillReviewMemoryContexts, buildReviewLearningAnalytics } from "./reviewLearning.mjs";
import { backfillStructuredTradeReviews, buildOwnerReviewLoopSnapshot, migrateLegacyOwnerReviewProvenance, refreshOwnerImprovementRegistry } from "./ownerReviewLoop.mjs";
import { compileNaturalRiskCondition, validateConditionSpec, validateDynamicRiskAction } from "./dynamicRiskRules.mjs";
import { ensureSystemTask, registerTaskHandler, runTask, scheduleTask, schedulerStatus, startScheduler, unscheduleTask, validateTaskDefinition } from "./scheduler.mjs";
import { listVaultItems, runSafetyDrill, sendAlert, storeSecret } from "./securityOps.mjs";
import { installSkill, scanSkill, verifySkillPackageIntegrity } from "./skillManager.mjs";
import { seedSkillTools } from "./skillTools.mjs";
import { connectMcpServer, mcpStatus } from "./mcpClient.mjs";
import { fetchSkillPackage, readSkillInstructions, runSkillSandbox } from "./skillSandbox.mjs";
import { activeMandate, appendAudit, appendTrace, auditChainStatus, claimPaymentTransaction, effectiveAuditOperationalStatus, getStorageInfo, id, loadDb, nowIso, resetOperationalData, saveDb, setSaveDbObserver, TRADER_PERMISSIONS, verifyAuditChain } from "./store.mjs";
import { describeGuardReason, effectiveOpeningNotionalLimits } from "./tradeActions.mjs";
import { accountMarginCapacity } from "./tradingCapacity.mjs";
import { isPublicMarketStreamUpdate } from "./streamPolicy.mjs";
import { dispatchOutbox } from "./outboxDispatcher.mjs";
import { isLeaseLostError } from "./leaseSafety.mjs";
import { shipAuditToWorm } from "./auditSink.mjs";
import { recoverUncertainOrders } from "./omsRecovery.mjs";
import { requestContextMiddleware } from "./requestContext.mjs";
import { migrateLegacyWeeklyLossMandates } from "./mandatePolicy.mjs";
import { markRegistrationPaymentConfirmed, publicRegistrationInfo, sanitizeRegistrationApplication, updateRegistrationApplication } from "./publicRegistration.mjs";
import { projectKnowledgeRuntimeApproval } from "./knowledgePromptPolicy.mjs";
import { projectKnowledgeForPrincipal } from "./knowledgeScope.mjs";
import { projectSkillsForPrincipal } from "./principalScope.mjs";
import { buildOverviewPrincipalScope, deriveOverviewApiHealth } from "./overviewPrincipalScope.mjs";
import { assertSafeExternalUrl } from "./externalInputSafety.mjs";
import { applyKillSwitch } from "./riskControlService.mjs";
import { applyLiveTradingConfiguration, liveGateInput } from "./liveModeService.mjs";
import { transitionMandate } from "./mandateLifecycle.mjs";
import { tenantIsolationReadiness } from "./tenantIsolation.mjs";
import { verifyTrc20PaymentIntents } from "./trc20Payments.mjs";
import { extendSubscriptionTerm } from "./subscriptionLifecycle.mjs";
import { OPEN_EXECUTION_STATES } from "./executionStates.mjs";

dotenv.config();
installProxyFromEnv();

// TENANT_ISOLATION_V2 fail-closed:该开关承诺的按租户数据隔离尚未在 chat/plans/notifications
// 等读路径实现(审计发现)。开着它对外注册等于把 owner 全量数据暴露给任意租户——拒绝启动。
if (process.env.TENANT_ISOLATION_V2 === "true") {
  const readiness = tenantIsolationReadiness();
  if (!readiness.ready) {
    console.error(`TENANT_ISOLATION_V2=true 但资源层隔离尚未完成(schema v${readiness.schemaVersion})。请保持 false 并用一客户一实例(Path A)交付。`);
    process.exit(1);
  }
}

const app = express();
app.use(recordHttpPerformance);
// 生产只接受本机 Caddy 注入的 X-Forwarded-For；应用端口本身仅绑定 127.0.0.1。
// 这样注册/登录限流能拿到真实访客 IP，又不会信任公网客户端伪造的转发头。
// Caddy runs on the host while the app runs on Docker's private bridge. Trust
// only loopback/link-local/private proxy hops so req.secure reflects Caddy's
// X-Forwarded-Proto=https without trusting arbitrary public sources.
app.set("trust proxy", TRUSTED_REVERSE_PROXY_RANGES);
const databaseLoadStartedAt = performance.now();
const db = loadDb();
recordStartupPhase("database_load", databaseLoadStartedAt);
const postDatabaseStartupAt = performance.now();
app.locals.db = db;
setSaveDbObserver(({ updatedAt }) => {
  broadcastRaw(uiSyncEvent("core_invalidated", { updatedAt }));
});
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../dist");

applyStoredConfigToEnv(db);
installProxyFromEnv();
{
  const migration = retireTelegramWatchDigest(db);
  if (migration.tasksRemoved || migration.outboxCancelled || migration.configRemoved) {
    appendAudit(db, `下线 Telegram 每日摘要：移除任务 ${migration.tasksRemoved}，取消待发 ${migration.outboxCancelled}`, "telegram_watch_digest_retirement", "StartupMigration", "info");
    saveDb(db);
  }
}
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
{
  const migration = migrateLegacyWeeklyLossMandates(db);
  if (migration.migrated) {
    appendAudit(db, `周亏损字段语义迁移：${migration.migrated} 条授权恢复为 5%，旧计划版本自动失效`, migration.mandates.join(","), "StartupMigration", "warning");
    saveDb(db);
  }
}
{
  // Any mandate migration/version change must happen before armed-plan recovery,
  // otherwise an obsolete waiting plan remains visible until the next market tick.
  const migration = reconcileArmedSetupDefinitions(db);
  const changed = migration.normalized.length + migration.invalidated.length + migration.superseded.length;
  if (changed) {
    appendAudit(db, `等待入场计划启动校验：更新 ${migration.normalized.length}，停用无效 ${migration.invalidated.length}，去重 ${migration.superseded.length}`, "armed_setup_definition_migration", "StartupMigration", "warning");
    saveDb(db);
  }
}
// 启动迁移：把旧版本已 reflected 的真实平仓与新复盘队列对齐。
// 只恢复展示/审计状态，不重复调用 LLM，也不修改成交事实。
{
  migrateLegacyOwnerReviewProvenance(db);
  const migration = syncTradeReviewQueue(db);
  if (migration.queued || migration.reconciled || migration.financialsBackfilled) {
    appendAudit(db, `复盘队列迁移：新增 ${migration.queued}，对账完成 ${migration.reconciled}，净值回填 ${migration.financialsBackfilled || 0}`, "trade_review_queue_migration", "StartupMigration", "info");
    saveDb(db);
  }
}
// 记忆中的 outcome 必须在复盘队列完成生命周期净值回填后重建。
// schema v2 会把旧版按毛盈亏写入的 win/loss 幂等迁移为净值口径。
{
  const migration = backfillReviewMemoryContexts(db);
  if (migration.updated) {
    appendAudit(db, `复盘学习上下文迁移：按净值重建 ${migration.updated} 条历史真实复盘`, "review_learning_context_migration", "StartupMigration", "info");
    saveDb(db);
  }
}
// Owner 复盘闭环迁移：只从已完整核算的历史成交重建确定性过程/结果评分，
// 不补写模型故事、不激活新教训，也不自动创建策略实验。
{
  const structured = backfillStructuredTradeReviews(db);
  const registry = refreshOwnerImprovementRegistry(db);
  if (structured.updated || registry.created || registry.updated) {
    appendAudit(db, `Owner 复盘闭环迁移：结构化复盘 ${structured.updated}，新增优化项 ${registry.created}，更新 ${registry.updated}`, "owner_review_loop_migration", "StartupMigration", "info");
    saveDb(db);
  }
}
// 启动清理:历史上 runReconciler 无去重,重复的「对账发现差异」事件曾堆到 100+ 条。
// 收敛成最多一条 open(留最新一条,其余标为已处理),经服务端自身 saveDb 落盘(不与运行时抢写)。
{
  const isRecon = (i) => i.status === "open" && (i.kind === "reconcile" || i.title === "实时/账户对账发现差异");
  const openRecon = (db.riskIncidents || []).filter(isRecon).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  let changed = false;
  if (openRecon.length > 1) {
    const now = nowIso();
    for (const dup of openRecon.slice(1)) { dup.status = "resolved"; dup.resolvedAt = now; dup.resolvedBy = "StartupDedup"; dup.kind = "reconcile"; }
    changed = true;
    console.log(`[startup] 收敛重复对账事件 ${openRecon.length} → 1`);
  }
  // 对账报告数组曾被一次 DB 还原打乱顺序(旧报告排在最前),前端读 [0] 拿到陈旧状态;顺手按时间倒序并限长。
  const reports = db.reconciliationReports || [];
  if (reports.length) {
    const before = reports[0]?.createdAt;
    reports.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    if (reports.length > 200) reports.length = 200;
    if (reports[0]?.createdAt !== before) { changed = true; console.log(`[startup] 对账报告重排,最新 ${reports[0]?.createdAt}`); }
  }
  if (changed) saveDb(db);
}
ensureDefaultEventSources(db);
// 退役信息源在启动阶段立即从事实、健康状态和历史日报中移除，前端无需等待 20 分钟深层刷新。
removeLegacyPaidFlowData(db);
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
  for (const skill of stale.values()) {
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
try { ensureTurtleStrategy(db); } catch (error) { appendTrace(db, "system", `海龟策略入列失败:${String(error.message || error).slice(0, 120)}`, "warning"); }
try { const { ensureTradingDoctrine } = await import("./tradingDoctrine.mjs"); ensureTradingDoctrine(db); } catch (error) { appendTrace(db, "system", `交易条令入列失败:${String(error.message || error).slice(0, 120)}`, "warning"); }
try { const { ensureScheduledEvents } = await import("./scheduledEvents.mjs"); ensureScheduledEvents(db); } catch (error) { appendTrace(db, "system", `日程事件生成失败:${String(error.message || error).slice(0, 120)}`, "warning"); }
// 海龟策略验证/前向启动(异步,不阻塞启动)。验证一次性;前向启动幂等——每次启动给"过了历史但还没起
// 前向"的海龟补起模拟盘(createPaperSession 偶发拉 K 线失败会静默返回,下次启动/paper_forward 定时任务重试)。
(async () => {
  try {
    const turtle = (db.knowledge?.tradingSkills || []).filter((s) => /唐奇安/.test(s.name || ""));
    if (!turtle.length) return;
    if (!db.meta.turtleKickoffV1) { // 一次性历史样本外验证(过不了诚实停在 historical_rejected,不反复重验)
      db.meta.turtleKickoffV1 = true;
      for (const skill of turtle) {
        try { await validateKnowledgeSkill(db, skill.id, {}, "TurtleKickoff"); }   // 拉真实历史K线 40/30/30 样本外回测
        catch (error) { appendTrace(db, "system", `海龟历史验证 ${skill.name}:${String(error.message || error).slice(0, 90)}`, "warning"); }
      }
    }
    let started = 0;
    for (const skill of turtle) { // 幂等:仅对"过了历史且无前向会话"的海龟起纯前向模拟盘
      if (skill.status === "historical_validated" && !skill.paperSessionId) {
        try { const r = await startKnowledgeSkillPaper(db, skill.id, {}, "TurtleKickoff"); if (r.status === "ok") started += 1; }
        catch (error) { appendTrace(db, "system", `海龟前向启动 ${skill.name}:${String(error.message || error).slice(0, 90)}`, "warning"); }
      }
    }
    if (started) appendAudit(db, `海龟策略起纯前向模拟盘 ${started} 个;当前:${turtle.map((s) => `${s.name}=${s.status}`).join("；")}`, "src_manual_curated", "TurtleKickoff");
    saveDb(db);
  } catch (error) { appendTrace(db, "system", `海龟验证/前向异常:${String(error.message || error).slice(0, 90)}`, "warning"); }
})();
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
// 一次性清历史重复成交:此前 WS 用户流与执行引擎对同一笔成交各记一条,WS 记的用旧符号
// 口径 "…-SWAP"(引擎一律归一化去 -SWAP)。故 symbol 含 "-SWAP" 的 fills 全是 WS 重复记录,
// 删掉只留引擎权威那条,让"最近成交"与笔数/胜率/盈亏统计不再翻倍。去重逻辑已在写入侧修好。
if (!db.meta.fillDedupeVersion) {
  const before = (db.fills || []).length;
  db.fills = (db.fills || []).filter((f) => !/-SWAP/i.test(String(f.symbol || "")));
  const removed = before - db.fills.length;
  if (removed > 0) appendTrace(db, "system", `清理历史重复成交 ${removed} 条(WS 与引擎重复记账)`, "ok");
  db.meta.fillDedupeVersion = 1;
  saveDb(db);
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
    "drillRuns", "llmRuns", "toolExecutions", "skillRuns", "analysisBundles", "evidenceBundles",
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
// 上线时建立平仓海报水位，避免首次启用把历史盈利交易整批补发到 Telegram。
db.meta.telegramClosedTradePosterStartedAt ||= nowIso();
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
  allowedHeaders: ["Content-Type", "Authorization", "X-Native-App", "X-Native-Overview"],
  credentials: true
})(req, res, next));
// CORS 拒绝返回干净的 403，而不是落进默认错误处理器变 500（可能带栈信息）。
app.use((err, _req, res, next) => {
  if (err && err.message === "CORS origin denied") return res.status(403).json({ error: "Origin not allowed" });
  next(err);
});
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // SAMEORIGIN(非 DENY):营销页 landing.html 以同源 iframe 嵌入应用外壳,仍挡外站防点击劫持。
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // 营销页(landing.html)用 Google Fonts(Space Grotesk / IBM Plex Mono / Public Sans / Noto Sans SC),
  // 故 style-src/font-src 放行 fonts.googleapis.com / fonts.gstatic.com;脚本仍严格 'self'(landing.js 外置)。
  res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' https: wss:; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self'; frame-src 'self'; frame-ancestors 'self'");
  next();
});
app.use((req, res, next) => {
  const policy = transportSecurityPolicy(req);
  res.setHeader("X-Kordyn-Transport-Security", policy.label || "unknown");
  if (!policy.allowed) return res.status(policy.status || 426).json({ error: policy.error, message: "Production API access requires HTTPS." });
  next();
});
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    // Vite 产物 /assets/*.js|css 文件名带内容哈希 → 内容不可变,可永久缓存(改动会换新哈希名)。
    // 其余入口文件(index.html / landing.html / landing.js)用 no-cache,保证发版即时生效。
    if (/[\\/]assets[\\/]/.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }
  }
}));
app.get(/^\/(?!api(?:\/|$)).*/, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-cache");
  res.sendFile(path.join(publicDir, "index.html"), (error) => {
    if (error) next(error);
  });
});
installAuth(app, db);
// 鉴权必须先于大请求解析：普通 API/公开 webhook 最多 1MB；只有已经通过上方
// auth middleware 的知识文件导入允许 20MB，避免匿名请求用大 JSON 消耗内存。
const standardJsonParser = express.json({ limit: "1mb" });
const knowledgeImportJsonParser = express.json({ limit: "20mb" });
app.use((req, res, next) => {
  const parser = req.path === "/api/knowledge/import-real" ? knowledgeImportJsonParser : standardJsonParser;
  return parser(req, res, next);
});
app.use(requestContextMiddleware);

// 注册真实任务处理器并确保系统任务存在（执行轮询/持仓监控/核算/自主巡检/对账）
registerTaskHandler("execution_poll", async (database, _task, lease) => {
  lease.assertLease();
  const result = await pollExecutionOrders(database, { assertLease: lease.assertLease, signal: lease.signal });
  lease.assertLease();
  result.armedSetupsReconciled = reconcileArmedSetupExecutions(database).length;
  return result;
});
registerTaskHandler("position_monitor", async (database, _task, lease) => {
  lease.assertLease();
  const r = await monitorPositions(database, { assertLease: lease.assertLease, signal: lease.signal });
  // 带消息面的持仓护航（有持仓才跑，节省 LLM 额度）：只产建议/告警，不自动下单。
  try {
    const due = Date.now() - new Date(database.meta?.lastPositionEscortAt || 0).getTime() >= 2 * 60_000;
    if (due && (database.positions || []).some((p) => Number(p.size ?? p.pos ?? 0) !== 0)) {
      lease.assertLease();
      await escortPositions(database);
      lease.assertLease();
      database.meta.lastPositionEscortAt = nowIso();
    }
  } catch (error) { if (isLeaseLostError(error)) throw error; /* 护航失败不阻断监控 */ }
  // freqtrade 式交易保护:每轮刷新连亏冷却/回撤锁仓状态,新触发时抬风险事件(到期自动解除)。
  try { applyProtections(database); } catch { /* 保护评估失败不阻断监控 */ }
  return r;
});
registerTaskHandler("accounting_refresh", async (database, _task, lease) => {
  lease.assertLease();
  const result = await refreshAccountingAuthoritatively(database, { assertLease: lease.assertLease, signal: lease.signal });
  lease.assertLease();
  return result;
});
registerTaskHandler("reminder", (database, task, lease) => {
  lease.assertLease();
  database.notifications ||= [];
  database.notifications.unshift({
    id: id("notif"),
    type: "task_reminder",
    severity: "info",
    title: task.name,
    body: String(task.description || `定时提醒已触发：${task.name}`).slice(0, 500),
    taskId: task.id,
    read: false,
    createdAt: nowIso()
  });
  return { status: "notified", notification: task.name };
});
registerTaskHandler("agent_cycle", async (database, _task, lease) => {
  lease.assertLease();
  const run = await runAgentCycle(database, { invocationContext: systemAgentInvocation("scheduler:agent_cycle"), signal: lease.signal, schedulerLease: lease }, saveDb);
  lease.assertLease();
  recheckActivePlanRisk(database);
  // runAgentChat 会把模型/API 错误转成可见的 failed AgentRun，避免进程崩溃；但调度器
  // 仍必须收到失败信号，否则任务面板会谎报“完成”且不会执行既有重试策略。
  if (run?.status === "failed") throw new Error(run.error || "Agent decision cycle failed");
  return run;
});
registerTaskHandler("reconcile", (database, _task, lease) => { lease.assertLease(); return runReconciler(database, { mode: "scheduled", assertLease: lease.assertLease }); });
// 观察哨哨兵:每分钟机械核对已登记的价格条件,命中即通过 agent_cycle 任务(同锁同风控)触发完整巡检。
registerTaskHandler("watch_sentinel", (database, _task, lease) => { lease.assertLease(); return runWatchSentinel(database, saveDb); });
registerTaskHandler("opportunity_scan", async (database, _task, lease) => {
  lease.assertLease();
  const result = await runBroadOpportunityScan(database, { limit: 20 });
  lease.assertLease();
  if (result.queued?.length) {
    // 让当前扫描任务先由 scheduler 完成落盘，再异步唤起独立 agent_cycle，避免嵌套任务长时间占锁。
    setTimeout(() => {
      requestPendingAgentCycle(database, saveDb, "broad_opportunity")
        .catch((error) => appendTrace(database, "agent_cycle", `全市场机会唤起失败：${String(error.message || error).slice(0, 120)}`, "error"));
    }, 0);
  }
  return result;
});
registerTaskHandler("strategy_research", (database, _task, lease) => { lease.assertLease(); return runStrategyResearch(database, { signal: lease.signal, schedulerLease: lease }); });
registerTaskHandler("paper_forward", async (database, _task, lease) => {
  lease.assertLease();
  const paper = await runPaperForward(database);
  lease.assertLease();
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
// ② 平仓自动复盘：逐笔沉淀教训入记忆（含 LLM 深度复盘）。
registerTaskHandler("trade_reflection", (database, _task, lease) => { lease.assertLease(); return runTradeReflection(database, { signal: lease.signal, schedulerLease: lease }); });
// ②b 错过机会复盘：大波动却没交易的复盘沉淀（#5）。
registerTaskHandler("missed_opportunity_review", (database, _task, lease) => { lease.assertLease(); return reviewMissedOpportunities(database, { signal: lease.signal }); });
// Owner 复盘闭环：后台只聚合重复问题并形成候选优化项；不再自动创建策略实验。
// 只有 Owner 在复盘页接受策略类建议后，才会创建版本化验证草案。
registerTaskHandler("strategy_improvement", (database, _task, lease) => {
  lease.assertLease();
  const registry = refreshOwnerImprovementRegistry(database);
  database.system.lastOwnerImprovementScanAt = nowIso();
  return {
    status: "ok",
    ...registry,
    pendingOwner: (database.ownerImprovementItems || []).filter((item) => item.state === "pending_owner").length,
    note: "仅生成 Owner 候选优化项，未自动修改策略、Prompt、风控或代码"
  };
});
registerTaskHandler("event_source_refresh", async (database, _task, lease) => {
  lease.assertLease();
  const r = await refreshEventSources(database);
  lease.assertLease();
  try { const { ensureScheduledEvents } = await import("./scheduledEvents.mjs"); ensureScheduledEvents(database); } catch { /* 日程生成失败不阻断新闻刷新 */ }
  return r;
});
registerTaskHandler("event_refresh", async (database, _task, lease) => {
  lease.assertLease();
  let intelligence;
  try { intelligence = await refreshMarketIntelligence(database); }
  catch (error) { intelligence = { status: "failed", error: String(error.message || error).slice(0, 180) }; }
  lease.assertLease();
  try { const { ensureScheduledEvents } = await import("./scheduledEvents.mjs"); ensureScheduledEvents(database); } catch { /* 官方日历落风险事件失败不阻断 */ }
  return { status: intelligence.status, intelligence };
});
registerTaskHandler("news_flash_refresh", async (database, _task, lease) => {
  lease.assertLease();
  const result = await refreshMeNewsFlash(database);
  lease.assertLease();
  if (result.urgent?.length) {
    setTimeout(() => {
      requestPendingAgentCycle(database, saveDb, "important_news")
        .catch((error) => appendTrace(database, "agent_cycle", `重要快讯唤起失败：${String(error.message || error).slice(0, 120)}`, "error"));
    }, 0);
  }
  return { ...result, urgent: result.urgent?.length || 0, skipPersist: result.status === "ok" && result.added === 0 };
});
registerTaskHandler("event_preparation", async (database, _task, lease) => {
  lease.assertLease();
  const result = prepareScheduledEventMilestones(database);
  if (result.reached.some((item) => item.stage === "T24")) buildDailyBrief(database);
  if (result.wakeSignals.length) {
    setTimeout(() => {
      requestPendingAgentCycle(database, saveDb, "scheduled_event")
        .catch((error) => appendTrace(database, "agent_cycle", `日程事件唤起失败：${String(error.message || error).slice(0, 120)}`, "error"));
    }, 0);
  }
  return { ...result, skipPersist: result.reached.length === 0 };
});
registerTaskHandler("daily_market_brief", (database, _task, lease) => { lease.assertLease(); return buildDailyBrief(database); });
registerTaskHandler("onchain_refresh", (database, _task, lease) => { lease.assertLease(); return refreshOnchainSignals(database); });
registerTaskHandler("telegram_watch_dispatch", async (database, _task, lease) => {
  lease.assertLease();
  const result = await dispatchTelegramWatchOutbox(database);
  lease.assertLease();
  if (result.status === "disabled") return { ...result, status: "skipped" };
  if (result.status === "unconfigured") {
    return { ...result, status: "failed", error: "Telegram 观察哨已启用，但 Bot Token 或 Chat ID 未配置" };
  }
  return result;
});
registerTaskHandler("telegram_closed_trade_posters", (database, _task, lease) => { lease.assertLease(); return processClosedTradeProfitPosters(database); });
registerTaskHandler("agent_mission", (database, task, lease) => { lease.assertLease(); return runAgentMission(database, task, { signal: lease.signal, schedulerLease: lease }); });
registerTaskHandler("payment_verify", async (database, _task, lease) => {
  lease.assertLease();
  const r = await verifyTrc20Payments(database, { signal: lease.signal, assertLease: lease.assertLease });
  return { ...r, skipPersist: r.status === "skipped" || (r.status === "ok" && !r.checked) };
});
registerTaskHandler("outbox_dispatch", (database, _task, lease) => dispatchOutbox(database, { signal: lease.signal, assertLease: lease.assertLease }));
registerTaskHandler("audit_worm_ship", async (database, _task, lease) => {
  lease.assertLease();
  const r = await shipAuditToWorm(database);
  lease.assertLease();
  return { ...r, skipPersist: ["not_configured", "up_to_date"].includes(r.status) };
});
registerTaskHandler("oms_recovery", async (database, _task, lease) => {
  const r = await recoverUncertainOrders(database, { signal: lease.signal, assertLease: lease.assertLease });
  return { ...r, skipPersist: !r.checked };
});
registerTaskHandler("okx_readonly_sync", async (database, _task, lease) => {
  const accounts = (database.exchangeAccounts || []).filter((item) => item.readEnabled);
  if (!accounts.length) return { status: "skipped", reason: "no_read_account", skipPersist: true };
  let synced = 0; const errors = [];
  for (const account of accounts) {
    try { lease.assertLease(); await syncPrivateReadOnly(database, account.id); lease.assertLease(); synced += 1; }
    catch (error) { errors.push({ accountId: account.id, error: String(error?.message || error).slice(0, 160) }); }
  }
  lease.assertLease();
  const externalFillReconciliation = await reconcilePendingOkxFillIdentities(database, {
    signal: lease.signal,
    assertLease: lease.assertLease
  });
  lease.assertLease();
  return {
    status: synced === 0 ? "failed" : synced < accounts.length ? "partial" : "ok",
    attempted: accounts.length,
    synced,
    errors,
    externalFillReconciliation
  };
});
// 定时刷新合约微观结构 + 大盘/聪明钱，让这些卡片近实时（配合前端 15s 轮询）。
registerTaskHandler("market_signal_refresh", async (database, _task, lease) => {
  lease.assertLease();
  const mandate = activeMandate(database);
  // 刷 BTC/ETH（默认展示）+ 授权交易对 + 自选列表——此前不含自选，自选里非授权币的
  // 买盘占比/微观结构永远"未同步"。
  const symbols = mediumTermSymbolsForCollection(database, mandate);
  // 价格相关性/Beta 不必空等 7 天：首次（或上次失败超过1小时）从 OKX 15m 历史 K 线回填。
  // OI/Funding/CVD 没有被 K 线伪造，仍只使用前向采集的同频事实。
  database.meta ||= {};
  database.meta.mediumTermPriceBackfill ||= {};
  for (const symbol of symbols) {
    lease.assertLease();
    const state = database.meta.mediumTermPriceBackfill[symbol] || {};
    const lastAttempt = new Date(state.attemptedAt || 0).getTime();
    // “完成”与7d Beta使用同一覆盖口径：跨满7天且至少80% 15m时点。
    // 不能只看最近有一行，也不能用6.5天历史宣称7d窗口已经准备好。
    const historyFresh = mediumTermPriceHistoryReady(database.mediumTermSamples || [], symbol);
    if ((state.status === "ok" && historyFresh) || Date.now() - lastAttempt < 60 * 60_000) continue;
    state.attemptedAt = nowIso();
    try {
      const candles = await getHistoricalKlines(symbol, "15m", 700, "OKX", { signal: lease.signal });
      const result = backfillMediumTermPriceHistory(database, symbol, candles, { intervalMs: 15 * 60_000 });
      Object.assign(state, { status: mediumTermPriceHistoryReady(database.mediumTermSamples || [], symbol) ? "ok" : "partial", timeframe: "15m", rows: candles.length, added: result.added, completedAt: nowIso() });
    } catch (error) {
      if (lease.signal.aborted) throw lease.signal.reason;
      Object.assign(state, { status: "failed", error: String(error?.message || error).slice(0, 160) });
    }
    database.meta.mediumTermPriceBackfill[symbol] = state;
  }
  let synced = 0; const syncErrors = [];
  for (const symbol of symbols) {
    lease.assertLease();
    const result = await refreshMarketSignalSymbol(database, symbol, { signal: lease.signal });
    lease.assertLease();
    if (result.complete) synced += 1;
    syncErrors.push(...result.errors.map((item) => ({ symbol, source: item.source, error: item.error })));
  }
  try {
    const regime = await fetchMarketRegime(symbols[0] || "BTC/USDT", { signal: lease.signal });
    const prev = database.marketRegime || {};
    // 免费额度偶发 429 会返回 null；此时保留上一次的好值，避免主导率/聪明钱闪成"未取"。
    database.marketRegime = {
      ...regime,
      global: regime.global || prev.global || null,
      smartMoney: regime.smartMoney || prev.smartMoney || null,
      updatedAt: nowIso()
    };
  } catch { if (lease.signal.aborted) throw lease.signal.reason; /* 大盘拉取失败不阻断 */ }
  // 全市场异动扫描 + 重大异动消息面归因（环境感知，注入决策上下文）。
  try { await refreshMarketMovers(database, { attributeTop: 0, signal: lease.signal }); } catch { if (lease.signal.aborted) throw lease.signal.reason; /* 异动扫描失败不阻断 */ }
  // T+4h 数据完整后固化事件观察；即使 events 后续按保留策略清理，统计样本仍可长期积累。
  captureEventVolatilityObservations(database);
  // 知识技能声明的非默认周期（4h/1d 等）也要有 K 线，否则技能信号永远无法评估。
  try {
    const skillTfs = [...new Set((database.knowledge?.tradingSkills || [])
      .filter((s) => ["active", "paper_validating", "paper_validated"].includes(s.status))
      .map((s) => s.spec?.timeframe)
      .filter((tf) => tf && tf !== "1h"))].slice(0, 3);
    for (const tf of skillTfs) {
      for (const symbol of symbols.slice(0, 2)) {
        try { await syncPublicKlines(database, "OKX", symbol, tf, { sharedSlot: false, signal: lease.signal }); } catch { if (lease.signal.aborted) throw lease.signal.reason; /* 单周期失败不阻断 */ } // 只写 candlesByTf,不翻转共享 1h 槽
      }
    }
  } catch { if (lease.signal.aborted) throw lease.signal.reason; /* 技能周期补拉失败不阻断 */ }
  // 行情恢复后立即重算并解除由本闸设置的暂停，不必再等待下一轮 10 分钟对账
  // 或 15 分钟 Agent 周期；若所有关键行情源仍失败，则保持 fail-closed。
  applyOperationalDegradation(database, "MarketSignalRefresh");
  const status = synced === 0 ? "failed" : synced < symbols.length ? "partial" : "ok";
  const reason = status === "failed"
    ? syncErrors.slice(0, 4).map((item) => `${item.symbol}/${item.source}: ${item.error}`).join("；") || "关键行情源未完成刷新"
    : null;
  return { status, reason, attempted: symbols.length, synced, errors: syncErrors };
});
registerTaskHandler("market_context_research", async (database, _task, lease) => {
  lease.assertLease();
  const result = await refreshMarketContextResearch(database, { signal: lease.signal });
  lease.assertLease();
  if (result.status === "skipped") return { ...result, status: "skipped", skipPersist: true };
  if (result.status === "cached") return { ...result, status: "ok", cached: true, skipPersist: true };
  appendTrace(database, "market_context_research", result.status === "ok"
    ? `批量联网研究完成：全局 + ${(result.context?.assets || []).length} 个币，一次搜索复用`
    : `批量联网研究失败：${result.error || "unknown"}`, result.status === "ok" ? "ok" : "warning");
  return result;
});
ensureSystemTask(db, { id: "task_sys_okx_sync", name: "交易所余额同步", handler: "okx_readonly_sync", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_market_signal", name: "行情信号刷新", handler: "market_signal_refresh", schedule: "Every 2m", maxRunMs: 90_000 }, saveDb);
ensureSystemTask(db, { id: "task_sys_market_context_research", name: "Gemini 市场背景批量研究", handler: "market_context_research", schedule: "Every 1h", startupCatchup: true, startupDelayMs: 60_000 }, saveDb);
ensureSystemTask(db, { id: "task_sys_news_flash", name: "ME News 重要快讯快车道", handler: "news_flash_refresh", schedule: "Every 30s" }, saveDb);
ensureSystemTask(db, { id: "task_sys_event_source_refresh", name: "RSS 新闻源刷新", handler: "event_source_refresh", schedule: "Every 5m", startupCatchup: true, startupDelayMs: 10_000 }, saveDb);
ensureSystemTask(db, { id: "task_sys_event_refresh", name: "市场情报深层整合", handler: "event_refresh", schedule: "Every 20m", startupCatchup: true, startupDelayMs: 15_000 }, saveDb);
ensureSystemTask(db, { id: "task_sys_event_preparation", name: "高影响日程分阶段准备", handler: "event_preparation", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_daily_market_brief", name: "Daily Market Brief", handler: "daily_market_brief", type: "Cron", schedule: "45 7 * * *", timezone: "Asia/Shanghai" }, saveDb);
ensureSystemTask(db, { id: "task_sys_onchain_refresh", name: "链上基础资金面刷新", handler: "onchain_refresh", schedule: "Every 6h", startupCatchup: true, startupDelayMs: 45_000 }, saveDb);
ensureSystemTask(db, { id: "task_sys_telegram_watch", name: "Telegram观察哨Outbox", handler: "telegram_watch_dispatch", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_telegram_closed_trade", name: "Telegram平仓盈利海报", handler: "telegram_closed_trade_posters", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_execution_poll", name: "执行订单轮询", handler: "execution_poll", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_position_monitor", name: "持仓风险监控", handler: "position_monitor", schedule: "Every 30s" }, saveDb);
ensureSystemTask(db, {
  id: "task_sys_accounting", name: "盈亏核算刷新", handler: "accounting_refresh", schedule: "Every 5m",
  startupCatchup: true, startupDelayMs: 20_000
}, saveDb);
ensureSystemTask(db, { id: "task_sys_agent_cycle", name: "自主巡检决策", handler: "agent_cycle", schedule: "Every 15m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_watch_sentinel", name: "观察哨哨兵", handler: "watch_sentinel", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_opportunity_scan", name: "全市场早期机会快扫", handler: "opportunity_scan", schedule: "Every 30s" }, saveDb);
ensureSystemTask(db, { id: "task_sys_reconcile", name: "账户对账", handler: "reconcile", schedule: "Every 10m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_strategy_research", name: "自适应策略研究", handler: "strategy_research", schedule: "Every 6h" }, saveDb);
ensureSystemTask(db, { id: "task_sys_paper_forward", name: "模拟盘前向验证", handler: "paper_forward", schedule: "Every 30m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_trade_reflection", name: "平仓自动复盘", handler: "trade_reflection", schedule: "Every 30m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_missed_opportunity", name: "错过机会复盘", handler: "missed_opportunity_review", schedule: "Every 6h" }, saveDb);
ensureSystemTask(db, { id: "task_sys_strategy_improvement", name: "Owner 复盘问题聚合", handler: "strategy_improvement", schedule: "Every 6h" }, saveDb);
ensureSystemTask(db, { id: "task_sys_payment_verify", name: "TRC20 支付链上核验", handler: "payment_verify", schedule: "Every 2m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_outbox", name: "交易事件 Outbox 派发", handler: "outbox_dispatch", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_audit_worm", name: "审计日志 WORM 外送", handler: "audit_worm_ship", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_oms_recovery", name: "不确定订单恢复", handler: "oms_recovery", schedule: "Every 1m" }, saveDb);

startScheduler(db, saveDb);
// 行情分析与交易执行统一使用 OKX；不再自动接入 CoinGecko 行情 MCP，避免跨交易所口径污染。
db.mcpServers = (db.mcpServers || []).filter((server) => server.id !== "mcp_coingecko");
startRealtimeManager(db, saveDb);
startMarketStream(db, saveDb); // 实时行情流（OKX 公有 WS）→ 内存更新 + SSE 推前端
refreshAccounting(db);

// 崩溃恢复：已触发但尚未形成执行单的条件计划必须重新走新鲜事实+硬风控；
// 已有执行单则只对账绑定，绝不重复下单。等待行情/私有 WS 建连后再恢复。
setTimeout(() => {
  recoverTriggeredSetups(db, { executeApprovedPlan, saveDb, hasProvider: Boolean(activeProvider()) })
    .catch((error) => appendTrace(db, "armed_setup", `启动恢复失败：${String(error.message || error).slice(0, 120)}`, "error"));
}, 10_000);

// 实时仓位/盈亏：每个价格 tick 立即重算浮盈亏与组合，并把「持仓+组合」实时推给前端；
// 同时节流地跑一次持仓管理（止盈止损/保本/跟踪，用实时价），作为交易所条件单之外的安全网。
let __lastPnlBroadcast = 0;
let __lastMonitorTick = 0;
let __monitorBusy = false;
setMarketTickHook((database, symbol, price) => {
  const market = (database.markets || []).find((row) => row.symbol === symbol) || {};
  const opportunity = recordOpportunityTick(database, symbol, {
    price,
    openInterest: market.openInterest,
    volume24h: market.streamVolume24h,
    high24h: market.high24h,
    low24h: market.low24h,
    spreadBps: market.spreadBps
  });
  if (opportunity.queued) saveDb(database, { lightweight: true });

  // 普通观察哨也改为实时 tick 穿越检测；它仍只唤起 AI，不具备下单权限。
  const watchSweep = sweepWatches(database, new Map([[symbol, price]]));
  publishWatchSweep(database, watchSweep, {
    autoAnalyze: sentinelGate(database.system).autoAnalyze,
    actor: "MarketStream",
    realtime: true
  });
  if (watchSweep.changed) saveDb(database, { lightweight: true });

  // 发现即唤起，不再等待下一个 1 分钟哨兵周期；任务锁与每小时限频仍由同一入口保证。
  if (opportunity.queued || watchSweep.triggered.length) {
    requestPendingAgentCycle(database, saveDb, "realtime_signal")
      .catch((error) => appendTrace(database, "agent_cycle", `实时机会唤起失败：${String(error.message || error).slice(0, 120)}`, "error"));
  }

  // 已武装 setup 走确定性快速路径：刷新易变事实→硬风控复查→复用现有 OMS/保护单执行。
  // 内部按 setup 去重，密集 tick 不会重复下单。
  processArmedSetupTick(database, symbol, price, {
    executeApprovedPlan,
    saveDb,
    hasProvider: Boolean(activeProvider())
  }).catch((error) => appendTrace(database, "armed_setup", `tick 快速路径失败：${String(error.message || error).slice(0, 120)}`, "error"));

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
      broadcastRaw(uiSyncEvent("portfolio", {
        portfolio: {
          unrealizedPnl: database.portfolio?.unrealizedPnl ?? null,
          todayPnl: database.portfolio?.todayPnl ?? null,
          todayPnlPct: database.portfolio?.todayPnlPct ?? null,
          totalEquityUsdt: database.portfolio?.totalEquityUsdt ?? null
        },
        positions: (database.positions || []).map((p) => ({ id: p.id, symbol: p.symbol, mark: p.mark, pnl: p.pnl, unrealizedPnl: p.unrealizedPnl, roiPct: p.roiPct }))
      }));
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
  const { password, passwordHash, passwordSalt, mfaSecretName, mfaPendingSecretName, ...safe } = user;
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
    ...publicRegistrationInfo(db),
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
  if (payment.registrationApplicationId) {
    markRegistrationPaymentConfirmed(db, payment.registrationApplicationId, payment.id);
    return;
  }
  const plan = (db.subscriptionPlans || []).find((item) => item.id === payment.planId);
  const months = Number(plan?.months || 1);
  extendSubscriptionTerm(db, {
    tenantId: payment.tenantId,
    userId: payment.userId,
    planId: payment.planId,
    source: "trc20_usdt",
    paymentId: payment.id,
    months
  }, { id, now: nowIso() });
}

async function verifyTrc20Payments(db, options = {}) {
  const address = process.env.TRC20_USDT_RECEIVE_ADDRESS || db.runtimeConfig?.TRC20_USDT_RECEIVE_ADDRESS;
  return verifyTrc20PaymentIntents(db, {
    ...options,
    address,
    apiKey: process.env.TRONGRID_API_KEY,
    nowIso,
    saveDb,
    claimTransaction: claimPaymentTransaction,
    onExpired(payment) {
      if (!payment.registrationApplicationId) return;
      try { updateRegistrationApplication(db, payment.registrationApplicationId, { status: "approved" }); }
      catch { /* 人工状态已变化时不反向覆盖 */ }
    },
    onConfirmed(payment, evidence) {
      activateSubscriptionFromPayment(payment);
      appendAudit(db, `TRC20 链上确认订阅：${evidence.txid}`, payment.id, "PaymentVerifier");
    }
  });
}

// 先把来源落库并立即响应，再在后台做可能长耗时（LLM 按书名蒸馏 / 抓取网页）的解析——
// 避免请求超时把已创建的来源“丢掉”，失败也会以 status/error 显式呈现在知识库。
async function handleKnowledgeImport(req, res) {
  try {
    const source = await importKnowledgeReal(db, { ...req.body, tenantId: req.tenantId || req.user?.tenantId || "tenant_owner", ownerUserId: req.user?.id || null });
    if (req.body.autoParse === false) { persist(res, { message: "知识来源已导入，尚未解析", source }); return; }
    source.status = "processing";
    saveDb(db);
    res.json({ message: "知识来源已导入，正在后台蒸馏，稍后自动出现在知识库", source, parsed: { status: "processing" } });
    parseKnowledgeRealSource(db, source.id)
      .then(() => { saveDb(db); try { broadcastRaw(uiSyncEvent("knowledge_updated", { sourceId: source.id, status: source.status })); } catch { /* SSE 可选 */ } })
      .catch((err) => {
        source.status = "failed";
        source.error = err.message;
        appendAudit(db, `知识后台蒸馏失败：${err.message}`, source.id, "KnowledgePipeline", "warning");
        saveDb(db);
        try { broadcastRaw(uiSyncEvent("knowledge_updated", { sourceId: source.id, status: "failed" })); } catch { /* SSE 可选 */ }
      });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

app.get("/api/health", (_req, res) => {
  // 公共探针只暴露进程存活，不泄露实盘开关、存储路径或内部更新时间。
  res.json(buildLivenessReport());
});

app.get("/api/public/bootstrap", (_req, res) => {
  res.json(publicBootstrap());
});

app.get("/api/storage", requirePermission("admin:system"), (_req, res) => {
  res.json(getStorageInfo());
});

function sendMeasuredJson(res, payload, metricName) {
  const serialized = JSON.stringify(payload);
  const bytes = Buffer.byteLength(serialized);
  res.set("Cache-Control", "no-store");
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("X-Kordyn-Payload-Bytes", String(bytes));
  if (metricName) res.set("Server-Timing", `${metricName};desc=\"${bytes} bytes\"`);
  res.send(serialized);
}

app.get("/api/bootstrap/core", requirePermission("account.read"), (req, res) => {
  const { scoped: scopedDb } = overviewPrincipalScope(req);
  const auditStatus = effectiveAuditOperationalStatus(db);
  const notifications = visibleNotificationsForUser(db, {
    tenantId: req.tenantId || req.user?.tenantId || "tenant_owner",
    userId: req.user?.id || null
  });
  const payload = buildCoreOverview(scopedDb, {
    revision: currentUiRevision(),
    user: sanitizeUserRecord(req.user || db.user),
    systemRelease: process.env.APP_RELEASE || "dev",
    automationState: deriveAutomationState(scopedDb, { hasProvider: Boolean(activeProvider()), auditStatus }),
    config: getConfigStatus(db),
    notifications
  });
  sendMeasuredJson(res, payload, "core_overview");
});

app.get("/api/system/performance-metrics", requirePermission("admin:system"), (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(httpPerformanceSnapshot());
});

// system 路由组(readiness/backup/reset-operational-data/autonomy)已迁至 server/routes/system.mjs
// admin 用户/订阅/密码 + auth/change-password 路由组已迁至 server/routes/adminUsers.mjs
// payments(TRC20) 路由组已迁至 server/routes/payments.mjs

// 连接器工具(交易所/LLM)的状态在建库时被烙成种子字符串,后来配置了密钥也不会刷新 → 显示 bug。
// 这里按运行时真实密钥实时重算(启动时 applyStoredConfigToEnv 已把金库密钥解密注入 process.env),
// 不改库里的种子值,只影响前端展示。Public Market Data 无需密钥,原样透传。
function liveConnectorToolStatus(tools = []) {
  const has = (k) => Boolean(process.env[k]);
  const okxOk = has("OKX_API_KEY") && has("OKX_API_SECRET") && has("OKX_API_PASSPHRASE");
  const llmOk = has("OPENROUTER_API_KEY") && has("DEEPSEEK_API_KEY");
  return (tools || []).map((t) => {
    if (t.id === "tool_okx") return { ...t, status: okxOk ? "configured" : "missing_credentials" };
    if (t.id === "tool_llm") return { ...t, status: llmOk ? "configured" : "missing_credentials" };
    return t;
  });
}

function overviewActivePlusRecent(rows = [], activeStates, recentLimit) {
  const ordered = (rows || []).slice().sort((a, b) =>
    new Date(b.updatedAt || b.lastPolledAt || b.closedAt || b.createdAt || 0) - new Date(a.updatedAt || a.lastPolledAt || a.closedAt || a.createdAt || 0)
  );
  const active = ordered.filter((row) => activeStates.has(String(row?.status || "").toLowerCase()));
  const activeIds = new Set(active.map((row) => row?.id || row));
  return [...active, ...ordered.filter((row) => !activeIds.has(row?.id || row)).slice(0, recentLimit)];
}

function overviewPrincipalScope(req) {
  return buildOverviewPrincipalScope(db, {
    tenantId: req.tenantId || req.user?.tenantId || "",
    userId: req.user?.id || "",
    isOwner: req.user?.isOwner === true
  });
}

// Section v2 is deliberately built before the legacy overview. Each branch owns
// its expensive derived facts, so opening Settings cannot accidentally run
// backtests/review analytics and opening Chat cannot build the risk workbench.
function buildOverviewSectionSource(section, req, options = {}) {
  const { principal: requestPrincipal, scoped: privateDb, configuredOwner } = overviewPrincipalScope(req);
  const scopedKnowledge = projectKnowledgeForPrincipal(db, requestPrincipal);
  const scopedSkills = projectSkillsForPrincipal(db.skills, requestPrincipal);
  const scopedDb = { ...privateDb, system: options.system || privateDb.system, knowledge: scopedKnowledge, skills: scopedSkills };
  const systemTradeHistory = projectSystemOverviewTradeHistory(scopedDb);
  const performance = performanceReport(scopedDb);
  const overviewNotifications = visibleNotificationsForUser(db, {
    tenantId: req.tenantId || req.user?.tenantId || "tenant_owner",
    userId: req.user?.id || null
  });
  const common = {
    user: sanitizeUserRecord(req.user || db.user),
    system: profitGoalSnapshot(scopedDb.system),
    systemRelease: process.env.APP_RELEASE || "dev",
    automationState: deriveAutomationState(scopedDb, { hasProvider: Boolean(activeProvider()), auditStatus: options.auditStatus }),
    agentStatus: getAgentStatus(scopedDb),
    portfolio: scopedDb.portfolio,
    performance,
    positions: normalizePositionsForUi(scopedDb.positions),
    markets: db.markets,
    activeMarket: db.markets.find((market) => market.status === "synced" || market.price) || db.markets[0],
    marketRegime: db.marketRegime || null,
    watchlist: configuredOwner && db.watchlist?.length ? db.watchlist : ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    mandates: scopedDb.mandates,
    notifications: overviewNotifications,
    realtimeConnections: scopedDb.realtimeConnections,
    realtimeStarted: realtimeStatus(scopedDb).started,
    exchangeAccounts: scopedDb.exchangeAccounts,
    subscriptions: scopedDb.subscriptions,
    config: getConfigStatus(db)
  };

  if (section === "chat") return {
    ...common,
    tradePlans: scopedDb.tradePlans,
    executionOrders: scopedDb.executionOrders,
    armedSetups: scopedDb.armedSetups,
    fills: systemTradeHistory.fills,
    pendingActions: scopedDb.pendingActions.filter((item) => item.status === "awaiting_confirmation"),
    watchTriggers: scopedDb.watchTriggers,
    watchBoard: buildWatchBoard(scopedDb),
    agentRuns: scopedDb.agentRuns,
    tasks: scopedDb.tasks,
    events: db.events,
    newsFeed: (db.marketIntelligenceFacts || []).filter((fact) => fact.category === "flash_news")
      .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)),
    missedOpportunities: scopedDb.missedOpportunities,
    opportunityCandidates: scopedDb.opportunityCandidates,
    strategyStudio: { drafts: strategyDraftsReferencedByChat(db, { principal: requestPrincipal }) }
  };

  if (section === "cockpit") return {
    ...common,
    tradePlans: scopedDb.tradePlans,
    executionOrders: scopedDb.executionOrders,
    armedSetups: scopedDb.armedSetups,
    orders: scopedDb.orders,
    fills: systemTradeHistory.fills,
    closedTradeLifecycles: systemTradeHistory.closedTradeLifecycles,
    riskChecks: scopedDb.riskChecks,
    reviews: scopedDb.reviews,
    reconciliationReports: scopedDb.reconciliationReports,
    accountSnapshots: scopedDb.accountSnapshots,
    behaviorProfile: computeBehaviorProfile(scopedDb),
    behaviorNarrative: configuredOwner ? db.system?.behaviorNarrative || null : null,
    reviewLearningAnalytics: buildReviewLearningAnalytics(db, { principal: { tenantId: req.tenantId || req.user?.tenantId, userId: req.user?.id, isOwner: req.user?.isOwner === true } }),
    ...(configuredOwner ? { ownerReviewLoop: buildOwnerReviewLoopSnapshot(db) } : {}),
    tradeDataStatus: {
      source: "server_complete_lifecycle_aggregation",
      fillTotal: systemTradeHistory.fills.length,
      closedLifecycleTotal: systemTradeHistory.closedTradeLifecycles.length,
      financiallyReconciledTrades: performance.financiallyReconciledTrades,
      pendingFinancialReconciliation: performance.pendingFinancialReconciliation,
      tradeReviewTotal: scopedDb.reviews.filter((review) => review?.type === "trade").length,
      tradeReviewPending: scopedDb.reviews.filter((review) => review?.type === "trade" && ["pending", "processing", "retry", "awaiting_approval"].includes(String(review.status || "").toLowerCase())).length,
      tradeReviewFailed: scopedDb.reviews.filter((review) => review?.type === "trade" && ["failed", "error"].includes(String(review.status || "").toLowerCase())).length,
      generatedAt: new Date().toISOString()
    },
    executionOrderStatus: (() => {
      const rows = scopedDb.executionOrders;
      const last = rows.map((row) => row.updatedAt || row.lastPolledAt || row.closedAt || row.createdAt).filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a))[0] || null;
      return { source: "OMS + OKX reconciliation", total: rows.length, lastChangedAt: last };
    })(),
    mediumTermAnalytics: buildMediumTermAnalytics(scopedDb),
    marketMovers: db.marketMovers ? { movers: (db.marketMovers.movers || []).slice(0, 12), scannedAt: db.marketMovers.scannedAt || db.marketMovers.updatedAt || null } : null,
    abnormalVolatility: abnormalVolatilityBoard(db),
    portfolioRisk: buildPortfolioRisk(scopedDb, activeMandate(scopedDb)),
    professional: buildProfessionalSnapshot(scopedDb, { auditStatus: options.auditStatus }),
    paperReport: buildPaperReport(scopedDb)
  };

  if (section === "researchCenter") return {
    ...common,
    knowledge: { ...projectKnowledgeRuntimeApproval(scopedKnowledge), chunks: (scopedKnowledge.chunks || []).map((chunk) => ({ id: chunk.id, sourceId: chunk.sourceId })) },
    skills: scopedSkills,
    tools: liveConnectorToolStatus(db.tools),
    mcpServers: configuredOwner ? db.mcpServers : [],
    strategyBoard: buildStrategyBoard(scopedDb),
    strategyCatalog: buildStrategyCatalog(scopedDb, Object.values(STRATEGIES)),
    strategyStudio: strategyStudioSnapshot(db, { compact: true, principal: { tenantId: req.tenantId || req.user?.tenantId, userId: req.user?.id, isOwner: req.user?.isOwner === true } }),
    backtestResearch: buildBacktestResearch(scopedDb),
    backtests: scopedDb.backtests,
    strategyProfiles: scopedDb.strategyProfiles,
    memoryItems: scopedDb.memoryItems,
    agentProfiles: db.agentProfiles,
    analysisEngine: {
      weights: DECISION_WEIGHTS,
      thresholds: DECISION_THRESHOLDS,
      defaults: DECISION_DEFAULTS,
      llmModel: process.env.GEMINI_MODEL || db.runtimeConfig?.GEMINI_MODEL || null,
      tools: listAgentTools().map((tool) => ({
        ...tool,
      runs: configuredOwner ? db.toolCallStats?.[tool.name]?.calls ?? 0 : 0,
      lastRunAt: configuredOwner ? db.toolCallStats?.[tool.name]?.lastAt ?? null : null,
      usage: configuredOwner ? toolUsageView(db.toolCallStats?.[tool.name]) : null
      })),
      toolUsageStatsSince: db.meta?.toolUsageStatsSince || null,
      toolUsageBackfilledAt: db.meta?.toolUsageBackfilledAt || null
    },
    reviewAnalytics: buildReviewAnalytics(db, { principal: { tenantId: req.tenantId || req.user?.tenantId, userId: req.user?.id, isOwner: req.user?.isOwner === true } }),
    reviewLearningAnalytics: buildReviewLearningAnalytics(db, { principal: { tenantId: req.tenantId || req.user?.tenantId, userId: req.user?.id, isOwner: req.user?.isOwner === true } }),
    decisionCalibration: buildDecisionCalibrationReport(scopedDb),
    embeddingStatus: embeddingStatus(db, { chunks: scopedKnowledge.chunks })
  };

  if (section === "riskCenter") {
    const mandate = activeMandate(scopedDb);
    const bySymbol = Object.values(mandate?.maxLeverageBySymbol || {}).map(Number).filter(Number.isFinite);
    const leverage = Number(mandate?.maxLeverage ?? mandate?.max_leverage ?? (bySymbol.length ? Math.max(...bySymbol) : 1));
    const capacity = accountMarginCapacity(scopedDb, { mandate, leverage, live: false });
    return {
      ...common,
      tradePlans: scopedDb.tradePlans,
      executionOrders: scopedDb.executionOrders,
      riskThresholds: currentRiskThresholds(),
      riskRules: scopedDb.riskRules,
      riskChecks: scopedDb.riskChecks,
      riskIncidents: scopedDb.riskIncidents,
      eventRiskWindows: deriveEventRiskWindows(db.events, { blackoutMinutes: currentRiskThresholds().eventBlackoutMinutes }),
      currentRiskSnapshot: options.riskSnapshot || buildCurrentRiskSnapshot(scopedDb, Date.now(), { auditStatus: options.auditStatus }),
      grayReleasePolicies: scopedDb.grayReleasePolicies,
      notionalLimits: effectiveOpeningNotionalLimits(scopedDb),
      tradingCapacity: { ...capacity, freshForExecution: capacity.ok && Number(capacity.ageMs) <= Number(capacity.maxAgeMs) },
      portfolioRisk: buildPortfolioRisk(scopedDb, mandate),
      apiKeyMetadata: scopedDb.apiKeyMetadata,
      accountSnapshots: scopedDb.accountSnapshots,
      readiness: buildReadinessReport(scopedDb, { auditStatus: options.auditStatus })
    };
  }

  if (section === "operationsCenter") return {
    ...common,
    executionOrders: scopedDb.executionOrders,
    events: db.events,
    tasks: scopedDb.tasks,
    jobRuns: scopedDb.jobRuns,
    riskIncidents: scopedDb.riskIncidents,
    reconciliationReports: scopedDb.reconciliationReports,
    auditLogs: scopedDb.auditLogs,
    traces: scopedDb.traces,
    alerts: scopedDb.alerts,
    drillRuns: scopedDb.drillRuns,
    eventSources: db.eventSources,
    marketCalendarEvents: db.marketCalendarEvents,
    dailyMarketBrief: (db.dailyBriefs || [])[0] || null,
    marketIntelligenceSourceHealth: sourceHealthSummary(db),
    newsFeed: (db.marketIntelligenceFacts || []).filter((fact) => fact.category === "flash_news")
      .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)),
    accountSnapshots: scopedDb.accountSnapshots,
    marketStream: marketStreamStatus(),
    opportunityEngine: opportunityEngineStatus(db),
    readiness: buildReadinessReport(scopedDb, { auditStatus: options.auditStatus })
  };

  return {
    ...common,
    users: configuredOwner ? (db.users || []).map(sanitizeUserRecord) : (db.users || []).filter((user) => user.id === requestPrincipal.userId).map(sanitizeUserRecord),
    tenants: configuredOwner ? db.tenants : (db.tenants || []).filter((tenant) => tenant.id === requestPrincipal.tenantId),
    subscriptionPlans: db.subscriptionPlans,
    paymentRequests: configuredOwner ? db.paymentRequests : [],
    publicRegistrationEnabled: publicRegistrationInfo(db).registrationEnabled,
    registrationMode: publicRegistrationInfo(db).registrationMode,
    registrationCapacity: publicRegistrationInfo(db).capacity,
    registrationApplications: configuredOwner ? (db.registrationApplications || []).map(sanitizeRegistrationApplication) : [],
    runtimeConfig: configuredOwner ? db.runtimeConfig : {},
    agentProfiles: db.agentProfiles,
    apiKeyMetadata: scopedDb.apiKeyMetadata,
    accountSnapshots: scopedDb.accountSnapshots,
    tools: liveConnectorToolStatus(db.tools),
    mcpServers: configuredOwner ? db.mcpServers : [],
    eventSources: db.eventSources,
    larkConfigured: larkStatus().configured,
    telegramConfigured: telegramStatus().configured,
    mcpStatus: mcpStatus(db),
    readiness: buildReadinessReport(scopedDb, { auditStatus: options.auditStatus })
  };
}

app.get("/api/overview", requirePermission("account.read"), (req, res) => {
  // Live account data must never be reused across the startup/full native views. In particular,
  // WKWebView can cache the first compact response because both views share this endpoint.
  res.set("Cache-Control", "no-store");
  res.vary("X-Native-Overview");
  const requestedSection = req.query.view === "section" ? String(req.query.section || "chat") : null;
  const overviewNotifications = visibleNotificationsForUser(db, {
    tenantId: req.tenantId || req.user?.tenantId || "tenant_owner",
    userId: req.user?.id || null
  });
  const { principal: requestPrincipal, scoped: privateDb, configuredOwner } = overviewPrincipalScope(req);
  const scopedKnowledge = projectKnowledgeForPrincipal(db, requestPrincipal);
  const scopedSkills = projectSkillsForPrincipal(db.skills, requestPrincipal);
  const scopedDb = { ...privateDb, knowledge: scopedKnowledge, skills: scopedSkills };
  const systemTradeHistory = projectSystemOverviewTradeHistory(scopedDb);
  const configStatus = configuredOwner ? getConfigStatus(db) : null;
  scopedDb.system.apiHealth = deriveOverviewApiHealth(scopedDb, {
    configuredOwner,
    hasStoredOkxCredentials: configStatus?.exchange?.okx?.hasKey === true
  });
  const allowedSections = new Set(["chat", "cockpit", "researchCenter", "riskCenter", "operationsCenter", "systemSettings"]);
  if (requestedSection && !allowedSections.has(requestedSection)) return res.status(400).json({ error: "unknown_overview_section" });
  const sectionBuilderV2 = process.env.OVERVIEW_SECTION_BUILDER_V2 !== "false";
  const needs = (...sections) => !requestedSection || !sectionBuilderV2 || sections.includes(requestedSection);
  const overviewAuditStatus = effectiveAuditOperationalStatus(db);
  // 陈旧计划自动作废:隔夜/超期未成交的计划置为 expired,让"当前计划卡"与"暂无待处理计划"口径一致。
  const expiredPlans = expireStalePlans(scopedDb);
  const overviewRiskSnapshot = (!requestedSection || !sectionBuilderV2 || requestedSection === "riskCenter")
    ? buildCurrentRiskSnapshot(scopedDb, Date.now(), { auditStatus: overviewAuditStatus }) : null;
  const resolvedIncidents = overviewRiskSnapshot
    ? reconcileRiskIncidentLifecycle(scopedDb, { degradation: overviewRiskSnapshot.operationalDegradation, snapshot: overviewRiskSnapshot }) : [];
  if (expiredPlans.length || resolvedIncidents.length) saveDb(db);
  if (requestedSection && sectionBuilderV2) {
    const source = buildOverviewSectionSource(requestedSection, req, { auditStatus: overviewAuditStatus, riskSnapshot: overviewRiskSnapshot, system: scopedDb.system });
    const projected = { ...projectOverviewSection(source, requestedSection), revision: currentUiRevision() };
    res.set("X-Kordyn-Overview-Builder", "section_v2");
    if (process.env.OVERVIEW_SHADOW_COMPARE === "true" && requestedSection === "cockpit") {
      const authoritative = overviewShadowFacts({
        positions: normalizePositionsForUi(db.positions),
        orders: db.orders,
        system: profitGoalSnapshot(db.system),
        portfolio: db.portfolio,
        performance: performanceReport(db)
      });
      const comparison = compareOverviewShadowFacts(authoritative, overviewShadowFacts(projected));
      res.set("X-Kordyn-Overview-Shadow", comparison.match ? "match" : `mismatch:${comparison.mismatches.join(",")}`);
    }
    return sendMeasuredJson(res, projected, `overview_${requestedSection}`);
  }
  const overview = {
    // 展示当前登录用户本人(而非固定的 db.user 遗留对象):Owner 的 req.user 是 db.users 里的条目,
    // 账户资料自助(改名/头像)写在那上面;此前固定返回 db.user 两对象不同步 → 保存后前端不生效。
    // 同时用 sanitizeUserRecord 剥离密码字段(旧的裸 db.user 会外泄 passwordHash)。
    user: sanitizeUserRecord(req.user || db.user),
    users: configuredOwner ? (db.users || []).map(sanitizeUserRecord) : [sanitizeUserRecord(req.user)],
    tenants: configuredOwner ? (db.tenants || []) : (db.tenants || []).filter((tenant) => tenant.id === requestPrincipal.tenantId),
    subscriptionPlans: db.subscriptionPlans || [],
    subscriptions: scopedDb.subscriptions,
    paymentRequests: configuredOwner ? db.paymentRequests?.slice(0, 20) || [] : [],
    system: profitGoalSnapshot(scopedDb.system),
    systemRelease: process.env.APP_RELEASE || "dev",
    publicRegistrationEnabled: publicRegistrationInfo(db).registrationEnabled,
    registrationMode: publicRegistrationInfo(db).registrationMode,
    registrationCapacity: publicRegistrationInfo(db).capacity,
    registrationApplications: configuredOwner ? (db.registrationApplications || []).map(sanitizeRegistrationApplication) : [],
    riskThresholds: currentRiskThresholds(),
    automationState: deriveAutomationState(scopedDb, { hasProvider: Boolean(activeProvider()), auditStatus: overviewAuditStatus }),
    ...(needs("researchCenter") ? {
      strategyBoard: buildStrategyBoard(scopedDb),
      strategyCatalog: buildStrategyCatalog(scopedDb, Object.values(STRATEGIES)),
      strategyStudio: strategyStudioSnapshot(db, { compact: true, principal: { tenantId: req.tenantId || req.user?.tenantId, userId: req.user?.id, isOwner: req.user?.isOwner === true } })
    } : {}),
    agentStatus: getAgentStatus(scopedDb),
    agentProfiles: db.agentProfiles || [],
    portfolio: scopedDb.portfolio,
    markets: db.markets,
    watchlist: configuredOwner && db.watchlist?.length ? db.watchlist : ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
    activeMarket: db.markets.find((market) => market.status === "synced" || market.price) || db.markets[0],
    positions: normalizePositionsForUi(scopedDb.positions),
    ...(needs("cockpit") ? {
      behaviorProfile: computeBehaviorProfile(scopedDb),
      behaviorNarrative: configuredOwner ? db.system?.behaviorNarrative || null : null,
      ...(configuredOwner ? { ownerReviewLoop: buildOwnerReviewLoopSnapshot(db) } : {})
    } : {}),
    mandates: scopedDb.mandates,
    tradePlans: scopedDb.tradePlans,
    watchTriggers: scopedDb.watchTriggers.slice(0, 20).map(presentWatch),
    ...(needs("chat") ? { watchBoard: buildWatchBoard(scopedDb) } : {}),
    events: db.events,
    tasks: scopedDb.tasks,
    // 蒸馏出的 chunk 正文/词频向量（导入 11 本书后达 ~1.4MB）客户端并不渲染，只用到条数；
    // 这里剥掉 chunk 重字段，overview 从 ~1.5MB 降到几十 KB，移动端才不会超时。RAG 检索在服务端做。
    knowledge: { ...projectKnowledgeRuntimeApproval(scopedKnowledge), chunks: (scopedKnowledge.chunks || []).map((c) => ({ id: c.id, sourceId: c.sourceId })) },
    skills: scopedSkills,
    tools: liveConnectorToolStatus(db.tools),
    mcpServers: configuredOwner ? db.mcpServers : [],
    traces: scopedDb.traces.slice(0, 10),
    auditLogs: scopedDb.auditLogs.slice(0, 20),
    analysisBundles: scopedDb.analysisBundles,
    evidenceBundles: scopedDb.evidenceBundles.slice(0, 20),
    reviews: scopedDb.reviews
    ,
    exchangeAccounts: scopedDb.exchangeAccounts,
    apiKeyMetadata: scopedDb.apiKeyMetadata,
    accountSnapshots: scopedDb.accountSnapshots.slice(0, 10),
    orders: scopedDb.orders,
    fills: systemTradeHistory.fills,
    closedTradeLifecycles: systemTradeHistory.closedTradeLifecycles,
    tradeDataStatus: {
      source: "OMS + exchange-confirmed fills + trade review queue",
      fillTotal: systemTradeHistory.fills.length,
      closedLifecycleTotal: systemTradeHistory.closedTradeLifecycles.length,
      tradeReviewTotal: scopedDb.reviews.filter((review) => review?.type === "trade").length,
      tradeReviewPending: scopedDb.reviews.filter((review) => review?.type === "trade" && ["pending", "processing", "retry", "awaiting_approval"].includes(String(review.status || "").toLowerCase())).length,
      tradeReviewFailed: scopedDb.reviews.filter((review) => review?.type === "trade" && ["failed", "error"].includes(String(review.status || "").toLowerCase())).length,
      generatedAt: new Date().toISOString()
    },
    riskRules: scopedDb.riskRules,
    riskChecks: scopedDb.riskChecks,
    riskIncidents: scopedDb.riskIncidents,
    ...(needs("riskCenter") ? { eventRiskWindows: deriveEventRiskWindows(db.events, { blackoutMinutes: currentRiskThresholds().eventBlackoutMinutes }) } : {}),
    currentRiskSnapshot: overviewRiskSnapshot,
    realtimeConnections: scopedDb.realtimeConnections,
    marketRegime: db.marketRegime || null,
    ...(needs("cockpit") ? {
      mediumTermAnalytics: buildMediumTermAnalytics(scopedDb),
      marketMovers: db.marketMovers ? { movers: (db.marketMovers.movers || []).slice(0, 12), scannedAt: db.marketMovers.scannedAt || db.marketMovers.updatedAt || null } : null
    } : {}),
    positionEscort: configuredOwner ? db.positionEscort || null : null,
    realtimeStarted: realtimeStatus(scopedDb).started,
    marketStream: marketStreamStatus(),
    opportunityEngine: opportunityEngineStatus(db),
    abnormalVolatility: abnormalVolatilityBoard(db).slice(0, 20),
    opportunityCandidates: scopedDb.opportunityCandidates.slice(0, 30),
    armedSetups: overviewActivePlusRecent(scopedDb.armedSetups, new Set(["armed", "triggered", "fast_validating", "executing", "recovery_pending_reconciliation"]), 30),
    pendingActions: scopedDb.pendingActions.filter((item) => item.status === "awaiting_confirmation").slice(0, 10),
    reconciliationReports: scopedDb.reconciliationReports.slice(0, 10),
    jobRuns: scopedDb.jobRuns.slice(0, 20),
    notifications: overviewNotifications,
    missedOpportunities: scopedDb.missedOpportunities.slice(0, 20),
    alerts: scopedDb.alerts.slice(0, 20),
    drillRuns: scopedDb.drillRuns.slice(0, 10),
    grayReleasePolicies: scopedDb.grayReleasePolicies,
    notionalLimits: effectiveOpeningNotionalLimits(scopedDb),
    ...(needs("riskCenter") ? { tradingCapacity: (() => {
      const mandate = activeMandate(scopedDb);
      const bySymbol = Object.values(mandate?.maxLeverageBySymbol || {}).map(Number).filter(Number.isFinite);
      const leverage = Number(mandate?.maxLeverage ?? mandate?.max_leverage ?? (bySymbol.length ? Math.max(...bySymbol) : 1));
      const capacity = accountMarginCapacity(scopedDb, { mandate, leverage, live: false });
      return { ...capacity, freshForExecution: capacity.ok && Number(capacity.ageMs) <= Number(capacity.maxAgeMs) };
    })() } : {}),
    llmRuns: scopedDb.llmRuns.slice(0, 10),
    tradeIntents: scopedDb.tradeIntents.slice(0, 20),
    executionOrders: overviewActivePlusRecent(scopedDb.executionOrders, OPEN_EXECUTION_STATES, 50),
    executionOrderStatus: (() => {
      const rows = scopedDb.executionOrders;
      const last = rows.map((row) => row.updatedAt || row.lastPolledAt || row.closedAt || row.createdAt).filter(Boolean)
        .sort((a, b) => new Date(b) - new Date(a))[0] || null;
      return { source: "OMS + OKX reconciliation", total: rows.length, lastChangedAt: last };
    })(),
    exchangeOrders: scopedDb.exchangeOrders.slice(0, 20),
    reviewReports: scopedDb.reviewReports.slice(0, 20),
    toolExecutions: scopedDb.toolExecutions.slice(0, 20),
    eventSources: db.eventSources || [],
    marketCalendarEvents: (db.marketCalendarEvents || []).slice(0, 100),
    dailyMarketBrief: (db.dailyBriefs || [])[0] || null,
    // 与 Agent 内部情报判断共用同一健康派生：原始 status=ok 但已超过 staleAfterMs 的源
    // 必须下发 health=stale，不能让 App 仍显示“正常”。
    ...(needs("operationsCenter") ? { marketIntelligenceSourceHealth: sourceHealthSummary(db) } : {}),
    newsFeed: (db.marketIntelligenceFacts || []).filter((fact) => fact.category === "flash_news")
      .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)).slice(0, 80),
    skillRuns: scopedDb.skillRuns.slice(0, 10),
    agentStateFiles: scopedDb.agentStateFiles,
    memoryItems: scopedDb.memoryItems,
    agentRuns: scopedDb.agentRuns,
    performance: performanceReport(scopedDb),
    backtests: scopedDb.backtests.slice(0, 10),
    ...(needs("researchCenter") ? {
      backtestResearch: buildBacktestResearch(scopedDb),
      strategyProfiles: scopedDb.strategyProfiles,
      embeddingStatus: embeddingStatus(scopedDb, { chunks: scopedKnowledge.chunks }),
      reviewAnalytics: buildReviewAnalytics(db, { principal: { tenantId: req.tenantId || req.user?.tenantId, userId: req.user?.id, isOwner: req.user?.isOwner === true } }),
      reviewLearningAnalytics: buildReviewLearningAnalytics(db, { principal: { tenantId: req.tenantId || req.user?.tenantId, userId: req.user?.id, isOwner: req.user?.isOwner === true } }),
      decisionCalibration: buildDecisionCalibrationReport(scopedDb)
    } : {}),
    ...(needs("cockpit") ? {
      paperReport: buildPaperReport(scopedDb),
      professional: buildProfessionalSnapshot(scopedDb, { auditStatus: overviewAuditStatus })
    } : {}),
    ...(needs("cockpit", "riskCenter") ? { portfolioRisk: buildPortfolioRisk(scopedDb, activeMandate(scopedDb)) } : {}),
    ...(needs("systemSettings") ? {
      larkConfigured: larkStatus().configured,
      telegramConfigured: telegramStatus().configured,
      mcpStatus: configuredOwner ? mcpStatus(db) : { configured: false, servers: [] }
    } : {}),
    runtimeConfig: configuredOwner ? db.runtimeConfig || {} : {},
    config: getConfigStatus(db),
    ...(needs("systemSettings", "operationsCenter") ? { readiness: buildReadinessReport(scopedDb, { auditStatus: overviewAuditStatus }) } : {}),
    // 分析透明度:如实汇总"当前真正在决策里起作用"的引擎配置(权重/阈值/兜底默认/LLM/工具目录)。
    // 动态信号(regime/聪明钱/异动/技能)前端直接用上面已有字段,这里只补静态但真实的引擎常量。
    ...(needs("researchCenter") ? { analysisEngine: {
      weights: DECISION_WEIGHTS,
      thresholds: DECISION_THRESHOLDS,
      defaults: DECISION_DEFAULTS,
      llmModel: process.env.GEMINI_MODEL || db.runtimeConfig?.GEMINI_MODEL || null,
      // 内置工具附真实调用量(来自 toolCallStats 计数中枢),前端「调用量」列直接读。
      tools: listAgentTools().map((t) => ({
        ...t,
        runs: configuredOwner ? db.toolCallStats?.[t.name]?.calls ?? 0 : 0,
        lastRunAt: configuredOwner ? db.toolCallStats?.[t.name]?.lastAt ?? null : null,
        usage: configuredOwner ? toolUsageView(db.toolCallStats?.[t.name]) : null
      })),
      toolUsageStatsSince: db.meta?.toolUsageStatsSince || null,
      toolUsageBackfilledAt: db.meta?.toolUsageBackfilledAt || null
    } } : {}),
    toolCallStats: configuredOwner ? db.toolCallStats || {} : {}
  };
  if (requestedSection) {
    const projected = { ...projectOverviewSection(overview, requestedSection), revision: currentUiRevision() };
    res.set("X-Kordyn-Overview-Builder", "legacy_full_v1");
    if (process.env.OVERVIEW_SHADOW_COMPARE === "true" && requestedSection === "cockpit") {
      const authoritative = overviewShadowFacts({
        positions: normalizePositionsForUi(db.positions),
        orders: db.orders,
        system: profitGoalSnapshot(db.system),
        portfolio: db.portfolio,
        performance: performanceReport(db)
      });
      const comparison = compareOverviewShadowFacts(authoritative, overviewShadowFacts(projected));
      res.set("X-Kordyn-Overview-Shadow", comparison.match ? "match" : `mismatch:${comparison.mismatches.join(",")}`);
    }
    return sendMeasuredJson(res, projected, `overview_${requestedSection}`);
  }
  // 原生端每 15 秒刷新，只下发手机真实会用到的字段。完整桌面概览保持兼容；
  // 以鉴权登录时已存在的 X-Native-App 明确区分，避免依赖可伪造/漂移的 User-Agent。
  const nativeRequest = req.get("X-Native-App") === "true";
  // 未声明模式的是旧原生包：默认给 startup 快照，保证已安装版本也能立刻恢复；
  // 新包首屏完成后会显式请求 full，在后台补齐二级页面。
  const nativeMode = nativeRequest ? (req.get("X-Native-Overview") || "startup") : false;
  sendMeasuredJson(res, { ...compactOverviewForNative(overview, nativeMode), revision: currentUiRevision() }, "overview_legacy");
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
app.post("/api/stream/ticket", requirePermission("account.read"), (req, res) => {
  if (authRequired() && !req.user) return res.status(401).json({ error: "Authentication required" });
  res.setHeader("Referrer-Policy", "no-referrer");
  res.json(issueStreamTicket({
    userId: req.user?.id || db.user?.id || "owner",
    sessionId: req.session?.id || null,
    tenantId: req.tenantId || req.user?.tenantId || "tenant_owner",
    securityVersion: Number(req.user?.securityVersion || 0),
    scopes: resolvePermissions(db, req.user || db.user),
    ttlMs: STREAM_TICKET_TTL_MS
  }));
});

app.get("/api/stream", (req, res) => {
  const ticketInfo = req.query.ticket ? consumeStreamTicket(String(req.query.ticket)) : null;
  if (req.query.ticket && !ticketInfo) return res.status(401).json({ error: "Stream ticket is invalid, expired, or already used" });
  const initiallyAuthenticated = !authRequired() || Boolean(ticketInfo);
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Referrer-Policy": "no-referrer"
  });
  res.write("retry: 3000\n\n");
  let closed = false;
  const stillAuthorized = () => {
    if (!authRequired()) return true;
    if (!initiallyAuthenticated || !ticketInfo || ticketInfo.expiresAt <= Date.now()) return false;
    const user = (db.users || []).find((row) => row.id === ticketInfo.userId);
    const session = (db.authSessions || []).find((row) => row.id === ticketInfo.sessionId && row.userId === ticketInfo.userId
      && (!row.expiresAt || new Date(row.expiresAt).getTime() > Date.now()));
    if (!user || user.status === "disabled" || !session) return false;
    if (Number(user.securityVersion || 0) !== Number(ticketInfo.securityVersion || 0)) return false;
    if (String(session.tenantId || user.tenantId || "tenant_owner") !== String(ticketInfo.tenantId || "")) return false;
    const currentScopes = new Set(resolvePermissions(db, user));
    const ticketScopes = new Set(ticketInfo.scopes || []);
    const accountRead = (currentScopes.has("*") || currentScopes.has("account.read"))
      && (ticketScopes.has("*") || ticketScopes.has("account.read"));
    if (!accountRead) return false;
    return resolveTenantEntitlement(db, { user, tenantId: ticketInfo.tenantId }).allowed;
  };
  const closeStream = () => {
    if (closed) return;
    closed = true;
    clearInterval(keepAlive);
    removeStreamListener(send);
    try { res.end(); } catch { /* noop */ }
  };
  const send = (update) => {
    if (!stillAuthorized() && !isPublicMarketStreamUpdate(update)) return closeStream();
    // 匿名连接只放行公开行情；持有效票据的连接可收 portfolio/knowledge_updated 等本人数据。
    if (!initiallyAuthenticated && !isPublicMarketStreamUpdate(update)) return;
    try { res.write(`data: ${JSON.stringify(update)}\n\n`); } catch { /* noop */ }
  };
  addStreamListener(send);
  const keepAlive = setInterval(() => {
    if (!stillAuthorized() && initiallyAuthenticated) return closeStream();
    try { res.write(": ping\n\n"); } catch { closeStream(); }
  }, 15000);
  req.on("close", closeStream);
});

// markets/positions/orders/fills 路由已迁至 server/routes/tradingData.mjs
// mandates 路由组已迁至 server/routes/mandates.mjs（见文件末尾 registerMandateRoutes）

// 观察哨：主人手动撤销（登记/自动撤销走 AI 工具与哨兵，均带审计）
app.post("/api/watch-triggers/:id/cancel", requirePermission("write:mandate"), (req, res) => {
  const result = cancelWatch(db, req.params.id, db.user?.name || "Owner", String(req.body?.reason || "主人手动撤销"));
  if (!result.ok) return res.status(404).json({ error: result.error });
  persist(res, { message: `已撤销观察哨：${req.params.id}`, watch: result.watch });
});

app.post("/api/armed-setups/:id/cancel", requirePermission("write:trade_plan"), (req, res) => {
  const result = cancelArmedSetup(db, req.params.id, db.user?.name || "Owner", String(req.body?.reason || "主人手动撤销"));
  if (!result.ok) return res.status(404).json(result);
  saveDb(db);
  res.json(result);
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
  // 原始 payload 不能成为“审批能力”。真实交易必须从 plan approval -> ExecutionEngine，
  // 撤单/平仓必须从 execution-order intent 状态机进入；该通用网关不再对外执行任何动作。
  appendAudit(db, "拒绝外部原始交易动作入口", req.params.action, req.user?.name || "TradeExecutor", "warning");
  saveDb(db);
  res.status(410).json({
    error: "raw_trade_action_endpoint_disabled",
    message: "请通过交易计划批准或执行单撤销/平仓接口操作；客户端布尔值不能代替服务端授权。"
  });
});

// realtime status/start/stop 路由已迁至 server/routes/realtime.mjs

// reconciler 路由已迁至 server/routes/observability.mjs

// trade-plans 路由组已迁至 server/routes/tradePlans.mjs（agent/actions 确认路由与
// executePendingAction 因与对话确认强耦合，仍留在本文件）

// AI 交易员代操作：待确认操作的执行（点确认后）。真钱/授权动作仍受各自的硬闸约束（防御纵深）。
async function executePendingAction(db, record, context = {}) {
  const actor = context.actor || "Owner";
  const a = record.args || {};
  if (record.type === "run_reconcile") {
    return { ok: true, result: runReconciler(db, { mode: "agent_confirm" }) };
  }
  if (record.type === "kill_switch") {
    return applyKillSwitch(db, {
      enabled: a.enabled !== false,
      reason: "对话确认",
      actor
    }, { closeExecution, notifyLark, appendAudit, appendTrace, id, nowIso });
  }
  if (record.type === "set_live_gate") {
    const input = liveGateInput(db, a);
    if (!input) return { ok: false, status: 400, error: "invalid_live_gate" };
    if (a.enabled !== false && !a.liveConfigFingerprint) return { ok: false, status: 409, error: "missing_live_config_confirmation_snapshot" };
    return applyLiveTradingConfiguration(db, input, {
      user: context.user,
      actor,
      setConfig,
      appendAudit,
      nowIso,
      expectedFingerprint: a.liveConfigFingerprint || undefined
    });
  }
  if (record.type === "set_execution_mode") {
    if (!a.liveConfigFingerprint) return { ok: false, status: 409, error: "missing_live_config_confirmation_snapshot" };
    return applyLiveTradingConfiguration(db, {
      requestedMode: a.mode,
      ...(a.mode === "observe" ? {} : { acknowledged: true })
    }, {
      user: context.user,
      actor,
      setConfig,
      appendAudit,
      nowIso,
      expectedFingerprint: a.liveConfigFingerprint
    });
  }
  if (record.type === "mandate") {
    const m = (db.mandates || []).find((x) => x.id === (a.resolvedTargetId || a.mandateId)) || db.mandates?.[0];
    if (!m) return { ok: false, error: "mandate_not_found" };
    const result = transitionMandate(db, m.id, a.op, { actor, nowIso, appendAudit });
    if (!result.ok) return result;
    return { ok: true, mandate: { id: result.mandate.id, status: result.mandate.status, version: result.mandate.version } };
  }
  if (record.type === "approve_plan") {
    const plan = (db.tradePlans || []).find((p) => p.id === (a.resolvedTargetId || a.planId));
    return approveTradePlan(db, plan, {
      evaluateTradePlan, executeApprovedPlan, describeGuardReason, appendAudit, nowIso
    }, { actor, auditLabel: "对话确认：批准交易计划", snapshot: a });
  }
  return { ok: false, error: "unknown_action_type" };
}

app.post("/api/agent/actions/:id/confirm", async (req, res) => {
  const record = (db.pendingActions || []).find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ error: "待确认操作不存在" });
  if (record.status !== "awaiting_confirmation") return res.status(409).json({ error: "该操作已处理或正在执行" });
  if (record.tenantId && record.tenantId !== (req.tenantId || "tenant_owner")) {
    return res.status(404).json({ error: "待确认操作不存在" });
  }
  const authorization = canConfirmPendingAction(db, req.user, record);
  if (!authorization.allowed) {
    return res.status(403).json({ error: `Missing permission: ${authorization.requiredPermission || "unknown_action"}` });
  }
  if (!record.expiresAt || new Date(record.expiresAt).getTime() <= Date.now()) {
    record.status = "expired";
    record.resolvedAt = nowIso();
    saveDb(db);
    return res.status(409).json({ error: "pending_action_expired" });
  }
  const actor = req.user?.name || "Unknown user";
  if (record.type === "approve_plan") {
    const plan = (db.tradePlans || []).find((item) => item.id === (record.args?.resolvedTargetId || record.args?.planId));
    const validation = validateApprovalSnapshot(plan, record.args || {});
    if (!validation.ok) return res.status(validation.status || 409).json({ error: validation.error, currentStatus: validation.currentStatus });
  }
  // 单进程事件循环内先同步 claim，再在任何 await/交易动作前持久化；并发 confirm/cancel
  // 只有一个请求能从 awaiting_confirmation 取得处理权。
  record.status = "processing";
  record.claimedAt = nowIso();
  record.claimedByUserId = req.user?.id || null;
  record.claimToken = id("claim");
  saveDb(db);
  let result;
  try {
    result = await executePendingAction(db, record, { actor, user: req.user });
  } catch (error) {
    result = { ok: false, status: 500, error: error.message };
  }
  record.status = result.ok ? "executed" : "failed";
  record.result = result;
  record.resolvedByUserId = req.user?.id || null;
  record.resolvedBy = actor;
  record.resolvedAt = nowIso();
  const httpStatus = result.ok ? 200 : Number(result.status || 422);
  persist(res.status(httpStatus), { action: record, result });
});

app.post("/api/agent/actions/:id/cancel", requirePermission("write:mandate"), (req, res) => {
  const record = (db.pendingActions || []).find((item) => item.id === req.params.id);
  if (!record) return res.status(404).json({ error: "待确认操作不存在" });
  if (record.tenantId && record.tenantId !== (req.tenantId || "tenant_owner")) return res.status(404).json({ error: "待确认操作不存在" });
  if (record.status !== "awaiting_confirmation") return res.status(409).json({ error: "该操作已处理或正在执行" });
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
  rankEvents, scheduleTask, unscheduleTask, validateTaskDefinition, runTask,
  larkStatus, telegramStatus, notifyLark, sendTelegramPositionPoster,
  telegramWatchStatus, telegramWatchDeliveryHealth, queueWatchTelegramEvent, dispatchTelegramWatchOutbox,
  buildPaperReport, createPaperSession, ensurePaperSessionsFromProfiles, runPaperForward, startOwnerCandidatePaperSession, syncKnowledgeSkillLifecycle,
  storeSecret, connectMcpServer, refreshEventSources, refreshOnchainSignals, testEventSource, assertSafeExternalUrl,
  listVaultItems, clearSecret, refreshApiKeyMetadata, syncPrivateReadOnly, startRealtimeManager, validateOkxCredentialCandidate, invalidateOkxCredentialCaches,
  getConfigStatus, validateRuntimeConfig, setConfig, sendAlert, runSafetyDrill, verifyAuditChain, auditChainStatus,
  addMonthsIso, verifyTrc20Payments, activateSubscriptionFromPayment,
  activeStrategyProfiles, runStrategyResearch, buildStrategyBoard, buildStrategyCatalog, STRATEGIES,
  buildReviewAnalytics, backfillReviewFields, createStrategyImprovementCycle, validateStrategyImprovementCycle,
  hashPassword, verifyPassword, sanitizeUserRecord, invalidateSessions, invalidateUserSessions,
  syncPublicKlines, syncMicrostructure, reconcileAccount, syncPrivateReadOnly, syncPublicMarket, guardedPrivateExchangeAction,
  evaluateTradePlan, userHasPermission, closeExecution, notifyLark, validateConditionSpec, validateDynamicRiskAction,
  runExpertAnalysis, bindKnowledgeSkillsToPlan, executeApprovedPlan, describeGuardReason, executeTradePlan,
  cancelArmedSetup,
  fetchSkillPackage, scanSkill, installSkill, verifySkillPackageIntegrity, readSkillInstructions, runSkillSandbox,
  fetchMarketRegime, fetchPerpetualInstruments, fetchPerpetualInstrumentCatalog, getHistoricalKlines, fetchTokenProfile,
  listStrategies, buildPortfolioRisk, runBacktest, performanceReport, refreshAccounting,
  realtimeStatus, startMarketStream, stopMarketStream, stopRealtimeManager, pollExecutionOrders, activeMandate,
  handleKnowledgeImport, importGithubKnowledge, parseKnowledgeRealSource, retireSkillsForSource, ragQuery, embeddingStatus, reembedAllChunks, removeManagedKnowledgeFile,
  knowledgeSkillSummary, compileTradingMethod, validateKnowledgeSkill, startKnowledgeSkillPaper, validateAllCompiledSkills, approveKnowledgeSkill, retireKnowledgeSkill,
  compileNaturalRiskCondition, validateDynamicRiskAction, consolidateRuleProposals, broadcastRaw,
  activeProvider, runAgentChat, runAgentCommand, updateStateFile, approveStateFile, getAgentStatus, addMemoryItem, changeAgentRunStatus, runAgentCycle,
  buildReadinessReport, createSystemBackup, resetOperationalData, getStorageInfo, userHasPermission, llmComplete
});

// Express 4 默认不会接住 async handler 的 rejected Promise；上方补丁把它们汇入这里。
// 生产响应不回显堆栈/内部路径，防止单个外部 API 抖动演变成未处理拒绝或信息泄露。
app.use((error, req, res, _next) => {
  if (res.headersSent) return _next(error);
  const status = Number(error.status || error.statusCode) || 500;
  console.error(`[request-error] ${req.method} ${req.path}: ${error.message}`);
  res.status(status).json({
    error: status >= 500 && process.env.NODE_ENV === "production" ? "Internal server error" : error.message
  });
});

app.listen(port, host, () => {
  recordStartupPhase("post_database_initialization", postDatabaseStartupAt);
  recordStartupReady();
  console.log(`KORDYN API listening on http://${host}:${port}`);
});
