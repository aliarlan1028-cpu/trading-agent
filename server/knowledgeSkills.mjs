import crypto from "node:crypto";
import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { purgedChronologicalWindows } from "./validationStatistics.mjs";
import { BAR_MINUTES, simulate } from "./backtestEngine.mjs";
import { createPaperSession } from "./paperTrading.mjs";
import { detectRegime, getStrategy, STRATEGIES } from "./strategies.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { applyCompiledSignalConstraints, runtimeInvalidationTriggered } from "./compiledSignals.mjs";
import { isFinanciallyReconciledLifecycle } from "./tradeReviewQueue.mjs";
import { groupSystemClosedTradeLifecycles } from "./systemTradeProjection.mjs";
import { principalUserId } from "./principalScope.mjs";
import { canUseKnowledgeRow, normalizeKnowledgePrincipal } from "./knowledgeScope.mjs";

const TIMEFRAMES = new Set(["5m", "15m", "1h", "4h", "1d"]);
// active=已用真实成绩转正;live_probation=小额实盘试用中(可影响真实下单,但对 LLM 如实标"未验证")。
// 两者都可被选用/绑定,区别只在提示词里的信任标签与转正/退役逻辑。
const EXECUTABLE_STATES = new Set(["active", "live_probation"]);
// 小额试用转正门槛(真实成绩说话):≥N 笔归因交易、盈亏因子达标、近期无连亏。
const PROBATION_GRADUATE_TRADES = Math.max(6, Number(process.env.SKILL_PROBATION_GRADUATE_TRADES || 10));
const PROBATION_GRADUATE_PF = Number(process.env.SKILL_PROBATION_GRADUATE_PF || 1.2);
const TERMINAL_STATES = new Set(["retired", "superseded"]);
const MAX_INVOCATIONS = 1000;
const MIN_LIVE_ATTRIBUTION_TRADES = Math.max(5, Number(process.env.KNOWLEDGE_SKILL_MIN_LIVE_TRADES || 10));
// 每轮 paper_forward 最多新起几个纯前向模拟盘,避免一次性对行情接口开几十路拉取。
const PAPER_START_PER_CYCLE = Math.max(1, Number(process.env.SKILL_PAPER_START_PER_CYCLE || 6));

