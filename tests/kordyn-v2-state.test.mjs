import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { assertStateContract } from "./helpers/kordyn-v2-state-contract.mjs";

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

test("malformed financial representations are unavailable", () => {
  const malformed = ["NaN", "Infinity", "12.5", true, false, [], [12.5], {}, { valueOf: () => 12.5 }];
  for (const value of malformed) {
    const truth = buildAccountTruth({
      portfolio: { totalEquityUsdt: value, availableMarginUsdt: value },
      positions: [{ positionId: "p-malformed", quantity: value, mark: 100 }]
    }, "full");
    assert.equal(truth.equity, "Unavailable", `equity ${JSON.stringify(value)}`);
    assert.equal(truth.available, "Unavailable", `available ${JSON.stringify(value)}`);
    assert.equal(truth.exposure, "Unavailable", `exposure ${JSON.stringify(value)}`);
  }
});

test("authoritative financial zero remains zero", () => {
  const truth = buildAccountTruth({
    portfolio: { totalEquityUsdt: 0, availableMarginUsdt: 0 },
    positions: []
  }, "full");
  assert.deepEqual({ equity: truth.equity, available: truth.available, exposure: truth.exposure }, { equity: 0, available: 0, exposure: 0 });
});

test("Full Truth maps deployed portfolio, position, runtime, freshness, and risk shapes", () => {
  const truth = buildAccountTruth({
    portfolio: {
      totalEquityUsdt: 10240.5,
      availableMarginUsdt: 7130,
      marginSyncedAt: "2026-08-26T11:59:00Z"
    },
    positions: [{ positionId: "p-1", symbol: "BTC/USDT", quantity: 0.01, mark: 60000 }],
    automationState: {
      mode: "reduce_only",
      requestedMode: "full_auto",
      runtimeStatus: "opening_paused",
      label: "暂停新开仓"
    },
    system: { requestedOperatingMode: "full_auto", killSwitch: false, riskStatus: "暂停新开仓" },
    portfolioRisk: {
      equity: 10240.5,
      budgetPct: 1,
      portfolioVolPct: 0.25,
      utilizationPct: 25,
      positions: [{ symbol: "BTC/USDT", notional: 600 }],
      status: "ok"
    },
    currentRiskSnapshot: { controls: { killSwitch: false, reduceOnly: true, riskStatus: "账户对账锁定" } }
  }, "full");
  assert.deepEqual(truth, {
    mode: "full",
    equity: 10240.5,
    available: 7130,
    exposure: 600,
    freshness: "2026-08-26T11:59:00Z",
    runtime: "reduce_only · requested full_auto",
    risk: "账户对账锁定"
  });
});

test("snapshot ordering supplies provenance but never replaces current portfolio truth", () => {
  const truth = buildAccountTruth({
    accountSnapshots: [
      { id: "failed-newest", status: "failed", totalEquityUsdt: 9999, createdAt: "2026-08-26T12:00:00Z" },
      { id: "ok-old", status: "ok", totalEquityUsdt: 111, createdAt: "2026-08-26T09:00:00Z" },
      { id: "ok-new", status: "ok", totalEquityUsdt: 222, createdAt: "2026-08-26T10:00:00Z" }
    ]
  }, "full");
  assert.equal(truth.equity, "Unavailable");
  assert.equal(truth.available, "Unavailable");
  assert.equal(truth.exposure, "Unavailable");
  assert.equal(truth.freshness, "2026-08-26T10:00:00Z");
});

test("kill-switch truth overrides a requested trading mode", () => {
  const truth = buildAccountTruth({
    system: { killSwitch: true, requestedOperatingMode: "full_auto", riskStatus: "紧急停止" },
    positions: []
  }, "full");
  assert.equal(truth.runtime, "halted · requested full_auto");
  assert.equal(truth.risk, "紧急停止");
  assert.equal(truth.exposure, 0);
});

test("stale and degraded retain only real last-valid provenance", () => {
  for (const kind of ["stale", "degraded"]) {
    const retained = normalizeResourceState({
      resourceState: kind,
      data: { source: "OKX", asOf: "2026-08-26T00:00:00Z" }
    });
    assert.equal(retained.retainsLastValid, true, kind);

    for (const data of [
      undefined,
      {},
      { source: "Unavailable", asOf: "Unavailable" },
      { source: "OKX" },
      { asOf: "2026-08-26T00:00:00Z" },
      { source: "OKX", asOf: "not-a-time" }
    ]) {
      const missing = normalizeResourceState({ resourceState: kind, data });
      assert.equal(missing.kind, kind);
      assert.equal(missing.retainsLastValid, false, `${kind} ${JSON.stringify(data)}`);
    }
  }
});

test("state contract rejects placeholder stale or degraded provenance", () => {
  const markup = (kind, source, time) => `<section data-kordyn-v2-state="${kind}" data-kordyn-v2-last-valid-source="${source}" data-kordyn-v2-last-valid-at="${time}"><h2>${kind}</h2><p>Last-valid facts</p></section>`;
  assert.doesNotThrow(() => assertStateContract(markup("stale", "OKX", "2026-08-26T00:00:00Z"), "stale"));
  for (const kind of ["stale", "degraded"]) {
    for (const placeholder of ["Unavailable", "unknown", "N/A", "—", " "]) {
      assert.throws(() => assertStateContract(markup(kind, placeholder, "2026-08-26T00:00:00Z"), kind), undefined, `${kind} source ${placeholder}`);
      assert.throws(() => assertStateContract(markup(kind, "OKX", placeholder), kind), undefined, `${kind} time ${placeholder}`);
    }
  }
});

test("malformed and null resource states fail closed without coercion", () => {
  assert.equal(normalizeResourceState(null).kind, "not_loaded");
  for (const resourceState of [null, ["loaded"], { toString: () => "loaded" }, new String("loaded"), 1, true]) {
    const state = normalizeResourceState({ resourceState });
    assert.equal(state.kind, "not_loaded", Object.prototype.toString.call(resourceState));
    assert.equal(state.source, "Unavailable");
    assert.equal(state.lastValidAt, "Unavailable");
  }
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
