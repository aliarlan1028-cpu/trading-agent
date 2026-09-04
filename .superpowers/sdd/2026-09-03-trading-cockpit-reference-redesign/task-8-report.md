# Task 8 report — desktop Orders & Fills execution ledger

Date: 2026-09-04
Base commit: `ad0f220`
Implementation commit: `e9e53f92035250ce29c0db40f3d3b8394ce187da`
Fix-round base/report commit: `d8839191ff41b6e7355b587647e0541f9daf5d85`
Fix-round implementation commit: `614e328f1e4fe53416b82b248c6550102b31a3de`
Fix-round-2 base/report commit: `00db541a136040e83007ef6572aecc03cbf8d5db`
Fix-round-2 implementation commit: `953ac21823ee94a7a7bdf6e6c706ac69a30a4d32`
Fix-round-3 base/report commit: `a13cc7a7fa13765611ec108bd73a38e2a6bf9fcc`
Fix-round-3 implementation commit: `04cb9002e1e9c80b6369d2aa3e5f80e335cc501f`
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

Fix-round-2 final temporary captures were generated and inspected at original resolution:

- `/private/tmp/task8-fix-round2-final/ledger-1440x1080.png`
- `/private/tmp/task8-fix-round2-final/ledger-1280x960.png`
- `/private/tmp/task8-fix-round2-final/ledger-1024x768.png`

The 1440 capture preserves the reference hierarchy and dense first-screen reconciliation flow. Its complete fill ledger ends at `1068.75px` and its pagination at `1067.75px`, leaving approximately `11px` of visible viewport clearance at 1080px; neither is clipped. The 1280 capture retains the same two-column workbench with internally contained tables. The 1024 capture intentionally stacks the workbench and continues vertically rather than compressing facts into unreadable columns. Earlier pre-fix captures are historical and are not the visual evidence for this round.

## Truthful execution metrics and separation

The hero reports exactly six existing facts:

1. total orders;
2. working orders;
3. filled orders;
4. rejected or risk-blocked orders (canceled orders are excluded);
5. fill rate;
6. exchange fill fees.

Awaiting approval is not substituted for any of those metrics. Missing fee values make the aggregate fee unavailable rather than silently coercing the missing values to zero. Loaded empty collections remain real zero counts and render compact empty states.

The order list and exchange-confirmed fill ledger have independent production-local filters and pagination:

- orders: independent working, filled, canceled, rejected/risk-blocked, and other status families plus symbol;
- fills: symbol, side, maker/taker liquidity, and open/reduce intent.

The mounted Chrome gate exercises page changes, filter-induced page reset, restoration of a valid default selection, mouse selection, Enter-key selection, visible focus, and independent fill filters. Each list paginates eight rows per page. The exchange fill table explicitly names itself as exchange-confirmed evidence and never promotes an order into a fill.

## Canonical selected-order evidence

The selected order must have a nonblank canonical identity and resolve to exactly one row in `data.executionOrders`. A blank, missing, or duplicate selected identity makes all six stages incomplete.

The six timeline stages are bound as follows:

- Signal: one exact, unique selected plan identity.
- Risk: when the selected execution owns `riskCheckId`, that explicit reference must resolve to exactly one risk row and no weaker fallback is allowed. Without an explicit reference, one exact `executionOrderId` match takes precedence. A plan-level fallback is allowed only for one unique plan, one unique execution owner, and one unlinked, unambiguous plan risk fact. Only normalized exact positive outcomes complete the stage; negative substrings such as `not_allowed` or `not_approved` cannot pass.
- Routing: venue/exchange on the exact selected order.
- Order: the uniquely resolved selected order itself.
- Fill: one or more fills with an exact nonblank `orderId` or `executionOrderId` equal to the selected order.
- Protection: persisted protection evidence on the exact selected authoritative execution only. `protecting`, or a confirmed protection state with canonical stop/take-profit identifiers, can complete the stage; degraded/stop-only evidence is partial and failed/unconfirmed evidence is not complete. Order type/kind alone never proves protection.

Symbol matching and global-existence fallbacks are forbidden. The adversarial browser fixture selects `ledger-selected` while a same-symbol sibling owns the only plan, risk, venue, fill, and protection evidence. Signal, Risk, Routing, Fill, and Protection remain incomplete and sibling-only text is absent from both detail and timeline.

The detail renders only the selected order's identity, symbol, direction, type, quantity, filled quantity, price, venue, time, unique strategy/signal plan, and exact-fill count. Missing fields are explicitly unavailable. Duplicate orders and duplicate plans fail closed instead of selecting the first row.

