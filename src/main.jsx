import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Bell,
  BookOpen,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  MessageSquare,
  Settings,
  Shield,
  UserPlus,
  UserCog,
  WalletCards,
  Zap
} from "lucide-react";
import { displayMoney, exchangeState, formatTime, humanize, PageHeader, statusTone, StatusBadge, ProgressBar, systemStatus, useApi } from "./lib.jsx";
import { ChatPage } from "./chat.jsx";
import { AdminPage, AgentProfilesPanel, AuditSystemPage, CockpitPage, EventsTasksPage, KnowledgeSkillsPage, MarketAccountPage, ReviewPage, RiskAuthPage } from "./pages.jsx";
import { ConfigPanel, SystemConfigPanel } from "./panels.jsx";
import { KillConfirmDialog, MobileApp } from "./mobile.jsx";
import { isNativeApp } from "./lib.jsx";
import { SafeArea } from "@capacitor-community/safe-area";
import "./styles.css";

if (isNativeApp()) {
  document.documentElement.classList.add("nativeApp");
  SafeArea.enable({ config: { customColorsForSystemBars: false } }).catch(() => {});
  document.querySelector('meta[name="viewport"]')?.setAttribute(
    "content",
    "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
  );
}

const navItems = [
  { id: "chat", label: "AI交易员", short: "交易员", icon: MessageSquare },
  { id: "cockpit", label: "驾驶舱", short: "驾驶舱", icon: WalletCards },
  { id: "knowledgeSkills", label: "知识与技能", short: "知识", icon: BookOpen },
  { id: "systemSettings", label: "系统设置", short: "设置", icon: Settings },
  { id: "admin", label: "Admin", short: "Admin", icon: UserCog }
];

function BrandLogo({ size = 34 }) {
  return <img className="brandLogo" src="/trading-agent-logo.svg" alt="Trading Agent" width={size} height={size} />;
}

function Sidebar({ active, setActive }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark"><BrandLogo size={28} /></div>
        <strong>Trader Agent</strong>
      </div>
      <nav className="nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button className={`navItem ${active === item.id ? "active" : ""}`} key={item.id} title={item.label} aria-label={item.label} onClick={() => setActive(item.id)}>
              <Icon size={20} />
              <span className="navLabelFull">{item.label}</span>
              <span className="navLabelShort">{item.short}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function useIsMobileViewport() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => setMobile(query.matches);
    // 首帧布局尚未稳定时（WebView / 迟到的 resize），initial state 可能读到错误宽度；
    // 用 rAF 在首次绘制后再同步一次，避免需要手动刷新才切到正确的桌面/移动壳。
    const raf = requestAnimationFrame(sync);
    query.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      cancelAnimationFrame(raf);
      query.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);
  return mobile;
}

