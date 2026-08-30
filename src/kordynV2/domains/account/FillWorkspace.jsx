import { BookOpen, CircleAlert, Download, GitBranch, ReceiptText, Scale } from "lucide-react";
import { useRef, useState } from "react";
import { resourceTone, validatedTruthMode } from "./AccountWorkspace.jsx";
import { ClosedTradeOutputSheet } from "./ClosedTradeOutputSheet.jsx";

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

function candidate(row, type, route) {
  return validIdentity(row?.id) ? { id: row.id, type, workspaceId: "account", route, sourceSection: "cockpit" } : null;
}

export const fillSelectionCandidate = (row) => candidate(row, "Fill", "tradeLedger");
export const closedTradeSelectionCandidate = (row) => candidate(row, "Closed trade", "tradeLedger");
export const reviewSelectionCandidate = (row) => candidate(row, "Review", "labReviews");

function selectedFillObject(model, selection) {
  if (!validIdentity(selection?.object?.id)) return null;
  const mapping = {
    Fill: model?.fills,
    "Closed trade": model?.closedTrades,
    Review: model?.reviews
  };
  const source = mapping[selection.object.type];
  const matches = (Array.isArray(source) ? source : []).filter((row) => row.id === selection.object.id);
  return matches.length === 1 ? { type: selection.object.type, row: matches[0] } : null;
}

function FillRegistry({ model, selection, onSelect }) {
  const rows = Array.isArray(model?.fills) ? model.fills : [];
  const state = availabilityState(model?.availability?.fills);
  return (
    <section className="kordynV2ExecutionRegistry" aria-label="成交流水">
      <header><h2>不可变 Fill 流水</h2><span>{availabilityCount(rows, state)}</span></header>
      <div>{rows.map((row) => {
        const item = fillSelectionCandidate(row);
        if (!item) return null;
        const selected = selection?.object?.type === item.type && selection.object.id === item.id;
        return <button key={item.id} type="button" data-kordyn-v2-object-id={item.id} data-kordyn-v2-object-type="Fill" aria-pressed={selected} data-selected={selected} onClick={(event) => onSelect(item, event)}><span><strong>{text(row.symbol)}</strong><em>{text(row.kind)}</em></span><b>{number(row.quantity)} @ {number(row.price)}</b><small>{row.id} · {text(row.createdAt)}</small><small>{text(row.source)} · fee {number(row.feeUsdt)}</small></button>;
      })}{!rows.length && <p role="status">{availabilityCopy("成交流水", state, "当前没有成交。")}</p>}</div>
    </section>
  );
}

function ClosedTradeRegistry({ model, selection, onSelect }) {
  const rows = Array.isArray(model?.closedTrades) ? model.closedTrades : [];
  const state = availabilityState(model?.availability?.closedTrades);
  return (
    <section className="kordynV2ClosedTradeRegistry" aria-label="已平仓生命周期">
      <header><span><Scale aria-hidden="true" /><h2>已平仓生命周期</h2></span><em>{availabilityCount(rows, state)}</em></header>
      <div>{rows.map((row) => {
        const item = closedTradeSelectionCandidate(row);
        if (!item) return null;
        const selected = selection?.object?.type === item.type && selection.object.id === item.id;
        return <button key={item.id} type="button" data-kordyn-v2-object-id={item.id} data-kordyn-v2-object-type="Closed trade" aria-pressed={selected} data-selected={selected} onClick={(event) => onSelect(item, event)}><span><strong>{text(row.symbol)}</strong><em>{row.finality === "finance_reconciled" ? "财务已对账" : "财务未完成"}</em></span><b data-pnl-tone={finite(row.netRealizedPnl) && row.netRealizedPnl < 0 ? "negative" : finite(row.netRealizedPnl) ? "positive" : "unavailable"}>{number(row.netRealizedPnl)}</b><small>{text(row.financialBasis)}</small></button>;
      })}{!rows.length && <p role="status">{availabilityCopy("完整生命周期", state, "暂无完整平仓生命周期。")}</p>}</div>
    </section>
  );
}

