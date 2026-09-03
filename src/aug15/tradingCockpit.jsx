import React, { useEffect, useState } from "react";
import {
  AlertTriangle, Check, ChevronRight,
  Clock3, Gauge, ShieldCheck, Sparkles,
  Target, WalletCards
} from "lucide-react";
import { displayMoney, displayPct, formatDateTime, formatTime, humanize, localizeText } from "./lib.jsx";
import { t } from "./i18n.js";
import { executionExitAction, requestExecutionExit } from "./executionExit.js";
import {
  buildLedgerPresentation,
  buildOverviewPresentation,
  buildPositionPresentation,
  buildReviewPresentation,
  buildSelectedExecutionStages
} from "./tradingCockpit/model.js";
import {
  CockpitEmpty,
  CockpitHeader,
  CockpitMetric as Metric,
  CockpitPanel as Panel,
  CockpitTable as DataTable,
  Tone
} from "./tradingCockpit/shared.jsx";
import { AreaTrend as MiniTrend } from "./tradingCockpit/visuals.jsx";
import { OverviewPage } from "./tradingCockpit/OverviewPage.jsx";
import { MarketPage } from "./tradingCockpit/MarketPage.jsx";
import "./tradingCockpit.css";

// Presentation selectors centralize buildPositionView and buildExecutionView joins.

const list = (value) => Array.isArray(value) ? value : [];
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value, fallback = 0) => finite(value) ? Number(value) : fallback;
const money = (value, fallback = "—") => finite(value) ? displayMoney(Number(value), 2, fallback) : fallback;
const signedMoney = (value, fallback = "—") => finite(value) ? `${Number(value) >= 0 ? "+" : ""}${money(value, fallback)}` : fallback;
const signedPct = (value, fallback = "—") => finite(value) ? `${Number(value) >= 0 ? "+" : ""}${Number(value).toFixed(2)}%` : fallback;
const sideTone = (value) => /short|sell|空|卖/i.test(String(value || "")) ? "negative" : /long|buy|多|买/i.test(String(value || "")) ? "positive" : "neutral";
const statusTone = (value) => /fail|error|reject|cancel|liquid|异常|失败|拒绝|取消/i.test(String(value || "")) ? "negative" : /pending|wait|pause|review|待|暂停|警告/i.test(String(value || "")) ? "warning" : /fill|complete|active|success|approved|已|运行/i.test(String(value || "")) ? "positive" : "neutral";

function accountHealth(data) {
  if (data.system?.killSwitch) return [t("紧急停止", "Emergency stop"), "negative"];
  if (data.automationState?.label) return [localizeText(data.automationState.label), statusTone(data.automationState.mode)];
  return [t("交易状态待同步", "Trading state pending"), "neutral"];
}

export function TradingCockpitShell({ data, active, onChange, ui, children }) {
  const [healthLabel, healthTone] = accountHealth(data);
  return <div className="tradingCockpit" data-cockpit-shell="desktop" data-cockpit-view={active}>
    <CockpitHeader data={data} active={active} onChange={onChange} ui={ui} healthLabel={healthLabel} healthTone={healthTone}/>
    <main className="cockpitCanvas">{children}</main>
  </div>;
}

function SystemNotice({ notice, onOpen }) {
  const text = localizeText(notice?.message || notice?.title || t("系统正在等待新的交易事实。", "The system is waiting for new trading facts."));
  return <button type="button" className="cockpitNotice" onClick={onOpen}><span><Sparkles/><b>{t("系统动态", "System update")}</b><p>{text}</p></span><ChevronRight/></button>;
}

