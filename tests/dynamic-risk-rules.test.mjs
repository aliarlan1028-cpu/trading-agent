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

test("condition value must be present, finite and within field range", () => {
  assert.equal(validateConditionSpec({ field: "plan.leverage", operator: "gt", value: null }).valid, false);
  assert.equal(validateConditionSpec({ field: "event.maxImpact", operator: "gte", value: 101 }).valid, false);
  assert.equal(validateConditionSpec({ field: "market.fundingRate", operator: "abs_gt", value: -0.1 }).valid, false);
});

test("notify rules create a deduplicated notification without blocking", () => {
  const db = {
    system: {}, portfolio: {}, events: [], apiKeyMetadata: [], riskIncidents: [], notifications: [], meta: {},
    markets: [{ symbol: "BTC/USDT", fundingRate: 0.2 }],
    riskRules: [{ id: "notify", name: "funding alert", enabled: true, action: "notify", conditionSpec: { field: "market.fundingRate", operator: "abs_gt", value: 0.1 } }]
  };
  const first = evaluateDynamicRiskRules(db, { symbol: "BTC/USDT" });
  const second = evaluateDynamicRiskRules(db, { symbol: "BTC/USDT" });
  assert.equal(first[0].blocking, false);
  assert.equal(db.notifications.length, 1);
  assert.equal(db.riskIncidents.length, 0);
  assert.equal(second[0].triggered, true);
});

test("动态阻断事件在条件明确恢复后自动关闭，缺数据时保持打开", () => {
  const db = {
    system: {}, markets: [{ symbol: "BTC/USDT", fundingRate: 0.2 }], events: [], apiKeyMetadata: [],
    riskRules: [{ id: "funding_block", name: "funding block", enabled: true, action: "reject_entry", conditionSpec: { field: "market.fundingRate", operator: "abs_gt", value: 0.1 } }],
    riskIncidents: [], notifications: [], auditLogs: [], meta: {}
  };
  const plan = { symbol: "BTC/USDT", leverage: 2, entry: { riskPercent: 0.5 }, stopLoss: 90 };
  evaluateDynamicRiskRules(db, plan);
  assert.equal(db.riskIncidents[0].status, "open");
  db.markets[0].fundingRate = undefined;
  evaluateDynamicRiskRules(db, plan);
  assert.equal(db.riskIncidents[0].status, "open");
  db.markets[0].fundingRate = 0.01;
  evaluateDynamicRiskRules(db, plan);
  assert.equal(db.riskIncidents[0].status, "resolved");
});
