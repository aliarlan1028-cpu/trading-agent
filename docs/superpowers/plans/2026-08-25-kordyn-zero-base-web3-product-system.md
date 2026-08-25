# KORDYN Zero-Base Web3 Product System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild KORDYN desktop, APP, authentication, and marketing visuals around the approved zero-base Web3 product system without changing deployed functionality.

**Architecture:** Introduce one new page-family registry that maps the approved information architecture onto existing authoritative runtime routes. Recompose desktop and mobile shells with new components and a dedicated token/primitives stylesheet while retaining current data-connected workbenches and fail-closed boundaries. Rebuild marketing CSS and authentication presentation without changing their content or behavior contracts.

**Tech Stack:** React 18, Vite 6, plain CSS, lucide-react, Node `node:test`, existing browser runners.

**Spec:** `docs/superpowers/specs/2026-08-25-kordyn-zero-base-web3-product-system-design.md`

## Global Constraints

- Every deployed feature in `src/productCoverage.js` remains reachable on desktop and APP.
- Authenticated production paths use real data, permissions, actions, errors, and retries; no mock values.
- Marketing content, anchors, bilingual keys, product-demo behavior, and CTA actions remain unchanged.
- `智能表单` and `DAO 治理` do not appear anywhere in the new product system.
- Palette values are Paper `#F4F1E9`, Ink `#111311`, Acid `#CCFF3D`, Green `#4FB78B`, Danger `#E25645`, Amber `#EFB44B`, Muted `#697169`.
- No new runtime dependency, Google font request, global blur layer, particle canvas, or unbounded animation.
- Mobile supports 390×844 and 430×932 without document overflow; desktop supports 1180×800 and 1440×900.
- Loading, empty, stale, degraded, failed, forbidden, disabled, confirm, and last-valid states stay truthful and fail closed.

---

### Task 1: Page-family and coverage contract

**Files:**
- Create: `src/zeroBaseArchitecture.js`
- Create: `tests/zero-base-architecture.test.mjs`
- Modify: `src/productArchitecture.js`
- Modify: `src/productCoverage.js`

**Interfaces:**
- Consumes: existing `resolveDesktopRoute(route)`, `resolveMobileRoute(route)`, and `DEPLOYED_FEATURES`.
- Produces: `ZERO_BASE_FAMILIES`, `ZERO_BASE_GROUPS`, `ZERO_BASE_MOBILE_ROOTS`, `familyForFeature(featureId)`, and `resolveZeroBaseDestination(familyId, viewId, device)`.

- [ ] **Step 1: Write the failing architecture test**

```js
test("every deployed feature resolves into the approved page families on desktop and APP", () => {
  assert.deepEqual(ZERO_BASE_FAMILIES.map(({ id }) => id), [
    "today", "ai", "portfolio", "strategy", "knowledge", "capability",
    "reviews", "guard", "operations", "configuration"
  ]);
  for (const feature of DEPLOYED_FEATURES) assert.ok(familyForFeature(feature.id), feature.id);
  assert.equal(JSON.stringify(ZERO_BASE_FAMILIES).match(/智能表单|DAO 治理/), null);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/zero-base-architecture.test.mjs`

Expected: FAIL because `src/zeroBaseArchitecture.js` does not exist.

- [ ] **Step 3: Implement the registry and compatibility adapters**

Create immutable family/view records pointing to existing routes such as `chat`, `watch`, `cockpit`, `strategyLib`, `knowledgeBase`, `capabilityLib`, `executionReview`, `riskCenter`, `operationsCenter`, and `systemSettings`. Map every feature ID to exactly one approved family. Unknown family/view combinations fail closed to `ai/dialog`.

- [ ] **Step 4: Run GREEN and route coverage**

Run: `node --test tests/zero-base-architecture.test.mjs tests/product-architecture.test.mjs tests/mobile-navigation.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/zeroBaseArchitecture.js src/productArchitecture.js src/productCoverage.js tests/zero-base-architecture.test.mjs
git commit -m "feat: define zero-base product architecture"
```

### Task 2: Shared visual tokens and primitives

**Files:**
- Create: `src/zero-base-system.css`
- Create: `tests/zero-base-visual-contract.test.mjs`
- Modify: `src/main.jsx`

**Interfaces:**
- Consumes: authenticated root class `kordynSystem` and the new family IDs.
- Produces: palette tokens, layout primitives prefixed `zb`, and reduced-motion/touch behavior scoped under `.zeroBaseProduct` and `.zeroBaseAuth`.

