import { resolveDesktopRoute, resolveMobileRoute } from "./productArchitecture.js";

const freezeViews = (views) => Object.freeze(views.map((item) => Object.freeze(item)));
const family = ({ id, code, label, labelEn, group, defaultView, views }) => Object.freeze({
  id, code, label, labelEn, group, defaultView, views: freezeViews(views)
});
const view = (id, label, labelEn, route) => ({ id, label, labelEn, route });

export const ZERO_BASE_FAMILIES = Object.freeze([
  family({
    id: "today", code: "00", label: "今日", labelEn: "Today", group: "core", defaultView: "owner",
    views: [
      view("owner", "Owner 首页", "Owner home", "today"),
      view("trader", "交易用户首页", "Trader home", "today"),
      view("actions", "全部待办", "All actions", "today")
    ]
  }),
  family({
    id: "ai", code: "01", label: "AI 交易员", labelEn: "AI Trader", group: "core", defaultView: "dialog",
    views: [
      view("dialog", "对话", "Conversation", "chat"),
      view("patrol", "自主巡检", "Autonomous patrol", "chat"),
      view("intelligence", "情报", "Intelligence", "intelligence"),
      view("watch", "盯盘", "Watch", "watch"),
      view("events", "事件日历", "Event calendar", "eventsTasks:events"),
      view("poster", "分析海报", "Analysis poster", "chat")
    ]
  }),
  family({
    id: "portfolio", code: "02", label: "账户与交易", labelEn: "Account & Trading", group: "core", defaultView: "overview",
    views: [
      view("overview", "总览", "Overview", "cockpit"),
      view("market", "市场", "Market", "market"),
      view("account", "账户", "Account", "marketAccount"),
      view("positions", "持仓", "Positions", "positions"),
      view("execution", "计划与执行", "Plans & execution", "executionReview"),
      view("ledger", "订单与成交", "Orders & fills", "tradeLedger"),
      view("protection", "保护与对账", "Protection & reconciliation", "cockpit")
    ]
  }),
  family({
    id: "strategy", code: "03", label: "策略", labelEn: "Strategy", group: "intelligent-assets", defaultView: "catalog",
    views: [
      view("catalog", "策略库", "Strategy registry", "strategyLib"),
      view("detail", "策略详情", "Strategy detail", "strategyLib"),
      view("studio", "策略工作室", "Strategy studio", "strategyStudio"),
      view("historical", "历史验证", "Historical validation", "strategyLib"),
      view("forward", "纯前向验证", "Pure-forward validation", "strategyLib")
    ]
  }),
  family({
    id: "knowledge", code: "04", label: "知识", labelEn: "Knowledge", group: "intelligent-assets", defaultView: "overview",
    views: [
      view("overview", "知识总览", "Knowledge overview", "knowledgeBase"),
      view("import", "导入来源", "Import sources", "knowledgeBase"),
      view("evidence", "来源证据", "Source evidence", "knowledgeBase"),
      view("graph", "关系图谱", "Relationship graph", "knowledgeBase"),
      view("artifacts", "提取产物", "Extracted artifacts", "knowledgeBase"),
      view("workflows", "工作流候选", "Workflow candidates", "knowledgeBase")
    ]
  }),
  family({
    id: "capability", code: "05", label: "能力", labelEn: "Capability", group: "intelligent-assets", defaultView: "overview",
    views: [
      view("overview", "能力总览", "Capability overview", "capabilityLib"),
      view("native", "原生工具", "Native tools", "capabilityLib"),
      view("workflow", "工作流", "Workflows", "capabilityLib"),
      view("mcp", "MCP", "MCP", "capabilityLib"),
      view("connectors", "连接器", "Connectors", "capabilityLib"),
      view("skills", "导入技能", "Imported skills", "capabilityLib")
    ]
  }),
  family({
    id: "reviews", code: "06", label: "学习与复盘", labelEn: "Learning & Reviews", group: "intelligent-assets", defaultView: "reviews",
    views: [
      view("reviews", "交易复盘", "Trade reviews", "labReviews"),
      view("detail", "复盘详情", "Review detail", "labReviews"),
      view("owner", "Owner 优化", "Owner optimization", "ownerReviewWorkspace"),
      view("lessons", "候选教训", "Candidate lessons", "labReviews")
    ]
  }),
  family({
    id: "guard", code: "07", label: "风险与边界", labelEn: "Risk & Boundaries", group: "governance", defaultView: "posture",
    views: [
      view("posture", "风险姿态", "Risk posture", "riskCenter"),
      view("events", "事件风险", "Event risk", "eventRisk"),
      view("boundaries", "权限边界", "Permission boundaries", "riskMandate"),
      view("rules", "规则监控", "Rule monitor", "riskSettings")
    ]
  }),
  family({
    id: "operations", code: "08", label: "系统运维", labelEn: "Operations", group: "governance", defaultView: "health",
    views: [
      view("health", "系统健康", "System health", "operationsCenter"),
      view("tasks", "任务与运行", "Tasks & runs", "operationsCenter:tasks"),
      view("inputs", "事件源健康", "Event-input health", "operationsCenter"),
      view("recovery", "恢复", "Recovery", "operationsCenter:recovery"),
      view("notifications", "通知", "Notifications", "operationsCenter:notifications"),
      view("audit", "审计", "Audit", "auditSystem")
    ]
  }),
  family({
    id: "configuration", code: "09", label: "配置", labelEn: "Configuration", group: "governance", defaultView: "trading",
    views: [
      view("trading", "交易与运行", "Trading & runtime", "systemSettings:trading"),
      view("risk", "风险规则", "Risk rules", "systemSettings:risk"),
      view("exchange", "交易所", "Exchange", "systemSettings:exchange"),
      view("environment", "环境", "Environment", "systemSettings:base"),
      view("network", "网络", "Network", "systemSettings:base:proxy"),
      view("backup", "备份", "Backup", "systemSettings:base:backup"),
      view("security", "安全", "Security", "systemSettings:base:security"),
      view("notifications", "通知渠道", "Notification channels", "systemSettings:notifications"),
      view("event-sources", "事件源", "Event sources", "systemSettings:event-sources"),
      view("models", "模型与密钥", "Models & keys", "systemSettings:models"),
      view("agents", "Agent", "Agents", "systemSettings:agents"),
      view("users", "用户", "Users", "systemSettings:users"),
      view("subscriptions", "订阅", "Subscriptions", "systemSettings:users")
    ]
  })
]);