function PositionsPage({ data }) {
  const view = buildPositionPresentation(data); const portfolio = data.portfolio || {}; const positions = view.positions;
  const equity = number(portfolio.totalEquityUsdt); const marginPct = equity > 0 ? Math.max(0, Math.min(100, view.marginUsdt / equity * 100)) : null;
  const longNotional = positions.filter((row) => sideTone(row.direction || row.side) === "positive").reduce((sum, row) => sum + row.notionalUsdt, 0);
  const shortNotional = positions.filter((row) => sideTone(row.direction || row.side) === "negative").reduce((sum, row) => sum + row.notionalUsdt, 0);
  const totalDirectional = longNotional + shortNotional;
  const avgLeverage = positions.length ? positions.reduce((sum, row) => sum + number(row.leverage), 0) / positions.length : null;
  return <div className="cockpitPage cockpitPositions" data-cockpit-page="positions">
    <section className="positionHero"><div><small>{t("组合敞口", "Portfolio exposure")}</small><b>{positions.length ? `${money(view.exposureUsdt)} USDT` : t("当前空仓", "Currently flat")}</b><span>{positions.length} {t("个真实持仓", "real positions")}</span></div><div><Metric label={t("未实现盈亏", "Unrealized PnL")} value={positions.length ? `${signedMoney(view.unrealizedPnlUsdt)} U` : "—"} tone={view.unrealizedPnlUsdt >= 0 ? "positive" : "negative"}/><Metric label={t("保证金占用", "Margin used")} value={positions.length ? `${money(view.marginUsdt)} U` : "—"} detail={marginPct == null ? "—" : `${marginPct.toFixed(1)}%`}/><Metric label={t("可用保证金", "Available margin")} value={finite(portfolio.availableMarginUsdt) ? `${money(portfolio.availableMarginUsdt)} U` : "—"}/><Metric label={t("平均杠杆", "Avg leverage")} value={avgLeverage == null ? "—" : `${avgLeverage.toFixed(2)}x`}/></div><Tone tone={marginPct != null && marginPct > 70 ? "warning" : "positive"}>{marginPct == null ? t("风险待同步", "Risk pending") : marginPct > 70 ? t("保证金占用偏高", "High margin usage") : t("风险占用正常", "Risk usage normal")}</Tone></section>
    <div className="positionWorkspace">
      <aside className="positionAllocation"><Panel title={t("资产配置", "Allocation")}><div className="allocationStack">{positions.slice(0, 6).map((row) => { const value = row.notionalUsdt; const pct = view.exposureUsdt ? value / view.exposureUsdt * 100 : 0; return <article key={row.id}><span><b>{row.symbol}</b><em>{pct.toFixed(1)}%</em></span><i><b style={{ width: `${pct}%` }}/></i><small>{money(value)} U</small></article>; })}{!positions.length && <CockpitEmpty icon={WalletCards} title={t("暂无配置", "No allocation")} detail={t("真实持仓出现后展示资产权重。", "Asset weights appear when real positions exist.")}/>}</div></Panel><Panel title={t("多空分布", "Long / short")}><div className="directionSplit"><span><b className="positiveText">{totalDirectional ? `${(longNotional / totalDirectional * 100).toFixed(0)}%` : "—"}</b><small>{t("多头", "Long")}</small></span><span><b className="negativeText">{totalDirectional ? `${(shortNotional / totalDirectional * 100).toFixed(0)}%` : "—"}</b><small>{t("空头", "Short")}</small></span></div></Panel></aside>
      <section className="positionCore"><Panel title={t("持仓明细", "Position detail")} meta={t("AI 托管仓与外部仓保持来源区分", "AI-managed and external positions keep distinct provenance")} region="position-table"><DataTable label={t("持仓明细", "Position detail")} rows={positions} emptyTitle={t("暂无持仓", "No positions")} emptyDetail={t("当前账户空仓；系统不会生成演示仓位。", "The account is flat; the system does not invent demo positions.")} columns={[
        { key: "symbol", label: t("交易对", "Pair"), render: (row) => <span className="symbolCell"><b>{row.symbol}</b><small>{row.source === "execution_engine" ? t("AI 托管", "AI-managed") : t("外部/手动", "External/manual")}</small></span> },
        { key: "direction", label: t("方向", "Side"), render: (row) => <Tone tone={sideTone(row.direction || row.side)}>{humanize(row.direction || row.side)}</Tone> },
        { key: "size", label: t("数量", "Size"), render: (row) => row.quantity ?? row.size ?? row.pos ?? "—" },
        { key: "entry", label: t("开仓均价", "Entry"), render: (row) => money(row.entryPrice ?? row.entry) },
        { key: "mark", label: t("标记价格", "Mark"), render: (row) => money(row.markPrice ?? row.mark) },
        { key: "pnl", label: t("未实现盈亏", "Unrealized"), render: (row) => <strong className={number(row.unrealizedPnl ?? row.pnl) >= 0 ? "positiveText" : "negativeText"}>{signedMoney(row.unrealizedPnl ?? row.pnl)} U</strong> },
        { key: "leverage", label: t("杠杆", "Lev"), render: (row) => finite(row.leverage) ? `${row.leverage}x` : "—" },
        { key: "liq", label: t("强平价", "Liq"), render: (row) => money(row.liquidationPrice) }
      ]}/></Panel><Panel title={t("组合净值趋势", "Portfolio equity trend")} meta={t("真实账户快照", "Real account snapshots")}><MiniTrend values={list(data.accountSnapshots).map((row) => row.totalEquityUsdt)} label={t("组合净值趋势", "Portfolio equity trend")} height={118}/></Panel></section>
      <aside className="positionRisk"><Panel title={t("风险健康", "Risk health")}><div className="healthScore"><div className="allocationRing" style={{ "--value": marginPct == null ? 0 : 100 - marginPct }}><span><b>{marginPct == null ? "—" : `${Math.round(100 - marginPct)}%`}</b><small>{t("健康度", "health")}</small></span></div></div><div className="healthChecks"><span><Check/>{t("持仓事实已核对", "Position facts reconciled")}<b>{positions.length}</b></span><span><ShieldCheck/>{t("强平距离", "Liquidation distance")}<b>{positions.some((row) => finite(row.liqDistancePct) && number(row.liqDistancePct) < 12) ? t("需关注", "Attention") : t("正常", "Normal")}</b></span><span><Gauge/>{t("保证金安全", "Margin safety")}<b>{marginPct == null ? "—" : `${(100 - marginPct).toFixed(1)}%`}</b></span></div></Panel><Panel title={t("集中度", "Concentration")}><div className="riskList">{positions.slice().sort((a, b) => b.notionalUsdt - a.notionalUsdt).slice(0, 3).map((row) => <span key={row.id}><b>{row.symbol}</b><em>{view.exposureUsdt ? `${(row.notionalUsdt / view.exposureUsdt * 100).toFixed(1)}%` : "—"}</em></span>)}{!positions.length && <p className="inlineEmpty">{t("空仓，无集中度风险。", "Flat; no concentration risk.")}</p>}</div></Panel></aside>
    </div>
  </div>;
}

