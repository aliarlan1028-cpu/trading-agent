import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { simulate, BAR_MINUTES } from "./backtestEngine.mjs";
import { STRATEGIES, detectRegime, regimePreferredFamilies, strategyMatchesRegime } from "./strategies.mjs";
import { buildTokenProfile } from "./tokenProfile.mjs";
import { buildReviewAnalytics } from "./reviewEngine.mjs";
import { ensurePaperSessionsFromProfiles } from "./paperTrading.mjs";
import { activeMandate, appendAudit, appendTrace, id, nowIso } from "./store.mjs";
import { anchoredPurgedOosFolds, attachDeflatedSharpe, rollingPurgedWalkForwardFolds } from "./validationStatistics.mjs";
import { analyzeMarketRegime } from "./marketRegimeAnalysis.mjs";
import { assertNativeStrategyContracts } from "./strategyContracts.mjs";

// ---------------------------------------------------------------------------
// 策略优化器 + 自主学习闭环（专业化版）。
// - 三窗 walk-forward：train 寻优 → val + test 双样本外都要合格，抗过拟合。
// - 多周期确认：入场只在"大周期趋势"同向时放行（多头需上行，空头需下行）。
// - 成本真实：回测计入手续费/滑点/资金费率（simulate 内），出场可选 ATR 自适应止损。
// - 多周期扫描：一次比较多个周期，自动选样本外最优的周期+策略。
// ---------------------------------------------------------------------------

const EXIT_GRID = [
  { stopLossPct: 2, takeProfitR: 1.5 },
  { stopLossPct: 3, takeProfitR: 2.5 },
  { atrStop: true, atrMult: 2, atrPeriod: 14, takeProfitR: 1.5 },
  { atrStop: true, atrMult: 3, atrPeriod: 14, takeProfitR: 2.5 }
];
const MIN_TRAIN_TRADES = 10; // 训练窗最小交易数（样本已扩到 ~2500 根，可上调）
const MIN_OOS_TRADES = 8;    // 合并样本外（后 60%，跨多段/多月）最小交易数
const MIN_FOLD_TRADES = 2;   // 单个样本外折最小交易数（判断该折是否"算数"）

function qualified(metrics, minTrades) {
  return metrics && metrics.trades >= minTrades && metrics.expectancyR !== null && Number.isFinite(metrics.expectancyR);
}

// 多周期趋势代理：用 period×factor 的长周期均线近似"大周期趋势"。
// warmup 内不过滤（返回 true），避免早期样本被误杀。
function htfUptrend(candles, period = 20, factor = 4) {
  const closes = candles.map((c) => Number(c.close));
  const p = period * factor;
  return closes.map((_, i) => {
    if (i < p) return true;
    let sum = 0;
    for (let j = i - p + 1; j <= i; j += 1) sum += closes[j];
    return closes[i] > sum / p;
  });
}

// 在给定 candles/signals 切片上评估一组参数
function evaluate(candles, signals, from, to, params) {
  const c = candles.slice(from, to);
  const s = signals.slice(from, to);
  return simulate(c, s, params);
}

function rollingOptimizerDiagnostics(candles, trialRecords) {
  const split = rollingPurgedWalkForwardFolds(candles.length, { purgeBars: 1, embargoBars: 1 });
  const foldResults = [];
  for (let foldIndex = 0; foldIndex < split.folds.length; foldIndex += 1) {
    const fold = split.folds[foldIndex];
    let selected = null;
    for (const trial of trialRecords) {
      const train = evaluate(candles, trial.signals, fold.train[0], fold.train[1], trial.opts);
      if (!qualified(train, MIN_TRAIN_TRADES)) continue;
      if (!selected || train.expectancyR > selected.train.expectancyR) selected = { trial, train };
    }
    if (!selected) {
      foldResults.push({ fold: foldIndex, train: fold.train, test: fold.test, status: "no_qualified_training_candidate" });
      continue;
    }
    const testMetrics = evaluate(candles, selected.trial.signals, fold.test[0], fold.test[1], selected.trial.opts);
    foldResults.push({
      fold: foldIndex,
      train: fold.train,
      test: fold.test,
      status: qualified(testMetrics, MIN_FOLD_TRADES) ? "evaluated" : "insufficient_test_trades",
      selectedStrategyId: selected.trial.strategyId,
      selectedParams: selected.trial.params,
      trainMetrics: selected.train,
      testMetrics
    });
  }
  const evaluated = foldResults.filter((fold) => fold.status === "evaluated");
  const positive = evaluated.filter((fold) => fold.testMetrics.expectancyR > 0);
  const trades = evaluated.reduce((sum, fold) => sum + fold.testMetrics.trades, 0);
  const weightedExpectancyR = trades
    ? evaluated.reduce((sum, fold) => sum + fold.testMetrics.expectancyR * fold.testMetrics.trades, 0) / trades
    : null;
  return {
    method: "rolling_retrain_purged_walk_forward",
    purgeBars: split.purgeBars,
    embargoBars: split.embargoBars,
    folds: foldResults,
    evaluatedFolds: evaluated.length,
    positiveFolds: positive.length,
    totalOosTrades: trades,
    weightedOosExpectancyR: weightedExpectancyR == null ? null : Number(weightedExpectancyR.toFixed(3)),
    passed: evaluated.length >= 2 && positive.length * 2 >= evaluated.length && trades >= MIN_OOS_TRADES && weightedExpectancyR > 0
  };
}

