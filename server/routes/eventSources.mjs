// 事件源路由组（新增/刷新 RSS/链上信号/列表）—— 从 index.mjs 按 registrar 范式迁出。
export function registerEventSourceRoutes(app, ctx) {
  const { db, persist, requirePermission, id, nowIso, appendAudit, refreshEventSources, refreshOnchainSignals, testEventSource, assertSafeExternalUrl } = ctx;

  const normalizedUrl = (value) => {
    let parsed;
    try { parsed = new URL(String(value || "").trim()); }
    catch { throw new Error("事件源 URL 无效"); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("事件源 URL 只允许 http/https");
    if (parsed.username || parsed.password) throw new Error("事件源 URL 禁止内嵌凭证");
    parsed.hash = "";
    return parsed.toString();
  };

  function validatedInput(body = {}, existing = null) {
    const name = String(body.name ?? existing?.name ?? "").trim();
    const type = String(body.type ?? existing?.type ?? "").trim();
    const url = normalizedUrl(body.url ?? existing?.url);
    const trustScore = Number(body.trustScore ?? existing?.trustScore ?? 70);
    if (!name || name.length > 80) throw new Error("事件源名称必须为 1–80 个字符");
    if (!["rss", "html"].includes(type)) throw new Error("事件源类型只允许 rss/html");
    if (!Number.isFinite(trustScore) || trustScore < 1 || trustScore > 100) throw new Error("可信度必须是 1–100 的数字");
    return { name, type, url, trustScore, category: String(body.category ?? existing?.category ?? "自定义").trim().slice(0, 40) || "自定义" };
  }

  const duplicateUrl = (url, excludeId = null) => (db.eventSources || []).find((source) => {
    if (source.id === excludeId) return false;
    try { return normalizedUrl(source.url) === url; }
    catch { return String(source.url || "").trim() === url; }
  });

  app.post("/api/event-sources", requirePermission("write:event"), async (req, res) => {
    if (req.body.enabled !== undefined && typeof req.body.enabled !== "boolean") return res.status(400).json({ error: "enabled 必须是布尔值" });
    let input;
    try { input = validatedInput(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try { await assertSafeExternalUrl(input.url); }
    catch (error) { return res.status(400).json({ error: `事件源 URL 安全校验失败：${error.message}` }); }
    const existing = duplicateUrl(input.url);
    if (existing) return res.status(409).json({ error: `该 URL 已配置为「${existing.name}」`, existingId: existing.id });
    const source = {
      id: id("event_source"),
      ...input,
      enabled: req.body.enabled !== false,
      createdAt: nowIso()
    };
    db.eventSources ||= [];
    db.eventSources.unshift(source);
    appendAudit(db, "新增事件源", source.id, db.user.name);
    persist(res, source);
  });

  // 编辑/停用：改名称/URL/类型/可信度、开关 enabled。
  app.patch("/api/event-sources/:id", requirePermission("write:event"), async (req, res) => {
    const source = (db.eventSources || []).find((s) => s.id === req.params.id);
    if (!source) return res.status(404).json({ error: "事件源不存在" });
    if (req.body.enabled !== undefined && typeof req.body.enabled !== "boolean") return res.status(400).json({ error: "enabled 必须是布尔值" });
    let input;
    try { input = validatedInput(req.body, source); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    if ((req.body.url !== undefined && input.url !== normalizedUrl(source.url)) || req.body.enabled === true) {
      try { await assertSafeExternalUrl(input.url); }
      catch (error) { return res.status(400).json({ error: `事件源 URL 安全校验失败：${error.message}` }); }
    }
    const duplicate = duplicateUrl(input.url, source.id);
    if (duplicate) return res.status(409).json({ error: `该 URL 已配置为「${duplicate.name}」`, existingId: duplicate.id });
    Object.assign(source, input);
    if (req.body.enabled !== undefined) source.enabled = req.body.enabled !== false;
    source.updatedAt = nowIso();
    appendAudit(db, `更新事件源：${source.name}${req.body.enabled === false ? "(停用)" : req.body.enabled === true ? "(启用)" : ""}`, source.id, db.user.name);
    persist(res, source);
  });

  // 删除事件源(不删已抓到的历史事件,只是不再从此源抓)。
  app.delete("/api/event-sources/:id", requirePermission("write:event"), (req, res) => {
    const before = (db.eventSources || []).length;
    db.eventSources = (db.eventSources || []).filter((s) => s.id !== req.params.id);
    if (db.eventSources.length === before) return res.status(404).json({ error: "事件源不存在" });
    appendAudit(db, "删除事件源", req.params.id, db.user.name, "warning");
    persist(res, { ok: true, removed: req.params.id });
  });

  app.post("/api/event-sources/refresh", requirePermission("write:event"), async (_req, res) => {
    persist(res, await refreshEventSources(db, { force: true }));
  });

  app.post("/api/event-sources/:id/test", requirePermission("write:event"), async (req, res) => {
    const source = (db.eventSources || []).find((item) => item.id === req.params.id);
    if (!source) return res.status(404).json({ error: "事件源不存在" });
    source.lastAttemptAt = nowIso();
    try {
      const result = await testEventSource(source);
      source.lastTestAt = nowIso();
      source.lastTestStatus = "ok";
      source.lastTestError = null;
      appendAudit(db, `测试事件源成功：${source.name}`, source.id, req.user?.name || db.user.name);
      persist(res, result);
    } catch (error) {
      source.lastTestAt = nowIso();
      source.lastTestStatus = "failed";
      source.lastTestError = String(error.message || error).slice(0, 180);
      appendAudit(db, `测试事件源失败：${source.name}`, source.id, req.user?.name || db.user.name, "warning");
      // 连接测试失败是一个已落库、可展示的诊断结果，不让通用 persist 丢失 HTTP 状态。
      res.status(502);
      persist(res, { status: "failed", error: source.lastTestError });
    }
  });

  app.post("/api/event-sources/onchain", requirePermission("write:event"), async (_req, res) => {
    persist(res, await refreshOnchainSignals(db));
  });

  app.get("/api/event-sources", (_req, res) => res.json(db.eventSources || []));
}
