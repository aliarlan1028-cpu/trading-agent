import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const React = require("react");
const { renderToString } = require("react-dom/server");
const postcss = require("postcss");
const esbuild = require("esbuild");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "prototype-contract");
fs.mkdirSync(cacheDir, { recursive: true });
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });

esbuild.buildSync({
  stdin: {
    contents: `
      import * as ProductShell from "./src/productShell.jsx";
      import * as Mobile from "./src/mobile.jsx";
      import * as Chat from "./src/chat.jsx";
      import * as MobileOperations from "./src/mobileOperations.jsx";
      import * as Concepts from "./src/conceptPages.jsx";
      export { ProductShell, Mobile, Chat, MobileOperations, Concepts };
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  outfile: outFile,
  logLevel: "silent"
});

const { ProductShell: Shell, Mobile, Chat, MobileOperations, Concepts } = require(outFile);
const foundation = fs.readFileSync(path.join(rootDir, "src/product-foundation.css"), "utf8");
const styles = fs.readFileSync(path.join(rootDir, "src/styles.css"), "utf8");
const stylesAst = postcss.parse(styles);

function finalDeclarations(selector, { media = null } = {}) {
  const values = {};
  stylesAst.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    const mediaParent = rule.parent?.type === "atrule" && rule.parent.name === "media" ? rule.parent.params : null;
    if (media !== null && !media.test(mediaParent || "")) return;
    if (media === null && mediaParent !== null) return;
    rule.walkDecls((decl) => { values[decl.prop] = `${decl.value}${decl.important ? " !important" : ""}`; });
  });
  return values;
}

const fixture = {
  resourceState: { chat: "loaded", cockpit: "loaded", researchCenter: "loaded", riskCenter: "loaded", operationsCenter: "loaded" },
  system: { mode: "confirm_each", killSwitch: false, dataFreshnessMs: 380, latencyMs: 24, dataFreshnessState: "fresh" },
  markets: [{ symbol: "BTC/USDT", price: 64250, status: "fresh", updatedAt: "2026-08-24T08:00:00Z" }],
  positions: [{ id: "position-2", symbol: "BTC/USDT", status: "open", side: "long", size: 0.2 }],
  tradePlans: [{ id: "plan-17", symbol: "ETH/USDT", status: "armed", version: 4, source: "agent", permission: "confirm_each" }],
  watchTriggers: [{ id: "watch-3", symbol: "SOL/USDT", status: "active", thesis: "Wait for the reclaim" }],
  events: [{ id: "event-5", title: "US CPI", status: "scheduled", due: "2026-08-25T12:30:00Z" }],
  orders: [{ id: "order-4", symbol: "BTC/USDT", status: "live", side: "buy" }],
  executionOrders: [{ id: "execution-16", symbol: "ETH/USDT", status: "executing", planId: "plan-17" }],
  fills: [{ id: "fill-7", symbol: "BTC/USDT", status: "confirmed", price: 64110 }],
  strategyCatalog: {
    products: [{ id: "breakout", versionId: "breakout@4", version: 4, definition: { name: "Breakout product" }, deployment: { state: "owner_live_observation" } }],
    strategies: [{ id: "mean-reversion", name: "Mean reversion", lifecycle: { stage: "research" }, contract: {} }]
  },
  backtestResearch: {
    historical: [{ id: "validation-6", name: "Breakout OOS", status: "passed" }],
    forward: [{ id: "paper-8", name: "Breakout forward", status: "running" }]
  },
  backtests: [{ id: "backtest-10", name: "Legacy OOS", status: "completed" }],
  paperReport: { sessions: [{ id: "paper-11", name: "Forward session", status: "running" }] },
  agentRuns: [{ id: "agent-run-12", title: "Watcher refresh", status: "completed" }],
  auditLogs: [{ id: "audit-13", action: "ORDER_AUTHORIZED", status: "recorded", createdAt: "2026-08-24T08:02:00Z" }],
  tasks: [{ id: "task-9", title: "Reconcile fills", status: "waiting", type: "reconciliation" }],
  mandates: [{ id: "mandate-main", name: "Owner mandate", status: "active", version: 3 }],
  riskIncidents: [{ id: "incident-14", title: "Protection mismatch", status: "open", severity: "high" }],
  reviews: [{ id: "review-15", type: "trade", title: "BTC execution review", status: "pending" }],
  skills: [{ id: "capability-18", name: "Order-book analyzer", kind: "analysis", status: "active" }],
  knowledge: { sources: [{ id: "kb-2", title: "Breakout playbook", status: "published", version: 2 }] },
  traces: [{ evidenceId: "trace-8", workspaceId: "live", objectId: "plan-17", stage: "guard", status: "blocked", detail: "Permission confirmation is required", createdAt: "2026-08-24T08:01:00Z" }],
  notifications: [{ id: "notice-1", read: false }]
};

test("prototype semantic tokens and fixed shell dimensions are exact", () => {
  const expected = {
    "--kordyn-paper": "#F4F1E9", "--kordyn-paper-2": "#EBE7DC", "--kordyn-ink": "#111311",
    "--kordyn-ink-2": "#2B302C", "--kordyn-muted": "#77796F", "--kordyn-dark": "#111511",
    "--kordyn-dark-2": "#1A1F1A", "--kordyn-acid": "#CCFF3D", "--kordyn-mint": "#4FB78B",
    "--kordyn-danger": "#E25645", "--kordyn-amber": "#EFB44B", "--kordyn-blue": "#5D8EE8",
    "--kordyn-line": "rgba(17,19,17,.22)", "--kordyn-command-rail": "64px",
    "--kordyn-workspace-rail": "188px", "--kordyn-context-dock": "304px", "--kordyn-trace-rail": "66px"
  };
  for (const [token, value] of Object.entries(expected)) {
    assert.match(foundation, new RegExp(`${token.replaceAll("-", "\\-")}\\s*:\\s*${value.replace(/[().]/g, "\\$&")}\\s*;`, "i"), `${token} must match the prototype`);
  }
  assert.match(styles, /\.appShell\.kordynSystem\s*\{[^}]*grid-template-columns:\s*var\(--kordyn-workspace-rail\)[^}]*grid-template-rows:\s*var\(--kordyn-command-rail\)[^}]*var\(--kordyn-trace-rail\)/s);
  assert.match(styles, /@media\s*\(max-width:\s*720px\)/);
});

test("desktop workspace current-state marker keeps the prototype four-pixel authority stripe", () => {
  const marker = finalDeclarations(".workspaceRail button.active::after");
  assert.equal(marker.width, "4px");
  assert.equal(marker.background, "var(--kordyn-acid)");
});

test("authenticated type stacks match the immutable prototype and override legacy app aliases", () => {
  assert.match(foundation, /--kordyn-display:\s*"Avenir Next",\s*"Helvetica Neue",\s*Arial,\s*sans-serif\s*;/);
  assert.match(foundation, /--kordyn-sans:\s*Inter,\s*"Helvetica Neue",\s*Arial,\s*sans-serif\s*;/);
  assert.match(foundation, /--kordyn-mono:\s*"SFMono-Regular",\s*"Roboto Mono",\s*"Space Mono",\s*ui-monospace,\s*monospace\s*;/);
  assert.match(foundation, /--font-ui:\s*var\(--kordyn-sans\)\s*;/);
  assert.match(foundation, /--font-mono:\s*var\(--kordyn-mono\)\s*;/);
  assert.match(foundation, /font-family:\s*var\(--kordyn-sans\)\s*;/);

  const authenticatedLegacy = styles
    .replace(/:root\s*\{[^}]*\}/, "")
    .replace(/\.lpModal\{[^}]*\}/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(authenticatedLegacy, /\bManrope\b|"Space Grotesk"|"Public Sans"|"IBM Plex Mono"/);
  assert.doesNotMatch(fs.readFileSync(path.join(rootDir, "src/product-system.css"), "utf8"), /\bManrope\b|"Space Grotesk"|"Public Sans"|"IBM Plex Mono"/);
  assert.doesNotMatch(fs.readFileSync(path.join(rootDir, "src/lib.jsx"), "utf8"), /IBM Plex Mono/);
});

test("desktop shell exports and renders command, workspace, context and trace roles", () => {
  for (const name of ["CommandRail", "WorkspaceRail", "ContextDock", "TraceRail"]) assert.equal(typeof Shell[name], "function", `${name} must be shared and exported`);
  const html = [
    React.createElement(Shell.CommandRail, { data: fixture, onNavigate: () => {}, onSelect: () => {} }),
    React.createElement(Shell.WorkspaceRail, { activeWorkspace: "live", onNavigate: () => {} }),
    React.createElement(Shell.ContextDock, { context: Shell.buildShellContext({ data: fixture, workspaceId: "live" }) }),
    React.createElement(Shell.TraceRail, { stages: Shell.buildShellTrace(fixture, "live") })
  ].map(renderToString).join("\n");
  for (const role of ["command-rail", "workspace-rail", "context-dock", "trace-rail"]) assert.match(html, new RegExp(`data-shell-role="${role}"`));
  for (const label of ["Evidence", "Risk", "Mandate", "Object", "Version", "Permissions", "Next action"]) assert.match(html, new RegExp(label, "i"));
  for (const stage of ["Sense", "Recall", "Plan", "Guard", "Execute", "Monitor", "Review"]) assert.match(html, new RegExp(stage));
});

test("authenticated desktop composes every shared rail around the existing workspace content", () => {
  const main = fs.readFileSync(path.join(rootDir, "src/main.jsx"), "utf8");
  const authenticatedShell = main.slice(main.indexOf('<div className="appShell kordynSystem"'), main.indexOf("function ConnectionScreen"));
  assert.match(authenticatedShell, /<AppTopbar\b/);
  assert.match(authenticatedShell, /<WorkspaceRail\b/);
  assert.match(authenticatedShell, /<main className="mainArea">[\s\S]*?<Suspense[\s\S]{0,120}>\{content\}<\/Suspense>[\s\S]*?<\/main>/);
  assert.match(authenticatedShell, /<ContextDock\b/);
  assert.match(authenticatedShell, /<TraceRail\b/);
});

test("object switcher indexes loaded production objects and has deterministic keyboard navigation", () => {
  for (const name of ["buildShellSearchIndex", "filterShellSearchResults", "nextShellSearchInteraction"]) assert.equal(typeof Shell[name], "function", `${name} is required`);
  const index = Shell.buildShellSearchIndex(fixture);
  assert.ok(index.some((row) => row.id === "BTC/USDT" && row.type === "Market"));
  assert.ok(index.some((row) => row.id === "plan-17" && row.route));
  assert.ok(index.some((row) => row.id === "kb-2"));
  assert.ok(index.some((row) => row.id === "task-9"));
  const expectedObjects = [
    ["BTC/USDT", "Market", "market", "live", "cockpit"],
    ["position-2", "Position", "positions", "live", "cockpit"],
    ["plan-17", "Trade plan", "signalHub", "live", "cockpit"],
    ["event-5", "Event", "eventsTasks:events", "ai", "chat"],
    ["watch-3", "Watch", "watch", "ai", "chat"],
    ["order-4", "Order", "tradeLedger", "live", "cockpit"],
    ["fill-7", "Fill", "tradeLedger", "live", "cockpit"],
    ["execution-16", "Execution", "executionReview", "live", "cockpit"],
    ["breakout@4", "Strategy product", "strategyLib", "lab", "researchCenter"],
    ["mean-reversion", "Strategy", "strategyLib", "lab", "researchCenter"],
    ["validation-6", "Validation run", "strategyLib", "lab", "researchCenter"],
    ["paper-8", "Paper run", "strategyLib", "lab", "researchCenter"],
    ["backtest-10", "Validation run", "strategyLib", "lab", "researchCenter"],
    ["paper-11", "Paper run", "strategyLib", "lab", "researchCenter"],
    ["agent-run-12", "Agent run", "operationsCenter:tasks", "operations", "chat"],
    ["audit-13", "Audit log", "auditSystem", "operations", "operationsCenter"],
    ["review-15", "Review", "labReviews", "lab", "researchCenter"],
    ["mandate-main", "Mandate", "riskMandate", "control", "riskCenter"],
    ["incident-14", "Risk incident", "riskCenter", "control", "riskCenter"],
    ["task-9", "Task", "operationsCenter:tasks", "operations", "operationsCenter"],
    ["capability-18", "Capability", "capabilityLib", "lab", "researchCenter"],
    ["kb-2", "Knowledge", "knowledgeBase", "lab", "researchCenter"]
  ];
  for (const [id, type, route, workspaceId, sourceSection] of expectedObjects) {
    assert.ok(index.some((row) => row.id === id && row.type === type && row.route === route && row.workspaceId === workspaceId && row.sourceSection === sourceSection), `${type} ${id} must have one canonical destination`);
  }
  for (const row of index) {
    for (const field of ["type", "title", "id", "status", "route"]) assert.equal(typeof row[field], "string", `${field} must be present`);
  }
  for (const [id, type,, workspaceId] of expectedObjects) {
    const selected = Shell.resolveShellObjectSelection(fixture, { id, type }, workspaceId);
    assert.ok(selected, `${type} ${id} is selectable from current production truth`);
    const context = Shell.buildShellContext({ data: fixture, workspaceId, selectedObject: selected });
    assert.equal(`${context.objectType}:${context.object}`, `${type}:${id}`);
    const wrongTypedTrace = Shell.buildShellTrace({ ...fixture, traces: [{ workspaceId, objectId: id, objectType: `${type} mismatch`, stage: "sense", status: "complete", evidenceId: "wrong-type" }] }, workspaceId, selected);
    assert.notEqual(wrongTypedTrace[0].evidence, "wrong-type", `${type} trace identity fails closed on a type mismatch`);
  }
  assert.doesNotMatch(JSON.stringify(index), /WATCH-2048|DEMO|mock/i);
  const results = Shell.filterShellSearchResults(index, "BTC");
  assert.equal(results[0].id, "BTC/USDT");
  assert.deepEqual(Shell.nextShellSearchInteraction({ key: "ArrowDown", activeIndex: 0, count: 3 }), { activeIndex: 1, close: false, selectIndex: -1 });
  assert.deepEqual(Shell.nextShellSearchInteraction({ key: "ArrowUp", activeIndex: 0, count: 3 }), { activeIndex: 2, close: false, selectIndex: -1 });
  assert.deepEqual(Shell.nextShellSearchInteraction({ key: "Enter", activeIndex: 1, count: 3 }), { activeIndex: 1, close: true, selectIndex: 1 });
  assert.deepEqual(Shell.nextShellSearchInteraction({ key: "Escape", activeIndex: 1, count: 3 }), { activeIndex: 1, close: true, selectIndex: -1 });
});

test("canonical selection resolves current indexed truth, routes once, and fails closed", () => {
  for (const name of ["resolveShellObjectSelection", "runShellObjectSelection"]) assert.equal(typeof Shell[name], "function", `${name} is required`);
  const effects = [];
  const selected = Shell.runShellObjectSelection({
    data: fixture,
    candidate: { id: "task-9", type: "Task" },
    workspaceId: "operations",
    onSelect: (row) => effects.push(["select", row?.id || null]),
    onNavigate: (route, row) => effects.push(["navigate", route, row.id])
  });
  assert.equal(selected.raw, fixture.tasks[0]);
  assert.deepEqual(effects, [["select", "task-9"], ["navigate", "operationsCenter:tasks", "task-9"]]);

  const ambiguous = {
    resourceState: { cockpit: "loaded" },
    positions: [{ id: "shared", symbol: "BTC/USDT" }],
    tradePlans: [{ id: "shared", title: "BTC plan" }]
  };
  assert.equal(Shell.resolveShellObjectSelection(ambiguous, { id: "shared" }, "live"), null, "an untyped ID collision fails closed");
  assert.equal(Shell.resolveShellObjectSelection(ambiguous, { id: "shared", type: "Position" }, "live")?.type, "Position");
  assert.equal(Shell.resolveShellObjectSelection({ ...fixture, resourceState: { ...fixture.resourceState, operationsCenter: "failed" } }, { id: "task-9", type: "Task" }, "operations"), null);
  assert.equal(Shell.resolveShellObjectSelection({ ...fixture, resourceState: { ...fixture.resourceState, chat: "loaded", operationsCenter: "failed" } }, { id: "agent-run-12", type: "Agent run" }, "operations"), null, "a healthy object source cannot bypass a failed destination workspace");
  assert.equal(Shell.resolveShellObjectSelection({ ...fixture, tasks: [] }, selected, "operations"), null, "a removed object cannot survive a data refresh");
});

test("page Registry interaction uses one canonical controller and projects typed identity into Context and Trace", () => {
  assert.equal(typeof Shell.runShellRegistrySelection, "function");
  assert.equal(typeof Shell.CanonicalRegistryButton, "function");
  const representatives = [
    ["ai", { id: "event-5", type: "Event" }],
    ["live", { id: "position-2", type: "Position" }],
    ["lab", { id: "mean-reversion", type: "Strategy" }],
    ["control", { id: "mandate-main", type: "Mandate" }],
    ["operations", { id: "task-9", type: "Task" }]
  ];
  for (const [workspaceId, candidate] of representatives) {
    const scoped = {
      ...fixture,
      traces: [{ workspaceId, objectId: candidate.id, objectType: candidate.type, stage: "sense", status: "completed", evidenceId: `trace-${candidate.id}` }]
    };
    let local = null;
    let selected = null;
    const registryButton = Shell.CanonicalRegistryButton({
      candidate,
      onLocalSelect: (row) => { local = row; },
      onSelectObject: (row) => Shell.runShellObjectSelection({ data: scoped, candidate: row, workspaceId, navigate: false, onSelect: (value) => { selected = value; } }),
      children: candidate.id
    });
    registryButton.props.onClick({ defaultPrevented: false });
    assert.equal(local, candidate, `${workspaceId} local inspector selection is preserved`);
    assert.equal(selected?.id, candidate.id, `${workspaceId} selection resolves against current indexed truth`);
    const context = Shell.buildShellContext({ data: scoped, workspaceId, selectedObject: selected });
    assert.equal(context.object, candidate.id);
    assert.equal(context.objectType, candidate.type);
    const trace = Shell.buildShellTrace(scoped, workspaceId, selected);
    assert.equal(trace[0].objectId, candidate.id);
    assert.equal(trace[0].objectType, candidate.type);
    assert.equal(trace[0].evidence, `trace-${candidate.id}`);
  }

  const ui = { selectObject: () => {}, setActive: () => {}, openPanel: () => {}, notify: () => {}, download: () => {} };
  const componentMarkup = [
    React.createElement(Concepts.EventsConcept, { data: fixture, action: () => {}, ui }),
    React.createElement(Concepts.PositionsConcept, { data: fixture, ui }),
    React.createElement(Concepts.StrategyLibraryConcept, { data: fixture, action: () => {}, ui }),
    React.createElement(Concepts.OperatingBoundaryConcept, { data: fixture, ui }),
    React.createElement(Concepts.OperationsTasksConcept, { data: fixture, action: () => {}, ui })
  ].map(renderToString).join("\n");
  for (const [id, type] of [["event-5", "Event"], ["position-2", "Position"], ["breakout@4", "Strategy product"], ["mandate-main", "Mandate"], ["task-9", "Task"]]) {
    assert.match(componentMarkup, new RegExp(`data-shell-object-id="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*data-shell-object-type="${type}"`), `${type} must expose the canonical click target in its real workspace component`);
  }
});

