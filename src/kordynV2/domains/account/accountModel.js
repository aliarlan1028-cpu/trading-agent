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
  "margin", "initialMargin"
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
  if (read.kind !== "value") return { available: false, loaded: false, positions: [] };
  const values = arrayValues(read.value);
  if (!values) return { available: false, loaded: false, positions: [] };

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
      accountSnapshots: availability("invalid"), reconciliation: availability("invalid")
    }
  };

  for (const field of ["portfolio", "performance", "executionOrderStatus", "tradeDataStatus"]) {
    installRecord(source, root, field);
  }
  const collectionAvailability = Object.create(null);
  for (const field of ["markets", "orders", "executionOrders", "fills", "reviews", "tradePlans", "reconciliationReports", "exchangeAccounts", "accountSnapshots"]) {
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
      reconciliation: collectionAvailability.reconciliationReports
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

export function buildAccountDomainModel(data = {}) {
  const { source, positionFactsAvailable, availability: sourceAvailability } = selectorSource(data);
  const portfolio = source.portfolio || Object.create(null);
  const positionView = buildPositionView(source);
  const positions = positionView.positions.map((position) => ({
    ...position,
    id: canonicalPositionIdentity(position)
  }));
  const baseExecution = buildExecutionView(source);
  const execution = {
    ...baseExecution,
    orders: baseExecution.orders.map((order) => ({ ...order, exitAction: executionExitAction(order) })),
    performance: executionPerformance(source, baseExecution),
    totals: executionTotals(source)
  };
  const markets = uniqueIdentityRows(buildMarketRows(source), (row) => validPositionIdentity(row.symbol) ? row.symbol : null).map(({ row }) => row);
  const accounts = accountProjection(source);
  const modelAvailability = {
    markets: projectedAvailability(sourceAvailability.markets, markets.length),
    watchlist: sourceAvailability.watchlist,
    accounts: projectedAvailability(sourceAvailability.accounts, accounts.length)
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
    openOrders: positionView.openOrders.slice(),
    plans: (source.tradePlans || []).slice(),
    execution,
    fills: execution.fills,
    reviews: execution.reviews,
    closedTrades: execution.closedTrades
  };
}
