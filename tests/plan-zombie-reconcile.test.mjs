import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "plan-zombie-"));

const { expireStalePlans } = await import("../server/agentOrchestrator.mjs");

// 回归:入场失败留下的 awaiting_approval 僵尸计划会冻结整条自主巡检(实锤 08:29 失败单卡 3h+)。
// expireStalePlans 必须在巡检开头把"关联执行单已 failed"的待批准/已批准计划就地置终态,
// 让 awaitingPlan 闸不再命中、巡检恢复进入 LLM 决策。
test("入场失败的 awaiting_approval 计划被即时作废(不等 TTL),解锁巡检", () => {
  const db = {
    tradePlans: [
      { id: "plan_zombie", symbol: "BTC/USDT", status: "awaiting_approval", timeframe: "15m", createdAt: new Date().toISOString() }
    ],
    executionOrders: [
      { id: "exec_fail", planId: "plan_zombie", status: "failed" }
    ],
    auditLogs: [], meta: {}
  };
  const expired = expireStalePlans(db);
  const plan = db.tradePlans[0];
  assert.equal(plan.status, "failed", "关联失败执行单的计划应置为终态 failed");
  assert.equal(plan.executionOrderId, "exec_fail", "应回填失败执行单以便追溯");
  assert.ok(expired.includes("plan_zombie"), "应计入本轮作废列表");
});

test("有失败执行单但计划已终态/无失败单的,不被误伤", () => {
  const db = {
    tradePlans: [
      { id: "plan_ok", symbol: "ETH/USDT", status: "approved", timeframe: "15m", createdAt: new Date().toISOString() },
      { id: "plan_done", symbol: "SOL/USDT", status: "completed", timeframe: "15m", createdAt: new Date().toISOString() }
    ],
    executionOrders: [
      { id: "exec_live", planId: "plan_ok", status: "entry_pending" }
    ],
    auditLogs: [], meta: {}
  };
  const expired = expireStalePlans(db);
  assert.equal(db.tradePlans[0].status, "approved", "执行单未失败的 approved 计划不应被作废");
  assert.equal(db.tradePlans[1].status, "completed", "已完成计划不应被触碰");
  assert.equal(expired.length, 0);
});
