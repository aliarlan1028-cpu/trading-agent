# KORDYN Global UI/UX Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicate mobile navigation and converge every authenticated desktop/mobile deep surface on the approved KORDYN operating-system UI without losing deployed behavior.

**Architecture:** A pure navigation contract becomes the single source for bottom tabs, workspace-local routes, and More utilities. Shared desktop/mobile surface primitives then normalize deep pages in bounded workspace batches; business view models, API actions, permissions, and compatibility routes remain unchanged.

**Tech Stack:** React 19, JavaScript/JSX, CSS, Vite, Node test runner, esbuild SSR smoke tests, ESLint.

**Spec:** `docs/superpowers/specs/2026-08-24-global-ui-convergence-design.md`

## Global Constraints

- Preserve accepted overview sections: `chat`, `cockpit`, `researchCenter`, `riskCenter`, `operationsCenter`, and `systemSettings`.
- Preserve existing API actions, permission checks, safety semantics, compatibility routes, and mobile authentication.
- Preserve every currently displayed field and permitted action through local navigation or progressive disclosure.
- More contains only Operations, Configuration, language, and true global utilities.
- No new product capability, synthetic runtime result, optimistic safety/execution success, marketing-page edit, or authentication-page edit.
- Use test-first development for every behavior or route change.
- Preserve unrelated dirty-worktree changes; never reset or overwrite them.
- Run the Impeccable detector exactly once after all UI edits.

---

### Task 1: Mobile Navigation Contract

**Files:**
- Create: `src/mobileNavigation.js`
- Create: `tests/mobile-navigation.test.mjs`
- Modify: `src/mobile.jsx`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Produces: `MOBILE_PRIMARY_NAV`, `MOBILE_WORKSPACE_NAV`, `MOBILE_MORE_UTILITIES`, `mobileWorkspaceDestinations(workspace)`.
- Consumes: existing route aliases resolved by `resolveMobileRoute()`.

- [ ] **Step 1: Write failing navigation-contract tests**

```js
test("More contains only global utilities", () => {
  assert.deepEqual(MOBILE_MORE_UTILITIES.map((item) => item.id), ["operationsCenter", "systemSettings"]);
});

test("workspace destinations are unique and never duplicated in More", () => {
  const owned = Object.values(MOBILE_WORKSPACE_NAV).flat().map((item) => item.id);
  const utilities = MOBILE_MORE_UTILITIES.map((item) => item.id);
  assert.equal(new Set(owned).size, owned.length);
  assert.equal(owned.some((id) => utilities.includes(id)), false);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/mobile-navigation.test.mjs`

Expected: FAIL because `src/mobileNavigation.js` and its exports do not exist.

- [ ] **Step 3: Implement the pure navigation model**

```js
export const MOBILE_PRIMARY_NAV = [
  { id: "chat", workspace: "ai" },
  { id: "cockpit", workspace: "trade" },
  { id: "labMap", workspace: "lab" },
  { id: "riskHub", workspace: "control" },
  { id: "more", workspace: "utilities" }
];
export const MOBILE_WORKSPACE_NAV = {
  ai: [{ id: "chat" }, { id: "watch" }, { id: "intelligence" }, { id: "eventsTasks" }],
  trade: [{ id: "cockpit" }, { id: "positions" }, { id: "executionReview" }, { id: "tradeLedger" }],
  lab: [{ id: "labMap" }, { id: "knowledgeBase" }, { id: "strategyLib" }, { id: "capabilityLib" }, { id: "labReviews" }],
  control: [{ id: "riskHub" }, { id: "riskSettings" }, { id: "eventRisk" }]
};
export const MOBILE_MORE_UTILITIES = [{ id: "operationsCenter" }, { id: "systemSettings" }];
export const mobileWorkspaceDestinations = (workspace) => MOBILE_WORKSPACE_NAV[workspace] || [];
```

