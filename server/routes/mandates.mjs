// 授权委托(MANDATE)路由组 —— 从 index.mjs 按 registrar 范式迁出。
// 版本语义：内容变更(PATCH/暂停/撤销)才 +1；激活不抬版本(否则激活前提出的计划立刻全部
// "版本过期"被风控拒，主流程跑不通——见下方 activate 注释)。依赖统一经 ctx 注入。
export function registerMandateRoutes(app, ctx) {
  const { db, persist, requirePermission, parseMandateCommand, activateMandate, id, nowIso, appendAudit, appendTrace } = ctx;
  const findMandate = (idv) => db.mandates.find((item) => item.id === idv);
  const notFound = (res) => res.status(404).json({ error: "Mandate not found" });

  app.get("/api/mandates", (_req, res) => res.json(db.mandates));

  app.post("/api/mandates/parse", requirePermission("write:mandate"), (req, res) => {
    res.json(parseMandateCommand(db, req.body.command || req.body.text || ""));
  });

  app.post("/api/mandates", requirePermission("write:mandate"), (req, res) => {
    const mandate = {
      id: id("mandate"),
      version: 1,
      status: "active",
      createdAt: nowIso(),
      allowedActions: ["open", "cancel", "amend", "close", "move_stop", "take_profit"],
      ...req.body
    };
    db.mandates.unshift(mandate);
    appendAudit(db, "创建自主交易授权", mandate.id, db.user.name);
    appendTrace(db, "mandate", `创建授权 ${mandate.name || mandate.id}`);
    persist(res, mandate);
  });

  app.get("/api/mandates/:id", (req, res) => {
    const mandate = findMandate(req.params.id);
    if (!mandate) return notFound(res);
    res.json(mandate);
  });

  app.patch("/api/mandates/:id", requirePermission("write:mandate"), (req, res) => {
    const mandate = findMandate(req.params.id);
    if (!mandate) return notFound(res);
    Object.assign(mandate, req.body, { version: Number(mandate.version || 1) + 1, updatedAt: nowIso() });
    appendAudit(db, `更新授权状态：${req.body.status || "updated"}`, mandate.id, db.user.name);
    persist(res, mandate);
  });

  app.post("/api/mandates/:id/activate", requirePermission("write:mandate"), (req, res) => {
    const mandate = activateMandate(db, req.params.id);
    if (!mandate) return notFound(res);
    // 激活不抬版本(P0)：版本语义=内容变更(PATCH 时 +1)。此前激活即 +1，
    // 激活前提出的计划立刻全部"版本过期"被风控拒——标准主流程直接跑不通。
    mandate.version = Number(mandate.version || 1);
    persist(res, mandate);
  });

  app.post("/api/mandates/:id/pause", requirePermission("write:mandate"), (req, res) => {
    const mandate = findMandate(req.params.id);
    if (!mandate) return notFound(res);
    mandate.status = "paused";
    mandate.version = Number(mandate.version || 1) + 1;
    mandate.pausedAt = nowIso();
    appendAudit(db, "暂停授权委托", mandate.id, db.user.name, "warning");
    persist(res, mandate);
  });

  app.post("/api/mandates/:id/revoke", requirePermission("write:mandate"), (req, res) => {
    const mandate = findMandate(req.params.id);
    if (!mandate) return notFound(res);
    mandate.status = "revoked";
    mandate.version = Number(mandate.version || 1) + 1;
    mandate.revokedAt = nowIso();
    appendAudit(db, "撤销授权委托", mandate.id, db.user.name, "warning");
    persist(res, mandate);
  });
}