test("Position Registry and shell resolver share canonical identity when backend rows omit id", () => {
  for (const [field, id] of [["positionId", "position-native-21"], ["instId", "BTC-USDT-SWAP"]]) {
    const row = { [field]: id, symbol: "BTC/USDT", status: "open" };
    const data = { resourceState: { cockpit: "loaded" }, positions: [row], traces: [{ workspaceId: "live", objectType: "Position", objectId: id, stage: "sense", status: "complete" }] };
    assert.equal(Shell.canonicalPositionIdentity(row), id);
    const index = Shell.buildShellSearchIndex(data);
    assert.equal(index.find((item) => item.type === "Position")?.id, id);
    let selected = null;
    const button = Shell.CanonicalRegistryButton({
      candidate: { id: Shell.canonicalPositionIdentity(row), type: "Position" },
      onSelectObject: (candidate) => Shell.runShellObjectSelection({ data, candidate, workspaceId: "live", navigate: false, onSelect: (value) => { selected = value; } }),
      children: "position"
    });
    button.props.onClick({ defaultPrevented: false });
    assert.equal(selected?.raw, row);
    assert.equal(Shell.buildShellContext({ data, workspaceId: "live", selectedObject: selected }).object, id);
    assert.equal(Shell.buildShellTrace(data, "live", selected)[0].objectId, id);
  }
});

