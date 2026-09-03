import { buildExecutionView, buildMarketRows, buildPositionView, findReviewTrade, netReviewResult, positionNotionalUsdt } from "../../viewData.js";

const rows = (value) => Array.isArray(value) ? value : [];
const finiteNumber = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const timeOf = (row) => new Date(row.updatedAt ?? row.completedAt ?? row.createdAt ?? 0).getTime() || 0;
const byNewest = (a, b) => timeOf(b) - timeOf(a);

export function cockpitObjectId(row = {}) {
  return row.id ?? row.positionId ?? row.instId ?? row.orderId ?? row.tradeLifecycleId ?? row.symbol ?? null;
}

export function buildOverviewTradeFlow(data = {}) {
  const fills = Array.isArray(data.fills) ? data.fills : [];
  const filledOrderIds = new Set(fills.map((row) => row.orderId).filter(Boolean).map(String));
  const remainingOrders = (Array.isArray(data.executionOrders) ? data.executionOrders : [])
    .filter((row) => !filledOrderIds.has(String(row.id)));
  return [...fills, ...remainingOrders].sort(byNewest);
}

export function buildOverviewPresentation(data = {}) {
  const positions = buildPositionPresentation(data);
  const markets = buildMarketRows(data);
  return {
    portfolio: data.portfolio ?? {},
    market: data.activeMarket ?? markets[0] ?? null,
    markets,
    positions,
    allocation: positions.positions,
    tradeFlow: buildOverviewTradeFlow(data),
    systemNotice: rows(data.notifications)[0] ?? (data.automationState ? { title: data.automationState.detail ?? data.automationState.label } : null),
    marketNotice: rows(data.events)[0] ?? null,
    aiRead: data.marketRegime ?? null,
    activities: [...rows(data.agentRuns), ...rows(data.jobRuns)].sort(byNewest),
    strategyProducts: rows(data.strategyCatalog?.products),
    accountSnapshots: rows(data.accountSnapshots)
  };
}

export function buildSelectedExecutionStages(data = {}, order = {}) {
  const orderId = String(order.id ?? order.orderId ?? "");
  const planId = String(order.tradePlanId ?? order.planId ?? "");
  const plan = rows(data.tradePlans).find((row) => String(row.id) === planId) ?? null;
  const risk = rows(data.riskChecks).find((row) => (orderId && String(row.executionOrderId ?? "") === orderId) || (planId && String(row.tradePlanId ?? row.planId ?? "") === planId)) ?? null;
  const fills = orderId ? rows(data.fills).filter((row) => String(row.orderId ?? row.executionOrderId ?? "") === orderId) : [];
  const protectedOrder = /stop|protect|take_profit|止损|止盈/i.test(String(order.type ?? order.kind ?? order.purpose ?? ""));
  return [
    { id: "signal", done: Boolean(plan), detail: plan?.signal ?? plan?.strategy ?? null },
    { id: "risk", done: /pass|approved/i.test(String(risk?.status ?? "")), detail: risk?.summary ?? null },
    { id: "routing", done: Boolean(order.exchange ?? order.venue), detail: order.exchange ?? order.venue ?? null },
    { id: "order", done: Boolean(orderId), detail: order.status ?? null },
    { id: "fill", done: fills.length > 0, detail: fills.length ? String(fills.length) : null },
    { id: "protection", done: protectedOrder, detail: protectedOrder ? order.type ?? order.kind : null }
  ];
}

export function buildPositionPresentation(data = {}) {
  const base = buildPositionView(data);
  const orders = rows(data.executionOrders);
  const plans = rows(data.tradePlans);
  return {
    ...base,
    positions: base.positions.map((position) => {
      const executionOrderId = position.executionOrderId ?? null;
      const positionId = position.positionId ?? null;
      const order = orders.find((row) =>
        (executionOrderId != null && String(row.id ?? "") === String(executionOrderId)) ||
        (positionId != null && String(row.positionId ?? "") === String(positionId))
      ) ?? null;
      const planId = order?.tradePlanId ?? order?.planId ?? position.tradePlanId ?? position.planId;
      const plan = plans.find((row) => planId != null && String(row.id) === String(planId)) ?? null;
      return {
        ...position,
        id: cockpitObjectId(position),
        notionalUsdt: positionNotionalUsdt(position),
        stopLoss: position.stopLoss ?? position.stopLossPrice ?? plan?.stopLoss ?? plan?.stop_loss ?? null,
        takeProfits: rows(position.takeProfits ?? position.takeProfit ?? plan?.takeProfit ?? plan?.take_profit)
      };
    })
  };
}

export function buildReviewPresentation(data = {}) {
  const execution = buildExecutionView(data);
  const reviewRows = execution.reviews.map((review) => {
    const trade = findReviewTrade(review, execution.closedTrades);
    return { ...review, trade, netPnlUsdt: netReviewResult(review, trade) };
  });
  return {
    ...execution,
    reviews: reviewRows,
    metrics: {
      totalPnlUsdt: execution.performance.totalPnlUsdt,
      trades: execution.performance.trades,
      winRatePct: execution.performance.winRatePct,
      avgPnlUsdt: execution.performance.avgPnlUsdt,
      maxDrawdownPct: finiteNumber(execution.performance.maxDrawdownPct) ? Number(execution.performance.maxDrawdownPct) : null,
      profitFactor: finiteNumber(execution.performance.profitFactor) ? Number(execution.performance.profitFactor) : null
    }
  };
}

export function buildLedgerPresentation(data = {}) {
  const execution = buildExecutionView(data);
  const working = execution.orders.filter((row) => /open|pending|working|partial/i.test(String(row.status))).length;
  const filled = execution.orders.filter((row) => /filled|complete/i.test(String(row.status))).length;
  const blocked = execution.orders.filter((row) => /reject|blocked|risk|cancel/i.test(String(row.status))).length;
  const feesUsdt = execution.fills.reduce((sum, row) => sum + (Number.isFinite(Number(row.feeUsdt ?? row.fee)) ? Number(row.feeUsdt ?? row.fee) : 0), 0);
  return {
    ...execution,
    metrics: {
      total: execution.orders.length,
      working,
      filled,
      blocked,
      fillRatePct: execution.orders.length ? Number((filled / execution.orders.length * 100).toFixed(1)) : null,
      feesUsdt: Number(feesUsdt.toFixed(8))
    }
  };
}
