import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { performanceReport, refreshAccounting } from "./accounting.mjs";
import { applyStoredConfigToEnv, clearSecret, getConfigStatus, setConfig } from "./runtimeConfig.mjs";
import { activeProvider, runAgentChat } from "./agentChat.mjs";
import { addMemoryItem, recheckActivePlanRisk, runAgentCycle, updateStateFile } from "./agentRuntime.mjs";
import { closeExecution, executeApprovedPlan, pollExecutionOrders } from "./executionEngine.mjs";
import { monitorPositions } from "./positionManager.mjs";
import { activateMandate, changeAgentRunStatus, getAgentStatus, parseMandateCommand, runAgentCommand } from "./agentOrchestrator.mjs";
import { installAuth, requirePermission } from "./auth.mjs";
import { exportAuditLogs, exportTraces } from "./auditExport.mjs";
import { executeTradePlan } from "./executor.mjs";
import { guardedPrivateExchangeAction, reconcileAccount, refreshApiKeyMetadata, syncMicrostructure, syncPrivateReadOnly, syncPublicKlines, syncPublicMarket } from "./exchangeConnector.mjs";
import { runBacktest } from "./backtestEngine.mjs";
import { activeStrategyProfiles, runStrategyResearch } from "./strategyOptimizer.mjs";
import { listStrategies } from "./strategies.mjs";
import { buildPortfolioRisk } from "./portfolioRisk.mjs";
import { larkStatus, notifyLark } from "./larkNotifier.mjs";
import { refreshEventSources, refreshOnchainSignals } from "./eventSources.mjs";
import { embeddingStatus, importGithubKnowledge, importKnowledge as importKnowledgeReal, parseKnowledgeSource as parseKnowledgeRealSource, ragQuery, reembedAllChunks } from "./knowledgePipeline.mjs";
import { runExpertAnalysis } from "./knowledgeEngine.mjs";
import { runLlmAgent } from "./llmAgent.mjs";
import { installProxyFromEnv } from "./netProxy.mjs";
import { buildReadinessReport, createSystemBackup } from "./ops.mjs";
import { runReconciler } from "./reconciler.mjs";
import { backfillReviewFields, buildReviewAnalytics, createStrategyImprovementCycle } from "./reviewEngine.mjs";
import { realtimeStatus, startRealtimeManager, stopRealtimeManager } from "./realtimeManager.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { ensureSystemTask, registerTaskHandler, runTask, scheduleTask, schedulerStatus, startScheduler } from "./scheduler.mjs";
import { listVaultItems, runSafetyDrill, sendAlert, storeSecret } from "./securityOps.mjs";
import { installSkill, scanSkill } from "./skillManager.mjs";
import { fetchSkillPackage, runSkillSandbox } from "./skillSandbox.mjs";
import { appendAudit, appendTrace, getStorageInfo, id, loadDb, nowIso, saveDb, verifyAuditChain } from "./store.mjs";
import { executeTradeAction } from "./tradeActions.mjs";

dotenv.config();
installProxyFromEnv();

const app = express();
const db = loadDb();
app.locals.db = db;

applyStoredConfigToEnv(db);
installProxyFromEnv();
const port = Number(process.env.PORT || 8787);
db.system.liveTradingEnabled = process.env.LIVE_TRADING_ENABLED === "true" && process.env.I_UNDERSTAND_REAL_TRADING === "true";
refreshApiKeyMetadata(db);
saveDb(db);

app.use(cors());
app.use(express.json({ limit: "20mb" }));
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
ensureSystemTask(db, { id: "task_sys_execution_poll", name: "执行订单轮询", handler: "execution_poll", schedule: "Every 1m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_position_monitor", name: "持仓风险监控", handler: "position_monitor", schedule: "Every 2m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_accounting", name: "盈亏核算刷新", handler: "accounting_refresh", schedule: "Every 5m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_agent_cycle", name: "自主巡检决策", handler: "agent_cycle", schedule: "Every 15m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_reconcile", name: "账户对账", handler: "reconcile", schedule: "Every 10m" }, saveDb);
ensureSystemTask(db, { id: "task_sys_strategy_research", name: "自适应策略研究", handler: "strategy_research", schedule: "Every 6h" }, saveDb);

