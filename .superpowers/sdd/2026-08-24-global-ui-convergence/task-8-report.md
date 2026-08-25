# Task 8 — Real Cross-Viewport Visual Parity Report

## Pre-edit visual audit (2026-08-25)

Production source was still byte-identical to task base `943b832a267e908682bcacfc729d9c88129842f2` when this audit was recorded. The browser surface was real Google Chrome driven through the task-provided standalone Playwright runtime; no DOM injection or mock success data was used. The in-app Browser extension was unavailable (`Browser is not available: chrome`), so the accepted standalone Chrome path was used.

### Immutable prototype, exact `1056233`, 1440x900

Captured and visually inspected under `/private/tmp/task8-prototype-initial/`:

- `prototype-command.png`
- `prototype-live.png`
- `prototype-lab.png`
- `prototype-control.png`
- `prototype-run.png`
- `prototype-admin.png`
- `prototype-object-switcher.png`
- `prototype-trace-expanded.png`
- `prototype-ordinary-modal.png`
- `prototype-danger-confirmation.png`
- `report.json`

Computed rail geometry matched the prototype contract: Command `1440x64`, Workspace `188x770`, Stage `948x770`, Context `304x770`, and Trace `1440x66`. The prototype uses continuous, square registries and near-black truth/decision/execution zones. Its object switcher is `620x520` at `(188,64)` with an 8px hard black offset; expanded Trace occupies `(0,64)` through the bottom; ordinary and danger confirmations are hard-edged `560px` overlays with acid and danger offsets respectively.

### Production desktop, exact 1440x900 and 1180x820

Captured and visually inspected under `/private/tmp/task8-initial/`:

- `desktop-ai.png`, `desktop-live.png`, `desktop-lab.png`, `desktop-control.png`
- `desktop-operations.png`, `desktop-configuration.png`
- `desktop-object-switcher.png`, `desktop-trace-expanded.png`
- `desktop-ordinary-modal.png`, `desktop-danger-confirmation.png`
- `medium-context.png`, `medium-context-collapsed.png`
- `report.json`

Concrete pre-edit differences:

1. The desktop shell rails already have the binding `64 / 188 / 304 / 66` proportions and hard boundaries. At 1440, however, `.topbarStatusGroup` had `clientWidth=263` and `scrollWidth=307`, visibly colliding the exchange/runtime facts. At 1180, `.commandRail` had `clientWidth=633` and `scrollWidth=694`, visibly colliding status and command controls.
2. At 1180x820 Context correctly becomes a bounded 304px overlay at `x=876` and remains reachable in its 58px collapsed state at `x=1122`; no page-level horizontal overflow was observed.
3. Live Desk, Lab, Control, Operations, and Configuration substantially use the prototype grammar, but still contain isolated legacy rounded inner panels. Lab is lighter than the prototype's large dark research map. Configuration retains one rounded black status island inside an otherwise correct scope-first Registry/Inspector layout.
4. AI Trader is the largest visual difference: the real empty dialog is rendered as a sparse rounded chat island with legacy warm/orange furniture, while the prototype Command workspace is a dense Situation/Intelligence/Watch/Decision operations surface. The deployed task strip, patrol/poster/intelligence/watch/event/chat capabilities remain present and must not be replaced with demonstration data.
5. The production object switcher and Trace detail preserve deployed data/handlers and already use hard-edge overlays with acid offsets. The object switcher is narrower than the prototype and currently has one real result (`BTC` market).
6. The account modal is hard-edged with an acid offset, but its internal account form retains legacy orange-card styling. The destructive confirmation is already hard-edged with a danger offset, typed `KILL`, explicit effect/non-effect/result text, and a disabled final action until confirmation. No destructive action was submitted.

### Production APP, exact 390x844 and 430x932

Captured and visually inspected under `/private/tmp/task8-initial/`:

- `mobile-390-ai.png`, `mobile-390-live.png`, `mobile-390-lab.png`, `mobile-390-control.png`
- `mobile-390-more.png`, `mobile-390-context.png`, `mobile-390-trace.png`
- `mobile-390-drawer.png`, `mobile-390-safety-sheet.png`, `mobile-390-danger-confirmation.png`
- corresponding `mobile-430-*.png` captures for all listed states
- `report-mobile-390.json`, `report-mobile-430.json`

