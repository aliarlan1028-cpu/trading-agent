import crypto from "node:crypto";
import { okxContractSpec, okxSignedRequest } from "./exchangeConnector.mjs";
import { okxRestUrl } from "./okxEnvironment.mjs";

export const ROLLING_ACCOUNTING_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const ACCOUNTING_BOUNDARY_BUCKET_MS = 5 * 60_000;
const MAX_OKX_HISTORY_MS = 90 * 24 * 60 * 60_000;
const QUANTITY_TOLERANCE = 1e-8;
const MONEY_TOLERANCE_USDT = 0.02;

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function jsonHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertActive(options = {}) {
  options.assertLease?.();
  if (options.signal?.aborted) {
    const error = new Error("accounting_history_request_aborted");
    error.name = "AbortError";
    throw error;
  }
}

function requestOptions(options = {}) {
  return options.signal ? { signal: options.signal } : {};
}

function positionDirection(row = {}) {
  const explicit = String(row.direction || row.canonicalDirection || row.posSide || "").toLowerCase();
  if (["long", "short"].includes(explicit)) return explicit;
  const signed = finite(row.rawSignedPosition ?? row.pos);
  return signed !== null && signed < 0 ? "short" : "long";
}

function positionQuantity(row = {}) {
  const raw = finite(row.rawSignedPosition ?? row.pos ?? row.contractSize ?? row.size ?? row.quantity);
  return raw === null ? null : Math.abs(raw);
}

function positionKey(instId, direction) {
  return `${String(instId || "").toUpperCase()}:${direction}`;
}

function tradeDirection(subType) {
  if (["3", "5"].includes(String(subType))) return "long";
  if (["4", "6"].includes(String(subType))) return "short";
  return null;
}

function isOpeningTrade(subType) {
  return ["3", "4"].includes(String(subType));
}

function isClosingTrade(subType) {
  return ["5", "6"].includes(String(subType));
}

function compareBillIds(left, right) {
  try {
    const a = BigInt(String(left.billId || "0"));
    const b = BigInt(String(right.billId || "0"));
    return a < b ? -1 : a > b ? 1 : 0;
  } catch {
    return String(left.billId || "").localeCompare(String(right.billId || ""));
  }
}

function sortBills(rows = []) {
  return rows.slice().sort((a, b) => {
    const timeDiff = Number(a.ts || 0) - Number(b.ts || 0);
    return timeDiff || compareBillIds(a, b);
  });
}

function dedupeEvidenceRows(rows = [], idField) {
  const byId = new Map();
  for (const row of rows) {
    const rowId = String(row?.[idField] || "");
    if (!rowId) return { ok: false, reason: `${idField}_missing` };
    const current = byId.get(rowId);
    if (current && jsonHash(current) !== jsonHash(row)) return { ok: false, reason: `${idField}_conflict`, rowId };
    byId.set(rowId, row);
  }
  return { ok: true, rows: [...byId.values()] };
}

export function rollingAccountingBoundary(nowMs = Date.now()) {
  const bucketEnd = Math.floor(Number(nowMs) / ACCOUNTING_BOUNDARY_BUCKET_MS) * ACCOUNTING_BOUNDARY_BUCKET_MS;
  return bucketEnd - ROLLING_ACCOUNTING_WINDOW_MS;
}

export async function fetchOkxBillsForAccounting(options = {}) {
  const request = options.request || okxSignedRequest;
  const beginMs = Number(options.beginMs);
  const endMs = Number(options.endMs);
  const limit = Math.max(1, Math.min(100, Number(options.limit || 100)));
  const maxPages = Math.max(1, Math.min(100, Number(options.maxPages || 50)));
  if (!Number.isFinite(beginMs) || !Number.isFinite(endMs) || endMs < beginMs) {
    return { complete: false, reason: "okx_bills_window_invalid", rows: [] };
  }
  const rows = [];
  let after = null;
  for (let page = 0; page < maxPages; page += 1) {
    assertActive(options);
    const query = new URLSearchParams({ begin: String(beginMs), end: String(endMs), limit: String(limit) });
    if (after) query.set("after", after);
    let raw;
    try {
      raw = await request(`/api/v5/account/bills-archive?${query.toString()}`, "GET", "", requestOptions(options));
      assertActive(options);
    } catch (error) {
      if (error?.name === "AbortError" || options.signal?.aborted) throw error;
      return { complete: false, reason: "okx_bills_query_failed", error: String(error?.message || error).slice(0, 160), rows };
    }
    if (String(raw?.code ?? "") !== "0") {
      return { complete: false, reason: "okx_bills_query_rejected", code: raw?.code || null, rows };
    }
    if (!Array.isArray(raw.data)) return { complete: false, reason: "okx_bills_response_malformed", rows };
    const pageRows = raw.data;
    rows.push(...pageRows);
    if (pageRows.length < limit) {
      const deduped = dedupeEvidenceRows(rows, "billId");
      if (!deduped.ok) return { complete: false, reason: deduped.reason, rows: deduped.rows || rows };
      return { complete: true, rows: sortBills(deduped.rows), pages: page + 1 };
    }
    const next = String(pageRows.at(-1)?.billId || "");
    if (!next || next === after) return { complete: false, reason: "okx_bills_pagination_unstable", rows, pages: page + 1 };
    after = next;
  }
  return { complete: false, reason: "okx_bills_pagination_incomplete", rows, pages: maxPages };
}

