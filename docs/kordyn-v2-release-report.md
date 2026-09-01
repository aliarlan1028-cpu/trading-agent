# KORDYN V2 Plan 06 Release Report

Date: 2026-09-01
Scope: authenticated Desktop and APP presentation convergence and default cutover

## Release verdict

KORDYN V2 is the authenticated default at production source `0509ee41a170e850f459ae9acdab4cef1ab07473`. The legacy authenticated presentation remains available through the explicit build-time rollback value `VITE_KORDYN_UI_VERSION=legacy`; it was not deleted.

The change is presentation-only. No server, API, database, auth, permission, trading, execution, risk, or public marketing implementation changed in Plan 06.

## Commit chain

| Purpose | Commit |
| --- | --- |
| Capability and canonical object convergence | `dbc31029d66472121d3cd541df2219d6a896b62f` |
| State, accessibility, localization, responsive hardening | `d6e065ec8c4edd73d41f60becfc2e1af8928cac4` |
| Route-level performance convergence | `7f475cc6425ae2f2af9e8bb022ca2d332d061d44` |
| Final evidence capture tooling | `4214862dc105995a4e8935d75ff1dc89653ace67` |
| AI reading-order production correction | `c2d0939765a815c15b3f8bbc7b1d8eca5c03c8a9` |
| Base final visual evidence | `5bbd4bc4dfddfbad23846d9041bb5c97004bfd16` |
| Production and rollback gate | `972485d6a7653a53f9b46a5f923af3d52e5c22a5` |
| Lazy-ownership test alignment | `a7593e56a6184cebaaf0f10a8c14d4c9ab8098ea` |
| Final Mission shell/geometry gate | `6888088cac1168537905eb0ea70c176fb7f748b6` |
| V2 authenticated default | `0509ee41a170e850f459ae9acdab4cef1ab07473` |
| Final AI/overlay evidence refresh | `6803afa447444d6f5db4e8668d9ea0f13908eb8a` |

## Capability, object, state, and authority result

- Capability migration: `66 / 66` deployed capabilities have a registered V2 route, Desktop presenter, APP presenter, object/view/action boundary, permission source, state source, and focused verification.
- Canonical objects: Desktop `28 / 28`; APP representative Mission, Market, Strategy product, and Task `4 / 4`; selected object, Context, and Proof identities match after real clicks.
- State semantics: all four domains cover loading, empty, processing, stale, degraded, failed, forbidden, disabled, approval, partial, no-result, long-content, and large-list (`13 / 13` each).
- Rollback action contract: legacy and V2 expose the same frozen set of deployed method/path boundaries. No action was added by the redesign.

## Fresh verification

| Gate | Result |
| --- | --- |
| Focused Plan 06 suite | `196 / 196`, exit `0` |
| Complete test suite | `2214 / 2214`, exit `0` |
| ESLint | exit `0` |
| Production build | exit `0`; Vite transformed `1796` modules |
| Shell browser | Desktop 1440/1180 and APP 390/430 PASS; zero overflow; APP targets `44px` |
| AI master browser | `8` captures; Desktop+APP Mission/Signal/Watch/Event; approval failed/partial; `13 / 13` states |
| Account master browser | `4` captures; `13 / 13` states; `11` accepted interactions; `4` action ledgers |
| Assets master browser | `18` captures; `13 / 13` states; `8` selections; `3` action modes |
| Governance master browser | `15` captures; `13 / 13` states; `12` selections; `4` action modes |
| Canonical selection browser | Desktop `28 / 28`; APP `4 / 4`; Context+Proof matched |
| Accessibility browser | four viewports; six focus traps each; zero overflow; `200 / 200` rows; reduced motion visible |
| Performance browser | AI `499ms`; Account `203ms`; Assets `115ms`; Strategy `39ms`; Governance `171ms`; zero premature/legacy requests and zero >200ms V2 long tasks |
| Production/rollback browser | V2 `23 / 23`; legacy `6`; same backend/user; marker persisted; invalid `400`; forbidden `403`; mutually exclusive CSS |
| Contact renderer | `82 / 82`; broken `[]`; pending false; `1800x7804` |
| Diff check | exit `0` before documentation commit |

## Build budgets

| Boundary | Actual bytes | Limit | Result |
| --- | ---: | ---: | --- |
| Public CSS | `15,304` | `< 40,000` | PASS |
| Public JS | `385,329` | `< 450,000` | PASS |
| AI + authenticated shell CSS | `125,017` | `< 180,000` | PASS |
| Account route CSS | `114,976` | `< 120,000` | PASS |
| Assets route CSS | `112,221` | `< 120,000` | PASS |
| Governance route CSS | `119,536` | `< 120,000` | PASS |
| Governance route JS | `614,503` | `< 650,000` | PASS |

## Visual evidence and provenance

The final contact sheet is `.impeccable/review/kordyn-v2/final/contact-sheet.png`, SHA-256 `c24175355363d468b35d9a5718831d62be2cc8b558e2459728d5adb4cd457409`, committed at `6803afa447444d6f5db4e8668d9ea0f13908eb8a`.

AI and shared overlays were freshly recaptured against `0509ee4`. Account, Assets, and Governance retain unchanged base captures against `c2d0939`, with exact capture-test provenance in their sidecars. This report does not equate a still-valid image with a fresh recapture.

Original-size review covered the whole contact sheet plus Desktop AI Mission at `1180x800`, APP Mission at `390x844`, and APP Context at `390x844`. The runtime/Evidence gap is `27px` at `1440x900` and `22px` at `1180x800`; the four target viewports have zero document overflow. No broken image, abnormal blank region, title collision, mobile sheet collision, or clipped critical action was found.

## Review disposition

The read-only release review found `Critical 0 / Important 0 / Minor 0`. It was performed inline because the current execution constraints did not authorize a new reviewer agent; it is not represented as an independent reviewer result. Mechanical Impeccable detection over `src/kordynV2` returned `[]`.

## Rollback

Build or deploy the authenticated frontend with:

```bash
VITE_KORDYN_UI_VERSION=legacy npm run build
```

The rollback changes presentation only. It uses the same backend, permissions, state, action endpoints, and persistent data. Invalid explicit UI-version values intentionally resolve to legacy.

Legacy deletion is out of scope and requires a separately approved cleanup plan after production observation.
