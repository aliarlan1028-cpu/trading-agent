import { useEffect, useState } from "react";
import {
  AiDialogConcept, CapabilitiesConcept, EventRiskConcept, EventsConcept,
  ExecutionLedgerConcept, ExecutionReviewConcept, IntelligenceConcept, KnowledgeConcept,
  MarketConcept, OperatingBoundaryConcept, WatchMonitorConcept,
  OwnerReviewWorkspaceConcept, TradeReviewWorkbenchConcept,
  OperationsAuditConcept, OperationsCommandConcept, OperationsInboxConcept, OperationsRecoveryConcept, OperationsTasksConcept, PositionsConcept,
  ResearchMapConcept, RiskPostureConcept, RulesConcept, SettingsConcept, StrategyLibraryConcept,
  TradingOverviewConcept
} from "./conceptPages.jsx";
import { ChatKpiStrip } from "./chat.jsx";
import { Eye, ShieldCheck } from "lucide-react";
import { t } from "./i18n.js";
import { ProductWorkspaceFrame } from "./productShell.jsx";
import "./workspace.css";
import "./workspace-additions.css";
import "./product-system.css";

const TABS = {
  ai: [["dialog", "对话", "Dialog"], ["intel", "情报", "Intel"], ["watch", "盯盘", "Watch"], ["events", "事件", "Events"]],
  trade: [["overview", "总览", "Overview"], ["market", "行情", "Market"], ["positions", "持仓", "Positions"], ["execution", "执行与复盘", "Execution & Review"], ["ledger", "委托与成交", "Orders & Fills"]],
  research: [["map", "研究地图", "Research Map"], ["knowledge", "知识孵化", "Incubation"], ["strategy", "策略资产", "Strategies"], ["capabilities", "能力资产", "Capabilities"], ["reviews", "交易复盘", "Trade Reviews"], ["owner", "Owner 优化", "Owner Review"]],
  risk: [["posture", "风险态势", "Risk Posture"], ["events", "事件风险", "Event Risk"], ["mandate", "生效边界", "Effective Boundaries"], ["rules", "规则监控", "Rule Monitor"]],
  ops: [["overview", "运行值班台", "Command"], ["tasks", "任务与运行", "Tasks & Runs"], ["recovery", "对账与恢复", "Recovery"], ["audit", "审计证据", "Audit"], ["notifications", "通知收件箱", "Inbox"]]
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
    purpose: ["系统原生资产与知识蒸馏候选从不同入口汇入同一正式注册表，再由实盘证据驱动学习", "System-native assets and knowledge-derived candidates enter one formal registry through different paths, then learn from live evidence"],
    groups: [
      { label: ["总览", "MAP"], ids: ["map"] },
      { label: ["孵化", "INCUBATE"], ids: ["knowledge"] },
      { label: ["正式资产", "REGISTRIES"], ids: ["strategy", "capabilities"] },
      { label: ["学习", "LEARN"], ids: ["reviews", "owner"] }
    ],
    routes: {
      map: ["查看系统原生与知识蒸馏资产如何汇入注册表，并沿真实证据形成版本闭环", "See how system-native and knowledge-derived assets enter registries and form a version loop from real evidence"],
      knowledge: ["导入、检索，并提取规则、交易方法和工作流候选", "Import, retrieve, and extract rule, method, and workflow candidates"],
      strategy: ["管理经过验证、可追溯且版本化的策略产品", "Manage validated, traceable, and versioned strategy products"],
      capabilities: ["管理运行时真正批准的工具与工作流", "Manage tools and workflows that are truly approved at runtime"],
      reviews: ["从真实交易事实形成归因、教训与候选改进", "Turn real trading facts into attribution, lessons, and improvement candidates"],
      owner: ["验证候选改进，并由 Owner 决定是否发布", "Validate candidate improvements and let the Owner decide whether to release"]
    }
  },
  risk: {
    code: "04",
    eyebrow: ["RISK CONTROL", "RISK CONTROL"],
    purpose: ["解释当前实际允许什么、为什么受限，以及如何恢复", "Explain what is effectively allowed, why it is constrained, and how it recovers"],
    groups: [
      { label: ["当前事实", "CURRENT TRUTH"], ids: ["posture", "mandate"] },
      { label: ["命中证据", "ENFORCEMENT"], ids: ["rules"] }
    ],
    routes: {
      posture: ["查看当前风险、限制原因、恢复条件与风险事件", "See current risk, restriction causes, recovery conditions, and incidents"],
      mandate: ["核对当前生效的运行目标、权限版本、资金边界与就绪链", "Verify the effective operating target, permission version, capital boundaries, and readiness chain"],
      rules: ["查看确定性规则的生效状态、版本与最近命中事实", "Inspect deterministic-rule enablement, versions, and recent hit facts"]
    }
  },
  operations: {
    code: "05",
    eyebrow: ["SYSTEM OPERATIONS", "SYSTEM OPERATIONS"],
    purpose: ["发现运行异常、定位权威证据，并沿安全路径恢复系统", "Find runtime exceptions, locate authoritative evidence, and recover through safe paths"],
    groups: [
      { label: ["值班", "OPERATE"], ids: ["overview", "tasks", "recovery"] },
      { label: ["证据", "PROOF"], ids: ["audit", "notifications"] }
    ],
    routes: {
      overview: ["从健康矩阵进入按优先级排序的待处理队列", "Move from the health matrix into a priority-ordered attention queue"],
      tasks: ["核对任务定义、真实运行结果与自主交易因果链", "Verify task definitions, actual run outcomes, and the autonomous trading chain"],
      recovery: ["核对差异、风险事件与现有安全恢复动作", "Review discrepancies, incidents, and existing safe recovery actions"],
      audit: ["沿操作者、资源、上下文与哈希核对审计证据", "Verify audit evidence across actor, resource, context, and hash"],
      notifications: ["确认需要人关注的交易、风险、任务与系统消息", "Acknowledge trade, risk, task, and system notices that need attention"]
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
  const workspaceId = ({ trade: "live", research: "lab", risk: "control", operations: "operations" })[workspace];
  const productViews = productGroups.flatMap((group) => group.ids.map((id) => {
    const item = tabs.find(([tabId]) => tabId === id);
    const description = product.routes?.[id] || ["", ""];
    return item ? {
      id,
      label: item[1],
      labelEn: item[2],
      group: group.label[0],
      groupEn: group.label[1],
      description: description[0],
      descriptionEn: description[1]
    } : null;
  }).filter(Boolean));
  if (product) {
    return (
      <div className="uxCenter productWorkspace" data-workspace={workspace}>
        <ProductWorkspaceFrame workspaceId={workspaceId} activeView={active} views={productViews} onViewChange={onChange}>
          <div className={`uxCenterBody uxSection-${active}`}>{children}</div>
        </ProductWorkspaceFrame>
      </div>
    );
  }
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
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => { if (tab === "events") ui.ensureSection?.("operationsCenter", { background: true }); }, [tab]);
  const activeWatches = (data.watchTriggers || []).filter((item) => item.status === "active").length;
  const mandate = (data.mandates || []).find((item) => ["active", "running"].includes(item.status));
  const extra = tab === "dialog" ? <div className="aiTopCluster"><ChatKpiStrip data={data} bar/><div className="aiTopLinks"><button onClick={()=>ui.setActive("riskMandate")}><ShieldCheck/>{t("交易限制", "Trading limits")}<b>{mandate?.maxOrderNotionalUsdt ? `${mandate.maxOrderNotionalUsdt} U` : "—"}</b></button><button onClick={()=>setTab("watch")}><Eye/>{t("实时盯盘", "Live watch")}<b>{activeWatches}</b></button></div></div> : null;
  const page = tab === "dialog" ? <AiDialogConcept data={data} action={action} ui={ui}/> : tab === "intel" ? <IntelligenceConcept data={data} action={action} ui={ui}/> : tab === "watch" ? <WatchMonitorConcept data={data} action={action} ui={ui}/> : <EventsConcept data={data} action={action} ui={ui}/>;
  return <CenterShell title={t("AI 交易员","AI Trader")} subtitle="" tabs={TABS.ai} active={tab} onChange={setTab} inlineTabs tabsExtra={extra}>{page}</CenterShell>;
}

