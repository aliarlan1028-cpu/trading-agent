import assert from "node:assert/strict";
import test from "node:test";
import { deriveClosedTradeShare, renderClosedTradePoster } from "../server/positionPoster.mjs";

test("已平仓海报使用已实现口径并单列费用", async () => {
  const trade = { exchange: "OKX", symbol: "ADA/USDT", direction: "short", filledPrice: 0.1867, exitPrice: 0.1849, quantity: 90, leverage: 1, realizedPnl: 0.16, entryFeeUsdt: 0.006721, closeFeeUsdt: 0.006656, holdingMinutes: 117, closedAt: "2026-08-11T15:58:58.000Z" };
  const share = deriveClosedTradeShare(trade);
  assert.equal(share.side, "SHORT");
  assert.equal(share.exit, 0.1849);
  assert.equal(share.pnl, 0.16);
  assert.equal(Number(share.feeUsdt.toFixed(6)), 0.013377);
  const poster = await renderClosedTradePoster(trade);
  assert.ok(poster.buffer.length > 1000);
  assert.match(poster.filename, /ADAUSDT-realized/);
});

test("Telegram 盈利海报使用纯英文模板", async () => {
  const trade = {
    exchange: "OKX", symbol: "BTC/USDT", direction: "long", filledPrice: 62000,
    exitPrice: 64800, quantity: 0.03, leverage: 10, realizedPnl: 84,
    realizedRoiPct: 45.2, feeUsdt: 1.24, holdingMinutes: 222,
    exitReason: "止盈", closedAt: "2026-08-13T10:00:00.000Z", isSample: true
  };
  const poster = await renderClosedTradePoster(trade);
  assert.equal(poster.type, "photo");
  assert.ok(poster.buffer.length > 1000);
});
