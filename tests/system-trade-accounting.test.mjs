import assert from "node:assert/strict";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { refreshAccounting } from "../server/accounting.mjs";
import { rollingAccountingBoundary } from "../server/accountingHistory.mjs";
import { businessDayStartMs } from "../server/businessTime.mjs";
import { systemRealizedPnlSince, systemUnrealizedPnl } from "../server/systemTradeAccounting.mjs";

const originalApiKey = process.env.OKX_API_KEY;
process.env.OKX_API_KEY = "system-accounting-key";

const fingerprint = crypto.createHash("sha256")
  .update(process.env.OKX_API_KEY)
  .digest("hex")
  .slice(0, 16);
const now = Date.UTC(2026, 7, 22, 2, 0, 0);
const dayStart = businessDayStartMs(now, "Asia/Shanghai");
const weekStart = rollingAccountingBoundary(now);
const iso = (value) => new Date(value).toISOString();

function attribution(executionOrder, exitMode = null) {
  return {
    schemaVersion: 1,
    scope: "system",
    origin: exitMode === "manual_exit" ? "external_exchange" : "execution_engine",
    exitMode,
    executionOrderId: executionOrder.id,
    planId: executionOrder.planId,
    method: exitMode === "manual_exit" ? "deterministic_manual_exit" : "execution_writer",
    evidence: { accountId: executionOrder.accountId, environment: executionOrder.environment }
  };
}

function systemFill(executionOrder, values = {}) {
  const fill = {
    id: values.id,
    kind: values.kind,
    executionOrderId: executionOrder.id,
    planId: executionOrder.planId,
    tradePlanId: executionOrder.planId,
    exchange: "OKX",
    accountId: executionOrder.accountId,
    environment: executionOrder.environment,
    symbol: executionOrder.symbol,
    direction: executionOrder.direction,
    quantity: values.quantity ?? 1,
    feeUsdt: values.feeUsdt ?? 0,
    estimatedFee: values.estimatedFee ?? false,
    exchangeFilledAt: iso(values.at),
    createdAt: iso(values.at),
    realizedPnl: values.realizedPnl,
    fundingFeeUsdt: values.fundingFeeUsdt,
    fundingReconciled: values.fundingReconciled,
    tradeAttribution: attribution(executionOrder, values.exitMode ?? (values.kind === "close" ? "system_exit" : null))
  };
  return fill;
}

function manualFill(values = {}) {
  return {
    id: values.id,
    kind: values.kind,
    exchange: "OKX",
    accountId: "account-a",
    environment: "production",
    symbol: values.symbol || "ETH/USDT",
    direction: values.direction || "long",
    quantity: values.quantity ?? 1,
    feeUsdt: values.feeUsdt,
    estimatedFee: values.estimatedFee,
    exchangeFilledAt: iso(values.at),
    createdAt: iso(values.at),
    realizedPnl: values.realizedPnl,
    fundingFeeUsdt: values.fundingFeeUsdt,
    fundingReconciled: values.fundingReconciled
  };
}

function systemBaseline(kind, boundaryAt, systemUnrealizedPnlUsdt = 0) {
  return {
    kind,
    boundaryAt: iso(boundaryAt),
    observedAt: iso(boundaryAt),
    accountId: "account-a",
    apiKeyFingerprint: fingerprint,
    environment: "production",
    equityUsdt: 1_000,
    pnlScope: "system_trades_only",
    provenanceSchemaVersion: 1,
    systemUnrealizedPnlUsdt,
    pnlMethod: "system_fills_plus_system_upl_change",
    attributionEvidenceHash: "a".repeat(64)
  };
}

