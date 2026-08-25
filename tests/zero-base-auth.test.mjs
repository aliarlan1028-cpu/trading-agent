import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/landing.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/zero-base-auth.css", import.meta.url), "utf8");
const entryCss = readFileSync(new URL("../src/entry.css", import.meta.url), "utf8");
const lifecycleRunner = readFileSync(new URL("./run-authenticated-shell-browser.mjs", import.meta.url), "utf8");

test("APP auth is a new Web3 access portal, not the former floating market-card scene", () => {
  for (const contract of ["nativeAuthPortal", "nativeAuthStory", "nativeAuthNetwork", "nativeAuthCard"]) assert.match(source, new RegExp(contract));
  assert.doesNotMatch(source, /AuthMarketMotion|nativeAuthMotionTile/);
  for (const label of ["AI 交易员", "账户事实", "策略", "知识", "能力", "风险边界"]) assert.match(source, new RegExp(label));
});

test("auth preserves real login, registration, MFA, consent, captcha, and server actions", () => {
  for (const contract of ["submitLogin", "submitRegister", "mfaRequired", "one-time-code", "TurnstileWidget", "acceptTerms", "acceptPrivacy", "acknowledgeRisk", "setApiBase"]) assert.match(source, new RegExp(contract));
});

test("desktop and APP auth use the approved paper ink acid Web3 grammar", () => {
  assert.match(css, /\.nativeAuthScreen\s*\{[^}]*#F4F1E9/i);
  assert.match(css, /\.nativeAuthPortal\s*\{[^}]*grid-template-columns/i);
  assert.match(css, /\.nativeAuthStory\s*\{[^}]*#111311/i);
  assert.match(css, /\.nativeAuthPrimary\s*\{[^}]*#CCFF3D/i);
  assert.match(css, /@media\s*\(max-width:\s*760px\)[^{]*\{[\s\S]*?\.nativeAuthPortal\s*\{[^}]*grid-template-columns:\s*1fr/i);
  assert.match(css, /\.nativeAuthForm input[^}]*min-height:48px/i);
});

test("web marketing auth modal changes visual grammar without changing landing content", () => {
  assert.match(css, /\.lpOverlay\s*\{[^}]*rgba\(17,\s*19,\s*17/i);
  assert.match(css, /\.lpModal\s*\{[^}]*#F4F1E9/i);
  assert.match(css, /\.lpBtn\s*\{[^}]*#CCFF3D/i);
  assert.match(source, /<iframe className="lpFrame" src="\/landing\.html"/);
});

test("authenticated startup and connection gates use their zero-base loading boundaries", () => {
  assert.match(lifecycleRunner, /Public Sans, Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif/);
  assert.match(lifecycleRunner, /zero-base authenticated connection failure product font stack/);
  assert.doesNotMatch(lifecycleRunner, /startup loading prototype stack|connection failure prototype stack/);
  assert.match(lifecycleRunner, /failCoreRequests/);
  assert.match(lifecycleRunner, /data-zero-base-family=operations/);
  assert.doesNotMatch(lifecycleRunner, /workspace-rail.*nth-child\(5\)/);
  assert.match(lifecycleRunner, /data-zero-base-mobile-root-target=more/);
  assert.doesNotMatch(lifecycleRunner, /production MobileApp More drawer/);
  assert.match(lifecycleRunner, /collectZeroBaseBootSurfaceViolations/);
});

test("public release notice is styled by the zero-base entry instead of authenticated product CSS", () => {
  assert.match(entryCss, /\.publicAppFrame \.releaseUpdateNotice\s*\{[^}]*#F4F1E9/i);
  assert.match(entryCss, /\.publicAppFrame \.releaseUpdateNotice button\s*\{[^}]*#CCFF3D/i);
  assert.doesNotMatch(entryCss, /\.publicAppFrame \.releaseUpdateNotice\s*\{[^}]*backdrop-filter/i);
});
