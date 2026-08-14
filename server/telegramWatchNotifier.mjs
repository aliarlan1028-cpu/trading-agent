import crypto from "node:crypto";
import { appendAudit, nowIso } from "./store.mjs";
import { sendTelegramText } from "./telegramNotifier.mjs";
import {
  describeWatch, watchBoardForSymbol, watchDirection,
  watchDirectionLabel, watchPurposeLabel, watchThesis, watchTriggerMeaning
} from "./watchView.mjs";

function enabled(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function watchLanguage() {
  return process.env.TELEGRAM_WATCH_LANGUAGE === "zh" ? "zh" : "en";
}

export function telegramWatchStatus() {
  return {
    enabled: enabled(process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED, false),
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && (process.env.TELEGRAM_WATCH_CHAT_ID || process.env.TELEGRAM_CHAT_ID)),
    chatSource: process.env.TELEGRAM_WATCH_CHAT_ID ? "watch_override" : "primary_telegram_chat",
    language: watchLanguage()
  };
}

// 配置状态只能回答“理论上能不能发”；这里同时给出真实 outbox 回执，避免管理页
// 把 enabled/configured 当成已经投递成功。
export function telegramWatchDeliveryHealth(db, now = Date.now()) {
  const config = telegramWatchStatus();
  const outbox = (db.telegramWatchOutbox || []).filter((item) => item.eventType !== "daily_digest");
  const sent = outbox.filter((item) => item.status === "sent");
  const lastSent = sent.sort((a, b) => String(b.sentAt || b.updatedAt).localeCompare(String(a.sentAt || a.updatedAt)))[0] || null;
  const failed = outbox.filter((item) => item.status === "failed");
  return {
    ...config,
    operational: config.enabled && config.configured,
    pending: outbox.filter((item) => ["pending", "retry"].includes(item.status)).length,
    failed: failed.length,
    lastSentAt: lastSent?.sentAt || null,
    lastError: failed[0]?.lastError || null,
    checkedAt: new Date(now).toISOString()
  };
}

function localTime(value, language = watchLanguage()) {
  if (!value) return language === "en" ? "Unknown" : "未知";
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(value)) + " UTC+8";
}

