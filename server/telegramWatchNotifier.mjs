import crypto from "node:crypto";
import { appendAudit, nowIso } from "./store.mjs";
import { sendTelegramText } from "./telegramNotifier.mjs";

function enabled(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

export function telegramWatchStatus() {
  return {
    enabled: enabled(process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED, false),
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_WATCH_CHAT_ID || process.env.TELEGRAM_CHAT_ID)),
    chatSource: process.env.TELEGRAM_WATCH_CHAT_ID ? "watch_override" : "primary_telegram_chat",
    dailyDigestEnabled: enabled(process.env.TELEGRAM_WATCH_DAILY_DIGEST_ENABLED, false)
  };
}

function watchLevel(watch) {
  if (watch.kind === "enter_zone") return `${watch.levelLow}–${watch.levelHigh}`;
  return String(watch.level ?? "-");
}

function eventLabel(type) {
  return ({ registered: "已登记", updated: "已更新", triggered: "已触发", expired: "已过期", cancelled: "已撤销", invalidated: "已作废" })[type] || type;
}

function watchMessage(watch, eventType, context = {}) {
  const condition = watch.kind === "price_above" ? "向上穿越" : watch.kind === "price_below" ? "向下穿越" : "进入区间";
  const lines = [
    `🔭 观察哨${eventLabel(eventType)}`,
    `标的：${watch.symbol}`,
    `条件：${condition} ${watchLevel(watch)}`,
    `观察哨：${watch.id}`
  ];
  if (watch.note) lines.push(`原因：${String(watch.note).replace(/\s+/g, " ").slice(0, 300)}`);
  if (watch.expiresAt && ["registered", "updated"].includes(eventType)) lines.push(`有效期：${watch.expiresAt}`);
  if (eventType === "triggered") {
    lines.push(`触发价：${watch.triggerPrice ?? context.triggerPrice ?? "-"}`);
    lines.push(`触发时间：${watch.triggeredAt || context.at || nowIso()}`);
    lines.push(`AI 唤醒：${context.autoAnalyze ? "已请求自主巡检" : "未自动唤醒，请人工查看"}`);
  }
  if (watch.closeReason) lines.push(`结束原因：${String(watch.closeReason).slice(0, 240)}`);
  return lines.join("\n");
}

export function queueWatchTelegramEvent(db, watch, eventType, context = {}) {
  const status = telegramWatchStatus();
  if (!status.enabled || !watch?.id) return { status: "disabled" };
  db.telegramWatchOutbox ||= [];
  const version = Number(watch.version || 1);
  const key = `${watch.id}:${eventType}:${version}`;
  const existing = db.telegramWatchOutbox.find((item) => item.idempotencyKey === key);
  if (existing) return { status: "duplicate", item: existing };
  const item = {
    id: `tgwatch_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 20)}`,
    idempotencyKey: key,
    watchId: watch.id,
    eventType,
    status: "pending",
    attempts: 0,
    nextAttemptAt: nowIso(),
    message: watchMessage(watch, eventType, context),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  db.telegramWatchOutbox.unshift(item);
  return { status: "queued", item };
}

export function queueDailyWatchDigest(db) {
  const status = telegramWatchStatus();
  if (!status.enabled || !status.dailyDigestEnabled) return { status: "disabled" };
  const watches = (db.watchTriggers || []).filter((watch) => watch.status === "active");
  if (!watches.length) return { status: "empty" };
  db.telegramWatchOutbox ||= [];
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const key = `watch_digest:${date}`;
  const existing = db.telegramWatchOutbox.find((item) => item.idempotencyKey === key);
  if (existing) return { status: "duplicate", item: existing };
  const message = [`🔭 今日活跃观察哨（${watches.length}）`, ...watches.map((watch) => `• ${watch.symbol} · ${watch.kind} ${watchLevel(watch)} · 到期 ${watch.expiresAt}`)].join("\n");
  const item = {
    id: `tgwatch_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 20)}`,
    idempotencyKey: key, eventType: "daily_digest", status: "pending", attempts: 0,
    nextAttemptAt: nowIso(), message: message.slice(0, 4000), createdAt: nowIso(), updatedAt: nowIso()
  };
  db.telegramWatchOutbox.unshift(item);
  return { status: "queued", item };
}

export async function dispatchTelegramWatchOutbox(db, options = {}) {
  const status = telegramWatchStatus();
  if (!status.enabled) return { status: "disabled", checked: 0, skipPersist: true };
  if (!status.configured) return { status: "unconfigured", checked: 0, skipPersist: true };
  const now = Date.now();
  const pending = (db.telegramWatchOutbox || []).filter((item) =>
    ["pending", "retry"].includes(item.status) && new Date(item.nextAttemptAt || 0).getTime() <= now
  ).slice(0, Math.max(1, Number(options.limit || 10)));
  let sent = 0;
  for (const item of pending) {
    item.attempts = Number(item.attempts || 0) + 1;
    item.updatedAt = nowIso();
    try {
      const result = await sendTelegramText(item.message, { chatId: process.env.TELEGRAM_WATCH_CHAT_ID || process.env.TELEGRAM_CHAT_ID });
      item.status = "sent";
      item.sentAt = nowIso();
      item.telegramMessageId = result?.message_id;
      item.lastError = null;
      sent += 1;
      appendAudit(db, `Telegram 观察哨消息已推送：${item.eventType}`, item.watchId || item.id, "TelegramWatchNotifier", "info");
    } catch (error) {
      item.lastError = String(error.message || error).slice(0, 180);
      if (item.attempts >= 5) {
        item.status = "failed";
        appendAudit(db, `Telegram 观察哨推送最终失败：${item.lastError}`, item.watchId || item.id, "TelegramWatchNotifier", "warning");
      } else {
        item.status = "retry";
        item.nextAttemptAt = new Date(Date.now() + Math.min(30, 2 ** item.attempts) * 60_000).toISOString();
      }
    }
  }
  return { status: "ok", checked: pending.length, sent, failed: pending.filter((item) => item.status === "failed").length, skipPersist: pending.length === 0 };
}
