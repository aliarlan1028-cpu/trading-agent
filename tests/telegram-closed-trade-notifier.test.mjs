import test from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_CHAT_ID = "test-chat";
process.env.TELEGRAM_PROFIT_POSTER_ENABLED = "true";
process.env.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT = "0";

const { dispatchClosedTradePosterOutbox, queueClosedTradeProfitPosters } = await import("../server/telegramNotifier.mjs");

test("平仓盈利海报按交易生命周期永久幂等，部分平仓聚合后只入队一次", () => {
  const db = { meta: { telegramClosedTradePosterStartedAt: "2026-08-12T00:00:00Z" }, telegramPosterOutbox: [], executionOrders: [
    { id: "exec-1", filledPrice: 100, notionalUsdt: 30, leverage: 2 }
  ], fills: [
    { id: "entry", kind: "entry", executionOrderId: "exec-1", symbol: "BTC/USDT", direction: "long", price: 100, quantity: 0.3, notionalUsdt: 30, createdAt: "2026-08-12T00:30:00Z" },
    { id: "partial", kind: "close", partial: true, executionOrderId: "exec-1", symbol: "BTC/USDT", direction: "long", realizedPnl: 2, quantity: 0.1, createdAt: "2026-08-12T01:00:00Z" },
    { id: "final", kind: "close", partial: false, executionOrderId: "exec-1", symbol: "BTC/USDT", direction: "long", realizedPnl: 3, quantity: 0.2, createdAt: "2026-08-12T02:00:00Z" }
  ] };
  assert.equal(queueClosedTradeProfitPosters(db).queued, 1);
  assert.equal(db.telegramPosterOutbox[0].trade.realizedPnl, 5);
  assert.equal(db.telegramPosterOutbox[0].trade.entryPrice, 100);
  assert.equal(db.telegramPosterOutbox[0].trade.entryNotionalUsdt, 30);
  assert.equal(db.telegramPosterOutbox[0].trade.marginUsdt, 15);
  assert.deepEqual(new Set(db.telegramPosterOutbox[0].fillIds), new Set(["partial", "final"]));
  assert.equal(queueClosedTradeProfitPosters(db).queued, 0);
  db.telegramPosterOutbox[0].status = "sent";
  assert.equal(queueClosedTradeProfitPosters(db).queued, 0);
  db.telegramPosterOutbox = [];
  db.fills.find((fill) => fill.kind === "close").telegramClosedTradePoster = { status: "sent" };
  assert.equal(queueClosedTradeProfitPosters(db).queued, 0, "outbox 清理后仍由成交记录阻止历史补发");
});

test("未完成的部分平仓不产生海报", () => {
  const db = { meta: { telegramClosedTradePosterStartedAt: "2026-08-12T00:00:00Z" }, telegramPosterOutbox: [], fills: [
    { id: "partial", kind: "close", partial: true, executionOrderId: "exec-2", symbol: "ETH/USDT", realizedPnl: 4, createdAt: "2026-08-12T01:00:00Z" }
  ] };
  assert.equal(queueClosedTradeProfitPosters(db).queued, 0);
});

test("首次启用建立水位，不补发历史盈利交易", () => {
  const db = { meta: {}, telegramPosterOutbox: [], fills: [
    { id: "old", kind: "close", executionOrderId: "exec-old", symbol: "SOL/USDT", realizedPnl: 9, createdAt: "2026-08-11T01:00:00Z" }
  ] };
  assert.equal(queueClosedTradeProfitPosters(db).status, "initialized");
  assert.equal(db.telegramPosterOutbox.length, 0);
});

test("毛盈利但成本后净亏损的完整交易不得进入盈利海报队列", () => {
  const db = { meta: { telegramClosedTradePosterStartedAt: "2026-08-12T00:00:00Z" }, telegramPosterOutbox: [], fills: [
    { id: "entry-fee", kind: "entry", executionOrderId: "exec-fee", symbol: "ADA/USDT", feeUsdt: 0.8, createdAt: "2026-08-12T00:30:00Z" },
    { id: "close-fee", kind: "close", executionOrderId: "exec-fee", symbol: "ADA/USDT", realizedPnl: 1, feeUsdt: 0.4, createdAt: "2026-08-12T01:00:00Z" }
  ] };
  assert.equal(queueClosedTradeProfitPosters(db).queued, 0);
  assert.equal(db.telegramPosterOutbox.length, 0);
});

test("旧 pending 盈利海报发送前按权威净值重核并取消，不触网不计尝试", async () => {
  const item = {
    id: "old-pending", idempotencyKey: "closed_trade:exec-old", tradeLifecycleKey: "exec-old",
    fillIds: ["close-old"], trade: { realizedPnl: 1 }, status: "pending", attempts: 0,
    nextAttemptAt: "2026-08-12T00:00:00Z", createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z"
  };
  const db = { telegramPosterOutbox: [item], fills: [
    { id: "entry-old", kind: "entry", executionOrderId: "exec-old", feeUsdt: 0.8, createdAt: "2026-08-12T00:30:00Z" },
    { id: "close-old", kind: "close", executionOrderId: "exec-old", realizedPnl: 1, feeUsdt: 0.4, createdAt: "2026-08-12T01:00:00Z" }
  ] };
  const result = await dispatchClosedTradePosterOutbox(db);
  assert.equal(item.status, "cancelled");
  assert.equal(item.attempts, 0);
  assert.equal(item.lastError, "net_pnl_below_threshold");
  assert.equal(result.sent, 0);
  assert.equal(result.skipPersist, false);
});

test("底层权威生命周期已缺失的旧 pending 海报直接取消", async () => {
  const item = {
    id: "gone-pending", idempotencyKey: "closed_trade:gone", tradeLifecycleKey: "gone",
    fillIds: ["gone"], trade: { realizedPnl: 9 }, status: "pending", attempts: 0,
    nextAttemptAt: "2026-08-12T00:00:00Z", createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z"
  };
  const db = { telegramPosterOutbox: [item], fills: [] };
  const result = await dispatchClosedTradePosterOutbox(db);
  assert.equal(item.status, "cancelled");
  assert.equal(item.attempts, 0);
  assert.equal(item.lastError, "authoritative_lifecycle_missing");
  assert.equal(result.sent, 0);
  assert.equal(result.skipPersist, false);
});
