# KORDYN V2 Concept-Faithful Rebuild Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a concept-faithful authenticated KORDYN Desktop and APP frontend with the existing 66 production capabilities, real permissions/actions/state, route-level loading, and a reversible production cutover.

**Architecture:** Keep `useApi()`, production endpoints, permissions, canonical object identity, and server outcomes authoritative. Add an isolated `src/kordynV2/` presentation layer with four canonical domains, device-specific presenters, shared view models, and domain-level lazy chunks; `src/main.jsx` becomes the authenticated old/new cutover boundary. Implement Desktop and APP together inside each domain plan, then run a separate convergence and cutover plan.

**Tech Stack:** React 18, Vite 6, plain scoped CSS, lucide-react, `sharp`, Node `node:test`, existing CDP/Chrome browser runners.

**Spec:** `docs/superpowers/specs/2026-08-26-kordyn-concept-faithful-product-rebuild-design.md`

## Global Constraints

- The 15 SHA-pinned rasters in `.impeccable/mocks/kordyn-v2-approved/` are spatial and visual contracts, not inspiration.
- `src/productCoverage.js` and `docs/kordyn-v2-capability-migration-matrix.md` must remain exactly `66` matching capability IDs unless a separately approved product-capability change modifies both.
- Authenticated navigation exposes exactly `AI 交易员 / 账户交易 / 智能资产 / 系统治理` on Desktop and APP; no authenticated `今日`, `更多`, Smart Forms, or DAO Governance destination.
- Production API, action, permission, state, risk, execution, audit, reconciliation, and recovery semantics remain unchanged and server-authoritative.
- No production mock data, secrets, credentials, unsupported tool generation, arbitrary Telegram delivery, or optimistic protected-action success.
- Public marketing and authentication presentation remain unchanged in this program; the new authenticated CSS must not leak into either surface.
- Desktop supports `1440x900` and `1180x800`; APP supports `390x844` and `430x932`; no document-level horizontal overflow.
- Mobile touch targets are at least `44x44` CSS pixels; focus is visible; dialogs/sheets trap and return focus; motion respects `prefers-reduced-motion`.
- Public initial CSS remains below `40 KiB`; public initial JavaScript remains below `450 KiB`; default V2 AI route CSS including shell stays below `180 KiB`; every inactive domain CSS chunk stays below `120 KiB` minified.
- The V2 authenticated path must never load the legacy authenticated `productStyles` bundle in the same session.
- Each task follows RED → GREEN → focused regression → review → commit. A reviewer may reject a task independently of later tasks.

---

## Sub-plan map

| Order | Plan | Independently testable result | Approved concept coverage |
| ---: | --- | --- | --- |
| 1 | `2026-08-26-kordyn-v2-01-foundation-shell.md` | Four-domain registry, cutover boundary, Desktop/APP shells, truth modes, read-only AI 客服, visual harness | Shared navigation and shell grammar from all 15 comps |
| 2 | `2026-08-26-kordyn-v2-02-ai-domain.md` | Real AI mission, signals, watch, events, dialog, approval, output on Desktop and APP | Desktop AI mission/signals; Mobile mission/approval |
| 3 | `2026-08-26-kordyn-v2-03-account-domain.md` | Real market, account, positions, plans, orders, fills and protection on Desktop and APP | Desktop account/position; shared account truth language |
| 4 | `2026-08-26-kordyn-v2-04-intelligent-assets-domain.md` | Real relationship, strategy, knowledge, capability, review/release on Desktop and APP | Five Desktop intelligent-asset comps; Mobile intelligent assets |
| 5 | `2026-08-26-kordyn-v2-05-governance-domain.md` | Real boundary, operations, event inputs, notifications, audit, recovery, configuration on Desktop and APP | Three Desktop governance comps; Mobile governance |
| 6 | `2026-08-26-kordyn-v2-06-convergence-cutover.md` | Complete state matrix, cross-domain identity, visual evidence, bundle budgets, rollback exercise, production switch | All 15 comps at all four target viewports |

