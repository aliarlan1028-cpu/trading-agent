# Task 7 report — desktop Execution & Review workbench

Date: 2026-09-04
Base commit: `7260a63`
Scope: Task 7 only
Status: complete

## Outcome

The desktop Execution & Review route now uses a dedicated `ReviewPage` that consumes the existing `buildReviewPresentation`, canonical review-to-closed-lifecycle joins, `behaviorProfile`, `initialReviewId`, `onReviewSelect`, and `ui`. The page follows the supplied authority's hierarchy: a seven-metric result ribbon, three-column recorded review conclusion, compact filters, paginated 36/64 trade-list/detail workbench, real path evidence, and a three-panel evidence footer.

The page exposes every required region:

- `review-hero`
- `ai-review-conclusion`
- `review-filters`
- `trade-list`
- `trade-detail`
- `trade-path`
- `hold-pnl-distribution`
- `behavior-insights`
- `next-actions`

No backend, API, trading engine, authentication, mobile, route, shared model, or unrelated production file was changed. Production permissions and actions are unchanged; the page adds no trading mutation.

## Canonical identity and deep-link contract

- Review selection is keyed only by a nonblank canonical `review.id`.
- The existing model resolves each trade review by `tradeLifecycleId`, then `executionOrderId`, then `orderId`; the page consumes that result rather than creating another join.
- Net PnL displayed for a matched review comes from the canonical closed lifecycle through `netReviewResult`. A conflicting review-local PnL cannot override it.
- A valid `initialReviewId` selects that exact review and opens the list page containing it.
- An unmatched, whitespace-only, object-shaped, or otherwise malformed `initialReviewId` fails closed with an empty selected identity and no detail. It never falls back to another review.
- Page-two selection is keyboard-operable. The mounted gate focuses the first page-two review, dispatches Enter, confirms the selected identity and detail changed, and proves `onReviewSelect` synchronized `/app/trade/reviews/review-18`.
- Reloading the deep-link fixture restores `review-18`, its detail, and list page 2. Navigating to `review-does-not-exist` clears selection/detail; restoring the valid fixture selects the same review again.

## Truthful analytical semantics

- Total net PnL, trade count, and win rate use explicit performance fields or complete canonical closed-lifecycle facts. Missing collections do not become zero.
- Expectancy is displayed only from an explicit `performance.expectancyUsdt` or recorded behavior-profile expectancy.
- Maximum drawdown and Profit Factor remain unavailable when the existing presentation does not provide those exact metrics. Average PnL is never relabeled as expectancy or a profit factor.
- Trade paths render only from an actual recorded sample array on the selected review or its canonical lifecycle. Aggregate trajectory metadata such as `note`, `candles`, `minsToPeak`, or reversal summaries does not become a chart. The explicit fallback is `未记录逐时路径`.
- Holding-time/PnL distribution includes only reviews whose canonical review/lifecycle evidence provides both finite hold minutes and finite net PnL.
- AI conclusion, behavior insight, and next-action content comes only from recorded review or behavior-profile fields. Empty fields render explicit unavailable/empty copy; the UI generates no conclusion or recommendation.
- Browser fixtures are explicitly marked production-shaped synthetic data, contain no secrets, and record navigation/action evidence only in local browser globals.

## Resource and malformed-state behavior

- `loaded` renders current facts.
- `loading`, `stale`, and `degraded` retain a last-valid facts body and show a resource boundary.
- Initial loading without facts, `not_loaded`, `error`, `failed`, `forbidden`, and `disabled` block the facts body.
- Error, failed, stale, and degraded retry controls use the existing `ui.refresh` or `ui.ensureSection` boundary without changing production state semantics.
- Malformed collection entries are rejected before presentation. The browser malformed fixture retains only `review-safe` and its exact `trade-safe` lifecycle.
- Loaded empty data shows no row or fabricated detail, and its list/detail empty workbench is compact rather than a tall vacant inspector.

## TDD record

### RED

Source/SSR contracts and production-shaped browser evidence were added before the dedicated module.

```text
node --test tests/trading-cockpit-reference.test.mjs tests/aug15-review-deep-link.test.mjs
FAIL: 45 passed, 5 failed (50 total)
```

The protected deep-link test remained 4/4 green. The five expected Task 7 failures covered the missing dedicated page/regions, exact deep-link lifecycle evidence, malformed/unmatched fail-closed behavior, unavailable analytics/no-path truth, and malformed/resource-state behavior.

```text
KORDYN_COCKPIT_VIEWS=execution node tests/run-trading-cockpit-browser.mjs
FAIL: legacy page did not expose the required no-path landmark
```

The first implementation browser run reached page 2 but failed because the new test's page marker was absent. The rendered table already showed `第 2 / 4 页`; adding `data-review-page` made the interaction contract inspectable. A later keyboard gate found Chromium does not expose usable focus paint on a focused table row, so the semantic target became a native button inside the time cell while the full row remains pointer-selectable.

### GREEN

Fresh source, SSR, and protected route verification:

```text
node --test tests/trading-cockpit-reference.test.mjs tests/aug15-review-deep-link.test.mjs
PASS: 50/50
```

Loaded Review interaction and geometry:

```text
KORDYN_COCKPIT_VIEWS=execution node tests/run-trading-cockpit-browser.mjs
PASS at 1440x1080, 1280x960, and 1024x768
```

Observed at every viewport: all nine required regions; zero document overflow; 27-review list paginated to eight rows; minimum owned interactive target 36px; keyboard selection and focused native review target; exact `review-18` callback/deep-link identity; three real path samples; fail-closed unmatched identity; deep-link restoration to list page 2. The workbench measured `36.00 / 64.00` at 1440, 1280, and 1024.

Empty and malformed boundaries:

```text
KORDYN_COCKPIT_VIEWS=execution KORDYN_COCKPIT_EMPTY=1 node tests/run-trading-cockpit-browser.mjs
KORDYN_COCKPIT_VIEWS=execution KORDYN_COCKPIT_REVIEW_CASE=malformed node tests/run-trading-cockpit-browser.mjs
PASS: both commands at all three viewports
```

Resource-state matrix:

```text
KORDYN_COCKPIT_VIEWS=execution KORDYN_COCKPIT_STATE=<loading|stale|degraded|error|failed|forbidden|disabled|not_loaded|unknown> node tests/run-trading-cockpit-browser.mjs
PASS: every state at all three viewports
```

Loading/stale/degraded retain last-valid facts. Terminal, not-loaded, and unknown states fail closed. All runs report zero horizontal document overflow.

## Visual inspection

The supplied authority was inspected at original resolution before implementation:

`交易驾驶舱参考图/ChatGPT Image 2026年9月3日 15_35_57 (4).png`

Final temporary captures were generated and inspected at original resolution:

- `/tmp/task7-final-captures.F9GHNz/execution-1440x1080.png`
- `/tmp/task7-final-captures.F9GHNz/execution-1280x960.png`
- `/tmp/task7-final-captures.F9GHNz/execution-1024x768.png`

The final 1440 capture preserves the authority's seven-part metric band, three-column conclusion, filter rail, dense paginated list, dominant trade-detail/path area, and three evidence panels. The selected page-two row and its canonical detail are simultaneously visible. At 1280 the same hierarchy remains intact. At 1024 the content continues vertically while the document remains free of horizontal overflow; the first hero metric was reduced responsively to avoid excessive clipping.

The authority contains applied-strategy buttons and richer AI prescriptions. Those were intentionally not copied because the available production data and permission contract provide no truthful action or generated recommendation. Existing cockpit typography, shell controls, tokens, borders, and warm-neutral material were preserved.

An inline Impeccable finish-review substitution was used because subagents were explicitly prohibited. Disposition: ship for the requested desktop viewport set; topology/type/material/ground remain consistent with the existing cockpit and the supplied authority, and no material fix remained after the final capture comparison.

## Regression and quality gates

Full five-view desktop cockpit browser regression:

```text
node tests/run-trading-cockpit-browser.mjs
PASS: overview, market, positions, execution, and ledger at all three viewports
```

Full isolated suite:

```text
npm test
PASS: 2,339 tests, 0 failures, 18.041s
```

Repository lint and production build:

```text
npm run lint
PASS

npm run build
PASS: 1,823 modules transformed; build completed in 7.26s while run concurrently with the full suite
```

Impeccable mechanical detector, run once on the changed Task 7 UI targets:

```text
node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs src/aug15/tradingCockpit/ReviewPage.jsx src/aug15/tradingCockpit.css
PASS: exit 0, no findings output
```

The detector was not rerun after its clean result. The later browser-discovered keyboard-target correction replaced a focusable table row with a native 36px button and was instead revalidated by the mounted Enter-selection/focus assertions, lint, build, full browser gate, and full suite.

Whitespace and patch integrity:

```text
git diff --check -- <authorized Task 7 files>
PASS (no output)
```

## Files changed

- `src/aug15/tradingCockpit/ReviewPage.jsx` — dedicated canonical, truthful, resource-aware Review page.
- `src/aug15/tradingCockpit.jsx` — routes Execution & Review to the dedicated component and removes the obsolete inline page.
- `src/aug15/tradingCockpit.css` — reference-led Review composition, compact empty state, focus, controls, and responsive geometry.
- `tests/trading-cockpit-reference.test.mjs` — source/SSR, lifecycle precedence, unavailable analytics, no-path, malformed, deep-link, and state contracts.
- `tests/run-trading-cockpit-browser.mjs` — mounted page-two keyboard selection, callback/deep-link/reload/fail-closed, regions, state, geometry, focus, and control-size gates.
- `tests/trading-cockpit-browser.jsx` — production-shaped review path/hold/expectancy, malformed, and deep-link fixtures.
- `.superpowers/sdd/2026-09-03-trading-cockpit-reference-redesign/task-7-report.md` — this evidence report.

## Scope and repository hygiene

- The pre-existing untracked `tests/aug15-review-deep-link.test.mjs` was read and run but not modified or staged.
- The pre-existing App/route work, unrelated source/test changes, prior captures, and other untracked files remain untouched and unstaged.
- Final captures stayed in `/tmp`; no unauthorized artifact was added to the repository.
- Only the authorized Task 7 source, test, fixture, and report files are staged and committed.
