// Shared, presentation-neutral data selectors for Web and native App views.
// Keep factual derivation here so responsive layouts cannot silently invent a
// second definition of strategies, completed trades, positions, or tool usage.

const list = (value) => Array.isArray(value) ? value : [];

export function hasFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

const numberOr = (value, fallback = 0) => hasFiniteNumber(value) ? Number(value) : fallback;
const feeCost = (row = {}) => hasFiniteNumber(row.feeCostUsdt)
  ? Number(row.feeCostUsdt)
  : hasFiniteNumber(row.feeUsdt) ? Number(row.feeUsdt) : null;
const recentTime = (row = {}) => new Date(row.updatedAt || row.completedAt || row.closedAt || row.createdAt || 0).getTime() || 0;

export function sortRecent(rows = []) {
  return list(rows).slice().sort((a, b) => recentTime(b) - recentTime(a));
}

// Must match server/tradeReviewQueue.mjs. A lifecycle is an execution/plan/
// position, never an individual partial-close fill when a stronger key exists.
export function tradeLifecycleKey(fill = {}) {
  return String(fill.executionOrderId || fill.tradePlanId || fill.planId || fill.positionId || fill.id || "");
}

export function groupClosedTradeLifecyclesForView(fills = []) {
  const entryFees = new Map();
  const groups = new Map();
  for (const fill of list(fills)) {
    if (fill?.kind !== "entry" || feeCost(fill) === null) continue;
    const key = tradeLifecycleKey(fill);
    if (key) entryFees.set(key, (entryFees.get(key) || 0) + feeCost(fill));
  }
  for (const fill of list(fills)) {
    if (fill?.kind !== "close" || !hasFiniteNumber(fill.realizedPnl)) continue;
    const key = tradeLifecycleKey(fill);
    if (!key) continue;
    const group = groups.get(key) || {
      key, fills: [], realizedPnl: 0, feeUsdt: 0, fundingFeeUsdt: 0,
      notionalUsdt: 0, quantity: 0, firstClosedAt: null, lastClosedAt: null
    };
    group.fills.push(fill);
    group.realizedPnl += Number(fill.realizedPnl);
    const closeFeeCost = feeCost(fill);
    if (closeFeeCost !== null) group.feeUsdt += closeFeeCost;
    if (hasFiniteNumber(fill.fundingFeeUsdt)) group.fundingFeeUsdt += Number(fill.fundingFeeUsdt);
    if (hasFiniteNumber(fill.notionalUsdt)) group.notionalUsdt += Math.abs(Number(fill.notionalUsdt));
    if (hasFiniteNumber(fill.quantity ?? fill.size)) group.quantity += Number(fill.quantity ?? fill.size);
    const at = fill.createdAt || fill.closedAt || null;
    if (at && (!group.firstClosedAt || new Date(at) < new Date(group.firstClosedAt))) group.firstClosedAt = at;
    if (at && (!group.lastClosedAt || new Date(at) > new Date(group.lastClosedAt))) group.lastClosedAt = at;
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.fills.some((fill) => fill.partial !== true))
    .map((group) => {
      const representative = sortRecent(group.fills)[0] || {};
      const entryFeeUsdt = entryFees.get(group.key) || 0;
      const realizedPnl = Number(group.realizedPnl.toFixed(8));
      const feeUsdt = Number(group.feeUsdt.toFixed(8));
      const fundingFeeUsdt = Number(group.fundingFeeUsdt.toFixed(8));
      const netRealizedPnl = Number((realizedPnl - feeUsdt - entryFeeUsdt + fundingFeeUsdt).toFixed(8));
      return {
        ...representative,
        id: `closed:${group.key}`,
        tradeLifecycleKey: group.key,
        fillIds: group.fills.map((fill) => fill.id).filter(Boolean),
        closeCount: group.fills.length,
        quantity: Number(group.quantity.toFixed(8)),
        notionalUsdt: Number(group.notionalUsdt.toFixed(8)),
        realizedPnl,
        feeUsdt,
        entryFeeUsdt: Number(entryFeeUsdt.toFixed(8)),
        fundingFeeUsdt,
        netRealizedPnl,
        createdAt: group.lastClosedAt || representative.createdAt
      };
    })
    .sort((a, b) => recentTime(b) - recentTime(a));
}

