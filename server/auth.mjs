import crypto from "node:crypto";
import express from "express";
import { appendAudit, saveDb, nowIso, id } from "./store.mjs";
import { readSecret, storeSecret } from "./securityOps.mjs";
import { generateTotpSecret, totpProvisioningUri, verifyTotp } from "./totp.mjs";
import {
  sendRegistrationVerificationEmail,
  publicRegistrationStatus,
  submitRegistrationApplication,
  verifyRegistrationEmail
} from "./publicRegistration.mjs";
import { invalidateStreamTickets } from "./streamTickets.mjs";
import { tenantWorkspaceAccess } from "./tenantIsolation.mjs";
import { requestEntitlementPolicy } from "./entitlements.mjs";

const sessions = new Map();
const SESSION_DAYS = Math.max(1 / 24, Math.min(7, Number(process.env.AUTH_SESSION_DAYS || 1)));
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60_000;
const LOGIN_MAX_ATTEMPTS = Math.max(3, Number(process.env.LOGIN_MAX_ATTEMPTS || 8));
const authJson = express.json({ limit: "64kb" });

export function authRequired() {
  if (process.env.AUTH_REQUIRED === "false") return false;
  return true;
}

export function authenticatedSessionPolicy(user = {}, session = {}, path = "") {
  if (Number(session.securityVersion || 0) !== Number(user.securityVersion || 0)) {
    return { ok: false, status: 401, error: "session_security_version_mismatch" };
  }
  if (user.mustChangePassword === true
    && !["/api/users/me", "/api/auth/logout", "/api/auth/change-password"].includes(path)) {
    return { ok: false, status: 403, error: "password_change_required" };
  }
  return { ok: true };
}

let warnedNoPassword = false;
const ownerEmail = () => String(process.env.OWNER_EMAIL || "aliarlan1028@gmail.com").trim().toLowerCase();

