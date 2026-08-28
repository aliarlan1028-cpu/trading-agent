import {
  Activity,
  ArrowRight,
  Blocks,
  BookOpen,
  CalendarClock,
  ChartNoAxesCombined,
  CircleCheck,
  Clock3,
  Download,
  Globe2,
  Link2,
  Radio,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundCheck
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasJsonResponseProvenance, jsonResponseArrayValues } from "../jsonResponseProvenance.js";
import { KORDYN_V2_DOMAINS, KORDYN_V2_WORKSPACES } from "./architecture/domains.js";
import { v2LocationForWorkspace } from "./architecture/routes.js";
import { DesktopShell } from "./shell/DesktopShell.jsx";
import { MobileShell } from "./shell/MobileShell.jsx";
import { useV2Viewport } from "./shell/useV2Viewport.js";
import { DestinationBoundary } from "./shell/DestinationBoundary.jsx";
import { DialogSurface } from "./shell/DialogSurface.jsx";
import { buildAccountTruth } from "./viewModels/accountTruth.js";
import { buildAiSupportContext } from "./viewModels/aiSupport.js";
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
  { stageId: "sense", label: "全市场快扫", icon: Globe2 },
  { stageId: "plan", label: "检验市场结构", icon: ChartNoAxesCombined },
  { stageId: "execute", label: "核对账户", icon: UserRoundCheck },
  { stageId: "guard", label: "硬风控", icon: ShieldCheck },
  { stageId: "monitor", label: "等待回踩", icon: Clock3 }
]);

const MOBILE_PIPELINE = Object.freeze([
  { stageId: "sense", label: "快扫" },
  { stageId: "plan", label: "结构" },
  { stageId: "guard", label: "风控" },
  { stageId: "execute", label: "执行" },
  { stageId: "monitor", label: "等待回踩" }
]);

const QUEUE_GROUPS = Object.freeze([
  { id: "analysis", label: "正在分析" },
  { id: "monitoring", label: "正在监控" },
  { id: "execution", label: "执行中" },
  { id: "complete", label: "已完成" },
  { id: "unavailable", label: "事实待定" }
]);

function rowIdentity(row, ...fields) {
  return fields.map((field) => safeText(row?.[field], "")).find(Boolean) || "";
}

function groupForStatus(status) {
  const value = normalizedStatus(status);
  if (["completed", "complete", "closed", "done", "success"].includes(value)) return "complete";
  if (["submitted", "approved", "executing", "open", "filled", "protecting"].includes(value)) return "execution";
  if (["active", "armed", "monitoring", "awaiting_approval", "waiting"].includes(value)) return "monitoring";
  if (["running", "analyzing", "analysis", "scanning", "researching"].includes(value)) return "analysis";
  return "unavailable";
}

function missionRow(source, type) {
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
    group: groupForStatus(source?.status ?? source?.state),
    source,
    candidate: { id, type }
  };
}

