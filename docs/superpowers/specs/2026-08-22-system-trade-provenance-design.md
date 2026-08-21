# System Trade Provenance and Accounting Boundary Design

Date: 2026-08-22
Status: Proposed for Product Owner review
Target: BitLaunch production-only OKX deployment

## 1. Decision and Scope

The approved product rule is:

- a trade opened outside this system is a manual trade;
- a manual trade must not enter system performance, accounting PnL budgets, review, learning, optimization, trade protections, system trade history, or system-trade notifications;
- a trade opened by this system remains a system trade when the owner later closes it manually at OKX; its exit is attributed as `manual_exit` and remains part of the system trade lifecycle;
- manual positions and orders remain real account facts and continue to consume available margin, total account exposure, concentration capacity, and liquidation-risk capacity;
- current total account equity remains authoritative for resource capacity;
- raw OKX orders, fills, positions, and reconciliation evidence are never deleted merely because they are manual;
- attribution is fail-closed: ambiguous or mixed ownership is never guessed into system performance.

This is an attribution-boundary correction. It is not a trading-strategy change, an OMS rewrite, a position-model rewrite, an exchange-connector redesign, or a historical-data deletion project.

Implementation is split into two independently reviewable batches:

- **B1 — Provenance boundary and consumer projection:** establish one source of truth for trade ownership, attribute deterministic manual exits, and move system-performance/review/learning consumers onto the system projection.
- **B2 — System-only accounting boundary:** calculate daily/weekly system PnL and system unrealized PnL without removing manual positions from total-account resource and exposure controls.

B2 depends on B1. Each batch must have its own characterization tests, implementation review, rollback point, and full verification.

## 2. Current Architecture and Confirmed Problem

### 2.1 Raw exchange evidence is already retained correctly

`server/realtimeManager.mjs` stores an OKX external/manual fill only when the exchange order does not match a persisted `executionOrder` by exchange order ID or client order ID. These rows retain exchange trade ID, account binding, environment, side, quantity, fee, realized PnL, and exchange time. In net mode, a reversal is already split into close and entry components.

`server/executionEngine.mjs` records system fills with `executionOrderId`, `planId`, mandate, risk, agent-run, and strategy provenance. These are distinguishable from external exchange fills, but the distinction is not enforced at one shared consumer boundary.

### 2.2 Consumers currently read the raw ledger as if every row were a system trade

`groupClosedTradeLifecycles(db.fills)` has no database or provenance context. It groups any financially shaped close fill, including a fully manual close whose fallback lifecycle key is its fill ID.

That raw grouping is consumed by, among others:

- `server/accounting.mjs` performance reporting;
- `server/tradeReviewQueue.mjs` and review/learning modules;
- `server/tradeProtections.mjs` consecutive-loss and drawdown protections;
- strategy analytics, calibration, knowledge, and optimization modules;
- Telegram closed-trade profit posters;
- system overview/trade-history presentation.

`realizedPnlSince()` and `unrealizedPnl()` in `server/accounting.mjs` also operate across all raw fills and all authoritative position mirrors. Consequently, a fully manual trade can change system daily/weekly PnL, create pending financial facts, trigger review or protection behavior, and appear as a system result.

### 2.3 Resource risk correctly uses the full account

Current margin and exposure gates use authoritative account equity, available margin, and all deduplicated exchange positions. This is the correct behavior and must remain unchanged. The new projection applies only to performance ownership and PnL budgets, not to physical account capacity or exposure.

## 3. Domain Model

### 3.1 Three attribution states

Every trade fill is classified as exactly one of:

| State | Meaning | System consumers |
| --- | --- | --- |
| `system` | Positive server-owned evidence binds the fill to a system execution lifecycle | Included |
| `manual` | Positive evidence shows it is external and it cannot belong to a managed system lifecycle | Excluded |
| `attribution_pending` | Evidence is incomplete, conflicting, mixed, or non-unique | Excluded and surfaced as an operational blocker where it affects an open managed lifecycle |

`attribution_pending` is not treated as manual success and is not treated as system PnL. It prevents invented performance while preserving evidence for reconciliation.

### 3.2 Fill attribution contract

New fills receive server-owned metadata under one field:

```js
tradeAttribution: {
  schemaVersion: 1,
  scope: "system" | "manual" | "attribution_pending",
  origin: "execution_engine" | "external_exchange",
  exitMode: "system_exit" | "manual_exit" | null,
  executionOrderId: string | null,
  planId: string | null,
  method:
    | "execution_writer"
    | "external_close_unique_managed_match"
    | "external_unmanaged"
    | "legacy_positive_provenance"
    | "unresolved",
  reason: string | null,
  evidence: {
    accountId: string | null,
    environment: string | null,
    exchangeOrderId: string | null,
    exchangeTradeId: string | null,
    matchedEntryFillIds: string[],
    attributedQuantity: number | null
  },
  attributedAt: string
}
```

Rules:

- this field is written only by server ingestion/execution/reconciliation code;
- no route or caller-supplied JSON may self-declare `scope: "system"`;
- exchange facts such as exchange order ID, trade ID, price, quantity, fee, realized PnL, and timestamps are not rewritten;
- a manual-exit projection may bind a raw external close to an execution lifecycle without claiming that the external OKX order was created by the system;
- attribution metadata is append/update evidence, not a substitute for the raw exchange row.

### 3.3 Legacy rows

There is no blanket migration that labels every row with an `executionOrderId` as system-owned. The classifier may accept a legacy row only when positive persisted evidence agrees, for example:

- its `executionOrderId` resolves to a persisted execution order and its plan/account/symbol/direction facts do not conflict; or
- its exchange order/client order identity resolves through a server-created execution order and related fill/plan evidence.

Missing or conflicting provenance becomes `attribution_pending`. It is excluded from system metrics until resolved. Existing data is not deleted or silently rewritten to improve historical statistics.

## 4. Leaf Service and Single Source of Truth

Extract the current pure fill-grouping primitives into a leaf module, conceptually `server/tradeLifecycle.mjs`, then add `server/systemTradeProjection.mjs` above it. This avoids creating a new ESM cycle when `tradeReviewQueue` becomes a consumer of the system projection.

```text
tradeLifecycle (pure key/group/financial aggregation)
        ↑
systemTradeProjection (provenance validation and system-only projection)
        ↑
accounting / review / analytics / presentation consumers
```

`systemTradeProjection` must not depend on accounting, review, analytics, Telegram, routes, or frontend modules.

Minimal public API:

```js
classifyTradeFill(db, fill)
systemTradeFills(db, options?)
groupSystemClosedTradeLifecycles(db, options?)
systemManagedPositionFacts(db, options?)
```

Responsibilities:

- validate persisted provenance;
- classify legacy and current fills consistently;
- return system-only fill and lifecycle projections;
- expose unresolved/mixed reasons explicitly;
- resolve a managed execution and plan without duplicating consumer-specific OR rules;
- produce projected copies for consumption instead of mutating raw rows during reads.

`groupClosedTradeLifecycles(fills)` remains the low-level financial grouping primitive in `tradeLifecycle`. `tradeReviewQueue` may compatibility re-export the pure helpers while callers migrate, but it is not their implementation source. `groupSystemClosedTradeLifecycles(db)` supplies the primitive only projected system fills. Raw reconciliation code may continue to use the low-level primitive when it intentionally operates on exchange evidence.

There must be no second implementation in `accounting`, `tradeReviewQueue`, analytics, or UI modules. Compatibility wrappers may delegate to the leaf service during incremental migration.

## 5. System Fill Classification

### 5.1 System-created entry or exit

`executionEngine.recordFill()` stamps authoritative `tradeAttribution` at creation. The following must agree:

- execution order exists;
- plan binding exists where required by current execution semantics;
- account, environment, symbol, and direction do not conflict;
- exchange order/client order identity agrees when present.

A conflict is `attribution_pending`, never silently coerced to `system`.

### 5.2 Fully manual trade

An external entry with no valid managed execution match is `manual`. Its later external close remains `manual` unless it independently satisfies the deterministic system-manual-exit rules below.

Manual rows remain in `db.orders`, `db.fills`, account snapshots, and reconciliation evidence. They are excluded only from the system projection.

### 5.3 Unknown or incomplete exchange facts

Rows whose lifecycle kind, quantity, account binding, trade identity, or ownership cannot be determined are `attribution_pending`. They do not create a system trade, review, poster, optimization sample, or PnL budget entry.

## 6. System-Opened Trade Manually Closed at OKX

An external OKX close is attributed as `system/manual_exit` only when all required facts select exactly one managed execution:

1. the account ID and OKX environment match;
2. the normalized symbol matches;
3. close side and position direction are compatible;
4. exchange fill time is after the system entry;
5. the execution is in an open or close-reconciliation state;
6. remaining managed quantity is positive and the close quantity does not exceed it beyond the existing quantity tolerance;
7. no unmatched manual entry has mixed additional quantity into the same account/symbol/direction slot during the managed lifecycle;
8. no second managed execution is a valid candidate;
9. the exchange trade identity is authoritative and non-duplicated.

On a unique match:

- the raw fill keeps `origin: "external_exchange"`;
- attribution binds it to the system execution and plan;
- `exitMode` is `manual_exit`;
- partial closes reduce remaining managed quantity;
- a complete close advances the existing execution lifecycle through reconciliation without submitting, retrying, or fabricating an OMS order;
- review, PnL, fees, funding, and optimization use the same system lifecycle as the original entry.

If zero candidates match, the fill is manual. If multiple candidates match, quantities conflict, a manual entry has mixed into the same net position, or event ordering is insufficient, classification is `attribution_pending`. The system execution remains fail-closed until authoritative evidence resolves it.

For an OKX net-mode reversal:

- the close component may be attributed as `system/manual_exit` when the rules above pass;
- the new entry component remains manual;
- fees and quantities remain split using the existing exchange-fill component ratio;
- realized PnL belongs only to the close component.

## 7. Managed Position Projection

System unrealized PnL needs a managed-position projection, while risk still needs the entire account.

A position is system-managed only when:

- an open execution lifecycle with positive system provenance exists;
- account, environment, symbol, and direction match an authoritative exchange position fact;
- the expected remaining system quantity matches the authoritative slot quantity within the existing tolerance; and
- no external manual entry has mixed additional quantity into the same slot.

The `execution_engine` mirror must carry or resolve its execution order's account/environment binding. This is attribution metadata, not a new position identity scheme.

Outcomes:

- exact match: the authoritative exchange PnL is usable as system unrealized PnL;
- no system lifecycle: the position is manual and excluded from system PnL, while remaining included in total exposure/margin controls;
- mixed or mismatched quantity: system unrealized PnL is incomplete with reason `mixed_position_attribution` or a more specific evidence reason; no proportional PnL allocation is invented.

## 8. B1 Consumer Boundary

B1 moves these system-owned consumers to `groupSystemClosedTradeLifecycles(db)` or `systemTradeFills(db)`:

- performance and win/loss/drawdown reports;
- trade review queue, reflection, review learning, owner review loop, and memory contexts;
- behavior profile, decision calibration, knowledge skills, strategy analytics/contracts/products/board, and optimizer inputs;
- consecutive-loss and realized-drawdown trade protections;
- system closed-trade Telegram posters;
- system trade history and closed-lifecycle UI/API presentation;
- poster routes that resolve a system execution lifecycle.

B1 must not filter raw facts from:

- OKX fill identity reconciliation;
- account snapshots or position mirrors;
- OMS/exchange forensics;
- account exposure, margin, liquidation, or concentration controls;
- incident and audit evidence.

Observable B1 behavior change:

- fully manual exchange trades disappear from system-performance/review/optimization/history/poster outputs;
- deterministic manual exits of system-opened trades remain in those outputs with `manual_exit` provenance;
- unresolved attribution is reported as pending rather than counted.

No response shape needs to change. If an existing ops/status response already carries reasons, it may expose aggregate attribution-pending counts without exposing credentials or raw private exchange payloads.

## 9. B2 System-Only Accounting Model

### 9.1 Two deliberately different scopes

The accounting/risk model must distinguish:

| Fact | Scope after B2 |
| --- | --- |
| `totalEquityUsdt` | Entire OKX account |
| `availableMarginUsdt` | Entire OKX account after manual and system positions |
| total exposure/concentration/liquidation risk | Entire OKX account |
| account-wide unrealized PnL display/fact | Entire OKX account |
| system realized PnL | System-attributed fills only |
| system unrealized PnL | Exact system-managed position projection only |
| daily/weekly system PnL budget | System realized + change in system unrealized only |
| system performance/review/optimization | System lifecycles only |

Manual profit does not increase system performance or replenish its PnL budget. Manual loss does not debit the system PnL budget. Both still change total account equity and available margin, so future position sizing and resource capacity naturally observe the real account.

### 9.2 Realized PnL