export function installAuth(app, db) {
  app.post("/api/auth/login", authJson, (req, res) => {
    const clientKey = String(req.ip || req.socket?.remoteAddress || "unknown");
    const attempt = loginAttempts.get(clientKey);
    if (attempt && attempt.resetAt > Date.now() && attempt.count >= LOGIN_MAX_ATTEMPTS) {
      res.setHeader("Retry-After", String(Math.ceil((attempt.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ error: "Too many login attempts" });
    }
    const password = String(req.body?.password || "");
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!process.env.ADMIN_PASSWORD) {
      return res.status(503).json({ error: "ADMIN_PASSWORD is not configured" });
    }
    const user = (db.users || []).find((item) => String(item.email || "").toLowerCase() === email);
    const isOwnerEmail = email === ownerEmail();
    if (isOwnerEmail && safeEqual(password, process.env.ADMIN_PASSWORD)) {
      const owner = ensureOwnerUser(db);
      return completePasswordLogin(req, res, db, owner, clientKey);
    }
    if (!user || user.status === "disabled" || !verifyPassword(password, user.passwordHash)) {
      recordLoginFailure(clientKey);
      return res.status(401).json({ error: "Invalid credentials" });
    }
    return completePasswordLogin(req, res, db, user, clientKey);
  });

  const handleRegistrationApplication = async (req, res) => {
    try {
      const result = await submitRegistrationApplication(db, req.body || {}, {
        ip: req.ip || req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"]
      });
      let delivery = { sent: false, reason: result.duplicate ? "already_received" : "not_attempted" };
      if (result.verificationToken) delivery = await sendRegistrationVerificationEmail(result.application, result.verificationToken);
      appendAudit(db, `收到公开开通申请：${result.application.id}`, result.application.id, "PublicRegistration", "info");
      saveDb(db);
      // 新申请与重复邮箱使用相同状态码和外部状态，避免把入口变成邮箱存在性探针。
      const response = {
        ok: true,
        application: {
          id: id("receipt"),
          status: "received"
        },
        verificationDelivery: delivery.sent ? "sent" : "manual_review",
        message: "Application received. Verify your email if a message was sent; no trading account has been created yet."
      };
      if (process.env.NODE_ENV !== "production" && result.verificationToken) response.devVerificationToken = result.verificationToken;
      res.status(202).json(response);
    } catch (error) {
      // 限流计数必须在失败请求上也持久化，不能靠重启清零。
      saveDb(db);
      throw error;
    }
  };

  // 兼容旧客户端的 /api/auth/register，但语义已经安全收紧为“提交开通申请”。
  // 它不会创建用户/租户/会话，也不会让访客进入 Owner 工作区。
  app.post("/api/auth/register", authJson, handleRegistrationApplication);
  app.post("/api/public/registration/apply", authJson, handleRegistrationApplication);
  app.get("/api/public/registration/verify", (req, res) => {
    const verified = verifyRegistrationEmail(db, req.query?.token);
    setRegistrationAccessCookie(res, verified.applicantAccessToken);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    appendAudit(db, `公开开通申请邮箱已验证：${verified.application.id}`, verified.application.id, "PublicRegistration", "info");
    saveDb(db);
    res.json({ ok: true, application: verified.application, statusUrl: "/api/public/registration/status", message: "Email verified. Your application is now in the onboarding queue." });
  });
  app.post("/api/public/registration/access", authJson, (req, res) => {
    const token = String(req.body?.token || "");
    const status = publicRegistrationStatus(db, token);
    setRegistrationAccessCookie(res, token);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.json(status);
  });
  app.get("/api/public/registration/status", (req, res) => {
    if (req.query?.token) return res.status(400).json({ error: "query_bearer_not_supported" });
    const token = getCookie(req, "registration_access") || getBearerToken(req);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.json(publicRegistrationStatus(db, token));
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = getAuthToken(req);
    if (token) deleteSession(db, token);
    clearSessionCookie(res);
    saveDb(db);
    res.json({ ok: true });
  });

	  app.use((req, res, next) => {
	    if (!authRequired()) {
	      req.user = db.users?.[0] || db.user;
	      return next();
	    }
	    // /api/market/klines 是纯公开 OKX 行情（无任何账户数据），必须免鉴权：
    // 前端图表（TradingViewChart/LiveCandleChart）的 fetch 不带 Authorization 头，收紧会全线打断 K 线。
    if (req.path === "/api/health" || req.path === "/api/public/bootstrap" || req.path === "/api/public/ticker-bar" || req.path === "/api/auth/login" || req.path === "/api/auth/register" || req.path === "/api/payments/trc20/webhook" || req.path === "/api/stream" || req.path === "/api/market/klines") return next();
	    if (!process.env.ADMIN_PASSWORD) {
	      if (!warnedNoPassword) {
	        console.warn("[auth] ADMIN_PASSWORD 未配置，受保护 API 已锁定；设置 ADMIN_PASSWORD 或显式 AUTH_REQUIRED=false 仅用于本地开发。");
	        warnedNoPassword = true;
	      }
	      return res.status(503).json({ error: "ADMIN_PASSWORD is not configured; protected API is locked" });
	    }
	    const token = getAuthToken(req);
    const session = token ? findSession(db, token) : null;
    if (!session) return res.status(401).json({ error: "Authentication required" });
    const sessionUser = (db.users || []).find((user) => user.id === session.userId);
    if (!sessionUser || sessionUser.status === "disabled") {
      if (token) deleteSession(db, token);
      invalidateStreamTickets({ userId: session.userId, sessionId: session.id });
      saveDb(db);
      return res.status(401).json({ error: "Session user is unavailable or disabled" });
    }
    req.user = sessionUser;
    req.session = session;
    req.tenantId = session.tenantId || req.user?.tenantId || "tenant_owner";
    const sessionPolicy = authenticatedSessionPolicy(sessionUser, session, req.path);
    if (!sessionPolicy.ok && sessionPolicy.status === 401) {
      if (token) deleteSession(db, token);
      invalidateStreamTickets({ userId: session.userId, sessionId: session.id });
      saveDb(db);
      return res.status(401).json({ error: "Session security version is no longer valid" });
    }
    if (!sessionPolicy.ok) {
      return res.status(403).json({ error: "password_change_required", mustChangePassword: true });
    }
    const tenantAccess = tenantWorkspaceAccess(req.tenantId);
    if (!tenantAccess.allowed) {
      return res.status(403).json({
        error: tenantAccess.reason,
        message: "Tenant trading workspaces remain disabled until resource-level isolation is complete; use one isolated instance per customer."
      });
    }
    const entitlementPolicy = requestEntitlementPolicy(db, {
      user: req.user,
      tenantId: req.tenantId,
      path: req.path,
      method: req.method
    });
    req.entitlement = entitlementPolicy.entitlement;
    if (!entitlementPolicy.allowed) {
      return res.status(402).json({
        error: entitlementPolicy.entitlement.reason,
        message: "Subscription or trial access has expired. Renew the workspace subscription to continue."
      });
    }
    req.entitlementRecoveryOnly = entitlementPolicy.recoveryOnly;
    next();
  });

  app.get("/api/users/me", (req, res) => {
    res.json({ user: sanitizeUser(req.user || db.user), authRequired: authRequired(), permissions: resolvePermissions(db, req.user || db.user) });
  });

  app.post("/api/account/mfa/enroll", authJson, (req, res) => {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Authentication required" });
    if (user.mfaEnabled) return res.status(409).json({ error: "MFA is already enabled" });
    if (!verifyCurrentPassword(user, req.body?.currentPassword)) return res.status(401).json({ error: "Current password reauthentication required" });
    res.setHeader("Cache-Control", "no-store");
    if (user.mfaPendingSecretName) db.vaultItems = (db.vaultItems || []).filter((item) => item.name !== user.mfaPendingSecretName);
    const secret = generateTotpSecret();
    const secretName = `MFA_TOTP_PENDING_${user.id}_${crypto.randomBytes(6).toString("hex")}`;
    storeSecret(db, secretName, secret, "authentication");
    user.mfaPendingSecretName = secretName;
    user.mfaPendingExpiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    user.updatedAt = nowIso();
    appendAudit(db, "开始配置双因素认证", user.id, user.name || user.email, "warning");
    saveDb(db);
    res.json({
      status: "pending_confirmation",
      secret,
      provisioningUri: totpProvisioningUri({ secret, account: user.email || user.id }),
      message: "请将密钥加入认证器，并输入当前 6 位验证码完成启用。"
    });
  });

  app.post("/api/account/mfa/confirm", authJson, (req, res) => {
    const user = req.user;
    const secretName = user?.mfaPendingSecretName;
    const secret = secretName ? readSecret(db, secretName) : null;
    if (!user || !secret) return res.status(400).json({ error: "No pending MFA enrollment" });
    res.setHeader("Cache-Control", "no-store");
    if (!verifyCurrentPassword(user, req.body?.currentPassword)) return res.status(401).json({ error: "Current password reauthentication required" });
    if (!user.mfaPendingExpiresAt || new Date(user.mfaPendingExpiresAt).getTime() <= Date.now()) {
      db.vaultItems = (db.vaultItems || []).filter((item) => item.name !== secretName);
      delete user.mfaPendingSecretName;
      delete user.mfaPendingExpiresAt;
      saveDb(db);
      return res.status(410).json({ error: "Pending MFA enrollment expired" });
    }
    if (!verifyTotp(secret, req.body?.code)) return res.status(400).json({ error: "Invalid verification code" });
    user.mfaSecretName = secretName;
    user.mfaEnabled = true;
    delete user.mfaPendingSecretName;
    delete user.mfaPendingExpiresAt;
    user.mfaVersion = Number(user.mfaVersion || 0) + 1;
    user.securityVersion = Number(user.securityVersion || 0) + 1;
    user.mfaEnabledAt = nowIso();
    user.updatedAt = user.mfaEnabledAt;
    invalidateUserSessions(db, user.id, { persist: false });
    appendAudit(db, "启用双因素认证", user.id, user.name || user.email, "warning");
    saveDb(db);
    return createSession(req, res, db, user, { ok: true, mfaEnabled: true, sessionRotated: true });
  });

  app.delete("/api/account/mfa", authJson, (req, res) => {
    const user = req.user;
    const secret = user?.mfaSecretName ? readSecret(db, user.mfaSecretName) : null;
    if (!user?.mfaEnabled || !secret) return res.status(400).json({ error: "MFA is not enabled" });
    res.setHeader("Cache-Control", "no-store");
    if (!verifyCurrentPassword(user, req.body?.currentPassword)) return res.status(401).json({ error: "Current password reauthentication required" });
    if (!verifyTotp(secret, req.body?.code)) return res.status(400).json({ error: "Invalid verification code" });
    db.vaultItems = (db.vaultItems || []).filter((item) => item.name !== user.mfaSecretName);
    delete user.mfaSecretName;
    user.mfaEnabled = false;
    user.mfaVersion = Number(user.mfaVersion || 0) + 1;
    user.securityVersion = Number(user.securityVersion || 0) + 1;
    user.mfaDisabledAt = nowIso();
    user.updatedAt = user.mfaDisabledAt;
    invalidateUserSessions(db, user.id, { persist: false });
    appendAudit(db, "停用双因素认证", user.id, user.name || user.email, "critical");
    saveDb(db);
    return createSession(req, res, db, user, { ok: true, mfaEnabled: false, sessionRotated: true });
  });
}

function completePasswordLogin(req, res, db, user, clientKey) {
  if (user.mfaEnabled) {
    let secret = null;
    try { secret = user.mfaSecretName ? readSecret(db, user.mfaSecretName) : null; } catch { secret = null; }
    if (!secret) {
      recordLoginFailure(clientKey);
      return res.status(503).json({ error: "MFA is enabled but its secret is unavailable; contact the instance owner" });
    }
    if (!verifyTotp(secret, req.body?.totp)) {
      recordLoginFailure(clientKey);
      return res.status(401).json({ error: "Two-factor verification required", mfaRequired: true });
    }
  }
  loginAttempts.delete(clientKey);
  return createSession(req, res, db, user, { mustChangePassword: user.mustChangePassword === true });
}

function verifyCurrentPassword(user, value) {
  const password = String(value || "");
  if (!password) return false;
  if (user?.isOwner) return Boolean(process.env.ADMIN_PASSWORD) && safeEqual(password, process.env.ADMIN_PASSWORD);
  return Boolean(user?.passwordHash) && verifyPassword(password, user.passwordHash);
}

function recordLoginFailure(key) {
  // 防内存无界增长：大量不同来源 IP 失败会让 Map 只增不减（成功才 delete），定期清掉过期项。
  if (loginAttempts.size > 1000) {
    for (const [k, v] of loginAttempts) if (v.resetAt <= Date.now()) loginAttempts.delete(k);
  }
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= Date.now()) {
    loginAttempts.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!authRequired()) return next();
    if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: "ADMIN_PASSWORD is not configured; protected API is locked" });
    const db = req.app.locals.db;
    const permissions = resolvePermissions(db, req.user);
    if (permissions.includes("*") || permissions.includes(permission)) return next();
    res.status(403).json({ error: `Missing permission: ${permission}` });
  };
}

