import React, { useEffect, useMemo, useRef, useState } from "react";
import { Activity, BookOpen, Bot, ChevronDown, ChevronUp, PieChart, Search, Settings, ShieldCheck, X } from "lucide-react";
import { CONFIGURATION_WORKSPACE, ROUTE_DEFINITIONS, WORKSPACES } from "./productArchitecture.js";
import { t } from "./i18n.js";

const text = (value, fallback = "—") => value == null || value === "" ? fallback : String(value);

const unavailable = "Unavailable";
const firstValue = (...values) => values.find((value) => value != null && value !== "");
const asList = (value) => Array.isArray(value) ? value : [];

const searchCollections = Object.freeze([
  { key: "markets", type: "Market", route: "market", workspaceId: "live", sourceSection: "cockpit", id: (row) => row.symbol || row.id, title: (row) => row.symbol || row.name },
  { key: "positions", type: "Position", route: "positions", workspaceId: "live", sourceSection: "cockpit", id: (row) => row.id || row.symbol, title: (row) => row.symbol || row.name },
  { key: "tradePlans", type: "Trade plan", route: "signalHub", workspaceId: "live", sourceSection: "cockpit", id: (row) => row.id, title: (row) => row.title || row.symbol || row.name },
  { key: "tasks", type: "Task", route: "operationsCenter:tasks", workspaceId: "operations", sourceSection: "operationsCenter", id: (row) => row.id, title: (row) => row.title || row.name || row.type },
  { key: "mandates", type: "Mandate", route: "riskMandate", workspaceId: "control", sourceSection: "riskCenter", id: (row) => row.id, title: (row) => row.name || row.title || row.id },
  { key: "riskIncidents", type: "Risk incident", route: "riskCenter", workspaceId: "control", sourceSection: "riskCenter", id: (row) => row.id, title: (row) => row.title || row.type || row.id },
  { key: "executionOrders", type: "Execution", route: "executionReview", workspaceId: "live", sourceSection: "cockpit", id: (row) => row.id || row.orderId, title: (row) => row.symbol || row.title || row.id },
  { key: "reviews", type: "Review", route: "labReviews", workspaceId: "lab", sourceSection: "researchCenter", id: (row) => row.id, title: (row) => row.title || row.symbol || row.id },
  { key: "skills", type: "Capability", route: "capabilityLib", workspaceId: "lab", sourceSection: "researchCenter", id: (row) => row.id || row.name, title: (row) => row.name || row.title || row.id }
]);

function sourceMetadata(data, source, workspaceId, sourceSection) {
  const raw = source?.raw || source || {};
  const sourceState = String(firstValue(
    data.resourceState?.[sourceSection],
    source?.sourceState,
    raw.sourceState,
    raw.resourceState,
    unavailable
  ));
  const sourceForbidden = firstValue(source?.sourceForbidden, raw.forbidden, raw.permissionDenied);
  return {
    workspaceId,
    sourceSection,
    sourceState,
    sourceStale: sourceState.toLowerCase() === "stale" || source?.sourceStale === true || raw.stale === true || raw.isStale === true,
    sourceDegraded: sourceState.toLowerCase() === "degraded" || source?.sourceDegraded === true || raw.degraded === true,
    sourceForbidden: sourceForbidden === true ? "forbidden" : (sourceForbidden || false)
  };
}

function searchRow(data, type, route, id, title, source, workspaceId, sourceSection) {
  if (id == null || id === "" || title == null || title === "") return null;
  return {
    type,
    title: String(title),
    id: String(id),
    status: String(firstValue(source?.status, source?.state, source?.enabled === true ? "enabled" : null, unavailable)),
    route: String(route),
    source: firstValue(source?.source, source?.origin, unavailable),
    version: firstValue(source?.version, source?.revision, unavailable),
    permission: firstValue(source?.permission, source?.permissions, source?.requiredPermission, unavailable),
    risk: firstValue(source?.risk, source?.riskLevel, source?.severity, unavailable),
    evidence: firstValue(source?.evidenceId, source?.updatedAt, source?.createdAt, unavailable),
    nextAction: firstValue(source?.nextAction, source?.allowedAction, `Open ${route}`),
    ...sourceMetadata(data, source, workspaceId, sourceSection),
    raw: source
  };
}

