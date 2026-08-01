import test from "node:test";
import assert from "node:assert/strict";
import { staleEntryDecision } from "../server/executionEngine.mjs";

const now = () => new Date().toISOString();

// 截图那笔:做空,入场 63150-63250,止损 63350,止盈 62700/62450。
const shortEo = () => ({ direction: "short", entryPrice: 63200, stopLoss: 63350, takeProfits: [62700, 62450], entryPendingAt: now() });

test("截图场景:现价已跌破第一止盈、入场未成交 → 撤单并追趋势(followUp)", () => {
  const d = staleEntryDecision(shortEo(), 62661.5, { ttlMin: 90, devPct: 8 });
  assert.ok(d.reason, `应判定撤单,实际:${JSON.stringify(d)}`);
  assert.equal(d.followUp, true, "这波已自己走完、错过进场,应触发重评估追趋势");
  assert.match(d.reason, /止盈|错过进场/);
});

test("现价仍在入场上方、行情没走 → 不撤(继续等成交)", () => {
  // 做空挂 63150-63250,现价 63120(略低于入场,等反弹),没到止盈也没越止损,刚挂 → 不撤
  const d = staleEntryDecision(shortEo(), 63120, { ttlMin: 90, devPct: 8 });
  assert.equal(d.reason, null, `新鲜有效挂单不应被撤,实际:${JSON.stringify(d)}`);
});

test("现价越过止损 → 撤(成交即止损),非追趋势", () => {
  const d = staleEntryDecision(shortEo(), 63400, { ttlMin: 90, devPct: 8 });
  assert.ok(d.reason);
  assert.equal(d.followUp, false);
  assert.match(d.reason, /止损/);
});

test("挂单超时 → 撤", () => {
  const old = { ...shortEo(), entryPendingAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString() };
  const d = staleEntryDecision(old, 63120, { ttlMin: 90, devPct: 8 });
  assert.ok(d.reason);
  assert.match(d.reason, /保质期|未成交/);
});

test("做多镜像:现价已涨破第一止盈、入场未成交 → 撤单并追趋势", () => {
  const longEo = { direction: "long", entryPrice: 100, stopLoss: 97, takeProfits: [103, 105], entryPendingAt: now() };
  const d = staleEntryDecision(longEo, 103.5, { ttlMin: 90, devPct: 8 });
  assert.ok(d.reason);
  assert.equal(d.followUp, true);
});
