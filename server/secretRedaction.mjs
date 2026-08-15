import crypto from "node:crypto";
import { configuredSecretValues, isRegisteredSecretKey } from "./secretRegistry.mjs";

const SENSITIVE_KEY = /(?:api[_-]?key|api[_-]?secret|secret|pass[_-]?phrase|password|passwd|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|(?:bot|audit|webhook|email|payment|registration)[_-]?token|private[_-]?key|cookie|webhook[_-]?url|https?[_-]?proxy)$/i;
const LABELED_SECRET = /\b(?:[A-Z0-9]+[_-])*(?:API[_-]?KEY|API[_-]?SECRET|SECRET|PASSPHRASE|PASSWORD|BOT[_-]?TOKEN|WEBHOOK[_-]?TOKEN|AUDIT[_-]?TOKEN|WEBHOOK[_-]?URL)\b\s*[:=]\s*["']?[^\s,"'}]{6,}/i;
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i;

export function containsLikelySecret(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || "");
  if (LABELED_SECRET.test(text) || BEARER_SECRET.test(text)) return true;
  return configuredSecretValues().some((secret) => text.includes(secret));
}

function scrubString(value) {
  let out = String(value);
  for (const secret of configuredSecretValues()) out = out.split(secret).join("[REDACTED]");
  out = out
    .replace(/(\b(?:OKX[_-]?)?(?:API[_-]?KEY|API[_-]?SECRET|SECRET|PASSPHRASE|PASSWORD)\b\s*[:=]\s*)["']?[^\s,"'}]+/gi, "$1[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/([?&](?:api[_-]?key|api[_-]?secret|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|secret|passphrase|password)=)[^&#\s]+/gi, "$1[REDACTED]");
  return out;
}

export function scrubSecrets(value, seen = new WeakSet()) {
  if (typeof value === "string") return scrubString(value);
  if (value === null || value === undefined || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "object") return scrubString(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrubSecrets(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isRegisteredSecretKey(key) || SENSITIVE_KEY.test(key) ? "[REDACTED]" : scrubSecrets(item, seen);
  }
  return output;
}

export function promptFingerprint(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

// 只返回命中数量与集合名，不返回路径中的值或任何匹配片段。
export function scanStoredSecretExposure(db) {
  const collections = ["chatMessages", "agentRuns", "toolExecutions", "traces", "auditLogs"];
  const findings = {};
  for (const name of collections) {
    const rows = Array.isArray(db?.[name]) ? db[name] : [];
    const count = rows.reduce((sum, row) => sum + (containsLikelySecret(row) ? 1 : 0), 0);
    if (count) findings[name] = count;
  }
  return { exposed: Object.values(findings).reduce((sum, count) => sum + count, 0), collections: findings };
}
