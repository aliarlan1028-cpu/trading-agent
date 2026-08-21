# System Trade Provenance B1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish one server-owned system-trade provenance boundary so fully manual OKX trades remain raw evidence but cannot enter system performance, review, learning, protection, poster, or trade-history consumers, while a uniquely evidenced manual exit of a system-opened trade remains one system lifecycle tagged `manual_exit`.

**Architecture:** Extract the existing pure lifecycle aggregator into `tradeLifecycle.mjs`, then layer a pure `systemTradeProjection.mjs` classifier/projection above it. Execution and OKX ingestion stamp server-owned attribution metadata; all B1 system consumers read the projection, while raw reconciliation and full-account risk continue reading exchange facts. B1 does not change daily/weekly PnL accounting; that is the separately reviewed B2 plan.

**Tech Stack:** Node.js 22 ESM, built-in `node:test`/`node:assert`, existing JSON-document store backed by SQLite, existing isolated test runner, ESLint, Vite.

**Spec:** `docs/superpowers/specs/2026-08-22-system-trade-provenance-design.md`

## Global Constraints

- Work only on `codex/fix-system-trade-provenance`, based on reviewed main `5f2a3815b9a738c9297eca646c296fc25a35f178` plus the approved design/plan commits.
- Preserve raw `db.orders`, `db.fills`, exchange positions, exchange trade IDs, fees, PnL, timestamps, and forensic/reconciliation evidence.
- A caller/API field alone must never authorize `scope: "system"`; persisted execution/plan/binding evidence must agree.
- Fully manual trades remain excluded from system performance, review, learning, optimization, protection, posters, and system trade history.
- A uniquely evidenced manual exit of a system-opened trade remains a system lifecycle with `exitMode: "manual_exit"`.
- Ambiguous, conflicting, or mixed ownership fails closed as `attribution_pending`; never proportionally allocate mixed PnL.
- Manual positions remain included in account equity, available margin, exposure, concentration, liquidation, sizing, OMS, and reconciliation.
- Do not modify `realizedPnlSince`, `unrealizedPnl`, accounting baselines, daily/weekly PnL budgets, risk thresholds, sizing formulas, OMS submission semantics, exchange request behavior, schema, dependencies, or frontend code in B1.
- No auto-retry, bulk historical rewrite, raw-fill deletion, API shape change, or unrelated refactor.
- Every test command must use `npm test -- ...` so storage remains inside the isolated runner.
- Each task ends at a reviewable checkpoint. Do not merge, push, deploy, or start B2 from this plan.

## File Structure

### New production modules

- `server/tradeLifecycle.mjs` — pure lifecycle identity, context resolution, cost aggregation, and financial-completeness helpers extracted without behavioral change.
- `server/systemTradeProjection.mjs` — the only implementation source for fill classification, system-only fill/lifecycle projection, external manual-exit matching, and manual-exit closure evidence.

### New test support

- `tests/helpers/system-trade-fixtures.mjs` — creates positively evidenced execution orders, plans, and reconciled system fills; tests must opt into system provenance explicitly.
- `tests/system-trade-projection.test.mjs` — classifier/projection/immutability/legacy evidence tests.
- `tests/manual-exit-attribution.test.mjs` — OKX external close, partial/final exit, reversal, ambiguity, duplicate, and execution-settlement tests.
- `tests/system-trade-consumer-boundary.test.mjs` — observable consumer exclusion/inclusion and static dependency-boundary tests.

### Existing production modules changed

- `server/tradeReviewQueue.mjs` — consume the system projection and compatibility re-export pure lifecycle helpers.
- `server/realtimeManager.mjs` — stamp external OKX fills through the provenance classifier before insertion.
- `server/executionEngine.mjs` — stamp system fills, recognize attributed manual-exit closure evidence without duplicating fills, and keep raw funding reconciliation intentional.
- `server/accounting.mjs` — migrate `performanceReport()` only; leave B2 accounting functions unchanged.
- `server/tradeProtections.mjs`, `server/behaviorProfile.mjs`, `server/decisionCalibration.mjs`, `server/knowledgeSkills.mjs`, `server/professionalAnalytics.mjs`, `server/reviewEngine.mjs`, `server/reviewLearning.mjs`, `server/ownerReviewLoop.mjs`, `server/strategyBoard.mjs`, `server/strategyContracts.mjs`, `server/strategyProducts.mjs` — use system lifecycles for review/learning/optimization/protection.
- `server/coreOverview.mjs`, `server/overviewView.mjs`, `server/chatPresentation.mjs`, `server/telegramNotifier.mjs`, `server/routes/posters.mjs` — use system fills/lifecycles for system history and posters.

### Existing tests changed only where provenance becomes explicit

- `tests/financial-fixtures.mjs` and affected performance/review/strategy/Telegram tests — add real execution/plan evidence using the new fixture helper; never weaken the production classifier to preserve under-specified fixtures.

---

### Task 1: Extract the Pure Trade Lifecycle Leaf

**Files:**
- Create: `server/tradeLifecycle.mjs`
- Modify: `server/tradeReviewQueue.mjs:1-222`
- Create: `tests/trade-lifecycle-boundary.test.mjs`

