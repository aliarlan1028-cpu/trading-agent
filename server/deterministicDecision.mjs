// 确定性决策核心 —— LLM 未配置/出错时的兜底，也可作为 LLM 计划的方向护栏。
// 借鉴对方 okx-agent 的「纯函数决策」范式，但用我们真实的多源信号，而不是隐藏魔数：
//   动量(24h 涨跌) · 资金费率(拥挤/反向) · 订单簿失衡 · 聪明钱大户多空比
// 契约：纯函数、无副作用、可单测。缺数据的因子按中性(50)处理并在 reasons 注明，绝不编造。
// 输出方向/置信度/结构化计划，或在证据不足/风控不过时给 observe（不下计划）。

// —— 具名权重与阈值（透明、可审计，非隐藏魔数）——
export const WEIGHTS = { momentum: 0.32, funding: 0.20, book: 0.20, smartMoney: 0.28 };
export const THRESHOLDS = {
  longNet: 60,          // 融合分 ≥ 此值 → 做多候选
  shortNet: 40,         // 融合分 ≤ 此值 → 做空候选
  minConfidence: 60,    // 低于此置信度只观望
  smartLong: 1.05,      // 大户多空比 ≥ 此值偏多（与全端 smartMoneyBias 同口径）
  smartShort: 0.95,     // ≤ 此值偏空
  extremeFundingAbs: 0.0005 // |资金费率| 超过此值视为拥挤，反向计分
};
export const DEFAULTS = { stopPct: 0.015, rr: [1.5, 2.5], leverageCap: 3, riskPct: 0.3 };

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function momentumScore(changePct) {
  const c = num(changePct);
  if (c === null) return { score: 50, note: "缺 24h 涨跌，动量中性" };
  // 每 1% 涨跌 ≈ 6 分，封顶 ±30；温和线性、可解释。
  return { score: clamp(50 + c * 6), note: null };
}
function fundingScore(fundingRate, changePct) {
  const f = num(fundingRate);
  if (f === null) return { score: 50, note: "缺资金费率，微观中性" };
  // 极端资金费率=多空拥挤，给反向修正（正费率过高→偏空修正，反之）。
  if (Math.abs(f) <= THRESHOLDS.extremeFundingAbs) return { score: 50, note: null };
  const penalty = Math.min(Math.abs(f) * 20000, 24);
  return { score: clamp(50 - Math.sign(f) * penalty), note: `资金费率拥挤(${f})，反向修正` };
}
function bookScore(bookImbalancePct) {
  const b = num(bookImbalancePct);
  if (b === null) return { score: 50, note: "缺订单簿失衡，盘口中性" };
  // 50% 为均衡，每偏离 1pp ≈ 1.4 分。
  return { score: clamp(50 + (b - 50) * 1.4), note: null };
}
function smartMoneyScore(ratio) {
  const r = num(ratio);
  if (r === null) return { score: 50, note: "缺大户多空比，聪明钱中性" };
  if (r >= THRESHOLDS.smartLong) return { score: clamp(50 + Math.min((r - 1) * 60, 30)), note: null };
  if (r <= THRESHOLDS.smartShort) return { score: clamp(50 - Math.min((1 - r) * 60, 30)), note: null };
  return { score: 50, note: null };
}

function buildPlan(price, direction, mandate, atrPct) {
  const stopPct = num(atrPct) && atrPct > 0 ? Math.min(Math.max(atrPct, 0.006), 0.05) : DEFAULTS.stopPct;
  const long = direction === "long";
  const stopDist = price * stopPct;
  const entryLow = long ? price * (1 - stopPct * 0.3) : price * (1 - stopPct * 0.2);
  const entryHigh = long ? price * (1 + stopPct * 0.2) : price * (1 + stopPct * 0.3);
  const stop = long ? price - stopDist : price + stopDist;
  const targets = DEFAULTS.rr.map((rr) => (long ? price + stopDist * rr : price - stopDist * rr));
  const ceilingRisk = num(mandate?.maxSingleTradeRiskPct);
  const riskPct = ceilingRisk != null ? Math.min(ceilingRisk, DEFAULTS.riskPct) : DEFAULTS.riskPct;
  const maxLev = num(mandate?.max_leverage) || num(mandate?.maxLeverage) || DEFAULTS.leverageCap;
  const minLev = num(mandate?.min_leverage) || num(mandate?.minLeverage) || 1;
  // 杠杆落在授权区间 [minLev, maxLev] 内:默认取保守档(leverageCap),但不低于用户设的下限。
  const lev = Math.max(minLev, Math.min(maxLev, DEFAULTS.leverageCap));
  return {
    direction,
    entryLow: Number(entryLow.toFixed(8)),
    entryHigh: Number(entryHigh.toFixed(8)),
    stopLoss: Number(stop.toFixed(8)),
    takeProfits: targets.map((t) => Number(t.toFixed(8))),
    leverage: lev,
    riskPercent: riskPct,
    riskReward: DEFAULTS.rr[0],
    stopPct: Number(stopPct.toFixed(4))
  };
}

// market: { symbol, price, changePct, fundingRate, bookImbalancePct, atrPct? }
// smartMoney: { topTraderLongShortRatio } | null   mandate: 活跃授权 | null
export function deterministicDecision({ market = {}, smartMoney = null, mandate = null } = {}) {
  const reasons = [];
  const price = num(market.price);
  if (!price || price <= 0) {
    return { direction: "observe", confidence: 0, scores: {}, plan: null, reasons: ["缺实时价格，无法决策"], deterministic: true };
  }
  const m = momentumScore(market.changePct); if (m.note) reasons.push(m.note);
  const f = fundingScore(market.fundingRate, market.changePct); if (f.note) reasons.push(f.note);
  const b = bookScore(market.bookImbalancePct); if (b.note) reasons.push(b.note);
  const s = smartMoneyScore(smartMoney?.topTraderLongShortRatio); if (s.note) reasons.push(s.note);
  const scores = { momentum: m.score, funding: f.score, book: b.score, smartMoney: s.score };
  const net = clamp(m.score * WEIGHTS.momentum + f.score * WEIGHTS.funding + b.score * WEIGHTS.book + s.score * WEIGHTS.smartMoney);

  let direction = net >= THRESHOLDS.longNet ? "long" : net <= THRESHOLDS.shortNet ? "short" : "observe";
  const confidence = clamp(Math.round(Math.abs(net - 50) * 1.6 + 50));

  // 证据不足或方向不明 → 只观望，不下计划（诚实优先，不硬凑方向）。
  if (direction === "observe") reasons.push(`多源融合分 ${Math.round(net)} 落在中性区(${THRESHOLDS.shortNet}~${THRESHOLDS.longNet})，方向不明`);
  if (direction !== "observe" && confidence < THRESHOLDS.minConfidence) {
    reasons.push(`置信度 ${confidence} 未达 ${THRESHOLDS.minConfidence}，转观望`);
    direction = "observe";
  }
  const plan = direction === "observe" ? null : buildPlan(price, direction, mandate, market.atrPct);
  return {
    symbol: market.symbol || null,
    direction,
    confidence,
    scores,
    net: Math.round(net),
    plan,
    reasons,
    deterministic: true,
    generatedAt: null // 由调用方盖时间戳（保持纯函数）
  };
}
