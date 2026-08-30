import { Star, StarOff, TrendingDown, TrendingUp } from "lucide-react";

const unavailable = "Unavailable";

const finite = (value) => typeof value === "number" && Number.isFinite(value);

function priceText(value) {
  return finite(value)
    ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 }).format(value)
    : unavailable;
}

function changeText(value) {
  if (!finite(value)) return unavailable;
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export function marketSelectionCandidate(market) {
  const id = typeof market?.symbol === "string" && market.symbol ? market.symbol : null;
  return id && !["unavailable", "unknown", "n/a", "—"].includes(id.toLowerCase())
    ? { id, type: "Market", workspaceId: "account", route: "market", sourceSection: "cockpit" }
    : null;
}

export function MarketInstrumentPicker({
  markets = [],
  availability = { state: "absent", count: null },
  watchlist = [],
  selectedId = null,
  returnFocusRef = null,
  actionsDisabled = false,
  actionOutcome = null,
  onSelect = () => {},
  onWatchlistChange = () => {}
}) {
  const watched = new Set(Array.isArray(watchlist) ? watchlist : []);
  const rows = Array.isArray(markets) ? markets : [];
  const count = availability?.state === "loaded" ? rows.length : unavailable;
  const emptyCopy = availability?.state === "loaded" ? "当前没有市场" : availability?.state === "invalid" ? "市场事实不可用" : "市场事实明确未加载";
  return (
    <section className="kordynV2MarketPicker" aria-label="市场列表" data-kordyn-v2-market-picker>
      <header><h2>市场列表</h2><span>{count}</span></header>
      <div className="kordynV2MarketPickerRows">
        {rows.map((market) => {
          const candidate = marketSelectionCandidate(market);
          if (!candidate) return null;
          const isWatched = watched.has(candidate.id);
          const trend = finite(market.changePct) && market.changePct < 0 ? "negative" : finite(market.changePct) ? "positive" : "unavailable";
          const TrendIcon = trend === "negative" ? TrendingDown : trend === "positive" ? TrendingUp : null;
          return (
            <article key={candidate.id} data-selected={candidate.id === selectedId ? "true" : "false"}>
              <button
                ref={candidate.id === selectedId ? returnFocusRef : null}
                className="kordynV2MarketSelect"
                type="button"
                data-kordyn-v2-object-id={candidate.id}
                data-kordyn-v2-object-type="Market"
                aria-pressed={candidate.id === selectedId}
                onClick={(event) => onSelect(candidate, event)}
              >
                <span className="kordynV2MarketGlyph" aria-hidden="true">{candidate.id.slice(0, 1)}</span>
                <span><strong>{candidate.id}</strong><small>{priceText(market.price)}</small></span>
                <em data-market-trend={trend}>{TrendIcon && <TrendIcon size={14} aria-hidden="true" />}{changeText(market.changePct)}</em>
              </button>
              <button
                className="kordynV2MarketWatchAction"
                type="button"
                data-kordyn-v2-watchlist-action={isWatched ? "remove" : "add"}
                aria-label={isWatched ? `从观察列表移除 ${candidate.id}` : `将 ${candidate.id} 加入观察列表`}
                disabled={actionsDisabled}
                onClick={() => onWatchlistChange(candidate.id, isWatched)}
              >
                {isWatched ? <StarOff size={16} aria-hidden="true" /> : <Star size={16} aria-hidden="true" />}
              </button>
            </article>
          );
        })}
        {!rows.length && <p className="kordynV2AccountEmpty" role="status">{emptyCopy}</p>}
      </div>
      {actionOutcome?.action === "watchlist" && <p className="kordynV2MarketActionStatus" role="status" aria-live="polite">{actionOutcome.presentation?.message || ""}</p>}
    </section>
  );
}
