# Task 10 — final production visual evidence

Date: 2026-08-25

## Frozen source chain

- Immutable prototype authority: `10562336e1315733438f563f4ca1a8679f7e2c9c` (`prototypes/kordyn-operating-system.html`, blob `43267ccfca051351823c668932c857350fb592b9`).
- Desktop full-shell last-valid geometry contract: `9d93b0180b5a7262372064f9ddddbfc96fbf4f38`.
- Final production HEAD: `5448040c42ef678f71e6367d9c8280b1258ce857`.
- Base production/capture batch: production `db5286a1f76d7f331c23de49b314179c77cde557`, capture/test `5e017f05b7da02befb08e818856e2fd9c3ed1f44`.
- Inherited APP detail batch: `.impeccable/review/mobile-390-operations.png` and `.impeccable/review/mobile-430-configuration.png` only, retained from evidence-only commit `1f379b430ba61d005a73936cc05c3788d950b5dd` (production `3bd2ce86fb6b1efa93922d522ac52cd1893ee432`, capture runner `f855781a8b9b8f83421b334b49d72796056dd9f3`).
- Boundary recapture batch: Desktop last-valid stale/degraded only, captured after the `5448040` fix.
- Main evidence assets, renderer and Desktop boundary aggregation: `ffaebb9966f218cc4530fb972b0488b4b03f80da`.
- Inherited APP provenance disclosure correction and current final contact-sheet HTML/PNG state: `e904335977b35eb3ab738d552f66900911dd4ae2`.
- Pre-correction documentation index: `594f62f24ac728d4e3fb0dc54521f6bb7bb6d3a7`; this is historical and does not contain the inherited APP provenance correction.
- `0cd9933` is the pre-amend intermediate hash and must not be used as final evidence.
- `878109a` (earlier evidence batch) and `8493bcd` (earlier evidence index) are historical, superseded states. Neither is the final evidence source.

## Real Chrome capture manifest

The contact sheet was rendered with the approved local Google Chrome path at device scale factor 1. Its referenced screenshots retain their actual capture provenance; visual validity on the final branch is not treated as proof of recapture. Required representative artifacts are:

| Artifact | Exact size | Capture provenance | Production state |
| --- | ---: | --- | --- |
| `.impeccable/review/desktop.png` | 1440×900 | `db5286a + 5e017f0` base batch | Desktop AI Trader |
| `.impeccable/review/desktop-medium.png` | 1180×820 | `db5286a + 5e017f0` base batch | Medium desktop with Context open |
| `.impeccable/review/desktop-last-valid-stale.png` | 1440×900 | `5448040` boundary recapture | Full production-component shell, stale last-valid state |
| `.impeccable/review/desktop-last-valid-degraded.png` | 1180×820 | `5448040` boundary recapture | Full production-component shell, degraded last-valid state |
| `.impeccable/review/mobile.png` | 390×844 | `db5286a + 5e017f0` base batch | MobileApp AI Trader |
| `.impeccable/review/mobile-430x932.png` | 430×932 | `db5286a + 5e017f0` base batch | Wide MobileApp AI Trader |
| `.impeccable/review/mobile-390-operations.png` | 390×844 | inherited evidence `1f379b4` (`3bd2ce8 + f855781`) | MobileApp Operations detail |
| `.impeccable/review/mobile-430-configuration.png` | 430×932 | inherited evidence `1f379b4` (`3bd2ce8 + f855781`) | MobileApp Configuration detail |
| `.impeccable/review/parity-contact-sheet.png` | 1800×6458 | current contact state `e904335`; main assets/renderer `ffaebb9` | 62-image final overview with inherited APP disclosure |

The base `db5286a + 5e017f0` batch covers all desktop destinations and the APP primary/More, AI chat/watch/intelligence/events, Live, Lab, Control Posture/Event Risk/Boundaries/Rules, Object Switcher default/hover/focus/unavailable, selected-object Context/Trace, medium Context open/collapsed, drawers/sheets, authenticated overlays, ordinary/danger confirmations, long content and original state evidence listed below, except for exactly two inherited APP detail cells: Operations at 390 and Configuration at 430. Those two files remain byte-identical evidence from `1f379b4`; their continued visual validity is not described as a `db5286a + 5e017f0` recapture. `5448040` adds only the two Desktop last-valid boundary recaptures. `ffaebb9` assembles the main evidence assets, renderer and Desktop boundary cells across these provenance layers; `e904335` subsequently changes only the contact-sheet HTML/PNG disclosure and is the current final contact-sheet state.

