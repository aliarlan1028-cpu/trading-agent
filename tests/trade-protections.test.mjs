// freqtrade 式交易保护:连亏冷却 + 回撤锁仓的边界条件。
// 这些直接决定"要不要暂停开仓"——算错就是过度交易或误锁。
import test from "node:test";
import assert from "node:assert/strict";
import { consecutiveLossCooldown, drawdownLockout, evaluateProtections } from "../server/tradeProtections.mjs";

const HOUR = 3600000;
// 造已平仓成交:pnl + 距今小时数
const fill = (pnl, hoursAgo) => ({ kind: "close", realizedPnl: pnl, createdAt: new Date(Date.now() - hoursAgo * HOUR).toISOString() });

test("连亏冷却:尾部连续3笔亏损且在冷却窗内 → 触发", () => {
  const db = { fills: [fill(50, 10), fill(-20, 3), fill(-15, 2), fill(-25, 1)] };
  const r = consecutiveLossCooldown(db);
  assert.equal(r.active, true);
  assert.equal(r.streak, 3);
  assert.ok(r.until); // 有解除时间
});

test("连亏冷却:连亏但已过冷却窗(默认4h)→ 自动解除", () => {
  const db = { fills: [fill(-20, 30), fill(-15, 29), fill(-25, 28)] };
  assert.equal(consecutiveLossCooldown(db).active, false);
});

test("连亏冷却:最近一笔盈利打断连亏 → 不触发", () => {
  const db = { fills: [fill(-20, 3), fill(-15, 2), fill(30, 1)] };
  const r = consecutiveLossCooldown(db);
  assert.equal(r.active, false);
  assert.equal(r.streak, 0);
});

test("连亏冷却:仅2笔亏损(<阈值3)→ 不触发", () => {
  const db = { fills: [fill(-20, 2), fill(-15, 1)] };
  assert.equal(consecutiveLossCooldown(db).active, false);
});

test("连亏冷却:阈值可用 env 覆盖", () => {
  const prev = process.env.PROTECT_MAX_CONSEC_LOSSES;
  process.env.PROTECT_MAX_CONSEC_LOSSES = "2";
  try {
    const db = { fills: [fill(-20, 2), fill(-15, 1)] };
    assert.equal(consecutiveLossCooldown(db).active, true); // 阈值2时2连亏即触发
  } finally { if (prev === undefined) delete process.env.PROTECT_MAX_CONSEC_LOSSES; else process.env.PROTECT_MAX_CONSEC_LOSSES = prev; }
});

test("回撤锁仓:成交盈亏曲线从峰值回撤≥权益10% → 触发", () => {
  // 峰值 +200,回落到 +40 → 回撤 160 / 权益1000 = 16% ≥ 10%
  const db = { portfolio: { totalEquityUsdt: 1000 }, fills: [fill(100, 5), fill(100, 4), fill(-80, 3), fill(-70, 2), fill(-10, 1)] };
  const r = drawdownLockout(db);
  assert.equal(r.active, true);
  assert.ok(r.drawdownPct >= 10);
});

test("回撤锁仓:样本不足(<3笔)→ 不评估、不触发", () => {
  const db = { portfolio: { totalEquityUsdt: 1000 }, fills: [fill(-50, 1)] };
  assert.equal(drawdownLockout(db).active, false);
});

test("回撤锁仓:权益为0/缺失 → 不触发(不除零)", () => {
  const db = { portfolio: { totalEquityUsdt: 0 }, fills: [fill(100, 3), fill(-80, 2), fill(-70, 1)] };
  assert.equal(drawdownLockout(db).active, false);
});

test("回撤锁仓:小回撤(<阈值)→ 不触发", () => {
  const db = { portfolio: { totalEquityUsdt: 1000 }, fills: [fill(100, 3), fill(50, 2), fill(-10, 1)] };
  assert.equal(drawdownLockout(db).active, false);
});

test("evaluateProtections:总开关关闭 → 不启用、不拦", () => {
  const db = { system: { protectionsEnabled: false }, portfolio: { totalEquityUsdt: 1000 }, fills: [fill(-20, 3), fill(-15, 2), fill(-25, 1)] };
  const r = evaluateProtections(db);
  assert.equal(r.enabled, false);
  assert.equal(r.blocked, false);
});

test("evaluateProtections:默认开启,连亏触发 → blocked=true", () => {
  const db = { system: {}, portfolio: { totalEquityUsdt: 1000 }, fills: [fill(-20, 3), fill(-15, 2), fill(-25, 1)] };
  const r = evaluateProtections(db);
  assert.equal(r.enabled, true);
  assert.equal(r.blocked, true);
});
