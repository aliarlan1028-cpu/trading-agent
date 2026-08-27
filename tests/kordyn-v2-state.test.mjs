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
      export { createJsonProjectionArray, createJsonProjectionRecord, parseJsonResponseText } from "./src/jsonResponseProvenance.js";
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
const {
  buildAccountTruth: buildUntrustedAccountTruth,
  createJsonProjectionArray,
  createJsonProjectionRecord,
  createV2Selection,
  normalizeResourceState,
  parseJsonResponseText
} = require(outFile);

function controlledJsonFixture(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const array = createJsonProjectionArray();
    seen.set(value, array);
    for (const item of value) array.push(controlledJsonFixture(item, seen));
    return array;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const record = createJsonProjectionRecord(prototype);
  seen.set(value, record);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (Object.hasOwn(descriptor, "value")) {
      descriptor.value = controlledJsonFixture(descriptor.value, seen);
    }
    Object.defineProperty(record, key, descriptor);
  }
  return record;
}

const buildAccountTruth = (data = {}, mode = "full") => (
  buildUntrustedAccountTruth(controlledJsonFixture(data), mode)
);

test("unknown is not converted to zero and stale retains its source", () => {
  assert.deepEqual(buildAccountTruth({}, "full"), {
    mode: "full", equity: "Unavailable", available: "Unavailable", exposure: "Unavailable",
    freshness: "Unavailable", freshnessState: "Unavailable", runtime: "Unavailable", risk: "Unavailable"
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

test("malformed non-empty position rows cannot become authoritative zero or throw", () => {
  const coerciveZero = { valueOf: () => 0 };
  const malformedRows = [
    null,
    [],
    { notional: 600, quantity: false },
    { notional: 600, quantity: [] },
    { notional: 600, quantity: "0" },
    { notional: 600, quantity: coerciveZero },
    { notional: "600", quantity: 0.01, mark: 60000 },
    { notional: { valueOf: () => 600 }, quantity: 0.01, mark: 60000 },
    { notional: null },
    { notional: Number.NaN },
    { notional: Number.POSITIVE_INFINITY },
    { quantity: 0.01, mark: false },
    { quantity: 0.01, mark: [] },
    { quantity: 0.01, mark: "60000" },
    { quantity: 0.01, mark: coerciveZero },
    { quantity: 0.01, mark: Number.NEGATIVE_INFINITY },
    { quantity: 0.01 },
    { mark: 60000 }
  ];
  for (const row of malformedRows) {
    assert.doesNotThrow(() => buildAccountTruth({ positions: [row] }, "full"), JSON.stringify(row));
    assert.equal(buildAccountTruth({ positions: [row] }, "full").exposure, "Unavailable", JSON.stringify(row));
  }
});

test("well-formed direct and quantity-mark positions preserve authoritative exposure", () => {
  assert.equal(buildAccountTruth({ positions: [{ positionId: "direct", notional: 600 }] }, "full").exposure, 600);
  assert.equal(buildAccountTruth({ positions: [{ positionId: "derived", quantity: 0.01, mark: 60000 }] }, "full").exposure, 600);
  assert.equal(buildAccountTruth({ positions: [] }, "full").exposure, 0);
});

test("signed and closed numeric positions preserve authoritative absolute exposure", () => {
  assert.equal(buildAccountTruth({ positions: [{ notional: -600 }] }, "full").exposure, 600);
  assert.equal(buildAccountTruth({ positions: [{ quantity: -0.01, mark: 60000 }] }, "full").exposure, 600);
  assert.equal(buildAccountTruth({ positions: [{ notional: 0 }] }, "full").exposure, 0);
  assert.equal(buildAccountTruth({ positions: [{ quantity: 0, mark: 60000 }] }, "full").exposure, 0);
  assert.equal(buildAccountTruth({ positions: [{ quantity: 0.01, mark: 0 }] }, "full").exposure, 0);
  const nullPrototype = Object.assign(Object.create(null), { notional: -600 });
  assert.equal(buildAccountTruth({ positions: [nullPrototype] }, "full").exposure, 600);
});

test("direct notional remains authoritative when an explicit quantity is zero", () => {
  assert.equal(buildAccountTruth({
    positions: [{ notional: 600, quantity: 0, mark: 60000 }]
  }, "full").exposure, 600);
});

test("direct notional aliases use the first non-nullish value", () => {
  let ignoredAccessorCalls = 0;
  const ignoredAccessor = { notional: 600 };
  Object.defineProperty(ignoredAccessor, "notionalUsdt", {
    enumerable: true,
    get() { ignoredAccessorCalls += 1; throw new Error("ignored notional alias invoked"); }
  });

  const cases = [
    [{ notional: 600, notionalUsdt: "ignored", marketValue: Number.NaN }, 600],
    [{ notional: null, notionalUsdt: -600, marketValue: "ignored" }, 600],
    [{ notional: undefined, notionalUsdt: 0 }, 0],
    [{ notional: "600", notionalUsdt: 600 }, "Unavailable"],
    [ignoredAccessor, 600]
  ];
  for (const [row, expected] of cases) {
    assert.equal(buildAccountTruth({ positions: [row] }, "full").exposure, expected);
  }
  assert.equal(ignoredAccessorCalls, 0);
});

test("quantity aliases use the first non-nullish value", () => {
  let ignoredAccessorCalls = 0;
  const ignoredAccessor = { quantity: 0.01, mark: 60000 };
  Object.defineProperty(ignoredAccessor, "size", {
    enumerable: true,
    get() { ignoredAccessorCalls += 1; throw new Error("ignored quantity alias invoked"); }
  });

  const cases = [
    [{ quantity: 0.01, size: "ignored", pos: Number.NaN, mark: 60000 }, 600],
    [{ quantity: null, size: -0.01, pos: "ignored", mark: 60000 }, 600],
    [{ quantity: undefined, size: 0, mark: 60000 }, 0],
    [{ quantity: "0.01", size: 0.01, mark: 60000 }, "Unavailable"],
    [ignoredAccessor, 600]
  ];
  for (const [row, expected] of cases) {
    assert.equal(buildAccountTruth({ positions: [row] }, "full").exposure, expected);
  }
  assert.equal(ignoredAccessorCalls, 0);
});

test("mark aliases use the first non-nullish value", () => {
  let ignoredAccessorCalls = 0;
  const ignoredAccessor = { quantity: 0.01, markPrice: 60000 };
  Object.defineProperty(ignoredAccessor, "mark", {
    enumerable: true,
    get() { ignoredAccessorCalls += 1; throw new Error("ignored mark alias invoked"); }
  });

  const cases = [
    [{ quantity: 0.01, markPrice: 60000, mark: "ignored", price: Number.NaN }, 600],
    [{ quantity: -0.01, markPrice: null, mark: 60000, price: "ignored" }, 600],
    [{ quantity: 0.01, markPrice: undefined, mark: 0 }, 0],
    [{ quantity: 0.01, markPrice: "60000", mark: 60000 }, "Unavailable"],
    [ignoredAccessor, 600]
  ];
  for (const [row, expected] of cases) {
    assert.equal(buildAccountTruth({ positions: [row] }, "full").exposure, expected);
  }
  assert.equal(ignoredAccessorCalls, 0);
});

test("class and custom-prototype position rows fail closed", () => {
  class Position {
    constructor() { this.notional = 600; }
  }
  const inherited = Object.create({ notional: 600 });
  const customPrototype = Object.assign(Object.create({ source: "custom" }), { notional: 600 });
  const exposures = [new Position(), inherited, customPrototype]
    .map((row) => buildAccountTruth({ positions: [row] }, "full").exposure);
  assert.deepEqual(exposures, ["Unavailable", "Unavailable", "Unavailable"]);
});

test("accessor position rows fail closed without invoking getters", () => {
  let getterCalls = 0;
  const accessorNotional = {};
  Object.defineProperty(accessorNotional, "notional", {
    enumerable: true,
    get() { getterCalls += 1; return 600; }
  });
  const throwingQuantity = { notional: 600 };
  Object.defineProperty(throwingQuantity, "quantity", {
    enumerable: true,
    get() { getterCalls += 1; throw new Error("quantity getter invoked"); }
  });
  const throwingMark = { quantity: 0.01 };
  Object.defineProperty(throwingMark, "mark", {
    enumerable: true,
    get() { getterCalls += 1; throw new Error("mark getter invoked"); }
  });

  const outcomes = [accessorNotional, throwingQuantity, throwingMark].map((row) => {
    let truth;
    let threw = false;
    try { truth = buildAccountTruth({ positions: [row] }, "full"); } catch { threw = true; }
    return { threw, exposure: truth?.exposure };
  });
  assert.deepEqual(outcomes, [
    { threw: false, exposure: "Unavailable" },
    { threw: false, exposure: "Unavailable" },
    { threw: false, exposure: "Unavailable" }
  ]);
  assert.equal(getterCalls, 0);
});

test("proxy-backed position rows fail closed before traps can forge descriptors", () => {
  const trapCalls = { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, get: 0 };
  const sideEffects = [];
  const data = parseJsonResponseText('{"positions":[{}]}');
  const row = new Proxy(data.positions[0], {
    getPrototypeOf() {
      trapCalls.getPrototypeOf += 1;
      sideEffects.push("getPrototypeOf");
      return Object.prototype;
    },
    getOwnPropertyDescriptor(_target, field) {
      trapCalls.getOwnPropertyDescriptor += 1;
      sideEffects.push(`descriptor:${String(field)}`);
      if (field === "notional") {
        return { configurable: true, enumerable: true, writable: true, value: 600 };
      }
      return undefined;
    },
    ownKeys() {
      trapCalls.ownKeys += 1;
      sideEffects.push("ownKeys");
      return [];
    },
    get(target, field, receiver) {
      trapCalls.get += 1;
      sideEffects.push(`get:${String(field)}`);
      return Reflect.get(target, field, receiver);
    }
  });

  let truth;
  data.positions[0] = row;
  assert.doesNotThrow(() => { truth = buildUntrustedAccountTruth(data, "full"); });
  assert.deepEqual({ exposure: truth.exposure, trapCalls, sideEffects }, {
    exposure: "Unavailable",
    trapCalls: { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, get: 0 },
    sideEffects: []
  });
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
    system: {
      requestedOperatingMode: "full_auto",
      killSwitch: false,
      riskStatus: "暂停新开仓",
      dataFreshnessState: "fresh"
    },
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
    freshnessState: "fresh",
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

test("stale and degraded copy claims retention only when provenance is retained", () => {
  for (const kind of ["stale", "degraded"]) {
    const retained = normalizeResourceState({
      resourceState: kind,
      data: { source: "OKX", asOf: "2026-08-26T00:00:00Z" }
    });
    assert.match(retained.message, /retain/i, kind);

    const unavailable = normalizeResourceState({ resourceState: kind });
    assert.equal(unavailable.retainsLastValid, false, kind);
    assert.doesNotMatch(unavailable.message, /retain/i, kind);
    assert.match(unavailable.message, /unavailable|no last-valid/i, kind);
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
