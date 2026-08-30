import { executionExitAction } from "../../../executionExit.js";
import { canonicalPositionIdentity } from "../../../productShell.jsx";
import { buildExecutionView, buildMarketRows, buildPositionView } from "../../../viewData.js";

const MAX_COLLECTION_LENGTH = 10_000;
const missingRead = Object.freeze({ kind: "missing" });
const invalidRead = Object.freeze({ kind: "invalid" });
const finiteFinancial = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const finitePositionFinancial = (value) => typeof value === "string" && value !== ""
  ? finiteFinancial(Number(value))
  : finiteFinancial(value);
const finiteCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const firstKnown = (...values) => values.find((value) => value !== null && value !== undefined);
const POSITION_IDENTITY_FIELDS = Object.freeze(["id", "positionId", "instId", "symbol"]);
const POSITION_NUMERIC_FIELDS = Object.freeze([
  "quantity", "size", "pos", "qty",
  "notional", "notionalUsdt", "marketValue",
  "markPrice", "mark", "price", "entryPrice", "entry",
  "unrealizedPnl", "pnl", "upl",
  "margin", "initialMargin", "leverage", "liqPx", "liquidationPrice",
  "liqDistancePct", "stopLoss", "stopLossPrice", "takeProfit"
]);
const validPositionIdentity = (value) => typeof value === "string"
  && value.length > 0
  && value.length <= 240
  && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value)
  && !["unavailable", "unknown", "n/a", "—"].includes(value.toLowerCase());
const availability = (state, count = null) => ({ state, count });

function plainRecord(value) {
  if (!value || typeof value !== "object") return false;
  try {
    if (Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownDataRead(record, field) {
  if (!plainRecord(record)) return invalidRead;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, field);
    if (!descriptor) return missingRead;
    return Object.hasOwn(descriptor, "value")
      ? { kind: "value", value: descriptor.value }
      : invalidRead;
  } catch {
    return invalidRead;
  }
}

function recordSnapshot(value) {
  if (!plainRecord(value)) return null;
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(value); } catch { return null; }
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length > 128 || keys.some((key) => typeof key !== "string")) return null;
  const snapshot = Object.create(null);
  for (const key of keys) {
    const descriptor = descriptors[key];
    if (!descriptor || !Object.hasOwn(descriptor, "value")) return null;
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: descriptor.value
    });
  }
  return snapshot;
}

function safePositionScalar(value) {
  if (value === null || value === undefined || value === "") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && Number.isFinite(Number(value));
}

function safePositionRecord(position) {
  for (const field of POSITION_IDENTITY_FIELDS) {
    const value = position[field];
    if (value !== null && value !== undefined && value !== "" && !validPositionIdentity(value)) return false;
  }
  return POSITION_NUMERIC_FIELDS.every((field) => safePositionScalar(position[field]));
}

