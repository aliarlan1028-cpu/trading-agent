# KORDYN V2 Convergence, Evidence, and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close cross-domain capability, state, accessibility, fidelity, performance, and rollback gates, then switch the authenticated production presentation to KORDYN V2 without deleting the recoverable legacy shell.

**Architecture:** Add end-to-end gates over the actual V2 root and an isolated real backend, consolidate final evidence from all domain runners, enforce route-level bundle budgets, and make the production UI switch a final standalone commit. The legacy presentation remains available through the build-time switch for rollback; removal is a later approved project.

**Tech Stack:** React 18, Vite 6, Node `node:test`, isolated Express backend, CDP Chrome, `sharp`, Impeccable detector/reviewer workflow.

**Spec:** `docs/superpowers/specs/2026-08-26-kordyn-concept-faithful-product-rebuild-design.md`

## Global Constraints

- Preserve every program constraint and the interfaces from Plans 01–05.
- No source capability, action, permission, safety, or data fix is hidden in evidence HTML or screenshot fixtures.
- Visual evidence uses final production components and clearly labels whether data came from the isolated real backend or the production-shaped component fixture.
- A test pass does not overrule a visible concept mismatch.
- The cutover commit changes the authenticated presentation default only; it does not delete legacy code or alter marketing/auth.
- Any Critical or Important finding blocks the production switch.

---

### Task 1: Cross-domain route, capability, and canonical object convergence

**Files:**
- Create: `src/kordynV2/architecture/capabilitySurfaces.js`
- Create: `src/kordynV2/architecture/objectContracts.js`
- Create: `tests/kordyn-v2-capability-convergence.test.mjs`
- Create: `tests/kordyn-v2-canonical-selection-browser.html`
- Create: `tests/kordyn-v2-canonical-selection-browser.jsx`
- Create: `tests/run-kordyn-v2-canonical-selection-browser.mjs`
- Modify: `docs/kordyn-v2-capability-migration-matrix.md`

**Interfaces:**
- Consumes: all four domain registries, `DEPLOYED_FEATURES`, canonical selection helpers, and the final domain components.
- Produces: `KORDYN_V2_CAPABILITY_SURFACES`, `KORDYN_V2_OBJECT_CONTRACTS`, a 66/66 implementation report, and real click-through selection evidence.

- [ ] **Step 1: Write the failing 66-capability convergence test**

```js
test("all 66 capabilities resolve to implemented Desktop and APP surfaces", () => {
  assert.equal(DEPLOYED_FEATURES.length, 66);
  assert.equal(Object.keys(KORDYN_V2_CAPABILITY_SURFACES).length, 66);
  for (const feature of DEPLOYED_FEATURES) {
    const surface = KORDYN_V2_CAPABILITY_SURFACES[feature.id];
    assert.ok(surface, feature.id);
    assert.ok(surface.desktop.component, `${feature.id}: desktop`);
    assert.ok(surface.mobile.component, `${feature.id}: mobile`);
    assert.ok(surface.route.domainId && surface.route.workspaceId, `${feature.id}: route`);
    assert.ok(surface.objects.length || surface.viewOnly === true, `${feature.id}: object/view`);
  }
});
```

- [ ] **Step 2: Write the failing canonical object contract**

```js
const requiredTypes = [
  "Mission", "Signal", "Market", "Account", "Position", "Plan", "Order", "Fill",
  "Event", "Event source", "Watch", "Strategy product", "Strategy", "Knowledge source",
  "Evidence", "Capability", "Validation run", "Review", "Owner candidate", "Mandate",
  "Risk rule", "Risk incident", "Task", "Agent run", "Notification", "Audit log",
  "Recovery record", "Configuration item"
];
test("all selectable object types update shell Context and Proof", () => {
  for (const type of requiredTypes) {
    const contract = KORDYN_V2_OBJECT_CONTRACTS[type];
    assert.ok(contract?.identity, type);
    assert.equal(contract.selectionUpdates.includes("context"), true, type);
    assert.equal(contract.selectionUpdates.includes("proof"), true, type);
  }
});
```