The fixed `56px` masthead, `44px` local rail, and `66px` navigation remain reachable at both viewports, More contains only Operations/Configuration/global destinations, and audited sheets/confirmations are square and scrollable. The deterministic defect is horizontal loss inside AI Trader: at 390, `.mChatContent` measured `390/412` client/scroll width and `.mChatStatus` `368/401`; at 430 they measured `430/455` and `408/444`. The body itself remained viewport-width only because the excess was clipped. Rounded suggestion/card remnants were also visible on AI Trader.

### Real state provenance and pending audit items

- Real isolated SQLite: `/private/tmp/kordyn-ui-preview.1sMgKn/trading-agent-worker-24310-6WLYtR/trading-agent.sqlite`.
- Real overview counts: markets 3, news 80, events 27, notifications 10, tools 3, skills 12, agent runs 34, risk rules 2, event sources 7, audit logs 20.
- Empty: positions, plans, and watch triggers/conditions are genuinely empty in the isolated backend; the market watchlist itself contains the real BTC/ETH/SOL rows.
- Disabled: AI send and the typed destructive final action were observed in their real disabled states.
- Loading/failed will be exercised by pausing/failing the existing real overview request in the browser harness, without substituting a payload.
- Stale and long-content evidence will be selected from real freshness/URL/ID fields.
- At this pre-edit checkpoint, forbidden was not yet verified. Final acceptance below closes it with a genuine non-Owner session and actual backend 403 boundary; no DOM/user injection was used.

### Focused pre-edit baseline

`node --test tests/prototype-visual-contract.test.mjs tests/mobile-navigation.test.mjs tests/render-smoke.test.mjs` passed `107/107`. These passing tests did not detect the measured internal Command Rail and mobile AI overflow, so focused browser-backed CSS regressions will be added RED-first.

## Final correction and acceptance (2026-08-25)

### Consolidated production correction

Initial production commit `45a4987d97032bb26296a18db2d598a70019eb26` contained the first correction batch. Reviewer-driven Fix Round 1 was closed by `3ed188b503866cacacc0c7fa92986ee2a7d46456`; Fix Round 2 closes the final medium-Context defect at production commit `e3f6cc8c37d2c7091d12131fe653e5462e2d3344` and is recorded below.

- `src/styles.css` gives the Command Rail measured containment at both desktop widths, keeps exchange/runtime/freshness/action labels legible, and keeps the notification badge inside the rail. At 1180×820 the Context Dock remains a bounded 304px overlay at `x=876`; its collapsed 58px handle remains reachable at `x=1122`. When Context is open, the AI heading and five-fact KPI band reflow wholly before the overlay instead of continuing underneath it.
- Desktop AI dialog, Intelligence, Watch, Events and shared task input now use a continuous hard-edge operations grid. Long Intelligence rows grow to their real content height and no longer overlap subsequent evidence rows.
- Mobile AI containment is corrected at both required widths. The AI task strip, prompts, Intelligence truth band, constraints, source feed and ledger use the same square continuous grammar without clipping the page.
- The initial correction removed the broad legacy radius system. Fix Round 1 then closed the remaining named islands on mobile Live selectors, Intelligence refresh/status, and Event Calendar/nav/day/agenda. The retained circles are semantic Live/Control donuts and event/status data marks rather than container or operation chrome.
- `src/mobile.jsx` renders the real Intelligence KPI summary through the shared `kTruthBand` structure. No data, handler, permission, action, error boundary, route, capability or backend contract was replaced.
- `tests/prototype-visual-contract.test.mjs` now locks the actual Command Rail dimensions, mobile AI containment, continuous AI/intelligence ledger structure, mobile truth band, and absence of residual container radius. The existing base-rule helper was corrected to exclude media-query declarations when asserting base CSS.

No backend, authentication, login/marketing, package, capability registry or `app-interactive-preview.html` file was changed. No dangerous action or configuration mutation was submitted.

### RED / GREEN record

All regressions asserted production selectors/components rather than marker text:

1. Initial focused baseline before the new contracts: **107/107 passed**.
2. First deterministic RED: **17 passed / 3 failed / 20 total** — Command internal containment, mobile AI containment, and continuous AI/long-row grammar failed.
3. First correction exposed a test-helper scope defect at **19/20**; systematic inspection showed the helper was incorrectly treating media-query overrides as base declarations. After fixing the helper, the focused visual contract was **20/20**.
4. Browser refinement RED: **18/20**, covering the exchange status stack and still-visible important legacy radii; correction returned **20/20**.
5. Mobile real Intelligence deep-page RED: **20/21** for the truth band/continuous ledger; correction returned **21/21**.
6. Residual rounded-surface audit RED: **21/22**; correction returned the final visual contract to **22/22**.
7. Initial authorized verification on `45a4987…`: `node --test tests/prototype-visual-contract.test.mjs tests/mobile-navigation.test.mjs tests/render-smoke.test.mjs` → **112 passed / 0 failed / 112 total**. Fix Round 1 adds five contracts and is recorded separately below.

