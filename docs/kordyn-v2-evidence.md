# KORDYN V2 implementation evidence

## Current governed comparison status

- Current product/capture source for the newest completed Account-domain checkpoint: `bfbdce394dc21617b5b0ab070e62f475a5e77bd4`.
- Current Account evidence commit: `8481550253838203c596757a69915f7b8c725f7d`.
- Current comparison scope: Foundation Plan 01 shared shell, completed Plan 02 AI-domain checkpoint, and completed Plan 03 Account Position checkpoint.
- Completed governed concept comparisons: `5 / 15` — Desktop AI Mission, Desktop AI Signals, APP AI Mission, APP AI Approval, and Desktop Account Position.
- Pending domain implementation: `10 / 15` — no production comparison or fidelity claim is made for these remaining surfaces.
- Current Plan 03 Task 5 verdict: Account scope comparator reports `1` scoped concept / `1` completed / `0` scoped pending, with the machine verdict `human region review required`. Pixel MAE is diagnostic only; original-size human review recorded the Account-specific visual deltas below instead of treating the comparison as pixel equivalence.

## Plan 03 Account-domain checkpoint — Task 5

Task 5 closes the Account-domain state/capability/evidence gate against production and capture source commit `bfbdce394dc21617b5b0ab070e62f475a5e77bd4`. The evidence commit is `8481550253838203c596757a69915f7b8c725f7d`.

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

The Account state sidecar is `.impeccable/review/kordyn-v2/account/state-evidence.json` with SHA-256 `bbc82e37a4731472c6d15ee8c624cdac90b4ca2457da93ed1b4fb7564470716a`. It records `13` real Root-mounted state screenshots, all with document overflow `0`.

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
| `large-list` | APP `430x932`; real Market list reports `64` authoritative identities and remains vertically scrollable. |

Missing finance remains `Unavailable`; a finite authoritative `0` remains `0`. Hostile text-like fields are sanitized to fallback text instead of being shown as literal attack strings. The accepted 64-row authoritative fixture is complete. Evidence-only input above the explicit 96-row bound is marked/bounded by the adapter; this checkpoint makes no unlimited-list rendering claim.

### Fresh Account captures and comparison

Capture root: `.impeccable/review/kordyn-v2/account/` (`19` files: 17 PNGs and two sidecars). Comparison root: `.impeccable/review/kordyn-v2/account-compare/` (`9` files: six PNGs, two geometry ledgers, and one index).

| Capture | Dimensions | SHA-256 | Overflow | Role |
| --- | ---: | --- | ---: | --- |
| `desktop-account-position--1440x900.png` | `1440x900` | `363f53f1ef460cafaf151300c94465c2d1e09512d14be186b5f8c3ccdb6e2e32` | `0` | governed comparison actual |
| `desktop-account-position--1180x800.png` | `1180x800` | `8d03e49c6fab2cbbbc863b7ebcdad14f79288298dc7555305812ad8f1827f680` | `0` | governed comparison actual |
| `mobile-account-position--390x844.png` | `390x844` | `5bc1575de58246173f8df37f9e09d91e668b11f165b82d7f7fae4dde15ab69c5` | `0` | structural APP evidence only |
| `mobile-account-detail--430x932.png` | `430x932` | `368fb8fbbef87d3797db4e67c43303ad3833a95897fcd15a45539ca9e359099c` | `0` | structural APP evidence only |

Comparison index SHA-256: `b54de1d14b58aaca72b2abbb65c8fe9363ac1e68b275dd56f91b7191b25af99d`.

| Identity | Approved source SHA-256 | Actual SHA-256 | Pixel MAE | Machine verdict |
| --- | --- | --- | ---: | --- |
| `desktop-account-position--1440x900` | `38d6a875aa1cd26af0ef19510fe993255c572d97468ad9a940d734c92acfd148` | `363f53f1ef460cafaf151300c94465c2d1e09512d14be186b5f8c3ccdb6e2e32` | `0.054732` | human region review required |
| `desktop-account-position--1180x800` | `38d6a875aa1cd26af0ef19510fe993255c572d97468ad9a940d734c92acfd148` | `8d03e49c6fab2cbbbc863b7ebcdad14f79288298dc7555305812ad8f1827f680` | `0.054901` | human region review required |

Account scope-local comparison truth is explicit in the index: manifest `15`, scoped concepts `1`, completed scoped concepts `1`, scoped pending `0`, out of scope `14`. Cumulative governed coverage is now `5 / 15`; the remaining non-Account and future-domain rasters are not reclassified as Account pending and are not filled with stale screenshots.

Original-size human review opened all `23` final PNG images: 17 Account actual/state captures and six Account comparison reference/overlay/difference images. The Desktop Account Position actual keeps the Account domain, Position workspace, selected `Position / position-eth`, Context/Proof access, protection evidence, safety action, related execution/protection record table, Account truth strip, and bounded AI support. Recorded deltas versus the immutable concept include the production surface's current two-position fixture, replacement of the richer concept chart cockpit with a bounded price-boundary/evidence composition, and production-shaped `Unavailable` facts where the concept uses denser illustrative market data. These deltas are recorded for human region review; no pixel-equivalence claim is made.

### Fresh Plan 03 Task 5 gates

- The exact original state/capability TDD RED console was not retained. It is therefore not reconstructed here as an exact exit code, count, or diagnostic. The implemented test file and fresh GREEN gates below are the retained evidence.
- Incremental browser-harness failures were investigated before the final GREEN, including CDP target lifecycle, trusted Position click, lazy Account render wait, state routing, long-content mount, Context/Proof close focus, delayed authoritative action ledger, and page-reload download-ledger aggregation. The historical console transcript is not asserted as an exact record.
- Account performance ownership assertions were added and now pass in the retained fresh performance gate below; the historical RED console/count is not retained and is not reproduced as an exact result.
- Fresh focused Account/Task1-4/comparison/performance tests: `175 / 175`, exit `0`.
- Canonical Account master-browser evidence: exit `0`; product/capture source `bfbdce394dc21617b5b0ab070e62f475a5e77bd4`; captures `4`; states `13`; interactions `10`; fixture-authority writes `4`; download `1`; Account CSS `true`; legacy authenticated CSS `false`. The documentation closeout reran the same production browser gate against evidence HEAD `8481550` in an isolated temporary output and obtained the same semantic counts; that non-canonical output was discarded and did not relabel the committed pixels.
- Account comparator: exit `0`; counts `15 / 1 / 0 / 2 / 9` for legacy count fields, plus scopeCounts `15 / 1 / 1 / 0 / 14`; verdict `human region review required`.
- Isolated performance build: exit `0`; public CSS/JS `15,304 / 381,073`; AI shell CSS `54,995`; Account domain CSS `112,930 / 120,000`; `loadsLegacyProductStyles:false`; `forbiddenLegacyCss:[]`; shared shell CSS is reported explicitly as Vite-owned shared dependency.
- AI actions compatibility after the scoped `ConfirmHost` style fix: exit `0`; approvals, partial/failure, poster, translation, dialog, disabled-state gates all pass.
- Impeccable detector after the only Task5 production UI style edit: implementation record says it ran exactly once, exit `0`, output `[]`; this documentation pass did not independently replay it.
- Full repository test suite: `2051 / 2051`, exit `0`.
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
