import crypto from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(bytes = 20) {
  return encodeBase32(crypto.randomBytes(Math.max(20, Number(bytes) || 20)));
}

export function totpAt(secret, timestamp = Date.now(), options = {}) {
  const stepSeconds = Number(options.stepSeconds || 30);
  const digits = Number(options.digits || 6);
  const counter = Math.floor(Number(timestamp) / 1000 / stepSeconds);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** digits)).padStart(digits, "0");
}

export function verifyTotp(secret, token, timestamp = Date.now(), window = 1) {
  const provided = String(token || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(provided)) return false;
  for (let skew = -Math.max(0, window); skew <= Math.max(0, window); skew += 1) {
    const expected = totpAt(secret, Number(timestamp) + skew * 30_000);
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

export function totpProvisioningUri({ secret, account, issuer = "KORDYN" }) {
  const label = `${issuer}:${account}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function encodeBase32(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let index = 0; index < bits.length; index += 5) {
    output += ALPHABET[Number.parseInt(bits.slice(index, index + 5).padEnd(5, "0"), 2)];
  }
  return output;
}

export function decodeBase32(value) {
  const normalized = String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (!normalized) throw new Error("TOTP secret is empty");
  let bits = "";
  for (const char of normalized) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error("TOTP secret is invalid");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}
