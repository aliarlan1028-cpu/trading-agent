# Task 6 report — desktop Positions risk workbench

Date: 2026-09-04
Base commit: `337c5a7`
Scope: Task 6 only
Status: complete

## Outcome

The desktop Positions route now uses a dedicated `PositionsPage` that consumes the existing `buildPositionPresentation`, shared cockpit visuals, account snapshots, `executionExitAction`, and `requestExecutionExit`. Its visual hierarchy follows the supplied Positions authority: a full-width account hero, account-constraint strip, 24/52/24 analytics/core/risk workbench, dense current-position table with protection subrows, portfolio trend, and compact risk evidence.

The page exposes every required region:

- `position-hero`
- `account-constraints`
- `position-allocation`
- `long-short`
- `pnl-distribution`
- `position-table`
- `portfolio-pnl-trend`
- `risk-health`
- `margin-safety`
- `concentration`

No backend, API, authentication, mobile, trading engine, presentation-model, or unrelated production file was changed.

## Identity, protection, and action contracts

- Rendering requires a real canonical position identity. Identity-less, non-object, and malformed rows cannot reach the table or action boundary.
- Protection stays sourced from `buildPositionPresentation`; the page does not manufacture stop-loss or take-profit levels.
- The production-shaped fixture includes a true `positionId`-only BTC row whose identity is `ord-04`. It joins the exact execution whose `positionId` is `ord-04` (`ord-00`) and its plan protection, while an unrelated execution also has `id: ord-04`. This deliberately proves the page does not cross identity namespaces.
- The BTC row renders stop `110,834.53` and target `116,547.65`; unrelated `13.37` and `14.88` protection never appears.
- Action resolution is stricter than presentation: an explicit `executionOrderId` must uniquely match an execution id, otherwise the canonical position id must uniquely match an execution `positionId`. Symbol matching and generic cross-field id matching are forbidden. Missing or ambiguous links fail closed.
- The only enabled fixture action is the real ETH execution `ord-01` in `protecting` status. It is admitted by the existing `executionExitAction` helper and passed unchanged to `requestExecutionExit(action, execution, "manual_ui")`.
- The mounted browser clicks the production control, verifies focus visibility, verifies the ordinary `ConfirmHost` dialog identifies `ETH/USDT`, confirms no request occurred before consent, confirms focus moved into the dialog, then accepts. The exact recorded request is `/api/execution-orders/ord-01/close` with `{ reason: "manual_ui", intent: "close_position", expectedStatus: "protecting" }`. The harness records the request locally; no external write occurs.

## Honest financial and resource semantics

- Missing financial values render as `不可用` / `Unavailable`; missing protection renders as `未登记` / `Not registered`.
- Aggregate notional, PnL, and margin are available only when every rendered row supplies the relevant fact. Missing members do not become zero.
- Allocation and long/short composition use only real positive notional values. A long/short ratio is unavailable when either side is absent.
- Portfolio trend requires at least two finite, timestamped account-equity snapshots sorted chronologically.
- Loaded empty and malformed fixtures render zero position rows and zero exits, with a compact 168px table empty state rather than a fixed vacant table. They show no fake position or numeric portfolio fact.
- `loading` with last-valid facts, `stale`, and `degraded` retain all ten regions while suppressing exits.
- `not_loaded`, initial loading without facts, `error`, `failed`, `forbidden`, and `disabled` block the facts body and cannot expose an exit.

## TDD record

### RED

Task assertions and production-shaped browser evidence were added before the page implementation.

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-reference.test.mjs tests/trading-cockpit-model.test.mjs
FAIL: 61 passed, 5 failed (66 total)
```

The expected failures covered the missing dedicated module/regions, exact position-only protection rendering, unavailable missing values, empty/malformed fail-closed behavior, and resource-state boundaries.

```text
KORDYN_COCKPIT_VIEWS=positions node tests/run-trading-cockpit-browser.mjs
FAIL: production position exit control was absent
```

Two browser-led visual/accessibility defects also received explicit regression assertions before their fixes:

```text
KORDYN_COCKPIT_VIEWS=positions KORDYN_COCKPIT_STATE=stale node tests/run-trading-cockpit-browser.mjs
FAIL: stale reload target measured 32px, below the 36px floor

KORDYN_COCKPIT_VIEWS=positions node tests/run-trading-cockpit-browser.mjs
FAIL: portfolio trend occupied 0.0395 of its panel width
```

The latter exposed a real selector-specificity interaction with the shared SVG rule. A scoped width rule now makes the position hero and portfolio trend occupy their intended panels.

### GREEN

Fresh focused verification:

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-model.test.mjs tests/trading-cockpit-reference.test.mjs tests/aug15-review-deep-link.test.mjs
PASS: 70/70
```

Loaded Positions interaction and geometry:

```text
KORDYN_COCKPIT_VIEWS=positions node tests/run-trading-cockpit-browser.mjs
PASS at 1440x1080, 1280x960, and 1024x768
```