function baseDb() {
  const closed = {
    id: "exec-closed", planId: "plan-closed", status: "closed", exchange: "OKX",
    accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long",
    filledQuantity: 1, entryFilledAt: iso(dayStart + 1_000)
  };
  const open = {
    id: "exec-open", planId: "plan-open", status: "protecting", exchange: "OKX",
    accountId: "account-a", environment: "production", symbol: "SUI/USDT", direction: "long",
    filledQuantity: 1, entryFilledAt: iso(dayStart + 4_000)
  };
  const fills = [
    systemFill(closed, { id: "system-entry-closed", kind: "entry", at: dayStart + 1_000, feeUsdt: 1 }),
    systemFill(closed, { id: "system-close", kind: "close", at: dayStart + 2_000, feeUsdt: 2, realizedPnl: 10, fundingFeeUsdt: -3, fundingReconciled: true, exitMode: "manual_exit" }),
    systemFill(open, { id: "system-entry-open", kind: "entry", at: dayStart + 4_000, feeUsdt: 1 }),
    manualFill({ id: "manual-entry", kind: "entry", at: dayStart + 5_000 }),
    manualFill({ id: "manual-close", kind: "close", at: dayStart + 6_000, realizedPnl: -100 })
  ];
  return {
    meta: {}, auditLogs: [], traces: [], riskIncidents: [], accountingAnchors: [], reviews: [],
    system: { businessTimeZone: "Asia/Shanghai", autonomyEnabled: true },
    portfolio: {
      totalEquityUsdt: 1_000,
      availableMarginUsdt: 400,
      systemAccountingBaselines: {
        daily: systemBaseline("daily", dayStart),
        rolling_168h: systemBaseline("rolling_168h", weekStart)
      }
    },
    mandates: [{ id: "mandate", status: "active", validUntil: "2099-01-01T00:00:00.000Z", maxDailyLossPct: 5 }],
    exchangeAccounts: [{ id: "account-a", exchange: "OKX", readEnabled: true, tradeEnabled: false, apiKeyFingerprint: fingerprint }],
    executionOrders: [closed, open],
    tradePlans: [closed, open].map((execution) => ({
      id: execution.planId, exchange: execution.exchange, accountId: execution.accountId,
      environment: execution.environment, symbol: execution.symbol, direction: execution.direction
    })),
    fills,
    positions: [
      {
        id: "system-position", source: "exchange_rest", exchange: "OKX", accountId: "account-a",
        apiKeyFingerprint: fingerprint, environment: "production", symbol: "SUI/USDT", direction: "long",
        coinSize: 1, size: 10, entry: 1, mark: 1.1, pnl: 5, rawSyncedAt: iso(now - 1_000)
      },
      {
        id: "manual-position", source: "exchange_rest", exchange: "OKX", accountId: "account-a",
        apiKeyFingerprint: fingerprint, environment: "production", symbol: "ETH/USDT", direction: "long",
        coinSize: 1, size: 1, entry: 100, mark: 50, pnl: -50, rawSyncedAt: iso(now - 1_000)
      }
    ],
    markets: [],
    accountSnapshots: [{
      id: "current", status: "ok", exchange: "OKX", accountId: "account-a", apiKeyFingerprint: fingerprint,
      environment: "production", createdAt: iso(now - 1_000), totalEquityUsdt: 1_000,
      positions: [
        { instId: "SUI-USDT-SWAP", posSide: "long", pos: "10", coinSize: 1, upl: "5" },
        { instId: "ETH-USDT-SWAP", posSide: "long", pos: "1", coinSize: 1, upl: "-50" }
      ]
    }]
  };
}

test("manual realized PnL and incomplete manual financial facts do not affect system budgets", () => {
  const db = baseDb();
  const result = refreshAccounting(db, { nowMs: now });

  assert.equal(result.todayPnl, 8, "system net realized 3 plus system UPL 5");
  assert.equal(db.portfolio.weekPnl, 8);
  assert.equal(db.portfolio.realizedPnlToday, 3);
  assert.equal(db.portfolio.pendingTradeFinancialFactsToday, 0);
  assert.equal(db.system.remainingDailyLossUsdt, 50);
  assert.equal(db.portfolio.pnlScope, "system_trades_only");
});

test("system realized accounting counts fees, funding, and an attributed manual exit exactly once", () => {
  const db = baseDb();
  assert.deepEqual(systemRealizedPnlSince(db, dayStart, now, {
    binding: { accountId: "account-a", environment: "production", exchange: "OKX" }
  }), {
    value: 3,
    knownTotal: 3,
    reconciled: 5,
    pending: 0,
    total: 3,
    pendingFacts: [],
    conflicts: []
  });

  const manual = db.fills.find((fill) => fill.id === "manual-close");
  manual.realizedPnl = 500;
  assert.equal(systemRealizedPnlSince(db, dayStart, now).value, 3);
  manual.realizedPnl = -500;
  assert.equal(systemRealizedPnlSince(db, dayStart, now).value, 3);
});

