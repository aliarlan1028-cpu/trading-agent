import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizePositionsForUi } from "../server/positionView.mjs";
import AccountDomain from "../src/kordynV2/domains/account/index.jsx";
import { createV2Selection } from "../src/kordynV2/viewModels/selection.js";

const asOf = new Date().toISOString();
const openedAt = new Date(Date.parse(asOf) - 60_000).toISOString();
const rawPositionMirrors = Object.freeze([
  Object.freeze({
    positionId: "position-1", symbol: "ETH/USDT", instId: "ETH-USDT-SWAP", direction: "long",
    source: "execution_engine", quantity: 2.4, entry: 3420.5, mark: 3468.2,
    liquidationPrice: 1980, unrealizedPnl: 114.48, notional: 8323.68, margin: 2774.56,
    leverage: 3, liqDistancePct: 42.6, stopLossPrice: 3365, takeProfits: Object.freeze([3515, 3590]),
    executionOrderId: "execution-1", openedAt
  }),
  Object.freeze({
    id: "exchange-position-1", positionId: "exchange-position-1", symbol: "ETH/USDT", instId: "ETH-USDT-SWAP",
    source: "exchange_rest", direction: "long", posSide: "long", coinSize: 2.4, mark: 3468.2,
    entry: 3420.5, liqPx: 1980, leverage: 3, pnl: 114.48, accountId: "ex-okx-main",
    exchange: "OKX", rawSyncedAt: asOf
  })
]);
const normalizedPositions = Object.freeze(normalizePositionsForUi(rawPositionMirrors).map((position) => Object.freeze(position)));
const data = Object.freeze({
  resourceState: Object.freeze({ cockpit: "loaded" }),
  source: "OKX",
  asOf,
  portfolio: Object.freeze({ totalEquityUsdt: 12000, availableMarginUsdt: 8600, marginSyncedAt: asOf }),
  positions: normalizedPositions,
  markets: Object.freeze([Object.freeze({ symbol: "BTC/USDT", price: 68230, changePct: -0.4, high24h: 69000, low24h: 67100, updatedAt: asOf, source: "OKX" })]),
  watchlist: Object.freeze([]),
  exchangeAccounts: Object.freeze([Object.freeze({ id: "ex-okx-main", exchange: "OKX", label: "OKX 统一账户", status: "configured", updatedAt: asOf })]),
  accountSnapshots: Object.freeze([Object.freeze({
    id: "snapshot-current", accountId: "ex-okx-main", exchange: "OKX", status: "ok", createdAt: asOf,
    algoOrdersComplete: true,
    algoOrders: Object.freeze([Object.freeze({ instId: "ETH-USDT-SWAP", algoClOrdId: "stop-execution-1", slTriggerPx: "3365" })])
  })]),
  executionOrders: Object.freeze([Object.freeze({
    id: "execution-1", positionId: "position-1", symbol: "ETH/USDT", direction: "long",
    status: "protecting", filledQuantity: 2.4, stopClientOrderId: "stop-execution-1",
    exchange: "OKX", accountId: "ex-okx-main"
  })]),
  reconciliationReports: Object.freeze([]),
  riskIncidents: Object.freeze([])
});
const truth = Object.freeze({ mode: "full", equity: 12000, available: 8600, exposure: 0, risk: "normal" });
const state = Object.freeze({ kind: "ready", source: "OKX", lastValidAt: asOf });
const calls = { selections: [], watchlist: 0, reconcile: 0, unhandled: 0 };
window.__kordynV2AccountInteractionCalls = calls;
window.__kordynV2AccountPositionFixture = Object.freeze({
  rawCount: rawPositionMirrors.length,
  normalizedCount: normalizedPositions.length,
  rawSyncedAt: normalizedPositions[0]?.rawSyncedAt,
  accountId: normalizedPositions[0]?.accountId,
  exchange: normalizedPositions[0]?.exchange
});
window.addEventListener("unhandledrejection", (event) => { calls.unhandled += 1; event.preventDefault(); });

function ProductionHarness({ workspaceId }) {
  const [selection, setSelection] = useState(null);
  const actions = workspaceId === "market"
    ? { addWatchlist: () => { calls.watchlist += 1; return Promise.reject(new Error("WATCHLIST_SECRET_NEVER_RENDER")); }, removeWatchlist: () => ({ ok: true }) }
    : workspaceId === "account"
      ? { reconcile: () => { calls.reconcile += 1; throw new Error("RECONCILE_SECRET_NEVER_RENDER"); } }
      : { exitExecutionOrder: () => ({ ok: true }) };
  const onSelect = (candidate) => {
    const resolved = createV2Selection({ data, candidate });
    calls.selections.push(resolved ? { id: resolved.object.id, type: resolved.object.type, contextId: resolved.context.objectId, traceId: resolved.trace.objectId } : null);
    if (resolved) setSelection(resolved);
  };
  return (
    <section data-browser-account-workspace={workspaceId} data-selected-id={selection?.object?.id || "none"}>
      <AccountDomain device="mobile" workspaceId={workspaceId} data={data} actions={actions} truth={truth} state={state} selection={selection} onSelect={onSelect} />
    </section>
  );
}

createRoot(document.getElementById("root")).render(<><ProductionHarness workspaceId="market" /><ProductionHarness workspaceId="account" /><ProductionHarness workspaceId="positions" /></>);
window.__kordynV2AccountInteractionsReady = true;