## Action boundaries

- “交给 AI 处理” only calls the existing `ui.setActive("chat")` navigation action.
- Cancel/exit controls are present only when the selected row resolves uniquely and retains a nonblank original canonical `id`, the resource state is loaded, and the existing `executionExitAction` allows the action. Derived `executionOrderId`/`orderId` aliases never replace that authoritative row identity.
- The action continues through the existing `requestExecutionExit(action, selected, "manual_ui")` confirmation/request path with the original authoritative row. Task 8 does not bypass or replace protected confirmation semantics.
- Loading, stale, and degraded last-valid views suppress execution actions. Terminal no-fact states expose neither stale rows nor exit actions.

## Resource, malformed, and scale behavior

- `loaded` renders current facts and eligible actions.
- `loading`, `stale`, and `degraded` retain last-valid facts, expose the resource boundary, and suppress actions.
- initial loading, `not_loaded`, `error`, `failed`, `forbidden`, and `disabled` block the facts body and emit no selected-object identity.
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

### Fix round 3 — one authoritative order-status classifier

The third review-fix cycle removed the remaining split-brain order-status semantics. `model.js` now imports the production `OPEN_EXECUTION_STATES` set directly from the constants-only `server/executionStates.mjs` module and exports one pure `executionOrderStatusFamily` classifier. Both the six-metric Hero and the mounted Ledger status filter call that same classifier; `LedgerPage` contains no copied open-state list.

Classification is normalized and exact. Production OPEN state wins first, so all 17 current server states—including `entry_filled`—remain `working` exactly as the backend defines them. Exact terminal filled, canceled, and rejected/risk-blocked sets follow. Unknown and misleading substring values such as `unfilled`, `not_working`, and `risk_approved` are `other`; they do not increment working, filled, or blocked metrics.

The TDD RED run failed only at the three intended contracts before production changed:

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-model.test.mjs tests/trading-cockpit-reference.test.mjs
FAIL: 104 passed, 3 failed (107 total)
```

Those failures proved the classifier was absent, the Hero was using legacy local sets, and mounted SSR classified `entry_filled` as filled instead of production-open. After the shared classifier was connected, the same focused command passed `107/107`.

The real mounted status-counterexample page contains two production-open orders, two terminal filled orders, two canceled orders, two rejected/risk-blocked orders, and three negative/unknown counterexamples. At 1440×1080, 1280×960, and 1024×768, interactive filter clicks returned:

```text
Hero [total, working, filled, blocked]: [11, 2, 2, 2]
Filter family counts: { working: 2, filled: 2, canceled: 2, blocked: 2, other: 3 }
PASS: Hero total equals the sum of all five mounted filter results
```

The round-3 screenshots are:

- `/private/tmp/task8-fix-round3-normal/ledger-1440x1080.png`
- `/private/tmp/task8-fix-round3-normal/ledger-1280x960.png`
- `/private/tmp/task8-fix-round3-normal/ledger-1024x768.png`
- `/private/tmp/task8-ledger-round3-exact-status/ledger-1440x1080.png`
- `/private/tmp/task8-ledger-round3-exact-status/ledger-1280x960.png`
- `/private/tmp/task8-ledger-round3-exact-status/ledger-1024x768.png`

No Task 8 CSS changed in this round. The normal 1440 capture still shows the complete fill ledger and pagination inside the primary frame (`fillLedgerBottom=1068.75`, `fillPaginationBottom=1067.75`), with `53.00/47.00` order/detail columns, 36px minimum enabled targets, 11px minimum operational text, and zero document horizontal overflow. The status-counterexample 1440 capture has `24.75px` fill-panel clearance and `25.75px` pagination clearance.

Fresh shared-checkout gates passed:

```text
focused model/reference
PASS: 107/107

npm test
PASS: 2367/2367, 0 failures

npm run lint
PASS

npm run build
PASS: 1826 modules transformed; built in 1.45s

all-five real Chrome
PASS: 15/15 view/viewport results; cleanup PASS

Ledger real Chrome
PASS: normal, status-counterexamples, risk-counterexamples, identity,
      adversarial, malformed, long, explicit-empty, collections-missing,
      collections-malformed, loading, stale, degraded, failed, forbidden,
      and disabled at 1440×1080, 1280×960, and 1024×768

Impeccable detector
[]