Replace raw-ledger iteration in the system accounting path with system-projected fills. Entry fees, close PnL, close fees, and funding must all belong to the same system lifecycle. A manual fill's missing funding or fee must not create system `pendingFinancialReconciliation`.

A system manual exit is included only after deterministic attribution. If its fee/funding evidence is incomplete, the system lifecycle remains financially pending under the current fail-closed semantics.

### 9.3 Unrealized PnL

System unrealized PnL is the sum of authoritative PnL for exact managed-position matches. Fully manual positions contribute zero to this performance measure but continue to exist in account risk. Mixed positions do not receive a guessed proportional allocation and instead make the system PnL fact incomplete.

### 9.4 Versioned system baselines

Existing accounting anchors store account-wide unrealized PnL and cannot be silently reinterpreted as system-only baselines.

New baselines use explicit fields:

```js
{
  pnlScope: "system_trades_only",
  provenanceSchemaVersion: 1,
  equityUsdt: /* total account equity, risk-capacity denominator */,
  systemUnrealizedPnlUsdt: /* system-managed positions only */,
  pnlMethod: "system_fills_plus_system_upl_change",
  attributionEvidenceHash: "..."
}
```

Rules:

- account-wide `unrealizedPnlUsdt` remains legacy/account evidence and is not read as `systemUnrealizedPnlUsdt`;
- the baseline records total equity separately because loss-cap capacity is still based on the real account;
- a baseline is valid only when every system position at the boundary is attributable and exactly matched to authoritative position evidence;
- manual positions may coexist and are excluded only when their quantities are separable from managed quantities;
- historical OKX account-wide bills/position history cannot be used as system PnL without a complete mapping to system execution/trade identities;
- no zero baseline is invented merely to leave `reduce_only`;
- if historical evidence is insufficient, status remains fail-closed while new system-only anchors accumulate naturally;
- an evidence-complete historical reconstruction is allowed only when system fill/order IDs, quantities, bindings, and boundary position facts match exactly.

The current account-wide historical accounting backfill may remain as operational account evidence, but it must not authorize a system-only weekly PnL result by itself.

### 9.5 Daily and weekly outputs

The existing account-wide unrealized PnL fact remains available for account truth and operator display. B2 introduces a distinct system-unrealized value for budgets and system statistics; it must not relabel an account-wide value as system-only or hide manual account loss from the owner.

After B2:

```text
system period PnL
= system realized PnL in period
+ current system unrealized PnL
- boundary system unrealized PnL
```

Existing daily/weekly field names may be retained for compatibility, but their operational metadata must state `system_trades_only`. Any code that needs account-wide equity, margin, exposure, or account-wide unrealized PnL must continue using the corresponding account fact rather than the system-performance projection.

## 10. Failure Semantics

| Condition | Required behavior |
| --- | --- |
| Fully manual lifecycle is complete | Retain raw evidence; exclude from system consumers |
| System-open/manual-close has one exact match | Include as system lifecycle with `manual_exit` |
| Manual close has multiple system candidates | `attribution_pending`; do not guess or mark closed |
| Manual entry mixes into managed net slot | System PnL incomplete; keep total exposure authoritative |
| System entry provenance conflicts | `attribution_pending`; exclude from performance |
| Manual fill fee/funding is missing | Does not block system accounting |
| System fill fee/funding is missing | Existing system financial fail-closed behavior remains |
| Legacy baseline only has account-wide UPL | Invalid for system PnL |
| System baseline evidence is incomplete | Daily/weekly system PnL remains unavailable; no budget weakening |
| Projection module fails | System consumers fail closed; raw evidence remains available |

No condition authorizes deleting raw fills, rewriting exchange facts, weakening reduce-only, or treating unknown financial facts as zero.

## 11. Migration and Cutover

### B1 cutover

1. Add characterization tests proving current manual-trade contamination.
2. Add the leaf classifier/projection and writer-side attribution for new fills.
3. Add deterministic legacy classification without bulk rewriting raw rows.
4. Add manual-exit reconciliation with exact-match and ambiguity tests.
5. Migrate one consumer family at a time to the system projection.
6. Verify raw exchange/reconciliation evidence is unchanged.
7. Verify account exposure and margin controls still include manual positions.

If production has unresolved legacy rows, report counts and reasons. Do not fabricate ownership to make historical metrics complete.

### B2 cutover

