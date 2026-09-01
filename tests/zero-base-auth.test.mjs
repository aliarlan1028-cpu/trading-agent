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

test("web marketing keeps its iframe and moves the real authentication modal into the warm entry family", () => {
  assert.match(source, /<iframe className="lpFrame" src="\/landing\.html"/);
  assert.match(css, /\.lpModal\{[^}]*#fffdf9/i);
  assert.match(css, /\.lpBtn\{[^}]*#ff7a2f/i);
  const webAuthCss = css.split(".lpRoot")[1] || "";
  assert.doesNotMatch(webAuthCss, /#15110c|#100d0a|#17120c|#CCFF3D|#4FB78B/i);
  assert.match(source, /mfaStep/);
});

test("authenticated startup and connection gates remain on the current runtime contract", () => {
  assert.match(lifecycleRunner, /failCoreRequests/);
  assert.match(lifecycleRunner, /collectAugust15EntrySurfaceViolations/);
});

test("entry lifecycle surfaces use the August 15 warm visual language", () => {
  for (const value of ["#f6edde", "#fffdf9", "#e7782f", "#171512"]) {
    assert.match(entryCss, new RegExp(value, "i"));
  }
  assert.doesNotMatch(entryCss, /#CCFF3D|#4FB78B|#111311/i);
  assert.match(entryCss, /\.authenticatedEntryLoading/);
  assert.match(entryCss, /\.authenticatedStateScreen/);
  assert.match(entryCss, /\.loginPanel \.primaryButton/);
});

test("public release notice remains isolated and shares the warm entry language", () => {
  assert.match(entryCss, /\.publicAppFrame \.releaseUpdateNotice/);
  assert.match(entryCss, /\.publicAppFrame \.releaseUpdateNotice\s*\{[^}]*#fffdf9/i);
});
