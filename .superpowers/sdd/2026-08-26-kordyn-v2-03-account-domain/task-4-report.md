# Task 4 report: Plans, orders, fills, reviews, and closed-trade output

## Scope

- Scope: Plan 03 Task 4 only.
- Base commit: `804a28d40e8e0b41859fad7f7045d3c9d85e941f`.
- Implemented the Account-domain execution workspaces for `Trade plan`, `Execution`, `Order`, `Fill`, `Closed trade`, and `Review`.
- No Plan 04, Task 5 screenshot work, convergence/cutover, merge, push, deploy, backend, database, permissions, trading execution, risk-engine, or legacy cleanup work was performed.

## Files changed

Created:

- `src/kordynV2/domains/account/PlanWorkspace.jsx`
- `src/kordynV2/domains/account/OrderWorkspace.jsx`
- `src/kordynV2/domains/account/FillWorkspace.jsx`
- `src/kordynV2/domains/account/ClosedTradeOutputSheet.jsx`
- `src/kordynV2/domains/account/MobileExecutionScreen.jsx`
- `tests/kordyn-v2-execution-workspaces.test.mjs`

Modified:

- `src/kordynV2/domains/account/accountModel.js`
- `src/kordynV2/domains/account/account.css`
- `src/kordynV2/domains/account/index.jsx`
- `src/kordynV2/KordynV2Root.jsx`
- `src/productShell.jsx`
- `tests/kordyn-v2-account-interactions-browser.jsx`
- `tests/run-kordyn-v2-account-interactions-browser.mjs`

## What changed

- Added distinct Desktop Account workspaces for:
  - `plans`: AI trade intent, risk evidence, and approval/reject delegation.
  - `orders`: separated system `Execution` intent/control from exchange `Order` facts.
  - `fills`: immutable `Fill`, server-backed `Closed trade`, and linked `Review` evidence.
- Added APP execution list/detail flows for `plans`, `orders`, and `fills`, including focusable detail headings and Back focus restoration.
- Extended `buildAccountDomainModel()` with hostile-input-safe projections for `tradePlans`, `executionOrders`, `orders`, `fills`, trade `reviews`, and `closedTradeLifecycles`.
- Preserved Task 3 Position contract by keeping `relatedExecution.exitAction` generated through the existing `executionExitAction()` helper.
- Registered Task 4 objects in the existing shell search/selection path so Object, Context, and Trace resolve through one canonical identity.
- Added a minimal canonical `Closed trade` object backed only by source `closedTradeLifecycles[].id`.
- Added closed-trade output as a bounded sheet that only calls existing `actions.account.downloadClosedTradePoster(executionId)` when the server-backed lifecycle is reconciled and linked to one closed `Execution`.

## TDD and defects found

- Inherited RED: the Task 4 isolated suite had already been created with 15 contracts, but required modules were absent.
- Takeover RED after auditing inherited partial work: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-execution-workspaces.test.mjs` exited 1 with 11/15 passing. The current concrete failures were:
  - missing `MobileExecutionScreen.jsx`;
  - `closedTradeLifecycles: undefined` was treated as invalid instead of absent;
  - `Trade plan` canonical selection was not in the shell index;
  - APP detail traversal hit a hook outside a component render;
  - Account-owned mobile touch CSS was missing.
- Regression exposed by wider Task 1–4 batch: the new `executionOrders` projection temporarily dropped the Task 3 `relatedExecution.exitAction`; this was fixed by applying existing `executionExitAction()` after safe projection.
- Regression exposed by full `npm test`: the Task 4 primitive shell projection initially rejected existing string `forbidden` source metadata on Review rows. The final helper preserves string `forbidden`/`permissionDenied` only in the Task 4 primitive projection so existing `sourceForbidden` behavior remains intact.

## Post-review remediation

Independent Task 4 review returned Critical 0, Important 8, Minor 1. I verified all nine findings against the current code and kept remediation inside Task 4.

Addressed findings:

- I1: `Trade plan` account-impact presentation now derives bounded values from authoritative portfolio and loaded positions when deployed plans omit `plan.accountImpact`; tests no longer mask this with fixture-only `accountImpact`.
- I2: APP closed-trade poster now opens the same bounded output sheet as desktop and calls only `downloadClosedTradePoster(executionId)`.
- I3: APP plan approve/reject now uses authoritative processing/result state with disabled repeat taps and partial/failed/succeeded feedback.
- I4: explicit lifecycle/execution/fill linkage now fails closed when any present explicit identifiers conflict.
- I5: related-object controls in the production root now move to an Account workspace capable of rendering the selected `Execution`, `Order`, `Fill`, `Closed trade`, or `Review` object while preserving canonical Object/Context/Trace identity.
- I6: desktop and APP order/fill workspaces distinguish unavailable/invalid/loading/failed/forbidden/disabled/stale/degraded from authoritative loaded-empty lists.
- I7: plan action state is keyed by selected plan id so Plan A results cannot render under Plan B.
- I8: the Account browser gate now covers desktop 1440/1180 and APP 390/430, no-overflow geometry, APP approve/reject outcomes, poster tap, and real action-state transitions.
- M1: `ClosedTradeOutputSheet` uses the body as the long-content scroll container while keeping the dialog shell and focus trap stable.

Review-fix RED evidence:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-execution-workspaces.test.mjs
Result: exit 1; 19 tests; 15 passed; 4 failed.
Failures covered missing derived plan account impact, conflicting explicit lifecycle linkage, absent/invalid availability copy, and closed-trade output body scrolling.
```

