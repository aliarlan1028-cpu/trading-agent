# KORDYN V2 Account and Trading Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement real market, account, position, plan, order, fill, protection, reconciliation, review-link, and supported result-output experiences for Desktop and APP.

**Architecture:** Reuse the authoritative projections in `src/viewData.js`, canonical position identity, and `requestExecutionExit()` instead of reconstructing financial lifecycles in the UI. Desktop uses cockpit/registry/inspector composition; APP uses list/detail and protected full-screen flows from the same model and actions.

**Tech Stack:** React 18, Vite lazy domain chunk, lightweight-charts through existing chart boundaries, plain scoped CSS, Node `node:test`, CDP Chrome runner.

**Spec:** `docs/superpowers/specs/2026-08-26-kordyn-concept-faithful-product-rebuild-design.md`

## Global Constraints

- Preserve the program constraints and Plan 01 interfaces.
- This plan owns exactly `live.overview`, `live.market`, `live.account`, `live.positions`, `live.execution`, `live.orders`, `live.fills`, `live.protection`, `live.reconcile-status`, `live.review-status`, and `live.closed-trade-poster`.
- Market data, account snapshots, execution orders, fills, closed-trade lifecycles, and reviews remain distinct authoritative sources.
- Missing financial values render `Unavailable`, never client-generated zero.
- Exit requests retain `requestExecutionExit()` state checks, exchange-finality language, confirmation, and 409 refresh behavior.
- APP is implemented in the same task as each Desktop workspace.

---

### Task 1: Account/trading view model and actions

**Files:**
- Create: `src/kordynV2/domains/account/accountModel.js`
- Create: `src/kordynV2/domains/account/accountActions.js`
- Modify: `src/kordynV2/actions/createV2Actions.js`
- Create: `tests/kordyn-v2-account-model.test.mjs`
- Create: `tests/kordyn-v2-account-actions.test.mjs`

**Interfaces:**
- Consumes: `buildMarketRows()`, `buildPositionView()`, `buildExecutionView()` from `src/viewData.js`; `canonicalPositionIdentity()` from `src/productShell.jsx`; `executionExitAction()` and `requestExecutionExit()` from `src/executionExit.js`.
- Produces: `buildAccountDomainModel(data)` and `createAccountActions(deps)` under `createV2Actions().account`.

- [ ] **Step 1: Write failing financial-truth tests**

```js
test("account model preserves authoritative totals and canonical position identity", () => {
  const model = buildAccountDomainModel({
    portfolio: { totalEquityUsdt: 10240.5, availableMarginUsdt: 7130 },
    positions: [{ positionId: "p-1", symbol: "BTC/USDT", quantity: 0.01, mark: 60000, unrealizedPnl: 12 }],
    tradeDataStatus: { fillTotal: 80 }, fills: [{ id: "visible-fill" }]
  });
  assert.equal(model.truth.equity, 10240.5);
  assert.equal(model.positions[0].id, "p-1");
  assert.equal(model.execution.totals.fills, 80);
  assert.equal(model.fills.length, 1);
});

test("unloaded lifecycle data is not reconstructed from bounded fills", () => {
  const model = buildAccountDomainModel({ fills: [{ id: "f-1", kind: "close", realizedPnl: 9 }] });
  assert.equal(model.execution.lifecycleState, "not_loaded");
  assert.deepEqual(model.execution.closedTrades, []);
});
```

- [ ] **Step 2: Write failing action-delegation tests**

```js
test("account exit delegates to the deployed execution exit contract", async () => {
  const calls = [];
  const account = createAccountActions({ action: async (...args) => { calls.push(args); return { ok: true }; } });
  await account.exitExecutionOrder({ id: "eo-1", status: "entry_pending", symbol: "BTC/USDT" }, "desktop");
  assert.deepEqual(calls[0], ["/api/execution-orders/eo-1/close", { reason: "manual_ui", intent: "cancel_entry", expectedStatus: "entry_pending" }]);
});

test("reconcile uses the real manual UI mode", async () => {
  const calls = [];
  const account = createAccountActions({ action: async (...args) => calls.push(args), confirm: async () => true });
  await account.reconcile();
  assert.deepEqual(calls[0], ["/api/reconciler/run", { mode: "manual_ui" }]);
});
```

