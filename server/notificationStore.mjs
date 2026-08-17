import { id, nowIso } from "./store.mjs";

export function notificationVisibleToUser(item = {}, context = {}) {
  const tenantId = context.tenantId || "tenant_owner";
  const userId = context.userId || null;
  if (item.tenantId && item.tenantId !== tenantId) return false;
  if (item.recipientUserId && item.recipientUserId !== userId) return false;
  return true;
}

export function projectNotificationForUser(item = {}, userId = null) {
  const trackedReaders = Array.isArray(item.readByUserIds) ? item.readByUserIds : [];
  const legacyGloballyRead = item.read === true && trackedReaders.length === 0;
  return {
    ...item,
    read: Boolean(userId && trackedReaders.includes(userId)) || legacyGloballyRead
  };
}

export function visibleNotificationsForUser(db, context = {}, options = {}) {
  const rows = (db.notifications || [])
    .filter((item) => notificationVisibleToUser(item, context))
    .map((item) => projectNotificationForUser(item, context.userId));
  const limit = Number(options.limit);
  return Number.isFinite(limit) && limit >= 0 ? rows.slice(0, limit) : rows;
}

export function createNotification(db, payload = {}) {
  const notification = {
    id: id("notif"),
    channel: payload.channel || "in_app",
    eventType: payload.eventType || "general",
    severity: payload.severity || "info",
    title: payload.title || "系统通知",
    body: payload.body || "",
    deliveryStatus: payload.deliveryStatus,
    tenantId: payload.tenantId || null,
    recipientUserId: payload.recipientUserId || null,
    readByUserIds: [],
    read: false,
    createdAt: nowIso()
  };
  db.notifications ||= [];
  db.notifications.unshift(notification);
  if (db.notifications.length > 200) db.notifications = db.notifications.slice(0, 200);
  return notification;
}
