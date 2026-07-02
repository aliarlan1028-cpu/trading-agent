import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

export function runReconciler(db, options = {}) {
  const mode = options.mode || "full";
  const latestSnapshotsByAccount = latestSnapshots(db);
  const differences = [
    ...checkStopLossCoverage(db),
    ...checkSnapshotFreshness(db, latestSnapshotsByAccount),
    ...checkRealtimeFreshness(db),
    ...checkOrderPlanLinks(db)
  ];
  const severity = highestSeverity(differences);
  const hasHighRisk = differences.some((item) => item.severity === "critical" || item.severity === "high");
  const report = {
    id: id("recon"),
    mode,
    status: hasHighRisk ? "needs_attention" : differences.length ? "degraded" : "ok",
    severity,
    differences,
    createdAt: nowIso()
  };
  db.reconciliationReports.unshift(report);
  if (report.status === "needs_attention") {
    db.riskIncidents.unshift({
      id: id("incident"),
      severity,
      status: "open",
      title: "实时/账户对账发现差异",
      source: report.id,
      details: differences,
      createdAt: nowIso()
    });
  }
  appendAudit(db, `执行对账：${report.status}`, report.id, "Reconciler", report.status === "ok" ? "info" : "warning");
  appendTrace(db, "reconciler", `对账 ${mode}`, report.status);
  return report;
}

function checkStopLossCoverage(db) {
  return (db.positions || [])
    .filter((position) => !position.stopLoss)
    .map((position) => ({
      type: "missing_stop_loss",
      severity: "critical",
      symbol: position.symbol,
      message: `${position.symbol} 持仓缺少止损，必须立即处理。`
    }));
}

function checkSnapshotFreshness(db, latestByAccount) {
  const differences = [];
  for (const account of db.exchangeAccounts || []) {
    const snapshot = latestByAccount.get(account.id);
    if (!snapshot) {
      differences.push({ type: "missing_account_snapshot", severity: account.readEnabled ? "high" : "low", accountId: account.id, message: `${account.exchange} 尚无账户快照。` });
      continue;
    }
    const ageMs = Date.now() - new Date(snapshot.createdAt).getTime();
    if (ageMs > 5 * 60_000) {
      differences.push({ type: "stale_account_snapshot", severity: "medium", accountId: account.id, ageSeconds: Math.round(ageMs / 1000), message: `${account.exchange} 账户快照超过 5 分钟未更新。` });
    }
    if (snapshot.status && snapshot.status !== "ok" && snapshot.status !== "missing_credentials") {
      differences.push({ type: "snapshot_sync_error", severity: "medium", accountId: account.id, status: snapshot.status, message: `${account.exchange} 私有只读同步状态异常。` });
    }
  }
  return differences;
}

function checkRealtimeFreshness(db) {
  const differences = [];
  for (const connection of db.realtimeConnections || []) {
    if (connection.streamType !== "public_market") continue;
    if (connection.status === "disabled_by_env") {
      differences.push({ type: "realtime_disabled", severity: "low", connectionId: connection.id, message: `${connection.exchange} 实时流未启用。` });
      continue;
    }
    if (!connection.lastMessageAt && connection.status !== "connected") {
      differences.push({ type: "realtime_not_connected", severity: "medium", connectionId: connection.id, message: `${connection.exchange} 公共行情流未连接。` });
    }
  }
  return differences;
}

function checkOrderPlanLinks(db) {
  const planIds = new Set((db.tradePlans || []).map((plan) => plan.id));
  return (db.orders || [])
    .filter((order) => order.planId && !planIds.has(order.planId))
    .map((order) => ({
      type: "orphan_order",
      severity: "high",
      orderId: order.id,
      message: `订单 ${order.id} 关联的交易计划不存在。`
    }));
}

function latestSnapshots(db) {
  const map = new Map();
  for (const snapshot of db.accountSnapshots || []) {
    if (!map.has(snapshot.accountId)) map.set(snapshot.accountId, snapshot);
  }
  return map;
}

function highestSeverity(differences) {
  const order = ["low", "medium", "high", "critical"];
  return differences.reduce((max, item) => order.indexOf(item.severity) > order.indexOf(max) ? item.severity : max, "low");
}
