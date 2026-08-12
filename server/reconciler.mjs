import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { applyOperationalDegradation } from "./professionalRiskGate.mjs";

export function runReconciler(db, options = {}) {
  const mode = options.mode || "full";
  const latestSnapshotsByAccount = latestSnapshots(db);
  resolveEmergencyClosures(db, latestSnapshotsByAccount);
  const differences = [
    ...checkStopLossCoverage(db, latestSnapshotsByAccount),
    ...checkSnapshotFreshness(db, latestSnapshotsByAccount),
    ...checkRealtimeFreshness(db),
    ...checkOrderPlanLinks(db),
    ...checkLocalVsExchange(db, latestSnapshotsByAccount)
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
  // 严格按时间倒序 + 限长:历史一次 DB 还原把数组顺序打乱了,导致前端读 [0] 拿到的是旧报告
  // (对账结果显示成 3 天前);同时数组从未限长、会无限增长。两处一并修好。
  db.reconciliationReports.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (db.reconciliationReports.length > 200) db.reconciliationReports.length = 200;
  // 对账类风险事件折叠:每个巡检周期只维护【一条】open 记录,不再无限堆叠(曾累积到 100+ 条纯重复告警)。
  // 先清掉所有 open 的对账重复项(它们无独立信息,完整差异历史留在 reconciliationReports 里),
  // 再按当前状态决定是否保留一条;对账恢复正常时自然清零。兼容历史上没有 kind 的旧记录(按标题匹配)。
  const isReconIncident = (item) => item.status === "open" && (item.kind === "reconcile" || item.title === "实时/账户对账发现差异");
  db.riskIncidents = (db.riskIncidents || []).filter((item) => !isReconIncident(item));
  if (report.status === "needs_attention") {
    db.riskIncidents.unshift({
      id: id("incident"),
      kind: "reconcile",
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
  if (report.status === "ok" && ["oms_recovery", "armed_setup_recovery", "liquidation_emergency", "protection_emergency"].includes(db.system?.reduceOnlyBy)
    && !(db.executionOrders || []).some((item) => String(item.status).toUpperCase() === "UNKNOWN")) {
    const recoverySource = db.system.reduceOnlyBy;
    for (const execution of (db.executionOrders || []).filter((item) => item.status === "recovery_pending_reconciliation")) {
      execution.status = "recovered_compensated";
      execution.events ||= [];
      execution.events.push({ at: nowIso(), event: "recovery_reconciled", detail: report.id });
      const plan = (db.tradePlans || []).find((item) => item.id === execution.planId);
      if (plan) plan.status = "failed";
    }
    for (const setup of (db.armedSetups || []).filter((item) => item.status === "RECOVERY_PENDING_RECONCILIATION")) {
      setup.status = "RECOVERED_RECONCILED";
      setup.closedAt = nowIso();
      setup.updatedAt = setup.closedAt;
      setup.events ||= [];
      setup.events.push({ at: setup.closedAt, event: "RECOVERY_RECONCILED", detail: report.id });
      const plan = (db.tradePlans || []).find((item) => item.id === setup.planId);
      if (plan?.status === "recovery_pending_reconciliation") plan.status = "failed";
      const candidate = (db.opportunityCandidates || []).find((item) => item.planId === setup.planId);
      if (candidate) {
        candidate.status = "RECOVERED_RECONCILED";
        candidate.updatedAt = setup.closedAt;
      }
    }
    db.riskIncidents = (db.riskIncidents || []).map((incident) =>
      incident.status === "open" && (db.armedSetups || []).some((setup) => setup.omsOrderId === incident.source)
        ? { ...incident, status: "resolved", resolvedAt: nowIso(), resolution: report.id }
        : incident
    );
    db.system.reduceOnlyMode = false;
    db.system.reduceOnlyBy = null;
    db.system.riskStatus = "正常";
    db.system.latestAction = recoverySource === "armed_setup_recovery"
      ? "条件交易重启恢复已通过 OKX 账户对账，确认无未决差异并恢复自主开仓"
      : "UNKNOWN 订单自动补偿已通过 OKX 账户对账，恢复自主开仓";
    appendAudit(db, db.system.latestAction, report.id, "Reconciler", "warning");
    appendTrace(db, recoverySource === "armed_setup_recovery" ? "armed_setup" : "oms_recovery", db.system.latestAction, "ok");
  }
  // 对账报告本身是运行降级闸的关键输入。每次生成新报告后立刻复评，
  // 让连接/对账恢复可自动解除本闸设置的只减仓，避免等待下一次 AI 巡检。
  applyOperationalDegradation(db, "Reconciler");
  return report;
}

function resolveEmergencyClosures(db, latestByAccount) {
  const snapshot = [...latestByAccount.values()].find((item) => item.exchange === "OKX" && item.status === "ok");
  if (!snapshot) return;
  const remoteSymbols = new Set((snapshot.positions || [])
    .filter((position) => Number(position.pos || 0) !== 0)
    .map((position) => String(position.instId || "").replace("-SWAP", "").replace("-", "/")));
  const pending = (db.executionOrders || []).filter((item) => ["recovery_pending_reconciliation", "emergency_close_pending"].includes(item.status));
  for (const execution of pending) {
    const submittedAt = execution.events?.at(-1)?.at || execution.updatedAt || execution.createdAt;
    if (new Date(snapshot.createdAt).getTime() < new Date(submittedAt).getTime()) continue;
    if (remoteSymbols.has(execution.symbol)) continue;
    db.positions = (db.positions || []).filter((position) => !(position.source === "execution_engine" && position.executionOrderId === execution.id));
    execution.status = execution.status === "emergency_close_pending" ? "emergency_closed" : "recovered_compensated";
    execution.events ||= [];
    execution.events.push({ at: nowIso(), event: "exchange_position_absent", detail: snapshot.id });
    const plan = (db.tradePlans || []).find((item) => item.id === execution.planId);
    if (plan) plan.status = "failed";
  }
}

export function checkStopLossCoverage(db, latestByAccount = latestSnapshots(db)) {
  const managed = (db.positions || [])
    // 只审计执行引擎托管仓。REST/WS 行是同一仓位的权威镜像，不能重复审计。
    .filter((position) => position.source === "execution_engine" && Number(position.size || 0) !== 0);
  if (!managed.length) return [];

  const snapshot = [...latestByAccount.values()].find((item) => item.exchange === "OKX" && item.status === "ok");
  const algoOrders = Array.isArray(snapshot?.algoOrders) ? snapshot.algoOrders : null;
  const differences = [];
  for (const position of managed) {
    if (!position.stopLoss) {
      differences.push({ type: "missing_stop_loss", severity: "critical", symbol: position.symbol, message: `${position.symbol} 持仓缺少本地止损定义，必须立即处理。` });
      continue;
    }
    const execution = (db.executionOrders || []).find((item) => item.id === position.executionOrderId);
    const stopClientOrderId = execution?.stopClientOrderId;
    if (!stopClientOrderId) {
      differences.push({ type: "stop_identity_missing", severity: "critical", symbol: position.symbol, message: `${position.symbol} 止损缺少可在 OKX 核验的客户端算法单号。` });
      continue;
    }
    if (!snapshot || !algoOrders) {
      differences.push({ type: "stop_coverage_unverified", severity: "critical", symbol: position.symbol, message: `${position.symbol} 尚无包含 OKX 策略委托的成功快照，无法证明止损仍有效。` });
      continue;
    }
    const baseInstId = String(position.symbol || "").replace("/", "-").toUpperCase();
    const expectedInstId = baseInstId.endsWith("-SWAP") ? baseInstId : `${baseInstId}-SWAP`;
    const remoteStop = algoOrders.find((order) => order.algoClOrdId === stopClientOrderId
      && String(order.instId || "").toUpperCase() === expectedInstId
      && Number(order.slTriggerPx || 0) > 0);
    if (!remoteStop) {
      differences.push({ type: "exchange_stop_missing", severity: "critical", symbol: position.symbol, stopClientOrderId, snapshotId: snapshot.id, message: `${position.symbol} 的 OKX 未触发止损委托不存在，仓位可能裸奔。` });
    }
  }
  return differences;
}

function checkSnapshotFreshness(db, latestByAccount) {
  const differences = [];
  for (const account of db.exchangeAccounts || []) {
    // 未配置只读凭证的交易所不纳入对账：它只是"没接入"（在交易所同步卡里已如实显示），
    // 不是"缺快照"的异常——否则会让整体对账永远停在"降级运行"的噪音上。
    if (!account.readEnabled) continue;
    const snapshot = latestByAccount.get(account.id);
    if (!snapshot) {
      differences.push({ type: "missing_account_snapshot", severity: "high", accountId: account.id, message: `${account.exchange} 尚无账户快照。` });
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

// 本地状态 vs 交易所快照：孤儿挂单、幽灵持仓、数量偏差。
function checkLocalVsExchange(db, latestByAccount) {
  const differences = [];
  const snapshot = [...latestByAccount.values()].find((item) => item.status === "ok");
  if (!snapshot) return differences;

  const exchangeClientOrderIds = new Set(
    (snapshot.openOrders || []).map((order) => order.clOrdId || order.clientOrderId || order.origClientOrderId).filter(Boolean)
  );
  for (const executionOrder of (db.executionOrders || []).filter((item) => item.status === "entry_pending")) {
    if (executionOrder.clientOrderId && !exchangeClientOrderIds.has(executionOrder.clientOrderId)) {
      differences.push({
        type: "local_order_missing_on_exchange",
        severity: "high",
        executionOrderId: executionOrder.id,
        message: `执行单 ${executionOrder.clientOrderId} 在交易所挂单列表中不存在（可能已成交/取消，等待轮询确认）。`
      });
    }
  }

  const exchangePositions = new Map(
    (snapshot.positions || [])
      .filter((position) => Number(position.pos || position.positionAmt || 0) !== 0)
      .map((position) => [String(position.instId || position.symbol || "").replace("-SWAP", "").replace("-", "/"), position])
  );
  // OKX 快照 quantity 是“张”，执行引擎 quantity 是“币”。applyOkxSnapshot 已把 ctVal 换算成
  // coinSize，数量对账必须使用相同单位，不能把 1 张和 0.01 BTC 直接比较。
  for (const [symbol, remote] of exchangePositions) {
    const normalized = (db.positions || []).find((item) => item.source === "exchange_rest" && item.exchange === "OKX" && item.symbol === symbol);
    if (normalized && Number.isFinite(Number(normalized.coinSize))) remote.normalizedCoinSize = Math.abs(Number(normalized.coinSize));
  }
  for (const position of (db.positions || []).filter((item) => item.source === "execution_engine")) {
    const remote = exchangePositions.get(position.symbol);
    if (!remote) {
      differences.push({
        type: "ghost_local_position",
        severity: "critical",
        symbol: position.symbol,
        message: `本地持仓 ${position.symbol} 在交易所不存在，可能已被止损/手动平仓，需要人工确认。`
      });
      continue;
    }
    const remoteSize = Number.isFinite(Number(remote.normalizedCoinSize))
      ? Math.abs(Number(remote.normalizedCoinSize))
      : Math.abs(Number(remote.pos || remote.positionAmt || 0));
    if (remoteSize && Math.abs(remoteSize - Number(position.size)) / remoteSize > 0.05) {
      differences.push({
        type: "position_size_mismatch",
        severity: "high",
        symbol: position.symbol,
        localSize: position.size,
        exchangeSize: remoteSize,
        message: `${position.symbol} 本地数量 ${position.size} 与交易所 ${remoteSize} 偏差超过 5%。`
      });
    }
  }
  for (const [symbol] of exchangePositions) {
    if (!(db.positions || []).some((item) => item.symbol === symbol)) {
      differences.push({
        type: "untracked_exchange_position",
        severity: "high",
        symbol,
        message: `交易所存在本地未跟踪的持仓 ${symbol}（可能为手动开仓）。`
      });
    }
  }
  return differences;
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
