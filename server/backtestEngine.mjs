import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { detectRegime, getStrategy } from "./strategies.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

// ---------------------------------------------------------------------------
// 回测引擎：给定入场信号，用统一的止损/止盈-R 出场模型逐根回放，
// 计算胜率、盈亏比、最大回撤、期望 R。入场信号来自策略库（strategies.mjs）。
// simulate 是纯函数（不取数、不写库），供优化器在内存里跑成百上千次组合。
// ---------------------------------------------------------------------------

// 纯回测核心：candles + 入场信号数组 → 指标。
export function simulate(candles, entrySignals, opts = {}) {
  const stopLossPct = Math.max(0.1, Number(opts.stopLossPct || 2)) / 100;
  const takeProfitR = Math.max(0.5, Number(opts.takeProfitR || 2));
  const riskPerTradePct = Math.max(0.05, Number(opts.riskPerTradePct || 0.5));
  const closes = candles.map((c) => Number(c.close));
  const trades = [];
  let position = null;

  for (let i = 1; i < candles.length; i += 1) {
    const bar = candles[i];
    if (position) {
      const hitStop = Number(bar.low) <= position.stop;
      const hitTp = Number(bar.high) >= position.tp;
      let exitPrice = null;
      let reason = null;
      if (hitStop && hitTp) { exitPrice = position.stop; reason = "stop_first_assumed"; }
      else if (hitStop) { exitPrice = position.stop; reason = "stop"; }
      else if (hitTp) { exitPrice = position.tp; reason = "take_profit"; }
      if (exitPrice !== null) {
        const rMultiple = (exitPrice - position.entry) / (position.entry - position.stop);
        trades.push({ rMultiple: Number(rMultiple.toFixed(3)), pnlPct: Number((((exitPrice - position.entry) / position.entry) * 100).toFixed(3)), reason, bars: i - position.entryIndex });
        position = null;
      }
    }
    if (!position && entrySignals[i] && i + 1 < candles.length) {
      const entry = Number(candles[i + 1].open);
      const stop = entry * (1 - stopLossPct);
      const tp = entry + takeProfitR * (entry - stop);
      position = { entry, stop, tp, entryIndex: i + 1 };
    }
  }
  if (position) {
    const exitPrice = closes[closes.length - 1];
    const rMultiple = (exitPrice - position.entry) / (position.entry - position.stop);
    trades.push({ rMultiple: Number(rMultiple.toFixed(3)), pnlPct: Number((((exitPrice - position.entry) / position.entry) * 100).toFixed(3)), reason: "mark_to_market", bars: closes.length - 1 - position.entryIndex });
  }
  return summarize(trades, riskPerTradePct);
}

function summarize(trades, riskPerTradePct) {
  const count = trades.length;
  if (!count) {
    return { trades: 0, winRatePct: null, profitFactor: null, maxDrawdownPct: null, expectancyR: null, netReturnPct: 0, avgHoldBars: null, equityCurve: [] };
  }
  const wins = trades.filter((t) => t.rMultiple > 0);
  const grossWin = wins.reduce((sum, t) => sum + t.rMultiple, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((sum, t) => sum + t.rMultiple, 0));
  const expectancyR = trades.reduce((sum, t) => sum + t.rMultiple, 0) / count;
  let equity = 100;
  let peak = 100;
  let maxDd = 0;
  const equityCurve = [100];
  for (const t of trades) {
    equity *= 1 + (t.rMultiple * riskPerTradePct) / 100;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, ((peak - equity) / peak) * 100);
    equityCurve.push(Number(equity.toFixed(2)));
  }
  return {
    trades: count,
    winRatePct: Number(((wins.length / count) * 100).toFixed(1)),
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(2)) : null,
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    expectancyR: Number(expectancyR.toFixed(3)),
    netReturnPct: Number((equity - 100).toFixed(2)),
    avgHoldBars: Number((trades.reduce((sum, t) => sum + t.bars, 0) / count).toFixed(1)),
    equityCurve: equityCurve.slice(-60)
  };
}

// 单次回测（取数 + 跑一个策略 + 落库），供 UI/Agent 单独调用。
export async function runBacktest(db, params = {}) {
  const symbol = String(params.symbol || "BTC/USDT").toUpperCase();
  const timeframe = params.timeframe || "1h";
  const limit = Math.min(Number(params.limit || 300), 500);
  const strategy = getStrategy(params.strategy || "trend");
  const stratParams = { ...strategy.defaultParams, ...(params.params || {}) };
  if (params.fast) stratParams.fast = Number(params.fast);
  if (params.slow) stratParams.slow = Number(params.slow);

  let candles = [];
  try {
    candles = await getHistoricalKlines(symbol, timeframe, limit);
  } catch (error) {
    return { status: "data_fetch_failed", error: error.message, symbol, timeframe };
  }
  if (!Array.isArray(candles) || candles.length < 40) {
    return { status: "insufficient_data", got: candles?.length || 0, need: 40, symbol, timeframe };
  }
  const signals = strategy.signals(candles, stratParams);
  const metrics = simulate(candles, signals, { stopLossPct: params.stopLossPct, takeProfitR: params.takeProfitR, riskPerTradePct: params.riskPerTradePct });
  const result = {
    id: id("bt"),
    status: "ok",
    symbol,
    timeframe,
    candles: candles.length,
    strategyId: strategy.id,
    params: { ...stratParams, stopLossPct: Number(params.stopLossPct || 2), takeProfitR: Number(params.takeProfitR || 2) },
    strategy: `${strategy.label} · ${JSON.stringify(stratParams)}`,
    regime: detectRegime(candles),
    ...metrics,
    createdAt: nowIso()
  };
  db.backtests ||= [];
  db.backtests.unshift(result);
  if (db.backtests.length > 50) db.backtests = db.backtests.slice(0, 50);
  appendAudit(db, `回测 ${symbol} ${timeframe} ${strategy.label}：${metrics.trades} 笔，胜率 ${metrics.winRatePct}%`, result.id, "BacktestEngine");
  appendTrace(db, "backtest", `${symbol} ${strategy.label}`, "ok");
  return result;
}
