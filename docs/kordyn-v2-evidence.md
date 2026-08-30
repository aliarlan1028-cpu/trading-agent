# KORDYN V2 implementation evidence

## Current governed comparison status

- Current Account product source: `312a3c590c8759940cfbf82fc9eb1342c7bbcc79`.
- Current Account capture-test source: `e3eb0b3c216eafe9a63ed6b40ec998f693ba50a2`.
- Current Account detector-record commit: `ffdd653a22495ff5c6a1cc5dccc36b8f10dcbee2`.
- Current Account evidence commit: `6000a338520cbb628e8889a283a6ce0127426eff`.
- Current comparison scope: Foundation Plan 01 shared shell, completed Plan 02 AI-domain checkpoint, and completed Plan 03 Account Position checkpoint.
- Completed governed concept comparisons: `5 / 15` — Desktop AI Mission, Desktop AI Signals, APP AI Mission, APP AI Approval, and Desktop Account Position.
- Pending domain implementation: `10 / 15` — no production comparison or fidelity claim is made for these remaining surfaces.
- Current Plan 03 Task 5 verdict: Account scope comparator reports `1` scoped concept / `1` completed / `0` scoped pending, with the machine verdict `human region review required`. Pixel MAE is diagnostic only; original-size human review recorded the Account-specific visual deltas below instead of treating the comparison as pixel equivalence.

## Plan 03 Account-domain checkpoint — Task 5

Task 5 closes the Account-domain state/capability/evidence gate against product source `312a3c590c8759940cfbf82fc9eb1342c7bbcc79`, capture-test source `e3eb0b3c216eafe9a63ed6b40ec998f693ba50a2`, detector-record commit `ffdd653a22495ff5c6a1cc5dccc36b8f10dcbee2`, and evidence commit `6000a338520cbb628e8889a283a6ce0127426eff`. The pre-support-review `857e0787adde4b8529a26a1ec3775fee3b49a4e0` / `41db7e2feca86e71ef1d874d3c94372ea56a393a` / `b1533631a59089ca79c1de148f3a178f549631c4` / `4e009a1` chain and the still earlier `bfbdce394dc21617b5b0ab070e62f475a5e77bd4` / `8481550253838203c596757a69915f7b8c725f7d` / `41df7ae66ccc0d3ae87ffabae4688b19559acd73` chain are historical and superseded; neither is the source of the final pixels or claims.

The Account master browser runner mounts the real production `KordynV2Root`, lazy `domains/account/index.jsx`, real Account presenters, canonical selection resolver, state boundary, `ConfirmHost`, and `createV2Actions().account`. Its fixture is production-shaped and credential-free; all protected actions are captured as fixture-authority writes inside the browser ledger and no production write interface is called.

### Account capability ownership — 11 / 11

Every deployed `live.*` capability is now backed by `ACCOUNT_CAPABILITY_SURFACES` with a registered Account workspace, real legacy route from `KORDYN_V2_WORKSPACES`, Desktop and APP presenter, object identity, action boundary, permission boundary, and resource-state boundary.

| Capability | Workspace / route | Object and action truth |
| --- | --- | --- |
| `live.overview` | `account / marketAccount` | Read-only Account truth summary; no standalone mutable object. |
| `live.market` | `market / market` | Market by bounded symbol/id; only watchlist and reconciliation boundaries already present. |
| `live.account` | `account / marketAccount` | Account by unique `exchangeAccounts[].id`; snapshots are freshness evidence. |
| `live.positions` | `positions / positions` | Position by `id → positionId → instId → symbol`; selection is read-only. |
| `live.execution` | `plans / executionReview` | Deployed object remains `Trade plan`; approve/reject delegates to the existing AI authority. |
| `live.orders` | `orders / tradeLedger` | `Execution` and `Order` remain separate; no cancel/amend action is invented. |
| `live.fills` | `fills / tradeLedger` | Fill and closed lifecycle facts stay distinct. |
| `live.protection` | `positions / positions` | Sole protected close boundary remains existing `exitExecutionOrder` when eligible. |
| `live.reconcile-status` | `account / marketAccount` | Existing reconcile action/result and freshness facts only. |
| `live.review-status` | `fills / tradeLedger` | Real Review linkage; navigation is not treated as proof a Review exists. |
| `live.closed-trade-poster` | `fills / tradeLedger` | Exact reconciled Closed trade → unique closed Execution → server PNG download. |

The state/capability test rejects invented cancel/amend, client poster generation, translation, automatic delivery, and raw presenter data reads.

### Account state evidence — 13 / 13

The Account state sidecar is `.impeccable/review/kordyn-v2/account/state-evidence.json` with SHA-256 `d6ba3026bd600136e26e21e6f3fff61471f2b0f25f683276a8466809a5985e58`. It records `13` real Root-mounted state screenshots, all with document overflow `0`.

