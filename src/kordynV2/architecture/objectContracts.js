const frozenList = (...values) => Object.freeze(values);

const contract = ({
  canonicalType,
  identity,
  domainId,
  workspaceId,
  collections,
  locations
}) => Object.freeze({
  canonicalType,
  identity,
  domainId,
  workspaceId,
  collections: Object.freeze([...collections]),
  locations: Object.freeze(locations.map((location) => Object.freeze({ ...location }))),
  selectionUpdates: frozenList("object", "context", "proof"),
  failClosed: true
});

export const KORDYN_V2_REQUIRED_OBJECT_TYPES = frozenList(
  "Mission", "Signal", "Market", "Account", "Position", "Plan", "Order", "Fill",
  "Event", "Event source", "Watch", "Strategy product", "Strategy", "Knowledge source",
  "Evidence", "Capability", "Validation run", "Review", "Owner candidate", "Mandate",
  "Risk rule", "Risk incident", "Task", "Agent run", "Notification", "Audit log",
  "Recovery record", "Configuration item"
);

export const KORDYN_V2_CONFIGURATION_ITEM_IDS = frozenList(
  "trading", "risk", "environment", "network", "backup", "security", "exchange",
  "event-sources", "notifications", "models", "agents", "users", "account"
);

export const KORDYN_V2_OBJECT_CONTRACTS = Object.freeze({
  Mission: contract({
    canonicalType: "Agent run",
    identity: "Mission is the product-language projection of one uniquely resolved agentRuns row",
    domainId: "ai",
    workspaceId: "missions",
    collections: ["agentRuns"],
    locations: [{ domainId: "ai", workspaceId: "missions" }]
  }),
  Signal: contract({
    canonicalType: "Signal",
    identity: "Signal by a unique trusted intelligence fact id",
    domainId: "ai",
    workspaceId: "intelligence",
    collections: ["intelligence", "signals", "events"],
    locations: [{ domainId: "ai", workspaceId: "intelligence" }]
  }),
  Market: contract({
    canonicalType: "Market",
    identity: "Market by one bounded market symbol/id from the loaded account model",
    domainId: "account",
    workspaceId: "market",
    collections: ["markets"],
    locations: [{ domainId: "account", workspaceId: "market" }]
  }),
  Account: contract({
    canonicalType: "Account",
    identity: "Account by one valid and unique exchangeAccounts[].id",
    domainId: "account",
    workspaceId: "account",
    collections: ["exchangeAccounts"],
    locations: [{ domainId: "account", workspaceId: "account" }]
  }),
  Position: contract({
    canonicalType: "Position",
    identity: "Position by id → positionId → instId → symbol precedence with exactly one match",
    domainId: "account",
    workspaceId: "positions",
    collections: ["positions"],
    locations: [{ domainId: "account", workspaceId: "positions" }]
  }),
  Plan: contract({
    canonicalType: "Trade plan",
    identity: "Plan is the product-language projection of one uniquely resolved tradePlans row",
    domainId: "account",
    workspaceId: "plans",
    collections: ["tradePlans"],
    locations: [{ domainId: "account", workspaceId: "plans" }]
  }),
  Order: contract({
    canonicalType: "Order",
    identity: "Order by one unique id/orderId without collapsing exchange acceptance into a fill",
    domainId: "account",
    workspaceId: "orders",
    collections: ["orders"],
    locations: [{ domainId: "account", workspaceId: "orders" }]
  }),
  Fill: contract({
    canonicalType: "Fill",
    identity: "Fill by one unique id/tradeId with explicit order and lifecycle linkage",
    domainId: "account",
    workspaceId: "fills",
    collections: ["fills"],
    locations: [{ domainId: "account", workspaceId: "fills" }, { domainId: "assets", workspaceId: "reviews" }]
  }),
  Event: contract({
    canonicalType: "Event",
    identity: "Event by one unique formed event id; calendar facts and risk windows remain distinct sources",
    domainId: "ai",
    workspaceId: "events",
    collections: ["events", "eventRiskWindows"],
    locations: [{ domainId: "ai", workspaceId: "events" }, { domainId: "governance", workspaceId: "event-inputs" }]
  }),
  "Event source": contract({
    canonicalType: "Event source",
    identity: "Event source by one persisted id/sourceId",
    domainId: "governance",
    workspaceId: "event-inputs",
    collections: ["eventSources"],
    locations: [{ domainId: "governance", workspaceId: "event-inputs" }, { domainId: "governance", workspaceId: "configuration" }]
  }),
  Watch: contract({
    canonicalType: "Watch",
    identity: "Watch by one persisted watchTriggers[].id",
    domainId: "ai",
    workspaceId: "watch",
    collections: ["watchTriggers"],
    locations: [{ domainId: "ai", workspaceId: "watch" }]
  }),
  "Strategy product": contract({
    canonicalType: "Strategy product",
    identity: "Strategy product by the unique released product/version identity returned by the strategy catalog",
    domainId: "assets",
    workspaceId: "strategies",
    collections: ["strategyProducts", "strategyCatalog"],
    locations: [{ domainId: "assets", workspaceId: "relationships" }, { domainId: "assets", workspaceId: "strategies" }]
  }),
  Strategy: contract({
    canonicalType: "Strategy",
    identity: "Strategy by the unique system-native, imported, or research strategy registry id",
    domainId: "assets",
    workspaceId: "strategies",
    collections: ["strategies", "strategyCatalog"],
    locations: [{ domainId: "assets", workspaceId: "relationships" }, { domainId: "assets", workspaceId: "strategies" }]
  }),
  "Knowledge source": contract({
    canonicalType: "Knowledge",
    identity: "Knowledge source by one immutable knowledge.sources id/url identity",
    domainId: "assets",
    workspaceId: "knowledge",
    collections: ["knowledge.sources"],
    locations: [{ domainId: "assets", workspaceId: "relationships" }, { domainId: "assets", workspaceId: "knowledge" }]
  }),
  Evidence: contract({
    canonicalType: "Evidence",
    identity: "Evidence by one immutable chunk id plus sourceId and source location",
    domainId: "assets",
    workspaceId: "knowledge",
    collections: ["knowledge.chunks"],
    locations: [{ domainId: "assets", workspaceId: "knowledge" }, { domainId: "assets", workspaceId: "reviews" }]
  }),
  Capability: contract({
    canonicalType: "Capability",
    identity: "Capability by one code-registered or governed registry id",
    domainId: "assets",
    workspaceId: "capabilities",
    collections: ["capabilities", "skills", "mcpServers", "connectors"],
    locations: [{ domainId: "assets", workspaceId: "relationships" }, { domainId: "assets", workspaceId: "capabilities" }]
  }),
  "Validation run": contract({
    canonicalType: "Validation run",
    identity: "Validation run by one immutable backtest or historical-validation id",
    domainId: "assets",
    workspaceId: "reviews",
    collections: ["backtestResearch.historical", "backtests"],
    locations: [{ domainId: "assets", workspaceId: "strategies" }, { domainId: "assets", workspaceId: "reviews" }]
  }),
  Review: contract({
    canonicalType: "Review",
    identity: "Review by one explicit review id linked to a financially reconciled lifecycle",
    domainId: "assets",
    workspaceId: "reviews",
    collections: ["reviews"],
    locations: [{ domainId: "account", workspaceId: "fills" }, { domainId: "assets", workspaceId: "reviews" }]
  }),
  "Owner candidate": contract({
    canonicalType: "Owner candidate",
    identity: "Owner candidate by one improvement id linked to review evidence and immutable version",
    domainId: "assets",
    workspaceId: "reviews",
    collections: ["ownerReviewLoop.improvements"],
    locations: [{ domainId: "assets", workspaceId: "relationships" }, { domainId: "assets", workspaceId: "reviews" }]
  }),
  Mandate: contract({
    canonicalType: "Mandate",
    identity: "Mandate by one immutable mandate id and revision",
    domainId: "governance",
    workspaceId: "overview",
    collections: ["mandates"],
    locations: [{ domainId: "governance", workspaceId: "overview" }, { domainId: "governance", workspaceId: "configuration" }]
  }),
  "Risk rule": contract({
    canonicalType: "Risk check",
    identity: "Risk rule is selected through one unique persisted ruleId/evaluation id without merging configured and effective state",
    domainId: "governance",
    workspaceId: "overview",
    collections: ["riskChecks", "riskRules"],
    locations: [{ domainId: "governance", workspaceId: "overview" }, { domainId: "governance", workspaceId: "configuration" }]
  }),
  "Risk incident": contract({
    canonicalType: "Risk incident",
    identity: "Risk incident by one persisted incident id",
    domainId: "governance",
    workspaceId: "recovery",
    collections: ["riskIncidents"],
    locations: [{ domainId: "governance", workspaceId: "overview" }, { domainId: "governance", workspaceId: "recovery" }]
  }),
  Task: contract({
    canonicalType: "Task",
    identity: "Task by one persisted task id; definition ownership and current run stay separate",
    domainId: "governance",
    workspaceId: "runs",
    collections: ["tasks"],
    locations: [{ domainId: "governance", workspaceId: "runs" }]
  }),
  "Agent run": contract({
    canonicalType: "Agent run",
    identity: "Agent/System run by one persisted agentRuns/jobRuns id",
    domainId: "ai",
    workspaceId: "missions",
    collections: ["agentRuns", "jobRuns"],
    locations: [{ domainId: "ai", workspaceId: "missions" }, { domainId: "governance", workspaceId: "runs" }]
  }),
  Notification: contract({
    canonicalType: "Notification",
    identity: "Notification by one persisted delivery-record id",
    domainId: "governance",
    workspaceId: "notifications",
    collections: ["notifications"],
    locations: [{ domainId: "governance", workspaceId: "notifications" }]
  }),
  "Audit log": contract({
    canonicalType: "Audit log",
    identity: "Audit log by one immutable audit id",
    domainId: "governance",
    workspaceId: "audit",
    collections: ["auditLogs"],
    locations: [{ domainId: "governance", workspaceId: "overview" }, { domainId: "governance", workspaceId: "audit" }]
  }),
  "Recovery record": contract({
    canonicalType: "Recovery",
    identity: "Recovery record by one persisted reconciliation or recovery id",
    domainId: "governance",
    workspaceId: "recovery",
    collections: ["reconciliationReports", "recoveryRecords"],
    locations: [{ domainId: "governance", workspaceId: "runs" }, { domainId: "governance", workspaceId: "recovery" }]
  }),
  "Configuration item": contract({
    canonicalType: "Configuration item",
    identity: "Configuration item by one declared configuration scope id; selected target and effective value remain separate",
    domainId: "governance",
    workspaceId: "configuration",
    collections: ["configuration.scopes"],
    locations: [{ domainId: "governance", workspaceId: "configuration" }]
  })
});

const READY_SOURCE_STATES = new Set(["loaded", "ready"]);

export function resolveV2DeclaredObject(data = {}, candidate = null) {
  let id;
  let type;
  let workspaceId;
  try {
    id = typeof candidate?.id === "string" ? candidate.id.trim() : "";
    type = candidate?.type;
    workspaceId = candidate?.workspaceId;
  } catch {
    return null;
  }
  if (type !== "Configuration item" || !KORDYN_V2_CONFIGURATION_ITEM_IDS.includes(id)) return null;
  if (workspaceId && workspaceId !== "governance") return null;
  const sourceState = String(data?.resourceState?.systemSettings || "").toLowerCase();
  if (!READY_SOURCE_STATES.has(sourceState)) return null;
  return Object.freeze({
    id,
    type,
    title: `Configuration / ${id}`,
    status: "available",
    route: "systemSettings",
    workspaceId: "governance",
    sourceSection: "systemSettings",
    sourceState,
    source: "Declared V2 configuration scope registry",
    version: "Unavailable",
    permission: "server-authoritative RBAC",
    risk: "configuration change requires preflight and confirmation",
    evidence: id,
    nextAction: "Inspect selected and effective configuration",
    raw: Object.freeze({ id, objectType: type, status: "available" })
  });
}