### Final real-browser interaction walk

The entire acceptance walk was repeated from final production commit `e3f6cc8c37d2c7091d12131fe653e5462e2d3344` in real Google Chrome:

- Desktop 1440×900: AI dialog → Intelligence → Watch → Events; Live Desk; Lab; Control; Operations; Configuration; ⌘/Ctrl-K Object Switcher with real BTC result; keyboard/open/close path; expanded Trace; account ordinary modal; safety flow to typed Kill confirmation, stopping before final submit.
- Medium desktop 1180×820: Command containment; Context open and collapsed; all five KPI facts simultaneously visible before the open Dock; no document/body overflow or lost action.
- APP 390×844 and 430×932: AI, Live, Lab, Control, More; Context and Trace local rails; drawer; safety sheet; destructive confirmation; close and scroll reachability. Primary/local/sheet controls retain at least 44px targets.
- Long content: real Intelligence headlines/URLs/IDs and real source-feed rows at both APP widths. `documentElement` and `body` widths exactly matched 390/430; desktop widths exactly matched 1180/1440. Trace and narrow tables may use their own bounded local horizontal scroller, but the page does not overflow.

The minimum required images are exact-size files:

- `.impeccable/review/prototype-1440x900.png` — 1440×900, immutable `1056233`.
- `.impeccable/review/desktop-1440x900.png` — 1440×900.
- `.impeccable/review/desktop-medium.png` — 1180×820.
- `.impeccable/review/mobile-390x844.png` — 390×844.
- `.impeccable/review/mobile-430x932.png` — 430×932.
- `.impeccable/review/parity-contact-sheet.png` — 1800×1252, rendered from committed `.impeccable/review/parity-contact-sheet.html` through Playwright/Chrome.

The full named screenshot index, exact viewport, state, commit and matrix linkage is recorded in `docs/ui-prototype-parity-matrix.md`. Additional evidence includes every prototype/workspace state; desktop AI deep modes, all workspaces, object switcher, Trace and modals; both APP widths across workspaces/sheets/danger; and the long/state images listed below.

### Truthful state provenance

- Final isolated overview: markets 3, news feed 80, events 35, tasks 27, notifications 11, tools 3, skills 12, agent runs 50, risk rules 2, event sources 7 and audit logs 20. The pre-edit snapshot above records the earlier live counts; no rows were added for visual parity.
- Real empty: positions and trade plans; watch triggers/conditions are empty while the real watchlist contains BTC/ETH/SOL. Empty views were not populated with prototype/demo objects.
- Real stale/degraded: `.impeccable/review/desktop-real-stale-source.png` records the live source-health table on AI Trader → Events, recaptured on final production HEAD. At capture time Farside, OKX public liquidation, Binance announcements and CoinDesk were stale; U.S. BLS was degraded; the remaining listed sources reported healthy.
- Loading/failed: `.impeccable/review/desktop-real-loading.png` and `desktop-real-failed.png` were recaptured on final production HEAD by pausing and aborting the existing `overview?view=section&section=operationsCenter` request. No response or success payload was injected.
- Forbidden: a fresh isolated auth-required copy used the real store, real `hashPassword`, same tenant, an active subscription, active `交易用户`, `mustChangePassword:false` and non-Owner permissions. Login succeeded through `/api/auth/login`; the same authenticated session received HTTP **403** with `Missing permission: admin:system` from `/api/admin/users`. `.impeccable/review/mobile-390-real-forbidden.png` visibly shows the production Owner-required gate on final production HEAD. The desktop non-Owner capture does not visibly show that gate and is therefore not cited as forbidden visual evidence. Temporary credentials are absent from screenshots, evidence and this report.
- Disabled: the real empty AI input leaves Send disabled; the Kill final action remains disabled until typed confirmation. Dangerous submission was intentionally not performed.

### Matrix conclusion, changed files, and concerns