| State | Evidence note |
| --- | --- |
| `loading` | Real shell/state panel; no last-valid facts reused. |
| `empty` | APP `390x844`; authoritative empty result distinct from missing/failure. |
| `processing` | Desktop `1180x800`; real Trade plan approve was clicked, `data-action-state="processing"` is visible, confirmation is open, terminal success is absent, and fixture authority writes remain `0`. |
| `stale` | APP `390x844`; last-valid source/time retained and protected mutation disabled. |
| `degraded` | APP `430x932`; last-valid source/time retained and protected mutation disabled. |
| `failed` | Desktop `1440x900`; explicit retry/read-failure boundary. |
| `forbidden` | APP `390x844`; protected facts and mutation controls absent. |
| `disabled` | Desktop `1180x800`; disabled is distinct from failed/forbidden. |
| `approval` | APP `430x932`; waiting-for-approval state does not imply execution. |
| `partial` | Desktop `1440x900`; real approve action returns partial. Sidecar separates completed `approval consumed` from failed `capacity_changed`; the screenshot shows the product-level partial result and does not claim to render a completed/failed list. |
| `no-result` | APP `390x844`; no-result is distinct from empty/failure. |
| `long-content` | APP `390x844`; real closed-trade detail contains the bounded authoritative body through `完整财务证据链 #72`, scrollable without horizontal overflow. |
| `large-list` | APP `430x932`; real Market list reports and renders all `180 / 180` authoritative identities, from `ASSET1/USDT` through `ASSET180/USDT`, and remains vertically scrollable. |

Missing finance remains `Unavailable`; a finite authoritative `0` remains `0`. Hostile values are read only through own data descriptors and isolated per item; nulls, throwing getters, revoked proxies, objects, and symbols cannot crash the surface, expose secret text, or erase valid siblings. The real browser's 180-row fixture is complete. Separately, adapter input above the explicit 96-row evidence bound visibly reports exact shown/source counts and incomplete evidence status instead of silently truncating or claiming completeness.

### Fresh Account captures and comparison

Capture root: `.impeccable/review/kordyn-v2/account/` (`19` files: 17 PNGs and two sidecars). Comparison root: `.impeccable/review/kordyn-v2/account-compare/` (`9` files: six PNGs, two geometry ledgers, and one index).

| Capture | Dimensions | SHA-256 | Overflow | Role |
| --- | ---: | --- | ---: | --- |
| `desktop-account-position--1440x900.png` | `1440x900` | `7eff9bfd8c1001b23861f9dccc6fb89620da9f01e14669dc1bb873b1a5c1b871` | `0` | governed comparison actual; entry/mark non-overlap; support dock outside canvas |
| `desktop-account-position--1180x800.png` | `1180x800` | `0656942a67e22a6301c58a4b3cda27d355d4708065d087a01f3762e14d0d3cf2` | `0` | governed comparison actual; entry/mark non-overlap; support dock outside canvas |
| `mobile-account-position--390x844.png` | `390x844` | `eaef45dcd2dfbf088462337af26e64eff49d48ee16f94c1ad085051987d0885e` | `0` | structural APP evidence; stacked readable detail; reserved support strip |
| `mobile-account-detail--430x932.png` | `430x932` | `d4a46110a54cb61df047d76248bd8bd8536e71b406fbe8ad7f402cc390d0cf8d` | `0` | structural APP evidence; reserved support strip |

Capture sidecar SHA-256: `601132fc9e5b770fb44fc5f95f7dc8d539af09c0a3ebecdfaac1e1bad4e3f996`. Comparison index SHA-256: `cdff14f01f69620f9d15b2397f2bc961fb943c4c58956079c49384dca110caa5`.

| Identity | Approved source SHA-256 | Actual SHA-256 | Pixel MAE | Machine verdict |
| --- | --- | --- | ---: | --- |
| `desktop-account-position--1440x900` | `38d6a875aa1cd26af0ef19510fe993255c572d97468ad9a940d734c92acfd148` | `7eff9bfd8c1001b23861f9dccc6fb89620da9f01e14669dc1bb873b1a5c1b871` | `0.054344026870007264` | human region review required |
| `desktop-account-position--1180x800` | `38d6a875aa1cd26af0ef19510fe993255c572d97468ad9a940d734c92acfd148` | `0656942a67e22a6301c58a4b3cda27d355d4708065d087a01f3762e14d0d3cf2` | `0.054280473856209155` | human region review required |

Account scope-local comparison truth is explicit in the index: manifest `15`, scoped concepts `1`, completed scoped concepts `1`, scoped pending `0`, out of scope `14`. Cumulative governed coverage is now `5 / 15`; the remaining non-Account and future-domain rasters are not reclassified as Account pending and are not filled with stale screenshots.

Original-size human review opened all `23` final PNG images after the support-dock correction: 17 Account actual/state captures and six Account comparison reference/overlay/difference images. The Desktop Account Position actual keeps the Account domain, Position workspace, selected `Position / position-eth`, Context/Proof access, protection evidence, safety action, related execution/protection record table, Account truth strip, and bounded AI support in reserved shell chrome. Recorded deltas versus the immutable concept include the production surface's current two-position fixture, replacement of the richer concept chart cockpit with a bounded price-boundary/evidence composition, and production-shaped `Unavailable` facts where the concept uses denser illustrative market data. These deltas are recorded for human region review; no pixel-equivalence claim is made.

The interaction ledger contains `11` accepted steps. Desktop `1440x900` covers Market, Account, Position, and Trade plan; Desktop `1180x800` covers Execution, Order, Fill, Closed trade, and Review. APP `390x844` clicks a real Position, and APP `430x932` clicks a real Trade plan; both open real Context and Proof sheets, align visible type/id with Root selection, close through the product interaction, and return focus. Missing Execution candidates at Desktop `1440` and APP `430` retain the prior selection and record `failClosed:true`.

The Desktop price labels no longer collide: at `1440x900` entry bottom is `485` and mark top is `493`; at `1180x800` entry bottom is `545` and mark top is `553`. At `390px`, the detail, truth, and inspector each occupy the full `372px` content width; symbol, sources, ownership labels, entry/mark prices, and protection reason are all one-line, `word-break:keep-all`, `white-space:nowrap`, and not clipped.

