import test from "node:test";
import assert from "node:assert/strict";

const { summarizeOkxProtectionClosure } = await import("../server/executionEngine.mjs");

test("OKX 部分止盈加余仓止损按真实成交聚合，不把整笔误记为止损", () => {
  const execution = {
    id: "exec_abcdef123456",
    exchange: "OKX",
    symbol: "BTC/USDT",
    direction: "long",
    filledQuantity: 0.15,
    okxCtVal: 0.01,
    clientOrderId: "execabcdef123456",
    entryFilledAt: "2026-08-05T04:00:00.000Z",
    stopClientOrderId: "stopabcdef123456",
    takeProfits: [64560]
  };
  const orders = [
    { instId: "BTC-USDT-SWAP", state: "filled", ordId: "entry-order", clOrdId: "execabcdef123456", accFillSz: "15", avgPx: "64038.7", pnl: "0", fee: "-0.048029025", uTime: String(Date.parse("2026-08-05T04:00:00.000Z")) },
    { instId: "BTC-USDT-SWAP", state: "filled", ordId: "tp-order", algoClOrdId: "tp1cdef123456", accFillSz: "7", avgPx: "64560", pnl: "0.36491", fee: "-0.022596", uTime: String(Date.parse("2026-08-05T04:10:00.000Z")) },
    { instId: "BTC-USDT-SWAP", state: "filled", ordId: "stop-order", algoClOrdId: "stopabcdef123456", accFillSz: "8", avgPx: "63882.5", pnl: "-0.12496", fee: "-0.025553", uTime: String(Date.parse("2026-08-05T04:20:00.000Z")) },
    { instId: "BTC-USDT-SWAP", state: "filled", ordId: "unrelated", algoClOrdId: "other", accFillSz: "20", avgPx: "1", pnl: "-99", fee: "-1", uTime: String(Date.parse("2026-08-05T04:30:00.000Z")) }
  ];
  const result = summarizeOkxProtectionClosure(execution, orders);
  assert.equal(result.complete, true);
  assert.equal(result.breakdown.length, 2);
  assert.equal(Number(result.quantity.toFixed(8)), 0.15);
  assert.equal(Number(result.realizedPnl.toFixed(8)), 0.23995);
  assert.equal(Number(result.feeUsdt.toFixed(8)), 0.048149);
  assert.equal(Number(result.entryFeeUsdt.toFixed(9)), 0.048029025);
  assert.equal(result.closedAt, "2026-08-05T04:20:00.000Z");
});

test("保护历史尚未覆盖完整仓位时保持 pending，不提前推断平仓", () => {
  const execution = { id: "exec_abcdef123456", symbol: "BTC/USDT", filledQuantity: 0.15, okxCtVal: 0.01, takeProfits: [64560] };
  const result = summarizeOkxProtectionClosure(execution, [
    { instId: "BTC-USDT-SWAP", state: "filled", ordId: "tp-order", algoClOrdId: "tp1cdef123456", accFillSz: "7", avgPx: "64560", pnl: "0.36", fee: "-0.02", uTime: String(Date.now()) }
  ]);
  assert.equal(result.complete, false);
  assert.equal(result.quantity, 0.07);
});
