import { executeTradeAction } from "./tradeActions.mjs";
import { binanceSignedRequest, okxSignedRequest, toBinanceSymbol, toOkxSymbol } from "./exchangeConnector.mjs";
import { portfolioCapNotional } from "./portfolioRisk.mjs";
import { evaluateTradePlan } from "./riskEngine.mjs";
import { reviewTradeSetup } from "./setupReview.mjs";
import { activeMandate, acquireExecutionLease, appendAudit, appendTrace, id, nowIso, releaseExecutionLease, transitionOmsOrder } from "./store.mjs";

// ---------------------------------------------------------------------------
// ExecutionEngine：把"已批准的交易计划"翻译成真实订单并全程跟踪。
// 唯一合法执行入口；直接调用 tradeActions 的路径仍受其七层安全闸约束。
// ---------------------------------------------------------------------------

const OPEN_EXECUTION_STATES = new Set(["submitted", "entry_pending", "entry_partial", "entry_filled", "protecting"]);
const DEFAULT_TAKER_FEE_RATE = 0.0004;
// OKX clOrdId 只接受字母+数字(≤32)——带下划线会被 51000「Parameter clOrdId error」整单拒绝
// (曾导致所有 OKX 自动单静默失败)。统一清洗成字母数字;币安也接受字母数字,故两所通用。
const cleanClOrdId = (seed) => String(seed).replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);

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
  const mandate = db.mandates.find((m) => m.id === plan.mandateId) || activeMandate(db);
  const volCap = portfolioCapNotional(db, plan, equity, mandate);
  if (volCap !== null && volCap < notional) {
    quantity = volCap / entryMid;
    notional = volCap;
    sizedBy = `${sizedBy}+portfolio_vol_capped`;
  }
  const MIN_NOTIONAL = 5;
  quantity = roundQuantity(quantity, entryMid);
  if (quantity <= 0 && equity > 0) quantity = 0; // 先按四舍五入后的量,下方小账户放大再兜
  // 小账户自动放大:AI 选的风险%算出的仓位低于交易所最小额时,自动上调到最小额(取整后仍≥5U),
  // 但风险严格封顶在授权单笔风险上限内(用户要"按更接近上限定仓")。上限也不够才如实拒。
  const capped = `${sizedBy}`.includes("gray_capped") || `${sizedBy}`.includes("vol_capped");
  if (quantity * entryMid < MIN_NOTIONAL && !capped && MIN_NOTIONAL <= maxNotional) {
    const decimals = entryMid > 10000 ? 4 : entryMid > 100 ? 3 : entryMid > 1 ? 2 : 0;
    const factor = 10 ** decimals;
    const minQty = Math.ceil((MIN_NOTIONAL / entryMid) * factor - 1e-9) / factor; // 向上取整确保取整后仍≥最小额
    const ceilingPct = Number(mandate?.maxSingleTradeRiskPct ?? mandate?.max_single_trade_risk_pct ?? riskPct);
    const minRiskPct = equity > 0 ? (minQty * stopDistance / equity) * 100 : Infinity;
    if (minRiskPct <= ceilingPct + 1e-9) {
      quantity = minQty;
      notional = quantity * entryMid;
      sizedBy = `${sizedBy}+min_notional_scaled(风险升至${minRiskPct.toFixed(2)}%≤上限${ceilingPct}%)`;
    }
  }
  if (quantity <= 0) return { error: "quantity_rounds_to_zero", notional, maxNotional, sizedBy };
  if (quantity * entryMid < MIN_NOTIONAL) return { error: "below_min_notional", notional: quantity * entryMid, minNotional: MIN_NOTIONAL, sizedBy, ceilingPct: Number(mandate?.maxSingleTradeRiskPct ?? "-") };
  return { quantity, entryMid, stopDistance, notional: quantity * entryMid, riskPct, equity, maxNotional, volCap, sizedBy };
}

function roundQuantity(quantity, price) {
  const decimals = price > 10000 ? 4 : price > 100 ? 3 : price > 1 ? 2 : 0;
  const factor = 10 ** decimals;
  return Math.floor(quantity * factor + 1e-9) / factor; // 向下取整:toFixed 四舍五入曾把实际风险放大近一倍
}