Store presentation labels, codes, and hints in the same module as serializable data; map icon IDs to Lucide components inside `mobile.jsx`.

- [ ] **Step 4: Replace the duplicated drawer array**

Update `NavDrawer` so its feature list renders only `MOBILE_MORE_UTILITIES`. Keep language controls and the Configuration footer/utility treatment, but do not render AI, Live, Lab, or Control child routes in the drawer.

- [ ] **Step 5: Verify GREEN**

Run: `node --test tests/mobile-navigation.test.mjs tests/product-architecture.test.mjs tests/render-smoke.test.mjs`

Expected: PASS; SSR output for `NavDrawer` excludes `实时盯盘`, `委托与成交`, `研究地图`, and other workspace-owned entries.

- [ ] **Step 6: Commit the navigation contract**

```bash
git add src/mobileNavigation.js src/mobile.jsx tests/mobile-navigation.test.mjs tests/render-smoke.test.mjs
git commit -m "refactor: make mobile navigation workspace-owned"
```

---

### Task 2: Mobile Workspace-Local Navigation

**Files:**
- Modify: `src/mobile.jsx`
- Modify: `src/productArchitecture.js`
- Modify: `src/product-foundation.css`
- Modify: `src/styles.css`
- Modify: `tests/mobile-navigation.test.mjs`
- Modify: `tests/product-architecture.test.mjs`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Consumes: `mobileWorkspaceDestinations(workspace)` from Task 1.
- Produces: `MobileWorkspaceRail({ workspace, route, subPage, onNavigate })` and route-aware local navigation for AI, Live, Lab, and Control.

- [ ] **Step 1: Add failing rail and reachability tests**

```js
test("every removed drawer route has a workspace-local destination", () => {
  for (const workspace of ["ai", "trade", "lab", "control"]) {
    for (const destination of mobileWorkspaceDestinations(workspace)) {
      assert.equal(resolveMobileRoute(destination).workspace, workspace);
    }
  }
});
```

Extend render smoke assertions so AI contains `对话 / 情报 / 盯盘 / 事件`, Live contains `概览 / 持仓 / 执行 / 流水`, and Control contains its supported local destinations.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/mobile-navigation.test.mjs tests/product-architecture.test.mjs tests/render-smoke.test.mjs`

Expected: FAIL because AI, Live, and Control do not yet render local rails and one or more desired deep aliases are unresolved.

- [ ] **Step 3: Implement one shared rail**

```jsx
function MobileWorkspaceRail({ workspace, route, subPage, onNavigate }) {
  const items = mobileWorkspaceDestinations(workspace);
  return <nav className={`mWorkspaceRail mWorkspaceRail--${workspace}`} aria-label={workspaceLabel(workspace)}>
    {items.map((item) => <button type="button" key={item.id} className={isMobileDestinationActive(item, route, subPage) ? "active" : ""} onClick={() => onNavigate(item.id)}>{mobileNavLabel(item)}</button>)}
  </nav>;
}
```

Replace the Lab-only rail with the shared component while retaining Lab lifecycle copy. Render the rail inside the corresponding loaded workspace, not above loading/error boundaries.

- [ ] **Step 4: Add only the route aliases needed by the rails**

Map Live Positions to `cockpit:positions`, execution review to the existing review route, ledger to orders/fills, and Control destinations to current `riskCenter` views. Do not create new backend sections.

- [ ] **Step 5: Style the rail as an operational strip**

Use a single-pixel outer boundary, square controls, horizontal overflow on phone, acid-green current selection, and visible `:focus-visible`. Minimum mobile control height: 44px.

- [ ] **Step 6: Verify GREEN and commit**

Run: `node --test tests/mobile-navigation.test.mjs tests/product-architecture.test.mjs tests/render-smoke.test.mjs`

```bash
git add src/mobile.jsx src/productArchitecture.js src/product-foundation.css src/styles.css tests/mobile-navigation.test.mjs tests/product-architecture.test.mjs tests/render-smoke.test.mjs
git commit -m "feat: add workspace-local mobile navigation"
```

---

### Task 3: Shared Deep-Surface Visual Primitives

**Files:**
- Modify: `src/product-foundation.css`
- Modify: `src/product-system.css`
- Modify: `src/styles.css`
- Modify: `tests/product-foundation-css.test.mjs`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Produces shared class roles: `.kTruthBand`, `.kWorkbench`, `.kRegistry`, `.kInspector`, `.kEvidenceLedger`, `.kActionBar`, `.kFilterRail`, `.kFormSurface`, `.kEmptyState`, `.kStateRow` and mobile equivalents through responsive rules.
- Consumes existing `.kordynSystem` tokens and current Operations material grammar.

- [ ] **Step 1: Write failing CSS-contract tests**

```js
for (const token of ["--kordyn-paper", "--kordyn-ink", "--kordyn-acid", "--kordyn-line"]) assert.match(css, new RegExp(token));
for (const role of ["kTruthBand", "kWorkbench", "kRegistry", "kInspector", "kEvidenceLedger", "kActionBar", "kFormSurface"]) assert.match(css, new RegExp(`\\.${role}\\b`));
```

Add assertions that shared primitives do not use `linear-gradient`, `backdrop-filter`, or broad box shadows.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/product-foundation-css.test.mjs`

