const APP_TRADE_ROOT = "/app/trade";

const ROUTE_PATHS = Object.freeze({
  cockpit: `${APP_TRADE_ROOT}/overview`,
  marketAccount: `${APP_TRADE_ROOT}/overview`,
  market: `${APP_TRADE_ROOT}/market`,
  positions: `${APP_TRADE_ROOT}/positions`,
  portfolioProtection: `${APP_TRADE_ROOT}/positions`,
  signalHub: `${APP_TRADE_ROOT}/execution-review`,
  tradeJournal: `${APP_TRADE_ROOT}/execution-review`,
  executionReview: `${APP_TRADE_ROOT}/execution-review`,
  tradeReviewDetail: `${APP_TRADE_ROOT}/execution-review`,
  labReviews: `${APP_TRADE_ROOT}/execution-review`,
  ownerReviewWorkspace: `${APP_TRADE_ROOT}/execution-review`,
  tradeLedger: `${APP_TRADE_ROOT}/orders-fills`,
  tradeOrders: `${APP_TRADE_ROOT}/orders-fills`,
  tradeFills: `${APP_TRADE_ROOT}/orders-fills`
});

const PATH_ROUTES = new Map([
  [`${APP_TRADE_ROOT}/overview`, "cockpit"],
  [`${APP_TRADE_ROOT}/market`, "market"],
  [`${APP_TRADE_ROOT}/positions`, "positions"],
  [`${APP_TRADE_ROOT}/execution-review`, "tradeJournal"],
  [`${APP_TRADE_ROOT}/orders-fills`, "tradeLedger"]
]);

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

const historyRouteToken = (value) => typeof value === "string"
  && value.trim() === value
  && /^[A-Za-z][A-Za-z0-9:_-]*$/.test(value);

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

export function cockpitRouteFromHistory(pathname = "", state = null, { isRecognizedRoute } = {}) {
  const cockpitRoute = cockpitRouteFromPath(pathname);
  if (cockpitRoute) return cockpitRoute;
  if (normalizePath(pathname) !== "/app") return null;
  const stateRoute = state?.kordynRoute;
  if (!historyRouteToken(stateRoute) || cockpitPathForRoute(stateRoute)) return "chat";
  return typeof isRecognizedRoute === "function" && isRecognizedRoute(stateRoute) ? stateRoute : "chat";
}

export function syncCockpitHistory(route, {
  history = globalThis.history,
  location = globalThis.location,
  mode = "push"
} = {}) {
  const currentPath = normalizePath(location?.pathname);
  const currentCockpitRoute = cockpitRouteFromPath(currentPath);
  if (currentPath !== "/app" && !currentCockpitRoute) return false;
  let path = cockpitPathForRoute(route);
  if (!path && currentCockpitRoute && historyRouteToken(route)) path = "/app";
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
