import assert from "node:assert/strict";
import test from "node:test";
import { decodeBase32, encodeBase32, generateTotpSecret, totpAt, totpProvisioningUri, verifyTotp } from "../server/totp.mjs";

test("TOTP base32 round-trip and six-digit verification", () => {
  const raw = Buffer.from("12345678901234567890");
  const secret = encodeBase32(raw);
  assert.deepEqual(decodeBase32(secret), raw);
  const at = 1_700_000_000_000;
  const token = totpAt(secret, at);
  assert.match(token, /^\d{6}$/);
  assert.equal(verifyTotp(secret, token, at), true);
  assert.equal(verifyTotp(secret, "not-a-code", at), false);
});

test("TOTP accepts one time-step of clock skew and emits a standard provisioning URI", () => {
  const secret = generateTotpSecret();
  const at = 1_700_000_000_000;
  const previous = totpAt(secret, at - 30_000);
  assert.equal(verifyTotp(secret, previous, at, 1), true);
  assert.equal(verifyTotp(secret, previous, at, 0), false);
  assert.match(totpProvisioningUri({ secret, account: "owner@example.com" }), /^otpauth:\/\/totp\//);
});
