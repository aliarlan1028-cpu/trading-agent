import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpen, Bot, ChevronDown, ChevronUp, PieChart, Search, Settings, ShieldCheck, X } from "lucide-react";
import { CONFIGURATION_WORKSPACE, ROUTE_DEFINITIONS, WORKSPACES } from "./productArchitecture.js";
import { t } from "./i18n.js";
import { buildCapabilityCatalogRows, buildStrategyCatalogRows } from "./viewData.js";

const text = (value, fallback = "—") => value == null || value === "" ? fallback : String(value);

const unavailable = "Unavailable";
const firstValue = (...values) => values.find((value) => value != null && value !== "");
const asList = (value) => Array.isArray(value) ? value : [];

export const canonicalPositionIdentity = (row = {}) => firstValue(row.id, row.positionId, row.instId, row.symbol);

const validAccountIdentity = (value) => typeof value === "string"
  && value.length > 0
  && value.length <= 240
  && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value)
  && !["unavailable", "unknown", "n/a", "—"].includes(value.toLowerCase());

export function canonicalAccountIdentity(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(row, "id");
    return descriptor && Object.hasOwn(descriptor, "value") && validAccountIdentity(descriptor.value)
      ? descriptor.value
      : null;
  } catch {
    return null;
  }
}

const accountSearchTextFields = Object.freeze([
  "id", "label", "exchange", "status", "state", "source", "origin", "version", "revision",
  "permission", "permissions", "requiredPermission", "risk", "riskLevel", "severity", "evidenceId",
  "updatedAt", "createdAt", "nextAction", "allowedAction", "sourceState", "resourceState"
]);
const accountSearchBooleanFields = Object.freeze([
  "enabled", "sourceStale", "stale", "isStale", "sourceDegraded", "degraded", "sourceForbidden", "forbidden", "permissionDenied"
]);
const executionSearchTextFields = Object.freeze([
  ...accountSearchTextFields,
  "orderId", "tradeId", "executionOrderId", "tradeLifecycleKey", "tradePlanId", "planId",
  "exchange", "accountId", "symbol", "instId", "title", "name", "strategy", "strategyName",
  "direction", "side", "kind", "financialBasis", "completedAt", "closedAt"
]);

function validAccountSearchText(value) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 2_000
    && value.trim().length > 0
    && !/\p{Cc}/u.test(value);
}

function accountSearchSnapshot(row) {
  if (!row || typeof row !== "object") return null;
  try {
    if (Array.isArray(row)) return null;
    const prototype = Object.getPrototypeOf(row);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(row);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 128) return null;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable) continue;
      if (typeof key !== "string" || !Object.hasOwn(descriptor, "value")) return null;
      const value = descriptor.value;
      if (value === null || value === undefined) continue;
      if (!["string", "number", "boolean"].includes(typeof value)) return null;
      if (typeof value === "number" && !Number.isFinite(value)) return null;
      if (typeof value === "string" && (value.length > 2_000 || /\p{Cc}/u.test(value))) return null;
    }
    if (typeof globalThis.structuredClone !== "function") return null;
    globalThis.structuredClone(row);

    const snapshot = {};
    for (const field of accountSearchTextFields) {
      const descriptor = descriptors[field];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) continue;
      const value = descriptor.value;
      if (value === null || value === undefined || value === "") continue;
      if (!validAccountSearchText(value)) return null;
      snapshot[field] = value;
    }
    for (const field of accountSearchBooleanFields) {
      const descriptor = descriptors[field];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) continue;
      const value = descriptor.value;
      if (value === null || value === undefined) continue;
      if (typeof value !== "boolean") return null;
      snapshot[field] = value;
    }
    if (!validAccountIdentity(snapshot.id)) return null;
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

function primitiveSearchSnapshot(row, requiredIdFields = ["id"]) {
  if (!row || typeof row !== "object") return null;
  try {
    if (Array.isArray(row)) return null;
    const prototype = Object.getPrototypeOf(row);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(row);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 160) return null;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable) continue;
      if (typeof key !== "string" || !Object.hasOwn(descriptor, "value")) return null;
      const value = descriptor.value;
      if (value === null || value === undefined) continue;
      if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") return null;
      if (typeof value === "number" && !Number.isFinite(value)) return null;
      if (typeof value === "string" && (value.length > 2_000 || /\p{Cc}/u.test(value))) return null;
    }
    const snapshot = {};
    for (const field of executionSearchTextFields) {
      const descriptor = descriptors[field];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) continue;
      const value = descriptor.value;
      if (value === null || value === undefined || value === "") continue;
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return null;
        snapshot[field] = value;
      } else if (typeof value === "boolean") {
        snapshot[field] = value;
      } else if (validAccountSearchText(value)) {
        snapshot[field] = value;
      } else {
        return null;
      }
    }
    for (const field of accountSearchBooleanFields) {
      const descriptor = descriptors[field];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) continue;
      const value = descriptor.value;
      if (value === null || value === undefined) continue;
      if ((field === "forbidden" || field === "permissionDenied") && typeof value === "string" && validAccountSearchText(value)) {
        snapshot[field] = value;
        continue;
      }
      if (typeof value !== "boolean") return null;
      snapshot[field] = value;
    }
    if (!requiredIdFields.some((field) => validAccountIdentity(snapshot[field]))) return null;
    return Object.freeze(snapshot);
  } catch {
    return null;
  }
}

const taskFourSelectionSources = Object.freeze({
  "Trade plan": Object.freeze({ key: "tradePlans", project: (row) => primitiveSearchSnapshot(row, ["id"]), id: (row) => row.id }),
  Order: Object.freeze({ key: "orders", project: (row) => primitiveSearchSnapshot(row, ["id", "orderId"]), id: (row) => row.id || row.orderId }),
  Fill: Object.freeze({ key: "fills", project: (row) => primitiveSearchSnapshot(row, ["id", "tradeId"]), id: (row) => row.id || row.tradeId }),
  Execution: Object.freeze({ key: "executionOrders", project: (row) => primitiveSearchSnapshot(row, ["id", "orderId"]), id: (row) => row.id || row.orderId }),
  Review: Object.freeze({ key: "reviews", project: (row) => primitiveSearchSnapshot(row, ["id"]), id: (row) => row.id }),
  "Closed trade": Object.freeze({ key: "closedTradeLifecycles", project: (row) => primitiveSearchSnapshot(row, ["id"]), id: (row) => row.id })
});

