# Task 8 — APP Foundation Shell concept-fidelity remediation

## Status

- Implementation: complete at commit `ba11087b63286153bcc4b1d8a1f8628ed64872e0` (`fix(kordyn-v2): restore mobile foundation fidelity`).
- Branch: `codex/kordyn-v2-rebuild`.
- Required base: `342278a01c2194e9791a3065297263d10e920993`.
- Foundation boundary: preserved. No Plan 02 work, merge, push, deploy, cutover, or default enablement was performed.
- Release boundary: Plan 02 remains blocked pending the explicitly required independent original-resolution review. No reviewer or subagent was dispatched because the task instruction prohibited it.

## Requirements implemented

- Added one mobile-only AI Mission home projection from the existing production-shaped `data`, canonical `selection`, `truth`, and `state`. Desktop continues to render the existing `MissionControlCanvas` unchanged.
- Reordered the APP first viewport to compact identity/account health/notification, `AI 交易员`, five AI-local destinations, six loaded truth facts arranged in three columns, active Mission, `需要你`, `账户影响`, `最近完成`, then the fixed prompt above the four-root navigation.
- Notification uses the existing `governance/notifications` route.
- Active Mission uses its loaded title, status, five-stage trace, risk, strategy, and event facts.
- `需要你` reads loaded pending actions/risk incidents and delegates only to canonical selection; it performs no approval, rejection, execution, mutation, or optimistic success.
- `账户影响` reads loaded positions and account truth. Missing notional or PnL stays `Unavailable`; the unsupported concept daily PnL was not fabricated.
- `最近完成` reads completed loaded Mission/Agent-run projections and remains explicit when the projection is empty or unavailable.
- Removed the standalone Context/Proof header dock. One in-Mission `查看证据` action opens a governed evidence sheet with touch-sized Context and Proof tabs.
- Retained focus trapping, Escape/pointer close, focus return, modal background inertness, canonical selection, read-only AI 客服, prompt return focus, safe areas, 44px targets, non-happy states, no overflow, and zero production writes.
- Added a height-aware `min-width: 400px` / `min-height: 900px` composition so `430x932` uses its additional height for fuller Mission/account/recent rhythm, while `390x844` remains compact enough to expose two unobscured completion rows.

## Strict TDD evidence

Production UI was not edited until the component and real-browser behavior/geometry contracts had been written and observed failing against the Task 7 baseline.

### RED 1 — component reading order

Command:

```text
node --test tests/kordyn-v2-shell.test.mjs
```

Result: exit `1`; `6` tests, `5` pass, `1` fail.

```text
not ok APP shell follows the approved compact identity, title, destinations, and truth order
missing approved APP marker: -1,-1,4247,584,5929
```

This proved the baseline lacked the compact identity/title markers and still placed truth/evidence/Mission in the rejected order.

### RED 2 — production browser geometry

Command:

```text
node tests/run-kordyn-v2-shell-browser.mjs --mobile-only
```

Result: exit `1`.

```text
AssertionError: 390: approved mobile foundation reading order
actual: false
expected: true
```

The first attempt at this browser RED briefly reached a missing-notification-selector harness error. The interaction was reordered so the actual baseline concept contract—not an absent test-only selector—was the recorded RED above.

### RED 3 — authoritative Mission risk regression

After the first production composition, the same real-browser command failed before GREEN:

```text
AssertionError: 390: active Mission projects loaded risk, strategy, and event facts
actual:   ['Unavailable', 'Breakout Retest v3', 'FOMC · 6h']
expected: ['normal', 'Breakout Retest v3', 'FOMC · 6h']
```

The fix uses the authoritative loaded `truth.risk` rather than inventing or losing the risk state.

### RED 4 — 390 Recent-row occlusion

After original-resolution review found the fixed prompt covered actionable Recent content, a browser contract was added requiring both loaded rows to end at least `4px` above the prompt. The same command failed:

