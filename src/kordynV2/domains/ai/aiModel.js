import { buildPatrolView } from "../../../patrolView.js";
import { buildAiContextFacts } from "./aiContextFacts.js";

const unavailable = "Unavailable";
const invalidArrayShape = Symbol("kordynV2.invalidArrayShape");
const failedClone = Symbol("kordynV2.failedClone");
const hasOwn = (value, key) => Boolean(value && Object.hasOwn(value, key));
const nonEmptyText = (value) => typeof value === "string" && value.trim().length > 0;
const boundedPrimitiveText = (value, limit = 240) => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized.slice(0, limit) : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? `${value}`.slice(0, limit) : null;
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
};
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

function firstBoundedText(...values) {
  for (const value of values) {
    if (nonEmptyText(value)) return value.trim().slice(0, 240);
  }
  return unavailable;
}

function boundedTextList(...values) {
  const output = [];
  const append = (value) => {
    if (!nonEmptyText(value)) return;
    const bounded = value.trim().slice(0, 120);
    if (!output.includes(bounded)) output.push(bounded);
  };
  for (const value of values) {
    if (arrayClassification(value) === true) {
      for (const item of value) {
        append(item);
        if (output.length >= 8) break;
      }
    } else append(value);
    if (output.length >= 8) break;
  }
  return output;
}

function missionDecisionContext(run, plan) {
  const knowledge = boundedTextList(run.knowledgeSource, run.knowledgeSources, plan?.knowledgeSource, plan?.knowledgeSkillIds);
  const capabilities = boundedTextList(run.capabilities, plan?.capabilities);
  const events = boundedTextList(run.eventWindow, run.eventId, run.eventIds, plan?.eventWindow, plan?.eventId, plan?.eventIds);
  const positions = boundedTextList(run.positionId, run.positionIds, plan?.positionId, plan?.positionIds);
  return Object.freeze({
    strategy: firstBoundedText(run.strategyName, run.strategy, plan?.strategy, plan?.strategyName),
    knowledge: Object.freeze(knowledge),
    capabilities: Object.freeze(capabilities),
    events: Object.freeze(events),
    positions: Object.freeze(positions)
  });
}

function missionReceipt(run, latestStep) {
  return Object.freeze({
    createdAt: firstBoundedText(run.createdAt),
    updatedAt: firstBoundedText(run.updatedAt, latestStep?.updatedAt, latestStep?.createdAt),
    completedAt: firstBoundedText(run.completedAt),
    status: firstBoundedText(run.status),
    step: firstBoundedText(latestStep?.title, latestStep?.summary)
  });
}

const finiteFact = (value, { positive = false, integer = false } = {}) => (
  typeof value === "number"
  && Number.isFinite(value)
  && (!positive || value > 0)
  && (!integer || Number.isInteger(value))
    ? value
    : null
);

function boundedIdentifiers(...values) {
  const identifiers = [];
  for (const value of values) {
    if (arrayClassification(value) === true) {
      for (const item of value) if (canonicalIdentifier(item) && !identifiers.includes(item)) identifiers.push(item);
    } else if (canonicalIdentifier(value) && !identifiers.includes(value)) identifiers.push(value);
    if (identifiers.length >= 24) break;
  }
  return identifiers;
}

function planEntry(plan) {
  if (nonEmptyText(plan.entry?.range)) return plan.entry.range.trim();
  const values = arrayClassification(plan.entry_range) === true
    ? plan.entry_range.map((value) => finiteFact(value, { positive: true }))
    : [];
  return values.length >= 2 && values.every((value) => value !== null) ? values.join("–") : unavailable;
}

function takeProfitFacts(plan) {
  const source = arrayClassification(plan.takeProfit) === true
    ? plan.takeProfit
    : arrayClassification(plan.take_profit) === true ? plan.take_profit : [];
  return source.slice(0, 4).map((value) => finiteFact(value, { positive: true })).filter((value) => value !== null);
}

