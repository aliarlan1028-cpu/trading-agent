# Cold-start Performance Repair Design

**Date:** 2026-09-02

**Status:** Implemented and verified on 2026-09-03 after final review fixes

**Scope:** Web public entry, authenticated Web entry, iOS/Capacitor startup, static asset build and cache policy

## Problem statement

KORDYN is healthy when measured inside the production host, but first-load performance from the primary client environment is poor. The observed delay is produced by four independent costs that currently stack in series:

1. `index.html` contains a render-blocking Google Fonts stylesheet that times out in the primary network environment.
2. The public marketing page is reached only after the React application has downloaded and mounted an iframe.
3. The marketing CSS and JavaScript are copied from `public/` without content hashes, so they are revalidated across the high-latency origin on every refresh.
4. A native installation without a stored session token still begins with an authenticated core probe and can wait for the native 30-second bootstrap timeout before showing login.

The production host itself is not saturated: its local HTTP path responds in roughly 9–13 ms, it has no OOM or restart history, and it is not actively swapping. This design therefore removes avoidable network and startup work instead of increasing server CPU or memory.

## Goals

- Serve the complete To the Moon marketing page directly from `/` without downloading the React application.
- Make `/app` the explicit Web application and authentication entry.
- Preserve the current marketing content, visual design, login form, subscription form, MFA, registration, consent, permissions, API contracts, and authenticated product behavior.
- Eliminate all runtime Google Fonts requests from both the Web build and the packaged iOS application.
- Emit the marketing CSS and JavaScript as content-hashed Vite assets covered by the existing immutable `/assets/` cache policy.
- Show the native login page immediately when no native token exists, without issuing an authenticated core request first.
- Start loading the authenticated shell in parallel with the `/app` session probe so a valid session does not pay a second serial network round.
- Produce automated and browser evidence for 1440, 1180, 430, and 390 pixel viewports.

## Non-goals

- No change to API payloads, database schema, authentication authority, permissions, trading, execution, risk, approval, recovery, or state semantics.
- No production deployment or DNS change in this implementation batch.
- No CDN vendor selection or origin migration. Those remain a separate infrastructure batch after the code path is measured in production.
- No visual redesign of the marketing page, Web login/subscription modal, APP login page, or authenticated workspaces.
- No replacement of current product functionality with mock data.

## Entry architecture

### Public document

`GET /` and `GET /landing.html` return the built marketing document. The document is a Vite HTML entry and references content-hashed CSS and JavaScript under `/assets/`. It does not load `src/main.jsx`, React, authenticated styles, or authenticated workspace chunks.

The existing To the Moon markup and bilingual content remain the public source of truth. Moving the files into Vite's source graph changes their build treatment, not their content or interaction model.

### Product document

`GET /app`, `GET /app/`, and paths below `/app/` return the built React `index.html`. The React application continues to own:

- cookie-session discovery on Web;
- token-session discovery in Capacitor;
- login, subscription, MFA, registration, captcha, consent and server settings;
- authenticated shell and all existing product workspaces.

The application route does not encode credentials or tokens in the URL.

### Marketing actions

When `landing.html` is the top-level document:

- `data-action="login"` navigates to `/app?auth=login`;
- `data-action="subscribe"` navigates to `/app?auth=subscribe`.

When the same marketing document is rendered as the background iframe of the unauthenticated `/app` surface, it preserves the existing same-origin `postMessage({ type: "lp-start", mode })` behavior. This keeps the real React authentication modal as the only form implementation.

`WebLandingPage` reads only the allowlisted `auth` values `login` and `subscribe`, opens the corresponding modal, and removes the one-shot query parameter with `history.replaceState`. Unknown values fail closed to the normal unauthenticated marketing surface.

## Build and cache architecture

- Move the marketing HTML from `public/landing.html` to the project HTML-entry layer.
- Move marketing CSS and JavaScript into a dedicated `src/marketing/` source boundary.
- Configure Vite with two HTML inputs: the product `index.html` and public `landing.html`.
- Let Vite rewrite marketing CSS and JavaScript to content-hashed `/assets/` paths.
- Keep `index.html` and `landing.html` on `Cache-Control: no-cache` so deployments become visible immediately.
- Keep hashed `/assets/*` on `public, max-age=31536000, immutable`.
- Preserve current cache behavior for non-hashed icons and manifest assets in this batch; changing those assets is not required to remove the blocking waterfall.

The built public document must not reference the product entry chunk. The built product document must not reference marketing CSS or JavaScript unless the unauthenticated iframe is subsequently requested.

## Font policy

Remove the Google Fonts `preconnect` and stylesheet elements from the product HTML entry. Do not add another remote font provider.

The existing CSS fallback stacks remain authoritative:

