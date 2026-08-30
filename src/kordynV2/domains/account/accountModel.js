import { executionExitAction } from "../../../executionExit.js";
import { canonicalPositionIdentity } from "../../../productShell.jsx";
import { buildExecutionView, buildMarketRows, buildPositionView } from "../../../viewData.js";

const MAX_COLLECTION_LENGTH = 10_000;
const missingRead = Object.freeze({ kind: "missing" });
const invalidRead = Object.freeze({ kind: "invalid" });
const finiteFinancial = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const finiteCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const firstKnown = (...values) => values.find((value) => value !== null && value !== undefined);
const validPositionIdentity = (value) => typeof value === "string"
  && value.length > 0
  && value.length <= 240
  && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value);

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
  if (read.kind !== "value") return;
  const values = arrayValues(read.value);
  if (!values) return;
  const records = values.map(recordSnapshot);
  if (requireEveryRecord && records.some((record) => record === null)) return;
  source[field] = records.filter(Boolean);
}

function installWatchlist(source, root) {
  const read = ownDataRead(root, "watchlist");
  if (read.kind !== "value") return;
  const values = arrayValues(read.value);
  if (values) source.watchlist = values.filter((value) => typeof value === "string");
}

function positionSource(root) {
  const read = ownDataRead(root, "positions");
  if (read.kind !== "value") return { available: false, loaded: false, positions: [] };
  const values = arrayValues(read.value);
  if (!values) return { available: false, loaded: false, positions: [] };

  const candidates = [];
  for (const value of values) {
    const position = recordSnapshot(value);
    if (!position) continue;
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
  if (!root) return { source, positionFactsAvailable: false };

  for (const field of ["portfolio", "performance", "executionOrderStatus", "tradeDataStatus"]) {
    installRecord(source, root, field);
  }
  for (const field of ["markets", "orders", "executionOrders", "fills", "reviews", "tradePlans"]) {
    installRecordCollection(source, root, field);
  }
  installRecordCollection(source, root, "closedTradeLifecycles", { requireEveryRecord: true });
  installWatchlist(source, root);

  const positions = positionSource(root);
  if (positions.loaded) source.positions = positions.positions;
  return { source, positionFactsAvailable: positions.available };
}

function positionNotional(position = {}) {
  const direct = firstKnown(position.notional, position.notionalUsdt, position.marketValue);
  if (direct !== undefined) {
    const value = finiteFinancial(direct);
    return value === null ? null : Math.abs(value);
  }
  const quantity = finiteFinancial(firstKnown(position.quantity, position.size, position.pos, position.qty));
  const mark = finiteFinancial(firstKnown(position.markPrice, position.mark, position.price, position.entryPrice, position.entry));
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
  const { source, positionFactsAvailable } = selectorSource(data);
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

  return {
    truth: {
      equity: finiteFinancial(portfolio.totalEquityUsdt),
      available: finiteFinancial(portfolio.availableMarginUsdt),
      exposure: aggregatePositionFact(positionFactsAvailable, positionView.positions, positionNotional),
      unrealizedPnl: aggregatePositionFact(positionFactsAvailable, positionView.positions, (position) => (
        finiteFinancial(firstKnown(position.unrealizedPnl, position.pnl, position.upl))
      )),
      margin: aggregatePositionFact(positionFactsAvailable, positionView.positions, (position) => (
        finiteFinancial(firstKnown(position.margin, position.initialMargin))
      ))
    },
    markets: buildMarketRows(source),
    watchlist: (source.watchlist || []).slice(),
    positions,
    openOrders: positionView.openOrders.slice(),
    plans: (source.tradePlans || []).slice(),
    execution,
    fills: execution.fills,
    reviews: execution.reviews,
    closedTrades: execution.closedTrades
  };
}
