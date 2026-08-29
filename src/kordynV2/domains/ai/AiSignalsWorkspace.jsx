import { ArrowRight, Bot, CalendarDays, FileSearch, Newspaper, Radar, Sparkles } from "lucide-react";
import { useState } from "react";
import { contextPresentationAttributes, runAiContextRowInteraction } from "./contextInteraction.js";
import { aiContextActionDetail, aiContextActionLabel, canRememberIntelligence, memoryPayloadForFact, useAiContextAction } from "./contextActions.js";

const unavailable = "Unavailable";
const safe = (value) => value === null || value === undefined || value === "" ? unavailable : String(value);
const signalType = (row) => row?.kind === "event" ? "Event" : "Signal";
const routeFor = (row) => row?.kind === "event" ? "eventsTasks:events" : "intelligence";
const sourceFor = (row) => row?.kind === "event" ? "operationsCenter" : "operationsCenter";
const candidateFor = (row) => ({
  id: row.id,
  type: signalType(row),
  workspaceId: "ai",
  route: routeFor(row),
  sourceSection: sourceFor(row),
  evidence: row.evidenceId || row.observedAt || row.updatedAt || row.id
});
const titleFor = (row) => safe(row?.title || row?.shortTitle || row?.name || row?.symbol || row?.identity);
const sourceLabel = (row) => safe(row?.provider || row?.sourceName || row?.source);

function selectedSignal(model, selection) {
  const rows = Array.isArray(model?.intelligence) ? model.intelligence : [];
  const type = selection?.object?.type;
  const id = selection?.object?.id;
  return rows.find((row) => row.id === id && signalType(row) === type) || rows[0] || null;
}

