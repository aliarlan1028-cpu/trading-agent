import crypto from "node:crypto";
import { appendAudit, nowIso } from "./store.mjs";
import { sendTelegramText } from "./telegramNotifier.mjs";
import { buildWatchBoard, describeWatch, watchBoardForSymbol, watchPurposeLabel } from "./watchView.mjs";

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

function localTime(value) {
  if (!value) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(new Date(value));
}

function compactNote(value, max = 180) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function boardMessage(db, watch, context = {}) {
  const board = watchBoardForSymbol(db, watch.symbol);
  if (!board) {
    return [
      `🔭 ${watch.symbol} 当前观察看板`,
      "状态：暂无有效观察哨",
      context.reason ? `变化：${context.reason}` : "变化：主观察哨已结束",
      "下一步：等待 AI 完成新一轮分析后再生成观察条件。",
      "说明：历史通知不再代表当前市场判断，请以 App 最新分析为准。"
    ].join("\n");
  }
  const primary = board.primary;
  const lines = [
    `🔭 ${board.symbol} 当前观察看板 · 以本条为准`,
    `最新分析：${localTime(board.analysisAt)}${board.analysisTitle ? ` · ${compactNote(board.analysisTitle, 80)}` : ""}`,
    `🎯 主观察哨：${describeWatch(primary)}`,
    `用途：${watchPurposeLabel(primary)}`
  ];
  if (primary.note) lines.push(`关注原因：${compactNote(primary.note)}`);
  lines.push(`有效至：${localTime(primary.expiresAt)}`);
  if (board.secondary.length) {
    lines.push(`辅助条件（${board.secondary.length}，不是另一份市场结论）：`);
    for (const [index, item] of board.secondary.entries()) {
      lines.push(`${index + 1}. [${watchPurposeLabel(item)}] ${describeWatch(item)}`);
    }
  }
  lines.push("只需先盯主观察哨；辅助条件用于确认、失效或备选情景。旧分析已自动退出盯盘。触发只会唤起重新分析，不会绕过风控下单。");
  return lines.join("\n");
}

function triggerMessage(db, watch, context = {}) {
  const next = watchBoardForSymbol(db, watch.symbol)?.primary;
  const role = watch.wasPrimary || watch.priority === "primary" ? "主观察哨" : watchPurposeLabel(watch);
  const lines = [
    `🚨 ${watch.symbol} ${role}已触发`,
    `命中条件：${describeWatch(watch)}`,
    `触发价：${watch.triggerPrice ?? context.triggerPrice ?? "-"}`,
    `触发时间：${localTime(watch.triggeredAt || context.at || nowIso())}`,
    `AI 状态：${context.autoAnalyze ? "已请求立即重新分析；请等待最新结论" : "自动分析未开启；请打开 App 人工查看"}`
  ];
  lines.push(next
    ? `当前临时主哨：${describeWatch(next)}（新分析完成后可能更新）`
    : "当前状态：该币种暂无有效观察哨，等待新分析生成。"
  );
  lines.push("不要继续按旧通知操作，以接下来的最新分析/观察看板为准。");
  return lines.join("\n");
}

function boardSignature(board, fallbackWatch) {
  const rows = board ? [board.primary, ...board.secondary] : [fallbackWatch];
  return crypto.createHash("sha256").update(rows.map((item) => `${item.id}:${item.version || 1}:${item.status}`).join("|")).digest("hex").slice(0, 16);
}

export function queueWatchTelegramEvent(db, watch, eventType, context = {}) {
  const status = telegramWatchStatus();
  if (!status.enabled || !watch?.id) return { status: "disabled" };
  db.telegramWatchOutbox ||= [];
  const terminal = ["expired", "cancelled", "invalidated"].includes(eventType);
  // 辅助观察哨的撤销/过期不再逐条轰炸 Telegram；页面仍完整保留历史。
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
  const message = isTriggered
    ? triggerMessage(db, watch, context)
    : boardMessage(db, watch, { reason: watch.closeReason || context.reason });
  const pendingBoard = coalesceKey && db.telegramWatchOutbox.find((item) => item.coalesceKey === coalesceKey && ["pending", "retry"].includes(item.status));
  if (pendingBoard) {
    pendingBoard.idempotencyKey = key;
    pendingBoard.watchId = board?.primary?.id || watch.id;
    pendingBoard.eventType = "watch_board";
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

export function queueDailyWatchDigest(db) {
  const status = telegramWatchStatus();
  if (!status.enabled || !status.dailyDigestEnabled) return { status: "disabled" };
  const boards = buildWatchBoard(db);
  if (!boards.length) return { status: "empty" };
  db.telegramWatchOutbox ||= [];
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const key = `watch_digest:${date}`;
  const existing = db.telegramWatchOutbox.find((item) => item.idempotencyKey === key);
  if (existing) return { status: "duplicate", item: existing };
  const watchCount = boards.reduce((sum, board) => sum + board.count, 0);
  const message = [
    `🔭 今日有效观察看板（${boards.length} 个币种 / ${watchCount} 个条件）`,
    ...boards.map((board) => `• ${board.symbol}｜主：${describeWatch(board.primary)}｜辅助 ${board.secondary.length}｜分析 ${localTime(board.analysisAt)}`),
    "每个币种只需优先关注“主”条件；详细差异请在 AI 交易员盯盘页查看。"
  ].join("\n");
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
