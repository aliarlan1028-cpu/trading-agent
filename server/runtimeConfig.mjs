import { readSecret, storeSecret } from "./securityOps.mjs";
import { appendAudit, nowIso } from "./store.mjs";
import { keyProviderStatus } from "./keyProvider.mjs";
import { SECRET_KEYS } from "./secretRegistry.mjs";
export { SECRET_KEYS } from "./secretRegistry.mjs";

// 敏感项：加密存入金库，前端只返回是否已配置，绝不回传明文。
// 非敏感项：明文存 runtimeConfig，可回传前端显示。
export const PLAIN_KEYS = new Set([
  "DEEPSEEK_MODEL", "GEMINI_MODEL", "GEMINI_CLASSIFIER_MODEL",
  "OPENROUTER_ZDR", "OPENROUTER_DATA_COLLECTION", "OPENROUTER_ALLOW_PROVIDER_FALLBACKS", "LLM_CRITIC_REQUIRED_FOR_LIVE",
  "OPENROUTER_ALLOWED_GEMINI_PROVIDERS", "LLM_CRITIC_MIN_CONFIDENCE",
  "LIVE_TRADING_ENABLED", "I_UNDERSTAND_REAL_TRADING", "REAL_ORDER_WRITE_ENABLED",
  "MAX_LIVE_NOTIONAL_USDT", "OKX_MARGIN_MODE", "OKX_POSITION_MODE",
  "AUTH_REQUIRED", "PUBLIC_REGISTRATION_ENABLED", "PUBLIC_REGISTRATION_MODE", "PUBLIC_MAX_TENANTS", "PUBLIC_BASE_URL",
  "TURNSTILE_SITE_KEY", "REGISTRATION_TERMS_VERSION", "REGISTRATION_PRIVACY_VERSION", "PROVISIONING_BROKER_ENABLED",
  "REGISTRATION_TERMS_URL", "REGISTRATION_PRIVACY_URL",
  "REQUIRE_MFA_FOR_LIVE",
  "LANGSMITH_ENDPOINT", "LANGSMITH_PROJECT", "SKILL_SANDBOX_IMAGE",
  "PRODUCTION_SECURITY_PROFILE", "MANDATE_POLICY_MAX_SINGLE_RISK_PCT", "MANDATE_POLICY_MAX_DAILY_LOSS_PCT", "MANDATE_POLICY_MAX_WEEKLY_LOSS_PCT",
  "OKX_MARKET_TYPE", "OKX_DEMO_TRADING", "OKX_BASE_URL", "PORT", "HOST",
  "EMBEDDING_PROVIDER", "EMBEDDING_MODEL",
  "TELEGRAM_CHAT_ID", "TELEGRAM_PROFIT_POSTER_ENABLED",
  "TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT", "TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT",
  "TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES",
  "TELEGRAM_WATCH_CHAT_ID", "TELEGRAM_WATCH_NOTIFIER_ENABLED", "TELEGRAM_WATCH_LANGUAGE",
  "WORM_AUDIT_ENDPOINT", "WORM_AUDIT_SINK_ID",
  // 风控阈值(前端「风控设置 · 风控阈值」运行时可调,改完即生效不重部署)
  "MIN_REWARD_RISK", "PROTECT_MAX_CONSEC_LOSSES", "PROTECT_COOLDOWN_HOURS",
  "PROTECT_MAX_DRAWDOWN_PCT", "PROTECT_DRAWDOWN_LOCK_HOURS", "PROTECT_DRAWDOWN_LOOKBACK",
  "TRAIL_ACTIVATE_PCT", "TRAIL_PCT", "EVENT_BLACKOUT_MINUTES", "ENTRY_ORDER_TTL_MINUTES", "ENTRY_STALE_DEVIATION_PCT"
]);

function scopeFor(key) {
  if (key.startsWith("OKX")) return "exchange";
  if (key.endsWith("_API_KEY") || key.endsWith("_KEY")) return "llm";
  if (key === "ADMIN_PASSWORD") return "auth";
  if (key.includes("PROXY")) return "network";
  return "system";
}

function recomputeLive(db) {
  const okxVaultFailure = (db.system?.secretDecryptionFailures || []).some((failure) => failure.name.startsWith("OKX_"));
  db.system.liveTradingEnabled = !okxVaultFailure
    && process.env.LIVE_TRADING_ENABLED === "true" && process.env.I_UNDERSTAND_REAL_TRADING === "true";
  if (okxVaultFailure) db.system.orderWriteEnabled = false;
}

