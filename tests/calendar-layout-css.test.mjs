import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cssPath = fileURLToPath(new URL("../src/conceptPages.css", import.meta.url));
const css = fs.readFileSync(cssPath, "utf8");

test("web event calendar keeps all seven columns when event titles are long", () => {
  assert.match(css, /\.cp2Calendar \.week,\.cp2Calendar \.days\{grid-template-columns:repeat\(7,minmax\(0,1fr\)\)\}/);
  assert.match(css, /\.cp2Calendar \.week b,\.cp2Calendar \.days>div,\.cp2Calendar \.days button\{min-width:0\}/);
  assert.match(css, /\.cp2Calendar \.days>div\{overflow:hidden\}/);
});