export function isCompletedTradeReview(review = {}) {
  return /completed|reflected|closed|done/i.test(String(review.status || ""));
}

export function netReviewResult(review = {}, trade = null) {
  if (hasFiniteNumber(trade?.netRealizedPnl)) return Number(trade.netRealizedPnl);
  if (hasFiniteNumber(review?.netRealizedPnl)) return Number(review.netRealizedPnl);
  return null;
}

export function buildExecutionView(data = {}) {
  const orders = sortRecent(data.executionOrders);
  const fills = sortRecent(data.fills);
  // Native payload supplies server-aggregated lifecycles from the complete fill set.
  // An explicit [] means there are none; never rebuild from the bounded ledger slice.
  const closedTrades = Array.isArray(data.closedTradeLifecycles)
    ? sortRecent(data.closedTradeLifecycles)
    : groupClosedTradeLifecyclesForView(fills);
  // The queue writer guarantees type=trade. Do not let unrelated analytical
  // reviews leak into App-only counts merely because they carry an order id.
  const reviews = sortRecent(list(data.reviews).filter((review) => review?.type === "trade"));
  const performance = data.performance || {};
  const fallbackTotal = closedTrades.reduce((sum, trade) => sum + numberOr(trade.netRealizedPnl), 0);
  const fallbackWins = closedTrades.filter((trade) => numberOr(trade.netRealizedPnl) > 0).length;
  const trades = hasFiniteNumber(performance.trades) ? Number(performance.trades) : closedTrades.length;
  const totalPnlUsdt = hasFiniteNumber(performance.totalPnlUsdt) ? Number(performance.totalPnlUsdt) : Number(fallbackTotal.toFixed(8));
  const winRatePct = hasFiniteNumber(performance.winRatePct)
    ? Number(performance.winRatePct)
    : (closedTrades.length ? Number((fallbackWins / closedTrades.length * 100).toFixed(1)) : null);
  const avgPnlUsdt = hasFiniteNumber(performance.avgPnlUsdt)
    ? Number(performance.avgPnlUsdt)
    : (closedTrades.length ? Number((fallbackTotal / closedTrades.length).toFixed(8)) : null);
  return {
    orders,
    fills,
    closedTrades,
    reviews,
    performance: { ...performance, trades, totalPnlUsdt, winRatePct, avgPnlUsdt },
    totals: {
      orders: Number(data.executionOrderStatus?.total ?? orders.length),
      fills: Number(data.tradeDataStatus?.fillTotal ?? fills.length),
      reviews: Number(data.tradeDataStatus?.tradeReviewTotal ?? reviews.length)
    }
  };
}

export function buildPositionView(data = {}) {
  const positions = list(data.positions).filter((position) => {
    const quantity = position.quantity ?? position.size ?? position.pos ?? position.qty;
    return !hasFiniteNumber(quantity) || Number(quantity) !== 0;
  });
  const openOrders = list(data.orders).filter(isAuthoritativeOpenExchangeOrder);
  const exposureUsdt = positions.reduce((sum, position) => sum + positionNotionalUsdt(position), 0);
  const unrealizedPnlUsdt = positions.reduce((sum, position) => sum + numberOr(position.unrealizedPnl ?? position.pnl ?? position.upl), 0);
  const marginUsdt = positions.reduce((sum, position) => sum + numberOr(position.margin ?? position.initialMargin), 0);
  return { positions, openOrders, exposureUsdt, unrealizedPnlUsdt, marginUsdt };
}

