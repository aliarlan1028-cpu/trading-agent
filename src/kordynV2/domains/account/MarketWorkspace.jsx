import { Activity, Clock3, Database, Gauge, Star, StarOff, TrendingDown, TrendingUp } from "lucide-react";
import { MarketInstrumentPicker } from "./MarketInstrumentPicker.jsx";

const unavailable = "Unavailable";
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const safe = (value) => typeof value === "string" && value ? value : unavailable;
const number = (value, digits = 2) => finite(value)
  ? new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: 8 }).format(value)
  : unavailable;
const change = (value) => finite(value) ? `${value > 0 ? "+" : ""}${value.toFixed(2)}%` : unavailable;

export function selectedMarketFor(model, selection) {
  const markets = Array.isArray(model?.markets) ? model.markets : [];
  const selectedId = selection?.object?.type === "Market" ? selection.object.id : null;
  return markets.find((market) => market.symbol === selectedId) || markets[0] || null;
}

function marketProvenance(market, state) {
  return {
    source: safe(market?.source || market?.sourceName || state?.source),
    asOf: safe(market?.updatedAt || market?.syncedAt || market?.microSyncedAt || state?.lastValidAt)
  };
}

function RangeField({ market }) {
  const hasRange = finite(market?.low24h) && finite(market?.high24h) && market.high24h > market.low24h;
  const hasPrice = finite(market?.price);
  const position = hasRange && hasPrice
    ? Math.max(0, Math.min(100, (market.price - market.low24h) / (market.high24h - market.low24h) * 100))
    : null;
  return (
    <section className="kordynV2MarketRange" aria-label="24 小时价格区间" data-kordyn-v2-market-range>
      <header><h2>24h 价格区间</h2><span>当前事实，不含虚构历史</span></header>
      <div className="kordynV2MarketRangeTrack" data-range-available={position === null ? "false" : "true"}>
        {position !== null && <i style={{ "--market-position": `${position}%` }} aria-hidden="true" />}
      </div>
      <dl>
        <div><dt>低点</dt><dd>{number(market?.low24h)}</dd></div>
        <div><dt>当前</dt><dd>{number(market?.price)}</dd></div>
        <div><dt>高点</dt><dd>{number(market?.high24h)}</dd></div>
      </dl>
    </section>
  );
}

function MarketFact({ label, value }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function MarketAnalyticField({ market, state, watched = false, actionsDisabled = false, onWatchlistChange = () => {}, mobile = false }) {
  const provenance = marketProvenance(market, state);
  const trend = finite(market?.changePct) && market.changePct < 0 ? "negative" : finite(market?.changePct) ? "positive" : "unavailable";
  const TrendIcon = trend === "negative" ? TrendingDown : TrendingUp;
  return (
    <section
      className={`kordynV2MarketAnalytic${mobile ? " is-mobile" : ""}`}
      data-kordyn-v2-mobile-market-analytic={mobile ? "true" : undefined}
      data-kordyn-v2-object-id={safe(market?.symbol)}
      data-kordyn-v2-object-type="Market"
    >
      <header>
        <span><Activity size={19} aria-hidden="true" /><strong>{safe(market?.symbol)}</strong></span>
        <button
          type="button"
          data-kordyn-v2-watchlist-action={watched ? "remove" : "add"}
          disabled={actionsDisabled || !market?.symbol}
          onClick={() => market?.symbol && onWatchlistChange(market.symbol, watched)}
        >
          {watched ? <StarOff size={16} aria-hidden="true" /> : <Star size={16} aria-hidden="true" />}
          {watched ? "移出观察" : "加入观察"}
        </button>
      </header>
      <div className="kordynV2MarketPrice">
        <strong>{number(market?.price)}</strong>
        <em data-market-trend={trend}><TrendIcon size={16} aria-hidden="true" />{change(market?.changePct)}</em>
      </div>
      <dl className="kordynV2MarketFacts">
        <MarketFact label="24h 高点" value={number(market?.high24h)} />
        <MarketFact label="24h 低点" value={number(market?.low24h)} />
        <MarketFact label="24h 成交额" value={number(market?.volume24h, 0)} />
      </dl>
      <RangeField market={market} />
      <footer className="kordynV2MarketProvenance">
        <span><Database size={14} aria-hidden="true" /><small>来源</small><strong>{provenance.source}</strong></span>
        <span><Clock3 size={14} aria-hidden="true" /><small>数据截至 / As of</small><time dateTime={provenance.asOf === unavailable ? undefined : provenance.asOf}>{provenance.asOf}</time></span>
        <span><Gauge size={14} aria-hidden="true" /><small>资源状态</small><strong>{safe(state?.kind)}</strong></span>
      </footer>
    </section>
  );
}

export function MarketWorkspace({ model, truth, state, selection, actionsDisabled = false, onSelect = () => {}, onWatchlistChange = () => {} }) {
  const markets = Array.isArray(model?.markets) ? model.markets : [];
  const watchlist = Array.isArray(model?.watchlist) ? model.watchlist : [];
  const selected = selectedMarketFor(model, selection);
  const canonicalId = selection?.object?.type === "Market" ? selection.object.id : null;
  const watched = selected?.symbol ? watchlist.includes(selected.symbol) : false;
  return (
    <div className="kordynV2MarketWorkspace" data-kordyn-v2-destination="account/market" data-kordyn-v2-truth-mode={truth?.mode === "full" ? "full" : "full"}>
      <header className="kordynV2AccountWorkspaceTitle">
        <span><h1 data-kordyn-v2-destination-title>市场</h1><small>实时市场事实与来源</small></span>
        <em role="status">{safe(state?.kind)}</em>
      </header>
      <div className="kordynV2MarketWorkbench" data-kordyn-v2-layout="market-picker-analytic-context">
        <MarketInstrumentPicker markets={markets} watchlist={watchlist} selectedId={canonicalId} actionsDisabled={actionsDisabled} onSelect={onSelect} onWatchlistChange={onWatchlistChange} />
        <MarketAnalyticField market={selected} state={state} watched={watched} actionsDisabled={actionsDisabled} onWatchlistChange={onWatchlistChange} />
        <aside className="kordynV2MarketContext" aria-label="市场上下文">
          <header><h2>市场上下文</h2><Activity size={16} aria-hidden="true" /></header>
          <dl>
            <MarketFact label="当前对象" value={canonicalId || unavailable} />
            <MarketFact label="观察列表" value={String(watchlist.length)} />
            <MarketFact label="账户权益" value={number(truth?.equity)} />
            <MarketFact label="可用" value={number(truth?.available)} />
            <MarketFact label="敞口" value={number(truth?.exposure)} />
            <MarketFact label="风险" value={safe(truth?.risk)} />
          </dl>
          <p>市场切换会更新全局对象；观察列表写入等待服务端返回。</p>
        </aside>
      </div>
    </div>
  );
}
