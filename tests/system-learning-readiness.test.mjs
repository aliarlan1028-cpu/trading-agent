import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSystemLearningSampleReadiness,
  ensureDecisionFactSnapshot
} from "../server/ownerReviewLoop.mjs";
import { financiallyReconciledFills, installSystemTradeProvenance } from "./financial-fixtures.mjs";

function ownerDb() {
  return {
    user: { id: "owner-1", tenantId: "tenant-owner", isOwner: true },
    system: { requestedOperatingMode: "full_auto", ownerReviewProvenanceMigrationVersion: 1 },
    mandates: [{ id: "mandate-1", version: 1, allowedSymbols: ["BTC/USDT"] }],
    strategyVersions: [{ id: "trend@1.0.0", productId: "trend", version: "1.0.0", contentHash: "strategy-hash", immutable: true }],
    decisionFactSnapshots: [], tradePlans: [], executionOrders: [], fills: [], reviews: [],
    memoryItems: [], ownerImprovementItems: [], strategyExperiments: [], riskChecks: [],
    riskIncidents: [], missedOpportunities: [], auditLogs: [], traces: []
  };
}

function addLearningLifecycle(db, suffix, options = {}) {
  const tenantId = options.tenantId || "tenant-owner";
  const ownerUserId = options.ownerUserId || "owner-1";
  const planId = `plan-${suffix}`;
  const executionOrderId = `exec-${suffix}`;
  const closeAt = options.closeAt || "2026-08-20T01:00:00.000Z";
  const strategyRef = options.legacy ? {
    classification: "legacy_pre_product_layer",
    bindingError: "created_before_strategy_product_versioning"
  } : {
    classification: "strategy_product",
    productId: "trend",
    version: "1.0.0",
    versionId: "trend@1.0.0",
    contentHash: "strategy-hash",
    scenarioType: "trend_pullback",
    instanceHash: `instance-${suffix}`
  };
  const plan = {
    id: planId,
    tenantId,
    ownerUserId,
    mandateId: "mandate-1",
    exchange: "OKX",
    accountId: "account-a",
    environment: "production",
    symbol: "BTC/USDT",
    direction: "long",
    timeframe: "1h",
    strategyProductId: "trend",
    strategyVersionId: options.legacy ? null : "trend@1.0.0",
    strategyRef,
    decisionContext: {
      setupType: "trend_pullback",
      supportingFactors: ["trend"],
      conflictingFactors: [],
      deterministicSetupSnapshot: { marketRegime: { label: "uptrend" } }
    },
    entry: 100,
    stopLoss: 95,
    takeProfit: [110],
    rationale: "趋势保持且回踩确认完成，风险收益与入场条件均满足。",
    createdAt: "2026-08-20T00:00:00.000Z"
  };
  db.tradePlans.push(plan);
  if (!options.legacy) ensureDecisionFactSnapshot(db, plan, {
    capturedAt: "2026-08-19T23:59:59.000Z",
    capturedBeforeExecution: true,
    captureMode: "agent_decision_pre_approval"
  });
  const execution = {
    id: executionOrderId,
    planId,
    tenantId,
    ownerUserId,
    exchange: "OKX",
    accountId: "account-a",
    environment: "production",
    apiKeyFingerprint: "fingerprint-a",
    symbol: "BTC/USDT",
    direction: "long",
    strategyRef,
    status: "closed",
    closeSettlementEvidence: options.settlementMissing ? null : {
      schemaVersion: 1,
      snapshotId: `snapshot-${suffix}`,
      observedAt: "2026-08-20T01:00:01.000Z",
      exchange: "OKX",
      accountId: "account-a",
      environment: "production",
      apiKeyFingerprint: "fingerprint-a",
      positionConfirmedAbsent: true
    }
  };
  db.executionOrders.push(execution);
  db.fills.push(
    {
      id: `entry-${suffix}`, kind: "entry", executionOrderId, tradePlanId: planId,
      tenantId, ownerUserId, exchange: "OKX", accountId: "account-a",
      environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 0.01,
      exchangeOrderId: `entry-order-${suffix}`, exchangeTradeId: `entry-trade-${suffix}`,
      strategyRef, createdAt: "2026-08-20T00:00:00.000Z"
    },
    {
      id: `close-${suffix}`, kind: "close", executionOrderId, tradePlanId: planId,
      tenantId, ownerUserId, exchange: "OKX", accountId: "account-a",
      environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 0.01,
      exchangeOrderId: `close-order-${suffix}`, exchangeTradeId: `close-trade-${suffix}`,
      strategyRef, realizedPnl: 1, createdAt: closeAt,
      tradeAttribution: options.manualExit ? {
        schemaVersion: 1, scope: "system", origin: "external_exchange", exitMode: "manual_exit",
        executionOrderId, planId, method: "deterministic_manual_exit",
        evidence: { accountId: "account-a", environment: "production", exchangeTradeId: `close-trade-${suffix}`, attributedQuantity: 0.01 }
      } : undefined
    }
  );
  db.fills = financiallyReconciledFills(db.fills);
  installSystemTradeProvenance(db);
  const review = {
    id: `review-${suffix}`,
    type: "trade",
    status: "completed",
    tenantId,
    ownerUserId,
    tradeLifecycleKey: executionOrderId,
    executionOrderId,
    tradePlanId: planId,
    fillIds: [`close-${suffix}`],
    symbol: "BTC/USDT",
    direction: "long",
    structuredAssessment: { financial: { complete: true, netRealizedPnl: 1 } }
  };
  db.reviews.push(review);
  return { plan, execution, review };
}