export function TradingCenter({ data, action, ui, initialTab = "overview" }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const tabs = TABS.trade;
  const pages = {
    overview: <TradingOverviewConcept data={data} action={action} ui={ui}/>,
    market: <MarketConcept data={data} action={action} ui={ui}/>,
    positions: <PositionsConcept data={data} action={action} ui={ui}/>,
    execution: <ExecutionReviewConcept data={data} action={action} ui={ui}/>,
    ledger: <ExecutionLedgerConcept data={data} action={action} ui={ui}/>
  };
  const safeTab = tabs.some(([id]) => id === tab) ? tab : "overview";
  return <CenterShell workspace="trade" title={t("交易驾驶舱","Trading Cockpit")} subtitle={t("行情 · 账户 · 执行 · 复盘","Market · Account · Execution · Review")} tabs={tabs} active={safeTab} onChange={setTab}>{pages[safeTab] || pages.overview}</CenterShell>;
}

export function ResearchCenter({ data, action, ui, initialTab = "map", strategyInitialTab = "catalog", knowledgeInitialSection = "reference", capabilityInitialType = "全部工具", reviewInitialId = "", ownerInitialPane = "" }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  useEffect(() => { if (tab === "reviews" || tab === "owner") ui.ensureSection?.("cockpit"); }, [tab]);
  const tabs = data.user?.isOwner === true ? TABS.research : TABS.research.filter(([id]) => id !== "owner");
  const pages = {
    map: <ResearchMapConcept data={data} ui={ui}/>,
    knowledge: <KnowledgeConcept data={data} action={action} ui={ui} initialSection={knowledgeInitialSection}/>,
    strategy: <StrategyLibraryConcept data={data} action={action} ui={ui} initialTab={strategyInitialTab}/>,
    capabilities: <CapabilitiesConcept data={data} action={action} ui={ui} initialType={capabilityInitialType}/>,
    reviews: <TradeReviewWorkbenchConcept data={data} action={action} ui={ui} initialReviewId={reviewInitialId}/>,
    owner: data.user?.isOwner === true ? <OwnerReviewWorkspaceConcept data={data} action={action} ui={ui} initialOwnerPane={ownerInitialPane}/> : null
  };
  const safeTab = tabs.some(([id]) => id === tab) ? tab : "map";
  return <CenterShell workspace="research" title={t("研究中心","Research")} subtitle={t("研究地图 · 孵化 · 正式资产 · 学习闭环","Research map · Incubation · Formal assets · Learning loop")} tabs={tabs} active={safeTab} onChange={setTab}>{pages[safeTab] || pages.map}</CenterShell>;
}