- [ ] **Step 3: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-capability-convergence.test.mjs`

Expected: FAIL because the final capability/object registries do not exist.

- [ ] **Step 4: Implement registries and update the matrix with code locations**

Each matrix row gains exact V2 route, Desktop component, APP component, object/view/action, permission source, state source, and focused test. Preserve the original 66-row order so it can be compared directly with `src/productCoverage.js`.

`capabilitySurfaces.js` merges the four domain-owned registries and rejects duplicate keys:

```js
const entries = [AI_CAPABILITY_SURFACES, ACCOUNT_CAPABILITY_SURFACES, ASSET_CAPABILITY_SURFACES, GOVERNANCE_CAPABILITY_SURFACES].flatMap(Object.entries);
if (new Set(entries.map(([id]) => id)).size !== entries.length) throw new Error("duplicate_v2_capability_surface");
export const KORDYN_V2_CAPABILITY_SURFACES = Object.freeze(Object.fromEntries(entries));
```

- [ ] **Step 5: Implement real click tests across every required object type**

The browser runner clicks actual V2 rows/buttons, never the helper directly. After every click:

```js
assert.equal(root.dataset.kordynV2SelectedId, expected.id);
assert.equal(root.dataset.kordynV2SelectedType, expected.type);
assert.equal(context.dataset.kordynV2ContextId, expected.id);
assert.equal(proof.dataset.kordynV2ProofId, expected.id);
```

Run on Desktop and APP with at least one representative object from AI, Account, Assets, and Governance.

- [ ] **Step 6: Run GREEN and commit**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-capability-convergence.test.mjs tests/view-data-parity.test.mjs && node tests/run-kordyn-v2-canonical-selection-browser.mjs && git diff --check`

Expected: PASS with `66/66`, every required object type clicked, and matching Context/Proof identity.

```bash
git add src/kordynV2/architecture/capabilitySurfaces.js src/kordynV2/architecture/objectContracts.js tests/kordyn-v2-capability-convergence.test.mjs tests/kordyn-v2-canonical-selection-browser.html tests/kordyn-v2-canonical-selection-browser.jsx tests/run-kordyn-v2-canonical-selection-browser.mjs docs/kordyn-v2-capability-migration-matrix.md
git commit -m "test: prove V2 capability and object convergence"
```

### Task 2: Complete state, accessibility, localization, and responsive gates

**Files:**
- Create: `tests/kordyn-v2-state-matrix.test.mjs`
- Create: `tests/kordyn-v2-accessibility-browser.html`
- Create: `tests/kordyn-v2-accessibility-browser.jsx`
- Create: `tests/run-kordyn-v2-accessibility-browser.mjs`
- Create: `tests/kordyn-v2-long-content-fixture.js`
- Create: `src/kordynV2/architecture/stateSurfaces.js`
- Modify: `src/kordynV2/shell/StateBoundary.jsx`
- Modify: `src/kordynV2/styles/shell.css`
- Modify: `src/kordynV2/styles/mobile-shell.css`
- Modify: domain V2 CSS only where a gate exposes a defect.

**Interfaces:**
- Consumes: all domain `*_CAPABILITY_SURFACES`, `normalizeResourceState()`, final V2 components, and bilingual copy.
- Produces: `KORDYN_V2_STATE_SURFACES`, a complete domain × state matrix, and browser accessibility/overflow evidence.

- [ ] **Step 1: Write the failing complete state matrix**

```js
const requiredStates = ["loading", "empty", "processing", "stale", "degraded", "failed", "forbidden", "disabled", "approval", "partial", "no-result", "long-content", "large-list"];
for (const domainId of ["ai", "account", "assets", "governance"]) {
  test(`${domainId} covers every required state`, () => {
    for (const state of requiredStates) assert.ok(KORDYN_V2_STATE_SURFACES[domainId][state], `${domainId}:${state}`);
  });
}
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-state-matrix.test.mjs`

Expected: FAIL for any domain/state not registered and rendered.

