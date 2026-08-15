import { latestSuccessfulAccountSnapshot } from "./store.mjs";
import { validateOkxCredentialBinding } from "./exchangeConnector.mjs";
import { SAME_SYMBOL_EXPOSURE_STATES } from "./executionStates.mjs";

const OPEN_ENTRY_STATES = SAME_SYMBOL_EXPOSURE_STATES;

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function snapshotAccountFacts(snapshot) {
  const balance = snapshot?.balances?.[0] || {};
  const usdt = (balance.details || []).find((item) => String(item.ccy || "").toUpperCase() === "USDT") || {};
  const equity = finite(balance.totalEq ?? snapshot?.totalEquityUsdt);
  const available = finite(usdt.availEq ?? usdt.availBal ?? snapshot?.availableMarginUsdt);
  return {
    equity: equity != null && equity > 0 ? equity : null,
    availableMargin: available != null && available >= 0
      ? (equity != null && equity > 0 ? Math.min(available, equity) : available)
      : null
  };
}

function pendingEntryMargin(db, snapshotAt, excludePlanId = null) {
  let total = 0;
  const items = [];
  for (const order of db.executionOrders || []) {
    if (!OPEN_ENTRY_STATES.has(String(order.status || "").toLowerCase())) continue;
    if (excludePlanId && order.planId === excludePlanId) continue;
    const createdAt = new Date(order.createdAt || 0).getTime();
    // The latest private-account snapshot already contains frozen margin for orders
    // that existed before it. Only reserve local entries created after that snapshot.
    if (Number.isFinite(snapshotAt) && snapshotAt > 0 && Number.isFinite(createdAt) && createdAt > 0 && createdAt <= snapshotAt) continue;
    const explicitNotional = finite(order.notionalUsdt);
    const derivedNotional = (finite(order.quantity) ?? finite(order.size)) != null && (finite(order.entryPrice) ?? finite(order.price)) != null
      ? Math.abs((finite(order.quantity) ?? finite(order.size)) * (finite(order.entryPrice) ?? finite(order.price)))
      : null;
    const notional = Math.abs(explicitNotional ?? derivedNotional ?? 0);
    const leverage = Math.max(1, finite(order.leverage) || 1);
    if (!(notional > 0)) continue;
    const reserved = notional / leverage;
    total += reserved;
    items.push({ id: order.id, planId: order.planId, symbol: order.symbol, reservedMarginUsdt: reserved });
  }
  return { total, items };
}

export function accountSnapshotFreshness(snapshot, options = {}) {
  const requestedMaxAgeMs = finite(options.maxAgeMs ?? process.env.MAX_ACCOUNT_SNAPSHOT_AGE_MS);
  const requestedFutureSkewMs = finite(options.maxFutureSkewMs ?? process.env.MAX_ACCOUNT_SNAPSHOT_FUTURE_SKEW_MS);
  const maxAgeMs = requestedMaxAgeMs != null && requestedMaxAgeMs >= 0 ? requestedMaxAgeMs : 10 * 60_000;
  const maxFutureSkewMs = requestedFutureSkewMs != null && requestedFutureSkewMs >= 0 ? requestedFutureSkewMs : 30_000;
  const now = Number(options.now ?? Date.now());
  const snapshotAt = snapshot ? new Date(snapshot.createdAt || 0).getTime() : NaN;
  const rawAgeMs = Number.isFinite(snapshotAt) && Number.isFinite(now) ? now - snapshotAt : Infinity;
  if (!snapshot) return { ok: false, error: "account_snapshot_required", snapshotAt, rawAgeMs, ageMs: Infinity, maxAgeMs, maxFutureSkewMs };
  if (!Number.isFinite(rawAgeMs)) return { ok: false, error: "account_snapshot_stale", snapshotAt, rawAgeMs, ageMs: Infinity, maxAgeMs, maxFutureSkewMs };
  if (rawAgeMs < -maxFutureSkewMs) return { ok: false, error: "account_snapshot_time_invalid", snapshotAt, rawAgeMs, ageMs: rawAgeMs, maxAgeMs, maxFutureSkewMs };
  const ageMs = Math.max(0, rawAgeMs);
  if (ageMs > maxAgeMs) return { ok: false, error: "account_snapshot_stale", snapshotAt, rawAgeMs, ageMs, maxAgeMs, maxFutureSkewMs };
  return { ok: true, snapshotAt, rawAgeMs, ageMs, maxAgeMs, maxFutureSkewMs };
}

