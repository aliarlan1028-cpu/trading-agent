import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const { applyOkxLifecycleFinancialEvidence, extractOkxAlgoChildOrderIds, fetchOkxProtectionClosure, reconcilePendingTradeFinancials, summarizeOkxManualClosure, summarizeOkxProtectionClosure, summarizeOkxProtectionClosureFromAlgoFills } = await import("../server/executionEngine.mjs");

function legacyFinancialFixture(apiKey) {
  const fingerprint = crypto.createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
  const entryAt = "2026-08-15T00:00:00.000Z";
  const closeAt = "2026-08-15T01:00:00.000Z";
  return {
    system: {}, positions: [], tradePlans: [], memoryItems: [],
    exchangeAccounts: [{ id: "account_okx", exchange: "OKX", readEnabled: true, tradeEnabled: true, apiKeyFingerprint: fingerprint }],
    accountSnapshots: [{ id: "snapshot_okx", exchange: "OKX", accountId: "account_okx", status: "ok", apiKeyFingerprint: fingerprint, environment: "production", createdAt: "2026-08-15T02:00:00.000Z" }],
    executionOrders: [{
      id: "exec_legacy", exchange: "OKX", symbol: "BTC/USDT", direction: "long", status: "closed",
      filledQuantity: 0.01, quantity: 0.01, okxCtVal: 0.01, exchangeOrderId: "entry-order",
      clientOrderId: "entry-client", stopClientOrderId: "stop-client", entryFilledAt: entryAt, closedAt: closeAt,
      events: []
    }],
    fills: [
      { id: "entry", executionOrderId: "exec_legacy", kind: "entry", symbol: "BTC/USDT", direction: "long", quantity: 0.01, price: 100, notionalUsdt: 1, feeUsdt: 0.001, estimatedFee: true, createdAt: entryAt },
      { id: "close", executionOrderId: "exec_legacy", kind: "close", symbol: "BTC/USDT", direction: "long", quantity: 0.01, price: 109, notionalUsdt: 1.09, realizedPnl: 0.09, feeUsdt: 0.001, estimatedFee: true, fundingReconciled: false, fundingFeeUsdt: null, partial: false, createdAt: closeAt }
    ],
    reviews: [{ id: "review", type: "trade", tradeLifecycleKey: "exec_legacy", executionOrderId: "exec_legacy", status: "pending_financial_reconciliation", fillIds: ["close"] }]
  };
}

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

test("WS/REST 重复入场 fills 在保护退出与手动退出中只计算一次", () => {
  const execution = {
    id: "exec_duplicate_entry", symbol: "BTC/USDT", direction: "long", filledQuantity: 0.01, okxCtVal: 0.01,
    clientOrderId: "entry-client", exchangeOrderId: "entry-order", entryFilledAt: "2026-08-17T00:00:00.000Z",
    stopAlgoId: "algo-stop", closeClientOrderId: "close-client", closeExchangeOrderId: "close-order",
    closeSubmittedAt: "2026-08-17T00:01:00.000Z"
  };
  const entry = { instId: "BTC-USDT-SWAP", ordId: "entry-order", clOrdId: "entry-client", tradeId: "entry-trade", side: "buy", fillSz: "1", fillPx: "100", fillPnl: "0", fee: "-0.01", feeCcy: "USDT", ts: String(Date.parse("2026-08-17T00:00:00.000Z")) };
  const close = { instId: "BTC-USDT-SWAP", ordId: "close-order", clOrdId: "close-client", tradeId: "close-trade", side: "sell", fillSz: "1", fillPx: "110", fillPnl: "1", fee: "-0.01", feeCcy: "USDT", ts: String(Date.parse("2026-08-17T00:02:00.000Z")) };
  const duplicated = [entry, { ...entry }, close, { ...close }];

  const protection = summarizeOkxProtectionClosureFromAlgoFills(execution, [
    { instId: "BTC-USDT-SWAP", algoId: "algo-stop", ordId: "close-order" }
  ], duplicated);
  const manual = summarizeOkxManualClosure(execution, duplicated);
  for (const result of [protection, manual]) {
    assert.equal(result.complete, true);
    assert.equal(result.quantity, 0.01);
    assert.equal(result.feeUsdt, 0.01);
    assert.equal(result.entryFeeUsdt, 0.01);
  }
});