- [ ] **Step 3: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-account-model.test.mjs tests/kordyn-v2-account-actions.test.mjs`

Expected: FAIL with missing account V2 modules.

- [ ] **Step 4: Implement model and actions**

Expose actions for watchlist add/remove, reconciliation, execution-order exit, plan approve/reject by delegating to `actions.ai`, review navigation, and closed-trade output. Do not add a direct position mutation that has no deployed endpoint.

- [ ] **Step 5: Run GREEN and financial fact regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-account-model.test.mjs tests/kordyn-v2-account-actions.test.mjs tests/view-data-parity.test.mjs tests/position-fact-authority.test.mjs tests/execution-safety-regression.test.mjs tests/exchange-contract.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/kordynV2/domains/account/accountModel.js src/kordynV2/domains/account/accountActions.js src/kordynV2/actions/createV2Actions.js tests/kordyn-v2-account-model.test.mjs tests/kordyn-v2-account-actions.test.mjs
git commit -m "feat: model V2 account and execution truth"
```

### Task 2: Account and market cockpit on Desktop and APP

**Files:**
- Create: `src/kordynV2/domains/account/index.jsx`
- Create: `src/kordynV2/domains/account/AccountWorkspace.jsx`
- Create: `src/kordynV2/domains/account/MarketWorkspace.jsx`
- Create: `src/kordynV2/domains/account/MobileAccountScreen.jsx`
- Create: `src/kordynV2/domains/account/MobileMarketScreen.jsx`
- Create: `src/kordynV2/domains/account/MarketInstrumentPicker.jsx`
- Create: `src/kordynV2/domains/account/account.css`
- Modify: `src/kordynV2/KordynV2Root.jsx`
- Create: `tests/kordyn-v2-account-cockpit.test.mjs`

**Interfaces:**
- Consumes: `model.truth`, `model.markets`, selected Market, freshness/reconciliation state, and watchlist/reconcile actions.
- Produces: Full Truth Bar workspaces and canonical Market/Account selection.

- [ ] **Step 1: Write the failing cockpit test**

```js
test("account and market surfaces show authoritative truth and source freshness", () => {
  const account = renderToStaticMarkup(<AccountWorkspace model={model} actions={actions} onSelect={() => {}} />);
  const market = renderToStaticMarkup(<MarketWorkspace model={model} actions={actions} onSelect={() => {}} />);
  assert.match(account, /data-kordyn-v2-truth-mode="full"/);
  assert.match(account, /对账|Reconciliation/);
  assert.match(market, /data-kordyn-v2-object-type="Market"/);
  assert.match(market, /数据截至|As of/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-account-cockpit.test.mjs`

Expected: FAIL on missing presenters.

- [ ] **Step 3: Implement Desktop cockpit and APP list/detail**

Desktop preserves the approved dark shell and Full Truth Bar, with the selected market as a dominant analytic field and an account/reconciliation inspector. APP makes instrument selection and account health separate drill-down screens; no desktop chart/table shrinkage.

- [ ] **Step 4: Run GREEN and chart/market regression**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-account-cockpit.test.mjs tests/market-routes.test.mjs tests/market-source-freshness.test.mjs tests/account-snapshot-equity.test.mjs && npm run build`

Expected: PASS; `account.css` is emitted only with the lazy account domain.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/account src/kordynV2/KordynV2Root.jsx tests/kordyn-v2-account-cockpit.test.mjs
git commit -m "feat: build V2 account and market cockpit"
```

### Task 3: Position truth and protection workspaces

**Files:**
- Create: `src/kordynV2/domains/account/PositionWorkspace.jsx`
- Create: `src/kordynV2/domains/account/PositionRegistry.jsx`
- Create: `src/kordynV2/domains/account/PositionInspector.jsx`
- Create: `src/kordynV2/domains/account/MobilePositionScreen.jsx`
- Modify: `src/kordynV2/domains/account/index.jsx`
- Modify: `src/kordynV2/domains/account/account.css`
- Create: `tests/kordyn-v2-position-workspace.test.mjs`