test("duplicate system trade evidence is counted once and conflicting evidence fails closed", () => {
  const db = baseDb();
  const close = db.fills.find((fill) => fill.id === "system-close");
  close.exchangeTradeId = "system-close-trade";
  db.fills.push({ ...structuredClone(close), id: "system-close-echo" });

  const deduped = systemRealizedPnlSince(db, dayStart, now);
  assert.equal(deduped.value, 3);
  assert.equal(deduped.pending, 0);
  assert.equal(deduped.total, 3);

  db.fills.find((fill) => fill.id === "system-close-echo").realizedPnl = 999;
  const conflicted = systemRealizedPnlSince(db, dayStart, now);
  assert.equal(conflicted.pending, 1);
  assert.equal(conflicted.conflicts[0].reason, "system_fill_financial_evidence_conflict");
  assert.equal(refreshAccounting(db, { nowMs: now }).todayPnl, null);
});

test("account-wide UPL stays visible while only exact managed UPL enters system PnL", () => {
  const db = baseDb();
  const positionsBefore = structuredClone(db.positions);
  refreshAccounting(db, { nowMs: now });

  assert.equal(db.portfolio.unrealizedPnl, -45, "operator display remains account-wide");
  assert.equal(db.portfolio.systemUnrealizedPnl, 5);
  assert.equal(db.portfolio.availableMarginUsdt, 400, "manual margin remains part of account capacity");
  assert.equal(db.portfolio.totalEquityUsdt, 1_000, "total account equity remains the denominator");
  assert.deepEqual(db.positions, positionsBefore, "account exposure evidence remains unchanged");

  db.positions.find((position) => position.id === "manual-position").pnl = 50;
  refreshAccounting(db, { nowMs: now });
  assert.equal(db.portfolio.unrealizedPnl, 55);
  assert.equal(db.portfolio.systemUnrealizedPnl, 5);
  assert.equal(db.portfolio.todayPnl, 8);
});

test("system financial evidence remains fail-closed", () => {
  const db = baseDb();
  const close = db.fills.find((fill) => fill.id === "system-close");
  close.fundingReconciled = false;
  close.fundingFeeUsdt = null;

  const result = refreshAccounting(db, { nowMs: now });
  assert.equal(result.todayPnl, null);
  assert.ok(db.portfolio.pendingTradeFinancialFactsToday > 0);
  assert.deepEqual(db.portfolio.pendingSystemRealizedFactsToday.map((row) => row.reason), ["close_funding_unresolved"]);
  assert.equal(db.portfolio.pendingSystemRealizedFactsToday[0].fillId, "system-close");
  assert.equal(db.system.reduceOnlyMode, true);
});

test("a stale manual position does not block system accounting", () => {
  const db = baseDb();
  const manual = db.positions.find((position) => position.id === "manual-position");
  manual.rawSyncedAt = iso(now - 24 * 60 * 60_000);
  delete manual.pnl;

  const result = refreshAccounting(db, { nowMs: now });
  assert.equal(result.todayPnl, 8);
  assert.equal(db.portfolio.unrealizedPnl, null, "account-wide display remains explicitly incomplete");
  assert.equal(db.portfolio.systemUnrealizedPnl, 5);
  assert.equal(db.portfolio.pendingTradeFinancialFactsToday, 0);
});

test("mixed manual and managed quantity in one exchange slot fails system UPL closed", () => {
  const db = baseDb();
  db.positions.find((position) => position.id === "system-position").coinSize = 2;

  const result = refreshAccounting(db, { nowMs: now });
  assert.equal(result.todayPnl, null);
  assert.equal(db.portfolio.systemUnrealizedPnl, null);
  assert.ok(db.portfolio.pendingSystemUnrealizedPositions.some((row) => row.reason === "managed_position_quantity_mismatch"));
  assert.equal(db.system.reduceOnlyMode, true);
});

test("corrected authoritative quantity recovers system UPL without sticky red state", () => {
  const db = baseDb();
  const position = db.positions.find((row) => row.id === "system-position");
  position.coinSize = 2;
  assert.equal(refreshAccounting(db, { nowMs: now }).todayPnl, null);

  position.coinSize = 1;
  const recovered = refreshAccounting(db, { nowMs: now + 1_000 });
  assert.equal(recovered.todayPnl, 8);
  assert.equal(db.portfolio.systemUnrealizedPnl, 5);
});

