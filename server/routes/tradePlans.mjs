// 交易计划路由组（创建/列表/详情/风控校验/请求批准/批准执行/取消/直接执行拒绝）——
// 从 index.mjs 按 registrar 范式迁出（agent/actions 确认路由与 executePendingAction 仍留 index.mjs）。
// 批准前风控复查、终态计划禁止重复执行(P1-7)、直接执行接口硬拒 等语义逐字保留。依赖经 ctx 注入。
import { bindPlanToStrategyProduct } from "../strategyProducts.mjs";
import { ensureDecisionFactSnapshot } from "../ownerReviewLoop.mjs";
import {
  approveTradePlan,
  assertUniquePlanId,
  constructTradePlan,
  requestPlanApprovalTransition,
  validateLocalPlanCancel
} from "../tradePlanLifecycle.mjs";

export function registerTradePlanRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, appendTrace, runExpertAnalysis, bindKnowledgeSkillsToPlan, evaluateTradePlan, executeApprovedPlan, describeGuardReason, executeTradePlan, cancelArmedSetup } = ctx;
  const findPlan = (idv) => db.tradePlans.find((item) => item.id === idv);
  const notFound = (res) => res.status(404).json({ error: "Trade plan not found" });

  app.post("/api/trade-plans", requirePermission("write:trade_plan"), (req, res) => {
    const selectedMandate = req.body.mandateId
      ? db.mandates.find((item) => item.id === req.body.mandateId)
      : db.mandates[0];
    const generatedId = id("plan");
    if (!assertUniquePlanId(db, generatedId)) return res.status(409).json({ error: "duplicate_trade_plan_id" });
    const created = constructTradePlan(req.body || {}, {
      id: generatedId,
      mandateId: selectedMandate?.id,
      strategy: selectedMandate?.strategies?.[0] || "trend_following",
      mandateVersion: Number(selectedMandate?.version || 1),
      createdAt: nowIso()
    });
    if (!created.ok) return res.status(created.status).json({ error: created.error, fields: created.fields });
    const plan = created.plan;
    plan.tenantId = req.user?.tenantId || db.user?.tenantId || "tenant_owner";
    plan.ownerUserId = req.user?.id || db.user?.id || null;
    const bundle = runExpertAnalysis(db, {
      trigger_type: "autonomous_trade_precheck",
      question: `${plan.symbol} ${plan.direction} 计划前置审查`,
      symbol: plan.symbol,
      principal: { tenantId: plan.tenantId, userId: plan.ownerUserId, isOwner: req.user?.isOwner === true }
    });
    plan.analysisBundleId = bundle.id;
    bindKnowledgeSkillsToPlan(db, plan, {
      timeframe: req.body.timeframe || "1h",
      regime: db.marketRegime?.regime || db.marketRegime?.label || ""
    }, req.user?.name || "Trader");
    // 手工/API 创建仍允许研究性自定义计划，但只对能确定匹配的五类策略写入版本归因；
    // 未归类计划会明确标成 legacy_unclassified，不会混入任何策略产品的成绩。
    bindPlanToStrategyProduct(db, plan, { source: "trade_plan_api" });
    db.tradePlans.unshift(plan);
    ensureDecisionFactSnapshot(db, plan, {
      captureMode: "manual_api_pre_approval",
      capturedBeforeExecution: true
    });
    appendAudit(db, "创建交易计划", plan.id, "AI 交易员");
    persist(res, { plan, analysisBundle: bundle });
  });

  app.get("/api/trade-plans", requirePermission("account.read"), (_req, res) => res.json(db.tradePlans));
  app.get("/api/trade-plans/:id", requirePermission("account.read"), (req, res) => {
    const plan = findPlan(req.params.id);
    if (!plan) return notFound(res);
    res.json(plan);
  });

  app.post("/api/trade-plans/:id/risk-check", requirePermission("risk.check"), (req, res) => {
    const plan = findPlan(req.params.id);
    if (!plan) return notFound(res);
    const result = evaluateTradePlan(db, { ...plan, ...req.body });
    result.tradePlanId = plan.id;
    result.tenantId = plan.tenantId || plan.ownerTenantId || db.user?.tenantId || "tenant_owner";
    result.ownerUserId = plan.ownerUserId || plan.createdByUserId || plan.userId || db.user?.id || null;
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
    const transition = requestPlanApprovalTransition(plan, nowIso());
    if (!transition.ok) return res.status(transition.status).json({ error: transition.error, currentStatus: transition.currentStatus });
    appendAudit(db, "交易计划请求人工确认", plan.id, "AgentOrchestrator");
    persist(res, plan);
  });

  app.post("/api/trade-plans/:id/approve", requirePermission("approve:trade_plan"), async (req, res) => {
    const plan = findPlan(req.params.id);
    if (!plan) return notFound(res);
    const actor = req.user?.name || db.user.name;
    const result = await approveTradePlan(db, plan, {
      evaluateTradePlan, executeApprovedPlan, describeGuardReason, appendAudit, nowIso
    }, { actor });
    if (!result.ok) {
      const message = result.error === "risk_check_required" ? "计划尚未通过风控检查，先运行 risk-check"
        : result.error === "risk_blocked" ? `批准前风控复查失败：${result.summary || "风控未通过"}`
          : result.error === "execution_not_submitted" ? `计划批准已消费，但没有向交易所提交订单：${result.execution?.reason || result.execution?.status || "执行前安全闸阻断"}。请修复原因后重新请求批准，或取消该计划。`
          : `计划状态 ${plan.status} 不可批准`;
      return res.status(result.status || 409).json({ ...result, error: message, message });
    }
    const { execution, guard } = result;
    const messages = {
      dry_run: "计划已批准。实盘写入关闭，执行引擎完成了数量与价格计算（干跑），未向交易所提交。",
      submitted: "计划已批准，入场单已提交到交易所。",
      blocked: guard ? `计划已批准，但执行被安全闸拦截：${guard.label}。${guard.fix ? "开启方式：" + guard.fix : ""}` : "计划已批准，但执行被安全闸拦截。",
      already_executing: "该计划已有在途执行单。"
    };
    const payload = { plan, execution, guard, approvalGranted: true, executionSubmitted: result.executionSubmitted, message: messages[execution.status] || `执行状态：${execution.status}` };
    if (result.status === 202) return res.status(202).json(payload);
    persist(res, payload);
  });

  app.post("/api/trade-plans/:id/cancel", requirePermission("write:trade_plan"), (req, res) => {
    const plan = findPlan(req.params.id);
    if (!plan) return notFound(res);
    const cancelCheck = validateLocalPlanCancel(db, plan);
    if (!cancelCheck.ok) {
      return res.status(cancelCheck.status).json({
        error: cancelCheck.error,
        currentStatus: cancelCheck.currentStatus,
        executionOrders: cancelCheck.executionOrders,
        message: cancelCheck.error === "plan_has_remote_execution"
          ? "该计划已有远端在途订单或持仓。请在执行单中按当前状态明确选择撤单或平仓。"
          : "当前计划状态不能作为本地决策记录取消。"
      });
    }
    if (cancelCheck.idempotent) return res.json({ ...plan, idempotent: true });
    if (plan.armedSetupId && typeof cancelArmedSetup === "function") {
      cancelArmedSetup(db, plan.armedSetupId, req.user?.name || db.user.name, req.body.reason || "user_cancelled");
    }
    plan.status = "cancelled";
    plan.cancelledAt = nowIso();
    plan.cancelReason = req.body.reason || "user_cancelled";
    plan.updatedAt = plan.cancelledAt;
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
