import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { detectRegime, getStrategy } from "./strategies.mjs";
import { appendAudit, appendTrace, id, nowIso } from "./store.mjs";

export const BAR_MINUTES = { "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };

// ---------------------------------------------------------------------------
// 回测引擎：给定入场信号，用统一的止损/止盈-R 出场模型逐根回放，
// 计算胜率、盈亏比、最大回撤、期望 R。入场信号来自策略库（strategies.mjs）。
// simulate 是纯函数（不取数、不写库），供优化器在内存里跑成百上千次组合。
// ---------------------------------------------------------------------------

// True Range → ATR（Wilder），用于自适应止损。
function atrAt(candles, period) {
  const out = new Array(candles.length).fill(null);
  let atr = null;
  for (let i = 0; i < candles.length; i += 1) {
    const h = Number(candles[i].high);
    const l = Number(candles[i].low);
    const tr = i === 0 ? h - l : Math.max(h - l, Math.abs(h - Number(candles[i - 1].close)), Math.abs(l - Number(candles[i - 1].close)));
    if (i < period - 1) continue;
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j <= i; j += 1) {
        const hh = Number(candles[j].high);
        const ll = Number(candles[j].low);
        sum += j === 0 ? hh - ll : Math.max(hh - ll, Math.abs(hh - Number(candles[j - 1].close)), Math.abs(ll - Number(candles[j - 1].close)));
      }
      atr = sum / period;
    } else {
      atr = (atr * (period - 1) + tr) / period;
    }
    out[i] = atr;
  }
  return out;
}

// 纯回测核心：candles + 入场信号数组 → 指标。
// 计入真实成本（taker 手续费 + 滑点 + 资金费率）与可选 ATR 自适应止损。
export function simulate(candles, entrySignals, opts = {}) {
  const stopLossPct = Math.max(0.1, Number(opts.stopLossPct || 2)) / 100;
  const takeProfitR = Math.max(0.5, Number(opts.takeProfitR || 2));
  const riskPerTradePct = Math.max(0.05, Number(opts.riskPerTradePct || 0.5));
  const isShort = String(opts.direction || "long") === "short";
  // 成本模型（单边百分比）：默认 OKX taker 0.05% + 滑点 0.03%；资金费率按每 8h 默认 0.01% 折算到持仓时长。
  const feePct = opts.feePct != null ? Number(opts.feePct) : 0.05;
  const slippagePct = opts.slippagePct != null ? Number(opts.slippagePct) : 0.03;
  const fundingPct8h = opts.fundingPct8h != null ? Number(opts.fundingPct8h) : 0.01;
  const barMinutes = Number(opts.barMinutes || 60);
  const roundTripCostPct = 2 * (feePct + slippagePct); // 进+出
  // ATR 自适应止损
  const useAtrStop = Boolean(opts.atrStop);
  const atrMult = Number(opts.atrMult || 2);
  const atr = useAtrStop ? atrAt(candles, Number(opts.atrPeriod || 14)) : null;

  const closes = candles.map((c) => Number(c.close));
  const trades = [];
  let position = null;

  const rGross = (exit, p) => (isShort ? (p.entry - exit) / (p.stop - p.entry) : (exit - p.entry) / (p.entry - p.stop));
  const pnlGross = (exit, p) => (isShort ? ((p.entry - exit) / p.entry) * 100 : ((exit - p.entry) / p.entry) * 100);

  const closeTrade = (exitPrice, reason, i) => {
    const barsHeld = i - position.entryIndex;
    const fundingCostPct = fundingPct8h * ((barsHeld * barMinutes) / 480); // 480 分钟 = 8h
    const totalCostPct = roundTripCostPct + fundingCostPct;
    const riskPct = (Math.abs(position.entry - position.stop) / position.entry) * 100; // 实际止损距离
    const netPnlPct = pnlGross(exitPrice, position) - totalCostPct;
    const grossR = rGross(exitPrice, position);
    const netR = riskPct > 0 ? grossR - totalCostPct / riskPct : grossR;
    trades.push({ rMultiple: Number(netR.toFixed(3)), pnlPct: Number(netPnlPct.toFixed(3)), reason, bars: barsHeld });
    position = null;
  };

  for (let i = 1; i < candles.length; i += 1) {
    const bar = candles[i];
    if (position) {
      const hitStop = isShort ? Number(bar.high) >= position.stop : Number(bar.low) <= position.stop;
      const hitTp = isShort ? Number(bar.low) <= position.tp : Number(bar.high) >= position.tp;
      if (hitStop && hitTp) {
        // OHLC 无法证明同一根 K 线内的真实路径。默认采用保守的止损先成交，
        // 避免用无法验证的路径假设抬高策略表现。
        closeTrade(position.stop, "stop_first_conservative", i);
      } else if (hitStop) closeTrade(position.stop, "stop", i);
      else if (hitTp) closeTrade(position.tp, "take_profit", i);
    }
    if (!position && entrySignals[i] && i + 1 < candles.length) {
      const entry = Number(candles[i + 1].open);
      let stopDist;
      if (useAtrStop && atr[i] != null) stopDist = atrMult * atr[i];
      else stopDist = entry * stopLossPct;
      const stop = isShort ? entry + stopDist : entry - stopDist;
      const tp = isShort ? entry - takeProfitR * stopDist : entry + takeProfitR * stopDist;
      position = { entry, stop, tp, entryIndex: i + 1 };
    }
  }
  if (position) closeTrade(closes[closes.length - 1], "mark_to_market", closes.length - 1);
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
  const varianceR = count > 1
    ? trades.reduce((sum, t) => sum + (t.rMultiple - expectancyR) ** 2, 0) / (count - 1)
    : 0;
  const expectancyStdErrR = Math.sqrt(varianceR / count);
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
    expectancyStdErrR: Number(expectancyStdErrR.toFixed(3)),
    expectancyLower90R: Number((expectancyR - 1.645 * expectancyStdErrR).toFixed(3)),
    netReturnPct: Number((equity - 100).toFixed(2)),
    avgHoldBars: Number((trades.reduce((sum, t) => sum + t.bars, 0) / count).toFixed(1)),
    equityCurve: equityCurve.slice(-60)
  };
}

// 单次回测（取数 + 跑一个策略 + 落库），供 UI/Agent 单独调用。
export async function runBacktest(db, params = {}) {
  const symbol = String(params.symbol || "BTC/USDT").toUpperCase();
  const timeframe = params.timeframe || "1h";
  const limit = Math.min(Number(params.limit || 2500), 3000);
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
  const metrics = simulate(candles, signals, {
    stopLossPct: params.stopLossPct,
    takeProfitR: params.takeProfitR,
    riskPerTradePct: params.riskPerTradePct,
    direction: strategy.direction,
    barMinutes: BAR_MINUTES[timeframe] || 60,
    feePct: params.feePct,
    slippagePct: params.slippagePct,
    fundingPct8h: params.fundingPct8h,
    atrStop: params.atrStop,
    atrMult: params.atrMult,
    atrPeriod: params.atrPeriod
  });
  const result = {
    id: id("bt"),
    status: "ok",
    symbol,
    timeframe,
    candles: candles.length,
    strategyId: strategy.id,
    direction: strategy.direction || "long",
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
