# KORDYN V2 Foundation and Shared Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish an isolated, reversible V2 authenticated frontend boundary with four-domain routing, shared truth/state/action models, concept-faithful Desktop and APP shells, and a reproducible visual test harness.

**Architecture:** `src/main.jsx` keeps authentication and `useApi()` ownership, then selects either the legacy authenticated tree or a lazy `KordynV2Root`. The V2 root owns navigation, canonical selection, Account Truth modes, and device composition while delegating domain content to lazy modules. V2 CSS is scoped and split from `productStyles.js`; public marketing and auth remain on `entry.css`.

**Tech Stack:** React 18, Vite 6, plain CSS, lucide-react, `sharp`, Node `node:test`, CDP-driven headless Chrome.

**Spec:** `docs/superpowers/specs/2026-08-26-kordyn-concept-faithful-product-rebuild-design.md`

## Global Constraints

- Preserve all global constraints from `docs/superpowers/plans/2026-08-26-kordyn-v2-rebuild-program.md`.
- Do not change public marketing or authentication components/CSS.
- Do not remove or restyle the legacy authenticated tree in this plan.
- The V2 switch defaults to legacy until final cutover; development preview overrides are honored only in development or when `VITE_ALLOW_KORDYN_V2_PREVIEW=true`.
- New CSS lives only under `src/kordynV2/styles/` or a domain’s V2 folder; no import of `productStyles.js` from V2 modules.
- The four-domain registry and the 66-capability ownership table fail closed on unknown IDs.

---

### Task 1: Four-domain architecture and 66-capability ownership

**Files:**
- Create: `src/kordynV2/architecture/domains.js`
- Create: `src/kordynV2/architecture/routes.js`
- Create: `src/kordynV2/architecture/capabilityOwnership.js`
- Create: `tests/kordyn-v2-architecture.test.mjs`

**Interfaces:**
- Consumes: `DEPLOYED_FEATURES` from `src/productCoverage.js`; `resolveDesktopRoute()` and `resolveMobileRoute()` from `src/productArchitecture.js`.
- Produces: `KORDYN_V2_DOMAINS`, `KORDYN_V2_DOMAIN_IDS`, `KORDYN_V2_WORKSPACES`, `domainForCapability(id)`, `resolveV2Location(route, device)`, and `v2LocationForWorkspace(domainId, workspaceId, device)`.

- [ ] **Step 1: Write the failing architecture test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { DEPLOYED_FEATURES } from "../src/productCoverage.js";
import {
  KORDYN_V2_DOMAINS,
  KORDYN_V2_DOMAIN_IDS,
  KORDYN_V2_WORKSPACES
} from "../src/kordynV2/architecture/domains.js";
import { domainForCapability } from "../src/kordynV2/architecture/capabilityOwnership.js";
import { resolveV2Location, v2LocationForWorkspace } from "../src/kordynV2/architecture/routes.js";

test("V2 exposes exactly four domains and all 66 production capabilities", () => {
  assert.deepEqual(KORDYN_V2_DOMAIN_IDS, ["ai", "account", "assets", "governance"]);
  assert.deepEqual(KORDYN_V2_DOMAINS.map((row) => row.label), ["AI 交易员", "账户交易", "智能资产", "系统治理"]);
  assert.equal(DEPLOYED_FEATURES.length, 66);
  assert.equal(new Set(DEPLOYED_FEATURES.map((row) => row.id)).size, 66);
  for (const feature of DEPLOYED_FEATURES) {
    const owner = domainForCapability(feature.id);
    assert.ok(owner, feature.id);
    assert.ok(KORDYN_V2_DOMAIN_IDS.includes(owner.domainId), feature.id);
    assert.ok(KORDYN_V2_WORKSPACES[owner.domainId].some((row) => row.id === owner.workspaceId), feature.id);
  }
});

