import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { dedupePositions as compatibilityDedupePositions } from "../server/accounting.mjs";
import * as positionView from "../server/positionView.mjs";

const dedupePositions = positionView.dedupePositions || compatibilityDedupePositions;
const at = (seconds) => new Date(Date.UTC(2026, 7, 20, 0, 0, seconds)).toISOString();
const position = (id, overrides = {}) => ({
  id,
  source: "execution_engine",
  exchange: "OKX",
  accountId: "account-a",
  symbol: "BTC/USDT",
  direction: "long",
  updatedAt: at(0),
  quantity: 1,
  ...overrides
});

test("position dedupe has one position boundary implementation with accounting compatibility", () => {
  assert.equal(typeof positionView.dedupePositions, "function", "expected dedupePositions at the position facts boundary");
  assert.equal(compatibilityDedupePositions, positionView.dedupePositions);
});

test("riskEngine reads position dedupe from positionView instead of accounting", () => {
  const riskEngine = fs.readFileSync(new URL("../server/riskEngine.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(riskEngine, /from\s+["']\.\/accounting\.mjs["']/);
  assert.match(riskEngine, /from\s+["']\.\/positionView\.mjs["']/);
});

test("REST and WS facts outrank a newer engine mirror, then use newest fact time", () => {
  const engine = position("engine", { updatedAt: at(30) });
  const rest = position("rest", { source: "exchange_rest", rawSyncedAt: at(10) });
  const ws = position("ws", { source: "exchange_ws", exchangeObservedAt: at(20) });
  assert.deepEqual(dedupePositions([engine, rest, ws]), [ws]);
  assert.equal(dedupePositions([engine, ws, position("new-rest", { source: "exchange_rest", rawSyncedAt: at(25) })])[0].id, "new-rest");
});

test("engine-only mirrors select the newest observed record", () => {
  const older = position("older", { updatedAt: at(10) });
  const newer = position("newer", { updatedAt: at(20) });
  assert.deepEqual(dedupePositions([newer, older]), [newer]);
});

test("position identity keeps account, exchange, symbol, direction, margin mode, and currency separate", () => {
  const rows = [
    position("base"),
    position("account", { accountId: "account-b" }),
    position("exchange", { exchange: "BINANCE" }),
    position("symbol", { symbol: "ETH/USDT" }),
    position("direction", { direction: "short" }),
    position("margin", { mgnMode: "isolated" }),
    position("currency", { ccy: "USDC" })
  ];
  assert.deepEqual(dedupePositions(rows), rows);
});

test("canonical symbol and direction aliases share one mirror identity", () => {
  const engine = position("engine", { symbol: "BTC-USDT", direction: "多" });
  const rest = position("rest", { source: "exchange_rest", instId: "BTC-USDT-SWAP", symbol: undefined, posSide: "long", direction: undefined, rawSyncedAt: at(10) });
  assert.deepEqual(dedupePositions([engine, rest]), [rest]);
});

test("missing and equal timestamps preserve stable input precedence", () => {
  const missingFirst = position("missing-first", { source: "exchange_rest", updatedAt: undefined });
  const missingSecond = position("missing-second", { source: "exchange_ws", updatedAt: undefined });
  assert.deepEqual(dedupePositions([missingFirst, missingSecond]), [missingFirst]);

  const equalFirst = position("equal-first", { source: "exchange_rest", rawSyncedAt: at(10) });
  const equalSecond = position("equal-second", { source: "exchange_ws", exchangeObservedAt: at(10) });
  assert.deepEqual(dedupePositions([equalFirst, equalSecond]), [equalFirst]);
});

test("output keeps first-seen group ordering and returns selected records unchanged", () => {
  const btcOld = position("btc-old", { updatedAt: at(10), custom: { retained: true } });
  const eth = position("eth", { symbol: "ETH/USDT", updatedAt: at(15) });
  const btcNew = position("btc-new", { updatedAt: at(20), custom: { retained: true } });
  const output = dedupePositions([btcOld, eth, btcNew]);
  assert.deepEqual(output, [btcNew, eth]);
  assert.equal(output[0], btcNew);
  assert.equal(output[1], eth);
});

test("invalid identity rows are omitted while empty/default input remains empty", () => {
  assert.deepEqual(dedupePositions(), []);
  assert.deepEqual(dedupePositions([]), []);
  assert.deepEqual(dedupePositions([
    {},
    position("missing-symbol", { symbol: undefined, instId: undefined }),
    position("missing-direction", { direction: undefined })
  ]), []);
});

test("a null position row retains the current malformed-input failure", () => {
  assert.throws(() => dedupePositions([null]), TypeError);
});
