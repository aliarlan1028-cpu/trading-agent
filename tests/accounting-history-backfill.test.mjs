import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  buildOkxHistoricalAccountingBaseline,
  fetchOkxBillsForAccounting,
  fetchOkxPositionHistoryForAccounting,
  ACCOUNTING_BOUNDARY_BUCKET_MS,
  rollingAccountingBoundary
} from "../server/accountingHistory.mjs";
import { refreshAccounting, refreshAccountingAuthoritatively } from "../server/accounting.mjs";
import { businessDayStartMs } from "../server/businessTime.mjs";

const originalKey = process.env.OKX_API_KEY;
const originalDemo = process.env.OKX_DEMO_TRADING;
process.env.OKX_API_KEY = "accounting-history-key";
process.env.OKX_DEMO_TRADING = "false";
const fingerprint = crypto.createHash("sha256").update(process.env.OKX_API_KEY).digest("hex").slice(0, 16);

function bill(overrides = {}) {
  return {
    billId: String(overrides.billId || "1"),
    ts: String(overrides.ts || 1),
    type: "2",
    subType: "3",
    instType: "SWAP",
    instId: "ADA-USDT-SWAP",
    ccy: "USDT",
    sz: "2",
    px: "100",
    pnl: "0",
    fee: "-1",
    balChg: "-1",
    ...overrides
  };
}

function historicalFixture(overrides = {}) {
  const boundaryMs = 1_000_000;
  const endMs = 2_000_000;
  const bills = [
    bill({ billId: "1", ts: String(boundaryMs - 1000), subType: "3", px: "100", pnl: "0", fee: "-1" }),
    bill({ billId: "2", ts: String(boundaryMs + 1000), type: "8", subType: "173", px: "95", pnl: "-1", fee: "0", balChg: "-1" }),
    bill({ billId: "3", ts: String(boundaryMs + 2000), subType: "5", px: "90", pnl: "-20", fee: "-1", balChg: "-21" })
  ];
  const base = {
    boundaryMs,
    endMs,
    currentEquity: 100,
    binding: { accountId: "okx-main", apiKeyFingerprint: fingerprint, environment: "production" },
    currentSnapshot: {
      id: "current", status: "ok", accountId: "okx-main", apiKeyFingerprint: fingerprint,
      environment: "production", positions: []
    },
    localRealizedState: { value: -22, pending: 0 },
    bills,
    positionsHistory: [{
      posId: "position-1", instId: "ADA-USDT-SWAP", direction: "long",
      cTime: String(boundaryMs - 1000), uTime: String(boundaryMs + 2000), type: "2"
    }],
    markPrices: new Map([["ADA-USDT-SWAP", { complete: true, price: 95, observedAt: new Date(boundaryMs).toISOString() }]]),
    contractSpecs: new Map([["ADA-USDT-SWAP", { ctVal: 1, ctType: "linear", settleCcy: "USDT" }]]),
  };
  return { ...base, ...overrides, currentSnapshot: { ...base.currentSnapshot, ...(overrides.currentSnapshot || {}) } };
}

test("rolling accounting boundary is stable within one bucket and advances only by the bucket size", () => {
  const now = Date.UTC(2026, 7, 15, 1, 3, 12);
  assert.equal(rollingAccountingBoundary(now), rollingAccountingBoundary(now + 60_000));
  assert.equal(rollingAccountingBoundary(now + ACCOUNTING_BOUNDARY_BUCKET_MS), rollingAccountingBoundary(now) + ACCOUNTING_BOUNDARY_BUCKET_MS);
});

test("historical baseline removes pre-window UPL from a position that spans the rolling boundary", () => {
  const result = buildOkxHistoricalAccountingBaseline(historicalFixture());
  assert.equal(result.ok, true);
  assert.equal(result.summary.exchangeRealizedPnlUsdt, -22);
  assert.equal(result.summary.boundaryUnrealizedPnlUsdt, -10);
  assert.equal(result.summary.reconstructedWeekPnlUsdt, -12);
  assert.equal(result.baseline.equityUsdt, 112);
  assert.equal(result.baseline.pnlMethod, "okx_bills_plus_boundary_mark_to_market");
  assert.match(result.baseline.evidenceHash, /^[a-f0-9]{64}$/);
});