const searchCollections = Object.freeze([
  { key: "markets", type: "Market", route: "market", workspaceId: "live", sourceSection: "cockpit", id: (row) => row.symbol || row.id, title: (row) => row.symbol || row.name },
  { key: "exchangeAccounts", type: "Account", route: "marketAccount", workspaceId: "live", sourceSection: "cockpit", project: accountSearchSnapshot, id: canonicalAccountIdentity, title: (row) => row.label || row.exchange || canonicalAccountIdentity(row) },
  { key: "positions", type: "Position", route: "positions", workspaceId: "live", sourceSection: "cockpit", id: canonicalPositionIdentity, title: (row) => row.symbol || row.instId || row.name },
  { key: "tradePlans", type: "Trade plan", route: "signalHub", workspaceId: "live", sourceSection: "cockpit", project: taskFourSelectionSources["Trade plan"].project, id: (row) => row.id, title: (row) => row.title || row.symbol || row.name },
  { key: "orders", type: "Order", route: "tradeLedger", workspaceId: "live", sourceSection: "cockpit", project: taskFourSelectionSources.Order.project, id: (row) => row.id || row.orderId, title: (row) => row.title || row.symbol || row.id },
  { key: "fills", type: "Fill", route: "tradeLedger", workspaceId: "live", sourceSection: "cockpit", project: taskFourSelectionSources.Fill.project, id: (row) => row.id || row.tradeId, title: (row) => row.title || row.symbol || row.id },
  { key: "closedTradeLifecycles", type: "Closed trade", route: "tradeLedger", workspaceId: "live", sourceSection: "cockpit", project: taskFourSelectionSources["Closed trade"].project, id: (row) => row.id, title: (row) => row.title || row.symbol || row.id },
  { key: "events", type: "Event", route: "eventsTasks:events", workspaceId: "ai", sourceSection: "chat", id: (row) => row.id || row.factId, title: (row) => row.title || row.shortTitle || row.message || row.id },
  { key: "eventRiskWindows", type: "Event", route: "eventRisk", workspaceId: "control", sourceSection: "riskCenter", id: (row) => row.id || row.eventId, title: (row) => row.title || row.shortTitle || row.id },
  { key: "watchTriggers", type: "Watch", route: "watch", workspaceId: "ai", sourceSection: "chat", id: (row) => row.id, title: (row) => row.title || row.analysisTitle || row.displayThesis || row.thesis || row.symbol },
  { key: "tasks", type: "Task", route: "operationsCenter:tasks", workspaceId: "operations", sourceSection: "operationsCenter", id: (row) => row.id, title: (row) => row.title || row.name || row.type },
  { key: "agentRuns", type: "Agent run", route: "chat", workspaceId: "ai", sourceSection: "chat", id: (row) => row.id || row.runId, title: (row) => row.title || row.name || row.agentName || row.id },
  { key: "auditLogs", type: "Audit log", route: "auditSystem", workspaceId: "operations", sourceSection: "operationsCenter", id: (row) => row.id, title: (row) => row.title || row.action || row.resource || row.id },
  { key: "mandates", type: "Mandate", route: "riskMandate", workspaceId: "control", sourceSection: "riskCenter", id: (row) => row.id, title: (row) => row.name || row.title || row.id },
  { key: "riskIncidents", type: "Risk incident", route: "riskCenter", workspaceId: "control", sourceSection: "riskCenter", id: (row) => row.id, title: (row) => row.title || row.type || row.id },
  { key: "executionOrders", type: "Execution", route: "executionReview", workspaceId: "live", sourceSection: "cockpit", project: taskFourSelectionSources.Execution.project, id: (row) => row.id || row.orderId, title: (row) => row.symbol || row.title || row.id },
  { key: "reviews", type: "Review", route: "labReviews", workspaceId: "lab", sourceSection: "cockpit", project: taskFourSelectionSources.Review.project, id: (row) => row.id, title: (row) => row.title || row.symbol || row.id }
]);

export function shellStrategyCandidate(row = {}) {
  if (row.recordType === "product") return { id: row.versionId, type: "Strategy product" };
  if (row.recordType === "research") return { id: String(row.id || "").replace(/^native_/, ""), type: "Strategy" };
  return { id: row.id, type: "Strategy" };
}

function sourceMetadata(data, source, workspaceId, sourceSection) {
  const raw = source?.raw || source || {};
  const sourceState = String(firstValue(
    data.resourceState?.[sourceSection],
    source?.sourceState,
    raw.sourceState,
    raw.resourceState,
    unavailable
  ));
  const normalizedSourceState = sourceState.toLowerCase();
  const permission = firstValue(source?.permission, raw.permission, raw.permissions, raw.requiredPermission);
  const permissionState = String(permission || "").toLowerCase();
  const explicitForbidden = firstValue(source?.sourceForbidden, raw.forbidden, raw.permissionDenied);
  const sourceForbidden = normalizedSourceState === "forbidden" || ["denied", "forbidden", "revoked", "unauthorized"].includes(permissionState)
    ? "forbidden"
    : explicitForbidden;
  return {
    workspaceId,
    sourceSection,
    sourceState,
    sourceStale: normalizedSourceState === "stale" || source?.sourceStale === true || raw.stale === true || raw.isStale === true,
    sourceDegraded: normalizedSourceState === "degraded" || source?.sourceDegraded === true || raw.degraded === true,
    sourceForbidden: sourceForbidden === true ? "forbidden" : (sourceForbidden || false)
  };
}

function searchRow(data, type, route, id, title, source, workspaceId, sourceSection) {
  if (id == null || id === "" || title == null || title === "") return null;
  return {
    type,
    title: String(title),
    id: String(id),
    status: String(firstValue(source?.status, source?.state, source?.enabled === true ? "enabled" : null, unavailable)),
    route: String(route),
    source: firstValue(source?.source, source?.origin, unavailable),
    version: firstValue(source?.version, source?.revision, unavailable),
    permission: firstValue(source?.permission, source?.permissions, source?.requiredPermission, unavailable),
    risk: firstValue(source?.risk, source?.riskLevel, source?.severity, unavailable),
    evidence: firstValue(source?.evidenceId, source?.updatedAt, source?.createdAt, unavailable),
    nextAction: firstValue(source?.nextAction, source?.allowedAction, `Open ${route}`),
    ...sourceMetadata(data, source, workspaceId, sourceSection),
    raw: source
  };
}

