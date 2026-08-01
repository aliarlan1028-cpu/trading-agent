// 管理台：用户/订阅/密码 路由组 —— 从 index.mjs 按 registrar 范式迁出。全部 admin:system/security
// 高危面，含用户自助改密(/api/auth/change-password)。处理器逐字保留原实现，密钥/密码不回显。
export function registerAdminUserRoutes(app, ctx) {
  const { db, persist, saveDb, requirePermission, id, nowIso, appendAudit, hashPassword, verifyPassword, sanitizeUserRecord, invalidateSessions, setConfig, getConfigStatus, addMonthsIso } = ctx;
  const findUser = (idv) => (db.users || []).find((item) => item.id === idv);
  const userNotFound = (res) => res.status(404).json({ error: "User not found" });

  app.get("/api/admin/users", requirePermission("admin:system"), (_req, res) => {
    res.json({
      tenants: db.tenants || [],
      users: (db.users || []).map(({ passwordHash, password, ...safe }) => safe),
      subscriptions: db.subscriptions || []
    });
  });

  app.post("/api/admin/users", requirePermission("admin:system"), (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    const name = String(req.body.name || email.split("@")[0] || "新用户").trim();
    const password = String(req.body.password || "");
    const role = String(req.body.role || "交易用户").trim();
    const freeMonths = Number(req.body.freeMonths || 0);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "请输入有效邮箱" });
    if (password.length < 10) return res.status(400).json({ error: "初始密码至少 10 位" });
    db.users ||= [];
    if (db.users.some((item) => String(item.email || "").toLowerCase() === email)) return res.status(409).json({ error: "该邮箱已存在" });
    const createdAt = nowIso();
    const userId = id("user");
    const tenantId = id("tenant");
    const tenant = { id: tenantId, name: `${name} 的工作区`, ownerUserId: userId, planId: freeMonths > 0 ? "owner_free" : "trial", status: freeMonths > 0 ? "active" : "trial", createdAt };
    const user = { id: userId, tenantId, name, email, role, status: "active", passwordHash: hashPassword(password), createdAt };
    db.tenants ||= [];
    db.subscriptions ||= [];
    db.tenants.push(tenant);
    db.users.push(user);
    db.subscriptions.unshift({
      id: id("sub"),
      tenantId,
      userId,
      planId: freeMonths > 0 ? "owner_free" : "trial",
      status: freeMonths > 0 ? "active" : "trialing",
      source: freeMonths > 0 ? "owner_grant" : "admin_create",
      startedAt: createdAt,
      currentPeriodEnd: addMonthsIso(freeMonths || 0, freeMonths ? 0 : 7)
    });
    appendAudit(db, `Owner 创建用户：${email}`, user.id, req.user?.name || db.user.name);
    persist(res, { user: sanitizeUserRecord(user), tenant });
  });

  app.patch("/api/admin/users/:id", requirePermission("admin:system"), (req, res) => {
    const user = findUser(req.params.id);
    if (!user) return userNotFound(res);
    const allowed = ["name", "role", "status", "isOwner"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) user[key] = req.body[key];
    }
    user.updatedAt = nowIso();
    appendAudit(db, `更新用户：${user.email || user.id}`, user.id, req.user?.name || db.user.name);
    persist(res, { user: sanitizeUserRecord(user) });
  });

  // 用户自助修改密码（校验原密码）。Owner 密码由 ADMIN_PASSWORD 环境变量管理，不在此改。
  app.post("/api/auth/change-password", (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "未登录" });
    if (user.isOwner || !user.passwordHash) return res.status(400).json({ error: "Owner 密码通过 ADMIN_PASSWORD 环境变量管理，不在此修改" });
    const oldPassword = String(req.body?.oldPassword || "");
    const newPassword = String(req.body?.newPassword || "");
    if (!verifyPassword(oldPassword, user.passwordHash)) return res.status(401).json({ error: "原密码不正确" });
    if (newPassword.length < 10) return res.status(400).json({ error: "新密码至少 10 位" });
    user.passwordHash = hashPassword(newPassword);
    user.mustChangePassword = false;
    user.updatedAt = nowIso();
    appendAudit(db, "用户自助修改密码", user.id, user.name || user.email);
    persist(res, { ok: true });
  });

  // 账户自助资料：任何登录用户（含 Owner）都能改自己的显示名与头像。
  // 头像存 data URL（前端已压缩到 ≤128px），服务端再设 500KB 上限兜底，防止把库撑爆。
  app.patch("/api/account/profile", (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "未登录" });
    const patch = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (name.length < 1 || name.length > 40) return res.status(400).json({ error: "名称需 1–40 个字符" });
      patch.name = name;
    }
    if (req.body?.avatar !== undefined) {
      const avatar = String(req.body.avatar || "");
      if (avatar === "") {
        patch.avatar = ""; // 允许清空回到首字母头像
      } else {
        if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(avatar)) return res.status(400).json({ error: "头像需为 png/jpg/webp/gif 图片" });
        if (avatar.length > 500_000) return res.status(400).json({ error: "头像过大（压缩后仍超 500KB），请换一张" });
        patch.avatar = avatar;
      }
    }
    if (!Object.keys(patch).length) return res.status(400).json({ error: "没有要更新的字段" });
    Object.assign(user, patch, { updatedAt: nowIso() });
    appendAudit(db, `账户自助更新资料（${Object.keys(patch).join("、")}）`, user.id, user.name || user.email);
    persist(res, { ok: true, user: sanitizeUserRecord(user) });
  });

  // Admin 重置某用户密码为临时密码（用户登录后应自行修改）。
  app.post("/api/admin/users/:id/reset-password", requirePermission("admin:system"), (req, res) => {
    const user = findUser(req.params.id);
    if (!user) return userNotFound(res);
    if (user.isOwner) return res.status(400).json({ error: "Owner 密码由 ADMIN_PASSWORD 管理，无法在此重置" });
    const password = String(req.body?.password || "");
    if (password.length < 10) return res.status(400).json({ error: "临时密码至少 10 位" });
    user.passwordHash = hashPassword(password);
    user.mustChangePassword = true;
    user.updatedAt = nowIso();
    appendAudit(db, `重置用户密码：${user.email || user.id}`, user.id, req.user?.name || db.user.name, "warning");
    persist(res, { ok: true });
  });

  app.post("/api/admin/users/:id/grant-free", requirePermission("admin:system"), (req, res) => {
    const user = findUser(req.params.id);
    if (!user) return userNotFound(res);
    const months = Math.max(1, Number(req.body.months || 1));
    const planId = String(req.body.planId || "owner_free");
    db.subscriptions ||= [];
    const existing = db.subscriptions.find((item) => item.tenantId === user.tenantId);
    const subscription = {
      tenantId: user.tenantId,
      userId: user.id,
      planId,
      status: "active",
      source: "owner_grant",
      grantedBy: req.user?.id || db.user.id,
      startedAt: nowIso(),
      currentPeriodEnd: addMonthsIso(months)
    };
    if (existing) Object.assign(existing, subscription, { updatedAt: nowIso() });
    else db.subscriptions.unshift({ id: id("sub"), ...subscription });
    const tenant = (db.tenants || []).find((item) => item.id === user.tenantId);
    if (tenant) Object.assign(tenant, { status: "active", planId, updatedAt: nowIso() });
    appendAudit(db, `Owner 赠送免费授权：${user.email || user.name} ${months} 个月`, user.id, req.user?.name || db.user.name);
    persist(res, { message: `已赠送 ${months} 个月免费授权`, user: sanitizeUserRecord(user), subscription: existing || db.subscriptions[0] });
  });

  app.post("/api/admin/password", requirePermission("admin:security"), (req, res) => {
    const nextPassword = String(req.body.password || "");
    if (nextPassword.length < 12) return res.status(400).json({ error: "管理员密码至少 12 位" });
    setConfig(db, { ADMIN_PASSWORD: nextPassword });
    appendAudit(db, "修改管理员登录密码", "admin_password", req.user?.name || db.user.name, "warning");
    invalidateSessions(db);
    saveDb(db);
    res.json({ message: "管理员密码已更新，已退出当前登录，请用新密码重新登录。", logoutRequired: true, status: getConfigStatus(db) });
  });

  // 风控阈值(运行时可调,写 runtimeConfig 并同步 process.env → 各风控读取处即时生效)。
  app.get("/api/admin/risk-thresholds", requirePermission("admin:system"), async (_req, res) => {
    const { currentRiskThresholds, RISK_THRESHOLD_DEFS } = await import("../riskThresholds.mjs");
    res.json({ values: currentRiskThresholds(), defs: RISK_THRESHOLD_DEFS.map(({ toEnv, fromEnv, ...d }) => d) });
  });
  app.post("/api/admin/risk-thresholds", requirePermission("admin:system"), async (req, res) => {
    try {
      const { applyRiskThresholds } = await import("../riskThresholds.mjs");
      const result = applyRiskThresholds(db, req.body || {}, setConfig);
      if (result.applied.length) appendAudit(db, `更新风控阈值:${result.applied.join("、")}`, "risk_thresholds", req.user?.name || db.user.name, "warning");
      saveDb(db);
      res.json({ ok: true, ...result, message: result.applied.length ? "风控阈值已更新，即时生效" : "无变更" });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });

  // 公开注册开关(运行时,写 runtimeConfig 并同步 process.env → auth.register 立即生效)。
  // ⚠️ 一客户一实例的生产路径下开启=允许陌生访客自助注册,务必知悉安全含义。
  app.post("/api/admin/registration", requirePermission("admin:system"), (req, res) => {
    const enabled = req.body?.enabled === true || req.body?.enabled === "true";
    setConfig(db, { PUBLIC_REGISTRATION_ENABLED: enabled ? "true" : "false" });
    appendAudit(db, `公开注册已${enabled ? "开启" : "关闭"}`, "public_registration", req.user?.name || db.user.name, enabled ? "warning" : "info");
    saveDb(db);
    res.json({ ok: true, publicRegistrationEnabled: enabled, message: `公开注册已${enabled ? "开启" : "关闭"}` });
  });

  app.get("/api/admin/subscription-plans", requirePermission("admin:system"), (_req, res) => {
    res.json(db.subscriptionPlans || []);
  });

  app.post("/api/admin/subscription-plans", requirePermission("admin:system"), (req, res) => {
    const plan = {
      id: req.body.id || id("plan"),
      name: req.body.name || "新套餐",
      interval: req.body.interval || "month",
      months: Number(req.body.months || 1),
      priceUsdt: Number(req.body.priceUsdt || 0),
      enabled: req.body.enabled !== false,
      features: Array.isArray(req.body.features) ? req.body.features : [],
      createdAt: nowIso()
    };
    db.subscriptionPlans ||= [];
    db.subscriptionPlans.unshift(plan);
    appendAudit(db, `创建订阅套餐：${plan.name}`, plan.id, req.user?.name || db.user.name);
    persist(res, plan);
  });

  app.patch("/api/admin/subscription-plans/:id", requirePermission("admin:system"), (req, res) => {
    const plan = (db.subscriptionPlans || []).find((item) => item.id === req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    for (const key of ["name", "interval", "months", "priceUsdt", "enabled", "features"]) {
      if (req.body[key] !== undefined) plan[key] = key === "months" || key === "priceUsdt" ? Number(req.body[key]) : req.body[key];
    }
    plan.updatedAt = nowIso();
    appendAudit(db, `更新订阅套餐：${plan.name}`, plan.id, req.user?.name || db.user.name);
    persist(res, plan);
  });
}