export function buildShellSearchIndex(data = {}) {
  const rows = [];
  for (const collection of searchCollections) {
    for (const item of asList(data[collection.key])) {
      const row = searchRow(data, collection.type, collection.route, collection.id(item), collection.title(item), item, collection.workspaceId, collection.sourceSection);
      if (row) rows.push(row);
    }
  }
  for (const item of asList(data.knowledge?.sources)) {
    const row = searchRow(data, "Knowledge", "knowledgeBase", item.id || item.url || item.title, item.title || item.name || item.url, item, "lab", "researchCenter");
    if (row) rows.push(row);
  }
  for (const definition of ROUTE_DEFINITIONS) {
    const alias = definition.aliases.find((item) => !item.includes("*")) || definition.aliases[0];
    const workspace = WORKSPACES[definition.workspace] || CONFIGURATION_WORKSPACE;
    rows.push(searchRow(data, "Feature", alias, alias, `${workspace.labelEn} / ${definition.view}`, {
      status: "available", source: "Product route registry", permission: unavailable, nextAction: `Open ${alias}`
    }, workspace.id, definition.desktop.section));
  }
  const seen = new Set();
  return rows.filter((row) => row && !seen.has(`${row.type}:${row.id}`) && seen.add(`${row.type}:${row.id}`));
}

export function filterShellSearchResults(index = [], query = "") {
  const needle = String(query).trim().toLocaleLowerCase();
  if (!needle) return [];
  return index.filter((row) => [row.type, row.title, row.id, row.status].some((value) => String(value).toLocaleLowerCase().includes(needle))).slice(0, 12);
}

export function nextShellSearchInteraction({ key, activeIndex = 0, count = 0 }) {
  if (key === "Escape") return { activeIndex, close: true, selectIndex: -1 };
  if (key === "Enter") return { activeIndex, close: count > 0, selectIndex: count > 0 ? activeIndex : -1 };
  if (!count) return { activeIndex: 0, close: false, selectIndex: -1 };
  if (key === "ArrowDown") return { activeIndex: (activeIndex + 1) % count, close: false, selectIndex: -1 };
  if (key === "ArrowUp") return { activeIndex: (activeIndex - 1 + count) % count, close: false, selectIndex: -1 };
  return { activeIndex, close: false, selectIndex: -1 };
}

export function runShellSearchShortcut(event, { open = () => {}, focus = () => {} } = {}) {
  if (!(event?.metaKey || event?.ctrlKey) || String(event?.key).toLowerCase() !== "k") return false;
  event.preventDefault?.();
  open();
  focus();
  return true;
}

export function runShellSearchInteraction({ key, activeIndex = 0, results = [], onSelect = () => {}, onNavigate = () => {}, onClose = () => {} } = {}) {
  const next = nextShellSearchInteraction({ key, activeIndex, count: results.length });
  if (next.selectIndex >= 0) {
    const row = results[next.selectIndex];
    if (row) {
      onSelect(row);
      onNavigate(row.route, row);
    }
  }
  if (next.close) onClose();
  return next;
}

export function selectionForNavigation(selectedObject, workspaceId) {
  if (!selectedObject || selectedObject.workspaceId !== workspaceId || selectedObject.sourceForbidden) return null;
  return selectedObject;
}

