import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-watch-test-"));
process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED = "true";
process.env.TELEGRAM_WATCH_LANGUAGE = "en";
const { buildWatchTelegramMessage, queueDailyWatchDigest, queueWatchTelegramEvent, telegramWatchStatus } = await import("../server/telegramWatchNotifier.mjs");

test("观察哨登记和例行更新不打扰 Telegram", () => {
  const watch = { id: "w1", version: 1, symbol: "BTC/USDT", kind: "price_below", level: 60000, note: "结构失效", priority: "primary", purpose: "invalidation", status: "active", analysisId: "run_1", analysisAt: "2026-08-12T00:00:00.000Z", expiresAt: new Date().toISOString() };
  const db = { telegramWatchOutbox: [], watchTriggers: [watch] };
  const first = queueWatchTelegramEvent(db, watch, "registered");
  const duplicate = queueWatchTelegramEvent(db, watch, "registered");
  assert.equal(first.status, "suppressed_low_value");
  assert.equal(duplicate.status, "suppressed_low_value");
  assert.equal(db.telegramWatchOutbox.length, 0);
  watch.version = 2;
  assert.equal(queueWatchTelegramEvent(db, watch, "updated").status, "suppressed_low_value");
});

test("同轮多个条件及撤销均只保留在应用内", () => {
  const primary = { id: "p", version: 1, symbol: "BTC/USDT", kind: "price_above", level: 65000, priority: "primary", purpose: "decision", status: "active", analysisId: "run_2", analysisAt: "2026-08-12T01:00:00.000Z", expiresAt: "2026-08-13T01:00:00.000Z" };
  const secondary = { id: "s", version: 1, symbol: "BTC/USDT", kind: "price_below", level: 62000, priority: "secondary", purpose: "invalidation", status: "active", analysisId: "run_2", analysisAt: primary.analysisAt, expiresAt: primary.expiresAt };
  const db = { telegramWatchOutbox: [], watchTriggers: [secondary, primary] };
  assert.equal(queueWatchTelegramEvent(db, primary, "registered").status, "suppressed_low_value");
  assert.equal(queueWatchTelegramEvent(db, secondary, "registered").status, "suppressed_low_value");
  secondary.status = "cancelled";
  assert.equal(queueWatchTelegramEvent(db, secondary, "cancelled").status, "suppressed_low_value");
  assert.equal(db.telegramWatchOutbox.length, 0);
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
  assert.match(english, /interrupts only when a primary condition triggers/i);
  assert.doesNotMatch(english, /等待回踩确认/, "英文模板不得夹带无法可靠翻译的中文备注");
  const chinese = buildWatchTelegramMessage(db, watch, "registered", {}, "zh");
  assert.match(chinese, /观察条件推送预览/);
  assert.match(chinese, /回踩进入 4,200-4,250 区间/);
  assert.match(chinese, /只在主条件命中或当前判断关键失效时打扰/);
});

test("观察哨触发消息明确区分触发与下单", () => {
  const watch = { id: "trigger", version: 1, symbol: "SOL/USDT", kind: "price_above", level: 210, note: "突破后重新确认主动买盘", triggerPrice: 210.2, triggeredAt: "2026-08-12T03:00:00.000Z", priority: "primary", status: "triggered" };
  const message = buildWatchTelegramMessage({ watchTriggers: [] }, watch, "triggered", { autoAnalyze: true }, "en");
  assert.match(message, /watch triggered/i);
  assert.match(message, /AI re-analysis requested/);
  assert.match(message, /do not trade from this stale condition/i);
  assert.doesNotMatch(message, /突破后重新确认主动买盘/, "英文触发消息不得夹带中文备注");
});

test("关键失效采用紧凑动作模板，不发送整块观察看板", () => {
  const watch = { id: "invalid", symbol: "BTC/USDT", kind: "price_below", level: 62000, closeReason: "结构低点失守", priority: "primary", status: "invalidated" };
  const message = buildWatchTelegramMessage({ watchTriggers: [] }, watch, "invalidated", {}, "zh");
  assert.match(message, /原判断失效/);
  assert.match(message, /停止沿用旧判断/);
  assert.doesNotMatch(message, /辅助条件|观察看板|📍|🎯|🧭/);
});

test("观察哨英文 HTML 会转义动态文本，避免 Telegram 格式失效", () => {
  const watch = { id: "escape", version: 1, symbol: "BTC&ETH/USDT", kind: "price_above", level: 100, note: "Wait < confirm & review", priority: "primary", purpose: "decision", status: "triggered", triggerPrice: 101, triggeredAt: "2026-08-12T02:00:00.000Z" };
  const message = buildWatchTelegramMessage({ watchTriggers: [] }, watch, "triggered", { autoAnalyze: true }, "en");
  assert.match(message, /BTC&amp;ETH\/USDT/);
  assert.match(message, /Wait &lt; confirm &amp; review/);
  assert.doesNotMatch(message, /Wait < confirm & review/);
});
