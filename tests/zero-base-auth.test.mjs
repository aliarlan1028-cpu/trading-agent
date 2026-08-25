import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/landing.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("APP auth is a new Web3 access portal, not the former floating market-card scene", () => {
  for (const contract of ["nativeAuthPortal", "nativeAuthStory", "nativeAuthNetwork", "nativeAuthCard"]) assert.match(source, new RegExp(contract));
  assert.doesNotMatch(source, /AuthMarketMotion|nativeAuthMotionTile/);
  for (const label of ["AI 交易员", "账户事实", "策略", "知识", "能力", "风险边界"]) assert.match(source, new RegExp(label));
});

test("auth preserves real login, registration, MFA, consent, captcha, and server actions", () => {
  for (const contract of ["submitLogin", "submitRegister", "mfaRequired", "one-time-code", "TurnstileWidget", "acceptTerms", "acceptPrivacy", "acknowledgeRisk", "setApiBase"]) assert.match(source, new RegExp(contract));
});

test("desktop and APP auth use the approved paper ink acid Web3 grammar", () => {
  assert.match(css, /\.nativeAuthScreen\{[^}]*#F4F1E9/i);
  assert.match(css, /\.nativeAuthPortal\{[^}]*grid-template-columns/i);
  assert.match(css, /\.nativeAuthStory\{[^}]*#111311/i);
  assert.match(css, /\.nativeAuthPrimary\{[^}]*#CCFF3D/i);
  assert.match(css, /@media\(max-width:760px\)[^{]*\{[\s\S]*?\.nativeAuthPortal\{[^}]*grid-template-columns:1fr/i);
  assert.match(css, /\.nativeAuthForm input[^}]*min-height:48px/i);
});

test("web marketing auth modal changes visual grammar without changing landing content", () => {
  assert.match(css, /\.lpOverlay\{[^}]*rgba\(17,19,17/i);
  assert.match(css, /\.lpModal\{[^}]*#F4F1E9/i);
  assert.match(css, /\.lpBtn\{[^}]*#CCFF3D/i);
  assert.match(source, /<iframe className="lpFrame" src="\/landing\.html"/);
});
