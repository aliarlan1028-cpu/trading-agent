import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "strategy-board-"));
const { buildStrategyBoard, healthVerdict, refreshTrustedSkillMetrics } = await import("../server/strategyBoard.mjs");
const { financiallyReconciledFills } = await import("./financial-fixtures.mjs");

test("健康裁定:样本不足不误判,阈值=自动下线口径", () => {
  assert.equal(healthVerdict({ trades: 4, profitFactor: 0.1 }).key, "insufficient", "4笔样本不足,即便PF差也不判下线");
  assert.equal(healthVerdict({ trades: 12, profitFactor: 0.7 }).key, "retire");
  assert.equal(healthVerdict({ trades: 12, consecutiveLosses: 5, profitFactor: 1.5 }).key, "retire");
  assert.equal(healthVerdict({ trades: 12, profitFactor: 1.4 }).key, "good");
  assert.equal(healthVerdict({ trades: 12, profitFactor: 0.9 }).key, "watch");
});

test("看板聚合三类策略", () => {
  const db = {
    knowledge: { tradingSkills: [{ id: "ks1", name: "唐奇安", status: "live_probation", spec: { direction: "long", symbolScope: ["BTC"], timeframe: "1h" }, liveMetrics: { trades: 3 } }] },
    strategyProfiles: [{ symbol: "ADA/USDT", timeframe: "15m", strategyId: "macd", label: "MACD金叉", direction: "long", oosScore: 0.3 }],
    skills: [{ id: "sk_imp", name: "导入信号", native: false, trusted: true, status: "已启用", liveMetrics: { trades: 0 } }],
    fills: [], tradePlans: []
  };
  const board = buildStrategyBoard(db);
  assert.equal(board.rows.length, 3);
  assert.deepEqual(board.rows.map((r) => r.kind).sort(), ["knowledge", "profile", "trusted"]);
});

test("受信任 skill 实盘不达标自动撤信任+通知", () => {
  const db = {
    skills: [{ id: "sk_bad", name: "烂信号", native: false, trusted: true, status: "已启用" }],
    tradePlans: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, adoptedTrustedSkillIds: ["sk_bad"] })),
    fills: financiallyReconciledFills(Array.from({ length: 10 }, (_, i) => ({ kind: "close", tradePlanId: `p${i}`, executionOrderId: `pe${i}`, realizedPnl: -2 }))),
    auditLogs: [], notifications: []
  };
  const r = refreshTrustedSkillMetrics(db);
  assert.ok(r.untrusted.includes("sk_bad"));
  assert.equal(db.skills[0].trusted, false);
  assert.equal(db.notifications.length, 1);
});

test("受信任 skill 实盘达标自动转正(与流水线同生命周期)", () => {
  const db = {
    skills: [{ id: "sk_good", name: "好信号", native: false, trusted: true, trustStatus: "live_probation", status: "已启用" }],
    tradePlans: Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, adoptedTrustedSkillIds: ["sk_good"] })),
    fills: financiallyReconciledFills(Array.from({ length: 10 }, (_, i) => ({ kind: "close", tradePlanId: `g${i}`, executionOrderId: `ge${i}`, realizedPnl: 3 }))),
    auditLogs: [], notifications: []
  };
  const r = refreshTrustedSkillMetrics(db);
  assert.ok(r.graduated.includes("sk_good"));
  assert.equal(db.skills[0].trustStatus, "active");
  assert.equal(db.skills[0].trusted, true, "转正后仍受信任");
});

test("受信任 skill 的毛盈利被开平仓成本翻为净亏损时不得转正", () => {
  const db = {
    skills: [{ id: "sk_fee_flip", name: "成本后亏损信号", native: false, trusted: true, trustStatus: "live_probation", status: "已启用" }],
    tradePlans: Array.from({ length: 10 }, (_, i) => ({ id: `ff${i}`, adoptedTrustedSkillIds: ["sk_fee_flip"] })),
    fills: financiallyReconciledFills(Array.from({ length: 10 }, (_, i) => [
      { id: `entry-${i}`, kind: "entry", executionOrderId: `exec-${i}`, tradePlanId: `ff${i}`, feeUsdt: 0.8, createdAt: `2026-08-01T${String(i).padStart(2, "0")}:00:00Z` },
      { id: `close-${i}`, kind: "close", executionOrderId: `exec-${i}`, tradePlanId: `ff${i}`, realizedPnl: 1, feeUsdt: 0.4, createdAt: `2026-08-02T${String(i).padStart(2, "0")}:00:00Z` }
    ]).flat()),
    executionOrders: [], auditLogs: [], notifications: []
  };
  const result = refreshTrustedSkillMetrics(db);
  assert.equal(result.graduated.length, 0);
  assert.ok(result.untrusted.includes("sk_fee_flip"));
  assert.equal(db.skills[0].liveMetrics.wins, 0);
  assert.equal(db.skills[0].liveMetrics.netRealizedPnl, -2);
  assert.equal(db.skills[0].liveMetrics.grossRealizedPnl, 10);
});
