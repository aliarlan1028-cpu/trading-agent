import assert from "node:assert/strict";
import test from "node:test";
import { refreshAccounting } from "../server/accounting.mjs";
import { businessDayStartMs } from "../server/businessTime.mjs";

const iso = (value) => new Date(value).toISOString();

function fixture(now, { baselineUpl = 0, currentUpl = 0, baselineEquity = 1_000, currentEquity = baselineEquity } = {}) {
  const dayStart = businessDayStartMs(now, "Asia/Shanghai");
  const weekStart = now - 7 * 24 * 60 * 60_000;
  const accountId = "account-a";
  const basePosition = baselineUpl === 0 ? [] : [{ instId: "BTC-USDT-SWAP", pos: "1", coinSize: 0.01, upl: String(baselineUpl) }];
  return {
    meta: {}, auditLogs: [], traces: [], riskIncidents: [], fills: [], executionOrders: [],
    system: { businessTimeZone: "Asia/Shanghai", autonomyEnabled: true },
    portfolio: { totalEquityUsdt: currentEquity },
    mandates: [{ id: "m1", status: "active", validUntil: "2099-01-01T00:00:00.000Z", maxDailyLossPct: 5 }],
    positions: currentUpl === null ? [] : [{
      id: "position", source: "exchange_rest", exchange: "OKX", accountId, symbol: "BTC/USDT", instId: "BTC-USDT-SWAP",
      direction: "long", coinSize: 0.01, entry: 60_000, mark: 59_000, pnl: currentUpl, rawSyncedAt: iso(now - 1_000)
    }],
    markets: [],
    accountSnapshots: [
      { id: "current", status: "ok", exchange: "OKX", accountId, createdAt: iso(now - 1_000), totalEquityUsdt: currentEquity, positions: currentUpl === null ? [] : [{ instId: "BTC-USDT-SWAP", pos: "1", coinSize: 0.01, upl: String(currentUpl) }] },
      { id: "day-base", status: "ok", exchange: "OKX", accountId, createdAt: iso(dayStart), totalEquityUsdt: baselineEquity, positions: basePosition },
      { id: "week-base", status: "ok", exchange: "OKX", accountId, createdAt: iso(weekStart), totalEquityUsdt: baselineEquity, positions: basePosition }
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
  assert.equal(db.portfolio.dailyBaselineStatus, "period_start_snapshot_missing");
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