function accountImpactFor(plan, data, riskPercent) {
  const explicit = plainRecord(plan.accountImpact) ? plan.accountImpact : {};
  const portfolio = plainRecord(data.portfolio) ? data.portfolio : {};
  const positionsKnown = arrayClassification(data.positions) === true;
  const equityUsdt = finiteFact(explicit.equityUsdt) ?? finiteFact(portfolio.totalEquityUsdt);
  const availableMarginUsdt = finiteFact(explicit.availableMarginUsdt) ?? finiteFact(portfolio.availableMarginUsdt);
  const openPositionCount = finiteFact(explicit.openPositionCount, { integer: true })
    ?? (positionsKnown ? data.positions.length : null);
  const projectedOpenPositionCount = finiteFact(explicit.projectedOpenPositionCount, { integer: true })
    ?? (openPositionCount === null ? null : openPositionCount + 1);
  const estimatedMaxLossUsdt = finiteFact(explicit.estimatedMaxLossUsdt)
    ?? (equityUsdt !== null && riskPercent !== null ? Number((equityUsdt * riskPercent / 100).toFixed(2)) : null);
  return Object.freeze({ equityUsdt, availableMarginUsdt, openPositionCount, projectedOpenPositionCount, estimatedMaxLossUsdt });
}

export function projectApprovalTruth(plan, data = {}) {
  if (!plainRecord(plan)) return null;
  const planId = ownCanonicalIdentifier(plan, "id");
  if (!planId) return null;
  const status = nonEmptyText(plan.status) ? plan.status.trim().toLowerCase() : unavailable;
  const symbol = nonEmptyText(plan.symbol) ? plan.symbol.trim() : unavailable;
  const direction = nonEmptyText(plan.direction) ? plan.direction.trim().toLowerCase() : unavailable;
  const entry = planEntry(plan);
  const stopLoss = finiteFact(plan.stopLoss ?? plan.stop_loss, { positive: true });
  const takeProfit = takeProfitFacts(plan);
  const leverage = finiteFact(plan.leverage, { positive: true });
  const riskPercent = finiteFact(plan.max_loss_pct ?? plan.entry?.riskPercent ?? plan.riskPercent, { positive: true });
  const riskCheck = plainRecord(plan.lastRiskCheck) ? plan.lastRiskCheck : null;
  const riskSummary = riskCheck && nonEmptyText(riskCheck.summary ?? riskCheck.reason)
    ? String(riskCheck.summary ?? riskCheck.reason).trim()
    : unavailable;
  const riskId = riskCheck ? ownCanonicalIdentifier(riskCheck, "id") : null;
  const evidenceIds = boundedIdentifiers(plan.evidenceIds, plan.analysisBundleId, plan.knowledgeSkillIds, riskId);
  const knowledgeSkillIds = boundedIdentifiers(plan.knowledgeSkillIds);
  const accountImpact = accountImpactFor(plan, data, riskPercent);
  const missingFacts = [];
  if (status !== "awaiting_approval") missingFacts.push("status");
  if (symbol === unavailable) missingFacts.push("symbol");
  if (!new Set(["long", "short"]).has(direction)) missingFacts.push("direction");
  if (entry === unavailable) missingFacts.push("entry");
  if (stopLoss === null) missingFacts.push("stopLoss");
  if (!takeProfit.length) missingFacts.push("takeProfit");
  if (leverage === null) missingFacts.push("leverage");
  if (riskPercent === null) missingFacts.push("riskPercent");
  if (!riskCheck || riskCheck.passed !== true || riskSummary === unavailable) missingFacts.push("riskResult");
  if (!evidenceIds.length) missingFacts.push("evidence");
  if (Object.values(accountImpact).some((value) => value === null)) missingFacts.push("accountImpact");
  return Object.freeze({
    planId,
    status,
    symbol,
    direction,
    entry,
    stopLoss,
    takeProfit: Object.freeze(takeProfit),
    leverage,
    riskPercent,
    strategy: nonEmptyText(plan.strategy) ? plan.strategy.trim() : unavailable,
    knowledgeSkillIds: Object.freeze(knowledgeSkillIds),
    evidence: Object.freeze({ ids: Object.freeze(evidenceIds), count: evidenceIds.length }),
    risk: Object.freeze({
      id: riskId,
      passed: riskCheck?.passed === true,
      summary: riskSummary,
      blockers: Object.freeze(list(riskCheck?.blockers).slice(0, 6).map((value) => boundedPrimitiveText(value)).filter(Boolean)),
      warnings: Object.freeze(list(riskCheck?.warnings).slice(0, 6).map((value) => boundedPrimitiveText(value)).filter(Boolean))
    }),
    accountImpact,
    valid: missingFacts.length === 0,
    missingFacts: Object.freeze(missingFacts)
  });
}