test("缺少 tradeId 的重复入场 fill 使用稳定组合键去重", () => {
  const execution = {
    id: "exec_duplicate_fallback", symbol: "BTC/USDT", direction: "long", filledQuantity: 0.01, okxCtVal: 0.01,
    clientOrderId: "entry-client", exchangeOrderId: "entry-order", closeClientOrderId: "close-client",
    closeSubmittedAt: "2026-08-17T00:01:00.000Z"
  };
  const entryWs = { instId: "BTC-USDT-SWAP", ordId: "entry-order", clOrdId: "entry-client", side: "buy", fillSz: "1", fillPx: "100", ts: "1786924800000" };
  const entryRest = { instId: "BTC-USDT-SWAP", ordId: "entry-order", clOrdId: "entry-client", side: "buy", sz: "1", avgPx: "100", fillPnl: "0", fee: "-0.01", feeCcy: "USDT", fillTime: "1786924800000" };
  const closeWs = { instId: "BTC-USDT-SWAP", ordId: "close-order", clOrdId: "close-client", side: "sell", fillSz: "1", fillPx: "110", ts: "1786924920000" };
  const closeRest = { instId: "BTC-USDT-SWAP", ordId: "close-order", clOrdId: "close-client", side: "sell", sz: "1", avgPx: "110", fillPnl: "1", fee: "-0.01", feeCcy: "USDT", fillTime: "1786924920000" };
  const result = summarizeOkxManualClosure(execution, [entryWs, entryRest, closeWs, closeRest]);
  assert.equal(result.entryFeeUsdt, 0.01);
  assert.equal(result.feeUsdt, 0.01);
  assert.equal(result.quantity, 0.01);
});

test("OKX ordIdList 的全部子订单都归入同一保护退出生命周期", () => {
  const contractFixture = JSON.parse(fs.readFileSync(new URL("./fixtures/okx-algo-history-ord-list.json", import.meta.url), "utf8"));
  assert.deepEqual(extractOkxAlgoChildOrderIds(contractFixture.data[0]), ["681022409876543210", "681022409876543211"]);
  const execution = {
    id: "exec_ord_list", exchange: "OKX", symbol: "BTC/USDT", direction: "long",
    filledQuantity: 0.03, okxCtVal: 0.01, exchangeOrderId: "entry", stopAlgoId: "algo-split",
    entryFilledAt: "2026-08-05T04:00:00.000Z"
  };
  const algos = [{
    instId: "BTC-USDT-SWAP", algoId: "algo-split", ordIdList: ["child-a", "child-b"], cTime: String(Date.parse("2026-08-05T04:01:00.000Z"))
  }];
  const fills = [
    { instId: "BTC-USDT-SWAP", ordId: "entry", tradeId: "entry-fill", side: "buy", fillSz: "3", fillPx: "100", fillPnl: "0", fee: "-0.01", ts: String(Date.parse("2026-08-05T04:00:00.000Z")) },
    { instId: "BTC-USDT-SWAP", ordId: "child-a", tradeId: "close-a", side: "sell", fillSz: "1", fillPx: "110", fillPnl: "1", fee: "-0.01", ts: String(Date.parse("2026-08-05T04:02:00.000Z")) },
    { instId: "BTC-USDT-SWAP", ordId: "child-b", tradeId: "close-b", side: "sell", fillSz: "2", fillPx: "90", fillPnl: "-2", fee: "-0.02", ts: String(Date.parse("2026-08-05T04:03:00.000Z")) },
    { instId: "BTC-USDT-SWAP", ordId: "child-b", tradeId: "close-b", side: "sell", fillSz: "2", fillPx: "90", fillPnl: "-2", fee: "-0.02", ts: String(Date.parse("2026-08-05T04:03:00.000Z")) }
  ];
  assert.deepEqual(extractOkxAlgoChildOrderIds(algos[0]), ["child-a", "child-b"]);
  const result = summarizeOkxProtectionClosureFromAlgoFills(execution, algos, fills);
  assert.equal(result.complete, true);
  assert.deepEqual(result.exchangeOrderIds.sort(), ["child-a", "child-b"]);
  assert.deepEqual(result.tradeIds.sort(), ["close-a", "close-b"]);
  assert.deepEqual(result.unmatchedChildOrderIds, []);
});

