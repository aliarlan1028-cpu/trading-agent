export function connectionSecurityStatus(value, options = {}) {
  const raw = String(value || "").trim();
  if (!raw && typeof window !== "undefined") {
    const local = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    const localException = local && options.allowLocalDevelopment === true;
    return window.location.protocol === "https:"
      ? { secure: true, allowed: true, protocol: "https" }
      : { secure: false, allowed: localException, protocol: window.location.protocol.replace(":", "") || "unknown", reason: localException ? "local_development_exception" : "https_required" };
  }
  let url;
  try { url = new URL(raw); } catch { return { secure: false, allowed: false, protocol: "invalid", reason: "invalid_backend_url" }; }
  if (url.protocol === "https:") return { secure: true, allowed: true, protocol: "https" };
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const localException = local && options.allowLocalDevelopment === true;
  return {
    secure: false,
    allowed: localException,
    protocol: url.protocol.replace(":", "") || "unknown",
    reason: localException ? "local_development_exception" : "https_required"
  };
}

export function shouldAttemptNativeFallback({ current, error, native, activeBase, fallbackBase } = {}) {
  if (current !== true || error?.name === "AbortError" || error?.code === "request_cancelled") return false;
  return native === true && String(activeBase || "") !== String(fallbackBase || "");
}
