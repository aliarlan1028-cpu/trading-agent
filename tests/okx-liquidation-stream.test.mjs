import assert from "node:assert/strict";
import test from "node:test";
import {
  getOkxLiquidationSummary,
  markOkxLiquidationStreamConnected,
  recordOkxLiquidationMessage,
  resetOkxLiquidationStreamForTest
} from "../server/okxLiquidationStream.mjs";

const MINUTE = 60_000;

test("未覆盖完整窗口时不能把没有推送猜成零强平", () => {
  resetOkxLiquidationStreamForTest();
  const now = Date.now();
  markOkxLiquidationStreamConnected(true, now - 5 * MINUTE);
  assert.equal(getOkxLiquidationSummary("BTC/USDT", 30 * MINUTE, now), null);
});

test("连续覆盖完整窗口后，零事件才是可用事实", () => {
  resetOkxLiquidationStreamForTest();
  const now = Date.now();
  markOkxLiquidationStreamConnected(true, now - 31 * MINUTE);
  const summary = getOkxLiquidationSummary("BTC/USDT", 30 * MINUTE, now);
  assert.equal(summary.completeWindow, true);
  assert.equal(summary.total, 0);
  assert.equal(summary.source, "OKX_PUBLIC_WS");
});

test("官方推送按交易对和多空事件计数，并对重复消息幂等", () => {
  resetOkxLiquidationStreamForTest();
  const now = Date.now();
  markOkxLiquidationStreamConnected(true, now - 31 * MINUTE);
  const message = {
    data: [{
      instId: "BTC-USDT-SWAP",
      details: [
        { ts: String(now - MINUTE), posSide: "long", side: "sell", sz: "5", bkPx: "100" },
        { ts: String(now - 2 * MINUTE), posSide: "short", side: "buy", sz: "2", bkPx: "101" }
      ]
    }]
  };
  recordOkxLiquidationMessage(message, now);
  recordOkxLiquidationMessage(message, now);
  const summary = getOkxLiquidationSummary("BTC/USDT", 30 * MINUTE, now);
  assert.equal(summary.total, 2);
  assert.equal(summary.longLiqCount, 1);
  assert.equal(summary.shortLiqCount, 1);
  assert.equal(summary.dominantSide, "balanced");
  assert.equal(getOkxLiquidationSummary("ETH/USDT", 30 * MINUTE, now).total, 0);
});

test("连接中断后旧窗口立即失效", () => {
  resetOkxLiquidationStreamForTest();
  const now = Date.now();
  markOkxLiquidationStreamConnected(true, now - 31 * MINUTE);
  markOkxLiquidationStreamConnected(false, now);
  assert.equal(getOkxLiquidationSummary("BTC/USDT", 30 * MINUTE, now), null);
});