test("ordIdList 的 JSON 字符串兼容格式也会被完整解析", () => {
  assert.deepEqual(extractOkxAlgoChildOrderIds({ ordIdList: '["child-1","child-2"]' }), ["child-1", "child-2"]);
});

test("ordIdList 中任一子订单缺少成交时保持 pending", () => {
  const execution = { id: "exec_missing_child", exchange: "OKX", symbol: "BTC/USDT", direction: "long", filledQuantity: 0.01, okxCtVal: 0.01, exchangeOrderId: "entry", stopAlgoId: "algo-split" };
  const algos = [{ instId: "BTC-USDT-SWAP", algoId: "algo-split", ordIdList: ["child-a", "child-missing"] }];
  const fills = [
    { instId: "BTC-USDT-SWAP", ordId: "entry", tradeId: "entry-fill", side: "buy", fillSz: "1", fillPx: "100", fillPnl: "0", fee: "-0.01", ts: String(Date.now()) },
    { instId: "BTC-USDT-SWAP", ordId: "child-a", tradeId: "close-a", side: "sell", fillSz: "1", fillPx: "110", fillPnl: "1", fee: "-0.01", ts: String(Date.now()) }
  ];
  const result = summarizeOkxProtectionClosureFromAlgoFills(execution, algos, fills);
  assert.equal(result.complete, false);
  assert.deepEqual(result.unmatchedChildOrderIds, ["child-missing"]);
});

test("旧执行记录把请求数量当成交数量时，以同一入场订单的原始 fill 数量纠正", () => {
  const execution = {
    id: "exec_legacy_rounding", symbol: "ADA/USDT", direction: "long",
    filledQuantity: 159, quantity: 159, okxCtVal: 100,
    clientOrderId: "entry-client", exchangeOrderId: "entry-order",
    stopClientOrderId: "stop-client", entryFilledAt: "2026-08-15T00:00:00.000Z"
  };
  const result = summarizeOkxProtectionClosureFromAlgoFills(execution, [
    { instId: "ADA-USDT-SWAP", algoClOrdId: "stop-client", ordId: "close-order" }
  ], [
    { instId: "ADA-USDT-SWAP", ordId: "entry-order", clOrdId: "entry-client", tradeId: "entry-fill", side: "buy", fillSz: "1.5", fillPx: "0.192", fillPnl: "0", fee: "-0.00576", ts: String(Date.parse("2026-08-15T00:00:00.000Z")) },
    { instId: "ADA-USDT-SWAP", ordId: "close-order", tradeId: "close-fill", side: "sell", fillSz: "1.5", fillPx: "0.1888", fillPnl: "-0.48", fee: "-0.01416", ts: String(Date.parse("2026-08-15T01:00:00.000Z")) }
  ]);
  assert.equal(result.complete, true);
  assert.equal(result.recordedExpectedQuantity, 159);
  assert.equal(result.entryQuantity, 150);
  assert.equal(result.expectedQuantity, 150);
  assert.equal(result.quantity, 150);
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
      return { code: "0", data: state === "effective" ? [{ instId: "BTC-USDT-SWAP", algoId: "algo-stop", algoClOrdId: "stopabcdef123456", ordId: "stop-order", cTime: String(Date.parse("2026-08-05T04:01:00.000Z")), state }] : [] };
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
  assert.equal(paths.filter((path) => path.includes("orders-algo-history")).some((path) => new URL(`https://okx.test${path}`).searchParams.has("begin")), false);
  assert.equal(paths.some((path) => path.includes("orders-history-archive")), false);
  assert.deepEqual(result.tradeIds, ["stop-trade"]);
});