- [ ] **Step 3: Complete state semantics without local fabrication**

Fix state composition through `StateBoundary` or domain presenters. Stale/degraded views retain last-valid values plus source/time/recovery; forbidden views do not render protected data; disabled actions explain why; partial success lists completed and failed effects separately.

Merge the four domain registries without inventing a second state source:

```js
import { AI_STATE_SURFACES } from "../domains/ai/stateSurfaces.js";
import { ACCOUNT_STATE_SURFACES } from "../domains/account/stateSurfaces.js";
import { ASSET_STATE_SURFACES } from "../domains/assets/stateSurfaces.js";
import { GOVERNANCE_STATE_SURFACES } from "../domains/governance/stateSurfaces.js";

export const KORDYN_V2_STATE_SURFACES = Object.freeze({
  ai: AI_STATE_SURFACES,
  account: ACCOUNT_STATE_SURFACES,
  assets: ASSET_STATE_SURFACES,
  governance: GOVERNANCE_STATE_SURFACES
});
```

- [ ] **Step 4: Implement browser accessibility and overflow checks**

At `1440x900`, `1180x800`, `390x844`, and `430x932`:

- tab through global/local navigation and primary work actions;
- open/close Context, Proof, AI 客服, approval, ordinary confirmation, and danger confirmation;
- assert focus trap and trigger focus return;
- verify visible focus style with non-zero outline or box-shadow;
- inspect status text/symbol in addition to color;
- check every visible APP interactive target is at least `44x44` except inline text links with an equivalent surrounding hit target;
- set `prefers-reduced-motion: reduce` and verify state changes remain visible;
- load Chinese, English, long IDs, long source names, 200-row lists, and long evidence;
- assert `documentElement.scrollWidth === documentElement.clientWidth`.

- [ ] **Step 5: Run GREEN and commit**

Run:

```bash
node scripts/run-tests-isolated.mjs tests/kordyn-v2-state-matrix.test.mjs
KORDYN_V2_SCREENSHOT_DIR=.impeccable/review/kordyn-v2/states node tests/run-kordyn-v2-accessibility-browser.mjs
git diff --check
```

Expected: PASS at all four viewports.

```bash
git add tests/kordyn-v2-state-matrix.test.mjs tests/kordyn-v2-accessibility-browser.html tests/kordyn-v2-accessibility-browser.jsx tests/run-kordyn-v2-accessibility-browser.mjs tests/kordyn-v2-long-content-fixture.js src/kordynV2/architecture/stateSurfaces.js src/kordynV2/shell/StateBoundary.jsx src/kordynV2/styles/shell.css src/kordynV2/styles/mobile-shell.css src/kordynV2/domains .impeccable/review/kordyn-v2/states
git commit -m "fix: harden V2 states and accessibility"
```

### Task 3: Route-level performance convergence

**Files:**
- Modify: `src/kordynV2/KordynV2Root.jsx`
- Modify: `src/kordynV2/entry.jsx`
- Modify: `tests/kordyn-v2-performance.test.mjs`
- Modify: `tests/run-kordyn-v2-performance-build.mjs`
- Create: `tests/run-kordyn-v2-performance-browser.mjs`
- Modify: `docs/kordyn-v2-evidence.md`

**Interfaces:**
- Consumes: final V2 lazy domain imports and production build output.
- Produces: route CSS/JS size report, initial/public isolation proof, interaction readiness and long-task measurements.

- [ ] **Step 1: Run the existing budget test before optimization**

Run: `node tests/run-kordyn-v2-performance-build.mjs`

Expected: PASS. If it fails, retain the exact file/byte output as the RED evidence; do not weaken the budget.

Extend the budget test from the foundation shell to every finished domain:

```js
assert.ok(report.public.css < 40_000);
assert.ok(report.public.js < 450_000);
assert.ok(report.routes.aiShell.css < 180_000);
for (const id of ["account", "assets", "governance"]) {
  assert.ok(report.routes[id].css < 120_000, id);
}
assert.equal(report.authenticatedLoadsLegacyAndV2Css, false);
```