export function buildShellContext({ data = {}, workspaceId = "ai", selectedObject = null } = {}) {
  const workspace = WORKSPACES[workspaceId] || (workspaceId === "configuration" ? CONFIGURATION_WORKSPACE : null);
  const mandate = asList(data.mandates).find((item) => ["active", "enabled", "effective"].includes(String(item.status || item.state).toLowerCase())) || asList(data.mandates)[0];
  const raw = selectedObject?.raw || selectedObject || {};
  const source = sourceMetadata(data, selectedObject || raw, workspaceId, selectedObject?.sourceSection || workspace?.resourceSection);
  const objectStatus = String(firstValue(selectedObject?.status, raw.status, raw.state, unavailable));
  const sourceState = source.sourceState;
  const normalizedSourceState = sourceState.toLowerCase();
  const workspaceTrace = scopedTraceRows(data.traces, workspaceId, selectedObject)[0];
  const gate = source.sourceForbidden
    ? { kind: "forbidden", label: t("权限不足", "Permission denied"), detail: t("当前身份无权使用这个对象。", "The current identity cannot use this object.") }
    : ["error", "failed"].includes(normalizedSourceState)
      ? { kind: "error", label: t("数据加载失败", "Data failed to load"), detail: t("动作保持关闭，直到来源恢复。", "Actions remain closed until the source recovers.") }
      : ["loading", "not_loaded"].includes(normalizedSourceState)
        ? { kind: "loading", label: t("数据尚未就绪", "Data is not ready"), detail: t("等待权威来源完成加载。", "Waiting for the authoritative source to load.") }
        : source.sourceStale
          ? { kind: "stale", label: t("数据已陈旧", "Data is stale"), detail: t("动作保持关闭，直到来源刷新。", "Actions remain closed until the source refreshes.") }
          : source.sourceDegraded
            ? { kind: "degraded", label: t("来源已降级", "Source is degraded"), detail: t("受影响的动作保持关闭。", "Affected actions remain closed.") }
            : null;
  const workspaceEvidence = {
    ai: firstValue(workspaceTrace?.evidenceId, workspaceTrace?.id, asList(data.events)[0]?.id),
    live: firstValue(asList(data.markets)[0]?.updatedAt, asList(data.positions)[0]?.id, asList(data.executionOrders)[0]?.id),
    lab: firstValue(asList(data.reviews)[0]?.id, asList(data.knowledge?.sources)[0]?.id, asList(data.skills)[0]?.id),
    control: firstValue(asList(data.riskChecks)[0]?.id, asList(data.mandates)[0]?.id, asList(data.riskIncidents)[0]?.id),
    operations: firstValue(asList(data.auditLogs)[0]?.id, asList(data.tasks)[0]?.id, asList(data.jobRuns)[0]?.id),
    configuration: firstValue(asList(data.exchangeAccounts)[0]?.id, data.system?.version)
  }[workspaceId];
  return {
    evidence: String(firstValue(selectedObject?.evidence, raw.evidenceId, raw.updatedAt, workspaceEvidence, unavailable)),
    risk: String(firstValue(selectedObject?.risk, raw.risk, raw.riskLevel, raw.severity, data.portfolioRisk?.status, unavailable)),
    mandate: String(firstValue(raw.mandateId, mandate?.name, mandate?.title, mandate?.id, unavailable)),
    object: String(firstValue(selectedObject?.id, raw.id, raw.symbol, workspace?.id, unavailable)),
    version: String(firstValue(selectedObject?.version, raw.version, raw.revision, unavailable)),
    permissions: String(firstValue(selectedObject?.permission, raw.permission, raw.permissions, raw.requiredPermission, mandate?.permission, unavailable)),
    nextAction: String(firstValue(selectedObject?.nextAction, raw.nextAction, raw.allowedAction, selectedObject?.route ? `Open ${selectedObject.route}` : null, workspace?.rootRoute ? `Open ${workspace.rootRoute}` : null, unavailable)),
    title: String(firstValue(selectedObject?.title, raw.title, raw.name, raw.symbol, workspace?.labelEn, unavailable)),
    status: objectStatus,
    objectStatus,
    sourceState,
    sourceStale: source.sourceStale,
    sourceDegraded: source.sourceDegraded,
    sourceForbidden: source.sourceForbidden,
    gate,
    actionsDisabled: Boolean(gate),
    route: selectedObject?.route || workspace?.rootRoute || ""
  };
}

