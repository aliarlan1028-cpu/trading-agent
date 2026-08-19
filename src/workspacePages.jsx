import { useState } from "react";
import {
  AiDialogConcept, AuditConcept, CapabilitiesConcept, EventsConcept,
  ExecutionLedgerConcept, ExecutionReviewConcept, IntelligenceConcept, KnowledgeConcept,
  MandateConcept, MarketConcept, NotificationsConcept, WatchMonitorConcept,
  OwnerReviewWorkspaceConcept, TradeReviewWorkbenchConcept,
  OperationsOverviewConcept, PositionsConcept,
  RiskPostureConcept, RulesConcept, SettingsConcept, StrategyLibraryConcept,
  TasksConcept, TradingOverviewConcept
} from "./conceptPages.jsx";
import { ChatKpiStrip } from "./chat.jsx";
import { Eye, ShieldCheck } from "lucide-react";
import { t } from "./i18n.js";
import "./workspace.css";
import "./workspace-additions.css";
import "./product-system.css";

const TABS = {
  ai: [["dialog", "对话", "Dialog"], ["intel", "情报", "Intel"], ["watch", "盯盘", "Watch"]],
  trade: [["overview", "总览", "Overview"], ["market", "行情", "Market"], ["positions", "持仓", "Positions"], ["execution", "执行与复盘", "Execution & Review"], ["reviews", "交易复盘", "Trade Reviews"], ["owner", "Owner 优化", "Owner Review"], ["ledger", "委托与成交", "Orders & Fills"]],
  research: [["knowledge", "知识库", "Knowledge"], ["strategy", "策略库", "Strategies"], ["capabilities", "能力库", "Capabilities"]],
  risk: [["posture", "风险总览", "Overview"], ["mandate", "资金与交易边界", "Capital & Trading Limits"], ["rules", "风控规则", "Risk Rules"]],
  ops: [["overview", "运行总览", "Overview"], ["events", "事件日历", "Events"], ["tasks", "任务调度", "Tasks"], ["audit", "审计记录", "Audit"], ["notifications", "通知中心", "Notifications"]]
};

