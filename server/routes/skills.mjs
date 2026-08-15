// Skills 路由组（列表/导入/拉取/扫描/安装/停用/删除/信任/撤信任/回滚/沙箱运行）——
// 从 index.mjs 按 registrar 范式迁出。信任=把 SKILL.md 方法论注入 AI 决策(需扫描通过+二次确认,
// 进小额试用生命周期)的语义逐字保留。依赖经 ctx 注入。
export function registerSkillRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, fetchSkillPackage, scanSkill, installSkill, verifySkillPackageIntegrity, readSkillInstructions, runSkillSandbox } = ctx;
  const findSkill = (idv) => db.skills.find((item) => item.id === idv);
  const notFound = (res) => res.status(404).json({ error: "Skill not found" });

  app.get("/api/skills", requirePermission("knowledge.read"), (_req, res) => res.json(db.skills));

  app.post("/api/skills/import", requirePermission("write:skills"), (req, res) => {
    const skill = {
      id: id("skill"),
      name: req.body.name || "Imported Skill",
      source: req.body.source || "GitHub",
      version: req.body.version || "0.1.0",
      status: "待扫描",
      scan: "未扫描",
      permissions: req.body.permissions || ["web.read"],
      lastCalled: "从未"
    };
    db.skills.unshift(skill);
    appendAudit(db, "导入 Skill", skill.id, "Skill Manager");
    persist(res, skill);
  });

  app.post("/api/skills/fetch", requirePermission("write:skills"), async (req, res) => {
    try {
      persist(res, await fetchSkillPackage(db, req.body));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/skills/:id/scan", requirePermission("write:skills"), (req, res) => {
    const skill = scanSkill(db, req.params.id);
    if (!skill) return notFound(res);
    persist(res, skill);
  });

  app.post("/api/skills/:id/install", requirePermission("skill.install"), (req, res) => {
    try {
      const skill = installSkill(db, req.params.id, req.user?.name || db.user.name, {
        securityApproved: req.body.securityApproved === true
      });
      if (!skill) return notFound(res);
      persist(res, skill);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  app.post("/api/skills/:id/disable", requirePermission("write:skills"), (req, res) => {
    const skill = findSkill(req.params.id);
    if (!skill) return notFound(res);
    skill.status = "已禁用";
    skill.disabledAt = nowIso();
    skill.disabledBy = db.user.name;
    appendAudit(db, "禁用 Skill", skill.id, db.user.name);
    persist(res, skill);
  });

  // 内置工具一键(重新)启用:第一方只读分析代码,无需走扫描→安装闸(那是给不可信导入 skill 的)。
  // 导入 skill 仍必须扫描通过后 install,不走此路。
  app.post("/api/skills/:id/enable", requirePermission("write:skills"), (req, res) => {
    const skill = findSkill(req.params.id);
    if (!skill) return notFound(res);
    if (!skill.native) return res.status(400).json({ error: "仅内置工具可直接启用；导入 Skill 需扫描通过后安装。" });
    skill.status = "已启用";
    skill.enabled = true;
    if (skill.scan === "未扫描") skill.scan = "内置免扫描";
    delete skill.disabledAt;
    appendAudit(db, "启用内置工具", skill.id, req.user?.name || db.user?.name || "Owner");
    persist(res, skill);
  });

  app.delete("/api/skills/:id", requirePermission("write:skills"), (req, res) => {
    const idx = (db.skills || []).findIndex((item) => item.id === req.params.id);
    if (idx < 0) return notFound(res);
    const [removed] = db.skills.splice(idx, 1);
    appendAudit(db, `删除 Skill「${removed.name}」`, removed.id, db.user?.name || "Owner", "warning");
    persist(res, { message: `已删除 Skill：${removed.name}`, id: removed.id });
  });

  // 信任导入 skill:把它的 SKILL.md 方法论注入 AI 决策提示词(不走 Docker 沙箱——本机无 Docker,
  // 且 ClawHub/Claude skill 本就是"给 LLM 的方法说明书")。必须扫描通过 + 二次确认;进小额试用生命周期。
  app.post("/api/skills/:id/trust", requirePermission("skill.install"), async (req, res) => {
    const skill = findSkill(req.params.id);
    if (!skill) return notFound(res);
    if (skill.native) return res.status(400).json({ error: "内置技能无需信任,直接启用即可" });
    if (!["通过", "需复核"].includes(skill.scan)) return res.status(400).json({ error: "必须先安全扫描通过才能信任" });
    const integrity = verifySkillPackageIntegrity?.(skill);
    if (!integrity?.ok) return res.status(409).json({ error: `Skill 在扫描后发生变化，必须重新扫描：${integrity?.reason || "integrity_unavailable"}` });
    const instructions = await readSkillInstructions(skill).catch(() => "");
    if (!instructions.trim()) return res.status(400).json({ error: "读不到该 skill 的方法论正文(SKILL.md),无法注入决策——请确认导入内容非空" });
    skill.instructions = instructions;
    skill.trusted = true;
    skill.trustedAt = nowIso();
    skill.trustedBy = db.user?.name || "Owner";
    skill.trustStatus = "live_probation";
    skill.status = "已启用";
    appendAudit(db, `信任导入 Skill（方法论注入 AI 决策，进小额试用）「${skill.name}」`, skill.id, db.user?.name || "Owner", "warning");
    persist(res, { message: `已信任「${skill.name}」，其方法论已注入 AI 决策；进入小额试用，按真实成绩转正/退役`, skill });
  });

  app.post("/api/skills/:id/untrust", requirePermission("write:skills"), (req, res) => {
    const skill = findSkill(req.params.id);
    if (!skill) return notFound(res);
    skill.trusted = false;
    skill.untrustedAt = nowIso();
    appendAudit(db, `撤销信任导入 Skill「${skill.name}」`, skill.id, db.user?.name || "Owner", "warning");
    persist(res, { message: `已撤销信任「${skill.name}」，已移出 AI 决策方法论`, skill });
  });

  app.post("/api/skills/:id/rollback", requirePermission("write:skills"), (req, res) => {
    const skill = findSkill(req.params.id);
    if (!skill) return notFound(res);
    skill.status = "已回滚";
    skill.rollbackTo = req.body.version || skill.previousVersion || "previous";
    skill.rolledBackAt = nowIso();
    appendAudit(db, "回滚 Skill", skill.id, db.user.name, "warning");
    persist(res, skill);
  });

  app.post("/api/skills/:id/run-sandbox", requirePermission("write:skills"), async (req, res) => {
    persist(res, await runSkillSandbox(db, req.params.id, req.body || {}));
  });
}