export function buildShellSearchIndex(data = {}) {
  const rows = [];
  for (const collection of searchCollections) {
    for (const item of asList(data[collection.key])) {
      const source = collection.project ? collection.project(item) : item;
      if (!source) continue;
      const row = searchRow(data, collection.type, collection.route, collection.id(source), collection.title(source), source, collection.workspaceId, collection.sourceSection);
      if (row) rows.push(row);
    }
  }
  const strategyRows = buildStrategyCatalogRows(data, (_zh, en) => en || _zh).rows;
  for (const item of strategyRows) {
    const candidate = shellStrategyCandidate(item);
    const row = searchRow(data, candidate.type, "strategyLib", candidate.id, item.name || item.title || candidate.id, item, "lab", "researchCenter");
    if (row) rows.push(row);
  }
  for (const item of buildCapabilityCatalogRows(data, (_zh, en) => en || _zh)) {
    const row = searchRow(data, "Capability", "capabilityLib", item.id || item.name, item.name || item.title || item.id, item, "lab", "researchCenter");
    if (row) rows.push(row);
  }
  const nestedCollections = [
    { items: data.backtestResearch?.historical, type: "Validation run", route: "strategyLib", id: (row) => row.id, title: (row) => row.name || row.title || row.strategyName || row.id },
    { items: data.backtestResearch?.forward, type: "Paper run", route: "strategyLib", id: (row) => row.id, title: (row) => row.name || row.title || row.strategyName || row.id },
    { items: data.backtests, type: "Validation run", route: "strategyLib", id: (row) => row.id, title: (row) => row.name || row.title || row.strategyName || row.strategy || row.id },
    { items: data.paperReport?.sessions, type: "Paper run", route: "strategyLib", id: (row) => row.id, title: (row) => row.name || row.title || row.strategyName || row.id }
  ];
  for (const collection of nestedCollections) {
    for (const item of asList(collection.items)) {
      const row = searchRow(data, collection.type, collection.route, collection.id(item), collection.title(item), item, "lab", "researchCenter");
      if (row) rows.push(row);
    }
  }
  for (const item of asList(data.knowledge?.sources)) {
    const row = searchRow(data, "Knowledge", "knowledgeBase", item.id || item.url || item.title, item.title || item.name || item.url, item, "lab", "researchCenter");
    if (row) rows.push(row);
  }
  for (const item of asList(data.knowledge?.chunks)) {
    const row = searchRow(data, "Evidence", "knowledgeBase", item.id, item.title || item.text || item.id, item, "lab", "researchCenter");
    if (row) rows.push(row);
  }
  for (const item of asList(data.knowledge?.candidates)) {
    const row = searchRow(data, "Knowledge candidate", "knowledgeBase", item.id, item.title || item.name || item.id, item, "lab", "researchCenter");
    if (row) rows.push(row);
  }
  for (const item of asList(data.ownerReviewLoop?.lessons)) {
    const row = searchRow(data, "Lesson", "labReviews", item.id, item.title || item.lessonText || item.id, item, "lab", "researchCenter");
    if (row) rows.push(row);
  }
  for (const item of asList(data.ownerReviewLoop?.improvements)) {
    const row = searchRow(data, "Owner candidate", "labReviews", item.id, item.title || item.proposal || item.id, item, "lab", "researchCenter");
    if (row) rows.push(row);
  }
  for (const definition of ROUTE_DEFINITIONS) {
    const alias = definition.aliases.find((item) => !item.includes("*")) || definition.aliases[0];
    const workspace = WORKSPACES[definition.workspace] || CONFIGURATION_WORKSPACE;
    rows.push(searchRow(data, "Feature", alias, alias, `${workspace.labelEn} / ${definition.view}`, {
      status: "available", source: "Product route registry", permission: unavailable, nextAction: `Open ${alias}`
    }, workspace.id, definition.desktop.section));
  }
  const seen = new Set();
  return rows.filter((row) => row && !seen.has(shellSearchResultKey(row)) && seen.add(shellSearchResultKey(row)));
}

export function shellSearchResultKey(row = {}) {
  return [row.type, row.id, row.workspaceId, row.sourceSection, row.route].map((value) => text(value, "none")).join(":");
}

export function shellSearchResultDomId(row = {}, prefix = "shell-result") {
  const scope = [row.type, row.id, row.workspaceId, row.sourceSection, row.route]
    .map((value) => encodeURIComponent(text(value, "none")).replaceAll("%", "_"))
    .join("--");
  return `${prefix}-${scope}`;
}

export function filterShellSearchResults(index = [], query = "") {
  const needle = String(query).trim().toLocaleLowerCase();
  if (!needle) return [];
  return index.filter((row) => [row.type, row.title, row.id, row.status].some((value) => String(value).toLocaleLowerCase().includes(needle))).slice(0, 12);
}

export function nextShellSearchInteraction({ key, activeIndex = 0, count = 0 }) {
  if (key === "Escape") return { activeIndex, close: true, selectIndex: -1 };
  if (key === "Enter") return { activeIndex, close: count > 0, selectIndex: count > 0 ? activeIndex : -1 };
  if (!count) return { activeIndex: 0, close: false, selectIndex: -1 };
  if (key === "ArrowDown") return { activeIndex: (activeIndex + 1) % count, close: false, selectIndex: -1 };
  if (key === "ArrowUp") return { activeIndex: (activeIndex - 1 + count) % count, close: false, selectIndex: -1 };
  return { activeIndex, close: false, selectIndex: -1 };
}

export function runShellSearchShortcut(event, { open = () => {}, focus = () => {} } = {}) {
  if (!(event?.metaKey || event?.ctrlKey) || String(event?.key).toLowerCase() !== "k") return false;
  event.preventDefault?.();
  open();
  focus();
  return true;
}

export function shellSearchResultUnavailable(row) {
  if (row?.type === "Feature") return false;
  const sourceState = String(row?.sourceState || "").toLowerCase();
  return Boolean(
    row?.sourceForbidden
    || row?.sourceStale
    || row?.sourceDegraded
    || ["stale", "degraded", "forbidden", "error", "failed", "loading", "not_loaded"].includes(sourceState)
  );
}

export function runShellSearchInteraction({ key, activeIndex = 0, results = [], data, onSelect = () => {}, onNavigate = () => {}, onClose = () => {}, onReject = () => {} } = {}) {
  const next = nextShellSearchInteraction({ key, activeIndex, count: results.length });
  let close = next.close;
  let selected = null;
  if (next.selectIndex >= 0) {
    const row = results[next.selectIndex];
    if (row) {
      selected = runShellObjectSelection({ data, candidate: row, workspaceId: row.workspaceId, onSelect, onNavigate });
      if (!selected) {
        close = false;
        onReject(row);
      }
    }
  }
  if (close) onClose();
  return { ...next, close, selected };
}

function selectionFailsClosed(selectedObject) {
  return shellSearchResultUnavailable(selectedObject);
}

function workspaceSelectionFailsClosed(data, workspaceId) {
  const workspace = WORKSPACES[workspaceId] || (workspaceId === "configuration" ? CONFIGURATION_WORKSPACE : null);
  const state = String(data?.resourceState?.[workspace?.resourceSection] || "").toLowerCase();
  return ["stale", "degraded", "forbidden", "error", "failed", "loading", "not_loaded"].includes(state);
}

function taskFourIdentityMatches(data, candidate) {
  const source = taskFourSelectionSources[candidate?.type];
  if (!source) return null;
  const candidateId = validAccountIdentity(candidate?.id) ? String(candidate.id) : "";
  if (!candidateId) return 0;
  const matches = asList(data[source.key])
    .map(source.project)
    .filter(Boolean)
    .filter((row) => String(source.id(row) || "") === candidateId);
  return matches.length;
}