function AppTopbar({ data, setActive, notify, action }) {
  const [killConfirm, setKillConfirm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const accounts = data.exchangeAccounts || [];
  const binance = accounts.find((item) => item.exchange === "BINANCE") || {};
  const okx = accounts.find((item) => item.exchange === "OKX") || {};
  const unread = (data.notifications || []).filter((item) => !item.read).length;
  const currentStatus = systemStatus(data);
  const operatingStage = data.readiness?.operatingStage;
  const live = data.system?.liveTradingEnabled;
  return (
    <header className="appTopbar">
      <div className="topbarStatusGroup">
        <ExchangePill name="Binance" tone="binance" account={binance} onClick={() => setActive("systemSettings")} />
        <ExchangePill name="OKX" tone="okx" account={okx} onClick={() => setActive("systemSettings")} />
        {live && <span className="livePill on" title="真实交易写入已开启">实盘写入开启</span>}
      </div>
      <div className="topbarActions">
        <button className={`autonomyPill ${currentStatus.tone}`} title={currentStatus.label} onClick={() => setActive("riskAuth")}>
          <span />
          {currentStatus.label}
        </button>
        <button className="killButton" title="一键熔断：立即阻断所有新交易" onClick={() => setKillConfirm(true)}>
          <Zap size={15} /> 熔断
        </button>
        <button className="bellButton" title="通知" onClick={() => { setActive("auditSystem"); if (unread) action("/api/notifications/read", {}); }}>
          <Bell size={18} />
          {unread > 0 && <b>{unread}</b>}
        </button>
        {!data.user?.isOwner && (
          <button className="bellButton" title="账户 · 修改密码" onClick={() => setShowPassword(true)}><UserCog size={18} /></button>
        )}
      </div>
      {killConfirm && <KillConfirmDialog enable action={action} onClose={() => setKillConfirm(false)} />}
      {showPassword && <ChangePasswordDialog action={action} notify={notify} onClose={() => setShowPassword(false)} />}
    </header>
  );
}

function SystemSettingsPage({ data, action, ui, activeSettingsTab, setActiveSettingsTab }) {
  return (
    <div className="pageStack">
      <PageHeader active="systemSettings" />
      <div className="settingsSubNav" role="tablist" aria-label="系统设置导航">
        <button type="button" role="tab" aria-selected={activeSettingsTab === "config"} className={activeSettingsTab === "config" ? "active" : ""} onClick={() => setActiveSettingsTab("config")}>
          <Settings size={15} /> 系统配置
        </button>
        <button type="button" role="tab" aria-selected={activeSettingsTab === "risk"} className={activeSettingsTab === "risk" ? "active" : ""} onClick={() => setActiveSettingsTab("risk")}>
          <Shield size={15} /> 风控与授权
        </button>
        <button type="button" role="tab" aria-selected={activeSettingsTab === "tasks"} className={activeSettingsTab === "tasks" ? "active" : ""} onClick={() => setActiveSettingsTab("tasks")}>
          <CalendarClock size={15} /> 任务调度
        </button>
        <button type="button" role="tab" aria-selected={activeSettingsTab === "agents"} className={activeSettingsTab === "agents" ? "active" : ""} onClick={() => setActiveSettingsTab("agents")}>
          <BrainCircuit size={15} /> Agent 配置
        </button>
      </div>
      <div className="settingsPage">
        {activeSettingsTab === "risk"
          ? <RiskAuthPage data={data} action={action} ui={ui} embedded />
          : activeSettingsTab === "tasks"
            ? <EventsTasksPage data={data} action={action} ui={ui} embedded mode="tasks" />
            : activeSettingsTab === "agents"
              ? <AgentProfilesPanel data={data} action={action} />
              : <SystemConfigPanel data={data} action={action} ui={ui} />}
      </div>
    </div>
  );
}

function ChangePasswordDialog({ action, notify, onClose }) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  async function submit() {
    if (newPassword.length < 10) return notify("新密码至少 10 位");
    if (newPassword !== confirm) return notify("两次输入的新密码不一致");
    const result = await action("/api/auth/change-password", { oldPassword, newPassword });
    if (result && result.ok !== false) { notify("密码已修改"); onClose(); }
  }
  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(event) => event.stopPropagation()}>
        <h3>修改密码</h3>
        <label>原密码<input type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} /></label>
        <label>新密码（至少 10 位）<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <label>确认新密码<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
        <div className="modalActions">
          <button className="secondaryButton" onClick={onClose}>取消</button>
          <button className="primaryButton" onClick={submit}>确认修改</button>
        </div>
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

