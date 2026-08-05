import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getLang, setLang, t } from "./i18n.js";
import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  PieChart,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  FlaskConical,
  UserPlus,
  WalletCards,
  Send,
  Zap
} from "lucide-react";
import { displayMoney, exchangeState, systemStatus, useApi } from "./lib.jsx";
import { AssistantWidget } from "./assistant.jsx";
import { LandingPage } from "./landing.jsx";
import { isNativeApp } from "./lib.jsx";
import { ConfirmHost } from "./confirm.jsx";
import { SafeArea } from "@capacitor-community/safe-area";
import "./styles.css";

const lazyNamed = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })));
const ConfigPanel = lazyNamed(() => import("./panels.jsx"), "ConfigPanel");
const KillConfirmDialog = lazyNamed(() => import("./mobile.jsx"), "KillConfirmDialog");
const MobileApp = lazyNamed(() => import("./mobile.jsx"), "MobileApp");
const AiTraderCenter = lazyNamed(() => import("./workspacePages.jsx"), "AiTraderCenter");
const TradingCenter = lazyNamed(() => import("./workspacePages.jsx"), "TradingCenter");
const ResearchCenter = lazyNamed(() => import("./workspacePages.jsx"), "ResearchCenter");
const RiskCenter = lazyNamed(() => import("./workspacePages.jsx"), "RiskCenter");
const OperationsCenter = lazyNamed(() => import("./workspacePages.jsx"), "OperationsCenter");
const SettingsConcept = lazyNamed(() => import("./workspacePages.jsx"), "SettingsConcept");

if (isNativeApp()) {
  document.documentElement.classList.add("nativeApp");
  SafeArea.enable({ config: { customColorsForSystemBars: false } }).catch(() => {});
  document.querySelector('meta[name="viewport"]')?.setAttribute(
    "content",
    "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
  );
}

// 按心智模型把 9 页归并成 3 组(交易/研究/风控),降低"一堵墙 9 个平铺项"的认知负荷。
// 页面本身不动(不合并组件,零回归风险),只在侧栏加分组小标题。
// IA 重构 W1:导航按"交易 / 能力(知识→能力→使用) / 风控与运维"重排。
// 新增 信号中心(计划看板)、交易日志;合并 策略研究+分析作战室→策略与分析、实盘运营→审计。
// 风控与授权、知识与技能后续波次再拆(总览/设置、知识库/能力与工具)。
const navItems = [
  { id: "chat", label: "AI 交易员", labelEn: "AI Trader", icon: Bot },
  { id: "cockpit", label: "交易驾驶舱", labelEn: "Cockpit", icon: PieChart },
  { id: "researchCenter", label: "研究中心", labelEn: "Research", icon: BookOpen },
  { id: "riskCenter", label: "风控中心", labelEn: "Risk", icon: ShieldCheck },
  { id: "operationsCenter", label: "系统运营", labelEn: "Operations", icon: Activity }
];

function BrandLogo({ size = 34 }) {
  return <img className="brandLogo" src="/trading-agent-logo.svg" alt="Trading Agent" width={size} height={size} />;
}

