// 事件与情报路由组 —— 从 index.mjs 按 registrar 范式迁出。依赖经 ctx 注入。
export function registerEventRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, appendTrace, rankEvents } = ctx;
  const findEvent = (idv) => db.events.find((item) => item.id === idv);
  const notFound = (res) => res.status(404).json({ error: "Event not found" });

  app.get("/api/events", (_req, res) => res.json(db.events));

  // 热点情报流：按影响度+热度+时效+与持仓/授权标的相关性排序的事件专题
  app.get("/api/events/intel", (_req, res) => {
    const watchSymbols = [
      ...(db.positions || []).map((p) => p.symbol),
      ...(db.mandates || []).flatMap((m) => m.allowedSymbols || []),
      db.activeMarket?.symbol
    ].filter(Boolean);
    res.json(rankEvents(db, { watchSymbols }));
  });

  app.post("/api/events", requirePermission("write:event"), (req, res) => {
    const event = { id: id("event"), status: "待确认", confidence: 60, impact: 50, progress: [], ...req.body, createdAt: nowIso() };
    db.events.unshift(event);
    appendAudit(db, "创建事件卡", event.id, "事件分析员");
    appendTrace(db, "event", `事件建档：${event.title}`);
    persist(res, event);
  });

  // 手动添加日程事件(向前看):用户录入 FOMC/CPI/代币解锁 等已知日期的未来事件。
  app.post("/api/events/scheduled", requirePermission("write:event"), async (req, res) => {
    const { createScheduledEvent } = await import("../scheduledEvents.mjs");
    const result = createScheduledEvent(db, req.body || {}, req.user?.name || db.user?.name || "用户");
    if (result.error) return res.status(400).json({ error: result.error });
    appendTrace(db, "event", `手动日程事件：${result.event.title}`);
    persist(res, result.event);
  });

  app.patch("/api/events/:id", requirePermission("write:event"), (req, res) => {
    const event = findEvent(req.params.id);
    if (!event) return notFound(res);
    Object.assign(event, req.body, { latestUpdateAt: nowIso() });
    appendAudit(db, "更新事件进度", event.id, "事件分析员");
    persist(res, event);
  });

  app.delete("/api/events/:id", requirePermission("write:event"), (req, res) => {
    const exists = (db.events || []).some((item) => item.id === req.params.id);
    if (!exists) return notFound(res);
    db.events = (db.events || []).filter((item) => item.id !== req.params.id);
    appendAudit(db, "删除情报事件专题", req.params.id, req.user?.name || "Owner");
    persist(res, { ok: true });
  });

  app.post("/api/events/:id/progress", requirePermission("write:event"), (req, res) => {
    const event = findEvent(req.params.id);
    if (!event) return notFound(res);
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
    const event = findEvent(req.params.id);
    if (!event) return notFound(res);
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
}
