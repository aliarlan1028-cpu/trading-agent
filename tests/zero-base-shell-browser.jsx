import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppFrame } from "../src/appFrame.jsx";
import { uiConfirm } from "../src/confirm.jsx";
import { zeroBaseLocationForRoute } from "../src/zeroBaseArchitecture.js";
import { ZeroBaseDesktopShell } from "../src/zeroBaseShell.jsx";
import { ZeroBaseToday } from "../src/zeroBaseToday.jsx";
import { CommandRail, WorkspaceStateBoundary, buildShellContext, buildShellTrace } from "../src/productShell.jsx";
import { AiTraderCenter, OperationsCenter, ResearchCenter, RiskCenter, SettingsConcept, TradingCenter } from "../src/workspacePages.jsx";
import { productionShellBrowserFixture } from "./production-shell-browser-fixture.js";
import "../src/productStyles.js";

const state = new URLSearchParams(window.location.search).get("state") || "loaded";
const fixture = {
  ...productionShellBrowserFixture,
  portfolio: { ...productionShellBrowserFixture.portfolio, todayPnl: 42.5 },
  tradePlans: [{ id: "plan-17", symbol: "ETH/USDT", title: "ETH breakout", status: "awaiting_approval" }],
  pendingActions: [{ id: "action-1", title: "Confirm mandate", status: "pending" }],
  riskIncidents: [{ id: "risk-1", title: "Protection drift", status: "open", severity: "high" }],
  reviews: [{ ...productionShellBrowserFixture.reviews[0], status: "pending" }],
  watchTriggers: [{ id: "watch-3", symbol: "SOL/USDT", status: "active" }],
  agentStatus: { state: "watching", nextActions: ["Review plan evidence"] },
  agentRuns: [{ id: "run-1", title: "Market patrol", status: "completed", summary: "No forced action" }]
};
const patrolMessage = { id:"msg-patrol-1", role:"agent", sessionId:"chat_autocycle", createdAt:"2026-08-26T01:10:00.000Z", content:"### Patrol conclusion\nEvidence coverage is complete; keep watching.", capabilityCoverage:{ ok:true, covered:2, required:2, missing:[] }, toolTrace:[], presentation:{ linked:{} } };
const analysisMessage = { id:"msg-analysis-1", role:"agent", sessionId:"chat-manual", createdAt:"2026-08-26T01:20:00.000Z", content:"### Market conclusion\nWait for confirmation before taking risk.", toolTrace:[], presentation:{ linked:{} } };
const nativeFetch = window.fetch.bind(window);
window.__zeroBaseChatRequests = [];
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("/api/agent/chat")) {
    window.__zeroBaseChatRequests.push(url);
    const query = new URL(url, location.origin).searchParams;
    const messages = query.get("sessionId") === "chat_autocycle" ? [patrolMessage] : query.get("scope") === "all" ? [patrolMessage, analysisMessage] : [analysisMessage];
    return new Response(JSON.stringify({ messages, sessions:[], activeSessionId:query.get("sessionId") || "chat-manual" }), { status:200, headers:{ "Content-Type":"application/json" } });
  }
  return nativeFetch(input, init);
};

const workspaceByFamily = {
  today: "ai", ai: "ai", portfolio: "live", strategy: "lab", knowledge: "lab",
  capability: "lab", reviews: "lab", guard: "control", operations: "operations", configuration: "configuration"
};