- [ ] **Step 2: Verify lazy imports are domain-specific**

The V2 root must use:

```js
const domainLoaders = Object.freeze({
  ai: () => import("./domains/ai/index.jsx"),
  account: () => import("./domains/account/index.jsx"),
  assets: () => import("./domains/assets/index.jsx"),
  governance: () => import("./domains/governance/index.jsx")
});
```

Each domain index imports only its domain CSS. Heavy charts/graphs load within the relevant workspace. No V2 module imports `productStyles.js`, `styles.css`, `product-foundation.css`, or a legacy zero-base stylesheet.

- [ ] **Step 3: Run browser timing and long-task gates**

The runner starts at AI missions, records navigation/paint readiness, then navigates to each inactive domain and records chunk transfer and interaction readiness. It fails on a main-thread task over `200ms` caused by V2 initial render, unexpected legacy CSS request, or inactive-domain chunk requested before navigation.

- [ ] **Step 4: Run GREEN and commit**

Run:

```bash
node scripts/run-tests-isolated.mjs tests/kordyn-v2-performance.test.mjs tests/zero-base-performance.test.mjs
node tests/run-kordyn-v2-performance-build.mjs
node tests/run-kordyn-v2-performance-browser.mjs
npm run build
git diff --check
```

Expected: public CSS `<40 KiB`, public JS `<450 KiB`, AI+shell CSS `<180 KiB`, account/assets/governance CSS each `<120 KiB`, no V2/legacy authenticated CSS co-load.

```bash
git add src/kordynV2/KordynV2Root.jsx src/kordynV2/entry.jsx tests/kordyn-v2-performance.test.mjs tests/run-kordyn-v2-performance-build.mjs tests/run-kordyn-v2-performance-browser.mjs docs/kordyn-v2-evidence.md
git commit -m "perf: converge KORDYN V2 route bundles"
```

### Task 4: Final 15-concept visual evidence and contact sheet

**Files:**
- Create: `scripts/render-kordyn-v2-contact-sheet.mjs`
- Create: `.impeccable/review/kordyn-v2/final/contact-sheet.html`
- Create: `.impeccable/review/kordyn-v2/final/contact-sheet.png`
- Modify: `docs/kordyn-v2-evidence.md`
- Modify: `docs/kordyn-v2-approved-concept-manifest.md`

**Interfaces:**
- Consumes: final screenshots from every domain, normalized references, overlays, differences, state screenshots, and final production/capture hashes.
- Produces: a browsable contact sheet, full-page PNG, natural-width report, region verdicts, and source-truth documentation.

- [ ] **Step 1: Capture fresh final-head evidence**

Start the isolated real backend and Vite through the production gate from Task 5. Capture every approved Desktop concept at `1440x900`, a `1180x800` adaptation, every approved APP concept at `390x844` and `430x932`, plus Context/Proof, AI 客服, approval, ordinary/danger confirmations, and every required state.

- [ ] **Step 2: Generate comparisons and the contact sheet**

Run:

```bash
node scripts/compare-kordyn-v2-concepts.mjs --screenshots .impeccable/review/kordyn-v2/final/screens --output .impeccable/review/kordyn-v2/final/compare --scope all
node scripts/render-kordyn-v2-contact-sheet.mjs
```

The renderer must return a JSON result containing `imageCount`, `broken: []`, output width/height, `pendingText: false`, production hash, capture hash, and evidence hash placeholder omitted to avoid self-reference.

- [ ] **Step 3: Enforce valid images**

Open the contact HTML in Chrome and fail unless every `<img>` has `naturalWidth > 0`, the count equals the manifest’s expected count, and no `alt` text replaces an image. Then open the final PNG and inspect every section at readable scale.

- [ ] **Step 4: Perform bounded comp review**

Review each concept and build region side by side: shell/navigation, truth, primary registry/canvas, inspector, actions, overlays, states, and responsive adaptation. Fix material differences in one batch, recapture once, and stop self-polishing after the second inspection round. Do not mark a difference PASS merely because tokens or component names exist.