function Sidebar({ active, setActive, data, lang, switchLang }) {
  const healthy = !data?.system?.killSwitch && (data?.system?.apiHealth ? !/异常|错误|失败/.test(String(data.system.apiHealth)) : true);
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark"><BrandLogo size={20} /></div>
        <div className="brandText">
          <strong>{t("交易 Agent", "Trading Agent")}</strong>
          <span className="brandSub">AI · DIGITAL ASSET</span>
        </div>
      </div>
      <nav className="nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          const on = active === item.id;
          const label = t(item.label, item.labelEn);
          return (
              <button key={item.id} className={`navItem ${on ? "active" : ""}`} title={label} onClick={() => setActive(item.id)}>
                <Icon size={16} />
                <span className="navLabelFull">{label}</span>
                <span className="navLabelShort">{label}</span>
              </button>
          );
        })}
      </nav>
      <div className="sidebarFoot">
        <div className="langToggle">
          <button className={lang === "zh" ? "on" : ""} onClick={() => switchLang("zh")}>中文</button>
          <button className={lang === "en" ? "on" : ""} onClick={() => switchLang("en")}>EN</button>
        </div>
        <div className={`sysStatusCard ${healthy ? "ok" : "warn"}`}>
          <div className="sscHead"><span className="sscDot" /> <b>{t("系统状态", "System")} · {healthy ? t("全盘正常", "All OK") : t("需关注", "Attention")}</b></div>
          <div className="sscMeta mono">api · ws · sync · {healthy ? "healthy" : "check"}</div>
          <button className="sscLink" onClick={() => setActive("operationsCenter")}>{t("查看运行日志", "View logs")} ›</button>
        </div>
        <button className={`navGear ${active === "systemSettings" ? "active" : ""}`} title={t("系统设置 / 密钥 / 用户管理", "Settings / Keys / Users")} onClick={() => setActive("systemSettings")}>
          <Settings size={15} /> {t("系统设置", "Settings")}
        </button>
      </div>
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
  // 用后端唯一真相 automationState.mode 判"全自动",别再自己拿 2 个开关猜(否则实盘写入没开/
  // 熔断/只减仓时照样喊 AUTO ON,与状态卡、AI 口径各说各话)。
  const autoOn = data.automationState?.mode === "full_auto_small";
  return (
    <header className="appTopbar">
      <div className="topSearch">
        <Search size={15} />
        <input placeholder="搜索市场 / 交易对 / 知识 / 功能" aria-label="搜索" />
      </div>
      <div className="topbarStatusGroup">
        <ExchangePill name="Binance" tone="binance" account={binance} onClick={() => setActive("systemSettings:exchange")} />
        <ExchangePill name="OKX" tone="okx" account={okx} onClick={() => setActive("systemSettings:exchange")} />
        {autoOn
          ? <span className="autoOnPill" title="全自动执行已开启"><span className="autoDot" /> AUTO ON</span>
          : live && <span className="livePill on" title="真实交易写入已开启">实盘写入开启</span>}
      </div>
      <div className="topbarActions">
        <button className={`autonomyPill ${currentStatus.tone}`} title={currentStatus.label} onClick={() => setActive("riskSettings")}>
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
        <button className="topAvatar" title={`${data.user?.name || "账户"} · 点击设置名称/头像`} onClick={() => setShowPassword(true)} aria-label="账户设置">
          {data.user?.avatar ? <img src={data.user.avatar} alt="" /> : (data.user?.name || "A").slice(0, 1).toUpperCase()}
        </button>
      </div>
      {killConfirm && <KillConfirmDialog enable action={action} onClose={() => setKillConfirm(false)} />}
      {showPassword && <AccountDialog user={data.user || {}} action={action} notify={notify} onClose={() => setShowPassword(false)} />}
    </header>
  );
}

