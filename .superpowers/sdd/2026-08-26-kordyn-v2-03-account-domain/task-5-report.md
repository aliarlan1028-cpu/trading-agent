# Plan 03 Task 5 report — Account capability, state, browser, performance, and visual gates

## Scope and result

Task 5 closes the Account-domain verification layer only. It does not start Plan 04, enable KORDYN V2 by default, cut over traffic, deploy, merge, push, modify backend/API/database/auth/permission/trading/risk behavior, or remove legacy production code.

The retained source chain is:

- Final Task 5 product source: `3057bcd90496af2992afebe6eb7858f7cf3c9b97`.
- Final Task 5 capture-test source: `e3eb0b3c216eafe9a63ed6b40ec998f693ba50a2`.
- Final detector-record commit: `8e300e461402674090f8a7f46e98b2bb4032eb2f`.
- Account evidence asset commit: `414ab7d343606b501781ebcc0639ae20c6a5c788`.
- The prior canonical product/evidence/documentation checkpoint `312a3c5` / `6000a33` / `29ce80a` is historical. The unchanged capture-test owner `e3eb0b3` remains current. Detector record `ffdd653` is retained as the post-support/pre-semantic invalidated pass; `8e300e4` contains the only pass after the final semantic UI edit.
- `857e0787adde4b8529a26a1ec3775fee3b49a4e0`, `41db7e2feca86e71ef1d874d3c94372ea56a393a`, `b1533631a59089ca79c1de148f3a178f549631c4`, and `4e009a1` are the superseded pre-support-review product, capture-test, evidence, and documentation chain. The still earlier `bfbdce394dc21617b5b0ab070e62f475a5e77bd4` / `8481550253838203c596757a69915f7b8c725f7d` / `41df7ae66ccc0d3ae87ffabae4688b19559acd73` chain is also historical. Neither chain is the source of the final pixels or claims below.

The browser harness mounts the actual production `KordynV2Root`, lazy Account domain, production presenters, canonical selection resolver, state boundary, `ConfirmHost`, and `createV2Actions().account`. It uses bounded, credential-free, production-shaped fixtures with delayed authoritative results. No production write interface is called.

## Review-fix TDD record

- State-surface safety and bounded-list RED: `19` tests, `17` pass, `2` fail. The failures exposed a missing completeness disclosure and a top-level throwing getter (`TOP_LEVEL_ZERO_SECRET`). GREEN: `19 / 19`.
- Scoped comparator RED: `8` tests, `4` pass, `4` fail because Account scope reused ambiguous global counts. GREEN: `8 / 8` with `scopeCounts` and explicit global manifest/out-of-scope fields.
- Provenance RED: the helper was absent, then the first integration run reported `2` tests, `1` pass, `1` fail. GREEN: `2 / 2`, including dirty and untracked scoped-source rejection in temporary repositories.
- Price-boundary geometry RED: at `1440x900`, entry `[1027.8359,488.5–1071.1953,528.5]` and mark `[1046.7109,488.5–1090.0703,528.5]` overlapped. GREEN uses collision lanes and records `overlaps:false` at both Desktop viewports.
- Mobile readability RED first exposed character wrapping, then a clipped `ETH/USDT` label (`clientWidth 28`, `scrollWidth 79`). GREEN stacks the detail and inspector columns at `390px` and records one readable line for the symbol, ownership, source, entry, mark, and protection reason.
- Large-list browser RED expected `180 / 180` and `ASSET180/USDT` but the fixture produced `64 / 64` and `ASSET64/USDT`. GREEN captures all `180` fixture rows, while adapter tests separately prove exact incomplete disclosure above its `96`-row evidence bound.
- The real-browser interaction RED exposed missing APP Context/Proof triggers. GREEN records real trusted clicks, sheet identity, close behavior, focus return, and fail-closed adverse selection across all four viewports.
- Post-review support-isolation RED found the floating AI support launcher intersecting four Desktop ledger cells at `1440x900` (overlap areas `288.90625`, `2076.09375`, `895.609375`, and `6435.890625` square pixels) and covering the APP `ASSET7` row/watch affordance at `430x932`. GREEN places the launcher in a real shell-owned support dock outside the work canvas. The final browser gate checks every visible row/button/link/form control and essential `td`/`dd`/status/action-footer region at scroll start and end across all four viewports and the required adverse states.
- Whole-plan landmark RED rendered the real Desktop shell and Account route with `2` page `<main>` elements. GREEN commit `5ef0784` changes only the internal ledger to a labelled `section`; the shell remains the sole page main and the visual class/box geometry is unchanged.
- Whole-plan financial-truth RED ran `64` tests with `62` passing and `2` failing: whitespace-only Position and Trade-plan facts were coerced to zero, and the malformed plan could appear approval-ready. GREEN commit `3057bcd` keeps the Position inspectable with null/Unavailable finance, rejects blank numeric/text approval facts, disables the authorization action with zero authority calls, and preserves exact numeric strings `"0"` / `"50"`.

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
| `large-list` | The real browser fixture keeps all `180` Market identities, first `ASSET1/USDT` through last `ASSET180/USDT`, and remains scrollable. Adapter inputs above its explicit `96`-row evidence bound visibly disclose exact shown/source counts and incomplete evidence status instead of silently truncating or claiming completeness. |

