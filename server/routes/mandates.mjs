// 授权委托(MANDATE)路由组 —— 从 index.mjs 按 registrar 范式迁出。
// 版本语义：内容变更(PATCH/暂停/撤销)才 +1；激活不抬版本(否则激活前提出的计划立刻全部
// "版本过期"被风控拒，主流程跑不通——见下方 activate 注释)。依赖统一经 ctx 注入。
import { mergeMandatePatch, normalizeAndValidateMandate } from "../mandatePolicy.mjs";

export function registerMandateRoutes(app, ctx) {
  const { db, persist, requirePermission, parseMandateCommand, activateMandate, id, nowIso, appendAudit, appendTrace } = ctx;
  const findMandate = (idv) => db.mandates.find((item) => item.id === idv);
  const notFound = (res) => res.status(404).json({ error: "Mandate not found" });
  const defaultNotionalUsdt = () => {
    const gray = (db.grayReleasePolicies || []).find((item) => item.enabled);
    const value = Number(gray?.maxNotionalUsdt ?? process.env.MAX_LIVE_NOTIONAL_USDT ?? 50);
    return Number.isFinite(value) && value > 0 ? value : 50;
  };

  app.get("/api/mandates", (_req, res) => res.json(db.mandates));

  app.post("/api/mandates/parse", requirePermission("write:mandate"), (req, res) => {
    res.json(parseMandateCommand(db, req.body.command || req.body.text || ""));
  });

  app.post("/api/mandates", requirePermission("write:mandate"), (req, res) => {
    const checked = normalizeAndValidateMandate({
      id: id("mandate"),
      version: 1,
      status: "active",
      createdAt: nowIso(),
      allowedActions: ["open", "cancel", "amend", "close", "move_stop", "take_profit"],
      ...req.body
    }, { defaultNotionalUsdt: defaultNotionalUsdt() });
    if (!checked.valid) return res.status(400).json({ error: "Mandate 参数非法", details: checked.errors });
    const mandate = checked.normalized;
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
    const checked = normalizeAndValidateMandate(mergeMandatePatch(mandate, req.body), { defaultNotionalUsdt: defaultNotionalUsdt() });
    if (!checked.valid) return res.status(400).json({ error: "Mandate 参数非法", details: checked.errors });
    Object.assign(mandate, checked.normalized, {
      version: Number(mandate.version || 1) + 1,
      updatedAt: nowIso()
    });
    appendAudit(db, `更新交易权限：单笔 ${mandate.maxOrderNotionalUsdt}U / 单币种 ${mandate.maxSymbolNotionalUsdt}U / 组合 ${mandate.maxPortfolioNotionalUsdt}U`, mandate.id, db.user.name);
    persist(res, mandate);
  });

  app.post("/api/mandates/:id/activate", requirePermission("write:mandate"), (req, res) => {
    const current = findMandate(req.params.id);
    if (!current) return notFound(res);
    // Agent 草稿和历史数据也必须在激活前经过同一套生产约束，不能绕过创建/PATCH 路由。
    const checked = normalizeAndValidateMandate(current, { defaultNotionalUsdt: defaultNotionalUsdt() });
    if (!checked.valid) return res.status(400).json({ error: "Mandate 参数非法，不能激活", details: checked.errors });
    Object.assign(current, checked.normalized);
    const mandate = activateMandate(db, req.params.id);
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
