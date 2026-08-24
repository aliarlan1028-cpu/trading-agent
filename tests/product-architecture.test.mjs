import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCEPTED_RESOURCE_SECTIONS,
  CONFIGURATION_WORKSPACE,
  PRIMARY_WORKSPACE_IDS,
  WORKSPACES,
  productWorkspaceForRuntimeSection,
  resolveDesktopRoute,
  resolveMobileRoute,
  resolveProductRoute
} from "../src/productArchitecture.js";
import { DEPLOYED_FEATURES, REALITY_BOUNDARIES, featureById, featuresForWorkspace } from "../src/productCoverage.js";

test("primary navigation has five workspaces and a separate configuration utility", () => {
  assert.deepEqual(PRIMARY_WORKSPACE_IDS, ["ai", "live", "lab", "control", "operations"]);
  assert.deepEqual(PRIMARY_WORKSPACE_IDS.map((id) => WORKSPACES[id].labelEn), ["AI Trader", "Live Desk", "Lab", "Control", "Operations"]);
  assert.equal(CONFIGURATION_WORKSPACE.id, "configuration");
  assert.equal(CONFIGURATION_WORKSPACE.primaryNavigation, false);
  assert.deepEqual(ACCEPTED_RESOURCE_SECTIONS, ["chat", "cockpit", "researchCenter", "riskCenter", "operationsCenter", "systemSettings"]);
});

const desktopCases = [
  ["chat", "ai", "dialog", "chat", "dialog"],
  ["chat:intelligence", "ai", "intelligence", "chat", "intel"],
  ["watch", "ai", "watch", "chat", "watch"],
  ["eventsTasks:events", "ai", "events", "chat", "events"],
  ["cockpit", "live", "overview", "cockpit", "overview"],
  ["market", "live", "market", "cockpit", "market"],
  ["positions", "live", "positions", "cockpit", "positions"],
  ["tradeJournal", "live", "execution", "cockpit", "execution"],
  ["tradeLedger", "live", "orders-fills", "cockpit", "ledger"],
  ["tradeReviewDetail:REV:389", "lab", "learning-reviews", "researchCenter", "reviews"],
  ["ownerReviewWorkspace", "lab", "learning-owner", "researchCenter", "owner"],
  ["researchCenter", "lab", "research-map", "researchCenter", "map"],
  ["knowledgeBase", "lab", "knowledge-incubator", "researchCenter", "knowledge"],
  ["researchCenter:strategy", "lab", "strategy-registry", "researchCenter", "strategy"],
  ["strategyStudio", "lab", "strategy-registry", "researchCenter", "strategy"],
  ["researchCenter:capabilities", "lab", "capability-registry", "researchCenter", "capabilities"],
  ["riskCenter", "control", "risk-overview", "riskCenter", "posture"],
  ["eventRisk", "control", "event-risk", "riskCenter", "events"],
  ["riskMandate", "control", "effective-boundaries", "riskCenter", "mandate"],
  ["riskSettings", "control", "rule-monitor", "riskCenter", "rules"],
  ["operationsCenter", "operations", "runtime-overview", "operationsCenter", "overview"],
  ["eventsTasks:tasks", "operations", "tasks", "operationsCenter", "tasks"],
  ["operationsCenter:recovery", "operations", "recovery", "operationsCenter", "recovery"],
  ["auditSystem", "operations", "audit", "operationsCenter", "audit"],
  ["systemSettings", "configuration", "overview", "systemSettings", null],
  ["systemSettings:trading", "configuration", "trading-runtime", "systemSettings", null],
  ["systemSettings:risk", "configuration", "risk-rules", "systemSettings", null],
  ["systemSettings:event-sources", "configuration", "event-sources", "systemSettings", null],
  ["systemSettings:models", "configuration", "models", "systemSettings", null],
  ["systemSettings:base:proxy", "configuration", "network", "systemSettings", null],
  ["systemSettings:base:backup", "configuration", "backup", "systemSettings", null],
  ["systemSettings:base:security", "configuration", "security", "systemSettings", null]
];