const TRACE_STAGE_NAMES = Object.freeze(["Sense", "Recall", "Plan", "Guard", "Execute", "Monitor", "Review"]);
const knownTraceStatus = (value) => {
  const status = String(value || "").toLowerCase();
  if (["complete", "completed", "ok", "success", "passed"].includes(status)) return "complete";
  if (["blocked", "failed", "error", "forbidden"].includes(status)) return "blocked";
  if (["waiting", "pending", "queued", "running", "active"].includes(status)) return "waiting";
  return "unavailable";
};
const collectionTrace = (value, detail) => !Array.isArray(value)
  ? { status: "unavailable", detail: unavailable }
  : { status: "waiting", detail: value.length ? `${value.length} fact${value.length === 1 ? "" : "s"} available; no scoped stage result` : detail };

function traceIdentityValues(value) {
  const raw = value?.raw || {};
  const keys = [
    "id", "objectId", "runId", "agentRunId", "agent_run_id", "sourceRunId",
    "planId", "tradePlanId", "orderId", "executionOrderId", "positionId",
    "taskId", "reviewId", "mandateId", "riskCheckId", "analysisBundleId", "subjectId"
  ];
  return new Set(keys.flatMap((key) => [value?.[key], raw?.[key]]).filter((item) => item != null && item !== "").map(String));
}

function scopedTraceRows(rows, workspaceId, selectedObject) {
  const selectedIds = traceIdentityValues(selectedObject);
  return asList(rows).filter((row) => {
    const rowWorkspace = firstValue(row.workspaceId, row.workspace, row.productWorkspace);
    if (String(rowWorkspace || "") !== String(workspaceId)) return false;
    const rowIds = traceIdentityValues({ ...row, id: null });
    if (selectedObject) return rowIds.size > 0 && [...rowIds].some((id) => selectedIds.has(id));
    return rowIds.size === 0;
  });
}

export function buildShellTrace(data = {}, workspaceId = "ai", selectedObject = null) {
  const explicit = new Map(scopedTraceRows(data.traces, workspaceId, selectedObject).map((row) => [String(row.stage || row.name || "").toLowerCase(), row]));
  const workspace = WORKSPACES[workspaceId] || (workspaceId === "configuration" ? CONFIGURATION_WORKSPACE : null);
  const resourceState = String(data.resourceState?.[workspace?.resourceSection] || "").toLowerCase();
  const blocked = ["error", "failed", "forbidden"].includes(resourceState);
  const inferred = {
    sense: collectionTrace(data.markets, "Waiting for market facts"),
    recall: collectionTrace(data.knowledge?.sources, "No recalled source in the current scope"),
    plan: collectionTrace(data.tradePlans, "No current plan"),
    guard: collectionTrace(Array.isArray(data.riskChecks) ? data.riskChecks : data.mandates, "Waiting for a guard decision"),
    execute: collectionTrace(Array.isArray(data.executionOrders) ? data.executionOrders : Array.isArray(data.orders) ? data.orders : data.fills, "No execution has started"),
    monitor: collectionTrace(Array.isArray(data.watchTriggers) ? data.watchTriggers : data.positions, "No active monitor fact"),
    review: collectionTrace(Array.isArray(data.reviews) ? data.reviews : data.auditLogs, "No review is due")
  };
  return TRACE_STAGE_NAMES.map((label) => {
    const key = label.toLowerCase();
    const row = explicit.get(key);
    return {
      id: key,
      label,
      status: row ? knownTraceStatus(row.status || row.state) : blocked ? "blocked" : inferred[key].status,
      detail: String(firstValue(row?.detail, row?.summary, row?.evidenceId, blocked ? `Workspace source is ${resourceState}` : null, inferred[key].detail, unavailable)),
      evidence: String(firstValue(row?.evidenceId, row?.id, row?.createdAt, unavailable)),
      workspaceId
    };
  });
}

