import assert from "node:assert/strict";
import test from "node:test";

import { performanceReport } from "../server/accounting.mjs";
import { computeBehaviorProfile } from "../server/behaviorProfile.mjs";
import { backfillStructuredTradeReviews } from "../server/ownerReviewLoop.mjs";
import { runTradeReflection } from "../server/reviewEngine.mjs";
import { groupSystemClosedTradeLifecycles } from "../server/systemTradeProjection.mjs";
import { consecutiveLossCooldown, drawdownLockout } from "../server/tradeProtections.mjs";
import { syncTradeReviewQueue } from "../server/tradeReviewQueue.mjs";

function reconciledLeg(fill) {
  return {
    feeUsdt: 0,
    feeSchemaVersion: 2,
    feeSource: "fixture_exchange_fill",
    estimatedFee: false,
    ...(fill.kind === "close" ? { fundingFeeUsdt: 0, fundingReconciled: true } : {}),
    ...fill
  };
}

function manualLifecycle(id, closedAt) {
  return [
    reconciledLeg({ id: `${id}-entry`, kind: "entry", positionId: id, symbol: "BTC/USDT", direction: "long", quantity: 1, createdAt: new Date(closedAt - 60_000).toISOString() }),
    reconciledLeg({ id: `${id}-close`, kind: "close", positionId: id, symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -10, createdAt: new Date(closedAt).toISOString() })
  ];
}

test("performance, review, and protections exclude manual losses while retaining one attributed manual exit", () => {
  const now = Date.now();
  const execution = {
    id: "system-exec", planId: "system-plan", exchange: "OKX", accountId: "account-a",
    environment: "production", symbol: "BTC/USDT", direction: "long", status: "closed"
  };
  const attributed = (fill, exitMode = null) => reconciledLeg({
    ...fill,
    executionOrderId: execution.id,
    planId: execution.planId,
    tradePlanId: execution.planId,
    tradeAttribution: {
      schemaVersion: 1,
      scope: "system",
      origin: exitMode ? "external_exchange" : "execution_engine",
      exitMode,
      executionOrderId: execution.id,
      planId: execution.planId,
      method: exitMode ? "deterministic_manual_exit" : "execution_writer",
      reason: null,
      evidence: { accountId: "account-a", environment: "production", exchangeOrderId: null, exchangeTradeId: null, matchedEntryFillIds: [], attributedQuantity: 1 },
      attributedAt: fill.createdAt
    }
  });
  const db = {
    portfolio: { totalEquityUsdt: 100 },
    executionOrders: [execution],
    tradePlans: [{ id: execution.planId, symbol: execution.symbol, direction: execution.direction }],
    reviews: [],
    fills: [
      attributed({ id: "system-entry", kind: "entry", symbol: "BTC/USDT", direction: "long", quantity: 1, createdAt: new Date(now - 4 * 3_600_000 - 60_000).toISOString() }),
      attributed({ id: "system-manual-exit", kind: "close", symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -10, createdAt: new Date(now - 4 * 3_600_000).toISOString() }, "manual_exit"),
      ...manualLifecycle("manual-1", now - 3 * 3_600_000),
      ...manualLifecycle("manual-2", now - 2 * 3_600_000),
      ...manualLifecycle("manual-3", now - 3_600_000)
    ]
  };

  assert.equal(groupSystemClosedTradeLifecycles(db).length, 1, "the attributed manual exit belongs to exactly one system lifecycle");
  assert.equal(performanceReport(db).trades, 1);
  assert.equal(syncTradeReviewQueue(db).queued, 1);
  assert.equal(db.reviews.length, 1);
  assert.equal(consecutiveLossCooldown(db).streak, 1);
  assert.equal(drawdownLockout(db).active, false);
});

