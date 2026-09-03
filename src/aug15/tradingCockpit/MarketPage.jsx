import React, { useEffect, useMemo, useState } from "react";
import {
  Activity, BarChart3, Bot, CalendarDays, CircleGauge,
  Search, Star, TrendingDown, TrendingUp, X
} from "lucide-react";
import { buildMarketRows } from "../../viewData.js";
import { displayMoney, formatDateTime, humanize, localizeText, TradingViewChart } from "../lib.jsx";
import { t } from "../i18n.js";
import { CockpitEmpty, CockpitPanel, Tone } from "./shared.jsx";
import { BreadthBars, GaugeChart } from "./visuals.jsx";

const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1D"];
const CHART_INTERVALS = { "1m": "1m", "5m": "5m", "15m": "15m", "1h": "60", "4h": "240", "1D": "D" };
const RESOURCE_STATES = new Set(["not_loaded", "loading", "loaded", "stale", "degraded", "error", "failed", "forbidden", "disabled"]);

const list = (value) => Array.isArray(value) ? value.filter(Boolean) : [];
const finite = (value) => value !== null && value !== undefined && value !== ""
  && (typeof value !== "string" || value.trim() !== "") && Number.isFinite(Number(value));
const numeric = (value) => finite(value) ? Number(value) : null;
const money = (value, fallback = "—") => finite(value) ? displayMoney(Number(value), 2, fallback) : fallback;
const signedPct = (value, fallback = "—") => finite(value) ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%` : fallback;
const formatCompact = (value, fallback = "—") => finite(value)
  ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(Number(value))
  : fallback;
const text = (value) => typeof value === "string" ? value.trim() : "";

function canonicalMarketSymbol(value) {
  const symbol = text(value);
  return /^[^/\s]+\/[^/\s]+$/.test(symbol) ? symbol : "";
}

function eventEvidence(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const title = text(event.title) || text(event.shortTitle);
  const detail = text(event.summary) || text(event.description) || text(event.sourceName) || text(event.source);
  const status = text(event.importance) || text(event.impact);
  const date = text(event.due) || text(event.startAt) || text(event.createdAt);
  return title || detail ? { ...event, title, detail, status, date } : null;
}

function resourceStateOf(data) {
  const raw = String(data?.resourceState?.cockpit || "").trim().toLowerCase();
  if (raw === "ready") return "loaded";
  return RESOURCE_STATES.has(raw) ? raw : "not_loaded";
}

function hasMarketEvidence(data, markets, events) {
  if (markets.length) return true;
  if (events.length) return true;
  if (watchSymbolsOf(data?.watchlist).length) return true;
  if (list(data?.mediumTermAnalytics?.symbols).some((row) => row && typeof row === "object")) return true;
  const regime = data?.marketRegime;
  return Boolean(regime && typeof regime === "object" && (
    String(regime.summary || regime.label || regime.global?.summary || regime.global?.label || "").trim()
    || finite(regime.confidence ?? regime.global?.confidence)
  ));
}

function marketRows(data) {
  const normalize = (row) => {
    const symbol = canonicalMarketSymbol(row?.symbol);
    return symbol ? { ...row, id: row.id || symbol, symbol } : null;
  };
  const rows = buildMarketRows(data).map(normalize).filter(Boolean);
  const activeSymbol = canonicalMarketSymbol(data?.activeMarket?.symbol);
  const active = activeSymbol
    ? normalize(buildMarketRows({ markets: [{ ...data.activeMarket, symbol: activeSymbol }] })[0])
    : null;
  const ordered = active && !rows.some((row) => row.symbol === active.symbol) ? [active, ...rows] : rows;
  return [...new Map(ordered.map((row) => [row.symbol, row])).values()];
}

function watchSymbolsOf(value) {
  return [...new Set(list(value)
    .map((row) => canonicalMarketSymbol(typeof row === "string" ? row : row?.symbol))
    .filter(Boolean))];
}

function levelValues(value) {
  if (Array.isArray(value)) return value.filter(finite).map(Number);
  return finite(value) ? [Number(value)] : [];
}

function MarketResourceState({ state, retainsFacts, onRetry }) {
  const content = {
    not_loaded: [t("行情尚未加载", "Market not loaded"), t("打开行情页后会读取真实市场事实。", "Live market facts load when the Market page opens.")],
    loading: [t("行情正在加载", "Loading market"), retainsFacts ? t("保留上一份有效事实；当前 K 线等待刷新完成。", "Last-valid facts remain visible while current candles refresh.") : t("正在读取市场事实，空白不代表价格为零。", "Reading market facts; blank values do not mean zero.")],
    stale: [t("行情数据已陈旧", "Market data is stale"), t("保留最后有效事实；当前 K 线不会重新请求。", "Last-valid facts remain visible; current candles are not requested.")],
    degraded: [t("行情服务降级", "Market service degraded"), t("只展示仍可验证的最后有效市场事实。", "Only verifiable last-valid market facts remain visible.")],
    error: [t("行情加载失败", "Market failed to load"), t("当前市场事实不可用，请重新加载。", "Current market facts are unavailable. Reload to retry.")],
    failed: [t("行情加载失败", "Market failed to load"), t("当前市场事实不可用，请重新加载。", "Current market facts are unavailable. Reload to retry.")],
    forbidden: [t("行情需要权限", "Market permission required"), t("当前身份无权读取这组市场事实。", "The current identity cannot read these market facts.")],
    disabled: [t("行情数据源已停用", "Market source disabled"), t("当前环境未启用交易驾驶舱行情数据源。", "The Trading Cockpit market source is disabled in this environment.")]
  }[state] || [t("行情状态不可用", "Market state unavailable"), t("当前资源状态无法确认。", "The current resource state cannot be confirmed.")];
  return <section className={`marketResourceState ${state}`} data-market-resource-state={state} role={["error", "failed"].includes(state) ? "alert" : "status"}>
    <Activity aria-hidden="true"/>
    <div><b>{content[0]}</b><span>{content[1]}</span></div>
    {["error", "failed", "stale", "degraded"].includes(state) && <button type="button" onClick={onRetry}>{t("重新加载", "Reload")}</button>}
  </section>;
}

function MarketHeader({ market, symbol, symbols, onSymbolChange, regime, disabled }) {
  const change = numeric(market?.changePct ?? market?.change24hPct);
  const confidence = numeric(regime?.global?.confidence ?? regime?.confidence);
  return <section className="marketHeader" data-cockpit-region="market-header">
    <div className="marketIdentity">
      <span className="marketAssetMark" aria-hidden="true"><BarChart3/></span>
      <select data-market-symbol-select aria-label={t("选择交易对", "Select pair")} value={symbol} disabled={disabled || !symbols.length} onChange={(event) => onSymbolChange(event.target.value)}>
        {symbols.length ? symbols.map((name) => <option value={name} key={name}>{name}</option>) : <option value="">{t("行情尚未同步", "Market data not synced")}</option>}
      </select>
      <span><b>{market?.symbol || t("市场待同步", "Market pending")}</b><small>{t("实时市场身份", "Live market identity")}</small></span>
    </div>
    <div className="marketPrimaryQuote">
      <b>{money(market?.price ?? market?.last, t("待同步", "Pending"))}</b>
      <Tone tone={change == null ? "neutral" : change >= 0 ? "positive" : "negative"}>{signedPct(change)}</Tone>
      <small>{t("最新可验证价格", "Latest verified price")}</small>
    </div>
    <dl className="marketQuoteFacts">
      <div><dt>{t("24h 高", "24h high")}</dt><dd>{money(market?.high24h ?? market?.high)}</dd></div>
      <div><dt>{t("24h 低", "24h low")}</dt><dd>{money(market?.low24h ?? market?.low)}</dd></div>
      <div><dt>{t("24h 成交额", "24h turnover")}</dt><dd>{formatCompact(market?.quoteTurnover24h ?? market?.turnover24h ?? market?.quoteVolume)}</dd></div>
      <div><dt>{t("24h 成交量", "24h volume")}</dt><dd>{formatCompact(market?.baseVolume24h ?? market?.volume24h ?? market?.volume)}</dd></div>
    </dl>
    <div className="marketRegimeSummary">
      <span><small>{t("市场制度", "Market regime")}</small><b>{localizeText(regime?.global?.label || regime?.label || t("证据不足", "Insufficient evidence"))}</b><em>{localizeText(regime?.global?.summary || regime?.summary || t("等待更多真实市场事实。", "Waiting for more live market facts."))}</em></span>
      <GaugeChart value={confidence} label={t("置信度", "Confidence")} ariaLabel={t("市场制度置信度", "Market regime confidence")}/>
    </div>
  </section>;
}

function MarketState({ market, regime, medium }) {
  const confidence = numeric(regime?.global?.confidence ?? regime?.confidence);
  const facts = [
    [t("趋势结构", "Trend structure"), regime?.global?.label ?? regime?.label],
    [t("动量", "Momentum"), regime?.global?.momentum ?? medium?.windows?.["1h"]?.leverageState],
    [t("波动率 (24h)", "Volatility (24h)"), finite(market?.volatility24hPct ?? regime?.global?.volatilityPct) ? `${Number(market?.volatility24hPct ?? regime?.global?.volatilityPct).toFixed(2)}%` : null],
    [t("资金费率", "Funding rate"), finite(market?.fundingRate) ? signedPct(market.fundingRate) : null],
    [t("持仓量 OI", "Open interest"), finite(market?.openInterest) ? formatCompact(market.openInterest) : null],
    [t("市场广度", "Market breadth"), finite(regime?.global?.breadthPct) ? `${Number(regime.global.breadthPct).toFixed(0)}%` : null]
  ];
  return <CockpitPanel className="marketStatePanel" region="market-state" title={t("市场状态", "Market state")} meta={formatDateTime(regime?.updatedAt || market?.updatedAt)}>
    <div className="marketStateLead"><CircleGauge/><span><small>{t("当前制度", "Current regime")}</small><b>{localizeText(regime?.global?.label || regime?.label || t("证据不足", "Insufficient evidence"))}</b></span></div>
    <div className="marketStateFacts">{facts.map(([label, value]) => <span key={label}><small>{label}</small><b>{value == null ? "—" : humanize(value, "—")}</b></span>)}</div>
    <div className="marketConfidence"><span><b>{confidence == null ? "—" : `${confidence.toFixed(0)}/100`}</b><small>{t("AI 置信度", "AI confidence")}</small></span><i aria-hidden="true"><b style={{ width: `${Math.max(0, Math.min(100, confidence ?? 0))}%` }}/></i></div>
  </CockpitPanel>;
}

function Watchlist({ rows, selected, savedSymbols, onSelect, onRemove }) {
  return <CockpitPanel className="marketWatchlist" region="watchlist" title={t("自选列表", "Watchlist")} meta={`${rows.length}`}>
    {rows.length ? <div className="marketWatchRows">{rows.slice(0, 7).map((row) => {
      const change = numeric(row.changePct ?? row.change24hPct);
      return <article className={row.available && row.symbol === selected ? "active" : ""} data-market-watch-unavailable={!row.available ? row.symbol : undefined} key={row.symbol}>
        {row.available ? <button type="button" className="marketWatchSelect" data-market-watch-select={row.symbol} aria-current={row.symbol === selected ? "true" : undefined} onClick={() => onSelect(row.symbol)}>
          <span><b>{row.symbol}</b><small>{money(row.price ?? row.last)}</small></span>
          <em className={change == null ? "" : change >= 0 ? "positiveText" : "negativeText"}>{signedPct(change)}</em>
          {change == null ? <Activity/> : change >= 0 ? <TrendingUp/> : <TrendingDown/>}
        </button> : <div className="marketWatchSelect marketWatchUnavailable">
          <span><b>{row.symbol}</b><small>{t("行情不可用", "Quote unavailable")}</small></span>
          <em>—</em><Activity/>
        </div>}
        {savedSymbols.includes(row.symbol) && <button type="button" className="marketWatchRemove" aria-label={t(`从自选移除 ${row.symbol}`, `Remove ${row.symbol} from watchlist`)} onClick={() => onRemove(row.symbol)}><X/></button>}
      </article>;
    })}</div> : <CockpitEmpty icon={Star} title={t("自选列表为空", "Watchlist is empty")} detail={t("当前没有已保存的交易对。", "No market pair is currently saved.")}/>
    }
  </CockpitPanel>;
}

function Derivatives({ market, regime }) {
  const topRatio = regime?.smartMoney?.topTraderLongShortRatio;
  const facts = [
    [t("持仓量 (OI)", "Open interest"), formatCompact(market?.openInterest)],
    [t("OI 变化", "OI change"), signedPct(market?.openInterestChangePct)],
    [t("资金费率", "Funding rate"), signedPct(market?.fundingRate)],
    [t("24h 清算量", "24h liquidation"), formatCompact(market?.liquidation24h ?? market?.liquidationVolume24h)],
    [t("多空比", "Long / short"), finite(topRatio) ? Number(topRatio).toFixed(2) : "—"]
  ];
  return <CockpitPanel className="marketDerivatives" region="derivatives" title={t("衍生品数据", "Derivatives")} meta={formatDateTime(market?.updatedAt)}>
    <div className="marketDerivativeFacts">{facts.map(([label, value]) => <span key={label}><small>{label}</small><b>{value}</b></span>)}</div>
  </CockpitPanel>;
}

function Breadth({ regime, markets }) {
  const breadth = numeric(regime?.global?.breadthPct);
  const advancing = markets.filter((row) => numeric(row.changePct ?? row.change24hPct) > 0).length;
  const measured = markets.filter((row) => numeric(row.changePct ?? row.change24hPct) != null).length;
  const breadthItems = breadth == null ? [] : [
    { id: "advancing", label: t("上行占比", "Advancing share"), value: breadth, tone: "positive" },
    { id: "remainder", label: t("其余市场", "Remaining market"), value: 100 - breadth, tone: "negative" }
  ];
  return <CockpitPanel className="marketBreadth" region="breadth" title={t("市场广度", "Market breadth")} meta={measured ? t(`${measured} 个已加载市场`, `${measured} loaded markets`) : t("等待样本", "Awaiting samples")}>
    <div className="marketBreadthLead"><GaugeChart value={breadth} label={t("广度", "Breadth")} ariaLabel={t("真实市场广度", "Verified market breadth")}/><span><b>{breadth == null ? t("不可用", "Unavailable") : breadth >= 50 ? t("偏多", "Positive") : t("偏空", "Negative")}</b><small>{measured ? t(`${advancing}/${measured} 个已加载市场上涨`, `${advancing}/${measured} loaded markets advancing`) : t("未收到逐市场涨跌样本", "No per-market change samples")}</small></span></div>
    <BreadthBars items={breadthItems} ariaLabel={t("市场广度组成", "Market breadth composition")}/>
  </CockpitPanel>;
}

function EventCatalysts({ events }) {
  return <CockpitPanel className="marketEvents" region="event-catalysts" title={t("关键宏观与催化", "Event catalysts")} meta={`${events.length}`}>
    {events.length ? <div className="marketEventRows">{events.slice(0, 4).map((event, index) => <article key={event.id || `${event.title}-${index}`}>
      <CalendarDays/><time>{formatDateTime(event.date, "—")}</time><span><b>{event.title ? localizeText(event.title) : "—"}</b><small>{event.detail ? localizeText(event.detail) : "—"}</small></span><Tone tone={event.status.toLowerCase() === "high" ? "warning" : "neutral"}>{event.status ? humanize(event.status) : "—"}</Tone>
    </article>)}</div> : <CockpitEmpty icon={CalendarDays} title={t("暂无已记录事件", "No recorded events")} detail={t("宏观或业务事件同步后会显示在这里。", "Synced macro and business events appear here.")}/>
    }
  </CockpitPanel>;
}

function AiMarketView({ regime, market }) {
  const confidence = numeric(regime?.global?.confidence ?? regime?.confidence);
  const support = levelValues(regime?.supportLevels ?? regime?.global?.supportLevels ?? market?.supportLevels ?? market?.support);
  const resistance = levelValues(regime?.resistanceLevels ?? regime?.global?.resistanceLevels ?? market?.resistanceLevels ?? market?.resistance);
  return <CockpitPanel className="marketAiView" region="ai-market-view" title={t("AI 市场观点", "AI market view")} meta={formatDateTime(regime?.updatedAt)}>
    <div className="marketAiLead"><Bot/><span><small>{confidence == null ? t("置信度不可用", "Confidence unavailable") : `${t("置信度", "Confidence")} ${confidence.toFixed(0)}/100`}</small><b>{localizeText(regime?.global?.label || regime?.label || t("观点待形成", "View pending"))}</b><p>{localizeText(regime?.summary || regime?.global?.summary || t("当前没有足够真实证据形成可靠市场观点。", "There is not enough live evidence for a reliable market view."))}</p></span></div>
    <div className="marketKeyLevels">
      <span><small>{t("阻力位", "Resistance")}</small><b>{resistance.length ? resistance.slice(0, 3).map((value) => money(value)).join(" / ") : t("未提供", "Unavailable")}</b></span>
      <span><small>{t("支撑位", "Support")}</small><b>{support.length ? support.slice(0, 3).map((value) => money(value)).join(" / ") : t("未提供", "Unavailable")}</b></span>
    </div>
  </CockpitPanel>;
}

function MarketTicker({ markets, selected, onSelect }) {
  return <footer className="marketTicker" data-cockpit-region="market-ticker" aria-label={t("市场行情带", "Market ticker")}>
    {markets.length ? markets.slice(0, 10).map((row) => {
      const change = numeric(row.changePct ?? row.change24hPct);
      return <button type="button" aria-current={row.symbol === selected ? "true" : undefined} key={row.symbol} onClick={() => onSelect(row.symbol)}><b>{row.symbol}</b><span>{money(row.price ?? row.last)}</span><em className={change == null ? "" : change >= 0 ? "positiveText" : "negativeText"}>{signedPct(change)}</em></button>;
    }) : <span className="marketTickerEmpty">{t("真实市场行情尚未同步", "Live market ticker is not synced")}</span>}
  </footer>;
}

export function MarketPage({ data = {}, action, ui }) {
  const markets = useMemo(() => marketRows(data), [data]);
  const symbols = useMemo(() => [...new Set(markets.map((row) => row.symbol).filter(Boolean))], [markets]);
  const activeSymbol = canonicalMarketSymbol(data?.activeMarket?.symbol);
  const preferredSymbol = activeSymbol && symbols.includes(activeSymbol) ? activeSymbol : symbols[0] || "";
  const [symbol, setSymbol] = useState(preferredSymbol);
  const [interval, setInterval] = useState("1h");
  useEffect(() => {
    if (!symbols.includes(symbol)) setSymbol(preferredSymbol);
  }, [preferredSymbol, symbol, symbols]);

  const state = resourceStateOf(data);
  const events = list(data.events).map(eventEvidence).filter(Boolean);
  const hasEvidence = hasMarketEvidence(data, markets, events);
  const retainsFacts = ["stale", "degraded"].includes(state) || (state === "loading" && hasEvidence);
  const blocked = ["not_loaded", "error", "failed", "forbidden", "disabled"].includes(state) || (state === "loading" && !hasEvidence);
  const market = markets.find((row) => row.symbol === symbol) || null;
  const regime = data.marketRegime && typeof data.marketRegime === "object" ? data.marketRegime : {};
  const medium = list(data.mediumTermAnalytics?.symbols).find((row) => row?.symbol === symbol) || null;
  const savedSymbols = watchSymbolsOf(data.watchlist);
  const watchRows = savedSymbols.map((name) => {
    const live = markets.find((row) => row.symbol === name);
    return live ? { ...live, available: true } : { symbol: name, available: false };
  });
  const reload = () => ui?.ensureSection?.("cockpit", { force: true }) ?? ui?.refresh?.(true);
  const removeWatch = (name) => action?.(`/api/watchlist/${encodeURIComponent(name)}`, {}, "DELETE");

  if (blocked) return <div className="cockpitPage cockpitMarket" data-cockpit-page="market" data-resource-state={state} data-market-symbol="">
    <MarketResourceState state={state} retainsFacts={false} onRetry={reload}/>
  </div>;

  return <div className="cockpitPage cockpitMarket" data-cockpit-page="market" data-resource-state={state} data-market-symbol={symbol}>
    {retainsFacts && <MarketResourceState state={state} retainsFacts onRetry={reload}/>
    }
    <MarketHeader market={market} symbol={symbol} symbols={symbols} onSymbolChange={setSymbol} regime={regime} disabled={state !== "loaded"}/>
    <div className="marketWorkspace">
      <CockpitPanel className="marketChartPanel" region="market-chart-workspace" title={t("价格与成交结构", "Price and market structure")} meta={market ? `${market.symbol} · ${interval}` : t("等待真实行情", "Awaiting live market data")} action={<div className="marketIntervals" role="group" aria-label={t("K 线周期", "Candle interval")}>{INTERVALS.map((label) => <button type="button" data-market-interval aria-pressed={interval === label} disabled={state !== "loaded" || !market} className={interval === label ? "active" : ""} onClick={() => setInterval(label)} key={label}>{label}</button>)}</div>}>
        <div className="marketChartQuote"><span><b>{market?.symbol || t("行情待同步", "Market pending")}</b><small>{t("真实 K 线", "Live candlesticks")}</small></span><strong className={(numeric(market?.changePct ?? market?.change24hPct) ?? 0) >= 0 ? "positiveText" : "negativeText"}>{money(market?.price ?? market?.last)}</strong></div>
        <div className="marketChartBox" data-cockpit-region="market-chart">
          {state !== "loaded" ? <CockpitEmpty icon={Activity} title={t("当前 K 线已暂停", "Current candles paused")} detail={t("最后有效市场事实仍保留；重新加载后恢复当前 K 线。", "Last-valid market facts remain visible. Reload to resume current candles.")}/>
            : market ? <TradingViewChart symbol={market.symbol} interval={CHART_INTERVALS[interval]}/>
              : <CockpitEmpty icon={Search} title={t("行情尚未同步", "Market data not synced")} detail={t("收到具有真实交易对身份的行情后才加载图表。", "The chart loads after a market with a real symbol identity arrives.")}/>
          }
        </div>
        <div className="marketVolumeStrip"><span><small>{t("24h 成交量", "24h volume")}</small><b>{formatCompact(market?.baseVolume24h ?? market?.volume24h ?? market?.volume)}</b></span><span><small>{t("24h 成交额", "24h turnover")}</small><b>{formatCompact(market?.quoteTurnover24h ?? market?.turnover24h ?? market?.quoteVolume)}</b></span><em>{t("逐 K 线成交量图层默认关闭", "Per-candle volume layer is off by default")}</em></div>
      </CockpitPanel>
      <aside className="marketRail" aria-label={t("市场状态与自选", "Market state and watchlist")}>
        <MarketState market={market} regime={regime} medium={medium}/>
        <Watchlist rows={watchRows} selected={symbol} savedSymbols={savedSymbols} onSelect={setSymbol} onRemove={removeWatch}/>
      </aside>
    </div>
    <div className="marketAnalysisGrid">
      <Derivatives market={market} regime={regime}/>
      <Breadth regime={regime} markets={markets}/>
      <EventCatalysts events={events}/>
      <AiMarketView regime={regime} market={market}/>
    </div>
    <MarketTicker markets={markets} selected={symbol} onSelect={setSymbol}/>
  </div>;
}
