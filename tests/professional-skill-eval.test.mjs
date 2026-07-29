import assert from "node:assert/strict";
import test from "node:test";
import { runSkillTool, SKILL_TOOLS } from "../server/skillTools.mjs";

function enabledDb() {
  return { system:{}, portfolio:{totalEquityUsdt:1000}, positions:[], fills:[], executionOrders:[], mandates:[], markets:[], skills:SKILL_TOOLS.map(t=>({id:t.skillId,native:true,status:"已启用"})) };
}

test("fail-closed 专业 Skill 拒绝缺失与陈旧行情且记录评测指标", async () => {
  for (const name of ["contract_risk_profile","liquidity_impact","funding_basis","deterministic_market_regime"]) {
    const db=enabledDb();
    const result=await runSkillTool(db,name,{symbol:"BTC/USDT",notionalUsdt:50});
    assert.equal(result.status,"blocked",name);
    const skill=db.skills.find(s=>s.id===SKILL_TOOLS.find(t=>t.toolName===name).skillId);
    assert.equal(skill.evalMetrics.blocked,1);
  }
});

test("市场状态 Skill 对极端波动给出确定性分类并满足输出契约", async () => {
  const db=enabledDb();
  const candles=Array.from({length:30},(_,i)=>({close:100*(1+i*.03)}));
  db.markets=[{symbol:"BTC/USDT",updatedAt:new Date().toISOString(),candles}];
  const result=await runSkillTool(db,"deterministic_market_regime",{symbol:"BTC/USDT"});
  assert.equal(result.status,"ok"); assert.ok(result.regime.label); assert.equal(result.contract.failClosed,true);
});

test("执行质量和漂移 Skill 在样本不足时诚实降级而非编造", async () => {
  for (const name of ["execution_quality","strategy_drift"]) {
    const result=await runSkillTool(enabledDb(),name,{});
    assert.equal(result.status,"insufficient_sample",name);
  }
});

test("交易所故障 Skill 将 UNKNOWN 订单判为 reduce-only", async () => {
  const db=enabledDb(); db.executionOrders=[{status:"UNKNOWN"}];
  const result=await runSkillTool(db,"exchange_degradation",{});
  assert.equal(result.mode,"reduce_only"); assert.ok(result.reasons.includes("unknown_order_state"));
});
