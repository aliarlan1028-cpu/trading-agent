# August 15 Product UI Professional Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Professionally polish the deployed August 15 Web and Capacitor APP UI across all current product surfaces while preserving every existing capability and behavior.

**Architecture:** Converge the active product from shared foundations outward. Real browser contracts define typography, touch, focus, dialog, responsive, and geometry outcomes before production edits. Existing selectors are corrected at their owning layer; no late override stylesheet is introduced.

**Tech Stack:** React 19, Vite 6, Capacitor 7, CSS, Node test runner, Chrome DevTools Protocol.

**Spec:** `docs/superpowers/specs/2026-09-02-aug15-professional-polish-design.md`

## Global Constraints

- Preserve business logic, API payloads, database behavior, permissions, auth, trading, execution, risk, routes, and state semantics.
- Preserve marketing content and APP Agent animation.
- No new legacy override stylesheet and no `!important`-based architecture.
- APP touch targets are at least 44×44px; visible normal text meets the approved type floor and contrast contract.
- 1440, 1280, 768, 430, and 390 must have no document-level horizontal overflow.
- Use production-shaped real application data; no credentials or secrets in fixtures or evidence.

---

### Task 1: Establish executable visual-quality contracts

**Files:**
- Create: `tests/run-aug15-polish-browser.mjs`
- Modify: `tests/run-aug15-visual-browser.mjs`

**Interfaces:**
- Consumes: current real `.appShell` and `.mShell2` production surfaces.
- Produces: a Chrome gate that reports viewport, text floor, touch floor, focus, dialog, research-funnel, tablet, and overflow facts as JSON.

- [ ] **Step 1: Write the failing browser assertions**

  Add real-browser assertions which fail on the baseline for: visible essential APP controls below 44px; visible essential APP text below 12px; account and danger dialogs missing labelled modal semantics/focus containment/Escape/return; keyboard-inactive Registry rows; one-character Research funnel labels; and unbounded 768 chat measure.

- [ ] **Step 2: Run the gate and record the expected baseline failures**

  Run a temporary authenticated backend and Vite at localhost, then run `node tests/run-aug15-polish-browser.mjs`. The gate must fail for the named baseline defects rather than for startup or fixture errors.

- [ ] **Step 3: Keep the existing smoke runner compatible**

  Extend `run-aug15-visual-browser.mjs` only with stable selectors and evidence captures needed by later tasks; do not weaken existing navigation assertions.

### Task 2: Converge foundations, type, contrast, and browser surfaces

**Files:**
- Modify: `src/aug15/styles.css`
- Modify: `src/aug15/conceptPages.css`
- Modify: `src/entry.css`
- Modify: `src/aug15-auth.css`
- Test: `tests/run-aug15-polish-browser.mjs`

**Interfaces:**
- Consumes: incumbent CSS custom properties and active August 15 selectors.
- Produces: semantic foreground/action/focus tokens and consistent role-based type/control dimensions.

- [ ] **Step 1: Verify the type and contrast assertions are RED**

  Run the focused browser gate and retain the computed values in its failure output.

- [ ] **Step 2: Correct the owning tokens and shared selectors**

  Darken secondary text and warning/action foregrounds to pass contrast; introduce a dedicated action background where white text is used; define visible `:focus-visible`, selection, caret, and scrollbar treatments; raise sub-11px active text declarations to the approved role floor; keep mono limited to measurements and identifiers.

- [ ] **Step 3: Correct reduced-motion behavior**

  Replace the global near-zero animation/transition rule with scoped decorative-motion removal while keeping focus, disclosure, progress, and status feedback visible.

- [ ] **Step 4: Run focused browser and auth/entry checks GREEN**

  Run the polish gate plus `node tests/run-zero-base-auth-browser.mjs` and the entry-only authenticated-shell gate.

### Task 3: Repair modal, drawer, sheet, and Registry keyboard behavior