test("fill binding can complete a legacy execution binding without admitting another account", () => {
  const db = baseDb();
  delete db.executionOrders.find((row) => row.id === "exec-open").environment;
  const foreign = {
    id: "foreign-exec", planId: "foreign-plan", status: "protecting", exchange: "OKX", accountId: "account-b",
    environment: "production", symbol: "XRP/USDT", direction: "long", filledQuantity: 1,
    entryFilledAt: iso(dayStart + 10_000)
  };
  db.executionOrders.push(foreign);
  db.tradePlans.push({ id: foreign.planId, exchange: "OKX", accountId: foreign.accountId, environment: foreign.environment, symbol: foreign.symbol, direction: foreign.direction });
  db.fills.push(systemFill(foreign, { id: "foreign-entry", kind: "entry", at: dayStart + 10_000, feeUsdt: 0 }));

  const projected = systemUnrealizedPnl(db, {
    now,
    binding: { accountId: "account-a", environment: "production", exchange: "OKX" }
  });
  assert.equal(projected.complete, true);
  assert.equal(projected.knownTotal, 5);
});

test("legacy account-wide anchors cannot authorize a system-only baseline", () => {
  const db = baseDb();
  db.portfolio.systemAccountingBaselines = {};
  db.accountSnapshots = db.accountSnapshots.filter((row) => row.id === "current");
  db.accountingAnchors.push({
    id: "legacy-day", status: "ok", exchange: "OKX", accountId: "account-a", apiKeyFingerprint: fingerprint,
    environment: "production", createdAt: iso(dayStart), totalEquityUsdt: 1_000, unrealizedPnlUsdt: 0
  });

  const result = refreshAccounting(db, { nowMs: now });
  assert.equal(result.todayPnl, null);
  assert.equal(db.portfolio.dailyBaselineStatus, "system_period_start_anchor_missing");
  assert.equal(db.portfolio.systemAccountingBaselines.daily, undefined);
});

test("an exact boundary snapshot creates a versioned system-only baseline", () => {
  const db = baseDb();
  db.portfolio.systemAccountingBaselines = {};
  db.accountSnapshots.push({
    id: "day-system-boundary", status: "ok", exchange: "OKX", accountId: "account-a", apiKeyFingerprint: fingerprint,
    environment: "production", createdAt: iso(dayStart), totalEquityUsdt: 1_000,
    positions: [{ instId: "SUI-USDT-SWAP", posSide: "long", pos: "10", coinSize: 1, upl: "2" }]
  });
  db.accountSnapshots.push({
    id: "week-system-boundary", status: "ok", exchange: "OKX", accountId: "account-a", apiKeyFingerprint: fingerprint,
    environment: "production", createdAt: iso(weekStart), totalEquityUsdt: 1_000, positions: []
  });
  const openEntry = db.fills.find((fill) => fill.id === "system-entry-open");
  openEntry.exchangeFilledAt = iso(dayStart - 60_000);
  openEntry.createdAt = iso(dayStart - 60_000);
  db.executionOrders.find((row) => row.id === "exec-open").entryFilledAt = iso(dayStart - 60_000);

  refreshAccounting(db, { nowMs: now });
  const baseline = db.portfolio.systemAccountingBaselines.daily;
  assert.equal(baseline.pnlScope, "system_trades_only");
  assert.equal(baseline.provenanceSchemaVersion, 1);
  assert.equal(baseline.systemUnrealizedPnlUsdt, 2);
  assert.equal(baseline.pnlMethod, "system_fills_plus_system_upl_change");
  assert.match(baseline.attributionEvidenceHash, /^[a-f0-9]{64}$/);
  assert.equal(db.portfolio.todayPnl, 7, "post-boundary realized 4 plus current UPL 5 minus boundary UPL 2");
});