export async function fetchOkxPositionHistoryForAccounting(options = {}) {
  const request = options.request || okxSignedRequest;
  const boundaryMs = Number(options.boundaryMs);
  const limit = Math.max(1, Math.min(100, Number(options.limit || 100)));
  const maxPages = Math.max(1, Math.min(100, Number(options.maxPages || 50)));
  if (!Number.isFinite(boundaryMs)) return { complete: false, reason: "position_history_boundary_invalid", rows: [] };
  const rows = [];
  let after = null;
  for (let page = 0; page < maxPages; page += 1) {
    assertActive(options);
    const query = new URLSearchParams({ instType: "SWAP", limit: String(limit) });
    if (after) query.set("after", after);
    let raw;
    try {
      raw = await request(`/api/v5/account/positions-history?${query.toString()}`, "GET", "", requestOptions(options));
      assertActive(options);
    } catch (error) {
      if (error?.name === "AbortError" || options.signal?.aborted) throw error;
      return { complete: false, reason: "okx_position_history_query_failed", error: String(error?.message || error).slice(0, 160), rows };
    }
    if (String(raw?.code ?? "") !== "0") {
      return { complete: false, reason: "okx_position_history_rejected", code: raw?.code || null, rows };
    }
    if (!Array.isArray(raw.data)) return { complete: false, reason: "okx_position_history_response_malformed", rows };
    const pageRows = raw.data;
    rows.push(...pageRows);
    const pageTimes = pageRows.map((row) => timestamp(row.uTime)).filter((value) => value !== null);
    const reachedBoundary = pageTimes.length > 0 && Math.min(...pageTimes) <= boundaryMs;
    if (pageRows.length < limit || reachedBoundary) {
      const deduped = dedupeEvidenceRows(rows, "posId");
      if (!deduped.ok) return { complete: false, reason: deduped.reason, rows: deduped.rows || rows };
      return { complete: true, rows: deduped.rows, pages: page + 1 };
    }
    const next = String(pageRows.at(-1)?.uTime || "");
    if (!next || next === after) return { complete: false, reason: "okx_position_history_pagination_unstable", rows, pages: page + 1 };
    after = next;
  }
  return { complete: false, reason: "okx_position_history_pagination_incomplete", rows, pages: maxPages };
}

export async function fetchOkxBoundaryMarkPrice(instId, boundaryMs, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const query = new URLSearchParams({ instId: String(instId), after: String(Number(boundaryMs)), bar: "1m", limit: "10" });
  try {
    assertActive(options);
    const timeout = globalThis.AbortSignal.timeout(Number(options.timeoutMs || 8_000));
    const signal = options.signal && typeof globalThis.AbortSignal.any === "function"
      ? globalThis.AbortSignal.any([options.signal, timeout])
      : options.signal || timeout;
    const response = await fetchImpl(okxRestUrl(`/api/v5/market/history-mark-price-candles?${query.toString()}`), {
      signal
    });
    assertActive(options);
    if (!response.ok) return { complete: false, reason: "okx_boundary_mark_http_failed", status: response.status };
    const raw = await response.json();
    if (String(raw?.code ?? "") !== "0") return { complete: false, reason: "okx_boundary_mark_rejected", code: raw?.code || null };
    if (!Array.isArray(raw.data)) return { complete: false, reason: "okx_boundary_mark_response_malformed" };
    const candidates = (raw.data || []).map((row) => ({
      openAt: Number(row[0]), close: finite(row[4]), confirmed: String(row[5]) === "1"
    })).filter((row) => row.confirmed && Number.isFinite(row.openAt) && row.openAt + 60_000 <= boundaryMs && row.close !== null && row.close > 0)
      .sort((a, b) => b.openAt - a.openAt);
    const selected = candidates[0];
    if (!selected || boundaryMs - (selected.openAt + 60_000) > 2 * 60_000) {
      return { complete: false, reason: "okx_boundary_mark_missing" };
    }
    return { complete: true, price: selected.close, observedAt: new Date(selected.openAt + 60_000).toISOString(), source: "OKX_MARK_PRICE_1M" };
  } catch (error) {
    if (error?.name === "AbortError" && options.signal?.aborted) throw error;
    return { complete: false, reason: "okx_boundary_mark_query_failed", error: String(error?.message || error).slice(0, 160) };
  }
}

