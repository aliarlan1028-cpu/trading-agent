import crypto from "node:crypto";
import { appendAudit, id, nowIso } from "./store.mjs";

// ---------------------------------------------------------------------------
// 飞书（Lark）通知：把关键交易/风控事件主动推送给主人。
// 配置 LARK_WEBHOOK_URL（自定义机器人）即可；如开启签名校验再配 LARK_WEBHOOK_SECRET。
// 无 webhook 时降级为只写入站内通知，不报错。
// ---------------------------------------------------------------------------

const SEVERITY_COLOR = { critical: "red", warning: "orange", info: "blue", success: "green" };

function signPayload(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac("sha256", stringToSign).update("").digest("base64");
}

function buildCard({ title, body, fields = [], severity = "info" }) {
  const elements = [{ tag: "div", text: { tag: "lark_md", content: body || "" } }];
  if (fields.length) {
    elements.push({
      tag: "div",
      fields: fields.map((field) => ({ is_short: true, text: { tag: "lark_md", content: `**${field.label}**\n${field.value}` } }))
    });
  }
  elements.push({ tag: "note", elements: [{ tag: "plain_text", content: `AI 交易员 · ${nowIso()}` }] });
  return {
    header: { title: { tag: "plain_text", content: title }, template: SEVERITY_COLOR[severity] || "blue" },
    elements
  };
}

// 主入口：写入站内通知 + 尝试推送飞书。
export async function notifyLark(db, payload = {}) {
  const notification = {
    id: id("notif"),
    channel: "lark",
    severity: payload.severity || "info",
    title: payload.title || "交易员通知",
    body: payload.body || "",
    read: false,
    createdAt: nowIso()
  };
  db.notifications ||= [];
  db.notifications.unshift(notification);
  if (db.notifications.length > 200) db.notifications = db.notifications.slice(0, 200);

  const url = process.env.LARK_WEBHOOK_URL;
  if (!url) {
    notification.deliveryStatus = "no_webhook";
    return notification;
  }
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const message = { msg_type: "interactive", card: buildCard(payload) };
    if (process.env.LARK_WEBHOOK_SECRET) {
      message.timestamp = String(timestamp);
      message.sign = signPayload(process.env.LARK_WEBHOOK_SECRET, timestamp);
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message)
    });
    const json = await response.json().catch(() => ({}));
    // 飞书成功返回 code:0（或 StatusCode:0 旧版）
    notification.deliveryStatus = response.ok && (json.code === 0 || json.StatusCode === 0 || json.StatusMessage === "success") ? "sent" : "send_failed";
    notification.providerResponse = json.msg || json.StatusMessage || String(response.status);
  } catch (error) {
    notification.deliveryStatus = "send_failed";
    notification.error = error.message;
  }
  appendAudit(db, `飞书通知：${notification.deliveryStatus}`, notification.id, "LarkNotifier", notification.severity === "critical" ? "critical" : "info");
  return notification;
}

// 去重节流：同一 key 在 windowMs 内只推一次，避免刷屏。
const lastSent = new Map();
export async function notifyLarkThrottled(db, key, windowMs, payload) {
  const now = Date.now();
  const previous = lastSent.get(key) || 0;
  if (now - previous < windowMs) return null;
  lastSent.set(key, now);
  return notifyLark(db, payload);
}

export function larkStatus() {
  return {
    configured: Boolean(process.env.LARK_WEBHOOK_URL),
    signed: Boolean(process.env.LARK_WEBHOOK_SECRET)
  };
}
