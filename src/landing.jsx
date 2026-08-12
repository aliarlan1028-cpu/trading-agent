import React, { useEffect, useState } from "react";
import { TurnstileWidget } from "./lib.jsx";

// 营销落地页:用 iframe 渲染 public/landing.html(样式完全隔离,不与 app CSS 冲突)。
// 营销页里的「Start Trading」通过 postMessage({type:"lp-start"}) 通知这里,弹出真实登录/订阅弹窗。
export function LandingPage({ login, registerAccount, toast, apiBase, setApiBase, isNativeApp, publicInfo }) {
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
