import { buildPatrolView } from "../../../patrolView.js";
import { buildAiContextFacts } from "./aiContextFacts.js";

const unavailable = "Unavailable";
const invalidArrayShape = Symbol("kordynV2.invalidArrayShape");
const failedClone = Symbol("kordynV2.failedClone");
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

function cloneDataValue(value, seen, retainArrayShapeMarker) {
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return value;
  if (!["object", "function"].includes(typeof value)) return failedClone;
  if (seen.has(value)) return seen.get(value);
  const fail = () => {
    seen.set(value, failedClone);
    return failedClone;
  };
  const array = arrayClassification(value);
  if (array === null) return fail();
  if (array) {
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return fail(); }
    const lengthDescriptor = Object.hasOwn(descriptors, "length") ? descriptors.length : null;
    const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
    if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) return fail();
    const copy = new Array(length);
    seen.set(value, copy);
    const keys = Reflect.ownKeys(descriptors);
    let hasInvalidShape = Object.hasOwn(descriptors, invalidArrayShape);
    for (let offset = 0; offset < keys.length; offset += 1) {
      const key = keys[offset];
      if (key === invalidArrayShape || key === "length") continue;
      const descriptor = descriptors[key];
      if (!descriptor.enumerable) continue;
      const index = typeof key === "string" && /^(?:0|[1-9]\d*)$/u.test(key) ? Number(key) : -1;
      if (!Number.isInteger(index) || index < 0 || index >= length) {
        hasInvalidShape = true;
        continue;
      }
      if (!("value" in descriptor)) continue;
      const child = cloneDataValue(descriptor.value, seen, retainArrayShapeMarker);
      if (child === failedClone) continue;
      Object.defineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: child,
        writable: true
      });
    }
    if (retainArrayShapeMarker && hasInvalidShape) {
      Object.defineProperty(copy, invalidArrayShape, { value: true });
    }
    return copy;
  }
  let prototype;
  try { prototype = Object.getPrototypeOf(value); } catch { return fail(); }
  if (prototype !== Object.prototype && prototype !== null) return fail();
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return fail(); }
  const copy = Object.create(null);
  seen.set(value, copy);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !("value" in descriptor)) continue;
    const child = cloneDataValue(descriptor.value, seen, retainArrayShapeMarker);
    if (child === failedClone) continue;
    Object.defineProperty(copy, key, {
      configurable: true,
      enumerable: true,
      value: child,
      writable: true
    });
  }
  return copy;
}

function cloneData(value, seen = new WeakMap(), retainArrayShapeMarker = true) {
  const cloned = cloneDataValue(value, seen, retainArrayShapeMarker);
  return cloned === failedClone ? undefined : cloned;
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

const freezeProjection = (value) => deepFreeze(cloneData(value, new WeakMap(), false));

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
  if (hasOwn(value, invalidArrayShape)) return unavailable;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return unavailable; }
  const lengthDescriptor = Object.hasOwn(descriptors, "length") ? descriptors.length : null;
  const length = lengthDescriptor && "value" in lengthDescriptor ? lengthDescriptor.value : null;
  if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) return unavailable;
  if (Reflect.ownKeys(descriptors).length !== length + 1) return unavailable;
  const identities = new Set();
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[index];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || !canonicalIdentifier(descriptor.value)) {
      return unavailable;
    }
    identities.add(descriptor.value);
  }
  return identities.size;
}

function traceTargetsRun(trace, runId) {
  if (!plainRecord(trace)) return false;
  if (ownCanonicalIdentifier(trace, "agentRunId") === runId || ownCanonicalIdentifier(trace, "runId") === runId) return true;
  const objectType = hasOwn(trace, "objectType") ? trace.objectType : null;
  return ownCanonicalIdentifier(trace, "objectId") === runId
    && typeof objectType === "string"
    && /^agent[ _-]?run$/i.test(objectType.trim());
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

export function buildAiDomainModel(data = {}) {
  const safeData = cloneData(data);
  const source = plainRecord(safeData) ? safeData : {};
  const contextFacts = buildAiContextFacts(source, { trustedSnapshot: true });
  const plans = uniquelyIdentified(source.tradePlans);
  const traces = list(source.traces);
  const messages = arrayClassification(source.chatMessages) === true
    ? source.chatMessages
    : list(source.messages);
  return Object.freeze({
    missions: Object.freeze(uniquelyIdentified(source.agentRuns)
      .map((run) => missionFor(run, plans, traces))),
    patrols: Object.freeze(messages.map(safePatrolView).filter(Boolean).map(freezeProjection)),
    intelligence: contextFacts.intelligence,
    watches: contextFacts.watches,
    events: contextFacts.events
  });
}