export const ZERO_BASE_GROUPS = Object.freeze([
  Object.freeze({ id: "core", label: "核心产品", labelEn: "Core", families: Object.freeze(["today", "ai", "portfolio"]) }),
  Object.freeze({ id: "intelligent-assets", label: "智能资产", labelEn: "Intelligent assets", families: Object.freeze(["strategy", "knowledge", "capability", "reviews"]) }),
  Object.freeze({ id: "governance", label: "治理", labelEn: "Governance", families: Object.freeze(["guard", "operations", "configuration"]) })
]);

export const ZERO_BASE_MOBILE_ROOTS = Object.freeze([
  Object.freeze({ id: "today", label: "今日", labelEn: "Today", route: "today", families: Object.freeze(["today"]) }),
  Object.freeze({ id: "ai", label: "AI", labelEn: "AI", route: "chat", families: Object.freeze(["ai"]) }),
  Object.freeze({ id: "assets", label: "资产", labelEn: "Assets", route: "cockpit", families: Object.freeze(["portfolio"]) }),
  Object.freeze({ id: "intelligent", label: "智能", labelEn: "Intelligent", route: "researchCenter", families: Object.freeze(["strategy", "knowledge", "capability", "reviews"]) }),
  Object.freeze({ id: "more", label: "更多", labelEn: "More", route: "operationsCenter", families: Object.freeze(["guard", "operations", "configuration"]) })
]);

const featureFamilyRules = Object.freeze([
  [/^ai\./, "ai"],
  [/^live\./, "portfolio"],
  [/^lab\.strategy-/, "strategy"],
  [/^lab\.(knowledge-|research-map)/, "knowledge"],
  [/^lab\.capability-/, "capability"],
  [/^lab\.(trade-review|owner-review)/, "reviews"],
  [/^control\./, "guard"],
  [/^operations\./, "operations"],
  [/^configuration\./, "configuration"]
]);

export function familyForFeature(featureId) {
  const id = String(featureId || "");
  return featureFamilyRules.find(([pattern]) => pattern.test(id))?.[1] || null;
}

const familyById = new Map(ZERO_BASE_FAMILIES.map((item) => [item.id, item]));

export function resolveZeroBaseDestination(familyId = "ai", viewId, device = "desktop") {
  const requestedFamily = familyById.get(String(familyId || ""));
  const requestedView = requestedFamily?.views.find((item) => item.id === (viewId || requestedFamily.defaultView));
  const safeFamily = requestedFamily && requestedView ? requestedFamily : familyById.get("ai");
  const safeView = requestedFamily && requestedView
    ? requestedView
    : safeFamily.views.find((item) => item.id === safeFamily.defaultView);
  const route = safeView.route;
  return Object.freeze({
    familyId: safeFamily.id,
    viewId: safeView.id,
    route,
    runtime: device === "mobile" ? resolveMobileRoute(route) : resolveDesktopRoute(route)
  });
}
