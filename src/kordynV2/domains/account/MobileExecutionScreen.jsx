import { ArrowLeft, BookOpen, Check, ChevronRight, FileText, GitCommitHorizontal, ReceiptText, Scale, Waypoints } from "lucide-react";
import { FillEvidence, FillTruth, closedTradeSelectionCandidate, fillSelectionCandidate, reviewSelectionCandidate, selectedFillObject } from "./FillWorkspace.jsx";
import { OrderInspector, OrderTruth, executionWorkspaceSelectionCandidate, orderSelectionCandidate, selectedOrderFor } from "./OrderWorkspace.jsx";
import { PlanEvidence, PlanTruth, planSelectionCandidate, runPlanDecision, selectedPlanFor } from "./PlanWorkspace.jsx";

const unavailable = "Unavailable";
const text = (value) => typeof value === "string" && value ? value : unavailable;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const number = (value) => finite(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value) : unavailable;

function selectedCandidate(selection, candidate) {
  return selection?.object?.type === candidate?.type && selection.object.id === candidate?.id;
}

function MobileRow({ candidate, selection, returnFocusRef, onSelect, icon: Icon, title, meta, value, tone }) {
  if (!candidate) return null;
  const selected = selectedCandidate(selection, candidate);
  return (
    <button
      ref={selected ? returnFocusRef : null}
      type="button"
      className="kordynV2ExecutionMobileRow"
      data-kordyn-v2-object-id={candidate.id}
      data-kordyn-v2-object-type={candidate.type}
      data-selected={selected}
      aria-pressed={selected}
      onClick={(event) => onSelect(candidate, event)}
    >
      <Icon size={17} aria-hidden="true" />
      <span><strong>{title}</strong><small>{meta}</small></span>
      <b data-row-tone={tone || "neutral"}>{value}</b>
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

function PlanList({ model, selection, returnFocusRef, onSelect }) {
  const rows = Array.isArray(model?.plans) ? model.plans : [];
  const state = model?.availability?.plans?.state || "absent";
  return (
    <section className="kordynV2ExecutionMobileList" aria-label="移动交易计划">
      <header><span><FileText size={18} aria-hidden="true" /><h2>计划</h2></span><em>{state === "loaded" ? rows.length : unavailable}</em></header>
      {rows.map((row) => (
        <MobileRow
          key={row.id}
          candidate={planSelectionCandidate(row)}
          selection={selection}
          returnFocusRef={returnFocusRef}
          onSelect={onSelect}
          icon={FileText}
          title={`${text(row.symbol)} · Trade plan`}
          meta={`${text(row.strategy)} · ${text(row.createdAt)}`}
          value={row.status === "awaiting_approval" ? "需要确认" : text(row.status)}
          tone={row.approval?.valid ? "warning" : "neutral"}
        />
      ))}
      {!rows.length && <p role="status">{state === "loaded" ? "当前没有交易计划。" : "交易计划明确未加载。"}</p>}
    </section>
  );
}

function OrderList({ model, selection, returnFocusRef, onSelect }) {
  const executions = Array.isArray(model?.execution?.orders) ? model.execution.orders : [];
  const orders = Array.isArray(model?.orders) ? model.orders : [];
  return (
    <div className="kordynV2ExecutionMobileStack">
      <section className="kordynV2ExecutionMobileList" aria-label="移动 Execution 列表">
        <header><span><Waypoints size={18} aria-hidden="true" /><h2>Execution 意图</h2></span><em>{executions.length}</em></header>
        {executions.map((row) => (
          <MobileRow
            key={row.id}
            candidate={executionWorkspaceSelectionCandidate(row)}
            selection={selection}
            returnFocusRef={returnFocusRef}
            onSelect={onSelect}
            icon={Waypoints}
            title={`${text(row.symbol)} · Execution`}
            meta={`Plan ${text(row.planId)} · ${text(row.createdAt)}`}
            value={text(row.status)}
          />
        ))}
        {!executions.length && <p role="status">当前没有可用 Execution 对象。</p>}
      </section>
      <section className="kordynV2ExecutionMobileList" aria-label="移动 Order 列表">
        <header><span><GitCommitHorizontal size={18} aria-hidden="true" /><h2>Order 交易所事实</h2></span><em>{orders.length}</em></header>
        {orders.map((row) => (
          <MobileRow
            key={row.id}
            candidate={orderSelectionCandidate(row)}
            selection={selection}
            returnFocusRef={returnFocusRef}
            onSelect={onSelect}
            icon={GitCommitHorizontal}
            title={`${text(row.symbol)} · Order`}
            meta={`${text(row.exchange)} · ${text(row.orderType)} · ${text(row.updatedAt)}`}
            value={text(row.status)}
          />
        ))}
        {!orders.length && <p role="status">当前没有可用 Order 对象。</p>}
      </section>
    </div>
  );
}

function FillList({ model, selection, returnFocusRef, onSelect }) {
  const fills = Array.isArray(model?.fills) ? model.fills : [];
  const closedTrades = Array.isArray(model?.closedTrades) ? model.closedTrades : [];
  const reviews = Array.isArray(model?.reviews) ? model.reviews : [];
  return (
    <div className="kordynV2ExecutionMobileStack">
      <section className="kordynV2ExecutionMobileList" aria-label="移动 Fill 列表">
        <header><span><ReceiptText size={18} aria-hidden="true" /><h2>Fill 流水</h2></span><em>{fills.length}</em></header>
        {fills.map((row) => (
          <MobileRow
            key={row.id}
            candidate={fillSelectionCandidate(row)}
            selection={selection}
            returnFocusRef={returnFocusRef}
            onSelect={onSelect}
            icon={ReceiptText}
            title={`${text(row.symbol)} · Fill`}
            meta={`${text(row.kind)} · ${number(row.quantity)} @ ${number(row.price)}`}
            value={number(row.grossRealizedPnl)}
            tone={finite(row.grossRealizedPnl) && row.grossRealizedPnl < 0 ? "critical" : finite(row.grossRealizedPnl) ? "healthy" : "neutral"}
          />
        ))}
        {!fills.length && <p role="status">当前没有成交。</p>}
      </section>
      <section className="kordynV2ExecutionMobileList" aria-label="移动 Closed trade 列表">
        <header><span><Scale size={18} aria-hidden="true" /><h2>Closed trade</h2></span><em>{closedTrades.length}</em></header>
        {closedTrades.map((row) => (
          <MobileRow
            key={row.id}
            candidate={closedTradeSelectionCandidate(row)}
            selection={selection}
            returnFocusRef={returnFocusRef}
            onSelect={onSelect}
            icon={Scale}
            title={`${text(row.symbol)} · Closed trade`}
            meta={text(row.financialBasis)}
            value={number(row.netRealizedPnl)}
            tone={finite(row.netRealizedPnl) && row.netRealizedPnl < 0 ? "critical" : finite(row.netRealizedPnl) ? "healthy" : "neutral"}
          />
        ))}
        {!closedTrades.length && <p role="status">完整生命周期明确未加载或暂无记录。</p>}
      </section>
      <section className="kordynV2ExecutionMobileList" aria-label="移动 Review 列表">
        <header><span><BookOpen size={18} aria-hidden="true" /><h2>Review</h2></span><em>{reviews.length}</em></header>
        {reviews.map((row) => (
          <MobileRow
            key={row.id}
            candidate={reviewSelectionCandidate(row)}
            selection={selection}
            returnFocusRef={returnFocusRef}
            onSelect={onSelect}
            icon={BookOpen}
            title={`${text(row.symbol)} · Review`}
            meta={text(row.summary || row.title)}
            value={text(row.status)}
          />
        ))}
        {!reviews.length && <p role="status">暂无真实交易复盘对象。</p>}
      </section>
    </div>
  );
}

function MobileDetail({ workspaceId, model, selection, actions, actionsDisabled, headingRef, onSelect }) {
  if (workspaceId === "plans") {
    const plan = selectedPlanFor(model, selection);
    const decide = (kind) => runPlanDecision({ kind, plan, actions, actionsDisabled });
    return (
      <div className="kordynV2ExecutionMobileDetail">
        <PlanTruth plan={plan} headingRef={headingRef} mobile />
        <PlanEvidence plan={plan} actions={actions} actionsDisabled={actionsDisabled} actionState={null} onDecision={decide} onSelect={onSelect} />
      </div>
    );
  }
  if (workspaceId === "orders") {
    const selected = selectedOrderFor(model, selection);
    return (
      <div className="kordynV2ExecutionMobileDetail">
        <OrderTruth selected={selected} model={model} headingRef={headingRef} mobile onSelect={onSelect} />
        <OrderInspector selected={selected} />
      </div>
    );
  }
  const selected = selectedFillObject(model, selection);
  return (
    <div className="kordynV2ExecutionMobileDetail">
      <FillTruth selected={selected} headingRef={headingRef} mobile />
      <FillEvidence selected={selected} actionsDisabled={actionsDisabled} onSelect={onSelect} onOpenPoster={() => {}} posterTriggerRef={null} />
    </div>
  );
}

export function MobileExecutionScreen({
  workspaceId,
  model,
  selection,
  actions = {},
  actionsDisabled = false,
  view = "list",
  onSelect = () => {},
  onOpenList = () => {},
  detailHeadingRef = null,
  returnFocusRef = null
}) {
  const label = workspaceId === "plans" ? "计划" : workspaceId === "orders" ? "订单" : "成交";
  if (view === "detail") {
    return (
      <div className="kordynV2ExecutionMobile" data-kordyn-v2-execution-mobile-view="detail" data-kordyn-v2-execution-mobile-workspace={workspaceId}>
        <header className="kordynV2ExecutionMobileNav">
          <button type="button" data-kordyn-v2-execution-back={workspaceId} onClick={(event) => onOpenList(event)}><ArrowLeft size={18} aria-hidden="true" />{label}列表</button>
          <span><Check size={15} aria-hidden="true" />对象分离</span>
        </header>
        <MobileDetail workspaceId={workspaceId} model={model} selection={selection} actions={actions} actionsDisabled={actionsDisabled} headingRef={detailHeadingRef} onSelect={onSelect} />
      </div>
    );
  }
  return (
    <div className="kordynV2ExecutionMobile" data-kordyn-v2-execution-mobile-view="list" data-kordyn-v2-execution-mobile-workspace={workspaceId}>
      <header className="kordynV2ExecutionMobileHeading"><h2>{label}</h2><p>计划、执行、订单、成交、复盘与已平仓结果保持不同对象身份。</p></header>
      {workspaceId === "plans"
        ? <PlanList model={model} selection={selection} returnFocusRef={returnFocusRef} onSelect={onSelect} />
        : workspaceId === "orders"
          ? <OrderList model={model} selection={selection} returnFocusRef={returnFocusRef} onSelect={onSelect} />
          : <FillList model={model} selection={selection} returnFocusRef={returnFocusRef} onSelect={onSelect} />}
    </div>
  );
}
