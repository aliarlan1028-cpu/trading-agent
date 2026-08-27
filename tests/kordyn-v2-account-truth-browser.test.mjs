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
