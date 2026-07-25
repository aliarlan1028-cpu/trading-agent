import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTradePlan } from "../server/riskEngine.mjs";

function fixture({ live = false } = {}) {
  return {
    system: { liveTradingEnabled: live, killSwitch: false, remainingDailyLossUsdt: null },
    portfolio: { totalEquityUsdt: null, availableMarginUsdt: null, weekPnl: 0 },
    fills: [],
    markets: [{
      symbol: "BTC/USDT",
      fundingRate: 0.01,
      spreadBps: 2,
      microSyncedAt: new Date().toISOString()
    }],
    events: [],
    positions: [],
    tradePlans: [],
    mandates: [{
      id: "m1",
      status: "active",
      allowedSymbols: ["BTC/USDT"],
      marketTypes: ["perpetual_usdt"],
      strategies: ["trend"],
      validUntil: "2099-01-01T00:00:00.000Z",
      maxLeverage: 3,
      maxSingleTradeRiskPct: 1
    }]
  };
}

const plan = {
  id: "p1",
  mandateId: "m1",
  symbol: "BTC/USDT",
  marketType: "perpetual_usdt",
  strategy: "trend",
  leverage: 2,
  stopLoss: 90000,
  entry_range: [100000, 100000],
  entry: { riskPercent: 0.5 }
};

test("live risk check fails closed without account risk basis", () => {
  const result = evaluateTradePlan(fixture({ live: true }), plan);
  assert.equal(result.passed, false);
  assert.ok(result.blockers.some((item) => item.name === "日亏损额度"));
  assert.ok(result.blockers.some((item) => item.name === "账户权益与保证金"));
});

test("paper-mode risk check exposes missing account data as warnings", () => {
  const result = evaluateTradePlan(fixture({ live: false }), plan);
  assert.equal(result.passed, true);
  assert.equal(result.decision, "allowed_with_warnings");
});

test("complete account risk basis permits an otherwise valid live plan", () => {
  const db = fixture({ live: true });
  db.system.remainingDailyLossUsdt = 100;
  db.portfolio.totalEquityUsdt = 10_000;
  db.portfolio.availableMarginUsdt = 8_000;
  const result = evaluateTradePlan(db, plan);
  assert.equal(result.passed, true);
});

test("mandate changes invalidate previously bound plans", () => {
  const db = fixture({ live: false });
  db.mandates[0].version = 2;
  const result = evaluateTradePlan(db, { ...plan, mandateVersion: 1 });
  assert.equal(result.passed, false);
  assert.ok(result.blockers.some((item) => item.name === "授权版本"));
});