## Desktop last-valid closure

The prior fragment-only Desktop harness was rejected because it could produce a nearly blank image while DOM-only assertions still passed. `9d93b01` replaced it with a full production-component shell composed from the real Command Rail, Workspace Rail, main workspace, Context Dock, Trace Rail, `WorkspaceStateBoundary` and `AiTraderCenter`. The browser contract now requires visible shell, banner, retry and last-valid content rectangles, inert/pointer-disabled stale facts, forced retry and no page overflow.

The first full-shell 1180 capture exposed a real Context overlap. `5448040` constrains only stale/degraded boundaries at 721–1280px, reserving 304px for open Context and 58px for collapsed Context. It does not alter loaded workspaces, APP layout or the default Context state.

Fresh final geometry:

- 1440 stale, open Context: Context left `1136`; banner/retry/truth right edges `1106 / 1089 / 1120`.
- 1180 degraded, collapsed Context: Context left `1122`; banner/retry/truth right edges `1092 / 1075 / 1106`.
- 1180 degraded, open Context: Context left `876`; banner/retry/truth right edges `846 / 829 / 860`.

Every constrained surface ends before the Context Dock. Both final Desktop screenshots visibly retain the full warning, reachable Retry action, last-valid workspace and the production shell rails.

## Authenticated production-shell provenance

- These authenticated screenshots belong to the `db5286a + 5e017f0` base capture batch.
- Startup loading pauses the actual `/api/bootstrap/core` request in the authenticated `AppFrame`.
- Connection failed aborts that same request.
- Desktop and 390 ordinary `ConfirmHost` are opened by trusted clicks through actual Operations → Recovery → reconciliation actions.
- Focus is verified as Cancel → Tab to Confirm → Shift+Tab to Cancel; Escape closes and returns focus to the trigger.
- Desktop and 390 Release Notice evidence comes from actual `VITE_APP_RELEASE` / `APP_RELEASE` mismatch processes.
- A fresh same-tenant non-Owner login returned HTTP 200, the same session received HTTP 403 from `/api/admin/users`, and MobileApp displayed the Owner-required gate.

Credentials are not stored in screenshots or reports.

## State-evidence honesty

- Operations loading and failed and AI Trader → Events source-health images belong to the `db5286a + 5e017f0` base batch; loading/failed pause or abort an existing request and do not replace its response body.
- APP last-valid stale/degraded screenshots also belong to the base batch.
- Desktop last-valid stale/degraded screenshots alone are the `5448040` boundary recapture batch. All last-valid images use production component state harnesses and prove warning + readable last-valid content + inert subtree + retry, but are not described as naturally occurring backend states.
- Empty and disabled evidence uses actual application states.
- No DOM mutation, mock application payload, fake success result or demo result row is used.

## Reproducible contact-sheet gate

The evidence commit adds `scripts/render-parity-contact-sheet.mjs`. It starts a dedicated headless Chrome process on a random loopback debugging port, uses a unique temporary profile, waits for the document and every image, validates the evidence contract, captures the full page, then closes Chrome and removes the temporary profile in `finally`.

```text
EXPECTED_IMAGE_COUNT=62 node scripts/render-parity-contact-sheet.mjs
```

Approved-Chrome result:

```text
imageCount: 62
broken: []
width: 1800
height: 6458
pendingText: false
exit: 0
```

The resulting PNG was opened after render. Desktop stale and degraded appear as explicit independent cells in Truthful operational boundaries; both are readable and show no Context overlap. APP stale/degraded remain present as separate cells. The visible header states: immutable `1056233`; final production `5448040`; base capture/test `5e017f0`; inherited APP details `1f379b4`; boundary recapture `5448040`.

## Final evidence gates

- Exact document/body containment passed at 1440×900, 1180×820, 390×844 and 430×932.
- Object Switcher remains 620px wide, max-height 520px, paper background, 8px Ink offset and three columns; the live query uses five real rows and content-fit height.
- Contact-sheet render gate is `62/62`, `0` broken, with positive natural dimensions for every referenced image.
- Final sheet is 1800×6458 and contains no pending evidence text. It is explicitly documented as a mixed-batch sheet, not a uniform `5448040` recapture.
- `node --check scripts/render-parity-contact-sheet.mjs`, script ESLint, direct `ws` dependency resolution and `git diff --check` passed before the evidence commit.