export function positionNotionalUsdt(position = {}) {
  const authoritative = position.notional ?? position.notionalUsdt ?? position.marketValue;
  if (hasFiniteNumber(authoritative)) return Math.abs(Number(authoritative));
  const quantity = position.quantity ?? position.size ?? position.pos ?? position.qty;
  const mark = position.markPrice ?? position.mark ?? position.price ?? position.entryPrice ?? position.entry;
  return hasFiniteNumber(quantity) && hasFiniteNumber(mark) ? Math.abs(Number(quantity) * Number(mark)) : 0;
}

const TERMINAL_EXCHANGE_ORDER_STATES = new Set(["filled", "canceled", "cancelled", "rejected", "expired", "closed"]);

export function isAuthoritativeOpenExchangeOrder(order = {}) {
  const source = String(order.source || "").toLowerCase();
  if (!["exchange_rest", "exchange_ws"].includes(source)) return false;
  return !TERMINAL_EXCHANGE_ORDER_STATES.has(String(order.status || "open").toLowerCase());
}

export function buildMarketRows(data = {}) {
  return list(data.markets).filter((market) => market && market.symbol).map((market, index) => ({
    ...market,
    id: market.id || market.symbol || index,
    price: market.price ?? market.last,
    changePct: market.changePct ?? market.change24hPct,
    volume24h: market.volume24h ?? market.quoteVolume ?? market.volume,
    high24h: market.high24h ?? market.high,
    low24h: market.low24h ?? market.low
  }));
}

export function buildEventRows(data = {}, translate = (zh) => zh) {
  const official = list(data.marketCalendarEvents).map((event) => ({
    ...event,
    impact: event.importance === "high" ? 80 : 55,
    impactLabel: event.importance === "high" ? translate("高影响", "High impact") : translate("中影响", "Medium impact"),
    source: event.sourceName,
    relatedSymbols: event.symbols,
    description: event.timePrecision === "date"
      ? translate("官方只确认日期，未公布精确时刻；不会据此触发分钟级静默窗口。", "Official date only; no precise release time, so it cannot trigger a minute-level blackout.")
      : translate("官方日历确认的精确发布时间。", "Exact release time confirmed by the official calendar.")
  }));
  return [...list(data.events), ...official].filter((event, index, rows) => rows.findIndex((other) => (
    (other.title === event.title || other.shortTitle === event.title || other.title === event.shortTitle)
    && (other.due || other.startAt) === (event.due || event.startAt)
  )) === index);
}