function BrowserShell() {
  const [familyId, setFamilyId] = useState("today");
  const [viewId, setViewId] = useState("owner");
  const [selectedObject, setSelectedObject] = useState(null);
  const workspaceId = workspaceByFamily[familyId] || "ai";
  useEffect(() => {
    window.__openZeroBaseConfirm = () => uiConfirm("确认继续执行当前操作？", {
      title: "确认操作",
      confirmLabel: "继续",
      cancelLabel: "取消"
    });
    return () => { delete window.__openZeroBaseConfirm; };
  }, []);
  const context = useMemo(() => buildShellContext({ data: fixture, workspaceId, selectedObject }), [workspaceId, selectedObject]);
  const trace = useMemo(() => buildShellTrace(fixture, workspaceId, selectedObject), [workspaceId, selectedObject]);
  const navigate = (nextFamily, nextView, directRoute = "") => {
    const location = directRoute ? zeroBaseLocationForRoute(directRoute) : { familyId: nextFamily, viewId: nextView };
    setFamilyId(location.familyId);
    setViewId(location.viewId);
    window.__zeroBaseNavigation ||= [];
    window.__zeroBaseNavigation.push({ ...location, directRoute });
  };
  const select = (row) => { setSelectedObject(row); return row; };
  const action = async () => ({ ok: true });
  const ui = {
    setActive: (route) => navigate(null, null, route),
    selectObject: select,
    ensureSection: async () => ({ ok: true }),
    notify: () => {},
    download: () => {}
  };
  const aiTab = ({ patrol:"patrol", intelligence: "intel", watch: "watch", events: "events", poster:"poster" })[viewId] || "dialog";
  const portfolioTab = ({ market: "market", account: "account", positions: "positions", protection: "protection", execution: "execution", ledger: "ledger" })[viewId] || "overview";
  const riskTab = ({ events: "events", boundaries: "mandate", rules: "rules" })[viewId] || "posture";
  const operationsTab = ({ tasks: "tasks", recovery: "recovery", notifications: "notifications", audit: "audit" })[viewId] || "overview";
  const settingsTab = ({ environment: "base", network: "base", backup: "base", security: "base", "event-sources": "event_sources" })[viewId] || viewId;
  const settingsSection = ({ environment: "environment", network: "network", backup: "data_backup", security: "security" })[viewId] || "environment";
  const strategySurface = ({ studio: "studio", market: "market", historical: "research", forward: "research" })[viewId] || "catalog";
  const knowledgeSection = ({ import: "import", evidence: "rules", graph: "graph", artifacts: "methods", workflows: "workflows" })[viewId] || "reference";
  const capabilityType = ({ native: "原生工具", workflow: "工作流", mcp: "工具 (MCP)", connectors: "连接器", skills: "导入技能" })[viewId] || "全部工具";
  const workbench = familyId === "today"
    ? <ZeroBaseToday data={fixture} onNavigate={(route) => navigate(null, null, route)} viewId={viewId} />
    : familyId === "ai" ? <AiTraderCenter data={fixture} action={action} ui={ui} initialTab={aiTab} />
      : familyId === "portfolio" ? <TradingCenter data={fixture} action={action} ui={ui} initialTab={portfolioTab} />
        : familyId === "strategy" ? <ResearchCenter data={fixture} action={action} ui={ui} initialTab="strategy" strategyInitialTab={strategySurface} />
          : familyId === "knowledge" ? <ResearchCenter data={fixture} action={action} ui={ui} initialTab="knowledge" knowledgeInitialSection={knowledgeSection} />
            : familyId === "capability" ? <ResearchCenter data={fixture} action={action} ui={ui} initialTab="capabilities" capabilityInitialType={capabilityType} />
              : familyId === "reviews" ? <ResearchCenter data={fixture} action={action} ui={ui} initialTab={["owner", "lessons"].includes(viewId) ? "owner" : "reviews"} ownerInitialPane={viewId === "lessons" ? "lessons" : "improvements"} />
                : familyId === "guard" ? <RiskCenter data={fixture} action={action} ui={ui} initialTab={riskTab} />
                  : familyId === "operations" ? <OperationsCenter data={fixture} action={action} ui={ui} initialTab={operationsTab} />
                    : <SettingsConcept data={fixture} action={action} ui={ui} activeTab={settingsTab} initialBaseSection={settingsSection} onTabChange={(next) => setViewId(next)} />;

  return <AppFrame authenticated><ZeroBaseDesktopShell
    data={fixture}
    activeFamilyId={familyId}
    activeViewId={viewId}
    onFamilyNavigate={navigate}
    selectedObject={selectedObject}
    context={context}
    trace={trace}
    renderTopbar={({ shellTools }) => <header className="appTopbar zbTopbar" data-shell-role="desktop-command"><CommandRail data={fixture} onSelect={select} onNavigate={(route) => navigate(null, null, route)} />{shellTools}</header>}>
    <WorkspaceStateBoundary resourceState={state} forbidden={state === "forbidden" ? "owner" : ""} onRetry={() => { window.__zeroBaseRetry = true; }}>
      {workbench}
    </WorkspaceStateBoundary>
  </ZeroBaseDesktopShell></AppFrame>;
}

createRoot(document.getElementById("root")).render(<BrowserShell />);
window.__zeroBaseShellBrowserReady = true;
