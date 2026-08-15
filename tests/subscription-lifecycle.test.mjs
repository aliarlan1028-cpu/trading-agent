import assert from "node:assert/strict";
import test from "node:test";

import { addCalendarMonthsIso, extendSubscriptionTerm } from "../server/subscriptionLifecycle.mjs";

const ids = (() => { let value = 0; return (prefix) => `${prefix}_${++value}`; })();

test("early renewal extends from the existing end and preserves startedAt", () => {
  const db = {
    subscriptions: [{
      id: "sub_1", tenantId: "tenant_1", userId: "user_1", planId: "annual",
      status: "active", startedAt: "2026-02-15T00:00:00.000Z", currentPeriodEnd: "2027-02-15T00:00:00.000Z"
    }],
    tenants: [{ id: "tenant_1" }]
  };
  const result = extendSubscriptionTerm(db, {
    tenantId: "tenant_1", userId: "user_1", planId: "annual", source: "trc20_usdt", paymentId: "pay_1", months: 12
  }, { id: ids, now: "2026-08-15T00:00:00.000Z" });
  assert.equal(result.subscription.currentPeriodEnd, "2028-02-15T00:00:00.000Z");
  assert.equal(result.subscription.startedAt, "2026-02-15T00:00:00.000Z");
  assert.equal(result.term.baseAt, "2027-02-15T00:00:00.000Z");
});

test("expired subscription renews from now and a repeated payment is idempotent", () => {
  const db = { subscriptions: [{ id: "sub_2", tenantId: "tenant_2", startedAt: "2025-01-01T00:00:00.000Z", currentPeriodEnd: "2026-01-01T00:00:00.000Z" }] };
  const input = { tenantId: "tenant_2", userId: "user_2", planId: "monthly", source: "trc20_usdt", paymentId: "pay_2", months: 1 };
  const first = extendSubscriptionTerm(db, input, { id: ids, now: "2026-08-15T00:00:00.000Z" });
  const end = first.subscription.currentPeriodEnd;
  const replay = extendSubscriptionTerm(db, input, { id: ids, now: "2026-08-16T00:00:00.000Z" });
  assert.equal(end, "2026-09-15T00:00:00.000Z");
  assert.equal(replay.replay, true);
  assert.equal(replay.subscription.currentPeriodEnd, end);
  assert.equal(db.subscriptionTerms.length, 1);
});

test("calendar month addition clamps leap-day and month-end dates instead of rolling into the next month", () => {
  assert.equal(addCalendarMonthsIso("2024-02-29T12:00:00.000Z", 12), "2025-02-28T12:00:00.000Z");
  assert.equal(addCalendarMonthsIso("2026-01-31T12:00:00.000Z", 1), "2026-02-28T12:00:00.000Z");
});

test("an active subscription cannot silently switch plans without an explicit proration policy", () => {
  const db = { subscriptions: [{ id: "sub_3", tenantId: "tenant_3", planId: "monthly", currentPeriodEnd: "2027-01-01T00:00:00.000Z" }] };
  assert.throws(() => extendSubscriptionTerm(db, {
    tenantId: "tenant_3", userId: "user_3", planId: "annual", source: "trc20_usdt", paymentId: "pay_3", months: 12
  }, { id: ids, now: "2026-08-15T00:00:00.000Z" }), /subscription_plan_change_requires_proration/);
  assert.equal(db.subscriptions[0].planId, "monthly");
  assert.equal(db.subscriptionTerms.length, 0);
});
