import React, { useState } from "react";
import {
  AiDialogConcept, AuditConcept, CapabilitiesConcept, EventsConcept,
  ExecutionLedgerConcept, ExecutionReviewConcept, IntelligenceConcept, KeysConcept, KnowledgeConcept,
  MandateConcept, MarketConcept, NotificationsConcept, WatchMonitorConcept,
  OperationsOverviewConcept, PositionsConcept,
  RiskPostureConcept, RulesConcept, SettingsConcept, StrategyLibraryConcept,
  TasksConcept, TradingOverviewConcept
} from "./conceptPages.jsx";
import { ChatKpiStrip } from "./chat.jsx";
import { Eye, ShieldCheck } from "lucide-react";
import { t } from "./i18n.js";
import "./workspace.css";
import "./workspace-additions.css";

const TABS = {
  ai: [["dialog", "对话", "Dialog"], ["intel", "情报", "Intel"], ["watch", "盯盘", "Watch"]],
  trade: [["overview", "总览", "Overview"], ["market", "行情", "Market"], ["positions", "持仓", "Positions"], ["execution", "执行与复盘", "Execution & Review"], ["ledger", "委托与成交", "Orders & Fills"]],
  research: [["knowledge", "知识库", "Knowledge"], ["strategy", "策略库", "Strategies"], ["capabilities", "能力库", "Capabilities"]],
  risk: [["posture", "风险总览", "Overview"], ["mandate", "资金与交易边界", "Capital & Trading Limits"], ["rules", "风控规则", "Risk Rules"], ["keys", "密钥安全", "Key Security"]],
  ops: [["overview", "运行总览", "Overview"], ["events", "事件日历", "Events"], ["tasks", "任务调度", "Tasks"], ["audit", "审计记录", "Audit"], ["notifications", "通知中心", "Notifications"]]
};

function CenterShell({ title, subtitle, tabs, active, onChange, children, tabsExtra, inlineTabs }) {
  // inlineTabs 只给 AI 交易员:Tab 内联到标题行;其他页面保持标题行 + 单独 Tab 行(原样)。
  const tabNav = <nav className={`uxTabs ${inlineTabs ? "uxTabsInline" : ""}`} aria-label={`${title} ${t("子页面", "sections")}`}>{tabs.map(([id, label, labelEn]) => <button key={id} className={active === id ? "active" : ""} onClick={() => onChange(id)}>{t(label, labelEn)}</button>)}</nav>;
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
  const activeWatches = (data.watchTriggers || []).filter((item) => item.status === "active").length;
  const mandate = (data.mandates || []).find((item) => ["active", "running"].includes(item.status));
  const extra = tab === "dialog" ? <div className="aiTopCluster"><ChatKpiStrip data={data} bar/><div className="aiTopLinks"><button onClick={()=>ui.setActive("riskMandate")}><ShieldCheck/>{t("交易限制", "Trading limits")}<b>{mandate?.maxOrderNotionalUsdt ? `${mandate.maxOrderNotionalUsdt} U` : "—"}</b></button><button onClick={()=>setTab("watch")}><Eye/>{t("实时盯盘", "Live watch")}<b>{activeWatches}</b></button></div></div> : null;
  const page = tab === "dialog" ? <AiDialogConcept data={data} action={action} ui={ui}/> : tab === "intel" ? <IntelligenceConcept data={data} action={action} ui={ui}/> : <WatchMonitorConcept data={data} action={action} ui={ui}/>;
  return <CenterShell title={t("AI 交易员","AI Trader")} subtitle="" tabs={TABS.ai} active={tab} onChange={setTab} inlineTabs tabsExtra={extra}>{page}</CenterShell>;
}

export function TradingCenter({ data, action, ui, initialTab = "overview" }) {
  const [tab, setTab] = useState(initialTab);
  const pages = {
    overview: <TradingOverviewConcept data={data} action={action} ui={ui}/>,
    market: <MarketConcept data={data} action={action} ui={ui}/>,
    positions: <PositionsConcept data={data} action={action} ui={ui}/>,
    execution: <ExecutionReviewConcept data={data} action={action} ui={ui}/>,
    ledger: <ExecutionLedgerConcept data={data} action={action} ui={ui}/>
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
    keys: <KeysConcept data={data} action={action} ui={ui}/>
  };
  return <CenterShell title={t("风控中心","Risk Center")} subtitle={t("总览 · 资金与交易边界 · 风控规则 · 密钥安全","Overview · Capital & Trading Limits · Risk Rules · Key Security")} tabs={TABS.risk} active={tab} onChange={setTab}>{pages[tab] || pages.posture}</CenterShell>;
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
