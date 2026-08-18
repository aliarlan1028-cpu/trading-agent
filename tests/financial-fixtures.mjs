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