Final matrix totals are **26 PASS / 0 GAP / 0 BLOCKED** for binding G/W rows and **5 PASS / 0 GAP / 0 BLOCKED** for evidence R rows: **31 PASS / 0 GAP / 0 BLOCKED overall**.

Production/test files changed:

- `src/conceptPages.jsx`
- `src/mobile.jsx`
- `src/product-foundation.css`
- `src/productShell.jsx`
- `src/styles.css`
- `tests/prototype-visual-contract.test.mjs`

Evidence/report files changed or added:

- `docs/ui-prototype-parity-matrix.md`
- `.superpowers/sdd/2026-08-24-global-ui-convergence/task-8-report.md`
- `.impeccable/review/parity-contact-sheet.html`
- the Task 8-named PNG evidence enumerated by the matrix (excluding the unrelated pre-existing `desktop.png` and `mobile.png`)

There are no unresolved acceptance blockers. Remaining non-load-bearing responsive differences are explicit in the matrix: APP uses touch sheets/local navigation instead of duplicating the desktop switcher/docks; Trace and narrow tables may scroll inside bounded local containers; semantic donut graphics remain circular; and real backend emptiness/content replaces prototype demo data. Evidence is frozen on 2026-08-25 and later live source/data counts may change. Per the brief, the Impeccable detector, full `npm test`, lint and build were not run; Task 9 owns those gates.

## Fix Round 1 — independent visual review closure (2026-08-25)

### Review findings and RED

The controller and independent reviewer compared the first committed evidence to the exact prototype and identified five deterministic overclaims. Before new production edits, exact Chrome measurement confirmed them at 1440×900, 390×844 and 430×932:

1. Desktop AI hid KPI children four and five at 1440; only Equity, Position Risk and Today PnL remained visible.
2. Mobile Live symbol/timeframe selectors, Intelligence refresh/status and Event Calendar/nav/day/agenda retained non-semantic rounded chrome.
3. Desktop expanded Trace was a 66px rail plus a small `520×168` lower-right detail popover rather than the prototype's full `y=64→bottom` seven-band surface.
4. Because `product-foundation.css` is imported after `styles.css`, its base desktop primitives reopened two columns on APP: Operations measured `86px + 280px` at 390 and `126px + 280px` at 430; Configuration truth measured `83px + 283px` and `123px + 283px`.
5. Desktop Events showed literal source anchor markup instead of readable text.

Five focused contracts were added against the actual components/selectors. RED was **22 passed / 5 failed / 27 total**. After the first implementation, the focused contract was **27/27 GREEN**. A final controller screenshot review found the expanded Trace's 304px detail column still paper-white. A computed-style assertion was added first and failed **0 passed / 1 failed** for the selected test (`var(--kordyn-paper)` versus required `var(--kordyn-dark)`); the near-black correction returned that test to **1/1 GREEN**.

### Final deterministic corrections

- At 1440, `.chatKpiBar` is a dense five-column grid. Exact Chrome records all five real facts simultaneously, including Cumulative PnL and BTC/USDT; no KPI uses `display:none` or `visibility:hidden`.
- Mobile Live, Intelligence and Event Calendar operation chrome now uses square 1px boundaries and ≥44px controls at both audited widths. Semantic event dots and donut data visualizations remain circular.
- Expanded desktop Trace is fixed from `(0,64)` to `(1440,900)`, with exact `188px / 948px / 304px` columns, seven equal stage bands, near-black stage/detail truth surfaces, real stage evidence, close/Escape behavior and focus return. APP keeps the same facts in its bounded touch sheet.
- The final APP cascade is owned at the end of `product-foundation.css`; Operations and Configuration are now single-column without reordering stylesheet imports. Chrome measured `.mOperationsCommand` at 366px/406px and `.mConfigurationTruth` at 364px/406px for 390/430 viewports respectively.
- `EventsConcept` safely reduces source HTML/entities to display text. It never renders source markup and does not modify the persisted payload.
- Object Switcher behavior was intentionally not padded with demo rows: the exact prototype is a `620×520` multirow Registry, while the current production result list is content-fit because the real backend returns one BTC result. This real-data height difference is explicitly recorded in G14 and accepted as PASS.
- Forbidden evidence is now indexed honestly: the existing real mobile Owner-required gate plus same-session HTTP 403 prove the state. The desktop trader capture is not claimed to show a gate.

### Final browser evidence and verification

