// 策略路由组（自适应画像/策略研究/策略表现看板）—— 从 index.mjs 按 registrar 范式迁出。
import { buildStrategyProductCatalog, transitionStrategyProduct } from "../strategyProducts.mjs";
import {
  backtestStrategyDraft, createStrategyDraft, publishStrategyDraft,
  runDraftGeneratedTests, setStrategyAssignment, strategyStudioSnapshot
} from "../strategyStudio.mjs";

export function registerStrategyRoutes(app, ctx) {
  const { db, persist, requirePermission, activeStrategyProfiles, runStrategyResearch, buildStrategyBoard, buildStrategyCatalog, STRATEGIES, appendAudit, llmComplete, activeProvider } = ctx;

  app.get("/api/strategy/profiles", (_req, res) => res.json(activeStrategyProfiles(db)));

  app.post("/api/strategy/research", requirePermission("write:review"), async (req, res) => {
    try {
      const result = await runStrategyResearch(db, req.body || {});
      persist(res, result);
    } catch (error) {
      res.status(500).json({ error: `策略研究失败：${error.message}` });
    }
  });

  app.get("/api/strategy-board", (_req, res) => res.json(buildStrategyBoard(db)));
  app.get("/api/strategy/catalog", (_req, res) => res.json(buildStrategyCatalog(db, Object.values(STRATEGIES))));
  app.get("/api/strategy/products", (_req, res) => res.json(buildStrategyProductCatalog(db)));
  app.get("/api/strategy/studio", (_req, res) => res.json(strategyStudioSnapshot(db)));
  app.post("/api/strategy/studio/drafts", requirePermission("write:review"), async (req, res) => {
    try {
      const draft = await createStrategyDraft(db, req.body?.prompt, {
        complete: activeProvider?.() ? llmComplete : null
      }, req.user?.name || db.user?.name || "Owner");
      const { suite } = runDraftGeneratedTests(db, draft.id, req.user?.name || db.user?.name || "Owner");
      const message = db.system?.uiLang === "en"
        ? `Strategy draft “${draft.blueprint.name}” created; ${suite.passed}/${suite.total} generated tests passed`
        : `策略草稿「${draft.blueprint.name}」已生成，自动测试 ${suite.passed}/${suite.total} 通过`;
      persist(res, { draft, suite, message, messageZh: `策略草稿「${draft.blueprint.name}」已生成，自动测试 ${suite.passed}/${suite.total} 通过`, messageEn: `Strategy draft “${draft.blueprint.name}” created; ${suite.passed}/${suite.total} generated tests passed` });
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message });
    }
  });
  app.post("/api/strategy/studio/drafts/:id/tests", requirePermission("write:review"), (req, res) => {
    try { persist(res, runDraftGeneratedTests(db, req.params.id, req.user?.name || db.user?.name || "Owner")); }
    catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  });
  app.post("/api/strategy/studio/drafts/:id/backtest", requirePermission("write:review"), async (req, res) => {
    try { persist(res, await backtestStrategyDraft(db, req.params.id, req.body || {}, req.user?.name || db.user?.name || "Owner")); }
    catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  });
  app.post("/api/strategy/studio/drafts/:id/publish", requirePermission("write:review"), (req, res) => {
    try { persist(res, { ...publishStrategyDraft(db, req.params.id, req.body || {}, req.user?.name || db.user?.name || "Owner"), message: db.system?.uiLang === "en" ? "Published to the internal strategy market" : "已发布到内部策略市场", messageZh: "已发布到内部策略市场", messageEn: "Published to the internal strategy market" }); }
    catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  });
  app.post("/api/strategy/market/:versionId/enable", requirePermission("write:review"), (req, res) => {
    try { persist(res, { ...setStrategyAssignment(db, req.params.versionId, true, req.user?.name || db.user?.name || "Owner"), message: db.system?.uiLang === "en" ? "Strategy added to the AI eligible set" : "策略已加入 AI 可选策略集", messageZh: "策略已加入 AI 可选策略集", messageEn: "Strategy added to the AI eligible set" }); }
    catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  });
  app.post("/api/strategy/market/:versionId/disable", requirePermission("write:review"), (req, res) => {
    try { persist(res, { ...setStrategyAssignment(db, req.params.versionId, false, req.user?.name || db.user?.name || "Owner"), message: db.system?.uiLang === "en" ? "Strategy removed from the AI eligible set" : "策略已从 AI 可选策略集中移除", messageZh: "策略已从 AI 可选策略集中移除", messageEn: "Strategy removed from the AI eligible set" }); }
    catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  });
  app.get("/api/strategy/products/:id", (req, res) => {
    const product = buildStrategyProductCatalog(db).products.find((row) => row.id === req.params.id);
    if (!product) return res.status(404).json({ error: "Strategy product not found" });
    res.json({ ...product, events: (db.strategyVersionEvents || []).filter((row) => row.productId === product.id && row.version === product.version) });
  });
  app.post("/api/strategy/products/:id/versions/:version/transition", requirePermission("write:review"), (req, res) => {
    try {
      const result = transitionStrategyProduct(db, req.params.id, req.params.version, req.body?.targetState, {
        reason: req.body?.reason,
        actor: req.user?.name || db.user?.name || "Owner"
      });
      appendAudit?.(db, `策略产品状态：${req.params.id}@${req.params.version} → ${req.body?.targetState}`, result.deployment.id, req.user?.name || db.user?.name || "Owner", "warning");
      persist(res, result);
    } catch (error) {
      res.status(error.status || 400).json({ error: error.message, evidence: error.evidence || null });
    }
  });
}
