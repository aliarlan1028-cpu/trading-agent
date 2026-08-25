import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { getLang, setLang, t } from "./i18n.js";
import {
  Activity,
  Bell,
  ChevronRight,
  RefreshCw,
  Target,
  Globe,
  Zap
} from "lucide-react";
import { automationPresentation, exchangeState, isNativeApp, localizeText, useApi } from "./lib.jsx";
import { AssistantWidget } from "./assistant.jsx";
import { AppFrame } from "./appFrame.jsx";
import { LandingPage } from "./landing.jsx";
import { uiConfirm } from "./confirm.jsx";
import { resolveDesktopRoute } from "./productArchitecture.js";
import { CommandRail, ContextDock, TraceRail, WorkspaceRail, WorkspaceStateBoundary, buildShellContext, buildShellTrace, resolveShellObjectSelection, selectionForNavigation } from "./productShell.jsx";
import { SafeArea } from "@capacitor-community/safe-area";
import "./styles.css";
import "./product-foundation.css";

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

function BrandLogo({ size = 34, variant = "black" }) {
  const src = variant === "white" ? "/kordyn-logo-white.svg" : "/kordyn-logo.svg";
  return <img className="brandLogo" src={src} alt="KORDYN" width={size} height={size} />;
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

function AppTopbar({ data, setActive, onObjectSelect, notify, action, lang, switchLang }) {
  const [killConfirm, setKillConfirm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [runtimeOpen, setRuntimeOpen] = useState(false);
  const accounts = data.exchangeAccounts || [];
  const okx = accounts.find((item) => item.exchange === "OKX") || {};
  const unread = (data.notifications || []).filter((item) => !item.read).length;
  const runtime = automationPresentation(data);
  const stopped = data.system?.killSwitch === true;
  const displayUserName = localizeText(data.user?.name || t("账户", "Account"));
  const flattenAll = async () => {
    if (await uiConfirm(t("确认按市价平掉全部持仓？提交后系统会暂停新开仓，直到 OKX 对账确认全部处置完成。", "Close every position at market? New entries will pause until OKX reconciliation confirms completion."), { danger: true, title: t("全部平仓", "Flatten all positions") })) {
      action("/api/risk/emergency-flatten", {});
    }
  };
  return (
    <header className="appTopbar" data-shell-role="desktop-command">
      <CommandRail data={data} onNavigate={setActive} onSelect={onObjectSelect} />
      <div className="topbarStatusGroup">
        <ExchangePill name="OKX" tone="okx" account={okx} onClick={() => setActive("systemSettings:exchange")} />
        <button type="button" className={`runtimeStatePill ${runtime.tone}`} onClick={()=>setRuntimeOpen((open)=>!open)} title={runtime.detail} aria-expanded={runtimeOpen} aria-haspopup="dialog">
          <span />
          <div><small>{t("执行方式", "MODE")}</small><b>{runtime.targetLabel}</b></div>
          <i />
          <div><small>{t("当前状态", "NOW")}</small><b>{runtime.label}</b></div>
        </button>
        {runtimeOpen && <>
          <div className="runtimeStatusBackdrop" onClick={()=>setRuntimeOpen(false)} />
          <section className="runtimeStatusPopover" role="dialog" aria-label={t("当前运行状态", "Current runtime status")}>
            <header>
              <div><small>{t("当前实际状态", "EFFECTIVE NOW")}</small><b>{runtime.label}</b></div>
              <span className={`runtimeStatusTone ${runtime.tone}`}>{runtime.entryPolicy}</span>
            </header>
            <p>{runtime.detail}</p>
            <div className="runtimeStatusTarget"><span>{t("安全条件解除后的长期目标", "Saved target after safety causes clear")}</span><b>{runtime.targetLabel}</b></div>
            <div className={`runtimeReduceSummary ${runtime.runtimeStatus}`}>
              <RefreshCw />
              <span><b>{runtime.recoveryLabel}</b><small>{runtime.primaryBlocker || t("当前没有阻止新开仓的系统原因。", "No system reason is blocking new entries.")}</small></span>
            </div>
            {runtime.blockerDetails.length > 0 && <div className="runtimeStatusReasons"><small>{t("当前限制原因与恢复方式", "BLOCKERS & RECOVERY")}</small><div>{runtime.blockerDetails.map((item, index)=><article key={item.code || `${item.label}-${index}`}><b>{localizeText(item.label || item)}</b>{item.detail && <p>{localizeText(item.detail)}</p>}{item.recovery && <small><RefreshCw/>{localizeText(item.recovery)}</small>}</article>)}</div></div>}
            <button type="button" className="runtimeStatusLink" onClick={()=>{setRuntimeOpen(false);setActive("riskMandate");}}>{t("查看长期执行目标与权限", "View saved execution target and permissions")}<ChevronRight size={14}/></button>
          </section>
        </>}
      </div>
      <div className="topEmergencyActions" aria-label={t("运行控制", "Runtime controls")}>
        <button type="button" className="danger" onClick={flattenAll} title={t("按市价关闭全部持仓", "Close all positions at market")}><Target/><span>{t("全部平仓", "Flatten")}</span></button>
        <button type="button" className={`danger ${stopped ? "active" : ""}`} onClick={() => setKillConfirm(true)} title={stopped?t("申请解除紧急停止", "Request clearing the emergency stop"):t("立即阻止所有新交易", "Immediately block all new trades")}><Zap/><span>{stopped?t("解除停止", "Clear stop"):t("紧急停止", "Stop")}</span></button>
      </div>
      <div className="topbarActions">
        <button className="bellButton" title={t("通知", "Notifications")} aria-label={t("通知", "Notifications")} onClick={() => { setActive("operationsCenter:notifications"); if (unread) action("/api/notifications/read", {}); }}>
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
      {killConfirm && <KillConfirmDialog enable={!stopped} action={action} onClose={() => setKillConfirm(false)} />}
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
  const [mfaPassword, setMfaPassword] = useState("");
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
    if (!mfaPassword) return notify(t("请输入当前登录密码后再配置双因素认证", "Enter your current password before setting up 2FA"));
    const result = await action("/api/account/mfa/enroll", { currentPassword: mfaPassword });
    if (result?.secret) { setMfaEnrollment(result); setMfaCode(""); }
  }

  async function confirmMfa() {
    const result = await action("/api/account/mfa/confirm", { code: mfaCode, currentPassword: mfaPassword });
    if (result?.ok) { notify(t("双因素认证已启用，其他登录已退出", "Two-factor authentication enabled; other sessions were signed out")); setMfaEnrollment(null); setMfaCode(""); setMfaPassword(""); }
  }

  async function disableMfa() {
    const result = await action("/api/account/mfa", { code: mfaCode, currentPassword: mfaPassword }, "DELETE");
    if (result?.ok) { notify(t("双因素认证已停用，其他登录已退出", "Two-factor authentication disabled; other sessions were signed out")); setMfaCode(""); setMfaPassword(""); }
  }

  return (
    <div className="modalOverlay" onClick={onClose}>
      <div className="modalCard" role="dialog" aria-modal="true" aria-label={t("账户设置", "Account Settings")} onClick={(event) => event.stopPropagation()}>
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
          <label>{t("当前登录密码", "Current password")}<input type="password" autoComplete="current-password" value={mfaPassword} onChange={(event) => setMfaPassword(event.target.value)} /></label>
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
  const [activeProductWorkspace, setActiveProductWorkspace] = useState("ai");
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("dialog");
  const [activeReviewId, setActiveReviewId] = useState("");
  const [activeStrategyTab, setActiveStrategyTab] = useState("catalog");
  const [activeSettingsTab, setActiveSettingsTab] = useState("overview");
  const [activeSettingsSection, setActiveSettingsSection] = useState("environment");
  const [panel, setPanel] = useState("");
  const [selectedShellObject, setSelectedShellObject] = useState(null);
  const isMobileViewport = useIsMobileViewport();
  const { data, loading, action, toast, authRequired, login, registerAccount, notify, download, refresh, ensureSection, apiBase, setApiBase, connectionError, busy, isNativeApp, publicInfo } = useApi();
  useEffect(() => {
    if (data) ensureSection(active);
  }, [active, Boolean(data)]);
  useEffect(() => {
    setSelectedShellObject((current) => selectionForNavigation(current, activeProductWorkspace, data || {}));
  }, [data, activeProductWorkspace]);
  function navigate(next, selectedObject) {
    const resolved = resolveDesktopRoute(next);
    setSelectedShellObject((current) => selectionForNavigation(selectedObject ?? current, resolved.workspace, data || {}));
    setActiveProductWorkspace(resolved.workspace);
    setActive(resolved.section);
    if (resolved.tab) setActiveWorkspaceTab(resolved.tab);
    if (resolved.strategyTab) setActiveStrategyTab(resolved.strategyTab);
    if (resolved.objectId) setActiveReviewId(resolved.objectId);
    else if (resolved.tab !== "reviews") setActiveReviewId("");
    if (resolved.settingsTab) setActiveSettingsTab(resolved.settingsTab);
    else if (resolved.section === "systemSettings" && resolved.view === "overview") setActiveSettingsTab("overview");
    if (resolved.settingsSection) setActiveSettingsSection(resolved.settingsSection);
    if (!resolved.recognized) notify(t("未找到该入口，已返回 AI 交易员。", "That destination was not found. Returned to AI Trader."));
  }
  function selectObject(candidate) {
    const selected = resolveShellObjectSelection(data || {}, candidate);
    if (selected) setSelectedShellObject(selected);
    return selected;
  }
  const ui = { setActive: navigate, selectObject, notify, download, refresh, ensureSection, openPanel: setPanel, closePanel: () => setPanel("") };
  const content = useMemo(() => {
    if (!data) return null;
    const resourceState = data.resourceState?.[active] || "not_loaded";
    if (resourceState !== "loaded") return <WorkspaceStateBoundary resourceState={resourceState} onRetry={() => ensureSection(active, { force: true })} />;
    if (active === "chat") return <AiTraderCenter key={`chat:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "cockpit") return <TradingCenter key={`cockpit:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "researchCenter") return <ResearchCenter key={`research:${activeWorkspaceTab}:${activeStrategyTab}:${activeReviewId}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} strategyInitialTab={activeStrategyTab} reviewInitialId={activeReviewId} />;
    if (active === "riskCenter") return <RiskCenter key={`risk:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "operationsCenter") return <OperationsCenter key={`operations:${activeWorkspaceTab}`} data={data} action={action} ui={ui} initialTab={activeWorkspaceTab} />;
    if (active === "systemSettings") return <SettingsConcept key={`settings:${activeSettingsTab}:${activeSettingsSection}`} data={data} action={action} ui={ui} activeTab={activeSettingsTab} initialBaseSection={activeSettingsSection} onTabChange={setActiveSettingsTab} />;
    return <AiTraderCenter data={data} action={action} ui={ui} />;
  }, [active, activeSettingsTab, activeSettingsSection, activeWorkspaceTab, activeStrategyTab, activeReviewId, data, action, lang]);
  const shellContext = useMemo(() => buildShellContext({ data: data || {}, workspaceId: activeProductWorkspace, selectedObject: selectedShellObject }), [data, activeProductWorkspace, selectedShellObject]);
  const shellTrace = useMemo(() => buildShellTrace(data || {}, activeProductWorkspace, selectedShellObject), [data, activeProductWorkspace, selectedShellObject]);

  if (authRequired) return <AppFrame><LandingPage login={login} registerAccount={registerAccount} toast={toast} apiBase={apiBase} setApiBase={setApiBase} isNativeApp={isNativeApp} publicInfo={publicInfo} /></AppFrame>;
  if (!loading && !data) return <AppFrame><ConnectionScreen apiBase={apiBase} setApiBase={setApiBase} refresh={refresh} toast={toast} connectionError={connectionError} isNativeApp={isNativeApp} /></AppFrame>;
  if (loading || !data) return <AppFrame><div className="loading"><Activity size={28} /> {t("正在启动 Trader Agent...", "Starting Trader Agent...")}</div></AppFrame>;

  if (isNativeApp || isMobileViewport) {
    // key={lang}:切换语言时整树 remount,让 mobile.jsx 里的 t() 立即全量重渲染(同桌面外壳)。
    return <AppFrame authenticated><MobileApp key={lang} lang={lang} switchLang={switchLang} api={{ data, action, toast, busy, notify, download, refresh, ensureSection, connectionError }} /></AppFrame>;
  }

  return (
    <AppFrame authenticated><div className="appShell kordynSystem" key={lang} data-shell-selected-object={selectedShellObject?.id || "none"} data-shell-selected-type={selectedShellObject?.type || "none"}>
      <AppTopbar data={data} setActive={navigate} onObjectSelect={setSelectedShellObject} notify={notify} action={action} lang={lang} switchLang={switchLang} />
      <WorkspaceRail activeWorkspace={activeProductWorkspace} onNavigate={navigate} />
      <main className="mainArea">
        {/* 页面级独立 Suspense：切换懒加载页时只在内容区显骨架，不再冒泡到根 Suspense 把整站(含侧栏)闪白 */}
        <div className={active === "chat" ? "content contentChat" : "content"}>
          <Suspense fallback={<PageSkeleton />}>{content}</Suspense>
        </div>
      </main>
      <ContextDock context={shellContext} onNavigate={navigate} />
      <TraceRail stages={shellTrace} />
      {panel && <ConfigPanel panel={panel} data={data} action={action} ui={ui} />}
      {busy && <div className="busyIndicator"><Activity size={13} /> {t("执行中", "Working")}</div>}
      <AssistantWidget data={data} ui={ui} currentPage={`${active}:${active === "systemSettings" ? activeSettingsTab : activeWorkspaceTab}`} />
      {toast && <div className="toast">{toast}</div>}
    </div></AppFrame>
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

const root = (window.__traderAgentRoot ||= createRoot(document.getElementById("root")));
root.render(
  <Suspense fallback={<div className="loading"><Activity size={28} /> {t("正在加载交易模块...", "Loading trading modules...")}</div>}>
    <App />
  </Suspense>
);
