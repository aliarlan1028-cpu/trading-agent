const feature = (id, primaryWorkspace, currentSurface, desktopTarget, mobileTarget, migration = "retain", permission = "existing-rbac") => Object.freeze({
  id, primaryWorkspace, currentSurface, desktopTarget, mobileTarget, migration, permission
});

export const DEPLOYED_FEATURES = Object.freeze([
  feature("ai.dialog", "ai", "AiDialogConcept / ChatPage", "AI Trader / Dialog", "AI / Conversation"),
  feature("ai.autonomous-patrol", "ai", "ChatPage / ToolTrace", "AI Trader / Dialog + Command Rail", "AI / Patrol message detail", "new-composition"),
  feature("ai.intelligence", "ai", "IntelligenceConcept / MobileIntelligence", "AI Trader / Intelligence", "AI / Intelligence", "rename-shell"),
  feature("ai.watch", "ai", "WatchMonitorConcept / MobileWatch", "AI Trader / Watch", "AI / Watch", "rename-shell"),
  feature("ai.events", "ai", "EventsConcept / MobileTasks:event calendar", "AI Trader / Events", "AI / Events", "retain"),
  feature("ai.poster-current", "ai", "PosterModal", "AI message action", "AI message action"),
  feature("ai.poster-translate", "ai", "PosterModal:language", "Poster language toggle", "Poster language toggle"),
  feature("ai.poster-png", "ai", "PosterModal:download", "Poster PNG export", "Poster PNG export"),

  feature("live.overview", "live", "TradingOverviewConcept", "Live Desk / Overview", "Live / Overview", "rename-shell"),
  feature("live.market", "live", "MarketConcept / MobileMarket", "Live Desk / Market", "Live / Market"),
  feature("live.account", "live", "TradingOverviewConcept / MobileAccountHealth", "Live Desk / Account context", "Live / Account detail"),
  feature("live.positions", "live", "PositionsConcept / MobilePositions", "Live Desk / Positions", "Live / Positions"),
  feature("live.execution", "live", "ExecutionReviewConcept / MobileExecution", "Live Desk / Execution", "Live / Execution"),
  feature("live.orders", "live", "ExecutionLedgerConcept / MobileExecution:orders", "Live Desk / Orders & Fills", "Live / Orders"),
  feature("live.fills", "live", "ExecutionLedgerConcept / MobileExecution:fills", "Live Desk / Orders & Fills", "Live / Fills"),
  feature("live.protection", "live", "PositionsConcept / ExecutionReviewConcept", "Live Desk / Position & execution detail", "Live / Position detail"),
  feature("live.reconcile-status", "live", "ExecutionReviewConcept / MobileAccountHealth", "Live Desk / Execution truth", "Live / Account health"),
  feature("live.review-status", "live", "ExecutionReviewConcept / MobileExecution:reviews", "Live Desk / Review status + Lab link", "Live / Review status + Lab link", "retain"),
  feature("live.closed-trade-poster", "live", "PosterModal / Telegram notifier result", "Live Desk / Closed trade result", "Live / Closed trade result"),

  feature("lab.research-map", "lab", "ResearchMapConcept / MobileResearchMap", "Lab / Research Map", "Lab / Research Map", "new-composition"),
  feature("lab.knowledge-import", "lab", "KnowledgeConcept / KnowledgeImportPanel", "Lab / Knowledge Incubator", "Lab / Source import"),
  feature("lab.knowledge-evidence", "lab", "KnowledgeConcept", "Lab / Source evidence anatomy", "Lab / Source detail"),
  feature("lab.knowledge-graph", "lab", "KnowledgeConcept / ConceptGraph", "Lab / Knowledge relationships", "Lab / Knowledge graph detail"),
  feature("lab.knowledge-artifacts", "lab", "KnowledgeConcept", "Lab / Candidate routing", "Lab / Extracted artifacts"),
  feature("lab.knowledge-workflows", "lab", "KnowledgeConcept", "Lab / Candidate routing", "Lab / Workflow candidates"),
  feature("lab.strategy-core", "lab", "StrategyLibraryConcept:catalog", "Lab / Strategy Registry", "Lab / Strategy detail"),
  feature("lab.strategy-studio", "lab", "StrategyLibraryConcept:studio / MobileStrategy:studio", "Lab / Strategy Registry / Studio", "Lab / Strategy Studio flow"),
  feature("lab.strategy-knowledge", "lab", "KnowledgeConcept / StrategyLibraryConcept", "Lab / Strategy Registry", "Lab / Knowledge strategy detail"),
  feature("lab.strategy-imported", "lab", "StrategyLibraryConcept", "Lab / Strategy Registry", "Lab / Imported strategy detail"),
  feature("lab.strategy-adaptive", "lab", "StrategyLibraryConcept / owner review data", "Lab / Strategy Registry", "Lab / Adaptive strategy detail"),
  feature("lab.capability-native", "lab", "CapabilitiesConcept / MobileCapabilities", "Lab / Capability Registry", "Lab / Native tool detail"),
  feature("lab.capability-workflow", "lab", "CapabilitiesConcept / KnowledgeConcept", "Lab / Capability Registry", "Lab / Workflow detail"),
  feature("lab.capability-imported-skill", "lab", "CapabilitiesConcept / KnowledgeConcept", "Lab / Capability Registry", "Lab / Imported skill detail"),
  feature("lab.capability-mcp", "lab", "CapabilitiesConcept", "Lab / Capability Registry", "Lab / MCP detail"),
  feature("lab.capability-connectors", "lab", "CapabilitiesConcept", "Lab / Capability Registry", "Lab / Connector detail"),
  feature("lab.trade-review", "lab", "TradeReviewWorkbenchConcept / MobileExecution:reviews", "Lab / Learning & Owner / Reviews", "Lab / Review list and detail", "retain"),
  feature("lab.owner-review", "lab", "OwnerReviewWorkspaceConcept / MobileOwnerReview", "Lab / Learning & Owner / Owner", "Lab / Owner queue and detail", "retain", "owner"),

  feature("control.risk-posture", "control", "RiskPostureConcept / MobileRiskHub", "Control / Risk Overview", "Control / Overview", "rename-shell"),
  feature("control.operating-mode", "control", "OperatingBoundaryConcept / MobileRiskHub", "Control / Effective mode context", "Control / Boundaries", "new-composition"),
  feature("control.mandate-context", "control", "OperatingBoundaryConcept / MobileRiskHub", "Control / Effective boundaries", "Control / Boundaries", "new-composition"),
  feature("control.rule-monitor", "control", "RulesConcept:monitor / MobileRiskHub", "Control / Rule Monitor", "Control / Rules", "new-composition"),
  feature("control.event-risk", "control", "RiskPostureConcept / EventsConcept", "Control / Event Risk Monitor", "Control / Event risk detail"),
  feature("control.permission-boundaries", "control", "OperatingBoundaryConcept / MobileRiskHub", "Control / Readiness Chain", "Control / Readiness Chain", "new-composition"),

  feature("operations.runtime-health", "operations", "OperationsCommandConcept / MobileOperations", "Operations / Command", "More / Operations / Command", "new-composition"),
  feature("operations.tasks", "operations", "OperationsTasksConcept / MobileOperations", "Operations / Tasks & Runs", "Operations / Tasks"),
  feature("operations.task-runs", "operations", "OperationsTasksConcept / MobileOperations", "Operations / Tasks & Runs", "Operations / Run evidence"),
  feature("operations.event-input-health", "operations", "OperationsCommandConcept / MobileOperations", "Operations / Command / Event Inputs", "Operations / Event Input Health", "new-composition"),
  feature("operations.notifications", "operations", "OperationsInboxConcept / MobileOperations", "Operations / Inbox", "Operations / Inbox", "new-composition"),
  feature("operations.audit", "operations", "OperationsAuditConcept / MobileOperations", "Operations / Audit", "Operations / Audit"),
  feature("operations.reconcile", "operations", "OperationsRecoveryConcept / MobileOperations", "Operations / Recovery", "Operations / Recovery", "new-composition"),
  feature("operations.recovery", "operations", "OperationsRecoveryConcept / MobileOperations", "Operations / Recovery", "Operations / Recovery", "new-composition"),

  feature("configuration.operating-mode", "configuration", "MandateConcept / MobileTradingConfiguration", "Configuration / Trading & Runtime", "Configuration / Trading & Runtime", "new-composition", "owner"),
  feature("configuration.mandate", "configuration", "MandateConcept / MobileRiskPermissionEditor", "Configuration / Trading & Runtime", "Configuration / Trading Permissions", "new-composition", "owner"),
  feature("configuration.risk-rules", "configuration", "RulesConcept:editable / RiskRulesPanel", "Configuration / Risk Rules", "Configuration / Risk Rules", "new-composition", "owner"),
  feature("configuration.environment", "configuration", "SettingsConcept:environment", "Configuration / Environment", "Configuration / Environment"),
  feature("configuration.network", "configuration", "SettingsConcept:network", "Configuration / Network", "Configuration / Network"),
  feature("configuration.backup", "configuration", "SettingsConcept:data_backup", "Configuration / Backup", "Configuration / Backup", "retain", "owner"),
  feature("configuration.security", "configuration", "SettingsConcept:security / AccountDialog", "Configuration / Security", "Configuration / Security", "retain", "owner"),
  feature("configuration.exchange", "configuration", "SettingsConcept:exchange", "Configuration / OKX", "Configuration / OKX", "retain", "owner"),
  feature("configuration.event-sources", "configuration", "EventSourcesPanel / MobileEventSourcesConfiguration", "Configuration / Event Sources", "Configuration / Event Sources", "new-composition", "owner"),
  feature("configuration.notifications", "configuration", "SettingsConcept:notifications", "Configuration / Notifications", "Configuration / Notifications", "retain", "owner"),
  feature("configuration.models", "configuration", "SettingsConcept:models", "Configuration / Models & Keys", "Configuration / Models & Keys", "retain", "owner"),
  feature("configuration.agents", "configuration", "SettingsConcept:agents", "Configuration / Agents", "Configuration / Agents", "retain", "owner"),
  feature("configuration.users", "configuration", "SettingsConcept:users", "Configuration / Users", "Configuration / Users", "retain", "owner"),
  feature("configuration.subscriptions", "configuration", "SettingsConcept:users", "Configuration / Subscriptions", "Configuration / Subscriptions", "retain", "owner"),
  feature("configuration.account-profile", "configuration", "AccountDialog / MobileSettingsIndex", "Configuration / Account", "More / Account", "new-composition", "all")
]);

export const REALITY_BOUNDARIES = Object.freeze({
  poster: Object.freeze({ styles: "fixed-current-style", language: Object.freeze(["zh", "en"]), export: Object.freeze(["png"]), arbitraryTelegramSend: false }),
  knowledge: Object.freeze({ executableCodeGeneration: false, closedStrategyTemplatesOnly: true, supportedRuntimeArtifacts: Object.freeze(["strategy_draft", "knowledge_lens", "knowledge_workflow", "imported_skill_record"]) }),
  tasks: Object.freeze({ systemManagedScheduleEditable: false, userTaskEditingUsesExistingEndpointsOnly: true }),
  capabilities: Object.freeze({ unknownToolsDefaultAllowed: false, nativeToolsAreCodeRegistered: true, mcpRequiresExplicitGrant: true }),
  trading: Object.freeze({ apiAndRiskSemanticsUnchanged: true, optimisticExecutionSuccess: false })
});

export function featureById(id) {
  return DEPLOYED_FEATURES.find((item) => item.id === id) || null;
}

export function featuresForWorkspace(workspaceId) {
  return DEPLOYED_FEATURES.filter((item) => item.primaryWorkspace === workspaceId);
}
