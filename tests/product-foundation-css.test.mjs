import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cssPath = fileURLToPath(new URL("../src/product-foundation.css", import.meta.url));

test("Kordyn product tokens match the immutable interactive prototype", () => {
  const css = fs.readFileSync(cssPath, "utf8");
  for (const [name, value] of Object.entries({
    paper: "#F4F1E9", "paper-2": "#EBE7DC", "paper-white": "#FFFDF7",
    ink: "#111311", "ink-2": "#2B302C", muted: "#77796F",
    dark: "#111511", "dark-2": "#1A1F1A", acid: "#CCFF3D",
    mint: "#4FB78B", danger: "#E25645", amber: "#EFB44B", blue: "#5D8EE8"
  })) assert.match(css, new RegExp(`--kordyn-${name}:\\s*${value}`, "i"));
  assert.match(css, /--kordyn-line:\s*rgba\(17,\s*19,\s*17,\s*\.22\)/i);
  assert.match(css, /--kordyn-orange:\s*var\(--kordyn-danger\)/i);
  assert.match(css, /--kordyn-violet:\s*var\(--kordyn-blue\)/i);
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