- [ ] **Step 5: Run Impeccable mechanical and finish gates**

Run the detector once:

```bash
node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/kordynV2
```

Fix mechanical findings, then obtain a fresh Impeccable finish review with the original request, all target screenshots, all approved comps, comparison crops, and the direction/fidelity contract. Require disposition `ship`; any `fix`, `rebuild`, or `recapture` result is acted on according to the skill before continuing.

- [ ] **Step 6: Commit evidence separately**

```bash
git add scripts/render-kordyn-v2-contact-sheet.mjs .impeccable/review/kordyn-v2/final docs/kordyn-v2-evidence.md docs/kordyn-v2-approved-concept-manifest.md
git commit -m "docs: capture final KORDYN V2 visual evidence"
```

### Task 5: Self-contained real-production gate and rollback exercise

**Files:**
- Create: `tests/run-kordyn-v2-production-gates.mjs`
- Create: `tests/run-kordyn-v2-production-browser.mjs`
- Create: `tests/kordyn-v2-rollback.test.mjs`
- Modify: `src/kordynV2/cutover.js`
- Modify: `docs/kordyn-v2-evidence.md`

**Interfaces:**
- Consumes: actual `server/index.mjs`, actual Vite app, an isolated `TEST_DATA_ROOT`, build-time UI switch, and all real V2 routes.
- Produces: a one-command local production gate and proof that V2/legacy switching changes presentation only.

- [ ] **Step 1: Write the failing rollback test**

```js
test("legacy and V2 switches leave API route and action contracts unchanged", () => {
  assert.equal(resolveKordynUiVersion({ PROD: true, VITE_KORDYN_UI_VERSION: "legacy" }), "legacy");
  assert.equal(resolveKordynUiVersion({ PROD: true, VITE_KORDYN_UI_VERSION: "v2" }), "v2");
  assert.deepEqual(V2_ACTION_ENDPOINTS.sort(), LEGACY_ACTION_ENDPOINTS.sort());
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-rollback.test.mjs`

Expected: FAIL because the final endpoint/cutover proof does not exist.

- [ ] **Step 3: Build a self-contained production gate**

Follow the isolation pattern in `tests/run-zero-base-production-gates.mjs`: allocate free API/Vite ports, create a trusted temporary data root, start `server/index.mjs` with `NODE_ENV=test`, `NODE_TEST_CONTEXT=1`, `AUTH_REQUIRED=false`, and no secrets, start Vite with `VITE_KORDYN_UI_VERSION=v2`, run the production browser gate, then stop both processes and delete only the owned temporary root.

The production browser must navigate actual `App → KordynV2Root`, visit every domain/workspace, exercise representative read/write/forbidden/failure paths against the isolated backend, and prove public/auth remain unchanged.

- [ ] **Step 4: Exercise rollback**

Run the same gate once with `VITE_KORDYN_UI_VERSION=v2` and once with `legacy`. Record that backend task/data identity persists across the presentation restart and that the two paths never co-load authenticated CSS.

