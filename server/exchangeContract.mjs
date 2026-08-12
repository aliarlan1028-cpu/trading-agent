const CLIENT_ID_LIMITS = { OKX: 32 };
const SUPPORTED_EXCHANGES = new Set(["OKX"]);

export function validateExchangeOrderContract(action, payload = {}) {
  const exchange = String(payload.exchange || "OKX").toUpperCase();
  if (!SUPPORTED_EXCHANGES.has(exchange)) return { ok: false, reason: "unsupported_exchange" };
  const clientOrderId = String(payload.clientOrderId || "");
  if (clientOrderId && clientOrderId.length > CLIENT_ID_LIMITS[exchange]) {
    return { ok: false, reason: "client_order_id_too_long", limit: CLIENT_ID_LIMITS[exchange] };
  }
  if (clientOrderId && !/^[A-Za-z0-9]+$/.test(clientOrderId)) {
    return { ok: false, reason: "invalid_client_order_id" };
  }
  if (action === "place_order" && !payload.reduceOnly && !payload.closePosition) {
    const stop = Number(payload.stopLoss);
    const price = Number(payload.price || payload.markPrice);
    if (!Number.isFinite(stop) || stop <= 0) return { ok: false, reason: "native_stop_required" };
    if (Number.isFinite(price) && price > 0) {
      const side = String(payload.side || "BUY").toUpperCase();
      if (side === "BUY" && stop >= price) return { ok: false, reason: "long_stop_must_be_below_entry" };
      if (side === "SELL" && stop <= price) return { ok: false, reason: "short_stop_must_be_above_entry" };
    }
  }
  const quantity = Number(payload.quantity ?? payload.size);
  if (["place_order", "close_position"].includes(action) && !payload.closePosition) {
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, reason: "invalid_quantity" };
  }
  return { ok: true, exchange };
}

export function normalizeExchangeOrderState(exchange, state) {
  const value = String(state || "").toUpperCase();
  const common = {
    NEW: "ACKNOWLEDGED",
    LIVE: "ACKNOWLEDGED",
    OPEN: "ACKNOWLEDGED",
    PARTIALLY_FILLED: "PARTIAL",
    FILLED: "FILLED",
    CANCELED: "CANCELLED",
    CANCELLED: "CANCELLED",
    EXPIRED: "CANCELLED",
    REJECTED: "REJECTED"
  };
  if (String(exchange).toUpperCase() === "OKX" && value === "PARTIALLY_FILLED") return "PARTIAL";
  return common[value] || "UNKNOWN";
}

export function exchangeContractCapabilities(exchange) {
  const key = String(exchange || "").toUpperCase();
  if (key === "OKX") return { nativeStop: "attachAlgoOrds", amend: "native", clientOrderIdMax: 32 };
  return null;
}