function App() {
  const [active, setActive] = useState("chat");
  const [activeSettingsTab, setActiveSettingsTab] = useState("config");
  const [cockpitTab, setCockpitTab] = useState("overview");
  const [panel, setPanel] = useState("");
  const isMobileViewport = useIsMobileViewport();
  const { data, loading, action, toast, authRequired, login, registerAccount, notify, download, refresh, apiBase, setApiBase, connectionError, busy, isNativeApp, publicInfo } = useApi();
  function navigate(next) {
    if (next === "riskAuth") {
      setActiveSettingsTab("risk");
      setActive("systemSettings");
      return;
    }
    // 旧入口重定向到合并后的驾驶舱（保留内部链接不失效）。
    if (next === "marketAccount") { setCockpitTab("overview"); setActive("cockpit"); return; }
    if (next === "review") { setCockpitTab("review"); setActive("cockpit"); return; }
    if (next === "systemSettings") setActiveSettingsTab("config");
    setActive(next);
  }
  const ui = { setActive: navigate, notify, download, refresh, openPanel: setPanel, closePanel: () => setPanel("") };
  const content = useMemo(() => {
    if (!data) return null;
    if (active === "cockpit") return <CockpitPage data={data} action={action} ui={ui} cockpitTab={cockpitTab} setCockpitTab={setCockpitTab} />;
    if (active === "knowledgeSkills") return <KnowledgeSkillsPage data={data} action={action} ui={ui} />;
    if (active === "eventsTasks") return <EventsTasksPage data={data} action={action} ui={ui} />;
    if (active === "auditSystem") return <AuditSystemPage data={data} action={action} ui={ui} />;
    if (active === "systemSettings") return <SystemSettingsPage data={data} action={action} ui={ui} activeSettingsTab={activeSettingsTab} setActiveSettingsTab={setActiveSettingsTab} />;
    if (active === "admin") return <AdminPage data={data} action={action} ui={ui} />;
    return <ChatPage data={data} action={action} ui={ui} />;
  }, [active, activeSettingsTab, cockpitTab, data, action]);

  if (authRequired) return <LoginScreen login={login} registerAccount={registerAccount} toast={toast} apiBase={apiBase} setApiBase={setApiBase} isNativeApp={isNativeApp} publicInfo={publicInfo} />;
  if (!loading && !data) return <ConnectionScreen apiBase={apiBase} setApiBase={setApiBase} refresh={refresh} toast={toast} connectionError={connectionError} isNativeApp={isNativeApp} />;
  if (loading || !data) return <div className="loading"><Activity size={28} /> 正在启动 Trader Agent...</div>;

  if (isNativeApp || isMobileViewport) {
    return <MobileApp api={{ data, action, toast, busy, notify, download, refresh }} />;
  }

  return (
    <div className="appShell">
      <Sidebar active={active} setActive={navigate} />
      <main className="mainArea">
        <AppTopbar data={data} setActive={navigate} notify={notify} action={action} />
        <div className="content">{content}</div>
      </main>
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {busy && <div className="busyIndicator"><Activity size={13} /> 执行中</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function BackendField({ apiBase, setApiBase, isNativeApp }) {
  const [value, setValue] = useState(apiBase || "");
  if (!isNativeApp) return null;
  return (
    <label className="backendField">
      <span>后端地址</span>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => setApiBase(value)}
        placeholder="例如 https://yegidawir.xyz"
        inputMode="url"
      />
    </label>
  );
}

function ConnectionScreen({ apiBase, setApiBase, refresh, toast, connectionError, isNativeApp }) {
  const [value, setValue] = useState(apiBase || "");
  function save(event) {
    event.preventDefault();
    const nextBase = setApiBase(value);
    refresh(true, nextBase);
  }
  return (
    <div className="loginScreen">
      <form className="loginPanel mobileConnectPanel" onSubmit={save}>
        <div className="brandMark"><BrandLogo size={36} /></div>
        <h1>连接 Trading Agent</h1>
        <p>{isNativeApp ? "填写你的后端地址。交易所密钥只保存在后端，App 只作为手机驾驶舱。" : "当前无法连接后端，请确认服务已启动。"}</p>
        <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://yegidawir.xyz" inputMode="url" autoFocus />
        <button className="primaryButton" type="submit">保存并连接</button>
        <button className="secondaryButton" type="button" onClick={() => refresh()}>重新连接</button>
        {(connectionError || toast) && <small>{connectionError || toast}</small>}
      </form>
    </div>
  );
}

function LoginScreen({ login, registerAccount, toast, apiBase, setApiBase, isNativeApp, publicInfo }) {
  const plans = publicInfo?.subscriptionPlans || [];
  const defaultPlanId = plans[0]?.id || "";
  const [mode, setMode] = useState("login");
  const [selectedPlanId, setSelectedPlanId] = useState(defaultPlanId);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", password: "" });
  const [payment, setPayment] = useState(null);
  useEffect(() => {
    if (!selectedPlanId && defaultPlanId) setSelectedPlanId(defaultPlanId);
  }, [defaultPlanId, selectedPlanId]);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) || plans[0];
  async function submitLogin(event) {
    event.preventDefault();
    const email = loginForm.email.trim();
    await login({ email, password: loginForm.password });
  }
  async function submitRegister(event) {
    event.preventDefault();
    const result = await registerAccount({ ...registerForm, planId: selectedPlan?.id });
    if (result?.payment) setPayment(result.payment);
  }
  return (
    <div className="landingShell">
      <main className="landingHero">
        <aside className="landingPanel">
          <div className="landingModeTabs">
            <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button>
            <button className={mode === "subscribe" ? "active" : ""} onClick={() => setMode("subscribe")}>订阅</button>
          </div>
          <BackendField apiBase={apiBase} setApiBase={setApiBase} isNativeApp={isNativeApp} />
          {mode === "login" ? (
            <form className="landingForm" onSubmit={submitLogin}>
              <label><span>邮箱</span><input value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} placeholder="you@example.com" autoFocus /></label>
              <label><span>密码</span><input type="password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} placeholder="登录密码" /></label>
              <button className="primaryButton" type="submit">进入交易驾驶舱</button>
              <button className="textButton centered" type="button" onClick={() => setMode("subscribe")}>还没有订阅？先开通账号 <ChevronRight size={14} /></button>
            </form>
          ) : (
            <form className="landingForm" onSubmit={submitRegister}>
              <div className="planSelector">
                {plans.map((plan) => (
                  <button type="button" className={selectedPlan?.id === plan.id ? "active" : ""} key={plan.id} onClick={() => setSelectedPlanId(plan.id)}>
                    <span>{plan.name}</span><b>{displayMoney(plan.priceUsdt, 0, "0")} USDT</b><small>{plan.months || 1} 个月</small>
                  </button>
                ))}
                {!plans.length && <div className="emptyPanel">Owner 还没有启用订阅套餐。</div>}
              </div>
              <label><span>姓名</span><input value={registerForm.name} onChange={(event) => setRegisterForm({ ...registerForm, name: event.target.value })} placeholder="你的名字" /></label>
              <label><span>邮箱</span><input value={registerForm.email} onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })} placeholder="you@example.com" /></label>
              <label><span>密码</span><input type="password" value={registerForm.password} onChange={(event) => setRegisterForm({ ...registerForm, password: event.target.value })} placeholder="至少 10 位" /></label>
              <button className="primaryButton" type="submit" disabled={!publicInfo?.registrationEnabled}><UserPlus size={16} /> 创建账号并生成支付单</button>
              {!publicInfo?.registrationEnabled && <small>当前未开启公开注册，Owner 可在服务器开启 PUBLIC_REGISTRATION_ENABLED。</small>}
              {payment && <div className="paymentBox"><strong>TRC20 USDT 支付信息</strong><span>{payment.amount} USDT</span><code>{payment.address}</code><small>支付确认后订阅会自动开通；Owner 也可以在 Admin 页面直接赠送授权。</small></div>}
            </form>
          )}
          <div className="landingChecks">
            {["实盘写入默认关闭", "交易所密钥只在后端", "计划必须经过风控"].map((item) => <span key={item}><CheckCircle2 size={14} /> {item}</span>)}
          </div>
          {toast && <small className="landingToast">{toast}</small>}
        </aside>
      </main>
    </div>
  );
}

const root = (window.__traderAgentRoot ||= createRoot(document.getElementById("root")));
root.render(<App />);
