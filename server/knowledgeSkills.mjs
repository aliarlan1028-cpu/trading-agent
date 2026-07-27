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
export function validateAllCompiledSkills(db, saveDb, actor = "BatchValidator") {
  if (batchValidationRunning) return { started: false, reason: "already_running" };
  const targets = (db.knowledge?.tradingSkills || [])
    .filter((s) => ["compiled", "historical_rejected"].includes(s.status))
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

export function ensureCuratedSkills(db, actor = "CuratedSkills") {
  ensureCollections(db);
  db.knowledge.sources ||= [];
  if (!db.knowledge.sources.some((source) => source.id === CURATED_SOURCE.id)) {
    db.knowledge.sources.push({ ...CURATED_SOURCE, createdAt: nowIso() });
  }
  let created = 0;
  for (const method of CURATED_METHODS) {
    if (!db.knowledge.tradingMethods.some((item) => item.id === method.id)) {
      const { templateId, params, ...fields } = method;
      db.knowledge.tradingMethods.push({ ...fields, source: { id: CURATED_SOURCE.id, title: CURATED_SOURCE.title }, curated: true, createdAt: nowIso() });
    }
    // 一次性编译:该方法已有任何技能记录(含被拒/被替代)就不再重编,避免每次启动刷新版本
    if (db.knowledge.tradingSkills.some((skill) => skill.sourceMethodId === method.id)) continue;
    const skill = compileTradingMethod(db, method.id, { templateId: method.templateId, params: method.params }, actor);
    skill.curated = true;
    if (skill.status === "compiled") created += 1;
  }
  if (created) appendAudit(db, `精选手写技能入列:新编译 ${created} 个(待历史验证)`, CURATED_SOURCE.id, actor);
  return { created };
}