export function resolveShellObjectSelection(data = {}, candidate = null, workspaceId = candidate?.workspaceId) {
  if (!candidate?.id || candidate.type === "Feature") return null;
  const candidateId = String(candidate.id);
  const accountIdentityMatches = asList(data.exchangeAccounts)
    .map(accountSearchSnapshot)
    .filter((row) => canonicalAccountIdentity(row) === candidateId);
  if ((candidate.type === "Account" || accountIdentityMatches.length > 0) && (!validAccountIdentity(candidate.id) || accountIdentityMatches.length !== 1)) return null;
  const taskFourMatches = taskFourIdentityMatches(data, candidate);
  if (taskFourMatches !== null && taskFourMatches !== 1) return null;
  const matches = buildShellSearchIndex(data).filter((row) => (
    row.id === candidateId
    && (!candidate.type || row.type === candidate.type)
    && (!workspaceId || row.workspaceId === workspaceId)
    && (!candidate.workspaceId || row.workspaceId === candidate.workspaceId)
    && (!candidate.sourceSection || row.sourceSection === candidate.sourceSection)
  ));
  if (matches.length !== 1 || selectionFailsClosed(matches[0]) || workspaceSelectionFailsClosed(data, matches[0].workspaceId)) return null;
  return matches[0];
}

export function resolveShellFeatureNavigation(data = {}, candidate = null) {
  if (!candidate?.id || candidate.type !== "Feature") return null;
  const matches = buildShellSearchIndex(data).filter((row) => (
    row.type === "Feature"
    && row.id === String(candidate.id)
    && (!candidate.route || row.route === candidate.route)
    && (!candidate.workspaceId || row.workspaceId === candidate.workspaceId)
    && (!candidate.sourceSection || row.sourceSection === candidate.sourceSection)
  ));
  return matches.length === 1 ? { ...matches[0], navigationOnly: true } : null;
}

export function runShellObjectSelection({ data = {}, candidate = null, workspaceId = candidate?.workspaceId, onSelect = () => {}, onNavigate = () => {}, navigate = true } = {}) {
  if (candidate?.type === "Feature") {
    const feature = resolveShellFeatureNavigation(data, candidate);
    if (!feature) return null;
    if (navigate) onNavigate(feature.route);
    return feature;
  }
  const selected = resolveShellObjectSelection(data, candidate, workspaceId);
  if (!selected) return null;
  onSelect(selected);
  if (navigate) onNavigate(selected.route, selected);
  return selected;
}

// Registry/Inspector surfaces keep their page-local inspector state, while this
// single bridge also asks the authenticated shell to resolve the same identity
// against its current, permission-scoped index. The shell callback owns the
// fail-closed decision; page components never retain a second global truth.
export function runShellRegistrySelection({ candidate = null, onLocalSelect = () => {}, onSelectObject = () => {}, onNavigate = null } = {}) {
  if (!candidate?.id || !candidate?.type) return null;
  const selected = onSelectObject(candidate);
  if (!selected || selected.id !== String(candidate.id) || selected.type !== candidate.type) return null;
  onLocalSelect(selected);
  if (onNavigate && selected.route) onNavigate(selected.route, selected);
  return selected;
}

export function CanonicalRegistryButton({ candidate, onLocalSelect = () => {}, onSelectObject = () => {}, onNavigate = null, onClick, children, type = "button", ...props }) {
  const select = (event) => {
    onClick?.(event);
    if (event?.defaultPrevented) return null;
    return runShellRegistrySelection({ candidate, onLocalSelect, onSelectObject, onNavigate });
  };
  return <button {...props} type={type} data-shell-object-id={candidate?.id} data-shell-object-type={candidate?.type} onClick={select}>{children}</button>;
}

export function selectionForNavigation(selectedObject, workspaceId, data) {
  if (!selectedObject || selectedObject.workspaceId !== workspaceId || selectionFailsClosed(selectedObject)) return null;
  if (data === undefined) return selectedObject;
  return resolveShellObjectSelection(data, selectedObject, workspaceId);
}

export function buildShellContext({ data = {}, workspaceId = "ai", selectedObject = null } = {}) {
  const workspace = WORKSPACES[workspaceId] || (workspaceId === "configuration" ? CONFIGURATION_WORKSPACE : null);
  const mandate = asList(data.mandates).find((item) => ["active", "enabled", "effective"].includes(String(item.status || item.state).toLowerCase())) || asList(data.mandates)[0];
  const raw = selectedObject?.raw || selectedObject || {};
  const source = sourceMetadata(data, selectedObject || raw, workspaceId, selectedObject?.sourceSection || workspace?.resourceSection);
  const objectStatus = String(firstValue(selectedObject?.status, raw.status, raw.state, unavailable));
  const sourceState = source.sourceState;
  const normalizedSourceState = sourceState.toLowerCase();
  const workspaceTrace = scopedTraceRows(data.traces, workspaceId, selectedObject)[0];
  const gate = source.sourceForbidden
    ? { kind: "forbidden", label: t("权限不足", "Permission denied"), detail: t("当前身份无权使用这个对象。", "The current identity cannot use this object.") }
    : ["error", "failed"].includes(normalizedSourceState)
      ? { kind: "error", label: t("数据加载失败", "Data failed to load"), detail: t("动作保持关闭，直到来源恢复。", "Actions remain closed until the source recovers.") }
      : ["loading", "not_loaded"].includes(normalizedSourceState)
        ? { kind: "loading", label: t("数据尚未就绪", "Data is not ready"), detail: t("等待权威来源完成加载。", "Waiting for the authoritative source to load.") }
        : source.sourceStale
          ? { kind: "stale", label: t("数据已陈旧", "Data is stale"), detail: t("动作保持关闭，直到来源刷新。", "Actions remain closed until the source refreshes.") }
          : source.sourceDegraded
            ? { kind: "degraded", label: t("来源已降级", "Source is degraded"), detail: t("受影响的动作保持关闭。", "Affected actions remain closed.") }
            : null;
  const workspaceEvidence = {
    ai: firstValue(workspaceTrace?.evidenceId, workspaceTrace?.id, asList(data.events)[0]?.id),
    live: firstValue(asList(data.markets)[0]?.updatedAt, asList(data.positions)[0]?.id, asList(data.executionOrders)[0]?.id),
    lab: firstValue(asList(data.reviews)[0]?.id, asList(data.knowledge?.sources)[0]?.id, asList(data.skills)[0]?.id),
    control: firstValue(asList(data.riskChecks)[0]?.id, asList(data.mandates)[0]?.id, asList(data.riskIncidents)[0]?.id),
    operations: firstValue(asList(data.auditLogs)[0]?.id, asList(data.tasks)[0]?.id, asList(data.jobRuns)[0]?.id),
    configuration: firstValue(asList(data.exchangeAccounts)[0]?.id, data.system?.version)
  }[workspaceId];
  return {
    evidence: String(firstValue(selectedObject?.evidence, raw.evidenceId, raw.updatedAt, workspaceEvidence, unavailable)),
    risk: String(firstValue(selectedObject?.risk, raw.risk, raw.riskLevel, raw.severity, data.portfolioRisk?.status, unavailable)),
    mandate: String(firstValue(raw.mandateId, mandate?.name, mandate?.title, mandate?.id, unavailable)),
    object: String(firstValue(selectedObject?.id, raw.id, raw.symbol, workspace?.id, unavailable)),
    objectType: String(firstValue(selectedObject?.type, raw.objectType, raw.entityType, workspace ? "Workspace" : null, unavailable)),
    version: String(firstValue(selectedObject?.version, raw.version, raw.revision, unavailable)),
    permissions: String(firstValue(selectedObject?.permission, raw.permission, raw.permissions, raw.requiredPermission, mandate?.permission, unavailable)),
    nextAction: String(firstValue(selectedObject?.nextAction, raw.nextAction, raw.allowedAction, selectedObject?.route ? `Open ${selectedObject.route}` : null, workspace?.rootRoute ? `Open ${workspace.rootRoute}` : null, unavailable)),
    title: String(firstValue(selectedObject?.title, raw.title, raw.name, raw.symbol, workspace?.labelEn, unavailable)),
    status: objectStatus,
    objectStatus,
    sourceState,
    sourceStale: source.sourceStale,
    sourceDegraded: source.sourceDegraded,
    sourceForbidden: source.sourceForbidden,
    gate,
    actionsDisabled: Boolean(gate),
    route: selectedObject?.route || workspace?.rootRoute || "",
    workspaceId,
    sourceSection: selectedObject?.sourceSection || workspace?.resourceSection || ""
  };
}

