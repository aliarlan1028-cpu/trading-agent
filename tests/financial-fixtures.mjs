function lifecycleKey(fill = {}) {
  return String(fill.executionOrderId || fill.tradePlanId || fill.planId || fill.positionId || fill.id || "");
}

export function reconciledFill(fill = {}) {
  if (fill.kind === "entry") {
    return {
      feeUsdt: 0,
      feeSchemaVersion: 2,
      feeSource: "fixture_exchange_fill",
      estimatedFee: false,
      ...fill
    };
  }
  if (fill.kind === "close") {
    return {
      feeUsdt: 0,
      feeSchemaVersion: 2,
      feeSource: "fixture_exchange_fill",
      estimatedFee: false,
      fundingFeeUsdt: 0,
      fundingReconciled: true,
      ...fill
    };
  }
  return { ...fill };
}

// Tests that exercise performance consumers must explicitly opt into a complete
// financial basis. The helper supplies zero-cost exchange evidence only where the
// scenario does not care about costs, and creates the corresponding entry leg.
export function financiallyReconciledFills(fills = []) {
  const rows = fills.map(reconciledFill);
  const entryKeys = new Set(rows.filter((fill) => fill.kind === "entry").map(lifecycleKey).filter(Boolean));
  const syntheticEntries = [];
  for (const close of rows.filter((fill) => fill.kind === "close")) {
    const key = lifecycleKey(close);
    if (!key || entryKeys.has(key)) continue;
    const closeAt = new Date(close.exchangeFilledAt || close.createdAt || close.closedAt || 0).getTime();
    syntheticEntries.push(reconciledFill({
      id: `fixture-entry-${key}`,
      kind: "entry",
      executionOrderId: close.executionOrderId,
      tradePlanId: close.tradePlanId || close.planId,
      planId: close.planId,
      positionId: close.positionId,
      symbol: close.symbol,
      direction: close.direction,
      tenantId: close.tenantId,
      ownerUserId: close.ownerUserId,
      userId: close.userId,
      createdAt: Number.isFinite(closeAt) ? new Date(closeAt - 1).toISOString() : "2000-01-01T00:00:00.000Z"
    }));
    entryKeys.add(key);
  }
  return [...syntheticEntries, ...rows];
}

// Performance/review/protection scenarios opt into system ownership separately
// from financial completeness. This supplies persisted execution and plan facts;
// it deliberately does not write tradeAttribution onto arbitrary fixture fills.
export function installSystemTradeProvenance(db, fills = db.fills || []) {
  db.executionOrders ||= [];
  db.tradePlans ||= [];
  const executions = new Map(db.executionOrders.map((row) => [String(row.id || ""), row]));
  const plans = new Map(db.tradePlans.map((row) => [String(row.id || ""), row]));
  for (const fill of fills) {
    const executionOrderId = fill?.executionOrderId;
    if (executionOrderId === null || executionOrderId === undefined || executionOrderId === "") continue;
    const id = String(executionOrderId);
    const planId = String(fill.tradePlanId || fill.planId || `fixture-plan-${id}`);
    let execution = executions.get(id);
    if (!execution) {
      execution = {
        id,
        planId,
        exchange: fill.exchange || "OKX",
        accountId: fill.accountId || "fixture-account",
        environment: fill.environment || "production",
        symbol: fill.symbol || "BTC/USDT",
        direction: fill.direction || "long",
        status: "closed"
      };
      db.executionOrders.push(execution);
      executions.set(id, execution);
    }
    if (!plans.has(planId)) {
      const plan = {
        id: planId,
        exchange: execution.exchange,
        accountId: execution.accountId,
        environment: execution.environment,
        symbol: execution.symbol,
        direction: execution.direction
      };
      db.tradePlans.push(plan);
      plans.set(planId, plan);
    }
  }
  return db;
}