startScheduler(db, saveDb);
startRealtimeManager(db, saveDb);
refreshAccounting(db);

function persist(res, payload) {
  saveDb(db);
  res.json(payload);
}

async function importAndMaybeParseKnowledge(payload = {}) {
  const source = await importKnowledgeReal(db, payload);
  if (payload.autoParse === false) return { message: "知识来源已导入，尚未解析", source };
  const parsed = await parseKnowledgeRealSource(db, source.id);
  return { message: parsed.message || "知识来源已导入并解析", source: parsed.source || source, parsed };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, liveTradingEnabled: db.system.liveTradingEnabled, updatedAt: db.meta.updatedAt, storage: getStorageInfo() });
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
  res.json({
    user: db.user,
    system: db.system,
    agentStatus: getAgentStatus(db),
    portfolio: db.portfolio,
    markets: db.markets,
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
    portfolioRisk: buildPortfolioRisk(db, db.mandates.find((m) => ["active", "running"].includes(m.status))),
    larkConfigured: larkStatus().configured,
    embeddingStatus: embeddingStatus(db),
    reviewAnalytics: buildReviewAnalytics(db),
    runtimeConfig: db.runtimeConfig || {},
    config: getConfigStatus(db),
    readiness: buildReadinessReport(db)
  });
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

