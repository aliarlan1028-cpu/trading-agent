# KORDYN Concept-Faithful Product Rebuild Design

**Status:** Proposed architecture for user review

**Date:** 2026-08-26

**Scope:** Authenticated Desktop and APP product surfaces

**Production implementation:** Not started by this document

## 1. Objective

Rebuild the authenticated KORDYN frontend around the approved concept set while preserving all deployed product capabilities and server-authoritative behavior.

The result is one product expressed through two device-specific compositions:

- Desktop: high-density AI trading workbenches.
- APP: touch-first mission, account, asset, and governance flows.

The implementation must reproduce the approved concepts as spatial contracts. It must not reinterpret them as a generic dark dashboard, retain the discarded interface through CSS overrides, or replace real behavior with visual demonstrations.

## 2. Decision and supersession

This specification replaces the following authenticated-product decisions:

- the `Today` page family;
- the five-root APP model `Today / AI / Assets / Intelligent / More`;
- the ten user-facing page families in the current `PRODUCT.md`;
- the Paper / Ink / Acid authenticated visual system;
- the authenticated visual and information-architecture portions of `docs/superpowers/specs/2026-08-25-kordyn-zero-base-web3-product-system-design.md`.

This specification does **not** replace:

- API contracts;
- object identities;
- data loaders and freshness semantics;
- permissions and role authority;
- risk and execution controls;
- audit, reconciliation, recovery, and notification behavior;
- server-authoritative success and failure results;
- the 66 capabilities currently registered by `src/productCoverage.js`.

Public marketing and authentication surfaces are not represented in the approved concept set. They remain unchanged until separately approved concepts exist. The new authenticated design must not be improvised onto those surfaces.

## 3. Sources of truth

When sources disagree, use this order:

1. Production code and `src/productCoverage.js` define real capabilities, objects, actions, permissions, state, and safety boundaries.
2. `docs/kordyn-v2-capability-migration-matrix.md` defines where each of the 66 capabilities belongs in the new information architecture.
3. The 15 files in `.impeccable/mocks/kordyn-v2-approved/`, identified by `docs/kordyn-v2-approved-concept-manifest.md`, define authenticated layout, hierarchy, density, navigation, visual language, and device composition.
4. Accessibility and responsive requirements govern adaptations not visible in a concept image.
5. The deployed UI is compatibility evidence only. It has no visual authority over this rebuild.

Generated spelling mistakes, impossible values, or unsupported actions in a concept raster are defects, not product requirements. Correct them without recomposing the surrounding layout.

## 4. Product model

### 4.1 Four global domains

Authenticated Desktop and APP expose exactly four global domains:

1. `AI 交易员`
2. `账户交易`
3. `智能资产`
4. `系统治理`

There is no authenticated `今日`, `更多`, Smart Forms, or DAO Governance destination.

### 4.2 Desktop local navigation

- AI 交易员: `任务 / 情报 / 观察哨 / 事件日历 / 对话`
- 账户交易: `市场 / 账户 / 持仓 / 计划 / 订单 / 成交`
- 智能资产: `关系总览 / 策略库 / 知识库 / 能力库 / 复盘与发布`
- 系统治理: `运行总览 / 任务与运行 / 事件输入 / 通知 / 审计 / 恢复 / 配置`

Local navigation changes the workspace inside the selected domain. It does not create a second competing global hierarchy.

### 4.3 APP navigation

The APP bottom bar uses the same four domains and their full labels. It is not a compressed desktop rail and it has no catch-all `更多` destination.

Each domain opens a touch-first index or current-work screen. Deeper capabilities remain available through domain-local lists, drill-down routes, sheets, and full-screen flows. The same object identifier must survive list selection, detail view, approval, result, and return navigation.

### 4.4 Primary product loop

`AI 交易员识别任务与机会 → 用户理解或确认 → 账户交易执行并形成事实 → 智能资产沉淀策略、能力、知识与复盘 → 系统治理约束、证明并恢复整个循环`

AI 交易员 is the main operating console. Account truth, current strategies, relevant capabilities, knowledge evidence, risk, and approvals are contextual inputs to the mission rather than unrelated dashboards.

## 5. Workspace responsibilities

### 5.1 AI 交易员

AI 交易员 owns mission-oriented operation:

- mission queue and current mission;
- autonomous patrol and product-language progress;
- intelligence and evidence;
- watches;
- business event calendar;
- conversation;
- approval requests;
- current supported poster/output draft and export.

Technical stages such as `Sense`, `Recall`, and `Guard` appear only in proof, trace, or advanced disclosure. Primary UI uses language such as “正在检查市场”, “找到 3 条证据”, and “需要你确认”.

### 5.2 账户交易

账户交易 owns market and execution truth:

- market;
- account health and reconciliation;
- positions and protection;
- plans and execution lifecycle;
- orders;
- fills;
- closed-trade review entry and supported output result.

Candidate signals, plans, authorizations, orders, fills, and positions remain separate objects. The UI must never collapse them into one optimistic “trade” state.

### 5.3 智能资产

智能资产 makes the research asset model explicit:

- `关系总览` shows how mission, strategy, capability, knowledge, validation, and review connect.
- `策略库` contains system-native, imported/adapted, and knowledge-derived strategies with distinct provenance.
- `知识库` imports sources, exposes evidence and graphs, and incubates only the artifact types supported by production.
- `能力库` contains native tools, approved workflows, imported skills, MCP grants, and connectors with their real health and permission boundaries.
- `复盘与发布` owns trade review, Owner optimization candidates, validation decisions, release, and supported poster drafts.

Knowledge ingestion does not imply arbitrary executable-code generation. A knowledge-derived strategy or workflow reaches a registry only through the deployed validation and Owner-governed lifecycle.

### 5.4 系统治理

系统治理 owns operational truth and durable configuration:

- current runtime and risk posture;
- effective mode, mandate, permission, and deterministic rules;
- tasks and runs;
- event-input health and event risk;
- notifications;
- immutable audit;
- reconciliation and recovery;
- all durable configuration editors.

Runtime truth and configuration intent remain distinct. Operational workspaces show current/effective state and link to the authoritative editor. Configuration shows selected and effective values separately.

## 6. Global shell and shared interaction

### 6.1 Desktop shell

The approved Desktop concepts bind the shell topology:

- global four-domain navigation;
- domain-local navigation;
- persistent product identity and current environment;
- a contextual Account Truth region whose weight changes by workspace;
- a primary work canvas with the proportions shown in the relevant concept;
- bounded inspectors, drawers, and confirmations that inherit the same dark Web3 material language.

### 6.2 APP shell

The approved APP concepts bind:

- concise top identity and current-scope truth;
- domain-specific body composition;
- a four-item bottom navigation;
- sheets or full-screen flows for context, proof, approval, and configuration;
- no desktop-table shrinkage or card-wall fallback.

### 6.3 Account Truth modes

Account truth has one data model and three display weights:

- **Full Truth Bar:** AI 交易员 and 账户交易. Shows account, availability, exposure, freshness, mode, and critical risk context.
- **Compact Truth Bar:** 智能资产. Shows only the account/risk context needed to judge a strategy, capability, source, or review.
- **Critical-only:** 系统治理 and configuration. Shows only state that changes the safety or meaning of the current governance task.

These modes preserve shell alignment but do not reserve identical vertical height on every workspace.

### 6.4 Floating AI 客服

The floating AI 客服 is separate from AI 交易员 missions.

It may:

- explain the current page, object, state, or error;
- diagnose likely causes from facts already visible to the user;
- navigate to a relevant production surface;
- disclose which permission or source is missing.

It may not:

- place, cancel, adjust, or close a trade;
- modify risk, mandate, permission, model, key, connector, or other configuration;
- approve a mission or protected action;
- claim access to facts the user cannot access.

Desktop uses the approved floating control and bounded panel. APP uses the approved governed sheet. Both are read-only and must label that boundary.

## 7. Visual authority and fidelity contract

### 7.1 Approved world

The concept set defines a dark professional Web3 operations world:

- deep midnight/navy and graphite surfaces;
- cobalt blue for primary system/AI emphasis;
- mint for healthy, verified, or constructive state;
- violet for intelligent-asset and relationship emphasis;
- restrained amber and coral for attention and danger;
- crisp layered surfaces, controlled luminous edges, and information-bearing network or orbital motifs;
- strong readable typography, tabular numeric treatment, and high-density layouts that remain calm.

This is not permission to produce generic neon glass cards. Color, glow, and topology must carry identity, state, or relationship.

### 7.2 What 1:1 means

At a concept’s target viewport, the following are binding:

- layout topology and reading order;
- region proportions and dominant alignments;
- navigation placement and selected-state treatment;
- density and visible information hierarchy;
- typography scale relationships;
- surface, border, elevation, glow, and background language;
- chart, registry, inspector, sheet, and approval composition;
- the visual relationship between AI, account truth, evidence, action, and risk.

Allowed implementation differences are limited to:

- the closest legally and technically available font;
- exact icon substitutions when the raster icon is not an existing product asset;
- correction of raster-generation mistakes;
- real production data, copy, permissions, and state;
- responsive and accessibility adaptations that preserve the concept’s hierarchy.

Difficulty, existing component availability, or schedule pressure does not downgrade concept authority.

### 7.3 Viewport evidence

Required visual comparison sizes:

- Desktop `1440x900`;
- Desktop `1180x800`;
- APP `390x844`;
- APP `430x932`.