**Interfaces:**
- Consumes: `recordedFeeCost(fill)` from `server/financialValues.mjs`.
- Produces: `tradeLifecycleKey(fill)`, `sameTradeLifecycle(left, right)`, `findTradeEntryFill(fills, reference)`, `resolveTradeContext(db, source)`, `groupClosedTradeLifecycles(fills, options)`, and `isFinanciallyReconciledLifecycle(lifecycle)` from `server/tradeLifecycle.mjs`.
- Compatibility: `server/tradeReviewQueue.mjs` re-exports the exact same function objects.

- [ ] **Step 1: Add a compatibility-identity test before moving code**

Create `tests/trade-lifecycle-boundary.test.mjs` with a financially complete entry/partial-close/final-close fixture and these assertions:

```js
import assert from "node:assert/strict";
import test from "node:test";
import * as lifecycle from "../server/tradeLifecycle.mjs";
import {
  groupClosedTradeLifecycles as compatibilityGroup,
  sameTradeLifecycle as compatibilitySame
} from "../server/tradeReviewQueue.mjs";

test("tradeReviewQueue compatibility exports share the leaf implementation", () => {
  assert.equal(compatibilityGroup, lifecycle.groupClosedTradeLifecycles);
  assert.equal(compatibilitySame, lifecycle.sameTradeLifecycle);
});

test("leaf lifecycle aggregation preserves partial-close net financial semantics", () => {
  const rows = [
    { id: "entry", kind: "entry", executionOrderId: "exec-1", feeUsdt: 1, estimatedFee: false, createdAt: "2026-08-01T00:00:00Z" },
    { id: "part", kind: "close", executionOrderId: "exec-1", partial: true, realizedPnl: 4, feeUsdt: .2, estimatedFee: false, fundingFeeUsdt: 0, fundingReconciled: true, createdAt: "2026-08-01T01:00:00Z" },
    { id: "final", kind: "close", executionOrderId: "exec-1", realizedPnl: 6, feeUsdt: .3, estimatedFee: false, fundingFeeUsdt: -.5, fundingReconciled: true, createdAt: "2026-08-01T02:00:00Z" }
  ];
  const [group] = lifecycle.groupClosedTradeLifecycles(rows);
  assert.deepEqual({ key: group.key, gross: group.realizedPnl, entryFee: group.entryFeeUsdt, closeFee: group.feeUsdt, funding: group.fundingFeeUsdt, net: group.netRealizedPnl },
    { key: "exec-1", gross: 10, entryFee: 1, closeFee: .5, funding: -.5, net: 8 });
});
```

- [ ] **Step 2: Run the test and record RED**

Run: `npm test -- tests/trade-lifecycle-boundary.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `server/tradeLifecycle.mjs`.

- [ ] **Step 3: Move the pure helpers without changing their bodies**

Move lines implementing the six produced interfaces from `tradeReviewQueue.mjs` into `tradeLifecycle.mjs`. Keep `finite()` private in the leaf and import `recordedFeeCost` there. In `tradeReviewQueue.mjs`, use:

```js
import {
  findTradeEntryFill,
  groupClosedTradeLifecycles,
  isFinanciallyReconciledLifecycle,
  resolveTradeContext,
  sameTradeLifecycle,
  tradeLifecycleKey
} from "./tradeLifecycle.mjs";

export {
  findTradeEntryFill,
  groupClosedTradeLifecycles,
  isFinanciallyReconciledLifecycle,
  resolveTradeContext,
  sameTradeLifecycle,
  tradeLifecycleKey
} from "./tradeLifecycle.mjs";
```

Leave review-specific strategy-ref and queue functions in `tradeReviewQueue.mjs`.

- [ ] **Step 4: Run leaf and existing review integrity tests**

Run: `npm test -- tests/trade-lifecycle-boundary.test.mjs tests/performance-review-integrity.test.mjs tests/trade-protections.test.mjs`

Expected: PASS with identical lifecycle totals and compatibility identity.

- [ ] **Step 5: Check the import graph for the intended one-way leaf**

Run: `rg -n 'from "\./(tradeReviewQueue|tradeLifecycle)\.mjs"' server | sort`

Expected: `tradeLifecycle.mjs` imports neither `tradeReviewQueue.mjs` nor any review/accounting/route module.

- [ ] **Step 6: Commit the pure extraction checkpoint**

```bash
git add server/tradeLifecycle.mjs server/tradeReviewQueue.mjs tests/trade-lifecycle-boundary.test.mjs
git commit -m "refactor: extract trade lifecycle leaf"
```

### Task 2: Add the System Trade Classifier and Projection

**Files:**
- Create: `server/systemTradeProjection.mjs`
- Create: `tests/helpers/system-trade-fixtures.mjs`
- Create: `tests/system-trade-projection.test.mjs`

**Interfaces:**
- Consumes: lifecycle functions from Task 1 and canonical symbol/direction helpers from `server/positionIdentity.mjs`.
- Produces:
  - `classifyTradeFill(db, fill) -> { scope, origin, exitMode, executionOrderId, planId, method, reason, evidence }`
  - `projectSystemTradeFill(db, fill) -> projected clone | null`
  - `systemTradeFills(db, { fills = db.fills } = {}) -> projected fill[]`
  - `groupSystemClosedTradeLifecycles(db, { fills = db.fills, ...lifecycleOptions } = {}) -> lifecycle[]`
  - `buildExecutionFillAttribution(db, executionOrder, fill) -> tradeAttribution`
  - `buildExternalFillAttribution(db, fill) -> tradeAttribution`
  - `TRADE_ATTRIBUTION_SCHEMA_VERSION = 1`

- [ ] **Step 1: Write RED tests for system, manual, pending, and immutable projection**

Create `tests/system-trade-projection.test.mjs` with explicit database facts. The key cases are:

```js
test("fully manual exchange lifecycle stays raw but is absent from system projection", () => {
  const db = baseDb();
  db.fills = financiallyCompletePair({ executionOrderId: null, planId: null, origin: "external" });
  const before = structuredClone(db.fills);
  assert.equal(systemTradeFills(db).length, 0);
  assert.equal(groupSystemClosedTradeLifecycles(db).length, 0);
  assert.deepEqual(db.fills, before);
});

