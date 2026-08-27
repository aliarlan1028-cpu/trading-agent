import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const productionMobileHarness = readFileSync(new URL("./production-mobile-app-browser.jsx", import.meta.url), "utf8");
const performanceRunner = readFileSync(new URL("./run-zero-base-performance-build.mjs", import.meta.url), "utf8");

test("public and auth entry no longer statically download the authenticated product stylesheet", () => {
  assert.match(main, /import "\.\/entry\.css"/);
  assert.doesNotMatch(main, /import "\.\/styles\.css"|import "\.\/product-foundation\.css"|import "\.\/zero-base-system\.css"|import "\.\/zero-base-workbenches\.css"/);
  assert.match(main, /import\("\.\/productStyles\.js"\)/);
});

test("authenticated product styles remain one explicit lazy boundary", () => {
  const styles = readFileSync(new URL("../src/productStyles.js", import.meta.url), "utf8");
  const ordered = ["styles.css", "product-foundation.css", "workspace.css", "workspace-additions.css", "product-system.css", "conceptPages.css", "conceptSettings.css", "zero-base-mobile.css", "zero-base-system.css", "zero-base-workbenches.css"];
  for (const file of ordered) assert.match(styles, new RegExp(file.replace(".", "\\.")));
  const positions = ordered.map((file) => styles.indexOf(file));
  assert.deepEqual(positions, positions.slice().sort((a, b) => a - b), "legacy modules must load before the final zero-base cascade");

  for (const moduleName of ["workspacePages.jsx", "conceptPages.jsx", "zeroBaseMobile.jsx"]) {
    const moduleSource = readFileSync(new URL(`../src/${moduleName}`, import.meta.url), "utf8");
    assert.doesNotMatch(moduleSource, /import\s+["'][^"']+\.css["']/, `${moduleName} must not inject route-order CSS after zero-base overrides`);
  }
  assert.match(productionMobileHarness, /import "\.\.\/src\/productStyles\.js"/);
  assert.doesNotMatch(productionMobileHarness, /import "\.\.\/src\/(?:styles|product-foundation)\.css"/);
});

test("entry CSS owns only boot, public frame, and zero-base authentication", () => {
  const entry = readFileSync(new URL("../src/entry.css", import.meta.url), "utf8");
  assert.match(entry, /zero-base-auth\.css/);
  assert.match(entry, /\.authenticatedEntryLoading/);
  assert.match(entry, /\.lpRoot/);
  assert.doesNotMatch(entry, /\.zbShell|\.strategyWorkbench|\.mEventRiskRegistry/);
});

test("authenticated product-style loading can reach ready and retry without cancelling itself", () => {
  assert.match(main, /productStylesAttempt/);
  assert.match(main, /\[authRequired,\s*loading,\s*productStylesAttempt,\s*uiVersion\]/);
  assert.doesNotMatch(main, /\[authRequired,\s*loading,\s*productStylesState\]/);
  assert.match(main, /setProductStylesAttempt\(\(attempt\)\s*=>\s*attempt\s*\+\s*1\)/);
});

test("performance gate builds the current source into an isolated temporary output", () => {
  assert.match(performanceRunner, /import\s*\{\s*build\s*\}\s*from\s*["']vite["']/);
  assert.match(performanceRunner, /mkdtemp/);
  assert.doesNotMatch(performanceRunner, /path\.join\(root,\s*["']dist["']\)/);
  assert.match(performanceRunner, /outDir:\s*dist/);
  assert.match(performanceRunner, /emptyOutDir:\s*true/);
  assert.match(performanceRunner, /finally\s*\{[\s\S]*rm\(buildRoot/);
});