export function buildCommandFacts(data = {}) {
  const freshnessMs = firstValue(data.system?.dataFreshnessMs, data.marketStatus?.dataFreshnessMs);
  const explicitFreshnessState = firstValue(data.system?.dataFreshnessState, data.marketStatus?.dataFreshnessState, data.system?.dataStale === true ? "stale" : data.system?.dataStale === false ? "fresh" : null);
  const freshnessState = String(explicitFreshnessState || (freshnessMs == null ? "unavailable" : "available"));
  const latencyMs = firstValue(data.system?.latencyMs, data.marketStatus?.latencyMs);
  return {
    freshness: {
      label: "FRESHNESS",
      value: freshnessMs == null ? unavailable : explicitFreshnessState ? `${freshnessState} · ${freshnessMs} ms` : `${freshnessMs} ms`,
      state: freshnessMs == null ? "unavailable" : freshnessState.toLowerCase()
    },
    latency: {
      label: "LATENCY",
      value: latencyMs == null ? unavailable : `${latencyMs} ms`,
      state: latencyMs == null ? "unavailable" : "available"
    }
  };
}

export function CommandRail({ data = {}, onNavigate = () => {}, onSelect = () => {} }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const index = useMemo(() => buildShellSearchIndex(data), [data]);
  const results = useMemo(() => filterShellSearchResults(index, query), [index, query]);
  const unread = asList(data.notifications).filter((row) => !row.read).length;
  const pendingReviews = asList(data.reviews).filter((row) => ["pending", "waiting", "required"].includes(String(row.status).toLowerCase())).length;
  const watchCount = asList(data.watchTriggers).length || asList(data.watches).length;
  const commandFacts = buildCommandFacts(data);
  useEffect(() => {
    const onPointer = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const onKey = (event) => runShellSearchShortcut(event, { open: () => setOpen(true), focus: () => inputRef.current?.focus() });
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); window.removeEventListener("keydown", onKey); };
  }, []);
  const select = (row) => {
    if (!row) return;
    onSelect(row);
    onNavigate(row.route, row);
    setQuery("");
    setOpen(false);
  };
  const onKeyDown = (event) => {
    if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return;
    event.preventDefault();
    const next = runShellSearchInteraction({
      key: event.key,
      activeIndex,
      results,
      onSelect,
      onNavigate,
      onClose: () => { setQuery(""); setOpen(false); }
    });
    setActiveIndex(next.activeIndex);
  };
  return <section className="commandRail" data-shell-role="command-rail" aria-label={t("全局命令栏", "Global command rail")}>
    <div className="commandRail__brand"><img src="/kordyn-logo.svg" alt=""/><span><b>KORDYN</b><small>{text(data.user?.tenantName || data.user?.organization, unavailable)}</small></span></div>
    <div className="commandRail__search" ref={rootRef}>
      <Search aria-hidden="true"/><input ref={inputRef} role="combobox" aria-expanded={open} aria-controls="shell-search-results" aria-activedescendant={results[activeIndex] ? `shell-result-${activeIndex}` : undefined} value={query} placeholder={t("搜索真实对象或功能 ⌘K", "Search objects or features ⌘K")} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }} onKeyDown={onKeyDown}/>
      {query && <button type="button" aria-label={t("清空搜索", "Clear search")} onClick={() => { setQuery(""); inputRef.current?.focus(); }}><X/></button>}
      {open && query && <div className="commandRail__results" id="shell-search-results" role="listbox">
        {results.length ? results.map((row, indexValue) => <button id={`shell-result-${indexValue}`} type="button" role="option" aria-selected={activeIndex === indexValue} className={activeIndex === indexValue ? "active" : ""} key={`${row.type}:${row.id}`} onPointerEnter={() => setActiveIndex(indexValue)} onClick={() => select(row)}><small>{row.type}</small><b>{row.title}</b><code>{row.id}</code><span>{row.status}</span></button>) : <p role="status">{t("没有匹配的已加载对象或功能。", "No loaded object or feature matches.")}</p>}
      </div>}
    </div>
    <div className="commandRail__facts" aria-label={t("全局运行事实", "Global runtime facts")}>
      <span data-state={commandFacts.freshness.state}><small>{commandFacts.freshness.label}</small><b>{commandFacts.freshness.value}</b></span>
      <span data-state={commandFacts.latency.state}><small>{commandFacts.latency.label}</small><b>{commandFacts.latency.value}</b></span>
      <span><small>WATCH</small><b>{data.watchTriggers || data.watches ? watchCount : unavailable}</b></span>
      <span><small>REVIEW</small><b>{data.reviews ? pendingReviews : unavailable}</b></span>
      <span><small>NOTICE</small><b>{data.notifications ? unread : unavailable}</b></span>
    </div>
  </section>;
}

