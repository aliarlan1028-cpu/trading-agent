import crypto from "node:crypto";
import { activeMandate, verifyAuditChain } from "./store.mjs";
import { requiresExternalSecurityInfrastructure } from "./securityProfile.mjs";
import { externalAlertConfigured, recentExternalAlertSucceeded } from "./alertHealth.mjs";
import { criticModelRoute, normalizeGeminiModel, openRouterProviderPolicy } from "./llmGateway.mjs";
import { okxEnvironmentConfig } from "./okxEnvironment.mjs";

function secretFingerprint(value) {
  return value ? crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16) : null;
}

export function livePolicySnapshot() {
  const critic = criticModelRoute();
  return {
    schemaVersion: 2,
    primaryModel: normalizeGeminiModel(process.env.GEMINI_MODEL),
    classifierModel: normalizeGeminiModel(process.env.GEMINI_CLASSIFIER_MODEL || process.env.GEMINI_MODEL),
    criticModel: critic?.model || String(process.env.DEEPSEEK_MODEL || "deepseek-v4-pro"),
    criticRequiredForLive: true,
    configuredCriticRequired: process.env.LLM_CRITIC_REQUIRED_FOR_LIVE !== "false",
    openRouter: openRouterProviderPolicy(),
    allowedGeminiProviders: String(process.env.OPENROUTER_ALLOWED_GEMINI_PROVIDERS || "google,google ai studio,google vertex,vertex ai")
      .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean).sort(),
    criticMinimumConfidence: Number(process.env.LLM_CRITIC_MIN_CONFIDENCE || 0.75),
    openRouterKeyFingerprint: secretFingerprint(process.env.OPENROUTER_API_KEY),
    deepSeekKeyFingerprint: secretFingerprint(process.env.DEEPSEEK_API_KEY),
    okxKeyFingerprint: secretFingerprint(process.env.OKX_API_KEY),
    okxEnvironment: okxEnvironmentConfig().name,
    promptPolicyVersion: "agent-chat-v2-dual-model",
    toolPolicyVersion: "agent-tools-v2-dual-model"
  };
}

export function livePolicyFingerprint() {
  return crypto.createHash("sha256").update(JSON.stringify(livePolicySnapshot())).digest("hex");
}

export function liveConfirmationStatus(db) {
  const currentFingerprint = livePolicyFingerprint();
  const confirmedFingerprint = db.system?.liveConfirmationPolicyFingerprint || null;
  if (process.env.LLM_CRITIC_REQUIRED_FOR_LIVE === "false") {
    return { ok: false, reason: "live_critic_cannot_be_disabled", currentFingerprint, confirmedFingerprint };
  }
  if (!confirmedFingerprint) return { ok: false, reason: "live_policy_confirmation_missing", currentFingerprint, confirmedFingerprint };
  if (confirmedFingerprint !== currentFingerprint) return { ok: false, reason: "live_policy_changed_since_confirmation", currentFingerprint, confirmedFingerprint };
  return { ok: true, currentFingerprint, confirmedFingerprint };
}

