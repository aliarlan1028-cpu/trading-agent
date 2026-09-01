import { ACCOUNT_CAPABILITY_SURFACES } from "../domains/account/capabilitySurfaces.js";
import { AI_CAPABILITY_SURFACES } from "../domains/ai/capabilitySurfaces.js";
import { ASSET_CAPABILITY_SURFACES } from "../domains/assets/capabilitySurfaces.js";
import { GOVERNANCE_CAPABILITY_SURFACES } from "../domains/governance/capabilitySurfaces.js";

const objects = (...types) => Object.freeze(types);

const CAPABILITY_OBJECTS = Object.freeze({
  "ai.dialog": objects("Mission"),
  "ai.autonomous-patrol": objects("Mission", "Agent run"),
  "ai.intelligence": objects("Signal", "Event"),
  "ai.watch": objects("Watch"),
  "ai.events": objects("Event"),
  "ai.poster-current": objects("Mission"),
  "ai.poster-translate": objects("Mission"),
  "ai.poster-png": objects("Mission"),

  "live.overview": objects("Account"),
  "live.market": objects("Market"),
  "live.account": objects("Account"),
  "live.positions": objects("Position"),
  "live.execution": objects("Plan", "Order"),
  "live.orders": objects("Order"),
  "live.fills": objects("Fill"),
  "live.protection": objects("Position", "Order"),
  "live.reconcile-status": objects("Account", "Recovery record"),
  "live.review-status": objects("Review"),
  "live.closed-trade-poster": objects("Fill", "Review"),

  "lab.research-map": objects("Mission", "Strategy product", "Strategy", "Knowledge source", "Capability", "Review", "Owner candidate"),
  "lab.knowledge-import": objects("Knowledge source"),
  "lab.knowledge-evidence": objects("Knowledge source", "Evidence"),
  "lab.knowledge-graph": objects("Knowledge source", "Evidence"),
  "lab.knowledge-artifacts": objects("Knowledge source", "Evidence"),
  "lab.knowledge-workflows": objects("Knowledge source", "Capability"),
  "lab.strategy-core": objects("Strategy product", "Strategy"),
  "lab.strategy-studio": objects("Strategy", "Validation run"),
  "lab.strategy-knowledge": objects("Strategy product", "Knowledge source"),
  "lab.strategy-imported": objects("Strategy product"),
  "lab.strategy-adaptive": objects("Strategy product", "Owner candidate", "Validation run"),
  "lab.capability-native": objects("Capability"),
  "lab.capability-workflow": objects("Capability", "Knowledge source"),
  "lab.capability-imported-skill": objects("Capability"),
  "lab.capability-mcp": objects("Capability"),
  "lab.capability-connectors": objects("Capability"),
  "lab.trade-review": objects("Review", "Fill", "Evidence"),
  "lab.owner-review": objects("Owner candidate", "Review", "Validation run"),

  "control.risk-posture": objects("Risk rule", "Risk incident"),
  "control.operating-mode": objects("Configuration item"),
  "control.mandate-context": objects("Mandate"),
  "control.rule-monitor": objects("Risk rule"),
  "control.event-risk": objects("Event"),
  "control.permission-boundaries": objects("Mandate"),
  "operations.runtime-health": objects("Configuration item"),
  "operations.tasks": objects("Task"),
  "operations.task-runs": objects("Agent run"),
  "operations.event-input-health": objects("Event source"),
  "operations.notifications": objects("Notification"),
  "operations.audit": objects("Audit log"),
  "operations.reconcile": objects("Recovery record"),
  "operations.recovery": objects("Recovery record", "Risk incident"),

  "configuration.operating-mode": objects("Configuration item"),
  "configuration.mandate": objects("Mandate", "Configuration item"),
  "configuration.risk-rules": objects("Risk rule", "Configuration item"),
  "configuration.environment": objects("Configuration item"),
  "configuration.network": objects("Configuration item"),
  "configuration.backup": objects("Configuration item", "Recovery record"),
  "configuration.security": objects("Configuration item"),
  "configuration.exchange": objects("Account", "Configuration item"),
  "configuration.event-sources": objects("Event source", "Configuration item"),
  "configuration.notifications": objects("Configuration item"),
  "configuration.models": objects("Configuration item"),
  "configuration.agents": objects("Configuration item"),
  "configuration.users": objects("Configuration item"),
  "configuration.subscriptions": objects("Configuration item"),
  "configuration.account-profile": objects("Account", "Configuration item")
});

const sources = [
  AI_CAPABILITY_SURFACES,
  ACCOUNT_CAPABILITY_SURFACES,
  ASSET_CAPABILITY_SURFACES,
  GOVERNANCE_CAPABILITY_SURFACES
];
const entries = sources.flatMap((registry) => Object.entries(registry));
if (new Set(entries.map(([id]) => id)).size !== entries.length) {
  throw new Error("duplicate_v2_capability_surface");
}

export const KORDYN_V2_CAPABILITY_SURFACES = Object.freeze(Object.fromEntries(entries.map(([id, source]) => {
  const declaredObjects = CAPABILITY_OBJECTS[id];
  if (!declaredObjects) throw new Error(`missing_v2_capability_object_contract:${id}`);
  return [id, Object.freeze({
    ...source,
    route: Object.freeze({
      domainId: source.domainId,
      workspaceId: source.workspaceId,
      legacyRoute: source.route
    }),
    objects: declaredObjects,
    viewOnly: declaredObjects.length === 0
  })];
})));
