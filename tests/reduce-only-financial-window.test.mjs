import assert from "node:assert/strict";
import test from "node:test";
import { deriveReduceOnlyReasons, effectiveRiskStatus, syncReduceOnlyState } from "../server/reduceOnlyState.mjs";

function baseDb() {
  return {
    system: { reduceOnlyReasonsSchemaVersion: 2, reduceOnlyReasonRecords: {} },
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
  assert.equal(effectiveRiskStatus({ killSwitch: false, reduceOnlyMode: true, autonomyEnabled: false }), "只减仓");
  assert.equal(effectiveRiskStatus({ killSwitch: false, reduceOnlyMode: false, autonomyEnabled: false }), "人工暂停");
  assert.equal(effectiveRiskStatus({ killSwitch: false, reduceOnlyMode: false, autonomyEnabled: true }), "正常");
  assert.equal(effectiveRiskStatus({ killSwitch: false, reduceOnlyMode: false, autonomyEnabled: true, riskStatus: "API 权限异常" }), "API 权限异常");
});

test("clearing manual reduce-only cannot clear a system-enforced reason", () => {
  const db = baseDb();
  db.system.autonomyEnabled = true;
  db.system.manualReduceOnly = true;
  db.portfolio.pendingFinancialReconciliationToday = 1;
  syncReduceOnlyState(db);
  assert.equal(db.system.reduceOnlyMode, true);
  db.system.manualReduceOnly = false;
  const result = syncReduceOnlyState(db);
  assert.equal(result.reduceOnlyMode, true);
  assert.deepEqual(result.reasons, ["financial_reconciliation_pending"]);
  assert.equal(db.system.riskStatus, "只减仓");
});
