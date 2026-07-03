import { executeTradeAction } from "./tradeActions.mjs";
import { binanceSignedRequest, okxSignedRequest, toBinanceSymbol, toOkxSymbol } from "./exchangeConnector.mjs";
import { portfolioCapNotional } from "./portfolioRisk.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

// ---------------------------------------------------------------------------
// ExecutionEngine：把"已批准的交易计划"翻译成真实订单并全程跟踪。
// 唯一合法执行入口；直接调用 tradeActions 的路径仍受其七层安全闸约束。
// ---------------------------------------------------------------------------

const OPEN_EXECUTION_STATES = new Set(["submitted", "entry_pending", "entry_filled", "protecting"]);
const DEFAULT_TAKER_FEE_RATE = 0.0004;

function asNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inferMarketRegime(db, symbol) {
  const market = (db.markets || []).find((item) => item.symbol === symbol) || {};
  const change = asNumber(market.changePct, 0);
  const funding = asNumber(market.fundingRate, 0);
  if (Math.abs(change) >= 4) return "高波动趋势";
  if (Math.abs(change) <= 0.8) return "震荡低波动";
  if (Math.abs(funding) >= 0.03) return "资金费率拥挤";
  return change >= 0 ? "上行趋势" : "下行趋势";
}

function currentFundingRate(db, symbol) {
  const market = (db.markets || []).find((item) => item.symbol === symbol) || {};
  return asNumber(String(market.fundingRate || "").replace("%", ""), 0);
}

function feeEstimate(notional) {
  return Number((Math.abs(Number(notional || 0)) * DEFAULT_TAKER_FEE_RATE).toFixed(6));
}

function slippageBps(actual, expected, direction = "long") {
  const actualPrice = Number(actual);
  const expectedPrice = Number(expected);
  if (!Number.isFinite(actualPrice) || !Number.isFinite(expectedPrice) || expectedPrice <= 0) return null;
  const raw = ((actualPrice - expectedPrice) / expectedPrice) * 10000;
  return Number((direction === "short" ? -raw : raw).toFixed(2));
}

function entryRationale(plan = {}) {
  return plan.rationale || plan.analysis || plan.reason || plan.summary || plan.entry?.rationale || "未记录入场理由";
}

export function currentEquityUsdt(db) {
  const snapshot = (db.accountSnapshots || []).find((item) => item.status === "ok");
  if (snapshot) {
    if (snapshot.exchange === "OKX") {
      const total = Number(snapshot.balances?.[0]?.totalEq);
      if (Number.isFinite(total) && total > 0) return total;
    }
    if (snapshot.exchange === "BINANCE") {
      const usdt = (snapshot.balances || []).find((item) => item.asset === "USDT");
      const total = Number(usdt?.free || 0) + Number(usdt?.locked || 0);
      if (total > 0) return total;
    }
  }
  const fromPortfolio = Number(db.portfolio?.totalEquityUsdt);
  return Number.isFinite(fromPortfolio) && fromPortfolio > 0 ? fromPortfolio : null;
}

export function computePositionSize(db, plan) {
  const entryLow = Number(plan.entry_range?.[0]);
  const entryHigh = Number(plan.entry_range?.[1] ?? entryLow);
  const stop = Number(plan.stopLoss ?? plan.stop_loss);
  const entryMid = (entryLow + entryHigh) / 2;
  if (!Number.isFinite(entryMid) || !Number.isFinite(stop) || entryMid <= 0) {
    return { error: "invalid_entry_or_stop" };
  }
  const stopDistance = Math.abs(entryMid - stop);
  if (stopDistance <= 0) return { error: "zero_stop_distance" };

  const riskPct = Number(plan.entry?.riskPercent ?? plan.max_loss_pct ?? 0.3);
  const equity = currentEquityUsdt(db);
  const policy = (db.grayReleasePolicies || []).find((item) => item.enabled);
  const maxNotional = Number(policy?.maxNotionalUsdt || process.env.MAX_LIVE_NOTIONAL_USDT || 50);

  let quantity;
  let sizedBy;
  if (equity) {
    const riskAmount = equity * (riskPct / 100);
    quantity = riskAmount / stopDistance;
    sizedBy = "risk_budget";
  } else {
    quantity = maxNotional / entryMid;
    sizedBy = "gray_notional_fallback";
  }
  let notional = quantity * entryMid;
  if (notional > maxNotional) {
    quantity = maxNotional / entryMid;
    notional = maxNotional;
    sizedBy = `${sizedBy}+gray_capped`;
  }
  // 组合级波动率目标：相关性感知地压低会突破组合波动预算的名义额度。
  const mandate = db.mandates.find((m) => m.id === plan.mandateId) || db.mandates.find((m) => ["active", "running"].includes(m.status));
  const volCap = portfolioCapNotional(db, plan, equity, mandate);
  if (volCap !== null && volCap < notional) {
    quantity = volCap / entryMid;
    notional = volCap;
    sizedBy = `${sizedBy}+portfolio_vol_capped`;
  }
  quantity = roundQuantity(quantity, entryMid);
  if (quantity <= 0) return { error: "quantity_rounds_to_zero", notional, maxNotional, sizedBy };
  return { quantity, entryMid, stopDistance, notional: quantity * entryMid, riskPct, equity, maxNotional, volCap, sizedBy };
}