test("desktop Registry selections expose the shared canonical object contract", () => {
  const tasks = renderToString(React.createElement(Concepts.OperationsTasksConcept, {
    data: fixture,
    action: () => {},
    ui: { selectObject: () => {}, openPanel: () => {}, setActive: () => {} }
  }));
  assert.match(tasks, /data-shell-object-id="task-9"/);
  assert.match(tasks, /data-shell-object-type="Task"/);
  const audit = renderToString(React.createElement(Concepts.OperationsAuditConcept, {
    data: fixture,
    ui: { selectObject: () => {}, download: () => {} }
  }));
  assert.match(audit, /data-shell-object-id="audit-13"/);
  assert.match(audit, /data-shell-object-type="Audit log"/);
});

test("combobox shortcut, keyboard selection and routing execute the real shared interaction controller", () => {
  assert.equal(typeof Shell.runShellSearchShortcut, "function");
  assert.equal(typeof Shell.runShellSearchInteraction, "function");
  const effects = [];
  const shortcutEvent = { key: "k", metaKey: true, ctrlKey: false, preventDefault: () => effects.push("prevented") };
  assert.equal(Shell.runShellSearchShortcut(shortcutEvent, { open: () => effects.push("opened"), focus: () => effects.push("focused") }), true);
  assert.deepEqual(effects, ["prevented", "opened", "focused"]);

  const results = Shell.filterShellSearchResults(Shell.buildShellSearchIndex(fixture), "plan-17");
  const routed = [];
  const outcome = Shell.runShellSearchInteraction({
    key: "Enter", activeIndex: 0, results, data: fixture,
    onSelect: (row) => routed.push(["select", row.id]),
    onNavigate: (route, row) => routed.push(["navigate", route, row.id]),
    onClose: () => routed.push(["close"])
  });
  assert.equal(outcome.selectIndex, 0);
  assert.deepEqual(routed, [["select", "plan-17"], ["navigate", "signalHub", "plan-17"], ["close"]]);
});