test("learning readiness admits only fully evidenced system lifecycles and keeps manual exits", () => {
  const db = ownerDb();
  addLearningLifecycle(db, "qualified", { manualExit: true });
  addLearningLifecycle(db, "legacy", { legacy: true });
  db.fills.push({
    id: "manual-close", kind: "close", positionId: "manual-position", symbol: "ETH/USDT",
    tenantId: "tenant-owner", ownerUserId: "owner-1",
    direction: "long", quantity: 1, realizedPnl: 50, feeUsdt: 0, fundingFeeUsdt: 0,
    fundingReconciled: true, createdAt: "2026-08-20T02:00:00.000Z"
  });

  const report = buildSystemLearningSampleReadiness(db);

  assert.equal(report.funnel.rawCloseFills, 3);
  assert.equal(report.funnel.manualCloseFills, 1);
  assert.equal(report.funnel.systemClosedLifecycles, 2);
  assert.equal(report.funnel.eligibleLearningSamples, 1);
  assert.equal(report.funnel.manualExitSystemSamples, 1);
  assert.equal(report.exclusionReasons.strategy_version_unpinned, 1);
  assert.equal(report.cohorts[0].key, "trend@1.0.0|BTC/USDT|1h|uptrend|trend_pullback|long");
  assert.equal(report.cohorts[0].maturity, "collecting");
  assert.equal(report.policy.manualTradesExcluded, true);
  assert.equal(report.policy.systemTradesManuallyClosedIncluded, true);
  assert.equal(report.policy.automaticStrategyMutation, false);
  assert.equal(report.policy.ownerApprovalRequired, true);
});

test("missing post-close authority keeps an otherwise complete system sample out", () => {
  const db = ownerDb();
  addLearningLifecycle(db, "missing-settlement", { settlementMissing: true });

  const report = buildSystemLearningSampleReadiness(db);
  assert.equal(report.funnel.eligibleLearningSamples, 0);
  assert.equal(report.exclusionReasons.post_close_snapshot_missing, 1);
});

test("stale or differently bound post-close authority cannot qualify a learning sample", () => {
  const staleDb = ownerDb();
  const { execution: staleExecution } = addLearningLifecycle(staleDb, "stale-settlement");
  staleExecution.closeSettlementEvidence.observedAt = "2026-08-20T00:59:59.000Z";
  let report = buildSystemLearningSampleReadiness(staleDb);
  assert.equal(report.funnel.eligibleLearningSamples, 0);
  assert.equal(report.exclusionReasons.post_close_snapshot_invalid, 1);

  const mismatchedDb = ownerDb();
  const { execution: mismatchedExecution } = addLearningLifecycle(mismatchedDb, "mismatched-settlement");
  mismatchedExecution.closeSettlementEvidence.accountId = "other-account";
  report = buildSystemLearningSampleReadiness(mismatchedDb);
  assert.equal(report.funnel.eligibleLearningSamples, 0);
  assert.equal(report.exclusionReasons.post_close_snapshot_binding_mismatch, 1);
});

test("a stale draft review cannot shadow a later complete review for the same lifecycle", () => {
  const db = ownerDb();
  const { review } = addLearningLifecycle(db, "review-order");
  db.reviews.unshift({
    ...structuredClone(review),
    id: "draft-review-order",
    status: "draft",
    structuredAssessment: null
  });

  const report = buildSystemLearningSampleReadiness(db);
  assert.equal(report.funnel.eligibleLearningSamples, 1);
  assert.equal(report.exclusionReasons.completed_review_missing, undefined);
});

test("Owner learning readiness never aggregates a fully evidenced foreign lifecycle", () => {
  const db = ownerDb();
  addLearningLifecycle(db, "owner");
  addLearningLifecycle(db, "foreign", { tenantId: "tenant-foreign", ownerUserId: "user-foreign" });

  const report = buildSystemLearningSampleReadiness(db);
  assert.equal(report.funnel.rawCloseFills, 1);
  assert.equal(report.funnel.systemClosedLifecycles, 1);
  assert.equal(report.funnel.eligibleLearningSamples, 1);
  assert.equal(report.cohorts[0].samples, 1);
  assert.equal(report.policy.crossUserAggregation, false);
});

test("sample maturity is cohort-specific and never authorizes automatic live mutation", () => {
  const db = ownerDb();
  for (let index = 0; index < 30; index += 1) addLearningLifecycle(db, `cohort-${index}`);

  const report = buildSystemLearningSampleReadiness(db);
  assert.equal(report.cohorts.length, 1);
  assert.equal(report.cohorts[0].samples, 30);
  assert.equal(report.cohorts[0].maturity, "preliminary");
  assert.deepEqual(report.thresholds, { probation: 10, preliminary: 30, meaningful: 50, mature: 100 });
  assert.equal(report.cohorts[0].eligibleForAutomaticPromotion, false);
});