// 实盘表现权重：对有足够真实平仓样本的策略，按胜率/盈亏比给一个 [0.7,1.3] 的乘子，
// 在"已通过样本外"的合格策略之间再加权（不替代样本外门槛，只影响优选谁）。
export function buildLiveStrategyWeights(db) {
  let analytics;
  try { analytics = buildReviewAnalytics(db); } catch { return {}; }
  const weights = {};
  const min = Number(process.env.LIVE_WEIGHT_MIN_TRADES || 10);
  for (const s of analytics.breakdowns?.strategy || []) {
    if (!s.key || Number(s.trades) < min) continue;
    const wr = s.winRatePct != null ? Number(s.winRatePct) / 100 : 0.5;
    const pf = Number.isFinite(Number(s.profitFactor)) ? Number(s.profitFactor) : (Number(s.pnl) >= 0 ? 1.1 : 0.9);
    const mult = Math.max(0.7, Math.min(1.3, 1 + 0.4 * (wr - 0.5) + 0.15 * (pf - 1)));
    weights[s.key] = Number(mult.toFixed(3));
  }
  return weights;
}

export function optimizeSymbol(candles, timeframe = "1h", liveWeights = {}) {
  assertNativeStrategyContracts(Object.values(STRATEGIES));
  const liveMult = (c) => liveWeights[c.strategyId] ?? liveWeights[c.label] ?? 1;
  const n = candles.length;
  const barMinutes = BAR_MINUTES[timeframe] || 60;
  const uptrend = htfUptrend(candles);
  // 锚定式多折样本外：参数只在前 40% 选择。训练/OOS 边界之间显式 purge+embargo，
  // 避免相邻 K 线、标签持有期和指标窗口把训练信息泄漏进验证段。
  const split = anchoredPurgedOosFolds(n, { trainFraction: 0.4, foldCount: 3, purgeBars: 1, embargoBars: 1 });
  const folds = split.folds;
  const candidates = [];
  let parameterTrials = 0;
  const trialRecords = [];

  for (const strategy of Object.values(STRATEGIES)) {
    const isLong = (strategy.direction || "long") !== "short";
    let bestOnTrain = null;
    for (const entryParams of strategy.paramGrid) {
      const raw = strategy.signals(candles, entryParams);
      const signals = raw.map((s, i) => Boolean(s) && (isLong ? uptrend[i] : !uptrend[i])); // 多周期确认
      for (const exit of EXIT_GRID) {
        parameterTrials += 1;
        const opts = { ...exit, riskPerTradePct: 0.5, direction: strategy.direction, barMinutes };
        const train = evaluate(candles, signals, split.train[0], split.train[1], opts);
        trialRecords.push({ strategyId: strategy.id, params: { ...entryParams, ...exit }, signals, opts });
        if (!qualified(train, MIN_TRAIN_TRADES)) continue;
        if (!bestOnTrain || train.expectancyR > bestOnTrain.train.expectancyR) {
          const foldMetrics = folds.map(([from, to]) => evaluate(candles, signals, from, to, opts));
          const oos = evaluate(candles, signals, split.oos[0], split.oos[1], opts);
          bestOnTrain = { strategyId: strategy.id, label: strategy.label, family: strategy.family, direction: strategy.direction || "long", params: { ...entryParams, ...exit }, train, folds: foldMetrics, oos };
        }
      }
    }
    if (bestOnTrain) candidates.push(bestOnTrain);
  }
  for (const candidate of candidates) {
    candidate.oos = attachDeflatedSharpe(candidate.oos, parameterTrials);
    candidate.validationMethod = { name: "anchored_purged_multi_oos", purgeBars: split.purgeBars, embargoBars: split.embargoBars, parameterTrials };
  }
  const rollingValidation = rollingOptimizerDiagnostics(candles, trialRecords);

  // 跨段一致性：有足够交易的样本外折里，期望 R>0 的折数。
  const positiveFolds = (c) => c.folds.filter((f) => f.trades >= MIN_FOLD_TRADES && f.expectancyR > 0).length;
  const activeFolds = (c) => c.folds.filter((f) => f.trades >= MIN_FOLD_TRADES).length;

  // 合格：合并样本外交易数达标、期望 R>0，且至少一半"算数"的折为正（避免靠单段撑起）。
  const robust = candidates
    .filter((c) => qualified(c.oos, MIN_OOS_TRADES) && c.oos.expectancyR > 0 && positiveFolds(c) * 2 >= Math.max(1, activeFolds(c)))
    .sort((x, y) => {
      if (positiveFolds(y) !== positiveFolds(x)) return positiveFolds(y) - positiveFolds(x); // 跨段一致性优先
      return (y.oos.expectancyR * liveMult(y)) - (x.oos.expectancyR * liveMult(x)); // 同等一致性下，用样本外期望×实盘权重优选
    });

  const regime = detectRegime(candles.slice(folds[2][0]));
  const regimeDiagnostics = analyzeMarketRegime(candles.slice(-120));
  const profile = buildTokenProfile(candles, timeframe); // 该币的统计性格
  // 家族偏好：该币性格（趋势/回归，更稳）优先，叠加近期 regime。
  const preferred = [...new Set([
    ...(profile.ok && profile.preferredFamily ? [profile.preferredFamily] : []),
    ...regimePreferredFamilies(regime)
  ])];
  const regimeMatched = robust.filter((candidate) => strategyMatchesRegime(candidate, regime));
  const best = regimeMatched[0] || robust[0] || null;
  const bestRegimeMatch = best ? strategyMatchesRegime(best, regime) : false;
  const bestPos = best ? positiveFolds(best) : 0;
  const bestActive = best ? activeFolds(best) : 0;

  return {
    best,
    confidence: best ? (bestRegimeMatch
      && bestPos === bestActive && bestActive >= 2
      && (best.oos.deflatedSharpeProbability ?? 0) >= 0.5
      && rollingValidation.passed
      && !(regimeDiagnostics.transition.detected && regimeDiagnostics.transition.confidence >= 0.65)
      ? "validated" : "oos_ok") : "low",
    regime,
    regimeMatch: bestRegimeMatch,
    preferredFamilies: preferred,
    tokenProfile: profile.ok ? profile : null,
    oosScore: best ? Number(best.oos.expectancyR.toFixed(3)) : null,
    oosFolds: best ? `${bestPos}/${bestActive} 段样本外为正` : null,
    liveWeight: best ? Number(liveMult(best).toFixed(3)) : null,
    overfitDiagnostics: best ? { deflatedSharpeProbability: best.oos.deflatedSharpeProbability, parameterTrials, purgeBars: split.purgeBars, embargoBars: split.embargoBars } : null,
    regimeDiagnostics,
    rollingValidation,
    candidates: candidates.map((c) => ({ strategyId: c.strategyId, label: c.label, family: c.family, direction: c.direction || "long", params: c.params, oosExpectancyR: c.oos?.expectancyR ?? null, oosTrades: c.oos?.trades ?? 0, positiveFolds: positiveFolds(c) }))
  };
}

