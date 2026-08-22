import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { refreshAccounting } from "../server/accounting.mjs";
import { businessDayStartMs } from "../server/businessTime.mjs";

const iso = (value) => new Date(value).toISOString();
const originalOkxApiKey = process.env.OKX_API_KEY;
process.env.OKX_API_KEY = "accounting-period-key-a";
const fingerprintFor = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);

function fixture(now, { baselineUpl = 0, currentUpl = 0, baselineEquity = 1_000, currentEquity = baselineEquity } = {}) {
  const dayStart = businessDayStartMs(now, "Asia/Shanghai");
  const weekStart = now - 7 * 24 * 60 * 60_000;
  const accountId = "account-a";
  const apiKeyFingerprint = fingerprintFor(process.env.OKX_API_KEY);
  const environment = "production";
  const basePosition = baselineUpl === 0 ? [] : [{ instId: "BTC-USDT-SWAP", pos: "1", coinSize: 0.01, upl: String(baselineUpl) }];
  const entryAt = baselineUpl === 0 ? dayStart + 1_000 : weekStart - 1_000;
  const execution = {
    id: "execution", planId: "plan", status: "protecting", exchange: "OKX", accountId, environment,
    symbol: "BTC/USDT", direction: "long", filledQuantity: 0.01, entryFilledAt: iso(entryAt)
  };
  return {
    meta: {}, auditLogs: [], traces: [], riskIncidents: [],
    fills: [{
      id: "entry", kind: "entry", executionOrderId: execution.id, planId: execution.planId, tradePlanId: execution.planId,
      exchange: "OKX", accountId, environment, symbol: execution.symbol, direction: execution.direction,
      quantity: 0.01, feeUsdt: 0, estimatedFee: false, exchangeFilledAt: iso(entryAt), createdAt: iso(entryAt),
      tradeAttribution: { schemaVersion: 1, scope: "system", origin: "execution_engine", executionOrderId: execution.id, planId: execution.planId, method: "execution_writer", evidence: { accountId, environment } }
    }],
    executionOrders: [execution],
    tradePlans: [{ id: execution.planId, exchange: "OKX", accountId, environment, symbol: execution.symbol, direction: execution.direction }],
    system: { businessTimeZone: "Asia/Shanghai", autonomyEnabled: true },
    portfolio: { totalEquityUsdt: currentEquity },
    mandates: [{ id: "m1", status: "active", validUntil: "2099-01-01T00:00:00.000Z", maxDailyLossPct: 5 }],
    exchangeAccounts: [{ id: accountId, exchange: "OKX", readEnabled: true, tradeEnabled: false, apiKeyFingerprint }],
    positions: currentUpl === null ? [] : [{
      id: "position", source: "exchange_rest", exchange: "OKX", accountId, symbol: "BTC/USDT", instId: "BTC-USDT-SWAP",
      direction: "long", environment, coinSize: 0.01, entry: 60_000, mark: 59_000, pnl: currentUpl, rawSyncedAt: iso(now - 1_000)
    }],
    markets: [],
    accountSnapshots: [
      { id: "current", status: "ok", exchange: "OKX", accountId, apiKeyFingerprint, environment, createdAt: iso(now - 1_000), totalEquityUsdt: currentEquity, positions: currentUpl === null ? [] : [{ instId: "BTC-USDT-SWAP", pos: "1", coinSize: 0.01, upl: String(currentUpl) }] },
      { id: "day-base", status: "ok", exchange: "OKX", accountId, apiKeyFingerprint, environment, createdAt: iso(dayStart), totalEquityUsdt: baselineEquity, positions: basePosition },
      { id: "week-base", status: "ok", exchange: "OKX", accountId, apiKeyFingerprint, environment, createdAt: iso(weekStart), totalEquityUsdt: baselineEquity, positions: basePosition }
    ]
  };
}