export function allocateProtectionQuantities(totalQuantity, targetCount, price) {
  const total = Number(totalQuantity);
  const count = Math.max(0, Number(targetCount) || 0);
  if (!Number.isFinite(total) || total <= 0 || count <= 0) return [];
  const decimals = price > 10000 ? 4 : price > 100 ? 3 : price > 1 ? 2 : 0;
  const factor = 10 ** decimals;
  const totalUnits = Math.floor(total * factor + 1e-9);
  if (totalUnits < count) return [];
  const baseUnits = Math.floor(totalUnits / count);
  let remaining = totalUnits;
  return Array.from({ length: count }, (_, index) => {
    const units = index === count - 1 ? remaining : baseUnits;
    remaining -= units;
    return units / factor;
  });
}

// 保护失败统一收口：尽力撤入场单（撤单本身也可能抛异常，必须捕获——否则会跳过熔断），
// 并把计划置为终态 protection_failed（executeApprovedPlan 只执行 approved 计划，
// 防止同一计划被自动路径反复执行产生多个裸仓；人工重新批准可显式解锁）。
async function failProtectionAndCancelEntry(db, plan, executionOrder, entry, causeDetail) {
  let cancelResult;
  try {
    cancelResult = await executeTradeAction(db, "cancel_order", {
      exchange: plan.exchange,
      marketType: plan.marketType || "perpetual_usdt",
      symbol: plan.symbol,
      orderId: entry.exchangeOrderId,
      clientOrderId: entry.clientOrderId,
      agentRunId: plan.agentRunId,
      analysisBundleId: plan.analysisBundleId,
      tradePlanId: plan.id,
      riskCheckId: plan.riskCheckId,
      mandateId: plan.mandateId,
      manualApproval: true
    });
  } catch (error) {
    cancelResult = { status: "error", error: String(error.message || error).slice(0, 200) };
  }
  executionOrder.status = "protection_failed";
  executionOrder.events.push({ at: nowIso(), event: "protection_failed", detail: `${causeDetail}；入场单撤销状态 ${cancelResult.status}` });
  plan.status = "protection_failed";
  plan.executionOrderId = executionOrder.id;
  // "订单不存在"类响应 = 交易所确认从未收到/已终态该单 → 无裸仓风险,不必熔断
  // (此前小账户被拒单后撤"不存在的单"失败 → 每次尝试都误拉全站熔断,审计 P1-4)。
  const cancelRawText = JSON.stringify(cancelResult.raw || cancelResult || {});
  const confirmedAbsent = /unknown order|order does not exist|-2011|"51603"|"51000"/i.test(cancelRawText);
  if (!["ok", "submitted"].includes(cancelResult.status) && !confirmedAbsent) {
    db.system.killSwitch = true;
    db.riskIncidents.unshift({
      id: id("incident"),
      severity: "critical",
      status: "open",
      title: "入场保护单失败且撤单未确认",
      source: executionOrder.id,
      createdAt: nowIso()
    });
  }
  appendAudit(db, `${causeDetail}，已阻断入场并尝试撤单`, executionOrder.id, "ExecutionEngine", "critical");
  return { status: "protection_failed", cancelResult, executionOrder };
}

export async function executeApprovedPlan(db, planId, options = {}) {
  const instanceId = process.env.INSTANCE_ID || `pid-${process.pid}`;
  const lease = acquireExecutionLease(`trade-plan:${planId}`, instanceId, 60_000);
  if (!lease.acquired) return { status: "execution_lease_held", lease };
  try {
    return await executeApprovedPlanLeased(db, planId, options);
  } finally {
    // 任何路径（含异常/early return）都归还租约；释放失败由 60s TTL 兜底。
    try { releaseExecutionLease(`trade-plan:${planId}`, instanceId, lease.fencingToken); } catch { /* TTL 兜底 */ }
  }
}

