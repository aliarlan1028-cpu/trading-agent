// 事件与情报路由组 —— 从 index.mjs 按 registrar 范式迁出。依赖经 ctx 注入。
import { resolvePermissions } from "../auth.mjs";
const MANUAL_EVENT_FIELDS = new Set(["title", "summary", "category", "due", "startAt", "endAt", "timePrecision", "timezone", "relatedSymbols", "impact", "action", "notes"]);
const FORBIDDEN_EVENT_FIELDS = new Set([
  "id", "sourceId", "kind", "intel", "confidence", "credibility", "corroboration", "fakeRisk", "oneLine",
  "timeline", "progress", "status", "createdAt", "updatedAt", "latestUpdateAt", "lastUpdatedAt",
  "autoTradingEligible", "provenance", "topicKey", "topicTags", "rawTitle"
]);

function manualEventInput(body = {}, { partial = false } = {}) {
  const forbidden = Object.keys(body).filter((key) => FORBIDDEN_EVENT_FIELDS.has(key) || !MANUAL_EVENT_FIELDS.has(key));
  if (forbidden.length) return { ok: false, error: "forbidden_event_fields", fields: forbidden };
  const result = {};
  if (!partial || body.title !== undefined) {
    const title = String(body.title || "").trim();
    if (!title || title.length > 160) return { ok: false, error: "invalid_event_title" };
    result.title = title;
  }
  for (const key of ["summary", "category", "due", "startAt", "endAt", "timezone", "action", "notes"]) {
    if (body[key] !== undefined) result[key] = String(body[key]).trim().slice(0, key === "summary" || key === "notes" ? 1000 : 240);
  }
  if (body.timePrecision !== undefined) {
    if (!["date", "minute"].includes(body.timePrecision)) return { ok: false, error: "invalid_time_precision" };
    result.timePrecision = body.timePrecision;
  }
  if (body.relatedSymbols !== undefined) {
    if (!Array.isArray(body.relatedSymbols)) return { ok: false, error: "invalid_related_symbols" };
    result.relatedSymbols = [...new Set(body.relatedSymbols.map((value) => String(value).toUpperCase().trim()).filter((value) => /^[A-Z0-9]{2,15}\/USDT$/.test(value)))].slice(0, 12);
  }
  if (body.impact !== undefined) {
    const impact = Number(body.impact);
    if (!Number.isFinite(impact) || impact < 0 || impact > 100) return { ok: false, error: "invalid_event_impact" };
    result.impact = impact;
  }
  return { ok: true, value: result };
}

export function registerEventRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, appendTrace, rankEvents } = ctx;
  const findEvent = (idv) => db.events.find((item) => item.id === idv);
  const notFound = (res) => res.status(404).json({ error: "Event not found" });
  const authoritative = (event) => event?.verified === true || event?.provenance?.verifiedOrigin === true || event?.autoTradingEligible === true || String(event?.sourceId || "").startsWith("official_");
  const canManageAuthoritative = (req) => {
    const permissions = new Set(resolvePermissions(db, req.user));
    return permissions.has("approve:live_config") || permissions.has("admin:system");
  };

  app.get("/api/events", requirePermission("market.read"), (_req, res) => res.json(db.events));

  // 热点情报流：按影响度+热度+时效+与持仓/授权标的相关性排序的事件专题
  app.get("/api/events/intel", requirePermission("market.read"), (_req, res) => {
    const watchSymbols = [
      ...(db.positions || []).map((p) => p.symbol),
      ...(db.mandates || []).flatMap((m) => m.allowedSymbols || []),
      db.activeMarket?.symbol
    ].filter(Boolean);
    res.json(rankEvents(db, { watchSymbols }));
  });

  app.post("/api/events", requirePermission("write:event"), (req, res) => {
    const parsed = manualEventInput(req.body || {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, fields: parsed.fields });
    const event = {
      id: id("event"),
      ...parsed.value,
      kind: "unverified_manual",
      status: "待确认",
      confidence: 20,
      impact: parsed.value.impact ?? 50,
      progress: [],
      provenance: { trustTier: "unverified_manual", verifiedOrigin: false, untrustedContent: true },
      autoTradingEligible: false,
      createdByUserId: req.user?.id || null,
      createdAt: nowIso()
    };
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
    if (authoritative(event) && !canManageAuthoritative(req)) return res.status(403).json({ error: "verified_event_requires_independent_approval" });
    const parsed = manualEventInput(req.body || {}, { partial: true });
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, fields: parsed.fields });
    Object.assign(event, parsed.value, { latestUpdateAt: nowIso() });
    appendAudit(db, "更新事件进度", event.id, "事件分析员");
    persist(res, event);
  });

  app.delete("/api/events/:id", requirePermission("write:event"), (req, res) => {
    const event = findEvent(req.params.id);
    if (!event) return notFound(res);
    if (authoritative(event)) return res.status(403).json({ error: "verified_event_cannot_be_deleted" });
    if (event.createdByUserId && event.createdByUserId !== req.user?.id && !canManageAuthoritative(req)) return res.status(403).json({ error: "event_owner_or_approver_required" });
    db.events = (db.events || []).filter((item) => item.id !== req.params.id);
    appendAudit(db, "删除情报事件专题", req.params.id, req.user?.name || "Owner");
    persist(res, { ok: true });
  });

  app.post("/api/events/:id/progress", requirePermission("write:event"), (req, res) => {
    const event = findEvent(req.params.id);
    if (!event) return notFound(res);
    event.progress ||= [];
    if (authoritative(event) && !canManageAuthoritative(req)) return res.status(403).json({ error: "verified_event_requires_independent_approval" });
    const item = String(req.body.text || req.body.progress || "追加事件进度").slice(0, 1000);
    event.progress.push(item);
    event.latestUpdateAt = nowIso();
    if (req.body.status) {
      if (!canManageAuthoritative(req)) return res.status(403).json({ error: "event_status_requires_independent_approval" });
      if (!["待确认", "跟进中", "resolved", "closed"].includes(req.body.status)) return res.status(400).json({ error: "invalid_event_status" });
      event.status = req.body.status;
    }
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
