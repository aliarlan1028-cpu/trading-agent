import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { getStrategy } from "./strategies.mjs";
import { notifyLarkThrottled } from "./larkNotifier.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { applyCompiledSignalConstraints } from "./compiledSignals.mjs";
import { BAR_MINUTES } from "./backtestEngine.mjs";
import { validatePublishedStrategyCandidate } from "./strategyStudio.mjs";

// ---------------------------------------------------------------------------
// 模拟盘前向验证（三段验证的中段：回测 → 模拟盘 → 小额实盘）。
// 关键区别于回测：只在"会话创建之后到来的 K 线"上模拟成交，是真正的样本外前向记录，
// 随真实时间推进逐根累积，无法过拟合历史。达标（前向交易数够 + 期望为正 + 回撤可控）
// 才"毕业"，作为放大实盘额度前的最后安全垫。
// ---------------------------------------------------------------------------

const MIN_FORWARD_TRADES = Math.max(20, Number(process.env.MIN_FORWARD_TRADES || 30));
const MAX_DRAWDOWN_CAP = 20; // %
const MAX_SESSIONS = 30;

function summarizePaper(trades) {
  const count = trades.length;
  if (!count) return { trades: 0, winRatePct: null, profitFactor: null, expectancyR: null, maxDrawdownPct: null, netReturnPct: 0 };
  const wins = trades.filter((t) => t.rMultiple > 0);
  const grossWin = wins.reduce((s, t) => s + t.rMultiple, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((s, t) => s + t.rMultiple, 0));
  const expectancyR = trades.reduce((s, t) => s + t.rMultiple, 0) / count;
  const varianceR = count > 1 ? trades.reduce((s, t) => s + (t.rMultiple - expectancyR) ** 2, 0) / (count - 1) : 0;
  const expectancyStdErrR = Math.sqrt(varianceR / count);
  let equity = 100;
  let peak = 100;
  let maxDd = 0;
  for (const t of trades) {
    equity *= 1 + (t.rMultiple * 0.5) / 100;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100);
  }
  return {
    trades: count,
    winRatePct: Number(((wins.length / count) * 100).toFixed(1)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    expectancyR: Number(expectancyR.toFixed(3)),
    expectancyStdErrR: Number(expectancyStdErrR.toFixed(3)),
    expectancyLower90R: Number((expectancyR - 1.645 * expectancyStdErrR).toFixed(3)),
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    netReturnPct: Number((equity - 100).toFixed(2))
  };
}

function gradeSession(session) {
  const m = session.metrics || {};
  // 历史预热只用于检查管线，绝不能被当作真实前向证据。
  if (session.seeded) return "running";
  if (m.trades >= MIN_FORWARD_TRADES) {
    if (m.expectancyLower90R > 0 && m.profitFactor >= 1.1 && (m.maxDrawdownPct ?? 0) <= MAX_DRAWDOWN_CAP) return "passed";
    return "failed";
  }
  return "running";
}

// 处理一个会话：把 startBarTime 之后、尚未处理的新 K 线逐根前向模拟。
export function advanceSession(session, candles) {
  const strategy = getStrategy(session.strategyId);
  const signals = applyCompiledSignalConstraints(
    candles,
    strategy.signals(candles, session.params || {}),
    { confirmationSpec: session.params?.compiledConfirmationSpec }
  );
  const slPct = Math.max(0.1, Number(session.params?.stopLossPct || 2)) / 100;
  const tpR = Math.max(0.5, Number(session.params?.takeProfitR || 2));
  const isShort = String(session.direction || strategy.direction || "long") === "short";
  let processed = 0;

  for (let i = 0; i < candles.length; i += 1) {
    const bar = candles[i];
    const t = Number(bar.time);
    if (t <= session.lastBarTime) continue; // 只处理未处理过的新 bar
    // 管理已有模拟持仓
    if (session.paperPosition) {
      const pos = session.paperPosition;
      const hitStop = isShort ? Number(bar.high) >= pos.stop : Number(bar.low) <= pos.stop;
      const hitTp = isShort ? Number(bar.low) <= pos.tp : Number(bar.high) >= pos.tp;
      let exit = null;
      let reason = null;
      if (hitStop && hitTp) { exit = pos.stop; reason = "stop_first_assumed"; }
      else if (hitStop) { exit = pos.stop; reason = "stop"; }
      else if (hitTp) { exit = pos.tp; reason = "take_profit"; }
      if (exit !== null) {
        const grossR = isShort
          ? (pos.entry - exit) / (pos.stop - pos.entry)
          : (exit - pos.entry) / (pos.entry - pos.stop);
        const stopRiskPct = Math.abs(pos.entry - pos.stop) / pos.entry;
        const holdingBars = Math.max(1, i - Number(pos.entryIndex || i));
        const feeBps = Math.max(0, Number(process.env.PAPER_FEE_BPS || 4));
        const slippageBps = Math.max(0, Number(process.env.PAPER_SLIPPAGE_BPS || 3));
        const fundingRatePct = Number(session.params?.fundingRatePct || 0);
        const holdingHours = holdingBars * Number(BAR_MINUTES[session.timeframe] || 60) / 60;
        const costFraction = ((feeBps * 2 + slippageBps * 2) / 10_000)
          + Math.abs(fundingRatePct / 100) * (holdingHours / 8);
        const costR = stopRiskPct > 0 ? costFraction / stopRiskPct : 0;
        const rMultiple = grossR - costR;
        const pnlPct = isShort
          ? ((pos.entry - exit) / pos.entry) * 100
          : ((exit - pos.entry) / pos.entry) * 100;
        session.trades.push({
          entry: pos.entry,
          exit,
          grossR: Number(grossR.toFixed(3)),
          costR: Number(costR.toFixed(3)),
          rMultiple: Number(rMultiple.toFixed(3)),
          pnlPct: Number(pnlPct.toFixed(3)),
          reason,
          entryTime: pos.entryTime,
          exitTime: t
        });
        session.paperPosition = null;
      }
    }
    // 平仓状态下若本 bar 有入场信号 → 以收盘价开模拟仓
    if (!session.paperPosition && signals[i]) {
      const entry = Number(bar.close);
      const stop = isShort ? entry * (1 + slPct) : entry * (1 - slPct);
      const riskDistance = Math.abs(entry - stop);
      const tp = isShort ? entry - tpR * riskDistance : entry + tpR * riskDistance;
      session.paperPosition = { entry, stop, tp, entryTime: t, entryIndex: i };
    }
    session.lastBarTime = t;
    processed += 1;
  }
  return processed;
}

