import assert from "node:assert/strict";
import test from "node:test";
import { buildOpportunitySetupSnapshot } from "../server/opportunitySetup.mjs";

function trendCandles(direction = 1) {
  let close = 100;
  return Array.from({ length: 80 }, (_, index) => {
    const open = close;
    close *= 1 + direction * (0.0015 + (index % 2 ? 0.0001 : -0.0001));
    return { time: index * 3600000, open, high: Math.max(open, close) * 1.001, low: Math.min(open, close) * 0.999, close, volume: 100 + index };
  });
}

test("66% 区间位置在上升趋势中不会被机械标成禁止做多", () => {
  const candles = trendCandles(1);
  const price = candles.at(-1).close;
  const snapshot = buildOpportunitySetupSnapshot({
    market: { symbol: "BTC/USDT", price, low24h: price - 6.6, high24h: price + 3.4, spreadBps: 1 },
    candles,
    early: { ready: true, direction: "long" }
  });
  assert.equal(snapshot.marketRegime.label, "uptrend");
  assert.equal(snapshot.directionBias, "long");
  assert.equal(snapshot.setupChannels.trendContinuation.state, "ready_for_deep_validation");
});

test("低位只改变入场位置，不会自行生成反转多头", () => {
  const candles = trendCandles(-1);
  const price = candles.at(-1).close;
  const snapshot = buildOpportunitySetupSnapshot({
    market: { symbol: "ADA/USDT", price, low24h: price - 1, high24h: price + 9, spreadBps: 1 },
    candles,
    early: { ready: true, direction: "short" },
    reversal: { ready: true, qualified: false, direction: "long", confirmations: ["lowerLocation"], missing: ["reclaimedLow", "momentumFlip"] }
  });
  assert.equal(snapshot.directionBias, "short");
  assert.notEqual(snapshot.setupChannels.reversalReclaim.state, "candidate_for_deep_validation");
});
