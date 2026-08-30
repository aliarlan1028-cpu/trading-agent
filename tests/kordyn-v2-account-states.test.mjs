import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { load } from "cheerio";
import { assertStateContract } from "./helpers/kordyn-v2-state-contract.mjs";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-account-states");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });

require("esbuild").buildSync({
  stdin: {
    contents: `
      export { DEPLOYED_FEATURES } from "./src/productCoverage.js";
      export { ACCOUNT_CAPABILITY_SURFACES } from "./src/kordynV2/domains/account/capabilitySurfaces.js";
      export { ACCOUNT_STATE_SURFACES } from "./src/kordynV2/domains/account/stateSurfaces.js";
      export { KORDYN_V2_CAPABILITY_OWNERSHIP } from "./src/kordynV2/architecture/capabilityOwnership.js";
      export { KORDYN_V2_WORKSPACES } from "./src/kordynV2/architecture/domains.js";
      export { renderToStaticMarkup } from "react-dom/server";
    `,
    resolveDir: rootDir,
    loader: "jsx"
  },
  bundle: true,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime", "lucide-react"],
  outfile: outFile,
  logLevel: "silent"
});

const {
  ACCOUNT_CAPABILITY_SURFACES,
  ACCOUNT_STATE_SURFACES,
  DEPLOYED_FEATURES,
  KORDYN_V2_CAPABILITY_OWNERSHIP,
  KORDYN_V2_WORKSPACES,
  renderToStaticMarkup
} = require(outFile);

const EXPECTED_LIVE_CAPABILITIES = Object.freeze([
  "live.overview",
  "live.market",
  "live.account",
  "live.positions",
  "live.execution",
  "live.orders",
  "live.fills",
  "live.protection",
  "live.reconcile-status",
  "live.review-status",
  "live.closed-trade-poster"
]);

const EXPECTED_STATES = Object.freeze([
  "loading",
  "empty",
  "processing",
  "stale",
  "degraded",
  "failed",
  "forbidden",
  "disabled",
  "approval",
  "partial",
  "no-result",
  "long-content",
  "large-list"
]);

const accountStateFixture = Object.freeze({
  source: "Task 5 account bounded production-shaped authority",
  lastValidAt: "2026-08-30T00:12:00.000Z",
  missingFinanceLabel: "Unavailable",
  authoritativeZero: 0,
  completedEffects: Object.freeze([
    Object.freeze({ id: "effect-reconcile-ledger", label: "reconciliation ledger persisted" }),
    Object.freeze({ id: "effect-review-linked", label: "review link verified" })
  ]),
  failedEffects: Object.freeze([
    Object.freeze({ id: "effect-entry-order", label: "entry order rejected by stale capacity" })
  ]),
  longContent: "完整账户证据、仓位保护、订单回执、成交与复盘链路。".repeat(90),
  largeList: Object.freeze(Array.from({ length: 64 }, (_, index) => Object.freeze({
    id: `account-object-${index + 1}`,
    label: `权威账户对象 ${index + 1}`
  })))
});

test("account domain owns all eleven deployed live capabilities through concrete two-device surfaces", () => {
  const ids = DEPLOYED_FEATURES.filter((row) => row.id.startsWith("live.")).map((row) => row.id);
  assert.deepEqual(ids, EXPECTED_LIVE_CAPABILITIES);
  assert.deepEqual(Object.keys(ACCOUNT_CAPABILITY_SURFACES), EXPECTED_LIVE_CAPABILITIES);

  for (const id of ids) {
    const surface = ACCOUNT_CAPABILITY_SURFACES[id];
    assert.equal(surface.id, id, `${id}: canonical id`);
    assert.equal(surface.domainId, "account", `${id}: account domain`);
    assert.deepEqual(
      { domainId: surface.domainId, workspaceId: surface.workspaceId },
      KORDYN_V2_CAPABILITY_OWNERSHIP[id],
      `${id}: capability ownership`
    );
    const workspace = KORDYN_V2_WORKSPACES.account.find((row) => row.id === surface.workspaceId);
    assert.ok(workspace, `${id}: registered account workspace`);
    assert.equal(surface.route, workspace.legacyRoute, `${id}: real legacy route`);
    assert.ok(surface.objectIdentity, `${id}: object identity`);
    assert.ok(surface.actionBoundary, `${id}: action boundary`);
    assert.ok(surface.permissionBoundary, `${id}: permission boundary`);
    assert.ok(surface.resourceStateBoundary, `${id}: resource-state boundary`);
    assert.equal(typeof surface.desktop?.component, "function", `${id}: Desktop component`);
    assert.equal(typeof surface.mobile?.component, "function", `${id}: APP component`);
    assert.ok(surface.desktop?.entry, `${id}: Desktop entry`);
    assert.ok(surface.mobile?.entry, `${id}: APP entry`);
  }

  assert.match(ACCOUNT_CAPABILITY_SURFACES["live.orders"].actionBoundary, /no cancel or amend action exists/i);
  const serialized = JSON.stringify(ACCOUNT_CAPABILITY_SURFACES);
  assert.doesNotMatch(serialized, /automatic telegram|automatic delivery|client-side poster|translate poster/i);
});