- [ ] **Step 1: Write the failing visual contract**

```js
test("zero-base surfaces expose the approved palette and bounded motion", () => {
  const css = readFileSync(cssPath, "utf8");
  for (const [token, value] of Object.entries({ paper: "#F4F1E9", ink: "#111311", acid: "#CCFF3D", green: "#4FB78B", danger: "#E25645", amber: "#EFB44B" })) {
    assert.match(css, new RegExp(`--zb-${token}:\\s*${value}`, "i"));
  }
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /backdrop-filter|canvas/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/zero-base-visual-contract.test.mjs`

Expected: FAIL because the stylesheet does not exist.

- [ ] **Step 3: Implement the scoped token and primitive layer**

Define paper/ink structural surfaces, acid current/action states, green verified states, danger/warning states, typography, focus rings, touch sizes, shell grids, page headings, sub-navigation, registries, inspectors, truth panels, state panels, drawers, and modal primitives. Import after legacy CSS.

- [ ] **Step 4: Run GREEN and build**

Run: `node --test tests/zero-base-visual-contract.test.mjs tests/product-foundation-css.test.mjs && npm run build`

Expected: PASS and successful Vite build.

- [ ] **Step 5: Commit**

```bash
git add src/zero-base-system.css src/main.jsx tests/zero-base-visual-contract.test.mjs
git commit -m "feat: add zero-base visual foundation"
```

### Task 3: Marketing palette with immutable content behavior

**Files:**
- Modify: `public/landing.css`
- Modify: `public/landing.html`
- Modify: `tests/landing-copy.test.mjs`
- Create: `tests/landing-palette.test.mjs`

**Interfaces:**
- Consumes: current landing DOM, IDs, i18n keys, ticker hooks, product-demo hooks, and `lp-start` messages.
- Produces: the approved E2P-referenced palette, local/system font stacks, and unchanged marketing interaction hooks.

- [ ] **Step 1: Write the failing palette/content contract**

