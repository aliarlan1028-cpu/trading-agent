import assert from "node:assert/strict";
import test from "node:test";
import { deriveReduceOnlyReasons, effectiveRiskStatus, syncReduceOnlyState } from "../server/reduceOnlyState.mjs";

function baseDb() {
  return {
    system: { reduceOnlyReasonsSchemaVersion: 3, reduceOnlyReasonRecords: {} },
    portfolio: { pendingFinancialReconciliationToday: 0, pendingFinancialReconciliationWeek: 0 },
    reviews: [],
    executionOrders: [],
    armedSetups: [],
    orders: []
  };
}

test("an old pending trade review does not permanently force reduce-only", () => {
  const db = baseDb();
  db.reviews.push({ id: "old-review", status: "pending_financial_reconciliation", createdAt: "2025-01-01T00:00:00.000Z" });
  assert.equal(deriveReduceOnlyReasons(db).includes("financial_reconciliation_pending"), false);
});

test("an accounting gap in either active risk window remains fail-closed", () => {
  const daily = baseDb();
  daily.portfolio.pendingFinancialReconciliationToday = 1;
  assert.equal(deriveReduceOnlyReasons(daily).includes("financial_reconciliation_pending"), true);

  const weekly = baseDb();
  weekly.portfolio.pendingFinancialReconciliationWeek = 1;
  assert.equal(deriveReduceOnlyReasons(weekly).includes("financial_reconciliation_pending"), true);
});

test("effective risk status follows the same safety precedence everywhere", () => {
  assert.equal(effectiveRiskStatus({ killSwitch: true, reduceOnlyMode: true, autonomyEnabled: false }), "熔断停机");
  assert.equal(effectiveRiskStatus({ killSwitch: false, reduceOnlyMode: true, autonomyEnabled: false }), "暂停新开仓");
  assert.equal(effectiveRiskStatus({ killSwitch: false, reduceOnlyMode: false, autonomyEnabled: false }), "运行已暂停");
  assert.equal(effectiveRiskStatus({ killSwitch: false, reduceOnlyMode: false, autonomyEnabled: true }), "正常");
  assert.equal(effectiveRiskStatus({ killSwitch: false, reduceOnlyMode: false, autonomyEnabled: true, riskStatus: "API 权限异常" }), "API 权限异常");
});

test("legacy manual pause is retired without clearing a system-enforced reason", () => {
  const db = baseDb();
  db.system.reduceOnlyReasonsSchemaVersion = 2;
  db.system.autonomyEnabled = true;
  db.system.manualReduceOnly = true;
  db.system.reduceOnlyReasonRecords["manual_reduce_only:global"] = {
    code: "manual_reduce_only", openedAt: "2026-01-01T00:00:00.000Z", resolvedAt: null
  };
  db.portfolio.pendingFinancialReconciliationToday = 1;
  const result = syncReduceOnlyState(db);
  assert.equal(result.reduceOnlyMode, true);
  assert.deepEqual(result.reasons, ["financial_reconciliation_pending"]);
  assert.equal(db.system.riskStatus, "暂停新开仓");
  assert.equal(db.system.openingPaused, true);
  assert.equal(db.system.manualReduceOnly, undefined);
  assert.ok(db.system.reduceOnlyReasonRecords["manual_reduce_only:global"].resolvedAt);
  assert.equal(db.system.reduceOnlyReasonsSchemaVersion, 3);
});
