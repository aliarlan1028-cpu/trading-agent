// 复盘路由组（创建复盘/分析/补字段/策略改进闭环）—— 从 index.mjs 按 registrar 范式迁出。
import {
  buildOwnerReviewLoopSnapshot,
  isOwnerReviewRow,
  migrateLegacyOwnerReviewProvenance,
  recordStrategyValidationStage,
  transitionOwnerImprovement,
  transitionReviewLesson
} from "../ownerReviewLoop.mjs";

export function registerReviewRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, buildReviewAnalytics, backfillReviewFields, createStrategyImprovementCycle } = ctx;
  const requireOwner = (req, res) => {
    const actor = req.user || db.user;
    if (actor?.isOwner === true) return true;
    res.status(403).json({ error: "owner_only_review_loop" });
    return false;
  };

  app.get("/api/reviews", requirePermission("account.read"), (req, res) => {
    migrateLegacyOwnerReviewProvenance(db);
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 50)));
    const offset = Math.max(0, Number(req.query?.offset || 0));
    const type = String(req.query?.type || "").trim();
    const status = String(req.query?.status || "").trim().toLowerCase();
    const actor = req.user || db.user;
    const filtered = (db.reviews || []).filter((row) => {
      const ownerVisible = actor?.isOwner === true
        ? isOwnerReviewRow(db, row)
        : row.tenantId && row.tenantId === actor?.tenantId && (row.ownerUserId || row.userId) === actor?.id;
      return ownerVisible && (!type || row.type === type) && (!status || String(row.status || "").toLowerCase() === status);
    });
    const items = filtered.slice(offset, offset + limit).map(({ analyticsSnapshot: _analyticsSnapshot, ...row }) => row);
    res.json({ items, total: filtered.length, offset, limit, hasMore: offset + items.length < filtered.length });
  });

  app.post("/api/reviews", requirePermission("write:review"), (req, res) => {
    const actor = req.user || db.user;
    const review = { id: id("review"), tenantId: actor?.tenantId || "tenant_owner", ownerUserId: actor?.id || null, title: req.body.title || "交易复盘", summary: req.body.summary || "", tags: req.body.tags || [], tradePlanId: req.body.tradePlanId, createdAt: nowIso() };
    db.reviews.unshift(review);
    appendAudit(db, "创建复盘", review.id, "复盘员");
    persist(res, review);
  });

  app.get("/api/review/analytics", requirePermission("account.read"), (_req, res) => res.json(buildReviewAnalytics(db)));

  app.get("/api/review/owner-loop", requirePermission("admin:system"), (req, res) => {
    if (!requireOwner(req, res)) return;
    res.json(buildOwnerReviewLoopSnapshot(db));
  });

  app.post("/api/review/lessons/:id/action", requirePermission("admin:system"), (req, res) => {
    if (!requireOwner(req, res)) return;
    const actor = req.user?.name || db.user?.name || "Owner";
    const result = transitionReviewLesson(db, req.params.id, String(req.body?.action || ""), actor);
    if (!result.ok) return res.status(result.status || 409).json(result);
    persist(res, {
      ok: true,
      lesson: result.memory,
      ownerReviewLoop: buildOwnerReviewLoopSnapshot(db),
      message: result.memory.learningStatus === "active" ? "教训已由 Owner 批准，后续只在相关交易情景中参与决策" : "教训状态已更新"
    });
  });

  app.post("/api/review/improvements/:id/action", requirePermission("admin:system"), async (req, res) => {
    if (!requireOwner(req, res)) return;
    const actor = req.user?.name || db.user?.name || "Owner";
    const action = String(req.body?.action || "");
    if (action === "record_stage") {
      const recorded = recordStrategyValidationStage(db, req.params.id, req.body || {}, actor);
      if (!recorded.ok) return res.status(recorded.status || 409).json(recorded);
      return persist(res, {
        ok: true,
        improvement: recorded.item,
        experiment: recorded.experiment,
        ownerReviewLoop: buildOwnerReviewLoopSnapshot(db),
        message: recorded.stage.status === "failed" ? "该候选在当前验证阶段未通过，未进入后续阶段" : "验证证据已记录"
      });
    }
    const currentItem = (db.ownerImprovementItems || []).find((row) => row.id === req.params.id);
    const itemBefore = currentItem ? structuredClone(currentItem) : null;
    const experimentIdsBefore = new Set((db.strategyExperiments || []).map((row) => row.id));
    const reviewIdsBefore = new Set((db.reviews || []).map((row) => row.id));
    const result = transitionOwnerImprovement(db, req.params.id, action, actor, req.body || {});
    if (!result.ok) return res.status(result.status || 409).json(result);
    let experiment = null;
    // 策略类优化在 Owner 接受或重试后创建新一代版本化验证。整个动作按
    // 一个事务处理；若无法绑定真实基线版本，恢复原状态，不留下 accepted 空壳。
    if (["accept", "retry_validation"].includes(action) && result.item.destination === "strategy") {
      try {
        const cycle = createStrategyImprovementCycle(db, {
          sourceImprovementId: result.item.id,
          sourceReviewIds: result.item.evidenceReviewIds,
          hypothesis: result.item.proposal,
          successCriteria: {
            minTrades: 20,
            minSmallLiveTrades: 3,
            minProfitFactor: 1.2,
            maxDrawdownPct: 3,
            requireManualApproval: true
          }
        });
        experiment = cycle.experiment;
        result.item.experimentId = experiment.id;
        result.item.updatedAt = nowIso();
      } catch (error) {
        if (itemBefore) {
          for (const key of Object.keys(result.item)) delete result.item[key];
          Object.assign(result.item, itemBefore);
        }
        db.strategyExperiments = (db.strategyExperiments || []).filter((row) => experimentIdsBefore.has(row.id));
        db.reviews = (db.reviews || []).filter((row) => reviewIdsBefore.has(row.id));
        return res.status(error.status || 409).json({ ok: false, error: error.code || error.message || "strategy_validation_cycle_failed" });
      }
    }
    persist(res, {
      ok: true,
      improvement: result.item,
      experiment,
      ownerReviewLoop: buildOwnerReviewLoopSnapshot(db),
      message: experiment ? `已创建第 ${experiment.attemptNumber || 1} 代版本化验证草案；不会直接修改当前实盘策略` : action === "start_validation" ? "验证流程已启动；请按顺序绑定权威回测、模拟盘与完整对账小额实盘证据" : "Owner 优化项状态已更新"
    });
  });

  app.post("/api/review/backfill-fields", requirePermission("write:review"), (_req, res) => {
    const result = backfillReviewFields(db);
    appendAudit(db, "补全复盘字段", "review_backfill", "ReviewEngine");
    persist(res, { message: `已补全复盘字段：${result.updated} 处`, ...result, analytics: buildReviewAnalytics(db) });
  });

  app.post("/api/review/strategy-improvement", requirePermission("admin:system"), (req, res) => {
    if (!requireOwner(req, res)) return;
    // 显式 Owner 操作也只创建验证草案。当前策略研究不能冒充“候选版本已验证”；
    // 后续必须绑定候选版本并逐段记录回测、前向模拟和小额实盘证据。
    try {
      const cycle = createStrategyImprovementCycle(db, req.body || {});
      persist(res, {
        ...cycle,
        research: null,
        message: "已创建版本化验证草案；未运行当前策略研究，也未自动启动模拟盘或修改实盘策略"
      });
    } catch (error) {
      res.status(error.status || 409).json({ ok: false, error: error.code || error.message || "strategy_validation_cycle_failed" });
    }
  });
}
