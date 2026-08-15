import fs from "node:fs";
import crypto from "node:crypto";

const keyId = (value) => `key_${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;

function parseKeyring(raw, reference = null) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Master key material is empty");
  if (text.startsWith("{")) {
    let document;
    try { document = JSON.parse(text); } catch { throw new Error("Mounted master-key keyring is invalid JSON"); }
    const entries = Object.entries(document.keys || {}).filter(([, value]) => typeof value === "string" && value.length >= 32);
    const keys = new Map(entries);
    const activeKeyId = String(document.activeKeyId || document.activeVersion || "");
    if (!activeKeyId || !keys.has(activeKeyId)) throw new Error("Mounted master-key keyring has no valid activeKeyId");
    if (entries.length !== Object.keys(document.keys || {}).length) throw new Error("Every mounted master key must be at least 32 characters");
    return { activeKeyId, keys, reference, format: "versioned-keyring" };
  }
  if (text.length < 32) throw new Error("Mounted master key must be at least 32 characters");
  const activeKeyId = keyId(text);
  return { activeKeyId, keys: new Map([[activeKeyId, text]]), reference, format: "single-key-legacy" };
}

// Production deployments should mount a short-lived data-encryption key from
// a KMS/Vault sidecar. Environment fallback remains available for local use.
export function keyProviderStatus() {
  if (process.env.SECRETS_MASTER_KEY_FILE) {
    try {
      const file = process.env.SECRETS_MASTER_KEY_FILE;
      const stat = fs.statSync(file);
      if (!stat.isFile()) throw new Error("mounted key reference is not a regular file");
      const ring = parseKeyring(fs.readFileSync(file, "utf8"), file);
      return { provider: "mounted-kms-secret", configured: true, reference: file, activeKeyId: ring.activeKeyId, keyVersions: ring.keys.size, format: ring.format };
    } catch (error) {
      return { provider: "mounted-kms-secret", configured: false, reference: process.env.SECRETS_MASTER_KEY_FILE, error: error.message };
    }
  }
  try {
    const ring = environmentKeyring();
    return { provider: "environment", configured: true, reference: null, activeKeyId: ring.activeKeyId, keyVersions: ring.keys.size, format: ring.format };
  } catch (error) {
    return { provider: "environment", configured: false, reference: null, error: error.message };
  }
}

// 挂载密钥 60s 进程内缓存:热路径(每次 MCP 工具调用/密钥解密)不再同步读盘;
// KMS 轮换后最迟 60s 生效,失败不缓存(保持 fail-fast)。
let cachedFileKey = null; // { path, ring, mtimeMs, size }

function environmentKeyring() {
  if (process.env.SECRETS_MASTER_KEYS_JSON) return parseKeyring(process.env.SECRETS_MASTER_KEYS_JSON);
  if (process.env.SECRETS_MASTER_KEY) return parseKeyring(process.env.SECRETS_MASTER_KEY);
  if (process.env.ALLOW_INSECURE_SECRET_STORAGE === "true") return parseKeyring("development-only-master-key-000000000000");
  throw new Error("SECRETS_MASTER_KEY or SECRETS_MASTER_KEY_FILE is required");
}

export function getMasterKeyring() {
  if (process.env.SECRETS_MASTER_KEY_FILE) {
    const path = process.env.SECRETS_MASTER_KEY_FILE;
    if (!fs.existsSync(path)) throw new Error("SECRETS_MASTER_KEY_FILE does not exist");
    const stat = fs.statSync(path);
    if (!stat.isFile()) throw new Error("SECRETS_MASTER_KEY_FILE must be a regular file");
    if (cachedFileKey && cachedFileKey.path === path && cachedFileKey.mtimeMs === stat.mtimeMs && cachedFileKey.size === stat.size) return cachedFileKey.ring;
    const ring = parseKeyring(fs.readFileSync(path, "utf8"), path);
    cachedFileKey = { path, ring, mtimeMs: stat.mtimeMs, size: stat.size };
    return ring;
  }
  if (process.env.REQUIRE_EXTERNAL_KEY_PROVIDER === "true") {
    throw new Error("External key provider is required; mount SECRETS_MASTER_KEY_FILE from KMS/Vault");
  }
  return environmentKeyring();
}

export function getMasterKeyMaterial(requestedKeyId = null) {
  const ring = getMasterKeyring();
  const selected = requestedKeyId || ring.activeKeyId;
  const material = ring.keys.get(selected);
  if (!material) throw new Error(`Master key version unavailable: ${selected}`);
  return material;
}

export function resetKeyProviderCache() { cachedFileKey = null; }