test("post-boundary fill conflicts cannot invalidate an earlier exact position baseline", () => {
  const db = baseDb();
  const execution = db.executionOrders.find((row) => row.id === "exec-open");
  const entry = db.fills.find((fill) => fill.id === "system-entry-open");
  execution.entryFilledAt = iso(dayStart - 60_000);
  entry.exchangeFilledAt = iso(dayStart - 60_000);
  entry.createdAt = iso(dayStart - 60_000);

  const laterClose = systemFill(execution, {
    id: "post-boundary-close",
    kind: "close",
    at: dayStart + 60_000,
    feeUsdt: 0,
    realizedPnl: 1,
    fundingFeeUsdt: 0,
    fundingReconciled: true,
    exitMode: "system_exit"
  });
  laterClose.exchangeTradeId = "post-boundary-trade";
  db.fills.push(laterClose, {
    ...structuredClone(laterClose),
    id: "post-boundary-conflicting-echo",
    realizedPnl: 2
  });

  const boundary = systemUnrealizedPnl(db, {
    atMs: dayStart,
    binding: { accountId: "account-a", environment: "production", exchange: "OKX" },
    snapshot: {
      exchange: "OKX",
      accountId: "account-a",
      environment: "production",
      positions: [{ instId: "SUI-USDT-SWAP", posSide: "long", pos: "10", coinSize: 1, upl: "2" }]
    }
  });

  assert.equal(boundary.complete, true);
  assert.equal(boundary.knownTotal, 2);
  assert.equal(boundary.pendingPositions.length, 0);
});

test("mixed quantity at a boundary cannot create a system-only baseline", () => {
  const db = baseDb();
  db.portfolio.systemAccountingBaselines = {};
  const openEntry = db.fills.find((fill) => fill.id === "system-entry-open");
  openEntry.exchangeFilledAt = iso(dayStart - 60_000);
  openEntry.createdAt = iso(dayStart - 60_000);
  db.executionOrders.find((row) => row.id === "exec-open").entryFilledAt = iso(dayStart - 60_000);
  db.accountSnapshots.push({
    id: "mixed-day-boundary", status: "ok", exchange: "OKX", accountId: "account-a", apiKeyFingerprint: fingerprint,
    environment: "production", createdAt: iso(dayStart), totalEquityUsdt: 1_000,
    positions: [{ instId: "SUI-USDT-SWAP", posSide: "long", pos: "20", coinSize: 2, upl: "4" }]
  });

  const result = refreshAccounting(db, { nowMs: now });
  assert.equal(result.todayPnl, null);
  assert.equal(db.portfolio.dailyBaselineStatus, "managed_position_quantity_mismatch");
  assert.equal(db.portfolio.systemAccountingBaselines.daily, undefined);
});

test("first system-only anchor migration stays bounded at retained production history size", () => {
  const db = baseDb();
  db.portfolio.systemAccountingAnchors = [];
  db.accountSnapshots = Array.from({ length: 500 }, (_, index) => ({
    ...structuredClone(db.accountSnapshots[0]),
    id: `snapshot-${index}`,
    createdAt: iso(now - (500 - index) * 5 * 60_000)
  }));
  const manualTemplate = manualFill({
    id: "manual-history-template",
    kind: "entry",
    at: dayStart - 24 * 60 * 60_000,
    feeUsdt: 0,
    estimatedFee: false
  });
  while (db.fills.length < 204) {
    const index = db.fills.length;
    db.fills.push({
      ...structuredClone(manualTemplate),
      id: `manual-history-${index}`,
      exchangeTradeId: `manual-history-trade-${index}`,
      createdAt: iso(dayStart - index * 1_000),
      exchangeFilledAt: iso(dayStart - index * 1_000)
    });
  }
  const retainedFills = db.fills;
  let fillCollectionReads = 0;
  Object.defineProperty(db, "fills", {
    configurable: true,
    get() {
      fillCollectionReads += 1;
      return retainedFills;
    },
    set(value) {
      throw new Error(`unexpected fills replacement with ${value?.length ?? "unknown"} rows`);
    }
  });

  const startedAt = performance.now();
  refreshAccounting(db, { nowMs: now });
  const elapsedMs = performance.now() - startedAt;

  assert.ok(elapsedMs < 5_000, `system accounting refresh took ${Math.round(elapsedMs)}ms`);
  assert.ok(fillCollectionReads < 100,
    `refresh rescanned the complete fill collection ${fillCollectionReads} times`);
  assert.equal(db.accountSnapshots.length, 500);
  assert.equal(db.fills.length, 204);
});

test.after(() => {
  if (originalApiKey === undefined) delete process.env.OKX_API_KEY;
  else process.env.OKX_API_KEY = originalApiKey;
});
