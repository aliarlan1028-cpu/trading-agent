// 执行单路由组（列表/轮询更新/平仓）—— 从 index.mjs 按 registrar 范式迁出。
// 轮询与平仓后刷新核算的语义逐字保留。平仓为 critical:trade_execution。依赖经 ctx 注入。
export function registerExecutionOrderRoutes(app, ctx) {
  const { db, persist, requirePermission, pollExecutionOrders, closeExecution, refreshAccounting } = ctx;

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
}