Expected: FAIL because the shared class roles are absent.

- [ ] **Step 3: Implement shared desktop primitives**

Define continuous grid rules, paper/ink truth bands, registry rows, inspector boundaries, action hierarchy, form controls, loading/empty/error states, hover and focus states in `product-foundation.css`. Use existing tokens; do not introduce a second palette.

- [ ] **Step 4: Implement mobile adaptations**

In `styles.css`, turn desktop workbenches into list/detail stacks and sticky action areas below 900px. Preserve 40–44px touch targets and prevent page-level horizontal overflow.

- [ ] **Step 5: Verify GREEN and commit**

Run: `node --test tests/product-foundation-css.test.mjs tests/render-smoke.test.mjs`

```bash
git add src/product-foundation.css src/product-system.css src/styles.css tests/product-foundation-css.test.mjs tests/render-smoke.test.mjs
git commit -m "style: add shared operating-system surface primitives"
```

---

### Task 4: AI Trader and Live Desk Deep-Page Convergence

**Files:**
- Modify: `src/chat.jsx`
- Modify: `src/conceptPages.jsx`
- Modify: `src/mobile.jsx`
- Modify: `src/product-system.css`
- Modify: `src/styles.css`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Consumes shared roles from Task 3.
- Preserves: `ChatPage`, `IntelligenceConcept`, `WatchMonitorConcept`, `MarketConcept`, `PositionsConcept`, `ExecutionReviewConcept`, `MobileWatch`, `MobileIntelligence`, `MobileTasks`, `MobileMarket`, `MobilePositions`, and `MobileExecution` props/actions.

- [ ] **Step 1: Add failing deep-page structure assertions**

Render representative desktop and mobile pages and assert authoritative sections expose truth, registry/evidence, and action roles rather than only legacy card wrappers.

```js
assert.match(render(<C.IntelligenceConcept {...props}/>), /kTruthBand/);
assert.match(render(<C.PositionsConcept {...props}/>), /kRegistry/);
assert.match(render(<C.MobileExecution {...props}/>), /kEvidenceLedger|mEvidenceLedger/);
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/render-smoke.test.mjs`

Expected: FAIL on the newly required shared roles.

- [ ] **Step 3: Converge AI deep surfaces**

Keep conversation topology intact. Normalize intelligence summary/source rows, watch thesis/condition rows, event impact/evidence disclosure, patrol receipts, and poster workflow using truth bands, registries, and evidence ledgers. Remove only presentation-only legacy wrappers; keep facts and actions.

