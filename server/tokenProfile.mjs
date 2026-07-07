// ---------------------------------------------------------------------------
// 每个交易对的"波动 + 统计性格"画像（全部基于可验证统计，不玄学）。
//   - 已实现波动率、ATR 百分位（当前波动处于自身历史什么位置）
//   - Hurst 指数 / 方差比 / 一阶自相关 → 该币此刻更像"趋势型"还是"均值回归型"
//   - 典型趋势时长、放量基线
// 用来：让策略研究优先选对应家族、给风控定波动预算、给 Agent 判"用什么打法"。
// 数据只来自历史 K 线，庄家行为改用真实持仓/订单流数据（marketSignals），不从 K 线猜。
// ---------------------------------------------------------------------------
import { getHistoricalKlines } from "./exchangeConnector.mjs";
import { nowIso } from "./store.mjs";

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}
function logReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i += 1) {
    if (closes[i] > 0 && closes[i - 1] > 0) r.push(Math.log(closes[i] / closes[i - 1]));
  }
  return r;
}

// Hurst 指数（R/S 分析）：>0.5 惯性/趋势；<0.5 均值回归；≈0.5 随机游走。
function hurstRS(returns) {
  const N = returns.length;
  if (N < 64) return null;
  const sizes = [];
  for (let n = 8; n <= Math.floor(N / 2); n = Math.floor(n * 1.7)) sizes.push(n);
  const xs = [];
  const ys = [];
  for (const n of sizes) {
    const chunks = Math.floor(N / n);
    let rsSum = 0;
    let cnt = 0;
    for (let c = 0; c < chunks; c += 1) {
      const seg = returns.slice(c * n, (c + 1) * n);
      const m = mean(seg);
      let cum = 0;
      let lo = Infinity;
      let hi = -Infinity;
      for (const x of seg) { cum += x - m; lo = Math.min(lo, cum); hi = Math.max(hi, cum); }
      const R = hi - lo;
      const S = std(seg);
      if (S > 0 && R > 0) { rsSum += R / S; cnt += 1; }
    }
    if (cnt > 0) { xs.push(Math.log(n)); ys.push(Math.log(rsSum / cnt)); }
  }
  if (xs.length < 3) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den > 0 ? Number((num / den).toFixed(3)) : null;
}

// 方差比 VR(k)：>1 趋势/惯性，<1 均值回归。
function varianceRatio(returns, k) {
  const N = returns.length;
  const v1 = std(returns) ** 2;
  if (v1 === 0 || N < k * 4) return null;
  const kr = [];
  for (let i = 0; i + k <= N; i += 1) {
    let s = 0;
    for (let j = 0; j < k; j += 1) s += returns[i + j];
    kr.push(s);
  }
  const vk = std(kr) ** 2;
  return Number((vk / (k * v1)).toFixed(3));
}

function lag1Autocorr(returns) {
  if (returns.length < 5) return null;
  const m = mean(returns);
  let num = 0;
  let den = 0;
  for (let i = 1; i < returns.length; i += 1) num += (returns[i] - m) * (returns[i - 1] - m);
  for (let i = 0; i < returns.length; i += 1) den += (returns[i] - m) ** 2;
  return den > 0 ? Number((num / den).toFixed(3)) : null;
}

