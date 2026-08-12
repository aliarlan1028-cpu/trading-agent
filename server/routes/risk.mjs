import { riskGateDecision } from "../riskEngine.mjs";
import { executeTradeAction } from "../tradeActions.mjs";
// 风控路由组（计划风控校验/一键熔断/状态/规则 CRUD/灰度策略/只减仓/一键平仓/风险事件收尾）——
// 从 index.mjs 按 registrar 范式迁出。熔断/只减仓/事件收尾为高危控制面，处理器逐字保留原实现：
// 熔断即撤单+暂停自主+建 incident+飞书告警；解除熔断不强制重开自主。依赖经 ctx 注入。
export function registerRiskRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, appendTrace, evaluateTradePlan, userHasPermission, closeExecution, notifyLark, validateConditionSpec } = ctx;

  app.post("/api/risk/check-trade-plan", requirePermission("risk.check"), (req, res) => {
    const plan = req.body.tradePlanId ? db.tradePlans.find((item) => item.id === req.body.tradePlanId) : req.body;
    if (!plan) return res.status(404).json({ error: "Trade plan not found" });
    const result = evaluateTradePlan(db, plan);
    // 六态统一裁决:ALLOW / REJECT / REDUCE_SIZE / REQUIRE_CONFIRMATION / CLOSE_ONLY / EMERGENCY_STOP
    const gate = riskGateDecision(db, plan);
    result.gateState = gate.state;
    result.gateReason = gate.reason;
    result.tradePlanId = plan.id;
    result.createdAt = nowIso();
    db.riskChecks.unshift(result);
    persist(res, result);
  });

  // 一键平仓:市价平掉所有持仓 + 切只减仓(禁新开仓)。高危,与熔断并列。减风险动作,不受实盘写入闸限制。
  app.post("/api/risk/emergency-flatten", requirePermission("risk.kill_switch"), async (req, res) => {
    const emergencyActionId = id("emergency");
    // 同一真实仓可能同时存在 execution_engine 与 exchange_rest/ws 行；按 OKX+symbol+方向去重，
    // 优先交易所快照，避免一键平仓对同一仓位重复发送 close-position。
    const byPosition = new Map();
    for (const position of db.positions || []) {
      const size = Math.abs(Number(position.size ?? position.pos ?? position.positionAmt ?? 0));
      if (!size || String(position.exchange || "OKX").toUpperCase() !== "OKX") continue;
      const side = String(position.posSide || position.direction || "net").toLowerCase();
      const key = `${position.symbol}|${side}`;
      const current = byPosition.get(key);
      const authoritative = ["exchange_rest", "exchange_ws"].includes(position.source);
      if (!current || authoritative) byPosition.set(key, { ...position, size });
    }
    const positions = [...byPosition.values()];
    const closed = [], errors = [];
    for (const p of positions) {
      try {
        const r = await executeTradeAction(db, "close_position", {
          exchange: "OKX",
          marketType: "perpetual_usdt",
          symbol: p.symbol,
          positionSide: p.posSide || p.direction,
          quantity: p.size,
          reduceOnly: true,
          emergencyActionId,
          emergencyReason: String(req.body?.reason || "operator_emergency_flatten").slice(0, 200)
        });
        if (["ok", "submitted", "idempotent_replay"].includes(r.status)) closed.push(p.symbol); else errors.push(`${p.symbol}: ${r.reason || r.status}`);
      } catch (error) { errors.push(`${p.symbol}: ${error.message}`); }
    }
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy = "emergency_flatten";
    appendAudit(db, `一键平仓：平 ${closed.length} 仓${errors.length ? `，${errors.length} 失败` : ""}，已切只减仓`, emergencyActionId, db.user.name, "critical");
    appendTrace(db, "risk", `一键平仓 ${closed.length} 仓`, errors.length ? "warning" : "ok");
    try { notifyLark(db, { severity: "critical", title: "🚨 一键平仓已触发", body: `已平 **${closed.length}** 个持仓${errors.length ? `，${errors.length} 个失败` : ""}，系统已切「只减仓」禁新开仓。` }); } catch { /* noop */ }
    persist(res, { emergencyActionId, closed, errors, reduceOnly: true, message: `已平 ${closed.length} 仓${errors.length ? `，${errors.length} 失败` : ""}，已切只减仓` });
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

  app.post("/api/risk/thresholds", requirePermission("write:risk_thresholds"), async (req, res) => {
    try {
      const { applyRiskThresholds } = await import("../riskThresholds.mjs");
      const { applyProtections } = await import("../tradeProtections.mjs");
      const { setConfig } = await import("../runtimeConfig.mjs");
      const result = applyRiskThresholds(db, req.body || {}, setConfig);
      const currentProtection = applyProtections(db, req.user?.name || db.user.name);
      if (result.applied.length) appendAudit(db, `更新风控阈值:${result.applied.join("、")}`, "risk_thresholds", req.user?.name || db.user.name, "warning");
      persist(res, { ok: true, ...result, currentProtection, message: result.applied.length ? "风控阈值已更新，并已重新计算当前保护状态" : "无变更" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
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
    const nextAction = req.body.action ?? rule.action ?? "notify";
    const nextConditionSpec = req.body.conditionSpec ?? rule.conditionSpec;
    const conditionValidation = validateConditionSpec(nextConditionSpec);
    if (nextAction !== "notify" && !conditionValidation.valid) {
      return res.status(400).json({ error: `阻断型规则必须提供受支持的 conditionSpec：${conditionValidation.reason}` });
    }
    const allowed = ["name", "scope", "level", "enabled", "action", "description", "event", "condition"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) rule[key] = req.body[key];
    }
    rule.conditionSpec = conditionValidation.valid ? nextConditionSpec : null;
    rule.enforcementStatus = conditionValidation.valid ? "enforced" : "advisory_uncompiled";
    rule.updatedAt = nowIso();
    appendAudit(db, "更新风控规则", rule.id, db.user.name, rule.enabled === false ? "warning" : "info");
    persist(res, { message: `${rule.name} 已更新`, rule });
  });

  // 历史灰度写入口缺少 MFA、全自动安全条件与额度数值校验，能绕过统一实盘配置闸。
  // 保留明确的退役响应，避免旧客户端误以为保存成功；所有变更必须走唯一入口。
  app.post("/api/risk/gray-policies/:id", requirePermission("admin:security"), (_req, res) => {
    res.status(410).json({ error: "该接口已停用，请使用 /api/config/live-trading 更新实盘验证设置" });
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
}