test("USDT transfers are isolated from trading PnL and retained as external cash flow", () => {
  const fixture = historicalFixture();
  fixture.bills.push(bill({
    billId: "4", ts: String(fixture.boundaryMs + 3000), type: "1", subType: "11",
    instType: "", instId: "", sz: "", px: "", pnl: "0", fee: "0", balChg: "10", from: "6", to: "18"
  }));
  const result = buildOkxHistoricalAccountingBaseline(fixture);
  assert.equal(result.ok, true);
  assert.equal(result.summary.externalCashFlowUsdt, 10);
  assert.equal(result.baseline.equityUsdt, 102);
});

test("unknown balance-changing bills fail closed instead of being treated as deposits or PnL", () => {
  const fixture = historicalFixture();
  fixture.bills.push(bill({ billId: "4", ts: String(fixture.boundaryMs + 3000), type: "7", subType: "9", instId: "", pnl: "0", fee: "0", balChg: "-0.5" }));
  const result = buildOkxHistoricalAccountingBaseline(fixture);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported_balance_changing_bill");
});

test("local and exchange realized PnL mismatch prevents a historical baseline", () => {
  const result = buildOkxHistoricalAccountingBaseline(historicalFixture({ localRealizedState: { value: -21, pending: 0 } }));
  assert.equal(result.ok, false);
  assert.equal(result.reason, "local_exchange_realized_pnl_mismatch");
});

test("missing boundary mark, malformed contract metadata, and current-position mismatch all fail closed", () => {
  const missingMark = buildOkxHistoricalAccountingBaseline(historicalFixture({ markPrices: new Map() }));
  assert.equal(missingMark.ok, false);
  assert.equal(missingMark.reason, "boundary_valuation_evidence_missing");

  const inverse = buildOkxHistoricalAccountingBaseline(historicalFixture({
    contractSpecs: new Map([["ADA-USDT-SWAP", { ctVal: 1, ctType: "inverse", settleCcy: "USD" }]])
  }));
  assert.equal(inverse.ok, false);
  assert.equal(inverse.reason, "inverse_contract_boundary_valuation_unsupported");

  const mismatch = buildOkxHistoricalAccountingBaseline(historicalFixture({
    currentSnapshot: { positions: [{ instId: "ADA-USDT-SWAP", pos: "1", posSide: "long", upl: "0" }] }
  }));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "current_position_reconstruction_mismatch");
});

test("the current snapshot must be bound to the same account, key fingerprint, and environment", () => {
  for (const currentSnapshot of [
    { accountId: "other" },
    { apiKeyFingerprint: "rotated" },
    { environment: "demo" },
    { status: "error" }
  ]) {
    const result = buildOkxHistoricalAccountingBaseline(historicalFixture({ currentSnapshot }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "current_snapshot_binding_mismatch");
  }
});

test("partial closes and funding are aggregated once across the rolling boundary", () => {
  const fixture = historicalFixture();
  fixture.bills = [
    bill({ billId: "1", ts: String(fixture.boundaryMs - 1000), subType: "3", sz: "3", px: "100", pnl: "0", fee: "-1" }),
    bill({ billId: "2", ts: String(fixture.boundaryMs + 1000), type: "8", subType: "173", sz: "", px: "", pnl: "-1", fee: "0", balChg: "-1" }),
    bill({ billId: "3", ts: String(fixture.boundaryMs + 2000), subType: "5", sz: "1", px: "95", pnl: "-5", fee: "-0.5", balChg: "-5.5" }),
    bill({ billId: "4", ts: String(fixture.boundaryMs + 3000), subType: "5", sz: "2", px: "90", pnl: "-20", fee: "-0.5", balChg: "-20.5" })
  ];
  fixture.positionsHistory[0].uTime = String(fixture.boundaryMs + 3000);
  fixture.localRealizedState = { value: -27, pending: 0 };
  const result = buildOkxHistoricalAccountingBaseline(fixture);
  assert.equal(result.ok, true);
  assert.equal(result.summary.exchangeRealizedPnlUsdt, -27);
  assert.equal(result.summary.boundaryUnrealizedPnlUsdt, -15);
  assert.equal(result.summary.reconstructedWeekPnlUsdt, -12);
});

test("bills pagination requires an exhausted final page and rejects unstable cursors", async () => {
  const calls = [];
  const pages = [
    { code: "0", data: [bill({ billId: "3", ts: "30" }), bill({ billId: "2", ts: "20" })] },
    { code: "0", data: [bill({ billId: "1", ts: "10" })] }
  ];
  const complete = await fetchOkxBillsForAccounting({
    beginMs: 1, endMs: 100, limit: 2,
    request: async (path) => { calls.push(path); return pages[calls.length - 1]; }
  });
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.rows.map((row) => row.billId), ["1", "2", "3"]);
  assert.match(calls[1], /after=2/);

  const unstable = await fetchOkxBillsForAccounting({
    beginMs: 1, endMs: 100, limit: 2, maxPages: 3,
    request: async () => ({ code: "0", data: [bill({ billId: "2" }), bill({ billId: "2" })] })
  });
  assert.equal(unstable.complete, false);
  assert.equal(unstable.reason, "okx_bills_pagination_unstable");

  const malformed = await fetchOkxBillsForAccounting({
    beginMs: 1, endMs: 100, request: async () => ({ code: "0", data: null })
  });
  assert.equal(malformed.complete, false);
  assert.equal(malformed.reason, "okx_bills_response_malformed");

  const conflict = await fetchOkxBillsForAccounting({
    beginMs: 1, endMs: 100, limit: 3,
    request: async () => ({ code: "0", data: [bill({ billId: "1", fee: "-1" }), bill({ billId: "1", fee: "-2" })] })
  });
  assert.equal(conflict.complete, false);
  assert.equal(conflict.reason, "billId_conflict");
});

