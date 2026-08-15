const EXECUTION_BLOCKING_STATES = new Set([
  "entry_unknown_pending", "entry_partial", "cancel_pending", "cancel_unknown_pending",
  "protection_failure_cancel_pending", "close_pending", "close_unknown_pending",
  "close_reconciliation_pending", "group_close_pending", "recovery_pending_reconciliation",
  "emergency_close_pending"
]);

const STICKY_REASON_CODES = new Set([
  "manual_reduce_only", "emergency_flatten", "liquidation_emergency", "protection_emergency",
  "audit_chain_integrity", "unknown_legacy_reduce_only"
]);

function records(db) {
  db.system ||= {};
  db.system.reduceOnlyReasonRecords ||= {};
  return db.system.reduceOnlyReasonRecords;
}

function recordKey(code, sourceId) {
  return `${code}:${sourceId || "global"}`;
}

export function setReduceOnlyReason(db, code, options = {}) {
  if (!code) return null;
  const map = records(db);
  const key = recordKey(code, options.sourceId);
  const current = map[key] || {};
  map[key] = {
    code,
    sourceId: options.sourceId ?? current.sourceId ?? null,
    sticky: options.sticky ?? current.sticky ?? STICKY_REASON_CODES.has(code),
    openedAt: current.openedAt || options.openedAt || new Date().toISOString(),
    updatedAt: options.updatedAt || new Date().toISOString(),
    resolvedAt: null,
  };
  return map[key];
}

export function clearReduceOnlyReason(db, code, options = {}) {
  let cleared = false;
  for (const [key, row] of Object.entries(records(db))) {
    if (!row || row.code !== code || row.resolvedAt) continue;
    if (options.sourceId != null && String(row.sourceId || "") !== String(options.sourceId)) continue;
    row.resolvedAt = options.resolvedAt || new Date().toISOString();
    row.resolvedBy = options.resolvedBy || null;
    row.resolution = options.resolution || null;
    records(db)[key] = row;
    cleared = true;
  }
  return cleared;
}

function migrateLegacyScalar(db) {
  if (Number(db.system?.reduceOnlyReasonsSchemaVersion || 0) >= 2) return;
  const legacy = String(db.system?.reduceOnlyBy || "").trim();
  db.system.reduceOnlyReasonsSchemaVersion = 2;
  if (!db.system?.reduceOnlyMode || !legacy || legacy.startsWith("execution:")) return;
  const known = new Set([
    "manual_reduce_only", "kill_switch", "emergency_flatten", "liquidation_emergency", "protection_emergency",
    "audit_chain_integrity", "oms_recovery", "armed_setup_recovery", "financial_reconciliation_pending",
    "professional_risk_gate", "entry_reconciliation_pending", "cancel_reconciliation_pending",
    "close_reconciliation_pending", "protection_failure_reconciliation"
  ]);
  const persistentLegacy = STICKY_REASON_CODES.has(legacy) || ["oms_recovery", "armed_setup_recovery"].includes(legacy) || !known.has(legacy);
  if (!persistentLegacy) return;
  const code = known.has(legacy) ? legacy : `unknown_legacy_reduce_only:${legacy}`;
  setReduceOnlyReason(db, code, { sticky: STICKY_REASON_CODES.has(legacy) || !known.has(legacy), sourceId: "legacy_scalar_migration" });
}

export function deriveReduceOnlyReasons(db = {}) {
  db.system ||= {};
  migrateLegacyScalar(db);
  const reasons = new Set();
  for (const row of Object.values(records(db))) {
    if (row && !row.resolvedAt) reasons.add(row.code);
  }
  if (db.system.manualReduceOnly === true) reasons.add("manual_reduce_only");
  if (db.system.killSwitch === true) reasons.add("kill_switch");
  for (const execution of db.executionOrders || []) {
    if (EXECUTION_BLOCKING_STATES.has(String(execution.status || ""))) reasons.add(`execution:${execution.status}`);
  }
  if ((db.armedSetups || []).some((setup) => String(setup.status || "").toUpperCase() === "RECOVERY_PENDING_RECONCILIATION")) {
    reasons.add("armed_setup_recovery");
  }
  if ((db.orders || []).some((order) => ["cancel_pending", "cancel_unknown_pending"].includes(String(order.status || "")))) reasons.add("orphan_order_cancel_pending");
  // 只让当前风险窗口内的权威核算缺口触发只减仓。历史复盘可继续等待费用/资金费回补，
  // 但不能因为一个永久 pending 的旧 review 把系统无限期锁死；日/滚动 168h 缺口由
  // accounting 直接从 fills、持仓与基线计算，仍会 fail closed。
  if (Number(db.portfolio?.pendingFinancialReconciliationToday || 0) > 0
    || Number(db.portfolio?.pendingFinancialReconciliationWeek || 0) > 0) reasons.add("financial_reconciliation_pending");
  if (db.system?.operationalDegradation?.enforced && db.system.operationalDegradation.degraded) reasons.add("professional_risk_gate");
  return [...reasons].sort();
}

export function activeReduceOnlyReasonCodes(db = {}) {
  return deriveReduceOnlyReasons(db);
}

export function syncReduceOnlyState(db = {}) {
  db.system ||= {};
  const reasons = deriveReduceOnlyReasons(db);
  db.system.reduceOnlyReasons = reasons;
  db.system.reduceOnlyMode = reasons.length > 0;
  // 仅为旧 UI 保留主原因；业务控制流读取 reasons/records。
  db.system.reduceOnlyBy = reasons[0] || null;
  if (reasons.length) db.system.riskStatus = db.system.killSwitch ? "熔断停机" : "只减仓";
  else if (db.system.riskStatus === "只减仓") db.system.riskStatus = "正常";
  return { reduceOnlyMode: db.system.reduceOnlyMode, reasons };
}
