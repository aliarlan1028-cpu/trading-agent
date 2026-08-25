import { useEffect, useState } from "react";
import { BookOpen, Bot, Eye, EyeOff, Layers3, ShieldCheck, WalletCards, Wrench } from "lucide-react";
import { TurnstileWidget } from "./lib.jsx";
import { t } from "./i18n.js";
import { connectionSecurityStatus } from "./connectionSecurity.js";

function AuthSystemMap() {
  const nodes = [
    { id: "account", label: t("账户事实", "Account truth"), icon: WalletCards },
    { id: "strategy", label: t("策略", "Strategy"), icon: Layers3 },
    { id: "knowledge", label: t("知识", "Knowledge"), icon: BookOpen },
    { id: "capability", label: t("能力", "Capability"), icon: Wrench },
    { id: "guard", label: t("风险边界", "Risk boundaries"), icon: ShieldCheck }
  ];
  return <aside className="nativeAuthStory">
    <header className="nativeAuthBrand"><img src="/kordyn-logo.svg" alt="KORDYN"/><div><strong>KORDYN</strong><span>WEB3 AI TRADING SYSTEM</span></div></header>
    <div className="nativeAuthStoryCopy"><small>PRIVATE OPERATING NETWORK</small><h1>{t("让 AI 交易员在你的事实与边界内工作。", "Put the AI trader to work inside your facts and boundaries.")}</h1><p>{t("账户、策略、知识和能力共同进入决策上下文；风险边界保留最终控制权。", "Account truth, strategy, knowledge, and capability form the decision context. Risk boundaries retain final control.")}</p></div>
    <div className="nativeAuthNetwork" aria-label={t("KORDYN 系统关系", "KORDYN system relationships")}>
      <div className="nativeAuthNetworkCore"><Bot/><small>PRIMARY</small><b>{t("AI 交易员", "AI Trader")}</b></div>
      {nodes.map(({ id, label, icon: Icon }) => <div className={`nativeAuthNetworkNode nativeAuthNetworkNode--${id}`} key={id}><Icon/><span>{label}</span></div>)}
    </div>
    <footer><ShieldCheck/><span>{t("真实数据 · 明确授权 · 可追踪动作", "Real data · explicit authority · traceable actions")}</span></footer>
  </aside>;
}

