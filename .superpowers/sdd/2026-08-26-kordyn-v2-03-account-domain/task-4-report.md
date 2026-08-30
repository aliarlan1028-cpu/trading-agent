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

No subsequent product UI code changes were retained after this detector run.

## Verification

Fresh focused Task 4:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-execution-workspaces.test.mjs
Result: exit 0; 15/15 passed.
```

Task 4 plus legacy execution/poster compatibility:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-execution-workspaces.test.mjs tests/trade-lifecycle-boundary.test.mjs tests/okx-net-fill-classification.test.mjs tests/manual-exit-attribution.test.mjs tests/closed-trade-poster.test.mjs
Result: exit 0; 105/105 passed.
```

Task 1–4 account/state/selection/lazy/protection/normalizer/execution regression batch:

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-position-workspace.test.mjs tests/position-view.test.mjs tests/position-protection-evidence.test.mjs tests/exchange-protection-accounting.test.mjs tests/position-manager-move-stop.test.mjs tests/kordyn-v2-account-model.test.mjs tests/kordyn-v2-account-actions.test.mjs tests/kordyn-v2-account-cockpit.test.mjs tests/kordyn-v2-account-interactions.test.mjs tests/kordyn-v2-ai-workspace.test.mjs tests/kordyn-v2-state-boundary.test.mjs tests/kordyn-v2-state.test.mjs tests/kordyn-v2-ai-context-selection.test.mjs tests/kordyn-v2-execution-workspaces.test.mjs tests/trade-lifecycle-boundary.test.mjs tests/okx-net-fill-classification.test.mjs tests/manual-exit-attribution.test.mjs tests/closed-trade-poster.test.mjs
Result: exit 0; 309/309 passed.
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

The Chrome gate mounts real `AccountDomain` production components and clicks:

- Desktop `Trade plan`, `Execution`, `Order`, `Fill`, `Closed trade`, and `Review`;
- Desktop plan approval partial result;
- Desktop closed-trade output sheet and `downloadClosedTradePoster("execution-2")`;
- APP `Trade plan`, `Execution`, `Order`, `Fill`, `Closed trade`, and `Review` list/detail rows;
- APP detail focus and Back focus restoration.

Full suite:

```text
npm test
Result: exit 0; 2027/2027 passed.
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
