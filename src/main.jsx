import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getLang, setLang, t } from "./i18n.js";
import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  ChevronRight,
  PieChart,
  RefreshCw,
  Search,
  Settings,
  Target,
  Globe,
  Info,
  ShieldCheck,
  X,
  Zap
} from "lucide-react";
import { automationPresentation, exchangeState, localizeText, useApi } from "./lib.jsx";
import { AssistantWidget } from "./assistant.jsx";
import { LandingPage } from "./landing.jsx";
import { isNativeApp } from "./lib.jsx";
import { ConfirmHost, uiConfirm } from "./confirm.jsx";
import { hasNewWebRelease, normalizeRelease } from "./releaseUpdate.js";
import { shellStatusTone } from "./shellStatus.js";
import { applyTradingModeOnce, buildTradingModePayload } from "./tradingModeSubmission.js";
import { SafeArea } from "@capacitor-community/safe-area";
import "./app.css";

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
  { id: "chat", group: "trade", label: "AI 交易员", labelEn: "AI Trader", icon: "✦" },
  { id: "cockpit", group: "trade", label: "交易驾驶舱", labelEn: "Cockpit", icon: "◫" },
  { id: "researchCenter", group: "research", label: "研究中心", labelEn: "Research", icon: "◇" },
  { id: "riskCenter", group: "research", label: "风控中心", labelEn: "Risk", icon: "⬡" },
  { id: "operationsCenter", group: "ops", label: "系统运营", labelEn: "Operations", icon: "◎" },
  { id: "systemSettings", group: "ops", label: "系统设置", labelEn: "Settings", icon: "⚙" }
];

const navGroups = [
  { id: "trade", label: "交易工作区", labelEn: "TRADING" },
  { id: "research", label: "研究与安全", labelEn: "RESEARCH & SAFETY" },
  { id: "ops", label: "运营与配置", labelEn: "OPERATIONS" }
];

function BrandLogo({ size = 34, variant = "black" }) {
  const src = variant === "white" ? "/kordyn-logo-white.svg" : "/kordyn-logo.svg";
  return <img className="brandLogo" src={src} alt="KORDYN" width={size} height={size} />;
}

function Sidebar({ active, setActive, data }) {
  const unread = (data?.notifications || []).filter((item) => !item.read).length;
  const workspaceLabel = data?.user?.isOwner === true ? t("Owner 工作区", "Owner workspace") : t("个人工作区", "Personal workspace");
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">K</div>
        <div><b>KORDYN</b><small>AI TRADING OS</small></div>
      </div>
      <nav className="nav-scroll">
        {navGroups.map((group) => <section className="nav-group" key={group.id}>
          <span className="nav-label">{t(group.label, group.labelEn)}</span>
          {navItems.filter((item) => item.group === group.id).map((item) => {
            const on = active === item.id;
            const label = t(item.label, item.labelEn);
            const badge = item.id === "operationsCenter" ? unread : 0;
            return (
                <button key={item.id} className={`nav-item ${on ? "active" : ""}`} title={label} onClick={() => setActive(item.id)}>
                  <i className="ico">{item.icon}</i>{label}
                  {badge > 0 && <span className="nav-badge">{badge}</span>}
                </button>
            );
          })}
        </section>)}
      </nav>
      <div className="nav-foot">
        <span>{t("系统版本", "System release")}<strong>{normalizeRelease(import.meta.env?.VITE_APP_RELEASE) || "LOCAL"}</strong></span>
        <b>{workspaceLabel}</b>
        <small>{t("所有页面共享同一权威状态", "All pages share one authoritative state")}</small>
      </div>
    </aside>
  );
}

function useIsMobileViewport() {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 900px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => setMobile(query.matches);
    const raf = window.requestAnimationFrame(sync);
    query.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      window.cancelAnimationFrame(raf);
      query.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);
  return mobile;
}

