import { buildPatrolView } from "../../../patrolView.js";
import { buildEventRows } from "../../../viewData.js";

const unavailable = "Unavailable";
const hasOwn = (value, key) => Boolean(value && Object.hasOwn(value, key));
const nonEmptyText = (value) => typeof value === "string" && value.trim().length > 0;
const canonicalIdentifier = (value) => nonEmptyText(value)
  && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value);

function arrayClassification(value) {
  try { return Array.isArray(value); } catch { return null; }
}

const list = (value) => arrayClassification(value) === true ? value : [];

function plainRecord(value) {
  if (!value || typeof value !== "object") return false;
  const array = arrayClassification(value);
  if (array !== false) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function cloneData(value, seen = new WeakMap()) {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return value;
  const array = arrayClassification(value);
  if (array === null) return undefined;
  if (array) {
    if (seen.has(value)) return seen.get(value);
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return undefined; }
    const lengthDescriptor = Object.hasOwn(descriptors, "length") ? descriptors.length : null;
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
    if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) return undefined;
    const copy = new Array(length);
    seen.set(value, copy);
    const keys = Object.keys(descriptors);
    for (let offset = 0; offset < keys.length; offset += 1) {
      const key = keys[offset];
      const descriptor = descriptors[key];
      const index = /^(?:0|[1-9]\d*)$/u.test(key) ? Number(key) : -1;
      if (!descriptor.enumerable || !("value" in descriptor) || !Number.isInteger(index) || index < 0 || index >= length) continue;
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: cloneData(descriptor.value, seen),
        writable: true
      });
    }
    return copy;
  }
  if (!plainRecord(value)) return undefined;
  if (seen.has(value)) return seen.get(value);
  const copy = Object.create(null);
  seen.set(value, copy);
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return undefined; }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor)) continue;
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: cloneData(descriptor.value, seen),
      writable: true
    });
  }
  return copy;
}