// 启动时把已持久化的配置回填到 process.env，实现跨重启生效。
export function applyStoredConfigToEnv(db) {
  for (const key of db.clearedRuntimeSecrets || []) delete process.env[key];
  for (const item of db.vaultItems || []) {
    if (item.encrypted && SECRET_KEYS.has(item.name)) {
      // 只要金库声明拥有这个 secret，部署环境中的同名值就不再是合法 fallback。
      // 解密失败必须锁住该能力，不能把旧 .env bootstrap 凭证静默复活。
      delete process.env[item.name];
      try {
        process.env[item.name] = readSecret(db, item.name);
        clearVaultFailure(db, item.name);
      } catch (error) {
        recordVaultFailure(db, item, error);
      }
    }
  }
  db.runtimeConfig ||= {};
  for (const [key, value] of Object.entries(db.runtimeConfig)) {
    // 空字符串也是用户明确保存的“清空”，必须覆盖 .env 的 bootstrap 值，避免重启复活。
    if (value !== undefined && value !== null) process.env[key] = String(value);
  }
  recomputeLive(db);
}

function clearVaultFailure(db, name) {
  db.system ||= {};
  db.system.secretDecryptionFailures = (db.system.secretDecryptionFailures || []).filter((failure) => failure.name !== name);
  const incident = (db.riskIncidents || []).find((row) => row.source === `vault:${name}` && row.status === "open");
  if (incident) {
    incident.status = "resolved";
    incident.resolvedAt = nowIso();
    incident.resolution = "vault_secret_decryption_restored";
  }
  if (!(db.system.secretDecryptionFailures || []).length) db.system.vaultStatus = "healthy";
  if (name === "ADMIN_PASSWORD") db.system.authLockedByVaultFailure = false;
}

function recordVaultFailure(db, item, error) {
  db.system ||= {};
  db.riskIncidents ||= [];
  const failure = {
    name: item.name,
    scope: item.scope || "system",
    keyId: item.encrypted?.keyId || "legacy_unversioned",
    code: "vault_decryption_failed",
    observedAt: nowIso()
  };
  db.system.secretDecryptionFailures ||= [];
  const existing = db.system.secretDecryptionFailures.find((row) => row.name === item.name);
  if (existing) Object.assign(existing, failure);
  else db.system.secretDecryptionFailures.push(failure);
  db.system.vaultStatus = "critical_decryption_failure";
  if (item.name.startsWith("OKX_")) {
    for (const account of db.exchangeAccounts || []) if (account.exchange === "OKX") {
      account.readEnabled = false;
      account.tradeEnabled = false;
      account.status = "credential_decryption_failed";
    }
    db.system.liveTradingEnabled = false;
    db.system.orderWriteEnabled = false;
    db.system.reduceOnlyMode = true;
    db.system.reduceOnlyBy ||= "credential_decryption_failed";
  }
  if (item.name === "ADMIN_PASSWORD") db.system.authLockedByVaultFailure = true;
  if (!db.riskIncidents.some((row) => row.source === `vault:${item.name}` && row.status === "open")) {
    db.riskIncidents.unshift({
      id: `incident_vault_${String(item.name).toLowerCase()}`,
      severity: "critical",
      status: "open",
      title: `加密金库项目无法解密：${item.name}`,
      source: `vault:${item.name}`,
      createdAt: nowIso()
    });
    appendAudit(db, `加密金库解密失败，已禁用相关能力：${item.name}`, item.id || item.name, "ConfigManager", "critical");
  }
  // 仅保留非敏感错误类型，绝不把密文/主密钥材料写入状态。
  failure.errorType = error?.name || "Error";
}