Stored concept rasters are normalized to these exact viewports before comparison. Each major region is reviewed side by side and with an aligned overlay. Full-page thumbnails alone are insufficient.

## 8. Frontend architecture

### 8.1 Chosen approach

Build a new isolated authenticated presentation layer that consumes production view models and actions through explicit adapters.

Rejected approaches:

- continuing to patch the current zero-base components and append CSS overrides;
- creating a second standalone application that duplicates loaders, permissions, or business logic.

### 8.2 Proposed module boundary

The implementation plan should use a dedicated root such as:

```text
src/kordynV2/
  architecture/
    domains.js
    routes.js
    compatibilityRoutes.js
  shell/
    DesktopShell.jsx
    MobileShell.jsx
    AccountTruth.jsx
    AiSupport.jsx
  viewModels/
    ai.js
    account.js
    assets.js
    governance.js
  domains/
    ai/
    account/
    assets/
    governance/
  styles/
    tokens.css
    shell.css
    ai.css
    account.css
    assets.css
    governance.css
```

Names may change only for repository convention; the isolation boundary may not.

### 8.3 Adapter rule

Adapters convert existing production-shaped data into device-neutral view models. They may:

- normalize nullable fields without converting unknown to zero;
- attach canonical object identity;
- expose freshness, last-valid, permission, and action availability;
- group data for the new workspace;
- map new routes to current compatible server sections.

Adapters may not:

- invent data or successful outcomes;
- call protected actions without the existing preflight and confirmation path;
- weaken server permissions;
- merge distinct domain objects;
- change backend contracts as a side effect of UI work.

Desktop and APP presentations consume the same view model, action definition, permission result, object identity, and state semantics. They do not share a forced DOM layout.

### 8.4 Routing and cutover

- The new four-domain routes become the user-facing authenticated routes.
- Existing route and section names remain compatibility adapters until all links, deep links, notifications, and recovery routes are verified.
- A temporary authenticated-shell switch selects old or new presentation without changing backend behavior.
- The switch is the rollback boundary during migration; it is removed only after final parity and rollback approval.
- `main.jsx` remains an entry/cutover boundary, not a container for domain page logic.

### 8.5 Styling isolation

- New authenticated styles are imported only by `src/kordynV2/` entry points.
- New classes and tokens do not depend on legacy selectors or cascade order.
- No `!important` is used to defeat old CSS.
- The new path does not load old authenticated `productStyles` after cutover.
- Marketing and authentication CSS remain separate and unchanged in this scope.

## 9. Real state and action contract

Every major workspace must demonstrate and test:

- Loading;
- Empty;
- Processing;
- Stale;
- Degraded;
- Failed;
- Forbidden;
- Disabled;
- Approval required;
- Partial success;
- No result;
- Long content;
- Large list.

State rules:

- Loading, empty, failed, forbidden, stale, and degraded are visually and semantically distinct.
- Stale and degraded retain the last valid value, source, timestamp, and recovery explanation where production provides them.
- Missing values display `Unavailable` or the localized equivalent, never `0`.
- Dangerous or protected actions use the existing confirmation, focus, keyboard, touch, retry, disabled, typed-confirmation, and authoritative-result behavior.
- No order, mode change, mandate change, rule change, Flatten, Kill, publish, or configuration action claims optimistic success.
- Kill Switch behavior continues to allow only the deployed risk-reducing and recovery actions while blocking new risk.

## 10. Accessibility and responsive contract

- Body copy remains legible at production zoom and localized lengths.
- Every interactive element has visible keyboard focus.
- Dialogs and sheets trap focus, close with supported keyboard semantics, and return focus to their trigger.
- Mobile touch targets are at least `44x44` CSS pixels.
- Status never relies on color alone.
- Motion respects `prefers-reduced-motion` while preserving necessary state feedback.
- Desktop at `1180` and APP at `390` and `430` have no document-level horizontal overflow.
- Long IDs, prices, timestamps, source names, translated copy, and large lists cannot break shell geometry.
- APP safe areas and the bottom navigation cannot cover content or protected actions.

## 11. Performance architecture

The current production build keeps public-entry assets within their existing budgets but produces an authenticated CSS asset of approximately `824 KiB` on the inspected build. Repeated deployment is not the reason a browser becomes slow; loading, parsing, layout, runtime work, data latency, and service availability are. The rebuild must remove the dual-style cost from the new authenticated path.

Required budgets:

- preserve public initial CSS below `40 KiB`;
- preserve public initial JavaScript below `450 KiB`;
- load the authenticated shell only after authentication;
- target the default AI 交易员 route at less than `180 KiB` minified CSS including shell;
- target each non-active domain CSS chunk below `120 KiB` minified;
- lazy-load inactive domains and heavy visualizations;
- never emit one catch-all authenticated stylesheet containing both old and new visual systems;
- measure route-level JavaScript, CSS, interaction readiness, long tasks, and real data latency before cutover.

