// 授权委托(MANDATE)路由组 —— 从 index.mjs 按 registrar 范式迁出。
// 版本语义：内容变更(PATCH/暂停/撤销)才 +1；激活不抬版本(否则激活前提出的计划立刻全部
// "版本过期"被风控拒，主流程跑不通——见下方 activate 注释)。依赖统一经 ctx 注入。
import { mergeMandatePatch, normalizeAndValidateMandate, sanitizeMandatePayload } from "../mandatePolicy.mjs";
import { transitionMandate } from "../mandateLifecycle.mjs";

export function registerMandateRoutes(app, ctx) {
  const { db, persist, requirePermission, parseMandateCommand, id, nowIso, appendAudit, appendTrace } = ctx;
  const findMandate = (idv) => db.mandates.find((item) => item.id === idv);
  const notFound = (res) => res.status(404).json({ error: "Mandate not found" });
  const defaultNotionalUsdt = () => {
    const gray = (db.grayReleasePolicies || []).find((item) => item.enabled);
    const value = Number(gray?.maxNotionalUsdt ?? process.env.MAX_LIVE_NOTIONAL_USDT ?? 50);
    return Number.isFinite(value) && value > 0 ? value : 50;
  };

  app.get("/api/mandates", requirePermission("account.read"), (_req, res) => res.json(db.mandates));

  app.post("/api/mandates/parse", requirePermission("write:mandate"), (req, res) => {
    res.json(parseMandateCommand(db, req.body.command || req.body.text || ""));
  });

  app.post("/api/mandates", requirePermission("write:mandate"), (req, res) => {
    const writable = sanitizeMandatePayload(req.body || {});
    if (!writable.ok) return res.status(400).json({ error: writable.error, fields: writable.fields });
    const mandateId = id("mandate");
    if ((db.mandates || []).some((item) => item.id === mandateId)) return res.status(409).json({ error: "duplicate_mandate_id" });
    const createdAt = nowIso();
    const checked = normalizeAndValidateMandate({
      ...writable.value,
      id: mandateId,
      version: 1,
      status: "draft",
      createdAt,
      allowedActions: ["open", "cancel", "amend", "close", "move_stop", "take_profit"],
    }, { defaultNotionalUsdt: defaultNotionalUsdt() });
    if (!checked.valid) return res.status(400).json({ error: "Mandate 参数非法", details: checked.errors });
    const mandate = { ...checked.normalized, id: mandateId, version: 1, status: "draft", createdAt };
    db.mandates.unshift(mandate);
    appendAudit(db, "创建自主交易授权草稿", mandate.id, db.user.name);
    appendTrace(db, "mandate", `创建授权草稿 ${mandate.name || mandate.id}`);
    persist(res, mandate);
  });

  app.get("/api/mandates/:id", requirePermission("account.read"), (req, res) => {
    const mandate = findMandate(req.params.id);
    if (!mandate) return notFound(res);
    res.json(mandate);
  });

  app.patch("/api/mandates/:id", requirePermission("write:mandate"), (req, res) => {
    const mandate = findMandate(req.params.id);
    if (!mandate) return notFound(res);
    const writable = sanitizeMandatePayload(req.body || {});
    if (!writable.ok) return res.status(400).json({ error: writable.error, fields: writable.fields });
    const checked = normalizeAndValidateMandate(mergeMandatePatch(mandate, writable.value), { defaultNotionalUsdt: defaultNotionalUsdt() });
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
    const result = transitionMandate(db, current.id, "activate", {
      defaultNotionalUsdt: defaultNotionalUsdt(), actor: db.user.name, nowIso, appendAudit
    });
    if (!result.ok) return res.status(result.status).json(result);
    persist(res, result.mandate);
  });

  app.post("/api/mandates/:id/pause", requirePermission("write:mandate"), (req, res) => {
    const mandate = findMandate(req.params.id);
    if (!mandate) return notFound(res);
    const result = transitionMandate(db, mandate.id, "pause", { actor: db.user.name, nowIso, appendAudit });
    if (!result.ok) return res.status(result.status).json(result);
    persist(res, result.mandate);
  });

  app.post("/api/mandates/:id/revoke", requirePermission("write:mandate"), (req, res) => {
    const mandate = findMandate(req.params.id);
    if (!mandate) return notFound(res);
    const result = transitionMandate(db, mandate.id, "revoke", { actor: db.user.name, nowIso, appendAudit });
    if (!result.ok) return res.status(result.status).json(result);
    persist(res, result.mandate);
  });
}
