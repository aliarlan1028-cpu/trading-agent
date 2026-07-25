import { binanceSignedRequest, okxSignedRequest, toBinanceSymbol, toOkxSymbol } from "./exchangeConnector.mjs";
import { normalizeExchangeOrderState } from "./exchangeContract.mjs";
import { appendTrace, listOmsOrdersByState, transitionOmsOrder } from "./store.mjs";

export async function recoverUncertainOrders(db, options = {}) {
  const minAgeMs = Number(options.minAgeMs || 30_000);
  const candidates = listOmsOrdersByState(["UNKNOWN", "SUBMITTING"], options.limit || 50)
    .filter((order) => Date.now() - new Date(order.updatedAt || order.createdAt).getTime() >= minAgeMs);
  const results = [];
  for (const order of candidates) {
    try {
      const remote = await queryRemoteOrder(order);
      if (!remote) {
        results.push({ id: order.id, status: "not_found_keep_unknown" });
        continue;
      }
      const state = normalizeExchangeOrderState(order.exchange, remote.state);
      transitionOmsOrder(order.id, state, {
        eventType: "oms_reconciled",
        exchangeOrderId: remote.exchangeOrderId,
        response: remote
      });
      results.push({ id: order.id, status: state });
    } catch (error) {
      results.push({ id: order.id, status: "query_failed", error: error.message });
    }
  }
  if (candidates.length) appendTrace(db, "oms_recovery", `恢复检查 ${candidates.length} 单`, results.some((item) => item.status === "query_failed") ? "warning" : "ok", 0);
  return { checked: candidates.length, results };
}

async function queryRemoteOrder(order) {
  const request = order.request || {};
  // 非 place 动作的预留键是「动作:原键」派生键，交易所侧要用请求载荷里的原始 clientOrderId 查询。
  const clOrdId = request.clientOrderId || order.clientOrderId;
  if (order.exchange === "OKX") {
    if (!process.env.OKX_API_KEY) return null;
    const instId = toOkxSymbol(request.symbol, request.marketType || "perpetual");
    const raw = await okxSignedRequest(`/api/v5/trade/order?instId=${encodeURIComponent(instId)}&clOrdId=${encodeURIComponent(clOrdId)}`, "GET");
    const item = raw.data?.[0];
    if (!item) return null;
    return { state: item.state, exchangeOrderId: item.ordId, filledQuantity: Number(item.accFillSz || 0), avgPrice: Number(item.avgPx || 0) };
  }
  if (!process.env.BINANCE_API_KEY) return null;
  const symbol = toBinanceSymbol(request.symbol);
  const raw = await binanceSignedRequest("/fapi/v1/order", { symbol, origClientOrderId: clOrdId });
  if (!raw?.status) return null;
  return { state: raw.status, exchangeOrderId: raw.orderId, filledQuantity: Number(raw.executedQty || 0), avgPrice: Number(raw.avgPrice || 0) };
}