function arrayValues(value) {
  try {
    if (!Array.isArray(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_COLLECTION_LENGTH) return null;
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== length + 1 || keys.some((key) => (
      key !== "length"
      && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length)
    ))) return null;
    const values = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return null;
      values[index] = descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

function installRecord(source, root, field) {
  const read = ownDataRead(root, field);
  if (read.kind !== "value") return;
  const snapshot = recordSnapshot(read.value);
  if (snapshot) source[field] = snapshot;
}

function installRecordCollection(source, root, field, { requireEveryRecord = false } = {}) {
  const read = ownDataRead(root, field);
  if (read.kind === "missing") return availability("absent");
  if (read.kind !== "value") return availability("invalid");
  const values = arrayValues(read.value);
  if (!values) return availability("invalid");
  const records = values.map(recordSnapshot);
  if (requireEveryRecord && records.some((record) => record === null)) return availability("invalid");
  const valid = records.filter(Boolean);
  if (values.length > 0 && valid.length === 0) return availability("invalid");
  source[field] = valid;
  return availability("loaded", valid.length);
}

function installWatchlist(source, root) {
  const read = ownDataRead(root, "watchlist");
  if (read.kind === "missing") return availability("absent");
  if (read.kind !== "value") return availability("invalid");
  const values = arrayValues(read.value);
  if (!values) return availability("invalid");
  const valid = [...new Set(values.filter(validPositionIdentity))];
  if (values.length > 0 && valid.length === 0) return availability("invalid");
  source.watchlist = valid;
  return availability("loaded", valid.length);
}

function boundedText(value, maxLength = 2_000) {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : null;
}

function reconciliationDifference(value) {
  const difference = recordSnapshot(value);
  if (!difference) return null;
  for (const [field, limit] of [["type", 240], ["severity", 120], ["message", 2_000]]) {
    if (Object.hasOwn(difference, field) && difference[field] !== null && difference[field] !== undefined && !boundedText(difference[field], limit)) return null;
  }
  const type = boundedText(difference.type, 240);
  const severity = boundedText(difference.severity, 120);
  const message = boundedText(difference.message, 2_000);
  if (!type && !severity && !message) return null;
  return { type, severity, message };
}

function reconciliationProjection(source, collection) {
  if (collection.state !== "loaded") return { state: collection.state, loaded: false, latest: null };
  const reports = source.reconciliationReports;
  if (!reports.length) return { state: "loaded", loaded: true, latest: null };
  const rows = reports.flatMap((report, index) => {
    const createdAt = boundedText(report.createdAt, 240);
    const timestamp = createdAt ? Date.parse(createdAt) : Number.NaN;
    return Number.isFinite(timestamp) ? [{ report, index, timestamp }] : [];
  }).sort((a, b) => b.timestamp - a.timestamp || a.index - b.index);
  const report = rows[0]?.report;
  if (!report) return { state: "invalid", loaded: false, latest: null };
  const rawDifferences = arrayValues(report.differences);
  const differences = rawDifferences ? rawDifferences.map(reconciliationDifference).filter(Boolean) : [];
  return {
    state: "loaded",
    loaded: true,
    latest: {
      id: boundedText(report.id, 240),
      status: boundedText(report.status, 240),
      severity: boundedText(report.severity, 120),
      createdAt: boundedText(report.createdAt, 240),
      differenceCount: rawDifferences ? differences.length : null,
      differences
    }
  };
}

function uniqueIdentityRows(rows, identity) {
  const candidates = rows.flatMap((row) => {
    const id = identity(row);
    return id ? [{ id, row }] : [];
  });
  const counts = new Map();
  for (const { id } of candidates) counts.set(id, (counts.get(id) || 0) + 1);
  return candidates.filter(({ id }) => counts.get(id) === 1);
}

function projectedAvailability(collection, count) {
  if (collection.state !== "loaded") return collection;
  if (collection.count === 0) return availability("loaded", 0);
  return count > 0 ? availability("loaded", count) : availability("invalid");
}

function accountProjection(source) {
  const snapshots = source.accountSnapshots || [];
  return uniqueIdentityRows(source.exchangeAccounts || [], (row) => validPositionIdentity(row.id) ? row.id : null).map(({ id, row }) => {
    const latestSnapshot = snapshots
      .flatMap((snapshot, index) => {
        if (snapshot.accountId !== id || !boundedText(snapshot.createdAt, 240)) return [];
        const timestamp = Date.parse(snapshot.createdAt);
        return Number.isFinite(timestamp) ? [{ snapshot, index, timestamp }] : [];
      })
      .sort((a, b) => b.timestamp - a.timestamp || a.index - b.index)[0]?.snapshot || null;
    return {
      id,
      label: boundedText(row.label, 240) || boundedText(row.exchange, 120) || id,
      exchange: boundedText(row.exchange, 120),
      status: boundedText(row.status, 120),
      source: boundedText(row.source, 240) || boundedText(row.exchange, 120),
      asOf: latestSnapshot?.createdAt || boundedText(row.updatedAt, 240) || boundedText(row.createdAt, 240),
      snapshotId: boundedText(latestSnapshot?.id, 240)
    };
  });
}

function positionSource(root) {
  const read = ownDataRead(root, "positions");
  if (read.kind === "missing") return { available: false, loaded: false, state: "absent", positions: [] };
  if (read.kind !== "value") return { available: false, loaded: false, state: "invalid", positions: [] };
  const values = arrayValues(read.value);
  if (!values) return { available: false, loaded: false, state: "invalid", positions: [] };

  const candidates = [];
  for (const value of values) {
    const position = recordSnapshot(value);
    if (!position || !safePositionRecord(position)) continue;
    const id = canonicalPositionIdentity(position);
    if (!validPositionIdentity(id)) continue;
    candidates.push({ id, position });
  }
  const counts = new Map();
  for (const { id } of candidates) counts.set(id, (counts.get(id) || 0) + 1);
  const positions = candidates
    .filter(({ id }) => counts.get(id) === 1)
    .map(({ position }) => position);
  return {
    available: values.length === 0 || positions.length > 0,
    loaded: true,
    state: values.length > 0 && positions.length === 0 ? "invalid" : "loaded",
    positions
  };
}

function selectorSource(data) {
  const root = plainRecord(data) ? data : null;
  const source = Object.create(null);
  if (!root) return {
    source,
    positionFactsAvailable: false,
    availability: {
      markets: availability("invalid"), watchlist: availability("invalid"), accounts: availability("invalid"),
      accountSnapshots: availability("invalid"), reconciliation: availability("invalid"),
      positions: availability("invalid"), riskIncidents: availability("invalid")
    }
  };

  for (const field of ["portfolio", "performance", "executionOrderStatus", "tradeDataStatus"]) {
    installRecord(source, root, field);
  }
  const collectionAvailability = Object.create(null);
  for (const field of ["markets", "orders", "executionOrders", "fills", "reviews", "tradePlans", "reconciliationReports", "exchangeAccounts", "accountSnapshots", "riskIncidents"]) {
    collectionAvailability[field] = installRecordCollection(source, root, field);
  }
  installRecordCollection(source, root, "closedTradeLifecycles", { requireEveryRecord: true });
  collectionAvailability.watchlist = installWatchlist(source, root);

  const positions = positionSource(root);
  if (positions.loaded) source.positions = positions.positions;
  return {
    source,
    positionFactsAvailable: positions.available,
    availability: {
      markets: collectionAvailability.markets,
      watchlist: collectionAvailability.watchlist,
      accounts: collectionAvailability.exchangeAccounts,
      accountSnapshots: collectionAvailability.accountSnapshots,
      reconciliation: collectionAvailability.reconciliationReports,
      positions: availability(positions.state, positions.state === "loaded" ? positions.positions.length : null),
      riskIncidents: collectionAvailability.riskIncidents
    }
  };
}

function positionNotional(position = {}) {
  const direct = firstKnown(position.notional, position.notionalUsdt, position.marketValue);
  if (direct !== undefined) {
    const value = finitePositionFinancial(direct);
    return value === null ? null : Math.abs(value);
  }
  const quantity = finitePositionFinancial(firstKnown(position.quantity, position.size, position.pos, position.qty));
  const mark = finitePositionFinancial(firstKnown(position.markPrice, position.mark, position.price, position.entryPrice, position.entry));
  if (quantity === null || mark === null) return null;
  return finiteFinancial(Math.abs(quantity * mark));
}

function aggregatePositionFact(available, positions, project) {
  if (!available) return null;
  let total = 0;
  for (const position of positions) {
    const value = project(position);
    if (value === null) return null;
    total += value;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function executionPerformance(data, execution) {
  const supplied = data.performance || Object.create(null);
  const lifecycleLoaded = execution.lifecycleState === "loaded";
  const fact = (field) => Object.hasOwn(supplied, field)
    ? finiteFinancial(supplied[field])
    : lifecycleLoaded
      ? finiteFinancial(execution.performance[field])
      : null;
  return {
    ...execution.performance,
    trades: fact("trades"),
    totalPnlUsdt: fact("totalPnlUsdt"),
    winRatePct: fact("winRatePct"),
    avgPnlUsdt: fact("avgPnlUsdt")
  };
}

function executionTotals(data) {
  return {
    orders: finiteCount(data.executionOrderStatus?.total),
    fills: finiteCount(data.tradeDataStatus?.fillTotal),
    reviews: finiteCount(data.tradeDataStatus?.tradeReviewTotal)
  };
}

function boundedTimestamp(value) {
  const text = boundedText(value, 240);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function numericField(record, ...fields) {
  for (const field of fields) {
    if (!Object.hasOwn(record, field) || record[field] === null || record[field] === undefined || record[field] === "") continue;
    return finitePositionFinancial(record[field]);
  }
  return null;
}

function textField(record, fields, limit = 240) {
  for (const field of fields) {
    const value = boundedText(record?.[field], limit);
    if (value) return value;
  }
  return null;
}

function numericList(value) {
  const values = arrayValues(value);
  if (!values) return [];
  return values.flatMap((item) => {
    const number = finitePositionFinancial(item);
    return number === null ? [] : [number];
  }).slice(0, 12);
}

function projectedExecutionOrder(order) {
  const id = textField(order, ["id", "orderId"]);
  if (!validPositionIdentity(id)) return null;
  return {
    id,
    symbol: textField(order, ["symbol", "instId"]),
    direction: textField(order, ["direction", "side"]),
    status: textField(order, ["status", "state"]),
    exchange: textField(order, ["exchange"]),
    accountId: textField(order, ["accountId", "exchangeAccountId"]),
    positionId: textField(order, ["positionId"]),
    planId: textField(order, ["planId", "tradePlanId"]),
    agentRunId: textField(order, ["agentRunId", "runId"]),
    stopClientOrderId: textField(order, ["stopClientOrderId"]),
    quantity: numericField(order, "quantity", "size"),
    filledQuantity: numericField(order, "filledQuantity"),
    createdAt: boundedTimestamp(order.createdAt),
    updatedAt: boundedTimestamp(order.updatedAt),
    exitAction: order.exitAction && typeof order.exitAction === "object"
      ? {
        intent: textField(order.exitAction, ["intent"]),
        expectedStatus: textField(order.exitAction, ["expectedStatus"]),
        label: textField(order.exitAction, ["label"], 500),
        confirm: order.exitAction.confirm === true
      }
      : null
  };
}

function safeExecutionRows(orders) {
  return uniqueIdentityRows(orders.map(projectedExecutionOrder).filter(Boolean), (order) => order.id).map(({ row }) => row);
}

function relatedExecutionFor(position, executionRows) {
  const explicitExecutionId = textField(position, ["executionOrderId"]);
  if (explicitExecutionId) {
    const matches = executionRows.filter((order) => order.id === explicitExecutionId);
    return matches.length === 1 ? matches[0] : null;
  }
  const positionId = canonicalPositionIdentity(position);
  const matches = executionRows.filter((order) => order.positionId === positionId);
  return matches.length === 1 ? matches[0] : null;
}

function projectedSnapshot(snapshot) {
  const id = textField(snapshot, ["id"]);
  const createdAt = boundedTimestamp(snapshot.createdAt);
  if (!validPositionIdentity(id) || !createdAt) return null;
  const rawAlgoOrders = arrayValues(snapshot.algoOrders);
  const projectedAlgoOrders = rawAlgoOrders
    ? rawAlgoOrders.map((value) => {
      const row = recordSnapshot(value);
      if (!row) return null;
      const algoClOrdId = textField(row, ["algoClOrdId"]);
      const instId = textField(row, ["instId"]);
      const stopPrice = numericField(row, "slTriggerPx");
      return algoClOrdId && instId && stopPrice !== null && stopPrice > 0
        ? { algoClOrdId, instId, stopPrice }
        : null;
    })
    : [];
  const algoOrders = projectedAlgoOrders.filter(Boolean);
  return {
    id,
    accountId: textField(snapshot, ["accountId"]),
    exchange: textField(snapshot, ["exchange"]),
    status: textField(snapshot, ["status"]),
    createdAt,
    algoOrdersComplete: snapshot.algoOrdersComplete === true,
    algoOrdersValid: rawAlgoOrders !== null,
    invalidAlgoOrderCount: projectedAlgoOrders.length - algoOrders.length,
    algoOrders
  };
}

function latestProtectionSnapshot(source, position, execution) {
  const snapshots = uniqueIdentityRows(
    (source.accountSnapshots || []).map(projectedSnapshot).filter(Boolean),
    (snapshot) => snapshot.id
  ).map(({ row }) => row);
  const accountId = execution?.accountId || textField(position, ["accountId", "exchangeAccountId"]);
  const exchange = execution?.exchange || textField(position, ["exchange"]);
  const eligible = snapshots.filter((snapshot) => (
    (!accountId || snapshot.accountId === accountId)
    && (!exchange || snapshot.exchange === exchange)
    && (accountId || exchange)
  ));
  if (!accountId) {
    const accountIds = new Set(eligible.map((snapshot) => snapshot.accountId).filter(Boolean));
    if (accountIds.size !== 1) return null;
  }
  return eligible.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
}

function expectedInstrument(position) {
  const raw = textField(position, ["instId", "symbol"]);
  if (!raw) return null;
  const normalized = raw.replace("/", "-").toUpperCase();
  return normalized.endsWith("-SWAP") ? normalized : `${normalized}-SWAP`;
}

function positionOwnership(position) {
  const source = String(textField(position, ["source"]) || "").toLowerCase();
  if (source === "execution_engine") return "ai_managed";
  if (["exchange_rest", "exchange_ws", "manual", "external"].includes(source)) return "manual_external";
  return "unavailable";
}

function protectionProjection(source, position, execution, ownership) {
  const stopLoss = numericField(position, "stopLoss", "stopLossPrice");
  if (ownership !== "ai_managed") return { state: "unavailable", reason: "ownership_not_managed", stopPrice: stopLoss, snapshotId: null, asOf: null, source: null };
  if (stopLoss === null) return { state: "failed", reason: "local_stop_missing", stopPrice: null, snapshotId: null, asOf: null, source: textField(position, ["source"]) };
  if (!execution) return { state: "unavailable", reason: "execution_link_unavailable", stopPrice: stopLoss, snapshotId: null, asOf: null, source: textField(position, ["source"]) };
  if (!execution.stopClientOrderId) return { state: "failed", reason: "stop_identity_missing", stopPrice: stopLoss, snapshotId: null, asOf: null, source: execution.exchange };
  const snapshot = latestProtectionSnapshot(source, position, execution);
  if (!snapshot) return { state: "unavailable", reason: "account_snapshot_unavailable", stopPrice: stopLoss, snapshotId: null, asOf: null, source: execution.exchange };
  if (!/^(?:ok|healthy|success)$/iu.test(snapshot.status || "")) return { state: "degraded", reason: "account_snapshot_degraded", stopPrice: stopLoss, snapshotId: snapshot.id, asOf: snapshot.createdAt, source: snapshot.exchange };
  const openedAt = boundedTimestamp(position.openedAt);
  const mirrorAt = boundedTimestamp(position.rawSyncedAt);
  const snapshotAfterOpen = openedAt && Date.parse(snapshot.createdAt) >= Date.parse(openedAt);
  const snapshotOwnsMirror = mirrorAt && mirrorAt === snapshot.createdAt;
  if (!snapshotAfterOpen || !snapshotOwnsMirror || !snapshot.algoOrdersComplete || !snapshot.algoOrdersValid) {
    return { state: "degraded", reason: "exchange_stop_snapshot_unverified", stopPrice: stopLoss, snapshotId: snapshot.id, asOf: snapshot.createdAt, source: snapshot.exchange };
  }
  const instId = expectedInstrument(position);
  const remote = snapshot.algoOrders.filter((order) => order.algoClOrdId === execution.stopClientOrderId && order.instId.toUpperCase() === instId);
  return remote.length === 1
    ? { state: "verified", reason: null, stopPrice: remote[0].stopPrice, snapshotId: snapshot.id, asOf: snapshot.createdAt, source: snapshot.exchange }
    : remote.length > 1 || snapshot.invalidAlgoOrderCount > 0
      ? { state: "degraded", reason: "exchange_stop_snapshot_unverified", stopPrice: stopLoss, snapshotId: snapshot.id, asOf: snapshot.createdAt, source: snapshot.exchange }
    : { state: "failed", reason: "exchange_stop_missing", stopPrice: stopLoss, snapshotId: snapshot.id, asOf: snapshot.createdAt, source: snapshot.exchange };
}

function projectedRiskIncident(incident) {
  const id = textField(incident, ["id"]);
  const createdAt = boundedTimestamp(incident.createdAt);
  if (!validPositionIdentity(id) || !createdAt) return null;
  return {
    id,
    positionId: textField(incident, ["positionId"]),
    executionOrderId: textField(incident, ["executionOrderId"]),
    status: textField(incident, ["status"]),
    severity: textField(incident, ["severity"]),
    title: textField(incident, ["title"], 2_000),
    source: textField(incident, ["source"], 500),
    createdAt
  };
}

function riskIncidentProjection(source) {
  return uniqueIdentityRows((source.riskIncidents || []).map(projectedRiskIncident).filter(Boolean), (incident) => incident.id).map(({ row }) => row);
}

function positionProjection(source, position, executionRows, incidents) {
  const id = canonicalPositionIdentity(position);
  const relatedExecution = relatedExecutionFor(position, executionRows);
  const ownership = positionOwnership(position);
  const linkedIncidents = incidents.filter((incident) => (
    incident.positionId === id || (relatedExecution && incident.executionOrderId === relatedExecution.id)
  ));
  const takeProfits = numericList(position.takeProfits);
  return {
    id,
    positionId: textField(position, ["positionId"]),
    instId: textField(position, ["instId"]),
    symbol: textField(position, ["symbol", "instId"]),
    direction: textField(position, ["direction", "posSide", "side"]),
    source: textField(position, ["source"]),
    ownership,
    quantity: numericField(position, "quantity", "size", "pos", "qty"),
    entry: numericField(position, "entry", "entryPrice"),
    mark: numericField(position, "mark", "markPrice", "price"),
    liquidationPrice: numericField(position, "liquidationPrice", "liqPx"),
    unrealizedPnl: numericField(position, "unrealizedPnl", "pnl", "upl"),
    notional: positionNotional(position),
    margin: numericField(position, "margin", "initialMargin"),
    leverage: numericField(position, "leverage"),
    liqDistancePct: numericField(position, "liqDistancePct"),
    stopLoss: numericField(position, "stopLoss", "stopLossPrice"),
    takeProfits: takeProfits.length ? takeProfits : numericList(position.takeProfit === undefined ? undefined : [position.takeProfit]),
    planId: textField(position, ["planId", "tradePlanId"]),
    agentRunId: textField(position, ["agentRunId", "runId"]),
    strategy: textField(position, ["strategy", "strategyName"], 500),
    openedAt: boundedTimestamp(position.openedAt),
    rawSyncedAt: boundedTimestamp(position.rawSyncedAt),
    observedAt: boundedTimestamp(position.rawSyncedAt) || boundedTimestamp(position.updatedAt) || boundedTimestamp(position.createdAt),
    relatedExecution,
    riskIncidents: linkedIncidents,
    protection: protectionProjection(source, position, relatedExecution, ownership)
  };
}

export function buildAccountDomainModel(data = {}) {
  const { source, positionFactsAvailable, availability: sourceAvailability } = selectorSource(data);
  const portfolio = source.portfolio || Object.create(null);
  const positionView = buildPositionView(source);
  const baseExecution = buildExecutionView(source);
  const execution = {
    ...baseExecution,
    orders: baseExecution.orders.map((order) => ({ ...order, exitAction: executionExitAction(order) })),
    performance: executionPerformance(source, baseExecution),
    totals: executionTotals(source)
  };
  const executionRows = safeExecutionRows(execution.orders);
  const riskIncidents = riskIncidentProjection(source);
  const positions = positionView.positions.map((position) => positionProjection(source, position, executionRows, riskIncidents));
  const markets = uniqueIdentityRows(buildMarketRows(source), (row) => validPositionIdentity(row.symbol) ? row.symbol : null).map(({ row }) => row);
  const accounts = accountProjection(source);
  const modelAvailability = {
    markets: projectedAvailability(sourceAvailability.markets, markets.length),
    watchlist: sourceAvailability.watchlist,
    accounts: projectedAvailability(sourceAvailability.accounts, accounts.length),
    positions: projectedAvailability(sourceAvailability.positions, positions.length),
    riskIncidents: projectedAvailability(sourceAvailability.riskIncidents, riskIncidents.length)
  };

  return {
    truth: {
      equity: finiteFinancial(portfolio.totalEquityUsdt),
      available: finiteFinancial(portfolio.availableMarginUsdt),
      exposure: aggregatePositionFact(positionFactsAvailable, positionView.positions, positionNotional),
      unrealizedPnl: aggregatePositionFact(positionFactsAvailable, positionView.positions, (position) => (
        finitePositionFinancial(firstKnown(position.unrealizedPnl, position.pnl, position.upl))
      )),
      margin: aggregatePositionFact(positionFactsAvailable, positionView.positions, (position) => (
        finitePositionFinancial(firstKnown(position.margin, position.initialMargin))
      ))
    },
    availability: modelAvailability,
    accounts,
    markets,
    watchlist: (source.watchlist || []).slice(),
    reconciliation: reconciliationProjection(source, sourceAvailability.reconciliation),
    positions,
    riskIncidents,
    openOrders: positionView.openOrders.slice(),
    plans: (source.tradePlans || []).slice(),
    execution,
    fills: execution.fills,
    reviews: execution.reviews,
    closedTrades: execution.closedTrades
  };
}
