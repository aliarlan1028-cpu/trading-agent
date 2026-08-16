import { verifyAuditChain } from "../store.mjs";
import { applyLiveTradingConfiguration, partitionAutonomousBlockers, autonomousProductionBlockers } from "../liveModeService.mjs";
import { listConfiguredModelCatalog, llmCircuitStatus } from "../llmGateway.mjs";

// 安全与运行配置路由组（vault/交易所凭证/LLM 配置/实盘开关/密钥删除/告警/演练/审计链）——
// 从 index.mjs 按 registrar 范式迁出。全部 admin:security 高危面，处理器逐字保留原实现，
// 依赖经 ctx 注入。敏感值不回显（storeSecret 加密入库、只返回元数据）。
export function registerSecurityConfigRoutes(app, ctx) {
  const {
    db, persist, saveDb, requirePermission,
    listVaultItems, storeSecret, clearSecret, nowIso, appendAudit, appendTrace,
    refreshApiKeyMetadata, syncPrivateReadOnly, startRealtimeManager, validateOkxCredentialCandidate, invalidateOkxCredentialCaches,
    getConfigStatus, validateRuntimeConfig, setConfig, sendAlert, runSafetyDrill, verifyAuditChain
  } = ctx;

  app.get("/api/security/vault", requirePermission("admin:security"), (_req, res) => res.json(listVaultItems(db)));
  app.post("/api/security/vault", requirePermission("admin:security"), (req, res) => {
    try {
      const result = storeSecret(db, req.body.name, req.body.value, req.body.scope);
      persist(res, result);
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  app.post("/api/security/exchange-credentials", requirePermission("admin:security"), async (req, res) => {
    try {
      const exchange = String(req.body.exchange || "").toUpperCase();
      if (exchange !== "OKX") return res.status(400).json({ error: "自主交易系统仅允许配置 OKX" });
      const account = db.exchangeAccounts.find((item) => item.exchange === exchange);
      if (!account) return res.status(404).json({ error: "Exchange account not found" });
      const apiKey = String(req.body.apiKey || "");
      const apiSecret = String(req.body.apiSecret || "");
      const passphrase = String(req.body.passphrase || "");
      if (!apiKey || !apiSecret || !passphrase) {
        return res.status(400).json({ error: "必须一次提交完整的 OKX API Key、Secret 和 Passphrase；不允许与旧凭证混合保存" });
      }
      // 先用隔离候选值完成签名只读验证。验证前绝不改 process.env、金库、账户授权或 WS。
      const candidate = await validateOkxCredentialCandidate({ apiKey, apiSecret, passphrase });
      if (!candidate.ok) return res.status(422).json({ error: "候选 OKX 凭证验证失败；当前运行凭证和连接保持不变", validation: candidate });
      if (candidate.permissions.some((permission) => /withdraw/i.test(permission))) {
        return res.status(422).json({ error: "候选 OKX Key 含提现权限，禁止保存" });
      }
      const previousFingerprint = account.apiKeyFingerprint || null;
      const applied = setConfig(db, {
        OKX_API_KEY: apiKey,
        OKX_API_SECRET: apiSecret,
        OKX_API_PASSPHRASE: passphrase
      });
      if (req.body.ipWhitelist !== undefined) account.ipWhitelist = req.body.ipWhitelist || "建议开启";
      account.withdrawEnabled = false;
      account.status = "credentials_validated_authorization_required";
      account.lastCredentialUpdateAt = nowIso();
      refreshApiKeyMetadata(db);
      invalidateOkxCredentialCaches();
      // Key 轮换后旧快照仍保留审计，但 fingerprint 校验会使其不可用于交易；授权开关不会因“有凭证”自动开启。
      if (previousFingerprint && previousFingerprint !== account.apiKeyFingerprint) {
        account.readEnabled = false;
        account.tradeEnabled = false;
        account.authorizationResetAt = nowIso();
      }
      startRealtimeManager(db, saveDb, { force: true });
      appendAudit(db, `配置 ${exchange} API 凭证`, account.id, db.user.name, "warning");
      saveDb(db);
      res.json({
        message: `${exchange} 凭证已验证并原子切换；读取/交易授权保持独立，请在交易所设置中明确启用。`,
        account,
        validation: { status: candidate.status, posMode: candidate.posMode, permissions: candidate.permissions },
        applied
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  app.get("/api/config", requirePermission("admin:security"), (_req, res) => res.json(getConfigStatus(db)));
  app.get("/api/config/llm-models", requirePermission("admin:security"), async (_req, res) => {
    const catalog = await listConfiguredModelCatalog();
    res.set("Cache-Control", "private, max-age=300");
    res.json({ ...catalog, circuits: llmCircuitStatus() });
  });

  // 通用配置写入：LLM 密钥/模型、非敏感开关。敏感项加密入库，不回传明文。
  app.post("/api/config", requirePermission("admin:security"), async (req, res) => {
    try {
      if (Object.hasOwn(req.body || {}, "PUBLIC_REGISTRATION_ENABLED") || Object.hasOwn(req.body || {}, "PUBLIC_REGISTRATION_MODE")) {
        return res.status(400).json({ error: "公开申请模式只能通过专用注册管理接口修改，以便执行验证码、邮件和隔离前置检查" });
      }
      if (["OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE"].some((key) => Object.hasOwn(req.body || {}, key))) {
        return res.status(400).json({ error: "OKX 凭证只能通过专用安全接口一次性提交完整三件套" });
      }
      // Schema 校验:挡住空模型名、含空白的模型名、非 true/false 的开关（写错模型名会导致全线抽风）。
      const cfgCheck = validateRuntimeConfig(req.body || {});
      if (!cfgCheck.valid) return res.status(400).json({ error: `配置校验未通过：${cfgCheck.errors.join("；")}` });
      const applied = setConfig(db, req.body || {});
      if (cfgCheck.warnings.length) appendTrace(db, "config", `配置提醒：${cfgCheck.warnings.join("；")}`, "warning");
      refreshApiKeyMetadata(db);
      const exchangeValidations = [];
      for (const account of db.exchangeAccounts || []) {
        if (account.exchange !== "OKX") continue;
        const names = ["OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE"];
        if (names.some((name) => applied.includes(name)) && account.readEnabled) {
          exchangeValidations.push(await syncPrivateReadOnly(db, account.id));
        }
      }
      // 凭证或 Demo/Production 环境变化后必须 bump generation 并重连；REST 与 WS
      // 不允许继续混用变更前的账户环境。
      if (applied.some((name) => /API_KEY|API_SECRET|API_PASSPHRASE|OKX_DEMO_TRADING|OKX_BASE_URL/.test(name))) {
        invalidateOkxCredentialCaches();
        try { startRealtimeManager(db, saveDb, { force: true }); } catch { /* noop */ }
      }
      saveDb(db);
      const failedValidation = exchangeValidations.find((item) => item.status !== "ok");
      res.json({
        message: failedValidation
          ? `已保存配置，但交易所账户同步未成功：${failedValidation.error || failedValidation.status}`
          : applied.length ? `已保存：${applied.join("、")}` : "无变更",
        applied,
        exchangeValidations,
        status: getConfigStatus(db)
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  // 实盘开关 + 灰度额度（高危，集中一处并写审计）。
  app.post("/api/config/live-trading", requirePermission("admin:security"), (req, res) => {
    const result = applyLiveTradingConfiguration(db, req.body || {}, {
      user: req.user,
      actor: req.user?.name || db.user.name,
      setConfig,
      appendAudit,
      nowIso
    });
    if (!result.ok) return res.status(result.status || 422).json(result);
    saveDb(db);
    res.json({
      ...result,
      message: result.pendingBlockers.length
        ? `实盘配置已保存；当前暂缓新开仓，恢复后会自动按原模式运行：${result.pendingBlockers.join("、")}`
        : "实盘配置已更新",
      status: getConfigStatus(db)
    });
  });

  // 运行模式单一控制:观察/半自动/全自动 三选一,底层自动配好各闸——用户选"意图",不用理解 6 个开关。
  app.post("/api/system/operating-mode", requirePermission("approve:live_config"), (req, res) => {
    const mode = String(req.body?.mode || "");
    const MODE_CN = { observe: "观察", semi_auto: "半自动", full_auto: "全自动" };
    if (!MODE_CN[mode]) return res.status(400).json({ error: "mode 必须是 observe / semi_auto / full_auto" });
    const wantsLive = mode !== "observe";
    const result = applyLiveTradingConfiguration(db, {
      requestedMode: mode,
      acknowledged: wantsLive ? req.body?.acknowledged === true : false
    }, {
      user: req.user,
      actor: req.user?.name || db.user.name,
      setConfig,
      appendAudit,
      nowIso
    });
    if (!result.ok) return res.status(result.status || 422).json(result);
    if (!db.system.reduceOnlyMode) db.system.riskStatus = "正常";
    db.system.latestAction = `运行模式切换为「${MODE_CN[mode]}」`;
    appendTrace(db, "system", `运行模式:${MODE_CN[mode]}`, "ok");
    saveDb(db);
    res.json({
      ...result,
      message: result.pendingBlockers.length
        ? `已保存「${MODE_CN[mode]}」；当前暂缓新开仓，恢复后会自动运行：${result.pendingBlockers.join("、")}`
        : `已切换到「${MODE_CN[mode]}」`,
      status: getConfigStatus(db)
    });
  });

  app.delete("/api/config/secret/:key", requirePermission("admin:security"), (req, res) => {
    const ok = clearSecret(db, req.params.key);
    refreshApiKeyMetadata(db);
    if (/^OKX_API_(?:KEY|SECRET|PASSPHRASE)$/.test(req.params.key)) invalidateOkxCredentialCaches();
    try { startRealtimeManager(db, saveDb, { force: true }); } catch { /* 已由 generation 使旧私有流失效 */ }
    saveDb(db);
    res.json({ message: ok ? `已移除 ${req.params.key}` : "未知密钥", status: getConfigStatus(db) });
  });

  app.post("/api/security/alerts", requirePermission("admin:security"), async (req, res) => {
    persist(res, await sendAlert(db, req.body));
  });

  app.post("/api/security/drills/:type", requirePermission("admin:security"), (req, res) => {
    persist(res, runSafetyDrill(db, req.params.type));
  });

  app.get("/api/security/audit-chain", requirePermission("admin:system"), (_req, res) => res.json(verifyAuditChain(db)));
}

export { partitionAutonomousBlockers } from "../liveModeService.mjs";