test("persisted execution and plan evidence admit one system lifecycle", () => {
  const db = systemDb({ executionOrderId: "exec-1", planId: "plan-1" });
  assert.equal(systemTradeFills(db).length, 2);
  assert.equal(groupSystemClosedTradeLifecycles(db)[0].key, "exec-1");
});

test("forged system metadata without matching persisted execution fails closed", () => {
  const db = baseDb();
  db.fills = financiallyCompletePair({
    executionOrderId: "missing",
    tradeAttribution: { schemaVersion: 1, scope: "system", executionOrderId: "missing", planId: "missing" }
  });
  assert.equal(systemTradeFills(db).length, 0);
  assert.equal(classifyTradeFill(db, db.fills[0]).scope, "attribution_pending");
});

test("binding conflict excludes a superficially linked fill", () => {
  const db = systemDb({ executionOrderId: "exec-1", planId: "plan-1", accountId: "account-a" });
  db.fills[0].accountId = "account-b";
  assert.equal(classifyTradeFill(db, db.fills[0]).reason, "trade_account_binding_conflict");
});
```

The file must also cover symbol, environment, direction, plan, and exchange-order identity conflicts plus an unmodified legacy positive-provenance row.

- [ ] **Step 2: Run classifier tests and record RED**

Run: `npm test -- tests/system-trade-projection.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `systemTradeProjection.mjs`.

- [ ] **Step 3: Add explicit system-trade fixtures**

Create `tests/helpers/system-trade-fixtures.mjs` with these concrete helpers:

```js
export function addSystemExecution(db, options = {}) {
  const executionOrder = {
    id: options.executionOrderId || "exec-1",
    planId: options.planId || "plan-1",
    exchange: "OKX",
    accountId: options.accountId || "account-a",
    environment: options.environment || "production",
    symbol: options.symbol || "BTC/USDT",
    direction: options.direction || "long",
    status: options.status || "closed",
    filledQuantity: options.quantity || .01,
    entryFilledAt: options.entryFilledAt || "2026-08-01T00:00:00.000Z"
  };
  db.executionOrders ||= [];
  db.tradePlans ||= [];
  db.executionOrders.push(executionOrder);
  db.tradePlans.push({ id: executionOrder.planId, symbol: executionOrder.symbol, direction: executionOrder.direction });
  return executionOrder;
}

export function stampFixtureSystemAttribution(fill, executionOrder) {
  fill.executionOrderId = executionOrder.id;
  fill.planId = executionOrder.planId;
  fill.tradePlanId = executionOrder.planId;
  fill.tradeAttribution = {
    schemaVersion: 1,
    scope: "system",
    origin: "execution_engine",
    exitMode: fill.kind === "close" ? "system_exit" : null,
    executionOrderId: executionOrder.id,
    planId: executionOrder.planId,
    method: "execution_writer",
    reason: null,
    evidence: { accountId: executionOrder.accountId, environment: executionOrder.environment, exchangeOrderId: fill.exchangeOrderId || null, exchangeTradeId: fill.exchangeTradeId || null, matchedEntryFillIds: [], attributedQuantity: Number(fill.quantity || 0) || null },
    attributedAt: fill.createdAt || "2026-08-01T00:00:00.000Z"
  };
  return fill;
}
```

- [ ] **Step 4: Implement fail-closed validation and projected clones**

Implement `systemTradeProjection.mjs` so projected manual exits copy their authoritative execution/plan IDs into the projected clone only:

```js
export function projectSystemTradeFill(db, fill) {
  const attribution = classifyTradeFill(db, fill);
  if (attribution.scope !== "system") return null;
  return {
    ...fill,
    executionOrderId: attribution.executionOrderId,
    planId: attribution.planId,
    tradePlanId: attribution.planId,
    tradeAttribution: structuredClone(attribution)
  };
}

export function systemTradeFills(db, options = {}) {
  const fills = options.fills || db.fills || [];
  return fills.map((fill) => projectSystemTradeFill(db, fill)).filter(Boolean);
}

export function groupSystemClosedTradeLifecycles(db, options = {}) {
  const { fills = db.fills || [], ...lifecycleOptions } = options;
  return groupClosedTradeLifecycles(systemTradeFills(db, { fills }), lifecycleOptions);
}
```

Validation must compare only populated facts, reject conflicts, require a persisted execution order, and require a matching plan when the execution order has a plan ID. Do not mutate `db` or `fill` during reads.

- [ ] **Step 5: Run projection tests GREEN**

Run: `npm test -- tests/system-trade-projection.test.mjs tests/trade-lifecycle-boundary.test.mjs`

Expected: PASS, including raw-fill deep-equality after projection.

- [ ] **Step 6: Commit the classifier checkpoint**

```bash
git add server/systemTradeProjection.mjs tests/helpers/system-trade-fixtures.mjs tests/system-trade-projection.test.mjs
git commit -m "feat: add system trade provenance projection"
```

### Task 3: Stamp New System and External Fills at Their Authoritative Writers

**Files:**
- Modify: `server/executionEngine.mjs:2367-2452`
- Modify: `server/realtimeManager.mjs:429-537,669-735`
- Modify: `tests/okx-realtime-binding.test.mjs`
- Modify: `tests/exchange-protection-accounting.test.mjs`

**Interfaces:**
- Consumes: `buildExecutionFillAttribution()` and `buildExternalFillAttribution()` from Task 2.
- Produces: every newly written execution fill has authoritative system attribution; every newly written unmatched external OKX fill has explicit manual/pending attribution.

- [ ] **Step 1: Add RED assertions to the authoritative writer tests**

Extend the external-fill test:

```js
assert.deepEqual({
  scope: db.fills[0].tradeAttribution.scope,
  origin: db.fills[0].tradeAttribution.origin,
  executionOrderId: db.fills[0].tradeAttribution.executionOrderId
}, { scope: "manual", origin: "external_exchange", executionOrderId: null });
```

Extend a `recordFill`-driven execution test to assert:

```js
assert.deepEqual({
  scope: fill.tradeAttribution.scope,
  origin: fill.tradeAttribution.origin,
  executionOrderId: fill.tradeAttribution.executionOrderId,
  planId: fill.tradeAttribution.planId
}, { scope: "system", origin: "execution_engine", executionOrderId: execution.id, planId: execution.planId });
```

- [ ] **Step 2: Run writer tests and record RED**

Run: `npm test -- tests/okx-realtime-binding.test.mjs tests/exchange-protection-accounting.test.mjs`

Expected: FAIL because `tradeAttribution` is absent.

- [ ] **Step 3: Stamp system fills inside `recordFill()`**

Build the fill object first, call `buildExecutionFillAttribution(db, executionOrder, fill)`, assign the result to `fill.tradeAttribution`, then insert the same object. Do not duplicate the execution/plan matching logic inside `executionEngine.mjs`.

- [ ] **Step 4: Stamp every external OKX component before insertion**

In both normal and net-component paths, use one local insertion helper:

```js
function insertExternalFill(db, fill) {
  fill.tradeAttribution = buildExternalFillAttribution(db, fill);
  db.fills.unshift(fill);
  return fill;
}
```

Call it for each external component. Existing authoritative `tradeId` deduplication remains unchanged.

- [ ] **Step 5: Verify writer paths GREEN and deduplication unchanged**

Run: `npm test -- tests/okx-realtime-binding.test.mjs tests/exchange-protection-accounting.test.mjs tests/okx-net-fill-classification.test.mjs`

Expected: PASS; duplicate trade IDs still create one raw fill and all raw exchange fields remain identical.

- [ ] **Step 6: Commit the writer checkpoint**

```bash
git add server/executionEngine.mjs server/realtimeManager.mjs tests/okx-realtime-binding.test.mjs tests/exchange-protection-accounting.test.mjs
git commit -m "feat: stamp trade provenance at fill writers"
```

### Task 4: Attribute and Settle Deterministic Manual Exits

**Files:**
- Modify: `server/systemTradeProjection.mjs`
- Modify: `server/executionEngine.mjs:1037-1057,1158-1190,1309-1390,2170-2269`
- Modify: `server/realtimeManager.mjs:491-536`
- Create: `tests/manual-exit-attribution.test.mjs`

**Interfaces:**
- Produces:
  - `resolveManualExitAttribution(db, fill) -> { status: "matched" | "manual" | "pending", reason, executionOrderId, planId, matchedEntryFillIds, remainingQuantity, partial }`
  - `buildAttributedManualExitClosure(db, executionOrder) -> { complete, reason, fills, quantity, weightedPrice, realizedPnl, feeUsdt, closedAt, tradeIds }`
- `reconcilePendingClose()` consumes complete attributed-manual-exit evidence without creating a second close fill.

- [ ] **Step 1: Write RED tests for exact, partial/final, and reversal attribution**

