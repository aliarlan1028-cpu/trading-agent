import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(rootDir, "node_modules", ".cache", "kordyn-v2-account-model");
const outFile = path.join(cacheDir, `bundle-${process.pid}.cjs`);
fs.mkdirSync(cacheDir, { recursive: true });
process.on("exit", () => { try { fs.rmSync(outFile, { force: true }); } catch { /* noop */ } });
require("esbuild").buildSync({
  stdin: {
    contents: `export { buildAccountDomainModel } from "./src/kordynV2/domains/account/accountModel.js";`,
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
const { buildAccountDomainModel } = require(outFile);

test("account model preserves authoritative totals and canonical position identity", () => {
  const data = {
    portfolio: { totalEquityUsdt: 10240.5, availableMarginUsdt: 7130 },
    positions: [
      { positionId: "position-native", symbol: "BTC/USDT", quantity: 0.01, mark: 60000, unrealizedPnl: 12, margin: 60 },
      { instId: "ETH-USDT-SWAP", symbol: "ETH/USDT", size: 0.5, markPrice: 3000, upl: -5, initialMargin: 300 },
      { id: "canonical-id", positionId: "ignored-position-id", instId: "IGNORED-SWAP", symbol: "SOL/USDT", notionalUsdt: 100, pnl: 0, margin: 10 }
    ],
    markets: [{ symbol: "BTC/USDT", last: 60000, change24hPct: 2.5, quoteVolume: 90 }],
    executionOrders: [{ id: "eo-1", status: "entry_pending", symbol: "BTC/USDT" }],
    tradeDataStatus: { fillTotal: 80 },
    fills: [{ id: "visible-fill", createdAt: "2026-08-26T10:00:00Z" }],
    closedTradeLifecycles: [{ id: "closed:eo-0", executionOrderId: "eo-0", netRealizedPnl: 9 }]
  };
  const before = structuredClone(data);

  const model = buildAccountDomainModel(data);

  assert.equal(model.truth.equity, 10240.5);
  assert.equal(model.truth.available, 7130);
  assert.deepEqual(
    { exposure: model.truth.exposure, unrealizedPnl: model.truth.unrealizedPnl, margin: model.truth.margin },
    { exposure: 2200, unrealizedPnl: 7, margin: 370 }
  );
  assert.deepEqual(model.positions.map((row) => row.id), ["position-native", "ETH-USDT-SWAP", "canonical-id"]);
  assert.equal(model.markets[0].price, 60000);
  assert.equal(model.execution.orders[0].exitAction.intent, "cancel_entry");
  assert.equal(model.execution.totals.fills, 80);
  assert.equal(model.fills.length, 1);
  assert.equal(model.closedTrades[0].id, "closed:eo-0");
  assert.deepEqual(data, before, "the domain projection must not mutate published production data");
  assert.equal(Object.hasOwn(data.positions[0], "id"), false);
});

test("unloaded lifecycle data is not reconstructed from bounded fills", () => {
  const model = buildAccountDomainModel({
    fills: [{ id: "f-1", kind: "close", realizedPnl: 9 }]
  });

  assert.equal(model.execution.lifecycleState, "not_loaded");
  assert.deepEqual(model.execution.closedTrades, []);
  assert.deepEqual(model.closedTrades, []);
});

test("latest reconciliation is projected from the source-backed cockpit report without inventing success", () => {
  const model = buildAccountDomainModel({
    reconciliationReports: [
      {
        id: "recon-older",
        status: "ok",
        severity: "low",
        createdAt: "2026-08-26T09:00:00.000Z",
        differences: []
      },
      {
        id: "recon-newer",
        status: "needs_attention",
        severity: "high",
        createdAt: "2026-08-26T10:00:00.000Z",
        differences: [{ type: "size_mismatch", severity: "high", message: "Position size differs" }]
      }
    ]
  });

  assert.deepEqual(model.reconciliation, {
    loaded: true,
    latest: {
      id: "recon-newer",
      status: "needs_attention",
      severity: "high",
      createdAt: "2026-08-26T10:00:00.000Z",
      differenceCount: 1,
      differences: [{ type: "size_mismatch", severity: "high", message: "Position size differs" }]
    }
  });
  assert.equal(model.reconciliation.latest.status === "ok", false);
});

test("missing and hostile reconciliation inputs remain bounded and unavailable", () => {
  assert.deepEqual(buildAccountDomainModel({}).reconciliation, { loaded: false, latest: null });
  assert.deepEqual(buildAccountDomainModel({ reconciliationReports: [] }).reconciliation, { loaded: true, latest: null });

  const model = buildAccountDomainModel({
    reconciliationReports: [
      null,
      {
        id: "recon-safe",
        status: "degraded",
        createdAt: "2026-08-26T10:00:00.000Z",
        differences: [
          null,
          { type: "snapshot_sync_error", severity: "medium", message: "Private snapshot is unavailable" },
          { type: Symbol("hostile"), severity: "high", message: "must not render" }
        ]
      }
    ]
  });

  assert.deepEqual(model.reconciliation, {
    loaded: true,
    latest: {
      id: "recon-safe",
      status: "degraded",
      severity: null,
      createdAt: "2026-08-26T10:00:00.000Z",
      differenceCount: 3,
      differences: [{ type: "snapshot_sync_error", severity: "medium", message: "Private snapshot is unavailable" }]
    }
  });
});

test("missing position and portfolio financial values remain unavailable instead of selector fallback zero", () => {
  const model = buildAccountDomainModel({
    portfolio: { totalEquityUsdt: null },
    positions: [
      { positionId: "position-only", symbol: "BTC/USDT", quantity: 0.01 },
      { instId: "ETH-USDT-SWAP", symbol: "ETH/USDT", size: 1, markPrice: 3000 }
    ]
  });

  assert.deepEqual(model.positions.map((row) => row.id), ["position-only", "ETH-USDT-SWAP"]);
  assert.deepEqual(model.truth, {
    equity: null,
    available: null,
    exposure: null,
    unrealizedPnl: null,
    margin: null
  });
});

test("authoritative empty and zero financial facts remain zero", () => {
  const model = buildAccountDomainModel({
    portfolio: { totalEquityUsdt: 0, availableMarginUsdt: 0 },
    positions: []
  });

  assert.deepEqual(model.truth, {
    equity: 0,
    available: 0,
    exposure: 0,
    unrealizedPnl: 0,
    margin: 0
  });
});

test("symbol is the final canonical position identity fallback and frozen sources are not mutated", () => {
  const position = Object.freeze({
    symbol: "SOL/USDT",
    quantity: 2,
    markPrice: 50,
    unrealizedPnl: 3,
    margin: 20
  });
  const positions = Object.freeze([position]);
  const data = Object.freeze({ positions });

  const model = buildAccountDomainModel(data);

  assert.deepEqual(model.positions.map((row) => row.id), ["SOL/USDT"]);
  assert.deepEqual(model.truth, {
    equity: null,
    available: null,
    exposure: 100,
    unrealizedPnl: 3,
    margin: 20
  });
  assert.equal(Object.isFrozen(data), true);
  assert.equal(Object.isFrozen(positions), true);
  assert.equal(Object.hasOwn(position, "id"), false);
});

test("malformed, id-less, and hostile-ID siblings are isolated from a valid position", () => {
  const hostileId = {
    positionId: "must-not-fall-through",
    symbol: "XRP/USDT",
    quantity: 100,
    markPrice: 1,
    unrealizedPnl: 99,
    margin: 99
  };
  Object.defineProperty(hostileId, "id", {
    enumerable: true,
    get() { throw new Error("hostile id getter"); }
  });
  const data = {
    positions: [
      null,
      [],
      "not-a-position",
      { quantity: 5, markPrice: 10, unrealizedPnl: 8, margin: 4 },
      hostileId,
      { positionId: "position-valid", quantity: 0.5, markPrice: 200, unrealizedPnl: 7, margin: 25 }
    ]
  };

  let model;
  assert.doesNotThrow(() => { model = buildAccountDomainModel(data); });
  assert.deepEqual(model.positions.map((row) => row.id), ["position-valid"]);
  assert.deepEqual(model.truth, {
    equity: null,
    available: null,
    exposure: 100,
    unrealizedPnl: 7,
    margin: 25
  });
  assert.equal(Object.getOwnPropertyDescriptor(hostileId, "id").get instanceof Function, true);
});

test("duplicate canonical identities are ambiguous without hiding a unique valid sibling", () => {
  const model = buildAccountDomainModel({
    positions: [
      { id: "duplicate", positionId: "lower-a", quantity: 1, markPrice: 100, unrealizedPnl: 10, margin: 10 },
      { id: "duplicate", positionId: "lower-b", quantity: 2, markPrice: 100, unrealizedPnl: 20, margin: 20 },
      { instId: "UNIQUE-SWAP", quantity: 3, markPrice: 100, unrealizedPnl: 30, margin: 30 }
    ]
  });

  assert.deepEqual(model.positions.map((row) => row.id), ["UNIQUE-SWAP"]);
  assert.deepEqual(
    { exposure: model.truth.exposure, unrealizedPnl: model.truth.unrealizedPnl, margin: model.truth.margin },
    { exposure: 300, unrealizedPnl: 30, margin: 30 }
  );
});

test("hostile position containers and accessors fail closed without throwing", () => {
  const revocable = Proxy.revocable([], {});
  revocable.revoke();
  let revokedModel;
  assert.doesNotThrow(() => { revokedModel = buildAccountDomainModel({ positions: revocable.proxy }); });
  assert.deepEqual(revokedModel.positions, []);
  assert.deepEqual(
    { exposure: revokedModel.truth.exposure, unrealizedPnl: revokedModel.truth.unrealizedPnl, margin: revokedModel.truth.margin },
    { exposure: null, unrealizedPnl: null, margin: null }
  );

  const accessorRoot = {};
  Object.defineProperty(accessorRoot, "positions", {
    enumerable: true,
    get() { throw new Error("hostile positions getter"); }
  });
  assert.doesNotThrow(() => buildAccountDomainModel(accessorRoot));
  assert.deepEqual(buildAccountDomainModel(accessorRoot).positions, []);
});

const validPositionSibling = () => ({
  positionId: "position-valid",
  quantity: 0.5,
  markPrice: 200,
  unrealizedPnl: 7,
  margin: 25
});

function positionWithScalar(field, value) {
  const position = { positionId: `hostile-${field}` };
  if (["quantity", "size", "pos", "qty"].includes(field)) {
    position[field] = value;
    position.markPrice = 100;
  } else if (["notional", "notionalUsdt", "marketValue"].includes(field)) {
    position.quantity = 1;
    position.markPrice = 100;
    position[field] = value;
  } else if (["markPrice", "mark", "price", "entryPrice", "entry"].includes(field)) {
    position.quantity = 1;
    position[field] = value;
  } else {
    position.quantity = 1;
    position.markPrice = 100;
    position[field] = value;
  }
  if (!["unrealizedPnl", "pnl", "upl"].includes(field)) position.unrealizedPnl = 1;
  if (!["margin", "initialMargin"].includes(field)) position.margin = 1;
  return position;
}

test("hostile quantity values are isolated before shared selector coercion", async (t) => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const throwingCoercion = {
    valueOf() { throw new Error("must not coerce position quantity"); },
    toString() { throw new Error("must not stringify position quantity"); }
  };
  const cases = [
    ["symbol", Symbol("quantity")],
    ["revoked proxy", revoked.proxy],
    ["throwing coercion", throwingCoercion]
  ];

  for (const [label, value] of cases) {
    await t.test(label, () => {
      let model;
      assert.doesNotThrow(() => {
        model = buildAccountDomainModel({
          positions: [positionWithScalar("quantity", value), validPositionSibling()]
        });
      });
      assert.deepEqual(model.positions.map((row) => row.id), ["position-valid"]);
      assert.deepEqual(
        { exposure: model.truth.exposure, unrealizedPnl: model.truth.unrealizedPnl, margin: model.truth.margin },
        { exposure: 100, unrealizedPnl: 7, margin: 25 }
      );
    });
  }
});

test("every selector-consumed position scalar rejects hostile data without hiding a valid sibling", async (t) => {
  const numericFields = [
    "quantity", "size", "pos", "qty",
    "notional", "notionalUsdt", "marketValue",
    "markPrice", "mark", "price", "entryPrice", "entry",
    "unrealizedPnl", "pnl", "upl",
    "margin", "initialMargin"
  ];
  const identityFields = ["id", "positionId", "instId", "symbol"];

  for (const field of numericFields) {
    await t.test(field, () => {
      let model;
      assert.doesNotThrow(() => {
        model = buildAccountDomainModel({
          positions: [positionWithScalar(field, Symbol(field)), validPositionSibling()]
        });
      });
      assert.deepEqual(model.positions.map((row) => row.id), ["position-valid"]);
    });
  }
  for (const field of identityFields) {
    await t.test(`identity ${field}`, () => {
      const hostile = positionWithScalar("quantity", 1);
      hostile.id = "higher-priority-valid-id";
      hostile[field] = Symbol(field);
      let model;
      assert.doesNotThrow(() => {
        model = buildAccountDomainModel({ positions: [hostile, validPositionSibling()] });
      });
      assert.deepEqual(model.positions.map((row) => row.id), ["position-valid"]);
    });
  }
});

test("production-compatible numeric strings remain selectable while authoritative zero is filtered", () => {
  const model = buildAccountDomainModel({
    positions: [
      {
        positionId: "numeric-strings",
        size: "2",
        mark: "50",
        upl: "3",
        initialMargin: "10"
      },
      {
        positionId: "numeric-sibling",
        quantity: 1,
        markPrice: 25,
        unrealizedPnl: -1,
        margin: 5
      },
      { positionId: "zero-string", qty: "0", price: "50", pnl: "0", margin: "0" }
    ]
  });

  assert.deepEqual(model.positions.map((row) => row.id), ["numeric-strings", "numeric-sibling"]);
  assert.deepEqual(
    { exposure: model.truth.exposure, unrealizedPnl: model.truth.unrealizedPnl, margin: model.truth.margin },
    { exposure: 125, unrealizedPnl: 2, margin: 15 }
  );
});

test("derived products and aggregate sums cannot overflow into financial truth", () => {
  const derivedOverflow = buildAccountDomainModel({
    positions: [{ positionId: "derived-overflow", quantity: Number.MAX_VALUE, markPrice: 2, unrealizedPnl: 1, margin: 1 }]
  });
  assert.equal(derivedOverflow.truth.exposure, null);

  const sumOverflow = buildAccountDomainModel({
    positions: [
      { positionId: "sum-a", notionalUsdt: Number.MAX_VALUE, unrealizedPnl: Number.MAX_VALUE, margin: Number.MAX_VALUE },
      { positionId: "sum-b", notionalUsdt: Number.MAX_VALUE, unrealizedPnl: Number.MAX_VALUE, margin: Number.MAX_VALUE }
    ]
  });
  assert.deepEqual(
    { exposure: sumOverflow.truth.exposure, unrealizedPnl: sumOverflow.truth.unrealizedPnl, margin: sumOverflow.truth.margin },
    { exposure: null, unrealizedPnl: null, margin: null }
  );
});

test("execution totals require authoritative non-negative safe integers", () => {
  const missing = buildAccountDomainModel({
    executionOrders: [{ id: "visible-order" }],
    fills: [{ id: "visible-fill" }],
    reviews: [{ id: "visible-review", type: "trade" }]
  });
  assert.deepEqual(missing.execution.totals, { orders: null, fills: null, reviews: null });

  const invalid = buildAccountDomainModel({
    executionOrderStatus: { total: -1 },
    tradeDataStatus: { fillTotal: 1.5, tradeReviewTotal: Number.MAX_SAFE_INTEGER + 1 }
  });
  assert.deepEqual(invalid.execution.totals, { orders: null, fills: null, reviews: null });

  const zeros = buildAccountDomainModel({
    executionOrderStatus: { total: 0 },
    tradeDataStatus: { fillTotal: 0, tradeReviewTotal: 0 }
  });
  assert.deepEqual(zeros.execution.totals, { orders: 0, fills: 0, reviews: 0 });
});
