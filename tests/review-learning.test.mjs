import assert from "node:assert/strict";
import test from "node:test";

import {
  backfillReviewMemoryContexts,
  buildReviewLearningAnalytics,
  buildReviewLearningContext,
  retrieveRelevantReviewMemories,
  reviewLearningPrompt,
  stampReviewMemoryContext,
  validateAppliedReviewLessons
} from "../server/reviewLearning.mjs";

function dbFixture() {
  return {
    markets: [
      { symbol: "BTC/USDT", regime: "上行趋势" },
      { symbol: "ADA/USDT", regime: "震荡低波动" }
    ],
    tradePlans: [
      { id: "old-btc", symbol: "BTC/USDT", direction: "long", timeframe: "1h", scenarioType: "trend_pullback", strategyProductId: "trend", traderRole: "day_trader" },
      { id: "old-ada", symbol: "ADA/USDT", direction: "short", timeframe: "4h", scenarioType: "breakdown_retest", strategyProductId: "breakdown" }
    ],
    fills: [
      { id: "close-btc", kind: "close", executionOrderId: "exec-btc", tradePlanId: "old-btc", symbol: "BTC/USDT", direction: "long", regime: "上行趋势", realizedPnl: -2, createdAt: "2026-08-01T01:00:00Z" },
      { id: "close-ada", kind: "close", executionOrderId: "exec-ada", tradePlanId: "old-ada", symbol: "ADA/USDT", direction: "short", regime: "震荡低波动", realizedPnl: 3, createdAt: "2026-08-01T02:00:00Z" }
    ],
    reviews: [
      { id: "review-btc", type: "trade", tradeLifecycleKey: "exec-btc", tradePlanId: "old-btc", memoryItemId: "mem-btc", symbol: "BTC/USDT", realizedPnl: -2 },
      { id: "review-ada", type: "trade", tradeLifecycleKey: "exec-ada", tradePlanId: "old-ada", memoryItemId: "mem-ada", symbol: "ADA/USDT", realizedPnl: 3 }
    ],
    memoryItems: [
      { id: "mem-ada", source: "auto_reflection", fillId: "close-ada", title: "复盘 ADA", content: "跌破后等待反抽确认，避免在区间下沿追空。", createdAt: "2026-08-01T03:00:00Z" },
      { id: "generic", source: "learning_loop", title: "通用纪律", content: "严格止损", createdAt: "2026-08-01T03:00:00Z" },
      { id: "mem-btc", source: "auto_reflection", fillId: "close-btc", title: "复盘 BTC", content: "趋势回调必须等待支撑确认，不能直接追高。", createdAt: "2026-08-01T02:00:00Z" }
    ]
  };
}

test("复盘检索按交易对隔离，并结合策略、周期和 regime 排序", () => {
  const db = dbFixture();
  const rows = retrieveRelevantReviewMemories(db, {
    text: "分析 BTC/USDT 1h",
    setupType: "trend_pullback",
    regime: "上行趋势"
  });
  assert.deepEqual(rows.map((row) => row.id), ["mem-btc"]);
  assert.ok(rows[0].matchedBy.includes("symbol"));
  assert.ok(rows[0].matchedBy.includes("setup"));
  assert.ok(rows[0].matchedBy.includes("timeframe"));
  assert.ok(rows[0].matchedBy.includes("regime"));
});

test("多币巡检为每个交易对保留相关复盘配额", () => {
  const db = dbFixture();
  db.memoryItems.unshift(
    { id: "mem-btc-2", source: "auto_reflection", reviewContext: { schemaVersion: 1, symbol: "BTC/USDT", setupType: "trend_pullback", timeframe: "1h" }, title: "BTC 复盘 2", content: "等待确认", createdAt: "2026-08-02T02:00:00Z" },
    { id: "mem-btc-3", source: "auto_reflection", reviewContext: { schemaVersion: 1, symbol: "BTC/USDT", setupType: "trend_pullback", timeframe: "1h" }, title: "BTC 复盘 3", content: "控制追高", createdAt: "2026-08-02T03:00:00Z" }
  );
  const rows = retrieveRelevantReviewMemories(db, { symbols: ["BTC/USDT", "ADA/USDT"], limit: 2 });
  assert.deepEqual(new Set(rows.map((row) => row.symbol)), new Set(["BTC/USDT", "ADA/USDT"]));
});

test("普通问答没有明确交易对象时不注入任意交易复盘", () => {
  const db = dbFixture();
  const context = buildReviewLearningContext(db, { text: "怎么修改登录密码？" });
  assert.equal(context.retrieved.length, 0);
  assert.equal(reviewLearningPrompt(context), "");
});