1. Characterize current total-account accounting behavior.
2. Add system-realized and managed-position projections.
3. Introduce versioned system-only anchors alongside legacy account-wide anchors.
4. Use exact historical reconstruction only where evidence passes all binding and quantity checks.
5. Otherwise begin natural system-only anchor accumulation and remain fail-closed until the relevant window is supported.
6. Switch daily/weekly system PnL and protection budgets atomically to the versioned scope.
7. Verify total equity, available margin, exposure, liquidation, sizing, and OMS behavior are unchanged.

Rollback reverts consumer selection to the previous code but does not delete new attribution metadata or raw evidence. No rollback step rewrites fills, orders, or accounting history.

## 12. Required Test Contract

### B1 characterization and regression tests

- fully manual entry + close remains in raw `db.fills` but is absent from system lifecycle/performance projections;
- manual profit and loss create no system review, memory, optimizer input, protection streak, Telegram profit poster, or system trade-history row;
- a system entry and system exit remain behaviorally identical;
- a system entry and unique manual OKX close produce one system lifecycle tagged `manual_exit`;
- partial manual exits aggregate into the original system lifecycle;
- net reversal attributes only the close component and leaves the entry component manual;
- same-symbol multiple managed candidates remain pending;
- manual quantity mixed into a managed slot remains pending;
- account/environment/symbol/direction/time/quantity mismatch remains pending or manual as specified;
- duplicate exchange trade IDs do not duplicate system attribution;
- raw fills, exchange facts, and reconciliation evidence remain unchanged after projections are read;
- static tests ensure designated system consumers no longer import/use raw lifecycle grouping directly.

### B2 characterization and regression tests

- manual realized profit/loss does not change system daily/weekly PnL or pending counts;
- manual unrealized profit/loss does not change system PnL;
- manual positions still reduce available margin and contribute to total exposure, concentration, and liquidation checks;
- total account equity remains the sizing/risk-capacity fact;
- system realized fees, funding, and manual-exit PnL remain counted exactly once and in order;
- a manual fill with missing fee/funding does not block system accounting;
- a system fill with missing fee/funding still blocks under current semantics;
- legacy account-wide anchors are rejected for system PnL;
- exact system-only baseline reconstruction succeeds when all evidence matches;
- mixed or incomplete boundary attribution fails closed;
- no historical system baseline is fabricated from account-wide bills;
- daily and rolling-168-hour boundaries, timezone behavior, and existing API field types remain stable;
- regression tests confirm risk, sizing, execution, OMS, reconciliation, and reduce-only thresholds are not weakened.

Every implementation batch must run targeted tests, related accounting/reconciliation/risk/review tests, the full suite through isolated test storage, agent eval, lint, production build, and `git diff --check`.

## 13. Explicit Non-Goals

This work does not:

- delete or hide manual positions from account/risk views;
- ignore manual margin usage or account exposure;
- change OKX net/hedge mode;
- introduce proportional FIFO/LIFO allocation for mixed positions;
- allow an API user or Agent to self-label a trade as system-owned;
- modify strategy prompts, model selection, risk thresholds, sizing formulas, OMS idempotency, or exchange requests;
- redesign funding settlement beyond ownership filtering;
- repair or rewrite audit history;
- implement Telegram ambiguous-delivery handling;
- remove OKX Demo mode;
- migrate frontend direct OKX WebSockets;
- add a database schema or dependency unless implementation evidence later proves it unavoidable and a new approval is obtained.

## 14. Acceptance Criteria

The design is complete when all of the following are true:

1. One server-owned service is the only implementation source for system trade attribution.
2. Fully manual trades are absent from every system performance, accounting, review, learning, optimization, protection, poster, and trade-history path.
3. Raw manual exchange evidence remains preserved for reconciliation and forensics.
4. A uniquely evidenced manual exit of a system trade remains a system result and is labeled `manual_exit`.
5. Ambiguous or mixed provenance fails closed without guessed PnL allocation.
6. Manual positions continue to consume real margin and total exposure.
7. Manual PnL does not debit or replenish system daily/weekly PnL budgets.
8. System PnL baselines are explicitly versioned and never reinterpret account-wide UPL as system UPL.
9. Total account equity remains authoritative for resource capacity.
10. No trading, risk, sizing, OMS, API-shape, database-schema, or frontend behavior changes occur outside these approved attribution semantics.
