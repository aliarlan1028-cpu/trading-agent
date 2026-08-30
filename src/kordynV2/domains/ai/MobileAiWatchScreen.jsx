import { ArrowRight, Eye, FileSearch, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AiDialogPrompt } from "./AiDialogPrompt.jsx";
import { watchSelectionCandidate } from "./AiWatchWorkspace.jsx";
import { contextPresentationAttributes, runAiContextRowInteraction } from "./contextInteraction.js";
import { aiContextActionDetail, aiContextActionLabel, canCancelWatch, useAiContextAction } from "./contextActions.js";

const unavailable = "Unavailable";
const safe = (value) => value === null || value === undefined || value === "" ? unavailable : String(value);
const titleFor = (row) => safe(row?.title || row?.analysisTitle || row?.displayThesis || row?.thesis || row?.symbol || row?.identity);

function selectedWatch(model, selection) {
  const rows = Array.isArray(model?.watches) ? model.watches : [];
  const id = selection?.object?.type === "Watch" ? selection.object.id : null;
  return rows.find((row) => row.id === id) || rows[0] || null;
}

export function MobileAiWatchScreen({ model, actions = {}, actionsDisabled = false, selection, onSelect = () => {}, onOpenDialog = () => {}, onOpenProof = () => {} }) {
  const rows = Array.isArray(model?.watches) ? model.watches : [];
  const [inspected, setInspected] = useState(null);
  const selected = inspected && rows.includes(inspected) ? inspected : selectedWatch(model, selection);
  const cancelAction = useAiContextAction("watch", selected?.id);
  const canCancel = canCancelWatch({ row: selected, selection, actions, actionsDisabled });
  const cancelDetail = aiContextActionDetail("watch", cancelAction.state.result);
  return (
    <div className="kordynV2AiMobile kordynV2AiMobileContextFlow" data-kordyn-v2-layout="watch-task-flow" data-kordyn-v2-destination="ai/watch">
      <p className="kordynV2AiWatchBoundary"><ShieldCheck size={17} aria-hidden="true" /><span><strong>命中后重新分析</strong>观察哨命中不会自动下单。</span></p>
      <section className="kordynV2AiMobileContextHero" data-kordyn-v2-selected-context={selected?.id || unavailable}>
        <header><span><Eye size={20} aria-hidden="true" /></span><div><h1>当前观察哨</h1><p>{selected ? safe(selected.symbol) : unavailable}</p></div><em>{selected ? safe(selected.status) : unavailable}</em></header>
        {selected ? <>
          <article {...contextPresentationAttributes(selected, "Watch")}><span><Eye size={19} aria-hidden="true" /></span><div><strong>{titleFor(selected)}</strong><small>{safe(selected.thesis || selected.displayThesis)}</small></div></article>
          <dl><div><dt>策略</dt><dd>{safe(selected.strategyName)}</dd></div><div><dt>事件</dt><dd>{safe(selected.eventWindow)}</dd></div><div><dt>状态</dt><dd>{safe(selected.status)}</dd></div></dl>
          <footer><button className="kordynV2AiMobileAction" type="button" disabled={selected.selectable !== true} onClick={() => onSelect(watchSelectionCandidate(selected))}>设为当前对象<ArrowRight size={16} aria-hidden="true" /></button><button className="kordynV2AiMobileAction" type="button" aria-haspopup="dialog" data-kordyn-v2-context-proof={selected.selectable === true ? selected.id : undefined} disabled={selected.selectable !== true} onClick={(event) => onOpenProof(event.currentTarget, { panel: "proof", candidate: watchSelectionCandidate(selected) })}><FileSearch size={16} aria-hidden="true" />Proof</button><button className="kordynV2AiMobileAction" type="button" data-kordyn-v2-context-action="cancel-watch" disabled={!canCancel || cancelAction.state.kind === "processing"} onClick={() => cancelAction.run(() => actions.cancelWatch(selected.id, selected.symbol))}>{aiContextActionLabel(cancelAction.state, { idle: "撤销观察哨", processing: "等待服务器…", succeeded: "撤销已确认", partial: "撤销结果不完整", failed: "撤销未确认" })}</button></footer>
          {cancelAction.state.kind !== "idle" && <p className="kordynV2AiActionOutcome" role="status" data-kordyn-v2-action-state={cancelAction.state.kind}>{cancelAction.state.kind === "succeeded" ? "服务器已确认撤销；列表等待权威刷新。" : cancelAction.state.kind === "processing" ? "正在等待确认；观察哨保持可见。" : "服务器没有确认撤销；观察哨保持可见。"}{cancelDetail !== unavailable && <small>{cancelDetail}</small>}</p>}
        </> : <p className="kordynV2AiContextEmpty">暂无已加载观察哨。</p>}
      </section>
      <section className="kordynV2AiMobileContextList"><header><h2>其他观察哨</h2><span>{rows.length}</span></header>{rows.filter((row) => row !== selected).map((row, index) => <button className="kordynV2AiMobileAction" type="button" {...contextPresentationAttributes(row, "Watch")} key={`watch-presentation-${index}`} onClick={() => runAiContextRowInteraction({ row, type: "Watch", onInspect: setInspected, onSelect, candidateFor: watchSelectionCandidate })}><span><strong>{titleFor(row)}</strong><small>{safe(row.symbol)} · {safe(row.status)}</small></span><ArrowRight size={16} aria-hidden="true" /></button>)}{rows.length <= 1 && <p>{rows.length ? "没有其他已加载观察哨。" : unavailable}</p>}</section>
      <AiDialogPrompt mobile onOpen={onOpenDialog} />
    </div>
  );
}
