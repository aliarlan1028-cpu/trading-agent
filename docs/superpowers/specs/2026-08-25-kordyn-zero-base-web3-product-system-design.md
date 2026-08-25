# KORDYN Zero-Base Web3 Product System Design

## Status

Approved visual direction, ready for production implementation.

## Objective

Rebuild every authenticated desktop and APP surface around a new product system while preserving every deployed capability, real-data boundary, permission check, action, error state, and recovery path. The marketing page keeps its current content, section order, anchors, bilingual copy, ticker, login, subscription, contact, and conversion behavior; only its visual system changes.

## Product model

AI Trader is the primary operating surface, but it never hides the rest of the system. The first authenticated view must expose the current AI brief together with authoritative account equity, position/risk posture, active strategy context, available capabilities, knowledge evidence, and actions requiring attention.

The desktop product uses these page families:

1. `today` — role-adaptive operating brief and action queue.
2. `ai` — conversation, autonomous patrol, intelligence, watch, event calendar, and analysis poster.
3. `portfolio` — overview, market, account, positions, plans/execution, orders/fills, protection/reconciliation.
4. `strategy` — catalog, details, studio, historical validation, and pure-forward validation.
5. `knowledge` — overview, source import, evidence, graph, extracted artifacts, and workflow candidates.
6. `capability` — overview, native tools, workflows, MCP, connectors, and imported skills.
7. `reviews` — trade reviews, review details, Owner optimization, and candidate lessons.
8. `guard` — risk posture, event risk, permission boundaries, and rule monitoring.
9. `operations` — health, tasks/runs, event-input health, recovery, notifications, and audit.
10. `configuration` — trading/runtime, risk rules, exchange, environment, network, backup, security, notifications, event sources, models/keys, agents, users, and subscriptions.

`智能表单` and `DAO 治理` are not part of this product system and must not appear in navigation, search, More, marketing product demos, desktop, or APP.

## Navigation and ownership

Desktop groups page families into `Core`, `Intelligent assets`, and `Governance`. Persistent configuration editors live only in Configuration; runtime truth stays in its operational workspace with a link to the authoritative editor. Legacy runtime routes and server sections remain compatibility adapters, not user-facing information architecture.

APP uses five roots: Today, AI, Assets, Intelligent, and More. A tab-bar destination must not be duplicated in More. Touch layouts may reorder information, but use the same visual tokens, labels, object identity, status semantics, and action boundaries as desktop.

## Visual system

The palette is based on the approved E2P reference:

- Paper: `#F4F1E9`
- Ink: `#111311`
- Acid action/current state: `#CCFF3D`
- Ecosystem green: `#4FB78B`
- Danger: `#E25645`
- Amber warning: `#EFB44B`
- Muted text: `#697169`
- White surface: `#FFFFFF`

Web3 character comes from asset identity, network topology, evidence relationships, state paths, verifiable provenance, and restrained circular/orbital motifs. It must not come from a generic purple gradient, glass-card wall, or particle-heavy animation.

The shell alternates warm paper workspaces with near-black decision/truth surfaces. Acid green means current, explicitly authorized, or ready for action. Ecosystem green means healthy or verified. Danger and amber are reserved for their semantic states.

## Marketing boundary

`public/landing.html` retains the current semantic content, DOM section order, IDs, bilingual keys, live ticker, product-demo tabs, login/subscribe/contact actions, legal/risk language, and conversion flow. `public/landing.js` behavior remains unchanged except where accessibility or performance requires an implementation-neutral adjustment. `public/landing.css` is rebuilt around the approved palette. External Google font requests are removed in favor of fast system stacks.

## Auth boundary

Both desktop web authentication and APP authentication are redesigned. The forms continue using the existing login, MFA, registration, invitation, terms, privacy, risk acknowledgement, Turnstile, server selection, subscription, and error behaviors. No authentication or transport-security semantics change.

## Real-data and state boundary

Production components must continue to consume real `data`, `action`, `ensureSection`, `refresh`, permission, and routing contracts. No mock dashboard data may enter authenticated production paths. Existing loading, empty, stale, degraded, failed, forbidden, disabled, retry, confirm, and last-valid-data semantics remain fail-closed and visibly distinct.

Canonical object selection remains one identity path across desktop and APP. Page-local inspectors may remain, but selection must update global context and trace identity or fail closed.

## Performance boundary

- Add no new runtime dependency.
- Remove marketing Google Fonts network requests.
- Do not add global blur layers, particle canvases, or unbounded animations.
- All motion must stop under `prefers-reduced-motion: reduce`.
- Preserve lazy-loaded authenticated page boundaries.
- Mobile must have zero document-level horizontal overflow at 390×844 and 430×932.
- Desktop must remain usable at 1180×800 and 1440×900.

## Accessibility boundary

Keyboard, focus, ESC dismissal, dialog semantics, touch target sizing, disabled state, labels, and `aria-current` must remain functional. Text contrast must remain readable on Paper, Ink, Acid, Green, Danger, and Amber surfaces.

## Delivery and evidence

Each implementation batch requires focused tests, the full test suite, lint, production build, `git diff --check`, and real-browser interaction/visual evidence. Completion requires desktop and APP screenshots for representative workspaces plus overlay, long-content, loading, empty, stale, degraded, failed, forbidden, and disabled states.
