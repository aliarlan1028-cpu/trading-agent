import { buildResearchMap } from "../../../researchMap.js";
import {
  buildCapabilityCatalogRows,
  buildStrategyCatalogRows,
  strategyBacktestCoverage
} from "../../../viewData.js";
import { assetLifecycle } from "./lifecycle.js";
import { assetProvenance } from "./provenance.js";

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function list(value) {
  try { return Array.isArray(value) ? value.filter((row) => record(row)) : []; } catch { return []; }
}

function scalarList(value) {
  try { return Array.isArray(value) ? value : []; } catch { return []; }
}

function text(value, maxLength = 500) {
  return typeof value === "string" && value.trim() && value.length <= maxLength ? value.trim() : null;
}

function rootSnapshot(value) {
  const root = record(value);
  if (!root) return {};
  try {
    const descriptors = Object.getOwnPropertyDescriptors(root);
    const snapshot = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Object.hasOwn(descriptor, "value")) snapshot[key] = descriptor.value;
    }
    return snapshot;
  } catch {
    return {};
  }
}

function identity(row) {
  return text(row?.id, 240)
    || text(row?.versionId, 240)
    || text(row?.strategyVersionId, 240)
    || text(row?.serverName, 240)
    || text(row?.toolName, 240);
}

function present(row, preferredKind = null) {
  return {
    ...row,
    provenance: assetProvenance(row, preferredKind),
    lifecycle: assetLifecycle(row)
  };
}

function preferredStrategyKind(row) {
  if (["product", "research"].includes(row.recordType)) return "system-native";
  if (row.methodId || row.sourceMethodId) return "knowledge-derived";
  return "imported";
}

function preferredCapabilityKind(row) {
  if (row.knowledgeWorkflow) return "knowledge-derived";
  if (row.native === true || row.connector || row.category === "mcp") return "system-native";
  return "imported";
}

function node(type, row, label) {
  const id = identity(row);
  if (!id) return null;
  const selectionType = type === "Mission"
    ? "Agent run"
    : type === "Knowledge source" ? "Knowledge"
      : type === "Strategy" && row.recordType === "product" ? "Strategy product"
        : type;
  const selectionId = type === "Strategy" && row.recordType === "product"
    ? text(row.versionId, 240) || id
    : type === "Strategy" && row.recordType === "research"
      ? id.replace(/^native_/u, "")
      : id;
  return {
    id: `${type}:${id}`,
    objectId: id,
    type,
    selectionId,
    selectionType,
    label: text(row.name, 500) || text(row.title, 500) || text(row.label, 500) || id,
    status: row.lifecycle?.stage || assetLifecycle(row).stage,
    provenance: row.provenance || assetProvenance(row),
    raw: row
  };
}

function aliases(type, row) {
  const candidates = type === "Strategy"
    ? [row.id, row.versionId, row.strategyVersionId, row.publishVersionId]
    : type === "Capability"
      ? [row.id, row.serverName, row.toolName]
      : [row.id];
  return [...new Set(candidates.map((value) => text(value, 240)).filter(Boolean))];
}

