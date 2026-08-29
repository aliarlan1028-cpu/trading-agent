import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const React = require("react");
const esbuild = require("esbuild");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "use-api-request-identity");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
esbuild.buildSync({
  stdin: {
    contents: `export { useApi } from "./src/lib.jsx";`,
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
const { useApi } = require(outFile);

function renderUseApiWithoutEffects() {
  const dispatcherRef = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
  const previousDispatcher = dispatcherRef.current;
  const states = [];
  const refs = [];
  let index = 0;
  dispatcherRef.current = {
    useState(initial) {
      const slot = index++;
      if (!(slot in states)) states[slot] = typeof initial === "function" ? initial() : initial;
      return [states[slot], (next) => { states[slot] = typeof next === "function" ? next(states[slot]) : next; }];
    },
    useRef(initial) {
      const slot = index++;
      if (!(slot in refs)) refs[slot] = { current: initial };
      return refs[slot];
    },
    useEffect() { index++; }
  };
  try {
    return useApi();
  } finally {
    dispatcherRef.current = previousDispatcher;
  }
}

test("useApi aborts stale actions after base or token identity changes and only authorizes the current request", async () => {
  const saved = {
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    location: globalThis.location,
    window: globalThis.window
  };
  const store = new Map([["agent_token", "token-initial"], ["agent_api_base", "https://initial.example"]]);
  const requests = [];
  const aborted = [];
  globalThis.localStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  globalThis.location = { search: "" };
  globalThis.window = {
    Capacitor: { isNativePlatform: () => true },
    location: { origin: "https://app.example", hostname: "app.example", protocol: "https:" },
    localStorage: globalThis.localStorage,
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  globalThis.fetch = (url, options = {}) => {
    requests.push({ url, options });
    if (url.endsWith("/api/auth/login")) {
      return Promise.resolve({ ok: true, json: async () => ({ token: "token-next" }) });
    }
    if (url.endsWith("/api/identity/current")) {
      return Promise.resolve({ ok: true, text: async () => JSON.stringify({ ok: true }) });
    }
    if (url.endsWith("/api/bootstrap/core")) {
      return Promise.resolve({ ok: true, json: async () => ({ revision: 1, resourceState: {} }) });
    }
    if (url.includes("/api/overview?view=section&section=chat")) {
      return Promise.resolve({ ok: true, json: async () => ({ revision: 1, resourceState: { chat: "loaded" } }) });
    }
    return new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        aborted.push(String(url));
        reject(options.signal.reason);
      }, { once: true });
    });
  };

  try {
    const api = renderUseApiWithoutEffects();

    const staleBase = api.action("/api/identity/base");
    assert.equal(api.setApiBase("https://second.example"), "https://second.example");
    assert.deepEqual(await staleBase, { ok: false, error: "request_cancelled" });

    const staleToken = api.action("/api/identity/token");
    assert.deepEqual(await api.login("password"), { ok: true });
    assert.deepEqual(await staleToken, { ok: false, error: "request_cancelled" });

    assert.deepEqual(await api.action("/api/identity/current"), { ok: true });
    const current = requests.find((request) => request.url.endsWith("/api/identity/current"));
    assert.equal(current.url, "https://second.example/api/identity/current");
    assert.equal(current.options.headers.Authorization, "Bearer token-next");

    api.setApiBase("https://third.example");
    assert.deepEqual(aborted, [
      "https://initial.example/api/identity/base",
      "https://second.example/api/identity/token"
    ]);
  } finally {
    globalThis.fetch = saved.fetch;
    globalThis.localStorage = saved.localStorage;
    globalThis.location = saved.location;
    globalThis.window = saved.window;
  }
});

test("useApi preserves only bounded authoritative approval facts from a 409 response", async () => {
  const saved = {
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    location: globalThis.location,
    window: globalThis.window
  };
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) || null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key)
  };
  globalThis.location = { search: "" };
  globalThis.window = {
    location: { origin: "https://app.example", hostname: "app.example", protocol: "https:" },
    localStorage: globalThis.localStorage,
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/api\/trade-plans\/plan-409\/approve$/);
    return {
      ok: false,
      status: 409,
      text: async () => JSON.stringify({
        ok: false,
        error: "execution_not_submitted",
        message: "批准已消费，但订单未提交。",
        approvalGranted: true,
        executionSubmitted: false,
        plan: { id: "plan-409", status: "approved", privateKey: "must-not-leak" },
        execution: { status: "risk_recheck_failed", reason: "capacity_changed", credentials: "must-not-leak" },
        guard: { label: "容量已变化", fix: "刷新账户事实", secret: "must-not-leak" },
        secret: "must-not-leak"
      })
    };
  };

  try {
    const result = await renderUseApiWithoutEffects().action("/api/trade-plans/plan-409/approve");
    assert.deepEqual(result, {
      ok: false,
      error: "execution_not_submitted",
      httpStatus: 409,
      message: "批准已消费，但订单未提交。",
      approvalGranted: true,
      executionSubmitted: false,
      plan: { id: "plan-409", status: "approved" },
      execution: { status: "risk_recheck_failed", reason: "capacity_changed" },
      guard: { label: "容量已变化", fix: "刷新账户事实" }
    });
    assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  } finally {
    globalThis.fetch = saved.fetch;
    globalThis.localStorage = saved.localStorage;
    globalThis.location = saved.location;
    globalThis.window = saved.window;
  }
});
