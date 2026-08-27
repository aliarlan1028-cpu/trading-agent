import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-state");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { buildAccountTruth } from "./src/kordynV2/viewModels/accountTruth.js";
      export { createV2Selection } from "./src/kordynV2/viewModels/selection.js";
      export { normalizeResourceState } from "./src/kordynV2/viewModels/state.js";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  outfile: outFile,
  logLevel: "silent"
});
const { buildAccountTruth, createV2Selection, normalizeResourceState } = require(outFile);

test("unknown is not converted to zero and stale retains its source", () => {
  assert.deepEqual(buildAccountTruth({}, "full"), {
    mode: "full", equity: "Unavailable", available: "Unavailable", exposure: "Unavailable",
    freshness: "Unavailable", runtime: "Unavailable", risk: "Unavailable"
  });
  const state = normalizeResourceState({ resourceState: "stale", data: { asOf: "2026-08-26T00:00:00Z", source: "OKX" } });
  assert.deepEqual(
    { kind: state.kind, retainsLastValid: state.retainsLastValid, source: state.source },
    { kind: "stale", retainsLastValid: true, source: "OKX" }
  );
});

test("non-finite financial facts are unavailable", () => {
  const truth = buildAccountTruth({
    portfolio: { totalEquityUsdt: Number.NaN, availableMarginUsdt: Number.POSITIVE_INFINITY },
    portfolioRisk: { grossExposureUsdt: Number.NEGATIVE_INFINITY }
  }, "full");
  assert.deepEqual(
    { equity: truth.equity, available: truth.available, exposure: truth.exposure },
    { equity: "Unavailable", available: "Unavailable", exposure: "Unavailable" }
  );
});

test("authoritative financial zero remains zero", () => {
  const truth = buildAccountTruth({
    portfolio: { totalEquityUsdt: 0, availableMarginUsdt: 0, exposureUsdt: 0 }
  }, "full");
  assert.deepEqual({ equity: truth.equity, available: truth.available, exposure: truth.exposure }, { equity: 0, available: 0, exposure: 0 });
});

test("selection remains canonical across the V2 shell", () => {
  const selection = createV2Selection({
    data: { positions: [{ positionId: "p-1", symbol: "BTC/USDT" }] },
    candidate: { id: "p-1", type: "Position", workspaceId: "account" }
  });
  assert.equal(selection.object.id, "p-1");
  assert.equal(selection.object.workspaceId, "live");
  assert.equal(selection.object.route, "positions");
  assert.equal(selection.context.objectId, "p-1");
  assert.equal(selection.context.workspaceId, "live");
  assert.equal(selection.trace.objectId, "p-1");
  assert.ok(selection.trace.stages.every((stage) => stage.objectId === "p-1" && stage.workspaceId === "live"));
});
