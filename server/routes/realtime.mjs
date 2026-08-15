// 实时管理路由组（状态/启动/停止）—— 从 index.mjs 按 registrar 范式迁出。
// SSE 流(/api/stream)因状态化(streamTickets/监听器)仍留 index.mjs。依赖经 ctx 注入。
export function registerRealtimeRoutes(app, ctx) {
  const { db, persist, saveDb, requirePermission, realtimeStatus, startRealtimeManager, stopRealtimeManager } = ctx;

  app.get("/api/realtime/status", requirePermission("account.read"), (_req, res) => res.json(realtimeStatus(db)));

  app.post("/api/realtime/start", requirePermission("write:realtime"), (req, res) => {
    persist(res, startRealtimeManager(db, saveDb, { force: true }));
  });

  app.post("/api/realtime/stop", requirePermission("write:realtime"), (req, res) => {
    persist(res, stopRealtimeManager(db, req.body.reason || "manual_stop"));
  });
}