After production commit `3ed188b503866cacacc0c7fa92986ee2a7d46456`, the complete Chrome walk and all affected deep-page captures were regenerated. Exact DOM width checks remained `1440/1440`, `1180/1180`, `390/390` and `430/430` for document/body. New named evidence includes `desktop-kpi.png`, the corrected near-black `desktop-trace-expanded.png`, safe-text `desktop-ai-events.png`, and both 390/430 `live`, `intelligence`, `events`, `operations`, and `configuration` screenshots. The required viewport files and contact sheet were also regenerated from this final production commit.

Final authorized verification:

- `node --test tests/prototype-visual-contract.test.mjs tests/mobile-navigation.test.mjs tests/render-smoke.test.mjs` → **117 passed / 0 failed / 117 total**.
- `git diff --check` → clean.
- Matrix remains **26 binding PASS + 5 evidence PASS = 31 PASS / 0 GAP / 0 BLOCKED**.

## Fix Round 2 — final-HEAD evidence closure (2026-08-25)

### Medium Context RED and deterministic correction

The fresh review found that the 1180×820 Context overlay still covered the fifth AI KPI even though all five nodes were technically rendered. Real Chrome measured BTC/USDT at `x=870.55→953.05` while the fixed 304px Context Dock began at `x=876`. The browser containment assertion failed, and the focused production-selector contract was **0 passed / 1 failed / 1 total** because the medium open-Context header owned no width response.

Production commit `e3f6cc8c37d2c7091d12131fe653e5462e2d3344` adds a Context-open medium layout response scoped to the real shell structure. The Page Head uses the visible center width and gives its KPI/actions cluster a dedicated row; Context-collapsed and 1440 layouts remain unchanged. GREEN evidence is geometric: at 1180 open, all five real facts are visible at 11px, each measures `88.6px`, and the bar ends at `x=649.05`, before Context `x=876`. At 1180 collapsed, the fifth fact ends at `x=953.05` before the collapsed Dock `x=1122`; at 1440 open, it ends at `x=909.05` before Context `x=1136`. All three viewport/state checks have page width equal to viewport width.

### Final-HEAD state and viewport evidence

Every production screenshot in the matrix was walked and recaptured from `e3f6cc8c37d2c7091d12131fe653e5462e2d3344`; byte-identical unaffected images remain valid files from that final walk. Loading and failed were recreated by pausing/aborting the existing real Operations overview request; stale is the current real source-health response; forbidden was recreated through a fresh isolated auth-required store and real active same-tenant non-Owner session. The login returned 200 and the same browser session returned the actual `/api/admin/users` 403 while the 390×844 Configuration surface visibly displayed the Owner-required gate. No response body, success payload, application data, DOM state or user record was injected into the browser.

The contact sheet was regenerated at 1800×1252 and labels final production `E3F6CC8`. Final authorized verification is:

- `node --test tests/prototype-visual-contract.test.mjs tests/mobile-navigation.test.mjs tests/render-smoke.test.mjs` → **118 passed / 0 failed / 118 total**.
- Real Chrome KPI containment → **3 passed / 0 failed / 3 viewport-state checks**.
- `git diff --check` → clean.
- Matrix remains **26 binding PASS + 5 evidence PASS = 31 PASS / 0 GAP / 0 BLOCKED** with no unresolved acceptance blocker.

## Fix Round 3 — evidence and test honesty (2026-08-25)

Fresh review verified that `desktop-real-stale-source.png` is AI Trader → Events, not Operations. The matrix now links that image to W01/G18 and its valid source-health/containment rows; the report and contact-sheet alternative text use the same route. Loading and failed remain the Operations request-boundary captures.

The medium static contract no longer divides the 656px header budget by five or claims that each KPI owns 120px. That was inconsistent with the final Chrome measurement because the five-column KPI grid shares its row with the real action group and each KPI measures 88.6px. The contract now asserts the actual 656px contained header, 16px pre-Context gutter, `minmax(0,1fr) auto` KPI/actions split and five equal KPI columns. The real Chrome containment evidence from Fix Round 2 remains the authority for rendered widths; no production UI or screenshot pixels changed in this round.

Verification: selected medium contract **1 passed / 0 failed / 1 total**; authorized Task 8 focused set **118 passed / 0 failed / 118 total**; `git diff --check` clean. Matrix totals remain **31 PASS / 0 GAP / 0 BLOCKED**.

## Historical Task 9 / authenticated-shell evidence closure — superseded (2026-08-25)

