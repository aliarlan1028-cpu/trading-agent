// 单一权威敏感配置注册表。运行时配置、外部模型 DLP、日志/审计脱敏都必须消费
// 这一份清单，避免某个新凭证只在一条链路被当作秘密。
export const SECRET_KEYS = new Set([
  "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "GEMINI_API_KEY",
  "OKX_API_KEY", "OKX_API_SECRET", "OKX_API_PASSPHRASE",
  "BINANCE_API_KEY", "BINANCE_API_SECRET", "BRAVE_SEARCH_API_KEY", "TAVILY_API_KEY",
  "SERPAPI_API_KEY", "ETHERSCAN_API_KEY", "GLASSNODE_API_KEY", "NANSEN_API_KEY",
  "TRONGRID_API_KEY", "LANGSMITH_API_KEY", "PAYMENT_WEBHOOK_SECRET",
  "ALERT_WEBHOOK_URL", "LARK_WEBHOOK_URL", "LARK_WEBHOOK_SECRET",
  "TELEGRAM_BOT_TOKEN", "WORM_AUDIT_TOKEN", "TURNSTILE_SECRET_KEY",
  "REGISTRATION_EMAIL_WEBHOOK_URL", "REGISTRATION_EMAIL_WEBHOOK_TOKEN", "REGISTRATION_RATE_LIMIT_SALT",
  "ADMIN_PASSWORD", "HTTP_PROXY", "HTTPS_PROXY", "SECRETS_MASTER_KEY", "SECRETS_MASTER_KEY_FILE",
  "BACKUP_ENCRYPTION_KEY_FILE", "BACKUP_OFFSITE_DIR"
]);

const NORMALIZED_SECRET_KEYS = new Set([...SECRET_KEYS].map((key) => key.toLowerCase().replace(/[-\s]+/g, "_")));

export function isRegisteredSecretKey(key) {
  return NORMALIZED_SECRET_KEYS.has(String(key || "").toLowerCase().replace(/[-\s]+/g, "_"));
}

export function configuredSecretValues(env = process.env) {
  return [...SECRET_KEYS]
    .map((key) => env[key])
    .filter((value) => typeof value === "string" && value.length >= 6);
}
