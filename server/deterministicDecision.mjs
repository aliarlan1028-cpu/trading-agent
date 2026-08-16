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
  extremeFundingAbs: 0.0005, // |资金费率| 超过此值视为拥挤，反向计分
  chaseHigh: 0.85,      // 区间位 ≥ 此值做多=追高末端
  chaseLow: 0.15,       // 区间位 ≤ 此值做空=追空末端
  chasePenalty: 18      // 追末端时置信度扣分(可能因此跌破 minConfidence 转观望)
};
// stopAtrMult: 止损=入场 ± 此倍真实 ATR(纪律 S4「按 ATR 放宽止损」);
// minStopPct/maxStopPct: 止损占价比的安全下/上限(防 ATR 异常小/大);
// pullbackAtr: 回调入场带宽度(顺势回调挂单,而非贴现价追单)。
export const DEFAULTS = { stopPct: 0.015, rr: [1.5, 2.5], leverageCap: 3, riskPct: 0.3, stopAtrMult: 2, minStopPct: 0.008, maxStopPct: 0.06, pullbackAtr: 0.6 };

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function momentumScore(changePct) {
  const c = num(changePct);
  if (c === null) return { score: 50, note: "缺 24h 涨跌，动量中性" };
  // 每 1% 涨跌 ≈ 6 分，封顶 ±30；温和线性、可解释。
  return { score: clamp(50 + c * 6), note: null };
}
function fundingScore(fundingRate) {
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

function buildPlan(price, direction, mandate, vol = {}) {
  const long = direction === "long";
  // 止损距离:优先用真实 ATR × 倍数(纪律 S4);无真实 ATR 时回落 atrPct 比例;都缺用默认。
  // 再用 [minStopPct, maxStopPct] 夹一层,防 ATR 异常极小(噪音里被扫)或极大(单笔风险失控)。
  const atr = num(vol.atr);
  const atrPct = num(vol.atrPct);
  const rawStopPct = atr && atr > 0 ? (atr * DEFAULTS.stopAtrMult) / price
    : (atrPct && atrPct > 0 ? atrPct : DEFAULTS.stopPct);
  const stopPct = Math.min(Math.max(rawStopPct, DEFAULTS.minStopPct), DEFAULTS.maxStopPct);
  const stopDist = price * stopPct;
  // 顺势回调入场带:做多把挂单区放在现价【下方】(等回撤买),做空放【上方】(等反抽卖),
  // 而不是贴现价追单——这是"不追末端"的入场侧实现。带宽 = pullbackAtr × 止损距离。
  const pull = DEFAULTS.pullbackAtr * stopDist;
  const entryLow = long ? price - pull : price;
  const entryHigh = long ? price : price + pull;
  // The invalidation distance belongs to the eventual entry, not the quote seen
  // when the plan is created. Anchoring it to `price` while moving the entry by
  // 0.6R silently reduced a filled pullback order to only 0.4R of protection.
  // Anchor SL/TP to the conservative edge of the band so every possible fill
  // retains at least the requested ATR distance and advertised R multiple.
  const stopAnchor = long ? entryLow : entryHigh;
  const stop = long ? stopAnchor - stopDist : stopAnchor + stopDist;
  const targetAnchor = long ? entryHigh : entryLow;
  const targets = DEFAULTS.rr.map((rr) => (long ? targetAnchor + stopDist * rr : targetAnchor - stopDist * rr));
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
  const f = fundingScore(market.fundingRate); if (f.note) reasons.push(f.note);
  const b = bookScore(market.bookImbalancePct); if (b.note) reasons.push(b.note);
  const s = smartMoneyScore(smartMoney?.topTraderLongShortRatio); if (s.note) reasons.push(s.note);
  const scores = { momentum: m.score, funding: f.score, book: b.score, smartMoney: s.score };
  const net = clamp(m.score * WEIGHTS.momentum + f.score * WEIGHTS.funding + b.score * WEIGHTS.book + s.score * WEIGHTS.smartMoney);

  let direction = net >= THRESHOLDS.longNet ? "long" : net <= THRESHOLDS.shortNet ? "short" : "observe";
  let confidence = clamp(Math.round(Math.abs(net - 50) * 1.6 + 50));

  // 反追涨杀跌(纪律 S1「顺势回调进场,不摸顶」):pricePosition=价格在近程区间的位置(0贴下沿~1贴上沿)。
  // 方向为多却已贴上沿(≥0.85)=追高末端、方向为空却已贴下沿(≤0.15)=追空末端,砍置信度;
  // 砍到不达标就转观望,让引擎等回调而不是追在末端(这正是"信号滞后、进场即被回撤扫损"的根因之一)。
  const pos = num(market.pricePosition);
  if (pos != null) {
    if (direction === "long" && pos >= THRESHOLDS.chaseHigh) {
      confidence = clamp(confidence - THRESHOLDS.chasePenalty);
      reasons.push(`价格贴近区间高点(${pos.toFixed(2)})，追多在末端，置信度下调 ${THRESHOLDS.chasePenalty}——等回调再进`);
    } else if (direction === "short" && pos <= THRESHOLDS.chaseLow) {
      confidence = clamp(confidence - THRESHOLDS.chasePenalty);
      reasons.push(`价格贴近区间低点(${pos.toFixed(2)})，追空在末端，置信度下调 ${THRESHOLDS.chasePenalty}——等反抽再进`);
    }
  }

  // 证据不足或方向不明 → 只观望，不下计划（诚实优先，不硬凑方向）。
  if (direction === "observe") reasons.push(`多源融合分 ${Math.round(net)} 落在中性区(${THRESHOLDS.shortNet}~${THRESHOLDS.longNet})，方向不明`);
  if (direction !== "observe" && confidence < THRESHOLDS.minConfidence) {
    reasons.push(`置信度 ${confidence} 未达 ${THRESHOLDS.minConfidence}，转观望`);
    direction = "observe";
  }
  // atr(绝对值,真实 ATR)优先;缺失时回落 atrPct 比例法。二者都缺则用默认止损比例。
  const plan = direction === "observe" ? null : buildPlan(price, direction, mandate, { atr: num(market.atr), atrPct: num(market.atrPct), pricePosition: pos });
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
