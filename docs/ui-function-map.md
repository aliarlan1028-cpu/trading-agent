# KORDYN Desktop → Mobile UX Mapping and Audit

- Audit date: 2026-08-24
- Baseline commit: `f56bc622ec7a00fe947d2e859883a27d7d7e976c`
- Baseline branch: `codex/fix-profit-poster-and-learning-lifecycle`
- Scope: authenticated desktop and post-login mobile UI; mobile authentication is unchanged
- Verification baseline: Task 7 focused prototype/mobile/render gate passes 98/98; final build, lint, full route screenshots, and detector are owned by later gates

## 1. Current Architecture Audit

### Desktop

The desktop shell exposes five product workspaces plus the global Configuration Registry:

| Current entry | Current component | Current local views |
| --- | --- | --- |
| AI Trader | `AiTraderCenter` | Dialog, Intel, Watch |
| Live Desk | `TradingCenter` | Overview, Market, Positions, Execution, Orders & Fills, review status |
| Lab | `ResearchCenter` | Research Map, Knowledge, Strategies, Capabilities, Trade Reviews, Owner Review |
| Control | `RiskCenter` | Risk Posture, Effective Boundaries, Rule Monitor |
| Operations | `OperationsCenter` | Command, Tasks & Runs, Recovery, Audit, Inbox |
| Configuration Registry | `SettingsConcept` | Overview, Trading & Runtime, Risk Rules, Basics, OKX, Notifications, Event Sources, Models, Agents, Users & Subscriptions |

Non-AI workspaces use the grouped editorial product shell. AI Trader intentionally preserves the deployed conversation shell and applies the Command visual grammar inside it. Trade Review and Owner Review are owned by Lab, business Events are visible in AI Trader, and Control no longer contains durable editors. Legacy route names and server resource sections remain compatibility contracts rather than visible product ownership.

### Mobile

`MobileApp` remains a separate touch-first implementation, but navigation now resolves through the shared compatibility registry. Its authenticated shell uses:

- A 56px hard-edged masthead with the existing effective runtime/safety entry.
- A persistent 44px Context/Trace rail whose bounded sheets use the same factual projection as desktop.
- A 66px numbered bottom navigation: AI, Live, Lab, Control, More.
- Drawer: workspace-local destinations plus Operations and Configuration.
- Mobile-specific market, position, execution, risk, knowledge, capability, strategy, intelligence, calendar, and full Operations views.
- Native Operations flows for health triage, task/run inspection, permitted user-task creation and lifecycle controls, reconciliation, scheduler recovery, incidents, audit detail/export, and explicit notification acknowledgement.
- Native mobile configuration flows for Trading & Runtime, Mandate, automatic protections, Risk Rules, and Event Sources; lower-frequency infrastructure panels remain staged for the mobile-native page pass.
- Canonical route resolution preserves workspace and subview intent while the mobile stack retains its own presentation state.

The mobile implementation is not desktop CSS scaled down. Product ownership now matches desktop; the remaining work is converting lower-frequency infrastructure/admin configuration and remaining object-detail panels to native mobile task flows without changing their service contracts.

### Shared Product Logic Already Available

The following are suitable shared foundations and should not be reimplemented per platform:

- `useApi`, section loading, snapshot revision/invalidation, reconnect behavior, and action result handling.
- `viewData.js` models for execution, positions, strategy catalog, capabilities, events, reviews, financial truth, and per-symbol backtest coverage.
- Automation/runtime presentation and effective-vs-requested mode semantics.
- Authentication, permissions, API routes, risk and execution semantics, audit, reconciliation, and knowledge/strategy lifecycle logic.
- Chat decision presentation, current poster export, execution exit semantics, confirmation host, internationalization, and formatting helpers.

The following should be shared as presentation-neutral contracts, not as forced UI:

- Canonical workspace/route manifest.
- Feature-coverage and truth-boundary manifest.
- Workspace resource-state normalization.
- Object identity, provenance, permission, risk, consumer, and next-action view model.
- Registry filtering/sorting models, event calendar model, configuration catalog, and action outcome model.

