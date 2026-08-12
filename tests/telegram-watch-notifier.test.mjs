import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-watch-test-"));
process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED = "true";
process.env.TELEGRAM_WATCH_LANGUAGE = "en";
const { buildWatchTelegramMessage, queueDailyWatchDigest, queueWatchTelegramEvent, telegramWatchStatus } = await import("../server/telegramWatchNotifier.mjs");

test("观察哨 Telegram 按币种合并当前看板，重复版本幂等且不包含账户事实", () => {
  const watch = { id: "w1", version: 1, symbol: "BTC/USDT", kind: "price_below", level: 60000, note: "结构失效", priority: "primary", purpose: "invalidation", status: "active", analysisId: "run_1", analysisAt: "2026-08-12T00:00:00.000Z", expiresAt: new Date().toISOString() };
  const db = { telegramWatchOutbox: [], watchTriggers: [watch] };
  const first = queueWatchTelegramEvent(db, watch, "registered");
  const duplicate = queueWatchTelegramEvent(db, watch, "registered");
  assert.equal(first.status, "queued");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(db.telegramWatchOutbox.length, 1);
  assert.match(first.item.message, /BTC\/USDT/);
  assert.match(first.item.message, /NEW WATCH/);
  assert.match(first.item.message, /CURRENT FOCUS/);
  assert.match(first.item.message, /replaces earlier alerts for BTC\/USDT/i);
  assert.match(first.item.message, /Market View/);
  assert.match(first.item.message, /Primary Watch/);
  assert.match(first.item.message, /Action/);
  assert.match(first.item.message, /never bypasses risk controls or places an order/i);
  assert.equal(first.item.parseMode, "HTML");
  assert.equal(first.item.language, "en");
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
  assert.match(db.telegramWatchOutbox[0].message, /Supporting Conditions · 1/);
  assert.match(db.telegramWatchOutbox[0].message, /Invalidation/);
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

test("观察哨推送语言独立于界面语言且可切回中文", () => {
  const watch = { id: "lang", version: 1, symbol: "ETH/USDT", kind: "enter_zone", levelLow: 4200, levelHigh: 4250, note: "等待回踩确认", priority: "primary", purpose: "confirmation", status: "active", analysisId: "run_lang", analysisAt: "2026-08-12T02:00:00.000Z", expiresAt: "2026-08-13T02:00:00.000Z" };
  const db = { watchTriggers: [watch] };
  assert.equal(telegramWatchStatus().language, "en");
  const english = buildWatchTelegramMessage(db, watch, "registered", {}, "en");
  assert.match(english, /ETH\/USDT enters the 4,200–4,250 zone/);
  assert.match(english, /setup remains incomplete until the primary confirmation condition/i);
  assert.doesNotMatch(english, /等待回踩确认/, "英文模板不得夹带无法可靠翻译的中文备注");
  const chinese = buildWatchTelegramMessage(db, watch, "registered", {}, "zh");
  assert.match(chinese, /新观察哨/);
  assert.match(chinese, /回踩进入 4,200-4,250 区间/);
  assert.match(chinese, /等待回踩确认/);
});

test("观察哨触发消息明确区分触发与下单", () => {
  const watch = { id: "trigger", version: 1, symbol: "SOL/USDT", kind: "price_above", level: 210, triggerPrice: 210.2, triggeredAt: "2026-08-12T03:00:00.000Z", priority: "primary", status: "triggered" };
  const message = buildWatchTelegramMessage({ watchTriggers: [] }, watch, "triggered", { autoAnalyze: true }, "en");
  assert.match(message, /WATCH TRIGGERED/);
  assert.match(message, /Fresh AI analysis has been requested/);
  assert.match(message, /A trigger is not an order/);
});

test("观察哨英文 HTML 会转义动态文本，避免 Telegram 格式失效", () => {
  const watch = { id: "escape", version: 1, symbol: "BTC&ETH/USDT", kind: "price_above", level: 100, note: "Wait < confirm & review", priority: "primary", purpose: "decision", status: "active", analysisTitle: "A < B & C", analysisAt: "2026-08-12T02:00:00.000Z", expiresAt: "2026-08-13T02:00:00.000Z" };
  const message = buildWatchTelegramMessage({ watchTriggers: [watch] }, watch, "registered", {}, "en");
  assert.match(message, /BTC&amp;ETH\/USDT/);
  assert.match(message, /A &lt; B &amp; C/);
  assert.match(message, /Wait &lt; confirm &amp; review/);
  assert.doesNotMatch(message, /A < B/);
});