export async function createPaperSession(db, opts = {}, runtime = {}) {
  const symbol = String(opts.symbol || "BTC/USDT").toUpperCase();
  const timeframe = opts.timeframe || "4h";
  const strategy = getStrategy(opts.strategyId || "trend");
  const params = { ...strategy.defaultParams, ...(opts.params || {}) };
  let candles;
  try {
    const loadCandles = runtime.loadCandles || getHistoricalKlines;
    candles = await loadCandles(symbol, timeframe, 300);
  } catch (error) {
    return { status: "data_fetch_failed", error: error.message };
  }
  if (!Array.isArray(candles) || candles.length < 41) return { status: "insufficient_data", got: candles?.length || 0 };
  candles = candles.slice(0, -1);

  // lookbackBars>0：从最近 N 根历史开始"预热"前向记录（便于立即看到管线运行，标记 seeded）。
  // 默认 0：从当下开始，纯前向，随真实时间累积。
  const lookback = Math.max(0, Math.min(Number(opts.lookbackBars || 0), candles.length - 5));
  const startIndex = candles.length - 1 - lookback;
  const session = {
    id: id("paper"),
    symbol,
    timeframe,
    strategyId: strategy.id,
    label: strategy.label,
    direction: opts.direction || strategy.direction || "long",
    params,
    status: "running",
    seeded: lookback > 0,
    source: opts.source || "manual",
    tenantId: opts.tenantId || null,
    ownerUserId: opts.ownerUserId || null,
    ownerImprovementId: opts.ownerImprovementId || null,
    strategyExperimentId: opts.strategyExperimentId || null,
    strategyVersionId: opts.strategyVersionId || null,
    strategyDefinitionHash: opts.strategyDefinitionHash || null,
    strategyProductId: opts.strategyProductId || null,
    knowledgeSkillId: opts.knowledgeSkillId || null,
    knowledgeSkillVersion: opts.knowledgeSkillVersion || null,
    startedAt: nowIso(),
    startBarTime: Number(candles[startIndex].time),
    lastBarTime: Number(candles[startIndex].time),
    paperPosition: null,
    trades: [],
    metrics: summarizePaper([]),
    createdAt: nowIso(),
    updatedAt: nowIso()
  };
  advanceSession(session, candles);
  session.metrics = summarizePaper(session.trades);
  session.status = gradeSession(session);
  db.paperSessions ||= [];
  db.paperSessions.unshift(session);
  if (db.paperSessions.length > MAX_SESSIONS) {
    // seeded 会话永不毕业 → 永远 running → 旧逻辑"保留全部 running"会让集合无上限增长。
    // 纯前向 running（真实验证中）全保留；seeded running 只留最新 10 个；终态按余量截断。
    const runningForward = db.paperSessions.filter((item) => item.status === "running" && item.seeded === false);
    const runningSeeded = db.paperSessions.filter((item) => item.status === "running" && item.seeded !== false).slice(0, 10);
    const terminal = db.paperSessions.filter((item) => item.status !== "running");
    const kept = [...runningForward, ...runningSeeded];
    db.paperSessions = [...kept, ...terminal.slice(0, Math.max(0, MAX_SESSIONS - kept.length))];
  }
  appendAudit(db, `创建模拟盘会话 ${symbol} ${strategy.label}${session.seeded ? "（含历史预热）" : "（纯前向）"}`, session.id, "PaperTrading");
  return { status: "ok", session };
}