## 2. Risk Register

| Priority | Gap | Current consequence | Required correction |
| --- | --- | --- | --- |
| Done | Canonical product route/ownership registry | Desktop and mobile previously hard-coded different navigation and section mappings | `productArchitecture.js` now resolves legacy and product routes to one workspace/view/resource contract |
| Done | Product ownership alignment | Reviews, business Events, and risk editors previously appeared under runtime ownership | Visible ownership now follows AI / Live / Lab / Control / Operations while preserving accepted server sections |
| Done | Workspace-level mobile navigation | Watch and Market previously consumed primary slots while Lab was buried | Bottom navigation is `AI | Live | Lab | Control | More`; features live inside their owning workspace |
| Done | Contractual feature coverage | New desktop actions could previously land without a mobile decision | `productCoverage.js` records ownership, desktop/mobile representation, permission, and migration state |
| Done | Single durable configuration home | Contextual state and authoritative editors were previously mixed | Control is read-only; durable mode, mandate, protection, rule, source, connection, and governance edits live in Configuration |
| P1 | AI Trader lacks the confirmed Command context model | Patrol, evidence, watch, risk, run, and next action compete inside message content or separate tabs | Preserve conversation; add Agent Status Band and contextual Command Rail; add Events as a local view |
| Done | Lab lifecycle and dual-origin assets | Knowledge-generated artifacts and built-in assets previously looked unrelated | Research Map separates incubation from native assets and reunifies validated outputs in source-aware registries |
| Done | Review and Owner ownership | Live execution facts and governed learning were mixed | Live shows review state; Lab owns full Review and native mobile Owner workflows |
| Done | Operations triage and recovery | Health, tasks, events, notifications, audit, and reconciliation were separate summaries with no shared priority model | Shared runtime facts now drive desktop and native mobile Command, Tasks & Runs, Recovery, Audit, and Inbox flows |
| P1 | Lower-frequency mobile Configuration remains mixed | Trading, risk, and event-source flows are native, while some infrastructure/admin panels still reuse desktop composition | Continue native screens by risk and usage priority; keep endpoints and permissions unchanged |
| P1 | Mobile route state is local and non-restorable | Back navigation and deep links lose workspace, subview, object, or filter context | Canonical location plus mobile navigation stack and persisted last location |
| P2 | Large configuration and editor panels are reused on mobile | Desktop form density, scroll nesting, and top-heavy actions remain | Convert to dedicated screens with grouped fields, sticky action areas, keyboard-safe layout, and explicit outcomes |
| P2 | Existing CSS carries multiple generations of mobile styles | Maintenance depends on late overrides in a very large global stylesheet | Introduce scoped product tokens and workspace primitives; migrate page styles incrementally and delete only proven orphans |
| Done | Global object/function switcher | The former desktop input did not provide an object/feature result model | `productShell.jsx` now indexes the canonical route registry and loaded production objects, supports keyboard/outside-close/empty states, and navigates only to existing routes |

## 3. Confirmed Product Ownership

| Object / workflow | Primary | Context | Govern | Health / proof |
| --- | --- | --- | --- | --- |
| Autonomous patrol result | AI Trader | Live position impact; Lab review citation | Control mode and mandate | Operations task/run |
| Intelligence and event content | AI Trader | Live execution windows; Lab citations | Control event-risk rules | Operations source health and raw event ledger |
| AI-message poster | AI Trader | — | Fixed deployed template/language/export boundary | Local export result |
| Closed-trade profit poster | Live Desk result | AI explanation | Notification configuration | Operations notification result |
| Trade plan | AI Trader | Live current plan | Control risk/mandate | Operations run/audit |
| Order, fill, position, protection | Live Desk | AI status explanation | Control hard risk | Operations reconciliation/recovery |
| Strategy and capability | Lab formal registries | AI runtime use; Live execution binding | Control grants/enabling boundary | Operations invocation/health |
| Trade review and Owner optimization | Lab Learning & Owner | Live review status and link | Owner/Control release authority | Operations audit/version proof |
| Durable settings | Configuration Registry | Read-only effective values everywhere else | Existing permission model | Operations change/audit proof |