```text
AssertionError: 390: two recent-completion rows remain meaningfully visible above the prompt
rows=[{"top":717,"bottom":751},{"top":751,"bottom":785}]
prompt={"top":704,"bottom":762}
```

The first compact pass was also deliberately kept RED because a `2px` clearance was insufficient:

```text
rows=[{"bottom":674},{"bottom":706}]
prompt={"top":708}
```

The final `390x844` geometry has the second row at `706px` and prompt at `712px`, a real `6px` separation.

### RED 5 — 430 dead-zone regression

After original-resolution review found the same ultra-compact stack left an approximately `80px` dead zone on `430x932`, the browser contract was extended to require compact continuity from the second Recent row to the prompt. The same command failed:

```text
AssertionError: 430: recent completion and prompt retain the approved compact continuity
```

The final height-aware composition has the second row at `785px` and prompt at `800px`, using the taller viewport with a `15px` transition rather than a dead zone or overlay.

## Final GREEN evidence

Command:

```text
node --test tests/kordyn-v2-shell.test.mjs && node tests/run-kordyn-v2-shell-browser.mjs --mobile-only
```

Result: exit `0`.

```text
✔ Desktop shell follows the approved four-domain composition
✔ APP shell exposes exactly four full-label roots without a catch-all destination
✔ APP shell follows the approved compact identity, title, destinations, and truth order
✔ APP shell keeps unknown and adverse truth fail-closed
✔ Trace identity gives explicit object identity precedence over a record id
✔ Trace identity retains id-only legacy row matching
ℹ tests 6
ℹ pass 6
ℹ fail 0
KORDYN V2 mobile shell browser PASS 390x844:nav=4,focus=3,overflow=0,targets=44 430x932:nav=4,focus=3,overflow=0,targets=44 states=5 long-content=2 screenshots=0
KORDYN V2 mobile geometry 390:stateBottom=770,navTop=770,reserve=74,workspaceMin=44.0,headerBottom=214,missionTop=222,needsTop=394,impactTop=483,recentTop=613,recentRowsBottom=706,promptTop=712,sheet=213-770,proofScroll=419/571 | 430:stateBottom=858,navTop=858,reserve=74,workspaceMin=44.0,headerBottom=214,missionTop=222,needsTop=434,impactTop=533,recentTop=684,recentRowsBottom=785,promptTop=800,sheet=243-858,proofScroll=477/571 transition=ai/intelligence:operationsCenter
```

The browser runner renders and clicks the actual `KordynV2Root` production tree. It clicks all four roots, all five AI destinations, notification, Mission evidence, Context/Proof tabs, close/Escape, AI 客服, and the AI prompt. It also checks single active route, canonical selection, focus return, inert background, 44px targets, no document overflow, fail-closed states, long content, and zero writes.

## Files changed

Production:

- `src/kordynV2/KordynV2Root.jsx`
- `src/kordynV2/shell/MobileShell.jsx`
- `src/kordynV2/shell/MobileSheet.jsx`
- `src/kordynV2/styles/mobile-shell.css`

Tests:

- `tests/kordyn-v2-shell.test.mjs`
- `tests/run-kordyn-v2-shell-browser.mjs`

`tests/kordyn-v2-shell-browser.jsx` did not require a change: its existing production-shaped fixture already supplied the real pending action, risk incident, position, completed Mission/Agent-run, identity, notification, truth, selection, and state facts needed by the new browser contract. The runner still mounts this actual root fixture; no source-grep substitute or test-only production model was added.

Evidence and ledger:

