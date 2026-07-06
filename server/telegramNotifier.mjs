import { appendAudit, nowIso } from "./store.mjs";
import { createNotification } from "./notificationStore.mjs";
import { derivePositionShare, renderPositionPoster } from "./positionPoster.mjs";

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

export function telegramStatus() {
  return {
    configured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    hasBotToken: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    hasChatId: Boolean(process.env.TELEGRAM_CHAT_ID),
    profitPosterEnabled: bool(process.env.TELEGRAM_PROFIT_POSTER_ENABLED, false),
    minPnlUsdt: number(process.env.TELEGRAM_PROFIT_POSTER_MIN_PNL_USDT, 0),
    minRoiPct: number(process.env.TELEGRAM_PROFIT_POSTER_MIN_ROI_PCT, 0),
    cooldownMinutes: number(process.env.TELEGRAM_PROFIT_POSTER_COOLDOWN_MINUTES, 240)
  };
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
    const caption = options.caption || `盈利仓位：${share.symbol} ${share.side} · PnL ${share.pnl?.toFixed?.(2) ?? "-"} USDT`;
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
