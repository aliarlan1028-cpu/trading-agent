import { id, nowIso } from "./store.mjs";

export function createNotification(db, payload = {}) {
  const notification = {
    id: id("notif"),
    channel: payload.channel || "in_app",
    eventType: payload.eventType || "general",
    severity: payload.severity || "info",
    title: payload.title || "系统通知",
    body: payload.body || "",
    deliveryStatus: payload.deliveryStatus,
    read: false,
    createdAt: nowIso()
  };
  db.notifications ||= [];
  db.notifications.unshift(notification);
  if (db.notifications.length > 200) db.notifications = db.notifications.slice(0, 200);
  return notification;
}
