import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { dedupePositions, refreshAccounting, unrealizedPnl } from "../server/accounting.mjs";
import { evaluateProfessionalPlanRisks } from "../server/professionalRiskGate.mjs";
import { businessDayStartMs } from "../server/businessTime.mjs";

const at = (ms) => new Date(ms).toISOString();
process.env.OKX_API_KEY = "position-fact-key";
const positionFactFingerprint = crypto.createHash("sha256").update(process.env.OKX_API_KEY).digest("hex").slice(0, 16);

function dbFixture(now) {
  const observedAt = at(now - 1_000);
  const dayStart = businessDayStartMs(now, "Asia/Shanghai");
  const weekStart = now - 7 * 24 * 60 * 60_000;
  const binding = { accountId: "account-a", apiKeyFingerprint: positionFactFingerprint, environment: "production" };
  return {
    meta: {}, auditLogs: [], traces: [], riskIncidents: [], fills: [], executionOrders: [], exchangeAccounts: [{ id: binding.accountId, exchange: "OKX", readEnabled: true, tradeEnabled: true, apiKeyFingerprint: binding.apiKeyFingerprint }], reconciliationReports: [], realtimeConnections: [],
    system: { liveTradingEnabled: true, autonomyEnabled: true, killSwitch: false, professionalRiskMode: true, businessTimeZone: "Asia/Shanghai" },
    portfolio: { totalEquityUsdt: 1_000 },
    positions: [],
    accountSnapshots: [
      { id: "current", status: "ok", exchange: "OKX", ...binding, createdAt: observedAt, totalEquityUsdt: 1_000, positions: [] },
      { id: "day-base", status: "ok", exchange: "OKX", ...binding, createdAt: at(dayStart), totalEquityUsdt: 1_000, positions: [] },
      { id: "week-base", status: "ok", exchange: "OKX", ...binding, createdAt: at(weekStart), totalEquityUsdt: 1_000, positions: [] }
    ],
    markets: [{
      symbol: "BTC/USDT", price: 59_000, spreadBps: 2, depthUsdt: 100_000,
      tickerSourceAt: observedAt, tickerReceivedAt: observedAt,
      microReceivedAt: observedAt, bookSourceAt: observedAt, bookReceivedAt: observedAt,
      openInterestSourceAt: observedAt, openInterestReceivedAt: observedAt,
      fundingSourceAt: observedAt, fundingReceivedAt: observedAt,
      candles: []
    }],
    mandates: [{ id: "m1", status: "active", validUntil: "2099-01-01T00:00:00.000Z", allowedSymbols: ["BTC/USDT"], maxDailyLossPct: 1, maxImpactBps: 15 }],
    grayReleasePolicies: [{ enabled: true, maxNotionalUsdt: 50 }]
  };
}

function mirror(source, pnl, observedAt, extra = {}) {
  return {
    id: `${source}-${pnl}`, source, exchange: "OKX", accountId: "account-a", instId: "BTC-USDT-SWAP", symbol: "BTC/USDT",
    direction: "long", coinSize: 0.01, size: 1, entry: 60_000, mark: 59_000, pnl,
    ...(source === "exchange_ws" ? { exchangeObservedAt: observedAt } : { rawSyncedAt: observedAt }),
    ...extra
  };
}

test("newest bound WS position beats a stale REST mirror for accounting", () => {
  const now = Date.UTC(2026, 7, 15, 2, 0, 0);
  const db = dbFixture(now);
  db.positions = [mirror("exchange_rest", -1, at(now - 86_400_000)), mirror("exchange_ws", -10, at(now - 1_000))];
  assert.equal(dedupePositions(db.positions)[0].source, "exchange_ws");
  const state = unrealizedPnl(db, { now });
  assert.deepEqual(state, { knownTotal: -10, pendingPositions: [], complete: true });
  const result = refreshAccounting(db, { nowMs: now });
  assert.equal(result.unrealized, -10);
  assert.equal(result.todayPnl, -10);
  assert.equal(result.remainingDailyLossUsdt, 0);
  assert.equal(db.system.autonomyEnabled, false);
});

test("newer fresh REST position beats an older WS mirror", () => {
  const now = Date.UTC(2026, 7, 15, 2, 0, 0);
  const db = dbFixture(now);
  db.positions = [mirror("exchange_ws", -10, at(now - 60_000)), mirror("exchange_rest", -2, at(now - 1_000))];
  assert.equal(dedupePositions(db.positions)[0].source, "exchange_rest");
  assert.equal(unrealizedPnl(db, { now }).knownTotal, -2);
});

test("all exchange position facts expired makes the loss budget pending, not reconciled", () => {
  const now = Date.UTC(2026, 7, 15, 2, 0, 0);
  const db = dbFixture(now);
  db.positions = [mirror("exchange_rest", -1, at(now - 600_000)), mirror("exchange_ws", -10, at(now - 500_000))];
  const result = refreshAccounting(db, { nowMs: now });
  assert.equal(result.todayPnl, null);
  assert.equal(result.remainingDailyLossUsdt, null);
  assert.equal(db.system.dailyLossBudgetStatus, "pending_financial_reconciliation");
  assert.equal(db.system.reduceOnlyMode, true);
  assert.equal(db.portfolio.pendingUnrealizedPositions.length, 1);
});

test("liquidation gate uses the newest exchange fact rather than fixed REST precedence", () => {
  const now = Date.now();
  const db = dbFixture(now);
  db.positions = [
    mirror("exchange_rest", -1, at(now - 600_000), { mark: 100, liqPx: 50 }),
    mirror("exchange_ws", -10, at(now - 1_000), { mark: 100, liqPx: 95 })
  ];
  const risk = evaluateProfessionalPlanRisks(db, { mandateId: "m1", symbol: "BTC/USDT", direction: "long", entry_range: [100, 100], stopLoss: 90 }, db.mandates[0]);
  const check = risk.checks.find((row) => row.name === "现有持仓强平距离");
  assert.equal(check.passed, false);
  assert.match(check.detail, /低于/);
});