const WORKSPACE_ICONS = { ai: Bot, live: PieChart, lab: BookOpen, control: ShieldCheck, operations: Activity };

export function WorkspaceRail({ activeWorkspace = "ai", onNavigate = () => {} }) {
  return <aside className="workspaceRail" data-shell-role="workspace-rail">
    <nav aria-label={t("工作区", "Workspaces")}>{Object.values(WORKSPACES).map((workspace) => {
      const Icon = WORKSPACE_ICONS[workspace.id] || Activity;
      const active = activeWorkspace === workspace.id;
      return <button type="button" key={workspace.id} className={active ? "active" : ""} aria-current={active ? "page" : undefined} onClick={() => onNavigate(workspace.rootRoute)}><small>{workspace.code}</small><Icon/><span><b>{t(workspace.label, workspace.labelEn)}</b><em>{t(workspace.purpose, workspace.purposeEn)}</em></span></button>;
    })}</nav>
    <button type="button" className={activeWorkspace === "configuration" ? "workspaceRail__utility active" : "workspaceRail__utility"} onClick={() => onNavigate(CONFIGURATION_WORKSPACE.rootRoute)}><small>CFG</small><Settings/><span><b>{t(CONFIGURATION_WORKSPACE.label, CONFIGURATION_WORKSPACE.labelEn)}</b><em>{t(CONFIGURATION_WORKSPACE.purpose, CONFIGURATION_WORKSPACE.purposeEn)}</em></span></button>
  </aside>;
}

const CONTEXT_FIELDS = Object.freeze([
  ["Evidence", "evidence"], ["Risk", "risk"], ["Mandate", "mandate"], ["Object", "object"],
  ["Version", "version"], ["Permissions", "permissions"], ["Next action", "nextAction"]
]);

export function ContextDock({ context = buildShellContext(), onNavigate = () => {}, collapsible = true, initiallyCollapsed = false }) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  return <aside className={`contextDock ${collapsed ? "collapsed" : ""}`} data-shell-role="context-dock" aria-label={t("上下文", "Context")}>
    <header><span><small>CONTEXT</small><b>{context.title}</b><em>{context.objectStatus || context.status}</em></span>{collapsible && <button type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} aria-label={collapsed ? t("展开上下文", "Expand context") : t("收起上下文", "Collapse context")}>{collapsed ? <ChevronDown/> : <ChevronUp/>}</button>}</header>
    {!collapsed && <>{context.gate && <section className={`contextDock__gate state-${context.gate.kind}`} role="status"><b>{context.gate.label}</b><p>{context.gate.detail}</p><small>SOURCE · {context.sourceState}</small></section>}<dl>{CONTEXT_FIELDS.map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{text(context[key], unavailable)}</dd></div>)}</dl><footer><button type="button" disabled={context.actionsDisabled || !context.route} onClick={() => context.route && !context.actionsDisabled && onNavigate(context.route)}>{context.nextAction}</button></footer></>}
  </aside>;
}