export function NativeAuthPage({ login, registerAccount, toast, apiBase, setApiBase, publicInfo }) {
  const plans = publicInfo?.subscriptionPlans || [];
  const [mode, setMode] = useState("login");
  const [showPassword, setShowPassword] = useState(false);
  const [showTotp, setShowTotp] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id || "");
  const [serverUrl, setServerUrl] = useState(apiBase || "https://yegidawir.xyz");
  const [loginForm, setLoginForm] = useState({ email: "", password: "", totp: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", inviteCode: "", acceptTerms: false, acceptPrivacy: false, acknowledgeRisk: false, turnstileToken: "" });
  const [application, setApplication] = useState(null);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) || plans[0];
  const transport = connectionSecurityStatus(apiBase, { production: import.meta.env?.PROD, allowLocalDevelopment: import.meta.env?.DEV });

  useEffect(() => { if (!selectedPlanId && plans[0]?.id) setSelectedPlanId(plans[0].id); }, [plans, selectedPlanId]);
  useEffect(() => { setServerUrl(apiBase || "https://yegidawir.xyz"); }, [apiBase]);

  async function submitLogin(event) {
    event.preventDefault();
    const result = await login({ email: loginForm.email.trim(), password: loginForm.password, totp: loginForm.totp });
    if (result?.mfaRequired) setShowTotp(true);
  }

  async function submitRegister(event) {
    event.preventDefault();
    const result = await registerAccount({ ...registerForm, planId: selectedPlan?.id });
    if (result?.application) setApplication(result.application);
  }

  return (
    <main className={`nativeAuthScreen nativeAuthScreen--${mode}`}>
      <section className="nativeAuthPortal">
        <AuthSystemMap />
        <section className="nativeAuthCard" aria-label={t("登录或注册 KORDYN", "Sign in or sign up for KORDYN")}>
        <header className="nativeAuthCardHead"><span><small>SECURE ACCESS</small><b>{t("进入你的私有系统", "Enter your private system")}</b></span><i className={transport.secure ? "secure" : "insecure"}>{transport.secure ? "HTTPS" : "HTTP"}</i></header>
        <nav className="nativeAuthModeTabs" aria-label={t("登录或注册", "Log in or sign up")}><button type="button" className={mode === "login" ? "on" : ""} aria-current={mode === "login" ? "page" : undefined} onClick={() => setMode("login")}>{t("登录", "Log in")}</button><button type="button" className={mode === "subscribe" ? "on" : ""} aria-current={mode === "subscribe" ? "page" : undefined} onClick={() => setMode("subscribe")}>{t("注册", "Sign up")}</button></nav>

        {mode === "login" ? (
          <form className="nativeAuthForm" onSubmit={submitLogin}>
            <div className="nativeAuthIntro"><strong>{t("欢迎回到 KORDYN", "Welcome back to KORDYN")}</strong><span>{t("登录，继续你的交易任务", "Sign in to continue your trading mission")}</span></div>
            <label><span>{t("邮箱", "E-mail")}</span><input type="email" autoComplete="email" value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} placeholder="you@example.com" autoFocus /></label>
            <label><span>{t("密码", "Password")}</span><span className="nativeAuthPassword"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} placeholder={t("输入登录密码", "Enter your password")} /><button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? t("隐藏密码", "Hide password") : t("显示密码", "Show password")}>{showPassword ? <EyeOff size={19} /> : <Eye size={19} />}</button></span></label>
            {showTotp && <label className="nativeAuthTotp"><span>{t("动态验证码", "Authenticator code")}</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={loginForm.totp} onChange={(event) => setLoginForm({ ...loginForm, totp: event.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder={t("输入 6 位验证码", "Enter the 6-digit code")} /></label>}
            <div className="nativeAuthFormTools"><span><ShieldCheck size={14} />{transport.secure ? t("HTTPS 加密会话", "HTTPS encrypted session") : t("不安全连接", "Insecure connection")}</span><button type="button" onClick={() => setShowTotp((current) => !current)}>{showTotp ? t("收起 2FA", "Hide 2FA") : t("使用 2FA", "Use 2FA")}</button></div>
            <button className="nativeAuthPrimary" type="submit"><span>{t("登录", "Log in")}</span><b aria-hidden="true">→</b></button>
          </form>
        ) : (
          <form className="nativeAuthForm nativeAuthForm--subscribe" onSubmit={submitRegister}>
            <div className="nativeAuthIntro"><strong>{t("创建你的 KORDYN 访问权限", "Create your KORDYN access")}</strong><span>{t("选择订阅方案并提交开通申请", "Choose a plan and submit your access request")}</span></div>
            <div className="nativePlanList">
              {plans.map((plan) => (
                <button type="button" className={selectedPlan?.id === plan.id ? "on" : ""} key={plan.id} onClick={() => setSelectedPlanId(plan.id)}>
                  <span><strong>{plan.name}</strong><small>{plan.months || 1} {t("个月", "months")}</small></span>
                  <b>{plan.priceUsdt} USDT</b>
                </button>
              ))}
              {!plans.length && <p className="nativeAuthNotice">{t("当前暂无可订阅方案，请联系管理员。", "No plans are currently available. Contact the administrator.")}</p>}
            </div>
            <label><span>{t("姓名", "Name")}</span><input autoComplete="name" value={registerForm.name} onChange={(event) => setRegisterForm({ ...registerForm, name: event.target.value })} placeholder={t("你的名字", "Your name")} /></label>
            <label><span>{t("邮箱", "Email")}</span><input type="email" autoComplete="email" value={registerForm.email} onChange={(event) => setRegisterForm({ ...registerForm, email: event.target.value })} placeholder="you@example.com" /></label>
            {publicInfo?.inviteRequired && <label><span>{t("邀请码", "Invite code")}</span><input value={registerForm.inviteCode} onChange={(event) => setRegisterForm({ ...registerForm, inviteCode: event.target.value })} placeholder="INV-..." /></label>}
            <div className="nativeConsentList">
              <label><input type="checkbox" checked={registerForm.acceptTerms} onChange={(event) => setRegisterForm({ ...registerForm, acceptTerms: event.target.checked })} /><span>{t("我同意", "I accept the ")}<a href={publicInfo?.termsUrl || "#"} target="_blank" rel="noreferrer">{t("服务条款", "Terms of Service")}</a></span></label>
              <label><input type="checkbox" checked={registerForm.acceptPrivacy} onChange={(event) => setRegisterForm({ ...registerForm, acceptPrivacy: event.target.checked })} /><span>{t("我同意", "I accept the ")}<a href={publicInfo?.privacyUrl || "#"} target="_blank" rel="noreferrer">{t("隐私政策", "Privacy Policy")}</a></span></label>
              <label><input type="checkbox" checked={registerForm.acknowledgeRisk} onChange={(event) => setRegisterForm({ ...registerForm, acknowledgeRisk: event.target.checked })} /><span>{t("我理解数字资产交易可能损失全部本金", "I understand digital asset trading can result in total loss")}</span></label>
            </div>
            <TurnstileWidget siteKey={publicInfo?.turnstileSiteKey} onToken={(turnstileToken) => setRegisterForm((current) => ({ ...current, turnstileToken }))} />
            <button className="nativeAuthPrimary" type="submit" disabled={!publicInfo?.registrationEnabled || (publicInfo?.captchaRequired && !registerForm.turnstileToken)}><span>{t("提交注册申请", "Submit sign-up request")}</span><b aria-hidden="true">→</b></button>
            {!publicInfo?.registrationEnabled && <p className="nativeAuthNotice">{t("当前未开放线上申请，请联系管理员。", "Online requests are currently closed. Contact the administrator.")}</p>}
            {application && <div className="nativeAuthSuccess"><strong>{t("申请已提交", "Request submitted")}</strong><span>{application.id}</span><small>{t("请查收邮件或等待审核。", "Check your email or wait for review.")}</small></div>}
          </form>
        )}

        <details className="nativeServerSettings">
          <summary>{t("服务器设置", "Server settings")}</summary>
          <label><span>{t("后端地址", "Server URL")}</span><input inputMode="url" value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} onBlur={() => setApiBase(serverUrl)} placeholder="https://yegidawir.xyz" /></label>
        </details>
        {toast && <p className="nativeAuthToast" role="status">{toast}</p>}
        </section>
      </section>
    </main>
  );
}

