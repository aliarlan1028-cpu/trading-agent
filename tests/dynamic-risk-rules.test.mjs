import test from "node:test";
import assert from "node:assert/strict";
import { compileNaturalRiskCondition, evaluateDynamicRiskRules, validateConditionSpec } from "../server/dynamicRiskRules.mjs";

test("structured dynamic blocking rules are executed against trade facts", () => {
  const db = {
    system: {},
    portfolio: {},
    markets: [{ symbol: "BTC/USDT", fundingRate: 0.15, spreadBps: 4 }],
    events: [],
    apiKeyMetadata: [],
    riskRules: [{
      id: "funding",
      name: "资金费率过热",
      enabled: true,
      action: "block",
      conditionSpec: { field: "market.fundingRate", operator: "abs_gt", value: 0.1 }
    }]
  };
  const [result] = evaluateDynamicRiskRules(db, { symbol: "BTC/USDT", leverage: 2, stopLoss: 90 });
  assert.equal(result.enforceable, true);
  assert.equal(result.triggered, true);
  assert.equal(result.blocking, true);
});

test("uncompiled natural-language rules cannot pretend to be enforced", () => {
  assert.equal(validateConditionSpec(null).valid, false);
  const [result] = evaluateDynamicRiskRules({
    system: {}, portfolio: {}, markets: [], events: [], apiKeyMetadata: [],
    riskRules: [{ id: "natural", name: "看起来危险时暂停", enabled: true, action: "block", condition: "危险时" }]
  }, { symbol: "BTC/USDT" });
  assert.equal(result.enforceable, false);
  assert.equal(result.blocking, false);
});

test("supported knowledge conditions compile into deterministic risk predicates", () => {
  assert.deepEqual(compileNaturalRiskCondition("资金费率绝对值 > 0.1%"), {
    field: "market.fundingRate",
    operator: "abs_gt",
    value: 0.1
  });
  assert.deepEqual(compileNaturalRiskCondition("杠杆超过 3 倍"), {
    field: "plan.leverage",
    operator: "gt",
    value: 3
  });
  assert.equal(compileNaturalRiskCondition("市场看起来不舒服时"), null);
});
