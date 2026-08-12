import { activeMandate, verifyAuditChain } from "../store.mjs";
import { requiresExternalSecurityInfrastructure } from "../securityProfile.mjs";
import { externalAlertConfigured, recentExternalAlertSucceeded } from "../alertHealth.mjs";

// 安全与运行配置路由组（vault/交易所凭证/LLM 配置/实盘开关/密钥删除/告警/演练/审计链）——
// 从 index.mjs 按 registrar 范式迁出。全部 admin:security 高危面，处理器逐字保留原实现，
// 依赖经 ctx 注入。敏感值不回显（storeSecret 加密入库、只返回元数据）。
export function registerSecurityConfigRoutes(app, ctx) {
  const {
    db, persist, saveDb, requirePermission,
    listVaultItems, storeSecret, clearSecret, nowIso, appendAudit, appendTrace,
    refreshApiKeyMetadata, syncPrivateReadOnly, startRealtimeManager,
    getConfigStatus, validateRuntimeConfig, setConfig, sendAlert, runSafetyDrill, verifyAuditChain
  } = ctx;

  app.get("/api/security/vault", (_req, res) => res.json(listVaultItems(db)));
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

      const saved = [];
      function saveSecret(envName, value) {
        if (!value) return;
        saved.push(storeSecret(db, envName, value, "exchange"));
        process.env[envName] = String(value);
      }

      saveSecret("OKX_API_KEY", req.body.apiKey);
      saveSecret("OKX_API_SECRET", req.body.apiSecret);
      saveSecret("OKX_API_PASSPHRASE", req.body.passphrase);

      if (req.body.ipWhitelist !== undefined) account.ipWhitelist = req.body.ipWhitelist || "建议开启";
      account.readEnabled = Boolean(process.env.OKX_API_KEY && process.env.OKX_API_SECRET && process.env.OKX_API_PASSPHRASE);
      account.tradeEnabled = account.readEnabled;
      account.withdrawEnabled = false;
      account.status = account.readEnabled ? "configured" : "missing_credentials";
      account.lastCredentialUpdateAt = nowIso();
      refreshApiKeyMetadata(db);
      const validation = account.readEnabled
        ? await syncPrivateReadOnly(db, account.id)
        : { status: "missing_credentials", error: "OKX 需要 API Key、Secret 和 Passphrase 才能同步账户。" };
      appendAudit(db, `配置 ${exchange} API 凭证`, account.id, db.user.name, "warning");
      persist(res, {
        message: validation.status === "ok"
          ? `${exchange} API 配置已保存，并已成功同步账户数据。`
          : `${exchange} API 配置已保存，但账户同步未成功：${validation.error || validation.status}`,
        account,
        validation,
        saved: saved.map((item) => ({ id: item.id, name: item.name, scope: item.scope }))
      });
    } catch (error) {
      res.status(error.status || 500).json({ error: error.message });
    }
  });

  app.get("/api/config", (_req, res) => res.json(getConfigStatus(db)));

  // 通用配置写入：LLM 密钥/模型、非敏感开关。敏感项加密入库，不回传明文。
  app.post("/api/config", requirePermission("admin:security"), async (req, res) => {
    try {
      if (Object.hasOwn(req.body || {}, "PUBLIC_REGISTRATION_ENABLED") || Object.hasOwn(req.body || {}, "PUBLIC_REGISTRATION_MODE")) {
        return res.status(400).json({ error: "公开申请模式只能通过专用注册管理接口修改，以便执行验证码、邮件和隔离前置检查" });
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
      // 交易所密钥变动后立即重连实时 WS（含私有用户流），让持仓/订单/账户实时推送生效，不必等重启。
      if (applied.some((name) => /API_KEY|API_SECRET|API_PASSPHRASE/.test(name))) {
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
    const requestedMode = req.body.requestedMode === undefined ? null : String(req.body.requestedMode);
    if (requestedMode && !["observe", "semi_auto", "full_auto"].includes(requestedMode)) {
      return res.status(400).json({ error: "requestedMode 必须是 observe / semi_auto / full_auto" });
    }
    if (requestedMode) {
      req.body.liveTradingEnabled = requestedMode !== "observe";
      req.body.orderWriteEnabled = requestedMode !== "observe";
      req.body.grayEnabled = requestedMode !== "observe";
      req.body.grayRequiresApproval = requestedMode === "semi_auto";
    }
    if (req.body.maxNotionalUsdt !== undefined) {
      const requestedMax = Number(req.body.maxNotionalUsdt);
      if (!Number.isFinite(requestedMax) || requestedMax <= 0) {
        return res.status(400).json({ error: "实盘灰度单笔额度必须是大于 0 的有效数字" });
      }
    }
    const currentGray = (db.grayReleasePolicies || []).find((item) => item.enabled);
    const resultingAuto = req.body.grayRequiresApproval === false
      || (req.body.grayRequiresApproval === undefined && currentGray?.requiresManualApproval === false);
    const enablingWrites = req.body.liveTradingEnabled === true || req.body.orderWriteEnabled === true;
    if (enablingWrites && process.env.REQUIRE_MFA_FOR_LIVE === "true" && req.user?.mfaEnabled !== true) {
      return res.status(412).json({ error: "启用实盘前必须先为当前 Owner 账户启用 TOTP 双因素认证", needMfa: true });
    }
    if (resultingAuto && enablingWrites) {
      const blockers = autonomousProductionBlockers(db, { allowModeToEnableSafety: requestedMode === "full_auto" });
      const { hard, transient } = partitionAutonomousBlockers(blockers);
      if (hard.length) return res.status(412).json({ error: "不能启用全自动写入：生产安全配置未完成", blockers: hard });
      req.pendingRuntimeBlockers = transient;
    }
    const entries = {};
    if (req.body.liveTradingEnabled !== undefined) entries.LIVE_TRADING_ENABLED = req.body.liveTradingEnabled ? "true" : "false";
    if (req.body.acknowledged !== undefined) entries.I_UNDERSTAND_REAL_TRADING = req.body.acknowledged ? "true" : "false";
    if (req.body.orderWriteEnabled !== undefined) entries.REAL_ORDER_WRITE_ENABLED = req.body.orderWriteEnabled ? "true" : "false";
    if (req.body.maxNotionalUsdt !== undefined) entries.MAX_LIVE_NOTIONAL_USDT = String(Number(req.body.maxNotionalUsdt));
    setConfig(db, entries);

    // 同步持久化到 db.system（存 sqlite，重启不丢，作为实盘闸的权威源）。
    if (req.body.acknowledged !== undefined) db.system.realTradingAck = Boolean(req.body.acknowledged);
    if (req.body.orderWriteEnabled !== undefined) db.system.orderWriteEnabled = Boolean(req.body.orderWriteEnabled);
    if (req.body.liveTradingEnabled !== undefined) db.system.liveTradingEnabled = Boolean(req.body.liveTradingEnabled) && db.system.realTradingAck === true;
    else db.system.liveTradingEnabled = db.system.liveTradingEnabled === true && db.system.realTradingAck === true;
    if (requestedMode) {
      db.system.autonomyEnabled = true;
      if (requestedMode === "full_auto") db.system.professionalRiskMode = true;
    }

    const gray = (db.grayReleasePolicies || []).find((item) => item.id === "gray_live_small_notional");
    if (gray) {
      if (req.body.grayEnabled !== undefined) gray.enabled = Boolean(req.body.grayEnabled);
      if (req.body.maxNotionalUsdt !== undefined) gray.maxNotionalUsdt = Number(req.body.maxNotionalUsdt);
      if (req.body.grayRequiresApproval !== undefined) gray.requiresManualApproval = Boolean(req.body.grayRequiresApproval);
      // 灰度允许币种:实盘执行范围。留空=不额外限制(授权白名单内的币都可实盘,仍受额度闸);
      // 填了=实盘只放这几个币先跑。规范成大写去重,与计划 symbol("XXX/USDT")对齐。
      if (req.body.allowedSymbols !== undefined) {
        const list = Array.isArray(req.body.allowedSymbols) ? req.body.allowedSymbols : [];
        gray.allowedSymbols = [...new Set(list.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
      }
      gray.updatedAt = nowIso();
    }
    // 保存的是用户选择的执行方式；临时对账/WS 故障只影响当前能否执行，不能把
    // 这个持久化意图改写成“只分析”。
    if (requestedMode || req.body.liveTradingEnabled !== undefined || req.body.grayRequiresApproval !== undefined) {
      db.system.requestedOperatingMode = requestedMode || (db.system.liveTradingEnabled !== true
        ? "observe"
        : gray?.requiresManualApproval === false ? "full_auto" : "semi_auto");
    }
    appendAudit(db, "更新实盘交易开关与灰度额度", "live_trading_config", db.user.name, "warning");
    saveDb(db);
    const pendingBlockers = req.pendingRuntimeBlockers || [];
    res.json({
      message: pendingBlockers.length
        ? `实盘配置已保存；当前暂缓新开仓，恢复后会自动按原模式运行：${pendingBlockers.join("、")}`
        : "实盘配置已更新",
      requestedMode: db.system.requestedOperatingMode,
      pendingBlockers,
      status: getConfigStatus(db)
    });
  });

  // 运行模式单一控制:观察/半自动/全自动 三选一,底层自动配好各闸——用户选"意图",不用理解 6 个开关。
  app.post("/api/system/operating-mode", requirePermission("approve:live_config"), (req, res) => {
    const mode = String(req.body?.mode || "");
    const MODE_CN = { observe: "观察", semi_auto: "半自动", full_auto: "全自动" };
    if (!MODE_CN[mode]) return res.status(400).json({ error: "mode 必须是 observe / semi_auto / full_auto" });
    if (db.system.killSwitch) return res.status(409).json({ error: "已熔断，请先解除熔断再切换模式" });
    const wantsLive = mode !== "observe";
    if (wantsLive && process.env.REQUIRE_MFA_FOR_LIVE === "true" && req.user?.mfaEnabled !== true) {
      return res.status(412).json({ error: "切到半自动/全自动前必须先启用 TOTP 双因素认证", needMfa: true });
    }
    if (wantsLive && req.body?.acknowledged !== true && db.system.realTradingAck !== true) {
      return res.status(412).json({ error: "切到半自动/全自动前必须确认：这会用真实资金下单", needAck: true });
    }
    if (mode === "full_auto") {
      const blockers = autonomousProductionBlockers(db, { allowModeToEnableSafety: true });
      const { hard, transient } = partitionAutonomousBlockers(blockers);
      if (hard.length) return res.status(412).json({ error: "不能启用全自动：生产安全配置未完成", blockers: hard });
      req.pendingRuntimeBlockers = transient;
    }
    db.system.requestedOperatingMode = mode;
    if (mode === "observe") {
      // 观察:自主开(照常分析/提计划),实盘写入关 → 只干跑,绝不真下单。
      db.system.autonomyEnabled = true;
      db.system.liveTradingEnabled = false;
      setConfig(db, { LIVE_TRADING_ENABLED: "false" });
    } else {
      // 半自动/全自动:开齐实盘三闸 + 灰度;差别只在灰度是否"保留人工确认"。
      if (req.body?.acknowledged === true) { db.system.realTradingAck = true; setConfig(db, { I_UNDERSTAND_REAL_TRADING: "true" }); }
      db.system.autonomyEnabled = true;
      db.system.orderWriteEnabled = true;
      db.system.liveTradingEnabled = db.system.realTradingAck === true;
      setConfig(db, { LIVE_TRADING_ENABLED: "true", REAL_ORDER_WRITE_ENABLED: "true" });
      db.grayReleasePolicies ||= [];
      let gray = db.grayReleasePolicies.find((g) => g.id === "gray_live_small_notional") || db.grayReleasePolicies.find((g) => g.enabled) || db.grayReleasePolicies[0];
      if (!gray) { gray = { id: "gray_live_small_notional", name: "小额灰度", maxNotionalUsdt: 50, createdAt: nowIso() }; db.grayReleasePolicies.unshift(gray); }
      gray.enabled = true;
      gray.requiresManualApproval = mode === "semi_auto";
      gray.updatedAt = nowIso();
      if (mode === "full_auto") {
        // 全自主去掉的是逐单人审，不是运行状态和专业风险闸。
        db.system.professionalRiskMode = true;
      }
    }
    if (!db.system.reduceOnlyMode) db.system.riskStatus = "正常";
    db.system.latestAction = `运行模式切换为「${MODE_CN[mode]}」`;
    db.system.updatedAt = nowIso();
    appendAudit(db, `切换运行模式 → ${MODE_CN[mode]}`, "system.operating_mode", db.user.name, mode === "full_auto" ? "critical" : "warning");
    appendTrace(db, "system", `运行模式:${MODE_CN[mode]}`, "ok");
    saveDb(db);
    const pendingBlockers = req.pendingRuntimeBlockers || [];
    res.json({
      message: pendingBlockers.length
        ? `已保存「${MODE_CN[mode]}」；当前暂缓新开仓，恢复后会自动运行：${pendingBlockers.join("、")}`
        : `已切换到「${MODE_CN[mode]}」`,
      requestedMode: mode,
      pendingBlockers,
      status: getConfigStatus(db)
    });
  });

  app.delete("/api/config/secret/:key", requirePermission("admin:security"), (req, res) => {
    const ok = clearSecret(db, req.params.key);
    refreshApiKeyMetadata(db);
    saveDb(db);
    res.json({ message: ok ? `已移除 ${req.params.key}` : "未知密钥", status: getConfigStatus(db) });
  });

  app.post("/api/security/alerts", requirePermission("admin:security"), async (req, res) => {
    persist(res, await sendAlert(db, req.body));
  });

  app.post("/api/security/drills/:type", requirePermission("admin:security"), (req, res) => {
    persist(res, runSafetyDrill(db, req.params.type));
  });

  app.get("/api/security/audit-chain", (_req, res) => res.json(verifyAuditChain(db)));
}

function autonomousProductionBlockers(db, options = {}) {
  const blockers = [];
  if (!options.allowModeToEnableSafety && db.system?.professionalRiskMode !== true) blockers.push("专业运行风险闸未开启");
  if (requiresExternalSecurityInfrastructure()) {
    if (!process.env.WORM_AUDIT_ENDPOINT) blockers.push("外部 WORM 审计未配置");
    else if (Date.now() - new Date(db.system?.wormAuditLastSuccessAt || 0).getTime() > 15 * 60_000) blockers.push("外部 WORM 审计未验证或已失联");
  }
  if (requiresExternalSecurityInfrastructure()) {
    if (!externalAlertConfigured()) blockers.push("外部告警未配置");
    else if (!recentExternalAlertSucceeded(db)) blockers.push("外部告警通道未在 24 小时内验证");
  }
  if (!activeMandate(db)) blockers.push("没有当前有效的 OKX Mandate");
  const metadata = (db.apiKeyMetadata || []).find((item) => item.exchange === "OKX");
  if (!metadata?.hasApiKey || !metadata?.hasSecret || metadata.withdrawPermission !== false || !metadata.permissionVerifiedAt) blockers.push("OKX API Key 未完成无提现权限核验");
  const account = (db.exchangeAccounts || []).find((item) => item.exchange === "OKX" && item.readEnabled);
  if (!account) blockers.push("OKX 私有账户未配置");
  const privateWs = (db.realtimeConnections || []).find((item) => item.exchange === "OKX" && item.streamType === "private_user");
  if (account && privateWs?.status !== "connected") blockers.push("OKX 私有 WebSocket 未连接");
  const reconciliation = [...(db.reconciliationReports || [])]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
  if (account && (!reconciliation || reconciliation.status !== "ok")) blockers.push("OKX 账户对账未通过");
  if ((db.executionOrders || []).some((item) => String(item.status).toUpperCase() === "UNKNOWN")) blockers.push("存在 UNKNOWN 订单");
  if (!verifyAuditChain(db).ok) blockers.push("本地审计链校验失败");
  return blockers;
}

// 运行时故障必须 fail-closed 暂停新开仓，但不应让“保存自动交易”失败。只有缺少
// Mandate、API 权限、审计完整性等结构性安全条件才拒绝配置；临时项恢复后自动放行。
export function partitionAutonomousBlockers(blockers = []) {
  const transient = [];
  const hard = [];
  for (const blocker of blockers) {
    if (/WebSocket 未连接|账户对账未通过|WORM 审计未验证或已失联|告警通道未在 24 小时内验证/.test(blocker)) transient.push(blocker);
    else hard.push(blocker);
  }
  return { hard, transient };
}
