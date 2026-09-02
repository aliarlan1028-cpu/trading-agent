import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  authIntentFromSearch,
  dispatchMarketingAuth,
  normalizeAuthMode
} from "../src/marketing/authIntent.js";

const require = createRequire(import.meta.url);
const React = require("react");
const esbuild = require("esbuild");
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "marketing-auth-intent");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
const marketingEntry = path.join(rootDir, "src", "marketing", "landing.js");
const webLandingSource = fs.readFileSync(path.join(rootDir, "src", "landing.jsx"), "utf8").replace("function WebLandingPage(", "export function WebLandingPage(");

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
esbuild.buildSync({
  stdin: { contents: webLandingSource, resolveDir: path.join(rootDir, "src"), loader: "jsx" },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime"],
  outfile: outFile,
  logLevel: "silent"
});
const { WebLandingPage } = require(outFile);

function findElement(root, predicate) {
  if (!root || typeof root !== "object") return null;
  if (predicate(root)) return root;
  const children = root.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function runMarketingEntry({ topLevel }) {
  const output = esbuild.buildSync({ entryPoints: [marketingEntry], bundle: true, write: false, format: "iife", platform: "browser", logLevel: "silent" }).outputFiles[0].text;
  const listeners = new Map();
  const navigations = [];
  const document = {
    documentElement: { scrollTop: 0, scrollHeight: 1200 },
    addEventListener: (type, handler) => listeners.set(type, handler),
    querySelectorAll: () => [],
    getElementById: () => null
  };
  const window = {
    location: { search: "", origin: "https://app.example", assign: (path) => navigations.push(path) },
    top: null,
    parent: { postMessage: () => {} },
    innerHeight: 800,
    scrollY: 0,
    addEventListener: () => {},
    requestAnimationFrame: (callback) => callback(),
    setInterval: () => {},
    matchMedia: () => ({ matches: false })
  };
  window.top = topLevel ? window : {};
  new Function("window", "document", "localStorage", "fetch", output)(window, document, { getItem: () => null, setItem: () => {} }, () => Promise.reject(new Error("not needed")));
  return { click: listeners.get("click"), navigations };
}

function createWebLandingHarness(location) {
  const dispatcherRef = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentDispatcher;
  const states = [];
  const refs = [];
  const effects = [];
  let messageHandler;
  const replacements = [];
  const window = {
    location,
    history: {
      state: { surface: "app" },
      replaceState: (_state, _title, next) => {
        replacements.push(next);
        const nextUrl = new URL(next, location.origin);
        location.search = nextUrl.search;
        location.hash = nextUrl.hash;
      }
    },
    addEventListener: (type, handler) => { if (type === "message") messageHandler = handler; },
    removeEventListener: () => {}
  };
  return {
    render() {
      const previousDispatcher = dispatcherRef.current;
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
        useEffect(effect) { index++; effects.push(effect); }
      };
      try {
        return WebLandingPage({ login: async () => ({}), registerAccount: async () => ({}), publicInfo: {} });
      } finally {
        dispatcherRef.current = previousDispatcher;
      }
    },
    flushEffects() { while (effects.length) effects.shift()(); },
    installWindow() {
      const previous = { window: globalThis.window, document: globalThis.document };
      globalThis.window = window;
      globalThis.document = { addEventListener: () => {}, removeEventListener: () => {} };
      return () => { globalThis.window = previous.window; globalThis.document = previous.document; };
    },
    get replacements() { return replacements; },
    get messageHandler() { return messageHandler; }
  };
}

test("auth intent accepts only presentation-safe login and subscription modes", () => {
  assert.equal(normalizeAuthMode("login"), "login");
  assert.equal(normalizeAuthMode("subscribe"), "subscribe");
  assert.equal(normalizeAuthMode("token-value"), "");
  assert.equal(authIntentFromSearch("?auth=login"), "login");
  assert.equal(authIntentFromSearch("?auth=subscribe"), "subscribe");
  assert.equal(authIntentFromSearch("?auth=token-value"), "");
});

test("top-level marketing actions navigate only to the allowlisted app presentation URL", () => {
  const navigations = [];
  const messages = [];
  const navigate = (path) => navigations.push(path);
  const postMessage = (payload, origin) => messages.push({ payload, origin });

  dispatchMarketingAuth({ mode: "login", topLevel: true, origin: "https://app.example", navigate, postMessage });

  assert.deepEqual(navigations, ["/app?auth=login"]);
  assert.deepEqual(messages, []);
});

test("iframe marketing actions preserve the same-origin message and unknown modes do nothing", () => {
  const navigations = [];
  const messages = [];
  const navigate = (path) => navigations.push(path);
  const postMessage = (payload, origin) => messages.push({ payload, origin });

  dispatchMarketingAuth({ mode: "subscribe", topLevel: false, origin: "https://app.example", navigate, postMessage });
  dispatchMarketingAuth({ mode: "token-value", topLevel: true, origin: "https://app.example", navigate, postMessage });

  assert.deepEqual(messages, [{ payload: { type: "lp-start", mode: "subscribe" }, origin: "https://app.example" }]);
  assert.deepEqual(navigations, []);
});

test("the real top-level marketing click navigates to the allowlisted app presentation URL", () => {
  const marketing = runMarketingEntry({ topLevel: true });
  const action = { getAttribute: () => "login" };

  marketing.click({ target: { closest: () => action }, preventDefault: () => {} });

  assert.deepEqual(marketing.navigations, ["/app?auth=login"]);
});

test("the real React landing consumes a one-shot auth query and rejects untrusted iframe messages", () => {
  const location = { origin: "https://app.example", pathname: "/app", search: "?campaign=launch&auth=subscribe", hash: "#mission" };
  const harness = createWebLandingHarness(location);
  const restore = harness.installWindow();

  try {
    let tree = harness.render();
    assert.ok(findElement(tree, (node) => node.props?.className === "lpModal lpModal--subscribe"), "the valid query opens the real subscription modal");
    harness.flushEffects();
    assert.deepEqual(harness.replacements, ["/app?campaign=launch#mission"]);

    harness.messageHandler({ origin: "https://app.example", source: undefined, data: { type: "lp-start", mode: "login" } });
    tree = harness.render();
    assert.equal(findElement(tree, (node) => node.props?.className === "lpModal lpModal--login"), null, "messages are rejected until the landing iframe has a real content window");

    tree = harness.render();
    const frame = findElement(tree, (node) => node.props?.className === "lpFrame");
    const landingFrameWindow = {};
    (frame.ref || frame.props.ref).current = { contentWindow: landingFrameWindow };
    harness.flushEffects();

    harness.messageHandler({ origin: "https://evil.example", source: landingFrameWindow, data: { type: "lp-start", mode: "login" } });
    tree = harness.render();
    assert.equal(findElement(tree, (node) => node.props?.className === "lpModal lpModal--login"), null, "cross-origin messages cannot open authentication UI");

    harness.messageHandler({ origin: "https://app.example", source: {}, data: { type: "lp-start", mode: "login" } });
    tree = harness.render();
    assert.equal(findElement(tree, (node) => node.props?.className === "lpModal lpModal--login"), null, "same-origin messages from another sender cannot open authentication UI");

    harness.messageHandler({ origin: "https://app.example", source: landingFrameWindow, data: { type: "lp-start", mode: "login" } });
    tree = harness.render();
    assert.ok(findElement(tree, (node) => node.props?.className === "lpModal lpModal--login"), "the actual same-origin marketing iframe still opens the real login modal");
  } finally {
    restore();
  }
});
