import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync(new URL("../src/useDialogFocus.js", import.meta.url), "utf8");
const landing = readFileSync(new URL("../src/landing.jsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../src/zeroBaseShell.jsx", import.meta.url), "utf8");
const productShell = readFileSync(new URL("../src/productShell.jsx", import.meta.url), "utf8");
const browserHarness = readFileSync(new URL("./zero-base-shell-browser.jsx", import.meta.url), "utf8");
const browserRunner = readFileSync(new URL("./run-zero-base-shell-browser.mjs", import.meta.url), "utf8");

test("shared authenticated dialog contract traps focus, closes on Escape, and restores the trigger", () => {
  assert.match(hook, /event\.key === "Escape"/);
  assert.match(hook, /event\.key !== "Tab"/);
  assert.match(hook, /returnFocus/);
  assert.match(hook, /focus\(/);
});

test("marketing authentication is a labelled modal dialog using the shared keyboard contract", () => {
  assert.match(landing, /useDialogFocus/);
  assert.match(landing, /role="dialog"/);
  assert.match(landing, /aria-modal="true"/);
  assert.match(landing, /aria-labelledby="web-auth-title"/);
  assert.match(landing, /id="web-auth-title"/);
});

test("desktop Context and Trace drawers are closable labelled dialogs with trigger return", () => {
  assert.match(shell, /useDialogFocus/);
  assert.match(shell, /contextTriggerRef/);
  assert.match(shell, /traceTriggerRef/);
  assert.match(shell, /onClose=\{closeContext\}/);
  assert.match(shell, /onClose=\{closeTrace\}/);
  assert.match(productShell, /role="dialog"/);
  assert.match(productShell, /aria-modal="true"/);
  assert.match(productShell, /rootRef/);
});

test("desktop production-shell evidence mounts and exercises the real ordinary ConfirmHost", () => {
  assert.match(browserHarness, /<AppFrame authenticated>/);
  assert.match(browserHarness, /uiConfirm/);
  assert.match(browserHarness, /__openZeroBaseConfirm/);
  assert.match(browserRunner, /desktop-1180-confirm/);
  assert.match(browserRunner, /\.cfmCard--ordinary/);
  assert.match(browserRunner, /ordinary ConfirmHost Escape close and focus return/);
});
