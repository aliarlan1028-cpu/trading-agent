import { Boxes, CircleAlert, GitCommitHorizontal, ReceiptText, Waypoints } from "lucide-react";
import { resourceTone, validatedTruthMode } from "./AccountWorkspace.jsx";

const unavailable = "Unavailable";
const validIdentity = (value) => typeof value === "string"
  && value.length > 0 && value.length <= 240 && value === value.trim()
  && !/[\p{White_Space}\p{Cc}]/u.test(value)
  && !["unavailable", "unknown", "n/a", "—"].includes(value.toLowerCase());
const text = (value) => typeof value === "string" && value ? value : unavailable;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const number = (value) => finite(value) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value) : unavailable;
const availabilityState = (availability) => typeof availability?.state === "string" && availability.state ? availability.state : "absent";
const availabilityCount = (rows, state) => state === "loaded" ? rows.length : unavailable;
const availabilityCopy = (label, state, loadedEmpty) => {
  if (state === "loaded") return loadedEmpty;
  if (state === "invalid") return `${label}事实不可用。`;
  if (state === "loading" || state === "processing") return `${label}正在加载。`;
  if (state === "failed") return `${label}加载失败。`;
  if (state === "forbidden") return `${label}无权限读取。`;
  if (state === "disabled") return `${label}当前已禁用。`;
  if (state === "stale" || state === "degraded") return `${label}状态非最新，请刷新。`;
  return `${label}明确未加载。`;
};

export function orderSelectionCandidate(order) {
  return validIdentity(order?.id)
    ? { id: order.id, type: "Order", workspaceId: "account", route: "tradeLedger", sourceSection: "cockpit" }
    : null;
}

export function executionWorkspaceSelectionCandidate(order) {
  return validIdentity(order?.id)
    ? { id: order.id, type: "Execution", workspaceId: "account", route: "executionReview", sourceSection: "cockpit" }
    : null;
}

function selectedOrderFor(model, selection) {
  if (!validIdentity(selection?.object?.id)) return null;
  const source = selection.object.type === "Execution"
    ? model?.execution?.orders
    : selection.object.type === "Order" ? model?.orders : [];
  const matches = (Array.isArray(source) ? source : []).filter((row) => row.id === selection.object.id);
  return matches.length === 1 ? { row: matches[0], type: selection.object.type } : null;
}

function Lane({ kind, rows, availability, selection, onSelect }) {
  const executionLane = kind === "Execution";
  const candidateFor = executionLane ? executionWorkspaceSelectionCandidate : orderSelectionCandidate;
  const label = executionLane ? "Execution 意图" : "Order 交易所事实";
  const state = availabilityState(availability);
  return (
    <section className="kordynV2OrderLane" data-kordyn-v2-execution-lane={executionLane ? "true" : undefined} data-kordyn-v2-order-lane={executionLane ? undefined : "true"} aria-label={executionLane ? "执行意图" : "交易所订单"}>
      <header><span>{executionLane ? <Waypoints aria-hidden="true" /> : <Boxes aria-hidden="true" />}<h2>{label}</h2></span><em>{availabilityCount(rows, state)}</em></header>
      <div>
        {rows.map((row) => {
          const candidate = candidateFor(row);
          if (!candidate) return null;
          const selected = selection?.object?.type === candidate.type && selection.object.id === candidate.id;
          return <button key={candidate.id} type="button" data-kordyn-v2-object-id={candidate.id} data-kordyn-v2-object-type={candidate.type} aria-pressed={selected} data-selected={selected} onClick={(event) => onSelect(candidate, event)}><span><strong>{text(row.symbol)}</strong><em>{text(row.status)}</em></span><small>{candidate.type} {candidate.id}</small><small>{executionLane ? `Plan ${text(row.planId)}` : `${text(row.exchange)} · ${text(row.orderType)}`}</small></button>;
        })}
        {!rows.length && <p>{availabilityCopy(label, state, `当前没有可用的 ${kind} 对象。`)}</p>}
      </div>
    </section>
  );
}