Missing and whitespace-only financial values remain `Unavailable`; an authoritative finite zero, including exact numeric string `"0"`, remains `0`. Whitespace-only required evidence fails closed and cannot enable approval. Hostile text-like inputs fall back to bounded safe text rather than rendering literal attack strings.

## Real browser interactions and authority ledger

The committed master-browser sidecars record:

- Four baseline captures: Desktop `1440x900` and `1180x800`; APP `390x844` and `430x932`.
- Thirteen real Root-mounted state captures.
- Eleven accepted canonical interactions: all nine object types are distributed across Desktop `1440x900` and `1180x800`, while APP `390x844` clicks a real Position and APP `430x932` clicks a real Trade plan.
- Each interaction ledger step stores viewport/device plus Root, Context, and Proof visible identity. APP Context closes with Escape and Proof closes with its real button; focus returns to the invoking trigger.
- Root selected ID/type, Context identity, and Proof identity remain aligned for accepted candidates. Two missing-Execution candidates, at Desktop `1440x900` and APP `430x932`, preserve before/after selection and explicitly record `failClosed:true`.
- Four fixture-authority action requests: reconciliation, execution exit, exit polling, and plan approval.
- One server-poster download record.
- Processing proves no pre-confirm write and no terminal success. Partial approval proves one approval request, consumed approval, failed execution submission, and separate failed reason.
- `accountCss:true`, `legacyProductStyles:false`, and zero horizontal overflow at each required viewport.
- The AI support launcher remains available but occupies reserved shell chrome: Desktop canvas/dock boundaries are `828/828` at `1440` and `728/728` at `1180`; APP boundaries are `714/714` at `390` and `802/802` at `430`. All baseline plus stale/degraded/long-content/large-list start/end checks record `dockCanvasOverlap:0`, zero interactive intersections, and a hit-testable launcher. `ASSET7` remains fully inside the APP canvas with its object hit-testable and its watch affordance exactly `44x44` and hit-testable.

`capture-evidence.json` SHA-256 is `2ff5e678ed02cca09801e442c7712c39adf9684f010deb77fbc7e95988064c12`. `state-evidence.json` SHA-256 is `018454562f6547e2fe837c62da62aaf51b1baabda347001f3a8919448d8fbb8d`.

## Visual comparison and human review

Account scope compares only immutable `desktop-account-position` at `1440x900` and `1180x800`. APP Account captures are structural/overflow evidence only because no approved Account APP raster exists.

- Account scope: manifest `15`, scoped `1`, completed scoped `1`, pending scoped `0`, out-of-scope `14`.
- Cumulative governed coverage: `5 / 15`, combining the historical Plan 02 AI comparisons with this Account comparison. The AI pixels were not recaptured or reclassified by Task 5.
- Comparison index SHA-256: `ce79eabea447abf4aec09758bb9af6473b4ce287d99e921c1f5aef1f21a43a0d`.
- `1440x900` diagnostic pixel MAE: `0.054344026870007264`.
- `1180x800` diagnostic pixel MAE: `0.054280473856209155`.
- Machine verdict for both: `human region review required`.

