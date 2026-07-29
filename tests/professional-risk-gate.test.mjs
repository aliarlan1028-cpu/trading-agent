import assert from "node:assert/strict";
import test from "node:test";
import { applyOperationalDegradation, assessOperationalDegradation, evaluateProfessionalPlanRisks, professionalNotionalCap } from "../server/professionalRiskGate.mjs";

const now = () => new Date().toISOString();
function dbFixture({ live = true } = {}) {
  return {
    meta:{}, auditLogs:[], traces:[], riskIncidents:[],
    system:{ liveTradingEnabled:live, autonomyEnabled:true, killSwitch:false, professionalRiskMode:true },
    portfolio:{ totalEquityUsdt:10000 }, positions:[], executionOrders:[], exchangeAccounts:[], reconciliationReports:[], realtimeConnections:[],
    markets:[{ symbol:"BTC/USDT", price:100, spreadBps:2, depthUsdt:100000, updatedAt:now(), microSyncedAt:now(), candles:[] }],
    mandates:[{ id:"m1", status:"active", allowedSymbols:["BTC/USDT"], maxImpactBps:15 }], grayReleasePolicies:[{enabled:true,maxNotionalUsdt:50}]
  };
}
const plan = { mandateId:"m1", symbol:"BTC/USDT", direction:"long", entry_range:[100,100], stopLoss:95 };

test("正常链路通过专业运行与流动性硬闸", () => {
  const db=dbFixture();
  assert.equal(assessOperationalDegradation(db).degraded,false);
  const risk=evaluateProfessionalPlanRisks(db,plan,db.mandates[0]);
  assert.equal(risk.checks.find(c=>c.name==="流动性与冲击成本").passed,true);
});

test("陈旧行情自动切只减仓并只创建一次风险事件", () => {
  const db=dbFixture(); db.markets[0].updatedAt="2000-01-01T00:00:00.000Z"; db.markets[0].microSyncedAt=db.markets[0].updatedAt;
  const first=applyOperationalDegradation(db);
  assert.equal(first.degraded,true); assert.equal(db.system.reduceOnlyMode,true); assert.equal(db.system.autonomyEnabled,true); assert.equal(db.riskIncidents.length,1);
  applyOperationalDegradation(db); assert.equal(db.riskIncidents.length,1);
});

test("订单 UNKNOWN 与对账异常触发运行降级", () => {
  const db=dbFixture(); db.executionOrders=[{status:"UNKNOWN"}];
  assert.ok(assessOperationalDegradation(db).reasons.includes("unknown_order_state"));
  db.executionOrders=[]; db.exchangeAccounts=[{readEnabled:true}];
  assert.ok(assessOperationalDegradation(db).reasons.includes("reconciliation_unhealthy"));
});

test("盘口容量限制名义金额，极端组合利用率继续压仓", () => {
  const db=dbFixture(); db.markets[0].depthUsdt=1000; db.mandates[0].maxImpactBps=10;
  const cap=professionalNotionalCap(db,plan,100);
  assert.ok(cap.cap<100); assert.ok(cap.reasons.includes("liquidity_impact_capped"));
});

test("默认关(professionalRiskMode 关):降级只记录不只减仓、检查降级为 warn 不 block", () => {
  const db=dbFixture(); db.system.professionalRiskMode=false;
  db.markets[0].updatedAt="2000-01-01T00:00:00.000Z"; db.markets[0].microSyncedAt=db.markets[0].updatedAt;
  applyOperationalDegradation(db);
  assert.equal(db.system.reduceOnlyMode,undefined); // 未被自动置只减仓
  assert.equal(db.system.autonomyEnabled,true);
  const risk=evaluateProfessionalPlanRisks(db,plan,db.mandates[0]);
  assert.equal(risk.checks.find(c=>c.name==="行情新鲜度 SLO").severity,"warn"); // 只警告不硬拦
});

test("自愈:降级消失且只减仓是本闸设的 → 自动解除", () => {
  const db=dbFixture();
  db.markets[0].updatedAt="2000-01-01T00:00:00.000Z"; db.markets[0].microSyncedAt=db.markets[0].updatedAt;
  applyOperationalDegradation(db); assert.equal(db.system.reduceOnlyMode,true);
  db.markets[0].updatedAt=now(); db.markets[0].microSyncedAt=now();
  applyOperationalDegradation(db); assert.equal(db.system.reduceOnlyMode,false); // 条件恢复自动解除
});

test("强平距离不足阻断新增仓位", () => {
  const db=dbFixture(); db.positions=[{symbol:"ETH/USDT",size:1,mark:100,liquidationPrice:92}];
  const risk=evaluateProfessionalPlanRisks(db,plan,db.mandates[0]);
  const check=risk.checks.find(c=>c.name==="现有持仓强平距离");
  assert.equal(check.passed,false); assert.equal(check.severity,"block");
});