test("reflection persists derived fields only on the raw system manual-exit close and ignores pending attribution", async () => {
  const now = Date.now();
  const entryAt = new Date(now - 2 * 3_600_000).toISOString();
  const closeAt = new Date(now - 3_600_000).toISOString();
  const execution = {
    id: "reflection-exec", planId: "reflection-plan", exchange: "OKX", accountId: "account-a",
    environment: "production", symbol: "BTC/USDT", direction: "long", status: "closed"
  };
  const systemAttribution = (exitMode) => ({
    schemaVersion: 1, scope: "system", origin: "external_exchange", exitMode,
    executionOrderId: execution.id, planId: execution.planId, method: "deterministic_manual_exit", reason: null,
    evidence: { accountId: "account-a", environment: "production", exchangeOrderId: null, exchangeTradeId: null, matchedEntryFillIds: [], attributedQuantity: 1 }, attributedAt: closeAt
  });
  const pendingAttribution = {
    schemaVersion: 1, scope: "attribution_pending", origin: "external_exchange", exitMode: null,
    executionOrderId: "pending-exec", planId: "pending-plan", method: "unresolved", reason: "mixed_position_attribution",
    evidence: { accountId: "account-a", environment: "production", exchangeOrderId: null, exchangeTradeId: "pending-trade", matchedEntryFillIds: [], attributedQuantity: 1 }, attributedAt: closeAt
  };
  const db = {
    user: { id: "owner-1", tenantId: "tenant-owner", isOwner: true },
    system: { ownerReviewProvenanceMigrationVersion: 1 },
    portfolio: { totalEquityUsdt: 100 }, reviews: [], memoryItems: [], auditLogs: [], traces: [],
    executionOrders: [execution, { id: "pending-exec", planId: "pending-plan", symbol: "BTC/USDT", direction: "long", status: "closed" }],
    tradePlans: [{ id: execution.planId, symbol: "BTC/USDT", direction: "long" }, { id: "pending-plan", symbol: "BTC/USDT", direction: "long" }],
    marketIntelligenceFacts: [{
      id: "verified-shock", type: "news", category: "news", affectedSymbols: ["BTC/USDT"], publishedAt: new Date(now - 90 * 60_000).toISOString(),
      verifiedOrigin: true, trustTier: "verified_official", fakeRisk: "low", impactHorizon: "immediate", values: { impact: 90 }
    }],
    fills: [
      reconciledLeg({ id: "reflection-entry", kind: "entry", executionOrderId: execution.id, planId: execution.planId, tradePlanId: execution.planId, accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 1, tenantId: "tenant-owner", ownerUserId: "owner-1", createdAt: entryAt, tradeAttribution: systemAttribution(null) }),
      reconciledLeg({ id: "reflection-close", kind: "close", executionOrderId: execution.id, planId: execution.planId, tradePlanId: execution.planId, accountId: "account-a", environment: "production", symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -10, tenantId: "tenant-owner", ownerUserId: "owner-1", createdAt: closeAt, tradeAttribution: systemAttribution("manual_exit") }),
      reconciledLeg({ id: "pending-entry", kind: "entry", executionOrderId: "pending-exec", planId: "pending-plan", tradePlanId: "pending-plan", symbol: "BTC/USDT", direction: "long", quantity: 1, createdAt: entryAt, tradeAttribution: pendingAttribution }),
      reconciledLeg({ id: "pending-close", kind: "close", executionOrderId: "pending-exec", planId: "pending-plan", tradePlanId: "pending-plan", symbol: "BTC/USDT", direction: "long", quantity: 1, realizedPnl: -50, createdAt: closeAt, tradeAttribution: pendingAttribution })
    ]
  };

  const first = await runTradeReflection(db);
  const rawClose = db.fills.find((fill) => fill.id === "reflection-close");
  const pendingClose = db.fills.find((fill) => fill.id === "pending-close");

  assert.equal(first.reflected, 1);
  assert.ok(rawClose.newsContext);
  assert.ok(rawClose.lossAttribution);
  assert.ok(rawClose.reflectedAt);
  assert.equal(pendingClose.reflectedAt, undefined);
  assert.equal(performanceReport(db).trades, 1);
  assert.equal(db.reviews.length, 1);
  assert.equal(db.memoryItems.length, 1);
  assert.equal(consecutiveLossCooldown(db).streak, 1);
  assert.equal(drawdownLockout(db).active, false);
  assert.equal(computeBehaviorProfile(db).lossAttribution[rawClose.lossAttribution], 1);

  delete db.reviews[0].structuredAssessment;
  assert.equal(backfillStructuredTradeReviews(db).updated, 1);
  assert.ok(db.reviews[0].structuredAssessment.rootCauses.some((root) => root.code === "market_shock"));
  const second = await runTradeReflection(db);
  assert.equal(second.reflected, 0);
  assert.equal(db.memoryItems.length, 1);
});
