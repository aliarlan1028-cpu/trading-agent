import React, { useState } from "react";
import {
  AiDialogConcept, AuditConcept, CapabilitiesConcept, EventsConcept,
  IntelligenceConcept, JournalConcept, KeysConcept, KnowledgeConcept,
  LiveConcept, MandateConcept, MarketConcept, NotificationsConcept,
  OperationsOverviewConcept, OrdersConcept, PositionsConcept,
  RiskPostureConcept, RulesConcept, SettingsConcept, StrategyConcept,
  TasksConcept, TradingOverviewConcept
} from "./conceptPages.jsx";
import { ChatKpiStrip } from "./chat.jsx";
import "./workspace.css";
import "./workspace-additions.css";

const TABS = {
  ai: [["dialog", "对话"], ["intel", "情报"]],
  trade: [["overview", "总览"], ["market", "行情"], ["positions", "持仓"], ["orders", "订单与成交"], ["journal", "交易日志"]],
  research: [["knowledge", "知识库"], ["capabilities", "能力与工具"], ["strategy", "策略与分析"]],
  risk: [["posture", "风险姿态"], ["mandate", "授权边界"], ["rules", "风险规则"], ["live", "实盘与灰度"], ["keys", "密钥安全"]],
  ops: [["overview", "运行总览"], ["events", "事件日历"], ["tasks", "任务调度"], ["audit", "审计记录"], ["notifications", "通知中心"]]
};

function CenterShell({ title, subtitle, tabs, active, onChange, children, tabsExtra }) {
  return (
    <div className="uxCenter">
      <header className="uxCenterHead"><div><h1>{title}</h1><span>{subtitle}</span></div>{tabsExtra && <div className="uxHeadExtra">{tabsExtra}</div>}</header>
      <nav className="uxTabs" aria-label={`${title}子页面`}>
        {tabs.map(([id, label]) => <button key={id} className={active === id ? "active" : ""} onClick={() => onChange(id)}>{label}</button>)}
      </nav>
      <div className={`uxCenterBody uxSection-${active}`}>{children}</div>
    </div>
  );
}

export function AiTraderCenter({ data, action, ui, initialTab = "dialog" }) {
  const [tab, setTab] = useState(initialTab);
  return <CenterShell title="AI 交易员" subtitle="对话 · 决策 · 执行" tabs={TABS.ai} active={tab} onChange={setTab} tabsExtra={tab === "dialog" ? <ChatKpiStrip data={data} bar/> : null}>{tab === "dialog" ? <AiDialogConcept data={data} action={action} ui={ui}/> : <IntelligenceConcept data={data} action={action} ui={ui}/>}</CenterShell>;
}

export function TradingCenter({ data, action, ui, initialTab = "overview" }) {
  const [tab, setTab] = useState(initialTab);
  const pages = {
    overview: <TradingOverviewConcept data={data} action={action} ui={ui}/>,
    market: <MarketConcept data={data} action={action} ui={ui}/>,
    positions: <PositionsConcept data={data} action={action} ui={ui}/>,
    orders: <OrdersConcept data={data} action={action} ui={ui}/>,
    journal: <JournalConcept data={data} action={action} ui={ui}/>
  };
  return <CenterShell title="交易驾驶舱" subtitle="行情 · 账户 · 执行 · 复盘" tabs={TABS.trade} active={tab} onChange={setTab}>{pages[tab] || pages.overview}</CenterShell>;
}

export function ResearchCenter({ data, action, ui, initialTab = "knowledge" }) {
  const [tab, setTab] = useState(initialTab);
  const pages = {
    knowledge: <KnowledgeConcept data={data} action={action} ui={ui}/>,
    capabilities: <CapabilitiesConcept data={data} action={action} ui={ui}/>,
    strategy: <StrategyConcept data={data} action={action} ui={ui}/>
  };
  return <CenterShell title="研究中心" subtitle="知识 · 能力 · 策略 · 验证" tabs={TABS.research} active={tab} onChange={setTab}>{pages[tab] || pages.knowledge}</CenterShell>;
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
  return <CenterShell title="风控中心" subtitle="姿态 · 授权 · 规则 · 安全" tabs={TABS.risk} active={tab} onChange={setTab}>{pages[tab] || pages.posture}</CenterShell>;
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
  return <CenterShell title="系统运营" subtitle="事件 · 任务 · 审计 · 可观测" tabs={TABS.ops} active={tab} onChange={setTab}>{pages[tab] || pages.overview}</CenterShell>;
}

export { SettingsConcept };
