import React from "react";
import {
  AlertTriangle, CheckCircle2, Gauge, Layers3, ShieldCheck, WalletCards
} from "lucide-react";
import { displayMoney, formatDateTime, humanize } from "../lib.jsx";
import { t } from "../i18n.js";
import { executionExitAction, requestExecutionExit } from "../executionExit.js";
import { buildPositionPresentation } from "./model.js";
import { CockpitEmpty, CockpitMetric, CockpitPanel, Tone } from "./shared.jsx";
import { AreaTrend, DistributionPlot, DonutChart, GaugeChart } from "./visuals.jsx";

const RESOURCE_STATES = new Set(["not_loaded", "loading", "loaded", "stale", "degraded", "error", "failed", "forbidden", "disabled"]);
const ALLOCATION_COLORS = ["#ee7026", "#31302d", "#5a9e7c", "#df554d", "#d88a22", "#8f867d"];

const list = (value) => Array.isArray(value) ? value : [];
const finite = (value) => value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "") && Number.isFinite(Number(value));
const numeric = (value) => finite(value) ? Number(value) : null;
const identity = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const money = (value, fallback = t("不可用", "Unavailable")) => finite(value) ? displayMoney(Number(value), 2, fallback) : fallback;
const signedMoney = (value) => finite(value) ? `${Number(value) >= 0 ? "+" : ""}${displayMoney(Number(value), 2)}` : t("不可用", "Unavailable");
const percent = (value) => finite(value) ? `${Number(value).toFixed(1)}%` : t("不可用", "Unavailable");
const sideTone = (value) => /short|sell|空|卖/i.test(String(value || "")) ? "negative" : /long|buy|多|买/i.test(String(value || "")) ? "positive" : "neutral";

function resourceStateOf(data) {
  const state = String(data?.resourceState?.cockpit || "").trim().toLowerCase();
  if (state === "ready") return "loaded";
  return RESOURCE_STATES.has(state) ? state : "not_loaded";
}

function validPositions(model) {
  return list(model?.positions).filter((row) => row && typeof row === "object" && identity(row.id));
}

