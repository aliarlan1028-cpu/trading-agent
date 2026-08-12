import crypto from "node:crypto";

const MAGIC = Buffer.from("TAGBK01\n");

function backupKey(keyMaterial) {
  const material = Buffer.isBuffer(keyMaterial) ? keyMaterial : Buffer.from(keyMaterial || "");
  if (material.length < 32) throw new Error("backup encryption key material must contain at least 32 bytes");
  return crypto.createHash("sha256").update(material).digest();
}

export function encryptBackupBytes(plaintext, keyMaterial) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", backupKey(keyMaterial), iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBackupBytes(encrypted, keyMaterial) {
  const bytes = Buffer.from(encrypted);
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Encrypted backup magic header is invalid");
  if (bytes.length <= MAGIC.length + 12 + 16) throw new Error("Encrypted backup payload is truncated");
  const ivStart = MAGIC.length;
  const tagStart = ivStart + 12;
  const ciphertextStart = tagStart + 16;
  const decipher = crypto.createDecipheriv("aes-256-gcm", backupKey(keyMaterial), bytes.subarray(ivStart, tagStart));
  decipher.setAuthTag(bytes.subarray(tagStart, ciphertextStart));
  return Buffer.concat([decipher.update(bytes.subarray(ciphertextStart)), decipher.final()]);
}
