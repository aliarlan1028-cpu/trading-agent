import test from "node:test";
import assert from "node:assert/strict";
import { createPendingAction } from "../server/agentChat.mjs";
import { settlePlanExecutionOutcome } from "../server/executionEngine.mjs";
import {
  approveTradePlan,
  approvalSnapshot,
  constructTradePlan,
  requestPlanApprovalTransition,
  validateApprovalSnapshot,
  validateLocalPlanCancel
} from "../server/tradePlanLifecycle.mjs";

function plan(status = "awaiting_approval") {
  return {
    id: "plan_1",
    status,
    symbol: "BTC/USDT",
    direction: "long",
    version: 3,
    updatedAt: "2026-08-15T00:00:00.000Z",
    lastRiskCheck: { id: "risk_1", passed: true }
  };
}

test("approve action cards only bind approvable plans and capture an expiring revision", () => {
  const db = { tradePlans: [plan("completed")] };
  const blocked = createPendingAction(db, { type: "approve_plan" }, {});
  assert.equal(blocked.status, "blocked");
  assert.equal(db.pendingActions, undefined);

  db.tradePlans.unshift(plan());
  const created = createPendingAction(db, { type: "approve_plan", planId: "plan_1" }, { requestedByUserId: "u1" });
  assert.equal(created.status, "awaiting_confirmation");
  const args = db.pendingActions[0].args;
  assert.equal(args.expectedPlanStatus, "awaiting_approval");
  assert.match(args.expectedPlanRevision, /^[a-f0-9]{64}$/);
  assert.ok(new Date(args.expiresAt).getTime() > Date.now());
});

test("Agent exposes one three-mode action instead of individual live safety switches", () => {
  const db = { system: { requestedOperatingMode: "observe" }, grayReleasePolicies: [] };
  const created = createPendingAction(db, { type: "set_execution_mode", mode: "full_auto" }, { requestedByUserId: "u1" });
  assert.equal(created.status, "awaiting_confirmation");
  assert.equal(db.pendingActions[0].title, "切换为自动交易");
  assert.equal(db.pendingActions[0].args.mode, "full_auto");
  assert.match(db.pendingActions[0].args.liveConfigFingerprint, /^[a-f0-9]{64}$/);

  const rejected = createPendingAction(db, { type: "set_execution_mode", mode: "manual_reduce_only" }, {});
  assert.equal(rejected.status, "blocked");
  assert.equal(db.pendingActions.length, 1);
});

test("stale, terminal and expired approval snapshots cannot execute", async () => {
  for (const terminal of ["cancelled", "completed", "expired", "executing", "protection_failed"]) {
    const target = plan("awaiting_approval");
    const snapshot = approvalSnapshot(target, { nowMs: 1_000, ttlMs: 60_000 });
    target.status = terminal;
    assert.equal(validateApprovalSnapshot(target, snapshot, { nowMs: 2_000 }).ok, false, terminal);
  }
  const target = plan();
  const expired = approvalSnapshot(target, { nowMs: 1_000, ttlMs: 30_000 });
  assert.equal(validateApprovalSnapshot(target, expired, { nowMs: 31_001 }).error, "approval_expired");

  let executions = 0;
  const db = { riskChecks: [], tradePlans: [target] };
  const result = await approveTradePlan(db, target, {
    evaluateTradePlan: () => ({ id: "fresh", passed: true }),
    executeApprovedPlan: async () => { executions += 1; return { status: "submitted" }; },
    nowIso: () => "2026-08-15T00:01:00.000Z"
  }, { actor: "owner", snapshot: expired, nowMs: 31_001 });
  assert.equal(result.ok, false);
  assert.equal(executions, 0);
  assert.equal(target.status, "awaiting_approval");
});

test("plan approval request cannot revive terminal or executing plans", () => {
  for (const status of ["completed", "cancelled", "expired", "executing", "protection_failed"]) {
    const target = plan(status);
    const result = requestPlanApprovalTransition(target, "2026-08-15T01:00:00.000Z");
    assert.equal(result.status, 409, status);
    assert.equal(target.status, status);
  }
  const target = plan("risk_checked");
  assert.equal(requestPlanApprovalTransition(target, "2026-08-15T01:00:00.000Z").ok, true);
  assert.equal(target.status, "awaiting_approval");
});