async function executeApprovedPlanLeased(db, planId, options = {}) {
  const plan = db.tradePlans.find((item) => item.id === planId);
  if (!plan) return { status: "missing_plan", planId };
  if (plan.status !== "approved") return { status: "plan_not_approved", planStatus: plan.status };
  // (P2-1)不再看陈旧 lastRiskCheck:上次复查失败会永久卡死计划,即便阻断条件已恢复;
  // 下面的 fresh 复查才是唯一裁判。
  const freshRisk = evaluateTradePlan(db, plan);
  freshRisk.tradePlanId = plan.id;
  freshRisk.createdAt = nowIso();
  db.riskChecks.unshift(freshRisk);
  plan.lastRiskCheck = freshRisk;
  plan.riskCheckId = freshRisk.id;
  if (!freshRisk.passed) {
    appendAudit(db, `执行前风控复查失败：${freshRisk.summary}`, plan.id, "ExecutionEngine", "warning");
    appendTrace(db, "risk_check", `${plan.symbol} 执行前复查失败`, "blocked");
    return { status: "risk_recheck_failed", riskCheck: freshRisk };
  }
  const mandate = db.mandates.find((item) => item.id === plan.mandateId);
  if (!mandate || !["active", "running"].includes(mandate.status)) return { status: "mandate_not_active" };
  if (Number(plan.mandateVersion || 1) !== Number(mandate.version || 1)) {
    return { status: "mandate_version_stale", planVersion: plan.mandateVersion || 1, mandateVersion: mandate.version || 1 };
  }
  const existing = (db.executionOrders || []).find((item) => item.planId === plan.id && OPEN_EXECUTION_STATES.has(item.status));
  if (existing) return { status: "already_executing", executionOrderId: existing.id };

  const sizing = computePositionSize(db, plan);
  if (sizing.error) {
    // 把"批准了却没下单"的真实原因写到计划上,前端好显示(用户实锤:approved 但无订单、界面不说为什么)。
    const human = sizing.error === "below_min_notional"
      ? `仓位约 ${Number(sizing.notional || 0).toFixed(2)} USDT，低于交易所最小名义额 ${sizing.minNotional || 5} USDT——账户太小或单笔风险%太低，无法下出有效订单`
      : sizing.error === "quantity_rounds_to_zero" ? "计算仓位四舍五入为 0，账户过小"
      : sizing.error === "invalid_entry_or_stop" ? "入场/止损数值非法"
      : sizing.error === "zero_stop_distance" ? "入场与止损相等，止损距离为 0" : sizing.error;
    plan.executionBlock = { reason: sizing.error, detail: human, at: nowIso() };
    appendAudit(db, `执行引擎未下单（${sizing.error}）：${human}`, plan.id, "ExecutionEngine", "warning");
    return { status: "sizing_failed", ...sizing, detail: human };
  }
  plan.executionBlock = null;

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
    knowledgeSkills: plan.knowledgeSkills || [],
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

  // 执行前 SRTL 结构审核（质量闸，风控闸之外的第二道）：喂真实 4H+1H K 线逐项审核 setup，
  // 并用授权反推的盈亏比做硬门槛。实盘时 FAIL 直接拦截；干跑也审核但只记录不拦，便于观察质量。
  try {
    const review = await reviewTradeSetup(db, {
      symbol: plan.symbol, direction: plan.direction,
      entry: sizing.entryMid, entryLow: plan.entryLow, entryHigh: plan.entryHigh,
      stopLoss: executionOrder.stopLoss, takeProfit: executionOrder.takeProfits, id: plan.id
    }, { minR: Number(mandate?.minRewardRisk ?? process.env.SRTL_MIN_R ?? 2.0) });
    executionOrder.setupReview = { verdict: review.verdict, reason: review.reason, rewardRisk: review.rewardRisk, checklist: review.checklist };
    executionOrder.events.push({ at: nowIso(), event: "setup_review", detail: `SRTL ${review.verdict}：${review.reason || ""}` });
    if (review.verdict === "FAIL" && db.system.liveTradingEnabled) {
      executionOrder.status = "setup_rejected";
      plan.status = "setup_rejected";
      plan.executionOrderId = executionOrder.id;
      appendAudit(db, `SRTL 结构审核拒绝，未下单：${review.reason || ""}`, executionOrder.id, "ExecutionEngine", "warning");
      return { status: "setup_rejected", review, executionOrder };
    }
  } catch (error) {
    // 审核本身异常不阻断交易主流程（风控闸已通过），仅记录。
    executionOrder.events.push({ at: nowIso(), event: "setup_review_error", detail: String(error.message || error).slice(0, 160) });
  }

  if (!db.system.liveTradingEnabled) {
    executionOrder.status = "dry_run";
    executionOrder.events.push({ at: nowIso(), event: "dry_run", detail: "实盘写入关闭：已完成数量与价格计算，未向交易所提交。" });
    appendAudit(db, "执行引擎干跑：实盘写入关闭", executionOrder.id, "ExecutionEngine");
    appendTrace(db, "execution", `${plan.symbol} 干跑（实盘关闭）`, "guarded");
    plan.executionOrderId = executionOrder.id;
    return { status: "dry_run", executionOrder };
  }

  const side = plan.direction === "short" ? "SELL" : "BUY";
  const entryClientOrderId = cleanClOrdId(`exec${executionOrder.id.slice(-12)}`);
  const stopClientOrderId = cleanClOrdId(`stop${executionOrder.id.slice(-12)}`);
  let result;
  try {
    result = await executeTradeAction(db, "place_order", {
      exchange: plan.exchange,
      marketType: plan.marketType || "perpetual_usdt",
      symbol: plan.symbol,
      side,
      type: "LIMIT",
      price: sizing.entryMid,
      quantity: sizing.quantity,
      stopLoss: executionOrder.stopLoss,
      stopClientOrderId,
      leverage: plan.leverage,
      strategyId: executionOrder.strategy,
      timeframe: plan.timeframe || plan.candlesTimeframe || null,
      knowledgeSkills: executionOrder.knowledgeSkills,
      clientOrderId: entryClientOrderId,
      agentRunId: plan.agentRunId,
      analysisBundleId: plan.analysisBundleId,
      tradePlanId: plan.id,
      riskCheckId: plan.riskCheckId,
      mandateId: plan.mandateId,
      manualApproval: options.manualApproval === true
    });
  } catch (error) {
    // 入场调用抛异常（如止损附单被交易所拒绝后 HTTP 非 2xx 直接 throw）：
    // 入场是否已在交易所存活【未知】（OMS 已置 UNKNOWN，恢复任务会对账）。
    // 绝不允许可能存在的裸仓静默存活：按保护失败流程尽力撤单，撤不掉即熔断。
    executionOrder.events.push({ at: nowIso(), event: "entry_exception", detail: String(error.message || error).slice(0, 200) });
    return await failProtectionAndCancelEntry(db, plan, executionOrder, {
      exchangeOrderId: null,
      clientOrderId: entryClientOrderId
    }, `入场调用异常：${String(error.message || error).slice(0, 120)}`);
  }

  if (result.status === "blocked") {
    executionOrder.status = "blocked";
    executionOrder.events.push({ at: nowIso(), event: "blocked", detail: result.reason });
    appendAudit(db, `执行被安全闸拦截：${result.reason}`, executionOrder.id, "ExecutionEngine", "warning");
    return { status: "blocked", reason: result.reason, executionOrder };
  }
  if (!["ok", "submitted", "idempotent_replay"].includes(result.status)) {
    executionOrder.status = "failed";
    executionOrder.events.push({ at: nowIso(), event: "failed", detail: JSON.stringify(result).slice(0, 300) });
    appendAudit(db, "执行提交失败", executionOrder.id, "ExecutionEngine", "warning");
    return { status: "failed", result, executionOrder };
  }
  // 新仓绝不允许以“保护单稍后再说”的状态进入市场。若交易所没有确认原生止损，
  // 立即撤进入场单；撤单失败则熔断并产生最高级事故，交由人工处置。
  if (!result.protection) {
    return await failProtectionAndCancelEntry(db, plan, executionOrder, result, "原生止损未确认");
  }

  executionOrder.status = "entry_pending";
  executionOrder.exchangeOrderId = result.exchangeOrderId;
  executionOrder.omsOrderId = result.omsOrderId || null;
  executionOrder.clientOrderId = result.clientOrderId || entryClientOrderId;
  executionOrder.stopClientOrderId = stopClientOrderId;
  executionOrder.okxCtVal = result.okxCtVal || null; // OKX 张数→币数量换算面值(轮询回填用)
  executionOrder.protection = "attached";
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
  const open = (db.executionOrders || []).filter((item) => ["entry_pending", "entry_partial", "entry_filled", "protecting"].includes(item.status));
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
  // OKX 返回的 accFillSz 是张数,统一换算回币数量(引擎全程币本位)。
  if (executionOrder.okxCtVal && orderState.filledQuantity != null) {
    orderState.filledQuantity = Number(orderState.filledQuantity) * Number(executionOrder.okxCtVal);
  }

  if (["entry_pending", "entry_partial"].includes(executionOrder.status) && orderState.state === "partial") {
    const filledQuantity = Number(orderState.filledQuantity || 0);
    const previousFilled = Number(executionOrder.filledQuantity || 0);
    const delta = Math.max(0, filledQuantity - previousFilled);
    executionOrder.status = "entry_partial";
    executionOrder.filledQuantity = filledQuantity;
    executionOrder.filledPrice = orderState.avgPrice || executionOrder.filledPrice || executionOrder.entryPrice;
    executionOrder.events.push({ at: nowIso(), event: "entry_partial", detail: `累计成交 ${filledQuantity}/${executionOrder.quantity}` });
    if (delta > 0) recordFill(db, executionOrder, "entry", executionOrder.filledPrice, delta, null, { partial: true });
    upsertPosition(db, executionOrder, filledQuantity);
    if (executionOrder.omsOrderId) {
      transitionOmsOrder(executionOrder.omsOrderId, "PARTIAL", {
        eventType: "entry_partial",
        exchangeOrderId: executionOrder.exchangeOrderId,
        response: { avgPrice: executionOrder.filledPrice, filledQuantity }
      });
    }
  } else if (["entry_pending", "entry_partial"].includes(executionOrder.status) && orderState.state === "filled") {
    executionOrder.status = "entry_filled";
    if (executionOrder.omsOrderId) {
      transitionOmsOrder(executionOrder.omsOrderId, "FILLED", {
        eventType: "entry_filled",
        exchangeOrderId: executionOrder.exchangeOrderId,
        response: { avgPrice: orderState.avgPrice || executionOrder.entryPrice }
      });
    }
    executionOrder.filledPrice = orderState.avgPrice || executionOrder.entryPrice;
    executionOrder.entryFilledAt = nowIso();
    executionOrder.entrySlippageBps = slippageBps(executionOrder.filledPrice, executionOrder.entryPrice, executionOrder.direction);
    executionOrder.entryFeeUsdt = feeEstimate(Number(executionOrder.filledPrice) * Number(executionOrder.quantity));
    executionOrder.maeUsdt = 0;
    executionOrder.mfeUsdt = 0;
    executionOrder.events.push({ at: nowIso(), event: "entry_filled", detail: `均价 ${executionOrder.filledPrice}` });
    const previousFilled = Number(executionOrder.filledQuantity || 0);
    const remainingFill = Math.max(0, Number(executionOrder.quantity) - previousFilled);
    executionOrder.filledQuantity = Number(executionOrder.quantity);
    if (remainingFill > 0) recordFill(db, executionOrder, "entry", executionOrder.filledPrice, remainingFill);
    upsertPosition(db, executionOrder, executionOrder.filledQuantity);
    await placeTakeProfits(db, executionOrder);
    appendAudit(db, `入场成交：${executionOrder.symbol} @ ${executionOrder.filledPrice}`, executionOrder.id, "ExecutionEngine");
    appendTrace(db, "execution", `${executionOrder.symbol} 入场成交`, "ok");
  } else if (["entry_filled", "protecting"].includes(executionOrder.status)) {
    // (P0-3)入场已终态后,交易所侧 SL/TP 成交不会反映在入场单状态上——此前系统对
    // 止损打掉完全失明:持仓残留、计划卡 executing、日亏预算不扣减。
    // 以最近的交易所持仓快照为准:快照新鲜且该 symbol 仓位已消失 → 保护单已成交,推断收口。
    const latestSnap = (db.accountSnapshots || []).find((x) => x.status === "ok");
    const snapFresh = latestSnap && (Date.now() - new Date(latestSnap.createdAt).getTime()) < Number(process.env.MAX_ACCOUNT_SNAPSHOT_AGE_MS || 600000);
    const stillOnExchange = (db.positions || []).some((p) => p.source === "exchange_rest" && p.symbol === executionOrder.symbol && Number(p.size ?? p.pos ?? 0) !== 0);
    if (snapFresh && !stillOnExchange && Number(executionOrder.filledQuantity || 0) > 0) {
      const market = db.markets?.find((m) => m.symbol === executionOrder.symbol);
      const exitPrice = Number(market?.price) || Number(executionOrder.stopLoss) || Number(executionOrder.filledPrice);
      const sign = executionOrder.direction === "short" ? -1 : 1;
      const qty = Number(executionOrder.filledQuantity);
      const realized = (exitPrice - Number(executionOrder.filledPrice)) * qty * sign - feeEstimate(exitPrice * qty);
      recordFill(db, executionOrder, "close", exitPrice, qty, Number(realized.toFixed(2)), { inferred: true, estimated: true });
      executionOrder.status = "closed";
      executionOrder.closedAt = nowIso();
      executionOrder.exitReason = "protection_triggered_inferred";
      executionOrder.events.push({ at: nowIso(), event: "protection_triggered_inferred", detail: `交易所仓位已消失,按现价 ${exitPrice} 推断保护单成交,已实现 ${realized.toFixed(2)} USDT(估算)` });
      db.positions = (db.positions || []).filter((p) => !(p.source === "execution_engine" && p.symbol === executionOrder.symbol));
      const plan = db.tradePlans.find((item) => item.id === executionOrder.planId);
      if (plan) plan.status = "completed";
      appendAudit(db, `保护单触发推断收口:${executionOrder.symbol} 已实现 ${realized.toFixed(2)} USDT(按现价估算)`, executionOrder.id, "ExecutionEngine", "warning");
      appendTrace(db, "execution", `${executionOrder.symbol} 保护单成交(推断)`, "ok");
    }
  } else if (orderState.state === "canceled") {
    executionOrder.status = "cancelled";
    if (executionOrder.omsOrderId) {
      transitionOmsOrder(executionOrder.omsOrderId, "CANCELLED", { eventType: "entry_cancelled" });
    }
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
    const stateMap = { live: "open", partially_filled: "partial", filled: "filled", canceled: "canceled" };
    return {
      state: stateMap[order.state] || order.state,
      avgPrice: Number(order.avgPx) || null,
      filledQuantity: Number(order.accFillSz || 0)
    };
  }
  if (!process.env.BINANCE_API_KEY) return null;
  const symbol = toBinanceSymbol(executionOrder.symbol);
  const raw = await binanceSignedRequest("/fapi/v1/order", { symbol, origClientOrderId: executionOrder.clientOrderId });
  if (!raw?.status) return null;
  const stateMap = { NEW: "open", PARTIALLY_FILLED: "partial", FILLED: "filled", CANCELED: "canceled", EXPIRED: "canceled", REJECTED: "canceled" };
  return { state: stateMap[raw.status] || "open", avgPrice: Number(raw.avgPrice) || null, filledQuantity: Number(raw.executedQty || 0) };
}

