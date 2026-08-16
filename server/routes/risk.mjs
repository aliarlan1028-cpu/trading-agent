import { riskGateDecision } from "../riskEngine.mjs";
import { canonicalPositionDirection, canonicalPositionKey } from "../positionIdentity.mjs";
import { latestSuccessfulAccountSnapshot } from "../store.mjs";
import { validateOkxCredentialBinding } from "../exchangeConnector.mjs";
import { clearReduceOnlyReason, setReduceOnlyReason, syncReduceOnlyState } from "../reduceOnlyState.mjs";
import { resolvePermissions } from "../auth.mjs";
import { applyKillSwitch, cancelAuthoritativeOrphanOrders } from "../riskControlService.mjs";
// 风控路由组（计划风控校验/一键熔断/状态/规则 CRUD/灰度策略/只减仓/一键平仓/风险事件收尾）——
// 从 index.mjs 按 registrar 范式迁出。熔断/只减仓/事件收尾为高危控制面，处理器逐字保留原实现：
// 熔断即撤单+暂停自主+建 incident+飞书告警；解除熔断不强制重开自主。依赖经 ctx 注入。
export function registerRiskRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, appendTrace, evaluateTradePlan, userHasPermission, closeExecution, notifyLark, validateConditionSpec, validateDynamicRiskAction } = ctx;

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
    const entryExitResults = [];
    const preprocessedEntryIds = new Set();
    for (const row of (db.executionOrders || []).filter((execution) => ["entry_unknown_pending", "entry_pending", "entry_partial"].includes(execution.status))) {
      preprocessedEntryIds.add(row.id);
      const result = await closeExecution(db, row.id, "operator_emergency_flatten_cancel_entry", {
        intent: "emergency_close_if_filled", expectedStatus: row.status, internal: true, emergencyActionId
      });
      entryExitResults.push({ executionOrderId: row.id, status: result.status });
    }
    const orphanCancellations = await cancelAuthoritativeOrphanOrders(db, "operator_emergency_flatten", emergencyActionId);
    // 同一真实仓可能同时存在 execution_engine 与 exchange_rest/ws 行；按 OKX+symbol+方向去重，
    // 优先交易所快照，避免一键平仓对同一仓位重复发送 close-position。
    const byPosition = new Map();
    for (const position of db.positions || []) {
      const size = Math.abs(Number(position.size ?? position.pos ?? position.positionAmt ?? 0));
      if (!size || String(position.exchange || "OKX").toUpperCase() !== "OKX") continue;
      const side = canonicalPositionDirection(position);
      const key = canonicalPositionKey(position);
      if (!key || !side) continue;
      const current = byPosition.get(key);
      const authoritative = ["exchange_rest", "exchange_ws"].includes(position.source);
      if (!current || authoritative) byPosition.set(key, { ...position, size });
    }
    const positions = [...byPosition.values()];
    const submitted = [], errors = [];
    for (const p of positions) {
      try {
        const direction = canonicalPositionDirection(p);
        const affected = (db.executionOrders || []).filter((row) => row.symbol === p.symbol && canonicalPositionDirection(row) === direction
          && ["entry_unknown_pending", "entry_pending", "entry_partial", "cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending", "entry_filled", "protecting", "protecting_degraded", "close_pending", "close_unknown_pending", "close_reconciliation_pending"].includes(row.status));
        const entryInFlight = affected.filter((row) => ["entry_unknown_pending", "entry_pending", "entry_partial", "cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending"].includes(row.status));
        const entryToCancel = entryInFlight.filter((row) => ["entry_unknown_pending", "entry_pending", "entry_partial"].includes(row.status));
        for (const row of entryToCancel.filter((candidate) => !preprocessedEntryIds.has(candidate.id))) {
          await closeExecution(db, row.id, "operator_emergency_flatten_cancel_entry", { intent: "emergency_close_if_filled", expectedStatus: row.status, internal: true, emergencyActionId });
        }
        const groupKey = `flatten:${p.accountId || "unbound"}:${p.symbol}:${direction}`;
        const existingGroup = (db.executionOrders || []).find((row) => row.syntheticEmergency === true && row.groupCloseKey === groupKey
          && !["closed", "group_closed", "cancelled"].includes(row.status));
        const existingMemberIds = new Set(existingGroup?.affectedExecutionOrderIds || []);
        const positionAffected = affected.filter((row) => ["entry_filled", "protecting", "protecting_degraded"].includes(row.status))
          .concat((db.executionOrders || []).filter((row) => existingMemberIds.has(row.id) && row.status === "group_close_pending"));
        let execution = entryInFlight.length === 0 && positionAffected.length === 1 ? positionAffected[0] : null;
        if (existingGroup) execution = existingGroup;
        if (!execution) {
          const priorStatuses = Object.fromEntries(positionAffected.map((row) => [row.id, row.status]));
          execution = {
            id: id("exec_emergency"),
            exchange: "OKX",
            accountId: p.accountId || null,
            symbol: p.symbol,
            direction,
            quantity: p.coinSize ?? p.size,
            filledQuantity: p.coinSize ?? null,
            okxCtVal: p.contractMultiplier ?? null,
            status: "entry_filled",
            syntheticEmergency: true,
            groupCloseKey: groupKey,
            groupCloseIntent: { status: "preparing", priorStatuses, createdAt: nowIso() },
            events: [{ at: nowIso(), event: "emergency_group_created", detail: emergencyActionId }],
            // 只有已经形成当前物理净仓的执行参与 group close 财务收口；入场在途继续
            // 保持自己的撤单/成交竞态状态机，不能被 synthetic 状态吞掉。
            affectedExecutionOrderIds: positionAffected.map((row) => row.id),
            linkedEntryExecutionOrderIds: entryInFlight.map((row) => row.id),
            createdAt: nowIso()
          };
          db.executionOrders.unshift(execution);
          for (const row of entryInFlight) row.groupCloseExecutionId = execution.id;
          for (const row of positionAffected) {
            row.status = "group_close_pending";
            row.groupCloseExecutionId = execution.id;
          }
        }
        const currentStatus = execution.status;
        const intent = ["entry_unknown_pending", "entry_pending", "entry_partial"].includes(currentStatus) ? "emergency_close_if_filled" : "close_position";
        const r = await closeExecution(db, execution.id, "operator_emergency_flatten", { intent, expectedStatus: currentStatus, internal: true, emergencyActionId });
        execution.groupCloseIntent ||= { priorStatuses: {} };
        execution.groupCloseIntent.lastStatus = r.status;
        execution.groupCloseIntent.updatedAt = nowIso();
        if (/pending/.test(String(r.status))) {
          execution.groupCloseIntent.status = "pending";
          submitted.push({ symbol: p.symbol, direction, executionOrderId: execution.id, status: r.status });
        } else {
          execution.groupCloseIntent.status = "retryable_failure";
          for (const [rowId, priorStatus] of Object.entries(execution.groupCloseIntent.priorStatuses || {})) {
            const row = (db.executionOrders || []).find((candidate) => candidate.id === rowId);
            if (row?.status === "group_close_pending" && row.groupCloseExecutionId === execution.id) {
              row.status = priorStatus;
              delete row.groupCloseExecutionId;
            }
          }
          errors.push(`${p.symbol}: ${r.status}`);
        }
      } catch (error) { errors.push(`${p.symbol}: ${error.message}`); }
    }
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy = "emergency_flatten";
    setReduceOnlyReason(db, "emergency_flatten", { sticky: true, sourceId: emergencyActionId });
    appendAudit(db, `一键平仓：已提交 ${submitted.length} 个退出动作${errors.length ? `，${errors.length} 个未提交` : ""}；等待交易所快照与成交核算，保持只减仓`, emergencyActionId, db.user.name, "critical");
    appendTrace(db, "risk", `一键平仓提交 ${submitted.length} 个退出动作`, errors.length ? "warning" : "pending");
    try { notifyLark(db, { severity: "critical", title: "🚨 一键平仓请求已提交", body: `已提交 **${submitted.length}** 个退出动作${errors.length ? `，${errors.length} 个未提交` : ""}。ACK 不代表成交完成；系统保持只减仓，等待账户快照与真实 fills 对账。` }); } catch { /* noop */ }
    res.status(202);
    persist(res, { emergencyActionId, submitted, entryExitResults, orphanCancellations, errors, reduceOnly: true, message: `已提交 ${submitted.length} 个平仓请求及 ${entryExitResults.length + orphanCancellations.requested.length} 个撤单请求，等待交易所事实对账` });
  });

  app.post("/api/risk/kill-switch", async (req, res) => {
    const requiredPermission = req.body.enabled === false ? "risk.kill_switch" : "risk.check";
    if (!userHasPermission(db, req.user, requiredPermission)) {
      return res.status(403).json({ error: `Missing permission: ${requiredPermission}` });
    }
    const killReason = String(req.body.reason || "").trim();
    await applyKillSwitch(db, {
      enabled: Boolean(req.body.enabled),
      reason: killReason,
      actor: req.user?.name || db.user.name
    }, {
      closeExecution,
      notifyLark,
      appendAudit,
      appendTrace,
      id,
      nowIso
    });
    persist(res, db.system);
  });

  app.post("/api/risk/emergency-flatten/resolve", requirePermission("risk.kill_switch"), (req, res) => {
    const snapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX" });
    const binding = validateOkxCredentialBinding(db, { accountId: snapshot?.accountId, snapshot });
    const fresh = snapshot && Date.now() - new Date(snapshot.createdAt || 0).getTime() <= Number(process.env.MAX_ACCOUNT_SNAPSHOT_AGE_MS || 600000);
    const noPositions = Array.isArray(snapshot?.positions) && !snapshot.positions.some((row) => Math.abs(Number(row.pos ?? row.size ?? 0)) > 0);
    const noOrders = snapshot?.openOrdersComplete === true && Array.isArray(snapshot.openOrders) && snapshot.openOrders.length === 0;
    const noAlgos = snapshot?.algoOrdersComplete === true && Array.isArray(snapshot.algoOrders) && snapshot.algoOrders.length === 0;
    if (!binding.ok || !fresh || !noPositions || !noOrders || !noAlgos) {
      return res.status(409).json({
        error: "emergency_flatten_not_authoritatively_clear",
        message: "仍无法用新鲜完整的 OKX 快照证明仓位、普通挂单和算法单均为空，不能解除一键平仓只减仓锁。",
        checks: { binding: binding.ok, fresh: Boolean(fresh), noPositions, noOrders, noAlgos }
      });
    }
    clearReduceOnlyReason(db, "emergency_flatten", { resolvedBy: req.user?.name || db.user.name, resolution: "operator_ack_after_authoritative_empty_snapshot" });
    syncReduceOnlyState(db);
    appendAudit(db, "管理员在权威空仓/无挂单快照后确认解除一键平仓锁", snapshot.id, req.user?.name || db.user.name, "warning");
    persist(res, { ok: true, reduceOnly: db.system.reduceOnlyMode, remainingReasons: db.system.reduceOnlyReasons || [] });
  });

  app.get("/api/risk/status", requirePermission("risk.check"), (_req, res) => {
    res.json({ system: db.system, rules: db.riskRules, incidents: db.riskIncidents, checks: db.riskChecks.slice(0, 20) });
  });

  app.post("/api/risk/thresholds", requirePermission("risk.check"), async (req, res) => {
    try {
      const { applyRiskThresholds, classifyRiskThresholdChanges, currentRiskThresholds } = await import("../riskThresholds.mjs");
      const { applyProtections } = await import("../tradeProtections.mjs");
      const { setConfig } = await import("../runtimeConfig.mjs");
      const before = currentRiskThresholds();
      const changes = classifyRiskThresholdChanges(req.body || {}, before);
      const loosening = changes.filter((change) => change.classification === "loosen");
      const permissions = new Set(resolvePermissions(db, req.user));
      const canLoosen = permissions.has("*") || permissions.has("approve:live_config") || permissions.has("admin:system");
      const canTighten = canLoosen || permissions.has("write:risk_thresholds");
      if (!canTighten) return res.status(403).json({ ok: false, error: "risk_threshold_update_not_permitted", changes });
      const reauthenticatedAt = new Date(req.session?.reauthenticatedAt || 0).getTime();
      const recentStepUp = Number.isFinite(reauthenticatedAt) && Date.now() - reauthenticatedAt <= 10 * 60_000
        && (!req.user?.mfaEnabled || req.session?.authLevel === "password+mfa");
      if (loosening.length && (!canLoosen || !recentStepUp)) {
        return res.status(403).json({
          ok: false,
          error: canLoosen ? "recent_step_up_required_for_risk_loosening" : "risk_loosening_requires_live_config_approval",
          changes
        });
      }
      const result = applyRiskThresholds(db, req.body || {}, setConfig);
      const currentProtection = applyProtections(db, req.user?.name || db.user.name);
      if (result.applied.length) appendAudit(db, `更新风控阈值:${changes.map((change) => `${change.key}:${change.before}→${change.after}(${change.classification})`).join("、")}`, "risk_thresholds", req.user?.name || db.user.name, loosening.length ? "critical" : "warning");
      persist(res, { ok: true, ...result, changes, currentProtection, message: result.applied.length ? "风控阈值已更新，并已重新计算当前保护状态" : "无变更" });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/risk/rules", requirePermission("risk.check"), (_req, res) => res.json(db.riskRules));

  app.post("/api/risk/rules", requirePermission("write:risk"), (req, res) => {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 100) return res.status(400).json({ error: "规则名称必须为 1–100 个字符" });
    const conditionValidation = validateConditionSpec(req.body.conditionSpec);
    const action = req.body.action || "notify";
    if (!validateDynamicRiskAction(action)) return res.status(400).json({ error: "规则动作只允许 notify / reject_entry / pause_opening；全局熔断只能人工或受控安全流程触发" });
    if (!conditionValidation.valid) return res.status(400).json({ error: `规则必须提供可执行的 conditionSpec：${conditionValidation.reason}` });
    const rule = {
      id: id("risk"),
      name,
      scope: req.body.scope || "trade",
      level: req.body.level || "L2",
      enabled: true,
      action,
      description: req.body.description || "",
      event: req.body.event || "",
      condition: req.body.condition || "",
      conditionSpec: req.body.conditionSpec,
      enforcementStatus: action === "notify" ? "notification_enforced" : "entry_enforced",
      createdAt: nowIso()
    };
    db.riskRules.unshift(rule);
    appendAudit(db, "创建风控规则", rule.id, req.user?.name || db.user.name);
    persist(res, rule);
  });

  app.patch("/api/risk/rules/:id", requirePermission("write:risk"), (req, res) => {
    const rule = db.riskRules.find((item) => item.id === req.params.id);
    if (!rule) return res.status(404).json({ error: "Risk rule not found" });
    if (rule.systemManaged === true || ["risk_stop_required", "risk_no_withdraw"].includes(rule.id)) {
      return res.status(403).json({ error: "内置安全规则由系统托管，不能在规则面板修改或停用" });
    }
    if (req.body.enabled !== undefined && typeof req.body.enabled !== "boolean") return res.status(400).json({ error: "enabled 必须是布尔值" });
    if (req.body.name !== undefined && (!String(req.body.name).trim() || String(req.body.name).trim().length > 100)) return res.status(400).json({ error: "规则名称必须为 1–100 个字符" });
    const requestedAction = req.body.action ?? rule.action ?? "notify";
    // 存量 block/restrict/kill_switch 从未具备全局动作语义；首次编辑时安全迁移为“拒绝当前入场”。
    const nextAction = validateDynamicRiskAction(requestedAction)
      ? requestedAction
      : ["block", "restrict", "kill_switch"].includes(requestedAction) ? "reject_entry" : requestedAction;
    const nextConditionSpec = req.body.conditionSpec ?? rule.conditionSpec;
    const conditionValidation = validateConditionSpec(nextConditionSpec);
    if (!validateDynamicRiskAction(nextAction)) return res.status(400).json({ error: "规则动作只允许 notify / reject_entry / pause_opening；全局熔断只能人工或受控安全流程触发" });
    const preservingAdvisory = rule.enforcementStatus === "advisory_uncompiled"
      && req.body.conditionSpec === undefined && req.body.action === undefined;
    if (!conditionValidation.valid && !preservingAdvisory) return res.status(400).json({ error: `规则必须提供可执行的 conditionSpec：${conditionValidation.reason}` });
    const allowed = ["name", "scope", "level", "enabled", "action", "description", "event", "condition"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) rule[key] = req.body[key];
    }
    rule.name = String(rule.name).trim();
    rule.action = nextAction;
    rule.conditionSpec = conditionValidation.valid ? nextConditionSpec : null;
    rule.enforcementStatus = conditionValidation.valid ? (nextAction === "notify" ? "notification_enforced" : "entry_enforced") : "advisory_uncompiled";
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
    db.system.manualReduceOnly = req.body.enabled !== false;
    if (!db.system.manualReduceOnly) {
      clearReduceOnlyReason(db, "manual_reduce_only", { resolvedAt: nowIso(), resolvedBy: req.user?.name || db.user.name, resolution: "manual_control_cleared" });
    }
    syncReduceOnlyState(db);
    db.system.latestAction = db.system.manualReduceOnly ? "启用手工只减仓模式" : db.system.reduceOnlyMode ? "已关闭手工只减仓；系统仍有未决安全原因" : "关闭只减仓模式";
    db.system.updatedAt = nowIso();
    appendAudit(db, db.system.latestAction, "system.reduce_only", db.user.name, "warning");
    appendTrace(db, "risk", db.system.latestAction, db.system.reduceOnlyMode ? "warning" : db.system.autonomyEnabled ? "ok" : "paused");
    const message = db.system.manualReduceOnly
      ? "已开启手动只减仓"
      : db.system.reduceOnlyMode
        ? "手动只减仓已解除；系统安全条件仍在维持只减仓，请查看当前限制原因"
        : "手动只减仓已解除";
    persist(res, {
      message,
      manualReduceOnly: db.system.manualReduceOnly,
      reduceOnlyMode: db.system.reduceOnlyMode,
      remainingReasons: db.system.reduceOnlyReasons || [],
      system: db.system
    });
  });

  app.get("/api/risk/incidents", requirePermission("risk.check"), (_req, res) => res.json(db.riskIncidents));

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