**Files:**
- Modify: `src/aug15/App.jsx`
- Modify: `src/aug15/mobile.jsx`
- Modify: `src/aug15/conceptPages.jsx`
- Modify: `src/aug15/assistant.jsx`
- Modify: `src/aug15/styles.css`
- Test: `tests/run-aug15-polish-browser.mjs`

**Interfaces:**
- Consumes: `useDialogFocus` from `src/dialogFocus.js` and existing close callbacks.
- Produces: labelled modal surfaces with trapped focus, Escape close, trigger return, and keyboard-operable Registry rows.

- [ ] **Step 1: Verify dialog and keyboard assertions are RED**

  Open the real account modal, emergency confirmation, drawer, and representative sheet; verify the focused contract fails before implementation.

- [ ] **Step 2: Apply the shared dialog contract**

  Add `role="dialog"`, `aria-modal="true"`, labelled headings, focus refs, `useDialogFocus`, and trigger return to real overlays without changing submission or close behavior.

- [ ] **Step 3: Add Registry keyboard activation**

  When `ConceptTable` receives `onRowClick`, make the real row focusable, expose selection state, and invoke the same handler for Enter and Space while preventing Space page-scroll.

- [ ] **Step 4: Run the focused browser contract GREEN**

  Prove focus begins inside, Tab remains inside, Escape closes, focus returns, and keyboard row activation changes the selected inspector.

### Task 4: Repair desktop hierarchy and core workspace geometry

**Files:**
- Modify: `src/aug15/styles.css`
- Modify: `src/aug15/conceptPages.css`
- Modify: `src/aug15/workspace.css`
- Modify: `src/aug15/workspace-additions.css`
- Modify: `src/aug15/conceptSettings.css`
- Test: `tests/run-aug15-polish-browser.mjs`

**Interfaces:**
- Consumes: current five-domain shell and current page/tab components.
- Produces: consistent page measure, grid rhythm, readable Context rail, horizontal Research funnel, and shared table/card/action hierarchy.

- [ ] **Step 1: Verify Research and desktop geometry assertions are RED**

  Assert at 1440 and 1180 that funnel labels have usable inline width, main content does not collide with the assistant FAB, and page columns stay above their readable minimum.

- [ ] **Step 2: Refine AI and Cockpit proportions**

  Reduce featureless conversation voids, preserve the input dock, give the contextual rail a readable minimum, and align cockpit truth metrics/chart/account panels to the same grid.

- [ ] **Step 3: Refine Research, Risk, Operations, and Settings**

  Repair the knowledge funnel, bound Registry/filter/inspector columns, normalize table rows and headers, remove nested-card emphasis where a section divider is sufficient, and align status/action hierarchy across centers.

- [ ] **Step 4: Validate 1440 and 1280 visually and geometrically**

  Run the polish gate and capture each domain overview plus Research strategy/capability and Settings model screens.

### Task 5: Repair APP touch, typography, and tablet composition

**Files:**
- Modify: `src/aug15/styles.css`
- Modify: `src/aug15/mobile.jsx`
- Test: `tests/run-aug15-polish-browser.mjs`

**Interfaces:**
- Consumes: existing five mobile roots, More drawer, sheets, and safe-area variables.
- Produces: 44px touch targets, readable mobile type, bounded 390/430 layouts, and a deliberate 768 content composition.

- [ ] **Step 1: Verify APP quality assertions are RED**

  Report each offending selector, size, route, and viewport instead of only a total count.

- [ ] **Step 2: Raise shared APP controls and text roles**

  Correct the owning navigation, chip, segmented control, calendar, search, row, icon-button, sheet, and form selectors. Preserve compact visual appearance using internal alignment rather than undersized hit areas.

- [ ] **Step 3: Introduce tablet-aware composition**

  At 768px, cap conversation measure, use available two-column arrangements for metrics and lists, and keep navigation/safe areas stable.

- [ ] **Step 4: Validate every APP route at 390, 430, and representative routes at 768**

  Require zero overflow, touch/type floors, visible focus, and no clipped long content.

