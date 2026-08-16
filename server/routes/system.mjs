import { applyDerivedProfitGoals } from "../profitGoals.mjs";
import { syncReduceOnlyState } from "../reduceOnlyState.mjs";

// 系统管理路由组（就绪度/数据备份/清空工作数据/自主开关）—— 从 index.mjs 按 registrar 范式迁出。
// autonomy 按开/关走不同权限；reset 保留用户/密钥/配置/风控规则/订阅。依赖经 ctx 注入。
export function registerSystemRoutes(app, ctx) {
  const { db, persist, requirePermission, nowIso, appendAudit, appendTrace, buildReadinessReport, createSystemBackup, resetOperationalData, getStorageInfo, userHasPermission } = ctx;

  app.get("/api/system/readiness", requirePermission("admin:system"), (_req, res) => res.json(buildReadinessReport(db)));

  // 界面/AI 语言偏好:前端切换语言时调,存 db.system.uiLang,AI 提示词据此决定输出语言。
  app.post("/api/system/language", requirePermission("write:mandate"), (req, res) => {
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

  app.post("/api/system/autonomy", requirePermission("approve:live_config"), (req, res) => {
    const requiredPermission = req.body.enabled === false ? "write:mandate" : "approve:live_config";
    if (!userHasPermission(db, req.user, requiredPermission)) {
      return res.status(403).json({ error: `Missing permission: ${requiredPermission}` });
    }
    db.system.autonomyEnabled = req.body.enabled !== false;
    syncReduceOnlyState(db);
    db.system.latestAction = db.system.autonomyEnabled
      ? db.system.killSwitch ? "AI 交易员保持熔断，仅恢复非交易观察" : "恢复 AI 交易员观察与计划"
      : "暂停 AI 交易员自动推进";
    db.system.updatedAt = nowIso();
    appendAudit(db, db.system.autonomyEnabled ? "恢复自动交易推进" : "暂停自动交易推进", "system.autonomy", req.user?.name || db.user.name, db.system.autonomyEnabled ? "info" : "warning");
    appendTrace(db, "system", db.system.latestAction, db.system.killSwitch ? "danger" : db.system.reduceOnlyMode ? "warning" : db.system.autonomyEnabled ? "ok" : "paused");
    persist(res, db.system);
  });

  // 盈利目标仍绝不注入开仓决策，避免“为凑目标而追单”。可选的保本规则只在仓位
  // 已经产生足额浮盈后管理止损，属于确定性降风险动作，不改变方向/入场/止盈。
  app.post("/api/system/goals", requirePermission("approve:live_config"), (req, res) => {
    const dn = Number(req.body?.dailyGoalUsdt);
    const nextDailyGoal = req.body?.dailyGoalUsdt !== undefined
      ? (Number.isFinite(dn) && dn > 0 ? dn : null)
      : db.system.dailyGoalUsdt;
    const nextBreakevenEnabled = req.body?.dailyGoalBreakevenEnabled !== undefined
      ? req.body.dailyGoalBreakevenEnabled === true
      : db.system.dailyGoalBreakevenEnabled === true;
    if (nextBreakevenEnabled && !(Number.isFinite(Number(nextDailyGoal)) && Number(nextDailyGoal) > 0)) {
      return res.status(400).json({ error: "启用每日目标保本前必须明确设置大于 0 的每日盈利目标" });
    }
    db.system.dailyGoalUsdt = nextDailyGoal;
    // 月目标不再接受独立输入：始终按北京时间当前自然月的天数由日目标派生。
    // 即使旧客户端仍发送 monthlyGoalUsdt，也不会覆盖这个确定性口径。
    applyDerivedProfitGoals(db.system, nowIso());
    if (req.body?.dailyGoalBreakevenEnabled !== undefined) {
      db.system.dailyGoalBreakevenEnabled = nextBreakevenEnabled;
    }
    db.system.updatedAt = nowIso();
    appendAudit(db, `更新盈利目标:日 ${db.system.dailyGoalUsdt ?? "未设"} / 月 ${db.system.monthlyGoalUsdt ?? "未设"} USDT（日目标 × 当月 ${db.system.monthlyGoalDays} 天）；单笔达标保本 ${db.system.dailyGoalBreakevenEnabled ? "开启" : "关闭"}`, "system.goals", req.user?.name || db.user.name, db.system.dailyGoalBreakevenEnabled ? "warning" : "info");
    persist(res, db.system);
  });
}