The AI support launcher no longer overlays product content. It occupies a real shell-owned dock outside the work canvas: Desktop canvas/dock boundaries are `828/828` at `1440` and `728/728` at `1180`; APP boundaries are `714/714` at `390` and `802/802` at `430`. The four baselines plus stale, degraded, long-content, and large-list evidence record start/end `dockCanvasOverlap:0`, zero intersections with visible interactive and essential evidence regions, and a hit-testable support control. In the 180-row APP case, `ASSET7` remains fully inside the canvas, its object is hit-testable, and its watch target remains an exact hit-testable `44x44` control.

### Task 5 review-finding closure

| Finding | Closure |
| --- | --- |
| I1 | Four-view real Root interaction ledger: all nine object types on Desktop, real Account objects on both APP widths, Root/Context/Proof identity, close/focus return, and two fail-closed adverse cases. |
| I2 | Exact bounded-list disclosure in unit contracts and complete `180 / 180` real-browser Market evidence. |
| I3 | Own-data-descriptor primitive reads and item isolation cover null, getter, revoked proxy, object, and symbol attacks without losing valid siblings. |
| I4 | Separate product `312a3c5` and capture-test `e3eb0b3` provenance; commit/tree validation and tracked/staged/untracked scoped-source rejection. |
| I5 | Account comparator top-level `1 / 1 / 0`; `scopeCounts 15 / 1 / 1 / 0 / 14`; historic AI evidence remains unchanged. |
| I6 | Real `1440/1180` price rectangles have `overlaps:false`. |
| I7 | Detector total `3`: two prior passes retained but invalidated by later UI edits; one post-support-review final-after-all-edits pass, exit `0`, full JSON `[]`, seven target hashes. |
| M1 | `390px` mobile detail is single-column and its financial/source/ownership labels are readable and unclipped. |
| Post-review Important | Shell-owned Desktop/APP support docks produce zero canvas overlap and zero intersections at start/end across all required viewports and adverse state surfaces while preserving `ASSET7` and its `44x44` watch target. |

### Fresh Plan 03 Task 5 gates

- Review-fix TDD REDs were retained: state/list safety `17 pass / 2 fail`, comparator `4 pass / 4 fail`, provenance integration `1 pass / 1 fail`, overlapping Desktop price rectangles, clipped/wrapped `390px` labels, `64` instead of the required `180` browser rows, and missing APP Context/Proof triggers. Their GREEN contracts are represented in the final focused and browser gates below.
- Fresh focused Account/Task1-4/comparison/performance tests: `203 / 203`, exit `0`.
- Canonical Account master-browser evidence: exit `0`; product source `312a3c590c8759940cfbf82fc9eb1342c7bbcc79`; capture-test source `e3eb0b3c216eafe9a63ed6b40ec998f693ba50a2`; captures `4`; states `13`; accepted interactions `11`; adverse fail-closed interactions `2`; fixture-authority writes `4`; download `1`; support isolation pass; Account CSS `true`; legacy authenticated CSS `false`.
- Account comparator: exit `0`; top-level counts `1 / 1 / 0 / 2 / 9` for concepts/completed/pending/comparisons/artifacts, plus `scopeCounts 15 / 1 / 1 / 0 / 14`; verdict `human region review required`.
- Isolated performance build: exit `0`; public CSS/JS `15,304 / 381,073`; AI shell CSS `55,847`; Account domain CSS `114,606 / 120,000`; `loadsLegacyProductStyles:false`; `forbiddenLegacyCss:[]`; shared shell CSS is reported explicitly as Vite-owned shared dependency.
- AI actions compatibility after the scoped `ConfirmHost` style fix: exit `0`; approvals, partial/failure, poster, translation, dialog, disabled-state gates all pass.
- Impeccable detector: three session invocations total. `.impeccable/review/kordyn-v2/account-detector-evidence.pre-final-invalidated.json` preserves the first exit-`0` / `[]` pass invalidated by the mobile readability edit; `.impeccable/review/kordyn-v2/account-detector-evidence.pre-support-review-invalidated.json` preserves the second exit-`0` / `[]` pass invalidated by the support-dock edit. `.impeccable/review/kordyn-v2/account-detector-evidence.json` preserves the one post-support-review final-after-all-edits exit-`0` / `[]` pass and seven final target hashes. No detector replay occurred during evidence capture or documentation closeout.
- Full repository test suite: `2054 / 2054`, exit `0`.
- ESLint: exit `0`.
- Production build: exit `0`, `1720` modules transformed.

Task 5 does not enable a flag, cut over traffic, start Plan 04, modify backend/API/database/auth/permission/trading/risk behavior, deploy, merge, push, or remove legacy production code.

## Historical Foundation checkpoint — Plan 01 / Task 8

- Foundation remediation base: `342278a01c2194e9791a3065297263d10e920993`.
- Visual authority: the 15 immutable sources pinned by `docs/kordyn-v2-approved-concept-manifest.md`.
- Historical comparison scope at that checkpoint: Foundation Plan 01 shared shell only.
- Historical completed comparisons at that checkpoint: `2 / 15` — Desktop AI Mission shell and Mobile AI Mission shell.
- Historical pending count at that checkpoint: `13 / 15`.
- Historical independent verdict: **Task 8 APPROVE — 0 Critical / 0 Important / 0 Minor; visual 390/430 PASS.** The position Important was formally withdrawn after response-boundary verification. Task 8 cleared the Foundation gate before Plan 02 began; the canonical current status is the `5 / 15` completed and `10 / 15` pending coverage recorded above.

