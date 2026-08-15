import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createRegistrationInvite,
  currentRegistrationMode,
  markRegistrationPaymentConfirmed,
  manuallyVerifyRegistrationEmail,
  normalizeRegistrationMode,
  publicRegistrationInfo,
  publicRegistrationStatus,
  issueApplicantAccessToken,
  submitRegistrationApplication,
  updateRegistrationApplication,
  verifyRegistrationEmail
} from "../server/publicRegistration.mjs";

const ENV_KEYS = [
  "PUBLIC_REGISTRATION_MODE", "PUBLIC_REGISTRATION_ENABLED", "PUBLIC_MAX_TENANTS",
  "TURNSTILE_SECRET_KEY", "TURNSTILE_SITE_KEY", "PROVISIONING_BROKER_ENABLED"
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

function db() {
  return {
    runtimeConfig: {},
    users: [{ id: "owner", email: "owner@example.com", tenantId: "tenant_owner" }],
    tenants: [{ id: "tenant_owner" }],
    subscriptionPlans: [{ id: "plan_monthly", enabled: true }],
    registrationApplications: [],
    registrationInvites: [],
    registrationRateLimits: []
  };
}

function validPayload(extra = {}) {
  return {
    name: "Alice",
    email: "alice@example.com",
    planId: "plan_monthly",
    acceptTerms: true,
    acceptPrivacy: true,
    acknowledgeRisk: true,
    ...extra
  };
}

test("registration mode migrates legacy boolean to safe waitlist semantics", () => {
  assert.equal(normalizeRegistrationMode("", false), "closed");
  assert.equal(normalizeRegistrationMode("", true), "waitlist");
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
  delete process.env.PUBLIC_REGISTRATION_MODE;
  assert.equal(currentRegistrationMode(db()), "waitlist");
});

test("public application never creates a user, tenant, subscription or session", async () => {
  process.env.PUBLIC_REGISTRATION_MODE = "waitlist";
  process.env.PUBLIC_MAX_TENANTS = "2";
  const database = db();
  const counts = {
    users: database.users.length,
    tenants: database.tenants.length
  };
  const result = await submitRegistrationApplication(database, validPayload({ password: "must-not-be-stored" }), { ip: "203.0.113.10", userAgent: "test" });
  assert.equal(result.application.status, "pending_email_verification");
  assert.ok(result.verificationToken);
  assert.equal(database.users.length, counts.users);
  assert.equal(database.tenants.length, counts.tenants);
  assert.equal(database.subscriptions, undefined);
  assert.equal(database.authSessions, undefined);
  assert.equal(JSON.stringify(database.registrationApplications).includes("must-not-be-stored"), false);

  const verified = verifyRegistrationEmail(database, result.verificationToken);
  assert.equal(verified.application.status, "waitlisted");
  assert.ok(verified.application.emailVerifiedAt);
  assert.ok(verified.applicantAccessToken);
  assert.throws(() => publicRegistrationStatus(database, result.verificationToken), /Application not found/);
  assert.equal(publicRegistrationStatus(database, verified.applicantAccessToken).application.status, "waitlisted");
});

test("duplicate application returns the existing record without revealing a new token", async () => {
  process.env.PUBLIC_REGISTRATION_MODE = "waitlist";
  const database = db();
  const first = await submitRegistrationApplication(database, validPayload(), { ip: "203.0.113.11" });
  const duplicate = await submitRegistrationApplication(database, validPayload(), { ip: "203.0.113.11" });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.verificationToken, null);
  assert.equal(duplicate.application.id, first.application.id);
  assert.equal(database.registrationApplications.length, 1);
});

test("invite mode requires and consumes a bounded invite", async () => {
  process.env.PUBLIC_REGISTRATION_MODE = "invite";
  const database = db();
  const { code, invite } = createRegistrationInvite(database, { email: "alice@example.com", maxUses: 1 });
  await assert.rejects(() => submitRegistrationApplication(database, validPayload(), { ip: "203.0.113.12" }), /Invite code/);
  const accepted = await submitRegistrationApplication(database, validPayload({ inviteCode: code }), { ip: "203.0.113.13" });
  assert.ok(accepted.application.id);
  assert.equal(database.registrationInvites.find((item) => item.id === invite.id).status, "consumed");
});

test("approval is fail-closed on email verification and capacity", async () => {
  process.env.PUBLIC_REGISTRATION_MODE = "waitlist";
  process.env.PUBLIC_MAX_TENANTS = "1";
  const database = db();
  const result = await submitRegistrationApplication(database, validPayload(), { ip: "203.0.113.14" });
  assert.throws(() => updateRegistrationApplication(database, result.application.id, { status: "approved" }), /Invalid registration transition|Email must be verified/);
  manuallyVerifyRegistrationEmail(database, result.application.id);
  const accessToken = issueApplicantAccessToken(database, result.application.id);
  const approved = updateRegistrationApplication(database, result.application.id, { status: "approved", provisionSlug: "alice-01" });
  assert.equal(approved.status, "approved");
  assert.equal(publicRegistrationInfo(database).capacity.available, 0);
  updateRegistrationApplication(database, result.application.id, { status: "payment_pending" });
  const paid = markRegistrationPaymentConfirmed(database, result.application.id, "pay_01");
  assert.equal(paid.status, "paid");
  const status = publicRegistrationStatus(database, accessToken);
  assert.equal(status.application.status, "paid");
  assert.equal(status.application.applicantAccessTokenHash, undefined);
  assert.equal(status.application.email, undefined);
  assert.equal(status.application.provisionUrl, undefined);
});

test("applicant access tokens expire, revoke on terminal state and rotate", async () => {
  process.env.PUBLIC_REGISTRATION_MODE = "waitlist";
  process.env.PUBLIC_MAX_TENANTS = "2";
  const database = db();
  const submitted = await submitRegistrationApplication(database, validPayload(), { ip: "203.0.113.22" });
  const verified = verifyRegistrationEmail(database, submitted.verificationToken);
  const first = verified.applicantAccessToken;
  assert.equal(publicRegistrationStatus(database, first).application.status, "waitlisted");
  const second = issueApplicantAccessToken(database, submitted.application.id);
  assert.throws(() => publicRegistrationStatus(database, first), /Application not found/);
  assert.equal(publicRegistrationStatus(database, second).application.status, "waitlisted");
  database.registrationApplications[0].applicantAccessTokenExpiresAt = new Date(Date.now() - 1).toISOString();
  assert.throws(() => publicRegistrationStatus(database, second), /Application not found/);

  const third = issueApplicantAccessToken(database, submitted.application.id);
  updateRegistrationApplication(database, submitted.application.id, { status: "rejected" });
  assert.throws(() => publicRegistrationStatus(database, third), /Application not found/);
});

test("legal consent is mandatory", async () => {
  process.env.PUBLIC_REGISTRATION_MODE = "waitlist";
  await assert.rejects(
    () => submitRegistrationApplication(db(), validPayload({ acknowledgeRisk: false }), { ip: "203.0.113.15" }),
    /Terms, privacy policy and trading risk/
  );
});
