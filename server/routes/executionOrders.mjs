// 执行单路由组（列表/轮询更新/平仓）—— 从 index.mjs 按 registrar 范式迁出。
// 轮询与平仓后刷新核算的语义逐字保留。平仓为 critical:trade_execution。依赖经 ctx 注入。
export function registerExecutionOrderRoutes(app, ctx) {
  const { db, persist, requirePermission, pollExecutionOrders, closeExecution, refreshAccounting } = ctx;

  app.get("/api/execution-orders", requirePermission("account.read"), (_req, res) => res.json((db.executionOrders || []).slice().sort((a, b) =>
    new Date(b.updatedAt || b.lastPolledAt || b.closedAt || b.createdAt || 0) - new Date(a.updatedAt || a.lastPolledAt || a.closedAt || a.createdAt || 0)
  )));

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
      const intent = String(req.body?.intent || "");
      const expectedStatus = String(req.body?.expectedStatus || "");
      if (!['cancel_entry', 'cancel_remainder_and_close_filled', 'close_position'].includes(intent) || !expectedStatus) {
        return res.status(400).json({ error: "intent_and_expected_status_required" });
      }
      const result = await closeExecution(db, req.params.id, req.body.reason || "manual_ui", { intent, expectedStatus });
      const status = String(result?.status || "");
      const conflictMessages = {
        status_conflict: "执行状态已变化，请刷新后按当前状态重新确认。",
        account_binding_required: "无法唯一确定该执行所属的 OKX 账户，未提交平仓；请先完成账户绑定。",
        shared_position_close_requires_coordination: "同币同方向存在多个执行批次，整仓平仓无法安全归属；未提交，请先协调收口。"
      };
      if (conflictMessages[status]) return res.status(409).json({ ...result, error: conflictMessages[status], message: conflictMessages[status] });
      if (status === "missing_execution_order") return res.status(404).json({ ...result, error: "未找到该执行单，未执行任何交易动作。" });
      if (["cancel_unconfirmed", "close_unconfirmed"].includes(status)) {
        return res.status(502).json({ ...result, error: status === "cancel_unconfirmed" ? "交易所未接受撤单请求，订单仍需核对。" : "交易所未接受平仓请求，仓位仍需核对。" });
      }
      if (["cancel_unknown_pending", "close_unknown_pending"].includes(status)) {
        res.status(202);
        result.message = "交易所响应未知，系统已暂停新开仓并进入权威对账；请勿重复提交。";
      } else if (["cancel_pending", "protection_failure_cancel_pending", "close_pending"].includes(status)) {
        res.status(202);
        result.message = status === "close_pending" ? "平仓请求已被交易所接收，等待真实成交与账户快照核算。" : "撤单请求已被交易所接收，等待订单终态确认。";
      } else if (result?.idempotent === true && /pending|closed|cancelled/.test(status)) {
        result.message = "该退出动作已在处理中或已完成，未重复提交。";
      } else if (!["closed", "cancelled"].includes(status)) {
        return res.status(422).json({ ...result, error: `当前执行无法完成该动作：${status || "unknown"}` });
      }
      refreshAccounting(db);
      persist(res, result);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
