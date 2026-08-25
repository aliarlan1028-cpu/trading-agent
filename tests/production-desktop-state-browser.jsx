import React from "react";
import { createRoot } from "react-dom/client";
import { AppFrame } from "../src/appFrame.jsx";
import { CommandRail, ContextDock, TraceRail, WorkspaceRail, WorkspaceStateBoundary, buildShellContext, buildShellTrace } from "../src/productShell.jsx";
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
const context = buildShellContext({ data, workspaceId: "ai" });
const trace = buildShellTrace(data, "ai");

createRoot(document.getElementById("root")).render(
  <AppFrame authenticated>
    <div className="desktopStateBrowser appShell kordynSystem" data-shell-selected-object="none" data-shell-selected-type="none" data-shell-selected-workspace="none" data-shell-selected-source="none" data-shell-selected-route="none" data-shell-selected-evidence="Unavailable">
      <header className="appTopbar" data-shell-role="desktop-command"><CommandRail data={data} onNavigate={noop} onSelect={noop}/></header>
      <WorkspaceRail activeWorkspace="ai" onNavigate={noop}/>
      <main className="mainArea"><div className="content">
        <WorkspaceStateBoundary resourceState={state} onRetry={retry}>
          <AiTraderCenter data={data} action={noop} ui={ui} initialTab="events" />
        </WorkspaceStateBoundary>
      </div></main>
      <ContextDock context={context} onNavigate={noop} initiallyCollapsed={window.innerWidth <= 1320}/>
      <TraceRail stages={trace}/>
    </div>
  </AppFrame>
);
window.__productionDesktopStateReady = true;