```text
node tests/run-kordyn-v2-account-interactions-browser.mjs
Result: exit 1 during iterative RED runs.
Failures covered desktop Account overflow at 1440, related Execution selection not landing in a renderable Account workspace, and APP Trade plan action state never entering processing.
```

## Second post-review remediation

Second read-only Task 4 review returned Critical 0, Important 4, Minor 1. I verified all five findings against the code and kept the fix inside Task 4.

Addressed findings:

- I1: Desktop `Plan`, Desktop `Fill`/`Closed trade`, and APP `Plan` presentation now distinguish invalid, absent, adverse, and authoritative loaded-empty availability instead of collapsing invalid into "not loaded".
- I2: `KordynV2Root` now resolves the canonical selection before routing. Invalid, missing, duplicate, stale/forbidden, or ambiguous candidates do not move workspace and do not change Object/Context/Trace. Related controls therefore cannot route unless the target object is uniquely resolvable.
- I3: `Order` → `Fill` related rows now fail closed when any present `executionOrderId` or `orderId` contradicts the selected order/execution while preserving valid sibling fills.
- I4: APP closed-trade output uses an Account-owned mobile bottom sheet under the existing mobile execution surface while desktop keeps the centered modal sheet. The sheet preserves 44px controls, no horizontal overflow, the same bounded poster action, and the existing focus trap.
- M1: the browser gate now verifies mobile sheet initial focus, Shift+Tab trap, Escape close, trigger focus restoration, horizontal geometry, bottom docking, and long-content body scrolling before continuing with later APP actions.

Second review-fix RED evidence:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-execution-workspaces.test.mjs
Result: exit 1; 21 tests; 19 passed; 2 failed.
Failures covered invalid-vs-absent/loaded-empty presentation truth and contradictory Order→Fill related rows.
```

```text
node tests/run-kordyn-v2-account-interactions-browser.mjs
Result: exit 1.
Failure: invalid related Execution candidate moved the production root from plans to orders and changed selection from plan-orphan to position-1.
```

## Third post-review proof remediation

Third read-only Task 4 review left exactly Important 1: the product code was correct, but the real AccountDomain Chrome gate only proved the APP closed-trade poster bottom sheet at one mobile width. I kept the fix to test/proof/report only and did not modify product code.

Addressed proof gap:

- The real AccountDomain Chrome runner now exercises the APP closed-trade poster sheet at both `390x844` and `430x932`.
- Each width performs a real mobile viewport pass, clicks the actual APP closed-trade primary action, waits for the production `ClosedTradeOutputSheet`, verifies initial focus, horizontal no-overflow, bottom docking, long-body scroll geometry, Shift+Tab focus trap, real `downloadClosedTradePoster("execution-2")` returned state, Escape close, and trigger focus restoration.
- The runner closes the sheet before any later APP action, so it does not use synthetic clicks behind an open modal/sheet.
- No 390px product defect was exposed, so no product code was changed.

Third proof-fix RED evidence:

```text
node tests/run-kordyn-v2-account-interactions-browser.mjs
Result: exit 1.
Failure: `mobilePosterProofWidths` was undefined; expected `[390, 430]`, proving the runner had no dual-width APP poster evidence.
```

Third proof-fix GREEN evidence:

```text
node tests/run-kordyn-v2-account-interactions-browser.mjs
Result: exit 0; Kordyn V2 account production interaction browser checks passed.
```

## Authority and safety decisions

- `Trade plan` remains the deployed shell type; no new `Plan` object type was introduced.
- Plan approve/reject uses `runAuthoritativePlanAction()` and existing `actions.account.approvePlan/rejectPlan`; no second approval endpoint or optimistic success path was added.
- `Execution` and `Order` are visually and semantically separate. Exchange acceptance, fill receipt, and financial reconciliation are distinct finality facts.
- Missing closed-trade lifecycle data remains `not_loaded`/`absent`; fills are never rebuilt into lifecycle PnL in the frontend.
- Closed-trade poster output never claims translation, client-side generation, automatic Telegram delivery, or success beyond the server PNG download request result.
- The browser interaction fixture uses production-shaped data only. It does not read real credentials, secrets, API keys, personal account data, or production write endpoints.

## Impeccable detector

Ran exactly once after Task 4 UI edits:

```text
node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/kordynV2/domains/account/PlanWorkspace.jsx src/kordynV2/domains/account/OrderWorkspace.jsx src/kordynV2/domains/account/FillWorkspace.jsx src/kordynV2/domains/account/ClosedTradeOutputSheet.jsx src/kordynV2/domains/account/MobileExecutionScreen.jsx src/kordynV2/domains/account/index.jsx src/kordynV2/domains/account/account.css
[]
```

The review-fix pass intentionally did not run the detector again because the review instruction explicitly said the detector had already run once and must not be rerun.

## Verification

Fresh focused Task 4:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-execution-workspaces.test.mjs
Result: exit 0; 21/21 passed.
```

