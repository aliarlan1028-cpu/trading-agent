import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { decryptBackupBytes, encryptBackupBytes } from "../server/backupEncryption.mjs";

test("异机备份使用带认证的 AES-256-GCM 并可无损恢复", () => {
  const key = crypto.randomBytes(32);
  const source = crypto.randomBytes(4096);
  const encrypted = encryptBackupBytes(source, key);
  assert.notDeepEqual(encrypted, source);
  assert.deepEqual(decryptBackupBytes(encrypted, key), source);
});

test("加密备份被篡改或密钥错误时恢复必须失败", () => {
  const key = crypto.randomBytes(32);
  const encrypted = encryptBackupBytes(Buffer.from("sensitive trading state"), key);
  encrypted[encrypted.length - 1] ^= 1;
  assert.throws(() => decryptBackupBytes(encrypted, key));
  const intact = encryptBackupBytes(Buffer.from("sensitive trading state"), key);
  assert.throws(() => decryptBackupBytes(intact, crypto.randomBytes(32)));
});
