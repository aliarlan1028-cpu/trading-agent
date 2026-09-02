import React from "react";
import { createRoot } from "react-dom/client";
import { LandingPage, NativeAuthPage } from "../src/landing.jsx";
import "../src/entry.css";

const search = new URLSearchParams(location.search);
const native = search.get("surface") !== "web";
const calls = [];
window.__zeroBaseAuthCalls = calls;
const props = {
  login: async (payload) => { calls.push(["login", payload]); return payload.totp ? { ok:true } : { mfaRequired:true }; },
  registerAccount: async (payload) => { calls.push(["register", payload]); return { application:{ id:"application-1", status:"pending" } }; },
  toast:"",
  apiBase:"https://yegidawir.xyz",
  setApiBase:(value) => calls.push(["server", value]),
  publicInfo:{
    registrationEnabled:search.get("registration") !== "closed", captchaRequired:false, inviteRequired:true,
    subscriptionPlans:[
      { id:"monthly", name:"月度订阅", months:1, priceUsdt:49 },
      { id:"quarterly", name:"季度订阅", months:3, priceUsdt:129 },
      { id:"half-year", name:"半年订阅", months:6, priceUsdt:239 },
      { id:"annual", name:"年度订阅", months:12, priceUsdt:399 }
    ],
    termsUrl:"/terms", privacyUrl:"/privacy", capacity:{ canProvision:true }
  }
};

createRoot(document.getElementById("root")).render(native ? <NativeAuthPage {...props}/> : <LandingPage {...props} isNativeApp={false}/>);
window.__zeroBaseAuthReady = true;