Historical record only. The hashes and 60-image contact sheet in this section were valid for that checkpoint but are not the final branch evidence.

At that historical checkpoint, the evidence chain was explicit and non-self-referential:

- immutable prototype: `10562336e1315733438f563f4ca1a8679f7e2c9c` / blob `43267ccfca051351823c668932c857350fb592b9`;
- production implementation source: `3bd2ce86fb6b1efa93922d522ac52cd1893ee432`;
- capture runner HEAD: `f855781a8b9b8f83421b334b49d72796056dd9f3` (the only later change is the Event Risk visual runner update);
- evidence-only assets commit: `1f379b430ba61d005a73936cc05c3788d950b5dd`.

Standalone real Google Chrome recaptured the full desktop and APP walk at 1440×900, 1180×820, 390×844 and 430×932. The required entry images are `.impeccable/review/desktop.png` (1440×900) and `.impeccable/review/mobile.png` (390×844). The batch includes every primary workspace, deep AI modes, desktop and APP Objects/Context/Trace, ordinary and destructive confirmations, More/drawer/safety, real long content, Control Posture/Events/Boundaries/Rules, independent Event Risk, and authenticated startup/connection/ConfirmHost/Release Notice surfaces.

New integration evidence proves more than static attributes:

- Desktop Object Switcher uses the immutable 620px paper surface, max 520px height and 8px Ink offset shadow. Separate images record default, hover, focus-visible and unavailable/fail-closed feedback.
- Trusted browser clicks through real production Registry components cover AI Event, Live Position/Market, Lab Strategy product/Capability/Validation/Review, Control Event Risk, Operations Task and Audit. Shell root, Context and Trace expose the same typed id/type/workspace/source/route/evidence identity. Same-ID AI/Control `Event:event-5` remain correctly separated by scope.
- APP Control has one four-entry rail. At both phone sizes trusted clicks select Posture, Events, Boundaries and Rules; each produces one active item, the correct route/subPage and real content, with no inner `.mHubTabs`.
- Stale/degraded boundaries preserve last-valid content but mark the subtree inert and retry with `force=true`. Images record APP 390 stale and APP 430 degraded; desktop behavior is covered by the production browser contract. Loading and failed pause/abort only the existing Operations request. Forbidden is a fresh real non-Owner login followed by an actual same-session `/api/admin/users` 403 and a visible APP Owner gate. No successful payload, DOM product state or mock production data was injected.

That checkpoint contact sheet was rebuilt as a readable 1800×6086 seven-section overview instead of retaining the obsolete six-tile B007 montage. Its visible header states `Immutable 1056233 · Capture HEAD F855781 · Production source 3BD2CE8`. The Chrome render hard gate audited all 60 embedded images and returned `imageCount:60, brokenImageCount:0`; every image was complete with positive natural dimensions. The resulting PNG was opened after render and inspected end-to-end: the prior missing desktop last-valid references were removed, no alt text or broken-image gap remains, and Object Switcher, desktop/medium, both APP widths, Event Risk, Objects/Context/Trace, authenticated overlays, loading/failed/stale/degraded/403/disabled and long-content evidence are visible.

Matrix totals remain **26 binding PASS + 5 evidence PASS = 31 PASS / 0 GAP / 0 BLOCKED**. Final branch-level tests, lint and production build are controller-owned gates after this evidence/docs commit; the Impeccable detector is not rerun because Task 9 already completed that one permitted detector pass.

## Historical Task 10 / `db5286a` evidence closure — superseded (2026-08-25)

Historical record only. `878109a` and the associated `8493bcd` index were replaced after independent review found that the Desktop last-valid screenshots did not visibly contain a full production shell.

At that historical checkpoint, the immutable prototype was `10562336e1315733438f563f4ca1a8679f7e2c9c`; production pixels came from `db5286a1f76d7f331c23de49b314179c77cde557`; capture / test HEAD was `5e017f05b7da02befb08e818856e2fd9c3ed1f44`, whose only later change was a test-only selection gate. Checkpoint evidence assets were committed at `878109af7ffda5aef189e4bc2698b7cc1edf0dd3`.

Standalone real Google Chrome recaptured the complete 1440×900, 1180×820, 390×844 and 430×932 production walk. The batch includes all workspaces and deep AI/Live/Lab/Control/Operations/Configuration routes, Desktop and APP Event Risk, Objects/Context/Trace, drawers/sheets, ordinary/danger confirmation, long content and loading/empty/stale/degraded/failed/forbidden/disabled states. `desktop.png` is 1440×900 and `mobile.png` is 390×844; both are in the evidence commit. The checkpoint Object Switcher uses its real five-result dataset and content-fit height rather than mock padding.