export function buildStrategyCatalogRows(data = {}, translate = (zh) => zh) {
  const paperSessions = list(data.paperReport?.sessions);
  const products = list(data.strategyCatalog?.products).map((item) => ({
    id: `product_${item.versionId}`,
    recordType: "product",
    name: translate(item.definition?.name || item.id, item.definition?.nameEn || item.id),
    rawName: item.definition?.name,
    origin: "策略产品",
    direction: item.definition?.direction,
    timeframe: list(item.definition?.timeframes).join("/"),
    status: item.deployment?.state,
    entry: translate(item.definition?.summary || "", item.definition?.summaryEn || ""),
    template: item.definition?.family,
    version: item.version,
    versionId: item.versionId,
    contentHash: item.contentHash,
    stages: list(item.definition?.stages),
    regimes: list(item.definition?.regimes),
    roles: list(item.definition?.roles),
    invalidations: list(item.definition?.invalidation),
    exits: list(item.definition?.exits),
    parameterBounds: item.definition?.parameterBounds || {},
    metrics: item.metrics || {},
    evidence: item.evidence || {},
    lifecycleReason: item.deployment?.reason,
    evidenceStatus: item.deployment?.evidenceStatus,
    immutable: item.immutable,
    profitFactor: item.metrics?.profitFactorInfinite ? "∞" : item.metrics?.profitFactor,
    winRatePct: item.metrics?.winRatePct,
    liveTrades: item.metrics?.closedTrades,
    lastRunAt: item.metrics?.lastClosedAt
  }));
  const research = list(data.strategyCatalog?.strategies).map((item) => ({
    id: `native_${item.id}`,
    recordType: "research",
    name: item.name,
    origin: "指标研究模型",
    direction: item.contract?.direction,
    timeframe: list(item.contract?.timeframes).join("/"),
    status: item.lifecycle?.stage,
    entry: item.contract?.entryModel,
    template: item.contract?.family,
    backtest: item.lifecycle?.profile?.oos || null,
    profitFactor: item.lifecycle?.live?.profitFactor,
    winRatePct: item.lifecycle?.live?.winRatePct,
    lastRunAt: item.lifecycle?.profile?.chosenAt,
    lifecycleReason: item.lifecycle?.reason,
    executionEligibility: item.lifecycle?.executionEligibility,
    liveTrades: item.lifecycle?.live?.trades,
    dataRequirements: list(item.contract?.dataRequirements).map((row) => `${row.source}:${row.dataset}`).join("、")
  }));
  const external = [...list(data.knowledge?.tradingSkills), ...list(data.skills).filter((skill) => skill.kind === "strategy")];
  const rows = [...products, ...research, ...external].map((strategy, index) => {
    const paperSession = strategy.paperSession || paperSessions.find((session) => session.id === strategy.paperSessionId || session.knowledgeSkillId === strategy.id) || null;
    const sourceText = [strategy.createdBy, strategy.source, strategy.sourceTitle, strategy.curated && "curated"].filter(Boolean).join(" ");
    return {
      ...strategy,
      id: strategy.id || `str-${index}`,
      recordType: strategy.recordType || "external",
      name: strategy.name || strategy.title || translate("未命名策略", "Unnamed strategy"),
      direction: strategy.direction || strategy.spec?.direction,
      timeframe: strategy.timeframe || strategy.spec?.timeframe,
      template: strategy.template || strategy.spec?.templateLabel || strategy.spec?.templateId,
      origin: strategy.origin || (strategy.methodId ? "蒸馏" : strategy.userAuthored || /用户|手写|精选|curated|llm|idea/i.test(sourceText) ? "LLM/手写" : /imported|uploaded|github|clawhub/i.test(sourceText) ? "导入" : "其他"),
      paperSession
    };
  });
  return { rows, products, research };
}

const CAPABILITY_ENABLED_STATES = new Set(["active", "trusted", "enabled", "ready", "connected", "configured", "available_without_key", "已启用", "已配置", "已连接", "免密钥可用"]);

