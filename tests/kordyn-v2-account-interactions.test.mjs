import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-account-interactions");
const bundle = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(bundle, { force: true }); } catch { /* noop */ } });

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { runAccountAction, mobileDrilldownTransition } from "./src/kordynV2/domains/account/index.jsx";
      export { MobileAccountScreen } from "./src/kordynV2/domains/account/MobileAccountScreen.jsx";
      export { MobileMarketScreen } from "./src/kordynV2/domains/account/MobileMarketScreen.jsx";
      export { ReconciliationInspector } from "./src/kordynV2/domains/account/AccountWorkspace.jsx";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "lucide-react"],
  outfile: bundle,
  logLevel: "silent"
});

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { runAccountAction, mobileDrilldownTransition, MobileAccountScreen, MobileMarketScreen, ReconciliationInspector } = require(bundle);

function findElement(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (typeof node.type === "function") return findElement(node.type(node.props), predicate);
  if (predicate(node)) return node;
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

test("actual account action settlement closes sync throws and rejected promises without leaking thrown details", async () => {
  for (const run of [
    () => { throw new Error("OKX_SECRET=must-not-render"); },
    async () => { throw new Error("private credential must-not-render"); }
  ]) {
    const transitions = [];
    const outcome = await runAccountAction({ action: "reconcile", run, onTransition: (state) => transitions.push(state) });
    assert.deepEqual(outcome, { ok: false, error: "action_failed" });
    assert.deepEqual(transitions.map((state) => [state.kind, state.action]), [["processing", "reconcile"], ["result", "reconcile"]]);
    assert.equal(transitions[1].raw, null);
    assert.equal(transitions[1].presentation.message, "操作未完成，请重试或检查当前权限。");
    assert.doesNotMatch(JSON.stringify(transitions), /OKX_SECRET|private credential|must-not-render/);
  }
});

test("resolved account action raw outcomes remain exact while presenter copy is bounded and non-optimistic", async () => {
  const raw = Object.freeze({ ok: false, error: "server_internal_secret", metadata: { credential: "never render" } });
  const transitions = [];
  const outcome = await runAccountAction({ action: "watchlist", run: async () => raw, onTransition: (state) => transitions.push(state) });

  assert.equal(outcome, raw);
  assert.equal(transitions[1].raw, raw);
  assert.equal(transitions[1].presentation.message, "操作未完成，请重试或检查当前权限。");
  const html = renderToStaticMarkup(React.createElement(ReconciliationInspector, {
    reconciliation: { state: "loaded", loaded: true, latest: null },
    state: { kind: "ready", source: "OKX" },
    actionOutcome: transitions[1]
  }));
  assert.match(html, /操作未完成，请重试或检查当前权限/);
  assert.doesNotMatch(html, /server_internal_secret|never render/);
});

test("mobile drill-down state declares detail focus and Back restoration deterministically", () => {
  assert.deepEqual(mobileDrilldownTransition({ view: "list" }, "open"), { view: "detail", focus: "detail" });
  assert.deepEqual(mobileDrilldownTransition({ view: "detail" }, "back"), { view: "list", focus: "trigger" });
  assert.deepEqual(mobileDrilldownTransition({ view: "list" }, "reset"), { view: "list", focus: null });
});

test("real APP Market and Account details expose focusable headings and Back events", () => {
  const headingRef = { current: null };
  const events = [];
  const model = {
    availability: { markets: { state: "loaded", count: 1 }, watchlist: { state: "loaded", count: 0 }, accounts: { state: "loaded", count: 1 } },
    markets: [{ symbol: "BTC/USDT", price: 68000, changePct: 0 }],
    watchlist: [],
    accounts: [{ id: "ex-okx", label: "OKX", exchange: "OKX", status: "configured" }],
    reconciliation: { state: "loaded", loaded: true, latest: null }
  };
  const market = MobileMarketScreen({ model, state: { kind: "ready", source: "OKX", lastValidAt: "2026-08-30T06:00:00Z" }, selection: { object: { id: "BTC/USDT", type: "Market" } }, view: "detail", detailHeadingRef: headingRef, onOpenList: (event) => events.push(event) });
  const marketHeading = findElement(market, (node) => node.type === "h2" && node.props?.tabIndex === -1);
  const marketBack = findElement(market, (node) => node.type === "button" && String(node.props?.children?.[1] || "").includes("市场列表"));
  assert.equal(marketHeading?.ref, headingRef);
  marketBack.props.onClick({ currentTarget: "market-back" });

  const account = MobileAccountScreen({ model, state: { kind: "ready", source: "OKX", lastValidAt: "2026-08-30T06:00:00Z" }, view: "detail", detailHeadingRef: headingRef, onOpenList: (event) => events.push(event) });
  const accountHeading = findElement(account, (node) => node.type === "h2" && node.props?.tabIndex === -1);
  const accountBack = findElement(account, (node) => node.type === "button" && String(node.props?.children?.[1] || "").includes("账户健康"));
  assert.equal(accountHeading?.ref, headingRef);
  accountBack.props.onClick({ currentTarget: "account-back" });
  assert.deepEqual(events, [{ currentTarget: "market-back" }, { currentTarget: "account-back" }]);
});

test("APP list presenters bind the remounted initiating control for Back focus restoration", () => {
  const returnFocusRef = { current: null };
  const model = {
    availability: { markets: { state: "loaded", count: 1 }, watchlist: { state: "loaded", count: 0 }, accounts: { state: "loaded", count: 1 } },
    markets: [{ symbol: "BTC/USDT", price: 68000, changePct: 0 }],
    watchlist: [],
    accounts: [{ id: "ex-okx", label: "OKX", exchange: "OKX", status: "configured" }],
    reconciliation: { state: "loaded", loaded: true, latest: null }
  };
  const market = MobileMarketScreen({ model, selection: { object: { id: "BTC/USDT", type: "Market" } }, view: "list", returnFocusRef });
  const marketTrigger = findElement(market, (node) => node.type === "button" && node.props?.["data-kordyn-v2-object-id"] === "BTC/USDT");
  assert.equal(marketTrigger?.ref, returnFocusRef);

  const account = MobileAccountScreen({ model, view: "list", returnFocusRef });
  const accountTrigger = findElement(account, (node) => node.type === "button" && node.props?.className === "kordynV2MobileReconciliationLink");
  assert.equal(accountTrigger?.ref, returnFocusRef);
});

test("APP adverse resource states carry warning and critical tones", () => {
  const model = {
    availability: { markets: { state: "loaded", count: 1 }, watchlist: { state: "loaded", count: 0 }, accounts: { state: "loaded", count: 0 } },
    markets: [{ symbol: "BTC/USDT", price: 68000, changePct: 0 }],
    watchlist: [], accounts: [], reconciliation: { state: "loaded", loaded: true, latest: null }
  };
  const staleMarket = renderToStaticMarkup(React.createElement(MobileMarketScreen, { model, state: { kind: "stale" }, selection: { object: { id: "BTC/USDT", type: "Market" } }, view: "detail" }));
  const failedAccount = renderToStaticMarkup(React.createElement(MobileAccountScreen, { model, state: { kind: "failed" }, view: "list" }));
  assert.match(staleMarket, /data-resource-tone="warning"/);
  assert.match(failedAccount, /data-resource-tone="critical"/);
  assert.doesNotMatch(staleMarket, /data-resource-tone="healthy"/);
  assert.doesNotMatch(failedAccount, /data-resource-tone="healthy"/);
});

test("APP Market list renders bounded watchlist settlement without exposing raw failure details", () => {
  const html = renderToStaticMarkup(React.createElement(MobileMarketScreen, {
    model: {
      availability: { markets: { state: "loaded", count: 1 }, watchlist: { state: "loaded", count: 0 } },
      markets: [{ symbol: "BTC/USDT", price: 68000, changePct: 0 }], watchlist: []
    },
    view: "list",
    actionOutcome: {
      kind: "result", action: "watchlist",
      raw: { ok: false, error: "WATCHLIST_SECRET_NEVER_RENDER" },
      presentation: { tone: "critical", message: "操作未完成，请重试或检查当前权限。" }
    }
  }));
  assert.match(html, /role="status"[^>]*>操作未完成，请重试或检查当前权限/);
  assert.doesNotMatch(html, /WATCHLIST_SECRET_NEVER_RENDER/);
});
