import {
  buildCapabilityCatalogRows,
  buildStrategyCatalogRows,
  isApprovedKnowledgeWorkflow,
  isCompletedTradeReview,
  isPublishedImportedSkill,
  isPublishedKnowledgeStrategy
} from "./viewData.js";

const list = (value) => Array.isArray(value) ? value : [];
const statusText = (item) => String(item?.status || item?.state || "").toLowerCase();
const identity = (item = {}) => item.serverName || item.id || item.toolName || item.name || item.title;
const isRejected = (item) => /ignored|rejected|retired|superseded|已忽略|已拒绝|已退役/.test(statusText(item));
const isApprovedRule = (item) => /^(approved|已批准)$/.test(String(item?.status || ""));

function sourceState(source, knowledge) {
  const status = statusText(source);
  const failed = /fail|error|失败|错误|无可用|empty|unsupported/.test(status);
  const processing = /processing|parsing|queued|indexing|处理中|解析中/.test(status);
  const chunks = list(knowledge.chunks).filter((item) => item.sourceId === source.id).length;
  const searchable = !failed && !processing && (
    chunks > 0 || /parsed|ready|indexed|searchable|completed|complete|已解析|可检索/.test(status)
  );
  return { failed, processing, searchable };
}

function classifyCapabilityOrigins(data, rows) {
  const systemIds = new Set([
    ...list(data.analysisEngine?.tools),
    ...list(data.tools)
  ].map(identity).filter(Boolean));
  const importedIds = new Set(list(data.skills).map(identity).filter(Boolean));
  return rows.reduce((counts, item) => {
    const id = identity(item);
    if (item.knowledgeWorkflow) counts.knowledge += 1;
    else if (item.category === "mcp") counts.mcp += 1;
    else if (item.native === true || item.connector || systemIds.has(id)) counts.system += 1;
    else if (importedIds.has(id)) counts.imported += 1;
    else counts.registered += 1;
    return counts;
  }, { system: 0, knowledge: 0, imported: 0, mcp: 0, registered: 0 });
}

