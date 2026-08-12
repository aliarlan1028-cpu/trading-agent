import crypto from "node:crypto";

export const REGISTRATION_MODES = new Set(["closed", "invite", "waitlist", "auto"]);
export const REGISTRATION_TERMS_VERSION = "2026-08-09";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export function normalizeRegistrationMode(value, legacyEnabled = false) {
  const mode = String(value || "").trim().toLowerCase();
  if (REGISTRATION_MODES.has(mode)) return mode;
  return legacyEnabled ? "waitlist" : "closed";
}

export function currentRegistrationMode(db = {}) {
  return normalizeRegistrationMode(
    process.env.PUBLIC_REGISTRATION_MODE || db.runtimeConfig?.PUBLIC_REGISTRATION_MODE,
    process.env.PUBLIC_REGISTRATION_ENABLED === "true"
  );
}

export function registrationCapacity(db = {}) {
  const max = Math.max(0, Number(process.env.PUBLIC_MAX_TENANTS || db.runtimeConfig?.PUBLIC_MAX_TENANTS || 0));
  const active = (db.registrationApplications || []).filter((item) => ["provisioning", "active"].includes(item.status)).length;
  const reserved = (db.registrationApplications || []).filter((item) => ["approved", "payment_pending", "paid"].includes(item.status)).length;
  const used = active + reserved;
  return {
    max,
    active,
    reserved,
    available: max > used ? max - used : 0,
    acceptingApplications: true,
    canProvision: max > used
  };
}

export function publicRegistrationInfo(db = {}) {
  const mode = currentRegistrationMode(db);
  const capacity = registrationCapacity(db);
  return {
    registrationMode: mode,
    registrationEnabled: mode !== "closed",
    applicationOnly: true,
    inviteRequired: mode === "invite",
    automaticProvisioning: mode === "auto" && process.env.PROVISIONING_BROKER_ENABLED === "true",
    captchaRequired: Boolean(process.env.TURNSTILE_SECRET_KEY),
    turnstileSiteKey: process.env.TURNSTILE_SITE_KEY || "",
    termsVersion: process.env.REGISTRATION_TERMS_VERSION || REGISTRATION_TERMS_VERSION,
    privacyVersion: process.env.REGISTRATION_PRIVACY_VERSION || REGISTRATION_TERMS_VERSION,
    termsUrl: process.env.REGISTRATION_TERMS_URL || "",
    privacyUrl: process.env.REGISTRATION_PRIVACY_URL || "",
    capacity
  };
}