function completeTotal(rows, valueOf) {
  if (!rows.length) return null;
  const values = rows.map(valueOf).map(numeric);
  return values.every((value) => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
}

function uniqueExecutionFor(position, executionOrders) {
  const executionOrderId = identity(position.executionOrderId);
  const positionId = identity(position.positionId);
  const candidates = list(executionOrders).filter((row) => row && typeof row === "object");
  const matches = executionOrderId
    ? candidates.filter((row) => identity(row.id) === executionOrderId)
    : positionId
      ? candidates.filter((row) => identity(row.positionId) === positionId)
      : [];
  if (matches.length !== 1) return null;
  const match = matches[0];
  return identity(match.id) ? match : null;
}

function allocationRows(positions) {
  const grouped = new Map();
  for (const row of positions) {
    const symbol = identity(row.symbol ?? row.instId);
    const value = numeric(row.notionalUsdt);
    if (!symbol || value === null || value <= 0) continue;
    grouped.set(symbol, (grouped.get(symbol) || 0) + Math.abs(value));
  }
  return [...grouped].map(([symbol, value]) => ({ symbol, value })).sort((a, b) => b.value - a.value);
}

function PositionResourceState({ state, retainsFacts, onRetry }) {
  const content = {
    not_loaded: [t("持仓尚未加载", "Positions not loaded"), t("打开持仓页后会读取真实账户与保护事实。", "Live account and protection facts load when Positions opens.")],
    loading: [t("持仓正在加载", "Loading positions"), retainsFacts ? t("下方保留上一份有效事实；当前操作已暂停。", "Last-valid facts remain below; current actions are paused.") : t("正在读取账户事实，空白不代表数值为零。", "Reading account facts; blank values do not mean zero.")],
    stale: [t("持仓数据已陈旧", "Position data is stale"), t("下方保留最后有效事实；退出操作等待刷新后恢复。", "Last-valid facts remain below; exit actions resume after refresh.")],
    degraded: [t("持仓服务降级", "Position service degraded"), t("只展示仍可验证的最后有效事实，当前操作已暂停。", "Only verifiable last-valid facts remain visible; current actions are paused.")],
    error: [t("持仓加载失败", "Positions failed to load"), t("当前账户事实不可用，请重新加载。", "Current account facts are unavailable. Reload to retry.")],
    failed: [t("持仓加载失败", "Positions failed to load"), t("当前账户事实不可用，请重新加载。", "Current account facts are unavailable. Reload to retry.")],
    forbidden: [t("持仓需要权限", "Position permission required"), t("当前身份无权读取这组账户与保护事实。", "The current identity cannot read these account and protection facts.")],
    disabled: [t("持仓数据源已停用", "Position source disabled"), t("当前环境未启用交易驾驶舱持仓数据源。", "The Trading Cockpit position source is disabled in this environment.")]
  }[state] || [t("持仓状态不可用", "Position state unavailable"), t("当前资源状态无法确认。", "The current resource state cannot be confirmed.")];
  return <section className={`positionResourceState ${state}`} data-position-resource-state={state} role={["error", "failed"].includes(state) ? "alert" : "status"}>
    <AlertTriangle aria-hidden="true"/>
    <div><b>{content[0]}</b><span>{content[1]}</span></div>
    {["error", "failed", "stale", "degraded"].includes(state) && <button type="button" onClick={onRetry}>{t("重新加载", "Reload")}</button>}
  </section>;
}

function PositionHero({ positions, portfolio, risk, totals, snapshots }) {
  const availableMargin = numeric(portfolio?.availableMarginUsdt);
  const utilization = numeric(risk?.utilizationPct) ?? (numeric(portfolio?.totalEquityUsdt) > 0 && totals.margin !== null
    ? Math.max(0, Math.min(100, totals.margin / Number(portfolio.totalEquityUsdt) * 100))
    : null);
  const leverageValues = positions.map((row) => numeric(row.leverage));
  const averageLeverage = positions.length && leverageValues.every((value) => value !== null)
    ? leverageValues.reduce((sum, value) => sum + value, 0) / leverageValues.length
    : null;
  const trend = snapshots.map((row) => row.totalEquityUsdt);
  const tone = utilization === null ? "neutral" : utilization > 70 ? "warning" : "positive";
  return <section className="positionHeroV2" data-cockpit-region="position-hero">
    {trend.length >= 2 && <div className="positionHeroTrend" aria-hidden="true"><AreaTrend values={trend} tone="brand" label={t("账户快照趋势", "Account snapshot trend")}/></div>}
    <div className="positionHeroIdentity">
      <small>{t("总持仓价值", "Total position value")}</small>
      <b>{positions.length && totals.notional !== null ? `${money(totals.notional)} USDT` : positions.length ? t("不可用", "Unavailable") : t("当前空仓", "Currently flat")}</b>
      <span>{positions.length ? t(`${positions.length} 个已登记持仓`, `${positions.length} registered positions`) : t("没有活动持仓", "No active positions")}</span>
    </div>
    <div className="positionHeroMetrics">
      <CockpitMetric label={t("未实现盈亏", "Unrealized PnL")} value={totals.pnl === null ? t("不可用", "Unavailable") : `${signedMoney(totals.pnl)} U`} tone={totals.pnl === null ? "" : totals.pnl >= 0 ? "positive" : "negative"}/>
      <CockpitMetric label={t("保证金占用", "Margin used")} value={totals.margin === null ? t("不可用", "Unavailable") : `${money(totals.margin)} U`} detail={percent(utilization)}/>
      <CockpitMetric label={t("可用保证金", "Available margin")} value={availableMargin === null ? t("不可用", "Unavailable") : `${money(availableMargin)} U`}/>
      <CockpitMetric label={t("平均杠杆", "Average leverage")} value={averageLeverage === null ? t("不可用", "Unavailable") : `${averageLeverage.toFixed(2)}x`}/>
    </div>
    <div className="positionHeroRisk"><Tone tone={tone}>{utilization === null ? t("风险待同步", "Risk pending") : utilization > 70 ? t("保证金占用偏高", "High margin usage") : t("风险占用正常", "Risk usage normal")}</Tone><small>{t("仅依据可验证保证金输入", "From verifiable margin inputs only")}</small></div>
  </section>;
}

function AccountConstraints({ data, positions, utilization }) {
  const account = list(data.exchangeAccounts).find((row) => row && typeof row === "object") || null;
  const modes = [...new Set(positions.map((row) => identity(row.marginMode ?? row.mgnMode)).filter(Boolean))];
  const updatedAt = positions.map((row) => row.updatedAt ?? row.rawSyncedAt).find(Boolean) ?? data.portfolio?.updatedAt;
  const constraints = [
    [t("账户类型", "Account type"), account?.accountType ?? account?.mode],
    [t("保证金模式", "Margin mode"), modes.length === 1 ? humanize(modes[0]) : modes.length > 1 ? t("混合", "Mixed") : null],
    [t("剩余日亏损额度", "Remaining daily loss"), finite(data.system?.remainingDailyLossUsdt) ? `${money(data.system.remainingDailyLossUsdt)} U` : null],
    [t("风险使用率", "Risk utilization"), finite(utilization) ? percent(utilization) : null],
    [t("更新时间", "Updated"), updatedAt ? formatDateTime(updatedAt) : null]
  ];
  return <section className="positionConstraints" data-cockpit-region="account-constraints" aria-label={t("账户约束", "Account constraints")}>
    {constraints.map(([label, value]) => <span key={label}><small>{label}</small><b>{value ?? t("不可用", "Unavailable")}</b></span>)}
  </section>;
}

function PositionAllocation({ rows, total, hasPositions, complete }) {
  const segments = rows.map((row, index) => ({ value: row.value, color: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }));
  return <CockpitPanel className="positionAllocationPanel" region="position-allocation" title={t("持仓分布", "Position allocation")} meta={t("按真实名义价值", "By live notional")}>
    {!hasPositions ? <CockpitEmpty icon={WalletCards} title={t("当前空仓，暂无持仓分布", "Currently flat; no position allocation")}/> : !complete ? <CockpitEmpty icon={WalletCards} title={t("持仓分布不完整", "Position allocation incomplete")} detail={t("部分持仓缺少正数名义价值，无法计算完整权重。", "Some positions lack positive notional, so complete weights are unavailable.")}/> : <div className="positionAllocationBody">
      <DonutChart segments={segments} value={money(total)} label="USDT" ariaLabel={t("按名义价值计算的持仓分布", "Position allocation by notional")}/>
      <div className="positionAllocationRows">{rows.slice(0, 6).map((row, index) => <span key={row.symbol}><i style={{ background: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }}/><b>{row.symbol}</b><em>{(row.value / total * 100).toFixed(1)}%</em><small>{money(row.value)} U</small></span>)}</div>
    </div>}
  </CockpitPanel>;
}

function LongShort({ positions, complete }) {
  const known = complete ? positions.map((row) => ({ tone: sideTone(row.direction ?? row.side ?? row.posSide), value: numeric(row.notionalUsdt) })) : [];
  const long = known.filter((row) => row.tone === "positive").reduce((sum, row) => sum + row.value, 0);
  const short = known.filter((row) => row.tone === "negative").reduce((sum, row) => sum + row.value, 0);
  const total = long + short;
  return <CockpitPanel className="positionLongShort" region="long-short" title={t("多空分布", "Long / short")} meta={t("按名义价值", "By notional")}>
    {!positions.length ? <CockpitEmpty icon={Layers3} title={t("当前空仓，暂无方向敞口", "Currently flat; no directional exposure")}/> : !complete ? <CockpitEmpty icon={Layers3} title={t("多空分布不完整", "Long / short distribution incomplete")} detail={t("部分持仓缺少正数名义价值或有效方向。", "Some positions lack positive notional or a valid side.")}/> : <div className="positionLongShortBody"><div><span style={{ width: `${long / total * 100}%` }}/><i style={{ width: `${short / total * 100}%` }}/></div><p><span><small>{t("多头", "Long")}</small><b className="positiveText">{(long / total * 100).toFixed(1)}%</b></span><span><small>{t("空头", "Short")}</small><b className="negativeText">{(short / total * 100).toFixed(1)}%</b></span></p></div>}
  </CockpitPanel>;
}

function PnlDistribution({ positions }) {
  const values = positions.map((row) => numeric(row.unrealizedPnl ?? row.pnl ?? row.upl)).filter((value) => value !== null);
  const winners = values.filter((value) => value > 0).length;
  const losers = values.filter((value) => value < 0).length;
  return <CockpitPanel className="positionPnlDistribution" region="pnl-distribution" title={t("持仓盈亏分布", "Position PnL distribution")} meta={t("未实现盈亏 · USDT", "Unrealized PnL · USDT")}>
    {values.length ? <><DistributionPlot values={values} label={t("真实持仓未实现盈亏分布", "Live position unrealized PnL distribution")} formatValue={(value) => `${signedMoney(value)} USDT`}/><div className="positionPnlLegend"><span><b className="positiveText">{winners}</b><small>{t("盈利", "Profitable")}</small></span><span><b>{values.filter((value) => value === 0).length}</b><small>{t("持平", "Flat")}</small></span><span><b className="negativeText">{losers}</b><small>{t("亏损", "Losing")}</small></span></div></> : <CockpitEmpty icon={Gauge} title={t("盈亏数据不可用", "PnL data unavailable")}/>}
  </CockpitPanel>;
}

function PositionTable({ positions, executionOrders, action, actionsEnabled }) {
  if (!positions.length) return <CockpitPanel className="positionTablePanel" region="position-table" title={t("当前持仓", "Current positions")} meta={t("实时账户事实", "Live account facts")}>
    <CockpitEmpty icon={WalletCards} title={t("暂无持仓", "No positions")} detail={t("当前账户空仓；系统不会生成演示仓位。", "The account is flat; the system does not invent demo positions.")}/>
  </CockpitPanel>;
  return <CockpitPanel className="positionTablePanel" region="position-table" title={t("当前持仓", "Current positions")} meta={t(`${positions.length} 个真实对象`, `${positions.length} live objects`)}>
    <div className="positionTableScroll"><table className="positionDetailTable" aria-label={t("当前持仓与保护事实", "Current positions and protection facts")}>
      <thead><tr><th>{t("交易对 / 方向", "Pair / side")}</th><th>{t("规模", "Size")}</th><th>{t("开仓价", "Entry")}</th><th>{t("标记价", "Mark")}</th><th>{t("未实现盈亏", "Unrealized PnL")}</th><th>{t("杠杆", "Lev")}</th><th>{t("强平价", "Liquidation")}</th><th>{t("保证金", "Margin")}</th><th>{t("操作", "Action")}</th></tr></thead>
      {positions.map((row) => {
        const rowId = identity(row.id);
        const execution = uniqueExecutionFor(row, executionOrders);
        const exit = actionsEnabled && execution && executionExitAction(execution);
        const stop = numeric(row.stopLoss);
        const targets = list(row.takeProfits).map(numeric).filter((value) => value !== null);
        const pnl = numeric(row.unrealizedPnl ?? row.pnl ?? row.upl);
        const marginRatio = numeric(row.marginRatio ?? row.marginRatioPct);
        return <tbody key={rowId} data-position-id={rowId} data-execution-id={identity(execution?.id) ?? undefined}>
          <tr className="positionPrimaryRow">
            <td><span className="positionSymbol"><b>{identity(row.symbol ?? row.instId) ?? t("不可用", "Unavailable")}</b><Tone tone={sideTone(row.direction ?? row.side ?? row.posSide)}>{humanize(row.direction ?? row.side ?? row.posSide, t("方向不可用", "Side unavailable"))}</Tone><small>{row.source === "execution_engine" ? t("AI 托管", "AI-managed") : t("外部 / 手动", "External / manual")}</small></span></td>
            <td>{finite(row.quantity ?? row.size ?? row.pos ?? row.qty) ? String(row.quantity ?? row.size ?? row.pos ?? row.qty) : t("不可用", "Unavailable")}</td>
            <td>{money(row.entryPrice ?? row.entry)}</td>
            <td>{money(row.markPrice ?? row.mark)}</td>
            <td><strong className={pnl === null ? "" : pnl >= 0 ? "positiveText" : "negativeText"}>{pnl === null ? t("不可用", "Unavailable") : `${signedMoney(pnl)} U`}</strong></td>
            <td>{finite(row.leverage) ? `${Number(row.leverage)}x` : t("不可用", "Unavailable")}</td>
            <td>{money(row.liquidationPrice ?? row.liqPx)}</td>
            <td>{finite(row.margin ?? row.initialMargin) ? `${money(row.margin ?? row.initialMargin)} U` : t("不可用", "Unavailable")}</td>
            <td>{exit ? <button type="button" className="positionExitButton" data-position-exit data-execution-id={identity(execution.id)} onClick={() => requestExecutionExit(action, execution, "manual_ui")}>{exit.label}</button> : <span className="positionNoAction">{t("无可用操作", "No available action")}</span>}</td>
          </tr>
          <tr className="positionProtectionRow"><td colSpan="9"><div>
            <span><small>{t("止损", "Stop loss")}</small><b>{stop === null ? t("未登记", "Not registered") : money(stop)}</b></span>
            <span><small>{t("止盈", "Take profit")}</small><b>{targets.length ? targets.map((value) => money(value)).join(" / ") : t("未登记", "Not registered")}</b></span>
            <span><small>{t("保证金率", "Margin ratio")}</small><b>{percent(marginRatio)}</b></span>
            <span><small>{t("对象身份", "Object identity")}</small><b>{rowId}</b></span>
          </div></td></tr>
        </tbody>;
      })}
    </table></div>
  </CockpitPanel>;
}

function PortfolioTrend({ snapshots }) {
  const values = snapshots.map((row) => row.totalEquityUsdt);
  return <CockpitPanel className="positionTrendPanel" region="portfolio-pnl-trend" title={t("组合盈亏趋势", "Portfolio PnL trend")} meta={t("真实账户净值快照", "Live account-equity snapshots")}>
    {values.length >= 2 ? <AreaTrend values={values} tone={values.at(-1) >= values[0] ? "positive" : "negative"} label={t("按时间排序的账户净值趋势", "Chronological account equity trend")} height={128}/> : <CockpitEmpty icon={Layers3} title={t("趋势数据不足", "Insufficient trend data")} detail={t("至少需要两个带时间的真实账户快照。", "At least two timestamped live account snapshots are required.")}/>}
  </CockpitPanel>;
}

function RiskHealth({ positions, utilization }) {
  const distances = positions.map((row) => numeric(row.liqDistancePct)).filter((value) => value !== null);
  const minimumDistance = distances.length ? Math.min(...distances) : null;
  const safety = utilization === null ? null : Math.max(0, 100 - utilization);
  return <CockpitPanel className="positionRiskHealth" region="risk-health" title={t("风险健康", "Risk health")} meta={t("可验证输入", "Verifiable inputs")}>
    <div className="positionRiskHealthBody"><GaugeChart value={safety} label={t("保证金余量", "Margin headroom")} ariaLabel={t("基于风险使用率的保证金余量", "Margin headroom from risk utilization")}/><div>
      <span><CheckCircle2/><small>{t("已登记持仓", "Registered positions")}</small><b>{positions.length || t("空仓", "Flat")}</b></span>
      <span><ShieldCheck/><small>{t("最近强平距离", "Nearest liquidation distance")}</small><b>{percent(minimumDistance)}</b></span>
      <span><Gauge/><small>{t("风险使用率", "Risk utilization")}</small><b>{percent(utilization)}</b></span>
    </div></div>
  </CockpitPanel>;
}

function MarginSafety({ utilization, positions }) {
  const safety = utilization === null ? null : Math.max(0, 100 - utilization);
  const nearest = positions.map((row) => numeric(row.liqDistancePct)).filter((value) => value !== null).sort((a, b) => a - b)[0] ?? null;
  return <CockpitPanel className="positionMarginSafety" region="margin-safety" title={t("保证金安全", "Margin safety")}>
    <div className="positionMarginSafetyBody"><strong className={safety !== null && safety < 30 ? "negativeText" : "positiveText"}>{percent(safety)}</strong><span>{safety === null ? null : <i style={{ width: `${safety}%` }}/>}</span><dl><div><dt>{t("风险使用", "Risk used")}</dt><dd>{percent(utilization)}</dd></div><div><dt>{t("强平距离", "Liq distance")}</dt><dd>{percent(nearest)}</dd></div></dl></div>
  </CockpitPanel>;
}

function Concentration({ rows, total, positions, complete }) {
  const top = rows[0] ?? null;
  const topThree = total && rows.length ? rows.slice(0, 3).reduce((sum, row) => sum + row.value, 0) / total * 100 : null;
  const long = complete ? positions.filter((row) => sideTone(row.direction ?? row.side ?? row.posSide) === "positive").reduce((sum, row) => sum + numeric(row.notionalUsdt), 0) : null;
  const short = complete ? positions.filter((row) => sideTone(row.direction ?? row.side ?? row.posSide) === "negative").reduce((sum, row) => sum + numeric(row.notionalUsdt), 0) : null;
  const balance = long > 0 && short > 0 ? Math.max(long, short) / Math.min(long, short) : null;
  return <CockpitPanel className="positionConcentration" region="concentration" title={t("集中度", "Concentration")}>
    {!positions.length ? <CockpitEmpty icon={ShieldCheck} title={t("空仓，无集中度风险", "Flat; no concentration risk")}/> : !complete ? <CockpitEmpty icon={ShieldCheck} title={t("集中度数据不完整", "Concentration data incomplete")} detail={t("部分持仓缺少正数名义价值或有效方向。", "Some positions lack positive notional or a valid side.")}/> : <div className="positionConcentrationBody"><span><small>{t("最大持仓", "Largest position")}</small><b>{top.symbol}</b><em>{(top.value / total * 100).toFixed(1)}%</em></span><span><small>{t("前三持仓", "Top three")}</small><b>{percent(topThree)}</b></span><span><small>{t("多空比", "Long / short ratio")}</small><b>{finite(balance) ? Number(balance).toFixed(2) : t("不可用", "Unavailable")}</b></span></div>}
  </CockpitPanel>;
}

export function PositionsPage({ data = {}, action, ui = {} }) {
  const model = buildPositionPresentation(data);
  const positions = validPositions(model);
  const state = resourceStateOf(data);
  const snapshots = list(data.accountSnapshots).filter((row) => row && typeof row === "object" && finite(row.totalEquityUsdt) && !Number.isNaN(new Date(row.createdAt ?? row.updatedAt).getTime())).sort((a, b) => new Date(a.createdAt ?? a.updatedAt) - new Date(b.createdAt ?? b.updatedAt));
  const portfolio = data.portfolio && typeof data.portfolio === "object" ? data.portfolio : {};
  const risk = data.portfolioRisk && typeof data.portfolioRisk === "object" ? data.portfolioRisk : {};
  const totals = {
    notional: completeTotal(positions, (row) => row.notionalUsdt),
    pnl: completeTotal(positions, (row) => row.unrealizedPnl ?? row.pnl ?? row.upl),
    margin: completeTotal(positions, (row) => row.margin ?? row.initialMargin)
  };
  const utilization = numeric(risk.utilizationPct) ?? (numeric(portfolio.totalEquityUsdt) > 0 && totals.margin !== null ? Math.max(0, Math.min(100, totals.margin / Number(portfolio.totalEquityUsdt) * 100)) : null);
  const allocations = allocationRows(positions);
  const allocationComplete = positions.length > 0 && positions.every((row) => identity(row.symbol ?? row.instId) && numeric(row.notionalUsdt) > 0);
  const compositionComplete = allocationComplete && positions.every((row) => sideTone(row.direction ?? row.side ?? row.posSide) !== "neutral");
  const hasFacts = positions.length > 0 || snapshots.length > 0 || [portfolio.totalEquityUsdt, portfolio.availableMarginUsdt, risk.utilizationPct].some(finite);
  const retainsFacts = ["stale", "degraded"].includes(state) || (state === "loading" && hasFacts);
  const blocked = ["not_loaded", "error", "failed", "forbidden", "disabled"].includes(state) || (state === "loading" && !hasFacts);
  const reload = () => ui.ensureSection?.("cockpit", { force: true }) ?? ui.refresh?.(true);
  if (blocked) return <div className="cockpitPage cockpitPositionsV2" data-cockpit-page="positions" data-resource-state={state}><PositionResourceState state={state} retainsFacts={false} onRetry={reload}/></div>;
  return <div className="cockpitPage cockpitPositionsV2" data-cockpit-page="positions" data-resource-state={state}>
    {retainsFacts && <PositionResourceState state={state} retainsFacts onRetry={reload}/>}
    <PositionHero positions={positions} portfolio={portfolio} risk={risk} totals={totals} snapshots={snapshots}/>
    <AccountConstraints data={data} positions={positions} utilization={utilization}/>
    <div className="positionWorkspace">
      <aside className="positionAnalytics" aria-label={t("持仓分析", "Position analytics")}>
        <PositionAllocation rows={allocations} total={totals.notional} hasPositions={positions.length > 0} complete={allocationComplete}/>
        <LongShort positions={positions} complete={compositionComplete}/>
        <PnlDistribution positions={positions}/>
      </aside>
      <section className="positionCore" aria-label={t("持仓明细与趋势", "Position details and trend")}>
        <PositionTable positions={positions} executionOrders={data.executionOrders} action={action} actionsEnabled={state === "loaded" && typeof action === "function"}/>
        <PortfolioTrend snapshots={snapshots}/>
      </section>
      <aside className="positionRisk" aria-label={t("风险证据", "Risk evidence")}>
        <RiskHealth positions={positions} utilization={utilization}/>
        <MarginSafety positions={positions} utilization={utilization}/>
        <Concentration rows={allocations} total={totals.notional} positions={positions} complete={compositionComplete}/>
      </aside>
    </div>
  </div>;
}
