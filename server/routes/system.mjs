// 系统管理路由组（就绪度/数据备份/清空工作数据/自主开关）—— 从 index.mjs 按 registrar 范式迁出。
// autonomy 按开/关走不同权限；reset 保留用户/密钥/配置/风控规则/订阅。依赖经 ctx 注入。
export function registerSystemRoutes(app, ctx) {
  const { db, persist, requirePermission, nowIso, appendAudit, appendTrace, buildReadinessReport, createSystemBackup, resetOperationalData, getStorageInfo, userHasPermission } = ctx;

  app.get("/api/system/readiness", (_req, res) => res.json(buildReadinessReport(db)));

  // 界面/AI 语言偏好:前端切换语言时调,存 db.system.uiLang,AI 提示词据此决定输出语言。
  app.post("/api/system/language", (req, res) => {
    const lang = req.body?.lang === "en" ? "en" : "zh";
    db.system.uiLang = lang;
    persist(res, { message: lang === "en" ? "UI/AI language set to English" : "界面/AI 语言已设为中文", uiLang: lang });
  });

  app.post("/api/system/backup", requirePermission("admin:system"), async (_req, res) => {
    try {
      persist(res, await createSystemBackup(db));
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/system/reset-operational-data", requirePermission("admin:system"), (req, res) => {
    resetOperationalData(db, { actor: req.user?.name || db.user.name, keepAudit: req.body.keepAudit !== false });
    persist(res, { message: "已清空工作数据，保留用户、密钥、配置、风控规则与订阅设置。", storage: getStorageInfo() });
  });

  app.post("/api/system/autonomy", (req, res) => {
    const requiredPermission = req.body.enabled === false ? "write:mandate" : "approve:live_config";
    if (!userHasPermission(db, req.user, requiredPermission)) {
      return res.status(403).json({ error: `Missing permission: ${requiredPermission}` });
    }
    db.system.autonomyEnabled = req.body.enabled !== false;
    db.system.riskStatus = db.system.killSwitch ? "熔断停机" : db.system.autonomyEnabled ? "正常" : "人工暂停";
    db.system.latestAction = db.system.autonomyEnabled
      ? db.system.killSwitch ? "AI 交易员保持熔断，仅恢复非交易观察" : "恢复 AI 交易员观察与计划"
      : "暂停 AI 交易员自动推进";
    db.system.updatedAt = nowIso();
    appendAudit(db, db.system.autonomyEnabled ? "恢复自动交易推进" : "暂停自动交易推进", "system.autonomy", req.user?.name || db.user.name, db.system.autonomyEnabled ? "info" : "warning");
    appendTrace(db, "system", db.system.latestAction, db.system.autonomyEnabled ? "ok" : "paused");
    persist(res, db.system);
  });

  // 盈利目标(日/月):只给监控/展示层(目标进度、日目标命中率、波动门槛工具)读——
  // 【重要】绝不注入交易决策提示词,避免"为凑目标而追单"的报复性/过度交易。可配、可清(传 null/0)。
  app.post("/api/system/goals", (req, res) => {
    const dn = Number(req.body?.dailyGoalUsdt), mn = Number(req.body?.monthlyGoalUsdt);
    if (req.body?.dailyGoalUsdt !== undefined) db.system.dailyGoalUsdt = Number.isFinite(dn) && dn > 0 ? dn : null;
    if (req.body?.monthlyGoalUsdt !== undefined) db.system.monthlyGoalUsdt = Number.isFinite(mn) && mn > 0 ? mn : null;
    db.system.updatedAt = nowIso();
    appendAudit(db, `更新盈利目标:日 ${db.system.dailyGoalUsdt ?? "未设"} / 月 ${db.system.monthlyGoalUsdt ?? "未设"} USDT`, "system.goals", req.user?.name || db.user.name);
    persist(res, db.system);
  });
}
