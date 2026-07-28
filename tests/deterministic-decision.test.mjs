import { test } from "node:test";
import assert from "node:assert/strict";
import { deterministicDecision, THRESHOLDS } from "../server/deterministicDecision.mjs";

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
