import assert from "node:assert/strict";
import test from "node:test";
import { applyDerivedProfitGoals, daysInShanghaiMonth, deriveMonthlyGoalUsdt } from "../server/profitGoals.mjs";

test("月目标按北京时间自然月天数派生并正确处理闰年", () => {
  assert.equal(daysInShanghaiMonth("2028-02-15T00:00:00.000Z"), 29);
  assert.equal(deriveMonthlyGoalUsdt(100, "2028-02-15T00:00:00.000Z"), 2900);
  assert.equal(deriveMonthlyGoalUsdt(100, "2027-02-15T00:00:00.000Z"), 2800);
  assert.equal(deriveMonthlyGoalUsdt(null, "2027-02-15T00:00:00.000Z"), null);
});

test("跨月重算会覆盖旧月手工残留值", () => {
  const system = { dailyGoalUsdt: 12.5, monthlyGoalUsdt: 999 };
  applyDerivedProfitGoals(system, "2026-09-01T00:00:00.000Z");
  assert.equal(system.monthlyGoalUsdt, 375);
  assert.equal(system.monthlyGoalDays, 30);
  assert.equal(system.monthlyGoalPeriod, "2026-09");
});
