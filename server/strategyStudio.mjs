import crypto from "node:crypto";
import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { BAR_MINUTES, simulate } from "./backtestEngine.mjs";
import { STRATEGIES, detectRegime } from "./strategies.mjs";
import { anchoredPurgedOosFolds } from "./validationStatistics.mjs";
import { buildStrategyProductCatalog } from "./strategyProducts.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

const TIMEFRAMES = new Set(["5m", "15m", "1h", "4h", "1d"]);
const COST_DEFAULTS = Object.freeze({ feePct: 0.05, slippagePct: 0.03, fundingPct8h: 0.01 });
const TEMPLATE_LABEL_EN = Object.freeze({
  trend: "Trend following (moving-average crossover)", meanrev: "Mean reversion (RSI oversold rebound)",
  breakout: "Breakout (Donchian channel)", macd: "MACD bullish crossover", bollinger: "Lower Bollinger Band rebound",
  death_cross: "Bearish moving-average crossover", rsi_short: "RSI overbought reversal (short)",
  breakdown: "Donchian breakdown (short)", supertrend: "Supertrend bullish reversal", vol_breakout: "Volume-confirmed breakout",
  squeeze: "Bollinger squeeze breakout", rsi_bull_div: "RSI bullish divergence", rsi_bear_div: "RSI bearish divergence"
});
const TEMPLATE_META = Object.freeze({
  trend: { productId: "trend_pullback", scenarioType: "trend_pullback", direction: "long", keywords: /均线|金叉|趋势|trend|moving average/i },
  death_cross: { productId: "trend_pullback", scenarioType: "trend_pullback", direction: "short", keywords: /死叉|均线|趋势|death cross|trend|moving average/i },
  meanrev: { productId: "range_rejection", scenarioType: "range_rejection", direction: "long", keywords: /超卖|均值回归|rsi|oversold|mean.?reversion/i },
  rsi_short: { productId: "range_rejection", scenarioType: "range_rejection", direction: "short", keywords: /超买|均值回归|rsi|overbought|mean.?reversion/i },
  breakout: { productId: "breakout_retest", scenarioType: "breakout_retest", direction: "long", keywords: /突破|唐奇安|breakout|donchian/i },
  breakdown: { productId: "breakdown_retest", scenarioType: "breakdown_retest", direction: "short", keywords: /跌破|下破|breakdown|donchian/i },
  macd: { productId: "trend_pullback", scenarioType: "trend_pullback", direction: "long", keywords: /macd/i },
  bollinger: { productId: "range_rejection", scenarioType: "range_rejection", direction: "long", keywords: /布林|bollinger/i },
  supertrend: { productId: "trend_pullback", scenarioType: "trend_pullback", direction: "long", keywords: /supertrend/i },
  vol_breakout: { productId: "breakout_retest", scenarioType: "breakout_retest", direction: "long", keywords: /量价|放量突破|volume.{0,10}breakout/i },
  squeeze: { productId: "breakout_retest", scenarioType: "breakout_retest", direction: "long", keywords: /挤压|squeeze/i },
  rsi_bull_div: { productId: "false_breakout_reversal", scenarioType: "reversal_reclaim", direction: "long", keywords: /底背离|bull(?:ish)? divergence/i },
  rsi_bear_div: { productId: "false_breakout_reversal", scenarioType: "reversal_reclaim", direction: "short", keywords: /顶背离|bear(?:ish)? divergence/i }
});

const PARAM_BOUNDS = Object.freeze({
  fast: [2, 100], slow: [3, 300], signal: [2, 50], period: [2, 100],
  oversold: [5, 45], overbought: [55, 95], lookback: [5, 300],
  k: [0.5, 5], mult: [0.5, 8], volMult: [0.5, 8], squeeze: [0.005, 0.3]
});

const UNSUPPORTED_EXECUTABLE_SEMANTICS = Object.freeze([
  { code: "vwap", pattern: /\bVWAP\b|成交量加权平均价/i },
  { code: "order_book", pattern: /订单簿|盘口|买盘强度|卖盘强度|order\s*book|book\s*imbalance/i },
  { code: "ichimoku", pattern: /一目均衡|云层突破|ichimoku/i },
  { code: "onchain_flow", pattern: /链上|资金净流入|on-?chain|wallet\s*flow/i },
  { code: "external_catalyst", pattern: /新闻|政策|监管|宏观|ETF|美联储|news|policy|regulat|macro|federal reserve/i },
  { code: "derivatives_context", pattern: /资金费率|未平仓|持仓量|强平|funding\s*rate|open\s*interest|liquidation/i },
  { code: "market_regime_filter", pattern: /适用市场|市场状态|market\s*regime/i },
  { code: "separate_confirmation", pattern: /(?:^|[；;。])\s*(?:确认|confirmation)(?=\s|[:：])/i }
]);

function ensureCollections(db) {
  db.strategyStudioDrafts ||= [];
  db.strategyBlueprintVersions ||= [];
  db.strategyStudioBacktests ||= [];
  db.strategyMarketplaceListings ||= [];
  db.strategyAssignments ||= [];
}

function strategyPrincipal(value = {}) {
  const principal = value.principal || value;
  const tenantId = principal.tenantId || null;
  const userId = principal.userId || principal.id || null;
  if (!tenantId || !userId) throw Object.assign(new Error("strategy_explicit_principal_required"), { status: 403, code: "strategy_explicit_principal_required" });
  return { tenantId, userId, isOwner: principal.isOwner === true };
}