function roundQuantity(quantity, price) {
  const decimals = price > 10000 ? 4 : price > 100 ? 3 : price > 1 ? 2 : 0;
  return Number(quantity.toFixed(decimals));
}

export async function executeApprovedPlan(db, planId, options = {}) {
  const plan = db.tradePlans.find((item) => item.id === planId);
  if (!plan) return { status: "missing_plan", planId };
  if (plan.status !== "approved") return { status: "plan_not_approved", planStatus: plan.status };
  if (!plan.lastRiskCheck?.passed) return { status: "risk_not_passed" };
  const mandate = db.mandates.find((item) => item.id === plan.mandateId);
  if (!mandate || !["active", "running"].includes(mandate.status)) return { status: "mandate_not_active" };
  const existing = (db.executionOrders || []).find((item) => item.planId === plan.id && OPEN_EXECUTION_STATES.has(item.status));
  if (existing) return { status: "already_executing", executionOrderId: existing.id };

  const sizing = computePositionSize(db, plan);
  if (sizing.error) {
    appendAudit(db, `执行引擎拒绝计划：${sizing.error}`, plan.id, "ExecutionEngine", "warning");
    return { status: "sizing_failed", ...sizing };
  }

  const executionOrder = {
    id: id("exec"),
    planId: plan.id,
    agentRunId: plan.agentRunId,
    mandateId: plan.mandateId,
    riskCheckId: plan.riskCheckId,
    analysisBundleId: plan.analysisBundleId,
    exchange: plan.exchange,
    symbol: plan.symbol,
    direction: plan.direction,
    strategy: plan.strategy || plan.strategy_type || "manual_review",
    entryRationale: entryRationale(plan),
    confidenceBefore: asNumber(plan.confidenceBefore ?? plan.confidence),
    confidenceAfter: asNumber(plan.confidenceAfter ?? plan.lastRiskCheck?.confidence),
    regime: inferMarketRegime(db, plan.symbol),
    quantity: sizing.quantity,
    entryPrice: sizing.entryMid,
    stopLoss: Number(plan.stopLoss ?? plan.stop_loss),
    takeProfits: (plan.takeProfit || plan.take_profit || []).map(Number).filter(Number.isFinite),
    notionalUsdt: sizing.notional,
    sizedBy: sizing.sizedBy,
    status: "created",
    events: [{ at: nowIso(), event: "created", detail: `数量 ${sizing.quantity}，名义 ${sizing.notional.toFixed(2)} USDT（${sizing.sizedBy}）` }],
    createdAt: nowIso()
  };
  db.executionOrders.unshift(executionOrder);

  if (!db.system.liveTradingEnabled) {
    executionOrder.status = "dry_run";
    executionOrder.events.push({ at: nowIso(), event: "dry_run", detail: "实盘写入关闭：已完成数量与价格计算，未向交易所提交。" });
    appendAudit(db, "执行引擎干跑：实盘写入关闭", executionOrder.id, "ExecutionEngine");
    appendTrace(db, "execution", `${plan.symbol} 干跑（实盘关闭）`, "guarded");
    plan.executionOrderId = executionOrder.id;
    return { status: "dry_run", executionOrder };
  }

  const side = plan.direction === "short" ? "SELL" : "BUY";
  const result = await executeTradeAction(db, "place_order", {
    exchange: plan.exchange,
    marketType: plan.marketType || "perpetual_usdt",
    symbol: plan.symbol,
    side,
    type: "LIMIT",
    price: sizing.entryMid,
    quantity: sizing.quantity,
    stopLoss: executionOrder.stopLoss,
    leverage: plan.leverage,
    clientOrderId: `exec_${executionOrder.id.slice(-12)}`,
    agentRunId: plan.agentRunId,
    analysisBundleId: plan.analysisBundleId,
    tradePlanId: plan.id,
    riskCheckId: plan.riskCheckId,
    mandateId: plan.mandateId,
    manualApproval: options.manualApproval === true
  });

  if (result.status === "blocked") {
    executionOrder.status = "blocked";
    executionOrder.events.push({ at: nowIso(), event: "blocked", detail: result.reason });
    appendAudit(db, `执行被安全闸拦截：${result.reason}`, executionOrder.id, "ExecutionEngine", "warning");
    return { status: "blocked", reason: result.reason, executionOrder };
  }
  if (result.status !== "ok" && result.status !== "submitted") {
    executionOrder.status = "failed";
    executionOrder.events.push({ at: nowIso(), event: "failed", detail: JSON.stringify(result).slice(0, 300) });
    appendAudit(db, "执行提交失败", executionOrder.id, "ExecutionEngine", "warning");
    return { status: "failed", result, executionOrder };
  }

  executionOrder.status = "entry_pending";
  executionOrder.exchangeOrderId = result.exchangeOrderId;
  executionOrder.clientOrderId = result.clientOrderId || `exec_${executionOrder.id.slice(-12)}`;
  executionOrder.protection = result.protection ? "attached" : "pending";
  executionOrder.events.push({ at: nowIso(), event: "entry_submitted", detail: `交易所订单 ${result.exchangeOrderId || "?"}` });
  plan.status = "executing";
  plan.executionOrderId = executionOrder.id;
  appendAudit(db, "执行引擎已提交入场单", executionOrder.id, "ExecutionEngine");
  appendTrace(db, "execution", `${plan.symbol} 入场单已提交`, "ok");
  return { status: "submitted", executionOrder };
}