Observed: zero document overflow at all three viewports; all ten regions present; one valid exit; minimum enabled control 36px; visible focus; exact confirmation/request evidence; position-only protection correct; wrong-row protection absent. The 1440 workbench measured `24.00 / 52.00 / 24.00`. Portfolio-trend width ratios were `0.9972`, `0.9969`, and `0.9975`.

Empty and malformed boundaries:

```text
KORDYN_COCKPIT_VIEWS=positions KORDYN_COCKPIT_EMPTY=1 node tests/run-trading-cockpit-browser.mjs
KORDYN_COCKPIT_VIEWS=positions KORDYN_COCKPIT_POSITION_CASE=malformed node tests/run-trading-cockpit-browser.mjs
PASS: both commands at all three viewports
```

Resource-state matrix:

```text
KORDYN_COCKPIT_VIEWS=positions KORDYN_COCKPIT_STATE=<loading|stale|degraded|error|failed|forbidden|disabled> node tests/run-trading-cockpit-browser.mjs
PASS: every state at all three viewports
```

Loading/stale/degraded retained the ten-region last-valid workspace with zero exits. Error/failed/forbidden/disabled rendered blocking boundaries with zero regions, rows, or exits. Every rendered retry control measured 36px.

## Visual inspection

The supplied authority was inspected at original resolution before implementation:

`交易驾驶舱参考图/ChatGPT Image 2026年9月3日 15_35_57 (3).png`

Final captures:

- `.impeccable/review/task-6-round-1/positions-1440x1080.png`
- `.impeccable/review/task-6-round-1/positions-1280x960.png`
- `.impeccable/review/task-6-round-1/positions-1024x768.png`

All three final captures were inspected at original resolution. The 1440 capture preserves the authority's dominant hero, constraint rail, 24/52/24 workbench, allocation/long-short/PnL analysis, centered position evidence, and right risk column. The 1280 view retains the same hierarchy with a contained table scroller. The 1024 view promotes the position table beside allocation and places secondary risk content below the initial viewport; it has intentional vertical continuation and no document-level horizontal overflow. Capture mode resets the table scroller after exercising the right-edge exit action so visual evidence begins at the canonical identity columns.

Material visual fixes from inspection were batched: action-induced capture scroll, table fit, gauge caption crowding, 36px state controls, and full-width SVG trends.

## Regression and quality gates

Full five-view desktop cockpit browser regression:

```text
node tests/run-trading-cockpit-browser.mjs
PASS: overview, market, positions, execution, and ledger at all three viewports
```

Full isolated suite:

```text
npm test
PASS: 2,326 tests, 0 failures, 16.793s
```

Repository lint and production build:

```text
npm run lint
PASS

npm run build
PASS: 1,822 modules transformed; build completed in 1.58s
```

Impeccable mechanical detector, run exactly once on the changed Task 6 UI targets:

```text
node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/aug15/tradingCockpit/PositionsPage.jsx src/aug15/tradingCockpit.css
[]
```

The detector was not rerun after its clean result. The later browser-discovered SVG-width specificity correction was limited to two scoped `width: 100%` declarations and was instead revalidated by the explicit mounted width-ratio assertion, lint, build, full browser gate, and full test suite.

Whitespace and patch integrity:

```text
git diff --check
PASS (no output)
```

## Files changed

- `src/aug15/tradingCockpit/PositionsPage.jsx` — dedicated identity-safe Positions page.
- `src/aug15/tradingCockpit.jsx` — routes Positions to the dedicated component and removes the obsolete inline page.
- `src/aug15/tradingCockpit.css` — reference-led Positions composition, density, states, controls, and responsive behavior.
- `tests/trading-cockpit-reference.test.mjs` — source, SSR, identity, missing-data, malformed, empty, and state contracts.
- `tests/run-trading-cockpit-browser.mjs` — mounted action/confirmation, protection isolation, state, geometry, focus, control-size, trend-width, compact-empty, and viewport assertions.
- `tests/trading-cockpit-browser.jsx` — production-shaped collision/malformed fixtures plus the mounted ordinary confirmation host.
- `.superpowers/sdd/2026-09-03-trading-cockpit-reference-redesign/task-6-report.md` — this evidence report.

## Concerns and intentional tradeoffs

- Dense table content uses a contained horizontal scroller when a narrower center rail cannot display every real field at once. The document itself never scrolls horizontally, and 1440 fits the complete canonical table.
- At 1024x768, secondary risk panels continue below the first viewport. The hero, constraints, allocation, and current-position table remain immediately available; vertical continuation is intentional desktop adaptation.
- Browser data is the repository's explicitly marked production-shaped synthetic fixture. It exercises production components, action policy, modal behavior, and request construction without credentials or external writes.
- The repository was already intentionally dirty. Only the authorized Task 6 source/test/report files are staged and committed; unrelated modified and untracked work remains untouched.

## Fix Round 1 — collision-safe joins, canonical exits, and partial composition

Date: 2026-09-04
Base commit: `31efa28`

### Findings closed

