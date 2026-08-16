const EXECUTION_BLOCKING_STATES = new Set([
  "entry_unknown_pending", "entry_partial", "cancel_pending", "cancel_unknown_pending",
  "protection_failure_cancel_pending", "close_pending", "close_unknown_pending",
  "close_reconciliation_pending", "group_close_pending", "recovery_pending_reconciliation",
  "emergency_close_pending"
]);

const STICKY_REASON_CODES = new Set([
  "emergency_flatten", "liquidation_emergency", "protection_emergency",
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
  const schemaVersion = Number(db.system?.reduceOnlyReasonsSchemaVersion || 0);
  // v3 removes the old operator-selectable "manual reduce-only" mode. It was a
  // fourth operating mode layered on top of analyze/approval/automatic and was
  // the main source of contradictory UI state. Runtime safety reasons remain
  // fail-closed; only this obsolete manual latch is retired.
  if (schemaVersion < 3) {
    const resolvedAt = new Date().toISOString();
    for (const [key, row] of Object.entries(records(db))) {
      if (!row || row.code !== "manual_reduce_only" || row.resolvedAt) continue;
      records(db)[key] = {
        ...row,
        resolvedAt,
        resolvedBy: "runtime_state_v3_migration",
        resolution: "manual_opening_pause_retired"
      };
    }
    delete db.system.manualReduceOnly;
  }
  if (schemaVersion >= 2) {
    db.system.reduceOnlyReasonsSchemaVersion = 3;
    return;
  }
  const legacy = String(db.system?.reduceOnlyBy || "").trim();
  db.system.reduceOnlyReasonsSchemaVersion = 3;
  if (!db.system?.reduceOnlyMode || !legacy || legacy.startsWith("execution:")) return;
  const known = new Set([
    "kill_switch", "emergency_flatten", "liquidation_emergency", "protection_emergency",
    "audit_chain_integrity", "oms_recovery", "armed_setup_recovery", "financial_reconciliation_pending",
    "professional_risk_gate", "entry_reconciliation_pending", "cancel_reconciliation_pending",
    "close_reconciliation_pending", "protection_failure_reconciliation"
  ]);
  // A legacy manual latch is deliberately not migrated into a sticky runtime
  // blocker. The user's saved operating mode remains authoritative.
  if (legacy === "manual_reduce_only") return;
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
    if (row && !row.resolvedAt && row.code !== "manual_reduce_only") reasons.add(row.code);
  }
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

export function effectiveRiskStatus(system = {}) {
  if (system.killSwitch === true) return "熔断停机";
  if (system.reduceOnlyMode === true) return "暂停新开仓";
  if (system.autonomyEnabled === false) return "运行已暂停";
  const current = String(system.riskStatus || "");
  return !current || ["正常", "熔断停机", "只减仓", "暂停新开仓", "人工暂停", "运行已暂停"].includes(current) ? "正常" : current;
}

export function syncReduceOnlyState(db = {}) {
  db.system ||= {};
  const reasons = deriveReduceOnlyReasons(db);
  db.system.reduceOnlyReasons = reasons;
  db.system.reduceOnlyMode = reasons.length > 0;
  // 仅为旧数据与执行控制流保留内部字段；产品层统一展示为“暂停新开仓”。
  db.system.reduceOnlyBy = reasons[0] || null;
  db.system.openingPaused = reasons.length > 0;
  db.system.openingPauseReasons = reasons;
  db.system.riskStatus = effectiveRiskStatus(db.system);
  return { reduceOnlyMode: db.system.reduceOnlyMode, reasons };
}