Create a managed long entry for `account-a/BTC/USDT/production`, then pass an external sell close with authoritative trade ID through `upsertOkxOrder()`. Assert:

```js
assert.equal(db.fills[0].tradeAttribution.scope, "system");
assert.equal(db.fills[0].tradeAttribution.exitMode, "manual_exit");
assert.equal(db.fills[0].tradeAttribution.executionOrderId, "exec-1");
assert.equal(groupSystemClosedTradeLifecycles(db)[0].key, "exec-1");
```

Add separate tests that prove:

- a partial close remains incomplete until the final external close arrives, then both fills aggregate under `exec-1`;
- a net reversal close component is system/manual-exit while its new entry component remains manual;
- repeated delivery of the same exchange trade ID does not duplicate attribution or lifecycle PnL.

- [ ] **Step 2: Write RED tests for fail-closed candidates**

Add cases for account, environment, symbol, side/direction, time, and quantity mismatch; two open executions on the same slot; and an unmatched external entry that mixes quantity into the managed slot. Assert `attribution_pending` for ambiguous/mixed ownership and no projected system close.

- [ ] **Step 3: Write RED execution-settlement test**

Given a complete attributed manual exit and a later authoritative account snapshot with no matching position, call `reconcilePendingClose()` and assert:

```js
assert.equal(result.status, "closed");
assert.equal(execution.status, "closed");
assert.equal(execution.exitReason, "manual_exit");
assert.equal(db.fills.filter((fill) => fill.kind === "close").length, 1);
assert.equal(db.fills[0].exchangeTradeId, "manual-close-trade-1");
```

The test must also assert the matching `execution_engine` position is removed, the plan is completed, and no new OMS/exchange action callback is invoked.

- [ ] **Step 4: Run manual-exit tests and record RED**

Run: `npm test -- tests/manual-exit-attribution.test.mjs`

Expected: FAIL because external closes are currently manual and the manual-exit closure builder is absent.

- [ ] **Step 5: Implement the exact-match resolver**

Calculate close direction from side (`sell -> long`, `buy -> short`), then filter open executions by account, environment, canonical symbol, direction, entry time, and remaining managed quantity. Remaining quantity is system entry quantity minus already attributed system close quantity. Inspect unmatched external entry components in the same slot and lifecycle interval; any such row returns `mixed_position_attribution`. The projected clone, not the raw exchange row, sets `partial: true` when the attributed quantity is below the pre-fill remaining system quantity; the final exact close projects `partial: false`.

Return `manual` only when there is no managed candidate and no conflicting evidence. Return `pending` for multiple candidates, quantity overflow, missing authoritative trade ID/time, or mixed quantity.

- [ ] **Step 6: Build closure evidence from the existing raw manual-exit fills**

`buildAttributedManualExitClosure()` must:

- select projected `system/manual_exit` close fills for exactly one execution;
- require authoritative price, quantity, realized PnL, recorded fee, trade ID, and close time;
- require aggregate close quantity to equal the managed filled quantity within the existing tolerance;
- return `complete: false` for partial, mixed, duplicated, or financially incomplete evidence;
- sum PnL/fees and compute quantity-weighted price without mutating fills.

- [ ] **Step 7: Finalize execution state without recording a duplicate fill**

In the authoritative position-absent path, prefer complete attributed-manual-exit evidence before protection/manual closure fetches. Extract the existing non-fill state transition from `reconcilePendingClose()` into a local helper that accepts `{ exitReason, closure, existingCloseFills }`. When `existingCloseFills` is non-empty, update those fills' system attribution and financial fields but do not call `recordFill()`.

Set `exitReason = "manual_exit"`, close the execution and plan, remove only its engine mirror, resolve its close-reconciliation incident, and leave raw exchange IDs/times unchanged. Do not submit or retry any exchange action.

- [ ] **Step 8: Run manual-exit and execution regressions GREEN**

Run: `npm test -- tests/manual-exit-attribution.test.mjs tests/exchange-protection-accounting.test.mjs tests/execution-safety-regression.test.mjs tests/okx-net-fill-classification.test.mjs tests/okx-realtime-binding.test.mjs`

Expected: PASS with exactly one close fact for the manual exit.

- [ ] **Step 9: Commit the manual-exit checkpoint**

```bash
git add server/systemTradeProjection.mjs server/executionEngine.mjs server/realtimeManager.mjs tests/manual-exit-attribution.test.mjs
git commit -m "fix: attribute manual exits of managed trades"
```

### Task 5: Migrate Performance, Review Queue, and Trade Protections

**Files:**
- Modify: `server/accounting.mjs:545-620` (`performanceReport()` only)
- Modify: `server/tradeReviewQueue.mjs:224-374`
- Modify: `server/reviewEngine.mjs`
- Modify: `server/tradeProtections.mjs`
- Modify: `tests/financial-fixtures.mjs`
- Modify: `tests/performance-review-integrity.test.mjs`
- Modify: `tests/trade-protections.test.mjs`
- Create: `tests/system-trade-consumer-boundary.test.mjs`

