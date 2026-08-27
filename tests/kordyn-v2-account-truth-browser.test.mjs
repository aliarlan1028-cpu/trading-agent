import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { outputFiles } = require("esbuild").buildSync({
  stdin: {
    contents: `
      import * as accountTruth from "./src/kordynV2/viewModels/accountTruth.js";
      import { parseJsonResponseText } from "./src/jsonResponseProvenance.js";
      globalThis.__kordynAccountTruth = accountTruth;
      globalThis.__kordynParseJsonResponseText = parseJsonResponseText;
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  define: { "process.env.NODE_ENV": '"test"' },
  format: "iife",
  platform: "browser",
  write: false,
  logLevel: "silent"
});

const browserContext = {};
vm.runInNewContext(outputFiles[0].text, browserContext, { filename: "kordyn-v2-account-truth.browser.js" });

test("browser Account Truth accepts parsed loader JSON and rejects forged Proxy wrappers without traps", () => {
  const serialized = vm.runInNewContext(`
    (() => {
      const { buildAccountTruth } = __kordynAccountTruth;
      const parseLoaderJson = __kordynParseJsonResponseText;
      const makeCounters = () => ({ getPrototypeOf: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, get: 0 });
      const wrap = (target, counters, sideEffects, label) => new Proxy(target, {
        getPrototypeOf() {
          counters.getPrototypeOf += 1;
          sideEffects.push(label + ":getPrototypeOf");
          return Object.prototype;
        },
        getOwnPropertyDescriptor(_target, field) {
          counters.getOwnPropertyDescriptor += 1;
          sideEffects.push(label + ":descriptor:" + String(field));
          if (field === "notional") {
            return { configurable: true, enumerable: true, writable: true, value: 600 };
          }
          return Reflect.getOwnPropertyDescriptor(target, field);
        },
        ownKeys() {
          counters.ownKeys += 1;
          sideEffects.push(label + ":ownKeys");
          return Reflect.ownKeys(target);
        },
        get(_target, field, receiver) {
          counters.get += 1;
          sideEffects.push(label + ":get:" + String(field));
          return Reflect.get(target, field, receiver);
        }
      });

      const rowRoot = parseLoaderJson('{"positions":[{"notional":600}]}');
      const ordinaryExposure = buildAccountTruth(rowRoot, "full").exposure;
      const rowCounters = makeCounters();
      const rowSideEffects = [];
      rowRoot.positions[0] = wrap(rowRoot.positions[0], rowCounters, rowSideEffects, "row");
      const rowExposure = buildAccountTruth(rowRoot, "full").exposure;

      const rootTarget = parseLoaderJson('{"positions":[{"notional":600}]}');
      const rootCounters = makeCounters();
      const rootSideEffects = [];
      const rootExposure = buildAccountTruth(
        wrap(rootTarget, rootCounters, rootSideEffects, "root"),
        "full"
      ).exposure;

      const unbrandedExposure = buildAccountTruth(
        { positions: [{ notional: 600 }] },
        "full"
      ).exposure;

      return JSON.stringify({
        arbitraryMaterializerExported: typeof __kordynAccountTruth.materializeJsonResponse === "function",
        safeTextParserExported: typeof __kordynParseJsonResponseText === "function",
        ordinaryExposure,
        rowExposure,
        rowCounters,
        rowSideEffects,
        rootExposure,
        rootCounters,
        rootSideEffects,
        unbrandedExposure
      });
    })()
  `, browserContext);
  const result = JSON.parse(serialized);

  assert.equal(result.ordinaryExposure, 600);
  assert.deepEqual({
    exposure: result.rowExposure,
    counters: result.rowCounters,
    sideEffects: result.rowSideEffects
  }, {
    exposure: "Unavailable",
    counters: { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, get: 0 },
    sideEffects: []
  });
  assert.deepEqual({
    exposure: result.rootExposure,
    counters: result.rootCounters,
    sideEffects: result.rootSideEffects
  }, {
    exposure: "Unavailable",
    counters: { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, get: 0 },
    sideEffects: []
  });
  assert.equal(result.unbrandedExposure, "Unavailable");
  assert.equal(result.arbitraryMaterializerExported, false);
  assert.equal(result.safeTextParserExported, true);
});

test("browser Account Truth rejects post-parse runtime wrappers and accessors without callbacks", () => {
  const serialized = vm.runInNewContext(`
    (() => {
      const { buildAccountTruth } = __kordynAccountTruth;
      const parseLoaderJson = __kordynParseJsonResponseText;
      const fixture = () => parseLoaderJson(JSON.stringify({
        automationState: {
          mode: "reduce_only",
          requestedMode: "full_auto",
          label: "New entries paused",
          blockerDetails: [{ label: "Account reconciliation pending" }]
        },
        system: { killSwitch: false, requestedOperatingMode: "full_auto" }
      }));
      const makeCounters = () => ({
        getPrototypeOf: 0,
        getOwnPropertyDescriptor: 0,
        ownKeys: 0,
        get: 0
      });
      const wrap = (target, counters) => new Proxy(target, {
        getPrototypeOf() { counters.getPrototypeOf += 1; return Object.prototype; },
        getOwnPropertyDescriptor(value, field) {
          counters.getOwnPropertyDescriptor += 1;
          return Reflect.getOwnPropertyDescriptor(value, field);
        },
        ownKeys(value) { counters.ownKeys += 1; return Reflect.ownKeys(value); },
        get(value, field, receiver) {
          counters.get += 1;
          return Reflect.get(value, field, receiver);
        }
      });
      const readRuntime = (data) => {
        try {
          return { threw: false, runtime: buildAccountTruth(data, "full").runtime };
        } catch (error) {
          return { threw: true, runtime: null, error: String(error) };
        }
      };

      const ordinary = readRuntime(fixture());

      const blockerData = fixture();
      const blockerCounters = makeCounters();
      blockerData.automationState.blockerDetails[0] = wrap(
        blockerData.automationState.blockerDetails[0],
        blockerCounters
      );
      const blocker = readRuntime(blockerData);

      const blockerLabelData = fixture();
      let blockerLabelGetterCalls = 0;
      Object.defineProperty(blockerLabelData.automationState.blockerDetails[0], "label", {
        configurable: true,
        enumerable: true,
        get() {
          blockerLabelGetterCalls += 1;
          throw new Error("blocker label getter invoked");
        }
      });
      const blockerLabel = readRuntime(blockerLabelData);

      const labelData = fixture();
      let labelGetterCalls = 0;
      Object.defineProperty(labelData.automationState, "label", {
        configurable: true,
        enumerable: true,
        get() {
          labelGetterCalls += 1;
          throw new Error("automation label getter invoked");
        }
      });
      const label = readRuntime(labelData);

      const modeData = fixture();
      const modeCounters = makeCounters();
      modeData.automationState.mode = wrap({}, modeCounters);
      const mode = readRuntime(modeData);

      return JSON.stringify({
        ordinary,
        blocker,
        blockerCounters,
        blockerLabel,
        blockerLabelGetterCalls,
        label,
        labelGetterCalls,
        mode,
        modeCounters
      });
    })()
  `, browserContext);
  const result = JSON.parse(serialized);
  const zeroCallbacks = { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, get: 0 };

  assert.deepEqual(result.ordinary, {
    threw: false,
    runtime: "reduce_only · requested full_auto"
  });
  assert.deepEqual({ outcome: result.blocker, callbacks: result.blockerCounters }, {
    outcome: { threw: false, runtime: "Unavailable" },
    callbacks: zeroCallbacks
  });
  assert.deepEqual({ outcome: result.blockerLabel, getterCalls: result.blockerLabelGetterCalls }, {
    outcome: { threw: false, runtime: "Unavailable" },
    getterCalls: 0
  });
  assert.deepEqual({ outcome: result.label, getterCalls: result.labelGetterCalls }, {
    outcome: { threw: false, runtime: "Unavailable" },
    getterCalls: 0
  });
  assert.deepEqual({ outcome: result.mode, callbacks: result.modeCounters }, {
    outcome: { threw: false, runtime: "Unavailable" },
    callbacks: zeroCallbacks
  });
});

test("browser Account Truth rejects post-parse freshness and risk leaves without coercion", () => {
  const serialized = vm.runInNewContext(`
    (() => {
      const { buildAccountTruth } = __kordynAccountTruth;
      const parseLoaderJson = __kordynParseJsonResponseText;
      const makeCounters = () => ({
        getPrototypeOf: 0,
        getOwnPropertyDescriptor: 0,
        ownKeys: 0,
        get: 0
      });
      const wrap = (target, counters) => new Proxy(target, {
        getPrototypeOf() { counters.getPrototypeOf += 1; return Object.prototype; },
        getOwnPropertyDescriptor(value, field) {
          counters.getOwnPropertyDescriptor += 1;
          return Reflect.getOwnPropertyDescriptor(value, field);
        },
        ownKeys(value) { counters.ownKeys += 1; return Reflect.ownKeys(value); },
        get(value, field, receiver) {
          counters.get += 1;
          return Reflect.get(value, field, receiver);
        }
      });
      const safely = (data, field) => {
        try {
          const value = buildAccountTruth(data, "full")[field];
          return { threw: false, unavailable: value === "Unavailable", valueType: typeof value };
        } catch (error) {
          return { threw: true, unavailable: false, valueType: "throw", error: String(error) };
        }
      };

      const ordinary = parseLoaderJson(JSON.stringify({
        portfolio: { marginSyncedAt: "2026-08-27T06:20:00Z" },
        portfolioRisk: { status: "normal" },
        accountSnapshots: [
          { id: "old", status: "ok", createdAt: "2026-08-27T06:00:00Z" },
          { id: "new", status: "ok", createdAt: "2026-08-27T06:10:00Z" }
        ]
      }));
      const ordinaryTruth = buildAccountTruth(ordinary, "full");

      const marginProxyData = parseLoaderJson('{"portfolio":{"marginSyncedAt":"2026-08-27T06:20:00Z"}}');
      const marginProxyCounters = makeCounters();
      marginProxyData.portfolio.marginSyncedAt = wrap({}, marginProxyCounters);
      const marginProxy = safely(marginProxyData, "freshness");

      const marginAccessorData = parseLoaderJson('{"portfolio":{"marginSyncedAt":"2026-08-27T06:20:00Z"}}');
      let marginGetterCalls = 0;
      Object.defineProperty(marginAccessorData.portfolio, "marginSyncedAt", {
        configurable: true,
        enumerable: true,
        get() { marginGetterCalls += 1; throw new Error("margin getter invoked"); }
      });
      const marginAccessor = safely(marginAccessorData, "freshness");

      const riskProxyData = parseLoaderJson('{"portfolioRisk":{"status":"normal"}}');
      const riskProxyCounters = makeCounters();
      riskProxyData.portfolioRisk.status = wrap({}, riskProxyCounters);
      const riskProxy = safely(riskProxyData, "risk");

      const riskAccessorData = parseLoaderJson('{"portfolioRisk":{"status":"normal"}}');
      let riskGetterCalls = 0;
      Object.defineProperty(riskAccessorData.portfolioRisk, "status", {
        configurable: true,
        enumerable: true,
        get() { riskGetterCalls += 1; throw new Error("risk getter invoked"); }
      });
      const riskAccessor = safely(riskAccessorData, "risk");

      const controlsProxyData = parseLoaderJson('{"currentRiskSnapshot":{"controls":{"killSwitch":false,"reduceOnly":true,"riskStatus":"reconciliation_locked"}}}');
      const controlsProxyCounters = makeCounters();
      controlsProxyData.currentRiskSnapshot.controls = wrap(
        controlsProxyData.currentRiskSnapshot.controls,
        controlsProxyCounters
      );
      const controlsProxy = safely(controlsProxyData, "risk");

      const controlsAccessorData = parseLoaderJson('{"currentRiskSnapshot":{"controls":{"killSwitch":false,"reduceOnly":true,"riskStatus":"reconciliation_locked"}}}');
      let controlsGetterCalls = 0;
      Object.defineProperty(controlsAccessorData.currentRiskSnapshot.controls, "riskStatus", {
        configurable: true,
        enumerable: true,
        get() { controlsGetterCalls += 1; throw new Error("controls getter invoked"); }
      });
      const controlsAccessor = safely(controlsAccessorData, "risk");

      const snapshotProxyData = parseLoaderJson('{"accountSnapshots":[{"id":"old","status":"ok","createdAt":"2026-08-27T06:00:00Z"},{"id":"new","status":"ok","createdAt":"2026-08-27T06:10:00Z"}]}');
      const snapshotProxyCounters = makeCounters();
      snapshotProxyData.accountSnapshots[1].createdAt = wrap({}, snapshotProxyCounters);
      const snapshotProxy = safely(snapshotProxyData, "freshness");

      const snapshotAccessorData = parseLoaderJson('{"accountSnapshots":[{"id":"old","status":"ok","createdAt":"2026-08-27T06:00:00Z"},{"id":"new","status":"ok","createdAt":"2026-08-27T06:10:00Z"}]}');
      let snapshotGetterCalls = 0;
      Object.defineProperty(snapshotAccessorData.accountSnapshots[1], "createdAt", {
        configurable: true,
        enumerable: true,
        get() { snapshotGetterCalls += 1; throw new Error("snapshot getter invoked"); }
      });
      const snapshotAccessor = safely(snapshotAccessorData, "freshness");

      return JSON.stringify({
        ordinary: { freshness: ordinaryTruth.freshness, risk: ordinaryTruth.risk },
        marginProxy, marginProxyCounters,
        marginAccessor, marginGetterCalls,
        riskProxy, riskProxyCounters,
        riskAccessor, riskGetterCalls,
        controlsProxy, controlsProxyCounters,
        controlsAccessor, controlsGetterCalls,
        snapshotProxy, snapshotProxyCounters,
        snapshotAccessor, snapshotGetterCalls
      });
    })()
  `, browserContext);
  const result = JSON.parse(serialized);
  const unavailable = { threw: false, unavailable: true, valueType: "string" };
  const zeroCallbacks = { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, get: 0 };

  assert.deepEqual(result.ordinary, {
    freshness: "2026-08-27T06:20:00Z",
    risk: "normal"
  });
  assert.deepEqual({ outcome: result.marginProxy, callbacks: result.marginProxyCounters }, {
    outcome: unavailable,
    callbacks: zeroCallbacks
  });
  assert.deepEqual({ outcome: result.marginAccessor, getterCalls: result.marginGetterCalls }, {
    outcome: unavailable,
    getterCalls: 0
  });
  assert.deepEqual({ outcome: result.riskProxy, callbacks: result.riskProxyCounters }, {
    outcome: unavailable,
    callbacks: zeroCallbacks
  });
  assert.deepEqual({ outcome: result.riskAccessor, getterCalls: result.riskGetterCalls }, {
    outcome: unavailable,
    getterCalls: 0
  });
  assert.deepEqual({ outcome: result.controlsProxy, callbacks: result.controlsProxyCounters }, {
    outcome: unavailable,
    callbacks: zeroCallbacks
  });
  assert.deepEqual({ outcome: result.controlsAccessor, getterCalls: result.controlsGetterCalls }, {
    outcome: unavailable,
    getterCalls: 0
  });
  assert.deepEqual({ outcome: result.snapshotProxy, callbacks: result.snapshotProxyCounters }, {
    outcome: unavailable,
    callbacks: zeroCallbacks
  });
  assert.deepEqual({ outcome: result.snapshotAccessor, getterCalls: result.snapshotGetterCalls }, {
    outcome: unavailable,
    getterCalls: 0
  });
});
