import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-watch-test-"));
process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED = "true";
const { queueDailyWatchDigest, queueWatchTelegramEvent } = await import("../server/telegramWatchNotifier.mjs");

test("观察哨 Telegram outbox 用 watch/type/version 幂等，不包含账户事实", () => {
  const db = { telegramWatchOutbox: [] };
  const watch = { id: "w1", version: 1, symbol: "BTC/USDT", kind: "price_below", level: 60000, note: "结构失效", expiresAt: new Date().toISOString() };
  const first = queueWatchTelegramEvent(db, watch, "registered");
  const duplicate = queueWatchTelegramEvent(db, watch, "registered");
  assert.equal(first.status, "queued");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(db.telegramWatchOutbox.length, 1);
  assert.match(first.item.message, /BTC\/USDT/);
  assert.doesNotMatch(first.item.message, /余额|API|权益/);
  watch.version = 2;
  assert.equal(queueWatchTelegramEvent(db, watch, "updated").status, "queued");
});

test("每日观察哨摘要默认关闭，不产生消息", () => {
  const db = { telegramWatchOutbox: [], watchTriggers: [{ id: "w", status: "active" }] };
  delete process.env.TELEGRAM_WATCH_DAILY_DIGEST_ENABLED;
  assert.equal(queueDailyWatchDigest(db).status, "disabled");
  assert.equal(db.telegramWatchOutbox.length, 0);
});
