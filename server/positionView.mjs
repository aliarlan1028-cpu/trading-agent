// 持仓 UI 视图归一化:把原始 db.positions 变成"给前端用的一行一仓"。
// 背景(审计实锤):同一真实仓在 db 里有两条——execution_engine(引擎自记,带入场理由/planId)
// 与 exchange_rest(交易所同步,带真实 liqPx/杠杆/币量)。/api/overview 此前原样下发 →
// 持仓明细同一仓显示两行,还字段错配:前端读 liquidationPrice/notional/margin/liqDistancePct,
// 而真实字段是 liqPx/(无)/(无)。这里在下发前:①按 symbol+方向合并两行 ②补齐派生字段 ③统一口径。
// 只影响展示;db 两条保留供 reconcileAccount 逐仓对账,互不影响。

import { canonicalPositionDirection, canonicalSymbol } from "./positionIdentity.mjs";

const isOpen = (p) => !p.status || p.status === "open";
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || v.length > 80) return null;
  const text = v.trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};
const boundedIdentity = (value) => typeof value === "string"
  && value.length > 0
  && value.length <= 240
  && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value)
  ? value
  : null;
const ACCOUNT_ID_FIELDS = Object.freeze(["accountId", "exchangeAccountId", "connectionAccountId"]);
const missingIdentity = Object.freeze({ state: "unbound", value: null });
const MAX_NORMALIZE_ROWS = 10_000;
const MAX_NORMALIZE_RECORD_KEYS = 256;
const NORMALIZE_TEXT_FIELDS = Object.freeze([
  "status", "source", "symbol", "instId", "direction", "posSide", "positionSide", "side", "exchangePositionKey"
]);
const NORMALIZE_TIMESTAMP_FIELDS = Object.freeze(["exchangeObservedAt", "rawSyncedAt", "updatedAt", "createdAt"]);
const NORMALIZE_NUMERIC_FIELDS = Object.freeze([
  "mark", "markPx", "coinSize", "quantity", "size", "pos", "positionAmt", "signedSize",
  "leverage", "liqPx", "liquidationPrice", "pnl", "unrealizedPnl", "roiPct", "entry", "avgPx"
]);

function boundedArrayValues(value) {
  try {
    if (!Array.isArray(value)) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_NORMALIZE_ROWS) return null;
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== length + 1 || keys.some((key) => (
      key !== "length"
      && (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= length)
    ))) return null;
    const rows = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[index];
      if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable) return null;
      rows[index] = descriptor.value;
    }
    return rows;
  } catch {
    return null;
  }
}

function plainDataSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  try {
    if (Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > MAX_NORMALIZE_RECORD_KEYS || keys.some((key) => typeof key !== "string")) return null;
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
  } catch {
    return null;
  }
}

function normalizeInputSnapshot(value) {
  const snapshot = plainDataSnapshot(value);
  if (!snapshot) return null;
  for (const field of NORMALIZE_TEXT_FIELDS) {
    const scalar = snapshot[field];
    if (scalar === null || scalar === undefined || scalar === "") continue;
    if (typeof scalar !== "string" || scalar.length > 2_000) return null;
  }
  for (const field of NORMALIZE_TIMESTAMP_FIELDS) {
    const scalar = snapshot[field];
    if (scalar === null || scalar === undefined || scalar === "") continue;
    if (typeof scalar === "number") {
      if (!Number.isFinite(scalar)) return null;
      continue;
    }
    if (typeof scalar !== "string" || scalar.length > 240 || !Number.isFinite(Date.parse(scalar))) return null;
  }
  for (const field of NORMALIZE_NUMERIC_FIELDS) {
    const scalar = snapshot[field];
    if (scalar === null || scalar === undefined || scalar === "") continue;
    if (num(scalar) === null) return null;
  }
  return snapshot;
}

function identityFor(row, fields, { uppercase = false } = {}) {
  if (!row || typeof row !== "object") return { state: "invalid", value: null };
  const values = new Set();
  for (const field of fields) {
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(row, field); } catch { return { state: "invalid", value: null }; }
    if (!descriptor) continue;
    if (!Object.hasOwn(descriptor, "value")) return { state: "invalid", value: null };
    const raw = descriptor.value;
    if (raw === null || raw === undefined || raw === "") continue;
    const identity = boundedIdentity(raw);
    if (!identity) return { state: "invalid", value: null };
    values.add(uppercase ? identity.toUpperCase() : identity);
  }
  if (values.size === 0) return missingIdentity;
  if (values.size !== 1) return { state: "invalid", value: null };
  return { state: "valid", value: values.values().next().value };
}

