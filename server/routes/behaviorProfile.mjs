// AI 交易行为画像路由:量化画像(确定性)+ LLM 叙述(deepseek)+ 喂回"行为镜"透镜。
import { computeBehaviorProfile, generateBehaviorNarrative, adoptBehaviorDisciplines } from "../behaviorProfile.mjs";

export function registerBehaviorProfileRoutes(app, ctx) {
  const { db, saveDb, nowIso, requirePermission } = ctx;

  // 量化画像(便宜、常在,前端也从 /api/overview 直接拿)
  app.get("/api/behavior-profile", requirePermission("account.read"), (_req, res) => res.json(computeBehaviorProfile(db)));

  // LLM 叙述:按需生成(不每次巡检都调),结果缓存到 db.system.behaviorNarrative
  app.post("/api/behavior-profile/narrative", requirePermission("assistant.use"), async (_req, res) => {
    const profile = computeBehaviorProfile(db);
    if (!profile.trades) return res.json({ profile, narrative: null, note: profile.note });
    try {
      const narrative = await generateBehaviorNarrative(db, profile);
      if (narrative) { db.system.behaviorNarrative = { ...narrative, at: nowIso() }; saveDb(db); }
      res.json({ profile, narrative });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // 喂回:把画像出的纪律固化为常驻"行为镜"透镜(手动,用户审后点)
  app.post("/api/behavior-profile/adopt-discipline", requirePermission("write:knowledge"), (req, res) => {
    const disciplines = Array.isArray(req.body?.disciplines) ? req.body.disciplines : [];
    const lens = adoptBehaviorDisciplines(db, disciplines, "用户");
    if (!lens) return res.status(400).json({ error: "没有可采纳的纪律" });
    saveDb(db);
    res.json({ ok: true, lens });
  });
}
