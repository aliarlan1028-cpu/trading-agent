import React, { useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronRight,
  Clock3,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards
} from "lucide-react";
import {
  displayMoney,
  displayPct,
  formatDateTime,
  formatTime,
  humanize,
  localizeText,
  TradingViewChart
} from "../lib.jsx";
import { t } from "../i18n.js";
import { buildOverviewPresentation } from "./model.js";
import {
  CockpitEmpty,
  CockpitPanel,
  CockpitTable,
  Tone
} from "./shared.jsx";
import { AreaTrend, DonutChart, GaugeChart } from "./visuals.jsx";

const list = (value) => Array.isArray(value) ? value : [];
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const numeric = (value, fallback = 0) => finite(value) ? Number(value) : fallback;
const money = (value, fallback = "—") => finite(value) ? displayMoney(Number(value), 2, fallback) : fallback;
const signedMoney = (value, fallback = "—") => finite(value) ? `${Number(value) >= 0 ? "+" : ""}${money(value, fallback)}` : fallback;
const signedPct = (value, fallback = "—") => finite(value) ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%` : fallback;
const sideTone = (value) => /short|sell|空|卖/i.test(String(value || "")) ? "negative" : /long|buy|多|买/i.test(String(value || "")) ? "positive" : "neutral";
const statusTone = (value) => /fail|error|reject|cancel|liquid|异常|失败|拒绝|取消/i.test(String(value || "")) ? "negative" : /pending|wait|pause|review|待|暂停|警告/i.test(String(value || "")) ? "warning" : /fill|complete|active|success|approved|已|运行/i.test(String(value || "")) ? "positive" : "neutral";
const allocationColors = [
  "var(--cockpit-positive)",
  "var(--cockpit-brand)",
  "var(--cockpit-negative)",
  "var(--cockpit-warning)",
  "var(--cockpit-text-2)"
];

function overviewHealth(data) {
  if (data.system?.killSwitch) return { label: t("紧急停止", "Emergency stop"), tone: "negative" };
  if (data.automationState?.label) return {
    label: localizeText(data.automationState.label),
    tone: statusTone(data.automationState.mode)
  };
  return { label: t("交易状态待同步", "Trading state pending"), tone: "neutral" };
}

function HeroFact({ label, value, detail, tone = "neutral" }) {
  return <div className={`overviewHeroFact ${tone}`}>
    <small>{label}</small>
    <b>{value}</b>
    {detail && <span>{detail}</span>}
  </div>;
}

function PortfolioHero({ model, data }) {
  const equity = model.portfolio.totalEquityUsdt;
  const available = model.portfolio.availableMarginUsdt;
  const riskUsage = finite(equity) && Number(equity) > 0 && finite(available)
    ? Math.max(0, Math.min(100, (Number(equity) - Number(available)) / Number(equity) * 100))
    : null;
  const trendValues = model.accountSnapshots.map((snapshot) => snapshot?.totalEquityUsdt);
  const health = overviewHealth(data);
  const enabledRules = list(data.riskRules).filter((rule) => rule?.enabled !== false).length;

  return <section className="overviewPortfolioHero" data-cockpit-region="portfolio-hero" aria-label={t("组合总览", "Portfolio overview")}>
    <div className="overviewHeroTrend" aria-hidden="true">
      <AreaTrend values={trendValues} tone="accent" label={t("账户净值趋势", "Account equity trend")}/>
    </div>
    <div className="overviewHeroEquity">
      <span className="overviewHeroIcon"><WalletCards/></span>
      <div>
        <small>{t("总资产（USDT）", "Total assets (USDT)")}</small>
        <b>{finite(equity) ? money(equity) : t("账户尚未同步", "Account not synced")}</b>
        <span>{finite(model.portfolio.netValueCny) ? `≈ ¥${money(model.portfolio.netValueCny)}` : t("由账户快照形成净值趋势", "Equity trend uses account snapshots")}</span>
      </div>
    </div>
    <div className="overviewHeroMetrics">
      <HeroFact label={t("今日盈亏", "Today's PnL")} value={finite(model.portfolio.todayPnl) ? signedMoney(model.portfolio.todayPnl) : "—"} detail={displayPct(model.portfolio.todayPnlPct, "—")} tone={numeric(model.portfolio.todayPnl) >= 0 ? "positive" : "negative"}/>
      <HeroFact label={t("未实现盈亏", "Unrealized PnL")} value={finite(model.portfolio.unrealizedPnl) ? signedMoney(model.portfolio.unrealizedPnl) : "—"} detail={t("真实持仓合计", "Live position total")} tone={numeric(model.portfolio.unrealizedPnl) >= 0 ? "positive" : "negative"}/>
      <div className="overviewHeroRisk">
        <small>{t("风险使用率", "Risk usage")}</small>
        <GaugeChart value={riskUsage == null ? null : Math.round(riskUsage)} label="%" detail={riskUsage == null ? t("待同步", "Pending") : riskUsage < 40 ? t("低风险", "Low risk") : t("需关注", "Monitor")} tone={riskUsage != null && riskUsage >= 70 ? "warning" : "positive"} ariaLabel={riskUsage == null ? t("风险使用率不可用", "Risk usage unavailable") : `${t("风险使用率", "Risk usage")} ${Math.round(riskUsage)}%`}/>
      </div>
      <HeroFact label={t("可用保证金", "Available margin")} value={finite(available) ? money(available) : "—"} detail={data.system?.remainingDailyLossUsdt == null ? t("预算未授权", "Budget not authorized") : `${money(data.system.remainingDailyLossUsdt)} U ${t("日损预算剩余", "daily-loss budget left")}`}/>
    </div>
    <div className="overviewHeroRuntime">
      <span className={`overviewRuntimePulse ${health.tone}`} aria-hidden="true"/>
      <small>{t("AI 策略状态", "AI strategy status")}</small>
      <b>{health.label}</b>
      <span>{enabledRules ? t(`${enabledRules} 条风控规则生效`, `${enabledRules} risk rules active`) : t("风控规则状态待同步", "Risk-rule status pending")}</span>
    </div>
  </section>;
}

function NoticeChannel({ kind, notice, icon: Icon, onOpen }) {
  const isSystem = kind === "system";
  const title = isSystem ? t("系统提示", "System notice") : t("市场快讯", "Market brief");
  const fallback = isSystem
    ? t("暂无新的系统提示。", "No new system notice.")
    : t("暂无新的市场事件。", "No new market event.");
  const message = localizeText(notice?.message || notice?.summary || notice?.title || fallback);
  const time = formatTime(notice?.updatedAt || notice?.createdAt || notice?.due || notice?.startAt);

  return <button type="button" className={`overviewNoticeChannel ${kind}`} onClick={onOpen}>
    <Icon aria-hidden="true"/>
    <b>{title}</b>
    <span>{message}</span>
    {notice && <time>{time}</time>}
    <ChevronRight aria-hidden="true"/>
  </button>;
}

function DualNotice({ system, market, ui }) {
  return <section className="overviewDualNotice" data-cockpit-region="dual-notice" aria-label={t("系统与市场提示", "System and market notices")}>
    <NoticeChannel kind="system" notice={system} icon={Radio} onOpen={() => ui.setActive("operationsCenter:notifications")}/>
    <NoticeChannel kind="market" notice={market} icon={Activity} onOpen={() => ui.setActive("market")}/>
  </section>;
}

function OverviewMarket({ model, onOpen }) {
  const [interval, setInterval] = useState("1H");
  const market = model.market;
  const hasMarket = Boolean(market?.symbol);
  const periods = [["1m", "1m"], ["5m", "5m"], ["15m", "15m"], ["1H", "60"], ["4H", "240"], ["1D", "D"]];
  const chartInterval = periods.find(([label]) => label === interval)?.[1] || "60";

  return <CockpitPanel
    className="overviewMarketPanel"
    region="overview-market"
    title={market?.symbol || t("行情尚未同步", "Market data not synced")}
    meta={hasMarket ? t("实时市场 · 公开交易所数据", "Live market · public exchange data") : t("等待真实行情", "Awaiting live market data")}
    action={<button type="button" className="cockpitTextButton" onClick={onOpen}>{t("完整行情", "Full market")}<ChevronRight/></button>}
  >
    <div className="overviewMarketQuote">
      <div><b>{finite(market?.price ?? market?.last) ? money(market.price ?? market.last) : t("待同步", "Pending")}</b><Tone tone={numeric(market?.changePct ?? market?.change24hPct) >= 0 ? "positive" : "negative"}>{signedPct(market?.changePct ?? market?.change24hPct)}</Tone></div>
      <dl>
        <div><dt>{t("24h 高", "24h high")}</dt><dd>{money(market?.high24h ?? market?.high)}</dd></div>
        <div><dt>{t("24h 低", "24h low")}</dt><dd>{money(market?.low24h ?? market?.low)}</dd></div>
        <div><dt>{t("24h 成交额", "24h turnover")}</dt><dd>{finite(market?.volume24h ?? market?.quoteVolume ?? market?.volume) ? `${money(market.volume24h ?? market.quoteVolume ?? market.volume)} U` : "—"}</dd></div>
      </dl>
    </div>
    <div className="overviewMarketToolbar" aria-label={t("行情周期", "Market interval")}>
      <div>{periods.map(([label]) => <button type="button" key={label} className={interval === label ? "active" : ""} aria-pressed={interval === label} onClick={() => setInterval(label)}>{label}</button>)}</div>
      <span><TrendingUp/>{t("K 线与成交结构", "Candles and traded volume")}</span>
    </div>
    <div className="overviewMarketChart" data-cockpit-region="market-chart">
      {hasMarket ? <TradingViewChart symbol={market.symbol} interval={chartInterval}/> : <CockpitEmpty icon={Search} title={t("行情尚未同步", "Market data not synced")} detail={t("同步真实行情后才加载图表。", "The chart loads after live market data is available.")}/>}
    </div>
    <div className="overviewVolumeSummary">
      <span>{t("成交量（24h）", "Volume (24h)")}</span>
      <b>{finite(market?.volume24h ?? market?.quoteVolume ?? market?.volume) ? `${money(market.volume24h ?? market.quoteVolume ?? market.volume)} USDT` : t("未提供", "Unavailable")}</b>
      <em>{t("成交量仅展示已同步的市场事实", "Volume reflects only synced market facts")}</em>
    </div>
  </CockpitPanel>;
}

function AiMarketRead({ model, market, marketNotice, onOpen }) {
  const global = model?.global || model || {};
  const confidence = finite(global.confidence) ? Math.max(0, Math.min(100, Number(global.confidence))) : null;
  const summary = localizeText(global.summary || model?.summary || t("数据尚不足，AI 不猜测方向。", "Insufficient evidence; AI will not guess direction."));

  return <CockpitPanel className="overviewAiRead" region="ai-market-read" title={t("AI 市场判断", "AI Market Read")} meta={t("只解释证据，不替代风控", "Evidence read; risk controls remain authoritative")}>
    <div className="overviewAiLead">
      <GaugeChart value={confidence == null ? null : Math.round(confidence)} label={t("置信度", "confidence")} tone="positive" ariaLabel={confidence == null ? t("AI 置信度不可用", "AI confidence unavailable") : `${t("AI 置信度", "AI confidence")} ${Math.round(confidence)}%`}/>
      <div><small>{t("趋势判断", "Directional read")}</small><b>{localizeText(global.label || t("等待行情形成判断", "Awaiting market evidence"))}</b><span>{market?.symbol ? `${market.symbol} · 4H` : t("行情尚未同步", "Market data not synced")}</span></div>
    </div>
    <div className="overviewAiFacts">
      <span><TrendingUp/><small>{t("趋势结构", "Trend structure")}</small><b>{localizeText(global.label || t("不可用", "Unavailable"))}</b></span>
      <span><Target/><small>{t("参考价格", "Reference price")}</small><b>{finite(market?.price ?? market?.last) ? money(market.price ?? market.last) : "—"}</b></span>
      <span><AlertTriangle/><small>{t("事件窗口", "Event window")}</small><b>{localizeText(marketNotice?.title || t("暂无高影响事件", "No high-impact event"))}</b></span>
    </div>
    <div className="overviewAiSummary"><Sparkles/><p>{summary}</p></div>
    <button type="button" className="cockpitSecondaryButton" onClick={onOpen}><Bot/>{t("查看详细分析", "Open detailed analysis")}<ChevronRight/></button>
  </CockpitPanel>;
}

function PortfolioAllocation({ rows, onOpen }) {
  const sorted = [...rows].filter((row) => finite(row.notionalUsdt) && Number(row.notionalUsdt) > 0).sort((a, b) => Number(b.notionalUsdt) - Number(a.notionalUsdt));
  const total = sorted.reduce((sum, row) => sum + Number(row.notionalUsdt), 0);
  const segments = sorted.map((row, index) => ({ value: Number(row.notionalUsdt), color: allocationColors[index % allocationColors.length] }));

  return <CockpitPanel className="overviewAllocation" region="portfolio-allocation" title={t("持仓概览", "Portfolio allocation")} meta={rows.length ? t(`${rows.length} 个真实持仓`, `${rows.length} live positions`) : t("当前空仓", "Currently flat")} action={<button type="button" className="cockpitTextButton" onClick={onOpen}>{t("查看全部", "View all")}<ChevronRight/></button>}>
    {sorted.length ? <div className="overviewAllocationBody">
      <DonutChart segments={segments} value={money(total, "—")} label="USDT" ariaLabel={t("按名义价值计算的持仓分配", "Position allocation by notional value")}/>
      <div className="overviewAllocationRows">{sorted.slice(0, 4).map((row, index) => <article key={row.id || row.positionId || row.instId || row.symbol}>
        <i style={{ background: allocationColors[index % allocationColors.length] }} aria-hidden="true"/>
        <span><b>{row.symbol || t("未命名持仓", "Unnamed position")}</b><small>{humanize(row.direction || row.side, "—")} · {total ? `${(Number(row.notionalUsdt) / total * 100).toFixed(1)}%` : "—"}</small></span>
        <strong className={numeric(row.unrealizedPnl ?? row.pnl) >= 0 ? "positiveText" : "negativeText"}>{signedMoney(row.unrealizedPnl ?? row.pnl)} U</strong>
      </article>)}</div>
    </div> : <CockpitEmpty icon={WalletCards} title={t("当前空仓", "Currently flat")} detail={t("真实持仓出现后，将按名义价值显示组合分配。", "Allocation by notional value appears when live positions exist.")}/>}
  </CockpitPanel>;
}

function RecentTrades({ rows, onOpen }) {
  return <CockpitPanel className="overviewRecentTrades" region="recent-trades" title={t("近期交易流水", "Recent trade flow")} meta={`${rows.length} ${t("条真实记录", "real records")}`} action={<button type="button" className="cockpitTextButton" onClick={onOpen}>{t("查看全部", "View all")}<ChevronRight/></button>}>
    <CockpitTable compact label={t("近期交易流水", "Recent trade flow")} rows={rows.slice(0, 5)} emptyTitle={t("暂无交易活动", "No trade activity")} emptyDetail={t("真实成交或委托出现后会自动显示。", "Live fills and orders appear automatically.")} columns={[
      { key: "time", label: t("时间", "Time"), render: (row) => formatTime(row.createdAt || row.updatedAt) },
      { key: "type", label: t("类型", "Type"), render: (row) => <Tone tone={row.fillId || row.execType ? "positive" : "neutral"}>{row.fillId || row.execType ? t("成交", "Fill") : humanize(row.type || row.orderType, t("委托", "Order"))}</Tone> },
      { key: "symbol", label: t("交易对", "Pair") },
      { key: "side", label: t("方向", "Side"), render: (row) => <Tone tone={sideTone(row.side || row.direction)}>{humanize(row.side || row.direction, "—")}</Tone> },
      { key: "quantity", label: t("数量", "Qty"), render: (row) => row.quantity ?? row.size ?? row.fillSz ?? "—" },
      { key: "price", label: t("均价", "Avg price"), render: (row) => money(row.price ?? row.fillPx) },
      { key: "status", label: t("状态", "Status"), render: (row) => <Tone tone={statusTone(row.status || (row.fillId ? "filled" : ""))}>{humanize(row.status || (row.fillId ? "filled" : "recorded"), t("已记录", "Recorded"))}</Tone> }
    ]}/>
  </CockpitPanel>;
}

function AgentActivity({ rows }) {
  return <CockpitPanel className="overviewAgentActivity" region="agent-activity" title={t("系统与 Agent 活动", "System & Agent activity")} meta={t("真实运行轨迹", "Live runtime trace")}>
    {rows.length ? <div className="overviewActivityRows">{rows.slice(0, 4).map((row, index) => <article key={row.id || index}>
      <span className={`overviewActivityDot ${statusTone(row.status)}`} aria-hidden="true"/>
      <div><b>{localizeText(row.service || row.handler || row.name || row.goal || t("系统任务", "System task"))}</b><small>{localizeText(row.goal || row.detail || row.name || t("运行事实已记录", "Runtime fact recorded"))}</small></div>
      <time>{formatDateTime(row.completedAt || row.updatedAt || row.createdAt || row.startedAt)}</time>
      <Tone tone={statusTone(row.status)}>{humanize(row.status, t("已记录", "Recorded"))}</Tone>
    </article>)}</div> : <CockpitEmpty icon={Clock3} title={t("暂无运行轨迹", "No runtime trace")} detail={t("Agent 或系统任务运行后会在这里出现。", "Agent and system runs appear here when they execute.")}/>}
  </CockpitPanel>;
}

function StrategyFooter({ products, data, onOpen }) {
  const health = overviewHealth(data);
  return <footer className="overviewStrategyFooter" data-cockpit-region="strategy-footer">
    <span><ShieldCheck/><small>{t("当前策略组合", "Current strategy portfolio")}</small><b>{products.length ? t(`${products.length} 个策略产品已登记`, `${products.length} strategy products registered`) : t("尚无已登记策略产品", "No strategy product registered")}</b></span>
    <span><Activity/><small>{t("运行状态", "Runtime status")}</small><b>{health.label}</b></span>
    <span><Target/><small>{t("风控边界", "Risk boundary")}</small><b>{list(data.riskRules).filter((row) => row?.enabled !== false).length || t("待同步", "Pending")}</b></span>
    <button type="button" onClick={onOpen}>{t("打开策略库", "Open strategy registry")}<ChevronRight/></button>
  </footer>;
}

export function OverviewPage({ data, ui }) {
  const model = buildOverviewPresentation(data);
  return <div className="cockpitPage cockpitOverview" data-cockpit-page="overview">
    <PortfolioHero model={model} data={data}/>
    <DualNotice system={model.systemNotice} market={model.marketNotice} ui={ui}/>
    <div className="overviewGrid">
      <section className="overviewPrimary" aria-label={t("市场与交易", "Market and trading")}>
        <OverviewMarket model={model} onOpen={() => ui.setActive("market")}/>
        <RecentTrades rows={model.tradeFlow} onOpen={() => ui.setActive("tradeLedger")}/>
      </section>
      <aside className="overviewRail" aria-label={t("市场判断与组合状态", "Market read and portfolio state")}>
        <AiMarketRead model={model.aiRead} market={model.market} marketNotice={model.marketNotice} onOpen={() => ui.setActive("chat")}/>
        <PortfolioAllocation rows={model.allocation} onOpen={() => ui.setActive("positions")}/>
        <AgentActivity rows={model.activities}/>
      </aside>
    </div>
    <StrategyFooter products={model.strategyProducts} data={data} onOpen={() => ui.setActive("strategyLib")}/>
  </div>;
}