function buildMissionRows(data) {
  return [
    ...asList(data?.agentRuns).map((row) => missionRow(row, "Agent run")),
    ...asList(data?.watchTriggers).map((row) => missionRow(row, "Watch")),
    ...asList(data?.tradePlans).map((row) => missionRow(row, "Trade plan"))
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
  if (["waiting", "pending", "queued", "awaiting_approval"].includes(normalized)) return "cobalt";
  return "unavailable";
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

function collectionCount(value) {
  return Array.isArray(value) ? value.length : unavailable;
}

function ownJsonData(record, key) {
  if (!hasJsonResponseProvenance(record)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function identityTruth(data) {
  const user = ownJsonData(data, "user");
  const explicitCount = ownJsonData(data, "notificationCount");
  const notifications = jsonResponseArrayValues(ownJsonData(data, "notifications"));
  return {
    name: optionalText(
      ownJsonData(user, "displayName"),
      ownJsonData(user, "name"),
      ownJsonData(user, "id")
    ),
    notificationCount: Number.isInteger(explicitCount) && explicitCount >= 0
      ? explicitCount
      : notifications?.length
  };
}

function attentionCandidate(item, data) {
  const id = optionalText(item?.objectId, item?.entityId, item?.targetId);
  const type = optionalText(item?.objectType, item?.entityType, item?.targetType);
  if (!id || !type) return null;
  const candidate = { id, type };
  return createV2Selection({ data, candidate }) ? candidate : null;
}

function MissionFocus({ data, row, selection, onOpenProof }) {
  const source = row?.source || selection?.object?.raw || {};
  const title = firstText(row?.title, selection?.object?.title, selection?.context?.title);
  const symbol = optionalText(row?.symbol, source?.symbol, source?.instId);
  const traceStages = asList(selection?.trace?.stages);
  const traceByStage = new Map(traceStages.map((stage) => [safeText(stage?.id, "").toLowerCase(), stage]));
  const capabilityValue = asList(source?.capabilities).map((item) => safeText(item, "")).filter(Boolean).join(" / ") || firstText(source?.capability, source?.tools);
  const eventValue = firstText(source?.eventWindow, source?.event, source?.timeframe);
  const missionStatus = firstText(row?.status, selection?.context?.status);
  const missionSignal = firstText(source?.summary, source?.displayThesis, source?.thesis, source?.rationale);
  const stageStatus = (stageId) => firstText(traceByStage.get(stageId)?.status);

  return (
    <article className="kordynV2MissionFocus" data-kordyn-v2-mission-focus>
      <header className="kordynV2MissionTitle">
        <span className="kordynV2MissionSymbol">{safeText(symbol, "AI").slice(0, 3)}</span>
        <h2>{title}</h2>
        <em data-status-tone={statusTone(missionStatus)}>{statusLabel(missionStatus)}</em>
      </header>
      <div className="kordynV2MissionPipeline" aria-label="任务阶段">
        {PIPELINE.map(({ stageId, label, icon: Icon }) => {
          const stageState = stageStatus(stageId);
          return (
            <div
              key={stageId}
              className="kordynV2PipelineStage"
              data-stage-id={stageId}
              data-stage-state={normalizedStatus(stageState)}
            >
              <span><Icon size={20} strokeWidth={1.7} aria-hidden="true" /></span>
              <strong>{label}</strong>
              {normalizedStatus(stageState) === "complete" && <CircleCheck size={14} aria-label="complete" />}
            </div>
          );
        })}
      </div>
      <p className="kordynV2MissionSignal" data-status-tone={missionSignal === unavailable ? "unavailable" : "cobalt"}><Activity size={19} aria-hidden="true" />{missionSignal}</p>
      <section className="kordynV2DecisionSummary">
        <h3>决策摘要</h3>
        <FactRow icon={ChartNoAxesCombined} label="策略" value={firstText(source?.strategyName, source?.strategy, source?.strategyProductId)} />
        <FactRow icon={BookOpen} label="知识来源" value={firstText(source?.knowledgeSource, source?.evidenceSource, source?.rationale)} />
        <FactRow icon={Blocks} label="能力" value={capabilityValue} />
        <FactRow icon={CalendarClock} label="事件" value={eventValue} />
        <FactRow icon={Link2} label="持仓影响" value={selectedPositionImpact(data, symbol)} />
      </section>
      <footer className="kordynV2WorkbenchFooter" data-kordyn-v2-workbench-footer>
        <button
          data-kordyn-v2-audit-control
          type="button"
          aria-haspopup="dialog"
          onClick={(event) => onOpenProof(event.currentTarget)}
        >
          <Link2 size={16} aria-hidden="true" />
          <span>审计链</span>
          <ArrowRight size={15} aria-hidden="true" />
        </button>
        <span
          className="kordynV2WorkbenchIdentity"
          title={`对象 ${safeText(selection?.object?.id)} · 证据 ${safeText(selection?.context?.evidence)}`}
        >
          {safeText(selection?.object?.id)}
        </span>
        <button
          data-kordyn-v2-poster-control
          type="button"
          disabled
          aria-label={`生成海报 PNG：${unavailable}`}
        >
          <Download size={16} aria-hidden="true" />
          <span>生成海报</span>
          <small>PNG · {unavailable}</small>
        </button>
      </footer>
    </article>
  );
}

function AttentionRail({ data, selection, onSelect }) {
  const attention = [...asList(data?.pendingActions), ...asList(data?.riskIncidents)].slice(0, 2);
  const attentionComplete = Array.isArray(data?.pendingActions) && Array.isArray(data?.riskIncidents);
  const latestRun = asList(data?.agentRuns)[0];
  const relationshipFacts = [
    ["行情快照", collectionCount(data?.markets)],
    ["市场结构", collectionCount(data?.marketStructures)],
    ["链上数据", collectionCount(data?.onchainSignals)],
    ["知识来源", collectionCount(data?.knowledge?.sources)],
    ["交易对照", collectionCount(data?.executionOrders)]
  ];
  return (
    <aside className="kordynV2AttentionRail">
      <section
        className="kordynV2AttentionCard is-urgent"
        data-kordyn-v2-attention-completeness={attentionComplete ? "complete" : "unavailable"}
      >
        <header><h2>需要你</h2><span>{attentionComplete ? attention.length ? "高" : "0" : unavailable}</span></header>
        {attention.length ? attention.map((item, index) => {
          const candidate = attentionCandidate(item, data);
          const Item = candidate ? "button" : "div";
          return (
            <Item
              className={`kordynV2AttentionItem${candidate ? "" : " is-unavailable"}`}
              key={rowIdentity(item, "id", "title") || index}
              type={candidate ? "button" : undefined}
              data-kordyn-v2-attention-target={candidate?.id}
              aria-label={candidate ? `打开 ${firstText(item?.title, item?.type, item?.id)}` : `${firstText(item?.title, item?.type, item?.id)}：${unavailable}`}
              onClick={candidate ? () => onSelect(candidate) : undefined}
            >
              <strong>{firstText(item?.title, item?.type, item?.id)}</strong>
              <small>{firstText(item?.summary, item?.detail, item?.status)}</small>
              {candidate && <ArrowRight size={17} aria-hidden="true" />}
            </Item>
          );
        }) : <p>{attentionComplete ? "当前没有待处理的权威事项。" : unavailable}</p>}
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

function automationHealth(data) {
  const label = firstText(data?.automationState?.label, data?.automationState?.mode);
  const fact = optionalText(data?.automationState?.runtimeStatus, data?.automationState?.mode, data?.automationState?.label).toLowerCase();
  if (!fact) return { label: unavailable, tone: "unavailable" };
  if (["halted", "paused", "reduce_only", "failed", "error", "blocked", "emergency", "kill"].some((token) => fact.includes(token))) {
    return { label, tone: "danger" };
  }
  if (["normal", "full_auto", "semi_auto", "observe", "running", "active"].some((token) => fact.includes(token))) {
    return { label, tone: "mint" };
  }
  return { label, tone: "unavailable" };
}

function MissionControlCanvas({ data, domain, workspace, selection, onSelect, onOpenDialog, onOpenProof }) {
  const rows = useMemo(() => buildMissionRows(data), [data]);
  const selectedId = safeText(selection?.object?.id, "");
  const selectedRow = rows.find((row) => row.id === selectedId) || rows[0] || null;
  const automation = automationHealth(data);
  return (
    <div
      className="kordynV2MissionControl"
      data-kordyn-v2-destination={`${domain.id}/${workspace.id}`}
      data-kordyn-v2-mission-control
    >
      <div className="kordynV2WorkspaceHeading">
        <span><small>{domain.label}</small><h1 data-kordyn-v2-destination-title>{domain.id === "ai" ? "AI 交易员" : workspace.label}</h1></span>
        <em data-health-tone={automation.tone} role="status" aria-label={`自动化状态：${automation.label}`}><span /> {automation.label}</em>
      </div>
      <div className="kordynV2MissionGrid">
        <MissionQueue rows={rows} selectedId={selectedId} onSelect={onSelect} />
        <MissionFocus data={data} row={selectedRow} selection={selection} onOpenProof={onOpenProof} />
        <AttentionRail data={data} selection={selection} onSelect={onSelect} />
      </div>
      <button className="kordynV2MissionPrompt" data-kordyn-v2-dialog-trigger type="button" onClick={onOpenDialog}>
        <Sparkles size={22} aria-hidden="true" />
        <span>告诉 AI 交易员你的目标，或检查当前任务…</span>
        <Send size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

const moneyText = (value) => typeof value === "number" && Number.isFinite(value)
  ? new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  : unavailable;

function firstPositionValue(position, fields) {
  for (const field of fields) {
    const value = position?.[field];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function positionPnlFact(positions) {
  if (!Array.isArray(positions) || !positions.length) return unavailable;
  const values = positions.map((position) => firstPositionValue(position, ["unrealizedPnlUsdt", "unrealizedPnl", "upl"]));
  return values.every((value) => value !== null)
    ? moneyText(values.reduce((total, value) => total + value, 0))
    : unavailable;
}

function MobileMissionHome({ data, truth, selection, onSelect, onOpenDialog, onOpenProof }) {
  const rows = useMemo(() => buildMissionRows(data), [data]);
  const selectedId = safeText(selection?.object?.id, "");
  const selectedRow = rows.find((row) => row.id === selectedId) || rows[0] || null;
  const source = selectedRow?.source || selection?.object?.raw || {};
  const title = firstText(selectedRow?.title, selection?.object?.title, selection?.context?.title);
  const symbol = optionalText(selectedRow?.symbol, source?.symbol, source?.instId);
  const missionStatus = firstText(selectedRow?.status, selection?.context?.status);
  const missionSignal = firstText(source?.summary, source?.displayThesis, source?.thesis, source?.rationale);
  const capabilityValue = asList(source?.capabilities).map((item) => safeText(item, "")).filter(Boolean).join(" / ") || firstText(source?.capability, source?.tools);
  const eventValue = firstText(source?.eventWindow, source?.event, source?.timeframe);
  const traceStages = asList(selection?.trace?.stages);
  const traceByStage = new Map(traceStages.map((stage) => [safeText(stage?.id, "").toLowerCase(), stage]));
  const attention = [...asList(data?.pendingActions), ...asList(data?.riskIncidents)].slice(0, 1);
  const attentionComplete = Array.isArray(data?.pendingActions) && Array.isArray(data?.riskIncidents);
  const positions = Array.isArray(data?.positions) ? data.positions : null;
  const firstPosition = positions?.[0] || null;
  const completed = rows.filter((row) => row.group === "complete").slice(0, 2);
  const completedProjectionAvailable = [data?.agentRuns, data?.watchTriggers, data?.tradePlans].every(Array.isArray);
  const automation = automationHealth(data);
  const decisionFacts = [
    ["策略", firstText(source?.strategyName, source?.strategy, source?.strategyProductId)],
    ["知识来源", firstText(source?.knowledgeSource, source?.evidenceSource, source?.rationale)],
    ["能力", capabilityValue],
    ["事件", eventValue],
    ["持仓影响", selectedPositionImpact(data, symbol)]
  ];
  const stageStatus = (stageId) => firstText(traceByStage.get(stageId)?.status);

  return (
    <div
      className="kordynV2MobileMissionHome"
      data-kordyn-v2-destination="ai/missions"
      data-kordyn-v2-mission-control
      data-kordyn-v2-mobile-mission-home
    >
      <section className="kordynV2MobileTraderFrame" data-kordyn-v2-mobile-trader-frame>
        <header className="kordynV2MobileTraderHeader" data-kordyn-v2-mobile-trader-header>
          <span><Activity size={18} aria-hidden="true" /><strong>AI 交易员</strong></span>
          <em data-health-tone={automation.tone} role="status" aria-label={`自动化状态：${automation.label}`}><i aria-hidden="true" />{automation.label}</em>
        </header>
        <article className="kordynV2MobileActiveMission" data-kordyn-v2-mobile-active-mission>
          <header>
            <span className="kordynV2MobileMissionSymbol">{safeText(symbol, "AI").slice(0, 3)}</span>
            <span className="kordynV2MobileMissionCopy">
              <strong>{title}</strong>
              <small>{missionSignal}</small>
            </span>
            <em data-status-tone={statusTone(missionStatus)}>{statusLabel(missionStatus)}</em>
            <button
              type="button"
              data-kordyn-v2-mobile-evidence-trigger
              aria-haspopup="dialog"
              onClick={(event) => onOpenProof(event.currentTarget, { panel: "details", details: decisionFacts })}
            >
              <Link2 size={16} aria-hidden="true" />
              证据
            </button>
          </header>
          <div className="kordynV2MobileMissionStages" aria-label="任务阶段">
            {MOBILE_PIPELINE.map(({ stageId, label }, index) => {
              const currentStatus = stageStatus(stageId);
              const normalized = normalizedStatus(currentStatus);
              const complete = normalized === "complete";
              const connector = index === MOBILE_PIPELINE.length - 1
                ? "none"
                : complete ? "complete" : normalized === "blocked" ? "blocked" : "unavailable";
              return (
                <div key={stageId} data-stage-id={stageId} data-stage-state={normalized} data-stage-connector={connector}>
                  <span>{complete ? <CircleCheck size={16} aria-label="complete" /> : index + 1}</span>
                  <strong>{label}</strong>
                  <small>{statusLabel(currentStatus)}</small>
                </div>
              );
            })}
          </div>
          <dl className="kordynV2MobileMissionFacts">
            <div><dt><ShieldCheck size={15} aria-hidden="true" />风控</dt><dd>{firstText(truth?.risk)}</dd></div>
            <div><dt><ChartNoAxesCombined size={15} aria-hidden="true" />策略</dt><dd>{firstText(source?.strategyName, source?.strategy, source?.strategyProductId)}</dd></div>
            <div><dt><CalendarClock size={15} aria-hidden="true" />事件</dt><dd>{eventValue}</dd></div>
          </dl>
        </article>
      </section>

      <section className="kordynV2MobileNeedsYou" data-kordyn-v2-mobile-needs-you>
        <header><h2>需要你</h2><span>{attentionComplete ? attention.length ? "高优先级" : "0" : unavailable}</span></header>
        {attention.length ? attention.map((item, index) => {
          const candidate = attentionCandidate(item, data);
          const Item = candidate ? "button" : "div";
          return (
            <Item
              key={rowIdentity(item, "id", "title") || index}
              type={candidate ? "button" : undefined}
              data-kordyn-v2-attention-target={candidate?.id}
              aria-label={candidate ? `打开 ${firstText(item?.title, item?.type, item?.id)}` : `${firstText(item?.title, item?.type, item?.id)}：${unavailable}`}
              onClick={candidate ? () => onSelect(candidate) : undefined}
            >
              <span><strong>{firstText(item?.title, item?.type, item?.id)}</strong><small>{firstText(item?.detail, item?.summary, item?.status)}</small></span>
              {candidate && <ArrowRight size={18} aria-hidden="true" />}
            </Item>
          );
        }) : <p>{attentionComplete ? "当前没有待处理的权威事项。" : unavailable}</p>}
      </section>

      <section className="kordynV2MobileAccountImpact" data-kordyn-v2-mobile-account-impact>
        <header><h2>账户影响</h2><span>只读账户事实</span></header>
        <dl>
          <div><dt>持仓数量</dt><dd>{positions ? positions.length : unavailable}</dd></div>
          <div><dt>总持仓价值</dt><dd>{moneyText(truth?.exposure)}</dd></div>
          <div><dt>未实现盈亏</dt><dd>{positionPnlFact(positions)}</dd></div>
        </dl>
        {firstPosition ? (
          <div className="kordynV2MobilePositionRow">
            <span className="kordynV2MobilePositionSymbol">{safeText(optionalText(firstPosition?.symbol, firstPosition?.instId), "--").slice(0, 3)}</span>
            <span><strong>{firstText(firstPosition?.symbol, firstPosition?.instId)}</strong><small>{firstText(firstPosition?.direction, firstPosition?.side)} · {safeText(firstPosition?.quantity ?? firstPosition?.size)}</small></span>
            <span><small>名义价值</small><strong>{moneyText(firstPositionValue(firstPosition, ["notionalUsdt", "notional", "marketValue"]))}</strong></span>
          </div>
        ) : <p>{positions ? "当前没有已加载持仓。" : unavailable}</p>}
      </section>

      <section
        className="kordynV2MobileRecent"
        data-kordyn-v2-mobile-recent
        data-kordyn-v2-recent-completeness={completedProjectionAvailable ? "complete" : "unavailable"}
      >
        <h2>最近完成</h2>
        {completed.length ? completed.map((row) => (
          <div key={`${row.type}:${row.id}`}>
            <CircleCheck size={18} aria-hidden="true" />
            <span><strong>{row.title}</strong><small>{row.subtitle}</small></span>
            <em>{statusLabel(row.status)}</em>
          </div>
        )) : <p>{completedProjectionAvailable ? "当前没有已完成的 Mission 或 Agent 运行。" : unavailable}</p>}
      </section>

      <button className="kordynV2MissionPrompt" data-kordyn-v2-dialog-trigger type="button" onClick={onOpenDialog}>
        <Sparkles size={20} aria-hidden="true" />
        <span>告诉 AI 交易员你的目标…</span>
        <Send size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

export function KordynV2Root({ api, lang }) {
  const viewport = useV2Viewport();
  const data = api?.data || {};
  const [location, setLocation] = useState(() => v2LocationForWorkspace("ai", "missions"));
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [evidenceRequest, setEvidenceRequest] = useState(null);
  const returnPromptFocusRef = useRef(false);
  const domain = KORDYN_V2_DOMAINS.find((item) => item.id === location.domainId) || KORDYN_V2_DOMAINS[0];
  const workspace = (KORDYN_V2_WORKSPACES[domain.id] || []).find((item) => item.id === location.workspaceId)
    || KORDYN_V2_WORKSPACES[domain.id][0];

  useEffect(() => {
    setLocation((current) => {
      const resolved = v2LocationForWorkspace(current.domainId, current.workspaceId, viewport);
      return resolved.resourceSection === current.resourceSection
        && resolved.objectId === current.objectId
        ? current
        : resolved;
    });
  }, [viewport]);

  useEffect(() => {
    Promise.resolve(api?.ensureSection?.(location.resourceSection)).catch(() => {});
  }, [location.resourceSection]);

  const navigate = useCallback((domainId, workspaceId) => {
    returnPromptFocusRef.current = false;
    setLocation(v2LocationForWorkspace(domainId, workspaceId, viewport));
  }, [viewport]);

  const openDialog = useCallback(() => {
    returnPromptFocusRef.current = true;
    setLocation(v2LocationForWorkspace("ai", "dialog", viewport));
  }, [viewport]);

  const closeDialog = useCallback(() => {
    setLocation(v2LocationForWorkspace("ai", "missions", viewport));
  }, [viewport]);

  useEffect(() => {
    if (location.domainId !== "ai" || location.workspaceId !== "missions" || !returnPromptFocusRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector("[data-kordyn-v2-dialog-trigger]")?.focus();
      returnPromptFocusRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.domainId, location.workspaceId]);

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

  const requestProof = useCallback((trigger, request = {}) => {
    const panel = ["details", "context", "proof"].includes(request?.panel) ? request.panel : "proof";
    setEvidenceRequest((current) => ({
      panel,
      details: Array.isArray(request?.details) ? request.details : null,
      token: (current?.token || 0) + 1,
      trigger
    }));
  }, []);

  const identity = useMemo(() => identityTruth(data), [data]);
  const supportContext = useMemo(() => buildAiSupportContext({
    data,
    location,
    selection,
    state
  }), [data, location, selection, state]);

  const destination = location.domainId === "ai" && location.workspaceId === "missions"
    ? viewport === "mobile" ? (
      <MobileMissionHome
        data={data}
        truth={truth}
        selection={selection}
        onSelect={select}
        onOpenDialog={openDialog}
        onOpenProof={requestProof}
      />
    ) : (
      <MissionControlCanvas
        data={data}
        domain={domain}
        workspace={workspace}
        selection={selection}
        onSelect={select}
        onOpenDialog={openDialog}
        onOpenProof={requestProof}
      />
    )
    : location.domainId === "ai" && location.workspaceId === "dialog"
      ? <DialogSurface data={data} onClose={closeDialog} />
      : <DestinationBoundary domain={domain} workspace={workspace} location={location} state={state} />;

  const Shell = viewport === "mobile" ? MobileShell : DesktopShell;

  return (
    <div className="kordynV2Root" data-kordyn-v2-root={viewport} lang={lang === "en" ? "en" : "zh-CN"}>
      <Shell
        location={location}
        truth={truth}
        state={state}
        selection={selection}
        identity={identity}
        supportContext={supportContext}
        evidenceRequest={evidenceRequest}
        onNavigate={navigate}
        onSelect={select}
        onRetry={retry}
      >
        {destination}
      </Shell>
    </div>
  );
}
