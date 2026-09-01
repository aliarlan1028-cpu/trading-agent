import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/landing.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/aug15-auth.css", import.meta.url), "utf8");
const entryCss = readFileSync(new URL("../src/entry.css", import.meta.url), "utf8");
const lifecycleRunner = readFileSync(new URL("./run-authenticated-shell-browser.mjs", import.meta.url), "utf8");

test("APP auth restores the August 15 Agent motion scene", () => {
  for (const contract of ["AuthMarketMotion", "nativeAuthMotion", "nativeAuthMotionTile", "nativeAuthAgentOrb", "AI AGENT"]) {
    assert.match(source, new RegExp(contract));
  }
  assert.doesNotMatch(source, /AuthSystemMap|nativeAuthNetwork/);
  assert.match(source, /import "\.\/aug15-auth\.css"/);
});

test("restored auth keeps current login, MFA, registration, consent, captcha, and server actions", () => {
  for (const contract of ["submitLogin", "submitRegister", "mfaRequired", "one-time-code", "TurnstileWidget", "acceptTerms", "acceptPrivacy", "acknowledgeRisk", "setApiBase", "connectionSecurityStatus"]) {
    assert.match(source, new RegExp(contract));
  }
  assert.match(source, /useDialogFocus/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
});

test("August 15 auth CSS preserves the animated card geometry and touch sizes", () => {
  assert.match(css, /\.nativeAuthScreen\{[^}]*#f6edde/i);
  assert.match(css, /\.nativeAuthCard\{[^}]*border-radius:48px/i);
  assert.match(css, /\.nativeAuthForm input[^}]*height:54px/i);
  assert.match(css, /\.nativeAuthPrimary\{[^}]*min-height:58px/i);
  assert.match(css, /@keyframes nativeAuthRail/);
  assert.match(css, /@keyframes nativeAuthOrb/);
  assert.match(css, /@keyframes nativeAuthOrbit/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

test("web marketing keeps the August 15 iframe and real authentication modal", () => {
  assert.match(source, /<iframe className="lpFrame" src="\/landing\.html"/);
  assert.match(css, /\.lpOverlay\{[^}]*rgba\(6,5,4,\.7\)/i);
  assert.match(css, /\.lpBtn\{[^}]*#ff7a2f/i);
  assert.match(source, /mfaStep/);
});

test("authenticated startup and connection gates remain on the current runtime contract", () => {
  assert.match(lifecycleRunner, /failCoreRequests/);
  assert.match(lifecycleRunner, /collectZeroBaseBootSurfaceViolations/);
});

test("public release notice remains isolated from authenticated product CSS", () => {
  assert.match(entryCss, /\.publicAppFrame \.releaseUpdateNotice/);
  assert.doesNotMatch(entryCss, /\.publicAppFrame \.releaseUpdateNotice\s*\{[^}]*backdrop-filter/i);
});