**Interfaces:**
- Consumes: `systemTradeFills()` and `groupSystemClosedTradeLifecycles()`.
- Produces: performance, review/reflection, consecutive-loss, and drawdown consumers observe only positively attributed system trades.

- [ ] **Step 1: Add one cross-consumer RED test**

Build a database with one losing system lifecycle and three losing fully manual lifecycles. Assert before implementation that current consumers are contaminated, then define the required results:

```js
assert.equal(performanceReport(db).trades, 1);
assert.equal(syncTradeReviewQueue(db).queued, 1);
assert.equal(db.reviews.length, 1);
assert.equal(consecutiveLossCooldown(db).streak, 1);
assert.equal(drawdownLockout(db).active, false);
```

Also assert a system lifecycle tagged `manual_exit` is included exactly once.

- [ ] **Step 2: Run the consumer test and record RED**

Run: `npm test -- tests/system-trade-consumer-boundary.test.mjs`

Expected: FAIL because manual lifecycles are counted and reviewed.

- [ ] **Step 3: Migrate performance without touching B2 accounting**

Change only `performanceReport(db)` to obtain lifecycles from `groupSystemClosedTradeLifecycles(db)`. Leave `realizedPnlSince`, `unrealizedPnl`, `refreshAccounting`, baseline resolution, daily loss budget, and rolling backfill untouched.

- [ ] **Step 4: Migrate review queue/reflection inputs**

`syncTradeReviewQueue(db)` and `reconcileReflectedTradeReviews(db)` must iterate projected system closes/lifecycles. `ensureTradeReviewQueued(db, fill)` must call `projectSystemTradeFill(db, fill)` and return `null` for manual/pending rows. Adapt `reviewEngine` scoped-fill calls through `groupSystemClosedTradeLifecycles(db, { fills: scopedFills, ...options })`.

- [ ] **Step 5: Migrate stateless trade protections**

Remove the legacy unkeyed-fill normalization from `tradeProtections.closedTrades()`. It must use `groupSystemClosedTradeLifecycles(db)` so an unowned legacy/manual fill cannot manufacture a protection event. Keep thresholds, clocks, incident behavior, and equity denominator unchanged.

- [ ] **Step 6: Make affected tests provide real provenance**

Extend `tests/financial-fixtures.mjs` with a helper that installs matching execution/plan evidence into a database. Update only tests that intend to represent system performance. Add separate manual rows explicitly where exclusion is the behavior under test. Do not make `financiallyReconciledFills()` silently label every fill as system-owned.

- [ ] **Step 7: Run performance/review/protection tests GREEN**

Run: `npm test -- tests/system-trade-consumer-boundary.test.mjs tests/performance-review-integrity.test.mjs tests/trade-protections.test.mjs tests/review-learning.test.mjs`

Expected: PASS; manual losses do not create reviews or protection streaks.

- [ ] **Step 8: Commit the core-consumer checkpoint**

```bash
git add server/accounting.mjs server/tradeReviewQueue.mjs server/reviewEngine.mjs server/tradeProtections.mjs tests/financial-fixtures.mjs tests/performance-review-integrity.test.mjs tests/trade-protections.test.mjs tests/system-trade-consumer-boundary.test.mjs
git commit -m "fix: scope performance and reviews to system trades"
```

### Task 6: Migrate Learning, Analytics, and Optimization Consumers

**Files:**
- Modify: `server/behaviorProfile.mjs`
- Modify: `server/decisionCalibration.mjs`
- Modify: `server/knowledgeSkills.mjs`
- Modify: `server/professionalAnalytics.mjs`
- Modify: `server/reviewLearning.mjs`
- Modify: `server/ownerReviewLoop.mjs`
- Modify: `server/strategyBoard.mjs`
- Modify: `server/strategyContracts.mjs`
- Modify: `server/strategyProducts.mjs`
- Modify: relevant existing analytics/strategy tests
- Modify: `tests/system-trade-consumer-boundary.test.mjs`

**Interfaces:**
- Consumes: system lifecycle projection with optional `fills` scope.
- Produces: no manual lifecycle can become a behavior sample, calibration sample, knowledge skill, owner-review sample, strategy metric, product metric, or optimizer input.

- [ ] **Step 1: Add RED assertions for analytics contamination**

Extend `system-trade-consumer-boundary.test.mjs` with one profitable manual lifecycle whose strategy fields deliberately resemble a real strategy, plus one losing system lifecycle. Assert system trade count, strategy product trade count, behavior closed-trade count, and calibration sample count all equal one and refer to the system execution ID.

- [ ] **Step 2: Run analytics/strategy tests and record RED**

Run: `npm test -- tests/system-trade-consumer-boundary.test.mjs tests/strategy-products.test.mjs tests/strategy-board.test.mjs tests/strategy-contracts.test.mjs tests/professional-analytics.test.mjs tests/decision-calibration.test.mjs tests/behavior-profile.test.mjs`

Expected: at least the new manual-contamination assertions FAIL.

- [ ] **Step 3: Replace raw grouping at every B1 analytics consumer**

