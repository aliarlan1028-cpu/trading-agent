import crypto from "node:crypto";
import { appendAudit, nowIso } from "./store.mjs";
import { createNotification } from "./notificationStore.mjs";
import { closedTradePosterPayload, deriveClosedTradeShare, derivePositionShare, renderClosedTradePoster, renderPositionPoster, resolveClosedTradePosterBasis } from "./positionPoster.mjs";
import { groupClosedTradeLifecycles } from "./tradeReviewQueue.mjs";
import { canonicalPositionKey } from "./positionIdentity.mjs";

function number(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
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
    watchLanguage: process.env.TELEGRAM_WATCH_LANGUAGE === "zh" ? "zh" : "en",
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
  const payload = {
    chat_id: chatId,
    text: String(text || "").slice(0, 4000),
    disable_web_page_preview: true
  };
  if (options.parseMode) payload.parse_mode = options.parseMode;
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
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

// 从该持仓对应的执行单/计划里取回真实的进场分析(入场推理),拼进英文海报文案。
// 只用系统自己记录的 entryRationale/reasoningSummary,不编造。中文推理不塞进英文 Telegram caption。
function positionAnalysisNarrative(db, position) {
  const sym = position.symbol || position.instId;
  const eo = (db.executionOrders || []).find((o) => o.symbol === sym && (o.entryRationale || o.strategy));
  const plan = (db.tradePlans || []).find((p) => p.symbol === sym && (p.reasoningSummary || p.rationale));
  const rationale = eo?.entryRationale || plan?.reasoningSummary || plan?.rationale;
  const strategy = eo?.strategy || plan?.strategy;
  const bits = [];
  if (strategy && strategy !== "manual_review" && /^[\x00-\x7F\s]+$/.test(String(strategy))) bits.push(`Strategy: ${strategy}`);
  if (rationale && /^[\x00-\x7F\s]+$/.test(String(rationale))) bits.push(String(rationale).replace(/\s+/g, " ").trim().slice(0, 480));
  return bits.length ? `\n\nEntry rationale\n${bits.join("\n")}` : "";
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
    const caption = options.caption || (`OPEN PROFIT · ${share.symbol} ${share.side} · PnL ${share.pnl?.toFixed?.(2) ?? "-"} USDT` + positionAnalysisNarrative(db, position));
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
  const decision = closedTradePosterEligibility(trade, status);
  const share = decision.share;
  if (!decision.ok) return { status: decision.reason, trade: share };
  const notification = addNotification(db, { severity: "success", eventType: "closed_trade_profit_poster", title: `已平仓净盈利海报：${share.symbol}`, body: `${share.symbol} ${share.side} 净实现 ${share.netPnl?.toFixed?.(2)} USDT` });
  try {
    const poster = await renderClosedTradePoster(trade);
    const caption = options.caption || `NET REALIZED PROFIT · ${share.symbol} ${share.side} · Gross ${share.grossPnl?.toFixed?.(2)} · Costs ${share.feeUsdt?.toFixed?.(2)} · Net ${share.netPnl?.toFixed?.(2)} USDT`;
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

function closedTradePosterKey(lifecycle) {
  return `closed_trade:${lifecycle.key}`;
}

export function closedTradePosterEligibility(trade, status = telegramStatus()) {
  const share = deriveClosedTradeShare(trade || {});
  if (!status.profitPosterEnabled || !status.configured) return { ok: false, reason: "disabled_or_unconfigured", share };
  const pnl = share.netPnl === null || share.netPnl === undefined || share.netPnl === "" ? null : Number(share.netPnl);
  if (!Number.isFinite(pnl) || pnl <= status.minPnlUsdt) return { ok: false, reason: "net_pnl_below_threshold", share };
  if (status.minRoiPct > 0) {
    const roiPct = share.roiPct === null || share.roiPct === undefined || share.roiPct === "" ? null : Number(share.roiPct);
    if (!Number.isFinite(roiPct)) return { ok: false, reason: "roi_basis_unavailable", share };
    if (roiPct < status.minRoiPct) return { ok: false, reason: "roi_below_threshold", share };
  }
  return { ok: true, reason: null, share };
}

export function queueClosedTradeProfitPosters(db) {
  const status = telegramStatus();
  if (!status.profitPosterEnabled || !status.configured) return { status: "disabled_or_unconfigured", queued: 0 };
  db.telegramPosterOutbox ||= [];
  db.meta ||= {};
  if (!db.meta.telegramClosedTradePosterStartedAt) {
    db.meta.telegramClosedTradePosterStartedAt = nowIso();
    return { status: "initialized", queued: 0 };
  }
  const startedAt = new Date(db.meta.telegramClosedTradePosterStartedAt).getTime();
  let queued = 0;
  for (const lifecycle of groupClosedTradeLifecycles(db.fills || [])) {
    if (new Date(lifecycle.lastClosedAt || 0).getTime() < startedAt) continue;
    if (lifecycle.fills.some((fill) => fill.telegramClosedTradePoster?.status === "sent")) continue;
    const key = closedTradePosterKey(lifecycle);
    if (db.telegramPosterOutbox.some((item) => item.idempotencyKey === key)) continue;
    const trade = closedTradePosterPayload(lifecycle, resolveClosedTradePosterBasis(db, lifecycle));
    if (!closedTradePosterEligibility(trade, status).ok) continue;
    db.telegramPosterOutbox.unshift({
      id: `tgposter_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 20)}`,
      idempotencyKey: key,
      tradeLifecycleKey: lifecycle.key,
      fillIds: lifecycle.fills.map((fill) => fill.id).filter(Boolean),
      trade,
      status: "pending",
      attempts: 0,
      nextAttemptAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    queued += 1;
  }
  return { status: "ok", queued };
}

export async function dispatchClosedTradePosterOutbox(db, options = {}) {
  const status = telegramStatus();
  if (!status.profitPosterEnabled || !status.configured) return { status: "disabled_or_unconfigured", checked: 0, skipPersist: true };
  const now = Date.now();
  const pending = (db.telegramPosterOutbox || []).filter((item) =>
    ["pending", "retry"].includes(item.status) && new Date(item.nextAttemptAt || 0).getTime() <= now
  ).slice(0, Math.max(1, Number(options.limit || 5)));
  const lifecycleByKey = new Map(groupClosedTradeLifecycles(db.fills || []).map((lifecycle) => [lifecycle.key, lifecycle]));
  let sent = 0;
  for (const item of pending) {
    const lifecycle = lifecycleByKey.get(item.tradeLifecycleKey);
    if (!lifecycle) {
      item.status = "cancelled";
      item.lastError = "authoritative_lifecycle_missing";
      item.updatedAt = nowIso();
      continue;
    }
    item.fillIds = lifecycle.fills.map((fill) => fill.id).filter(Boolean);
    item.trade = closedTradePosterPayload(lifecycle, resolveClosedTradePosterBasis(db, lifecycle));
    const decision = closedTradePosterEligibility(item.trade, status);
    if (!decision.ok) {
      item.status = "cancelled";
      item.lastError = decision.reason;
      item.updatedAt = nowIso();
      continue;
    }
    item.attempts = Number(item.attempts || 0) + 1;
    item.updatedAt = nowIso();
    const result = await sendTelegramClosedTradePoster(db, item.trade);
    if (result.status === "sent") {
      item.status = "sent";
      item.sentAt = nowIso();
      item.telegramMessageId = result.telegram?.message_id || result.notification?.telegramMessageId || null;
      item.notificationId = result.notification?.id || null;
      item.lastError = null;
      for (const fill of db.fills || []) {
        if (!item.fillIds?.includes(fill.id)) continue;
        fill.telegramClosedTradePoster = { status: "sent", sentAt: item.sentAt, idempotencyKey: item.idempotencyKey, telegramMessageId: item.telegramMessageId };
      }
      sent += 1;
    } else {
      item.lastError = String(result.error || result.status).slice(0, 180);
      if (item.attempts >= 5) item.status = "failed";
      else {
        item.status = "retry";
        item.nextAttemptAt = new Date(Date.now() + Math.min(30, 2 ** item.attempts) * 60_000).toISOString();
      }
    }
  }
  return { status: "ok", checked: pending.length, sent, failed: pending.filter((item) => item.status === "failed").length, skipPersist: pending.length === 0 };
}

export async function processClosedTradeProfitPosters(db, options = {}) {
  const queued = queueClosedTradeProfitPosters(db);
  const dispatched = await dispatchClosedTradePosterOutbox(db, options);
  return { queued, dispatched, skipPersist: queued.queued === 0 && dispatched.skipPersist === true };
}

function positionKey(position, share) {
  return canonicalPositionKey(position) || `${share.exchange}:${share.symbol}:${share.side}`;
}

function shouldPublish(position, share, status, now) {
  if (!status.profitPosterEnabled || !status.configured) return { ok: false, reason: "disabled_or_unconfigured" };
  const pnl = Number(share.pnl);
  const roiPct = share.roiPct === null ? null : Number(share.roiPct);
  if (!Number.isFinite(pnl) || pnl <= status.minPnlUsdt) return { ok: false, reason: "pnl_below_threshold" };
  if (status.minRoiPct > 0 && !Number.isFinite(roiPct)) return { ok: false, reason: "roi_basis_unavailable" };
  if (status.minRoiPct > 0 && roiPct < status.minRoiPct) return { ok: false, reason: "roi_below_threshold" };
  const lastAt = position.telegramShare?.lastSentAt ? new Date(position.telegramShare.lastSentAt).getTime() : 0;
  const cooldownMs = Math.max(1, status.cooldownMinutes) * 60 * 1000;
  if (lastAt && now - lastAt < cooldownMs) return { ok: false, reason: "cooldown" };
  return { ok: true };
}

export async function publishProfitablePositionPosters(db) {
  const status = telegramStatus();
  const actions = [];
  const now = Date.now();
  const grouped = new Map();
  for (const row of db.positions || []) {
    const key = canonicalPositionKey(row);
    if (!key) continue;
    const group = grouped.get(key) || {};
    if (row.source === "execution_engine") group.engine = row;
    else if (["exchange_rest", "exchange_ws"].includes(row.source)) {
      if (!group.exchange || row.source === "exchange_rest") group.exchange = row;
    }
    grouped.set(key, group);
  }
  for (const [key, group] of grouped) {
    const position = { ...(group.engine || {}), ...(group.exchange || {}), id: key, telegramShare: group.exchange?.telegramShare || group.engine?.telegramShare };
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
    for (const row of [group.engine, group.exchange].filter(Boolean)) row.telegramShare = position.telegramShare;
    actions.push({ symbol: share.symbol, action: "telegram_profit_poster", status: result.status, pnl: share.pnl, roiPct: share.roiPct });
  }
  return { checked: grouped.size, actions };
}