function ReviewPage({ data, initialReviewId, onReviewSelect }) {
  const presentation = buildReviewPresentation(data); const execution = presentation; const reviews = presentation.reviews;
  const [selectedId, setSelectedId] = useState(initialReviewId || reviews[0]?.id || "");
  useEffect(() => { if (initialReviewId) setSelectedId(initialReviewId); }, [initialReviewId]);
  const selected = reviews.find((row) => String(row.id) === String(selectedId)) || reviews[0] || null;
  const pnl = selected?.netPnlUsdt ?? null;
  const performance = presentation.metrics; const behavior = data.behaviorProfile || {};
  const wins = execution.closedTrades.filter((row) => number(row.netRealizedPnl) > 0).length;
  const winRate = finite(performance.winRatePct) ? number(performance.winRatePct) : execution.closedTrades.length ? wins / execution.closedTrades.length * 100 : null;
  const select = (row) => { setSelectedId(row.id); onReviewSelect?.(row.id); };
  return <div className="cockpitPage cockpitReview" data-cockpit-page="execution">
    <header className="reviewTitle"><div><h1>{t("执行与复盘", "Execution & Review")}</h1><p>{t("从真实成交结果追溯决策、执行、风险和改进证据。", "Trace real outcomes back to decisions, execution, risk, and improvement evidence.")}</p></div><Tone tone={reviews.some((row) => !/complete|reflected|done/i.test(String(row.status))) ? "warning" : "positive"}>{reviews.length} {t("笔复盘", "reviews")}</Tone></header>
    <section className="reviewHero"><Metric strong label={t("累计已实现盈亏", "Realized PnL")} value={`${signedMoney(performance.totalPnlUsdt, "0")} USDT`} tone={number(performance.totalPnlUsdt) >= 0 ? "positive" : "negative"}/><Metric label={t("交易胜率", "Win rate")} value={winRate == null ? "—" : `${winRate.toFixed(1)}%`} detail={`${execution.closedTrades.length} ${t("笔已平仓", "closed")}`}/><Metric label={t("盈亏因子", "Profit factor")} value={finite(performance.profitFactor) ? number(performance.profitFactor).toFixed(2) : "—"}/><Metric label={t("平均每笔", "Avg / trade")} value={finite(performance.avgPnlUsdt) ? `${signedMoney(performance.avgPnlUsdt)} U` : "—"}/><Metric label={t("待完成复盘", "Pending review")} value={String(reviews.filter((row) => !/complete|reflected|done/i.test(String(row.status))).length)}/></section>
    <Panel className="reviewConclusion" title={t("AI 复盘结论", "AI review conclusion")} meta={t("从当前筛选范围汇总，不替代单笔证据", "Summarized from the current scope; does not replace trade evidence")}><div><article><Check/><span><b>{t("做得好的", "What worked")}</b><p>{localizeText(behavior.strengths?.[0] || selected?.strengths?.[0] || selected?.whatWorked || t("等待更多已完成复盘形成稳定结论。", "Awaiting more completed reviews for a stable conclusion."))}</p></span></article><article><AlertTriangle/><span><b>{t("需要修正", "Needs attention")}</b><p>{localizeText(behavior.flags?.[0]?.detail || selected?.lesson || selected?.rootCause || t("当前没有足够证据归因重复问题。", "There is not enough evidence to attribute a repeated issue."))}</p></span></article><article><Target/><span><b>{t("下一步优化", "Next improvement")}</b><p>{localizeText(selected?.improvement || selected?.nextAction || selected?.lesson || t("继续积累同类样本，再由 Owner 判断是否发布改进。", "Accumulate comparable samples before Owner decides whether to publish an improvement."))}</p></span></article></div></Panel>
    <div className="reviewWorkbench" data-cockpit-region="review-workbench">
      <Panel title={t("交易列表", "Trades")} meta={`${reviews.length}`} className="reviewIndex"><div className="reviewRows">{reviews.slice(0, 30).map((row) => { const result = row.netPnlUsdt; return <button type="button" key={row.id} className={selected?.id === row.id ? "active" : ""} onClick={() => select(row)}><span><b>{row.symbol || t("组合", "Portfolio")}</b><Tone tone={statusTone(row.status)}>{humanize(row.status)}</Tone></span><strong className={number(result) >= 0 ? "positiveText" : "negativeText"}>{finite(result) ? `${signedMoney(result)} U` : "—"}</strong><small>{formatDateTime(row.completedAt || row.createdAt)}</small><p>{localizeText(row.summary || row.title || t("等待复盘结论", "Awaiting review"))}</p></button>; })}{!reviews.length && <CockpitEmpty icon={Clock3} title={t("暂无交易复盘", "No trade reviews")} detail={t("确认平仓后，交易会自动进入复盘队列。", "Confirmed closes enter the review queue automatically.")}/>}</div></Panel>
      <Panel title={selected ? `${selected.symbol || t("交易", "Trade")} · ${t("复盘详情", "Review detail")}` : t("复盘详情", "Review detail")} meta={selected ? formatDateTime(selected.completedAt || selected.createdAt) : ""} className="reviewDetail">
        {selected ? <><div className="reviewResult"><span><small>{t("净交易结果", "Net result")}</small><b className={number(pnl) >= 0 ? "positiveText" : "negativeText"}>{finite(pnl) ? `${signedMoney(pnl)} USDT` : "—"}</b></span><div><Tone tone={sideTone(selected.direction || selected.side)}>{humanize(selected.direction || selected.side, t("已平仓", "Closed"))}</Tone><Tone tone={statusTone(selected.status)}>{humanize(selected.status)}</Tone></div></div><div className="reviewFacts"><span>{t("归因", "Attribution")}<b>{localizeText(selected.attribution || t("待归因", "Pending"))}</b></span><span>{t("费用", "Fees")}<b>{finite(selected.totalFeeUsdt ?? selected.feesUsdt) ? `${money(selected.totalFeeUsdt ?? selected.feesUsdt)} U` : "—"}</b></span><span>{t("持仓时长", "Hold time")}<b>{selected.holdMinutes ? `${selected.holdMinutes}m` : "—"}</b></span><span>{t("置信度", "Confidence")}<b>{finite(selected.confidence) ? `${selected.confidence}%` : "—"}</b></span></div><div className="reviewNarrative"><section><h3>{t("结果概述", "Outcome")}</h3><p>{localizeText(selected.summary || t("等待成交事实回补与结果汇总。", "Awaiting fill facts and outcome summary."))}</p></section><details open><summary>{t("判断与根因", "Analysis & root cause")}</summary><p>{localizeText(selected.deepReflection || selected.rootCause || selected.notes || t("深度归因仍在队列中。", "Deep attribution is still queued."))}</p></details><details><summary>{t("下一次如何改进", "What changes next time")}</summary><p>{localizeText(selected.improvement || selected.lesson || t("等待形成可执行的改进结论。", "Awaiting an actionable improvement."))}</p></details><details><summary>{t("学习证据", "Learning evidence")}</summary><p>{t("只有后续交易明确采用且达到同类对照样本门槛后，系统才会显示效果证据；写过复盘不等于已经证明有效。", "Effect evidence appears only after later trades explicitly apply the lesson and comparable sample thresholds are met; a written review is not proof of efficacy.")}</p></details></div></> : <CockpitEmpty title={t("选择一笔交易", "Select a trade")} detail={t("在左侧选择真实复盘查看完整证据。", "Select a real review on the left to inspect its evidence.")}/>}
      </Panel>
    </div>
    <div className="reviewBottom"><Panel title={t("收益与持仓分布", "Return & hold distribution")}><MiniTrend values={execution.closedTrades.map((row) => row.netRealizedPnl)} label={t("收益与持仓分布", "Return and hold distribution")} height={96}/></Panel><Panel title={t("行为观察", "Behavior observations")}><div className="behaviorRows">{list(behavior.flags).slice(0, 3).map((flag, index) => <span key={flag.key || index}><AlertTriangle/><b>{localizeText(flag.title || flag.detail)}</b><small>{localizeText(flag.detail)}</small></span>)}{!list(behavior.flags).length && <p className="inlineEmpty">{t("暂无稳定的重复行为模式。", "No stable repeated behavior pattern yet.")}</p>}</div></Panel><Panel title={t("下一步", "Next actions")}><div className="nextActions"><span><Check/><p>{t("继续完成待复盘交易", "Complete pending reviews")}</p></span><span><Check/><p>{t("只在同类样本达标后评估改进", "Evaluate improvements only after comparable samples mature")}</p></span><span><Check/><p>{t("由 Owner 决定是否发布", "Owner decides whether to publish")}</p></span></div></Panel></div>
  </div>;
}