const accountIdentityFor = (row = {}) => identityFor(row, ACCOUNT_ID_FIELDS);
const exchangeIdentityFor = (row = {}) => identityFor(row, ["exchange"], { uppercase: true });
const bindingFor = (row = {}) => {
  const account = accountIdentityFor(row);
  const exchange = exchangeIdentityFor(row);
  if (account.state === "invalid" || exchange.state === "invalid") {
    return { state: "invalid", accountId: null, exchange: null, key: null };
  }
  if (account.state !== "valid" || exchange.state !== "valid") {
    return { state: "unbound", accountId: null, exchange: exchange.value, key: null };
  }
  return {
    state: "valid",
    accountId: account.value,
    exchange: exchange.value,
    key: JSON.stringify([account.value, exchange.value])
  };
};
const emptyPositionGroup = () => ({ engines: [], rests: [], websockets: [], others: [] });

function dataProjection(record = {}) {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(record);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 256 || keys.some((key) => typeof key !== "string")) return {};
    const projected = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor && Object.hasOwn(descriptor, "value")) projected[key] = descriptor.value;
    }
    return projected;
  } catch {
    return {};
  }
}

// 方向归一化:多/long/buy → "多";空/short/sell → "空"(UI 为中文,统一成中文,含 tone 可判)。
export function canonDirection(d) {
  const direction = canonicalPositionDirection(d);
  return direction === "short" ? "空" : direction === "long" ? "多" : null;
}

function newest(rows = []) {
  return rows.slice().sort((a, b) => positionFactObservedMs(b) - positionFactObservedMs(a))[0] || null;
}

function newestNormalized(rows = []) {
  return rows.slice().sort((a, b) => normalizeObservedMs(b) - normalizeObservedMs(a))[0] || null;
}

