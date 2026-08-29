import { ArrowRight, CalendarDays, Clock3, FileSearch } from "lucide-react";
import { useState } from "react";
import { eventSelectionCandidate } from "./AiEventsWorkspace.jsx";
import { contextPresentationAttributes, runAiContextRowInteraction } from "./contextInteraction.js";
import { aiContextActionDetail, aiContextActionLabel, canRefreshEvents, useAiContextAction } from "./contextActions.js";

const unavailable = "Unavailable";
const safe = (value) => value === null || value === undefined || value === "" ? unavailable : String(value);
const titleFor = (row) => safe(row?.title || row?.shortTitle || row?.name || row?.identity);
const momentFor = (row) => safe(row?.due || row?.startAt);

function selectedEvent(model, selection) {
  const rows = Array.isArray(model?.events) ? model.events : [];
  const id = selection?.object?.type === "Event" ? selection.object.id : null;
  return rows.find((row) => row.id === id) || rows[0] || null;
}

export function MobileAiEventsScreen({ model, actions = {}, actionsDisabled = false, selection, onSelect = () => {}, onOpenProof = () => {} }) {
  const rows = Array.isArray(model?.events) ? model.events : [];
  const [inspected, setInspected] = useState(null);
  const selected = inspected && rows.includes(inspected) ? inspected : selectedEvent(model, selection);
  const refreshAction = useAiContextAction("events", null);
  const canRefresh = canRefreshEvents({ actions, actionsDisabled });
  const refreshDetail = aiContextActionDetail("events", refreshAction.state.result);
  return (
    <div className="kordynV2AiMobile kordynV2AiMobileContextFlow" data-kordyn-v2-layout="events-task-flow" data-kordyn-v2-destination="ai/events">
      <section className="kordynV2AiMobileContextHero" data-kordyn-v2-selected-context={selected?.id || unavailable}>
        <header><span><CalendarDays size={20} aria-hidden="true" /></span><div><h1>当前事件</h1><p>时间精度保持权威来源原样</p></div><em>{selected?.timePrecision === "date" ? "仅日期" : selected ? safe(selected.impactLabel) : unavailable}</em></header>
        {selected ? <>
          <article {...contextPresentationAttributes(selected, "Event")}><span><Clock3 size={19} aria-hidden="true" /></span><div><strong>{titleFor(selected)}</strong><small>{safe(selected.provider || selected.sourceName || selected.source)}</small></div></article>
          <dl><div><dt>日期 / 时间</dt><dd>{momentFor(selected)}</dd></div><div><dt>精度</dt><dd>{selected.timePrecision === "date" ? "官方仅确认日期" : safe(selected.timePrecision)}</dd></div><div><dt>影响</dt><dd>{safe(selected.impactLabel)}</dd></div></dl>
          <p>{safe(selected.description)}</p>
          <footer><button className="kordynV2AiMobileAction" type="button" disabled={selected.selectable !== true} onClick={() => onSelect(eventSelectionCandidate(selected))}>设为当前对象<ArrowRight size={16} aria-hidden="true" /></button><button className="kordynV2AiMobileAction" type="button" aria-haspopup="dialog" data-kordyn-v2-context-proof={selected.selectable === true ? selected.id : undefined} disabled={selected.selectable !== true} onClick={(event) => onOpenProof(event.currentTarget, { panel: "proof", candidate: eventSelectionCandidate(selected) })}><FileSearch size={16} aria-hidden="true" />Proof</button></footer>
        </> : <p className="kordynV2AiContextEmpty">当前没有已形成事件。</p>}
      </section>
      <section className="kordynV2AiMobileContextCommand"><p>刷新仅更新已配置的事件来源，不保证生成新的情报。</p><button className="kordynV2AiMobileAction" type="button" data-kordyn-v2-context-action="refresh-events" disabled={!canRefresh || refreshAction.state.kind === "processing"} onClick={() => refreshAction.run(() => actions.refreshEvents())}>{aiContextActionLabel(refreshAction.state, { idle: "刷新事件来源", processing: "正在刷新来源…", succeeded: "来源刷新完成", partial: "来源部分刷新", failed: "来源刷新失败" })}</button>{refreshAction.state.kind !== "idle" && <p className="kordynV2AiActionOutcome" role="status" data-kordyn-v2-action-state={refreshAction.state.kind}>{refreshAction.state.kind === "succeeded" ? "服务器已确认来源刷新；新事实以随后载入为准。" : refreshAction.state.kind === "processing" ? "服务器正在刷新已配置来源。" : refreshAction.state.kind === "partial" ? "仅部分来源完成。" : "服务器未确认来源刷新。"}{refreshDetail !== unavailable && <small>{refreshDetail}</small>}</p>}</section>
      <section className="kordynV2AiMobileContextList"><header><h2>事件日历</h2><span>{rows.length}</span></header>{rows.filter((row) => row !== selected).map((row, index) => <button className="kordynV2AiMobileAction" type="button" {...contextPresentationAttributes(row, "Event")} aria-disabled={row.selectable !== true} key={`event-presentation-${index}`} onClick={() => runAiContextRowInteraction({ row, type: "Event", onInspect: setInspected, onSelect, candidateFor: eventSelectionCandidate })}><span><strong>{titleFor(row)}</strong><small>{momentFor(row)} · {row.timePrecision === "date" ? "仅日期" : safe(row.impactLabel)}</small></span><ArrowRight size={16} aria-hidden="true" /></button>)}{rows.length <= 1 && <p>{rows.length ? "没有其他已加载事件。" : unavailable}</p>}</section>
    </div>
  );
}
