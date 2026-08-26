# KORDYN Product UI Contract

## Product

KORDYN is a governed AI digital-asset trading operating system. It connects market and account facts, AI analysis, deterministic risk controls, controlled execution, reconciliation, review, and governed learning.

The authenticated product is being rebuilt from the currently deployed functionality. The redesign must not replace real behavior with prototype-only interactions or synthetic runtime state.

## Users

- Trader / subscriber: needs the current conclusion, evidence, risk state, positions, execution truth, and clear next action.
- Owner: uses the same information architecture with additional evidence, validation, release, configuration, user, and subscription authority.

Permissions remain server-authoritative. Restricted surfaces explain the required authority without exposing protected data or presenting enabled actions.

## Product Architecture

AI Trader is the primary operating surface, while the first authenticated view keeps account truth, risk, active strategies, capabilities, knowledge evidence, and required actions immediately visible. The product is organized into these page families:

1. Today — role-adaptive operating brief, account/risk summary, current AI focus, and action queue.
2. AI Trader — conversation, autonomous patrol, intelligence, watch, event calendar, plan explanation, tool trace, and poster export.
3. Account & Trading — portfolio overview, market, account, positions, plans/execution, orders/fills, protection, and reconciliation.
4. Strategy — catalog, details, studio, historical validation, and pure-forward validation.
5. Knowledge — overview, source import, evidence, graph, extracted artifacts, and workflow candidates.
6. Capability — overview, native tools, workflows, MCP, connectors, and imported skills.
7. Learning & Review — trade reviews, review details, Owner optimization, and candidate lessons.
8. Risk & Boundaries — risk posture, event risk, permission boundaries, and deterministic-rule monitoring.
9. Operations — runtime health, tasks/runs, event-input health, recovery, notifications, audit, and operational proof.
10. Configuration — the sole editing home for trading/runtime, risk rules, exchange, environment, network, backup, security, notifications, event sources, models/keys, Agents, users, and subscriptions.

Desktop groups these families into Core, Intelligent assets, and Governance. Runtime truth remains in its operational page family and links to the authoritative editor in Configuration. Legacy server sections and routes remain compatibility adapters rather than user-facing information architecture.

The main product loop is:

`AI Trader decision → Account & Trading execution → Learning & Review → governed Strategy / Knowledge / Capability release`

Risk & Boundaries governs the loop. Operations proves and recovers it. Configuration owns durable edits. The business event calendar remains in AI Trader, while Operations observes the health of the inputs that feed it.

Smart Forms and DAO Governance are retired and must not appear in navigation, search, More, marketing product demos, desktop, or APP.

## Research Asset Model

Lab is not three unrelated libraries.

- Imported books, documents, reports, reviews, and imported skills enter the Knowledge Incubator.
- Incubated material can produce only the artifacts supported by the deployed code: concepts, discipline rules, trading methods, closed-template strategy drafts, knowledge lenses, knowledge workflows, and governed imported-skill records.
- Validated outputs graduate into the Strategy Registry or Capability Registry with provenance and lifecycle evidence.
- Existing system-native strategies, tools, connectors, MCP grants, and other built-in capabilities enter their formal registries directly; they are not presented as products of knowledge ingestion.
- Trade reviews can produce knowledge lessons or Owner improvement candidates. They never directly rewrite live strategy, risk, or permission configuration.

The interface must not claim arbitrary executable code generation, dynamic unknown-tool registration, arbitrary Telegram delivery of AI messages, editable definitions for system-managed schedules, or multiple configurable poster templates.

## Visual Direction

The authenticated product, web authentication, APP authentication, and marketing visual system are governed by the approved zero-base design specification dated 2026-08-25. This system does not inherit visual authority from any earlier prototype or deployed UI version.

- Paper `#F4F1E9`, Ink `#111311`, Acid `#CCFF3D`, ecosystem Green `#4FB78B`, Danger `#E25645`, Amber `#EFB44B`, muted text `#697169`, and White `#FFFFFF` are the shared semantic palette.
- Acid means current, explicitly authorized, or ready for action. Green means healthy or verified. Danger and Amber remain reserved for their semantic states.
- Web3 character comes from asset identity, network topology, evidence relationships, state paths, verifiable provenance, and restrained circular/orbital motifs.
- The product must not fall back to generic purple gradients, glass-card walls, particle-heavy animation, or decorative effects that obscure task state.
- Status always includes text or a symbol in addition to color.
- IDs, versions, timestamps, prices, quantities, and measurements use tabular/monospace treatment; prose does not use monospace as decoration.

