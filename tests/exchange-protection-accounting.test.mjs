import test from "node:test";
import assert from "node:assert/strict";

const { fetchOkxProtectionClosure, summarizeOkxProtectionClosure, summarizeOkxProtectionClosureFromAlgoFills } = await import("../server/executionEngine.mjs");

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

test("保护退出按 algo history → child ordId → tradeId fills 建立权威证据链", () => {
  const execution = {
    id: "exec_abcdef123456", exchange: "OKX", symbol: "BTC/USDT", direction: "long",
    filledQuantity: 0.15, okxCtVal: 0.01, clientOrderId: "execabcdef123456",
    exchangeOrderId: "entry-order", entryFilledAt: "2026-08-05T04:00:00.000Z",
    stopClientOrderId: "stopabcdef123456", stopAlgoId: "algo-stop", tpAlgoIds: ["algo-tp"], takeProfits: [64560]
  };
  const algos = [
    { instId: "BTC-USDT-SWAP", algoId: "algo-tp", algoClOrdId: "tp1cdef123456", ordId: "tp-order", state: "effective" },
    { instId: "BTC-USDT-SWAP", algoId: "algo-stop", algoClOrdId: "stopabcdef123456", ordId: "stop-order", state: "effective" }
  ];
  const fills = [
    { instId: "BTC-USDT-SWAP", ordId: "entry-order", clOrdId: "execabcdef123456", tradeId: "entry-trade", side: "buy", fillSz: "15", fillPx: "64038.7", fillPnl: "0", fee: "-0.048029025", feeCcy: "USDT", ts: String(Date.parse("2026-08-05T04:00:00.000Z")) },
    { instId: "BTC-USDT-SWAP", ordId: "tp-order", tradeId: "tp-trade", side: "sell", fillSz: "7", fillPx: "64560", fillPnl: "0.36491", fee: "-0.022596", feeCcy: "USDT", ts: String(Date.parse("2026-08-05T04:10:00.000Z")) },
    { instId: "BTC-USDT-SWAP", ordId: "stop-order", tradeId: "stop-trade", side: "sell", fillSz: "8", fillPx: "63882.5", fillPnl: "-0.12496", fee: "-0.025553", feeCcy: "USDT", ts: String(Date.parse("2026-08-05T04:20:00.000Z")) },
    { instId: "BTC-USDT-SWAP", ordId: "unrelated", tradeId: "other-trade", side: "sell", fillSz: "50", fillPx: "1", fillPnl: "-99", fee: "-1", ts: String(Date.parse("2026-08-05T04:30:00.000Z")) }
  ];
  const result = summarizeOkxProtectionClosureFromAlgoFills(execution, algos, fills);
  assert.equal(result.complete, true);
  assert.equal(result.evidencePath, "orders-algo-history->ordId->fills-history:tradeId");
  assert.deepEqual(result.tradeIds.sort(), ["stop-trade", "tp-trade"]);
  assert.deepEqual(result.exchangeOrderIds.sort(), ["stop-order", "tp-order"]);
  assert.equal(Number(result.quantity.toFixed(8)), 0.15);
  assert.equal(Number(result.entryFeeUsdt.toFixed(9)), 0.048029025);
});

test("保护退出网络收口先查询三类 algo history，再按 child ordId 读取 fills", async (t) => {
  const priorKey = process.env.OKX_API_KEY;
  process.env.OKX_API_KEY = "test-read-key";
  t.after(() => { if (priorKey === undefined) delete process.env.OKX_API_KEY; else process.env.OKX_API_KEY = priorKey; });
  const execution = {
    id: "exec_abcdef123456", exchange: "OKX", symbol: "BTC/USDT", direction: "long",
    filledQuantity: 0.01, okxCtVal: 0.01, clientOrderId: "execabcdef123456", exchangeOrderId: "entry-order",
    entryFilledAt: "2026-08-05T04:00:00.000Z", createdAt: "2026-08-05T03:59:00.000Z",
    stopClientOrderId: "stopabcdef123456", stopAlgoId: "algo-stop", takeProfits: []
  };
  const paths = [];
  const signedRequest = async (path) => {
    paths.push(path);
    if (path.includes("orders-algo-history")) {
      const state = new URL(`https://okx.test${path}`).searchParams.get("state");
      return { code: "0", data: state === "effective" ? [{ instId: "BTC-USDT-SWAP", algoId: "algo-stop", algoClOrdId: "stopabcdef123456", ordId: "stop-order", state }] : [] };
    }
    if (path.includes("fills-history")) return { code: "0", data: [
      { instId: "BTC-USDT-SWAP", ordId: "entry-order", clOrdId: "execabcdef123456", tradeId: "entry-trade", side: "buy", fillSz: "1", fillPx: "64000", fillPnl: "0", fee: "-0.0064", ts: String(Date.parse("2026-08-05T04:00:00.000Z")) },
      { instId: "BTC-USDT-SWAP", ordId: "stop-order", tradeId: "stop-trade", side: "sell", fillSz: "1", fillPx: "63000", fillPnl: "-10", fee: "-0.0063", ts: String(Date.parse("2026-08-05T04:10:00.000Z")) }
    ] };
    throw new Error(`unexpected path ${path}`);
  };
  const result = await fetchOkxProtectionClosure(execution, { signedRequest });
  assert.equal(result.complete, true);
  assert.equal(paths.filter((path) => path.includes("orders-algo-history")).length, 3);
  assert.equal(paths.filter((path) => path.includes("fills-history")).length, 1);
  assert.equal(paths.some((path) => path.includes("orders-history-archive")), false);
  assert.deepEqual(result.tradeIds, ["stop-trade"]);
});
