function validDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function addCalendarMonthsIso(baseAt, months = 0, fallbackDays = 0) {
  const date = validDate(baseAt) || new Date();
  if (months) {
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + Number(months));
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(originalDay, lastDay));
  }
  if (fallbackDays) date.setUTCDate(date.getUTCDate() + Number(fallbackDays));
  return date.toISOString();
}

export function extendSubscriptionTerm(db, input = {}, options = {}) {
  db.subscriptions ||= [];
  db.subscriptionTerms ||= [];
  const now = validDate(options.now || input.now || new Date()) || new Date();
  const paymentId = input.paymentId || null;
  if (paymentId) {
    const consumed = db.subscriptionTerms.find((term) => term.paymentId === paymentId);
    if (consumed) {
      return {
        subscription: db.subscriptions.find((item) => item.id === consumed.subscriptionId) || null,
        term: consumed,
        replay: true
      };
    }
  }
  const months = Math.max(0, Number(input.months || 0));
  const fallbackDays = Math.max(0, Number(input.fallbackDays || 0));
  if (!months && !fallbackDays) throw new Error("subscription_term_duration_required");
  let subscription = db.subscriptions.find((item) => item.tenantId === input.tenantId);
  const previousEnd = validDate(subscription?.currentPeriodEnd);
  if (subscription?.planId && subscription.planId !== input.planId && previousEnd?.getTime() > now.getTime() && input.allowPlanChange !== true) {
    throw Object.assign(new Error("subscription_plan_change_requires_proration"), { status: 409 });
  }
  const base = previousEnd && previousEnd.getTime() > now.getTime() ? previousEnd : now;
  const nextEnd = addCalendarMonthsIso(base, months, fallbackDays);
  const idFactory = options.id || ((prefix) => `${prefix}_${Math.random().toString(36).slice(2)}`);
  if (!subscription) {
    subscription = {
      id: idFactory("sub"),
      tenantId: input.tenantId,
      userId: input.userId || null,
      startedAt: now.toISOString()
    };
    db.subscriptions.unshift(subscription);
  }
  Object.assign(subscription, {
    userId: input.userId || subscription.userId || null,
    planId: input.planId,
    status: "active",
    source: input.source,
    paymentId: paymentId || subscription.paymentId || null,
    currentPeriodEnd: nextEnd,
    updatedAt: now.toISOString()
  });
  // startedAt is the beginning of the subscription relationship, not the most recent renewal.
  subscription.startedAt ||= now.toISOString();
  if (input.grantedBy) subscription.grantedBy = input.grantedBy;

  const term = {
    id: idFactory("subterm"),
    subscriptionId: subscription.id,
    tenantId: input.tenantId,
    userId: input.userId || null,
    planId: input.planId,
    source: input.source,
    paymentId,
    months,
    fallbackDays,
    baseAt: base.toISOString(),
    previousPeriodEnd: previousEnd?.toISOString() || null,
    periodEnd: nextEnd,
    createdAt: now.toISOString()
  };
  db.subscriptionTerms.unshift(term);
  const tenant = (db.tenants || []).find((item) => item.id === input.tenantId);
  if (tenant) Object.assign(tenant, { planId: input.planId, status: "active", updatedAt: now.toISOString() });
  return { subscription, term, replay: false };
}