function applyTradeToState(state, bill) {
  const direction = tradeDirection(bill.subType);
  if (!direction) return { ok: false, reason: "unsupported_swap_trade_subtype", subType: bill.subType || null };
  const instId = String(bill.instId || "").toUpperCase();
  const quantity = finite(bill.sz);
  const price = finite(bill.px);
  if (!instId || quantity === null || quantity <= 0 || price === null || price <= 0) {
    return { ok: false, reason: "swap_trade_state_evidence_incomplete", billId: bill.billId || null };
  }
  const key = positionKey(instId, direction);
  const current = state.get(key) || { instId, direction, quantity: 0, averagePrice: null };
  if (isOpeningTrade(bill.subType)) {
    const notionalPrice = (current.averagePrice || 0) * current.quantity + price * quantity;
    current.quantity += quantity;
    current.averagePrice = current.quantity > 0 ? notionalPrice / current.quantity : null;
  } else if (isClosingTrade(bill.subType)) {
    if (quantity > current.quantity + QUANTITY_TOLERANCE) {
      return { ok: false, reason: "swap_close_exceeds_reconstructed_position", billId: bill.billId || null, instId };
    }
    current.quantity = Math.max(0, current.quantity - quantity);
    if (current.quantity <= QUANTITY_TOLERANCE) {
      current.quantity = 0;
      current.averagePrice = null;
    }
  }
  state.set(key, current);
  return { ok: true };
}

function currentPositionMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const quantity = positionQuantity(row);
    if (quantity === null || quantity <= QUANTITY_TOLERANCE) continue;
    const instId = String(row.instId || row.symbol || "").replace("/", "-").replace(/-SWAP$/i, "").toUpperCase();
    const normalizedInstId = instId.endsWith("-USDT") ? `${instId}-SWAP` : instId;
    const direction = positionDirection(row);
    const key = positionKey(normalizedInstId, direction);
    map.set(key, (map.get(key) || 0) + quantity);
  }
  return map;
}

function snapshotUnrealized(snapshot = {}) {
  const compact = finite(snapshot.unrealizedPnlUsdt);
  if (compact !== null) return compact;
  let total = 0;
  for (const row of snapshot.positions || []) {
    const quantity = positionQuantity(row);
    if (quantity === null || quantity <= QUANTITY_TOLERANCE) continue;
    const pnl = finite(row.pnl ?? row.upl ?? row.unrealizedPnl);
    if (pnl === null) return null;
    total += pnl;
  }
  return total;
}

function normalizedHistoryEvidence(bills, positionsHistory, marks, specs) {
  return {
    bills: bills.map((row) => ({
      billId: row.billId, ts: row.ts, type: row.type, subType: row.subType, instId: row.instId,
      ccy: row.ccy, sz: row.sz, px: row.px, pnl: row.pnl, fee: row.fee, balChg: row.balChg,
      from: row.from, to: row.to
    })),
    positions: positionsHistory.map((row) => ({
      posId: row.posId, instId: row.instId, direction: row.direction, cTime: row.cTime, uTime: row.uTime,
      type: row.type, realizedPnl: row.realizedPnl, fee: row.fee, fundingFee: row.fundingFee
    })),
    marks: [...marks.entries()].sort(([a], [b]) => a.localeCompare(b)),
    specs: [...specs.entries()].map(([instId, spec]) => [instId, { ctVal: spec.ctVal, ctType: spec.ctType, ctValCcy: spec.ctValCcy, settleCcy: spec.settleCcy }])
      .sort(([a], [b]) => a.localeCompare(b))
  };
}

