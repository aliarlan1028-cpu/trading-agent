// 策略路由组（自适应画像/策略研究/策略表现看板）—— 从 index.mjs 按 registrar 范式迁出。
export function registerStrategyRoutes(app, ctx) {
  const { db, persist, requirePermission, activeStrategyProfiles, runStrategyResearch, buildStrategyBoard } = ctx;

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
}
