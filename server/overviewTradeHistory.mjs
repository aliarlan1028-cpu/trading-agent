import { groupSystemClosedTradeLifecycles, systemTradeFills } from "./systemTradeProjection.mjs";

// This is the stable overview lifecycle row consumed by desktop, native, and
// review matching. Keep a previously compact row intact so view projections do
// not compact the same lifecycle twice.
export function compactClosedTradeLifecycle(lifecycle = {}) {
  if (lifecycle.tradeLifecycleKey) return lifecycle;
  const row = lifecycle.representative || {};
  return {
    ...row,
    id: `closed:${lifecycle.key}`,
    tradeLifecycleKey: lifecycle.key,
    fillIds: (lifecycle.fills || []).map((fill) => fill.id).filter(Boolean),
    closeCount: (lifecycle.fills || []).length,
    quantity: Number(lifecycle.quantity || row.quantity || 0),
    notionalUsdt: Number(lifecycle.notionalUsdt || row.notionalUsdt || 0),
    realizedPnl: Number(lifecycle.realizedPnl || 0),
    feeUsdt: Number(lifecycle.feeUsdt || 0),
    entryFeeUsdt: Number(lifecycle.entryFeeUsdt || 0),
    fundingFeeUsdt: Number(lifecycle.fundingFeeUsdt || 0),
    netRealizedPnl: lifecycle.netRealizedPnl == null ? null : Number(lifecycle.netRealizedPnl),
    financialBasisComplete: lifecycle.financialBasisComplete === true,
    financialBasis: lifecycle.financialBasis || null,
    createdAt: lifecycle.lastClosedAt || row.createdAt
  };
}

// Each authenticated overview source receives a scoped database. Project its
// system-trade history once here, before the route applies section/native bounds.
export function projectSystemOverviewTradeHistory(scopedDb = {}) {
  const fills = systemTradeFills(scopedDb);
  return {
    fills,
    closedTradeLifecycles: groupSystemClosedTradeLifecycles(scopedDb, { fills }).map(compactClosedTradeLifecycle)
  };
}