## Staged concept coverage

| Concept | Device | Domain / workspace | Targets | Current status |
| --- | --- | --- | --- | --- |
| `desktop-ai-mission-control` | Desktop | `ai / missions` | `1440x900`, `1180x800` | Compared — Foundation shell and Plan 02 AI domain |
| `mobile-ai-mission-home` | APP | `ai / missions` | `390x844`, `430x932` | Compared — Foundation shell and Plan 02 AI domain |
| `desktop-ai-signals` | Desktop | `ai / intelligence` | `1440x900`, `1180x800` | Compared — Plan 02 AI domain |
| `desktop-account-position` | Desktop | `account / positions` | `1440x900`, `1180x800` | Compared — Plan 03 Account domain |
| `desktop-assets-relationship` | Desktop | `assets / relationships` | `1440x900`, `1180x800` | pending domain implementation |
| `desktop-strategy-registry` | Desktop | `assets / strategies` | `1440x900`, `1180x800` | pending domain implementation |
| `desktop-knowledge-incubator` | Desktop | `assets / knowledge` | `1440x900`, `1180x800` | pending domain implementation |
| `desktop-capability-registry` | Desktop | `assets / capabilities` | `1440x900`, `1180x800` | pending domain implementation |
| `desktop-review-owner-release` | Desktop | `assets / reviewRelease` | `1440x900`, `1180x800` | pending domain implementation |
| `desktop-governance-boundary` | Desktop | `governance / overview` | `1440x900`, `1180x800` | pending domain implementation |
| `desktop-governance-operations` | Desktop | `governance / tasks` | `1440x900`, `1180x800` | pending domain implementation |
| `desktop-governance-configuration` | Desktop | `governance / configuration` | `1440x900`, `1180x800` | pending domain implementation |
| `mobile-ai-task-approval` | APP | `ai / missions` | `390x844`, `430x932` | Compared — Plan 02 AI domain |
| `mobile-intelligent-assets` | APP | `assets / relationships` | `390x844`, `430x932` | pending domain implementation |
| `mobile-system-governance` | APP | `governance / tasks` | `390x844`, `430x932` | pending domain implementation |

The executable manifest independently verifies all 15 source SHA-256 values and stored dimensions before any comparison. A screenshot is mapped only to the same implemented product surface; unrelated pages are never used to fill the manifest.

## Fresh production-shaped captures

The real `KordynV2Root` shell runner used `tests/kordyn-v2-production-fixture.js`. Its machine-readable `capture-evidence.json` records actual DOM viewport/document geometry, actual action count, actual loaded stylesheet ownership, canonical `ai / missions` identity, and each PNG hash. The legacy-style probe covers stylesheet `href`, Vite `ownerNode[data-vite-dev-id]`, stylesheet links, and every deployed legacy authenticated stylesheet ID; a real injected legacy owner is detected before the clean result is accepted.

| Capture | Dimensions | SHA-256 | Document width | Writes | Legacy authenticated CSS |
| --- | ---: | --- | --- | --- | --- |
| `desktop-1440x900.png` | `1440x900` | `194892406891ef5b372e1364615eb4808e06bf22f23562028c0fe622ea6d9aee` | `1440 / 1440` | `0` | false |
| `desktop-1180x800.png` | `1180x800` | `a37413c105455ed0c7ffb569fa0165cc984c6e4d80821b384fa9282269111b46` | `1180 / 1180` | `0` | false |
| `mobile-390x844.png` | `390x844` | `bdb125d64a5748e4fdb884a04bee21fe3b88d91ab1a78a4397f6f0736b745fce` | `390 / 390` | `0` | false |
| `mobile-430x932.png` | `430x932` | `e8162bcfdfa5d57453568253bc291f77317dd4281e922bf0d4b17785d992dafb` | `430 / 430` | `0` | false |

Capture sidecar SHA-256: `677db2d05eaf64cef4990417e2697d2712d8d39b89bf60c14a3539037dcb4f1d`.

## Normalized comparison evidence

Output root: `.impeccable/review/kordyn-v2/foundation-compare/`.

- `4` comparison identities.
- `12` exact-viewport PNGs: normalized references, 50% overlays, and absolute differences.
- `4` deterministic geometry/provenance JSON files.
- `1` comparison index; total `17` artifacts.
- Re-running with identical inputs produces identical artifact hashes and removes a stale regular file from only the validated output directory.
- Pixel difference is recorded as `diagnostic only`. It is not a release verdict.
- Desktop retains the existing fixed shell thresholds and non-gameable content-aware comparator; both fresh Desktop captures are accepted by that diagnostic contract.
- Geometry and original-resolution human region review remain authoritative.

Comparison index SHA-256: `6e308a1240683b17382665f2bb7e8b445f01ff096ce514df9670071e451923d6`.

Diagnostic results:

| Identity | Document overflow | Pixel MAE | Content-aware shell diagnostic |
| --- | ---: | ---: | --- |
| Desktop `1440x900` | `0` | `0.049300` | accepted; fixed threshold retained |
| Desktop `1180x800` | `0` | `0.054755` | accepted; fixed threshold retained |
| APP `390x844` | `0` | `0.079157` | no fixed APP threshold in Foundation Plan 01 |
| APP `430x932` | `0` | `0.078317` | no fixed APP threshold in Foundation Plan 01 |

## Original-resolution human review

### Desktop shared shell

The four-domain rail, AI local navigation, account-truth band, queue / mission / context topology, bottom command surface, and bounded AI 客服 all occupy the approved reading order and broadly matching proportions at both widths. Real production-shaped labels and controls create visible local typography and horizontal-position differences. These are recorded differences; the diagnostic comparator does not erase them. No Desktop shell difference observed in this foundation review independently blocks the next plan.

