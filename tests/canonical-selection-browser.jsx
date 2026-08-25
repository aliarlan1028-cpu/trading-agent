import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  CommandRail,
  ContextDock,
  TraceRail,
  buildShellContext,
  buildShellTrace,
  resolveShellObjectSelection
} from "../src/productShell.jsx";
import {
  EventRiskConcept,
  EventsConcept,
  OperatingBoundaryConcept,
  OperationsTasksConcept,
  PositionsConcept,
  StrategyLibraryConcept
} from "../src/conceptPages.jsx";
import { MobileBacktestResearch, MobileCapabilities, MobileMarket, MobileRisk, MobileShellTools, MobileStrategy } from "../src/mobile.jsx";

const fixture = {
  resourceState: { chat: "loaded", cockpit: "loaded", researchCenter: "loaded", riskCenter: "loaded", operationsCenter: "loaded" },
  system: { mode: "confirm_each", killSwitch: false },
  markets: [{ symbol: "BTC/USDT", price: 64250, status: "fresh" }],
  positions: [{ positionId: "position-native-2", symbol: "BTC/USDT", status: "open", side: "long", size: 0.2 }],
  tradePlans: [{ id: "plan-17", symbol: "ETH/USDT", status: "armed" }],
  events: [
    { id: "event-5", title: "US CPI", status: "scheduled", due: "2026-08-25T12:30:00Z" },
    { id: "event-stale", title: "Stale event", status: "scheduled", stale: true },
    { id: "event-forbidden", title: "Forbidden event", status: "scheduled", permissionDenied: true }
  ],
  eventRiskWindows: [{ id: "event-5", eventId: "event-5", title: "US CPI", sourceId: "official_bls", sourceName: "U.S. BLS", dueAt: "2026-08-25T12:30:00Z", deltaMs: 600000, phase: "pre_release_blackout", blocking: true, impact: 100, marketWide: true, verified: true }],
  skills: [{ id: "capability-18", name: "Order-book analyzer", kind: "analysis", status: "active" }],
  strategyCatalog: {
    products: [{ id: "breakout", versionId: "breakout@4", version: 4, definition: { name: "Breakout product" }, deployment: { state: "owner_live_observation" } }],
    strategies: [{ id: "mean-reversion", name: "Mean reversion", lifecycle: { stage: "research" }, contract: {} }]
  },
  backtestResearch: {
    historical: [{ id: "validation-6", name: "Breakout OOS", status: "passed" }],
    forward: []
  },
  tasks: [{ id: "task-9", title: "Reconcile fills", status: "waiting", type: "reconciliation" }],
  mandates: [{ id: "mandate-main", name: "Owner mandate", status: "active", version: 3 }],
  traces: [
    { workspaceId: "ai", objectId: "event-5", objectType: "Event", stage: "sense", status: "complete", evidenceId: "trace-event-5" },
    { workspaceId: "control", objectId: "event-5", objectType: "Event", stage: "guard", status: "complete", evidenceId: "trace-risk-event-5" },
    { workspaceId: "live", objectId: "position-native-2", objectType: "Position", stage: "monitor", status: "complete", evidenceId: "trace-position-native-2" },
    { workspaceId: "lab", objectId: "breakout@4", objectType: "Strategy product", stage: "plan", status: "complete", evidenceId: "trace-breakout-4" },
    { workspaceId: "control", objectId: "mandate-main", objectType: "Mandate", stage: "guard", status: "complete", evidenceId: "trace-mandate-main" },
    { workspaceId: "operations", objectId: "task-9", objectType: "Task", stage: "execute", status: "complete", evidenceId: "trace-task-9" },
    { workspaceId: "live", objectId: "BTC/USDT", objectType: "Market", stage: "sense", status: "complete", evidenceId: "trace-market" },
    { workspaceId: "lab", objectId: "capability-18", objectType: "Capability", stage: "recall", status: "complete", evidenceId: "trace-capability" },
    { workspaceId: "lab", objectId: "mean-reversion", objectType: "Strategy", stage: "plan", status: "complete", evidenceId: "trace-strategy" },
    { workspaceId: "lab", objectId: "validation-6", objectType: "Validation run", stage: "guard", status: "complete", evidenceId: "trace-validation" }
  ]
};

const noop = () => {};

function CanonicalSelectionBrowserHarness() {
  const [selectedObject, setSelectedObject] = useState(null);
  const [workspaceId, setWorkspaceId] = useState("ai");
  const ui = useMemo(() => ({
    selectObject(candidate) {
      const selected = resolveShellObjectSelection(fixture, candidate);
      if (!selected) return null;
      setSelectedObject(selected);
      setWorkspaceId(selected.workspaceId);
      return selected;
    },
    setActive(_route, selected) {
      if (!selected) return;
      setSelectedObject(selected);
      setWorkspaceId(selected.workspaceId);
    },
    openPanel: noop,
    notify: noop,
    download: noop
  }), []);
  const context = buildShellContext({ data: fixture, workspaceId, selectedObject });
  const trace = buildShellTrace(fixture, workspaceId, selectedObject);

  return <main
    id="canonical-browser-harness"
    data-shell-selected-object={selectedObject?.id || "none"}
    data-shell-selected-type={selectedObject?.type || "none"}
  >
    <ContextDock context={context} collapsible={false} />
    <TraceRail stages={trace} />
    <section data-browser-case="desktop-object-switcher"><CommandRail data={fixture} onSelect={(selected) => { setSelectedObject(selected); setWorkspaceId(selected.workspaceId); }} onNavigate={noop}/></section>
    <section data-browser-case="ai"><EventsConcept data={fixture} action={noop} ui={ui} /></section>
    <section data-browser-case="live"><PositionsConcept data={fixture} ui={ui} /></section>
    <section data-browser-case="lab"><StrategyLibraryConcept data={fixture} action={noop} ui={ui} /></section>
    <section data-browser-case="control"><OperatingBoundaryConcept data={fixture} ui={ui} /></section>
    <section data-browser-case="control-event-risk"><EventRiskConcept data={fixture} ui={ui} /></section>
    <section data-browser-case="operations"><OperationsTasksConcept data={fixture} action={noop} ui={ui} /></section>
    <section data-browser-case="app-market"><MobileMarket data={fixture} action={noop} ui={ui} /></section>
    <section data-browser-case="app-capability"><MobileCapabilities data={fixture} action={noop} ui={ui} /></section>
    <section data-browser-case="app-strategy"><MobileStrategy data={fixture} action={noop} ui={ui} initialTab="catalog" /></section>
    <section data-browser-case="app-validation"><MobileBacktestResearch data={fixture} action={noop} ui={ui} /></section>
    <section data-browser-case="app-event-risk"><MobileRisk data={fixture} action={noop} ui={ui} view="events" /></section>
    <section data-browser-case="app-object-sheet"><MobileShellTools data={fixture} workspaceId={workspaceId} selectedObject={selectedObject} onSelect={(selected) => { setSelectedObject(selected); setWorkspaceId(selected.workspaceId); }} onNavigate={noop} initiallyOpen="objects" /></section>
  </main>;
}

createRoot(document.getElementById("root")).render(<CanonicalSelectionBrowserHarness />);
window.__canonicalBrowserReady = true;