test("trade plan creation rejects server-owned fields and always uses server identity", () => {
  for (const body of [{ id: "shadow" }, { status: "completed" }, { exchange: "BINANCE" }, { marketType: "spot" }]) {
    const result = constructTradePlan(body, { id: "server_id", createdAt: "2026-08-15T00:00:00.000Z", mandateVersion: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.error, "reserved_trade_plan_fields");
  }
  const result = constructTradePlan({ symbol: "BTC/USDT", direction: "long" }, {
    id: "server_id", createdAt: "2026-08-15T00:00:00.000Z", mandateVersion: 2, strategy: "trend_following"
  });
  assert.equal(result.ok, true);
  assert.equal(result.plan.id, "server_id");
  assert.equal(result.plan.status, "draft");
  assert.equal(result.plan.exchange, "OKX");
  assert.equal(result.plan.marketType, "perpetual_usdt");
});

test("local plan cancellation refuses every unresolved remote execution state", () => {
  const states = ["created", "entry_pending", "entry_partial", "protecting", "protecting_degraded", "close_unknown_pending"];
  for (const status of states) {
    const target = plan("awaiting_approval");
    const result = validateLocalPlanCancel({ executionOrders: [{ id: "eo1", tradePlanId: target.id, status }] }, target);
    assert.equal(result.error, "plan_has_remote_execution", status);
    assert.equal(target.status, "awaiting_approval");
  }
  const completed = plan("completed");
  const done = validateLocalPlanCancel({ executionOrders: [{ tradePlanId: completed.id, status: "closed" }] }, completed);
  assert.equal(done.idempotent, true);
  assert.equal(completed.status, "completed");
});

test("every preflight outcome consumes approval without leaving an approved zombie", async () => {
  const blockedStatuses = [
    "execution_lease_held", "strategy_product_blocked", "operational_degraded_reduce_only",
    "risk_recheck_failed", "mandate_not_active", "mandate_version_stale", "portfolio_intent_conflict",
    "same_symbol_entry_conflict", "account_configuration_conflict", "sizing_failed",
    "market_facts_rejected", "slippage_rejected", "instrument_spec_unavailable", "blocked"
  ];
  for (const status of blockedStatuses) {
    const target = plan("approved");
    const result = settlePlanExecutionOutcome({ tradePlans: [target], executionOrders: [] }, target.id, { status, reason: "test" });
    assert.equal(result.planDisposition, "no_remote_effect", status);
    assert.equal(result.executionSubmitted, false, status);
    assert.equal(target.status, "execution_blocked", status);
    assert.equal(target.executionBlock.reason, status);
    assert.equal(requestPlanApprovalTransition(target, "2026-08-15T02:00:00.000Z").ok, true, status);
  }
});

test("unknown remote effects enter reconciliation while explicit rejection is terminal", () => {
  const pending = plan("approved");
  const db = {
    tradePlans: [pending],
    executionOrders: [{ id: "eo_unknown", planId: pending.id, status: "entry_unknown_pending", entryAttemptedAt: "2026-08-15T00:00:00.000Z" }]
  };
  const unknown = settlePlanExecutionOutcome(db, pending.id, { status: "execution_effect_unknown", executionOrder: db.executionOrders[0] });
  assert.equal(unknown.planDisposition, "remote_effect_unresolved");
  assert.equal(unknown.executionSubmitted, null);
  assert.equal(pending.status, "recovery_pending_reconciliation");

  const rejected = plan("approved");
  const failed = settlePlanExecutionOutcome({ tradePlans: [rejected], executionOrders: [] }, rejected.id, { status: "failed", reason: "exchange_rejected" });
  assert.equal(failed.planDisposition, "terminal_rejection");
  assert.equal(rejected.status, "failed");
});

test("approval response distinguishes granted approval from an unsubmitted execution", async () => {
  const target = plan();
  const db = { riskChecks: [], tradePlans: [target] };
  const result = await approveTradePlan(db, target, {
    evaluateTradePlan: () => ({ id: "fresh", passed: true }),
    executeApprovedPlan: async () => ({ status: "risk_recheck_failed", planDisposition: "no_remote_effect", executionSubmitted: false }),
    nowIso: () => "2026-08-15T00:01:00.000Z"
  }, { actor: "owner" });
  assert.equal(result.ok, false);
  assert.equal(result.approvalGranted, true);
  assert.equal(result.executionSubmitted, false);
  assert.equal(result.status, 409);
});
