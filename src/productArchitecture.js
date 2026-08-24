export const ACCEPTED_RESOURCE_SECTIONS = Object.freeze([
  "chat",
  "cockpit",
  "researchCenter",
  "riskCenter",
  "operationsCenter",
  "systemSettings"
]);

export const PRIMARY_WORKSPACE_IDS = Object.freeze(["ai", "live", "lab", "control", "operations"]);

export const WORKSPACES = Object.freeze({
  ai: Object.freeze({
    id: "ai", code: "01", label: "AI 交易员", labelEn: "AI Trader",
    eyebrow: "AGENT WORKSITE", eyebrowEn: "AGENT WORKSITE",
    purpose: "决策、对话、情报、盯盘与事件上下文",
    purposeEn: "Decisions, dialogue, intelligence, watch, and event context",
    rootRoute: "chat", resourceSection: "chat", defaultView: "dialog"
  }),
  live: Object.freeze({
    id: "live", code: "02", label: "Live Desk", labelEn: "Live Desk",
    eyebrow: "LIVE EXECUTION", eyebrowEn: "LIVE EXECUTION",
    purpose: "市场、账户、持仓、执行与保护事实",
    purposeEn: "Market, account, position, execution, and protection truth",
    rootRoute: "cockpit", resourceSection: "cockpit", defaultView: "overview"
  }),
  lab: Object.freeze({
    id: "lab", code: "03", label: "Lab", labelEn: "Lab",
    eyebrow: "RESEARCH & RELEASE", eyebrowEn: "RESEARCH & RELEASE",
    purpose: "知识孵化、策略与能力发布、复盘与 Owner 优化",
    purposeEn: "Knowledge incubation, strategy and capability release, review, and Owner optimization",
    rootRoute: "researchCenter", resourceSection: "researchCenter", defaultView: "research-map"
  }),
  control: Object.freeze({
    id: "control", code: "04", label: "Control", labelEn: "Control",
    eyebrow: "RISK GOVERNANCE", eyebrowEn: "RISK GOVERNANCE",
    purpose: "风险姿态、运行模式、Mandate 与确定性规则",
    purposeEn: "Risk posture, operating mode, mandate, and deterministic rules",
    rootRoute: "riskCenter", resourceSection: "riskCenter", defaultView: "risk-overview"
  }),
  operations: Object.freeze({
    id: "operations", code: "05", label: "Operations", labelEn: "Operations",
    eyebrow: "SYSTEM OPERATIONS", eyebrowEn: "SYSTEM OPERATIONS",
    purpose: "运行健康、任务、事件输入、通知、审计与恢复",
    purposeEn: "Runtime health, tasks, event inputs, notifications, audit, and recovery",
    rootRoute: "operationsCenter", resourceSection: "operationsCenter", defaultView: "runtime-overview"
  })
});

export const CONFIGURATION_WORKSPACE = Object.freeze({
  id: "configuration", code: "CFG", label: "配置中心", labelEn: "Configuration",
  eyebrow: "CONFIGURATION REGISTRY", eyebrowEn: "CONFIGURATION REGISTRY",
  purpose: "所有可编辑持久配置的唯一入口",
  purposeEn: "The single home for editable durable configuration",
  rootRoute: "systemSettings", resourceSection: "systemSettings", defaultView: "overview",
  primaryNavigation: false
});

const route = ({ aliases, workspace, view, migration = "retain", desktop, mobile }) => Object.freeze({
  aliases: Object.freeze(aliases), workspace, view, migration,
  desktop: Object.freeze({ section: desktop.section, tab: desktop.tab ?? null, strategyTab: desktop.strategyTab ?? null, settingsTab: desktop.settingsTab ?? null, settingsSection: desktop.settingsSection ?? null }),
  mobile: Object.freeze({ route: mobile.route, subPage: mobile.subPage || "", section: mobile.section })
});

