import { ArrowRight, CalendarDays, Clock3, FileSearch, RefreshCw } from "lucide-react";
import { useState } from "react";
import { AiDialogPrompt } from "./AiDialogPrompt.jsx";
import { contextPresentationAttributes, runAiContextRowInteraction } from "./contextInteraction.js";
import { aiContextActionDetail, aiContextActionLabel, canRefreshEvents, useAiContextAction } from "./contextActions.js";

const unavailable = "Unavailable";
const safe = (value) => value === null || value === undefined || value === "" ? unavailable : String(value);
const candidateFor = (row) => ({
  id: row.id,
  type: "Event",
  workspaceId: "ai",
  route: "eventsTasks:events",
  sourceSection: "operationsCenter",
  evidence: row.evidenceId || row.updatedAt || row.startAt || row.due || row.id
});
const titleFor = (row) => safe(row?.title || row?.shortTitle || row?.name || row?.identity);
const momentFor = (row) => safe(row?.due || row?.startAt);

function selectedEvent(model, selection) {
  const rows = Array.isArray(model?.events) ? model.events : [];
  const id = selection?.object?.type === "Event" ? selection.object.id : null;
  return rows.find((row) => row.id === id) || rows[0] || null;
}

export function AiEventsWorkspace({ model, actions = {}, actionsDisabled = false, selection, onSelect = () => {}, onOpenDialog = () => {}, onOpenProof = () => {} }) {
  const rows = Array.isArray(model?.events) ? model.events : [];
  const [inspected, setInspected] = useState(null);
  const selected = inspected && rows.includes(inspected) ? inspected : selectedEvent(model, selection);
  const refreshAction = useAiContextAction("events", null);
  const canRefresh = canRefreshEvents({ selection, actions, actionsDisabled });
  const refreshDetail = aiContextActionDetail("events", refreshAction.state.result);
  return (
    <div className="kordynV2AiContextWorkspace kordynV2AiEventsWorkspace" data-kordyn-v2-layout="events-calendar-inspector" data-kordyn-v2-destination="ai/events">
      <header className="kordynV2AiWorkspaceTitle"><span><CalendarDays size={20} aria-hidden="true" /><h1 data-kordyn-v2-destination-title>事件日历</h1></span><em role="status"><i aria-hidden="true" />{rows.length ? `${rows.length} 个已形成事件` : unavailable}</em></header>
      <div className="kordynV2AiEventsControls">
        <div className="kordynV2AiEventsToolbar"><p>这里读取已形成 Event 事实；来源配置与测试位于系统治理。</p><button type="button" data-kordyn-v2-context-action="refresh-events" disabled={!canRefresh || refreshAction.state.kind === "processing"} onClick={() => refreshAction.run(() => actions.refreshEvents())}><RefreshCw size={15} aria-hidden="true" />{aiContextActionLabel(refreshAction.state, { idle: "刷新事件来源", processing: "正在刷新来源…", succeeded: "来源刷新完成", partial: "来源部分刷新", failed: "来源刷新失败" })}</button></div>
        {refreshAction.state.kind !== "idle" && <p className="kordynV2AiActionOutcome" role="status" data-kordyn-v2-action-state={refreshAction.state.kind}>{refreshAction.state.kind === "succeeded" ? "事件来源刷新已由服务器确认；新事实以随后载入结果为准。" : refreshAction.state.kind === "processing" ? "服务器正在刷新已配置的事件来源。" : refreshAction.state.kind === "partial" ? "部分来源未完成；不会宣称情报已全部再生成。" : "服务器未确认事件来源刷新。"}{refreshDetail !== unavailable && <small>{refreshDetail}</small>}</p>}
      </div>
      <div className="kordynV2AiEventsWorkbench">
        <section className="kordynV2AiContextRegistry kordynV2AiEventsRegistry" aria-label="事件日历列表"><header><h2>时间序列</h2><span>日期精度保持原样</span></header><div>{rows.map((row, index) => (
          <button type="button" className={selected === row ? "is-selected" : ""} {...contextPresentationAttributes(row, "Event")} aria-disabled={row.selectable !== true} key={`event-presentation-${index}`} onClick={() => runAiContextRowInteraction({ row, type: "Event", onInspect: setInspected, onSelect, candidateFor })}>
            <time><Clock3 size={14} aria-hidden="true" />{momentFor(row)}</time><span><strong>{titleFor(row)}</strong><small>{safe(row.provider || row.sourceName || row.source)}</small></span><em>{row.timePrecision === "date" ? "仅日期" : safe(row.impactLabel)}</em>
          </button>
        ))}{!rows.length && <p className="kordynV2AiContextEmpty">当前没有已形成事件。不会用计划任务或风险窗口伪造日历行。</p>}</div></section>
        <article className="kordynV2AiContextInspector kordynV2AiEventInspector" data-kordyn-v2-selected-context={selected?.id || unavailable}>
          <header><span><CalendarDays size={18} aria-hidden="true" /></span><div><h2>{selected ? titleFor(selected) : "选择一个事件"}</h2><p>{selected ? safe(selected.provider || selected.sourceName || selected.source) : unavailable}</p></div><em>{selected ? safe(selected.impactLabel) : unavailable}</em></header>
          {selected ? <><dl><div><dt>日期 / 时间</dt><dd>{momentFor(selected)}</dd></div><div><dt>时间精度</dt><dd>{selected.timePrecision === "date" ? "官方仅确认日期" : safe(selected.timePrecision)}</dd></div><div><dt>影响资产</dt><dd>{safe((selected.relatedSymbols || selected.symbols || []).join(" · "))}</dd></div><div><dt>影响</dt><dd>{safe(selected.impactLabel)}</dd></div></dl><section><h3>事件说明</h3><p>{safe(selected.description)}</p></section><footer><button type="button" disabled={selected.selectable !== true} onClick={() => onSelect(candidateFor(selected))}>设为当前对象<ArrowRight size={15} aria-hidden="true" /></button><button type="button" aria-haspopup="dialog" data-kordyn-v2-context-proof={selected.selectable === true ? selected.id : undefined} disabled={selected.selectable !== true} onClick={(event) => onOpenProof(event.currentTarget, { panel: "proof", candidate: candidateFor(selected) })}><FileSearch size={15} aria-hidden="true" />查看 Proof</button></footer></> : <p className="kordynV2AiContextEmpty">{unavailable}</p>}
        </article>
      </div>
      <div className="kordynV2AiContextPrompt"><AiDialogPrompt onOpen={onOpenDialog} /></div>
    </div>
  );
}

export { candidateFor as eventSelectionCandidate };
