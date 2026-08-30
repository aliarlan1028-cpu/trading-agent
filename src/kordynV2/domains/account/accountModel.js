import { executionExitAction } from "../../../executionExit.js";
import { canonicalPositionIdentity } from "../../../productShell.jsx";
import { buildExecutionView, buildMarketRows, buildPositionView } from "../../../viewData.js";

const list = (value) => Array.isArray(value) ? value : [];
const finiteFinancial = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const firstKnown = (...values) => values.find((value) => value !== null && value !== undefined);

function positionNotional(position = {}) {
  const direct = firstKnown(position.notional, position.notionalUsdt, position.marketValue);
  if (direct !== undefined) {
    const value = finiteFinancial(direct);
    return value === null ? null : Math.abs(value);
  }
  const quantity = finiteFinancial(firstKnown(position.quantity, position.size, position.pos, position.qty));
  const mark = finiteFinancial(firstKnown(position.markPrice, position.mark, position.price, position.entryPrice, position.entry));
  return quantity === null || mark === null ? null : Math.abs(quantity * mark);
}

function aggregatePositionFact(sourcePositions, positions, project) {
  if (!Array.isArray(sourcePositions)) return null;
  let total = 0;
  for (const position of positions) {
    const value = project(position);
    if (value === null) return null;
    total += value;
  }
  return total;
}

function executionPerformance(data, execution) {
  const supplied = data.performance && typeof data.performance === "object" && !Array.isArray(data.performance)
    ? data.performance
    : {};
  const lifecycleLoaded = execution.lifecycleState === "loaded";
  const fact = (field) => Object.hasOwn(supplied, field)
    ? finiteFinancial(supplied[field])
    : lifecycleLoaded
      ? finiteFinancial(execution.performance[field])
      : null;
  return {
    ...execution.performance,
    trades: fact("trades"),
    totalPnlUsdt: fact("totalPnlUsdt"),
    winRatePct: fact("winRatePct"),
    avgPnlUsdt: fact("avgPnlUsdt")
  };
}

function executionTotals(data) {
  return {
    orders: finiteFinancial(data.executionOrderStatus?.total),
    fills: finiteFinancial(data.tradeDataStatus?.fillTotal),
    reviews: finiteFinancial(data.tradeDataStatus?.tradeReviewTotal)
  };
}

export function buildAccountDomainModel(data = {}) {
  const source = data && typeof data === "object" ? data : {};
  const portfolio = source.portfolio && typeof source.portfolio === "object" ? source.portfolio : {};
  const positionView = buildPositionView(source);
  const positions = positionView.positions.map((position) => ({
    ...position,
    id: canonicalPositionIdentity(position) ?? null
  }));
  const baseExecution = buildExecutionView(source);
  const execution = {
    ...baseExecution,
    orders: baseExecution.orders.map((order) => ({ ...order, exitAction: executionExitAction(order) })),
    performance: executionPerformance(source, baseExecution),
    totals: executionTotals(source)
  };

  return {
    truth: {
      equity: finiteFinancial(portfolio.totalEquityUsdt),
      available: finiteFinancial(portfolio.availableMarginUsdt),
      exposure: aggregatePositionFact(source.positions, positionView.positions, positionNotional),
      unrealizedPnl: aggregatePositionFact(source.positions, positionView.positions, (position) => (
        finiteFinancial(firstKnown(position.unrealizedPnl, position.pnl, position.upl))
      )),
      margin: aggregatePositionFact(source.positions, positionView.positions, (position) => (
        finiteFinancial(firstKnown(position.margin, position.initialMargin))
      ))
    },
    markets: buildMarketRows(source),
    watchlist: list(source.watchlist).slice(),
    positions,
    openOrders: positionView.openOrders.slice(),
    plans: list(source.tradePlans).slice(),
    execution,
    fills: execution.fills,
    reviews: execution.reviews,
    closedTrades: execution.closedTrades
  };
}
