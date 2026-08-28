import { buildPatrolView } from "../../../patrolView.js";
import { buildEventRows } from "../../../viewData.js";

const unavailable = "Unavailable";
const list = (value) => Array.isArray(value) ? value : [];
const hasOwn = (value, key) => Boolean(value && Object.hasOwn(value, key));
const nonEmptyText = (value) => typeof value === "string" && value.trim().length > 0;
const canonicalIdentifier = (value) => nonEmptyText(value) && value === value.trim();

const stagePresentation = Object.freeze({
  intent: ["正在理解任务", "working"],
  sense: ["正在检查市场", "working"],
  recall: ["正在核对相关证据", "working"],
  plan: ["正在形成下一步计划", "working"],
  guard: ["正在验证风险边界", "attention"],
  approval: ["需要你确认", "approval"],
  execute: ["正在等待权威执行结果", "working"],
  monitor: ["正在监控结果", "monitoring"],
  review: ["正在整理复盘证据", "reviewing"]
});

export function missionStagePresentation(stage) {
  const id = nonEmptyText(stage) ? stage.trim().toLowerCase() : null;
  const presentation = id ? stagePresentation[id] : null;
  return Object.freeze({
    id,
    label: presentation?.[0] || unavailable,
    tone: presentation?.[1] || "unavailable"
  });
}

function linkedPlanFor(run, plans) {
  const runId = run.id;
  const declaredPlanId = canonicalIdentifier(run.tradePlanId) ? run.tradePlanId : null;
  return plans.find((plan) => {
    if (!plan || !canonicalIdentifier(plan.id)) return false;
    return (canonicalIdentifier(plan.agentRunId) && plan.agentRunId === runId)
      || (declaredPlanId !== null && plan.id === declaredPlanId);
  }) || null;
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
  if (hasOwn(run, "nextAction")) {
    return nonEmptyText(run.nextAction) ? run.nextAction : unavailable;
  }
  if (!hasOwn(run, "nextActions") || !Array.isArray(run.nextActions)) return unavailable;
  return nonEmptyText(run.nextActions[0]) ? run.nextActions[0] : unavailable;
}

function missionFor(run, plans, traces) {
  const plan = linkedPlanFor(run, plans);
  const latestStep = list(run.steps).slice().reverse().find((step) => nonEmptyText(step?.phase));
  const technicalStage = hasOwn(run, "stage") ? run.stage : latestStep?.phase;
  return Object.freeze({
    id: run.id,
    title: nonEmptyText(run.title) ? run.title : unavailable,
    status: nonEmptyText(run.status) ? run.status : unavailable,
    stage: missionStagePresentation(technicalStage),
    evidenceCount: evidenceCountFor(run, plan, traces),
    nextAction: nextActionFor(run),
    approval: plan ? Object.freeze({
      planId: plan.id,
      status: nonEmptyText(plan.status) ? plan.status : unavailable,
      source: plan
    }) : null,
    source: run
  });
}

export function buildAiDomainModel(data = {}) {
  const source = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const plans = list(source.tradePlans);
  const traces = list(source.traces);
  const messages = Array.isArray(source.chatMessages)
    ? source.chatMessages
    : list(source.messages);

  return Object.freeze({
    missions: list(source.agentRuns)
      .filter((run) => run && typeof run === "object" && canonicalIdentifier(run.id))
      .map((run) => missionFor(run, plans, traces)),
    patrols: messages.map((message) => buildPatrolView(message)).filter(Boolean),
    intelligence: list(source.newsFeed),
    watches: list(source.watchTriggers),
    events: buildEventRows(source)
  });
}
