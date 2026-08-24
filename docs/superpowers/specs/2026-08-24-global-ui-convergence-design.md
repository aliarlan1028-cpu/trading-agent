# KORDYN Global UI/UX Convergence Design

## Superseding Visual Authority — 2026-08-24

The unique visual and interaction authority for this convergence is the completed interactive prototype, not a generalized interpretation of its color theme:

- Branch: `codex/kordyn-interactive-prototype`
- Commit: `1056233`
- Artifact: `prototypes/kordyn-operating-system.html`
- Blob: `43267ccfca051351823c668932c857350fb592b9`
- Prototype specification: `docs/superpowers/specs/2026-08-21-kordyn-interactive-operating-system-prototype-design.md` at commit `1056233`

Production desktop and post-login APP must reproduce the prototype's visual DNA and interaction grammar: exact semantic palette, typography hierarchy, density, continuous grids, one-pixel hard boundaries, Command Rail, Workspace Rail, Context Dock, Trace Rail, near-black truth/decision regions, acid-green current/authorized/action-needed states, Registry/Inspector/Ledger structures, global search, drawers/sheets, modals, destructive confirmations, and state expression. APP may rearrange these roles for touch, but it must not become a separate generic mobile-admin design. The login surface remains unchanged.

The prototype supplies presentation and interaction authority only. Production continues to use real data, permissions, actions, confirmations, errors, loading/empty/stale/failed/forbidden/disabled states, and backend semantics; prototype demo data or simulated success must never replace deployed behavior.

Completion requires the maintained `docs/ui-prototype-parity-matrix.md` plus real browser evidence at 1440×900, an intermediate desktop width, 390×844, and 430×932. Automated JSX/CSS tests cannot replace this visual gate.

## Purpose

Bring every authenticated desktop and mobile surface into the approved KORDYN operating-system visual language without removing deployed functionality, changing backend contracts, or weakening trading safety semantics.

This is a convergence pass, not a new product concept. The approved world remains: warm paper fields, near-black truth regions, hard one-pixel boundaries, continuous operational grids, restrained acid-green selection, and explicit evidence/state labels.

## Scope

Included:

- Mobile primary navigation and the More drawer.
- Desktop and mobile deep pages under AI Trader, Live Desk, Lab, Control, Operations, and Configuration.
- Shared page primitives, spacing, typography, borders, statuses, filters, registries, inspectors, forms, empty/error/loading states, drawers, sheets, and responsive behavior.
- Representative page-level restructuring where legacy card layouts conflict with the approved information hierarchy.

Excluded:

- Native/mobile authentication and registration.
- Backend APIs, resource section names, permissions, safety gates, execution semantics, reconciliation semantics, and data ownership.
- Marketing pages.
- New product capabilities or synthetic runtime claims.

## Navigation Architecture

### Desktop

The five primary workspaces remain `AI Trader / Live Desk / Lab / Control / Operations`. Configuration remains a global utility. Each workspace owns its local navigation and deep routes.

### Mobile

The bottom navigation remains `AI / Live / Lab / Control / More`.

The More drawer becomes a utility launcher, not a second sitemap. It contains only:

- Operations.
- Configuration.
- Language and other true global utilities already present in the drawer shell.

Features belonging to AI, Live, Lab, or Control must not also appear in More. Instead, each primary workspace exposes its own local navigation:

- AI: Dialogue, Intelligence, Watch, Events.
- Live: Market/account overview, Positions, Execution/review, Orders/fills.
- Lab: Map, Incubation, Strategies, Capabilities, Reviews.
- Control: Posture/permissions, Rules, Event risk, effective operating boundary views supported by current routes.

Local navigation may use a compact horizontal rail, segmented workbench header, or task-led index depending on content density. It must preserve existing route resolution and accepted server sections.

## Visual System

### Shared surface grammar

- Paper ground: warm, quiet, and continuous across the workspace.
- Truth field: near-black regions reserved for authoritative current state, high-priority risk, execution, and recovery summaries.
- Selection: acid green only for the current destination, authorized action, or explicit action-needed state.
- Boundary: one-pixel rules and continuous grids replace floating card walls.
- Corners: square or minimally rounded for operational surfaces; rounded pills remain only for compact status semantics.
- Depth: no broad soft shadow, glow, glass, or decorative gradient.
- Type: strong editorial hierarchy for page titles; tabular/monospace treatment only for IDs, versions, timestamps, prices, quantities, measurements, and compact operational metadata.
- Icons: Lucide only, with consistent size and stroke; no glyph substitutes.