// 通用配置写入：敏感项加密入库，非敏感项存 runtimeConfig，均即时写入 process.env（无需重启）。
export function setConfig(db, entries = {}) {
  db.runtimeConfig ||= {};
  const applied = [];
  const risky = [];
  const livePolicySensitive = new Set([
    "GEMINI_MODEL", "GEMINI_CLASSIFIER_MODEL", "DEEPSEEK_MODEL", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY",
    "OPENROUTER_ZDR", "OPENROUTER_DATA_COLLECTION", "OPENROUTER_ALLOW_PROVIDER_FALLBACKS",
    "OPENROUTER_ALLOWED_GEMINI_PROVIDERS", "LLM_CRITIC_REQUIRED_FOR_LIVE", "LLM_CRITIC_MIN_CONFIDENCE",
    "OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE", "OKX_DEMO_TRADING", "OKX_BASE_URL"
  ]);
  let livePolicyChanged = false;
  for (const [key, rawValue] of Object.entries(entries)) {
    const value = rawValue === undefined || rawValue === null ? "" : String(rawValue);
    const previousValue = process.env[key] ?? "";
    if (SECRET_KEYS.has(key)) {
      if (value === "") continue; // 空值不覆盖已有密钥
      storeSecret(db, key, value, scopeFor(key));
      db.clearedRuntimeSecrets = (db.clearedRuntimeSecrets || []).filter((item) => item !== key);
      process.env[key] = value;
      applied.push(key);
      if (livePolicySensitive.has(key) && previousValue !== value) livePolicyChanged = true;
    } else if (PLAIN_KEYS.has(key)) {
      process.env[key] = value;
      db.runtimeConfig[key] = value;
      applied.push(key);
      if (livePolicySensitive.has(key) && previousValue !== value) livePolicyChanged = true;
      if (/LIVE_TRADING|REAL_ORDER|UNDERSTAND/.test(key)) risky.push(key);
    }
  }
  recomputeLive(db);
  if (livePolicyChanged) {
    db.system ||= {};
    db.system.realTradingAck = false;
    db.system.liveTradingEnabled = false;
    db.system.orderWriteEnabled = false;
    db.system.liveConfigVersion = Number(db.system.liveConfigVersion || 0) + 1;
    db.system.liveConfirmationInvalidatedAt = nowIso();
    db.system.liveConfirmationInvalidationReason = "live_policy_changed";
    delete db.system.liveConfirmationPolicyFingerprint;
    delete db.system.liveConfirmedAt;
    process.env.I_UNDERSTAND_REAL_TRADING = "false";
    process.env.LIVE_TRADING_ENABLED = "false";
    process.env.REAL_ORDER_WRITE_ENABLED = "false";
    db.runtimeConfig.I_UNDERSTAND_REAL_TRADING = "false";
    db.runtimeConfig.LIVE_TRADING_ENABLED = "false";
    db.runtimeConfig.REAL_ORDER_WRITE_ENABLED = "false";
    appendAudit(db, "实盘模型/Provider/凭证策略发生变化，旧实盘确认已失效", "live_policy", "ConfigManager", "critical");
  }
  if (applied.length) {
    appendAudit(db, `更新运行配置：${applied.join("、")}`, "runtime_config", "ConfigManager", risky.length ? "warning" : "info");
  }
  return applied;
}

// 清除某个密钥（前端"移除"按钮）。
export function clearSecret(db, key) {
  if (!SECRET_KEYS.has(key)) return false;
  delete process.env[key];
  db.vaultItems = (db.vaultItems || []).filter((item) => item.name !== key);
  db.clearedRuntimeSecrets ||= [];
  if (!db.clearedRuntimeSecrets.includes(key)) db.clearedRuntimeSecrets.push(key);
  if (["OPENROUTER_API_KEY", "DEEPSEEK_API_KEY", "OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE"].includes(key)) {
    db.system ||= {};
    db.system.realTradingAck = false;
    db.system.liveTradingEnabled = false;
    db.system.orderWriteEnabled = false;
    db.system.liveConfigVersion = Number(db.system.liveConfigVersion || 0) + 1;
    db.system.liveConfirmationInvalidatedAt = nowIso();
    db.system.liveConfirmationInvalidationReason = "live_policy_secret_removed";
    delete db.system.liveConfirmationPolicyFingerprint;
    delete db.system.liveConfirmedAt;
    process.env.I_UNDERSTAND_REAL_TRADING = "false";
    process.env.LIVE_TRADING_ENABLED = "false";
    process.env.REAL_ORDER_WRITE_ENABLED = "false";
  }
  appendAudit(db, `移除密钥：${key}`, "runtime_config", "ConfigManager", "warning");
  return true;
}

function activeLlmProvider() {
  if (process.env.OPENROUTER_API_KEY) return "gemini";
  return null;
}