export function buildOkxHistoricalAccountingBaseline(input = {}) {
  const boundaryMs = Number(input.boundaryMs);
  const endMs = Number(input.endMs);
  const currentEquity = finite(input.currentEquity);
  const currentSnapshot = input.currentSnapshot || {};
  const binding = input.binding || {};
  const localRealized = input.localRealizedState || {};
  if (!Number.isFinite(boundaryMs) || !Number.isFinite(endMs) || endMs <= boundaryMs) return { ok: false, reason: "history_window_invalid" };
  if (!(currentEquity > 0)) return { ok: false, reason: "current_equity_unavailable" };
  if (!binding.accountId || !binding.apiKeyFingerprint || !binding.environment) return { ok: false, reason: "accounting_binding_incomplete" };
  if (currentSnapshot.status !== "ok"
    || currentSnapshot.accountId !== binding.accountId
    || currentSnapshot.apiKeyFingerprint !== binding.apiKeyFingerprint
    || currentSnapshot.environment !== binding.environment) {
    return { ok: false, reason: "current_snapshot_binding_mismatch" };
  }
  if (localRealized.pending !== 0 || finite(localRealized.value) === null) return { ok: false, reason: "local_financial_facts_incomplete" };
  const currentUnrealized = snapshotUnrealized(currentSnapshot);
  if (currentUnrealized === null) return { ok: false, reason: "current_unrealized_pnl_incomplete" };

  const bills = sortBills(input.bills || []);
  const positionsHistory = input.positionsHistory || [];
  const marks = input.markPrices instanceof Map ? input.markPrices : new Map(Object.entries(input.markPrices || {}));
  const specs = input.contractSpecs instanceof Map ? input.contractSpecs : new Map(Object.entries(input.contractSpecs || {}));
  const state = new Map();
  let boundaryState = new Map();
  let exchangeRealized = 0;
  let externalCashFlow = 0;
  const usedBills = [];

  for (const bill of bills) {
    const at = timestamp(bill.ts);
    if (at === null || at > endMs) continue;
    const type = String(bill.type || "");
    const subType = String(bill.subType || "");
    if (type === "2") {
      if (String(bill.instType || "SWAP").toUpperCase() !== "SWAP" || String(bill.ccy || "").toUpperCase() !== "USDT") {
        return { ok: false, reason: "unsupported_trade_currency_or_instrument", billId: bill.billId || null };
      }
      const applied = applyTradeToState(state, bill);
      if (!applied.ok) return { ok: false, ...applied };
      if (at >= boundaryMs) {
        const pnl = finite(bill.pnl);
        const fee = finite(bill.fee);
        if (pnl === null || fee === null) return { ok: false, reason: "trade_pnl_or_fee_missing", billId: bill.billId || null };
        exchangeRealized += pnl + fee;
      }
    } else if (type === "8") {
      if (!["173", "174"].includes(subType) || String(bill.ccy || "").toUpperCase() !== "USDT") {
        return { ok: false, reason: "unsupported_funding_bill", billId: bill.billId || null };
      }
      if (at >= boundaryMs) {
        const pnl = finite(bill.pnl);
        const fee = finite(bill.fee) ?? 0;
        if (pnl === null) return { ok: false, reason: "funding_amount_missing", billId: bill.billId || null };
        exchangeRealized += pnl + fee;
      }
    } else if (type === "1") {
      if (String(bill.ccy || "").toUpperCase() !== "USDT" || finite(bill.balChg) === null) {
        return { ok: false, reason: "unsupported_transfer_currency", billId: bill.billId || null };
      }
      if (at >= boundaryMs) externalCashFlow += Number(bill.balChg);
    } else {
      const balanceChange = finite(bill.balChg) ?? 0;
      const pnl = finite(bill.pnl) ?? 0;
      const fee = finite(bill.fee) ?? 0;
      if (Math.abs(balanceChange) > 1e-10 || Math.abs(pnl) > 1e-10 || Math.abs(fee) > 1e-10) {
        return { ok: false, reason: "unsupported_balance_changing_bill", type, subType, billId: bill.billId || null };
      }
    }
    usedBills.push(bill);
    if (at < boundaryMs) boundaryState = new Map([...state.entries()].map(([key, row]) => [key, { ...row }]));
  }

  const spanning = positionsHistory.filter((row) => {
    const created = timestamp(row.cTime);
    const updated = timestamp(row.uTime);
    return created !== null && updated !== null && created < boundaryMs && updated >= boundaryMs;
  });
  for (const row of spanning) {
    const key = positionKey(row.instId, positionDirection(row));
    if (!(boundaryState.get(key)?.quantity > QUANTITY_TOLERANCE)) {
      return { ok: false, reason: "spanning_position_not_reconstructed", posId: row.posId || null, instId: row.instId || null };
    }
  }
  for (const row of boundaryState.values()) {
    if (row.quantity <= QUANTITY_TOLERANCE) continue;
    const historicalMatch = spanning.some((item) => positionKey(item.instId, positionDirection(item)) === positionKey(row.instId, row.direction));
    const currentMatch = (currentSnapshot.positions || []).some((item) => {
      const created = timestamp(item.cTime || item.createdAt);
      return created !== null && created < boundaryMs
        && positionKey(item.instId, positionDirection(item)) === positionKey(row.instId, row.direction);
    });
    if (!historicalMatch && !currentMatch) return { ok: false, reason: "boundary_position_history_missing", instId: row.instId };
  }

  const currentMap = currentPositionMap(currentSnapshot.positions || []);
  const keys = new Set([...state.keys(), ...currentMap.keys()]);
  for (const key of keys) {
    const reconstructed = state.get(key)?.quantity || 0;
    const authoritative = currentMap.get(key) || 0;
    if (Math.abs(reconstructed - authoritative) > Math.max(QUANTITY_TOLERANCE, authoritative * 1e-6)) {
      return { ok: false, reason: "current_position_reconstruction_mismatch", positionKey: key };
    }
  }

  let boundaryUnrealized = 0;
  const boundaryPositions = [];
  for (const row of boundaryState.values()) {
    if (row.quantity <= QUANTITY_TOLERANCE) continue;
    const mark = marks.get(row.instId);
    const spec = specs.get(row.instId);
    if (!mark?.complete || finite(mark.price) === null || !spec || finite(spec.ctVal) === null) {
      return { ok: false, reason: "boundary_valuation_evidence_missing", instId: row.instId };
    }
    if (spec.ctType && spec.ctType !== "linear") return { ok: false, reason: "inverse_contract_boundary_valuation_unsupported", instId: row.instId };
    if (spec.settleCcy && String(spec.settleCcy).toUpperCase() !== "USDT") return { ok: false, reason: "non_usdt_settlement_unsupported", instId: row.instId };
    const directionSign = row.direction === "short" ? -1 : 1;
    const upl = (Number(mark.price) - Number(row.averagePrice)) * Number(row.quantity) * Number(spec.ctVal) * directionSign;
    if (!Number.isFinite(upl)) return { ok: false, reason: "boundary_unrealized_pnl_invalid", instId: row.instId };
    boundaryUnrealized += upl;
    boundaryPositions.push({ instId: row.instId, direction: row.direction, quantity: row.quantity, averagePrice: row.averagePrice, markPrice: Number(mark.price), upl });
  }

  exchangeRealized = Number(exchangeRealized.toFixed(8));
  const localValue = Number(Number(localRealized.value).toFixed(8));
  if (Math.abs(exchangeRealized - localValue) > MONEY_TOLERANCE_USDT) {
    return { ok: false, reason: "local_exchange_realized_pnl_mismatch", exchangeRealized, localRealized: localValue };
  }
  const weekPnl = Number((exchangeRealized + currentUnrealized - boundaryUnrealized).toFixed(8));
  const startEquity = Number((currentEquity - weekPnl - externalCashFlow).toFixed(8));
  if (!(startEquity > 0)) return { ok: false, reason: "reconstructed_start_equity_invalid" };

  const evidence = normalizedHistoryEvidence(usedBills, positionsHistory, marks, specs);
  const evidenceHash = jsonHash({ boundaryMs, endMs, binding, currentSnapshotId: currentSnapshot.id || null, evidence });
  return {
    ok: true,
    baseline: {
      kind: "rolling_168h",
      boundaryAt: new Date(boundaryMs).toISOString(),
      snapshotId: currentSnapshot.id || null,
      observedAt: new Date(boundaryMs).toISOString(),
      accountId: binding.accountId,
      apiKeyFingerprint: binding.apiKeyFingerprint,
      environment: binding.environment,
      equityUsdt: startEquity,
      unrealizedPnlUsdt: Number(boundaryUnrealized.toFixed(8)),
      netExternalCashFlowUsdt: Number(externalCashFlow.toFixed(8)),
      pnlMethod: "okx_bills_plus_boundary_mark_to_market",
      evidenceHash,
      evidenceSource: "OKX_BILLS_ARCHIVE_POSITIONS_HISTORY_MARK_PRICE",
      evidenceBillCount: usedBills.filter((row) => Number(row.ts) >= boundaryMs).length,
      evidencePositionCount: positionsHistory.filter((row) => Number(row.uTime) >= boundaryMs).length,
      boundaryPositionCount: boundaryPositions.length,
      exchangeRealizedPnlUsdt: exchangeRealized,
      reconstructedWeekPnlUsdt: weekPnl,
      verifiedThroughAt: new Date(endMs).toISOString(),
      createdAt: new Date().toISOString()
    },
    summary: {
      exchangeRealizedPnlUsdt: exchangeRealized,
      boundaryUnrealizedPnlUsdt: Number(boundaryUnrealized.toFixed(8)),
      currentUnrealizedPnlUsdt: Number(currentUnrealized.toFixed(8)),
      reconstructedWeekPnlUsdt: weekPnl,
      externalCashFlowUsdt: Number(externalCashFlow.toFixed(8)),
      billCount: usedBills.filter((row) => Number(row.ts) >= boundaryMs).length,
      spanningPositionCount: spanning.length,
      evidenceHash
    }
  };
}

