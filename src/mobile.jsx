import React, { useEffect, useMemo, useRef, useState } from "react";
import { uiConfirm, uiPrompt } from "./confirm.jsx";
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Menu,
  PieChart,
  ShieldCheck,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Gauge,
  Globe2,
  Eye,
  Inbox,
  Info,
  MoreHorizontal,
  MessageSquare,
  Plus,
  Play,
  RefreshCw,
  ReceiptText,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  UserCog,
  WalletCards,
  Wrench,
  Zap,
  CheckCircle2,
  Rocket,
  Sparkles,
  Trash2
} from "lucide-react";
import { apiUrl, authHeaders, haptic, displayMoney, marginUsage, SKILL_STATE, SKILL_STATE_HELP, OPEN_EXECUTION_STATES, countOpenExecutions, displayPrice, displayPct, formatDate, formatDateTime, formatTime, humanize, humanizePhase, localizeText, smartMoneyBias, TradingViewChart, LivePrice, StatusBadge, statusTone, systemStatus } from "./lib.jsx";
import { ChatPage } from "./chat.jsx";
import { ConceptGraph } from "./pages.jsx";
import { ConfigPanel, SystemConfigPanel, TaskManagerPanel } from "./panels.jsx";
import { t } from "./i18n.js";
import { executionExitAction, requestExecutionExit } from "./executionExit.js";
import {
  buildCapabilityCatalogRows,
  buildEventRows,
  buildExecutionView,
  buildMarketRows,
  buildPositionView,
  buildStrategyCatalogRows,
  groupClosedTradeLifecyclesForView,
  hasFiniteNumber,
  isCompletedTradeReview,
  netReviewResult
} from "./viewData.js";

export function KillConfirmDialog({ enable, action, onClose }) {
  const [reason, setReason] = useState("");
  async function confirm() {
    await action("/api/risk/kill-switch", { enabled: enable, reason });
    onClose();
  }
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="confirmDialog" onClick={(event) => event.stopPropagation()}>
        <strong>{enable ? t("确认紧急停止新交易？", "Activate the emergency stop?") : t("确认恢复新交易？", "Resume new trading?")}</strong>
        <p>{enable ? t("将立即阻断所有新交易，并请求撤销全部在途委托。", "This immediately blocks all new trades and requests cancellation of all open orders.") : t("解除后系统恢复正常风控运行，重新允许新交易。", "Once released, the system resumes normal risk control and allows new trades again.")}</p>
        {enable && <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("停止原因（可选，会写入审计记录）", "Reason (optional, written to the audit trail)")} autoFocus />}
        <div className="confirmActions">
          <button type="button" className="ghostButton" onClick={onClose}>{t("取消", "Cancel")}</button>
          <button type="button" className={enable ? "confirmDanger" : "primaryButton"} onClick={confirm}>{enable ? t("确认紧急停止", "Confirm emergency stop") : t("确认恢复", "Confirm resume")}</button>
        </div>
      </div>
    </div>
  );
}

const settingsSections = [
  { id: "llm", label: t("模型", "Model") },
  { id: "exchange", label: t("交易所", "Exchange") },
  { id: "integrations", label: t("外部服务", "Integrations") },
  { id: "runtime", label: t("运行参数", "Runtime") }
];

const positionSegments = ["持仓", "在途委托", "执行单"];

export function mobileDirectionKind(value) {
  const raw = String(value ?? "").trim();
  if (/short|sell|空/i.test(raw)) return "short";
  if (/long|buy|多/i.test(raw)) return "long";
  return "unknown";
}

function mobileDirectionLabel(value, verb = false) {
  const kind = mobileDirectionKind(value);
  if (kind === "short") return verb ? t("做空", "Short") : t("空", "Short");
  if (kind === "long") return verb ? t("做多", "Long") : t("多", "Long");
  return "—";
}