**Interfaces:**
- Consumes: `model.positions`, protection evidence, related execution orders/risk incidents, canonical selection, and `actions.account.exitExecutionOrder()`.
- Produces: Position/Execution order canonical selection and the approved registry/inspector composition.

- [ ] **Step 1: Write the failing identity and safety test**

```js
test("position rows use canonical positionId when id is absent", () => {
  const html = renderToStaticMarkup(<PositionWorkspace model={{ ...model, positions: [{ positionId: "p-1", symbol: "BTC/USDT" }] }} actions={actions} onSelect={() => {}} />);
  assert.match(html, /data-kordyn-v2-object-id="p-1"/);
  assert.match(html, /data-kordyn-v2-object-type="Position"/);
});

test("position UI does not offer an unimplemented direct mutation", () => {
  const source = readFileSync(new URL("../src/kordynV2/domains/account/PositionInspector.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\/api\/positions/);
  assert.match(source, /exitExecutionOrder/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-position-workspace.test.mjs`

Expected: FAIL on missing position components.

- [ ] **Step 3: Reproduce the approved position workspace**

Match `desktop-account-position.png` at `1440x900`: position registry density, selected position hierarchy, PnL/exposure/protection facts, evidence linkage, and bounded protected action area. APP uses a position list then a full-screen detail with the same facts and action eligibility.

- [ ] **Step 4: Run GREEN and position/exchange regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-position-workspace.test.mjs tests/position-view.test.mjs tests/position-protection-evidence.test.mjs tests/exchange-protection-accounting.test.mjs tests/position-manager-move-stop.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/account tests/kordyn-v2-position-workspace.test.mjs
git commit -m "feat: build V2 position truth workspace"
```

### Task 4: Plans, orders, fills, review links, and closed-trade output

**Files:**
- Create: `src/kordynV2/domains/account/PlanWorkspace.jsx`
- Create: `src/kordynV2/domains/account/OrderWorkspace.jsx`
- Create: `src/kordynV2/domains/account/FillWorkspace.jsx`
- Create: `src/kordynV2/domains/account/ClosedTradeOutputSheet.jsx`
- Create: `src/kordynV2/domains/account/MobileExecutionScreen.jsx`
- Modify: `src/kordynV2/domains/account/index.jsx`
- Modify: `src/kordynV2/domains/account/account.css`
- Create: `tests/kordyn-v2-execution-workspaces.test.mjs`

**Interfaces:**
- Consumes: authoritative plan, execution order, fill, closed lifecycle, performance, review status, and poster result models.
- Produces: separate Plan, Order, Fill, Closed trade, and Review navigation identities.

- [ ] **Step 1: Write the failing object-separation test**

```js
test("execution surfaces keep plan order fill and review identities separate", () => {
  const plan = renderToStaticMarkup(<PlanWorkspace model={model} actions={actions} onSelect={() => {}} />);
  const order = renderToStaticMarkup(<OrderWorkspace model={model} actions={actions} onSelect={() => {}} />);
  const fill = renderToStaticMarkup(<FillWorkspace model={model} actions={actions} onSelect={() => {}} />);
  assert.match(plan, /data-kordyn-v2-object-type="Plan"/);
  assert.match(order, /data-kordyn-v2-object-type="Order"/);
  assert.match(fill, /data-kordyn-v2-object-type="Fill"/);
  assert.doesNotMatch(fill, /data-kordyn-v2-object-type="Position"/);
});
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-execution-workspaces.test.mjs`

Expected: FAIL on missing workspaces.

- [ ] **Step 3: Implement the ledgers and protected action/result states**

Orders show exchange acceptance separately from fill/reconciliation finality. Fills link to a closed-trade review only when the authoritative review exists. Closed-trade output uses the same current-style bilingual PNG boundary as the AI output flow and never implies automatic delivery when no production delivery result exists.

- [ ] **Step 4: Run GREEN and execution lifecycle regressions**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-execution-workspaces.test.mjs tests/trade-lifecycle-boundary.test.mjs tests/okx-net-fill-classification.test.mjs tests/manual-exit-attribution.test.mjs tests/closed-trade-poster.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/kordynV2/domains/account tests/kordyn-v2-execution-workspaces.test.mjs
git commit -m "feat: add V2 plans orders fills and results"
```