test("desktop Object Switcher overlay matches the immutable prototype geometry and interaction state", () => {
  const overlay = finalDeclarations(".commandRail__results");
  assert.equal(overlay.position, "fixed");
  assert.equal(overlay.top, "var(--kordyn-command-rail)");
  assert.equal(overlay.left, "var(--kordyn-workspace-rail)");
  assert.equal(overlay.width, "min(620px, calc(100vw - var(--kordyn-workspace-rail) - 24px))");
  assert.equal(overlay["max-height"], "520px");
  assert.equal(overlay["border-top"], "0");
  assert.equal(overlay["box-shadow"], "8px 8px 0 var(--kordyn-ink)");
  for (const selector of [
    ".commandRail__results > button.active",
    ".commandRail__results > button:hover",
    ".commandRail__results > button:focus-visible"
  ]) {
    const state = finalDeclarations(selector);
    assert.equal(state.background, "var(--kordyn-acid)");
    assert.equal(state.color, "var(--kordyn-ink)");
  }
});

test("context and trace projections remain factual and label unknown truth unavailable", () => {
  assert.equal(typeof Shell.buildShellContext, "function");
  assert.equal(typeof Shell.buildShellTrace, "function");
  const context = Shell.buildShellContext({ data: fixture, workspaceId: "live", selectedObject: Shell.buildShellSearchIndex(fixture).find((row) => row.id === "plan-17") });
  assert.equal(context.object, "plan-17");
  assert.equal(context.version, "4");
  assert.equal(context.permissions, "confirm_each");
  const absent = Shell.buildShellContext({ data: {}, workspaceId: "operations" });
  assert.equal(absent.evidence, "Unavailable");
  assert.notEqual(absent.evidence, "0");
  assert.equal(context.objectStatus, "armed");
  assert.equal(context.sourceState, "loaded");
  assert.match(renderToString(React.createElement(Shell.ContextDock, { context })), /Trade plan \/ plan-17/, "Context renders the selected typed identity, not an untyped ID");
  const trace = Shell.buildShellTrace(fixture, "live", Shell.buildShellSearchIndex(fixture).find((row) => row.id === "plan-17"));
  assert.deepEqual(trace.map((stage) => stage.label), ["Sense", "Recall", "Plan", "Guard", "Execute", "Monitor", "Review"]);
  assert.ok(trace.every((stage) => ["complete", "waiting", "blocked", "unavailable"].includes(stage.status)));
  assert.equal(trace.find((stage) => stage.label === "Guard").status, "blocked");
});

test("trace completion requires explicit evidence scoped to workspace and selected object or run", () => {
  const scopedData = {
    resourceState: { chat: "loaded", cockpit: "loaded", researchCenter: "loaded" },
    markets: [{ symbol: "BTC/USDT" }],
    tradePlans: [{ id: "plan-live" }],
    reviews: [{ id: "review-lab" }],
    traces: [
      { evidenceId: "ai-sense", workspaceId: "ai", objectId: "ai-run", stage: "sense", status: "complete" },
      { evidenceId: "live-plan", workspaceId: "live", objectId: "plan-live", stage: "plan", status: "complete" },
      { evidenceId: "live-execute", workspaceId: "live", agentRunId: "run-live", stage: "execute", status: "complete" },
      { evidenceId: "lab-guard", workspaceId: "lab", objectId: "review-lab", stage: "guard", status: "blocked" }
    ]
  };
  const liveWrongObject = Shell.buildShellTrace(scopedData, "live", { id: "other-plan", workspaceId: "live" });
  assert.equal(liveWrongObject.find((stage) => stage.id === "sense").status, "waiting", "a non-empty market collection is not completion evidence");
  assert.equal(liveWrongObject.find((stage) => stage.id === "plan").status, "waiting", "another object's complete trace must not leak");
  assert.notEqual(liveWrongObject.find((stage) => stage.id === "guard").status, "blocked", "another workspace's block must not leak");

  const liveSelected = Shell.buildShellTrace(scopedData, "live", { id: "plan-live", workspaceId: "live", raw: { agentRunId: "run-live" } });
  assert.equal(liveSelected.find((stage) => stage.id === "plan").status, "complete");
  assert.equal(liveSelected.find((stage) => stage.id === "plan").evidence, "live-plan");
  assert.equal(liveSelected.find((stage) => stage.id === "execute").status, "complete", "an explicit selected agent run is valid scoped evidence");

  const missing = Shell.buildShellTrace({ resourceState: { operationsCenter: "loaded" } }, "operations", null);
  assert.ok(missing.every((stage) => stage.status !== "complete"));
  assert.ok(missing.some((stage) => stage.status === "unavailable"));
  const aiContext = Shell.buildShellContext({ data: { resourceState: { chat: "loaded" }, traces: [{ id: "live-only", workspaceId: "live", objectId: "plan-live" }] }, workspaceId: "ai" });
  assert.equal(aiContext.evidence, "Unavailable", "Context must not borrow evidence from another workspace");
});

test("trace identity matching rejects related-ID collisions and cross-typed runs", () => {
  const selected = {
    id: "plan-a",
    workspaceId: "live",
    raw: {
      mandateId: "mandate-shared",
      strategyId: "strategy-shared",
      runId: "run-a",
      agentRunId: "agent-run-a"
    }
  };
  const data = {
    resourceState: { cockpit: "loaded" },
    tradePlans: [{ id: "plan-a" }],
    traces: [
      { id: "plan-b", workspaceId: "live", mandateId: "mandate-shared", stage: "plan", status: "complete" },
      { objectId: "plan-b", workspaceId: "live", strategyId: "strategy-shared", stage: "guard", status: "blocked" },
      { objectId: "plan-a", evidenceId: "object-evidence", workspaceId: "live", stage: "sense", status: "complete" },
      { runId: "run-a", evidenceId: "run-evidence", workspaceId: "live", stage: "execute", status: "complete" },
      { agentRunId: "agent-run-a", evidenceId: "agent-run-evidence", workspaceId: "live", stage: "monitor", status: "complete" },
      { agentRunId: "run-a", evidenceId: "cross-typed-run", workspaceId: "live", stage: "review", status: "complete" }
    ]
  };

  const trace = Shell.buildShellTrace(data, "live", selected);
  assert.equal(trace.find((stage) => stage.id === "plan").status, "waiting", "a shared mandate cannot override a conflicting primary id");
  assert.notEqual(trace.find((stage) => stage.id === "guard").status, "blocked", "a shared strategy cannot override a conflicting objectId");
  assert.equal(trace.find((stage) => stage.id === "sense").evidence, "object-evidence", "the same primary object type matches");
  assert.equal(trace.find((stage) => stage.id === "execute").evidence, "run-evidence", "the same runId type matches");
  assert.equal(trace.find((stage) => stage.id === "monitor").evidence, "agent-run-evidence", "the same agentRunId type matches");
  assert.notEqual(trace.find((stage) => stage.id === "review").status, "complete", "runId cannot match agentRunId by value alone");
});