function normalizeObservedMs(position = {}) {
  const value = position.exchangeObservedAt || position.rawSyncedAt || position.updatedAt || position.createdAt || null;
  if (typeof value !== "string" && typeof value !== "number") return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function positionFactObservedMs(position = {}) {
  const value = position.exchangeObservedAt || position.rawSyncedAt || position.updatedAt || position.createdAt || null;
  const timestamp = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function positionMirrorKey(position = {}) {
  const account = position.accountId || position.exchangeAccountId || position.connectionAccountId || "unbound";
  const exchange = String(position.exchange || "OKX").toUpperCase();
  const symbol = canonicalSymbol(position.symbol || position.instId);
  const direction = canonicalPositionDirection(position);
  if (!symbol || !direction) return null;
  return `${account}|${exchange}|${symbol}|${direction}|${position.mgnMode || ""}|${position.ccy || ""}`;
}

export function groupPositionMirrors(positions = []) {
  const groups = new Map();
  for (const position of positions) {
    const key = positionMirrorKey(position);
    if (!key) continue;
    const rows = groups.get(key) || [];
    rows.push(position);
    groups.set(key, rows);
  }
  return groups;
}

// 同一真实仓位可能有多条本地/交易所记录。财务与风险计算优先使用最新交易所事实，
// 没有交易所记录时才使用同一身份组内的最新记录。
export function dedupePositions(positions = []) {
  const selected = [];
  for (const rows of groupPositionMirrors(positions).values()) {
    const exchangeRows = rows.filter((row) => ["exchange_rest", "exchange_ws"].includes(row.source));
    const candidates = exchangeRows.length ? exchangeRows : rows;
    selected.push(candidates.slice().sort((a, b) => positionFactObservedMs(b) - positionFactObservedMs(a))[0]);
  }
  return selected;
}

export function newestAuthoritativePosition(rows = [], options = {}) {
  const now = Number(options.now ?? Date.now());
  const maxAgeMs = Number(options.maxAgeMs ?? process.env.MAX_POSITION_FACT_AGE_MS ?? 120_000);
  const maxFutureSkewMs = Number(options.maxFutureSkewMs ?? 30_000);
  const exchangeRows = rows.filter((row) => ["exchange_rest", "exchange_ws"].includes(row.source));
  const row = newest(exchangeRows);
  if (!row) return { row: null, fresh: false, reason: "exchange_position_unavailable", observedAt: null, ageMs: Infinity };
  const observedAtMs = positionFactObservedMs(row);
  const ageMs = now - observedAtMs;
  if (!Number.isFinite(observedAtMs)) return { row, fresh: false, reason: "position_timestamp_missing", observedAt: null, ageMs: Infinity };
  if (ageMs < -maxFutureSkewMs) return { row, fresh: false, reason: "position_timestamp_future", observedAt: new Date(observedAtMs).toISOString(), ageMs };
  if (ageMs > maxAgeMs) return { row, fresh: false, reason: "position_snapshot_stale", observedAt: new Date(observedAtMs).toISOString(), ageMs };
  return { row, fresh: true, reason: null, observedAt: new Date(observedAtMs).toISOString(), ageMs: Math.max(0, ageMs) };
}

function executionIndex(options = {}) {
  let provided = false;
  let rawOrders = null;
  try {
    const descriptor = options && typeof options === "object"
      ? Object.getOwnPropertyDescriptor(options, "executionOrders")
      : null;
    provided = Boolean(descriptor);
    if (descriptor && Object.hasOwn(descriptor, "value")) rawOrders = boundedArrayValues(descriptor.value);
  } catch {
    provided = true;
  }
  const orders = rawOrders || [];
  const indexed = new Map();
  for (const value of orders) {
    const order = normalizeInputSnapshot(value);
    if (!order) continue;
    const identity = identityFor(order, ["id"]);
    if (identity.state !== "valid") continue;
    const id = identity.value;
    const current = indexed.get(id) || { count: 0, order: null };
    current.count += 1;
    current.order = order;
    indexed.set(id, current);
  }
  return { provided, indexed };
}

function engineExecutionBinding(engine, executionLookup, symbol, direction) {
  const executionOrderId = boundedIdentity(engine?.executionOrderId);
  if (!executionOrderId) return { state: "missing", binding: null };
  if (!executionLookup.provided) return { state: "missing", binding: null };
  const match = executionLookup.indexed.get(executionOrderId);
  if (!match || match.count !== 1) return { state: "invalid", binding: null };
  const executionSymbol = canonicalSymbol(match.order.symbol || match.order.instId);
  const executionDirection = canonicalPositionDirection(match.order);
  if ((executionSymbol && executionSymbol !== symbol) || (executionDirection && executionDirection !== direction)) {
    return { state: "invalid", binding: null };
  }
  const binding = bindingFor(match.order);
  return binding.state === "valid" ? { state: "valid", binding } : { state: "invalid", binding: null };
}

function normalizedPositionGroup(g) {
  const eng = newestNormalized(g.engines) || {};
  const rest = newestNormalized(g.rests) || {};
  const ws = newestNormalized(g.websockets) || {};
  const other = newestNormalized(g.others) || {};
  const hasEngine = Boolean(eng.id || g.engines.length);
  const exchangeMirror = g.rests.length ? rest : g.websockets.length ? ws : null;
  const mirrorBinding = exchangeMirror ? bindingFor(exchangeMirror) : { state: "unbound", accountId: null, exchange: null };
  const mirrorProvenanceValid = mirrorBinding.state === "valid";
  const mirrorProvenanceInvalid = mirrorBinding.state === "invalid";
  const base = hasEngine ? eng : (rest.id ? rest : ws.id ? ws : other); // 引擎行只提供托管身份与解释字段
  const mark = num(rest.mark ?? rest.markPx) ?? num(ws.mark ?? ws.markPx) ?? num(eng.mark) ?? num(other.mark);
  // 交易所 size 是合约张数，只有 coinSize 才是币量；缺 coinSize 时只能回退到同仓的引擎币量。
  const coinQty = num(rest.coinSize) ?? num(ws.coinSize) ?? (hasEngine ? num(eng.quantity ?? eng.size) : null);
  const leverage = num(rest.leverage) ?? num(ws.leverage) ?? num(eng.leverage) ?? num(other.leverage);
  // 有交易所快照时，强平价只能以交易所字段为准；显式未知不能被引擎估算值覆盖。
  const liqPx = num(rest.liqPx ?? rest.liquidationPrice) ?? num(ws.liqPx ?? ws.liquidationPrice) ?? (!g.rests.length && !g.websockets.length ? num(eng.liqPx ?? eng.liquidationPrice) : null);
  const unrealizedPnl = num(rest.pnl ?? rest.unrealizedPnl) ?? num(ws.pnl ?? ws.unrealizedPnl) ?? num(eng.unrealizedPnl ?? eng.pnl) ?? num(other.unrealizedPnl ?? other.pnl);
  const notional = coinQty !== null && mark !== null ? Math.abs(coinQty * mark) : null;
  const margin = notional !== null && leverage ? notional / leverage : null;
  const liqDistancePct = liqPx !== null && mark ? Math.abs((mark - liqPx) / mark) * 100 : null;
  return {
    ...dataProjection(base),
    source: hasEngine ? "execution_engine" : (rest.source || ws.source || base.source),
    symbol: base.symbol || rest.symbol || ws.symbol,
    direction: canonDirection(base),
    // 这些字段只说明当前 UI 财务事实实际选中的交易所镜像；不得从引擎行推断镜像所有权。
    rawSyncedAt: mirrorProvenanceInvalid ? null : exchangeMirror?.rawSyncedAt ?? null,
    accountId: mirrorProvenanceValid ? mirrorBinding.accountId : null,
    exchangeAccountId: null,
    connectionAccountId: null,
    exchange: mirrorProvenanceInvalid ? null : mirrorBinding.exchange,
    entry: num(rest.entry ?? rest.avgPx) ?? num(ws.entry ?? ws.avgPx) ?? num(eng.entry) ?? num(other.entry),
    mark,
    quantity: coinQty,            // 统一为币量(不再混合约张数/币量)
    leverage,
    unrealizedPnl,
    pnl: unrealizedPnl,
    roiPct: num(rest.roiPct) ?? num(ws.roiPct) ?? num(eng.roiPct) ?? num(other.roiPct), // 交易所杠杆化 ROI 优先
    notional,                     // = 币量 × 标记价(此前前端读 notional 恒缺 → 敞口/分布恒 0)
    margin,                       // = 名义 / 杠杆(此前前端读 margin 恒缺 → 保证金占用恒 —)
    liquidationPrice: liqPx,      // 对齐前端读的字段名(此前读 liquidationPrice、真名 liqPx → 恒 —)
    liqDistancePct,               // 补上(此前缺 → 强平距离恒判"安全")
    exchangePositionKey: rest.exchangePositionKey || ws.exchangePositionKey || base.exchangePositionKey || null
  };
}

export function normalizePositionsForUi(positions = [], options = {}) {
  const inputRows = boundedArrayValues(positions);
  if (!inputRows) return [];
  const safePositions = inputRows.map(normalizeInputSnapshot).filter(Boolean);
  const baseGroups = new Map();
  for (const p of safePositions.filter(isOpen)) {
    const key = `${canonicalSymbol(p.symbol || p.instId)}::${canonDirection(p) || "unknown"}`;
    const g = baseGroups.get(key) || emptyPositionGroup();
    if (p.source === "execution_engine") g.engines.push(p);
    else if (p.source === "exchange_rest") g.rests.push(p);
    else if (p.source === "exchange_ws") g.websockets.push(p);
    else g.others.push(p);
    baseGroups.set(key, g);
  }
  const indexedExecutions = executionIndex(options);
  const rows = [];
  for (const [baseKey, sourceGroup] of baseGroups) {
    const symbol = baseKey.split("::")[0];
    const direction = canonicalPositionDirection(sourceGroup.engines[0] || sourceGroup.rests[0] || sourceGroup.websockets[0] || {});
    const mirrorGroups = new Map();
    const unboundMirrors = emptyPositionGroup();
    const invalidMirrorGroups = [];
    for (const [field, mirrors] of [["rests", sourceGroup.rests], ["websockets", sourceGroup.websockets]]) {
      for (const mirror of mirrors) {
        const binding = bindingFor(mirror);
        if (binding.state === "invalid") {
          const invalidGroup = emptyPositionGroup();
          invalidGroup[field].push(mirror);
          invalidMirrorGroups.push(invalidGroup);
        } else if (binding.state === "unbound") unboundMirrors[field].push(mirror);
        else {
          const group = mirrorGroups.get(binding.key) || emptyPositionGroup();
          group[field].push(mirror);
          mirrorGroups.set(binding.key, group);
        }
      }
    }

    const unbound = emptyPositionGroup();
    unbound.others.push(...sourceGroup.others);
    for (const engine of sourceGroup.engines) {
      const linked = engineExecutionBinding(engine, indexedExecutions, symbol, direction);
      let target = null;
      if (linked.state === "valid") {
        target = mirrorGroups.get(linked.binding.key) || emptyPositionGroup();
        mirrorGroups.set(linked.binding.key, target);
      } else if (linked.state === "missing" && mirrorGroups.size === 1 && !unboundMirrors.rests.length && !unboundMirrors.websockets.length) {
        target = mirrorGroups.values().next().value;
      } else if (linked.state === "missing" && mirrorGroups.size === 0 && (unboundMirrors.rests.length || unboundMirrors.websockets.length)) {
        // Compatibility for legacy single-owner mirrors that predate account linkage.
        // They may supply display facts but still carry null provenance, so cannot prove protection.
        target = unboundMirrors;
      }
      (target || unbound).engines.push(engine);
    }

    for (const group of mirrorGroups.values()) rows.push(normalizedPositionGroup(group));
    if (unboundMirrors.rests.length || unboundMirrors.websockets.length) rows.push(normalizedPositionGroup(unboundMirrors));
    for (const group of invalidMirrorGroups) rows.push(normalizedPositionGroup(group));
    if (unbound.engines.length || unbound.others.length) rows.push(normalizedPositionGroup(unbound));
  }
  return rows;
}