function AppTopbar({ data, setActive, action, lang, switchLang }) {
  const [killConfirm, setKillConfirm] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [modeOpen, setModeOpen] = useState(false);
  const [modeSaving, setModeSaving] = useState(false);
  const modeRequestLock = useRef(false);
  const runtime = automationPresentation(data);
  const runtimeTone = shellStatusTone(runtime.tone, runtime.runtimeStatus, runtime.mode);
  const stopped = data.system?.killSwitch === true;
  const okx = (data.exchangeAccounts || []).find((item) => item.exchange === "OKX") || {};
  const unread = (data.notifications || []).filter((item) => !item.read).length;
  const displayUserName = localizeText(data.user?.name || data.user?.email || t("账户", "Account"));
  const savedMode = data.automationState?.selectedMode || data.automationState?.requestedMode || runtime.targetMode || "observe";
  const [selectedMode, setSelectedMode] = useState(savedMode);
  useEffect(() => setSelectedMode(savedMode), [savedMode]);
  const searchItems = [
    ["chat", t("AI 交易员", "AI Trader"), t("对话、情报与盯盘", "Dialog, intel, and watch")],
    ["cockpit", t("交易驾驶舱", "Trading Cockpit"), t("行情、执行、复盘与 Owner 优化", "Market, execution, and review")],
    ["researchCenter", t("研究中心", "Research Center"), t("知识、策略与能力", "Knowledge, strategies, and capabilities")],
    ["riskCenter", t("风控中心", "Risk Center"), t("当前状态、授权与保护规则", "Posture, mandate, and protection")],
    ["operationsCenter", t("系统运营", "Operations"), t("运行、日历、任务、审计与通知", "Runtime, calendar, tasks, audit, and notifications")],
    ["systemSettings", t("系统设置", "System Settings"), t("账户、OKX、模型与集成", "Account, OKX, models, and integrations")],
    ...((data.tradePlans || []).slice(0, 8).map((item) => ["signalHub", `${item.symbol || "—"} · ${localizeText(item.name || item.strategy || t("交易计划", "Trade plan"))}`, item.id || ""])),
    ...((data.tasks || []).slice(0, 8).map((item) => ["eventsTasks:tasks", localizeText(item.name || item.title || t("任务", "Task")), item.id || ""]))
  ];
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const searchResults = searchItems.filter(([, label, hint]) => !normalizedSearch || `${label} ${hint}`.toLowerCase().includes(normalizedSearch)).slice(0, 10);
  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen(true); }
      if (event.key === "Escape") { setSearchOpen(false); setModeOpen(false); setLangOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const flattenAll = async () => {
    if (await uiConfirm(t("确认按市价平掉全部持仓？提交后系统会暂停新开仓，直到 OKX 对账确认全部处置完成。", "Close every position at market? New entries pause until reconciliation completes."))) action("/api/risk/emergency-flatten", {});
  };
  const applyMode = async () => {
    if (modeRequestLock.current) return;
    const live = data.config?.liveTrading || {};
    if (selectedMode !== "observe" && !live.acknowledged) { setModeOpen(false); setActive("riskMandate"); return; }
    const ok = selectedMode === "observe" || await uiConfirm(selectedMode === "full_auto" ? t("确认切换到自动交易？", "Switch to automatic trading?") : t("确认切换到逐笔确认？", "Switch to approval-required trading?"));
    if (!ok) return;
    setModeSaving(true);
    await applyTradingModeOnce({
      lock: modeRequestLock,
      payload: buildTradingModePayload(selectedMode, live),
      request: (payload) => action("/api/config/live-trading", payload),
      onSuccess: () => setModeOpen(false)
    });
    setModeSaving(false);
  };
  return <header className="appTopbar global-bar">
    <button type="button" className="search-button" onClick={() => setSearchOpen(true)}><span aria-hidden="true">⌕</span><span className="search-copy">{t("搜索市场、交易对、知识或功能", "Search markets, pairs, knowledge, or features")}</span><kbd>⌘ K</kbd></button>
    <div className="bar-spacer" />
    <ExchangePill name="OKX" account={okx} onClick={() => setActive("systemSettings:exchange")} />
    <button type="button" className="global-chip clickable mode" onClick={() => { setSelectedMode(savedMode); setModeOpen(true); }}><i className="dot"/><span><small>{t("选择的模式", "SAVED MODE")}</small><b>{runtime.targetLabel}</b></span></button>
    <button type="button" className={`global-chip clickable status-${runtimeTone}`} onClick={() => setActive("riskCenter")}><i className="dot"/><span><small>{t("当前实际状态", "EFFECTIVE NOW")}</small><b>{runtime.label}</b></span></button>
    <div className="global-actions"><button type="button" onClick={flattenAll}>{t("全部平仓", "Flatten")}</button><button type="button" className="danger" onClick={() => setKillConfirm(true)}>⚡ {stopped ? t("解除停止", "Clear stop") : t("紧急停止", "Emergency stop")}</button></div>
    <div className="global-utilities" aria-label={t("账户与通知", "Account and notifications")}>
      <button type="button" className="global-notifications" title={t("通知中心", "Notification center")} aria-label={t("通知", "Notifications")} onClick={() => setActive("operationsCenter:notifications")}>
        <Bell size={16}/>{unread > 0 && <b>{unread > 99 ? "99+" : unread}</b>}
      </button>
      <div className="global-language">
        <button type="button" title={t("切换语言", "Switch language")} aria-label={t("切换语言", "Switch language")} aria-haspopup="menu" aria-expanded={langOpen} onClick={() => setLangOpen((open) => !open)}><Globe size={16}/></button>
        {langOpen && <><button type="button" className="global-language-backdrop" aria-label={t("关闭语言菜单", "Close language menu")} onClick={() => setLangOpen(false)}/><div className="global-language-menu" role="menu"><button role="menuitemradio" aria-checked={lang === "zh"} className={lang === "zh" ? "active" : ""} onClick={() => { switchLang("zh"); setLangOpen(false); }}>中文<span>{lang === "zh" ? "✓" : ""}</span></button><button role="menuitemradio" aria-checked={lang === "en"} className={lang === "en" ? "active" : ""} onClick={() => { switchLang("en"); setLangOpen(false); }}>English<span>{lang === "en" ? "✓" : ""}</span></button></div></>}
      </div>
      <button type="button" className="global-account" title={`${displayUserName} · ${t("账户设置", "Account settings")}`} aria-label={t("账户设置", "Account settings")} onClick={() => setActive("systemSettings")}>{data.user?.avatar ? <img src={data.user.avatar} alt=""/> : String(displayUserName || "K").slice(0, 1).toUpperCase()}</button>
    </div>
    {searchOpen && <div className="modal-backdrop" onMouseDown={() => setSearchOpen(false)}><section className="modal" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header className="modal-head"><div><h2>{t("全局搜索", "Global Search")}</h2><p>{t("搜索页面、交易对、计划、知识和任务；结果会进入唯一权威页面。", "Search pages, pairs, plans, knowledge, and tasks.")}</p></div><button className="modal-close" onClick={() => setSearchOpen(false)}>×</button></header><div className="modal-body"><input id="global-search-input" className="text-input" autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t("例如：BTC、复盘、OKX、知识", "For example: BTC, reviews, OKX, knowledge")}/><div className="command-list">{searchResults.map(([route,label,hint],index)=><button className="command" key={`${route}-${label}-${index}`} onClick={()=>{setActive(route);setSearchOpen(false);setSearchQuery("");}}><span><b>{label}</b><small>{hint}</small></span><em>{index<6?t("页面","Page"):t("实体","Item")}</em></button>)}{!searchResults.length&&<div className="empty"><div><b>{t("没有匹配结果","No matches")}</b><p>{t("尝试交易对、页面名称或任务名称。","Try a pair, page name, or task name.")}</p></div></div>}</div></div></section></div>}
    {modeOpen && <div className="modal-backdrop" onMouseDown={()=>{if(!modeSaving)setModeOpen(false);}}><section className="modal" role="dialog" aria-modal="true" aria-busy={modeSaving} onMouseDown={(event)=>event.stopPropagation()}><header className="modal-head"><div><h2>{t("切换交易模式","Switch trading mode")}</h2><p>{t("这是唯一的运行模式选择；“暂停新开仓”只是异常状态，不是第四种模式。","This is the only operating-mode selector; an entry pause is a temporary runtime state.")}</p></div><button className="modal-close" disabled={modeSaving} onClick={()=>setModeOpen(false)}>×</button></header><div className="modal-body"><div className="mode-options">{[["observe",t("只分析","Analyze only"),t("持续分析、生成判断，不向 OKX 提交订单","Analyze continuously without sending orders"),"◎"],["semi_auto",t("逐笔确认","Approve each trade"),t("计划通过模型审查与硬风控后，等待 Owner 确认","Wait for Owner approval after all checks"),"✓"],["full_auto",t("自动交易","Automatic trading"),t("计划通过全部检查后自动执行；异常只会临时暂停新开仓","Execute after all checks; incidents only pause new entries"),"⚡"]].map(([id,label,desc,icon])=><button key={id} disabled={modeSaving} className={`mode-option ${selectedMode===id?"active":""}`} onClick={()=>setSelectedMode(id)}><i>{icon}</i><span><b>{label}</b><p>{desc}</p></span></button>)}</div><div className="note owner">{t("切换模式不会强平已有仓位；已有仓位始终由原计划和保护合同继续管理。","Changing mode never force-closes existing positions; their original protection remains active.")}</div></div><footer className="modal-foot"><button className="btn" disabled={modeSaving} onClick={()=>setModeOpen(false)}>{t("取消","Cancel")}</button><button className="btn primary" disabled={modeSaving} onClick={applyMode}>{modeSaving?t("正在应用…","Applying…"):t("应用模式","Apply mode")}</button></footer></section></div>}
    {killConfirm && <KillConfirmDialog enable={!stopped} action={action} onClose={() => setKillConfirm(false)} />}
  </header>;
}