git diff --check
PASS (no output)
```

The larger shared count includes unrelated user-owned tests and is reported only with that provenance. The history-preserving exact detached checkout of `04cb9002e1e9c80b6369d2aa3e5f80e335cc501f` is `/private/tmp/task8-ledger-round3-clone.tR4iaS`. It produced:

```text
focused model/reference
PASS: 107/107

npm test
PASS: 2356/2356, 0 failures

npm run lint
PASS

npm run build
PASS: 1825 modules transformed; built in 1.55s

all-five real Chrome
PASS: 15/15 view/viewport results; cleanup PASS

Ledger exact Chrome
PASS: normal, status-counterexamples, risk-counterexamples, identity,
      adversarial, malformed, long, explicit-empty, collections-missing,
      collections-malformed, loading, stale, degraded, failed, forbidden,
      disabled, and not_loaded at 1440×1080, 1280×960, and 1024×768

Impeccable detector
[]

git diff --check
PASS (no output)

git status --short
PASS (no output after removing the temporary node_modules symlink)
```

The production build is therefore direct evidence that importing the constants-only server status module does not violate the Vite bundle boundary. No duplicate open-state list or fallback classifier was introduced.

### Fix round 2 — risk authority, canceled status, and no-selection timeline

The second review-fix cycle again started RED. The focused run produced `98 passed / 6 failed` out of 104 tests at the intended assertions: explicit `riskCheckId` precedence and invalid-reference fail-closed behavior, exact positive-risk outcomes, negative protection states, a distinct canceled family, and the required six-stage timeline when no canonical selection exists.

The production presentation join now treats an own `riskCheckId` as authoritative: it must be nonblank and resolve uniquely, otherwise Risk remains incomplete and cannot borrow plan evidence. Without an explicit reference, exact execution linkage precedes the already constrained unique-plan fallback. Risk and protection use exact normalized allowlists, so `disallowed`, `not_allowed`, `not_approved`, `bypassed`, `inactive`, `not_protected`, and unknown states cannot become success through substring matching. Persisted protection IDs still require a positive protection state or the exact `protecting` execution status.

Canceled orders now have a separate filter and status family. The mounted real-component test returned `canceledFamilies=["canceled","canceled"]` for the canceled filter and `blockedFamilies=["blocked"]` for the rejected/risk-blocked filter; the latter is backed by an independent `risk_blocked` fixture row, never by a canceled row. The Hero blocked metric remains `1` for the normal fixture and continues to exclude both canceled rows.

Explicit empty, missing collections, malformed collections, and invalid canonical selection all keep the eight structural regions mounted. Order Detail renders a compact unavailable body and Execution Timeline renders exactly six incomplete stages, without selected-object identity, an exit control, or an API call. The missing/malformed collection Hero uses six `不可用` values; only explicitly loaded empty arrays produce truthful zero counts.

The fresh shared-checkout gates passed:

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-model.test.mjs tests/trading-cockpit-reference.test.mjs
PASS: 104/104

npm test
PASS: 2364/2364, 0 failures

npm run lint
PASS

npm run build
PASS: built in 1.59s

node tests/run-trading-cockpit-browser.mjs
PASS: 15/15 view/viewport results; cleanup PASS

node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/aug15/tradingCockpit/LedgerPage.jsx src/aug15/tradingCockpit.css
[]

git diff --check
PASS (no output)
```

The shared count includes unrelated user-owned tests and is reported only with that provenance. The history-preserving exact checkout of `953ac21823ee94a7a7bdf6e6c706ac69a30a4d32` is `/private/tmp/task8-ledger-round2-clone.WBX26E`. It produced:

```text
focused model/reference
PASS: 104/104

npm test
PASS: 2353/2353, 0 failures

npm run lint
PASS

npm run build
PASS: built in 1.53s

all-five real Chrome
PASS: 15/15 view/viewport results; cleanup PASS

Ledger exact Chrome cases
PASS: normal, risk-counterexamples, identity, adversarial, malformed,
      long, explicit-empty, collections-missing, collections-malformed,
      loading, stale, degraded, failed, forbidden, disabled, error,
      and not_loaded at 1440×1080, 1280×960, and 1024×768

Impeccable detector
[]

git diff --check
PASS (no output)

git status --short
PASS (no output after removing the temporary node_modules symlink)
```

