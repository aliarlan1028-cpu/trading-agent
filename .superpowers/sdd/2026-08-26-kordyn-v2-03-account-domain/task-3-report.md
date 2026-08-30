# Task 3 report: Position truth and protection workspace

## Status and scope

- Status: implementation complete; ready for independent read-only review.
- Base: `fd8e7679f0717d14ce2df377128ea0dfba1d8550`.
- Scope: Plan 03 Task 3 only. No Task 4/5 workspace, screenshot evidence, Plan 04, cutover, backend, endpoint, permission, legacy, push, or deploy work was performed.
- Binding Desktop reference inspected at original size: `.impeccable/mocks/kordyn-v2-approved/desktop-account-position.png`.

## Files

Created:

- `src/kordynV2/domains/account/PositionWorkspace.jsx`
- `src/kordynV2/domains/account/PositionRegistry.jsx`
- `src/kordynV2/domains/account/PositionInspector.jsx`
- `src/kordynV2/domains/account/MobilePositionScreen.jsx`
- `tests/kordyn-v2-position-workspace.test.mjs`

Modified within the Task 3 allowance:

- `src/kordynV2/KordynV2Root.jsx`
- `src/kordynV2/domains/account/index.jsx`
- `src/kordynV2/domains/account/account.css`
- `src/kordynV2/domains/account/accountModel.js`

## RED → GREEN evidence

### Initial missing-module RED

The first focused run was intentionally made before any Task 3 presenter existed:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-position-workspace.test.mjs
```

Result: exit 1, 1/1 failed because all four Task 3 presenter modules were absent.

After the full 13-contract suite replaced that import witness, the same command exited 1 with 0/13 passing. Failures covered canonical fallback/duplicates, protection states, source linkage, Root selection, Desktop/APP presentation, event props, action settlement, direct-mutation exclusion, focus restoration, and touch CSS.

### Partial and complete GREEN

The first partial implementation run exited 1 with 10/13 passing. The remaining failures were exactly:

- `requestPositionExit` still returned the unavailable stub instead of disabled truth;
- `index.jsx` did not yet invoke `exitExecutionOrder`;
- Position APP did not yet have its 44px touch-target rule.

After the minimal production integration, the same command exited 0 with 13/13 passing.

### Execution/Position identity RED

Self-review added an explicit contract for an Execution selected from the Position workspace:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-position-workspace.test.mjs
```

Result: exit 1, 13/14 passed. The center Position truth still emitted canonical Position attributes while Root/Context/Trace were the selected Execution.

The correction keeps the Position visible as related context but emits only `data-kordyn-v2-related-position-id`. The registry Position remains a valid navigation candidate, but is marked `data-selected="context"` with `aria-pressed="false"`. Root Object, Context, and Trace remain the Execution identity. Focused result after correction: exit 0, 14/14.

### Approved-topology ledger RED

Original-size raster review found that the right evidence rail existed but the visually subordinate bottom related-record ledger was missing. A new assertion exited 1 with 13/14 passing on the absent ledger. The smallest GREEN added a Desktop-only, source-backed related Execution/protection-snapshot ledger; it introduces no Task 4 object workspace or action. Focused result: exit 0, 14/14.

The first combined regression then exited 1 with 155/156 passing because the new ledger used a fixed `min-width: 720px`, violating the existing Account responsive contract. Removing that fixed width and retaining a fluid `width: 100%` / `table-layout: fixed` ledger produced exit 0, 156/156.

## Model and truth decisions

- Position identity stays exactly `id → positionId → instId → symbol` through the deployed canonical identity function.
- Position availability now distinguishes absent, invalid, authoritative empty, and loaded facts.
- Only data-descriptor snapshots reach the shared selectors. Malformed records, revoked proxies, accessors, non-finite financial values, placeholders, and duplicate Position identities fail closed without hiding valid siblings.
- Missing finance stays `Unavailable`; authoritative numeric zero stays zero.
- The bounded Position projection adds only fields already present in deployed data: quantity, entry, mark, liquidation, PnL, notional, margin, leverage, liquidation distance, stop/targets, source, timestamps, plan/run/strategy links, and ownership.
- Ownership is source-backed: `execution_engine` is AI-managed; explicit exchange/manual/external sources are manual/external; unknown remains unavailable.
- Related Execution requires an explicit execution-order ID or exactly one order linked by Position ID. Symbol-only and ambiguous matches never select or enable an exit.
- Projected Execution IDs, account-snapshot IDs, and risk-incident IDs are unique or fail closed.
- Protection is verified only when a unique, matching exchange algo-order identity exists in a healthy, complete snapshot bound to the same account and exchange. A local stop value alone is never healthy evidence.
- Failed, degraded, and unavailable evidence remain distinct. Unknown protection is not rendered healthy.
- Malformed account-snapshot and risk-incident siblings are isolated; invalid timestamps are ineligible.

## Selection and action safety