AI Trader remains the main operating console, and every page family uses the same identity, evidence, relationship, state, action, and provenance grammar. The marketing page retains its content, section order, bilingual copy, product-demo meaning, legal language, and conversion behavior while adopting the shared palette and visual system.

## Authenticated Global Shell

Desktop uses grouped family navigation, a canonical object/function switcher, role-aware account and safety truth, and bounded Context and Trace dialogs. Search is built only from canonical routes and currently loaded production objects; empty and unavailable results are explicit. Page-local selection must update the same global object identity or fail closed.

Context projects evidence, risk, mandate, object, version, permissions, and a safe route-level next action from the selected object or current page facts. Missing fields remain `Unavailable`. Trace projects `Sense → Recall → Plan → Guard → Execute → Monitor → Review` from loaded facts, using only `complete`, `waiting`, `blocked`, or `unavailable`. A stage opens its real detail or evidence surface; no missing fact becomes zero or success.

Post-login APP uses five roots: `Today | AI | Assets | Intelligent | More`. A root destination is never duplicated in More. Local rails and drill-down screens preserve the same object identity, status, permission, and action meanings as desktop. Objects, Context, and Trace open as touch-sized bounded sheets; dense desktop workbenches become task-led list/detail or full-screen flows.

Web and APP authentication are both redesigned within the shared zero-base system while preserving login, registration, MFA, invitation, consent/privacy, risk acknowledgement, Turnstile, server selection, subscription, transport, and error behavior.

Shared confirmations preserve focus, keyboard, touch, disabled, retry, typed-confirmation, and server-authoritative result behavior. Flatten and Kill remain distinct deployed actions; neither action claims optimistic success.

## Desktop and Mobile

Desktop and APP share product capability, route meaning, view models, permissions, API actions, object identity, and safety behavior. They do not share one forced layout.

- Desktop uses grouped page-family navigation, high-density workbenches, registries, contextual inspectors, and bounded overlays.
- APP uses `Today | AI | Assets | Intelligent | More`, with local rails for page-family destinations.
- Desktop multi-panel workbenches become task-led list/detail, drill-down screens, sheets, or full-screen flows on APP.
- APP preserves every field and action through progressive disclosure rather than shrinking desktop tables or stacking every panel.
- Root destinations are not duplicated in More, and persistent configuration editors exist only in Configuration.

## Verification Evidence

- `docs/ui-function-map.md` records the zero-base page families, real functionality, and Desktop ↔ APP ownership.
- `docs/ui-prototype-parity-matrix.md` retains its historical filename for compatibility, but now audits zero-base Desktop ↔ APP consistency and does not grant authority to an older prototype.
- `docs/zero-base-ui-evidence.md` records the source chain, browser commands, viewports, interaction coverage, performance results, and current evidence inventory.
- Current visual evidence lives under `.impeccable/zero-base/` and covers Desktop 1440×900 and 1180×800, APP 390×844 and 430×932, authentication, marketing, Context/Trace, confirmations, and loading/failed/forbidden/stale/degraded states.

Evidence is observational only: production screens continue to use deployed data loaders, actions, permissions, error boundaries, and server-authoritative outcomes. No screenshot fixture, DOM patch, or synthetic success path is a product capability.

## Truth and Safety Boundaries

- Existing API, state, permission, authorization, risk, execution, audit, and reconciliation semantics remain authoritative.
- Candidate signals, AI qualification, plans, risk results, authorization, orders, fills, positions, reviews, and knowledge artifacts remain distinct objects.
- Configuration target and effective runtime state are displayed separately.
- No optimistic success for orders, mode changes, mandate/rule changes, Flatten All, Kill Switch, or security changes.
- Kill Switch still permits risk-reducing cancel, close, protection, reconciliation, and recovery actions, while blocking new risk and non-reducing mutations.
- Stale or degraded data retains the last valid value, source, timestamp, and recovery explanation. Empty, loading, failed, forbidden, and stale states are not interchangeable.

## Implementation Constraints

- Preserve deployed server sections, real routes, object IDs, data loaders, permissions, actions, and safety behavior through compatibility adapters until backend contracts are deliberately migrated.
- Do not expose legacy server section names as the user-facing information architecture.
- Prefer shared domain/view-model modules over duplicated Desktop/APP business logic.
- APP-specific presentation components are expected where interaction models differ.
- Add no production mock data, arbitrary executable-tool generation, or unsupported runtime capability claims.
