export const TRUSTED_REVERSE_PROXY_RANGES = ["loopback", "linklocal", "uniquelocal"];

function localHealthHost(request = {}) {
  const rawHost = String(request.headers?.host || request.hostname || "").trim().toLowerCase();
  if (!rawHost) return false;
  if (rawHost.startsWith("[::1]")) return true;
  const hostname = rawHost.split(":", 1)[0];
  return hostname === "localhost" || hostname === "127.0.0.1";
}

export function transportSecurityPolicy(request = {}, env = process.env) {
  const production = env.NODE_ENV === "production";
  const secure = request.secure === true || String(request.protocol || "").toLowerCase() === "https";
  if (!production || secure) return { allowed: true, secure, label: secure ? "encrypted" : "development_http" };
  const path = String(request.path || request.url || "");
  const remote = String(request.ip || request.socket?.remoteAddress || "");
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  // Docker port forwarding rewrites the source to the bridge gateway, so the
  // host-side deploy probe is no longer observed as loopback inside the
  // container. Its Host header remains explicitly local; only the harmless
  // health route receives this exception. All other production HTTP requests
  // continue to fail closed.
  if (path === "/api/health" && (loopback || localHealthHost(request))) {
    return { allowed: true, secure: false, label: "local_health_exception" };
  }
  return { allowed: false, secure: false, status: 426, error: "https_required" };
}
