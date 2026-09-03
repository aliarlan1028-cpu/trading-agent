# Task 8 report — desktop Orders & Fills execution ledger

Date: 2026-09-04
Base commit: `ad0f220`
Implementation commit: `e9e53f92035250ce29c0db40f3d3b8394ce187da`
Scope: Task 8 only
Status: implementation complete; awaiting independent review

## Outcome

The desktop Orders & Fills route now uses a dedicated `LedgerPage` instead of the legacy inline page. It follows the supplied execution-ledger authority while remaining bound to the existing production-shaped data and action contracts. Orders, selected-order evidence, and exchange-confirmed fills are separate layers rather than one generic table.

The page exposes all eight required regions:

- `execution-hero`
- `execution-notices`
- `order-filters`
- `order-list`
- `order-detail`
- `execution-timeline`
- `fill-filters`
- `fill-ledger`

No backend, API, database, authentication, mobile, trading-engine, permission, or production routing behavior changed. The only shared-model change is the approved fail-closed selected-order presentation join.

## Reference contract and visual translation

The visual authority was inspected at its original `1448×1086` resolution before implementation:

`交易驾驶舱参考图/ChatGPT Image 2026年9月3日 15_35_57 (5).png`

The implemented region contract preserves the authority's title/date line, six-part execution hero, dual-channel notice strip, approximately `53/47` order-list/detail workbench, six-stage selected-order timeline, and full-width exchange fill ledger. The translation uses the already approved warm cockpit shell, dense 11–13px data typography, orange active state, green/danger status semantics, hairline borders, compact radii, and contained table scrolling. Reference numbers were not copied into production source.

At 1440 and 1280 the order workbench measured `53.00/47.00`. At 1024 it deliberately reflows into vertically stacked full-width order and detail surfaces. The document had zero horizontal overflow at all three widths. The smallest enabled Ledger control measured 36px and the real keyboard-selected order target exposed a solid 3px focus outline plus inset focus ring.

Final temporary captures were generated and inspected at original resolution:

- `/private/tmp/task8-ledger-visual/ledger-1440x1080.png`
- `/private/tmp/task8-ledger-visual/ledger-1280x960.png`
- `/private/tmp/task8-ledger-visual/ledger-1024x768.png`

The 1440 capture preserves the reference hierarchy and dense first-screen reconciliation flow. The 1280 capture retains the same two-column workbench with internally contained tables. The 1024 capture intentionally stacks the workbench and continues vertically rather than compressing facts into unreadable columns.

## Truthful execution metrics and separation

The hero reports exactly six existing facts:

1. total orders;
2. working orders;
3. filled orders;
4. rejected, canceled, or risk-blocked orders;
5. fill rate;
6. exchange fill fees.

Awaiting approval is not substituted for any of those metrics. Missing fee values make the aggregate fee unavailable rather than silently coercing the missing values to zero. Loaded empty collections remain real zero counts and render compact empty states.

The order list and exchange-confirmed fill ledger have independent production-local filters and pagination:

- orders: status family and symbol;
- fills: symbol, side, maker/taker liquidity, and open/reduce intent.

The mounted Chrome gate exercises page changes, filter-induced page reset, restoration of a valid default selection, mouse selection, Enter-key selection, visible focus, and independent fill filters. Each list paginates eight rows per page. The exchange fill table explicitly names itself as exchange-confirmed evidence and never promotes an order into a fill.

## Canonical selected-order evidence

The selected order must have a nonblank canonical identity and resolve to exactly one row in `data.executionOrders`. A blank, missing, or duplicate selected identity makes all six stages incomplete.

The six timeline stages are bound as follows:

- Signal: one exact, unique selected plan identity.
- Risk: one exact `executionOrderId` match takes precedence. A plan-level fallback is allowed only for one unique plan, one unique execution owner, and one unlinked, unambiguous plan risk fact.
- Routing: venue/exchange on the exact selected order.
- Order: the uniquely resolved selected order itself.
- Fill: one or more fills with an exact nonblank `orderId` or `executionOrderId` equal to the selected order.
- Protection: protection type/kind on the exact selected order only.