const PRODUCT_WORKSPACES = {
  trade: {
    code: "02",
    eyebrow: ["TRADING COCKPIT", "TRADING COCKPIT"],
    purpose: ["观察账户与市场，执行交易，并把每笔结果送回复盘闭环", "Observe account and market truth, execute trades, and return every result to the review loop"],
    groups: [
      { label: ["观察", "OBSERVE"], ids: ["overview", "market", "positions"] },
      { label: ["执行", "EXECUTE"], ids: ["execution", "ledger"] },
      { label: ["改进", "IMPROVE"], ids: ["reviews", "owner"] }
    ],
    routes: {
      overview: ["账户、市场、风险和交易活动的统一入口", "One view of account, market, risk, and trading activity"],
      market: ["围绕同一交易对查看行情结构与公开市场事实", "Inspect market structure and public facts for one selected pair"],
      positions: ["从持仓追溯计划、保护、成交与风险占用", "Trace positions back to plans, protection, fills, and risk usage"],
      execution: ["核对计划、OMS、OKX、成交、费用和复盘事实链", "Reconcile the plan, OMS, OKX, fills, fees, and review truth chain"],
      reviews: ["解释单笔交易结果并形成待审批教训", "Explain individual outcomes and form lessons awaiting approval"],
      owner: ["聚合重复问题，验证候选改进，并由 Owner 决策", "Aggregate repeated issues, validate candidate improvements, and let the Owner decide"],
      ledger: ["按生命周期查询真实委托、成交和费用", "Query real orders, fills, and fees by lifecycle"]
    }
  },
  research: {
    code: "03",
    eyebrow: ["RESEARCH & RELEASE", "RESEARCH & RELEASE"],
    purpose: ["知识先进入孵化区；只有验证通过的策略与能力才进入正式目录", "Knowledge is incubated first; only validated strategies and capabilities enter the official catalogs"],
    groups: [
      { label: ["孵化", "INCUBATE"], ids: ["knowledge"] },
      { label: ["发布", "PUBLISH"], ids: ["strategy", "capabilities"] }
    ],
    routes: {
      knowledge: ["导入、检索，并提取规则、交易方法和工作流候选", "Import, retrieve, and extract rule, method, and workflow candidates"],
      strategy: ["管理经过验证、可追溯且版本化的策略产品", "Manage validated, traceable, and versioned strategy products"],
      capabilities: ["管理运行时真正批准的工具与工作流", "Manage tools and workflows that are truly approved at runtime"]
    }
  },
  risk: {
    code: "04",
    eyebrow: ["RISK CONTROL", "RISK CONTROL"],
    purpose: ["先解释当前风险和限制，再管理资金边界与确定性规则", "Explain current risk and restrictions before managing capital boundaries and deterministic rules"],
    groups: [
      { label: ["监控", "MONITOR"], ids: ["posture"] },
      { label: ["配置", "CONFIGURE"], ids: ["mandate", "rules"] }
    ],
    routes: {
      posture: ["查看当前风险、限制原因、恢复条件与风险事件", "See current risk, restriction causes, recovery conditions, and incidents"],
      mandate: ["定义允许交易的市场、资金、杠杆和确认边界", "Define allowed markets, capital, leverage, and approval boundaries"],
      rules: ["管理确定性风控规则及其最近触发事实", "Manage deterministic risk rules and their recent trigger facts"]
    }
  },
  operations: {
    code: "05",
    eyebrow: ["SYSTEM OPERATIONS", "SYSTEM OPERATIONS"],
    purpose: ["观察系统健康、任务运行、事件事实、审计链与通知", "Observe system health, task runs, event facts, audit chains, and notifications"],
    groups: [
      { label: ["运行", "RUN"], ids: ["overview", "tasks"] },
      { label: ["事实", "FACTS"], ids: ["events", "audit", "notifications"] }
    ],
    routes: {
      overview: ["检查关键服务健康并重放最近 Agent 运行链路", "Inspect critical service health and replay the latest Agent run"],
      events: ["管理高影响事件、时间窗口与相关资产", "Manage high-impact events, timing windows, and related assets"],
      tasks: ["查看调度责任、最近结果与下一次运行", "Inspect scheduling ownership, latest results, and next run"],
      audit: ["沿模型、风控和执行归因链核对不可变事实", "Verify immutable facts across model, risk, and execution attribution"],
      notifications: ["集中处理需要人关注的交易、风险与系统消息", "Triage trade, risk, and system messages that need attention"]
    }
  }
};