export function TraceRail({ stages = buildShellTrace(), initiallyExpanded = "" }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const selected = stages.find((stage) => stage.id === expanded);
  return <section className={`traceRail ${selected ? "expanded" : ""}`} data-shell-role="trace-rail" aria-label={t("当前工作区追踪", "Current workspace trace")}>
    {selected && <article className="traceRail__detail"><header><span><small>TRACE DETAIL</small><b>{selected.label}</b></span><button type="button" aria-label={t("收起追踪详情", "Collapse trace detail")} onClick={() => setExpanded("")}><X/></button></header><dl><div><dt>STATUS</dt><dd>{selected.status}</dd></div><div><dt>EVIDENCE</dt><dd>{selected.evidence}</dd></div><div><dt>DETAIL</dt><dd>{selected.detail}</dd></div></dl></article>}
    <nav>{stages.map((stage, index) => <React.Fragment key={stage.id}><button type="button" className={`traceRail__stage status-${stage.status}`} aria-expanded={expanded === stage.id} onClick={() => setExpanded(expanded === stage.id ? "" : stage.id)}><small>{String(index + 1).padStart(2, "0")}</small><b>{stage.label}</b><span>{stage.status}</span></button>{index < stages.length - 1 && <i aria-hidden="true">→</i>}</React.Fragment>)}</nav>
  </section>;
}

function groupViews(views) {
  return views.reduce((groups, view) => {
    const id = view.group || "views";
    let group = groups.find((item) => item.id === id);
    if (!group) {
      group = { id, label: view.group || "视图", labelEn: view.groupEn || "VIEWS", views: [] };
      groups.push(group);
    }
    group.views.push(view);
    return groups;
  }, []);
}

export function ProductWorkspaceFrame({ workspaceId, activeView, views = [], onViewChange = () => {}, inspector, children }) {
  const workspace = WORKSPACES[workspaceId] || (workspaceId === "configuration" ? CONFIGURATION_WORKSPACE : WORKSPACES.ai);
  const activeItem = views.find((view) => view.id === activeView) || views[0] || {
    label: workspace.label, labelEn: workspace.labelEn, description: workspace.purpose, descriptionEn: workspace.purposeEn
  };
  const groups = groupViews(views);
  return (
    <section className="productWorkspaceFrame" data-product-workspace={workspace.id}>
      <header className="productWorkspaceFrame__header">
        <div>
          <small>{workspace.code} / {t(workspace.eyebrow, workspace.eyebrowEn)}</small>
          <h1>{t(workspace.label, workspace.labelEn)}</h1>
          <p>{t(workspace.purpose, workspace.purposeEn)}</p>
        </div>
        <aside aria-label={t("当前视图", "Current view")}>
          <small>CURRENT WORKSPACE</small>
          <b>{t(activeItem.label, activeItem.labelEn)}</b>
          <span>{t(activeItem.description || "", activeItem.descriptionEn || activeItem.description || "")}</span>
        </aside>
      </header>
      {views.length > 0 && <nav className="productWorkspaceFrame__nav" aria-label={`${t(workspace.label, workspace.labelEn)} ${t("子页面", "sections")}`}>
        {groups.map((group) => <div key={group.id} className="productWorkspaceFrame__navGroup">
          <small>{t(group.label, group.labelEn)}</small>
          <div>{group.views.map((view) => <button type="button" key={view.id} aria-current={activeView === view.id ? "page" : undefined} className={activeView === view.id ? "active" : ""} onClick={() => onViewChange(view.id)}>{t(view.label, view.labelEn)}</button>)}</div>
        </div>)}
      </nav>}
      <div className={inspector ? "productWorkspaceFrame__grid" : "productWorkspaceFrame__grid productWorkspaceFrame__grid--single"}>
        <div className="productWorkspaceFrame__body">{children}</div>
        {inspector ? <aside className="productWorkspaceFrame__inspector">{inspector}</aside> : null}
      </div>
    </section>
  );
}

