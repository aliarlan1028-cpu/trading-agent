import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "watch-sentinel-test-"));
process.env.DATA_DIR = dataDir;

const {
  WATCH_LIMITS,
  cancelWatch,
  conditionAlreadyTrue,
  consumeTriggeredWatches,
  crossed,
  registerWatch,
  sentinelCycleAllowed,
  sweepWatches
} = await import("../server/watchSentinel.mjs");

function dbFixture() {
  return {
    system: { autonomyEnabled: true, killSwitch: false },
    auditLogs: [],
    traces: [],
    notifications: [],
    watchTriggers: [],
    mandates: [{ id: "m1", status: "active", version: 1, allowedSymbols: ["BTC/USDT", "SUI/USDT"], activatedAt: "2026-07-27T00:00:00.000Z" }]
  };
}

test("登记校验:白名单/已成立条件/离谱价位/上限全部拒绝", () => {
  const db = dbFixture();
  // 非白名单
  assert.match(registerWatch(db, { symbol: "DOGE/USDT", kind: "price_below", level: 0.1, note: "x" }, 0.12).error, /白名单/);
  // 条件已成立(现价 64000 已低于 65000,挂"跌破 65000"没有意义)
  assert.match(registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 65000, note: "x" }, 64000).error, /已成立/);
  // 价位偏离现价超 15% 视为笔误
  assert.match(registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 40000, note: "x" }, 65000).error, /笔误/);
  // 正常登记
  const ok = registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 64800, note: "跌破则评估短空" }, 65079);
  assert.equal(ok.ok, true);
  assert.equal(ok.watch.status, "active");
  // 同币同向近价位 → 合并更新而不是新增
  const twin = registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 64810, note: "更新" }, 65079);
  assert.equal(twin.updated, true);
  assert.equal(db.watchTriggers.length, 1);
  // 单币上限
  registerWatch(db, { symbol: "BTC/USDT", kind: "price_above", level: 65750, note: "突破" }, 65079);
  registerWatch(db, { symbol: "BTC/USDT", kind: "enter_zone", levelLow: 60000, levelHigh: 61000, note: "深回踩" }, 65079);
  assert.match(registerWatch(db, { symbol: "BTC/USDT", kind: "price_above", level: 66500, note: "再一个" }, 65079).error, new RegExp(`上限 ${WATCH_LIMITS.maxPerSymbol}`));
});

test("穿越语义:静态高于/低于不触发,只有从未成立到成立才触发,且一次性", () => {
  const below = { kind: "price_below", level: 64800 };
  assert.equal(crossed(below, 65000, 64900), false, "未到位不触发");
  assert.equal(crossed(below, 64700, 64600), false, "一直在下方(未穿越)不触发");
  assert.equal(crossed(below, 64900, 64750), true, "自上而下穿越触发");
  const zone = { kind: "enter_zone", levelLow: 64800, levelHigh: 65000 };
  assert.equal(crossed(zone, 64900, 64950), false, "本来就在区间内不触发");
  assert.equal(crossed(zone, 65200, 64950), true, "从区间外进入触发");
  assert.equal(conditionAlreadyTrue({ kind: "price_above", level: 65750 }, 65800), true);

  const db = dbFixture();
  registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 64800, note: "x" }, 65079);
  // tick1:价格未到 → 不触发,基线推进
  let r = sweepWatches(db, new Map([["BTC/USDT", 64900]]));
  assert.equal(r.triggered.length, 0);
  // tick2:穿越 → 触发一次,状态离开 active,之后不会再触发
  r = sweepWatches(db, new Map([["BTC/USDT", 64750]]));
  assert.equal(r.triggered.length, 1);
  assert.equal(r.triggered[0].triggerPrice, 64750);
  r = sweepWatches(db, new Map([["BTC/USDT", 64600]]));
  assert.equal(r.triggered.length, 0, "已触发的哨不重复触发");
  // 巡检消费:一次拿走并标记,再次消费为空
  assert.equal(consumeTriggeredWatches(db).length, 1);
  assert.equal(consumeTriggeredWatches(db).length, 0);
});

