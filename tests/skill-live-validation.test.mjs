import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { financiallyReconciledFills } from "./financial-fixtures.mjs";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "skill-live-val-"));
process.env.SKILL_PROBATION_GRADUATE_TRADES = "6";

const {
  compileTradingMethod,
  promoteCompiledToProbation,
  refreshKnowledgeSkillAttribution,
  selectActiveKnowledgeSkills,
  bindKnowledgeSkillsToPlan
} = await import("../server/knowledgeSkills.mjs");

function dbFixture() {
  const source = { id: "src-1", title: "趋势书", type: "pdf" };
  const method = {
    id: "method-1", name: "唐奇安突破", direction: "long", timeframe: "1h", symbolScope: "BTC",
    entry: "收盘突破20根最高", confirmation: "成交量放大", stop: "入场下方2%", takeProfit: "2R",
    source: { id: source.id, title: source.title }
  };
  const candles = Array.from({ length: 51 }, (_, i) => ({
    time: i * 3_600_000, open: i === 49 ? 110 : 100, high: i === 49 ? 111 : 101, low: 99, close: i === 49 ? 110 : 100, volume: i === 49 ? 200 : 100
  }));
  return {
    meta: {}, auditLogs: [], traces: [], fills: [], tradePlans: [], paperSessions: [],
    markets: [{ symbol: "BTC/USDT", candles, candlesTimeframe: "1h" }],
    knowledge: { sources: [source], chunks: [], tradingMethods: [method], tradingSkills: [], skillInvocations: [], skillAttributions: [] }
  };
}

test("编译技能不能绕过历史/前向/人工批准直接上岗", () => {
  const db = dbFixture();
  const skill = compileTradingMethod(db, "method-1");
  assert.equal(skill.status, "compiled");
  const { promoted } = promoteCompiledToProbation(db);
  assert.equal(promoted, 0);
  assert.equal(skill.status, "compiled");
  assert.notEqual(skill.executable, true);
  const eligible = selectActiveKnowledgeSkills(db, { symbol: "BTC/USDT", direction: "long", timeframe: "1h" });
  assert.equal(eligible.length, 0);
});

test("真实成绩驱动:达标自动转正、不达标自动退役", () => {
  const db = dbFixture();
  const skill = compileTradingMethod(db, "method-1");
  skill.status = "live_probation";
  skill.executable = true;
  skill.approval = { approved: true, fingerprint: skill.fingerprint };
  // 造 6 笔盈利归因 → 应转正为 active
  for (let i = 0; i < 6; i += 1) {
    const plan = { id: `plan-w-${i}`, knowledgeSkills: [{ skillId: skill.id, version: skill.version, fingerprint: skill.fingerprint }] };
    db.tradePlans.push(plan);
    db.fills.push({ id: `fill-w-${i}`, kind: "close", executionOrderId: `exec-w-${i}`, tradePlanId: plan.id, realizedPnl: 5, createdAt: new Date(Date.now() + i * 1000).toISOString() });
  }
  db.fills = financiallyReconciledFills(db.fills);
  const r1 = refreshKnowledgeSkillAttribution(db);
  assert.ok(r1.graduated.includes(skill.id), "6 笔盈利应转正");
  assert.equal(skill.status, "active");
  assert.equal(skill.approval?.fingerprint, skill.fingerprint, "转正应带批准指纹,便于后续 active 选用");
});

test("知识技能按完整生命周期净值晋退，费用翻转毛盈利时不得转正", () => {
  const db = dbFixture();
  const skill = compileTradingMethod(db, "method-1");
  skill.status = "live_probation";
  skill.executable = true;
  skill.approval = { approved: true, fingerprint: skill.fingerprint };
  const addFeeFlip = (index) => {
    const plan = { id: `fee-plan-${index}`, knowledgeSkills: [{ skillId: skill.id, version: skill.version, fingerprint: skill.fingerprint }] };
    db.tradePlans.push(plan);
    db.fills.push(
      { id: `fee-entry-${index}`, kind: "entry", executionOrderId: `fee-exec-${index}`, tradePlanId: plan.id, feeUsdt: 0.8, createdAt: `2026-08-01T${String(index).padStart(2, "0")}:00:00Z` },
      { id: `fee-close-${index}`, kind: "close", executionOrderId: `fee-exec-${index}`, tradePlanId: plan.id, realizedPnl: 1, feeUsdt: 0.4, createdAt: `2026-08-02T${String(index).padStart(2, "0")}:00:00Z` }
    );
  };
  for (let index = 0; index < 6; index += 1) addFeeFlip(index);
  db.fills = financiallyReconciledFills(db.fills);
  const first = refreshKnowledgeSkillAttribution(db);
  assert.equal(first.graduated.length, 0);
  assert.equal(skill.status, "live_probation");
  assert.equal(skill.liveMetrics.wins, 0);
  assert.ok(Math.abs(skill.liveMetrics.weightedPnl + 1.2) < 1e-9);
  const attribution = db.knowledge.skillAttributions[0];
  assert.equal(attribution.grossRealizedPnl, 1);
  assert.ok(Math.abs(attribution.netRealizedPnl + 0.2) < 1e-9);
  assert.equal(attribution.financialSchemaVersion, 2);

  for (let index = 6; index < 10; index += 1) addFeeFlip(index);
  db.fills = financiallyReconciledFills(db.fills);
  const second = refreshKnowledgeSkillAttribution(db);
  assert.equal(second.graduated.length, 0);
  assert.ok(second.degraded.includes(skill.id));
  assert.equal(skill.status, "degraded");
  assert.equal(skill.executable, false);
  assert.equal(skill.liveMetrics.trades, 10);
  assert.equal(skill.liveMetrics.wins, 0);
});

