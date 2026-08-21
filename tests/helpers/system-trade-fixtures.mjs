export function addSystemExecution(db, options = {}) {
  const executionOrder = {
    id: options.executionOrderId || "exec-1",
    planId: options.planId || "plan-1",
    exchange: "OKX",
    accountId: options.accountId || "account-a",
    environment: options.environment || "production",
    symbol: options.symbol || "BTC/USDT",
    direction: options.direction || "long",
    status: options.status || "closed",
    filledQuantity: options.quantity || .01,
    entryFilledAt: options.entryFilledAt || "2026-08-01T00:00:00.000Z"
  };
  db.executionOrders ||= [];
  db.tradePlans ||= [];
  db.executionOrders.push(executionOrder);
  db.tradePlans.push({ id: executionOrder.planId, symbol: executionOrder.symbol, direction: executionOrder.direction });
  return executionOrder;
}

export function stampFixtureSystemAttribution(fill, executionOrder) {
  fill.executionOrderId = executionOrder.id;
  fill.planId = executionOrder.planId;
  fill.tradePlanId = executionOrder.planId;
  fill.tradeAttribution = {
    schemaVersion: 1,
    scope: "system",
    origin: "execution_engine",
    exitMode: fill.kind === "close" ? "system_exit" : null,
    executionOrderId: executionOrder.id,
    planId: executionOrder.planId,
    method: "execution_writer",
    reason: null,
    evidence: { accountId: executionOrder.accountId, environment: executionOrder.environment, exchangeOrderId: fill.exchangeOrderId || null, exchangeTradeId: fill.exchangeTradeId || null, matchedEntryFillIds: [], attributedQuantity: Number(fill.quantity || 0) || null },
    attributedAt: fill.createdAt || "2026-08-01T00:00:00.000Z"
  };
  return fill;
}
