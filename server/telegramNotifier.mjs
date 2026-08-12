import { appendAudit, nowIso } from "./store.mjs";
import { createNotification } from "./notificationStore.mjs";
import { deriveClosedTradeShare, derivePositionShare, renderClosedTradePoster, renderPositionPoster } from "./positionPoster.mjs";

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

export function telegramStatus() {
  const watchChatId = process.env.TELEGRAM_WATCH_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  return {
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    hasBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    hasChatId: Boolean(process.env.TELEGRAM_CHAT_ID),
    watchNotifierEnabled: bool(process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED, false),
    watchConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && watchChatId),
    hasWatchChatId: Boolean(process.env.TELEGRAM_WATCH_CHAT_ID),
    profitPosterEnabled: bool(process.env.TELEGRAM_PROFIT_POSTER_ENABLED, false),
    minPnlUsdt: number(process.env.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT, 0),
    minRoiPct: number(process.env.TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT, 0),
    cooldownMinutes: number(process.env.TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES, 240)
  };
}

export async function sendTelegramText(text, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = options.chatId || process.env.TELEGRAM_WATCH_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing");
  if (!chatId) throw new Error("Telegram group chat ID is missing");
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(text || "").slice(0, 4000),
      disable_web_page_preview: true
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) throw new Error(json.description || `Telegram sendMessage HTTP ${response.status}`);
  return json.result;
}

function addNotification(db, payload = {}) {
  return createNotification(db, {
    channel: "telegram",
    eventType: payload.eventType || "position_profit_poster",
    severity: payload.severity || "info",
    title: payload.title || "Telegram 通知",
    body: payload.body || ""
  });
}

async function sendTelegramMultipart(method, fields, fileField, file) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing");
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.set(key, String(value));
  }
  form.set(fileField, new Blob([file.buffer], { type: file.contentType }), file.filename);
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    body: form
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(json.description || `Telegram ${method} HTTP ${response.status}`);
  }
  return json;
}

// 从该持仓对应的执行单/计划里取回真实的进场分析(入场推理),拼进海报文案。
// 只用系统自己记录的 entryRationale/reasoningSummary,不编造。TG caption 上限 1024,截断到安全长度。
function positionAnalysisNarrative(db, position) {
  const sym = position.symbol || position.instId;
  const eo = (db.executionOrders || []).find((o) => o.symbol === sym && (o.entryRationale || o.strategy));
  const plan = (db.tradePlans || []).find((p) => p.symbol === sym && (p.reasoningSummary || p.rationale));
  const rationale = eo?.entryRationale || plan?.reasoningSummary || plan?.rationale;
  const strategy = eo?.strategy || plan?.strategy;
  const bits = [];
  if (strategy && strategy !== "manual_review") bits.push(`策略：${strategy}`);
  if (rationale) bits.push(String(rationale).replace(/\s+/g, " ").trim().slice(0, 480));
  return bits.length ? `\n\n📊 我的进场分析\n${bits.join("\n")}` : "";
}

export async function sendTelegramPositionPoster(db, position, options = {}) {
  const status = telegramStatus();
  const share = derivePositionShare(position);
  const notification = addNotification(db, {
    severity: "success",
    title: `盈利仓位海报：${share.symbol}`,
    body: `${share.symbol} ${share.side} PnL ${share.pnl?.toFixed?.(2) ?? "-"} USDT`
  });
  if (!status.configured) {
    notification.deliveryStatus = "no_telegram_config";
    return { status: "no_telegram_config", notification, position: share };
  }

  try {
    const poster = await renderPositionPoster(position);
    const caption = options.caption || (`盈利仓位：${share.symbol} ${share.side} · PnL ${share.pnl?.toFixed?.(2) ?? "-"} USDT` + positionAnalysisNarrative(db, position));
    const payload = { chat_id: process.env.TELEGRAM_CHAT_ID, caption };
    const result = poster.type === "photo"
      ? await sendTelegramMultipart("sendPhoto", payload, "photo", poster)
      : await sendTelegramMultipart("sendDocument", payload, "document", poster);
    notification.deliveryStatus = "sent";
    notification.telegramMessageId = result.result?.message_id;
    notification.posterType = poster.type;
    if (poster.renderError) notification.renderError = poster.renderError;
    appendAudit(db, `Telegram 海报已推送：${share.symbol}`, notification.id, "TelegramNotifier", "info");
    return { status: "sent", notification, position: share, telegram: result.result };
  } catch (error) {
    notification.deliveryStatus = "send_failed";
    notification.error = error.message;
    appendAudit(db, `Telegram 海报推送失败：${error.message}`, notification.id, "TelegramNotifier", "warning");
    return { status: "send_failed", notification, position: share, error: error.message };
  }
}

