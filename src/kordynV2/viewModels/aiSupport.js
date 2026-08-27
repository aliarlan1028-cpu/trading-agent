import { hasJsonResponseProvenance } from "../../jsonResponseProvenance.js";
import { KORDYN_V2_DOMAINS, KORDYN_V2_WORKSPACES } from "../architecture/domains.js";
import {
  isAiSupportContext,
  isAiSupportDestination,
  isAiSupportLocation,
  isAiSupportNavigableContext,
  isAiSupportSelection,
  isAiSupportSelectionPart,
  isAiSupportState,
  registerAiSupportContext,
  registerAiSupportDestination
} from "./aiSupportProjection.js";

const unavailable = "Unavailable";
const BLOCKED_FACT_STATES = new Set([
  "not_loaded",
  "loading",
  "empty",
  "processing",
  "failed",
  "forbidden",
  "disabled",
  "approval",
  "partial",
  "no-result"
]);
const SUPPORT_STATES = new Set([
  "ready",
  "not_loaded",
  "loading",
  "empty",
  "processing",
  "stale",
  "degraded",
  "failed",
  "forbidden",
  "disabled",
  "approval",
  "partial",
  "no-result",
  "long-content",
  "large-list"
]);

function ownValue(record, key, { requireProvenance = false } = {}) {
  if (!record || typeof record !== "object") return undefined;
  if (requireProvenance && !hasJsonResponseProvenance(record)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function trustedChild(record, key) {
  const value = ownValue(record, key, { requireProvenance: true });
  return hasJsonResponseProvenance(value) && !Array.isArray(value) ? value : null;
}

function scalar(value) {
  if (!["string", "number", "boolean"].includes(typeof value)) return unavailable;
  if (typeof value === "number" && !Number.isFinite(value)) return unavailable;
  const text = String(value).trim();
  return text ? text : unavailable;
}

function ownScalar(record, key) {
  return scalar(ownValue(record, key));
}

function trustedScalar(record, key) {
  return scalar(ownValue(record, key, { requireProvenance: true }));
}

function firstAvailable(...values) {
  return values.find((value) => value !== unavailable) || unavailable;
}

function formatUsdt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return unavailable;
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function emptyFacts() {
  return Object.freeze({
    account: unavailable,
    asOf: unavailable,
    risk: unavailable,
    runtime: unavailable,
    source: unavailable
  });
}

function registeredWorkspace(domainId, workspaceId) {
  const domain = KORDYN_V2_DOMAINS.find((item) => item.id === domainId);
  const workspace = domain
    ? KORDYN_V2_WORKSPACES[domain.id]?.find((item) => item.id === workspaceId)
    : null;
  return domain && workspace ? { domain, workspace } : null;
}

function projectLocation(location) {
  if (!isAiSupportLocation(location)) return Object.freeze({
    domainId: unavailable,
    domainLabel: unavailable,
    workspaceId: unavailable,
    workspaceLabel: unavailable
  });
  const domainId = ownScalar(location, "domainId");
  const workspaceId = ownScalar(location, "workspaceId");
  const registered = registeredWorkspace(domainId, workspaceId);
  return registered ? Object.freeze({
    domainId,
    domainLabel: registered.domain.label,
    workspaceId,
    workspaceLabel: registered.workspace.label
  }) : Object.freeze({
    domainId: unavailable,
    domainLabel: unavailable,
    workspaceId: unavailable,
    workspaceLabel: unavailable
  });
}

function projectState(state) {
  if (!isAiSupportState(state)) return Object.freeze({
    kind: "not_loaded",
    lastValidAt: unavailable,
    message: unavailable,
    retainsLastValid: false,
    source: unavailable
  });
  const kind = ownScalar(state, "kind").toLowerCase();
  return Object.freeze({
    kind: kind === unavailable.toLowerCase() ? "not_loaded" : kind,
    lastValidAt: ownScalar(state, "lastValidAt"),
    message: ownScalar(state, "message"),
    retainsLastValid: ownValue(state, "retainsLastValid") === true,
    source: ownScalar(state, "source")
  });
}

function projectSelection(selection, state) {
  if (!isAiSupportSelection(selection)) return Object.freeze({
    id: unavailable,
    type: unavailable,
    label: unavailable,
    status: unavailable
  });
  if (state.kind === "forbidden") return Object.freeze({
    id: unavailable,
    type: unavailable,
    label: unavailable,
    status: unavailable
  });
  const object = ownValue(selection, "object");
  const context = ownValue(selection, "context");
  if (!isAiSupportSelectionPart(object) || !isAiSupportSelectionPart(context)) return Object.freeze({
    id: unavailable,
    type: unavailable,
    label: unavailable,
    status: unavailable
  });
  return Object.freeze({
    id: ownScalar(object, "id"),
    type: ownScalar(object, "type"),
    label: firstAvailable(ownScalar(object, "label"), ownScalar(context, "title")),
    status: ownScalar(context, "status")
  });
}

function mayProjectFacts(state) {
  if (BLOCKED_FACT_STATES.has(state.kind)) return false;
  if (["stale", "degraded"].includes(state.kind)) {
    return state.retainsLastValid
      && state.source !== unavailable
      && state.lastValidAt !== unavailable;
  }
  return state.kind === "ready" || state.kind === "long-content" || state.kind === "large-list";
}

function projectFacts(data, state) {
  if (!hasJsonResponseProvenance(data) || !mayProjectFacts(state)) return emptyFacts();
  const portfolio = trustedChild(data, "portfolio");
  const automation = trustedChild(data, "automationState");
  const system = trustedChild(data, "system");
  const equity = formatUsdt(ownValue(portfolio, "totalEquityUsdt", { requireProvenance: true }));
  const available = formatUsdt(ownValue(portfolio, "availableMarginUsdt", { requireProvenance: true }));
  const account = equity !== unavailable || available !== unavailable
    ? `${equity} USDT · 可用 ${available} USDT`
    : unavailable;
  const runtimeLabel = firstAvailable(
    trustedScalar(automation, "label"),
    trustedScalar(automation, "mode")
  );
  const runtimeStatus = trustedScalar(automation, "runtimeStatus");
  const runtime = runtimeLabel !== unavailable || runtimeStatus !== unavailable
    ? `${runtimeLabel} · ${runtimeStatus}`
    : unavailable;
  return Object.freeze({
    account,
    asOf: firstAvailable(
      trustedScalar(data, "asOf"),
      trustedScalar(portfolio, "marginSyncedAt"),
      state.lastValidAt
    ),
    risk: trustedScalar(system, "riskStatus"),
    runtime,
    source: firstAvailable(
      trustedScalar(data, "source"),
      trustedScalar(portfolio, "source"),
      state.source
    )
  });
}

const DESTINATION_BY_ID = new Map([
  ["governance/overview", registerAiSupportDestination(Object.freeze({
    domainId: "governance",
    workspaceId: "overview",
    label: "查看运行总览"
  }))],
  ["governance/recovery", registerAiSupportDestination(Object.freeze({
    domainId: "governance",
    workspaceId: "recovery",
    label: "查看恢复"
  }))]
]);

export function resolveAiSupportDestination(target) {
  if (!isAiSupportDestination(target)) return null;
  const domainId = ownScalar(target, "domainId");
  const workspaceId = ownScalar(target, "workspaceId");
  const registered = registeredWorkspace(domainId, workspaceId);
  if (!registered) return null;
  return target;
}

export function buildAiSupportContext({ data, location, selection, state } = {}) {
  const projectedState = projectState(state);
  return registerAiSupportContext(Object.freeze({
    facts: projectFacts(data, projectedState),
    location: projectLocation(location),
    selection: projectSelection(selection, projectedState),
    state: projectedState
  }), {
    navigable: isAiSupportLocation(location)
      && isAiSupportState(state)
      && (selection == null || isAiSupportSelection(selection))
  });
}

export function buildAiSupportSuggestions(context) {
  if (!isAiSupportNavigableContext(context)) return Object.freeze([]);
  const kind = ownScalar(ownValue(context, "state"), "kind");
  if (!SUPPORT_STATES.has(kind)) return Object.freeze([]);
  const targetIds = kind === "failed"
    ? ["governance/overview", "governance/recovery"]
    : ["governance/overview"];
  return Object.freeze(targetIds.map((id) => DESTINATION_BY_ID.get(id)).filter(Boolean));
}

const EMPTY_CONTEXT = registerAiSupportContext(Object.freeze({
  facts: emptyFacts(),
  location: projectLocation(null),
  selection: projectSelection(null, { kind: "not_loaded" }),
  state: projectState(null)
}));

export function safeAiSupportContext(context) {
  return isAiSupportContext(context) ? context : EMPTY_CONTEXT;
}
