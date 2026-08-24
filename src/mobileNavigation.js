export const MOBILE_PRIMARY_NAV = [
  { id: "chat", workspace: "ai" },
  { id: "cockpit", workspace: "trade" },
  { id: "labMap", workspace: "lab" },
  { id: "riskHub", workspace: "control" },
  { id: "more", workspace: "utilities" }
];

export const MOBILE_WORKSPACE_NAV = {
  ai: [{ id: "chat" }, { id: "watch" }, { id: "intelligence" }, { id: "eventsTasks" }],
  trade: [{ id: "cockpit" }, { id: "positions" }, { id: "executionReview" }, { id: "tradeLedger" }],
  lab: [{ id: "labMap" }, { id: "knowledgeBase" }, { id: "strategyLib" }, { id: "capabilityLib" }, { id: "labReviews" }],
  control: [{ id: "riskHub" }, { id: "riskSettings" }, { id: "eventRisk" }]
};

export const MOBILE_MORE_UTILITIES = [{ id: "operationsCenter" }, { id: "systemSettings" }];

export const mobileWorkspaceDestinations = (workspace) => MOBILE_WORKSPACE_NAV[workspace] || [];

export const MOBILE_NAV_PRESENTATION = {
  chat: { label: ["AI 交易员", "AI Trader"], code: "01 · AGENT WORKSITE", iconId: "bot" },
  watch: { label: ["实时盯盘", "Live Watch"], code: "WATCH · LIVE", iconId: "gauge", hint: ["判断、条件与失效", "Theses, conditions, and invalidation"] },
  cockpit: { label: ["Live Desk", "Live Desk"], code: "02 · LIVE EXECUTION", iconId: "pieChart" },
  positions: { label: ["持仓", "Positions"], code: "POSITIONS · LIVE", iconId: "pieChart" },
  executionReview: { label: ["执行与复盘", "Execution & Review"], code: "EXECUTION · REVIEW", iconId: "clipboardList", hint: ["执行、成交与复盘入口", "Execution, fills, and review entry"] },
  tradeLedger: { label: ["委托与成交", "Orders & Fills"], code: "ORDERS · FILLS", iconId: "receiptText", hint: ["真实生命周期流水", "Authoritative lifecycle ledger"] },
  riskHub: { label: ["Control", "Control"], code: "04 · RISK GOVERNANCE", iconId: "shieldCheck" },
  riskSettings: { label: ["风险规则", "Risk rules"], code: "CONTROL · RULES", iconId: "shield" },
  eventRisk: { label: ["事件风险", "Event risk"], code: "CONTROL · EVENTS", iconId: "calendarClock" },
  labMap: { label: ["Lab", "Lab"], code: "03 · RESEARCH & RELEASE", iconId: "gitBranch" },
  knowledgeBase: { label: ["知识孵化", "Knowledge Incubation"], code: "LAB · INCUBATION", iconId: "bookOpen", hint: ["来源、证据与候选", "Sources, evidence, and candidates"] },
  capabilityLib: { label: ["能力库", "Capabilities"], code: "CAPABILITY · LIB", iconId: "wrench", hint: ["工具、工作流与 MCP", "Tools, workflows, and MCP"] },
  strategyLib: { label: ["策略库", "Strategy"], code: "STRATEGY · LIB", iconId: "rocket", hint: ["策略目录与验证", "Catalog and validation"] },
  labReviews: { label: ["交易复盘", "Trade Reviews"], code: "LAB · REVIEWS", iconId: "bookOpen", hint: ["真实结果、归因与改进候选", "Outcomes, attribution, and improvement candidates"] },
  intelligence: { label: ["情报中心", "Intelligence"], code: "INTEL · BRIEF", iconId: "globe", hint: ["今日摘要、快讯与来源", "Brief, flashes, and sources"] },
  eventsTasks: { label: ["事件日历", "Events"], code: "EVENTS · TASKS", iconId: "calendarClock", hint: ["事件、影响与风险窗口", "Events, impact, and risk windows"] },
  operationsCenter: { label: ["运行与恢复", "Operations & Recovery"], code: "05 · SYSTEM OPERATIONS", iconId: "activity", group: "OPERATIONS", hint: ["系统健康、任务、恢复、通知与审计", "Health, tasks, recovery, notices, and audit"] },
  systemSettings: { label: ["配置中心", "Configuration"], code: "CFG · CONFIGURATION REGISTRY", iconId: "settings", hint: ["交易边界、规则、连接与治理", "Trading boundaries, rules, connections, and governance"] },
  more: { label: ["更多", "More"], code: "MORE · UTILITIES", iconId: "moreHorizontal" }
};
