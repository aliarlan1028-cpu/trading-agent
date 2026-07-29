// W4:知识库转换引擎 路由组——生成候选(书→策略/透镜/工作流)、逐条采纳(采纳即用)、忽略。
import { generateCandidates, adoptCandidate, ignoreCandidate } from "../knowledgeConverter.mjs";

export function registerKnowledgeConvertRoutes(app, ctx) {
  const { db, persist, requirePermission } = ctx;

  // 生成候选:传 sourceId 只转那本书;不传则遍历所有知识源。
  app.post("/api/knowledge/convert", requirePermission("write:knowledge"), async (req, res) => {
    try {
      const sourceId = req.body?.sourceId;
      const targets = sourceId ? [sourceId] : (db.knowledge?.sources || []).map((s) => s.id);
      if (!targets.length) return res.status(400).json({ error: "没有可转换的知识源，请先导入书籍/文章。" });
      let total = 0;
      const errors = [];
      for (const sid of targets.slice(0, 12)) {
        const r = await generateCandidates(db, sid);
        if (r.ok) total += r.created; else errors.push(r.error);
      }
      persist(res, { created: total, errors: errors.slice(0, 3), message: total ? `已产出 ${total} 个候选，去下方逐条采纳。` : `未产出候选${errors.length ? "：" + errors[0] : ""}` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/knowledge/candidates/:id/adopt", requirePermission("write:knowledge"), (req, res) => {
    const r = adoptCandidate(db, req.params.id, req.user?.name || db.user.name);
    if (!r.ok) return res.status(400).json({ error: r.error });
    persist(res, { candidate: r.candidate, message: `已采纳「${r.candidate.name}」，即刻生效。` });
  });

  app.post("/api/knowledge/candidates/:id/ignore", requirePermission("write:knowledge"), (req, res) => {
    const r = ignoreCandidate(db, req.params.id);
    if (!r.ok) return res.status(400).json({ error: r.error });
    persist(res, { candidate: r.candidate });
  });
}
