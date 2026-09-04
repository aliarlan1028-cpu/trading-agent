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

const finite = (value) => value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "") && Number.isFinite(Number(value));
const money = (value, fallback = "—") => finite(value) ? displayMoney(Number(value), 2, fallback) : fallback;
const signedMoney = (value, fallback = "—") => finite(value) ? `${Number(value) >= 0 ? "+" : ""}${money(value, fallback)}` : fallback;
const signedPct = (value, fallback = "—") => finite(value) ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%` : fallback;
const sideTone = (value) => /short|sell|空|卖/i.test(String(value || "")) ? "negative" : /long|buy|多|买/i.test(String(value || "")) ? "positive" : "neutral";
const statusTone = (value) => /fail|error|reject|cancel|liquid|异常|失败|拒绝|取消/i.test(String(value || "")) ? "negative" : /pending|wait|pause|review|待|暂停|警告/i.test(String(value || "")) ? "warning" : /fill|complete|active|success|approved|已|运行/i.test(String(value || "")) ? "positive" : "neutral";
const valueTone = (value) => !finite(value) ? "neutral" : Number(value) >= 0 ? "positive" : "negative";
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
  const riskUsage = finite(model.portfolioRisk?.utilizationPct) ? Number(model.portfolioRisk.utilizationPct) : null;
  const riskStatus = model.portfolioRisk?.status;
  const trendValues = model.accountSnapshots.map((snapshot) => snapshot?.totalEquityUsdt);
  const health = overviewHealth(data);
  const riskRuleDetail = model.collectionState.riskRules === "loaded"
    ? t(`${model.activeRiskRuleCount} 条风控规则生效`, `${model.activeRiskRuleCount} risk rules active`)
    : t("驾驶舱快照未提供风控规则", "Risk rules unavailable in Cockpit snapshot");

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
      <HeroFact label={t("今日盈亏", "Today's PnL")} value={finite(model.portfolio.todayPnl) ? signedMoney(model.portfolio.todayPnl) : "—"} detail={finite(model.portfolio.todayPnlPct) ? displayPct(model.portfolio.todayPnlPct, "—") : "—"} tone={valueTone(model.portfolio.todayPnl)}/>
      <HeroFact label={t("未实现盈亏", "Unrealized PnL")} value={finite(model.portfolio.unrealizedPnl) ? signedMoney(model.portfolio.unrealizedPnl) : "—"} detail={t("真实持仓合计", "Live position total")} tone={valueTone(model.portfolio.unrealizedPnl)}/>
      <div className="overviewHeroRisk">
        <small>{t("风险使用率", "Risk usage")}</small>
        <GaugeChart value={riskUsage == null ? null : Math.round(riskUsage)} label="%" detail={riskStatus ? humanize(riskStatus) : t("不可用", "Unavailable")} tone={riskStatus ? statusTone(riskStatus) : "neutral"} ariaLabel={riskUsage == null ? t("风险使用率不可用", "Risk usage unavailable") : `${t("风险使用率", "Risk usage")} ${Math.round(riskUsage)}% · ${humanize(riskStatus, t("状态未提供", "status unavailable"))}`}/>
      </div>
      <HeroFact label={t("可用保证金", "Available margin")} value={finite(available) ? money(available) : "—"} detail={data.system?.remainingDailyLossUsdt == null ? t("预算未授权", "Budget not authorized") : `${money(data.system.remainingDailyLossUsdt)} U ${t("日损预算剩余", "daily-loss budget left")}`}/>
    </div>
    <div className="overviewHeroRuntime">
      <span className={`overviewRuntimePulse ${health.tone}`} aria-hidden="true"/>
      <small>{t("AI 策略状态", "AI strategy status")}</small>
      <b>{health.label}</b>
      <span>{riskRuleDetail}</span>
    </div>
  </section>;
}

function NoticeChannel({ kind, notice, state, icon: Icon, onOpen }) {
  const isSystem = kind === "system";
  const title = isSystem ? t("系统提示", "System notice") : t("市场快讯", "Market brief");
  const fallback = isSystem
    ? t("暂无新的系统提示。", "No new system notice.")
    : t("暂无新的市场事件。", "No new market event.");
  const unavailable = isSystem
    ? t("驾驶舱快照未提供系统提示来源。", "System notices unavailable in the Cockpit snapshot.")
    : t("驾驶舱快照未提供市场事件来源。", "Market events unavailable in the Cockpit snapshot.");
  const message = localizeText(notice?.message || notice?.summary || notice?.title || (state === "loaded" ? fallback : unavailable));
  const time = formatTime(notice?.updatedAt || notice?.createdAt || notice?.due || notice?.startAt);

  return <button type="button" className={`overviewNoticeChannel ${kind}`} onClick={onOpen}>
    <Icon aria-hidden="true"/>
    <b>{title}</b>
    <span>{message}</span>
    {notice && <time>{time}</time>}
    <ChevronRight aria-hidden="true"/>
  </button>;
}

function DualNotice({ system, market, states, ui }) {
  return <section className="overviewDualNotice" data-cockpit-region="dual-notice" aria-label={t("系统与市场提示", "System and market notices")}>
    <NoticeChannel kind="system" notice={system} state={states.systemNotice} icon={Radio} onOpen={() => ui.setActive("operationsCenter:notifications")}/>
    <NoticeChannel kind="market" notice={market} state={states.marketNotice} icon={Activity} onOpen={() => ui.setActive("market")}/>
  </section>;
}

function OverviewMarket({ model, onOpen }) {
  const [interval, setInterval] = useState("1H");
  const market = model.market;
  const hasMarket = Boolean(market?.symbol);
  const hasCurrentMarket = hasMarket && model.marketReady;
  const resourceLabel = model.resourceState === "loaded"
    ? t("已同步市场事实", "Synced market facts")
    : model.resourceState === "loading"
      ? t("最后有效行情 · 正在刷新", "Last valid market · refreshing")
      : model.resourceState === "stale"
        ? t("最后有效行情 · 数据已陈旧", "Last valid market · stale")
        : model.resourceState === "degraded"
          ? t("最后有效行情 · 服务降级", "Last valid market · degraded")
          : t("当前行情不可用", "Current market unavailable");
  const volume = model.marketVolume;
  const volumeLabel = volume.kind === "quote" ? t("24h 成交额", "24h turnover") : volume.kind === "base" ? t("24h 基础币成交量", "24h base volume") : t("24h 成交量", "24h volume");
  const volumeValue = volume.value == null ? t("未提供", "Unavailable") : `${money(volume.value)}${volume.unit ? ` ${volume.unit}` : ""}`;
  const periods = [["1m", "1m"], ["5m", "5m"], ["15m", "15m"], ["1H", "60"], ["4H", "240"], ["1D", "D"]];
  const chartInterval = periods.find(([label]) => label === interval)?.[1] || "60";

  return <CockpitPanel
    className="overviewMarketPanel"
    region="overview-market"
    title={market?.symbol || t("行情尚未同步", "Market data not synced")}
    meta={hasMarket ? resourceLabel : t("等待真实行情", "Awaiting market data")}
    action={<button type="button" className="cockpitTextButton" onClick={onOpen}>{t("完整行情", "Full market")}<ChevronRight/></button>}
  >
    <div className="overviewMarketQuote">
      <div><b>{finite(market?.price ?? market?.last) ? money(market.price ?? market.last) : t("待同步", "Pending")}</b><Tone tone={valueTone(market?.changePct ?? market?.change24hPct)}>{signedPct(market?.changePct ?? market?.change24hPct)}</Tone></div>
      <dl>
        <div><dt>{t("24h 高", "24h high")}</dt><dd>{money(market?.high24h ?? market?.high)}</dd></div>
        <div><dt>{t("24h 低", "24h low")}</dt><dd>{money(market?.low24h ?? market?.low)}</dd></div>
        <div><dt>{volumeLabel}</dt><dd>{volumeValue}</dd></div>
      </dl>
    </div>
    <div className="overviewMarketToolbar" aria-label={t("行情周期", "Market interval")}>
      <div>{periods.map(([label]) => <button type="button" key={label} className={interval === label ? "active" : ""} aria-pressed={interval === label} onClick={() => setInterval(label)}>{label}</button>)}</div>
      <span><TrendingUp/>{t("K 线与成交结构", "Candles and traded volume")}</span>
    </div>
    <div className="overviewMarketChart" data-cockpit-region="market-chart">
      {hasCurrentMarket ? <TradingViewChart symbol={market.symbol} interval={chartInterval} showVolume/> : <CockpitEmpty icon={Search} title={hasMarket ? t("当前图表不可用", "Current chart unavailable") : t("行情尚未同步", "Market data not synced")} detail={hasMarket ? t("资源恢复为已加载状态后，才请求当前 K 线。", "Current candles load only after the Cockpit resource is ready.") : t("同步真实行情后才加载图表。", "The chart loads after market data is available.")}/>}
    </div>
    <div className="overviewVolumeSummary">
      <span>{volumeLabel}</span>
      <b>{volumeValue}</b>
      <em>{t("成交量仅展示已同步的市场事实", "Volume reflects only synced market facts")}</em>
    </div>
  </CockpitPanel>;
}

function AiMarketRead({ model, market, marketNotice, marketNoticeState, onOpen }) {
  const global = model?.global || model || {};
  const confidence = finite(global.confidence) ? Math.max(0, Math.min(100, Number(global.confidence))) : null;
  const summary = localizeText(global.summary || model?.summary || t("数据尚不足，AI 不猜测方向。", "Insufficient evidence; AI will not guess direction."));

  return <CockpitPanel className="overviewAiRead" region="ai-market-read" title={t("AI 市场判断", "AI Market Read")} meta={t("只解释证据，不替代风控", "Evidence read; risk controls remain authoritative")}>
    <div className="overviewAiLead">
      <GaugeChart value={confidence == null ? null : Math.round(confidence)} label={t("置信度", "confidence")} tone="positive" ariaLabel={confidence == null ? t("AI 置信度不可用", "AI confidence unavailable") : `${t("AI 置信度", "AI confidence")} ${Math.round(confidence)}%`}/>
      <div><small>{t("趋势判断", "Directional read")}</small><b>{localizeText(global.label || t("等待行情形成判断", "Awaiting market evidence"))}</b><span>{market?.symbol || t("行情尚未同步", "Market data not synced")}</span></div>
    </div>
    <div className="overviewAiFacts">
      <span><TrendingUp/><small>{t("趋势结构", "Trend structure")}</small><b>{localizeText(global.label || t("不可用", "Unavailable"))}</b></span>
      <span><Target/><small>{t("参考价格", "Reference price")}</small><b>{finite(market?.price ?? market?.last) ? money(market.price ?? market.last) : "—"}</b></span>
      <span><AlertTriangle/><small>{t("事件窗口", "Event window")}</small><b>{localizeText(marketNotice?.title || (marketNoticeState === "loaded" ? t("暂无高影响事件", "No high-impact event") : t("事件来源不可用", "Event source unavailable")))}</b></span>
    </div>
    <div className="overviewAiSummary"><Sparkles/><p>{summary}</p></div>
    <button type="button" className="cockpitSecondaryButton" onClick={onOpen}><Bot/>{t("查看详细分析", "Open detailed analysis")}<ChevronRight/></button>
  </CockpitPanel>;
}

function PortfolioAllocation({ rows, hasPositions, onOpen }) {
  const safeRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : [];
  const sorted = safeRows.filter((row) => finite(row.notionalUsdt) && Number(row.notionalUsdt) > 0).sort((a, b) => Number(b.notionalUsdt) - Number(a.notionalUsdt));
  const total = sorted.reduce((sum, row) => sum + Number(row.notionalUsdt), 0);
  const segments = sorted.map((row, index) => ({ value: Number(row.notionalUsdt), color: allocationColors[index % allocationColors.length] }));

  return <CockpitPanel className="overviewAllocation" region="portfolio-allocation" title={t("持仓概览", "Portfolio allocation")} meta={hasPositions ? t(`${safeRows.length} 个真实持仓`, `${safeRows.length} live positions`) : t("当前空仓", "Currently flat")} action={<button type="button" className="cockpitTextButton" onClick={onOpen}>{t("查看全部", "View all")}<ChevronRight/></button>}>
    {sorted.length ? <div className="overviewAllocationBody">
      <DonutChart segments={segments} value={money(total, "—")} label="USDT" ariaLabel={t("按名义价值计算的持仓分配", "Position allocation by notional value")}/>
      <div className="overviewAllocationRows">{sorted.slice(0, 4).map((row, index) => <article key={row.id || row.positionId || row.instId || row.symbol}>
        <i style={{ background: allocationColors[index % allocationColors.length] }} aria-hidden="true"/>
        <span><b>{row.symbol || t("未命名持仓", "Unnamed position")}</b><small>{humanize(row.direction || row.side, "—")} · {total ? `${(Number(row.notionalUsdt) / total * 100).toFixed(1)}%` : "—"}</small></span>
        <strong className={finite(row.unrealizedPnl ?? row.pnl) ? `${Number(row.unrealizedPnl ?? row.pnl) >= 0 ? "positiveText" : "negativeText"}` : ""}>{finite(row.unrealizedPnl ?? row.pnl) ? `${signedMoney(row.unrealizedPnl ?? row.pnl)} U` : "—"}</strong>
      </article>)}</div>
    </div> : <CockpitEmpty icon={WalletCards} title={hasPositions ? t("名义价值不可用", "Allocation unavailable") : t("当前空仓", "Currently flat")} detail={hasPositions ? t("持仓存在，但快照未提供可计算的名义价值。", "Positions exist, but their notionals are unavailable in this snapshot.") : t("真实持仓出现后，将按名义价值显示组合分配。", "Allocation by notional value appears when live positions exist.")}/>}
  </CockpitPanel>;
}

function RecentTrades({ rows, onOpen }) {
  const safeRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : [];
  return <CockpitPanel className="overviewRecentTrades" region="recent-trades" title={t("近期交易流水", "Recent trade flow")} meta={`${safeRows.length} ${t("条真实记录", "real records")}`} action={<button type="button" className="cockpitTextButton" onClick={onOpen}>{t("查看全部", "View all")}<ChevronRight/></button>}>
    <CockpitTable compact label={t("近期交易流水", "Recent trade flow")} rows={safeRows.slice(0, 5)} emptyTitle={t("暂无交易活动", "No trade activity")} emptyDetail={t("真实成交或委托出现后会自动显示。", "Live fills and orders appear automatically.")} columns={[
      { key: "time", label: t("时间", "Time"), render: (row) => formatTime(row.createdAt || row.updatedAt || row.completedAt) },
      { key: "type", label: t("类型", "Type"), render: (row) => <Tone tone={row.recordType === "fill" ? "positive" : "neutral"}>{row.recordType === "fill" ? t("成交", "Fill") : humanize(row.type || row.orderType, t("委托", "Order"))}</Tone> },
      { key: "symbol", label: t("交易对", "Pair") },
      { key: "side", label: t("方向", "Side"), render: (row) => <Tone tone={sideTone(row.side || row.direction)}>{humanize(row.side || row.direction, "—")}</Tone> },
      { key: "quantity", label: t("数量", "Qty"), render: (row) => row.quantity ?? row.size ?? row.fillSz ?? "—" },
      { key: "price", label: t("均价", "Avg price"), render: (row) => money(row.price ?? row.fillPx) },
      { key: "status", label: t("状态", "Status"), render: (row) => <Tone tone={statusTone(row.status || (row.recordType === "fill" ? "filled" : ""))}>{humanize(row.status || (row.recordType === "fill" ? "filled" : "recorded"), t("已记录", "Recorded"))}</Tone> }
    ]}/>
  </CockpitPanel>;
}

function AgentActivity({ rows, state }) {
  const safeRows = Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object") : [];
  return <CockpitPanel className="overviewAgentActivity" region="agent-activity" title={t("系统与 Agent 活动", "System & Agent activity")} meta={t("真实运行轨迹", "Live runtime trace")}>
    {safeRows.length ? <div className="overviewActivityRows">{safeRows.slice(0, 4).map((row, index) => <article key={row.id || index}>
      <span className={`overviewActivityDot ${statusTone(row.status)}`} aria-hidden="true"/>
      <div><b>{localizeText(row.service || row.handler || row.name || row.goal || t("系统任务", "System task"))}</b><small>{localizeText(row.goal || row.detail || row.name || t("运行事实已记录", "Runtime fact recorded"))}</small></div>
      <time>{formatDateTime(row.completedAt || row.updatedAt || row.createdAt || row.startedAt)}</time>
      <Tone tone={statusTone(row.status)}>{humanize(row.status, t("已记录", "Recorded"))}</Tone>
    </article>)}</div> : <CockpitEmpty icon={Clock3} title={state === "loaded" ? t("暂无运行轨迹", "No runtime trace") : t("运行轨迹不可用", "Runtime trace unavailable")} detail={state === "loaded" ? t("Agent 或系统任务运行后会在这里出现。", "Agent and system runs appear here when they execute.") : t("驾驶舱快照未提供 Agent 或任务运行集合。", "The Cockpit snapshot does not include Agent or job runs.")}/>}
  </CockpitPanel>;
}

function StrategyFooter({ model, data, onOpen }) {
  const health = overviewHealth(data);
  const productSummary = model.collectionState.strategyProducts === "loaded"
    ? model.strategyProducts.length
      ? t(`${model.strategyProducts.length} 个策略产品已登记`, `${model.strategyProducts.length} strategy products registered`)
      : t("尚无已登记策略产品", "No strategy product registered")
    : t("策略目录未包含在驾驶舱快照", "Strategy registry unavailable in Cockpit snapshot");
  const riskSummary = model.collectionState.riskRules === "loaded"
    ? String(model.activeRiskRuleCount)
    : t("不可用", "Unavailable");
  return <footer className="overviewStrategyFooter" data-cockpit-region="strategy-footer">
    <span><ShieldCheck/><small>{t("当前策略组合", "Current strategy portfolio")}</small><b>{productSummary}</b></span>
    <span><Activity/><small>{t("运行状态", "Runtime status")}</small><b>{health.label}</b></span>
    <span><Target/><small>{t("风控边界", "Risk boundary")}</small><b>{riskSummary}</b></span>
    <button type="button" onClick={onOpen}>{t("打开策略库", "Open strategy registry")}<ChevronRight/></button>
  </footer>;
}

function OverviewResourceState({ state, onRetry, retainsFacts = false }) {
  const content = {
    not_loaded: [t("驾驶舱尚未加载", "Cockpit not loaded"), t("打开驾驶舱后会请求真实账户与市场事实。", "Real account and market facts load when the Cockpit opens.")],
    loading: [t("驾驶舱正在加载", "Loading Cockpit"), retainsFacts ? t("下方保留上一份有效事实；当前图表等待刷新完成。", "The last valid facts remain below; the current chart waits for refresh.") : t("正在读取当前账户与市场事实，空白不代表数据为零。", "Loading current account and market facts; blank values do not mean zero.")],
    error: [t("驾驶舱加载失败", "Cockpit failed to load"), t("当前事实不可用，请重试驾驶舱请求。", "Current facts are unavailable. Retry the Cockpit request.")],
    failed: [t("驾驶舱加载失败", "Cockpit failed to load"), t("当前事实不可用，请重试驾驶舱请求。", "Current facts are unavailable. Retry the Cockpit request.")],
    stale: [t("驾驶舱数据已陈旧", "Cockpit data is stale"), t("下方保留最后有效事实；当前图表不会重新请求。", "The last valid facts remain below; the current chart is not requested.")],
    degraded: [t("驾驶舱服务降级", "Cockpit service degraded"), t("部分事实不可用；下方只保留最后有效内容。", "Some facts are unavailable; only last-valid content remains below.")],
    forbidden: [t("驾驶舱需要权限", "Cockpit permission required"), t("当前身份无权读取这组交易事实。", "The current identity cannot read these trading facts.")],
    disabled: [t("驾驶舱已停用", "Cockpit disabled"), t("当前环境未启用交易驾驶舱数据源。", "The Trading Cockpit data source is disabled in this environment.")]
  }[state] || [t("驾驶舱状态不可用", "Cockpit state unavailable"), t("当前资源状态无法确认。", "The current resource state cannot be confirmed.")];
  return <section className={`overviewResourceState ${state}`} data-overview-resource-state={state} role={["error", "failed"].includes(state) ? "alert" : "status"}>
    <AlertTriangle aria-hidden="true"/>
    <div><b>{content[0]}</b><span>{content[1]}</span></div>
    {["error", "failed", "stale", "degraded"].includes(state) && <button type="button" onClick={onRetry}>{t("重新加载", "Reload")}</button>}
  </section>;
}

export function OverviewPage({ data, ui }) {
  const model = buildOverviewPresentation(data);
  const retainsLastValid = ["stale", "degraded"].includes(model.resourceState) || (model.resourceState === "loading" && model.hasLastValidFacts);
  const blocked = ["not_loaded", "error", "failed", "forbidden", "disabled"].includes(model.resourceState) || (model.resourceState === "loading" && !model.hasLastValidFacts);
  const reload = () => ui?.ensureSection?.("cockpit", { force: true }) ?? ui?.refresh?.(true);
  if (blocked) return <div className="cockpitPage cockpitOverview" data-cockpit-page="overview" data-resource-state={model.resourceState}>
    <OverviewResourceState state={model.resourceState} onRetry={reload}/>
  </div>;
  return <div className="cockpitPage cockpitOverview" data-cockpit-page="overview" data-resource-state={model.resourceState}>
    {retainsLastValid && <OverviewResourceState state={model.resourceState} onRetry={reload} retainsFacts/>}
    <PortfolioHero model={model} data={data}/>
    <DualNotice system={model.systemNotice} market={model.marketNotice} states={model.collectionState} ui={ui}/>
    <div className="overviewGrid">
      <section className="overviewPrimary" aria-label={t("市场与交易", "Market and trading")}>
        <OverviewMarket model={model} onOpen={() => ui.setActive("market")}/>
        <RecentTrades rows={model.tradeFlow} onOpen={() => ui.setActive("tradeLedger")}/>
      </section>
      <aside className="overviewRail" aria-label={t("市场判断与组合状态", "Market read and portfolio state")}>
        <AiMarketRead model={model.aiRead} market={model.market} marketNotice={model.marketNotice} marketNoticeState={model.collectionState.marketNotice} onOpen={() => ui.setActive("chat")}/>
        <PortfolioAllocation rows={model.allocation} hasPositions={model.hasPositions} onOpen={() => ui.setActive("positions")}/>
        <AgentActivity rows={model.activities} state={model.collectionState.activities}/>
      </aside>
    </div>
    <StrategyFooter model={model} data={data} onOpen={() => ui.setActive("strategyLib")}/>
  </div>;
}
