import { KORDYN_V2_PRODUCTION_FIXTURE_JSON } from "./kordyn-v2-production-fixture.js";

const base = JSON.parse(KORDYN_V2_PRODUCTION_FIXTURE_JSON);
const asOf = "2026-09-01T05:15:00.000Z";
const longIdentifier = `source-${"regional-authority-".repeat(18)}current`;
const longSourceName = `Plan 06 权威来源 / English authoritative source / ${"cross-region recovery evidence · ".repeat(14)}`;
const longEvidence = `完整证据段落 / Complete evidence paragraph. ${"账户、风险、能力、知识与执行结果保持同一来源链。 ".repeat(220)}`;

const approvalMission = Object.freeze({
  id: "run-plan06-accessibility-approval",
  goal: "SOL 跨市场结构确认 / SOL cross-market structure approval",
  status: "awaiting_approval",
  tradePlanId: "plan-plan06-accessibility-approval",
  evidenceCount: 4,
  presentation: { nextAction: "需要你确认" },
  steps: Object.freeze([
    { id: "step-plan06-sense", phase: "observe", title: "正在检查市场", summary: "Market facts loaded" },
    { id: "step-plan06-guard", phase: "risk_checking", title: "正在验证风险边界", summary: "12/12 boundaries verified" },
    { id: "step-plan06-approval", phase: "awaiting_approval", title: "需要你确认", summary: "No order has been submitted" }
  ]),
  createdAt: asOf,
  updatedAt: asOf
});

const approvalPlan = Object.freeze({
  id: "plan-plan06-accessibility-approval",
  agentRunId: approvalMission.id,
  status: "awaiting_approval",
  symbol: "SOL/USDT",
  direction: "long",
  entry_range: [142.2, 143.1],
  stopLoss: 138.8,
  takeProfit: [149.5, 154],
  leverage: 2,
  max_loss_pct: 0.3,
  strategy: "Breakout Retest v3",
  evidenceIds: ["evidence-market-sol", "evidence-account", "evidence-mandate"],
  lastRiskCheck: {
    id: "risk-check-plan06",
    passed: true,
    summary: "12/12 boundaries verified",
    warnings: ["SOL remains outside the standing allowlist"],
    blockers: []
  },
  accountImpact: {
    equityUsdt: 28640.72,
    availableMarginUsdt: 13870.1,
    openPositionCount: 2,
    projectedOpenPositionCount: 3,
    estimatedMaxLossUsdt: 85.92
  },
  createdAt: asOf
});

const largeAuditList = Object.freeze(Array.from({ length: 200 }, (_, index) => Object.freeze({
  id: `audit-plan06-${String(index + 1).padStart(3, "0")}`,
  action: index === 0 ? `agent.observe.${longIdentifier}` : index % 2 ? "risk.evaluate" : "agent.observe",
  actor: index % 3 ? "system" : "owner-fixture",
  resource: index === 0 ? longIdentifier : `object-${index + 1}`,
  status: "recorded",
  traceId: `trace-plan06-${index + 1}`,
  createdAt: asOf
})));

export const KORDYN_V2_ACCESSIBILITY_FIXTURE_JSON = JSON.stringify({
  ...base,
  revision: 906,
  source: longSourceName,
  asOf,
  lastValidSource: longSourceName,
  lastValidAt: asOf,
  user: {
    ...base.user,
    id: "owner-plan06-accessibility",
    name: "Owner / 所有者 · Cross-region operations"
  },
  permissions: ["*"],
  resourceState: {
    ...base.resourceState,
    chat: "loaded",
    cockpit: "loaded",
    operationsCenter: "loaded",
    researchCenter: "loaded",
    riskCenter: "loaded",
    systemSettings: "loaded"
  },
  agentRuns: [approvalMission, ...(base.agentRuns || [])],
  tradePlans: [approvalPlan, ...(base.tradePlans || [])],
  auditLogs: largeAuditList,
  traces: [
    ...(base.traces || []),
    { id: "trace-plan06-long", agentRunId: approvalMission.id, workspaceId: "ai", objectType: "Agent run", objectId: approvalMission.id, stage: "Recall", status: "complete", detail: longEvidence, evidenceId: longIdentifier }
  ],
  knowledge: {
    ...(base.knowledge || {}),
    sources: [
      { id: longIdentifier, title: longSourceName, type: "document", status: "parsed", updatedAt: asOf },
      ...((base.knowledge && base.knowledge.sources) || [])
    ],
    chunks: [
      { id: "evidence-plan06-long", sourceId: longIdentifier, page: 128, type: "source_excerpt", text: longEvidence },
      ...((base.knowledge && base.knowledge.chunks) || [])
    ]
  },
  notifications: Array.from({ length: 200 }, (_, index) => ({
    id: `notification-plan06-${index + 1}`,
    title: index === 0 ? "English and 中文 operational notification with a deliberately long source identity" : `运行通知 ${index + 1}`,
    status: "delivered",
    severity: index % 7 === 0 ? "warning" : "info",
    read: index % 3 === 0,
    source: longIdentifier,
    createdAt: asOf
  }))
});

export function kordynV2AccessibilityFixture(state = "loaded") {
  const fixture = JSON.parse(KORDYN_V2_ACCESSIBILITY_FIXTURE_JSON);
  const kind = typeof state === "string" && state ? state : "loaded";
  fixture.resourceState = Object.fromEntries(Object.keys(fixture.resourceState).map((key) => [key, kind]));
  return JSON.stringify(fixture);
}
