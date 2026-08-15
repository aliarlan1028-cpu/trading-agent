// 交易所路由组（K线/微观结构/账户元数据/API Key 权限/对账/只读同步/行情/私有动作）——
// 从 index.mjs 按 registrar 范式迁出。含 critical:trade_execution 私有动作(过硬闸)。
// withdrawEnabled 恒为 false（禁提币权限的系统级不变量）。依赖经 ctx 注入，crypto 直接引 node:crypto。
import crypto from "node:crypto";

export function registerExchangeRoutes(app, ctx) {
  const {
    db, persist, saveDb, requirePermission, id, nowIso, appendAudit, appendTrace,
    syncPublicKlines, syncMicrostructure, refreshApiKeyMetadata, reconcileAccount,
    syncPrivateReadOnly, syncPublicMarket, guardedPrivateExchangeAction, startRealtimeManager
  } = ctx;

  app.get("/api/exchange/:exchange/klines", requirePermission("market.read"), async (req, res) => {
    try {
      if (String(req.params.exchange).toUpperCase() !== "OKX") return res.status(400).json({ error: "行情仅允许 OKX" });
      const result = await syncPublicKlines(db, "OKX", req.query.symbol || "BTC/USDT", req.query.timeframe || "1h");
      saveDb(db);
      const market = db.markets.find((item) => item.symbol === result.symbol);
      res.json({ ...result, candles: market?.candles || [] });
    } catch (error) {
      res.status(502).json({ error: `K 线同步失败：${error.message}` });
    }
  });

  app.get("/api/exchange/:exchange/microstructure", requirePermission("market.read"), async (req, res) => {
    try {
      if (String(req.params.exchange).toUpperCase() !== "OKX") return res.status(400).json({ error: "微观结构仅允许 OKX" });
      const result = await syncMicrostructure(db, "OKX", req.query.symbol || "BTC/USDT");
      persist(res, result);
    } catch (error) {
      res.status(502).json({ error: `微观结构同步失败：${error.message}` });
    }
  });

  app.get("/api/exchange/accounts", requirePermission("admin:security"), (_req, res) => {
    refreshApiKeyMetadata(db);
    res.json((db.exchangeAccounts || []).filter((item) => item.exchange === "OKX"));
  });

  app.post("/api/exchange/accounts", requirePermission("admin:security"), (req, res) => {
    const account = {
      id: id("ex"),
      exchange: "OKX",
      label: req.body.label || "新交易所账户",
      accountType: req.body.accountType || "unified",
      readEnabled: false,
      tradeEnabled: false,
      withdrawEnabled: false,
      ipWhitelist: "建议开启",
      status: "missing_credentials",
      createdAt: nowIso()
    };
    db.exchangeAccounts.unshift(account);
    appendAudit(db, "创建交易所账户元数据", account.id, db.user.name);
    persist(res, account);
  });

  app.patch("/api/exchange/accounts/:id", requirePermission("admin:security"), (req, res) => {
    refreshApiKeyMetadata(db);
    const account = db.exchangeAccounts.find((item) => item.id === req.params.id);
    if (!account) return res.status(404).json({ error: "Exchange account not found" });
    const enabling = req.body.readEnabled === true || req.body.tradeEnabled === true;
    if (enabling && !account.credentialPresent) {
      return res.status(422).json({ error: "okx_credentials_unavailable", message: "当前没有完整可用的 OKX 凭证，不能开启账户权限。" });
    }
    const otherEnabled = (db.exchangeAccounts || []).filter((item) => item.exchange === "OKX" && item.id !== account.id && (item.readEnabled || item.tradeEnabled));
    if (enabling && otherEnabled.length) {
      return res.status(409).json({ error: "single_okx_credential_account_only", message: "当前只配置了一组 OKX 凭证，不能同时启用多个账户元数据。", conflictingAccountIds: otherEnabled.map((item) => item.id) });
    }
    const authorizationBefore = `${account.readEnabled === true}:${account.tradeEnabled === true}`;
    const allowed = ["label", "accountType", "readEnabled", "tradeEnabled", "ipWhitelist", "status"];
    for (const key of allowed) {
      if (req.body[key] !== undefined) account[key] = req.body[key];
    }
    if (account.tradeEnabled) account.readEnabled = true;
    account.status = account.readEnabled || account.tradeEnabled ? "configured" : (account.credentialPresent ? "authorization_disabled" : "missing_credentials");
    delete account.authorizationResetReason;
    delete account.authorizationResetAt;
    account.withdrawEnabled = false;
    account.updatedAt = nowIso();
    appendAudit(db, "更新交易所账户安全配置", account.id, db.user.name, "warning");
    const authorizationAfter = `${account.readEnabled === true}:${account.tradeEnabled === true}`;
    if (authorizationBefore !== authorizationAfter) startRealtimeManager(db, saveDb, { force: true });
    persist(res, { message: `${account.exchange} 账户配置已更新`, account });
  });

  app.get("/api/exchange/api-key-metadata", requirePermission("admin:security"), (_req, res) => {
    persist(res, refreshApiKeyMetadata(db));
  });

  app.post("/api/exchange/api-key-metadata/:id/confirm-no-withdraw", requirePermission("admin:security"), (req, res) => {
    const item = (db.apiKeyMetadata || []).find((key) => key.id === req.params.id);
    if (!item) return res.status(404).json({ error: "API key metadata not found" });
    if (item.exchange !== "OKX") return res.status(400).json({ error: "仅允许核验 OKX API Key" });
    const currentApiKey = process.env.OKX_API_KEY || "";
    item.apiKeyFingerprint = currentApiKey
      ? crypto.createHash("sha256").update(currentApiKey).digest("hex").slice(0, 16)
      : null;
    item.withdrawPermission = false;
    item.permissionVerifiedAt = nowIso();
    item.permissionVerificationStatus = "manual_confirmed";
    item.permissionVerificationNote = req.body.note || "用户已在交易所 API 管理页面确认该 Key 未开启提现权限。";
    item.manualWithdrawPermissionConfirmedAt = nowIso();
    item.manualWithdrawPermissionConfirmedBy = db.user?.name || "local_admin";
    appendAudit(db, `人工确认 ${item.exchange} API Key 无提现权限`, item.id, db.user?.name || "local_admin", "warning");
    persist(res, { message: `${item.exchange} API Key 已标记为无提现权限`, item });
  });

  app.post("/api/exchange/:accountId/reconcile", requirePermission("write:exchange"), (req, res) => {
    persist(res, reconcileAccount(db, req.params.accountId));
  });

  app.post("/api/exchange/:accountId/sync-readonly", requirePermission("write:exchange"), async (req, res) => {
    persist(res, await syncPrivateReadOnly(db, req.params.accountId));
  });

  app.get("/api/exchange/:exchange/ticker", requirePermission("market.read"), async (req, res) => {
    const symbol = req.query.symbol || "BTC/USDT";
    try {
      if (String(req.params.exchange).toUpperCase() !== "OKX") return res.status(400).json({ error: "行情仅允许 OKX" });
      const ticker = await syncPublicMarket(db, "OKX", symbol);
      persist(res, ticker);
    } catch (error) {
      const cached = db.markets.find((market) => market.symbol === symbol) || db.markets[0];
      appendAudit(db, "公开行情同步失败，返回缓存行情", `${req.params.exchange}:${symbol}`, "ExchangeConnector", "warning");
      appendTrace(db, "exchange_market", "公开行情同步失败", "error");
      saveDb(db);
      res.json({
        exchange: "OKX",
        symbol,
        status: "fallback_cached",
        error: error.message,
        message: cached?.price ? "公开行情同步失败，已显示最近缓存行情。" : "公开行情同步失败，当前没有可用缓存行情。",
        price: cached?.price ?? null,
        high24h: cached?.high24h ?? null,
        low24h: cached?.low24h ?? null,
        volume24h: cached?.volume24h ?? null,
        cachedAt: cached?.lastSyncedAt || db.meta.updatedAt
      });
    }
  });

  app.post("/api/exchange/private-action", requirePermission("critical:trade_execution"), (req, res) => {
    const result = guardedPrivateExchangeAction(db, req.body.action || "unknown", req.body.payload || {});
    appendAudit(db, `私有交易所动作：${result.status}`, req.body.action || "unknown", "ExchangeConnector", result.status.startsWith("blocked") ? "warning" : "info");
    appendTrace(db, "exchange_private", req.body.action || "private_action", result.status);
    persist(res, result);
  });
}
