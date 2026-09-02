# Cold-start Performance Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the avoidable cold-start waterfall from the public Web entry and native login while preserving every current product, authentication, permission, trading and risk behavior.

**Architecture:** Build the To the Moon page as a first-class Vite HTML entry served directly at `/`, keep the React product at `/app`, and share the existing React authentication modal through an allowlisted presentation intent. A small static-delivery module owns document routing, CSP and cache behavior; native bootstrap policy and authenticated-shell preloading stay separate from authentication authority.

**Tech Stack:** React 18, Vite 5, Express 4, Capacitor 6, Node test runner, Chrome DevTools Protocol

**Spec:** `docs/superpowers/specs/2026-09-02-cold-start-performance-design.md`

## Global Constraints

- Do not change API payloads, database schema, authentication authority, permissions, trading, execution, risk, approval, recovery, or state semantics.
- Preserve the current To the Moon content and visual design, Web login/subscription modal, APP login page and authenticated workspace visuals.
- Do not add a remote font provider or a new production dependency.
- No production deployment, DNS, CDN or origin migration belongs to this plan.
- Tokens, passwords, MFA codes and credentials must never appear in URL parameters.
- Every production behavior change must be preceded by a test that fails for the intended reason.
- Run focused tests after every task and the full quality gate before completion.

## File structure

- `landing.html` — public Vite HTML entry containing the existing marketing markup.
- `src/marketing/landing.css` — existing To the Moon visual implementation, built to a hashed asset.
- `src/marketing/landing.js` — existing marketing interaction runtime, built to a hashed asset.
- `src/marketing/authIntent.js` — allowlisted top-level/iframe authentication intent helpers shared by tests and production.
- `src/sessionBootstrap.js` — pure native/Web initial-auth and mount-bootstrap policy.
- `server/staticDelivery.mjs` — static document selection, CSP, cache policy and Express route installation.
- `tests/cold-start-build.test.mjs` — isolated Vite output and gzip-budget contract.
- `tests/static-delivery.test.mjs` — real route-handler and response-policy contract.
- `tests/marketing-auth-intent.test.mjs` — top-level navigation, iframe messaging and query parsing contract.
- `tests/run-cold-start-performance-browser.mjs` — production-shaped built-asset browser gate.

---

### Task 1: Native session bootstrap fails fast to login

**Files:**
- Create: `src/sessionBootstrap.js`
- Modify: `src/lib.jsx:814-824,1234-1241`
- Modify: `tests/use-api-request-identity.test.mjs`
- Test: `tests/session-bootstrap.test.mjs`

**Interfaces:**
- Produces: `initialAuthRequired({ native, token }): boolean`
- Produces: `shouldBootstrapCoreOnMount({ native, token }): boolean`
- Consumed by: `useApi()` initial state and its mount effect

- [ ] **Step 1: Write the failing policy tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { initialAuthRequired, shouldBootstrapCoreOnMount } from "../src/sessionBootstrap.js";

test("native without a token opens login and skips core bootstrap", () => {
  assert.equal(initialAuthRequired({ native: true, token: "" }), true);
  assert.equal(shouldBootstrapCoreOnMount({ native: true, token: "" }), false);
});