test("account state facts never turn missing finance into authoritative zero", () => {
  const markup = renderToStaticMarkup(ACCOUNT_STATE_SURFACES.loading({
    missingFinanceLabel: "Unavailable"
  }));
  const $ = load(markup);
  const zero = $("[data-kordyn-v2-finance-zero]");
  assert.equal(zero.attr("data-kordyn-v2-finance-zero"), "Unavailable");
  assert.equal(zero.attr("data-kordyn-v2-finance-zero-available"), "false");
  assert.equal(zero.text(), "Unavailable");

  const zeroMarkup = renderToStaticMarkup(ACCOUNT_STATE_SURFACES.loading({
    missingFinanceLabel: "Unavailable",
    authoritativeZero: 0
  }));
  const zero$ = load(zeroMarkup);
  const authoritative = zero$("[data-kordyn-v2-finance-zero]");
  assert.equal(authoritative.attr("data-kordyn-v2-finance-zero"), "0");
  assert.equal(authoritative.attr("data-kordyn-v2-finance-zero-available"), "true");
  assert.equal(authoritative.text(), "0");
});

test("account state surfaces sanitize hostile fields and keep bounded accepted lists complete", () => {
  const longContent = "完整账户证据。".repeat(3_000);
  const largeList = Array.from({ length: 64 }, (_, index) => ({
    id: `safe-${index + 1}`,
    label: index === 12 ? "<img src=x onerror=alert(1)>" : `权威账户对象 ${index + 1}`
  }));
  const hostileMarkup = renderToStaticMarkup(ACCOUNT_STATE_SURFACES["large-list"]({
    source: { toString: () => "unsafe" },
    lastValidAt: null,
    missingFinanceLabel: "<script>alert(1)</script>",
    authoritativeZero: Number.NaN,
    longContent,
    largeList
  }));
  assert.doesNotMatch(hostileMarkup, /<script|onerror=/i);
  assert.doesNotMatch(hostileMarkup, /&lt;script|&lt;img/i);
  assert.match(hostileMarkup, /safe-13/);
  const $ = load(hostileMarkup);
  assert.equal($("[data-kordyn-v2-large-list-count]").attr("data-kordyn-v2-large-list-count"), "64");
  assert.equal($("[data-kordyn-v2-large-list-count]").attr("data-kordyn-v2-large-list-complete"), "true");
  assert.equal($("[data-kordyn-v2-large-list-count] li").length, 64);

  const contentMarkup = renderToStaticMarkup(ACCOUNT_STATE_SURFACES["long-content"]({ longContent }));
  assert.ok(contentMarkup.length < 25_000, "oversized long content remains bounded for evidence rendering");
  assert.match(contentMarkup, /data-kordyn-v2-long-content-bounded="true"/);
  assert.match(contentMarkup, /完整账户证据。/);

  const oversized = Array.from({ length: 180 }, (_, index) => ({ id: `big-${index + 1}`, label: `对象 ${index + 1}` }));
  const oversizedMarkup = renderToStaticMarkup(ACCOUNT_STATE_SURFACES["large-list"]({ largeList: oversized }));
  const list$ = load(oversizedMarkup);
  assert.equal(list$("[data-kordyn-v2-large-list-count]").attr("data-kordyn-v2-large-list-count"), "96");
  assert.equal(list$("[data-kordyn-v2-large-list-count]").attr("data-kordyn-v2-large-list-source-count"), "180");
  assert.equal(list$("[data-kordyn-v2-large-list-count]").attr("data-kordyn-v2-large-list-complete"), "false");
  assert.equal(list$("[data-kordyn-v2-large-list-disclosure]").attr("data-kordyn-v2-large-list-shown-count"), "96");
  assert.equal(list$("[data-kordyn-v2-large-list-disclosure]").attr("data-kordyn-v2-large-list-source-count"), "180");
  assert.match(list$("[data-kordyn-v2-large-list-disclosure]").text(), /96\s*\/\s*180/);
  assert.match(list$("[data-kordyn-v2-large-list-disclosure]").text(), /不完整|边界/);
  assert.equal(list$("[data-kordyn-v2-large-list-count] li").length, 96);
});

