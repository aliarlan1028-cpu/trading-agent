const APP_TRADE_ROOT = "/app/trade";

const ROUTE_PATHS = Object.freeze({
  cockpit: `${APP_TRADE_ROOT}/overview`,
  market: `${APP_TRADE_ROOT}/market`,
  positions: `${APP_TRADE_ROOT}/positions`,
  tradeJournal: `${APP_TRADE_ROOT}/execution-review`,
  tradeLedger: `${APP_TRADE_ROOT}/orders-fills`
});

const PATH_ROUTES = new Map(Object.entries(ROUTE_PATHS).map(([route, path]) => [path, route]));

const normalizePath = (pathname = "") => {
  const clean = String(pathname || "").split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return clean || "/";
};

const reviewIdentity = (route = "") => {
  const value = String(route || "");
  if (!value.startsWith("tradeReviewDetail:")) return null;
  const identity = value.slice("tradeReviewDetail:".length).trim();
  return identity || null;
};

export function cockpitPathForRoute(route = "") {
  const identity = reviewIdentity(route);
  if (identity) return `${APP_TRADE_ROOT}/reviews/${encodeURIComponent(identity)}`;
  return ROUTE_PATHS[String(route || "").trim()] || null;
}

export function cockpitRouteFromPath(pathname = "") {
  const path = normalizePath(pathname);
  const reviewPrefix = `${APP_TRADE_ROOT}/reviews/`;
  if (path.startsWith(reviewPrefix)) {
    const encoded = path.slice(reviewPrefix.length);
    if (!encoded) return null;
    try {
      const identity = decodeURIComponent(encoded).trim();
      return identity ? `tradeReviewDetail:${identity}` : null;
    } catch {
      return null;
    }
  }
  return PATH_ROUTES.get(path) || null;
}

export function syncCockpitHistory(route, {
  history = globalThis.history,
  location = globalThis.location,
  mode = "push"
} = {}) {
  const path = cockpitPathForRoute(route);
  if (!path || !history || !location || mode === "none") return false;
  if (location.protocol === "capacitor:" || globalThis.document?.documentElement?.classList?.contains("nativeApp")) return false;
  const href = `${path}${location.search || ""}${location.hash || ""}`;
  const current = `${location.pathname || ""}${location.search || ""}${location.hash || ""}`;
  if (href === current) return false;
  const method = mode === "replace" ? "replaceState" : "pushState";
  if (typeof history[method] !== "function") return false;
  history[method]({ ...(history.state || {}), kordynRoute: String(route || "") }, "", href);
  return true;
}