### APP shared shell — Task 8 independent-review fix round 3

The approved `853x1844` source (`6e0eda474f6658ff9dbfcbc6b18d4503203a78ddb30e38aa22b0760c1c902c9b`), both normalized references, both fresh production captures, both 50% overlays, both absolute differences, and the governed Proof sheet were opened at original resolution after the final capture.

- The header ends at `214px` at both widths and follows the approved compact identity → title → five AI destinations → three-column truth reading order. Canonical compact Assets and critical Governance truth modes are no longer overridden by MobileShell; only the loaded domain contract decides the non-Mission mode.
- The active Mission is again visibly nested inside an `AI 交易员` runtime frame. Its real top is `248px` at both sizes, satisfying the unchanged `<250px` hard contract; the outer frame is at least `190px`, the nested Mission is at least `148px`, and Mission stages/facts compute to at least `11px`.
- The five-stage projection is the canonical `Sense → Plan → Guard → Execute → Monitor` sequence with the product labels `快扫 / 结构 / 风控 / 执行 / 等待回踩`. Each connector is painted only from its real stage status; unknown and waiting stages never appear complete.
- Canonical `waiting` remains `data-stage-state="waiting"` but is now presented as `等待` in the Chinese Mobile Mission UI. This necessary text-only change does not alter the cleared geometry.
- The single secondary `证据` control opens a governed Details/Context/Proof tab set. Details restores the loaded strategy, knowledge source, capability, event, and selected-position impact; tabs have one roving stop, ArrowLeft/ArrowRight/Home/End behavior, `aria-controls`, and a labelled `tabpanel`.
- Details, identity, Context, and Proof now read one selection snapshot captured atomically with the Details facts. A real Root live-refresh regression proves an open sheet retains revision A (including an explicit null selection), while the background advances to revision B; closing and reopening atomically adopts revision B. Inertness, Escape focus return, and zero writes remain intact.
- At `390x844`, `需要你`, `账户影响`, and both real `最近完成` rows remain visible. The second row ends at `726px` and the prompt starts at `730px`; neither prompt nor AI 客服 covers an actionable row.
- At `430x932`, height-aware rhythm moves `需要你 / 账户影响 / 最近完成` to `448 / 547 / 698px`; the second row ends at `799px` and prompt starts at `808px`, avoiding both overlap and a dead zone.
- Recent-source completeness now requires all three authoritative arrays. A real partial fixture with one source absent projects `Unavailable` instead of claiming there are no completed Missions/runs.
- Only the confirmed unreachable old mobile `MissionControl` override block was removed; destination/dialog mobile styling remains intact.
- The concept’s unsupported daily PnL is not fabricated. Production overview response boundaries already call `server/positionView.mjs::normalizePositionsForUi`, which merges engine/REST/WS mirrors and emits canonical `quantity=coinSize`, `pnl/unrealizedPnl`, and `notional=coinSize×mark`. A test-only integration sends three real raw mirrors through that existing server projection before mounting the real Root and proves one position, `123.45` PnL, `3,400.00` notional, and no fabricated `0.00`; no client schema or backend/API change was added.
- Loaded pending-action/risk-incident identity remains canonical and read-only. Notification, four roots, all five AI-local destinations, prompt, AI 客服, and evidence navigation invoke zero production writes.

Final historical Task 8 review reports `APPROVE`, `0 Critical / 0 Important / 0 Minor`, and original-resolution visual PASS at both `390x844` and `430x932`. The round-3 position Important was formally withdrawn because the actual server response boundary already owns normalization, backed by the integration contract above. Pixel metrics remain diagnostic only. Physical-device and live-payload variance remain a recorded non-blocking limitation. Task 8 cleared the Foundation gate before Plan 02 began; the canonical current Task 5 status is recorded at the top of this document.

## Fresh isolated performance evidence

The performance runner builds current source through Vite into an owned temporary directory with `manifest: true`, analyzes the emitted module graph, and removes the directory in `finally`. It does not read a stale checked-in `dist`, and it verifies `src` and checked-in `dist` tree hashes remain unchanged.

| Surface | Raw CSS | Gzip CSS | Raw JS | Gzip JS | Budget |
| --- | ---: | ---: | ---: | ---: | --- |
| Public initial | `15,304` | `3,746` | `375,164` | `123,897` | CSS `<40,000`; JS `<450,000` — pass |
| Authenticated V2 AI shell, cumulative | `76,273` | `14,164` | `458,606` | `147,392` | CSS `<180,000` — pass |
| Legacy authenticated style route | `843,660` | `141,376` | `46` | `66` | reported for ownership evidence; not loaded by V2 |

Ownership is derived from the emitted manifest graph: the unique HTML `isEntry`, the `src/kordynV2/entry.jsx` dynamic target and its static `imports`, and the separate `src/productStyles.js` target. Hashed filenames are not used to guess route ownership. The V2 route reports `loadsLegacyProductStyles: false` and no forbidden legacy CSS intersection.

## Safety and isolation

- Task 8 changes only the mobile authenticated shell composition and its governed evidence-sheet presentation. Desktop composition, routes, APIs, databases, permissions, trading, risk, auth, cutover, and default enablement are unchanged.
- Production reads the existing `data`, Account Truth, canonical selection, state, routes, and support context. No fixture is imported by production and no action/write boundary was added.
- Comparison reads only allowlisted concept and capture paths inside the repository and writes only to the explicitly validated review output root.
- Traversal, symlink escape, changed source hash, missing or duplicate capture identity, zero-byte or near-flat image, wrong dimensions, document overflow, authority writes, legacy CSS co-loading, and stale output all fail closed.
- Output cleanup validates containment and rejects symlinks before removing only the exact output directory.

