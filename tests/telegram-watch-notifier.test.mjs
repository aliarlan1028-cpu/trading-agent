import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-watch-test-"));
process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED = "true";
const { queueDailyWatchDigest, queueWatchTelegramEvent } = await import("../server/telegramWatchNotifier.mjs");

test("观察哨 Telegram 按币种合并当前看板，重复版本幂等且不包含账户事实", () => {
  const watch = { id: "w1", version: 1, symbol: "BTC/USDT", kind: "price_below", level: 60000, note: "结构失效", priority: "primary", purpose: "invalidation", status: "active", analysisId: "run_1", analysisAt: "2026-08-12T00:00:00.000Z", expiresAt: new Date().toISOString() };
  const db = { telegramWatchOutbox: [], watchTriggers: [watch] };
  const first = queueWatchTelegramEvent(db, watch, "registered");
  const duplicate = queueWatchTelegramEvent(db, watch, "registered");
  assert.equal(first.status, "queued");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(db.telegramWatchOutbox.length, 1);
  assert.match(first.item.message, /BTC\/USDT/);
  assert.match(first.item.message, /主观察哨/);
  assert.match(first.item.message, /以本条为准/);
  assert.doesNotMatch(first.item.message, /余额|API|权益/);
  watch.version = 2;
  assert.equal(queueWatchTelegramEvent(db, watch, "updated").status, "coalesced");
  assert.equal(db.telegramWatchOutbox.length, 1, "待发送的同币种看板应原位更新，不能连发两条");
});

test("同轮多个条件只保留一条待发送看板，辅助撤销不推送", () => {
  const primary = { id: "p", version: 1, symbol: "BTC/USDT", kind: "price_above", level: 65000, priority: "primary", purpose: "decision", status: "active", analysisId: "run_2", analysisAt: "2026-08-12T01:00:00.000Z", expiresAt: "2026-08-13T01:00:00.000Z" };
  const secondary = { id: "s", version: 1, symbol: "BTC/USDT", kind: "price_below", level: 62000, priority: "secondary", purpose: "invalidation", status: "active", analysisId: "run_2", analysisAt: primary.analysisAt, expiresAt: primary.expiresAt };
  const db = { telegramWatchOutbox: [], watchTriggers: [secondary, primary] };
  assert.equal(queueWatchTelegramEvent(db, primary, "registered").status, "queued");
  assert.equal(queueWatchTelegramEvent(db, secondary, "registered").status, "duplicate", "看板内容已含两个条件时无需再次排队");
  assert.match(db.telegramWatchOutbox[0].message, /辅助条件（1/);
  secondary.status = "cancelled";
  assert.equal(queueWatchTelegramEvent(db, secondary, "cancelled").status, "suppressed");
  assert.equal(db.telegramWatchOutbox.length, 1);
});

test("每日观察哨摘要默认关闭，不产生消息", () => {
  const db = { telegramWatchOutbox: [], watchTriggers: [{ id: "w", status: "active" }] };
  delete process.env.TELEGRAM_WATCH_DAILY_DIGEST_ENABLED;
  assert.equal(queueDailyWatchDigest(db).status, "disabled");
  assert.equal(db.telegramWatchOutbox.length, 0);
});
