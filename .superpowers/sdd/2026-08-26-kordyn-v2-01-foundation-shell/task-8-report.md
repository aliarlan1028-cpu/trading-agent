# Task 8 — APP Foundation Shell concept-fidelity remediation

## Status

- Independent scoped re-review fix round 2: implemented and verified in `63cb1e6b5e88f8ad4cc56cc96d397a76fff05aea` (`fix(kordyn-v2): bind mobile details to selection`).
- Independent review fix round 1: implemented and verified in `32f945eae44aadaa94e3e9f0a6008f52bff6b4bd` (`fix(kordyn-v2): close mobile foundation review findings`).
- Earlier Task 8 implementation/report commits: `ba11087b63286153bcc4b1d8a1f8628ed64872e0`, `d99fa23d701d4914f2fcaba4c752616ed6586b77`.
- Branch: `codex/kordyn-v2-rebuild`; required base: `342278a01c2194e9791a3065297263d10e920993`.
- Latest scoped re-review input: visual gate cleared at `390/430`, with `0 Critical / 2 Important / 0 Minor` behavior findings remaining.
- Foundation boundary preserved: no Plan 02 work, merge, push, deploy, cutover, default enablement, route, API, write, permission, or production fixture was added.
- Plan 02 remains blocked pending independent verification of round 2.

## Round 2 scoped re-review

The scoped re-review correctly invalidated the round-1 report's unqualified “same canonical selection” and “all seven findings closed” claims. Those claims are supported only after the following round-2 tests and production fix.

### Round 2 strict RED

Tests and real production-shaped fixtures were written before the round-2 production edit.

Command:

```text
node tests/run-kordyn-v2-shell-browser.mjs --mobile-only
```

Valid RED result after correcting an over-narrow Proof-row test expectation: exit `1`, three semantic failures.

```text
partial Recent keeps known rows but visibly discloses unavailable completeness:
  expected {"completeness":"unavailable","warning":"Unavailable","rows":1,"actions":0}
  received {"completeness":"unavailable","warning":null,"rows":1,"actions":0}

explicit outside-slice selection owns the visible Mission projection:
  selectedId was watch-canonical-outside
  expected LINK / LINK canonical outside-slice Mission / Canonical LINK thesis / Canonical Strategy 11 / CPI · 12h
  received BTC / Sliced Agent run 1 / Unrelated visible row 1 / Unavailable / Unavailable

governed Details uses exactly the outside-slice canonical selection:
  identity was Watch / watch-canonical-outside
  expected Canonical Strategy 11, Canonical Knowledge 11, 行情 / 市场结构 / 审计, CPI · 12h, short 3.5
  received Unavailable for all five Details facts

3 !== 0
```

This proves the failure at the rendered production boundary: selection identity/Context/Proof were canonical while the Mission and Details source still came from unrelated sliced row zero. It also proves that a known completed row plus one absent expected source lacked visible partial disclosure.

### Round 2 minimal production fix

- `MobileMissionHome` now uses a matching Mission row only when its id equals the canonical selected id. When a valid selection lies outside the sliced rows, it uses `selection.object.raw/title/context`; `rows[0]` is retained only when there is no canonical selected id.
- Incomplete Recent sources always render a visible `Unavailable` status while retaining any real completed rows. The real Chrome assertion verifies both the row and warning have non-zero rendered geometry and are not `display:none`/`visibility:hidden`.
- The regression clicks a `需要你` candidate whose Watch is beyond ten sliced Agent rows, then verifies Mission symbol/title/signal, all three first-viewport facts, all five governed Details facts, Context id, Proof id/target trace, and zero actions.

### Round 2 GREEN

Command:

```text
node tests/run-kordyn-v2-shell-browser.mjs --mobile-only
```

Exit `0`:

```text
KORDYN V2 mobile shell browser PASS 390x844:nav=4,focus=3,overflow=0,targets=44 430x932:nav=4,focus=3,overflow=0,targets=44 states=5 long-content=2 screenshots=0
KORDYN V2 mobile geometry 390:stateBottom=782,navTop=782,reserve=62,workspaceMin=44.0,headerBottom=214,missionTop=248,needsTop=418,impactTop=506,recentTop=635,recentRowsBottom=726,promptTop=730,sheet=225-782,proofScroll=419/571 | 430:stateBottom=870,navTop=870,reserve=62,workspaceMin=44.0,headerBottom=214,missionTop=248,needsTop=448,impactTop=547,recentTop=698,recentRowsBottom=799,promptTop=808,sheet=255-870,proofScroll=477/571 transition=ai/intelligence:operationsCenter
```

