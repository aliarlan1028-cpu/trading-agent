export function normalizeAuthMode(value) {
  return value === "login" || value === "subscribe" ? value : "";
}

export function authIntentFromSearch(search) {
  return normalizeAuthMode(new URLSearchParams(search).get("auth"));
}

export function dispatchMarketingAuth({ mode, topLevel, origin, navigate, postMessage }) {
  const authMode = normalizeAuthMode(mode);
  if (!authMode) return;
  if (topLevel) {
    navigate(`/app?auth=${authMode}`);
    return;
  }
  postMessage({ type: "lp-start", mode: authMode }, origin);
}