const TRACE_STAGE_NAMES = Object.freeze(["Sense", "Recall", "Plan", "Guard", "Execute", "Monitor", "Review"]);
const knownTraceStatus = (value) => {
  const status = String(value || "").toLowerCase();
  if (["complete", "completed", "ok", "success", "passed"].includes(status)) return "complete";
  if (["blocked", "failed", "error", "forbidden"].includes(status)) return "blocked";
  if (["waiting", "pending", "queued", "running", "active"].includes(status)) return "waiting";
  return "unavailable";
};
const collectionTrace = (value, detail) => !Array.isArray(value)
  ? { status: "unavailable", detail: unavailable }
  : { status: "waiting", detail: value.length ? `${value.length} fact${value.length === 1 ? "" : "s"} available; no scoped stage result` : detail };

const TRACE_EXPLICIT_PRIMARY_FIELDS = Object.freeze(["objectId", "entityId"]);
const TRACE_FALLBACK_PRIMARY_FIELDS = Object.freeze(["id"]);
const TRACE_RUN_FIELDS = Object.freeze(["runId", "agentRunId", "agent_run_id", "sourceRunId"]);
const TRACE_RELATED_FIELDS = Object.freeze([
  "planId", "tradePlanId", "orderId", "executionOrderId", "positionId", "taskId",
  "reviewId", "mandateId", "strategyId", "riskCheckId", "analysisBundleId", "subjectId"
]);

function typedIdentityValue(value, field) {
  return firstValue(value?.[field], value?.raw?.[field]);
}

function declaredTypedIdentities(value, fields) {
  return fields.flatMap((field) => {
    const identity = typedIdentityValue(value, field);
    return identity == null || identity === "" ? [] : [{ field, value: String(identity) }];
  });
}

function declaredPrimaryIdentities(value) {
  const explicit = declaredTypedIdentities(value, TRACE_EXPLICIT_PRIMARY_FIELDS);
  return explicit.length ? explicit : declaredTypedIdentities(value, TRACE_FALLBACK_PRIMARY_FIELDS);
}

function traceIdentityMatches(row, selectedObject) {
  const declaredType = firstValue(row?.objectType, row?.entityType, row?.raw?.objectType, row?.raw?.entityType);
  if (declaredType != null && String(declaredType) !== String(selectedObject?.type || "")) return false;
  const selectedPrimary = firstValue(
    selectedObject?.objectId,
    selectedObject?.entityId,
    selectedObject?.id,
    selectedObject?.raw?.objectId,
    selectedObject?.raw?.entityId,
    selectedObject?.raw?.id
  );
  const primary = declaredPrimaryIdentities(row);
  const runs = declaredTypedIdentities(row, TRACE_RUN_FIELDS);
  const related = declaredTypedIdentities(row, TRACE_RELATED_FIELDS);
  let matched = false;

  if (primary.length) {
    if (selectedPrimary == null || primary.some((identity) => identity.value !== String(selectedPrimary))) return false;
    matched = true;
  }
  for (const identity of runs) {
    const selectedRun = typedIdentityValue(selectedObject, identity.field);
    if (selectedRun == null || identity.value !== String(selectedRun)) return false;
    matched = true;
  }
  for (const identity of related) {
    const selectedRelated = typedIdentityValue(selectedObject, identity.field);
    if (selectedRelated == null) continue;
    if (identity.value !== String(selectedRelated)) return false;
    matched = true;
  }
  return matched;
}

function scopedTraceRows(rows, workspaceId, selectedObject) {
  return asList(rows).filter((row) => {
    const rowWorkspace = firstValue(row.workspaceId, row.workspace, row.productWorkspace);
    if (String(rowWorkspace || "") !== String(workspaceId)) return false;
    if (selectedObject) return traceIdentityMatches(row, selectedObject);
    return declaredPrimaryIdentities(row).length === 0
      && declaredTypedIdentities(row, [...TRACE_RUN_FIELDS, ...TRACE_RELATED_FIELDS]).length === 0;
  });
}

export function buildShellTrace(data = {}, workspaceId = "ai", selectedObject = null) {
  const explicit = new Map(scopedTraceRows(data.traces, workspaceId, selectedObject).map((row) => [String(row.stage || row.name || "").toLowerCase(), row]));
  const workspace = WORKSPACES[workspaceId] || (workspaceId === "configuration" ? CONFIGURATION_WORKSPACE : null);
  const resourceState = String(data.resourceState?.[workspace?.resourceSection] || "").toLowerCase();
  const blocked = ["error", "failed", "forbidden"].includes(resourceState);
  const inferred = {
    sense: collectionTrace(data.markets, "Waiting for market facts"),
    recall: collectionTrace(data.knowledge?.sources, "No recalled source in the current scope"),
    plan: collectionTrace(data.tradePlans, "No current plan"),
    guard: collectionTrace(Array.isArray(data.riskChecks) ? data.riskChecks : data.mandates, "Waiting for a guard decision"),
    execute: collectionTrace(Array.isArray(data.executionOrders) ? data.executionOrders : Array.isArray(data.orders) ? data.orders : data.fills, "No execution has started"),
    monitor: collectionTrace(Array.isArray(data.watchTriggers) ? data.watchTriggers : data.positions, "No active monitor fact"),
    review: collectionTrace(Array.isArray(data.reviews) ? data.reviews : data.auditLogs, "No review is due")
  };
  return TRACE_STAGE_NAMES.map((label) => {
    const key = label.toLowerCase();
    const row = explicit.get(key);
    return {
      id: key,
      label,
      status: row ? knownTraceStatus(row.status || row.state) : blocked ? "blocked" : inferred[key].status,
      detail: String(firstValue(row?.detail, row?.summary, row?.evidenceId, blocked ? `Workspace source is ${resourceState}` : null, inferred[key].detail, unavailable)),
      evidence: String(firstValue(row?.evidenceId, row?.id, row?.createdAt, unavailable)),
      workspaceId,
      sourceSection: selectedObject?.sourceSection || workspace?.resourceSection || "",
      route: selectedObject?.route || workspace?.rootRoute || "",
      objectType: selectedObject?.type || null,
      objectId: selectedObject?.id || null
    };
  });
}

