// ---------------------------------------------------------------------------
// 策略库：每个策略把历史 K 线转成"开多信号数组"（第 i 根是否触发入场）。
// 出场统一交给回测引擎的止损/止盈-R 模型，保证跨策略可比。
// 每个策略带一个参数网格，供优化器做样本外寻优。
// ---------------------------------------------------------------------------

function sma(closes, period, index) {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += closes[i];
  return sum / period;
}

function rsiSeries(closes, period) {
  const rsi = new Array(closes.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return rsi;
}

// 笛卡尔积生成参数网格
function grid(spec) {
  const keys = Object.keys(spec);
  let combos = [{}];
  for (const key of keys) {
    const next = [];
    for (const combo of combos) {
      for (const value of spec[key]) next.push({ ...combo, [key]: value });
    }
    combos = next;
  }
  return combos;
}

export const STRATEGIES = {
  trend: {
    id: "trend",
    label: "趋势跟随（均线交叉）",
    defaultParams: { fast: 10, slow: 30 },
    paramGrid: grid({ fast: [8, 10, 20], slow: [30, 50, 100] }).filter((p) => p.fast < p.slow),
    signals(candles, params = {}) {
      const fast = Math.max(2, Number(params.fast || 10));
      const slow = Math.max(fast + 1, Number(params.slow || 30));
      const closes = candles.map((c) => Number(c.close));
      return candles.map((_, i) => {
        if (i < slow) return false;
        const fPrev = sma(closes, fast, i - 1);
        const sPrev = sma(closes, slow, i - 1);
        const fNow = sma(closes, fast, i);
        const sNow = sma(closes, slow, i);
        return fPrev !== null && sPrev !== null && fPrev <= sPrev && fNow > sNow;
      });
    }
  },
  meanrev: {
    id: "meanrev",
    label: "均值回归（RSI 超卖反弹）",
    defaultParams: { period: 14, oversold: 30 },
    paramGrid: grid({ period: [14], oversold: [25, 30, 35] }),
    signals(candles, params = {}) {
      const period = Math.max(2, Number(params.period || 14));
      const oversold = Number(params.oversold || 30);
      const closes = candles.map((c) => Number(c.close));
      const rsi = rsiSeries(closes, period);
      return candles.map((_, i) => {
        if (i < period + 1 || rsi[i] === null || rsi[i - 1] === null) return false;
        return rsi[i - 1] < oversold && rsi[i] >= oversold;
      });
    }
  },
  breakout: {
    id: "breakout",
    label: "突破（唐奇安通道）",
    defaultParams: { lookback: 20 },
    paramGrid: grid({ lookback: [20, 40, 55] }),
    signals(candles, params = {}) {
      const lookback = Math.max(5, Number(params.lookback || 20));
      return candles.map((candle, i) => {
        if (i < lookback) return false;
        let priorHigh = -Infinity;
        for (let j = i - lookback; j < i; j += 1) priorHigh = Math.max(priorHigh, Number(candles[j].high));
        return Number(candle.close) > priorHigh;
      });
    }
  }
};

export function getStrategy(id) {
  return STRATEGIES[id] || STRATEGIES.trend;
}

export function listStrategies() {
  return Object.values(STRATEGIES).map((s) => ({ id: s.id, label: s.label, defaultParams: s.defaultParams }));
}

// 简单行情 regime 判定（用于策略画像标注）
export function detectRegime(candles) {
  if (!candles || candles.length < 20) return "样本不足";
  const closes = candles.map((c) => Number(c.close));
  const first = closes[0];
  const last = closes[closes.length - 1];
  const change = ((last - first) / first) * 100;
  const returns = [];
  for (let i = 1; i < closes.length; i += 1) returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const vol = Math.sqrt(returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length) * 100;
  if (vol >= 3) return change >= 0 ? "高波动上行" : "高波动下行";
  if (Math.abs(change) < 3) return "震荡";
  return change >= 0 ? "温和上行" : "温和下行";
}