test("Algo History 使用 after 多页读取并在客户端按 cTime 边界过滤", async (t) => {
  const priorKey = process.env.OKX_API_KEY;
  process.env.OKX_API_KEY = "test-read-key";
  t.after(() => { if (priorKey === undefined) delete process.env.OKX_API_KEY; else process.env.OKX_API_KEY = priorKey; });
  const begin = Date.parse("2026-08-05T04:00:00.000Z");
  const execution = {
    id: "exec_paged", exchange: "OKX", symbol: "BTC/USDT", direction: "long",
    filledQuantity: 0.01, okxCtVal: 0.01, exchangeOrderId: "entry", stopAlgoId: "target-algo",
    createdAt: new Date(begin).toISOString()
  };
  const paths = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ instId: "BTC-USDT-SWAP", algoId: `new-${index}`, cTime: String(begin + 1000 + index), state: "effective" }));
  const signedRequest = async (path) => {
    paths.push(path);
    const url = new URL(`https://okx.test${path}`);
    if (path.includes("orders-algo-history")) {
      if (url.searchParams.get("state") !== "effective") return { code: "0", data: [] };
      if (!url.searchParams.get("after")) return { code: "0", data: firstPage };
      return { code: "0", data: [
        { instId: "BTC-USDT-SWAP", algoId: "target-algo", ordId: "child", cTime: String(begin), state: "effective" },
        { instId: "BTC-USDT-SWAP", algoId: "too-old", ordId: "old-child", cTime: String(begin - 1), state: "effective" }
      ] };
    }
    return { code: "0", data: [
      { instId: "BTC-USDT-SWAP", ordId: "entry", tradeId: "entry-fill", side: "buy", fillSz: "1", fillPx: "100", fillPnl: "0", fee: "-0.01", ts: String(begin) },
      { instId: "BTC-USDT-SWAP", ordId: "child", tradeId: "close-fill", side: "sell", fillSz: "1", fillPx: "110", fillPnl: "1", fee: "-0.01", ts: String(begin + 2000) }
    ] };
  };
  const result = await fetchOkxProtectionClosure(execution, { signedRequest });
  assert.equal(result.complete, true);
  assert.deepEqual(result.exchangeOrderIds, ["child"]);
  const secondPage = paths.find((path) => path.includes("orders-algo-history") && path.includes("after="));
  assert.ok(secondPage);
  assert.equal(new URL(`https://okx.test${secondPage}`).searchParams.has("begin"), false);
});

test("旧版估算费用必须先由精确 OKX 成交证据回填，再进入资金费对账", async (t) => {
  const previousKey = process.env.OKX_API_KEY;
  process.env.OKX_API_KEY = "legacy-read-key";
  t.after(() => { if (previousKey === undefined) delete process.env.OKX_API_KEY; else process.env.OKX_API_KEY = previousKey; });
  const db = legacyFinancialFixture(process.env.OKX_API_KEY);
  const closure = {
    complete: true, evidencePath: "orders-algo-history->ordId->fills-history:tradeId",
    quantity: 0.01, expectedQuantity: 0.01, weightedPrice: 110, realizedPnl: 0.1,
    entryFeeUsdt: 0.002, feeUsdt: 0.003, closedAt: "2026-08-15T01:00:00.000Z",
    exchangeOrderIds: ["close-order"], tradeIds: ["close-trade"], algoIds: ["algo-stop"],
    breakdown: [{ exchangeOrderId: "close-order", tradeId: "close-trade", quantity: 0.01, price: 110 }]
  };
  const report = await reconcilePendingTradeFinancials(db, {
    nowMs: Date.parse("2026-08-15T03:00:00.000Z"),
    fundingReconciliationGraceMs: 0,
    fetchLifecycleClosure: async () => closure,
    fetchFundingBills: async () => ({ complete: true, fundingFeeUsdt: -0.004, billIds: ["bill-1"] })
  });
  assert.equal(report.reconciled, 1);
  assert.equal(report.results[0].status, "reconciled");
  assert.equal(db.fills[0].estimatedFee, false);
  assert.equal(db.fills[0].feeUsdt, 0.002);
  assert.equal(db.fills[1].estimatedFee, false);
  assert.equal(db.fills[1].feeUsdt, 0.003);
  assert.equal(db.fills[1].realizedPnl, 0.1);
  assert.equal(db.fills[1].fundingFeeUsdt, -0.004);
  assert.equal(db.fills[1].fundingReconciled, true);
  assert.deepEqual(db.fills[1].exchangeTradeIds, ["close-trade"]);
  assert.equal(db.executionOrders[0].accountId, "account_okx");
  assert.equal(db.executionOrders[0].environment, "production");
  assert.equal(db.reviews[0].status, "pending");
});