// 营销落地页:用 iframe 渲染 public/landing.html(样式完全隔离,不与 app CSS 冲突)。
// 营销页里的「Start Trading」通过 postMessage({type:"lp-start"}) 通知这里,弹出真实登录/订阅弹窗。
export function LandingPage(props) {
  if (props.isNativeApp) return <NativeAuthPage {...props} />;
  return <WebLandingPage {...props} />;
}

function WebLandingPage({ login, registerAccount, toast, apiBase, setApiBase, isNativeApp, publicInfo }) {
  const plans = publicInfo?.subscriptionPlans || [];
  const [authOpen, setAuthOpen] = useState(false);
  const [mode, setMode] = useState("login");
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id || "");
  const [loginForm, setLoginForm] = useState({ email: "", password: "", totp: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", inviteCode: "", acceptTerms: false, acceptPrivacy: false, acknowledgeRisk: false, turnstileToken: "" });
  const [application, setApplication] = useState(null);
  const [mfaStep, setMfaStep] = useState(false);
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) || plans[0];
  // 套餐名在 DB 里是中文(月度订阅…),英文站按 interval/months 派生英文名,不改生产配置。
  const planLabel = (p) => {
    const byInterval = { month: "Monthly", quarter: "Quarterly", half_year: "Semi-annual", year: "Annual" };
    if (p?.interval && byInterval[p.interval]) return byInterval[p.interval];
    const m = Number(p?.months || 1);
    return m >= 12 ? "Annual" : m >= 6 ? "Semi-annual" : m >= 3 ? "Quarterly" : "Monthly";
  };

  useEffect(() => {
    const onMsg = (e) => { if (e.data && e.data.type === "lp-start") { setMode(e.data.mode === "subscribe" ? "subscribe" : "login"); setAuthOpen(true); } };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  useEffect(() => { if (!selectedPlanId && plans[0]?.id) setSelectedPlanId(plans[0].id); }, [plans, selectedPlanId]);

  async function submitLogin(e) {
    e.preventDefault();
    const result = await login({ email: loginForm.email.trim(), password: loginForm.password, totp: loginForm.totp });
    if (result?.mfaRequired) setMfaStep(true);
  }
  async function submitRegister(e) { e.preventDefault(); const r = await registerAccount({ ...registerForm, planId: selectedPlan?.id }); if (r?.application) setApplication(r.application); }

  return (
    <div className="lpRoot">
      <iframe className="lpFrame" src="/landing.html" title="KORDYN" />
      {authOpen && (
        <div className="lpOverlay" onClick={(e) => { if (e.target.classList.contains("lpOverlay")) setAuthOpen(false); }}>
          <div className="lpModal">
            <button className="lpX" onClick={() => setAuthOpen(false)} aria-label="close">×</button>
            <h3>{mode === "login" ? "Start Trading" : "Subscribe"}</h3>
            <p className="lpMsub">{mode === "login" ? "Sign in to open the cockpit." : "Apply for an isolated KORDYN instance. No account is created inside the owner workspace."}</p>
            <div className="lpTabs">
              <button className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>Log in</button>
              <button className={mode === "subscribe" ? "on" : ""} onClick={() => setMode("subscribe")}>Subscribe</button>
            </div>
            {isNativeApp && <input className="lpInput" value={apiBase || ""} onChange={(e) => setApiBase(e.target.value)} placeholder="Backend URL" />}
            {mode === "login" ? (
              <form onSubmit={submitLogin}>
                <input className="lpInput" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} placeholder="you@example.com" autoFocus />
                <input className="lpInput" type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} placeholder="Password" />
                {mfaStep && <input className="lpInput" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={loginForm.totp} onChange={(e) => setLoginForm({ ...loginForm, totp: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="Six-digit authenticator code" autoFocus />}
                <button className="lpBtn" type="submit">{mfaStep ? "Verify and continue →" : "Enter the cockpit →"}</button>
              </form>
            ) : (
              <form onSubmit={submitRegister}>
                {plans.length > 0 && (
                  <div className="lpPlans">{plans.map((p) => (
                    <button type="button" key={p.id} className={selectedPlanId === p.id ? "on" : ""} onClick={() => setSelectedPlanId(p.id)}>
                      <b>{planLabel(p)}</b><span>{p.priceUsdt} USDT · {p.months || 1}mo</span>
                    </button>
                  ))}</div>
                )}
                <input className="lpInput" value={registerForm.name} onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })} placeholder="Your name" />
                <input className="lpInput" value={registerForm.email} onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })} placeholder="you@example.com" />
                {publicInfo?.inviteRequired && <input className="lpInput" value={registerForm.inviteCode} onChange={(e) => setRegisterForm({ ...registerForm, inviteCode: e.target.value })} placeholder="Invite code" />}
                <label className="lpConsent"><input type="checkbox" checked={registerForm.acceptTerms} onChange={(e) => setRegisterForm({ ...registerForm, acceptTerms: e.target.checked })} /><span>I accept the <a href={publicInfo?.termsUrl || "#"} target="_blank" rel="noreferrer">Terms of Service</a> (v{publicInfo?.termsVersion || "current"}).</span></label>
                <label className="lpConsent"><input type="checkbox" checked={registerForm.acceptPrivacy} onChange={(e) => setRegisterForm({ ...registerForm, acceptPrivacy: e.target.checked })} /><span>I accept the <a href={publicInfo?.privacyUrl || "#"} target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>
                <label className="lpConsent"><input type="checkbox" checked={registerForm.acknowledgeRisk} onChange={(e) => setRegisterForm({ ...registerForm, acknowledgeRisk: e.target.checked })} /> I understand crypto trading can result in total loss.</label>
                <TurnstileWidget siteKey={publicInfo?.turnstileSiteKey} onToken={(turnstileToken) => setRegisterForm((current) => ({ ...current, turnstileToken }))} />
                <button className="lpBtn" type="submit" disabled={!publicInfo?.registrationEnabled || (publicInfo?.captchaRequired && !registerForm.turnstileToken)}>Submit onboarding application</button>
                {!publicInfo?.registrationEnabled && <small className="lpMhint">Applications are currently closed — contact us to be onboarded.</small>}
                {publicInfo?.registrationEnabled && !publicInfo?.capacity?.canProvision && <small className="lpMhint">Applications are open, but new instances are currently waitlisted for capacity.</small>}
                {application && <div className="lpPay"><strong>Application received</strong><span>{application.id}</span><small>Status: {application.status}. Check your email or wait for manual review.</small></div>}
              </form>
            )}
            {toast && <small className="lpToast">{toast}</small>}
          </div>
        </div>
      )}
    </div>
  );
}