function paperError(code, status = 409) {
  return { status: "rejected", error: code, statusCode: status };
}

function ownedBy(actor, row) {
  return Boolean(actor?.id && actor?.tenantId
    && row?.tenantId === actor.tenantId
    && row?.ownerUserId === actor.id);
}

// Authoritative Owner entry point for a candidate strategy's pure forward-paper
// stage. Every identity and immutable version field is derived server-side; the
// client can select a symbol but cannot self-assert ownership or a version hash.
export async function startOwnerCandidatePaperSession(db, opts = {}, runtime = {}) {
  const actor = runtime.actor || db.user;
  if (actor?.isOwner !== true) return paperError("owner_only_review_loop", 403);
  const improvement = (db.ownerImprovementItems || []).find((row) => row.id === opts.improvementId && ownedBy(actor, row));
  if (!improvement) return paperError("owner_improvement_not_found", 404);
  if (improvement.destination !== "strategy" || improvement.state !== "validating") return paperError("strategy_improvement_not_validating");
  const experiment = (db.strategyExperiments || []).find((row) => row.id === improvement.experimentId && ownedBy(actor, row));
  if (!experiment) return paperError("strategy_validation_experiment_missing");
  const backtestStage = (experiment.stages || []).find((stage) => stage.name === "backtest");
  const paperStage = (experiment.stages || []).find((stage) => stage.name === "paper");
  if (backtestStage?.status !== "passed" || paperStage?.status !== "pending") return paperError("strategy_paper_stage_not_ready");

  const candidateRef = experiment.candidateStrategyRef;
  const version = (db.strategyBlueprintVersions || []).find((row) => row.id === candidateRef?.versionId);
  if (!version || !ownedBy(actor, version)) return paperError("candidate_strategy_version_not_owned", 403);
  const eligibility = validatePublishedStrategyCandidate(db, version);
  const productId = eligibility.productId;
  if (!eligibility.ok) return paperError(eligibility.error, eligibility.status || 409);
  if (!candidateRef?.definitionHash || candidateRef.definitionHash !== version.contentHash
    || candidateRef.productId !== productId || productId !== experiment.strategyRef?.productId) {
    return paperError("candidate_strategy_immutable_identity_mismatch");
  }

  const allowedSymbols = (version.definition?.symbols || []).map((value) => String(value).toUpperCase());
  const symbol = String(opts.symbol || allowedSymbols[0] || "").toUpperCase();
  if (!symbol || !allowedSymbols.includes(symbol)) return paperError("candidate_strategy_symbol_not_allowed", 400);
  const existing = (db.paperSessions || []).find((session) => ownedBy(actor, session)
    && session.ownerImprovementId === improvement.id
    && session.strategyExperimentId === experiment.id
    && session.strategyVersionId === version.id
    && session.strategyDefinitionHash === version.contentHash
    && session.strategyProductId === productId
    && session.symbol === symbol
    && session.seeded === false
    && ["running", "passed"].includes(session.status));
  if (existing) return { status: "ok", session: existing, reused: true };

  const definition = version.definition || {};
  return createPaperSession(db, {
    symbol,
    timeframe: definition.timeframe,
    strategyId: definition.templateId,
    direction: definition.direction,
    params: { ...(definition.params || {}), ...(definition.exitPolicy || {}) },
    lookbackBars: 0,
    source: "owner_candidate_strategy",
    tenantId: actor.tenantId,
    ownerUserId: actor.id,
    ownerImprovementId: improvement.id,
    strategyExperimentId: experiment.id,
    strategyVersionId: version.id,
    strategyDefinitionHash: version.contentHash,
    strategyProductId: productId
  }, runtime);
}

// 从已验证策略画像自动开模拟盘（研究闭环 → 前向验证）。
export async function ensurePaperSessionsFromProfiles(db, opts = {}) {
  const profiles = (db.strategyProfiles || []).filter((p) => p.strategyId && p.confidence === "validated");
  db.paperSessions ||= [];
  const created = [];
  for (const profile of profiles) {
    const exists = db.paperSessions.some((s) => s.symbol === profile.symbol
      && s.strategyId === profile.strategyId
      && s.tenantId === profile.tenantId
      && s.ownerUserId === profile.ownerUserId
      && s.status === "running");
    if (exists) continue;
    const result = await createPaperSession(db, {
      symbol: profile.symbol,
      timeframe: profile.timeframe,
      strategyId: profile.strategyId,
      params: profile.params,
      lookbackBars: Number(opts.lookbackBars || 0),
      source: "auto",
      tenantId: profile.tenantId || null,
      ownerUserId: profile.ownerUserId || null
    });
    if (result.status === "ok") created.push(result.session);
  }
  return created;
}