- `docs/kordyn-v2-evidence.md`
- `.impeccable/review/kordyn-v2/foundation/capture-evidence.json`
- `.impeccable/review/kordyn-v2/foundation/mobile-390x844.png`
- `.impeccable/review/kordyn-v2/foundation/mobile-430x932.png`
- `.impeccable/review/kordyn-v2/foundation/mobile-390x844-proof-sheet.png`
- `.impeccable/review/kordyn-v2/foundation/mobile-{390x844,430x932}-ai-support-open.png`
- `.impeccable/review/kordyn-v2/foundation/mobile-{390x844,430x932}-ai-support-long-content.png`
- `.impeccable/review/kordyn-v2/foundation-compare/comparison-index.json`
- `.impeccable/review/kordyn-v2/foundation-compare/mobile-ai-mission-home--{390x844,430x932}--{overlay,difference}.png`
- `.impeccable/review/kordyn-v2/foundation-compare/mobile-ai-mission-home--{390x844,430x932}--geometry.json`

No route, API, database, permission, trading action, risk action, auth behavior, cutover behavior, production fixture, legacy CSS import, or default enablement was added.

## Impeccable evidence

Context was run exactly once for the changed Mobile target before implementation:

```text
node /Users/ely/.codex/skills/impeccable/scripts/context.mjs --target src/kordynV2/shell/MobileShell.jsx
```

The approved immutable concept remained the palette, density, and hierarchy authority; no alternate product model was inferred.

The required detector command after UI changes:

```text
node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/kordynV2/KordynV2Root.jsx src/kordynV2/shell/MobileShell.jsx src/kordynV2/shell/MobileSheet.jsx src/kordynV2/styles/mobile-shell.css
```

Output, exit `0`:

```json
[]
```

Hard scan:

```text
rg -n "!important|src/styles\\.css|productStyles|kordyn-v2-production-fixture" src/kordynV2 || true
```

Output: empty.

## Screenshots and hashes

Immutable source:

- `.impeccable/mocks/kordyn-v2-approved/mobile-ai-mission-home.png`: `6e0eda474f6658ff9dbfcbc6b18d4503203a78ddb30e38aa22b0760c1c902c9b`

Final base and interaction captures:

- `mobile-390x844.png`: `5dbee3de521d130740d0a96d2e4e8d855b53cb22c81e89e336d28423becae500`
- `mobile-430x932.png`: `5730e70ad5ffba84a4d1db8d0deee507d54ac80e6594bece10bf320e467f5314`
- `mobile-390x844-proof-sheet.png`: `f3a4aeeef09386e26ce854de8cbf9d79a9b5606000ab160d068397376d5e651e`
- `mobile-390x844-ai-support-open.png`: `6b450a92281e4ba134a31a1d77b2860c683220d1f6546a041804d138d058214e`
- `mobile-430x932-ai-support-open.png`: `1a9a3c561827d86fe28bd07999da1e978102661d2338742378c30c3e75edfbe0`
- `mobile-390x844-ai-support-long-content.png`: `183d605b2f4465ca29577c126f46b4d9ecd51ea8ec7036216b4d9bf7cddacc18`
- `mobile-430x932-ai-support-long-content.png`: `1c2ba382235c407b7c2d6abf6d91b01e73a4500678533dbba24a31264788ddd1`
- `capture-evidence.json`: `1498862214a4f421ad063fcc2f91b45db00d25a87271a3886824e6f5f3b3d480`

Comparison evidence:

- `comparison-index.json`: `8feacb227092e06454a1058fb8c463138a2d003dcbb16ccd018198bbe4b1e2a9`
- 390 normalized reference: `2d2c24912b9843d1de183dbb66ebbbc9fd39c928874558c918eb51e406d6faff`
- 390 overlay: `dd833d418446dedca9d44a7edd5acc761d0b24b1de56fb67536dd7adb50faca5`
- 390 absolute difference: `9da363ce4828e2f23daacc11d7d943334181bb43c555380551757a1fed1501ed`
- 390 geometry: `65beb64ba9b62e331284f81db588178d86648e815b34b8f1b01643ba803c4843`
- 430 normalized reference: `f3e8a97d69a54a9754c92b89fcba0c39821e7e88fbcd2ca37f24b2ece86d2049`
- 430 overlay: `24a09254631dfaf512dd7b8b9b1e6862b0f79fe755bdd1124f3509ebdc5991e4`
- 430 absolute difference: `b3386f5330038c9fd1384452fe14a49672b98acdc86ae6da99003638c057fa9a`
- 430 geometry: `3b17c659e952e582d7d26a0d2aebfc28cf91ea168dfd3f8ec236b511a7140b09`

