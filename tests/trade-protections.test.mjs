// freqtrade 式交易保护:连亏冷却 + 回撤锁仓的边界条件。
// 这些直接决定"要不要暂停开仓"——算错就是过度交易或误锁。
import test from "node:test";
import assert from "node:assert/strict";
import { consecutiveLossCooldown, drawdownLockout, evaluateProtections } from "../server/tradeProtections.mjs";
import { financiallyReconciledFills, reconciledFill } from "./financial-fixtures.mjs";

const HOUR = 3600000;
// 造已平仓成交:pnl + 距今小时数
const fill = (pnl, hoursAgo) => reconciledFill({ kind: "close", executionOrderId: `fixture-${pnl}-${hoursAgo}`, realizedPnl: pnl, createdAt: new Date(Date.now() - hoursAgo * HOUR).toISOString() });

const completeDb = (fills, extra = {}) => ({ ...extra, fills: financiallyReconciledFills(fills) });

test("连亏冷却:尾部连续3笔亏损且在冷却窗内 → 触发", () => {
  const db = completeDb([fill(50, 10), fill(-20, 3), fill(-15, 2), fill(-25, 1)]);
  const r = consecutiveLossCooldown(db);
  assert.equal(r.active, true);
  assert.equal(r.streak, 3);
  assert.ok(r.until); // 有解除时间
});

test("连亏冷却:连亏但已过冷却窗(默认4h)→ 自动解除", () => {
  const db = completeDb([fill(-20, 30), fill(-15, 29), fill(-25, 28)]);
  assert.equal(consecutiveLossCooldown(db).active, false);
});

test("连亏冷却:最近一笔盈利打断连亏 → 不触发", () => {
  const db = completeDb([fill(-20, 3), fill(-15, 2), fill(30, 1)]);
  const r = consecutiveLossCooldown(db);
  assert.equal(r.active, false);
  assert.equal(r.streak, 0);
});

test("连亏冷却:仅2笔亏损(<阈值3)→ 不触发", () => {
  const db = completeDb([fill(-20, 2), fill(-15, 1)]);
  assert.equal(consecutiveLossCooldown(db).active, false);
});

test("同一交易的多次部分平仓只算一个连亏生命周期", () => {
  const executionOrderId = "exec_partial";
  const db = completeDb([
      { ...fill(-5, 2), id: "partial-1", executionOrderId, partial: true },
      { ...fill(-7, 1.5), id: "partial-2", executionOrderId, partial: true },
      { ...fill(-8, 1), id: "final", executionOrderId, partial: false }
  ]);
  const result = consecutiveLossCooldown(db);
  assert.equal(result.streak, 1);
  assert.equal(result.active, false);
});

test("毛盈利被开平仓费翻为净亏损时仍触发连亏冷却和回撤锁仓", () => {
  const fills = [];
  for (let index = 0; index < 3; index += 1) {
    const executionOrderId = `fee-flip-${index}`;
    fills.push(
      { id: `entry-${index}`, kind: "entry", executionOrderId, feeUsdt: 0.8, createdAt: new Date(Date.now() - (index + 2) * HOUR).toISOString() },
      { id: `close-${index}`, kind: "close", executionOrderId, realizedPnl: 1, feeUsdt: 1.2, createdAt: new Date(Date.now() - (2 - index) * 30 * 60_000).toISOString() }
    );
  }
  const db = completeDb(fills, { portfolio: { totalEquityUsdt: 10 } });
  const cooldown = consecutiveLossCooldown(db);
  assert.equal(cooldown.streak, 3);
  assert.equal(cooldown.active, true, "three net losses must not be hidden by positive exchange-price PnL");
  const drawdown = drawdownLockout(db);
  assert.equal(drawdown.active, true);
  assert.equal(drawdown.drawdownUsdt, 3);
  assert.equal(drawdown.drawdownPct, 30);
});

test("连亏冷却:阈值可用 env 覆盖", () => {
  const prev = process.env.PROTECT_MAX_CONSEC_LOSSES;
  process.env.PROTECT_MAX_CONSEC_LOSSES = "2";
  try {
    const db = completeDb([fill(-20, 2), fill(-15, 1)]);
    assert.equal(consecutiveLossCooldown(db).active, true); // 阈值2时2连亏即触发
  } finally { if (prev === undefined) delete process.env.PROTECT_MAX_CONSEC_LOSSES; else process.env.PROTECT_MAX_CONSEC_LOSSES = prev; }
});

test("回撤锁仓:成交盈亏曲线从峰值回撤≥权益10% → 触发", () => {
  // 峰值 +200,回落到 +40 → 回撤 160 / 权益1000 = 16% ≥ 10%
  const db = completeDb([fill(100, 5), fill(100, 4), fill(-80, 3), fill(-70, 2), fill(-10, 1)], { portfolio: { totalEquityUsdt: 1000 } });
  const r = drawdownLockout(db);
  assert.equal(r.active, true);
  assert.ok(r.drawdownPct >= 10);
});

test("回撤锁仓:样本不足(<3笔)→ 不评估、不触发", () => {
  const db = completeDb([fill(-50, 1)], { portfolio: { totalEquityUsdt: 1000 } });
  assert.equal(drawdownLockout(db).active, false);
});

test("回撤锁仓:权益为0/缺失 → 不触发(不除零)", () => {
  const db = completeDb([fill(100, 3), fill(-80, 2), fill(-70, 1)], { portfolio: { totalEquityUsdt: 0 } });
  assert.equal(drawdownLockout(db).active, false);
});

test("回撤锁仓:小回撤(<阈值)→ 不触发", () => {
  const db = completeDb([fill(100, 3), fill(50, 2), fill(-10, 1)], { portfolio: { totalEquityUsdt: 1000 } });
  assert.equal(drawdownLockout(db).active, false);
});

test("evaluateProtections:总开关关闭 → 不启用、不拦", () => {
  const db = completeDb([fill(-20, 3), fill(-15, 2), fill(-25, 1)], { system: { protectionsEnabled: false }, portfolio: { totalEquityUsdt: 1000 } });
  const r = evaluateProtections(db);
  assert.equal(r.enabled, false);
  assert.equal(r.blocked, false);
});

test("evaluateProtections:默认开启,连亏触发 → blocked=true", () => {
  const db = completeDb([fill(-20, 3), fill(-15, 2), fill(-25, 1)], { system: {}, portfolio: { totalEquityUsdt: 1000 } });
  const r = evaluateProtections(db);
  assert.equal(r.enabled, true);
  assert.equal(r.blocked, true);
});
