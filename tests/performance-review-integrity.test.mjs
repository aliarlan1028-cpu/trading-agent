import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { financiallyReconciledFills, installSystemTradeProvenance } from "./financial-fixtures.mjs";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "performance-review-test-"));

const { performanceReport } = await import("../server/accounting.mjs");
const { buildReviewAnalytics, runTradeReflection } = await import("../server/reviewEngine.mjs");
const { backfillReviewMemoryContexts, buildReviewLearningAnalytics, reviewMemoryMetadata } = await import("../server/reviewLearning.mjs");
const { buildLiveStrategyWeights } = await import("../server/strategyOptimizer.mjs");
const { ensureTradeReviewQueued, syncTradeReviewQueue } = await import("../server/tradeReviewQueue.mjs");

function baseDb() {
  return {
    user: { id: "owner-1", tenantId: "tenant_owner", isOwner: true },
    portfolio: { totalEquityUsdt: 100 },
    fills: [],
    reviews: [],
    memoryItems: [],
    tradePlans: [],
    executionOrders: [],
    markets: [],
    events: [],
    auditLogs: [],
    traces: []
  };
}

test("实盘绩效按交易生命周期聚合部分平仓并计算真实 USDT 峰谷回撤", () => {
  const db = baseDb();
  db.fills = financiallyReconciledFills([
    { id: "loss-b", kind: "close", executionOrderId: "e2", symbol: "ADA/USDT", realizedPnl: -4, createdAt: "2026-08-01T03:00:00Z" },
    { id: "loss-a", kind: "close", executionOrderId: "e2", symbol: "ADA/USDT", realizedPnl: -6, partial: true, createdAt: "2026-08-01T02:00:00Z" },
    { id: "win", kind: "close", executionOrderId: "e1", symbol: "BTC/USDT", realizedPnl: 10, createdAt: "2026-08-01T01:00:00Z" }
  ]);
  installSystemTradeProvenance(db);
  const report = performanceReport(db);
  assert.equal(report.trades, 2, "两次部分平仓必须聚合为一个交易生命周期");
  assert.equal(report.partialCloseFills, 1);
  assert.equal(report.winRatePct, 50);
  assert.equal(report.realizedMaxDrawdownUsdt, 10);
  assert.equal(report.realizedMaxDrawdownPctOfCurrentEquity, 10);
  assert.equal(report.maxDrawdownBasis, "closed_trade_pnl_curve/current_equity");
  assert.equal("maxDrawdownPct" in report, false, "不得再用模糊字段与模拟盘回撤混淆");
});

test("实盘胜负与总盈亏按记录费用后的净结果计算", () => {
  const db = baseDb();
  db.fills = financiallyReconciledFills([
    { id: "gross-entry", kind: "entry", executionOrderId: "fee-heavy", symbol: "ADA/USDT", feeUsdt: 0.02, createdAt: "2026-08-01T00:59:00Z" },
    { id: "gross-win-net-loss", kind: "close", executionOrderId: "fee-heavy", symbol: "ADA/USDT", realizedPnl: 0.05, feeUsdt: 0.08, createdAt: "2026-08-01T01:00:00Z" },
    { id: "clean-entry", kind: "entry", executionOrderId: "clean", symbol: "BTC/USDT", feeUsdt: 0.05, createdAt: "2026-08-01T01:59:00Z" },
    { id: "clean-win", kind: "close", executionOrderId: "clean", symbol: "BTC/USDT", realizedPnl: 1, feeUsdt: 0.1, createdAt: "2026-08-01T02:00:00Z" }
  ]);
  installSystemTradeProvenance(db);
  const report = performanceReport(db);
  assert.equal(report.wins, 1);
  assert.equal(report.losses, 1);
  assert.equal(report.totalPnlUsdt, 0.8);
  assert.equal(report.pnlBasis, "net_after_recorded_entry_and_close_fees_and_funding");
});

test("平仓确认立即进入幂等复盘队列，部分平仓合并到同一复盘", () => {
  const db = baseDb();
  const a = { id: "fa", kind: "close", executionOrderId: "exec-1", symbol: "SUI/USDT", direction: "short", realizedPnl: 0.2, createdAt: "2026-08-01T01:00:00Z" };
  const b = { id: "fb", kind: "close", executionOrderId: "exec-1", symbol: "SUI/USDT", direction: "short", realizedPnl: 0.3, createdAt: "2026-08-01T01:05:00Z" };
  db.fills = [a, b];
  installSystemTradeProvenance(db);
  ensureTradeReviewQueued(db, a);
  ensureTradeReviewQueued(db, b);
  assert.equal(db.reviews.length, 1);
  assert.equal(db.reviews[0].status, "pending");
  assert.deepEqual(db.reviews[0].fillIds, ["fa", "fb"]);
});

