import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTradePlan, minimumStopAtrForPlan } from "../server/riskEngine.mjs";

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

test("授权杠杆区间的下限与上限都是执行硬边界", () => {
  const db = fixture({ live: false });
  db.mandates[0].minLeverage = 2;
  db.mandates[0].maxLeverage = 5;
  const below = evaluateTradePlan(db, { ...plan, leverage: 1 });
  assert.equal(below.passed, false);
  assert.ok(below.blockers.some((item) => item.name === "杠杆下限"));
  const inside = evaluateTradePlan(db, { ...plan, leverage: 2 });
  assert.equal(inside.passed, true);
});

test("过期连亏冷却不会被旧的永久连亏闸再次锁死", () => {
  const db = fixture({ live: true });
  db.system.remainingDailyLossUsdt = 100;
  db.portfolio.totalEquityUsdt = 10_000;
  db.portfolio.availableMarginUsdt = 8_000;
  db.fills = Array.from({ length: 5 }, (_, index) => ({
    id: `old-loss-${index}`,
    executionOrderId: `old-exec-${index}`,
    kind: "close",
    realizedPnl: -1,
    createdAt: new Date(Date.now() - (24 + index) * 3_600_000).toISOString()
  }));
  db.portfolio.weekPnl = -5;
  const result = evaluateTradePlan(db, plan);
  assert.equal(result.checks.some((check) => check.name === "连续亏损熔断"), false);
  const cooldown = result.checks.find((check) => check.name === "连亏冷却");
  assert.equal(cooldown?.passed, true);
  assert.match(cooldown?.detail || "", /未触发/);
});

test("近7日亏损熔断读取 Mandate 前端配置值而非写死 5%", () => {
  const db = fixture({ live: true });
  db.system.remainingDailyLossUsdt = 100;
  db.portfolio.totalEquityUsdt = 10_000;
  db.portfolio.availableMarginUsdt = 8_000;
  db.portfolio.weekPnl = -600;

  db.mandates[0].maxWeeklyLossPct = 5;
  const blocked = evaluateTradePlan(db, plan);
  const blockedCheck = blocked.checks.find((check) => check.name === "近7日亏损熔断");
  assert.equal(blockedCheck?.passed, false);
  assert.match(blockedCheck?.detail || "", /上限 5%/);

  db.mandates[0].maxWeeklyLossPct = 7;
  const allowed = evaluateTradePlan(db, plan);
  const allowedCheck = allowed.checks.find((check) => check.name === "近7日亏损熔断");
  assert.equal(allowedCheck?.passed, true);
  assert.match(allowedCheck?.detail || "", /上限 7%/);

  delete db.mandates[0].maxWeeklyLossPct;
  db.mandates[0].maxWeeklyDrawdownPct = 8;
  const legacy = evaluateTradePlan(db, plan);
  const legacyCheck = legacy.checks.find((check) => check.name === "近7日亏损熔断");
  assert.equal(legacyCheck?.passed, false, "历史最大回撤字段不得放宽近7日累计亏损上限");
  assert.match(legacyCheck?.detail || "", /上限 5%/);
});

test("mandate changes invalidate previously bound plans", () => {
  const db = fixture({ live: false });
  db.mandates[0].version = 2;
  const result = evaluateTradePlan(db, { ...plan, mandateVersion: 1 });
  assert.equal(result.passed, false);
  assert.ok(result.blockers.some((item) => item.name === "授权版本"));
});

test("白名单外币对:无一次性授权时'交易对范围'拦截,有 oneShotAuth 时放行(仅本闸)", () => {
  const db = fixture({ live: false });
  const offlist = { ...plan, id: "p_off", symbol: "PEPE/USDT" };
  // 无 oneShotAuth：交易对范围必须失败
  const blocked = evaluateTradePlan(db, offlistClone(offlist));
  const blockedNames = blocked.checks.filter((c) => !c.passed).map((c) => c.name);
  assert.ok(blockedNames.includes("交易对范围"), `白名单外应被交易对范围拦,实际失败:${blockedNames.join(",")}`);

  // 有 oneShotAuth：交易对范围通过(整体在 paper 模式下应 passed)
  const authed = evaluateTradePlan(db, { ...offlistClone(offlist), oneShotAuth: true });
  const authedFailed = authed.checks.filter((c) => !c.passed).map((c) => c.name);
  assert.ok(!authedFailed.includes("交易对范围"), `一次性授权应放行交易对范围,实际失败:${authedFailed.join(",")}`);
  assert.equal(authed.passed, true, "一次性授权的白名单外计划在 paper 模式应整体通过");
});

