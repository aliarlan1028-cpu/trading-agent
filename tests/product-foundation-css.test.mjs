import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cssPath = fileURLToPath(new URL("../src/product-foundation.css", import.meta.url));

test("Kordyn product tokens match the approved editorial operating system", () => {
  const css = fs.readFileSync(cssPath, "utf8");
  for (const [name, value] of Object.entries({
    paper: "#F3F0E7", "paper-white": "#FFFDF7", ink: "#151915", acid: "#CCFF3D",
    orange: "#FF6B35", blue: "#91ACFF", violet: "#C5A2FF", line: "#B8BBB2"
  })) assert.match(css, new RegExp(`--kordyn-${name}:\\s*${value}`, "i"));
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /min-height:\s*48px/);
  assert.match(css, /font-size:\s*max\(16px, 1em\)/);
});
