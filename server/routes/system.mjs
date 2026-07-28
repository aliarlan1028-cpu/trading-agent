// 系统管理路由组（就绪度/数据备份/清空工作数据/自主开关）—— 从 index.mjs 按 registrar 范式迁出。
// autonomy 按开/关走不同权限；reset 保留用户/密钥/配置/风控规则/订阅。依赖经 ctx 注入。
export function registerSystemRoutes(app, ctx) {
  const { db, persist, requirePermission, nowIso, appendAudit, appendTrace, buildReadinessReport, createSystemBackup, resetOperationalData, getStorageInfo, userHasPermission } = ctx;

  app.get("/api/system/readiness", (_req, res) => res.json(buildReadinessReport(db)));

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
}
