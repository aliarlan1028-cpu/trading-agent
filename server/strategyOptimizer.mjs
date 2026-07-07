import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { simulate, BAR_MINUTES } from "./backtestEngine.mjs";
import { STRATEGIES, detectRegime, regimePreferredFamilies } from "./strategies.mjs";
import { buildReviewAnalytics } from "./reviewEngine.mjs";
import { ensurePaperSessionsFromProfiles } from "./paperTrading.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

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
const MIN_TRAIN_TRADES = 5;  // 训练窗最小交易数（提高门槛，抗过拟合；受限于 ≤500 根样本）
const MIN_OOS_TRADES = 3;    // 每个样本外窗（val/test）最小交易数——双窗都要过

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

export function optimizeSymbol(candles, timeframe = "1h") {
  const n = candles.length;
  const barMinutes = BAR_MINUTES[timeframe] || 60;
  const uptrend = htfUptrend(candles);
  const a = Math.floor(n * 0.6); // train: [0,a)
  const b = Math.floor(n * 0.8); // val: [a,b) ; test: [b,n)
  const candidates = [];

  for (const strategy of Object.values(STRATEGIES)) {
    const isLong = (strategy.direction || "long") !== "short";
    let bestOnTrain = null;
    for (const entryParams of strategy.paramGrid) {
      const raw = strategy.signals(candles, entryParams);
      // 多周期确认：只在大周期同向时入场
      const signals = raw.map((s, i) => Boolean(s) && (isLong ? uptrend[i] : !uptrend[i]));
      for (const exit of EXIT_GRID) {
        const opts = { ...exit, riskPerTradePct: 0.5, direction: strategy.direction, barMinutes };
        const train = evaluate(candles, signals, 0, a, opts);
        if (!qualified(train, MIN_TRAIN_TRADES)) continue;
        if (!bestOnTrain || train.expectancyR > bestOnTrain.train.expectancyR) {
          const val = evaluate(candles, signals, a, b, opts);
          const test = evaluate(candles, signals, b, n, opts);
          bestOnTrain = { strategyId: strategy.id, label: strategy.label, family: strategy.family, direction: strategy.direction || "long", params: { ...entryParams, ...exit }, train, val, test };
        }
      }
    }
    if (bestOnTrain) candidates.push(bestOnTrain);
  }

  // 双样本外合格：val 与 test 两窗都要有足够交易且期望 R > 0（抗过拟合关键）
  const robust = candidates
    .filter((c) => qualified(c.val, MIN_OOS_TRADES) && qualified(c.test, MIN_OOS_TRADES) && c.val.expectancyR > 0 && c.test.expectancyR > 0)
    .sort((x, y) => (y.test.expectancyR + y.val.expectancyR) - (x.test.expectancyR + x.val.expectancyR));

  const regime = detectRegime(candles.slice(b));
  const preferred = regimePreferredFamilies(regime);
  const regimeMatched = robust.filter((c) => preferred.includes(c.family));
  const best = regimeMatched[0] || robust[0] || null;

  return {
    best,
    confidence: best ? (regimeMatched[0] ? "validated" : "oos_ok") : "low",
    regime,
    regimeMatch: best ? preferred.includes(best.family) : false,
    preferredFamilies: preferred,
    oosScore: best ? Number(((best.val.expectancyR + best.test.expectancyR) / 2).toFixed(3)) : null,
    candidates: candidates.map((c) => ({ strategyId: c.strategyId, label: c.label, family: c.family, direction: c.direction || "long", params: c.params, valExpectancyR: c.val?.expectancyR ?? null, testExpectancyR: c.test?.expectancyR ?? null, testTrades: c.test?.trades ?? 0 }))
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
    val: best?.val || null,
    test: best?.test || null,
    oosScore: opt.oosScore,
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
    .map((p) => `- ${p.symbol}(${p.timeframe})：优选「${p.label}」参数 ${JSON.stringify(p.params)}，样本外期望 ${p.test?.expectancyR ?? "-"}R / 盈亏比 ${p.test?.profitFactor ?? "-"}，置信度 ${p.confidence}，当前 regime ${p.regime}${p.regimeMatch ? "（策略与 regime 匹配）" : "（注意：与当前 regime 不完全匹配，谨慎）"}。`);
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
  const mandate = (db.mandates || []).find((m) => ["active", "running"].includes(m.status));
  const symbols = (options.symbols?.length ? options.symbols : (mandate?.allowedSymbols?.length ? mandate.allowedSymbols : ["BTC/USDT"])).slice(0, 5);
  // 显式指定周期→只跑该周期；否则多周期扫描，自动选样本外最优周期。
  const timeframes = options.timeframe ? [options.timeframe] : RESEARCH_TIMEFRAMES;
  const limit = Math.min(Number(options.limit || 500), 500);
  db.strategyProfiles ||= [];
  const updated = [];
  const skipped = [];

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
      const opt = optimizeSymbol(candles, tf);
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
