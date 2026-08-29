import { ArrowRight, Bot, CalendarDays, FileSearch, Newspaper, Radar, RotateCcw, Sparkles } from "lucide-react";
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
  if (typeof filter === "string") return filter === "all" ? source : source.filter((row) => signalFilter(row) === filter);
  const scope = filter && typeof filter === "object" ? filter : {};
  const category = scope.category || "all";
  const time = scope.time || "all";
  const availability = scope.availability || "all";
  const now = Number.isFinite(Date.parse(scope.now)) ? Date.parse(scope.now) : Date.now();
  return source.filter((row) => {
    if (category !== "all" && signalFilter(row) !== category) return false;
    if (availability === "selectable" && row?.selectable !== true) return false;
    if (availability === "readonly" && row?.selectable === true) return false;
    if (time === "all") return true;
    const observedAt = row?.observedAt || row?.publishedAt || row?.updatedAt;
    const observed = Date.parse(observedAt);
    if (time === "unavailable") return !Number.isFinite(observed);
    if (!Number.isFinite(observed)) return false;
    const age = now - observed;
    if (age < 0) return false;
    if (time === "24h") return age <= 24 * 60 * 60 * 1000;
    if (time === "7d") return age <= 7 * 24 * 60 * 60 * 1000;
    return true;
  });
}

const watchCandidate = (row) => ({ id: row.id, type: "Watch", workspaceId: "ai", route: "watch", sourceSection: "chat", evidence: row.evidenceId || row.updatedAt || row.id });
const eventCandidate = (row) => ({ id: row.id, type: "Event", workspaceId: "ai", route: "eventsTasks:events", sourceSection: "operationsCenter", evidence: row.evidenceId || row.updatedAt || row.startAt || row.due || row.id });
const operationCandidate = (row, type) => type === "Watch" ? watchCandidate(row) : type === "Event" ? eventCandidate(row) : candidateFor(row);
const observedFor = (row) => safe(row?.observedAt || row?.publishedAt || row?.updatedAt);
const availabilityLabel = (row) => row?.selectable === true ? "可形成对象" : "只读事实";

function SignalOperationTable({ kind, title, rows, selectedId, onInspect = () => {}, onSelect }) {
  const source = Array.isArray(rows) ? rows : [];
  return (
    <section className="kordynV2AiSignalOperation" data-kordyn-v2-signal-operation={kind}>
      <header><h2>{title}</h2><span>{source.length}</span></header>
      <div>
        {source.map((row, index) => {
          const type = kind === "watch" ? "Watch" : kind === "event" ? "Event" : signalType(row);
          const moment = type === "Event" ? safe(row.due || row.startAt) : observedFor(row);
          const locallyInspectable = kind === "intelligence";
          return (
            <button
              className={locallyInspectable && selectedId === row.id ? "is-selected" : ""}
              type="button"
              {...(locallyInspectable ? { "data-kordyn-v2-signal-overview-id": row.id || undefined } : contextPresentationAttributes(row, type))}
              aria-disabled={locallyInspectable ? false : row.selectable !== true}
              aria-pressed={locallyInspectable ? selectedId === row.id : undefined}
              key={`${kind}-operation-${index}`}
              onClick={() => locallyInspectable ? onInspect(row) : runAiContextRowInteraction({ row, type, onInspect: () => {}, onSelect, candidateFor: (value) => operationCandidate(value, type) })}
            >
              <span><strong>{titleFor(row)}</strong><small>{type === "Watch" ? safe(row.symbol) : sourceLabel(row)} · {moment}</small></span>
              <em>{type === "Watch" ? safe(row.status) : type === "Event" ? safe(row.impactLabel || row.timePrecision) : availabilityLabel(row)}</em>
            </button>
          );
        })}
        {!source.length && <p>{unavailable}</p>}
      </div>
    </section>
  );
}

function selectedSignal(rows, selection) {
  const type = selection?.object?.type;
  const id = selection?.object?.id;
  return rows.find((row) => row.id === id && signalType(row) === type) || rows[0] || null;
}