export function autonomousProductionBlockers(db, options = {}) {
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
  if (!process.env.OPENROUTER_API_KEY) blockers.push("Gemini 主模型的 OpenRouter API Key 未配置");
  if (!process.env.DEEPSEEK_API_KEY) blockers.push("DeepSeek 官网独立审查 API Key 未配置");
  if (process.env.LLM_CRITIC_REQUIRED_FOR_LIVE === "false") blockers.push("实盘禁止关闭 DeepSeek 独立审查");
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

export function partitionAutonomousBlockers(blockers = []) {
  const transient = [];
  const hard = [];
  for (const blocker of blockers) {
    if (/WebSocket 未连接|账户对账未通过|WORM 审计未验证或已失联|告警通道未在 24 小时内验证/.test(blocker)) transient.push(blocker);
    else hard.push(blocker);
  }
  return { hard, transient };
}

export function liveConfigurationFingerprint(db) {
  db.grayReleasePolicies ||= [];
  const gray = db.grayReleasePolicies.find((item) => item.id === "gray_live_small_notional") || null;
  const facts = {
    version: Number(db.system?.liveConfigVersion || 0),
    liveTradingEnabled: db.system?.liveTradingEnabled === true,
    realTradingAck: db.system?.realTradingAck === true,
    orderWriteEnabled: db.system?.orderWriteEnabled === true,
    requestedOperatingMode: db.system?.requestedOperatingMode || "observe",
    killSwitch: db.system?.killSwitch === true,
    professionalRiskMode: db.system?.professionalRiskMode === true,
    livePolicyFingerprint: livePolicyFingerprint(),
    gray: gray ? {
      enabled: gray.enabled === true,
      requiresManualApproval: gray.requiresManualApproval !== false,
      maxNotionalUsdt: gray.maxNotionalUsdt,
      allowedSymbols: gray.allowedSymbols || []
    } : null
  };
  return crypto.createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

export function liveGateInput(db, args = {}) {
  const enabled = args.enabled !== false;
  if (args.gate === "live") return { liveTradingEnabled: enabled, acknowledged: enabled };
  if (args.gate === "order_write") return { orderWriteEnabled: enabled };
  if (args.gate === "gray") return { grayEnabled: enabled };
  return null;
}

function serviceError(status, error, extras = {}) {
  return { ok: false, status, error, ...extras };
}

export function applyLiveTradingConfiguration(db, requested = {}, context = {}) {
  const setConfig = context.setConfig;
  if (typeof setConfig !== "function") throw new Error("live_config_runtime_service_unavailable");
  db.system ||= {};
  const actor = context.actor || "Owner";
  const user = context.user || {};
  const expectedFingerprint = context.expectedFingerprint;
  if (expectedFingerprint && expectedFingerprint !== liveConfigurationFingerprint(db)) {
    return serviceError(409, "live_config_changed_since_confirmation_request");
  }

  const input = { ...requested };
  const requestedMode = input.requestedMode === undefined || input.requestedMode === null ? null : String(input.requestedMode);
  if (requestedMode && !["observe", "semi_auto", "full_auto"].includes(requestedMode)) return serviceError(400, "invalid_requested_mode");
  if (requestedMode) {
    input.liveTradingEnabled = requestedMode !== "observe";
    input.orderWriteEnabled = requestedMode !== "observe";
    input.grayEnabled = requestedMode !== "observe";
    input.grayRequiresApproval = requestedMode === "semi_auto";
  }
  if (input.maxNotionalUsdt !== undefined) {
    const value = Number(input.maxNotionalUsdt);
    if (!Number.isFinite(value) || value <= 0) return serviceError(400, "invalid_live_notional_limit");
  }

  db.grayReleasePolicies ||= [];
  let gray = db.grayReleasePolicies.find((item) => item.id === "gray_live_small_notional") || null;
  if (!gray && requestedMode) {
    gray = {
      id: "gray_live_small_notional",
      name: "小额灰度",
      enabled: false,
      requiresManualApproval: true,
      maxNotionalUsdt: Number(process.env.MAX_LIVE_NOTIONAL_USDT || 50),
      allowedSymbols: [],
      createdAt: context.nowIso?.() || new Date().toISOString()
    };
    db.grayReleasePolicies.push(gray);
  }
  const nextLiveRequested = input.liveTradingEnabled === undefined ? db.system.liveTradingEnabled === true : input.liveTradingEnabled === true;
  const nextAck = input.acknowledged === undefined ? db.system.realTradingAck === true : input.acknowledged === true;
  const nextLive = nextLiveRequested && nextAck;
  const nextOrderWrite = input.orderWriteEnabled === undefined ? db.system.orderWriteEnabled === true : input.orderWriteEnabled === true;
  const nextGrayEnabled = input.grayEnabled === undefined ? gray?.enabled === true : input.grayEnabled === true;
  const nextGrayRequiresApproval = input.grayRequiresApproval === undefined ? gray?.requiresManualApproval !== false : input.grayRequiresApproval !== false;
  const enablingWrites = (input.liveTradingEnabled === true || input.orderWriteEnabled === true)
    && (!db.system.liveTradingEnabled || !db.system.orderWriteEnabled);

  if ((nextLive || nextOrderWrite) && db.system.killSwitch === true) return serviceError(409, "kill_switch_enabled");
  if (nextOrderWrite && (!nextLive || !nextAck)) return serviceError(412, "live_ack_and_live_gate_required_before_order_write", { needAck: !nextAck });
  if (enablingWrites && process.env.REQUIRE_MFA_FOR_LIVE === "true" && user.mfaEnabled !== true) {
    return serviceError(412, "mfa_required_for_live_trading", { needMfa: true });
  }
  const resultingAuto = nextGrayEnabled && nextGrayRequiresApproval === false;
  let pendingBlockers = [];
  if (resultingAuto && (nextLive || nextOrderWrite)) {
    const blockers = autonomousProductionBlockers(db, { allowModeToEnableSafety: requestedMode === "full_auto" });
    const { hard, transient } = partitionAutonomousBlockers(blockers);
    if (hard.length) return serviceError(412, "autonomous_production_blocked", { blockers: hard });
    pendingBlockers = transient;
  }

  const entries = {};
  if (input.liveTradingEnabled !== undefined) entries.LIVE_TRADING_ENABLED = input.liveTradingEnabled ? "true" : "false";
  if (input.acknowledged !== undefined) entries.I_UNDERSTAND_REAL_TRADING = input.acknowledged ? "true" : "false";
  if (input.orderWriteEnabled !== undefined) entries.REAL_ORDER_WRITE_ENABLED = input.orderWriteEnabled ? "true" : "false";
  if (input.maxNotionalUsdt !== undefined) entries.MAX_LIVE_NOTIONAL_USDT = String(Number(input.maxNotionalUsdt));
  setConfig(db, entries);

  db.system.realTradingAck = nextAck;
  db.system.liveTradingEnabled = nextLive;
  db.system.orderWriteEnabled = nextOrderWrite;
  if ((nextLive || nextOrderWrite) && nextAck) {
    db.system.liveConfirmationPolicyFingerprint = livePolicyFingerprint();
    db.system.liveConfirmedAt = context.nowIso?.() || new Date().toISOString();
  } else if (!nextAck) {
    delete db.system.liveConfirmationPolicyFingerprint;
    delete db.system.liveConfirmedAt;
  }
  if (requestedMode) {
    db.system.autonomyEnabled = true;
    if (requestedMode === "full_auto") db.system.professionalRiskMode = true;
  }
  if (gray) {
    gray.enabled = nextGrayEnabled;
    gray.requiresManualApproval = nextGrayRequiresApproval;
    if (input.maxNotionalUsdt !== undefined) gray.maxNotionalUsdt = Number(input.maxNotionalUsdt);
    if (input.allowedSymbols !== undefined) {
      const list = Array.isArray(input.allowedSymbols) ? input.allowedSymbols : [];
      gray.allowedSymbols = [...new Set(list.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))];
    }
    gray.updatedAt = context.nowIso?.() || new Date().toISOString();
  }
  if (requestedMode || input.liveTradingEnabled !== undefined || input.grayRequiresApproval !== undefined) {
    db.system.requestedOperatingMode = requestedMode || (db.system.liveTradingEnabled !== true
      ? "observe"
      : gray?.requiresManualApproval === false ? "full_auto" : "semi_auto");
  }
  db.system.liveConfigVersion = Number(db.system.liveConfigVersion || 0) + 1;
  db.system.updatedAt = context.nowIso?.() || new Date().toISOString();
  context.appendAudit?.(db, "更新实盘交易开关与灰度额度", "live_trading_config", actor, "warning");
  return {
    ok: true,
    requestedMode: db.system.requestedOperatingMode,
    pendingBlockers,
    liveTradingEnabled: db.system.liveTradingEnabled,
    orderWriteEnabled: db.system.orderWriteEnabled,
    realTradingAck: db.system.realTradingAck,
    liveConfigVersion: db.system.liveConfigVersion
  };
}
