import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-account-cockpit");
const componentBundle = path.join(cacheDir, `components-${process.pid}.cjs`);
const graphDir = path.join(cacheDir, `graph-${process.pid}`);

fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => {
  try { fs.rmSync(componentBundle, { force: true }); } catch { /* noop */ }
  try { fs.rmSync(graphDir, { force: true, recursive: true }); } catch { /* noop */ }
});

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { AccountWorkspace } from "./src/kordynV2/domains/account/AccountWorkspace.jsx";
      export { MarketWorkspace } from "./src/kordynV2/domains/account/MarketWorkspace.jsx";
      export { MobileAccountScreen } from "./src/kordynV2/domains/account/MobileAccountScreen.jsx";
      export { MobileMarketScreen } from "./src/kordynV2/domains/account/MobileMarketScreen.jsx";
      export { MarketInstrumentPicker } from "./src/kordynV2/domains/account/MarketInstrumentPicker.jsx";
      export { buildAccountDomainModel } from "./src/kordynV2/domains/account/accountModel.js";
      export { requestAccountReconciliation, requestWatchlistChange } from "./src/kordynV2/domains/account/index.jsx";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react/jsx-runtime", "lucide-react"],
  outfile: componentBundle,
  logLevel: "silent"
});

const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  AccountWorkspace,
  MarketWorkspace,
  MobileAccountScreen,
  MobileMarketScreen,
  MarketInstrumentPicker,
  buildAccountDomainModel,
  requestAccountReconciliation,
  requestWatchlistChange
} = require(componentBundle);

const data = Object.freeze({
  portfolio: Object.freeze({ totalEquityUsdt: 28_640.72, availableMarginUsdt: 13_870.1 }),
  positions: Object.freeze([]),
  markets: Object.freeze([
    Object.freeze({
      id: "market-btc",
      symbol: "BTC/USDT",
      price: 68_240.5,
      change24hPct: 1.84,
      high24h: 69_120,
      low24h: 66_910,
      quoteVolume: 482_000_000,
      source: "OKX public ticker",
      updatedAt: "2026-08-30T06:32:11.000Z"
    }),
    Object.freeze({
      id: "market-eth",
      symbol: "ETH/USDT",
      price: null,
      change24hPct: null,
      high24h: null,
      low24h: null,
      quoteVolume: null,
      source: "OKX public ticker",
      updatedAt: "2026-08-30T06:31:42.000Z"
    })
  ]),
  watchlist: Object.freeze(["BTC/USDT"]),
  reconciliationReports: Object.freeze([
    Object.freeze({
      id: "recon-20260830",
      status: "needs_attention",
      severity: "high",
      createdAt: "2026-08-30T06:30:00.000Z",
      differences: Object.freeze([
        Object.freeze({ type: "size_mismatch", severity: "high", message: "BTC position size differs" })
      ])
    })
  ])
});
const model = buildAccountDomainModel(data);
const truth = Object.freeze({
  mode: "full",
  equity: 28_640.72,
  available: 13_870.1,
  exposure: 0,
  risk: "normal",
  runtime: "full_auto_small",
  freshness: "2026-08-30T06:32:11.000Z"
});
const readyState = Object.freeze({
  kind: "ready",
  source: "OKX cockpit",
  lastValidAt: "2026-08-30T06:32:11.000Z"
});
const marketSelection = Object.freeze({ object: Object.freeze({ id: "BTC/USDT", type: "Market" }) });

const baseProps = Object.freeze({
  model,
  truth,
  state: readyState,
  selection: marketSelection,
  actions: Object.freeze({}),
  actionsDisabled: false,
  actionOutcome: null,
  onSelect: () => {},
  onReconcile: () => {},
  onWatchlistChange: () => {},
  onOpenList: () => {}
});

const render = (Component, props = {}) => renderToStaticMarkup(React.createElement(Component, { ...baseProps, ...props }));

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

