export function transportSecurityPolicy(request = {}, env = process.env) {
  const production = env.NODE_ENV === "production";
  const secure = request.secure === true || String(request.protocol || "").toLowerCase() === "https";
  if (!production || secure) return { allowed: true, secure, label: secure ? "encrypted" : "development_http" };
  const path = String(request.path || request.url || "");
  const remote = String(request.ip || request.socket?.remoteAddress || "");
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (path === "/api/health" && loopback) return { allowed: true, secure: false, label: "local_health_exception" };
  return { allowed: false, secure: false, status: 426, error: "https_required" };
}
