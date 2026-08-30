import { useEffect, useMemo, useState } from "react";
import { AccountWorkspace } from "./AccountWorkspace.jsx";
import { buildAccountDomainModel } from "./accountModel.js";
import { MarketWorkspace } from "./MarketWorkspace.jsx";
import { MobileAccountScreen } from "./MobileAccountScreen.jsx";
import { MobileMarketScreen } from "./MobileMarketScreen.jsx";
import "./account.css";

const disabledOutcome = Object.freeze({ ok: false, error: "action_disabled" });
const unavailableOutcome = Object.freeze({ ok: false, error: "action_unavailable" });

export function requestAccountReconciliation(actions, actionsDisabled) {
  if (actionsDisabled) return Promise.resolve(disabledOutcome);
  return typeof actions?.reconcile === "function" ? actions.reconcile() : Promise.resolve(unavailableOutcome);
}

export function requestWatchlistChange(actions, symbol, isWatched, actionsDisabled) {
  if (actionsDisabled) return Promise.resolve(disabledOutcome);
  const run = isWatched ? actions?.removeWatchlist : actions?.addWatchlist;
  return typeof run === "function" ? run(symbol) : Promise.resolve(unavailableOutcome);
}

export default function AccountDomain({ device, workspaceId, data, actions, actionsDisabled = false, truth, state, selection, onSelect }) {
  const model = useMemo(() => buildAccountDomainModel(data), [data]);
  const [mobileView, setMobileView] = useState("list");
  const [actionOutcome, setActionOutcome] = useState(null);
  const selectedMarketId = selection?.object?.type === "Market" ? selection.object.id : null;

  useEffect(() => {
    if (workspaceId === "market" && selectedMarketId) setMobileView("detail");
    else setMobileView("list");
  }, [selectedMarketId, workspaceId]);

  const reconcile = async () => {
    setActionOutcome({ kind: "processing", action: "reconcile", raw: null });
    const raw = await requestAccountReconciliation(actions, actionsDisabled);
    setActionOutcome({ kind: "result", action: "reconcile", raw });
    return raw;
  };
  const changeWatchlist = async (symbol, isWatched) => {
    setActionOutcome({ kind: "processing", action: "watchlist", raw: null });
    const raw = await requestWatchlistChange(actions, symbol, isWatched, actionsDisabled);
    setActionOutcome({ kind: "result", action: "watchlist", raw });
    return raw;
  };
  const selectMarket = (candidate) => {
    if (selection?.object?.type === "Market" && selection.object.id === candidate?.id) setMobileView("detail");
    onSelect(candidate);
  };

  const shared = { model, truth, state, selection, actions, actionsDisabled, actionOutcome, onSelect, onReconcile: reconcile, onWatchlistChange: changeWatchlist };
  if (device === "mobile") {
    if (workspaceId === "market") return <MobileMarketScreen {...shared} view={mobileView} onSelect={selectMarket} onOpenList={() => setMobileView("list")} />;
    if (workspaceId === "account") return <MobileAccountScreen {...shared} view={mobileView} onOpenList={() => setMobileView("list")} onOpenDetail={() => setMobileView("detail")} />;
    return null;
  }
  if (workspaceId === "market") return <MarketWorkspace {...shared} />;
  if (workspaceId === "account") return <AccountWorkspace {...shared} />;
  return null;
}

export { AccountWorkspace } from "./AccountWorkspace.jsx";
export { MarketWorkspace } from "./MarketWorkspace.jsx";
export { MobileAccountScreen } from "./MobileAccountScreen.jsx";
export { MobileMarketScreen } from "./MobileMarketScreen.jsx";
export { MarketInstrumentPicker } from "./MarketInstrumentPicker.jsx";