function compact(value, max = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function englishCopy(value) {
  const text = compact(value);
  return text && !/[\u3400-\u9fff]/.test(text) ? text : "";
}

function directionIcon(watch) {
  const direction = watchDirection(watch);
  return direction === "long" ? "🟢" : direction === "short" ? "🔴" : "⚪";
}

function conditionWithoutSymbol(watch, language) {
  const full = describeWatch(watch, language);
  const prefix = `${watch.symbol} `;
  return full.startsWith(prefix) ? full.slice(prefix.length) : full;
}

function displayPrice(value) {
  if (value === undefined || value === null || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString("en-US", { maximumFractionDigits: 8 })
    : compact(value, 40);
}

function triggerMessage(db, watch, context = {}, language = watchLanguage()) {
  const role = watchPurposeLabel(watch, language);
  const side = watchDirectionLabel(watch, language);
  const thesis = compact(watchThesis(watch, language), 160);
  const meaning = compact(watchTriggerMeaning(watch, language), 180);
  const invalidatesThesis = watch.purpose === "invalidation";
  const condition = conditionWithoutSymbol(watch, language);
  const price = displayPrice(watch.triggerPrice ?? context.triggerPrice);
  const time = localTime(watch.triggeredAt || context.at || nowIso(), language);
  const icon = directionIcon(watch);
  if (language === "en") {
    return [
      invalidatesThesis ? "🛑 <b>INVALIDATION PRICE REACHED</b>" : "⚡ <b>PRICE CONDITION REACHED</b>",
      "",
      `<b>${escapeHtml(watch.symbol)}</b> · ${icon} <b>${escapeHtml(side)}</b>`,
      `<code>${escapeHtml(role)} · ${escapeHtml(condition)}</code>`,
      "",
      `<b>Price</b>  <code>${escapeHtml(price)}</code>`,
      `<b>Time</b>   ${escapeHtml(time)}`,
      "<b>Validation</b> Price only; volume, candle close, pattern and risk/reward are still pending.",
      "",
      `<b>View</b>     ${escapeHtml(thesis)}`,
      `<b>Meaning</b>  ${escapeHtml(meaning)}`,
      `<b>Action</b>   ${context.autoAnalyze ? "AI re-analysis started; wait for the fresh conclusion." : "Manual review required; confirm a fresh conclusion before trading."}`,
      "",
      invalidatesThesis
        ? "<i>⚠️ Previous view paused pending review · No order placed</i>"
        : "<i>⚠️ No entry signal yet · No order placed</i>"
    ].join("\n");
  }
  return [
    invalidatesThesis ? "🛑 <b>失效价格条件命中</b>" : "⚡ <b>价格条件命中</b>",
    "",
    `<b>${escapeHtml(watch.symbol)}</b> · ${icon} <b>${escapeHtml(side)}</b>`,
    `<code>${escapeHtml(role)} · ${escapeHtml(condition)}</code>`,
    "",
    `<b>触发价</b>  <code>${escapeHtml(price)}</code>`,
    `<b>时间</b>    ${escapeHtml(time)}`,
    "<b>确认状态</b> 仅价格到位；量能、K线收盘、形态与盈亏比仍待复核。",
    "",
    `<b>原判断</b>  ${escapeHtml(thesis)}`,
    `<b>含义</b>    ${escapeHtml(meaning)}`,
    `<b>动作</b>    ${context.autoAnalyze ? "AI 已开始重新分析；等待新结论。" : "请人工复核；确认新结论后再决定是否交易。"}`,
    "",
    invalidatesThesis
      ? "<i>⚠️ 旧判断暂停沿用、等待复核 · 本通知不会下单</i>"
      : "<i>⚠️ 尚未形成入场信号 · 本通知不会下单</i>"
  ].join("\n");
}

function invalidationMessage(watch, context = {}, language = watchLanguage()) {
  const reason = language === "en"
    ? englishCopy(watch.closeReason || context.reason) || "The original setup is no longer valid."
    : compact(watch.closeReason || context.reason) || "原交易假设已不再成立。";
  const side = watchDirectionLabel(watch, language);
  const thesis = compact(watchThesis(watch, language), 160);
  const condition = conditionWithoutSymbol(watch, language);
  const icon = directionIcon(watch);
  if (language === "en") return [
    "🛑 <b>WATCH RETIRED</b>",
    "",
    `<b>${escapeHtml(watch.symbol)}</b> · ${icon} <b>${escapeHtml(side)}</b>`,
    `<code>${escapeHtml(condition)}</code>`,
    "",
    `<b>View</b>    ${escapeHtml(thesis)}`,
    `<b>Reason</b>  ${escapeHtml(reason)}`,
    "<b>Impact</b>  This condition is no longer monitored or valid as a trading reference.",
    "<b>Action</b>  Wait for a fresh analysis and a newly registered watch.",
    "",
    "<i>⚠️ Previous view retired · No order placed</i>"
  ].join("\n");
  return [
    "🛑 <b>观察哨已失效</b>",
    "",
    `<b>${escapeHtml(watch.symbol)}</b> · ${icon} <b>${escapeHtml(side)}</b>`,
    `<code>${escapeHtml(condition)}</code>`,
    "",
    `<b>原判断</b>  ${escapeHtml(thesis)}`,
    `<b>原因</b>    ${escapeHtml(reason)}`,
    "<b>影响</b>    系统不再监控该条件，也不能继续作为交易依据。",
    "<b>动作</b>    等待新的分析和新登记的观察条件。",
    "",
    "<i>⚠️ 旧判断已停用 · 本通知不会下单</i>"
  ].join("\n");
}

function previewMessage(watch, language = watchLanguage()) {
  if (language === "en") return [
    `<b>${escapeHtml(watch.symbol)} · watch alert preview</b>`,
    `Scenario: ${escapeHtml(watchDirectionLabel(watch, language))}`,
    `Original view: ${escapeHtml(watchThesis(watch, language))}`,
    `Condition: ${escapeHtml(describeWatch(watch, language))}`,
    "Telegram interrupts only when a primary condition triggers or the active thesis is invalidated. Registration, edits, expiry, and cancellation stay in KORDYN."
  ].join("\n");
  return [
    `<b>${escapeHtml(watch.symbol)} · 观察条件推送预览</b>`,
    `方向：${escapeHtml(watchDirectionLabel(watch, language))}`,
    `原判断：${escapeHtml(watchThesis(watch, language))}`,
    `条件：${escapeHtml(describeWatch(watch, language))}`,
    "Telegram 只在主条件命中或当前判断关键失效时打扰；登记、更新、到期与撤销只保留在 KORDYN。"
  ].join("\n");
}

function boardSignature(board, fallbackWatch) {
  const rows = board ? [board.primary, ...board.secondary] : [fallbackWatch];
  return crypto.createHash("sha256").update(rows.map((item) => `${item.id}:${item.version || 1}:${item.status}`).join("|")).digest("hex").slice(0, 16);
}

export function buildWatchTelegramMessage(db, watch, eventType, context = {}, language = watchLanguage()) {
  if (eventType === "triggered") return triggerMessage(db, watch, context, language);
  if (eventType === "invalidated") return invalidationMessage(watch, context, language);
  return previewMessage(watch, language);
}

export function queueWatchTelegramEvent(db, watch, eventType, context = {}) {
  const status = telegramWatchStatus();
  if (!status.enabled || !watch?.id) return { status: "disabled" };
  db.telegramWatchOutbox ||= [];
  // Telegram is an interruption channel, not an audit log. Registration and
  // routine board churn remain visible in KORDYN (and in the optional digest).
  // Push only events that can change the user's immediate trading decision.
  if (!["triggered", "invalidated"].includes(eventType)) return { status: "suppressed_low_value" };
  const terminal = ["expired", "cancelled", "invalidated"].includes(eventType);
  if (terminal && !watch.wasPrimary && watch.priority !== "primary") return { status: "suppressed" };

  const board = watchBoardForSymbol(db, watch.symbol);
  const isTriggered = eventType === "triggered";
  const signature = isTriggered
    ? `${watch.id}:${Number(watch.version || 1)}:${watch.triggeredAt || context.at || "triggered"}`
    : boardSignature(board, watch);
  const key = isTriggered ? `watch_trigger:${signature}` : `watch_board:${watch.symbol}:${signature}`;
  const existing = db.telegramWatchOutbox.find((item) => item.idempotencyKey === key);
  if (existing) return { status: "duplicate", item: existing };
  const coalesceKey = isTriggered ? null : `watch_board:${watch.symbol}`;
  const message = buildWatchTelegramMessage(db, watch, eventType, context, status.language);
  const pendingBoard = coalesceKey && db.telegramWatchOutbox.find((item) => item.coalesceKey === coalesceKey && ["pending", "retry"].includes(item.status));
  if (pendingBoard) {
    pendingBoard.idempotencyKey = key;
    pendingBoard.watchId = board?.primary?.id || watch.id;
    pendingBoard.eventType = "watch_board";
    pendingBoard.language = status.language;
    pendingBoard.parseMode = "HTML";
    pendingBoard.message = message;
    pendingBoard.updatedAt = nowIso();
    pendingBoard.status = "pending";
    pendingBoard.nextAttemptAt = nowIso();
    return { status: "coalesced", item: pendingBoard };
  }
  const item = {
    id: `tgwatch_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 20)}`,
    idempotencyKey: key,
    watchId: watch.id,
    eventType: isTriggered ? "triggered" : "watch_board",
    coalesceKey,
    language: status.language,
    parseMode: "HTML",
    status: "pending",
    attempts: 0,
    nextAttemptAt: nowIso(),
    message,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  db.telegramWatchOutbox.unshift(item);
  return { status: "queued", item };
}

// 每日摘要功能下线迁移：保留历史发送回执用于审计，但删除旧 Cron，且取消尚未
// 发出的摘要，确保升级重启后不会再补发一条过期日报。
export function retireTelegramWatchDigest(db = {}) {
  const beforeTasks = (db.tasks || []).length;
  db.tasks = (db.tasks || []).filter((task) => task.id !== "task_sys_telegram_watch_digest" && task.handler !== "telegram_watch_digest");
  let outboxCancelled = 0;
  for (const item of db.telegramWatchOutbox || []) {
    if (item.eventType !== "daily_digest" || !["pending", "retry"].includes(item.status)) continue;
    item.status = "cancelled";
    item.cancelReason = "telegram_daily_digest_removed";
    item.updatedAt = nowIso();
    item.nextAttemptAt = null;
    outboxCancelled += 1;
  }
  const configRemoved = Boolean(db.runtimeConfig && Object.hasOwn(db.runtimeConfig, "TELEGRAM_WATCH_DAILY_DIGEST_ENABLED"));
  if (configRemoved) delete db.runtimeConfig.TELEGRAM_WATCH_DAILY_DIGEST_ENABLED;
  delete process.env.TELEGRAM_WATCH_DAILY_DIGEST_ENABLED;
  return { tasksRemoved: beforeTasks - db.tasks.length, outboxCancelled, configRemoved };
}

export async function dispatchTelegramWatchOutbox(db, options = {}) {
  const status = telegramWatchStatus();
  if (!status.enabled) return { status: "disabled", checked: 0, skipPersist: true };
  if (!status.configured) return { status: "unconfigured", checked: 0, skipPersist: true };
  const now = Date.now();
  const pending = (db.telegramWatchOutbox || []).filter((item) =>
    item.eventType !== "daily_digest" && ["pending", "retry"].includes(item.status) && new Date(item.nextAttemptAt || 0).getTime() <= now
  ).slice(0, Math.max(1, Number(options.limit || 10)));
  let sent = 0;
  for (const item of pending) {
    item.attempts = Number(item.attempts || 0) + 1;
    item.updatedAt = nowIso();
    try {
      const result = await sendTelegramText(item.message, {
        chatId: process.env.TELEGRAM_WATCH_CHAT_ID || process.env.TELEGRAM_CHAT_ID,
        parseMode: item.parseMode
      });
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
  const failed = pending.filter((item) => item.status === "failed").length;
  const retrying = pending.filter((item) => item.status === "retry").length;
  return {
    status: failed ? "failed" : retrying ? "partial" : "ok",
    checked: pending.length,
    sent,
    failed,
    retrying,
    skipPersist: pending.length === 0
  };
}
