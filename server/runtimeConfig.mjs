import crypto from "node:crypto";
import { storeSecret } from "./securityOps.mjs";
import { appendAudit, nowIso } from "./store.mjs";
import { getMasterKeyMaterial, keyProviderStatus } from "./keyProvider.mjs";

// 敏感项：加密存入金库，前端只返回是否已配置，绝不回传明文。
export const SECRET_KEYS = new Set([
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "GEMINI_API_KEY",
  "OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE",
  "BRAVE_SEARCH_API_KEY", "TAVILY_API_KEY", "SERPAPI_API_KEY",
  "ALERT_WEBHOOK_URL", "ETHERSCAN_API_KEY", "LANGSMITH_API_KEY",
  "LARK_WEBHOOK_URL", "LARK_WEBHOOK_SECRET",
  "TELEGRAM_BOT_TOKEN",
  "WORM_AUDIT_TOKEN",
  "TURNSTILE_SECRET_KEY", "REGISTRATION_EMAIL_WEBHOOK_URL", "REGISTRATION_EMAIL_WEBHOOK_TOKEN", "REGISTRATION_RATE_LIMIT_SALT",
  "ADMIN_PASSWORD", "HTTP_PROXY", "HTTPS_PROXY"
]);

// 非敏感项：明文存 runtimeConfig，可回传前端显示。
export const PLAIN_KEYS = new Set([
  "ANTHROPIC_MODEL", "OPENAI_MODEL", "DEEPSEEK_MODEL", "GEMINI_MODEL",
  "LIVE_TRADING_ENABLED", "I_UNDERSTAND_REAL_TRADING", "REAL_ORDER_WRITE_ENABLED",
  "MAX_LIVE_NOTIONAL_USDT", "OKX_MARGIN_MODE", "OKX_POSITION_MODE",
  "AUTH_REQUIRED", "PUBLIC_REGISTRATION_ENABLED", "PUBLIC_REGISTRATION_MODE", "PUBLIC_MAX_TENANTS", "PUBLIC_BASE_URL",
  "TURNSTILE_SITE_KEY", "REGISTRATION_TERMS_VERSION", "REGISTRATION_PRIVACY_VERSION", "PROVISIONING_BROKER_ENABLED",
  "REGISTRATION_TERMS_URL", "REGISTRATION_PRIVACY_URL",
  "REQUIRE_MFA_FOR_LIVE",
  "LANGSMITH_ENDPOINT", "LANGSMITH_PROJECT", "SKILL_SANDBOX_IMAGE",
  "PRODUCTION_SECURITY_PROFILE", "MANDATE_POLICY_MAX_SINGLE_RISK_PCT", "MANDATE_POLICY_MAX_DAILY_LOSS_PCT", "MANDATE_POLICY_MAX_WEEKLY_LOSS_PCT",
  "OKX_MARKET_TYPE", "PORT", "HOST",
  "EMBEDDING_PROVIDER", "EMBEDDING_MODEL",
  "TELEGRAM_CHAT_ID", "TELEGRAM_PROFIT_POSTER_ENABLED",
  "TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT", "TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT",
  "TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES",
  "TELEGRAM_WATCH_CHAT_ID", "TELEGRAM_WATCH_NOTIFIER_ENABLED", "TELEGRAM_WATCH_DAILY_DIGEST_ENABLED", "TELEGRAM_WATCH_LANGUAGE",
  "WORM_AUDIT_ENDPOINT", "WORM_AUDIT_SINK_ID",
  // 风控阈值(前端「风控设置 · 风控阈值」运行时可调,改完即生效不重部署)
  "MIN_REWARD_RISK", "PROTECT_MAX_CONSEC_LOSSES", "PROTECT_COOLDOWN_HOURS",
  "PROTECT_MAX_DRAWDOWN_PCT", "PROTECT_DRAWDOWN_LOCK_HOURS", "PROTECT_DRAWDOWN_LOOKBACK",
  "TRAIL_ACTIVATE_PCT", "TRAIL_PCT", "EVENT_BLACKOUT_MINUTES", "ENTRY_ORDER_TTL_MINUTES", "ENTRY_STALE_DEVIATION_PCT"
]);