- display/UI text uses installed `Avenir Next`, `Inter`, `Public Sans`, `PingFang SC`, `Microsoft YaHei`, and generic sans-serif fallbacks as declared by each surface;
- monospace text uses installed `SFMono-Regular`, `IBM Plex Mono`, and generic monospace fallbacks.

The iOS bundle receives the same font-free HTML through the normal Capacitor sync. No external font request may remain in the generated `ios/App/App/public/index.html` after sync.

## Native startup behavior

Native authentication state is synchronously knowable because the token is stored locally:

- Native + no stored token: initialize `authRequired=true`, render `NativeAuthPage` immediately, and do not call `/api/bootstrap/core` until login succeeds.
- Native + stored token: initialize `authRequired=false`, perform the current authoritative core request, and retain the existing connection, expiry and retry behavior.
- Web: continue to initialize on the public surface because an HttpOnly cookie cannot be inspected synchronously. `/app` performs the current server-authoritative session probe in the background.

Token presence is only a loading hint. It never grants access; the server response remains the authority.

## Authenticated-shell loading

On `/app`, begin the existing August 15 authenticated entry import while the core session request is in flight. This is a code preload only:

- it performs no API action;
- it grants no permission;
- it does not render authenticated data before the core response succeeds;
- failure continues to use the existing retryable product-style failure state.

The existing `ensureSection(active)` call remains data-gated and cannot run until an accepted core snapshot exists.

## Error and fallback behavior

- A failed marketing ticker request continues to show the current unavailable state; it cannot block the public document.
- A failed `/app` session probe leaves the public/login surface visible on Web and uses the existing connection surface for a token-bearing native session.
- An expired Web cookie or native token opens the existing login flow.
- A failed authenticated entry import retains the existing retry control and explanatory copy.
- JavaScript-disabled access to `/` still exposes the complete semantic marketing HTML rather than the old React-only `noscript` summary.

## Security boundaries

- CSP remains same-origin for application scripts.
- Removing Google Fonts allows `fonts.googleapis.com` and `fonts.gstatic.com` to be removed from the CSP allowlist.
- No token, password, MFA code, API key, permission, or trading state is added to URL parameters.
- The `auth` query parameter controls presentation only and is strictly allowlisted.
- Server authentication middleware and all write endpoints remain unchanged.

## Test strategy

Every production behavior change follows a red-green-refactor cycle.

### Contract tests

- The public build produces both `landing.html` and `index.html`.
- Built `landing.html` references hashed marketing assets and no React product entry.
- Built `index.html` and the iOS product entry contain no Google Fonts request.
- `GET /` returns marketing HTML; `GET /app` and `/app/*` return product HTML.
- HTML responses are `no-cache`; hashed marketing assets are immutable.
- Top-level marketing login/subscribe actions navigate to the allowlisted `/app` states.
- Iframe marketing actions continue to send the current same-origin message.
- Native startup without a token renders authentication without a core bootstrap request.
- Native startup with a token still performs authoritative bootstrap.
- Product-shell preload does not render or authorize authenticated content.

### Browser gates

- Public `/` at 1440×900, 1180×820, 430×932 and 390×844 has no horizontal overflow and retains the current To the Moon visual hierarchy.
- Login and subscription actions open the real current React modal on `/app` with keyboard focus, Escape close, and touch targets intact.
- A Web session and a native token session still reach the real authenticated shell.
- Browser request capture proves `/` requests no Google host, no product entry JavaScript, and no authenticated API.
- Native no-token capture proves zero `/api/bootstrap/core` requests before form submission.

### Performance gates

- Public initial HTML + hashed CSS + hashed JavaScript stays below 75 KiB gzip, excluding content images requested after HTML discovery.
- Product-entry budgets must not regress from the current isolated performance gate.
- The public document may request `/api/public/ticker-bar`; that request must not block first content rendering.

### Full verification

- Focused contract tests.
- Fresh isolated Vite performance build.
- Complete `npm test` suite.
- `npm run lint`.
- `npm run build`.
- Desktop and mobile browser gates.
- Capacitor sync followed by generated iOS HTML inspection.
- `git diff --check` and clean status review.

## Rollback

The change is reversible without data migration:

1. Restore the single `index.html` Vite input.
2. Restore the previous non-API catch-all to `index.html`.
3. Restore iframe-only public entry behavior.
4. Restore marketing assets to `public/`.

No database or server state must be rolled back because this design changes only document routing, static asset construction and client startup scheduling.

## Follow-up infrastructure batch

After this code batch is deployed and measured, a separate approved change should place immutable static assets on an audience-appropriate edge/CDN or move the origin closer to the primary users. That batch must measure TLS, transfer throughput, cache hit ratio, first contentful paint, largest contentful paint, and authenticated bootstrap latency before and after cutover. It must not be bundled into this code change.