The first appended `error/not_loaded` exact command attempt failed before mounting the product with `ERR_MODULE_NOT_FOUND` because the temporary dependency symlink had already been removed for the clean-status check. Restoring the same read-only dependency symlink and rerunning only those two states passed at all three viewports; the symlink was then removed again and the exact checkout returned clean. This was a harness precondition error, not a product-state failure.

The round-2 1440 screenshot was inspected at original resolution. The complete fill ledger and pagination are readable and uncut: `fillLedgerBottom=1068.75`, `fillPaginationBottom=1067.75`, leaving `11.25px` and `12.25px` respectively inside the 1080px viewport. Its order/detail workbench remains `53.00% / 47.00%`, minimum enabled target is 36px, minimum operational text is 11px, and document horizontal overflow is zero. The 1280 viewport preserves the two-column workbench; 1024 purposefully stacks it without horizontal overflow.

### Fix round 1 — identity, availability, protection, and first-frame convergence

The review-fix cycle added failing contracts before production changes for alias-only, blank, and duplicate execution identities; mounted exit clicks; absent and malformed collections; canceled-order classification; and persisted protection evidence. The RED runs failed at the intended assertions: five model failures and three reference/mounted contract failures. After the fix, the focused suite passed `99/99`.

The mounted action gate selects the real production Ledger row, invokes the real click handler and confirmation path, and verifies the exact authoritative request payload. Alias-only, blank-canonical, and duplicate identities expose no exit control and make no request. Removing the production `onClick` wiring would therefore fail the mounted browser contract.

The fix-round browser matrix passed loaded normal, identity-adversarial, sibling-adversarial, malformed, long, explicit-empty, missing-collection, and malformed-collection cases, plus `loading`, `stale`, `degraded`, `failed`, `forbidden`, `disabled`, `error`, and `not_loaded`. Every case ran at 1440×1080, 1280×960, and 1024×768 with zero document horizontal overflow. Operational text measured at least 11px, enabled controls at least 36px, and resource retry controls 38px under the real cascade.

The final 1440 loaded measurements were:

```text
order/detail columns: 53.00% / 47.00%
workbench height: 368.5px
fill ledger height: 361px
fill ledger bottom: 1068.75px
fill pagination bottom: 1067.75px
viewport bottom clearance: approximately 11px
document horizontal overflow: 0
minimum operational text: 11px
minimum enabled target: 36px
```

The history-preserving exact checkout of fix commit `614e328f1e4fe53416b82b248c6550102b31a3de` is `/private/tmp/task8-ledger-fix-clone.GhT5w6`. It produced:

```text
node scripts/run-tests-isolated.mjs tests/trading-cockpit-model.test.mjs tests/trading-cockpit-reference.test.mjs
PASS: 99/99

npm test
PASS: 2348/2348, 0 failures

node tests/run-trading-cockpit-browser.mjs
PASS: 15/15 view/viewport results; cleanup PASS

npm run lint
PASS

npm run build
PASS: 1824 modules transformed; 1.65s

node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/aug15/tradingCockpit/LedgerPage.jsx src/aug15/tradingCockpit.css
[]

git diff --check
PASS (no output)
```

The shared checkout also passed `2359/2359`; that larger count includes unrelated user-owned tests and is not used as the exact-commit authority.

### Original Task 8 verification — historical baseline

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
- Fix-round implementation commit `614e328` contains exactly seven authorized Task 8 source/test files and no report, progress ledger, screenshot, or unrelated shared-worktree change.
- Fix-round-2 implementation commit `953ac21` contains exactly five authorized Task 8 source/test files and no report, progress ledger, screenshot, or unrelated shared-worktree change.
- Fix-round-3 implementation commit `04cb900` contains exactly six authorized Task 8 source/test files and no CSS, report, progress ledger, screenshot, or unrelated shared-worktree change.
- This report is committed separately from production implementation.
- Pre-existing App/mobile/route/style/test changes, captures, artifacts, the reference-image directory, and all other user-owned untracked files remain untouched and unstaged.
- Temporary screenshots and exact-checkout directories remain outside the repository; no unauthorized evidence asset was committed.

## Intentional tradeoffs

- Wide order/fill schemas use internal table scrollers at narrower widths. The document itself never scrolls horizontally.
- At 1024, order list and detail/timeline stack. This preserves readable fields and target size instead of compressing the reference's desktop split beyond usability.
- The two notice channels can only show existing notification, risk, or event facts. When those collections provide no renderable content, the channel says unavailable; it does not invent the reference copy.
- Browser fixtures are explicitly production-shaped synthetic data. They mount the real production components and action helpers without credentials or external writes.
