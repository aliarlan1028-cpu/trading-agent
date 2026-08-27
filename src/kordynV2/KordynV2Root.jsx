import {
  Activity,
  ArrowRight,
  Blocks,
  BookOpen,
  CalendarClock,
  ChartNoAxesCombined,
  CircleCheck,
  Clock3,
  Globe2,
  Link2,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundCheck
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { KORDYN_V2_DOMAINS, KORDYN_V2_WORKSPACES } from "./architecture/domains.js";
import { v2LocationForWorkspace } from "./architecture/routes.js";
import { DesktopShell } from "./shell/DesktopShell.jsx";
import { buildAccountTruth } from "./viewModels/accountTruth.js";
import { createV2Selection } from "./viewModels/selection.js";
import { normalizeResourceState } from "./viewModels/state.js";

const unavailable = "Unavailable";
const asList = (value) => Array.isArray(value) ? value : [];
const safeText = (value, fallback = unavailable) => (
  ["string", "number", "boolean"].includes(typeof value) && value !== "" ? String(value) : fallback
);
const optionalText = (...values) => values
  .map((value) => safeText(value, ""))
  .find(Boolean) || "";
const firstText = (...values) => optionalText(...values) || unavailable;
const normalizedStatus = (value) => typeof value === "string" ? value.toLowerCase() : "unavailable";

function statusLabel(value) {
  const status = normalizedStatus(value);
  return ({
    active: "监控中",
    armed: "已就绪",
    running: "运行中",
    monitoring: "监控中",
    awaiting_approval: "等待授权",
    approved: "已批准",
    completed: "已完成",
    complete: "已完成",
    closed: "已完成",
    failed: "失败",
    blocked: "已阻断"
  })[status] || safeText(value);
}

function clockText(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return unavailable;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function durationText(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return safeText(value);
  const seconds = Math.floor(value / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

const PIPELINE = Object.freeze([
  { label: "全市场快扫", icon: Globe2 },
  { label: "检验市场结构", icon: ChartNoAxesCombined },
  { label: "核对账户", icon: UserRoundCheck },
  { label: "硬风控", icon: ShieldCheck },
  { label: "等待回踩", icon: Clock3 }
]);

const QUEUE_GROUPS = Object.freeze([
  { id: "analysis", label: "正在分析" },
  { id: "monitoring", label: "正在监控" },
  { id: "execution", label: "执行中" },
  { id: "complete", label: "已完成" }
]);

function rowIdentity(row, ...fields) {
  return fields.map((field) => safeText(row?.[field], "")).find(Boolean) || "";
}

function groupForStatus(status, fallback) {
  const value = normalizedStatus(status);
  if (["completed", "complete", "closed", "done", "success"].includes(value)) return "complete";
  if (["submitted", "approved", "executing", "open", "filled", "protecting"].includes(value)) return "execution";
  if (["active", "armed", "monitoring", "awaiting_approval", "waiting"].includes(value)) return "monitoring";
  return fallback;
}

function missionRow(source, type, fallbackGroup) {
  const id = rowIdentity(source, "id", "runId", "positionId", "symbol");
  if (!id) return null;
  const symbol = optionalText(source?.symbol, source?.instId);
  const title = firstText(
    source?.title,
    source?.analysisTitle,
    source?.name,
    source?.displayThesis,
    source?.thesis,
    symbol,
    id
  );
  return {
    id,
    type,
    title,
    symbol,
    subtitle: firstText(source?.summary, source?.rationale, source?.thesis, source?.status),
    status: firstText(source?.status, source?.state),
    group: groupForStatus(source?.status ?? source?.state, fallbackGroup),
    source,
    candidate: { id, type }
  };
}

function buildMissionRows(data) {
  return [
    ...asList(data?.agentRuns).map((row) => missionRow(row, "Agent run", "analysis")),
    ...asList(data?.watchTriggers).map((row) => missionRow(row, "Watch", "monitoring")),
    ...asList(data?.tradePlans).map((row) => missionRow(row, "Trade plan", "monitoring"))
  ].filter(Boolean).slice(0, 10);
}

function firstSelectionCandidate(data) {
  const collections = [
    [data?.watchTriggers, "Watch"],
    [data?.agentRuns, "Agent run"],
    [data?.events, "Event"],
    [data?.positions, "Position"],
    [data?.tradePlans, "Trade plan"]
  ];
  for (const [rows, type] of collections) {
    const source = asList(rows)[0];
    if (!source) continue;
    const id = rowIdentity(source, "id", "runId", "positionId", "symbol", "instId");
    if (id) return { id, type };
  }
  return null;
}

function statusTone(status) {
  const normalized = normalizedStatus(status);
  if (["failed", "blocked", "rejected", "error"].includes(normalized)) return "danger";
  if (["active", "armed", "running", "monitoring", "approved"].includes(normalized)) return "mint";
  if (["completed", "complete", "closed", "done", "success"].includes(normalized)) return "violet";
  return "cobalt";
}

function MissionQueue({ rows, selectedId, onSelect }) {
  return (
    <section className="kordynV2MissionQueue" aria-labelledby="kordyn-v2-queue-title">
      <header>
        <h2 id="kordyn-v2-queue-title">任务队列</h2>
        <Radio size={17} aria-hidden="true" />
      </header>
      <div className="kordynV2MissionQueueScroll">
        {QUEUE_GROUPS.map((group) => {
          const items = rows.filter((row) => row.group === group.id);
          if (!items.length) return null;
          return (
            <section className="kordynV2QueueGroup" key={group.id}>
              <h3><span data-tone={group.id} />{group.label} <em>({items.length})</em></h3>
              {items.map((row) => (
                <button
                  key={`${row.type}:${row.id}`}
                  type="button"
                  className={row.id === selectedId ? "is-selected" : undefined}
                  data-kordyn-v2-object-target={row.id}
                  onClick={() => onSelect(row.candidate)}
                >
                  <span className={`kordynV2AssetGlyph tone-${statusTone(row.status)}`}>{safeText(row.symbol, row.type.slice(0, 2).toUpperCase()).slice(0, 3)}</span>
                  <span className="kordynV2QueueCopy">
                    <strong>{row.title}</strong>
                    <small>{row.subtitle}</small>
                  </span>
                  <i className={`tone-${statusTone(row.status)}`} aria-label={row.status} />
                </button>
              ))}
            </section>
          );
        })}
        {!rows.length && <p className="kordynV2EmptyQueue">当前范围没有可用任务事实。</p>}
      </div>
    </section>
  );
}

function FactRow({ icon: Icon, label, value }) {
  return (
    <div className="kordynV2DecisionFact">
      <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function selectedPositionImpact(data, symbol) {
  const position = asList(data?.positions).find((row) => optionalText(row?.symbol, row?.instId) === symbol);
  if (!position) return unavailable;
  return [optionalText(position?.direction, position?.side), optionalText(position?.quantity, position?.size)]
    .filter(Boolean)
    .join(" ") || unavailable;
}

function MissionFocus({ data, row, selection }) {
  const source = row?.source || selection?.object?.raw || {};
  const title = firstText(row?.title, selection?.object?.title, selection?.context?.title);
  const symbol = optionalText(row?.symbol, source?.symbol, source?.instId);
  const traceStages = asList(selection?.trace?.stages);
  const capabilityValue = asList(source?.capabilities).map((item) => safeText(item, "")).filter(Boolean).join(" / ") || firstText(source?.capability, source?.tools);
  const eventValue = firstText(source?.eventWindow, source?.event, source?.timeframe);
  const stageStatus = (index) => firstText(traceStages[index]?.status, index < 4 ? "complete" : "waiting");

  return (
    <article className="kordynV2MissionFocus" data-kordyn-v2-mission-focus>
      <header className="kordynV2MissionTitle">
        <span className="kordynV2MissionSymbol">{safeText(symbol, "AI").slice(0, 3)}</span>
        <h2>{title}</h2>
        <em>{statusLabel(optionalText(row?.status, selection?.context?.status, "active"))}</em>
      </header>
      <div className="kordynV2MissionPipeline" aria-label="任务阶段">
        {PIPELINE.map(({ label, icon: Icon }, index) => {
          const stageState = stageStatus(index);
          return (
            <div key={label} className="kordynV2PipelineStage" data-stage-state={normalizedStatus(stageState)}>
              <span><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
              <strong>{label}</strong>
              {index < 4 && <CircleCheck size={14} aria-label={stageState} />}
            </div>
          );
        })}
      </div>
      <p className="kordynV2MissionSignal"><Activity size={19} aria-hidden="true" />{firstText(source?.summary, source?.displayThesis, source?.thesis, source?.rationale, "当前对象正在等待新的权威事实。")}</p>
      <section className="kordynV2DecisionSummary">
        <h3>决策摘要</h3>
        <FactRow icon={ChartNoAxesCombined} label="策略" value={firstText(source?.strategyName, source?.strategy, source?.strategyProductId)} />
        <FactRow icon={BookOpen} label="知识来源" value={firstText(source?.knowledgeSource, source?.evidenceSource, source?.rationale)} />
        <FactRow icon={Blocks} label="能力" value={capabilityValue} />
        <FactRow icon={CalendarClock} label="事件" value={eventValue} />
        <FactRow icon={Link2} label="持仓影响" value={selectedPositionImpact(data, symbol)} />
      </section>
      <footer className="kordynV2MissionMeta">
        <span><Link2 size={15} aria-hidden="true" /> 对象 {safeText(selection?.object?.id)}</span>
        <span>证据 {safeText(selection?.context?.evidence)}</span>
      </footer>
    </article>
  );
}

function AttentionRail({ data, selection }) {
  const attention = [...asList(data?.pendingActions), ...asList(data?.riskIncidents)].slice(0, 2);
  const latestRun = asList(data?.agentRuns)[0];
  const relationshipFacts = [
    ["行情快照", asList(data?.markets).length],
    ["市场结构", asList(data?.marketStructures).length],
    ["链上数据", asList(data?.onchainSignals).length],
    ["知识来源", asList(data?.knowledge?.sources).length],
    ["交易对照", asList(data?.executionOrders).length]
  ];
  return (
    <aside className="kordynV2AttentionRail">
      <section className="kordynV2AttentionCard is-urgent">
        <header><h2>需要你</h2><span>{attention.length ? "高" : "0"}</span></header>
        {attention.length ? attention.map((item, index) => (
          <div className="kordynV2AttentionItem" key={rowIdentity(item, "id", "title") || index}>
            <strong>{firstText(item?.title, item?.type, item?.id)}</strong>
            <small>{firstText(item?.summary, item?.detail, item?.status)}</small>
            <ArrowRight size={17} aria-hidden="true" />
          </div>
        )) : <p>当前没有待处理的权威事项。</p>}
      </section>
      <section className="kordynV2AttentionCard is-context">
        <header><h2>关联上下文</h2></header>
        <dl>
          {relationshipFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <small>当前对象 · {safeText(selection?.object?.id)}</small>
      </section>
      <section className="kordynV2AttentionCard is-recall">
        <header><h2>运行回执</h2></header>
        <dl>
          <div><dt>任务创建</dt><dd>{clockText(latestRun?.createdAt)}</dd></div>
          <div><dt>最后更新</dt><dd>{clockText(optionalText(latestRun?.updatedAt, latestRun?.completedAt))}</dd></div>
          <div><dt>运行时长</dt><dd>{durationText(latestRun?.durationMs ?? latestRun?.duration)}</dd></div>
          <div><dt>状态</dt><dd className="is-cobalt">{statusLabel(latestRun?.status)}</dd></div>
        </dl>
      </section>
    </aside>
  );
}

function MissionControlCanvas({ data, domain, workspace, selection, onSelect, onNavigate }) {
  const rows = useMemo(() => buildMissionRows(data), [data]);
  const selectedId = safeText(selection?.object?.id, "");
  const selectedRow = rows.find((row) => row.id === selectedId) || rows[0] || null;
  return (
    <div className="kordynV2MissionControl">
      <div className="kordynV2WorkspaceHeading">
        <span><small>{domain.label}</small><h1>{domain.id === "ai" ? "AI 交易员" : workspace.label}</h1></span>
        <em><span /> {firstText(data?.automationState?.label, data?.automationState?.mode, "运行状态不可用")}</em>
      </div>
      <div className="kordynV2MissionGrid">
        <MissionQueue rows={rows} selectedId={selectedId} onSelect={onSelect} />
        <MissionFocus data={data} row={selectedRow} selection={selection} />
        <AttentionRail data={data} selection={selection} />
      </div>
      <button className="kordynV2MissionPrompt" type="button" onClick={() => onNavigate("ai", "dialog")}>
        <Sparkles size={22} aria-hidden="true" />
        <span>告诉 AI 交易员你的目标，或检查当前任务…</span>
        <Send size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

export function KordynV2Root({ api, lang }) {
  const data = api?.data || {};
  const [location, setLocation] = useState(() => v2LocationForWorkspace("ai", "missions"));
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const domain = KORDYN_V2_DOMAINS.find((item) => item.id === location.domainId) || KORDYN_V2_DOMAINS[0];
  const workspace = (KORDYN_V2_WORKSPACES[domain.id] || []).find((item) => item.id === location.workspaceId)
    || KORDYN_V2_WORKSPACES[domain.id][0];

  useEffect(() => {
    Promise.resolve(api?.ensureSection?.(location.resourceSection)).catch(() => {});
  }, [location.resourceSection]);

  const navigate = useCallback((domainId, workspaceId) => {
    setLocation(v2LocationForWorkspace(domainId, workspaceId));
  }, []);

  const defaultCandidate = useMemo(() => firstSelectionCandidate(data), [data]);
  const selection = useMemo(() => {
    const requested = createV2Selection({ data, candidate: selectedCandidate || defaultCandidate });
    return requested || (selectedCandidate ? createV2Selection({ data, candidate: defaultCandidate }) : null);
  }, [data, defaultCandidate, selectedCandidate]);

  const select = useCallback((candidate) => {
    setSelectedCandidate(candidate && typeof candidate === "object" ? { id: candidate.id, type: candidate.type } : null);
  }, []);

  const truth = useMemo(() => buildAccountTruth(data, domain.truthMode), [data, domain.truthMode]);
  const resourceState = data?.resourceState?.[location.resourceSection] || (api?.data ? "loaded" : "loading");
  const state = useMemo(() => normalizeResourceState({
    resourceState,
    error: api?.connectionError || null,
    data: {
      source: firstText(data?.lastValidSource, data?.source, data?.meta?.source, data?.portfolio?.source),
      asOf: firstText(data?.lastValidAt, data?.asOf, data?.meta?.asOf, data?.portfolio?.marginSyncedAt)
    }
  }), [api?.connectionError, data, resourceState]);

  const retry = useCallback(() => {
    Promise.resolve(api?.ensureSection?.(location.resourceSection, { force: true })).catch(() => {});
  }, [api, location.resourceSection]);

  return (
    <div className="kordynV2Root" data-kordyn-v2-root="desktop" lang={lang === "en" ? "en" : "zh-CN"}>
      <DesktopShell
        location={location}
        truth={truth}
        state={state}
        selection={selection}
        onNavigate={navigate}
        onSelect={select}
        onRetry={retry}
      >
        <MissionControlCanvas
          data={data}
          domain={domain}
          workspace={workspace}
          selection={selection}
          onSelect={select}
          onNavigate={navigate}
        />
      </DesktopShell>
    </div>
  );
}
