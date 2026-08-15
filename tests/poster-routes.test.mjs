import assert from "node:assert/strict";
import test from "node:test";
import { registerPosterRoutes } from "../server/routes/posters.mjs";
import { deriveClosedTradeShare } from "../server/positionPoster.mjs";
import { financiallyReconciledFills } from "./financial-fixtures.mjs";

function response() {
  return {
    statusCode: 200, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
    type(value) { this.contentType = value; return this; },
    setHeader(key, value) { this.headers[key] = value; return this; },
    send(payload) { this.body = payload; return this; }
  };
}

function posterRoute(db, renderer) {
  const routes = new Map();
  const app = {
    get(path, ...handlers) { routes.set(`GET ${path}`, handlers.at(-1)); },
    post(path, ...handlers) { routes.set(`POST ${path}`, handlers.at(-1)); }
  };
  registerPosterRoutes(app, {
    db,
    requirePermission: () => (_req, _res, next) => next(),
    renderClosedTradePoster: renderer,
    llmComplete: async () => null,
    appendTrace() {}
  });
  return routes.get("GET /api/posters/trades/:id");
}

test("手动下载海报按完整部分平仓生命周期聚合，并按入场成本计算净 ROI", async () => {
  let renderedTrade = null;
  const db = {
    executionOrders: [{ id: "exec-1", planId: "plan-1", status: "closed", symbol: "BTC/USDT", filledPrice: 100, notionalUsdt: 300, leverage: 2 }],
    fills: financiallyReconciledFills([
      { id: "entry", kind: "entry", executionOrderId: "exec-1", tradePlanId: "plan-1", price: 100, quantity: 3, notionalUsdt: 300, feeUsdt: 1, createdAt: "2026-08-01T00:00:00Z" },
      { id: "partial", kind: "close", partial: true, executionOrderId: "exec-1", tradePlanId: "plan-1", price: 200, quantity: 1, notionalUsdt: 200, realizedPnl: 100, feeUsdt: 1, fundingFeeUsdt: -1, createdAt: "2026-08-01T01:00:00Z" },
      { id: "final", kind: "close", executionOrderId: "exec-1", tradePlanId: "plan-1", price: 200, quantity: 2, notionalUsdt: 400, realizedPnl: 200, feeUsdt: 2, fundingFeeUsdt: 2, createdAt: "2026-08-01T02:00:00Z" }
    ])
  };
  const route = posterRoute(db, async (trade) => {
    renderedTrade = trade;
    return { buffer: Buffer.from("poster"), filename: "trade.png", contentType: "image/png" };
  });
  const res = response();
  await route({ params: { id: "exec-1" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(renderedTrade.grossRealizedPnl, 300);
  assert.equal(renderedTrade.realizedPnl, 300);
  assert.equal(renderedTrade.entryFeeUsdt, 1);
  assert.equal(renderedTrade.closeFeeUsdt, 3);
  assert.equal(renderedTrade.fundingFeeUsdt, 1);
  assert.equal(renderedTrade.netRealizedPnl, 297);
  assert.equal(renderedTrade.quantity, 3);
  assert.equal(renderedTrade.entryPrice, 100);
  assert.equal(renderedTrade.exitPrice, 200);
  assert.equal(renderedTrade.entryNotionalUsdt, 300);
  assert.equal(renderedTrade.notionalUsdt, 300, "不能误用 600 USDT 的平仓名义额");
  assert.equal(renderedTrade.marginUsdt, 150);
  assert.equal(deriveClosedTradeShare(renderedTrade).roiPct, 198);
  assert.equal(renderedTrade.financialBasis, "recorded_costs");
  assert.equal(res.contentType, "image/png");
});

test("只有未完成部分平仓时明确拒绝生成海报，不调用渲染器", async () => {
  let rendered = false;
  const db = {
    executionOrders: [{ id: "exec-partial", status: "closed" }],
    fills: [{ id: "partial", kind: "close", partial: true, executionOrderId: "exec-partial", realizedPnl: 1, feeUsdt: 0.1 }]
  };
  const res = response();
  await posterRoute(db, async () => { rendered = true; })({ params: { id: "exec-partial" } }, res);
  assert.equal(res.statusCode, 409);
  assert.match(res.payload.error, /完整平仓生命周期/);
  assert.equal(rendered, false);
});