export function buildCapabilityCatalogRows(data = {}, translate = (zh) => zh) {
  const rawItems = [
    ...list(data.skills).filter((item) => item.kind !== "strategy"),
    ...list(data.analysisEngine?.tools),
    ...list(data.tools),
    ...list(data.mcpServers)
  ];
  const stats = data.toolCallStats || {};
  const identity = (item) => item.serverName || item.id || item.toolName || item.name || item.title;
  const unique = rawItems.filter((item, index) => rawItems.findIndex((other) => identity(other) === identity(item)) === index);
  return unique.map((item, index) => {
    const id = item.id || `cap-${index}`;
    const isMcp = Boolean(item.serverName || item.transport || /^mcp_/i.test(String(id)));
    const connector = /^tool_/i.test(String(id)) || ["exchange", "model", "data"].includes(String(item.type || item.kind || "").toLowerCase());
    const toolName = item.toolName || item.name;
    const stat = stats[toolName] || null;
    const mcpStats = isMcp ? list(item.tools).map((tool) => stats[tool?.name || tool]).filter(Boolean) : [];
    const mcpStat = mcpStats.length ? mcpStats.reduce((total, child) => {
      total.calls += numberOr(child.calls);
      total.success += numberOr(child.success);
      total.blocked += numberOr(child.blocked);
      total.error += numberOr(child.error);
      total.legacyUnclassifiedOutcomes += numberOr(child.legacyUnclassifiedOutcomes);
      total.totalLatencyMs += numberOr(child.totalLatencyMs);
      total.latencySamples += numberOr(child.latencySamples);
      total.legacyUnsplitCalls += numberOr(child.legacyUnsplitCalls);
      total.legacyUnsplit = total.legacyUnsplit || Boolean(child.legacyUnsplit || child.legacyUnsplitCalls);
      for (const [source, count] of Object.entries(child.sourceCalls || {})) total.sourceCalls[source] = numberOr(total.sourceCalls[source]) + numberOr(count);
      if (!total.lastAt || new Date(child.lastAt || 0) > new Date(total.lastAt || 0)) { total.lastAt = child.lastAt || total.lastAt; total.lastStatus = child.lastStatus || total.lastStatus; }
      return total;
    }, { calls: 0, success: 0, blocked: 0, error: 0, legacyUnclassifiedOutcomes: 0, totalLatencyMs: 0, latencySamples: 0, legacyUnsplitCalls: 0, legacyUnsplit: false, sourceCalls: {}, lastAt: null, lastStatus: null }) : null;
    if (mcpStat && !mcpStat.lastStatus) mcpStat.lastStatus = mcpStat.error > 0 && !mcpStat.success ? "error" : mcpStat.blocked > 0 && !mcpStat.success ? "blocked" : mcpStat.success > 0 ? "success" : null;
    const effectiveStat = mcpStat || stat;
    const calls = connector ? null : effectiveStat?.calls ?? item.evalMetrics?.calls ?? item.runs ?? item.runCount ?? 0;
    const status = item.status || (item.enabled === false ? "disabled" : "enabled");
    const enabled = item.enabled === true || CAPABILITY_ENABLED_STATES.has(String(status).toLowerCase()) || CAPABILITY_ENABLED_STATES.has(String(status));
    const disabled = item.enabled === false || /disabled|retired|已停用|已禁用/i.test(String(status));
    const candidate = !enabled && !disabled && /candidate|pending|trial|paper|registered|待批准|待复核|待连接|待安全复核|候选/i.test(String(status));
    const rawKind = item.type || item.category || item.kind || "tool";
    const category = isMcp ? "mcp" : /workflow|工作流|flow/i.test(String(rawKind)) ? "workflow" : "analysis";
    const classifiedCalls = numberOr(effectiveStat?.success) + numberOr(effectiveStat?.blocked) + numberOr(effectiveStat?.error);
    const usage = item.usage || (effectiveStat ? {
      calls: numberOr(effectiveStat.calls),
      success: numberOr(effectiveStat.success),
      blocked: numberOr(effectiveStat.blocked),
      error: numberOr(effectiveStat.error),
      unclassified: numberOr(effectiveStat.legacyUnclassifiedOutcomes),
      avgLatencyMs: effectiveStat.latencySamples ? Math.round(numberOr(effectiveStat.totalLatencyMs) / Number(effectiveStat.latencySamples)) : null,
      sourceCalls: effectiveStat.sourceCalls || {},
      legacyUnsplit: Boolean(effectiveStat.legacyUnsplitCalls),
      legacyUnsplitCalls: numberOr(effectiveStat.legacyUnsplitCalls),
      health: !numberOr(effectiveStat.calls) || !classifiedCalls ? "untested" : effectiveStat.lastStatus === "error" || numberOr(effectiveStat.error) / classifiedCalls >= .2 ? "degraded" : effectiveStat.lastStatus === "blocked" && !effectiveStat.success ? "blocked" : "healthy"
    } : null);
    const health = connector ? "not_applicable" : usage?.health || (numberOr(calls) > 0 ? "healthy" : "untested");
    return {
      ...item,
      id,
      name: item.name || item.title || item.serverName || translate("未命名工具", "Unnamed tool"),
      kind: isMcp ? "MCP" : rawKind,
      category,
      status,
      enabled,
      disabled,
      candidate,
      connector,
      calls,
      runs: calls,
      callMetric: connector ? "not_applicable" : "calls",
      health,
      lastRunAt: effectiveStat?.lastAt || item.lastCalledAt || item.lastRunAt || null,
      usage
    };
  });
}