test("position history paginates with uTime and stops only after covering the requested boundary", async () => {
  const calls = [];
  const result = await fetchOkxPositionHistoryForAccounting({
    boundaryMs: 100, limit: 2,
    request: async (path) => {
      calls.push(path);
      return calls.length === 1
        ? { code: "0", data: [{ posId: "p3", uTime: "300", type: "2" }, { posId: "p2", uTime: "200", type: "2" }] }
        : { code: "0", data: [{ posId: "p1", uTime: "90", type: "2" }, { posId: "p0", uTime: "80", type: "2" }] };
    }
  });
  assert.equal(result.complete, true);
  assert.equal(result.pages, 2);
  assert.match(calls[1], /after=200/);

  const malformed = await fetchOkxPositionHistoryForAccounting({
    boundaryMs: 100, request: async () => ({ code: "0", data: {} })
  });
  assert.equal(malformed.complete, false);
  assert.equal(malformed.reason, "okx_position_history_response_malformed");
});

test("OKX may reuse one posId across distinct position-history events", async () => {
  const rows = [
    { posId: "slot-long", uTime: "300", type: "2", instId: "ADA-USDT-SWAP", direction: "long", realizedPnl: "1" },
    { posId: "slot-long", uTime: "200", type: "2", instId: "ADA-USDT-SWAP", direction: "long", realizedPnl: "-1" }
  ];
  const accepted = await fetchOkxPositionHistoryForAccounting({
    boundaryMs: 250, limit: 100, request: async () => ({ code: "0", data: rows })
  });
  assert.equal(accepted.complete, true);
  assert.equal(accepted.rows.length, 2);

  const conflict = await fetchOkxPositionHistoryForAccounting({
    boundaryMs: 250, limit: 100,
    request: async () => ({ code: "0", data: [rows[0], { ...rows[0], realizedPnl: "999" }] })
  });
  assert.equal(conflict.complete, false);
  assert.equal(conflict.reason, "position_history_event_conflict");
});

test("task cancellation aborts pagination instead of persisting a partial history", async () => {
  const controller = new AbortController();
  await assert.rejects(fetchOkxBillsForAccounting({
    beginMs: 1,
    endMs: 100,
    limit: 2,
    signal: controller.signal,
    request: async () => {
      controller.abort();
      return { code: "0", data: [bill({ billId: "2" }), bill({ billId: "1" })] };
    }
  }), (error) => error?.name === "AbortError");
});

