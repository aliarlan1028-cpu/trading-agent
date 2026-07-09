import crypto from "node:crypto";
import { saveDb, nowIso, id } from "./store.mjs";

const sessions = new Map();
const SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS || 30);

export function authRequired() {
  if (process.env.AUTH_REQUIRED === "false") return false;
  return true;
}

let warnedNoPassword = false;
const ownerEmail = () => String(process.env.OWNER_EMAIL || "aliarlan1028@gmail.com").trim().toLowerCase();

export function installAuth(app, db) {
  app.post("/api/auth/login", (req, res) => {
    const password = String(req.body?.password || "");
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!process.env.ADMIN_PASSWORD) {
      return res.status(503).json({ error: "ADMIN_PASSWORD is not configured" });
    }
    const user = (db.users || []).find((item) => String(item.email || "").toLowerCase() === email);
    const isOwnerEmail = email === ownerEmail();
    if (isOwnerEmail && password === process.env.ADMIN_PASSWORD) {
      const owner = ensureOwnerUser(db);
      return createSession(res, db, owner);
    }
    if (!user || user.status === "disabled" || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    return createSession(res, db, user);
  });

  app.post("/api/auth/register", (req, res) => {
    if (process.env.PUBLIC_REGISTRATION_ENABLED !== "true") {
      return res.status(403).json({ error: "Public registration is not enabled" });
    }
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const name = String(req.body?.name || email.split("@")[0] || "新用户").trim();
    const requestedPlanId = String(req.body?.planId || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Valid email is required" });
    if (password.length < 10) return res.status(400).json({ error: "Password must be at least 10 characters" });
    db.users ||= [];
    if (db.users.some((item) => String(item.email || "").toLowerCase() === email)) return res.status(409).json({ error: "Email already registered" });
    const tenantId = `tenant_${crypto.randomUUID().slice(0, 8)}`;
    const userId = `user_${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = nowIso();
    db.tenants ||= [];
    db.subscriptions ||= [];
    const tenant = { id: tenantId, name: `${name} 的工作区`, ownerUserId: userId, planId: "trial", status: "trial", createdAt };
    const user = { id: userId, tenantId, name, email, role: "交易用户", status: "active", passwordHash: hashPassword(password), createdAt };
    db.tenants.push(tenant);
    db.users.push(user);
    db.subscriptions.push({ id: `sub_${crypto.randomUUID().slice(0, 8)}`, tenantId, userId, planId: "trial", status: "trialing", source: "registration", startedAt: createdAt, currentPeriodEnd: trialEndIso(7) });
    const payment = createPendingPayment(db, { tenantId, userId, planId: requestedPlanId });
    saveDb(db);
    return createSession(res, db, user, { payment });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = getBearerToken(req);
    if (token) deleteSession(db, token);
    saveDb(db);
    res.json({ ok: true });
  });

	  app.use((req, res, next) => {
	    if (!authRequired()) {
	      req.user = db.users?.[0] || db.user;
	      return next();
	    }
	    if (req.path === "/api/health" || req.path === "/api/public/bootstrap" || req.path === "/api/auth/login" || req.path === "/api/auth/register" || req.path === "/api/payments/trc20/webhook" || req.path === "/api/stream" || req.path === "/api/market/klines") return next();
	    if (!process.env.ADMIN_PASSWORD) {
	      if (!warnedNoPassword) {
	        console.warn("[auth] ADMIN_PASSWORD 未配置，受保护 API 已锁定；设置 ADMIN_PASSWORD 或显式 AUTH_REQUIRED=false 仅用于本地开发。");
	        warnedNoPassword = true;
	      }
	      return res.status(503).json({ error: "ADMIN_PASSWORD is not configured; protected API is locked" });
	    }
	    const token = getBearerToken(req);
	    const session = token ? findSession(db, token) : null;
	    if (!session) return res.status(401).json({ error: "Authentication required" });
    req.user = (db.users || []).find((user) => user.id === session.userId) || db.user;
    req.session = session;
    req.tenantId = session.tenantId || req.user?.tenantId || "tenant_owner";
    next();
  });

  app.get("/api/users/me", (req, res) => {
    res.json({ user: sanitizeUser(req.user || db.user), authRequired: authRequired(), permissions: resolvePermissions(db, req.user || db.user) });
  });
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
  if (db) {
    db.authSessions = [];
    saveDb(db);
  }
}

function resolvePermissions(db, user = {}) {
  if (user.status === "disabled") return [];
  const roleName = user.role || "管理员";
  const role = (db.roles || []).find((item) => item.name === roleName || item.id === user.roleId);
  return role?.permissions || [];
}

function createSession(res, db, user, extra = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  const now = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  const session = {
    id: id("auth"),
    tokenHash: hashToken(token),
    userId: user.id,
    tenantId: user.tenantId || "tenant_owner",
    role: user.role || "管理员",
    createdAt: now,
    lastSeenAt: now,
    expiresAt
  };
  db.authSessions ||= [];
  db.authSessions = db.authSessions.filter((item) => item.expiresAt && new Date(item.expiresAt).getTime() > Date.now());
  db.authSessions.unshift(session);
  sessions.set(token, session);
  saveDb(db);
  res.json({ token, user: sanitizeUser(user), expiresAt, expiresIn: `${SESSION_DAYS}d`, ...extra });
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
  sessions.delete(token);
  const tokenHash = hashToken(token);
  db.authSessions = (db.authSessions || []).filter((item) => item.tokenHash !== tokenHash);
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function sanitizeUser(user = {}) {
  const { password, passwordHash, passwordSalt, ...safe } = user;
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

function trialEndIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function createPendingPayment(db, { tenantId, userId, planId }) {
  const plan = (db.subscriptionPlans || []).find((item) => item.id === planId && item.enabled !== false);
  const address = process.env.TRC20_USDT_RECEIVE_ADDRESS || db.runtimeConfig?.TRC20_USDT_RECEIVE_ADDRESS;
  if (!plan || !address || Number(plan.priceUsdt || 0) <= 0) return null;
  const payment = {
    id: id("pay"),
    tenantId,
    userId,
    planId: plan.id,
    network: "TRON",
    asset: "USDT",
    amount: Number(plan.priceUsdt || 0),
    address,
    status: "pending",
    source: "registration",
    expiresAt: trialEndIso(30),
    createdAt: nowIso()
  };
  db.paymentRequests ||= [];
  db.paymentRequests.unshift(payment);
  return payment;
}