test("account state surfaces read only own data descriptors and isolate hostile collection items", () => {
  const topLevel = Object.create(null);
  Object.defineProperties(topLevel, {
    source: { enumerable: true, get() { throw new Error("TOP_LEVEL_SOURCE_SECRET"); } },
    lastValidAt: { enumerable: true, value: "2026-08-30T00:12:00.000Z" },
    authoritativeZero: { enumerable: true, get() { throw new Error("TOP_LEVEL_ZERO_SECRET"); } },
    missingFinanceLabel: { enumerable: true, value: "Unavailable" }
  });
  assert.doesNotThrow(() => renderToStaticMarkup(ACCOUNT_STATE_SURFACES.stale(topLevel)));
  const topMarkup = renderToStaticMarkup(ACCOUNT_STATE_SURFACES.stale(topLevel));
  assert.doesNotMatch(topMarkup, /TOP_LEVEL_(?:SOURCE|ZERO)_SECRET/);
  assert.match(topMarkup, /Task 5 account bounded production-shaped authority/);
  assert.match(topMarkup, /data-kordyn-v2-finance-zero="Unavailable"/);

  const validCompleted = Object.freeze({ id: "effect-valid", label: "valid completed sibling" });
  const validFailed = Object.freeze({ id: "effect-failed", label: "valid failed sibling" });
  const throwingItem = Object.create(null);
  Object.defineProperties(throwingItem, {
    id: { enumerable: true, get() { throw new Error("ITEM_ID_SECRET"); } },
    label: { enumerable: true, get() { throw new Error("ITEM_LABEL_SECRET"); } }
  });
  const revoked = Proxy.revocable({ id: "revoked", label: "REVOKED_SECRET" }, {});
  revoked.revoke();
  const partialFacts = {
    completedEffects: [null, throwingItem, revoked.proxy, Symbol("SYMBOL_SECRET"), validCompleted],
    failedEffects: [throwingItem, validFailed]
  };
  assert.doesNotThrow(() => renderToStaticMarkup(ACCOUNT_STATE_SURFACES.partial(partialFacts)));
  const partialMarkup = renderToStaticMarkup(ACCOUNT_STATE_SURFACES.partial(partialFacts));
  assert.match(partialMarkup, /valid completed sibling/);
  assert.match(partialMarkup, /valid failed sibling/);
  assert.doesNotMatch(partialMarkup, /ITEM_(?:ID|LABEL)_SECRET|REVOKED_SECRET|SYMBOL_SECRET/);

  const largeRows = [
    Object.freeze({ id: "safe-before", label: "safe before" }),
    throwingItem,
    revoked.proxy,
    Symbol("ROW_SYMBOL_SECRET"),
    Object.freeze({ id: "safe-after", label: "safe after" })
  ];
  assert.doesNotThrow(() => renderToStaticMarkup(ACCOUNT_STATE_SURFACES["large-list"]({ largeList: largeRows })));
  const listMarkup = renderToStaticMarkup(ACCOUNT_STATE_SURFACES["large-list"]({ largeList: largeRows }));
  assert.match(listMarkup, /safe before/);
  assert.match(listMarkup, /safe after/);
  assert.doesNotMatch(listMarkup, /ITEM_(?:ID|LABEL)_SECRET|REVOKED_SECRET|ROW_SYMBOL_SECRET/);

  const revokedTop = Proxy.revocable({ source: "REVOKED_TOP_SECRET" }, {});
  revokedTop.revoke();
  assert.doesNotThrow(() => renderToStaticMarkup(ACCOUNT_STATE_SURFACES.degraded(revokedTop.proxy)));
  assert.doesNotMatch(renderToStaticMarkup(ACCOUNT_STATE_SURFACES.degraded(revokedTop.proxy)), /REVOKED_TOP_SECRET/);
});