function integrationDb(nowMs) {
  const boundaryMs = rollingAccountingBoundary(nowMs);
  const dayStart = businessDayStartMs(nowMs, "Asia/Shanghai");
  const execution = {
    id: "execution", planId: "plan", status: "closed", exchange: "OKX", accountId: "okx-main",
    environment: "production", symbol: "ADA/USDT", direction: "long", filledQuantity: 1,
    entryFilledAt: new Date(boundaryMs - 1000).toISOString()
  };
  const attributed = (kind) => ({
    schemaVersion: 1, scope: "system", origin: "execution_engine", exitMode: kind === "close" ? "system_exit" : null,
    executionOrderId: execution.id, planId: execution.planId, method: "execution_writer",
    evidence: { accountId: execution.accountId, environment: execution.environment }
  });
  return {
    meta: {}, auditLogs: [], traces: [], riskIncidents: [], accountingAnchors: [], reviews: [],
    executionOrders: [execution],
    tradePlans: [{ id: execution.planId, exchange: execution.exchange, accountId: execution.accountId, environment: execution.environment, symbol: execution.symbol, direction: execution.direction }],
    system: { businessTimeZone: "Asia/Shanghai", autonomyEnabled: true, requestedOperatingMode: "full_auto" },
    portfolio: { totalEquityUsdt: 100 },
    mandates: [{ id: "mandate", status: "active", validUntil: "2099-01-01T00:00:00.000Z", maxDailyLossPct: 5 }],
    exchangeAccounts: [{ id: "okx-main", exchange: "OKX", readEnabled: true, tradeEnabled: true, apiKeyFingerprint: fingerprint }],
    positions: [], markets: [],
    accountSnapshots: [
      { id: "current", status: "ok", exchange: "OKX", accountId: "okx-main", apiKeyFingerprint: fingerprint, environment: "production", createdAt: new Date(nowMs - 1000).toISOString(), totalEquityUsdt: 100, positions: [] },
      { id: "day", status: "ok", exchange: "OKX", accountId: "okx-main", apiKeyFingerprint: fingerprint, environment: "production", createdAt: new Date(dayStart).toISOString(), totalEquityUsdt: 100, positions: [] }
    ],
    fills: [
      { id: "entry", kind: "entry", executionOrderId: execution.id, planId: execution.planId, tradePlanId: execution.planId, exchange: "OKX", accountId: execution.accountId, environment: execution.environment, symbol: execution.symbol, direction: execution.direction, quantity: 1, exchangeFilledAt: new Date(boundaryMs - 1000).toISOString(), feeUsdt: 1, estimatedFee: false, tradeAttribution: attributed("entry") },
      { id: "close", kind: "close", executionOrderId: execution.id, planId: execution.planId, tradePlanId: execution.planId, exchange: "OKX", accountId: execution.accountId, environment: execution.environment, symbol: execution.symbol, direction: execution.direction, quantity: 1, exchangeFilledAt: new Date(boundaryMs + 2000).toISOString(), createdAt: new Date(boundaryMs + 2000).toISOString(), realizedPnl: -20, feeUsdt: 1, estimatedFee: false, fundingFeeUsdt: -1, fundingReconciled: true, tradeAttribution: attributed("close") }
    ]
  };
}

