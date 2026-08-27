import { resolveDesktopRoute, resolveMobileRoute } from "../../productArchitecture.js";
import { KORDYN_V2_WORKSPACES } from "./domains.js";
import { registerAiSupportLocation } from "../viewModels/aiSupportProjection.js";

const DEFAULT_DOMAIN_ID = "ai";
const DEFAULT_WORKSPACE_ID = "missions";
const VALID_DEVICES = new Set(["desktop", "mobile"]);

const workspaceFor = (domainId, workspaceId) => {
  if (!Object.hasOwn(KORDYN_V2_WORKSPACES, domainId)) return null;
  return KORDYN_V2_WORKSPACES[domainId].find((row) => row.id === workspaceId) || null;
};

const locationFor = (domainId, workspaceId, device, recognized) => {
  const workspace = workspaceFor(domainId, workspaceId);
  if (!workspace) return DEFAULT_LOCATION;
  const resolved = device === "mobile"
    ? resolveMobileRoute(workspace.legacyRoute)
    : resolveDesktopRoute(workspace.legacyRoute);
  return registerAiSupportLocation(Object.freeze({
    domainId,
    workspaceId,
    legacyRoute: workspace.legacyRoute,
    resourceSection: resolved.section,
    objectId: resolved.objectId,
    recognized
  }));
};

const DEFAULT_LOCATION = registerAiSupportLocation(Object.freeze({
  domainId: DEFAULT_DOMAIN_ID,
  workspaceId: DEFAULT_WORKSPACE_ID,
  legacyRoute: "chat",
  resourceSection: "chat",
  objectId: "",
  recognized: false
}));

const V2_LOCATION_BY_ROUTE = Object.freeze({
  chat: Object.freeze({ domainId: "ai", workspaceId: "dialog" }),
  intelligence: Object.freeze({ domainId: "ai", workspaceId: "intelligence" }),
  watch: Object.freeze({ domainId: "ai", workspaceId: "watch" }),
  "eventsTasks:events": Object.freeze({ domainId: "ai", workspaceId: "events" }),
  market: Object.freeze({ domainId: "account", workspaceId: "market" }),
  marketAccount: Object.freeze({ domainId: "account", workspaceId: "account" }),
  positions: Object.freeze({ domainId: "account", workspaceId: "positions" }),
  executionReview: Object.freeze({ domainId: "account", workspaceId: "plans" }),
  tradeLedger: Object.freeze({ domainId: "account", workspaceId: "orders" }),
  labMap: Object.freeze({ domainId: "assets", workspaceId: "relationships" }),
  strategyLib: Object.freeze({ domainId: "assets", workspaceId: "strategies" }),
  knowledgeBase: Object.freeze({ domainId: "assets", workspaceId: "knowledge" }),
  capabilityLib: Object.freeze({ domainId: "assets", workspaceId: "capabilities" }),
  labReviews: Object.freeze({ domainId: "assets", workspaceId: "reviews" }),
  riskOverview: Object.freeze({ domainId: "governance", workspaceId: "overview" }),
  "operationsCenter:tasks": Object.freeze({ domainId: "governance", workspaceId: "runs" }),
  eventRisk: Object.freeze({ domainId: "governance", workspaceId: "event-inputs" }),
  "operationsCenter:notifications": Object.freeze({ domainId: "governance", workspaceId: "notifications" }),
  "operationsCenter:audit": Object.freeze({ domainId: "governance", workspaceId: "audit" }),
  "operationsCenter:recovery": Object.freeze({ domainId: "governance", workspaceId: "recovery" }),
  systemSettings: Object.freeze({ domainId: "governance", workspaceId: "configuration" })
});

export function v2LocationForWorkspace(domainId, workspaceId, device = "desktop") {
  if (!VALID_DEVICES.has(device) || !workspaceFor(domainId, workspaceId)) return DEFAULT_LOCATION;
  return locationFor(domainId, workspaceId, device, true);
}

export function resolveV2Location(route, device = "desktop") {
  if (!VALID_DEVICES.has(device)) return DEFAULT_LOCATION;
  const requestedRoute = typeof route === "string" ? route.trim() : "";
  const destination = Object.hasOwn(V2_LOCATION_BY_ROUTE, requestedRoute)
    ? V2_LOCATION_BY_ROUTE[requestedRoute]
    : null;
  if (!destination) return DEFAULT_LOCATION;
  return locationFor(destination.domainId, destination.workspaceId, device, true);
}
