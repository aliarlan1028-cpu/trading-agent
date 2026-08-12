import test from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_BOT_TOKEN = "test-token";
process.env.TELEGRAM_CHAT_ID = "test-chat";
process.env.TELEGRAM_PROFIT_POSTER_ENABLED = "true";
process.env.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT = "0";

const { queueClosedTradeProfitPosters } = await import("../server/telegramNotifier.mjs");

test("平仓盈利海报按交易生命周期永久幂等，部分平仓聚合后只入队一次", () => {
  const db = { meta: { telegramClosedTradePosterStartedAt: "2026-08-12T00:00:00Z" }, telegramPosterOutbox: [], fills: [
    { id: "partial", kind: "close", partial: true, executionOrderId: "exec-1", symbol: "BTC/USDT", direction: "long", realizedPnl: 2, quantity: 0.1, createdAt: "2026-08-12T01:00:00Z" },
    { id: "final", kind: "close", partial: false, executionOrderId: "exec-1", symbol: "BTC/USDT", direction: "long", realizedPnl: 3, quantity: 0.2, createdAt: "2026-08-12T02:00:00Z" }
  ] };
  assert.equal(queueClosedTradeProfitPosters(db).queued, 1);
  assert.equal(db.telegramPosterOutbox[0].trade.realizedPnl, 5);
  assert.deepEqual(new Set(db.telegramPosterOutbox[0].fillIds), new Set(["partial", "final"]));
  assert.equal(queueClosedTradeProfitPosters(db).queued, 0);
  db.telegramPosterOutbox[0].status = "sent";
  assert.equal(queueClosedTradeProfitPosters(db).queued, 0);
  db.telegramPosterOutbox = [];
  db.fills[0].telegramClosedTradePoster = { status: "sent" };
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