test("yesterday's unrealized loss is not charged again when today's price is unchanged", () => {
  const now = Date.UTC(2026, 7, 15, 1, 0, 0);
  const db = fixture(now, { baselineUpl: -100, currentUpl: -100 });
  const result = refreshAccounting(db, { nowMs: now });
  assert.equal(result.todayPnl, 0);
  assert.equal(result.remainingDailyLossUsdt, 50);
  assert.equal(db.system.autonomyEnabled, true);
});

test("cross-midnight position contributes only the UPL change after the daily boundary", () => {
  const now = Date.UTC(2026, 7, 15, 1, 0, 0);
  const db = fixture(now, { baselineUpl: -100, currentUpl: -101 });
  const result = refreshAccounting(db, { nowMs: now });
  assert.equal(result.todayPnl, -1);
  assert.equal(result.remainingDailyLossUsdt, 49);
});

test("intraday position starts from zero UPL at the period boundary", () => {
  const now = Date.UTC(2026, 7, 15, 1, 0, 0);
  const db = fixture(now, { baselineUpl: 0, currentUpl: -7 });
  const result = refreshAccounting(db, { nowMs: now });
  assert.equal(result.todayPnl, -7);
  assert.equal(result.remainingDailyLossUsdt, 43);
});

test("daily loss cap stays bound to start-of-day equity across deposits and withdrawals", () => {
  const now = Date.UTC(2026, 7, 15, 1, 0, 0);
  const deposited = fixture(now, { baselineEquity: 1_000, currentEquity: 2_000, baselineUpl: 0, currentUpl: 0 });
  refreshAccounting(deposited, { nowMs: now });
  assert.equal(deposited.portfolio.dailyStartEquityUsdt, 1_000);
  assert.equal(deposited.system.dailyLossCapUsdt, 50);

  const withdrawn = fixture(now, { baselineEquity: 1_000, currentEquity: 500, baselineUpl: 0, currentUpl: 0 });
  refreshAccounting(withdrawn, { nowMs: now });
  assert.equal(withdrawn.system.dailyLossCapUsdt, 50);
});

test("missing period-start evidence fails closed instead of charging full current UPL", () => {
  const now = Date.UTC(2026, 7, 15, 1, 0, 0);
  const db = fixture(now, { baselineUpl: -100, currentUpl: -100 });
  db.accountSnapshots = db.accountSnapshots.filter((row) => row.id === "current");
  const result = refreshAccounting(db, { nowMs: now });
  assert.equal(result.todayPnl, null);
  assert.equal(result.remainingDailyLossUsdt, null);
  assert.equal(db.portfolio.dailyBaselineStatus, "system_period_start_anchor_missing");
  assert.equal(db.system.reduceOnlyMode, true);
});

test("persisted daily baseline survives restart and is not replaced by current equity", () => {
  const now = Date.UTC(2026, 7, 15, 1, 0, 0);
  const db = fixture(now, { baselineEquity: 1_000, currentEquity: 1_000, baselineUpl: -10, currentUpl: -11 });
  refreshAccounting(db, { nowMs: now });
  assert.equal(db.portfolio.todayPnl, -1);
  db.accountSnapshots = db.accountSnapshots.filter((row) => row.id === "current");
  db.accountSnapshots[0].totalEquityUsdt = 5_000;
  db.portfolio.totalEquityUsdt = 5_000;
  refreshAccounting(db, { nowMs: now + 60_000 });
  assert.equal(db.portfolio.todayPnl, -1);
  assert.equal(db.portfolio.dailyStartEquityUsdt, 1_000);
  assert.equal(db.system.dailyLossCapUsdt, 50);
});

