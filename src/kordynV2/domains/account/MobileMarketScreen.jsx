import { ArrowLeft, Database } from "lucide-react";
import { MarketInstrumentPicker } from "./MarketInstrumentPicker.jsx";
import { MarketAnalyticField, selectedMarketFor } from "./MarketWorkspace.jsx";

export function MobileMarketScreen({ model, state, selection, actionsDisabled = false, actionOutcome = null, view = "list", onSelect = () => {}, onWatchlistChange = () => {}, onOpenList = () => {}, detailHeadingRef = null, returnFocusRef = null }) {
  const markets = Array.isArray(model?.markets) ? model.markets : [];
  const watchlist = Array.isArray(model?.watchlist) ? model.watchlist : [];
  const selected = selectedMarketFor(model, selection);
  const canonicalId = selection?.object?.type === "Market" ? selection.object.id : null;
  const watched = selected?.symbol ? watchlist.includes(selected.symbol) : false;
  if (view === "detail") {
    return (
      <div className="kordynV2AccountMobile kordynV2MobileMarket" data-kordyn-v2-mobile-market-view="detail">
        <header className="kordynV2AccountMobileNav"><button type="button" onClick={(event) => onOpenList(event)}><ArrowLeft size={18} aria-hidden="true" />市场列表</button><span><Database size={15} aria-hidden="true" />权威事实</span></header>
        <MarketAnalyticField market={selected} state={state} watched={watched} actionsDisabled={actionsDisabled} actionOutcome={actionOutcome} onWatchlistChange={onWatchlistChange} mobile headingRef={detailHeadingRef} />
      </div>
    );
  }
  return (
    <div className="kordynV2AccountMobile kordynV2MobileMarket" data-kordyn-v2-mobile-market-view="list">
      <header className="kordynV2AccountMobileHeading"><h2>选择市场</h2><p>选择后更新全局 Market 对象。</p></header>
      <MarketInstrumentPicker markets={markets} availability={model?.availability?.markets} watchlist={watchlist} selectedId={canonicalId} returnFocusRef={returnFocusRef} actionsDisabled={actionsDisabled} actionOutcome={actionOutcome} onSelect={onSelect} onWatchlistChange={onWatchlistChange} />
    </div>
  );
}
