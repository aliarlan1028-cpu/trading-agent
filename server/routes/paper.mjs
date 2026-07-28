// 模拟盘(纸面盘前向验证)路由组 —— 从 index.mjs 按 registrar 范式迁出。依赖经 ctx 注入。
export function registerPaperRoutes(app, ctx) {
  const { db, persist, requirePermission, buildPaperReport, createPaperSession, ensurePaperSessionsFromProfiles, runPaperForward, syncKnowledgeSkillLifecycle } = ctx;

  app.get("/api/paper/sessions", (_req, res) => res.json(buildPaperReport(db)));

  app.post("/api/paper/start", requirePermission("write:review"), async (req, res) => {
    try {
      const result = await createPaperSession(db, req.body || {});
      persist(res, result);
    } catch (error) {
      res.status(500).json({ error: `开模拟盘失败：${error.message}` });
    }
  });

  app.post("/api/paper/spawn-from-profiles", requirePermission("write:review"), async (req, res) => {
    const created = await ensurePaperSessionsFromProfiles(db, req.body || {});
    persist(res, { message: `已从已验证画像开出 ${created.length} 个模拟盘会话`, created });
  });

  app.post("/api/paper/run", requirePermission("write:review"), async (_req, res) => {
    try {
      const result = await runPaperForward(db);
      const knowledgeSkills = syncKnowledgeSkillLifecycle(db, db.user.name);
      persist(res, { ...result, knowledgeSkills });
    } catch (error) {
      res.status(500).json({ error: `前向推进失败：${error.message}` });
    }
  });
}
