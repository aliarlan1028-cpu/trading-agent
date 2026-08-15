// 复盘路由组（创建复盘/分析/补字段/策略改进闭环）—— 从 index.mjs 按 registrar 范式迁出。
export function registerReviewRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, buildReviewAnalytics, backfillReviewFields, createStrategyImprovementCycle, runStrategyResearch } = ctx;

  app.get("/api/reviews", requirePermission("account.read"), (req, res) => {
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));
    const offset = Math.max(0, Number(req.query?.offset || 0));
    const type = String(req.query?.type || "").trim();
    const status = String(req.query?.status || "").trim().toLowerCase();
    const filtered = (db.reviews || []).filter((row) => (!type || row.type === type) && (!status || String(row.status || "").toLowerCase() === status));
    const items = filtered.slice(offset, offset + limit).map(({ analyticsSnapshot: _analyticsSnapshot, ...row }) => row);
    res.json({ items, total: filtered.length, offset, limit, hasMore: offset + items.length < filtered.length });
  });

  app.post("/api/reviews", requirePermission("write:review"), (req, res) => {
    const review = { id: id("review"), title: req.body.title || "交易复盘", summary: req.body.summary || "", tags: req.body.tags || [], tradePlanId: req.body.tradePlanId, createdAt: nowIso() };
    db.reviews.unshift(review);
    appendAudit(db, "创建复盘", review.id, "复盘员");
    persist(res, review);
  });

  app.get("/api/review/analytics", requirePermission("account.read"), (_req, res) => res.json(buildReviewAnalytics(db)));

  app.post("/api/review/backfill-fields", requirePermission("write:review"), (_req, res) => {
    const result = backfillReviewFields(db);
    appendAudit(db, "补全复盘字段", "review_backfill", "ReviewEngine");
    persist(res, { message: `已补全复盘字段：${result.updated} 处`, ...result, analytics: buildReviewAnalytics(db) });
  });

  app.post("/api/review/strategy-improvement", requirePermission("write:review"), async (req, res) => {
    // 记录改进假设/成功标准（复盘产物），并真正发起研究 → 自动开模拟盘（前向验证）。
    const cycle = createStrategyImprovementCycle(db, req.body || {});
    let research = null;
    try {
      research = await runStrategyResearch(db, req.body?.symbols ? { symbols: req.body.symbols } : {});
    } catch (error) {
      research = { status: "research_failed", error: error.message };
    }
    persist(res, {
      ...cycle,
      research,
      message: research?.status === "ok"
        ? `已发起改进闭环：研究 ${research.updated?.length || 0} 个交易对，自动开模拟盘 ${research.paperSpawned || 0} 个`
        : `已创建改进假设；研究未完成（${research?.error || research?.status || "unknown"}）`
    });
  });
}