- [ ] **Step 5: Run GREEN and commit**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-rollback.test.mjs && node tests/run-kordyn-v2-production-gates.mjs && git diff --check`

Expected: PASS for V2 and legacy presentations; temporary services stop and test data is cleaned.

```bash
git add tests/run-kordyn-v2-production-gates.mjs tests/run-kordyn-v2-production-browser.mjs tests/kordyn-v2-rollback.test.mjs src/kordynV2/cutover.js docs/kordyn-v2-evidence.md
git commit -m "test: prove V2 production and rollback paths"
```

### Task 6: Independent review, full verification, and production default switch

**Files:**
- Modify: `src/kordynV2/cutover.js`
- Modify: `tests/kordyn-v2-cutover.test.mjs`
- Modify: `docs/kordyn-v2-evidence.md`
- Modify: `docs/kordyn-v2-capability-migration-matrix.md`
- Create: `docs/kordyn-v2-release-report.md`

**Interfaces:**
- Consumes: final code/evidence commits and every focused/full/browser/performance gate.
- Produces: Critical/Important/Minor review verdict, exact fresh command output, final evidence index, and the production V2 default.

- [ ] **Step 1: Request independent read-only specification and code-quality review**

Provide the reviewer with the approved spec, six plans, final diff, 15 concept paths, contact sheet, capability matrix, state matrix, performance report, and production/rollback commands. Require findings classified as Critical / Important / Minor and a hash-truth check. Critical and Important must both be `0` before continuing.

- [ ] **Step 2: Run fresh focused and full gates**

```bash
node scripts/run-tests-isolated.mjs tests/kordyn-v2-architecture.test.mjs tests/kordyn-v2-cutover.test.mjs tests/kordyn-v2-state.test.mjs tests/kordyn-v2-actions.test.mjs tests/kordyn-v2-ai-model.test.mjs tests/kordyn-v2-account-model.test.mjs tests/kordyn-v2-assets-model.test.mjs tests/kordyn-v2-governance-model.test.mjs tests/kordyn-v2-capability-convergence.test.mjs tests/kordyn-v2-state-matrix.test.mjs tests/kordyn-v2-performance.test.mjs tests/kordyn-v2-rollback.test.mjs
npm test
npm run lint
npm run build
node tests/run-kordyn-v2-shell-browser.mjs
node tests/run-kordyn-v2-ai-browser.mjs
node tests/run-kordyn-v2-account-browser.mjs
node tests/run-kordyn-v2-assets-browser.mjs
node tests/run-kordyn-v2-governance-browser.mjs
node tests/run-kordyn-v2-canonical-selection-browser.mjs
node tests/run-kordyn-v2-accessibility-browser.mjs
node tests/run-kordyn-v2-performance-build.mjs
node tests/run-kordyn-v2-performance-browser.mjs
node tests/run-kordyn-v2-production-gates.mjs
node scripts/render-kordyn-v2-contact-sheet.mjs
git diff --check
git status --short
```

Expected: every command exits `0`; full-test count is recorded from fresh output; contact-sheet image count matches its manifest; `git status --short` is empty before the cutover edit.

- [ ] **Step 3: Switch the production default and its contract test in one isolated change**

Change `DEFAULT_KORDYN_UI_VERSION` from `"legacy"` to `"v2"` and update the default assertion in `tests/kordyn-v2-cutover.test.mjs`. Do not change any route, adapter, or action. An explicit valid `VITE_KORDYN_UI_VERSION=legacy` remains the rollback override; an invalid explicit value remains fail-closed to `legacy`.

- [ ] **Step 4: Re-run cutover-critical gates**

Run:

```bash
node scripts/run-tests-isolated.mjs tests/kordyn-v2-cutover.test.mjs tests/kordyn-v2-rollback.test.mjs tests/kordyn-v2-capability-convergence.test.mjs
npm run lint
npm run build
node tests/run-kordyn-v2-production-gates.mjs
node tests/run-kordyn-v2-performance-build.mjs
git diff --check
```

Expected: PASS with V2 as the default and legacy as an explicit working rollback.

- [ ] **Step 5: Commit the cutover separately**

```bash
git add src/kordynV2/cutover.js tests/kordyn-v2-cutover.test.mjs
git commit -m "feat: make KORDYN V2 the authenticated default"
```

- [ ] **Step 6: Write and commit the final release report**

Record final code, evidence, and documentation hashes; 66/66 capability result; all test counts and exit codes; browser viewport outputs; performance bytes; contact-sheet dimensions/count; visual reviewer disposition; independent review counts; rollback command; and clean status.

```bash
git add docs/kordyn-v2-evidence.md docs/kordyn-v2-capability-migration-matrix.md docs/kordyn-v2-release-report.md
git commit -m "docs: finalize KORDYN V2 release evidence"
git diff --check
git status --short
```

Expected: clean worktree. Do not delete legacy authenticated files. Open a separately approved cleanup plan only after production observation and explicit user authorization.