Unchanged Desktop evidence:

- `desktop-1440x900.png`: `194892406891ef5b372e1364615eb4808e06bf22f23562028c0fe622ea6d9aee`
- `desktop-1180x800.png`: `a37413c105455ed0c7ffb569fa0165cc984c6e4d80821b384fa9282269111b46`

## Original-resolution visual observations

The immutable `853x1844` source, both normalized references, final base screenshots, overlays, absolute differences, and governed Proof sheet were opened at original resolution after the final capture.

### 390x844

- The compact header ends at `214px`; the Mission starts at `222px` rather than being pushed below a standalone evidence row.
- `需要你` starts at `394px`, `账户影响` at `483px`, and `最近完成` at `613px`.
- Both real completion rows are legible in full and end at `706px`; the prompt starts at `712px`. The fixed prompt and AI 客服 cover no Recent row or actionable content.
- The prompt ends above the bottom navigation, whose top is `770px`; safe-area/navigation reserve is `74px`.
- Density is intentionally compact at this height, while every interactive target remains at least `44x44`.

### 430x932

- The same semantic header ends at `214px` and Mission starts at `222px`, preserving cross-width structure.
- The height-aware rhythm expands Mission and section internals: `需要你` starts at `434px`, `账户影响` at `533px`, and `最近完成` at `684px`.
- Both completion rows end at `785px`; the prompt begins at `800px`. The additional height is used for fuller Mission/account/recent pacing, with no approximately `80px` dead zone, stretched blank card, or prompt overlay.
- Bottom navigation begins at `858px`, with the same `74px` reserved safe-area/navigation height.

### Governed evidence, support, and differences

- The single Mission evidence action opens the bounded sheet from `213–770px` at 390 and `243–858px` at 430. Both Context and Proof tabs are visibly touch-sized. Proof remains scrollable (`419/571` and `477/571`) and the obscured background is inert.
- AI 客服 stays visually secondary, read-only, and bounded in both ready and long-content captures.
- Absolute-difference images still contain expected local text/data differences: production uses real fixture facts and explicitly omits the concept's unsupported daily PnL. Human region review—not pixel similarity—was authoritative.
- Diagnostic pixel-difference values are `0.07948798963016973` at 390 and `0.07632053347006701` at 430. There is no fixed APP threshold in Foundation Plan 01.
- Self-review finds no material Foundation APP hierarchy, density, first-viewport, evidence-access, support, or bottom-navigation difference at either viewport. This self-review cannot clear the independent-review gate.

## Full verification gates

All commands below ran after the final production composition unless explicitly identified as RED.