const TEMPLATE_RULES = [
  // 背离类统一按技能方向选模板：long→底背离模板，short→顶背离模板（文字只用于识别"这是背离方法"）。
  { pattern: /底背离|顶背离|bull(?:ish)? divergence|bear(?:ish)? divergence/i, long: "rsi_bull_div", short: "rsi_bear_div" },
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
  const raw = String(value || "1h").trim();
  const tf = raw.replace("H", "h").replace("D", "d");
  if (TIMEFRAMES.has(tf)) return tf;
  // 就近映射：书里常写"日线/周线/月线/4小时/1小时/短线"等——映射到最接近的受支持周期，
  // 而不是整条编译失败（周线/月线不适合杠杆短周期，统一收敛到 1d 上限）。
  const t = raw.toLowerCase();
  if (/(周线|周期|1w|week|月线|month|日线|1d|daily|swing|波段)/.test(t)) return "1d";
  if (/(4\s*小时|4h|four)/.test(t)) return "4h";
  if (/(1\s*小时|60m|hourly|1h)/.test(t)) return "1h";
  if (/(15\s*分|15m|quarter)/.test(t)) return "15m";
  if (/(5\s*分|5m|scalp|超短)/.test(t)) return "5m";
  if (/(日内|intraday|短线)/.test(t)) return "1h";
  return "1h"; // 兜底给 1h（原来是 null 直接 fail），验证/模拟会实测其是否有边际
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

// 周期噪声下限:价格止损低于该周期的典型噪声幅度时,任何策略都会被反复扫损
// (用户实锤:1d 技能带 1% 价格止损,验证窗 PF 1.66 的策略被测试窗噪声打死)。
const STOP_FLOOR_PCT = { "5m": 0.4, "15m": 0.6, "1h": 1, "4h": 1.8, "1d": 3 };

function inferExitParams(method = {}, timeframe = "1h") {
  const stopText = String(method.stop || "");
  const targetText = String(method.takeProfit || "");
  // 语义甄别:书里"风险/本金/资金/账户 X%"是仓位管理(每笔风险占本金),不是价格止损距离。
  // 旧实现抓取任意百分数当价格距离 → "风险1%"被编成"止损距入场1%",日线上必被噪声扫损。
  const riskContext = /(?:本金|资金|账户|总资|仓位|风险)[^%。;；]{0,12}\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*%[^。;；]{0,8}(?:本金|资金|风险)/.test(stopText);
  const stopPct = riskContext ? NaN : Number(stopText.match(/(\d+(?:\.\d+)?)\s*%/)?.[1]);
  const atrMult = Number(stopText.match(/(\d+(?:\.\d+)?)\s*(?:倍\s*)?ATR/i)?.[1]);
  const rewardRisk = Number(targetText.match(/(\d+(?:\.\d+)?)\s*R\b/i)?.[1]);
  const floor = STOP_FLOOR_PCT[timeframe] ?? 1;
  const params = { takeProfitR: Number.isFinite(rewardRisk) ? Math.max(0.5, Math.min(rewardRisk, 8)) : 2 };
  if (Number.isFinite(atrMult)) {
    params.atrStop = true;
    params.atrMult = Math.max(0.5, Math.min(atrMult, 6));
    params.atrPeriod = 14;
    params.stopLossPct = Number.isFinite(stopPct) ? Math.max(0.1, Math.min(stopPct, 10)) : 2;
  } else if (Number.isFinite(stopPct) && stopPct >= floor) {
    // 明确的价格止损且不低于该周期噪声下限 → 尊重原文
    params.stopLossPct = Math.min(stopPct, 10);
  } else {
    // 无明确价格止损 / 是资金风险语义 / 低于周期噪声下限 → 用 ATR 自适应止损(专业默认)
    params.atrStop = true;
    params.atrMult = 2;
    params.atrPeriod = 14;
    params.stopLossPct = Math.max(floor, 2); // 兜底名义值(ATR 生效时仅作 fallback)
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

  // 方案 A（2026-07-26 主人拍板）：按书名生成的综述不再"一刀切禁止编译"，改为可编译但标"低信任"，
  // 安全由后续【历史验证 + 纯前向模拟盘 + 人工批准】三道流程保证——而非在编译阶段直接毙掉。
  const lowTrust = source.type === "book_title" || source.synthetic === true;
  // 硬错误（真的无法构造可执行 setup）才算 error，其余降级为 warning 让技能仍能进验证流水线。
  if (!String(method.entry || "").trim()) errors.push("缺少明确入场条件");
  if (!String(method.stop || "").trim()) errors.push("缺少明确止损条件");
  if (!String(method.takeProfit || "").trim()) errors.push("缺少明确止盈或离场条件");
  if (!["long", "short"].includes(direction)) errors.push("方向必须明确为 long 或 short；both 需要拆分为两个技能");
  if (!timeframe) errors.push("周期不受支持，仅允许 5m/15m/1h/4h/1d");
  if (!templateId) errors.push("自然语言方法无法安全映射到受支持的白名单策略模板");
  // 确认/失效条件编译不了不再整条失败：降级为"该子约束不生效"的警告，技能以"仅方向+入场模板+RR"可执行子集进验证。
  if (confirmation.error) warnings.push(`确认条件未能编译（${confirmation.error}），该子约束在运行时不生效，仅以入场模板+RR 执行`);
  if (invalidation.error) warnings.push(`失效条件未能编译（${invalidation.error}），运行时不做该失效判定`);
  if (lowTrust) warnings.push("来源为按书名生成的模型综述（低信任）：可进验证流水线，但历史验证/模拟盘门槛更严，且必须人工批准才实盘");

  const strategy = templateId ? getStrategy(templateId) : null;
  const params = strategy
    ? { ...strategy.defaultParams, ...inferEntryParams(method, templateId), ...inferExitParams(method, timeframe), ...(overrides.params || {}) }
    : {};
  if (!/(\d|ATR|均线|RSI|MACD|布林|突破|跌破|成交量|背离)/i.test(String(method.entry || ""))) {
    warnings.push("入场描述缺少明显可计算指标，模板仅代表保守近似，审批前必须人工核对");
  }

  const spec = {
    schemaVersion: 1,
    compilerRev: 2,   // 止损语义修复版:资金风险%≠价格距离,周期噪声下限,ATR 默认
    templateId,
    templateLabel: strategy?.label || null,
    lowTrust,                 // 按书名综述 → 验证门槛更严
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
    tenantId: method.tenantId || source.tenantId || db.user?.tenantId || null,
    ownerUserId: method.ownerUserId || source.ownerUserId || db.user?.id || null,
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
  skill.executable = EXECUTABLE_STATES.has(next);
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
  const windows = purgedChronologicalWindows(n, { purgeBars: 1, embargoBars: 1 });
  const train = evaluateWindow(candles, signals, windows.train[0], windows.train[1], skill);
  const validation = evaluateWindow(candles, signals, windows.validation[0], windows.validation[1], skill);
  const test = evaluateWindow(candles, signals, windows.test[0], windows.test[1], skill);
  const oosTrades = Number(validation.trades || 0) + Number(test.trades || 0);
  // 低信任（按书名综述）技能门槛更严：样本更多、盈亏比更高——用更严的样本外证据补偿来源不是原始证据。
  const lt = skill.spec.lowTrust === true;
  const minPF = lt ? 1.15 : 1.05;
  const minOos = lt ? 12 : 8;
  const passed = train.trades >= 5
    && validation.trades >= 3
    && test.trades >= 3
    && oosTrades >= minOos
    && validation.expectancyR > 0
    && test.expectancyR > 0
    && (validation.profitFactor == null || validation.profitFactor >= minPF)
    && (test.profitFactor == null || test.profitFactor >= minPF)
    && (validation.maxDrawdownPct ?? 100) <= 20
    && (test.maxDrawdownPct ?? 100) <= 20;
  skill.validation = {
    status: passed ? "passed" : "failed",
    methodology: "40/30/30 purged chronological holdout",
    purgeBars: windows.purgeBars,
    embargoBars: windows.embargoBars,
    candles: n,
    regime: detectRegime(candles.slice(windows.test[0])),
    train,
    validation,
    test,
    criteria: {
      minTrainTrades: 5,
      minValidationTrades: 3,
      minTestTrades: 3,
      minOosTrades: minOos,           // 落库真实门槛(此前硬编码 8/1.05,lowTrust 实际用 12/1.15,审计口径不符)
      positiveValidationAndTest: true,
      minProfitFactor: minPF,
      lowTrust: lt,
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

// 批量历史验证:把所有 compiled/historical_rejected 技能顺序推过 40/30/30 三窗回测。
// 后台执行(51 个技能×K线拉取需数分钟,HTTP 即时返回);单飞标志防重复触发;
// 每个技能间 400ms 缓冲避免打爆 OKX 公共接口;完成后审计汇总。
let batchValidationRunning = false;
export function validateAllCompiledSkills(db, saveDb, actor = "BatchValidator", options = {}) {
  if (batchValidationRunning) return { started: false, reason: "already_running" };
  const targets = (db.knowledge?.tradingSkills || [])
    .filter((s) => (!options.predicate || options.predicate(s)) && ["compiled", "historical_rejected"].includes(s.status))
    .map((s) => s.id);
  if (!targets.length) return { started: false, reason: "no_targets", total: 0 };
  batchValidationRunning = true;
  (async () => {
    let passed = 0, rejected = 0, errored = 0;
    for (const skillId of targets) {
      try {
        const r = await validateKnowledgeSkill(db, skillId, {}, actor);
        if (r?.passed) passed += 1; else rejected += 1;
      } catch { errored += 1; }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    appendAudit(db, `批量历史验证完成:通过 ${passed} · 未达门槛 ${rejected} · 数据不足/出错 ${errored}(共 ${targets.length})`, "skills_batch_validate", actor);
    if (saveDb) saveDb(db);
    batchValidationRunning = false;
  })();
  return { started: true, total: targets.length };
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
    ,tenantId: skill.tenantId || null
    ,ownerUserId: skill.ownerUserId || null
  });
  if (result.status !== "ok") return result;
  skill.paperSessionId = result.session.id;
  transition(skill, "paper_validating", "forward_paper_started", actor);
  appendAudit(db, `知识技能进入纯前向模拟盘「${skill.name}」`, skill.id, actor);
  return { status: "ok", skill, session: result.session };
}

// 模拟前向为主的流水线驱动:把 compiled 技能推过历史 OOS 预筛,再把 historical_validated
// 的技能逐个起"纯前向模拟盘"。runPaperForward + syncKnowledgeSkillLifecycle(已在 paper_forward
// 定时任务里)负责把跑够前向笔数的会话判 passed/failed → paper_validated/paper_rejected。
// 这条链路本就完整,之前被 skillLiveValidationMode 一把全扫进 live_probation 短路了,本函数把它接活。
export async function advanceSkillsThroughPaperLane(db, saveDb, actor = "PaperForwardDriver") {
  ensureCollections(db);
  // 1) compiled/historical_rejected → 历史 40/30/30 OOS 验证(后台批量,内部 400ms 节流,单飞防重)
  const batch = validateAllCompiledSkills(db, saveDb, actor);
  // 2) historical_validated 且未开模拟盘 → 起纯前向模拟盘(每轮限量,避免打爆行情接口)
  const ready = db.knowledge.tradingSkills.filter(
    (s) => s.status === "historical_validated" && !s.paperSessionId && s.spec && STRATEGIES[s.spec.templateId]
  );
  let paperStarted = 0;
  for (const skill of ready.slice(0, PAPER_START_PER_CYCLE)) {
    try {
      const r = await startKnowledgeSkillPaper(db, skill.id, {}, actor);
      if (r.status === "ok") paperStarted += 1;
    } catch { /* 数据不足/交易对超范围等,下轮再试 */ }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return { historicalBatch: batch, paperStarted, paperQueue: ready.length };
}

// 一次性迁移:把因旧"小额实盘验证"模式死锁在 live_probation、且没有任何真实(非模拟)成交归因的
// 技能退回 compiled,让它们重新进入"模拟前向"验证车道。有真实成绩的技能保持不动(不抹掉战绩)。
export function resetProbationSkillsToPaperLane(db, actor = "PaperForwardMigration") {
  ensureCollections(db);
  const realAttr = new Set(
    (db.knowledge.skillAttributions || []).filter((a) => a.mode !== "paper").map((a) => a.skillId)
  );
  let reset = 0;
  for (const skill of db.knowledge.tradingSkills) {
    if (skill.status === "live_probation" && !realAttr.has(skill.id)) {
      skill.paperSessionId = null;
      skill.probationStartedAt = null;
      transition(skill, "compiled", "reset_to_paper_forward_lane", actor);
      reset += 1;
    }
  }
  if (reset) appendAudit(db, `模拟前向迁移:${reset} 个死锁在小额试用的技能退回编译态,重新进入模拟前向验证车道`, "skills_paper_migration", actor, "warning");
  return { reset };
}

export function syncKnowledgeSkillLifecycle(db, actor = "KnowledgeLifecycle", options = {}) {
  ensureCollections(db);
  const changes = [];
  for (const skill of db.knowledge.tradingSkills) {
    if (options.predicate && !options.predicate(skill)) continue;
    if (skill.status !== "paper_validating" || !skill.paperSessionId) continue;
    const session = db.paperSessions.find((item) => item.id === skill.paperSessionId);
    if (!session || !["passed", "failed"].includes(session.status)) continue;
    const sessionMatches = session.seeded === false
      && session.knowledgeSkillId === skill.id
      && Number(session.knowledgeSkillVersion) === Number(skill.version)
      && session.tenantId === skill.tenantId
      && session.ownerUserId === skill.ownerUserId
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
  const attribution = refreshKnowledgeSkillAttribution(db, actor, options);
  return { changes, attribution };
}

export function approveKnowledgeSkill(db, skillId, approvedBy, note = "") {
  ensureCollections(db);
  const skill = db.knowledge.tradingSkills.find((item) => item.id === skillId);
  if (!skill) throw new Error("知识技能不存在");
  syncKnowledgeSkillLifecycle(db);
  if (skill.status !== "paper_validated") throw new Error("技能必须先通过纯前向模拟盘验证");
  skill.approval = { approved: true, approvedBy, note: String(note || "").slice(0, 500), approvedAt: nowIso(), fingerprint: skill.fingerprint };
  // 唯一生产口径：历史 OOS → 纯前向 → 人工批准 → 小额实盘试用 → 真实成绩转正。
  // 批准不是“已验证盈利”，因此先进入受限 probation，不能直接标 active。
  transition(skill, "live_probation", "human_approved_for_live_probation", approvedBy);
  skill.probationStartedAt = nowIso();
  appendAudit(db, `批准知识技能进入小额实盘试用「${skill.name}」v${skill.version}`, skill.id, approvedBy, "warning");
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
  const principal = normalizeKnowledgePrincipal(options.principal || {});
  if (!principal.tenantId || !principal.userId) return [];
  const mayUse = (skill) => canUseKnowledgeRow(skill, principal);
  syncKnowledgeSkillLifecycle(db, "KnowledgeLifecycle", { predicate: mayUse });
  const limit = Math.max(1, Math.min(5, Number(options.limit || 3)));
  const symbol = String(context.symbol || "").toUpperCase();
  const direction = String(context.direction || "");
  const timeframe = normalizeTimeframe(context.timeframe) || null;
  const regime = String(context.regime || "");
  return db.knowledge.tradingSkills
    .filter(mayUse)
    // active 与 live_probation 都必须具备匹配当前版本的人工批准指纹。
    .filter((skill) => EXECUTABLE_STATES.has(skill.status) && skill.approval?.fingerprint === skill.fingerprint)
    .filter((skill) => scopeMatches(skill.spec.symbolScope, symbol))
    // 通配符范围也只能用于历史验证实际覆盖过的交易对。
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
  // 优先按技能声明的周期取多周期缓存（candlesByTf），退回单值 candles（周期匹配时）。
  const wanted = skill.spec.timeframe;
  const cached = market?.candlesByTf?.[wanted];
  let candles = Array.isArray(cached?.candles) ? cached.candles : [];
  if (!candles.length && normalizeTimeframe(market?.candlesTimeframe) === wanted && Array.isArray(market?.candles)) {
    candles = market.candles;
  }
  if (!candles.length) {
    return {
      triggered: false,
      reason: "candle_timeframe_mismatch",
      expectedTimeframe: wanted,
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
  const principal = {
    tenantId: plan.tenantId || plan.ownerTenantId || "",
    userId: plan.ownerUserId || plan.createdByUserId || plan.userId || "",
    isOwner: context.principal?.isOwner === true
  };
  const eligible = selectActiveKnowledgeSkills(db, {
    symbol: plan.symbol,
    direction: plan.direction,
    timeframe: context.timeframe,
    regime: context.regime
  }, { principal });
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
      tenantId: principal.tenantId,
      ownerUserId: principal.userId,
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
  const principal = {
    tenantId: plan.tenantId || plan.ownerTenantId || "",
    userId: plan.ownerUserId || plan.createdByUserId || plan.userId || ""
  };
  const references = plan.knowledgeSkills || [];
  const violations = [];
  for (const ref of references) {
    const skill = db.knowledge.tradingSkills.find((item) => item.id === ref.skillId);
    if (!skill) violations.push(`知识技能 ${ref.skillId} 不存在`);
    else if (!canUseKnowledgeRow(skill, principal)) violations.push(`知识技能「${skill.name}」不属于当前交易主体`);
    else if (!EXECUTABLE_STATES.has(skill.status)) violations.push(`知识技能「${skill.name}」当前状态为 ${skill.status}`);
    else if (skill.approval?.fingerprint !== skill.fingerprint) violations.push(`知识技能「${skill.name}」缺少当前版本人工批准`);
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

export function refreshKnowledgeSkillAttribution(db, actor = "KnowledgeAttribution", options = {}) {
  ensureCollections(db);
  let added = 0;
  let migrated = 0;
  const hasFiniteFinancialValue = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const authoritativeKeys = new Set();
  const existingByKey = new Map((db.knowledge.skillAttributions || []).map((row) => [
    `${row.fillKey}|${row.skillId}|${row.skillVersion}`,
    row
  ]));
  for (const lifecycle of groupSystemClosedTradeLifecycles(db)) {
    if (!isFinanciallyReconciledLifecycle(lifecycle)) continue;
    const fill = lifecycle.representative;
    const executionOrder = (db.executionOrders || []).find((item) => item.id === fill.executionOrderId);
    const planId = fill.tradePlanId || fill.planId || executionOrder?.planId;
    const plan = (db.tradePlans || []).find((item) => item.id === planId);
    if (!plan?.knowledgeSkills?.length) continue;
    const weight = 1 / plan.knowledgeSkills.length;
    for (const ref of plan.knowledgeSkills) {
      const attributedSkill = db.knowledge.tradingSkills.find((skill) => skill.id === ref.skillId && Number(skill.version) === Number(ref.version));
      if (options.predicate && (!attributedSkill || !options.predicate(attributedSkill))) continue;
      const attributionKey = `${lifecycle.key}|${ref.skillId}|${ref.version}`;
      authoritativeKeys.add(attributionKey);
      const payload = {
        tenantId: plan.tenantId || fill.tenantId || null,
        ownerUserId: principalUserId(plan) || principalUserId(fill),
        fillKey: lifecycle.key,
        fillId: lifecycle.fills.length === 1 ? lifecycle.fills[0].id : null,
        fillIds: lifecycle.fills.map((row) => row.id).filter(Boolean),
        tradePlanId: plan.id,
        skillId: ref.skillId,
        skillVersion: ref.version,
        grossRealizedPnl: Number(lifecycle.realizedPnl),
        closeFeeUsdt: Number(lifecycle.feeUsdt),
        entryFeeUsdt: Number(lifecycle.entryFeeUsdt),
        fundingFeeUsdt: Number(lifecycle.fundingFeeUsdt),
        netRealizedPnl: Number(lifecycle.netRealizedPnl),
        // 旧客户端若仍读取 realizedPnl，也只能得到权威净值；交易所价格毛值明确放在 grossRealizedPnl。
        realizedPnl: Number(lifecycle.netRealizedPnl),
        grossWeightedPnl: Number((Number(lifecycle.realizedPnl) * weight).toFixed(8)),
        weightedPnl: Number((Number(lifecycle.netRealizedPnl) * weight).toFixed(8)),
        weight,
        attributionMethod: plan.knowledgeSkills.length === 1 ? "sole_adopted_skill" : "equal_weight_declared_adoption",
        financialSchemaVersion: 2,
        financialBasis: "completed_trade_lifecycle/net_after_recorded_entry_close_fees_and_funding",
        createdAt: lifecycle.lastClosedAt || nowIso()
      };
      const existing = existingByKey.get(attributionKey);
      if (existing) {
        const before = JSON.stringify(existing);
        Object.assign(existing, payload);
        if (before !== JSON.stringify(existing)) migrated += 1;
      } else {
        const created = { id: id("kattr"), ...payload };
        db.knowledge.skillAttributions.unshift(created);
        existingByKey.set(attributionKey, created);
        added += 1;
      }
    }
  }
  // 任何 live 归因只要已失去本轮底层成交/计划的权威绑定，就不能继续参与自动晋级/退役。
  // 即使它曾经迁到 v2，也可能在底层数据清理后变成“幽灵证据”；保留毛值供审计，净值诚实置空。
  for (const row of db.knowledge.skillAttributions) {
    if (row.mode === "paper") continue;
    const attributedSkill = db.knowledge.tradingSkills.find((skill) => skill.id === row.skillId && Number(skill.version) === Number(row.skillVersion));
    if (options.predicate && (!attributedSkill || !options.predicate(attributedSkill))) continue;
    const attributionKey = `${row.fillKey}|${row.skillId}|${row.skillVersion}`;
    if (authoritativeKeys.has(attributionKey)) continue;
    const before = JSON.stringify(row);
    const grossCandidate = row.grossRealizedPnl ?? row.realizedPnl;
    const preservedGross = hasFiniteFinancialValue(grossCandidate) ? Number(grossCandidate) : null;
    Object.assign(row, {
      grossRealizedPnl: preservedGross,
      netRealizedPnl: null,
      realizedPnl: null,
      weightedPnl: null,
      financialSchemaVersion: 2,
      financialBasis: "unreconciled_orphan_gross_excluded_from_live_metrics"
    });
    if (before !== JSON.stringify(row)) migrated += 1;
  }

  const degraded = [];
  const graduated = [];
  for (const skill of db.knowledge.tradingSkills) {
    if (options.predicate && !options.predicate(skill)) continue;
    const allLiveRows = db.knowledge.skillAttributions.filter((row) => row.mode !== "paper"
      && row.skillId === skill.id && row.skillVersion === skill.version);
    const rows = db.knowledge.skillAttributions.filter((row) => row.skillId === skill.id
      && row.skillVersion === skill.version && row.mode !== "paper"
      && hasFiniteFinancialValue(row.netRealizedPnl) && hasFiniteFinancialValue(row.weightedPnl));
    if (!rows.length) {
      if (allLiveRows.length) {
        const resetMetrics = {
          trades: 0,
          wins: 0,
          winRatePct: null,
          weightedPnl: null,
          profitFactor: null,
          consecutiveLosses: 0,
          basis: "unreconciled_orphan_evidence/needs_revalidation"
        };
        const alreadyReset = Object.entries(resetMetrics).every(([key, value]) => skill.liveMetrics?.[key] === value);
        if (!alreadyReset) skill.liveMetrics = { ...resetMetrics, updatedAt: nowIso() };
        skill.needsRevalidation = true;
        if (["active", "live_probation"].includes(skill.status)) {
          transition(skill, "degraded", "authoritative_live_attribution_missing_needs_revalidation", actor);
          degraded.push(skill.id);
        }
      }
      continue;
    }
    skill.needsRevalidation = false;
    const wins = rows.filter((row) => row.netRealizedPnl > 0);
    const grossWin = rows.filter((row) => row.netRealizedPnl > 0).reduce((sum, row) => sum + row.weightedPnl, 0);
    const grossLoss = Math.abs(rows.filter((row) => row.netRealizedPnl < 0).reduce((sum, row) => sum + row.weightedPnl, 0));
    const recent = rows.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    let consecutiveLosses = 0;
    for (const row of recent) {
      if (row.netRealizedPnl < 0) consecutiveLosses += 1;
      else break;
    }
    skill.liveMetrics = {
      trades: rows.length,
      wins: wins.length,
      winRatePct: Number(((wins.length / rows.length) * 100).toFixed(1)),
      weightedPnl: Number(rows.reduce((sum, row) => sum + row.weightedPnl, 0).toFixed(8)),
      profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
      consecutiveLosses,
      basis: "completed_trade_lifecycle/net_after_recorded_entry_close_fees_and_funding",
      updatedAt: nowIso()
    };
    const poor = rows.length >= MIN_LIVE_ATTRIBUTION_TRADES && (
      (skill.liveMetrics.profitFactor !== null && skill.liveMetrics.profitFactor < 0.8)
      || skill.liveMetrics.consecutiveLosses >= 5
    );
    // 已转正的 active:实盘劣化 → 降级(保护阈值,原逻辑)
    if (skill.status === "active" && poor) {
      transition(skill, "degraded", "live_performance_guard", actor);
      degraded.push(skill.id);
      appendAudit(db, `知识技能自动降级「${skill.name}」：实盘表现触发保护阈值`, skill.id, actor, "warning");
      continue;
    }
    // 小额试用中的技能:真实成绩说话——好则自动转正、差则自动退役(这就是主人要的"上岗→复盘→退役"循环)
    if (skill.status === "live_probation") {
      if (poor) {
        transition(skill, "degraded", "probation_live_underperformance", actor);
        degraded.push(skill.id);
        appendAudit(db, `小额试用技能自动退役「${skill.name}」：真实成绩不达标(PF ${skill.liveMetrics.profitFactor ?? "-"}/连亏 ${skill.liveMetrics.consecutiveLosses})`, skill.id, actor, "warning");
      } else if (rows.length >= PROBATION_GRADUATE_TRADES
        && skill.liveMetrics.weightedPnl > 0
        // PF 为 null = 期间无亏损单(全胜),配合正盈亏即达标;有亏损单则需 PF ≥ 门槛
        && (skill.liveMetrics.profitFactor === null || skill.liveMetrics.profitFactor >= PROBATION_GRADUATE_PF)
        && skill.liveMetrics.consecutiveLosses < 3) {
        skill.approval = { approved: true, approvedBy: actor, note: `小额实盘验证转正:${rows.length} 笔 PF ${skill.liveMetrics.profitFactor}`, approvedAt: nowIso(), fingerprint: skill.fingerprint };
        transition(skill, "active", "probation_graduated_by_live_performance", actor);
        graduated.push(skill.id);
        appendAudit(db, `小额试用技能转正「${skill.name}」：真实成绩达标(${rows.length} 笔 PF ${skill.liveMetrics.profitFactor})`, skill.id, actor, "info");
      }
    }
  }
  return { added, migrated, degraded, graduated };
}

// 旧版兼容入口：禁止编译结果绕过历史、前向和人工审批直接进入真实资金试用。
export function promoteCompiledToProbation(db, actor = "LiveValidation") {
  ensureCollections(db);
  // 兼容旧调用点，但不再提供绕过验证/审批的捷径。
  appendTrace(db, "knowledge_skill", "已拒绝旧版编译即实盘试用捷径；请完成历史、前向与人工审批", "blocked");
  return { promoted: 0, blocked: true, reason: "historical_paper_and_human_approval_required", actor };
}

export function knowledgeSkillSummary(db, options = {}) {
  if (options.sync !== false) {
    ensureCollections(db);
    syncKnowledgeSkillLifecycle(db);
  }
  const knowledge = db.knowledge || {};
  const skills = (knowledge.tradingSkills || []).filter((skill) => !options.predicate || options.predicate(skill));
  const skillIds = new Set(skills.map((skill) => skill.id));
  const counts = {};
  for (const skill of skills) counts[skill.status] = (counts[skill.status] || 0) + 1;
  return {
    counts,
    active: counts.active || 0,
    total: skills.length,
    skills,
    recentInvocations: (knowledge.skillInvocations || []).filter((row) => skillIds.has(row.skillId)).slice(0, 50),
    recentAttributions: (knowledge.skillAttributions || []).filter((row) => skillIds.has(row.skillId)).slice(0, 100)
  };
}

// ---------------------------------------------------------------------------
// 精选手写技能:知识库蒸馏的散文方法大多无法机械量化(48 条历史被拒是诚实结果——
// 21 条样本内就无优势、17 条信号太稀疏)。这里维护一小组参数明确、信号频率足够的
// 规范 spec(含做空),与书本方法走同一条 编译→历史验证→前向模拟→人工批准 流水线,
// 没有任何验证捷径;历史验证被拒就被拒,不重复重编译刷版本。
// ---------------------------------------------------------------------------
const CURATED_SOURCE = { id: "src_manual_curated", title: "手写规范策略(精选)", type: "manual_curated" };
const CURATED_METHODS = [
  {
    id: "cm_donchian_long", name: "唐奇安20突破做多(精选)", direction: "long", timeframe: "1h",
    templateId: "breakout", params: { lookback: 20, atrStop: true, atrMult: 2, atrPeriod: 14, takeProfitR: 2 },
    entry: "收盘价突破过去20根1小时K线最高价", confirmation: "突破K线收盘确认,不追盘中假突破",
    stop: "ATR 自适应止损(2×ATR14)", takeProfit: "2R", marketRegime: "趋势"
  },
  {
    id: "cm_donchian_short", name: "唐奇安20下破做空(精选)", direction: "short", timeframe: "1h",
    templateId: "breakdown", params: { lookback: 20, atrStop: true, atrMult: 2, atrPeriod: 14, takeProfitR: 2 },
    entry: "收盘价跌破过去20根1小时K线最低价", confirmation: "下破K线收盘确认",
    stop: "ATR 自适应止损(2×ATR14)", takeProfit: "2R", marketRegime: "下行趋势"
  },
  {
    id: "cm_squeeze_long", name: "布林挤压突破做多(精选)", direction: "long", timeframe: "15m",
    templateId: "squeeze", params: { period: 20, k: 2, squeeze: 0.04, atrStop: true, atrMult: 2, atrPeriod: 14, takeProfitR: 2 },
    entry: "布林带宽收窄至4%以下后收盘价上破上轨", confirmation: "挤压释放方向确认",
    stop: "ATR 自适应止损(2×ATR14)", takeProfit: "2R", marketRegime: "震荡转趋势"
  },
  {
    id: "cm_rsi_short", name: "RSI超买回落做空(精选)", direction: "short", timeframe: "1h",
    templateId: "rsi_short", params: { period: 14, overbought: 70, atrStop: true, atrMult: 2, atrPeriod: 14, takeProfitR: 2 },
    entry: "RSI14 高于70后回落跌破70时做空", confirmation: "回落K线收盘确认",
    stop: "ATR 自适应止损(2×ATR14)", takeProfit: "2R", marketRegime: "冲高回落"
  },
  {
    id: "cm_supertrend_long", name: "Supertrend趋势做多(精选)", direction: "long", timeframe: "4h",
    templateId: "supertrend", params: { period: 10, mult: 3, atrStop: true, atrMult: 2, atrPeriod: 14, takeProfitR: 2 },
    entry: "Supertrend(10,3) 由空翻多时顺势做多", confirmation: "翻转K线收盘确认",
    stop: "ATR 自适应止损(2×ATR14)", takeProfit: "2R", marketRegime: "趋势"
  }
];

// 只种一次:提高这个版本号会让精选集重新播种一次(用于将来新增精选技能)。
const CURATED_SEED_VERSION = 1;

export function ensureCuratedSkills(db, actor = "CuratedSkills") {
  ensureCollections(db);
  db.meta ||= {};
  // 关键修复:此前每次启动都"发现没技能就重建",导致用户清理/退役掉的精选技能一重启就复活、
  // 又要重新编译(用户实锤)。改为按版本只种一次——种过就永不再自动重建,尊重用户的清理。
  if (db.meta.curatedSeedVersion === CURATED_SEED_VERSION) return { created: 0, skipped: "already_seeded" };
  db.knowledge.sources ||= [];
  // 已存在精选来源 = 之前播过种(老库升级):直接标记已播种,不再重建任何被用户清理掉的精选技能。
  if (db.knowledge.sources.some((source) => source.id === CURATED_SOURCE.id)) {
    db.meta.curatedSeedVersion = CURATED_SEED_VERSION;
    return { created: 0, skipped: "already_seeded_legacy" };
  }

  if (!db.knowledge.sources.some((source) => source.id === CURATED_SOURCE.id)) {
    db.knowledge.sources.push({ ...CURATED_SOURCE, createdAt: nowIso() });
  }
  let created = 0;
  for (const method of CURATED_METHODS) {
    if (!db.knowledge.tradingMethods.some((item) => item.id === method.id)) {
      const { templateId, params, ...fields } = method;
      db.knowledge.tradingMethods.push({ ...fields, source: { id: CURATED_SOURCE.id, title: CURATED_SOURCE.title }, curated: true, createdAt: nowIso() });
    }
    if (db.knowledge.tradingSkills.some((skill) => skill.sourceMethodId === method.id)) continue;
    const skill = compileTradingMethod(db, method.id, { templateId: method.templateId, params: method.params }, actor);
    skill.curated = true;
    if (skill.status === "compiled") created += 1;
  }
  db.meta.curatedSeedVersion = CURATED_SEED_VERSION; // 标记已播种,之后永不自动重建
  if (created) appendAudit(db, `精选手写技能入列(首次播种):新编译 ${created} 个`, CURATED_SOURCE.id, actor);
  return { created };
}

// 海龟交易法(唐奇安通道突破)——用户 2026-07-31 指定加入。精选集当年种过后被清空且不再自动重建
// (curatedSeedVersion 已置位),故用独立开关【定向】补种海龟双向策略,不触碰其它已被用户清理的精选技能。
// 走与所有策略相同的 编译→历史验证→纯前向模拟→人工批准 流水线,无任何验证捷径。
export function ensureTurtleStrategy(db, actor = "TurtleSeed") {
  ensureCollections(db);
  db.meta ||= {};
  if (db.meta.turtleSeedV1) return { created: 0, skipped: "already_seeded" };
  db.knowledge.sources ||= [];
  if (!db.knowledge.sources.some((source) => source.id === CURATED_SOURCE.id)) {
    db.knowledge.sources.push({ ...CURATED_SOURCE, createdAt: nowIso() });
  }
  // 加密永续适配边界:经典海龟是日线股票/期货,这里用 1h;止损 2×ATR14;
  // 10 日反向通道离场与金字塔加仓受引擎单入场限制未实现,以 2R 止盈近似。必须过前向模拟才可实盘。
  const cryptoNote = "海龟法则加密永续适配:周期1h(经典为日线);止损2×ATR14;10日反向通道离场与金字塔加仓受引擎单入场限制未实现,以2R止盈近似;必须过纯前向模拟并人工批准才可实盘。";
  const turtle = CURATED_METHODS.filter((method) => method.id === "cm_donchian_long" || method.id === "cm_donchian_short");
  let created = 0;
  for (const method of turtle) {
    if (!db.knowledge.tradingMethods.some((item) => item.id === method.id)) {
      const { templateId, params, ...fields } = method;
      db.knowledge.tradingMethods.push({ ...fields, source: { id: CURATED_SOURCE.id, title: CURATED_SOURCE.title }, curated: true, cryptoAdapted: true, note: cryptoNote, createdAt: nowIso() });
    }
    if (db.knowledge.tradingSkills.some((skill) => skill.sourceMethodId === method.id)) continue;
    const skill = compileTradingMethod(db, method.id, { templateId: method.templateId, params: method.params }, actor);
    skill.curated = true;
    if (skill.status === "compiled") created += 1;
  }
  db.meta.turtleSeedV1 = true;
  if (created) appendAudit(db, `海龟策略(唐奇安20突破/下破 双向)入列:新编译 ${created} 个,待历史+纯前向验证`, CURATED_SOURCE.id, actor);
  return { created };
}

// 用户在聊天里口述策略 → agent 抽取结构化字段 → 复用编译流水线存成"我的技能"。
// 与书本方法、精选技能同一条严格生命周期：编译→历史→纯前向→人工批准→小额试用→转正。
const USER_SKILL_SOURCE = { id: "src_user_authored", title: "我的策略(聊天口述)", type: "user_authored" };
const VALID_TEMPLATES = new Set(["trend", "meanrev", "breakout", "macd", "bollinger", "death_cross", "rsi_short", "breakdown", "supertrend", "vol_breakout", "squeeze", "rsi_bull_div", "rsi_bear_div"]);

export function createSkillFromIdea(db, idea = {}, actor = "用户") {
  ensureCollections(db);
  const name = String(idea.name || "").trim();
  const direction = idea.direction === "short" ? "short" : "long";
  const timeframe = normalizeTimeframe(idea.timeframe) || "1h";
  if (!name) return { ok: false, error: "策略需要一个名字。" };
  if (!idea.entry) return { ok: false, error: "策略必须说明入场条件。" };
  if (!idea.stop) return { ok: false, error: "策略必须说明止损(价格距离或 ATR/百分比),否则无法上岗。" };
  if (idea.templateId && !VALID_TEMPLATES.has(idea.templateId)) {
    return { ok: false, error: `templateId 必须是受支持的模板之一:${[...VALID_TEMPLATES].join("/")}。` };
  }

  db.knowledge.sources ||= [];
  if (!db.knowledge.sources.some((s) => s.id === USER_SKILL_SOURCE.id)) {
    db.knowledge.sources.push({ ...USER_SKILL_SOURCE, createdAt: nowIso() });
  }
  const methodId = id("umethod");
  db.knowledge.tradingMethods.push({
    id: methodId,
    name,
    direction,
    timeframe,
    symbolScope: idea.symbol ? String(idea.symbol).toUpperCase() : "*",
    marketRegime: String(idea.marketRegime || "").slice(0, 40),
    entry: String(idea.entry).slice(0, 300),
    confirmation: String(idea.confirmation || "").slice(0, 300),
    stop: String(idea.stop).slice(0, 200),
    takeProfit: String(idea.takeProfit || "2R").slice(0, 120),
    invalidation: String(idea.invalidation || "").slice(0, 200),
    source: { id: USER_SKILL_SOURCE.id, title: USER_SKILL_SOURCE.title },
    userAuthored: true,
    createdAt: nowIso()
  });
  const skill = compileTradingMethod(db, methodId, { templateId: idea.templateId, params: idea.params || {} }, actor);
  skill.userAuthored = true;
  if (skill.status === "compile_failed") {
    return { ok: false, status: "compile_failed", error: `无法编译成可执行技能:${(skill.compileErrors || []).join("；") || "策略逻辑无法映射到受支持的模板(突破/趋势/RSI/均值回归/Supertrend/布林等),或缺明确入场/止损/止盈"}`, skill };
  }
  appendAudit(db, `用户口述策略存为技能「${skill.name}」(待历史与纯前向验证)`, skill.id, actor);
  return { ok: true, status: skill.status, skill };
}