test("自动复盘完成后更新页面队列而不是只写隐藏记忆", async () => {
  const db = baseDb();
  db.fills = financiallyReconciledFills([{
    id: "close-small", kind: "close", executionOrderId: "exec-small", planId: "plan-small",
    symbol: "BTC/USDT", direction: "long", strategy: "manual_review", realizedPnl: 0.5,
    entryRationale: "结构回踩确认", createdAt: "2026-08-01T01:30:00Z"
  }]);
  db.tradePlans = [{ id: "plan-small", rationale: "结构回踩确认" }];
  installSystemTradeProvenance(db);
  const result = await runTradeReflection(db);
  assert.equal(result.reflected, 1);
  assert.equal(db.reviews.length, 1);
  assert.equal(db.reviews[0].status, "completed");
  assert.match(db.reviews[0].lesson, /盈利复盘/);
  assert.ok(db.fills.find((fill) => fill.id === "close-small").reflectedAt);
});

test("净盈亏为零的交易明确归类 flat，绝不写成亏损候选教训", async () => {
  const db = baseDb();
  db.fills = financiallyReconciledFills([{
    id: "close-flat", kind: "close", executionOrderId: "exec-flat", planId: "plan-flat",
    symbol: "BTC/USDT", direction: "long", strategy: "manual_review", realizedPnl: 0,
    entryRationale: "结构确认后入场", createdAt: "2026-08-01T01:30:00Z"
  }]);
  db.tradePlans = [{ id: "plan-flat", rationale: "结构确认后入场" }];
  installSystemTradeProvenance(db);
  const result = await runTradeReflection(db);
  assert.equal(result.lessons[0].outcome, "flat");
  assert.equal(result.lessons[0].win, null);
  assert.equal(result.memorized, 0);
  assert.equal(db.memoryItems.length, 0);
  assert.match(db.reviews[0].lesson, /持平复盘/);
  assert.doesNotMatch(db.reviews[0].lesson, /亏损复盘/);
  assert.equal(db.reviews[0].structuredAssessment.outcome, "flat");
});

test("旧版本已反思成交会幂等恢复为已完成而不会永远 pending", () => {
  const db = baseDb();
  db.fills = financiallyReconciledFills([{
    id: "legacy-close", kind: "close", executionOrderId: "legacy-exec",
    symbol: "ADA/USDT", direction: "short", realizedPnl: -1.25,
    reflectedAt: "2026-08-02T02:00:00Z", createdAt: "2026-08-02T01:00:00Z"
  }]);
  db.memoryItems = [{
    id: "legacy-memory", source: "auto_reflection", fillId: "legacy-close",
    content: "旧版本真实复盘结论", createdAt: "2026-08-02T02:00:00Z"
  }];
  installSystemTradeProvenance(db);

  const first = syncTradeReviewQueue(db);
  assert.deepEqual(first, { queued: 1, reconciled: 1, financialsBackfilled: 0 });
  assert.equal(db.reviews.length, 1);
  assert.equal(db.reviews[0].status, "completed");
  assert.equal(db.reviews[0].memoryItemId, "legacy-memory");
  assert.equal(db.reviews[0].lesson, "旧版本真实复盘结论");
  assert.equal(db.reviews[0].reconciledFromLegacyReflection, true);

  const second = syncTradeReviewQueue(db);
  assert.deepEqual(second, { queued: 0, reconciled: 0, financialsBackfilled: 0 });
  assert.equal(db.reviews.length, 1, "重复启动不得重复创建或复盘");
});

test("已完成复盘会回填完整生命周期净值与开仓费", () => {
  const db = baseDb();
  db.fills = financiallyReconciledFills([
    { id: "entry", kind: "entry", executionOrderId: "legacy-net", feeUsdt: 1, createdAt: "2026-08-02T00:00:00Z" },
    { id: "part", kind: "close", executionOrderId: "legacy-net", partial: true, realizedPnl: 2, feeUsdt: .2, createdAt: "2026-08-02T01:00:00Z" },
    { id: "final", kind: "close", executionOrderId: "legacy-net", realizedPnl: 8, feeUsdt: .3, fundingFeeUsdt: -.5, createdAt: "2026-08-02T02:00:00Z" }
  ]);
  db.reviews = [{ id: "old-review", type: "trade", tradeLifecycleKey: "legacy-net", status: "completed", realizedPnl: 8, feeUsdt: .3 }];
  installSystemTradeProvenance(db);
  const result = syncTradeReviewQueue(db);
  assert.equal(result.financialsBackfilled, 1);
  assert.deepEqual({ gross: db.reviews[0].realizedPnl, closeFee: db.reviews[0].feeUsdt, entryFee: db.reviews[0].entryFeeUsdt, funding: db.reviews[0].fundingFeeUsdt, net: db.reviews[0].netRealizedPnl }, { gross: 10, closeFee: .5, entryFee: 1, funding: -.5, net: 8 });
  assert.equal(syncTradeReviewQueue(db).financialsBackfilled, 0, "financial backfill must be idempotent");
});

