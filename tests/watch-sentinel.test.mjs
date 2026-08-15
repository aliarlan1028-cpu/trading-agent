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
  abortWatchAnalysis,
  finalizeWatchAnalysis,
  publishWatchSweep,
  registerWatch,
  buildWatchBoard,
  requestPendingAgentCycle,
  sentinelCycleAllowed,
  sentinelGate,
  sweepWatches
} = await import("../server/watchSentinel.mjs");

// 回归:盯盘与 autonomy 解耦。旧 bug——autonomy 关时整个哨兵 paused,挂了哨不响、异动熄火。
test("盯盘闸:autonomy 关仍盯盘+通知,只是不自动唤起 AI;仅熔断才全停", () => {
  // autonomy 开:盯盘 + 自动分析都开
  assert.deepEqual(sentinelGate({ autonomyEnabled: true, killSwitch: false }), { monitor: true, autoAnalyze: true });
  // autonomy 关:仍盯盘(monitor=true),但不自动唤起 AI(autoAnalyze=false)——用户仍会收到触发通知
  assert.deepEqual(sentinelGate({ autonomyEnabled: false, killSwitch: false }), { monitor: true, autoAnalyze: false });
  // 熔断:全停(连盯盘都停,紧急语义)
  assert.deepEqual(sentinelGate({ autonomyEnabled: true, killSwitch: true }), { monitor: false, autoAnalyze: false });
  assert.deepEqual(sentinelGate({}), { monitor: true, autoAnalyze: false });
});

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

test("观察哨完整持久化判断链指纹、角色窗口和重置审计", () => {
  const db = dbFixture();
  const result = registerWatch(db, {
    symbol: "BTC/USDT", kind: "price_below", level: 64800, note: "回踩失败后复核空头",
    direction: "short", setupType: "breakdown_retest", traderRole: "day_trader",
    thesis: "15m 下破后等待回踩", triggerMeaning: "核对回踩衰竭与盈亏比",
    lineageVersion: 2, lineageStartedAt: "2026-08-14T00:00:00.000Z",
    thesisFingerprint: "watch-thesis-v2:test", structureFingerprint: "structure-test",
    structureEvidenceRef: "structure:btc:2", previousRootWatchId: "watch_old_root",
    reviewOfWatchIds: ["watch_old"], parentWatchId: "watch_old", reviewDepth: 0,
    reviewReasonCode: "structure_conflict", lineageResetReason: "deterministic_structure_changed",
    lineageResetEvidenceRef: "structure:btc:2", rearmWindowHours: 12, ttlHours: 4
  }, 65079);
  assert.equal(result.ok, true);
  assert.equal(result.watch.rootWatchId, result.watch.id);
  assert.equal(result.watch.lineageVersion, 2);
  assert.equal(result.watch.setupType, "breakdown_retest");
  assert.equal(result.watch.traderRole, "day_trader");
  assert.equal(result.watch.thesisFingerprint, "watch-thesis-v2:test");
  assert.equal(result.watch.structureFingerprint, "structure-test");
  assert.equal(result.watch.previousRootWatchId, "watch_old_root");
  assert.equal(result.watch.lineageResetReason, "deterministic_structure_changed");
  assert.equal(result.watch.rearmWindowHours, 12);
});

test("同轮观察哨按币种归组且只有一个主哨，新分析整体取代旧分析", () => {
  const db = dbFixture();
  const first = registerWatch(db, {
    symbol: "BTC/USDT", kind: "price_above", level: 65750, note: "突破确认",
    direction: "long", thesis: "1H 上行结构，等待突破后评估做多", triggerMeaning: "突破后复核量能与做多盈亏比",
    analysisId: "run_old", analysisAt: "2026-08-12T00:00:00.000Z", priority: "primary", purpose: "decision"
  }, 65079).watch;
  const invalidation = registerWatch(db, {
    symbol: "BTC/USDT", kind: "price_below", level: 64800, note: "结构失效",
    analysisId: "run_old", analysisAt: "2026-08-12T00:00:00.000Z", priority: "secondary", purpose: "invalidation"
  }, 65079).watch;
  let board = buildWatchBoard(db);
  assert.equal(board.length, 1);
  assert.equal(board[0].primary.id, first.id);
  assert.equal(board[0].primary.direction, "long");
  assert.equal(board[0].primary.displayDirection, "做多情景");
  assert.match(board[0].primary.displayThesis, /等待突破后评估做多/);
  assert.match(board[0].primary.displayTriggerMeaning, /复核量能/);
  assert.equal(board[0].secondary[0].id, invalidation.id);
  assert.equal(board[0].secondary[0].displayRole, "失效条件");

  const replacement = registerWatch(db, {
    symbol: "BTC/USDT", kind: "enter_zone", levelLow: 64500, levelHigh: 64800, note: "最新回踩方案",
    analysisId: "run_new", analysisAt: "2026-08-12T01:00:00.000Z", priority: "primary", purpose: "decision"
  }, 65079).watch;
  assert.equal(first.status, "superseded");
  assert.equal(invalidation.status, "superseded");
  assert.match(first.closeReason, /最新市场分析/);
  board = buildWatchBoard(db);
  assert.equal(board[0].count, 1);
  assert.equal(board[0].primary.id, replacement.id);
  assert.equal(board[0].analysisId, "run_new");
});

