import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import AccountDomain from "../src/kordynV2/domains/account/index.jsx";
import { createV2Selection } from "../src/kordynV2/viewModels/selection.js";

const asOf = "2026-08-30T06:33:00Z";
const data = Object.freeze({
  resourceState: Object.freeze({ cockpit: "loaded" }),
  source: "OKX",
  asOf,
  portfolio: Object.freeze({ totalEquityUsdt: 12000, availableMarginUsdt: 8600, marginSyncedAt: asOf }),
  positions: Object.freeze([]),
  markets: Object.freeze([Object.freeze({ symbol: "BTC/USDT", price: 68230, changePct: -0.4, high24h: 69000, low24h: 67100, updatedAt: asOf, source: "OKX" })]),
  watchlist: Object.freeze([]),
  exchangeAccounts: Object.freeze([Object.freeze({ id: "ex-okx-main", exchange: "OKX", label: "OKX 统一账户", status: "configured", updatedAt: asOf })]),
  accountSnapshots: Object.freeze([Object.freeze({ id: "snapshot-current", accountId: "ex-okx-main", status: "ok", createdAt: asOf })]),
  reconciliationReports: Object.freeze([])
});
const truth = Object.freeze({ mode: "full", equity: 12000, available: 8600, exposure: 0, risk: "normal" });
const state = Object.freeze({ kind: "ready", source: "OKX", lastValidAt: asOf });
const calls = { selections: [], watchlist: 0, reconcile: 0, unhandled: 0 };
window.__kordynV2AccountInteractionCalls = calls;
window.addEventListener("unhandledrejection", (event) => { calls.unhandled += 1; event.preventDefault(); });

function ProductionHarness({ workspaceId }) {
  const [selection, setSelection] = useState(null);
  const actions = workspaceId === "market"
    ? { addWatchlist: () => { calls.watchlist += 1; return Promise.reject(new Error("WATCHLIST_SECRET_NEVER_RENDER")); }, removeWatchlist: () => ({ ok: true }) }
    : { reconcile: () => { calls.reconcile += 1; throw new Error("RECONCILE_SECRET_NEVER_RENDER"); } };
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

createRoot(document.getElementById("root")).render(<><ProductionHarness workspaceId="market" /><ProductionHarness workspaceId="account" /></>);
window.__kordynV2AccountInteractionsReady = true;