export async function submitRegistrationApplication(db, payload = {}, context = {}) {
  const mode = currentRegistrationMode(db);
  if (mode === "closed") throw httpError(403, "Public applications are currently closed");

  const email = String(payload.email || "").trim().toLowerCase();
  const name = String(payload.name || email.split("@")[0] || "").trim().slice(0, 80);
  const planId = String(payload.planId || "").trim().slice(0, 80);
  if (!EMAIL_RE.test(email) || email.length > 254) throw httpError(400, "Valid email is required");
  if (!name) throw httpError(400, "Name is required");
  if (!payload.acceptTerms || !payload.acceptPrivacy || !payload.acknowledgeRisk) {
    throw httpError(400, "Terms, privacy policy and trading risk acknowledgement are required");
  }
  if (planId && !(db.subscriptionPlans || []).some((item) => item.id === planId && item.enabled !== false)) {
    throw httpError(400, "Selected plan is unavailable");
  }

  db.registrationApplications ||= [];
  db.registrationInvites ||= [];
  db.registrationRateLimits ||= [];
  enforcePersistentRateLimit(db, `ip:${hashPrivacyValue(context.ip || "unknown")}`, 5, HOUR_MS);
  enforcePersistentRateLimit(db, `email:${hashPrivacyValue(email)}`, 3, DAY_MS);

  await verifyTurnstile(payload.turnstileToken, context.ip);

  const now = new Date();
  const duplicate = db.registrationApplications.find((item) => item.email === email && !["rejected", "archived"].includes(item.status));
  if (duplicate) {
    duplicate.lastRequestedAt = now.toISOString();
    duplicate.updatedAt = duplicate.lastRequestedAt;
    return { application: sanitizeRegistrationApplication(duplicate), duplicate: true, verificationToken: null };
  }
  if (mode === "invite") consumeInvite(db, payload.inviteCode, email);

  const verificationToken = crypto.randomBytes(32).toString("base64url");
  const termsVersion = process.env.REGISTRATION_TERMS_VERSION || REGISTRATION_TERMS_VERSION;
  const privacyVersion = process.env.REGISTRATION_PRIVACY_VERSION || REGISTRATION_TERMS_VERSION;
  const capacity = registrationCapacity(db);
  const application = {
    id: randomId("reg"),
    email,
    name,
    planId: planId || null,
    mode,
    status: "pending_email_verification",
    capacityStatus: capacity.canProvision ? "capacity_available" : "waitlisted_for_capacity",
    emailVerificationTokenHash: tokenHash(verificationToken),
    applicantAccessTokenHash: tokenHash(verificationToken),
    emailVerificationExpiresAt: new Date(now.getTime() + DAY_MS).toISOString(),
    termsVersion,
    termsAcceptedAt: now.toISOString(),
    privacyVersion,
    privacyAcceptedAt: now.toISOString(),
    riskAcknowledgedAt: now.toISOString(),
    sourceIpHash: hashPrivacyValue(context.ip || "unknown"),
    userAgent: String(context.userAgent || "").slice(0, 300),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  db.registrationApplications.unshift(application);
  return { application: sanitizeRegistrationApplication(application), duplicate: false, verificationToken };
}

export function verifyRegistrationEmail(db, rawToken) {
  const hash = tokenHash(rawToken);
  const application = (db.registrationApplications || []).find((item) => item.emailVerificationTokenHash === hash);
  if (!application || !application.emailVerificationExpiresAt || new Date(application.emailVerificationExpiresAt).getTime() <= Date.now()) {
    throw httpError(400, "Verification link is invalid or expired");
  }
  if (!application.emailVerifiedAt) application.emailVerifiedAt = new Date().toISOString();
  application.status = application.capacityStatus === "waitlisted_for_capacity" ? "capacity_waitlist" : "waitlisted";
  application.updatedAt = new Date().toISOString();
  delete application.emailVerificationTokenHash;
  delete application.emailVerificationExpiresAt;
  return sanitizeRegistrationApplication(application);
}

export function createRegistrationInvite(db, options = {}) {
  db.registrationInvites ||= [];
  const code = `INV-${crypto.randomBytes(9).toString("base64url").toUpperCase()}`;
  const invite = {
    id: randomId("invite"),
    codeHash: tokenHash(code),
    label: String(options.label || "邀请注册").trim().slice(0, 80),
    email: options.email ? String(options.email).trim().toLowerCase() : null,
    maxUses: Math.max(1, Math.min(100, Number(options.maxUses || 1))),
    useCount: 0,
    status: "active",
    expiresAt: options.expiresAt || new Date(Date.now() + 30 * DAY_MS).toISOString(),
    createdAt: new Date().toISOString()
  };
  db.registrationInvites.unshift(invite);
  return { invite: sanitizeInvite(invite), code };
}

export function updateRegistrationApplication(db, id, patch = {}) {
  const application = (db.registrationApplications || []).find((item) => item.id === id);
  if (!application) throw httpError(404, "Registration application not found");
  const nextStatus = patch.status;
  const allowed = {
    pending_email_verification: new Set(["waitlisted", "rejected", "archived"]),
    waitlisted: new Set(["approved", "rejected", "archived", "capacity_waitlist"]),
    capacity_waitlist: new Set(["approved", "rejected", "archived", "waitlisted"]),
    approved: new Set(["payment_pending", "provisioning", "rejected", "archived"]),
    payment_pending: new Set(["paid", "approved", "rejected", "archived"]),
    paid: new Set(["provisioning", "refund_pending"]),
    refund_pending: new Set(["refunded"]),
    refunded: new Set(["archived"]),
    provisioning: new Set(["active", "provision_failed"]),
    provision_failed: new Set(["approved", "provisioning", "rejected", "archived"]),
    active: new Set(["suspended", "archived"]),
    suspended: new Set(["active", "archived"]),
    rejected: new Set(["archived"]),
    archived: new Set()
  };
  if (nextStatus && nextStatus !== application.status) {
    if (!allowed[application.status]?.has(nextStatus)) throw httpError(409, `Invalid registration transition: ${application.status} -> ${nextStatus}`);
    if (nextStatus === "approved" && !application.emailVerifiedAt) throw httpError(409, "Email must be verified before approval");
    if (nextStatus === "approved" && application.status !== "payment_pending" && !registrationCapacity(db).canProvision) throw httpError(409, "No provisioning capacity is available");
    application.status = nextStatus;
    application[`${camelStatus(nextStatus)}At`] = new Date().toISOString();
  }
  if (patch.provisionSlug !== undefined) application.provisionSlug = normalizeSlug(patch.provisionSlug);
  if (patch.provisionUrl !== undefined) application.provisionUrl = String(patch.provisionUrl || "").trim().slice(0, 300) || null;
  if (patch.note !== undefined) application.adminNote = String(patch.note || "").trim().slice(0, 1000) || null;
  application.updatedAt = new Date().toISOString();
  return sanitizeRegistrationApplication(application);
}

export function manuallyVerifyRegistrationEmail(db, id) {
  const application = (db.registrationApplications || []).find((item) => item.id === id);
  if (!application) throw httpError(404, "Registration application not found");
  application.emailVerifiedAt ||= new Date().toISOString();
  if (application.status === "pending_email_verification") {
    application.status = application.capacityStatus === "waitlisted_for_capacity" ? "capacity_waitlist" : "waitlisted";
  }
  delete application.emailVerificationTokenHash;
  delete application.emailVerificationExpiresAt;
  application.updatedAt = new Date().toISOString();
  return sanitizeRegistrationApplication(application);
}

export function sanitizeRegistrationApplication(application = {}) {
  const { emailVerificationTokenHash, applicantAccessTokenHash, sourceIpHash, ...safe } = application;
  return safe;
}

export function publicRegistrationStatus(db, rawToken) {
  const hash = tokenHash(rawToken);
  const application = (db.registrationApplications || []).find((item) => item.applicantAccessTokenHash === hash);
  if (!application) throw httpError(404, "Application not found");
  const payment = (db.paymentRequests || []).find((item) => item.registrationApplicationId === application.id);
  return {
    application: publicApplicantView(application),
    payment: payment ? {
      id: payment.id,
      network: payment.network,
      asset: payment.asset,
      amount: payment.amount,
      address: payment.address,
      status: payment.status,
      expiresAt: payment.expiresAt,
      confirmedAt: payment.confirmedAt || null
    } : null
  };
}

function publicApplicantView(application = {}) {
  return {
    id: application.id,
    name: application.name,
    email: application.email,
    planId: application.planId,
    status: application.status,
    capacityStatus: application.capacityStatus,
    emailVerifiedAt: application.emailVerifiedAt || null,
    provisionUrl: application.status === "active" ? application.provisionUrl || null : null,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt
  };
}

export function markRegistrationPaymentConfirmed(db, applicationId, paymentId) {
  const application = (db.registrationApplications || []).find((item) => item.id === applicationId);
  if (!application) throw httpError(404, "Registration application not found");
  if (application.status === "paid" || ["provisioning", "active"].includes(application.status)) return sanitizeRegistrationApplication(application);
  if (application.status !== "payment_pending") throw httpError(409, `Payment cannot activate application in ${application.status}`);
  application.status = "paid";
  application.paymentId = paymentId;
  application.paidAt = new Date().toISOString();
  application.updatedAt = application.paidAt;
  return sanitizeRegistrationApplication(application);
}

export function issueApplicantAccessToken(db, applicationId) {
  const application = (db.registrationApplications || []).find((item) => item.id === applicationId);
  if (!application) throw httpError(404, "Registration application not found");
  const token = crypto.randomBytes(32).toString("base64url");
  application.applicantAccessTokenHash = tokenHash(token);
  application.accessTokenRotatedAt = new Date().toISOString();
  application.updatedAt = application.accessTokenRotatedAt;
  return token;
}

export async function sendRegistrationLifecycleEmail(application, event, details = {}, accessToken = "") {
  const endpoint = process.env.REGISTRATION_EMAIL_WEBHOOK_URL;
  const publicBase = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!endpoint || !publicBase) return { sent: false, reason: "email_provider_unconfigured" };
  const statusUrl = accessToken ? `${publicBase}/api/public/registration/status?token=${encodeURIComponent(accessToken)}` : "";
  const headers = { "Content-Type": "application/json" };
  if (process.env.REGISTRATION_EMAIL_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.REGISTRATION_EMAIL_WEBHOOK_TOKEN}`;
  const subjects = {
    payment_requested: "Payment details for your KORDYN instance",
    payment_confirmed: "Your KORDYN payment is confirmed",
    instance_ready: "Your KORDYN instance is ready"
  };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: `registration_${event}`,
        to: application.email,
        subject: subjects[event] || "KORDYN onboarding update",
        applicationId: application.id,
        statusUrl,
        ...details
      }),
      signal: globalThis.AbortSignal.timeout(8000)
    });
    return response.ok ? { sent: true } : { sent: false, reason: `email_webhook_http_${response.status}` };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

export function sanitizeInvite(invite = {}) {
  const { codeHash, ...safe } = invite;
  return safe;
}

export async function sendRegistrationVerificationEmail(application, rawToken) {
  const endpoint = process.env.REGISTRATION_EMAIL_WEBHOOK_URL;
  if (!endpoint) return { sent: false, reason: "email_provider_unconfigured" };
  const publicBase = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!publicBase) return { sent: false, reason: "public_base_url_unconfigured" };
  const verifyUrl = `${publicBase}/api/public/registration/verify?token=${encodeURIComponent(rawToken)}`;
  const headers = { "Content-Type": "application/json" };
  if (process.env.REGISTRATION_EMAIL_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.REGISTRATION_EMAIL_WEBHOOK_TOKEN}`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "registration_email_verification",
        to: application.email,
        subject: "Verify your KORDYN application",
        text: `Verify your application within 24 hours: ${verifyUrl}`,
        verifyUrl,
        applicationId: application.id
      }),
      signal: globalThis.AbortSignal.timeout(8000)
    });
    return response.ok ? { sent: true } : { sent: false, reason: `email_webhook_http_${response.status}` };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { success: true, skipped: true };
  if (!token) throw httpError(400, "Human verification is required");
  const body = new URLSearchParams({ secret, response: String(token) });
  if (remoteIp) body.set("remoteip", String(remoteIp));
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: globalThis.AbortSignal.timeout(6000)
    });
    const result = await response.json();
    if (!result.success) throw httpError(400, "Human verification failed");
    return result;
  } catch (error) {
    if (error.status) throw error;
    throw httpError(503, "Human verification service is unavailable");
  }
}