## Dependency order

```text
01 Foundation + Shell
  ├── 02 AI domain ────────────┐
  ├── 03 Account domain ───────┤
  ├── 04 Intelligent assets ───┼── 06 Convergence + Cutover
  └── 05 Governance ───────────┘
```

Plans 02–05 all depend on Plan 01. They share interfaces but not component files. When execution uses subagents, implement them sequentially in this repository unless an isolated worktree strategy gives each agent a non-overlapping branch; they all eventually touch the central route registry and evidence index, so blind concurrent writes are prohibited.

## Stable interfaces across all plans

```js
// src/kordynV2/KordynV2Root.jsx
export function KordynV2Root({ api, lang, switchLang }) {}

// src/kordynV2/architecture/routes.js
export function resolveV2Location(route, device = "desktop") {
  return { domainId, workspaceId, legacyRoute, resourceSection, objectId, recognized };
}

// src/kordynV2/viewModels/state.js
export function normalizeResourceState({ resourceState, data, error, forbidden, actionOutcome }) {
  return { kind, retainsLastValid, message, retryable, actionOutcome };
}

// src/kordynV2/actions/createV2Actions.js
export function createV2Actions({ action, confirm, notify, download, navigate }) {
  return { ai, account, assets, governance, global };
}

// shared presenter contract
export function DomainWorkspace({ model, actions, selection, onSelect, device }) {}
```

No sub-plan may silently rename these interfaces. If implementation evidence requires a change, update this program plan and every consuming sub-plan in the same planning commit before code changes.

## Program checkpoints

### Checkpoint A — Foundation acceptance

- [ ] Run `node scripts/run-tests-isolated.mjs tests/kordyn-v2-architecture.test.mjs tests/kordyn-v2-cutover.test.mjs tests/kordyn-v2-state.test.mjs tests/kordyn-v2-shell.test.mjs`.
- [ ] Run `node tests/run-kordyn-v2-shell-browser.mjs` at all four viewports.
- [ ] Verify V2 shell loads no legacy authenticated stylesheet and public/auth builds are unchanged.
- [ ] Obtain specification and code-quality review for Plan 01 before any domain plan starts.

### Checkpoint B — Per-domain acceptance

After each of Plans 02–05:

- [ ] Run that plan’s focused Node tests.
- [ ] Run that plan’s real-component browser runner at Desktop and APP sizes.
- [ ] Verify the exact capability IDs owned by the domain remain reachable.
- [ ] Verify representative list selection changes shell Context/Proof identity.
- [ ] Verify protected actions still use the real confirmation and authoritative result path.
- [ ] Capture the plan’s approved concepts and inspect side-by-side regions.
- [ ] Obtain specification and code-quality review before proceeding.

### Checkpoint C — Final cutover acceptance

- [ ] Run `npm test`, `npm run lint`, and `npm run build` freshly.
- [ ] Run all V2 Chrome gates plus retained canonical-selection and protected-action gates.
- [ ] Produce valid 1440/1180/390/430 screenshots, region comparisons, overlays, state evidence, and performance output from final production HEAD.
- [ ] Run Impeccable’s detector once on the changed authenticated V2 targets, fix mechanical findings, then obtain a fresh visual finish review.
- [ ] Require Critical `0` and Important `0` from independent read-only review.
- [ ] Exercise the production V2 switch and rollback switch without changing backend state.
- [ ] Run `git diff --check` and require a clean worktree.

## Commit policy

Each child task includes its own exact commit. Do not squash task commits during implementation; they are rollback and review boundaries. The final V2 production switch is a separate commit from evidence documentation. Legacy authenticated component/CSS deletion is not part of this program and requires a separately approved cleanup plan after production observation.

## Execution stop

This program and its six child plans are planning artifacts. After they are complete, stop and ask the user to choose Subagent-Driven or Inline Execution. Do not begin Task 1 automatically.
