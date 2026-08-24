import { useEffect, useRef, useState } from "react";
import { uiConfirm } from "./confirm.jsx";
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
  GitBranch,
  Globe2,
  Eye,
  Info,
  MoreHorizontal,
  Plus,
  Play,
  RefreshCw,
  ReceiptText,
  Search,
  Settings,
  Shield,
  Target,
  Wrench,
  Zap,
  CheckCircle2,
  Rocket,
  Sparkles,
  Trash2
} from "lucide-react";
import { apiUrl, authHeaders, automationPresentation, haptic, displayMoney, marginUsage, SKILL_STATE, SKILL_STATE_HELP, OPEN_EXECUTION_STATES, countOpenExecutions, displayPrice, displayPct, formatDate, formatDateTime, formatTime, humanize, localizeText, smartMoneyBias, TradingViewChart, LivePrice, StatusBadge, statusTone } from "./lib.jsx";
import { ChatPage } from "./chat.jsx";
import { ConceptGraph } from "./conceptGraph.jsx";
import { ConfigPanel, SystemConfigPanel, TaskManagerPanel } from "./panels.jsx";
import { t } from "./i18n.js";
import { executionExitAction, requestExecutionExit } from "./executionExit.js";
import { resolveMobileRoute } from "./productArchitecture.js";
import {
  MOBILE_MORE_UTILITIES,
  MOBILE_NAV_PRESENTATION,
  MOBILE_PRIMARY_NAV,
  MOBILE_WORKSPACE_NAV,
  mobileWorkspaceDestinations
} from "./mobileNavigation.js";
import { buildResearchMap } from "./researchMap.js";
import { buildControlConfigurationView } from "./controlConfigurationView.js";
import { MobileOperations } from "./mobileOperations.jsx";
import { WorkspaceStateBoundary } from "./productShell.jsx";
import { AgentSettingsConcept, UsersSettingsConcept } from "./conceptPages.jsx";
import {
  buildCapabilityCatalogRows,
  buildEventRows,
  buildExecutionView,
  buildMarketRows,
  buildPositionView,
  buildStrategyCatalogRows,
  hasFiniteNumber,
  isApprovedKnowledgeWorkflow,
  isCompletedTradeReview,
  isPublishedImportedSkill,
  isPublishedKnowledgeStrategy,
  netReviewResult,
  strategyBacktestCoverage
} from "./viewData.js";

function killSwitchEvidence(result = {}) {
  const evidence = [];
  const add = (label, value) => { if (value !== undefined && value !== null && value !== "") evidence.push(`${label}: ${typeof value === "object" ? JSON.stringify(value) : value}`); };
  add("Audit", result.auditId ?? result.audit?.id);
  add("Result", result.resultId ?? result.result?.id ?? result.emergencyActionId);
  add("State", typeof result.killSwitch === "boolean" ? `killSwitch=${result.killSwitch}` : null);
  return evidence.join(" · ");
}

export async function submitKillSwitchChange({ enable, reason = "", confirmation, action, onConfirmed }) {
  const expected = enable ? "KILL" : "RESUME";
  if (confirmation !== expected) return { ok: false, blocked: true, message: t(`输入 ${expected} 后才能继续`, `Type ${expected} to continue`), evidence: "" };
  try {
    const result = await action("/api/risk/kill-switch", { enabled: enable, reason });
    const explicitFailure = result?.ok === false;
    const authoritativeSuccess = result?.ok === true || (result?.ok == null && result?.killSwitch === enable);
    const outcome = {
      ok: !explicitFailure && authoritativeSuccess,
      blocked: false,
      message: explicitFailure
        ? String(result?.error || result?.message || t("后端未确认状态变更", "The backend did not confirm the state change"))
        : authoritativeSuccess
          ? t("后端已确认状态变更", "The backend confirmed the state change")
          : t("响应未包含可验证的成功状态；运行状态保持未确认。", "The response did not include verifiable success; runtime state remains unconfirmed."),
      evidence: killSwitchEvidence(result),
      result
    };
    if (outcome.ok) onConfirmed?.(outcome);
    return outcome;
  } catch (error) {
    const result = error?.result || {};
    return { ok: false, blocked: false, message: String(error?.message || t("状态变更失败", "State change failed")), evidence: killSwitchEvidence(result), result };
  }
}

export function KillSwitchOutcome({ outcome }) {
  if (!outcome) return null;
  return <div className={`confirmOutcome ${outcome.ok ? "success" : "failed"}`} role={outcome.ok ? "status" : "alert"}>
    <b>{outcome.ok ? t("已确认", "Confirmed") : t("未生效 · 对话保持打开", "Not applied · dialog remains open")}</b>
    <span>{outcome.message}</span>
    {outcome.evidence && <code>{outcome.evidence}</code>}
  </div>;
}

export function KillConfirmDialog({ enable, action, onClose }) {
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [outcome, setOutcome] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const expectedConfirmation = enable ? "KILL" : "RESUME";
  async function confirm() {
    if (confirmation !== expectedConfirmation || submitting) return;
    setSubmitting(true);
    const next = await submitKillSwitchChange({ enable, reason, confirmation, action });
    setOutcome(next);
    setSubmitting(false);
    if (next.ok) onClose(next);
  }
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className={`confirmDialog ${enable ? "danger" : ""}`} role="dialog" aria-modal="true" aria-labelledby="kill-confirm-title" onClick={(event) => event.stopPropagation()}>
        <header className="confirmDialogHead"><small>{enable ? "SAFETY CONFIRMATION / KILL" : "SAFETY CONFIRMATION / RESET"}</small><strong id="kill-confirm-title">{enable ? t("确认紧急停止新交易？", "Activate the emergency stop?") : t("确认恢复新交易？", "Resume new trading?")}</strong></header>
        <p className="confirmEffect"><b>{t("生效结果", "Effect")}</b><span>{enable ? t("立即阻断所有新交易，并请求撤销全部在途委托。", "Immediately blocks all new trades and requests cancellation of all open orders.") : t("恢复正常风控运行，并在后端重新核验后允许新交易。", "Resumes normal risk control and permits new trades only after backend revalidation.")}</span></p>
        <p className="confirmPermitted"><b>{t("仍然允许", "Still permitted")}</b><span>{t("风险降低型平仓、撤单、维持保护、对账与恢复动作仍可执行。", "Risk-reducing position closes, order cancellation, protection maintenance, reconciliation, and recovery remain permitted.")}</span></p>
        {enable && <label className="confirmField"><span>{t("停止原因（可选，会写入审计记录）", "Reason (optional, written to the audit trail)")}</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} rows="2" /></label>}
        <label className="confirmField"><span>{t(`输入 ${expectedConfirmation} 以确认`, `Type ${expectedConfirmation} to confirm`)}</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} placeholder={expectedConfirmation} autoComplete="off" autoFocus /></label>
        <KillSwitchOutcome outcome={outcome}/>
        <div className="confirmActions">
          <button type="button" className="ghostButton" onClick={onClose}>{t("取消", "Cancel")}</button>
          <button type="button" className={enable ? "confirmDanger" : "primaryButton"} disabled={confirmation !== expectedConfirmation || submitting} onClick={confirm}>{submitting ? t("等待后端确认…", "Awaiting backend confirmation…") : enable ? t("确认紧急停止", "Confirm emergency stop") : t("确认恢复", "Confirm resume")}</button>
        </div>
      </div>
    </div>
  );
}

function MobileSafetySheet({ data, action, onClose, onKill }) {
  const runtime = automationPresentation(data);
  const primaryBlocker = runtime.blockerDetails[0] || null;
  const stopped = data.system?.killSwitch === true;
  const flattenAll = async () => {
    if (await uiConfirm(t("确认按市价平掉全部持仓？系统会暂停新开仓，直到 OKX 对账完成。", "Close every position at market? New entries will pause until OKX reconciliation completes."))) {
      await action("/api/risk/emergency-flatten", {}); onClose();
    }
  };
  return <div className="mSafetyOverlay" onClick={onClose}><section className="mSafetySheet" onClick={event=>event.stopPropagation()}>
    <i className="mSafetyHandle"/>
    <header><div><small>{t("当前实际状态", "EFFECTIVE NOW")}</small><b>{runtime.label}</b><p>{runtime.detail}</p></div><StatusBadge tone={runtime.tone==="ok"?"ok":runtime.tone==="danger"?"danger":runtime.tone==="warning"?"warning":"neutral"}>{runtime.entryPolicy}</StatusBadge></header>
    <div className="mSafetyTarget"><span>{t("长期目标", "Saved target")}</span><b>{runtime.targetLabel}</b></div>
    {runtime.runtimeStatus !== "normal" && <div className="mSafetyTarget"><span>{t("恢复方式", "Recovery")}</span><b>{runtime.recoveryLabel}</b></div>}
    {primaryBlocker && <div className="mSafetyReason"><b>{localizeText(primaryBlocker.label || primaryBlocker)}</b>{primaryBlocker.detail && <p>{localizeText(primaryBlocker.detail)}</p>}{primaryBlocker.recovery && <small><RefreshCw/>{localizeText(primaryBlocker.recovery)}</small>}</div>}
    <div className="mSafetyActions">
      <button className="danger" onClick={flattenAll}><Target/><span><b>{t("全部平仓", "Flatten all")}</b><small>{t("按市价关闭全部持仓", "Close all positions at market")}</small></span></button>
      <button className={`danger ${stopped?"active":""}`} onClick={()=>{onClose();onKill();}}><Zap/><span><b>{stopped?t("解除紧急停止", "Clear emergency stop"):t("紧急停止", "Emergency stop")}</b><small>{t("立即阻止所有新交易", "Immediately block all new trades")}</small></span></button>
    </div>
    <button className="mSafetyClose" onClick={onClose}>{t("关闭", "Close")}</button>
  </section></div>;
}