test("主观察哨结束后同轮辅助条件自动提升为主哨", () => {
  const db = dbFixture();
  const primary = registerWatch(db, { symbol: "BTC/USDT", kind: "price_above", level: 65750, note: "主", analysisId: "run", priority: "primary" }, 65079).watch;
  const backup = registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 64800, note: "备", analysisId: "run", priority: "secondary", purpose: "invalidation" }, 65079).watch;
  cancelWatch(db, primary.id, "Owner");
  assert.equal(primary.wasPrimary, true);
  assert.equal(backup.priority, "primary");
  assert.equal(buildWatchBoard(db)[0].primary.id, backup.id);
});

test("Agent 一轮分析完成后更新应用内看板但不推送例行 Telegram", () => {
  const previous = process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED;
  process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED = "true";
  const db = dbFixture();
  db.telegramWatchOutbox = [];
  const old = registerWatch(db, { symbol: "BTC/USDT", kind: "enter_zone", levelLow: 64000, levelHigh: 64500, note: "上一轮", analysisId: "run_previous", priority: "primary" }, 65079).watch;
  const next = registerWatch(db, { symbol: "BTC/USDT", kind: "price_above", level: 65750, note: "主", analysisId: "run_final", priority: "primary", deferTelegram: true }, 65079).watch;
  registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 64800, note: "失效", analysisId: "run_final", priority: "secondary", purpose: "invalidation", deferTelegram: true }, 65079);
  db.telegramWatchOutbox = [];
  assert.equal(next.status, "pending_analysis");
  assert.equal(old.status, "active", "AI 尚未完成时旧分析必须继续生效");
  assert.equal(buildWatchBoard(db)[0].primary.id, old.id);
  const result = finalizeWatchAnalysis(db, "run_final", { analysisAt: "2026-08-12T02:00:00.000Z", analysisTitle: "BTC 最新结论：等待关键价位" });
  assert.equal(result.finalized, 2);
  assert.deepEqual(result.symbols, ["BTC/USDT"]);
  assert.equal(db.telegramWatchOutbox.length, 0);
  assert.equal(old.status, "superseded");
  assert.equal(next.status, "active");
  if (previous === undefined) delete process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED;
  else process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED = previous;
});

