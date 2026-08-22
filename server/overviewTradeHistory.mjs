import { groupSystemClosedTradeLifecycles, systemTradeFills } from "./systemTradeProjection.mjs";

// Each authenticated overview source receives a scoped database. Project its
// system-trade history once here, before the route applies section/native bounds.
export function projectSystemOverviewTradeHistory(scopedDb = {}) {
  const fills = systemTradeFills(scopedDb);
  return {
    fills,
    closedTradeLifecycles: groupSystemClosedTradeLifecycles(scopedDb, { fills })
  };
}
