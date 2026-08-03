import { test } from "node:test";
import assert from "node:assert/strict";
import { deterministicDecision, THRESHOLDS, DEFAULTS } from "../server/deterministicDecision.mjs";
import { scoreCandidate, pullbackQuality, candidateTag } from "../server/opportunityScanner.mjs";

test("缺价格 → observe，不下计划", () => {
  const d = deterministicDecision({ market: { symbol: "BTC/USDT" } });
  assert.equal(d.direction, "observe");
  assert.equal(d.plan, null);
  assert.match(d.reasons.join(""), /缺实时价格/);
});

test("多头共振 → long 且给出结构完整的计划", () => {
  const d = deterministicDecision({
    market: { symbol: "BTC/USDT", price: 60000, changePct: 4.5, fundingRate: 0.0001, bookImbalancePct: 62 },
    smartMoney: { topTraderLongShortRatio: 1.3 },
    mandate: { maxSingleTradeRiskPct: 1, max_leverage: 10 }
  });
  assert.equal(d.direction, "long");
  assert.ok(d.confidence >= THRESHOLDS.minConfidence);
  assert.ok(d.plan.stopLoss < d.plan.entryLow, "多头止损应在入场下方");
  assert.ok(d.plan.takeProfits[0] > d.plan.entryHigh, "多头止盈应在入场上方");
  assert.ok(d.plan.riskPercent <= 1, "风险%不得超过授权上限");
  assert.ok(d.plan.leverage <= 3, "确定性兜底杠杆封顶 3x");
});

test("空头共振 → short，止损在上、止盈在下", () => {
  const d = deterministicDecision({
    market: { symbol: "ETH/USDT", price: 3000, changePct: -4, fundingRate: 0.0009, bookImbalancePct: 38 },
    smartMoney: { topTraderLongShortRatio: 0.8 },
    mandate: { maxSingleTradeRiskPct: 0.5 }
  });
  assert.equal(d.direction, "short");
  assert.ok(d.plan.stopLoss > d.plan.entryHigh, "空头止损应在入场上方");
  assert.ok(d.plan.takeProfits[0] < d.plan.entryLow, "空头止盈应在入场下方");
});

test("信号中性 → observe（诚实观望，不硬凑方向）", () => {
  const d = deterministicDecision({
    market: { symbol: "SOL/USDT", price: 180, changePct: 0.1, fundingRate: 0, bookImbalancePct: 50 },
    smartMoney: { topTraderLongShortRatio: 1.0 }
  });
  assert.equal(d.direction, "observe");
  assert.equal(d.plan, null);
});

test("缺因子数据时中性处理并留痕，不编造", () => {
  const d = deterministicDecision({ market: { symbol: "SUI/USDT", price: 4, changePct: 5 } });
  assert.match(d.reasons.join(""), /缺资金费率|缺订单簿|缺大户/);
  // 只有动量强正、其余中性 → 融合分不足以过阈值，保持观望是合理的诚实结果
  assert.ok(["long", "observe"].includes(d.direction));
});

// —— 反追涨杀跌 ——
const BULL = { symbol: "BTC/USDT", price: 60000, changePct: 4.5, fundingRate: 0.0001, bookImbalancePct: 62 };
const SMART_LONG = { topTraderLongShortRatio: 1.3 };

test("贴上沿做多=追高末端 → 置信度被下调、留痕(比不贴沿更低)", () => {
  const base = deterministicDecision({ market: { ...BULL }, smartMoney: SMART_LONG });
  const chase = deterministicDecision({ market: { ...BULL, pricePosition: 0.95 }, smartMoney: SMART_LONG });
  assert.ok(chase.confidence < base.confidence, "贴上沿追多应比不贴沿置信度低");
  assert.match(chase.reasons.join(""), /追多在末端|等回调/);
});

test("贴下沿做空=追空末端 → 置信度被下调、留痕", () => {
  const base = deterministicDecision({ market: { symbol: "ETH/USDT", price: 3000, changePct: -4, fundingRate: 0.0009, bookImbalancePct: 38 }, smartMoney: { topTraderLongShortRatio: 0.8 } });
  const chase = deterministicDecision({ market: { symbol: "ETH/USDT", price: 3000, changePct: -4, fundingRate: 0.0009, bookImbalancePct: 38, pricePosition: 0.05 }, smartMoney: { topTraderLongShortRatio: 0.8 } });
  assert.ok(chase.confidence < base.confidence, "贴下沿追空应比不贴沿置信度低");
  assert.match(chase.reasons.join(""), /追空在末端|等反抽/);
});

