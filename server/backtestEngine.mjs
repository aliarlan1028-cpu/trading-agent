import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

// ---------------------------------------------------------------------------
// 真实回测引擎：用历史 K 线逐根回放一个透明的均线交叉策略，
// 计算胜率、盈亏比、最大回撤、期望 R。用于"回测 → 模拟盘 → 小额实盘"三段验证的第一段。
// 不编造结果：没有足够 K 线就返回 insufficient_data。
// ---------------------------------------------------------------------------

function sma(values, period, index) {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += values[i];
  return sum / period;
}

export async function runBacktest(db, params = {}) {
  const symbol = String(params.symbol || "BTC/USDT").toUpperCase();
  const timeframe = params.timeframe || "1h";
  const limit = Math.min(Number(params.limit || 300), 500);
  const fastPeriod = Math.max(2, Number(params.fastPeriod || 10));
  const slowPeriod = Math.max(fastPeriod + 1, Number(params.slowPeriod || 30));
  const stopLossPct = Math.max(0.1, Number(params.stopLossPct || 2)) / 100;
  const takeProfitR = Math.max(0.5, Number(params.takeProfitR || 2));
  const riskPerTradePct = Math.max(0.05, Number(params.riskPerTradePct || 0.5));

  let candles = [];
  try {
    candles = await getHistoricalKlines(symbol, timeframe, limit);
  } catch (error) {
    return { status: "data_fetch_failed", error: error.message, symbol, timeframe };
  }
  if (!Array.isArray(candles) || candles.length < slowPeriod + 5) {
    return { status: "insufficient_data", got: candles?.length || 0, need: slowPeriod + 5, symbol, timeframe };
  }

  const closes = candles.map((c) => Number(c.close));
  const trades = [];
  let position = null; // { entry, stop, tp, entryIndex }

  for (let i = slowPeriod; i < candles.length; i += 1) {
    const fastPrev = sma(closes, fastPeriod, i - 1);
    const slowPrev = sma(closes, slowPeriod, i - 1);
    const fastNow = sma(closes, fastPeriod, i);
    const slowNow = sma(closes, slowPeriod, i);
    if (fastPrev === null || slowPrev === null || fastNow === null || slowNow === null) continue;

    const bar = candles[i];
    // 管理已有多头
    if (position) {
      const hitStop = Number(bar.low) <= position.stop;
      const hitTp = Number(bar.high) >= position.tp;
      let exitPrice = null;
      let reason = null;
      if (hitStop && hitTp) { exitPrice = position.stop; reason = "stop_first_assumed"; } // 保守：同一根内假设先触止损
      else if (hitStop) { exitPrice = position.stop; reason = "stop"; }
      else if (hitTp) { exitPrice = position.tp; reason = "take_profit"; }
      if (exitPrice !== null) {
        const rMultiple = (exitPrice - position.entry) / (position.entry - position.stop);
        const pnlPct = ((exitPrice - position.entry) / position.entry) * 100;
        trades.push({ entry: position.entry, exit: exitPrice, rMultiple: Number(rMultiple.toFixed(3)), pnlPct: Number(pnlPct.toFixed(3)), reason, bars: i - position.entryIndex });
        position = null;
      }
    }
    // 金叉开多（无持仓时）
    const goldenCross = fastPrev <= slowPrev && fastNow > slowNow;
    if (!position && goldenCross && i + 1 < candles.length) {
      const entry = Number(candles[i + 1].open);
      const stop = entry * (1 - stopLossPct);
      const tp = entry + takeProfitR * (entry - stop);
      position = { entry, stop, tp, entryIndex: i + 1 };
    }
  }

  // 用最后收盘价结算未平仓交易
  if (position) {
    const exitPrice = closes[closes.length - 1];
    const rMultiple = (exitPrice - position.entry) / (position.entry - position.stop);
    const pnlPct = ((exitPrice - position.entry) / position.entry) * 100;
    trades.push({ entry: position.entry, exit: exitPrice, rMultiple: Number(rMultiple.toFixed(3)), pnlPct: Number(pnlPct.toFixed(3)), reason: "mark_to_market", bars: closes.length - 1 - position.entryIndex });
  }

  const metrics = summarize(trades, riskPerTradePct);
  const result = {
    id: id("bt"),
    status: "ok",
    symbol,
    timeframe,
    candles: candles.length,
    params: { fastPeriod, slowPeriod, stopLossPct: stopLossPct * 100, takeProfitR, riskPerTradePct },
    strategy: `SMA(${fastPeriod}/${slowPeriod}) 金叉开多，止损 ${(stopLossPct * 100).toFixed(1)}%，止盈 ${takeProfitR}R`,
    ...metrics,
    createdAt: nowIso()
  };
  db.backtests ||= [];
  db.backtests.unshift(result);
  if (db.backtests.length > 50) db.backtests = db.backtests.slice(0, 50);
  appendAudit(db, `运行回测 ${symbol} ${timeframe}：${metrics.trades} 笔，胜率 ${metrics.winRatePct}%`, result.id, "BacktestEngine");
  appendTrace(db, "backtest", `${symbol} ${result.strategy}`, "ok");
  return result;
}

function summarize(trades, riskPerTradePct) {
  const count = trades.length;
  if (!count) {
    return { trades: 0, winRatePct: null, profitFactor: null, maxDrawdownPct: null, expectancyR: null, netReturnPct: 0, equityCurve: [], note: "样本期内无交易信号" };
  }
  const wins = trades.filter((t) => t.rMultiple > 0);
  const grossWin = wins.reduce((sum, t) => sum + t.rMultiple, 0);
  const grossLoss = Math.abs(trades.filter((t) => t.rMultiple <= 0).reduce((sum, t) => sum + t.rMultiple, 0));
  const expectancyR = trades.reduce((sum, t) => sum + t.rMultiple, 0) / count;

  // 复利权益曲线：每笔按风险预算 riskPerTradePct 兑现 R 倍。
  let equity = 100;
  let peak = 100;
  let maxDd = 0;
  const equityCurve = [Number(equity.toFixed(2))];
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
