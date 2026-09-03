import { buildExecutionView, buildMarketRows, buildPositionView, findReviewTrade, netReviewResult } from "../../viewData.js";

const rows = (value) => Array.isArray(value) ? value : [];
const objectRows = (value) => rows(value).filter((row) => row && typeof row === "object" && !Array.isArray(row));
const hasOwn = (value, key) => Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
const finiteNumber = (value) => value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "") && Number.isFinite(Number(value));
const timeOf = (row) => row && typeof row === "object" ? new Date(row.updatedAt ?? row.completedAt ?? row.createdAt ?? 0).getTime() || 0 : 0;
const byNewest = (a, b) => timeOf(b) - timeOf(a);
const byOldest = (a, b) => timeOf(a) - timeOf(b);
const cockpitResourceStates = new Set(["not_loaded", "loading", "loaded", "stale", "degraded", "error", "failed", "forbidden", "disabled"]);

function cockpitResourceState(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "ready") return "loaded";
  return cockpitResourceStates.has(normalized) ? normalized : "not_loaded";
}

function positionNotional(position) {
  const authoritative = position.notional ?? position.notionalUsdt ?? position.marketValue;
  if (finiteNumber(authoritative)) return Math.abs(Number(authoritative));
  const quantity = position.quantity ?? position.size ?? position.pos ?? position.qty;
  const mark = position.markPrice ?? position.mark ?? position.price ?? position.entryPrice ?? position.entry;
  return finiteNumber(quantity) && finiteNumber(mark) ? Math.abs(Number(quantity) * Number(mark)) : null;
}

function marketVolumeOf(market) {
  if (!market || typeof market !== "object") return { kind: "unavailable", value: null, unit: null };
  const quote = market.quoteTurnover24h ?? market.quoteVolume24h ?? market.turnover24h ?? market.quoteVolume;
  const [baseUnit, quoteUnit] = String(market.symbol || "").split("/");
  if (finiteNumber(quote)) return { kind: "quote", value: Number(quote), unit: quoteUnit || null };
  const base = market.baseVolume24h ?? market.volume24h ?? market.volume;
  if (finiteNumber(base)) return { kind: "base", value: Number(base), unit: baseUnit || null };
  return { kind: "unavailable", value: null, unit: null };
}

export function cockpitObjectId(row = {}) {
  const safe = row && typeof row === "object" ? row : {};
  return safe.id ?? safe.positionId ?? safe.instId ?? safe.orderId ?? safe.executionOrderId ?? safe.fillId ?? safe.tradeLifecycleId ?? safe.symbol ?? null;
}

export function buildOverviewTradeFlow(data = {}) {
  const fills = objectRows(data.fills)
    .filter((row) => row.id != null || row.fillId != null)
    .map((row) => ({ ...row, recordType: "fill" }));
  const filledOrderIds = new Set(fills.map((row) => row.executionOrderId ?? row.orderId).filter((id) => id !== null && id !== undefined && id !== "").map(String));
  const remainingOrders = objectRows(data.executionOrders)
    .filter((row) => row.id != null || row.orderId != null || row.executionOrderId != null)
    .filter((row) => !filledOrderIds.has(String(row.id ?? row.executionOrderId ?? row.orderId ?? "")))
    .map((row) => ({ ...row, recordType: "order" }));
  return [...fills, ...remainingOrders].sort(byNewest);
}

export function buildOverviewPresentation(data = {}) {
  const positions = buildPositionPresentation(data);
  const markets = buildMarketRows(data);
  const activeMarket = data.activeMarket?.symbol ? data.activeMarket : null;
  const market = activeMarket ?? markets[0] ?? null;
  const resourceState = cockpitResourceState(data.resourceState?.cockpit);
  const systemNoticeAvailable = hasOwn(data, "notifications") || Boolean(data.automationState && typeof data.automationState === "object");
  const activityAvailable = hasOwn(data, "agentRuns") || hasOwn(data, "jobRuns");
  const strategyCatalogAvailable = Boolean(data.strategyCatalog && typeof data.strategyCatalog === "object" && hasOwn(data.strategyCatalog, "products"));
  const riskRulesAvailable = hasOwn(data, "riskRules");
  const portfolioRisk = data.portfolioRisk && typeof data.portfolioRisk === "object"
    && (finiteNumber(data.portfolioRisk.utilizationPct) || data.portfolioRisk.status != null)
    ? {
        utilizationPct: finiteNumber(data.portfolioRisk.utilizationPct) ? Number(data.portfolioRisk.utilizationPct) : null,
        status: data.portfolioRisk.status == null ? null : String(data.portfolioRisk.status)
      }
    : null;
  const accountSnapshots = objectRows(data.accountSnapshots)
    .filter((row) => finiteNumber(row.totalEquityUsdt) && timeOf(row) > 0)
    .sort(byOldest);
  const tradeFlow = buildOverviewTradeFlow(data);
  const portfolio = data.portfolio ?? {};
  const hasPortfolioFact = ["totalEquityUsdt", "todayPnl", "todayPnlPct", "unrealizedPnl", "availableMarginUsdt", "netValueCny"]
    .some((key) => finiteNumber(portfolio?.[key]));
  const hasLastValidFacts = hasPortfolioFact || Boolean(portfolioRisk) || Boolean(market) || positions.positions.length > 0
    || tradeFlow.length > 0 || accountSnapshots.length > 0 || Boolean(data.marketRegime && typeof data.marketRegime === "object");
  return {
    portfolio,
    portfolioRisk,
    resourceState,
    marketReady: resourceState === "loaded",
    market,
    marketVolume: marketVolumeOf(market),
    markets,
    positions,
    allocation: positions.positions,
    hasPositions: positions.positions.length > 0,
    hasAllocatablePositions: positions.positions.some((row) => finiteNumber(row.notionalUsdt) && Number(row.notionalUsdt) > 0),
    tradeFlow,
    systemNotice: objectRows(data.notifications)[0] ?? (data.automationState ? { title: data.automationState.detail ?? data.automationState.label } : null),
    marketNotice: objectRows(data.events)[0] ?? null,
    aiRead: data.marketRegime ?? null,
    activities: [...objectRows(data.agentRuns), ...objectRows(data.jobRuns)].filter((row) => row.id != null).sort(byNewest),
    strategyProducts: objectRows(data.strategyCatalog?.products),
    activeRiskRuleCount: objectRows(data.riskRules).filter((row) => row.enabled === true).length,
    collectionState: {
      systemNotice: systemNoticeAvailable ? "loaded" : "unavailable",
      marketNotice: hasOwn(data, "events") ? "loaded" : "unavailable",
      activities: activityAvailable ? "loaded" : "unavailable",
      strategyProducts: strategyCatalogAvailable ? "loaded" : "unavailable",
      riskRules: riskRulesAvailable ? "loaded" : "unavailable"
    },
    hasLastValidFacts,
    accountSnapshots
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
  const positionRows = objectRows(data.positions).filter((row) => cockpitObjectId(row) != null);
  const base = buildPositionView({ ...data, positions: positionRows });
  const orders = objectRows(data.executionOrders);
  const plans = objectRows(data.tradePlans);
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
        notionalUsdt: positionNotional(position),
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