## Gate status

Completed freshly during Task 8:

- focused manifest, comparison, performance, architecture, cutover, state, action, shell, and support tests: `65 / 65`;
- full repository test suite: `1746 / 1746`;
- ESLint: exit `0`;
- production build: exit `0`, `1674` modules transformed in `1.18s`; only the existing chunk-size advisory remains;
- canonical-selection browser: exit `0` across AI, Live, Lab, Control, Operations, APP object surfaces, Context, Trace, and keyboard rejection paths;
- cutover/recovery browser: exit `0` with `retry=1`, `legacy=1`, `api=0`;
- public/auth browser: exit `0` at `1440x900`, `390x844`, and `430x932`, with no overflow and all required login, MFA, registration, modal, focus-trap, and Escape paths;
- fresh isolated production build performance runner: exit `0`; public CSS/JS `15,304 / 375,164`, V2 AI shell CSS/JS `76,273 / 458,606`, all explicit budgets pass, legacy CSS ownership is false, and source/dist integrity remains unchanged;
- combined real Desktop and APP V2 shell browser: exit `0` at all four required viewports; Desktop and APP each report four roots, three focus checks, zero document overflow, and zero writes, while APP additionally reports `44px` targets, five fail-closed states, two long-content checks, governed Details/Context/Proof tabs, canonical stage status, and the required first-viewport geometry;
- fresh four-comparison artifact generation: exit `0`, `15` concepts / `2` completed / `13` pending / `4` comparisons / `17` artifacts;
- every final mobile base, normalized reference, overlay, absolute-difference, and governed Proof-sheet PNG was reopened at original resolution for human review;
- Impeccable detector over the two round-3 changed production UI targets: exit `0`, `[]`;
- hard scans found no `!important`, legacy stylesheet import, or production-fixture import under `src/kordynV2`;
- `git diff --check`: exit `0` before report finalization.

The final historical Task 8 review supplements the Foundation mechanical gates with `APPROVE`, `0 Critical / 0 Important / 0 Minor`, and visual PASS at both required APP sizes. At the close of Task 8, Plan 02 had not yet begun; that historical point is superseded by the canonical current Task 5 status above.

## Plan 02 AI domain checkpoint — Task 5

Task 5 closes the AI-domain evidence gate against production and capture source commit `0f44ddfa2e5f9344a9820e1d68c25dd34eaad9e3`. The evidence runner mounts the actual production `KordynV2Root` and its committed lazy AI domain. `tests/kordyn-v2-production-fixture.js` supplies bounded production-shaped data and authoritative delayed outcomes; it is not imported by production, contains no credentials, and performs no production write. The canonical capture sidecar, state sidecar, comparison index, and every AI geometry ledger record or inherit this exact product commit; the later evidence/docs commit does not replace this source provenance.

### Capability ownership — 8 / 8

Every deployed `ai.*` capability resolves to a concrete production presenter, registered workspace/route, existing authoritative action boundary, resource-state/permission boundary, and separate Desktop and APP entry. Registry presence alone is not counted.

| Capability | Production presenter | Workspace / route | Authoritative action boundary | State / permission boundary | Desktop entry | APP entry |
| --- | --- | --- | --- | --- | --- | --- |
| `ai.dialog` | `AiDialogWorkspace` / `MobileAiDialogScreen` | `dialog / chat` | `readDialog`, `sendDialog` via `/api/agent/chat` | authenticated RBAC; mutation only while `chat` is ready | AI → 对话 → bounded dialog | AI → 对话 → full-screen conversation |
| `ai.autonomous-patrol` | `AiMissionWorkspace` / `MobileAiMissionScreen` | `missions / chat` | read-only Mission projection; approval stays protected | last-valid facts only for stale/degraded | AI → 任务 → Registry/Inspector | AI → 任务 → task-led Mission flow |
| `ai.intelligence` | `AiSignalsWorkspace` / `MobileAiSignalsScreen` | `intelligence` | `rememberIntelligence` via `/api/agent/memory` | current canonical Signal and ready `operationsCenter` | AI → 情报 → Signal Registry | AI → 情报 → list/detail |
| `ai.watch` | `AiWatchWorkspace` / `MobileAiWatchScreen` | `watch` | `cancelWatch` via `/api/watch-triggers/:id/cancel`; hit only re-analyzes | current active Watch and ready `chat` | AI → 观察哨 → Watch Registry | AI → 观察哨 → list/detail |
| `ai.events` | `AiEventsWorkspace` / `MobileAiEventsScreen` | `events / eventsTasks:events` | `refreshEvents` via `/api/event-sources/refresh` | current Event Context and ready `operationsCenter` | AI → 事件日历 → Event Registry | AI → 事件日历 → list/detail |
| `ai.poster-current` | `AiOutputSheet` | `missions / chat` | open supported current poster from a real Mission/message | authoritative facts must be ready | Mission → 生成海报 | Mission task → 生成海报 |
| `ai.poster-translate` | `AiOutputSheet` | `missions / chat` | `translatePoster` via `/api/posters/translate`, Chinese/English only | translation disabled outside ready authoritative facts | Output → English | Output → English |
| `ai.poster-png` | `AiOutputSheet` | `missions / chat` | real `html-to-image` render, then injected download | export disabled outside ready authoritative facts | Output → PNG | Output → PNG |