test("desktop compatibility routes preserve product ownership and accepted runtime sections", () => {
  for (const [route, workspace, view, section, tab] of desktopCases) {
    const resolved = resolveDesktopRoute(route);
    assert.equal(resolved.workspace, workspace, route);
    assert.equal(resolved.view, view, route);
    assert.equal(resolved.section, section, route);
    assert.equal(resolved.tab, tab, route);
    assert.ok(ACCEPTED_RESOURCE_SECTIONS.includes(resolved.section), route);
  }
  assert.equal(resolveDesktopRoute("tradeReviewDetail:REV:389").objectId, "REV:389");
  assert.equal(resolveDesktopRoute("strategyStudio").strategyTab, "studio");
  assert.equal(resolveDesktopRoute("systemSettings:models").settingsTab, "models");
  assert.equal(resolveDesktopRoute("systemSettings:trading").settingsTab, "trading");
  assert.equal(resolveDesktopRoute("systemSettings:risk").settingsTab, "risk");
  assert.equal(resolveDesktopRoute("systemSettings:base:backup").settingsSection, "data_backup");
});

test("mobile roots follow product workspaces rather than individual features", () => {
  const roots = ["chat", "cockpit", "labMap", "riskHub"].map(resolveMobileRoute);
  assert.deepEqual(roots.map((item) => item.workspace), ["ai", "live", "lab", "control"]);
  assert.deepEqual(roots.map((item) => item.route), ["chat", "cockpit", "labMap", "riskHub"]);
  for (const item of roots) assert.ok(ACCEPTED_RESOURCE_SECTIONS.includes(item.section));

  assert.equal(resolveMobileRoute("strategyLib").workspace, "lab");
  assert.equal(resolveMobileRoute("knowledgeBase").view, "knowledge-incubator");
  assert.equal(resolveMobileRoute("executionReview").workspace, "live");
  assert.equal(resolveMobileRoute("ownerReviewWorkspace").subPage, "owner");
  assert.equal(resolveMobileRoute("intelligence").workspace, "ai");
  assert.equal(resolveMobileRoute("eventsTasks").workspace, "ai");
  assert.equal(resolveMobileRoute("operationsCenter").subPage, "");
  assert.equal(resolveMobileRoute("eventsTasks:tasks").route, "auditSystem");
  assert.equal(resolveMobileRoute("eventsTasks:tasks").subPage, "tasks");
  assert.equal(resolveMobileRoute("operationsCenter:recovery").subPage, "recovery");
  assert.equal(resolveMobileRoute("auditSystem").subPage, "audit");
  assert.equal(resolveMobileRoute("systemSettings").workspace, "configuration");
  assert.equal(resolveMobileRoute("systemSettings:trading").subPage, "settings:trading");
  assert.equal(resolveMobileRoute("riskMandate").subPage, "boundaries");
  assert.equal(resolveMobileRoute("eventRisk").workspace, "control");
  assert.equal(resolveMobileRoute("eventRisk").route, "riskHub");
  assert.equal(resolveMobileRoute("eventRisk").view, "event-risk");
  assert.equal(resolveMobileRoute("eventRisk").subPage, "events");
});

test("runtime sections map back to their default visible workspace", () => {
  assert.equal(productWorkspaceForRuntimeSection("chat"), "ai");
  assert.equal(productWorkspaceForRuntimeSection("cockpit"), "live");
  assert.equal(productWorkspaceForRuntimeSection("researchCenter"), "lab");
  assert.equal(productWorkspaceForRuntimeSection("riskCenter"), "control");
  assert.equal(productWorkspaceForRuntimeSection("operationsCenter"), "operations");
  assert.equal(productWorkspaceForRuntimeSection("systemSettings"), "configuration");
});