export async function sendTelegramClosedTradePoster(db, trade, options = {}) {
  const status = telegramStatus();
  const share = deriveClosedTradeShare(trade);
  if (!status.profitPosterEnabled || !status.configured || !(Number(share.pnl) > status.minPnlUsdt)) return { status: "disabled_or_unconfigured", trade: share };
  const notification = addNotification(db, { severity: "success", eventType: "closed_trade_profit_poster", title: `已平仓盈利海报：${share.symbol}`, body: `${share.symbol} ${share.side} 已实现 ${share.pnl?.toFixed?.(2)} USDT` });
  try {
    const poster = await renderClosedTradePoster(trade);
    const caption = options.caption || `已平仓盈利：${share.symbol} ${share.side} · 已实现 ${share.pnl?.toFixed?.(2)} USDT`;
    const payload = { chat_id: process.env.TELEGRAM_CHAT_ID, caption };
    const result = poster.type === "photo" ? await sendTelegramMultipart("sendPhoto", payload, "photo", poster) : await sendTelegramMultipart("sendDocument", payload, "document", poster);
    notification.deliveryStatus = "sent"; notification.telegramMessageId = result.result?.message_id;
    appendAudit(db, `Telegram 已平仓盈利海报已推送：${share.symbol}`, notification.id, "TelegramNotifier", "info");
    return { status: "sent", notification, trade: share, telegram: result.result };
  } catch (error) {
    notification.deliveryStatus = "send_failed"; notification.error = error.message;
    return { status: "send_failed", notification, trade: share, error: error.message };
  }
}

function positionKey(position, share) {
  return position.id || `${share.exchange}:${share.symbol}:${share.side}`;
}

function shouldPublish(position, share, status, now) {
  if (!status.profitPosterEnabled || !status.configured) return { ok: false, reason: "disabled_or_unconfigured" };
  const pnl = Number(share.pnl);
  const roiPct = share.roiPct === null ? null : Number(share.roiPct);
  if (!Number.isFinite(pnl) || pnl <= status.minPnlUsdt) return { ok: false, reason: "pnl_below_threshold" };
  if (roiPct !== null && Number.isFinite(roiPct) && roiPct < status.minRoiPct) return { ok: false, reason: "roi_below_threshold" };
  const lastAt = position.telegramShare?.lastSentAt ? new Date(position.telegramShare.lastSentAt).getTime() : 0;
  const cooldownMs = Math.max(1, status.cooldownMinutes) * 60 * 1000;
  if (lastAt && now - lastAt < cooldownMs) return { ok: false, reason: "cooldown" };
  return { ok: true };
}

export async function publishProfitablePositionPosters(db) {
  const status = telegramStatus();
  const actions = [];
  const now = Date.now();
  for (const position of db.positions || []) {
    const share = derivePositionShare(position);
    const decision = shouldPublish(position, share, status, now);
    if (!decision.ok) continue;
    const result = await sendTelegramPositionPoster(db, position);
    position.telegramShare = {
      key: positionKey(position, share),
      lastSentAt: nowIso(),
      lastStatus: result.status,
      lastPnlUsdt: share.pnl,
      lastRoiPct: share.roiPct,
      notificationId: result.notification?.id
    };
    actions.push({ symbol: share.symbol, action: "telegram_profit_poster", status: result.status, pnl: share.pnl, roiPct: share.roiPct });
  }
  return { checked: (db.positions || []).length, actions };
}