export function RiskCenter({ data, action, ui, initialTab = "posture" }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const pages = {
    posture: <RiskPostureConcept data={data} ui={ui}/>,
    events: <EventRiskConcept data={data} ui={ui}/>,
    mandate: <OperatingBoundaryConcept data={data} ui={ui}/>,
    rules: <RulesConcept data={data} action={action} ui={ui}/>
  };
  const safeTab = TABS.risk.some(([id]) => id === tab) ? tab : "posture";
  return <CenterShell workspace="risk" title="Control" subtitle={t("实际状态 · 事件风险 · 生效边界 · 规则命中","Effective state · Event risk · Boundaries · Rule hits")} tabs={TABS.risk} active={safeTab} onChange={setTab}><div className="controlRuntimeWorkspace" data-ownership="runtime-readonly">{pages[safeTab] || pages.posture}</div></CenterShell>;
}

export function OperationsCenter({ data, action, ui, initialTab = "overview" }) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const pages = {
    overview: <OperationsCommandConcept data={data} action={action} ui={ui}/>,
    tasks: <OperationsTasksConcept data={data} action={action} ui={ui}/>,
    recovery: <OperationsRecoveryConcept data={data} action={action} ui={ui}/>,
    audit: <OperationsAuditConcept data={data} action={action} ui={ui}/>,
    notifications: <OperationsInboxConcept data={data} action={action} ui={ui}/>
  };
  const safeTab=TABS.ops.some(([id])=>id===tab)?tab:"overview";
  return <CenterShell workspace="operations" title={t("系统运营","Operations")} subtitle={t("运行事实 · 任务 · 恢复 · 审计","Runtime truth · Tasks · Recovery · Audit")} tabs={TABS.ops} active={safeTab} onChange={setTab}><div className="operationsRuntimeWorkspace" data-truth-source="operations-view">{pages[safeTab] || pages.overview}</div></CenterShell>;
}

export { SettingsConcept };