function ownCanonicalIdentifier(value, key) {
  return plainRecord(value) && hasOwn(value, key) && canonicalIdentifier(value[key])
    ? value[key]
    : null;
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

function eventIdentity(row) {
  return ownCanonicalIdentifier(row, "id") || ownCanonicalIdentifier(row, "eventId");
}

function eventMoment(row) {
  if (hasOwn(row, "due") && row.due) return row.due;
  return hasOwn(row, "startAt") ? row.startAt : null;
}

function eventLabels(row) {
  return [hasOwn(row, "title") ? row.title : null, hasOwn(row, "shortTitle") ? row.shortTitle : null]
    .filter(nonEmptyText);
}

function sameEventTruth(left, right) {
  if (eventMoment(left) !== eventMoment(right)) return false;
  const rightLabels = eventLabels(right);
  return eventLabels(left).some((label) => rightLabels.includes(label));
}

function normalizedEventCandidate(row, provenance) {
  try {
    const normalized = buildEventRows(provenance === "official"
      ? { marketCalendarEvents: [row] }
      : { events: [row] });
    return plainRecord(normalized[0]) ? { provenance, row: normalized[0] } : null;
  } catch {
    return null;
  }
}

function identitySet(candidates) {
  return new Set(candidates.map((candidate) => eventIdentity(candidate.row)).filter((identity) => identity !== null));
}

function selectEventCandidate(group) {
  const canonical = group.filter((candidate) => candidate.provenance === "canonical");
  const official = group.filter((candidate) => candidate.provenance === "official");
  const mirrors = canonical.filter((candidate) => official.some((officialCandidate) => {
    const officialId = eventIdentity(officialCandidate.row);
    return officialId !== null
      && hasOwn(candidate.row, "scheduledKey")
      && candidate.row.scheduledKey === `official_${officialId}`;
  }));

  if (mirrors.length) {
    const identities = identitySet(mirrors);
    if (identities.size === 1) {
      const identity = identities.values().next().value;
      return {
        candidate: mirrors.find((item) => eventIdentity(item.row) === identity),
        identity
      };
    }
    if (identities.size > 1) return { candidate: mirrors[0], identity: null };
  }
  const officialIdentities = identitySet(official);
  if (officialIdentities.size === 1) {
    const identity = officialIdentities.values().next().value;
    return {
      candidate: official.find((item) => eventIdentity(item.row) === identity),
      identity
    };
  }
  if (officialIdentities.size > 1) return { candidate: group[0], identity: null };

  const canonicalIdentities = identitySet(canonical);
  if (canonicalIdentities.size === 1) {
    const identity = canonicalIdentities.values().next().value;
    return {
      candidate: canonical.find((item) => eventIdentity(item.row) === identity),
      identity
    };
  }
  if (canonicalIdentities.size > 1) return { candidate: group[0], identity: null };
  return { candidate: group[0], identity: null };
}

function reconcileEventRows(events, officialEvents) {
  const candidates = [
    ...events.map((row) => normalizedEventCandidate(row, "canonical")),
    ...officialEvents.map((row) => normalizedEventCandidate(row, "official"))
  ].filter(Boolean);
  const groups = [];
  for (const candidate of candidates) {
    const group = groups.find((existing) => existing.some((item) => sameEventTruth(item.row, candidate.row)));
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }
  const identityGroupCounts = new Map();
  for (const group of groups) {
    for (const identity of identitySet(group)) {
      identityGroupCounts.set(identity, (identityGroupCounts.get(identity) || 0) + 1);
    }
  }
  return groups.map((group) => {
    const selected = selectEventCandidate(group);
    const identity = selected.identity !== null && identityGroupCounts.get(selected.identity) === 1
      ? selected.identity
      : null;
    return { row: selected.candidate.row, identity };
  });
}

function safePatrolView(message) {
  if (!plainRecord(message)) return null;
  const safeMessage = cloneData(message);
  if (!plainRecord(safeMessage) || !plainRecord(safeMessage.capabilityCoverage)) return null;
  try { return buildPatrolView(safeMessage); } catch { return null; }
}

function uniquelyIdentified(rows) {
  const valid = list(rows).filter((row) => ownCanonicalIdentifier(row, "id") !== null);
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
  const declaredPlanId = ownCanonicalIdentifier(run, "tradePlanId");
  if (declaredPlanId !== null) {
    return plans.find((plan) => plan.id === declaredPlanId) || null;
  }
  const linked = plans.filter((plan) => ownCanonicalIdentifier(plan, "agentRunId") === runId);
  return linked.length === 1 ? linked[0] : null;
}

function countEvidenceIds(value) {
  if (arrayClassification(value) !== true) return unavailable;
  if (!value.every(canonicalIdentifier)) return unavailable;
  return new Set(value).size;
}

function traceTargetsRun(trace, runId) {
  if (!plainRecord(trace)) return false;
  if (ownCanonicalIdentifier(trace, "agentRunId") === runId || ownCanonicalIdentifier(trace, "runId") === runId) return true;
  return ownCanonicalIdentifier(trace, "objectId") === runId
    && hasOwn(trace, "objectType")
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
  const messages = arrayClassification(source.chatMessages) === true
    ? source.chatMessages
    : list(source.messages);
  const eventInput = list(source.events).map((row) => cloneData(row)).filter(validEventInput);
  const officialEventInput = list(source.marketCalendarEvents).map((row) => cloneData(row)).filter(validEventInput);
  const events = reconcileEventRows(eventInput, officialEventInput)
    .map(({ row, identity }) => intelligenceProjection(row, {
      id: identity,
      kind: "event",
      source: "events"
    }));
  const news = list(source.newsFeed)
    .filter(plainRecord)
    .map((row) => intelligenceProjection(row, { id: ownCanonicalIdentifier(row, "id"), kind: "news", source: "newsFeed" }));
  const movers = list(source.marketMovers?.movers)
    .filter(plainRecord)
    .map((row) => intelligenceProjection(row, {
      id: ownCanonicalIdentifier(row, "id") || ownCanonicalIdentifier(row, "instId") || ownCanonicalIdentifier(row, "symbol"),
      kind: "market_mover",
      source: "marketMovers.movers"
    }));
  const knowledgeSource = arrayClassification(source.knowledge) === true ? source.knowledge : list(source.knowledge?.sources);
  const knowledge = knowledgeSource
    .filter(plainRecord)
    .map((row) => intelligenceProjection(row, { id: ownCanonicalIdentifier(row, "id"), kind: "knowledge", source: "knowledge" }));

  return Object.freeze({
    missions: Object.freeze(uniquelyIdentified(source.agentRuns)
      .map((run) => missionFor(run, plans, traces))),
    patrols: Object.freeze(messages.map(safePatrolView).filter(Boolean).map(freezeProjection)),
    intelligence: Object.freeze([...news, ...events, ...movers, ...knowledge]),
    watches: Object.freeze(list(source.watchTriggers).map(freezeProjection).filter(plainRecord)),
    events: Object.freeze(events)
  });
}