export function buildResearchMap(data = {}) {
  const knowledge = data.knowledge || {};
  const sources = list(knowledge.sources).filter((item) => !["doctrine", "manual_curated"].includes(item.type));
  const sourceStates = sources.map((source) => sourceState(source, knowledge));
  const candidates = list(knowledge.candidates).filter((item) => !isRejected(item));
  const rules = list(knowledge.ruleProposals);
  const workflows = list(knowledge.workflows);
  const strategySkills = list(knowledge.tradingSkills);
  const methods = list(knowledge.tradingMethods);
  const pendingRules = rules.filter((item) => !isApprovedRule(item) && !isRejected(item));
  const incubatingStrategies = strategySkills.filter((item) => !isPublishedKnowledgeStrategy(item) && !isRejected(item));
  const workflowCandidates = candidates.filter((item) => item.type === "workflow");
  const lensCandidates = candidates.filter((item) => item.type === "lens");
  const strategyCandidates = candidates.filter((item) => item.type === "strategy");
  const unpublishedWorkflows = workflows.filter((item) => !isApprovedKnowledgeWorkflow(item) && !isRejected(item));
  const importedSkillCandidates = list(data.skills).filter((item) => item.kind !== "strategy" && !isPublishedImportedSkill(item) && !isRejected(item));

  const strategyCatalog = buildStrategyCatalogRows(data);
  const strategyRows = strategyCatalog.rows;
  const strategyOrigins = strategyRows.reduce((counts, item) => {
    if (item.recordType === "product" || item.recordType === "research") counts.system += 1;
    else if (item.methodId || item.sourceMethodId) counts.knowledge += 1;
    else counts.imported += 1;
    return counts;
  }, { system: 0, knowledge: 0, imported: 0 });

  const capabilityRows = buildCapabilityCatalogRows(data);
  const capabilityOrigins = classifyCapabilityOrigins(data, capabilityRows);
  const reviews = list(data.reviews);
  const ownerLoop = data.ownerReviewLoop || {};
  const improvements = list(ownerLoop.improvements);
  const lessons = list(ownerLoop.lessons);
  const pendingOwner = ownerLoop.summary?.pendingOwner ?? improvements.filter((item) => item.state === "pending_owner").length;
  const validating = ownerLoop.summary?.validating ?? improvements.filter((item) => item.state === "validating").length;
  const candidateLessons = ownerLoop.summary?.candidateLessons ?? lessons.filter((item) => ["candidate", "candidate_legacy", "observing"].includes(item.status)).length;

  const actionQueue = [];
  const addAction = (id, count, label, labelEn, detail, detailEn, destination, tone = "neutral") => {
    if (count > 0) actionQueue.push({ id, count, label, labelEn, detail, detailEn, destination, tone });
  };
  addAction("failed-sources", sourceStates.filter((item) => item.failed).length, "来源解析失败", "Sources need attention", "失败来源不会进入检索或 AI 证据包", "Failed sources cannot enter retrieval or AI evidence", "researchCenter:knowledge", "danger");
  addAction("processing-sources", sourceStates.filter((item) => item.processing).length, "来源仍在解析", "Sources still processing", "完成索引后才可检索引用", "They become citable only after indexing", "researchCenter:knowledge");
  addAction("pending-rules", pendingRules.length, "候选纪律待审批", "Rules await approval", "未批准规则不会成为硬风控", "Unapproved rules never become hard controls", "researchCenter:knowledge", "warning");
  addAction("strategy-incubation", incubatingStrategies.length + strategyCandidates.length, "策略候选待验证", "Strategy candidates need validation", "继续历史、样本外或纯前向验证", "Continue historical, OOS, or pure-forward validation", "researchCenter:knowledge", "warning");
  addAction("capability-incubation", workflowCandidates.length + lensCandidates.length + unpublishedWorkflows.length + importedSkillCandidates.length, "能力候选待处理", "Capability candidates need review", "审批当前内容版本或完成安全验证", "Approve the current version or complete safety validation", "researchCenter:knowledge", "warning");
  addAction("owner-pending", pendingOwner, "Owner 决策待处理", "Owner decisions pending", "候选改进不会自行写回策略或能力", "Improvements never write themselves into strategies or capabilities", "ownerReviewWorkspace", "warning");
  addAction("owner-validating", validating, "改进正在验证", "Improvements validating", "使用正式证据完成分阶段核验", "Complete staged verification with authoritative evidence", "ownerReviewWorkspace");

  return {
    sources: {
      total: sources.length,
      searchable: sourceStates.filter((item) => item.searchable).length,
      processing: sourceStates.filter((item) => item.processing).length,
      failed: sourceStates.filter((item) => item.failed).length,
      chunks: list(knowledge.chunks).length
    },
    incubation: {
      methods: methods.length,
      pendingRules: pendingRules.length,
      strategyCandidates: strategyCandidates.length,
      incubatingStrategies: incubatingStrategies.length,
      capabilityCandidates: workflowCandidates.length + lensCandidates.length + unpublishedWorkflows.length + importedSkillCandidates.length,
      studioDrafts: list(data.strategyStudio?.drafts).length
    },
    strategies: {
      total: strategyRows.length,
      origins: strategyOrigins,
      active: strategyRows.filter((item) => /validated_active|active|live_probation|published/.test(statusText(item))).length,
      validating: strategyRows.filter((item) => /research|validation|compiled|historical|paper/.test(statusText(item))).length,
      archived: strategyRows.filter((item) => /degraded|retired|superseded/.test(statusText(item))).length
    },
    capabilities: {
      total: capabilityRows.length,
      origins: capabilityOrigins,
      enabled: capabilityRows.filter((item) => item.enabled).length,
      candidate: capabilityRows.filter((item) => item.candidate).length,
      disabled: capabilityRows.filter((item) => item.disabled).length,
      needsAttention: capabilityRows.filter((item) => ["degraded", "blocked"].includes(item.health)).length
    },
    learning: {
      completedReviews: reviews.filter(isCompletedTradeReview).length,
      candidateLessons,
      pendingOwner,
      validating
    },
    actionQueue
  };
}
