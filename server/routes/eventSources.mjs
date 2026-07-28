// 事件源路由组（新增/刷新 RSS/链上信号/列表）—— 从 index.mjs 按 registrar 范式迁出。
export function registerEventSourceRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, refreshEventSources, refreshOnchainSignals } = ctx;

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
    persist(res, await refreshEventSources(db));
  });

  app.post("/api/event-sources/onchain", requirePermission("write:event"), async (_req, res) => {
    persist(res, await refreshOnchainSignals(db));
  });

  app.get("/api/event-sources", (_req, res) => res.json(db.eventSources || []));
}
