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

test("V2 and legacy authenticated styles are mutually exclusive", () => {
  const main = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  const entry = readFileSync(new URL("../src/kordynV2/entry.jsx", import.meta.url), "utf8");
  assert.match(main, /resolveKordynUiVersion/);
  assert.match(main, /import\("\.\/kordynV2\/entry\.jsx"\)/);
  assert.match(main, /import\("\.\/productStyles\.js"\)/);
  assert.match(entry, /styles\/tokens\.css/);
  assert.match(entry, /styles\/shell\.css/);
  assert.doesNotMatch(entry, /productStyles|styles\.css|zero-base|product-foundation/);
});