Performance budgets are release gates. They are not promises that can be waived because screenshots match.

## 12. Migration sequence

### Phase 0 — Freeze contracts and gates

- approve this specification;
- freeze the 15-image manifest and 66-row capability matrix;
- define route, feature-switch, visual-diff, performance, and rollback gates;
- update durable product documentation only after approval.

### Phase 1 — Isolated architecture and shared shell

- create `src/kordynV2/` boundary;
- add canonical four-domain registry and compatibility mapping;
- create shared view-model and action interfaces;
- reproduce Desktop and APP shells, Account Truth modes, and read-only AI 客服;
- keep the old shell as the default until shell gates pass.

### Phase 2 — AI 交易员

- reproduce mission control and signal concepts first;
- connect real dialog, patrol, intelligence, watch, events, approval, and output actions;
- validate AI product-language progress and technical proof disclosure;
- make the new AI domain the feature-switch landing surface only after its real-state gates pass.

### Phase 3 — 账户交易

- implement market, account, position, plan, order, and fill workspaces;
- preserve canonical identity and authoritative trade actions;
- validate freshness, protection, reconciliation, review, and output flows.

### Phase 4 — 智能资产

- implement relationship overview, strategy registry/studio, knowledge incubator, capability registry, and review/release;
- prove provenance and lifecycle connections across native, imported, and knowledge-derived assets;
- prevent unsupported executable-generation claims.

### Phase 5 — 系统治理

- implement current boundary, operations, event input, notifications, audit, recovery, and configuration;
- preserve selected versus effective values and protected actions;
- prove last-valid, degraded, permission, audit, and recovery behavior.

### Phase 6 — APP parity

APP work proceeds alongside Phases 1–5, not after Desktop is complete. This phase closes remaining parity gaps across the four canonical domains and confirms touch-first interaction at both approved widths.

### Phase 7 — Hardening and visual convergence

- complete all non-happy states;
- run accessibility, keyboard, touch, overflow, localization, and performance gates;
- capture side-by-side and overlay evidence against every approved concept;
- correct material differences in bounded review passes.

### Phase 8 — Cutover and cleanup

- switch authenticated production traffic only after capability, behavior, visual, performance, and rollback gates pass;
- observe production telemetry;
- remove retired authenticated components and CSS only in a separately reviewed cleanup step;
- retain no duplicate visual system in the shipping authenticated path.

## 13. Rollback and deployment safety

- No backend or database migration is required for this frontend rebuild.
- The old authenticated shell remains available behind the migration switch until final acceptance.
- Each domain can be disabled independently during staged validation.
- A rollback restores presentation routing only; production tasks and server state continue unchanged.
- Deployment must not expose prototype fixtures, concept rasters, secrets, or test-only actions.

## 14. Verification gates

Completion requires all of the following:

1. The migration matrix still contains exactly 66 code-verified capabilities.
2. Every capability has a real Desktop and APP route or flow.
3. Global navigation contains exactly the four approved domains and no retired destination.
4. Page-local selection, global context, proof/trace, and action identity agree for representative objects in every domain.
5. Permissions and protected actions fail closed.
6. All required real product states render with correct semantics.
7. Desktop `1440x900` and `1180x800`, plus APP `390x844` and `430x932`, pass overflow and interaction checks.
8. Every approved concept has valid side-by-side and overlay evidence at its target size.
9. Visual review treats the approved concept as the spatial authority and reports material differences explicitly.
10. Keyboard, focus, screen-reader naming, contrast, touch targets, and reduced motion pass.
11. Focused tests, full tests, lint, production build, browser interaction runners, performance budgets, and `git diff --check` pass freshly.
12. The shipping authenticated route does not load legacy and new authenticated CSS together.
13. The production workspaces use real loaders, permissions, actions, and authoritative outcomes; no prototype-local success path is shipped.
14. Rollback is exercised before full cutover.

## 15. Required implementation evidence

- a capability-to-route and capability-to-component report derived from the final code;
- reference/build region comparisons for all 15 approved concepts;
- screenshots for the four required viewports;
- drawers, sheets, AI 客服, confirmations, and danger flows;
- normal and all required non-happy states;
- canonical selection and object identity traces across domains;
- accessibility, keyboard, touch, overflow, localization, and reduced-motion results;
- route-level CSS/JavaScript and interaction-readiness measurements;
- production-build hashes, commands, exit codes, and clean-worktree status;
- an explicit list of any remaining difference. An unapproved material difference blocks cutover.

## 16. Approval boundary

Approval of this document authorizes writing a detailed Implementation Plan. It does not by itself authorize production frontend implementation, deployment, removal of legacy code, or modification of public marketing/authentication surfaces.