The fresh state/capability contract is `14 / 14`: one 8-capability ownership test plus all 13 canonical state tests.

### Canonical state evidence — 13 / 13

| State | Canonical rule proven by real Root evidence |
| --- | --- |
| loading | no last-valid facts or mutation presenter; semantic loading heading |
| empty | authoritative empty result; no stale facts reused |
| processing | authoritative facts may remain visible, but no terminal success appears before response |
| stale | exact last-valid source/as-of retained; protected mutations disabled; read-only dialog only |
| degraded | exact last-valid source/as-of retained; protected mutations disabled; read-only dialog only |
| failed | no last-valid facts or protected controls reused; retry boundary remains explicit |
| forbidden | protected facts and mutation presenters absent |
| disabled | disabled remains distinct from forbidden/failed and exposes no mutation path |
| approval | confirmation required; no authorization or execution implied |
| partial | authoritative partial result stays visible and never becomes optimistic success |
| no-result | no server result remains distinct from empty or failed |
| long-content | the complete authority string remains rendered with zero horizontal overflow |
| large-list | all 64 authoritative Mission identities remain rendered with zero horizontal overflow |

Canonical `state-evidence.json` covers the 13 screenshots at the four immutable viewport sizes. Loading/empty/failed/forbidden never reuse last-valid facts. Stale/degraded trusted clicks produce zero authoritative writes and retain `Task 5 bounded production-shaped authority / 2026-08-30T00:12:00.000Z`. APP `390 / 430` document and shell widths are exact, all protected touch targets are at least `44px`, and Prompt/support/navigation/protected actions do not intersect.

### Trusted production interaction evidence

The fresh master gate physically clicks real production rows and controls for Mission, Signal, Watch, Event, one-shot approval, dialog, translation, and PNG output. The identity chain is the clicked row type plus Root selected ID/type plus Context and Proof `Type / ID`. Mission Proof also exposes the exact `createdAt=2026-08-30T00:01:07.000Z` and `updatedAt=2026-08-30T00:12:11.000Z`; missing `completedAt` remains `Unavailable`.

Approval is exercised with a delayed authoritative response: processing appears first, terminal success is absent before the response, and authoritative failed/partial outcomes remain visible. Dialog POST is followed by the authoritative GET reread. PNG evidence uses the real `html-to-image` path after fonts are ready; it is not stubbed. Keyboard focus containment, Escape close, focus return, APP target size, and zero authority writes in every capture document are asserted. At both `390` and `430`, an open Approval removes the support launcher from rendering, layout, focus, and the accessible interaction path; support-primary, support-navigation, and primary-navigation overlap are all `0`. The primary action remains `52px` high, the bottom navigation remains `62px` high, and protected focus remains inside the Approval. Closing restores the enabled `56x56` support target; a trusted click opens its real sheet and Escape returns focus to the launcher.

### Whole-branch final-review closure

The final product commit is `0f44ddfa2e5f9344a9820e1d68c25dd34eaad9e3`, based on `98a7969665ccaca9aa07a003f4f813b67fce623a`. It closes only the four whole-branch review findings:

- Approval blockers/warnings, chat roles/content, and Context Watch status/source now accept bounded primitive string/finite-number/boolean facts only. Null-prototype records, accessors, arbitrary coercion hooks, iterators, and sibling malformed objects are omitted or shown as `Unavailable`; independent Mission, Signal, Watch, and Event truth remains present. The initial regressions failed `40 / 38 / 2` with both null-prototype crashes. A sibling boolean-role regression then failed `35 / 34 / 1`; the final primitive and string-only-role boundaries pass.
- Desktop Watch/Event and APP Signal/Watch/Event readonly rows are real clickable inspection controls: `aria-disabled` and native disabled semantics are absent; `data-kordyn-v2-readonly-fact="true"` and `aria-description="只读事实，可查看详情，不会改变当前对象"` disclose the boundary. Trusted CDP clicks change the local Inspector, preserve exact Root ID/type, expose no partial canonical row attributes or Proof, and leave selectable sibling synchronization intact.
- At `1440x900` stale, the retained notice is `176,128–1230,162`, the Context/Proof dock is `1250.640625,137–1415,167`, and overlap is `0px²`. At `1180x820` degraded, the respective rectangles are `160,120–970,154` and `1001.640625,126–1166,156`, also `0px²`. The full `Read-only AI context last-valid projection · 2026-08-27T06:32:11Z` remains visible, and both dock actions stay focusable and accept trusted clicks.
- A rejected real PNG generation path shows only `PNG 生成暂时失败，未开始下载。请重试。`; a secret-like thrown diagnostic is absent from the sheet and page DOM. No download occurs on failure, retry remains usable and focused, and success is rendered only after the real canvas export is restored and produces a download.

Each fix has an adversarial mutation: generic scalar coercion fails `40 / 38 / 2`; restored readonly disabled semantics fail the real Desktop Watch click; removed notice spacing restores `4108.984375px²` overlap; restored raw PNG error copy exposes the secret-like diagnostic. All mutations were independently restored before the product commit.

### Canonical AI captures and comparisons

Capture root: `.impeccable/review/kordyn-v2/ai/` (`23` files: eight approved-surface captures, 13 state captures, and two sidecars). Comparison root: `.impeccable/review/kordyn-v2/ai-compare/` (`33` files: 24 reference/overlay/difference PNGs, eight geometry ledgers, and one index).