test("native token and Web cookie discovery remain server-authoritative", () => {
  assert.equal(initialAuthRequired({ native: true, token: "token-present" }), false);
  assert.equal(shouldBootstrapCoreOnMount({ native: true, token: "token-present" }), true);
  assert.equal(initialAuthRequired({ native: false, token: "" }), true);
  assert.equal(shouldBootstrapCoreOnMount({ native: false, token: "" }), true);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm test -- tests/session-bootstrap.test.mjs`

Expected: FAIL because `src/sessionBootstrap.js` does not exist.

- [ ] **Step 3: Implement the two pure policy functions**

```js
export function initialAuthRequired({ native, token }) {
  return native ? !String(token || "").trim() : true;
}

export function shouldBootstrapCoreOnMount({ native, token }) {
  return native ? Boolean(String(token || "").trim()) : true;
}
```

- [ ] **Step 4: Wire the policy into `useApi`**

Initialize `token` once, initialize `authRequired` through `initialAuthRequired`, and replace the unconditional mount `refresh()` with:

```js
if (shouldBootstrapCoreOnMount({ native: isNativeApp(), token: tokenRef.current })) refresh();
```

Keep `refreshPublicInfo()`, visibility recovery, successful login bootstrap and expired-session behavior unchanged.

- [ ] **Step 5: Add a hook regression assertion**

Extend `tests/use-api-request-identity.test.mjs` with a native/no-token harness assertion that returns `authRequired === true`. The browser task later proves that the effect path makes zero core requests.

- [ ] **Step 6: Run GREEN and related regressions**

Run: `npm test -- tests/session-bootstrap.test.mjs tests/use-api-request-identity.test.mjs tests/zero-base-auth.test.mjs`

Expected: all tests PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/sessionBootstrap.js src/lib.jsx tests/session-bootstrap.test.mjs tests/use-api-request-identity.test.mjs
git commit -m "fix: skip native bootstrap without a session"
```

---

### Task 2: Build marketing as an independent hashed Vite entry

**Files:**
- Move: `public/landing.html` → `landing.html`
- Move: `public/landing.css` → `src/marketing/landing.css`
- Move: `public/landing.js` → `src/marketing/landing.js`
- Modify: `landing.html` stylesheet/script references only
- Modify: `vite.config.js`
- Modify: `tests/landing-copy.test.mjs`
- Modify: `tests/landing-palette.test.mjs`
- Modify: `tests/prototype-visual-contract.test.mjs`
- Modify: `tests/render-smoke.test.mjs`
- Create: `tests/cold-start-build.test.mjs`

**Interfaces:**
- Produces: built `dist/landing.html` and built `dist/index.html`
- Produces: content-hashed marketing CSS and JavaScript below `dist/assets/`
- Consumed by: Task 3 static delivery and Task 7 browser gate

- [ ] **Step 1: Write a failing isolated build contract**

Build into a temporary directory with Vite, read both HTML files and the manifest, and assert literal outcomes:

```js
assert.match(marketingHtml, /TO THE/);
assert.doesNotMatch(marketingHtml, /src\/main\.jsx|index-[^"']+\.js/);
assert.match(marketingHtml, /\/assets\/landing-[^"']+\.js/);
assert.match(marketingHtml, /\/assets\/landing-[^"']+\.css/);
assert.match(productHtml, /\/assets\/index-[^"']+\.js/);
```

Read the referenced files, gzip them with `gzipSync`, and assert marketing HTML + CSS + JS is below `75 * 1024` bytes gzip.

- [ ] **Step 2: Run the build contract and verify RED**

Run: `npm test -- tests/cold-start-build.test.mjs`

Expected: FAIL because the current build has no independent Vite `landing.html` entry and the current CSS/JS are unhashed public files.

- [ ] **Step 3: Move the three marketing sources without changing content**

Run:

```bash
mkdir -p src/marketing
mv public/landing.html landing.html
mv public/landing.css src/marketing/landing.css
mv public/landing.js src/marketing/landing.js
```

Change only these two references in `landing.html`:

```html
<link rel="stylesheet" href="/src/marketing/landing.css">
<script type="module" src="/src/marketing/landing.js"></script>
```

- [ ] **Step 4: Configure the two HTML inputs**

Add `node:path` and `fileURLToPath` imports to `vite.config.js`; configure:

```js
build: {
  rollupOptions: {
    input: {
      app: path.resolve(root, "index.html"),
      landing: path.resolve(root, "landing.html")
    }
  }
}
```

Keep the current React plugin, development proxy and port behavior unchanged.

- [ ] **Step 5: Update tests to read the new source locations**

Replace only file URLs/path joins for `landing.html`, `src/marketing/landing.css`, and `src/marketing/landing.js`. Do not weaken content, count, palette, accessibility or visual assertions.

- [ ] **Step 6: Run GREEN and existing marketing contracts**

Run: `npm test -- tests/cold-start-build.test.mjs tests/landing-copy.test.mjs tests/landing-palette.test.mjs tests/prototype-visual-contract.test.mjs tests/render-smoke.test.mjs`

Expected: all tests PASS and the isolated build deletes its temporary directory.

- [ ] **Step 7: Commit Task 2**

```bash
git add landing.html src/marketing vite.config.js tests/cold-start-build.test.mjs tests/landing-copy.test.mjs tests/landing-palette.test.mjs tests/prototype-visual-contract.test.mjs tests/render-smoke.test.mjs public/landing.html public/landing.css public/landing.js
git commit -m "perf: build marketing as a hashed entry"
```

---

### Task 3: Serve marketing at `/` and product at `/app`

**Files:**
- Create: `server/staticDelivery.mjs`
- Modify: `server/index.mjs:475-510`
- Test: `tests/static-delivery.test.mjs`

**Interfaces:**
- Produces: `staticDocumentForPath(pathname): "landing.html" | "index.html"`
- Produces: `cacheControlForStatic(filePath): string`
- Produces: `staticContentSecurityPolicy(): string`
- Produces: `installStaticDelivery(app, { publicDir }): void`
- Consumed by: production Express application and Task 7 fixture server

- [ ] **Step 1: Write failing delivery-policy tests**

```js
assert.equal(staticDocumentForPath("/"), "landing.html");
assert.equal(staticDocumentForPath("/landing.html"), "landing.html");
assert.equal(staticDocumentForPath("/app"), "index.html");
assert.equal(staticDocumentForPath("/app/settings"), "index.html");
assert.equal(cacheControlForStatic("/dist/assets/landing-abc.css"), "public, max-age=31536000, immutable");
assert.equal(cacheControlForStatic("/dist/landing.html"), "no-cache");
assert.doesNotMatch(staticContentSecurityPolicy(), /fonts\.googleapis|fonts\.gstatic/);
```

Use a small real Express app with temporary `index.html` and `landing.html` fixtures, call `installStaticDelivery`, listen on `127.0.0.1:0`, and assert `fetch("/")` returns `LANDING` while `fetch("/app")` returns `PRODUCT`.

- [ ] **Step 2: Run the delivery tests and verify RED**

Run: `npm test -- tests/static-delivery.test.mjs`

Expected: FAIL because `server/staticDelivery.mjs` does not exist.

- [ ] **Step 3: Implement the static-delivery module**

Implement exact routing rules:

```js
export function staticDocumentForPath(pathname) {
  if (pathname === "/" || pathname === "/landing.html") return "landing.html";
  if (pathname === "/app" || pathname === "/app/" || pathname.startsWith("/app/")) return "index.html";
  return "landing.html";
}
```

`installStaticDelivery` must use `express.static(publicDir, { index: false, setHeaders })`, register the public and `/app` document routes, set HTML to `no-cache`, and preserve error forwarding from `sendFile`.

- [ ] **Step 4: Replace the inline production static middleware**

Import the module from `server/index.mjs`. Replace the current Google-enabled CSP string with `staticContentSecurityPolicy()` and replace the current `express.static` plus non-API catch-all with `installStaticDelivery(app, { publicDir })`. Keep transport security before static delivery and keep `/api` routes excluded.

- [ ] **Step 5: Run GREEN and transport regressions**

Run: `npm test -- tests/static-delivery.test.mjs tests/transport-security.test.mjs tests/deploy-sync-scope.test.mjs`

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add server/staticDelivery.mjs server/index.mjs tests/static-delivery.test.mjs
git commit -m "perf: split public and product documents"
```

---

### Task 4: Preserve real login and subscription behavior across the route split

**Files:**
- Create: `src/marketing/authIntent.js`
- Modify: `src/marketing/landing.js:630-648`
- Modify: `src/landing.jsx:139-177`
- Modify: `tests/zero-base-auth.test.mjs`
- Test: `tests/marketing-auth-intent.test.mjs`

**Interfaces:**
- Produces: `normalizeAuthMode(value): "login" | "subscribe" | ""`
- Produces: `authIntentFromSearch(search): "login" | "subscribe" | ""`
- Produces: `dispatchMarketingAuth({ mode, topLevel, origin, navigate, postMessage }): void`
- Consumed by: marketing click handler and React `WebLandingPage`

- [ ] **Step 1: Write failing intent tests**

```js
assert.equal(authIntentFromSearch("?auth=login"), "login");
assert.equal(authIntentFromSearch("?auth=subscribe"), "subscribe");
assert.equal(authIntentFromSearch("?auth=token-value"), "");

dispatchMarketingAuth({ mode: "login", topLevel: true, origin: "https://app.example", navigate, postMessage });
assert.deepEqual(navigations, ["/app?auth=login"]);
assert.equal(messages.length, 0);

dispatchMarketingAuth({ mode: "subscribe", topLevel: false, origin: "https://app.example", navigate, postMessage });
assert.deepEqual(messages, [{ payload: { type: "lp-start", mode: "subscribe" }, origin: "https://app.example" }]);
```

- [ ] **Step 2: Run the intent tests and verify RED**

Run: `npm test -- tests/marketing-auth-intent.test.mjs`

Expected: FAIL because `src/marketing/authIntent.js` does not exist.

- [ ] **Step 3: Implement the allowlisted helper and use it in marketing**

Top-level navigation must assign only `/app?auth=login` or `/app?auth=subscribe`. Iframe mode must keep the existing same-origin message. Unknown modes must perform neither action.

- [ ] **Step 4: Initialize the React modal from the one-shot query**

In `WebLandingPage`, derive the initial intent from `window.location.search`, initialize `authOpen` and `mode` from that value, then remove only the `auth` parameter through `history.replaceState` after it has been consumed. Preserve unrelated query parameters and the hash.

- [ ] **Step 5: Replace obsolete iframe-only source assertions**

Update `tests/zero-base-auth.test.mjs` to assert that the real form remains in React, the iframe remains available as `/app` background, and `authIntentFromSearch` controls only presentation. Do not remove MFA, captcha, consent, dialog labeling, focus trap or Escape assertions.

- [ ] **Step 6: Run GREEN and auth regressions**

Run: `npm test -- tests/marketing-auth-intent.test.mjs tests/zero-base-auth.test.mjs tests/use-api-request-identity.test.mjs`

Expected: all tests PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/marketing/authIntent.js src/marketing/landing.js src/landing.jsx tests/marketing-auth-intent.test.mjs tests/zero-base-auth.test.mjs
git commit -m "feat: preserve auth flows on the app route"
```

---

### Task 5: Remove external font blocking from Web and iOS

**Files:**
- Modify: `index.html:63-65`
- Modify: `tests/cold-start-build.test.mjs`
- Modify generated: `ios/App/App/public/**` through `npm run ios:sync`
- Test: `tests/font-delivery.test.mjs`

**Interfaces:**
- Produces: Web and generated iOS HTML with zero Google Fonts hosts
- Consumed by: public/product browser documents and Capacitor WebView

- [ ] **Step 1: Write the failing source/build/iOS font test**

Read `index.html`, the isolated built `index.html`, and `ios/App/App/public/index.html`; assert each does not match `/fonts\.(?:googleapis|gstatic)\.com/`. Also assert the key CSS files retain a generic `sans-serif` or `monospace` fallback so text remains renderable without optional installed fonts.

- [ ] **Step 2: Run the font test and verify RED**

Run: `npm test -- tests/font-delivery.test.mjs`

Expected: FAIL on the three Google Fonts elements in product `index.html` and generated iOS HTML.

- [ ] **Step 3: Remove the remote font elements**

Delete only the two preconnect elements and the Google Fonts stylesheet element. Do not change approved visual tokens, font weights, line heights or component geometry.

- [ ] **Step 4: Rebuild and synchronize Capacitor**

Run: `npm run ios:sync`

Confirm the generated product HTML has no Google host and that Capacitor reports a successful copy/sync.

- [ ] **Step 5: Run GREEN and build contracts**

Run: `npm test -- tests/font-delivery.test.mjs tests/cold-start-build.test.mjs tests/landing-palette.test.mjs`

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add index.html ios/App/App/public tests/font-delivery.test.mjs tests/cold-start-build.test.mjs
git commit -m "perf: remove remote font startup blocking"
```

---

### Task 6: Preload the authenticated shell without weakening authorization

**Files:**
- Modify: `src/main.jsx:24-45,363-371`
- Modify: `tests/zero-base-performance.test.mjs`
- Test: `tests/authenticated-entry-preload.test.mjs`

**Interfaces:**
- Produces: `loadAugust15AuthenticatedEntry(): Promise<Module>` with one shared in-flight promise
- Consumed by: React lazy component and `/app` preload effect

- [ ] **Step 1: Write the failing preload contract**

Bundle a small export harness for `loadAugust15AuthenticatedEntry`, call it twice with an injected importer, and assert the importer runs once and both calls return the same promise. Add a source behavior assertion that shell loading is not gated by `loading === false`, while render branches remain gated by `authRequired`, `loading` and accepted `data`.

- [ ] **Step 2: Run the preload tests and verify RED**

Run: `npm test -- tests/authenticated-entry-preload.test.mjs tests/zero-base-performance.test.mjs`

Expected: FAIL because the existing lazy loader and preload import do not share an exported promise and the effect still waits for `loading`.

- [ ] **Step 3: Implement one shared loader**

```js
let august15EntryPromise;
export function loadAugust15AuthenticatedEntry(importer = () => import("./aug15/App.jsx")) {
  august15EntryPromise ||= importer();
  return august15EntryPromise;
}
```

Use this loader for both `August15AuthenticatedShell` and the product-style preload effect. On `/app`/native, start it when `uiVersion === "legacy"` and state is idle; do not render the module until the current authentication/data branches permit it.

- [ ] **Step 4: Preserve retry semantics**

On a rejected import, clear the shared promise before setting `productStylesState="failed"`; the existing retry button increments `productStylesAttempt` and starts a new import. Do not alter failure copy or focus behavior.

- [ ] **Step 5: Run GREEN and authenticated lifecycle regressions**

Run: `npm test -- tests/authenticated-entry-preload.test.mjs tests/zero-base-performance.test.mjs tests/kordyn-v2-cutover.test.mjs tests/zero-base-auth.test.mjs`

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/main.jsx tests/authenticated-entry-preload.test.mjs tests/zero-base-performance.test.mjs
git commit -m "perf: preload the authenticated product shell"
```

---

### Task 7: Add a production-shaped cold-start browser gate

**Files:**
- Create: `tests/run-cold-start-performance-browser.mjs`
- Update: `docs/superpowers/specs/2026-09-02-cold-start-performance-design.md` status to implemented after all gates pass

**Interfaces:**
- Consumes: built two-entry output, `installStaticDelivery`, real React application, real marketing document
- Produces: machine-readable cold-start request, overflow, modal and native-bootstrap evidence

- [ ] **Step 1: Write the browser runner assertions before satisfying them**

The runner must:

1. create a temporary Vite production build;
2. start a small Express server with production-shaped public API fixtures and the real `installStaticDelivery`;
3. launch Chrome at 1440×900, 1180×820, 430×932 and 390×844;
4. capture every request host/path;
5. assert `/` renders `TO THE MOON`, has zero horizontal overflow, requests no Google host, no product entry chunk and no `/api/bootstrap/core`;
6. click login and subscribe in separate runs, assert navigation to `/app`, the real labelled React modal, visible keyboard focus, Escape close and no overflow;
7. run a Capacitor-stubbed no-token product entry and assert the APP login page appears with zero core bootstrap requests;
8. delay a valid `/app` core fixture and assert the August 15 entry asset request begins before the core response completes;
9. print one JSON summary and exit nonzero on any failed assertion.

- [ ] **Step 2: Run the runner and verify RED**

Run: `node tests/run-cold-start-performance-browser.mjs`

Expected: FAIL until Tasks 1–6 are complete; record the first real contract failure rather than bypassing it.

- [ ] **Step 3: Make only runner/fixture corrections required to exercise production code**

The fixture may supply production-shaped read responses but must mount the real marketing document, real `App`, real `NativeAuthPage`, real authentication modal and real static-delivery module. It may not replace those components with isolated lookalikes.

- [ ] **Step 4: Run the browser gate at all four viewports**

Run: `node tests/run-cold-start-performance-browser.mjs`

Expected: PASS with request counts, asset names, gzip bytes, modal results, native core request count `0`, and overflow `0` for all viewports.

- [ ] **Step 5: Run existing visual and lifecycle gates**

Run:

```bash
node tests/run-zero-base-auth-browser.mjs
node tests/run-authenticated-shell-browser.mjs
node tests/run-zero-base-performance-build.mjs
```

Expected: all three PASS. If a runner needs its documented backend/Vite prerequisite, start exactly that prerequisite and record it; do not replace the production component path with a static mock.

- [ ] **Step 6: Commit Task 7**

```bash
git add tests/run-cold-start-performance-browser.mjs docs/superpowers/specs/2026-09-02-cold-start-performance-design.md
git commit -m "test: verify cold-start delivery in real browsers"
```

---

### Task 8: Final verification and handoff

**Files:**
- Modify only if a verified failure identifies a production defect covered by this specification

**Interfaces:**
- Consumes: all preceding commits
- Produces: final evidence-backed verdict; no deployment

- [ ] **Step 1: Run focused cold-start contracts fresh**

```bash
npm test -- tests/session-bootstrap.test.mjs tests/use-api-request-identity.test.mjs tests/cold-start-build.test.mjs tests/static-delivery.test.mjs tests/marketing-auth-intent.test.mjs tests/font-delivery.test.mjs tests/authenticated-entry-preload.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run the complete suite**

Run: `npm test`

Expected: at least the 2223 baseline tests plus the new tests, zero failures.

- [ ] **Step 3: Run lint and production build**

```bash
npm run lint
npm run build
```

Expected: both exit 0; `dist/landing.html` and `dist/index.html` exist.

- [ ] **Step 4: Run browser and iOS gates fresh**

```bash
node tests/run-cold-start-performance-browser.mjs
node tests/run-zero-base-auth-browser.mjs
node tests/run-authenticated-shell-browser.mjs
npm run ios:sync
```

Expected: browser gates PASS; Capacitor sync exits 0; generated iOS HTML has no Google host.

- [ ] **Step 5: Inspect the final diff and repository state**

```bash
git diff --check
git status --short
git log --oneline 84a19fd..HEAD
```

Expected: no whitespace errors; only intentional generated or evidence files remain; no production secrets or runtime data appear in the diff.

- [ ] **Step 6: Report without deploying**

Report commit hashes, exact test counts, build asset/gzip sizes, browser request evidence, APP zero-core result, known infrastructure follow-up and worktree path. Do not claim CDN or production latency improvement until a separately approved deployment and measurement occurs.
