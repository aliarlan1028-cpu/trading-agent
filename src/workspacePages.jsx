import React, { useState } from "react";
import {
  AiDialogConcept, AuditConcept, CapabilitiesConcept, EventsConcept,
  ExecutionReviewConcept, IntelligenceConcept, KeysConcept, KnowledgeConcept,
  LiveConcept, MandateConcept, MarketConcept, NotificationsConcept,
  OperationsOverviewConcept, PositionsConcept,
  RiskPostureConcept, RulesConcept, SettingsConcept, StrategyLibraryConcept,
  TasksConcept, TradingOverviewConcept
} from "./conceptPages.jsx";
import { ChatKpiStrip } from "./chat.jsx";
import { t } from "./i18n.js";
import "./workspace.css";
import "./workspace-additions.css";

const TABS = {
  ai: [["dialog", "对话", "Dialog"], ["intel", "情报", "Intel"]],
  trade: [["overview", "总览", "Overview"], ["market", "行情", "Market"], ["positions", "持仓", "Positions"], ["execution", "执行与复盘", "Execution & Review"]],
  research: [["knowledge", "知识库", "Knowledge"], ["strategy", "策略库", "Strategies"], ["capabilities", "能力库", "Capabilities"]],
  risk: [["posture", "风险姿态", "Posture"], ["mandate", "授权边界", "Mandate"], ["rules", "规则库", "Rules"], ["live", "实盘与灰度", "Live"], ["keys", "密钥安全", "Keys"]],
  ops: [["overview", "运行总览", "Overview"], ["events", "事件日历", "Events"], ["tasks", "任务调度", "Tasks"], ["audit", "审计记录", "Audit"], ["notifications", "通知中心", "Notifications"]]
};

function CenterShell({ title, subtitle, tabs, active, onChange, children, tabsExtra, inlineTabs }) {
  // inlineTabs 只给 AI 交易员:Tab 内联到标题行;其他页面保持标题行 + 单独 Tab 行(原样)。
  const tabNav = <nav className={`uxTabs ${inlineTabs ? "uxTabsInline" : ""}`} aria-label={`${title}子页面`}>{tabs.map(([id, label, labelEn]) => <button key={id} className={active === id ? "active" : ""} onClick={() => onChange(id)}>{t(label, labelEn)}</button>)}</nav>;
  return (
    <div className="uxCenter">
      <header className="uxCenterHead"><div className="uxHeadLeft"><h1>{title}</h1>{subtitle && <span>{subtitle}</span>}{inlineTabs && tabNav}</div>{tabsExtra && <div className="uxHeadExtra">{tabsExtra}</div>}</header>
      {!inlineTabs && tabNav}
      <div className={`uxCenterBody uxSection-${active}`}>{children}</div>
    </div>
  );
}

export function AiTraderCenter({ data, action, ui, initialTab = "dialog" }) {
  const [tab, setTab] = useState(initialTab);
  return <CenterShell title={t("AI 交易员","AI Trader")} subtitle="" tabs={TABS.ai} active={tab} onChange={setTab} inlineTabs tabsExtra={tab === "dialog" ? <ChatKpiStrip data={data} bar/> : null}>{tab === "dialog" ? <AiDialogConcept data={data} action={action} ui={ui}/> : <IntelligenceConcept data={data} action={action} ui={ui}/>}</CenterShell>;
}

export function TradingCenter({ data, action, ui, initialTab = "overview" }) {
  const [tab, setTab] = useState(initialTab);
  const pages = {
    overview: <TradingOverviewConcept data={data} action={action} ui={ui}/>,
    market: <MarketConcept data={data} action={action} ui={ui}/>,
    positions: <PositionsConcept data={data} action={action} ui={ui}/>,
    execution: <ExecutionReviewConcept data={data} action={action} ui={ui}/>
  };
  return <CenterShell title={t("交易驾驶舱","Trading Cockpit")} subtitle={t("行情 · 账户 · 执行 · 复盘","Market · Account · Execution · Review")} tabs={TABS.trade} active={tab} onChange={setTab}>{pages[tab] || pages.overview}</CenterShell>;
}

export function ResearchCenter({ data, action, ui, initialTab = "knowledge" }) {
  const [tab, setTab] = useState(initialTab);
  const pages = {
    knowledge: <KnowledgeConcept data={data} action={action} ui={ui}/>,
    strategy: <StrategyLibraryConcept data={data} action={action} ui={ui}/>,
    capabilities: <CapabilitiesConcept data={data} action={action} ui={ui}/>
  };
  return <CenterShell title={t("研究中心","Research")} subtitle={t("知识库 · 策略库 · 能力库","Knowledge · Strategies · Capabilities")} tabs={TABS.research} active={tab} onChange={setTab}>{pages[tab] || pages.knowledge}</CenterShell>;
}

export function RiskCenter({ data, action, ui, initialTab = "posture" }) {
  const [tab, setTab] = useState(initialTab);
  const pages = {
    posture: <RiskPostureConcept data={data} action={action} ui={ui}/>,
    mandate: <MandateConcept data={data} action={action} ui={ui}/>,
    rules: <RulesConcept data={data} action={action} ui={ui}/>,
    live: <LiveConcept data={data} action={action} ui={ui}/>,
    keys: <KeysConcept data={data} action={action} ui={ui}/>
  };
  return <CenterShell title={t("风控中心","Risk Center")} subtitle={t("姿态 · 授权 · 规则 · 安全","Posture · Mandate · Rules · Security")} tabs={TABS.risk} active={tab} onChange={setTab}>{pages[tab] || pages.posture}</CenterShell>;
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
  return <CenterShell title={t("系统运营","Operations")} subtitle={t("事件 · 任务 · 审计 · 可观测","Events · Tasks · Audit · Observability")} tabs={TABS.ops} active={tab} onChange={setTab}>{pages[tab] || pages.overview}</CenterShell>;
}

export { SettingsConcept };
