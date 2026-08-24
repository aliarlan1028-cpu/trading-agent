# KORDYN Product UI Contract

## Product

KORDYN is a governed AI digital-asset trading operating system. It connects market and account facts, AI analysis, deterministic risk controls, controlled execution, reconciliation, review, and governed learning.

The authenticated product is being rebuilt from the currently deployed functionality. The redesign must not replace real behavior with prototype-only interactions or synthetic runtime state.

## Users

- Trader / subscriber: needs the current conclusion, evidence, risk state, positions, execution truth, and clear next action.
- Owner: uses the same information architecture with additional evidence, validation, release, configuration, user, and subscription authority.

Permissions remain server-authoritative. Restricted surfaces explain the required authority without exposing protected data or presenting enabled actions.

## Product Architecture

The primary authenticated workspaces are:

1. AI Trader — dialogue, autonomous patrol results, intelligence, watch, event context, plan explanation, tool trace, and current poster export.
2. Live Desk — market, account, positions, current plans, execution, orders, fills, protection, and OMS ↔ OKX truth.
3. Lab — research map, knowledge incubation, strategy registry, capability registry, trade review, and Owner optimization.
4. Control — risk posture, effective runtime state, read-only operating target and mandate context, deterministic-rule monitoring, event risk, and permission boundaries.
5. Operations — runtime health, tasks and runs, event-input health, notifications, audit, reconciliation, recovery, and operational proof.

Configuration Registry is a global utility rather than a sixth primary workspace. It is the single visible editing home for durable settings such as operating mode, mandate, risk rules, environment, network, backup, security, OKX, event sources, notification channels, models, Agent profiles, users, and subscriptions.

The main product loop is:

`AI Trader decision → Live Desk execution → Lab learning and release`

Control governs the loop. Operations proves and recovers the loop. Configuration Registry owns durable edits.

Operations is organized as a duty workflow rather than a collection of monitoring pages: Command exposes current health and a priority attention queue; Tasks & Runs separates protected definitions from actual outcomes; Recovery owns reconciliation, scheduler recovery, execution-recovery links, and incident review; Audit and Inbox preserve immutable proof and explicit acknowledgement. The business event calendar stays in AI Trader, while Operations observes the health of the inputs that feed it.

## Research Asset Model

Lab is not three unrelated libraries.

- Imported books, documents, reports, reviews, and imported skills enter the Knowledge Incubator.
- Incubated material can produce only the artifacts supported by the deployed code: concepts, discipline rules, trading methods, closed-template strategy drafts, knowledge lenses, knowledge workflows, and governed imported-skill records.
- Validated outputs graduate into the Strategy Registry or Capability Registry with provenance and lifecycle evidence.
- Existing system-native strategies, tools, connectors, MCP grants, and other built-in capabilities enter their formal registries directly; they are not presented as products of knowledge ingestion.
- Trade reviews can produce knowledge lessons or Owner improvement candidates. They never directly rewrite live strategy, risk, or permission configuration.

The interface must not claim arbitrary executable code generation, dynamic unknown-tool registration, arbitrary Telegram delivery of AI messages, editable definitions for system-managed schedules, or multiple configurable poster templates.

## Visual Direction

The approved direction is an editorial trading operating system inspired by the compositional qualities of E2P DAO Club's illustrative product and research/operations sections, without copying its brand assets.

- Paper-like warm surfaces, near-black command and truth regions, hard 1px boundaries, continuous grids, numbered operational structure, and dense but legible registry rows.
- Acid green is reserved for current selection, authorization, or explicit action-needed state.
- Orange is used for risk, event impact, and Owner attention; blue for runtime health and observability; violet for imported and methodological relationships.
- No generic SaaS card wall, decorative gradient or glow, glassmorphism, broad soft shadows, or oversized rounded containers.
- Status always includes text or a symbol in addition to color.
- IDs, versions, timestamps, prices, quantities, and measurements use tabular/monospace treatment; prose does not use monospace as decoration.

AI Trader retains its deployed conversation workflow and gains the Command visual grammar through an Agent Status Band and contextual Command Rail. Live Desk retains the approved trading-desk interaction model. Other workspaces are reorganized around authoritative objects, context, governance, and health/proof.

## Desktop and Mobile

Desktop and mobile share product capability, route meaning, view models, permissions, API actions, and safety behavior. They do not share one forced layout.

- Desktop uses the five-workspace rail, local workspace navigation, high-density workbenches, registries, and contextual inspectors.
- Mobile uses `AI | Live | Lab | Control | More`; More contains Operations and Configuration.
- Desktop multi-panel workbenches become task-led list/detail, drill-down screens, bottom sheets, or full-screen flows on mobile.
- Mobile preserves every field and action through progressive disclosure rather than shrinking desktop tables or stacking every panel.
- The existing native/mobile sign-in and registration experience is out of scope and remains unchanged.

## Truth and Safety Boundaries

- Existing API, state, permission, authorization, risk, execution, audit, and reconciliation semantics remain authoritative.
- Candidate signals, AI qualification, plans, risk results, authorization, orders, fills, positions, reviews, and knowledge artifacts remain distinct objects.
- Configuration target and effective runtime state are displayed separately.
- No optimistic success for orders, mode changes, mandate/rule changes, Flatten All, Kill Switch, or security changes.
- Kill Switch still permits risk-reducing cancel, close, protection, reconciliation, and recovery actions, while blocking new risk and non-reducing mutations.
- Stale or degraded data retains the last valid value, source, timestamp, and recovery explanation. Empty, loading, failed, forbidden, and stale states are not interchangeable.

## Implementation Constraints

- Preserve the accepted overview resource sections: `chat`, `cockpit`, `researchCenter`, `riskCenter`, `operationsCenter`, and `systemSettings` until backend contracts are deliberately migrated.
- Preserve all current legacy routes and object IDs through a compatibility route registry.
- Prefer shared domain/view-model modules over duplicated desktop/mobile business logic.
- Mobile-specific presentation components are expected where interaction models differ.
- Page-by-page migration and regression verification are required; no all-at-once shell cutover.