// 账户设置：任何用户（含 Owner）都能改显示名 + 上传头像；非 Owner 还能自助改密码。
function AccountDialog({ user = {}, action, notify, onClose }) {
  const [name, setName] = useState(user.name || "");
  const [avatar, setAvatar] = useState(user.avatar || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const fileRef = useRef(null);
  const profileDirty = name.trim() !== (user.name || "") || avatar !== (user.avatar || "");

  // 客户端压缩：任何尺寸图片 → 128×128 居中裁剪 → JPEG data URL，控制在几十 KB。
  function pickAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) return notify("请选择图片文件");
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        setAvatar(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => notify("图片无法读取");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  async function saveProfile() {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 40) return notify("名称需 1–40 个字符");
    setSavingProfile(true);
    const result = await action("/api/account/profile", { name: trimmed, avatar }, "PATCH");
    setSavingProfile(false);
    if (result?.ok === true) notify("资料已更新");
  }

  async function changePassword() {
    if (newPassword.length < 10) return notify("新密码至少 10 位");
    if (newPassword !== confirm) return notify("两次输入的新密码不一致");
    const result = await action("/api/auth/change-password", { oldPassword, newPassword });
    if (result?.ok === true) { notify("密码已修改"); setOldPassword(""); setNewPassword(""); setConfirm(""); }
  }

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(event) => event.stopPropagation()}>
        <h3>账户设置</h3>
        <div className="acctAvatarRow">
          <div className="acctAvatarPreview">{avatar ? <img src={avatar} alt="头像" /> : (name || "A").slice(0, 1).toUpperCase()}</div>
          <div className="acctAvatarActions">
            <button type="button" className="secondaryButton" onClick={() => fileRef.current?.click()}>上传头像</button>
            {avatar && <button type="button" className="linkButton" onClick={() => setAvatar("")}>移除</button>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
            <small>自动压缩为 128×128，占用极小</small>
          </div>
        </div>
        <label>显示名称<input type="text" maxLength={40} value={name} placeholder="给自己起个名字" onChange={(event) => setName(event.target.value)} /></label>
        <div className="modalActions">
          <span className="modalHint">{user.email || ""}</span>
          <button className="primaryButton" disabled={!profileDirty || savingProfile} onClick={saveProfile}>{savingProfile ? "保存中…" : "保存资料"}</button>
        </div>
        {user.isOwner
          ? <p className="acctPwNote">Owner 登录密码由服务端 ADMIN_PASSWORD 管理，如需修改请在系统设置 · 安全中操作。</p>
          : <div className="acctPwBlock">
              <h4>修改密码</h4>
              <label>原密码<input type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} /></label>
              <label>新密码（至少 10 位）<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <label>确认新密码<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
              <div className="modalActions">
                <button className="secondaryButton" onClick={changePassword}>修改密码</button>
              </div>
            </div>}
        <div className="modalActions">
          <button className="secondaryButton" onClick={onClose}>关闭</button>
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
  const [lang, setLangState] = useState(getLang());
  const switchLang = (l) => { setLang(l); setLangState(l); try { action("/api/system/language", { lang: l }); } catch { /* AI 语言同步失败不影响 UI 切换 */ } };
  const [active, setActive] = useState("chat");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("dialog");
  const [activeSettingsTab, setActiveSettingsTab] = useState("base");
  const [panel, setPanel] = useState("");
  const isMobileViewport = useIsMobileViewport();
  const { data, loading, action, toast, authRequired, login, registerAccount, notify, download, refresh, apiBase, setApiBase, connectionError, busy, isNativeApp, publicInfo } = useApi();
  function navigate(next) {
    // 旧入口重定向到合并后的驾驶舱（保留内部链接不失效）。
    if (next === "chat") { setActiveWorkspaceTab("dialog"); setActive("chat"); return; }
    if (next === "cockpit") { setActiveWorkspaceTab("overview"); setActive("cockpit"); return; }
    if (next === "researchCenter") { setActiveWorkspaceTab("knowledge"); setActive("researchCenter"); return; }
    if (next === "riskCenter") { setActiveWorkspaceTab("posture"); setActive("riskCenter"); return; }
    if (next === "operationsCenter") { setActiveWorkspaceTab("overview"); setActive("operationsCenter"); return; }
    if (next === "marketAccount" || next === "market") { setActiveWorkspaceTab("market"); setActive("cockpit"); return; }
    if (next === "signalHub") { setActiveWorkspaceTab("orders"); setActive("cockpit"); return; }
    if (next === "tradeJournal") { setActiveWorkspaceTab("journal"); setActive("cockpit"); return; }
    if (next === "knowledgeBase") { setActiveWorkspaceTab("knowledge"); setActive("researchCenter"); return; }
    if (next === "capabilities") { setActiveWorkspaceTab("capabilities"); setActive("researchCenter"); return; }
    if (["strategyAnalysis", "analysisRoom", "strategyWorkbench"].includes(next)) { setActiveWorkspaceTab("strategy"); setActive("researchCenter"); return; }
    if (next === "riskOverview") { setActiveWorkspaceTab("posture"); setActive("riskCenter"); return; }
    if (next === "riskSettings") { setActiveWorkspaceTab("rules"); setActive("riskCenter"); return; }
    if (next === "eventsTasks" || next === "eventsTasks:events") { setActiveWorkspaceTab("events"); setActive("operationsCenter"); return; }
    if (next === "eventsTasks:tasks") { setActiveWorkspaceTab("tasks"); setActive("operationsCenter"); return; }
    if (next === "auditSystem") { setActiveWorkspaceTab("audit"); setActive("operationsCenter"); return; }
    // Admin 并入系统设置的"用户管理"tab（仅 Owner 可见）。
    if (next === "admin") { setActiveSettingsTab("users"); setActive("systemSettings"); return; }
    if (next === "systemSettings:exchange") { setActiveSettingsTab("exchange"); setActive("systemSettings"); return; }
    if (next === "systemSettings") setActiveSettingsTab("base");
    setActive(next);
  }
  const ui = { setActive: navigate, notify, download, refresh, openPanel: setPanel, closePanel: () => setPanel("") };
  const content = useMemo(() => {
    if (!data) return null;
    if (active === "chat") return <AiTraderCenter key={`chat:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "cockpit") return <TradingCenter key={`cockpit:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "researchCenter") return <ResearchCenter key={`research:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "riskCenter") return <RiskCenter key={`risk:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "operationsCenter") return <OperationsCenter key={`operations:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "systemSettings") return <SettingsConcept data={data} action={action} ui={ui} activeTab={activeSettingsTab} onTabChange={setActiveSettingsTab} />;
    return <AiTraderCenter data={data} action={action} ui={ui} />;
  }, [active, activeSettingsTab, activeWorkspaceTab, data, action, lang]);

  if (authRequired) return <LandingPage login={login} registerAccount={registerAccount} toast={toast} apiBase={apiBase} setApiBase={setApiBase} isNativeApp={isNativeApp} publicInfo={publicInfo} />;
  if (!loading && !data) return <ConnectionScreen apiBase={apiBase} setApiBase={setApiBase} refresh={refresh} toast={toast} connectionError={connectionError} isNativeApp={isNativeApp} />;
  if (loading || !data) return <div className="loading"><Activity size={28} /> {t("正在启动 Trader Agent...", "Starting Trader Agent...")}</div>;

  if (isNativeApp || isMobileViewport) {
    return <MobileApp api={{ data, action, toast, busy, notify, download, refresh, connectionError }} />;
  }

  return (
    <div className="appShell" key={lang}>
      <Sidebar active={active} setActive={navigate} data={data} lang={lang} switchLang={switchLang} />
      <main className="mainArea">
        <AppTopbar data={data} setActive={navigate} notify={notify} action={action} />
        {/* 页面级独立 Suspense：切换懒加载页时只在内容区显骨架，不再冒泡到根 Suspense 把整站(含侧栏)闪白 */}
        <div className={active === "chat" ? "content contentChat" : "content"}>
          <Suspense fallback={<PageSkeleton />}>{content}</Suspense>
        </div>
      </main>
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {busy && <div className="busyIndicator"><Activity size={13} /> 执行中</div>}
      <AssistantWidget data={data} ui={ui} />
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
  const flow = [["喂知识", BookOpen], ["读懂转成能力", BrainCircuit], ["采纳即用", CheckCircle2], ["下单前硬风控", ShieldCheck], ["自动执行", Zap], ["在用复盘·留退", RefreshCw]];
  const features = [
    [BookOpen, "知识闭环", "导入你信任的交易书籍与文章，系统读懂后转成可直接用的策略、分析提示词与风控纪律，每一条都带来源引用。"],
    [ShieldCheck, "执行前风控", "每笔计划在下单前都会重跑硬风控，触及杠杆、单日亏损或授权边界即被拦截。"],
    [Shield, "授权边界", "交易所、杠杆、单日最大亏损由你设定，Agent 不得越权；API 密钥只留在后端且无提币权限。"],
    [RefreshCw, "复盘进化", "每次平仓自动复盘；实盘表现持续变差的策略会被自动降级、退役。"]
  ];
  return (
    <div className="landingShell">
      <div className="landingTopbar">
        <span className="landingBrand"><span className="landingLogo"><BrainCircuit size={17} /></span><strong>Trading Agent</strong><em>知识驱动的 AI 交易员</em></span>
      </div>
      <main className="landingHero split">
        <section className="landingMarketing">
          <span className="landingEyebrow">AI 交易员 · 知识驱动</span>
          <h2 className="landingTitle">把你的交易书，<br />变成一个<span className="landingHl">守纪律</span>的 AI 交易员</h2>
          <p className="landingSub">导入你信任的交易书籍与文章，系统读懂后转成可直接使用的策略、分析提示词与风控纪律。每一笔真实下单前都重跑硬风控、受你设定的授权边界与额度约束；用真实表现持续复盘，好的留下、差的自动退役——全程可复盘、可追溯。</p>
          <div className="landingStats">
            {[["书→能力", "策略/提示词/工作流"], ["在用验证", "真实表现留/退"], ["每一笔", "下单前重跑风控"], ["0", "提币权限"]].map(([n, l]) => (
              <div className="landingStat" key={l}><b>{n}</b><span>{l}</span></div>
            ))}
          </div>
          <div className="landingFlow">
            {flow.map(([label, Icon], i) => (
              <React.Fragment key={label}>
                {i > 0 && <span className="landingFlowArrow">›</span>}
                <span className="landingFlowStep"><Icon size={14} /> {label}</span>
              </React.Fragment>
            ))}
          </div>
          <div className="landingFeatures">
            {features.map(([Icon, title, desc]) => (
              <div className="landingFeature" key={title}>
                <span className="landingFeatureIcon"><Icon size={16} /></span>
                <b>{title}</b>
                <p>{desc}</p>
              </div>
            ))}
          </div>
          <div className="landingChecks">
            {["实盘写入默认关闭", "交易所密钥只在后端", "API 无提币权限", "计划必过执行前风控"].map((item) => <span key={item}><CheckCircle2 size={14} /> {item}</span>)}
          </div>
          <p className="landingDisclaimer">风险提示：加密货币交易风险极高，可能损失全部本金。历史回测与模拟盘验证不代表未来收益；本系统提供纪律执行与工具，不构成任何投资建议。</p>
        </section>
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
              {!publicInfo?.registrationEnabled && <small>当前未开启公开注册。Owner 可在 Admin → 用户授权 里打开“公开注册”开关，或直接为用户开通账号。</small>}
              {payment && <div className="paymentBox"><strong>TRC20 USDT 支付信息</strong><span>{payment.amount} USDT</span><code>{payment.address}</code><small>支付确认后订阅会自动开通；Owner 也可以在 Admin 页面直接赠送授权。</small></div>}
            </form>
          )}
          <div className="landingChecks">
            {["实盘写入默认关闭", "交易所密钥只在后端", "计划必须经过风控"].map((item) => <span key={item}><CheckCircle2 size={14} /> {item}</span>)}
          </div>
          {toast && <small className="landingToast">{toast}</small>}
        </aside>
      </main>
      <a className="contactFab" href="https://t.me/e2ptradingclub" target="_blank" rel="noopener noreferrer" title="Telegram 联系我们">
        <Send size={18} /> 联系我们
      </a>
    </div>
  );
}

// 页面切换骨架：占位与真实页面近似的卡片轮廓，避免"白一下再弹出"。
function PageSkeleton() {
  return (
    <div className="pageSkeleton" aria-busy="true">
      <div className="skRow skHead" />
      <div className="skGrid">{Array.from({ length: 4 }).map((_, i) => <div className="skCard" key={i} />)}</div>
      <div className="skRow skWide" />
      <div className="skRow skWide" />
    </div>
  );
}

const root = (window.__traderAgentRoot ||= createRoot(document.getElementById("root")));
root.render(
  <Suspense fallback={<div className="loading"><Activity size={28} /> 正在加载交易模块...</div>}>
    <App />
    <ConfirmHost />
  </Suspense>
);