## 4. Desktop → Mobile UX Mapping

| Product surface | Desktop representation | Mobile user goal and hierarchy | Mobile interaction model |
| --- | --- | --- | --- |
| Global shell | Fixed 64px Command, 188px Workspace, 304px Context, and 66px Trace rails; existing global actions | Know runtime/risk quickly; reach primary workspaces, Context, Trace, and safety with one thumb | 56px masthead; persistent 44px Context/Trace tools; numbered 66px `AI / Live / Lab / Control / More`; compact runtime button opens the existing Safety sheet |
| Global search | `CommandRail` object/feature overlay built from `ROUTE_DEFINITIONS` and loaded markets, positions, plans, tasks, mandates, incidents, executions, reviews, skills, and knowledge | Find the same objects through task-led workspace navigation without duplicating More destinations | Desktop supports ⌘/Ctrl-K, arrows, Enter, Escape, outside close, type/title/ID/status rows, empty results, and authoritative route navigation; no separate mobile search surface was introduced |
| AI Dialog | Conversation plus history and fixed Command Rail | See current conclusion, send a task, inspect evidence only when needed | Conversation root; status band collapses to a tappable summary; plan/evidence/trace open full-screen detail or sheets; composer remains keyboard-safe |
| Autonomous patrol | Message plus status/coverage/run context | Understand what was checked, what changed, whether action occurred, and what wakes next | Patrol message summary → detail screen with Changes, Decisions, Watches, Actions, Next Wake, Run Trace; poster action stays on message/detail |
| AI Intelligence | Dense evidence and source workbench | Read brief first, then facts and source health | Segmented Brief / Feed / Sources; event links open AI Events; source configuration and health deep-link to their authoritative homes |
| AI Watch | Thesis groups and conditions | See closest conditions, invalidation, and next check; cancel safely | Priority list sorted by proximity/risk; tap to detail; actions in bottom sheet; no hover-only explanation |
| AI Events | Calendar plus event detail and context links | See today/upcoming impact and what changes for current plans/watches | Agenda-first screen with optional month calendar; tap event to detail; configuration/risk/source actions deep-link rather than duplicate forms |
| Live Overview | High-density cockpit with account, market, risk, activity | Know whether the account and current exposure need action | Task-ordered dashboard: runtime truth → exposure/attention → primary actions → recent activity; drill into Market, Positions, Execution |
| Market | Chart, watchlist, account facts, research panels | Check one symbol and take the next safe action | Symbol picker sheet, readable chart, key facts, watch/add action; deeper market evidence in dedicated sections |
| Positions | Registry plus position/protection detail | Check risk and protection, then reduce/close when needed | Position list → full detail with plan, protection, PnL basis, audit links; bottom action bar for risk-reducing actions |
| Execution | Multi-panel workflow and status facts | Resolve in-flight execution, approval, or reconciliation issues | Attention inbox → execution detail timeline; one clear next action; confirmations as protected full-screen/sheet flow |
| Orders & Fills | Paired dense registries | Locate lifecycle facts without horizontal table scanning | Segmented Orders / Fills; compact rows; filter sheet; tap for immutable detail and related objects |
| Review status in Live | Summary and links to review pages | Know whether a closed trade has a review and open it | Review-status row on closed trade; deep-link into Lab review detail |
| Lab Research Map | Cross-registry map, queues, evidence inspector | Know where an asset came from and what needs attention | Lab home with Action Queue and lifecycle sections; each asset opens its appropriate registry/detail |
| Knowledge Incubator | Source ledger, evidence anatomy, routing, inspector | Import/check a source and move supported artifacts through real next gates | Source list → source detail; Evidence / Extracted / Candidates segments; bottom action sheet for parse/convert/validate actions |
| Strategy Registry | Source-aware registry and comparison workbench | Find a strategy, understand origin/evidence/status, run allowed lifecycle action | Filterable list with origin/status chips; strategy detail screen; Studio is a task flow, not a wide embedded panel |
| Strategy Studio | Prompt, compiled rules, tests, per-symbol OOS, publish | Create and verify one draft without losing context to the keyboard | Step flow: Describe → Review compiled contract → Generated tests → Per-symbol OOS → Publish; sticky next action and explicit blocked reasons |
| Capability Registry | Typed registry for native tools, workflows, imported skills, MCP/connectors | Know what is callable, methodological, connected, enabled, or degraded | Type-filtered list → type-specific detail; actions and permissions shown explicitly; unknown tools remain denied |
| Trade Review | Evidence workbench | Understand intent, execution, outcome, attribution, and resulting candidate | Review list → full-screen evidence detail; candidate creation/decision is an explicit final section, not an inline edit of strategy |
| Owner Optimization | Queue, authoritative evidence selector, staged validation | Decide one candidate and inspect proof | Owner queue → candidate detail → Backtest / Paper / Small Live / Decision timeline; protected release confirmation |
| Control Overview | Risk posture, effective mode, blockers, limits, rules/events | Know what is allowed now and why | Truth-first dashboard; top blocker and recovery; drill into mandate/rule/event details; edits open Configuration |
| Mode & Mandate | Current state plus durable editor | Inspect current authority or deliberately change it | Control shows read-only effective/target state; Configuration provides a guided form with impact review and protected confirmation |
| Rule Monitor | Rule registry and trigger facts | Inspect enabled rules and latest triggers | Rule list → detail/trigger history; edit deep-links to Configuration; system-managed rules read-only |
| Operations Overview | Service health, attention queue, input health, and operational evidence | Resolve degraded service or failed run | Health field → priority queue → authoritative domain or recovery detail; stale last-valid values remain visible |
| Tasks | Dense table, scheduler panels, task forms | Run, pause/resume, or create a permitted user task | System and User segments; task detail timeline; system-managed schedule read-only; user-task create/edit as dedicated form |
| Event Inputs | Source/ledger/brief health | Diagnose missing or stale event evidence | Source-health list → detail and recent runs; configuration opens Event Sources in Configuration; business calendar opens AI Events |
| Notifications | Notification registry | Triage unread action items | Inbox grouped by severity/domain; swipe is optional convenience only; tap opens related object; mark-read outcome is explicit |
| Audit / Reconcile / Recovery | Dense immutable tables and trace panels | Prove what happened or recover unknown state | Search/filter screen → immutable detail/timeline; reconciliation and recovery actions use protected task flows |
| Configuration Registry | Domain index and desktop forms | Find the single editor, understand scope, complete one configuration task | Configuration home → domain → dedicated screen; grouped fields, correct input modes, sticky Save, server-confirmed outcome, keyboard/safe-area handling |