function assertStrategyOwner(row, principalInput) {
  const principal = strategyPrincipal(principalInput);
  if (!row || row.tenantId !== principal.tenantId || row.ownerUserId !== principal.userId) {
    throw Object.assign(new Error("strategy_resource_access_denied"), { status: 403, code: "strategy_resource_access_denied" });
  }
  return principal;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function assertDraftDefinitionIntegrity(draft) {
  if (!draft?.contentHash || hash(draft.blueprint) !== draft.contentHash) {
    throw Object.assign(new Error("strategy_draft_definition_drift"), {
      code: "strategy_draft_definition_drift",
      status: 409
    });
  }
}

function buildCostAssumption(values = COST_DEFAULTS) {
  const contract = {
    schemaVersion: 1,
    source: "strategy_studio_conservative_defaults",
    values: {
      feePct: Number(values.feePct),
      slippagePct: Number(values.slippagePct),
      fundingPct8h: Number(values.fundingPct8h)
    }
  };
  return { ...contract, contentHash: hash(contract) };
}

function costAssumptionMatches(backtest, definition) {
  if (Number(definition?.compilerRevision || 1) < 2) return true;
  const assumption = backtest?.costAssumption;
  if (!assumption || assumption.contentHash !== hash({
    schemaVersion: assumption.schemaVersion,
    source: assumption.source,
    values: assumption.values
  })) return false;
  return hash(assumption.values) === hash(backtest.costs)
    && assumption.contentHash === definition?.costAssumption?.contentHash
    && hash(assumption.values) === hash(definition?.costs);
}

export function strategyDefinitionHash(value) {
  return hash(value);
}

// One authoritative eligibility contract is shared by Owner review, paper
// startup and snapshot projection. A stored contentHash is never trusted
// without recomputing the immutable definition and rejoining its published OOS
// evidence to the same tenant/user.
export function validatePublishedStrategyCandidate(db, version) {
  if (!version) return { ok: false, error: "candidate_strategy_version_not_found", status: 404 };
  if (version.immutable !== true) return { ok: false, error: "candidate_strategy_version_not_immutable", status: 409 };
  if (!version.contentHash || strategyDefinitionHash(version.definition) !== version.contentHash) {
    return { ok: false, error: "candidate_strategy_definition_drift", status: 409 };
  }
  const listing = (db.strategyMarketplaceListings || []).find((row) => row.strategyVersionId === version.id && row.status === "published");
  if (!listing) return { ok: false, error: "candidate_strategy_not_published", status: 409 };
  const sameOwner = (row) => row?.tenantId === version.tenantId && row?.ownerUserId === version.ownerUserId;
  const usesV2Evidence = Number(version.definition?.compilerRevision || 1) >= 2 || Boolean(version.validation?.backtestIdsBySymbol);
  if (!usesV2Evidence) {
    const backtest = (db.strategyStudioBacktests || []).find((row) => row.id === version.validation?.backtestId);
    const draft = (db.strategyStudioDrafts || []).find((row) => row.id === backtest?.draftId);
    if (!backtest || backtest.passed !== true || !sameOwner(backtest)
      || !draft || !sameOwner(draft)
      || backtest.draftHash !== draft.contentHash
      || version.definition?.sourceDraftId !== draft.id
      || Number(backtest.oos?.trades || 0) <= 0
      || !(Number(backtest.oos?.expectancyR) > 0)) {
      return { ok: false, error: "candidate_strategy_oos_publication_not_verified", status: 409 };
    }
    return { ok: true, version, listing, backtest, backtests: [backtest], draft, productId: version.definition?.baseProductId || version.productId || null };
  }
  const symbols = version.definition?.symbols || [];
  const backtestIdsBySymbol = version.validation?.backtestIdsBySymbol
    || (symbols.length === 1 && version.validation?.backtestId ? { [symbols[0]]: version.validation.backtestId } : {});
  const backtests = symbols.map((symbol) => (db.strategyStudioBacktests || [])
    .find((row) => row.id === backtestIdsBySymbol[symbol] && row.symbol === symbol));
  const backtest = backtests[0] || null;
  const draft = (db.strategyStudioDrafts || []).find((row) => row.id === backtest?.draftId);
  if (draft && hash(draft.blueprint) !== draft.contentHash) return { ok: false, error: "candidate_strategy_draft_definition_drift", status: 409 };
  const everySymbolVerified = symbols.length > 0 && backtests.length === symbols.length && backtests.every((row) => row
    && row.passed === true
    && sameOwner(row)
    && row.draftId === draft?.id
    && row.draftHash === draft?.contentHash
    && Number(row.oos?.trades || 0) > 0
    && Number(row.oos?.expectancyR) > 0);
  if (everySymbolVerified && backtests.some((row) => !costAssumptionMatches(row, version.definition))) {
    return { ok: false, error: "candidate_strategy_cost_assumption_drift", status: 409 };
  }
  if (!everySymbolVerified
    || !draft || !sameOwner(draft)
    || version.definition?.sourceDraftId !== draft.id
    || symbols.some((symbol) => !backtestIdsBySymbol[symbol])) {
    return { ok: false, error: "candidate_strategy_oos_publication_not_verified", status: 409 };
  }
  return {
    ok: true,
    version,
    listing,
    backtest,
    backtests,
    draft,
    productId: version.definition?.baseProductId || version.productId || null
  };
}

function cleanText(value, max = 2000) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}

function isEnglishText(value) { return !/[\u3400-\u9fff]/.test(String(value || "")); }

function explicitTimeframes(text = "") {
  const source = String(text);
  return [
    ["4h", /(?:^|[^\d])4\s*(?:小时|h\b)/i],
    ["1d", /(?:日线|(?:^|[^\d])1\s*d\b|daily)/i],
    ["15m", /(?:^|[^\d])15\s*(?:分钟|分|m\b)/i],
    ["5m", /(?:^|[^\d])5\s*(?:分钟|分|m\b)/i],
    ["1h", /(?:(?:^|[^\d])1\s*小时|(?:^|[^\d])1\s*h\b|hourly)/i]
  ].filter(([, pattern]) => pattern.test(source)).map(([timeframe]) => timeframe);
}

function explicitTimeframe(text = "") {
  return explicitTimeframes(text)[0] || null;
}

function symbolsFromText(text = "") {
  const input = Array.isArray(text) ? text.join(" ") : String(text || "");
  const matches = input.toUpperCase().match(/\b[A-Z0-9]{2,12}(?:\/|-)?USDT\b/g) || [];
  const symbols = matches.map((item) => `${item.replace(/[-/]/g, "").replace(/USDT$/, "")}/USDT`);
  if (!symbols.length) {
    const common = input.toUpperCase().match(/\b(?:BTC|ETH|SOL|SUI|ADA|DOGE|XRP|BNB|AVAX|LINK|DOT|LTC|BCH|APT|ARB|OP|KAITO)\b/g) || [];
    symbols.push(...common.map((item) => `${item}/USDT`));
  }
  return [...new Set(symbols)].slice(0, 12);
}

function explicitDirection(text = "") {
  if (/做空|空头|卖空|\bshort\b/i.test(text)) return "short";
  if (/做多|多头|买入|\blong\b/i.test(text)) return "long";
  return null;
}

function explicitDirections(text = "") {
  const source = String(text);
  return [
    /做多|多头|买入|\blong\b/i.test(source) ? "long" : null,
    /做空|空头|卖空|\bshort\b/i.test(source) ? "short" : null
  ].filter(Boolean);
}

function executableEntryFamilies(text = "") {
  const source = String(text);
  const divergence = /底背离|顶背离|bull(?:ish)? divergence|bear(?:ish)? divergence/i.test(source);
  const squeeze = /挤压|squeeze/i.test(source);
  const macd = /\bMACD\b/i.test(source);
  const supertrend = /\bsupertrend\b/i.test(source);
  return [...new Set([
    divergence ? "divergence" : null,
    !divergence && /\bRSI\b|超卖|超买|均值回归|oversold|overbought|mean.?reversion/i.test(source) ? "rsi" : null,
    squeeze ? "squeeze" : null,
    !squeeze && /布林|bollinger/i.test(source) ? "bollinger" : null,
    macd ? "macd" : null,
    supertrend ? "supertrend" : null,
    !macd && !supertrend && /均线|金叉|死叉|moving average|\b(?:EMA|SMA|MA)\b/i.test(source) ? "moving_average" : null,
    !squeeze && /突破|跌破|下破|breakout|breakdown|donchian|唐奇安/i.test(source) ? "breakout" : null
  ].filter(Boolean))];
}

function pickTemplate(text, direction, candidate) {
  if (candidate && TEMPLATE_META[candidate]
    && TEMPLATE_META[candidate].direction === direction
    && TEMPLATE_META[candidate].keywords.test(text)) return candidate;
  if (direction === "long" && /(?:放量|成交量|volume).{0,20}(?:突破|breakout)|(?:突破|breakout).{0,20}(?:放量|成交量|volume)/i.test(text)) return "vol_breakout";
  const priority = ["rsi_bull_div", "rsi_bear_div", "squeeze", "supertrend", "macd", "bollinger", "vol_breakout", "breakdown", "breakout", "rsi_short", "meanrev", "death_cross", "trend"];
  const match = priority.map((idValue) => [idValue, TEMPLATE_META[idValue]])
    .find(([, meta]) => meta.direction === direction && meta.keywords.test(text));
  return match?.[0] || null;
}

