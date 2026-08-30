import { executionExitAction } from "../../../executionExit.js";
import { canonicalPositionIdentity } from "../../../productShell.jsx";
import { buildExecutionView, buildMarketRows, buildPositionView } from "../../../viewData.js";

const MAX_COLLECTION_LENGTH = 10_000;
const missingRead = Object.freeze({ kind: "missing" });
const invalidRead = Object.freeze({ kind: "invalid" });
const finiteFinancial = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const finitePositionFinancial = (value) => typeof value === "string"
  ? value !== "" && value === value.trim() ? finiteFinancial(Number(value)) : null
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
  if (typeof value !== "string") return false;
  if (value.trim() === "") return true;
  return value === value.trim() && finitePositionFinancial(value) !== null;
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
  if (read.value === undefined) return availability("absent");
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
  if (read.value === undefined) return availability("absent");
  const values = arrayValues(read.value);
  if (!values) return availability("invalid");
  const valid = [...new Set(values.filter(validPositionIdentity))];
  if (values.length > 0 && valid.length === 0) return availability("invalid");
  source.watchlist = valid;
  return availability("loaded", valid.length);
}

function boundedText(value, maxLength = 2_000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength ? value : null;
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
      positions: availability("invalid"), riskIncidents: availability("invalid"),
      plans: availability("invalid"), exchangeOrders: availability("invalid"),
      executionOrders: availability("invalid"), fills: availability("invalid"),
      reviews: availability("invalid"), closedTrades: availability("invalid")
    }
  };

  for (const field of ["portfolio", "performance", "executionOrderStatus", "tradeDataStatus"]) {
    installRecord(source, root, field);
  }
  const collectionAvailability = Object.create(null);
  for (const field of ["markets", "orders", "executionOrders", "fills", "reviews", "tradePlans", "reconciliationReports", "exchangeAccounts", "accountSnapshots", "riskIncidents"]) {
    collectionAvailability[field] = installRecordCollection(source, root, field);
  }
  collectionAvailability.closedTradeLifecycles = installRecordCollection(source, root, "closedTradeLifecycles");
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
      riskIncidents: collectionAvailability.riskIncidents,
      plans: collectionAvailability.tradePlans,
      exchangeOrders: collectionAvailability.orders,
      executionOrders: collectionAvailability.executionOrders,
      fills: collectionAvailability.fills,
      reviews: collectionAvailability.reviews,
      closedTrades: collectionAvailability.closedTradeLifecycles
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