## 5. Mobile UX Architecture

### Navigation

- Primary bottom navigation: `AI | Live | Lab | Control | More`.
- More contains Operations, Configuration, Notifications, account/profile, language, and support-level utilities.
- Each workspace has a local view switcher. Two to four peer views use a segmented control; larger sets use a workspace index or horizontally scrollable local navigation with clear labels.
- Object details are routes/screens with preserved IDs. Temporary comparisons, filters, and low-complexity actions use bottom sheets. Long forms and protected decisions use full-screen flows.
- Hardware/system back follows the mobile stack. Returning from detail preserves list scroll, filter, selection, and draft state.

### Global Mobile Shell

- Safe-area-aware hard-edged top app bar and 66px numbered bottom navigation.
- Compact runtime control opens a Safety sheet with effective state, saved target, blockers, Flatten, and Kill.
- Persistent 44px Context and Trace controls open full-width bounded sheets; unknown fields remain `Unavailable` and trace stages remain `complete`, `waiting`, `blocked`, or `unavailable`.
- First-class offline/reconnecting banner preserves last valid content.
- No core action relies on hover, tooltip, tiny icon-only hit areas, or right click.
- Primary actions are placed in the thumb zone when repeated or task-critical; destructive and authority-changing actions remain separated and confirmed.

### Mobile Component Patterns

