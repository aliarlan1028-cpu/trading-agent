export function externalAlertConfigured(env = process.env) {
  return Boolean(env.ALERT_WEBHOOK_URL
    || env.LARK_WEBHOOK_URL);
}

export function alertDeliverySucceeded(alert) {
  return alert?.status === "sent"
    || alert?.larkStatus === "sent";
}

export function recentExternalAlertSucceeded(db, maxAgeMs = 24 * 60 * 60_000, now = Date.now()) {
  return (db.alerts || []).some((alert) => alertDeliverySucceeded(alert)
    && now - new Date(alert.sentAt || alert.createdAt || 0).getTime() <= maxAgeMs);
}