test("account-wide historical backfill is retained as evidence but cannot authorize system PnL", async () => {
  const nowMs = Date.UTC(2026, 7, 15, 1, 3, 0);
  const boundaryMs = rollingAccountingBoundary(nowMs);
  const db = integrationDb(nowMs);
  const bills = [
    bill({ billId: "1", ts: String(boundaryMs - 1000), subType: "3", px: "100", pnl: "0", fee: "-1" }),
    bill({ billId: "2", ts: String(boundaryMs + 1000), type: "8", subType: "173", px: "95", pnl: "-1", fee: "0", balChg: "-1" }),
    bill({ billId: "3", ts: String(boundaryMs + 2000), subType: "5", px: "90", pnl: "-20", fee: "-1", balChg: "-21" })
  ];
  const positionHistory = [{ posId: "position-1", instId: "ADA-USDT-SWAP", direction: "long", cTime: String(boundaryMs - 1000), uTime: String(boundaryMs + 2000), type: "2" }];
  const request = async (path) => path.startsWith("/api/v5/account/positions-history")
    ? { code: "0", data: positionHistory }
    : { code: "0", data: bills };
  const result = await refreshAccountingAuthoritatively(db, {
    nowMs, forceHistoryBackfill: true, request,
    fetchBoundaryMarkPrice: async () => ({ complete: true, price: 95, observedAt: new Date(boundaryMs).toISOString() }),
    fetchContractSpec: async () => ({ ctVal: 1, ctType: "linear", settleCcy: "USDT" })
  });
  assert.equal(db.portfolio.weekBaselineStatus, "system_period_start_anchor_missing");
  assert.equal(db.portfolio.weekPnl, null);
  assert.equal(db.portfolio.pendingFinancialReconciliationWeek, 1);
  assert.equal(db.portfolio.accountingHistoryBackfill.status, "reconciled_account_evidence_only");
  assert.equal(db.portfolio.accountingHistoryBackfill.reason, "account_history_not_authorized_for_system_pnl");
  assert.equal(db.portfolio.accountingBaselines.rolling_168h.pnlMethod, "okx_bills_plus_boundary_mark_to_market");
  assert.equal(db.portfolio.systemAccountingBaselines.rolling_168h, undefined);
  assert.equal(db.system.reduceOnlyMode, true);
  assert.ok(db.system.reduceOnlyReasons.includes("financial_reconciliation_pending"));
  assert.equal(result.historyBackfill.status, "reconciled_account_evidence_only");
  assert.equal(db.auditLogs.filter((row) => row.target === "rolling_168h_accounting_baseline").length, 1);
});

test("legacy account evidence is never used as rolling system-baseline grace", async () => {
  const nowMs = Date.UTC(2026, 7, 15, 1, 3, 0);
  const boundaryMs = rollingAccountingBoundary(nowMs);
  const db = integrationDb(nowMs);
  const bills = [
    bill({ billId: "1", ts: String(boundaryMs - 1000), subType: "3", px: "100", pnl: "0", fee: "-1" }),
    bill({ billId: "2", ts: String(boundaryMs + 1000), type: "8", subType: "173", px: "95", pnl: "-1", fee: "0", balChg: "-1" }),
    bill({ billId: "3", ts: String(boundaryMs + 2000), subType: "5", px: "90", pnl: "-20", fee: "-1", balChg: "-21" })
  ];
  const request = async (path) => path.startsWith("/api/v5/account/positions-history")
    ? { code: "0", data: [{ posId: "position-1", instId: "ADA-USDT-SWAP", direction: "long", cTime: String(boundaryMs - 1000), uTime: String(boundaryMs + 2000), type: "2" }] }
    : { code: "0", data: bills };
  await refreshAccountingAuthoritatively(db, {
    nowMs, forceHistoryBackfill: true, request,
    fetchBoundaryMarkPrice: async () => ({ complete: true, price: 95, observedAt: new Date(boundaryMs).toISOString() }),
    fetchContractSpec: async () => ({ ctVal: 1, ctType: "linear", settleCcy: "USDT" })
  });

  const oldBoundaryAt = db.portfolio.accountingBaselines.rolling_168h.boundaryAt;
  const rolloverMs = nowMs + ACCOUNTING_BOUNDARY_BUCKET_MS;
  refreshAccounting(db, { nowMs: rolloverMs });

  assert.equal(db.portfolio.weekBaselineStatus, "system_period_start_anchor_missing");
  assert.equal(db.portfolio.weekBaselineNeedsRefresh, false);
  assert.equal(db.portfolio.weekBaselineLagMs, 0);
  assert.notEqual(db.portfolio.weekWindowStartAt, oldBoundaryAt);
  assert.equal(db.portfolio.knownReconciledRealizedPnlWeek, 0, "without a system baseline grace, the requested boundary remains exact");
  assert.equal(db.portfolio.weekPnl, null);
  assert.equal(db.portfolio.pendingFinancialReconciliationWeek, 1);
  assert.equal(db.system.reduceOnlyMode, true);
});