test("retired authenticated destinations cannot resolve", () => {
  for (const route of ["today", "more", "smartForms", "daoGovernance"]) {
    const location = resolveV2Location(route, "desktop");
    assert.equal(location.recognized, false);
    assert.equal(location.domainId, "ai");
    assert.equal(location.workspaceId, "missions");
  }
  assert.equal(JSON.stringify({ KORDYN_V2_DOMAINS, KORDYN_V2_WORKSPACES }).match(/今日|更多|智能表单|DAO\s*治理/i), null);
});

test("new routes retain existing production resource sections", () => {
  assert.deepEqual(v2LocationForWorkspace("account", "positions", "desktop"), {
    domainId: "account", workspaceId: "positions", legacyRoute: "positions",
    resourceSection: "cockpit", objectId: "", recognized: true
  });
  assert.equal(v2LocationForWorkspace("governance", "configuration", "mobile").resourceSection, "systemSettings");
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-architecture.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/kordynV2/architecture/domains.js`.

- [ ] **Step 3: Implement immutable domains and route compatibility**

```js
// src/kordynV2/architecture/domains.js
const workspace = (id, label, legacyRoute, resourceSection) => Object.freeze({ id, label, legacyRoute, resourceSection });

export const KORDYN_V2_DOMAINS = Object.freeze([
  Object.freeze({ id: "ai", label: "AI 交易员", truthMode: "full", defaultWorkspace: "missions" }),
  Object.freeze({ id: "account", label: "账户交易", truthMode: "full", defaultWorkspace: "market" }),
  Object.freeze({ id: "assets", label: "智能资产", truthMode: "compact", defaultWorkspace: "relationships" }),
  Object.freeze({ id: "governance", label: "系统治理", truthMode: "critical", defaultWorkspace: "overview" })
]);

export const KORDYN_V2_DOMAIN_IDS = Object.freeze(KORDYN_V2_DOMAINS.map((row) => row.id));

export const KORDYN_V2_WORKSPACES = Object.freeze({
  ai: Object.freeze([
    workspace("missions", "任务", "chat", "chat"), workspace("intelligence", "情报", "intelligence", "operationsCenter"),
    workspace("watch", "观察哨", "watch", "chat"), workspace("events", "事件日历", "eventsTasks:events", "operationsCenter"),
    workspace("dialog", "对话", "chat", "chat")
  ]),
  account: Object.freeze([
    workspace("market", "市场", "market", "cockpit"), workspace("account", "账户", "marketAccount", "cockpit"),
    workspace("positions", "持仓", "positions", "cockpit"), workspace("plans", "计划", "executionReview", "cockpit"),
    workspace("orders", "订单", "tradeLedger", "cockpit"), workspace("fills", "成交", "tradeLedger", "cockpit")
  ]),
  assets: Object.freeze([
    workspace("relationships", "关系总览", "labMap", "researchCenter"), workspace("strategies", "策略库", "strategyLib", "researchCenter"),
    workspace("knowledge", "知识库", "knowledgeBase", "researchCenter"), workspace("capabilities", "能力库", "capabilityLib", "researchCenter"),
    workspace("reviews", "复盘与发布", "labReviews", "researchCenter")
  ]),
  governance: Object.freeze([
    workspace("overview", "运行总览", "riskOverview", "riskCenter"), workspace("runs", "任务与运行", "operationsCenter:tasks", "operationsCenter"),
    workspace("event-inputs", "事件输入", "eventRisk", "riskCenter"), workspace("notifications", "通知", "operationsCenter:notifications", "operationsCenter"),
    workspace("audit", "审计", "operationsCenter:audit", "operationsCenter"), workspace("recovery", "恢复", "operationsCenter:recovery", "operationsCenter"),
    workspace("configuration", "配置", "systemSettings", "systemSettings")
  ])
});
```

Implement `capabilityOwnership.js` with one explicit entry for every capability ID in `docs/kordyn-v2-capability-migration-matrix.md`; do not derive ownership from string prefixes because `control.*`, `operations.*`, and `configuration.*` converge into one domain but different workspaces.

- [ ] **Step 4: Run GREEN and existing route regression**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-architecture.test.mjs tests/product-architecture.test.mjs tests/mobile-navigation.test.mjs`

Expected: PASS with `66` distinct deployed features and no retired V2 destination.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/architecture tests/kordyn-v2-architecture.test.mjs
git commit -m "feat: define KORDYN V2 domain architecture"
```

### Task 2: Reversible authenticated cutover and bundle isolation

**Files:**
- Create: `src/kordynV2/cutover.js`
- Create: `src/kordynV2/KordynV2Root.jsx`
- Create: `src/kordynV2/entry.jsx`
- Create: `src/kordynV2/styles/tokens.css`
- Create: `src/kordynV2/styles/shell.css`
- Modify: `src/main.jsx`
- Create: `tests/kordyn-v2-cutover.test.mjs`

**Interfaces:**
- Consumes: the existing `useApi()` return value and existing public/auth rendering in `src/main.jsx`.
- Produces: `DEFAULT_KORDYN_UI_VERSION`, `resolveKordynUiVersion(env, storage)`, lazy `KordynV2Root({ api, lang, switchLang })`, and an authenticated-only V2 CSS boundary.

- [ ] **Step 1: Write the failing cutover test**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_KORDYN_UI_VERSION, resolveKordynUiVersion } from "../src/kordynV2/cutover.js";

test("production cutover is build-configured and preview override is fail closed", () => {
  assert.equal(DEFAULT_KORDYN_UI_VERSION, "legacy");
  assert.equal(resolveKordynUiVersion({ PROD: true, VITE_KORDYN_UI_VERSION: "v2" }, null), "v2");
  assert.equal(resolveKordynUiVersion({ PROD: true, VITE_KORDYN_UI_VERSION: "legacy" }, { getItem: () => "v2" }), "legacy");
  assert.equal(resolveKordynUiVersion({ DEV: true }, { getItem: () => "v2" }), "v2");
  assert.equal(resolveKordynUiVersion({ PROD: true, VITE_KORDYN_UI_VERSION: "garbage" }, null), "legacy");
});

test("V2 and legacy authenticated styles are mutually exclusive", () => {
  const main = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const entry = readFileSync(new URL("../src/kordynV2/entry.jsx", import.meta.url), "utf8");
  assert.match(main, /resolveKordynUiVersion/);
  assert.match(main, /import\("\.\/kordynV2\/entry\.jsx"\)/);
  assert.match(main, /import\("\.\/productStyles\.js"\)/);
  assert.match(entry, /styles\/tokens\.css/);
  assert.match(entry, /styles\/shell\.css/);
  assert.doesNotMatch(entry, /productStyles|styles\.css|zero-base|product-foundation/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-cutover.test.mjs`

Expected: FAIL because the V2 cutover modules do not exist.

- [ ] **Step 3: Implement the cutover function and lazy entry**

```js
// src/kordynV2/cutover.js
export const DEFAULT_KORDYN_UI_VERSION = "legacy";

export function resolveKordynUiVersion(env = {}, storage = globalThis.sessionStorage) {
  const raw = env.VITE_KORDYN_UI_VERSION;
  const configured = raw === "v2" || raw === "legacy" ? raw : raw ? "legacy" : DEFAULT_KORDYN_UI_VERSION;
  const previewAllowed = env.DEV === true || env.VITE_ALLOW_KORDYN_V2_PREVIEW === "true";
  if (!previewAllowed) return configured;
  const preview = storage?.getItem?.("kordyn_ui_version");
  return preview === "v2" || preview === "legacy" ? preview : configured;
}
```

In `src/main.jsx`, keep all existing auth/loading/connection branches first. After authoritative `data` exists, branch on `uiVersion`:

```jsx
if (uiVersion === "v2") {
  return <AppFrame authenticated><Suspense fallback={<AuthenticatedV2BootState />}>
    <KordynV2Root api={{ data, action, toast, busy, notify, download, refresh, ensureSection, connectionError }} lang={lang} switchLang={switchLang} />
  </Suspense></AppFrame>;
}
```

Load `productStyles.js` only when `uiVersion === "legacy"`; load `./kordynV2/entry.jsx` only when `uiVersion === "v2"`. Do not move or alter the public/auth return branches.

- [ ] **Step 4: Run GREEN, public boundary tests, and build**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-cutover.test.mjs tests/zero-base-performance.test.mjs tests/landing-copy.test.mjs tests/zero-base-auth.test.mjs && npm run build`

Expected: PASS; public initial assets remain within their current budgets, and Vite emits a separate V2 authenticated chunk.

- [ ] **Step 5: Commit**

```bash
git add src/main.jsx src/kordynV2/cutover.js src/kordynV2/KordynV2Root.jsx src/kordynV2/entry.jsx src/kordynV2/styles/tokens.css src/kordynV2/styles/shell.css tests/kordyn-v2-cutover.test.mjs
git commit -m "feat: add reversible KORDYN V2 entry boundary"
```

### Task 3: Shared resource state, Account Truth, selection, and action contracts

**Files:**
- Create: `src/kordynV2/viewModels/state.js`
- Create: `src/kordynV2/viewModels/accountTruth.js`
- Create: `src/kordynV2/viewModels/selection.js`
- Create: `src/kordynV2/actions/createV2Actions.js`
- Create: `tests/kordyn-v2-state.test.mjs`
- Create: `tests/kordyn-v2-actions.test.mjs`
- Create: `tests/helpers/kordyn-v2-state-contract.mjs`

**Interfaces:**
- Consumes: `workspaceResourceRetainsLastValid()`, `resolveShellObjectSelection()`, `selectionForNavigation()`, `buildShellContext()`, and `buildShellTrace()` from `src/productShell.jsx`; `uiConfirm()` from `src/confirm.jsx`.
- Produces: `normalizeResourceState()`, `buildAccountTruth()`, `createV2Selection()`, `createV2Actions()`, and the shared test helper `assertStateContract(markup, expectedState)`.

- [ ] **Step 1: Write failing state and selection tests**

```js
test("unknown is not converted to zero and stale retains its source", () => {
  assert.deepEqual(buildAccountTruth({}, "full"), {
    mode: "full", equity: "Unavailable", available: "Unavailable", exposure: "Unavailable",
    freshness: "Unavailable", runtime: "Unavailable", risk: "Unavailable"
  });
  const state = normalizeResourceState({ resourceState: "stale", data: { asOf: "2026-08-26T00:00:00Z", source: "OKX" } });
  assert.deepEqual({ kind: state.kind, retainsLastValid: state.retainsLastValid, source: state.source }, { kind: "stale", retainsLastValid: true, source: "OKX" });
});

test("selection remains canonical across the V2 shell", () => {
  const selection = createV2Selection({ data: { positions: [{ positionId: "p-1", symbol: "BTC/USDT" }] }, candidate: { id: "p-1", type: "Position", workspaceId: "account" } });
  assert.equal(selection.object.id, "p-1");
  assert.equal(selection.context.objectId, "p-1");
  assert.equal(selection.trace.objectId, "p-1");
});
```

- [ ] **Step 2: Write failing protected-action tests**

```js
test("protected V2 actions call the existing confirm and endpoint once", async () => {
  const calls = [];
  const actions = createV2Actions({
    action: async (...args) => { calls.push(["action", ...args]); return { ok: true }; },
    confirm: async (...args) => { calls.push(["confirm", ...args]); return true; },
    notify: () => {}, download: () => {}, navigate: () => {}
  });
  await actions.global.reconcile();
  assert.equal(calls[0][0], "confirm");
  assert.deepEqual(calls[1], ["action", "/api/reconciler/run", { mode: "manual_ui" }]);
});

test("cancelled confirmation produces no write", async () => {
  let writes = 0;
  const actions = createV2Actions({ action: async () => { writes += 1; }, confirm: async () => false });
  await actions.global.flattenAll();
  assert.equal(writes, 0);
});
```

- [ ] **Step 3: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-state.test.mjs tests/kordyn-v2-actions.test.mjs`

Expected: FAIL with missing V2 view-model and action modules.

- [ ] **Step 4: Implement fail-closed models and a namespaced action facade**

`createV2Actions()` must expose these stable namespaces even before later plans fill their domain-specific methods:

```js
return Object.freeze({
  ai: Object.freeze({}),
  account: Object.freeze({}),
  assets: Object.freeze({}),
  governance: Object.freeze({}),
  global: Object.freeze({ reconcile, flattenAll, setKillSwitch, navigate, download })
});
```

Use the deployed endpoints `/api/reconciler/run`, `/api/risk/emergency-flatten`, and `/api/risk/kill-switch`. Return the server result without replacing it with local success.

The test helper parses markup and requires the exact state marker, a non-empty heading/message, no `undefined`/`NaN`, and last-valid source/time for stale or degraded states:

```js
export function assertStateContract(markup, expectedState) {
  assert.match(markup, new RegExp(`data-kordyn-v2-state=["']${expectedState}["']`));
  assert.doesNotMatch(markup, /undefined|NaN/);
  if (["stale", "degraded"].includes(expectedState)) {
    assert.match(markup, /data-kordyn-v2-last-valid-source=/);
    assert.match(markup, /data-kordyn-v2-last-valid-at=/);
  }
}
```

- [ ] **Step 5: Run GREEN and canonical regression**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-state.test.mjs tests/kordyn-v2-actions.test.mjs tests/view-data-parity.test.mjs tests/product-architecture.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/kordynV2/viewModels src/kordynV2/actions tests/kordyn-v2-state.test.mjs tests/kordyn-v2-actions.test.mjs tests/helpers/kordyn-v2-state-contract.mjs
git commit -m "feat: add V2 truth state and action contracts"
```

### Task 4: Concept-faithful Desktop shell

**Files:**
- Create: `src/kordynV2/shell/DesktopShell.jsx`
- Create: `src/kordynV2/shell/PrimaryNavigation.jsx`
- Create: `src/kordynV2/shell/WorkspaceNavigation.jsx`
- Create: `src/kordynV2/shell/AccountTruth.jsx`
- Create: `src/kordynV2/shell/StateBoundary.jsx`
- Create: `src/kordynV2/shell/ContextProof.jsx`
- Modify: `src/kordynV2/KordynV2Root.jsx`
- Modify: `src/kordynV2/styles/tokens.css`
- Modify: `src/kordynV2/styles/shell.css`
- Create: `tests/kordyn-v2-shell.test.mjs`
- Create: `tests/kordyn-v2-shell-browser.html`
- Create: `tests/kordyn-v2-shell-browser.jsx`
- Create: `tests/kordyn-v2-production-fixture.js`
- Create: `tests/run-kordyn-v2-shell-browser.mjs`

**Interfaces:**
- Consumes: domain/workspace registry, `buildAccountTruth()`, `normalizeResourceState()`, and `createV2Selection()`.
- Produces: `DesktopShell({ location, truth, state, selection, onNavigate, onSelect, children })` and stable browser selectors prefixed `data-kordyn-v2-*`.

- [ ] **Step 1: Write the failing shell contract**

```js
test("Desktop shell follows the approved four-domain composition", () => {
  const html = renderToStaticMarkup(<DesktopShell location={{ domainId: "ai", workspaceId: "missions" }} truth={truth} state={{ kind: "ready" }} selection={selection} onNavigate={() => {}}>{<main />}</DesktopShell>);
  assert.match(html, /data-kordyn-v2-shell="desktop"/);
  assert.equal((html.match(/data-kordyn-v2-domain-target=/g) || []).length, 4);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 2);
  for (const label of ["AI 交易员", "账户交易", "智能资产", "系统治理", "任务", "情报", "观察哨", "事件日历", "对话"]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /今日|更多/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-shell.test.mjs`

Expected: FAIL because `DesktopShell.jsx` does not exist.

- [ ] **Step 3: Implement shell markup and the visual contract**

The root contract is:

```jsx
<div data-kordyn-v2-shell="desktop" data-kordyn-v2-domain={location.domainId} data-kordyn-v2-workspace={location.workspaceId} data-kordyn-v2-selected-id={selection?.object?.id || "none"}>
  <PrimaryNavigation />
  <header><WorkspaceNavigation /><AccountTruth mode={truth.mode} /></header>
  <StateBoundary state={state}><main>{children}</main></StateBoundary>
  <ContextProof selection={selection} />
</div>
```

Match the normalized `desktop-ai-mission-control.png` shell at `1440x900`: navigation width, top truth band height, work-canvas inset, dominant midnight/graphite fields, cobalt active state, mint/violet relationship accents, restrained glow, border weight, and typography hierarchy. At `1180x800`, keep both navigation levels visible and reduce gutters/density without switching to the mobile shell.

- [ ] **Step 4: Add real keyboard and geometry assertions to the browser harness**

The harness must click each of the four domain buttons, assert one global and one local active item, open/close Context/Proof with keyboard, confirm focus return, and verify:

```js
assert.deepEqual([document.documentElement.clientWidth, document.documentElement.scrollWidth], [width, width]);
assert.equal(root.querySelectorAll('[data-kordyn-v2-domain-target][aria-current="page"]').length, 1);
assert.equal(root.querySelectorAll('[data-kordyn-v2-workspace-target][aria-current="page"]').length, 1);
```

- [ ] **Step 5: Run GREEN at both Desktop sizes**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-shell.test.mjs && KORDYN_V2_SCREENSHOT_DIR=.impeccable/review/kordyn-v2/foundation node tests/run-kordyn-v2-shell-browser.mjs --desktop-only`

Expected: PASS at `1440x900` and `1180x800`, with valid screenshots and no overflow.

- [ ] **Step 6: Commit**

```bash
git add src/kordynV2/shell src/kordynV2/KordynV2Root.jsx src/kordynV2/styles tests/kordyn-v2-shell.test.mjs tests/kordyn-v2-shell-browser.html tests/kordyn-v2-shell-browser.jsx tests/kordyn-v2-production-fixture.js tests/run-kordyn-v2-shell-browser.mjs
git commit -m "feat: build concept-faithful V2 desktop shell"
```

### Task 5: Touch-first APP shell

**Files:**
- Create: `src/kordynV2/shell/MobileShell.jsx`
- Create: `src/kordynV2/shell/MobileBottomNavigation.jsx`
- Create: `src/kordynV2/shell/MobileSheet.jsx`
- Create: `src/kordynV2/shell/useV2Viewport.js`
- Create: `src/kordynV2/styles/mobile-shell.css`
- Modify: `src/kordynV2/entry.jsx`
- Modify: `src/kordynV2/KordynV2Root.jsx`
- Modify: `tests/kordyn-v2-shell.test.mjs`
- Modify: `tests/kordyn-v2-shell-browser.jsx`

**Interfaces:**
- Consumes: the same `location`, `truth`, `state`, `selection`, and action contracts as Desktop.
- Produces: `MobileShell()` with exactly four bottom destinations, domain-local workspace navigation, safe-area layout, and bounded sheets.

- [ ] **Step 1: Extend the failing component test**

```js
test("APP shell has four full-label roots and no catch-all destination", () => {
  const html = renderToStaticMarkup(<MobileShell location={{ domainId: "ai", workspaceId: "missions" }} truth={truth} state={{ kind: "ready" }} selection={selection} onNavigate={() => {}}>{<main />}</MobileShell>);
  assert.match(html, /data-kordyn-v2-shell="mobile"/);
  assert.equal((html.match(/data-kordyn-v2-domain-target=/g) || []).length, 4);
  for (const label of ["AI 交易员", "账户交易", "智能资产", "系统治理"]) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /今日|更多/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-shell.test.mjs`

Expected: FAIL because the mobile shell modules do not exist.

- [ ] **Step 3: Implement mobile composition and safe areas**

Use `padding-top: env(safe-area-inset-top)` and `padding-bottom: calc(var(--v2-mobile-nav-height) + env(safe-area-inset-bottom))`. Every bottom-nav and sheet action has a minimum block/inline size of `44px`. Context/Proof uses `MobileSheet`, never a desktop side rail.

- [ ] **Step 4: Extend the browser runner to real touch-size navigation**

At `390x844` and `430x932`, click all four roots, open and close a sheet, assert a single active root, check every visible interactive element in the bottom bar is at least `44x44`, and assert no content is covered by the safe-area navigation.

- [ ] **Step 5: Run GREEN at both APP sizes**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-shell.test.mjs && KORDYN_V2_SCREENSHOT_DIR=.impeccable/review/kordyn-v2/foundation node tests/run-kordyn-v2-shell-browser.mjs --mobile-only`

Expected: PASS at `390x844` and `430x932` with no document overflow.

- [ ] **Step 6: Commit**

```bash
git add src/kordynV2/shell/MobileShell.jsx src/kordynV2/shell/MobileBottomNavigation.jsx src/kordynV2/shell/MobileSheet.jsx src/kordynV2/shell/useV2Viewport.js src/kordynV2/styles/mobile-shell.css src/kordynV2/entry.jsx src/kordynV2/KordynV2Root.jsx tests/kordyn-v2-shell.test.mjs tests/kordyn-v2-shell-browser.jsx
git commit -m "feat: build KORDYN V2 APP shell"
```

### Task 6: Read-only floating AI 客服

**Files:**
- Create: `src/kordynV2/shell/AiSupport.jsx`
- Create: `src/kordynV2/viewModels/aiSupport.js`
- Modify: `src/kordynV2/shell/DesktopShell.jsx`
- Modify: `src/kordynV2/shell/MobileShell.jsx`
- Create: `tests/kordyn-v2-ai-support.test.mjs`
- Modify: `tests/kordyn-v2-shell-browser.jsx`

**Interfaces:**
- Consumes: visible page facts, `selection`, and a `navigate(route)` callback.
- Produces: `buildAiSupportContext()` and `AiSupport({ context, onNavigate })`; it receives no write-capable `action` callback.

- [ ] **Step 1: Write the failing read-only boundary test**

```js
test("AI support exposes explanation and navigation without write authority", () => {
  const context = buildAiSupportContext({ data, location, selection });
  assert.deepEqual(Object.keys(context).sort(), ["facts", "location", "selection", "state"]);
  const source = readFileSync(new URL("../src/kordynV2/shell/AiSupport.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\baction\b|\/api\/|approve|cancel|close|publish/i);
  assert.match(source, /只读|Read-only/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-support.test.mjs`

Expected: FAIL because the new support component does not exist.

- [ ] **Step 3: Implement the approved Desktop control and APP governed sheet**

Desktop uses a floating minimized control plus bounded panel. APP opens a `MobileSheet`. Both support explain, diagnose, and navigate responses from accessible facts; they never receive `createV2Actions()`.

- [ ] **Step 4: Run GREEN and browser boundary checks**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-ai-support.test.mjs && node tests/run-kordyn-v2-shell-browser.mjs`

Expected: PASS; opening, keyboard close, focus return, mobile sheet geometry, and read-only label are verified.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/shell/AiSupport.jsx src/kordynV2/viewModels/aiSupport.js src/kordynV2/shell/DesktopShell.jsx src/kordynV2/shell/MobileShell.jsx tests/kordyn-v2-ai-support.test.mjs tests/kordyn-v2-shell-browser.jsx
git commit -m "feat: add governed read-only AI support"
```

### Task 7: Visual fidelity and performance harness

**Files:**
- Create: `tests/kordyn-v2-concept-manifest.mjs`
- Create: `scripts/compare-kordyn-v2-concepts.mjs`
- Create: `tests/kordyn-v2-performance.test.mjs`
- Create: `tests/kordyn-v2-performance-report.mjs`
- Create: `tests/run-kordyn-v2-performance-build.mjs`
- Create: `docs/kordyn-v2-evidence.md`

**Interfaces:**
- Consumes: the 15 approved concept files and actual V2 production components rendered with non-sensitive production-shaped fixtures.
- Produces: target-size screenshots, normalized references, 50% overlays, absolute-difference images, region geometry JSON, route-chunk size output, and an evidence index.

- [ ] **Step 1: Write the failing manifest and performance tests**

```js
test("the visual manifest pins all approved source hashes and target viewports", async () => {
  assert.equal(CONCEPTS.length, 15);
  for (const concept of CONCEPTS) {
    assert.ok(["1440x900", "1180x800", "390x844", "430x932"].some((size) => concept.targets.includes(size)));
    assert.equal(await sha256(concept.file), concept.sha256);
  }
});

test("V2 build keeps public and route CSS budgets", async () => {
  const report = await buildV2PerformanceReport();
  assert.ok(report.public.css < 40_000);
  assert.ok(report.public.js < 450_000);
  assert.ok(report.routes.aiShell.css < 180_000);
  assert.equal(report.routes.aiShell.loadsLegacyProductStyles, false);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-performance.test.mjs && node tests/run-kordyn-v2-performance-build.mjs`

Expected: FAIL because the manifest and isolated V2 build runner do not exist.

- [ ] **Step 3: Implement normalized comparison output without adding a dependency**

Use the existing `sharp` dependency:

```js
const reference = await sharp(concept.file).resize(width, height, { fit: "fill" }).png().toBuffer();
await sharp(reference).composite([{ input: screenshot, blend: "difference" }]).png().toFile(diffPath);
await sharp(reference).composite([{ input: screenshot, blend: "over", opacity: 0.5 }]).png().toFile(overlayPath);
```

The script must reject missing/blank screenshots, mismatched dimensions, missing reference hashes, and document overflow. Pixel difference is diagnostic; geometry assertions and human region review remain the release verdict because production text/data are dynamic.

- [ ] **Step 4: Run GREEN and create the first foundation evidence**

Run:

```bash
node scripts/run-tests-isolated.mjs tests/kordyn-v2-architecture.test.mjs tests/kordyn-v2-cutover.test.mjs tests/kordyn-v2-state.test.mjs tests/kordyn-v2-actions.test.mjs tests/kordyn-v2-shell.test.mjs tests/kordyn-v2-ai-support.test.mjs tests/kordyn-v2-performance.test.mjs
KORDYN_V2_SCREENSHOT_DIR=.impeccable/review/kordyn-v2/foundation node tests/run-kordyn-v2-shell-browser.mjs
node scripts/compare-kordyn-v2-concepts.mjs --screenshots .impeccable/review/kordyn-v2/foundation --output .impeccable/review/kordyn-v2/foundation-compare --scope shell
node tests/run-kordyn-v2-performance-build.mjs
npm run build
git diff --check
```

Expected: all commands exit `0`; screenshots are valid at all four viewports; foundation AI-shell CSS stays below `180 KiB`; route-size output identifies V2 chunks separately from legacy chunks. Plans 02–05 add their domain budgets to this test as those chunks are created.

- [ ] **Step 5: Review the foundation before domain work**

Open the four shell screenshots and normalized comparison images. Review navigation count/labels, shell proportions, Account Truth mode, Context/Proof, AI 客服, active/focus states, and APP safe areas against the approved concepts. Record differences in `docs/kordyn-v2-evidence.md`; a material difference blocks Plan 02.

- [ ] **Step 6: Commit**

```bash
git add tests/kordyn-v2-concept-manifest.mjs scripts/compare-kordyn-v2-concepts.mjs tests/kordyn-v2-performance.test.mjs tests/kordyn-v2-performance-report.mjs tests/run-kordyn-v2-performance-build.mjs docs/kordyn-v2-evidence.md .impeccable/review/kordyn-v2/foundation .impeccable/review/kordyn-v2/foundation-compare
git commit -m "test: gate KORDYN V2 shell fidelity and performance"
```
