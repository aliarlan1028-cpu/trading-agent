import React from "react";
import { createRoot } from "react-dom/client";
import { LandingPage, NativeAuthPage } from "../src/landing.jsx";
import "../src/entry.css";

const native = new URLSearchParams(location.search).get("surface") !== "web";
const calls = [];
window.__zeroBaseAuthCalls = calls;
const props = {
  login: async (payload) => { calls.push(["login", payload]); return payload.totp ? { ok:true } : { mfaRequired:true }; },
  registerAccount: async (payload) => { calls.push(["register", payload]); return { application:{ id:"application-1", status:"pending" } }; },
  toast:"",
  apiBase:"https://yegidawir.xyz",
  setApiBase:(value) => calls.push(["server", value]),
  publicInfo:{
    registrationEnabled:true, captchaRequired:false, inviteRequired:true,
    subscriptionPlans:[{ id:"monthly", name:"月度订阅", months:1, priceUsdt:99 },{ id:"annual", name:"年度订阅", months:12, priceUsdt:990 }],
    termsUrl:"/terms", privacyUrl:"/privacy", capacity:{ canProvision:true }
  }
};

createRoot(document.getElementById("root")).render(native ? <NativeAuthPage {...props}/> : <LandingPage {...props} isNativeApp={false}/>);
window.__zeroBaseAuthReady = true;
