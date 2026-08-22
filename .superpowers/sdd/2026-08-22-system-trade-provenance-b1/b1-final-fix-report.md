# B1 Final Broad Review Fix Report

Date: 2026-08-22
Workspace: `/Users/ely/Desktop/Trading Agent/.worktrees/fix-system-trade-provenance`
Branch: `codex/fix-system-trade-provenance`
Starting SHA: `6927aa974b16d7e763812ae50b48a16a1287ae30`
Commit subject: `fix: close system trade provenance gaps`
Result commit: the atomic commit containing this report; the exact resulting HEAD SHA is recorded in the final handoff because a commit cannot embed its own cryptographic hash.

## Outcome

All five B1 final-review findings are addressed. No B2 accounting-budget,
risk/sizing, OMS/exchange transport, schema, frontend, deployment, merge, or
push work was performed.

## Finding disposition

### F1 — REST-first / late-WS duplicate close

Addressed.

- Added one authoritative fill-identity view covering singular and plural
  trade/order IDs plus `exitBreakdown` IDs.
- Identity is scoped by exchange, account, environment, and canonical symbol.
  Complete raw bindings are used as raw identity facts; missing bindings are
  derived only from a validated system attribution/execution/plan chain.
- Aggregated execution-writer fills now persist exchange, account, environment,
  unique singular exchange trade/order/algo IDs, and exchange fill time while
  retaining the plural arrays and breakdown.
- A REST-settled close followed by the same WS trade remains one raw fill and
  one lifecycle with unchanged quantity, fee, and PnL.
- A conflicting late payload marks the first raw row conflicted and reopens the
  validated lifecycle as `close_reconciliation_pending`; it never overwrites
  the first financial evidence.
- Identical trade IDs in another account or environment remain isolated.

RED: the two new REST-first tests both failed because two close rows were
persisted (`2 !== 1`).

GREEN: both arrival orders, REST-first conflicts, forged-scope conflicts, and
cross-account dedup isolation pass in the manual-exit/realtime suites.

### F2 — Explicit re-evaluation of persisted pending attribution

Addressed.

- `classifyTradeFill()` retains sticky schema-v1 `attribution_pending`
  semantics and never upgrades consumer-supplied metadata.
- Added a separate server-owned reconciliation function. It promotes only
  uniquely validated execution-writer system fills or deterministic manual
  exits after durable execution, plan, order, and system-entry evidence exists.
- Ambiguous candidates, mixed entries, and binding conflicts remain pending
  byte-for-byte.
- Execution-writer, realtime lifecycle, and restart/fill-history reconciliation
  entry points invoke the explicit reconciler and persist only server-derived
  attribution metadata. Raw price, quantity, PnL, fee, trade/order IDs, and
  timestamps are unchanged.

RED: focused tests failed because the explicit reconciler did not exist, and
the restart path returned no attribution reconciliation result.

GREEN: pending execution-writer to system, pending external close to
`system/manual_exit`, ambiguous/conflicting stays-pending, ordinary-classifier
stickiness, restart, and out-of-order evidence tests all pass.

### F3 — Poster/review companion-fill contamination

Addressed.

- Closed-trade poster entry basis now selects companion entries from
  `systemTradeFills(db)`.
- Review open-time, news-window, web-gap, and trajectory companion selection
  use one projected system-fill view.
- Open-position/account posters still consume the full account position view.

RED: the poster used an entry price of `775` instead of `100`, and review
incorrectly attached a high-impact news fact that predated the true system
entry window.

GREEN: poster price/notional and review time/news attribution ignore the
pending companion while preserving the real system entry.

### F4 — System-only `/api/history/fills`

Addressed.

- `/api/history/fills` applies `systemTradeFills(db)` before cursor sorting,
  pagination, totals, and status summary.
- Manual and pending rows are excluded; normal system and attributed
  `manual_exit` rows are retained.
- `/api/fills` remains the authenticated raw forensic account feed.

RED: the first history page returned the newer pending/manual rows instead of
the two system rows.

GREEN: route-level permission, no-store header, response shape, two-page cursor
behavior, projected totals, and raw `/api/fills` preservation pass.

### F5 — Missed-opportunity trade suppression

Addressed.

- Recent-trade detection now uses only `systemTradeFills(db)`.
- A position suppresses a missed sample only when it is a nonzero
  `execution_engine` position bound to an open persisted execution with a
  validated projected system entry and consistent slot identity.
- Manual/pending fills and manual account positions do not authorize learning
  suppression. They remain present for full-account risk consumers.
- The existing traded fixture now contains persisted execution, plan, and
  schema-v1 system attribution. `missedOpportunity.mjs` is included in the
  static system-consumer boundary list.

RED: manual fill, pending fill, and manual open-position counterexamples all
suppressed the missed sample (`0 !== 1`).

GREEN: those counterexamples produce missed samples, while a recent system fill
and a validated managed open position still suppress them.

## Verification

All test commands used the isolated test runner and confirmed temporary storage
cleanup.

| Scope | Result |
| --- | --- |
| Final focused projection/manual/missed suite | 176 passed, 0 failed |
| Task 4 writer/reconciliation suite | 118 passed, 0 failed |
| Poster/review/history/missed/consumer suite | 40 passed, 0 failed |
| Task 8 targeted suite | 248 passed, 0 failed |
| Task 8 review/learning/presentation integration | 121 passed, 0 failed |
| Task 8 full-account safety suite | 71 passed, 0 failed |
| Final full `npm test` | 1423 passed, 0 failed |
| `npm run eval:agent` | 7 passed, 0 failed |
| `npm run lint` | passed |
| `npm run build` | passed, 1623 modules transformed |
| `git diff --check` | passed before report creation; repeated before commit |

The first combined focused run exposed one existing forged-scope safety
regression after the new identity matcher (218 passed, 1 failed). The matcher
was corrected so complete raw scope identifies a duplicate fact, while only a
validated system projection may reopen a lifecycle. The focused suite then
passed, and the final full suite includes that regression.

## Files changed

Production:

- `server/systemTradeProjection.mjs`
- `server/executionEngine.mjs`
- `server/realtimeManager.mjs`
- `server/positionPoster.mjs`
- `server/reviewEngine.mjs`
- `server/routes/history.mjs`
- `server/missedOpportunity.mjs`

Tests:

- `tests/system-trade-projection.test.mjs`
- `tests/manual-exit-attribution.test.mjs`
- `tests/poster-routes.test.mjs`
- `tests/performance-review-integrity.test.mjs`
- `tests/history-routes.test.mjs`
- `tests/missed-opportunity.test.mjs`
- `tests/system-trade-consumer-boundary.test.mjs`

Report:

- `.superpowers/sdd/2026-08-22-system-trade-provenance-b1/b1-final-fix-report.md`

## Preserved behavior and residual risks

- Manual adverse-slippage/full-account execution-cost safety remains intact.
- Manual account positions remain in full-account position and risk views.
- Raw authoritative financial fields are never normalized or overwritten by
  deduplication or attribution re-evaluation.
- Missing authoritative trade identity or incomplete scope remains fail-closed;
  the matcher does not invent a composite financial identity.
- Pending re-evaluation is deliberately limited to persisted schema-v1 pending
  rows and recognized server-owned evidence paths. New reason families remain
  pending until explicitly supported.
- B2 accounting budgets and daily/weekly PnL semantics are unchanged.

No blocking concern remains.
