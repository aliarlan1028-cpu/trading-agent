import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getMasterKeyMaterial, keyProviderStatus } from "../server/keyProvider.mjs";

test("mounted KMS/Vault key file takes precedence over environment fallback", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trading-agent-key-test-"));
  const file = path.join(dir, "data-key");
  fs.writeFileSync(file, "0123456789abcdef0123456789abcdef\n", { mode: 0o600 });
  const previousFile = process.env.SECRETS_MASTER_KEY_FILE;
  process.env.SECRETS_MASTER_KEY_FILE = file;
  try {
    assert.equal(keyProviderStatus().provider, "mounted-kms-secret");
    assert.equal(getMasterKeyMaterial(), "0123456789abcdef0123456789abcdef");
  } finally {
    if (previousFile === undefined) delete process.env.SECRETS_MASTER_KEY_FILE;
    else process.env.SECRETS_MASTER_KEY_FILE = previousFile;
  }
});
