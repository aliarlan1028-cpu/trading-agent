import { buildPatrolView } from "../../../patrolView.js";
import { buildEventRows } from "../../../viewData.js";

const unavailable = "Unavailable";
const list = (value) => Array.isArray(value) ? value : [];
const hasOwn = (value, key) => Boolean(value && Object.hasOwn(value, key));
const nonEmptyText = (value) => typeof value === "string" && value.trim().length > 0;
const canonicalIdentifier = (value) => nonEmptyText(value) && value === value.trim();

function plainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function cloneData(value, seen = new WeakMap()) {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value);
    const copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneData(item, seen));
    return copy;
  }
  if (!plainRecord(value)) return undefined;
  if (seen.has(value)) return seen.get(value);
  const copy = {};
  seen.set(value, copy);
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return undefined; }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor)) continue;
    copy[key] = cloneData(descriptor.value, seen);
  }
  return copy;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    if ("value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

const freezeProjection = (value) => deepFreeze(cloneData(value));

function validEventInput(row) {
  return plainRecord(row) && [row.title, row.shortTitle, row.name].some(nonEmptyText);
}

function safePatrolView(message) {
  if (!plainRecord(message)) return null;
  const safeMessage = cloneData(message);
  if (!plainRecord(safeMessage) || !plainRecord(safeMessage.capabilityCoverage)) return null;
  try { return buildPatrolView(safeMessage); } catch { return null; }
}

function uniquelyIdentified(rows) {
  const valid = list(rows).filter((row) => row && typeof row === "object" && canonicalIdentifier(row.id));
  const counts = new Map();
  for (const row of valid) counts.set(row.id, (counts.get(row.id) || 0) + 1);
  return valid.filter((row) => counts.get(row.id) === 1);
}

const stagePresentation = Object.freeze(Object.assign(Object.create(null), {
  intent: ["正在理解任务", "working"],
  sense: ["正在检查市场", "working"],
  recall: ["正在核对相关证据", "working"],
  plan: ["正在形成下一步计划", "working"],
  guard: ["正在验证风险边界", "attention"],
  approval: ["需要你确认", "approval"],
  execute: ["正在等待权威执行结果", "working"],
  monitor: ["正在监控结果", "monitoring"],
  review: ["正在整理复盘证据", "reviewing"]
}));

const statusStage = Object.freeze({
  created: "intent",
  running: "intent",
  setup_required: "intent",
  awaiting_mandate_confirmation: "approval",
  awaiting_approval: "approval",
  approved: "execute",
  blocked: "guard",
  patrol_only: "monitor",
  observing: "monitor",
  paused: "monitor",
  stopped: "review",
  completed: "review",
  failed: "review"
});

const phaseStage = Object.freeze({
  setup_required: "intent",
  mandate_draft: "plan",
  mandate_checking: "guard",
  observe: "sense",
  observing: "sense",
  fast_move: "sense",
  opportunity: "sense",
  news: "sense",
  regime: "sense",
  watch: "sense",
  analyzing: "recall",
  accounting: "recall",
  forced_evidence: "recall",
  capability_preflight: "recall",
  planning: "plan",
  decision: "plan",
  risk_checking: "guard",
  awaiting_approval: "approval",
  approved: "execute"
});

const statusOverridesPhase = new Set([
  "setup_required", "awaiting_mandate_confirmation", "awaiting_approval", "approved", "blocked",
  "patrol_only", "observing", "paused", "stopped", "completed", "failed"
]);

function auditedStage(map, value) {
  const key = nonEmptyText(value) ? value.trim().toLowerCase() : null;
  return key && Object.hasOwn(map, key) ? map[key] : null;
}

export function missionStagePresentation(stage) {
  const id = nonEmptyText(stage) ? stage.trim().toLowerCase() : null;
  const presentation = id && Object.hasOwn(stagePresentation, id) ? stagePresentation[id] : null;
  return Object.freeze({
    id,
    label: presentation?.[0] || unavailable,
    tone: presentation?.[1] || "unavailable"
  });
}

function linkedPlanFor(run, plans) {
  const runId = run.id;
  const declaredPlanId = canonicalIdentifier(run.tradePlanId) ? run.tradePlanId : null;
  if (declaredPlanId !== null) {
    return plans.find((plan) => plan.id === declaredPlanId) || null;
  }
  const linked = plans.filter((plan) => canonicalIdentifier(plan.agentRunId) && plan.agentRunId === runId);
  return linked.length === 1 ? linked[0] : null;
}

function countEvidenceIds(value) {
  if (!Array.isArray(value)) return unavailable;
  if (!value.every(canonicalIdentifier)) return unavailable;
  return new Set(value).size;
}

function traceTargetsRun(trace, runId) {
  if (!trace || typeof trace !== "object") return false;
  if (trace.agentRunId === runId || trace.runId === runId) return true;
  return trace.objectId === runId
    && /^agent[ _-]?run$/i.test(String(trace.objectType || "").trim());
}

function evidenceCountFor(run, plan, traces) {
  if (hasOwn(run, "evidenceCount")) {
    return Number.isInteger(run.evidenceCount) && run.evidenceCount >= 0
      ? run.evidenceCount
      : unavailable;
  }
  if (hasOwn(run, "evidenceIds")) return countEvidenceIds(run.evidenceIds);
  if (hasOwn(plan, "evidenceIds")) return countEvidenceIds(plan.evidenceIds);

  const relevantTraces = traces.filter((trace) => traceTargetsRun(trace, run.id));
  if (!relevantTraces.length) return unavailable;
  return countEvidenceIds(relevantTraces.map((trace) => trace.evidenceId));
}

function nextActionFor(run) {
  const presentation = run.presentation;
  return presentation && typeof presentation === "object" && nonEmptyText(presentation.nextAction)
    ? presentation.nextAction
    : unavailable;
}

function stageForRun(run) {
  const status = nonEmptyText(run.status) ? run.status.trim().toLowerCase() : null;
  const statusValue = auditedStage(statusStage, status);
  if (statusValue && statusOverridesPhase.has(status)) return statusValue;
  const phaseValue = list(run.steps)
    .slice()
    .reverse()
    .map((step) => auditedStage(phaseStage, step?.phase))
    .find(Boolean);
  return phaseValue || statusValue;
}

function missionFor(run, plans, traces) {
  const plan = linkedPlanFor(run, plans);
  const latestStep = list(run.steps).slice().reverse().find((step) => (
    step && typeof step === "object" && (nonEmptyText(step.title) || nonEmptyText(step.summary))
  ));
  return Object.freeze({
    id: run.id,
    title: nonEmptyText(run.goal)
      ? run.goal
      : nonEmptyText(latestStep?.title) ? latestStep.title : nonEmptyText(latestStep?.summary) ? latestStep.summary : unavailable,
    summary: nonEmptyText(latestStep?.summary) ? latestStep.summary : unavailable,
    status: nonEmptyText(run.status) ? run.status : unavailable,
    stage: missionStagePresentation(stageForRun(run)),
    evidenceCount: evidenceCountFor(run, plan, traces),
    nextAction: nextActionFor(run),
    approval: plan ? Object.freeze({
      planId: plan.id,
      status: nonEmptyText(plan.status) ? plan.status : unavailable
    }) : null
  });
}

function intelligenceProjection(row, { id, kind, source }) {
  const safeRow = cloneData(row);
  const canonicalId = canonicalIdentifier(id) ? id : null;
  return deepFreeze({
    ...(plainRecord(safeRow) ? safeRow : {}),
    provider: nonEmptyText(safeRow?.sourceName) ? safeRow.sourceName : nonEmptyText(safeRow?.source) ? safeRow.source : null,
    id: canonicalId,
    identity: canonicalId || unavailable,
    kind,
    source,
    selectable: canonicalId !== null
  });
}

export function buildAiDomainModel(data = {}) {
  const safeData = cloneData(data);
  const source = plainRecord(safeData) ? safeData : {};
  const plans = uniquelyIdentified(source.tradePlans);
  const traces = list(source.traces);
  const messages = Array.isArray(source.chatMessages)
    ? source.chatMessages
    : list(source.messages);
  const eventInput = {
    events: list(source.events).map((row) => cloneData(row)).filter(validEventInput),
    marketCalendarEvents: list(source.marketCalendarEvents).map((row) => cloneData(row)).filter(validEventInput)
  };
  const events = buildEventRows(eventInput)
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => intelligenceProjection(row, {
      id: canonicalIdentifier(row.id) ? row.id : row.eventId,
      kind: "event",
      source: "events"
    }));
  const news = list(source.newsFeed)
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => intelligenceProjection(row, { id: row.id, kind: "news", source: "newsFeed" }));
  const movers = list(source.marketMovers?.movers)
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => intelligenceProjection(row, {
      id: canonicalIdentifier(row.id) ? row.id : canonicalIdentifier(row.instId) ? row.instId : row.symbol,
      kind: "market_mover",
      source: "marketMovers.movers"
    }));
  const knowledgeSource = Array.isArray(source.knowledge) ? source.knowledge : list(source.knowledge?.sources);
  const knowledge = knowledgeSource
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .map((row) => intelligenceProjection(row, { id: row.id, kind: "knowledge", source: "knowledge" }));

  return Object.freeze({
    missions: Object.freeze(uniquelyIdentified(source.agentRuns)
      .map((run) => missionFor(run, plans, traces))),
    patrols: Object.freeze(messages.map(safePatrolView).filter(Boolean).map(freezeProjection)),
    intelligence: Object.freeze([...news, ...events, ...movers, ...knowledge]),
    watches: Object.freeze(list(source.watchTriggers).map(freezeProjection).filter(plainRecord)),
    events: Object.freeze(events)
  });
}