### Task 5: Account real-state, browser, capability, and visual gates

**Files:**
- Create: `tests/kordyn-v2-account-browser.html`
- Create: `tests/kordyn-v2-account-browser.jsx`
- Create: `tests/run-kordyn-v2-account-browser.mjs`
- Create: `tests/kordyn-v2-account-states.test.mjs`
- Create: `src/kordynV2/domains/account/capabilitySurfaces.js`
- Create: `src/kordynV2/domains/account/stateSurfaces.js`
- Modify: `docs/kordyn-v2-evidence.md`

**Interfaces:**
- Consumes: real V2 account components, shared fixtures, concept manifest, and comparison script.
- Produces: `ACCOUNT_CAPABILITY_SURFACES`, `ACCOUNT_STATE_SURFACES`, 11/11 capability evidence, real click/selection evidence, protected exit/reconcile evidence, state evidence, and visual comparisons.

- [ ] **Step 1: Write the failing capability/state gate**

```js
test("account domain owns all eleven live capabilities", () => {
  const ids = DEPLOYED_FEATURES.filter((row) => row.id.startsWith("live.")).map((row) => row.id);
  assert.equal(ids.length, 11);
  for (const id of ids) assert.ok(ACCOUNT_CAPABILITY_SURFACES[id], id);
});
```

Add this explicit 13-state gate, with stale account truth carrying source/time and partial execution carrying separate completed/failed effects:

```js
for (const state of ["loading", "empty", "processing", "stale", "degraded", "failed", "forbidden", "disabled", "approval", "partial", "no-result", "long-content", "large-list"]) {
  test(`account renders ${state} truthfully`, () => {
    const renderState = ACCOUNT_STATE_SURFACES[state];
    assert.equal(typeof renderState, "function", state);
    assertStateContract(renderState(accountStateFixture), state);
  });
}
```

- [ ] **Step 2: Run RED**

Run: `node scripts/run-tests-isolated.mjs tests/kordyn-v2-account-states.test.mjs`

Expected: FAIL because account capability/state surfaces are not registered.

- [ ] **Step 3: Implement real component interactions in Chrome**

At Desktop and APP sizes, click Market, Account, Position, Plan, Order, Fill, and Review links. Assert each click changes root selected ID/type and matching Context/Proof identity. Exercise reconciliation and an execution exit with stubbed authoritative pending/failure results; no success label may appear before a success result.

- [ ] **Step 4: Capture, compare, and run focused verification**

```bash
node scripts/run-tests-isolated.mjs tests/kordyn-v2-account-model.test.mjs tests/kordyn-v2-account-actions.test.mjs tests/kordyn-v2-account-cockpit.test.mjs tests/kordyn-v2-position-workspace.test.mjs tests/kordyn-v2-execution-workspaces.test.mjs tests/kordyn-v2-account-states.test.mjs
KORDYN_V2_SCREENSHOT_DIR=.impeccable/review/kordyn-v2/account node tests/run-kordyn-v2-account-browser.mjs
node scripts/compare-kordyn-v2-concepts.mjs --screenshots .impeccable/review/kordyn-v2/account --output .impeccable/review/kordyn-v2/account-compare --scope account
node tests/run-kordyn-v2-performance-build.mjs
git diff --check
```

Expected: all commands exit `0`; `desktop-account-position.png` has a normalized 1440 comparison and 1180 adaptation evidence; APP 390/430 account flows have no overflow.

- [ ] **Step 5: Review and commit**

Open position/account comparisons and APP screenshots. Record the 11/11 capability routes, source/freshness states, and remaining differences in `docs/kordyn-v2-evidence.md`.

```bash
git add src/kordynV2/domains/account/capabilitySurfaces.js src/kordynV2/domains/account/stateSurfaces.js tests/kordyn-v2-account-browser.html tests/kordyn-v2-account-browser.jsx tests/run-kordyn-v2-account-browser.mjs tests/kordyn-v2-account-states.test.mjs docs/kordyn-v2-evidence.md .impeccable/review/kordyn-v2/account .impeccable/review/kordyn-v2/account-compare
git commit -m "test: verify KORDYN V2 account domain"
```