Authenticated evidence is now actual production App/MobileApp throughout. Startup pauses the real core request; connection failed aborts it. Desktop and 390 ordinary `ConfirmHost` are opened through Operations → Recovery reconciliation, with measured focus sequence Cancel → Confirm → Cancel and Escape focus return. Release Notice is produced by actual `VITE_APP_RELEASE` / `APP_RELEASE` mismatch processes. No isolated overlay fixture or blank fixture background is used. A fresh auth-required non-Owner login again returned 200, then actual same-session `/api/admin/users` returned 403 while MobileApp displayed the Owner-required gate.

State provenance is deliberately narrower than earlier wording: Operations loading/failed are live request boundaries; AI Events stale is current real source freshness; stale/degraded last-valid screenshots exercise the production component state harness and prove warning + inert subtree + retry, but are not claimed as a naturally occurring backend response. Empty and disabled are real application states. No DOM injection, mock product payload, demo result row or fake success was used.

That checkpoint contact sheet is 1800×6086. Its visible header contains immutable `1056233`, production source `db5286a`, capture/test HEAD `5e017f0` and the date. Chrome audited all 60 embedded images as complete with positive natural dimensions (`60/60`, `0` broken); the rendered PNG was opened and visually inspected with no alt text, missing thumbnail or invalid authenticated fixture.

## Final Task 10 / `5448040` geometry and evidence closure (2026-08-25)

The immutable authority remains `10562336e1315733438f563f4ca1a8679f7e2c9c` / blob `43267ccfca051351823c668932c857350fb592b9`. The final production HEAD is `5448040c42ef678f71e6367d9c8280b1258ce857`, but the 62-image sheet intentionally has two capture batches: the workspace/Object/Control/APP/authenticated base came from production `db5286a1f76d7f331c23de49b314179c77cde557` with capture/test `5e017f05b7da02befb08e818856e2fd9c3ed1f44`; only the Desktop last-valid stale/degraded cells were recaptured at `5448040` after the full-shell geometry contract `9d93b0180b5a7262372064f9ddddbfc96fbf4f38`. The final mixed-batch evidence state is `ffaebb9`; `0cd9933` is the pre-amend intermediate hash and is not final. Earlier evidence `878109a` and index `8493bcd` are historical only.

Independent review rejected the earlier Desktop stale/degraded images because a fragment harness could satisfy DOM checks while rendering almost blank. The replacement harness mounts the real Command Rail, Workspace Rail, main AI workspace, Context Dock, Trace Rail and `WorkspaceStateBoundary`. Its Chrome contract requires non-zero visible rectangles for the shell, banner, retry and last-valid workspace, plus inert/pointer-disabled truth, forced retry and no document overflow.

That full-shell capture exposed a second real defect at 1180px: collapsed Context covered the warning, Retry action and last-valid inspector. `5448040` now reserves the exact Context budget only for stale/degraded boundaries. Final Chrome geometry has no overlap:

- 1440 stale/open: Context left `1136`; banner/retry/truth end at `1106 / 1089 / 1120`.
- 1180 degraded/collapsed: Context left `1122`; banner/retry/truth end at `1092 / 1075 / 1106`.
- 1180 degraded/open: Context left `876`; banner/retry/truth end at `846 / 829 / 860`.

`desktop-last-valid-stale.png` and `desktop-last-valid-degraded.png` are now explicit independent cells in Truthful operational boundaries, alongside the retained APP stale/degraded cells. The committed renderer `scripts/render-parity-contact-sheet.mjs` used approved local Chrome and returned `imageCount:62`, `broken:[]`, `width:1800`, `height:6458`, `pendingText:false`, exit `0`. The resulting 1800×6458 PNG was opened and inspected; both Desktop cells are readable and show complete warnings, Retry actions, last-valid workspaces and unobscured Context boundaries. The visible header distinguishes final production `5448040`, base capture/test `5e017f0` and boundary recapture `5448040`; it does not claim a single capture HEAD.

The final matrix remains **26 binding PASS + 5 evidence PASS = 31 PASS / 0 GAP / 0 BLOCKED**. Detailed final provenance and the reproducible renderer command are in `task-10-evidence-report.md`.
