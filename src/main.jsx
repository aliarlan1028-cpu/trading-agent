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
  Globe,
  Shield,
  ShieldCheck,
  FlaskConical,
  UserPlus,
  WalletCards,
  Send,
  Zap
} from "lucide-react";
import { displayMoney, exchangeState, localizeText, systemStatus, TurnstileWidget, useApi } from "./lib.jsx";
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

function BrandLogo({ size = 34, variant = "black" }) {
  const src = variant === "white" ? "/kordyn-logo-white.svg" : "/kordyn-logo.svg";
  return <img className="brandLogo" src={src} alt="KORDYN" width={size} height={size} />;
}

function Sidebar({ active, setActive }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brandMark"><BrandLogo size={32} /></div>
        <div className="brandText">
          <strong>KORDYN</strong>
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

function AppTopbar({ data, setActive, notify, action, lang, switchLang }) {
  const [killConfirm, setKillConfirm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const accounts = data.exchangeAccounts || [];
  const okx = accounts.find((item) => item.exchange === "OKX") || {};
  const unread = (data.notifications || []).filter((item) => !item.read).length;
  const currentStatus = systemStatus(data);
  const operatingStage = data.readiness?.operatingStage;
  const live = data.system?.liveTradingEnabled;
  const displayUserName = localizeText(data.user?.name || t("账户", "Account"));
  // 用后端唯一真相 automationState.mode 判"全自动",别再自己拿 2 个开关猜(否则实盘写入没开/
  // 熔断/只减仓时照样喊 AUTO ON,与状态卡、AI 口径各说各话)。
  const autoOn = data.automationState?.mode === "full_auto_small";
  const autoRequested = data.automationState?.requestedMode === "full_auto";
  return (
    <header className="appTopbar">
      <div className="topSearch">
        <Search size={15} />
        <input placeholder={t("搜索市场、交易对、知识或功能", "Search markets, pairs, knowledge, or features")} aria-label={t("搜索", "Search")} />
      </div>
      <div className="topbarStatusGroup">
        <ExchangePill name="OKX" tone="okx" account={okx} onClick={() => setActive("systemSettings:exchange")} />
        {autoOn
          ? <span className="autoOnPill" title={t("自动执行已开启", "Automated execution is on")}><span className="autoDot" /> AUTO ON</span>
          : autoRequested
            ? <span className="livePill on" title={localizeText(data.automationState?.detail,t("自动交易已设置，但当前安全条件暂未满足","Automatic trading is configured but temporarily blocked by safety checks"))}>{t("自动交易暂缓","AUTO PAUSED")}</span>
          : live && <span className="livePill on" title={t("实盘交易已开启", "Live trading is enabled")}>{t("实盘交易", "LIVE")}</span>}
      </div>
      <div className="topbarActions">
        <button className={`autonomyPill ${currentStatus.tone}`} title={currentStatus.label} onClick={() => setActive("riskSettings")}>
          <span />
          {currentStatus.label}
        </button>
        <button className="killButton" title={t("紧急停止：立即阻止所有新交易", "Emergency stop: block all new trades immediately")} onClick={() => setKillConfirm(true)}>
          <Zap size={15} /> {t("紧急停止", "STOP")}
        </button>
        <button className="bellButton" title={t("通知", "Notifications")} aria-label={t("通知", "Notifications")} onClick={() => { setActive("auditSystem"); if (unread) action("/api/notifications/read", {}); }}>
          <Bell size={18} />
          {unread > 0 && <b>{unread}</b>}
        </button>
        <div className="topLang">
          <button className={`topLangBtn ${langOpen ? "on" : ""}`} title={t("切换语言 / Switch language", "切换语言 / Switch language")} aria-label={t("切换语言", "Switch language")} aria-haspopup="menu" aria-expanded={langOpen} onClick={() => setLangOpen((o) => !o)}>
            <Globe size={18} />
          </button>
          {langOpen && <>
            <div className="topLangBackdrop" onClick={() => setLangOpen(false)} />
            <div className="topLangMenu" role="menu">
              <button role="menuitemradio" aria-checked={lang === "zh"} className={lang === "zh" ? "on" : ""} onClick={() => { switchLang("zh"); setLangOpen(false); }}>中文{lang === "zh" && <span className="topLangCheck">✓</span>}</button>
              <button role="menuitemradio" aria-checked={lang === "en"} className={lang === "en" ? "on" : ""} onClick={() => { switchLang("en"); setLangOpen(false); }}>English{lang === "en" && <span className="topLangCheck">✓</span>}</button>
            </div>
          </>}
        </div>
        <button className="topAvatar" title={`${displayUserName} · ${t("账户设置", "Account settings")}`} onClick={() => setShowPassword(true)} aria-label={t("账户设置", "Account settings")}>
          {data.user?.avatar ? <img src={data.user.avatar} alt="" /> : displayUserName.slice(0, 1).toUpperCase()}
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
  const [mfaEnrollment, setMfaEnrollment] = useState(null);
  const [mfaCode, setMfaCode] = useState("");
  const fileRef = useRef(null);
  const profileDirty = name.trim() !== (user.name || "") || avatar !== (user.avatar || "");

  // 客户端压缩：任何尺寸图片 → 128×128 居中裁剪 → JPEG data URL，控制在几十 KB。
  function pickAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\//.test(file.type)) return notify(t("请选择图片文件", "Please choose an image file"));
    const reader = new FileReader();
    reader.onload = () => {
      const img = new globalThis.Image();
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
      img.onerror = () => notify(t("图片无法读取", "Unable to read this image"));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  async function saveProfile() {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 40) return notify(t("名称需 1–40 个字符", "Name must be 1–40 characters"));
    setSavingProfile(true);
    const result = await action("/api/account/profile", { name: trimmed, avatar }, "PATCH");
    setSavingProfile(false);
    if (result?.ok === true) notify(t("资料已更新", "Profile updated"));
  }

  async function changePassword() {
    if (newPassword.length < 10) return notify(t("新密码至少 10 位", "New password must be at least 10 characters"));
    if (newPassword !== confirm) return notify(t("两次输入的新密码不一致", "New passwords do not match"));
    const result = await action("/api/auth/change-password", { oldPassword, newPassword });
    if (result?.ok === true) { notify(t("密码已修改", "Password updated")); setOldPassword(""); setNewPassword(""); setConfirm(""); }
  }

  async function startMfaEnrollment() {
    const result = await action("/api/account/mfa/enroll", {});
    if (result?.secret) { setMfaEnrollment(result); setMfaCode(""); }
  }

  async function confirmMfa() {
    const result = await action("/api/account/mfa/confirm", { code: mfaCode });
    if (result?.ok) { notify(t("双因素认证已启用", "Two-factor authentication enabled")); setMfaEnrollment(null); setMfaCode(""); }
  }

  async function disableMfa() {
    const result = await action("/api/account/mfa", { code: mfaCode }, "DELETE");
    if (result?.ok) { notify(t("双因素认证已停用", "Two-factor authentication disabled")); setMfaCode(""); }
  }

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" onClick={(event) => event.stopPropagation()}>
        <h3>{t("账户设置", "Account Settings")}</h3>
        <div className="acctAvatarRow">
          <div className="acctAvatarPreview">{avatar ? <img src={avatar} alt={t("头像", "Avatar")} /> : (name || "A").slice(0, 1).toUpperCase()}</div>
          <div className="acctAvatarActions">
            <button type="button" className="secondaryButton" onClick={() => fileRef.current?.click()}>{t("上传头像", "Upload avatar")}</button>
            {avatar && <button type="button" className="linkButton" onClick={() => setAvatar("")}>{t("移除", "Remove")}</button>}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />
            <small>{t("自动压缩为 128×128", "Automatically resized to 128×128")}</small>
          </div>
        </div>
        <label>{t("显示名称", "Display name")}<input type="text" maxLength={40} value={name} placeholder={t("输入显示名称", "Enter a display name")} onChange={(event) => setName(event.target.value)} /></label>
        <div className="modalActions">
          <span className="modalHint">{user.email || ""}</span>
          <button className="primaryButton" disabled={!profileDirty || savingProfile} onClick={saveProfile}>{savingProfile ? t("保存中…", "Saving…") : t("保存资料", "Save profile")}</button>
        </div>
        {user.isOwner
          ? <p className="acctPwNote">{t("Owner 登录密码由服务端 ADMIN_PASSWORD 管理。如需修改，请前往“系统设置 > 安全”。", "The Owner password is managed by the server ADMIN_PASSWORD setting. To change it, go to System Settings > Security.")}</p>
          : <div className="acctPwBlock">
              <h4>{t("修改密码", "Change Password")}</h4>
              <label>{t("当前密码", "Current password")}<input type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} /></label>
              <label>{t("新密码（至少 10 位）", "New password (10+ characters)")}<input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
              <label>{t("确认新密码", "Confirm new password")}<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
              <div className="modalActions">
                <button className="secondaryButton" onClick={changePassword}>{t("修改密码", "Update password")}</button>
              </div>
            </div>}
        <div className="acctPwBlock">
          <h4>{t("双因素认证（TOTP）", "Two-Factor Authentication (TOTP)")}</h4>
          <p className="acctPwNote">{user.mfaEnabled ? t("已启用。登录时还需输入认证器生成的 6 位验证码。", "Enabled. Sign-in also requires a six-digit code from your authenticator.") : t("建议 Owner 启用。密钥加密保存在本机，不会发送给第三方。", "Recommended for the Owner account. The secret is encrypted locally and never sent to a third party.")}</p>
          {!user.mfaEnabled && !mfaEnrollment && <button className="secondaryButton" onClick={startMfaEnrollment}>{t("开始配置", "Set up 2FA")}</button>}
          {mfaEnrollment && <>
            <label>{t("认证器密钥", "Authenticator secret")}<input type="text" readOnly value={mfaEnrollment.secret} /></label>
            <small>{t("将密钥添加到 Google Authenticator、1Password 或其他 TOTP 认证器，再输入当前验证码。此密钥仅显示一次。", "Add this secret to Google Authenticator, 1Password, or another TOTP app, then enter the current code. The secret is shown only once.")}</small>
          </>}
          {(user.mfaEnabled || mfaEnrollment) && <label>{t("6 位动态验证码", "Six-digit verification code")}<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>}
          <div className="modalActions">
            {mfaEnrollment && <button className="primaryButton" disabled={mfaCode.length !== 6} onClick={confirmMfa}>{t("确认启用", "Enable 2FA")}</button>}
            {user.mfaEnabled && <button className="secondaryButton dangerText" disabled={mfaCode.length !== 6} onClick={disableMfa}>{t("验证并停用", "Verify and disable")}</button>}
          </div>
        </div>
        <div className="modalActions">
          <button className="secondaryButton" onClick={onClose}>{t("关闭", "Close")}</button>
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
    if (next === "riskMandate") { setActiveWorkspaceTab("mandate"); setActive("riskCenter"); return; }
    if (next === "operationsCenter") { setActiveWorkspaceTab("overview"); setActive("operationsCenter"); return; }
    if (next === "marketAccount" || next === "market") { setActiveWorkspaceTab("market"); setActive("cockpit"); return; }
    if (next === "signalHub") { setActiveWorkspaceTab("execution"); setActive("cockpit"); return; }
    if (next === "tradeJournal") { setActiveWorkspaceTab("execution"); setActive("cockpit"); return; }
    if (next === "tradeLedger") { setActiveWorkspaceTab("ledger"); setActive("cockpit"); return; }
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
    // key={lang}:切换语言时整树 remount,让 mobile.jsx 里的 t() 立即全量重渲染(同桌面外壳)。
    return <MobileApp key={lang} lang={lang} switchLang={switchLang} api={{ data, action, toast, busy, notify, download, refresh, connectionError }} />;
  }

  return (
    <div className="appShell" key={lang}>
      <Sidebar active={active} setActive={navigate} data={data} lang={lang} switchLang={switchLang} />
      <main className="mainArea">
        <AppTopbar data={data} setActive={navigate} notify={notify} action={action} lang={lang} switchLang={switchLang} />
        {/* 页面级独立 Suspense：切换懒加载页时只在内容区显骨架，不再冒泡到根 Suspense 把整站(含侧栏)闪白 */}
        <div className={active === "chat" ? "content contentChat" : "content"}>
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

function BackendField({ apiBase, setApiBase, isNativeApp }) {
  const [value, setValue] = useState(apiBase || "");
  if (!isNativeApp) return null;
  return (
    <label className="backendField">
      <span>{t("后端地址", "Server URL")}</span>
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => setApiBase(value)}
        placeholder={t("例如 https://yegidawir.xyz", "Example: https://yegidawir.xyz")}
        inputMode="url"
      />
    </label>
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

function LoginScreen({ login, registerAccount, toast, apiBase, setApiBase, isNativeApp, publicInfo }) {
  const plans = publicInfo?.subscriptionPlans || [];
  const defaultPlanId = plans[0]?.id || "";
  const [mode, setMode] = useState("login");
  const [selectedPlanId, setSelectedPlanId] = useState(defaultPlanId);
  const [loginForm, setLoginForm] = useState({ email: "", password: "", totp: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", inviteCode: "", acceptTerms: false, acceptPrivacy: false, acknowledgeRisk: false, turnstileToken: "" });
  const [application, setApplication] = useState(null);
  useEffect(() => {
    if (!selectedPlanId && defaultPlanId) setSelectedPlanId(defaultPlanId);
  }, [defaultPlanId, selectedPlanId]);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) || plans[0];
  async function submitLogin(event) {
    event.preventDefault();
    const email = loginForm.email.trim();
    await login({ email, password: loginForm.password, totp: loginForm.totp });
  }
  async function submitRegister(event) {
    event.preventDefault();
    const result = await registerAccount({ ...registerForm, planId: selectedPlan?.id });
    if (result?.application) setApplication(result.application);
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
        <span className="landingBrand"><span className="landingLogo"><BrandLogo size={24} variant={isNativeApp ? "black" : "white"} /></span><strong>KORDYN</strong><em>知识驱动的 AI 交易员</em></span>
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
              <label><span>动态验证码（启用后必填）</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={loginForm.totp} onChange={(event) => setLoginForm({ ...loginForm, totp: event.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="6 位验证码" /></label>
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
              {publicInfo?.inviteRequired && <label><span>邀请码</span><input value={registerForm.inviteCode} onChange={(event) => setRegisterForm({ ...registerForm, inviteCode: event.target.value })} placeholder="INV-..." /></label>}
              <label className="lpConsent"><input type="checkbox" checked={registerForm.acceptTerms} onChange={(event) => setRegisterForm({ ...registerForm, acceptTerms: event.target.checked })} /><span>我同意<a href={publicInfo?.termsUrl || "#"} target="_blank" rel="noreferrer">服务条款</a>（版本 {publicInfo?.termsVersion || "当前"}）</span></label>
              <label className="lpConsent"><input type="checkbox" checked={registerForm.acceptPrivacy} onChange={(event) => setRegisterForm({ ...registerForm, acceptPrivacy: event.target.checked })} /><span>我同意<a href={publicInfo?.privacyUrl || "#"} target="_blank" rel="noreferrer">隐私政策</a></span></label>
              <label className="lpConsent"><input type="checkbox" checked={registerForm.acknowledgeRisk} onChange={(event) => setRegisterForm({ ...registerForm, acknowledgeRisk: event.target.checked })} /><span>我理解加密货币交易可能损失全部本金</span></label>
              <TurnstileWidget siteKey={publicInfo?.turnstileSiteKey} onToken={(turnstileToken) => setRegisterForm((current) => ({ ...current, turnstileToken }))} />
              <button className="primaryButton" type="submit" disabled={!publicInfo?.registrationEnabled || (publicInfo?.captchaRequired && !registerForm.turnstileToken)}><UserPlus size={16} /> 提交独立实例开通申请</button>
              {!publicInfo?.registrationEnabled && <small>当前未开放客户实例申请，请联系 Owner。</small>}
              {publicInfo?.registrationEnabled && !publicInfo?.capacity?.canProvision && <small>申请入口开放，但当前容量已满，新申请将进入候补队列。</small>}
              {application && <div className="paymentBox"><strong>申请已收到</strong><span>{application.id}</span><small>状态：{application.status}。请查收验证邮件或等待人工审核；系统尚未创建交易账号。</small></div>}
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
  <Suspense fallback={<div className="loading"><Activity size={28} /> {t("正在加载交易模块...", "Loading trading modules...")}</div>}>
    <App />
    <ConfirmHost />
  </Suspense>
);