export async function backfillOkxRollingAccountingBaseline(input = {}, options = {}) {
  const boundaryMs = Number(input.boundaryMs);
  const endMs = Number(input.endMs);
  const currentSnapshot = input.currentSnapshot || {};
  if (!Number.isFinite(boundaryMs) || !Number.isFinite(endMs)) return { ok: false, reason: "history_window_invalid" };
  assertActive(options);
  const history = await fetchOkxPositionHistoryForAccounting({ ...options, boundaryMs });
  if (!history.complete) return { ok: false, reason: history.reason, error: history.error || null };
  const spanning = history.rows.filter((row) => Number(row.cTime) < boundaryMs && Number(row.uTime) >= boundaryMs);
  const currentSpanning = (currentSnapshot.positions || []).filter((row) => Number(row.cTime || row.createdAt) < boundaryMs && positionQuantity(row) > QUANTITY_TOLERANCE);
  const openingTimes = [...spanning.map((row) => Number(row.cTime)), ...currentSpanning.map((row) => Number(row.cTime || row.createdAt))].filter(Number.isFinite);
  const historyBeginMs = Math.min(boundaryMs, ...(openingTimes.length ? openingTimes : [boundaryMs])) - 60_000;
  if (endMs - historyBeginMs > MAX_OKX_HISTORY_MS) return { ok: false, reason: "spanning_position_exceeds_okx_history_window" };
  const bills = await fetchOkxBillsForAccounting({ ...options, beginMs: historyBeginMs, endMs });
  if (!bills.complete) return { ok: false, reason: bills.reason, error: bills.error || null };

  const boundaryInstruments = new Set();
  const temporaryState = new Map();
  for (const bill of bills.rows) {
    if (Number(bill.ts) >= boundaryMs) break;
    if (String(bill.type) !== "2") continue;
    const applied = applyTradeToState(temporaryState, bill);
    if (!applied.ok) return { ok: false, ...applied };
  }
  for (const row of temporaryState.values()) if (row.quantity > QUANTITY_TOLERANCE) boundaryInstruments.add(row.instId);
  const marks = new Map();
  const specs = new Map();
  const markFetcher = options.fetchBoundaryMarkPrice || fetchOkxBoundaryMarkPrice;
  const specFetcher = options.fetchContractSpec || okxContractSpec;
  for (const instId of boundaryInstruments) {
    assertActive(options);
    const [mark, spec] = await Promise.all([
      markFetcher(instId, boundaryMs, options),
      specFetcher(instId)
    ]);
    assertActive(options);
    marks.set(instId, mark);
    if (spec) specs.set(instId, spec);
  }
  return buildOkxHistoricalAccountingBaseline({
    ...input,
    bills: bills.rows,
    positionsHistory: history.rows,
    markPrices: marks,
    contractSpecs: specs
  });
}