export function buildCommandFacts(data = {}) {
  const freshnessMs = firstValue(data.system?.dataFreshnessMs, data.marketStatus?.dataFreshnessMs);
  const explicitFreshnessState = firstValue(data.system?.dataFreshnessState, data.marketStatus?.dataFreshnessState, data.system?.dataStale === true ? "stale" : data.system?.dataStale === false ? "fresh" : null);
  const freshnessState = String(explicitFreshnessState || (freshnessMs == null ? "unavailable" : "available"));
  const latencyMs = firstValue(data.system?.latencyMs, data.marketStatus?.latencyMs);
  return {
    freshness: {
      label: "FRESHNESS",
      value: freshnessMs == null ? unavailable : explicitFreshnessState ? `${freshnessState} · ${freshnessMs} ms` : `${freshnessMs} ms`,
      state: freshnessMs == null ? "unavailable" : freshnessState.toLowerCase()
    },
    latency: {
      label: "LATENCY",
      value: latencyMs == null ? unavailable : `${latencyMs} ms`,
      state: latencyMs == null ? "unavailable" : "available"
    }
  };
}

export function CommandRail({ data = {}, onNavigate = () => {}, onSelect = () => {} }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectionFeedback, setSelectionFeedback] = useState("");
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const index = useMemo(() => buildShellSearchIndex(data), [data]);
  const results = useMemo(() => filterShellSearchResults(index, query), [index, query]);
  const unread = asList(data.notifications).filter((row) => !row.read).length;
  const pendingReviews = asList(data.reviews).filter((row) => ["pending", "waiting", "required"].includes(String(row.status).toLowerCase())).length;
  const watchCount = asList(data.watchTriggers).length || asList(data.watches).length;
  const commandFacts = buildCommandFacts(data);
  useEffect(() => {
    const onPointer = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => runShellSearchShortcut(event, { open: () => setOpen(true), focus: () => inputRef.current?.focus() });
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); window.removeEventListener("keydown", onKey); };
  }, []);
  const select = (row) => {
    if (!row) return;
    const selected = runShellObjectSelection({ data, candidate: row, workspaceId: row.workspaceId, onSelect, onNavigate });
    if (!selected) {
      setSelectionFeedback(t("数据不可用。请刷新来源或检查权限。", "Data is unavailable. Refresh the source or check permissions."));
      return;
    }
    setSelectionFeedback("");
    setQuery("");
    setOpen(false);
  };
  const onKeyDown = (event) => {
    if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return;
    event.preventDefault();
    const next = runShellSearchInteraction({
      key: event.key,
      activeIndex,
      results,
      data,
      onSelect,
      onNavigate,
      onClose: () => { setQuery(""); setSelectionFeedback(""); setOpen(false); },
      onReject: () => setSelectionFeedback(t("数据不可用。请刷新来源或检查权限。", "Data is unavailable. Refresh the source or check permissions."))
    });
    setActiveIndex(next.activeIndex);
  };
  return <section className="commandRail" data-shell-role="command-rail" aria-label={t("全局命令栏", "Global command rail")}>
    <div className="commandRail__brand"><img src="/kordyn-logo.svg" alt=""/><span><b>KORDYN</b><small>{text(data.user?.tenantName || data.user?.organization, unavailable)}</small></span></div>
    <div className="commandRail__search" ref={rootRef}>
      <Search aria-hidden="true"/><input ref={inputRef} role="combobox" aria-expanded={open} aria-controls="shell-search-results" aria-activedescendant={results[activeIndex] ? shellSearchResultDomId(results[activeIndex]) : undefined} value={query} placeholder={t("搜索真实对象或功能 ⌘K", "Search objects or features ⌘K")} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setSelectionFeedback(""); setOpen(true); }} onKeyDown={onKeyDown}/>
      {query && <button type="button" aria-label={t("清空搜索", "Clear search")} onClick={() => { setQuery(""); setSelectionFeedback(""); inputRef.current?.focus(); }}><X/></button>}
      {open && query && <div className="commandRail__results" id="shell-search-results" role="listbox">
        {results.length ? results.map((row, indexValue) => { const unavailableResult = shellSearchResultUnavailable(row); return <button id={shellSearchResultDomId(row)} type="button" role="option" aria-selected={activeIndex === indexValue} aria-disabled={unavailableResult || undefined} data-shell-result-state={unavailableResult ? "unavailable" : "available"} data-shell-object-id={row.type === "Feature" ? undefined : row.id} data-shell-object-type={row.type === "Feature" ? undefined : row.type} className={`${activeIndex === indexValue ? "active " : ""}${unavailableResult ? "unavailable" : ""}`.trim()} key={shellSearchResultKey(row)} onPointerEnter={() => setActiveIndex(indexValue)} onClick={() => select(row)}><small>{row.type}</small><span><b>{row.title}</b><code>{row.id}</code></span><em>{unavailableResult ? t("不可用", "Unavailable") : row.status}</em></button>; }) : <p role="status">{t("没有匹配的已加载对象或功能。", "No loaded object or feature matches.")}</p>}
        {selectionFeedback && <p className="commandRail__feedback" role="status" data-shell-search-feedback>{selectionFeedback}</p>}
      </div>}
    </div>
    <div className="commandRail__facts" aria-label={t("全局运行事实", "Global runtime facts")}>
      <span data-state={commandFacts.freshness.state}><small>{commandFacts.freshness.label}</small><b>{commandFacts.freshness.value}</b></span>
      <span data-state={commandFacts.latency.state}><small>{commandFacts.latency.label}</small><b>{commandFacts.latency.value}</b></span>
      <span><small>WATCH</small><b>{data.watchTriggers || data.watches ? watchCount : unavailable}</b></span>
      <span><small>REVIEW</small><b>{data.reviews ? pendingReviews : unavailable}</b></span>
      <span><small>NOTICE</small><b>{data.notifications ? unread : unavailable}</b></span>
    </div>
  </section>;
}

const WORKSPACE_ICONS = { ai: Bot, live: PieChart, lab: BookOpen, control: ShieldCheck, operations: Activity };

