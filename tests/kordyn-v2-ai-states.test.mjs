import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertStateContract } from "./helpers/kordyn-v2-state-contract.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-ai-states");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { DEPLOYED_FEATURES } from "./src/productCoverage.js";
      export { AI_CAPABILITY_SURFACES } from "./src/kordynV2/domains/ai/capabilitySurfaces.js";
      export { AI_STATE_SURFACES } from "./src/kordynV2/domains/ai/stateSurfaces.js";
      export { renderToStaticMarkup } from "react-dom/server";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  outfile: outFile,
  logLevel: "silent"
});

const {
  AI_CAPABILITY_SURFACES,
  AI_STATE_SURFACES,
  DEPLOYED_FEATURES,
  renderToStaticMarkup
} = require(outFile);

const EXPECTED_AI_CAPABILITIES = Object.freeze([
  "ai.dialog",
  "ai.autonomous-patrol",
  "ai.intelligence",
  "ai.watch",
  "ai.events",
  "ai.poster-current",
  "ai.poster-translate",
  "ai.poster-png"
]);

const EXPECTED_STATES = Object.freeze([
  "loading",
  "empty",
  "processing",
  "stale",
  "degraded",
  "failed",
  "forbidden",
  "disabled",
  "approval",
  "partial",
  "no-result",
  "long-content",
  "large-list"
]);

const aiStateFixture = Object.freeze({
  source: "OKX bounded projection",
  lastValidAt: "2026-08-30T00:12:00.000Z",
  longContent: "完整任务证据：".repeat(90),
  largeList: Object.freeze(Array.from({ length: 36 }, (_, index) => Object.freeze({
    id: `signal-${index + 1}`,
    label: `权威情报 ${index + 1}`
  })))
});

test("AI domain owns all eight deployed capabilities through concrete two-device surfaces", () => {
  const ids = DEPLOYED_FEATURES.filter((row) => row.id.startsWith("ai.")).map((row) => row.id);
  assert.deepEqual(ids, EXPECTED_AI_CAPABILITIES);
  assert.deepEqual(Object.keys(AI_CAPABILITY_SURFACES), EXPECTED_AI_CAPABILITIES);
  for (const id of ids) {
    const surface = AI_CAPABILITY_SURFACES[id];
    assert.equal(surface.id, id, `${id}: canonical id`);
    assert.ok(surface.workspaceId, `${id}: workspace`);
    assert.ok(surface.route, `${id}: route`);
    assert.ok(surface.actionBoundary, `${id}: action boundary`);
    assert.ok(surface.permissionBoundary, `${id}: permission boundary`);
    assert.ok(surface.resourceStateBoundary, `${id}: resource-state boundary`);
    assert.equal(typeof surface.desktop?.component, "function", `${id}: Desktop component`);
    assert.equal(typeof surface.mobile?.component, "function", `${id}: APP component`);
    assert.ok(surface.desktop?.entry, `${id}: Desktop entry`);
    assert.ok(surface.mobile?.entry, `${id}: APP entry`);
  }
});

for (const state of EXPECTED_STATES) {
  test(`AI renders ${state} without falsifying data`, () => {
    const renderState = AI_STATE_SURFACES[state];
    assert.equal(typeof renderState, "function", state);
    const markup = renderToStaticMarkup(renderState(aiStateFixture));
    assertStateContract(markup, state);
    assert.doesNotMatch(markup, /undefined|NaN|optimistic success/i);

    if (["stale", "degraded"].includes(state)) {
      assert.match(markup, /data-kordyn-v2-actions-disabled="true"/);
      assert.match(markup, /OKX bounded projection/);
      assert.match(markup, /2026-08-30T00:12:00.000Z/);
    } else {
      assert.doesNotMatch(markup, /data-kordyn-v2-last-valid-source=/);
    }

    if (["processing", "approval", "partial"].includes(state)) {
      assert.doesNotMatch(markup, /已成功|执行成功|success/i);
    }
    if (state === "long-content") assert.match(markup, /完整任务证据：/);
    if (state === "large-list") {
      assert.match(markup, /data-kordyn-v2-large-list-count="36"/);
      assert.match(markup, /权威情报 1/);
      assert.match(markup, /权威情报 36/);
    }
  });
}
