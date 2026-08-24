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
  system: { mode: "confirm_each", killSwitch: false, dataFreshnessMs: 380 },
  markets: [{ symbol: "BTC/USDT", price: 64250, status: "fresh", updatedAt: "2026-08-24T08:00:00Z" }],
  tradePlans: [{ id: "plan-17", symbol: "ETH/USDT", status: "armed", version: 4, source: "agent", permission: "confirm_each" }],
  tasks: [{ id: "task-9", title: "Reconcile fills", status: "waiting", type: "reconciliation" }],
  mandates: [{ id: "mandate-main", name: "Owner mandate", status: "active", version: 3 }],
  knowledge: { sources: [{ id: "kb-2", title: "Breakout playbook", status: "published", version: 2 }] },
  traces: [{ id: "trace-8", stage: "guard", status: "blocked", detail: "Permission confirmation is required", createdAt: "2026-08-24T08:01:00Z" }],
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
  const trace = Shell.buildShellTrace(fixture, "live");
  assert.deepEqual(trace.map((stage) => stage.label), ["Sense", "Recall", "Plan", "Guard", "Execute", "Monitor", "Review"]);
  assert.ok(trace.every((stage) => ["complete", "waiting", "blocked", "unavailable"].includes(stage.status)));
  assert.equal(trace.find((stage) => stage.label === "Guard").status, "blocked");
});

test("touch shell exposes persistent Context and Trace bounded sheets", () => {
  assert.equal(typeof Mobile.MobileShellTools, "function");
  const tools = renderToString(React.createElement(Mobile.MobileShellTools, { data: fixture, workspaceId: "live", onNavigate: () => {} }));
  assert.match(tools, /data-shell-role="mobile-context-trace"/);
  assert.match(tools, />Context</);
  assert.match(tools, />Trace</);
  assert.match(styles, /\.mShellToolButton[^}]*min-height:\s*44px/s);
  assert.match(styles, /\.mShellSheet[^}]*width:\s*100%[^}]*border-radius:\s*0/s);
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