test("行情缺失不漏触发:跳过的 tick 后仍能用旧基线检出穿越", () => {
  const db = dbFixture();
  registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 64800, note: "x" }, 65079);
  // 行情拉取失败(无该币价格):基线保持 65079
  let r = sweepWatches(db, new Map());
  assert.equal(r.triggered.length, 0);
  // 恢复后价格已在条件区:相对旧基线仍是穿越 → 触发(迟到但不漏)
  r = sweepWatches(db, new Map([["BTC/USDT", 64700]]));
  assert.equal(r.triggered.length, 1);
});

test("过期/授权变更清扫 + 暂停恢复重定基:越过条件的哨作废而非误触发", () => {
  const db = dbFixture();
  const w1 = registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 64800, note: "x" }, 65079).watch;
  const w2 = registerWatch(db, { symbol: "SUI/USDT", kind: "price_above", level: 0.75, note: "y" }, 0.71).watch;
  // w1 过期
  w1.expiresAt = new Date(Date.now() - 1000).toISOString();
  let r = sweepWatches(db, new Map());
  assert.equal(r.expired.length, 1);
  assert.equal(w1.status, "expired");
  // 授权白名单移除 SUI → 哨自动撤销
  db.mandates[0].allowedSymbols = ["BTC/USDT"];
  r = sweepWatches(db, new Map());
  assert.equal(w2.status, "cancelled");
  // 暂停恢复重定基:lastPrice=null 且价格已越过条件 → 作废(不基于暂停期结构触发)
  db.mandates[0].allowedSymbols = ["BTC/USDT", "SUI/USDT"];
  const w3 = registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 64800, note: "z" }, 65079).watch;
  w3.lastPrice = null;
  r = sweepWatches(db, new Map([["BTC/USDT", 64500]]));
  assert.equal(r.triggered.length, 0);
  assert.equal(w3.status, "invalidated");
  // 重定基后未越过 → 仅重建基线,后续穿越正常触发
  const w4 = registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 64000, note: "q" }, 64500).watch;
  w4.lastPrice = null;
  sweepWatches(db, new Map([["BTC/USDT", 64500]]));
  assert.equal(w4.lastPrice, 64500);
  r = sweepWatches(db, new Map([["BTC/USDT", 63900]]));
  assert.equal(r.triggered.length, 1);
});

test("哨兵触发 LLM 巡检限频:每小时最多 4 次,过期记录滚动清理", () => {
  const db = dbFixture();
  const now = Date.now();
  db.system.sentinelCycleAt = [1, 2, 3].map((i) => new Date(now - i * 60_000).toISOString());
  assert.equal(sentinelCycleAllowed(db, now), true, "3 次未达上限");
  db.system.sentinelCycleAt.push(new Date(now - 4 * 60_000).toISOString());
  assert.equal(sentinelCycleAllowed(db, now), false, "4 次达到上限");
  // 一小时前的记录滚动过期后恢复可用
  db.system.sentinelCycleAt = [1, 2, 3, 4].map((i) => new Date(now - 3_600_000 - i * 60_000).toISOString());
  assert.equal(sentinelCycleAllowed(db, now), true);
  assert.equal(db.system.sentinelCycleAt.length, 0);
});

test("撤销:活跃哨可撤,已结束哨不可重复撤", () => {
  const db = dbFixture();
  const w = registerWatch(db, { symbol: "BTC/USDT", kind: "price_above", level: 65750, note: "x" }, 65079).watch;
  assert.equal(cancelWatch(db, w.id, "Owner", "结构变化").ok, true);
  assert.equal(w.status, "cancelled");
  assert.match(cancelWatch(db, w.id).error, /未找到/);
});