function CenterShell({ title, subtitle, tabs, active, onChange, children, tabsExtra, inlineTabs, workspace = "" }) {
  // inlineTabs 只给 AI 交易员:Tab 内联到标题行;其他页面保持标题行 + 单独 Tab 行(原样)。
  const tabNav = <nav className={`uxTabs ${inlineTabs ? "uxTabsInline" : ""}`} aria-label={`${title} ${t("子页面", "sections")}`}>{tabs.map(([id, label, labelEn]) => <button key={id} className={active === id ? "active" : ""} onClick={() => onChange(id)}>{t(label, labelEn)}</button>)}</nav>;
  const product = PRODUCT_WORKSPACES[workspace];
  const visibleIds = new Set(tabs.map(([id]) => id));
  const groupedIds = new Set(product?.groups.flatMap((group) => group.ids) || []);
  const productGroups = product ? [
    ...product.groups.map((group) => ({ ...group, ids: group.ids.filter((id) => visibleIds.has(id)) })).filter((group) => group.ids.length),
    ...(tabs.some(([id]) => !groupedIds.has(id)) ? [{ label: ["其他", "MORE"], ids: tabs.map(([id]) => id).filter((id) => !groupedIds.has(id)) }] : [])
  ] : [];
  const activeTab = tabs.find(([id]) => id === active) || tabs[0];
  const routeDescriptionPair = product?.routes?.[active];
  const routeDescription = routeDescriptionPair ? t(routeDescriptionPair[0], routeDescriptionPair[1]) : "";
  return (
    <div className={`uxCenter ${product ? "productWorkspace" : ""}`} data-workspace={workspace || undefined}>
      {product ? <header className="uxProductHeader">
        <div className="uxProductIdentity">
          <small>{product.code} / {t(product.eyebrow[0], product.eyebrow[1])}</small>
          <h1>{title}</h1>
          <p>{t(product.purpose[0], product.purpose[1])}</p>
        </div>
        <aside className="uxProductCurrent" aria-label={t("当前子页面", "Current section")}>
          <small>{t("CURRENT WORKSPACE", "CURRENT WORKSPACE")}</small>
          <b>{activeTab ? t(activeTab[1], activeTab[2]) : title}</b>
          <span>{routeDescription}</span>
        </aside>
      </header> : <header className="uxCenterHead"><div className="uxHeadLeft"><h1>{title}</h1>{subtitle && <span>{subtitle}</span>}{inlineTabs && tabNav}</div>{tabsExtra && <div className="uxHeadExtra">{tabsExtra}</div>}</header>}
      {product ? <nav className="uxProductNav" aria-label={`${title} ${t("子页面", "sections")}`}>
        {productGroups.map((group) => <div className="uxProductNavGroup" key={group.label[0]}>
          <small>{t(group.label[0], group.label[1])}</small>
          <div>{group.ids.map((id) => {
            const item = tabs.find(([tabId]) => tabId === id);
            return item ? <button type="button" key={id} className={active === id ? "active" : ""} aria-current={active === id ? "page" : undefined} onClick={() => onChange(id)}>{t(item[1], item[2])}</button> : null;
          })}</div>
        </div>)}
      </nav> : !inlineTabs && tabNav}
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

export function TradingCenter({ data, action, ui, initialTab = "overview", reviewInitialId = "" }) {
  const [tab, setTab] = useState(initialTab);
  const tabs = data.user?.isOwner === true ? TABS.trade : TABS.trade.filter(([id]) => id !== "owner");
  const pages = {
    overview: <TradingOverviewConcept data={data} action={action} ui={ui}/>,
    market: <MarketConcept data={data} action={action} ui={ui}/>,
    positions: <PositionsConcept data={data} action={action} ui={ui}/>,
    execution: <ExecutionReviewConcept data={data} action={action} ui={ui}/>,
    reviews: <TradeReviewWorkbenchConcept data={data} action={action} ui={ui} initialReviewId={reviewInitialId}/>,
    owner: data.user?.isOwner === true ? <OwnerReviewWorkspaceConcept data={data} action={action} ui={ui}/> : null,
    ledger: <ExecutionLedgerConcept data={data} action={action} ui={ui}/>
  };
  const safeTab = tabs.some(([id]) => id === tab) ? tab : "overview";
  return <CenterShell workspace="trade" title={t("交易驾驶舱","Trading Cockpit")} subtitle={t("行情 · 账户 · 执行 · 复盘","Market · Account · Execution · Review")} tabs={tabs} active={safeTab} onChange={setTab}>{pages[safeTab] || pages.overview}</CenterShell>;
}

export function ResearchCenter({ data, action, ui, initialTab = "knowledge", strategyInitialTab = "catalog" }) {
  const [tab, setTab] = useState(initialTab);
  const pages = {
    knowledge: <KnowledgeConcept data={data} action={action} ui={ui}/>,
    strategy: <StrategyLibraryConcept data={data} action={action} ui={ui} initialTab={strategyInitialTab}/>,
    capabilities: <CapabilitiesConcept data={data} action={action} ui={ui}/>
  };
  return <CenterShell workspace="research" title={t("研究中心","Research")} subtitle={t("知识库 · 策略库 · 能力库","Knowledge · Strategies · Capabilities")} tabs={TABS.research} active={tab} onChange={setTab}>{pages[tab] || pages.knowledge}</CenterShell>;
}

export function RiskCenter({ data, action, ui, initialTab = "posture" }) {
  const [tab, setTab] = useState(initialTab);
  const pages = {
    posture: <RiskPostureConcept data={data} ui={ui}/>,
    mandate: <MandateConcept data={data} action={action} ui={ui}/>,
    rules: <RulesConcept data={data} action={action} ui={ui}/>
  };
  return <CenterShell workspace="risk" title={t("风控中心","Risk Center")} subtitle={t("总览 · 资金与交易边界 · 风控规则","Overview · Capital & Trading Limits · Risk Rules")} tabs={TABS.risk} active={tab} onChange={setTab}>{pages[tab] || pages.posture}</CenterShell>;
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
  return <CenterShell workspace="operations" title={t("系统运营","Operations")} subtitle={t("事件 · 任务 · 审计 · 可观测","Events · Tasks · Audit · Observability")} tabs={TABS.ops} active={tab} onChange={setTab}>{pages[tab] || pages.overview}</CenterShell>;
}

export { SettingsConcept };