function atrSeries(candles, period) {
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

function percentileOf(sortedAsc, value) {
  let below = 0;
  for (const x of sortedAsc) { if (x <= value) below += 1; else break; }
  return Math.round((below / sortedAsc.length) * 100);
}

// 平均趋势"游程"：连续同向收盘的平均长度（越长越有惯性）。
function avgRunLength(closes) {
  let runs = 0;
  let len = 0;
  let total = 0;
  let dir = 0;
  for (let i = 1; i < closes.length; i += 1) {
    const d = Math.sign(closes[i] - closes[i - 1]);
    if (d === 0) continue;
    if (d === dir) { len += 1; } else { if (dir !== 0) { runs += 1; total += len; } dir = d; len = 1; }
  }
  if (dir !== 0) { runs += 1; total += len; }
  return runs ? Number((total / runs).toFixed(2)) : null;
}

const BARS_PER_YEAR = { "5m": 105120, "15m": 35040, "1h": 8760, "4h": 2190, "1d": 365 };

export function buildTokenProfile(candles, timeframe = "1h") {
  if (!Array.isArray(candles) || candles.length < 80) return { ok: false, reason: "K 线不足" };
  const closes = candles.map((c) => Number(c.close));
  const returns = logReturns(closes);
  const perBarVol = std(returns);
  const annualized = perBarVol * Math.sqrt(BARS_PER_YEAR[timeframe] || 8760);

  const atr = atrSeries(candles, 14).filter((x) => x != null);
  const curAtr = atr[atr.length - 1] ?? null;
  const atrPct = curAtr != null && curAtr > 0 ? (curAtr / closes[closes.length - 1]) * 100 : null;
  const atrSorted = [...atr].sort((a, b) => a - b);
  const atrPercentile = curAtr != null ? percentileOf(atrSorted, curAtr) : null;

  const hurst = hurstRS(returns);
  const vr = varianceRatio(returns, 5);
  const ac1 = lag1Autocorr(returns);
  const runLen = avgRunLength(closes);

  // 性格综合投票：Hurst / 方差比 / 自相关 三票。
  let trendVotes = 0;
  let mrVotes = 0;
  if (hurst != null) { if (hurst > 0.55) trendVotes += 1; else if (hurst < 0.45) mrVotes += 1; }
  if (vr != null) { if (vr > 1.1) trendVotes += 1; else if (vr < 0.9) mrVotes += 1; }
  if (ac1 != null) { if (ac1 > 0.05) trendVotes += 1; else if (ac1 < -0.05) mrVotes += 1; }
  const character = trendVotes > mrVotes ? "trend" : mrVotes > trendVotes ? "meanrev" : "mixed";
  const preferredFamily = character === "trend" ? "trend" : character === "meanrev" ? "meanrev" : null;

  const volState = atrPercentile == null ? "unknown" : atrPercentile >= 70 ? "high" : atrPercentile <= 30 ? "low" : "normal";

  const characterCn = character === "trend" ? "趋势型（惯性强，宜顺势/突破）" : character === "meanrev" ? "均值回归型（爱回归，宜低买高卖/反弹）" : "混合型（无明显偏向，看 regime 定）";
  const volCn = volState === "high" ? "当前波动偏高（收紧仓位、放宽止损）" : volState === "low" ? "当前波动偏低（可能酝酿变盘）" : volState === "normal" ? "波动正常" : "波动未知";
  const interpretation = `性格：${characterCn}；${volCn}（ATR ${atrPct != null ? atrPct.toFixed(2) : "-"}%，处历史 ${atrPercentile ?? "-"} 百分位）；年化波动 ${(annualized * 100).toFixed(0)}%；Hurst ${hurst ?? "-"}、方差比 ${vr ?? "-"}、平均游程 ${runLen ?? "-"} 根。`;

  return {
    ok: true,
    timeframe,
    bars: candles.length,
    realizedVolPerBarPct: Number((perBarVol * 100).toFixed(3)),
    annualizedVolPct: Number((annualized * 100).toFixed(1)),
    atrPct: atrPct != null ? Number(atrPct.toFixed(3)) : null,
    atrPercentile,
    volState,
    hurst,
    varianceRatio: vr,
    lag1Autocorr: ac1,
    avgRunLength: runLen,
    character,
    preferredFamily,
    interpretation,
    builtAt: nowIso()
  };
}

export async function fetchTokenProfile(symbol = "BTC/USDT", timeframe = "1h", limit = 1000) {
  const candles = await getHistoricalKlines(String(symbol).toUpperCase(), timeframe, Math.min(Number(limit) || 1000, 3000));
  return { symbol: String(symbol).toUpperCase(), ...buildTokenProfile(candles, timeframe) };
}
