import { groupClosedTradeLifecycles } from "./tradeReviewQueue.mjs";

const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 6;
const MIN_COMPARABLE_SAMPLE = 5;

function finite(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function compact(value, max = 360) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeSymbol(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  const base = raw.replace(/-SWAP$/, "").replace(/[-_/]USDT$/, "");
  return base ? `${base}/USDT` : "";
}

function normalizeTimeframe(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDirection(value) {
  const raw = String(value || "").toLowerCase();
  if (/short|sell|空/.test(raw)) return "short";
  if (/long|buy|多/.test(raw)) return "long";
  return "";
}

function normalizeSetup(value) {
  return String(value || "").trim().toLowerCase();
}

function parseSymbols(text = "") {
  const found = new Set();
  for (const match of String(text).toUpperCase().matchAll(/\b([A-Z0-9]{2,12})(?:\/|-)?USDT\b/g)) {
    found.add(`${match[1]}/USDT`);
  }
  return [...found];
}

function parseTimeframe(text = "") {
  const match = String(text).toLowerCase().match(/\b(1m|5m|15m|1h|4h|1d)\b/);
  return match?.[1] || "";
}

function planForMemory(db, memory = {}) {
  if (memory.tradePlanId) return (db.tradePlans || []).find((row) => row.id === memory.tradePlanId) || {};
  const fillIds = new Set([memory.fillId, ...(memory.fillIds || [])].filter(Boolean));
  const fill = (db.fills || []).find((row) => fillIds.has(row.id)) || {};
  return (db.tradePlans || []).find((row) => row.id === (fill.tradePlanId || fill.planId)) || {};
}

function fillForMemory(db, memory = {}) {
  const fillIds = new Set([memory.fillId, ...(memory.fillIds || [])].filter(Boolean));
  return (db.fills || []).find((row) => fillIds.has(row.id)) || {};
}

function reviewForMemory(db, memory = {}) {
  return (db.reviews || []).find((row) => row.memoryItemId === memory.id || row.id === memory.reviewId) || {};
}

export function reviewMemoryMetadata(db, memory = {}) {
  const explicit = memory.reviewContext || {};
  const fill = fillForMemory(db, memory);
  const plan = planForMemory(db, memory);
  const review = reviewForMemory(db, memory);
  const symbol = normalizeSymbol(explicit.symbol || memory.symbol || fill.symbol || plan.symbol || review.symbol);
  const setupType = normalizeSetup(explicit.setupType || memory.setupType || plan.scenarioType || plan.decisionContext?.setupType || plan.strategyRef?.scenarioType);
  const strategyProductId = explicit.strategyProductId || memory.strategyProductId || fill.strategyProductId || plan.strategyProductId || plan.strategyRef?.productId || null;
  const timeframe = normalizeTimeframe(explicit.timeframe || memory.timeframe || fill.timeframe || plan.timeframe || plan.strategyInstance?.timeframe);
  const regime = compact(explicit.regime || memory.regime || fill.regime || plan.regime, 80);
  const direction = normalizeDirection(explicit.direction || memory.direction || fill.direction || plan.direction || review.direction);
  const realizedPnl = finite(explicit.realizedPnl ?? memory.realizedPnl ?? review.realizedPnl ?? fill.realizedPnl)
    ? Number(explicit.realizedPnl ?? memory.realizedPnl ?? review.realizedPnl ?? fill.realizedPnl)
    : null;
  return {
    symbol,
    direction,
    setupType,
    strategyProductId,
    timeframe,
    traderRole: explicit.traderRole || memory.traderRole || plan.traderRole || null,
    regime,
    realizedPnl,
    outcome: realizedPnl == null ? null : realizedPnl > 0 ? "win" : realizedPnl < 0 ? "loss" : "flat",
    reviewId: explicit.reviewId || memory.reviewId || review.id || null,
    tradePlanId: explicit.tradePlanId || memory.tradePlanId || plan.id || null
  };
}

export function stampReviewMemoryContext(memory, { fill = {}, plan = {}, review = {}, lifecycle = null } = {}) {
  const pnl = finite(lifecycle?.realizedPnl ?? review.realizedPnl ?? fill.realizedPnl)
    ? Number(lifecycle?.realizedPnl ?? review.realizedPnl ?? fill.realizedPnl)
    : null;
  memory.reviewContext = {
    schemaVersion: 1,
    symbol: normalizeSymbol(fill.symbol || plan.symbol || review.symbol),
    direction: normalizeDirection(fill.direction || plan.direction || review.direction),
    setupType: normalizeSetup(plan.scenarioType || plan.decisionContext?.setupType || plan.strategyRef?.scenarioType),
    strategyProductId: fill.strategyProductId || plan.strategyProductId || plan.strategyRef?.productId || null,
    timeframe: normalizeTimeframe(fill.timeframe || plan.timeframe || plan.strategyInstance?.timeframe),
    traderRole: plan.traderRole || null,
    regime: compact(fill.regime || plan.regime, 80),
    realizedPnl: pnl,
    outcome: pnl == null ? null : pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat",
    reviewId: review.id || null,
    tradePlanId: plan.id || fill.tradePlanId || fill.planId || null
  };
  memory.symbol = memory.reviewContext.symbol || memory.symbol || null;
  memory.reviewId = memory.reviewContext.reviewId || memory.reviewId || null;
  memory.tradePlanId = memory.reviewContext.tradePlanId || memory.tradePlanId || null;
  return memory.reviewContext;
}

function memoryScore(metadata, query, createdAt) {
  let score = 0;
  const matchedBy = [];
  if (query.symbols.length && query.symbols.includes(metadata.symbol)) { score += 14; matchedBy.push("symbol"); }
  if (query.setupType && metadata.setupType === query.setupType) { score += 8; matchedBy.push("setup"); }
  if (query.strategyProductId && metadata.strategyProductId === query.strategyProductId) { score += 8; matchedBy.push("strategy"); }
  if (query.timeframe && metadata.timeframe === query.timeframe) { score += 5; matchedBy.push("timeframe"); }
  if (query.direction && metadata.direction === query.direction) { score += 3; matchedBy.push("direction"); }
  if (query.regime && metadata.regime && metadata.regime === query.regime) { score += 5; matchedBy.push("regime"); }
  const age = Date.now() - new Date(createdAt || 0).getTime();
  if (Number.isFinite(age) && age >= 0) score += Math.max(0, 3 - age / (90 * DAY_MS));
  return { score: Number(score.toFixed(3)), matchedBy };
}

export function retrieveRelevantReviewMemories(db, options = {}) {
  const symbols = [...new Set([
    ...(options.symbols || []).map(normalizeSymbol),
    ...parseSymbols(options.text)
  ].filter(Boolean))];
  const timeframe = normalizeTimeframe(options.timeframe || parseTimeframe(options.text));
  const query = {
    symbols,
    timeframe,
    direction: normalizeDirection(options.direction),
    setupType: normalizeSetup(options.setupType),
    strategyProductId: options.strategyProductId || null,
    regime: compact(options.regime, 80)
  };
  // 没有交易对象时不把任意旧复盘塞进普通客服/配置问答。
  if (!query.symbols.length && !query.setupType && !query.strategyProductId) return [];
  const rows = [];
  for (const memory of db.memoryItems || []) {
    if (memory.source !== "auto_reflection") continue;
    const metadata = reviewMemoryMetadata(db, memory);
    const ranked = memoryScore(metadata, query, memory.updatedAt || memory.createdAt);
    // 有明确交易对时必须同币；策略级查询可跨币，但必须同策略产品/形态。
    if (query.symbols.length && !query.symbols.includes(metadata.symbol)) continue;
    if (!query.symbols.length && ranked.score < 8) continue;
    rows.push({
      id: memory.id,
      title: memory.title || "交易复盘",
      content: compact(memory.content, 480),
      createdAt: memory.updatedAt || memory.createdAt || null,
      relevanceScore: ranked.score,
      matchedBy: ranked.matchedBy,
      ...metadata
    });
  }
  const ranked = rows.sort((a, b) => b.relevanceScore - a.relevanceScore || new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  const limit = Math.max(1, Number(options.limit || DEFAULT_LIMIT));
  if (query.symbols.length <= 1) return ranked.slice(0, limit);
  // 多币巡检时避免“某币旧交易较多”挤掉其余币的全部复盘上下文。
  const balanced = [];
  const perSymbol = Math.max(1, Math.floor(limit / query.symbols.length));
  for (const symbol of query.symbols) balanced.push(...ranked.filter((row) => row.symbol === symbol).slice(0, perSymbol));
  for (const row of ranked) {
    if (balanced.length >= limit) break;
    if (!balanced.some((item) => item.id === row.id)) balanced.push(row);
  }
  return balanced.slice(0, limit);
}

export function buildReviewLearningContext(db, options = {}) {
  const symbols = [...new Set([...(options.symbols || []), ...parseSymbols(options.text)].map(normalizeSymbol).filter(Boolean))];
  const regimes = symbols.map((symbol) => (db.markets || []).find((row) => normalizeSymbol(row.symbol) === symbol)?.regime).filter(Boolean);
  const retrieved = retrieveRelevantReviewMemories(db, {
    ...options,
    symbols,
    regime: options.regime || (regimes.length === 1 ? regimes[0] : "")
  });
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    query: { symbols, timeframe: normalizeTimeframe(options.timeframe || parseTimeframe(options.text)), regime: options.regime || (regimes.length === 1 ? regimes[0] : "") },
    retrieved
  };
}

export function reviewLearningPrompt(context = {}) {
  const rows = context.retrieved || [];
  if (!rows.length) return "";
  const text = rows.map((row) => {
    const tags = [row.symbol, row.setupType || row.strategyProductId, row.timeframe, row.regime, row.outcome].filter(Boolean).join(" · ");
    return `- [${row.id}] ${tags}｜${row.title}：${compact(row.content, 360)}`;
  }).join("\n");
  return `【与本轮最相关的真实交易复盘（历史证据，不代表当前行情）】\n${text}\n使用规则：实时行情和硬风控优先；复盘只能作为相似情景经验，不能覆盖新证据。提交易计划时，在 appliedReviewLessons 中只声明真正影响本次判断的记忆 ID，并分别说明它是强化判断、改变判断还是帮助规避错误；仅看过但没影响的不要冒充“采用”。没有适用教训就传空数组。`;
}

export function validateAppliedReviewLessons(context = {}, declared = []) {
  const candidates = new Map((context.retrieved || []).map((row) => [row.id, row]));
  const applied = [];
  const rejected = [];
  for (const raw of Array.isArray(declared) ? declared : []) {
    const memoryId = String(raw?.memoryId || raw?.id || "").trim();
    const influence = ["reinforced", "changed", "avoided"].includes(raw?.influence) ? raw.influence : null;
    const note = compact(raw?.note || raw?.impact, 240);
    if (!memoryId || !candidates.has(memoryId) || !influence || note.length < 4) {
      if (memoryId) rejected.push(memoryId);
      continue;
    }
    if (applied.some((row) => row.memoryId === memoryId)) continue;
    const source = candidates.get(memoryId);
    applied.push({ memoryId, influence, note, sourceReviewId: source.reviewId || null, sourceSymbol: source.symbol || null });
  }
  return { applied: applied.slice(0, 6), rejected: [...new Set(rejected)] };
}

function cohortMetrics(rows) {
  const pnls = rows.map((row) => Number(row.pnl)).filter(Number.isFinite);
  const wins = pnls.filter((value) => value > 0);
  const losses = pnls.filter((value) => value < 0);
  const grossWin = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of pnls) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return {
    trades: pnls.length,
    wins: wins.length,
    winRatePct: pnls.length ? Number((wins.length / pnls.length * 100).toFixed(1)) : null,
    pnlUsdt: Number(pnls.reduce((sum, value) => sum + value, 0).toFixed(2)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : grossWin > 0 ? null : 0,
    maxDrawdownUsdt: Number(maxDrawdown.toFixed(2))
  };
}

function comparableKey(row) {
  return [row.symbol, row.strategyProductId || row.setupType || row.strategy || "", row.timeframe || ""].join("|");
}

export function buildReviewLearningAnalytics(db) {
  const rows = groupClosedTradeLifecycles(db.fills || []).map((lifecycle) => {
    const fill = lifecycle.representative;
    const plan = (db.tradePlans || []).find((item) => item.id === (fill.tradePlanId || fill.planId)) || {};
    const applied = plan.reviewLearning?.applied || plan.appliedReviewLessons || [];
    return plan.id ? {
      lifecycleKey: lifecycle.key,
      closedAt: lifecycle.lastClosedAt || fill.createdAt,
      pnl: Number(lifecycle.realizedPnl || 0),
      symbol: normalizeSymbol(fill.symbol || plan.symbol),
      setupType: normalizeSetup(plan.scenarioType || plan.decisionContext?.setupType || plan.strategyRef?.scenarioType),
      strategyProductId: fill.strategyProductId || plan.strategyProductId || plan.strategyRef?.productId || null,
      strategy: fill.strategy || plan.strategy || null,
      timeframe: normalizeTimeframe(fill.timeframe || plan.timeframe),
      applied: applied.filter((item) => item?.memoryId)
    } : null;
  }).filter(Boolean).sort((a, b) => new Date(a.closedAt || 0) - new Date(b.closedAt || 0));
  const used = rows.filter((row) => row.applied.length);
  const unused = rows.filter((row) => !row.applied.length);
  const overallUsed = cohortMetrics(used);
  const overallUnused = cohortMetrics(unused);
  const comparableUnused = unused.filter((row) => used.some((source) => comparableKey(source) === comparableKey(row)));
  const baseline = cohortMetrics(comparableUnused);
  const comparable = overallUsed.trades >= MIN_COMPARABLE_SAMPLE && baseline.trades >= MIN_COMPARABLE_SAMPLE;
  const byMemory = [];
  for (const memory of (db.memoryItems || []).filter((item) => item.source === "auto_reflection")) {
    const outcomes = rows.filter((row) => row.applied.some((item) => item.memoryId === memory.id));
    if (!outcomes.length) continue;
    const meta = reviewMemoryMetadata(db, memory);
    const controls = unused.filter((row) => comparableKey(row) === comparableKey({ ...meta, strategy: null }));
    const outcomeMetrics = cohortMetrics(outcomes);
    const baselineMetrics = cohortMetrics(controls);
    const enoughEvidence = outcomes.length >= MIN_COMPARABLE_SAMPLE && controls.length >= MIN_COMPARABLE_SAMPLE;
    byMemory.push({
      memoryId: memory.id,
      reviewId: meta.reviewId,
      title: memory.title,
      symbol: meta.symbol,
      outcomes: outcomeMetrics,
      comparableBaseline: baselineMetrics,
      enoughEvidence,
      deltas: enoughEvidence ? {
        winRatePct: Number((outcomeMetrics.winRatePct - baselineMetrics.winRatePct).toFixed(1)),
        profitFactor: outcomeMetrics.profitFactor != null && baselineMetrics.profitFactor != null ? Number((outcomeMetrics.profitFactor - baselineMetrics.profitFactor).toFixed(2)) : null,
        maxDrawdownUsdt: Number((outcomeMetrics.maxDrawdownUsdt - baselineMetrics.maxDrawdownUsdt).toFixed(2))
      } : null
    });
  }
  const deltas = comparable ? {
    winRatePct: Number((overallUsed.winRatePct - baseline.winRatePct).toFixed(1)),
    profitFactor: overallUsed.profitFactor != null && baseline.profitFactor != null ? Number((overallUsed.profitFactor - baseline.profitFactor).toFixed(2)) : null,
    maxDrawdownUsdt: Number((overallUsed.maxDrawdownUsdt - baseline.maxDrawdownUsdt).toFixed(2))
  } : null;
  return {
    generatedAt: new Date().toISOString(),
    methodology: "observational_same_symbol_strategy_timeframe",
    minComparableSample: MIN_COMPARABLE_SAMPLE,
    used: overallUsed,
    comparableBaseline: baseline,
    allWithoutReviewUse: overallUnused,
    comparable,
    deltas,
    verdict: !used.length
      ? "尚无采用复盘教训后平仓的交易"
      : comparable
        ? "已达到基础对照样本门槛；结果仅表示相关性，不等于因果证明"
        : `样本不足：采用组与同类对照组各至少需要 ${MIN_COMPARABLE_SAMPLE} 笔`,
    byMemory: byMemory.sort((a, b) => b.outcomes.trades - a.outcomes.trades)
  };
}

export function backfillReviewMemoryContexts(db) {
  let updated = 0;
  for (const memory of db.memoryItems || []) {
    if (memory.source !== "auto_reflection" || memory.reviewContext?.schemaVersion === 1) continue;
    const fill = fillForMemory(db, memory);
    const plan = planForMemory(db, memory);
    const review = reviewForMemory(db, memory);
    stampReviewMemoryContext(memory, { fill, plan, review });
    updated += 1;
  }
  return { updated };
}
