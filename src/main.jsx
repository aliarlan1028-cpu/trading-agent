import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bell,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Layers,
  MessageSquare,
  Search,
  Settings,
  Shield,
  WalletCards,
  Zap
} from "lucide-react";
import { displayMoney, displayPct, exchangeState, formatTime, humanize, statusTone, StatusBadge, ProgressBar, systemStatus, useApi } from "./lib.jsx";
import { ChatPage } from "./chat.jsx";
import { AuditSystemPage, EventsTasksPage, KnowledgeSkillsPage, MarketAccountPage, RiskAuthPage } from "./pages.jsx";
import { ConfigPanel } from "./panels.jsx";
import "./styles.css";

const navItems = [
  { id: "chat", label: "AI 交易员", icon: MessageSquare },
  { id: "marketAccount", label: "市场与账户", icon: WalletCards },
  { id: "eventsTasks", label: "事件与任务", icon: CalendarClock },
  { id: "knowledgeSkills", label: "知识与技能", icon: BookOpen },
  { id: "riskAuth", label: "风控与授权", icon: Shield },
  { id: "auditSystem", label: "审计与系统", icon: Settings }
];

function Sidebar({ active, setActive, data }) {
  const currentStatus = systemStatus(data);
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
      <button className="sideStatus" title="查看系统状态" onClick={() => setActive("auditSystem")}>
        <div className="sideStatusIcon"><Shield size={18} /></div>
        <div>
          <span>系统状态</span>
          <strong className={currentStatus.tone}>{currentStatus.label}</strong>
          <small>查看运行日志 <ChevronRight size={12} /></small>
        </div>
      </button>
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
        <ExchangePill name="Binance" tone="binance" account={binance} onClick={() => setActive("riskAuth")} />
        <ExchangePill name="OKX" tone="okx" account={okx} onClick={() => setActive("riskAuth")} />
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
  const portfolio = data.portfolio || {};
  const mandate = data.mandates?.find((item) => ["active", "running"].includes(item.status));
  const positions = data.positions || [];
  const traces = (data.traces || []).slice(0, 5);
  const budget = data.system?.remainingDailyLossUsdt;
  return (
    <aside className="rightRail">
      <div className="railBlock">
        <span className="railLabel">账户净值</span>
        <strong className="railValue">{displayMoney(portfolio.totalEquityUsdt)} <small>USDT</small></strong>
        <span className={`railSub ${Number(portfolio.todayPnl || 0) >= 0 ? "positive" : "negative"}`}>
          今日 {displayPct(portfolio.todayPnlPct)} · {displayMoney(portfolio.todayPnl)}
        </span>
      </div>
      <div className="railBlock">
        <span className="railLabel">今日亏损预算</span>
        {budget === null || budget === undefined
          ? <span className="railSub">未授权 — 激活授权委托后启用</span>
          : <>
              <ProgressBar value={Math.max(0, Math.min(100, budget > 0 ? 100 : 0))} />
              <span className="railSub">剩余 {displayMoney(budget)} USDT</span>
            </>}
        <span className="railSub">授权：{mandate ? humanize(mandate.status) : "未激活"}</span>
      </div>
      <div className="railBlock">
        <span className="railLabel">持仓 {positions.length}</span>
        {!positions.length && <span className="railSub">暂无持仓</span>}
        {positions.slice(0, 4).map((position) => {
          const pnl = Number(position.pnl || 0);
          return (
            <div className="railRow" key={position.id}>
              <span>{position.symbol} {position.direction || ""}</span>
              <b className={pnl >= 0 ? "positive" : "negative"}>{pnl >= 0 ? "+" : ""}{displayMoney(pnl)}</b>
            </div>
          );
        })}
      </div>
      <div className="railBlock">
        <span className="railLabel">实盘绩效</span>
        {data.performance?.trades
          ? <>
              <div className="railRow"><span>已平仓交易</span><b>{data.performance.trades} 笔 · 胜率 {data.performance.winRatePct}%</b></div>
              <div className="railRow"><span>累计盈亏</span><b className={data.performance.totalPnlUsdt >= 0 ? "positive" : "negative"}>{displayMoney(data.performance.totalPnlUsdt)} USDT</b></div>
              {data.performance.profitFactor !== null && <div className="railRow"><span>盈亏比</span><b>{data.performance.profitFactor}</b></div>}
            </>
          : <span className="railSub">暂无已平仓交易{data.performance?.openExecutions ? ` · ${data.performance.openExecutions} 个在途执行单` : ""}</span>}
      </div>
      <div className="railBlock">
        <span className="railLabel">Agent 最近动作</span>
        {!traces.length && <span className="railSub">暂无记录</span>}
        {traces.map((trace) => (
          <div className="railRow" key={trace.id}>
            <span title={trace.title}>{formatTime(trace.createdAt)} {String(trace.title || "").slice(0, 14)}</span>
            <StatusBadge tone={statusTone(trace.status)}>{humanize(trace.status)}</StatusBadge>
          </div>
        ))}
        <button className="textButton" onClick={() => ui.setActive("auditSystem")}>完整审计 <ChevronRight size={13} /></button>
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
    if (active === "eventsTasks") return <EventsTasksPage data={data} action={action} ui={ui} />;
    if (active === "knowledgeSkills") return <KnowledgeSkillsPage data={data} action={action} ui={ui} />;
    if (active === "riskAuth") return <RiskAuthPage data={data} action={action} ui={ui} />;
    if (active === "auditSystem") return <AuditSystemPage data={data} action={action} ui={ui} />;
    return <ChatPage data={data} action={action} ui={ui} />;
  }, [active, data, action]);

  if (authRequired && !data) return <LoginScreen login={login} toast={toast} />;
  if (loading || !data) return <div className="loading"><Activity size={28} /> 正在启动 Trader Agent...</div>;

  return (
    <div className={`appShell ${active === "chat" ? "withRail" : ""}`}>
      <Sidebar active={active} setActive={setActive} data={data} />
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