export function ObjectInspector({ object = {}, onOpenPrimary }) {
  const consumers = Array.isArray(object.consumers) ? object.consumers : object.consumers ? [object.consumers] : [];
  const canOpen = Boolean(object.primaryRoute && onOpenPrimary);
  return <section className="objectInspector" aria-label={t("对象详情", "Object inspector")}>
    <header><small>{text(object.type, "OBJECT")} · {text(object.id)}</small><h2>{text(object.title)}</h2><span>{text(object.status)}</span></header>
    <dl>
      <div><dt>SOURCE</dt><dd>{text(object.source)}</dd></div>
      <div><dt>VERSION</dt><dd>{text(object.version)}</dd></div>
      <div><dt>PERMISSION</dt><dd>{text(object.permission)}</dd></div>
      <div><dt>RISK</dt><dd>{text(object.risk)}</dd></div>
      <div><dt>CONSUMERS</dt><dd>{consumers.length ? <ul>{consumers.map((item) => <li key={item}>{item}</li>)}</ul> : "—"}</dd></div>
      <div><dt>NEXT ACTION</dt><dd>{text(object.nextAction)}</dd></div>
    </dl>
    <footer><small>PRIMARY WORKBENCH</small><button type="button" disabled={!canOpen} data-primary-route={object.primaryRoute || undefined} onClick={() => canOpen && onOpenPrimary(object.primaryRoute)}>{t("打开权威工作台", "Open primary workbench")}</button></footer>
  </section>;
}

function StatePanel({ kind, title, detail, onRetry }) {
  return <section className={`workspaceState workspaceState--${kind}`} role={kind === "error" ? "alert" : "status"}>
    <i aria-hidden="true" />
    <div><b>{title}</b>{detail && <span>{detail}</span>}</div>
    {onRetry && <button type="button" onClick={onRetry}>{t("重试", "Retry")}</button>}
  </section>;
}

export function WorkspaceStateBoundary({ resourceState = "loaded", empty = false, stale = false, degraded = false, forbidden = "", actionOutcome = null, onRetry, children }) {
  if (forbidden) return <StatePanel kind="forbidden" title={t("需要权限", "Permission required")} detail={t(`当前操作需要 ${forbidden} 权限。`, `This surface requires ${forbidden} permission.`)} />;
  if (resourceState === "not_loaded") return <StatePanel kind="loading" title={t("尚未加载", "Not loaded")} detail={t("进入工作区后再请求真实数据。", "Real data loads when the workspace opens.")} />;
  if (resourceState === "loading") return <StatePanel kind="loading" title={t("正在加载", "Loading")} detail={t("正在读取当前工作区事实。", "Loading current workspace facts.")} />;
  if (resourceState === "error") return <StatePanel kind="error" title={t("加载失败", "Workspace failed to load")} detail={t("空白不代表数据为零，请重新加载。", "Blank values do not mean zero. Retry the workspace request.")} onRetry={onRetry} />;
  if (empty) return <StatePanel kind="empty" title={t("暂无数据", "No data")} detail={t("当前筛选或权限范围内没有记录。", "No records exist in the current filter or permission scope.")} />;
  return <div className="workspaceStateBoundary">
    {stale && <StatePanel kind="warning" title={t("数据已陈旧", "Data is stale")} detail={t("保留最后有效事实；执行前需要刷新。", "The last valid facts remain visible; refresh before execution.")} onRetry={onRetry} />}
    {degraded && <StatePanel kind="warning" title={t("服务降级", "Service degraded")} detail={t("部分事实不可用，受影响的动作会保持关闭。", "Some facts are unavailable; affected actions remain closed.")} onRetry={onRetry} />}
    {actionOutcome?.kind === "error" && <StatePanel kind="error" title={t("操作失败", "Action failed")} detail={text(actionOutcome.message, t("服务端未确认变更。", "The server did not confirm the change."))} />}
    {actionOutcome?.kind === "success" && <StatePanel kind="success" title={t("操作已确认", "Action confirmed")} detail={text(actionOutcome.message)} />}
    {children}
  </div>;
}
