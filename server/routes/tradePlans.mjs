// 交易计划路由组（创建/列表/详情/风控校验/请求批准/批准执行/取消/直接执行拒绝）——
// 从 index.mjs 按 registrar 范式迁出（agent/actions 确认路由与 executePendingAction 仍留 index.mjs）。
// 批准前风控复查、终态计划禁止重复执行(P1-7)、直接执行接口硬拒 等语义逐字保留。依赖经 ctx 注入。
import { bindPlanToStrategyProduct } from "../strategyProducts.mjs";

export function registerTradePlanRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, appendTrace, runExpertAnalysis, bindKnowledgeSkillsToPlan, evaluateTradePlan, executeApprovedPlan, describeGuardReason, executeTradePlan, cancelArmedSetup } = ctx;
  const findPlan = (idv) => db.tradePlans.find((item) => item.id === idv);
  const notFound = (res) => res.status(404).json({ error: "Trade plan not found" });

  app.post("/api/trade-plans", requirePermission("write:trade_plan"), (req, res) => {
    const selectedMandate = req.body.mandateId
      ? db.mandates.find((item) => item.id === req.body.mandateId)
      : db.mandates[0];
    const plan = {
      id: id("plan"),
      mandateId: selectedMandate?.id,
      exchange: "OKX",
      marketType: "perpetual_usdt",
      strategy: selectedMandate?.strategies?.[0] || "trend_following",
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
    // 手工/API 创建仍允许研究性自定义计划，但只对能确定匹配的五类策略写入版本归因；
    // 未归类计划会明确标成 legacy_unclassified，不会混入任何策略产品的成绩。
    bindPlanToStrategyProduct(db, plan, { source: "trade_plan_api" });
    db.tradePlans.unshift(plan);
    appendAudit(db, "创建交易计划", plan.id, "AI 交易员");
    persist(res, { plan, analysisBundle: bundle });
  });

  app.get("/api/trade-plans", (_req, res) => res.json(db.tradePlans));
  app.get("/api/trade-plans/:id", (req, res) => {
    const plan = findPlan(req.params.id);
    if (!plan) return notFound(res);
    res.json(plan);
  });

  app.post("/api/trade-plans/:id/risk-check", requirePermission("risk.check"), (req, res) => {
    const plan = findPlan(req.params.id);
    if (!plan) return notFound(res);
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
    const plan = findPlan(req.params.id);
    if (!plan) return notFound(res);
    plan.status = "awaiting_approval";
    plan.approvalRequestedAt = nowIso();
    appendAudit(db, "交易计划请求人工确认", plan.id, "AgentOrchestrator");
    persist(res, plan);
  });

  app.post("/api/trade-plans/:id/approve", requirePermission("approve:trade_plan"), async (req, res) => {
    const plan = findPlan(req.params.id);
    if (!plan) return notFound(res);
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

  app.post("/api/trade-plans/:id/cancel", requirePermission("write:trade_plan"), (req, res) => {
    const plan = findPlan(req.params.id);
    if (!plan) return notFound(res);
    if (plan.armedSetupId && typeof cancelArmedSetup === "function") {
      cancelArmedSetup(db, plan.armedSetupId, req.user?.name || db.user.name, req.body.reason || "user_cancelled");
    }
    plan.status = "cancelled";
    plan.cancelledAt = nowIso();
    plan.cancelReason = req.body.reason || "user_cancelled";
    appendAudit(db, "取消交易计划", plan.id, db.user.name);
    persist(res, plan);
  });

  app.post("/api/trade-plans/:id/execute", requirePermission("critical:trade_execution"), (req, res) => {
    const plan = findPlan(req.params.id);
    if (!plan) return notFound(res);
    const result = executeTradePlan(db, plan, plan.lastRiskCheck);
    appendAudit(db, "拒绝直接执行交易计划接口", plan.id, "ExecutionEngine", "warning");
    appendTrace(db, "trade_execution", `${plan.symbol} direct execute rejected`, "blocked");
    persist(res, result);
  });
}