// 前端配置面板的状态：只暴露"是否已配置"与非敏感值。
export function getConfigStatus(db) {
  const has = (key) => Boolean(process.env[key]);
  const gray = (db.grayReleasePolicies || []).find((item) => item.id === "gray_live_small_notional") || db.grayReleasePolicies?.[0] || {};
  return {
    llm: {
      activeProvider: activeLlmProvider(),
      architecture: "gemini_primary_deepseek_critic",
      liveReady: has("OPENROUTER_API_KEY") && has("DEEPSEEK_API_KEY"),
      providers: {
        gemini: { hasKey: has("OPENROUTER_API_KEY"), gateway: "OpenRouter", role: "primary", model: process.env.GEMINI_MODEL?.startsWith("google/") ? process.env.GEMINI_MODEL : `google/${process.env.GEMINI_MODEL || "gemini-3.1-pro-preview"}` },
        classifier: { hasKey: has("OPENROUTER_API_KEY"), gateway: "OpenRouter", role: "classifier", model: process.env.GEMINI_CLASSIFIER_MODEL || process.env.GEMINI_MODEL || "google/gemini-3.1-pro-preview", reasoningEffort: "low" },
        deepseek: { hasKey: has("DEEPSEEK_API_KEY"), gateway: "DeepSeek Direct", role: "critic", model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro" }
      },
      policy: {
        criticRequiredForLive: true,
        criticRequirementConfiguredSafely: process.env.LLM_CRITIC_REQUIRED_FOR_LIVE !== "false",
        openRouterZdr: process.env.OPENROUTER_ZDR !== "false",
        dataCollection: process.env.OPENROUTER_DATA_COLLECTION === "allow" ? "allow" : "deny",
        sameModelProviderFallbacks: process.env.OPENROUTER_ALLOW_PROVIDER_FALLBACKS !== "false",
        crossModelFallback: false
      }
    },
    exchange: {
      okx: { hasKey: has("OKX_API_KEY"), hasSecret: has("OKX_API_SECRET"), hasPassphrase: has("OKX_API_PASSPHRASE") }
    },
    liveTrading: {
      liveTradingEnabled: db.system.liveTradingEnabled === true || process.env.LIVE_TRADING_ENABLED === "true",
      acknowledged: db.system.realTradingAck === true || process.env.I_UNDERSTAND_REAL_TRADING === "true",
      orderWriteEnabled: db.system.orderWriteEnabled === true || process.env.REAL_ORDER_WRITE_ENABLED === "true",
      effective: db.system.liveTradingEnabled === true,
      maxNotionalUsdt: Number(process.env.MAX_LIVE_NOTIONAL_USDT || gray.maxNotionalUsdt || 50),
      grayEnabled: Boolean(gray.enabled),
      grayRequiresApproval: gray.requiresManualApproval !== false,
      grayAllowedSymbols: Array.isArray(gray.allowedSymbols) ? gray.allowedSymbols : []
    },
    integrations: {
      langsmith: {
        hasKey: has("LANGSMITH_API_KEY"),
        endpoint: process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com",
        project: process.env.LANGSMITH_PROJECT || "trading-agent"
      },
      etherscan: { hasKey: has("ETHERSCAN_API_KEY") },
      search: {
        brave: { hasKey: has("BRAVE_SEARCH_API_KEY") },
        tavily: { hasKey: has("TAVILY_API_KEY") },
        serpapi: { hasKey: has("SERPAPI_API_KEY") }
      },
      alerts: { hasWebhook: has("ALERT_WEBHOOK_URL") },
      lark: { hasWebhook: has("LARK_WEBHOOK_URL"), signed: has("LARK_WEBHOOK_SECRET") },
      telegram: {
        hasBotToken: has("TELEGRAM_BOT_TOKEN"),
        chatId: process.env.TELEGRAM_CHAT_ID || "",
        configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        profitPosterEnabled: process.env.TELEGRAM_PROFIT_POSTER_ENABLED === "true",
        watchChatId: process.env.TELEGRAM_WATCH_CHAT_ID || "",
        watchUsesPrimaryChat: !process.env.TELEGRAM_WATCH_CHAT_ID,
        watchConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_WATCH_CHAT_ID || process.env.TELEGRAM_CHAT_ID)),
        watchNotifierEnabled: process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED === "true",
        watchLanguage: process.env.TELEGRAM_WATCH_LANGUAGE === "zh" ? "zh" : "en",
        minPnlUsdt: Number(process.env.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT || 0),
        minRoiPct: Number(process.env.TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT || 0),
        cooldownMinutes: Number(process.env.TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES || 240)
      }
    },
    runtime: {
      adminPasswordSet: has("ADMIN_PASSWORD"),
      authRequired: process.env.AUTH_REQUIRED !== "false",
      skillSandboxImage: process.env.SKILL_SANDBOX_IMAGE || "node:20-alpine",
      okxMarketType: process.env.OKX_MARKET_TYPE || "perpetual_swap",
      httpProxySet: has("HTTP_PROXY"),
      httpsProxySet: has("HTTPS_PROXY"),
      host: process.env.HOST || "127.0.0.1",
      port: process.env.PORT || "8787"
    },
    secretsMasterKeySet: keyProviderStatus().configured,
    keyProvider: keyProviderStatus()
  };
}
