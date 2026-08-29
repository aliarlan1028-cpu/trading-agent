import { ArrowRight, CalendarDays, FileSearch, Newspaper, Radar, Sparkles } from "lucide-react";
import { useState } from "react";
import { AiDialogPrompt } from "./AiDialogPrompt.jsx";
import { signalSelectionCandidate } from "./AiSignalsWorkspace.jsx";
import { contextPresentationAttributes, runAiContextRowInteraction } from "./contextInteraction.js";
import { aiContextActionDetail, aiContextActionLabel, canRememberIntelligence, memoryPayloadForFact, useAiContextAction } from "./contextActions.js";

const unavailable = "Unavailable";
const safe = (value) => value === null || value === undefined || value === "" ? unavailable : String(value);
const typeFor = (row) => row?.kind === "event" ? "Event" : "Signal";
const titleFor = (row) => safe(row?.title || row?.shortTitle || row?.name || row?.symbol || row?.identity);

function selectedSignal(model, selection) {
  const rows = Array.isArray(model?.intelligence) ? model.intelligence : [];
  const id = selection?.object?.id;
  const type = selection?.object?.type;
  return rows.find((row) => row.id === id && typeFor(row) === type) || rows[0] || null;
}

export function MobileAiSignalsScreen({ model, actions = {}, actionsDisabled = false, selection, onSelect = () => {}, onOpenDialog = () => {}, onOpenProof = () => {} }) {
  const rows = Array.isArray(model?.intelligence) ? model.intelligence : [];
  const [inspected, setInspected] = useState(null);
  const selected = inspected && rows.includes(inspected) ? inspected : selectedSignal(model, selection);
  const memoryAction = useAiContextAction("memory", selected?.id);
  const selectedType = selected ? typeFor(selected) : "Signal";
  const canRemember = canRememberIntelligence({ row: selected, type: selectedType, selection, actions, actionsDisabled });
  const memoryDetail = aiContextActionDetail("memory", memoryAction.state.result);
  return (
    <div className="kordynV2AiMobile kordynV2AiMobileContextFlow" data-kordyn-v2-layout="signals-task-flow" data-kordyn-v2-destination="ai/intelligence">
      <section className="kordynV2AiMobileContextHero" data-kordyn-v2-selected-context={selected?.id || unavailable}>
        <header><span><Radar size={20} aria-hidden="true" /></span><div><h1>当前情报</h1><p>Signal 只进入 AI 分析上下文</p></div><em>{selected ? typeFor(selected) : unavailable}</em></header>
        {selected ? <>
          <article {...contextPresentationAttributes(selected, typeFor(selected))}><span aria-hidden="true">{selected.kind === "event" ? <CalendarDays size={19} /> : selected.kind === "news" ? <Newspaper size={19} /> : <Sparkles size={19} />}</span><div><strong>{titleFor(selected)}</strong><small>{safe(selected.provider || selected.sourceName || selected.source)}</small></div></article>
          <dl><div><dt>新鲜度</dt><dd>{safe(selected.observedAt || selected.publishedAt || selected.updatedAt)}</dd></div><div><dt>影响</dt><dd>{safe(selected.impactLabel || selected.changePct)}</dd></div><div><dt>对象</dt><dd>{safe(selected.id)}</dd></div></dl>
          <p>{safe(selected.summary || selected.description || selected.narrative?.summary)}</p>
          <footer><button className="kordynV2AiMobileAction" type="button" disabled={selected.selectable !== true} onClick={() => onSelect(signalSelectionCandidate(selected))}>设为当前对象<ArrowRight size={16} aria-hidden="true" /></button><button className="kordynV2AiMobileAction" type="button" aria-haspopup="dialog" data-kordyn-v2-context-proof={selected.selectable === true ? selected.id : undefined} disabled={selected.selectable !== true} onClick={(event) => onOpenProof(event.currentTarget, { panel: "proof", candidate: signalSelectionCandidate(selected) })}><FileSearch size={16} aria-hidden="true" />Proof</button><button className="kordynV2AiMobileAction" type="button" data-kordyn-v2-context-action="remember" disabled={!canRemember || memoryAction.state.kind === "processing"} onClick={() => memoryAction.run(() => actions.rememberIntelligence(memoryPayloadForFact(selected)))}>{aiContextActionLabel(memoryAction.state, { idle: "加入 AI 上下文", processing: "正在写入…", succeeded: "已写入上下文", partial: "写入结果不完整", failed: "写入失败" })}</button></footer>
          {memoryAction.state.kind !== "idle" && <p className="kordynV2AiActionOutcome" role="status" data-kordyn-v2-action-state={memoryAction.state.kind}>{memoryAction.state.kind === "succeeded" ? "服务器已形成记忆事实。" : memoryAction.state.kind === "processing" ? "等待权威响应。" : "服务器没有确认写入。"}{memoryDetail !== unavailable && <small>{memoryDetail}</small>}</p>}
        </> : <p className="kordynV2AiContextEmpty">当前没有已形成情报。</p>}
      </section>
      <section className="kordynV2AiMobileContextList"><header><h2>其他情报</h2><span>{rows.length}</span></header>{rows.filter((row) => row !== selected).map((row, index) => <button className="kordynV2AiMobileAction" type="button" {...contextPresentationAttributes(row, typeFor(row))} aria-disabled={row.selectable !== true} key={`signal-presentation-${index}`} onClick={() => runAiContextRowInteraction({ row, type: typeFor(row), onInspect: setInspected, onSelect, candidateFor: signalSelectionCandidate })}><span><strong>{titleFor(row)}</strong><small>{safe(row.provider || row.sourceName || row.source)}</small></span><em>{safe(row.kind)}</em><ArrowRight size={16} aria-hidden="true" /></button>)}{rows.length <= 1 && <p>{rows.length ? "没有其他已加载情报。" : unavailable}</p>}</section>
      <AiDialogPrompt mobile onOpen={onOpenDialog} />
    </div>
  );
}