app.post("/api/knowledge/import", requirePermission("write:knowledge"), async (req, res) => {
  try {
    const result = await importAndMaybeParseKnowledge(req.body);
    persist(res, result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/knowledge/import-real", requirePermission("write:knowledge"), async (req, res) => {
  try {
    const result = await importAndMaybeParseKnowledge(req.body);
    persist(res, result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

app.get("/api/agent/chat", (_req, res) => {
  res.json({
    messages: (db.chatMessages || []).slice(-100),
    provider: activeProvider(),
    llmConfigured: Boolean(activeProvider())
  });
});

app.post("/api/agent/chat", requirePermission("write:mandate"), async (req, res) => {
  try {
    const result = await runAgentChat(db, { message: req.body.message }, saveDb);
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
app.get("/api/notifications/lark-status", (_req, res) => res.json(larkStatus()));
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
  const server = { id: id("mcp"), status: "connected", toolCount: 0, permissions: [], ...req.body };
  db.mcpServers.unshift(server);
  appendAudit(db, "注册 MCP Server", server.id, db.user.name);
  persist(res, server);
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
  plan.status = "approved";
  plan.approvedAt = nowIso();
  plan.approvedBy = db.user.name;
  appendAudit(db, "人工批准交易计划", plan.id, db.user.name, "warning");
  // 批准即进入执行引擎：实盘开启则真实下单，关闭则记录干跑结果。
  const execution = await executeApprovedPlan(db, plan.id, { manualApproval: true });
  const messages = {
    dry_run: "计划已批准。实盘写入关闭，执行引擎完成了数量与价格计算（干跑），未向交易所提交。",
    submitted: "计划已批准，入场单已提交到交易所。",
    blocked: `计划已批准，但执行被安全闸拦截：${execution.reason || ""}`,
    already_executing: "该计划已有在途执行单。"
  };
  persist(res, { plan, execution, message: messages[execution.status] || `执行状态：${execution.status}` });
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
  appendAudit(db, db.system.killSwitch ? "启用一键熔断" : "解除一键熔断", "risk.kill_switch", db.user.name, db.system.killSwitch ? "critical" : "info");
  appendTrace(db, "risk", db.system.killSwitch ? "一键熔断开启" : "一键熔断解除", db.system.killSwitch ? "blocked" : "ok");
  await notifyLark(db, {
    severity: db.system.killSwitch ? "critical" : "info",
    title: db.system.killSwitch ? "🛑 一键熔断已触发" : "🟢 熔断已解除",
    body: db.system.killSwitch ? "所有新开仓已被阻断，在途委托已请求撤单。请检查账户与市场。" : "熔断解除，系统恢复正常风控运行。"
  });
  persist(res, db.system);
});

app.get("/api/risk/status", (_req, res) => {
  res.json({ system: db.system, rules: db.riskRules, incidents: db.riskIncidents, checks: db.riskChecks.slice(0, 20) });
});

app.get("/api/risk/rules", (_req, res) => res.json(db.riskRules));
app.post("/api/risk/rules", requirePermission("write:risk"), (req, res) => {
  const rule = { id: id("risk"), name: req.body.name || "新风控规则", scope: req.body.scope || "trade", level: req.body.level || "L2", enabled: true, action: req.body.action || "notify", description: req.body.description || "", createdAt: nowIso() };
  db.riskRules.unshift(rule);
  appendAudit(db, "创建风控规则", rule.id, db.user.name);
  persist(res, rule);
});

app.patch("/api/risk/rules/:id", requirePermission("write:risk"), (req, res) => {
  const rule = db.riskRules.find((item) => item.id === req.params.id);
  if (!rule) return res.status(404).json({ error: "Risk rule not found" });
  const allowed = ["name", "scope", "level", "enabled", "action", "description"];
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
  const result = storeSecret(db, req.body.name, req.body.value, req.body.scope);
  persist(res, result);
});

app.post("/api/security/exchange-credentials", requirePermission("admin:security"), (req, res) => {
  const exchange = String(req.body.exchange || "").toUpperCase();
  if (!["BINANCE", "OKX"].includes(exchange)) return res.status(400).json({ error: "exchange must be BINANCE or OKX" });
  const account = db.exchangeAccounts.find((item) => item.exchange === exchange);
  if (!account) return res.status(404).json({ error: "Exchange account not found" });

  const saved = [];
  function saveSecret(envName, value) {
    if (!value) return;
    process.env[envName] = String(value);
    saved.push(storeSecret(db, envName, value, "exchange"));
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
  account.readEnabled = exchange === "BINANCE" ? Boolean(process.env.BINANCE_API_KEY) : Boolean(process.env.OKX_API_KEY);
  account.tradeEnabled = exchange === "BINANCE"
    ? Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET)
    : Boolean(process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE);
  account.withdrawEnabled = false;
  account.status = account.readEnabled ? "configured" : "missing_credentials";
  account.lastCredentialUpdateAt = nowIso();
  refreshApiKeyMetadata(db);
  appendAudit(db, `配置 ${exchange} API 凭证`, account.id, db.user.name, "warning");
  persist(res, {
    message: `${exchange} API 配置已保存${account.tradeEnabled ? "，读写凭证完整" : "，仍缺少 Secret/Passphrase"}`,
    account,
    saved: saved.map((item) => ({ id: item.id, name: item.name, scope: item.scope }))
  });
});

app.get("/api/config", (_req, res) => {
  res.json(getConfigStatus(db));
});

// 通用配置写入：LLM 密钥/模型、非敏感开关。敏感项加密入库，不回传明文。
app.post("/api/config", requirePermission("admin:security"), (req, res) => {
  const applied = setConfig(db, req.body || {});
  refreshApiKeyMetadata(db);
  saveDb(db);
  res.json({ message: applied.length ? `已保存：${applied.join("、")}` : "无变更", applied, status: getConfigStatus(db) });
});

// 实盘开关 + 灰度额度（高危，集中一处并写审计）。
app.post("/api/config/live-trading", requirePermission("admin:security"), (req, res) => {
  const entries = {};
  if (req.body.liveTradingEnabled !== undefined) entries.LIVE_TRADING_ENABLED = req.body.liveTradingEnabled ? "true" : "false";
  if (req.body.acknowledged !== undefined) entries.I_UNDERSTAND_REAL_TRADING = req.body.acknowledged ? "true" : "false";
  if (req.body.orderWriteEnabled !== undefined) entries.REAL_ORDER_WRITE_ENABLED = req.body.orderWriteEnabled ? "true" : "false";
  if (req.body.maxNotionalUsdt !== undefined) entries.MAX_LIVE_NOTIONAL_USDT = String(Number(req.body.maxNotionalUsdt) || 50);
  setConfig(db, entries);

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

app.post("/api/review/strategy-improvement", requirePermission("write:review"), (req, res) => {
  const result = createStrategyImprovementCycle(db, req.body || {});
  persist(res, result);
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

app.listen(port, "127.0.0.1", () => {
  console.log(`AI Trading Agent API listening on http://127.0.0.1:${port}`);
});
