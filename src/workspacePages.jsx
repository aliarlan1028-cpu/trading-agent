import { useState } from "react";
import {
  AiDialogConcept, AuditConcept, CapabilitiesConcept, EventsConcept,
  ExecutionLedgerConcept, ExecutionReviewConcept, IntelligenceConcept, KnowledgeConcept,
  MandateConcept, MarketConcept, NotificationsConcept, WatchMonitorConcept,
  OwnerReviewWorkspaceConcept, TradeReviewWorkbenchConcept,
  OperationsOverviewConcept, PositionsConcept,
  RiskIncidentsConcept, RiskPostureConcept, RulesConcept, SettingsConcept, StrategyLibraryConcept,
  TasksConcept, TradingOverviewConcept
} from "./conceptPages.jsx";
import { t } from "./i18n.js";

const TABS = {
  ai: [["dialog", "对话", "Dialog"], ["intel", "情报", "Intel"], ["watch", "盯盘", "Watch"]],
  trade: [["overview", "总览", "Overview"], ["market", "行情", "Market"], ["positions", "持仓", "Positions"], ["execution", "执行中心", "Execution Center"], ["reviews", "交易复盘", "Trade Reviews"], ["owner", "Owner 优化", "Owner Review"]],
  research: [["knowledge", "知识孵化台", "Knowledge Incubator"], ["strategy", "策略库", "Strategies"], ["capabilities", "能力库", "Capabilities"]],
  risk: [["posture", "当前风险", "Current Risk"], ["mandate", "交易授权", "Trading Mandate"], ["rules", "保护规则", "Protection Rules"], ["incidents", "事件与恢复", "Incidents & Recovery"]],
  ops: [["overview", "运行总览", "Overview"], ["events", "事件日历", "Events"], ["tasks", "任务调度", "Tasks"], ["audit", "审计记录", "Audit"], ["notifications", "通知中心", "Notifications"]]
};

function CenterShell({ title, subtitle, tabs, active, onChange, children, tabsExtra }) {
  const eyebrow = ({
    "AI 交易员": "AI · CONNECTED WORKSPACE", "AI Trader": "AI · CONNECTED WORKSPACE",
    "交易驾驶舱": "COCKPIT · CONNECTED WORKSPACE", "Trading Cockpit": "COCKPIT · CONNECTED WORKSPACE",
    "研究中心": "RESEARCH · CONNECTED WORKSPACE", "Research": "RESEARCH · CONNECTED WORKSPACE",
    "风控中心": "RISK · CONNECTED WORKSPACE", "Risk Center": "RISK · CONNECTED WORKSPACE",
    "系统运营": "OPERATIONS · CONNECTED WORKSPACE", "Operations": "OPERATIONS · CONNECTED WORKSPACE"
  })[title] || "KORDYN · CONNECTED WORKSPACE";
  const tabNav = <nav className="uxTabs tabs" aria-label={`${title} ${t("子页面", "sections")}`}>{tabs.map(([id, label, labelEn]) => <button key={id} className={active === id ? "active" : ""} onClick={() => onChange(id)}>{t(label, labelEn)}</button>)}</nav>;
  return (
    <div className="uxCenter prototype-page">
      <header className="uxCenterHead page-head"><div className="uxHeadLeft"><div className="uxEyebrow eyebrow">{eyebrow}</div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div><div className="uxHeadRight page-actions">{tabsExtra}<span className="context-note">{t("功能不变 · 信息归位 · 共享真实状态", "Same capabilities · one source of truth")}</span></div></header>
      {tabNav}
      <div className={`uxCenterBody page-body uxSection-${active}`}>{children}</div>
    </div>
  );
}

export function AiTraderCenter({ data, action, ui, initialTab = "dialog" }) {
  const [tab, setTab] = useState(initialTab);
  const [newChatToken, setNewChatToken] = useState(0);
  const extra = tab === "dialog" ? <button type="button" className="btn" onClick={() => setNewChatToken((value) => value + 1)}>{t("新建对话", "New conversation")}</button> : null;
  const page = tab === "dialog" ? <AiDialogConcept data={data} action={action} ui={ui} resetToken={newChatToken}/> : tab === "intel" ? <IntelligenceConcept data={data} action={action} ui={ui}/> : <WatchMonitorConcept data={data} action={action} ui={ui}/>;
  return <CenterShell title={t("AI 交易员","AI Trader")} subtitle={t("对话、情报和盯盘使用同一轮市场事实。","Dialog, intel, and watch share one market-fact cycle.")} tabs={TABS.ai} active={tab} onChange={setTab} tabsExtra={extra}>{page}</CenterShell>;
}