test("authoritative rollover may refresh account evidence without creating a system baseline", async () => {
  const nowMs = Date.UTC(2026, 7, 15, 1, 3, 0);
  const boundaryMs = rollingAccountingBoundary(nowMs);
  const db = integrationDb(nowMs);
  const firstBills = [
    bill({ billId: "1", ts: String(boundaryMs - 1000), subType: "3", px: "100", pnl: "0", fee: "-1" }),
    bill({ billId: "2", ts: String(boundaryMs + 1000), type: "8", subType: "173", px: "95", pnl: "-1", fee: "0", balChg: "-1" }),
    bill({ billId: "3", ts: String(boundaryMs + 2000), subType: "5", px: "90", pnl: "-20", fee: "-1", balChg: "-21" })
  ];
  await refreshAccountingAuthoritatively(db, {
    nowMs, forceHistoryBackfill: true,
    request: async (path) => path.startsWith("/api/v5/account/positions-history")
      ? { code: "0", data: [{ posId: "position-1", instId: "ADA-USDT-SWAP", direction: "long", cTime: String(boundaryMs - 1000), uTime: String(boundaryMs + 2000), type: "2" }] }
      : { code: "0", data: firstBills },
    fetchBoundaryMarkPrice: async () => ({ complete: true, price: 95, observedAt: new Date(boundaryMs).toISOString() }),
    fetchContractSpec: async () => ({ ctVal: 1, ctType: "linear", settleCcy: "USDT" })
  });

  const rolloverMs = nowMs + ACCOUNTING_BOUNDARY_BUCKET_MS;
  const nextBoundaryMs = rollingAccountingBoundary(rolloverMs);
  db.accountSnapshots.find((row) => row.id === "current").createdAt = new Date(rolloverMs - 1000).toISOString();
  await refreshAccountingAuthoritatively(db, {
    nowMs: rolloverMs,
    forceHistoryBackfill: true,
    request: async () => ({ code: "0", data: [] })
  });

  assert.equal(db.portfolio.accountingBaselines.rolling_168h.boundaryAt, new Date(nextBoundaryMs).toISOString());
  assert.equal(db.portfolio.weekWindowStartAt, new Date(nextBoundaryMs).toISOString());
  assert.equal(db.portfolio.weekBaselineNeedsRefresh, false);
  assert.equal(db.portfolio.weekBaselineLagMs, 0);
  assert.equal(db.portfolio.weekBaselineStatus, "system_period_start_anchor_missing");
  assert.equal(db.portfolio.pendingFinancialReconciliationWeek, 1);
  assert.equal(db.portfolio.systemAccountingBaselines.rolling_168h, undefined);
  assert.equal(db.system.reduceOnlyMode, true);
});

test("a failed account-evidence rollover never weakens the missing system baseline", async () => {
  const nowMs = Date.UTC(2026, 7, 15, 1, 3, 0);
  const boundaryMs = rollingAccountingBoundary(nowMs);
  const db = integrationDb(nowMs);
  const bills = [
    bill({ billId: "1", ts: String(boundaryMs - 1000), subType: "3", px: "100", pnl: "0", fee: "-1" }),
    bill({ billId: "2", ts: String(boundaryMs + 1000), type: "8", subType: "173", px: "95", pnl: "-1", fee: "0", balChg: "-1" }),
    bill({ billId: "3", ts: String(boundaryMs + 2000), subType: "5", px: "90", pnl: "-20", fee: "-1", balChg: "-21" })
  ];
  await refreshAccountingAuthoritatively(db, {
    nowMs, forceHistoryBackfill: true,
    request: async (path) => path.startsWith("/api/v5/account/positions-history")
      ? { code: "0", data: [{ posId: "position-1", instId: "ADA-USDT-SWAP", direction: "long", cTime: String(boundaryMs - 1000), uTime: String(boundaryMs + 2000), type: "2" }] }
      : { code: "0", data: bills },
    fetchBoundaryMarkPrice: async () => ({ complete: true, price: 95, observedAt: new Date(boundaryMs).toISOString() }),
    fetchContractSpec: async () => ({ ctVal: 1, ctType: "linear", settleCcy: "USDT" })
  });

  const rolloverMs = nowMs + ACCOUNTING_BOUNDARY_BUCKET_MS;
  db.accountSnapshots.find((row) => row.id === "current").createdAt = new Date(rolloverMs - 1000).toISOString();
  await refreshAccountingAuthoritatively(db, {
    nowMs: rolloverMs,
    forceHistoryBackfill: true,
    request: async () => ({ code: "51000", data: [] })
  });
  assert.equal(db.portfolio.accountingHistoryBackfill.status, "failed");
  assert.equal(db.portfolio.weekBaselineStatus, "system_period_start_anchor_missing");
  assert.equal(db.portfolio.pendingFinancialReconciliationWeek, 1);
  assert.equal(db.system.reduceOnlyMode, true);

  refreshAccounting(db, { nowMs: nowMs + 2 * ACCOUNTING_BOUNDARY_BUCKET_MS });
  assert.equal(db.portfolio.weekBaselineStatus, "system_period_start_anchor_missing");
  assert.equal(db.portfolio.weekPnl, null);
  assert.equal(db.portfolio.pendingFinancialReconciliationWeek, 1);
  assert.equal(db.system.reduceOnlyMode, true);
  assert.ok(db.system.reduceOnlyReasons.includes("financial_reconciliation_pending"));
});