test("Desktop account and market surfaces expose full authoritative truth, reconciliation, and selected-market provenance", () => {
  const account = render(AccountWorkspace);
  const market = render(MarketWorkspace);

  assert.match(account, /data-kordyn-v2-truth-mode="full"/);
  assert.match(account, /对账|Reconciliation/);
  assert.match(account, /recon-20260830/);
  assert.match(account, /2026-08-30T06:30:00.000Z/);
  assert.match(market, /data-kordyn-v2-object-type="Market"/);
  assert.match(market, /BTC\/USDT/);
  assert.match(market, /OKX public ticker/);
  assert.match(market, /2026-08-30T06:32:11.000Z/);
  assert.match(market, /数据截至|As of/);
});

test("Market and Account controls emit only canonical Root selection payloads", () => {
  const selected = [];
  const picker = MarketInstrumentPicker({
    markets: model.markets,
    watchlist: model.watchlist,
    selectedId: "BTC/USDT",
    actionsDisabled: false,
    onSelect: (candidate) => selected.push(candidate),
    onWatchlistChange: () => {}
  });
  const marketButton = findElement(picker, (node) => node.props?.["data-kordyn-v2-object-id"] === "ETH/USDT");
  assert.ok(marketButton);
  marketButton.props.onClick();
  assert.deepEqual(selected[0], { id: "ETH/USDT", type: "Market", workspaceId: "account", route: "market", sourceSection: "cockpit" });

  const accountSelection = Object.freeze({ object: Object.freeze({ id: "ex_okx_main", type: "Account" }) });
  const accountTree = AccountWorkspace({ ...baseProps, selection: accountSelection, onSelect: (candidate) => selected.push(candidate) });
  const accountButton = findElement(accountTree, (node) => node.props?.["data-kordyn-v2-object-type"] === "Account");
  assert.ok(accountButton);
  accountButton.props.onClick();
  assert.deepEqual(selected[1], { id: "ex_okx_main", type: "Account" });
});

test("unavailable market and account facts never render as fabricated zero", () => {
  const missingModel = buildAccountDomainModel({ markets: [{ symbol: "ETH/USDT" }] });
  const missingTruth = { mode: "full", equity: null, available: null, exposure: null };
  const market = render(MarketWorkspace, {
    model: missingModel,
    truth: missingTruth,
    state: { kind: "ready", source: "Unavailable", lastValidAt: "Unavailable" },
    selection: { object: { id: "ETH/USDT", type: "Market" } }
  });
  const account = render(AccountWorkspace, { model: missingModel, truth: missingTruth });

  assert.match(market, /Unavailable/);
  assert.match(account, /Unavailable/);
  assert.match(market, /24h 高点<\/dt><dd>Unavailable<\/dd>/);
  assert.match(market, /账户权益<\/dt><dd>Unavailable<\/dd>/);
  assert.match(account, /总权益<\/dt><dd>Unavailable<\/dd>/);
  assert.match(account, /未实现盈亏<\/dt><dd>Unavailable<\/dd>/);
});

test("watchlist and reconciliation helpers preserve raw outcomes and fail closed while actions are disabled", async () => {
  const calls = [];
  const addOutcome = Object.freeze({ ok: true, watchlist: ["BTC/USDT", "ETH/USDT"] });
  const removeOutcome = Object.freeze({ ok: false, error: "write_conflict" });
  const reconcileOutcome = Object.freeze({ ok: true, reportId: "recon-next", status: "processing" });
  const actions = {
    addWatchlist: async (symbol) => { calls.push(["add", symbol]); return addOutcome; },
    removeWatchlist: async (symbol) => { calls.push(["remove", symbol]); return removeOutcome; },
    reconcile: async () => { calls.push(["reconcile"]); return reconcileOutcome; }
  };

  assert.equal(await requestWatchlistChange(actions, "ETH/USDT", false, false), addOutcome);
  assert.equal(await requestWatchlistChange(actions, "BTC/USDT", true, false), removeOutcome);
  assert.equal(await requestAccountReconciliation(actions, false), reconcileOutcome);
  assert.deepEqual(calls, [["add", "ETH/USDT"], ["remove", "BTC/USDT"], ["reconcile"]]);

  assert.deepEqual(await requestWatchlistChange(actions, "SOL/USDT", false, true), { ok: false, error: "action_disabled" });
  assert.deepEqual(await requestAccountReconciliation(actions, true), { ok: false, error: "action_disabled" });
  assert.equal(calls.length, 3);
});