function extractNumber(text, patterns) {
  for (const pattern of patterns) {
    const value = Number(String(text).match(pattern)?.[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function explicitTakeProfit(text = "") {
  const source = String(text);
  const ratio = source.match(/(?:盈亏比|RR|reward.?risk)\D{0,12}(\d+(?:\.\d+)?)\s*R?/i);
  if (ratio) return { mentioned: true, value: Number(ratio[1]), unit: "R" };
  const target = source.match(/(?:止盈|目标|target|take.?profit)\D{0,12}(\d+(?:\.\d+)?)\s*(R|%)/i);
  if (target) return { mentioned: true, value: Number(target[1]), unit: target[2].toUpperCase() };
  return {
    mentioned: /止盈|目标|盈亏比|RR|reward.?risk|target|take.?profit/i.test(source),
    value: null,
    unit: null
  };
}

function inferParams(text, templateId) {
  const defaults = STRATEGIES[templateId]?.defaultParams || {};
  const params = { ...defaults };
  if (["trend", "death_cross", "macd"].includes(templateId)) {
    const pairs = [...String(text).matchAll(/(?:MA|EMA|SMA|均线)\s*\(?\s*(\d+)/gi)].map((m) => Number(m[1]));
    if (pairs.length >= 2) [params.fast, params.slow] = pairs.slice(0, 2).sort((a, b) => a - b);
  }
  if (["meanrev", "rsi_short", "rsi_bull_div", "rsi_bear_div"].includes(templateId)) {
    const period = extractNumber(text, [/RSI\s*[（([]?\s*(\d+)/i, /RSI\s*(?:周期|period)?\s*(\d+)/i]);
    if (period != null) params.period = period;
    const level = extractNumber(text, [/(?:低于|小于|超卖|oversold)\s*(\d+(?:\.\d+)?)/i, /(?:高于|大于|超买|overbought)\s*(\d+(?:\.\d+)?)/i]);
    if (level != null) params[templateId === "rsi_short" ? "overbought" : "oversold"] = level;
  }
  if (["breakout", "breakdown", "vol_breakout"].includes(templateId)) {
    const lookback = extractNumber(text, [/(?:过去|近|前|lookback)\s*(\d+)\s*(?:根|周期|bars?)?/i, /唐奇安\s*(\d+)/i]);
    if (lookback != null) params.lookback = lookback;
  }
  return params;
}

function explicitAtrStop(text = "") {
  const source = String(text);
  const mentioned = /(?:止损|stop(?:\s*loss)?)\D{0,30}ATR|ATR\D{0,30}(?:止损|stop(?:\s*loss)?)|\d+(?:\.\d+)?\s*(?:倍|x|×|\*)\s*ATR/i.test(source);
  if (!mentioned) return { mentioned: false, mult: null, period: null };
  const multiplier = extractNumber(source, [
    /(\d+(?:\.\d+)?)\s*(?:倍|x|×|\*)\s*ATR/i,
    /ATR(?:\s*[（(]\s*\d+\s*[）)])?\s*(?:x|×|\*)\s*(\d+(?:\.\d+)?)/i,
    /ATR\s*(\d+(?:\.\d+)?)\s*倍/i
  ]);
  const period = extractNumber(source, [/ATR\s*[（(]\s*(\d+)\s*[）)]/i, /ATR\s*(?:周期|period)\s*(\d+)/i]);
  return { mentioned: true, mult: multiplier ?? 2, period: period ?? 14 };
}

function inferExitPolicy(text) {
  const stopFromText = extractNumber(text, [/(?:止损|stop(?: loss)?)\D{0,12}(\d+(?:\.\d+)?)\s*%/i]);
  const atrStop = explicitAtrStop(text);
  const takeProfit = explicitTakeProfit(text);
  const rewardFromText = takeProfit.unit === "%" && stopFromText != null
    ? takeProfit.value / stopFromText
    : takeProfit.unit === "R" ? takeProfit.value : null;
  const stop = stopFromText == null ? NaN : Number(stopFromText);
  const reward = rewardFromText == null ? NaN : Number(rewardFromText);
  return {
    stopLossPct: Number.isFinite(stop) ? Math.max(0.1, Math.min(stop, 10)) : 2,
    takeProfitR: Number.isFinite(reward) ? Math.max(0.5, Math.min(reward, 8)) : 2,
    atrStop: atrStop.mentioned,
    atrMult: atrStop.mult ?? 2,
    atrPeriod: atrStop.period ?? 14
  };
}

function strategyContractEvidence(text = "") {
  const symbols = symbolsFromText(text);
  const timeframe = explicitTimeframe(text);
  const direction = explicitDirection(text);
  const directions = explicitDirections(text);
  const timeframes = explicitTimeframes(text);
  const entryFamilies = executableEntryFamilies(text);
  const stopLoss = extractNumber(text, [/(?:止损|stop(?: loss)?)\D{0,12}(\d+(?:\.\d+)?)\s*%/i]);
  const atrStop = explicitAtrStop(text);
  const takeProfit = explicitTakeProfit(text);
  const takeProfitR = takeProfit.unit === "R"
    ? takeProfit.value
    : takeProfit.unit === "%" && stopLoss != null ? takeProfit.value / stopLoss : null;
  const outOfRange = [];
  if (stopLoss != null && (stopLoss < 0.1 || stopLoss > 10)) outOfRange.push("stopLoss");
  if (takeProfitR != null && (takeProfitR < 0.5 || takeProfitR > 8)) outOfRange.push("takeProfit");
  if (atrStop.mentioned && (atrStop.mult < 0.5 || atrStop.mult > 8)) outOfRange.push("atrMult");
  if (atrStop.mentioned && (atrStop.period < 2 || atrStop.period > 100)) outOfRange.push("atrPeriod");
  const unsupported = UNSUPPORTED_EXECUTABLE_SEMANTICS
    .filter((item) => item.pattern.test(text))
    .map((item) => item.code);
  if (takeProfit.mentioned && !takeProfit.unit) unsupported.push("take_profit_unit");
  if (takeProfit.unit === "%" && stopLoss == null) unsupported.push("take_profit_percent_without_fixed_stop");
  if (directions.length > 1) unsupported.push("multiple_directions");
  if (timeframes.length > 1) unsupported.push("multiple_timeframes");
  if (entryFamilies.length > 1) unsupported.push("multiple_entry_templates");
  const templateId = direction ? pickTemplate(text, direction, null) : null;
  const missing = [];
  if (!symbols.length) missing.push("symbol");
  if (!timeframe) missing.push("timeframe");
  if (!direction) missing.push("direction");
  if (!templateId) missing.push("entry");
  if (stopLoss == null && !atrStop.mentioned) missing.push("stopLoss");
  return {
    symbols,
    timeframe,
    direction,
    templateId,
    stopLossExplicit: stopLoss != null || atrStop.mentioned,
    takeProfitExplicit: takeProfit.unit != null,
    missing,
    outOfRange,
    unsupported: [...new Set(unsupported)]
  };
}

function strategyCompileError(code, message, details) {
  return Object.assign(new Error(message), { code, status: 422, details });
}

function extractJson(raw) {
  const text = cleanText(raw, 12000).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

export function supportedStudioTemplates() {
  return Object.values(STRATEGIES).map((strategy) => ({
    id: strategy.id,
    name: strategy.label,
    direction: strategy.direction || "long",
    family: strategy.family,
    defaults: strategy.defaultParams,
    productId: TEMPLATE_META[strategy.id]?.productId,
    scenarioType: TEMPLATE_META[strategy.id]?.scenarioType
  }));
}

export function compileStrategyPrompt(prompt, candidate = {}) {
  const text = cleanText(prompt, 6000);
  if (text.length < 12) throw new Error("请至少说明方向、入场逻辑、周期和止损/止盈意图");
  const contract = strategyContractEvidence(text);
  if (contract.unsupported.length) {
    throw strategyCompileError(
      "strategy_unsupported_semantics",
      `策略包含当前白名单无法执行的条件：${contract.unsupported.join("、")}`,
      { unsupported: contract.unsupported, missing: contract.missing }
    );
  }
  if (contract.missing.length) {
    throw strategyCompileError(
      "strategy_needs_clarification",
      `策略信息不完整，需要补充：${contract.missing.join("、")}`,
      { missing: contract.missing, unsupported: [] }
    );
  }
  if (contract.outOfRange.length) {
    throw strategyCompileError(
      "strategy_parameter_out_of_range",
      `策略参数超出当前可执行范围：${contract.outOfRange.join("、")}`,
      { fields: contract.outOfRange }
    );
  }
  const direction = contract.direction;
  const templateId = contract.templateId;
  const strategy = STRATEGIES[templateId];
  const meta = TEMPLATE_META[templateId];
  const name = cleanText(candidate.name, 80) || `${contract.symbols[0]} ${isEnglishText(text) ? TEMPLATE_LABEL_EN[templateId] : strategy.label}`;
  const blueprint = {
    schema: "trading.strategy.blueprint",
    schemaVersion: 1,
    compilerRevision: 2,
    name,
    description: cleanText(candidate.description, 500) || text.slice(0, 500),
    templateId,
    templateName: strategy.label,
    templateNameEn: TEMPLATE_LABEL_EN[templateId],
    baseProductId: meta.productId,
    scenarioType: meta.scenarioType,
    direction,
    timeframe: contract.timeframe,
    symbols: contract.symbols,
    params: inferParams(text, templateId),
    exitPolicy: inferExitPolicy(text),
    costs: { ...COST_DEFAULTS },
    costAssumption: buildCostAssumption(),
    executionPolicy: {
      exchange: "OKX",
      requiresHardRiskGate: true,
      requiresFreshEvidence: true,
      requiresVersionPin: true,
      llmMayBypass: false
    },
    sourcePrompt: text
  };
  const mappedFields = ["symbol", "timeframe", "direction", "entry", "stopLoss"];
  const defaultedFields = [];
  const warnings = [];
  if (contract.takeProfitExplicit) mappedFields.push("takeProfit");
  else {
    defaultedFields.push("takeProfit");
    warnings.push("take_profit_defaulted_to_2R");
  }
  return {
    blueprint,
    contentHash: hash(blueprint),
    compilationReport: {
      schemaVersion: 1,
      status: "compiled",
      mappedFields,
      defaultedFields,
      unsupported: [],
      warnings
    }
  };
}

const COMPILER_SYSTEM = `你是交易策略编译器。只把自然语言映射到给定白名单，不生成代码，不承诺收益。
只输出一个 JSON 对象，可用字段只有 name 和 description。所有可执行字段都由确定性编译器直接从用户原文提取；不要输出或猜测模板、方向、周期、交易对、参数或退出规则。`;

export async function createStrategyDraft(db, prompt, options = {}, actor = "StrategyOwner") {
  ensureCollections(db);
  let candidate = {};
  let compiler = "deterministic_fallback";
  const compilerWarnings = [];
  if (typeof options.complete === "function") {
    try {
      const raw = await options.complete(`${cleanText(prompt, 6000)}\n\n白名单说明：${JSON.stringify(supportedStudioTemplates())}`, COMPILER_SYSTEM);
      const parsed = extractJson(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (Object.keys(parsed).some((field) => !["name", "description"].includes(field))) compilerWarnings.push("llm_executable_fields_ignored");
        candidate = {
          ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
          ...(typeof parsed.description === "string" ? { description: parsed.description } : {})
        };
        compiler = Object.keys(candidate).length ? "llm_metadata_only" : compiler;
      }
      if (!parsed) compilerWarnings.push("llm_no_structured_output");
    } catch (error) {
      if (error?.code === "external_model_secret_blocked") throw error;
      compilerWarnings.push("llm_compile_failed");
    }
  }
  const compiled = compileStrategyPrompt(prompt, candidate);
  const compilationReport = {
    ...compiled.compilationReport,
    status: compiler === "llm_metadata_only"
      ? (compilerWarnings.length ? "compiled_with_constraints" : "compiled")
      : compilerWarnings.length ? "compiled_with_fallback" : "compiled_deterministically",
    compiler,
    warnings: [...new Set([...(compiled.compilationReport?.warnings || []), ...compilerWarnings])]
  };
  return persistStrategyDraft(db, compiled, {
    compiler,
    compilationReport,
    actor,
    authoring: { channel: "strategy_studio", toolName: null },
    principal: strategyPrincipal(options)
  });
}

function persistStrategyDraft(db, compiled, { compiler, compilationReport, actor, authoring, principal } = {}) {
  ensureCollections(db);
  const draft = {
    id: id("strategy_draft"),
    tenantId: principal.tenantId,
    ownerUserId: principal.userId,
    status: "compiled",
    revision: 1,
    compiler: compiler || "deterministic_fallback",
    compilationReport: compilationReport || { ...compiled.compilationReport, compiler: compiler || "deterministic_fallback" },
    authoring: authoring || { channel: "strategy_studio", toolName: null },
    blueprint: compiled.blueprint,
    contentHash: compiled.contentHash,
    generatedTests: null,
    latestBacktestId: null,
    publishVersionId: null,
    createdBy: actor,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  db.strategyStudioDrafts.unshift(draft);
  db.strategyStudioDrafts = db.strategyStudioDrafts.slice(0, 100);
  appendAudit(db, `自然语言策略已编译：${draft.blueprint.name}`, draft.id, actor);
  appendTrace(db, "strategy_studio_compile", `${draft.blueprint.templateId}:${draft.blueprint.timeframe}`, "ok");
  return draft;
}

function strategyIdeaPrompt(idea = {}) {
  const symbols = (idea.symbols || (idea.symbol ? [idea.symbol] : [])).map((symbol) => String(symbol).toUpperCase());
  const parts = [
    idea.name,
    symbols.length ? `交易对 ${symbols.join("、")}` : null,
    idea.timeframe ? `周期 ${idea.timeframe}` : null,
    idea.direction ? `方向 ${idea.direction === "short" ? "做空" : "做多"}` : null,
    idea.entry ? `入场 ${idea.entry}` : null,
    idea.confirmation ? `确认 ${idea.confirmation}` : null,
    idea.stop ? `止损 ${idea.stop}` : null,
    idea.takeProfit ? `止盈 ${idea.takeProfit}` : null,
    idea.marketRegime ? `适用市场 ${idea.marketRegime}` : null
  ].filter(Boolean);
  return parts.join("；");
}

// 对话里的 create_skill_from_idea 保留为兼容工具名，但不再创建第二套知识技能。
// DeepSeek 已经把自然语言整理成结构化参数，这里直接进入与策略工作室相同的
// 蓝图、自动测试、样本外回测和版本发布链路。
export function createStrategyDraftFromIdea(db, idea = {}, actor = "AgentChat", options = {}) {
  const prompt = strategyIdeaPrompt(idea);
  if (!String(idea.name || "").trim()) throw new Error("策略需要一个名字");
  if (!String(idea.entry || "").trim()) throw new Error("策略必须说明入场条件");
  if (!String(idea.stop || "").trim()) throw new Error("策略必须说明止损");
  const symbols = (idea.symbols || (idea.symbol ? [idea.symbol] : ["BTC/USDT"]))
    .map((symbol) => String(symbol).toUpperCase());
  const candidate = {
    name: cleanText(idea.name, 120),
    description: cleanText([idea.entry, idea.confirmation].filter(Boolean).join("；"), 500),
    templateId: idea.templateId,
    direction: idea.direction,
    timeframe: idea.timeframe,
    symbols,
    params: idea.params
  };
  const compiled = compileStrategyPrompt(prompt, candidate);
  return persistStrategyDraft(db, compiled, {
    compiler: "agent_structured_tool",
    compilationReport: { ...compiled.compilationReport, compiler: "agent_structured_tool" },
    actor,
    principal: strategyPrincipal(options),
    authoring: {
      channel: "agent_chat",
      toolName: "create_skill_from_idea",
      requestedUniversalScope: !idea.symbol && !(idea.symbols || []).length
    }
  });
}

function validateBlueprint(blueprint = {}) {
  const errors = [];
  const strategy = STRATEGIES[blueprint.templateId];
  const meta = TEMPLATE_META[blueprint.templateId];
  if (blueprint.schema !== "trading.strategy.blueprint" || blueprint.schemaVersion !== 1) errors.push("策略结构版本不受支持");
  if (!strategy || !meta) errors.push("信号模板不在白名单");
  if (!TIMEFRAMES.has(blueprint.timeframe)) errors.push("周期不受支持");
  if (!Array.isArray(blueprint.symbols) || !blueprint.symbols.length || blueprint.symbols.some((s) => !/^[A-Z0-9]{2,12}\/USDT$/.test(s))) errors.push("交易对必须为 OKX USDT 交易对格式");
  if (meta && blueprint.direction !== meta.direction) errors.push("方向与信号模板不一致");
  for (const [key, value] of Object.entries(blueprint.params || {})) {
    const bounds = PARAM_BOUNDS[key];
    if (!bounds) errors.push(`参数 ${key} 不受支持`);
    else if (!Number.isFinite(Number(value)) || Number(value) < bounds[0] || Number(value) > bounds[1]) errors.push(`参数 ${key} 超出安全范围 ${bounds.join("-")}`);
  }
  if (Number(blueprint.params?.fast) >= Number(blueprint.params?.slow)) errors.push("快线周期必须小于慢线周期");
  if (!(Number(blueprint.exitPolicy?.stopLossPct) >= 0.1 && Number(blueprint.exitPolicy?.stopLossPct) <= 10)) errors.push("止损距离必须在 0.1%-10%");
  if (!(Number(blueprint.exitPolicy?.takeProfitR) >= 0.5 && Number(blueprint.exitPolicy?.takeProfitR) <= 8)) errors.push("止盈 R 必须在 0.5-8");
  if (blueprint.executionPolicy?.exchange !== "OKX" || blueprint.executionPolicy?.llmMayBypass !== false || blueprint.executionPolicy?.requiresHardRiskGate !== true) errors.push("执行安全合同不完整");
  return errors;
}

function syntheticCandles(count = 320) {
  const rows = [];
  let close = 100;
  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i / 11) * 0.8 + Math.sin(i / 37) * 0.35;
    const drift = i < 160 ? 0.06 : -0.025;
    const open = close;
    close = Math.max(1, open + drift + wave * 0.18);
    rows.push({ ts: i * 60_000, open, high: Math.max(open, close) + 0.35, low: Math.min(open, close) - 0.35, close, volume: 1000 + (i % 17) * 31 });
  }
  return rows;
}

export function generateStrategyTests(blueprint) {
  const tests = [];
  const add = (idValue, name, nameEn, passed, detail, detailEn) => tests.push({ id: idValue, name, nameEn, passed: Boolean(passed), detail, detailEn });
  const errors = validateBlueprint(blueprint);
  add("schema", "结构与字段校验", "Schema and field validation", errors.length === 0, errors.length ? errors.join("；") : "白名单结构有效", errors.length ? "The compiled schema contains invalid or out-of-range fields" : "Allowlisted schema is valid");
  const strategy = STRATEGIES[blueprint?.templateId];
  if (strategy && !errors.some((e) => /模板|参数|快线/.test(e))) {
    const candles = syntheticCandles();
    let first = null;
    let second = null;
    try {
      first = strategy.signals(candles, blueprint.params || {});
      second = strategy.signals(candles, blueprint.params || {});
    } catch (error) {
      add("executable", "信号可执行性", "Signal executability", false, error.message, error.message);
    }
    if (first) {
      add("executable", "信号可执行性", "Signal executability", Array.isArray(first) && first.length === candles.length && first.every((v) => typeof v === "boolean"), "输出必须是与 K 线等长的布尔信号", "Output must be a boolean signal array aligned with the candles");
      add("deterministic", "重复运行一致性", "Deterministic replay", JSON.stringify(first) === JSON.stringify(second), "相同输入必须得到相同输出", "Identical inputs must produce identical outputs");
      const split = 210;
      const changed = candles.map((row, index) => index < split ? { ...row } : { ...row, open: row.open * 8, high: row.high * 9, low: row.low * 0.2, close: row.close * 7, volume: row.volume * 20 });
      const changedSignals = strategy.signals(changed, blueprint.params || {});
      add("no_lookahead", "未来数据隔离", "Look-ahead isolation", JSON.stringify(first.slice(0, split)) === JSON.stringify(changedSignals.slice(0, split)), "修改未来 K 线不得改变此前信号", "Changing future candles must not alter earlier signals");
      const metrics = simulate(candles, first, { ...blueprint.exitPolicy, ...blueprint.costs, direction: blueprint.direction, barMinutes: BAR_MINUTES[blueprint.timeframe] || 60 });
      const costAssumptionValid = Number(blueprint.compilerRevision || 1) < 2 || (blueprint.costAssumption?.contentHash === hash({
        schemaVersion: blueprint.costAssumption?.schemaVersion,
        source: blueprint.costAssumption?.source,
        values: blueprint.costAssumption?.values
      }) && hash(blueprint.costAssumption?.values) === hash(blueprint.costs));
      add("cost_model", "成本模型生效", "Cost model included", blueprint.costs?.feePct >= 0 && blueprint.costs?.slippagePct >= 0 && blueprint.costs?.fundingPct8h >= 0
        && costAssumptionValid
        && Number.isFinite(metrics.netReturnPct), "手续费、滑点与资金费率均纳入并绑定不可变假设", "Fees, slippage, and funding are included under a hashed immutable assumption");
    }
  }
  add("risk_contract", "执行风控不可绕过", "Risk controls cannot be bypassed", blueprint?.executionPolicy?.requiresHardRiskGate === true && blueprint?.executionPolicy?.requiresFreshEvidence === true && blueprint?.executionPolicy?.llmMayBypass === false, "必须通过账户、证据和硬风控复核", "Account facts, evidence, and hard-risk checks remain mandatory");
  return { status: tests.every((test) => test.passed) ? "passed" : "failed", passed: tests.filter((test) => test.passed).length, total: tests.length, tests, generatedAt: nowIso() };
}

export function runDraftGeneratedTests(db, draftId, actor = "StrategyOwner", runtime = {}) {
  ensureCollections(db);
  const draft = db.strategyStudioDrafts.find((row) => row.id === draftId);
  if (!draft) throw Object.assign(new Error("策略草稿不存在"), { status: 404 });
  assertStrategyOwner(draft, runtime);
  const suite = generateStrategyTests(draft.blueprint);
  draft.generatedTests = suite;
  draft.status = suite.status === "passed" ? "tests_passed" : "tests_failed";
  draft.updatedAt = nowIso();
  appendAudit(db, `策略自动测试：${draft.blueprint.name} ${suite.passed}/${suite.total}`, draft.id, actor, suite.status === "passed" ? "info" : "warning");
  return { draft, suite };
}

function evaluateWindow(candles, signals, window, blueprint) {
  return simulate(candles.slice(window[0], window[1]), signals.slice(window[0], window[1]), {
    ...blueprint.exitPolicy,
    ...blueprint.costs,
    riskPerTradePct: 0.5,
    direction: blueprint.direction,
    barMinutes: BAR_MINUTES[blueprint.timeframe] || 60,
    trialCount: 1
  });
}

export async function backtestStrategyDraft(db, draftId, options = {}, actor = "StrategyOwner") {
  ensureCollections(db);
  const draft = db.strategyStudioDrafts.find((row) => row.id === draftId);
  if (!draft) throw Object.assign(new Error("策略草稿不存在"), { status: 404 });
  assertStrategyOwner(draft, options);
  if (draft.generatedTests?.status !== "passed") throw new Error("必须先通过自动生成的结构与执行测试");
  const symbol = String(options.symbol || draft.blueprint.symbols[0]).toUpperCase();
  if (!draft.blueprint.symbols.includes(symbol)) throw new Error("回测交易对不在策略声明范围内");
  const limit = Math.max(600, Math.min(3000, Number(options.limit || 2500)));
  const candles = await getHistoricalKlines(symbol, draft.blueprint.timeframe, limit);
  return backtestStrategyDraftWithCandles(db, draftId, candles, { ...options, symbol }, actor);
}

export function backtestStrategyDraftWithCandles(db, draftId, candles, options = {}, actor = "StrategyOwner") {
  ensureCollections(db);
  const draft = db.strategyStudioDrafts.find((row) => row.id === draftId);
  if (!draft) throw Object.assign(new Error("策略草稿不存在"), { status: 404 });
  assertStrategyOwner(draft, options);
  assertDraftDefinitionIntegrity(draft);
  if (draft.generatedTests?.status !== "passed") throw new Error("必须先通过自动生成的结构与执行测试");
  const symbol = String(options.symbol || draft.blueprint.symbols[0]).toUpperCase();
  if (!draft.blueprint.symbols.includes(symbol)) throw new Error("回测交易对不在策略声明范围内");
  if (!Array.isArray(candles) || candles.length < 600) throw new Error(`历史 K 线不足：${candles?.length || 0}/600`);
  const strategy = STRATEGIES[draft.blueprint.templateId];
  const signals = strategy.signals(candles, draft.blueprint.params || {});
  const windows = anchoredPurgedOosFolds(candles.length, { trainFraction: 0.4, foldCount: 3, purgeBars: 1, embargoBars: 1 });
  const train = evaluateWindow(candles, signals, windows.train, draft.blueprint);
  const folds = windows.folds.map((window) => evaluateWindow(candles, signals, window, draft.blueprint));
  const oos = evaluateWindow(candles, signals, windows.oos, draft.blueprint);
  const activeFolds = folds.filter((fold) => Number(fold.trades) >= 2);
  const positiveFolds = activeFolds.filter((fold) => Number(fold.expectancyR) > 0);
  const criteria = {
    minTrainTrades: 5,
    minOosTrades: 8,
    positiveOosExpectancy: true,
    minOosProfitFactor: 1.05,
    positiveFoldRatio: 0.5,
    maxOosDrawdownPct: 20
  };
  const passed = train.trades >= criteria.minTrainTrades
    && oos.trades >= criteria.minOosTrades
    && Number(oos.expectancyR) > 0
    && (oos.profitFactor == null || Number(oos.profitFactor) >= criteria.minOosProfitFactor)
    && activeFolds.length >= 2
    && positiveFolds.length / activeFolds.length >= criteria.positiveFoldRatio
    && Number(oos.maxDrawdownPct ?? 100) <= criteria.maxOosDrawdownPct;
  const result = {
    id: id("strategy_bt"),
    tenantId: draft.tenantId || db.user?.tenantId || "tenant_owner",
    ownerUserId: draft.ownerUserId || db.user?.id || null,
    kind: "strategy_blueprint",
    status: "ok",
    passed,
    draftId: draft.id,
    draftHash: draft.contentHash,
    name: draft.blueprint.name,
    symbol,
    timeframe: draft.blueprint.timeframe,
    candles: candles.length,
    strategyId: draft.blueprint.templateId,
    direction: draft.blueprint.direction,
    params: { ...draft.blueprint.params, ...draft.blueprint.exitPolicy },
    costs: structuredClone(draft.blueprint.costs),
    costAssumption: structuredClone(draft.blueprint.costAssumption),
    methodology: "anchored 40% training + 3 purged out-of-sample folds",
    purgeBars: windows.purgeBars,
    embargoBars: windows.embargoBars,
    regime: detectRegime(candles.slice(windows.oos[0])),
    train,
    folds,
    oos,
    activeFolds: activeFolds.length,
    positiveFolds: positiveFolds.length,
    criteria,
    createdAt: nowIso()
  };
  db.strategyStudioBacktests.unshift(result);
  db.strategyStudioBacktests = db.strategyStudioBacktests.slice(0, 100);
  db.backtests ||= [];
  db.backtests.unshift({ ...result, trades: oos.trades, winRatePct: oos.winRatePct, profitFactor: oos.profitFactor, maxDrawdownPct: oos.maxDrawdownPct, expectancyR: oos.expectancyR, netReturnPct: oos.netReturnPct, equityCurve: oos.equityCurve });
  db.backtests = db.backtests.slice(0, 50);
  draft.latestBacktestId = result.id;
  draft.backtestIdsBySymbol ||= {};
  draft.backtestIdsBySymbol[symbol] = result.id;
  draft.status = passed ? "backtest_passed" : "backtest_failed";
  draft.updatedAt = nowIso();
  appendAudit(db, `策略样本外回测：${draft.blueprint.name} ${passed ? "通过" : "未通过"}（${oos.trades} 笔，${oos.expectancyR ?? "-"}R）`, result.id, actor, passed ? "info" : "warning");
  appendTrace(db, "strategy_studio_backtest", `${symbol}:${draft.blueprint.templateId}`, passed ? "ok" : "blocked");
  return { draft, backtest: result };
}

export function publishStrategyDraft(db, draftId, options = {}, actor = "StrategyOwner") {
  ensureCollections(db);
  const draft = db.strategyStudioDrafts.find((row) => row.id === draftId);
  if (!draft) throw Object.assign(new Error("策略草稿不存在"), { status: 404 });
  const principal = assertStrategyOwner(draft, options);
  assertDraftDefinitionIntegrity(draft);
  if (!principal.isOwner) throw Object.assign(new Error("owner_only_strategy_publication"), { status: 403, code: "owner_only_strategy_publication" });
  const draftSymbols = draft.blueprint.symbols || [];
  const backtestIdsBySymbol = Object.fromEntries(draftSymbols.map((symbol) => [
    symbol,
    draft.backtestIdsBySymbol?.[symbol] || (draftSymbols.length === 1 ? draft.latestBacktestId : null)
  ]));
  const backtestsBySymbol = Object.fromEntries((draft.blueprint.symbols || []).map((symbol) => [
    symbol,
    db.strategyStudioBacktests.find((row) => row.id === backtestIdsBySymbol[symbol]
      && row.symbol === symbol
      && row.draftId === draft.id
      && row.draftHash === draft.contentHash
      && row.tenantId === draft.tenantId
      && row.ownerUserId === draft.ownerUserId)
  ]));
  const missingSymbols = (draft.blueprint.symbols || []).filter((symbol) => backtestsBySymbol[symbol]?.passed !== true);
  if (draft.generatedTests?.status !== "passed") throw new Error("发布前必须通过自动测试和样本外回测门槛");
  if (missingSymbols.length) {
    throw Object.assign(new Error(`发布前必须满足每个交易对的样本外回测门槛：${missingSymbols.join("、")}`), {
      code: "strategy_oos_symbol_coverage_incomplete",
      status: 409,
      details: { missingSymbols }
    });
  }
  const costDriftSymbols = draftSymbols.filter((symbol) => !costAssumptionMatches(backtestsBySymbol[symbol], draft.blueprint));
  if (costDriftSymbols.length) {
    throw Object.assign(new Error("candidate_strategy_cost_assumption_drift"), {
      code: "candidate_strategy_cost_assumption_drift",
      status: 409,
      details: { symbols: costDriftSymbols }
    });
  }
  const backtest = backtestsBySymbol[draft.blueprint.symbols[0]];
  if (draft.publishVersionId) {
    const existing = db.strategyBlueprintVersions.find((row) => row.id === draft.publishVersionId);
    return { version: existing, listing: db.strategyMarketplaceListings.find((row) => row.strategyVersionId === existing?.id), duplicate: true };
  }
  const productKey = cleanText(options.slug, 60).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || `studio_${draft.id.slice(-10)}`;
  const versionNumber = 1 + Math.max(0, ...db.strategyBlueprintVersions.filter((row) => row.productKey === productKey).map((row) => Number(row.version || 0)));
  const definition = { ...structuredClone(draft.blueprint), sourceDraftId: draft.id, publishedBy: actor };
  const version = {
    id: `${productKey}@${versionNumber}`,
    tenantId: draft.tenantId || db.user?.tenantId || "tenant_owner",
    ownerUserId: draft.ownerUserId || db.user?.id || null,
    productKey,
    version: versionNumber,
    contentHash: hash(definition),
    definition,
    immutable: true,
    validation: {
      generatedTests: structuredClone(draft.generatedTests),
      backtestId: backtest.id,
      backtestIdsBySymbol,
      costAssumptionHashesBySymbol: Object.fromEntries(Object.entries(backtestsBySymbol).map(([symbol, row]) => [symbol, row.costAssumption?.contentHash || null])),
      oos: structuredClone(backtest.oos),
      oosBySymbol: Object.fromEntries(Object.entries(backtestsBySymbol).map(([symbol, row]) => [symbol, structuredClone(row.oos)])),
      folds: structuredClone(backtest.folds),
      criteria: structuredClone(backtest.criteria)
    },
    createdAt: nowIso()
  };
  const listing = {
    id: id("strategy_listing"),
    strategyVersionId: version.id,
    source: "strategy_studio",
    publisher: actor,
    visibility: "internal",
    status: "published",
    evidenceLevel: "oos_passed",
    title: definition.name,
    summary: definition.description,
    tags: [definition.templateId, definition.direction, definition.timeframe],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  db.strategyBlueprintVersions.unshift(version);
  db.strategyMarketplaceListings.unshift(listing);
  draft.publishVersionId = version.id;
  draft.status = "published";
  draft.updatedAt = nowIso();
  appendAudit(db, `策略发布到内部市场：${version.id}`, listing.id, actor);
  return { version, listing };
}

export function setStrategyAssignment(db, strategyVersionId, enabled, actor = "StrategyOwner", runtime = {}) {
  ensureCollections(db);
  const version = db.strategyBlueprintVersions.find((row) => row.id === strategyVersionId);
  const principal = assertStrategyOwner(version, runtime);
  if (!principal.isOwner) throw Object.assign(new Error("owner_only_strategy_activation"), { status: 403, code: "owner_only_strategy_activation" });
  const listing = db.strategyMarketplaceListings.find((row) => row.strategyVersionId === strategyVersionId && row.status === "published");
  if (!version || !listing) throw Object.assign(new Error("市场策略版本不存在或未发布"), { status: 404 });
  if (listing.evidenceLevel !== "oos_passed") throw new Error("策略尚未通过样本外证据门槛，不能启用");
  if (enabled) {
    const eligibility = validatePublishedStrategyCandidate(db, version);
    if (!eligibility.ok) throw Object.assign(new Error(eligibility.error), {
      code: eligibility.error,
      status: eligibility.status,
      details: eligibility.details
    });
  }
  let assignment = db.strategyAssignments.find((row) => row.strategyVersionId === strategyVersionId);
  if (!assignment) {
    assignment = {
      id: id("strategy_assignment"),
      tenantId: version.tenantId,
      ownerUserId: version.ownerUserId,
      strategyVersionId,
      createdAt: nowIso()
    };
    db.strategyAssignments.unshift(assignment);
  }
  assignment.enabled = Boolean(enabled);
  assignment.mode = enabled ? "owner_live_observation" : "disabled";
  assignment.updatedBy = actor;
  assignment.updatedAt = nowIso();
  appendAudit(db, `${enabled ? "启用" : "停用"}内部市场策略：${strategyVersionId}`, assignment.id, actor, enabled ? "warning" : "info");
  return { assignment, version, listing };
}

export function evaluateBlueprintRuntime(db, version, maxSignalAgeBars = 3, symbolOverride = null) {
  const definition = version?.definition || {};
  const symbol = symbolOverride || definition.symbols?.[0];
  const market = (db.markets || []).find((row) => row.symbol === symbol);
  const candles = market?.candlesByTf?.[definition.timeframe]?.candles || (definition.timeframe === "1h" ? market?.candles : null) || [];
  const strategy = STRATEGIES[definition.templateId];
  if (!strategy || !Array.isArray(candles) || candles.length < 40) {
    return { ready: false, reason: !strategy ? "template_missing" : "closed_candles_unavailable", symbol, timeframe: definition.timeframe };
  }
  let signals;
  try { signals = strategy.signals(candles, definition.params || {}); }
  catch (error) { return { ready: false, reason: "signal_evaluation_failed", detail: error.message, symbol, timeframe: definition.timeframe }; }
  let lastSignalIndex = -1;
  for (let index = signals.length - 1; index >= 0; index -= 1) if (signals[index]) { lastSignalIndex = index; break; }
  const signalAgeBars = lastSignalIndex < 0 ? null : signals.length - 1 - lastSignalIndex;
  const lastCandle = candles.at(-1) || {};
  return {
    ready: signalAgeBars != null && signalAgeBars <= maxSignalAgeBars,
    reason: signalAgeBars == null ? "signal_not_observed" : signalAgeBars > maxSignalAgeBars ? "signal_stale" : "signal_ready",
    symbol,
    timeframe: definition.timeframe,
    signalAgeBars,
    lastSignalIndex,
    candleCount: candles.length,
    dataAt: lastCandle.ts || lastCandle.timestamp || lastCandle.time || market?.lastSyncedAt || null
  };
}

export function enabledStrategyBlueprints(db, options = {}) {
  ensureCollections(db);
  const principal = options.principal || null;
  const belongs = (row) => !principal || (row?.platformScope === "platform"
    || (row?.tenantId === principal.tenantId && row?.ownerUserId === principal.userId));
  const enabled = new Set(db.strategyAssignments.filter((row) => row.enabled && belongs(row)).map((row) => row.strategyVersionId));
  return db.strategyBlueprintVersions
    .filter((row) => enabled.has(row.id) && belongs(row) && validatePublishedStrategyCandidate(db, row).ok)
    .map((row) => ({
    id: row.id,
    tenantId: row.tenantId || null,
    ownerUserId: row.ownerUserId || null,
    platformScope: row.platformScope || null,
    contentHash: row.contentHash,
    name: row.definition.name,
    templateId: row.definition.templateId,
    baseProductId: row.definition.baseProductId,
    scenarioType: row.definition.scenarioType,
    direction: row.definition.direction,
    timeframe: row.definition.timeframe,
    symbols: row.definition.symbols,
    params: row.definition.params,
    exitPolicy: row.definition.exitPolicy,
    evidenceLevel: "oos_passed",
    mode: "owner_live_observation",
    runtime: evaluateBlueprintRuntime(db, row),
    runtimeBySymbol: Object.fromEntries((row.definition.symbols || []).map((symbol) => [symbol, evaluateBlueprintRuntime(db, row, 3, symbol)]))
  }));
}

export function bindPlanToEnabledBlueprint(db, plan, strategyVersionId) {
  ensureCollections(db);
  if (!strategyVersionId) return { ok: true, ref: null, optional: true };
  const version = db.strategyBlueprintVersions.find((row) => row.id === String(strategyVersionId));
  const assignment = db.strategyAssignments.find((row) => row.strategyVersionId === String(strategyVersionId) && row.enabled === true);
  if (!version) return { ok: false, error: "strategy_blueprint_version_missing" };
  if (!assignment) return { ok: false, error: "strategy_blueprint_not_enabled" };
  const eligibility = validatePublishedStrategyCandidate(db, version);
  if (!eligibility.ok) return { ok: false, error: eligibility.error, status: eligibility.status };
  const definition = version.definition || {};
  if (definition.baseProductId !== plan.strategyRef?.productId) return { ok: false, error: "strategy_blueprint_product_mismatch" };
  if (definition.direction !== plan.direction) return { ok: false, error: "strategy_blueprint_direction_mismatch" };
  if (definition.timeframe !== plan.timeframe) return { ok: false, error: "strategy_blueprint_timeframe_mismatch" };
  if (!definition.symbols?.includes(plan.symbol)) return { ok: false, error: "strategy_blueprint_symbol_mismatch" };
  const runtime = evaluateBlueprintRuntime(db, version, 3, plan.symbol);
  if (!runtime.ready) return { ok: false, error: `strategy_blueprint_${runtime.reason}`, runtime };
  const ref = {
    schema: "trading.strategy.blueprint.ref",
    schemaVersion: 1,
    versionId: version.id,
    productKey: version.productKey,
    contentHash: version.contentHash,
    baseProductId: definition.baseProductId,
    templateId: definition.templateId,
    paramsHash: hash({ params: definition.params, exitPolicy: definition.exitPolicy }),
    evidenceLevel: "oos_passed",
    mode: assignment.mode,
    signalEvidence: runtime,
    boundAt: nowIso()
  };
  plan.strategyBlueprintRef = ref;
  return { ok: true, ref, version, assignment };
}

export function validatePlanBlueprintGate(db, plan) {
  ensureCollections(db);
  const ref = plan?.strategyBlueprintRef;
  if (!ref) return { allowed: true, optional: true };
  const version = db.strategyBlueprintVersions.find((row) => row.id === ref.versionId);
  const assignment = db.strategyAssignments.find((row) => row.strategyVersionId === ref.versionId && row.enabled === true);
  if (!version || version.contentHash !== ref.contentHash) return { allowed: false, reason: "strategy_blueprint_version_drift" };
  if (!assignment) return { allowed: false, reason: "strategy_blueprint_disabled" };
  const eligibility = validatePublishedStrategyCandidate(db, version);
  if (!eligibility.ok) return { allowed: false, reason: eligibility.error, status: eligibility.status };
  const definition = version.definition || {};
  if (definition.baseProductId !== plan.strategyRef?.productId || definition.direction !== plan.direction || definition.timeframe !== plan.timeframe || !definition.symbols?.includes(plan.symbol)) {
    return { allowed: false, reason: "strategy_blueprint_plan_mismatch" };
  }
  if (hash({ params: definition.params, exitPolicy: definition.exitPolicy }) !== ref.paramsHash) return { allowed: false, reason: "strategy_blueprint_parameter_drift" };
  return { allowed: true, version, assignment };
}

export function buildStrategyMarketplace(db) {
  ensureCollections(db);
  const official = buildStrategyProductCatalog(db).products.map((row) => ({
    id: `official:${row.versionId}`,
    strategyVersionId: row.versionId,
    source: "official",
    publisher: "System",
    visibility: "internal",
    status: "published",
    evidenceLevel: row.deployment?.state === "validated_active" ? "live_validated" : "live_observation",
    enabled: !["paused", "degraded", "retired"].includes(row.deployment?.state),
    title: row.definition.name,
    titleEn: row.definition.nameEn,
    summary: row.definition.summary,
    summaryEn: row.definition.summaryEn,
    tags: [row.definition.family, row.definition.direction, ...row.definition.roles],
    definition: row.definition,
    metrics: row.metrics,
    validation: row.evidence,
    immutable: row.immutable,
    contentHash: row.contentHash
  }));
  const assignments = new Map(db.strategyAssignments.map((row) => [row.strategyVersionId, row]));
  const studio = db.strategyMarketplaceListings.filter((row) => row.status === "published").map((listing) => {
    const version = db.strategyBlueprintVersions.find((row) => row.id === listing.strategyVersionId);
    return {
      ...listing,
      enabled: assignments.get(listing.strategyVersionId)?.enabled === true,
      definition: version?.definition,
      validation: version?.validation,
      contentHash: version?.contentHash,
      immutable: version?.immutable,
      runtimeBySymbol: Object.fromEntries((version?.definition?.symbols || []).map((symbol) => [symbol, evaluateBlueprintRuntime(db, version, 3, symbol)]))
    };
  }).filter((row) => row.definition);
  return {
    listings: [...official, ...studio],
    summary: {
      total: official.length + studio.length,
      official: official.length,
      studio: studio.length,
      enabled: official.filter((row) => row.enabled).length + studio.filter((row) => row.enabled).length,
      oosPassed: studio.filter((row) => row.evidenceLevel === "oos_passed").length
    }
  };
}

export function strategyStudioSnapshot(db, options = {}) {
  ensureCollections(db);
  const principal = strategyPrincipal(options);
  const owned = (row) => row?.tenantId === principal.tenantId && row?.ownerUserId === principal.userId;
  const compact = options.compact === true;
  const ownedVersions = db.strategyBlueprintVersions.filter(owned);
  const ownedVersionIds = new Set(ownedVersions.map((row) => row.id));
  const backtests = db.strategyStudioBacktests.filter(owned).slice(0, compact ? 20 : 50).map((row) => compact ? {
    ...row,
    train: row.train ? { ...row.train, equityCurve: undefined } : null,
    folds: (row.folds || []).map((fold) => ({ ...fold, equityCurve: undefined })),
    oos: row.oos ? { ...row.oos, equityCurve: (row.oos.equityCurve || []).slice(-40) } : null
  } : row);
  return {
    templates: supportedStudioTemplates(),
    drafts: db.strategyStudioDrafts.filter(owned).slice(0, 50),
    versions: ownedVersions.slice(0, 50),
    backtests,
    assignments: db.strategyAssignments.filter((row) => ownedVersionIds.has(row.strategyVersionId)).slice(0, 100),
    marketplace: (() => {
      const market = buildStrategyMarketplace(db);
      const listings = market.listings.filter((row) => row.source === "official" || ownedVersionIds.has(row.strategyVersionId));
      return { ...market, listings, summary: { ...market.summary, total: listings.length, studio: listings.filter((row) => row.source !== "official").length, enabled: listings.filter((row) => row.enabled).length, oosPassed: listings.filter((row) => row.source !== "official" && row.evidenceLevel === "oos_passed").length } };
    })()
  };
}

export function strategyDraftsReferencedByChat(db, options = {}) {
  ensureCollections(db);
  const principal = strategyPrincipal(options);
  const referenced = new Set((db.chatMessages || []).map((message) => message?.strategyDraftId).filter(Boolean));
  if (!referenced.size) return [];
  return db.strategyStudioDrafts.filter((draft) => referenced.has(draft?.id)
    && draft.tenantId === principal.tenantId
    && draft.ownerUserId === principal.userId);
}
