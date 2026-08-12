import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "performance-review-test-"));

const { performanceReport } = await import("../server/accounting.mjs");
const { runTradeReflection } = await import("../server/reviewEngine.mjs");
const { ensureTradeReviewQueued, syncTradeReviewQueue } = await import("../server/tradeReviewQueue.mjs");

function baseDb() {
  return {
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
  db.fills = [
    { id: "loss-b", kind: "close", executionOrderId: "e2", symbol: "ADA/USDT", realizedPnl: -4, createdAt: "2026-08-01T03:00:00Z" },
    { id: "loss-a", kind: "close", executionOrderId: "e2", symbol: "ADA/USDT", realizedPnl: -6, partial: true, createdAt: "2026-08-01T02:00:00Z" },
    { id: "win", kind: "close", executionOrderId: "e1", symbol: "BTC/USDT", realizedPnl: 10, createdAt: "2026-08-01T01:00:00Z" }
  ];
  const report = performanceReport(db);
  assert.equal(report.trades, 2, "两次部分平仓必须聚合为一个交易生命周期");
  assert.equal(report.partialCloseFills, 1);
  assert.equal(report.winRatePct, 50);
  assert.equal(report.realizedMaxDrawdownUsdt, 10);
  assert.equal(report.realizedMaxDrawdownPctOfCurrentEquity, 10);
  assert.equal(report.maxDrawdownBasis, "closed_trade_pnl_curve/current_equity");
  assert.equal("maxDrawdownPct" in report, false, "不得再用模糊字段与模拟盘回撤混淆");
});

test("平仓确认立即进入幂等复盘队列，部分平仓合并到同一复盘", () => {
  const db = baseDb();
  const a = { id: "fa", kind: "close", executionOrderId: "exec-1", symbol: "SUI/USDT", direction: "short", realizedPnl: 0.2, createdAt: "2026-08-01T01:00:00Z" };
  const b = { id: "fb", kind: "close", executionOrderId: "exec-1", symbol: "SUI/USDT", direction: "short", realizedPnl: 0.3, createdAt: "2026-08-01T01:05:00Z" };
  ensureTradeReviewQueued(db, a);
  ensureTradeReviewQueued(db, b);
  assert.equal(db.reviews.length, 1);
  assert.equal(db.reviews[0].status, "pending");
  assert.deepEqual(db.reviews[0].fillIds, ["fa", "fb"]);
});

test("自动复盘完成后更新页面队列而不是只写隐藏记忆", async () => {
  const db = baseDb();
  db.fills = [{
    id: "close-small", kind: "close", executionOrderId: "exec-small", planId: "plan-small",
    symbol: "BTC/USDT", direction: "long", strategy: "manual_review", realizedPnl: 0.5,
    entryRationale: "结构回踩确认", createdAt: "2026-08-01T01:30:00Z"
  }];
  db.tradePlans = [{ id: "plan-small", rationale: "结构回踩确认" }];
  const result = await runTradeReflection(db);
  assert.equal(result.reflected, 1);
  assert.equal(db.reviews.length, 1);
  assert.equal(db.reviews[0].status, "completed");
  assert.match(db.reviews[0].lesson, /盈利复盘/);
  assert.ok(db.fills[0].reflectedAt);
});

test("旧版本已反思成交会幂等恢复为已完成而不会永远 pending", () => {
  const db = baseDb();
  db.fills = [{
    id: "legacy-close", kind: "close", executionOrderId: "legacy-exec",
    symbol: "ADA/USDT", direction: "short", realizedPnl: -1.25,
    reflectedAt: "2026-08-02T02:00:00Z", createdAt: "2026-08-02T01:00:00Z"
  }];
  db.memoryItems = [{
    id: "legacy-memory", source: "auto_reflection", fillId: "legacy-close",
    content: "旧版本真实复盘结论", createdAt: "2026-08-02T02:00:00Z"
  }];

  const first = syncTradeReviewQueue(db);
  assert.deepEqual(first, { queued: 1, reconciled: 1 });
  assert.equal(db.reviews.length, 1);
  assert.equal(db.reviews[0].status, "completed");
  assert.equal(db.reviews[0].memoryItemId, "legacy-memory");
  assert.equal(db.reviews[0].lesson, "旧版本真实复盘结论");
  assert.equal(db.reviews[0].reconciledFromLegacyReflection, true);

  const second = syncTradeReviewQueue(db);
  assert.deepEqual(second, { queued: 0, reconciled: 0 });
  assert.equal(db.reviews.length, 1, "重复启动不得重复创建或复盘");
});