### Shared component roles

- Workspace masthead: code, title, concise purpose, current state.
- Local navigation rail: workspace-owned destinations and current context.
- Truth band: authoritative summary with source/state explanation.
- Registry: dense rows for objects, runs, evidence, and settings.
- Inspector: selected object context and permitted actions.
- Evidence ledger: timestamps, provenance, versions, audit and run records.
- Action bar: one clear primary action, risk-reducing actions separated from ordinary mutations.
- State boundary: distinct loading, empty, stale, failed, forbidden, and disabled presentations.
- Mobile list/detail: deep information through drill-down rather than compressed desktop tables.

## Page Convergence Strategy

### AI Trader

Preserve the deployed conversation experience and Command treatment. Add workspace-local mobile navigation so Intelligence, Watch, and Events no longer depend on More. Deep intelligence, watch, event, patrol receipt, and poster flows inherit the shared borders, state language, and evidence treatment without flattening the conversation into a generic dashboard.

### Live Desk

Preserve the current trading-desk topology. Normalize deep market, position, execution, review, orders/fills, and account-health surfaces around truth bands, registries, inspectors, and evidence ledgers. Orders, fills, positions, and protection remain distinct authoritative objects.

### Lab

Keep the research lifecycle and dual-origin asset model. Normalize Knowledge Incubation, Strategy Registry, Capability Registry, validation, review, and Owner release around provenance-first rows and explicit lifecycle stages. System-native assets remain visibly distinct from knowledge-derived candidates.

### Control

Keep Control read-only for effective runtime truth. Normalize risk posture, event risk, permission boundaries, and rule monitoring. Durable editing remains linked to Configuration rather than duplicated inside Control.

### Operations

Keep the completed Command, Tasks & Runs, Recovery, Audit, and Inbox design as the reference implementation. Other workspaces should converge toward its material discipline, not copy its exact page topology.

### Configuration

Replace legacy nested card styling with a configuration registry, section index, bounded editor panels, explicit saved-target versus effective-state separation, and consistent destructive-action treatment. Existing forms and endpoints remain unchanged.

## Interaction Rules

- Every visible navigation item has one primary home.
- Deep links and compatibility aliases continue to resolve.
- Mobile drill-down preserves all existing fields and permitted actions.
- Mutations use existing confirmation, busy, success, failure, and refresh behavior.
- No optimistic execution, risk, security, reconciliation, or recovery success.
- Keyboard focus remains visible on desktop; touch targets remain at least 40 CSS pixels on mobile controls.
- Status never relies on color alone.
- Long Chinese/English content must wrap without horizontal page overflow.

## Implementation Architecture

1. Extract a pure mobile navigation model that defines bottom destinations, workspace-local destinations, and More utilities. Both rendering and route-coverage tests consume this model.
2. Add shared convergence classes/tokens at the product-system level and mobile shell level. Scope them to authenticated product surfaces so login and marketing remain untouched.
3. Apply the shared roles to legacy deep pages in bounded workspace batches. Prefer reusable wrapper classes and existing component contracts; restructure JSX only where hierarchy cannot be corrected by a shared primitive.
4. Keep all view-model and backend action code unchanged unless a presentation defect exposes an existing route mismatch.
5. Remove obsolete duplicate drawer entries and dead styling after every route remains reachable from its primary workspace.

## Verification

- Test-first navigation contract: bottom tabs remain stable, More contains only Operations and Configuration, and every removed drawer destination is reachable through its owning workspace rail.
- Render-smoke coverage for every workspace rail and representative deep page.
- Route-registry tests for desktop/mobile deep links and compatibility aliases.
- Browser checks at wide desktop, intermediate desktop, and mobile phone width.
- Check long content, empty, loading, stale, failed, forbidden, disabled, and destructive-action states where fixtures exist.
- Run the Impeccable detector exactly once after final UI edits.
- Run the full test suite, ESLint, production build, and `git diff --check`.

## Acceptance Criteria

- The mobile More drawer contains no AI, Live, Lab, or Control feature already owned by a bottom-tab workspace.
- Every removed drawer entry has an obvious, tested local-workspace route.
- Representative deep pages in all six authenticated areas visibly share the approved surface grammar.
- No old generic SaaS card-wall treatment remains in the migrated deep paths.
- No deployed functionality, field, action, permission boundary, or compatibility route is lost.
- Mobile authentication remains visually and behaviorally unchanged.
- Desktop and mobile have no page-level horizontal overflow at supported widths.