function LedgerPage({ data, action, ui }) {
  const presentation = buildLedgerPresentation(data); const execution = presentation; const orders = execution.orders; const fills = execution.fills; const plans = list(data.tradePlans);
  const [selectedId, setSelectedId] = useState(orders[0]?.id || "");
  useEffect(() => { if (!orders.find((row) => String(row.id) === String(selectedId))) setSelectedId(orders[0]?.id || ""); }, [orders, selectedId]);
  const selected = orders.find((row) => String(row.id) === String(selectedId)) || orders[0] || null;
  const relatedFills = selected ? fills.filter((row) => String(row.orderId ?? row.executionOrderId ?? "") === String(selected.id)) : [];
  const exit = selected ? executionExitAction(selected) : null;
  const stageLabels = {
    signal: t("信号", "Signal"), risk: t("风控", "Risk"), routing: t("路由", "Routing"),
    order: t("委托", "Order"), fill: t("成交", "Fill"), protection: t("保护", "Protection")
  };
  const stages = buildSelectedExecutionStages(data, selected ?? {}).map((stage) => [stageLabels[stage.id], stage.done, stage.detail]);
  return <div className="cockpitPage cockpitLedger" data-cockpit-page="ledger">
    <header className="ledgerTitle"><div><h1>{t("委托与成交", "Orders & Fills")}</h1><p>{t("按真实执行生命周期核对委托、路由、成交与费用。", "Reconcile orders, routing, fills, and fees by real execution lifecycle.")}</p></div><span>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date())}</span></header>
    <section className="executionHero"><Metric strong label={t("全部委托", "All orders")} value={String(presentation.metrics.total)}/><Metric label={t("待执行", "Pending")} value={String(presentation.metrics.working)} tone={presentation.metrics.working ? "warning" : ""}/><Metric label={t("待审批", "Awaiting approval")} value={String(plans.filter((row) => row.status === "awaiting_approval").length)}/><Metric label={t("已成交", "Fills")} value={String(presentation.metrics.filled)} tone="positive"/><Metric label={t("拒绝 / 取消", "Rejected / canceled")} value={String(presentation.metrics.blocked)} tone={presentation.metrics.blocked ? "negative" : ""}/></section>
    <SystemNotice notice={buildOverviewPresentation(data).systemNotice} onOpen={() => ui.setActive("operationsCenter:notifications")}/>
    <div className="ledgerWorkspace">
      <Panel title={t("委托列表", "Orders")} meta={`${orders.length}`} className="orderIndex"><DataTable compact label={t("委托列表", "Orders")} rows={orders} selectedId={selected?.id} onSelect={(row) => setSelectedId(row.id)} emptyTitle={t("暂无委托", "No orders")} emptyDetail={t("真实交易计划进入执行后会在这里显示。", "Orders appear here when a real trade plan enters execution.")} columns={[
        { key: "id", label: t("订单号", "Order ID"), render: (row) => <span className="orderIdCell"><b>{String(row.id || "—").slice(0, 14)}</b><small>{formatTime(row.createdAt || row.updatedAt)}</small></span> },
        { key: "symbol", label: t("交易对", "Pair") },
        { key: "side", label: t("方向", "Side"), render: (row) => <Tone tone={sideTone(row.side || row.direction)}>{humanize(row.side || row.direction)}</Tone> },
        { key: "qty", label: t("数量", "Qty"), render: (row) => row.quantity ?? row.size ?? "—" },
        { key: "status", label: t("状态", "Status"), render: (row) => <Tone tone={statusTone(row.status)}>{humanize(row.status)}</Tone> }
      ]}/></Panel>
      <section className="orderInspector">
        <Panel title={t("订单详情", "Order detail")} meta={selected ? String(selected.id || "").slice(0, 20) : ""} action={selected && <Tone tone={statusTone(selected.status)}>{humanize(selected.status)}</Tone>}>
          {selected ? <><div className="orderFacts">{[[t("交易对", "Pair"), selected.symbol], [t("方向", "Side"), humanize(selected.side || selected.direction)], [t("类型", "Type"), humanize(selected.type || selected.orderType)], [t("委托数量", "Order qty"), selected.quantity ?? selected.size], [t("委托价格", "Order price"), money(selected.price)], [t("成交数量", "Filled qty"), selected.filledQuantity ?? selected.accFillSz], [t("交易场所", "Venue"), selected.exchange ?? selected.venue ?? t("未提供", "Unavailable")], [t("创建时间", "Created"), formatDateTime(selected.createdAt)]].map(([label, value]) => <span key={label}><small>{label}</small><b>{value ?? "—"}</b></span>)}</div><div className="orderActions"><button type="button" className="cockpitSecondaryButton" onClick={() => ui.setActive("chat")}>{t("交给 AI 处理", "Ask AI")}</button>{exit && <button type="button" className="cockpitDangerButton" onClick={() => requestExecutionExit(action, selected, "manual_ui")}>{exit.label}</button>}</div></> : <CockpitEmpty title={t("选择一条委托", "Select an order")}/>}
        </Panel>
        <Panel title={t("执行时间线", "Execution timeline")} region="execution-timeline"><ol className="executionTimeline">{stages.map(([label, done, detail], index) => <li key={label} className={done ? "done" : ""}><i>{done ? <Check/> : index + 1}</i><span><b>{label}</b><small>{localizeText(detail || t("等待上一阶段", "Waiting for prior stage"))}</small></span></li>)}</ol></Panel>
      </section>
    </div>
    <Panel title={t("成交账本", "Fill ledger")} meta={`${fills.length} ${t("条交易所回报", "exchange reports")}`} className="fillLedger"><DataTable compact label={t("成交账本", "Fill ledger")} rows={fills} emptyTitle={t("暂无成交", "No fills")} emptyDetail={t("交易所确认成交后，费用与成交事实会显示在这里。", "Fees and fill facts appear after exchange confirmation.")} columns={[
      { key: "createdAt", label: t("成交时间", "Fill time"), render: (row) => formatDateTime(row.createdAt || row.ts) },
      { key: "orderId", label: t("订单号", "Order ID"), render: (row) => String(row.orderId || "—").slice(0, 16) },
      { key: "symbol", label: t("交易对", "Pair") },
      { key: "side", label: t("方向", "Side"), render: (row) => <Tone tone={sideTone(row.side || row.direction)}>{humanize(row.side || row.direction)}</Tone> },
      { key: "quantity", label: t("成交数量", "Fill qty"), render: (row) => row.quantity ?? row.size ?? row.fillSz ?? "—" },
      { key: "price", label: t("成交价格", "Fill price"), render: (row) => money(row.price ?? row.fillPx) },
      { key: "fee", label: t("手续费", "Fee"), render: (row) => finite(row.fee ?? row.feeUsdt) ? `${money(row.fee ?? row.feeUsdt)} U` : "—" },
      { key: "liquidity", label: t("流动性", "Liquidity"), render: (row) => humanize(row.liquidity || row.execType, "—") }
    ]}/></Panel>
  </div>;
}

export function TradingCockpitPage({ active, data, action, ui, initialReviewId = "", onReviewSelect }) {
  if (active === "market") return <MarketPage data={data} action={action} ui={ui}/>;
  if (active === "positions") return <PositionsPage data={data} action={action} ui={ui}/>;
  if (active === "execution") return <ReviewPage data={data} action={action} ui={ui} initialReviewId={initialReviewId} onReviewSelect={onReviewSelect}/>;
  if (active === "ledger") return <LedgerPage data={data} action={action} ui={ui}/>;
  return <OverviewPage data={data} action={action} ui={ui}/>;
}
