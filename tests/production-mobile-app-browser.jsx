import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppFrame } from "../src/appFrame.jsx";
import { MobileApp } from "../src/mobile.jsx";
import { loadedResourceState, productionShellBrowserFixture as fixture } from "./production-shell-browser-fixture.js";
import "../src/styles.css";
import "../src/product-foundation.css";

const noop = () => {};

function ProductionMobileAppBrowserHarness() {
  const scenario = new URLSearchParams(window.location.search).get("state");
  const persistentState = ["forbidden", "stale", "degraded"].includes(scenario);
  const [data, setData] = useState(() => ({
    ...fixture,
    resourceState: { ...loadedResourceState, chat: persistentState ? scenario : "loading" }
  }));
  useEffect(() => {
    if (persistentState) return undefined;
    const timer = window.setTimeout(() => setData(fixture), 500);
    return () => window.clearTimeout(timer);
  }, [persistentState]);
  const ensureSection = (...args) => { (window.__productionMobileEnsureCalls ||= []).push(args); };
  return (
    <AppFrame authenticated>
      <MobileApp lang="en" switchLang={noop} api={{ data, action: async () => ({ ok: true }), toast: "", busy: false, notify: noop, download: noop, refresh: noop, ensureSection, connectionError: "" }} />
    </AppFrame>
  );
}

createRoot(document.getElementById("root")).render(<ProductionMobileAppBrowserHarness />);
window.__productionMobileAppBrowserReady = true;