test("OKX 子订单数量不完整时不得把旧估算费用伪装成已核算", async (t) => {
  const previousKey = process.env.OKX_API_KEY;
  process.env.OKX_API_KEY = "legacy-incomplete-key";
  t.after(() => { if (previousKey === undefined) delete process.env.OKX_API_KEY; else process.env.OKX_API_KEY = previousKey; });
  const db = legacyFinancialFixture(process.env.OKX_API_KEY);
  let billsCalled = false;
  const report = await reconcilePendingTradeFinancials(db, {
    nowMs: Date.parse("2026-08-15T03:00:00.000Z"),
    feeEvidenceRetryMs: 0,
    fetchLifecycleClosure: async () => ({ complete: false, reason: "protection_child_fills_missing", quantity: 0.009, expectedQuantity: 0.01 }),
    fetchFundingBills: async () => { billsCalled = true; return { complete: true, fundingFeeUsdt: 0, billIds: [] }; }
  });
  assert.equal(report.reconciled, 0);
  assert.equal(report.results[0].status, "protection_child_fills_missing");
  assert.equal(billsCalled, false);
  assert.equal(db.fills[0].estimatedFee, true);
  assert.equal(db.fills[1].estimatedFee, true);
  assert.equal(db.reviews[0].status, "pending_financial_reconciliation");
});

test("生命周期费用回填拒绝与执行数量不一致的聚合证据", () => {
  const db = legacyFinancialFixture("quantity-key");
  const result = applyOkxLifecycleFinancialEvidence(db, db.executionOrders[0], {
    complete: true, quantity: 0.02, weightedPrice: 110, realizedPnl: 0.1, entryFeeUsdt: 0.002, feeUsdt: 0.003
  });
  assert.equal(result.applied, false);
  assert.equal(result.reason, "authoritative_close_quantity_mismatch");
  assert.equal(db.fills[0].estimatedFee, true);
  assert.equal(db.fills[1].estimatedFee, true);
});

test("权威入场 fill 可以原子纠正旧生命周期的合约舍入数量", () => {
  const db = legacyFinancialFixture("rounding-key");
  db.executionOrders[0].filledQuantity = 0.011;
  db.executionOrders[0].quantity = 0.011;
  db.fills[0].quantity = 0.011;
  db.fills[1].quantity = 0.011;
  const result = applyOkxLifecycleFinancialEvidence(db, db.executionOrders[0], {
    complete: true, entryQuantity: 0.01, expectedQuantity: 0.01, recordedExpectedQuantity: 0.011,
    quantity: 0.01, weightedPrice: 110, realizedPnl: 0.1, entryFeeUsdt: 0.002, feeUsdt: 0.003,
    closedAt: "2026-08-15T01:00:00.000Z", exchangeOrderIds: ["close-order"], tradeIds: ["trade-close"]
  });
  assert.equal(result.applied, true);
  assert.equal(result.quantityCorrected, true);
  assert.equal(db.executionOrders[0].filledQuantity, 0.01);
  assert.equal(db.fills[0].quantity, 0.01);
  assert.equal(db.fills[1].quantity, 0.01);
});