export function AiSignalsWorkspace({ model, actions = {}, actionsDisabled = false, selection, onSelect = () => {}, onOpenProof = () => {} }) {
  const rows = Array.isArray(model?.intelligence) ? model.intelligence : [];
  const [inspected, setInspected] = useState(null);
  const selected = inspected && rows.includes(inspected) ? inspected : selectedSignal(model, selection);
  const memoryAction = useAiContextAction("memory", selected?.id);
  const selectedType = selected ? signalType(selected) : "Signal";
  const canRemember = canRememberIntelligence({ row: selected, type: selectedType, selection, actions, actionsDisabled });
  const memoryDetail = aiContextActionDetail("memory", memoryAction.state.result);
  const missionSummary = Array.isArray(model?.missions) ? model.missions[0] : null;
  const watchSummary = Array.isArray(model?.watches) ? model.watches[0] : null;
  const eventSummary = Array.isArray(model?.events) ? model.events[0] : null;
  const counts = {
    all: rows.length,
    news: rows.filter((row) => row.kind === "news").length,
    market: rows.filter((row) => row.kind === "market_mover").length,
    event: rows.filter((row) => row.kind === "event").length,
    knowledge: rows.filter((row) => row.kind === "knowledge").length
  };
  return (
    <div className="kordynV2AiContextWorkspace kordynV2AiSignalsWorkspace" data-kordyn-v2-layout="signals-registry-inspector" data-kordyn-v2-destination="ai/intelligence">
      <header className="kordynV2AiWorkspaceTitle">
        <span><Radar size={20} aria-hidden="true" /><h1 data-kordyn-v2-destination-title>AI 情报</h1></span>
        <em role="status"><i aria-hidden="true" />{rows.length ? `${rows.length} 条已形成事实` : unavailable}</em>
      </header>
      <div className="kordynV2AiSignalWorkbench">
        <aside className="kordynV2AiContextFilter" aria-label="情报分类">
          <h2>情报范围</h2>
          {[['全部', counts.all], ['快讯', counts.news], ['市场', counts.market], ['事件', counts.event], ['知识', counts.knowledge]].map(([label, count], index) => (
            <span className={index === 0 ? "is-current" : ""} key={label}><b>{label}</b><em>{count}</em></span>
          ))}
          <p>Signal 只进入分析上下文；不会直接生成订单。</p>
        </aside>
        <section className="kordynV2AiContextRegistry" aria-label="正在影响 AI 的情报">
          <header><h2>正在影响 AI 的事实</h2><span>权威来源优先</span></header>
          <div>
            {rows.map((row, index) => {
              const type = signalType(row);
              const selectable = row.selectable === true;
              return (
                <button
                  className={selected?.id === row.id && signalType(selected) === type ? "is-selected" : ""}
                  type="button"
                  key={`${type}-presentation-${index}`}
                  {...contextPresentationAttributes(row, type)}
                  aria-disabled={!selectable}
                  onClick={() => runAiContextRowInteraction({ row, type, onInspect: setInspected, onSelect, candidateFor })}
                >
                  <span className="kordynV2AiContextIcon" aria-hidden="true">{row.kind === "event" ? <CalendarDays size={16} /> : row.kind === "news" ? <Newspaper size={16} /> : <Sparkles size={16} />}</span>
                  <span><strong>{titleFor(row)}</strong><small>{sourceLabel(row)} · {safe(row.observedAt || row.publishedAt || row.updatedAt)}</small></span>
                  <em>{safe(row.impactLabel || row.kind)}</em>
                </button>
              );
            })}
            {!rows.length && <p className="kordynV2AiContextEmpty">当前没有已形成的情报事实。缺失不代表为零。</p>}
          </div>
        </section>
        <article className="kordynV2AiContextInspector" data-kordyn-v2-selected-context={selected?.id || unavailable}>
          <header><span><Bot size={18} aria-hidden="true" /></span><div><h2>{selected ? titleFor(selected) : "选择一条情报"}</h2><p>{selected ? sourceLabel(selected) : unavailable}</p></div><em>{selected ? signalType(selected) : unavailable}</em></header>
          {selected ? <>
            <dl>
              <div><dt>来源</dt><dd>{sourceLabel(selected)}</dd></div>
              <div><dt>新鲜度</dt><dd>{safe(selected.observedAt || selected.publishedAt || selected.updatedAt)}</dd></div>
              <div><dt>影响资产</dt><dd>{safe((selected.relatedSymbols || selected.symbols || [selected.symbol]).filter(Boolean).join(" · "))}</dd></div>
              <div><dt>影响</dt><dd>{safe(selected.impactLabel || selected.changePct)}</dd></div>
            </dl>
            <section><h3>证据与描述</h3><p>{safe(selected.summary || selected.description || selected.narrative?.summary)}</p></section>
            <footer>
              <button type="button" disabled={selected.selectable !== true} onClick={() => onSelect(candidateFor(selected))}>设为当前对象<ArrowRight size={15} aria-hidden="true" /></button>
              <button type="button" aria-haspopup="dialog" data-kordyn-v2-context-proof={selected.selectable === true ? selected.id : undefined} disabled={selected.selectable !== true} onClick={(event) => onOpenProof(event.currentTarget, { panel: "proof", candidate: candidateFor(selected) })}><FileSearch size={15} aria-hidden="true" />查看 Proof</button>
              <button type="button" data-kordyn-v2-context-action="remember" disabled={!canRemember || memoryAction.state.kind === "processing"} onClick={() => memoryAction.run(() => actions.rememberIntelligence(memoryPayloadForFact(selected)))}>{aiContextActionLabel(memoryAction.state, { idle: "加入 AI 上下文", processing: "正在写入…", succeeded: "已写入上下文", partial: "写入结果不完整", failed: "写入失败" })}</button>
            </footer>
            {memoryAction.state.kind !== "idle" && <p className="kordynV2AiActionOutcome" role="status" data-kordyn-v2-action-state={memoryAction.state.kind}>服务器结果：{memoryAction.state.kind === "succeeded" ? "已形成记忆事实" : memoryAction.state.kind === "processing" ? "等待权威响应" : memoryAction.state.kind === "partial" ? "返回部分结果" : "未确认写入"}{memoryDetail !== unavailable && <small>{memoryDetail}</small>}</p>}
          </> : <p className="kordynV2AiContextEmpty">{unavailable}</p>}
        </article>
      </div>
      <section className="kordynV2AiSignalRelations" data-kordyn-v2-relationship-lens="signal-context" aria-label="情报与 AI 行动边界关系">
        <article><span>AI 任务状态 / 行动边界</span><strong>{missionSummary ? safe(missionSummary.title) : unavailable}</strong><p>{missionSummary ? safe(missionSummary.stage?.label || missionSummary.nextAction) : "当前没有已形成任务。"}</p><em>Signal 不等于 Plan；只进入下一轮分析。</em></article>
        <article><span>观察哨状态</span><strong>{watchSummary ? titleFor(watchSummary) : unavailable}</strong><p>{watchSummary ? safe(watchSummary.status) : "当前没有已加载观察哨。"}</p><em>摘要未建立对象级关联；命中后重新分析。</em></article>
        <article><span>事件日历摘要</span><strong>{eventSummary ? titleFor(eventSummary) : unavailable}</strong><p>{eventSummary ? safe(eventSummary.due || eventSummary.startAt) : "当前没有已形成事件。"}</p><em>{eventSummary?.timePrecision === "date" ? "官方仅确认日期；未建立对象级关联" : "按权威来源精度显示；未建立对象级关联"}</em></article>
      </section>
    </div>
  );
}

export { candidateFor as signalSelectionCandidate };
