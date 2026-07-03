import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { binanceSignedRequest, okxSignedRequest, toBinanceSymbol, toOkxSymbol } from "./exchangeConnector.mjs";
import { hasPassedPaper } from "./paperTrading.mjs";

const WRITE_ACTIONS = new Set(["place_order", "cancel_order", "amend_order", "close_position", "move_stop", "take_profit"]);
const ACTION_TO_MANDATE = {
  place_order: "open",
  cancel_order: "cancel",
  amend_order: "amend",
  close_position: "close",
  move_stop: "move_stop",
  take_profit: "take_profit"
};
const TERMINAL_ORDER_STATES = new Set(["filled", "canceled", "cancelled", "rejected", "expired", "closed"]);

export async function executeTradeAction(db, action, payload = {}) {
  const guard = validateWriteGuard(db, action, payload);
  if (!guard.allowed) {
    appendAudit(db, `交易写操作被拦截：${guard.reason}`, action, "TradeActionGateway", "warning");
    appendTrace(db, "trade_write_guard", `${action} blocked`, "blocked");
    return { status: "blocked", reason: guard.reason, guard };
  }

  let result;
  const exchange = String(payload.exchange || "BINANCE").toUpperCase();
  if (exchange === "OKX") result = await executeOkxAction(action, payload);
  else result = await executeBinanceAction(action, payload);

  const record = {
    id: id("order_action"),
    action,
    exchange,
    payloadSummary: summarizePayload(payload),
    result,
    createdAt: nowIso()
  };
  db.orders.unshift({
    id: record.id,
    planId: payload.planId,
    exchange,
    symbol: payload.symbol,
    type: payload.type || action,
    side: payload.side,
    price: payload.price,
    status: result.status || "submitted",
    clientOrderId: payload.clientOrderId || result.clientOrderId,
    raw: result.raw ? "[stored_in_audit]" : undefined,
    createdAt: record.createdAt
  });
  appendAudit(db, `执行交易写操作：${action}`, record.id, "TradeExecutor", result.status === "ok" ? "info" : "warning");
  appendTrace(db, "trade_write", `${exchange} ${action}`, result.status || "submitted");
  return { status: result.status || "submitted", actionId: record.id, ...result };
}

function validateWriteGuard(db, action, payload) {
  if (!WRITE_ACTIONS.has(action)) return { allowed: false, reason: "unknown_action" };
  const shape = validatePayloadShape(action, payload);
  if (!shape.allowed) return shape;
  const duplicate = action === "place_order" || action === "take_profit" ? findDuplicateClientOrder(db, payload) : null;
  if (duplicate) return { allowed: false, reason: "duplicate_client_order_id", clientOrderId: payload.clientOrderId, orderId: duplicate.id };
  if (!db.system.liveTradingEnabled) return { allowed: false, reason: "live_trading_disabled" };
  if (process.env.I_UNDERSTAND_REAL_TRADING !== "true") return { allowed: false, reason: "real_trading_ack_missing" };
  if (process.env.REAL_ORDER_WRITE_ENABLED !== "true") return { allowed: false, reason: "real_order_write_disabled" };
  const provenance = validateExecutionProvenance(payload);
  if (!provenance.allowed) return provenance;
  if (db.system.killSwitch) return { allowed: false, reason: "kill_switch_enabled" };

  const mandateGuard = validateMandateGuard(db, action, payload);
  if (!mandateGuard.allowed) return mandateGuard;

  // 可选安全垫：要求策略先通过模拟盘前向验证，才允许对该交易对开新仓。
  // 只拦截"开仓"，绝不拦截减仓/平仓/撤单等降风险动作。
  const isNewEntry = action === "place_order" && !payload.reduceOnly && !payload.closePosition;
  if (process.env.REQUIRE_PAPER_VALIDATION === "true" && isNewEntry && !hasPassedPaper(db, payload.symbol)) {
    return { allowed: false, reason: "paper_validation_required", symbol: payload.symbol };
  }

  const policy = (db.grayReleasePolicies || []).find((item) => item.enabled);
  if (!policy) return { allowed: false, reason: "gray_policy_not_enabled" };
  if (payload.symbol && policy.allowedSymbols?.length && !policy.allowedSymbols.includes(payload.symbol)) return { allowed: false, reason: "symbol_not_allowed_by_gray_policy" };

  const notional = estimateNotional(payload);
  const maxNotional = Number(policy.maxNotionalUsdt || process.env.MAX_LIVE_NOTIONAL_USDT || 50);
  if (notional > maxNotional) return { allowed: false, reason: "notional_exceeds_gray_limit", notional, maxNotional };
  if (policy.requiresManualApproval && payload.manualApproval !== true) return { allowed: false, reason: "manual_approval_required" };
  return { allowed: true, notional, maxNotional, policyId: policy.id, mandateId: mandateGuard.mandateId };
}