Original-size review covered 17 Account actual/state PNGs and six normalized reference/overlay/difference PNGs after the support-dock change. The production view retains the approved Account/Position topology, selected Position identity, Context/Proof access, protection evidence, safety action, related records, Account truth, and bounded AI support in reserved shell chrome. Honest differences remain: the fixture has two positions instead of the concept's richer set; the production workspace uses a bounded price-boundary/evidence composition instead of the concept's richer chart cockpit; production-shaped missing facts render `Unavailable`. These are recorded differences, not a pixel-equivalence claim.

## Performance and style ownership

The isolated Vite build reports one lazy Account domain, Account-owned CSS, explicit shared-shell CSS, and no legacy authenticated stylesheet. The Account domain CSS is `114,606` bytes against the explicit `120,000`-byte budget; AI-shell CSS is `55,847` bytes. Public and AI route budgets remain protected, the performance runner removes its temporary output, and source/checked-in `dist` hashes remain unchanged.

The review-fix session invoked the Impeccable detector four times in total. The first two exit-`0` / `[]` records were invalidated by later mobile-readability and support-dock edits. The third is retained as `account-detector-evidence.pre-semantic-review-invalidated.json` because whole-plan review later changed `AccountWorkspace.jsx` from a nested page main to a labelled section. After that final UI edit, the detector ran exactly once over eight final UI targets, including `AccountWorkspace.jsx`, exited `0`, returned the full JSON output `[]`, and persisted all target SHA-256 values in `account-detector-evidence.json`. Thus the honest record is total invocations `4`, invalidated prior runs `3`, final-after-all-edits `1`; the detector was not replayed during recapture or documentation closeout.

## Files and commits

Final product source `3057bcd` and final capture-test source `e3eb0b3`:

- `src/kordynV2/domains/account/capabilitySurfaces.js`
- `src/kordynV2/domains/account/stateSurfaces.js`
- collision-safe Position geometry, mobile Account layout, and Desktop/APP shell-owned support docks
- own-data-descriptor-safe Account state surfaces and exact list disclosure
- Account browser fixture/runner, provenance helper, state/interaction/geometry/readability tests
- governed comparator scope support and Account performance ownership gates
- unique Desktop page-main semantics and whitespace-safe financial/approval projection

Evidence `414ab7d`:

- `.impeccable/review/kordyn-v2/account/**`
- `.impeccable/review/kordyn-v2/account-compare/**`

Documentation closeout:

- `docs/kordyn-v2-evidence.md`
- `.superpowers/sdd/2026-08-26-kordyn-v2-03-account-domain/progress.md`
- this report

Detector record `8e300e4`:

- `.impeccable/review/kordyn-v2/account-detector-evidence.json`
- `.impeccable/review/kordyn-v2/account-detector-evidence.pre-support-review-invalidated.json`
- `.impeccable/review/kordyn-v2/account-detector-evidence.pre-semantic-review-invalidated.json`

Historical and superseded only: prior canonical product/evidence/docs checkpoint `312a3c5` / `6000a33` / `29ce80a`, detector checkpoint `ffdd653`, the pre-support-review chain `857e078` / `41db7e2` / `b153363` / `4e009a1`, and the still earlier chain `bfbdce3` / `8481550` / `41df7ae`. The reused `e3eb0b3` capture-test source is not superseded.

## Review finding closure