function outputMessageFor(run, plan, messages) {
  const matches = messages.filter((message) => {
    const role = plainRecord(message) && typeof message.role === "string"
      ? boundedPrimitiveText(message.role, 40)?.toLowerCase()
      : null;
    return role && role !== "user"
    && nonEmptyText(message.content)
    && (
      ownCanonicalIdentifier(message, "agentRunId") === run.id
      || ownCanonicalIdentifier(message, "runId") === run.id
      || (plan && ownCanonicalIdentifier(message, "planId") === plan.id)
      || (plan && plainRecord(message.presentation?.linked) && ownCanonicalIdentifier(message.presentation.linked, "planId") === plan.id)
    );
  });
  const message = matches[matches.length - 1];
  if (!message) return null;
  return Object.freeze({
    id: ownCanonicalIdentifier(message, "id") || `${run.id}-output`,
    role: "agent",
    content: message.content,
    createdAt: nonEmptyText(message.createdAt) ? message.createdAt : unavailable
  });
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

function missionFor(run, plans, traces, data, messages) {
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
    decisionContext: missionDecisionContext(run, plan),
    receipt: missionReceipt(run, latestStep),
    approval: plan ? projectApprovalTruth(plan, data) : null,
    output: outputMessageFor(run, plan, messages)
  });
}

function dialogProjection(source, messages) {
  const sessions = uniquelyIdentified(source.chatSessions).slice(0, 40).map((session) => Object.freeze({
    id: session.id,
    title: nonEmptyText(session.title) ? session.title : unavailable,
    status: nonEmptyText(session.status) ? session.status : unavailable,
    updatedAt: nonEmptyText(session.updatedAt ?? session.createdAt) ? String(session.updatedAt ?? session.createdAt) : unavailable
  }));
  const projectedMessages = messages.slice(-100).filter(plainRecord).map((message, index) => Object.freeze({
    id: ownCanonicalIdentifier(message, "id") || `message-${index}`,
    role: nonEmptyText(message.role) ? message.role : unavailable,
    content: nonEmptyText(message.content ?? message.text) ? String(message.content ?? message.text) : unavailable,
    sessionId: ownCanonicalIdentifier(message, "sessionId"),
    createdAt: nonEmptyText(message.createdAt) ? message.createdAt : unavailable,
    model: nonEmptyText(message.model) ? message.model : null,
    planId: ownCanonicalIdentifier(message, "planId")
  }));
  const activeSessionId = ownCanonicalIdentifier(source, "activeSessionId") || sessions[0]?.id || null;
  return Object.freeze({
    sessions: Object.freeze(sessions),
    activeSessionId,
    messages: Object.freeze(projectedMessages),
    provider: plainRecord(source.provider) ? Object.freeze({
      name: nonEmptyText(source.provider.name) ? source.provider.name : unavailable,
      model: nonEmptyText(source.provider.model) ? source.provider.model : unavailable
    }) : null,
    messageScope: nonEmptyText(source.messageScope) ? source.messageScope : unavailable
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
      .map((run) => missionFor(run, plans, traces, source, messages))),
    dialog: dialogProjection(source, messages),
    patrols: Object.freeze(messages.map(safePatrolView).filter(Boolean).map(freezeProjection)),
    intelligence: contextFacts.intelligence,
    watches: contextFacts.watches,
    events: contextFacts.events
  });
}