- [ ] **Step 4: Converge Live deep surfaces**

Normalize market/account health, positions, execution/review, orders/fills, protection, and reconciliation links. Keep actual order/fill/position/protection objects distinct and retain all recovery/status copy.

- [ ] **Step 5: Verify all representative states**

Run: `node --test tests/render-smoke.test.mjs tests/product-architecture.test.mjs`

Check SSR fixtures for populated, empty, unavailable, warning, failed, and permission-limited states.

- [ ] **Step 6: Commit the AI/Live batch**

```bash
git add src/chat.jsx src/conceptPages.jsx src/mobile.jsx src/product-system.css src/styles.css tests/render-smoke.test.mjs
git commit -m "style: converge ai and live deep surfaces"
```

---

### Task 5: Lab Deep-Page Convergence

**Files:**
- Modify: `src/conceptPages.jsx`
- Modify: `src/mobile.jsx`
- Modify: `src/product-foundation.css`
- Modify: `src/product-system.css`
- Modify: `src/styles.css`
- Modify: `tests/render-smoke.test.mjs`
- Modify: `tests/research-map.test.mjs`

**Interfaces:**
- Preserves the existing research lifecycle and `buildResearchMap()` view model.
- Converges Knowledge, Strategy, Capability, validation, review, and Owner release presentations.

- [ ] **Step 1: Add failing provenance/lifecycle structure tests**

Assert desktop and mobile registries visibly distinguish `system-native`, `knowledge-derived candidate`, `validated`, `live evidence`, and `Owner release` where those states already exist in fixture data.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/research-map.test.mjs tests/render-smoke.test.mjs`

Expected: FAIL where legacy pages lack the shared lifecycle/provenance wrappers.

- [ ] **Step 3: Apply the shared registry and inspector pattern**

Use provenance-first registry rows, selected-object inspectors, explicit validation evidence, and Owner-release action bars. Do not claim arbitrary code generation or merge system-native assets into the knowledge-ingestion origin.

- [ ] **Step 4: Normalize mobile list/detail disclosure**

Keep the lifecycle rail visible, move dense evidence into details/sheets, retain every existing field/action, and remove old floating-card spacing.

- [ ] **Step 5: Verify and commit**

Run: `node --test tests/research-map.test.mjs tests/render-smoke.test.mjs`

```bash
git add src/conceptPages.jsx src/mobile.jsx src/product-foundation.css src/product-system.css src/styles.css tests/research-map.test.mjs tests/render-smoke.test.mjs
git commit -m "style: converge lab lifecycle surfaces"
```

---

### Task 6: Control, Operations, and Configuration Convergence

**Files:**
- Modify: `src/conceptPages.jsx`
- Modify: `src/mobile.jsx`
- Modify: `src/mobileOperations.jsx`
- Modify: `src/workspacePages.jsx`
- Modify: `src/product-system.css`
- Modify: `src/styles.css`
- Modify: `tests/control-configuration-view.test.mjs`
- Modify: `tests/operations-view.test.mjs`
- Modify: `tests/render-smoke.test.mjs`

**Interfaces:**
- Preserves `buildControlConfigurationView()` and `buildOperationsView()` as authoritative presentation models.
- Keeps Control read-only and Configuration as the sole durable editor.

- [ ] **Step 1: Add failing ownership and surface-role tests**

```js
assert.doesNotMatch(render(<C.RiskPostureConcept {...props}/>), /editableRiskForm/);
assert.match(render(<C.SettingsConcept {...props}/>), /kFormSurface/);
assert.match(render(<C.OperationsRecoveryConcept {...props}/>), /kActionBar|opxRecoveryActions/);
```

Also assert the mobile Configuration index and deep form pages render a registry/index and bounded editor surface instead of a generic card stack.

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/control-configuration-view.test.mjs tests/operations-view.test.mjs tests/render-smoke.test.mjs`