test("oneShotAuth 只放行交易对范围,不绕过其他风控(如授权版本)", () => {
  const db = fixture({ live: false });
  db.mandates[0].version = 2;
  const result = evaluateTradePlan(db, { ...plan, symbol: "PEPE/USDT", mandateVersion: 1, oneShotAuth: true });
  assert.equal(result.passed, false, "授权版本不匹配仍应拦,oneShotAuth 不该绕过它");
  assert.ok(result.blockers.some((item) => item.name === "授权版本"));
});

function offlistClone(p) { return { ...p }; }

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

test("实盘方向型计划拒绝 NEUTRAL/C 结构，A/B 同向结构放行", () => {
  const db = fixture({ live: true });
  db.system.remainingDailyLossUsdt = 100;
  db.portfolio.totalEquityUsdt = 10_000;
  db.portfolio.availableMarginUsdt = 8_000;
  const base = {
    ...plan,
    stopLoss: 97,
    entry_range: [100, 100],
    take_profit: [106],
    decisionContext: {
      setupType: "trend_pullback",
      deterministicStructureRef: { bias: "NEUTRAL", quality: "C" },
      deterministicSetupSnapshot: { referenceLevels: { atr14: 1 } }
    }
  };
  const blocked = evaluateTradePlan(db, base);
  assert.ok(blocked.blockers.some((item) => item.name === "确定性结构与计划方向"));

  const aligned = evaluateTradePlan(db, {
    ...base,
    decisionContext: {
      ...base.decisionContext,
      deterministicStructureRef: { bias: "LONG", quality: "B" }
    }
  });
  assert.equal(aligned.checks.find((item) => item.name === "确定性结构与计划方向")?.passed, true);
});

test("实盘止损必须从计划入场中值保留至少 1.25 ATR 缓冲", () => {
  const db = fixture({ live: true });
  db.system.remainingDailyLossUsdt = 100;
  db.portfolio.totalEquityUsdt = 10_000;
  db.portfolio.availableMarginUsdt = 8_000;
  const withSnapshot = {
    ...plan,
    entry_range: [100, 102],
    stopLoss: 99.8,
    take_profit: [106],
    decisionContext: {
      setupType: "range_rejection",
      deterministicSetupSnapshot: { referenceLevels: { atr14: 1 } }
    }
  };
  const tight = evaluateTradePlan(db, withSnapshot);
  const tightCheck = tight.checks.find((item) => item.name === "止损波动缓冲");
  assert.equal(tightCheck?.passed, false);
  assert.ok(tight.blockers.some((item) => item.name === "止损波动缓冲"));

  const buffered = evaluateTradePlan(db, { ...withSnapshot, stopLoss: 99.75 });
  assert.equal(buffered.checks.find((item) => item.name === "止损波动缓冲")?.passed, true);
});

test("高波动扩张时止损缓冲自适应提高到至少 1.5 ATR", () => {
  const volatile = {
    decisionContext: { deterministicSetupSnapshot: { marketRegime: { label: "high_volatility", volatilityRatio: 1.9 } } }
  };
  assert.equal(minimumStopAtrForPlan(volatile), 1.5);
  assert.equal(minimumStopAtrForPlan({ decisionContext: { deterministicSetupSnapshot: { marketRegime: { label: "range" } } } }), 1.25);
});

test("take_profit 数组按第一目标计算最低盈亏比，不再误判为未设置止盈", () => {
  const db = fixture({ live: true });
  db.system.remainingDailyLossUsdt = 100;
  db.portfolio.totalEquityUsdt = 10_000;
  db.portfolio.availableMarginUsdt = 8_000;
  const weak = evaluateTradePlan(db, {
    ...plan,
    direction: "long",
    entry_range: [100, 100],
    stopLoss: 98,
    take_profit: [102.5]
  });
  const check = weak.checks.find((item) => item.name === "最低盈亏比");
  assert.equal(check?.passed, false);
  assert.match(check?.detail || "", /1\.25R/);
  assert.doesNotMatch(check?.detail || "", /未设置固定止盈/);
  assert.ok(weak.blockers.some((item) => item.name === "最低盈亏比"));
});

test("实盘 Agent 计划缺少 ATR 快照时失败关闭", () => {
  const db = fixture({ live: true });
  db.system.remainingDailyLossUsdt = 100;
  db.portfolio.totalEquityUsdt = 10_000;
  db.portfolio.availableMarginUsdt = 8_000;
  const result = evaluateTradePlan(db, {
    ...plan,
    take_profit: [120000],
    decisionContext: {
      setupType: "trend_pullback",
      deterministicStructureRef: { bias: "LONG", quality: "A" }
    }
  });
  assert.ok(result.blockers.some((item) => item.name === "止损波动证据"));
});