Symbol matching and global-existence fallbacks are forbidden. The adversarial browser fixture selects `ledger-selected` while a same-symbol sibling owns the only plan, risk, venue, fill, and protection evidence. Signal, Risk, Routing, Fill, and Protection remain incomplete and sibling-only text is absent from both detail and timeline.

The detail renders only the selected order's identity, symbol, direction, type, quantity, filled quantity, price, venue, time, unique strategy/signal plan, and exact-fill count. Missing fields are explicitly unavailable. Duplicate orders and duplicate plans fail closed instead of selecting the first row.

## Action boundaries

- “交给 AI 处理” only calls the existing `ui.setActive("chat")` navigation action.
- Cancel/exit controls are present only when the selected row is canonical, resource state is loaded, and the existing `executionExitAction` allows the action.
- The action continues through the existing `requestExecutionExit(action, selected, "manual_ui")` confirmation/request path. Task 8 does not bypass or replace protected confirmation semantics.
- Loading, stale, and degraded last-valid views suppress execution actions. Terminal no-fact states expose neither stale rows nor exit actions.

## Resource, malformed, and scale behavior

- `loaded` renders current facts and eligible actions.
- `loading`, `stale`, and `degraded` retain last-valid facts, expose the resource boundary, and suppress actions.
- initial loading, `not_loaded`, `error`, `failed`, `forbidden`, and `disabled` block the facts body.
- loaded empty data renders no order, fill, detail identity, or action. Workbench heights were 190px at 1440/1280 and 320px at stacked 1024, avoiding a tall empty void.
- malformed identity-less and duplicate rows are removed before selection; the mounted malformed fixture retains exactly one canonical order and one canonical fill.
- the long-content fixture remains contained at 1440/1280/1024 without document overflow.
- the normal fixture supplies more than one page of orders and fills so pagination is a real mounted interaction rather than a static marker.

## TDD record

### RED

Reference and SSR contracts were added before the dedicated page:

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-reference.test.mjs tests/trading-cockpit-model.test.mjs
FAIL: 84 passed, 5 failed (89 total)
```

The five expected failures covered the missing dedicated module/eight-region composition, six truthful hero metrics, sibling-isolated stages, resource/action boundaries, and empty/malformed behavior.

Adversarial model probes then demonstrated three real presentation defects in the existing selector: blank selected identities could complete Order/Fill, a plan risk could be borrowed from a sibling sharing the same plan, and duplicate plan identities selected the first row. The SDD ruling approved the minimal `model.js` and model-test scope extension before the implementation was changed.

A final mounted RED assertion exposed an incomplete effect dependency: after a symbol filter cleared the selected order, resetting to all symbols did not restore a valid default selection. The 1440 run timed out on `ledger order filter restores a valid default selection`. Adding the filter and selection dependencies to the existing selection effect made the real interaction green at all three widths.

### GREEN

Fresh focused source/model verification:

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-reference.test.mjs tests/trading-cockpit-model.test.mjs
PASS: 94/94
```

Loaded Ledger interaction and geometry:

```text
KORDYN_COCKPIT_VIEWS=ledger node tests/run-trading-cockpit-browser.mjs
PASS: 1440×1080, 1280×960, 1024×768; cleanup PASS
```

Adversarial, malformed, long-content, and loaded-empty boundaries:

```text
KORDYN_COCKPIT_VIEWS=ledger KORDYN_COCKPIT_LEDGER_CASE=<adversarial|malformed|long> node tests/run-trading-cockpit-browser.mjs
KORDYN_COCKPIT_VIEWS=ledger KORDYN_COCKPIT_EMPTY=1 node tests/run-trading-cockpit-browser.mjs
PASS: every command at all three viewports; cleanup PASS
```

Resource-state matrix:

```text
KORDYN_COCKPIT_VIEWS=ledger KORDYN_COCKPIT_STATE=<loading|stale|degraded|failed|forbidden|disabled> node tests/run-trading-cockpit-browser.mjs
PASS: every state at all three viewports; cleanup PASS
```

Loading/stale/degraded retained all eight regions and suppressed exits. Failed/forbidden/disabled rendered the boundary only, with no rows, detail, or action.

## Regression and exact-commit gates

Full five-view desktop cockpit regression on the shared checkout:

```text
node tests/run-trading-cockpit-browser.mjs
PASS: overview, market, positions, execution, and ledger × 1440/1280/1024 (15 cases); cleanup PASS
```

Shared-checkout full suite after the final interaction fix:

```text
npm test
PASS: 2354/2354, 0 failures
```

The shared count includes pre-existing unrelated uncommitted tests. The exact implementation commit was therefore checked out from local Git history at `/private/tmp/task8-ledger-clone.F5GUUu` and verified independently:

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-reference.test.mjs tests/trading-cockpit-model.test.mjs
PASS: 94/94

npm test
PASS: 2343/2343, 0 failures

npm run lint
PASS

npm run build
PASS: 1824 modules transformed; 1.68s
```

An exact `git archive e9e53f9` source snapshot at `/private/tmp/task8-ledger-archive.WEVwkd` also passed focused 94/94, lint, production build, and the all-five real-Chrome gate. The full-suite authority is the history-preserving exact checkout above because several existing repository tests inspect Git history and a raw archive intentionally contains no `.git` directory.

Impeccable mechanical detector on the Task 8 UI targets:

```text
node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/aug15/tradingCockpit/LedgerPage.jsx src/aug15/tradingCockpit.jsx src/aug15/tradingCockpit.css
[]
```

Whitespace and patch integrity:

```text
git diff --cached --check
PASS (no output)
```

## Files changed

- `src/aug15/tradingCockpit/LedgerPage.jsx` — dedicated Ledger page, filters, pagination, exact detail/timeline, state and action boundaries.
- `src/aug15/tradingCockpit.jsx` — routes Ledger to the dedicated component and removes the obsolete inline page.
- `src/aug15/tradingCockpit.css` — scoped reference-led Ledger composition, density, states, focus, tables, and responsive behavior.
- `src/aug15/tradingCockpit/model.js` — approved unique selected-order/plan/risk/fill presentation joins.
- `tests/trading-cockpit-reference.test.mjs` — eight regions, metrics, identity isolation, state, malformed, and empty SSR contracts.
- `tests/trading-cockpit-model.test.mjs` — blank/duplicate/missing identity, exact-fill, plan, and risk precedence adversarial contracts.
- `tests/run-trading-cockpit-browser.mjs` — real Ledger interactions, geometry, focus, isolation, state, scale, and responsive gates.
- `tests/trading-cockpit-browser.jsx` — production-shaped fill dimensions plus adversarial/malformed/long Ledger fixtures.
- `.superpowers/sdd/2026-09-03-trading-cockpit-reference-redesign/task-8-report.md` — this evidence report.

## Scope and repository hygiene

- Implementation commit `e9e53f9` contains exactly the eight authorized source/test files, including the explicitly approved model scope extension.
- This report is committed separately from production implementation.
- Pre-existing App/mobile/route/style/test changes, captures, artifacts, the reference-image directory, and all other user-owned untracked files remain untouched and unstaged.
- Temporary screenshots and exact-checkout directories remain outside the repository; no unauthorized evidence asset was committed.

## Intentional tradeoffs

- Wide order/fill schemas use internal table scrollers at narrower widths. The document itself never scrolls horizontally.
- At 1024, order list and detail/timeline stack. This preserves readable fields and target size instead of compressing the reference's desktop split beyond usability.
- The two notice channels can only show existing notification, risk, or event facts. When those collections provide no renderable content, the channel says unavailable; it does not invent the reference copy.
- Browser fixtures are explicitly production-shaped synthetic data. They mount the real production components and action helpers without credentials or external writes.