export function WorkspaceRail({ activeWorkspace = "ai", onNavigate = () => {} }) {
  return <aside className="workspaceRail" data-shell-role="workspace-rail">
    <nav aria-label={t("工作区", "Workspaces")}>{Object.values(WORKSPACES).map((workspace) => {
      const Icon = WORKSPACE_ICONS[workspace.id] || Activity;
      const active = activeWorkspace === workspace.id;
      return <button type="button" key={workspace.id} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => onNavigate(workspace.rootRoute)}><small>{workspace.code}</small><Icon/><span><b>{t(workspace.label, workspace.labelEn)}</b><em>{t(workspace.purpose, workspace.purposeEn)}</em></span></button>;
    })}</nav>
    <button type="button" className={activeWorkspace === "configuration" ? "workspaceRail__utility active" : "workspaceRail__utility"} onClick={() => onNavigate(CONFIGURATION_WORKSPACE.rootRoute)}><small>CFG</small><Settings/><span><b>{t(CONFIGURATION_WORKSPACE.label, CONFIGURATION_WORKSPACE.labelEn)}</b><em>{t(CONFIGURATION_WORKSPACE.purpose, CONFIGURATION_WORKSPACE.purposeEn)}</em></span></button>
  </aside>;
}

const CONTEXT_FIELDS = Object.freeze([
  ["Evidence", "evidence"], ["Risk", "risk"], ["Mandate", "mandate"], ["Object", "object"],
  ["Version", "version"], ["Permissions", "permissions"], ["Next action", "nextAction"]
]);

export function ContextDock({ context = buildShellContext(), onNavigate = () => {}, collapsible = true, initiallyCollapsed = false, className = "", rootRef = null, onClose = null, ...rootProps }) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  const objectIdentity = context.objectType && context.object && context.object !== unavailable ? `${context.objectType}:${context.object}` : "none";
  return <aside ref={rootRef} {...rootProps} className={["contextDock", className, collapsed ? "collapsed" : ""].filter(Boolean).join(" ")} data-shell-role="context-dock" data-shell-context-object={objectIdentity} data-shell-context-workspace={context.workspaceId || "none"} data-shell-context-source={context.sourceSection || "none"} data-shell-context-route={context.route || "none"} data-shell-context-evidence={context.evidence || unavailable} role="dialog" aria-modal="true" aria-labelledby="zero-base-context-title" tabIndex={-1}>
    <header><span><small>CONTEXT</small><b id="zero-base-context-title">{context.title}</b><em>{context.objectStatus || context.status}</em></span>{collapsible && <button type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? t("展开上下文", "Expand context") : t("收起上下文", "Collapse context")}>{collapsed ? <ChevronDown/> : <ChevronUp/>}</button>}{onClose && <button type="button" className="contextDock__close" onClick={onClose} aria-label={t("关闭上下文", "Close context")}><X/></button>}</header>
    {!collapsed && <>{context.gate && <section className={`contextDock__gate state-${context.gate.kind}`} role="status"><b>{context.gate.label}</b><p>{context.gate.detail}</p><small>SOURCE · {context.sourceState}</small></section>}<dl>{CONTEXT_FIELDS.map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{key === "object" && context.objectType ? `${context.objectType} / ${text(context.object, unavailable)}` : text(context[key], unavailable)}</dd></div>)}</dl><footer><button type="button" disabled={context.actionsDisabled || !context.route} onClick={() => context.route && !context.actionsDisabled && onNavigate(context.route)}>{context.nextAction}</button></footer></>}
  </aside>;
}

export function TraceRail({ stages = buildShellTrace(), initiallyExpanded = "", className = "", rootRef = null, onClose = null, ...rootProps }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const selected = stages.find((stage) => stage.id === expanded);
  const closeRef = useRef(null);
  const triggerRef = useRef(null);
  const summary = selected || stages.find((stage) => stage.status === "blocked") || stages.find((stage) => stage.status === "waiting") || stages[0];
  const selectedIdentity = stages.find((stage) => stage.objectId);
  const traceEvidence = stages.find((stage) => stage.objectId && stage.evidence && stage.evidence !== unavailable) || selectedIdentity;

  const close = () => {
    setExpanded("");
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!selected) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected?.id]);

  const objectIdentity = selectedIdentity?.objectType && selectedIdentity?.objectId ? `${selectedIdentity.objectType}:${selectedIdentity.objectId}` : "none";
  return <section ref={rootRef} {...rootProps} className={["traceRail", className, selected ? "expanded" : ""].filter(Boolean).join(" ")} data-shell-role="trace-rail" data-shell-trace-object={objectIdentity} data-shell-trace-workspace={selectedIdentity?.workspaceId || "none"} data-shell-trace-source={selectedIdentity?.sourceSection || "none"} data-shell-trace-route={selectedIdentity?.route || "none"} data-shell-trace-evidence={traceEvidence?.evidence || unavailable} role="dialog" aria-modal="true" aria-labelledby="zero-base-trace-title" tabIndex={-1}>
    <header className="traceRail__title"><strong id="zero-base-trace-title">DECISION TRACE</strong><span>{selectedIdentity ? `${selectedIdentity.objectType} / ${selectedIdentity.objectId}` : t("每一步都有真实证据边界", "Every step has a factual evidence boundary")}</span>{selected && <small>{t("选择阶段或关闭详情", "Choose a stage or close detail")}</small>}{onClose && <button type="button" className="traceRail__close" onClick={onClose} aria-label={t("关闭决策追踪", "Close decision trace")}><X/></button>}</header>
    <nav>{stages.map((stage, index) => <button type="button" key={stage.id} className={`traceRail__stage status-${stage.status}`} aria-expanded={expanded === stage.id} onClick={(event) => { triggerRef.current = event.currentTarget; setExpanded(expanded === stage.id ? "" : stage.id); }}><small>{String(index + 1).padStart(2, "0")}</small><b>{stage.label}</b><span>{stage.status}</span><em>{stage.detail}</em><code>{stage.evidence}</code></button>)}</nav>
    <article className="traceRail__object traceRail__detail"><header><span><small>{selected ? "TRACE DETAIL" : "CURRENT TRACE"}</small><b>{summary?.label || unavailable}</b></span>{selected && <button ref={closeRef} type="button" aria-label={t("收起追踪详情", "Collapse trace detail")} onClick={close}><X/></button>}</header><dl>{selectedIdentity && <div><dt>OBJECT</dt><dd>{selectedIdentity.objectType} / {selectedIdentity.objectId}</dd></div>}<div><dt>STATUS</dt><dd>{summary?.status || unavailable}</dd></div><div><dt>EVIDENCE</dt><dd>{summary?.evidence || unavailable}</dd></div><div><dt>DETAIL</dt><dd>{summary?.detail || unavailable}</dd></div></dl></article>
  </section>;
}

function groupViews(views) {
  return views.reduce((groups, view) => {
    const id = view.group || "views";
    let group = groups.find((item) => item.id === id);
    if (!group) {
      group = { id, label: view.group || "视图", labelEn: view.groupEn || "VIEWS", views: [] };
      groups.push(group);
    }
    group.views.push(view);
    return groups;
  }, []);
}

