import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shell = readFileSync(new URL("../src/zeroBaseShell.jsx", import.meta.url), "utf8");
const workspaces = readFileSync(new URL("../src/workspacePages.jsx", import.meta.url), "utf8");
const concepts = readFileSync(new URL("../src/conceptPages.jsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/zero-base-workbenches.css", import.meta.url), "utf8");

test("every desktop workbench is scoped by the active zero-base family and view", () => {
  assert.match(shell, /className="zbWorkbench"/);
  assert.match(shell, /data-zero-base-workbench=\{activeFamily\.id\}/);
  assert.match(shell, /data-zero-base-workbench-view=\{currentView\?\.id/);
  assert.match(main, /import "\.\/zero-base-workbenches\.css"/);
});

test("route-driven subpage changes synchronize every stateful production center", () => {
  for (const setter of ["setTab(initialTab)", "setTab(initialTab)", "setTab(initialTab)", "setTab(initialTab)", "setTab(initialTab)"]) {
    assert.ok(workspaces.includes(setter));
  }
  assert.ok((workspaces.match(/useEffect\(\(\) => setTab\(initialTab\), \[initialTab\]\)/g) || []).length >= 5);
  assert.match(concepts, /useEffect\(\(\) => setTab\(initialTab\), \[initialTab\]\)/);
  assert.match(concepts, /useEffect\(\(\) => \{[\s\S]*setBaseSection\(initialBaseSection\)/);
  assert.match(concepts, /useEffect\(\(\) => setSection\(initialSection\), \[initialSection\]\)/);
  assert.match(concepts, /useEffect\(\(\) => setTypeF\(initialType\), \[initialType\]\)/);
  assert.match(main, /strategyInitialTab=\{strategySurface\}/);
  assert.match(main, /knowledgeInitialSection=\{knowledgeSection\}/);
  assert.match(main, /capabilityInitialType=\{capabilityType\}/);
  assert.match(main, /ownerInitialPane=\{ownerPane\}/);
});

test("AI, portfolio, intelligent assets, governance and configuration share one visual grammar", () => {
  for (const selector of [
    ".conceptChatShell",
    ".tradingCommandPage",
    ".cp2StrategyLayout",
    ".cp2KnowledgeWorkbench",
    ".cp2CapabilitiesLayout",
    ".erReviewWorkbench",
    ".controlRuntimeWorkspace",
    ".opxPage",
    ".productSettings"
  ]) assert.match(styles, new RegExp(selector.replace(".", "\\.")), selector);

  for (const token of ["--zb-paper", "--zb-ink", "--zb-acid", "--zb-green", "--zb-danger", "--zb-amber"]) {
    assert.match(styles, new RegExp(token));
  }
});

test("dense product data uses continuous registries, inspectors, ledgers and explicit truth surfaces", () => {
  for (const selector of [".kRegistry", ".kInspector", ".kEvidenceLedger", ".kTruthBand", ".kFormSurface"]) {
    assert.match(styles, new RegExp(selector.replace(".", "\\.")));
  }
  assert.match(styles, /data-state="stale"|\[data-state="stale"\]/);
  assert.match(styles, /data-state="error"|\[data-state="error"\]/);
  assert.doesNotMatch(styles, /智能表单|DAO\s*治理/);
});