export function AiSignalsWorkspace({ model, actions = {}, actionsDisabled = false, selection, onSelect = () => {}, onOpenDialog = () => {}, onOpenProof = () => {} }) {
  const rows = Array.isArray(model?.intelligence) ? model.intelligence : [];
  const [filters, setFilters] = useState({ category: "all", time: "all", availability: "all" });
  const [inspected, setInspected] = useState(null);
  const visibleRows = useMemo(() => filterIntelligenceRows(rows, filters), [filters, rows]);
  const selected = inspected && visibleRows.includes(inspected) ? inspected : selectedSignal(visibleRows, selection);
  const memoryAction = useAiContextAction("memory", selected?.id);
  const selectedType = selected ? signalType(selected) : "Signal";
  const canRemember = canRememberIntelligence({ row: selected, type: selectedType, selection, actions, actionsDisabled });
  const memoryDetail = aiContextActionDetail("memory", memoryAction.state.result);
  const missionSummary = Array.isArray(model?.missions) ? model.missions[0] : null;
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
  const timeRows = [["all", "全部时间"], ["24h", "过去 24 小时"], ["7d", "过去 7 天"], ["unavailable", "时间不可用"]];
  const availabilityRows = [["all", "全部对象"], ["selectable", "可形成对象"], ["readonly", "只读事实"]];
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
        <div className="kordynV2AiSignalSummaryActions"><button type="button" onClick={() => setFilters((current) => ({ ...current, availability: "selectable" }))}>只看可形成对象</button><button type="button" onClick={() => setFilters({ category: "all", time: "all", availability: "all" })}><RotateCcw size={13} aria-hidden="true" />重置本地筛选</button></div>
      </section>
      <div className="kordynV2AiSignalWorkbench">
        <aside className="kordynV2AiContextFilter" aria-label="情报分类">
          <section data-kordyn-v2-signal-filter-group="category"><h2>情报范围</h2>{filterRows.map(([filter, label, count]) => (
            <button className={filters.category === filter ? "is-current" : ""} type="button" data-kordyn-v2-signal-filter={filter} aria-pressed={filters.category === filter} key={filter} onClick={() => { setFilters((current) => ({ ...current, category: filter })); setInspected(null); }}><b>{label}</b><em>{count}</em></button>
          ))}</section>
          <section data-kordyn-v2-signal-filter-group="time"><h2>本地时间范围</h2>{timeRows.map(([filter, label]) => <button className={filters.time === filter ? "is-current" : ""} type="button" data-kordyn-v2-signal-time={filter} aria-pressed={filters.time === filter} key={filter} onClick={() => { setFilters((current) => ({ ...current, time: filter })); setInspected(null); }}><b>{label}</b></button>)}</section>
          <section data-kordyn-v2-signal-filter-group="availability"><h2>对象可用性</h2>{availabilityRows.map(([filter, label]) => <button className={filters.availability === filter ? "is-current" : ""} type="button" data-kordyn-v2-signal-availability={filter} aria-pressed={filters.availability === filter} key={filter} onClick={() => { setFilters((current) => ({ ...current, availability: filter })); setInspected(null); }}><b>{label}</b></button>)}</section>
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
                  <span><strong>{titleFor(row)}</strong><small data-kordyn-v2-signal-row-meta><span>{sourceLabel(row)}</span><span>{observedFor(row)}</span><span>{type}</span><span>{availabilityLabel(row)}</span></small></span>
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
              <div><dt>证据 ID</dt><dd>{safe(selected.evidenceId)}</dd></div>
              <div><dt>Context 动作</dt><dd>{selected.selectable === true ? "可设为当前对象" : "只读事实"}</dd></div>
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
        <span><b>AI 任务 / 重新分析 {selected ? titleFor(selected) : unavailable}</b><small>{missionSummary ? safe(missionSummary.stage?.label) : "当前没有已形成任务"}</small></span>
        <ArrowRight size={18} aria-hidden="true" />
        <span><b>行动边界</b><small>Signal 不等于 Plan · 计划 / 观察哨 / 不行动</small></span>
        <em>未建立对象级关联时，情报不会直接下单</em>
      </section>
      <section className="kordynV2AiSignalOperations" data-kordyn-v2-signal-operational-context data-kordyn-v2-relationship-lens="signal-context" aria-label="情报的真实运行上下文">
        <SignalOperationTable kind="watch" title="观察哨" rows={model?.watches} onSelect={onSelect} />
        <SignalOperationTable kind="event" title="事件日历" rows={model?.events} onSelect={onSelect} />
        <SignalOperationTable kind="intelligence" title="情报概览" rows={rows} selectedId={selected?.id} onInspect={setInspected} onSelect={onSelect} />
      </section>
      <div className="kordynV2AiContextPrompt"><AiDialogPrompt onOpen={onOpenDialog} /></div>
    </div>
  );
}

export { candidateFor as signalSelectionCandidate };
