import React, { useEffect, useState } from "react";
import { Check, ChevronRight, Sparkles } from "lucide-react";
import { displayMoney, displayPct, formatDateTime, formatTime, humanize, localizeText } from "./lib.jsx";
import { t } from "./i18n.js";
import { executionExitAction, requestExecutionExit } from "./executionExit.js";
import {
  buildLedgerPresentation,
  buildOverviewPresentation,
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
import { OverviewPage } from "./tradingCockpit/OverviewPage.jsx";
import { MarketPage } from "./tradingCockpit/MarketPage.jsx";
import { PositionsPage } from "./tradingCockpit/PositionsPage.jsx";
import { ReviewPage } from "./tradingCockpit/ReviewPage.jsx";
import "./tradingCockpit.css";

// Presentation selectors centralize buildPositionView and buildExecutionView joins.

const list = (value) => Array.isArray(value) ? value : [];
const finite = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const number = (value, fallback = 0) => finite(value) ? Number(value) : fallback;
const money = (value, fallback = "—") => finite(value) ? displayMoney(Number(value), 2, fallback) : fallback;
const signedMoney = (value, fallback = "—") => finite(value) ? `${Number(value) >= 0 ? "+" : ""}${money(value, fallback)}` : fallback;
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
