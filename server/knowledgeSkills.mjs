import crypto from "node:crypto";
import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { BAR_MINUTES, simulate } from "./backtestEngine.mjs";
import { createPaperSession } from "./paperTrading.mjs";
import { detectRegime, getStrategy, STRATEGIES } from "./strategies.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { applyCompiledSignalConstraints, runtimeInvalidationTriggered } from "./compiledSignals.mjs";

const TIMEFRAMES = new Set(["5m", "15m", "1h", "4h", "1d"]);
const EXECUTABLE_STATES = new Set(["active"]);
const TERMINAL_STATES = new Set(["retired", "superseded"]);
const MAX_INVOCATIONS = 1000;
const MIN_LIVE_ATTRIBUTION_TRADES = Math.max(5, Number(process.env.KNOWLEDGE_SKILL_MIN_LIVE_TRADES || 10));

const TEMPLATE_RULES = [
  { pattern: /底背离|bull(?:ish)? divergence/i, long: "rsi_bull_div", short: "rsi_bear_div" },
  { pattern: /顶背离|bear(?:ish)? divergence/i, long: "rsi_bull_div", short: "rsi_bear_div" },
  { pattern: /布林|bollinger/i, long: "bollinger", short: "rsi_short" },
  { pattern: /macd/i, long: "macd", short: "death_cross" },
  { pattern: /均值回归|超卖|rsi|mean.?reversion|oversold/i, long: "meanrev", short: "rsi_short" },
  { pattern: /突破|唐奇安|breakout|通道上破/i, long: "breakout", short: "breakdown" },
  { pattern: /跌破|下破|breakdown/i, long: "breakout", short: "breakdown" },
  { pattern: /均线|趋势|顺势|交叉|trend|moving average/i, long: "trend", short: "death_cross" }
];

function ensureCollections(db) {
  db.knowledge ||= {};
  db.knowledge.tradingMethods ||= [];
  db.knowledge.tradingSkills ||= [];
  db.knowledge.skillInvocations ||= [];
  db.knowledge.skillAttributions ||= [];
  db.paperSessions ||= [];
}

function normalizeTimeframe(value) {
  const tf = String(value || "1h").replace("H", "h").replace("D", "d");
  return TIMEFRAMES.has(tf) ? tf : null;
}

function normalizeSymbolScope(value) {
  const raw = String(value || "通用").trim().toUpperCase();
  if (!raw || /通用|全部|ANY|ALL/.test(raw)) return ["*"];
  const parts = /^[A-Z0-9-]+\/(?:USDT|USDC|USD)$/.test(raw) ? [raw] : raw.split(/[，,、/\s]+/);
  const symbols = parts.filter(Boolean).map((symbol) => {
    if (symbol === "*") return symbol;
    if (symbol.includes("/")) return symbol;
    return `${symbol.replace(/USDT$/, "")}/USDT`;
  });
  return [...new Set(symbols)].slice(0, 12);
}

function inferExitParams(method = {}) {
  const stopText = String(method.stop || "");
  const targetText = String(method.takeProfit || "");
  const stopPct = Number(stopText.match(/(\d+(?:\.\d+)?)\s*%/)?.[1]);
  const atrMult = Number(stopText.match(/(\d+(?:\.\d+)?)\s*(?:倍\s*)?ATR/i)?.[1]);
  const rewardRisk = Number(targetText.match(/(\d+(?:\.\d+)?)\s*R\b/i)?.[1]);
  const params = {
    stopLossPct: Number.isFinite(stopPct) ? Math.max(0.1, Math.min(stopPct, 10)) : 2,
    takeProfitR: Number.isFinite(rewardRisk) ? Math.max(0.5, Math.min(rewardRisk, 8)) : 2
  };
  if (Number.isFinite(atrMult)) {
    params.atrStop = true;
    params.atrMult = Math.max(0.5, Math.min(atrMult, 6));
    params.atrPeriod = 14;
  }
  return params;
}

