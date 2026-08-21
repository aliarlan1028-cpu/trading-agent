import assert from "node:assert/strict";
import test from "node:test";
import * as lifecycle from "../server/tradeLifecycle.mjs";
import {
  groupClosedTradeLifecycles as compatibilityGroup,
  sameTradeLifecycle as compatibilitySame
} from "../server/tradeReviewQueue.mjs";

test("tradeReviewQueue compatibility exports share the leaf implementation", () => {
  assert.equal(compatibilityGroup, lifecycle.groupClosedTradeLifecycles);
  assert.equal(compatibilitySame, lifecycle.sameTradeLifecycle);
});

test("leaf lifecycle aggregation preserves partial-close net financial semantics", () => {
  const rows = [
    { id: "entry", kind: "entry", executionOrderId: "exec-1", feeUsdt: 1, estimatedFee: false, createdAt: "2026-08-01T00:00:00Z" },
    { id: "part", kind: "close", executionOrderId: "exec-1", partial: true, realizedPnl: 4, feeUsdt: .2, estimatedFee: false, fundingFeeUsdt: 0, fundingReconciled: true, createdAt: "2026-08-01T01:00:00Z" },
    { id: "final", kind: "close", executionOrderId: "exec-1", realizedPnl: 6, feeUsdt: .3, estimatedFee: false, fundingFeeUsdt: -.5, fundingReconciled: true, createdAt: "2026-08-01T02:00:00Z" }
  ];
  const [group] = lifecycle.groupClosedTradeLifecycles(rows);
  assert.deepEqual({ key: group.key, gross: group.realizedPnl, entryFee: group.entryFeeUsdt, closeFee: group.feeUsdt, funding: group.fundingFeeUsdt, net: group.netRealizedPnl },
    { key: "exec-1", gross: 10, entryFee: 1, closeFee: .5, funding: -.5, net: 8 });
});