test("回调区(区间中段)做多不被追末端惩罚", () => {
  const mid = deterministicDecision({ market: { ...BULL, pricePosition: 0.45 }, smartMoney: SMART_LONG });
  const base = deterministicDecision({ market: { ...BULL }, smartMoney: SMART_LONG });
  assert.equal(mid.confidence, base.confidence, "区间中段不应触发追末端扣分");
  assert.doesNotMatch(mid.reasons.join(""), /追多在末端/);
});

test("真实 ATR → 止损用 ATR 倍数，比默认更贴波动", () => {
  const d = deterministicDecision({ market: { ...BULL, atr: 1200 }, smartMoney: SMART_LONG }); // ATR=2% of 60000
  assert.ok(d.plan, "应给出计划");
  // 止损占比 ≈ 2×ATR/price = 4%（落在 [minStopPct,maxStopPct] 内）
  assert.ok(Math.abs(d.plan.stopPct - 0.04) < 1e-6, `止损占比应≈4%，实为 ${d.plan.stopPct}`);
  assert.ok(d.plan.stopPct > DEFAULTS.stopPct, "ATR 止损应比默认 1.5% 宽");
});

test("止损占比被夹在 [minStopPct, maxStopPct] 内(防 ATR 异常)", () => {
  const tiny = deterministicDecision({ market: { ...BULL, atr: 1 }, smartMoney: SMART_LONG });   // 极小 ATR
  const huge = deterministicDecision({ market: { ...BULL, atr: 9000 }, smartMoney: SMART_LONG }); // 极大 ATR
  assert.ok(tiny.plan.stopPct >= DEFAULTS.minStopPct - 1e-9, "极小 ATR 不得让止损小于下限(否则噪音扫损)");
  assert.ok(huge.plan.stopPct <= DEFAULTS.maxStopPct + 1e-9, "极大 ATR 不得让单笔风险失控");
});

test("顺势回调入场:做多挂单区在现价下方(不追单)", () => {
  const d = deterministicDecision({ market: { ...BULL, atr: 900 }, smartMoney: SMART_LONG });
  assert.ok(d.plan.entryHigh <= BULL.price + 1e-6, "做多入场上沿不高于现价(等回撤买)");
  assert.ok(d.plan.entryLow < BULL.price, "做多入场下沿在现价下方");
});

// —— 扫描器反追涨杀跌打分 ——
test("扫描器:顺势回调候选评分高于追高顶部", () => {
  const pull = scoreCandidate({ momentum: 10, rangePos: 0.42, volPct: 8 }).longScore;
  const chase = scoreCandidate({ momentum: 10, rangePos: 0.95, volPct: 8 }).longScore;
  assert.ok(pull > chase, `回调候选(${pull.toFixed(1)})应高于追高顶部(${chase.toFixed(1)})`);
});

test("扫描器:pullbackQuality 极端位归零、中段最高", () => {
  assert.ok(pullbackQuality(0.42, "long") > 0.95, "做多理想回调位应接近满分");
  assert.ok(pullbackQuality(0.95, "long") < 0.3, "贴上沿追高应低分");
  assert.ok(pullbackQuality(0.05, "long") < 0.3, "深跌未企稳(falling knife)也低分");
  assert.ok(pullbackQuality(0.58, "short") > 0.95, "做空理想反抽位应接近满分");
});

test("扫描器:标签只给中性位置事实、不下追高/该等回调这类结论", () => {
  // 反锚定:扫描器陈述"在哪、动量强弱",把"该不该追"的判断留给 Agent + 纪律层。
  assert.match(candidateTag("long", 0.9, 10), /上沿/);
  assert.match(candidateTag("short", 0.1, -10), /下沿/);
  assert.match(candidateTag("long", 0.45, 8), /中段/);
  // 不得再出现处方式结论词。
  for (const t of [candidateTag("long", 0.9, 10), candidateTag("short", 0.1, -10), candidateTag("long", 0.45, 8)]) {
    assert.doesNotMatch(t, /追高|追空|别追|别摸顶|候选/, `标签不应含处方式结论:${t}`);
  }
});
