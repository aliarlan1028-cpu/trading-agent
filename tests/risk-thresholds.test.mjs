// 风控阈值:单位换算 + 区间夹取。
// 追踪距离 1.2%(人类单位)必须转成 env 的 0.012(小数);算错会让追踪止损跟错距离 → 直接影响盈亏。
import test from "node:test";
import assert from "node:assert/strict";
import { currentRiskThresholds, applyRiskThresholds, classifyRiskThresholdChanges, RISK_THRESHOLD_DEFS } from "../server/riskThresholds.mjs";

// 清掉相关 env,保证从默认起测(避免其它测试污染)
function clearEnv() { for (const d of RISK_THRESHOLD_DEFS) delete process.env[d.env]; }
// 收集写入的 env(替身 setConfig)
const fakeSetConfig = (_db, entries) => { Object.assign(process.env, entries); };

test("默认值 = 条令 v1", () => {
  clearEnv();
  const v = currentRiskThresholds();
  assert.equal(v.minRewardRisk, 2);
  assert.equal(v.protectMaxConsecLosses, 3);
  assert.equal(v.protectCooldownHours, 4);
  assert.equal(v.protectMaxDrawdownPct, 10);
  assert.equal(v.trailActivatePct, 1.5);
  assert.equal(v.trailDistancePct, 1.2);
  assert.equal(v.eventBlackoutMinutes, 30);
});

test("追踪距离单位换算:UI 1.2% → env TRAIL_PCT=0.012,回读仍是 1.2", () => {
  clearEnv();
  applyRiskThresholds({}, { trailDistancePct: 1.2 }, fakeSetConfig);
  assert.equal(process.env.TRAIL_PCT, "0.012");
  assert.equal(currentRiskThresholds().trailDistancePct, 1.2); // 往返一致
});

test("其余项直存(非换算):RR/连亏/静默分钟", () => {
  clearEnv();
  applyRiskThresholds({}, { minRewardRisk: 2.5, protectMaxConsecLosses: 4, eventBlackoutMinutes: 45 }, fakeSetConfig);
  assert.equal(process.env.MIN_REWARD_RISK, "2.5");
  assert.equal(process.env.PROTECT_MAX_CONSEC_LOSSES, "4");
  assert.equal(process.env.EVENT_BLACKOUT_MINUTES, "45");
});

test("越界夹取:RR 99→5,连亏允许1且上限100,回撤99→50", () => {
  clearEnv();
  const r = applyRiskThresholds({}, { minRewardRisk: 99, protectMaxConsecLosses: 1, protectMaxDrawdownPct: 99 }, fakeSetConfig);
  assert.equal(r.current.minRewardRisk, 5);
  assert.equal(r.current.protectMaxConsecLosses, 1);
  assert.equal(r.current.protectMaxDrawdownPct, 50);
});

test("只写传入的项,未传的保持不变", () => {
  clearEnv();
  applyRiskThresholds({}, { minRewardRisk: 3 }, fakeSetConfig);
  assert.equal(process.env.MIN_REWARD_RISK, "3");
  assert.equal(process.env.PROTECT_COOLDOWN_HOURS, undefined); // 没传就不写
});

test("非数值/空输入被忽略(不写脏值)", () => {
  clearEnv();
  const r = applyRiskThresholds({}, { minRewardRisk: "abc", protectCooldownHours: "" }, fakeSetConfig);
  assert.equal(r.applied.length, 0);
  assert.equal(process.env.MIN_REWARD_RISK, undefined);
});

test("阈值变更明确区分收紧与放宽", () => {
  const current = { ...Object.fromEntries(RISK_THRESHOLD_DEFS.map((def) => [def.key, def.def])) };
  const changes = classifyRiskThresholdChanges({
    eventBlackoutMinutes: 0,
    protectMaxConsecLosses: 100,
    protectMaxDrawdownPct: 50,
    minRewardRisk: 3,
    protectCooldownHours: 8
  }, current);
  const byKey = new Map(changes.map((change) => [change.key, change.classification]));
  assert.equal(byKey.get("eventBlackoutMinutes"), "loosen");
  assert.equal(byKey.get("protectMaxConsecLosses"), "loosen");
  assert.equal(byKey.get("protectMaxDrawdownPct"), "loosen");
  assert.equal(byKey.get("minRewardRisk"), "tighten");
  assert.equal(byKey.get("protectCooldownHours"), "tighten");
});
