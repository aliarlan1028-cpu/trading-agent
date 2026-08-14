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

function ensureCollections(db) {
  db.strategyStudioDrafts ||= [];
  db.strategyBlueprintVersions ||= [];
  db.strategyStudioBacktests ||= [];
  db.strategyMarketplaceListings ||= [];
  db.strategyAssignments ||= [];
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function cleanText(value, max = 2000) {
  return String(value || "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max);
}

function isEnglishText(value) { return !/[\u3400-\u9fff]/.test(String(value || "")); }

function explicitTimeframe(text = "") {
  const source = String(text);
  if (/4\s*(?:小时|h\b)/i.test(source)) return "4h";
  if (/(?:日线|1\s*d\b|daily)/i.test(source)) return "1d";
  if (/15\s*(?:分钟|分|m\b)/i.test(source)) return "15m";
  if (/5\s*(?:分钟|分|m\b)/i.test(source)) return "5m";
  if (/(?:1\s*小时|1\s*h\b|hourly)/i.test(source)) return "1h";
  return null;
}

function normalizeTimeframe(value, text = "") {
  const fromText = explicitTimeframe(text);
  if (fromText) return fromText;
  const raw = String(value || "").trim().toLowerCase();
  if (TIMEFRAMES.has(raw)) return raw;
  return "1h";
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

function normalizeSymbols(value, text = "") {
  const fromText = symbolsFromText(text);
  if (fromText.length) return fromText;
  const fromCandidate = symbolsFromText(value);
  return fromCandidate.length ? fromCandidate : ["BTC/USDT"];
}

function inferDirection(text, candidate) {
  if (/做空|空头|卖空|short/i.test(text)) return "short";
  if (/做多|多头|买入|long/i.test(text)) return "long";
  const raw = String(candidate || "").toLowerCase();
  if (["long", "short"].includes(raw)) return raw;
  return "long";
}

function pickTemplate(text, direction, candidate) {
  if (candidate && TEMPLATE_META[candidate] && TEMPLATE_META[candidate].direction === direction) return candidate;
  const match = Object.entries(TEMPLATE_META).find(([, meta]) => meta.direction === direction && meta.keywords.test(text));
  return match?.[0] || (direction === "short" ? "death_cross" : "trend");
}

function extractNumber(text, patterns) {
  for (const pattern of patterns) {
    const value = Number(String(text).match(pattern)?.[1]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function inferParams(text, templateId, candidate = {}) {
  const defaults = STRATEGIES[templateId]?.defaultParams || {};
  const params = { ...defaults };
  for (const [key, value] of Object.entries(candidate || {})) if (PARAM_BOUNDS[key] && Number.isFinite(Number(value))) params[key] = Number(value);
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

function inferExitPolicy(text, candidate = {}) {
  const stopFromText = extractNumber(text, [/(?:止损|stop(?: loss)?)\D{0,12}(\d+(?:\.\d+)?)\s*%/i]);
  const rewardFromText = extractNumber(text, [/(?:止盈|目标|盈亏比|RR|reward.?risk|target|take.?profit)\D{0,12}(\d+(?:\.\d+)?)\s*R?/i]);
  const stopRaw = stopFromText ?? candidate.stopLossPct;
  const rewardRaw = rewardFromText ?? candidate.takeProfitR;
  const stop = stopRaw == null ? NaN : Number(stopRaw);
  const reward = rewardRaw == null ? NaN : Number(rewardRaw);
  return {
    stopLossPct: Number.isFinite(stop) ? Math.max(0.1, Math.min(stop, 10)) : 2,
    takeProfitR: Number.isFinite(reward) ? Math.max(0.5, Math.min(reward, 8)) : 2,
    atrStop: candidate.atrStop === true || /ATR\s*止损|ATR.?based stop/i.test(text),
    atrMult: Number.isFinite(Number(candidate.atrMult)) ? Number(candidate.atrMult) : 2,
    atrPeriod: Number.isFinite(Number(candidate.atrPeriod)) ? Number(candidate.atrPeriod) : 14
  };
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
  const direction = inferDirection(text, candidate.direction);
  const templateId = pickTemplate(text, direction, candidate.templateId);
  const strategy = STRATEGIES[templateId];
  const meta = TEMPLATE_META[templateId];
  const name = cleanText(candidate.name, 80) || `${normalizeSymbols(candidate.symbols, text)[0]} ${isEnglishText(text) ? TEMPLATE_LABEL_EN[templateId] : strategy.label}`;
  const blueprint = {
    schema: "trading.strategy.blueprint",
    schemaVersion: 1,
    compilerRevision: 1,
    name,
    description: cleanText(candidate.description, 500) || text.slice(0, 500),
    templateId,
    templateName: strategy.label,
    templateNameEn: TEMPLATE_LABEL_EN[templateId],
    baseProductId: meta.productId,
    scenarioType: meta.scenarioType,
    direction,
    timeframe: normalizeTimeframe(candidate.timeframe, text),
    symbols: normalizeSymbols(candidate.symbols, text),
    params: inferParams(text, templateId, candidate.params),
    exitPolicy: inferExitPolicy(text, candidate.exitPolicy),
    costs: { ...COST_DEFAULTS },
    executionPolicy: {
      exchange: "OKX",
      requiresHardRiskGate: true,
      requiresFreshEvidence: true,
      requiresVersionPin: true,
      llmMayBypass: false
    },
    sourcePrompt: text
  };
  return { blueprint, contentHash: hash(blueprint) };
}

const COMPILER_SYSTEM = `你是交易策略编译器。只把自然语言映射到给定白名单，不生成代码，不承诺收益。
只输出一个 JSON 对象，可用字段：name,description,templateId,direction,timeframe,symbols,params,exitPolicy。
templateId 只能是 trend,meanrev,breakout,macd,bollinger,death_cross,rsi_short,breakdown,supertrend,vol_breakout,squeeze,rsi_bull_div,rsi_bear_div。
direction 只能 long/short；timeframe 只能 5m/15m/1h/4h/1d。未明确的字段不要猜，省略即可。`;

export async function createStrategyDraft(db, prompt, options = {}, actor = "StrategyOwner") {
  ensureCollections(db);
  let candidate = {};
  let compiler = "deterministic_fallback";
  if (typeof options.complete === "function") {
    try {
      const raw = await options.complete(`${cleanText(prompt, 6000)}\n\n白名单说明：${JSON.stringify(supportedStudioTemplates())}`, COMPILER_SYSTEM);
      candidate = extractJson(raw) || {};
      compiler = Object.keys(candidate).length ? "llm_to_closed_schema" : compiler;
    } catch { /* 确定性编译器仍可继续，不把模型故障变成工作室不可用 */ }
  }
  const compiled = compileStrategyPrompt(prompt, candidate);
  return persistStrategyDraft(db, compiled, {
    compiler,
    actor,
    authoring: { channel: "strategy_studio", toolName: null }
  });
}

function persistStrategyDraft(db, compiled, { compiler, actor, authoring } = {}) {
  ensureCollections(db);
  const draft = {
    id: id("strategy_draft"),
    status: "compiled",
    revision: 1,
    compiler: compiler || "deterministic_fallback",
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
export function createStrategyDraftFromIdea(db, idea = {}, actor = "AgentChat") {
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
    actor,
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
      add("cost_model", "成本模型生效", "Cost model included", blueprint.costs?.feePct >= 0 && blueprint.costs?.slippagePct >= 0 && blueprint.costs?.fundingPct8h >= 0 && Number.isFinite(metrics.netReturnPct), "手续费、滑点与资金费率均纳入", "Fees, slippage, and funding are included");
    }
  }
  add("risk_contract", "执行风控不可绕过", "Risk controls cannot be bypassed", blueprint?.executionPolicy?.requiresHardRiskGate === true && blueprint?.executionPolicy?.requiresFreshEvidence === true && blueprint?.executionPolicy?.llmMayBypass === false, "必须通过账户、证据和硬风控复核", "Account facts, evidence, and hard-risk checks remain mandatory");
  return { status: tests.every((test) => test.passed) ? "passed" : "failed", passed: tests.filter((test) => test.passed).length, total: tests.length, tests, generatedAt: nowIso() };
}

export function runDraftGeneratedTests(db, draftId, actor = "StrategyOwner") {
  ensureCollections(db);
  const draft = db.strategyStudioDrafts.find((row) => row.id === draftId);
  if (!draft) throw Object.assign(new Error("策略草稿不存在"), { status: 404 });
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
    costs: draft.blueprint.costs,
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
  const backtest = db.strategyStudioBacktests.find((row) => row.id === draft.latestBacktestId);
  if (draft.generatedTests?.status !== "passed" || !backtest?.passed) throw new Error("发布前必须通过自动测试和样本外回测门槛");
  if (draft.publishVersionId) {
    const existing = db.strategyBlueprintVersions.find((row) => row.id === draft.publishVersionId);
    return { version: existing, listing: db.strategyMarketplaceListings.find((row) => row.strategyVersionId === existing?.id), duplicate: true };
  }
  const productKey = cleanText(options.slug, 60).toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || `studio_${draft.id.slice(-10)}`;
  const versionNumber = 1 + Math.max(0, ...db.strategyBlueprintVersions.filter((row) => row.productKey === productKey).map((row) => Number(row.version || 0)));
  const definition = { ...draft.blueprint, sourceDraftId: draft.id, publishedBy: actor };
  const version = {
    id: `${productKey}@${versionNumber}`,
    productKey,
    version: versionNumber,
    contentHash: hash(definition),
    definition,
    immutable: true,
    validation: { generatedTests: draft.generatedTests, backtestId: backtest.id, oos: backtest.oos, folds: backtest.folds, criteria: backtest.criteria },
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

export function setStrategyAssignment(db, strategyVersionId, enabled, actor = "StrategyOwner") {
  ensureCollections(db);
  const version = db.strategyBlueprintVersions.find((row) => row.id === strategyVersionId);
  const listing = db.strategyMarketplaceListings.find((row) => row.strategyVersionId === strategyVersionId && row.status === "published");
  if (!version || !listing) throw Object.assign(new Error("市场策略版本不存在或未发布"), { status: 404 });
  if (listing.evidenceLevel !== "oos_passed") throw new Error("策略尚未通过样本外证据门槛，不能启用");
  let assignment = db.strategyAssignments.find((row) => row.strategyVersionId === strategyVersionId);
  if (!assignment) {
    assignment = { id: id("strategy_assignment"), strategyVersionId, createdAt: nowIso() };
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

export function enabledStrategyBlueprints(db) {
  ensureCollections(db);
  const enabled = new Set(db.strategyAssignments.filter((row) => row.enabled).map((row) => row.strategyVersionId));
  return db.strategyBlueprintVersions.filter((row) => enabled.has(row.id)).map((row) => ({
    id: row.id,
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
  const compact = options.compact === true;
  const backtests = db.strategyStudioBacktests.slice(0, compact ? 20 : 50).map((row) => compact ? {
    ...row,
    train: row.train ? { ...row.train, equityCurve: undefined } : null,
    folds: (row.folds || []).map((fold) => ({ ...fold, equityCurve: undefined })),
    oos: row.oos ? { ...row.oos, equityCurve: (row.oos.equityCurve || []).slice(-40) } : null
  } : row);
  return {
    templates: supportedStudioTemplates(),
    drafts: db.strategyStudioDrafts.slice(0, 50),
    versions: db.strategyBlueprintVersions.slice(0, 50),
    backtests,
    assignments: db.strategyAssignments.slice(0, 100),
    marketplace: buildStrategyMarketplace(db)
  };
}
