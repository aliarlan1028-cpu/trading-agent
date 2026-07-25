import fs from "node:fs";
import { keyProviderStatus } from "../server/keyProvider.mjs";
import { loadDb, verifyAuditChain } from "../server/store.mjs";

const db = loadDb();
const failures = [];
const warnings = [];
const requireTrue = (condition, message) => { if (!condition) failures.push(message); };

requireTrue(process.env.AUTH_REQUIRED !== "false", "AUTH_REQUIRED must not be false");
requireTrue(Boolean(process.env.ADMIN_PASSWORD), "ADMIN_PASSWORD is required");
requireTrue(process.env.PUBLIC_REGISTRATION_ENABLED !== "true", "PUBLIC_REGISTRATION_ENABLED must remain false in per-customer deployments");
requireTrue(keyProviderStatus().configured, "A master-key provider is required");
requireTrue(process.env.REQUIRE_EXTERNAL_KEY_PROVIDER === "true", "Production must require an external KMS/Vault key provider");
requireTrue(Boolean(process.env.SECRETS_MASTER_KEY_FILE && fs.existsSync(process.env.SECRETS_MASTER_KEY_FILE)), "SECRETS_MASTER_KEY_FILE must be mounted");
requireTrue(Boolean(process.env.WORM_AUDIT_ENDPOINT), "WORM_AUDIT_ENDPOINT is required");
requireTrue(Boolean(process.env.ALERT_WEBHOOK_URL || process.env.LARK_WEBHOOK_URL || process.env.TELEGRAM_BOT_TOKEN), "At least one external alert channel is required");
requireTrue(process.env.REQUIRE_PAPER_VALIDATION === "true", "REQUIRE_PAPER_VALIDATION must be true");
requireTrue(verifyAuditChain(db).ok, "Local audit chain verification failed");
requireTrue((db.grayReleasePolicies || []).some((item) => item.enabled && item.requiresManualApproval !== false), "An enabled manual-approval gray policy is required");
requireTrue((db.apiKeyMetadata || []).filter((item) => item.hasApiKey || item.hasSecret).every((item) => item.withdrawPermission === false && item.permissionVerifiedAt), "Every configured API key must be verified without withdrawal permission");

if (!(process.env.BINANCE_TESTNET === "true" || process.env.OKX_DEMO_TRADING === "true")) {
  warnings.push("No exchange test environment is enabled; retain live trading switches off until contract checks are recorded.");
}
if (process.env.LIVE_TRADING_ENABLED === "true") {
  requireTrue(process.env.I_UNDERSTAND_REAL_TRADING === "true" && process.env.REAL_ORDER_WRITE_ENABLED === "true", "Live-trading switches are inconsistent");
}

const report = { ok: failures.length === 0, failures, warnings, checkedAt: new Date().toISOString() };
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
