import assert from "node:assert/strict";
import test from "node:test";
import { deriveReduceOnlyReasons } from "../server/reduceOnlyState.mjs";

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
