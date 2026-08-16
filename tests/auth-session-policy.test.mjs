import test from "node:test";
import assert from "node:assert/strict";
import { authenticatedSessionPolicy, evaluateMfaLogin } from "../server/auth.mjs";
import { totpAt } from "../server/totp.mjs";

test("temporary-password sessions are restricted to password recovery endpoints", () => {
  const user = { mustChangePassword: true, securityVersion: 4 };
  const session = { securityVersion: 4 };
  for (const path of ["/api/users/me", "/api/auth/logout", "/api/auth/change-password"]) {
    assert.equal(authenticatedSessionPolicy(user, session, path).ok, true, path);
  }
  for (const path of ["/api/overview", "/api/security/vault", "/api/account/mfa/enroll", "/api/trade-plans"]) {
    const policy = authenticatedSessionPolicy(user, session, path);
    assert.equal(policy.ok, false, path);
    assert.equal(policy.error, "password_change_required", path);
  }
});

test("security version changes revoke every old session", () => {
  const current = authenticatedSessionPolicy({ securityVersion: 2 }, { securityVersion: 2 }, "/api/overview");
  assert.equal(current.ok, true);
  const old = authenticatedSessionPolicy({ securityVersion: 3 }, { securityVersion: 2 }, "/api/overview");
  assert.equal(old.ok, false);
  assert.equal(old.status, 401);
});

test("missing MFA starts step two without consuming a password failure", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  assert.deepEqual(evaluateMfaLogin(secret, ""), { state: "required", countFailure: false });
  assert.deepEqual(evaluateMfaLogin(secret, "not-code"), { state: "invalid", countFailure: true });
  assert.deepEqual(evaluateMfaLogin(secret, totpAt(secret)), { state: "verified", countFailure: false });
});