Task 4 plus legacy execution/poster compatibility:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-execution-workspaces.test.mjs tests/trade-lifecycle-boundary.test.mjs tests/okx-net-fill-classification.test.mjs tests/manual-exit-attribution.test.mjs tests/closed-trade-poster.test.mjs
Result: exit 0; 111/111 passed.
```

Task 1–4 account/state/selection/lazy/protection/normalizer/execution regression batch:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-position-workspace.test.mjs tests/position-view.test.mjs tests/position-protection-evidence.test.mjs tests/exchange-protection-accounting.test.mjs tests/position-manager-move-stop.test.mjs tests/kordyn-v2-account-model.test.mjs tests/kordyn-v2-account-actions.test.mjs tests/kordyn-v2-account-cockpit.test.mjs tests/kordyn-v2-account-interactions.test.mjs tests/kordyn-v2-ai-workspace.test.mjs tests/kordyn-v2-state-boundary.test.mjs tests/kordyn-v2-state.test.mjs tests/kordyn-v2-ai-context-selection.test.mjs tests/kordyn-v2-execution-workspaces.test.mjs tests/trade-lifecycle-boundary.test.mjs tests/okx-net-fill-classification.test.mjs tests/manual-exit-attribution.test.mjs tests/closed-trade-poster.test.mjs
Result: exit 0; 315/315 passed.
```

Prototype visual contract regression after shell projection correction:

```text
node scripts/run-tests-isolated.mjs tests/prototype-visual-contract.test.mjs
Result: exit 0; 45/45 passed.
```

Real mounted AccountDomain Chrome interaction gate:

```text
node tests/run-kordyn-v2-account-interactions-browser.mjs
Result: exit 0; Kordyn V2 account production interaction browser checks passed.
```

The Chrome gate mounts real Account production components, plus the production `KordynV2Root` shell for related-object workspace navigation, and clicks:

- Desktop `Trade plan`, `Execution`, `Order`, `Fill`, `Closed trade`, and `Review`;
- Desktop plan approval partial result;
- Desktop closed-trade output sheet and `downloadClosedTradePoster("execution-2")`;
- APP `Trade plan`, `Execution`, `Order`, `Fill`, `Closed trade`, and `Review` list/detail rows;
- APP approve processing/partial, repeat-tap disable, reject succeeded, closed-trade poster tap/download state, detail focus, Back focus restoration;
- invalid related-object rejection without workspace/selection movement;
- APP closed-trade bottom-sheet open/initial focus, Shift+Tab focus trap, real poster download returned state, Escape close, trigger focus restoration, long-content body scroll, bottom docking, and no-overflow geometry at both `390x844` and `430x932`;
- desktop 1440/1180 and APP 390/430 no-overflow geometry.

Full suite:

```text
npm test
Result: exit 0; 2033/2033 passed.
```

Lint:

```text
npm run lint
Result: exit 0.
```

Production build:

```text
npm run build
Result: exit 0; Vite built 1720 modules.
```

Diff check:

```text
git diff --check
Result: exit 0.
```

Syntax checks:

- `node --check tests/kordyn-v2-execution-workspaces.test.mjs`: exit 0.
- `node --check tests/run-kordyn-v2-account-interactions-browser.mjs`: exit 0.
- `node --check src/kordynV2/domains/account/accountModel.js`: exit 0.
- `node --check` does not support `.jsx` extension in this repo; JSX syntax was covered by ESLint and production build.

## Review status

The local task environment available to this implementer did not expose the requested `spawn_agent`/independent-reviewer tool. I therefore did not claim an independent reviewer result. The implementation is ready for a separate read-only review against the final Task 4 commit.

## Known follow-up

- Task 5 remains the owner of screenshot evidence, state/capability gates, and accumulated Account-domain visual capture.
- No unresolved Task 4 code/test defect is known from the verification above.