const settingsSections = [
  { id: "trading", label: t("交易与运行", "Trading & runtime") },
  { id: "risk", label: t("风险规则", "Risk rules") },
  { id: "llm", label: t("模型", "Model") },
  { id: "exchange", label: t("交易所", "Exchange") },
  { id: "integrations", label: t("外部服务", "Integrations") },
  { id: "event_sources", label: t("事件源", "Event sources") },
  { id: "agents", label: t("Agent 配置", "Agent Configuration") },
  { id: "users", label: t("用户与订阅", "Users & Subscriptions") },
  { id: "environment", label: t("环境与服务", "Environment & services") },
  { id: "network", label: t("网络代理", "Network proxy") },
  { id: "data_backup", label: t("数据与备份", "Data & backup") },
  { id: "security", label: t("登录与凭证安全", "Sign-in & credential security") }
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
  const activeExec = OPEN_EXECUTION_STATES; // 单一来源(lib),与后端对齐
  const activeExecutions = executions.filter((order) => activeExec.includes(String(order.status || "").toLowerCase())).length;
  const portfolio = data.portfolio || {};
  const configured = (data.exchangeAccounts || []).some((account) => account.readEnabled);
  const exposure = positionView.exposureUsdt;
  const totalPnl = positionView.unrealizedPnlUsdt;
  const availableMargin = portfolio.availableMarginUsdt ?? portfolio.availableMargin ?? null;
  const marginRate = configured ? marginUsage(portfolio).marginRatePct : null;
  return (
    <div className="mPositions kRegistry">
      <div className="mPageStats kTruthBand">
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
      <div className="mChips kFilterRail">
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

      <div className="mList kActionBar">
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
  const { orders, fills, closedTrades: closes, reviews, performance, lifecycleState, totals } = execution;
  const inFlight = countOpenExecutions(orders);
  const performanceAvailable = lifecycleState === "loaded" || hasFiniteNumber(data.performance?.totalPnlUsdt);
  const realized = performanceAvailable ? Number(performance.totalPnlUsdt) : null;
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
    <div className="mSegmentNav kFilterRail">{tabs.map(([id, label]) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {tab === "overview" && <>
      <div className="mMetric2x2 kTruthBand"><div className="mMetricCell"><span>{t("净交易结果", "Net trade result")}</span><b className={`mono ${realized == null ? "" : realized >= 0 ? "pos" : "neg"}`}>{realized == null ? "—" : `${realized >= 0 ? "+" : ""}${displayMoney(realized, 2)}`}</b>{realized == null && <small>{t("尚未加载", "Not loaded")}</small>}</div><div className="mMetricCell"><span>{t("胜率", "Win rate")}</span><b className="mono">{performance.trades ? `${performance.winRatePct}%` : "—"}</b></div><div className="mMetricCell"><span>{t("在途执行", "In flight")}</span><b className="mono">{inFlight}</b></div><div className="mMetricCell"><span>{t("待复盘", "To review")}</span><b className="mono">{pendingReviews}</b></div></div>
      <section className="mNativeSection kRegistry"><header><div><b>{t("当前重点", "Needs attention")}</b><small>{t("按交易流程排序", "Ordered by trading workflow")}</small></div></header>
        <button className="mActionRow" onClick={() => setTab("orders")}><span className={inFlight ? "warning" : "ok"}>{inFlight || "✓"}</span><div><b>{inFlight ? t(`${inFlight} 笔执行正在推进`, `${inFlight} executions in progress`) : t("没有在途执行", "No executions in flight")}</b><small>{t("核对订单、保护单与交易所状态", "Review orders, protection, and exchange state")}</small></div><ChevronRight size={16}/></button>
        <button className="mActionRow" onClick={() => setTab("reviews")}><span className={pendingReviews ? "warning" : "ok"}>{pendingReviews || "✓"}</span><div><b>{pendingReviews ? t(`${pendingReviews} 笔交易等待复盘`, `${pendingReviews} trades await review`) : t("复盘队列已处理", "Review queue is clear")}</b><small>{t("优先复盘亏损与异常离场", "Prioritize losses and unusual exits")}</small></div><ChevronRight size={16}/></button>
      </section>
      <section className="mNativeSection mEvidenceLedger kEvidenceLedger"><header><div><b>{t("最近平仓", "Latest closed trades")}</b><small>{t("完整生命周期 · 净手续费与资金费", "Completed lifecycles · net of recorded fees and funding")}</small></div><button className="mLink" onClick={() => setTab("fills")}>{t("成交流水", "Fill ledger")}</button></header>{closes.slice(0, 5).map((row) => <div className="mTradeRow" key={row.id}><div><b className="mono">{row.symbol || "—"}</b><small>{direction(row)} · {row.closeCount > 1 ? t(`${row.closeCount} 笔平仓合并`, `${row.closeCount} closes combined`) : t("已平仓", "Closed")}</small></div><div><b className={`mono ${Number(row.netRealizedPnl || 0) >= 0 ? "pos" : "neg"}`}>{Number(row.netRealizedPnl) >= 0 ? "+" : ""}{displayMoney(row.netRealizedPnl, 2)}</b><small>{formatTime(row.createdAt)} · {t("净", "net")}</small></div></div>)}{!closes.length && <div className="mNativeEmpty"><ReceiptText size={22}/><b>{t("暂无已平仓交易", "No closed trades yet")}</b></div>}</section>
    </>}
    {tab === "orders" && <section className="mNativeSection kRegistry"><header><div><b>{t("AI 委托", "AI orders")}</b><small>{orders.length === totals.orders ? `${totals.orders} ${t("笔记录", "records")}` : `${t("最近", "Latest")} ${orders.length} / ${totals.orders}`}</small></div></header>{orders.map((row) => { const exit = executionExitAction(row); return <article className="mOrderCard" key={row.id}><header><div><b className="mono">{row.symbol || "—"}</b><span className={/short|sell|空/i.test(String(row.direction || row.side)) ? "short" : "long"}>{direction(row)}</span></div><StatusBadge tone={statusTone(row.status)}>{humanize(row.status)}</StatusBadge></header><div><span>{t("入场", "Entry")}<b className="mono">{displayPrice(row.entryPrice ?? row.price)}</b></span><span>{t("止损", "Stop")}<b className="mono">{displayPrice(row.stopLoss)}</b></span><span>{t("数量", "Size")}<b className="mono">{row.filledQuantity ?? row.quantity ?? row.size ?? "—"}</b></span></div>{exit && <button onClick={() => requestExecutionExit(action, row, "manual_mobile")}>{exit.label}</button>}</article>; })}{!orders.length && <div className="mNativeEmpty"><ClipboardList size={22}/><b>{t("暂无委托", "No orders")}</b></div>}</section>}
    {tab === "fills" && <section className="mNativeSection mEvidenceLedger kEvidenceLedger"><header><div><b>{t("成交流水", "Fill ledger")}</b><small>{fills.length === totals.fills ? `${totals.fills} ${t("笔成交", "fills")}` : `${t("最近", "Latest")} ${fills.length} / ${totals.fills}`}</small></div><span>{t("开仓 / 减仓 / 平仓", "Entries / reductions / closes")}</span></header>{fills.map((row, index) => { const isClose = row.kind === "close" && hasFiniteNumber(row.realizedPnl); const pnl = Number(row.realizedPnl || 0); return <div className="mTradeRow" key={row.id || index}><div><b className="mono">{row.symbol || "—"}</b><small>{direction(row)} · {fillKind(row)} · {row.quantity ?? row.size ?? "—"} @ {displayPrice(row.price)}</small></div><div><b className={`mono ${isClose ? (pnl >= 0 ? "pos" : "neg") : ""}`}>{isClose ? `${pnl >= 0 ? "+" : ""}${displayMoney(pnl, 2)}` : displayPrice(row.price)}</b><small>{isClose ? `${t("价格毛盈亏", "Gross price PnL")} · ` : ""}{formatDateTime(row.createdAt)}{hasFiniteNumber(row.feeUsdt ?? row.fee) ? ` · ${t("费", "fee")} ${displayMoney(row.feeUsdt ?? row.fee, 2)}` : ""}</small></div></div>; })}{!fills.length && <div className="mNativeEmpty"><ReceiptText size={22}/><b>{t("暂无成交", "No fills")}</b><span>{t("交易所确认的开仓、减仓和平仓成交都会显示在这里。", "Exchange-confirmed entries, reductions, and closes appear here.")}</span></div>}</section>}
    {tab === "reviews" && <>
      <div className="mReviewHero"><span><b className="mono">{completedReviews}</b><small>{t("已完成", "Completed")}</small></span><span><b className="mono">{pendingReviews}</b><small>{t("待复盘", "Pending")}</small></span><span><b className="mono neg">{lossReviews}</b><small>{t("亏损复盘", "Losses")}</small></span></div>
      <div className="mReviewFilters">{[["all", t("全部", "All")], ["loss", t("只看亏损", "Losses")], ["pending", t("待处理", "Pending")]].map(([id, label]) => <button type="button" className={reviewFilter === id ? "active" : ""} key={id} onClick={() => setReviewFilter(id)}>{label}</button>)}</div>
      <section className="mNativeSection mEvidenceLedger kEvidenceLedger"><header><div><b>{t("交易复盘", "Trade reviews")}</b><small>{reviews.length === totals.reviews ? t("点开一笔查看归因与下一次动作", "Open a trade for attribution and next action") : `${t("当前加载", "Loaded")} ${reviews.length} / ${totals.reviews}`}</small></div></header>{filteredReviews.map((row, index) => { const trade = tradeForReview(row); const pnl = reviewPnl(row); const completed = isCompletedTradeReview(row); return <button type="button" className="mReviewRow" key={row.id || index} onClick={() => setSelectedReview({ review: row, trade })}><div className="mReviewRowTop"><span><b className="mono">{row.symbol || trade?.symbol || "—"}</b><small>{direction(row)}</small></span><b className={`mono ${pnl == null ? "" : pnl >= 0 ? "pos" : "neg"}`}>{pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}${displayMoney(pnl, 2)}`}</b></div><p>{localizeText(row.lesson || row.summary) || t("等待成交事实回补与归因。", "Awaiting fill reconciliation and attribution.")}</p><footer><span className={`mReviewState ${completed ? "done" : "pending"}`}>{completed ? t("已完成", "Completed") : t("处理中", "In progress")}</span><time>{formatDateTime(row.completedAt || row.updatedAt || row.createdAt)}</time><ChevronRight size={14}/></footer></button>; })}{!filteredReviews.length && <div className="mNativeEmpty"><BookOpen size={22}/><b>{reviews.length ? t("当前筛选下没有记录", "No reviews in this filter") : t("暂无复盘", "No reviews")}</b><span>{t("完整平仓确认后会自动进入复盘队列。", "Confirmed full closes enter the review queue automatically.")}</span></div>}</section>
    </>}
    {selectedReview && <MobileReviewSheet review={selectedReview.review} trade={selectedReview.trade} onClose={() => setSelectedReview(null)} />}
  </div>;
}

// 屏 S5 — 系统设置：账户卡 + 交易所列表 + 系统配置分区 + 订阅卡。
export function MobileSettingsIndex({ data, ui, onOpen }) {
  const config = data.config || {};
  const exchange = config.exchange || {};
  const integrations = config.integrations || {};
  const runtime = config.runtime || {};
  const user = data.user || {};
  const control = buildControlConfigurationView(data);
  const effective = automationPresentation(data);
  const tracksSupplementalLoading = Array.isArray(data.loadedSections);
  const riskSupplementLoaded = !tracksSupplementalLoading || data.loadedSections.includes("riskCenter");
  const operationsSupplementLoaded = !tracksSupplementalLoading || data.loadedSections.includes("operationsCenter");
  const notLoadedLabel = t("尚未加载", "Not loaded");
  const configurationAudit = (data.auditLogs || []).filter((item) => /config|setting|mandate|risk|credential|notification|environment|配置|设置|权限|凭证/i.test(`${item.action || ""} ${item.resource || ""} ${item.target || ""}`)).slice(0, 3);
  useEffect(() => {
    ui?.ensureSection?.("riskCenter", { background: true });
    ui?.ensureSection?.("operationsCenter", { background: true });
  }, []);
  const sub = (data.subscriptions || [])[0] || {};
  const subExpiresAt = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd).getTime() : null;
  const subExpired = Number.isFinite(subExpiresAt) && subExpiresAt < Date.now();
  const subs = {
    trading: control.mandate.id ? `v${control.mandate.version} · ${control.mandate.allowedSymbols.length} ${t("个市场", "markets")}` : t("未授权", "Not authorized"),
    risk: riskSupplementLoaded ? `${control.rules.enabled}/${control.rules.total} ${t("条生效", "active")}` : notLoadedLabel,
    llm: config.llm?.activeProvider ? humanize(config.llm.activeProvider, config.llm.activeProvider) : t("未配置", "Not configured"),
    exchange: exchange.okx?.hasKey ? "OKX" : t("未配置", "Not configured"),
    integrations: integrations.telegram?.configured ? t("TG 已接入", "Telegram connected") : integrations.lark?.hasWebhook ? t("飞书已接入", "Lark connected") : t("未配置", "Not configured"),
    event_sources: operationsSupplementLoaded ? `${(data.eventSources || []).filter((item) => item.enabled !== false).length}/${(data.eventSources || []).length} ${t("个启用", "enabled")}` : notLoadedLabel,
    agents: `${(data.agentProfiles || []).filter((item) => item.enabled !== false).length}/${(data.agentProfiles || []).length} ${t("个启用", "enabled")}`,
    users: data.user?.isOwner ? `${(data.users || []).length || 1} ${t("个用户", "users")}` : t("Owner 权限", "Owner authority"),
    environment: `${runtime.okxMarketType || "perpetual_swap"} · :${runtime.port || "8787"}`,
    network: runtime.httpProxySet || runtime.httpsProxySet ? t("代理已配置", "Proxy configured") : t("当前直连", "Direct connection"),
    data_backup: t("在线一致性快照", "Online consistent snapshot"),
    security: runtime.authRequired === false ? t("免登录", "No login") : t("鉴权开启", "Auth enabled")
  };
  const scopeOf = (id) => /trading|risk/.test(id) ? "TRADING" : /llm|exchange|integrations|event_sources/.test(id) ? "CONNECTIONS" : /agents|users/.test(id) ? "GOVERNANCE" : "SYSTEM";
  return (
    <div className="mScreen mConfigurationIndex">
      <section className="mConfigurationTruth kTruthBand">
        <header><span className="mAcctAvatar">{user.avatar ? <img src={user.avatar} alt="" /> : String(localizeText(user.name || user.email || "U")).charAt(0).toUpperCase()}</span><div><small>{t("安全配置会话", "SECURE CONFIGURATION SESSION")}</small><h2>{localizeText(user.name || t("量化交易员", "Quant Trader"))}</h2><p>{user.email || "—"} · {user.isOwner ? "OWNER" : sub.status ? "PRO" : t("标准权限", "STANDARD")}</p></div><StatusBadge tone={effective.tone==="ok"?"ok":effective.tone==="danger"?"danger":effective.tone==="warning"?"warning":"neutral"}>{effective.label}</StatusBadge></header>
        <div><span><small>{t("当前实际状态", "Effective now")}</small><b>{effective.label}</b></span><span><small>{t("保存目标", "Saved target")}</small><b>{effective.targetLabel}</b></span></div>
      </section>

      <section className="mConfigurationRegistry kRegistry"><header><div><small>ADMINISTRATION / SCOPE FIRST</small><b>{t("配置登记", "Configuration registry")}</b><p>{t("所有持久修改的唯一入口", "Single home for durable changes")}</p></div><strong>{settingsSections.length}</strong></header>{settingsSections.map((item, index) => (
        <button type="button" key={item.id} onClick={() => onOpen(`settings:${item.id}`)}><i>{String(index + 1).padStart(2, "0")}</i><span><small>{scopeOf(item.id)}</small><b>{item.label}</b></span><em className="mono">{subs[item.id]}</em><ChevronRight size={15}/></button>
      ))}</section>

      <section className="mConfigurationLedger kEvidenceLedger"><header><div><small>{t("安全与归属", "SECURITY & OWNERSHIP")}</small><b>{t("凭证、订阅与审计边界", "Credential, subscription, and audit boundary")}</b></div></header><button type="button" onClick={() => onOpen("settings:exchange")}><Shield size={15}/><span><b>{t("OKX 凭证", "OKX credentials")}</b><small>{exchange.okx?.hasKey?t("已配置密钥；只允许读取与交易，不允许提现", "Key configured; read/trade only, never withdrawals"):t("尚未配置；凭证值始终保持遮罩", "Not configured; credential values remain masked")}</small></span><StatusBadge tone={exchange.okx?.hasKey?"ok":"neutral"}>{exchange.okx?.hasKey?t("已连接", "Connected"):t("未连接", "Not connected")}</StatusBadge><ChevronRight size={14}/></button>{sub.status&&<div className="mConfigurationSubscription"><span><small>{sub.source === "owner_grant" ? t("Owner 免费授权", "Owner free grant") : humanize(sub.status)}</small><b>{sub.planName || t("专业版", "Pro")}</b></span><StatusBadge tone={subExpired?"danger":"ok"}>{subExpired?t("已过期", "Expired"):t("生效中", "Active")}</StatusBadge><time className="mono">{t("到期", "Expires")} {sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : t("长期有效", "No expiry")}</time></div>}<div className={`mConfigurationAuditState ${operationsSupplementLoaded ? "loaded" : "loading"}`} data-state={operationsSupplementLoaded ? "loaded" : "not-loaded"}><ReceiptText size={15}/><span><b>{operationsSupplementLoaded ? (configurationAudit.length ? t(`${configurationAudit.length} 条最近配置审计`, `${configurationAudit.length} recent configuration audit records`) : t("暂无配置审计记录", "No configuration audit records")) : notLoadedLabel}</b><small>{operationsSupplementLoaded ? (configurationAudit[0] ? `${localizeText(configurationAudit[0].action)} · ${formatDateTime(configurationAudit[0].createdAt)}` : t("保存配置后的权威审计会显示在这里。", "Authoritative audit appears here after configuration saves.")) : t("正在加载权威审计；缺失数据不代表没有变更。", "Loading authoritative audit; absent data does not mean no changes.")}</small></span></div></section>
    </div>
  );
}

export function MobileGovernanceConfiguration({ kind, data, action, ui }) {
  if (kind === "users" && data.user?.isOwner !== true) {
    return <div className="mScreen mConfigurationGovernance mConfigurationEditor kFormSurface"><header><b>{t("用户与订阅", "Users & Subscriptions")}</b><p>{t("该配置域只允许 Owner 访问。", "This configuration domain is restricted to the Owner.")}</p></header><div className="mConfigurationForbidden kStateRow kStateRow--warning"><i/><div><b>{t("Owner 权限必需", "Owner authority required")}</b><span>{t("当前权限仍可查看自己的账户与订阅状态，但不能管理其他用户。", "Current authority may inspect its own account and subscription, but cannot manage other users.")}</span></div></div></div>;
  }
  return <div className="mScreen mConfigurationGovernance mConfigurationEditor kFormSurface">
    <header><b>{kind === "agents" ? t("Agent 配置", "Agent Configuration") : t("用户与订阅", "Users & Subscriptions")}</b><p>{kind === "agents" ? t("角色、模型与工具权限的真实配置面。", "The authoritative editor for roles, models, and tool permissions.") : t("用户、角色、订阅与实例开通的 Owner 配置面。", "The Owner editor for users, roles, subscriptions, and instance onboarding.")}</p></header>
    {kind === "agents" ? <AgentSettingsConcept data={data} action={action} ui={ui}/> : <UsersSettingsConcept data={data} action={action} ui={ui}/>}
  </div>;
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
  return <div className="mScreen mRiskDetail mConfigurationEditor kFormSurface">
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
  const buildForm = () => ({ mode: requested, acknowledged: Boolean(live.acknowledged), maxNotionalUsdt: live.maxNotionalUsdt || 50 });
  const [form, setForm] = useState(buildForm);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(buildForm()), [requested, live.acknowledged, live.maxNotionalUsdt]);
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
    setSaving(true);
    try {
      const ok = await submitMobileRiskChange(action, "/api/config/live-trading", { requestedMode: form.mode, acknowledged: form.acknowledged, allowedSymbols: [], maxNotionalUsdt: Number(form.maxNotionalUsdt || 50) });
      if (ok) onDone();
    } finally { setSaving(false); }
  }
  return <div className="mScreen mRiskDetail mConfigurationEditor kFormSurface">
    <section className="mNativeSection"><header><div><b>{t("运行模式", "Operating mode")}</b><small>{t("系统异常只会临时暂停新开仓，不会改变你的选择", "Runtime issues only pause new entries temporarily and never change your choice")}</small></div></header><div className="mModePicker">{[["observe", t("只分析", "Analyze only"), t("持续分析，不向 OKX 发单", "Keep analyzing; never submit to OKX")], ["semi_auto", t("逐笔确认", "Approve each trade"), t("每笔真实交易都由你确认", "You approve every live trade")], ["full_auto", t("自动交易", "Automatic trading"), t("通过审查和硬风控后自动执行", "Auto-execute after review and hard-risk checks")]].map(([id, title, desc]) => <button type="button" className={form.mode === id ? `active ${id}` : id} key={id} onClick={() => setForm((current) => ({ ...current, mode: id }))}><span><b>{title}</b><small>{desc}</small></span><i /></button>)}</div></section>
    {form.mode!=="observe"&&<section className="mNativeSection"><header><div><b>{t("真实订单边界", "Live-order boundary")}</b><small>{t("交易币种沿用交易权限中的清单", "Pairs follow the trading-permission list")}</small></div></header><div className="mRiskFieldStack"><MobileRiskField label={t("真实订单单笔上限", "Maximum per live order")} suffix="USDT"><input type="number" min="1" inputMode="decimal" value={form.maxNotionalUsdt} onChange={(event) => setForm((current) => ({ ...current, maxNotionalUsdt: event.target.value }))} /></MobileRiskField><label className="mNativeToggle mRiskAck"><span><b>{t("我已了解真实资金交易风险", "I understand the risks of live trading")}</b><small>{t("首次进入真实交易模式时确认", "Confirm before entering a live-trading mode")}</small></span><input type="checkbox" checked={form.acknowledged} onChange={(event) => setForm((current) => ({ ...current, acknowledged: event.target.checked }))} /></label></div></section>}
    {form.mode!=="observe"&&<section className="mNativeSection"><header><div><b>{t("实盘准备", "Live readiness")}</b><small>{gates.filter(([, ok]) => ok).length}/{gates.length} {t("项通过", "passed")}</small></div></header><div className="mGateList">{gates.map(([label, ok]) => <div key={label}><span className={ok ? "ok" : "bad"}>{ok ? "✓" : "!"}</span><b>{label}</b><small>{ok ? t("已通过", "Ready") : t("待完成", "Needs attention")}</small></div>)}</div></section>}
    <div className="mRiskSaveBar"><button type="button" disabled={saving} onClick={save}>{saving ? t("保存中…", "Saving…") : t("保存运行模式", "Save operating mode")}</button></div>
  </div>;
}

export function MobileRiskGoalEditor({ data, action, ui, onDone }) {
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
  return <div className="mScreen mRiskDetail mConfigurationEditor kFormSurface"><section className="mNativeSection"><header><div><b>{t("盈利目标", "Profit goal")}</b><small>{t("目标不会参与开仓决策", "The goal never influences entry decisions")}</small></div></header><div className="mRiskFieldStack"><MobileRiskField label={t("每日盈利目标", "Daily profit goal")} hint={t(`月度目标按当月 ${sys.monthlyGoalDays || 30} 天自动派生`, `Monthly goal is derived using ${sys.monthlyGoalDays || 30} days`)} suffix="USDT"><input type="number" min="0.01" step="0.01" inputMode="decimal" value={dailyGoal} onChange={(event) => setDailyGoal(event.target.value)} /></MobileRiskField></div><label className="mNativeToggle mGoalNative"><span><b>{t("达到目标后保护到开仓价", "Protect at entry after reaching the goal")}</b><small>{t("只收紧 AI 仓位的止损；不会放宽止损，也不改变止盈", "Only tightens stops on AI positions; never loosens stops or changes take-profit")}</small></span><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /></label></section><div className="mRiskNote"><ShieldCheck size={17}/><p>{t("这是持仓后的降风险动作，不会为了完成目标而追单。", "This is a post-entry risk reduction; the AI will never chase trades to hit the goal.")}</p></div><div className="mRiskSaveBar"><button type="button" disabled={saving} onClick={save}>{saving ? t("保存中…", "Saving…") : t("保存盈利保护", "Save profit protection")}</button></div></div>;
}

const MOBILE_PROTECTION_FIELDS = [
  ["minRewardRisk", "最低盈亏比", "Minimum reward-to-risk", "R", 1, 5, .1],
  ["protectMaxConsecLosses", "连续亏损达到", "Pause after consecutive losses", "笔", 1, 100, 1],
  ["protectCooldownHours", "连续亏损后暂停", "Loss-streak pause", "小时", .5, 48, .5],
  ["protectMaxDrawdownPct", "近期回撤达到", "Pause at recent drawdown", "%", 3, 50, .5],
  ["protectDrawdownLockHours", "回撤后暂停", "Drawdown pause", "小时", 1, 72, 1],
  ["eventBlackoutMinutes", "重大事件前暂停", "Pre-event blackout", "分钟", 0, 240, 5],
  ["entryOrderTtlMinutes", "未成交委托有效期", "Unfilled-order lifetime", "分钟", 5, 1440, 5],
  ["entryStaleDeviationPct", "未成交最大偏离", "Maximum unfilled deviation", "%", 1, 30, .5],
  ["trailActivatePct", "盈利达到后开始跟踪止损", "Start trailing stop at profit", "%", .3, 10, .1],
  ["trailDistancePct", "跟踪止损距离", "Trailing distance", "%", .3, 5, .1]
];

export function MobileProtectionEditor({ data, action, ui, onDone }) {
  const [form,setForm]=useState(()=>({...data.riskThresholds})); const [saving,setSaving]=useState(false);
  useEffect(()=>setForm({...data.riskThresholds}),[JSON.stringify(data.riskThresholds||{})]);
  const save=async()=>{const body={};for(const [key,label,labelEn,,min,max] of MOBILE_PROTECTION_FIELDS){const value=Number(form[key]);if(!Number.isFinite(value)||value<min||value>max)return ui.notify?.(t(`${label} 必须在 ${min}–${max} 之间`,`${labelEn} must be between ${min} and ${max}`));body[key]=value;}setSaving(true);try{if(await submitMobileRiskChange(action,"/api/risk/thresholds",body))onDone();}finally{setSaving(false);}};
  return <div className="mScreen mRiskDetail mConfigurationEditor kFormSurface"><section className="mNativeSection"><header><div><b>{t("自动保护阈值","Automatic protection thresholds")}</b><small>{t("触发后暂停新增仓位或撤销陈旧委托","Pause new entries or cancel stale orders when triggered")}</small></div></header><div className="mRiskFieldStack">{MOBILE_PROTECTION_FIELDS.map(([key,label,labelEn,unit,min,max,step])=><MobileRiskField key={key} label={t(label,labelEn)} suffix={t(unit,unit==="笔"?"losses":unit==="小时"?"hours":unit==="分钟"?"min":unit)}><input type="number" min={min} max={max} step={step} inputMode="decimal" value={form[key]??""} onChange={(event)=>setForm(current=>({...current,[key]:event.target.value}))}/></MobileRiskField>)}</div></section><div className="mRiskSaveBar"><button type="button" disabled={saving} onClick={save}>{saving?t("保存中…","Saving…"):t("保存自动保护","Save protections")}</button></div></div>;
}

export function MobileTradingConfiguration({ data, action, ui }) {
  const [detail,setDetail]=useState(""); const control=buildControlConfigurationView(data); const runtime=automationPresentation(data);
  const done=()=>setDetail("");
  if(detail){const titles={permissions:t("交易权限","Trading permissions"),live:t("运行模式","Operating mode"),protections:t("自动保护","Automatic protections"),goal:t("盈利目标保护","Profit goal protection")};return <div className="mRiskDetailPage"><div className="mRiskDetailNav"><button type="button" onClick={done}><ChevronLeft size={18}/>{t("交易与运行","Trading & runtime")}</button><b>{titles[detail]}</b><span/></div>{detail==="permissions"?<MobileRiskPermissionEditor data={data} action={action} ui={ui} onDone={done}/>:detail==="live"?<MobileRiskLiveEditor data={data} action={action} ui={ui} onDone={done}/>:detail==="protections"?<MobileProtectionEditor data={data} action={action} ui={ui} onDone={done}/>:<MobileRiskGoalEditor data={data} action={action} ui={ui} onDone={done}/>}</div>;}
  const rows=[
    ["live",Zap,t("运行模式","Operating mode"),`${runtime.targetLabel} · ${data.config?.liveTrading?.maxNotionalUsdt||50} USDT`,runtime.targetMode==="observe"?t("只分析","Analyze"):t("实盘","Live")],
    ["permissions",Shield,t("交易权限","Trading permissions"),control.mandate.allowedSymbols.join(" · ")||t("尚未授权市场","No markets authorized"),control.mandate.id?`v${control.mandate.version}`:t("未配置","Off")],
    ["protections",Gauge,t("自动保护","Automatic protections"),t("回撤、连亏、事件与委托时效","Drawdown, losses, events, and order lifetime"),`${MOBILE_PROTECTION_FIELDS.filter(([key])=>data.riskThresholds?.[key]!=null).length}/${MOBILE_PROTECTION_FIELDS.length}`],
    ["goal",Target,t("盈利目标保护","Profit goal protection"),data.system?.dailyGoalUsdt?`${data.system.dailyGoalUsdt} USDT / ${t("日","day")}`:t("未设置每日目标","No daily goal"),data.system?.dailyGoalBreakevenEnabled?t("已开启","On"):t("未开启","Off")]
  ];
  return <div className="mScreen mConfigDomain"><section className="mConfigDomainHero kTruthBand"><h2>{t("交易、运行与保护","Trading, runtime & protection")}</h2><p>{t("这是运行目标、Mandate 与自动保护的唯一移动端编辑入口。Control 只呈现当前实际状态。","This is the only mobile editor for operating targets, Mandate, and automatic protections. Control only presents effective state.")}</p><div><span><small>{t("当前实际","Effective now")}</small><b>{runtime.label}</b></span><span><small>{t("保存目标","Saved target")}</small><b>{runtime.targetLabel}</b></span></div></section><section className="mNativeSection mRiskSettingsList mConfigurationDomainIndex kRegistry"><header><div><small>TRADING GOVERNANCE</small><b>{t("编辑域", "Editor domains")}</b></div><span>{rows.length}</span></header>{rows.map(([id,Icon,title,note,state],index)=><button type="button" className="mRiskSettingRow" key={id} onClick={()=>setDetail(id)}><i>{String(index+1).padStart(2,"0")}</i><span className={`mRiskSettingIcon ${id}`}><Icon size={18}/></span><span><b>{title}</b><small>{note}</small></span><StatusBadge tone="neutral">{state}</StatusBadge><ChevronRight size={15}/></button>)}</section></div>;
}

export function MobileRiskRulesConfiguration({ data, action, ui }) {
  const rules=data.riskRules||[]; const [creating,setCreating]=useState(false); const [form,setForm]=useState({name:"",description:"",level:"L3",action:"reject_entry",conditionField:"plan.leverage",conditionOperator:"gt",conditionValue:"3"});
  const create=async(event)=>{event.preventDefault();if(!form.name.trim())return ui.notify?.(t("填写规则名称","Enter a rule name"));const {conditionField,conditionOperator,conditionValue,...rule}=form;await action("/api/risk/rules",{...rule,scope:"trade",conditionSpec:{field:conditionField,operator:conditionOperator,value:Number(conditionValue)}});setCreating(false);setForm(current=>({...current,name:"",description:""}));};
  const editableAction=(value)=>["notify","reject_entry","pause_opening"].includes(value)?value:["block","restrict","kill_switch"].includes(value)?"reject_entry":"notify";
  return <div className="mScreen mConfigDomain mConfigurationEditor kFormSurface"><section className="mConfigDomainHero kTruthBand"><h2>{t("确定性风险规则","Deterministic risk rules")}</h2><p>{t("规则新建、启停与动作修改只在这里完成；Control 保持只读。","Create, enable, disable, and change rules only here; Control remains read-only.")}</p><div><span><small>{t("规则总数","Total")}</small><b>{rules.length}</b></span><span><small>{t("当前生效","Active")}</small><b>{rules.filter(item=>item.enabled!==false).length}</b></span></div></section><section className="mNativeSection mConfigurationRuleRegistry kRegistry"><header><div><b>{t("规则登记","Rule registry")}</b><small>{t("系统内置规则不可停用或改写","System-managed rules cannot be disabled or rewritten")}</small></div><button type="button" onClick={()=>setCreating(value=>!value)}>{creating?t("取消","Cancel"):t("新建","New")}</button></header>{creating&&<form className="mNativeConfigForm" onSubmit={create}><label><span>{t("规则名称","Rule name")}</span><input value={form.name} onChange={(event)=>setForm(current=>({...current,name:event.target.value}))}/></label><label><span>{t("说明","Description")}</span><textarea value={form.description} onChange={(event)=>setForm(current=>({...current,description:event.target.value}))}/></label><div><label><span>{t("指标","Metric")}</span><select value={form.conditionField} onChange={(event)=>setForm(current=>({...current,conditionField:event.target.value}))}><option value="plan.leverage">{t("计划杠杆","Planned leverage")}</option><option value="plan.riskPercent">{t("单笔风险","Risk per trade")}</option><option value="market.fundingRate">{t("资金费率","Funding rate")}</option><option value="event.maxImpact">{t("事件影响","Event impact")}</option></select></label><label><span>{t("阈值","Threshold")}</span><input type="number" step="any" value={form.conditionValue} onChange={(event)=>setForm(current=>({...current,conditionValue:event.target.value}))}/></label></div><label><span>{t("触发动作","Action")}</span><select value={form.action} onChange={(event)=>setForm(current=>({...current,action:event.target.value}))}><option value="notify">{t("通知（不阻断）","Notify (non-blocking)")}</option><option value="reject_entry">{t("拒绝当前入场","Reject this entry")}</option><option value="pause_opening">{t("暂停当前计划开仓","Pause this plan's entry")}</option></select></label><button type="submit">{t("创建规则","Create rule")}</button></form>}<div className="mConfigRuleList">{rules.map(rule=><article key={rule.id}><span><b>{localizeText(rule.name)}</b><small>{humanize(rule.scope)} · {rule.level||"—"}</small><select aria-label={`${localizeText(rule.name)} ${t("触发动作","action")}`} disabled={rule.systemManaged} value={editableAction(rule.action)} onChange={(event)=>action(`/api/risk/rules/${rule.id}`,{action:event.target.value},"PATCH")}><option value="notify">{t("通知","Notify")}</option><option value="reject_entry">{t("拒绝入场","Reject entry")}</option><option value="pause_opening">{t("暂停计划开仓","Pause plan entry")}</option></select></span><button type="button" disabled={rule.systemManaged} className={rule.enabled===false?"":"on"} onClick={()=>action(`/api/risk/rules/${rule.id}`,{enabled:rule.enabled===false},"PATCH")}><i/>{rule.systemManaged?t("内置","Built-in"):rule.enabled===false?t("停用","Off"):t("生效","Active")}</button></article>)}</div></section></div>;
}

export function MobileEventSourcesConfiguration({ data, action, ui }) {
  const sources=data.eventSources||[]; const [form,setForm]=useState({name:"",type:"rss",url:"",trustScore:80});
  const submit=async(event)=>{event.preventDefault();if(!form.name.trim()||!form.url.trim())return ui.notify?.(t("填写事件源名称和 URL","Enter a source name and URL"));await action("/api/event-sources",{...form,trustScore:Number(form.trustScore||80)});setForm(current=>({...current,name:"",url:""}));};
  const remove=async(source)=>{if(await uiConfirm(t(`删除事件源「${source.name}」？之后不再抓取，已形成的历史事件仍会保留。`,`Delete event source “${source.name}”? Future fetching stops; existing historical events remain.`)))await action(`/api/event-sources/${source.id}`,{},"DELETE");};
  return <div className="mScreen mConfigDomain mConfigurationEditor kFormSurface">
    <section className="mConfigDomainHero kTruthBand"><h2>{t("事件输入源","Event input sources")}</h2><p>{t("管理宏观日历、公告和 RSS 抓取；事件日历只查看形成后的事实。","Manage macro calendars, announcements, and RSS fetching; the calendar only presents formed facts.")}</p><button type="button" onClick={()=>action("/api/event-sources/refresh",{})}><RefreshCw size={15}/>{t("刷新全部来源","Refresh all sources")}</button></section>
    <section className="mNativeSection mEventSourceRegistry kRegistry"><header><div><b>{t("已配置来源","Configured sources")}</b><small>{t("来源、健康、可信度与下一步", "Source, health, trust, and next step")}</small></div><span>{sources.length}</span></header><div className="mEventSourceNative">{sources.map(source=><article key={source.id}><span><b>{localizeText(source.name)}</b><small>{humanize(source.type||"rss")} · {t("可信度","Trust")} {source.trustScore??"—"} · {humanize(source.lastStatus,t("未抓取","Not fetched"))}</small></span><div><button onClick={()=>action(`/api/event-sources/${source.id}/test`,{})}>{t("测试","Test")}</button><button onClick={()=>action(`/api/event-sources/${source.id}`,{enabled:source.enabled===false},"PATCH")}>{source.enabled===false?t("启用","Enable"):t("停用","Disable")}</button><button className="danger" aria-label={t(`删除 ${source.name}`,`Delete ${source.name}`)} onClick={()=>remove(source)}><Trash2 size={14}/></button></div></article>)}</div></section>
    <section className="mNativeSection mConfigurationFormBoundary"><header><div><b>{t("新增事件源","New event source")}</b><small>RSS / HTML</small></div></header><form className="mNativeConfigForm" onSubmit={submit}><label><span>{t("名称","Name")}</span><input value={form.name} onChange={(event)=>setForm(current=>({...current,name:event.target.value}))}/></label><label><span>URL</span><input inputMode="url" value={form.url} onChange={(event)=>setForm(current=>({...current,url:event.target.value}))}/></label><div><label><span>{t("类型","Type")}</span><select value={form.type} onChange={(event)=>setForm(current=>({...current,type:event.target.value}))}><option value="rss">RSS</option><option value="html">HTML</option></select></label><label><span>{t("可信度","Trust")}</span><input type="number" min="1" max="100" value={form.trustScore} onChange={(event)=>setForm(current=>({...current,trustScore:event.target.value}))}/></label></div><button type="submit">{t("保存事件源","Save source")}</button></form></section>
  </div>;
}

function MobileRisk({ data, action, ui, view = "overview" }) {
  const control=buildControlConfigurationView(data); const runtime=automationPresentation(data); const sys=data.system||{}; const rules=data.riskRules||[];
  const budgetRemain=sys.remainingDailyLossUsdt; const budgetCap=sys.dailyLossCapUsdt; const budgetPct=budgetCap?Math.max(0,Math.min(100,(Number(budgetRemain)/Number(budgetCap))*100)):null;
  const showOverview=view==="overview"; const showBoundaries=view==="boundaries"; const showRules=view==="rules";
  return <div className="mScreen mControlScreen">
    {showOverview&&<><section className={`mControlTruth ${runtime.tone}`}><header><ShieldCheck size={21}/><div><small>{t("当前实际状态","Effective now")}</small><b>{runtime.label}</b></div><StatusBadge tone={runtime.tone==="ok"?"ok":runtime.tone==="danger"?"danger":runtime.tone==="warning"?"warning":"neutral"}>{runtime.entryPolicy}</StatusBadge></header><p>{runtime.detail}</p><div><span><small>{t("保存目标","Saved target")}</small><b>{runtime.targetLabel}</b></span><span><small>{t("恢复方式","Recovery")}</small><b>{runtime.recoveryLabel}</b></span></div></section><div className="mCard mBudgetCard"><div className="mBudgetTop"><span>{t("剩余亏损预算","Remaining loss budget")}</span><b className="mono">{budgetRemain!=null?`${displayMoney(budgetRemain,2)} USDT`:t("未授权","Not authorized")}</b></div><div className="mBudgetBar"><i style={{width:`${budgetPct??0}%`}}/></div></div>{control.runtime.blockers.length>0&&<section className="mNativeSection mControlRecovery"><header><div><b>{t("恢复路径","Recovery path")}</b><small>{t("按后端给出的真实阻断顺序","Authoritative blocker order")}</small></div><span>{control.runtime.blockers.length}</span></header>{control.runtime.blockers.map((item,index)=><button type="button" key={item.id} onClick={()=>ui.setActive(item.route)}><i>{index+1}</i><span><b>{localizeText(item.label)}</b><small>{localizeText(item.recovery||item.detail)||t("打开对应上下文","Open relevant context")}</small></span><ChevronRight size={15}/></button>)}</section>}<section className="mNativeSection"><header><div><b>{t("事件风险窗口","Event risk windows")}</b><small>{control.events.blocking} {t("个正在阻断","blocking")}</small></div><button type="button" onClick={()=>ui.setActive("eventsTasks:events")}>{t("日历","Calendar")}</button></header><div className="mControlEvents">{control.events.windows.slice(0,4).map(item=><div key={item.id}><span className={item.blocking?"bad":"warn"}/><span><b>{localizeText(item.title)}</b><small>{formatDateTime(item.dueAt)} · {item.marketWide?t("全市场","Market-wide"):(item.relatedSymbols||[]).join(" · ")}</small></span><StatusBadge tone={item.blocking?"danger":"warning"}>{item.blocking?t("阻断","Blocking"):t("监控","Monitor")}</StatusBadge></div>)}{!control.events.windows.length&&<div className="mEmpty">{t("当前没有生效中的高影响事件窗口。","No active high-impact event windows.")}</div>}</div></section><section className="mNativeSection"><header><div><b>{t("风险事件","Risk incidents")}</b><small>{control.incidents.open} {t("项未处理","unresolved")}</small></div></header>{control.incidents.items.slice(0,5).map(item=><div className="mIncRow" key={item.id}><div className="mIncL"><b>{localizeText(item.title||item.source)}</b></div><button className="mIncBtn" onClick={()=>action(`/api/risk/incidents/${item.id}/close`,{})}>{t("标记已处理","Resolve")}</button></div>)}{!control.incidents.open&&<div className="mEmpty">{t("当前没有未处理的风险事件。","No unresolved risk incidents.")}</div>}</section></>}
    {showBoundaries&&<><section className="mControlBoundaryHero"><div><small>{t("保存目标","Saved target")}</small><h2>{runtime.targetLabel}</h2><p>{runtime.targetIsEffective?t("当前正在按该目标运行。","The target is effective now."):runtime.recoveryLabel}</p></div><button type="button" onClick={()=>ui.setActive("systemSettings:trading")}>{t("修改配置","Edit configuration")}<ChevronRight size={15}/></button></section><section className="mNativeSection"><header><div><b>{t("生效交易范围","Effective trading scope")}</b><small>{control.mandate.id?`v${control.mandate.version}`:t("未授权","Not authorized")}</small></div></header><div className="mControlSymbols">{control.mandate.allowedSymbols.map(symbol=><span key={symbol}>{symbol}</span>)}{!control.mandate.allowedSymbols.length&&<em>{t("尚未授权市场","No markets authorized")}</em>}</div><div className="mRiskBoundaryGrid"><span><small>{t("有效单笔上限","Effective order max")}</small><b className="mono">{control.mandate.effectiveOrderLimitUsdt??"—"} U</b></span><span><small>{t("最高杠杆","Max leverage")}</small><b className="mono">{control.mandate.maxLeverage??"—"}x</b></span><span><small>{t("单笔风险","Per-trade risk")}</small><b className="mono">{control.mandate.perTradeRiskPct??"—"}%</b></span><span><small>{t("日亏损","Daily loss")}</small><b className="mono neg">{control.mandate.dailyLossPct??"—"}%</b></span></div></section><section className="mNativeSection mControlChecks"><header><div><b>{t("实盘就绪链","Live readiness chain")}</b><small>{control.checksPassed}/{control.checks.length} {t("项通过","passed")}</small></div></header>{control.checks.map(item=><button type="button" key={item.id} onClick={()=>ui.setActive(item.route)}><span className={item.ok?"ok":"bad"}>{item.ok?"✓":"!"}</span><b>{t(item.label,item.labelEn)}</b><small>{item.ok?t("已核验","Verified"):t("待处理","Pending")}</small><ChevronRight size={14}/></button>)}</section></>}
    {showRules&&<><section className="mControlBoundaryHero"><div><small>{t("当前规则","Effective rules")}</small><h2>{control.rules.enabled}/{control.rules.total}</h2><p>{t("Control 只呈现生效状态与命中事实；规则修改统一进入配置中心。","Control presents enablement and hit facts; rule changes belong in Configuration.")}</p></div><button type="button" onClick={()=>ui.setActive("systemSettings:risk")}>{t("配置规则","Configure rules")}<ChevronRight size={15}/></button></section><section className="mNativeSection"><header><div><b>{t("规则监控","Rule monitor")}</b><small>{rules.length}</small></div></header><div className="mControlRuleList">{rules.map(rule=><article key={rule.id}><span><b>{localizeText(rule.name)}</b><small>{humanize(rule.scope)} · {rule.level||"—"} · {humanize(rule.action)}</small></span><StatusBadge tone={rule.enabled===false?"neutral":"ok"}>{rule.enabled===false?t("停用","Off"):t("生效","Active")}</StatusBadge></article>)}</div></section><section className="mNativeSection"><header><div><b>{t("最近命中","Recent hits")}</b><small>{control.rules.recentHits.length}</small></div></header>{control.rules.recentHits.map((hit,index)=><div className="mNativeRow" key={hit.id||index}><span className={`mStateDot ${statusTone(hit.decision)}`}/><span><b>{hit.symbol||t("账户级规则","Account-level rule")}</b><small>{humanize(hit.decision)} · {formatDateTime(hit.createdAt)}</small></span></div>)}{!control.rules.recentHits.length&&<div className="mEmpty">{t("暂无命中记录。","No hit records.")}</div>}</section></>}
  </div>;
}

export function MobileResearchMap({ data, ui }) {
  const map = buildResearchMap(data);
  const ownerVisible = data.user?.isOwner === true;
  const capOther = map.capabilities.origins.imported + map.capabilities.origins.mcp + map.capabilities.origins.registered;
  return <div className="mScreen mResearchMap">
    <section className="mResearchMapHero"><small>LAB / RESEARCH OPERATING MAP</small><h2>{t("不是三个平行库，而是一套资产闭环", "Not three parallel libraries, but one asset loop")}</h2><p>{t("原生资产与知识蒸馏从不同入口汇入同一正式注册表；真实交易结果再回到复盘与 Owner 版本决策。", "Native assets and knowledge distillation enter the same formal registries through different paths; live results return to review and Owner version decisions.")}</p><div><span><small>{t("可检索", "Searchable")}</small><b>{map.sources.searchable}/{map.sources.total}</b></span><span><small>{t("策略", "Strategies")}</small><b>{map.strategies.total}</b></span><span><small>{t("能力", "Capabilities")}</small><b>{map.capabilities.total}</b></span></div></section>

    <section className="mResearchMapSection"><header><span>01</span><div><small>DUAL ORIGINS</small><b>{t("两种来源", "Two origins")}</b></div></header><div className="mResearchOriginList">
      <button type="button" className="native" onClick={() => ui.setActive("strategyLib")}><i/><span><small>{t("系统原生 / 已注册", "SYSTEM-NATIVE / REGISTERED")}</small><b>{t("已有策略与能力", "Existing strategies & capabilities")}</b><p>{t("直接进入正式注册表，保留版本、证据与运行状态。", "Enter formal registries directly with version, evidence, and runtime state.")}</p></span><strong>{map.strategies.origins.system + map.capabilities.origins.system}</strong><ChevronRight/></button>
      <button type="button" className="knowledge" onClick={() => ui.setActive("knowledgeBase")}><i/><span><small>{t("知识导入与蒸馏", "KNOWLEDGE IMPORT & DISTILLATION")}</small><b>{t("来源、证据与待验证候选", "Sources, evidence & candidates")}</b><p>{t("先检索、审批和验证，毕业版本再汇入同一注册表。", "Retrieve, approve, and validate first; graduates then enter the same registries.")}</p></span><strong>{map.incubation.strategyCandidates + map.incubation.incubatingStrategies + map.incubation.capabilityCandidates}</strong><ChevronRight/></button>
    </div></section>

    <section className="mResearchMapSection"><header><span>02</span><div><small>FORMAL ASSET REGISTRIES</small><b>{t("正式资产", "Formal assets")}</b></div></header><div className="mResearchRegistryList">
      <button type="button" onClick={() => ui.setActive("strategyLib")}><span className="icon"><Rocket/></span><div><small>S / STRATEGY</small><b>{t("策略注册表", "Strategy Registry")}</b><p>{map.strategies.origins.system} {t("原生", "system")} · {map.strategies.origins.knowledge} {t("知识蒸馏", "knowledge")} · {map.strategies.origins.imported} {t("导入", "imported")}</p></div><strong>{map.strategies.total}</strong><ChevronRight/></button>
      <button type="button" onClick={() => ui.setActive("capabilityLib")}><span className="icon"><Wrench/></span><div><small>C / CAPABILITY</small><b>{t("能力注册表", "Capability Registry")}</b><p>{map.capabilities.origins.system} {t("原生", "system")} · {map.capabilities.origins.knowledge} {t("知识工作流", "knowledge")} · {capOther} {t("导入/MCP", "imported/MCP")}</p></div><strong>{map.capabilities.total}</strong><ChevronRight/></button>
    </div></section>

    <section className="mResearchMapSection"><header><span>03</span><div><small>LIVE LEARNING LOOP</small><b>{t("真实结果回流", "Live evidence returns")}</b></div></header><div className="mResearchLearningTrack">
      <button type="button" onClick={() => ui.setActive("labReviews")}><small>01</small><b>{t("交易复盘", "Trade review")}</b><span>{map.learning.completedReviews}</span></button><i/><button type="button" onClick={() => ui.setActive(ownerVisible ? "ownerReviewWorkspace" : "labReviews")}><small>02</small><b>{t("候选改进", "Candidate changes")}</b><span>{map.learning.candidateLessons}</span></button><i/><button type="button" disabled={!ownerVisible} onClick={() => ownerVisible && ui.setActive("ownerReviewWorkspace")}><small>03</small><b>{t("Owner 发布", "Owner release")}</b><span>{ownerVisible ? map.learning.pendingOwner + map.learning.validating : "—"}</span></button>
    </div><p className="mResearchVersionNote"><GitBranch/>{t("发布创建新版本，不会静默覆盖正式资产。", "Release creates a new version; it never silently overwrites formal assets.")}</p></section>

    <section className="mResearchMapQueue"><header><div><small>NEXT DECISIONS</small><b>{t("当前需要推进", "Needs attention")}</b></div><span>{map.actionQueue.length}</span></header>{map.actionQueue.length ? map.actionQueue.slice(0, 6).map((item) => <button type="button" key={item.id} className={item.tone} onClick={() => ui.setActive(item.destination)}><i/><span><b>{t(item.label, item.labelEn)}</b><small>{t(item.detail, item.detailEn)}</small></span><strong>{item.count}</strong><ChevronRight/></button>) : <div className="mResearchMapClear"><CheckCircle2/><span><b>{t("当前没有待处理决策", "No decisions are waiting")}</b><small>{t("正式资产仍持续接收运行证据。", "Formal assets continue receiving runtime evidence.")}</small></span></div>}</section>
  </div>;
}

export function MobileOwnerReview({ data, action, ui, initialSelection = null }) {
  const asList = (value) => Array.isArray(value) ? value : [];
  const loop = data.ownerReviewLoop || {};
  const summary = loop.summary || {};
  const improvements = asList(loop.improvements);
  const lessons = asList(loop.lessons).filter((item) => ["candidate", "candidate_legacy", "observing"].includes(item.status));
  const [tab, setTab] = useState(improvements.length ? "improvements" : "lessons");
  const [selected, setSelected] = useState(initialSelection);
  const [busy, setBusy] = useState("");
  const [forms, setForms] = useState({});
  const form = (item) => forms[item.id] || {};
  const updateForm = (item, patch) => setForms((current) => ({ ...current, [item.id]: { ...(current[item.id] || {}), ...patch } }));
  const stateLabel = (value) => ({ evidence_accumulating:t("积累证据","Collecting evidence"),pending_owner:t("等待 Owner","Awaiting Owner"),accepted:t("已接受","Accepted"),rejected:t("已拒绝","Rejected"),validating:t("验证中","Validating"),verified:t("验证有效","Verified"),ineffective:t("验证无效","Ineffective"),candidate:t("候选教训","Candidate lesson"),candidate_legacy:t("旧版待审核","Legacy unreviewed"),observing:t("继续观察","Observing") }[value] || humanize(value, "—"));
  const stateTone = (value) => /verified|active/.test(String(value)) ? "ok" : /rejected|ineffective/.test(String(value)) ? "danger" : /pending|validating|candidate|observing/.test(String(value)) ? "warning" : "neutral";
  const destinationLabel = (value) => ({ strategy:t("策略资产","Strategy asset"),agent:t("AI 交易员","AI Trader"),risk:t("风控配置","Risk configuration"),system:t("系统 / 代码","System / code"),observation:t("仅观察","Observation") }[value] || humanize(value, "—"));
  const runAction = async (kind, item, command, extra = {}) => {
    if (["reject", "verify", "ineffective", "approve"].includes(command) && !await uiConfirm(t(`确认执行“${command === "approve" ? "用于相似行情" : command === "verify" ? "确认有效" : command === "ineffective" ? "确认无效" : "拒绝"}”？`, `Confirm “${command}”?`))) return;
    const payload = { action: command, ...extra };
    if (command === "verify") {
      payload.ownerAttested = true;
      if (item.destination !== "strategy") {
        const note = String(form(item).verificationNote || "").trim();
        if (!note) { ui.notify?.(t("请先填写可核验的测试、版本或观察证据", "Add verifiable test, release, or observation evidence first")); return; }
        payload.validationEvidence = [{ type: "owner_note", value: note }];
      }
    }
    const key = `${kind}:${item.id}:${command}`;
    setBusy(key);
    try {
      await action(kind === "lesson" ? `/api/review/lessons/${item.id}/action` : `/api/review/improvements/${item.id}/action`, payload);
      if (["reject", "verify", "ineffective", "approve"].includes(command)) setSelected(null);
    } finally { setBusy(""); }
  };
  const startPaper = async (item) => {
    const candidateId = item.validation?.candidateStrategyRef?.versionId;
    const candidate = asList(item.validation?.availableEvidence?.candidateVersions).find((row) => row.id === candidateId);
    const symbols = asList(candidate?.symbols);
    const symbol = String(form(item).paperSymbol || symbols[0] || "").trim();
    if (!symbol) { ui.notify?.(t("候选版本没有允许的交易对", "The candidate has no allowed symbol")); return; }
    setBusy(`paper:${item.id}`);
    try {
      const result = await action(`/api/review/improvements/${item.id}/paper/start`, { symbol });
      if (result?.session?.id) updateForm(item, { paperSessionId: result.session.status === "passed" ? result.session.id : form(item).paperSessionId || "" });
    } finally { setBusy(""); }
  };
  const recordStage = async (item, stage, outcome) => {
    const values = form(item);
    const payload = { stageName: stage.name, outcome, note: String(values.failureNote || "").trim() };
    if (outcome === "failed" && !payload.note) { ui.notify?.(t("请先填写未通过原因", "Enter the failure reason first")); return; }
    const available = item.validation?.availableEvidence || {};
    if (outcome === "passed" && stage.name === "backtest") {
      const candidate = asList(available.candidateVersions).find((row) => row.id === values.candidateVersionId);
      if (!candidate) { ui.notify?.(t("请选择系统列出的候选版本", "Select an authoritative candidate version")); return; }
      Object.assign(payload, { candidateVersionId: candidate.id, candidateDefinitionHash: candidate.definitionHash, evidenceId: candidate.backtestId });
    }
    if (outcome === "passed" && stage.name === "paper") {
      if (!values.paperSessionId) { ui.notify?.(t("请选择已通过的真实模拟盘会话", "Select a passed authoritative paper session")); return; }
      payload.evidenceId = values.paperSessionId;
    }
    if (outcome === "passed" && stage.name === "small_live") {
      payload.evidenceReviewIds = asList(values.liveReviewIds);
      if (!payload.evidenceReviewIds.length) { ui.notify?.(t("请选择已完整费用对账的小额实盘复盘", "Select reconciled small-live reviews")); return; }
    }
    await runAction("improvement", item, "record_stage", payload);
  };
  if (data.user?.isOwner !== true) return <div className="mScreen"><div className="mNativeEmpty"><ShieldCheck/><b>{t("仅 Owner 可以访问", "Owner access required")}</b><span>{t("该页面包含策略与教训审批动作。", "This page contains strategy and lesson approval actions.")}</span></div></div>;
  const selectedImprovement = selected?.kind === "improvement" ? improvements.find((item) => item.id === selected.id) || selected.item : null;
  const selectedLesson = selected?.kind === "lesson" ? lessons.find((item) => item.id === selected.id) || selected.item : null;
  const nextStage = selectedImprovement?.validation?.stages?.find((stage) => !/passed|completed|verified/i.test(String(stage.status)));
  const available = selectedImprovement?.validation?.availableEvidence || {};
  const candidateId = selectedImprovement?.validation?.candidateStrategyRef?.versionId;
  const candidate = asList(available.candidateVersions).find((row) => row.id === candidateId);
  const paperSymbols = asList(candidate?.symbols);
  const passedPaper = asList(available.paperSessions).filter((row) => row.status === "passed");
  return <div className="mScreen mOwnerReview">
    <section className="mOwnerHero"><small>OWNER / GOVERNED LEARNING</small><h2>{t("优化建议不会自行生效", "Improvements never activate themselves")}</h2><p>{t("复盘只生成候选。Owner 必须查看权威证据、分阶段验证，并明确发布新版本或拒绝。", "Reviews create candidates only. The Owner must inspect authoritative evidence, validate in stages, and explicitly release a new version or reject it.")}</p><div><span><small>{t("结构化复盘", "Reviews")}</small><b>{summary.structuredReviews || 0}</b></span><span><small>{t("候选教训", "Lessons")}</small><b>{summary.candidateLessons || lessons.length}</b></span><span><small>{t("待决策", "Pending")}</small><b>{summary.pendingOwner || 0}</b></span><span><small>{t("验证中", "Validating")}</small><b>{summary.validating || 0}</b></span></div></section>
    <nav className="mOwnerTabs" role="tablist"><button type="button" role="tab" aria-selected={tab === "improvements"} className={tab === "improvements" ? "active" : ""} onClick={() => setTab("improvements")}><Target/><span><b>{t("优化项", "Improvements")}</b><small>{improvements.length}</small></span></button><button type="button" role="tab" aria-selected={tab === "lessons"} className={tab === "lessons" ? "active" : ""} onClick={() => setTab("lessons")}><Sparkles/><span><b>{t("候选教训", "Candidate lessons")}</b><small>{lessons.length}</small></span></button></nav>
    {tab === "improvements" ? <section className="mOwnerList">{improvements.map((item) => <button type="button" key={item.id} onClick={() => setSelected({ kind: "improvement", id: item.id, item })}><header><StatusBadge tone={stateTone(item.state)}>{stateLabel(item.state)}</StatusBadge><small>{destinationLabel(item.destination)} · {item.evidenceCount || 0} {t("份证据", "evidence")}</small></header><b>{item.title || t("未命名优化项", "Untitled improvement")}</b><p>{item.problem || item.proposal}</p><div>{asList(item.validation?.stages).map((stage) => <i key={stage.name} className={/passed|completed|verified/i.test(String(stage.status)) ? "done" : ""}/>)}</div><ChevronRight/></button>)}{!improvements.length && <div className="mNativeEmpty"><CheckCircle2/><b>{t("暂无需要处理的优化项", "No improvement proposals need attention")}</b><span>{t("系统会先积累可核验复盘证据。", "The system first accumulates verifiable review evidence.")}</span></div>}</section> : <section className="mOwnerList">{lessons.map((item) => <button type="button" key={item.id} onClick={() => setSelected({ kind: "lesson", id: item.id, item })}><header><StatusBadge tone={stateTone(item.status)}>{stateLabel(item.status)}</StatusBadge><small>{item.origin === "llm_deep_review" ? t("LLM 深度复盘", "LLM deep review") : t("结构化复盘", "Structured review")}</small></header><b>{item.title || t("未命名复盘教训", "Untitled review lesson")}</b><p>{item.llmAdvice || item.systemSuggestion || item.lessonText || item.content}</p><ChevronRight/></button>)}{!lessons.length && <div className="mNativeEmpty"><BookOpen/><b>{t("暂无候选教训", "No candidate lessons")}</b><span>{t("新复盘会先进入这里，不会直接影响下一笔交易。", "New reviews arrive here first and never affect the next trade directly.")}</span></div>}</section>}
    {(selectedImprovement || selectedLesson) && <div className="mOwnerSheetOverlay" onClick={() => setSelected(null)}><aside className="mOwnerSheet" onClick={(event) => event.stopPropagation()}><button type="button" className="mSheetGrip" onClick={() => setSelected(null)} aria-label={t("关闭", "Close")}><i/></button>{selectedImprovement ? <>
      <header><div><small>{destinationLabel(selectedImprovement.destination)}</small><b>{selectedImprovement.title}</b></div><StatusBadge tone={stateTone(selectedImprovement.state)}>{stateLabel(selectedImprovement.state)}</StatusBadge></header><section><small>{t("问题", "PROBLEM")}</small><p>{selectedImprovement.problem}</p></section><section><small>{t("建议", "PROPOSAL")}</small><p>{selectedImprovement.proposal}</p></section>{asList(selectedImprovement.successCriteria).length > 0 && <section><small>{t("成功标准", "SUCCESS CRITERIA")}</small><ul>{asList(selectedImprovement.successCriteria).map((item, index) => <li key={index}>{item}</li>)}</ul></section>}{selectedImprovement.validation && <section><small>{t("验证阶段", "VALIDATION STAGES")}</small><div className="mOwnerStages">{asList(selectedImprovement.validation.stages).map((stage) => <span key={stage.name}><i className={/passed|completed|verified/i.test(String(stage.status)) ? "done" : ""}/><b>{stage.label || humanize(stage.name)}</b><small>{humanize(stage.status)}</small></span>)}</div></section>}
      {selectedImprovement.state === "validating" && selectedImprovement.destination !== "strategy" && <label className="mOwnerField">{t("可核验证据", "Verifiable evidence")}<textarea value={form(selectedImprovement).verificationNote || ""} onChange={(event) => updateForm(selectedImprovement, { verificationNote: event.target.value })} placeholder={t("测试名称、版本号、结果与可复核位置", "Test, release, result, and where it can be verified")}/></label>}
      {selectedImprovement.state === "validating" && selectedImprovement.destination === "strategy" && nextStage && <section className="mOwnerEvidence"><small>{t(`下一阶段：${nextStage.label || nextStage.name}`, `NEXT: ${nextStage.label || nextStage.name}`)}</small>{nextStage.name === "backtest" && <label className="mOwnerField">{t("候选策略版本", "Candidate strategy version")}<select value={form(selectedImprovement).candidateVersionId || ""} onChange={(event) => updateForm(selectedImprovement, { candidateVersionId: event.target.value })}><option value="">{t("选择权威版本", "Select authoritative version")}</option>{asList(available.candidateVersions).map((row) => <option key={row.id} value={row.id}>{row.label} · {row.id}</option>)}</select></label>}{nextStage.name === "paper" && <><label className="mOwnerField">{t("允许交易对", "Allowed symbol")}<select value={form(selectedImprovement).paperSymbol || paperSymbols[0] || ""} onChange={(event) => updateForm(selectedImprovement, { paperSymbol: event.target.value })}>{paperSymbols.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}</select></label><button type="button" className="mOwnerEvidenceAction" disabled={!paperSymbols.length || Boolean(busy)} onClick={() => startPaper(selectedImprovement)}><Play/>{t("启动绑定候选版本的纯前向模拟", "Start candidate-bound pure-forward session")}</button><label className="mOwnerField">{t("已通过会话", "Passed session")}<select value={form(selectedImprovement).paperSessionId || ""} onChange={(event) => updateForm(selectedImprovement, { paperSessionId: event.target.value })}><option value="">{passedPaper.length ? t("请选择", "Select") : t("尚无已通过会话", "No passed session")}</option>{passedPaper.map((row) => <option key={row.id} value={row.id}>{row.label} · {row.symbol}</option>)}</select></label></>}{nextStage.name === "small_live" && <div className="mOwnerChecks">{asList(available.liveReviews).map((row) => { const checked = asList(form(selectedImprovement).liveReviewIds).includes(row.id); return <label key={row.id}><input type="checkbox" checked={checked} onChange={() => updateForm(selectedImprovement, { liveReviewIds: checked ? asList(form(selectedImprovement).liveReviewIds).filter((id) => id !== row.id) : [...asList(form(selectedImprovement).liveReviewIds), row.id] })}/><span><b>{row.symbol || "—"}</b><small>{row.netRealizedPnl == null ? "—" : `${row.netRealizedPnl} U`} · {formatDateTime(row.completedAt)}</small></span></label>; })}</div>}<label className="mOwnerField">{t("未通过原因", "Failure reason")}<textarea value={form(selectedImprovement).failureNote || ""} onChange={(event) => updateForm(selectedImprovement, { failureNote: event.target.value })}/></label><div className="mOwnerEvidenceButtons"><button type="button" disabled={Boolean(busy)} onClick={() => recordStage(selectedImprovement, nextStage, "passed")}>{t("核验并记录通过", "Verify & pass")}</button><button type="button" disabled={Boolean(busy)} onClick={() => recordStage(selectedImprovement, nextStage, "failed")}>{t("记录未通过", "Record failure")}</button></div></section>}
      <footer className="mOwnerActions kActionBar">{selectedImprovement.state === "pending_owner" && <><button type="button" className="primary" disabled={Boolean(busy)} onClick={() => runAction("improvement", selectedImprovement, "accept")}>{t("接受并创建验证草案", "Accept & create validation draft")}</button><button type="button" disabled={Boolean(busy)} onClick={() => runAction("improvement", selectedImprovement, "more_evidence")}>{t("继续积累证据", "Collect more evidence")}</button><button type="button" disabled={Boolean(busy)} onClick={() => runAction("improvement", selectedImprovement, "reject")}>{t("拒绝", "Reject")}</button></>}{selectedImprovement.state === "accepted" && <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => runAction("improvement", selectedImprovement, "start_validation")}>{t("开始分阶段验证", "Start staged validation")}</button>}{selectedImprovement.state === "validating" && <><button type="button" className="primary" disabled={Boolean(busy) || (selectedImprovement.destination === "strategy" && !selectedImprovement.validation?.readyForOwnerVerification)} onClick={() => runAction("improvement", selectedImprovement, "verify")}>{t("确认有效并发布新版本", "Mark effective & release new version")}</button><button type="button" disabled={Boolean(busy)} onClick={() => runAction("improvement", selectedImprovement, "ineffective")}>{t("确认无效", "Mark ineffective")}</button></>}{selectedImprovement.state === "ineffective" && selectedImprovement.destination === "strategy" && <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => runAction("improvement", selectedImprovement, "retry_validation")}>{t("创建下一代候选", "Create next candidate")}</button>}</footer>
    </> : <><header><div><small>{selectedLesson.origin === "llm_deep_review" ? t("LLM 深度复盘", "LLM DEEP REVIEW") : t("候选教训", "CANDIDATE LESSON")}</small><b>{selectedLesson.title}</b></div><StatusBadge tone={stateTone(selectedLesson.status)}>{stateLabel(selectedLesson.status)}</StatusBadge></header><section><small>{t("发生了什么", "WHAT HAPPENED")}</small><p>{selectedLesson.factSummary || selectedLesson.lessonText || selectedLesson.content}</p></section><section><small>{t("复盘建议", "REVIEW ADVICE")}</small><p>{selectedLesson.llmAdvice || selectedLesson.systemSuggestion || t("暂无独立建议", "No independent advice")}</p></section><section><small>{t("仅适用于", "APPLICABILITY")}</small><p>{[selectedLesson.applicability?.symbol, selectedLesson.applicability?.direction, selectedLesson.applicability?.timeframe, selectedLesson.applicability?.setupType, selectedLesson.applicability?.strategyProductId, selectedLesson.applicability?.regime].filter(Boolean).join(" · ") || t("适用范围不完整", "Applicability is incomplete")}</p></section><footer className="mOwnerActions kActionBar"><button type="button" className="primary" disabled={Boolean(busy)} onClick={() => runAction("lesson", selectedLesson, "approve")}>{t("仅用于相似行情", "Allow only in matching contexts")}</button>{selectedLesson.status !== "observing" && <button type="button" disabled={Boolean(busy)} onClick={() => runAction("lesson", selectedLesson, "observe")}>{t("继续观察", "Keep observing")}</button>}<button type="button" disabled={Boolean(busy)} onClick={() => runAction("lesson", selectedLesson, "reject")}>{t("拒绝", "Reject")}</button></footer></>}</aside></div>}
  </div>;
}

function MobileKnowledge({ data, action, ui, view = "all" }) {
  // App 与桌面使用同一发布口径：知识库只展示孵化中的四类产物，正式目录只消费服务端发布资格。
  const segs = view === "capabilities" ? ["工具工作流"] : ["参考知识", "交易纪律", "交易方法", "工具工作流"];
  const [segState, setSeg] = useState(view === "capabilities" ? "工具工作流" : "参考知识");
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
  const candidates = knowledge.candidates || [];
  const workflows = knowledge.workflows || [];
  const pendingTools = (data.skills || []).filter((item) => item.kind !== "strategy" && !isPublishedImportedSkill(item));
  const compiledIds = new Set(skills.filter((s) => !["retired", "superseded"].includes(s.status)).map((s) => s.sourceMethodId));
  const active = skills.filter(isPublishedKnowledgeStrategy).length;
  const sourceProgress = sources.filter((source) => !["doctrine", "manual_curated"].includes(source.type)).map((source) => {
    const sourceMethods = methods.filter((method) => (method.source?.id || method.sourceId) === source.id);
    const failed = /fail|error|失败|错误|empty|unsupported/i.test(String(source.status || ""));
    const processing = String(source.status || "").toLowerCase() === "processing";
    const structured = sourceMethods.length > 0 || rules.some((rule) => (rule.sourceId || rule.source?.id) === source.id);
    return {
      source,
      stage: failed ? 0 : processing ? 1 : structured ? 3 : 2,
      tone: failed ? "danger" : processing ? "neutral" : structured ? "ok" : "info",
      current: failed ? t("导入未完成", "Import incomplete") : processing ? t("正在读取并建立索引", "Reading and indexing") : structured ? t("可检索且已结构化", "Searchable and structured") : t("已可搜索和引用", "Searchable and citable"),
      effect: failed ? t("内容不可检索，也不会参与 AI 分析。", "The content cannot be retrieved or used in AI analysis.") : processing ? t("解析完成前不会进入 AI 证据包。", "It cannot enter an AI evidence bundle before parsing completes.") : t("AI 可在受控检索中引用；它不会直接下单。", "AI may cite it through controlled retrieval; it cannot place orders."),
      next: failed ? t("重新解析", "Parse again") : t("查看分流结果", "Review outputs"),
      action: failed ? "reparse" : null
    };
  });
  const earliestStage = sourceProgress.length ? Math.min(...sourceProgress.map((row) => row.stage)) : 0;
  // 四个小白能理解的里程碑概括八个真实阶段；每本书的卡片仍显示精确 1–8 阶段。
  const step = !sourceProgress.length || earliestStage <= 1 ? 1 : earliestStage < 3 ? 2 : 3;
  const guide = [
    { n: 1, Icon: BookOpen, title: t("导入并变成可检索资料", "Import and make it searchable"), desc: t("系统读取书籍、建立索引。完成后 Gemini 才能搜索、引用和回答书中内容。", "The system reads and indexes the source. Gemini can search, cite, and answer from it after parsing."), cta: t("导入知识源", "Import source"), on: () => ui.openPanel("knowledgeImport") },
    { n: 2, Icon: Search, title: t("成为 AI 可引用的参考知识", "Become AI-citable reference knowledge"), desc: t("检索命中后以证据形式交给 Gemini；这一步已经有用，不要求继续生成候选。", "Retrieved passages are supplied to Gemini as evidence. This is already useful and does not require generating candidates."), cta: t("管理知识源", "Manage sources"), on: () => ui.openPanel("knowledgeList") },
    { n: 3, Icon: Rocket, title: t("按用途进入三个孵化区", "Route into three incubation areas"), desc: t("纪律去审批，方法去验证，工具或工作流先校验；只有毕业产物才进入正式目录。", "Approve discipline, validate methods, and verify tools or workflows. Only graduates enter official catalogs."), cta: t("查看交易方法", "Review methods"), on: () => setSeg("交易方法") }
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
      <div className="mChips kFilterRail">
        {segs.map((name) => <button key={name} className={seg === name ? "active" : ""} onClick={() => setSeg(name)}>{name}{name === "交易方法" && methods.length ? ` ${methods.length}` : ""}{name === "交易纪律" && rules.length ? ` ${rules.length}` : ""}{name === "工具工作流" && candidates.length + pendingTools.length ? ` ${candidates.length + pendingTools.length}` : ""}</button>)}
      </div>

      {seg === "参考知识" && (
        <>
          <div className="mKGuide labKnowledgeLifecycle">
            <div className="mKGuideTitle"><Sparkles size={14} /> {t("知识不会导入后立刻交易：它要逐级毕业", "Imported knowledge does not trade immediately; it graduates in stages")}</div>
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

          <div className="mPageStats kTruthBand">
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
            <header><span>{t("每本书现在能做什么（", "What each source can do now (")}{sourceProgress.length}{t("）", ")")}</span><button className="textButton" onClick={() => ui.openPanel("knowledgeList")}>{t("管理", "Manage")} <ChevronRight size={12} /></button></header>
            {!sources.length && <p className="mInboxEmpty">{t("还没有导入知识。点下方「导入知识」开始。", "No knowledge imported yet. Tap \"Import knowledge\" below to start.")}</p>}
            {sourceProgress.slice(0, 8).map((row) => <article className={`mKSourceProgress ${row.tone}`} key={row.source.id || row.source.title}>
              <header><b>{row.source.title || row.source.name || t("未命名", "Untitled")}</b><StatusBadge tone={row.tone}>{row.stage === 0 ? t("需处理", "Needs attention") : t(`阶段 ${row.stage}/8`, `Stage ${row.stage}/8`)}</StatusBadge></header>
              <div className="mKStageTrack" aria-label={t(`当前知识阶段 ${row.stage}/3`, `Knowledge stage ${row.stage}/3`)}>{[1,2,3].map((stageNo) => <i className={stageNo <= row.stage ? "done" : ""} key={stageNo}/>)}</div>
              <p><small>{t("现在", "NOW")}</small><b>{row.current}</b><span>{row.effect}</span></p>
              <footer><span>{t("下一步：", "Next: ")}<b>{row.next}</b></span>{row.action && <button onClick={() => action(`/api/knowledge/sources/${row.source.id}/parse-real`, {})}>{row.next} <ChevronRight size={12}/></button>}</footer>
            </article>)}
          </div>
          <button className="mPrimaryAction" onClick={() => ui.openPanel("knowledgeImport")}><Plus size={15} /> {t("导入知识", "Import knowledge")}</button>
        </>
      )}

      {seg === "交易方法" && (
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

      {seg === "交易方法" && (
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

      {seg === "工具工作流" && (
        <div className="mSectionCard">
          <header><span>{t("工具与工作流孵化（", "Tool & workflow incubation (")}{candidates.length + pendingTools.length}{t("）", ")")}</span><small>{t("毕业前不会进入能力库", "Hidden from Capabilities until graduation")}</small></header>
          {!candidates.length && !pendingTools.length && <p className="mInboxEmpty">{t("没有待孵化的工具或工作流候选。生成扩展候选不是知识检索的必经步骤。", "No tool or workflow candidates. Generating extensions is optional for knowledge retrieval.")}</p>}
          {candidates.filter((item) => ["workflow", "lens"].includes(item.type) && !["ignored", "rejected"].includes(item.status)).slice(0, 20).map((item) => {
            const artifact = item.type === "workflow" ? workflows.find((row) => row.id === item.adoptedArtifactId) : null;
            const published = item.type === "workflow" && isApprovedKnowledgeWorkflow(artifact);
            return <div className="mRowItem" key={item.id}><span><b>{item.name || item.title}</b><small>{humanize(item.type)}</small></span>{published ? <StatusBadge tone="ok">{t("已发布", "Published")}</StatusBadge> : item.status === "candidate" ? <button className="textButton" onClick={() => action(`/api/knowledge/candidates/${item.id}/adopt`, {})}>{t("采纳草稿", "Adopt draft")}</button> : <button className="textButton" onClick={() => action(`/api/knowledge/candidates/${item.id}/approve-prompt`, {})}>{t("审批当前版本", "Approve version")}</button>}</div>;
          })}
          {pendingTools.slice(0, 10).map((item) => <div className="mRowItem" key={item.id}><span><b>{item.name || item.title}</b><small>{humanize(item.kind || item.type)}</small></span><StatusBadge tone="warning">{t("待扫描与发布验证", "Awaiting scan & publication")}</StatusBadge></div>)}
          <div className="mKGuideTitle"><ShieldCheck size={14}/>{t(`能力库只显示 ${workflows.filter(isApprovedKnowledgeWorkflow).length} 个运行时已批准工作流；导入 Skill 也必须通过扫描和发布资格。`,`Capabilities shows only ${workflows.filter(isApprovedKnowledgeWorkflow).length} runtime-approved workflows; imported Skills also require scanning and publication eligibility.`)}</div>
        </div>
      )}

      {seg === "交易纪律" && (
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

      {seg === "参考知识" && (
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
      <div className="mPageStats kTruthBand">
        <div><span>{t("今日事件", "Today's events")}</span><strong>{todayEvents.length}</strong></div>
        <div><span>{t("活跃任务", "Active tasks")}</span><strong>{activeTasks.length}</strong></div>
        <div><span>{t("事件规则", "Event rules")}</span><strong>{(data.riskRules || []).filter((rule) => rule.scope === "event").length}</strong></div>
      </div>

      <div className="mChips kFilterRail">
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
            <footer className="kActionBar"><span>{t("圆点表示当天有事件，颜色表示影响等级", "Dots mark events; color shows impact")}</span><button className="textButton" onClick={() => refreshMobileEventCalendar(action)}><RefreshCw size={12}/> {t("刷新事件", "Refresh")}</button></footer>
          </section>
          <section className="mEventAgenda mEvidenceLedger kEvidenceLedger">
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
        <div className="mSectionCard kRegistry">
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
    <section className="mIntelHero kTruthBand"><div><span><Sparkles size={13}/>{t("只作为分析背景", "Analysis context only")}</span><b>{t("先看结论，再按需展开证据", "Read the brief, then expand evidence")}</b><small>{updatedAt ? `${t("更新于", "Updated")} ${formatDateTime(updatedAt)}` : t("等待首次情报刷新", "Waiting for the first intelligence refresh")}</small></div><button type="button" onClick={() => refreshMobileIntelligence(action)} aria-label={t("刷新情报", "Refresh intelligence")}><RefreshCw size={16}/></button></section>
    <div className="mPageStats"><div><span>{t("重要快讯", "Important")}</span><strong>{important.length}</strong></div><div><span>{t("来源正常", "Healthy sources")}</span><strong>{healthy}/{sources.length}</strong></div><div><span>{t("近期事件", "Upcoming")}</span><strong>{next24h.length + dateOnlySoon.length}</strong></div></div>
    <div className="mChips kFilterRail">{segments.map(([id, label]) => <button type="button" key={id} className={segment === id ? "active" : ""} onClick={() => setSegment(id)}>{label}</button>)}</div>

    {segment === "brief" && <div className="mIntelStack">
      <section className="mSectionCard mIntelBrief mEvidenceLedger kEvidenceLedger"><header><span>{t("Daily 市场摘要", "Daily market brief")}</span>{brief && <StatusBadge tone="neutral">v{brief.version || 1}</StatusBadge>}</header>
        {brief ? <><div className="mIntelBriefRows"><span><small>{t("加密风险偏好", "Crypto risk appetite")}</small><b>{localizeText(brief.macroContext?.cryptoRiskAppetite) || t("未知", "Unknown")}</b></span><span><small>{t("宏观周期", "Macro cycle")}</small><b>{mobileMacroLabel(brief.macroContext?.economicCyclePhase)}</b></span><span><small>{t("证据事实", "Evidence facts")}</small><b>{(brief.evidenceFactIds || []).length}</b></span></div>{staleSources.length > 0 && <div className="mIntelConstraint high"><Globe2 size={14}/><p>{t(`${staleSources.length} 个情报来源已陈旧，不会作为当前催化剂`, `${staleSources.length} intelligence sources are stale and excluded as current catalysts`)}</p></div>}{(brief.constraints || []).slice(0, 4).map((constraint, index) => <div className={`mIntelConstraint ${constraint.severity || "medium"}`} key={`${constraint.type || "constraint"}-${index}`}><Shield size={14}/><p>{localizeText(constraint.reason)}</p></div>)}</> : <div className="mNativeEmpty compact"><Sparkles size={21}/><b>{t("日报尚未生成", "Brief not generated")}</b><span>{t("情报刷新任务完成后会自动生成；不会用旧数据补写。", "It is generated after a refresh; stale data is never used to fill gaps.")}</span></div>}
      </section>
      <section className="mSectionCard mIntelTop kRegistry"><header><span>{t("需要先知道的事", "What matters now")}</span><button className="textButton" type="button" onClick={() => setSegment("feed")}>{t("全部快讯", "All flashes")}<ChevronRight size={13}/></button></header>{(brief?.topNews || news).slice(0, 4).map((item, index) => <article key={item.factId || item.id || index}><span className={Number(item.values?.impact || item.impact || 0) >= 80 ? "high" : "normal"}/><div><b>{localizeText(item.title)}</b><small>{item.summary ? localizeText(item.summary) : `${item.sourceName || item.source || t("情报源", "Intel source")} · ${formatDateTime(item.publishedAt)}`}</small></div></article>)}{!(brief?.topNews || news).length && <p className="mInboxEmpty">{t("暂无已验证快讯。", "No verified flashes yet.")}</p>}</section>
      {(next24h.length > 0 || dateOnlySoon.length > 0) && <button type="button" className="mIntelEventLink" onClick={() => ui?.setActive("eventsTasks")}><CalendarClock size={18}/><span><b>{next24h.length ? t(`未来 24 小时有 ${next24h.length} 个精确时间事件`, `${next24h.length} precisely timed events within 24h`) : t("近期有日期级事件提醒", "Upcoming date-only event reminders")}</b><small>{[...next24h.slice(0, 2).map((event) => `${mobileEventTimeLabel(event)} ${localizeText(event.shortTitle || event.title)}`), ...dateOnlySoon.slice(0, 2).map((event) => `${t("全天/时间待定", "All day/time TBD")} ${localizeText(event.shortTitle || event.title)}`)].join(" · ")}</small></span><ChevronRight size={16}/></button>}
    </div>}

    {segment === "feed" && <section className="mIntelFeed mEvidenceLedger kEvidenceLedger">{news.map((item, index) => { const impact = Number(item.values?.impact || item.impact || 0); return <article key={item.id || index}><header><span className={impact >= 80 ? "important" : "flash"}>{impact >= 80 || item.values?.important ? t("重要", "Important") : t("快讯", "Flash")}</span><time>{formatDateTime(item.publishedAt || item.observedAt)}</time></header><b>{localizeText(item.title)}</b>{(item.summary || item.content) && <p>{localizeText(item.summary || item.content)}</p>}<footer><span>{item.sourceName || item.source || "ME News"}</span><span>{(item.symbols || []).join(" · ") || t("全市场", "Market-wide")}</span></footer></article>; })}{!news.length && <div className="mNativeEmpty"><Bell size={22}/><b>{t("暂无实时快讯", "No live flashes")}</b><span>{t("刷新后只展示带真实来源与时间的内容。", "Only timestamped, sourced items appear after refresh.")}</span></div>}</section>}

    {segment === "sources" && <section className="mSectionCard mIntelSources mEvidenceLedger kEvidenceLedger"><header><span>{t("情报来源", "Intelligence sources")}</span><small>{healthy}/{sources.length} {t("正常", "healthy")}</small></header>{sources.map((source) => { const state = mobileIntelHealth(source); return <article key={source.sourceId || source.id || source.name}><span className={`mIntelSourceIcon ${state.tone}`}><Globe2 size={15}/></span><div><b>{localizeText(source.name || source.sourceId)}</b><small>{humanize(source.category, t("补充来源", "Supplemental"))} · {source.lastSuccessAt ? `${t("最近成功", "Last success")} ${formatDateTime(source.lastSuccessAt)}` : t("尚无成功记录", "No successful run yet")}</small>{source.lastError && <p>{localizeText(source.lastError)}</p>}</div><StatusBadge tone={state.tone}>{state.label}</StatusBadge></article>; })}{!sources.length && <div className="mNativeEmpty compact"><Globe2 size={20}/><b>{t("暂无来源状态", "No source status")}</b><span>{t("情报任务运行后会记录真实健康状态。", "Real health status appears after intelligence jobs run.")}</span></div>}</section>}
  </div>;
}

function MobileAccountHealth({ data, action }) {
  const latestReconcile = data.reconciliationReports?.[0];
  const latestSnapshot = data.accountSnapshots?.[0];
  const configuredAccounts = (data.exchangeAccounts || []).filter((account) => account.readEnabled).length;
  const totalAccounts = data.exchangeAccounts?.length || 0;
  const openExecutions = countOpenExecutions(data.executionOrders);
  const blockedChecks = (data.riskChecks || []).filter((item) => ["blocked", "rejected", "risk_rejected"].includes(String(item.decision || item.result || item.status || "").toLowerCase())).length;
  const runtime = automationPresentation(data);
  const rows = [
    [t("交易所账户", "Exchange accounts"), `${configuredAccounts} / ${totalAccounts}`, configuredAccounts ? "ok" : "neutral"],
    [t("私有账户快照", "Account snapshot"), latestSnapshot ? formatDateTime(latestSnapshot.createdAt) : t("未同步", "Not synced"), latestSnapshot ? "ok" : "neutral"],
    [t("对账状态", "Reconciliation"), configuredAccounts ? humanize(latestReconcile?.status, t("未对账", "Not reconciled")) : t("待配置", "Not configured"), latestReconcile?.status === "ok" ? "ok" : "neutral"],
    [t("运行模式", "Operating mode"), runtime.targetLabel, runtime.targetMode === "observe" ? "neutral" : "warning"],
    [t("在途执行", "In-flight executions"), `${openExecutions}${t(" 个", "")}`, openExecutions ? "warning" : "ok"],
    [t("近期风控阻断", "Recent risk blocks"), `${blockedChecks}${t(" 次", "")}`, blockedChecks ? "warning" : "ok"]
  ];
  return (
    <div className="mSubPage">
      <div className="mPageStats kTruthBand">
        <div><span>{t("账户", "Accounts")}</span><strong>{configuredAccounts}/{totalAccounts}</strong></div>
        <div><span>{t("快照", "Snapshot")}</span><strong>{latestSnapshot ? formatTime(latestSnapshot.createdAt) : t("未同步", "Not synced")}</strong></div>
        <div><span>{t("对账", "Reconcile")}</span><strong>{configuredAccounts ? humanize(latestReconcile?.status, t("未对账", "Not reconciled")) : t("待配置", "Not configured")}</strong></div>
      </div>

      <div className="mSectionCard mEvidenceLedger kEvidenceLedger">
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
  const { marginRatePct: marginRate } = marginUsage(portfolio);
  const metrics = [
    [t("总资产", "Total equity"), configured && equity != null ? displayMoney(equity, 2) : t("未同步", "Not synced"), null],
    [t("今日盈亏", "Today's PnL"), configured && portfolio.todayPnl != null ? `${portfolio.todayPnl >= 0 ? "+" : ""}${displayMoney(portfolio.todayPnl, 2)}` : t("未同步", "Not synced"), configured ? portfolio.todayPnl : null],
    [t("可用保证金", "Available margin"), configured && avail != null ? displayMoney(avail, 2) : t("未同步", "Not synced"), null],
    [t("未实现盈亏", "Unrealized PnL"), configured && portfolio.unrealizedPnl != null ? `${portfolio.unrealizedPnl >= 0 ? "+" : ""}${displayMoney(portfolio.unrealizedPnl, 2)}` : t("未同步", "Not synced"), configured ? portfolio.unrealizedPnl : null]
  ];
  const mediumTerm = data.mediumTermAnalytics || {};
  const mediumSymbol = (mediumTerm.symbols || []).find((row) => row.symbol === market.symbol);
  const leverageLabel = (value) => ({ leverage_build_up:t("杠杆堆积","Leverage build-up"), long_build:t("多头增仓","Long build"), long_build_crowded:t("多头拥挤","Crowded long build"), short_build:t("空头增仓","Short build"), short_build_crowded:t("空头拥挤","Crowded short build"), short_covering:t("空头回补","Short covering"), long_deleveraging:t("多头去杠杆","Long deleveraging"), price_move_without_oi_confirmation:t("价格缺OI确认","Price lacks OI confirmation"), deleveraging_without_direction:t("无方向去杠杆","Directionless deleveraging"), stable_or_mixed:t("稳定/混合","Stable/mixed") }[value] || humanize(value));
  const tvInterval = { "15m": "15", "1H": "60", "4H": "240", "1D": "D" }[tf] || "60";
  const circ = 2 * Math.PI * 24;
  const dash = `${((marginRate ?? 0) / 100) * circ} ${circ}`;
  return (
    <div className="mScreen">
      <div className="mMetric2x2 kTruthBand">
        {metrics.map(([k, v, pn]) => <div className="mMetricCell" key={k}><span>{k}</span><b className={`mono ${pn != null ? (Number(pn) >= 0 ? "pos" : "neg") : ""}`}>{v}</b></div>)}
      </div>
      <div className="mCard marketQuoteEvidence kEvidenceLedger">
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
      <div className="mCard marketEvidenceDeck kEvidenceLedger">
        <div className="mCardHead"><b>{t("中频合约状态", "Medium-term contract state")}</b><small>{t("5分钟事实", "5m facts")}</small></div>
        {["15m","1h","4h"].map((window) => { const row=mediumSymbol?.windows?.[window]; return <div className="mPosRow" key={window}><div className="mPosL"><b className="mono">{window}</b><small>{row?.status==="ok"?leverageLabel(row.leverageState):t("样本积累中","Building samples")}</small></div><div className="mPosR"><b className="mono">{row?.status==="ok"?`P ${row.priceChangePct}% · OI ${row.oiChangePct}%`:`${row?.samples??0}/${row?.expected??"—"}`}</b><small className="mono">{row?.status==="ok"?`F ${row.fundingEndPct??"—"}% · CVD ${row.cvdImbalancePct==null?"—":`${row.cvdImbalancePct}%`}`:t("不足时不输出结论","No conclusion until sufficient")}</small></div></div>; })}
        {market.symbol!=="BTC/USDT"&&<div className="mPosRow"><div className="mPosL"><b>BTC Beta</b><small>24h / 3d / 7d</small></div><div className="mPosR"><b className="mono">{["24h","3d","7d"].map((window)=>{const row=mediumSymbol?.btcRisk?.[window];return row?.status==="ok"?`${window} β${row.beta}`:`${window} —`;}).join(" · ")}</b><small>{t("15分钟收益率，严格覆盖", "15m returns with strict coverage")}</small></div></div>}
        {mediumTerm.portfolioBtcRisk?.status&&!['no_positions','insufficient'].includes(mediumTerm.portfolioBtcRisk.status)&&<div className="mPosRow"><div className="mPosL"><b>{t("组合 BTC 风险","Portfolio BTC risk")}</b><small>{mediumTerm.portfolioBtcRisk.status}</small></div><div className="mPosR"><b className="mono">{mediumTerm.portfolioBtcRisk.netBtcEquivalentUsdt} U</b><small>{t("净 / 毛等效","Net / gross equiv.")} {mediumTerm.portfolioBtcRisk.grossBtcBetaExposureUsdt} U</small></div></div>}
        {Object.entries(mediumTerm.eventVolatility?.byType||{}).slice(0,3).map(([type,row])=><div className="mPosRow" key={type}><div className="mPosL"><b>{type}</b><small>{t("BTC 事件波动","BTC event volatility")}</small></div><div className="mPosR"><b className="mono">{row.status==="usable"?`n=${row.samples} · RV ${row.medianPost1hRealizedVolPct}%`:`${row.samples}/${row.minimumSamples}`}</b><small>{row.status==="usable"?`p90 ${row.p90Post1hRealizedVolPct}% · ×${row.medianPost1hVolExpansionRatio}`:t("样本积累中","Building samples")}</small></div></div>)}
      </div>
      <div className="mCard marketPositionRegistry kRegistry">
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
      <div className="mCard mMarginCard kStateRow">
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
  const pf = data.portfolio || {};
  const runtime = automationPresentation(data);
  const smMob = data.marketRegime?.smartMoney || {};
  // 与桌面端共用 smartMoneyBias（1.05/0.95 三档），不再用 >=1 二分导致两端结论矛盾。
  const bias = smMob.ok ? smartMoneyBias(smMob.topTraderLongShortRatio).label : t("待同步", "Pending sync");
  const mandate = data.mandates?.find((m) => ["active", "running"].includes(m.status));
  const cells = [
    [t("状态", "Status"), runtime.label, runtime.tone === "ok" ? "pos" : runtime.tone === "danger" ? "neg" : ""],
    [t("判断", "Read"), bias, bias === "偏多" ? "pos" : bias === "偏空" ? "neg" : ""],
    [t("今日", "Today"), pf.todayPnlPct != null ? displayPct(pf.todayPnlPct) : "—", Number(pf.todayPnlPct || 0) >= 0 ? "pos" : "neg"],
    [t("目标", "Target"), mandate?.maxDailyLossPct ? `${t("亏≤", "Loss ≤")}${mandate.maxDailyLossPct}${t("%/日", "%/day")}` : "—" /* targetMonthlyPct 是后端从未写入的死字段(审计 L1) */, ""]
  ];
  return <div className="mChatStatus kTruthBand">
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
    <div className="mWatchSummary kTruthBand"><div><b className="mono">{groups.length}</b><span>{t("盯盘币种", "Symbols watched")}</span></div><div><b className="mono">{active.length}</b><span>{t("有效条件", "Active conditions")}</span></div><p>{t("命中只会唤起重新分析，不代表已经做多、做空或下单。", "A trigger starts a fresh review; it is not a long, short, or order by itself.")}</p></div>
    <section className="mNativeSection kRegistry"><header><div><b>{t("正在盯盘", "Watching now")}</b><small>{t("先看原判断，再看命中意味着什么", "Read the thesis first, then what a trigger means")}</small></div><span>{active.length}</span></header>
      <div className="mWatchList">{groups.map((group) => { const item = group.primary; if (!item) return null; const tone = item.direction === "long" ? "long" : item.direction === "short" ? "short" : "neutral"; return <article className={`mWatchCard ${tone}`} key={group.symbol}>
        <div className="mWatchCardHead"><div><b className="mono">{item.symbol}</b><span>{direction(item)}</span></div><button onClick={async () => { if (await uiConfirm(`${t("确认撤销", "Cancel")} ${item.symbol}？`)) action(`/api/watch-triggers/${item.id}/cancel`, {}); }}><Trash2 size={15}/></button></div>
        <div className="mWatchThesis"><span>{t("原判断", "Original thesis")}</span><p>{thesis(item)}</p></div>
        <div className="mWatchTrigger"><span><small>{t("等待条件", "Waiting for")}</small><b>{condition(item)}</b></span><span><small>{t("命中之后", "If triggered")}</small><p>{meaning(item)}</p></span></div>
        {(group.secondary || []).length > 0 && <details><summary>{t("辅助条件", "Supporting conditions")} · {group.secondary.length}</summary>{group.secondary.map((row) => <div className="mWatchSecondary" key={row.id}><span><b>{condition(row)}</b><small>{meaning(row)}</small></span><button onClick={() => action(`/api/watch-triggers/${row.id}/cancel`, {})}>×</button></div>)}</details>}
      </article>; })}{!groups.length && <div className="mNativeEmpty"><Eye size={22}/><b>{t("暂无有效观察哨", "No active watches")}</b><span>{t("AI 登记具体价位条件后会显示在这里。", "Concrete price conditions registered by the AI appear here.")}</span></div>}</div>
    </section>
    {history.length > 0 && <section className="mNativeSection mEvidenceLedger kEvidenceLedger"><header><div><b>{t("最近记录", "Recent history")}</b><small>{t("触发、失效与被替代", "Triggered, invalidated, and superseded")}</small></div></header>{history.map((item) => <div className="mNativeRow" key={item.id}><span className={`mStateDot ${item.status}`}/><span><b>{item.symbol} · {direction(item)}</b><small>{condition(item)} · {humanize(item.status)}</small></span><time>{formatTime(item.triggeredAt || item.updatedAt || item.createdAt)}</time></div>)}</section>}
  </div>;
}

// 移动端主导航（与桌面 IA 对齐:交易 / 能力 / 风控与运维），走顶部汉堡抽屉。
// W1b:新增 信号中心(计划看板) + 交易日志,顺序与桌面一致。
// 风控中心(移动版):把风控总览 + 风控设置合并到一个导航项,顶部 Tab 切换。
function MobileRiskHub({ data, action, ui, initialView = "overview" }) {
  const [tab, setTab] = useState(["overview","boundaries","rules"].includes(initialView)?initialView:"overview");
  useEffect(()=>{if(["overview","boundaries","rules"].includes(initialView))setTab(initialView);},[initialView]);
  return (
    <div className="mHub">
      <div className="mHubTabs">
        <button type="button" className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>{t("态势", "Posture")}</button>
        <button type="button" className={tab === "boundaries" ? "active" : ""} onClick={() => setTab("boundaries")}>{t("边界", "Boundaries")}</button>
        <button type="button" className={tab === "rules" ? "active" : ""} onClick={() => setTab("rules")}>{t("规则", "Rules")}</button>
      </div>
      <MobileRisk data={data} action={action} ui={ui} view={tab}/>
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

const mobileStrategyProvenance = (item = {}) => item.recordType === "product" || item.recordType === "research"
  ? "system-native"
  : item.methodId || item.sourceMethodId ? "knowledge-derived" : "imported";
const mobileCapabilityAliases = (item = {}) => [item.serverName, item.id, item.toolName, item.name, item.title]
  .filter(Boolean)
  .map((value) => String(value).trim().toLowerCase());
const mobileCapabilityProvenance = (item = {}, systemAliases = new Set()) => item.knowledgeWorkflow
  ? "knowledge-derived"
  : item.category === "mcp" || item.kind === "MCP" ? "mcp-registered"
    : item.native === true || item.connector || mobileCapabilityAliases(item).some((alias) => systemAliases.has(alias)) ? "system-native" : "imported";
const mobileProvenanceLabel = (kind) => ({
  "system-native": t("系统原生", "System-native"),
  "knowledge-derived": t("知识派生", "Knowledge-derived"),
  imported: t("外部导入", "Imported"),
  "mcp-registered": t("MCP 注册", "MCP registered")
}[kind] || t("已注册资产", "Registered asset"));

function MobileProvenance({ kind }) {
  return <span className={`mLabProvenance mLabProvenance--${kind}`} data-provenance={kind}><i/>{mobileProvenanceLabel(kind)}</span>;
}

const mobileCapabilityValidationEvidence = (item, provenance) => {
  if (item.knowledgeWorkflow) return t("运行时批准与发布资格已核对", "Runtime approval and publication eligibility verified");
  if (provenance === "system-native") return item.connector
    ? t(`配置状态：${humanize(item.status, "—")}`, `Configuration state: ${humanize(item.status, "—")}`)
    : t("系统目录来源；没有单独的能力验证记录", "System registry origin; no separate capability validation record");
  if (provenance === "mcp-registered") return t(`连接状态：${humanize(item.status, "—")}`, `Connection state: ${humanize(item.status, "—")}`);
  const recordedValidation = item.scanStatus || item.securityReview?.status || item.validation?.status;
  return recordedValidation
    ? t(`已记录安全验证：${humanize(recordedValidation)}`, `Recorded security validation: ${humanize(recordedValidation)}`)
    : t("没有记录能力验证证据", "No capability validation evidence recorded");
};

const mobileOwnerReleaseEvidence = (item, assetType, provenance) => {
  const explicit = item.ownerRelease || item.release?.ownerRelease;
  if (explicit) {
    const value = typeof explicit === "string" ? humanize(explicit) : [explicit.versionId || explicit.version, humanize(explicit.status)].filter(Boolean).join(" · ");
    if (value) return { applicable: true, value };
  }
  const knowledgeRelease = assetType === "strategy"
    && provenance === "knowledge-derived"
    && item.version != null
    && isPublishedKnowledgeStrategy(item);
  const releaseLabel = {
    live_probation: t("小额试用", "Live probation"),
    active: t("已发布", "Published"),
    degraded: t("已降级", "Degraded"),
    retired: t("已退役", "Retired"),
    superseded: t("已被替代", "Superseded")
  }[item.status];
  if (knowledgeRelease) return { applicable: true, value: `v${item.version} · ${releaseLabel}` };
  return { applicable: false, value: t("不适用 · 此资产没有 Owner 发布流程", "Not applicable · This asset has no Owner release workflow") };
};

function MobileLabLifecycle({ item = {}, assetType, provenanceKind }) {
  const provenance = provenanceKind || (assetType === "strategy" ? mobileStrategyProvenance(item) : mobileCapabilityProvenance(item));
  const checks = Array.isArray(item.evidence?.checks) ? item.evidence.checks : [];
  const passed = checks.filter((check) => check.passed).length;
  const validation = assetType === "strategy"
    ? checks.length ? t(`${passed}/${checks.length} 项版本门槛通过`, `${passed}/${checks.length} version gates passed`)
      : item.validation ? localizeText(item.validation.methodology) || t("已保留历史 / 样本外验证记录", "Historical / OOS validation recorded")
        : item.backtest ? t("已保留样本外研究证据", "OOS research evidence recorded") : t("尚无正式验证证据", "No formal validation evidence")
    : mobileCapabilityValidationEvidence(item, provenance);
  const liveCount = assetType === "strategy" ? item.liveTrades ?? item.metrics?.closedTrades ?? item.liveMetrics?.trades : item.calls ?? item.runs;
  const live = assetType === "strategy"
    ? liveCount == null ? t("尚无版本归因实盘样本", "No version-attributed live samples") : t(`${liveCount} 笔版本归因实盘样本`, `${liveCount} version-attributed live samples`)
    : item.connector ? t("配置型连接不按工具调用计数", "Configuration connector; calls not counted") : t(`${liveCount || 0} 次记录调用 · ${capabilityHealthLabel(item.health)}`, `${liveCount || 0} recorded calls · ${capabilityHealthLabel(item.health)}`);
  const release = mobileOwnerReleaseEvidence(item, assetType, provenance);
  return <section className="mLabLifecycleDetails kEvidenceLedger" aria-label={t("资产生命周期证据", "Asset lifecycle evidence")}><header><div><small>ASSET LIFECYCLE</small><b>{t("来源、验证、实盘与发布", "Provenance, validation, live evidence, and release")}</b></div></header><ol>
    <li data-lifecycle-stage="provenance"><i/><div><small>{t("来源身份", "PROVENANCE")}</small><b>{mobileProvenanceLabel(provenance)}</b></div></li>
    <li data-lifecycle-stage="validation"><i/><div><small>{t("验证证据", "VALIDATION EVIDENCE")}</small><b>{validation}</b></div></li>
    <li data-lifecycle-stage="live-evidence"><i/><div><small>{assetType === "strategy" ? t("实盘证据", "LIVE EVIDENCE") : t("运行证据", "RUNTIME EVIDENCE")}</small><b>{live}</b></div></li>
    <li data-lifecycle-stage="owner-release" data-lifecycle-applicable={release.applicable ? "true" : "false"}><i/><div><small>{t("Owner 发布状态", "OWNER RELEASE STATE")}</small><b>{release.value}</b></div></li>
  </ol></section>;
}

export function MobileCapabilities({ data, action, ui, initialCapabilityId = "" }) {
  const items = buildCapabilityCatalogRows(data, t);
  const systemCapabilityAliases = new Set([...(data.analysisEngine?.tools || []), ...(data.tools || [])].flatMap(mobileCapabilityAliases));
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(initialCapabilityId);
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
    <section className="mCapabilityList mLabRegistry kRegistry">
      {shown.map((item) => <button className="mCapabilityRow" key={item.id} onClick={() => setOpenId(item.id)}>
        <span className={`mCapabilityIcon ${item.category}`}><Wrench size={17}/></span>
        <span className="mCapabilityRowText"><MobileProvenance kind={mobileCapabilityProvenance(item,systemCapabilityAliases)}/><b>{localizeText(item.name)}</b><small>{typeLabel(item)} · {item.connector ? t("配置型连接", "Configuration connector") : `${t("记录调用", "Recorded")} ${item.calls ?? "—"}`}</small></span>
        <StatusBadge tone={capabilityHealthTone(item.health)}>{capabilityHealthLabel(item.health)}</StatusBadge><ChevronRight size={15}/>
      </button>)}
      {!shown.length && <div className="mNativeEmpty"><Wrench size={22}/><b>{query ? t("没有匹配的能力", "No matching capabilities") : t("暂无能力", "No capabilities yet")}</b><span>{t("可以从 Skill 导入入口添加工具类能力。", "Add tool capabilities from the Skill import flow.")}</span></div>}
    </section>
    {selected && <div className="mCapabilitySheetOverlay" onClick={() => setOpenId("")}>
      <aside className="mCapabilitySheet mLabRegistrySheet kInspector" role="dialog" aria-modal="true" aria-labelledby="capability-sheet-title" onClick={(event) => event.stopPropagation()}>
        <button type="button" className="mSheetGrip" onClick={() => setOpenId("")} aria-label={t("关闭", "Close")}><i/></button>
        <header><span className={`mCapabilityIcon ${selected.category}`}><Wrench size={18}/></span><div><small>{typeLabel(selected)} · {capabilityStatusLabel(selected)}</small><b id="capability-sheet-title">{localizeText(selected.name)}</b></div><StatusBadge tone={capabilityHealthTone(selected.health)}>{capabilityHealthLabel(selected.health)}</StatusBadge></header>
        <MobileProvenance kind={mobileCapabilityProvenance(selected,systemCapabilityAliases)}/>
        <p>{localizeText(selected.description || selected.summary) || t("该能力由 AI 在受控工作流中按权限调用。", "The AI calls this capability inside permission-controlled workflows.")}</p>
        <MobileLabLifecycle item={selected} assetType="capability" provenanceKind={mobileCapabilityProvenance(selected,systemCapabilityAliases)}/>
        <div className="mCapabilityFacts"><span>{t("来源", "Source")}<b>{selected.source || selected.packageName || t("内置", "Built-in")}</b></span><span>{t("启用状态", "Enablement")}<b>{capabilityStatusLabel(selected)}</b></span><span>{t("记录调用", "Recorded calls")}<b className="mono">{selected.connector ? "—" : selected.calls ?? 0}</b></span><span>{t("最近运行", "Last run")}<b>{selected.lastRunAt ? formatDateTime(selected.lastRunAt) : t("尚未运行", "Not observed")}</b></span></div>
        {!selected.connector && <div className="mCapabilitySources"><span><small>{t("模型主动","Model")}</small><b>{selected.usage?.legacyUnsplit?"—":selected.usage?.sourceCalls?.model||0}</b></span><span><small>{t("系统预检","Preflight")}</small><b>{selected.usage?.legacyUnsplit?"—":selected.usage?.sourceCalls?.preflight||0}</b></span><span><small>{t("系统直接","System")}</small><b>{selected.usage?.legacyUnsplit?"—":selected.usage?.sourceCalls?.system||0}</b></span><span><small>{t("健康评测","Evaluation")}</small><b>{selected.usage?.sourceCalls?.evaluation||selected.evalMetrics?.calls||0}</b></span></div>}
        {selected.usage?.legacyUnsplit && <p className="mCapabilityMetricNote">{t(`升级前的 ${selected.usage.legacyUnsplitCalls||selected.calls||0} 次记录无法可靠拆分来源；后续调用会按模型、预检和系统分别记录。`,`The ${selected.usage.legacyUnsplitCalls||selected.calls||0} legacy records cannot be reliably split. New calls are source-attributed.`)}</p>}
        {selected.usage && <div className="mCapabilityUsage"><span><b>{selected.usage.success || 0}</b>{t("成功", "Success")}</span><span><b>{selected.usage.blocked || 0}</b>{t("阻断", "Blocked")}</span><span><b>{selected.usage.error || 0}</b>{t("失败", "Errors")}</span><span><b>{selected.usage.unclassified || 0}</b>{t("历史未分类", "Legacy unknown")}</span></div>}
        <div className="mCapabilityManageBar kActionBar"><button className="mCapabilityManage" onClick={manageSelected}>{selected.category === "mcp" || selected.connector ? t("前往系统设置", "Open Settings") : selected.native ? (selected.enabled ? t("停用能力", "Disable capability") : t("启用能力", "Enable capability")) : t("管理 Skill", "Manage Skill")}</button></div>
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
    <aside className="mResearchSheet mLabResearchSheet kInspector" role="dialog" aria-modal="true" aria-labelledby="research-sheet-title" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="mSheetGrip" onClick={onClose} aria-label={t("关闭", "Close")}><i/></button>
      <header><div><small>{mobileResearchEvidenceLabel(record.evidenceType)}</small><b id="research-sheet-title">{localizeText(record.name)}</b><span>{record.symbol || "—"} · {record.timeframe || "—"} · {record.createdAt ? formatDate(record.createdAt) : t("时间未记录", "Time unavailable")}</span></div><StatusBadge tone={mobileResearchStatusTone(record)}>{mobileResearchStatusLabel(record.status)}</StatusBadge></header>
      <div className="mResearchSheetMetrics"><span><small>{t("累计收益", "Total return")}</small><b className={Number(record.totalReturnPct || 0) >= 0 ? "pos" : "neg"}>{record.totalReturnPct == null ? "—" : displayPct(record.totalReturnPct)}</b></span><span><small>{t("R 期望", "R expectancy")}</small><b>{record.expectancyR == null ? "—" : `${record.expectancyR}R`}</b></span><span><small>{t("盈亏因子", "Profit factor")}</small><b>{record.profitFactor ?? "—"}</b></span><span><small>{t("最大回撤", "Max drawdown")}</small><b className="neg">{record.maxDrawdownPct == null ? "—" : `${record.maxDrawdownPct}%`}</b></span></div>
      <section><div className="mResearchSectionHead"><b>{t("收益曲线", "Equity curve")}</b><span>{record.trades ?? "—"} {t("笔交易", "trades")}</span></div><MobileSparkline values={record.equityCurve || []}/></section>
      <section className="mResearchDetailRows"><span>{t("胜率", "Win rate")}<b>{record.winRatePct == null ? "—" : `${record.winRatePct}%`}</b></span><span>{t("90% 置信下界", "90% lower bound")}<b>{record.expectancyLower90R == null ? "—" : `${record.expectancyLower90R}R`}</b></span><span>{t("正向样本外分段", "Positive OOS folds")}<b>{record.positiveFolds == null ? "—" : `${record.positiveFolds}/${record.activeFolds ?? "—"}`}</b></span><span>{t("研究方法", "Methodology")}<b>{localizeText(record.methodology) || t("统一成本模型下的历史验证", "Historical validation with the unified cost model")}</b></span></section>
      {folds.length > 0 && <section><div className="mResearchSectionHead"><b>{t("样本外分段", "Out-of-sample folds")}</b><span>{folds.length}</span></div><div className="mResearchFoldList">{folds.map((fold, index) => <div key={index}><b>{t("分段", "Fold")} {index + 1}</b><span>{fold.trades ?? "—"} {t("笔", "trades")}</span><span>{fold.expectancyR == null ? "—" : `${fold.expectancyR}R`}</span><span>PF {fold.profitFactor ?? "—"}</span></div>)}</div></section>}
      {params.length > 0 && <details className="mResearchParams"><summary>{t("查看策略参数", "View strategy parameters")}<ChevronDown size={14}/></summary><div>{params.map(([key, value]) => <span key={key}>{humanize(key)}<b>{String(value)}</b></span>)}</div></details>}
    </aside>
  </div>;
}

export function MobileBacktestResearch({ data, action, initialDetailId = "" }) {
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
  const [detailId, setDetailId] = useState(initialDetailId);
  const detail = historical.find((row) => row.id === detailId) || null;
  return <div className="mStrategyStack mResearchMobile">
    <div className="mResearchSummary"><span><small>{t("历史证据", "Historical evidence")}</small><b>{summary.totalHistoricalEvidence ?? historical.length}</b></span><span><small>{t("自动样本外", "Automated OOS")}</small><b>{summary.optimizerOos ?? historical.filter((row) => row.evidenceType === "optimizer_oos").length}</b></span><span><small>{t("工作室样本外", "Studio OOS")}</small><b>{summary.studioOos ?? historical.filter((row) => row.evidenceType === "studio_oos").length}</b></span></div>
    <div className="mResearchRunCard"><span><b>{t("用真实收盘 K 线做样本外验证", "Run OOS validation on real closed candles")}</b><small>{t("历史证据与纯前向模拟分开记录，不用模拟结果冒充回测。", "Historical evidence and forward simulation remain separate.")}</small></span><button onClick={() => action("/api/strategy/research", {}, "POST")}><Play size={14}/>{t("运行研究", "Run research")}</button></div>
    <section className="mCard mResearchListCard mLabResearchRegistry kRegistry"><div className="mCardHead"><b>{t("研究记录", "Research records")}</b><small>{historical.length}</small></div>
      <div className="mResearchList">{historical.map((row) => <button key={row.id} onClick={() => setDetailId(row.id)}><div className="mResearchRecordHead"><span><small>{mobileResearchEvidenceLabel(row.evidenceType)}</small><b>{localizeText(row.name)}</b></span><StatusBadge tone={mobileResearchStatusTone(row)}>{mobileResearchStatusLabel(row.status)}</StatusBadge></div><p>{row.symbol || "—"} · {row.timeframe || "—"} · {row.direction ? (row.direction === "short" ? t("做空", "Short") : t("做多", "Long")) : t("方向不限", "Any side")}</p><div><span>{t("交易", "Trades")}<b>{row.trades ?? "—"}</b></span><span>{t("期望", "Expectancy")}<b>{row.expectancyR == null ? "—" : `${row.expectancyR}R`}</b></span><span>PF<b>{row.profitFactor ?? "—"}</b></span><span>{t("回撤", "Drawdown")}<b>{row.maxDrawdownPct == null ? "—" : `${row.maxDrawdownPct}%`}</b></span></div><ChevronRight size={16}/></button>)}
        {!historical.length && <div className="mNativeEmpty"><BarChart3 size={24}/><b>{t("尚无历史研究证据", "No historical research evidence yet")}</b><span>{t("运行研究后，真实 OKX 收盘 K 线的样本外结果会显示在这里。", "Run research to populate OOS results from real OKX closed candles.")}</span></div>}
      </div>
    </section>
    <section className="mCard mForwardCard mLabResearchForward kEvidenceLedger"><div className="mCardHead"><b>{t("纯前向模拟", "Pure forward simulation")}</b><small>{t("独立证据", "Separate evidence")}</small></div>{forward.map((row) => <div className="mForwardRow" key={row.id}><div><b>{localizeText(row.name)}</b><small>{row.timeframe || "—"}{row.openPosition ? ` · ${t("持仓进行中", "position open")}` : ""}</small></div><span>{row.completedTrades}/{row.minimumTrades}</span><progress max="100" value={row.progressPct || 0}/><StatusBadge tone={row.status === "passed" ? "ok" : row.status === "failed" ? "danger" : "warning"}>{mobileResearchStatusLabel(row.status)}</StatusBadge></div>)}{!forward.length && <p className="mResearchEmptyLine">{t("暂无纯前向会话；自动研究选出合格策略后会在这里推进。", "No forward sessions yet. Qualifying research will create them here.")}</p>}</section>
    <MobileResearchDetailSheet record={detail} onClose={() => setDetailId("")}/>
  </div>;
}

// 策略库(移动版):所有会输出交易主张的策略——蒸馏/导入/LLM。与桌面 StrategyLibraryConcept 同口径。
export function MobileStrategy({ data, action, initialTab = "catalog", initialCatalogId = "" }) {
  const studio = data.strategyStudio || {};
  const strategyCatalog = buildStrategyCatalogRows(data, t);
  const { products } = strategyCatalog;
  const strategies = strategyCatalog.rows;
  const [tab, setTab] = useState(initialTab);
  const [catalogId, setCatalogId] = useState(initialCatalogId);
  const selectedCatalog = strategies.find((row) => row.id === catalogId) || null;
  const [prompt, setPrompt] = useState("");
  const drafts = studio.drafts || [];
  const [selectedId, setSelectedId] = useState(drafts[0]?.id || "");
  const selected = drafts.find((row) => row.id === selectedId) || drafts[0] || {};
  const coverage = strategyBacktestCoverage(selected, studio.backtests);
  const latestBt = coverage.rows.find((row) => row.backtest?.id === selected.latestBacktestId)?.backtest || coverage.rows.find((row) => row.backtest)?.backtest;
  const listings = studio.marketplace?.listings || [];
  const createDraft = async () => {
    if (prompt.trim().length < 12) return;
    const result = await action("/api/strategy/studio/drafts", { prompt }, "POST");
    if (result?.draft?.id) { setSelectedId(result.draft.id); setPrompt(""); if (result.suite?.status === "passed") for (const symbol of result.draft.blueprint?.symbols || []) await action(`/api/strategy/studio/drafts/${result.draft.id}/backtest`, { symbol }, "POST"); }
  };
  const statusLabel = (value) => ({ owner_live_observation:t("实盘观察（未验证）","Live observation"), validated_active:t("证据达标","Evidence-qualified"), tests_passed:t("自动测试通过","Tests passed"), backtest_passed:t("样本外通过","OOS passed"), backtest_failed:t("样本外未通过","OOS failed"), published:t("已发布","Published") }[value] || humanize(value, "—"));
  const originLabel = (value) => t(value, ({ "策略产品":"Strategy product", "指标研究模型":"Research model", "蒸馏":"Distilled", "LLM/手写":"LLM/Manual", "导入":"Imported", "其他":"Other" })[value] || value);
  return (
    <div className="mScreen">
      <div className="mHubTabs mStrategyTabs"><button className={tab === "catalog" ? "active" : ""} onClick={() => setTab("catalog")}>{t("目录", "Catalog")}</button><button className={tab === "studio" ? "active" : ""} onClick={() => setTab("studio")}>{t("工作室", "Studio")}</button><button className={tab === "market" ? "active" : ""} onClick={() => setTab("market")}>{t("市场", "Market")}</button><button className={tab === "research" ? "active" : ""} onClick={() => setTab("research")}>{t("回测研究", "Backtest")}</button></div>
      {tab === "catalog" && <><div className="mMetric2x2 kTruthBand"><div className="mMetricCell"><span>{t("策略总数", "Strategies")}</span><b className="mono">{strategies.length}</b></div><div className="mMetricCell"><span>{t("版本化产品", "Products")}</span><b className="mono pos">{products.length}</b></div><div className="mMetricCell"><span>{t("研究模型", "Research models")}</span><b className="mono">{strategyCatalog.research.length}</b></div><div className="mMetricCell"><span>{t("工作室草稿", "Studio drafts")}</span><b className="mono">{drafts.length}</b></div></div><section className="mCard mLabRegistry kRegistry">{strategies.length ? strategies.map((s) => <button type="button" className="mIncRow mLabRegistryRow" key={s.id} onClick={() => setCatalogId(s.id)}><div className="mIncL"><MobileProvenance kind={mobileStrategyProvenance(s)}/><b>{localizeText(s.name)}</b><span className="mIncX">{originLabel(s.origin)}{s.timeframe ? ` · ${s.timeframe}` : ""}</span></div><StatusBadge tone={statusTone(s.status)}>{statusLabel(s.status)}</StatusBadge><ChevronRight size={15}/></button>) : <div className="mEmpty">{t("暂无策略", "No strategies")}</div>}</section>{selectedCatalog&&<div className="mLabRegistrySheetOverlay" onClick={() => setCatalogId("")}><aside className="mLabRegistrySheet kInspector" role="dialog" aria-modal="true" aria-labelledby="strategy-sheet-title" onClick={(event) => event.stopPropagation()}><button type="button" className="mSheetGrip" onClick={() => setCatalogId("")} aria-label={t("关闭", "Close")}><i/></button><header><div><small>{t("策略对象", "STRATEGY OBJECT")}</small><b id="strategy-sheet-title">{localizeText(selectedCatalog.name)}</b><span>{[selectedCatalog.version&&`v${selectedCatalog.version}`,selectedCatalog.direction,selectedCatalog.timeframe].filter(Boolean).join(" · ")||"—"}</span></div><StatusBadge tone={statusTone(selectedCatalog.status)}>{statusLabel(selectedCatalog.status)}</StatusBadge></header><MobileProvenance kind={mobileStrategyProvenance(selectedCatalog)}/><MobileLabLifecycle item={selectedCatalog} assetType="strategy"/><div className="mStrategyFacts mLabInspectorFacts"><span>{t("类型", "Type")}<b>{originLabel(selectedCatalog.origin)}</b></span><span>{t("模型家族", "Model family")}<b>{humanize(selectedCatalog.template,"—")}</b></span><span>{t("方向 / 周期", "Side / timeframe")}<b>{humanize(selectedCatalog.direction,"—")} · {selectedCatalog.timeframe||"—"}</b></span><span>{t("盈亏因子", "Profit factor")}<b>{selectedCatalog.profitFactor??selectedCatalog.backtest?.profitFactor??"—"}</b></span><span>{t("版本指纹", "Version fingerprint")}<b className="mono">{selectedCatalog.contentHash?.slice(0,16)||selectedCatalog.fingerprint?.slice(0,16)||"—"}</b></span></div></aside></div>}</>}
        {tab === "studio" && <div className="mStrategyStack"><div className="mCard"><b className="mSectionTitle">{t("自然语言创建策略", "Create from natural language")}</b><p className="mStrategyHelp">{t("只编译到确定性白名单规则；创建草稿不会下单。", "Compiles only to deterministic allowlisted rules. Drafts never place orders.")}</p><textarea className="mStrategyPrompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={t("例：ADA/USDT 1小时，RSI 14 从30下方站回时做多，止损2%，止盈2.5R", "Example: Long ADA/USDT on 1h when RSI(14) crosses back above 30; 2% stop, 2.5R target")}/><button className="mStrategyPrimary" disabled={prompt.trim().length < 12} onClick={createDraft}><Sparkles size={14}/>{t("生成、测试并自动回测", "Generate, test, and backtest")}</button></div>
        {drafts.length ? <div className="mCard"><b className="mSectionTitle">{t("策略草稿", "Strategy drafts")}</b><div className="mStrategyDrafts">{drafts.slice(0,20).map((row) => <button key={row.id} className={row.id === selected.id ? "active" : ""} onClick={() => setSelectedId(row.id)}><span><b>{localizeText(row.blueprint?.name)}</b><small>{row.authoring?.channel === "agent_chat" ? t("AI 对话创建", "Created in AI chat") : t("工作室创建", "Created in Studio")} · {row.blueprint?.symbols?.join("/")} · {row.blueprint?.timeframe} · {humanize(row.blueprint?.direction)}</small></span><StatusBadge tone={statusTone(row.status)}>{statusLabel(row.status)}</StatusBadge></button>)}</div></div> : null}
        {selected.id && <><div className="mCard"><b className="mSectionTitle">{t("系统理解的规则", "Compiled rules")}</b><div className="mStrategyFacts"><span>{t("信号", "Signal")}<b>{t(selected.blueprint?.templateName || "—", selected.blueprint?.templateNameEn || selected.blueprint?.templateName || "—")}</b></span><span>{t("止损 / 止盈", "Stop / target")}<b>{selected.blueprint?.exitPolicy?.stopLossPct}% · {selected.blueprint?.exitPolicy?.takeProfitR}R</b></span><span>{t("参数", "Parameters")}<b className="mono">{JSON.stringify(selected.blueprint?.params || {})}</b></span><span>{t("编译来源", "Compiler provenance")}<b>{humanize(selected.compilationReport?.compiler || selected.compiler, "—")} · {humanize(selected.compilationReport?.status, "—")}</b></span><span>{t("成本证据", "Cost evidence")}<b className="mono">{selected.blueprint?.costAssumption?.contentHash?.slice(0,12) || "—"}</b></span></div>{(selected.compilationReport?.warnings || []).length ? <p className="mStrategyHelp">{t("编译提示", "Compiler warnings")}：{selected.compilationReport.warnings.map((value) => humanize(value)).join(" · ")}</p> : null}</div><div className="mCard"><b className="mSectionTitle">{t("自动测试", "Generated tests")} · {selected.generatedTests?.passed || 0}/{selected.generatedTests?.total || 0}</b>{(selected.generatedTests?.tests || []).map((test) => <div className="mStrategyTest" key={test.id}>{test.passed ? <CheckCircle2 size={14}/> : <Info size={14}/>}<span><b>{t(test.name, test.nameEn || test.name)}</b><small>{t(test.detail, test.detailEn || test.detail)}</small></span></div>)}</div><div className="mCard"><b className="mSectionTitle">{t("样本外证据", "Out-of-sample evidence")}</b>{coverage.rows.map((row) => <div className="mStrategyTest" key={row.symbol}>{row.passed ? <CheckCircle2 size={14}/> : <Info size={14}/>}<span><b>{row.symbol}</b><small>{humanize(row.status)}</small></span></div>)}{latestBt ? <div className="mStrategyFacts"><span>{t("交易 / 期望", "Trades / expectancy")}<b>{latestBt.oos?.trades || 0} · {latestBt.oos?.expectancyR ?? "—"}R</b></span><span>PF / {t("回撤", "drawdown")}<b>{latestBt.oos?.profitFactor ?? "—"} · {latestBt.oos?.maxDrawdownPct ?? "—"}%</b></span><span>{t("正向分段", "Positive folds")}<b>{latestBt.positiveFolds}/{latestBt.activeFolds}</b></span></div> : <p className="mStrategyHelp">{t("尚未运行 OKX 历史样本外回测。", "OKX historical OOS backtest has not run.")}</p>}<div className="mStrategyActions"><button disabled={selected.generatedTests?.status !== "passed"} onClick={async () => { for (const symbol of selected.blueprint?.symbols || []) await action(`/api/strategy/studio/drafts/${selected.id}/backtest`, { symbol }, "POST"); }}>{t("逐交易对运行回测", "Run every symbol")}</button><button disabled={!coverage.complete || Boolean(selected.publishVersionId)} onClick={() => action(`/api/strategy/studio/drafts/${selected.id}/publish`, {}, "POST")}>{selected.publishVersionId ? t("已发布", "Published") : t("发布到市场", "Publish")}</button></div></div></>}
      </div>}
      {tab === "market" && <div className="mStrategyStack"><div className="mCard"><b className="mSectionTitle">{t("内部策略市场", "Internal strategy market")}</b><p className="mStrategyHelp">{t("不依赖对外 MCP。启用只会加入 AI 可选集，仍须通过全部实时风控。", "Independent of external MCP. Enabling only adds a strategy to the AI eligible set; all live risk checks remain mandatory.")}</p></div>{listings.map((row) => { const def = row.definition || {}; const oos = row.validation?.oos; return <div className="mCard" key={row.id}><div className="mStrategyMarketHead"><b>{t(row.title || def.name, row.titleEn || row.title || def.name)}</b><StatusBadge tone={row.evidenceLevel === "live_validated" ? "ok" : "warning"}>{row.evidenceLevel === "oos_passed" ? t("样本外通过", "OOS passed") : row.evidenceLevel === "live_validated" ? t("实盘证据达标", "Live-validated") : t("实盘观察", "Live observation")}</StatusBadge></div><p className="mStrategyHelp">{t(row.summary || def.description, row.summaryEn || row.summary || def.description)}</p><div className="mStrategyFacts"><span>{t("版本", "Version")}<b className="mono">{row.strategyVersionId}</b></span><span>{t("方向 / 周期", "Side / timeframe")}<b>{humanize(def.direction)} · {(def.timeframes || []).join("/") || def.timeframe || "—"}</b></span><span>{t("证据", "Evidence")}<b>{row.source === "official" ? `${row.metrics?.closedTrades || 0} ${t("笔实盘", "live closes")}` : `${oos?.trades || 0} ${t("笔样本外", "OOS trades")} · ${oos?.expectancyR ?? "—"}R`}</b></span></div>{row.source === "official" ? <button className="mStrategyDisabled" disabled>{row.enabled ? t("系统当前可用", "Available") : t("已暂停", "Paused")}</button> : <button className="mStrategyPrimary" onClick={() => action(`/api/strategy/market/${encodeURIComponent(row.strategyVersionId)}/${row.enabled ? "disable" : "enable"}`, {}, "POST")}>{row.enabled ? t("从 AI 可选集移除", "Remove from AI set") : t("加入 AI 可选集", "Add to AI set")}</button>}</div>; })}</div>}
      {tab === "research" && <MobileBacktestResearch data={data} action={action}/>}
    </div>
  );
}

const mobileIconComponents = {
  activity: Activity,
  bot: Bot,
  bookOpen: BookOpen,
  calendarClock: CalendarClock,
  clipboardList: ClipboardList,
  gauge: Gauge,
  gitBranch: GitBranch,
  globe: Globe2,
  moreHorizontal: MoreHorizontal,
  pieChart: PieChart,
  receiptText: ReceiptText,
  rocket: Rocket,
  settings: Settings,
  shield: Shield,
  shieldCheck: ShieldCheck,
  wrench: Wrench
};
const mobileNavItem = (item) => ({ ...item, ...MOBILE_NAV_PRESENTATION[item.id], icon: mobileIconComponents[MOBILE_NAV_PRESENTATION[item.id]?.iconId] });
const mobileNav = [
  ...MOBILE_PRIMARY_NAV,
  ...Object.values(MOBILE_WORKSPACE_NAV).flat(),
  ...MOBILE_MORE_UTILITIES
].map(mobileNavItem).concat([{ ...mobileNavItem({ id: "operationsCenter" }), id: "auditSystem" }]);
const mobilePrimaryNav = MOBILE_PRIMARY_NAV.map((item) => {
  const presentation = MOBILE_NAV_PRESENTATION[item.id];
  const tabLabel = { chat: ["AI", "AI"], cockpit: ["Live", "Live"] }[item.id] || presentation.label;
  return { ...mobileNavItem(item), label: tabLabel, workspace: item.workspace === "trade" ? "live" : item.workspace };
});
const mobileMoreUtilities = MOBILE_MORE_UTILITIES.map(mobileNavItem);
const mobileNavLabel = (item) => t(item?.label?.[0] || "", item?.label?.[1] || item?.label?.[0] || "");

const mobileWorkspaceRailLabels = {
  chat: ["对话", "Chat"], watch: ["盯盘", "Watch"], intelligence: ["情报", "Intelligence"], eventsTasks: ["事件", "Events"],
  cockpit: ["概览", "Overview"], positions: ["持仓", "Positions"], executionReview: ["执行", "Execution"], tradeLedger: ["流水", "Ledger"],
  labMap: ["地图", "Map"], knowledgeBase: ["孵化", "Incubate"], strategyLib: ["策略", "Strategies"], capabilityLib: ["能力", "Capabilities"], labReviews: ["复盘", "Reviews"],
  riskHub: ["态势", "Posture"], riskSettings: ["规则", "Rules"], eventRisk: ["事件", "Events"]
};

const mobileWorkspaceLabel = (workspace) => t(
  ({ ai: "AI 工作区", trade: "Live 工作区", lab: "Lab 研究生命周期", control: "Control 工作区" })[workspace] || "工作区",
  ({ ai: "AI workspace", trade: "Live workspace", lab: "Lab research lifecycle", control: "Control workspace" })[workspace] || "Workspace"
);

const mobileWorkspaceRailLabel = (item) => {
  const label = mobileWorkspaceRailLabels[item.id] || MOBILE_NAV_PRESENTATION[item.id]?.label || [item.id, item.id];
  return t(label[0], label[1] || label[0]);
};

const isMobileDestinationActive = (item, route, subPage) => {
  const target = resolveMobileRoute(item.id);
  return target.route === route && (target.subPage || "") === (subPage || "");
};

export function MobileWorkspaceRail({ workspace, route, subPage, onNavigate }) {
  const items = mobileWorkspaceDestinations(workspace);
  return <nav className={`mWorkspaceRail mWorkspaceRail--${workspace}`} aria-label={mobileWorkspaceLabel(workspace)}>
    {items.map((item) => {
      const active = isMobileDestinationActive(item, route, subPage);
      return <button type="button" key={item.id} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => onNavigate(item.id)}>{mobileWorkspaceRailLabel(item)}</button>;
    })}
  </nav>;
}

export function MobileLabRail({ route, subPage, onNavigate }) {
  return <section className="mLabWorkspaceLifecycle">
    <header><small>03 / RESEARCH MAP</small><span>{t("双来源 → 正式资产 → 实盘证据 → Owner 版本", "Dual origins → formal assets → live evidence → Owner version")}</span></header>
    <MobileWorkspaceRail workspace="lab" route={route} subPage={subPage} onNavigate={onNavigate}/>
  </section>;
}

function MobileTabbar({ route, activeWorkspace: activeWorkspaceProp, onNavigate, onMore }) {
  const activeWorkspace = activeWorkspaceProp || resolveMobileRoute(route).workspace;
  return <nav className="mNativeTabbar" aria-label={t("主导航", "Primary navigation")}>
    {mobilePrimaryNav.map((item) => {
      const Icon = item.icon;
      const active = item.id === "more" ? ["operations", "configuration"].includes(activeWorkspace) : activeWorkspace === item.workspace;
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

export function NavDrawer({ open, route, activeWorkspace, onNavigate, onClose, lang, switchLang }) {
  if (!open) return null;
  const drawerWorkspace = activeWorkspace || resolveMobileRoute(route).workspace;
  return (
    <div className="mDrawerOverlay" onClick={onClose}>
      <aside className="mDrawer" onClick={(event) => event.stopPropagation()}>
        <div className="mDrawerBrand"><span className="mDrawerLogo"><img src="/kordyn-logo.svg" alt="KORDYN" /></span><div className="mDrawerBrandText"><b>KORDYN</b><small>AI · DIGITAL ASSET</small></div></div>
        {switchLang && <div className="mLangBar"><Globe2 size={14} /><div className="mLangSeg" role="group" aria-label={t("切换语言", "Switch language")}><button className={lang === "zh" ? "on" : ""} onClick={() => switchLang("zh")}>中文</button><button className={lang === "en" ? "on" : ""} onClick={() => switchLang("en")}>English</button></div></div>}
        <div className="mDrawerTitle"><b>{t("更多功能", "More")}</b><small>{t("低频设置与记录", "Settings and records")}</small></div>
        <div className="mDrawerNav">
          {mobileMoreUtilities.filter((item) => item.id !== "systemSettings").map((n, index) => {
            const Icon = n.icon;
            const previousGroup = mobileMoreUtilities.filter((item) => item.id !== "systemSettings")[index - 1]?.group;
            const target = resolveMobileRoute(n.id);
            const selected = route === target.route && drawerWorkspace === target.workspace;
            return <div className="mDrawerNavEntry" key={n.id}>{previousGroup !== n.group && <small className="mDrawerGroupLabel">{n.group}</small>}<button className={`mDrawerItem ${selected ? "active" : ""}`} onClick={() => onNavigate(n.id)}><Icon size={19} /><span><b>{mobileNavLabel(n)}</b><small>{t(n.hint[0], n.hint[1])}</small></span><ChevronRight size={15}/></button></div>;
          })}
        </div>
        <div className="mDrawerFoot">
          {mobileMoreUtilities.filter((item) => item.id === "systemSettings").map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={`mDrawerSettings ${route === "systemSettings" ? "active" : ""}`} onClick={() => onNavigate(item.id)}><Icon size={19}/><span><b>{mobileNavLabel(item)}</b><small>{t(item.hint[0], item.hint[1])}</small></span><ChevronRight size={15}/></button>;
          })}
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
  const [activeProductWorkspace, setActiveProductWorkspace] = useState("ai");
  const [drawer, setDrawer] = useState(false);
  const [subPage, setSubPage] = useState("");
  const [panel, setPanel] = useState("");
  const [killConfirm, setKillConfirm] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const activeSection = resolveMobileRoute(route).section;
  useEffect(() => { ensureSection?.(activeSection); }, [route]);

  function navigate(next) {
    haptic("light");
    const resolved = resolveMobileRoute(next);
    setActiveProductWorkspace(resolved.workspace);
    setRoute(resolved.route);
    setSubPage(resolved.subPage || "");
    setDrawer(false);
    if (!resolved.recognized) notify?.(t("未找到该入口，已返回 AI。", "That destination was not found. Returned to AI."));
  }

  const ui = { setActive: navigate, notify, download, refresh, ensureSection, openPanel: setPanel, closePanel: () => setPanel("") };
  const runtime = automationPresentation(data);
  const settingsSection = subPage.startsWith("settings:") ? subPage.slice(9) : "";
  useEffect(() => {
    if (route !== "systemSettings") return;
    if (!settingsSection) {
      ensureSection?.("riskCenter", { background: true });
      ensureSection?.("operationsCenter", { background: true });
    }
    if (settingsSection === "event_sources") ensureSection?.("operationsCenter", { background: true });
    if (["trading", "risk"].includes(settingsSection)) ensureSection?.("riskCenter", { background: true });
  }, [route, settingsSection]);

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
    content = subPage === "owner" ? <MobileOwnerReview data={data} action={action} ui={ui} /> : <MobileExecution data={data} action={action} initialTab={subPage === "reviews" ? "reviews" : "overview"} />;
  } else if (route === "tradeLedger") {
    content = <MobileExecution data={data} action={action} initialTab="orders" />;
  } else if (route === "riskHub") {
    content = <MobileRiskHub data={data} action={action} ui={ui} initialView={subPage} />;
  } else if (route === "intelligence") {
    content = <MobileIntelligence data={data} action={action} ui={ui} />;
  } else if (route === "eventsTasks") {
    content = <MobileTasks data={data} action={action} ui={ui} />;
  } else if (route === "labMap") {
    content = <MobileResearchMap data={data} ui={ui} />;
  } else if (route === "knowledgeBase") {
    content = <MobileKnowledge data={data} action={action} ui={ui} view="knowledge" />;
  } else if (route === "capabilityLib") {
    content = <MobileCapabilities data={data} action={action} ui={ui} />;
  } else if (route === "strategyLib") {
    content = <div className="content mSubContent"><MobileStrategy data={data} action={action} initialTab={subPage === "studio" ? "studio" : "catalog"} /></div>;
  } else if (route === "auditSystem") {
    content = <MobileOperations data={data} action={action} ui={ui} initialView={subPage||"overview"}/>;
  } else if (route === "systemSettings") {
    content = settingsSection === "trading" ? <MobileTradingConfiguration data={data} action={action} ui={ui}/>
      : settingsSection === "risk" ? <MobileRiskRulesConfiguration data={data} action={action} ui={ui}/>
        : settingsSection === "event_sources" ? <MobileEventSourcesConfiguration data={data} action={action} ui={ui}/>
          : ["agents", "users"].includes(settingsSection) ? <MobileGovernanceConfiguration kind={settingsSection} data={data} action={action} ui={ui}/>
          : settingsSection ? <div className="content mSubContent mConfigurationDetail"><div className="settingsPage mConfigurationEditor kFormSurface"><SystemConfigPanel data={data} action={action} section={settingsSection} /></div></div>
            : <MobileSettingsIndex data={data} ui={ui} onOpen={setSubPage} />;
  } else {
    content = <MobileMarket data={data} action={action} ui={ui} />;
  }

  const resourceState = data.resourceState?.[activeSection] || "not_loaded";
  if (resourceState === "loaded" && ["ai", "live", "lab", "control"].includes(activeProductWorkspace)) {
    const workspace = activeProductWorkspace === "live" ? "trade" : activeProductWorkspace;
    content = <>{workspace === "lab"
      ? <MobileLabRail route={route} subPage={subPage} onNavigate={navigate}/>
      : <MobileWorkspaceRail workspace={workspace} route={route} subPage={subPage} onNavigate={navigate}/>} {content}</>;
  }
  if (resourceState !== "loaded") {
    content = <WorkspaceStateBoundary resourceState={resourceState} onRetry={() => ensureSection?.(activeSection, { force: true })} />;
  }

  const headerRight = subPage
    ? <button className="mBack" onClick={() => activeProductWorkspace === "lab" && route === "executionReview" ? navigate("labMap") : setSubPage("")} aria-label={t("返回", "Back")}><ChevronLeft size={19} /></button>
    : <button className={`mRuntimeButton ${runtime.tone}`} onClick={() => setSafetyOpen(true)} title={runtime.detail}><span/><div><small>{t("当前状态", "RUNTIME")}</small><b>{runtime.label}</b></div><ChevronDown/></button>;

  return (
    <div className="mShell2 kordynSystem">
      <MobileHeader route={activeProductWorkspace === "lab" && route === "executionReview" ? "labMap" : route} onMenu={() => setDrawer(true)} right={headerRight} reconnecting={Boolean(connectionError)} />
      {route === "chat" && !subPage
        ? <main className="mMain2 mMainChat">{content}</main>
        : <PullToRefresh className="mMain2" onRefresh={refresh}>{content}</PullToRefresh>}
      <MobileTabbar route={route} activeWorkspace={activeProductWorkspace} onNavigate={navigate} onMore={() => setDrawer(true)} />
      <NavDrawer open={drawer} route={route} activeWorkspace={activeProductWorkspace} onNavigate={navigate} onClose={() => setDrawer(false)} lang={lang} switchLang={switchLang} />
      {safetyOpen && <MobileSafetySheet data={data} action={action} onClose={() => setSafetyOpen(false)} onKill={() => setKillConfirm(true)}/>}
      {killConfirm && <KillConfirmDialog enable={!data.system?.killSwitch} action={action} onClose={(outcome) => { if (outcome?.evidence) notify?.(outcome.evidence); setKillConfirm(false); }} />} {/* 已熔断时应走解除流程(审计 L5) */}
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {busy && <div className="busyIndicator"><Activity size={13} /> {t("执行中", "Working")}</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