| Identity | Actual SHA-256 | Approved source SHA-256 | Overflow | Pixel MAE | Fixed content diagnostic |
| --- | --- | --- | ---: | ---: | --- |
| Mission Desktop `1440x900` | `9e8a1fae3e0e208a042017aa70294b06ba2fadd94336df74bbef07370c694770` | `55f988f9c87d1dce83d528bd2ad224b0951542cbab32eca018bf6c78818dbc20` | `0` | `0.051465` | `0.037187 ≤ 0.0415`; structure accepted |
| Mission Desktop `1180x800` | `9c8815bb273f083283deb19fcb82093df148788820742d0f75edf375527015a2` | `55f988f9c87d1dce83d528bd2ad224b0951542cbab32eca018bf6c78818dbc20` | `0` | `0.062632` | `0.047456 ≤ 0.0475`; structure accepted |
| Signals Desktop `1440x900` | `1e134ec13519e4f9d9f1ecd35c4df3a61c83a995a31d3800bb7a3edfe41d1f16` | `beec4a413a6c1c174ea25fed47c862163415a9d577771feace2a80c715e2b283` | `0` | `0.061542` | human region review |
| Signals Desktop `1180x800` | `818dfa20fa2b7749f7db07e2537204a5d27786b2acffa70c5a54fd5690fd327d` | `beec4a413a6c1c174ea25fed47c862163415a9d577771feace2a80c715e2b283` | `0` | `0.067880` | human region review |
| Mission APP `390x844` | `8b716b0d6966ad0c9be36e47d0d66bbe5773c4185fa9aaf99c52043d1b383590` | `6e0eda474f6658ff9dbfcbc6b18d4503203a78ddb30e38aa22b0760c1c902c9b` | `0` | `0.078199` | human region review |
| Mission APP `430x932` | `b42e0ef4f6d34cd7d9ba4c84f333703db548d8605458e3e5bc65e6ba60a1ecd9` | `6e0eda474f6658ff9dbfcbc6b18d4503203a78ddb30e38aa22b0760c1c902c9b` | `0` | `0.074845` | human region review |
| Approval APP `390x844` | `f5c8d0b59423115e173c94e3d2b4974fc691ead9ab30fd88108bf90c8bc04a82` | `341997877d9cf8cbae27b6f2f31c5cb79b546927a3e5b3ac3d9efea5c11f0778` | `0` | `0.084428` | human region review; protected actions isolated |
| Approval APP `430x932` | `e1d293f05c4d90b19b4f206c09cd49a8a97eff5e81d09b5377529b92b1785f76` | `341997877d9cf8cbae27b6f2f31c5cb79b546927a3e5b3ac3d9efea5c11f0778` | `0` | `0.085137` | human region review; protected actions isolated |

The comparator reports `15 concepts / 4 completed / 11 pending / 8 comparisons / 33 artifacts`. Its top-level verdict remains `human region review required`; pixel MAE is diagnostic only and no threshold was changed. Sidecar/index SHA-256 values are:

- capture: `18dc78a6a3a2a0b25753728a74ab5d69cea897c2325e203564f0a275a69a7a7b`;
- states: `d6fa17ee724650e9b7a21c3486e3fe9c16713b8a493fc62cc0e18f8e964193df`;
- comparison index: `b90d8a6f66475476091db449b2f5a7a99183bd3b56bf96eeac0258ff58836123`.

All eight final actuals and every normalized reference, 50% overlay, absolute difference, and geometry ledger were reopened at original size. Desktop Mission retains the approved queue / active Mission / lifecycle / decision summary / related context / runtime receipt hierarchy. Desktop Signals retains filters / dense Registry / Inspector / decision boundary / Watch-Event-Intelligence lower registries. APP Mission retains account truth / active Mission / attention / account impact / recent completion / command order. APP Approval retains task / plan / account impact / 12-of-12 risk / AI-used facts / acknowledgement / sticky guarded actions. The fresh Approval actuals contain no support-launcher sliver over the protected action region; the normalized reference still contains its historical launcher, so that local difference is an intentional safety correction rather than a product-model mismatch. Production-shaped fact availability, exact labels, icons, and local density differ from the concept rasters, but no remaining difference materially recomposes topology, density, hierarchy, protected state, or action meaning.

### Fresh Task 5 gates

- focused Task 1–5 and safety regression: `182 / 182`, exit `0`;
- full repository suite: `1874 / 1874`, exit `0`;
- ESLint: exit `0`;
- production build: exit `0`, `1702` modules transformed;
- isolated performance/manifest: public `375,992 / 450,000` JS and `15,304 / 40,000` CSS; AI shell `53,279 / 180,000` CSS; one unique public-owned structural V2 dynamic entry, exact AI child ownership, no legacy product styles;
- Task 2 Mission, Task 3 Context, Task 4 Actions, AI visual regression, APP overflow, and Task 5 master real-Chrome gates: exit `0` at all required viewports;
- Task 5 master: `8` captures, Mission/Signal/Watch/Event identity, failed+partial approval, Desktop+APP dialog/output, `13 / 13` states;
- AI comparator: `4 / 11 / 8 / 33`, exit `0`, unchanged references and thresholds;
- Impeccable exact JSX/registry detector: exit `0`, `[]`;
- the final-fix product commit changes only the ten scoped AI presentation/model/style files and four regression files. It does not change capability registries, API/auth/permissions/trading/risk/reference/threshold contracts, or any production fixture.

Task 5 does not enable a flag, cut over traffic, start Plan 03, modify API/auth/permissions/trading/risk behavior, deploy, merge, push, or remove legacy production code.