export function invalidateSessions(db) {
  sessions.clear();
  invalidateStreamTickets();
  if (db) {
    db.authSessions = [];
    saveDb(db);
  }
}

export function invalidateUserSessions(db, userId, options = {}) {
  const removedIds = new Set((db.authSessions || []).filter((session) => session.userId === userId && session.id !== options.exceptSessionId).map((session) => session.id));
  db.authSessions = (db.authSessions || []).filter((session) => !removedIds.has(session.id));
  for (const [token, session] of sessions) if (removedIds.has(session.id)) sessions.delete(token);
  invalidateStreamTickets({ userId });
  if (options.persist !== false) saveDb(db);
  return removedIds.size;
}

export function resolvePermissions(db, user = {}) {
  if (user.status === "disabled") return [];
  // fail-closed：缺失角色不再默认管理员（旧逻辑 user.role || "管理员" 让任何无角色记录拿到全量权限）。
  // 仅 owner 主账户（db.user）在缺角色时保留管理员默认，避免存量数据把主人锁在门外。
  const isOwner = db.user && (user === db.user || (user.id && user.id === db.user.id));
  const roleName = user.role || (isOwner ? "管理员" : null);
  if (!roleName && !user.roleId) return [];
  const role = (db.roles || []).find((item) => item.name === roleName || (user.roleId && item.id === user.roleId));
  return role?.permissions || [];
}

