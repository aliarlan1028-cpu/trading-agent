import fs from "node:fs";
import { getMasterKeyMaterial, keyProviderStatus } from "../server/keyProvider.mjs";
import { normalizeAndValidateMandate } from "../server/mandatePolicy.mjs";
import { applyStoredConfigToEnv } from "../server/runtimeConfig.mjs";
import { productionSecurityProfile, requiresExternalSecurityInfrastructure } from "../server/securityProfile.mjs";
import { externalAlertConfigured } from "../server/alertHealth.mjs";
import { loadDbReadOnlySnapshot, verifyAuditChainReadOnly } from "../server/store.mjs";
import { currentRegistrationMode } from "../server/publicRegistration.mjs";
import { evaluateAutonomousProfilePreflight } from "../server/productionPreflightPolicy.mjs";

const db = loadDbReadOnlySnapshot();
// Match the real server startup path: UI-managed runtime settings and encrypted
// vault secrets are persisted in SQLite, then restored into process.env before
// any production gates are evaluated. Checking the raw container environment
// alone produces false missing-config failures during an image upgrade.
applyStoredConfigToEnv(db);
const failures = [];
const warnings = [];
const requireTrue = (condition, message) => { if (!condition) failures.push(message); };

requireTrue(process.env.AUTH_REQUIRED !== "false", "AUTH_REQUIRED must not be false");
requireTrue(Boolean(process.env.ADMIN_PASSWORD), "ADMIN_PASSWORD is required");
const registrationMode = currentRegistrationMode(db);
requireTrue(process.env.TENANT_ISOLATION_V2 !== "true", "TENANT_ISOLATION_V2 must remain false; customer trading workspaces use isolated instances");
requireTrue((registrationMode === "closed") === (process.env.PUBLIC_REGISTRATION_ENABLED !== "true"), "PUBLIC_REGISTRATION_ENABLED must match PUBLIC_REGISTRATION_MODE");
if (["waitlist", "auto"].includes(registrationMode)) {
  requireTrue(Boolean(process.env.TURNSTILE_SECRET_KEY && process.env.TURNSTILE_SITE_KEY), "Public applications require Cloudflare Turnstile");
  requireTrue(Boolean(process.env.REGISTRATION_EMAIL_WEBHOOK_URL), "Public applications require a verification-email webhook");
  requireTrue(Boolean(process.env.REGISTRATION_RATE_LIMIT_SALT), "Public applications require a dedicated registration rate-limit salt");
  requireTrue(/^https:\/\//.test(String(process.env.PUBLIC_BASE_URL || "")), "Public applications require an HTTPS PUBLIC_BASE_URL");
}
if (registrationMode !== "closed") {
  requireTrue(/^https:\/\//.test(String(process.env.REGISTRATION_TERMS_URL || "")), "Public applications require a published HTTPS terms URL");
  requireTrue(/^https:\/\//.test(String(process.env.REGISTRATION_PRIVACY_URL || "")), "Public applications require a published HTTPS privacy URL");
}
if (registrationMode === "auto") requireTrue(process.env.PROVISIONING_BROKER_ENABLED === "true", "Automatic provisioning mode requires the constrained host broker");
if (registrationMode !== "closed" && Number(process.env.PUBLIC_MAX_TENANTS || 0) <= 0) warnings.push("Public applications are open but capacity is zero; verified applicants will remain waitlisted");
if (!(db.users || []).some((user) => user.isOwner && user.mfaEnabled === true)) warnings.push("Owner TOTP MFA is not enabled; enable it from account settings after deployment");
requireTrue(keyProviderStatus().configured, "A master-key provider is required");
const externalInfrastructure = requiresExternalSecurityInfrastructure();
const backupEncryptionKeyFile = String(process.env.BACKUP_ENCRYPTION_KEY_FILE || "").trim();
const backupOffsiteDir = String(process.env.BACKUP_OFFSITE_DIR || "").trim();
if (externalInfrastructure) {
  requireTrue(process.env.REQUIRE_EXTERNAL_KEY_PROVIDER === "true", "Production must require an external KMS/Vault key provider");
  requireTrue(Boolean(process.env.SECRETS_MASTER_KEY_FILE && fs.existsSync(process.env.SECRETS_MASTER_KEY_FILE)), "SECRETS_MASTER_KEY_FILE must be mounted");
} else {
  warnings.push("BitLaunch single-server profile: master key is host-managed, not backed by an external KMS/Vault");
}
if (externalInfrastructure && process.env.SECRETS_MASTER_KEY_FILE) {
  try {
    requireTrue(getMasterKeyMaterial().length >= 32, "Mounted KMS/Vault key must contain at least 32 characters");
  } catch (error) {
    failures.push(`Mounted KMS/Vault key is unreadable: ${error.message}`);
  }
}
if (externalInfrastructure) requireTrue(Boolean(process.env.WORM_AUDIT_ENDPOINT), "WORM_AUDIT_ENDPOINT is required");
else if (!process.env.WORM_AUDIT_ENDPOINT) warnings.push("BitLaunch single-server profile: external WORM is not configured; local hash-chain audit remains enforced");
if (externalInfrastructure) requireTrue(externalAlertConfigured(), "At least one external alert channel is required");
else if (!externalAlertConfigured()) warnings.push("BitLaunch single-server profile: Lark/external alerts are not configured; in-app notifications and audit remain active");
if (backupOffsiteDir) {
  requireTrue(Boolean(backupEncryptionKeyFile), "BACKUP_OFFSITE_DIR requires BACKUP_ENCRYPTION_KEY_FILE");
  requireTrue(Boolean(backupEncryptionKeyFile && fs.existsSync(backupEncryptionKeyFile)), "BACKUP_ENCRYPTION_KEY_FILE must exist when offsite backup is enabled");
} else if (externalInfrastructure) {
  failures.push("BACKUP_OFFSITE_DIR is required for the external hardened profile");
} else {
  warnings.push("BitLaunch single-server profile: encrypted offsite backup is not configured; local verified backups remain available");
}
if (!process.env.APP_RELEASE || process.env.APP_RELEASE === "dev") warnings.push("APP_RELEASE is not immutable; release/rollback audit will be less precise");
requireTrue(verifyAuditChainReadOnly().ok, "Local audit chain verification failed");
const enabledGray = (db.grayReleasePolicies || []).find((item) => item.enabled);
requireTrue(Boolean(enabledGray), "An enabled bounded-notional policy is required");
requireTrue(Number.isFinite(Number(enabledGray?.maxNotionalUsdt)) && Number(enabledGray?.maxNotionalUsdt) > 0, "Enabled live policy must have a finite positive notional cap");
const autonomousProfile = enabledGray?.requiresManualApproval === false;
const autonomousProfilePreflight = evaluateAutonomousProfilePreflight({
  autonomousProfile,
  professionalRiskMode: db.system?.professionalRiskMode,
  autonomyEnabled: db.system?.autonomyEnabled,
});
failures.push(...autonomousProfilePreflight.failures);
warnings.push(...autonomousProfilePreflight.warnings);
const okxMetadata = (db.apiKeyMetadata || []).find((item) => item.exchange === "OKX");
requireTrue(Boolean(okxMetadata?.hasApiKey && okxMetadata?.hasSecret && okxMetadata?.withdrawPermission === false && okxMetadata?.permissionVerifiedAt), "OKX API key must be verified without withdrawal permission");
const activeMandates = (db.mandates || []).filter((item) => ["active", "running"].includes(item.status));
requireTrue(activeMandates.length === 1, "Exactly one active OKX mandate is required");
requireTrue(!activeMandates.some((item) => (item.exchanges || item.exchange_scope || []).some((exchange) => exchange !== "OKX")), "Every active mandate must be OKX-only");
for (const mandate of activeMandates) {
  const checked = normalizeAndValidateMandate(mandate);
  requireTrue(checked.valid, `Active mandate ${mandate.id} is invalid: ${checked.errors.join("; ")}`);
}

// Live mode is persisted in the database by the control plane. Checking only
// the process environment can therefore miss an already-enabled production
// workspace during an image upgrade.
const liveTradingRequested = process.env.LIVE_TRADING_ENABLED === "true" || db.system?.liveTradingEnabled === true;
if (liveTradingRequested) {
  requireTrue(process.env.I_UNDERSTAND_REAL_TRADING === "true" && process.env.REAL_ORDER_WRITE_ENABLED === "true", "Live-trading switches are inconsistent");
}

const report = { ok: failures.length === 0, securityProfile: productionSecurityProfile(), failures, warnings, checkedAt: new Date().toISOString() };
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
