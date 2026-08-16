import crypto from "node:crypto";

export const APPROVABLE_PLAN_STATUSES = new Set(["draft", "risk_checked", "awaiting_approval"]);
export const APPROVAL_REQUESTABLE_PLAN_STATUSES = new Set(["draft", "risk_checked", "execution_blocked"]);
export const LOCALLY_CANCELLABLE_PLAN_STATUSES = new Set(["draft", "risk_checked", "awaiting_approval", "armed", "execution_blocked"]);
export const TERMINAL_PLAN_STATUSES = new Set([
  "completed", "cancelled", "canceled", "expired", "failed", "rejected",
  "dry_run", "risk_rejected", "auto_blocked", "protection_failed"
]);

export function isTerminalTradePlan(rowOrStatus) {
  const status = typeof rowOrStatus === "object" ? rowOrStatus?.status : rowOrStatus;
  return TERMINAL_PLAN_STATUSES.has(String(status || "").toLowerCase());
}

export function isNonTerminalTradePlan(rowOrStatus) {
  return !isTerminalTradePlan(rowOrStatus);
}

const RESERVED_CREATE_FIELDS = new Set([
  "id", "status", "exchange", "marketType", "createdAt", "updatedAt", "mandateVersion",
  "approvedAt", "approvedBy", "closedAt", "completedAt", "cancelledAt", "executionOrderId"
]);

const PLAN_CREATE_FIELDS = new Set([
  "mandateId", "symbol", "direction", "strategy", "strategyId", "strategyVersionId",
  "strategyBlueprintVersionId", "setupType", "traderRole", "timeframe", "entryPrice",
  "entry_range", "entryRange", "stopLoss", "stop_loss", "takeProfit", "takeProfits",
  "riskPercent", "riskPct", "leverage", "quantity", "notionalUsdt", "reasoningSummary",
  "thesis", "invalidation", "triggerSpec", "scenarioStages", "triggerConfirmations",
  "executionMode", "appliedLenses", "appliedRules", "appliedReviewLessons",
  "adoptedToolSkillIds", "outOfWhitelist", "oneTimeAuthorization", "notes"
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function planRevision(plan = {}) {
  const material = { ...plan };
  delete material.approvalRequestedAt;
  return crypto.createHash("sha256").update(JSON.stringify(canonical(material))).digest("hex");
}

export function approvalSnapshot(plan, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now());
  const ttlMs = Math.max(30_000, Number(options.ttlMs ?? 10 * 60_000));
  return {
    expectedPlanStatus: String(plan?.status || ""),
    expectedPlanVersion: plan?.version ?? null,
    expectedPlanUpdatedAt: plan?.updatedAt ?? null,
    expectedPlanRevision: planRevision(plan),
    expiresAt: new Date(nowMs + ttlMs).toISOString()
  };
}

export function validateApprovalSnapshot(plan, snapshot = {}, options = {}) {
  if (!plan) return { ok: false, status: 404, error: "plan_not_found" };
  if (!APPROVABLE_PLAN_STATUSES.has(String(plan.status || ""))) {
    return { ok: false, status: 409, error: "plan_not_approvable", currentStatus: plan.status };
  }
  const nowMs = Number(options.nowMs ?? Date.now());
  const expiresMs = new Date(snapshot.expiresAt || 0).getTime();
  if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) return { ok: false, status: 409, error: "approval_expired" };
  if (snapshot.expectedPlanStatus !== plan.status
    || (snapshot.expectedPlanVersion ?? null) !== (plan.version ?? null)
    || (snapshot.expectedPlanUpdatedAt ?? null) !== (plan.updatedAt ?? null)
    || snapshot.expectedPlanRevision !== planRevision(plan)) {
    return { ok: false, status: 409, error: "plan_revision_conflict", currentStatus: plan.status };
  }
  return { ok: true };
}

export function selectApprovablePlan(db, planId) {
  if (planId) {
    const plan = (db.tradePlans || []).find((item) => item.id === planId);
    return APPROVABLE_PLAN_STATUSES.has(String(plan?.status || "")) ? plan : null;
  }
  return (db.tradePlans || []).find((item) => APPROVABLE_PLAN_STATUSES.has(String(item.status || ""))) || null;
}