function validateExecutionProvenance(payload) {
  const required = ["agentRunId", "analysisBundleId", "tradePlanId", "riskCheckId", "mandateId"];
  const missing = required.filter((key) => !payload[key] && !payload[toSnake(key)]);
  if (missing.length) return { allowed: false, reason: "missing_execution_provenance", missing };
  return { allowed: true };
}

function toSnake(key) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

async function executeBinanceAction(action, payload) {
  if (!process.env.BINANCE_API_KEY || !process.env.BINANCE_API_SECRET) return { status: "missing_credentials" };
  const symbol = toBinanceSymbol(payload.symbol);
  const futures = isBinanceFutures(payload);
  const orderPath = futures ? "/fapi/v1/order" : "/api/v3/order";
  if (action === "place_order") {
    const params = {
      symbol,
      side: String(payload.side || "BUY").toUpperCase(),
      type: String(payload.type || "LIMIT").toUpperCase(),
      quantity: String(payload.quantity),
      newClientOrderId: payload.clientOrderId || id("coid")
    };
    if (futures && payload.reduceOnly !== undefined) params.reduceOnly = String(Boolean(payload.reduceOnly));
    if (futures && payload.positionSide) params.positionSide = String(payload.positionSide).toUpperCase();
    if (futures && payload.closePosition) params.closePosition = "true";
    if (futures && payload.workingType) params.workingType = payload.workingType;
    if (params.type === "LIMIT") Object.assign(params, { timeInForce: payload.timeInForce || "GTC", price: String(payload.price) });
    if (params.type === "STOP_LOSS_LIMIT" || params.type === "TAKE_PROFIT_LIMIT") Object.assign(params, { stopPrice: String(payload.stopPrice || payload.stopLoss), price: String(payload.price || payload.stopPrice || payload.stopLoss), timeInForce: payload.timeInForce || "GTC" });
    if (params.type === "STOP_MARKET" || params.type === "TAKE_PROFIT_MARKET") Object.assign(params, { stopPrice: String(payload.stopPrice || payload.stopLoss || payload.price) });
    const raw = await binanceSignedRequest(orderPath, params, { method: "POST" });
    const protection = payload.stopLoss && payload.attachProtection !== false && futures && !payload.reduceOnly
      ? await placeBinanceProtectiveStop(payload, symbol)
      : null;
    return { status: "ok", raw, exchangeOrderId: raw.orderId, clientOrderId: raw.clientOrderId, protection };
  }
  if (action === "cancel_order") {
    const raw = await binanceSignedRequest(orderPath, { symbol, orderId: payload.orderId, origClientOrderId: payload.clientOrderId }, { method: "DELETE" });
    return { status: "ok", raw, exchangeOrderId: raw.orderId };
  }
  if (action === "amend_order") {
    const cancel = await executeBinanceAction("cancel_order", payload);
    const place = await executeBinanceAction("place_order", { ...payload, clientOrderId: payload.newClientOrderId || id("coid") });
    return { status: "ok", cancel, place };
  }
  if (action === "close_position") {
    return executeBinanceAction("place_order", { ...payload, side: payload.positionSide === "short" ? "BUY" : "SELL", type: "MARKET", reduceOnly: true, manualApproval: true });
  }
  if (action === "move_stop") {
    return executeBinanceAction("amend_order", { ...payload, type: isBinanceFutures(payload) ? "STOP_MARKET" : "STOP_LOSS_LIMIT", stopPrice: payload.stopPrice, price: payload.price || payload.stopPrice, reduceOnly: true });
  }
  if (action === "take_profit") {
    if (Array.isArray(payload.targets) && payload.targets.length) {
      const orders = [];
      for (const target of payload.targets) {
        orders.push(await executeBinanceAction("place_order", {
          ...payload,
          ...target,
          side: target.side || payload.side || "SELL",
          type: target.type || (isBinanceFutures(payload) ? "TAKE_PROFIT_MARKET" : "TAKE_PROFIT_LIMIT"),
          stopPrice: target.stopPrice || target.price,
          reduceOnly: true,
          clientOrderId: target.clientOrderId || id("tp")
        }));
      }
      return { status: "ok", batch: true, orders };
    }
    return executeBinanceAction("place_order", { ...payload, side: payload.side || "SELL", type: isBinanceFutures(payload) ? "TAKE_PROFIT_MARKET" : "TAKE_PROFIT_LIMIT", stopPrice: payload.stopPrice || payload.price, reduceOnly: true });
  }
  return { status: "unsupported_action" };
}

