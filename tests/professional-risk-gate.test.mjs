import assert from "node:assert/strict";
import test from "node:test";
import { applyOperationalDegradation, assessOperationalDegradation, evaluateProfessionalPlanRisks, professionalNotionalCap } from "../server/professionalRiskGate.mjs";

const verifiedAuditStatus = Object.freeze({
  operationalReady: true,
  mode: "full_chain",
  confidence: "full_chain_local",
  legacyChainOk: true,
  externalAttestation: "deferred",
  failures: []
});
const assess = (db) => assessOperationalDegradation(db, { auditStatus: verifiedAuditStatus });
const apply = (db) => applyOperationalDegradation(db, "ProfessionalRiskGate", { auditStatus: verifiedAuditStatus });

const now = () => new Date().toISOString();
function dbFixture({ live = true } = {}) {
  const observedAt=now();
  return {
    meta:{}, auditLogs:[], traces:[], riskIncidents:[],
    system:{ liveTradingEnabled:live, autonomyEnabled:true, killSwitch:false, professionalRiskMode:true },
    portfolio:{ totalEquityUsdt:10000 }, positions:[], executionOrders:[], exchangeAccounts:[], reconciliationReports:[], realtimeConnections:[],
    markets:[{ symbol:"BTC/USDT", price:100, spreadBps:2, depthUsdt:100000, updatedAt:observedAt,
      tickerSourceAt:observedAt,tickerReceivedAt:observedAt,lastRealtimeAt:observedAt,
      microSyncedAt:observedAt,microReceivedAt:observedAt,bookSourceAt:observedAt,bookReceivedAt:observedAt,
      openInterestSourceAt:observedAt,openInterestReceivedAt:observedAt,fundingSourceAt:observedAt,fundingReceivedAt:observedAt,candles:[] }],
    mandates:[{ id:"m1", status:"active", allowedSymbols:["BTC/USDT"], maxImpactBps:15 }], grayReleasePolicies:[{enabled:true,maxNotionalUsdt:50}]
  };
}
function staleMarket(market) {
  const old="2000-01-01T00:00:00.000Z";
  for (const field of ["updatedAt","tickerSourceAt","tickerReceivedAt","lastRealtimeAt","microSyncedAt","microReceivedAt","bookSourceAt","bookReceivedAt","openInterestSourceAt","openInterestReceivedAt","fundingSourceAt","fundingReceivedAt"]) market[field]=old;
}
function refreshMarket(market) {
  const fresh=now();
  for (const field of ["updatedAt","tickerSourceAt","tickerReceivedAt","lastRealtimeAt","microSyncedAt","microReceivedAt","bookSourceAt","bookReceivedAt","openInterestSourceAt","openInterestReceivedAt","fundingSourceAt","fundingReceivedAt"]) market[field]=fresh;
}
const plan = { mandateId:"m1", symbol:"BTC/USDT", direction:"long", entry_range:[100,100], stopLoss:95 };

test("正常链路通过专业运行与流动性硬闸", () => {
  const db=dbFixture();
  assert.equal(assess(db).degraded,false);
  const risk=evaluateProfessionalPlanRisks(db,plan,db.mandates[0]);
  assert.equal(risk.checks.find(c=>c.name==="流动性与冲击成本").passed,true);
});

test("风险闸使用 OKX 实时消息时间与实际私有连接状态，不依赖失真的全局标志", () => {
  const db=dbFixture();
  delete db.markets[0].updatedAt;
  delete db.markets[0].microSyncedAt;
  refreshMarket(db.markets[0]);
  db.exchangeAccounts=[{exchange:"OKX",readEnabled:true}];
  db.realtimeConnections=[{exchange:"OKX",streamType:"private_user",status:"connected",authenticatedCredentialFingerprint:null}];
  db.reconciliationReports=[{status:"ok",createdAt:now()}];
  assert.equal(db.realtimeStarted,undefined);
  assert.equal(assess(db).degraded,false);
});

test("陈旧行情自动切只减仓并只创建一次风险事件", () => {
  const db=dbFixture(); staleMarket(db.markets[0]);
  const first=apply(db);
  assert.equal(first.degraded,true); assert.equal(db.system.reduceOnlyMode,true); assert.equal(db.system.autonomyEnabled,true); assert.equal(db.riskIncidents.length,1);
  apply(db); assert.equal(db.riskIncidents.length,1);
});

test("订单 UNKNOWN 与对账异常触发运行降级", () => {
  const db=dbFixture(); db.executionOrders=[{status:"UNKNOWN"}];
  assert.ok(assess(db).reasons.includes("unknown_order_state"));
  db.executionOrders=[]; db.exchangeAccounts=[{exchange:"OKX",readEnabled:true}];
  assert.ok(assess(db).reasons.includes("reconciliation_unhealthy"));
});