for (const state of EXPECTED_STATES) {
  test(`account renders ${state} without falsifying trading facts`, () => {
    const renderState = ACCOUNT_STATE_SURFACES[state];
    assert.equal(typeof renderState, "function", state);
    const markup = renderToStaticMarkup(renderState(accountStateFixture));
    assertStateContract(markup, state);
    assert.doesNotMatch(markup, /undefined|\bNaN\b|optimistic success|执行成功|已成功执行|交易成功/i);

    const $ = load(markup);
    const root = $(`[data-kordyn-v2-state="${state}"]`);
    assert.equal(root.find("[data-kordyn-v2-finance-missing]").attr("data-kordyn-v2-finance-missing"), "Unavailable");
    assert.equal(root.find("[data-kordyn-v2-finance-zero]").attr("data-kordyn-v2-finance-zero"), "0");

    if (["stale", "degraded"].includes(state)) {
      assert.match(markup, /data-kordyn-v2-actions-disabled="true"/);
      assert.match(markup, /Task 5 account bounded production-shaped authority/);
      assert.match(markup, /2026-08-30T00:12:00.000Z/);
    } else {
      assert.doesNotMatch(markup, /data-kordyn-v2-last-valid-source=/);
    }

    if (state === "partial") {
      assert.equal(root.find("[data-kordyn-v2-partial-completed] li").length, 2);
      assert.equal(root.find("[data-kordyn-v2-partial-failed] li").length, 1);
      assert.match(root.find("[data-kordyn-v2-partial-failed]").text(), /entry order rejected/);
    }
    if (state === "long-content") assert.match(markup, /完整账户证据、仓位保护、订单回执、成交与复盘链路。/);
    if (state === "large-list") {
      assert.match(markup, /data-kordyn-v2-large-list-count="64"/);
      assert.match(markup, /权威账户对象 1/);
      assert.match(markup, /权威账户对象 64/);
    }
  });
}

test("account presenters do not read raw Root data directly", () => {
  const files = [
    "AccountWorkspace.jsx",
    "MarketWorkspace.jsx",
    "MobileAccountScreen.jsx",
    "MobileExecutionScreen.jsx",
    "MobileMarketScreen.jsx",
    "MobilePositionScreen.jsx",
    "PlanWorkspace.jsx",
    "OrderWorkspace.jsx",
    "FillWorkspace.jsx",
    "PositionWorkspace.jsx"
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(rootDir, "src/kordynV2/domains/account", file), "utf8");
    assert.doesNotMatch(source, /\bdata\./, `${file} must consume account model, not raw root data`);
    assert.doesNotMatch(source, /props\.data/, `${file} must consume account model, not raw root data`);
  }
});

test("V2 ConfirmHost styles are scoped away from public login and legacy product surfaces", () => {
  const source = fs.readFileSync(path.join(rootDir, "src/kordynV2/styles/shell.css"), "utf8");
  const selectors = source
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("{")
    .slice(0, -1)
    .map((chunk) => chunk.split("}").pop().trim())
    .filter((selector) => selector.includes(".cfm"));
  assert.ok(selectors.length >= 6, "V2 shell owns the ConfirmHost overlay, card, text, footer, buttons, and focus state");
  for (const selector of selectors) {
    for (const part of selector.split(",").map((item) => item.trim()).filter(Boolean)) {
      if (part.startsWith("@")) continue;
      assert.match(part, /^body:has\(\.kordynV2Root\)\s+\.cfm/u, `unscoped ConfirmHost selector would affect public/login surfaces: ${part}`);
    }
  }
});