// ---------------------------------------------------------------------------
// 订单状态轮询：入场成交 → 布置止盈；终态 → 记录成交与盈亏。
// ---------------------------------------------------------------------------
export async function pollExecutionOrders(db) {
  const open = (db.executionOrders || []).filter((item) => ["entry_pending", "entry_filled", "protecting"].includes(item.status));
  const results = [];
  for (const executionOrder of open) {
    try {
      results.push(await pollOne(db, executionOrder));
    } catch (error) {
      executionOrder.events.push({ at: nowIso(), event: "poll_error", detail: error.message });
      results.push({ id: executionOrder.id, status: "poll_error", error: error.message });
    }
  }
  return { checked: open.length, results };
}

async function pollOne(db, executionOrder) {
  const orderState = await fetchOrderState(executionOrder);
  if (!orderState) return { id: executionOrder.id, status: executionOrder.status, note: "no_state" };

  if (executionOrder.status === "entry_pending" && orderState.state === "filled") {
    executionOrder.status = "entry_filled";
    executionOrder.filledPrice = orderState.avgPrice || executionOrder.entryPrice;
    executionOrder.entryFilledAt = nowIso();
    executionOrder.entrySlippageBps = slippageBps(executionOrder.filledPrice, executionOrder.entryPrice, executionOrder.direction);
    executionOrder.entryFeeUsdt = feeEstimate(Number(executionOrder.filledPrice) * Number(executionOrder.quantity));
    executionOrder.maeUsdt = 0;
    executionOrder.mfeUsdt = 0;
    executionOrder.events.push({ at: nowIso(), event: "entry_filled", detail: `均价 ${executionOrder.filledPrice}` });
    recordFill(db, executionOrder, "entry", executionOrder.filledPrice, executionOrder.quantity);
    upsertPosition(db, executionOrder);
    await placeTakeProfits(db, executionOrder);
    appendAudit(db, `入场成交：${executionOrder.symbol} @ ${executionOrder.filledPrice}`, executionOrder.id, "ExecutionEngine");
    appendTrace(db, "execution", `${executionOrder.symbol} 入场成交`, "ok");
  } else if (orderState.state === "canceled") {
    executionOrder.status = "cancelled";
    executionOrder.events.push({ at: nowIso(), event: "entry_cancelled", detail: "交易所侧订单已取消" });
    const plan = db.tradePlans.find((item) => item.id === executionOrder.planId);
    if (plan) plan.status = "cancelled";
  }
  return { id: executionOrder.id, status: executionOrder.status, exchangeState: orderState.state };
}

