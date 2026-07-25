import test from "node:test";
import assert from "node:assert/strict";
import { advanceSession } from "../server/paperTrading.mjs";

test("paper forward deducts fees and slippage from completed trades", () => {
  const candles = Array.from({ length: 8 }, (_, index) => ({
    time: index + 1,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 100
  }));
  candles[6] = { time: 7, open: 100, high: 111, low: 100, close: 110, volume: 200 };
  candles[7] = { time: 8, open: 110, high: 113, low: 109, close: 112, volume: 100 };
  const session = {
    strategyId: "breakout",
    timeframe: "1h",
    direction: "long",
    params: { lookback: 5, stopLossPct: 2, takeProfitR: 1 },
    lastBarTime: 0,
    paperPosition: null,
    trades: []
  };
  advanceSession(session, candles);
  assert.equal(session.trades.length, 1);
  assert.equal(session.trades[0].grossR, 1);
  assert.ok(session.trades[0].costR > 0);
  assert.ok(session.trades[0].rMultiple < 1);
});