test("disabled mutation controls stay disabled while source and as-of remain visible", () => {
  const market = render(MarketWorkspace, { actionsDisabled: true });
  const account = render(AccountWorkspace, { actionsDisabled: true });

  assert.match(market, /data-kordyn-v2-watchlist-action[^>]*disabled/);
  assert.match(account, /data-kordyn-v2-reconcile-action[^>]*disabled/);
  assert.match(market, /OKX public ticker/);
  assert.match(market, /2026-08-30T06:32:11.000Z/);
});

test("APP market and account presenters use separate list and detail drill-down compositions", () => {
  const marketList = render(MobileMarketScreen, { view: "list", selection: null });
  const marketDetail = render(MobileMarketScreen, { view: "detail" });
  const accountList = render(MobileAccountScreen, { view: "list", selection: null });
  const accountDetail = render(MobileAccountScreen, { view: "detail" });

  assert.match(marketList, /data-kordyn-v2-mobile-market-view="list"/);
  assert.doesNotMatch(marketList, /data-kordyn-v2-mobile-market-analytic/);
  assert.match(marketDetail, /data-kordyn-v2-mobile-market-view="detail"/);
  assert.match(marketDetail, /data-kordyn-v2-mobile-market-analytic/);
  assert.match(accountList, /data-kordyn-v2-mobile-account-view="list"/);
  assert.doesNotMatch(accountList, /data-kordyn-v2-mobile-reconciliation-detail/);
  assert.match(accountDetail, /data-kordyn-v2-mobile-account-view="detail"/);
  assert.match(accountDetail, /data-kordyn-v2-mobile-reconciliation-detail/);

  for (const html of [marketList, marketDetail, accountList, accountDetail]) {
    assert.match(html, /<button[^>]*type="button"/);
  }
});

test("Root lazy-loads account UI and account CSS stays owned by that dynamic domain", () => {
  const result = require("esbuild").buildSync({
    entryPoints: [path.join(rootDir, "src/kordynV2/KordynV2Root.jsx")],
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    metafile: true,
    loader: { ".css": "css" },
    outdir: graphDir,
    write: false,
    logLevel: "silent"
  });
  const outputs = Object.values(result.metafile.outputs);
  const dynamicImports = outputs.flatMap((output) => output.imports || []).filter((item) => item.kind === "dynamic-import");
  const accountEntryOutput = outputs.find((output) => Object.hasOwn(output.inputs || {}, "src/kordynV2/domains/account/index.jsx"));
  const accountCssInput = "src/kordynV2/domains/account/account.css";
  const sharedTargets = [
    "src/kordynV2/KordynV2Root.jsx",
    "src/kordynV2/styles/shell.css",
    "src/kordynV2/styles/mobile-shell.css"
  ].map((file) => fs.readFileSync(path.join(rootDir, file), "utf8"));

  assert.equal(dynamicImports.length, 2);
  assert.ok(accountEntryOutput, "expected a distinct lazy account entry output");
  assert.ok(Object.hasOwn(accountEntryOutput.inputs, accountCssInput));
  assert.equal(sharedTargets.some((source) => /account\.css/.test(source)), false);
});

test("account CSS carries touch, responsive, focus, and reduced-motion safeguards", () => {
  const css = fs.readFileSync(path.join(rootDir, "src/kordynV2/domains/account/account.css"), "utf8");
  assert.match(css, /\.kordynV2AccountMobile[^{}]*(?:button|Action)[^{}]*\{[^}]*min-(?:block-size|height):\s*44px/s);
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media\s*\([^)]*max-width:\s*430px\)/);
  assert.match(css, /@media\s*\([^)]*max-width:\s*390px\)/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(css, /!important|overflow-x\s*:\s*(?:auto|scroll)|(?:^|[;{])\s*min-width\s*:\s*(?:[4-9]\d\d|\d{4,})px/m);
});