function enforcePersistentRateLimit(db, key, max, windowMs) {
  const now = Date.now();
  db.registrationRateLimits = (db.registrationRateLimits || []).filter((item) => new Date(item.resetAt).getTime() > now);
  let item = db.registrationRateLimits.find((entry) => entry.key === key);
  if (!item) {
    item = { key, count: 0, resetAt: new Date(now + windowMs).toISOString() };
    db.registrationRateLimits.push(item);
  }
  if (item.count >= max) throw httpError(429, "Too many registration attempts; try again later");
  item.count += 1;
}

function consumeInvite(db, rawCode, email) {
  const invite = (db.registrationInvites || []).find((item) => item.codeHash === tokenHash(rawCode));
  if (!invite || invite.status !== "active" || new Date(invite.expiresAt).getTime() <= Date.now() || invite.useCount >= invite.maxUses) {
    throw httpError(400, "Invite code is invalid or expired");
  }
  if (invite.email && invite.email !== email) throw httpError(400, "Invite code is not valid for this email");
  invite.useCount += 1;
  invite.lastUsedAt = new Date().toISOString();
  if (invite.useCount >= invite.maxUses) invite.status = "consumed";
}

function hashPrivacyValue(value) {
  const salt = process.env.REGISTRATION_RATE_LIMIT_SALT || process.env.SECRETS_MASTER_KEY || "registration-rate-limit";
  return crypto.createHmac("sha256", salt).update(String(value)).digest("hex");
}

function tokenHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function normalizeSlug(value) {
  const slug = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,30}$/.test(slug)) throw httpError(400, "Provisioning slug is invalid");
  return slug;
}

function camelStatus(value) {
  return String(value).replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