```js
test("marketing keeps its product story and actions while using the approved palette", () => {
  for (const id of ["top", "problem", "system", "capabilities", "guardrails", "compare"]) assert.match(html, new RegExp(`id=["']${id}["']`));
  for (const action of ["login", "subscribe", "contact", "lang"]) assert.match(html, new RegExp(`data-action=["']${action}["']`));
  assert.match(css, /--paper:\s*#f4f1e9/i);
  assert.match(css, /--ink:\s*#111311/i);
  assert.match(css, /--acid:\s*#ccff3d/i);
  assert.match(css, /--green:\s*#4fb78b/i);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/landing-copy.test.mjs tests/landing-palette.test.mjs`

Expected: FAIL on old violet/orange tokens and Google Fonts.

- [ ] **Step 3: Rebuild marketing CSS without changing content**

Replace the old space-violet/orange palette with Paper/Ink/Acid/Green. Keep moon/flight-plan/product-demo geometry and every HTML text/hook. Remove only Google Fonts links and change CSS font stacks to local/system fonts. Retain responsive and reduced-motion behavior.

- [ ] **Step 4: Run GREEN and render production viewports**

Run: `node --test tests/landing-copy.test.mjs tests/landing-palette.test.mjs && npm run build`

Expected: PASS. Browser checks cover 1440×900, 1180×800, 390×844, 430×932 plus ticker, language, product tabs, login, and subscribe.

- [ ] **Step 5: Commit**

```bash
git add public/landing.css public/landing.html tests/landing-copy.test.mjs tests/landing-palette.test.mjs
git commit -m "feat: apply approved palette to marketing"
```

### Task 4: Desktop shell and role-adaptive Today

**Files:**
- Create: `src/zeroBaseShell.jsx`
- Create: `src/zeroBaseToday.jsx`
- Modify: `src/main.jsx`
- Modify: `src/productShell.jsx`
- Create: `tests/zero-base-shell.test.mjs`
- Create: `tests/zero-base-shell-browser.jsx`
- Create: `tests/run-zero-base-shell-browser.mjs`

**Interfaces:**
- Consumes: `data`, `navigate`, canonical selection, search, context, trace, and current runtime workbench content.
- Produces: `ZeroBaseDesktopShell` and `ZeroBaseToday`.

- [ ] **Step 1: Write failing component and behavior tests**

Require grouped navigation, one active family, command search, role-aware Today, real account/strategy/capability/knowledge summaries, controlled context/trace drawers, and unchanged canonical selection callbacks. Unavailable values must remain unavailable instead of zero.

- [ ] **Step 2: Run RED**

Run: `node --test tests/zero-base-shell.test.mjs`

Expected: FAIL because the new shell components do not exist.

- [ ] **Step 3: Implement the desktop shell**

Compose the existing real workbench `content` inside `.zeroBaseProduct`. Use approved family navigation, global search/runtime facts, actual Today data, and controlled context/trace drawers that retain canonical identity.

- [ ] **Step 4: Run GREEN and browser interactions**

Run: `node --test tests/zero-base-shell.test.mjs && node tests/run-zero-base-shell-browser.mjs`

Expected: PASS at 1440×900 and 1180×800 for navigation, search, selection, context, trace, loading, stale, failed, forbidden, and disabled states.

- [ ] **Step 5: Commit**

```bash
git add src/zeroBaseShell.jsx src/zeroBaseToday.jsx src/main.jsx src/productShell.jsx tests/zero-base-shell.test.mjs tests/zero-base-shell-browser.jsx tests/run-zero-base-shell-browser.mjs
git commit -m "feat: rebuild desktop operating shell"
```

### Task 5: Desktop workbench convergence

**Files:**
- Modify: `src/conceptPages.jsx`
- Modify: `src/conceptPages.css`
- Modify: `src/conceptSettings.css`
- Modify: `src/workspacePages.jsx`
- Modify: `src/workspace.css`
- Modify: `src/operationsView.js`
- Modify: `src/controlConfigurationView.js`
- Create: `tests/zero-base-workbenches.test.mjs`

**Interfaces:**
- Consumes: real-data components, `CanonicalRegistryButton`, action handlers, and `WorkspaceStateBoundary`.
- Produces: consistent page headings, sub-navigation, registry/detail composition, form composition, and truthful states for every family.

- [ ] **Step 1: Write failing representative contracts**

Cover one real surface from AI, portfolio, strategy, knowledge, capability, reviews, guard, operations, and configuration. Assert family identity, authoritative fields, action wiring, and state boundaries.

- [ ] **Step 2: Run RED**

Run: `node --test tests/zero-base-workbenches.test.mjs`

Expected: FAIL on missing family wrappers.

- [ ] **Step 3: Recompose existing workbenches**

Apply new wrappers/primitives, split oversized card walls into registry/detail or truth/action layouts, centralize configuration editors, and keep callbacks and permission gates unchanged. Do not introduce sample values.

- [ ] **Step 4: Run GREEN and focused product tests**

Run: `node --test tests/zero-base-workbenches.test.mjs tests/control-configuration-view.test.mjs tests/operations-view.test.mjs tests/patrol-view.test.mjs tests/strategy-research-view.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/conceptPages.jsx src/conceptPages.css src/conceptSettings.css src/workspacePages.jsx src/workspace.css src/operationsView.js src/controlConfigurationView.js tests/zero-base-workbenches.test.mjs
git commit -m "feat: converge desktop workbenches"
```

### Task 6: APP shell, navigation, and all subpages

**Files:**
- Create: `src/zeroBaseMobile.jsx`
- Modify: `src/mobile.jsx`
- Modify: `src/mobileNavigation.js`
- Modify: `src/mobileOperations.jsx`
- Modify: `src/styles.css`
- Modify: `tests/mobile-navigation.test.mjs`
- Create: `tests/zero-base-mobile-browser.jsx`
- Create: `tests/run-zero-base-mobile-browser.mjs`

**Interfaces:**
- Consumes: existing mobile content, `resolveMobileRoute`, `MobileShellTools`, and real `api` callbacks.
- Produces: five-root `ZeroBaseMobileShell`, family-local rails/sheets, and non-duplicated More.

- [ ] **Step 1: Write failing navigation and browser tests**

Assert Today/AI/Assets/Intelligent/More roots, no duplicated root in More, one active tab, correct routes/subpages, real component clicks, context/trace identity, and zero overflow at 390×844 and 430×932.

- [ ] **Step 2: Run RED**

Run: `node --test tests/mobile-navigation.test.mjs && node tests/run-zero-base-mobile-browser.mjs`

Expected: FAIL on the old workspace tab model.

- [ ] **Step 3: Implement APP shell and workbench adaptation**

Wrap existing data-connected content in the new family model. Use bottom tabs only for roots, horizontal family sub-navigation, and sheets for context, trace, runtime safety, and configuration. Preserve refresh, haptics, kill-switch confirmation, and permissions.

- [ ] **Step 4: Run GREEN and mobile gates**

Run: `node --test tests/mobile-navigation.test.mjs && node tests/run-zero-base-mobile-browser.mjs && node tests/run-production-shell-selection-browser.mjs`

Expected: PASS at 390×844 and 430×932.

- [ ] **Step 5: Commit**

```bash
git add src/zeroBaseMobile.jsx src/mobile.jsx src/mobileNavigation.js src/mobileOperations.jsx src/styles.css tests/mobile-navigation.test.mjs tests/zero-base-mobile-browser.jsx tests/run-zero-base-mobile-browser.mjs
git commit -m "feat: rebuild APP product shell"
```

### Task 7: Web and APP authentication redesign

**Files:**
- Modify: `src/landing.jsx`
- Modify: `src/styles.css`
- Create: `tests/zero-base-auth.test.mjs`
- Modify: `tests/run-authenticated-shell-browser.mjs`

**Interfaces:**
- Consumes: current login/register/MFA/Turnstile/subscription/server/transport callbacks.
- Produces: one zero-base auth presentation responsive across web and native sizes.

- [ ] **Step 1: Write failing auth behavior/visual contract**

Render real auth paths and assert all existing fields, terms, privacy, risk acknowledgement, MFA, disabled registration, connection security, and server settings remain reachable under `.zeroBaseAuth`.

- [ ] **Step 2: Run RED**

Run: `node --test tests/zero-base-auth.test.mjs`

Expected: FAIL because the new auth scope is absent.

- [ ] **Step 3: Implement redesigned authentication**

Change composition/classes only; preserve submit handlers and callbacks. Use Paper/Ink/Acid/Green, remove heavy ambient blur, and keep inputs at least 16px on mobile.

- [ ] **Step 4: Run GREEN and authenticated lifecycle gate**

Run: `node --test tests/zero-base-auth.test.mjs tests/auth-session-policy.test.mjs tests/transport-security.test.mjs && node tests/run-authenticated-shell-browser.mjs`

Expected: PASS at 1440, 1180, 390, and 430.

- [ ] **Step 5: Commit**

```bash
git add src/landing.jsx src/styles.css tests/zero-base-auth.test.mjs tests/run-authenticated-shell-browser.mjs
git commit -m "feat: redesign authentication experience"
```

### Task 8: Performance, accessibility, and final evidence

**Files:**
- Create: `tests/zero-base-performance.test.mjs`
- Create: `docs/zero-base-ui-evidence.md`
- Modify: `docs/ui-function-map.md`
- Modify: `docs/ui-prototype-parity-matrix.md`

**Interfaces:**
- Consumes: final production build and browser runners.
- Produces: bundle/font/motion contracts and final screenshot/evidence index.

- [ ] **Step 1: Write and run performance/accessibility gates**

Assert no Google Fonts, no new dependency, reduced motion, touch target floor, lazy page boundaries, and no document overflow. Run keyboard/focus/ESC checks in browser runners.

- [ ] **Step 2: Run the full fresh verification set**

```bash
npm test
npm run lint
npm run build
node tests/run-authenticated-shell-browser.mjs
node tests/run-canonical-selection-browser.mjs
node tests/run-production-shell-selection-browser.mjs
node tests/run-event-risk-production-visual.mjs
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Capture and inspect evidence**

Capture marketing, auth, Today, AI, portfolio, strategy, knowledge, capability, reviews, guard, operations, and configuration at desktop 1440×900 / 1180×800 and APP 390×844 / 430×932. Capture overlays, long content, loading, empty, stale, degraded, failed, forbidden, disabled, and confirm states. Verify every image opens and matches final HEAD.

- [ ] **Step 4: Update function/evidence documentation**

Record the final family-to-feature mapping, real data source, route, permission/action contract, browser evidence path, test command, and final commit hash. Do not describe inherited screenshots as newly captured.

- [ ] **Step 5: Commit**

```bash
git add tests/zero-base-performance.test.mjs docs/zero-base-ui-evidence.md docs/ui-function-map.md docs/ui-prototype-parity-matrix.md
git commit -m "docs: verify zero-base product system"
```
