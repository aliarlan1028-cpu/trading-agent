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

test("shared deep-surface primitives stay inside the approved operating-system material grammar", () => {
  const css = fs.readFileSync(cssPath, "utf8");
  for (const token of ["--kordyn-paper", "--kordyn-ink", "--kordyn-acid", "--kordyn-line"]) assert.match(css, new RegExp(token));
  for (const role of ["kTruthBand", "kWorkbench", "kRegistry", "kInspector", "kEvidenceLedger", "kActionBar", "kFilterRail", "kFormSurface", "kEmptyState", "kStateRow"]) assert.match(css, new RegExp(`\\.${role}\\b`));

  const primitiveStart = css.indexOf("/* Shared deep-surface primitives */");
  assert.notEqual(primitiveStart, -1, "shared primitives need an explicit, auditable boundary");
  const primitives = css.slice(primitiveStart);
  assert.doesNotMatch(primitives, /linear-gradient|backdrop-filter|box-shadow\s*:/);
  assert.doesNotMatch(primitives, /#[0-9a-f]{3,8}\b/i, "shared primitives must compose state surfaces from Kordyn tokens instead of raw color literals");
  assert.match(primitives, /\.kEmptyState b,\n\.kordynSystem \.kEmptyState p \{ min-width: 0; overflow-wrap: anywhere;/);
});
