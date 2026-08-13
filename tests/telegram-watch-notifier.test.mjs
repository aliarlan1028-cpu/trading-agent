import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "telegram-watch-test-"));
process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED = "true";
process.env.TELEGRAM_WATCH_LANGUAGE = "en";
const { buildWatchTelegramMessage, queueDailyWatchDigest, queueWatchTelegramEvent, telegramWatchDeliveryHealth, telegramWatchStatus } = await import("../server/telegramWatchNotifier.mjs");

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

test("每日摘要即使没有活跃观察哨也发送明确的零状态，且按日期幂等", () => {
  process.env.TELEGRAM_WATCH_DAILY_DIGEST_ENABLED = "true";
  const db = { telegramWatchOutbox: [], watchTriggers: [] };
  const now = new Date("2026-08-14T00:05:00.000Z");
  const queued = queueDailyWatchDigest(db, { now });
  assert.equal(queued.status, "queued");
  assert.match(queued.item.message, /0 MARKETS/);
  assert.match(queued.item.message, /No active watch conditions/i);
  assert.equal(queueDailyWatchDigest(db, { now }).status, "duplicate");
  delete process.env.TELEGRAM_WATCH_DAILY_DIGEST_ENABLED;
});

test("Telegram 健康状态区分配置可用与真实回执", () => {
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  process.env.TELEGRAM_CHAT_ID = "123";
  const db = { telegramWatchOutbox: [{
    id: "digest", idempotencyKey: "watch_digest:2026-08-14", eventType: "daily_digest",
    status: "sent", sentAt: "2026-08-14T00:05:02.000Z", attempts: 1
  }] };
  const health = telegramWatchDeliveryHealth(db, Date.parse("2026-08-14T01:00:00.000Z"));
  assert.equal(health.operational, true);
  assert.equal(health.todayDigest.status, "sent");
  assert.equal(health.lastDigestSentAt, "2026-08-14T00:05:02.000Z");
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
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
  const watch = { id: "trigger", version: 1, symbol: "SOL/USDT", kind: "price_above", level: 210, direction: "long", thesis: "1H 上升结构仍在，等待突破确认后评估顺势做多", triggerMeaning: "站上阻力只增强做多情景，仍需复核主动买盘", note: "突破后重新确认主动买盘", triggerPrice: 210.2, triggeredAt: "2026-08-12T03:00:00.000Z", priority: "primary", status: "triggered" };
  const message = buildWatchTelegramMessage({ watchTriggers: [] }, watch, "triggered", { autoAnalyze: true }, "en");
  assert.match(message, /watch triggered/i);
  assert.match(message, /AI re-analysis requested/);
  assert.match(message, /Long scenario/);
  assert.match(message, /Original view/);
  assert.match(message, /not yet an entry signal/i);
  assert.doesNotMatch(message, /突破后重新确认主动买盘/, "英文触发消息不得夹带中文备注");
});

test("关键失效采用紧凑动作模板，不发送整块观察看板", () => {
  const watch = { id: "invalid", symbol: "BTC/USDT", kind: "price_below", level: 62000, direction: "long", thesis: "1H 保持 HH/HL，原计划等待回踩后评估做多", closeReason: "系统暂停期间价格已越过条件", priority: "primary", status: "invalidated" };
  const message = buildWatchTelegramMessage({ watchTriggers: [] }, watch, "invalidated", {}, "zh");
  assert.match(message, /做多情景观察条件已作废/);
  assert.match(message, /关联原判断：1H 保持 HH\/HL/);
  assert.match(message, /系统不再盯这条条件/);
  assert.doesNotMatch(message, /辅助条件|观察看板|📍|🎯|🧭/);
});

test("中文观察哨命中完整说明方向、原判断、条件含义与下一步", () => {
  const watch = { id: "short_trigger", symbol: "SUI/USDT", kind: "enter_zone", levelLow: 0.704, levelHigh: 0.71, direction: "short", thesis: "1H 下行结构未反转，等待反弹到供应区评估做空", triggerMeaning: "价格回到供应区；检查 15m 反弹衰竭与主动卖盘后再决定是否做空", purpose: "confirmation", priority: "primary", status: "triggered", triggerPrice: 0.706, triggeredAt: "2026-08-13T06:20:00.000Z" };
  const message = buildWatchTelegramMessage({ watchTriggers: [] }, watch, "triggered", { autoAnalyze: true }, "zh");
  assert.match(message, /做空情景观察条件命中/);
  assert.match(message, /原判断：1H 下行结构未反转/);
  assert.match(message, /这代表：价格回到供应区/);
  assert.match(message, /目前还不是入场信号/);
  assert.match(message, /已唤起 AI 重新分析/);
});

test("观察哨英文 HTML 会转义动态文本，避免 Telegram 格式失效", () => {
  const watch = { id: "escape", version: 1, symbol: "BTC&ETH/USDT", kind: "price_above", level: 100, note: "Wait < confirm & review", priority: "primary", purpose: "decision", status: "triggered", triggerPrice: 101, triggeredAt: "2026-08-12T02:00:00.000Z" };
  const message = buildWatchTelegramMessage({ watchTriggers: [] }, watch, "triggered", { autoAnalyze: true }, "en");
  assert.match(message, /BTC&amp;ETH\/USDT/);
  assert.match(message, /Wait &lt; confirm &amp; review/);
  assert.doesNotMatch(message, /Wait < confirm & review/);
});
