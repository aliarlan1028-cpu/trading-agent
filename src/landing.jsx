import React, { useEffect, useState } from "react";
import { TurnstileWidget } from "./lib.jsx";
import { t } from "./i18n.js";

export function NativeAuthPage({ login, registerAccount, toast, apiBase, setApiBase, publicInfo }) {
  const plans = publicInfo?.subscriptionPlans || [];
  const [mode, setMode] = useState("login");
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id || "");
  const [serverUrl, setServerUrl] = useState(apiBase || "https://yegidawir.xyz");
  const [loginForm, setLoginForm] = useState({ email: "", password: "", totp: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", inviteCode: "", acceptTerms: false, acceptPrivacy: false, acknowledgeRisk: false, turnstileToken: "" });
  const [application, setApplication] = useState(null);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) || plans[0];

  useEffect(() => { if (!selectedPlanId && plans[0]?.id) setSelectedPlanId(plans[0].id); }, [plans, selectedPlanId]);
  useEffect(() => { setServerUrl(apiBase || "https://yegidawir.xyz"); }, [apiBase]);

  async function submitLogin(event) {
    event.preventDefault();
    await login({ email: loginForm.email.trim(), password: loginForm.password, totp: loginForm.totp });
  }

  async function submitRegister(event) {
    event.preventDefault();
    const result = await registerAccount({ ...registerForm, planId: selectedPlan?.id });
    if (result?.application) setApplication(result.application);
  }

  return (
    <main className="nativeAuthScreen">
      <section className="nativeAuthCard" aria-label={t("登录或订阅 KORDYN", "Sign in or subscribe to KORDYN")}>
        <header className="nativeAuthBrand">
          <img src="/kordyn-logo.svg" alt="KORDYN" />
          <div><strong>KORDYN</strong><span>{t("AI 数字资产交易员", "AI digital asset trader")}</span></div>
        </header>

        <div className="nativeAuthTabs" role="tablist" aria-label={t("账户入口", "Account access")}>
          <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>{t("登录", "Sign in")}</button>
          <button type="button" role="tab" aria-selected={mode === "subscribe"} className={mode === "subscribe" ? "on" : ""} onClick={() => setMode("subscribe")}>{t("订阅", "Subscribe")}</button>
        </div>

        {mode === "login" ? (
          <form className="nativeAuthForm" onSubmit={submitLogin}>
            <div className="nativeAuthIntro"><strong>{t("欢迎回来", "Welcome back")}</strong><span>{t("登录后进入交易控制台", "Sign in to open your trading console")}</span></div>
            <label><span>{t("邮箱", "Email")}</span><input type="email" autoComplete="email" value={loginForm.email} onChange={(event) => setLoginForm({ ...loginForm, email: event.target.value })} placeholder="you@example.com" autoFocus /></label>
            <label><span>{t("密码", "Password")}</span><input type="password" autoComplete="current-password" value={loginForm.password} onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })} placeholder={t("登录密码", "Password")} /></label>
            <label><span>{t("动态验证码", "Authenticator code")} <em>{t("可选", "Optional")}</em></span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={loginForm.totp} onChange={(event) => setLoginForm({ ...loginForm, totp: event.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder={t("启用双重验证后填写", "Enter if two-factor authentication is enabled")} /></label>
            <button className="nativeAuthPrimary" type="submit">{t("登录", "Sign in")}</button>
            <button className="nativeAuthTextButton" type="button" onClick={() => setMode("subscribe")}>{t("还没有订阅？查看订阅方案", "No subscription yet? View plans")}</button>
          </form>
        ) : (
          <form className="nativeAuthForm nativeAuthForm--subscribe" onSubmit={submitRegister}>
            <div className="nativeAuthIntro"><strong>{t("选择订阅", "Choose a subscription")}</strong><span>{t("提交后等待账号开通", "Submit your details to request access")}</span></div>
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
            <button className="nativeAuthPrimary" type="submit" disabled={!publicInfo?.registrationEnabled || (publicInfo?.captchaRequired && !registerForm.turnstileToken)}>{t("提交订阅申请", "Submit subscription request")}</button>
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

  async function submitLogin(e) { e.preventDefault(); await login({ email: loginForm.email.trim(), password: loginForm.password, totp: loginForm.totp }); }
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
                <input className="lpInput" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={loginForm.totp} onChange={(e) => setLoginForm({ ...loginForm, totp: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="Authenticator code (if enabled)" />
                <button className="lpBtn" type="submit">Enter the cockpit →</button>
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