function FillTruth({ selected, headingRef = null, mobile = false }) {
  if (!selected) return <section className="kordynV2ExecutionTruth is-empty"><CircleAlert aria-hidden="true" /><span><h2 ref={headingRef} tabIndex={mobile ? -1 : undefined}>选择成交或生命周期</h2><p>Fill 与 Closed trade 是不同权威对象。</p></span></section>;
  const { row, type } = selected;
  const closed = type === "Closed trade";
  const review = type === "Review";
  return (
    <section className={`kordynV2ExecutionTruth${mobile ? " is-mobile" : ""}`} data-kordyn-v2-object-id={row.id} data-kordyn-v2-object-type={type}>
      <header><span>{review ? <BookOpen aria-hidden="true" /> : <ReceiptText aria-hidden="true" />}<h2 ref={headingRef} tabIndex={mobile ? -1 : undefined}>{text(row.symbol)} · {type}</h2></span><em>{text(row.status || row.kind || row.finality)}</em></header>
      <p className="kordynV2ExecutionLead">{closed ? "完整生命周期按服务器记录的价格盈亏、开仓费、平仓费与资金费展示净结果。" : review ? "复盘是独立的学习对象，不替代成交或财务对账。" : "Fill 证明交易所成交；它本身不证明整笔交易已完成财务对账。"}</p>
      <dl className="kordynV2ExecutionFacts">
        <div><dt>对象 ID</dt><dd>{row.id}</dd></div>
        <div><dt>Execution</dt><dd>{text(row.executionOrderId)}</dd></div>
        <div><dt>Trade plan</dt><dd>{text(row.planId)}</dd></div>
        <div><dt>Lifecycle</dt><dd>{text(row.tradeLifecycleKey)}</dd></div>
        <div><dt>数量</dt><dd>{number(row.quantity)}</dd></div>
        <div><dt>{closed ? "退出价格" : "成交价格"}</dt><dd>{number(closed ? row.exitPrice : row.price)}</dd></div>
        <div><dt>价格毛盈亏</dt><dd>{number(row.grossRealizedPnl)}</dd></div>
        <div><dt>开仓费</dt><dd>{number(row.entryFeeUsdt)}</dd></div>
        <div><dt>平仓费</dt><dd>{number(closed ? row.closeFeeUsdt : row.feeUsdt)}</dd></div>
        <div><dt>资金费</dt><dd>{number(row.fundingFeeUsdt)}</dd></div>
        <div><dt>净实现盈亏</dt><dd>{number(row.netRealizedPnl)}</dd></div>
        <div><dt>事实时间</dt><dd>{text(row.completedAt || row.createdAt)}</dd></div>
      </dl>
      {closed && <section className="kordynV2ExecutionBoundary"><Scale aria-hidden="true" /><span><strong>财务基础</strong><p>{text(row.financialBasis)}</p></span><em data-tone={row.finality === "finance_reconciled" ? "healthy" : "warning"}>{row.finality === "finance_reconciled" ? "已完成" : "未完成"}</em></section>}
    </section>
  );
}

function FillEvidence({ selected, actionsDisabled, onSelect, onOpenPoster, posterTriggerRef }) {
  const row = selected?.row;
  const review = row?.review;
  const closedTrade = selected?.type === "Closed trade" ? row : row?.closedTrade;
  return (
    <aside className={`kordynV2ExecutionInspector${row ? "" : " is-empty"}`} aria-label="成交关联证据与输出">
      <header><span><GitBranch aria-hidden="true" /><h2>关联与结果</h2></span></header>
      {row ? <>
        <dl>
          <div><dt>当前对象</dt><dd>{selected.type} {row.id}</dd></div>
          <div><dt>Review</dt><dd>{text(review?.id)}</dd></div>
          <div><dt>Closed trade</dt><dd>{text(closedTrade?.id)}</dd></div>
          <div><dt>Fill IDs</dt><dd>{closedTrade?.fillIds?.join(" · ") || unavailable}</dd></div>
          <div><dt>Poster boundary</dt><dd>{text(closedTrade?.poster?.state)}</dd></div>
        </dl>
        {reviewSelectionCandidate(review) && <button type="button" className="kordynV2ExecutionRelatedLink" data-kordyn-v2-object-id={review.id} data-kordyn-v2-object-type="Review" onClick={() => onSelect(reviewSelectionCandidate(review))}><BookOpen aria-hidden="true" />打开真实 Review</button>}
        {closedTradeSelectionCandidate(closedTrade) && selected.type !== "Closed trade" && <button type="button" className="kordynV2ExecutionRelatedLink" data-kordyn-v2-object-id={closedTrade.id} data-kordyn-v2-object-type="Closed trade" onClick={() => onSelect(closedTradeSelectionCandidate(closedTrade))}><Scale aria-hidden="true" />查看已平仓生命周期</button>}
        <button ref={posterTriggerRef} type="button" className="kordynV2ExecutionPrimaryAction" disabled={actionsDisabled || closedTrade?.poster?.state !== "eligible"} onClick={() => onOpenPoster(closedTrade)}><Download aria-hidden="true" />下载服务端 PNG</button>
        <p className="kordynV2ExecutionFootnote">下载动作不会声明自动生成、翻译或消息投递成功。</p>
      </> : <p>选择 Fill、Closed trade 或 Review 后查看显式关联。</p>}
    </aside>
  );
}

export function FillWorkspace({ model, truth, state, selection, actions = {}, actionsDisabled = false, onSelect = () => {} }) {
  const selected = selectedFillObject(model, selection);
  const [posterTrade, setPosterTrade] = useState(null);
  const posterTriggerRef = useRef(null);
  return (
    <div className="kordynV2ExecutionWorkspace" data-kordyn-v2-execution-workspace="fills" data-kordyn-v2-truth-mode={validatedTruthMode(truth?.mode)}>
      <header className="kordynV2AccountWorkspaceTitle"><span><h1>成交</h1><small>不可变 Fill、完整生命周期与复盘入口</small></span><em role="status" data-resource-tone={resourceTone(state?.kind)}>{text(state?.kind)}</em></header>
      <div className="kordynV2FillWorkbench"><div className="kordynV2FillRegistries"><FillRegistry model={model} selection={selection} onSelect={onSelect} /><ClosedTradeRegistry model={model} selection={selection} onSelect={onSelect} /></div><FillTruth selected={selected} /><FillEvidence selected={selected} actionsDisabled={actionsDisabled} onSelect={onSelect} onOpenPoster={setPosterTrade} posterTriggerRef={posterTriggerRef} /></div>
      {posterTrade && <ClosedTradeOutputSheet closedTrade={posterTrade} actions={actions} actionsDisabled={actionsDisabled} onClose={() => setPosterTrade(null)} returnFocus={posterTriggerRef.current} />}
    </div>
  );
}

export { ClosedTradeRegistry, FillEvidence, FillRegistry, FillTruth, selectedFillObject };
