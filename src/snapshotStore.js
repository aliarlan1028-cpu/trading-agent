import {
  createJsonProjectionArray,
  createJsonProjectionRecord,
  hasJsonResponseProvenance,
  jsonResponseArrayValues,
  projectJsonResponseRecord
} from "./jsonResponseProvenance.js";

const CORE_OWNED_FIELDS = Object.freeze([
  "user", "system", "systemRelease", "automationState", "agentStatus", "portfolio",
  "performance", "positions", "markets", "activeMarket", "marketRegime", "watchlist",
  "mandates", "notifications", "realtimeConnections", "realtimeStarted", "exchangeAccounts",
  "subscriptions", "config", "readiness"
]);

const LIVE_ROW_FIELDS = Object.freeze([
  "tradePlans", "executionOrders", "armedSetups", "fills", "watchTriggers", "riskIncidents", "notifications"
]);

function responseRecord(value) {
  return hasJsonResponseProvenance(value) && !Array.isArray(value);
}

function ownDataValue(record, key) {
  if (!responseRecord(record)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function responseRows(value) {
  return (jsonResponseArrayValues(value) || []).filter(responseRecord);
}

function rowKey(row) {
  return ownDataValue(row, "id") || ownDataValue(row, "clientOrderId") || ownDataValue(row, "tradeId") || null;
}

function mergeRows(fresh = [], detailed = [], keyOf = rowKey) {
  const result = createJsonProjectionArray();
  const seen = new Set();
  const detailRows = responseRows(detailed);
  const detailByKey = new Map(detailRows.map((row) => [keyOf(row), row]).filter(([key]) => key != null));
  for (const row of responseRows(fresh)) {
    const key = keyOf(row);
    if (key == null) {
      result.push(row);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    const detail = detailByKey.get(key);
    result.push(detail ? projectJsonResponseRecord(detail, row) : row);
  }
  for (const row of detailRows) {
    const key = keyOf(row);
    if (key != null && seen.has(key)) continue;
    if (key != null) seen.add(key);
    result.push(row);
  }
  return result;
}

export function createSnapshotStore() {
  return {
    core: null,
    coreRevision: 0,
    coreInvalidationRevision: 0,
    sectionInvalidationRevisions: new Map(),
    sections: new Map(),
    sectionRevisions: new Map(),
    resourceState: createJsonProjectionRecord()
  };
}

export function clearSnapshotStore(store) {
  store.core = null;
  store.coreRevision = 0;
  store.coreInvalidationRevision = 0;
  store.sectionInvalidationRevisions.clear();
  store.sections.clear();
  store.sectionRevisions.clear();
  store.resourceState = createJsonProjectionRecord();
  return store;
}

export function markSnapshotResource(store, section, state) {
  const resourceState = projectJsonResponseRecord(store.resourceState);
  resourceState[section] = state;
  store.resourceState = resourceState;
}

export function observeSnapshotInvalidation(store, event = {}) {
  const revision = Number(event?.revision || 0);
  if (!Number.isFinite(revision) || revision <= 0) return false;
  if (event?.type === "core_invalidated") {
    if (revision <= Number(store.coreInvalidationRevision || 0)) return false;
    store.coreInvalidationRevision = revision;
    return true;
  }
  if (event?.type === "knowledge_updated") {
    const section = "researchCenter";
    if (revision <= Number(store.sectionInvalidationRevisions.get(section) || 0)) return false;
    store.sectionInvalidationRevisions.set(section, revision);
    return true;
  }
  // portfolio and market ticks patch live fields directly. They must not make
  // an already-computed HTTP snapshot impossible to accept on a slower network.
  return false;
}

export function shouldRetryStaleSnapshot(options = {}) {
  return options.staleRetry !== true;
}

export function acceptCoreSnapshot(store, snapshot, minimumRevision = 0) {
  const revision = Number(snapshot?.revision || 0);
  const requiredRevision = Math.max(Number(minimumRevision || 0), Number(store.coreInvalidationRevision || 0), Number(store.coreRevision || 0));
  if (revision < requiredRevision) return false;
  store.core = snapshot;
  store.coreRevision = revision;
  store.resourceState = projectJsonResponseRecord(ownDataValue(snapshot, "resourceState"), store.resourceState);
  return true;
}

export function acceptSectionSnapshot(store, section, snapshot, minimumRevision = 0) {
  const revision = Number(snapshot?.revision || 0);
  const previousRevision = Number(store.sectionRevisions.get(section) || 0);
  const requiredRevision = Math.max(
    Number(minimumRevision || 0),
    Number(store.coreRevision || 0),
    Number(store.coreInvalidationRevision || 0),
    Number(store.sectionInvalidationRevisions.get(section) || 0),
    previousRevision
  );
  if (revision < requiredRevision) return false;
  store.sections.set(section, snapshot);
  store.sectionRevisions.set(section, revision);
  store.resourceState = projectJsonResponseRecord(store.resourceState, ownDataValue(snapshot, "resourceState"));
  store.resourceState[section] = "loaded";
  return true;
}

export function projectSnapshotStore(store, section = "chat", supplementalSections = []) {
  if (!store.core) return null;
  const detail = store.sections.get(section) || null;
  const supplements = supplementalSections
    .filter((item) => item && item !== section)
    .map((item) => store.sections.get(item))
    .filter(Boolean);
  const contextDetail = projectJsonResponseRecord(...supplements, ...(detail ? [detail] : []));
  const projected = projectJsonResponseRecord(store.core, contextDetail);
  if (detail || supplements.length) {
    for (const field of CORE_OWNED_FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(store.core, field);
      if (descriptor && Object.hasOwn(descriptor, "value")) projected[field] = descriptor.value;
    }
    for (const field of LIVE_ROW_FIELDS) {
      if (Object.hasOwn(contextDetail, field) || Object.hasOwn(store.core, field)) {
        projected[field] = mergeRows(store.core[field], contextDetail[field]);
      }
    }
    if (Object.hasOwn(contextDetail, "markets") || Object.hasOwn(store.core, "markets")) {
      projected.markets = mergeRows(store.core.markets, contextDetail.markets, (row) => ownDataValue(row, "symbol") || null);
    }
  }
  projected.loadedSections = createJsonProjectionArray();
  projected.loadedSections.push(...store.sections.keys());
  projected.resourceState = projectJsonResponseRecord(ownDataValue(store.core, "resourceState"), store.resourceState);
  projected.revision = Math.max(
    store.coreRevision,
    Number(store.sectionRevisions.get(section) || 0),
    ...supplementalSections.map((item) => Number(store.sectionRevisions.get(item) || 0))
  );
  return projected;
}