test("failed historical verification leaves both weekPnl and the opening pause fail-closed", async () => {
  const nowMs = Date.UTC(2026, 7, 15, 1, 3, 0);
  const db = integrationDb(nowMs);
  await refreshAccountingAuthoritatively(db, {
    nowMs, forceHistoryBackfill: true,
    request: async (path) => path.startsWith("/api/v5/account/positions-history")
      ? { code: "0", data: [] }
      : { code: "51000", data: [] }
  });
  assert.equal(db.portfolio.weekPnl, null);
  assert.equal(db.portfolio.weekBaselineStatus, "system_period_start_anchor_missing");
  assert.equal(db.portfolio.accountingHistoryBackfill.status, "failed");
  assert.equal(db.system.reduceOnlyMode, true);
  assert.ok(db.system.reduceOnlyReasons.includes("financial_reconciliation_pending"));
});

test("missing local fee facts wait without querying OKX history", async () => {
  const nowMs = Date.UTC(2026, 7, 15, 1, 3, 0);
  const db = integrationDb(nowMs);
  db.fills.at(-1).fundingReconciled = false;
  let requests = 0;
  await refreshAccountingAuthoritatively(db, {
    nowMs,
    forceHistoryBackfill: true,
    request: async () => { requests += 1; return { code: "0", data: [] }; }
  });
  assert.equal(requests, 0);
  assert.equal(db.portfolio.accountingHistoryBackfill.status, "waiting");
  assert.equal(db.portfolio.accountingHistoryBackfill.reason, "local_financial_facts_incomplete");
  assert.equal(db.portfolio.weekPnl, null);
  assert.equal(db.system.reduceOnlyMode, true);
});

test("a failed backfill is throttled only within the same boundary bucket", async () => {
  const nowMs = Date.UTC(2026, 7, 15, 1, 3, 0);
  const db = integrationDb(nowMs);
  let requests = 0;
  const options = {
    nowMs,
    historyBackfillRetryMs: 60 * 60_000,
    request: async (path) => {
      requests += 1;
      return path.startsWith("/api/v5/account/positions-history") ? { code: "0", data: [] } : { code: "51000", data: [] };
    }
  };
  await refreshAccountingAuthoritatively(db, options);
  const afterFailure = requests;
  await refreshAccountingAuthoritatively(db, { ...options, nowMs: nowMs + 60_000 });
  assert.equal(requests, afterFailure, "same bucket must not create a zero-delay retry loop");

  db.accountSnapshots[0].createdAt = new Date(nowMs + ACCOUNTING_BOUNDARY_BUCKET_MS - 1000).toISOString();
  await refreshAccountingAuthoritatively(db, { ...options, nowMs: nowMs + ACCOUNTING_BOUNDARY_BUCKET_MS });
  assert.ok(requests > afterFailure, "a new accounting boundary must be eligible for a fresh attempt");
});

test.after(() => {
  if (originalKey === undefined) delete process.env.OKX_API_KEY;
  else process.env.OKX_API_KEY = originalKey;
  if (originalDemo === undefined) delete process.env.OKX_DEMO_TRADING;
  else process.env.OKX_DEMO_TRADING = originalDemo;
});