test("全自动运行中 WORM 或外部告警失联会在每次开仓前降级", () => {
  const db=dbFixture();
  db.system.orderWriteEnabled=true;
  db.grayReleasePolicies[0].requiresManualApproval=false;
  const assessment=assess(db);
  assert.ok(assessment.reasons.includes("worm_audit_unhealthy"));
  assert.ok(assessment.reasons.includes("external_alert_unhealthy"));
  assert.equal(assessment.enforced,true);
});

test("BitLaunch 单服务器模式把 Lark/WORM 作为可观测增强，不耦合交易权限", () => {
  const previousProfile=process.env.PRODUCTION_SECURITY_PROFILE;
  const previousAlert=process.env.ALERT_WEBHOOK_URL;
  const previousWorm=process.env.WORM_AUDIT_ENDPOINT;
  process.env.PRODUCTION_SECURITY_PROFILE="bitlaunch_single_server";
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.WORM_AUDIT_ENDPOINT;
  try {
    const db=dbFixture();
    db.system.orderWriteEnabled=true;
    db.grayReleasePolicies[0].requiresManualApproval=false;
    const assessment=assess(db);
    assert.equal(assessment.reasons.includes("worm_audit_unhealthy"),false);
    assert.equal(assessment.reasons.includes("external_alert_unhealthy"),false);
  } finally {
    if(previousProfile===undefined)delete process.env.PRODUCTION_SECURITY_PROFILE;else process.env.PRODUCTION_SECURITY_PROFILE=previousProfile;
    if(previousAlert===undefined)delete process.env.ALERT_WEBHOOK_URL;else process.env.ALERT_WEBHOOK_URL=previousAlert;
    if(previousWorm===undefined)delete process.env.WORM_AUDIT_ENDPOINT;else process.env.WORM_AUDIT_ENDPOINT=previousWorm;
  }
});

test("盘口容量限制名义金额，极端组合利用率继续压仓", () => {
  const db=dbFixture(); db.markets[0].depthUsdt=1000; db.mandates[0].maxImpactBps=10;
  const cap=professionalNotionalCap(db,plan,100);
  assert.ok(cap.cap<100); assert.ok(cap.reasons.includes("liquidity_impact_capped"));
});

test("默认关(professionalRiskMode 关):降级只记录不只减仓、检查降级为 warn 不 block", () => {
  const db=dbFixture(); db.system.professionalRiskMode=false;
  staleMarket(db.markets[0]);
  apply(db);
  assert.equal(db.system.reduceOnlyMode,false); // 未被自动置只减仓
  assert.equal(db.system.autonomyEnabled,true);
  const risk=evaluateProfessionalPlanRisks(db,plan,db.mandates[0]);
  assert.equal(risk.checks.find(c=>c.name==="Ticker 新鲜度 SLO").severity,"warn"); // 只警告不硬拦
});

test("自愈:降级消失且只减仓是本闸设的 → 自动解除", () => {
  const db=dbFixture();
  staleMarket(db.markets[0]);
  apply(db); assert.equal(db.system.reduceOnlyMode,true);
  refreshMarket(db.markets[0]);
  apply(db); assert.equal(db.system.reduceOnlyMode,false); // 条件恢复自动解除
  assert.equal(db.system.riskStatus,"正常");
});

test("旧版本只残留只减仓展示文案时自动归一为正常", () => {
  const db=dbFixture();
  db.system.reduceOnlyMode=false;
  db.system.reduceOnlyBy=null;
  db.system.riskStatus="只减仓";
  apply(db);
  assert.equal(db.system.reduceOnlyMode,false);
  assert.equal(db.system.riskStatus,"正常");
});

test("强平距离不足阻断新增仓位", () => {
  const db=dbFixture(); db.positions=[{source:"exchange_rest",exchange:"OKX",accountId:"account-a",symbol:"ETH/USDT",direction:"long",coinSize:1,mark:100,liquidationPrice:92,rawSyncedAt:now()}];
  const risk=evaluateProfessionalPlanRisks(db,plan,db.mandates[0]);
  const check=risk.checks.find(c=>c.name==="现有持仓强平距离");
  assert.equal(check.passed,false); assert.equal(check.severity,"block");
});

test("缺失点差不会被当作零成本流动性", () => {
  const db=dbFixture(); db.markets[0].spreadBps=null;
  const risk=evaluateProfessionalPlanRisks(db,plan,db.mandates[0]);
  const check=risk.checks.find(c=>c.name==="流动性与冲击成本");
  assert.equal(check.severity,"warn");
  assert.match(check.detail,/缺少可验证的盘口点差或深度/);
  assert.equal(risk.liquidity.spreadBps,null);
});