async function executeOkxAction(action, payload) {
  if (!process.env.OKX_API_KEY || !process.env.OKX_API_SECRET || !process.env.OKX_API_PASSPHRASE) return { status: "missing_credentials" };
  const instId = toOkxSymbol(payload.symbol, payload.marketType);
  if (action === "place_order") {
    const body = JSON.stringify({
      instId,
      tdMode: payload.tdMode || process.env.OKX_MARGIN_MODE || "cross",
      side: String(payload.side || "buy").toLowerCase(),
      ordType: String(payload.ordType || payload.type || "limit").toLowerCase(),
      sz: String(payload.quantity || payload.size),
      px: payload.price ? String(payload.price) : undefined,
      clOrdId: payload.clientOrderId || id("coid"),
      reduceOnly: Boolean(payload.reduceOnly)
    });
    const raw = await okxSignedRequest("/api/v5/trade/order", "POST", body);
    return { status: raw.code === "0" ? "ok" : "exchange_rejected", raw, exchangeOrderId: raw.data?.[0]?.ordId, clientOrderId: raw.data?.[0]?.clOrdId };
  }
  if (action === "cancel_order") {
    const raw = await okxSignedRequest("/api/v5/trade/cancel-order", "POST", JSON.stringify({ instId, ordId: payload.orderId, clOrdId: payload.clientOrderId }));
    return { status: raw.code === "0" ? "ok" : "exchange_rejected", raw };
  }
  if (action === "amend_order") {
    const raw = await okxSignedRequest("/api/v5/trade/amend-order", "POST", JSON.stringify({ instId, ordId: payload.orderId, clOrdId: payload.clientOrderId, newSz: payload.newSize ? String(payload.newSize) : undefined, newPx: payload.newPrice ? String(payload.newPrice) : undefined }));
    return { status: raw.code === "0" ? "ok" : "exchange_rejected", raw };
  }
  if (action === "close_position") {
    const raw = await okxSignedRequest("/api/v5/trade/close-position", "POST", JSON.stringify({ instId, mgnMode: payload.tdMode || process.env.OKX_MARGIN_MODE || "cross", posSide: payload.posSide }));
    return { status: raw.code === "0" ? "ok" : "exchange_rejected", raw };
  }
  if (action === "move_stop" || action === "take_profit") {
    if (action === "take_profit" && Array.isArray(payload.targets) && payload.targets.length) {
      const orders = [];
      for (const target of payload.targets) {
        orders.push(await executeOkxAction("place_order", {
          ...payload,
          ...target,
          side: target.side || payload.side || "sell",
          ordType: target.ordType || target.type || "conditional",
          reduceOnly: true,
          clientOrderId: target.clientOrderId || id("tp")
        }));
      }
      return { status: "ok", batch: true, orders };
    }
    return executeOkxAction("place_order", { ...payload, ordType: payload.ordType || "conditional", reduceOnly: true });
  }
  return { status: "unsupported_action" };
}

function estimateNotional(payload) {
  if (Array.isArray(payload.targets) && payload.targets.length) {
    return payload.targets.reduce((sum, target) => sum + estimateNotional({ ...payload, ...target }), 0);
  }
  const price = Number(payload.price || payload.stopPrice || payload.markPrice || 0);
  const quantity = Number(payload.quantity || payload.size || 0);
  if (!Number.isFinite(price) || !Number.isFinite(quantity)) return 0;
  return Math.abs(price * quantity);
}

function summarizePayload(payload) {
  const safe = { ...payload };
  delete safe.apiSecret;
  delete safe.secret;
  delete safe.passphrase;
  return safe;
}