function masterKey() {
  return crypto.createHash("sha256").update(getMasterKeyMaterial()).digest();
}

function decrypt(enc) {
  const key = masterKey();
  const iv = Buffer.from(enc.iv, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function scopeFor(key) {
  if (key.startsWith("OKX")) return "exchange";
  if (key.endsWith("_API_KEY") || key.endsWith("_KEY")) return "llm";
  if (key === "ADMIN_PASSWORD") return "auth";
  if (key.includes("PROXY")) return "network";
  return "system";
}

function recomputeLive(db) {
  db.system.liveTradingEnabled =
    process.env.LIVE_TRADING_ENABLED === "true" && process.env.I_UNDERSTAND_REAL_TRADING === "true";
}

// 启动时把已持久化的配置回填到 process.env，实现跨重启生效。
export function applyStoredConfigToEnv(db) {
  for (const key of db.clearedRuntimeSecrets || []) delete process.env[key];
  for (const item of db.vaultItems || []) {
    if (item.encrypted && SECRET_KEYS.has(item.name)) {
      try {
        // 金库是通过前端保存后的持久化运行配置，环境变量只是首次部署/灾难恢复的
        // bootstrap 值。此前仅在 env 为空时回填，导致前端改过的 ADMIN_PASSWORD/API
        // 密钥在每次重启后又被旧 .env 覆盖，看似“保存成功但没改”。解密成功时应以
        // 金库为准；解密失败则保留部署环境变量，避免主密钥异常把服务直接锁死。
        process.env[item.name] = decrypt(item.encrypted);
      } catch { /* 主密钥变更导致解密失败时保留部署环境变量 */ }
    }
  }
  db.runtimeConfig ||= {};
  for (const [key, value] of Object.entries(db.runtimeConfig)) {
    // 空字符串也是用户明确保存的“清空”，必须覆盖 .env 的 bootstrap 值，避免重启复活。
    if (value !== undefined && value !== null) process.env[key] = String(value);
  }
  recomputeLive(db);
}

// 通用配置写入：敏感项加密入库，非敏感项存 runtimeConfig，均即时写入 process.env（无需重启）。
export function setConfig(db, entries = {}) {
  db.runtimeConfig ||= {};
  const applied = [];
  const risky = [];
  for (const [key, rawValue] of Object.entries(entries)) {
    const value = rawValue === undefined || rawValue === null ? "" : String(rawValue);
    if (SECRET_KEYS.has(key)) {
      if (value === "") continue; // 空值不覆盖已有密钥
      storeSecret(db, key, value, scopeFor(key));
      db.clearedRuntimeSecrets = (db.clearedRuntimeSecrets || []).filter((item) => item !== key);
      process.env[key] = value;
      applied.push(key);
    } else if (PLAIN_KEYS.has(key)) {
      process.env[key] = value;
      db.runtimeConfig[key] = value;
      applied.push(key);
      if (/LIVE_TRADING|REAL_ORDER|UNDERSTAND/.test(key)) risky.push(key);
    }
  }
  recomputeLive(db);
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
  appendAudit(db, `移除密钥：${key}`, "runtime_config", "ConfigManager", "warning");
  return true;
}

function activeLlmProvider() {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

// 前端配置面板的状态：只暴露"是否已配置"与非敏感值。
export function getConfigStatus(db) {
  const has = (key) => Boolean(process.env[key]);
  const gray = (db.grayReleasePolicies || []).find((item) => item.id === "gray_live_small_notional") || db.grayReleasePolicies?.[0] || {};
  return {
    llm: {
      activeProvider: activeLlmProvider(),
      providers: {
        anthropic: { hasKey: has("ANTHROPIC_API_KEY"), model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5" },
        openai: { hasKey: has("OPENAI_API_KEY"), model: process.env.OPENAI_MODEL || "gpt-5.2" },
        deepseek: { hasKey: has("DEEPSEEK_API_KEY"), model: process.env.DEEPSEEK_MODEL || "deepseek-v4-pro" },
        gemini: { hasKey: has("GEMINI_API_KEY"), model: process.env.GEMINI_MODEL || "gemini-2.5-flash" }
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
        watchDailyDigestEnabled: process.env.TELEGRAM_WATCH_DAILY_DIGEST_ENABLED === "true",
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