test("accounting baseline is invalidated after API key rotation until a newly bound snapshot arrives", () => {
  const now = Date.UTC(2026, 7, 15, 1, 0, 0);
  const db = fixture(now, { baselineUpl: -10, currentUpl: -11 });
  refreshAccounting(db, { nowMs: now });
  process.env.OKX_API_KEY = "accounting-period-key-b";
  const nextFingerprint = fingerprintFor(process.env.OKX_API_KEY);
  const blocked = refreshAccounting(db, { nowMs: now + 1_000 });
  assert.equal(blocked.todayPnl, null);
  assert.equal(db.portfolio.dailyBaselineStatus, "okx_account_credential_fingerprint_mismatch");
  assert.equal(db.system.reduceOnlyMode, true);

  db.exchangeAccounts[0].apiKeyFingerprint = nextFingerprint;
  db.accountSnapshots.unshift({
    ...db.accountSnapshots[0], id: "current-new-key", apiKeyFingerprint: nextFingerprint, createdAt: iso(now + 2_000)
  });
  const recovered = refreshAccounting(db, { nowMs: now + 3_000 });
  assert.equal(recovered.todayPnl, null, "old period baseline must not be reused for the rotated key");
  assert.equal(db.portfolio.dailyBaselineStatus, "system_period_start_anchor_missing");
  process.env.OKX_API_KEY = "accounting-period-key-a";
});

test("missing runtime OKX credential fails closed even if account metadata and old snapshots still match", () => {
  const now = Date.UTC(2026, 7, 15, 1, 0, 0);
  const db = fixture(now);
  delete process.env.OKX_API_KEY;
  try {
    const result = refreshAccounting(db, { nowMs: now });
    assert.equal(result.todayPnl, null);
    assert.equal(db.portfolio.dailyBaselineStatus, "okx_credential_fingerprint_unavailable");
    assert.equal(db.system.reduceOnlyMode, true);
  } finally {
    process.env.OKX_API_KEY = "accounting-period-key-a";
  }
});

test("accounting baseline fails closed when account, fingerprint, or environment is missing or changes", () => {
  const now = Date.UTC(2026, 7, 15, 1, 0, 0);
  for (const field of ["accountId", "apiKeyFingerprint", "environment"]) {
    const db = fixture(now);
    delete db.accountSnapshots[0][field];
    const result = refreshAccounting(db, { nowMs: now });
    assert.equal(result.todayPnl, null, `${field} must be required`);
  }

  const prior = process.env.OKX_DEMO_TRADING;
  process.env.OKX_DEMO_TRADING = "true";
  try {
    const db = fixture(now);
    const result = refreshAccounting(db, { nowMs: now });
    assert.equal(result.todayPnl, null);
    assert.equal(db.portfolio.dailyBaselineStatus, "current_account_snapshot_binding_mismatch");
  } finally {
    if (prior === undefined) delete process.env.OKX_DEMO_TRADING;
    else process.env.OKX_DEMO_TRADING = prior;
  }
});

test("compact accounting anchors keep a moving rolling-168h boundary reachable after full snapshots are capped", () => {
  const now = Date.UTC(2026, 7, 15, 1, 0, 0);
  const db = fixture(now, { baselineEquity: 1_000, currentEquity: 1_000, baselineUpl: 0, currentUpl: 0 });
  refreshAccounting(db, { nowMs: now });
  assert.equal(db.portfolio.weekBaselineStatus, "reconciled");
  assert.ok(db.accountingAnchors.length >= 3);

  // Simulate the production 500-snapshot retention window: only the current
  // full snapshot remains, while the compact seven-day anchor survives.
  db.accountSnapshots = db.accountSnapshots.filter((row) => row.id === "current");
  refreshAccounting(db, { nowMs: now + 60_000 });
  assert.equal(db.portfolio.weekBaselineStatus, "reconciled");
  assert.equal(db.portfolio.weekPnl, 0);
  assert.equal(db.portfolio.systemAccountingBaselines.rolling_168h.observedAt, iso(now - 7 * 24 * 60 * 60_000));
});

test.after(() => {
  if (originalOkxApiKey === undefined) delete process.env.OKX_API_KEY;
  else process.env.OKX_API_KEY = originalOkxApiKey;
});
