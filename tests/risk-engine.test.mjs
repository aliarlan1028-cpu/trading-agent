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
      depthUsdt: 1_000_000,
      updatedAt: new Date().toISOString(),
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

test("陈旧计划被新鲜度检查拦截:现价越过止损/入场偏离超阈值", () => {
  const db = fixture();
  db.markets[0].price = 0.1647; // 用户实锤场景:ADA 跌到 0.1647,旧计划入场 0.193
  const stale = {
    id: "p_stale", mandateId: "m1", mandateVersion: 1, symbol: "BTC/USDT",
    marketType: "perpetual_usdt", strategy: "trend", direction: "long",
    entry_range: [0.1927, 0.1935], stopLoss: 0.1888, take_profit: [0.1986],
    leverage: 2, max_loss_pct: 0.3
  };
  const risk = evaluateTradePlan(db, stale);
  assert.equal(risk.passed, false);
  const failed = risk.checks.filter((c) => !c.passed).map((c) => c.name);
  assert.ok(failed.includes("现价在止损安全侧"), `应拦截跌穿止损,实际失败项:${failed.join(",")}`);

  // 新鲜计划(贴近现价、止损在安全侧)不受两项新检查影响
  const fresh = { ...stale, id: "p_fresh", entry_range: [0.162, 0.164], stopLoss: 0.158, take_profit: [0.172] };
  const risk2 = evaluateTradePlan(db, fresh);
  const freshFailed = risk2.checks.filter((c) => !c.passed).map((c) => c.name);
  assert.ok(!freshFailed.includes("现价在止损安全侧") && !freshFailed.includes("入场区间贴近现价"), `新鲜计划不应被新检查拦:${freshFailed.join(",")}`);
});
