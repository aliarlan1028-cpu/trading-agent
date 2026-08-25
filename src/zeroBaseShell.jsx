import { useMemo, useState } from "react";
import { PanelRight, Route, Search } from "lucide-react";
import { t } from "./i18n.js";
import { ZERO_BASE_FAMILIES, ZERO_BASE_GROUPS } from "./zeroBaseArchitecture.js";
import { ContextDock, TraceRail } from "./productShell.jsx";

const familyDescriptions = Object.freeze({
  today: ["AI 主导的今日重点、账户真相与待行动事项", "AI-led priorities, account truth, and items requiring action"],
  ai: ["对话、巡检、情报、盯盘、事件与分析输出", "Conversation, patrol, intelligence, watch, events, and analysis outputs"],
  portfolio: ["账户、市场、持仓、计划、订单与保护", "Account, market, positions, plans, orders, and protection"],
  strategy: ["策略登记、构建、历史验证与前向验证", "Strategy registry, construction, historical and forward validation"],
  knowledge: ["知识来源、证据、关系与可用产物", "Knowledge sources, evidence, relationships, and usable artifacts"],
  capability: ["原生工具、工作流、连接器与导入技能", "Native tools, workflows, connectors, and imported skills"],
  reviews: ["交易复盘、候选教训与 Owner 优化", "Trade reviews, candidate lessons, and Owner optimization"],
  guard: ["风险姿态、事件风险、权限边界与规则", "Risk posture, event risk, permission boundaries, and rules"],
  operations: ["系统健康、任务、恢复、通知与审计", "System health, tasks, recovery, notifications, and audit"],
  configuration: ["全部持久配置的统一入口", "The single home for durable configuration"]
});

const familyById = new Map(ZERO_BASE_FAMILIES.map((family) => [family.id, family]));

function visibleViews(family, data) {
  if (family.id !== "today") return family.views;
  const owner = data?.user?.isOwner === true || ["owner", "admin"].includes(String(data?.user?.role || "").toLowerCase());
  return family.views.filter((view) => view.id === (owner ? "owner" : "trader") || view.id === "actions");
}

function runtimeLabel(data) {
  if (data?.system?.killSwitch === true) return t("紧急停止", "Emergency stop");
  if (data?.connectionError) return t("连接异常", "Connection issue");
  return t("系统在线", "System online");
}

export function ZeroBaseDesktopShell({
  data = {},
  activeFamilyId = "today",
  activeViewId = "owner",
  onFamilyNavigate = () => {},
  renderTopbar,
  context,
  trace = [],
  selectedObject = null,
  overlays = null,
  children
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const activeFamily = familyById.get(activeFamilyId) || ZERO_BASE_FAMILIES[0];
  const views = useMemo(() => visibleViews(activeFamily, data), [activeFamily, data?.user?.isOwner, data?.user?.role]);
  const currentView = views.find((view) => view.id === activeViewId) || views[0];
  const description = familyDescriptions[activeFamily.id] || ["", ""];
  const shellTools = <div className="zbShellTools" aria-label={t("上下文工具", "Context tools")}>
    <button type="button" data-zero-base-tool="context" aria-pressed={contextOpen} onClick={() => { setContextOpen((open) => !open); setTraceOpen(false); }}><PanelRight /><span>CONTEXT</span></button>
    <button type="button" data-zero-base-tool="trace" aria-pressed={traceOpen} onClick={() => { setTraceOpen((open) => !open); setContextOpen(false); }}><Route /><span>TRACE</span></button>
  </div>;

  return <div className="appShell kordynSystem zeroBaseProduct zbShell"
    data-zero-base-shell="desktop"
    data-zero-base-family={activeFamily.id}
    data-zero-base-view={currentView?.id || activeFamily.defaultView}
    data-shell-selected-object={selectedObject?.id || "none"}
    data-shell-selected-type={selectedObject?.type || "none"}
    data-shell-selected-workspace={selectedObject?.workspaceId || "none"}
    data-shell-selected-source={selectedObject?.sourceSection || "none"}
    data-shell-selected-route={selectedObject?.route || "none"}
    data-shell-selected-evidence={selectedObject?.evidence || "Unavailable"}>
    <aside className="zbNavigation" data-shell-role="zero-base-navigation">
      <div className="zbNavigation__brand"><img src="/kordyn-logo-white.svg" alt="" /><span><strong>KORDYN</strong><small>WEB3 TRADING OS</small></span></div>
      <nav aria-label={t("产品导航", "Product navigation")}>
        {ZERO_BASE_GROUPS.map((group) => <section className="zbNavigation__group" key={group.id} data-zero-base-group={group.id}>
          <small>{t(group.label, group.labelEn)}</small>
          <div>{group.families.map((familyId) => { const family = familyById.get(familyId); const active = activeFamily.id === family.id; const defaultView = family.id === "today" ? visibleViews(family, data)[0]?.id || family.defaultView : family.defaultView; return <button type="button" className="zbNavigation__item" key={family.id} data-zero-base-family={family.id} aria-current={active ? "page" : undefined} onClick={() => onFamilyNavigate(family.id, defaultView)}><i>{family.code}</i><b>{t(family.label, family.labelEn)}</b><em>{active ? "NOW" : "OPEN"}</em></button>; })}</div>
        </section>)}
      </nav>
      <div className="zbNavigation__status"><small>SYSTEM BOUNDARY</small><b><i />{runtimeLabel(data)}</b></div>
    </aside>

    {renderTopbar ? renderTopbar({ shellTools }) : <header className="appTopbar zbTopbar"><div className="zbTopbar__title"><small>{activeFamily.code} / KORDYN</small><b>{t(activeFamily.label, activeFamily.labelEn)}</b></div><div className="zbTopbar__search"><Search />{t("搜索对象或功能", "Search objects or features")}</div>{shellTools}</header>}

    <main className="mainArea">
      <div className="content zbPage">
        <header className="zbPage__header">
          <div><span className="zbPage__eyebrow">{activeFamily.code} / {activeFamily.group}</span><h1>{t(activeFamily.label, activeFamily.labelEn)}</h1><p>{t(description[0], description[1])}</p></div>
          {views.length > 0 && <nav className="zbSubnav" aria-label={`${t(activeFamily.label, activeFamily.labelEn)} ${t("子页面", "views")}`}>{views.map((view) => <button type="button" key={view.id} aria-current={currentView?.id === view.id ? "page" : undefined} onClick={() => onFamilyNavigate(activeFamily.id, view.id)}>{t(view.label, view.labelEn)}</button>)}</nav>}
        </header>
        {children}
      </div>
    </main>

    {(contextOpen || traceOpen) && <button className="zbShellScrim" type="button" aria-label={t("关闭上下文工具", "Close context tools")} onClick={() => { setContextOpen(false); setTraceOpen(false); }} />}
    <ContextDock className="zbShellContext" hidden={!contextOpen} context={context} onNavigate={(route) => onFamilyNavigate(null, null, route)} collapsible={false} />
    <TraceRail className="zbShellTrace" hidden={!traceOpen} stages={trace} />
    {overlays}
  </div>;
}
