import { CapabilityWorkspace } from "./CapabilityWorkspace.jsx";
import { KnowledgeWorkspace } from "./KnowledgeWorkspace.jsx";
import { MobileCapabilityScreen } from "./MobileCapabilityScreen.jsx";
import { MobileKnowledgeScreen } from "./MobileKnowledgeScreen.jsx";
import { MobileRelationshipScreen } from "./MobileRelationshipScreen.jsx";
import { MobileReviewReleaseScreen } from "./MobileReviewReleaseScreen.jsx";
import { MobileStrategyScreen } from "./MobileStrategyScreen.jsx";
import { RelationshipWorkspace } from "./RelationshipWorkspace.jsx";
import { ReviewReleaseWorkspace } from "./ReviewReleaseWorkspace.jsx";
import { StrategyWorkspace } from "./StrategyWorkspace.jsx";

const surface = ({ id, workspaceId, route, identity, actions, state, desktopComponent, desktopEntry, mobileComponent, mobileEntry, permission = "authenticated identity + existing server-authoritative RBAC" }) => Object.freeze({
  id,
  domainId: "assets",
  workspaceId,
  route,
  objectIdentity: identity,
  actionBoundary: actions,
  permissionBoundary: permission,
  resourceStateBoundary: state,
  desktop: Object.freeze({ component: desktopComponent, entry: desktopEntry }),
  mobile: Object.freeze({ component: mobileComponent, entry: mobileEntry })
});

const relationship = (id, identity, entry) => surface({
  id, workspaceId: "relationships", route: "labMap", identity,
  actions: "read-only canonical selection and navigation; relationships never mutate an asset",
  state: "only explicit object references form edges; absent references remain no-result",
  desktopComponent: RelationshipWorkspace, desktopEntry: `智能资产 → 关系总览 → ${entry}`,
  mobileComponent: MobileRelationshipScreen, mobileEntry: `智能资产 → 关系链 → ${entry}`
});
const knowledge = (id, identity, actions, entry) => surface({
  id, workspaceId: "knowledge", route: "knowledgeBase", identity, actions,
  state: "knowledge source parse state, evidence provenance, candidate lifecycle and server result remain separate",
  desktopComponent: KnowledgeWorkspace, desktopEntry: `智能资产 → 知识库与孵化器 → ${entry}`,
  mobileComponent: MobileKnowledgeScreen, mobileEntry: `智能资产 → 知识库 → ${entry}`
});
const strategy = (id, identity, actions, entry) => surface({
  id, workspaceId: "strategies", route: "strategyLib", identity, actions,
  state: "strategy provenance, version, generated tests, OOS coverage and release state remain explicit",
  desktopComponent: StrategyWorkspace, desktopEntry: `智能资产 → 策略库 → ${entry}`,
  mobileComponent: MobileStrategyScreen, mobileEntry: `智能资产 → 策略 → ${entry}`
});
const capability = (id, identity, actions, entry) => surface({
  id, workspaceId: "capabilities", route: "capabilityLib", identity, actions,
  state: "capability provenance, health, version, calls and grant availability stay independently visible",
  desktopComponent: CapabilityWorkspace, desktopEntry: `智能资产 → 能力库 → ${entry}`,
  mobileComponent: MobileCapabilityScreen, mobileEntry: `智能资产 → 能力 → ${entry}`
});
const review = (id, identity, actions, entry, permission) => surface({
  id, workspaceId: "reviews", route: "labReviews", identity, actions, permission,
  state: "completed review, evidence, candidate decision, validation and release states never collapse into one success",
  desktopComponent: ReviewReleaseWorkspace, desktopEntry: `智能资产 → 复盘与发布 → ${entry}`,
  mobileComponent: MobileReviewReleaseScreen, mobileEntry: `智能资产 → 复盘与发布 → ${entry}`
});

export const ASSET_CAPABILITY_SURFACES = Object.freeze({
  "lab.research-map": relationship("lab.research-map", "canonical Knowledge, Strategy, Capability, Mission, Review, Lesson and Owner candidate references", "资产关系图"),
  "lab.knowledge-import": knowledge("lab.knowledge-import", "Knowledge source by immutable source id", "existing source import/configuration and parse-real boundaries only", "来源登记簿"),
  "lab.knowledge-evidence": knowledge("lab.knowledge-evidence", "Evidence by chunk id plus sourceId and source location", "read-only evidence selection; source text is never execution authority", "原文证据"),
  "lab.knowledge-graph": knowledge("lab.knowledge-graph", "explicit sourceId edges between source, evidence and candidate", "read-only relationship inspection", "来源关系"),
  "lab.knowledge-artifacts": knowledge("lab.knowledge-artifacts", "Knowledge candidate by unique candidate id and supported artifact type", "existing ignore, adopt and approve-prompt candidate actions", "候选产物"),
  "lab.knowledge-workflows": knowledge("lab.knowledge-workflows", "knowledge workflow candidate by candidate id and current content version", "existing candidate lifecycle; approval does not bypass Registry validation", "Workflow 候选"),
  "lab.strategy-core": strategy("lab.strategy-core", "Strategy product or version through canonical product/version precedence", "existing eligible-set enable/disable boundary with protected confirmation", "正式策略 Registry"),
  "lab.strategy-studio": strategy("lab.strategy-studio", "Strategy draft by draft id and immutable generated version", "existing draft, generated-test, backtest and publish endpoints", "Strategy Studio"),
  "lab.strategy-knowledge": strategy("lab.strategy-knowledge", "knowledge-derived Strategy version retaining sourceId provenance", "same Registry validation and release boundary as every strategy", "知识生成策略"),
  "lab.strategy-imported": strategy("lab.strategy-imported", "imported Strategy version retaining import provenance", "same Registry validation and release boundary as every strategy", "导入策略"),
  "lab.strategy-adaptive": strategy("lab.strategy-adaptive", "Owner candidate linked to an immutable candidate Strategy version", "staged validation and explicit Owner release only", "适应性候选"),
  "lab.capability-native": capability("lab.capability-native", "code-registered Capability id", "native capability is system-managed and not toggled by Registry UI", "原生能力"),
  "lab.capability-workflow": capability("lab.capability-workflow", "knowledge workflow Capability id with source provenance", "existing skill enable/disable boundary after validation", "Workflow 能力"),
  "lab.capability-imported-skill": capability("lab.capability-imported-skill", "imported Skill id plus fingerprint/version", "existing skill validation, paper and Owner approval boundaries", "导入 Skill"),
  "lab.capability-mcp": capability("lab.capability-mcp", "MCP server id plus explicitly declared tools", "MCP remains unavailable without an explicit current grant; unknown tools default deny", "MCP 授权"),
  "lab.capability-connectors": capability("lab.capability-connectors", "code-registered connector Capability id", "connector configuration remains in existing protected configuration surface", "连接器"),
  "lab.trade-review": review("lab.trade-review", "Review by explicit review id and financially reconciled trade lifecycle", "read-only review evidence plus existing review output path", "交易复盘"),
  "lab.owner-review": review("lab.owner-review", "Owner candidate by improvement id linked to review evidence", "existing Owner decision, pure-forward and evidence-bound verify actions", "Owner 队列", "authenticated Owner + existing server-authoritative RBAC")
});