### Focused isolated unit/contract gate

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-architecture.test.mjs tests/kordyn-v2-cutover.test.mjs tests/kordyn-v2-state.test.mjs tests/kordyn-v2-actions.test.mjs tests/kordyn-v2-shell.test.mjs tests/kordyn-v2-ai-support.test.mjs tests/kordyn-v2-concept-manifest.mjs tests/kordyn-v2-performance.test.mjs
```

Output: exit `0`; `63` tests, `63` pass, `0` fail.

### Full repository suite

```text
npm test
```

Output: exit `0`; `1744` tests, `1744` pass, `0` fail, `0` skipped; duration `11315.578542ms`.

### Lint and production build

```text
npm run lint && npm run build
```

Output: exit `0`; ESLint produced no findings; Vite transformed `1674` modules and completed in `1.37s`. The existing chunk-size advisory is the only advisory.

### Combined Desktop/APP shell browser

```text
node tests/run-kordyn-v2-shell-browser.mjs
```

Output: exit `0`. Desktop passed at `1440x900` (`MAE 0.039474`) and `1180x800` (`MAE 0.043102`), `nav=4`, `focus=3`, `overflow=0`, with two long-content checks. APP passed at both required sizes with the exact GREEN geometry recorded above. Desktop landmarks and screenshot hashes are unchanged.

### Canonical selection, cutover/recovery, and public/auth browsers

```text
node tests/run-canonical-selection-browser.mjs && node tests/run-kordyn-v2-cutover-browser.mjs && node tests/run-zero-base-auth-browser.mjs
```

Output: exit `0` for all three. Canonical selection passed Desktop and APP pointer, keyboard, Context, Trace, rejection, and domain routes. Cutover reported `PASS retry=1 legacy=1 api=0`. Public/auth passed at `1440x900`, `390x844`, and `430x932`, with no overflow and all required login, MFA, registration, modal focus, focus trap, and Escape paths.

### Fresh isolated production performance build

```text
node tests/run-kordyn-v2-performance-build.mjs
```

Output: exit `0`, result `PASS`:

```text
public:   js=375164 gzip=123897 css=15304 gzip=3746
AI shell: js=455938 gzip=146610 css=76026 gzip=14201 loadsLegacyProductStyles=false
legacy:   js=46 gzip=66 css=843660 gzip=141376
budgets: publicCss 15304/40000 pass; publicJs 375164/450000 pass; aiShellCss 76026/180000 pass
integrity: source unchanged; checked-in dist unchanged; temporary output removed
```

### Final capture and comparison refresh

```text
KORDYN_V2_SCREENSHOT_DIR=.impeccable/review/kordyn-v2/foundation node tests/run-kordyn-v2-shell-browser.mjs --mobile-only
```

Output: exit `0`; both required viewports passed, `screenshots=7`.

```text
node scripts/compare-kordyn-v2-concepts.mjs --scope shell --screenshots .impeccable/review/kordyn-v2/foundation --output .impeccable/review/kordyn-v2/foundation-compare
```

Output: exit `0`; `15` concepts, `2` completed, `13` pending, `4` comparisons, `17` artifacts; human review required.

### Final integrity

```text
git diff --check
```

Output before the implementation commit: empty; exit `0`.

Implementation commit:

```text
ba11087b63286153bcc4b1d8a1f8628ed64872e0 fix(kordyn-v2): restore mobile foundation fidelity
22 files changed, 1112 insertions(+), 169 deletions(-)
```

## Self-review

- Scope: mobile-only composition; Desktop branch and geometry are unchanged.
- Data boundary: existing production facts/view models/canonical selection only; no production fixture import.
- Action boundary: navigation and selection only; browser action counter stays `0` through notification, evidence, support, prompt, and all route interactions.
- Failure boundary: missing/invalid numeric facts remain `Unavailable`; no absent value is converted to zero or healthy.
- Interaction boundary: all visible controls are at least `44x44`; sheets preserve focus trap, inertness, Escape, pointer close, and focus return.
- Layout boundary: document overflow remains `0`; prompt, AI 客服, bottom roots, and recent rows do not overlap at either required viewport.
- CSS boundary: no `!important` or legacy stylesheet import; detector returned no findings.

## Concerns and outstanding gate

- The independent read-only original-resolution reviewer required by Step 5 was intentionally not dispatched because the task instruction said not to dispatch any subagents or reviewers. Therefore Critical/Important independent-review findings cannot be reported as zero, and Plan 02 remains blocked even though implementation self-review finds no material difference.
- Vite continues to emit the existing greater-than-500k chunk advisory; explicit Task 8 performance budgets pass and the V2 route does not load legacy product CSS.
- APP pixel-difference values remain diagnostic and are not a substitute for the outstanding human review, especially because authoritative live fixture text differs from the immutable concept and unsupported daily PnL is correctly absent.