export function MobilePositions({ data, action, ui }) {
  const [segment, setSegment] = useState("持仓");
  const positionView = buildPositionView(data);
  const positions = positionView.positions;
  const orders = positionView.openOrders;
  const executions = data.executionOrders || [];
  const reduceOnly = Boolean(data.system?.reduceOnlyMode);
  const activeExec = OPEN_EXECUTION_STATES; // 单一来源(lib),与后端对齐
  const activeExecutions = executions.filter((order) => activeExec.includes(String(order.status || "").toLowerCase())).length;
  const portfolio = data.portfolio || {};
  const configured = (data.exchangeAccounts || []).some((account) => account.readEnabled);
  const exposure = positionView.exposureUsdt;
  const totalPnl = positionView.unrealizedPnlUsdt;
  const availableMargin = portfolio.availableMarginUsdt ?? portfolio.availableMargin ?? null;
  const marginRate = configured ? marginUsage(portfolio).marginRatePct : null;
  return (
    <div className="mPositions">
      <div className="mPageStats">
        <div><span>{t("总敞口", "Total exposure")}</span><strong>{configured ? displayMoney(exposure, 0) : t("未同步", "Not synced")}</strong></div>
        <div><span>{t("未实现盈亏", "Unrealized PnL")}</span><strong className={totalPnl >= 0 ? "positive" : "negative"}>{configured ? `${totalPnl >= 0 ? "+" : ""}${displayMoney(totalPnl)}` : t("未同步", "Not synced")}</strong></div>
        <div><span>{t("保证金率", "Margin ratio")}</span><strong>{marginRate === null ? t("未同步", "Not synced") : `${marginRate.toFixed(1)}%`}</strong></div>
      </div>
      <div className="mMiniStats">
        <div><span>{t("持仓数", "Positions")}</span><strong>{positions.length}</strong></div>
        <div><span>{t("在途委托", "Open orders")}</span><strong>{orders.length}</strong></div>
        <div><span>{t("活跃执行", "Active executions")}</span><strong>{activeExecutions}</strong></div>
        <div><span>{t("可用保证金", "Available margin")}</span><strong>{configured ? displayMoney(availableMargin, 0) : t("未同步", "Not synced")}</strong></div>
      </div>
      <div className="mChips">
        {positionSegments.map((name) => (
          <button key={name} className={segment === name ? "active" : ""} onClick={() => setSegment(name)}>{name}</button>
        ))}
      </div>

      {segment === "持仓" && (
        <>
          {!positions.length && <p className="mInboxEmpty">{t("暂无真实持仓。配置只读 API 并完成同步后展示。", "No live positions. Configure read-only API and sync to display.")}</p>}
          {positions.map((position) => {
            const pnl = Number(position.unrealizedPnl ?? position.pnl ?? position.upl ?? 0);
            const direction = mobileDirectionKind(position.direction ?? position.side ?? position.posSide);
            return (
              <div className="mPosCard" key={position.id || position.symbol}>
                <header>
                  <strong>{position.symbol}</strong>
                  <StatusBadge tone={direction === "short" ? "danger" : direction === "long" ? "ok" : "neutral"}>{mobileDirectionLabel(position.direction ?? position.side ?? position.posSide)}</StatusBadge>
                </header>
                <div className={`mPosPnl ${pnl >= 0 ? "positive" : "negative"}`}>{pnl >= 0 ? "+" : ""}{displayMoney(pnl, 2, "--")} <small>{t("未实现盈亏", "Unrealized PnL")}</small></div>
                <div className="mPosMeta">
                  <span>{t("数量", "Size")}<b>{position.quantity ?? position.size ?? position.pos ?? "-"}</b></span>
                  <span>{t("开仓均价", "Entry price")}<b>{hasFiniteNumber(position.entryPrice ?? position.entry) ? displayPrice(position.entryPrice ?? position.entry) : "-"}</b></span>
                  <span>{t("标记价格", "Mark price")}<b>{hasFiniteNumber(position.markPrice ?? position.mark) ? displayPrice(position.markPrice ?? position.mark) : "-"}</b></span>
                </div>
              </div>
            );
          })}
        </>
      )}

      {segment === "在途委托" && (
        <>
          {!orders.length && <p className="mInboxEmpty">{t("暂无在途委托。", "No open orders.")}</p>}
          {orders.map((order) => (
            <div className="mPosCard" key={order.id}>
              <header>
                <strong>{order.symbol || order.id}</strong>
                <StatusBadge tone={statusTone(order.status)}>{humanize(order.status)}</StatusBadge>
              </header>
              <div className="mPosMeta">
                <span>{t("方向", "Side")}<b>{mobileDirectionLabel(order.side ?? order.direction, true)}</b></span>
                <span>{t("价格", "Price")}<b>{order.price ? displayMoney(order.price) : t("市价", "Market")}</b></span>
                <span>{t("数量", "Size")}<b>{order.quantity ?? order.size ?? "-"}</b></span>
              </div>
            </div>
          ))}
        </>
      )}

      {segment === "执行单" && (
        <>
          {!executions.length && <p className="mInboxEmpty">{t("暂无执行单。批准交易计划后由执行引擎生成。", "No execution orders. Generated by the execution engine after a trade plan is approved.")}</p>}
          {executions.map((order) => (
            <div className="mPosCard" key={order.id}>
              <header>
                <strong>{order.symbol || order.id}</strong>
                <StatusBadge tone={statusTone(order.status)}>{humanize(order.status)}</StatusBadge>
              </header>
              <div className="mPosMeta">
                <span>{t("方向", "Side")}<b>{mobileDirectionLabel(order.direction ?? order.side, true)}</b></span>
                <span>{t("入场", "Entry")}<b>{order.entryPrice ? displayMoney(order.entryPrice) : "-"}</b></span>
                <span>{t("止损", "Stop-loss")}<b>{order.stopLoss ? displayMoney(order.stopLoss) : "-"}</b></span>
              </div>
              {activeExec.includes(String(order.status || "").toLowerCase()) && (
                <div className="mInboxActions">
                  {executionExitAction(order) && <button onClick={() => requestExecutionExit(action, order, "manual_mobile")}>{executionExitAction(order).label}</button>}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <button className={`mToggleRow ${reduceOnly ? "on" : ""}`} onClick={() => action("/api/risk/reduce-only", { enabled: !reduceOnly })}>
        <span>
          <strong>{t("只减仓模式", "Reduce-only mode")}</strong>
          <small>{reduceOnly ? t("已开启：禁止新开仓，仅允许减仓", "On: no new positions, reduce only") : t("关闭中：开启后 Agent 只能减仓", "Off: when on, the Agent can only reduce")}</small>
        </span>
        <i className={reduceOnly ? "on" : ""} />
      </button>

      <div className="mList">
        <button onClick={() => ui.setActive("marketAccount")}>
          <Activity size={17} />
          <span>{t("账户健康与对账", "Account health & reconciliation")}</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

// Backward-compatible export for focused lifecycle tests and any older imports.
export const groupMobileClosedTrades = groupClosedTradeLifecyclesForView;

function MobileReviewSheet({ review, trade, onClose }) {
  if (!review) return null;
  const pnl = netReviewResult(review, trade);
  const closeFee = hasFiniteNumber(review.feeUsdt) ? Number(review.feeUsdt) : hasFiniteNumber(trade?.feeUsdt) ? Number(trade.feeUsdt) : null;
  const entryFee = hasFiniteNumber(review.entryFeeUsdt) ? Number(review.entryFeeUsdt) : hasFiniteNumber(trade?.entryFeeUsdt) ? Number(trade.entryFeeUsdt) : null;
  const fee = closeFee != null && entryFee != null ? closeFee + entryFee : null;
  const completed = isCompletedTradeReview(review);
  const sections = [
    [t("本次结论", "Outcome"), review.summary],
    [t("下次动作", "Next action"), review.lesson],
    [t("深度复盘", "Deep review"), review.deepReflection]
  ].filter(([, text]) => localizeText(text));
  return <div className="mReviewSheetOverlay" onClick={onClose}>
    <aside className="mReviewSheet" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="mSheetGrip" onClick={onClose} aria-label={t("关闭", "Close")}><i /></button>
      <header className="mReviewSheetHead"><div><small>{t("交易复盘", "Trade review")}</small><b className="mono">{review.symbol || trade?.symbol || "—"} · {/short|sell|空/i.test(String(review.direction || trade?.direction || "")) ? t("做空", "Short") : t("做多", "Long")}</b></div><StatusBadge tone={statusTone(review.status)}>{humanize(review.status || "pending")}</StatusBadge></header>
      <div className={`mReviewResult ${pnl == null ? "unknown" : pnl >= 0 ? "win" : "loss"}`}><span>{t("净交易结果", "Net trade result")}</span><b className="mono">{pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}${displayMoney(pnl, 2)}`}</b><small>{pnl == null ? t("缺少完整生命周期净值，等待成交与费用回补", "Awaiting complete lifecycle PnL and fee reconciliation") : fee != null ? `${fee < 0 ? t("已计入交易所净返佣", "Includes net exchange rebate") : t("已计入记录的开/平仓净费用", "Includes recorded net entry/close costs")} ${displayMoney(fee, 2)}` : t("净值来自已持久化的完整交易生命周期", "Net result comes from the persisted full lifecycle")}</small></div>
      <div className="mReviewFacts"><span>{t("完成时间", "Completed")}<b>{formatDateTime(review.completedAt || review.updatedAt || trade?.createdAt)}</b></span><span>{t("归因", "Attribution")}<b>{localizeText(review.attribution) || t("待归因", "Pending")}</b></span><span>{t("平仓成交", "Close fills")}<b>{review.partialCloseCount || trade?.closeCount || review.fillIds?.length || 1} {t("笔", "fills")}</b></span></div>
      <div className="mReviewSheetBody">{sections.map(([title, text]) => <section key={title}><b>{title}</b><p>{localizeText(text)}</p></section>)}{!completed && <section className="pending"><b>{t("正在复盘", "Review in progress")}</b><p>{t("系统正在回补成交事实、费用与持仓轨迹，完成后会给出明确归因和下一次动作。", "The system is reconciling fills, costs, and the position path before producing attribution and a concrete next action.")}</p></section>}</div>
    </aside>
  </div>;
}

export function MobileExecution({ data, action, initialTab = "overview" }) {
  const [tab, setTab] = useState(initialTab);
  const [reviewFilter, setReviewFilter] = useState("all");
  const [selectedReview, setSelectedReview] = useState(null);
  const execution = buildExecutionView(data);
  const { orders, fills, closedTrades: closes, reviews, performance, totals } = execution;
  const inFlight = countOpenExecutions(orders);
  const realized = Number(performance.totalPnlUsdt || 0);
  const pendingReviews = reviews.filter((row) => !isCompletedTradeReview(row)).length;
  const completedReviews = reviews.length - pendingReviews;
  const tradeForReview = (review) => closes.find((trade) => trade.tradeLifecycleKey === review.tradeLifecycleKey || trade.executionOrderId === review.executionOrderId || (review.fillIds || []).some((id) => trade.fillIds?.includes(id)));
  const reviewPnl = (review) => netReviewResult(review, tradeForReview(review));
  const lossReviews = reviews.filter((row) => reviewPnl(row) != null && reviewPnl(row) < 0).length;
  const filteredReviews = reviews.filter((row) => reviewFilter === "loss" ? reviewPnl(row) != null && reviewPnl(row) < 0 : reviewFilter === "pending" ? !isCompletedTradeReview(row) : true);
  const tabs = [["overview", t("概览", "Overview")], ["orders", t("委托", "Orders")], ["fills", t("成交", "Fills")], ["reviews", t("复盘", "Reviews")]];
  const direction = (row) => /short|sell|空/i.test(String(row.direction || row.side || "")) ? t("做空", "Short") : t("做多", "Long");
  const fillKind = (row) => row.kind === "entry" ? t("开仓", "Entry") : row.kind === "close" ? (row.partial === true ? t("减仓", "Reduction") : t("平仓", "Close")) : humanize(row.kind || row.side || t("成交", "Fill"));
  return <div className="mScreen mExecutionScreen">
    <div className="mSegmentNav">{tabs.map(([id, label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === "overview" && <>
      <div className="mMetric2x2"><div className="mMetricCell"><span>{t("净交易结果", "Net trade result")}</span><b className={`mono ${realized >= 0 ? "pos" : "neg"}`}>{realized >= 0 ? "+" : ""}{displayMoney(realized, 2)}</b></div><div className="mMetricCell"><span>{t("胜率", "Win rate")}</span><b className="mono">{performance.trades ? `${performance.winRatePct}%` : "—"}</b></div><div className="mMetricCell"><span>{t("在途执行", "In flight")}</span><b className="mono">{inFlight}</b></div><div className="mMetricCell"><span>{t("待复盘", "To review")}</span><b className="mono">{pendingReviews}</b></div></div>
      <section className="mNativeSection"><header><div><b>{t("当前重点", "Needs attention")}</b><small>{t("按交易流程排序", "Ordered by trading workflow")}</small></div></header>
        <button className="mActionRow" onClick={() => setTab("orders")}><span className={inFlight ? "warning" : "ok"}>{inFlight || "✓"}</span><div><b>{inFlight ? t(`${inFlight} 笔执行正在推进`, `${inFlight} executions in progress`) : t("没有在途执行", "No executions in flight")}</b><small>{t("核对订单、保护单与交易所状态", "Review orders, protection, and exchange state")}</small></div><ChevronRight size={16}/></button>
        <button className="mActionRow" onClick={() => setTab("reviews")}><span className={pendingReviews ? "warning" : "ok"}>{pendingReviews || "✓"}</span><div><b>{pendingReviews ? t(`${pendingReviews} 笔交易等待复盘`, `${pendingReviews} trades await review`) : t("复盘队列已处理", "Review queue is clear")}</b><small>{t("优先复盘亏损与异常离场", "Prioritize losses and unusual exits")}</small></div><ChevronRight size={16}/></button>
      </section>
      <section className="mNativeSection"><header><div><b>{t("最近平仓", "Latest closed trades")}</b><small>{t("完整生命周期 · 净手续费与资金费", "Completed lifecycles · net of recorded fees and funding")}</small></div><button className="mLink" onClick={() => setTab("fills")}>{t("成交流水", "Fill ledger")}</button></header>{closes.slice(0, 5).map((row) => <div className="mTradeRow" key={row.id}><div><b className="mono">{row.symbol || "—"}</b><small>{direction(row)} · {row.closeCount > 1 ? t(`${row.closeCount} 笔平仓合并`, `${row.closeCount} closes combined`) : t("已平仓", "Closed")}</small></div><div><b className={`mono ${Number(row.netRealizedPnl || 0) >= 0 ? "pos" : "neg"}`}>{Number(row.netRealizedPnl) >= 0 ? "+" : ""}{displayMoney(row.netRealizedPnl, 2)}</b><small>{formatTime(row.createdAt)} · {t("净", "net")}</small></div></div>)}{!closes.length && <div className="mNativeEmpty"><ReceiptText size={22}/><b>{t("暂无已平仓交易", "No closed trades yet")}</b></div>}</section>
    </>}
    {tab === "orders" && <section className="mNativeSection"><header><div><b>{t("AI 委托", "AI orders")}</b><small>{orders.length === totals.orders ? `${totals.orders} ${t("笔记录", "records")}` : `${t("最近", "Latest")} ${orders.length} / ${totals.orders}`}</small></div></header>{orders.map((row) => { const exit = executionExitAction(row); return <article className="mOrderCard" key={row.id}><header><div><b className="mono">{row.symbol || "—"}</b><span className={/short|sell|空/i.test(String(row.direction || row.side)) ? "short" : "long"}>{direction(row)}</span></div><StatusBadge tone={statusTone(row.status)}>{humanize(row.status)}</StatusBadge></header><div><span>{t("入场", "Entry")}<b className="mono">{displayPrice(row.entryPrice ?? row.price)}</b></span><span>{t("止损", "Stop")}<b className="mono">{displayPrice(row.stopLoss)}</b></span><span>{t("数量", "Size")}<b className="mono">{row.filledQuantity ?? row.quantity ?? row.size ?? "—"}</b></span></div>{exit && <button onClick={() => requestExecutionExit(action, row, "manual_mobile")}>{exit.label}</button>}</article>; })}{!orders.length && <div className="mNativeEmpty"><ClipboardList size={22}/><b>{t("暂无委托", "No orders")}</b></div>}</section>}
    {tab === "fills" && <section className="mNativeSection"><header><div><b>{t("成交流水", "Fill ledger")}</b><small>{fills.length === totals.fills ? `${totals.fills} ${t("笔成交", "fills")}` : `${t("最近", "Latest")} ${fills.length} / ${totals.fills}`}</small></div><span>{t("开仓 / 减仓 / 平仓", "Entries / reductions / closes")}</span></header>{fills.map((row, index) => { const isClose = row.kind === "close" && hasFiniteNumber(row.realizedPnl); const pnl = Number(row.realizedPnl || 0); return <div className="mTradeRow" key={row.id || index}><div><b className="mono">{row.symbol || "—"}</b><small>{direction(row)} · {fillKind(row)} · {row.quantity ?? row.size ?? "—"} @ {displayPrice(row.price)}</small></div><div><b className={`mono ${isClose ? (pnl >= 0 ? "pos" : "neg") : ""}`}>{isClose ? `${pnl >= 0 ? "+" : ""}${displayMoney(pnl, 2)}` : displayPrice(row.price)}</b><small>{isClose ? `${t("价格毛盈亏", "Gross price PnL")} · ` : ""}{formatDateTime(row.createdAt)}{hasFiniteNumber(row.feeUsdt ?? row.fee) ? ` · ${t("费", "fee")} ${displayMoney(row.feeUsdt ?? row.fee, 2)}` : ""}</small></div></div>; })}{!fills.length && <div className="mNativeEmpty"><ReceiptText size={22}/><b>{t("暂无成交", "No fills")}</b><span>{t("交易所确认的开仓、减仓和平仓成交都会显示在这里。", "Exchange-confirmed entries, reductions, and closes appear here.")}</span></div>}</section>}
    {tab === "reviews" && <>
      <div className="mReviewHero"><span><b className="mono">{completedReviews}</b><small>{t("已完成", "Completed")}</small></span><span><b className="mono">{pendingReviews}</b><small>{t("待复盘", "Pending")}</small></span><span><b className="mono neg">{lossReviews}</b><small>{t("亏损复盘", "Losses")}</small></span></div>
      <div className="mReviewFilters">{[["all", t("全部", "All")], ["loss", t("只看亏损", "Losses")], ["pending", t("待处理", "Pending")]].map(([id, label]) => <button type="button" className={reviewFilter === id ? "active" : ""} key={id} onClick={() => setReviewFilter(id)}>{label}</button>)}</div>
      <section className="mNativeSection"><header><div><b>{t("交易复盘", "Trade reviews")}</b><small>{reviews.length === totals.reviews ? t("点开一笔查看归因与下一次动作", "Open a trade for attribution and next action") : `${t("当前加载", "Loaded")} ${reviews.length} / ${totals.reviews}`}</small></div></header>{filteredReviews.map((row, index) => { const trade = tradeForReview(row); const pnl = reviewPnl(row); const completed = isCompletedTradeReview(row); return <button type="button" className="mReviewRow" key={row.id || index} onClick={() => setSelectedReview({ review: row, trade })}><div className="mReviewRowTop"><span><b className="mono">{row.symbol || trade?.symbol || "—"}</b><small>{direction(row)}</small></span><b className={`mono ${pnl == null ? "" : pnl >= 0 ? "pos" : "neg"}`}>{pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}${displayMoney(pnl, 2)}`}</b></div><p>{localizeText(row.lesson || row.summary) || t("等待成交事实回补与归因。", "Awaiting fill reconciliation and attribution.")}</p><footer><span className={`mReviewState ${completed ? "done" : "pending"}`}>{completed ? t("已完成", "Completed") : t("处理中", "In progress")}</span><time>{formatDateTime(row.completedAt || row.updatedAt || row.createdAt)}</time><ChevronRight size={14}/></footer></button>; })}{!filteredReviews.length && <div className="mNativeEmpty"><BookOpen size={22}/><b>{reviews.length ? t("当前筛选下没有记录", "No reviews in this filter") : t("暂无复盘", "No reviews")}</b><span>{t("完整平仓确认后会自动进入复盘队列。", "Confirmed full closes enter the review queue automatically.")}</span></div>}</section>
    </>}
    {selectedReview && <MobileReviewSheet review={selectedReview.review} trade={selectedReview.trade} onClose={() => setSelectedReview(null)} />}
  </div>;
}

// 屏 S5 — 系统设置：账户卡 + 交易所列表 + 系统配置分区 + 订阅卡。
function MobileSettingsIndex({ data, onOpen }) {
  const config = data.config || {};
  const exchange = config.exchange || {};
  const integrations = config.integrations || {};
  const runtime = config.runtime || {};
  const user = data.user || {};
  const sub = (data.subscriptions || [])[0] || {};
  const subExpiresAt = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : null;
  const subExpired = Number.isFinite(subExpiresAt) && subExpiresAt < Date.now();
  const subs = {
    llm: config.llm?.activeProvider ? humanize(config.llm.activeProvider, config.llm.activeProvider) : t("未配置", "Not configured"),
    exchange: exchange.okx?.hasKey ? "OKX" : t("未配置", "Not configured"),
    integrations: integrations.telegram?.configured ? t("TG 已接入", "Telegram connected") : integrations.lark?.hasWebhook ? t("飞书已接入", "Lark connected") : t("未配置", "Not configured"),
    runtime: runtime.authRequired === false ? t("免登录", "No login") : t("鉴权开启", "Auth enabled")
  };
  const exchanges = [
    { id: "okx", name: "OKX", letter: "O", cls: "okx", connected: exchange.okx?.hasKey }
  ];
  return (
    <div className="mScreen">
      <div className="mCard mAcctCard">
        <span className="mAcctAvatar">{user.avatar ? <img src={user.avatar} alt="" /> : String(localizeText(user.name || user.email || "U")).charAt(0).toUpperCase()}</span>
        <div className="mAcctInfo"><b>{localizeText(user.name || t("量化交易员", "Quant Trader"))}</b><small>{user.email || "—"}</small></div>
        <span className="mAcctPlan">{user.isOwner ? "OWNER" : sub.status ? "PRO" : "—"}</span>
      </div>

      <div className="mCard">
        <div className="mCardHead"><b>{t("交易所与 API 密钥", "Exchanges & API keys")}</b><small>{exchanges.filter((e) => e.connected).length} {t("已连接", "connected")}</small></div>
        {exchanges.map((e) => (
          <button className="mExRow" key={e.id} onClick={() => onOpen("settings:exchange")}>
            <span className={`mExLogo ${e.cls}`}>{e.letter}</span>
            <div className="mExInfo"><b>{e.name}</b><small>{e.connected ? t("已配置密钥", "Key configured") : t("未配置", "Not configured")}</small></div>
            <StatusBadge tone={e.connected ? "ok" : "neutral"}>{e.connected ? t("已连接", "Connected") : t("未连接", "Not connected")}</StatusBadge>
            <ChevronRight size={15} />
          </button>
        ))}
        <div className="mSecNote"><Shield size={13} /> {t("密钥加密存储；只勾读写交易，绝不勾选提币权限", "Keys are encrypted at rest; grant read/trade only, never withdrawal permission")}</div>
      </div>

      <div className="mCard">
        <div className="mCardHead"><b>{t("系统配置", "System configuration")}</b></div>
        {settingsSections.map((item) => (
          <button className="mCfgRow" key={item.id} onClick={() => onOpen(`settings:${item.id}`)}>
            <span>{item.label}</span>
            <small className="mono">{subs[item.id]}</small>
            <ChevronRight size={15} />
          </button>
        ))}
      </div>

      {sub.status && (
        <div className="mCard mPlanCard">
          <div className="mPlanTop">
            <div><b>{sub.planName || t("专业版", "Pro")}</b><small>{sub.source === "owner_grant" ? t("Owner 免费授权", "Owner free grant") : humanize(sub.status)}</small></div>
            <span className={`mPlanBadge ${subExpired ? "expired" : ""}`}>{subExpired ? t("已过期", "Expired") : t("生效中", "Active")}</span>
          </div>
          <div className="mPlanFoot mono">{t("到期", "Expires")} {sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : t("长期有效", "No expiry")}</div>
        </div>
      )}
    </div>
  );
}

function MobileRiskField({ label, hint, suffix, children }) {
  return <label className="mRiskField"><span><b>{label}</b>{hint && <small>{hint}</small>}</span><div>{children}{suffix && <i>{suffix}</i>}</div></label>;
}

function pairLabel(symbol = "") {
  return String(symbol).replace(/-SWAP$/i, "").replace("-", "/").toUpperCase();
}

function MobilePairMultiPicker({ value = [], onChange, instruments = [], instrumentsLoading = false, instrumentsError = "", instrumentsStale = false, instrumentsAsOf = null, onRetry, allowEmpty = false, fallbackHint = "" }) {
  const [open, setOpen] = useState(false);
  const selected = [...new Set((value || []).map(pairLabel).filter(Boolean))];
  const options = [...new Set([...selected, ...(instruments || []).map(pairLabel)].filter(Boolean))];
  return <div className="mRiskPairPicker">
    <button type="button" className="mRiskPairTrigger" onClick={() => setOpen(true)}>
      <span>
        <b>{selected.length ? t(`已选 ${selected.length} 个`, `${selected.length} selected`) : t("沿用交易权限", "Use trading permissions")}</b>
        <small>{selected.length ? selected.map((symbol) => symbol.replace("/USDT", "")).join(" · ") : fallbackHint}</small>
      </span>
      <ChevronRight size={16}/>
    </button>
    {open && <MobilePairSheet
      instruments={options}
      selected={selected}
      multiple
      allowEmpty={allowEmpty}
      loading={instrumentsLoading}
      error={instrumentsError}
      stale={instrumentsStale}
      asOf={instrumentsAsOf}
      onRetry={onRetry}
      title={t("选择交易币种", "Select trading pairs")}
      onApply={(next) => onChange(next)}
      onClose={() => setOpen(false)}
    />}
  </div>;
}

function leverageCap(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : fallback;
}

export function buildMobileRiskPermissionPayload(mandate = {}, form = {}, options = {}) {
  const symbols = [...new Set((form.symbols || []).map(pairLabel).filter(Boolean))];
  const existing = mandate.maxLeverageBySymbol || {};
  const draft = form.maxLeverageBySymbol || {};
  const inheritedCap = leverageCap(mandate.max_leverage ?? mandate.maxLeverage, 1);
  const newSymbolCap = leverageCap(form.newSymbolMaxLeverage, leverageCap(form.minLeverage, 1));
  const maxLeverageBySymbol = Object.fromEntries(symbols.map((symbol) => {
    const wasAuthorized = Object.prototype.hasOwnProperty.call(existing, symbol)
      || (mandate.allowedSymbols || []).map(pairLabel).includes(symbol);
    const previousCap = leverageCap(existing[symbol], inheritedCap);
    const requestedCap = leverageCap(draft[symbol], wasAuthorized ? previousCap : newSymbolCap);
    return [symbol, requestedCap];
  }));
  const caps = Object.values(maxLeverageBySymbol);
  const maxLeverage = caps.length ? Math.max(...caps) : newSymbolCap;
  const requestedMinLeverage = leverageCap(form.minLeverage, 1);
  const minLeverage = caps.length ? Math.min(requestedMinLeverage, ...caps) : requestedMinLeverage;
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  return {
    name: mandate.name || options.defaultName || "主账户交易权限", status: mandate.id ? (mandate.status || "active") : "active", exchanges: ["OKX"], marketTypes: ["perpetual_usdt"], allowedSymbols: symbols,
    strategies: mandate.strategies?.length ? mandate.strategies : ["trend_following", "mean_reversion", "momentum", "breakout"],
    maxLeverageBySymbol, max_leverage: maxLeverage, maxLeverage, min_leverage: minLeverage, minLeverage,
    sizingMode: "balance_pct", positionPct: Math.max(1, Math.min(100, Number(form.positionPct || 30))), maxSingleTradeRiskPct: Number(form.singleRisk || 0),
    maxDailyLossPct: Number(form.dailyLoss || 0), maxWeeklyLossPct: Number(form.weeklyLoss || 0), maxOrderNotionalUsdt: Number(form.maxOrderNotional || 0),
    maxSymbolNotionalUsdt: Number(form.maxSymbolNotional || 0), maxPortfolioNotionalUsdt: Number(form.maxPortfolioNotional || 0), maxConcurrentPositions: Number(form.maxConcurrentPositions || 1),
    maxMarginUtilizationPct: Number(form.maxMarginUtilizationPct || 70), allowAddPosition: form.allowAddPosition === true, allow_add_position: form.allowAddPosition === true,
    validUntil: new Date(nowMs + Math.max(1, Math.min(365, Number(form.validDays || 7))) * 86400000).toISOString()
  };
}

export async function submitMobileRiskChange(action, endpoint, body, method) {
  const result = await action(endpoint, body, method);
  return result?.ok !== false;
}

export function MobileRiskPermissionEditor({ data, action, ui, onDone }) {
  const mandate = data.agentStatus?.activeMandate || (data.mandates || []).find((row) => ["active", "running"].includes(row.status)) || data.mandates?.[0] || {};
  const activeGray = (data.grayReleasePolicies || []).find((item) => item.enabled);
  const orderNotional = mandate.maxOrderNotionalUsdt ?? mandate.max_notional_usdt ?? activeGray?.maxNotionalUsdt ?? 50;
  const instrumentState = useMobileInstruments();
  const buildForm = () => {
    const symbols = (mandate.allowedSymbols?.length ? mandate.allowedSymbols : ["BTC/USDT", "ETH/USDT"]).map(pairLabel);
    const inheritedCap = leverageCap(mandate.max_leverage ?? mandate.maxLeverage, 1);
    const minLeverage = leverageCap(mandate.min_leverage ?? mandate.minLeverage, 1);
    return {
    symbols,
    minLeverage,
    newSymbolMaxLeverage: minLeverage,
    maxLeverageBySymbol: Object.fromEntries(symbols.map((symbol) => [symbol, leverageCap(mandate.maxLeverageBySymbol?.[symbol], inheritedCap)])),
    positionPct: mandate.positionPct ?? mandate.equityPct ?? 30,
    singleRisk: mandate.maxSingleTradeRiskPct || 2,
    dailyLoss: mandate.maxDailyLossPct || 1,
    weeklyLoss: mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct ?? 5,
    maxOrderNotional: orderNotional,
    maxSymbolNotional: mandate.maxSymbolNotionalUsdt ?? orderNotional,
    maxPortfolioNotional: mandate.maxPortfolioNotionalUsdt ?? mandate.maxSymbolNotionalUsdt ?? orderNotional,
    maxConcurrentPositions: mandate.maxConcurrentPositions || 3,
    maxMarginUtilizationPct: mandate.maxMarginUtilizationPct ?? mandate.max_margin_utilization_pct ?? 70,
    allowAddPosition: mandate.allowAddPosition === true || mandate.allow_add_position === true,
    validDays: mandate.validUntil ? Math.max(1, Math.ceil((new Date(mandate.validUntil) - Date.now()) / 86400000)) : 7
  }; };
  const [form, setForm] = useState(buildForm);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(buildForm()), [mandate.id, mandate.version]);
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateSymbols = (nextSymbols) => setForm((current) => {
    const symbols = [...new Set((nextSymbols || []).map(pairLabel).filter(Boolean))];
    const previous = current.maxLeverageBySymbol || {};
    const authorized = mandate.maxLeverageBySymbol || {};
    const inheritedCap = leverageCap(mandate.max_leverage ?? mandate.maxLeverage, 1);
    const newSymbolCap = leverageCap(current.newSymbolMaxLeverage, leverageCap(current.minLeverage, 1));
    return {
      ...current,
      symbols,
      maxLeverageBySymbol: Object.fromEntries(symbols.map((symbol) => [
        symbol,
        leverageCap(previous[symbol], leverageCap(authorized[symbol], (mandate.allowedSymbols || []).map(pairLabel).includes(symbol) ? inheritedCap : newSymbolCap))
      ]))
    };
  });
  async function save() {
    const symbols = [...new Set((form.symbols || []).map(pairLabel).filter(Boolean))];
    if (!symbols.length) return ui.notify?.(t("至少保留一个允许交易的币种", "Keep at least one allowed pair"));
    const body = buildMobileRiskPermissionPayload(mandate, form, { defaultName: t("主账户交易权限", "Primary account trading permissions") });
    const writableBody = { ...body };
    delete writableBody.status;
    setSaving(true);
    try {
      const saved = await action(mandate.id ? `/api/mandates/${mandate.id}` : "/api/mandates", writableBody, mandate.id ? "PATCH" : "POST");
      if (saved?.ok === false) return;
      if (!mandate.id) {
        if (!saved?.id) return;
        const activated = await action(`/api/mandates/${saved.id}/activate`, {});
        if (activated?.ok === false) return;
      }
      onDone();
    } finally { setSaving(false); }
  }
  return <div className="mScreen mRiskDetail">
    <section className="mNativeSection"><header><div><b>{t("允许交易的范围", "Allowed scope")}</b><small>{t("从 OKX 当前可交易的 USDT 永续合约中选择；每个币种独立保留授权上限", "Choose tradable OKX USDT perpetuals; each pair keeps its own authorized cap")}</small></div></header><div className="mRiskFieldStack"><MobilePairMultiPicker value={form.symbols} onChange={updateSymbols} instruments={instrumentState.instruments} instrumentsLoading={instrumentState.loading} instrumentsError={instrumentState.error} instrumentsStale={instrumentState.stale} instrumentsAsOf={instrumentState.asOf} onRetry={instrumentState.retry} fallbackHint={t("至少选择一个交易币种", "Select at least one pair")} /><div className="mRiskFieldGrid"><MobileRiskField label={t("最低杠杆", "Min leverage")} suffix="x"><input type="number" min="1" inputMode="decimal" value={form.minLeverage} onChange={(event) => update("minLeverage", event.target.value)} /></MobileRiskField><MobileRiskField label={t("新增币种默认上限", "Default cap for new pairs")} hint={t("默认等于最低杠杆；只用于之后新加入的币种", "Defaults to the minimum; applies only to pairs added later")} suffix="x"><input type="number" min="1" max="20" inputMode="decimal" value={form.newSymbolMaxLeverage} onChange={(event) => update("newSymbolMaxLeverage", event.target.value)} /></MobileRiskField></div><div className="mRiskLeverageList">{(form.symbols || []).map((symbol) => <MobileRiskField key={symbol} label={symbol} hint={t("该币种独立授权上限", "Independent authorized cap for this pair")} suffix="x"><input type="number" min="1" max="20" inputMode="decimal" value={form.maxLeverageBySymbol?.[symbol] ?? 1} onChange={(event) => setForm((current) => ({ ...current, maxLeverageBySymbol: { ...(current.maxLeverageBySymbol || {}), [symbol]: event.target.value } }))} /></MobileRiskField>)}</div></div></section>
    <section className="mNativeSection"><header><div><b>{t("止损预算", "Loss budget")}</b><small>{t("触达任一上限即阻止新开仓", "Any breached limit blocks new entries")}</small></div></header><div className="mRiskFieldStack"><div className="mRiskFieldGrid"><MobileRiskField label={t("单笔最多亏损", "Per trade")} suffix="%"><input type="number" min="0" step="0.1" inputMode="decimal" value={form.singleRisk} onChange={(event) => update("singleRisk", event.target.value)} /></MobileRiskField><MobileRiskField label={t("单日最多亏损", "Daily")} suffix="%"><input type="number" min="0" step="0.1" inputMode="decimal" value={form.dailyLoss} onChange={(event) => update("dailyLoss", event.target.value)} /></MobileRiskField><MobileRiskField label={t("近 7 日最多亏损", "Rolling 7d")} suffix="%"><input type="number" min="0.1" max="20" step="0.1" inputMode="decimal" value={form.weeklyLoss} onChange={(event) => update("weeklyLoss", event.target.value)} /></MobileRiskField><MobileRiskField label={t("每单保证金占比", "Margin / order")} suffix="%"><input type="number" min="1" max="100" inputMode="decimal" value={form.positionPct} onChange={(event) => update("positionPct", event.target.value)} /></MobileRiskField></div></div></section>
    <section className="mNativeSection"><header><div><b>{t("敞口上限", "Exposure limits")}</b><small>{t("每次下单前按真实账户重新计算", "Recalculated from the live account before every order")}</small></div></header><div className="mRiskFieldStack"><MobileRiskField label={t("单笔名义金额", "Per order")} suffix="USDT"><input type="number" min="1" inputMode="decimal" value={form.maxOrderNotional} onChange={(event) => update("maxOrderNotional", event.target.value)} /></MobileRiskField><MobileRiskField label={t("单币名义金额", "Per pair")} suffix="USDT"><input type="number" min="1" inputMode="decimal" value={form.maxSymbolNotional} onChange={(event) => update("maxSymbolNotional", event.target.value)} /></MobileRiskField><MobileRiskField label={t("组合名义金额", "Portfolio")} suffix="USDT"><input type="number" min="1" inputMode="decimal" value={form.maxPortfolioNotional} onChange={(event) => update("maxPortfolioNotional", event.target.value)} /></MobileRiskField><div className="mRiskFieldGrid"><MobileRiskField label={t("同时持仓", "Open positions")}><input type="number" min="1" max="20" inputMode="numeric" value={form.maxConcurrentPositions} onChange={(event) => update("maxConcurrentPositions", event.target.value)} /></MobileRiskField><MobileRiskField label={t("保证金使用率", "Margin use")} suffix="%"><input type="number" min="1" max="100" inputMode="decimal" value={form.maxMarginUtilizationPct} onChange={(event) => update("maxMarginUtilizationPct", event.target.value)} /></MobileRiskField></div></div></section>
    <section className="mNativeSection"><label className="mNativeToggle"><span><b>{t("允许同币种追加仓位", "Allow adding to a pair")}</b><small>{t("关闭时，同币种只允许一个仓位或在途入场", "When off, only one position or pending entry is allowed per pair")}</small></span><input type="checkbox" checked={form.allowAddPosition} onChange={(event) => update("allowAddPosition", event.target.checked)} /></label><MobileRiskField label={t("权限有效期", "Valid for")} suffix={t("天", "days")}><input type="number" min="1" max="365" inputMode="numeric" value={form.validDays} onChange={(event) => update("validDays", event.target.value)} /></MobileRiskField></section>
    <div className="mRiskSaveBar"><button type="button" disabled={saving} onClick={save}>{saving ? t("保存中…", "Saving…") : t("保存设置", "Save settings")}</button></div>
  </div>;
}

function MobileRiskLiveEditor({ data, action, ui, onDone }) {
  const live = data.config?.liveTrading || {};
  const requested = data.system?.requestedOperatingMode || (!live.liveTradingEnabled ? "observe" : live.grayRequiresApproval === false ? "full_auto" : "semi_auto");
  const instrumentState = useMobileInstruments();
  const buildForm = () => ({ mode: requested, acknowledged: Boolean(live.acknowledged), symbols: (live.grayAllowedSymbols || []).map(pairLabel), maxNotionalUsdt: live.maxNotionalUsdt || 50 });
  const [form, setForm] = useState(buildForm);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(buildForm()), [requested, live.acknowledged, live.maxNotionalUsdt, JSON.stringify(live.grayAllowedSymbols || [])]);
  const readiness = data.readiness?.checks || [];
  const check = (key) => readiness.find((row) => row.key === key)?.configured === true;
  const gates = [
    [t("交易权限", "Trading permissions"), Boolean(data.agentStatus?.activeMandate)],
    [t("账户同步", "Account sync"), check("private_rest_positions")],
    [t("禁止提现", "No withdrawals"), check("withdraw_permission_detection")],
    [t("审计链", "Audit chain"), check("audit_chain")],
    [t("紧急停止未触发", "Emergency stop clear"), !data.system?.killSwitch]
  ];
  async function save() {
    if (form.mode !== "observe" && !form.acknowledged) return ui.notify?.(t("开启真实交易前必须确认资金风险", "Acknowledge real-money risk before enabling live trading"));
    const allowedSymbols = [...new Set((form.symbols || []).map(pairLabel).filter(Boolean))];
    setSaving(true);
    try {
      const ok = await submitMobileRiskChange(action, "/api/config/live-trading", { requestedMode: form.mode, acknowledged: form.acknowledged, allowedSymbols, maxNotionalUsdt: Number(form.maxNotionalUsdt || 50) });
      if (ok) onDone();
    } finally { setSaving(false); }
  }
  return <div className="mScreen mRiskDetail">
    <section className="mNativeSection"><header><div><b>{t("执行方式", "Execution mode")}</b><small>{t("选择系统可以走到哪一步", "Choose how far the system may execute")}</small></div></header><div className="mModePicker">{[["observe", t("观察", "Observe"), t("只分析，不向交易所发单", "Analyze only; never submit")], ["semi_auto", t("半自动", "Semi-auto"), t("每笔真实交易由你确认", "You approve every live trade")], ["full_auto", t("全自动", "Full auto"), t("额度内自动执行", "Auto-execute within limits")]].map(([id, title, desc]) => <button type="button" className={form.mode === id ? `active ${id}` : id} key={id} onClick={() => setForm((current) => ({ ...current, mode: id }))}><span><b>{title}</b><small>{desc}</small></span><i /></button>)}</div></section>
    <section className="mNativeSection"><header><div><b>{t("小额验证范围", "Small-size validation")}</b><small>{t("从可交易合约中点选；不选则沿用交易权限", "Tap tradable contracts; select none to use trading permissions")}</small></div></header><div className="mRiskFieldStack"><MobilePairMultiPicker value={form.symbols} onChange={(symbols) => setForm((current) => ({ ...current, symbols }))} instruments={instrumentState.instruments} instrumentsLoading={instrumentState.loading} instrumentsError={instrumentState.error} instrumentsStale={instrumentState.stale} instrumentsAsOf={instrumentState.asOf} onRetry={instrumentState.retry} allowEmpty fallbackHint={t("当前未单独限制验证币种", "No separate validation-pair limit")} /><MobileRiskField label={t("单笔最高金额", "Max per trade")} suffix="USDT"><input type="number" min="1" inputMode="decimal" value={form.maxNotionalUsdt} onChange={(event) => setForm((current) => ({ ...current, maxNotionalUsdt: event.target.value }))} /></MobileRiskField></div></section>
    <section className="mNativeSection"><header><div><b>{t("上线检查", "Launch checks")}</b><small>{gates.filter(([, ok]) => ok).length}/{gates.length} {t("项通过", "passed")}</small></div></header><div className="mGateList">{gates.map(([label, ok]) => <div key={label}><span className={ok ? "ok" : "bad"}>{ok ? "✓" : "!"}</span><b>{label}</b><small>{ok ? t("已通过", "Ready") : t("待完成", "Needs attention")}</small></div>)}</div><label className="mNativeToggle mRiskAck"><span><b>{t("我已了解真实资金交易风险", "I understand the risks of live trading")}</b><small>{t("真实订单可能造成资金损失", "Live orders can result in financial loss")}</small></span><input type="checkbox" checked={form.acknowledged} onChange={(event) => setForm((current) => ({ ...current, acknowledged: event.target.checked }))} /></label></section>
    <div className="mRiskSaveBar"><button type="button" disabled={saving} onClick={save}>{saving ? t("保存中…", "Saving…") : t("保存执行设置", "Save execution settings")}</button></div>
  </div>;
}

function MobileRiskGoalEditor({ data, action, ui, onDone }) {
  const sys = data.system || {};
  const [dailyGoal, setDailyGoal] = useState(sys.dailyGoalUsdt ?? "");
  const [enabled, setEnabled] = useState(sys.dailyGoalBreakevenEnabled === true);
  const [saving, setSaving] = useState(false);
  async function save() {
    const amount = Number(dailyGoal);
    if (enabled && (!Number.isFinite(amount) || amount <= 0)) return ui.notify?.(t("先填写大于 0 的每日盈利目标", "Enter a daily profit goal greater than zero"));
    setSaving(true);
    try {
      const ok = await submitMobileRiskChange(action, "/api/system/goals", { dailyGoalUsdt: Number.isFinite(amount) && amount > 0 ? amount : null, dailyGoalBreakevenEnabled: enabled });
      if (ok) onDone();
    } finally { setSaving(false); }
  }
  return <div className="mScreen mRiskDetail"><section className="mNativeSection"><header><div><b>{t("盈利目标", "Profit goal")}</b><small>{t("目标不会参与开仓决策", "The goal never influences entry decisions")}</small></div></header><div className="mRiskFieldStack"><MobileRiskField label={t("每日盈利目标", "Daily profit goal")} hint={t(`月度目标按当月 ${sys.monthlyGoalDays || 30} 天自动派生`, `Monthly goal is derived using ${sys.monthlyGoalDays || 30} days`)} suffix="USDT"><input type="number" min="0.01" step="0.01" inputMode="decimal" value={dailyGoal} onChange={(event) => setDailyGoal(event.target.value)} /></MobileRiskField></div><label className="mNativeToggle mGoalNative"><span><b>{t("达到目标后保护到开仓价", "Protect at entry after reaching the goal")}</b><small>{t("只收紧 AI 仓位的止损；不会放宽止损，也不改变止盈", "Only tightens stops on AI positions; never loosens stops or changes take-profit")}</small></span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /></label></section><div className="mRiskNote"><ShieldCheck size={17}/><p>{t("这是持仓后的降风险动作，不会为了完成目标而追单。", "This is a post-entry risk reduction; the AI will never chase trades to hit the goal.")}</p></div><div className="mRiskSaveBar"><button type="button" disabled={saving} onClick={save}>{saving ? t("保存中…", "Saving…") : t("保存盈利保护", "Save profit protection")}</button></div></div>;
}

function MobileRisk({ data, action, ui, view = "all", onOpen = () => {} }) {
  const showOverview = view === "all" || view === "overview";
  const showSettings = view === "all" || view === "settings";
  const mandate = data.agentStatus?.activeMandate || data.mandates?.[0] || {};
  const sys = data.system || {};
  const portfolio = data.portfolio || {};
  const rules = data.riskRules || [];
  const maxLeverage = mandate.max_leverage || (mandate.maxLeverageBySymbol ? Math.max(1, ...Object.values(mandate.maxLeverageBySymbol)) : null);
  const budgetRemain = sys.remainingDailyLossUsdt;
  const budgetCap = sys.dailyLossCapUsdt;
  const budgetPct = budgetCap ? Math.max(0, Math.min(100, (Number(budgetRemain) / Number(budgetCap)) * 100)) : null;
  const killed = sys.killSwitch;
  const active = ["running", "active"].includes(mandate.status);
  // 授权≠低风险：有真实风险等级就用它，否则显示"已授权·风险待评估"，不写死"低风险"。
  const rLabel = /高|中|低/.test(portfolio.riskLabel || "") ? portfolio.riskLabel : null;
  const wall = killed ? { label: t("紧急停止中 · 已阻止新开仓", "Emergency stop active · new entries blocked"), tone: "critical" }
    : active ? { label: rLabel ? `${rLabel} · ${t("运行中", "Running")}` : t("已授权 · 风险待评估", "Authorized · risk pending"), tone: rLabel === "高风险" ? "critical" : rLabel === "中风险" ? "warning" : rLabel ? "ok" : "warning" }
    : { label: t("未授权 · 观察模式", "Not authorized · observe mode"), tone: "warning" };
  const groups = [["账户", "#2A6FDB", "#EAF0FB"], ["交易", "#1F7A50", "#E6F1EA"], ["事件", "#D06A22", "#FBEDDF"], ["系统", "#7A4FD0", "#F0EAFB"]];
  // scope 真实取值是英文(trade/account/event/knowledge),此前中文 includes 恒 0 → 永远"无规则"(审计 M3)
  const scopeOf = (r) => { const t = String(r.scope || r.category || r.name || "").toLowerCase(); if (/account|portfolio|loss|margin|equity|账户/.test(t)) return "账户"; if (/event|事件/.test(t)) return "事件"; if (/system|knowledge|kill|api|系统/.test(t)) return "系统"; return "交易"; };
  const scopeCount = (name) => rules.filter((r) => scopeOf(r) === name).length;
  return (
    <div className="mScreen">
      {showOverview && <div className={`mRiskWall ${wall.tone}`}>
        <ShieldCheck size={22} />
        <div><b>{wall.label}</b><small>{active ? t("交易权限与硬风控生效中", "Trading permissions and hard risk controls are active") : t("先配置交易权限，再开启自主交易", "Configure trading permissions before enabling autonomous trading")}</small></div>
      </div>}
      {showOverview && <div className="mCard mBudgetCard">
        <div className="mBudgetTop"><span>{t("剩余亏损预算", "Remaining loss budget")}</span><b className="mono">{budgetRemain != null ? `${displayMoney(budgetRemain, 2)} USDT` : t("未授权", "Not authorized")}</b></div>
        <div className="mBudgetBar"><i style={{ width: `${budgetPct ?? 0}%` }} /></div>
      </div>}
      {showOverview && (() => {
        // 风险事件处理:按标题折叠去重、显条数,逐组/一键标记已处理(接 close / close-all)。移动版此前完全没有。
        const openInc = (data.riskIncidents || []).filter((i) => i.status === "open");
        const incGroups = [];
        for (const inc of openInc) { const k = inc.title || inc.source || "风险事件"; const g = incGroups.find((x) => x.key === k); if (g) { g.count += 1; g.items.push(inc); } else incGroups.push({ key: k, count: 1, items: [inc] }); }
        return <div className="mCard">
          <div className="mCardHead"><b>{t("风险事件", "Risk incidents")}</b><span className={openInc.length ? "mIncCount on" : "mIncCount"}>{openInc.length ? `${openInc.length} ${t("项未处理", "unresolved")}` : t("全部已处理", "All resolved")}</span></div>
          {!openInc.length && <div className="mEmpty">{t("当前没有未处理的风险事件。", "No unresolved risk incidents.")}</div>}
          {incGroups.map((g) => (
            <div className="mIncRow" key={g.key}>
              <div className="mIncL"><b>{g.key}</b>{g.count > 1 && <span className="mIncX">×{g.count}</span>}</div>
              <button className="mIncBtn" onClick={async () => { for (const inc of g.items) await action(`/api/risk/incidents/${inc.id}/close`, {}); ui.notify?.(t("已处理", "Resolved")); }}>{g.count > 1 ? `${t("处理", "Resolve")} ${g.count}${t(" 项", "")}` : t("标记已处理", "Mark resolved")}</button>
            </div>
          ))}
          {openInc.length > 1 && <button className="mLink2" onClick={() => action("/api/risk/incidents/close-all", {})}>{t("全部标记已处理", "Mark all resolved")} ›</button>}
        </div>;
      })()}
      {showSettings && <><div className="mSettingsIntro"><b>{t("风险边界", "Risk boundaries")}</b><p>{t("按交易权限、执行方式和盈利保护分别设置；修改后立即进入硬风控。", "Configure permissions, execution, and profit protection separately; saved changes enter hard risk control immediately.")}</p></div><section className="mNativeSection mRiskSettingsList"><button type="button" className="mRiskSettingRow" onClick={() => onOpen("permissions")}><span className="mRiskSettingIcon permission"><Shield size={18}/></span><span><b>{t("交易权限", "Trading permissions")}</b><small>{(mandate.allowedSymbols || []).join(" · ") || t("尚未设置币种", "No pairs configured")} · {maxLeverage ? `${maxLeverage}x` : "—"}</small></span><StatusBadge tone={active ? "ok" : "neutral"}>{active ? t("生效中", "Active") : t("未启用", "Off")}</StatusBadge><ChevronRight size={15}/></button><button type="button" className="mRiskSettingRow" onClick={() => onOpen("live")}><span className="mRiskSettingIcon live"><Zap size={18}/></span><span><b>{t("执行方式与实盘验证", "Execution & live validation")}</b><small>{localizeText(data.automationState?.label) || (data.config?.liveTrading?.effective ? t("实盘已开启", "Live on") : t("只分析，不下单", "Analyze only"))} · {data.config?.liveTrading?.maxNotionalUsdt || 50} USDT</small></span><StatusBadge tone={data.config?.liveTrading?.effective ? "danger" : "neutral"}>{data.config?.liveTrading?.effective ? t("实盘", "Live") : t("观察", "Observe")}</StatusBadge><ChevronRight size={15}/></button><button type="button" className="mRiskSettingRow" onClick={() => onOpen("goal")}><span className="mRiskSettingIcon goal"><Gauge size={18}/></span><span><b>{t("盈利目标保护", "Profit goal protection")}</b><small>{sys.dailyGoalUsdt ? `${sys.dailyGoalUsdt} USDT / ${t("日", "day")}` : t("未设置每日目标", "No daily goal")}</small></span><StatusBadge tone={sys.dailyGoalBreakevenEnabled ? "ok" : "neutral"}>{sys.dailyGoalBreakevenEnabled ? t("已开启", "On") : t("未开启", "Off")}</StatusBadge><ChevronRight size={15}/></button></section><section className="mNativeSection"><header><div><b>{t("当前硬边界", "Current hard limits")}</b><small>{t("只读摘要；点交易权限修改", "Read-only summary; edit in Trading permissions")}</small></div></header><div className="mRiskBoundaryGrid"><span><small>{t("单笔风险", "Per-trade risk")}</small><b className="mono">{mandate.maxSingleTradeRiskPct ?? "—"}%</b></span><span><small>{t("日亏损", "Daily loss")}</small><b className="mono neg">{mandate.maxDailyLossPct ?? "—"}%</b></span><span><small>{t("7 日亏损", "7-day loss")}</small><b className="mono neg">{mandate.maxWeeklyLossPct ?? mandate.max_weekly_loss_pct ?? "—"}%</b></span><span><small>{t("单笔金额", "Order max")}</small><b className="mono">{mandate.maxOrderNotionalUsdt ?? "—"} U</b></span></div></section></>}
      {showOverview && <div className="mCard">
        <div className="mCardHead"><b>{t("风险规则", "Risk rules")}</b></div>
        <div className="mRuleGrid2">{groups.map(([name, c, bg]) => { const n = scopeCount(name); const label = { "账户": t("账户", "Account"), "交易": t("交易", "Trading"), "事件": t("事件", "Events"), "系统": t("系统", "System") }[name] || name; return <div className="mRuleCard2" key={name} style={{ background: bg }}><b style={{ color: c }}>{label}</b><small>{n ? `${n} ${t("条已启用", "enabled")}` : t("无规则", "No rules")}</small><i style={{ background: c }} /></div>; })}</div>
      </div>}
      {showOverview && <div className="mRiskBtns">
        <button className="mRbPause" onClick={() => action("/api/system/autonomy", { enabled: false })}>{t("暂停自主", "Pause autonomy")}</button>
        <button className="mRbReduce" onClick={async () => { const on = Boolean(data.system?.reduceOnlyMode); if (await uiConfirm(on ? t("关闭只减仓模式?", "Turn off reduce-only mode?") : t("开启只减仓模式?将禁止新开仓,仅允许减仓/平仓/撤单。", "Turn on reduce-only mode? New positions will be blocked; only reduce/close/cancel allowed."))) action("/api/risk/reduce-only", { enabled: !on }); }}>{data.system?.reduceOnlyMode ? t("退出只减仓", "Exit reduce-only") : t("只减仓", "Reduce-only")}</button> {/* 此前只是打开规则面板,不减仓(审计 M2) */}
        <button className="mRbKill" onClick={() => action("/api/risk/kill-switch", { enabled: !killed, reason: "" })}>{killed ? t("恢复新交易", "Resume trading") : t("紧急停止", "Emergency stop")}</button>
      </div>}
    </div>
  );
}

const KNOW_SEGMENTS = ["上手", "方法", "技能", "规则", "图谱"];
function MobileKnowledge({ data, action, ui, view = "all" }) {
  // 与桌面对齐:知识库(view=knowledge)只留 上手/方法/规则/图谱;能力与工具(view=capabilities)只留 技能。
  const segs = view === "capabilities" ? ["技能"] : view === "knowledge" ? ["上手", "方法", "规则", "图谱"] : KNOW_SEGMENTS;
  const [segState, setSeg] = useState(view === "capabilities" ? "技能" : "上手");
  const seg = segs.includes(segState) ? segState : segs[0];
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const knowledge = data.knowledge || {};
  const sources = knowledge.sources || [];
  const methods = knowledge.tradingMethods || [];
  const skills = knowledge.tradingSkills || [];
  const rules = knowledge.ruleProposals || [];
  const compiledIds = new Set(skills.filter((s) => !["retired", "superseded"].includes(s.status)).map((s) => s.sourceMethodId));
  const active = skills.filter((s) => s.status === "active").length;
  const inPipe = skills.filter((s) => !["retired", "superseded", "compile_failed", "active"].includes(s.status)).length;
  // 当前该做哪一步：没知识源→喂料；有草案没进流水线→编译验证；进了流水线没上岗→批准；已上岗→完成。
  const step = sources.length === 0 ? 1 : (active === 0 && inPipe === 0) ? 2 : active === 0 ? 3 : 4;
  const guide = [
    { n: 1, Icon: BookOpen, title: t("喂知识", "Feed knowledge"), desc: t("导入交易书籍或文章，自动蒸馏出方法与风控纪律。", "Import trading books or articles; methods and risk discipline are distilled automatically."), cta: t("导入知识源", "Import source"), on: () => ui.openPanel("knowledgeImport") },
    { n: 2, Icon: Rocket, title: t("编译 + 验证", "Compile + validate"), desc: t("把方法编译成技能，跑历史回测 + 纯前向模拟盘。", "Compile methods into skills, run historical backtest + pure forward paper trading."), cta: t("去方法", "Go to methods"), on: () => setSeg("方法") },
    { n: 3, Icon: ShieldCheck, title: t("人工批准上岗", "Manual approval"), desc: t("只有你亲自批准的技能才进入实盘决策。", "Only skills you personally approve enter live decision-making."), cta: t("去技能", "Go to skills"), on: () => setSeg("技能") }
  ];

  async function search() {
    if (!query.trim()) return;
    const result = await action("/api/knowledge/rag-query", { query: query.trim(), topK: 5 });
    // 后端返回 analysisBundle{summary,retrievedRefs[]},没有 hits/results/chunks(此前永远"没有命中",审计 H6)
    const refs = (result.retrievedRefs || []).map((r) => ({ text: r.citationLocator, score: r.score }));
    setHits(result.id ? [{ text: result.summary, score: null }, ...refs] : []);
  }

  return (
    <div className="mSubPage">
      <div className="mChips">
        {segs.map((name) => <button key={name} className={seg === name ? "active" : ""} onClick={() => setSeg(name)}>{name}{name === "方法" && methods.length ? ` ${methods.length}` : ""}{name === "技能" && skills.length ? ` ${skills.filter((k) => !["compile_failed", "superseded", "retired"].includes(k.status)).length}` : ""}{name === "规则" && rules.length ? ` ${rules.length}` : ""}{name === "图谱" && knowledge.conceptCards?.length ? ` ${knowledge.conceptCards.length}` : ""}</button>)}
      </div>

      {seg === "上手" && (
        <>
          <div className="mKGuide">
            <div className="mKGuideTitle"><Sparkles size={14} /> {t("知识库怎么用？三步让 AI 交易员变强", "How to use the knowledge base? Three steps to sharpen your AI trader")}</div>
            {guide.map((s) => {
              const state = s.n < step ? "done" : s.n === step ? "active" : "todo";
              const Icon = state === "done" ? CheckCircle2 : s.Icon;
              return (
                <div className={`mKStep ${state}`} key={s.n}>
                  <span className="mKStepIcon"><Icon size={16} /></span>
                  <div className="mKStepBody">
                    <b>{s.title}{state === "active" && <em>{t(" · 现在做这步", " · do this now")}</em>}{state === "done" && <em className="ok">{t(" · 已完成", " · done")}</em>}</b>
                    <p>{s.desc}</p>
                    <button className={state === "active" ? "mMiniPrimary" : "mMiniGhost"} onClick={s.on}>{s.cta} ›</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mPageStats">
            <div><span>{t("知识源", "Sources")}</span><strong>{sources.length}</strong></div>
            <div><span>{t("交易方法", "Methods")}</span><strong>{methods.length}</strong></div>
            <div><span>{t("已上岗技能", "Live skills")}</span><strong>{active}</strong></div>
          </div>

          <div className="mSearchBar">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("检索知识库，如：CPI 前如何控仓", "Search the knowledge base, e.g. how to size before CPI")} onKeyDown={(event) => { if (event.key === "Enter") search(); }} />
            <button onClick={search} aria-label={t("检索", "Search")}><Search size={16} /></button>
          </div>
          {hits !== null && (
            <div className="mSectionCard">
              <header><span>{t("检索结果（", "Results (")}{hits.length}{t("）", ")")}</span></header>
              {!hits.length && <p className="mInboxEmpty">{t("没有命中的知识片段。", "No matching knowledge snippets.")}</p>}
              {hits.slice(0, 5).map((hit, index) => <p className="mLeadLine" key={index}>{String(hit.text || "").slice(0, 120)}{hit.score != null ? ` · ${hit.score}` : ""}</p>)}
            </div>
          )}

          <div className="mSectionCard">
            <header><span>{t("知识源（", "Sources (")}{sources.length}{t("）", ")")}</span><button className="textButton" onClick={() => ui.openPanel("knowledgeList")}>{t("全部", "All")} <ChevronRight size={12} /></button></header>
            {!sources.length && <p className="mInboxEmpty">{t("还没有导入知识。点下方「导入知识」开始。", "No knowledge imported yet. Tap \"Import knowledge\" below to start.")}</p>}
            {sources.slice(0, 8).map((source) => (
              <div className="mRowItem" key={source.id || source.title}>
                <b>{source.title || source.name || t("未命名", "Untitled")}</b>
                <StatusBadge tone={statusTone(source.status)}>{humanize(source.status, t("已导入", "Imported"))}</StatusBadge>
              </div>
            ))}
          </div>
          <button className="mPrimaryAction" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={15} /> {t("导入知识", "Import knowledge")}</button>
        </>
      )}

      {seg === "方法" && (
        <div className="mSectionCard">
          <header><span>{t("交易方法草案（", "Method drafts (")}{methods.length}{t("）", ")")}</span><small>{t("需走验证才上岗", "Must pass validation to go live")}</small></header>
          {!methods.length && <p className="mInboxEmpty">{t("导入书籍后自动蒸馏交易方法草案。", "Method drafts are distilled automatically after importing books.")}</p>}
          {methods.map((m) => {
            const compiled = compiledIds.has(m.id);
            const open = openId === m.id;
            return (
              <div className={`mKRow ${open ? "open" : ""}`} key={m.id}>
                <button className="mKRowHead" onClick={() => setOpenId(open ? null : m.id)}>
                  <span className={`mDir ${m.direction}`}>{m.direction === "short" ? t("空", "Short") : m.direction === "long" ? t("多", "Long") : t("多空", "Both")}</span>
                  <b>{m.name}</b>
                  <StatusBadge tone={compiled ? "ok" : "neutral"}>{compiled ? t("已编译", "Compiled") : t("草案", "Draft")}</StatusBadge>
                </button>
                {open && (
                  <div className="mKRowBody">
                    <p><i>{t("进场", "Entry")}</i>{m.entry || "-"}</p>
                    <p><i>{t("止损", "Stop-loss")}</i>{m.stop || "-"}</p>
                    <p><i>{t("止盈", "Take-profit")}</i>{m.takeProfit || "-"}</p>
                    {m.source?.title && <p className="mKSrc">《{m.source.title}》</p>}
                    {!compiled && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/methods/${m.id}/compile`, {})}>{t("编译为技能草案", "Compile to skill draft")} ›</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {seg === "技能" && (
        <div className="mSectionCard">
          <header><span>{t("技能流水线（", "Skill pipeline (")}{skills.length}{t("）", ")")}</span><span style={{ display: "flex", gap: 8 }}>{(() => { const n = skills.filter((skill) => ["compiled", "historical_rejected"].includes(skill.status)).length; return n > 0 && <button className="textButton" onClick={async () => { if (await uiConfirm(`${t("批量历史验证", "Batch historical validation for")} ${n} ${t("个技能?", "skills?")}`)) action("/api/knowledge/skills/validate-all", {}); }}>{t("一键验证", "Validate all")}({n})</button>; })()}<button className="textButton" onClick={() => action("/api/knowledge/skills/sync", {})}>{t("同步", "Sync")}</button></span></header>
          <div className="mKLegend">
            <button className="mKLegendHead" onClick={() => setLegendOpen((v) => !v)}><Info size={13} /> {t("这些状态是什么意思？", "What do these statuses mean?")}<ChevronDown size={13} className={legendOpen ? "flip" : ""} /></button>
            {legendOpen && SKILL_STATE_HELP.map(([label, tone, desc]) => (
              <div className="mKLegendRow" key={label}><StatusBadge tone={tone}>{label}</StatusBadge><span>{desc}</span></div>
            ))}
          </div>
          {!skills.length && <p className="mInboxEmpty">{t("还没有技能。到「方法」把方法编译成技能草案后在此推进验证。", "No skills yet. Go to Methods, compile a method into a skill draft, then advance validation here.")}</p>}
          {(() => {
            const ARCHIVED = new Set(["compile_failed", "superseded", "retired"]);
            const STATUS_RANK = { paper_validated: 0, historical_validated: 1, paper_validating: 2, compiled: 3, degraded: 4, historical_rejected: 5, paper_rejected: 6 };
            const live = skills.filter((s) => !ARCHIVED.has(s.status))
              .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9));
            const archived = skills.filter((s) => ARCHIVED.has(s.status));
            const row = (skill) => {
              const st = SKILL_STATE[skill.status] || { label: skill.status, tone: "neutral" };
              const open = openId === skill.id;
              return (
                <div className={`mKRow ${open ? "open" : ""}`} key={skill.id}>
                  <button className="mKRowHead" onClick={() => setOpenId(open ? null : skill.id)}>
                    {skill.spec?.direction && <span className={`mDir ${skill.spec.direction}`}>{skill.spec.direction === "short" ? t("空", "Short") : t("多", "Long")}</span>}
                    <b>{skill.name} <span className="mono">v{skill.version}</span></b>
                    {skill.spec?.lowTrust && <StatusBadge tone="warning">{t("低信任", "Low trust")}</StatusBadge>}
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </button>
                  {open && (
                    <div className="mKRowBody">
                      <p className="mKSrc">{skill.spec?.templateLabel || t("未编译", "Not compiled")} · {skill.spec?.timeframe || "-"}{skill.sourceTitle ? ` · 《${skill.sourceTitle}》` : ""}</p>
                      {skill.compileErrors?.length > 0 && <p className="mKErr">{t("不能执行：", "Cannot execute: ")}{skill.compileErrors.join(t("；", "; "))}</p>}
                      {skill.status === "superseded" && <p className="mKSrc">{t("已被更新版本替代，仅作追溯。", "Superseded by a newer version; kept for traceability.")}</p>}
                      {skill.liveMetrics && <p><i>{t("实盘", "Live")}</i>{skill.liveMetrics.trades}{t(" 笔 · 胜率 ", " trades · Win ")}{skill.liveMetrics.winRatePct}%</p>}
                      {st.next && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/skills/${skill.id}/${st.next.action}`, {})}>{st.next.label} ›</button>}
                      {skill.status === "compile_failed" && skill.sourceMethodId && <button className="mMiniPrimary" onClick={() => action(`/api/knowledge/methods/${skill.sourceMethodId}/compile`, {})}>{t("重新编译", "Recompile")} ›</button>}
                    </div>
                  )}
                </div>
              );
            };
            return (
              <>
                {live.map(row)}
                {!live.length && skills.length > 0 && <p className="mInboxEmpty">{t("当前没有在流水线中的活技能，只有归档技能。", "No active skills in the pipeline, only archived skills.")}</p>}
                {archived.length > 0 && (
                  <>
                    <div className="mKArchiveHead">
                      <button onClick={() => setArchivedOpen((v) => !v)}><ChevronDown size={12} className={archivedOpen ? "flip" : ""} /> {t("已归档", "Archived")} {archived.length}</button>
                      <button className="mKArchivePurge" onClick={async () => { if (await uiConfirm(t("清理归档：删除编译失败与已被替代的技能？（已退役保留）", "Purge archive: delete compile-failed and superseded skills? (retired ones are kept)"))) action("/api/knowledge/skills/purge-archived", {}); }}><Trash2 size={11} /> {t("清理", "Purge")}</button>
                    </div>
                    {archivedOpen && archived.map(row)}
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}

      {seg === "规则" && (
        <div className="mSectionCard">
          <header><span>{t("风控纪律（", "Risk discipline (")}{rules.length}{t("）", ")")}</span><button className="textButton" onClick={() => ui.openPanel("ruleLibrary")}>{t("管理/去重", "Manage/dedupe")} <ChevronRight size={12} /></button></header>
          {!rules.length && <p className="mInboxEmpty">{t("导入资料后自动抽取风控纪律。", "Risk discipline is extracted automatically after importing material.")}</p>}
          {rules.slice(0, 20).map((r) => (
            <div className="mRowItem" key={r.id}>
              <b>{r.name}</b>
              <StatusBadge tone={r.status === "已批准" ? "ok" : "warning"}>{humanize(r.status, t("待审批", "Pending approval"))}</StatusBadge>
            </div>
          ))}
          {rules.length > 0 && <button className="mPrimaryAction" onClick={() => ui.openPanel("ruleLibrary")}>{t("去规则库批准 / 去重", "Approve / dedupe in rule library")} ›</button>}
        </div>
      )}

      {seg === "图谱" && (
        <div className="mSectionCard">
          <header><span>{t("概念图谱（", "Concept graph (")}{knowledge.conceptCards?.length || 0}{t("）", ")")}</span><small>{t("相关概念自动聚簇", "Related concepts cluster automatically")}</small></header>
          <ConceptGraph concepts={knowledge.conceptCards || []} />
        </div>
      )}
    </div>
  );
}

const taskSegments = ["重要事件", "定时任务", "创建任务"];

function mobileDateKey(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function mobileEventDateKey(event = {}) {
  const value = event.due || event.startAt;
  if (event.timePrecision === "date" && /^\d{4}-\d{2}-\d{2}/.test(String(value || ""))) return String(value).slice(0, 10);
  return mobileDateKey(value);
}

function mobileEventTimeLabel(event = {}) {
  return event.timePrecision === "date" ? t("全天 · 时间待定", "All day · time TBD") : formatTime(event.due || event.startAt, t("时间待定", "Time TBD"));
}

export function shiftMobileCalendarSelection(monthAnchor, selectedDate, offset) {
  const current = new Date(monthAnchor);
  const target = new Date(current.getFullYear(), current.getMonth() + offset, 1);
  const selectedDay = Math.max(1, Math.min(Number(String(selectedDate || "").slice(8, 10)) || 1, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
  const nextSelectedDate = mobileDateKey(new Date(target.getFullYear(), target.getMonth(), selectedDay));
  return { monthAnchor: target, selectedDate: nextSelectedDate };
}

export async function refreshMobileEventCalendar(action) {
  const eventSources = await action("/api/event-sources/refresh", {});
  const marketIntelligence = await action("/api/market-intelligence/refresh", {});
  return { eventSources, marketIntelligence };
}

export function refreshMobileIntelligence(action) {
  return action("/api/market-intelligence/refresh", {});
}

export function MobileTasks({ data, action }) {
  const [segment, setSegment] = useState("重要事件");
  const now = new Date();
  const [monthAnchor, setMonthAnchor] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => mobileDateKey(now));
  const allEvents = buildEventRows(data, t).slice().sort((a, b) => new Date(a.due || a.startAt || 8640000000000000) - new Date(b.due || b.startAt || 8640000000000000));
  const tasks = data.tasks || [];
  const activeTasks = tasks.filter((task) => task.enabled !== false);
  const todayEvents = allEvents.filter((event) => mobileEventDateKey(event) === mobileDateKey(now));
  const selectedEvents = allEvents.filter((event) => mobileEventDateKey(event) === selectedDate);
  const upcoming = allEvents.filter((event) => new Date(event.due || event.startAt).getTime() >= new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()).slice(0, 5);
  const year = monthAnchor.getFullYear();
  const month = monthAnchor.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = t(`${year} 年 ${month + 1} 月`, `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month]} ${year}`);
  const eventCountByDate = allEvents.reduce((map, event) => {
    const key = mobileEventDateKey(event);
    if (key) (map[key] ||= []).push(event);
    return map;
  }, {});
  const calendarDays = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    const date = new Date(year, month, day);
    const inMonth = day >= 1 && day <= daysInMonth;
    const key = mobileDateKey(date);
    return { date, key, day: date.getDate(), inMonth, events: inMonth ? (eventCountByDate[key] || []) : [] };
  });
  const moveMonth = (offset) => {
    const next = shiftMobileCalendarSelection(monthAnchor, selectedDate, offset);
    setMonthAnchor(next.monthAnchor);
    setSelectedDate(next.selectedDate);
  };
  const backToday = () => { const current = new Date(); setMonthAnchor(new Date(current.getFullYear(), current.getMonth(), 1)); setSelectedDate(mobileDateKey(current)); };
  return (
    <div className="mSubPage">
      <div className="mPageStats">
        <div><span>{t("今日事件", "Today's events")}</span><strong>{todayEvents.length}</strong></div>
        <div><span>{t("活跃任务", "Active tasks")}</span><strong>{activeTasks.length}</strong></div>
        <div><span>{t("事件规则", "Event rules")}</span><strong>{(data.riskRules || []).filter((rule) => rule.scope === "event").length}</strong></div>
      </div>

      <div className="mChips">
        {taskSegments.map((name) => (
          <button key={name} className={segment === name ? "active" : ""} onClick={() => setSegment(name)}>{t(name, { "重要事件": "Calendar", "定时任务": "Tasks", "创建任务": "Create" }[name])}</button>
        ))}
      </div>

      {segment === "重要事件" && (
        <>
          <section className="mEventCalendar">
            <header><button type="button" onClick={() => moveMonth(-1)} aria-label={t("上个月", "Previous month")}><ChevronLeft size={17}/></button><b>{monthLabel}</b><button type="button" onClick={() => moveMonth(1)} aria-label={t("下个月", "Next month")}><ChevronRight size={17}/></button><button type="button" className="today" onClick={backToday}>{t("今天", "Today")}</button></header>
            <div className="mEventWeek">{[t("日", "S"), t("一", "M"), t("二", "T"), t("三", "W"), t("四", "T"), t("五", "F"), t("六", "S")].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div>
            <div className="mEventDays">{calendarDays.map((day) => <button type="button" key={day.key} disabled={!day.inMonth} className={`${day.inMonth ? "" : "out"} ${day.key === selectedDate ? "selected" : ""} ${day.key === mobileDateKey(now) ? "today" : ""}`} onClick={() => setSelectedDate(day.key)}><b>{day.day}</b><span>{day.events.slice(0, 3).map((event, index) => <i key={`${event.id || event.title}-${index}`} className={Number(event.impact) >= 80 ? "high" : Number(event.impact) >= 50 ? "medium" : "low"}/>)}</span></button>)}</div>
            <footer><span>{t("圆点表示当天有事件，颜色表示影响等级", "Dots mark events; color shows impact")}</span><button className="textButton" onClick={() => refreshMobileEventCalendar(action)}><RefreshCw size={12}/> {t("刷新事件", "Refresh")}</button></footer>
          </section>
          <section className="mEventAgenda">
            <header><div><b>{selectedDate === mobileDateKey(now) ? t("今天的议程", "Today's agenda") : formatDate(selectedDate)}</b><small>{selectedEvents.length ? t(`${selectedEvents.length} 个已确认事件`, `${selectedEvents.length} confirmed events`) : t("当天没有已确认事件", "No confirmed events that day")}</small></div></header>
            {selectedEvents.map((event) => <article key={event.id || `${event.title}-${event.due || event.startAt}`}>
              <time>{mobileEventTimeLabel(event)}</time><span className={Number(event.impact) >= 80 ? "high" : Number(event.impact) >= 50 ? "medium" : "low"}/><div><b>{localizeText(event.shortTitle || event.title)}</b><small>{localizeText(event.source || event.category || t("事件日历", "Event calendar"))} · {event.impactLabel || t("影响待评估", "Impact pending")}</small>{(event.description || event.summary) && <p>{localizeText(event.description || event.summary)}</p>}</div>
            </article>)}
            {!selectedEvents.length && <div className="mNativeEmpty compact"><CalendarClock size={20}/><b>{t("可以安心查看其他日期", "Choose another date")}</b><span>{t("没有精确事件就保持空白，不推测发生时间。", "The calendar stays empty when no exact event is verified.")}</span></div>}
          </section>
          {upcoming.length > 0 && <section className="mSectionCard mUpcomingEvents"><header><span>{t("接下来", "Up next")}</span></header>{upcoming.map((event) => <button type="button" className="mRowItem" key={`up-${event.id || event.title}`} onClick={() => { const key = mobileEventDateKey(event); const [eventYear, eventMonth] = key.split("-").map(Number); setSelectedDate(key); setMonthAnchor(new Date(eventYear, eventMonth - 1, 1)); }}><span>{event.timePrecision === "date" ? t("日期待定时", "Date only") : formatDate(event.due || event.startAt)}</span><b>{localizeText(event.shortTitle || event.title)}</b><ChevronRight size={14}/></button>)}</section>}
        </>
      )}

      {segment === "定时任务" && (
        <div className="mSectionCard">
          <header><span>{t("定时任务（", "Scheduled tasks (")}{tasks.length}{t("）", ")")}</span></header>
          {!tasks.length && <p className="mInboxEmpty">{t("暂无定时任务。", "No scheduled tasks.")}</p>}
          {tasks.map((task) => (
            <div className="mRuleRow" key={task.id}>
              <span>
                <b>{task.name}</b>
                <small>{task.schedule || "Every 1h"} · {humanize(task.status || "running")}</small>
              </span>
              <div className="mRowActions">
                <button onClick={() => action(`/api/tasks/${task.id}/run`, {})}>{t("运行", "Run")}</button>
                <button onClick={() => action(`/api/tasks/${task.id}/${task.enabled === false ? "resume" : "pause"}`, task.enabled === false ? {} : { reason: "manual_ui" })}>{task.enabled === false ? t("恢复", "Resume") : t("暂停", "Pause")}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {segment === "创建任务" && (
        <div className="mSectionCard">
          <TaskManagerPanel data={data} action={action} />
        </div>
      )}
    </div>
  );
}

function mobileIntelHealth(source = {}) {
  const value = String(source.health || source.status || "unknown").toLowerCase();
  if (value === "healthy" || value === "ok") return { label: t("正常", "Healthy"), tone: "ok" };
  if (value === "degraded" || value === "partial") return { label: t("部分可用", "Degraded"), tone: "warning" };
  if (value === "stale") return { label: t("已陈旧", "Stale"), tone: "warning" };
  if (value === "failed") return { label: t("失败", "Failed"), tone: "danger" };
  if (value === "unconfigured") return { label: t("未配置", "Not configured"), tone: "neutral" };
  return { label: t("待检查", "Unchecked"), tone: "neutral" };
}

function mobileMacroLabel(value) {
  if (value === "insufficient_verified_macro_data") return t("可验证宏观数据不足，不下结论", "Insufficient verified macro data; no conclusion");
  if (value === "requires_model_synthesis") return t("事实已就绪，等待综合判断", "Facts ready for synthesis");
  return localizeText(value) || t("待生成", "Pending");
}

// 情报不是第五个交易主 Tab：它是判断上下文，放在“更多”第一组更符合使用频率与风险边界。
// 页面只给摘要→快讯→来源三层渐进信息，不照搬 Web 的三栏工作台。
export function MobileIntelligence({ data, action, ui }) {
  const [segment, setSegment] = useState("brief");
  const brief = data.dailyMarketBrief || null;
  const news = (data.newsFeed || []).slice().sort((a, b) => new Date(b.publishedAt || b.observedAt || 0) - new Date(a.publishedAt || a.observedAt || 0));
  const sources = data.marketIntelligenceSourceHealth || [];
  const healthy = sources.filter((source) => ["healthy", "ok"].includes(String(source.health || source.status).toLowerCase())).length;
  const staleSources = sources.filter((source) => String(source.health || "").toLowerCase() === "stale");
  const important = news.filter((item) => item.values?.important === true || Number(item.values?.impact || item.impact || 0) >= 80);
  const intelligenceEvents = buildEventRows(data, t);
  const next24h = intelligenceEvents.filter((event) => { const due = new Date(event.due || event.startAt).getTime(); return event.timePrecision !== "date" && Number.isFinite(due) && due >= Date.now() && due <= Date.now() + 86400000; });
  const todayKey = mobileDateKey(new Date());
  const tomorrowKey = mobileDateKey(new Date(Date.now() + 86400000));
  const dateOnlySoon = intelligenceEvents.filter((event) => event.timePrecision === "date" && [todayKey, tomorrowKey].includes(mobileEventDateKey(event)));
  const updatedAt = brief?.asOf || news[0]?.observedAt || news[0]?.publishedAt || sources.map((source) => source.checkedAt).filter(Boolean).sort().at(-1);
  const segments = [
    ["brief", t("今日摘要", "Brief")],
    ["feed", t("实时快讯", "Flash")],
    ["sources", t("来源状态", "Sources")]
  ];
  return <div className="mSubPage mIntelPage">
    <section className="mIntelHero"><div><span><Sparkles size={13}/>{t("只作为分析背景", "Analysis context only")}</span><b>{t("先看结论，再按需展开证据", "Read the brief, then expand evidence")}</b><small>{updatedAt ? `${t("更新于", "Updated")} ${formatDateTime(updatedAt)}` : t("等待首次情报刷新", "Waiting for the first intelligence refresh")}</small></div><button type="button" onClick={() => refreshMobileIntelligence(action)} aria-label={t("刷新情报", "Refresh intelligence")}><RefreshCw size={16}/></button></section>
    <div className="mPageStats"><div><span>{t("重要快讯", "Important")}</span><strong>{important.length}</strong></div><div><span>{t("来源正常", "Healthy sources")}</span><strong>{healthy}/{sources.length}</strong></div><div><span>{t("近期事件", "Upcoming")}</span><strong>{next24h.length + dateOnlySoon.length}</strong></div></div>
    <div className="mChips">{segments.map(([id, label]) => <button type="button" key={id} className={segment === id ? "active" : ""} onClick={() => setSegment(id)}>{label}</button>)}</div>

    {segment === "brief" && <div className="mIntelStack">
      <section className="mSectionCard mIntelBrief"><header><span>{t("Daily 市场摘要", "Daily market brief")}</span>{brief && <StatusBadge tone="neutral">v{brief.version || 1}</StatusBadge>}</header>
        {brief ? <><div className="mIntelBriefRows"><span><small>{t("加密风险偏好", "Crypto risk appetite")}</small><b>{localizeText(brief.macroContext?.cryptoRiskAppetite) || t("未知", "Unknown")}</b></span><span><small>{t("宏观周期", "Macro cycle")}</small><b>{mobileMacroLabel(brief.macroContext?.economicCyclePhase)}</b></span><span><small>{t("证据事实", "Evidence facts")}</small><b>{(brief.evidenceFactIds || []).length}</b></span></div>{staleSources.length > 0 && <div className="mIntelConstraint high"><Globe2 size={14}/><p>{t(`${staleSources.length} 个情报来源已陈旧，不会作为当前催化剂`, `${staleSources.length} intelligence sources are stale and excluded as current catalysts`)}</p></div>}{(brief.constraints || []).slice(0, 4).map((constraint, index) => <div className={`mIntelConstraint ${constraint.severity || "medium"}`} key={`${constraint.type || "constraint"}-${index}`}><Shield size={14}/><p>{localizeText(constraint.reason)}</p></div>)}</> : <div className="mNativeEmpty compact"><Sparkles size={21}/><b>{t("日报尚未生成", "Brief not generated")}</b><span>{t("情报刷新任务完成后会自动生成；不会用旧数据补写。", "It is generated after a refresh; stale data is never used to fill gaps.")}</span></div>}
      </section>
      <section className="mSectionCard mIntelTop"><header><span>{t("需要先知道的事", "What matters now")}</span><button className="textButton" type="button" onClick={() => setSegment("feed")}>{t("全部快讯", "All flashes")}<ChevronRight size={13}/></button></header>{(brief?.topNews || news).slice(0, 4).map((item, index) => <article key={item.factId || item.id || index}><span className={Number(item.values?.impact || item.impact || 0) >= 80 ? "high" : "normal"}/><div><b>{localizeText(item.title)}</b><small>{item.summary ? localizeText(item.summary) : `${item.sourceName || item.source || t("情报源", "Intel source")} · ${formatDateTime(item.publishedAt)}`}</small></div></article>)}{!(brief?.topNews || news).length && <p className="mInboxEmpty">{t("暂无已验证快讯。", "No verified flashes yet.")}</p>}</section>
      {(next24h.length > 0 || dateOnlySoon.length > 0) && <button type="button" className="mIntelEventLink" onClick={() => ui?.setActive("eventsTasks")}><CalendarClock size={18}/><span><b>{next24h.length ? t(`未来 24 小时有 ${next24h.length} 个精确时间事件`, `${next24h.length} precisely timed events within 24h`) : t("近期有日期级事件提醒", "Upcoming date-only event reminders")}</b><small>{[...next24h.slice(0, 2).map((event) => `${mobileEventTimeLabel(event)} ${localizeText(event.shortTitle || event.title)}`), ...dateOnlySoon.slice(0, 2).map((event) => `${t("全天/时间待定", "All day/time TBD")} ${localizeText(event.shortTitle || event.title)}`)].join(" · ")}</small></span><ChevronRight size={16}/></button>}
    </div>}

    {segment === "feed" && <section className="mIntelFeed">{news.map((item, index) => { const impact = Number(item.values?.impact || item.impact || 0); return <article key={item.id || index}><header><span className={impact >= 80 ? "important" : "flash"}>{impact >= 80 || item.values?.important ? t("重要", "Important") : t("快讯", "Flash")}</span><time>{formatDateTime(item.publishedAt || item.observedAt)}</time></header><b>{localizeText(item.title)}</b>{(item.summary || item.content) && <p>{localizeText(item.summary || item.content)}</p>}<footer><span>{item.sourceName || item.source || "ME News"}</span><span>{(item.symbols || []).join(" · ") || t("全市场", "Market-wide")}</span></footer></article>; })}{!news.length && <div className="mNativeEmpty"><Bell size={22}/><b>{t("暂无实时快讯", "No live flashes")}</b><span>{t("刷新后只展示带真实来源与时间的内容。", "Only timestamped, sourced items appear after refresh.")}</span></div>}</section>}

    {segment === "sources" && <section className="mSectionCard mIntelSources"><header><span>{t("情报来源", "Intelligence sources")}</span><small>{healthy}/{sources.length} {t("正常", "healthy")}</small></header>{sources.map((source) => { const state = mobileIntelHealth(source); return <article key={source.sourceId || source.id || source.name}><span className={`mIntelSourceIcon ${state.tone}`}><Globe2 size={15}/></span><div><b>{localizeText(source.name || source.sourceId)}</b><small>{humanize(source.category, t("补充来源", "Supplemental"))} · {source.lastSuccessAt ? `${t("最近成功", "Last success")} ${formatDateTime(source.lastSuccessAt)}` : t("尚无成功记录", "No successful run yet")}</small>{source.lastError && <p>{localizeText(source.lastError)}</p>}</div><StatusBadge tone={state.tone}>{state.label}</StatusBadge></article>; })}{!sources.length && <div className="mNativeEmpty compact"><Globe2 size={20}/><b>{t("暂无来源状态", "No source status")}</b><span>{t("情报任务运行后会记录真实健康状态。", "Real health status appears after intelligence jobs run.")}</span></div>}</section>}
  </div>;
}

function MobileAccountHealth({ data, action }) {
  const latestReconcile = data.reconciliationReports?.[0];
  const latestSnapshot = data.accountSnapshots?.[0];
  const configuredAccounts = (data.exchangeAccounts || []).filter((account) => account.readEnabled).length;
  const totalAccounts = data.exchangeAccounts?.length || 0;
  const openExecutions = countOpenExecutions(data.executionOrders);
  const blockedChecks = (data.riskChecks || []).filter((item) => ["blocked", "rejected", "risk_rejected"].includes(String(item.decision || item.result || item.status || "").toLowerCase())).length;
  const rows = [
    [t("交易所账户", "Exchange accounts"), `${configuredAccounts} / ${totalAccounts}`, configuredAccounts ? "ok" : "neutral"],
    [t("私有账户快照", "Account snapshot"), latestSnapshot ? formatDateTime(latestSnapshot.createdAt) : t("未同步", "Not synced"), latestSnapshot ? "ok" : "neutral"],
    [t("对账状态", "Reconciliation"), configuredAccounts ? humanize(latestReconcile?.status, t("未对账", "Not reconciled")) : t("待配置", "Not configured"), latestReconcile?.status === "ok" ? "ok" : "neutral"],
    [t("实盘写入", "Live trading"), data.system?.liveTradingEnabled ? t("已开启", "On") : t("关闭", "Off"), data.system?.liveTradingEnabled ? "warning" : "neutral"], // 主动授权开关≠故障,与桌面口径一致用提醒色
    [t("在途执行", "In-flight executions"), `${openExecutions}${t(" 个", "")}`, openExecutions ? "warning" : "ok"],
    [t("近期风控阻断", "Recent risk blocks"), `${blockedChecks}${t(" 次", "")}`, blockedChecks ? "warning" : "ok"]
  ];
  return (
    <div className="mSubPage">
      <div className="mPageStats">
        <div><span>{t("账户", "Accounts")}</span><strong>{configuredAccounts}/{totalAccounts}</strong></div>
        <div><span>{t("快照", "Snapshot")}</span><strong>{latestSnapshot ? formatTime(latestSnapshot.createdAt) : t("未同步", "Not synced")}</strong></div>
        <div><span>{t("对账", "Reconcile")}</span><strong>{configuredAccounts ? humanize(latestReconcile?.status, t("未对账", "Not reconciled")) : t("待配置", "Not configured")}</strong></div>
      </div>

      <div className="mSectionCard">
        <header><span>{t("健康检查", "Health check")}</span></header>
        {rows.map(([label, value, tone]) => (
          <div className="mRowItem" key={label}>
            <b>{label}</b>
            <em className="mRowValue">{value}</em>
            <StatusBadge tone={tone}>{tone === "ok" ? t("正常", "OK") : tone === "danger" ? t("注意", "Attention") : tone === "warning" ? t("待处理", "Pending") : t("待配置", "Not configured")}</StatusBadge>
          </div>
        ))}
      </div>

      <button className="mPrimaryAction" onClick={() => action("/api/reconciler/run", { mode: "manual_ui" })}><RefreshCw size={15} /> {t("手动对账", "Manual reconcile")}</button>
    </div>
  );
}

// 全部 OKX USDT 永续合约清单(真实拉取),供移动版行情搜索选币用。
export async function loadMobileInstrumentList(fetchImpl = fetch, endpoint = null) {
  const response = await fetchImpl(endpoint || apiUrl("/api/market/instruments"), { headers: authHeaders() });
  if (!response?.ok) throw new Error(`${t("合约清单请求失败", "Contract list request failed")} (${response?.status || "network"})`);
  const payload = await response.json();
  const instruments = [...new Set((payload.instruments || []).map((item) => pairLabel(item.symbol || item)).filter(Boolean))];
  if (payload.sourceStatus === "failed" || !instruments.length) throw new Error(payload.error || t("无法确认当前可交易合约，请重试", "Unable to confirm the current tradable contracts. Try again."));
  return { instruments, sourceStatus: payload.sourceStatus || "healthy", stale: payload.stale === true || payload.sourceStatus === "stale", asOf: payload.asOf || null };
}

function useMobileInstruments() {
  const [state, setState] = useState({ instruments: [], loading: true, error: "", stale: false, asOf: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: "" }));
    loadMobileInstrumentList()
      .then((catalog) => { if (alive) setState({ ...catalog, loading: false, error: "" }); })
      .catch((error) => { if (alive) setState((current) => ({ ...current, loading: false, error: String(error?.message || error || t("加载失败", "Load failed")) })); });
    return () => { alive = false; };
  }, [attempt]);
  return { ...state, retry: () => setAttempt((current) => current + 1) };
}

// 移动版底部弹层选币器：已选状态与搜索输入分层展示，避免 iOS 键盘/长币对把选择结果盖住。
// 单选用于行情切换，多选用于风控白名单；两者共享同一份真实合约清单，但保持各自的 App 交互。
export function MobilePairSheet({ instruments, current, selected = [], multiple = false, allowEmpty = false, loading = false, error = "", stale = false, asOf = null, onRetry, title, onPick, onApply, onClose, onAddWatch }) {
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState(() => [...new Set((selected || []).map(pairLabel).filter(Boolean))]);
  const [drag, setDrag] = useState(0);
  const startY = useRef(null);
  const qU = q.trim().toUpperCase();
  const normalizedCurrent = pairLabel(current);
  const active = multiple ? draft : (normalizedCurrent ? [normalizedCurrent] : []);
  const list = [...new Set([...active, ...(instruments || []).map(pairLabel)].filter(Boolean))].filter((s) => !qU || s.includes(qU)).slice(0, 200);
  const toggle = (symbol) => setDraft((currentDraft) => currentDraft.includes(symbol) ? currentDraft.filter((item) => item !== symbol) : [...currentDraft, symbol]);
  // 下滑关闭手势:拖住把手往下拉超过阈值即关闭。
  const dStart = (e) => { startY.current = e.touches[0].clientY; };
  const dMove = (e) => { if (startY.current == null) return; const dy = e.touches[0].clientY - startY.current; if (dy > 0) setDrag(dy); };
  const dEnd = () => { const close = drag > 90; startY.current = null; if (close) { haptic("light"); onClose(); } else setDrag(0); };
  return (
    <div className="mSheetOverlay" onClick={onClose}>
      <div className="mSheet" onClick={(e) => e.stopPropagation()} style={{ transform: drag ? `translateY(${drag}px)` : "", transition: startY.current == null ? "transform .22s ease-out" : "none" }}>
        <div className="mSheetGrip" onTouchStart={dStart} onTouchMove={dMove} onTouchEnd={dEnd}><span /></div>
        <div className="mSheetHead"><div><b>{title || t("选择币对", "Select pair")}</b><small>{multiple ? t("可多选，完成后一次应用", "Select multiple, then apply") : t("点选后立即切换行情", "Tap once to switch market")}</small></div><button className="mSheetClose" onClick={onClose} aria-label={t("关闭", "Close")}><ChevronDown size={20} /></button></div>
        <div className="mSheetSelection">
          <span>{multiple ? t("已选择", "Selected") : t("当前币对", "Current pair")}</span>
          <div>{active.length ? active.map((symbol) => <button type="button" key={symbol} onClick={() => multiple && toggle(symbol)}>{symbol.replace("/USDT", "")}{multiple && <i>×</i>}</button>) : <em>{t("未单独选择", "No separate selection")}</em>}</div>
        </div>
        <div className="mSheetSearch"><Search size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("搜索全部 USDT 永续，如 BTC / SOL", "Search all USDT perpetuals, e.g. BTC / SOL")} />{q && <button type="button" onClick={() => setQ("")} aria-label={t("清空搜索", "Clear search")}>×</button>}</div>
        {error && <div className="mSheetLoadError"><Info size={15}/><span><b>{t("完整合约清单加载失败", "Full contract list failed to load")}</b><small>{active.length ? t("下方仅保留当前已选项，不代表完整可交易范围。", "Only current selections are retained below; this is not the full tradable universe.") : t("无法确认当前可交易范围，请重试。", "The current tradable universe cannot be confirmed. Try again.")}</small></span><button type="button" onClick={onRetry}>{t("重试", "Retry")}</button></div>}
        {!error && stale && <div className="mSheetLoadError stale"><Info size={15}/><span><b>{t("当前使用缓存合约清单", "Using a cached contract list")}</b><small>{asOf ? `${t("清单时间", "List as of")} ${formatDateTime(asOf)}` : t("OKX 当前清单暂不可用，请谨慎确认。", "The current OKX list is unavailable; verify cautiously.")}</small></span><button type="button" onClick={onRetry}>{t("刷新", "Refresh")}</button></div>}
        <div className="mSheetList">
          {list.map((s) => { const chosen = active.includes(s); return <div key={s} className={`mSheetRow ${chosen ? "on" : ""}`}>
            <button type="button" className="mSheetRowMain" onClick={() => { if (multiple) toggle(s); else { onPick?.(s); onClose(); } }}>
              <span className="mSheetCoin">{s.charAt(0)}</span><span><b>{s.replace("/USDT", "")}</b><small>USDT · {t("永续", "Perpetual")}</small></span>{chosen && <CheckCircle2 size={18}/>}</button>
            {onAddWatch && <button type="button" className="mSheetAdd" aria-label={`${t("加入自选", "Add to watchlist")} ${s}`} onClick={() => onAddWatch(s)}><Plus size={15} /></button>}
          </div>; })}
          {!list.length && <div className="mEmpty">{qU && instruments?.length ? t("无匹配币对", "No matching pairs") : error ? t("没有可显示的已选币对", "No retained selections to show") : loading ? t("合约清单加载中…", "Loading contract list…") : t("暂无可交易合约", "No tradable contracts")}</div>}
        </div>
        {multiple && <div className="mSheetApply"><button type="button" className="ghost" disabled={!draft.length && !allowEmpty} onClick={() => setDraft([])}>{t("清空", "Clear")}</button><button type="button" className="primary" disabled={!draft.length && !allowEmpty} onClick={() => { onApply?.(draft); onClose(); }}>{t(`应用 ${draft.length} 个币种`, `Apply ${draft.length} pairs`)}</button></div>}
      </div>
    </div>
  );
}

export function MobileMarket({ data, action, ui }) {
  const [tf, setTf] = useState("1H");
  const [sym, setSym] = useState(null);
  const [sheet, setSheet] = useState(false);
  const instrumentState = useMobileInstruments();
  const portfolio = data.portfolio || {};
  const configured = (data.exchangeAccounts || []).some((a) => a.readEnabled);
  const markets = buildMarketRows(data);
  // 选中的币对可能不在已同步的 markets 里(从全量清单选的),用最小对象兜底让图表/标题正常切换。
  const market = markets.find((m) => m.symbol === sym) || (sym ? { symbol: sym, candles: [] } : markets[0]) || { symbol: "BTC/USDT", candles: [] };
  const positions = buildPositionView(data).positions;
  const equity = portfolio.totalEquityUsdt;
  const avail = portfolio.availableMarginUsdt;
  // 保证金口径统一走 lib.marginUsage(含冻结保证金;缺数据=null,不造假)。
  const { usedMarginUsdt: used, marginRatePct: marginRate } = marginUsage(portfolio);
  const metrics = [
    [t("总资产", "Total equity"), configured && equity != null ? displayMoney(equity, 2) : t("未同步", "Not synced"), null],
    [t("今日盈亏", "Today's PnL"), configured && portfolio.todayPnl != null ? `${portfolio.todayPnl >= 0 ? "+" : ""}${displayMoney(portfolio.todayPnl, 2)}` : t("未同步", "Not synced"), configured ? portfolio.todayPnl : null],
    [t("可用保证金", "Available margin"), configured && avail != null ? displayMoney(avail, 2) : t("未同步", "Not synced"), null],
    [t("未实现盈亏", "Unrealized PnL"), configured && portfolio.unrealizedPnl != null ? `${portfolio.unrealizedPnl >= 0 ? "+" : ""}${displayMoney(portfolio.unrealizedPnl, 2)}` : t("未同步", "Not synced"), configured ? portfolio.unrealizedPnl : null]
  ];
  const chgPos = Number(market.changePct || 0) >= 0;
  const mediumTerm = data.mediumTermAnalytics || {};
  const mediumSymbol = (mediumTerm.symbols || []).find((row) => row.symbol === market.symbol);
  const leverageLabel = (value) => ({ leverage_build_up:t("杠杆堆积","Leverage build-up"), long_build:t("多头增仓","Long build"), long_build_crowded:t("多头拥挤","Crowded long build"), short_build:t("空头增仓","Short build"), short_build_crowded:t("空头拥挤","Crowded short build"), short_covering:t("空头回补","Short covering"), long_deleveraging:t("多头去杠杆","Long deleveraging"), price_move_without_oi_confirmation:t("价格缺OI确认","Price lacks OI confirmation"), deleveraging_without_direction:t("无方向去杠杆","Directionless deleveraging"), stable_or_mixed:t("稳定/混合","Stable/mixed") }[value] || humanize(value));
  const tvInterval = { "15m": "15", "1H": "60", "4H": "240", "1D": "D" }[tf] || "60";
  const circ = 2 * Math.PI * 24;
  const dash = `${((marginRate ?? 0) / 100) * circ} ${circ}`;
  return (
    <div className="mScreen">
      <div className="mMetric2x2">
        {metrics.map(([k, v, pn]) => <div className="mMetricCell" key={k}><span>{k}</span><b className={`mono ${pn != null ? (Number(pn) >= 0 ? "pos" : "neg") : ""}`}>{v}</b></div>)}
      </div>
      <div className="mCard">
        <LivePrice symbol={market.symbol} fallbackPrice={market.price} fallbackChange={market.changePct}>
          {(price, change) => (
            <>
              <div className="mMktHead">
                <div className="mMktSym"><span className="mCoinDot">{(market.symbol || "B").charAt(0)}</span><b className="mono">{market.symbol}</b></div>
                <div className={`mMktChg ${Number(change || 0) >= 0 ? "pos" : "neg"} mono`}>{displayPct(change)}</div>
              </div>
              <div className="mMktPrice mono">{displayPrice(price)}</div>
            </>
          )}
        </LivePrice>
        <div className="mSnapRow">
          <span>{t("24h高", "24h H")}<b className="mono">{market.high24h != null ? displayMoney(market.high24h, 2) : "—"}</b></span>
          <span>{t("24h低", "24h L")}<b className="mono">{market.low24h != null ? displayMoney(market.low24h, 2) : "—"}</b></span>
          <span>{t("成交额", "Volume")}<b className="mono">{market.volume24h ? String(market.volume24h) : "—"}</b></span>
          <span>{t("资金费率", "Funding")}<b className="mono">{market.fundingRate == null ? "—" : `${Number(market.fundingRate) >= 0 ? "+" : ""}${Number(market.fundingRate).toFixed(4)}%`}</b></span>
        </div>
        <div className="mSymPills">
          {markets.slice(0, 4).map((m) => <button key={m.symbol} className={m.symbol === market.symbol ? "active" : ""} onClick={() => setSym(m.symbol)}>{m.symbol.replace("/USDT", "")}</button>)}
          <button className="mSymMore" onClick={() => setSheet(true)}><Search size={13} /> {t("全部币对", "All pairs")}</button>
        </div>
        <div className="mTfPills">{["15m", "1H", "4H", "1D"].map((t) => <button key={t} className={tf === t ? "active" : ""} onClick={() => setTf(t)}>{t}</button>)}</div>
        <div className="mKline tv"><TradingViewChart symbol={market.symbol} interval={tvInterval} livePrice={market.price} /></div>
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>{t("中频合约状态", "Medium-term contract state")}</b><small>{t("5分钟事实", "5m facts")}</small></div>
        {["15m","1h","4h"].map((window) => { const row=mediumSymbol?.windows?.[window]; return <div className="mPosRow" key={window}><div className="mPosL"><b className="mono">{window}</b><small>{row?.status==="ok"?leverageLabel(row.leverageState):t("样本积累中","Building samples")}</small></div><div className="mPosR"><b className="mono">{row?.status==="ok"?`P ${row.priceChangePct}% · OI ${row.oiChangePct}%`:`${row?.samples??0}/${row?.expected??"—"}`}</b><small className="mono">{row?.status==="ok"?`F ${row.fundingEndPct??"—"}% · CVD ${row.cvdImbalancePct==null?"—":`${row.cvdImbalancePct}%`}`:t("不足时不输出结论","No conclusion until sufficient")}</small></div></div>; })}
        {market.symbol!=="BTC/USDT"&&<div className="mPosRow"><div className="mPosL"><b>BTC Beta</b><small>24h / 3d / 7d</small></div><div className="mPosR"><b className="mono">{["24h","3d","7d"].map((window)=>{const row=mediumSymbol?.btcRisk?.[window];return row?.status==="ok"?`${window} β${row.beta}`:`${window} —`;}).join(" · ")}</b><small>{t("15分钟收益率，严格覆盖", "15m returns with strict coverage")}</small></div></div>}
        {mediumTerm.portfolioBtcRisk?.status&&!['no_positions','insufficient'].includes(mediumTerm.portfolioBtcRisk.status)&&<div className="mPosRow"><div className="mPosL"><b>{t("组合 BTC 风险","Portfolio BTC risk")}</b><small>{mediumTerm.portfolioBtcRisk.status}</small></div><div className="mPosR"><b className="mono">{mediumTerm.portfolioBtcRisk.netBtcEquivalentUsdt} U</b><small>{t("净 / 毛等效","Net / gross equiv.")} {mediumTerm.portfolioBtcRisk.grossBtcBetaExposureUsdt} U</small></div></div>}
        {Object.entries(mediumTerm.eventVolatility?.byType||{}).slice(0,3).map(([type,row])=><div className="mPosRow" key={type}><div className="mPosL"><b>{type}</b><small>{t("BTC 事件波动","BTC event volatility")}</small></div><div className="mPosR"><b className="mono">{row.status==="usable"?`n=${row.samples} · RV ${row.medianPost1hRealizedVolPct}%`:`${row.samples}/${row.minimumSamples}`}</b><small>{row.status==="usable"?`p90 ${row.p90Post1hRealizedVolPct}% · ×${row.medianPost1hVolExpansionRatio}`:t("样本积累中","Building samples")}</small></div></div>)}
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>{t("持仓", "Positions")}</b><button className="mLink" onClick={() => ui.setActive("positions")}>{t("全部", "All")} ›</button></div>
        {positions.length ? positions.slice(0, 3).map((p, i) => {
          const short = mobileDirectionKind(p.direction ?? p.side ?? p.posSide) === "short";
          const pnl = Number(p.pnl ?? p.upl ?? p.unrealizedPnl ?? 0);
          return (
            <div className="mPosRow" key={i}>
              <div className="mPosL"><b className="mono">{p.symbol || p.instId}</b><span className={`mPosDir ${short ? "short" : "long"}`}>{short ? t("做空", "Short") : t("做多", "Long")}</span></div>
              <div className="mPosR"><b className={`mono ${pnl >= 0 ? "pos" : "neg"}`}>{pnl >= 0 ? "+" : ""}{displayMoney(pnl, 2)}</b><small className="mono">{displayMoney(p.quantity ?? p.size ?? p.qty ?? p.pos ?? 0, 2)} · {displayPct(p.roiPct ?? p.uplRatioPct)}</small></div>
            </div>
          );
        }) : <div className="mEmpty">{t("连接交易所后显示真实持仓", "Live positions appear after connecting an exchange")}</div>}
      </div>
      <div className="mCard mMarginCard">
        <svg className="mDonut" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="24" fill="none" stroke="#EDE7DB" strokeWidth="6" />
          <circle cx="28" cy="28" r="24" fill="none" stroke="#D06A22" strokeWidth="6" strokeDasharray={dash} strokeLinecap="round" transform="rotate(-90 28 28)" />
          <text x="28" y="31" textAnchor="middle" className="mDonutTxt">{marginRate != null ? `${marginRate.toFixed(0)}%` : "—"}</text>
        </svg>
        <div className="mMarginInfo"><b>{t("保证金率", "Margin ratio")}</b><small>{marginRate != null ? `${t("已用保证金", "Used margin")} ${marginRate.toFixed(1)}%` : t("连接账户后显示", "Shown after connecting an account")}</small></div>
      </div>
      {sheet && <MobilePairSheet instruments={instrumentState.instruments} loading={instrumentState.loading} error={instrumentState.error} stale={instrumentState.stale} asOf={instrumentState.asOf} onRetry={instrumentState.retry} current={market.symbol} onPick={setSym} onClose={() => setSheet(false)} onAddWatch={(s) => { action("/api/watchlist", { symbol: s }); ui.notify?.(`${t("已加入自选", "Added to watchlist")} ${s}`); }} />}
    </div>
  );
}

// 屏 S4 — 审计与系统：系统卡 2×2 + 审计链 + 决策/工具日志。
function MobileAudit({ data, ui }) {
  const sys = data.system || {};
  const rt = data.realtimeConnections || [];
  const tasks = (data.tasks || []).filter((t) => t.enabled).length;
  const exSynced = (data.exchangeAccounts || []).filter((a) => a.readEnabled).length;
  const exTotal = data.exchangeAccounts?.length || 0;
  const sysCards = [
    [t("API 健康", "API health"), sys.apiHealth || t("未知", "Unknown"), "#2A6FDB", "#EAF0FB"],
    ["WebSocket", data.realtimeStarted ? `${rt.filter((c) => c.status === "connected").length}/${rt.length || 0}` : t("未启动", "Not started"), "#7A4FD0", "#F0EAFB"],
    [t("任务引擎", "Task engine"), String(tasks), "#D06A22", "#FBEDDF"],
    [t("交易所同步", "Exchange sync"), exTotal ? `${exSynced}/${exTotal}` : t("未接入", "Not connected"), "#1F7A50", "#E6F1EA"]
  ];
  const chain = (data.traces || []).slice(0, 6);
  const logs = (data.auditLogs || []).slice(0, 5);
  return (
    <div className="mScreen">
      <div className="mMetric2x2">
        {sysCards.map(([k, v, c, bg]) => <div className="mMetricCell" key={k}><span style={{ color: c }}>{k}</span><b className="mono" style={{ color: c }}>{v}</b><i className="mSysDot" style={{ background: bg }} /></div>)}
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>{t("最近运行记录", "Recent runs")}</b><button className="mLink" onClick={() => ui.openPanel("auditChain")}>{t("完整", "Full")} ›</button></div>
        {chain.length ? chain.map((t, i) => (
          <div className="mChainRow" key={t.id || i}>
            <span className={`mChainDot ${statusTone(t.status)}`} />
            <div className="mChainMid"><b>{t.title || t.type}</b><small className="mono">{t.id ? String(t.id).slice(0, 14) : t.type}</small></div>
            <small className="mono mChainTime">{formatTime(t.createdAt)}</small>
          </div>
        )) : <div className="mEmpty">{t("暂无审计链记录", "No audit trail records")}</div>}
      </div>
      <div className="mCard">
        <div className="mCardHead"><b>{t("决策与工具日志", "Decision & tool logs")}</b></div>
        {logs.length ? logs.map((l, i) => (
          <div className="mLogRow" key={l.id || i}>
            <small className="mono">{formatTime(l.createdAt)}</small>
            <b>{l.action}</b>
            <StatusBadge tone={statusTone(l.severity)}>{humanize(l.severity || "ok")}</StatusBadge>
          </div>
        )) : <div className="mEmpty">{t("暂无日志", "No logs")}</div>}
      </div>
    </div>
  );
}

// 屏 S1 — AI 交易员：顶栏下 4 等分状态条。
function MobileChatStatus({ data }) {
  const sys = data.system || {};
  const pf = data.portfolio || {};
  const autoOn = sys.autonomyEnabled === true && !sys.killSwitch;
  const smMob = data.marketRegime?.smartMoney || {};
  // 与桌面端共用 smartMoneyBias（1.05/0.95 三档），不再用 >=1 二分导致两端结论矛盾。
  const bias = smMob.ok ? smartMoneyBias(smMob.topTraderLongShortRatio).label : t("待同步", "Pending sync");
  const mandate = data.mandates?.find((m) => ["active", "running"].includes(m.status));
  const cells = [
    [t("状态", "Status"), autoOn ? t("运行中", "Running") : t("已暂停", "Paused"), autoOn ? "pos" : ""],
    [t("判断", "Read"), bias, bias === "偏多" ? "pos" : bias === "偏空" ? "neg" : ""],
    [t("今日", "Today"), pf.todayPnlPct != null ? displayPct(pf.todayPnlPct) : "—", Number(pf.todayPnlPct || 0) >= 0 ? "pos" : "neg"],
    [t("目标", "Target"), mandate?.maxDailyLossPct ? `${t("亏≤", "Loss ≤")}${mandate.maxDailyLossPct}${t("%/日", "%/day")}` : "—" /* targetMonthlyPct 是后端从未写入的死字段(审计 L1) */, ""]
  ];
  return <div className="mChatStatus">
    {cells.map(([k, v, tone]) => <div className="mChatStatCell" key={k}><span>{k}</span><b className={`mono ${tone}`}>{v}</b></div>)}
  </div>;
}

function MobileWatch({ data, action }) {
  const watches = data.watchTriggers || [];
  const active = watches.filter((item) => item.status === "active");
  const history = watches.filter((item) => item.status !== "active").slice(0, 8);
  const groups = (data.watchBoard || []).length ? data.watchBoard : Object.values(active.reduce((out, item) => {
    out[item.symbol] ||= { symbol: item.symbol, analysisAt: item.analysisAt || item.createdAt, primary: null, secondary: [] };
    if (!out[item.symbol].primary || item.priority === "primary") {
      if (out[item.symbol].primary) out[item.symbol].secondary.push(out[item.symbol].primary);
      out[item.symbol].primary = item;
    } else out[item.symbol].secondary.push(item);
    return out;
  }, {}));
  const direction = (item) => item?.direction === "long" ? t("做多情景", "Long scenario") : item?.direction === "short" ? t("做空情景", "Short scenario") : t("中性观察", "Neutral watch");
  const condition = (item) => item?.kind === "price_above" ? `${t("向上突破", "Break above")} ${displayPrice(item.level)}` : item?.kind === "price_below" ? `${t("向下跌破", "Break below")} ${displayPrice(item.level)}` : `${t("进入区间", "Enter zone")} ${displayPrice(item?.levelLow)}–${displayPrice(item?.levelHigh)}`;
  const thesis = (item) => localizeText(item?.displayThesis || item?.thesis || item?.analysisTitle, item?.displayThesisEn || item?.thesis || item?.analysisTitle) || t("等待关键条件提供新的方向依据。", "Waiting for a key condition to provide new directional evidence.");
  const meaning = (item) => localizeText(item?.displayTriggerMeaning || item?.triggerMeaning || item?.note, item?.displayTriggerMeaningEn || item?.triggerMeaning || item?.note) || t("命中后重新检查结构、量能与盈亏比，不直接下单。", "Re-check structure, flow and risk/reward after the trigger; do not enter automatically.");
  return <div className="mScreen mWatchScreen">
    <div className="mWatchSummary"><div><b className="mono">{groups.length}</b><span>{t("盯盘币种", "Symbols watched")}</span></div><div><b className="mono">{active.length}</b><span>{t("有效条件", "Active conditions")}</span></div><p>{t("命中只会唤起重新分析，不代表已经做多、做空或下单。", "A trigger starts a fresh review; it is not a long, short, or order by itself.")}</p></div>
    <section className="mNativeSection"><header><div><b>{t("正在盯盘", "Watching now")}</b><small>{t("先看原判断，再看命中意味着什么", "Read the thesis first, then what a trigger means")}</small></div><span>{active.length}</span></header>
      <div className="mWatchList">{groups.map((group) => { const item = group.primary; if (!item) return null; const tone = item.direction === "long" ? "long" : item.direction === "short" ? "short" : "neutral"; return <article className={`mWatchCard ${tone}`} key={group.symbol}>
        <div className="mWatchCardHead"><div><b className="mono">{item.symbol}</b><span>{direction(item)}</span></div><button onClick={async () => { if (await uiConfirm(`${t("确认撤销", "Cancel")} ${item.symbol}？`)) action(`/api/watch-triggers/${item.id}/cancel`, {}); }}><Trash2 size={15}/></button></div>
        <div className="mWatchThesis"><span>{t("原判断", "Original thesis")}</span><p>{thesis(item)}</p></div>
        <div className="mWatchTrigger"><span><small>{t("等待条件", "Waiting for")}</small><b>{condition(item)}</b></span><span><small>{t("命中之后", "If triggered")}</small><p>{meaning(item)}</p></span></div>
        {(group.secondary || []).length > 0 && <details><summary>{t("辅助条件", "Supporting conditions")} · {group.secondary.length}</summary>{group.secondary.map((row) => <div className="mWatchSecondary" key={row.id}><span><b>{condition(row)}</b><small>{meaning(row)}</small></span><button onClick={() => action(`/api/watch-triggers/${row.id}/cancel`, {})}>×</button></div>)}</details>}
      </article>; })}{!groups.length && <div className="mNativeEmpty"><Eye size={22}/><b>{t("暂无有效观察哨", "No active watches")}</b><span>{t("AI 登记具体价位条件后会显示在这里。", "Concrete price conditions registered by the AI appear here.")}</span></div>}</div>
    </section>
    {history.length > 0 && <section className="mNativeSection"><header><div><b>{t("最近记录", "Recent history")}</b><small>{t("触发、失效与被替代", "Triggered, invalidated, and superseded")}</small></div></header>{history.map((item) => <div className="mNativeRow" key={item.id}><span className={`mStateDot ${item.status}`}/><span><b>{item.symbol} · {direction(item)}</b><small>{condition(item)} · {humanize(item.status)}</small></span><time>{formatTime(item.triggeredAt || item.updatedAt || item.createdAt)}</time></div>)}</section>}
  </div>;
}

// 移动端主导航（与桌面 IA 对齐:交易 / 能力 / 风控与运维），走顶部汉堡抽屉。
// W1b:新增 信号中心(计划看板) + 交易日志,顺序与桌面一致。
// 风控中心(移动版):把风控总览 + 风控设置合并到一个导航项,顶部 Tab 切换。
function MobileRiskHub({ data, action, ui }) {
  const [tab, setTab] = useState("overview");
  const [detail, setDetail] = useState("");
  if (detail) {
    const titles = { permissions: t("交易权限", "Trading permissions"), live: t("执行方式", "Execution mode"), goal: t("盈利目标保护", "Profit goal protection") };
    const done = () => setDetail("");
    return <div className="mRiskDetailPage"><div className="mRiskDetailNav"><button type="button" onClick={done}><ChevronLeft size={18}/>{t("风控设置", "Risk settings")}</button><b>{titles[detail]}</b><span /></div>{detail === "permissions" ? <MobileRiskPermissionEditor data={data} action={action} ui={ui} onDone={done} /> : detail === "live" ? <MobileRiskLiveEditor data={data} action={action} ui={ui} onDone={done} /> : <MobileRiskGoalEditor data={data} action={action} ui={ui} onDone={done} />}</div>;
  }
  return (
    <div className="mHub">
      <div className="mHubTabs">
        <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>{t("风控总览", "Risk overview")}</button>
        <button type="button" className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>{t("风控设置", "Risk settings")}</button>
      </div>
      <MobileRisk data={data} action={action} ui={ui} view={tab} onOpen={setDetail} />
    </div>
  );
}

function capabilityStatusLabel(item) {
  if (item.enabled) return t("已启用", "Enabled");
  if (item.disabled) return t("已停用", "Disabled");
  if (item.candidate) return t("待接入", "Pending");
  return humanize(item.status, t("可用", "Available"));
}

function capabilityHealthLabel(value) {
  return ({ healthy:t("运行正常","Healthy"),degraded:t("需要检查","Needs attention"),blocked:t("最近阻断","Last blocked"),untested:t("未有运行证据","Untested"),not_applicable:t("配置项","Configuration") }[value] || humanize(value, "—"));
}

function capabilityHealthTone(value) {
  if (value === "healthy") return "ok";
  if (value === "degraded") return "danger";
  if (value === "blocked") return "warning";
  return "neutral";
}

export function MobileCapabilities({ data, action, ui }) {
  const items = buildCapabilityCatalogRows(data, t);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState("");
  const filters = [
    ["all", t("全部", "All"), () => true],
    ["enabled", t("已启用", "Enabled"), (item) => item.enabled],
    ["pending", t("待处理", "Needs attention"), (item) => !item.enabled && !item.disabled],
    ["disabled", t("已停用", "Disabled"), (item) => item.disabled]
  ];
  const filterFn = filters.find(([id]) => id === filter)?.[2] || filters[0][2];
  const shown = items.filter((item) => filterFn(item) && (!query.trim() || String(localizeText(item.name)).toLowerCase().includes(query.trim().toLowerCase())));
  const selected = items.find((item) => item.id === openId) || null;
  const typeLabel = (item) => item.category === "mcp" ? "MCP" : item.category === "workflow" ? t("工作流", "Workflow") : t("分析工具", "Analysis tool");
  const manageSelected = async () => {
    if (!selected) return;
    if (selected.category === "mcp") {
      ui.notify?.(t("MCP 连接请在系统设置中管理", "Manage MCP connections in Settings"));
      setOpenId("");
      ui.setActive("systemSettings");
      return;
    }
    if (selected.connector) {
      setOpenId("");
      ui.setActive("systemSettings");
      return;
    }
    if (selected.native) {
      await action(`/api/skills/${selected.id}/${selected.enabled ? "disable" : "enable"}`, {});
      setOpenId("");
      return;
    }
    setOpenId("");
    ui.openPanel("skillImport");
  };
  return <div className="mScreen mCapabilityScreen">
    <div className="mCapabilityIntro">
      <div><b>{t("AI 可调用的能力", "Capabilities available to AI")}</b><span>{t("调用记录与单轮能力覆盖分开统计；0 表示尚无运行证据，不等于故障。", "Recorded calls are separate from per-run coverage. Zero means unobserved, not broken.")}{data.analysisEngine?.toolUsageStatsSince?` · ${t("统计自","Since")} ${formatDateTime(data.analysisEngine.toolUsageStatsSince)}`:""}</span></div>
      <button onClick={() => ui.openPanel("skillImport")}><Plus size={15}/>{t("添加", "Add")}</button>
    </div>
    <div className="mMetric2x2">
      <div className="mMetricCell"><span>{t("全部能力", "All capabilities")}</span><b className="mono">{items.length}</b></div>
      <div className="mMetricCell"><span>{t("已启用", "Enabled")}</span><b className="mono pos">{items.filter((item) => item.enabled).length}</b></div>
      <div className="mMetricCell"><span>{t("运行正常", "Healthy")}</span><b className="mono pos">{items.filter((item) => item.health === "healthy").length}</b></div>
      <div className="mMetricCell"><span>{t("未验证 / 需检查", "Unverified / check")}</span><b className="mono">{items.filter((item) => ["untested","degraded","blocked"].includes(item.health)).length}</b></div>
    </div>
    <div className="mCapabilitySearch"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("搜索能力", "Search capabilities")}/>{query && <button onClick={() => setQuery("")} aria-label={t("清空", "Clear")}>×</button>}</div>
    <div className="mCapabilityFilters">{filters.map(([id, label, fn]) => <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>{label}<b>{items.filter(fn).length}</b></button>)}</div>
    <section className="mCapabilityList">
      {shown.map((item) => <button className="mCapabilityRow" key={item.id} onClick={() => setOpenId(item.id)}>
        <span className={`mCapabilityIcon ${item.category}`}><Wrench size={17}/></span>
        <span className="mCapabilityRowText"><b>{localizeText(item.name)}</b><small>{typeLabel(item)} · {item.connector ? t("配置型连接", "Configuration connector") : `${t("记录调用", "Recorded")} ${item.calls ?? "—"}`}</small></span>
        <StatusBadge tone={capabilityHealthTone(item.health)}>{capabilityHealthLabel(item.health)}</StatusBadge><ChevronRight size={15}/>
      </button>)}
      {!shown.length && <div className="mNativeEmpty"><Wrench size={22}/><b>{query ? t("没有匹配的能力", "No matching capabilities") : t("暂无能力", "No capabilities yet")}</b><span>{t("可以从 Skill 导入入口添加工具类能力。", "Add tool capabilities from the Skill import flow.")}</span></div>}
    </section>
    {selected && <div className="mCapabilitySheetOverlay" onClick={() => setOpenId("")}>
      <aside className="mCapabilitySheet" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="mSheetGrip" onClick={() => setOpenId("")} aria-label={t("关闭", "Close")}><i/></button>
        <header><span className={`mCapabilityIcon ${selected.category}`}><Wrench size={18}/></span><div><small>{typeLabel(selected)} · {capabilityStatusLabel(selected)}</small><b>{localizeText(selected.name)}</b></div><StatusBadge tone={capabilityHealthTone(selected.health)}>{capabilityHealthLabel(selected.health)}</StatusBadge></header>
        <p>{localizeText(selected.description || selected.summary) || t("该能力由 AI 在受控工作流中按权限调用。", "The AI calls this capability inside permission-controlled workflows.")}</p>
        <div className="mCapabilityFacts"><span>{t("来源", "Source")}<b>{selected.source || selected.packageName || t("内置", "Built-in")}</b></span><span>{t("启用状态", "Enablement")}<b>{capabilityStatusLabel(selected)}</b></span><span>{t("记录调用", "Recorded calls")}<b className="mono">{selected.connector ? "—" : selected.calls ?? 0}</b></span><span>{t("最近运行", "Last run")}<b>{selected.lastRunAt ? formatDateTime(selected.lastRunAt) : t("尚未运行", "Not observed")}</b></span></div>
        {!selected.connector && <div className="mCapabilitySources"><span><small>{t("模型主动","Model")}</small><b>{selected.usage?.legacyUnsplit?"—":selected.usage?.sourceCalls?.model||0}</b></span><span><small>{t("系统预检","Preflight")}</small><b>{selected.usage?.legacyUnsplit?"—":selected.usage?.sourceCalls?.preflight||0}</b></span><span><small>{t("系统直接","System")}</small><b>{selected.usage?.legacyUnsplit?"—":selected.usage?.sourceCalls?.system||0}</b></span><span><small>{t("健康评测","Evaluation")}</small><b>{selected.usage?.sourceCalls?.evaluation||selected.evalMetrics?.calls||0}</b></span></div>}
        {selected.usage?.legacyUnsplit && <p className="mCapabilityMetricNote">{t(`升级前的 ${selected.usage.legacyUnsplitCalls||selected.calls||0} 次记录无法可靠拆分来源；后续调用会按模型、预检和系统分别记录。`,`The ${selected.usage.legacyUnsplitCalls||selected.calls||0} legacy records cannot be reliably split. New calls are source-attributed.`)}</p>}
        {selected.usage && <div className="mCapabilityUsage"><span><b>{selected.usage.success || 0}</b>{t("成功", "Success")}</span><span><b>{selected.usage.blocked || 0}</b>{t("阻断", "Blocked")}</span><span><b>{selected.usage.error || 0}</b>{t("失败", "Errors")}</span><span><b>{selected.usage.unclassified || 0}</b>{t("历史未分类", "Legacy unknown")}</span></div>}
        <button className="mCapabilityManage" onClick={manageSelected}>{selected.category === "mcp" || selected.connector ? t("前往系统设置", "Open Settings") : selected.native ? (selected.enabled ? t("停用能力", "Disable capability") : t("启用能力", "Enable capability")) : t("管理 Skill", "Manage Skill")}</button>
      </aside>
    </div>}
  </div>;
}

const mobileResearchEvidenceLabels = {
  historical_backtest: ["历史回测", "Historical backtest"],
  optimizer_oos: ["自动研究 · 样本外", "Automated research · OOS"],
  studio_oos: ["策略工作室 · 样本外", "Strategy Studio · OOS"],
  forward_paper: ["纯前向模拟", "Pure forward simulation"]
};

function mobileResearchEvidenceLabel(value) {
  const pair = mobileResearchEvidenceLabels[value];
  return pair ? t(pair[0], pair[1]) : humanize(value, "—");
}

function mobileResearchStatusLabel(value) {
  return ({
    validated: t("高置信样本外", "High-confidence OOS"),
    oos_ok: t("样本外通过", "OOS passed"),
    completed: t("已完成", "Completed"),
    ok: t("已完成", "Completed"),
    failed: t("未通过", "Failed"),
    no_qualified_strategy: t("无合格策略", "No qualified strategy"),
    running: t("验证中", "Validating"),
    passed: t("已通过", "Passed")
  }[value] || humanize(value, "—"));
}

function mobileResearchStatusTone(item) {
  if (item?.passed === false || /failed|no_qualified/.test(String(item?.status))) return "danger";
  if (/running/.test(String(item?.status))) return "warning";
  return "ok";
}

function MobileSparkline({ values = [], tone = "green" }) {
  const nums = values.map((item) => typeof item === "object" ? Number(item.value ?? item.equity ?? item.drawdown) : Number(item)).filter(Number.isFinite);
  if (nums.length < 2) return <div className="mResearchChartEmpty">{t("该记录没有曲线数据", "No curve data for this record")}</div>;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const points = nums.map((value, index) => `${(index / (nums.length - 1)) * 280},${58 - ((value - min) / range) * 50}`).join(" ");
  return <svg className={`mResearchSpark ${tone}`} viewBox="0 0 280 64" preserveAspectRatio="none" role="img" aria-label={t("表现曲线", "Performance curve")}><polyline points={points}/></svg>;
}

function MobileResearchDetailSheet({ record, onClose }) {
  if (!record) return null;
  const folds = record.folds || [];
  const params = Object.entries(record.parameters || {}).slice(0, 10);
  return <div className="mResearchSheetOverlay" onClick={onClose}>
    <aside className="mResearchSheet" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="mSheetGrip" onClick={onClose} aria-label={t("关闭", "Close")}><i/></button>
      <header><div><small>{mobileResearchEvidenceLabel(record.evidenceType)}</small><b>{localizeText(record.name)}</b><span>{record.symbol || "—"} · {record.timeframe || "—"} · {record.createdAt ? formatDate(record.createdAt) : t("时间未记录", "Time unavailable")}</span></div><StatusBadge tone={mobileResearchStatusTone(record)}>{mobileResearchStatusLabel(record.status)}</StatusBadge></header>
      <div className="mResearchSheetMetrics"><span><small>{t("累计收益", "Total return")}</small><b className={Number(record.totalReturnPct || 0) >= 0 ? "pos" : "neg"}>{record.totalReturnPct == null ? "—" : displayPct(record.totalReturnPct)}</b></span><span><small>{t("R 期望", "R expectancy")}</small><b>{record.expectancyR == null ? "—" : `${record.expectancyR}R`}</b></span><span><small>{t("盈亏因子", "Profit factor")}</small><b>{record.profitFactor ?? "—"}</b></span><span><small>{t("最大回撤", "Max drawdown")}</small><b className="neg">{record.maxDrawdownPct == null ? "—" : `${record.maxDrawdownPct}%`}</b></span></div>
      <section><div className="mResearchSectionHead"><b>{t("收益曲线", "Equity curve")}</b><span>{record.trades ?? "—"} {t("笔交易", "trades")}</span></div><MobileSparkline values={record.equityCurve || []}/></section>
      <section className="mResearchDetailRows"><span>{t("胜率", "Win rate")}<b>{record.winRatePct == null ? "—" : `${record.winRatePct}%`}</b></span><span>{t("90% 置信下界", "90% lower bound")}<b>{record.expectancyLower90R == null ? "—" : `${record.expectancyLower90R}R`}</b></span><span>{t("正向样本外分段", "Positive OOS folds")}<b>{record.positiveFolds == null ? "—" : `${record.positiveFolds}/${record.activeFolds ?? "—"}`}</b></span><span>{t("研究方法", "Methodology")}<b>{localizeText(record.methodology) || t("统一成本模型下的历史验证", "Historical validation with the unified cost model")}</b></span></section>
      {folds.length > 0 && <section><div className="mResearchSectionHead"><b>{t("样本外分段", "Out-of-sample folds")}</b><span>{folds.length}</span></div><div className="mResearchFoldList">{folds.map((fold, index) => <div key={index}><b>{t("分段", "Fold")} {index + 1}</b><span>{fold.trades ?? "—"} {t("笔", "trades")}</span><span>{fold.expectancyR == null ? "—" : `${fold.expectancyR}R`}</span><span>PF {fold.profitFactor ?? "—"}</span></div>)}</div></section>}
      {params.length > 0 && <details className="mResearchParams"><summary>{t("查看策略参数", "View strategy parameters")}<ChevronDown size={14}/></summary><div>{params.map(([key, value]) => <span key={key}>{humanize(key)}<b>{String(value)}</b></span>)}</div></details>}
    </aside>
  </div>;
}

export function MobileBacktestResearch({ data, action }) {
  const research = data.backtestResearch || {};
  const historical = (research.historical || []).length ? research.historical : (data.backtests || []).map((row, index) => ({
    ...row,
    id: row.id || `legacy-${index}`,
    name: row.name || row.strategyName || row.strategy || `${t("回测", "Backtest")} ${index + 1}`,
    evidenceType: row.kind === "strategy_blueprint" ? "studio_oos" : "historical_backtest",
    parameters: row.parameters || row.params || {}
  }));
  const forward = research.forward || [];
  const summary = research.summary || {};
  const [detailId, setDetailId] = useState("");
  const detail = historical.find((row) => row.id === detailId) || null;
  return <div className="mStrategyStack mResearchMobile">
    <div className="mResearchSummary"><span><small>{t("历史证据", "Historical evidence")}</small><b>{summary.totalHistoricalEvidence ?? historical.length}</b></span><span><small>{t("自动样本外", "Automated OOS")}</small><b>{summary.optimizerOos ?? historical.filter((row) => row.evidenceType === "optimizer_oos").length}</b></span><span><small>{t("工作室样本外", "Studio OOS")}</small><b>{summary.studioOos ?? historical.filter((row) => row.evidenceType === "studio_oos").length}</b></span></div>
    <div className="mResearchRunCard"><span><b>{t("用真实收盘 K 线做样本外验证", "Run OOS validation on real closed candles")}</b><small>{t("历史证据与纯前向模拟分开记录，不用模拟结果冒充回测。", "Historical evidence and forward simulation remain separate.")}</small></span><button onClick={() => action("/api/strategy/research", {}, "POST")}><Play size={14}/>{t("运行研究", "Run research")}</button></div>
    <section className="mCard mResearchListCard"><div className="mCardHead"><b>{t("研究记录", "Research records")}</b><small>{historical.length}</small></div>
      <div className="mResearchList">{historical.map((row) => <button key={row.id} onClick={() => setDetailId(row.id)}><div className="mResearchRecordHead"><span><small>{mobileResearchEvidenceLabel(row.evidenceType)}</small><b>{localizeText(row.name)}</b></span><StatusBadge tone={mobileResearchStatusTone(row)}>{mobileResearchStatusLabel(row.status)}</StatusBadge></div><p>{row.symbol || "—"} · {row.timeframe || "—"} · {row.direction ? (row.direction === "short" ? t("做空", "Short") : t("做多", "Long")) : t("方向不限", "Any side")}</p><div><span>{t("交易", "Trades")}<b>{row.trades ?? "—"}</b></span><span>{t("期望", "Expectancy")}<b>{row.expectancyR == null ? "—" : `${row.expectancyR}R`}</b></span><span>PF<b>{row.profitFactor ?? "—"}</b></span><span>{t("回撤", "Drawdown")}<b>{row.maxDrawdownPct == null ? "—" : `${row.maxDrawdownPct}%`}</b></span></div><ChevronRight size={16}/></button>)}
        {!historical.length && <div className="mNativeEmpty"><BarChart3 size={24}/><b>{t("尚无历史研究证据", "No historical research evidence yet")}</b><span>{t("运行研究后，真实 OKX 收盘 K 线的样本外结果会显示在这里。", "Run research to populate OOS results from real OKX closed candles.")}</span></div>}
      </div>
    </section>
    <section className="mCard mForwardCard"><div className="mCardHead"><b>{t("纯前向模拟", "Pure forward simulation")}</b><small>{t("独立证据", "Separate evidence")}</small></div>{forward.map((row) => <div className="mForwardRow" key={row.id}><div><b>{localizeText(row.name)}</b><small>{row.timeframe || "—"}{row.openPosition ? ` · ${t("持仓进行中", "position open")}` : ""}</small></div><span>{row.completedTrades}/{row.minimumTrades}</span><progress max="100" value={row.progressPct || 0}/><StatusBadge tone={row.status === "passed" ? "ok" : row.status === "failed" ? "danger" : "warning"}>{mobileResearchStatusLabel(row.status)}</StatusBadge></div>)}{!forward.length && <p className="mResearchEmptyLine">{t("暂无纯前向会话；自动研究选出合格策略后会在这里推进。", "No forward sessions yet. Qualifying research will create them here.")}</p>}</section>
    <MobileResearchDetailSheet record={detail} onClose={() => setDetailId("")}/>
  </div>;
}

// 策略库(移动版):所有会输出交易主张的策略——蒸馏/导入/LLM。与桌面 StrategyLibraryConcept 同口径。
export function MobileStrategy({ data, action, initialTab = "catalog" }) {
  const studio = data.strategyStudio || {};
  const strategyCatalog = buildStrategyCatalogRows(data, t);
  const { products } = strategyCatalog;
  const strategies = strategyCatalog.rows;
  const [tab, setTab] = useState(initialTab);
  const [prompt, setPrompt] = useState("");
  const drafts = studio.drafts || [];
  const [selectedId, setSelectedId] = useState(drafts[0]?.id || "");
  const selected = drafts.find((row) => row.id === selectedId) || drafts[0] || {};
  const latestBt = (studio.backtests || []).find((row) => row.id === selected.latestBacktestId);
  const listings = studio.marketplace?.listings || [];
  const createDraft = async () => {
    if (prompt.trim().length < 12) return;
    const result = await action("/api/strategy/studio/drafts", { prompt }, "POST");
    if (result?.draft?.id) { setSelectedId(result.draft.id); setPrompt(""); if (result.suite?.status === "passed") await action(`/api/strategy/studio/drafts/${result.draft.id}/backtest`, {}, "POST"); }
  };
  const statusLabel = (value) => ({ owner_live_observation:t("实盘观察（未验证）","Live observation"), validated_active:t("证据达标","Evidence-qualified"), tests_passed:t("自动测试通过","Tests passed"), backtest_passed:t("样本外通过","OOS passed"), backtest_failed:t("样本外未通过","OOS failed"), published:t("已发布","Published") }[value] || humanize(value, "—"));
  const originLabel = (value) => t(value, ({ "策略产品":"Strategy product", "指标研究模型":"Research model", "蒸馏":"Distilled", "LLM/手写":"LLM/Manual", "导入":"Imported", "其他":"Other" })[value] || value);
  return (
    <div className="mScreen">
      <div className="mHubTabs mStrategyTabs"><button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>{t("目录", "Catalog")}</button><button className={tab === "studio" ? "active" : ""} onClick={() => setTab("studio")}>{t("工作室", "Studio")}</button><button className={tab === "market" ? "active" : ""} onClick={() => setTab("market")}>{t("市场", "Market")}</button><button className={tab === "research" ? "active" : ""} onClick={() => setTab("research")}>{t("回测研究", "Backtest")}</button></div>
      {tab === "catalog" && <><div className="mMetric2x2"><div className="mMetricCell"><span>{t("策略总数", "Strategies")}</span><b className="mono">{strategies.length}</b></div><div className="mMetricCell"><span>{t("版本化产品", "Products")}</span><b className="mono pos">{products.length}</b></div><div className="mMetricCell"><span>{t("研究模型", "Research models")}</span><b className="mono">{strategyCatalog.research.length}</b></div><div className="mMetricCell"><span>{t("工作室草稿", "Studio drafts")}</span><b className="mono">{drafts.length}</b></div></div><div className="mCard">{strategies.length ? strategies.map((s) => <div className="mIncRow" key={s.id}><div className="mIncL"><b>{localizeText(s.name)}</b><span className="mIncX">{originLabel(s.origin)}{s.timeframe ? ` · ${s.timeframe}` : ""}</span></div><StatusBadge tone={statusTone(s.status)}>{statusLabel(s.status)}</StatusBadge></div>) : <div className="mEmpty">{t("暂无策略", "No strategies")}</div>}</div></>}
        {tab === "studio" && <div className="mStrategyStack"><div className="mCard"><b className="mSectionTitle">{t("自然语言创建策略", "Create from natural language")}</b><p className="mStrategyHelp">{t("只编译到确定性白名单规则；创建草稿不会下单。", "Compiles only to deterministic allowlisted rules. Drafts never place orders.")}</p><textarea className="mStrategyPrompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("例：ADA/USDT 1小时，RSI 14 从30下方站回时做多，止损2%，止盈2.5R", "Example: Long ADA/USDT on 1h when RSI(14) crosses back above 30; 2% stop, 2.5R target")}/><button className="mStrategyPrimary" disabled={prompt.trim().length < 12} onClick={createDraft}><Sparkles size={14}/>{t("生成、测试并自动回测", "Generate, test, and backtest")}</button></div>
        {drafts.length ? <div className="mCard"><b className="mSectionTitle">{t("策略草稿", "Strategy drafts")}</b><div className="mStrategyDrafts">{drafts.slice(0,20).map((row) => <button key={row.id} className={row.id === selected.id ? "active" : ""} onClick={() => setSelectedId(row.id)}><span><b>{localizeText(row.blueprint?.name)}</b><small>{row.authoring?.channel === "agent_chat" ? t("AI 对话创建", "Created in AI chat") : t("工作室创建", "Created in Studio")} · {row.blueprint?.symbols?.join("/")} · {row.blueprint?.timeframe} · {humanize(row.blueprint?.direction)}</small></span><StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge></button>)}</div></div> : null}
        {selected.id && <><div className="mCard"><b className="mSectionTitle">{t("系统理解的规则", "Compiled rules")}</b><div className="mStrategyFacts"><span>{t("信号", "Signal")}<b>{t(selected.blueprint?.templateName || "—", selected.blueprint?.templateNameEn || selected.blueprint?.templateName || "—")}</b></span><span>{t("止损 / 止盈", "Stop / target")}<b>{selected.blueprint?.exitPolicy?.stopLossPct}% · {selected.blueprint?.exitPolicy?.takeProfitR}R</b></span><span>{t("参数", "Parameters")}<b className="mono">{JSON.stringify(selected.blueprint?.params || {})}</b></span></div></div><div className="mCard"><b className="mSectionTitle">{t("自动测试", "Generated tests")} · {selected.generatedTests?.passed || 0}/{selected.generatedTests?.total || 0}</b>{(selected.generatedTests?.tests || []).map((test) => <div className="mStrategyTest" key={test.id}>{test.passed ? <CheckCircle2 size={14}/> : <Info size={14}/>}<span><b>{t(test.name, test.nameEn || test.name)}</b><small>{t(test.detail, test.detailEn || test.detail)}</small></span></div>)}</div><div className="mCard"><b className="mSectionTitle">{t("样本外证据", "Out-of-sample evidence")}</b>{latestBt ? <div className="mStrategyFacts"><span>{t("交易 / 期望", "Trades / expectancy")}<b>{latestBt.oos?.trades || 0} · {latestBt.oos?.expectancyR ?? "—"}R</b></span><span>PF / {t("回撤", "drawdown")}<b>{latestBt.oos?.profitFactor ?? "—"} · {latestBt.oos?.maxDrawdownPct ?? "—"}%</b></span><span>{t("正向分段", "Positive folds")}<b>{latestBt.positiveFolds}/{latestBt.activeFolds}</b></span></div> : <p className="mStrategyHelp">{t("尚未运行 OKX 历史样本外回测。", "OKX historical OOS backtest has not run.")}</p>}<div className="mStrategyActions"><button disabled={selected.generatedTests?.status !== "passed"} onClick={() => action(`/api/strategy/studio/drafts/${selected.id}/backtest`, {}, "POST")}>{t("运行回测", "Run backtest")}</button><button disabled={!latestBt?.passed || Boolean(selected.publishVersionId)} onClick={() => action(`/api/strategy/studio/drafts/${selected.id}/publish`, {}, "POST")}>{selected.publishVersionId ? t("已发布", "Published") : t("发布到市场", "Publish")}</button></div></div></>}
      </div>}
      {tab === "market" && <div className="mStrategyStack"><div className="mCard"><b className="mSectionTitle">{t("内部策略市场", "Internal strategy market")}</b><p className="mStrategyHelp">{t("不依赖对外 MCP。启用只会加入 AI 可选集，仍须通过全部实时风控。", "Independent of external MCP. Enabling only adds a strategy to the AI eligible set; all live risk checks remain mandatory.")}</p></div>{listings.map((row) => { const def = row.definition || {}; const oos = row.validation?.oos; return <div className="mCard" key={row.id}><div className="mStrategyMarketHead"><b>{t(row.title || def.name, row.titleEn || row.title || def.name)}</b><StatusBadge tone={row.evidenceLevel === "live_validated" ? "ok" : "warning"}>{row.evidenceLevel === "oos_passed" ? t("样本外通过", "OOS passed") : row.evidenceLevel === "live_validated" ? t("实盘证据达标", "Live-validated") : t("实盘观察", "Live observation")}</StatusBadge></div><p className="mStrategyHelp">{t(row.summary || def.description, row.summaryEn || row.summary || def.description)}</p><div className="mStrategyFacts"><span>{t("版本", "Version")}<b className="mono">{row.strategyVersionId}</b></span><span>{t("方向 / 周期", "Side / timeframe")}<b>{humanize(def.direction)} · {(def.timeframes || []).join("/") || def.timeframe || "—"}</b></span><span>{t("证据", "Evidence")}<b>{row.source === "official" ? `${row.metrics?.closedTrades || 0} ${t("笔实盘", "live closes")}` : `${oos?.trades || 0} ${t("笔样本外", "OOS trades")} · ${oos?.expectancyR ?? "—"}R`}</b></span></div>{row.source === "official" ? <button className="mStrategyDisabled" disabled>{row.enabled ? t("系统当前可用", "Available") : t("已暂停", "Paused")}</button> : <button className="mStrategyPrimary" onClick={() => action(`/api/strategy/market/${encodeURIComponent(row.strategyVersionId)}/${row.enabled ? "disable" : "enable"}`, {}, "POST")}>{row.enabled ? t("从 AI 可选集移除", "Remove from AI set") : t("加入 AI 可选集", "Add to AI set")}</button>}</div>; })}</div>}
      {tab === "research" && <MobileBacktestResearch data={data} action={action}/>}
    </div>
  );
}

const mobileNav = [
  { id: "chat", label: ["AI 交易员", "AI Trader"], code: "ALPHA-01", icon: Bot },
  { id: "watch", label: ["实时盯盘", "Live Watch"], code: "WATCH · LIVE", icon: Gauge },
  { id: "cockpit", label: ["市场与账户", "Market & Account"], code: "MARKET · ACCOUNT", icon: PieChart },
  { id: "executionReview", label: ["执行与复盘", "Execution & Review"], code: "EXECUTION · REVIEW", icon: ClipboardList },
  { id: "tradeLedger", label: ["委托与成交", "Orders & Fills"], code: "ORDERS · FILLS", icon: ReceiptText },
  { id: "riskHub", label: ["风控中心", "Risk Control"], code: "RISK · CONTROL", icon: ShieldCheck },
  { id: "knowledgeBase", label: ["知识库", "Knowledge"], code: "KNOWLEDGE", icon: BookOpen },
  { id: "capabilityLib", label: ["能力库", "Capabilities"], code: "CAPABILITY · LIB", icon: Wrench },
  { id: "strategyLib", label: ["策略库", "Strategy"], code: "STRATEGY · LIB", icon: Rocket },
  { id: "intelligence", label: ["情报中心", "Intelligence"], code: "INTEL · BRIEF", icon: Globe2 },
  { id: "eventsTasks", label: ["事件与任务", "Events & Tasks"], code: "EVENTS · TASKS", icon: CalendarClock },
  { id: "auditSystem", label: ["审计", "Audit"], code: "AUDIT · SYSTEM", icon: Activity },
  { id: "systemSettings", label: ["系统设置", "Settings"], code: "SETTINGS · CONFIG", icon: Settings }
];
const mobilePrimaryNav = [
  { id: "chat", label: ["交易员", "Trader"], icon: Bot },
  { id: "watch", label: ["盯盘", "Watch"], icon: Gauge },
  { id: "cockpit", label: ["市场", "Market"], icon: PieChart },
  { id: "riskHub", label: ["风控", "Risk"], icon: ShieldCheck },
  { id: "more", label: ["更多", "More"], icon: MoreHorizontal }
];
const mobileSecondaryNav = [
  { id: "executionReview", label: ["交易记录", "Trading activity"], icon: ClipboardList, hint: ["委托、成交与复盘", "Orders, fills, and reviews"] },
  { id: "knowledgeBase", label: ["知识库", "Knowledge"], icon: BookOpen, hint: ["方法、规则与图谱", "Methods, rules, and graph"] },
  { id: "capabilityLib", label: ["能力库", "Capabilities"], icon: Wrench, hint: ["工具、工作流与 MCP", "Tools, workflows, and MCP"] },
  { id: "strategyLib", label: ["策略库", "Strategies"], icon: Rocket, hint: ["策略目录与验证", "Catalog and validation"] },
  { id: "intelligence", label: ["情报中心", "Intelligence"], icon: Globe2, hint: ["今日摘要、快讯与来源", "Brief, flashes, and sources"] },
  { id: "eventsTasks", label: ["事件与任务", "Events & Tasks"], icon: CalendarClock, hint: ["重要事件与自动任务", "Events and automation"] },
  { id: "auditSystem", label: ["运行记录", "Activity"], icon: Activity, hint: ["系统状态与审计", "System state and audit"] },
  { id: "systemSettings", label: ["设置", "Settings"], icon: Settings, hint: ["账户、交易所与模型", "Account, exchange, and model"] }
];
const mobileNavLabel = (item) => t(item?.label?.[0] || "", item?.label?.[1] || item?.label?.[0] || "");

function MobileTabbar({ route, onNavigate, onMore }) {
  return <nav className="mNativeTabbar" aria-label={t("主导航", "Primary navigation")}>
    {mobilePrimaryNav.map((item) => {
      const Icon = item.icon;
      const active = item.id === "more" ? !["chat", "watch", "cockpit", "riskHub"].includes(route) : route === item.id;
      return <button key={item.id} className={active ? "active" : ""} onClick={() => item.id === "more" ? onMore() : onNavigate(item.id)}><Icon size={20}/><span>{mobileNavLabel(item)}</span></button>;
    })}
  </nav>;
}

function MobileHeader({ route, onMenu, right, reconnecting }) {
  const item = mobileNav.find((n) => n.id === route) || mobileNav[0];
  return (
    <header className="mHeader2">
      <button className="mMenuBtn" onClick={onMenu} aria-label={t("打开菜单", "Open menu")}><Menu size={20} /></button>
      <div className="mHeaderMid"><strong>{mobileNavLabel(item)}</strong><small className="mono">{item.code}</small></div>
      <div className="mHeaderRight">
        {reconnecting && <span className="mReconnect"><span className="pulseDot" />{t("重连中", "Reconnecting")}</span>}
        {right}
      </div>
    </header>
  );
}

function NavDrawer({ open, route, onNavigate, onClose, data, lang, switchLang }) {
  if (!open) return null;
  const status = systemStatus(data);
  return (
    <div className="mDrawerOverlay" onClick={onClose}>
      <aside className="mDrawer" onClick={(event) => event.stopPropagation()}>
        <div className="mDrawerBrand"><span className="mDrawerLogo"><img src="/kordyn-logo.svg" alt="KORDYN" /></span><div className="mDrawerBrandText"><b>KORDYN</b><small>AI · DIGITAL ASSET</small></div></div>
        {switchLang && <div className="mLangBar"><Globe2 size={14} /><div className="mLangSeg" role="group" aria-label={t("切换语言", "Switch language")}><button className={lang === "zh" ? "on" : ""} onClick={() => switchLang("zh")}>中文</button><button className={lang === "en" ? "on" : ""} onClick={() => switchLang("en")}>English</button></div></div>}
        <div className="mDrawerTitle"><b>{t("更多功能", "More")}</b><small>{t("低频设置与记录", "Settings and records")}</small></div>
        <div className="mDrawerNav">
          {mobileSecondaryNav.map((n) => {
            const Icon = n.icon;
            return <button key={n.id} className={`mDrawerItem ${route === n.id ? "active" : ""}`} onClick={() => onNavigate(n.id)}><Icon size={19} /><span><b>{mobileNavLabel(n)}</b><small>{t(n.hint[0], n.hint[1])}</small></span><ChevronRight size={15}/></button>;
          })}
        </div>
        <div className="mDrawerFoot">
          <div className={`mDrawerStatus ${status.tone}`}><span />{status.label}</div>
          <button className="mDrawerClose" onClick={onClose}>{t("关闭菜单", "Close menu")}</button>
        </div>
      </aside>
    </div>
  );
}

// 下拉刷新:滚到顶再下拉超过阈值 → 触发 refresh + 轻触觉。原生 App 的核心手感。
function PullToRefresh({ onRefresh, className, children }) {
  const ref = useRef(null);
  const startY = useRef(null);
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const THRESHOLD = 66;
  const onStart = (e) => { startY.current = (ref.current && ref.current.scrollTop <= 0 && !busy) ? e.touches[0].clientY : null; };
  const onMove = (e) => {
    if (startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    // Do not prevent native scrolling until the user is clearly pulling down from the top.
    // Capturing every small move here made normal page scrolling feel sticky.
    if (dy > 10) { if (e.cancelable) e.preventDefault(); setPull(Math.min((dy - 10) * 0.45, 88)); }
    else setPull(0);
  };
  const onEnd = async () => {
    if (startY.current == null) return;
    const shouldRefresh = pull >= THRESHOLD && !busy;
    startY.current = null;
    if (shouldRefresh) { setBusy(true); setPull(46); haptic("light"); try { await onRefresh?.(); } catch { /* 忽略 */ } setBusy(false); }
    setPull(0);
  };
  return (
    <main ref={ref} className={className} onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd}
      style={{ transform: pull ? `translateY(${pull}px)` : "", transition: startY.current == null ? "transform .24s cubic-bezier(.2,.8,.2,1)" : "none" }}>
      <div className="mPtr" style={{ opacity: pull || busy ? 1 : 0 }}>
        <RefreshCw size={16} className={busy ? "mSpin" : ""} style={{ transform: busy ? "" : `rotate(${Math.min(pull * 4, 360)}deg)` }} />
        <span>{busy ? t("刷新中…", "Refreshing…") : pull >= THRESHOLD ? t("松开刷新", "Release to refresh") : t("下拉刷新", "Pull to refresh")}</span>
      </div>
      {children}
    </main>
  );
}

export function MobileApp({ api, lang, switchLang }) {
  const { data, action, toast, busy, notify, download, refresh, ensureSection, connectionError } = api;
  const [route, setRoute] = useState("chat");
  const [drawer, setDrawer] = useState(false);
  const [subPage, setSubPage] = useState("");
  const [panel, setPanel] = useState("");
  const [killConfirm, setKillConfirm] = useState(false);
  // 打开审计/动态即把未读通知标为已读
  useEffect(() => {
    if (route === "auditSystem" && (data.notifications || []).some((item) => !item.read)) action("/api/notifications/read", {});
  }, [route]);
  useEffect(() => {
    const section = route === "chat" || route === "watch" ? "chat"
      : ["cockpit", "executionReview", "tradeLedger"].includes(route) ? "cockpit"
        : ["knowledgeBase", "capabilityLib", "strategyLib"].includes(route) ? "researchCenter"
          : route === "riskHub" ? "riskCenter"
            : ["intelligence", "eventsTasks", "auditSystem"].includes(route) ? "operationsCenter"
              : route === "systemSettings" ? "systemSettings" : "cockpit";
    ensureSection?.(section);
  }, [route]);

  function navigate(next) {
    haptic("light");
    if (next === "tradeJournal") { setRoute("executionReview"); setSubPage(""); setDrawer(false); return; }
    if (next === "strategyLib:studio") { setRoute("strategyLib"); setSubPage("studio"); setDrawer(false); return; }
    if (mobileNav.some((n) => n.id === next)) { setRoute(next); setSubPage(""); setDrawer(false); return; }
    if (next === "positions" || next === "marketAccount") { setRoute("cockpit"); setSubPage(next); setDrawer(false); return; }
    if (next === "systemSettings") { setRoute("systemSettings"); setSubPage(""); setDrawer(false); return; }
    if (String(next).startsWith("settings:")) { setRoute("systemSettings"); setSubPage(next); setDrawer(false); return; }
    setRoute("cockpit"); setSubPage(""); setDrawer(false);
  }

  const ui = { setActive: navigate, notify, download, refresh, ensureSection, openPanel: setPanel, closePanel: () => setPanel("") };
  const autoOn = data.system?.autonomyEnabled === true && !data.system?.killSwitch;
  const settingsSection = subPage.startsWith("settings:") ? subPage.slice(9) : "";

  let content = null;
  if (route === "chat") {
    content = <div className="mChatContent"><MobileChatStatus data={data} /><ChatPage data={data} action={action} ui={ui} mobile /></div>;
  } else if (route === "watch") {
    content = <MobileWatch data={data} action={action} />;
  } else if (route === "cockpit") {
    content = subPage === "positions" ? <MobilePositions data={data} action={action} ui={ui} />
      : subPage === "marketAccount" ? <MobileAccountHealth data={data} action={action} />
        : <MobileMarket data={data} action={action} ui={ui} />;
  } else if (route === "executionReview") {
    content = <MobileExecution data={data} action={action} initialTab="overview" />;
  } else if (route === "tradeLedger") {
    content = <MobileExecution data={data} action={action} initialTab="orders" />;
  } else if (route === "riskHub") {
    content = <MobileRiskHub data={data} action={action} ui={ui} />;
  } else if (route === "intelligence") {
    content = <MobileIntelligence data={data} action={action} ui={ui} />;
  } else if (route === "eventsTasks") {
    content = <MobileTasks data={data} action={action} ui={ui} />;
  } else if (route === "knowledgeBase") {
    content = <MobileKnowledge data={data} action={action} ui={ui} view="knowledge" />;
  } else if (route === "capabilityLib") {
    content = <MobileCapabilities data={data} action={action} ui={ui} />;
  } else if (route === "strategyLib") {
    content = <div className="content mSubContent"><MobileStrategy data={data} action={action} initialTab={subPage === "studio" ? "studio" : "catalog"} /></div>;
  } else if (route === "auditSystem") {
    content = <MobileAudit data={data} ui={ui} />;
  } else if (route === "systemSettings") {
    content = settingsSection ? <div className="content mSubContent"><div className="settingsPage"><SystemConfigPanel data={data} action={action} ui={ui} section={settingsSection} /></div></div>
        : <MobileSettingsIndex data={data} onOpen={setSubPage} />;
  } else {
    content = <MobileMarket data={data} action={action} ui={ui} />;
  }

  const headerRight = subPage
    ? <button className="mBack" onClick={() => setSubPage("")} aria-label={t("返回", "Back")}><ChevronLeft size={19} /></button>
    : route === "chat"
      ? <span className={`mRunBadge ${autoOn ? "on" : "off"}`}><span className="pulseDot" />{autoOn ? t("运行中", "Running") : t("已暂停", "Paused")}</span>
      : <button className="mKill" onClick={() => setKillConfirm(true)}><Zap size={13} /> {data.system?.killSwitch ? t("恢复交易", "Resume") : t("紧急停止", "Emergency stop")}</button>;

  return (
    <div className="mShell2">
      <MobileHeader route={route} onMenu={() => setDrawer(true)} right={headerRight} reconnecting={Boolean(connectionError)} />
      {route === "chat" && !subPage
        ? <main className="mMain2 mMainChat">{content}</main>
        : <PullToRefresh className="mMain2" onRefresh={refresh}>{content}</PullToRefresh>}
      <MobileTabbar route={route} onNavigate={navigate} onMore={() => setDrawer(true)} />
      <NavDrawer open={drawer} route={route} onNavigate={navigate} onClose={() => setDrawer(false)} data={data} lang={lang} switchLang={switchLang} />
      {killConfirm && <KillConfirmDialog enable={!data.system?.killSwitch} action={action} onClose={() => setKillConfirm(false)} />} {/* 已熔断时应走解除流程(审计 L5) */}
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {busy && <div className="busyIndicator"><Activity size={13} /> {t("执行中", "Working")}</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