export const ROUTE_DEFINITIONS = Object.freeze([
  route({ aliases: ["chat"], workspace: "ai", view: "dialog", desktop: { section: "chat", tab: "dialog" }, mobile: { route: "chat", section: "chat" } }),
  route({ aliases: ["chat:intelligence", "intelligence"], workspace: "ai", view: "intelligence", desktop: { section: "chat", tab: "intel" }, mobile: { route: "intelligence", section: "operationsCenter" } }),
  route({ aliases: ["watch"], workspace: "ai", view: "watch", desktop: { section: "chat", tab: "watch" }, mobile: { route: "watch", section: "chat" } }),
  route({ aliases: ["eventsTasks", "eventsTasks:events"], workspace: "ai", view: "events", migration: "retain", desktop: { section: "chat", tab: "events" }, mobile: { route: "eventsTasks", section: "operationsCenter" } }),

  route({ aliases: ["cockpit"], workspace: "live", view: "overview", migration: "rename-shell", desktop: { section: "cockpit", tab: "overview" }, mobile: { route: "cockpit", section: "cockpit" } }),
  route({ aliases: ["market"], workspace: "live", view: "market", desktop: { section: "cockpit", tab: "market" }, mobile: { route: "cockpit", section: "cockpit" } }),
  route({ aliases: ["marketAccount"], workspace: "live", view: "account", desktop: { section: "cockpit", tab: "market" }, mobile: { route: "cockpit", subPage: "marketAccount", section: "cockpit" } }),
  route({ aliases: ["positions"], workspace: "live", view: "positions", desktop: { section: "cockpit", tab: "positions" }, mobile: { route: "cockpit", subPage: "positions", section: "cockpit" } }),
  route({ aliases: ["signalHub", "tradeJournal", "executionReview"], workspace: "live", view: "execution", desktop: { section: "cockpit", tab: "execution" }, mobile: { route: "executionReview", section: "cockpit" } }),
  route({ aliases: ["tradeLedger"], workspace: "live", view: "orders-fills", desktop: { section: "cockpit", tab: "ledger" }, mobile: { route: "tradeLedger", section: "cockpit" } }),

  route({ aliases: ["tradeReviewDetail:*", "tradeReviewDetail", "labReviews"], workspace: "lab", view: "learning-reviews", migration: "retain", desktop: { section: "researchCenter", tab: "reviews" }, mobile: { route: "executionReview", subPage: "reviews", section: "cockpit" } }),
  route({ aliases: ["ownerReviewWorkspace"], workspace: "lab", view: "learning-owner", migration: "retain", desktop: { section: "researchCenter", tab: "owner" }, mobile: { route: "executionReview", subPage: "owner", section: "cockpit" } }),
  route({ aliases: ["researchCenter", "labMap", "researchCenter:map"], workspace: "lab", view: "research-map", migration: "new-composition", desktop: { section: "researchCenter", tab: "map" }, mobile: { route: "labMap", section: "researchCenter" } }),
  route({ aliases: ["knowledgeBase", "researchCenter:knowledge"], workspace: "lab", view: "knowledge-incubator", migration: "rename-shell", desktop: { section: "researchCenter", tab: "knowledge" }, mobile: { route: "knowledgeBase", section: "researchCenter" } }),
  route({ aliases: ["researchCenter:strategy", "strategyAnalysis", "analysisRoom", "strategyWorkbench", "strategyLib"], workspace: "lab", view: "strategy-registry", desktop: { section: "researchCenter", tab: "strategy", strategyTab: "catalog" }, mobile: { route: "strategyLib", section: "researchCenter" } }),
  route({ aliases: ["strategyStudio", "strategyLib:studio"], workspace: "lab", view: "strategy-registry", desktop: { section: "researchCenter", tab: "strategy", strategyTab: "studio" }, mobile: { route: "strategyLib", subPage: "studio", section: "researchCenter" } }),
  route({ aliases: ["researchCenter:capabilities", "capabilities", "capabilityLib"], workspace: "lab", view: "capability-registry", desktop: { section: "researchCenter", tab: "capabilities" }, mobile: { route: "capabilityLib", section: "researchCenter" } }),

  route({ aliases: ["riskCenter", "riskOverview", "riskCenter:posture", "riskHub"], workspace: "control", view: "risk-overview", migration: "rename-shell", desktop: { section: "riskCenter", tab: "posture" }, mobile: { route: "riskHub", section: "riskCenter" } }),
  route({ aliases: ["riskMandate", "riskCenter:mandate"], workspace: "control", view: "effective-boundaries", migration: "new-composition", desktop: { section: "riskCenter", tab: "mandate" }, mobile: { route: "riskHub", subPage: "boundaries", section: "riskCenter" } }),
  route({ aliases: ["riskSettings", "riskCenter:rules"], workspace: "control", view: "rule-monitor", migration: "new-composition", desktop: { section: "riskCenter", tab: "rules" }, mobile: { route: "riskHub", subPage: "rules", section: "riskCenter" } }),
  route({ aliases: ["riskCenter:security"], workspace: "configuration", view: "security", migration: "deferred-configuration", desktop: { section: "systemSettings", settingsTab: "base", settingsSection: "security" }, mobile: { route: "systemSettings", subPage: "settings:security", section: "systemSettings" } }),

  route({ aliases: ["operationsCenter", "operationsCenter:overview"], workspace: "operations", view: "runtime-overview", migration: "rename-shell", desktop: { section: "operationsCenter", tab: "overview" }, mobile: { route: "auditSystem", section: "operationsCenter" } }),
  route({ aliases: ["eventsTasks:tasks", "operationsCenter:tasks"], workspace: "operations", view: "tasks", desktop: { section: "operationsCenter", tab: "tasks" }, mobile: { route: "auditSystem", subPage: "tasks", section: "operationsCenter" } }),
  route({ aliases: ["operationsCenter:recovery"], workspace: "operations", view: "recovery", migration: "new-composition", desktop: { section: "operationsCenter", tab: "recovery" }, mobile: { route: "auditSystem", subPage: "recovery", section: "operationsCenter" } }),
  route({ aliases: ["auditSystem", "operationsCenter:audit"], workspace: "operations", view: "audit", desktop: { section: "operationsCenter", tab: "audit" }, mobile: { route: "auditSystem", subPage: "audit", section: "operationsCenter" } }),
  route({ aliases: ["operationsCenter:notifications", "notifications"], workspace: "operations", view: "notifications", desktop: { section: "operationsCenter", tab: "notifications" }, mobile: { route: "auditSystem", subPage: "notifications", section: "operationsCenter" } }),

  route({ aliases: ["systemSettings"], workspace: "configuration", view: "overview", migration: "rename-shell", desktop: { section: "systemSettings" }, mobile: { route: "systemSettings", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:overview"], workspace: "configuration", view: "overview", desktop: { section: "systemSettings", settingsTab: "overview" }, mobile: { route: "systemSettings", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:trading"], workspace: "configuration", view: "trading-runtime", migration: "new-composition", desktop: { section: "systemSettings", settingsTab: "trading" }, mobile: { route: "systemSettings", subPage: "settings:trading", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:risk"], workspace: "configuration", view: "risk-rules", migration: "new-composition", desktop: { section: "systemSettings", settingsTab: "risk" }, mobile: { route: "systemSettings", subPage: "settings:risk", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:base"], workspace: "configuration", view: "basics", desktop: { section: "systemSettings", settingsTab: "base", settingsSection: "environment" }, mobile: { route: "systemSettings", subPage: "settings:environment", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:base:proxy"], workspace: "configuration", view: "network", desktop: { section: "systemSettings", settingsTab: "base", settingsSection: "network" }, mobile: { route: "systemSettings", subPage: "settings:network", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:base:backup"], workspace: "configuration", view: "backup", desktop: { section: "systemSettings", settingsTab: "base", settingsSection: "data_backup" }, mobile: { route: "systemSettings", subPage: "settings:data_backup", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:base:security"], workspace: "configuration", view: "security", desktop: { section: "systemSettings", settingsTab: "base", settingsSection: "security" }, mobile: { route: "systemSettings", subPage: "settings:security", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:base:notifications"], workspace: "configuration", view: "notifications", desktop: { section: "systemSettings", settingsTab: "notifications" }, mobile: { route: "systemSettings", subPage: "settings:integrations", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:exchange"], workspace: "configuration", view: "exchange", desktop: { section: "systemSettings", settingsTab: "exchange" }, mobile: { route: "systemSettings", subPage: "settings:exchange", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:notifications"], workspace: "configuration", view: "notifications", desktop: { section: "systemSettings", settingsTab: "notifications" }, mobile: { route: "systemSettings", subPage: "settings:integrations", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:event-sources"], workspace: "configuration", view: "event-sources", migration: "new-composition", desktop: { section: "systemSettings", settingsTab: "event_sources" }, mobile: { route: "systemSettings", subPage: "settings:event_sources", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:models"], workspace: "configuration", view: "models", desktop: { section: "systemSettings", settingsTab: "models" }, mobile: { route: "systemSettings", subPage: "settings:llm", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:agents"], workspace: "configuration", view: "agents", desktop: { section: "systemSettings", settingsTab: "agents" }, mobile: { route: "systemSettings", subPage: "settings:agents", section: "systemSettings" } }),
  route({ aliases: ["systemSettings:users", "admin"], workspace: "configuration", view: "users", desktop: { section: "systemSettings", settingsTab: "users" }, mobile: { route: "systemSettings", subPage: "settings:users", section: "systemSettings" } })
]);

const defaultRoute = ROUTE_DEFINITIONS[0];

function matchDefinition(requestedRoute) {
  const exact = ROUTE_DEFINITIONS.find((definition) => definition.aliases.includes(requestedRoute));
  if (exact) return { definition: exact, objectId: "" };
  if (requestedRoute.startsWith("tradeReviewDetail:")) {
    const definition = ROUTE_DEFINITIONS.find((item) => item.aliases.includes("tradeReviewDetail:*"));
    const objectId = requestedRoute.slice("tradeReviewDetail:".length);
    if (definition && objectId) return { definition, objectId };
  }
  if (requestedRoute.startsWith("settings:")) {
    const settingsSection = requestedRoute.slice("settings:".length);
    const aliasBySection = {
      exchange: "systemSettings:exchange", integrations: "systemSettings:notifications", notifications: "systemSettings:notifications",
      llm: "systemSettings:models", models: "systemSettings:models", agents: "systemSettings:agents", users: "systemSettings:users",
      trading: "systemSettings:trading", risk: "systemSettings:risk", event_sources: "systemSettings:event-sources",
      environment: "systemSettings:base", network: "systemSettings:base:proxy", data_backup: "systemSettings:base:backup", security: "systemSettings:base:security"
    };
    return matchDefinition(aliasBySection[settingsSection] || "systemSettings");
  }
  return null;
}

export function resolveProductRoute(requestedRoute = "chat") {
  const requested = String(requestedRoute || "chat").trim() || "chat";
  const matched = matchDefinition(requested);
  const definition = matched?.definition || defaultRoute;
  return {
    requestedRoute: requested,
    recognized: Boolean(matched),
    workspace: definition.workspace,
    view: definition.view,
    objectId: matched?.objectId || "",
    migration: definition.migration,
    runtime: {
      desktop: { ...definition.desktop },
      mobile: { ...definition.mobile }
    }
  };
}

export function resolveDesktopRoute(requestedRoute) {
  const resolved = resolveProductRoute(requestedRoute);
  return { ...resolved, ...resolved.runtime.desktop };
}

export function resolveMobileRoute(requestedRoute) {
  const resolved = resolveProductRoute(requestedRoute);
  return { ...resolved, ...resolved.runtime.mobile };
}

export function productWorkspaceForRuntimeSection(section) {
  return ({ chat: "ai", cockpit: "live", researchCenter: "lab", riskCenter: "control", operationsCenter: "operations", systemSettings: "configuration" })[section] || "ai";
}