export function TradingCenter({ data, action, ui, initialTab = "overview", reviewInitialId = "" }) {
  const [tab, setTab] = useState(initialTab);
  const tabs = data.user?.isOwner === true ? TABS.trade : TABS.trade.filter(([id]) => id !== "owner");
  const pages = {
    overview: <TradingOverviewConcept data={data} action={action} ui={ui}/>,
    market: <MarketConcept data={data} action={action} ui={ui}/>,
    positions: <PositionsConcept data={data} action={action} ui={ui}/>,
    execution: <ExecutionCenter data={data} action={action} ui={ui} initialView={initialTab === "ledger" ? "ledger" : "flow"}/>,
    reviews: <TradeReviewWorkbenchConcept data={data} action={action} ui={ui} initialReviewId={reviewInitialId}/>,
    owner: data.user?.isOwner === true ? <OwnerReviewWorkspaceConcept data={data} action={action} ui={ui}/> : null
  };
  const safeTab = tab === "ledger" ? "execution" : tabs.some(([id]) => id === tab) ? tab : "overview";
  const subtitle = data.user?.isOwner === true
    ? t("从账户和行情总览进入执行、复盘和 Owner 优化。","Move from account and market facts into execution, review, and Owner improvement.")
    : t("从账户和行情总览进入执行与交易复盘。","Move from account and market facts into execution and trade review.");
  return <CenterShell title={t("交易驾驶舱","Trading Cockpit")} subtitle={subtitle} tabs={tabs} active={safeTab} onChange={setTab}>{pages[safeTab] || pages.overview}</CenterShell>;
}

function ExecutionCenter({ data, action, ui, initialView = "flow" }) {
  const [view,setView]=useState(initialView);
  return <div className="cp2Stack executionConnected"><nav className="executionLocalNav" aria-label={t("执行中心视图","Execution center views")}><button type="button" className={view==="flow"?"active":""} onClick={()=>setView("flow")}><span>01</span><b>{t("执行链路","Execution flow")}</b><small>{t("计划到成交","Plan to fill")}</small></button><button type="button" className={view==="ledger"?"active":""} onClick={()=>setView("ledger")}><span>02</span><b>{t("委托与成交","Orders & fills")}</b><small>{t("同一生命周期的真实记录","Real lifecycle records")}</small></button></nav>{view==="flow"?<ExecutionReviewConcept data={data} action={action} ui={ui}/>:<ExecutionLedgerConcept data={data} action={action} ui={ui}/>}</div>;
}

export function ResearchCenter({ data, action, ui, initialTab = "knowledge", strategyInitialTab = "catalog" }) {
  const [tab, setTab] = useState(initialTab);
  const pages = {
    knowledge: <KnowledgeConcept data={data} action={action} ui={ui}/>,
    strategy: <StrategyLibraryConcept data={data} action={action} ui={ui} initialTab={strategyInitialTab}/>,
    capabilities: <CapabilitiesConcept data={data} action={action} ui={ui}/>
  };
  return <CenterShell title={t("研究中心","Research")} subtitle={t("知识在孵化区验证，通过后才进入正式策略和能力目录。","Knowledge is validated in incubation before entering official strategy and capability catalogs.")} tabs={TABS.research} active={tab} onChange={setTab}>{pages[tab] || pages.knowledge}</CenterShell>;
}

export function RiskCenter({ data, action, ui, initialTab = "posture" }) {
  const [tab, setTab] = useState(initialTab);
  const pages = {
    posture: <RiskPostureConcept data={data} ui={ui}/>,
    mandate: <MandateConcept data={data} action={action} ui={ui}/>,
    rules: <RulesConcept data={data} action={action} ui={ui}/>,
    incidents: <RiskIncidentsConcept data={data} action={action} ui={ui}/>
  };
  return <CenterShell title={t("风控中心","Risk Center")} subtitle={t("运行状态、交易授权、保护规则和恢复条件的唯一事实源。","The single source of truth for runtime state, mandate, protection, and recovery.")} tabs={TABS.risk} active={tab} onChange={setTab}>{pages[tab] || pages.posture}</CenterShell>;
}

export function OperationsCenter({ data, action, ui, initialTab = "overview" }) {
  const [tab, setTab] = useState(initialTab);
  const pages = {
    overview: <OperationsOverviewConcept data={data} action={action} ui={ui}/>,
    events: <EventsConcept data={data} action={action} ui={ui}/>,
    tasks: <TasksConcept data={data} action={action} ui={ui}/>,
    audit: <AuditConcept data={data} action={action} ui={ui}/>,
    notifications: <NotificationsConcept data={data} action={action} ui={ui}/>
  };
  return <CenterShell title={t("系统运营","Operations")} subtitle={t("沿真实依赖链检查系统健康；事件、任务、审计和通知各自归位。","Inspect health along the real dependency chain; events, tasks, audit, and notifications stay in their own workspace.")} tabs={TABS.ops} active={tab} onChange={setTab}>{pages[tab] || pages.overview}</CenterShell>;
}

export { SettingsConcept };
