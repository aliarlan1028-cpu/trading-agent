import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";
import { load } from "cheerio";
import { assertStateContract } from "./helpers/kordyn-v2-state-contract.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(rootDir, "node_modules", ".cache", `kordyn-v2-governance-states-${process.pid}.cjs`);
require("esbuild").buildSync({
  stdin: { contents: `
    export { DEPLOYED_FEATURES } from "./src/productCoverage.js";
    export { GOVERNANCE_CAPABILITY_SURFACES } from "./src/kordynV2/domains/governance/capabilitySurfaces.js";
    export { GOVERNANCE_STATE_SURFACES } from "./src/kordynV2/domains/governance/stateSurfaces.js";
    export { KORDYN_V2_CAPABILITY_OWNERSHIP } from "./src/kordynV2/architecture/capabilityOwnership.js";
    export { KORDYN_V2_WORKSPACES } from "./src/kordynV2/architecture/domains.js";
    export { renderToStaticMarkup } from "react-dom/server";
  `, resolveDir: rootDir, loader: "jsx" },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime", "lucide-react"],
  outfile: outFile,
  logLevel: "silent"
});
const { DEPLOYED_FEATURES, GOVERNANCE_CAPABILITY_SURFACES, GOVERNANCE_STATE_SURFACES, KORDYN_V2_CAPABILITY_OWNERSHIP, KORDYN_V2_WORKSPACES, renderToStaticMarkup } = require(outFile);

const EXPECTED = Object.freeze([
  "control.risk-posture", "control.operating-mode", "control.mandate-context", "control.rule-monitor", "control.event-risk", "control.permission-boundaries",
  "operations.runtime-health", "operations.tasks", "operations.task-runs", "operations.event-input-health", "operations.notifications", "operations.audit", "operations.reconcile", "operations.recovery",
  "configuration.operating-mode", "configuration.mandate", "configuration.risk-rules", "configuration.environment", "configuration.network", "configuration.backup", "configuration.security", "configuration.exchange", "configuration.event-sources", "configuration.notifications", "configuration.models", "configuration.agents", "configuration.users", "configuration.subscriptions", "configuration.account-profile"
]);
const STATES = Object.freeze(["loading", "empty", "processing", "stale", "degraded", "failed", "forbidden", "disabled", "approval", "partial", "no-result", "long-content", "large-list"]);
const fixture = Object.freeze({
  source: "Plan 05 governance production-shaped fixture",
  lastValidAt: "2026-08-31T10:18:00.000Z",
  failedSource: Object.freeze({ id: "source-fed", name: "Federal Reserve", status: "failed" }),
  disabledTask: Object.freeze({ id: "task-system", name: "System reconciliation", systemManaged: true }),
  completedEffects: Object.freeze([{ id: "snapshot", label: "账户快照已同步" }]),
  failedEffects: Object.freeze([{ id: "orders", label: "订单差异仍待恢复" }]),
  longContext: "恢复证据保留来源、时间、Actor、对象与权威结果。".repeat(800),
  largeRegistry: Object.freeze(Array.from({ length: 64 }, (_, index) => Object.freeze({ id: `config-${index + 1}`, label: `配置对象 ${index + 1}` })))
});

test("governance owns all control operations and configuration capabilities", () => {
  const ids = DEPLOYED_FEATURES.filter((row) => /^(control|operations|configuration)\./.test(row.id)).map((row) => row.id);
  assert.deepEqual(ids, EXPECTED);
  assert.equal(ids.length, 29);
  assert.deepEqual(Object.keys(GOVERNANCE_CAPABILITY_SURFACES), EXPECTED);
  for (const id of ids) {
    const surface = GOVERNANCE_CAPABILITY_SURFACES[id];
    assert.deepEqual({ domainId: surface.domainId, workspaceId: surface.workspaceId }, KORDYN_V2_CAPABILITY_OWNERSHIP[id], id);
    const workspace = KORDYN_V2_WORKSPACES.governance.find((row) => row.id === surface.workspaceId);
    assert.ok(workspace, `${id}: workspace`);
    assert.equal(surface.route, workspace.legacyRoute, `${id}: route`);
    assert.ok(surface.objectIdentity && surface.actionBoundary && surface.permissionBoundary && surface.resourceStateBoundary, id);
    assert.equal(typeof surface.desktop?.component, "function", `${id}: Desktop`);
    assert.equal(typeof surface.mobile?.component, "function", `${id}: APP`);
  }
});

for (const state of STATES) {
  test(`governance renders ${state} truthfully`, () => {
    const renderState = GOVERNANCE_STATE_SURFACES[state];
    assert.equal(typeof renderState, "function", state);
    const markup = renderToStaticMarkup(renderState(fixture));
    assertStateContract(markup, state);
    assert.doesNotMatch(markup, /undefined|\bNaN\b|configuration applied successfully|配置已自动生效/i);
    const $ = load(markup);
    if (["stale", "degraded"].includes(state)) assert.equal($(`[data-kordyn-v2-state="${state}"]`).attr("data-kordyn-v2-actions-disabled"), "true");
    if (state === "failed") assert.equal($("[data-kordyn-v2-event-source-stage]").attr("data-kordyn-v2-event-source-stage"), "failed");
    if (state === "forbidden") assert.equal($("[data-kordyn-v2-configuration-access]").attr("data-kordyn-v2-configuration-access"), "forbidden");
    if (state === "disabled") assert.ok($("[data-kordyn-v2-system-task-control]").is("[disabled]"));
    if (state === "no-result") assert.equal($("[data-kordyn-v2-audit-filter-result]").attr("data-kordyn-v2-audit-filter-result"), "none");
    if (state === "long-content") assert.equal($("[data-kordyn-v2-long-content-bounded]").attr("data-kordyn-v2-long-content-bounded"), "true");
    if (state === "large-list") assert.equal($("[data-kordyn-v2-large-list-count] li").length, 64);
  });
}
