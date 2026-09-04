import { buildExecutionView, buildMarketRows, buildPositionView, findReviewTrade, netReviewResult } from "../../viewData.js";

const rows = (value) => Array.isArray(value) ? value : [];
const objectRows = (value) => rows(value).filter((row) => row && typeof row === "object" && !Array.isArray(row));
const hasOwn = (value, key) => Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
const finiteNumber = (value) => value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "") && Number.isFinite(Number(value));
const nonBlankText = (value) => typeof value === "string" && value.trim() !== "";
const normalizedIdentity = (value) => typeof value === "string" && value.trim() ? value.trim() : Number.isFinite(value) ? String(value) : null;
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

function isRenderableNotice(row) {
  return Boolean(row && typeof row === "object" && [row.message, row.summary, row.title].some(nonBlankText));
}

function isRenderableActivity(row) {
  if (!row || typeof row !== "object" || !nonBlankText(String(row.id ?? ""))) return false;
  return [row.service, row.handler, row.name, row.goal, row.detail, row.status].some(nonBlankText) || timeOf(row) > 0;
}

function hasRenderableMarketRegime(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const global = value.global && typeof value.global === "object" && !Array.isArray(value.global) ? value.global : {};
  return [value.summary, value.label, global.summary, global.label].some(nonBlankText)
    || finiteNumber(value.confidence) || finiteNumber(global.confidence);
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
  const markets = buildMarketRows(data).filter((row) => nonBlankText(row?.symbol));
  const activeMarket = nonBlankText(data.activeMarket?.symbol) ? data.activeMarket : null;
  const market = activeMarket ?? markets[0] ?? null;
  const resourceState = cockpitResourceState(data.resourceState?.cockpit);
  const systemNoticeAvailable = hasOwn(data, "notifications") || Boolean(data.automationState && typeof data.automationState === "object");
  const activityAvailable = hasOwn(data, "agentRuns") || hasOwn(data, "jobRuns");
  const strategyCatalogAvailable = Boolean(data.strategyCatalog && typeof data.strategyCatalog === "object" && hasOwn(data.strategyCatalog, "products"));
  const riskRulesAvailable = hasOwn(data, "riskRules");
  const portfolioRisk = data.portfolioRisk && typeof data.portfolioRisk === "object"
    && (finiteNumber(data.portfolioRisk.utilizationPct) || nonBlankText(data.portfolioRisk.status))
    ? {
        utilizationPct: finiteNumber(data.portfolioRisk.utilizationPct) ? Number(data.portfolioRisk.utilizationPct) : null,
        status: nonBlankText(data.portfolioRisk.status) ? data.portfolioRisk.status.trim() : null
      }
    : null;
  const accountSnapshots = objectRows(data.accountSnapshots)
    .filter((row) => finiteNumber(row.totalEquityUsdt) && timeOf(row) > 0)
    .sort(byOldest);
  const tradeFlow = buildOverviewTradeFlow(data);
  const portfolio = data.portfolio ?? {};
  const notification = objectRows(data.notifications).find(isRenderableNotice) ?? null;
  const automation = data.automationState && typeof data.automationState === "object" && !Array.isArray(data.automationState)
    && [data.automationState.label, data.automationState.detail].some(nonBlankText)
    ? data.automationState
    : null;
  const systemNotice = notification ?? (automation ? { title: automation.detail ?? automation.label } : null);
  const marketNotice = objectRows(data.events).find(isRenderableNotice) ?? null;
  const activities = [...objectRows(data.agentRuns), ...objectRows(data.jobRuns)].filter(isRenderableActivity).sort(byNewest);
  const strategyProducts = objectRows(data.strategyCatalog?.products)
    .filter((row) => [row.id, row.versionId, row.name].some((value) => nonBlankText(String(value ?? ""))));
  const riskRules = objectRows(data.riskRules)
    .filter((row) => [row.id, row.ruleId, row.key, row.name].some((value) => nonBlankText(String(value ?? ""))));
  const hasPortfolioFact = ["totalEquityUsdt", "todayPnl", "todayPnlPct", "unrealizedPnl", "availableMarginUsdt", "netValueCny"]
    .some((key) => finiteNumber(portfolio?.[key]));
  const hasSystemFact = data.system && typeof data.system === "object" && !Array.isArray(data.system)
    && (data.system.killSwitch === true || finiteNumber(data.system.remainingDailyLossUsdt));
  const hasPositionFact = positions.positions.some((row) => nonBlankText(String(cockpitObjectId(row) ?? "")));
  const hasTradeFact = tradeFlow.some((row) => nonBlankText(String(cockpitObjectId(row) ?? "")));
  const hasLastValidFacts = hasPortfolioFact || Boolean(portfolioRisk) || Boolean(market) || hasPositionFact
    || hasTradeFact || accountSnapshots.length > 0 || hasRenderableMarketRegime(data.marketRegime)
    || Boolean(systemNotice) || Boolean(marketNotice) || Boolean(hasSystemFact) || activities.length > 0
    || strategyProducts.length > 0 || riskRules.length > 0;
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
    systemNotice,
    marketNotice,
    aiRead: data.marketRegime ?? null,
    activities,
    strategyProducts,
    activeRiskRuleCount: riskRules.filter((row) => row.enabled === true).length,
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
  const orderIdentity = (row) => normalizedIdentity(row?.id)
    ?? normalizedIdentity(row?.executionOrderId)
    ?? normalizedIdentity(row?.orderId);
  const planIdentity = (row) => normalizedIdentity(row?.tradePlanId)
    ?? normalizedIdentity(row?.planId);
  const selectedId = orderIdentity(order);
  const authoritativeOrders = objectRows(data.executionOrders);
  const orderMatches = selectedId
    ? authoritativeOrders.filter((row) => orderIdentity(row) === selectedId)
    : [];
  const selected = orderMatches.length === 1 ? orderMatches[0] : null;
  const canonicalOrderId = normalizedIdentity(selected?.id);

  if (!selected) {
    return ["signal", "risk", "routing", "order", "fill", "protection"]
      .map((id) => ({ id, done: false, detail: null }));
  }

  const planId = planIdentity(selected);
  const planMatches = planId
    ? objectRows(data.tradePlans).filter((row) => normalizedIdentity(row.id) === planId)
    : [];
  const plan = planMatches.length === 1 ? planMatches[0] : null;
  const riskChecks = objectRows(data.riskChecks);
  const exactRiskMatches = canonicalOrderId
    ? riskChecks.filter((row) => normalizedIdentity(row.executionOrderId) === canonicalOrderId)
    : [];
  let risk = exactRiskMatches.length === 1 ? exactRiskMatches[0] : null;
  if (!exactRiskMatches.length && plan && planId) {
    const planOwners = authoritativeOrders.filter((row) => planIdentity(row) === planId);
    const planRiskMatches = riskChecks.filter((row) => (
      !normalizedIdentity(row.executionOrderId)
      && planIdentity(row) === planId
    ));
    if (canonicalOrderId && planOwners.length === 1 && normalizedIdentity(planOwners[0].id) === canonicalOrderId && planRiskMatches.length === 1) {
      risk = planRiskMatches[0];
    }
  }
  const fills = canonicalOrderId ? objectRows(data.fills).filter((row) => {
    const fillOrderId = normalizedIdentity(row.executionOrderId) ?? normalizedIdentity(row.orderId);
    return fillOrderId === canonicalOrderId;
  }) : [];
  const protectionStatus = String(selected.status ?? "").trim().toLowerCase();
  const protectionState = String(selected.protectionState ?? selected.protection ?? "").trim().toLowerCase();
  const protectionIdentifiers = [
    selected.stopClientOrderId,
    selected.stopAlgoId,
    selected.stopOrderId,
    selected.protectionClientOrderId,
    selected.protectionOrderId,
    ...rows(selected.tpClientOrderIds),
    ...rows(selected.tpAlgoIds)
  ].map(normalizedIdentity).filter(Boolean);
  const hasPersistedProtection = canonicalOrderId && protectionIdentifiers.length > 0;
  const protectionFailed = /failed|error|requested_unconfirmed|unconfirmed/.test(`${protectionStatus} ${protectionState}`);
  const protectionPartial = hasPersistedProtection && !protectionFailed
    && (protectionStatus === "protecting_degraded" || protectionState === "stop_only" || protectionState === "degraded");
  const protectionComplete = hasPersistedProtection && !protectionFailed && !protectionPartial
    && (protectionStatus === "protecting" || /confirmed|active|protected/.test(protectionState));
  const protectionDetail = protectionFailed
    ? selected.protectionState ?? selected.protection ?? selected.status ?? null
    : protectionPartial
      ? selected.protectionState ?? selected.protection ?? selected.status ?? null
      : protectionComplete
        ? selected.protectionState ?? selected.protection ?? protectionIdentifiers[0]
        : null;
  return [
    { id: "signal", done: Boolean(plan), detail: plan?.signal ?? plan?.strategy ?? null },
    { id: "risk", done: /pass|approved|allowed/i.test(String(risk?.status ?? risk?.decision ?? risk?.result ?? "")), detail: risk?.summary ?? risk?.reason ?? null },
    { id: "routing", done: Boolean(selected.exchange ?? selected.venue), detail: selected.exchange ?? selected.venue ?? null },
    { id: "order", done: Boolean(canonicalOrderId), detail: canonicalOrderId ? selected.status ?? null : null },
    { id: "fill", done: fills.length > 0, detail: fills.length ? String(fills.length) : null },
    { id: "protection", done: Boolean(protectionComplete), state: protectionComplete ? "complete" : protectionPartial ? "partial" : protectionFailed ? "failed" : "incomplete", detail: protectionDetail }
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
      const executionOrderId = normalizedIdentity(position.executionOrderId);
      const positionId = normalizedIdentity(position.positionId);
      const orderMatches = executionOrderId
        ? orders.filter((row) => normalizedIdentity(row.id) === executionOrderId)
        : positionId
          ? orders.filter((row) => normalizedIdentity(row.positionId) === positionId)
          : [];
      const order = orderMatches.length === 1 ? orderMatches[0] : null;
      const planId = [order?.tradePlanId, order?.planId, position.tradePlanId, position.planId].map(normalizedIdentity).find(Boolean) ?? null;
      const planMatches = planId ? plans.filter((row) => normalizedIdentity(row.id) === planId) : [];
      const plan = planMatches.length === 1 ? planMatches[0] : null;
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
  const ordersAvailable = hasOwn(data, "executionOrders") && Array.isArray(data.executionOrders);
  const fillsAvailable = hasOwn(data, "fills") && Array.isArray(data.fills);
  const execution = buildExecutionView(data);
  const working = ordersAvailable ? execution.orders.filter((row) => /open|pending|working|partial/i.test(String(row.status))).length : null;
  const filled = ordersAvailable ? execution.orders.filter((row) => /filled|complete/i.test(String(row.status))).length : null;
  const blocked = ordersAvailable ? execution.orders.filter((row) => /reject|blocked|risk/i.test(String(row.status))).length : null;
  const feeValues = fillsAvailable ? execution.fills.map((row) => row.feeUsdt ?? row.fee) : [];
  const feesUsdt = fillsAvailable && feeValues.every(finiteNumber)
    ? Number(feeValues.reduce((sum, value) => sum + Number(value), 0).toFixed(8))
    : null;
  return {
    ...execution,
    collectionState: {
      orders: ordersAvailable ? "loaded" : "unavailable",
      fills: fillsAvailable ? "loaded" : "unavailable"
    },
    metrics: {
      total: ordersAvailable ? execution.orders.length : null,
      working,
      filled,
      blocked,
      fillRatePct: ordersAvailable && execution.orders.length ? Number((filled / execution.orders.length * 100).toFixed(1)) : null,
      feesUsdt
    }
  };
}