function profileFrom(symbol, timeframe, opt) {
  const best = opt.best;
  return {
    id: id("sp"),
    symbol,
    timeframe,
    strategyId: best?.strategyId || null,
    label: best?.label || "无合格策略",
    direction: best?.direction || null,
    params: best?.params || null,
    train: best?.train || null,
    folds: best?.folds || null,
    oos: best?.oos || null,
    oosScore: opt.oosScore,
    oosFolds: opt.oosFolds,
    liveWeight: opt.liveWeight ?? null,
    overfitDiagnostics: opt.overfitDiagnostics || null,
    regimeDiagnostics: opt.regimeDiagnostics || null,
    rollingValidation: opt.rollingValidation || null,
    tokenProfile: opt.tokenProfile || null,
    regime: opt.regime,
    regimeMatch: opt.regimeMatch,
    family: best?.family || null,
    confidence: best ? opt.confidence : "none",
    chosenAt: nowIso()
  };
}

function writeProfileToMemory(db, profiles) {
  db.agentStateFiles ||= {};
  const file = db.agentStateFiles.AGENT ||= { id: "state_agent", title: "AGENT.md", content: "", updatedAt: nowIso() };
  const lines = profiles
    .filter((p) => p.strategyId)
    .map((p) => `- ${p.symbol}(${p.timeframe})：优选「${p.label}」${p.direction === "short" ? "做空" : "做多"} 参数 ${JSON.stringify(p.params)}，合并样本外期望 ${p.oosScore ?? "-"}R / 盈亏比 ${p.oos?.profitFactor ?? "-"}（${p.oosFolds || "-"}），置信度 ${p.confidence}，当前 regime ${p.regime}${p.regimeMatch ? "（策略与 regime 匹配）" : "（注意：与当前 regime 不完全匹配，谨慎）"}。`);
  if (!lines.length) return;
  const marker = "## 已验证策略画像（自动更新）";
  const base = String(file.content || "").split(marker)[0].trim();
  file.content = `${base ? `${base}\n\n` : ""}${marker}\n更新于 ${nowIso()}\n${lines.join("\n")}`.slice(0, 6000);
  file.updatedAt = nowIso();
}

