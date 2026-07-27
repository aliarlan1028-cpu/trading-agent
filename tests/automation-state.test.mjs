import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "automation-state-test-"));
process.env.DATA_DIR = dataDir;
delete process.env.I_UNDERSTAND_REAL_TRADING;
delete process.env.REAL_ORDER_WRITE_ENABLED;

const { deriveAutomationState } = await import("../server/ops.mjs");
const { ensureCuratedSkills } = await import("../server/knowledgeSkills.mjs");

function dbFixture() {
  return {
    system: { autonomyEnabled: true, killSwitch: false, liveTradingEnabled: false, remainingDailyLossUsdt: 100 },
    mandates: [{ id: "m1", status: "active", version: 1, allowedSymbols: ["BTC/USDT"], activatedAt: "2026-07-27T00:00:00.000Z" }],
    apiKeyMetadata: [{ id: "key_okx", exchange: "OKX", hasApiKey: true, hasSecret: true, withdrawPermission: false }],
    grayReleasePolicies: [],
    auditLogs: [],
    traces: []
  };
}

test("派生状态机:按执行链顺序给出单一结论", () => {
  const db = dbFixture();
  // 熔断优先级最高
  db.system.killSwitch = true;
  assert.equal(deriveAutomationState(db, { hasProvider: true }).mode, "halted");
  db.system.killSwitch = false;
  // 自主暂停
  db.system.autonomyEnabled = false;
  assert.equal(deriveAutomationState(db, { hasProvider: true }).mode, "paused");
  db.system.autonomyEnabled = true;
  // 无 LLM → 自主决策被拦
  const noLlm = deriveAutomationState(db, { hasProvider: false });
  assert.equal(noLlm.mode, "blocked");
  assert.ok(noLlm.blockers.includes("未配置 LLM"));
  // 实盘写入关闭 → 观察模式(干跑),这正是"自主运行中≠会自动下单"的诚实表述
  assert.equal(deriveAutomationState(db, { hasProvider: true }).mode, "observe");
});

test("实盘链:Key 未核验/灰度未启用逐项点名,全通且免批则为全自动小额", () => {
  const db = dbFixture();
  db.system.liveTradingEnabled = true;
  db.system.realTradingAck = true;
  db.system.orderWriteEnabled = true;
  // Key 未核验(permissionVerifiedAt 缺失) + 灰度未启用 → 实盘开仓被拦并点名
  let st = deriveAutomationState(db, { hasProvider: true });
  assert.equal(st.mode, "live_blocked");
  assert.ok(st.blockers.includes("API Key 权限未核验"));
  assert.ok(st.blockers.includes("灰度策略未启用"));
  // 补齐核验与灰度(保留人工确认) → 半自动
  db.apiKeyMetadata[0].permissionVerifiedAt = "2026-07-27T00:00:00.000Z";
  db.grayReleasePolicies.push({ id: "g1", enabled: true, requiresManualApproval: true, maxNotionalUsdt: 200 });
  st = deriveAutomationState(db, { hasProvider: true });
  assert.equal(st.mode, "semi_auto");
  // 关闭人工确认 → 全自动·小额
  db.grayReleasePolicies[0].requiresManualApproval = false;
  st = deriveAutomationState(db, { hasProvider: true });
  assert.equal(st.mode, "full_auto_small");
  assert.match(st.detail, /200 USDT/);
  // 日亏预算耗尽回落为被拦
  db.system.remainingDailyLossUsdt = 0;
  assert.equal(deriveAutomationState(db, { hasProvider: true }).mode, "blocked");
});

test("精选手写技能:入列5个已编译(含2个做空),幂等且不给被拒技能刷版本", () => {
  const db = {
    meta: {}, auditLogs: [], traces: [], fills: [], tradePlans: [], paperSessions: [], markets: [],
    knowledge: { sources: [], chunks: [], tradingMethods: [], tradingSkills: [], skillInvocations: [], skillAttributions: [] }
  };
  const first = ensureCuratedSkills(db);
  assert.equal(first.created, 5);
  const skills = db.knowledge.tradingSkills;
  assert.equal(skills.length, 5);
  assert.ok(skills.every((s) => s.status === "compiled" && s.curated === true));
  assert.equal(skills.filter((s) => s.spec.direction === "short").length, 2, "必须包含做空技能");
  assert.ok(skills.every((s) => s.spec.params.atrStop === true), "统一 ATR 自适应止损");
  // 幂等:再跑不新增
  assert.equal(ensureCuratedSkills(db).created, 0);
  assert.equal(db.knowledge.tradingSkills.length, 5);
  // 历史验证被拒后也不重编译刷版本
  skills[0].status = "historical_rejected";
  ensureCuratedSkills(db);
  assert.equal(db.knowledge.tradingSkills.length, 5);
  assert.equal(skills[0].status, "historical_rejected");
});