test("unknown routes fail closed to AI Trader without producing an unknown server section", () => {
  const route = resolveProductRoute("not-a-real-workspace");
  assert.equal(route.recognized, false);
  assert.equal(route.workspace, "ai");
  assert.equal(route.view, "dialog");
  assert.equal(route.runtime.desktop.section, "chat");
  assert.equal(route.runtime.mobile.section, "chat");
});

const requiredFeatureIds = [
  "ai.dialog", "ai.autonomous-patrol", "ai.intelligence", "ai.watch", "ai.events",
  "ai.poster-current", "ai.poster-translate", "ai.poster-png",
  "live.overview", "live.market", "live.account", "live.positions", "live.execution",
  "live.orders", "live.fills", "live.protection", "live.reconcile-status", "live.review-status", "live.closed-trade-poster",
  "lab.research-map", "lab.knowledge-import", "lab.knowledge-evidence", "lab.knowledge-graph",
  "lab.knowledge-artifacts", "lab.knowledge-workflows", "lab.strategy-core", "lab.strategy-studio",
  "lab.strategy-knowledge", "lab.strategy-imported", "lab.strategy-adaptive",
  "lab.capability-native", "lab.capability-workflow", "lab.capability-imported-skill",
  "lab.capability-mcp", "lab.capability-connectors", "lab.trade-review", "lab.owner-review",
  "control.risk-posture", "control.operating-mode", "control.mandate-context",
  "control.rule-monitor", "control.event-risk", "control.permission-boundaries",
  "operations.runtime-health", "operations.tasks", "operations.task-runs",
  "operations.event-input-health", "operations.notifications", "operations.audit",
  "operations.reconcile", "operations.recovery",
  "configuration.operating-mode", "configuration.mandate", "configuration.risk-rules",
  "configuration.environment", "configuration.network", "configuration.backup",
  "configuration.security", "configuration.exchange", "configuration.event-sources",
  "configuration.notifications", "configuration.models", "configuration.agents",
  "configuration.users", "configuration.subscriptions", "configuration.account-profile"
];

test("every deployed feature has one explicit primary owner and migration state", () => {
  assert.deepEqual(DEPLOYED_FEATURES.map((item) => item.id).sort(), requiredFeatureIds.sort());
  assert.equal(new Set(DEPLOYED_FEATURES.map((item) => item.id)).size, DEPLOYED_FEATURES.length);
  for (const feature of DEPLOYED_FEATURES) {
    assert.ok([...PRIMARY_WORKSPACE_IDS, "configuration"].includes(feature.primaryWorkspace), feature.id);
    assert.ok(feature.currentSurface, `${feature.id} currentSurface`);
    assert.ok(feature.desktopTarget, `${feature.id} desktopTarget`);
    assert.ok(feature.mobileTarget, `${feature.id} mobileTarget`);
    assert.ok(["retain", "rename-shell", "deferred-ai-events", "deferred-lab-learning", "deferred-configuration", "new-composition"].includes(feature.migration), feature.id);
    assert.ok(["all", "owner", "admin", "existing-rbac"].includes(feature.permission), feature.id);
  }
  assert.equal(featureById("lab.strategy-studio")?.primaryWorkspace, "lab");
  assert.ok(featuresForWorkspace("configuration").length >= 10);
});

test("the coverage contract cannot advertise unsupported generation or delivery", () => {
  assert.deepEqual(REALITY_BOUNDARIES.poster, {
    styles: "fixed-current-style",
    language: ["zh", "en"],
    export: ["png"],
    arbitraryTelegramSend: false
  });
  assert.equal(REALITY_BOUNDARIES.knowledge.executableCodeGeneration, false);
  assert.equal(REALITY_BOUNDARIES.knowledge.closedStrategyTemplatesOnly, true);
  assert.equal(REALITY_BOUNDARIES.tasks.systemManagedScheduleEditable, false);
  assert.equal(REALITY_BOUNDARIES.capabilities.unknownToolsDefaultAllowed, false);
});
