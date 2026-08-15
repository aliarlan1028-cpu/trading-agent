import { executeTradeAction } from "./tradeActions.mjs";
import { validateOkxCredentialBinding } from "./exchangeConnector.mjs";
import { latestSuccessfulAccountSnapshot } from "./store.mjs";

export async function cancelAuthoritativeOrphanOrders(db, reason, emergencyActionId) {
  const snapshot = latestSuccessfulAccountSnapshot(db, { exchange: "OKX" });
  const binding = validateOkxCredentialBinding(db, { accountId: snapshot?.accountId, snapshot });
  if (!snapshot || !binding.ok || Date.now() - new Date(snapshot.createdAt || 0).getTime() > Number(process.env.MAX_ACCOUNT_SNAPSHOT_AGE_MS || 600000)) {
    return { requested: [], unknown: [], failed: [{ status: binding.reason || "authoritative_open_orders_snapshot_unavailable" }] };
  }
  const activelyCancellingIds = new Set();
  for (const row of db.executionOrders || []) {
    const hasDurableCancelIntent = ["cancel_pending", "cancel_unknown_pending", "protection_failure_cancel_pending"].includes(row.status)
      && Boolean(row.cancelAttemptedAt || row.cancelSubmittedAt);
    if (!hasDurableCancelIntent) continue;
    if (row.exchangeOrderId) activelyCancellingIds.add(`ord:${row.exchangeOrderId}`);
    if (row.clientOrderId) activelyCancellingIds.add(`cl:${row.clientOrderId}`);
  }
  const requested = [], unknown = [], failed = [];
  for (const order of snapshot.openOrders || []) {
    if (order.reduceOnly === true || order.reduceOnly === "true") continue;
    const orderId = order.ordId || order.exchangeOrderId || null;
    const clientOrderId = order.clOrdId || order.clientOrderId || null;
    if ((orderId && activelyCancellingIds.has(`ord:${orderId}`)) || (clientOrderId && activelyCancellingIds.has(`cl:${clientOrderId}`))) continue;
    const result = await executeTradeAction(db, "cancel_order", {
      exchange: "OKX",
      accountId: snapshot.accountId,
      apiKeyFingerprint: snapshot.apiKeyFingerprint,
      marketType: "perpetual_usdt",
      symbol: String(order.instId || order.symbol || "").replace(/-SWAP$/i, "").replace("-", "/"),
      orderId,
      clientOrderId,
      emergencyActionId: `${emergencyActionId}_${String(orderId || clientOrderId || "order").replace(/[^a-zA-Z0-9]/g, "").slice(-12)}`,
      reason,
      manualApproval: true
    });
    const local = (db.orders || []).find((row) => (orderId && row.exchangeOrderId === orderId) || (clientOrderId && row.clientOrderId === clientOrderId));
    if (["ok", "submitted", "idempotent_replay"].includes(result.status)) {
      if (local) local.status = "cancel_pending";
      requested.push({ orderId, clientOrderId, status: "cancel_pending" });
    } else if (result.status === "unknown_pending") {
      if (local) local.status = "cancel_unknown_pending";
      unknown.push({ orderId, clientOrderId, status: "cancel_unknown_pending" });
    } else {
      failed.push({ orderId, clientOrderId, status: result.status, reason: result.reason || null });
    }
  }
  return { requested, unknown, failed };
}

export async function applyKillSwitch(db, input = {}, deps = {}) {
  const enabled = input.enabled !== false;
  const actor = input.actor || "Owner";
  const reason = String(input.reason || "").trim();
  const {
    closeExecution,
    cancelOrphans = cancelAuthoritativeOrphanOrders,
    notifyLark = async () => {},
    appendAudit = () => {},
    appendTrace = () => {},
    id = (prefix) => `${prefix}_${Date.now()}`,
    nowIso = () => new Date().toISOString()
  } = deps;
  if (enabled && typeof closeExecution !== "function") throw new Error("kill_switch_close_service_unavailable");

  db.system ||= {};
  db.system.killSwitch = enabled;
  if (enabled) db.system.autonomyEnabled = false;
  db.system.riskStatus = enabled ? "熔断停机" : "正常";

  let cancellationResults = [];
  let orphanCancellations = { requested: [], unknown: [], failed: [] };
  if (enabled) {
    for (const executionOrder of db.executionOrders || []) {
      if (!["entry_unknown_pending", "entry_pending", "entry_partial", "entry_filled", "protecting", "protecting_degraded"].includes(executionOrder.status)) continue;
      const currentStatus = executionOrder.status;
      const intent = ["entry_unknown_pending", "entry_pending", "entry_partial"].includes(currentStatus) ? "emergency_close_if_filled" : "close_position";
      const result = await closeExecution(db, executionOrder.id, "kill_switch", {
        intent,
        expectedStatus: currentStatus,
        internal: true,
        emergencyActionId: `emergency_kill_${executionOrder.id}`
      });
      cancellationResults.push({
        executionOrderId: executionOrder.id,
        status: result.status,
        detail: result.result?.reason || result.result?.status || null
      });
    }
    orphanCancellations = await cancelOrphans(db, "kill_switch", "emergency_kill");
    const cancelRequested = orphanCancellations.requested.map((row) => row.orderId || row.clientOrderId);
    if (cancelRequested.length || orphanCancellations.unknown.length || orphanCancellations.failed.length || cancellationResults.length) {
      db.riskIncidents ||= [];
      db.riskIncidents.unshift({
        id: id("incident"),
        severity: "critical",
        status: "open",
        title: "一键熔断触发撤单请求",
        source: "risk.kill_switch",
        affectedOrders: cancelRequested,
        orphanCancellations,
        cancellationResults,
        unconfirmed: cancellationResults.filter((item) => !["cancelled", "closed"].includes(item.status)),
        createdAt: nowIso()
      });
    }
    const orphanResults = [...orphanCancellations.requested, ...orphanCancellations.unknown, ...orphanCancellations.failed];
    db.system.lastKillSwitchCancellation = {
      requested: cancellationResults.length + orphanCancellations.requested.length,
      confirmed: cancellationResults.filter((item) => ["cancelled", "closed"].includes(item.status)).length,
      unconfirmed: cancellationResults.filter((item) => !["cancelled", "closed"].includes(item.status)).length + orphanResults.length,
      results: [...cancellationResults, ...orphanResults],
      checkedAt: nowIso()
    };
  }

  appendAudit(db, `${enabled ? "启用一键熔断" : "解除一键熔断"}${reason ? `：${reason}` : ""}`, "risk.kill_switch", actor, enabled ? "critical" : "info");
  appendTrace(db, "risk", enabled ? "一键熔断开启" : "一键熔断解除", enabled ? "blocked" : "ok");
  await notifyLark(db, {
    severity: enabled ? "critical" : "info",
    title: enabled ? "🛑 一键熔断已触发" : "🟢 熔断已解除",
    body: `${enabled
      ? `所有新开仓已被阻断；风险降低动作确认 ${db.system.lastKillSwitchCancellation?.confirmed || 0} 笔，未确认 ${db.system.lastKillSwitchCancellation?.unconfirmed || 0} 笔。未确认项必须人工检查交易所。`
      : "熔断解除，系统恢复正常风控运行。"}${reason ? `\n原因：${reason}` : ""}`
  });
  return { ok: true, killSwitch: enabled, cancellationResults, orphanCancellations, system: db.system };
}
