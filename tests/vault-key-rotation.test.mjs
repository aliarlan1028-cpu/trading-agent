import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-key-rotation-"));
process.env.DATA_DIR = dataDir;
const keyFile = path.join(dataDir, "master-keys.json");
process.env.SECRETS_MASTER_KEY_FILE = keyFile;
delete process.env.SECRETS_MASTER_KEY;

const KEY_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEY_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const writeRing = (activeKeyId, keys) => fs.writeFileSync(keyFile, JSON.stringify({ activeKeyId, keys }), { mode: 0o600 });
writeRing("v1", { v1: KEY_A });

const { resetKeyProviderCache } = await import("../server/keyProvider.mjs");
const { readSecret, rotateVaultEncryption, storeSecret } = await import("../server/securityOps.mjs");
const { applyStoredConfigToEnv } = await import("../server/runtimeConfig.mjs");

function dbFixture() {
  return {
    meta: {}, system: {}, vaultItems: [], auditLogs: [], traces: [], riskIncidents: [], runtimeConfig: {}, clearedRuntimeSecrets: [],
    exchangeAccounts: [{ id: "okx", exchange: "OKX", readEnabled: true, tradeEnabled: true, status: "configured" }]
  };
}

test("versioned keyring reads mixed key versions and atomically rewraps under the active key", () => {
  const db = dbFixture();
  storeSecret(db, "ADMIN_PASSWORD", "new-owner-password", "auth");
  assert.equal(db.vaultItems[0].encrypted.keyId, "v1");

  writeRing("v2", { v1: KEY_A, v2: KEY_B });
  resetKeyProviderCache();
  storeSecret(db, "OPENAI_API_KEY", "new-openai-key", "llm");
  assert.equal(readSecret(db, "ADMIN_PASSWORD"), "new-owner-password");
  assert.equal(readSecret(db, "OPENAI_API_KEY"), "new-openai-key");
  assert.deepEqual(new Set(db.vaultItems.map((item) => item.encrypted.keyId)), new Set(["v1", "v2"]));

  const rotated = rotateVaultEncryption(db);
  assert.equal(rotated.rotated, 2);
  assert.ok(db.vaultItems.every((item) => item.encrypted.keyId === "v2"));

  writeRing("v2", { v2: KEY_B });
  resetKeyProviderCache();
  assert.equal(readSecret(db, "ADMIN_PASSWORD"), "new-owner-password");
  assert.equal(readSecret(db, "OPENAI_API_KEY"), "new-openai-key");
});

test("failed rotation is all-or-nothing when any vault item cannot be decrypted", () => {
  writeRing("v1", { v1: KEY_A });
  resetKeyProviderCache();
  const db = dbFixture();
  storeSecret(db, "ADMIN_PASSWORD", "owner-password", "auth");
  storeSecret(db, "OPENAI_API_KEY", "openai-key", "llm");
  db.vaultItems[0].encrypted.ciphertext = "corrupt";
  const before = JSON.stringify(db.vaultItems);
  writeRing("v2", { v1: KEY_A, v2: KEY_B });
  resetKeyProviderCache();
  assert.throws(() => rotateVaultEncryption(db), /Vault decryption failed/);
  assert.equal(JSON.stringify(db.vaultItems), before);
});

test("master-key loss never revives bootstrap ADMIN or OKX credentials", () => {
  writeRing("v1", { v1: KEY_A });
  resetKeyProviderCache();
  const db = dbFixture();
  storeSecret(db, "ADMIN_PASSWORD", "vault-owner-password", "auth");
  storeSecret(db, "OKX_API_SECRET", "vault-okx-secret", "exchange");
  process.env.ADMIN_PASSWORD = "obsolete-bootstrap-password";
  process.env.OKX_API_SECRET = "obsolete-bootstrap-secret";

  writeRing("v2", { v2: KEY_B });
  resetKeyProviderCache();
  applyStoredConfigToEnv(db);
  assert.equal(process.env.ADMIN_PASSWORD, undefined);
  assert.equal(process.env.OKX_API_SECRET, undefined);
  assert.equal(db.system.authLockedByVaultFailure, true);
  assert.equal(db.system.liveTradingEnabled, false);
  assert.equal(db.system.orderWriteEnabled, false);
  assert.equal(db.exchangeAccounts[0].tradeEnabled, false);
  assert.ok(db.system.secretDecryptionFailures.some((row) => row.name === "ADMIN_PASSWORD"));
  assert.ok(db.riskIncidents.some((row) => row.source === "vault:OKX_API_SECRET" && row.status === "open"));
});
