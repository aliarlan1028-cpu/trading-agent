const APP_ROOT = "/app";

const routeRecord = (route, path, aliases = []) => Object.freeze({ route, path: `${APP_ROOT}/${path}`, aliases });

const APP_ROUTE_RECORDS = Object.freeze([
  routeRecord("chat", "ai/dialog", ["today"]),
  routeRecord("chat:patrol", "ai/patrol", ["patrol"]),
  routeRecord("chat:poster", "ai/poster", ["poster"]),
  routeRecord("chat:intelligence", "ai/intelligence", ["intelligence"]),
  routeRecord("watch", "ai/watch"),

  routeRecord("cockpit", "trade/overview"),
  routeRecord("market", "trade/market"),
  routeRecord("marketAccount", "trade/account"),
  routeRecord("positions", "trade/positions"),
  routeRecord("portfolioProtection", "trade/protection"),
  routeRecord("tradeJournal", "trade/execution-review", ["signalHub", "executionReview", "ownerReviewWorkspace"]),
  routeRecord("tradeLedger", "trade/orders-fills"),
  routeRecord("tradeOrders", "trade/orders"),
  routeRecord("tradeFills", "trade/fills"),
  routeRecord("labReviews", "trade/reviews", ["tradeReviewDetail"]),

  routeRecord("researchCenter", "research/overview", ["labMap", "researchCenter:map"]),
  routeRecord("knowledgeBase", "research/knowledge", ["researchCenter:knowledge"]),
  routeRecord("strategyLib", "research/strategies", ["researchCenter:strategy", "strategyAnalysis", "analysisRoom", "strategyWorkbench"]),
  routeRecord("strategyStudio", "research/strategies/studio", ["strategyLib:studio"]),
  routeRecord("strategyMarket", "research/strategies/market", ["strategyLib:market"]),
  routeRecord("strategyResearch", "research/strategies/backtests", ["strategyLib:research"]),
  routeRecord("capabilities", "research/capabilities", ["researchCenter:capabilities", "capabilityLib"]),
  routeRecord("riskOverview", "risk/overview", ["riskCenter", "riskCenter:posture", "riskHub"]),
  routeRecord("eventRisk", "risk/events"),
  routeRecord("riskMandate", "risk/boundaries", ["riskCenter:mandate", "systemSettings:trading"]),
  routeRecord("riskSettings", "risk/rules", ["riskCenter:rules", "systemSettings:risk"]),
  routeRecord("riskKeys", "risk/key-security", ["riskCenter:keys"]),

  routeRecord("operationsCenter", "operations/overview", ["operationsCenter:overview", "operationsCenter:recovery"]),
  routeRecord("eventsTasks:events", "operations/events", ["eventsTasks"]),
  routeRecord("eventsTasks:tasks", "operations/tasks", ["operationsCenter:tasks"]),
  routeRecord("auditSystem", "operations/audit", ["operationsCenter:audit"]),
  routeRecord("notifications", "operations/notifications", ["operationsCenter:notifications"]),

  routeRecord("systemSettings", "settings/overview", ["systemSettings:overview"]),
  routeRecord("systemSettings:base", "settings/basics", ["settings:environment"]),
  routeRecord("systemSettings:runtime", "settings/runtime", ["settings:runtime"]),
  routeRecord("systemSettings:base:proxy", "settings/network", ["settings:network"]),
  routeRecord("systemSettings:base:backup", "settings/data-backup", ["settings:data_backup"]),
  routeRecord("systemSettings:base:security", "settings/security", ["riskCenter:security", "settings:security"]),
  routeRecord("systemSettings:exchange", "settings/exchanges", ["settings:exchange"]),
  routeRecord("systemSettings:notifications", "settings/notifications", ["systemSettings:base:notifications", "settings:notifications", "settings:integrations"]),
  routeRecord("systemSettings:event-sources", "settings/event-sources", ["settings:event_sources"]),
  routeRecord("systemSettings:models", "settings/models", ["settings:llm", "settings:models"]),
  routeRecord("systemSettings:agents", "settings/agents", ["settings:agents"]),
  routeRecord("systemSettings:users", "settings/users", ["settings:users", "admin"])
]);

const recordByRoute = new Map();
const recordByPath = new Map();
for (const record of APP_ROUTE_RECORDS) {
  recordByPath.set(record.path, record);
  for (const alias of [record.route, ...record.aliases]) recordByRoute.set(alias, record);
}

const normalizePath = (pathname = "") => {
  const clean = String(pathname || "").split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return clean || "/";
};

export function appPathForRoute(requestedRoute = "chat") {
  const route = String(requestedRoute || "chat").trim() || "chat";
  if (route.startsWith("tradeReviewDetail:")) {
    const objectId = route.slice("tradeReviewDetail:".length);
    return objectId ? `${APP_ROOT}/trade/reviews/${encodeURIComponent(objectId)}` : `${APP_ROOT}/trade/reviews`;
  }
  return (recordByRoute.get(route) || recordByRoute.get("chat")).path;
}

export function appRouteFromPath(pathname = "") {
  const path = normalizePath(pathname);
  if (path === APP_ROOT) return "chat";
  const reviewPrefix = `${APP_ROOT}/trade/reviews/`;
  if (path.startsWith(reviewPrefix)) {
    try {
      const objectId = decodeURIComponent(path.slice(reviewPrefix.length));
      return objectId ? `tradeReviewDetail:${objectId}` : "tradeReviewDetail";
    } catch {
      return null;
    }
  }
  return recordByPath.get(path)?.route || null;
}

export function appHrefForRoute(requestedRoute, location = globalThis.location) {
  const search = location?.search || "";
  const hash = location?.hash || "";
  return `${appPathForRoute(requestedRoute)}${search}${hash}`;
}

export function syncAppHistory(requestedRoute, {
  history = globalThis.history,
  location = globalThis.location,
  mode = "push"
} = {}) {
  if (!history || !location || mode === "none") return false;
  if (location.protocol === "capacitor:" || globalThis.document?.documentElement?.classList?.contains("nativeApp")) return false;
  const href = appHrefForRoute(requestedRoute, location);
  const currentHref = `${location.pathname || ""}${location.search || ""}${location.hash || ""}`;
  if (currentHref === href) return false;
  const method = mode === "replace" ? "replaceState" : "pushState";
  if (typeof history[method] !== "function") return false;
  history[method]({ ...(history.state || {}), kordynRoute: String(requestedRoute || "chat") }, "", href);
  return true;
}