async function fetchOrderState(executionOrder) {
  const exchange = String(executionOrder.exchange || "BINANCE").toUpperCase();
  if (exchange === "OKX") {
    if (!process.env.OKX_API_KEY) return null;
    const instId = toOkxSymbol(executionOrder.symbol, "perpetual");
    const raw = await okxSignedRequest(`/api/v5/trade/order?instId=${instId}&clOrdId=${executionOrder.clientOrderId}`, "GET");
    const order = raw.data?.[0];
    if (!order) return null;
    const stateMap = { live: "open", partially_filled: "open", filled: "filled", canceled: "canceled" };
    return { state: stateMap[order.state] || order.state, avgPrice: Number(order.avgPx) || null };
  }
  if (!process.env.BINANCE_API_KEY) return null;
  const symbol = toBinanceSymbol(executionOrder.symbol);
  const raw = await binanceSignedRequest("/fapi/v1/order", { symbol, origClientOrderId: executionOrder.clientOrderId });
  if (!raw?.status) return null;
  const stateMap = { NEW: "open", PARTIALLY_FILLED: "open", FILLED: "filled", CANCELED: "canceled", EXPIRED: "canceled", REJECTED: "canceled" };
  return { state: stateMap[raw.status] || "open", avgPrice: Number(raw.avgPrice) || null };
}

async function placeTakeProfits(db, executionOrder) {
  if (!executionOrder.takeProfits?.length) {
    executionOrder.status = "protecting";
    return;
  }
  const closeSide = executionOrder.direction === "short" ? "BUY" : "SELL";
  const perTarget = roundQuantity(executionOrder.quantity / executionOrder.takeProfits.length, executionOrder.entryPrice);
  const result = await executeTradeAction(db, "take_profit", {
    exchange: executionOrder.exchange,
    marketType: "perpetual_usdt",
    symbol: executionOrder.symbol,
    side: closeSide,
    quantity: perTarget,
    targets: executionOrder.takeProfits.map((price, index) => ({
      price,
      stopPrice: price,
      quantity: perTarget,
      clientOrderId: `tp${index + 1}_${executionOrder.id.slice(-10)}`
    })),
    agentRunId: executionOrder.agentRunId,
    analysisBundleId: executionOrder.analysisBundleId,
    tradePlanId: executionOrder.planId,
    riskCheckId: executionOrder.riskCheckId,
    mandateId: executionOrder.mandateId,
    manualApproval: true
  });
  executionOrder.status = "protecting";
  executionOrder.events.push({ at: nowIso(), event: "take_profits_placed", detail: `状态 ${result.status}` });
}

function recordFill(db, executionOrder, kind, price, quantity, realizedPnl = null, extra = {}) {
  db.fills ||= [];
  const notional = Number(price) * Number(quantity);
  const plan = (db.tradePlans || []).find((item) => item.id === executionOrder.planId) || {};
  const feeUsdt = extra.feeUsdt ?? (kind === "entry" ? executionOrder.entryFeeUsdt : feeEstimate(notional));
  db.fills.unshift({
    id: id("fill"),
    executionOrderId: executionOrder.id,
    planId: executionOrder.planId,
    tradePlanId: executionOrder.planId,
    agentRunId: executionOrder.agentRunId,
    riskCheckId: executionOrder.riskCheckId,
    mandateId: executionOrder.mandateId,
    symbol: executionOrder.symbol,
    direction: executionOrder.direction,
    strategy: executionOrder.strategy || plan.strategy || plan.strategy_type || "manual_review",
    regime: executionOrder.regime || inferMarketRegime(db, executionOrder.symbol),
    kind,
    price: Number(price),
    quantity: Number(quantity),
    notionalUsdt: notional,
    expectedPrice: kind === "entry" ? executionOrder.entryPrice : extra.expectedPrice,
    slippageBps: extra.slippageBps ?? (kind === "entry" ? executionOrder.entrySlippageBps : null),
    feeUsdt,
    estimatedFee: extra.feeUsdt === undefined,
    fundingRate: extra.fundingRate,
    fundingFeeUsdt: extra.fundingFeeUsdt,
    holdingMinutes: extra.holdingMinutes,
    maeUsdt: extra.maeUsdt,
    mfeUsdt: extra.mfeUsdt,
    entryRationale: executionOrder.entryRationale || entryRationale(plan),
    exitReason: extra.exitReason,
    realizedPnl,
    createdAt: nowIso()
  });
}

function upsertPosition(db, executionOrder) {
  db.positions ||= [];
  let position = db.positions.find((item) => item.symbol === executionOrder.symbol && item.source === "execution_engine");
  if (!position) {
    position = { id: id("pos"), symbol: executionOrder.symbol, source: "execution_engine" };
    db.positions.unshift(position);
  }
  Object.assign(position, {
    direction: executionOrder.direction === "short" ? "空" : "多",
    size: executionOrder.quantity,
    entry: executionOrder.filledPrice || executionOrder.entryPrice,
    stopLoss: executionOrder.stopLoss,
    takeProfits: executionOrder.takeProfits,
    executionOrderId: executionOrder.id,
    planId: executionOrder.planId,
    openedAt: executionOrder.entryFilledAt || nowIso(),
    maeUsdt: 0,
    mfeUsdt: 0,
    regime: executionOrder.regime,
    entryRationale: executionOrder.entryRationale
  });
}