function ExchangePill({ name, account = {}, onClick }) {
  const state = exchangeState(account);
  const tone = shellStatusTone(state.tone, account.status, account.connectionStatus, state.label);
  return <button className={`global-chip clickable status-${tone}`} title={`${name}：${state.label}`} onClick={onClick}><i className="dot"/><span><small>{name}</small><b>{state.label}</b></span></button>;
}

function App() {
  const [lang, setLangState] = useState(getLang());
  const switchLang = (l) => { setLang(l); setLangState(l); try { action("/api/system/language", { lang: l }); } catch { /* AI 语言同步失败不影响 UI 切换 */ } };
  const [active, setActive] = useState("chat");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("dialog");
  const [activeReviewId, setActiveReviewId] = useState("");
  const [activeStrategyTab, setActiveStrategyTab] = useState("catalog");
  const [activeSettingsTab, setActiveSettingsTab] = useState("account");
  const [panel, setPanel] = useState("");
  const isMobileViewport = useIsMobileViewport();
  const { data, loading, action, toast, authRequired, login, registerAccount, notify, download, refresh, ensureSection, apiBase, setApiBase, connectionError, busy, isNativeApp, publicInfo } = useApi();
  useEffect(() => {
    if (data) ensureSection(active);
  }, [active, Boolean(data)]);
  function navigate(next) {
    // 旧入口重定向到合并后的驾驶舱（保留内部链接不失效）。
    if (next === "chat") { setActiveWorkspaceTab("dialog"); setActive("chat"); return; }
    if (next === "chat:intel") { setActiveWorkspaceTab("intel"); setActive("chat"); return; }
    if (next === "chat:watch") { setActiveWorkspaceTab("watch"); setActive("chat"); return; }
    if (next === "cockpit") { setActiveWorkspaceTab("overview"); setActive("cockpit"); return; }
    if (next === "researchCenter") { setActiveWorkspaceTab("knowledge"); setActive("researchCenter"); return; }
    if (next === "riskCenter") { setActiveWorkspaceTab("posture"); setActive("riskCenter"); return; }
    if (next === "riskMandate") { setActiveWorkspaceTab("mandate"); setActive("riskCenter"); return; }
    if (next === "operationsCenter") { setActiveWorkspaceTab("overview"); setActive("operationsCenter"); return; }
    if (next === "marketAccount" || next === "market") { setActiveWorkspaceTab("market"); setActive("cockpit"); return; }
    if (next === "signalHub") { setActiveWorkspaceTab("execution"); setActive("cockpit"); return; }
    if (next === "tradeJournal") { setActiveWorkspaceTab("execution"); setActive("cockpit"); return; }
    if (String(next).startsWith("tradeReviewDetail")) { setActiveReviewId(String(next).split(":").slice(1).join(":")); setActiveWorkspaceTab("reviews"); setActive("cockpit"); return; }
    if (next === "ownerReviewWorkspace") { setActiveWorkspaceTab("owner"); setActive("cockpit"); return; }
    if (next === "tradeLedger") { setActiveWorkspaceTab("ledger"); setActive("cockpit"); return; }
    if (next === "knowledgeBase" || next === "researchCenter:knowledge") { setActiveWorkspaceTab("knowledge"); setActive("researchCenter"); return; }
    if (next === "capabilities" || next === "researchCenter:capabilities") { setActiveWorkspaceTab("capabilities"); setActive("researchCenter"); return; }
    if (next === "researchCenter:strategy") { setActiveStrategyTab("catalog"); setActiveWorkspaceTab("strategy"); setActive("researchCenter"); return; }
    if (["strategyAnalysis", "analysisRoom", "strategyWorkbench"].includes(next)) { setActiveStrategyTab("catalog"); setActiveWorkspaceTab("strategy"); setActive("researchCenter"); return; }
    if (next === "strategyStudio") { setActiveStrategyTab("studio"); setActiveWorkspaceTab("strategy"); setActive("researchCenter"); return; }
    if (next === "riskOverview") { setActiveWorkspaceTab("posture"); setActive("riskCenter"); return; }
    if (next === "riskSettings") { setActiveWorkspaceTab("rules"); setActive("riskCenter"); return; }
    if (next === "riskIncidents" || next === "riskCenter:incidents") { setActiveWorkspaceTab("incidents"); setActive("riskCenter"); return; }
    if (next === "eventsTasks" || next === "eventsTasks:events") { setActiveWorkspaceTab("events"); setActive("operationsCenter"); return; }
    if (next === "eventsTasks:tasks") { setActiveWorkspaceTab("tasks"); setActive("operationsCenter"); return; }
    if (next === "auditSystem") { setActiveWorkspaceTab("audit"); setActive("operationsCenter"); return; }
    if (next === "operationsCenter:notifications" || next === "notificationsCenter") { setActiveWorkspaceTab("notifications"); setActive("operationsCenter"); return; }
    // Admin 并入系统设置的"用户管理"tab（仅 Owner 可见）。
    if (next === "admin") { setActiveSettingsTab("users"); setActive("systemSettings"); return; }
    if (next === "systemSettings:exchange") { setActiveSettingsTab("exchange"); setActive("systemSettings"); return; }
    if (next === "systemSettings:notifications") { setActiveSettingsTab("notifications"); setActive("systemSettings"); return; }
    if (next === "systemSettings:models") { setActiveSettingsTab("models"); setActive("systemSettings"); return; }
    if (next === "systemSettings:data") { setActiveSettingsTab("data"); setActive("systemSettings"); return; }
    if (next === "systemSettings") setActiveSettingsTab("account");
    setActive(next);
  }
  const ui = { setActive: navigate, notify, download, refresh, ensureSection, openPanel: setPanel, closePanel: () => setPanel("") };
  const content = useMemo(() => {
    if (!data) return null;
    const resourceState = data.resourceState?.[active] || "not_loaded";
    if (resourceState !== "loaded") return <WorkspaceLoadState state={resourceState} onRetry={() => ensureSection(active, { force: true })} />;
    if (active === "chat") return <AiTraderCenter key={`chat:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "cockpit") return <TradingCenter key={`cockpit:${activeWorkspaceTab}:${activeReviewId}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} reviewInitialId={activeReviewId} />;
    if (active === "researchCenter") return <ResearchCenter key={`research:${activeWorkspaceTab}:${activeStrategyTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} strategyInitialTab={activeStrategyTab} />;
    if (active === "riskCenter") return <RiskCenter key={`risk:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "operationsCenter") return <OperationsCenter key={`operations:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "systemSettings") return <SettingsConcept data={data} action={action} ui={ui} activeTab={activeSettingsTab} onTabChange={setActiveSettingsTab} />;
    return <AiTraderCenter data={data} action={action} ui={ui} />;
  }, [active, activeSettingsTab, activeWorkspaceTab, activeStrategyTab, activeReviewId, data, action, lang]);

  if (authRequired) return <LandingPage login={login} registerAccount={registerAccount} toast={toast} apiBase={apiBase} setApiBase={setApiBase} isNativeApp={isNativeApp} publicInfo={publicInfo} />;
  if (!loading && !data) return <ConnectionScreen apiBase={apiBase} setApiBase={setApiBase} refresh={refresh} toast={toast} connectionError={connectionError} isNativeApp={isNativeApp} />;
  if (loading || !data) return <div className="loading"><Activity size={28} /> {t("正在启动 Trader Agent...", "Starting Trader Agent...")}</div>;

  if (isNativeApp || isMobileViewport) {
    // key={lang}:切换语言时整树 remount,让 mobile.jsx 里的 t() 立即全量重渲染(同桌面外壳)。
    return <MobileApp key={lang} lang={lang} switchLang={switchLang} api={{ data, action, toast, busy, notify, download, refresh, ensureSection, connectionError }} />;
  }

  return (
    <div className="appShell app-shell" key={lang}>
      <Sidebar active={active} setActive={navigate} data={data} lang={lang} switchLang={switchLang} />
      <main className="mainArea main-shell">
        <AppTopbar data={data} setActive={navigate} action={action} lang={lang} switchLang={switchLang} />
        {/* 页面级独立 Suspense：切换懒加载页时只在内容区显骨架，不再冒泡到根 Suspense 把整站(含侧栏)闪白 */}
        <div className={active === "chat" ? "content workspace contentChat" : "content workspace"}>
          <Suspense fallback={<PageSkeleton />}>{content}</Suspense>
        </div>
      </main>
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {busy && <div className="busyIndicator"><Activity size={13} /> {t("执行中", "Working")}</div>}
      <AssistantWidget data={data} ui={ui} currentPage={`${active}:${active === "systemSettings" ? activeSettingsTab : activeWorkspaceTab}`} />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function ConnectionScreen({ apiBase, setApiBase, refresh, toast, connectionError, isNativeApp }) {
  const [value, setValue] = useState(apiBase || "");
  function save(event) {
    event.preventDefault();
    if (isNativeApp) {
      const nextBase = setApiBase(value);
      refresh(true, nextBase);
      return;
    }
    // Web is always same-origin; do not let a stale/custom browser URL keep the
    // recovery screen pointed away from the host that served this page.
    refresh(true, "");
  }
  return (
    <div className="loginScreen">
      <form className="loginPanel mobileConnectPanel" onSubmit={save}>
        <div className="brandMark"><BrandLogo size={36} variant={isNativeApp ? "black" : "white"} /></div>
        <h1>{t("连接 KORDYN", "Connect to KORDYN")}</h1>
        <p>{isNativeApp ? t("填写后端地址。交易所密钥只保存在服务器，App 仅作为手机控制台。", "Enter your server URL. Exchange keys remain on the server; the app is only a mobile control surface.") : t("当前无法连接服务器，请确认服务已启动。", "The server is unavailable. Confirm that the service is running.")}</p>
        {isNativeApp && <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="https://yegidawir.xyz" inputMode="url" autoFocus />}
        <button className="primaryButton" type="submit">{isNativeApp ? t("保存并连接", "Save and connect") : t("重新连接", "Reconnect")}</button>
        {isNativeApp && <button className="secondaryButton" type="button" onClick={() => refresh()}>{t("重新连接", "Reconnect")}</button>}
        {(connectionError || toast) && <small>{connectionError || toast}</small>}
      </form>
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

function WorkspaceLoadState({ state, onRetry }) {
  if (state !== "error") return <PageSkeleton />;
  return (
    <div className="pageSkeleton workspaceLoadError" role="alert">
      <Info size={22} />
      <strong>{t("该页面数据加载失败", "This workspace could not be loaded")}</strong>
      <span>{t("当前空白不代表数据为零，请重试同步。", "Blank values are not authoritative. Retry the sync.")}</span>
      <button className="secondary" type="button" onClick={onRetry}>{t("重新加载", "Retry")}</button>
    </div>
  );
}

const CLIENT_RELEASE = normalizeRelease(import.meta.env?.VITE_APP_RELEASE);

function ReleaseUpdateNotice() {
  const [serverRelease, setServerRelease] = useState(null);
  useEffect(() => {
    if (isNativeApp() || !CLIENT_RELEASE) return undefined;
    let disposed = false;
    const check = async () => {
      try {
        const response = await fetch(`/api/health?release_check=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin"
        });
        if (!response.ok) return;
        const health = await response.json();
        if (!disposed && hasNewWebRelease(CLIENT_RELEASE, health.release)) setServerRelease(health.release);
      } catch { /* 弱网或服务暂不可达时不打扰用户，正常重连逻辑会继续处理。 */ }
    };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    const interval = window.setInterval(check, 60_000);
    const initial = window.setTimeout(check, 15_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.clearTimeout(initial);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, []);
  if (!serverRelease) return null;
  return (
    <aside className="releaseUpdateNotice" role="status" aria-live="polite">
      <div>
        <strong>{t("发现新版本", "Update available")}</strong>
        <span>{t("刷新后使用最新功能，不会退出登录。", "Refresh to use the latest version. You will stay signed in.")}</span>
      </div>
      <button type="button" onClick={() => window.location.reload()}>{t("立即刷新", "Refresh")}</button>
    </aside>
  );
}

const root = (window.__traderAgentRoot ||= createRoot(document.getElementById("root")));
root.render(
  <Suspense fallback={<div className="loading"><Activity size={28} /> {t("正在加载交易模块...", "Loading trading modules...")}</div>}>
    <App />
    <ReleaseUpdateNotice />
    <ConfirmHost />
  </Suspense>
);
