import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bell,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Layers,
  MessageSquare,
  Settings,
  Shield,
  WalletCards,
  Zap
} from "lucide-react";
import { displayMoney, exchangeState, formatTime, humanize, PageHeader, statusTone, StatusBadge, ProgressBar, systemStatus, useApi } from "./lib.jsx";
import { ChatPage } from "./chat.jsx";
import { AuditSystemPage, EventsTasksPage, KnowledgeSkillsPage, MarketAccountPage, ReviewPage, RiskAuthPage } from "./pages.jsx";
import { ConfigPanel, SystemConfigPanel } from "./panels.jsx";
import "./styles.css";

const navItems = [
  { id: "chat", label: "AI 交易员", icon: MessageSquare },
  { id: "marketAccount", label: "仪表盘", icon: WalletCards },
  { id: "review", label: "复盘", icon: ClipboardList },
  { id: "eventsTasks", label: "事件与任务", icon: CalendarClock },
  { id: "knowledgeSkills", label: "知识与技能", icon: BookOpen },
  { id: "riskAuth", label: "风控与授权", icon: Shield },
  { id: "auditSystem", label: "审计", icon: Activity },
  { id: "systemSettings", label: "系统设置", icon: Settings }
];

function Sidebar({ active, setActive }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark"><Layers size={22} /></div>
        <strong>Trader Agent</strong>
      </div>
      <nav className="nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button className={`navItem ${active === item.id ? "active" : ""}`} key={item.id} title={item.label} aria-label={item.label} onClick={() => setActive(item.id)}>
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function AppTopbar({ data, setActive, notify, action }) {
  const accounts = data.exchangeAccounts || [];
  const binance = accounts.find((item) => item.exchange === "BINANCE") || {};
  const okx = accounts.find((item) => item.exchange === "OKX") || {};
  const unread = (data.notifications || []).filter((item) => !item.read).length;
  const currentStatus = systemStatus(data);
  const live = data.system?.liveTradingEnabled;
  return (
    <header className="appTopbar">
      <div className="topbarStatusGroup">
        <ExchangePill name="Binance" tone="binance" account={binance} onClick={() => setActive("systemSettings")} />
        <ExchangePill name="OKX" tone="okx" account={okx} onClick={() => setActive("systemSettings")} />
        <span className={`livePill ${live ? "on" : ""}`} title={live ? "真实交易写入已开启" : "真实交易写入关闭，全部动作停留在计划/模拟层"}>
          {live ? "实盘写入开启" : "实盘写入关闭"}
        </span>
      </div>
      <div className="topbarActions">
        <button className={`autonomyPill ${currentStatus.tone === "danger" || !data.system.autonomyEnabled ? "off" : "on"}`} title={currentStatus.label} onClick={() => setActive("riskAuth")}>
          <span />
          {currentStatus.label}
        </button>
        <button className="killButton" title="一键熔断：立即阻断所有新交易" onClick={() => action("/api/risk/kill-switch", { enabled: true })}>
          <Zap size={15} /> 熔断
        </button>
        <button className="bellButton" title="通知" onClick={() => { setActive("auditSystem"); notify(unread ? `有 ${unread} 条未读通知` : "暂无未读通知"); }}>
          <Bell size={18} />
          {unread > 0 && <b>{unread}</b>}
        </button>
      </div>
    </header>
  );
}

function SystemSettingsPage({ data, action, ui }) {
  return (
    <div className="pageStack">
      <PageHeader active="systemSettings" />
      <div className="settingsPage">
        <SystemConfigPanel data={data} action={action} ui={ui} />
      </div>
    </div>
  );
}

function ExchangePill({ name, tone, account = {}, onClick }) {
  const state = exchangeState(account);
  return (
    <button className={`exchangePill ${state.tone}`} title={`${name}：${state.label}`} onClick={onClick}>
      <span className={`exchangeLogo ${tone}`}>{name === "OKX" ? "✣" : "◆"}</span>
      <b>{name}</b>
      <small>{state.label}</small>
      <i />
    </button>
  );
}

function RightRail({ data, action, ui }) {
  const agentStatus = data.agentStatus || {};
  const latestPlan = agentStatus.currentPlan || data.tradePlans?.[0] || {};
  const latestAnalysis = agentStatus.latestAnalysis || data.analysisBundles?.[0] || {};
  const latestRisk = latestPlan.lastRiskCheck || data.riskChecks?.[0] || {};
  const riskWall = agentStatus.riskWall || {};
  const mandate = data.mandates?.find((item) => ["active", "running"].includes(item.status));
  const positions = data.positions || [];
  const orders = data.orders || data.executionOrders || [];
  const timeline = [
    ...(agentStatus.timeline || []).map((item) => ({
      id: item.id || `${item.phase}:${item.summary}`,
      phase: item.phase,
      title: item.title || item.summary,
      status: item.summary === "error" ? "error" : item.status || "ok",
      createdAt: item.createdAt
    })),
    ...(data.traces || [])
  ].slice(0, 4);
  const budget = data.system?.remainingDailyLossUsdt;
  const avgExpertConfidence = latestAnalysis.expertViews?.length
    ? latestAnalysis.expertViews.reduce((sum, view) => sum + Number(view.confidence || 0), 0) / latestAnalysis.expertViews.length
    : null;
  const beforeConfidence = latestPlan.confidenceBefore ?? latestPlan.confidence_before ?? null;
  const afterConfidence = latestPlan.confidenceAfter ?? latestPlan.confidence_after ?? avgExpertConfidence;
  const confidenceText = beforeConfidence !== null || afterConfidence !== null
    ? `${beforeConfidence !== null ? `${Math.round(Number(beforeConfidence) * 100)}%` : "未记录"} → ${afterConfidence !== null ? `${Math.round(Number(afterConfidence) * 100)}%` : "未记录"}`
    : "未记录";
  const decisionSummary = latestAnalysis.summary || latestPlan.rationale || agentStatus.currentObservation || "等待真实数据与授权配置。";
  const citationCount = (latestAnalysis.citations || []).length;
  const memoryCount = (data.memoryItems || []).length;
  const gateBlocked = latestRisk.decision === "blocked" || riskWall.allowOpen === false || data.system?.killSwitch;
  const gateTone = gateBlocked ? "danger" : riskWall.allowOpen ? "ok" : "warning";
  const gateLabel = data.system?.killSwitch ? "熔断中" : latestRisk.summary || (riskWall.allowOpen ? "允许开仓" : "等待配置");
  const nextAction = agentStatus.nextActions?.[0] || data.system?.latestAction || "等待下一轮巡检";
  const accountConstraint = positions.length
    ? `${positions.length} 个持仓会影响下一步判断`
    : orders.length
      ? `${orders.length} 个委托需要避让`
      : "暂无持仓/委托冲突";
  return (
    <aside className="rightRail">
      <div className="railBlock railHero agentTaskBlock">
        <span className="railLabel">当前任务</span>
        <strong className="railValue">{agentStatus.currentGoal || "等待指令"}</strong>
        <StatusBadge tone={statusTone(agentStatus.state || data.system?.apiHealth)}>{agentStatus.stateLabel || humanize(agentStatus.state, "待配置")}</StatusBadge>
        <p>{agentStatus.currentObservation || agentStatus.reasonNotTrading || "Agent 正在等待配置和下一步目标。"}</p>
        <button className="textButton" onClick={() => ui.setActive("eventsTasks")}>下一步：{nextAction} <ChevronRight size={13} /></button>
      </div>

      <div className="railBlock">
        <span className="railLabel">决策依据</span>
        <p className="railDecision">{decisionSummary}</p>
        <div className="railMetricGrid">
          <span>置信度<b>{confidenceText}</b></span>
          <span>知识引用<b>{memoryCount} 条记忆 / {citationCount} 处</b></span>
        </div>
        {afterConfidence !== null && <ProgressBar value={Math.round(Number(afterConfidence) * 100)} tone="blue" />}
      </div>

      <div className="railBlock">
        <span className="railLabel">风控闸门</span>
        <div className={`gateBanner ${gateTone}`}>
          <strong>{gateLabel}</strong>
          <small>{latestRisk.blockers?.[0]?.detail || agentStatus.reasonNotTrading || "等待下一次风控校验。"}</small>
        </div>
        <div className="railMetricGrid">
          <span>开仓<b>{riskWall.allowOpen ? "允许" : "禁止"}</b></span>
          <span>减仓<b>{riskWall.allowReduceOnly ? "允许" : "待授权"}</b></span>
          <span>日亏损预算<b>{budget === null || budget === undefined ? "未授权" : `${displayMoney(budget)} USDT`}</b></span>
          <span>人工确认<b>{mandate ? "按阈值" : "需要授权"}</b></span>
        </div>
      </div>

      {(positions.length > 0 || orders.length > 0) && (
        <div className="railBlock">
          <span className="railLabel">账户约束</span>
          <div className="railMetricGrid">
            <span>持仓影响<b>{positions.length} 个</b></span>
            <span>委托冲突<b>{orders.length} 个</b></span>
            <span>账户同步<b>{data.accountSnapshots?.[0] ? formatTime(data.accountSnapshots[0].createdAt) : "未同步"}</b></span>
            <span>约束摘要<b>{accountConstraint}</b></span>
          </div>
          <button className="textButton" onClick={() => ui.setActive("marketAccount")}>查看仪表盘 <ChevronRight size={13} /></button>
        </div>
      )}

      <div className="railBlock">
        <span className="railLabel">Agent 最近动作</span>
        {!timeline.length && <span className="railSub">暂无记录</span>}
        {timeline.map((trace) => (
          <div className="railActionItem" key={trace.id}>
            <span>{trace.createdAt ? formatTime(trace.createdAt) : humanize(trace.phase, trace.phase || "step")}</span>
            <b title={trace.title}>{String(trace.title || "-").slice(0, 36)}</b>
            <StatusBadge tone={statusTone(trace.status || trace.summary)}>{humanize(trace.status || trace.summary || "ok")}</StatusBadge>
          </div>
        ))}
        <button className="textButton" onClick={() => ui.setActive("review")}>进入复盘 <ChevronRight size={13} /></button>
      </div>
      <div className="railBlock railActions">
        <button onClick={() => action("/api/system/autonomy", { enabled: !data.system.autonomyEnabled })}>
          {data.system.autonomyEnabled ? "暂停自主推进" : "恢复自主推进"}
        </button>
        {data.system.killSwitch && <button className="danger" onClick={() => action("/api/risk/kill-switch", { enabled: false })}>解除熔断</button>}
      </div>
    </aside>
  );
}

function App() {
  const [active, setActive] = useState("chat");
  const [panel, setPanel] = useState("");
  const { data, loading, action, toast, authRequired, login, notify, download, refresh } = useApi();
  const ui = { setActive, notify, download, refresh, openPanel: setPanel, closePanel: () => setPanel("") };
  const content = useMemo(() => {
    if (!data) return null;
    if (active === "marketAccount") return <MarketAccountPage data={data} action={action} ui={ui} />;
    if (active === "review") return <ReviewPage data={data} action={action} ui={ui} />;
    if (active === "eventsTasks") return <EventsTasksPage data={data} action={action} ui={ui} />;
    if (active === "knowledgeSkills") return <KnowledgeSkillsPage data={data} action={action} ui={ui} />;
    if (active === "riskAuth") return <RiskAuthPage data={data} action={action} ui={ui} />;
    if (active === "auditSystem") return <AuditSystemPage data={data} action={action} ui={ui} />;
    if (active === "systemSettings") return <SystemSettingsPage data={data} action={action} ui={ui} />;
    return <ChatPage data={data} action={action} ui={ui} />;
  }, [active, data, action]);

  if (authRequired && !data) return <LoginScreen login={login} toast={toast} />;
  if (loading || !data) return <div className="loading"><Activity size={28} /> 正在启动 Trader Agent...</div>;

  return (
    <div className={`appShell ${active === "chat" ? "withRail" : ""}`}>
      <Sidebar active={active} setActive={setActive} />
      <main className="mainArea">
        <AppTopbar data={data} setActive={setActive} notify={notify} action={action} />
        <div className="content">{content}</div>
      </main>
      {active === "chat" && <RightRail data={data} action={action} ui={ui} />}
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function LoginScreen({ login, toast }) {
  const [password, setPassword] = useState("");
  return (
    <div className="loginScreen">
      <form className="loginPanel" onSubmit={(event) => { event.preventDefault(); login(password); }}>
        <div className="brandMark"><Layers size={24} /></div>
        <h1>AI 数字货币交易 Agent</h1>
        <p>请输入管理员密码进入交易驾驶舱。</p>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="ADMIN_PASSWORD" autoFocus />
        <button className="primaryButton" type="submit">登录</button>
        {toast && <small>{toast}</small>}
      </form>
    </div>
  );
}

const root = (window.__traderAgentRoot ||= createRoot(document.getElementById("root")));
root.render(<App />);