test("search and context keep object status separate from source state and gate unsafe actions", () => {
  assert.equal(typeof Shell.selectionForNavigation, "function");
  const data = {
    resourceState: { cockpit: "stale", researchCenter: "error" },
    positions: [{ id: "position-1", symbol: "BTC/USDT", status: "open", permission: "trade:read", stale: true }],
    reviews: [{ id: "review-1", title: "Review", status: "pending", forbidden: "owner" }]
  };
  const index = Shell.buildShellSearchIndex(data);
  const position = index.find((row) => row.id === "position-1");
  assert.equal(position.status, "open");
  assert.equal(position.sourceState, "stale");
  assert.equal(position.sourceStale, true);
  assert.equal(position.permission, "trade:read");
  const context = Shell.buildShellContext({ data, workspaceId: "live", selectedObject: position });
  assert.equal(context.objectStatus, "open");
  assert.equal(context.sourceState, "stale");
  assert.equal(context.gate.kind, "stale");
  assert.equal(context.actionsDisabled, true);
  assert.equal(Shell.selectionForNavigation(position, "lab"), null, "central navigation clears a selection from another workspace");
  assert.equal(Shell.selectionForNavigation(position, "live"), null, "a stale same-workspace selection fails closed");
  const forbidden = index.find((row) => row.id === "review-1");
  assert.equal(forbidden.sourceForbidden, "owner");
  assert.equal(Shell.selectionForNavigation(forbidden, "lab"), null, "forbidden selections fail closed");

  const html = renderToString(React.createElement(Shell.ContextDock, { context }));
  assert.match(html, /Data is stale|数据已陈旧/);
  assert.match(html, /disabled=""/);
});

test("selection revalidation uses the current production index and forbidden resource truth", () => {
  const initialData = {
    resourceState: { cockpit: "loaded" },
    positions: [{ id: "position-current", symbol: "ETH/USDT", status: "open", permission: "trade:read" }]
  };
  const selected = Shell.buildShellSearchIndex(initialData).find((row) => row.id === "position-current");
  const refreshedData = {
    resourceState: { cockpit: "loaded" },
    positions: [{ id: "position-current", symbol: "ETH/USDT", status: "closed", permission: "trade:read" }]
  };
  const refreshed = Shell.selectionForNavigation(selected, "live", refreshedData);
  assert.equal(refreshed.status, "closed", "revalidation returns the current indexed object, not the stale snapshot");

  assert.equal(Shell.selectionForNavigation(selected, "live", { resourceState: { cockpit: "loaded" }, positions: [] }), null, "a disappearing same-workspace object is cleared");
  assert.equal(Shell.selectionForNavigation(selected, "live", {
    resourceState: { cockpit: "loaded" },
    tradePlans: [{ id: "position-current", title: "Wrong object type" }]
  }), null, "an id collision from a different production source cannot validate the selection");
  assert.equal(Shell.selectionForNavigation(selected, "live", {
    resourceState: { cockpit: "loaded" },
    positions: [{ id: "position-current", symbol: "ETH/USDT", permissionDenied: true }]
  }), null, "a current permission denial clears the selection");

  const forbiddenData = {
    resourceState: { cockpit: "forbidden" },
    positions: [{ id: "position-current", symbol: "ETH/USDT", status: "open", permission: "trade:read" }]
  };
  const forbidden = Shell.buildShellSearchIndex(forbiddenData).find((row) => row.id === "position-current");
  const context = Shell.buildShellContext({ data: forbiddenData, workspaceId: "live", selectedObject: forbidden });
  assert.equal(forbidden.sourceForbidden, "forbidden");
  assert.equal(context.gate.kind, "forbidden");
  assert.equal(context.actionsDisabled, true);
  assert.equal(Shell.selectionForNavigation(selected, "live", forbiddenData), null, "forbidden resourceState fails closed during revalidation");
  const html = renderToString(React.createElement(Shell.ContextDock, { context }));
  assert.match(html, /Permission denied|权限不足/);
  assert.match(html, /disabled=""/);
});

test("command facts model freshness and latency independently", () => {
  assert.equal(typeof Shell.buildCommandFacts, "function");
  const facts = Shell.buildCommandFacts({ system: { dataFreshnessMs: 380, dataFreshnessState: "fresh", latencyMs: 24 } });
  assert.deepEqual(facts.freshness, { label: "FRESHNESS", value: "fresh · 380 ms", state: "fresh" });
  assert.deepEqual(facts.latency, { label: "LATENCY", value: "24 ms", state: "available" });
  const stale = Shell.buildCommandFacts({ system: { dataFreshnessMs: 90_000, dataFreshnessState: "stale" } });
  assert.equal(stale.freshness.value, "stale · 90000 ms");
  assert.equal(stale.latency.value, "Unavailable");
  assert.doesNotMatch(stale.latency.value, /90000/);
  const ageOnly = Shell.buildCommandFacts({ system: { dataFreshnessMs: 380 } });
  assert.deepEqual(ageOnly.freshness, { label: "FRESHNESS", value: "380 ms", state: "available" });
  const html = renderToString(React.createElement(Shell.CommandRail, { data: fixture }));
  assert.match(html, /FRESHNESS[\s\S]*fresh · 380 ms[\s\S]*LATENCY[\s\S]*24 ms/);
});

test("touch shell exposes persistent Context and Trace bounded sheets", () => {
  assert.equal(typeof Mobile.MobileShellTools, "function");
  const tools = renderToString(React.createElement(Mobile.MobileShellTools, { data: fixture, workspaceId: "live", onNavigate: () => {} }));
  assert.match(tools, /data-shell-role="mobile-context-trace"/);
  assert.match(tools, />Context</);
  assert.match(tools, />Trace</);
  assert.match(tools, />Objects</);
  const switcher = renderToString(React.createElement(Mobile.MobileShellTools, {
    data: fixture,
    workspaceId: "operations",
    selectedObject: Shell.resolveShellObjectSelection(fixture, { id: "task-9", type: "Task" }, "operations"),
    onSelect: () => {},
    onNavigate: () => {},
    initiallyOpen: "objects"
  }));
  assert.match(switcher, /data-shell-role="mobile-object-switcher"/);
  assert.match(switcher, /role="searchbox"/);
  assert.match(switcher, /data-shell-object-id="task-9"/);
  assert.match(switcher, /aria-current="true"/);
  assert.match(styles, /\.mShellToolButton[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.mShellSheet[^}]*width:\s*100%[^}]*border-radius:\s*0/s);
  const objectResult = finalDeclarations(".mObjectSwitcher__result");
  assert.equal(objectResult["min-height"], "44px");
  assert.equal(objectResult["border-radius"], "0");
  assert.equal(objectResult["border-bottom"], "1px solid var(--kordyn-line)");
  const mobile = renderToString(React.createElement(Mobile.MobileApp, { api: { data: fixture, action: () => {}, notify: () => {}, refresh: () => {}, ensureSection: () => {} } }));
  assert.match(mobile, /data-shell-selected-object="none"/);
  assert.match(mobile, />05<[^]*?>更多<|>05<[^]*?>More</);
});