The cleared default visual geometry is byte-for-byte/landmark unchanged. Round 2 changes only selection behavior and the conditional partial-source status.

## Cumulative findings now locally closed

1. The governed Mobile Mission evidence sheet opens on `详情` and exposes all five loaded decision facts: strategy, knowledge source, capability, event, and selected-position impact. The outside-slice interaction proves Mission, Details, Context, and Proof use exactly the same canonical selected id and source.
2. Recent completeness requires all three authoritative sources to be arrays. A real partial fixture with one completed row and one absent source proves the row remains rendered while visible `Unavailable` prevents a complete/authoritative claim.
3. `MobileShell` no longer forces every domain to Full Truth. Only the approved AI Mission location explicitly requests Full; canonical compact Assets and critical Governance remain intact.
4. Mobile stages now use the canonical `Sense → Plan → Guard → Execute → Monitor` identity and `快扫 / 结构 / 风控 / 执行 / 等待回踩` labels. Connector paint derives only from the real current-stage status; unavailable/waiting never looks complete and blocked is distinct.
5. The Mobile Mission now preserves an outer `AI 交易员` runtime frame and a real nested Mission card. The evidence action is secondary, stage/fact type is at least `11px`, and the unchanged hard geometry remains: outer height `>=190px`, inner height `>=148px`, real nested Mission top `<250px` at both sizes.
6. Evidence tabs implement one roving tab stop, ArrowLeft/ArrowRight/Home/End navigation and focus, `aria-controls`, and a labelled `tabpanel`.
7. Only the confirmed unreachable old mobile `MissionControl` override block was removed. Mobile destination/dialog rules remain.

Desktop continues through the unchanged Desktop render branch. No unsupported daily PnL was fabricated, all decision data comes from the loaded production-shaped facts, and every action counter remains zero.

## Strict TDD evidence

Tests were changed and run before the production files.

### RED — component contracts

Command:

```text
node --test tests/kordyn-v2-shell.test.mjs
```

Result: exit `1`; `8` tests, `6` pass, `2` fail.

```text
not ok APP shell preserves each non-Mission domain canonical truth mode
Assets actual truth mode: full
expected: compact

not ok APP governed evidence exposes full decision facts with complete tab relationships
missing Details tab / full decision facts / complete tab relationships

ℹ tests 8
ℹ pass 6
ℹ fail 2
```

This was the expected RED for Important 1, Important 3, and Minor 1.

### RED — real Chrome behavior, geometry, state, and CSSOM

Command:

```text
node tests/run-kordyn-v2-shell-browser.mjs --mobile-only
```

Result: exit `1`; `23` aggregated contract failures after the test-only evaluator was corrected from an initial `fontSize is not defined` harness error.

The valid production RED reported these repeated failures at `390` and `430`:

```text
approved AI Trader frame contains a nested Mission card: received false
outer AI Trader frame retains approved card rhythm: received undefined
core Mission stages and facts stay readable: received 7px
evidence remains a secondary control: received 88px
unreachable legacy mobile MissionControl overrides are absent from the loaded CSSOM: expected 0, received 1
mobile progress follows canonical stage identity and real status:
  received sense/快扫, plan/结构, execute/核对账户, guard/硬风控, monitor/等待回踩 with null connectors
complete and unavailable connectors have distinct painted states: received the same paint
governed evidence sheet exposes Details, Context, and Proof tabs: Details missing
Mission disclosure opens its full decision details: received proof
governed mobile details tab is present: received ["Context","Proof"]
```

The same valid RED also reported:

```text
partial Recent sources fail closed instead of claiming authoritative empty:
  received 当前没有已完成的 Mission 或 Agent 运行。 / no completeness
  expected Unavailable / unavailable

unavailable mobile stages preserve canonical order without positive connectors: failed
partial mobile stages bind only their real canonical statuses: failed
```

This covered Important 1, 2, 4, 5 and Minor 1, 2 against rendered production components and a real partial payload shape.

### Hard-contract correction before final GREEN

A temporary convergence assertion targeted the outer frame top instead of retaining the plan's hard nested-Mission top. It was rejected, restored to the real `[data-kordyn-v2-mobile-active-mission] < 250px` assertion, and the production frame header/padding/gap were tightened without changing markers or lowering the `190/148px` hierarchy requirements. Final real nested-Mission top is `248px` at both viewports.

## Final GREEN evidence

### Focused component

```text
node --test tests/kordyn-v2-shell.test.mjs
```

Exit `0`:

```text
✔ Desktop shell follows the approved four-domain composition
✔ APP shell exposes exactly four full-label roots without a catch-all destination
✔ APP shell follows the approved compact identity, title, destinations, and truth order
✔ APP shell preserves each non-Mission domain canonical truth mode
✔ APP governed evidence exposes full decision facts with complete tab relationships
✔ APP shell keeps unknown and adverse truth fail-closed
✔ Trace identity gives explicit object identity precedence over a record id
✔ Trace identity retains id-only legacy row matching
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

### Real Chrome Mobile gate

```text
node tests/run-kordyn-v2-shell-browser.mjs --mobile-only
```

Exit `0`:

```text
KORDYN V2 mobile shell browser PASS 390x844:nav=4,focus=3,overflow=0,targets=44 430x932:nav=4,focus=3,overflow=0,targets=44 states=5 long-content=2 screenshots=0
KORDYN V2 mobile geometry 390:stateBottom=782,navTop=782,reserve=62,workspaceMin=44.0,headerBottom=214,missionTop=248,needsTop=418,impactTop=506,recentTop=635,recentRowsBottom=726,promptTop=730,sheet=225-782,proofScroll=419/571 | 430:stateBottom=870,navTop=870,reserve=62,workspaceMin=44.0,headerBottom=214,missionTop=248,needsTop=448,impactTop=547,recentTop=698,recentRowsBottom=799,promptTop=808,sheet=255-870,proofScroll=477/571 transition=ai/intelligence:operationsCenter
```

The runner renders/clicks the actual `KordynV2Root`; it covers four roots, five AI-local destinations, notification, Details/Context/Proof, keyboard tab navigation, Escape/pointer close, AI 客服, prompt, canonical selection, modal inertness/focus return, partial Recent, unavailable/partial stages, five non-happy states, long content, `44px` targets, no overflow, and zero production writes.

## Files changed

Production:

- `src/kordynV2/KordynV2Root.jsx`
- `src/kordynV2/shell/MobileShell.jsx`
- `src/kordynV2/shell/MobileSheet.jsx`
- `src/kordynV2/styles/mobile-shell.css`

Tests/fixtures:

- `tests/kordyn-v2-shell.test.mjs`
- `tests/kordyn-v2-shell-browser.jsx`
- `tests/kordyn-v2-production-fixture.js`
- `tests/run-kordyn-v2-shell-browser.mjs`

Evidence/ledger:

- `docs/kordyn-v2-evidence.md`
- `.impeccable/review/kordyn-v2/foundation/capture-evidence.json`
- `.impeccable/review/kordyn-v2/foundation/mobile-390x844.png`
- `.impeccable/review/kordyn-v2/foundation/mobile-430x932.png`
- `.impeccable/review/kordyn-v2/foundation/mobile-390x844-proof-sheet.png`
- `.impeccable/review/kordyn-v2/foundation/mobile-{390x844,430x932}-ai-support-{open,long-content}.png`
- `.impeccable/review/kordyn-v2/foundation-compare/comparison-index.json`
- `.impeccable/review/kordyn-v2/foundation-compare/mobile-ai-mission-home--{390x844,430x932}--{overlay,difference,geometry}`

Normalized references were regenerated deterministically but remain byte-identical. Desktop captures were not refreshed and their hashes remain unchanged.

Round 2 changed only:

- `src/kordynV2/KordynV2Root.jsx`
- `tests/kordyn-v2-production-fixture.js`
- `tests/kordyn-v2-shell-browser.jsx`
- `tests/run-kordyn-v2-shell-browser.mjs`

The comparison command produced no round-2 evidence diff because the cleared default screenshots and geometry did not change.

## Screenshots and hashes

Immutable source:

- `mobile-ai-mission-home.png`: `6e0eda474f6658ff9dbfcbc6b18d4503203a78ddb30e38aa22b0760c1c902c9b`

Fresh captures:

- `mobile-390x844.png`: `467223c59fea01660ca802cc27f3c27531e34dc4318c7dc8149bd2c07f355a1d`
- `mobile-430x932.png`: `e6bc4a303848e9f6336a74a09291cc51f5178d7964d28e678858f18afd113158`
- `mobile-390x844-proof-sheet.png`: `af649f8a65bdb7abbe9e98d309e3d8132a56b9efc1d9916398f2a2931ffdc6fe`
- `mobile-390x844-ai-support-open.png`: `b57c18f955da8b5a0591e99c03b8b1a21ad5d1b9e2324c222c7153b661370a23`
- `mobile-430x932-ai-support-open.png`: `7360fa3936b69c94a29ccfba601d8af6fedfbbf1d9578b8bf9ff8c836656ba3d`
- `mobile-390x844-ai-support-long-content.png`: `57df4a66ae1dfe6ef057c0f5ba0729fdf165d7743d80d67b42eb2b2b6ce13b37`
- `mobile-430x932-ai-support-long-content.png`: `8b357690dfe9fe98f237cc371c2dfa3d8fd9c6c1b2cfcd7386b771e1da6b7373`
- `capture-evidence.json`: `998ca40bc6f8a34db6aeee00d32ccb6948609b7512d2cd9f644d5990d617cccd`

Comparison evidence:

- `comparison-index.json`: `5a71cbdbe6c03e509253d2c39ec081cf761ef1aa72eb821156d4b4d628abf444`
- 390 normalized reference: `2d2c24912b9843d1de183dbb66ebbbc9fd39c928874558c918eb51e406d6faff`
- 390 overlay: `ac9df3cb58b2255ddbd7567b44c062cb9e40680f4a0fe933d830c39b8953e411`
- 390 difference: `d3ba025b84670c3431423ea8b643b42fde44a5472666f76f9319b3790b678490`
- 390 geometry: `490b4059dc08c6c83b61a73d63ebba3ab5907b05fdd51457fb27a337942837df`
- 430 normalized reference: `f3e8a97d69a54a9754c92b89fcba0c39821e7e88fbcd2ca37f24b2ece86d2049`
- 430 overlay: `71d1ab1eef0811fe477db9c56d5a1c932d0e3bce7859a994c2c5e2b038a3c941`
- 430 difference: `a33734cc90697260aa49bcf36c503d222311c7383ad16333c7e8c97bb591c0fc`
- 430 geometry: `bdc82b74737f50e6ed57a0af6387f8b64df72847797e469b465c00901e2b5d0a`

Unchanged Desktop evidence:

- `desktop-1440x900.png`: `194892406891ef5b372e1364615eb4808e06bf22f23562028c0fe622ea6d9aee`
- `desktop-1180x800.png`: `a37413c105455ed0c7ffb569fa0165cc984c6e4d80821b384fa9282269111b46`

Diagnostic APP pixel differences are `0.07927340101998591` at 390 and `0.07838120642674344` at 430. They are not release thresholds.

## Original-resolution visual observations

The immutable approved source, both normalized references, both fresh base captures, all overlays and absolute differences, and the governed sheet capture were opened at original resolution.

### 390x844

- Header bottom is `214px`; outer runtime frame starts immediately after the header and the real nested Mission starts at `248px`.
- The runtime title and loaded health remain legible above a distinct inner Mission boundary; stage and fact text is no smaller than `11px`, and the `64px` evidence control is visually secondary while remaining `44px` high.
- Canonical stage order is visibly `快扫 / 结构 / 风控 / 执行 / 等待回踩`; the first three real complete connectors are mint and waiting connectors are neutral.
- `需要你 / 账户影响 / 最近完成` begin at `418 / 506 / 635px`. Both Recent rows are fully visible; the second ends at `726px` and prompt begins at `730px`.
- Prompt, AI 客服, and the four-root navigation cover no Recent row. Navigation begins at `782px`; the shell reserves the real `62px` bottom navigation.

### 430x932

- Header bottom is `214px` and the real nested Mission again starts at `248px`.
- The taller frame and inner Mission preserve a fuller card rhythm without stretching a blank sibling card.
- `需要你 / 账户影响 / 最近完成` begin at `448 / 547 / 698px`. The second Recent row ends at `799px`, prompt begins at `808px`, and navigation begins at `870px`.
- The `9px` Recent-to-prompt transition uses the available height without the prior approximately `80px` dead zone and without overlap.

### Governed disclosure and comparison

- The Details sheet exposes all five real decision facts; Context and Proof remain accessible in the same bounded modal. Proof scroll is `419/571` at 390 and `477/571` at 430.
- All three tabs are touch-sized and visibly participate in a single governed surface; keyboard focus and tabpanel labelling were separately verified in Chrome.
- Expected local visual differences remain because production shows authoritative fixture facts and explicitly omits the unsupported concept daily PnL. Human region review, not pixel similarity, remains authoritative.
- Round-2 real Chrome now proves the two scoped behavior findings closed locally in addition to the earlier visual/interaction fixes. Independent verification of round 2 is still outstanding.

## Full gates

### Focused isolated contract suite

```text
node scripts/run-tests-isolated.mjs tests/kordyn-v2-architecture.test.mjs tests/kordyn-v2-cutover.test.mjs tests/kordyn-v2-state.test.mjs tests/kordyn-v2-actions.test.mjs tests/kordyn-v2-shell.test.mjs tests/kordyn-v2-ai-support.test.mjs tests/kordyn-v2-concept-manifest.mjs tests/kordyn-v2-performance.test.mjs
```

Exit `0`: `65` tests, `65` pass, `0` fail; duration `1365.39925ms`; isolated data root cleaned.

### Full repository suite

```text
npm test
```

Exit `0`: `1746` tests, `1746` pass, `0` fail, `0` skipped; duration `9686.155667ms`; isolated data root cleaned.

### Lint

```text
npm run lint
```

Exit `0`; ESLint output contained no findings.

### Production build

```text
npm run build
```

Exit `0`; Vite `6.4.3`, `1674` modules transformed, built in `1.18s`. The existing greater-than-500k chunk advisory remains the only advisory.

### Combined Desktop/APP real Chrome shell

```text
node tests/run-kordyn-v2-shell-browser.mjs
```

Exit `0`. Desktop passed `1440x900` (`MAE 0.039473`) and `1180x800` (`MAE 0.043104`), each with `nav=4`, `focus=3`, `overflow=0`; Mobile passed with the exact final GREEN geometry above. Desktop source/captures remain unchanged.

### Canonical selection, cutover/recovery, public/auth

```text
node tests/run-canonical-selection-browser.mjs && node tests/run-kordyn-v2-cutover-browser.mjs && node tests/run-zero-base-auth-browser.mjs
```

Exit `0` for all three. Canonical pointer/keyboard/object routes passed; cutover reported `PASS retry=1 legacy=1 api=0`; public/auth passed at `1440x900`, `390x844`, and `430x932` with no overflow and all required login, MFA, registration, modal focus/trap, and Escape interactions.

### Fresh isolated performance build

```text
node tests/run-kordyn-v2-performance-build.mjs
```

Exit `0`, `PASS`:

```text
public:   js=375164 gzip=123897 css=15304 gzip=3746
AI shell: js=458496 gzip=147363 css=76273 gzip=14164 loadsLegacyProductStyles=false
legacy:   js=46 gzip=66 css=843660 gzip=141376
budgets: publicCss 15304/40000 pass; publicJs 375164/450000 pass; aiShellCss 76273/180000 pass
integrity: source unchanged; checked-in dist unchanged; temporary output removed
```

### Capture and comparison

```text
KORDYN_V2_SCREENSHOT_DIR=.impeccable/review/kordyn-v2/foundation node tests/run-kordyn-v2-shell-browser.mjs --mobile-only
```

Exit `0`; both required viewports passed, `screenshots=7`, final geometry as recorded above.

```text
node scripts/compare-kordyn-v2-concepts.mjs --scope shell --screenshots .impeccable/review/kordyn-v2/foundation --output .impeccable/review/kordyn-v2/foundation-compare
```

Exit `0`:

```json
{"counts":{"concepts":15,"completedConcepts":2,"pendingConcepts":13,"comparisons":4,"artifacts":17},"releaseVerdict":"human region review required"}
```

### Impeccable detector, hard scan, and diff check

Impeccable context had already been run exactly once for this changed Mobile target in the original Task 8 implementation; it was not rerun during review fixes.

```text
node /Users/ely/.codex/skills/impeccable/scripts/detect.mjs --json src/kordynV2/KordynV2Root.jsx src/kordynV2/shell/MobileShell.jsx src/kordynV2/shell/MobileSheet.jsx src/kordynV2/styles/mobile-shell.css
```

Exit `0`:

```json
[]
```

```text
rg -n "!important|src/styles\\.css|productStyles|kordyn-v2-production-fixture" src/kordynV2 || true
```

Output: empty.

```text
git diff --check
```

Output: empty; exit `0` before the implementation/evidence commit and again before report commit.

## Concerns and boundary

- Independent verification has not yet cleared round 2; Plan 02 remains blocked.
- Physical-device and live-payload variance have not been verified. Real Chrome covers both required viewport geometries, a production-shaped happy fixture, a real partial Recent shape, unavailable/partial stage shapes, and the existing non-happy states.
- Pixel differences remain diagnostic only and include expected real-data/unsupported-PnL differences.
- Vite continues to emit the existing chunk-size advisory; all explicit performance budgets pass and V2 still does not load legacy product CSS.
- No merge, push, deploy, cutover, default enablement, Plan 02 implementation, route, API, write, permission, or production mock was performed.
