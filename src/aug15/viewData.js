export * from "../viewData.js";

// Current finance truth accepts server-aggregated lifecycles only. The August
// 15 presenter keeps its import contract, but never rebuilds PnL from a bounded
// browser fill slice when authoritative lifecycle data is absent.
export function groupClosedTradeLifecyclesForView() {
  return [];
}