function inferEntryParams(method = {}, templateId) {
  const text = String(method.entry || "");
  if (["breakout", "breakdown"].includes(templateId)) {
    const lookback = Number(text.match(/(?:过去|近|前)?\s*(\d+)\s*(?:根|周期|日|小时)/i)?.[1]);
    return Number.isFinite(lookback) ? { lookback: Math.max(5, Math.min(lookback, 500)) } : {};
  }
  if (["trend", "death_cross"].includes(templateId)) {
    const periods = [...text.matchAll(/(\d+)\s*(?:周期|日|小时)?(?:均线|MA|EMA|SMA)/gi)].map((match) => Number(match[1]));
    if (periods.length >= 2) {
      const [fast, slow] = periods.slice(0, 2).sort((a, b) => a - b);
      return { fast: Math.max(2, fast), slow: Math.max(fast + 1, slow) };
    }
  }
  if (["meanrev", "rsi_short"].includes(templateId)) {
    const period = Number(text.match(/RSI\s*[\[(（]?\s*(\d+)/i)?.[1]);
    const threshold = Number(text.match(/(?:低于|小于|超卖|高于|大于|超买)\s*(\d+)/i)?.[1]);
    return {
      ...(Number.isFinite(period) ? { period } : {}),
      ...(Number.isFinite(threshold) ? templateId === "rsi_short" ? { overbought: threshold } : { oversold: threshold } : {})
    };
  }
  return {};
}

function compileConfirmation(value) {
  const text = String(value || "").trim();
  if (!text) return { spec: { type: "none" }, error: null };
  const volume = text.match(/成交量.*?(?:高于|大于|超过).*?(\d+)?\s*(?:周期|根)?(?:均量|平均)/i)
    || text.match(/volume.*?(?:above|greater).*?(\d+)?/i);
  if (volume) {
    return { spec: { type: "volume_above_sma", period: Math.max(2, Number(volume[1] || 20)), multiplier: 1 }, error: null };
  }
  return { spec: null, error: "确认条件无法编译为受支持的确定性规则" };
}

function compileInvalidation(value) {
  const text = String(value || "").trim();
  if (!text) return { spec: { type: "none" }, error: null };
  if (/重大事件|高影响事件|宏观事件|major event|high.?impact event/i.test(text)) {
    return { spec: { type: "high_impact_event", minImpact: 80 }, error: null };
  }
  return { spec: null, error: "失效条件无法编译为受支持的确定性规则" };
}

function pickTemplate(method = {}, overrideTemplateId) {
  if (overrideTemplateId && STRATEGIES[overrideTemplateId]) return overrideTemplateId;
  const direction = method.direction === "short" ? "short" : "long";
  const text = [method.name, method.marketRegime, method.entry, method.confirmation, method.rationale].join(" ");
  const match = TEMPLATE_RULES.find((rule) => rule.pattern.test(text));
  return match ? match[direction] : null;
}

function fingerprint(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function compileMethodToSpec(method = {}, source = {}, overrides = {}) {
  const errors = [];
  const warnings = [];
  const timeframe = normalizeTimeframe(overrides.timeframe || method.timeframe);
  const templateId = pickTemplate(method, overrides.templateId);
  const direction = overrides.direction || method.direction;
  const confirmation = compileConfirmation(method.confirmation);
  const invalidation = compileInvalidation(method.invalidation);

  if (source.type === "book_title" || source.synthetic === true) {
    errors.push("按书名生成的模型综述不是用户提供的原始证据，禁止编译为自主交易技能");
  }
  if (!String(method.entry || "").trim()) errors.push("缺少明确入场条件");
  if (!String(method.stop || "").trim()) errors.push("缺少明确止损条件");
  if (!String(method.takeProfit || "").trim()) errors.push("缺少明确止盈或离场条件");
  if (!["long", "short"].includes(direction)) errors.push("方向必须明确为 long 或 short；both 需要拆分为两个技能");
  if (!timeframe) errors.push("周期不受支持，仅允许 5m/15m/1h/4h/1d");
  if (!templateId) errors.push("自然语言方法无法安全映射到受支持的白名单策略模板");
  if (confirmation.error) errors.push(confirmation.error);
  if (invalidation.error) errors.push(invalidation.error);

  const strategy = templateId ? getStrategy(templateId) : null;
  const params = strategy
    ? { ...strategy.defaultParams, ...inferEntryParams(method, templateId), ...inferExitParams(method), ...(overrides.params || {}) }
    : {};
  if (!/(\d|ATR|均线|RSI|MACD|布林|突破|跌破|成交量|背离)/i.test(String(method.entry || ""))) {
    warnings.push("入场描述缺少明显可计算指标，模板仅代表保守近似，审批前必须人工核对");
  }

  const spec = {
    schemaVersion: 1,
    templateId,
    templateLabel: strategy?.label || null,
    direction,
    symbolScope: normalizeSymbolScope(overrides.symbolScope || method.symbolScope),
    timeframe,
    marketRegimes: [String(method.marketRegime || "通用")],
    params,
    confirmationSpec: confirmation.spec,
    invalidationSpec: invalidation.spec,
    sourceMethodId: method.id,
    sourceId: source.id || method.source?.id || null,
    sourceTitle: source.title || method.source?.title || null,
    sourceContentHash: source.contentHash || null,
    entryDescription: String(method.entry || ""),
    confirmationDescription: String(method.confirmation || ""),
    stopDescription: String(method.stop || ""),
    takeProfitDescription: String(method.takeProfit || ""),
    invalidationDescription: String(method.invalidation || "")
  };
  return { ok: errors.length === 0, spec, errors, warnings, fingerprint: fingerprint(spec) };
}

export function compileTradingMethod(db, methodId, overrides = {}, actor = "KnowledgeCompiler") {
  ensureCollections(db);
  const method = db.knowledge.tradingMethods.find((item) => item.id === methodId);
  if (!method) throw new Error("交易方法不存在");
  const source = db.knowledge.sources?.find((item) => item.id === (method.source?.id || method.sourceId)) || method.source || {};
  const compiled = compileMethodToSpec(method, source, overrides);
  const lineageKey = `${source.id || "unknown"}:${String(method.name || "").trim().toLowerCase()}:${compiled.spec.direction || "unresolved"}`;
  const previous = db.knowledge.tradingSkills
    .filter((skill) => skill.lineageKey === lineageKey)
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0];
  if (previous?.fingerprint === compiled.fingerprint && !TERMINAL_STATES.has(previous.status)) return previous;

  if (previous && !TERMINAL_STATES.has(previous.status)) {
    previous.status = "superseded";
    previous.supersededAt = nowIso();
  }
  const skill = {
    id: id("kskill"),
    lineageKey,
    name: method.name,
    version: Number(previous?.version || 0) + 1,
    status: compiled.ok ? "compiled" : "compile_failed",
    executable: false,
    sourceMethodId: method.id,
    sourceId: source.id || null,
    sourceTitle: source.title || null,
    sourceType: source.type || null,
    citationRefs: (db.knowledge.chunks || [])
      .filter((chunk) => chunk.sourceId === source.id)
      .slice(0, 8)
      .map((chunk) => ({ chunkId: chunk.id, citationLocator: chunk.citationLocator })),
    spec: compiled.spec,
    compileErrors: compiled.errors,
    compileWarnings: compiled.warnings,
    fingerprint: compiled.fingerprint,
    validation: null,
    paperSessionId: null,
    approval: null,
    liveMetrics: null,
    lifecycle: [{ from: null, to: compiled.ok ? "compiled" : "compile_failed", reason: "knowledge_compilation", actor, at: nowIso() }],
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  db.knowledge.tradingSkills.unshift(skill);
  appendAudit(db, `编译知识技能「${skill.name}」v${skill.version}：${skill.status}`, skill.id, actor, compiled.ok ? "info" : "warning");
  appendTrace(db, "knowledge_skill_compile", `${skill.name} v${skill.version}`, compiled.ok ? "ok" : "blocked");
  return skill;
}

function transition(skill, next, reason, actor) {
  const from = skill.status;
  skill.status = next;
  skill.executable = next === "active";
  skill.updatedAt = nowIso();
  skill.lifecycle ||= [];
  skill.lifecycle.push({ from, to: next, reason, actor, at: skill.updatedAt });
}

function evaluateWindow(candles, signals, from, to, skill) {
  const strategy = getStrategy(skill.spec.templateId);
  return simulate(candles.slice(from, to), signals.slice(from, to), {
    ...skill.spec.params,
    direction: strategy.direction || skill.spec.direction,
    barMinutes: BAR_MINUTES[skill.spec.timeframe] || 60,
    riskPerTradePct: 0.5
  });
}

export function validateKnowledgeSkillWithCandles(db, skillId, candles, actor = "KnowledgeValidator") {
  ensureCollections(db);
  const skill = db.knowledge.tradingSkills.find((item) => item.id === skillId);
  if (!skill) throw new Error("知识技能不存在");
  if (!["compiled", "historical_rejected", "degraded"].includes(skill.status)) throw new Error(`当前状态 ${skill.status} 不允许历史验证`);
  if (!Array.isArray(candles) || candles.length < 180) throw new Error("历史 K 线不足，至少需要 180 根");
  const strategy = STRATEGIES[skill.spec.templateId];
  if (!strategy) throw new Error("编译模板不存在或已被移除");

  const signals = applyCompiledSignalConstraints(candles, strategy.signals(candles, skill.spec.params || {}), skill.spec);
  const n = candles.length;
  const trainEnd = Math.floor(n * 0.4);
  const validationEnd = Math.floor(n * 0.7);
  const train = evaluateWindow(candles, signals, 0, trainEnd, skill);
  const validation = evaluateWindow(candles, signals, trainEnd, validationEnd, skill);
  const test = evaluateWindow(candles, signals, validationEnd, n, skill);
  const oosTrades = Number(validation.trades || 0) + Number(test.trades || 0);
  const passed = train.trades >= 5
    && validation.trades >= 3
    && test.trades >= 3
    && oosTrades >= 8
    && validation.expectancyR > 0
    && test.expectancyR > 0
    && (validation.profitFactor == null || validation.profitFactor >= 1.05)
    && (test.profitFactor == null || test.profitFactor >= 1.05)
    && (validation.maxDrawdownPct ?? 100) <= 20
    && (test.maxDrawdownPct ?? 100) <= 20;
  skill.validation = {
    status: passed ? "passed" : "failed",
    methodology: "40/30/30 chronological holdout",
    candles: n,
    regime: detectRegime(candles.slice(validationEnd)),
    train,
    validation,
    test,
    criteria: {
      minTrainTrades: 5,
      minValidationTrades: 3,
      minTestTrades: 3,
      minOosTrades: 8,
      positiveValidationAndTest: true,
      minProfitFactor: 1.05,
      maxDrawdownPct: 20
    },
    validatedAt: nowIso()
  };
  transition(skill, passed ? "historical_validated" : "historical_rejected", passed ? "historical_holdout_passed" : "historical_holdout_failed", actor);
  appendAudit(db, `知识技能历史验证「${skill.name}」：${passed ? "通过" : "未通过"}`, skill.id, actor, passed ? "info" : "warning");
  return { passed, skill, validation: skill.validation };
}

export async function validateKnowledgeSkill(db, skillId, options = {}, actor = "KnowledgeValidator") {
  ensureCollections(db);
  const skill = db.knowledge.tradingSkills.find((item) => item.id === skillId);
  if (!skill) throw new Error("知识技能不存在");
  const symbol = String(options.symbol || skill.spec.symbolScope.find((item) => item !== "*") || "BTC/USDT").toUpperCase();
  const timeframe = normalizeTimeframe(options.timeframe || skill.spec.timeframe);
  if (timeframe !== skill.spec.timeframe) throw new Error("历史验证周期必须与编译技能周期完全一致");
  if (!skill.spec.symbolScope.includes("*") && !skill.spec.symbolScope.includes(symbol)) throw new Error("验证交易对不在技能编译范围内");
  const candles = await getHistoricalKlines(symbol, timeframe, Math.min(3000, Math.max(600, Number(options.limit || 2500))));
  const result = validateKnowledgeSkillWithCandles(db, skillId, candles, actor);
  skill.validation.symbol = symbol;
  skill.validation.timeframe = timeframe;
  skill.validation.validatedSymbols = [...new Set([...(skill.validation.validatedSymbols || []), symbol])];
  return result;
}

export async function startKnowledgeSkillPaper(db, skillId, options = {}, actor = "KnowledgeValidator") {
  ensureCollections(db);
  const skill = db.knowledge.tradingSkills.find((item) => item.id === skillId);
  if (!skill) throw new Error("知识技能不存在");
  if (skill.status !== "historical_validated") throw new Error("技能必须先通过历史样本外验证");
  const symbol = String(options.symbol || skill.validation?.symbol || skill.spec.symbolScope.find((item) => item !== "*") || "BTC/USDT").toUpperCase();
  if (skill.validation?.symbol && symbol !== skill.validation.symbol) throw new Error("模拟盘交易对必须与历史验证交易对一致");
  const result = await createPaperSession(db, {
    symbol,
    timeframe: skill.spec.timeframe,
    strategyId: skill.spec.templateId,
    params: {
      ...skill.spec.params,
      compiledConfirmationSpec: skill.spec.confirmationSpec,
      compiledSkillFingerprint: skill.fingerprint
    },
    direction: skill.spec.direction,
    knowledgeSkillId: skill.id,
    knowledgeSkillVersion: skill.version,
    lookbackBars: 0,
    source: "knowledge_skill"
  });
  if (result.status !== "ok") return result;
  skill.paperSessionId = result.session.id;
  transition(skill, "paper_validating", "forward_paper_started", actor);
  appendAudit(db, `知识技能进入纯前向模拟盘「${skill.name}」`, skill.id, actor);
  return { status: "ok", skill, session: result.session };
}

export function syncKnowledgeSkillLifecycle(db, actor = "KnowledgeLifecycle") {
  ensureCollections(db);
  const changes = [];
  for (const skill of db.knowledge.tradingSkills) {
    if (skill.status !== "paper_validating" || !skill.paperSessionId) continue;
    const session = db.paperSessions.find((item) => item.id === skill.paperSessionId);
    if (!session || !["passed", "failed"].includes(session.status)) continue;
    const sessionMatches = session.seeded === false
      && session.knowledgeSkillId === skill.id
      && Number(session.knowledgeSkillVersion) === Number(skill.version)
      && session.params?.compiledSkillFingerprint === skill.fingerprint
      && session.symbol === skill.validation?.symbol
      && session.timeframe === (skill.validation?.timeframe || skill.spec.timeframe);
    if (!sessionMatches) {
      transition(skill, "paper_rejected", "paper_session_integrity_mismatch", actor);
      changes.push({ skillId: skill.id, status: skill.status });
      continue;
    }
    transition(skill, session.status === "passed" ? "paper_validated" : "paper_rejected", `paper_${session.status}`, actor);
    changes.push({ skillId: skill.id, status: skill.status });
  }
  const attribution = refreshKnowledgeSkillAttribution(db, actor);
  return { changes, attribution };
}

export function approveKnowledgeSkill(db, skillId, approvedBy, note = "") {
  ensureCollections(db);
  const skill = db.knowledge.tradingSkills.find((item) => item.id === skillId);
  if (!skill) throw new Error("知识技能不存在");
  syncKnowledgeSkillLifecycle(db);
  if (skill.status !== "paper_validated") throw new Error("技能必须先通过纯前向模拟盘验证");
  skill.approval = { approved: true, approvedBy, note: String(note || "").slice(0, 500), approvedAt: nowIso(), fingerprint: skill.fingerprint };
  transition(skill, "active", "human_approved", approvedBy);
  appendAudit(db, `批准并启用知识技能「${skill.name}」v${skill.version}`, skill.id, approvedBy, "warning");
  return skill;
}

export function retireKnowledgeSkill(db, skillId, actor, reason = "manual_retirement") {
  ensureCollections(db);
  const skill = db.knowledge.tradingSkills.find((item) => item.id === skillId);
  if (!skill) throw new Error("知识技能不存在");
  if (skill.status === "retired") return skill;
  skill.retirement = { reason: String(reason || "manual_retirement").slice(0, 500), retiredBy: actor, retiredAt: nowIso() };
  transition(skill, "retired", skill.retirement.reason, actor);
  appendAudit(db, `退役知识技能「${skill.name}」v${skill.version}`, skill.id, actor, "warning");
  return skill;
}

export function retireSkillsForSource(db, sourceId, actor = "KnowledgeCurator", reason = "source_removed_or_reparsed") {
  ensureCollections(db);
  const retired = [];
  for (const skill of db.knowledge.tradingSkills) {
    if (skill.sourceId !== sourceId || TERMINAL_STATES.has(skill.status)) continue;
    retireKnowledgeSkill(db, skill.id, actor, reason);
    retired.push(skill.id);
  }
  return retired;
}

function scopeMatches(scope = [], symbol) {
  if (!symbol) return true;
  return scope.includes("*") || scope.includes(String(symbol || "").toUpperCase());
}

function regimeMatches(allowed = [], regime = "") {
  const expected = allowed.join(" ");
  if (!expected || /通用|任意|all/i.test(expected)) return true;
  if (/震荡|区间|range/i.test(expected)) return /震荡|区间|range/i.test(regime);
  if (/下行|空头|bear/i.test(expected)) return /下行|空头|bear/i.test(regime);
  if (/上行|多头|bull|趋势|trend/i.test(expected)) return /上行|多头|bull|趋势|trend/i.test(regime);
  return true;
}

export function selectActiveKnowledgeSkills(db, context = {}, options = {}) {
  ensureCollections(db);
  syncKnowledgeSkillLifecycle(db);
  const limit = Math.max(1, Math.min(5, Number(options.limit || 3)));
  const symbol = String(context.symbol || "").toUpperCase();
  const direction = String(context.direction || "");
  const timeframe = normalizeTimeframe(context.timeframe) || null;
  const regime = String(context.regime || "");
  return db.knowledge.tradingSkills
    .filter((skill) => EXECUTABLE_STATES.has(skill.status) && skill.approval?.fingerprint === skill.fingerprint)
    .filter((skill) => scopeMatches(skill.spec.symbolScope, symbol))
    .filter((skill) => !skill.spec.symbolScope.includes("*") || !symbol || skill.validation?.validatedSymbols?.includes(symbol))
    .filter((skill) => !direction || skill.spec.direction === direction)
    .filter((skill) => !timeframe || skill.spec.timeframe === timeframe)
    .filter((skill) => regimeMatches(skill.spec.marketRegimes, regime))
    .map((skill) => ({
      ...skill,
      matchScore: Number((
        0.4
        + (skill.spec.symbolScope.includes(symbol) ? 0.2 : 0)
        + (direction && skill.spec.direction === direction ? 0.15 : 0)
        + (timeframe && skill.spec.timeframe === timeframe ? 0.15 : 0)
        + (regime && regimeMatches(skill.spec.marketRegimes, regime) ? 0.1 : 0)
      ).toFixed(2))
    }))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);
}

export function evaluateKnowledgeSkillSignal(db, skill, symbol) {
  const market = (db.markets || []).find((item) => item.symbol === String(symbol || "").toUpperCase());
  const candles = Array.isArray(market?.candles) ? market.candles : [];
  if (normalizeTimeframe(market?.candlesTimeframe) !== skill.spec.timeframe) {
    return {
      triggered: false,
      reason: "candle_timeframe_mismatch",
      expectedTimeframe: skill.spec.timeframe,
      actualTimeframe: market?.candlesTimeframe || null
    };
  }
  // 交易所最后一根通常仍在形成，只允许闭合 K 线触发技能，避免盘中信号回撤。
  const closedCandles = candles.length > 1 ? candles.slice(0, -1) : [];
  if (closedCandles.length < 40) {
    return { triggered: false, reason: "insufficient_closed_candles", candles: closedCandles.length };
  }
  const strategy = STRATEGIES[skill.spec.templateId];
  if (!strategy) return { triggered: false, reason: "template_missing" };
  const invalidation = runtimeInvalidationTriggered(db, skill, String(symbol || "").toUpperCase());
  if (invalidation?.triggered) return { triggered: false, reason: invalidation.reason, eventId: invalidation.eventId || null };
  const signals = applyCompiledSignalConstraints(
    closedCandles,
    strategy.signals(closedCandles, skill.spec.params || {}),
    skill.spec
  );
  const signalIndex = signals.length - 1;
  const bar = closedCandles[signalIndex];
  return {
    triggered: Boolean(signals[signalIndex]),
    reason: signals[signalIndex] ? "compiled_rule_triggered_on_closed_bar" : "compiled_rule_not_triggered",
    signalIndex,
    signalBarTime: bar?.time || bar?.openTime || null,
    evaluatedAt: nowIso()
  };
}

export function bindKnowledgeSkillsToPlan(db, plan, context = {}, actor = "Agent") {
  const eligible = selectActiveKnowledgeSkills(db, {
    symbol: plan.symbol,
    direction: plan.direction,
    timeframe: context.timeframe,
    regime: context.regime
  });
  const evaluated = eligible.map((skill) => ({ skill, signal: evaluateKnowledgeSkillSignal(db, skill, plan.symbol) }));
  const explicitlySelected = new Set((context.selectedSkillIds || []).map(String));
  const selected = evaluated.filter((item) =>
    item.signal.triggered
    && (!context.requireExplicitAdoption || explicitlySelected.has(item.skill.id))
  );
  plan.knowledgeSkills = selected.map((skill) => ({
    skillId: skill.skill.id,
    version: skill.skill.version,
    fingerprint: skill.skill.fingerprint,
    name: skill.skill.name,
    templateId: skill.skill.spec.templateId,
    matchScore: skill.skill.matchScore,
    sourceId: skill.skill.sourceId,
    citations: skill.skill.citationRefs,
    signalBarTime: skill.signal.signalBarTime,
    signalEvaluatedAt: skill.signal.evaluatedAt
  }));
  plan.knowledgeSkillIds = plan.knowledgeSkills.map((item) => item.skillId);
  plan.knowledgeSkillEvaluation = evaluated.map((item) => ({
    skillId: item.skill.id,
    version: item.skill.version,
    triggered: item.signal.triggered,
    reason: item.signal.reason,
    signalBarTime: item.signal.signalBarTime || null,
    explicitlyAdopted: explicitlySelected.has(item.skill.id)
  }));
  for (const item of selected) {
    const skill = item.skill;
    const invocation = {
      id: id("kinvoke"),
      skillId: skill.id,
      skillVersion: skill.version,
      skillFingerprint: skill.fingerprint,
      tradePlanId: plan.id,
      agentRunId: plan.agentRunId || null,
      symbol: plan.symbol,
      direction: plan.direction,
      regime: context.regime || null,
      status: "triggered_and_selected",
      signalBarTime: item.signal.signalBarTime,
      actor,
      createdAt: nowIso()
    };
    db.knowledge.skillInvocations.unshift(invocation);
  }
  if (db.knowledge.skillInvocations.length > MAX_INVOCATIONS) db.knowledge.skillInvocations = db.knowledge.skillInvocations.slice(0, MAX_INVOCATIONS);
  return plan.knowledgeSkills;
}

export function validatePlanKnowledgeSkills(db, plan) {
  ensureCollections(db);
  const references = plan.knowledgeSkills || [];
  const violations = [];
  for (const ref of references) {
    const skill = db.knowledge.tradingSkills.find((item) => item.id === ref.skillId);
    if (!skill) violations.push(`知识技能 ${ref.skillId} 不存在`);
    else if (skill.status !== "active") violations.push(`知识技能「${skill.name}」当前状态为 ${skill.status}`);
    else if (skill.version !== ref.version || skill.fingerprint !== ref.fingerprint) violations.push(`知识技能「${skill.name}」版本或指纹已变化`);
    else {
      const currentSignal = evaluateKnowledgeSkillSignal(db, skill, plan.symbol);
      const maxSignalAgeMs = Number(process.env.KNOWLEDGE_SIGNAL_MAX_AGE_MS || 2 * 60 * 60_000);
      const signalAgeMs = Date.now() - new Date(ref.signalEvaluatedAt || 0).getTime();
      if (!currentSignal.triggered) violations.push(`知识技能「${skill.name}」当前信号已失效：${currentSignal.reason}`);
      if (!Number.isFinite(signalAgeMs) || signalAgeMs > maxSignalAgeMs) violations.push(`知识技能「${skill.name}」绑定信号已过期`);
      const entryLow = Number(plan.entry_range?.[0] ?? plan.entry?.low);
      const entryHigh = Number(plan.entry_range?.[1] ?? plan.entry?.high ?? entryLow);
      const entry = (entryLow + entryHigh) / 2;
      const stop = Number(plan.stopLoss ?? plan.stop_loss);
      const firstTarget = Number((plan.takeProfit || plan.take_profit || [])[0]);
      if (Number.isFinite(entry) && entry > 0 && Number.isFinite(stop) && !skill.spec.params?.atrStop) {
        const actualStopPct = (Math.abs(entry - stop) / entry) * 100;
        const expectedStopPct = Number(skill.spec.params?.stopLossPct);
        const tolerance = Math.max(0.15, expectedStopPct * 0.35);
        if (Number.isFinite(expectedStopPct) && Math.abs(actualStopPct - expectedStopPct) > tolerance) {
          violations.push(`知识技能「${skill.name}」要求约 ${expectedStopPct}% 止损，计划为 ${actualStopPct.toFixed(2)}%`);
        }
      }
      if (Number.isFinite(entry) && Number.isFinite(stop) && Number.isFinite(firstTarget) && Math.abs(entry - stop) > 0) {
        const actualR = Math.abs(firstTarget - entry) / Math.abs(entry - stop);
        const expectedR = Number(skill.spec.params?.takeProfitR);
        const toleranceR = Math.max(0.25, expectedR * 0.35);
        if (Number.isFinite(expectedR) && Math.abs(actualR - expectedR) > toleranceR) {
          violations.push(`知识技能「${skill.name}」要求约 ${expectedR}R 止盈，计划首目标为 ${actualR.toFixed(2)}R`);
        }
      }
    }
  }
  return { valid: violations.length === 0, violations };
}

function closeFillKey(fill) {
  return fill.executionOrderId || fill.tradePlanId || fill.planId || fill.id;
}

export function refreshKnowledgeSkillAttribution(db, actor = "KnowledgeAttribution") {
  ensureCollections(db);
  const existing = new Set(db.knowledge.skillAttributions.map((item) => item.fillKey));
  let added = 0;
  const completedTrades = new Map();
  for (const fill of db.fills || []) {
    if (fill.kind !== "close" || !Number.isFinite(Number(fill.realizedPnl))) continue;
    const key = closeFillKey(fill);
    if (!key) continue;
    const aggregate = completedTrades.get(key) || { ...fill, id: null, fillIds: [], realizedPnl: 0 };
    aggregate.fillIds.push(fill.id);
    aggregate.realizedPnl += Number(fill.realizedPnl);
    if (new Date(fill.createdAt || 0) > new Date(aggregate.createdAt || 0)) aggregate.createdAt = fill.createdAt;
    completedTrades.set(key, aggregate);
  }
  for (const [fillKey, fill] of completedTrades) {
    if (existing.has(fillKey)) continue;
    const plan = (db.tradePlans || []).find((item) => item.id === (fill.tradePlanId || fill.planId));
    if (!plan?.knowledgeSkills?.length) continue;
    const weight = 1 / plan.knowledgeSkills.length;
    for (const ref of plan.knowledgeSkills) {
      db.knowledge.skillAttributions.unshift({
        id: id("kattr"),
        fillKey,
        fillId: fill.fillIds.length === 1 ? fill.fillIds[0] : null,
        fillIds: fill.fillIds,
        tradePlanId: plan.id,
        skillId: ref.skillId,
        skillVersion: ref.version,
        realizedPnl: Number(fill.realizedPnl),
        weightedPnl: Number((Number(fill.realizedPnl) * weight).toFixed(8)),
        weight,
        attributionMethod: plan.knowledgeSkills.length === 1 ? "sole_adopted_skill" : "equal_weight_declared_adoption",
        createdAt: fill.createdAt || nowIso()
      });
    }
    existing.add(fillKey);
    added += 1;
  }

  const degraded = [];
  for (const skill of db.knowledge.tradingSkills) {
    const rows = db.knowledge.skillAttributions.filter((row) => row.skillId === skill.id && row.skillVersion === skill.version);
    if (!rows.length) continue;
    const wins = rows.filter((row) => row.realizedPnl > 0);
    const grossWin = rows.filter((row) => row.realizedPnl > 0).reduce((sum, row) => sum + row.weightedPnl, 0);
    const grossLoss = Math.abs(rows.filter((row) => row.realizedPnl < 0).reduce((sum, row) => sum + row.weightedPnl, 0));
    const recent = rows.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    let consecutiveLosses = 0;
    for (const row of recent) {
      if (row.realizedPnl < 0) consecutiveLosses += 1;
      else break;
    }
    skill.liveMetrics = {
      trades: rows.length,
      wins: wins.length,
      winRatePct: Number(((wins.length / rows.length) * 100).toFixed(1)),
      weightedPnl: Number(rows.reduce((sum, row) => sum + row.weightedPnl, 0).toFixed(8)),
      profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
      consecutiveLosses,
      updatedAt: nowIso()
    };
    const poor = rows.length >= MIN_LIVE_ATTRIBUTION_TRADES && (
      (skill.liveMetrics.profitFactor !== null && skill.liveMetrics.profitFactor < 0.8)
      || skill.liveMetrics.consecutiveLosses >= 5
    );
    if (skill.status === "active" && poor) {
      transition(skill, "degraded", "live_performance_guard", actor);
      degraded.push(skill.id);
      appendAudit(db, `知识技能自动降级「${skill.name}」：实盘表现触发保护阈值`, skill.id, actor, "warning");
    }
  }
  return { added, degraded };
}

export function knowledgeSkillSummary(db) {
  ensureCollections(db);
  syncKnowledgeSkillLifecycle(db);
  const counts = {};
  for (const skill of db.knowledge.tradingSkills) counts[skill.status] = (counts[skill.status] || 0) + 1;
  return {
    counts,
    active: counts.active || 0,
    total: db.knowledge.tradingSkills.length,
    skills: db.knowledge.tradingSkills,
    recentInvocations: db.knowledge.skillInvocations.slice(0, 50),
    recentAttributions: db.knowledge.skillAttributions.slice(0, 100)
  };
}