function bindingIdentity(record, fields, { uppercase = false } = {}) {
  const values = new Set();
  for (const field of fields) {
    const read = ownDataRead(record, field);
    if (read.kind === "missing") continue;
    if (read.kind !== "value") return { state: "invalid", value: null };
    const raw = read.value;
    if (raw === null || raw === undefined || raw === "") continue;
    if (!validPositionIdentity(raw)) return { state: "invalid", value: null };
    values.add(uppercase ? raw.toUpperCase() : raw);
  }
  if (values.size === 0) return { state: "unbound", value: null };
  if (values.size !== 1) return { state: "invalid", value: null };
  return { state: "valid", value: values.values().next().value };
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
  const accountBinding = bindingIdentity(order, ["accountId", "exchangeAccountId", "connectionAccountId"]);
  const exchangeBinding = bindingIdentity(order, ["exchange"], { uppercase: true });
  return {
    id,
    symbol: textField(order, ["symbol", "instId"]),
    direction: textField(order, ["direction", "side"]),
    status: textField(order, ["status", "state"]),
    exchange: exchangeBinding.state === "valid" ? exchangeBinding.value : null,
    accountId: accountBinding.state === "valid" ? accountBinding.value : null,
    accountBindingState: accountBinding.state,
    exchangeBindingState: exchangeBinding.state,
    positionId: textField(order, ["positionId"]),
    planId: textField(order, ["planId", "tradePlanId"]),
    agentRunId: textField(order, ["agentRunId", "runId"]),
    source: textField(order, ["source"], 500),
    side: textField(order, ["side", "direction"]),
    orderType: textField(order, ["orderType", "type"]),
    price: numericField(order, "price"),
    entryPrice: numericField(order, "entryPrice"),
    stopLoss: numericField(order, "stopLoss", "stopLossPrice"),
    stopClientOrderId: textField(order, ["stopClientOrderId"]),
    quantity: numericField(order, "quantity", "size"),
    filledQuantity: numericField(order, "filledQuantity"),
    remainingQuantity: numericField(order, "remainingQuantity", "remaining"),
    reduceOnly: typeof order.reduceOnly === "boolean" ? order.reduceOnly : null,
    clientOrderId: textField(order, ["clientOrderId", "clOrdId"]),
    exchangeOrderId: textField(order, ["exchangeOrderId", "ordId", "orderId"]),
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
  return uniqueIdentityRows(orders.map(projectedExecutionOrder).filter(Boolean), (order) => order.id)
    .map(({ row }) => ({ ...row, exitAction: executionExitAction(row) }));
}

function tradePlanAccountImpact(row, source, positions, positionFactsAvailable, riskPercent) {
  const explicit = recordSnapshot(row.accountImpact) || Object.create(null);
  const portfolio = source?.portfolio || Object.create(null);
  const equityUsdt = numericField(explicit, "equityUsdt")
    ?? numericField(portfolio, "totalEquityUsdt", "equityUsdt");
  const availableMarginUsdt = numericField(explicit, "availableMarginUsdt")
    ?? numericField(portfolio, "availableMarginUsdt", "availableMargin");
  const openPositionCount = numericField(explicit, "openPositionCount")
    ?? (positionFactsAvailable ? finiteCount(positions.length) : null);
  const projectedOpenPositionCount = numericField(explicit, "projectedOpenPositionCount")
    ?? (openPositionCount === null ? null : openPositionCount + 1);
  const estimatedMaxLossUsdt = numericField(explicit, "estimatedMaxLossUsdt")
    ?? (equityUsdt !== null && riskPercent !== null ? Number((equityUsdt * riskPercent / 100).toFixed(2)) : null);
  return {
    equityUsdt,
    availableMarginUsdt,
    openPositionCount,
    projectedOpenPositionCount,
    estimatedMaxLossUsdt
  };
}

function projectedTradePlan(row, source, positions, positionFactsAvailable) {
  const id = textField(row, ["id"]);
  if (!validPositionIdentity(id)) return null;
  const entryRange = numericList(row.entry_range).slice(0, 4);
  const entryRecord = recordSnapshot(row.entry);
  const takeProfits = numericList(row.takeProfit).length
    ? numericList(row.takeProfit)
    : numericList(row.take_profit);
  const riskRecord = recordSnapshot(row.lastRiskCheck);
  const riskPercent = numericField(row, "max_loss_pct", "riskPercent")
    ?? numericField(entryRecord || Object.create(null), "riskPercent");
  const evidenceIds = [
    ...numericOrIdentityList(row.evidenceIds),
    ...numericOrIdentityList(row.knowledgeSkillIds),
    textField(row, ["analysisBundleId"]),
    textField(riskRecord || Object.create(null), ["id"])
  ].filter(Boolean);
  const status = textField(row, ["status", "state"]);
  const symbol = textField(row, ["symbol", "instId"]);
  const direction = textField(row, ["direction", "side"]);
  const stopLoss = numericField(row, "stopLoss", "stop_loss");
  const leverage = numericField(row, "leverage");
  const entry = textField(entryRecord || Object.create(null), ["range"], 500)
    || (entryRange.length >= 2 ? entryRange.join("–") : null);
  const riskPassed = riskRecord?.passed === true;
  const riskSummary = textField(riskRecord || Object.create(null), ["summary", "reason"], 2_000);
  const accountImpact = tradePlanAccountImpact(row, source, positions, positionFactsAvailable, riskPercent);
  const missingFacts = [];
  if (status !== "awaiting_approval") missingFacts.push("status");
  if (!symbol) missingFacts.push("symbol");
  if (!/^(?:long|short)$/iu.test(direction || "")) missingFacts.push("direction");
  if (!entry) missingFacts.push("entry");
  if (stopLoss === null) missingFacts.push("stopLoss");
  if (!takeProfits.length) missingFacts.push("takeProfit");
  if (leverage === null) missingFacts.push("leverage");
  if (riskPercent === null) missingFacts.push("riskPercent");
  if (!riskPassed || !riskSummary) missingFacts.push("riskResult");
  if (!evidenceIds.length) missingFacts.push("evidence");
  if (Object.values(accountImpact).some((value) => value === null)) missingFacts.push("accountImpact");
  return {
    id,
    status,
    symbol,
    direction,
    strategy: textField(row, ["strategy", "strategyName"], 500),
    missionId: textField(row, ["agentRunId", "runId", "missionId"]),
    executionOrderId: textField(row, ["executionOrderId"]),
    createdAt: boundedTimestamp(row.createdAt),
    expiresAt: boundedTimestamp(row.expiresAt),
    entry,
    stopLoss,
    takeProfits,
    quantity: numericField(row, "quantity", "size"),
    leverage,
    riskPercent,
    risk: {
      id: textField(riskRecord || Object.create(null), ["id"]),
      passed: riskPassed,
      summary: riskSummary,
      warnings: textList(riskRecord?.warnings, 6),
      blockers: textList(riskRecord?.blockers, 6)
    },
    evidenceIds: [...new Set(evidenceIds)].slice(0, 24),
    accountImpact,
    approval: {
      planId: id,
      status,
      valid: missingFacts.length === 0,
      missingFacts
    }
  };
}

function numericOrIdentityList(value) {
  const values = arrayValues(value);
  if (!values) return [];
  return values.flatMap((item) => validPositionIdentity(item) ? [item] : []).slice(0, 32);
}

function textList(value, limit = 12) {
  const values = arrayValues(value);
  if (!values) return [];
  return values.flatMap((item) => boundedText(item, 2_000) ? [item] : []).slice(0, limit);
}

function projectedExchangeOrder(row) {
  const id = textField(row, ["id", "orderId"]);
  if (!validPositionIdentity(id)) return null;
  const status = textField(row, ["status", "state"]);
  const accepted = /^(?:submitted|accepted|open|working|partially_filled|live)$/iu.test(status || "");
  const filled = /^(?:filled|closed)$/iu.test(status || "");
  return {
    id,
    orderId: textField(row, ["orderId"]),
    executionOrderId: textField(row, ["executionOrderId"]),
    planId: textField(row, ["planId", "tradePlanId"]),
    symbol: textField(row, ["symbol", "instId"]),
    side: textField(row, ["side", "direction"]),
    orderType: textField(row, ["orderType", "type"]),
    status,
    source: textField(row, ["source"], 500),
    exchange: textField(row, ["exchange"], 120),
    accountId: textField(row, ["accountId", "exchangeAccountId"]),
    quantity: numericField(row, "quantity", "size"),
    filledQuantity: numericField(row, "filledQuantity", "accFillSz"),
    remainingQuantity: numericField(row, "remainingQuantity", "remaining"),
    price: numericField(row, "price"),
    averageFillPrice: numericField(row, "avgFillPrice", "averageFillPrice"),
    reduceOnly: typeof row.reduceOnly === "boolean" ? row.reduceOnly : null,
    clientOrderId: textField(row, ["clientOrderId", "clOrdId"]),
    exchangeOrderId: textField(row, ["exchangeOrderId", "ordId", "orderId"]),
    createdAt: boundedTimestamp(row.createdAt),
    updatedAt: boundedTimestamp(row.updatedAt),
    finality: accepted ? "exchange_accepted" : filled ? "exchange_filled" : "exchange_status_only"
  };
}

function projectedFill(row) {
  const id = textField(row, ["id", "tradeId"]);
  if (!validPositionIdentity(id)) return null;
  return {
    id,
    tradeId: textField(row, ["tradeId", "exchangeTradeId"]),
    executionOrderId: textField(row, ["executionOrderId"]),
    orderId: textField(row, ["orderId"]),
    planId: textField(row, ["tradePlanId", "planId"]),
    tradeLifecycleKey: textField(row, ["tradeLifecycleKey"]),
    kind: textField(row, ["kind"]),
    partial: typeof row.partial === "boolean" ? row.partial : null,
    symbol: textField(row, ["symbol", "instId"]),
    direction: textField(row, ["direction", "side"]),
    quantity: numericField(row, "quantity", "size"),
    price: numericField(row, "price"),
    feeUsdt: numericField(row, "feeUsdt", "feeCostUsdt", "fee"),
    grossRealizedPnl: numericField(row, "realizedPnl", "grossRealizedPnl"),
    fundingFeeUsdt: numericField(row, "fundingFeeUsdt"),
    source: textField(row, ["source"], 500),
    createdAt: boundedTimestamp(row.createdAt),
    finality: "exchange_fill_recorded"
  };
}

function projectedReview(row) {
  if (textField(row, ["type"]) !== "trade") return null;
  const id = textField(row, ["id"]);
  if (!validPositionIdentity(id)) return null;
  return {
    id,
    type: "trade",
    status: textField(row, ["status", "state"]),
    title: textField(row, ["title"], 1_000),
    symbol: textField(row, ["symbol", "instId"]),
    executionOrderId: textField(row, ["executionOrderId"]),
    planId: textField(row, ["tradePlanId", "planId"]),
    tradeLifecycleKey: textField(row, ["tradeLifecycleKey"]),
    fillIds: numericOrIdentityList(row.fillIds),
    netRealizedPnl: numericField(row, "netRealizedPnl"),
    summary: textField(row, ["summary", "lesson"], 4_000),
    createdAt: boundedTimestamp(row.createdAt),
    completedAt: boundedTimestamp(row.completedAt),
    updatedAt: boundedTimestamp(row.updatedAt)
  };
}

function projectedClosedTrade(row) {
  const id = textField(row, ["id"]);
  if (!validPositionIdentity(id)) return null;
  const financialBasisComplete = row.financialBasisComplete === true;
  const netRealizedPnl = numericField(row, "netRealizedPnl");
  return {
    id,
    executionOrderId: textField(row, ["executionOrderId"]),
    planId: textField(row, ["tradePlanId", "planId"]),
    tradeLifecycleKey: textField(row, ["tradeLifecycleKey"]),
    fillIds: numericOrIdentityList(row.fillIds),
    symbol: textField(row, ["symbol", "instId"]),
    direction: textField(row, ["direction", "side"]),
    quantity: numericField(row, "quantity", "size"),
    entryPrice: numericField(row, "entryPrice", "entry"),
    exitPrice: numericField(row, "exitPrice", "price"),
    grossRealizedPnl: numericField(row, "realizedPnl", "grossRealizedPnl"),
    entryFeeUsdt: numericField(row, "entryFeeUsdt"),
    closeFeeUsdt: numericField(row, "feeUsdt", "closeFeeUsdt"),
    fundingFeeUsdt: numericField(row, "fundingFeeUsdt"),
    netRealizedPnl,
    notionalUsdt: numericField(row, "notionalUsdt"),
    closeCount: numericField(row, "closeCount"),
    financialBasisComplete,
    financialBasis: textField(row, ["financialBasis"], 1_000),
    createdAt: boundedTimestamp(row.createdAt),
    finality: financialBasisComplete && netRealizedPnl !== null ? "finance_reconciled" : "finance_unreconciled"
  };
}

function explicitLifecycleMatch(left, right) {
  let matched = false;
  const compare = (leftValue, rightValue) => {
    if (!leftValue || !rightValue) return true;
    if (leftValue !== rightValue) return false;
    matched = true;
    return true;
  };
  if (!compare(left.tradeLifecycleKey, right.tradeLifecycleKey)) return false;
  if (!compare(left.executionOrderId, right.executionOrderId)) return false;
  const leftFillIds = Array.isArray(left.fillIds) ? left.fillIds : [];
  const rightFillIds = Array.isArray(right.fillIds) ? right.fillIds : [];
  if (left.kind && left.id && rightFillIds.length) {
    if (!rightFillIds.includes(left.id)) return false;
    matched = true;
  }
  if (right.kind && right.id && leftFillIds.length) {
    if (!leftFillIds.includes(right.id)) return false;
    matched = true;
  }
  if (leftFillIds.length && rightFillIds.length) {
    if (!leftFillIds.some((id) => rightFillIds.includes(id))) return false;
    matched = true;
  }
  return matched;
}

function uniqueRelated(source, predicate) {
  const matches = source.filter(predicate);
  return matches.length === 1 ? matches[0] : null;
}

function posterForClosedTrade(trade, executionRows) {
  if (!trade.financialBasisComplete || trade.netRealizedPnl === null) return { state: "finance_unreconciled", executionId: null };
  if (!trade.executionOrderId) return { state: "execution_unavailable", executionId: null };
  const matches = executionRows.filter((row) => row.id === trade.executionOrderId);
  if (matches.length !== 1) return { state: "execution_unavailable", executionId: null };
  if (String(matches[0].status || "").toLowerCase() !== "closed") return { state: "execution_not_closed", executionId: matches[0].id };
  return { state: "eligible", executionId: matches[0].id };
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
  const positionAccount = bindingIdentity(position, ["accountId", "exchangeAccountId", "connectionAccountId"]);
  const positionExchange = bindingIdentity(position, ["exchange"], { uppercase: true });
  const accountId = execution?.accountBindingState === "valid" ? execution.accountId : positionAccount.value;
  const exchange = execution?.exchangeBindingState === "valid" ? execution.exchange : positionExchange.value;
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

function protectionProjection(source, position, execution, ownership, now) {
  const stopLoss = numericField(position, "stopLoss", "stopLossPrice");
  if (ownership !== "ai_managed") return { state: "unavailable", reason: "ownership_not_managed", stopPrice: stopLoss, snapshotId: null, asOf: null, source: null };
  if (stopLoss === null) return { state: "failed", reason: "local_stop_missing", stopPrice: null, snapshotId: null, asOf: null, source: textField(position, ["source"]) };
  if (!execution) return { state: "unavailable", reason: "execution_link_unavailable", stopPrice: stopLoss, snapshotId: null, asOf: null, source: textField(position, ["source"]) };
  if (!execution.stopClientOrderId) return { state: "failed", reason: "stop_identity_missing", stopPrice: stopLoss, snapshotId: null, asOf: null, source: execution.exchange };
  const mirrorAccount = bindingIdentity(position, ["accountId", "exchangeAccountId", "connectionAccountId"]);
  const mirrorExchange = bindingIdentity(position, ["exchange"], { uppercase: true });
  const bindingMatches = mirrorAccount.state === "valid" && execution.accountBindingState === "valid"
    && mirrorAccount.value === execution.accountId
    && mirrorExchange.state === "valid" && execution.exchangeBindingState === "valid"
    && mirrorExchange.value === execution.exchange;
  if (!bindingMatches) return { state: "degraded", reason: "exchange_stop_snapshot_unverified", stopPrice: stopLoss, snapshotId: null, asOf: null, source: execution.exchange };
  const snapshot = latestProtectionSnapshot(source, position, execution);
  if (!snapshot) return { state: "unavailable", reason: "account_snapshot_unavailable", stopPrice: stopLoss, snapshotId: null, asOf: null, source: execution.exchange };
  if (!/^(?:ok|healthy|success)$/iu.test(snapshot.status || "")) return { state: "degraded", reason: "account_snapshot_degraded", stopPrice: stopLoss, snapshotId: snapshot.id, asOf: snapshot.createdAt, source: snapshot.exchange };
  const openedAt = boundedTimestamp(position.openedAt);
  const mirrorAt = boundedTimestamp(position.rawSyncedAt);
  const snapshotAt = Date.parse(snapshot.createdAt);
  const snapshotAfterOpen = openedAt && Date.parse(snapshot.createdAt) >= Date.parse(openedAt);
  const snapshotOwnsMirror = mirrorAt && mirrorAt === snapshot.createdAt;
  const snapshotCurrent = now - snapshotAt <= 2 * 60_000;
  if (!snapshotAfterOpen || !snapshotCurrent || !snapshotOwnsMirror || !snapshot.algoOrdersComplete || !snapshot.algoOrdersValid) {
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

function positionProjection(source, position, executionRows, incidents, now) {
  const id = canonicalPositionIdentity(position);
  const relatedExecution = relatedExecutionFor(position, executionRows);
  const ownership = positionOwnership(position);
  const accountBinding = bindingIdentity(position, ["accountId", "exchangeAccountId", "connectionAccountId"]);
  const exchangeBinding = bindingIdentity(position, ["exchange"], { uppercase: true });
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
    accountId: accountBinding.state === "valid" ? accountBinding.value : null,
    exchange: exchangeBinding.state === "valid" ? exchangeBinding.value : null,
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
    protection: protectionProjection(source, position, relatedExecution, ownership, now)
  };
}

export function buildAccountDomainModel(data = {}, options = {}) {
  const nowRead = ownDataRead(options, "now");
  const now = nowRead.kind === "value" && typeof nowRead.value === "number" && Number.isFinite(nowRead.value)
    ? nowRead.value
    : Date.now();
  const { source, positionFactsAvailable, availability: sourceAvailability } = selectorSource(data);
  const portfolio = source.portfolio || Object.create(null);
  const positionView = buildPositionView(source);
  const plans = uniqueIdentityRows(
    (source.tradePlans || []).map((row) => projectedTradePlan(row, source, positionView.positions, positionFactsAvailable)).filter(Boolean),
    (row) => row.id
  ).map(({ row }) => row);
  const executionRows = safeExecutionRows(source.executionOrders || []);
  const orders = uniqueIdentityRows((source.orders || []).map(projectedExchangeOrder).filter(Boolean), (row) => row.id).map(({ row }) => row);
  const projectedFills = uniqueIdentityRows((source.fills || []).map(projectedFill).filter(Boolean), (row) => row.id).map(({ row }) => row);
  const projectedReviews = uniqueIdentityRows((source.reviews || []).map(projectedReview).filter(Boolean), (row) => row.id).map(({ row }) => row);
  const projectedClosedTrades = uniqueIdentityRows((source.closedTradeLifecycles || []).map(projectedClosedTrade).filter(Boolean), (row) => row.id).map(({ row }) => row);
  const executionSource = {
    ...source,
    executionOrders: executionRows,
    fills: projectedFills,
    reviews: projectedReviews
  };
  if (sourceAvailability.closedTrades.state === "loaded") executionSource.closedTradeLifecycles = projectedClosedTrades;
  const baseExecution = buildExecutionView(executionSource);
  const execution = {
    ...baseExecution,
    orders: baseExecution.orders.map((order) => ({ ...order, exitAction: executionExitAction(order) })),
    performance: executionPerformance(source, baseExecution),
    totals: executionTotals(source)
  };
  const riskIncidents = riskIncidentProjection(source);
  const positions = positionView.positions.map((position) => positionProjection(source, position, executionRows, riskIncidents, now));
  const markets = uniqueIdentityRows(buildMarketRows(source), (row) => validPositionIdentity(row.symbol) ? row.symbol : null).map(({ row }) => row);
  const accounts = accountProjection(source);
  const fills = execution.fills.map((row) => ({
    ...row,
    review: uniqueRelated(projectedReviews, (candidate) => explicitLifecycleMatch(row, candidate)),
    closedTrade: uniqueRelated(projectedClosedTrades, (candidate) => explicitLifecycleMatch(row, candidate))
  }));
  const closedTrades = execution.closedTrades.map((row) => ({
    ...row,
    review: uniqueRelated(projectedReviews, (candidate) => explicitLifecycleMatch(row, candidate)),
    poster: posterForClosedTrade(row, executionRows)
  }));
  const modelAvailability = {
    markets: projectedAvailability(sourceAvailability.markets, markets.length),
    watchlist: sourceAvailability.watchlist,
    accounts: projectedAvailability(sourceAvailability.accounts, accounts.length),
    positions: projectedAvailability(sourceAvailability.positions, positions.length),
    riskIncidents: projectedAvailability(sourceAvailability.riskIncidents, riskIncidents.length),
    plans: projectedAvailability(sourceAvailability.plans, plans.length),
    executionOrders: projectedAvailability(sourceAvailability.executionOrders, executionRows.length),
    orders: projectedAvailability(sourceAvailability.exchangeOrders, orders.length),
    fills: projectedAvailability(sourceAvailability.fills, fills.length),
    reviews: projectedAvailability(sourceAvailability.reviews, projectedReviews.length),
    closedTrades: projectedAvailability(sourceAvailability.closedTrades, closedTrades.length)
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
    plans,
    orders,
    execution,
    fills,
    reviews: projectedReviews,
    closedTrades
  };
}