1. `buildPositionPresentation` no longer uses a first-match `explicit id OR positionId` selector. A nonblank `executionOrderId` now matches only canonical `executionOrder.id`, requires exactly one match, and never falls through to `positionId`. Only a position without a nonblank explicit execution id may use the `positionId` fallback, which also requires exactly one order.
2. Plan resolution now uses only a nonblank plan identity from the uniquely resolved order or position, and requires exactly one canonical plan-id match. Duplicate plans and blank plan identities provide no joined protection.
3. `uniqueExecutionFor` now authorizes an exit only when exactly one execution matches and that object has a nonblank canonical `.id`. `orderId` and `executionOrderId` aliases cannot become an endpoint identity or produce `/undefined/close`.
4. Allocation completeness, directional-composition completeness, and a genuinely flat account are now distinct. Missing or non-positive notional makes allocation explicitly incomplete. Any missing positive notional or valid direction makes long/short and concentration explicitly incomplete, with no computed 100% remainder. Zero positions retain explicit flat copy.

The authorized shared-model correction was limited to `src/aug15/tradingCockpit/model.js`; no backend, API, trading engine, authentication, mobile, or unrelated file changed. The requested 1024 hero clipping Minor remains deferred to Task 9.

### RED evidence

The adversarial tests were written and run before production changes.

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-model.test.mjs
FAIL: 29 passed, 4 failed (33 total)
```

Observed wrong results: an explicit-id miss borrowed fallback protection `13.37`; duplicate explicit executions selected stop `91`; duplicate position-linked executions selected stop `91`; duplicate plan ids selected stop `91`. The correct unique position fallback already passed.

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-reference.test.mjs
FAIL: 38 passed, 2 failed (40 total)
```

Observed wrong results: alias-only execution objects produced two exits, and partial allocation used the generic calculable/empty state while the known long row was presented as a complete 100% remainder.

```text
KORDYN_COCKPIT_VIEWS=positions KORDYN_COCKPIT_POSITION_CASE=malformed node tests/run-trading-cockpit-browser.mjs
FAIL: malformed/ambiguous execution fixture exposed 2 exits

KORDYN_COCKPIT_VIEWS=positions KORDYN_COCKPIT_POSITION_CASE=partial node tests/run-trading-cockpit-browser.mjs
FAIL: partial allocation was not explicitly incomplete
```

### GREEN evidence

Model selector unit coverage:

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-model.test.mjs
PASS: 33/33
```

The cases cover an explicit miss that previously fell through, duplicate explicit order ids, duplicate position-linked executions, duplicate plan ids, blank ids, and a correct unique position/plan fallback.

Focused model, SSR, and routing regression:

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-model.test.mjs tests/trading-cockpit-reference.test.mjs tests/aug15-review-deep-link.test.mjs
PASS: 78/78
```

Mounted Positions browser gates:

```text
KORDYN_COCKPIT_VIEWS=positions node tests/run-trading-cockpit-browser.mjs
KORDYN_COCKPIT_VIEWS=positions KORDYN_COCKPIT_EMPTY=1 node tests/run-trading-cockpit-browser.mjs
KORDYN_COCKPIT_VIEWS=positions KORDYN_COCKPIT_POSITION_CASE=malformed node tests/run-trading-cockpit-browser.mjs
KORDYN_COCKPIT_VIEWS=positions KORDYN_COCKPIT_POSITION_CASE=partial node tests/run-trading-cockpit-browser.mjs
PASS: every command at 1440x1080, 1280x960, and 1024x768
```

Loaded still confirms the canonical `ord-01` exit request. The malformed fixture retains three real position rows while alias-only and duplicate-position executions expose zero exit buttons, render none of the unrelated `13.37`/`14.88` protection, and leave the request recorder null. Partial composition retains both real rows while allocation, long/short, and concentration state exactly why percentages are unavailable; no known-row 100% remainder appears.

Resource-state matrix:

```text
KORDYN_COCKPIT_VIEWS=positions KORDYN_COCKPIT_STATE=<loading|stale|degraded|error|failed|forbidden|disabled> node tests/run-trading-cockpit-browser.mjs
PASS: every state at all three viewports
```

All runs report zero document overflow. Loading/stale/degraded retain last-valid facts with zero exits; terminal states expose neither facts nor actions.

Partial-state captures inspected at original resolution:

- `.impeccable/review/task-6-fix-1/positions-1440x1080.png`
- `.impeccable/review/task-6-fix-1/positions-1280x960.png`
- `.impeccable/review/task-6-fix-1/positions-1024x768.png`

The new incomplete states remain compact, readable, and consistent with the existing cockpit visual system. No CSS change was needed.

Full five-view browser regression:

```text
node tests/run-trading-cockpit-browser.mjs
PASS: overview, market, positions, execution, and ledger at all three viewports
```

Full repository verification:

```text
npm test
PASS: 2,334 tests, 0 failures, 16.175s

npm run lint
PASS

npm run build
PASS: 1,822 modules transformed; build completed in 1.41s
```

Material UI-state copy changed, so the Impeccable detector was run once for this fix round after the UI edit:

```text
node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/aug15/tradingCockpit/PositionsPage.jsx
[]
```

Whitespace and patch integrity:

```text
git diff --check
PASS (no output)
```