### Task 6: Converge marketing, auth, entry, and product boundaries

**Files:**
- Modify: `public/landing.css`
- Modify: `src/aug15-auth.css`
- Modify: `src/entry.css`
- Modify: `src/aug15/landing.jsx` only if semantics require it
- Test: `tests/run-zero-base-auth-browser.mjs`
- Test: `tests/run-authenticated-shell-browser.mjs`

**Interfaces:**
- Consumes: current marketing copy, Agent animation, auth forms, public iframe isolation, and authenticated lifecycle states.
- Produces: shared typography/action/focus semantics without flattening the marketing dark world or changing auth behavior.

- [ ] **Step 1: Capture direct marketing and native auth baselines**

  Capture marketing 1440, web auth modal 1440, native login 390, registration 430, loading, and connection failure.

- [ ] **Step 2: Refine shared visual semantics**

  Align type, focus, action orange, form control dimensions, disabled treatment, and error hierarchy while keeping content and Agent motion intact.

- [ ] **Step 3: Run auth and entry interaction gates**

  Prove login/MFA/registration paths, focus trap, Escape, overflow, loading, failure, retry, and reduced motion.

### Task 7: Reduce active-path style and module waste

**Files:**
- Modify: `src/main.jsx`
- Modify: `src/aug15/App.jsx`
- Modify: active `src/aug15/**` imports only where build evidence proves a production-path cost
- Test: `tests/performance-boundary.test.mjs`
- Test: `tests/run-aug15-polish-browser.mjs`

**Interfaces:**
- Consumes: current authenticated lazy boundary and route ownership.
- Produces: unchanged runtime navigation with fewer initial production resources and no public/auth download of authenticated styles.

- [ ] **Step 1: Measure a fresh first authenticated load before navigation**

  Record transferred/decoded CSS and JS, resource count, DOM interactive, and load event timing separately from the all-pages audit.

- [ ] **Step 2: Write a failing budget regression test for proven removable cost**

  Base the literal budget on the measured production build and the specific duplicate import/module that will be removed; do not test a token name or source string.

- [ ] **Step 3: Remove only proven active-path waste**

  Preserve rollback-retained source off-path. Change dynamic import boundaries only when the production build and route browser test demonstrate equivalent behavior.

- [ ] **Step 4: Rebuild and remeasure**

  Report before/after values and keep public/auth lazy-boundary tests green.

### Task 8: Full verification, visual evidence, and delivery report

**Files:**
- Create: `.impeccable/review/aug15-professional-polish/` screenshots and machine-readable report
- Create: `docs/aug15-professional-polish-report.md`
- Modify: only files needed to correct defects found during verification

**Interfaces:**
- Consumes: completed production implementation and all focused gates.
- Produces: auditable before/after evidence and a final implementation report.

- [ ] **Step 1: Run final real-browser capture**

  Capture 1440×900, 1280×800, 768×1024, 430×932, and 390×844 across AI, Cockpit, Research, Risk, Operations, Settings, overlays, auth, entry, and marketing.

- [ ] **Step 2: Inspect images and run Impeccable once**

  Manually inspect the rendered result, then run `node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json` against the changed UI targets exactly once and fix real findings.

- [ ] **Step 3: Run fresh verification gates**

  Run focused tests, `npm test`, `npm run lint`, `npm run build`, `node tests/run-aug15-visual-browser.mjs`, `node tests/run-aug15-polish-browser.mjs`, auth/entry gates, and `git diff --check`.

- [ ] **Step 4: Write the report**

  Include summary, design-system changes, page coverage, responsive/APP decisions, before/after evidence, performance measurements, accessibility results, verification outputs, and narrow remaining issues.

- [ ] **Step 5: Review the final diff**

  Remove temporary artifacts, accidental churn, obsolete declarations introduced by the work, debug output, and unsupported claims before presenting the branch for integration.