export function ProductWorkspaceFrame({ workspaceId, activeView, views = [], onViewChange = () => {}, inspector, children }) {
  const workspace = WORKSPACES[workspaceId] || (workspaceId === "configuration" ? CONFIGURATION_WORKSPACE : WORKSPACES.ai);
  const activeItem = views.find((view) => view.id === activeView) || views[0] || {
    label: workspace.label, labelEn: workspace.labelEn, description: workspace.purpose, descriptionEn: workspace.purposeEn
  };
  const groups = groupViews(views);
  return (
    <section className="productWorkspaceFrame" data-product-workspace={workspace.id}>
      <header className="productWorkspaceFrame__header">
        <div>
          <small>{workspace.code} / {t(workspace.eyebrow, workspace.eyebrowEn)}</small>
          <h1>{t(workspace.label, workspace.labelEn)}</h1>
          <p>{t(workspace.purpose, workspace.purposeEn)}</p>
        </div>
        <aside aria-label={t("当前视图", "Current view")}>
          <small>CURRENT WORKSPACE</small>
          <b>{t(activeItem.label, activeItem.labelEn)}</b>
          <span>{t(activeItem.description || "", activeItem.descriptionEn || activeItem.description || "")}</span>
        </aside>
      </header>
      {views.length > 0 && <nav className="productWorkspaceFrame__nav" aria-label={`${t(workspace.label, workspace.labelEn)} ${t("子页面", "sections")}`}>
        {groups.map((group) => <div key={group.id} className="productWorkspaceFrame__navGroup">
          <small>{t(group.label, group.labelEn)}</small>
          <div>{group.views.map((view) => <button type="button" key={view.id} aria-current={activeView === view.id ? "page" : undefined} className={activeView === view.id ? "active" : ""} onClick={() => onViewChange(view.id)}>{t(view.label, view.labelEn)}</button>)}</div>
        </div>)}
      </nav>}
      <div className={inspector ? "productWorkspaceFrame__grid" : "productWorkspaceFrame__grid productWorkspaceFrame__grid--single"}>
        <div className="productWorkspaceFrame__body">{children}</div>
        {inspector ? <aside className="productWorkspaceFrame__inspector">{inspector}</aside> : null}
      </div>
    </section>
  );
}

export function ObjectInspector({ object = {}, onOpenPrimary }) {
  const consumers = Array.isArray(object.consumers) ? object.consumers : object.consumers ? [object.consumers] : [];
  const canOpen = Boolean(object.primaryRoute && onOpenPrimary);
  return <section className="objectInspector" aria-label={t("对象详情", "Object inspector")}>
    <header><small>{text(object.type, "OBJECT")} · {text(object.id)}</small><h2>{text(object.title)}</h2><span>{text(object.status)}</span></header>
    <dl>
      <div><dt>SOURCE</dt><dd>{text(object.source)}</dd></div>
      <div><dt>VERSION</dt><dd>{text(object.version)}</dd></div>
      <div><dt>PERMISSION</dt><dd>{text(object.permission)}</dd></div>
      <div><dt>RISK</dt><dd>{text(object.risk)}</dd></div>
      <div><dt>CONSUMERS</dt><dd>{consumers.length ? <ul>{consumers.map((item) => <li key={item}>{item}</li>)}</ul> : "—"}</dd></div>
      <div><dt>NEXT ACTION</dt><dd>{text(object.nextAction)}</dd></div>
    </dl>
    <footer><small>PRIMARY WORKBENCH</small><button type="button" disabled={!canOpen} data-primary-route={object.primaryRoute || undefined} onClick={() => canOpen && onOpenPrimary(object.primaryRoute)}>{t("打开权威工作台", "Open primary workbench")}</button></footer>
  </section>;
}

function StatePanel({ kind, title, detail, onRetry }) {
  return <section className={`workspaceState workspaceState--${kind}`} role={kind === "error" ? "alert" : "status"}>
    <i aria-hidden="true" />
    <div><b>{title}</b>{detail && <span>{detail}</span>}</div>
    {onRetry && <button type="button" onClick={onRetry}>{t("重试", "Retry")}</button>}
  </section>;
}

export function workspaceResourceRetainsLastValid(resourceState) {
  return ["stale", "degraded"].includes(String(resourceState || "").toLowerCase());
}

export function WorkspaceStateBoundary({ resourceState = "loaded", empty = false, stale = false, degraded = false, forbidden = "", actionOutcome = null, onRetry, children }) {
  const normalizedState = String(resourceState || "loaded").toLowerCase();
  const isStale = stale || normalizedState === "stale";
  const isDegraded = degraded || normalizedState === "degraded";
  if (forbidden || normalizedState === "forbidden") return <StatePanel kind="forbidden" title={t("需要权限", "Permission required")} detail={forbidden ? t(`当前操作需要 ${forbidden} 权限。`, `This surface requires ${forbidden} permission.`) : t("当前身份无权查看这组工作区事实。", "The current identity cannot view these workspace facts.")} />;
  if (normalizedState === "not_loaded") return <StatePanel kind="loading" title={t("尚未加载", "Not loaded")} detail={t("进入工作区后再请求真实数据。", "Real data loads when the workspace opens.")} />;
  if (normalizedState === "loading") return <StatePanel kind="loading" title={t("正在加载", "Loading")} detail={t("正在读取当前工作区事实。", "Loading current workspace facts.")} />;
  if (["error", "failed"].includes(normalizedState)) return <StatePanel kind="error" title={t("加载失败", "Workspace failed to load")} detail={t("空白不代表数据为零，请重新加载。", "Blank values do not mean zero. Retry the workspace request.")} onRetry={onRetry} />;
  if (empty) return <StatePanel kind="empty" title={t("暂无数据", "No data")} detail={t("当前筛选或权限范围内没有记录。", "No records exist in the current filter or permission scope.")} />;
  const constrained = isStale || isDegraded;
  return <div className={`workspaceStateBoundary ${constrained ? "workspaceStateBoundary--constrained" : ""}`} data-resource-state={normalizedState}>
    {isStale && <StatePanel kind="warning" title={t("数据已陈旧", "Data is stale")} detail={t("保留最后有效事实；执行前需要刷新。", "The last valid facts remain visible; refresh before execution.")} onRetry={onRetry} />}
    {isDegraded && <StatePanel kind="warning" title={t("服务降级", "Service degraded")} detail={t("部分事实不可用，受影响的动作会保持关闭。", "Some facts are unavailable; affected actions remain closed.")} onRetry={onRetry} />}
    {actionOutcome?.kind === "error" && <StatePanel kind="error" title={t("操作失败", "Action failed")} detail={text(actionOutcome.message, t("服务端未确认变更。", "The server did not confirm the change."))} />}
    {actionOutcome?.kind === "success" && <StatePanel kind="success" title={t("操作已确认", "Action confirmed")} detail={text(actionOutcome.message)} />}
    {constrained
      ? <div className="workspaceStateBoundary__lastValid" data-last-valid-interaction="disabled" aria-disabled="true" inert="">{children}</div>
      : children}
  </div>;
}