function createSession(req, res, db, user, extra = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  const session = {
    id: id("auth"),
    tokenHash: hashToken(token),
    userId: user.id,
    tenantId: user.tenantId || "tenant_owner",
    role: user.role || "管理员",
    securityVersion: Number(user.securityVersion || 0),
    mfaVersion: Number(user.mfaVersion || 0),
    authLevel: user.mfaEnabled ? "password+mfa" : "password",
    reauthenticatedAt: now,
    createdAt: now,
    lastSeenAt: now,
    expiresAt
  };
  db.authSessions ||= [];
  db.authSessions = db.authSessions.filter((item) => item.expiresAt && new Date(item.expiresAt).getTime() > Date.now());
  db.authSessions.unshift(session);
  sessions.set(token, session);
  saveDb(db);
  // 浏览器使用 HttpOnly cookie，令牌不再暴露给页面 JS/localStorage；Capacitor 原生 App
  // 仍从响应体取 Bearer token，因为 WKWebView 与远端 API 跨站 cookie 不可靠。
  const native = isNativeRequest(req);
  if (!native) setSessionCookie(res, token, expiresAt);
  res.json({ ...(native ? { token } : {}), user: sanitizeUser(user), expiresAt, expiresIn: `${SESSION_DAYS}d`, ...extra });
}

