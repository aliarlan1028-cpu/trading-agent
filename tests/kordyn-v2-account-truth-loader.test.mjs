import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const React = require("react");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-account-truth-loader");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `
      export { useApi } from "./src/lib.jsx";
      export { buildAccountTruth } from "./src/kordynV2/viewModels/accountTruth.js";
      export { hasJsonResponseProvenance } from "./src/jsonResponseProvenance.js";
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
const { buildAccountTruth, hasJsonResponseProvenance, useApi } = require(outFile);

function createUseApiHarness() {
  const states = [];
  const refs = [];
  return {
    render() {
      const dispatcherRef = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
      const previousDispatcher = dispatcherRef.current;
      let index = 0;
      dispatcherRef.current = {
        useState(initial) {
          const slot = index++;
          if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial;
          return [states[slot], (next) => {
            states[slot] = typeof next === "function" ? next(states[slot]) : next;
          }];
        },
        useRef(initial) {
          const slot = index++;
          if (!(slot in refs)) refs[slot] = { current: initial };
          return refs[slot];
        },
        useEffect() { index += 1; }
      };
      try {
        return useApi();
      } finally {
        dispatcherRef.current = previousDispatcher;
      }
    }
  };
}

test("useApi preserves loader provenance without re-traversing a later-mutated published snapshot", async () => {
  const saved = {
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    location: globalThis.location,
    window: globalThis.window
  };
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key)
  };
  globalThis.location = { search: "" };
  globalThis.window = {
    location: { origin: "https://app.example", hostname: "app.example", protocol: "https:" },
    localStorage: globalThis.localStorage,
    setTimeout: () => 0,
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const accountJsonText = JSON.stringify({
    portfolio: {
      totalEquityUsdt: 10240.5,
      availableMarginUsdt: 7130,
      marginSyncedAt: "2026-08-26T11:59:00Z"
    },
    positions: [{ positionId: "p-1", symbol: "BTC/USDT", quantity: 0.01, mark: 60000 }]
  });
  const accountData = () => JSON.parse(accountJsonText);
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.endsWith("/api/bootstrap/core")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ revision: 10, resourceState: { chat: "not_loaded" }, ...accountData() })
      };
    }
    if (target.includes("/api/overview?view=section&section=chat")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ revision: 10, resourceState: { chat: "loaded" }, ...accountData() })
      };
    }
    if (target.endsWith("/api/reconciler/run")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true, message: "Reconciliation accepted" })
      };
    }
    throw new Error(`Unexpected request: ${target}`);
  };

  try {
    const harness = createUseApiHarness();
    let api = harness.render();
    await api.refresh();
    api = harness.render();
    assert.equal(hasJsonResponseProvenance(api.data), true, "projected core root");
    assert.equal(buildAccountTruth(api.data, "full").exposure, 600);

    const section = await api.ensureSection("chat", { force: true });
    assert.equal(hasJsonResponseProvenance(section), true, "section response root");
    assert.equal(buildAccountTruth(section, "full").exposure, 600);

    const actionResult = await api.action("/api/reconciler/run", { mode: "manual_ui" });
    assert.equal(hasJsonResponseProvenance(actionResult), true, "action response root");
    api = harness.render();
    assert.equal(hasJsonResponseProvenance(api.data), true, "action-reloaded projection root");
    assert.equal(buildAccountTruth(api.data, "full").exposure, 600);

    const trapCalls = { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, get: 0 };
    const sideEffects = [];
    const parsedRow = api.data.positions[0];
    const wrapper = new Proxy(parsedRow, {
      getPrototypeOf() {
        trapCalls.getPrototypeOf += 1;
        sideEffects.push("wrapper:getPrototypeOf");
        return Object.prototype;
      },
      getOwnPropertyDescriptor(target, field) {
        trapCalls.getOwnPropertyDescriptor += 1;
        sideEffects.push(`wrapper:descriptor:${String(field)}`);
        if (field === "notional") {
          return { configurable: true, enumerable: true, writable: true, value: 600 };
        }
        return Reflect.getOwnPropertyDescriptor(target, field);
      },
      ownKeys(target) {
        trapCalls.ownKeys += 1;
        sideEffects.push("wrapper:ownKeys");
        return Reflect.ownKeys(target);
      },
      get(target, field, receiver) {
        trapCalls.get += 1;
        sideEffects.push(`wrapper:get:${String(field)}`);
        return Reflect.get(target, field, receiver);
      }
    });
    let accessorCalls = 0;
    const accessorRow = {};
    Object.defineProperty(accessorRow, "notional", {
      configurable: true,
      enumerable: true,
      get() {
        accessorCalls += 1;
        return 600;
      }
    });
    api.data.positions.splice(0, 1, wrapper, accessorRow);

    await api.ensureSection("chat");
    api = harness.render();
    assert.equal(buildAccountTruth(api.data, "full").exposure, "Unavailable");
    assert.deepEqual(trapCalls, { getPrototypeOf: 0, getOwnPropertyDescriptor: 0, ownKeys: 0, get: 0 });
    assert.deepEqual(sideEffects, []);
    assert.equal(accessorCalls, 0);
  } finally {
    globalThis.fetch = saved.fetch;
    globalThis.localStorage = saved.localStorage;
    globalThis.location = saved.location;
    globalThis.window = saved.window;
  }
});
