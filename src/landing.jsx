import React, { useEffect, useState } from "react";

// 营销落地页:用 iframe 渲染 public/landing.html(样式完全隔离,不与 app CSS 冲突)。
// 营销页里的「Start Trading」通过 postMessage({type:"lp-start"}) 通知这里,弹出真实登录/订阅弹窗。
export function LandingPage({ login, registerAccount, toast, apiBase, setApiBase, isNativeApp, publicInfo }) {
  const plans = publicInfo?.subscriptionPlans || [];
  const [authOpen, setAuthOpen] = useState(false);
  const [mode, setMode] = useState("login");
  const [selectedPlanId, setSelectedPlanId] = useState(plans[0]?.id || "");
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", password: "" });
  const [payment, setPayment] = useState(null);
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) || plans[0];

  useEffect(() => {
    const onMsg = (e) => { if (e.data && e.data.type === "lp-start") { setMode("login"); setAuthOpen(true); } };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  useEffect(() => { if (!selectedPlanId && plans[0]?.id) setSelectedPlanId(plans[0].id); }, [plans, selectedPlanId]);

  async function submitLogin(e) { e.preventDefault(); await login({ email: loginForm.email.trim(), password: loginForm.password }); }
  async function submitRegister(e) { e.preventDefault(); const r = await registerAccount({ ...registerForm, planId: selectedPlan?.id }); if (r?.payment) setPayment(r.payment); }

  return (
    <div className="lpRoot">
      <iframe className="lpFrame" src="/landing.html" title="Trading Agent" />
      {authOpen && (
        <div className="lpOverlay" onClick={(e) => { if (e.target.classList.contains("lpOverlay")) setAuthOpen(false); }}>
          <div className="lpModal">
            <button className="lpX" onClick={() => setAuthOpen(false)} aria-label="close">×</button>
            <h3>{mode === "login" ? "Start Trading" : "Subscribe"}</h3>
            <p className="lpMsub">{mode === "login" ? "Sign in to open the cockpit." : "Create an account, then pay to activate."}</p>
            <div className="lpTabs">
              <button className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>Log in</button>
              <button className={mode === "subscribe" ? "on" : ""} onClick={() => setMode("subscribe")}>Subscribe</button>
            </div>
            {isNativeApp && <input className="lpInput" value={apiBase || ""} onChange={(e) => setApiBase(e.target.value)} placeholder="Backend URL" />}
            {mode === "login" ? (
              <form onSubmit={submitLogin}>
                <input className="lpInput" value={loginForm.email} onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })} placeholder="you@example.com" autoFocus />
                <input className="lpInput" type="password" value={loginForm.password} onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })} placeholder="Password" />
                <button className="lpBtn" type="submit">Enter the cockpit →</button>
              </form>
            ) : (
              <form onSubmit={submitRegister}>
                {plans.length > 0 && (
                  <div className="lpPlans">{plans.map((p) => (
                    <button type="button" key={p.id} className={selectedPlanId === p.id ? "on" : ""} onClick={() => setSelectedPlanId(p.id)}>
                      <b>{p.name}</b><span>{p.priceUsdt} USDT · {p.months || 1}mo</span>
                    </button>
                  ))}</div>
                )}
                <input className="lpInput" value={registerForm.name} onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })} placeholder="Your name" />
                <input className="lpInput" value={registerForm.email} onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })} placeholder="you@example.com" />
                <input className="lpInput" type="password" value={registerForm.password} onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })} placeholder="Password (10+ chars)" />
                <button className="lpBtn" type="submit" disabled={!publicInfo?.registrationEnabled}>Create account & get payment link</button>
                {!publicInfo?.registrationEnabled && <small className="lpMhint">Public registration is currently closed — contact us to be onboarded.</small>}
                {payment && <div className="lpPay"><strong>TRC20 USDT</strong><span>{payment.amount} USDT</span><code>{payment.address}</code></div>}
              </form>
            )}
            {toast && <small className="lpToast">{toast}</small>}
          </div>
        </div>
      )}
    </div>
  );
}
