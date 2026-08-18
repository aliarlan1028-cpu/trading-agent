// 知识导入 + RAG/向量 路由组 —— 从 index.mjs 按 registrar 范式迁出。
// 删除来源时:已批准纪律(注入提示词的硬闸)不静默撤、多来源规则只摘引用；同源技能一并退役。依赖经 ctx 注入。
import { canWriteKnowledgeRow, ensureKnowledgeOwnership, normalizeKnowledgePrincipal, projectKnowledgeForPrincipal } from "../knowledgeScope.mjs";
export function detachKnowledgeSource(db, sid) {
  db.knowledge.sources = (db.knowledge.sources || []).filter((item) => item.id !== sid);
  db.knowledge.documentNodes = (db.knowledge.documentNodes || []).filter((node) => node.sourceId !== sid);
  db.knowledge.chunks = (db.knowledge.chunks || []).filter((chunk) => chunk.sourceId !== sid);
  db.knowledge.tradingMethods = (db.knowledge.tradingMethods || []).filter((method) => method.source?.id !== sid && method.sourceId !== sid);
  db.knowledge.reviewTemplates = (db.knowledge.reviewTemplates || []).filter((item) => item.sourceId !== sid);
  db.knowledge.strategyHypotheses = (db.knowledge.strategyHypotheses || []).filter((item) => item.sourceId !== sid && item.source?.id !== sid);
  // 已采纳/忽略的候选属于审计记录，删除来源时保留结论但摘除活跃来源关联；
  // 仍未处理的候选随来源删除，避免后续采纳失去证据的草案。
  db.knowledge.candidates = (db.knowledge.candidates || []).flatMap((item) => {
    if (item.sourceId !== sid) return [item];
    if (["adopted", "ignored", "rejected"].includes(item.status)) {
      return [{ ...item, sourceId: null, sourceDeletedAt: new Date().toISOString() }];
    }
    return [];
  });

  db.knowledge.conceptCards = (db.knowledge.conceptCards || []).flatMap((concept) => {
    if (!Array.isArray(concept.sourceRefs) || !concept.sourceRefs.includes(sid)) return [concept];
    const sourceRefs = concept.sourceRefs.filter((id) => id !== sid);
    return sourceRefs.length ? [{ ...concept, sourceRefs }] : [];
  });
  db.knowledge.theoryFrameworks = (db.knowledge.theoryFrameworks || []).flatMap((framework) => {
    if (!Array.isArray(framework.sourceRefs) || !framework.sourceRefs.includes(sid)) return [framework];
    const sourceRefs = framework.sourceRefs.filter((id) => id !== sid);
    return sourceRefs.length ? [{ ...framework, sourceRefs }] : [];
  });
  db.knowledge.ruleProposals = (db.knowledge.ruleProposals || []).flatMap((rule) => {
    if (!Array.isArray(rule.sourceRefs) || !rule.sourceRefs.includes(sid)) return [rule];
    const sourceRefs = rule.sourceRefs.filter((id) => id !== sid);
    if (rule.status === "已批准") return [{ ...rule, sourceRefs, sourceDeletedAt: new Date().toISOString() }];
    return sourceRefs.length ? [{ ...rule, sourceRefs }] : [];
  });
}

export function registerKnowledgeImportRoutes(app, ctx) {
  const { db, persist, requirePermission, appendAudit, appendTrace, handleKnowledgeImport, importGithubKnowledge, parseKnowledgeRealSource, retireSkillsForSource, ragQuery, embeddingStatus, reembedAllChunks, removeManagedKnowledgeFile } = ctx;
  const principal = (req) => normalizeKnowledgePrincipal({ tenantId: req.tenantId || req.user?.tenantId, userId: req.user?.id, isOwner: req.user?.isOwner === true });
  const ownedSource = (req, id) => {
    ensureKnowledgeOwnership(db);
    const source = (db.knowledge?.sources || []).find((item) => item.id === id);
    return source && canWriteKnowledgeRow(source, principal(req)) ? source : null;
  };

  app.post("/api/knowledge/import-real", requirePermission("write:knowledge"), handleKnowledgeImport);

  app.post("/api/knowledge/github-import", requirePermission("write:knowledge"), async (req, res) => {
    try {
      const result = await importGithubKnowledge(db, req.body.repoUrl, req.body.subPath || "", { tenantId: req.tenantId || req.user?.tenantId || "tenant_owner", ownerUserId: req.user?.id || null });
      persist(res, { ...result, message: result.message || `已导入 GitHub 知识：${req.body.repoUrl}` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/knowledge/sources/:id/parse-real", requirePermission("write:knowledge"), async (req, res) => {
    try {
      if (!ownedSource(req, req.params.id)) return res.status(404).json({ error: "Knowledge source not found" });
      persist(res, await parseKnowledgeRealSource(db, req.params.id));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/knowledge/sources/:id", requirePermission("write:knowledge"), async (req, res) => {
    const source = ownedSource(req, req.params.id);
    if (!source) return res.status(404).json({ error: "Knowledge source not found" });
    const sid = source.id;
    await removeManagedKnowledgeFile?.(source);
    const retiredSkills = retireSkillsForSource(db, sid, db.user.name, "knowledge_source_deleted");
    detachKnowledgeSource(db, sid);
    appendAudit(db, "删除知识来源", sid, "Curator");
    appendTrace(db, "knowledge_delete", `删除知识来源 ${source.title}`);
    persist(res, { removed: sid, retiredSkills });
  });

  app.post("/api/knowledge/rag-query", requirePermission("knowledge.read"), requirePermission("assistant.use"), async (req, res) => {
    ensureKnowledgeOwnership(db);
    const scoped = projectKnowledgeForPrincipal(db, principal(req));
    const result = await ragQuery(db, req.body.query || req.body.question || "", { ...(req.body || {}), principal: principal(req), chunks: scoped.chunks });
    persist(res, result);
  });

  app.get("/api/knowledge/embedding-status", requirePermission("knowledge.read"), (req, res) => {
    const scoped = projectKnowledgeForPrincipal(db, principal(req));
    res.json(embeddingStatus(db, { chunks: scoped.chunks }));
  });

  app.post("/api/knowledge/reembed", requirePermission("write:knowledge"), async (req, res) => {
    try {
      const scoped = projectKnowledgeForPrincipal(db, principal(req));
      const result = await reembedAllChunks(db, { chunks: scoped.chunks });
      persist(res, { ...result, embeddingStatus: embeddingStatus(db, { chunks: scoped.chunks }) });
    } catch (error) {
      res.status(500).json({ error: `语义向量化失败：${error.message}` });
    }
  });
}
