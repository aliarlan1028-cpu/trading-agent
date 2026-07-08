import { appendAudit, appendTrace, id, nowIso, verifyAuditChain } from "./store.mjs";
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

// 把内部拦截原因码翻成人话 + 指向对应开关位置，供前端/批准接口/Agent 使用。
const GUARD_REASON_DETAIL = {
  live_trading_disabled: { label: "实盘写入总开关未开启", fix: "系统设置 → 实盘灰度 → 勾选「LIVE_TRADING_ENABLED」并同时勾选「风险确认」" },
  real_trading_ack_missing: { label: "尚未确认理解真实交易风险", fix: "系统设置 → 实盘灰度 → 勾选「风险确认」" },
  real_order_write_disabled: { label: "真实下单写入未开启", fix: "系统设置 → 实盘灰度 → 勾选「真实下单写入」" },
  gray_policy_not_enabled: { label: "未启用小额灰度策略", fix: "系统设置 → 实盘灰度 → 勾选「启用小额灰度」并设置额度/币种" },
  symbol_not_allowed_by_gray_policy: { label: "该交易对不在灰度白名单内", fix: "系统设置 → 实盘灰度 → 把该交易对加入灰度允许列表" },
  notional_exceeds_gray_limit: { label: "下单名义额超过灰度上限", fix: "系统设置 → 实盘灰度 → 调高「单笔灰度额度」或减小下单量" },
  manual_approval_required: { label: "灰度策略要求人工确认", fix: "在批准时确认，或在实盘灰度里关闭「保留人工确认」" },
  kill_switch_enabled: { label: "一键熔断已开启，禁止新交易", fix: "顶部「熔断」按钮解除，或在风控里关闭熔断" },
  audit_chain_invalid: { label: "审计链校验未通过", fix: "联系管理员核对审计链；异常清除后才允许实盘写入" },
  api_key_metadata_missing: { label: "缺少该交易所的 API Key 元数据", fix: "系统设置 → 交易所 → 添加只读/交易 API Key" },
  api_key_withdraw_permission_enabled: { label: "该 API Key 带提现权限（禁止）", fix: "去交易所把该 Key 的提现权限关闭后重新配置" },
  api_key_permission_unverified: { label: "API Key 权限尚未审计确认", fix: "系统设置 → 交易所 → 确认该 Key 无提现权限" },
  account_snapshot_stale: { label: "账户快照过期，无法据实计算风险", fix: "先在仪表盘/账户里运行一次私有账户同步" },
  paper_validation_required: { label: "该策略尚未通过模拟盘前向验证", fix: "先在复盘/策略里跑模拟盘前向验证通过" },
  mandate_not_found: { label: "未找到可用授权委托 Mandate", fix: "先创建并激活一个 Mandate（可让 AI 交易员协助）" },
  mandate_action_not_allowed: { label: "该动作不在 Mandate 允许范围内", fix: "调整 Mandate 的允许动作或改用允许的动作" },
  duplicate_client_order_id: { label: "重复的客户端订单号", fix: "稍后重试或换一个订单" }
};

export function describeGuardReason(reason) {
  if (!reason) return null;
  const detail = GUARD_REASON_DETAIL[reason];
  if (detail) return { code: reason, ...detail };
  return { code: reason, label: reason, fix: "" };
}

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
  if (!(db.system.realTradingAck === true || process.env.I_UNDERSTAND_REAL_TRADING === "true")) return { allowed: false, reason: "real_trading_ack_missing" };
  if (!(db.system.orderWriteEnabled === true || process.env.REAL_ORDER_WRITE_ENABLED === "true")) return { allowed: false, reason: "real_order_write_disabled" };
  const apiKeySafety = validateApiKeySafety(db, payload);
  if (!apiKeySafety.allowed) return apiKeySafety;
  if (process.env.REQUIRE_AUDIT_CHAIN_OK !== "false") {
    const auditChain = verifyAuditChain(db);
    if (!auditChain.ok) return { allowed: false, reason: "audit_chain_invalid", breaks: auditChain.breaks.length };
  }
  const provenance = validateExecutionProvenance(payload);
  if (!provenance.allowed) return provenance;
  if (db.system.killSwitch) return { allowed: false, reason: "kill_switch_enabled" };

  const mandateGuard = validateMandateGuard(db, action, payload);
  if (!mandateGuard.allowed) return mandateGuard;

  // 可选安全垫：要求策略先通过模拟盘前向验证，才允许对该交易对开新仓。
  // 只拦截"开仓"，绝不拦截减仓/平仓/撤单等降风险动作。
  const isNewEntry = action === "place_order" && !payload.reduceOnly && !payload.closePosition;
  if (isNewEntry) {
    const accountSnapshot = validateFreshAccountSnapshot(db, payload);
    if (!accountSnapshot.allowed) return accountSnapshot;
  }
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

function validateApiKeySafety(db, payload) {
  const exchange = String(payload.exchange || "BINANCE").toUpperCase();
  const metadata = (db.apiKeyMetadata || []).find((item) => item.exchange === exchange);
  if (!metadata) return { allowed: false, reason: "api_key_metadata_missing", exchange };
  if (metadata.withdrawPermission === true) return { allowed: false, reason: "api_key_withdraw_permission_enabled", exchange };
  // 实盘写入时绝不放行未经审计确认无提现权限的 Key；REQUIRE_API_PERMISSION_VERIFICATION=false 的开发旁路仅在非实盘生效。
  const allowUnverifiedBypass = process.env.REQUIRE_API_PERMISSION_VERIFICATION === "false" && !db.system.liveTradingEnabled;
  if (!allowUnverifiedBypass && !metadata.permissionVerifiedAt) return { allowed: false, reason: "api_key_permission_unverified", exchange };
  return { allowed: true };
}

function validateFreshAccountSnapshot(db, payload) {
  const exchange = String(payload.exchange || "BINANCE").toUpperCase();
  const maxAgeMs = Number(process.env.MAX_ACCOUNT_SNAPSHOT_AGE_MS || 10 * 60_000);
  const snapshots = (db.accountSnapshots || []).filter((item) => {
    if (String(item.exchange || "").toUpperCase() !== exchange) return false;
    if (payload.accountId && item.accountId !== payload.accountId) return false;
    return item.status === "ok";
  });
  const snapshot = snapshots[0];
  if (!snapshot) return { allowed: false, reason: "account_snapshot_required", exchange };
  const ageMs = Date.now() - new Date(snapshot.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) {
    return { allowed: false, reason: "account_snapshot_stale", exchange, snapshotId: snapshot.id, ageMs, maxAgeMs };
  }
  return { allowed: true, snapshotId: snapshot.id, ageMs };
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
