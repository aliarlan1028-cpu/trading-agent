import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const productionMobileHarness = readFileSync(new URL("./production-mobile-app-browser.jsx", import.meta.url), "utf8");
const performanceRunner = readFileSync(new URL("./run-zero-base-performance-build.mjs", import.meta.url), "utf8");

test("public and auth entry no longer statically download the authenticated product stylesheet", () => {
  assert.match(main, /import "\.\/entry\.css"/);
  assert.doesNotMatch(main, /import "\.\/styles\.css"|import "\.\/product-foundation\.css"|import "\.\/zero-base-system\.css"|import "\.\/zero-base-workbenches\.css"/);
  assert.match(main, /import\("\.\/aug15\/App\.jsx"\)/);
});

test("authenticated product styles remain one explicit lazy boundary", () => {
  const styles = readFileSync(new URL("../src/classicStyles.js", import.meta.url), "utf8");
  const ordered = ["styles.css", "product-foundation.css", "workspace.css", "workspace-additions.css", "conceptPages.css", "conceptSettings.css", "classic-shell.css"];
  for (const file of ordered) assert.match(styles, new RegExp(file.replace(".", "\\.")));
  const positions = ordered.map((file) => styles.indexOf(file));
  assert.deepEqual(positions, positions.slice().sort((a, b) => a - b), "classic foundation modules must load before the final classic bridge");

  for (const moduleName of ["workspacePages.jsx", "conceptPages.jsx", "zeroBaseMobile.jsx"]) {
    const moduleSource = readFileSync(new URL(`../src/${moduleName}`, import.meta.url), "utf8");
    assert.doesNotMatch(moduleSource, /import\s+["'][^"']+\.css["']/, `${moduleName} must not inject route-order CSS after zero-base overrides`);
  }
  assert.match(productionMobileHarness, /import "\.\.\/src\/productStyles\.js"/);
  assert.doesNotMatch(productionMobileHarness, /import "\.\.\/src\/(?:styles|product-foundation)\.css"/);
});

test("entry CSS owns boot and public frame while August 15 auth stays route-scoped", () => {
  const entry = readFileSync(new URL("../src/entry.css", import.meta.url), "utf8");
  const landing = readFileSync(new URL("../src/landing.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(entry, /zero-base-auth\.css/);
  assert.match(landing, /import "\.\/aug15-auth\.css"/);
  assert.match(entry, /\.authenticatedEntryLoading/);
  assert.match(entry, /\.lpRoot/);
  assert.doesNotMatch(entry, /\.zbShell|\.strategyWorkbench|\.mEventRiskRegistry/);
});

test("authenticated product-style loading reaches ready without depending on its own state", () => {
  assert.match(main, /\[authRequired,\s*loading,\s*uiVersion\]/);
  assert.doesNotMatch(main, /\[authRequired,\s*loading,\s*productStylesState\]/);
  assert.match(main, /export function loadAugust15AuthenticatedEntry/);
  assert.match(main, /const August15AuthenticatedShell = lazyNamed\(loadAugust15AuthenticatedEntry, "August15AuthenticatedShell"\)/);
  assert.match(main, /loadAugust15AuthenticatedEntry\(\)\n\s*\.then/);
  assert.match(main, /function retryAugust15AuthenticatedResources\(\)[\s\S]*window\.location\.reload\(\)/);
});

test("performance gate builds the current source into an isolated temporary output", () => {
  assert.match(performanceRunner, /import\s*\{\s*build\s*\}\s*from\s*["']vite["']/);
  assert.match(performanceRunner, /mkdtemp/);
  assert.doesNotMatch(performanceRunner, /path\.join\(root,\s*["']dist["']\)/);
  assert.match(performanceRunner, /outDir:\s*dist/);
  assert.match(performanceRunner, /emptyOutDir:\s*true/);
  assert.match(performanceRunner, /finally\s*\{[\s\S]*rm\(buildRoot/);
});
