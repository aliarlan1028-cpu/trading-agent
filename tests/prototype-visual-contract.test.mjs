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
      export { ProductShell, Mobile };
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

const { ProductShell: Shell, Mobile } = require(outFile);
const foundation = fs.readFileSync(path.join(rootDir, "src/product-foundation.css"), "utf8");
const styles = fs.readFileSync(path.join(rootDir, "src/styles.css"), "utf8");

const fixture = {
  resourceState: { chat: "loaded", cockpit: "loaded", researchCenter: "loaded", riskCenter: "loaded", operationsCenter: "loaded" },
  system: { mode: "confirm_each", killSwitch: false, dataFreshnessMs: 380, latencyMs: 24, dataFreshnessState: "fresh" },
  markets: [{ symbol: "BTC/USDT", price: 64250, status: "fresh", updatedAt: "2026-08-24T08:00:00Z" }],
  tradePlans: [{ id: "plan-17", symbol: "ETH/USDT", status: "armed", version: 4, source: "agent", permission: "confirm_each" }],
  tasks: [{ id: "task-9", title: "Reconcile fills", status: "waiting", type: "reconciliation" }],
  mandates: [{ id: "mandate-main", name: "Owner mandate", status: "active", version: 3 }],
  knowledge: { sources: [{ id: "kb-2", title: "Breakout playbook", status: "published", version: 2 }] },
  traces: [{ id: "trace-8", workspaceId: "live", objectId: "plan-17", stage: "guard", status: "blocked", detail: "Permission confirmation is required", createdAt: "2026-08-24T08:01:00Z" }],
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
  for (const row of index) {
    for (const field of ["type", "title", "id", "status", "route"]) assert.equal(typeof row[field], "string", `${field} must be present`);
  }
  assert.doesNotMatch(JSON.stringify(index), /WATCH-2048|DEMO|mock/i);
  const results = Shell.filterShellSearchResults(index, "BTC");
  assert.equal(results[0].id, "BTC/USDT");
  assert.deepEqual(Shell.nextShellSearchInteraction({ key: "ArrowDown", activeIndex: 0, count: 3 }), { activeIndex: 1, close: false, selectIndex: -1 });
  assert.deepEqual(Shell.nextShellSearchInteraction({ key: "ArrowUp", activeIndex: 0, count: 3 }), { activeIndex: 2, close: false, selectIndex: -1 });
  assert.deepEqual(Shell.nextShellSearchInteraction({ key: "Enter", activeIndex: 1, count: 3 }), { activeIndex: 1, close: true, selectIndex: 1 });
  assert.deepEqual(Shell.nextShellSearchInteraction({ key: "Escape", activeIndex: 1, count: 3 }), { activeIndex: 1, close: true, selectIndex: -1 });
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
    key: "Enter", activeIndex: 0, results,
    onSelect: (row) => routed.push(["select", row.id]),
    onNavigate: (route, row) => routed.push(["navigate", route, row.id]),
    onClose: () => routed.push(["close"])
  });
  assert.equal(outcome.selectIndex, 0);
  assert.deepEqual(routed, [["select", "plan-17"], ["navigate", "signalHub", "plan-17"], ["close"]]);
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
      { id: "ai-sense", workspaceId: "ai", objectId: "ai-run", stage: "sense", status: "complete" },
      { id: "live-plan", workspaceId: "live", objectId: "plan-live", stage: "plan", status: "complete" },
      { id: "live-execute", workspaceId: "live", agentRunId: "run-live", stage: "execute", status: "complete" },
      { id: "lab-guard", workspaceId: "lab", objectId: "review-lab", stage: "guard", status: "blocked" }
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
  assert.equal(Shell.selectionForNavigation(position, "live"), position, "same-workspace selection remains valid");
  const forbidden = index.find((row) => row.id === "review-1");
  assert.equal(forbidden.sourceForbidden, "owner");
  assert.equal(Shell.selectionForNavigation(forbidden, "lab"), null, "forbidden selections fail closed");

  const html = renderToString(React.createElement(Shell.ContextDock, { context }));
  assert.match(html, /Data is stale|数据已陈旧/);
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
  assert.match(styles, /\.mShellToolButton[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.mShellSheet[^}]*width:\s*100%[^}]*border-radius:\s*0/s);
  const mobile = renderToString(React.createElement(Mobile.MobileApp, { api: { data: fixture, action: () => {}, notify: () => {}, refresh: () => {}, ensureSection: () => {} } }));
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
    shell.walkRules((rule) => { if (rule.selectors.includes(selector)) rule.walkDecls((decl) => { values[decl.prop] = `${decl.value}${decl.important ? " !important" : ""}`; }); });
    return values;
  };
  const emergency = declarations(".appShell.kordynSystem > .appTopbar .topEmergencyActions > button");
  assert.equal(emergency.height, "100% !important");
  assert.equal(emergency["min-height"], "0 !important");
  assert.equal(emergency["border-radius"], "0 !important");
  const status = declarations(".appShell.kordynSystem > .appTopbar .topbarStatusGroup");
  assert.equal(status["flex-wrap"], "nowrap");
  const budget = declarations(".appShell.kordynSystem > .appTopbar");
  assert.match(budget["--command-rail-wide-budget"] || "", /^\d+px$/);
  assert.ok(Number.parseInt(budget["--command-rail-wide-budget"], 10) <= 1440);
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
