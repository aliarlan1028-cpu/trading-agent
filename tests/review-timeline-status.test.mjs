import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewTimelineStatus } from "../src/reviewTimelineStatus.js";

test("review timeline leaves every unsupported lifecycle fact pending", () => {
  const rows = buildReviewTimelineStatus({ review: { id: "review-only", status: "completed" }, completed: true });
  assert.deepEqual(rows.map((row) => row.verified), [false, false, false, false, false, false]);
});

test("review timeline verifies each stage only from matching persisted evidence", () => {
  const review = {
    id: "review-1", status: "completed", executionOrderId: "order-1", tradePlanId: "plan-1",
    fillIds: ["entry-1", "close-1"], entryFeeUsdt: 0.01, feeUsdt: 0.02,
    fundingFeeUsdt: 0, netRealizedPnl: 1.2
  };
  const rows = buildReviewTimelineStatus({
    review,
    plan: { id: "plan-1", decisionFactSnapshotRef: { id: "snapshot-1", hash: "sha256:fact" } },
    order: { id: "order-1", protectionVerifiedAt: "2026-08-19T00:00:00.000Z" },
    fills: [
      { id: "entry-1", kind: "entry", executionOrderId: "order-1" },
      { id: "close-1", kind: "close", executionOrderId: "order-1" },
      { id: "foreign", kind: "close", executionOrderId: "other" }
    ],
    completed: true
  });
  assert.deepEqual(rows.map((row) => row.verified), [true, true, true, true, true, true]);
});

test("review timeline does not use an unrelated fill or unverified protection", () => {
  const rows = buildReviewTimelineStatus({
    review: { executionOrderId: "order-1", tradePlanId: "plan-1", fillIds: ["entry-1"] },
    plan: { id: "plan-1", decisionFactSnapshotRef: { id: "snapshot-1", hash: "hash-1" } },
    order: { id: "order-1" },
    fills: [
      { id: "entry-1", kind: "entry", executionOrderId: "order-1" },
      { id: "foreign-close", kind: "close", executionOrderId: "other" }
    ]
  });
  assert.deepEqual(rows.map((row) => row.verified), [true, true, false, false, false, false]);
});

test("review lifecycle key matches the production fill execution order key", () => {
  const rows = buildReviewTimelineStatus({
    review: { tradeLifecycleKey: "life-0", fillIds: [] },
    fills: [
      { id: "entry-life-0", kind: "entry", executionOrderId: "life-0" },
      { id: "close-life-0", kind: "close", executionOrderId: "life-0" }
    ]
  });
  assert.equal(rows[2].verified, true);
});

test("authoritative trade costs survive explicit null compatibility fields on review", () => {
  const costs = { entryFeeUsdt: 0.01, feeUsdt: 0.02, fundingFeeUsdt: 0, netRealizedPnl: 1.5 };
  const fromTrade = buildReviewTimelineStatus({
    review: { entryFeeUsdt: null, feeUsdt: null, fundingFeeUsdt: null, netRealizedPnl: null },
    trade: costs
  });
  assert.equal(fromTrade[4].verified, true);

  const fromReview = buildReviewTimelineStatus({ review: costs });
  assert.equal(fromReview[4].verified, true);
});
