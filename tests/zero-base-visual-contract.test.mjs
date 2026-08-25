import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cssUrl = new URL("../src/zero-base-system.css", import.meta.url);
const main = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const productStyles = readFileSync(new URL("../src/productStyles.js", import.meta.url), "utf8");

test("zero-base surfaces expose the approved palette", () => {
  const css = readFileSync(cssUrl, "utf8");
  for (const [token, value] of Object.entries({
    paper: "#F4F1E9",
    ink: "#111311",
    acid: "#CCFF3D",
    green: "#4FB78B",
    danger: "#E25645",
    amber: "#EFB44B",
    muted: "#697169"
  })) assert.match(css, new RegExp(`--zb-${token}:\\s*${value}`, "i"));
});

test("the new system owns scoped shell and workbench primitives", () => {
  const css = readFileSync(cssUrl, "utf8");
  for (const className of [
    "zeroBaseProduct", "zeroBaseAuth", "zbShell", "zbNavigation", "zbTopbar",
    "zbPage", "zbSubnav", "zbRegistry", "zbInspector", "zbTruth", "zbPanel",
    "zbState", "zbDrawer", "zbDialog", "zbAction"
  ]) assert.match(css, new RegExp(`\\.${className}\\b`), className);
  assert.doesNotMatch(css, /#[Aa]78[Bb][Ff][Aa]|#[Ff][Ff]7[Aa]32|backdrop-filter|filter:\s*blur|<canvas/i);
});

test("motion and touch behavior are bounded", () => {
  const css = readFileSync(cssUrl, "utf8");
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /safe-area-inset-bottom/);
});

test("zero-base CSS loads after the legacy foundation", () => {
  assert.match(main, /import\("\.\/productStyles\.js"\)/);
  const foundation = productStyles.indexOf('import "./product-foundation.css"');
  const zeroBase = productStyles.indexOf('import "./zero-base-system.css"');
  assert.ok(foundation >= 0);
  assert.ok(zeroBase > foundation);
});
