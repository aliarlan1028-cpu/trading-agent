import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertStateContract } from "./helpers/kordyn-v2-state-contract.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-state-matrix");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { KORDYN_V2_STATE_SURFACES } from "./src/kordynV2/architecture/stateSurfaces.js";
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

const { KORDYN_V2_STATE_SURFACES, renderToStaticMarkup } = require(outFile);

const EXPECTED_DOMAINS = Object.freeze(["ai", "account", "assets", "governance"]);
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

const fixture = Object.freeze({
  source: "Plan 06 state convergence authority",
  lastValidAt: "2026-09-01T04:00:00.000Z",
  longContent: "完整证据与来源上下文。".repeat(240),
  longContext: "完整恢复上下文与来源时间。".repeat(240),
  completedEffects: Object.freeze([{ id: "effect-complete", label: "已完成影响" }]),
  failedEffects: Object.freeze([{ id: "effect-failed", label: "失败影响" }]),
  largeList: Object.freeze(Array.from({ length: 200 }, (_, index) => ({
    id: `object-${index + 1}`,
    label: `权威对象 ${index + 1}`
  }))),
  largeRegistry: Object.freeze(Array.from({ length: 200 }, (_, index) => ({
    id: `registry-${index + 1}`,
    label: `Registry 对象 ${index + 1}`
  })))
});

test("the architecture registers exactly four product domains and thirteen truthful states", () => {
  assert.deepEqual(Object.keys(KORDYN_V2_STATE_SURFACES), EXPECTED_DOMAINS);
  for (const domainId of EXPECTED_DOMAINS) {
    assert.deepEqual(Object.keys(KORDYN_V2_STATE_SURFACES[domainId]), EXPECTED_STATES, domainId);
  }
});

for (const domainId of EXPECTED_DOMAINS) {
  for (const state of EXPECTED_STATES) {
    test(`${domainId} architecture state ${state} renders the shared truthful contract`, () => {
      const renderState = KORDYN_V2_STATE_SURFACES[domainId][state];
      assert.equal(typeof renderState, "function");
      const markup = renderToStaticMarkup(renderState(fixture));
      assertStateContract(markup, state);
      assert.doesNotMatch(markup, />\s*(?:undefined|NaN)\s*</i);
      assert.doesNotMatch(markup, /optimistic success/i);
      if (["stale", "degraded"].includes(state)) {
        assert.match(markup, /data-kordyn-v2-actions-disabled="true"/);
      }
      if (["processing", "approval", "partial"].includes(state)) {
        assert.doesNotMatch(markup, /执行成功|全部成功|completed successfully/i);
      }
    });
  }
}
