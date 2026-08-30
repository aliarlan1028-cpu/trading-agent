import { Activity, ArrowRight, Eye, FileSearch, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { AiDialogPrompt } from "./AiDialogPrompt.jsx";
import { contextPresentationAttributes, runAiContextRowInteraction } from "./contextInteraction.js";
import { aiContextActionDetail, aiContextActionLabel, canCancelWatch, useAiContextAction } from "./contextActions.js";

const unavailable = "Unavailable";
const safe = (value) => value === null || value === undefined || value === "" ? unavailable : String(value);
const candidateFor = (row) => ({
  id: row.id,
  type: "Watch",
  workspaceId: "ai",
  route: "watch",
  sourceSection: "chat",
  evidence: row.evidenceId || row.updatedAt || row.id
});
const titleFor = (row) => safe(row?.title || row?.analysisTitle || row?.displayThesis || row?.thesis || row?.symbol || row?.identity);

function selectedWatch(model, selection) {
  const rows = Array.isArray(model?.watches) ? model.watches : [];
  const id = selection?.object?.type === "Watch" ? selection.object.id : null;
  return rows.find((row) => row.id === id) || rows[0] || null;
}

export function AiWatchWorkspace({ model, actions = {}, actionsDisabled = false, selection, onSelect = () => {}, onOpenDialog = () => {}, onOpenProof = () => {} }) {
  const rows = Array.isArray(model?.watches) ? model.watches : [];
  const [inspected, setInspected] = useState(null);
  const selected = inspected && rows.includes(inspected) ? inspected : selectedWatch(model, selection);
  const cancelAction = useAiContextAction("watch", selected?.id);
  const canCancel = canCancelWatch({ row: selected, selection, actions, actionsDisabled });
  const cancelDetail = aiContextActionDetail("watch", cancelAction.state.result);
  return (
    <div className="kordynV2AiContextWorkspace kordynV2AiWatchWorkspace" data-kordyn-v2-layout="watch-registry-inspector" data-kordyn-v2-destination="ai/watch">
      <header className="kordynV2AiWorkspaceTitle"><span><Eye size={20} aria-hidden="true" /><h1 data-kordyn-v2-destination-title>观察哨</h1></span><em role="status"><i aria-hidden="true" />{rows.length ? `${rows.length} 个已加载观察哨` : unavailable}</em></header>
      <p className="kordynV2AiWatchBoundary"><ShieldCheck size={17} aria-hidden="true" /><span><strong>命中后重新分析</strong>观察哨命中会启动新一轮 AI 分析，不会自动下单。</span></p>
      <div className="kordynV2AiWatchWorkbench">
        <section className="kordynV2AiContextRegistry" aria-label="观察哨列表">
          <header><h2>观察哨</h2><span>生命周期事实</span></header>
          <div>{rows.map((row, index) => (
            <button
              type="button"
              className={selected?.id === row.id ? "is-selected" : ""}
              {...contextPresentationAttributes(row, "Watch")}
              key={`watch-presentation-${index}`}
              onClick={() => runAiContextRowInteraction({ row, type: "Watch", onInspect: setInspected, onSelect, candidateFor })}
            >
              <span className="kordynV2AiContextIcon"><Activity size={16} aria-hidden="true" /></span>
              <span><strong>{titleFor(row)}</strong><small>{safe(row.symbol)} · {safe(row.updatedAt)}</small></span>
              <em>{safe(row.status)}</em>
            </button>
          ))}{!rows.length && <p className="kordynV2AiContextEmpty">暂无已加载观察哨。</p>}</div>
        </section>
        <article className="kordynV2AiContextInspector kordynV2AiWatchInspector" data-kordyn-v2-selected-context={selected?.id || unavailable}>
          <header><span><Eye size={18} aria-hidden="true" /></span><div><h2>{selected ? titleFor(selected) : "选择观察哨"}</h2><p>{selected ? safe(selected.symbol) : unavailable}</p></div><em>{selected ? safe(selected.status) : unavailable}</em></header>
          {selected ? <>
            <section className="kordynV2AiWatchThesis"><h3>当前监控</h3><p>{safe(selected.thesis || selected.displayThesis || selected.condition)}</p></section>
            <dl>
              <div><dt>策略</dt><dd>{safe(selected.strategyName)}</dd></div>
              <div><dt>事件窗口</dt><dd>{safe(selected.eventWindow)}</dd></div>
              <div><dt>知识证据</dt><dd>{safe(selected.knowledgeSource)}</dd></div>
              <div><dt>能力</dt><dd>{safe(Array.isArray(selected.capabilities) ? selected.capabilities.join(" · ") : selected.capabilities)}</dd></div>
            </dl>
            <footer><button type="button" disabled={selected.selectable !== true} onClick={() => onSelect(candidateFor(selected))}>设为当前对象<ArrowRight size={15} aria-hidden="true" /></button><button type="button" aria-haspopup="dialog" data-kordyn-v2-context-proof={selected.selectable === true ? selected.id : undefined} disabled={selected.selectable !== true} onClick={(event) => onOpenProof(event.currentTarget, { panel: "proof", candidate: candidateFor(selected) })}><FileSearch size={15} aria-hidden="true" />查看 Proof</button><button type="button" data-kordyn-v2-context-action="cancel-watch" disabled={!canCancel || cancelAction.state.kind === "processing"} onClick={() => cancelAction.run(() => actions.cancelWatch(selected.id, selected.symbol))}>{aiContextActionLabel(cancelAction.state, { idle: "撤销观察哨", processing: "等待服务器…", succeeded: "撤销已确认", partial: "撤销结果不完整", failed: "撤销未确认" })}</button></footer>
            {cancelAction.state.kind !== "idle" && <p className="kordynV2AiActionOutcome" role="status" data-kordyn-v2-action-state={cancelAction.state.kind}>{cancelAction.state.kind === "succeeded" ? "服务器已确认撤销；列表仍等待下一次权威刷新。" : cancelAction.state.kind === "processing" ? "正在等待服务器确认；当前观察哨保持可见。" : "服务器没有确认撤销；当前观察哨保持可见。"}{cancelDetail !== unavailable && <small>{cancelDetail}</small>}</p>}
          </> : <p className="kordynV2AiContextEmpty">{unavailable}</p>}
        </article>
        <aside className="kordynV2AiWatchLifecycle"><h2>真实边界</h2><ol><li><b>1</b><span>条件命中</span></li><li><b>2</b><span>重新读取市场与账户事实</span></li><li><b>3</b><span>形成新的分析或 Plan 候选</span></li><li><b>4</b><span>仍由授权和硬风控决定</span></li></ol><p>观察哨绝不会直接提交订单。</p></aside>
      </div>
      <div className="kordynV2AiContextPrompt"><AiDialogPrompt onOpen={onOpenDialog} /></div>
    </div>
  );
}

export { candidateFor as watchSelectionCandidate };
