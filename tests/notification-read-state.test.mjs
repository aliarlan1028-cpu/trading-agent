import assert from "node:assert/strict";
import test from "node:test";

import { visibleNotificationsForUser } from "../server/notificationStore.mjs";
import { registerNotificationRoutes } from "../server/routes/notifications.mjs";

function harness(db) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); }
  };
  let saves = 0;
  registerNotificationRoutes(app, {
    db,
    saveDb() { saves += 1; },
    requirePermission() { return (_req, _res, next) => next(); },
    nowIso: () => "2026-08-17T00:00:00.000Z",
    larkStatus: () => ({}), telegramStatus: () => ({}), notifyLark: async () => ({}),
    sendTelegramPositionPoster: async () => ({}), telegramWatchDeliveryHealth: () => ({}),
    queueWatchTelegramEvent: () => ({ status: "queued" }), dispatchTelegramWatchOutbox: async () => ({ status: "sent" })
  });
  return { routes, get saves() { return saves; } };
}

function response() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { this.payload = payload; return this; } };
}

test("全部已读写入后，通知 API 与 overview 投影都按当前用户返回已读", () => {
  const db = { notifications: [
    { id: "shared", tenantId: "tenant_owner", title: "共享通知", read: false, readByUserIds: [] },
    { id: "private", tenantId: "tenant_owner", recipientUserId: "owner", title: "Owner 通知", read: false, readByUserIds: [] },
    { id: "other", tenantId: "tenant_other", title: "其他租户", read: false, readByUserIds: [] }
  ] };
  const h = harness(db);
  const req = { tenantId: "tenant_owner", user: { id: "owner", tenantId: "tenant_owner" }, body: {} };
  const marked = response();
  h.routes.get("POST /api/notifications/read")(req, marked);
  assert.deepEqual(marked.payload, { ok: true, marked: 2 });
  assert.equal(h.saves, 1);

  const listed = response();
  h.routes.get("GET /api/notifications")(req, listed);
  assert.deepEqual(listed.payload.map((item) => [item.id, item.read]), [["shared", true], ["private", true]]);
  assert.deepEqual(visibleNotificationsForUser(db, { tenantId: "tenant_owner", userId: "owner" }).map((item) => [item.id, item.read]), [["shared", true], ["private", true]]);
});

test("一个用户全部已读不会把共享通知错误标成其他用户已读", () => {
  const db = { notifications: [{ id: "shared", tenantId: "tenant_owner", read: false, readByUserIds: ["owner"] }] };
  assert.equal(visibleNotificationsForUser(db, { tenantId: "tenant_owner", userId: "owner" })[0].read, true);
  assert.equal(visibleNotificationsForUser(db, { tenantId: "tenant_owner", userId: "trader" })[0].read, false);
});

test("旧版全局 read=true 仅在尚无逐用户读者记录时兼容", () => {
  const db = { notifications: [
    { id: "legacy", read: true },
    { id: "tracked", read: true, readByUserIds: ["owner"] }
  ] };
  const trader = visibleNotificationsForUser(db, { tenantId: "tenant_owner", userId: "trader" });
  assert.equal(trader.find((item) => item.id === "legacy").read, true);
  assert.equal(trader.find((item) => item.id === "tracked").read, false);
});
