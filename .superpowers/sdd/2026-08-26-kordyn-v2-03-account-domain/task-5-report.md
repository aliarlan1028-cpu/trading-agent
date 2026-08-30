# Plan 03 Task 5 report — Account capability, state, browser, performance, and visual gates

## Scope and result

Task 5 closes the Account-domain verification layer only. It does not start Plan 04, enable KORDYN V2 by default, cut over traffic, deploy, merge, push, modify backend/API/database/auth/permission/trading/risk behavior, or remove legacy production code.

The retained source chain is:

- Task 5 product and capture-test source: `bfbdce394dc21617b5b0ab070e62f475a5e77bd4`.
- Account evidence asset commit: `8481550253838203c596757a69915f7b8c725f7d`.
- Product screenshots and sidecars in `8481550` explicitly retain `bfbdce3` as their production/capture source. A later documentation commit does not relabel those pixels.

The browser harness mounts the actual production `KordynV2Root`, lazy Account domain, production presenters, canonical selection resolver, state boundary, `ConfirmHost`, and `createV2Actions().account`. It uses bounded, credential-free, production-shaped fixtures with delayed authoritative results. No production write interface is called.

## TDD record

The exact original capability/state RED console output was not retained. It is not reconstructed here as an exact exit code, test count, or diagnostic. The committed test and the fresh GREEN verification are the durable evidence.

The browser harness exposed and closed real failures during development, including CDP target attachment, lazy Account readiness, trusted Position selection, state routing, long-content mounting, Context/Proof focus return, delayed action-ledger timing, and page-reload download aggregation. The exact historical console transcript is not retained, so these are development categories rather than quoted RED output.

The performance ownership regression was added before the final implementation and is GREEN. Its exact historical RED count was not retained and is not restated.

## Capability ownership — 11 / 11

`ACCOUNT_CAPABILITY_SURFACES` owns exactly the deployed `live.*` IDs and records the production workspace/route, Desktop and APP presenter, object identity, action boundary, permission boundary, and resource-state boundary.

| Capability | Workspace / legacy route | Canonical object / view | Existing action boundary |
| --- | --- | --- | --- |
| `live.overview` | `account / marketAccount` | Read-only Account truth summary | Read-only cross-workspace facts |
| `live.market` | `market / market` | Market by bounded symbol/id | Existing watch/reconcile boundaries only |
| `live.account` | `account / marketAccount` | Unique `exchangeAccounts[].id` | Existing reconciliation and account-detail facts |
| `live.positions` | `positions / positions` | Position using `id → positionId → instId → symbol` | Read-only selection; exit stays on eligible execution order |
| `live.execution` | `plans / executionReview` | Deployed `Trade plan` object | Existing `approvePlan` / `rejectPlan` delegation |
| `live.orders` | `orders / tradeLedger` | Separate Execution and Order identities | Read-only; no cancel/amend capability exists |
| `live.fills` | `fills / tradeLedger` | Fill and closed-lifecycle facts | Read-only inspection |
| `live.protection` | `positions / positions` | Eligible linked Execution order | Sole existing `exitExecutionOrder` boundary |
| `live.reconcile-status` | `account / marketAccount` | Reconciliation freshness/result | Existing reconcile action/result and retry semantics |
| `live.review-status` | `fills / tradeLedger` | Review only by explicit linkage | Existing `openReviews`; navigation is not proof of existence |
| `live.closed-trade-poster` | `fills / tradeLedger` | Reconciled Closed trade → unique closed Execution | Existing server PNG `downloadClosedTradePoster(executionId)` |

The gate rejects invented cancel/amend, client poster generation, translation, automatic Telegram delivery, and raw Root-data reads from Account presenters.

## Canonical state contract — 13 / 13

| State | Truth rule and retained visual evidence |
| --- | --- |
| `loading` | No last-valid facts are reused. |
| `empty` | Authoritative empty is distinct from missing/failure. |
| `processing` | The real plan action is pending, confirmation is visible, terminal success is absent, and authority writes are still zero. |
| `stale` | Last-valid source/time remain visible; protected mutation is disabled. |
| `degraded` | Last-valid source/time remain visible; protected mutation is disabled. |
| `failed` | Explicit read failure and retry boundary. |
| `forbidden` | Protected facts and mutation controls are absent. |
| `disabled` | Disabled is distinct from failed/forbidden. |
| `approval` | Confirmation/authorization is required and does not imply execution. |
| `partial` | Completed `approval consumed` and failed `capacity_changed` are separate; no success collapse. |
| `no-result` | No result is distinct from empty/failure. |
| `long-content` | The real closed-trade detail remains complete, scrollable, keyboard reachable, and horizontally contained. |
| `large-list` | The accepted 64-row fixture keeps all 64 identities and remains scrollable. Inputs above the explicit 96-row evidence bound are marked and bounded; no unlimited-list claim is made. |

Missing financial values remain `Unavailable`; an authoritative finite zero remains `0`. Hostile text-like inputs fall back to bounded safe text rather than rendering literal attack strings.

## Real browser interactions and authority ledger

The committed master-browser sidecars record:

- Four baseline captures: Desktop `1440x900` and `1180x800`; APP `390x844` and `430x932`.
- Thirteen real Root-mounted state captures.
- Ten accepted canonical interactions covering Market, Account, Position, Trade plan, Execution, Order, Fill, Closed trade, Review, and the plan action entry.
- Root selected ID/type, Context identity, and Proof identity remain aligned for accepted candidates; adverse candidates fail closed.
- Four fixture-authority action requests: reconciliation, execution exit, exit polling, and plan approval.
- One server-poster download record.
- Processing proves no pre-confirm write and no terminal success. Partial approval proves one approval request, consumed approval, failed execution submission, and separate failed reason.
- `accountCss:true`, `legacyProductStyles:false`, and zero horizontal overflow at each required viewport.

`capture-evidence.json` SHA-256 is `c9ecfbb14857ea74e6fbea4a7b60ff605b4e412f82c3bd1356e80e6bae8f2e7d`. `state-evidence.json` SHA-256 is `bbc82e37a4731472c6d15ee8c624cdac90b4ca2457da93ed1b4fb7564470716a`.

## Visual comparison and human review

Account scope compares only immutable `desktop-account-position` at `1440x900` and `1180x800`. APP Account captures are structural/overflow evidence only because no approved Account APP raster exists.

- Account scope: manifest `15`, scoped `1`, completed scoped `1`, pending scoped `0`, out-of-scope `14`.
- Cumulative governed coverage: `5 / 15`, combining the historical Plan 02 AI comparisons with this Account comparison. The AI pixels were not recaptured or reclassified by Task 5.
- Comparison index SHA-256: `b54de1d14b58aaca72b2abbb65c8fe9363ac1e68b275dd56f91b7191b25af99d`.
- `1440x900` diagnostic pixel MAE: `0.054732`.
- `1180x800` diagnostic pixel MAE: `0.054901`.
- Machine verdict for both: `human region review required`.

Original-size review covered 17 Account actual/state PNGs and six normalized reference/overlay/difference PNGs. The production view retains the approved Account/Position topology, selected Position identity, Context/Proof access, protection evidence, safety action, related records, Account truth, and bounded AI support. Honest differences remain: the fixture has two positions instead of the concept's richer set; the production workspace uses a bounded price-boundary/evidence composition instead of the concept's richer chart cockpit; production-shaped missing facts render `Unavailable`. These are recorded differences, not a pixel-equivalence claim.

## Performance and style ownership

The isolated Vite build reports one lazy Account domain, Account-owned CSS, explicit shared-shell CSS, and no legacy authenticated stylesheet. The Account domain CSS is `112,930` bytes against the explicit `120,000`-byte budget. Public and AI route budgets remain protected, the performance runner removes its temporary output, and source/checked-in `dist` hashes remain unchanged.

Task 5 made one scoped production style correction for the authenticated `ConfirmHost`. The implementation record says the Impeccable detector ran exactly once after the final UI edit, exited `0`, and returned `[]`. The documentation closeout does not independently replay that detector and does not present the implementation record as a second run.

## Files and commits

Product/test source `bfbdce3`:

- `src/kordynV2/domains/account/capabilitySurfaces.js`
- `src/kordynV2/domains/account/stateSurfaces.js`
- scoped authenticated `ConfirmHost` styles in `src/kordynV2/styles/shell.css`
- Account browser fixture/runner and state tests
- governed comparator scope support and Account performance ownership gates

Evidence `8481550`:

- `.impeccable/review/kordyn-v2/account/**`
- `.impeccable/review/kordyn-v2/account-compare/**`

Documentation closeout:

- `docs/kordyn-v2-evidence.md`
- `.superpowers/sdd/2026-08-26-kordyn-v2-03-account-domain/progress.md`
- this report

## Limitations and stop condition

- Pixel metrics are diagnostic; the committed machine verdict still requires the recorded human review.
- APP Account evidence proves shared product model, real production components, interaction structure, touch/keyboard boundaries, and overflow safety; it is not an immutable-raster fidelity comparison.
- Physical-device, live exchange payload, and network variance remain outside this local browser checkpoint.
- Plan 03 remains subject to fresh Task 5 and whole-plan independent read-only reviews with Critical `0` and Important `0` before it can be called complete.
- Work stops after Plan 03 verification. Plan 04 and production implementation/cutover remain unauthorized.

## Fresh closeout verification

- Focused Account/comparison/performance contracts: `175 / 175`, exit `0`.
- Real production Account browser, isolated temporary output: exit `0`; `4` captures, `13` states, `10` canonical interactions, `4` fixture-authority writes, `1` poster download, Account CSS loaded, legacy authenticated CSS absent. The temporary output identified current evidence HEAD `8481550`; it was discarded and did not overwrite or relabel canonical `bfbdce3` pixels.
- Governed Account comparator to an isolated temporary output: exit `0`; `1` scoped / `1` completed / `0` pending; machine verdict `human region review required`. The generated index differed from the committed index only by its temporary `outputRoot`.
- Isolated performance build: exit `0`; Account CSS `112,930 / 120,000`, public and AI budgets pass, no forbidden legacy CSS, source and checked-in `dist` unchanged, temporary build removed.
- Full repository suite: `2051 / 2051`, exit `0`.
- ESLint: exit `0`.
- Production build: exit `0`; Vite transformed `1720` modules.
- `git diff --check`: exit `0` before documentation commit.
