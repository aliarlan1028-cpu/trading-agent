// 知识导入 + RAG/向量 路由组 —— 从 index.mjs 按 registrar 范式迁出。
// 删除来源时:已批准纪律(注入提示词的硬闸)不静默撤、多来源规则只摘引用；同源技能一并退役。依赖经 ctx 注入。
export function registerKnowledgeImportRoutes(app, ctx) {
  const { db, persist, requirePermission, appendAudit, appendTrace, handleKnowledgeImport, importGithubKnowledge, parseKnowledgeRealSource, retireSkillsForSource, ragQuery, embeddingStatus, reembedAllChunks } = ctx;

  app.post("/api/knowledge/import-real", requirePermission("write:knowledge"), handleKnowledgeImport);

  app.post("/api/knowledge/github-import", requirePermission("write:knowledge"), async (req, res) => {
    try {
      const result = await importGithubKnowledge(db, req.body.repoUrl, req.body.subPath || "");
      persist(res, { ...result, message: result.message || `已导入 GitHub 知识：${req.body.repoUrl}` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/knowledge/sources/:id/parse-real", requirePermission("write:knowledge"), async (req, res) => {
    try {
      persist(res, await parseKnowledgeRealSource(db, req.params.id));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/knowledge/sources/:id", requirePermission("write:knowledge"), (req, res) => {
    const source = db.knowledge.sources.find((item) => item.id === req.params.id);
    if (!source) return res.status(404).json({ error: "Knowledge source not found" });
    const sid = source.id;
    const retiredSkills = retireSkillsForSource(db, sid, db.user.name, "knowledge_source_deleted");
    db.knowledge.sources = db.knowledge.sources.filter((item) => item.id !== sid);
    db.knowledge.documentNodes = (db.knowledge.documentNodes || []).filter((node) => node.sourceId !== sid);
    db.knowledge.chunks = (db.knowledge.chunks || []).filter((chunk) => chunk.sourceId !== sid);
    db.knowledge.conceptCards = (db.knowledge.conceptCards || []).filter((concept) => !concept.sourceRefs?.includes(sid));
    db.knowledge.tradingMethods = (db.knowledge.tradingMethods || []).filter((method) => method.source?.id !== sid && method.sourceId !== sid);
    // 已批准纪律是注入 AI 提示词的硬闸(审计 P2):删来源不得静默撤掉;多来源合并规则只摘引用。
    db.knowledge.ruleProposals = (db.knowledge.ruleProposals || []).filter((rule) => {
      if (rule.status === "已批准" || !rule.sourceRefs?.includes(sid)) return true;
      if (rule.sourceRefs.length > 1) { rule.sourceRefs = rule.sourceRefs.filter((x) => x !== sid); return true; }
      return false;
    });
    db.knowledge.theoryFrameworks = (db.knowledge.theoryFrameworks || []).filter((fw) => !fw.sourceRefs?.includes(sid));
    appendAudit(db, "删除知识来源", sid, "Curator");
    appendTrace(db, "knowledge_delete", `删除知识来源 ${source.title}`);
    persist(res, { removed: sid, retiredSkills });
  });

  app.post("/api/knowledge/rag-query", async (req, res) => {
    const result = await ragQuery(db, req.body.query || req.body.question || "", req.body);
    persist(res, result);
  });

  app.get("/api/knowledge/embedding-status", (_req, res) => res.json(embeddingStatus(db)));

  app.post("/api/knowledge/reembed", requirePermission("write:knowledge"), async (_req, res) => {
    try {
      const result = await reembedAllChunks(db);
      persist(res, { ...result, embeddingStatus: embeddingStatus(db) });
    } catch (error) {
      res.status(500).json({ error: `语义向量化失败：${error.message}` });
    }
  });
}
