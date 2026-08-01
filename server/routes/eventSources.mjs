// 事件源路由组（新增/刷新 RSS/链上信号/列表）—— 从 index.mjs 按 registrar 范式迁出。
export function registerEventSourceRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, refreshEventSources, refreshOnchainSignals } = ctx;

  app.post("/api/event-sources", requirePermission("write:event"), (req, res) => {
    // 只支持 rss/html(json 无通用解析器,别让前端误传);非法一律回落 rss。
    const type = ["rss", "html"].includes(req.body.type) ? req.body.type : "rss";
    const source = {
      id: id("event_source"),
      name: req.body.name || "新事件源",
      type,
      url: req.body.url || "",
      category: req.body.category || "自定义",
      enabled: req.body.enabled !== false,
      trustScore: Number(req.body.trustScore || 70),
      createdAt: nowIso()
    };
    db.eventSources ||= [];
    db.eventSources.unshift(source);
    appendAudit(db, "新增事件源", source.id, db.user.name);
    persist(res, source);
  });

  // 编辑/停用：改名称/URL/类型/可信度、开关 enabled。
  app.patch("/api/event-sources/:id", requirePermission("write:event"), (req, res) => {
    const source = (db.eventSources || []).find((s) => s.id === req.params.id);
    if (!source) return res.status(404).json({ error: "事件源不存在" });
    for (const key of ["name", "url", "category"]) if (req.body[key] !== undefined) source[key] = req.body[key];
    if (req.body.type !== undefined) source.type = ["rss", "html"].includes(req.body.type) ? req.body.type : source.type;
    if (req.body.trustScore !== undefined) source.trustScore = Number(req.body.trustScore) || source.trustScore;
    if (req.body.enabled !== undefined) source.enabled = req.body.enabled !== false;
    source.updatedAt = nowIso();
    appendAudit(db, `更新事件源：${source.name}${req.body.enabled === false ? "(停用)" : req.body.enabled === true ? "(启用)" : ""}`, source.id, db.user.name);
    persist(res, source);
  });

  // 删除事件源(不删已抓到的历史事件,只是不再从此源抓)。
  app.delete("/api/event-sources/:id", requirePermission("write:event"), (req, res) => {
    const before = (db.eventSources || []).length;
    db.eventSources = (db.eventSources || []).filter((s) => s.id !== req.params.id);
    if (db.eventSources.length === before) return res.status(404).json({ error: "事件源不存在" });
    appendAudit(db, "删除事件源", req.params.id, db.user.name, "warning");
    persist(res, { ok: true, removed: req.params.id });
  });

  app.post("/api/event-sources/refresh", requirePermission("write:event"), async (_req, res) => {
    persist(res, await refreshEventSources(db));
  });

  app.post("/api/event-sources/onchain", requirePermission("write:event"), async (_req, res) => {
    persist(res, await refreshOnchainSignals(db));
  });

  app.get("/api/event-sources", (_req, res) => res.json(db.eventSources || []));
}
