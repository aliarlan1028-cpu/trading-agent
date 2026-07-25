import fs from "node:fs";

// Production deployments should mount a short-lived data-encryption key from
// a KMS/Vault sidecar. Environment fallback remains available for local use.
export function keyProviderStatus() {
  if (process.env.SECRETS_MASTER_KEY_FILE) {
    return {
      provider: "mounted-kms-secret",
      configured: fs.existsSync(process.env.SECRETS_MASTER_KEY_FILE),
      reference: process.env.SECRETS_MASTER_KEY_FILE
    };
  }
  return { provider: "environment", configured: Boolean(process.env.SECRETS_MASTER_KEY), reference: null };
}

export function getMasterKeyMaterial() {
  if (process.env.SECRETS_MASTER_KEY_FILE) {
    const path = process.env.SECRETS_MASTER_KEY_FILE;
    if (!fs.existsSync(path)) throw new Error("SECRETS_MASTER_KEY_FILE does not exist");
    const value = fs.readFileSync(path, "utf8").trim();
    if (value.length < 32) throw new Error("Mounted master key must be at least 32 characters");
    return value;
  }
  if (process.env.REQUIRE_EXTERNAL_KEY_PROVIDER === "true") {
    throw new Error("External key provider is required; mount SECRETS_MASTER_KEY_FILE from KMS/Vault");
  }
  if (process.env.SECRETS_MASTER_KEY) return process.env.SECRETS_MASTER_KEY;
  if (process.env.ALLOW_INSECURE_SECRET_STORAGE === "true") return "development-only-master-key";
  throw new Error("SECRETS_MASTER_KEY or SECRETS_MASTER_KEY_FILE is required");
}
