import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { load } from "cheerio";
import { assertStateContract } from "./helpers/kordyn-v2-state-contract.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-assets-states");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { DEPLOYED_FEATURES } from "./src/productCoverage.js";
      export { ASSET_CAPABILITY_SURFACES } from "./src/kordynV2/domains/assets/capabilitySurfaces.js";
      export { ASSET_STATE_SURFACES } from "./src/kordynV2/domains/assets/stateSurfaces.js";
      export { KORDYN_V2_CAPABILITY_OWNERSHIP } from "./src/kordynV2/architecture/capabilityOwnership.js";
      export { KORDYN_V2_WORKSPACES } from "./src/kordynV2/architecture/domains.js";
      export { renderToStaticMarkup } from "react-dom/server";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime", "lucide-react"],
  outfile: outFile,
  logLevel: "silent"
});
const { ASSET_CAPABILITY_SURFACES, ASSET_STATE_SURFACES, DEPLOYED_FEATURES, KORDYN_V2_CAPABILITY_OWNERSHIP, KORDYN_V2_WORKSPACES, renderToStaticMarkup } = require(outFile);

const EXPECTED = Object.freeze([
  "lab.research-map", "lab.knowledge-import", "lab.knowledge-evidence", "lab.knowledge-graph", "lab.knowledge-artifacts", "lab.knowledge-workflows",
  "lab.strategy-core", "lab.strategy-studio", "lab.strategy-knowledge", "lab.strategy-imported", "lab.strategy-adaptive",
  "lab.capability-native", "lab.capability-workflow", "lab.capability-imported-skill", "lab.capability-mcp", "lab.capability-connectors",
  "lab.trade-review", "lab.owner-review"
]);
const STATES = Object.freeze(["loading", "empty", "processing", "stale", "degraded", "failed", "forbidden", "disabled", "approval", "partial", "no-result", "long-content", "large-list"]);
const fixture = Object.freeze({
  source: "Plan 04 intelligent assets production-shaped fixture",
  lastValidAt: "2026-08-31T09:18:00.000Z",
  failedSource: Object.freeze({ id: "source-failed", title: "Event Risk Playbook", stage: "failed" }),
  staleCapability: Object.freeze({ id: "market-depth", name: "Market Depth", health: "stale" }),
  disabledMcp: Object.freeze({ id: "event-mcp", name: "Event MCP", grant: "not-granted" }),
  completedEffects: Object.freeze([Object.freeze({ id: "candidate-saved", label: "候选版本已保存" })]),
  failedEffects: Object.freeze([Object.freeze({ id: "validation-failed", label: "纯前向验证未通过" })]),
  longEvidence: "证据保留来源、页码、版本与验证边界。".repeat(800),
  largeRegistry: Object.freeze(Array.from({ length: 64 }, (_, index) => Object.freeze({ id: `asset-${index + 1}`, label: `智能资产 ${index + 1}` })))
});

test("intelligent assets own all eighteen lab capabilities through concrete Desktop and APP surfaces", () => {
  const ids = DEPLOYED_FEATURES.filter((row) => row.id.startsWith("lab.")).map((row) => row.id);
  assert.deepEqual(ids, EXPECTED);
  assert.deepEqual(Object.keys(ASSET_CAPABILITY_SURFACES), EXPECTED);
  for (const id of ids) {
    const surface = ASSET_CAPABILITY_SURFACES[id];
    assert.deepEqual({ domainId: surface.domainId, workspaceId: surface.workspaceId }, KORDYN_V2_CAPABILITY_OWNERSHIP[id], id);
    const workspace = KORDYN_V2_WORKSPACES.assets.find((row) => row.id === surface.workspaceId);
    assert.ok(workspace, `${id}: workspace`);
    assert.equal(surface.route, workspace.legacyRoute, `${id}: route`);
    assert.ok(surface.objectIdentity, `${id}: identity`);
    assert.ok(surface.actionBoundary, `${id}: actions`);
    assert.ok(surface.permissionBoundary, `${id}: permission`);
    assert.ok(surface.resourceStateBoundary, `${id}: state`);
    assert.equal(typeof surface.desktop?.component, "function", `${id}: Desktop`);
    assert.equal(typeof surface.mobile?.component, "function", `${id}: APP`);
    assert.ok(surface.desktop?.entry && surface.mobile?.entry, `${id}: entries`);
  }
  const serialized = JSON.stringify(ASSET_CAPABILITY_SURFACES);
  assert.doesNotMatch(serialized, /arbitrary code|direct live rewrite|bypass owner|automatic publish/i);
});

for (const state of STATES) {
  test(`intelligent assets render ${state} truthfully`, () => {
    const renderState = ASSET_STATE_SURFACES[state];
    assert.equal(typeof renderState, "function", state);
    const markup = renderToStaticMarkup(renderState(fixture));
    assertStateContract(markup, state);
    assert.doesNotMatch(markup, /undefined|\bNaN\b|published successfully|已自动发布/i);
    const $ = load(markup);
    if (["stale", "degraded"].includes(state)) {
      assert.equal($(`[data-kordyn-v2-state="${state}"]`).attr("data-kordyn-v2-actions-disabled"), "true");
      assert.equal($("[data-kordyn-v2-capability-health]").attr("data-kordyn-v2-capability-health"), "stale");
    }
    if (state === "failed") assert.equal($("[data-kordyn-v2-source-stage]").attr("data-kordyn-v2-source-stage"), "failed");
    if (state === "forbidden") assert.equal($("[data-kordyn-v2-owner-queue-access]").attr("data-kordyn-v2-owner-queue-access"), "forbidden");
    if (state === "disabled") assert.equal($("[data-kordyn-v2-mcp-grant]").attr("data-kordyn-v2-mcp-grant"), "not-granted");
    if (state === "no-result") assert.equal($("[data-kordyn-v2-relationship-result]").attr("data-kordyn-v2-relationship-result"), "none");
    if (state === "long-content") assert.equal($("[data-kordyn-v2-long-content-bounded]").attr("data-kordyn-v2-long-content-bounded"), "true");
    if (state === "large-list") {
      assert.equal($("[data-kordyn-v2-large-list-count]").attr("data-kordyn-v2-large-list-count"), "64");
      assert.equal($("[data-kordyn-v2-large-list-count] li").length, 64);
    }
  });
}

test("asset state surfaces reject hostile or unreadable evidence fields", () => {
  const revoked = Proxy.revocable({ source: "REVOKED_SECRET" }, {});
  revoked.revoke();
  assert.doesNotThrow(() => renderToStaticMarkup(ASSET_STATE_SURFACES.failed(revoked.proxy)));
  const markup = renderToStaticMarkup(ASSET_STATE_SURFACES["large-list"]({
    largeRegistry: [{ id: "safe", label: "safe row" }, { id: "x", label: "<img src=x onerror=alert(1)>" }],
    longEvidence: "<script>alert(1)</script>"
  }));
  assert.doesNotMatch(markup, /<script|onerror=|&lt;script|&lt;img/i);
  assert.match(markup, /safe row/);
});
