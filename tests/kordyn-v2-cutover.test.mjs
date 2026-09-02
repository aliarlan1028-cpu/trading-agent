import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_KORDYN_UI_VERSION, resolveKordynUiVersion } from "../src/kordynV2/cutover.js";

test("production cutover is build-configured and preview override is fail closed", () => {
  assert.equal(DEFAULT_KORDYN_UI_VERSION, "legacy");
  assert.equal(resolveKordynUiVersion({ PROD: true, VITE_KORDYN_UI_VERSION: "v2" }, null), "v2");
  assert.equal(resolveKordynUiVersion({ PROD: true, VITE_KORDYN_UI_VERSION: "legacy" }, { getItem: () => "v2" }), "legacy");
  assert.equal(resolveKordynUiVersion({ DEV: true }, { getItem: () => "v2" }), "v2");
  assert.equal(resolveKordynUiVersion({ PROD: true, VITE_KORDYN_UI_VERSION: "garbage" }, null), "legacy");
});

test("inaccessible global preview storage fails closed", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get() { throw new Error("storage getter denied"); }
  });
  try {
    assert.equal(resolveKordynUiVersion({ PROD: true, VITE_KORDYN_UI_VERSION: "v2" }), "v2");
    assert.equal(resolveKordynUiVersion({ DEV: true }), "legacy");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "sessionStorage", descriptor);
    else delete globalThis.sessionStorage;
  }
});

test("throwing preview reads retain the configured fail-closed version", () => {
  const storage = { getItem() { throw new Error("storage read denied"); } };
  assert.equal(resolveKordynUiVersion({ DEV: true }, storage), "legacy");
  assert.equal(resolveKordynUiVersion({ DEV: true, VITE_KORDYN_UI_VERSION: "v2" }, storage), "v2");
});

test("V2 and classic legacy authenticated styles are mutually exclusive", () => {
  const main = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const entry = readFileSync(new URL("../src/kordynV2/entry.jsx", import.meta.url), "utf8");
  const august15 = readFileSync(new URL("../src/aug15/App.jsx", import.meta.url), "utf8");
  const august15Styles = readFileSync(new URL("../src/aug15/productStyles.js", import.meta.url), "utf8");
  assert.match(main, /resolveKordynUiVersion/);
  assert.match(main, /useRef\(resolveKordynUiVersion\(import\.meta\.env\)\)/);
  assert.match(main, /import\("\.\/kordynV2\/entry\.jsx"\)/);
  assert.match(main, /import\("\.\/aug15\/App\.jsx"\)/);
  assert.match(main, /\[authRequired,\s*loading,\s*productStylesAttempt,\s*uiVersion\]/);
  assert.match(entry, /styles\/tokens\.css/);
  assert.match(entry, /styles\/shell\.css/);
  assert.doesNotMatch(entry, /productStyles|styles\.css|zero-base|product-foundation/);
  assert.doesNotMatch(august15, /import "\.\/styles\.css"/);
  assert.match(august15Styles, /import stylesheetUrl from "\.\/styles\.css\?url"/);
  assert.doesNotMatch(august15, /productStyles|product-system|zero-base|kordynV2/);
});