| Finding | Final closure evidence |
| --- | --- |
| I1 — real four-viewport interaction coverage | `11` accepted interactions cover all nine Account object types on both Desktop widths plus real Position and Trade plan clicks on APP `390/430`. Per-step Root/Context/Proof identities, sheet close, focus return, and two fail-closed adverse candidates are in the capture sidecar. |
| I2 — large-list truth | Unit tests preserve accepted `64` as complete and require exact incomplete disclosure for bounded `180` input. The final real browser fixture independently renders all `180 / 180` Market rows through `ASSET180/USDT`. |
| I3 — hostile state input isolation | Primitive reads require own data descriptors; top-level, list, and partial-effect tests cover null, throwing getters, revoked proxies, objects, and symbols while preserving valid siblings and preventing secret text/crashes. |
| I4 — source provenance | Canonical evidence separately stamps product `3057bcd` and capture-test `e3eb0b3`. The helper scopes all `src/**` plus runner/HTML/JSX/fixture/config owners, rejects tracked/staged/untracked relevant dirtiness, verifies commit existence and scoped trees, and is tested in temporary repositories. |
| I5 — comparator scope truth | Account CLI output is unambiguous: top-level `1 / 1 / 0`, `scopeCounts 15 / 1 / 1 / 0 / 14`; historical AI evidence is preserved and not rewritten. |
| I6 — price-boundary collision | Real-browser rectangles record non-overlap at `1440x900` (entry bottom `485`, mark top `493`) and `1180x800` (entry bottom `545`, mark top `553`). |
| I7 — final detector provenance | Four total invocations are disclosed: three prior passes invalidated by later UI edits, then exactly one post-semantic-review final-after-all-edits pass over eight targets with exit `0`, full `[]`, and target SHA-256 values. |
| M1 — mobile financial-label readability | At `390px`, detail/truth/inspector widths are each `372px`; `ETH/USDT`, sources, ownership labels, entry/mark prices, and protection reason are one-line, non-character-wrapped, and unclipped. |
| Post-review Important — AI support overlap | A real shell-owned dock partitions support from the work canvas at `1440/1180/390/430`. Baseline and stale/degraded/long-content/large-list start/end ledgers all report zero dock/canvas overlap and zero intersections with visible interactive or essential evidence regions; `ASSET7` and its `44x44` watch target remain fully hit-testable. |
| Whole-plan Important — duplicate Account main | Real-shell Account and Position route regression proves one page `<main>`; the Account ledger is a labelled `section` without visual box changes. |
| Whole-plan Important — blank facts became zero/approval-ready | Position and Plan regressions prove whitespace-only finance/evidence remains missing, Plan authorization is disabled with zero real action calls, and exact authoritative numeric strings remain valid. |
| Whole-plan Important — post-fix provenance | Canonical browser/comparator evidence was regenerated from product `3057bcd`, committed as `414ab7d`, and passes the strict product/capture owner tree checks. |

## Limitations and stop condition

- Pixel metrics are diagnostic; the committed machine verdict still requires the recorded human review.
- APP Account evidence proves shared product model, real production components, interaction structure, touch/keyboard boundaries, and overflow safety; it is not an immutable-raster fidelity comparison.
- Physical-device, live exchange payload, and network variance remain outside this local browser checkpoint.
- Plan 03 remains subject to the final post-documentation whole-plan independent read-only verdict with Critical `0` and Important `0` before it can be called complete.
- Work stops after Plan 03 verification. Plan 04 and production implementation/cutover remain unauthorized.

## Fresh closeout verification

- Focused Account/comparison/performance contracts: `207 / 207`, exit `0`.
- Real production Account browser and canonical recapture: exit `0`; product `3057bcd`, capture-test `e3eb0b3`, `4` captures, `13` states, `11` canonical interactions, `2` fail-closed adverse interactions, `4` fixture-authority writes, `1` poster download, support isolation pass, Account CSS loaded, legacy authenticated CSS absent.
- Governed Account comparator to an isolated temporary output: exit `0`; `1` scoped / `1` completed / `0` pending; machine verdict `human region review required`. The generated index differed from the committed index only by its temporary `outputRoot`.
- Isolated performance build: exit `0`; Account CSS `114,606 / 120,000`, AI shell CSS `55,847`, public and AI budgets pass, no forbidden legacy CSS, source and checked-in `dist` unchanged, temporary build removed.
- Full repository suite: `2058 / 2058`, exit `0`.
- ESLint: exit `0`.
- Production build: exit `0`; Vite transformed `1720` modules.
- `git diff --check`: exit `0` before documentation commit.