test("mobile fixed rows preserve safe areas and every shell target remains at least 44px", () => {
  assert.match(styles, /\.mShell2\.kordynSystem\s*\{[^}]*grid-template-rows:[^;}]*safe-area-inset-top[^;}]*minmax\(0,1fr\)[^;}]*44px[^;}]*safe-area-inset-bottom/s);
  assert.match(styles, /\.mShell2\.kordynSystem\s*>\s*\.mHeader2\s*\{[^}]*padding-top:[^;}]*safe-area-inset-top/s);
  assert.match(styles, /\.mShell2\.kordynSystem\s*>\s*\.mNativeTabbar\s*\{[^}]*padding-bottom:[^;}]*safe-area-inset-bottom/s);
  for (const selector of [".mShellToolButton", ".mShell2.kordynSystem > .mNativeTabbar > button", ".mShell2.kordynSystem > .mHeader2 :is(.mMenuBtn,.mBack,.mRuntimeButton)"]) {
    const rule = postcss.parse(styles).nodes.flatMap((node) => node.type === "rule" && node.selectors.includes(selector) ? [node] : [] ).at(-1);
    assert.ok(rule, selector);
    const minimum = rule.nodes.find((node) => node.prop === "min-height")?.value;
    assert.match(minimum || "", /44px/);
  }
});