function buildRelationships({ missions, sources, strategies, capabilities, reviews, candidates, lessons, improvements }) {
  const collections = [
    ["Mission", missions],
    ["Knowledge source", sources],
    ["Strategy", strategies],
    ["Capability", capabilities],
    ["Review", reviews],
    ["Candidate", candidates],
    ["Lesson", lessons],
    ["Owner candidate", improvements]
  ];
  const nodes = collections.flatMap(([type, rows]) => rows.map((row) => node(type, row)).filter(Boolean));
  const byTypeAlias = new Map();
  for (const [type, rows] of collections) {
    const lookup = new Map();
    for (const row of rows) {
      const target = node(type, row);
      if (!target) continue;
      for (const alias of aliases(type, row)) if (!lookup.has(alias)) lookup.set(alias, target.id);
    }
    byTypeAlias.set(type, lookup);
  }

  const edges = [];
  const seen = new Set();
  const add = (fromType, fromAlias, toType, toAlias, relation) => {
    const from = byTypeAlias.get(fromType)?.get(text(fromAlias, 240));
    const to = byTypeAlias.get(toType)?.get(text(toAlias, 240));
    if (!from || !to || from === to) return;
    const key = `${from}|${relation}|${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ id: `relation-${edges.length + 1}`, from, to, relation, inferred: false });
  };

  for (const strategy of strategies) {
    add("Knowledge source", strategy.provenance?.sourceId, "Strategy", identity(strategy), "derived-from");
  }
  for (const capability of capabilities) {
    add("Knowledge source", capability.provenance?.sourceId, "Capability", identity(capability), "derived-from");
  }
  for (const candidate of candidates) {
    add("Knowledge source", candidate.provenance?.sourceId, "Candidate", identity(candidate), "extracted-as");
  }
  for (const mission of missions) {
    add("Mission", mission.id, "Strategy", mission.strategyVersionId || mission.strategyId, "uses");
    for (const capabilityId of scalarList(mission.capabilityIds).map((value) => text(value, 240)).filter(Boolean)) {
      add("Mission", mission.id, "Capability", capabilityId, "uses");
    }
    for (const sourceId of scalarList(mission.sourceIds).map((value) => text(value, 240)).filter(Boolean)) {
      add("Knowledge source", sourceId, "Mission", mission.id, "supports");
    }
  }
  for (const review of reviews) {
    add("Strategy", review.strategyVersionId || review.strategyId, "Review", review.id, "reviewed-in");
    add("Mission", review.missionId, "Review", review.id, "reviewed-in");
  }
  for (const lesson of lessons) add("Review", lesson.reviewId, "Lesson", lesson.id, "produced");
  for (const improvement of improvements) add("Review", improvement.reviewId, "Owner candidate", improvement.id, "produced");

  return { nodes, edges };
}

export function buildAssetsDomainModel(input = {}) {
  const data = rootSnapshot(input);
  const knowledge = record(data.knowledge) || {};
  const studio = record(data.strategyStudio) || {};
  const ownerLoop = record(data.ownerReviewLoop) || {};
  const paperReport = record(data.paperReport) || {};

  let strategyRows = [];
  let capabilityRows = [];
  let researchMap = buildResearchMap({});
  try {
    strategyRows = buildStrategyCatalogRows(data).rows;
    capabilityRows = buildCapabilityCatalogRows(data);
    researchMap = buildResearchMap(data);
  } catch {
    strategyRows = [];
    capabilityRows = [];
  }

  const sources = list(knowledge.sources).map((row) => present(row, "imported"));
  const evidence = list(knowledge.chunks).map((row) => present(row, "knowledge-derived"));
  const candidates = list(knowledge.candidates).map((row) => present(row, "knowledge-derived"));
  const methods = list(knowledge.tradingMethods).map((row) => present(row, "knowledge-derived"));
  const rules = list(knowledge.ruleProposals).map((row) => present(row, "knowledge-derived"));
  const workflows = list(knowledge.workflows).map((row) => present(row, "knowledge-derived"));
  const incubatingSkills = list(knowledge.tradingSkills)
    .filter((row) => !["active", "live_probation", "retired", "superseded", "degraded"].includes(String(row.status || "").toLowerCase()))
    .map((row) => present(row, "knowledge-derived"));
  const strategies = strategyRows.map((row) => present(row, preferredStrategyKind(row)));
  const capabilities = capabilityRows.map((row) => present(row, preferredCapabilityKind(row)));
  const backtests = list(studio.backtests);
  const drafts = list(studio.drafts).map((row) => {
    const coverage = strategyBacktestCoverage(row, backtests);
    const testsPassed = row.generatedTests?.status === "passed";
    return {
      ...present(row, "knowledge-derived"),
      validation: { testsPassed, oos: coverage },
      release: {
        ready: testsPassed && coverage.complete && !row.publishVersionId,
        state: row.publishVersionId ? "published" : testsPassed && coverage.complete ? "ready" : "blocked",
        versionId: row.publishVersionId || null
      }
    };
  });
  const reviews = list(data.reviews).map((row) => present(row, "system-native"));
  const lessons = list(ownerLoop.lessons).map((row) => present(row, "system-native"));
  const improvements = list(ownerLoop.improvements).map((row) => present(row, "system-native"));
  const missionRows = [...list(data.agentRuns), ...list(data.missions), ...list(data.aiMissions)]
    .filter((row, index, rows) => rows.findIndex((candidate) => identity(candidate) === identity(row)) === index)
    .map((row) => ({ ...row, title: text(row.title, 500) || text(row.goal, 500) || identity(row) }));
  const missions = missionRows.map((row) => present(row, "system-native"));

  const relationships = buildRelationships({
    missions,
    sources,
    strategies,
    capabilities,
    reviews,
    candidates,
    lessons,
    improvements
  });

  return {
    researchMap,
    relationships,
    sources,
    evidence,
    strategies,
    strategyRegistry: strategies,
    capabilities,
    capabilityRegistry: capabilities,
    incubation: { sources, evidence, candidates, methods, rules, workflows, skills: incubatingSkills },
    studio: { drafts, backtests },
    reviews,
    owner: { lessons, improvements, summary: record(ownerLoop.summary) || null },
    validationRuns: { backtests, paper: list(paperReport.sessions) }
  };
}