// 定时前向推进：拉最新 K 线，把新 bar 喂给每个运行中会话。
export async function runPaperForward(db, runtime = {}) {
  const running = (db.paperSessions || []).filter((s) => s.status === "running");
  const results = [];
  for (const session of running) {
    try {
      const loadCandles = runtime.loadCandles || getHistoricalKlines;
      const candles = await loadCandles(session.symbol, session.timeframe, 300);
      if (!Array.isArray(candles) || candles.length < 2) { results.push({ id: session.id, status: "no_data" }); continue; }
      const processed = advanceSession(session, candles.slice(0, -1));
      session.metrics = summarizePaper(session.trades);
      session.updatedAt = nowIso();
      const graded = gradeSession(session);
      if (graded !== "running" && graded !== session.status) {
        session.status = graded;
        session.gradedAt = nowIso();
        appendAudit(db, `模拟盘${graded === "passed" ? "通过" : "未通过"}：${session.symbol} ${session.label}（前向 ${session.metrics.trades} 笔，期望 ${session.metrics.expectancyR}R）`, session.id, "PaperTrading", graded === "passed" ? "info" : "warning");
        appendTrace(db, "paper_forward", `${session.symbol} ${graded}`, graded === "passed" ? "ok" : "warning");
        await notifyLarkThrottled(db, `paper:${session.id}:${graded}`, 6 * 60 * 60 * 1000, {
          severity: graded === "passed" ? "success" : "warning",
          title: graded === "passed" ? "✅ 策略通过模拟盘前向验证" : "⚠️ 策略未通过模拟盘验证",
          body: `**${session.symbol}** 的「${session.label}」前向 ${session.metrics.trades} 笔，期望 ${session.metrics.expectancyR}R，最大回撤 ${session.metrics.maxDrawdownPct}%。${graded === "passed" ? "可考虑纳入小额实盘。" : "建议继续观察或调整，不放大实盘。"}`,
          fields: [{ label: "前向胜率", value: `${session.metrics.winRatePct ?? "-"}%` }, { label: "盈亏比", value: String(session.metrics.profitFactor ?? "-") }]
        });
      }
      results.push({ id: session.id, status: session.status, processed, forwardTrades: session.metrics.trades });
    } catch (error) {
      results.push({ id: session.id, status: "error", error: error.message });
    }
  }
  return { checked: running.length, results };
}

export function hasPassedPaper(db, criteria) {
  const request = typeof criteria === "string" ? { symbol: criteria } : (criteria || {});
  if (!request.symbol) return false;
  const symbol = String(request.symbol).toUpperCase();
  const principal = request.principal || null;
  if (principal && (!principal.tenantId || !principal.userId)) return false;
  return (db.paperSessions || []).some((session) => {
    if (session.status !== "passed" || session.seeded !== false || session.symbol !== symbol) return false;
    if (request.timeframe && session.timeframe !== request.timeframe) return false;
    if (request.strategyId && session.strategyId !== request.strategyId) return false;
    if (request.knowledgeSkillId && session.knowledgeSkillId !== request.knowledgeSkillId) return false;
    if (request.knowledgeSkillVersion && Number(session.knowledgeSkillVersion) !== Number(request.knowledgeSkillVersion)) return false;
    if (request.skillFingerprint && session.params?.compiledSkillFingerprint !== request.skillFingerprint) return false;
    if (principal && (session.tenantId !== principal.tenantId || session.ownerUserId !== principal.userId)) return false;
    return true;
  });
}

export function paperValidationSummary(db, options = {}) {
  const principal = options.principal || null;
  const sessions = (db.paperSessions || []).filter((session) => !principal
    || (session.tenantId === principal.tenantId && session.ownerUserId === principal.userId));
  if (!sessions.length) return "";
  const bySymbol = {};
  for (const s of sessions) {
    const prev = bySymbol[s.symbol];
    if (!prev || (s.status === "passed" && prev.status !== "passed")) bySymbol[s.symbol] = s;
  }
  return Object.values(bySymbol)
    .map((s) => `- ${s.symbol}「${s.label}」模拟盘${{ passed: "已通过前向验证（可考虑小额实盘）", failed: "未通过（勿放大实盘）", running: `前向验证中（${s.metrics?.trades ?? 0}/${MIN_FORWARD_TRADES} 笔）` }[s.status] || s.status}`)
    .join("\n");
}

export function buildPaperReport(db) {
  return { minForwardTrades: MIN_FORWARD_TRADES, sessions: (db.paperSessions || []).slice(0, 20) };
}