Use `groupSystemClosedTradeLifecycles(db)` when the function owns `db`. For functions currently accepting only a fill array, change the internal helper signature to receive `db` plus an optional scoped fill array, then update all in-module call sites. Preserve filters for financial reconciliation, tenant/owner scope, strategy refs, versions, and dates after provenance filtering.

- [ ] **Step 4: Preserve low-level reconciliation exceptions**

Do not replace raw grouping inside `executionEngine.reconcilePendingTradeFinancials()` in this task; it intentionally examines raw exchange evidence and already requires execution-order evidence before fetching funding. Add an inline comment explaining that it is an allowed raw-evidence path and ensure it cannot feed manual lifecycle output into analytics.

- [ ] **Step 5: Run all learning/analytics/strategy tests GREEN**

Run: `npm test -- tests/system-trade-consumer-boundary.test.mjs tests/strategy-products.test.mjs tests/strategy-board.test.mjs tests/strategy-contracts.test.mjs tests/professional-analytics.test.mjs tests/decision-calibration.test.mjs tests/behavior-profile.test.mjs tests/review-learning.test.mjs tests/owner-review-loop.test.mjs tests/knowledge-skills.test.mjs`

Expected: PASS; strategy/product identifiers and financially reconciled system results remain unchanged.

- [ ] **Step 6: Commit the analytics checkpoint**

```bash
git add server/behaviorProfile.mjs server/decisionCalibration.mjs server/knowledgeSkills.mjs server/professionalAnalytics.mjs server/reviewLearning.mjs server/ownerReviewLoop.mjs server/strategyBoard.mjs server/strategyContracts.mjs server/strategyProducts.mjs tests
git commit -m "fix: exclude manual trades from learning inputs"
```

Before committing, inspect `git diff --cached --name-only` and unstage any unrelated test file; the checkpoint must contain only the named modules and their directly affected tests.

### Task 7: Migrate System Trade History, Chat Presentation, and Telegram Posters

**Files:**
- Modify: `server/coreOverview.mjs`
- Modify: `server/overviewView.mjs`
- Modify: `server/chatPresentation.mjs`
- Modify: `server/telegramNotifier.mjs`
- Modify: `server/routes/posters.mjs`
- Modify: relevant overview/presentation/Telegram tests
- Modify: `tests/system-trade-consumer-boundary.test.mjs`

**Interfaces:**
- Consumes: system projected fills and lifecycles.
- Produces: system history and closed-trade posters contain only system lifecycles; account position presentation remains full-account and unchanged.

- [ ] **Step 1: Add RED observable presentation tests**

Construct an overview database containing a manual completed lifecycle, a normal system lifecycle, a system/manual-exit lifecycle, and an open manual exchange position. Assert:

- system fill/history arrays contain the two system lifecycles and not the manual lifecycle;
- `closedTradeLifecycles` contains two rows;
- the open manual position remains visible in account positions;
- Telegram queues two system posters and zero manual posters;
- poster lookup rejects a manual lifecycle key and resolves the system/manual-exit execution key.

- [ ] **Step 2: Run presentation tests and record RED**

Run: `npm test -- tests/system-trade-consumer-boundary.test.mjs tests/native-overview.test.mjs tests/overview-performance.test.mjs tests/view-data-parity.test.mjs tests/closed-trade-poster.test.mjs tests/telegram-closed-trade-notifier.test.mjs tests/chat-presentation.test.mjs`

Expected: FAIL because raw manual fills/lifecycles are still presented or queued.

- [ ] **Step 3: Filter only trade-history facts at the overview boundary**

In `coreOverview`, create projected system fills/lifecycles once and pass them to view construction. Keep `db.positions`, portfolio equity, margin, liquidation, account snapshots, and reconciliation status unfiltered. `overviewView` must consume the precomputed system lifecycle list rather than regroup raw fills.

- [ ] **Step 4: Migrate chat and poster consumers**

Use projected system fills before grouping in `chatPresentation`. Use `groupSystemClosedTradeLifecycles(db)` in Telegram queue/dispatch and poster routes. Preserve message text, poster response shapes, outbox retry semantics, and Telegram deadlines; only eligibility changes.

- [ ] **Step 5: Run presentation and notification tests GREEN**

Run: `npm test -- tests/system-trade-consumer-boundary.test.mjs tests/native-overview.test.mjs tests/overview-performance.test.mjs tests/view-data-parity.test.mjs tests/closed-trade-poster.test.mjs tests/telegram-closed-trade-notifier.test.mjs tests/chat-presentation.test.mjs tests/telegram-watch-notifier.test.mjs`

Expected: PASS; manual positions remain visible while manual closed trades are not system history/posters.

- [ ] **Step 6: Commit the presentation checkpoint**

```bash
git add server/coreOverview.mjs server/overviewView.mjs server/chatPresentation.mjs server/telegramNotifier.mjs server/routes/posters.mjs tests
git commit -m "fix: hide manual trades from system history"
```

Inspect the staged file list and include only directly affected presentation/Telegram tests.

### Task 8: Enforce the Boundary and Complete B1 Verification