export function constructTradePlan(body = {}, defaults = {}) {
  const injected = Object.keys(body).filter((key) => RESERVED_CREATE_FIELDS.has(key));
  if (injected.length) return { ok: false, status: 400, error: "reserved_trade_plan_fields", fields: injected };
  const plan = {};
  for (const key of PLAN_CREATE_FIELDS) if (body[key] !== undefined) plan[key] = body[key];
  Object.assign(plan, {
    id: defaults.id,
    mandateId: body.mandateId ?? defaults.mandateId,
    exchange: "OKX",
    marketType: "perpetual_usdt",
    strategy: body.strategy ?? defaults.strategy,
    status: "draft",
    mandateVersion: defaults.mandateVersion,
    createdAt: defaults.createdAt
  });
  if (!plan.id || !plan.createdAt) return { ok: false, status: 500, error: "trade_plan_server_fields_missing" };
  return { ok: true, plan };
}

export function assertUniquePlanId(db, planId) {
  return !(db.tradePlans || []).some((item) => item.id === planId);
}

export function requestPlanApprovalTransition(plan, at) {
  if (!plan) return { ok: false, status: 404, error: "plan_not_found" };
  if (!APPROVAL_REQUESTABLE_PLAN_STATUSES.has(String(plan.status || ""))) {
    return { ok: false, status: 409, error: "plan_state_conflict", currentStatus: plan.status };
  }
  plan.status = "awaiting_approval";
  plan.approvalRequestedAt = at;
  plan.updatedAt = at;
  return { ok: true, plan };
}

export function linkedExecutionBlocksLocalCancel(execution = {}) {
  const status = String(execution.status || "").toLowerCase();
  return !["closed", "cancelled", "failed", "rejected", "expired", "recovered_compensated", "dry_run"].includes(status);
}

export function validateLocalPlanCancel(db, plan) {
  if (!plan) return { ok: false, status: 404, error: "plan_not_found" };
  if (TERMINAL_PLAN_STATUSES.has(String(plan.status || ""))) return { ok: true, idempotent: true, plan };
  const linked = (db.executionOrders || []).filter((item) => item.tradePlanId === plan.id || item.planId === plan.id);
  const blockers = linked.filter(linkedExecutionBlocksLocalCancel);
  if (blockers.length) {
    return { ok: false, status: 409, error: "plan_has_remote_execution", executionOrders: blockers.map((item) => ({ id: item.id, status: item.status })) };
  }
  if (!LOCALLY_CANCELLABLE_PLAN_STATUSES.has(String(plan.status || ""))) {
    return { ok: false, status: 409, error: "plan_state_conflict", currentStatus: plan.status };
  }
  return { ok: true, plan };
}

export async function approveTradePlan(db, plan, deps, options = {}) {
  if (!plan) return { ok: false, status: 404, error: "plan_not_found" };
  if (options.snapshot) {
    const snapshotCheck = validateApprovalSnapshot(plan, options.snapshot, options);
    if (!snapshotCheck.ok) return snapshotCheck;
  } else if (!APPROVABLE_PLAN_STATUSES.has(String(plan.status || ""))) {
    return { ok: false, status: 409, error: "plan_not_approvable", currentStatus: plan.status };
  }
  if (!plan.lastRiskCheck) return { ok: false, status: 400, error: "risk_check_required" };
  if (!plan.lastRiskCheck.passed) return { ok: false, status: 400, error: "risk_blocked", summary: plan.lastRiskCheck.summary };
  const fresh = deps.evaluateTradePlan(db, plan);
  fresh.tradePlanId = plan.id;
  fresh.createdAt = deps.nowIso();
  db.riskChecks ||= [];
  db.riskChecks.unshift(fresh);
  plan.lastRiskCheck = fresh;
  plan.riskCheckId = fresh.id;
  if (!fresh.passed) return { ok: false, status: 400, error: "risk_blocked", summary: fresh.summary, riskCheck: fresh };
  const approvedAt = deps.nowIso();
  plan.status = "approved";
  plan.approvedAt = approvedAt;
  plan.approvedBy = options.actor;
  plan.updatedAt = approvedAt;
  deps.appendAudit?.(db, options.auditLabel || "人工批准交易计划", plan.id, options.actor, "warning");
  const execution = await deps.executeApprovedPlan(db, plan.id, { manualApproval: true });
  const guard = deps.describeGuardReason?.(execution?.reason);
  if (execution?.planDisposition === "no_remote_effect" || execution?.planDisposition === "terminal_rejection") {
    return {
      ok: false,
      status: execution.planDisposition === "terminal_rejection" ? 502 : 409,
      error: "execution_not_submitted",
      approvalGranted: true,
      executionSubmitted: false,
      plan,
      execution,
      guard
    };
  }
  return {
    ok: true,
    status: execution?.planDisposition === "remote_effect_unresolved" ? 202 : 200,
    approvalGranted: true,
    executionSubmitted: execution?.executionSubmitted,
    plan,
    execution,
    guard
  };
}
