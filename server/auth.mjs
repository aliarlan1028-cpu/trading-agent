import crypto from "node:crypto";

const sessions = new Map();

export function authRequired() {
  if (process.env.AUTH_REQUIRED === "false") return false;
  if (!process.env.ADMIN_PASSWORD) {
    if (!warnedNoPassword) {
      console.warn("[auth] ADMIN_PASSWORD 未配置，已降级为免登录模式；生产环境请务必设置。");
      warnedNoPassword = true;
    }
    return false;
  }
  return true;
}

let warnedNoPassword = false;

export function installAuth(app, db) {
  app.post("/api/auth/login", (req, res) => {
    const password = String(req.body?.password || "");
    if (!process.env.ADMIN_PASSWORD) {
      return res.status(503).json({ error: "ADMIN_PASSWORD is not configured" });
    }
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = crypto.randomBytes(32).toString("hex");
    const user = db.users?.[0] || db.user;
    sessions.set(token, { userId: user.id, role: user.role || "管理员", createdAt: new Date().toISOString() });
    res.json({ token, user: sanitizeUser(user), expiresIn: "process_lifetime" });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = getBearerToken(req);
    if (token) sessions.delete(token);
    res.json({ ok: true });
  });

  app.use((req, res, next) => {
    if (!authRequired()) {
      req.user = db.users?.[0] || db.user;
      return next();
    }
    if (req.path === "/api/health" || req.path === "/api/auth/login") return next();
    const token = getBearerToken(req);
    const session = token ? sessions.get(token) : null;
    if (!session) return res.status(401).json({ error: "Authentication required" });
    req.user = (db.users || []).find((user) => user.id === session.userId) || db.user;
    req.session = session;
    next();
  });

  app.get("/api/users/me", (req, res) => {
    res.json({ user: sanitizeUser(req.user || db.user), authRequired: authRequired(), permissions: resolvePermissions(db, req.user || db.user) });
  });
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!authRequired()) return next();
    const db = req.app.locals.db;
    const permissions = resolvePermissions(db, req.user);
    if (permissions.includes("*") || permissions.includes(permission)) return next();
    res.status(403).json({ error: `Missing permission: ${permission}` });
  };
}

function resolvePermissions(db, user = {}) {
  const roleName = user.role || "管理员";
  const role = (db.roles || []).find((item) => item.name === roleName || item.id === user.roleId);
  return role?.permissions || [];
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function sanitizeUser(user = {}) {
  const { password, passwordHash, ...safe } = user;
  return safe;
}