// Authoritative capacity shared by sizing, the final order guard and the UI.
// It deliberately treats available margin and the configured utilization ceiling
// as separate limits; the smaller remaining capacity wins.
export function accountMarginCapacity(db, options = {}) {
  const live = options.live ?? db.system?.liveTradingEnabled === true;
  const exchange = String(options.exchange || "OKX").toUpperCase();
  const accountId = options.accountId || null;
  const snapshot = latestSuccessfulAccountSnapshot(db, { exchange, accountId });
  if (live && exchange === "OKX") {
    const binding = validateOkxCredentialBinding(db, { accountId: accountId || snapshot?.accountId, snapshot });
    if (!binding.ok) return { ok: false, error: binding.reason, source: "credential_binding", snapshotId: snapshot?.id || null };
  }
  const freshness = accountSnapshotFreshness(snapshot, options);
  const { snapshotAt, ageMs, maxAgeMs } = freshness;
  const snapshotFacts = snapshotAccountFacts(snapshot);

  let equity = snapshotFacts.equity;
  let availableMargin = snapshotFacts.availableMargin;
  let source = "exchange_snapshot";
  if (!live && (equity == null || availableMargin == null)) {
    const portfolioEquity = finite(db.portfolio?.totalEquityUsdt);
    const portfolioAvailable = finite(db.portfolio?.availableMarginUsdt);
    equity = equity ?? (portfolioEquity != null && portfolioEquity > 0 ? portfolioEquity : null);
    availableMargin = availableMargin ?? (portfolioAvailable != null && portfolioAvailable >= 0
      ? portfolioAvailable
      : equity);
    source = snapshot ? "snapshot_with_portfolio_fallback" : "portfolio_fallback";
  }

  if (live && !freshness.ok) {
    return { ok: false, error: freshness.error, source, snapshotId: snapshot?.id || null, ageMs, rawAgeMs: freshness.rawAgeMs, maxAgeMs, maxFutureSkewMs: freshness.maxFutureSkewMs };
  }
  if (!(equity > 0)) return { ok: false, error: "account_equity_unavailable", source, snapshotId: snapshot?.id || null, ageMs, maxAgeMs };
  if (!(availableMargin >= 0)) return { ok: false, error: "available_margin_unavailable", source, snapshotId: snapshot?.id || null, ageMs, maxAgeMs };

  const mandate = options.mandate || null;
  const maxMarginUtilizationPct = Number(mandate?.maxMarginUtilizationPct ?? mandate?.max_margin_utilization_pct ?? 70);
  const utilizationFraction = Math.min(1, Math.max(0, maxMarginUtilizationPct / 100));
  const usedMargin = Math.max(0, equity - availableMargin);
  const pending = pendingEntryMargin(db, snapshotAt, options.excludePlanId);
  const remainingByAvailability = Math.max(0, availableMargin - pending.total);
  const remainingByUtilization = Math.max(0, equity * utilizationFraction - usedMargin - pending.total);
  const remainingMargin = Math.min(remainingByAvailability, remainingByUtilization);
  const leverage = Math.max(1, finite(options.leverage) || 1);
  const feeBufferRate = Math.max(0, finite(options.feeBufferRate ?? process.env.EXECUTION_MARGIN_FEE_BUFFER_RATE) ?? 0.001);
  const marginPerNotional = 1 / leverage + feeBufferRate;
  const maxNotional = remainingMargin / marginPerNotional;

  return {
    ok: true,
    source,
    snapshotId: snapshot?.id || null,
    snapshotAt: Number.isFinite(snapshotAt) ? new Date(snapshotAt).toISOString() : null,
    ageMs,
    maxAgeMs,
    equity,
    availableMargin,
    usedMargin,
    currentUtilizationPct: equity > 0 ? usedMargin / equity * 100 : null,
    pendingMargin: pending.total,
    pendingOrders: pending.items,
    maxMarginUtilizationPct,
    remainingByAvailability,
    remainingByUtilization,
    remainingMargin,
    leverage,
    feeBufferRate,
    maxNotional
  };
}

export function projectedMarginUsage(capacity, notional, leverage = capacity?.leverage) {
  if (!capacity?.ok) return { ok: false, error: capacity?.error || "account_capacity_unavailable" };
  const safeNotional = Math.max(0, finite(notional) || 0);
  const safeLeverage = Math.max(1, finite(leverage) || 1);
  const initialMargin = safeNotional / safeLeverage;
  const feeBuffer = safeNotional * Math.max(0, finite(capacity.feeBufferRate) || 0);
  const incrementalMargin = initialMargin + feeBuffer;
  const projectedUsedMargin = capacity.usedMargin + capacity.pendingMargin + incrementalMargin;
  const projectedUtilizationPct = capacity.equity > 0 ? projectedUsedMargin / capacity.equity * 100 : null;
  return {
    ok: incrementalMargin <= capacity.remainingMargin + 1e-9,
    initialMargin,
    feeBuffer,
    incrementalMargin,
    projectedUsedMargin,
    projectedAvailableMargin: Math.max(0, capacity.availableMargin - capacity.pendingMargin - incrementalMargin),
    projectedUtilizationPct,
    maxMarginUtilizationPct: capacity.maxMarginUtilizationPct
  };
}