function OrderTruth({ selected, model, headingRef = null, mobile = false, onSelect = () => {} }) {
  if (!selected) return <section className="kordynV2ExecutionTruth is-empty"><CircleAlert aria-hidden="true" /><span><h2 ref={headingRef} tabIndex={mobile ? -1 : undefined}>选择执行或订单</h2><p>分别查看执行意图与交易所接受事实。</p></span></section>;
  const { row, type } = selected;
  const linkedFills = (Array.isArray(model?.fills) ? model.fills : []).filter((fill) => fill.executionOrderId === row.executionOrderId || fill.executionOrderId === row.id || fill.orderId === row.id);
  return (
    <section className={`kordynV2ExecutionTruth${mobile ? " is-mobile" : ""}`} data-kordyn-v2-object-id={row.id} data-kordyn-v2-object-type={type}>
      <header><span><GitCommitHorizontal aria-hidden="true" /><h2 ref={headingRef} tabIndex={mobile ? -1 : undefined}>{text(row.symbol)} · {type}</h2></span><em>{text(row.status)}</em></header>
      <p className="kordynV2ExecutionLead">交易所接受不代表成交或财务最终性。Execution 是系统意图与控制对象，Order 是交易所返回的委托事实。</p>
      <dl className="kordynV2ExecutionFacts">
        <div><dt>交易所 / 账户</dt><dd>{text(row.exchange)} / {text(row.accountId)}</dd></div>
        <div><dt>方向 / 类型</dt><dd>{text(row.side || row.direction)} / {text(row.orderType)}</dd></div>
        <div><dt>请求数量</dt><dd>{number(row.quantity)}</dd></div>
        <div><dt>已成交</dt><dd>{number(row.filledQuantity)}</dd></div>
        <div><dt>剩余数量</dt><dd>{number(row.remainingQuantity)}</dd></div>
        <div><dt>委托价格</dt><dd>{number(row.price ?? row.entryPrice)}</dd></div>
        <div><dt>平均成交价</dt><dd>{number(row.averageFillPrice)}</dd></div>
        <div><dt>Reduce-only</dt><dd>{typeof row.reduceOnly === "boolean" ? row.reduceOnly ? "是" : "否" : unavailable}</dd></div>
        <div><dt>客户端 ID</dt><dd>{text(row.clientOrderId)}</dd></div>
        <div><dt>交易所 ID</dt><dd>{text(row.exchangeOrderId)}</dd></div>
        <div><dt>创建时间</dt><dd>{text(row.createdAt)}</dd></div>
        <div><dt>更新时间</dt><dd>{text(row.updatedAt)}</dd></div>
      </dl>
      <section className="kordynV2ExecutionBoundary"><ReceiptText aria-hidden="true" /><span><strong>当前最终性</strong><p>{text(row.finality || (type === "Execution" ? "执行状态，不代表交易所或财务最终性" : null))}</p></span><em>{linkedFills.length} fills</em></section>
      {!!linkedFills.length && <div className="kordynV2ExecutionRelatedRows">{linkedFills.map((fill) => {
        const candidate = { id: fill.id, type: "Fill", workspaceId: "account", route: "tradeLedger", sourceSection: "cockpit" };
        return <button key={fill.id} type="button" data-kordyn-v2-object-id={fill.id} data-kordyn-v2-object-type="Fill" onClick={() => onSelect(candidate)}><span>Fill {fill.id}</span><b>{number(fill.quantity)} @ {number(fill.price)}</b></button>;
      })}</div>}
    </section>
  );
}

function OrderInspector({ selected }) {
  const row = selected?.row;
  return (
    <aside className={`kordynV2ExecutionInspector${row ? "" : " is-empty"}`} aria-label="订单关联证据">
      <header><span><GitCommitHorizontal aria-hidden="true" /><h2>关联与来源</h2></span></header>
      {row ? <dl>
        <div><dt>对象类型</dt><dd>{selected.type}</dd></div>
        <div><dt>Execution</dt><dd>{text(selected.type === "Execution" ? row.id : row.executionOrderId)}</dd></div>
        <div><dt>Trade plan</dt><dd>{text(row.planId)}</dd></div>
        <div><dt>Position</dt><dd>{text(row.positionId)}</dd></div>
        <div><dt>来源</dt><dd>{text(row.source || row.exchange)}</dd></div>
        <div><dt>状态</dt><dd>{text(row.status)}</dd></div>
      </dl> : <p>选择对象后查看来源与显式关联。</p>}
      <footer className="kordynV2ExecutionNotice"><CircleAlert aria-hidden="true" /><p>当前没有部署取消或改单动作；此处只呈现权威订单事实。</p></footer>
    </aside>
  );
}

export function OrderWorkspace({ model, truth, state, selection, onSelect = () => {} }) {
  const executions = Array.isArray(model?.execution?.orders) ? model.execution.orders : [];
  const orders = Array.isArray(model?.orders) ? model.orders : [];
  const selected = selectedOrderFor(model, selection);
  return (
    <div className="kordynV2ExecutionWorkspace" data-kordyn-v2-execution-workspace="orders" data-kordyn-v2-truth-mode={validatedTruthMode(truth?.mode)}>
      <header className="kordynV2AccountWorkspaceTitle"><span><h1>订单</h1><small>系统执行意图与交易所委托事实</small></span><em role="status" data-resource-tone={resourceTone(state?.kind)}>{text(state?.kind)}</em></header>
      <div className="kordynV2OrderWorkbench"><div className="kordynV2OrderLanes"><Lane kind="Execution" rows={executions} availability={model?.availability?.executionOrders} selection={selection} onSelect={onSelect} /><Lane kind="Order" rows={orders} availability={model?.availability?.orders} selection={selection} onSelect={onSelect} /></div><OrderTruth selected={selected} model={model} onSelect={onSelect} /><OrderInspector selected={selected} /></div>
    </div>
  );
}

export { Lane, OrderInspector, OrderTruth, selectedOrderFor };
