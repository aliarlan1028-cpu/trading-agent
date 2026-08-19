# Kordyn Full UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the authenticated Kordyn interface with the approved “Precision Paper” responsive product system while preserving every existing function, safety boundary, permission, and real-data contract on desktop and mobile.

**Architecture:** Build one route manifest, one responsive application shell, shared presentation-neutral view models, and six isolated workspace modules. Migrate business UI from `conceptPages.jsx` and mobile-only UI from `mobile.jsx` into the shared modules, then remove the duplicate shells only after a route/function parity audit passes.

**Tech Stack:** React 18, Vite 6, JavaScript/JSX, CSS, Lucide React, Node.js test runner, React DOM server rendering, existing `useApi`/snapshot store and existing Express APIs.

**Spec:** `docs/superpowers/specs/2026-08-19-full-ui-ux-redesign-design.md`

## Global Constraints

- Do not change backend API, AI decision, opportunity engine, hard-risk, execution, authorization, or audit semantics.
- The pre-AI stage is labeled “Candidate Signal / 候选信号”; only AI review and the existing risk lifecycle may qualify a trade opportunity.
- Desktop and mobile must use the same route, component, data, permission, and action implementations.
- The mobile bottom navigation is AI, Trade, Research, Risk, More; More contains Ops and Settings.
- Use `#F4F1E9` canvas, `#111311` ink, and `#CCFF3D` accent; acid green is reserved for selection, authorization, and action-needed states.
- Do not use gradients, glassmorphism, decorative glow, or generic card walls.
- Keep 1px borders and 0–4px radii; shadows are limited to overlays and modals.
- Never show optimistic success for orders, Flatten All, Kill Switch, or security configuration changes.
- Preserve last known valid values for stale/degraded resources and show source plus freshness.
- Preserve both Chinese and English copy through `t(zh, en)`.
- Do not add a new runtime dependency; use the current React, Lucide, Vite, and Node test stack.
- The current workspace contains user-owned uncommitted changes. Never reset or stage them wholesale; every commit uses explicit path arguments.
- Do not deploy a partially migrated interface. The final cutover occurs only after Task 15 passes.

---

## File and Module Map

### Application and navigation

- `src/app/workspaceManifest.js`: canonical workspaces, pages, legacy-target mapping, permission metadata, persistence helpers, and API section mapping.
- `src/app/AuthenticatedApp.jsx`: authenticated route state, section loading, route persistence, and shared UI callbacks.
- `src/app/AppShell.jsx`: responsive top status bar, desktop rail, mobile bottom bar, page frame, overlays, toast, and busy state.
- `src/app/WorkspaceOutlet.jsx`: renders exactly one workspace from a normalized location.
- `src/app/GlobalSearch.jsx` and `src/app/globalSearchModel.js`: permission-filtered search UI and pure search indexing.
- `src/app/SafetyControls.jsx` and `src/app/safetyActions.js`: runtime state, structured confirmations, Flatten All, and Kill Switch request contracts.

### Shared UI

- `src/ui/design-system.css`: approved color, type, spacing, layout, state, responsive, focus, and reduced-motion rules.
- `src/ui/primitives.jsx`: page headers, status chips, metric strips, action panels, registries, evidence traces, permission states, and state boundaries.
- `src/ui/viewState.js`: pure resource-state normalization.

### Workspaces

- `src/workspaces/ai/`: dialog, intelligence, watch, and candidate-signal presentation.
- `src/workspaces/trading/`: overview, market, positions, execution, reviews, Owner optimization, orders, and fills.
- `src/workspaces/research/`: knowledge, strategy lifecycle, and capabilities.
- `src/workspaces/risk/`: posture, mandate, deterministic rules, and shared risk-form logic.
- `src/workspaces/ops/`: health, events, tasks, audit, notifications, and shared event-calendar logic.
- `src/workspaces/settings/`: service, security, exchange, notification, model, Agent, user, and subscription settings.

### Migration and validation

- `docs/ui-function-map.md`: old desktop/mobile entry to new route, permission, and acceptance-test matrix.
- `tests/workspace-navigation.test.mjs`: pure route and role tests.
- `tests/ui-foundation.test.mjs`: view-state and design-token tests.
- `tests/global-search.test.mjs`: search scope and permission tests.
- `tests/safety-actions.test.mjs`: exact high-risk request and result tests.
- `tests/render-smoke.test.mjs`: SSR coverage for every workspace, role, page, and critical state.
- `src/main.jsx`: authentication/data bootstrap only after extraction.
- `src/conceptPages.jsx`, `src/workspacePages.jsx`, `src/mobile.jsx`: removed only after all functional mappings pass.

---

### Task 1: Lock the Workspace and Function Contract

**Files:**
- Create: `src/app/workspaceManifest.js`
- Create: `tests/workspace-navigation.test.mjs`
- Create: `docs/ui-function-map.md`

**Interfaces:**
- Produces: `WORKSPACES`, `MOBILE_PRIMARY_WORKSPACES`, `defaultWorkspaceLocation(user)`, `normalizeWorkspaceLocation(location, user)`, `resolveWorkspaceTarget(target, user)`, `sectionForWorkspace(workspace)`, `readWorkspaceLocation(storage, user)`, and `writeWorkspaceLocation(storage, location)`.
- Location shape: `{ workspace: "ai" | "trading" | "research" | "risk" | "ops" | "settings", page: string, detailId?: string, denied?: boolean }`.

- [ ] **Step 1: Write failing navigation and permission tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACES, MOBILE_PRIMARY_WORKSPACES, defaultWorkspaceLocation,
  normalizeWorkspaceLocation, resolveWorkspaceTarget, sectionForWorkspace
} from "../src/app/workspaceManifest.js";

test("manifest exposes six workspaces and the approved mobile order", () => {
  assert.deepEqual(WORKSPACES.map((row) => row.id), ["ai", "trading", "research", "risk", "ops", "settings"]);
  assert.deepEqual(MOBILE_PRIMARY_WORKSPACES, ["ai", "trading", "research", "risk", "more"]);
});

test("first entry and legacy links preserve role and function", () => {
  assert.deepEqual(defaultWorkspaceLocation({ isOwner: false }), { workspace: "ai", page: "dialog" });
  assert.deepEqual(defaultWorkspaceLocation({ isOwner: true }), { workspace: "trading", page: "overview" });
  assert.deepEqual(resolveWorkspaceTarget("tradeLedger", { isOwner: false }), { workspace: "trading", page: "ledger" });
  assert.deepEqual(resolveWorkspaceTarget("riskMandate", { isOwner: false }), { workspace: "risk", page: "mandate" });
  assert.equal(sectionForWorkspace("ops"), "operationsCenter");
});

