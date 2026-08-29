import { ArrowRight, Bot, CalendarDays, FileSearch, Newspaper, Radar, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { AiDialogPrompt } from "./AiDialogPrompt.jsx";
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

const signalFilter = (row) => row?.kind === "event"
  ? "event"
  : row?.kind === "market_mover" ? "market" : row?.kind === "knowledge" ? "knowledge" : "news";

export function filterIntelligenceRows(rows, filter) {
  const source = Array.isArray(rows) ? rows : [];
  return filter === "all" ? source : source.filter((row) => signalFilter(row) === filter);
}

function selectedSignal(rows, selection) {
  const type = selection?.object?.type;
  const id = selection?.object?.id;
  return rows.find((row) => row.id === id && signalType(row) === type) || rows[0] || null;
}

export function AiSignalsWorkspace({ model, actions = {}, actionsDisabled = false, selection, onSelect = () => {}, onOpenDialog = () => {}, onOpenProof = () => {} }) {
  const rows = Array.isArray(model?.intelligence) ? model.intelligence : [];
  const [activeFilter, setActiveFilter] = useState("all");
  const [inspected, setInspected] = useState(null);
  const visibleRows = useMemo(() => filterIntelligenceRows(rows, activeFilter), [activeFilter, rows]);
  const selected = inspected && visibleRows.includes(inspected) ? inspected : selectedSignal(visibleRows, selection);
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
  const filterRows = [
    ["all", "全部", counts.all],
    ["news", "快讯", counts.news],
    ["market", "市场", counts.market],
    ["event", "事件", counts.event],
    ["knowledge", "知识", counts.knowledge]
  ];
  const sourceCount = new Set(rows.map((row) => sourceLabel(row)).filter((value) => value !== unavailable)).size;
  const selectableCount = rows.filter((row) => row.selectable === true).length;
  const newestFact = rows.map((row) => row.observedAt || row.publishedAt || row.updatedAt || row.startAt).filter(Boolean).sort().at(-1) || unavailable;
  return (
    <div className="kordynV2AiContextWorkspace kordynV2AiSignalsWorkspace" data-kordyn-v2-layout="signals-registry-inspector" data-kordyn-v2-destination="ai/intelligence">
      <header className="kordynV2AiWorkspaceTitle">
        <span><Radar size={20} aria-hidden="true" /><h1 data-kordyn-v2-destination-title>AI 情报</h1></span>
        <em role="status"><i aria-hidden="true" />{rows.length ? `${rows.length} 条已形成事实` : unavailable}</em>
      </header>
      <section className="kordynV2AiSignalSummary" data-kordyn-v2-signal-summary aria-label="情报事实摘要">
        <span><small>已加载事实</small><strong>{rows.length}</strong></span>
        <span><small>权威来源</small><strong>{sourceCount || unavailable}</strong></span>
        <span><small>可形成对象</small><strong>{selectableCount}</strong></span>
        <span><small>最新事实</small><strong>{newestFact}</strong></span>
        <em>这些是已加载事实的只读摘要，不代表置信度或执行授权。</em>
      </section>
      <div className="kordynV2AiSignalWorkbench">
        <aside className="kordynV2AiContextFilter" aria-label="情报分类">
          <h2>情报范围</h2>
          {filterRows.map(([filter, label, count]) => (
            <button className={activeFilter === filter ? "is-current" : ""} type="button" data-kordyn-v2-signal-filter={filter} aria-pressed={activeFilter === filter} key={filter} onClick={() => { setActiveFilter(filter); setInspected(null); }}><b>{label}</b><em>{count}</em></button>
          ))}
          <p>Signal 只进入分析上下文；不会直接生成订单。</p>
        </aside>
        <section className="kordynV2AiContextRegistry" aria-label="正在影响 AI 的情报">
          <header><h2>正在影响 AI 的事实</h2><span>权威来源优先</span></header>
          <div>
            {visibleRows.map((row, index) => {
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
            {!visibleRows.length && <p className="kordynV2AiContextEmpty">当前筛选没有已形成的情报事实。缺失不代表为零。</p>}
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
      <section className="kordynV2AiSignalDecisionFlow" data-kordyn-v2-relationship-lens="signal-decision-flow" aria-label="情报到 AI 决策的关系">
        <span><b>Signal / 情报</b><small>来源、市场、事件与知识事实</small></span>
        <ArrowRight size={18} aria-hidden="true" />
        <span><b>AI 任务 / 重新分析</b><small>{missionSummary ? safe(missionSummary.stage?.label) : "当前没有已形成任务"}</small></span>
        <ArrowRight size={18} aria-hidden="true" />
        <span><b>行动边界</b><small>计划 / 观察哨 / 不行动</small></span>
        <em>情报不会直接下单</em>
      </section>
      <section className="kordynV2AiSignalRelations" data-kordyn-v2-signal-operational-context data-kordyn-v2-relationship-lens="signal-context" aria-label="情报的真实运行上下文">
        <article><span>AI 任务状态 / 行动边界</span><strong>{missionSummary ? safe(missionSummary.title) : unavailable}</strong><p>{missionSummary ? safe(missionSummary.stage?.label || missionSummary.nextAction) : "当前没有已形成任务。"}</p><em>Signal 不等于 Plan；只进入下一轮分析。</em></article>
        <article><span>观察哨状态</span><strong>{watchSummary ? titleFor(watchSummary) : unavailable}</strong><p>{watchSummary ? safe(watchSummary.status) : "当前没有已加载观察哨。"}</p><em>摘要未建立对象级关联；命中后重新分析。</em></article>
        <article><span>事件日历摘要</span><strong>{eventSummary ? titleFor(eventSummary) : unavailable}</strong><p>{eventSummary ? safe(eventSummary.due || eventSummary.startAt) : "当前没有已形成事件。"}</p><em>{eventSummary?.timePrecision === "date" ? "官方仅确认日期；未建立对象级关联" : "按权威来源精度显示；未建立对象级关联"}</em></article>
      </section>
      <div className="kordynV2AiContextPrompt"><AiDialogPrompt onOpen={onOpenDialog} /></div>
    </div>
  );
}

export { candidateFor as signalSelectionCandidate };
