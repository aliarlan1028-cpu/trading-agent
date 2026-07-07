import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { simulate } from "./backtestEngine.mjs";
import { STRATEGIES, detectRegime, regimePreferredFamilies } from "./strategies.mjs";
import { buildReviewAnalytics } from "./reviewEngine.mjs";
import { ensurePaperSessionsFromProfiles } from "./paperTrading.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

// ---------------------------------------------------------------------------
// 策略优化器 + 自主学习闭环。
// 关键：样本外验证（train 寻优 → test 验证），避免过拟合历史。
// 为每个交易对选出最优策略+参数，写入 strategyProfiles，并回灌到 AGENT.md 记忆，
// 让 Agent 的决策基于"真正跑赢过样本外"的策略，而不是凭感觉。
// ---------------------------------------------------------------------------

const EXIT_GRID = [
  { stopLossPct: 2, takeProfitR: 1.5 },
  { stopLossPct: 2, takeProfitR: 2.5 },
  { stopLossPct: 3, takeProfitR: 1.5 },
  { stopLossPct: 3, takeProfitR: 2.5 }
];
const MIN_TRADES = 3;

function qualified(metrics) {
  return metrics && metrics.trades >= MIN_TRADES && metrics.expectancyR !== null && Number.isFinite(metrics.expectancyR);
}

// 在给定 candles/signals 切片上评估一组参数
function evaluate(candles, signals, from, to, params) {
  const c = candles.slice(from, to);
  const s = signals.slice(from, to);
  return simulate(c, s, params);
}

export function optimizeSymbol(candles) {
  const split = Math.floor(candles.length * 0.7);
  const candidates = [];

  for (const strategy of Object.values(STRATEGIES)) {
    let bestOnTrain = null;
    for (const entryParams of strategy.paramGrid) {
      const signals = strategy.signals(candles, entryParams); // 全序列算信号，保证 warmup 正确
      for (const exit of EXIT_GRID) {
        const opts = { ...exit, riskPerTradePct: 0.5, direction: strategy.direction };
        const train = evaluate(candles, signals, 0, split, opts);
        if (!qualified(train)) continue;
        if (!bestOnTrain || train.expectancyR > bestOnTrain.train.expectancyR) {
          const test = evaluate(candles, signals, split, candles.length, opts);
          bestOnTrain = { strategyId: strategy.id, label: strategy.label, family: strategy.family, direction: strategy.direction || "long", params: { ...entryParams, ...exit }, train, test };
        }
      }
    }
    if (bestOnTrain) candidates.push(bestOnTrain);
  }

  // 样本外排名：优先满足最小交易数且期望 R 最高
  const oos = candidates.filter((c) => qualified(c.test)).sort((a, b) => b.test.expectancyR - a.test.expectancyR);
  const fallback = candidates.slice().sort((a, b) => (b.test?.expectancyR ?? -99) - (a.test?.expectancyR ?? -99));

  // regime 自适应：当前 regime 偏好的策略家族优先，只要它样本外也合格
  const regime = detectRegime(candles.slice(split));
  const preferred = regimePreferredFamilies(regime);
  const regimeMatched = oos.filter((c) => preferred.includes(c.family));
  const best = regimeMatched[0] || oos[0] || fallback[0] || null;

  return {
    best,
    confidence: (regimeMatched[0] || oos[0]) ? "validated" : "low",
    regime,
    regimeMatch: best ? preferred.includes(best.family) : false,
    preferredFamilies: preferred,
    candidates: candidates.map((c) => ({ strategyId: c.strategyId, label: c.label, family: c.family, direction: c.direction || "long", params: c.params, testExpectancyR: c.test?.expectancyR ?? null, testTrades: c.test?.trades ?? 0 }))
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
    params: best?.params || null,
    train: best?.train || null,
    test: best?.test || null,
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
export async function runStrategyResearch(db, options = {}) {
  const mandate = (db.mandates || []).find((m) => ["active", "running"].includes(m.status));
  const symbols = (options.symbols?.length ? options.symbols : (mandate?.allowedSymbols?.length ? mandate.allowedSymbols : ["BTC/USDT"])).slice(0, 5);
  const timeframe = options.timeframe || "4h";
  const limit = Math.min(Number(options.limit || 300), 500);
  db.strategyProfiles ||= [];
  const updated = [];
  const skipped = [];

  for (const symbol of symbols) {
    let candles;
    try {
      candles = await getHistoricalKlines(String(symbol).toUpperCase(), timeframe, limit);
    } catch (error) {
      skipped.push({ symbol, reason: `取数失败：${error.message}` });
      continue;
    }
    if (!Array.isArray(candles) || candles.length < 80) {
      skipped.push({ symbol, reason: `K 线不足（${candles?.length || 0}）` });
      continue;
    }
    const opt = optimizeSymbol(candles);
    const profile = profileFrom(String(symbol).toUpperCase(), timeframe, opt);
    db.strategyProfiles = db.strategyProfiles.filter((p) => !(p.symbol === profile.symbol && p.timeframe === profile.timeframe));
    db.strategyProfiles.unshift(profile);
    updated.push(profile);
  }

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