- Position and Execution controls emit complete canonical candidate attributes only.
- Missing, invalid, ambiguous, and placeholder identities never emit partial attributes or an `Unavailable` object ID.
- Real `createV2Selection()` tests assert matching Object/Context/Trace identity for both Position and related Execution.
- An Execution-selected workspace shows the related Position as context without claiming it as the current Root object.
- The only mutation is the deployed `actions.account.exitExecutionOrder(sourceBackedOrder, surface)` path.
- There is no `/api/positions/` call, adjust-protection endpoint, repair action, optimistic close, or fake protected state.
- The existing `runAccountAction` controller bounds disabled, sync throw, rejection, pending, raw failure, and raw resolved results. Presenter copy says server acceptance is not exchange/account finality.
- The exit control is disabled when Root actions are disabled, while processing, or when a unique actionable related Execution is unavailable.

## Desktop and APP composition review

### Desktop 1440

- The approved asymmetric hierarchy is preserved: bounded dense Position registry, dominant flexible Position truth field, bounded evidence/action rail, and a visually subordinate related-record ledger.
- The selected truth field separates primary facts, an entry/mark/liquidation price boundary rail, secondary exposure/protection facts, and provenance.
- No price series was invented. The center uses only the projected authoritative price boundary facts available to Task 3.
- The right rail keeps source/run/plan/strategy/execution/protection/reconciliation facts and the one deployed protected exit.
- The 154px bottom ledger contains only the current source-linked Execution and protection snapshot.

### Desktop 1180

- Columns reduce to bounded 192–218px registry, flexible center, and 218–250px evidence rail.
- Primary/secondary facts reduce from three/four columns to two; evidence facts reduce to one column.
- All grid children use `min-width: 0`; the ledger is fluid and no Account CSS rule uses a fixed minimum width of 400px or more.
- Overflow remains bounded inside registries/evidence regions rather than escaping to the document.

### APP 430 / 390

- APP is separate markup, not the Desktop grid: Position list first, then a full-screen detail.
- Detail includes the same canonical Position facts, source/protection evidence, and protected action eligibility.
- The detail heading is programmatically focusable; Back restores focus to the remounted initiating Position row.
- Execution selection retains the related Position detail but does not give it canonical Root attributes.
- All interactive APP controls are at least 44px; widths are fluid; no `100vw`, fixed large minimum width, or horizontal overflow escape is present.

Final pixel screenshots remain Plan 03 Task 5 as required; structural mismatches found here were corrected rather than deferred.

## Impeccable detector

The required detector was run exactly once across the Task 3 UI targets:

```text
node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/kordynV2/KordynV2Root.jsx src/kordynV2/domains/account/index.jsx src/kordynV2/domains/account/PositionWorkspace.jsx src/kordynV2/domains/account/PositionRegistry.jsx src/kordynV2/domains/account/PositionInspector.jsx src/kordynV2/domains/account/MobilePositionScreen.jsx src/kordynV2/domains/account/account.css
```

Result: exit 0, output `[]`, 0 findings. Per the one-run contract it was not rerun. The later original-raster ledger closure was manually checked against the same prohibited patterns and then exercised by focused, responsive-contract, lint, build, full-test, and diff gates.

## Verification

Required Position/protection command:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-position-workspace.test.mjs tests/position-view.test.mjs tests/position-protection-evidence.test.mjs tests/exchange-protection-accounting.test.mjs tests/position-manager-move-stop.test.mjs
```

Result: exit 0, 40/40 before the identity/ledger additions; the final larger batch below includes the updated 14-case Task 3 suite and all of these regressions.

Final Task 3 + Position/protection + Task 1/2 account/state/selection/lazy batch:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-position-workspace.test.mjs tests/position-view.test.mjs tests/position-protection-evidence.test.mjs tests/exchange-protection-accounting.test.mjs tests/position-manager-move-stop.test.mjs tests/kordyn-v2-account-model.test.mjs tests/kordyn-v2-account-actions.test.mjs tests/kordyn-v2-account-cockpit.test.mjs tests/kordyn-v2-account-interactions.test.mjs tests/kordyn-v2-ai-workspace.test.mjs tests/kordyn-v2-state-boundary.test.mjs tests/kordyn-v2-state.test.mjs tests/kordyn-v2-ai-context-selection.test.mjs
```

Result: exit 0, 156/156 passed, 0 failed; duration 563.732875 ms.

Full suite:

```text
npm test
```

Result: exit 0, 1,964/1,964 passed, 0 failed/cancelled/skipped/todo; duration 13,762.266125 ms.

Additional gates:

- `npm run lint`: exit 0, no ESLint findings.
- `node --check src/kordynV2/domains/account/accountModel.js`: exit 0.
- `node --check tests/kordyn-v2-position-workspace.test.mjs`: exit 0.
- `npm run build`: exit 0, 1,715 modules transformed.
- Final Account lazy CSS chunk: `dist/assets/index-8oi6Zpwr.css`, 41.96 kB (6.60 kB gzip).
- Built `kordynV2PositionWorkbench`, `kordynV2PositionMobile`, and `kordynV2AccountWorkbench` selectors occur only in that Account chunk.
- `account.css` remains imported only from `src/kordynV2/domains/account/index.jsx`.
- Source checks find no `!important`, `/api/positions/`, `100vw`, fixed ≥400px `min-width`, or `overflow-x: auto/scroll` in the Task 3 surfaces.
- `git diff --check`: exit 0 before report creation; rerun in the final commit gate.

## Concerns

No unresolved Task 3 correctness concern is known. Final browser screenshot evidence and pixel comparison remain deliberately owned by Task 5.