test("Owner-only pages remain discoverable but deny subscriber data", () => {
  const location = normalizeWorkspaceLocation({ workspace: "trading", page: "owner" }, { isOwner: false });
  assert.equal(location.denied, true);
  assert.equal(location.workspace, "trading");
  assert.equal(location.page, "owner");
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `node --test tests/workspace-navigation.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/app/workspaceManifest.js`.

- [ ] **Step 3: Implement the canonical manifest and legacy mapping**

```js
export const MOBILE_PRIMARY_WORKSPACES = ["ai", "trading", "research", "risk", "more"];

export const WORKSPACES = [
  { id: "ai", code: "01", label: ["AI 交易员", "AI Trader"], section: "chat", defaultPage: "dialog", pages: ["dialog", "intel", "watch"] },
  { id: "trading", code: "02", label: ["交易", "Trading"], section: "cockpit", defaultPage: "overview", pages: ["overview", "market", "positions", "execution", "reviews", "owner", "ledger"], ownerPages: ["owner"] },
  { id: "research", code: "03", label: ["研究", "Research"], section: "researchCenter", defaultPage: "knowledge", pages: ["knowledge", "strategy", "capabilities"] },
  { id: "risk", code: "04", label: ["风控", "Risk"], section: "riskCenter", defaultPage: "posture", pages: ["posture", "mandate", "rules"] },
  { id: "ops", code: "05", label: ["运营", "Ops"], section: "operationsCenter", defaultPage: "overview", pages: ["overview", "events", "tasks", "audit", "notifications"] },
  { id: "settings", code: "06", label: ["设置", "Settings"], section: "systemSettings", defaultPage: "overview", pages: ["overview", "system", "exchange", "notifications", "models", "agents", "users", "subscriptions"], ownerPages: ["users", "subscriptions"] }
];

const LEGACY_TARGETS = {
  chat: ["ai", "dialog"], watch: ["ai", "watch"], intelligence: ["ai", "intel"],
  cockpit: ["trading", "overview"], market: ["trading", "market"],
  marketAccount: ["trading", "market"], positions: ["trading", "positions"],
  signalHub: ["trading", "execution"], tradeJournal: ["trading", "execution"],
  executionReview: ["trading", "execution"], tradeLedger: ["trading", "ledger"],
  ownerReviewWorkspace: ["trading", "owner"], researchCenter: ["research", "knowledge"],
  knowledgeBase: ["research", "knowledge"], capabilities: ["research", "capabilities"],
  capabilityLib: ["research", "capabilities"], strategyLib: ["research", "strategy"],
  strategyStudio: ["research", "strategy"], strategyAnalysis: ["research", "strategy"],
  analysisRoom: ["research", "strategy"], strategyWorkbench: ["research", "strategy"],
  riskCenter: ["risk", "posture"], riskOverview: ["risk", "posture"],
  riskHub: ["risk", "posture"], riskMandate: ["risk", "mandate"], riskSettings: ["risk", "rules"],
  operationsCenter: ["ops", "overview"],
  eventsTasks: ["ops", "events"], auditSystem: ["ops", "audit"],
  systemSettings: ["settings", "overview"], admin: ["settings", "users"]
};

const workspaceById = (id) => WORKSPACES.find((row) => row.id === id) || WORKSPACES[0];

export function defaultWorkspaceLocation(user = {}) {
  return user.isOwner === true ? { workspace: "trading", page: "overview" } : { workspace: "ai", page: "dialog" };
}

export function normalizeWorkspaceLocation(location, user = {}) {
  const workspace = workspaceById(location?.workspace);
  const page = workspace.pages.includes(location?.page) ? location.page : workspace.defaultPage;
  const normalized = { workspace: workspace.id, page };
  if (location?.detailId) normalized.detailId = String(location.detailId);
  if ((workspace.ownerPages || []).includes(page) && user.isOwner !== true) normalized.denied = true;
  return normalized;
}

export function resolveWorkspaceTarget(target, user = {}) {
  const value = String(target || "chat");
  if (value.startsWith("tradeReviewDetail:")) return normalizeWorkspaceLocation({ workspace: "trading", page: "reviews", detailId: value.slice(18) }, user);
  if (value === "eventsTasks:tasks") return normalizeWorkspaceLocation({ workspace: "ops", page: "tasks" }, user);
  if (value.startsWith("researchCenter:")) return normalizeWorkspaceLocation({ workspace: "research", page: value.split(":")[1] }, user);
  if (value.startsWith("settings:")) return normalizeWorkspaceLocation({ workspace: "settings", page: value.split(":")[1] }, user);
  if (value === "systemSettings:exchange") return normalizeWorkspaceLocation({ workspace: "settings", page: "exchange" }, user);
  const [workspace, page] = LEGACY_TARGETS[value] || LEGACY_TARGETS.chat;
  return normalizeWorkspaceLocation({ workspace, page }, user);
}

export function sectionForWorkspace(workspace) {
  return workspaceById(workspace).section;
}

export function readWorkspaceLocation(storage, user = {}) {
  try {
    const stored = JSON.parse(storage?.getItem("kordyn.workspace.location.v2") || "null");
    return stored ? normalizeWorkspaceLocation(stored, user) : defaultWorkspaceLocation(user);
  } catch {
    return defaultWorkspaceLocation(user);
  }
}

export function writeWorkspaceLocation(storage, location) {
  storage?.setItem("kordyn.workspace.location.v2", JSON.stringify({ workspace: location.workspace, page: location.page, ...(location.detailId ? { detailId: location.detailId } : {}) }));
}
```

Verify the existing detail conventions (`tradeReviewDetail:<id>`, `researchCenter:<page>`, `eventsTasks:tasks`, `settings:<page>`) against current callers before replacing `navigate`.

- [ ] **Step 4: Write the function map with every old route**

```markdown
| Old entry | New location | Desktop | Mobile | Permission | Acceptance |
| --- | --- | --- | --- | --- | --- |
| chat | ai/dialog | Rail → AI → Dialog | AI → Dialog | subscriber | AI thread and plan evidence render |
| watch | ai/watch | AI → Watch | AI → Watch | subscriber | watch create/cancel and trigger meaning render |
| cockpit | trading/overview | Rail → Trading | Trade → Overview | subscriber | account, market, risk and activity render |
| executionReview | trading/execution | Trading → Execution | Trade → Execution | subscriber | plan/OMS/fill/review chain renders |
| ownerReviewWorkspace | trading/owner | Trading → Owner | Trade → Owner | Owner | subscriber receives permission explanation |
| knowledgeBase | research/knowledge | Research → Knowledge | Research → Knowledge | subscriber | import/search/incubation remain available |
| riskMandate | risk/mandate | Risk → Mandate | Risk → Mandate | subscriber | form payload and save behavior match |
| auditSystem | ops/audit | Ops → Audit | More → Ops → Audit | subscriber | audit facts and filters render |
| systemSettings | settings/overview | Settings | More → Settings | subscriber | all allowed settings remain reachable |
| admin | settings/users | Settings → Users | More → Settings → Users | Owner | subscriber cannot receive user data |
```

Extend the table with every entry in desktop `navigate`, `mobileNav`, `mobileSecondaryNav`, all settings tabs, and all six workspace local pages. Each row must name one focused test in Tasks 6–14.

- [ ] **Step 5: Run the focused tests and commit**

Run: `node --test tests/workspace-navigation.test.mjs`

Expected: PASS.

```bash
git add src/app/workspaceManifest.js tests/workspace-navigation.test.mjs docs/ui-function-map.md
git commit -m "feat: define unified workspace contract"
```

---

### Task 2: Build the Precision Paper Design System and State Primitives

**Files:**
- Create: `src/ui/design-system.css`
- Create: `src/ui/viewState.js`
- Create: `src/ui/primitives.jsx`
- Create: `public/kordyn-grid.svg`
- Create: `tests/ui-foundation.test.mjs`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Produces: `deriveViewState({ resourceState, hasData, updatedAt })`.
- Produces React primitives: `WorkspaceFrame`, `WorkspaceHeader`, `LocalNavigation`, `StatusChip`, `MetricStrip`, `ActionPanel`, `DataRegistry`, `EvidenceTrace`, `StateBoundary`, and `PermissionState`.

- [ ] **Step 1: Write failing token and state tests**

```js
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { deriveViewState } from "../src/ui/viewState.js";

test("resource state distinguishes empty, stale, degraded, and refresh", () => {
  assert.equal(deriveViewState({ resourceState: "loading", hasData: false }).kind, "loading");
  assert.equal(deriveViewState({ resourceState: "loading", hasData: true }).kind, "refreshing");
  assert.equal(deriveViewState({ resourceState: "error", hasData: true }).kind, "degraded");
  assert.equal(deriveViewState({ resourceState: "loaded", hasData: false }).kind, "empty");
});

test("design tokens use the approved palette and reject gradients", () => {
  const css = fs.readFileSync(new URL("../src/ui/design-system.css", import.meta.url), "utf8");
  assert.match(css, /--k-canvas:\s*#F4F1E9/i);
  assert.match(css, /--k-ink:\s*#111311/i);
  assert.match(css, /--k-accent:\s*#CCFF3D/i);
  assert.doesNotMatch(css, /linear-gradient|radial-gradient|backdrop-filter/i);
});
```

- [ ] **Step 2: Run tests and verify the missing files fail**

Run: `node --test tests/ui-foundation.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement exact tokens and resource-state normalization**

```css
:root {
  --k-canvas: #F4F1E9;
  --k-paper: #FBF9F3;
  --k-ink: #111311;
  --k-ink-muted: #575B55;
  --k-line: #C9C8BF;
  --k-line-strong: #8B8E86;
  --k-accent: #CCFF3D;
  --k-healthy: #B9E8CB;
  --k-warning: #E9B44C;
  --k-danger: #C93C37;
  --k-radius: 4px;
  --k-shadow-overlay: 0 18px 54px rgb(17 19 17 / 18%);
  --k-font-sans: Manrope, "DM Sans", Inter, system-ui, sans-serif;
  --k-font-mono: "Space Mono", "SFMono-Regular", Consolas, monospace;
}

.k-app { min-height: 100dvh; color: var(--k-ink); background-color: var(--k-canvas); }
.k-app::before { content: ""; position: fixed; inset: 0; pointer-events: none; opacity: .28; background-size: 24px 24px; background-image: url('/kordyn-grid.svg'); }
```

Create `public/kordyn-grid.svg` as a 24×24 transparent SVG containing one low-opacity horizontal line and one low-opacity vertical line. This provides the approved grid without CSS or SVG gradients.

```js
export function deriveViewState({ resourceState = "not_loaded", hasData = false, updatedAt = null } = {}) {
  if (["loading", "not_loaded"].includes(resourceState)) return { kind: hasData ? "refreshing" : "loading", updatedAt };
  if (["error", "degraded", "stale"].includes(resourceState)) return { kind: hasData ? "degraded" : "error", updatedAt };
  if (!hasData) return { kind: "empty", updatedAt };
  return { kind: "ready", updatedAt };
}
```

- [ ] **Step 4: Implement semantic primitives and SSR coverage**

```jsx
export function StatusChip({ tone = "neutral", children }) {
  return <span className={`k-status k-status--${tone}`}><i aria-hidden="true" />{children}</span>;
}

export function WorkspaceHeader({ code, eyebrow, title, description, action, children }) {
  return <header className="k-workspace-header">
    <div><small>{code} / {eyebrow}</small><h1>{title}</h1><p>{description}</p></div>
    {action && <div className="k-workspace-action">{action}</div>}
    {children}
  </header>;
}

export function StateBoundary({ state, title, detail, onRetry, children }) {
  if (state.kind === "loading") return <div className="k-state" aria-busy="true">{title}</div>;
  if (state.kind === "error") return <div className="k-state" role="alert"><b>{title}</b><p>{detail}</p><button onClick={onRetry}>{t("重试", "Retry")}</button></div>;
  return <>{state.kind === "degraded" && <div className="k-state-banner" role="status"><b>{title}</b><span>{detail}</span><button onClick={onRetry}>{t("重试", "Retry")}</button></div>}{children}</>;
}

export function WorkspaceFrame({ header, navigation, children }) {
  return <section className="k-workspace-frame">{header}{navigation}<div className="k-workspace-body">{children}</div></section>;
}

export function LocalNavigation({ items, active, onChange }) {
  return <nav className="k-local-nav" aria-label={t("工作区页面", "Workspace pages")}>{items.map((item) => <button key={item.id} aria-current={active === item.id ? "page" : undefined} onClick={() => onChange(item.id)}>{t(item.label[0], item.label[1])}</button>)}</nav>;
}

export function MetricStrip({ items }) {
  return <dl className="k-metric-strip">{items.map((item) => <div key={item.id || item.label}><dt>{item.label}</dt><dd className={item.mono ? "k-mono" : undefined}>{item.value}</dd>{item.detail && <small>{item.detail}</small>}</div>)}</dl>;
}

export function ActionPanel({ title, status, children, action }) {
  return <section className="k-action-panel"><header><h2>{title}</h2>{status}{action}</header>{children}</section>;
}

export function DataRegistry({ ariaLabel, columns, rows, renderRow, renderMobileRow }) {
  const desktopRow = renderRow || ((row) => <tr key={row.id}>{columns.map((column) => <td key={column.key || column}>{row[column.key || column]}</td>)}</tr>);
  const mobileRow = renderMobileRow || ((row) => <article key={row.id}>{columns.map((column) => <p key={column.key || column}><small>{column.label || column}</small><b>{row[column.key || column]}</b></p>)}</article>);
  return <div className="k-registry" aria-label={ariaLabel}>
    <table><thead><tr>{columns.map((column) => <th key={column.key || column}>{column.label || column}</th>)}</tr></thead><tbody>{rows.map(desktopRow)}</tbody></table>
    <div className="k-registry-mobile">{rows.map(mobileRow)}</div>
  </div>;
}

export function EvidenceTrace({ items }) {
  return <ol className="k-evidence-trace">{items.map((item, index) => <li key={item.id || `${item.label}-${index}`}><small>{item.label}</small><p>{item.value}</p>{item.status}</li>)}</ol>;
}

export function PermissionState({ title, detail }) {
  return <section className="k-permission-state" role="status"><b>{title}</b><p>{detail}</p></section>;
}
```

Import `t` from `src/i18n.js`. Add the primitive exports to the esbuild bundle in `tests/render-smoke.test.mjs` and assert that status text, `aria-current`, permission explanations, registry headers, and degraded banners render without relying on color-only class names.

- [ ] **Step 5: Run focused and smoke tests, then commit**

Run: `node --test tests/ui-foundation.test.mjs tests/render-smoke.test.mjs`

Expected: PASS.

```bash
git add public/kordyn-grid.svg src/ui/design-system.css src/ui/viewState.js src/ui/primitives.jsx tests/ui-foundation.test.mjs tests/render-smoke.test.mjs
git commit -m "feat: add precision paper design system"
```

---

### Task 3: Replace the Dual Shell with One Responsive Application Shell

**Files:**
- Create: `src/app/AppShell.jsx`
- Create: `src/app/AccountDialog.jsx`
- Create: `src/app/AuthenticatedApp.jsx`
- Create: `src/app/WorkspaceOutlet.jsx`
- Modify: `src/main.jsx:1-414`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Consumes: Task 1 location helpers and Task 2 primitives.
- Produces: `<AuthenticatedApp api lang switchLang />`, `<AppShell ... />`, and `<WorkspaceOutlet location data action ui />`.

- [ ] **Step 1: Add a failing SSR test for one shell and two navigation forms**

```js
test("one app shell renders desktop rail and approved mobile navigation", () => {
  const html = render(React.createElement(C.AppShell, {
    data, location: { workspace: "trading", page: "overview" }, onNavigate: () => {}, action, ui,
    content: React.createElement("div", null, "WORKSPACE CONTENT")
  }));
  assert.match(html, /k-operating-rail/);
  assert.match(html, /k-mobile-nav/);
  assert.match(html, />AI</);
  assert.match(html, />Trade</);
  assert.match(html, />Research</);
  assert.match(html, />Risk</);
  assert.match(html, />More</);
  assert.match(html, /WORKSPACE CONTENT/);
});
```

- [ ] **Step 2: Run the smoke test and verify `AppShell` is missing**

Run: `node --test tests/render-smoke.test.mjs`

Expected: FAIL because `AppShell` is not exported.

- [ ] **Step 3: Implement the responsive shell without viewport branching**

```jsx
const MOBILE_ITEMS = [
  { id: "ai", label: ["AI", "AI"] }, { id: "trading", label: ["交易", "Trade"] },
  { id: "research", label: ["研究", "Research"] }, { id: "risk", label: ["风控", "Risk"] },
  { id: "more", label: ["更多", "More"] }
];

export function AppShell({ data, location, onNavigate, content, busy, toast, panel, action, notify, lang, switchLang, connectionError }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const runtime = automationPresentation(data);
  const okx = (data.exchangeAccounts || []).find((row) => row.exchange === "OKX") || {};
  const unread = (data.notifications || []).filter((row) => !row.read).length;
  return <div className="k-app">
    <aside className="k-operating-rail">
      <img src="/kordyn-logo.svg" alt="KORDYN" />
      <nav>{WORKSPACES.map((workspace) => <button key={workspace.id} aria-current={location.workspace === workspace.id ? "page" : undefined} onClick={() => onNavigate({ workspace: workspace.id, page: workspace.defaultPage })}>{t(workspace.label[0], workspace.label[1])}</button>)}</nav>
    </aside>
    <div className="k-app-main">
      <header className="k-global-status">
        <button onClick={() => onNavigate({ workspace: "settings", page: "exchange" })}>OKX · {exchangeState(okx).label}</button>
        <span>{t("当前状态", "Runtime")} · {runtime.label}</span>
        {connectionError && <span role="status">{t("连接恢复中", "Reconnecting")}</span>}
        <button onClick={() => onNavigate({ workspace: "ops", page: "notifications" })}>{t("通知", "Notifications")} · {unread}</button>
        <button onClick={() => switchLang(lang === "zh" ? "en" : "zh")}>{lang === "zh" ? "EN" : "中文"}</button>
        <button onClick={() => setAccountOpen(true)}>{localizeText(data.user?.name || t("账户", "Account"))}</button>
      </header>
      <main className="k-workspace-content">{content}</main>
    </div>
    <nav className="k-mobile-nav">{MOBILE_ITEMS.map((item) => <button key={item.id} aria-current={item.id === "more" ? (["ops", "settings"].includes(location.workspace) ? "page" : undefined) : (location.workspace === item.id ? "page" : undefined)} onClick={() => item.id === "more" ? setMoreOpen(true) : onNavigate({ workspace: item.id, page: WORKSPACES.find((row) => row.id === item.id).defaultPage })}>{t(item.label[0], item.label[1])}</button>)}</nav>
    {moreOpen && <div className="k-mobile-more" role="dialog" aria-label={t("更多工作区", "More workspaces")}>
      <button onClick={() => { setMoreOpen(false); onNavigate({ workspace: "ops", page: "overview" }); }}>{t("系统运营", "Operations")}</button>
      <button onClick={() => { setMoreOpen(false); onNavigate({ workspace: "settings", page: "overview" }); }}>{t("系统设置", "Settings")}</button>
      <button onClick={() => setMoreOpen(false)}>{t("关闭", "Close")}</button>
    </div>}
    {panel}
    {accountOpen && <AccountDialog user={data.user || {}} action={action} notify={notify} onClose={() => setAccountOpen(false)} />}
    {busy && <div className="k-busy" role="status">{t("执行中", "Working")}</div>}
    {toast && <div className="k-toast" role="status">{toast}</div>}
  </div>;
}
```

The desktop rail is visible above 767px; the mobile bottom bar is visible at 767px and below. Both remain in the same DOM and call the same `onNavigate(location)` function.

- [ ] **Step 4: Move authenticated route state out of `main.jsx`**

```jsx
export function AuthenticatedApp({ api, lang, switchLang }) {
  const { data, action, notify, download, refresh, ensureSection, busy, toast, connectionError } = api;
  const [location, setLocation] = useState(() => readWorkspaceLocation(window.localStorage, data.user));
  const navigate = (target) => setLocation(normalizeWorkspaceLocation(
    typeof target === "string" ? resolveWorkspaceTarget(target, data.user) : target,
    data.user
  ));
  useEffect(() => {
    writeWorkspaceLocation(window.localStorage, location);
    ensureSection(sectionForWorkspace(location.workspace));
  }, [location.workspace, location.page]);
  const ui = { setActive: navigate, notify, download, refresh, ensureSection };
  return <AppShell data={data} location={location} onNavigate={navigate} action={action} notify={notify} lang={lang} switchLang={switchLang} connectionError={connectionError} busy={busy} toast={toast}
    content={<WorkspaceOutlet location={location} data={data} action={action} ui={ui} />} />;
}
```

Keep auth, registration, connection recovery, release notice, `ConfirmHost`, and root mounting in `main.jsx`. Move the current profile, avatar, password, and TOTP behavior from `AccountDialog` in `main.jsx` into `src/app/AccountDialog.jsx` without changing its API calls. Remove the `isMobileViewport ? MobileApp : desktop` branch; `WorkspaceOutlet` may temporarily render existing Center components until their workspace task replaces them.

- [ ] **Step 5: Run route, smoke, build, and commit**

Run: `node --test tests/workspace-navigation.test.mjs tests/render-smoke.test.mjs && npm run build`

Expected: PASS; the build contains one authenticated app shell and no runtime viewport component switch.

```bash
git add src/app/AppShell.jsx src/app/AccountDialog.jsx src/app/AuthenticatedApp.jsx src/app/WorkspaceOutlet.jsx src/main.jsx src/ui/design-system.css tests/render-smoke.test.mjs
git commit -m "feat: unify responsive application shell"
```

---

### Task 4: Add Permission-Scoped Global Search

**Files:**
- Create: `src/app/globalSearchModel.js`
- Create: `src/app/GlobalSearch.jsx`
- Create: `tests/global-search.test.mjs`
- Modify: `src/app/AppShell.jsx`

**Interfaces:**
- Produces: `buildGlobalSearchItems(data, user)` and `searchGlobalItems(items, query, limit = 12)`.
- Search result shape: `{ id, type, label, meta, location }`.

- [ ] **Step 1: Write failing scope and result tests**

```js
test("search indexes only real accessible objects", () => {
  const items = buildGlobalSearchItems({
    markets: [{ symbol: "BTC/USDT" }], positions: [{ id: "p1", symbol: "ETH/USDT" }],
    tradePlans: [{ id: "plan-1", symbol: "BTC/USDT" }], tasks: [{ id: "task-1", name: "行情同步" }],
    auditLogs: [{ id: "audit-1", action: "风险校验" }], users: [{ id: "u2", name: "Private User" }]
  }, { isOwner: false });
  assert.ok(items.some((row) => row.label === "BTC/USDT"));
  assert.ok(items.some((row) => row.label === "行情同步"));
  assert.ok(!items.some((row) => row.label === "Private User"));
  assert.equal(searchGlobalItems(items, "risk")[0].location.workspace, "risk");
});
```

- [ ] **Step 2: Run the test and verify the module is missing**

Run: `node --test tests/global-search.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement typed indexing and normalization**

```js
const normalize = (value) => String(value || "").trim().toLocaleLowerCase();

export function searchGlobalItems(items, query, limit = 12) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return items.filter((item) => terms.every((term) => normalize(`${item.label} ${item.meta} ${item.type}`).includes(term))).slice(0, limit);
}

export function buildGlobalSearchItems(data = {}, user = {}) {
  const items = WORKSPACES.flatMap((workspace) => [
    { id: `workspace:${workspace.id}`, type: "function", label: workspace.label[1], meta: workspace.label[0], location: { workspace: workspace.id, page: workspace.defaultPage } },
    ...workspace.pages.filter((page) => user.isOwner === true || !(workspace.ownerPages || []).includes(page)).map((page) => ({ id: `function:${workspace.id}:${page}`, type: "function", label: page, meta: workspace.label.join(" "), location: { workspace: workspace.id, page } }))
  ]);
  for (const market of data.markets || []) items.push({ id: `market:${market.symbol}`, type: "market", label: market.symbol, meta: "market", location: { workspace: "trading", page: "market", detailId: market.symbol } });
  for (const position of data.positions || []) items.push({ id: `position:${position.id || position.symbol}`, type: "position", label: position.symbol, meta: position.direction || "", location: { workspace: "trading", page: "positions", detailId: position.id } });
  for (const plan of data.tradePlans || []) items.push({ id: `plan:${plan.id}`, type: "plan", label: plan.symbol || plan.id, meta: plan.id, location: { workspace: "trading", page: "execution", detailId: plan.id } });
  for (const item of data.knowledge?.documents || []) items.push({ id: `knowledge:${item.id}`, type: "knowledge", label: item.title || item.name, meta: item.source || "", location: { workspace: "research", page: "knowledge", detailId: item.id } });
  for (const strategy of data.strategyCatalog?.strategies || []) items.push({ id: `strategy:${strategy.id}`, type: "strategy", label: strategy.name || strategy.id, meta: strategy.status || "", location: { workspace: "research", page: "strategy", detailId: strategy.id } });
  for (const task of data.tasks || []) items.push({ id: `task:${task.id}`, type: "task", label: task.name || task.id, meta: task.status || "", location: { workspace: "ops", page: "tasks", detailId: task.id } });
  for (const audit of data.auditLogs || []) items.push({ id: `audit:${audit.id}`, type: "audit", label: audit.action || audit.id, meta: audit.actor || "", location: { workspace: "ops", page: "audit", detailId: audit.id } });
  if (user.isOwner === true) for (const account of data.users || []) items.push({ id: `user:${account.id}`, type: "user", label: account.name || account.email, meta: account.email || "", location: { workspace: "settings", page: "users", detailId: account.id } });
  return items.map((item) => ({ ...item, location: normalizeWorkspaceLocation(item.location, user) }));
}
```

Extend the same explicit loop to `data.subscriptions` for Owner only. Do not index fields absent from the supplied snapshot.

- [ ] **Step 4: Add the accessible search overlay to the shared shell**

```jsx
<GlobalSearch
  data={data}
  user={data.user}
  onSelect={(result) => onNavigate(result.location)}
  ariaLabel={t("全局搜索", "Global search")}
/>
```

Support `/` to focus when the user is not typing, ArrowUp/ArrowDown to move, Enter to open, and Escape to close. The overlay shows grouped result types and never synthesizes results.

- [ ] **Step 5: Run focused tests, smoke test, and commit**

Run: `node --test tests/global-search.test.mjs tests/render-smoke.test.mjs`

Expected: PASS.

```bash
git add src/app/globalSearchModel.js src/app/GlobalSearch.jsx src/app/AppShell.jsx tests/global-search.test.mjs tests/render-smoke.test.mjs
git commit -m "feat: add scoped global search"
```

---

### Task 5: Centralize Runtime Status and High-Risk Actions

**Files:**
- Create: `src/app/safetyActions.js`
- Create: `src/app/SafetyControls.jsx`
- Create: `tests/safety-actions.test.mjs`
- Modify: `src/app/AppShell.jsx`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Produces: `buildSafetyRequest(kind, data, reason)` and `executeSafetyAction({ kind, data, reason, action })`.
- Kinds: `flatten_all`, `activate_kill_switch`, `clear_kill_switch`.

- [ ] **Step 1: Write failing exact-request tests**

```js
test("safety actions use existing endpoints and never infer success", async () => {
  assert.deepEqual(buildSafetyRequest("flatten_all", {}), { endpoint: "/api/risk/emergency-flatten", body: {}, method: "POST" });
  assert.deepEqual(buildSafetyRequest("activate_kill_switch", {}, "bad feed"), { endpoint: "/api/risk/kill-switch", body: { enabled: true, reason: "bad feed" }, method: "POST" });
  assert.deepEqual(buildSafetyRequest("clear_kill_switch", {}, ""), { endpoint: "/api/risk/kill-switch", body: { enabled: false, reason: "" }, method: "POST" });
  const failure = await executeSafetyAction({ kind: "flatten_all", data: {}, action: async () => ({ ok: false, error: "reconcile_pending", auditId: "a1" }) });
  assert.equal(failure.ok, false);
  assert.equal(failure.auditId, "a1");
});
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `node --test tests/safety-actions.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement request construction and server-result passthrough**

```js
export function buildSafetyRequest(kind, data = {}, reason = "") {
  if (kind === "flatten_all") return { endpoint: "/api/risk/emergency-flatten", body: {}, method: "POST" };
  if (kind === "activate_kill_switch") return { endpoint: "/api/risk/kill-switch", body: { enabled: true, reason }, method: "POST" };
  if (kind === "clear_kill_switch") return { endpoint: "/api/risk/kill-switch", body: { enabled: false, reason }, method: "POST" };
  throw new Error(`Unknown safety action: ${kind}`);
}

export async function executeSafetyAction({ kind, data, reason = "", action }) {
  const request = buildSafetyRequest(kind, data, reason);
  return action(request.endpoint, request.body, request.method);
}
```

- [ ] **Step 4: Build a shared structured confirmation surface**

```jsx
<SafetyControls
  runtime={automationPresentation(data)}
  positions={data.positions || []}
  killSwitch={data.system?.killSwitch === true}
  onExecute={(kind, reason) => executeSafetyAction({ kind, data, reason, action })}
/>
```

The confirmation displays action, impact scope, open position count, current effective runtime, reason input for activation, pending state, exact server result, and `auditId`. It remains open on failure and closes only after explicit user acknowledgement of a verified success.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/safety-actions.test.mjs tests/render-smoke.test.mjs`

Expected: PASS.

```bash
git add src/app/safetyActions.js src/app/SafetyControls.jsx src/app/AppShell.jsx tests/safety-actions.test.mjs tests/render-smoke.test.mjs
git commit -m "feat: unify safety-critical controls"
```

---

### Task 6: Rebuild AI Dialog and Candidate-Signal Semantics

**Files:**
- Create: `src/workspaces/ai/AiWorkspace.jsx`
- Create: `src/workspaces/ai/AiDialogPage.jsx`
- Create: `src/workspaces/ai/opportunityPresentation.js`
- Create: `tests/opportunity-presentation.test.mjs`
- Modify: `src/chat.jsx`
- Modify: `src/app/WorkspaceOutlet.jsx`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Produces: `candidateStatus(candidate)` and `buildCandidateRows(data)`.
- `AiWorkspace` consumes `{ page, data, action, ui, onNavigate }` and uses the shared `WorkspaceFrame`.

- [ ] **Step 1: Write failing opportunity wording tests**

```js
test("pre-AI states are candidate signals, not confirmed opportunities", () => {
  assert.deepEqual(candidateStatus({ status: "DISCOVERED" }), { key: "candidate", zh: "候选信号", en: "Candidate signal", tone: "neutral" });
  assert.equal(candidateStatus({ status: "ANALYZING" }).key, "analyzing");
  assert.equal(candidateStatus({ status: "QUALIFIED" }).key, "qualified");
  assert.equal(candidateStatus({ status: "REJECTED" }).key, "rejected");
  assert.equal(candidateStatus({ status: "SUPERSEDED" }).key, "superseded");
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `node --test tests/opportunity-presentation.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the presentation-only status adapter**

```js
const STATUS = {
  DISCOVERED: ["candidate", "候选信号", "Candidate signal", "neutral"],
  ANALYZING: ["analyzing", "AI 复核中", "AI review", "warning"],
  QUALIFIED: ["qualified", "已确认并通过当前风控", "Qualified by current risk checks", "healthy"],
  REJECTED: ["rejected", "已拒绝", "Rejected", "danger"],
  RISK_REJECTED: ["rejected", "风险校验拒绝", "Rejected by risk checks", "danger"],
  WATCHING: ["watching", "继续观察", "Watching", "warning"],
  ARMED: ["qualified", "已确认，等待入场条件", "Qualified; waiting for entry", "healthy"],
  EXPIRED: ["expired", "已过期", "Expired", "neutral"],
  SUPERSEDED: ["superseded", "已被新结构取代", "Superseded", "neutral"]
};
export function candidateStatus(candidate = {}) {
  const [key, zh, en, tone] = STATUS[String(candidate.status || "DISCOVERED").toUpperCase()] || STATUS.DISCOVERED;
  return { key, zh, en, tone };
}
```

- [ ] **Step 4: Recompose the AI dialog as conversation plus evidence rail**

```jsx
export function AiDialogPage({ data, action, ui }) {
  return <div className="k-conversation-layout">
    <section className="k-conversation-main"><ChatPage data={data} action={action} ui={ui} /></section>
    <aside className="k-conversation-evidence">
      <EvidenceTrace items={buildCandidateRows(data)} />
    </aside>
  </div>;
}
```

In `chat.jsx`, retain all truth guards and action handlers. Reorder visible decision content into Fact / Inference / Recommendation / Authorization sections, show freshness beside facts, and render an explicit “No real trade plan created” state whenever `run.tradePlanId` is absent.

- [ ] **Step 5: Add SSR assertions and commit**

Add assertions for `01 / AI TRADER`, Candidate Signal, AI Review, Fact, Recommendation, and the no-plan truth state. Assert that no Candidate Signal row says “confirmed opportunity”.

Run: `node --test tests/opportunity-presentation.test.mjs tests/render-smoke.test.mjs`

Expected: PASS.

```bash
git add src/workspaces/ai/AiWorkspace.jsx src/workspaces/ai/AiDialogPage.jsx src/workspaces/ai/opportunityPresentation.js src/chat.jsx src/app/WorkspaceOutlet.jsx tests/opportunity-presentation.test.mjs tests/render-smoke.test.mjs
git commit -m "feat: rebuild AI decision workspace"
```

---

### Task 7: Rebuild Intelligence and Watch as AI Subpages

**Files:**
- Create: `src/workspaces/ai/IntelligencePage.jsx`
- Create: `src/workspaces/ai/WatchPage.jsx`
- Create: `src/workspaces/ai/intelligenceActions.js`
- Modify: `src/workspaces/ai/AiWorkspace.jsx`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Produces: `refreshIntelligence(action)` using the current refresh endpoint chain.
- Preserves watch create/delete actions and the current `displayThesis`, `displayTriggerMeaning`, invalidation, source, and timestamp fields.

- [ ] **Step 1: Add failing SSR tests for the two subpages**

```js
test("AI intelligence and watch pages distinguish triggers from decisions", () => {
  const intel = render(React.createElement(C.AiWorkspace, { page: "intel", data, action, ui }));
  const watch = render(React.createElement(C.AiWorkspace, { page: "watch", data, action, ui }));
  assert.match(intel, /来源|Source/);
  assert.match(intel, /更新时间|Updated/);
  assert.match(watch, /命中只会触发 AI 复核/);
  assert.match(watch, /原判断/);
  assert.match(watch, /失效条件/);
});
```

- [ ] **Step 2: Run the smoke test and verify missing subpages**

Run: `node --test tests/render-smoke.test.mjs`

Expected: FAIL on the new wording and page structure.

- [ ] **Step 3: Extract intelligence functionality into the Registry template**

```js
export function refreshIntelligence(action) {
  return action("/api/market-intelligence/refresh", {});
}
```

```jsx
<DataRegistry
  ariaLabel={t("情报来源", "Intelligence sources")}
  columns={["time", "source", "summary", "affectedSymbols", "freshness"]}
  rows={rows}
  renderMobileRow={(row) => <IntelligenceRow row={row} />}
/>
```

Carry over refresh, source links, Gemini grounding links, event impact, and stale-source disclosure from `IntelligenceConcept` and `MobileIntelligence`. Grounding links remain research context and are not labeled as trade authority.

- [ ] **Step 4: Extract watch functionality into a trace-oriented Workbench**

```jsx
<ActionPanel title={watch.displayThesis} status={<StatusChip tone="neutral">{t("观察中", "Watching")}</StatusChip>}>
  <EvidenceTrace items={[
    { label: t("触发条件", "Trigger"), value: describeWatch(watch) },
    { label: t("命中意味着", "Trigger meaning"), value: watch.displayTriggerMeaning },
    { label: t("失效条件", "Invalidation"), value: invalidationText }
  ]} />
</ActionPanel>
```

Use one sentence above the list: “价格或事件命中只会触发 AI 复核，不代表入场已经确认。” Preserve create, cancel, retry, trigger status, and lineage fields.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/render-smoke.test.mjs`

Expected: PASS for dialog, intelligence, and watch pages.

```bash
git add src/workspaces/ai/IntelligencePage.jsx src/workspaces/ai/WatchPage.jsx src/workspaces/ai/intelligenceActions.js src/workspaces/ai/AiWorkspace.jsx tests/render-smoke.test.mjs
git commit -m "feat: rebuild AI intelligence and watch"
```

---

### Task 8: Rebuild Trading Observation Pages

**Files:**
- Create: `src/workspaces/trading/TradingWorkspace.jsx`
- Create: `src/workspaces/trading/TradingOverviewPage.jsx`
- Create: `src/workspaces/trading/MarketPage.jsx`
- Create: `src/workspaces/trading/PositionsPage.jsx`
- Modify: `src/app/WorkspaceOutlet.jsx`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Consumes: `buildMarketRows`, `buildPositionView`, `buildExecutionView`, `automationPresentation`, and shared primitives.
- `TradingWorkspace` consumes `{ page, detailId, data, action, ui, onNavigate }`.

- [ ] **Step 1: Add failing tests for truth-first observation pages**

```js
test("trading observation pages preserve authoritative money and position facts", () => {
  const overview = render(React.createElement(C.TradingWorkspace, { page: "overview", data, action, ui }));
  const market = render(React.createElement(C.TradingWorkspace, { page: "market", data, action, ui }));
  const positions = render(React.createElement(C.TradingWorkspace, { page: "positions", data, action, ui }));
  assert.match(overview, /02 \/ TRADING/);
  assert.match(overview, /当前实际状态/);
  assert.match(market, /数据来源|Source/);
  assert.match(positions, /计划|Plan/);
  assert.doesNotMatch(positions, /undefined|NaN/);
});
```

- [ ] **Step 2: Run the smoke test and verify missing workspace failure**

Run: `node --test tests/render-smoke.test.mjs`

Expected: FAIL because `TradingWorkspace` is missing.

- [ ] **Step 3: Implement overview without a generic card wall**

```jsx
<WorkspaceFrame>
  <MetricStrip items={accountMetrics} />
  <section className="k-overview-decision-grid">
    <ActionPanel title={t("需要处理", "Needs attention")}>{attentionRows}</ActionPanel>
    <EvidenceTrace items={runtimeAndRiskFacts} />
  </section>
  <DataRegistry rows={recentActivity} renderMobileRow={renderActivityRow} />
</WorkspaceFrame>
```

Use lifecycle net PnL, authoritative account snapshots, current automation state, current risk budget, and existing links to positions, execution, and audit. Unknown financial fields display “Not synced / 未同步”, never zero.

- [ ] **Step 4: Implement Market and Positions Workbenches**

Market keeps pair selection, timeframe, chart, watchlist add/remove, reconcile, public facts, OI/funding/CVD, BTC beta, breadth, smart money, and event volatility. Positions keeps position/open-order/execution segments, source, plan, protection, risk use, mark/entry, PnL, and exit actions. Both use one selected object plus a registry instead of simultaneous equal-weight cards.

```jsx
<div className="k-workbench">
  <section className="k-workbench-main">{primaryTaskSurface}</section>
  <aside className="k-workbench-aside">{selectedEvidence}</aside>
</div>
```

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/render-smoke.test.mjs tests/protection-allocation.test.mjs`

Expected: PASS.

```bash
git add src/workspaces/trading/TradingWorkspace.jsx src/workspaces/trading/TradingOverviewPage.jsx src/workspaces/trading/MarketPage.jsx src/workspaces/trading/PositionsPage.jsx src/app/WorkspaceOutlet.jsx tests/render-smoke.test.mjs
git commit -m "feat: rebuild trading observation workspace"
```

---

### Task 9: Rebuild Trading Execution, Ledger, and Review Pages

**Files:**
- Create: `src/workspaces/trading/ExecutionPage.jsx`
- Create: `src/workspaces/trading/TradeReviewsPage.jsx`
- Create: `src/workspaces/trading/OwnerOptimizationPage.jsx`
- Create: `src/workspaces/trading/LedgerPage.jsx`
- Modify: `src/workspaces/trading/TradingWorkspace.jsx`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Consumes existing execution/review actions without endpoint changes.
- Produces a trace from recommendation → authorization → risk check → order → fill → position → review.

- [ ] **Step 1: Add failing lifecycle and role tests**

```js
test("execution pages show one verified lifecycle and protect Owner data", () => {
  const execution = render(React.createElement(C.TradingWorkspace, { page: "execution", data, action, ui }));
  const ledger = render(React.createElement(C.TradingWorkspace, { page: "ledger", data, action, ui }));
  const denied = render(React.createElement(C.TradingWorkspace, { page: "owner", data: { ...data, user: { ...data.user, isOwner: false } }, action, ui }));
  assert.match(execution, /Risk check|风险校验/);
  assert.match(ledger, /Orders|委托/);
  assert.match(ledger, /Fills|成交/);
  assert.match(denied, /Owner 权限/);
  assert.doesNotMatch(denied, /Owner 优化工作台/);
});
```

- [ ] **Step 2: Run the smoke test and verify the new routes fail**

Run: `node --test tests/render-smoke.test.mjs`

Expected: FAIL for new page markup or permission explanation.

- [ ] **Step 3: Implement Execution and Ledger from authoritative lifecycle data**

```jsx
<EvidenceTrace items={[
  planFact, authorizationFact, riskCheckFact, executionOrderFact,
  ...fillFacts, positionFact, reviewFact
].filter(Boolean)} />
```

Copy the exact action handlers and endpoint arguments from `ExecutionReviewConcept` and `ExecutionLedgerConcept`. Preserve cancellation, retry, exit, reconciliation, review navigation, fees, funding, slippage, unknown-financial disclosure, and exchange/OMS status separation.

- [ ] **Step 4: Implement subscriber reviews and Owner optimization as separate pages**

Trade reviews show one selected lifecycle, factual result, evidence quality, loss attribution, lessons, and knowledge proposal. Owner optimization shows aggregated repeated issues, counterexamples, validation evidence, and approval actions. `PermissionState` renders before any Owner records are read when `data.user?.isOwner !== true`.

```jsx
if (data.user?.isOwner !== true) {
  return <PermissionState title={t("需要 Owner 权限", "Owner access required")} detail={t("此页面包含跨交易改进与审批信息。", "This page contains cross-trade improvement and approval data.")} />;
}
```

- [ ] **Step 5: Run financial/review regressions and commit**

Run: `node --test tests/render-smoke.test.mjs tests/review-learning.test.mjs tests/performance-review-integrity.test.mjs tests/owner-review-counterexamples.test.mjs`

Expected: PASS.

```bash
git add src/workspaces/trading/ExecutionPage.jsx src/workspaces/trading/TradeReviewsPage.jsx src/workspaces/trading/OwnerOptimizationPage.jsx src/workspaces/trading/LedgerPage.jsx src/workspaces/trading/TradingWorkspace.jsx tests/render-smoke.test.mjs
git commit -m "feat: rebuild trading lifecycle and reviews"
```

---

### Task 10: Rebuild Research as Incubation and Release Workflows

**Files:**
- Create: `src/workspaces/research/ResearchWorkspace.jsx`
- Create: `src/workspaces/research/KnowledgePage.jsx`
- Create: `src/workspaces/research/StrategyPage.jsx`
- Create: `src/workspaces/research/CapabilitiesPage.jsx`
- Modify: `src/app/WorkspaceOutlet.jsx`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Consumes: `buildStrategyCatalogRows`, `buildCapabilityCatalogRows`, knowledge lifecycle selectors, current import/publish/test actions.

- [ ] **Step 1: Add failing lifecycle tests**

```js
test("research separates incubation from released strategies and capabilities", () => {
  const knowledge = render(React.createElement(C.ResearchWorkspace, { page: "knowledge", data, action, ui }));
  const strategy = render(React.createElement(C.ResearchWorkspace, { page: "strategy", data, action, ui }));
  const capabilities = render(React.createElement(C.ResearchWorkspace, { page: "capabilities", data, action, ui }));
  assert.match(knowledge, /孵化|Incubation/);
  assert.match(strategy, /样本外|Out-of-sample/);
  assert.match(capabilities, /运行时批准|Runtime approved/);
});
```

- [ ] **Step 2: Run the smoke test and verify failure**

Run: `node --test tests/render-smoke.test.mjs`

Expected: FAIL because `ResearchWorkspace` is missing.

- [ ] **Step 3: Implement Knowledge as Registry plus concept detail**

Preserve import, bulk import, search, source status, graph, extraction candidates, lenses, rules, trading skills, workflows, approval, and provenance. Empty imports remain incomplete rather than parsed. The mobile layout uses the same rows and detail component, not a reduced catalog.

```jsx
<DataRegistry rows={knowledgeRows} selectedId={selectedId} onSelect={setSelectedId} renderMobileRow={renderKnowledgeRow} />
<KnowledgeDetail record={selected} graph={data.knowledge?.conceptCards || []} />
```

- [ ] **Step 4: Implement Strategy and Capabilities with shared selectors**

Strategy retains catalog, studio, internal market, tests, OOS results, publication, enable/disable, live evidence, and archive. Capabilities retains approved workflows, native/imported skills, MCP servers, tool usage, trust, enable/disable, and status. Enabling a strategy must say it only enters the AI eligible set and cannot bypass live risk.

```jsx
const pages = {
  knowledge: <KnowledgePage data={data} action={action} ui={ui} />,
  strategy: <StrategyPage data={data} action={action} ui={ui} />,
  capabilities: <CapabilitiesPage data={data} action={action} ui={ui} />
};
return <WorkspaceFrame header={header} navigation={localNavigation}>{pages[page] || pages.knowledge}</WorkspaceFrame>;
```

- [ ] **Step 5: Run research tests and commit**

Run: `node --test tests/render-smoke.test.mjs tests/strategy-contracts.test.mjs tests/knowledge-skills.test.mjs tests/skill-live-validation.test.mjs`

Expected: PASS.

```bash
git add src/workspaces/research/ResearchWorkspace.jsx src/workspaces/research/KnowledgePage.jsx src/workspaces/research/StrategyPage.jsx src/workspaces/research/CapabilitiesPage.jsx src/app/WorkspaceOutlet.jsx tests/render-smoke.test.mjs
git commit -m "feat: rebuild research lifecycle workspace"
```

---

### Task 11: Rebuild Risk with Shared Desktop/Mobile Forms

**Files:**
- Create: `src/workspaces/risk/RiskWorkspace.jsx`
- Create: `src/workspaces/risk/RiskPosturePage.jsx`
- Create: `src/workspaces/risk/MandatePage.jsx`
- Create: `src/workspaces/risk/RiskRulesPage.jsx`
- Create: `src/workspaces/risk/riskFormModel.js`
- Create: `tests/risk-form-model.test.mjs`
- Modify: `src/app/WorkspaceOutlet.jsx`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Produces: `buildRiskPermissionPayload(mandate, form, options)` and `submitRiskChange(action, endpoint, body, method = "POST")` shared by all viewports.

- [ ] **Step 1: Port current mobile payload counterexamples into a failing shared test**

```js
test("risk edits preserve heterogeneous pair caps and paused mandate state", () => {
  const mandate = { status: "paused", allowedSymbols: ["BTC/USDT", "ETH/USDT"], maxLeverageBySymbol: { "BTC/USDT": 2, "ETH/USDT": 4 } };
  const payload = buildRiskPermissionPayload(mandate, {
    symbols: ["BTC/USDT", "ETH/USDT"], maxLeverageBySymbol: {}, minLeverage: 1,
    positionPct: 30, singleRisk: 1, dailyLoss: 2, weeklyLoss: 5,
    maxOrderNotional: 50, maxSymbolNotional: 100, maxPortfolioNotional: 200,
    maxConcurrentPositions: 2, maxMarginUtilizationPct: 70, validDays: 7
  }, { nowMs: Date.parse("2026-08-19T00:00:00Z") });
  assert.equal(payload.status, "paused");
  assert.equal(payload.maxLeverageBySymbol["BTC/USDT"], 2);
  assert.equal(payload.maxLeverageBySymbol["ETH/USDT"], 4);
});
```

- [ ] **Step 2: Run the test and verify the shared model is missing**

Run: `node --test tests/risk-form-model.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Move payload/save logic from `mobile.jsx` into the shared model**

Move the behavior of `buildMobileRiskPermissionPayload` and `submitMobileRiskChange` without changing field names, status preservation, or endpoints. Return `{ ok: false, error }` on failure so the form remains open; wrap the exact successful server payload as `{ ok: true, result }`.

```js
export async function submitRiskChange(action, endpoint, body, method = "POST") {
  const result = await action(endpoint, body, method);
  return result?.ok === false ? { ok: false, error: result.error || "save_failed" } : { ok: true, result };
}
```

- [ ] **Step 4: Implement posture, mandate, and rules pages**

Posture leads with effective runtime, current blockers, recovery, budgets, event windows, incidents, and audit readiness. Mandate groups allowed markets, capital, leverage, loss limits, execution/approval mode, and effect summary. Rules is a registry with enabled state, deterministic condition, latest trigger, and exact save result. Use the same fields and controls at every width.

```jsx
const pages = {
  posture: <RiskPosturePage data={data} ui={ui} />,
  mandate: <MandatePage data={data} action={action} ui={ui} />,
  rules: <RiskRulesPage data={data} action={action} ui={ui} />
};
return <WorkspaceFrame header={header} navigation={localNavigation}>{pages[page] || pages.posture}</WorkspaceFrame>;
```

- [ ] **Step 5: Run risk regressions and commit**

Run: `node --test tests/risk-form-model.test.mjs tests/render-smoke.test.mjs tests/mandate-policy.test.mjs tests/professional-risk-gate.test.mjs tests/event-risk-window.test.mjs`

Expected: PASS.

```bash
git add src/workspaces/risk/RiskWorkspace.jsx src/workspaces/risk/RiskPosturePage.jsx src/workspaces/risk/MandatePage.jsx src/workspaces/risk/RiskRulesPage.jsx src/workspaces/risk/riskFormModel.js src/app/WorkspaceOutlet.jsx tests/risk-form-model.test.mjs tests/render-smoke.test.mjs
git commit -m "feat: rebuild shared risk workspace"
```

---

### Task 12: Rebuild Operations as Health and Fact Traces

**Files:**
- Create: `src/workspaces/ops/OpsWorkspace.jsx`
- Create: `src/workspaces/ops/SystemHealthPage.jsx`
- Create: `src/workspaces/ops/EventsPage.jsx`
- Create: `src/workspaces/ops/TasksPage.jsx`
- Create: `src/workspaces/ops/AuditPage.jsx`
- Create: `src/workspaces/ops/NotificationsPage.jsx`
- Create: `src/workspaces/ops/eventCalendarModel.js`
- Create: `tests/event-calendar-model.test.mjs`
- Modify: `src/app/WorkspaceOutlet.jsx`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Produces: `shiftCalendarSelection(monthAnchor, selectedDate, offset)` and `refreshEventCalendar(action)` shared by all viewports.

- [ ] **Step 1: Move calendar edge cases into a failing shared test**

```js
test("date-only events remain untimed and month movement keeps selection aligned", () => {
  const result = shiftCalendarSelection(new Date("2026-08-01T00:00:00Z"), "2026-08-31", 1);
  assert.equal(result.monthAnchor.getFullYear(), 2026);
  assert.equal(result.monthAnchor.getMonth(), 8);
  assert.equal(result.selectedDate, "2026-09-30");
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test tests/event-calendar-model.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Extract calendar and refresh behavior from `mobile.jsx`**

Preserve official date-only semantics, precise-time labels, month clamping, source metadata, refresh endpoint chain, and failure result. The shared model must not turn a date-only event into a minute-level blackout.

```js
export async function refreshEventCalendar(action) {
  const eventSources = await action("/api/event-sources/refresh", {});
  const marketIntelligence = await action("/api/market-intelligence/refresh", {});
  return { eventSources, marketIntelligence };
}
```

- [ ] **Step 4: Implement five Ops pages from shared templates**

Health uses a service matrix plus recent Agent run trace and recovery status. Events uses calendar/list/detail with source and timing precision. Tasks uses schedule, owner, last result, next run, pause/run actions. Audit uses immutable chronological facts and filters. Notifications uses unread/read state and deep links; opening notifications calls the existing read endpoint once.

```jsx
<EvidenceTrace items={run.steps.map((step) => ({ label: step.phase, value: step.summary, status: step.status }))} />
```

- [ ] **Step 5: Run Ops tests and commit**

Run: `node --test tests/event-calendar-model.test.mjs tests/render-smoke.test.mjs tests/scheduled-events.test.mjs tests/scheduled-event-preparation.test.mjs tests/audit-chain-no-auto-reseal.test.mjs`

Expected: PASS.

```bash
git add src/workspaces/ops/OpsWorkspace.jsx src/workspaces/ops/SystemHealthPage.jsx src/workspaces/ops/EventsPage.jsx src/workspaces/ops/TasksPage.jsx src/workspaces/ops/AuditPage.jsx src/workspaces/ops/NotificationsPage.jsx src/workspaces/ops/eventCalendarModel.js src/app/WorkspaceOutlet.jsx tests/event-calendar-model.test.mjs tests/render-smoke.test.mjs
git commit -m "feat: rebuild operations workspace"
```

---

### Task 13: Rebuild Settings with One Authoritative Home per Setting

**Files:**
- Create: `src/workspaces/settings/SettingsWorkspace.jsx`
- Create: `src/workspaces/settings/SettingsOverviewPage.jsx`
- Create: `src/workspaces/settings/SystemSettingsPage.jsx`
- Create: `src/workspaces/settings/ExchangeSettingsPage.jsx`
- Create: `src/workspaces/settings/NotificationSettingsPage.jsx`
- Create: `src/workspaces/settings/ModelSettingsPage.jsx`
- Create: `src/workspaces/settings/AgentSettingsPage.jsx`
- Create: `src/workspaces/settings/UserSubscriptionPage.jsx`
- Modify: `src/app/WorkspaceOutlet.jsx`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Consumes existing `ConfigPanel`/settings actions and current config shapes.
- Produces one `SettingsWorkspace` for all viewports and a permission gate before Owner records.

- [ ] **Step 1: Add failing route, uniqueness, and permission tests**

```js
test("settings give each configuration one home and protect admin data", () => {
  const exchange = render(React.createElement(C.SettingsWorkspace, { page: "exchange", data, action, ui }));
  const notifications = render(React.createElement(C.SettingsWorkspace, { page: "notifications", data, action, ui }));
  const denied = render(React.createElement(C.SettingsWorkspace, { page: "users", data: { ...data, user: { ...data.user, isOwner: false }, users: [{ name: "secret" }] }, action, ui }));
  assert.match(exchange, /OKX/);
  assert.doesNotMatch(exchange, /Telegram.*Lark.*Webhook/s);
  assert.match(notifications, /Telegram|Lark|Webhook/);
  assert.match(denied, /Owner 权限/);
  assert.doesNotMatch(denied, /secret/);
});
```

- [ ] **Step 2: Run the smoke test and verify missing workspace failure**

Run: `node --test tests/render-smoke.test.mjs`

Expected: FAIL because `SettingsWorkspace` is missing.

- [ ] **Step 3: Implement overview and system categories**

Overview shows configured vs effective state for services, OKX, notifications, models, Agents, user/subscription, backups, and security. System groups Environment & Services, Network Proxy, Data & Backup, and Sign-in & Credential Security. Every form includes scope, current server-confirmed value, change impact, submit progress, verified result, and failure detail.

```jsx
const publicPages = {
  overview: <SettingsOverviewPage data={data} action={action} ui={ui} />,
  system: <SystemSettingsPage data={data} action={action} ui={ui} />,
  exchange: <ExchangeSettingsPage data={data} action={action} ui={ui} />,
  notifications: <NotificationSettingsPage data={data} action={action} ui={ui} />,
  models: <ModelSettingsPage data={data} action={action} ui={ui} />,
  agents: <AgentSettingsPage data={data} action={action} ui={ui} />
};
```

- [ ] **Step 4: Implement exchange, notifications, models, Agents, users, and subscriptions**

Move the existing handlers without changing endpoints or secret-redaction behavior. Keep test-connection, key presence (never raw key), model routing, Agent profiles, avatar/password/TOTP flows, user role/status, registration applications, capacity, invitations, grants, and subscription status. Render `PermissionState` before accessing `data.users`, `data.subscriptions`, or applications when the user is not Owner.

```jsx
if (["users", "subscriptions"].includes(page) && data.user?.isOwner !== true) {
  return <PermissionState title={t("需要 Owner 权限", "Owner access required")} detail={t("用户和订阅数据仅对 Owner 开放。", "User and subscription data is available only to the Owner.")} />;
}
return publicPages[page] || <UserSubscriptionPage view={page} data={data} action={action} ui={ui} />;
```

- [ ] **Step 5: Run security/settings tests and commit**

Run: `node --test tests/render-smoke.test.mjs tests/vault-key-rotation.test.mjs tests/totp.test.mjs tests/auth-session-policy.test.mjs tests/public-registration.test.mjs`

Expected: PASS.

```bash
git add src/workspaces/settings/SettingsWorkspace.jsx src/workspaces/settings/SettingsOverviewPage.jsx src/workspaces/settings/SystemSettingsPage.jsx src/workspaces/settings/ExchangeSettingsPage.jsx src/workspaces/settings/NotificationSettingsPage.jsx src/workspaces/settings/ModelSettingsPage.jsx src/workspaces/settings/AgentSettingsPage.jsx src/workspaces/settings/UserSubscriptionPage.jsx src/app/WorkspaceOutlet.jsx tests/render-smoke.test.mjs
git commit -m "feat: rebuild settings workspace"
```

---

### Task 14: Migrate Mobile-Only Utilities and Remove the Duplicate Mobile Product

**Files:**
- Modify: `src/viewData.js`
- Modify: `src/workspaces/ai/intelligenceActions.js`
- Modify: `src/workspaces/risk/riskFormModel.js`
- Modify: `src/workspaces/ops/eventCalendarModel.js`
- Create: `src/app/instrumentLoader.js`
- Create: `src/app/PullToRefresh.jsx`
- Modify: `src/app/AuthenticatedApp.jsx`
- Modify: `tests/render-smoke.test.mjs`
- Modify: `docs/ui-function-map.md`
- Delete: `src/mobile.jsx`

**Interfaces:**
- Moves every still-used export from `mobile.jsx` to a shared owner before deletion.
- No component or test may import `MobileApp`, `NavDrawer`, or a `Mobile*` business page afterward.

- [ ] **Step 1: Inventory all remaining imports and exports**

Run:

```bash
rg -n "from ['\"]\./mobile|from ['\"]\.\./src/mobile|MobileApp|NavDrawer|Mobile[A-Z]" src tests
```

Expected: only known migration targets remain. Record each target in `docs/ui-function-map.md` with its new shared owner.

- [ ] **Step 2: Move pure mobile-only helpers to shared modules**

Move these behaviors and their existing tests:

```text
mobileDirectionKind                 -> src/viewData.js
buildMobileRiskPermissionPayload    -> buildRiskPermissionPayload in src/workspaces/risk/riskFormModel.js
submitMobileRiskChange              -> submitRiskChange in src/workspaces/risk/riskFormModel.js
refreshMobileIntelligence           -> refreshIntelligence in src/workspaces/ai/intelligenceActions.js
shiftMobileCalendarSelection        -> shiftCalendarSelection in src/workspaces/ops/eventCalendarModel.js
refreshMobileEventCalendar          -> refreshEventCalendar in src/workspaces/ops/eventCalendarModel.js
loadMobileInstrumentList            -> loadInstrumentList in src/app/instrumentLoader.js
```

Move pull-to-refresh into `src/app/PullToRefresh.jsx`. It wraps the shared workspace content only on touch-capable native/mobile layouts, calls the existing shared `refresh`, keeps the 66px threshold, and uses the existing `haptic("light")`; it must not own any business route or page.

Update test imports first, run them failing against the missing new names, then move the implementations unchanged and rerun.

- [ ] **Step 3: Prove every mobile route resolves to the shared manifest**

```js
for (const legacy of ["chat", "watch", "cockpit", "executionReview", "tradeLedger", "riskHub", "knowledgeBase", "capabilityLib", "strategyLib", "intelligence", "eventsTasks", "auditSystem", "systemSettings"]) {
  const location = resolveWorkspaceTarget(legacy, { isOwner: true });
  assert.ok(location.workspace && location.page, `${legacy} must resolve`);
}
```

- [ ] **Step 4: Delete the duplicate mobile tree and update smoke exports**

Remove `MobileApp`, `NavDrawer`, mobile route arrays, duplicate pages, `KillConfirmDialog`, and the import from `main.jsx`. Keep native safe-area, haptics, pull-to-refresh, and connection recovery as small shared shell behaviors conditioned by capability/CSS, not separate business components.

Run:

```bash
rg -n "MobileApp|mShell2|mNativeTabbar|from ['\"].*mobile" src tests
```

Expected: no matches.

- [ ] **Step 5: Run parity tests and commit**

Run: `node --test tests/workspace-navigation.test.mjs tests/ui-foundation.test.mjs tests/risk-form-model.test.mjs tests/event-calendar-model.test.mjs tests/render-smoke.test.mjs && npm run build`

Expected: PASS.

```bash
git add src/viewData.js src/workspaces/ai/intelligenceActions.js src/workspaces/risk/riskFormModel.js src/workspaces/ops/eventCalendarModel.js src/app/instrumentLoader.js src/app/PullToRefresh.jsx src/app/AuthenticatedApp.jsx tests/render-smoke.test.mjs docs/ui-function-map.md
git rm src/mobile.jsx
git commit -m "refactor: remove duplicate mobile product tree"
```

---

### Task 15: Remove Legacy Visual Code and Complete Functional Parity

**Files:**
- Modify: `src/styles.css`
- Modify: `src/ui/design-system.css`
- Modify: `src/main.jsx`
- Modify: `tests/render-smoke.test.mjs`
- Modify: `docs/ui-function-map.md`
- Delete: `src/conceptPages.jsx`
- Delete: `src/workspacePages.jsx`
- Delete: `src/workspace.css`
- Delete: `src/workspace-additions.css`
- Delete: `src/product-system.css`

**Interfaces:**
- Final authenticated UI imports only `src/app`, `src/ui`, `src/workspaces`, shared factual selectors, and existing functional panels/chat helpers.

- [ ] **Step 1: Make the compatibility removal fail visibly**

Add source assertions to `tests/render-smoke.test.mjs`:

```js
const sourceFiles = fs.readdirSync(path.join(rootDir, "src"), { recursive: true }).filter((name) => /\.(jsx|js)$/.test(name));
const source = sourceFiles.map((name) => fs.readFileSync(path.join(rootDir, "src", name), "utf8")).join("\n");
assert.doesNotMatch(source, /conceptPages\.jsx|workspacePages\.jsx|MobileApp|isMobileViewport/);
```

Run: `node --test tests/render-smoke.test.mjs`

Expected: FAIL while legacy imports/files remain.

- [ ] **Step 2: Verify the function map before deletion**

For every row in `docs/ui-function-map.md`, mark the exact automated test and manually verify the new desktop and mobile path. No row may be removed; a deliberately retired function requires explicit user approval recorded in the document.

Run:

```bash
rg -n "\| (missing|unmapped|unchecked|pending) \|" docs/ui-function-map.md
```

Expected: no matches.

- [ ] **Step 3: Remove legacy components and orphaned authenticated CSS**

Delete the legacy component files after `rg` confirms no imports. In `styles.css`, retain login, connection recovery, charts, shared panels, confirmation host, and public landing styles still referenced. Remove orphaned authenticated selectors beginning with `.sidebar`, `.appTopbar`, `.ux`, `.cp2`, `.mShell2`, `.mNative`, `.mDrawer`, and their dedicated media blocks.

Run:

```bash
rg -n "className=\"[^\"]*(sidebar|appTopbar|ux|cp2|mShell2|mNative|mDrawer)" src
```

Expected: no matches before the corresponding CSS blocks are removed.

- [ ] **Step 4: Run accessibility and responsive visual checks**

Start the app with `npm run dev`, then inspect every page as Owner and subscriber at widths 390, 768, 1280, and 1440. Record pass/fail in `docs/ui-function-map.md` for:

```text
keyboard order and visible focus
44px minimum critical mobile targets
no color-only state communication
no clipped controls or accidental horizontal page scroll
all registry fields reachable on mobile
stale/degraded source and timestamp visible
dangerous-action confirmation and verified result visible
Chinese and English layouts
```

Capture representative screenshots for AI dialog, Trading overview, Market, Positions, Risk mandate, Ops health, and Settings at 390 and 1440. Store them under `artifacts/ui-redesign/` for review.

- [ ] **Step 5: Run the complete verification suite**

Run:

```bash
npm test
npm run lint
npm run build
```

Expected: all commands exit 0. Inspect the Vite output for unresolved imports or oversized accidental duplicate bundles.

- [ ] **Step 6: Commit the final cutover**

```bash
git add src/main.jsx src/styles.css src/ui/design-system.css tests/render-smoke.test.mjs docs/ui-function-map.md artifacts/ui-redesign
git rm --ignore-unmatch src/conceptPages.jsx src/workspacePages.jsx src/workspace.css src/workspace-additions.css src/product-system.css
git commit -m "feat: complete responsive UI UX redesign"
```