function validatePayloadShape(action, payload) {
  if (!payload.symbol && !["cancel_order", "amend_order"].includes(action)) return { allowed: false, reason: "missing_symbol" };
  if (action === "place_order") {
    if (!payload.quantity && !payload.size && !payload.closePosition) return { allowed: false, reason: "missing_quantity" };
    if (!payload.reduceOnly && !payload.stopLoss && !payload.stopLossOrderId && !payload.stopPrice) return { allowed: false, reason: "missing_stop_loss_for_new_entry" };
  }
  if (action === "cancel_order" && !payload.orderId && !payload.clientOrderId) return { allowed: false, reason: "missing_order_identifier" };
  if (action === "amend_order" && !payload.orderId && !payload.clientOrderId) return { allowed: false, reason: "missing_order_identifier" };
  if (action === "move_stop" && !payload.stopPrice && !payload.stopLoss) return { allowed: false, reason: "missing_new_stop" };
  if (action === "close_position" && !payload.quantity && !payload.size && !payload.closePosition) return { allowed: false, reason: "missing_close_size" };
  if (action === "take_profit" && !payload.price && !payload.stopPrice && !Array.isArray(payload.targets)) return { allowed: false, reason: "missing_take_profit_target" };
  return { allowed: true };
}

function findDuplicateClientOrder(db, payload) {
  if (!payload.clientOrderId) return null;
  return (db.orders || []).find((order) => order.clientOrderId === payload.clientOrderId && !TERMINAL_ORDER_STATES.has(String(order.status || "").toLowerCase()));
}

function validateMandateGuard(db, action, payload) {
  const mandate = db.mandates.find((item) => item.id === payload.mandateId)
    || db.mandates.find((item) => ["running", "active"].includes(item.status));
  if (!mandate) return { allowed: false, reason: "missing_active_mandate" };
  if (!["running", "active"].includes(mandate.status)) return { allowed: false, reason: "mandate_not_active", mandateId: mandate.id };
  if (mandate.validUntil && new Date(mandate.validUntil).getTime() <= Date.now()) return { allowed: false, reason: "mandate_expired", mandateId: mandate.id };
  const symbol = payload.symbol;
  if (symbol && mandate.allowedSymbols?.length && !mandate.allowedSymbols.includes(symbol)) return { allowed: false, reason: "symbol_not_allowed_by_mandate", mandateId: mandate.id };
  if (symbol && mandate.deniedSymbols?.includes(symbol)) return { allowed: false, reason: "symbol_denied_by_mandate", mandateId: mandate.id };
  if (payload.marketType && mandate.marketTypes?.length && !mandate.marketTypes.includes(payload.marketType)) return { allowed: false, reason: "market_type_not_allowed_by_mandate", mandateId: mandate.id };
  const mandateAction = payload.reduceOnly && action === "place_order" ? "close" : ACTION_TO_MANDATE[action];
  if (mandateAction && mandate.allowedActions?.length && !mandate.allowedActions.includes(mandateAction)) return { allowed: false, reason: "action_not_allowed_by_mandate", mandateId: mandate.id, mandateAction };
  const maxLeverage = Number(mandate.maxLeverageBySymbol?.[symbol] || mandate.maxLeverage || 1);
  if (payload.leverage && Number(payload.leverage) > maxLeverage) return { allowed: false, reason: "leverage_exceeds_mandate", mandateId: mandate.id, maxLeverage };
  return { allowed: true, mandateId: mandate.id };
}

function isBinanceFutures(payload) {
  const marketType = String(payload.marketType || process.env.BINANCE_MARKET_TYPE || "").toLowerCase();
  return marketType.includes("perpetual") || marketType.includes("future") || marketType.includes("usdm");
}

async function placeBinanceProtectiveStop(payload, symbol) {
  const side = String(payload.side || "BUY").toUpperCase() === "BUY" ? "SELL" : "BUY";
  const params = {
    symbol,
    side,
    type: "STOP_MARKET",
    stopPrice: String(payload.stopLoss),
    quantity: String(payload.quantity || payload.size),
    reduceOnly: "true",
    newClientOrderId: payload.stopClientOrderId || id("stop")
  };
  if (payload.positionSide) params.positionSide = String(payload.positionSide).toUpperCase();
  if (payload.workingType) params.workingType = payload.workingType;
  return binanceSignedRequest("/fapi/v1/order", params, { method: "POST" });
}
