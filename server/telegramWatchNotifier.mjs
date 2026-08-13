import crypto from "node:crypto";
import { appendAudit, nowIso } from "./store.mjs";
import { sendTelegramText } from "./telegramNotifier.mjs";
import {
  buildWatchBoard, describeWatch, watchBoardForSymbol, watchDirection,
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
    dailyDigestEnabled: enabled(process.env.TELEGRAM_WATCH_DAILY_DIGEST_ENABLED, false),
    language: watchLanguage()
  };
}

function shanghaiDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(value));
}

// 配置状态只能回答“理论上能不能发”；这里同时给出真实 outbox 回执，避免管理页
// 把 enabled/configured 当成已经投递成功。
export function telegramWatchDeliveryHealth(db, now = Date.now()) {
  const config = telegramWatchStatus();
  const outbox = db.telegramWatchOutbox || [];
  const todayKey = `watch_digest:${shanghaiDate(now)}`;
  const todayDigest = outbox.find((item) => item.idempotencyKey === todayKey) || null;
  const sent = outbox.filter((item) => item.status === "sent");
  const lastSent = sent.sort((a, b) => String(b.sentAt || b.updatedAt).localeCompare(String(a.sentAt || a.updatedAt)))[0] || null;
  const lastDigest = sent.filter((item) => item.eventType === "daily_digest")[0] || null;
  const failed = outbox.filter((item) => item.status === "failed");
  return {
    ...config,
    operational: config.enabled && config.configured,
    pending: outbox.filter((item) => ["pending", "retry"].includes(item.status)).length,
    failed: failed.length,
    lastSentAt: lastSent?.sentAt || null,
    lastDigestSentAt: lastDigest?.sentAt || null,
    lastError: failed[0]?.lastError || null,
    todayDigest: todayDigest ? {
      status: todayDigest.status,
      sentAt: todayDigest.sentAt || null,
      attempts: Number(todayDigest.attempts || 0),
      lastError: todayDigest.lastError || null
    } : null
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

function eventLabel(eventType, language) {
  const labels = language === "en" ? {
    registered: "🆕 <b>NEW WATCH</b>",
    updated: "🔄 <b>WATCH UPDATED</b>",
    expired: "⌛ <b>WATCH EXPIRED</b>",
    cancelled: "🛑 <b>WATCH CANCELLED</b>",
    invalidated: "🛑 <b>WATCH INVALIDATED</b>"
  } : {
    registered: "🆕 <b>新观察哨</b>",
    updated: "🔄 <b>观察哨已更新</b>",
    expired: "⌛ <b>观察哨已过期</b>",
    cancelled: "🛑 <b>观察哨已撤销</b>",
    invalidated: "🛑 <b>观察哨已失效</b>"
  };
  return labels[eventType] || labels.updated;
}

function supportingIcon(item) {
  if (item.purpose === "confirmation") return "✅";
  if (item.purpose === "invalidation") return "⚠️";
  return "↳";
}

function deterministicEnglishView(primary = {}) {
  if (primary.purpose === "confirmation") return "The current setup remains incomplete until the primary confirmation condition is met.";
  if (primary.purpose === "invalidation") return "The primary level defines where the current setup must be treated as invalid.";
  if (primary.purpose === "alternative") return "This condition tracks an alternative scenario, not the current base case.";
  return "This market is approaching a defined decision point. Use the primary condition as the next point for re-analysis.";
}

function boardMessage(db, watch, eventType, context = {}, language = watchLanguage()) {
  const board = watchBoardForSymbol(db, watch.symbol);
  if (!board) {
    if (language === "en") {
      return [
        `🔭 <b>WATCHTOWER · ${escapeHtml(watch.symbol)}</b>`,
        eventLabel(eventType, language),
        "",
        "📍 <b>Current Status</b>",
        "No active watch remains for this market.",
        context.reason ? `Reason: ${escapeHtml(englishCopy(context.reason) || "The previous watch is no longer active.")}` : "The previous primary watch has ended.",
        "",
        "🧭 <b>Action</b>",
        "Wait for a fresh AI analysis and a new watch board.",
        "<i>Older alerts no longer represent the current market view. No order was placed.</i>"
      ].join("\n");
    }
    return [
      `🔭 <b>观察哨 · ${escapeHtml(watch.symbol)}</b>`,
      eventLabel(eventType, language),
      "",
      "📍 <b>当前状态</b>",
      "该币种目前没有有效观察哨。",
      context.reason ? `原因：${escapeHtml(compact(context.reason))}` : "原主观察哨已经结束。",
      "",
      "🧭 <b>下一步</b>",
      "等待 AI 完成新一轮分析并生成新的观察看板。",
      "<i>历史通知不再代表当前市场判断，本次没有下单。</i>"
    ].join("\n");
  }

  const primary = board.primary;
  const title = language === "en" ? englishCopy(board.analysisTitle) : compact(board.analysisTitle, 100);
  const rationale = language === "en" ? englishCopy(primary.note) : compact(primary.note);
  const condition = escapeHtml(describeWatch(primary, language));
  const purpose = escapeHtml(watchPurposeLabel(primary, language));
  const lines = language === "en" ? [
    `🔭 <b>WATCHTOWER · ${escapeHtml(board.symbol)}</b>`,
    `${eventLabel(eventType, language)} · 📌 <b>CURRENT FOCUS</b>`,
    `Updated: ${localTime(board.analysisAt, language)}`,
    `<i>This board replaces earlier alerts for ${escapeHtml(board.symbol)}.</i>`,
    "",
    "📍 <b>Market View</b>",
    title ? escapeHtml(title) : deterministicEnglishView(primary),
    "",
    "🎯 <b>Primary Watch</b>",
    `<code>${condition}</code>`,
    `Purpose: ${purpose}`
  ] : [
    `🔭 <b>观察哨 · ${escapeHtml(board.symbol)}</b>`,
    `${eventLabel(eventType, language)} · 📌 <b>当前重点</b>`,
    `更新时间：${localTime(board.analysisAt, language)}`,
    `<i>本看板已替代 ${escapeHtml(board.symbol)} 之前的观察哨通知。</i>`,
    "",
    "📍 <b>市场判断</b>",
    title ? escapeHtml(title) : "该币种已有新的结构化观察条件。",
    "",
    "🎯 <b>主观察哨</b>",
    `<code>${condition}</code>`,
    `用途：${purpose}`
  ];
  if (rationale) lines.push(language === "en" ? `Rationale: ${escapeHtml(rationale)}` : `关注原因：${escapeHtml(rationale)}`);
  lines.push(language === "en" ? `Valid until: ${localTime(primary.expiresAt, language)}` : `有效至：${localTime(primary.expiresAt, language)}`);

  if (board.secondary.length) {
    lines.push("", language === "en" ? `🧩 <b>Supporting Conditions · ${board.secondary.length}</b>` : `🧩 <b>辅助条件 · ${board.secondary.length}</b>`);
    for (const item of board.secondary) {
      lines.push(`${supportingIcon(item)} <b>${escapeHtml(watchPurposeLabel(item, language))}</b> · ${escapeHtml(describeWatch(item, language))}`);
    }
  }

  lines.push(
    "",
    language === "en" ? "🧭 <b>Action</b>" : "🧭 <b>下一步</b>",
    language === "en"
      ? "Watch the primary condition first. Supporting conditions only confirm, invalidate, or frame an alternative scenario."
      : "优先关注主观察哨；辅助条件只用于确认、失效或备选情景。",
    language === "en"
      ? "<i>A trigger requests a fresh AI analysis. It never bypasses risk controls or places an order by itself.</i>"
      : "<i>触发后只会请求新的 AI 分析，不会绕过风控或自行下单。</i>",
    `<code>Watch ID: ${escapeHtml(primary.id)}</code>`
  );
  return lines.join("\n");
}

function triggerMessage(db, watch, context = {}, language = watchLanguage()) {
  const role = watch.wasPrimary || watch.priority === "primary"
    ? (language === "en" ? "Primary watch" : "主观察哨")
    : watchPurposeLabel(watch, language);
  const direction = watchDirection(watch);
  const side = watchDirectionLabel(watch, language);
  const thesis = watchThesis(watch, language);
  const meaning = watchTriggerMeaning(watch, language);
  const invalidatesThesis = watch.purpose === "invalidation";
  if (language === "en") {
    const lines = [
      `<b>${escapeHtml(watch.symbol)} · ${escapeHtml(side)} ${invalidatesThesis ? "invalidation hit" : "watch triggered"}</b>`,
      `Original view: ${escapeHtml(thesis)}`,
      `Triggered: ${escapeHtml(role)} · ${escapeHtml(describeWatch(watch, language))}`,
      `Price / time: ${escapeHtml(watch.triggerPrice ?? context.triggerPrice ?? "—")} · ${localTime(watch.triggeredAt || context.at || nowIso(), language)}`,
      `What it means: ${escapeHtml(meaning)}`,
      `Directional impact: ${invalidatesThesis ? `stop using the previous ${direction} thesis` : `re-evaluate the ${direction} scenario; this is not yet an entry signal`}.`
    ];
    lines.push(`Next action: ${context.autoAnalyze ? "AI re-analysis requested" : "manual review required"}. Wait for the fresh conclusion before trading.`);
    return lines.join("\n");
  }
  const lines = [
    `<b>${escapeHtml(watch.symbol)} · ${escapeHtml(side)}${invalidatesThesis ? "失效条件命中" : "观察条件命中"}</b>`,
    `原判断：${escapeHtml(thesis)}`,
    `命中条件：${escapeHtml(role)} · ${escapeHtml(describeWatch(watch, language))}`,
    `触发价 / 时间：${escapeHtml(watch.triggerPrice ?? context.triggerPrice ?? "—")} · ${localTime(watch.triggeredAt || context.at || nowIso(), language)}`,
    `这代表：${escapeHtml(meaning)}`,
    `方向影响：${invalidatesThesis ? `停止沿用原${direction === "long" ? "做多" : direction === "short" ? "做空" : "方向"}判断` : `重新评估${direction === "long" ? "做多" : direction === "short" ? "做空" : "方向"}情景，目前还不是入场信号`}。`
  ];
  lines.push(`下一步：${context.autoAnalyze ? "已唤起 AI 重新分析" : "需要人工复核"}；等待新结论后再决定是否交易。`);
  return lines.join("\n");
}

function invalidationMessage(watch, context = {}, language = watchLanguage()) {
  const reason = language === "en"
    ? englishCopy(watch.closeReason || context.reason) || "The original setup is no longer valid."
    : compact(watch.closeReason || context.reason) || "原交易假设已不再成立。";
  const side = watchDirectionLabel(watch, language);
  const thesis = watchThesis(watch, language);
  if (language === "en") return [
    `<b>${escapeHtml(watch.symbol)} · ${escapeHtml(side)} watch retired</b>`,
    `Original view: ${escapeHtml(thesis)}`,
    `Retired condition: ${escapeHtml(describeWatch(watch, language))}`,
    `Why it was retired: ${escapeHtml(reason)}`,
    "Impact: this condition is no longer monitored and must not be used as a current trading reference.",
    "Next action: wait for a fresh analysis and a newly registered watch. No order was placed by this alert."
  ].join("\n");
  return [
    `<b>${escapeHtml(watch.symbol)} · ${escapeHtml(side)}观察条件已作废</b>`,
    `关联原判断：${escapeHtml(thesis)}`,
    `作废条件：${escapeHtml(describeWatch(watch, language))}`,
    `作废原因：${escapeHtml(reason)}`,
    "影响：系统不再盯这条条件，也不能把它当作当前交易依据。",
    "下一步：等待新的分析和新登记的观察条件；本提醒不会自行下单。"
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

export function queueDailyWatchDigest(db, options = {}) {
  const status = telegramWatchStatus();
  if (!status.enabled || !status.dailyDigestEnabled) return { status: "disabled" };
  const boards = buildWatchBoard(db);
  db.telegramWatchOutbox ||= [];
  const date = shanghaiDate(options.now || new Date());
  const key = `watch_digest:${date}`;
  const existing = db.telegramWatchOutbox.find((item) => item.idempotencyKey === key);
  if (existing) return { status: "duplicate", item: existing };
  const watchCount = boards.reduce((sum, board) => sum + board.count, 0);
  const language = status.language;
  const message = language === "en" ? [
    `🔭 <b>DAILY WATCHTOWER · ${boards.length} MARKETS</b>`,
    `${watchCount} active conditions · ${date}`,
    "",
    ...(boards.length
      ? boards.map((board) => `📌 <b>${escapeHtml(board.symbol)}</b> · ${escapeHtml(watchDirectionLabel(board.primary, language))}\n   ${escapeHtml(describeWatch(board.primary, language))} · Supporting ${board.secondary.length} · Updated ${localTime(board.analysisAt, language)}`)
      : ["No active watch conditions are registered today."]),
    "",
    "🧭 <b>Action</b>",
    boards.length
      ? "Focus on each market's primary watch. Open KORDYN for the full reasoning and supporting scenarios."
      : "No watch action is required. The next autonomous analysis may register a new condition if a decision level becomes useful."
  ].join("\n") : [
    `🔭 <b>每日观察哨 · ${boards.length} 个币种</b>`,
    `${watchCount} 个有效条件 · ${date}`,
    "",
    ...(boards.length
      ? boards.map((board) => `📌 <b>${escapeHtml(board.symbol)}</b> · ${escapeHtml(watchDirectionLabel(board.primary, language))}\n   ${escapeHtml(describeWatch(board.primary, language))} · 辅助 ${board.secondary.length} · 更新 ${localTime(board.analysisAt, language)}`)
      : ["今天没有已登记且仍有效的观察条件。"]),
    "",
    "🧭 <b>下一步</b>",
    boards.length
      ? "优先关注每个币种的主观察哨；完整判断与辅助情景请在 KORDYN 中查看。"
      : "当前无需处理观察哨；后续自主分析遇到有参考价值的决策价位时会重新登记。"
  ].join("\n");
  const item = {
    id: `tgwatch_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 20)}`,
    idempotencyKey: key, eventType: "daily_digest", language, parseMode: "HTML", status: "pending", attempts: 0,
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