function mineReviewLessons(db) {
  const analytics = buildReviewAnalytics(db);
  const clusters = analytics.lossClusters || [];
  if (!clusters.length) return;
  db.memoryItems ||= [];
  const top = clusters[0];
  const title = `亏损聚类：${top.key}`;
  if (db.memoryItems.some((m) => m.title === title && m.source === "learning_loop")) return;
  db.memoryItems.unshift({
    id: id("mem"),
    layer: "semantic",
    title,
    content: `复盘发现亏损集中在「${top.key}」（${top.count} 笔，合计 ${top.pnl} USDT）。${top.suggestion || "复盘该场景的入场与止损。"}`,
    tags: ["learning_loop", "loss_cluster"],
    source: "learning_loop",
    createdAt: nowIso()
  });
  if (db.memoryItems.length > 200) db.memoryItems = db.memoryItems.slice(0, 200);
}

// 自主学习闭环主入口：优化授权交易对 → 存画像 → 回灌记忆 → 挖复盘教训。
const RESEARCH_TIMEFRAMES = ["15m", "1h", "4h"];

export async function runStrategyResearch(db, options = {}) {
  const mandate = activeMandate(db);
  const symbols = (options.symbols?.length ? options.symbols : (mandate?.allowedSymbols?.length ? mandate.allowedSymbols : ["BTC/USDT"])).slice(0, 5);
  // 显式指定周期→只跑该周期；否则多周期扫描，自动选样本外最优周期。
  const timeframes = options.timeframe ? [options.timeframe] : RESEARCH_TIMEFRAMES;
  const limit = Math.min(Number(options.limit || 2500), 3000);
  db.strategyProfiles ||= [];
  const updated = [];
  const skipped = [];
  const liveWeights = buildLiveStrategyWeights(db); // ③ 把真实成交表现纳入优选权重

  for (const symbol of symbols) {
    const sym = String(symbol).toUpperCase();
    let winner = null; // { timeframe, opt }
    for (const tf of timeframes) {
      let candles;
      try {
        candles = await getHistoricalKlines(sym, tf, limit);
      } catch {
        continue;
      }
      if (!Array.isArray(candles) || candles.length < 120) continue;
      const opt = optimizeSymbol(candles, tf, liveWeights);
      if (opt.best && (!winner || (opt.oosScore ?? -99) > (winner.opt.oosScore ?? -99))) {
        winner = { timeframe: tf, opt };
      } else if (!winner) {
        winner = { timeframe: tf, opt }; // 记录一个即使无合格策略，便于给出"无合格"画像
      }
    }
    if (!winner) {
      skipped.push({ symbol: sym, reason: "各周期取数失败或 K 线不足" });
      continue;
    }
    const profile = profileFrom(sym, winner.timeframe, winner.opt);
    db.strategyProfiles = db.strategyProfiles.filter((p) => p.symbol !== profile.symbol);
    db.strategyProfiles.unshift(profile);
    updated.push(profile);
  }
  const timeframe = timeframes.join("/");

  if (db.strategyProfiles.length > 40) db.strategyProfiles = db.strategyProfiles.slice(0, 40);
  writeProfileToMemory(db, updated);
  mineReviewLessons(db);
  // 已验证的策略自动进入模拟盘前向验证（纯前向，随时间累积）。
  const paperSpawned = await ensurePaperSessionsFromProfiles(db, { lookbackBars: Number(options.paperLookbackBars || 0) });
  appendAudit(db, `策略研究完成：更新 ${updated.length} 个画像，跳过 ${skipped.length} 个，开模拟盘 ${paperSpawned.length} 个`, "strategy_research", "LearningLoop");
  appendTrace(db, "strategy_research", `${updated.map((p) => `${p.symbol}:${p.strategyId || "无"}`).join(" ")}`, "ok");
  return { status: "ok", ranAt: nowIso(), timeframe, updated, skipped, paperSpawned: paperSpawned.length };
}

export function activeStrategyProfiles(db, symbol) {
  const profiles = db.strategyProfiles || [];
  if (symbol) return profiles.filter((p) => p.symbol === String(symbol).toUpperCase());
  return profiles;
}