async function placeTakeProfits(db, executionOrder) {
  if (!executionOrder.takeProfits?.length) {
    executionOrder.status = "protecting";
    return;
  }
  const closeSide = executionOrder.direction === "short" ? "BUY" : "SELL";
  let tpTargets = executionOrder.takeProfits;
  let quantities = allocateProtectionQuantities(executionOrder.quantity, tpTargets.length, executionOrder.entryPrice);
  // (P1-4)数量太小分不出多档 → 降级为单档全仓止盈;彻底分不出也不熔断——
  // 原生止损在入场时已确认存在(这是不变量),缺止盈是"离场质量降级"不是"裸仓"。
  if (quantities.length !== tpTargets.length && tpTargets.length > 1) {
    tpTargets = [executionOrder.takeProfits[0]];
    quantities = allocateProtectionQuantities(executionOrder.quantity, 1, executionOrder.entryPrice);
  }
  if (quantities.length !== tpTargets.length) {
    executionOrder.status = "protecting";
    executionOrder.protection = "stop_only";
    executionOrder.events.push({ at: nowIso(), event: "take_profit_allocation_failed", detail: "数量过小无法布置止盈,仅保留原生止损(降级)" });
    db.riskIncidents.unshift({ id: id("incident"), severity: "medium", status: "open", title: `止盈未布置(数量过小):${executionOrder.symbol} 仅止损保护`, source: executionOrder.id, createdAt: nowIso() });
    appendAudit(db, "止盈分配失败,降级为仅止损保护", executionOrder.id, "ExecutionEngine", "warning");
    return;
  }
  let result;
  try {
    result = await executeTradeAction(db, "take_profit", {
      exchange: executionOrder.exchange,
      marketType: "perpetual_usdt",
      symbol: executionOrder.symbol,
      side: closeSide,
      quantity: Math.max(...quantities),
      targets: tpTargets.map((price, index) => ({
        price,
        stopPrice: price,
        quantity: quantities[index],
        clientOrderId: cleanClOrdId(`tp${index + 1}${executionOrder.id.slice(-10)}`)
      })),
      agentRunId: executionOrder.agentRunId,
      analysisBundleId: executionOrder.analysisBundleId,
      tradePlanId: executionOrder.planId,
      riskCheckId: executionOrder.riskCheckId,
      mandateId: executionOrder.mandateId,
      manualApproval: true
    });
  } catch (error) {
    // 止盈下单异常：仓位已成交在场、原生止损仍在（入场时已确认），但止盈缺失。
    // 标记保护降级 + 熔断新开仓 + 事故，交由人工处置；不静默吞掉。
    executionOrder.status = "protection_failed";
    executionOrder.events.push({ at: nowIso(), event: "take_profit_exception", detail: String(error.message || error).slice(0, 200) });
    const tpPlan = db.tradePlans?.find((item) => item.id === executionOrder.planId);
    if (tpPlan) tpPlan.status = "protection_failed";
    db.system.killSwitch = true;
    db.riskIncidents.unshift({
      id: id("incident"),
      severity: "critical",
      status: "open",
      title: "止盈单布置失败（止损仍在），需人工确认离场计划",
      source: executionOrder.id,
      createdAt: nowIso()
    });
    appendAudit(db, "止盈单布置异常，已熔断并转人工", executionOrder.id, "ExecutionEngine", "critical");
    return;
  }
  // (P1-1)检查真实结果:批量路径此前恒 ok,交易所逐单拒绝会被静默吞掉。
  if (!["ok", "submitted"].includes(result.status)) {
    executionOrder.status = "protecting";
    executionOrder.protection = "stop_only";
    executionOrder.events.push({ at: nowIso(), event: "take_profit_rejected", detail: `止盈单未全部落地(${result.status},失败 ${result.failedCount ?? "?"}),保留原生止损` });
    db.riskIncidents.unshift({ id: id("incident"), severity: "medium", status: "open", title: `止盈单被拒(${result.status}):${executionOrder.symbol} 仅止损保护`, source: executionOrder.id, createdAt: nowIso() });
    appendAudit(db, `止盈单未全部落地(${result.status}),降级为仅止损保护`, executionOrder.id, "ExecutionEngine", "warning");
    return;
  }
  executionOrder.tpClientOrderIds = tpTargets.map((_, index) => `tp${index + 1}_${executionOrder.id.slice(-10)}`);
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
    partial: Boolean(extra.partial),
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

function upsertPosition(db, executionOrder, filledSize = executionOrder.quantity) {
  db.positions ||= [];
  let position = db.positions.find((item) => item.symbol === executionOrder.symbol && item.source === "execution_engine");
  if (!position) {
    position = { id: id("pos"), symbol: executionOrder.symbol, source: "execution_engine" };
    db.positions.unshift(position);
  }
  Object.assign(position, {
    direction: executionOrder.direction === "short" ? "空" : "多",
    size: Number(filledSize),
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
  if (["entry_pending", "entry_partial"].includes(executionOrder.status)) {
    const wasPartial = executionOrder.status === "entry_partial";
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
    const confirmed = ["ok", "submitted", "idempotent_replay"].includes(result.status);
    executionOrder.status = confirmed ? "cancelled" : executionOrder.status;
    executionOrder.events.push({ at: nowIso(), event: "cancel_requested", detail: reason });
    if (!confirmed) executionOrder.events.push({ at: nowIso(), event: "cancel_unconfirmed", detail: result.reason || result.status || "unknown" });
    if (!confirmed) return { status: "cancel_unconfirmed", result };
    if (wasPartial && Number(executionOrder.filledQuantity || 0) > 0) {
      executionOrder.status = "entry_filled";
      executionOrder.quantity = Number(executionOrder.filledQuantity);
      executionOrder.events.push({ at: nowIso(), event: "partial_remainder_cancelled", detail: `剩余委托已撤，继续平掉已成交 ${executionOrder.quantity}` });
      return closeExecution(db, executionOrder.id, reason);
    }
    return { status: "cancelled", result };
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
    const confirmed = ["ok", "submitted", "idempotent_replay"].includes(result.status);
    if (confirmed) {
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
      return { status: executionOrder.status, result };
    }
    executionOrder.events.push({ at: nowIso(), event: "close_unconfirmed", detail: result.reason || result.status || "unknown" });
    return { status: "close_unconfirmed", result };
  }
  return { status: "not_closable", currentStatus: executionOrder.status };
}