test("费用把毛盈利翻为净亏损后，分析、记忆、学习效果与实盘策略权重全部按净值判定", () => {
  const db = baseDb();
  db.tradePlans = Array.from({ length: 10 }, (_, index) => ({
    id: `plan-${index}`,
    symbol: "ADA/USDT",
    timeframe: "1h",
    scenarioType: "breakout",
    strategy: "fee_flip",
    reviewLearning: { applied: index === 0 ? [{ memoryId: "mem-fee", influence: "avoided", note: "等待成本后仍为正" }] : [] }
  }));
  db.fills = financiallyReconciledFills(db.tradePlans.flatMap((plan, index) => [
    { id: `entry-${index}`, kind: "entry", executionOrderId: `life-${index}`, tradePlanId: plan.id, symbol: "ADA/USDT", strategy: "fee_flip", feeUsdt: 0.8, tenantId: "tenant_owner", ownerUserId: "owner-1", createdAt: `2026-08-01T${String(index).padStart(2, "0")}:00:00Z` },
    { id: `close-${index}`, kind: "close", executionOrderId: `life-${index}`, tradePlanId: plan.id, symbol: "ADA/USDT", strategy: "fee_flip", realizedPnl: 1, feeUsdt: 0.4, entryRationale: "突破确认", exitReason: "计划退出", tenantId: "tenant_owner", ownerUserId: "owner-1", createdAt: `2026-08-02T${String(index).padStart(2, "0")}:00:00Z` }
  ]));
  installSystemTradeProvenance(db);
  db.reviews = [{
    id: "review-fee", type: "trade", status: "completed", tradeLifecycleKey: "life-0", tradePlanId: "plan-0",
    memoryItemId: "mem-fee", fillIds: ["close-0"], symbol: "ADA/USDT", realizedPnl: 1,
    tenantId: "tenant_owner", ownerUserId: "owner-1"
  }];
  db.memoryItems = [{
    id: "mem-fee", source: "auto_reflection", fillId: "close-0", reviewId: "review-fee", title: "旧版毛盈利记忆",
    tenantId: "tenant_owner", ownerUserId: "owner-1",
    reviewContext: { schemaVersion: 1, symbol: "ADA/USDT", realizedPnl: 1, outcome: "win" }
  }];

  const queueMigration = syncTradeReviewQueue(db);
  assert.equal(queueMigration.financialsBackfilled, 10, "every completed lifecycle must have review financials before rebuilding memory context");
  const memoryMigration = backfillReviewMemoryContexts(db);
  assert.equal(memoryMigration.updated, 1);
  assert.equal(db.memoryItems[0].reviewContext.schemaVersion, 2);
  assert.equal(db.memoryItems[0].reviewContext.grossRealizedPnl, 1);
  assert.ok(Math.abs(db.memoryItems[0].reviewContext.netRealizedPnl + 0.2) < 1e-9);
  assert.equal(db.memoryItems[0].reviewContext.outcome, "loss");
  db.memoryItems[0].learningStatus = "active"; // 本测试聚焦净值口径；显式模拟 Owner 已批准该历史教训。
  assert.equal(backfillReviewMemoryContexts(db).updated, 0, "schema v2 migration must be idempotent");

  const metadata = reviewMemoryMetadata(db, db.memoryItems[0]);
  assert.equal(metadata.outcome, "loss");
  assert.ok(Math.abs(metadata.netRealizedPnl + 0.2) < 1e-9);

  for (const plan of db.tradePlans) Object.assign(plan, { tenantId: "tenant_owner", ownerUserId: "owner-1" });
  const analytics = buildReviewAnalytics(db, { principal: { tenantId: "tenant_owner", userId: "owner-1", isOwner: true } });
  const strategy = analytics.breakdowns.strategy.find((row) => row.key === "fee_flip");
  assert.deepEqual({ trades: strategy.trades, wins: strategy.wins, losses: strategy.losses, winRatePct: strategy.winRatePct }, { trades: 10, wins: 0, losses: 10, winRatePct: 0 });
  assert.ok(Math.abs(strategy.pnl + 2) < 1e-9);
  assert.ok(Math.abs(analytics.entryExitBias[0].pnl + 0.2) < 1e-9);
  assert.ok(Math.abs(analytics.summary.totalLossUsdt + 2) < 1e-9);

  const learning = buildReviewLearningAnalytics(db, { principal: { tenantId: "tenant_owner", userId: "owner-1", isOwner: true } });
  assert.equal(learning.used.trades, 1);
  assert.equal(learning.used.wins, 0);
  assert.equal(learning.used.pnlUsdt, -0.2);
  assert.equal(learning.byMemory[0].outcomes.pnlUsdt, -0.2);
  assert.equal(buildLiveStrategyWeights(db).fee_flip, 0.7, "net-loss live evidence must lower, never raise, the strategy weight");
});
