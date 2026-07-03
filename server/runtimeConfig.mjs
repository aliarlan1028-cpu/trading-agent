import crypto from "node:crypto";
import { storeSecret } from "./securityOps.mjs";
import { appendAudit, nowIso } from "./store.mjs";

// 敏感项：加密存入金库，前端只返回是否已配置，绝不回传明文。
export const SECRET_KEYS = new Set([
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "GEMINI_API_KEY",
  "BINANCE_API_KEY", "BINANCE_API_SECRET",
  "OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE",
  "BRAVE_SEARCH_API_KEY", "TAVILY_API_KEY", "SERPAPI_API_KEY",
  "ALERT_WEBHOOK_URL", "ETHERSCAN_API_KEY", "LANGSMITH_API_KEY",
  "LARK_WEBHOOK_URL", "LARK_WEBHOOK_SECRET",
  "ADMIN_PASSWORD", "HTTP_PROXY", "HTTPS_PROXY"
]);

// 非敏感项：明文存 runtimeConfig，可回传前端显示。
export const PLAIN_KEYS = new Set([
  "ANTHROPIC_MODEL", "OPENAI_MODEL", "DEEPSEEK_MODEL", "GEMINI_MODEL",
  "LIVE_TRADING_ENABLED", "I_UNDERSTAND_REAL_TRADING", "REAL_ORDER_WRITE_ENABLED",
  "MAX_LIVE_NOTIONAL_USDT", "OKX_MARGIN_MODE", "OKX_POSITION_MODE",
  "AUTH_REQUIRED", "LANGSMITH_ENDPOINT", "LANGSMITH_PROJECT", "SKILL_SANDBOX_IMAGE",
  "REALTIME_RECONCILER_ENABLED", "BINANCE_MARKET_TYPE", "PORT",
  "EMBEDDING_PROVIDER", "EMBEDDING_MODEL", "REQUIRE_PAPER_VALIDATION"
]);

function masterKey() {
  return crypto.createHash("sha256").update(process.env.SECRETS_MASTER_KEY || "development-only-master-key").digest();
}

function decrypt(enc) {
  const key = masterKey();
  const iv = Buffer.from(enc.iv, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

function scopeFor(key) {
  if (key.startsWith("BINANCE") || key.startsWith("OKX")) return "exchange";
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
  for (const item of db.vaultItems || []) {
    if (item.encrypted && SECRET_KEYS.has(item.name) && !process.env[item.name]) {
      try { process.env[item.name] = decrypt(item.encrypted); } catch { /* 主密钥变更导致解密失败时忽略 */ }
    }
  }
  db.runtimeConfig ||= {};
  for (const [key, value] of Object.entries(db.runtimeConfig)) {
    if (value !== undefined && value !== null && value !== "") process.env[key] = String(value);
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
      process.env[key] = value;
      storeSecret(db, key, value, scopeFor(key));
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
  appendAudit(db, `移除密钥：${key}`, "runtime_config", "ConfigManager", "warning");
  return true;
}

export function activeLlmProvider() {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
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
        deepseek: { hasKey: has("DEEPSEEK_API_KEY"), model: process.env.DEEPSEEK_MODEL || "deepseek-chat" },
        gemini: { hasKey: has("GEMINI_API_KEY"), model: process.env.GEMINI_MODEL || "gemini-2.5-pro" }
      }
    },
    exchange: {
      binance: { hasKey: has("BINANCE_API_KEY"), hasSecret: has("BINANCE_API_SECRET") },
      okx: { hasKey: has("OKX_API_KEY"), hasSecret: has("OKX_API_SECRET"), hasPassphrase: has("OKX_API_PASSPHRASE") }
    },
    liveTrading: {
      liveTradingEnabled: process.env.LIVE_TRADING_ENABLED === "true",
      acknowledged: process.env.I_UNDERSTAND_REAL_TRADING === "true",
      orderWriteEnabled: process.env.REAL_ORDER_WRITE_ENABLED === "true",
      effective: db.system.liveTradingEnabled === true,
      maxNotionalUsdt: Number(process.env.MAX_LIVE_NOTIONAL_USDT || gray.maxNotionalUsdt || 50),
      grayEnabled: Boolean(gray.enabled),
      grayRequiresApproval: gray.requiresManualApproval !== false
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
      lark: { hasWebhook: has("LARK_WEBHOOK_URL"), signed: has("LARK_WEBHOOK_SECRET") }
    },
    runtime: {
      adminPasswordSet: has("ADMIN_PASSWORD"),
      authRequired: process.env.AUTH_REQUIRED !== "false",
      skillSandboxImage: process.env.SKILL_SANDBOX_IMAGE || "node:20-alpine",
      realtimeReconcilerEnabled: process.env.REALTIME_RECONCILER_ENABLED === "true",
      binanceMarketType: process.env.BINANCE_MARKET_TYPE || "spot",
      httpProxySet: has("HTTP_PROXY"),
      httpsProxySet: has("HTTPS_PROXY"),
      port: process.env.PORT || "8787"
    },
    secretsMasterKeySet: Boolean(process.env.SECRETS_MASTER_KEY)
  };
}