test("试用技能真实亏损达阈值自动退役(降级)", () => {
  const db = dbFixture();
  const skill = compileTradingMethod(db, "method-1");
  skill.status = "live_probation";
  skill.executable = true;
  skill.approval = { approved: true, fingerprint: skill.fingerprint };
  for (let i = 0; i < 10; i += 1) {
    const plan = { id: `plan-l-${i}`, knowledgeSkills: [{ skillId: skill.id, version: skill.version, fingerprint: skill.fingerprint }] };
    db.tradePlans.push(plan);
    db.fills.push({ id: `fill-l-${i}`, kind: "close", executionOrderId: `exec-l-${i}`, tradePlanId: plan.id, realizedPnl: -3, createdAt: new Date(Date.now() + i * 1000).toISOString() });
  }
  db.fills = financiallyReconciledFills(db.fills);
  const r = refreshKnowledgeSkillAttribution(db);
  assert.ok(r.degraded.includes(skill.id));
  assert.equal(skill.status, "degraded");
  assert.equal(skill.executable, false);
});

test("已迁 v2 的孤儿实盘归因失去底层证据后清空指标并要求重新验证", () => {
  const db = dbFixture();
  const skill = compileTradingMethod(db, "method-1");
  skill.status = "active";
  skill.executable = true;
  skill.liveMetrics = { trades: 10, wins: 10, winRatePct: 100, weightedPnl: 10, profitFactor: null };
  db.knowledge.skillAttributions.push({
    id: "orphan-v2", fillKey: "missing-lifecycle", skillId: skill.id, skillVersion: skill.version,
    grossRealizedPnl: 10, netRealizedPnl: 9, realizedPnl: 9, weightedPnl: 9,
    financialSchemaVersion: 2, financialBasis: "completed_trade_lifecycle/net_after_recorded_entry_close_fees_and_funding"
  });
  const first = refreshKnowledgeSkillAttribution(db);
  const orphan = db.knowledge.skillAttributions[0];
  assert.equal(orphan.grossRealizedPnl, 10);
  assert.equal(orphan.netRealizedPnl, null);
  assert.equal(orphan.realizedPnl, null);
  assert.equal(orphan.weightedPnl, null);
  assert.equal(skill.liveMetrics.trades, 0);
  assert.equal(skill.liveMetrics.wins, 0);
  assert.equal(skill.liveMetrics.profitFactor, null);
  assert.match(skill.liveMetrics.basis, /needs_revalidation/);
  assert.equal(skill.needsRevalidation, true);
  assert.equal(skill.status, "degraded");
  assert.ok(first.degraded.includes(skill.id));

  const second = refreshKnowledgeSkillAttribution(db);
  assert.equal(second.migrated, 0, "重复迁移不得反复改写孤儿财务字段");
  assert.equal(second.degraded.length, 0, "重复迁移不得重复降级");
  assert.equal(skill.liveMetrics.trades, 0);
});

test("绑定到计划:试用技能信号触发即可绑定(用于真实成绩归因)", () => {
  const db = dbFixture();
  const skill = compileTradingMethod(db, "method-1");
  skill.status = "live_probation";
  skill.executable = true;
  skill.approval = { approved: true, fingerprint: skill.fingerprint };
  const plan = { id: "plan-x", symbol: "BTC/USDT", direction: "long", agentRunId: "run-1", entry_range: [100, 100], stop_loss: 98, take_profit: [104] };
  const bindings = bindKnowledgeSkillsToPlan(db, plan, { timeframe: "1h", regime: "上行趋势" });
  assert.equal(bindings.length, 1);
  assert.equal(plan.knowledgeSkills[0].skillId, skill.id);
});

test("聊天口述策略存成技能:合法则进入验证队列、缺要素则拒、逻辑无法映射则编译失败", async () => {
  const { createSkillFromIdea } = await import("../server/knowledgeSkills.mjs");
  const db = dbFixture();
  db.system = { skillLiveValidationMode: true };
  // 合法想法 → 编译，仍需历史/前向/审批
  const ok = createSkillFromIdea(db, {
    name: "我的唐奇安突破", direction: "long", timeframe: "1h",
    entry: "收盘价突破过去20根K线最高价", stop: "入场价下方2%", takeProfit: "2R", templateId: "breakout"
  }, "用户");
  assert.equal(ok.ok, true);
  assert.equal(ok.status, "compiled");
  assert.equal(ok.skill.userAuthored, true);
  assert.equal(ok.skill.spec.direction, "long");
  // 缺止损 → 拒绝(不编译)
  const noStop = createSkillFromIdea(db, { name: "缺止损", direction: "long", timeframe: "1h", entry: "突破" }, "用户");
  assert.equal(noStop.ok, false);
  assert.match(noStop.error, /止损/);
  // 缺名字 → 拒绝
  assert.equal(createSkillFromIdea(db, { direction: "long", timeframe: "1h", entry: "x", stop: "2%" }, "用户").ok, false);
  // 非法 templateId → 拒绝
  const badTpl = createSkillFromIdea(db, { name: "x", direction: "long", timeframe: "1h", entry: "突破", stop: "2%", templateId: "not_a_template" }, "用户");
  assert.equal(badTpl.ok, false);
  assert.match(badTpl.error, /templateId/);
});