test("Agent 分析失败会丢弃半成品观察哨并保留上一轮有效主哨", () => {
  const db = dbFixture();
  const old = registerWatch(db, { symbol: "BTC/USDT", kind: "price_below", level: 64800, note: "旧分析", analysisId: "old", priority: "primary" }, 65079).watch;
  const pending = registerWatch(db, { symbol: "BTC/USDT", kind: "price_above", level: 65750, note: "未完成分析", analysisId: "failed", priority: "primary", deferTelegram: true }, 65079).watch;
  const result = abortWatchAnalysis(db, "failed");
  assert.equal(result.aborted, 1);
  assert.equal(pending.status, "invalidated");
  assert.match(pending.closeReason, /未完成/);
  assert.equal(old.status, "active");
  assert.equal(buildWatchBoard(db)[0].primary.id, old.id);
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

test("实时行情命中与分钟哨兵共用通知链，必定写入站内通知和 Telegram outbox", () => {
  const previous = process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED;
  process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED = "true";
  const db = dbFixture();
  db.telegramWatchOutbox = [];
  registerWatch(db, {
    symbol: "BTC/USDT", kind: "price_below", level: 64800,
    direction: "short", thesis: "跌破关键支撑后评估做空", triggerMeaning: "支撑已失守，需要复核卖盘后决定是否做空"
  }, 65079);
  db.telegramWatchOutbox = [];
  const sweep = sweepWatches(db, new Map([["BTC/USDT", 64750]]));
  const published = publishWatchSweep(db, sweep, { autoAnalyze: true, actor: "MarketStream", realtime: true });
  assert.equal(published.triggered, 1);
  assert.equal(db.notifications[0].eventType, "watch_trigger");
  assert.match(db.notifications[0].title, /价格条件命中/);
  assert.match(db.notifications[0].body, /仅价格到位/);
  assert.match(db.notifications[0].body, /量能、K线收盘、形态与盈亏比尚未确认/);
  assert.match(db.notifications[0].body, /原判断/);
  assert.equal(db.telegramWatchOutbox.length, 1);
  assert.equal(db.telegramWatchOutbox[0].eventType, "triggered");
  assert.match(db.telegramWatchOutbox[0].message, /Short scenario/);
  if (previous === undefined) delete process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED;
  else process.env.TELEGRAM_WATCH_NOTIFIER_ENABLED = previous;
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

test("Agent 任务锁冲突不消耗哨兵每小时唤起额度", async () => {
  const { registerTaskHandler } = await import("../server/scheduler.mjs");
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  registerTaskHandler("test_agent_cycle_lock", async () => { await blocker; return { id: "run_test", status: "completed" }; });
  const db = dbFixture();
  db.system.pendingOpportunitySignals = [{ candidateId: "opp", symbol: "BTC/USDT", queuedAt: new Date().toISOString() }];
  db.tradePlans = [];
  db.tasks = [{ id: "task_sys_agent_cycle", name: "test", handler: "test_agent_cycle_lock", type: "Every", schedule: "Every 15m", enabled: true, systemManaged: true }];
  db.jobLocks = [];
  db.jobRuns = [];
  const first = requestPendingAgentCycle(db, null, "test_first");
  await new Promise((resolve) => setImmediate(resolve));
  const locked = await requestPendingAgentCycle(db, null, "test_locked");
  assert.equal(locked.run.status, "skipped_locked");
  assert.equal(db.system.sentinelCycleAt.length, 0, "锁冲突不能白白占一次额度");
  release();
  await first;
  assert.equal(db.system.sentinelCycleAt.length, 1);
});

test("patrol_only 没有进入 LLM 决策，不消耗唤起额度", async () => {
  const { registerTaskHandler } = await import("../server/scheduler.mjs");
  registerTaskHandler("test_agent_cycle_patrol", async () => ({ id: "run_patrol", status: "patrol_only" }));
  const db = dbFixture();
  db.system.pendingFastMoves = [{ symbol: "BTC/USDT", direction: "up", movePct: 3 }];
  db.tradePlans = [];
  db.tasks = [{ id: "task_sys_agent_cycle", name: "test", handler: "test_agent_cycle_patrol", type: "Every", schedule: "Every 15m", enabled: true, systemManaged: true }];
  db.jobLocks = [];
  db.jobRuns = [];
  const result = await requestPendingAgentCycle(db, null, "test_patrol");
  assert.equal(result.run.status, "ok");
  assert.match(result.run.output, /patrol_only/);
  assert.equal(db.system.sentinelCycleAt.length, 0);
});

test("撤销:活跃哨可撤,已结束哨不可重复撤", () => {
  const db = dbFixture();
  const w = registerWatch(db, { symbol: "BTC/USDT", kind: "price_above", level: 65750, note: "x" }, 65079).watch;
  assert.equal(cancelWatch(db, w.id, "Owner", "结构变化").ok, true);
  assert.equal(w.status, "cancelled");
  assert.match(cancelWatch(db, w.id).error, /未找到/);
});

test("快速异动探测:不依赖挂哨,窗内急速涨跌超阈值即生成异动+冷却", async () => {
  const { detectFastMoves, FAST_MOVE } = await import("../server/watchSentinel.mjs");
  const db = { system: {}, auditLogs: [], traces: [] };
  const base = 100;
  // t0:建基线(第一个样本,预热不足不判)
  let now = 1_000_000;
  detectFastMoves(db, new Map([["ADA/USDT", base]]), now);
  // 6分钟后价格没怎么动 → 不触发
  now += 6 * 60_000;
  let ev = detectFastMoves(db, new Map([["ADA/USDT", 99.9]]), now);
  assert.equal(ev.length, 0);
  // 再过1分钟,自窗内高点 100 跌到 96.5(-3.5% > 2.5%阈值) → 触发下跌异动
  now += 60_000;
  ev = detectFastMoves(db, new Map([["ADA/USDT", 96.5]]), now);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].direction, "down");
  assert.ok(ev[0].movePct >= FAST_MOVE.pct);
  // 冷却中:紧接着再跌也不重复触发
  now += 60_000;
  ev = detectFastMoves(db, new Map([["ADA/USDT", 95]]), now);
  assert.equal(ev.length, 0, "冷却期内不重复触发");
});

test("快速异动:窗内平缓移动不误触发", async () => {
  const { detectFastMoves } = await import("../server/watchSentinel.mjs");
  const db = { system: {}, auditLogs: [], traces: [] };
  let now = 2_000_000;
  detectFastMoves(db, new Map([["BTC/USDT", 65000]]), now);
  now += 6 * 60_000;
  const ev = detectFastMoves(db, new Map([["BTC/USDT", 65200]]), now); // +0.3%,远低于阈值
  assert.equal(ev.length, 0);
});
