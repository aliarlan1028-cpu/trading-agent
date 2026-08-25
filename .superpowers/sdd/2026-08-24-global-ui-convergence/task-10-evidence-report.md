# Task 10 — final production visual evidence

Date: 2026-08-25

## Frozen source chain

- Immutable prototype authority: `10562336e1315733438f563f4ca1a8679f7e2c9c` (`prototypes/kordyn-operating-system.html`, blob `43267ccfca051351823c668932c857350fb592b9`).
- Production source: `db5286a1f76d7f331c23de49b314179c77cde557`.
- Capture / test HEAD: `5e017f05b7da02befb08e818856e2fd9c3ed1f44`; the only later commit is a selection-gate test change and has no Vite production pixels.
- Evidence asset commit: `878109af7ffda5aef189e4bc2698b7cc1edf0dd3`.

## Real Chrome capture manifest

Standalone Google Chrome was launched through `playwright-core` with device scale factor 1. The required representative images are:

| Artifact | Exact size | Production state |
| --- | ---: | --- |
| `.impeccable/review/desktop.png` | 1440×900 | Desktop AI Trader |
| `.impeccable/review/desktop-medium.png` | 1180×820 | Medium desktop with Context open |
| `.impeccable/review/mobile.png` | 390×844 | MobileApp AI Trader |
| `.impeccable/review/mobile-430x932.png` | 430×932 | Wide MobileApp AI Trader |
| `.impeccable/review/parity-contact-sheet.png` | 1800×6086 | 60-image final overview |

The full walk regenerated 96 production-side screenshot outputs. Fifty-four PNGs had binary changes at the final source and were stored with the updated contact-sheet HTML in the 55-file evidence commit; byte-identical outputs were still opened and recaptured by the same final-source runners. Coverage includes all six desktop destinations, APP primary/More destinations, AI chat/watch/intelligence/events, Live, Lab, Control Posture/Event Risk/Boundaries/Rules, Operations, Configuration, Object Switcher default/hover/focus/unavailable, selected-object Context/Trace, medium Context open/collapsed, drawers/sheets, ordinary/danger confirmations, long content and independent state boundaries.

## Authenticated production-shell provenance

The authenticated evidence does not use `tests/authenticated-overlay-browser.html` or an isolated component fixture:

- startup loading pauses the actual `/api/bootstrap/core` request in the real authenticated `AppFrame`;
- connection failed aborts that same request;
- desktop and 390 ordinary `ConfirmHost` are opened by trusted clicks through actual Operations → Recovery → reconciliation actions;
- focus was measured as Cancel → Tab to Confirm → Shift+Tab to Cancel, and Escape closes with trigger focus return;
- desktop and 390 Release Notice are produced by actual production Vite and backend processes with different `VITE_APP_RELEASE` and `APP_RELEASE` values;
- the captured desktop and APP Release/Confirm surfaces retain their real application background.

The forbidden state was recreated with a fresh isolated auth-required store. A real active same-tenant non-Owner `交易用户` logged in with HTTP 200; the same browser session received HTTP 403 (`Missing permission: admin:system`) from `/api/admin/users`, and the 390×844 Configuration route visibly showed the Owner-required gate. Credentials are absent from screenshots and reports. The temporary RBAC data was moved to Trash after capture and remains recoverable.

## State-evidence honesty

- Operations loading and failed capture only a paused or aborted existing request; no response body is replaced.
- AI Trader → Events stale source evidence is the current real source-health response.
- Desktop and APP last-valid stale/degraded screenshots come from the production state browser harness and prove warning + readable last-valid content + inert subtree + retry. They are not described as naturally occurring backend state.
- Empty and disabled evidence uses actual empty positions/plans/watch data and real disabled send/Kill controls.
- No DOM mutation, mock application payload, fake success result or demo row was used.

## Reproducible commands

The capture used these focused commands; `/private/tmp` runner files were created only for evidence orchestration and were not committed:

```text
PORT=5178 VITE_API_PROXY_TARGET=http://127.0.0.1:8794 npm run client
node /private/tmp/kordyn-playwright.6DyHri/task8-audit.mjs .impeccable/review all
node /private/tmp/kordyn-playwright.6DyHri/task8-fix1-audit.mjs .impeccable/review
node /private/tmp/kordyn-playwright.6DyHri/task8-mobile-long-audit.mjs
node /private/tmp/kordyn-playwright.6DyHri/task9-f855-evidence.mjs .impeccable/review
node /private/tmp/kordyn-playwright.6DyHri/task10-auth-real.mjs .impeccable/review
node /private/tmp/kordyn-playwright.6DyHri/task8-state-audit.mjs .impeccable/review loading
node /private/tmp/kordyn-playwright.6DyHri/task8-state-audit.mjs .impeccable/review failed
node /private/tmp/kordyn-playwright.6DyHri/task8-stale-audit.mjs .impeccable/review/desktop-real-stale-source.png
TASK8_TRADER_PASSWORD=<redacted> node /private/tmp/kordyn-playwright.6DyHri/task8-state-audit.mjs .impeccable/review forbidden
node /private/tmp/kordyn-playwright.6DyHri/task8-contact-sheet.mjs
```

The forbidden command additionally requires a fresh seeded auth-required backend and Vite proxy; the secret values are intentionally not recorded here.

## Final gates

- Exact document/body containment passed at 1440×900, 1180×820, 390×844 and 430×932.
- Object Switcher measured 620px wide, max-height 520px, paper background, 8px Ink offset and three columns. The live query returned five real rows and content-fit to about 275px; production did not pad with demo data.
- Contact-sheet render gate: `60` images, `0` broken; every image was complete with positive `naturalWidth` and `naturalHeight`.
- The 1800×6086 PNG was opened after the final render. Its visible header contains only immutable `1056233`, production source `db5286a`, capture/test HEAD `5e017f0` and the date. No alt text, broken thumbnail or fixture-only overlay remains.
- No new visual defect was found. No production source, test, PRODUCT or function-map file was changed by this evidence task.
