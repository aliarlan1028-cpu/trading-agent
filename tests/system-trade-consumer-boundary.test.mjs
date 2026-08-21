import assert from "node:assert/strict";
import test from "node:test";

import { performanceReport } from "../server/accounting.mjs";
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