function hashToken(token = "") {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

function findSession(db, token) {
  const memory = sessions.get(token);
  const now = Date.now();
  if (memory && (!memory.expiresAt || new Date(memory.expiresAt).getTime() > now)) return memory;
  const tokenHash = hashToken(token);
  const session = (db.authSessions || []).find((item) => item.tokenHash === tokenHash);
  if (!session || (session.expiresAt && new Date(session.expiresAt).getTime() <= now)) {
    if (session) {
      db.authSessions = (db.authSessions || []).filter((item) => item.id !== session.id);
      saveDb(db);
    }
    return null;
  }
  session.lastSeenAt = nowIso();
  sessions.set(token, session);
  return session;
}

function deleteSession(db, token) {
  const memory = sessions.get(token);
  sessions.delete(token);
  const tokenHash = hashToken(token);
  const persisted = (db.authSessions || []).find((item) => item.tokenHash === tokenHash);
  db.authSessions = (db.authSessions || []).filter((item) => item.tokenHash !== tokenHash);
  invalidateStreamTickets({ sessionId: memory?.id || persisted?.id || null });
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function getAuthToken(req) {
  return getBearerToken(req) || getCookie(req, "agent_session");
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function isNativeRequest(req) {
  const origin = String(req.headers.origin || "");
  // Origin 由 WebView/浏览器网络栈设置；不能相信页面脚本可自行伪造的 X-Native-App，
  // 否则同源 XSS 可在登录请求上加该头，让服务端把 HttpOnly 会话令牌回显到 JSON。
  return origin === "capacitor://localhost" || origin === "ionic://localhost";
}

function setSessionCookie(res, token, expiresAt) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `agent_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Expires=${new Date(expiresAt).toUTCString()}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `agent_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function setRegistrationAccessCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `registration_access=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api/public/registration; Max-Age=${7 * 24 * 3600}${secure}`);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sanitizeUser(user = {}) {
  const { password, passwordHash, passwordSalt, mfaSecretName, mfaPendingSecretName, ...safe } = user;
  return safe;
}

function ensureOwnerUser(db) {
  db.users ||= [];
  const email = ownerEmail();
  let user = db.users.find((item) => String(item.email || "").toLowerCase() === email)
    || db.users.find((item) => item.isOwner)
    || db.users.find((item) => item.id === "user_local_admin")
    || db.users[0]
    || db.user;
  if (!user) {
    user = { id: "user_local_admin", tenantId: "tenant_owner", name: "Owner", role: "管理员", status: "active", isOwner: true, createdAt: nowIso() };
    db.users.unshift(user);
  }
  Object.assign(user, {
    email,
    tenantId: "tenant_owner",
    name: user.name || "Owner",
    role: "管理员",
    status: "active",
    isOwner: true,
    updatedAt: nowIso()
  });
  db.tenants ||= [];
  const tenant = db.tenants.find((item) => item.id === "tenant_owner") || { id: "tenant_owner", createdAt: nowIso() };
  Object.assign(tenant, {
    name: tenant.name || "Owner 工作区",
    ownerUserId: user.id,
    planId: "owner",
    status: "owner",
    updatedAt: nowIso()
  });
  if (!db.tenants.includes(tenant)) db.tenants.unshift(tenant);
  db.subscriptions ||= [];
  const ownerSub = db.subscriptions.find((item) => item.id === "sub_owner")
    || db.subscriptions.find((item) => item.tenantId === "tenant_owner" || item.userId === user.id);
  const subscription = {
    tenantId: "tenant_owner",
    userId: user.id,
    planId: "owner",
    status: "active",
    source: "owner_grant",
    startedAt: ownerSub?.startedAt || nowIso(),
    currentPeriodEnd: null
  };
  if (ownerSub) Object.assign(ownerSub, subscription, { id: ownerSub.id || "sub_owner", updatedAt: nowIso() });
  else db.subscriptions.unshift({ id: "sub_owner", ...subscription });
  if (db.user) {
    Object.assign(db.user, {
      email,
      tenantId: "tenant_owner",
      role: "管理员",
      isOwner: true
    });
  }
  saveDb(db);
  return user;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, encoded = "") {
  const [, salt, hash] = String(encoded).split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}