// 手动关闭一个执行中的订单/持仓（用户或风控触发）。
export async function closeExecution(db, executionOrderId, reason = "manual") {
  const executionOrder = (db.executionOrders || []).find((item) => item.id === executionOrderId);
  if (!executionOrder) return { status: "missing_execution_order" };
  if (executionOrder.status === "entry_pending") {
    const result = await executeTradeAction(db, "cancel_order", {
      exchange: executionOrder.exchange,
      marketType: "perpetual_usdt",
      symbol: executionOrder.symbol,
      clientOrderId: executionOrder.clientOrderId,
      agentRunId: executionOrder.agentRunId,
      analysisBundleId: executionOrder.analysisBundleId,
      tradePlanId: executionOrder.planId,
      riskCheckId: executionOrder.riskCheckId,
      mandateId: executionOrder.mandateId,
      manualApproval: true
    });
    executionOrder.status = result.status === "blocked" ? executionOrder.status : "cancelled";
    executionOrder.events.push({ at: nowIso(), event: "cancel_requested", detail: reason });
    return { status: executionOrder.status, result };
  }
  if (["entry_filled", "protecting"].includes(executionOrder.status)) {
    const result = await executeTradeAction(db, "close_position", {
      exchange: executionOrder.exchange,
      marketType: "perpetual_usdt",
      symbol: executionOrder.symbol,
      quantity: executionOrder.quantity,
      positionSide: executionOrder.direction,
      agentRunId: executionOrder.agentRunId,
      analysisBundleId: executionOrder.analysisBundleId,
      tradePlanId: executionOrder.planId,
      riskCheckId: executionOrder.riskCheckId,
      mandateId: executionOrder.mandateId,
      manualApproval: true
    });
    if (result.status !== "blocked") {
      const market = db.markets.find((item) => item.symbol === executionOrder.symbol);
      const exitPrice = Number(market?.price || executionOrder.filledPrice || executionOrder.entryPrice);
      const entry = Number(executionOrder.filledPrice || executionOrder.entryPrice);
      const sign = executionOrder.direction === "short" ? -1 : 1;
      const pnl = (exitPrice - entry) * executionOrder.quantity * sign;
      const openedAt = new Date(executionOrder.entryFilledAt || executionOrder.createdAt).getTime();
      const holdingMinutes = Number.isFinite(openedAt) ? Math.max(0, Math.round((Date.now() - openedAt) / 60000)) : null;
      const notional = exitPrice * executionOrder.quantity;
      const fundingRate = currentFundingRate(db, executionOrder.symbol);
      const fundingFeeUsdt = holdingMinutes === null ? null : Number((notional * (fundingRate / 100) * (holdingMinutes / 480)).toFixed(6));
      const closeFeeUsdt = feeEstimate(notional);
      recordFill(db, executionOrder, "close", exitPrice, executionOrder.quantity, pnl, {
        feeUsdt: closeFeeUsdt,
        fundingRate,
        fundingFeeUsdt,
        holdingMinutes,
        maeUsdt: executionOrder.maeUsdt ?? 0,
        mfeUsdt: executionOrder.mfeUsdt ?? 0,
        slippageBps: slippageBps(exitPrice, executionOrder.lastMark || exitPrice, executionOrder.direction),
        expectedPrice: executionOrder.lastMark || exitPrice,
        exitReason: reason
      });
      executionOrder.status = "closed";
      executionOrder.realizedPnl = pnl;
      executionOrder.exitReason = reason;
      executionOrder.closedAt = nowIso();
      executionOrder.holdingMinutes = holdingMinutes;
      executionOrder.closeFeeUsdt = closeFeeUsdt;
      executionOrder.fundingFeeUsdt = fundingFeeUsdt;
      executionOrder.events.push({ at: nowIso(), event: "closed", detail: `${reason}，盈亏 ${pnl.toFixed(2)} USDT` });
      db.positions = (db.positions || []).filter((item) => item.executionOrderId !== executionOrder.id);
      const plan = db.tradePlans.find((item) => item.id === executionOrder.planId);
      if (plan) plan.status = "completed";
      appendAudit(db, `平仓完成：${executionOrder.symbol}，盈亏 ${pnl.toFixed(2)} USDT`, executionOrder.id, "ExecutionEngine", pnl >= 0 ? "info" : "warning");
    }
    return { status: executionOrder.status, result };
  }
  return { status: "not_closable", currentStatus: executionOrder.status };
}
