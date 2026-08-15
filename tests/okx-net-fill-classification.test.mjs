import assert from "node:assert/strict";
import test from "node:test";

import { classifyOkxNetFill, upsertOkxOrder } from "../server/realtimeManager.mjs";

test("net long/short reductions including zero-PnL closes are classified from the pre-fill position", () => {
  assert.deepEqual(classifyOkxNetFill({ side: "sell", quantity: 1, realizedPnl: 0, positionDirection: "long", positionQuantity: 1 }), [
    { kind: "close", quantity: 1, component: "position_reduction" }
  ]);
  assert.deepEqual(classifyOkxNetFill({ side: "sell", quantity: 0.4, realizedPnl: 5, positionDirection: "long", positionQuantity: 1 }), [
    { kind: "close", quantity: 0.4, component: "position_reduction" }
  ]);
  assert.deepEqual(classifyOkxNetFill({ side: "buy", quantity: 1, realizedPnl: -5, positionDirection: "short", positionQuantity: 1 }), [
    { kind: "close", quantity: 1, component: "position_reduction" }
  ]);
});

test("a net-mode reversal is split into close and entry components instead of one fake entry", () => {
  assert.deepEqual(classifyOkxNetFill({ side: "sell", quantity: 1.5, realizedPnl: 25, positionDirection: "long", positionQuantity: 1 }), [
    { kind: "close", quantity: 1, component: "reversal_close" },
    { kind: "entry", quantity: 0.5, component: "reversal_entry" }
  ]);
});

test("without a pre-fill position, non-zero fillPnl closes while zero remains reconciliation-pending", () => {
  assert.equal(classifyOkxNetFill({ side: "sell", quantity: 1, realizedPnl: 25 })[0].kind, "close");
  assert.equal(classifyOkxNetFill({ side: "sell", quantity: 1, realizedPnl: 0 })[0].kind, "unknown");
});

test("WS net-mode reversal persists two financially incomplete facts with conserved quantity", () => {
  const db = {
    orders: [], fills: [], executionOrders: [], tradePlans: [], evidenceBundles: [],
    positions: [{
      id: "pos-1", exchange: "OKX", source: "exchange_rest", accountId: "account-a",
      symbol: "BTC/USDT", positionMode: "net_mode", rawPosSide: "net", direction: "long",
      coinSize: 0.01, contractMultiplier: 0.01, exchangeObservedAt: "2026-08-15T00:00:00.000Z"
    }]
  };
  upsertOkxOrder(db, {
    ordId: "external-order", clOrdId: "external-client", instId: "BTC-USDT-SWAP", instType: "SWAP",
    side: "sell", posSide: "net", reduceOnly: "false", state: "filled",
    fillSz: "1.5", fillPx: "60000", fillPnl: "25", tradeId: "trade-1", fee: "-0.06", feeCcy: "USDT",
    fillTime: "1786752000000"
  }, { accountId: "account-a", apiKeyFingerprint: "fp", environment: "production" });
  assert.deepEqual(db.fills.map((fill) => fill.kind).sort(), ["close", "entry"]);
  assert.equal(Number(db.fills.reduce((sum, fill) => sum + fill.quantity, 0).toFixed(8)), 0.015);
  assert.equal(db.fills.find((fill) => fill.kind === "close").realizedPnl, 25);
  assert.equal(db.fills.find((fill) => fill.kind === "entry").realizedPnl, null);
  assert.ok(db.fills.every((fill) => fill.financialBasisComplete === false));
});
