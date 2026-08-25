import React from "react";
import { createRoot } from "react-dom/client";
import { AppFrame } from "../src/appFrame.jsx";
import { WorkspaceStateBoundary } from "../src/productShell.jsx";
import { AiTraderCenter } from "../src/workspacePages.jsx";
import { productionShellBrowserFixture } from "./production-shell-browser-fixture.js";
import "../src/styles.css";
import "../src/product-foundation.css";

const state = new URLSearchParams(window.location.search).get("state") || "stale";
const data = {
  ...productionShellBrowserFixture,
  resourceState: { ...productionShellBrowserFixture.resourceState, chat: state }
};
const noop = () => {};
const ui = { setActive: noop, selectObject: noop, notify: noop, download: noop, refresh: noop, ensureSection: noop, openPanel: noop, closePanel: noop };
const retry = () => { (window.__productionDesktopRetry ||= []).push({ section: "chat", force: true }); };

createRoot(document.getElementById("root")).render(
  <AppFrame authenticated>
    <main className="desktopStateBrowser appShell kordynSystem">
      <section className="content">
        <WorkspaceStateBoundary resourceState={state} onRetry={retry}>
          <AiTraderCenter data={data} action={noop} ui={ui} initialTab="events" />
        </WorkspaceStateBoundary>
      </section>
    </main>
  </AppFrame>
);
window.__productionDesktopStateReady = true;