**Files:**
- Modify: `tests/system-trade-consumer-boundary.test.mjs`
- Modify: only fixtures/tests proven under-specified by the full suite
- Do not modify production behavior in this task unless a failing test demonstrates a B1 regression; any broader issue stops the batch for review.

**Interfaces:**
- Produces: a static dependency guard and complete verification evidence for Final Code Review.

- [ ] **Step 1: Add the static raw-lifecycle import guard**

Read these system consumer sources in the test:

```js
const systemConsumers = [
  "accounting.mjs", "behaviorProfile.mjs", "coreOverview.mjs", "decisionCalibration.mjs",
  "knowledgeSkills.mjs", "ownerReviewLoop.mjs", "professionalAnalytics.mjs", "reviewEngine.mjs",
  "reviewLearning.mjs", "strategyBoard.mjs", "strategyContracts.mjs", "strategyProducts.mjs",
  "telegramNotifier.mjs", "tradeProtections.mjs", "tradeReviewQueue.mjs"
];
```

Assert none imports `groupClosedTradeLifecycles` from `tradeReviewQueue.mjs` or `tradeLifecycle.mjs`. Explicitly allow `executionEngine.mjs` as a raw reconciliation owner. Also assert `systemTradeProjection.mjs` imports neither review/accounting/routes nor itself through a compatibility path.

- [ ] **Step 2: Run the complete B1 targeted suite**

Run:

```bash
npm test -- \
  tests/trade-lifecycle-boundary.test.mjs \
  tests/system-trade-projection.test.mjs \
  tests/manual-exit-attribution.test.mjs \
  tests/system-trade-consumer-boundary.test.mjs \
  tests/okx-realtime-binding.test.mjs \
  tests/okx-net-fill-classification.test.mjs \
  tests/exchange-protection-accounting.test.mjs \
  tests/performance-review-integrity.test.mjs \
  tests/trade-protections.test.mjs \
  tests/closed-trade-poster.test.mjs \
  tests/telegram-closed-trade-notifier.test.mjs
```

Expected: all PASS through `ISOLATED_TEST_DATA_ROOT`.

- [ ] **Step 3: Run related review/learning/strategy/presentation integration tests**

Run:

```bash
npm test -- \
  tests/review-learning.test.mjs \
  tests/strategy-products.test.mjs \
  tests/strategy-board.test.mjs \
  tests/strategy-contracts.test.mjs \
  tests/professional-analytics.test.mjs \
  tests/decision-calibration.test.mjs \
  tests/behavior-profile.test.mjs \
  tests/owner-review-loop.test.mjs \
  tests/knowledge-skills.test.mjs \
  tests/native-overview.test.mjs \
  tests/overview-performance.test.mjs \
  tests/view-data-parity.test.mjs \
  tests/chat-presentation.test.mjs \
  tests/telegram-closed-trade-notifier.test.mjs \
  tests/telegram-watch-notifier.test.mjs
```

Expected: all PASS.

- [ ] **Step 4: Run safety regressions proving full-account risk is preserved**

Run:

```bash
npm test -- \
  tests/risk-engine.test.mjs \
  tests/professional-risk-gate.test.mjs \
  tests/position-view.test.mjs \
  tests/position-fact-authority.test.mjs \
  tests/accounting-period-baseline.test.mjs \
  tests/accounting-history-backfill.test.mjs \
  tests/reduce-only-financial-window.test.mjs
```

Expected: all PASS. The accounting tests remain characterization evidence because B1 must not change daily/weekly PnL semantics.

- [ ] **Step 5: Run full verification**

Run in order:

```bash
npm test
npm run eval:agent
npm run lint
npm run build
git diff --check
git status --short
```

Expected: full suite and agent eval PASS; lint/build/diff check PASS; status contains only reviewed B1 changes relative to the design/plan commits.

- [ ] **Step 6: Inspect the complete B1 diff for scope**

Run:

```bash
git diff 5f2a3815b9a738c9297eca646c296fc25a35f178...HEAD --stat
git diff 5f2a3815b9a738c9297eca646c296fc25a35f178...HEAD -- server/accounting.mjs server/riskEngine.mjs server/professionalRiskGate.mjs server/executionEngine.mjs server/realtimeManager.mjs
```

Confirm:

- `accounting.mjs` changes only `performanceReport` imports/calls;
- no daily/weekly baseline, system loss budget, risk threshold, sizing, OMS request, exchange endpoint, schema, dependency, frontend, or deployment change;
- manual raw fills remain in storage;
- manual positions remain in full-account risk paths;
- no debug logging or temporary flags remain.

- [ ] **Step 7: Prepare the B1 Final Code Review handoff**

Report actual targeted/integration/full counts, RED evidence, final dependency direction, observable behavior changes, preserved risk/account behavior, remaining attribution risks, and complete git diff summary. Stop without merging, pushing, deploying, or starting B2.

## B1 Completion Boundary

B1 is complete only when provenance and all named system consumers are correct. It does **not** claim that manual realized/unrealized PnL has been removed from `refreshAccounting()` daily/weekly budgets. That work begins only after B1 Final Code Review and a separately approved B2 implementation plan.
