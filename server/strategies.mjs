import { assertNativeStrategyContracts, buildNativeStrategyContract } from "./strategyContracts.mjs";

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

function emaSeries(closes, period) {
  const k = 2 / (period + 1);
  const out = new Array(closes.length).fill(null);
  let ema;
  for (let i = 0; i < closes.length; i += 1) {
    ema = i === 0 ? closes[0] : closes[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

function rollingStd(closes, period, index) {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += closes[i];
  const mean = sum / period;
  let variance = 0;
  for (let i = index - period + 1; i <= index; i += 1) variance += (closes[i] - mean) ** 2;
  return Math.sqrt(variance / period);
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

function trueRange(candles, i) {
  const h = Number(candles[i].high);
  const l = Number(candles[i].low);
  if (i === 0) return h - l;
  const pc = Number(candles[i - 1].close);
  return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
}

// ATR（Wilder 平滑），前 period 根返回 null。
function atrSeries(candles, period) {
  const tr = candles.map((_, i) => trueRange(candles, i));
  const out = new Array(candles.length).fill(null);
  let atr = null;
  for (let i = 0; i < candles.length; i += 1) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j += 1) sum += tr[j];
      atr = sum / period;
    } else {
      atr = (atr * (period - 1) + tr[i]) / period;
    }
    out[i] = atr;
  }
  return out;
}

function volSma(volumes, period, index) {
  if (index + 1 < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += volumes[i];
  return sum / period;
}

export const STRATEGIES = {
  trend: {
    id: "trend",
    label: "趋势跟随（均线交叉）",
    family: "trend",
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
    family: "meanrev",
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
    family: "trend",
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
  },
  macd: {
    id: "macd",
    label: "MACD 金叉（趋势动量）",
    family: "trend",
    defaultParams: { fast: 12, slow: 26, signal: 9 },
    paramGrid: grid({ fast: [8, 12], slow: [21, 26], signal: [9] }).filter((p) => p.fast < p.slow),
    signals(candles, params = {}) {
      const fast = Math.max(2, Number(params.fast || 12));
      const slow = Math.max(fast + 1, Number(params.slow || 26));
      const signalPeriod = Math.max(2, Number(params.signal || 9));
      const closes = candles.map((c) => Number(c.close));
      const emaFast = emaSeries(closes, fast);
      const emaSlow = emaSeries(closes, slow);
      const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
      const signalLine = emaSeries(macdLine, signalPeriod);
      return candles.map((_, i) => {
        if (i < slow + signalPeriod) return false;
        return macdLine[i - 1] <= signalLine[i - 1] && macdLine[i] > signalLine[i];
      });
    }
  },
  bollinger: {
    id: "bollinger",
    label: "布林带下轨反弹（均值回归）",
    family: "meanrev",
    defaultParams: { period: 20, k: 2 },
    paramGrid: grid({ period: [20], k: [1.5, 2, 2.5] }),
    signals(candles, params = {}) {
      const period = Math.max(5, Number(params.period || 20));
      const k = Number(params.k || 2);
      const closes = candles.map((c) => Number(c.close));
      return candles.map((_, i) => {
        if (i < period) return false;
        const stdPrev = rollingStd(closes, period, i - 1);
        const stdNow = rollingStd(closes, period, i);
        if (stdPrev === null || stdNow === null) return false;
        let sumPrev = 0;
        let sumNow = 0;
        for (let j = i - period; j < i; j += 1) sumPrev += closes[j];
        for (let j = i - period + 1; j <= i; j += 1) sumNow += closes[j];
        const lowerPrev = sumPrev / period - k * stdPrev;
        const lowerNow = sumNow / period - k * stdNow;
        return closes[i - 1] < lowerPrev && closes[i] >= lowerNow;
      });
    }
  },

  // ---- 做空族 ----
  death_cross: {
    id: "death_cross",
    label: "死叉做空（均线下穿）",
    family: "trend",
    direction: "short",
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
        return fPrev !== null && sPrev !== null && fPrev >= sPrev && fNow < sNow;
      });
    }
  },
  rsi_short: {
    id: "rsi_short",
    label: "RSI 超买回落（做空）",
    family: "meanrev",
    direction: "short",
    defaultParams: { period: 14, overbought: 70 },
    paramGrid: grid({ period: [14], overbought: [65, 70, 75] }),
    signals(candles, params = {}) {
      const period = Math.max(2, Number(params.period || 14));
      const overbought = Number(params.overbought || 70);
      const closes = candles.map((c) => Number(c.close));
      const rsi = rsiSeries(closes, period);
      return candles.map((_, i) => {
        if (i < period + 1 || rsi[i] === null || rsi[i - 1] === null) return false;
        return rsi[i - 1] > overbought && rsi[i] <= overbought;
      });
    }
  },
  breakdown: {
    id: "breakdown",
    label: "唐奇安下破（做空）",
    family: "trend",
    direction: "short",
    defaultParams: { lookback: 20 },
    paramGrid: grid({ lookback: [20, 40, 55] }),
    signals(candles, params = {}) {
      const lookback = Math.max(5, Number(params.lookback || 20));
      return candles.map((candle, i) => {
        if (i < lookback) return false;
        let priorLow = Infinity;
        for (let j = i - lookback; j < i; j += 1) priorLow = Math.min(priorLow, Number(candles[j].low));
        return Number(candle.close) < priorLow;
      });
    }
  },

  // ---- 高级趋势 / 突破 ----
  supertrend: {
    id: "supertrend",
    label: "Supertrend（ATR 趋势翻多）",
    family: "trend",
    direction: "long",
    defaultParams: { period: 10, mult: 3 },
    paramGrid: grid({ period: [10, 14], mult: [2, 3] }),
    signals(candles, params = {}) {
      const period = Math.max(2, Number(params.period || 10));
      const mult = Number(params.mult || 3);
      const atr = atrSeries(candles, period);
      const out = new Array(candles.length).fill(false);
      let finalUpper = null;
      let finalLower = null;
      let trend = 1;
      for (let i = 1; i < candles.length; i += 1) {
        if (atr[i] === null) continue;
        const hl2 = (Number(candles[i].high) + Number(candles[i].low)) / 2;
        const basicUpper = hl2 + mult * atr[i];
        const basicLower = hl2 - mult * atr[i];
        const prevClose = Number(candles[i - 1].close);
        finalUpper = finalUpper === null || basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
        finalLower = finalLower === null || basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;
        const prevTrend = trend;
        const close = Number(candles[i].close);
        if (trend === 1 && close < finalLower) trend = -1;
        else if (trend === -1 && close > finalUpper) trend = 1;
        if (prevTrend === -1 && trend === 1) out[i] = true; // 翻多入场
      }
      return out;
    }
  },
  vol_breakout: {
    id: "vol_breakout",
    label: "量价确认突破",
    family: "trend",
    direction: "long",
    defaultParams: { lookback: 20, volMult: 1.5 },
    paramGrid: grid({ lookback: [20, 40], volMult: [1.3, 1.5, 2] }),
    signals(candles, params = {}) {
      const lookback = Math.max(5, Number(params.lookback || 20));
      const volMult = Number(params.volMult || 1.5);
      const vols = candles.map((c) => Number(c.volume || 0));
      return candles.map((candle, i) => {
        if (i < lookback) return false;
        let priorHigh = -Infinity;
        for (let j = i - lookback; j < i; j += 1) priorHigh = Math.max(priorHigh, Number(candles[j].high));
        const va = volSma(vols, lookback, i - 1);
        return va !== null && va > 0 && Number(candle.close) > priorHigh && vols[i] > volMult * va;
      });
    }
  },
  squeeze: {
    id: "squeeze",
    label: "布林挤压突破",
    family: "trend",
    direction: "long",
    defaultParams: { period: 20, k: 2, squeeze: 0.04 },
    paramGrid: grid({ period: [20], k: [2], squeeze: [0.03, 0.04, 0.05] }),
    signals(candles, params = {}) {
      const period = Math.max(5, Number(params.period || 20));
      const k = Number(params.k || 2);
      const squeeze = Number(params.squeeze || 0.04);
      const closes = candles.map((c) => Number(c.close));
      const meanAt = (idx) => {
        let sum = 0;
        for (let j = idx - period + 1; j <= idx; j += 1) sum += closes[j];
        return sum / period;
      };
      return candles.map((_, i) => {
        if (i < period + 1) return false;
        const std = rollingStd(closes, period, i);
        const stdPrev = rollingStd(closes, period, i - 1);
        if (std === null || stdPrev === null) return false;
        const midPrev = meanAt(i - 1);
        const midNow = meanAt(i);
        const bandwidthPrev = midPrev ? (2 * k * stdPrev) / midPrev : Infinity;
        const upperNow = midNow + k * std;
        const upperPrev = midPrev + k * stdPrev;
        return bandwidthPrev < squeeze && closes[i] > upperNow && closes[i - 1] <= upperPrev;
      });
    }
  },

  // ---- 背离类 ----
  rsi_bull_div: {
    id: "rsi_bull_div",
    label: "RSI 底背离（做多）",
    family: "meanrev",
    direction: "long",
    defaultParams: { period: 14, lookback: 20 },
    paramGrid: grid({ period: [14], lookback: [15, 20, 30] }),
    signals(candles, params = {}) {
      const period = Math.max(2, Number(params.period || 14));
      const lookback = Math.max(6, Number(params.lookback || 20));
      const closes = candles.map((c) => Number(c.close));
      const rsi = rsiSeries(closes, period);
      return candles.map((_, i) => {
        if (i < lookback + period) return false;
        let minIdx = i - lookback;
        for (let j = i - lookback; j <= i - 2; j += 1) if (closes[j] < closes[minIdx]) minIdx = j;
        return closes[i] < closes[minIdx] && rsi[i] !== null && rsi[minIdx] !== null && rsi[i] > rsi[minIdx];
      });
    }
  },
  rsi_bear_div: {
    id: "rsi_bear_div",
    label: "RSI 顶背离（做空）",
    family: "meanrev",
    direction: "short",
    defaultParams: { period: 14, lookback: 20 },
    paramGrid: grid({ period: [14], lookback: [15, 20, 30] }),
    signals(candles, params = {}) {
      const period = Math.max(2, Number(params.period || 14));
      const lookback = Math.max(6, Number(params.lookback || 20));
      const closes = candles.map((c) => Number(c.close));
      const rsi = rsiSeries(closes, period);
      return candles.map((_, i) => {
        if (i < lookback + period) return false;
        let maxIdx = i - lookback;
        for (let j = i - lookback; j <= i - 2; j += 1) if (closes[j] > closes[maxIdx]) maxIdx = j;
        return closes[i] > closes[maxIdx] && rsi[i] !== null && rsi[maxIdx] !== null && rsi[i] < rsi[maxIdx];
      });
    }
  }
};

// 行情 regime → 偏好的策略家族。趋势市用趋势/突破，震荡市用均值回归。
export function regimePreferredFamilies(regime) {
  const r = String(regime || "");
  if (r.includes("震荡")) return ["meanrev"];
  if (r.includes("上行") || r.includes("下行") || r.includes("趋势")) return ["trend"];
  return ["trend", "meanrev"];
}

export function strategyMatchesRegime(strategy, regime) {
  const preferred = regimePreferredFamilies(regime);
  if (!preferred.includes(strategy?.family)) return false;
  const value = String(regime || "");
  const direction = strategy?.direction || "long";
  if (value.includes("上行") && direction === "short") return false;
  if (value.includes("下行") && direction === "long") return false;
  return true;
}

export function getStrategy(id) {
  return STRATEGIES[id] || STRATEGIES.trend;
}

export function listStrategies() {
  const strategies = Object.values(STRATEGIES);
  assertNativeStrategyContracts(strategies);
  return strategies.map((strategy) => ({
    id: strategy.id,
    label: strategy.label,
    family: strategy.family,
    direction: strategy.direction || "long",
    defaultParams: strategy.defaultParams,
    contract: buildNativeStrategyContract(strategy)
  }));
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