test("计划只能引用本轮检索到且带完整影响说明的复盘", () => {
  const db = dbFixture();
  const context = buildReviewLearningContext(db, { text: "BTC/USDT 1h 怎么做" });
  const checked = validateAppliedReviewLessons(context, [
    { memoryId: "mem-btc", influence: "avoided", note: "等待回踩确认后再入场" },
    { memoryId: "mem-ada", influence: "changed", note: "不相关币种" },
    { memoryId: "invented", influence: "reinforced", note: "伪造引用" },
    { memoryId: "mem-btc", influence: "unknown", note: "枚举非法" }
  ]);
  assert.equal(checked.applied.length, 1);
  assert.equal(checked.applied[0].memoryId, "mem-btc");
  assert.deepEqual(checked.rejected.sort(), ["invented", "mem-ada", "mem-btc"].sort());
});

test("新复盘记忆写入可检索的结构化上下文", () => {
  const memory = { id: "m", source: "auto_reflection" };
  const context = stampReviewMemoryContext(memory, {
    fill: { symbol: "SUI/USDT", direction: "short", regime: "下行趋势", realizedPnl: -1 },
    plan: { id: "p", timeframe: "15m", scenarioType: "breakdown_retest", strategyProductId: "breakdown", traderRole: "day_trader" },
    review: { id: "r" },
    lifecycle: { realizedPnl: -1, netRealizedPnl: -1 }
  });
  assert.deepEqual(context, {
    schemaVersion: 2,
    symbol: "SUI/USDT",
    direction: "short",
    setupType: "breakdown_retest",
    strategyProductId: "breakdown",
    timeframe: "15m",
    traderRole: "day_trader",
    regime: "下行趋势",
    grossRealizedPnl: -1,
    netRealizedPnl: -1,
    outcome: "loss",
    reviewId: "r",
    tradePlanId: "p"
  });
});

test("schema v2 迁移保留孤儿历史记忆的结构标签，但不会把旧毛值冒充净值", () => {
  const db = {
    fills: [], reviews: [], tradePlans: [],
    memoryItems: [{
      id: "orphan", source: "auto_reflection", title: "孤儿历史复盘",
      reviewContext: {
        schemaVersion: 1, symbol: "BTC/USDT", direction: "long", setupType: "trend_pullback",
        strategyProductId: "trend", timeframe: "1h", traderRole: "day_trader", regime: "uptrend",
        realizedPnl: 1, outcome: "win", reviewId: "missing-review", tradePlanId: "missing-plan"
      }
    }]
  };
  assert.equal(backfillReviewMemoryContexts(db).updated, 1);
  assert.deepEqual(db.memoryItems[0].reviewContext, {
    schemaVersion: 2, symbol: "BTC/USDT", direction: "long", setupType: "trend_pullback",
    strategyProductId: "trend", timeframe: "1h", traderRole: "day_trader", regime: "uptrend",
    grossRealizedPnl: 1, netRealizedPnl: null, outcome: null,
    reviewId: "missing-review", tradePlanId: "missing-plan"
  });
  assert.equal(backfillReviewMemoryContexts(db).updated, 0, "orphan migration must be idempotent");
});

test("学习效果按平仓生命周期统计，样本不足时不宣称已经改善", () => {
  const db = dbFixture();
  db.tradePlans.push(
    { id: "used", symbol: "BTC/USDT", timeframe: "1h", scenarioType: "trend_pullback", strategyProductId: "trend", reviewLearning: { applied: [{ memoryId: "mem-btc", influence: "avoided", note: "等待确认" }] } },
    { id: "control", symbol: "BTC/USDT", timeframe: "1h", scenarioType: "trend_pullback", strategyProductId: "trend", reviewLearning: { applied: [] } }
  );
  db.fills.unshift(
    { id: "used-part", kind: "close", partial: true, executionOrderId: "exec-used", tradePlanId: "used", symbol: "BTC/USDT", realizedPnl: 1, createdAt: "2026-08-02T01:00:00Z" },
    { id: "used-final", kind: "close", executionOrderId: "exec-used", tradePlanId: "used", symbol: "BTC/USDT", realizedPnl: 2, createdAt: "2026-08-02T02:00:00Z" },
    { id: "control-final", kind: "close", executionOrderId: "exec-control", tradePlanId: "control", symbol: "BTC/USDT", realizedPnl: -1, createdAt: "2026-08-02T03:00:00Z" }
  );
  const report = buildReviewLearningAnalytics(db);
  assert.equal(report.used.trades, 1, "部分平仓必须聚合为一个交易生命周期");
  assert.equal(report.used.pnlUsdt, 3);
  assert.equal(report.comparableBaseline.trades, 2, "同交易对、同策略、同周期的历史未采用交易应进入对照组");
  assert.equal(report.comparable, false);
  assert.match(report.verdict, /样本不足/);
  assert.equal(report.byMemory[0].outcomes.trades, 1);
  assert.equal(report.byMemory[0].enoughEvidence, false);
});