- Dense tables → summary rows plus object detail; horizontal scroll only for genuine multi-column comparison.
- Desktop inspector/command rail → detail screen or bottom sheet with the same fields.
- Filters → filter button and apply/reset sheet.
- Multi-panel workbench → task-led overview, drill-down list, detail, action.
- Long forms → domain-specific full-screen flow with grouped fields, correct keyboard type, validation, unsaved-change handling, and sticky submit where safe.
- Loading, empty, error, stale, degraded, forbidden, success, and failure receive distinct components and copy.

## 6. Sharing Boundary

### Share

- API hooks, snapshot store, permissions, route semantics, view models, action contracts, formatters, confirmation semantics, i18n, and safety state.
- Small semantic primitives: status text, resource-state boundary, evidence/provenance rows, money/price cells, object links, and action outcomes.
- Feature logic with presentation adapters: event model, execution lifecycle model, research asset model, configuration catalog, search index.
- Shell projections in `productShell.jsx`: loaded-object search index, Context view model, and current-workspace Trace stages. Desktop consumes them as fixed rails; mobile consumes them as bounded sheets.

### Do Not Force-Share

- Desktop App Shell and mobile navigation shell.
- Desktop tables/registries and mobile list/detail screens.
- Desktop Command Rail/Inspector and mobile full-screen/sheet details.
- Desktop multi-column workbenches and mobile step flows.
- Desktop form composition and mobile keyboard-safe forms.
- Desktop hover/tooltip behavior and mobile explicit disclosures.

## 7. Phased Implementation

Implementation status (2026-08-24): phases 1–6 are implemented. The shared route registry and coverage contract drive the five-workspace desktop/mobile shells; AI Trader retains the deployed conversation while gaining status, patrol, evidence, and fixed poster presentation; Lab has a dual-origin Research Map, source-aware formal registries, Trade Review, and native mobile Owner validation. Control now presents effective runtime truth, blockers, exposure, event gates, mandate boundaries, readiness, and rule hits without durable editors. Configuration Registry is the single editing home for operating target, Mandate, automatic protections, deterministic rules, event sources, infrastructure, connections, models, Agents, users, and subscriptions. Operations now uses one shared fact model for service health, tasks/runs, event-input health, notification triage, audit proof, reconciliation, and recovery on desktop and mobile. Lower-frequency infrastructure/admin conversion continues in phase 8. Existing endpoints, permissions, evidence gates, safety semantics, and authentication remain unchanged.

1. Foundation & coverage: product/route registry, feature manifest, truth boundaries, compatible deep links, shared resource states, scoped tokens.
2. Shell alignment: desktop five-workspace rail plus Configuration; mobile `AI / Live / Lab / Control / More`; preserve every legacy entry.
3. AI Trader: deployed conversation + Status Band + Command Rail; local Dialog/Intelligence/Watch/Events; patrol and poster presentation.
4. Lab: Research Map, source-aware incubation, formal Strategy/Capability registries, Review and Owner migration.
5. Control & Configuration: separate status/governance from the single durable editor; migrate current editors without changing endpoints.
6. Operations: runtime, tasks, event inputs, notifications, audit, reconciliation, recovery.
7. Live integration: retain approved Live Desk layout, add review deep links and cross-workspace object context.
8. Mobile-native page pass: replace shared desktop panels with dedicated screens by risk/usage priority.
9. QA and cutover: route/permission/function parity, small/normal/large phones, landscape where useful, iOS/Android safe areas, keyboard, long/empty/loading/error/offline states, 1024/1440 desktop, safety regression.

## 8. Acceptance Rules

- Every deployed feature appears exactly once in the coverage contract and remains reachable for the correct role on both platforms.
- Every legacy route resolves safely and preserves object IDs and subview intent.
- No workspace requests an unknown backend section.
- No context surface creates a second durable editor.
- Mobile authentication remains byte-for-byte behaviorally unchanged.
- Desktop uses large-screen density; mobile uses touch-first task flow. Capability, data semantics, permissions, and action effects remain identical.
- Build, lint, focused render/parity tests, workspace navigation tests, and safety-action tests must pass before each migration is considered complete.