test("1440 command rail keeps every required fact and danger label visible with deterministic width budget", () => {
  assert.doesNotMatch(styles, /@media\s*\(max-width:\s*1480px\)[^{]*\{[^}]*\.commandRail__facts\s*\{\s*display:\s*none/s);
  assert.doesNotMatch(styles, /@media\s*\(max-width:\s*1480px\)[^{]*\{[^}]*\.topEmergencyActions\s+span\s*\{\s*display:\s*none/s);
  const shell = postcss.parse(styles);
  const declarations = (selector) => {
    const values = {};
    shell.walkRules((rule) => {
      const insideMedia = rule.parent?.type === "atrule" && rule.parent.name === "media";
      if (!insideMedia && rule.selectors.includes(selector)) rule.walkDecls((decl) => { values[decl.prop] = `${decl.value}${decl.important ? " !important" : ""}`; });
    });
    return values;
  };
  const emergency = declarations(".appShell.kordynSystem > .appTopbar .topEmergencyActions > button");
  assert.equal(emergency.height, "100% !important");
  assert.equal(emergency["min-height"], "0 !important");
  assert.equal(emergency["border-radius"], "0 !important");
  const status = declarations(".appShell.kordynSystem > .appTopbar .topbarStatusGroup");
  assert.equal(status["flex-wrap"], "nowrap");
  const command = declarations(".commandRail");
  const brand = declarations(".commandRail__brand");
  const search = declarations(".commandRail__search");
  const facts = declarations(".commandRail__facts");
  const actions = declarations(".appShell.kordynSystem > .appTopbar .topbarActions");
  const emergencyGroup = declarations(".appShell.kordynSystem > .appTopbar .topEmergencyActions");
  assert.equal(command.flex, "1 1 auto");
  assert.equal(command["min-width"], "0");
  assert.equal(brand.flex, "0 0 var(--kordyn-workspace-rail)");
  assert.equal(search.flex, "1 1 auto");
  assert.equal(search["min-width"], "220px");
  assert.equal(facts["grid-template-columns"], "repeat(5, minmax(50px, 1fr))");
  assert.equal(facts.flex, "0 0 286px");
  assert.equal(status.flex, "0 0 264px");
  assert.equal(actions.flex, "0 0 138px");
  assert.equal(emergencyGroup.flex, "0 0 144px");
  assert.equal(emergencyGroup["min-width"], "0");
  const minimumRequiredWidth = 188 + 220 + 286 + 264 + 138 + 144;
  assert.equal(minimumRequiredWidth, 1240);
  assert.ok(minimumRequiredWidth <= 1440, "effective flex bases and minimums fit the exact 1440 command rail");
});

test("measured Command Rail internals contain their real labels at 1440 and 1180", () => {
  const status = finalDeclarations(".appShell.kordynSystem > .appTopbar .topbarStatusGroup");
  assert.equal(status.display, "grid");
  assert.equal(status["grid-template-columns"], "minmax(0, 92px) minmax(0, 172px)");
  assert.equal(status.overflow, "hidden");
  for (const selector of [
    ".appShell.kordynSystem > .appTopbar .exchangePill",
    ".appShell.kordynSystem > .appTopbar .runtimeStatePill"
  ]) {
    const declarations = finalDeclarations(selector);
    assert.equal(declarations["min-width"], "0", `${selector} must be shrinkable inside the measured 264px status group`);
    assert.equal(declarations.overflow, "hidden", `${selector} must contain its production label`);
  }
  const exchange = finalDeclarations(".appShell.kordynSystem > .appTopbar .exchangePill");
  assert.equal(exchange.display, "grid");
  assert.equal(exchange["grid-template-columns"], "8px minmax(0, 1fr)");
  const exchangeDot = finalDeclarations(".appShell.kordynSystem > .appTopbar .exchangePill > i");
  assert.equal(exchangeDot["grid-row"], "1 / span 2", "the real exchange and connection labels stack without clipping");
  const notificationCount = finalDeclarations(".appShell.kordynSystem > .appTopbar .bellButton b");
  assert.equal(notificationCount.top, "4px");
  assert.equal(notificationCount.right, "4px", "the real unread count stays inside the 64px Command Rail");
  const mediumSearch = finalDeclarations(".commandRail__search", { media: /max-width:\s*1280px.*min-width:\s*721px/ });
  assert.equal(mediumSearch["min-width"], "156px", "188 + 156 + 286 fits the measured 633px medium Command Rail");
});

test("mobile AI truth cells and task suggestions cannot exceed the exact touch viewport", () => {
  const content = finalDeclarations(".mShell2.kordynSystem .mChatContent");
  assert.equal(content["min-width"], "0");
  assert.equal(content.width, "100%");
  const status = finalDeclarations(".mShell2.kordynSystem .mChatStatus.kTruthBand");
  assert.equal(status["min-width"], "0");
  assert.equal(status.overflow, "hidden");
  const cell = finalDeclarations(".mShell2.kordynSystem .mChatStatCell");
  assert.equal(cell["min-width"], "0");
  const value = finalDeclarations(".mShell2.kordynSystem .mChatStatCell b");
  assert.equal(value["overflow-wrap"], "anywhere");
  assert.equal(value["white-space"], "normal");
  const suggestion = finalDeclarations(".mShell2.kordynSystem .examplePrompts button");
  assert.equal(suggestion["border-radius"], "0");
});

test("mobile intelligence presents real long and stale evidence as a truth band plus continuous ledger", () => {
  const html = renderToString(React.createElement(Mobile.MobileIntelligence, {
    data: fixture,
    action: async () => ({ ok: true }),
    ui: { setActive: () => {} }
  }));
  assert.match(html, /class="mPageStats kTruthBand"/, "the production intelligence KPIs are authoritative facts, not floating cards");
  const constraint = finalDeclarations(".mShell2.kordynSystem .mIntelConstraint");
  assert.equal(constraint["border-radius"], "0");
  const feed = finalDeclarations(".mShell2.kordynSystem .mIntelFeed.mEvidenceLedger");
  assert.equal(feed.gap, "0");
  assert.equal(feed.padding, "0");
  const row = finalDeclarations(".mShell2.kordynSystem .mIntelFeed.mEvidenceLedger > article");
  assert.equal(row["border-radius"], "0");
  assert.equal(row.border, "0");
  assert.equal(row["border-bottom"], "1px solid var(--kordyn-line)");
});

test("audited non-semantic desktop and APP surfaces do not retain legacy rounding", () => {
  for (const selector of [
    ".appShell.kordynSystem .chatKpi",
    ".appShell.kordynSystem .cp2CandleBox",
    ".appShell.kordynSystem .chartEmpty.tvOverlay",
    ".appShell.kordynSystem .productSettings .configurationTruth .cp2OverviewHealth",
    ".mShell2.kordynSystem .mKline.tv",
    ".mShell2.kordynSystem .chartEmpty.tvOverlay",
    ".mShell2.kordynSystem .mLangSeg",
    ".mShell2.kordynSystem .mLangSeg button",
    ".mShell2.kordynSystem .mSafetyTarget",
    ".mShell2.kordynSystem .mSafetyReason"
  ]) assert.equal(finalDeclarations(selector)["border-radius"], "0", `${selector} is a bounded product surface, not a semantic circle`);
});

test("AI workbenches use continuous hard edges and long real intel rows own their height", () => {
  const shell = finalDeclarations(".appShell.kordynSystem .chatShell");
  assert.equal(shell.gap, "0");
  assert.equal(shell.border, "1px solid var(--kordyn-ink)");
  assert.equal(shell.overflow, "hidden");
  for (const selector of [
    ".appShell.kordynSystem .agRail > .agCard",
    ".appShell.kordynSystem .agPlan",
    ".appShell.kordynSystem .agInputBar"
  ]) assert.equal(finalDeclarations(selector)["border-radius"], "0", `${selector} must not retain legacy card rounding`);
  for (const selector of [
    ".appShell.kordynSystem .chatShell .agChat",
    ".appShell.kordynSystem .agRail"
  ]) assert.equal(finalDeclarations(selector)["border-radius"], "0 !important", `${selector} must override the legacy concept workbench !important radius`);
  const intelRow = finalDeclarations(".kordynSystem .cp2IntelList.kRegistry > button");
  assert.equal(intelRow.flex, "0 0 auto", "a real multi-line item cannot shrink to the 64px minimum");
  assert.equal(intelRow.height, "auto");
  assert.equal(intelRow.overflow, "hidden");
  const intelText = finalDeclarations(".kordynSystem .cp2IntelList.kRegistry > button > div");
  assert.equal(intelText["min-width"], "0");
  assert.equal(intelText.overflow, "hidden");
  assert.equal(intelText["overflow-wrap"], "anywhere");
});

test("desktop AI keeps all five real KPI facts simultaneously visible at 1440", () => {
  const html = renderToString(React.createElement(Chat.ChatKpiStrip, { data: fixture, bar: true }));
  assert.equal((html.match(/class="chatKpi"/g) || []).length, 5, "the real KPI component owns five facts");
  for (const label of ["总资产", "持仓风险", "今日盈亏", "累计盈亏", "BTC/USDT"]) assert.match(html, new RegExp(label));
  for (const index of [4, 5]) {
    const declarations = finalDeclarations(`.appShell.kordynSystem .chatKpiBar .chatKpi:nth-child(${index})`, { media: /max-width:\s*1600px.*min-width:\s*721px/ });
    assert.notEqual(declarations.display, "none", `KPI ${index} cannot be removed at the exact 1440 viewport`);
  }
  const bar = finalDeclarations(".appShell.kordynSystem .chatKpiBar", { media: /max-width:\s*1600px.*min-width:\s*721px/ });
  assert.equal(bar.display, "grid");
  assert.equal(bar["grid-template-columns"], "repeat(5, minmax(0, 1fr))");
});

test("medium Context-open layout reserves a contained row for AI KPIs and actions", () => {
  const selector = ".appShell.kordynSystem:has(> .contextDock:not(.collapsed)) .uxCenterHead";
  const head = finalDeclarations(selector, { media: /max-width:\s*1280px.*min-width:\s*721px/ });
  assert.equal(head.width, "calc(100% - var(--kordyn-context-dock))");
  assert.equal(head["flex-wrap"], "wrap");

  const extra = finalDeclarations(`${selector} .uxHeadExtra`, { media: /max-width:\s*1280px.*min-width:\s*721px/ });
  assert.equal(extra.flex, "0 0 100%");
  assert.equal(extra["max-width"], "100%");

  const viewportWidth = 1180;
  const workspaceRailWidth = 188;
  const contentInlinePadding = 16 * 2;
  const contextDockWidth = 304;
  const headWidth = viewportWidth - workspaceRailWidth - contentInlinePadding - contextDockWidth;
  const headRight = workspaceRailWidth + 16 + headWidth;
  const contextLeft = viewportWidth - contextDockWidth;
  assert.equal(headWidth, 656, "the medium header receives the real center width minus the open Context dock");
  assert.ok(headRight < contextLeft, `header right ${headRight} must stay before Context left ${contextLeft}`);
  assert.equal(contextLeft - headRight, 16, "the contained row keeps the content gutter before Context");

  const cluster = finalDeclarations(".appShell.kordynSystem .aiTopCluster", { media: /max-width:\s*1600px.*min-width:\s*721px/ });
  assert.equal(cluster["grid-template-columns"], "minmax(0,1fr) auto", "KPI facts share the row with the real action group");
  const bar = finalDeclarations(".appShell.kordynSystem .chatKpiBar", { media: /max-width:\s*1600px.*min-width:\s*721px/ });
  assert.equal(bar["grid-template-columns"], "repeat(5, minmax(0, 1fr))", "the KPI share retains all five equal factual columns");
});

test("audited mobile Live Intelligence and Event Calendar operation chrome is hard edged", () => {
  const selectors = [
    ".mShell2.kordynSystem .mSymPills",
    ".mShell2.kordynSystem .mTfPills",
    ".mShell2.kordynSystem .mSymPills button",
    ".mShell2.kordynSystem .mTfPills button",
    ".mShell2.kordynSystem .mIntelHero.kTruthBand > button",
    ".mShell2.kordynSystem .mIntelPage .statusBadge",
    ".mShell2.kordynSystem .mEventCalendar",
    ".mShell2.kordynSystem .mEventCalendar > header > button",
    ".mShell2.kordynSystem .mEventDays button",
    ".mShell2.kordynSystem .mEventAgenda"
  ];
  for (const selector of selectors) {
    assert.equal(finalDeclarations(selector)["border-radius"], "0", `${selector} is operation chrome, not a semantic circle`);
  }
  for (const selector of [
    ".mShell2.kordynSystem .mSymPills",
    ".mShell2.kordynSystem .mTfPills",
    ".mShell2.kordynSystem .mEventCalendar",
    ".mShell2.kordynSystem .mEventCalendar > header > button",
    ".mShell2.kordynSystem .mEventDays button"
  ]) assert.match(finalDeclarations(selector).border || "", /^1px\s+solid\s+/, `${selector} needs the prototype 1px boundary`);
});

test("desktop expanded Trace is a full stage surface with real stage detail", () => {
  const stages = Shell.buildShellTrace(fixture, "live", { id: "plan-17", workspaceId: "live" });
  const html = renderToString(React.createElement(Shell.TraceRail, { stages, initiallyExpanded: "sense" }));
  assert.match(html, /class="traceRail expanded"/);
  assert.match(html, /class="traceRail__title"/);
  assert.match(html, /class="traceRail__object(?:\s[^" ]+)*"/);
  assert.match(html, /TRACE DETAIL[\s\S]*STATUS[\s\S]*EVIDENCE[\s\S]*DETAIL/);
  for (const stage of stages) assert.match(html, new RegExp(stage.detail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const expanded = finalDeclarations(".traceRail.expanded");
  assert.equal(expanded.position, "fixed");
  assert.equal(expanded.inset, "var(--kordyn-command-rail) 0 0");
  assert.equal(expanded["grid-template-columns"], "var(--kordyn-workspace-rail) minmax(0, 1fr) var(--kordyn-context-dock)");
  const expandedStages = finalDeclarations(".traceRail.expanded > nav");
  assert.equal(expandedStages["grid-template-columns"], "repeat(7, minmax(0, 1fr))");
  const detail = finalDeclarations(".traceRail.expanded .traceRail__detail");
  assert.equal(detail.background, "var(--kordyn-dark)");
  assert.equal(detail.color, "var(--kordyn-paper)");
  const detailRows = finalDeclarations(".traceRail.expanded .traceRail__detail dl > div");
  assert.match(detailRows["border-bottom"] || "", /^1px\s+solid\s+color-mix\(/);
});

test("final imported mobile cascade keeps Operations and Configuration in one readable column", () => {
  const operationsHtml = renderToString(React.createElement(MobileOperations.MobileOperations, {
    data: fixture,
    action: () => {},
    ui: { setActive: () => {}, download: () => {} }
  }));
  assert.match(operationsHtml, /class="mOperationsCommand kWorkbench"/);
  const configurationHtml = renderToString(React.createElement(Mobile.MobileSettingsIndex, {
    data: fixture,
    ui: { ensureSection: () => {} },
    onOpen: () => {}
  }));
  assert.match(configurationHtml, /class="mConfigurationTruth kTruthBand"/);
  const foundationAst = postcss.parse(foundation);
  const mobileDeclarations = (selector) => {
    const values = {};
    foundationAst.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return;
      const media = rule.parent?.type === "atrule" && rule.parent.name === "media" ? rule.parent.params : "";
      if (!/max-width:\s*900px/.test(media)) return;
      rule.walkDecls((decl) => { values[decl.prop] = `${decl.value}${decl.important ? " !important" : ""}`; });
    });
    return values;
  };
  assert.equal(mobileDeclarations(".mShell2.kordynSystem .mOperationsCommand.kWorkbench")["grid-template-columns"], "minmax(0, 1fr)");
  assert.equal(mobileDeclarations(".mShell2.kordynSystem .mConfigurationTruth.kTruthBand")["grid-template-columns"], "minmax(0, 1fr)");
});

test("desktop Events safely reduces source HTML to readable text without rendering markup", () => {
  assert.equal(typeof Concepts.normalizeSourceDisplayText, "function");
  const raw = '<a target="_blank" href="https://example.test/story">Verified headline</a>&nbsp; with &ldquo;quoted&rdquo; detail &middot; source';
  assert.equal(Concepts.normalizeSourceDisplayText(raw), 'Verified headline with “quoted” detail · source');
  const html = renderToString(React.createElement(Concepts.EventsConcept, {
    data: { ...fixture, dailyMarketBrief: { version: 1, topNews: [{ factId: "fact-1", title: "Headline", summary: raw }] } },
    action: () => {},
    ui: { setActive: () => {}, notify: () => {} }
  }));
  assert.doesNotMatch(html, /&lt;a target=/);
  assert.match(html, /Verified headline with “quoted” detail · source/);
});

test("mobile Safety and shared ConfirmHost controls win the late hard-edge cascade", () => {
  const shell = postcss.parse(styles);
  const declarations = (selector) => {
    const values = {};
    shell.walkRules((rule) => { if (rule.selectors.includes(selector)) rule.walkDecls((decl) => { values[decl.prop] = `${decl.value}${decl.important ? " !important" : ""}`; }); });
    return values;
  };
  const sheet = declarations(".mShell2.kordynSystem .mSafetySheet");
  assert.equal(sheet["border-radius"], "0 !important");
  assert.match(sheet["box-shadow"] || "", /var\(--kordyn-acid\)/);
  const actions = declarations(".mShell2.kordynSystem .mSafetyActions button");
  assert.equal(actions["border-radius"], "0 !important");
  assert.equal(actions["border"], "1px solid var(--kordyn-ink) !important");
  const kill = renderToString(React.createElement(Mobile.KillConfirmDialog, { enable: true, action: async () => ({ ok: true }), onClose: () => {} }));
  const reset = renderToString(React.createElement(Mobile.KillConfirmDialog, { enable: false, action: async () => ({ ok: true }), onClose: () => {} }));
  assert.match(kill, /confirmDialog danger/);
  assert.doesNotMatch(reset, /confirmDialog danger/);
  assert.match(styles, /\.cfmInput,\s*\.cfmBtn\s*\{[^}]*border-radius:\s*0/);
});

test("ordinary and destructive modal shells use the prototype hard-edge offsets", () => {
  assert.match(styles, /\.kordynSystem\s+\.cfmCard(?:--ordinary)?[^}]*border:\s*1px solid var\(--kordyn-ink\)[^}]*border-radius:\s*0[^}]*box-shadow:\s*10px 10px 0 var\(--kordyn-acid\)/s);
  assert.match(styles, /\.kordynSystem\s+\.cfmCard--danger[^}]*box-shadow:\s*10px 10px 0 var\(--kordyn-danger\)/s);
  assert.match(styles, /\.kordynSystem\s+\.confirmDialog\.danger[^}]*box-shadow:\s*10px 10px 0 var\(--kordyn-danger\)/s);
  assert.match(styles, /background:\s*rgba\(17,\s*21,\s*17,\s*\.78\)/);
});

test("login and marketing source remains byte-identical to the task base", () => {
  const base = execFileSync("git", ["show", "94d79ea07a2a20ac568ec8380baa1b439081b018:src/landing.jsx"], { cwd: rootDir, encoding: "utf8" });
  const current = fs.readFileSync(path.join(rootDir, "src/landing.jsx"), "utf8");
  assert.equal(current, base);
  assert.equal(fs.readFileSync(path.join(rootDir, "public/landing.html"), "utf8"), execFileSync("git", ["show", "94d79ea07a2a20ac568ec8380baa1b439081b018:public/landing.html"], { cwd: rootDir, encoding: "utf8" }));
});
