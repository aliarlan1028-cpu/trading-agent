import assert from "node:assert/strict";
import test from "node:test";
import { alertDeliverySucceeded, externalAlertConfigured, recentExternalAlertSucceeded } from "../server/alertHealth.mjs";

test("Telegram is reserved for profit posters and never satisfies system alert health", () => {
  assert.equal(externalAlertConfigured({ TELEGRAM_BOT_TOKEN: "token" }), false);
  assert.equal(externalAlertConfigured({ TELEGRAM_BOT_TOKEN: "token", TELEGRAM_CHAT_ID: "123" }), false);
  assert.equal(externalAlertConfigured({ LARK_WEBHOOK_URL: "https://example.test/lark" }), true);
});

test("only generic webhook and Lark delivery count as system alert health", () => {
  assert.equal(alertDeliverySucceeded({ status: "sent" }), true);
  assert.equal(alertDeliverySucceeded({ larkStatus: "sent" }), true);
  assert.equal(alertDeliverySucceeded({ telegramStatus: "sent" }), false);
  const db = { alerts: [{ larkStatus: "sent", createdAt: new Date().toISOString() }] };
  assert.equal(recentExternalAlertSucceeded(db), true);
});
