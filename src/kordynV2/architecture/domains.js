const workspace = (id, label, legacyRoute, resourceSection) => Object.freeze({ id, label, legacyRoute, resourceSection });

export const KORDYN_V2_DOMAINS = Object.freeze([
  Object.freeze({ id: "ai", label: "AI 交易员", truthMode: "full", defaultWorkspace: "missions" }),
  Object.freeze({ id: "account", label: "账户交易", truthMode: "full", defaultWorkspace: "market" }),
  Object.freeze({ id: "assets", label: "智能资产", truthMode: "compact", defaultWorkspace: "relationships" }),
  Object.freeze({ id: "governance", label: "系统治理", truthMode: "critical", defaultWorkspace: "overview" })
]);

export const KORDYN_V2_DOMAIN_IDS = Object.freeze(KORDYN_V2_DOMAINS.map((row) => row.id));

export const KORDYN_V2_WORKSPACES = Object.freeze({
  ai: Object.freeze([
    workspace("missions", "任务", "chat", "chat"), workspace("intelligence", "情报", "intelligence", "operationsCenter"),
    workspace("watch", "观察哨", "watch", "chat"), workspace("events", "事件日历", "eventsTasks:events", "operationsCenter"),
    workspace("dialog", "对话", "chat", "chat")
  ]),
  account: Object.freeze([
    workspace("market", "市场", "market", "cockpit"), workspace("account", "账户", "marketAccount", "cockpit"),
    workspace("positions", "持仓", "positions", "cockpit"), workspace("plans", "计划", "executionReview", "cockpit"),
    workspace("orders", "订单", "tradeLedger", "cockpit"), workspace("fills", "成交", "tradeLedger", "cockpit")
  ]),
  assets: Object.freeze([
    workspace("relationships", "关系总览", "labMap", "researchCenter"), workspace("strategies", "策略库", "strategyLib", "researchCenter"),
    workspace("knowledge", "知识库", "knowledgeBase", "researchCenter"), workspace("capabilities", "能力库", "capabilityLib", "researchCenter"),
    workspace("reviews", "复盘与发布", "labReviews", "researchCenter")
  ]),
  governance: Object.freeze([
    workspace("overview", "运行总览", "riskOverview", "riskCenter"), workspace("runs", "任务与运行", "operationsCenter:tasks", "operationsCenter"),
    workspace("event-inputs", "事件输入", "eventRisk", "riskCenter"), workspace("notifications", "通知", "operationsCenter:notifications", "operationsCenter"),
    workspace("audit", "审计", "operationsCenter:audit", "operationsCenter"), workspace("recovery", "恢复", "operationsCenter:recovery", "operationsCenter"),
    workspace("configuration", "配置", "systemSettings", "systemSettings")
  ])
});