Expected: FAIL on the new Configuration structure assertions.

- [ ] **Step 3: Converge Control**

Normalize risk posture, effective boundary, event risk, rule-monitoring, and permission evidence. Keep durable-edit links explicit and visually separate from runtime truth.

- [ ] **Step 4: Refine Operations without changing its topology**

Use Operations as the reference surface; fix only remaining inconsistencies in spacing, status contrast, empty/error states, filters, audit detail, notification acknowledgement, and mobile task creation.

- [ ] **Step 5: Rebuild Configuration presentation around a registry**

Keep existing panels and endpoints, but present a configuration domain index, authoritative current/effective summary, bounded form surfaces, consistent save/destructive actions, and deep-section back navigation. Do not relocate settings back into Control or Operations.

- [ ] **Step 6: Verify and commit**

Run: `node --test tests/control-configuration-view.test.mjs tests/operations-view.test.mjs tests/render-smoke.test.mjs`

```bash
git add src/conceptPages.jsx src/mobile.jsx src/mobileOperations.jsx src/workspacePages.jsx src/product-system.css src/styles.css tests/control-configuration-view.test.mjs tests/operations-view.test.mjs tests/render-smoke.test.mjs
git commit -m "style: converge control operations and configuration"
```

---

### Task 7: Cross-Viewport Polish and Final Verification

**Files:**
- Modify: `src/product-foundation.css`
- Modify: `src/product-system.css`
- Modify: `src/styles.css`
- Modify: `src/mobile.jsx`
- Modify: `src/mobileOperations.jsx`
- Modify: `src/conceptPages.jsx`
- Modify: `src/workspacePages.jsx`
- Modify: `tests/render-smoke.test.mjs`
- Update: `PRODUCT.md`
- Update: `docs/ui-function-map.md`
- Remove: `app-interactive-preview.html` if it remains a temporary review artifact.

**Interfaces:**
- Consumes all completed workspace batches.
- Produces final desktop/mobile visual evidence under `.impeccable/review/`.

- [ ] **Step 1: Run one bounded browser inspection round**

Inspect desktop at 1280px and an intermediate width, plus mobile at 390–462px. Walk AI, Live, Lab, Control, Operations, and Configuration representative deep routes. Record all functional, overflow, hierarchy, contrast, focus, and legacy-style findings before editing.

- [ ] **Step 2: Fix the entire inspection batch**

Apply one consolidated patch. Preserve page topology unless the design spec explicitly requires a local-navigation or hierarchy change. Remove stale duplicated styles and temporary preview artifacts.

- [ ] **Step 3: Run the single permitted detector pass**

Run exactly once:

```bash
node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/mobile.jsx src/mobileOperations.jsx src/conceptPages.jsx src/workspacePages.jsx src/product-foundation.css src/product-system.css src/styles.css
```

Fix reported mechanical findings in one batch without rerunning the detector.

- [ ] **Step 4: Run the final verification commands**

```bash
npm test
npm run lint
npm run build
git diff --check
```

Expected: all tests pass, ESLint exits 0, Vite production build succeeds, and diff check prints nothing.

- [ ] **Step 5: Update product documentation**

Document workspace-owned mobile navigation, More utilities, the shared deep-surface grammar, and completion status. Do not advertise unsupported features.

- [ ] **Step 6: Capture final evidence and commit**

Save `.impeccable/review/desktop.png` and `.impeccable/review/mobile.png`, then commit only the final polish, test, evidence, and documentation changes that remain after the workspace commits.

```bash
git add src/product-foundation.css src/product-system.css src/styles.css src/mobile.jsx src/mobileOperations.jsx src/conceptPages.jsx src/workspacePages.jsx tests/render-smoke.test.mjs PRODUCT.md docs/ui-function-map.md .impeccable/review/desktop.png .impeccable/review/mobile.png
git commit -m "feat: complete global ui convergence"
```
