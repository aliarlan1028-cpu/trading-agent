import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "armed-setup-test-"));

const {
  armedSetupAutomationAllowed,
  armTradeSetup,
  compileConfirmationText,
  observeArmedSetupPrice,
  processArmedSetupTick,
  reconcileArmedSetupDefinitions,
  reconcileArmedSetupExecutions,
  recoverTriggeredSetups
} = await import("../server/armedSetup.mjs");
const { loadDb, saveDb, seedDatabase } = await import("../server/store.mjs");

function fixture() {
  const now = new Date().toISOString();
  const plan = {
    id: "plan_1",
    mandateId: "mandate_1",
    mandateVersion: 3,
    symbol: "BTC/USDT",
    direction: "long",
    entry_range: [100, 102],
    stopLoss: 96,
    takeProfit: [112],
    status: "awaiting_approval",
    lastRiskCheck: { id: "risk_arm", passed: true },
    riskCheckId: "risk_arm",
    evidenceBundleId: "evidence_1",
    analysisBundleId: "analysis_1",
    createdAt: now
  };
  return {
    meta: { updatedAt: now },
    system: { liveTradingEnabled: false },
    mandates: [{ id: "mandate_1", status: "active", version: 3, allowedSymbols: ["BTC/USDT"], activatedAt: now }],
    tradePlans: [plan],
    armedSetups: [],
    markets: [{ symbol: "BTC/USDT", price: 100, lastRealtimeAt: now }],
    executionOrders: [],
    riskChecks: [],
    exchangeAccounts: [],
    notifications: [],
    auditLogs: [],
    traces: []
  };
}

function arm(db) {
  return armTradeSetup(db, {
    plan: db.tradePlans[0],
    currentPrice: 100,
    trigger: { kind: "price_above", level: 101 },
    ttlHours: 4
  });
}

test("武装入口只接受刚通过硬风控的白名单计划", () => {
  const db = fixture();
  db.tradePlans[0].lastRiskCheck.passed = false;
  assert.equal(arm(db).error, "plan_not_risk_approved");
  db.tradePlans[0].lastRiskCheck.passed = true;
  assert.equal(arm(db).ok, true);
  assert.equal(db.tradePlans[0].status, "armed");
  assert.equal(db.armedSetups[0].riskCheckId, "risk_arm");
  assert.equal(db.armedSetups[0].evidenceBundleId, "evidence_1");
  assert.equal(armedSetupAutomationAllowed({ mode: "full_auto_small" }, true), true);
  assert.equal(armedSetupAutomationAllowed({ mode: "observe" }, false), true);
  assert.equal(armedSetupAutomationAllowed({ mode: "semi_auto" }, true), false, "半自动批准会立即执行，不能伪装成 armed");
});

test("默认不允许追加仓位时，同币种始终只保留最新且已通过风控的一条", () => {
  const db = fixture();
  db.tradePlans[0].max_loss_pct = 10;
  assert.equal(arm(db).ok, true);
  const firstSetup = db.armedSetups[0];
  const safer = {
    ...db.tradePlans[0],
    id: "plan_safer",
    status: "awaiting_approval",
    max_loss_pct: 5,
    entry_range: [101, 103],
    lastRiskCheck: { id: "risk_safer", passed: true }
  };
  delete safer.armedSetupId; delete safer.armedTrigger; delete safer.armedExpiresAt;
  db.tradePlans.unshift(safer);
  const result = armTradeSetup(db, { plan: safer, currentPrice: 100, trigger: { kind: "price_above", level: 101 }, ttlHours: 4 });
  assert.equal(result.ok, true);
  assert.equal(firstSetup.status, "SUPERSEDED");
  assert.equal(db.tradePlans.find((row) => row.id === "plan_1").status, "cancelled");
  assert.equal(db.armedSetups.filter((row) => row.status === "ARMED").length, 1);

  const riskier = { ...safer, id: "plan_riskier", status: "awaiting_approval", max_loss_pct: 8, lastRiskCheck: { id: "risk_riskier", passed: true } };
  delete riskier.armedSetupId; delete riskier.armedTrigger; delete riskier.armedExpiresAt;
  db.tradePlans.unshift(riskier);
  const replacement = armTradeSetup(db, { plan: riskier, currentPrice: 100, trigger: { kind: "price_above", level: 101 }, ttlHours: 4 });
  assert.equal(replacement.ok, true);
  assert.equal(result.setup.status, "SUPERSEDED");
  assert.equal(db.armedSetups.filter((row) => row.status === "ARMED").length, 1);
});

test("多阶段场景先确认突破，再等待回踩，只有最后阶段才进入执行器", async () => {
  const db = fixture();
  db.tradePlans[0].entry_range = [104.5, 105];
  db.tradePlans[0].stopLoss = 98;
  const armed = armTradeSetup(db, {
    plan: db.tradePlans[0], currentPrice: 100,
    trigger: { kind: "price_above", level: 105 },
    scenario: {
      type: "breakout_retest",
      groupId: "BTC-breakout-1",
      stages: [
        { id: "breakout", label: "确认突破", trigger: { kind: "price_above", level: 105 } },
        { id: "retest", label: "等待回踩", trigger: { kind: "enter_zone", levelLow: 104.5, levelHigh: 105 } }
      ]
    }
  });
  assert.equal(armed.ok, true, JSON.stringify(armed));
  let executions = 0;
  let riskChecks = 0;
  const options = {
    refreshFacts: async () => ({ ok: true }),
    evaluateTradePlan: () => { riskChecks += 1; return { id: "risk_stage", passed: true, summary: "passed" }; },
    deriveAutomationState: () => ({ mode: "observe" }),
    executeApprovedPlan: async () => { executions += 1; return { status: "dry_run" }; }
  };
  db.markets[0].price = 105.2;
  db.markets[0].lastRealtimeAt = new Date().toISOString();
  const first = await processArmedSetupTick(db, "BTC/USDT", 105.2, options);
  assert.equal(first.executions[0].status, "SCENARIO_STAGE_ADVANCED");
  assert.equal(db.armedSetups[0].scenario.currentStageIndex, 1);
  assert.equal(db.armedSetups[0].status, "ARMED");
  assert.equal(executions, 0);
  assert.equal(riskChecks, 0, "中间阶段不能提前消耗最终下单风控或执行权限");

  db.markets[0].price = 104.8;
  db.markets[0].lastRealtimeAt = new Date().toISOString();
  const final = await processArmedSetupTick(db, "BTC/USDT", 104.8, options);
  assert.equal(final.executions[0].status, "DRY_RUN", JSON.stringify(final));
  assert.equal(executions, 1);
  assert.equal(riskChecks, 1);
});

test("回踩阶段结束时价格仍在区间内，可进入独立K线确认阶段而不是误判场景冲突", async () => {
  const db = fixture();
  db.tradePlans[0].entry_range = [104.5, 105];
  db.tradePlans[0].stopLoss = 98;
  const armed = armTradeSetup(db, {
    plan: db.tradePlans[0], currentPrice: 100,
    trigger: { kind: "price_above", level: 105 },
    scenario: {
      type: "breakout_retest",
      stages: [
        { id: "breakout", label: "确认突破", kind: "price_above", level: 105 },
        { id: "retest", label: "等待回踩", kind: "enter_zone", levelLow: 104.5, levelHigh: 105 },
        {
          id: "confirm", label: "等待止跌确认", kind: "enter_zone", levelLow: 104.5, levelHigh: 105,
          confirmation: "1H 下影拒绝",
          confirmations: [{ kind: "rejection_wick", timeframe: "1h", threshold: 0.35, candleDirection: "bullish" }]
        }
      ]
    }
  });
  assert.equal(armed.ok, true, JSON.stringify(armed));
  let executions = 0;
  const options = {
    refreshFacts: async () => ({ ok: true }),
    evaluateTradePlan: () => ({ id: "risk_three_stage", passed: true, summary: "passed" }),
    deriveAutomationState: () => ({ mode: "observe" }),
    executeApprovedPlan: async () => { executions += 1; return { status: "dry_run" }; }
  };
  db.markets[0].price = 105.2;
  db.markets[0].lastRealtimeAt = new Date().toISOString();
  assert.equal((await processArmedSetupTick(db, "BTC/USDT", 105.2, options)).executions[0].status, "SCENARIO_STAGE_ADVANCED");

  db.markets[0].price = 104.8;
  db.markets[0].lastRealtimeAt = new Date().toISOString();
  const retest = await processArmedSetupTick(db, "BTC/USDT", 104.8, options);
  assert.equal(retest.executions[0].status, "SCENARIO_STAGE_ADVANCED", JSON.stringify(retest.executions[0]));
  assert.equal(db.armedSetups[0].scenario.currentStageIndex, 2);
  assert.equal(db.armedSetups[0].confirmationPending, true);
  assert.equal(executions, 0);

  const confirmationStartedAt = new Date(db.armedSetups[0].confirmationWindowStartedAt).getTime();
  db.markets[0].candlesByTf = { "1h": { syncedAt: new Date().toISOString(), candles: [
    { time: confirmationStartedAt, open: 104.7, high: 104.9, low: 103.7, close: 104.8, volume: 10 }
  ] } };
  db.armedSetups[0].nextConfirmationCheckAt = new Date(Date.now() - 1).toISOString();
  db.markets[0].lastRealtimeAt = new Date().toISOString();
  const confirmed = await processArmedSetupTick(db, "BTC/USDT", 104.8, options);
  assert.equal(confirmed.executions[0].status, "DRY_RUN", JSON.stringify(confirmed.executions[0]));
  assert.equal(executions, 1);
});

test("自然语言确认条件会编译为可计算规则，无法计算的描述会拒绝", () => {
  const compiled = compileConfirmationText("1H 出现 pin bar/拒绝/量缩，确认假突破", { direction: "short", timeframe: "1h", levelLow: 0.698, levelHigh: 0.702 });
  assert.equal(compiled.valid, true);
  assert.equal(compiled.mode, "any");
  assert.deepEqual(compiled.rules.map((row) => row.kind), ["rejection_wick", "volume_contraction", "close_below"]);
  assert.equal(compileConfirmationText("等聪明钱感觉合适再进", { direction: "short" }).valid, false);
});

test("确认周期取信号附近周期而不是结构背景周期", () => {
  const fifteen = compileConfirmationText("价格回踩4H需求区，出现15m止跌信号（pin bar/缩量企稳）后做多", { direction: "long", timeframe: "4h" });
  assert.equal(fifteen.valid, true);
  assert.deepEqual(fifteen.rules.map((row) => row.timeframe), ["15m", "15m"]);
  const oneHour = compileConfirmationText("4H上升结构回踩后出现1H拒绝信号", { direction: "long", timeframe: "4h" });
  assert.equal(oneHour.rules[0].timeframe, "1h");
});

test("否定确认不会反向编译：不出现放量阴线=禁止1H阴线放量", () => {
  const compiled = compileConfirmationText("1H 不出现放量阴线反包，保持向上结构", { direction: "long", timeframe: "1h" });
  assert.equal(compiled.valid, true);
  assert.deepEqual(compiled.rules.map((rule) => rule.kind), ["engulfing", "volume_expansion"]);
  for (const rule of compiled.rules) {
    assert.equal(rule.timeframe, "1h");
    assert.equal(rule.negate, true);
    assert.equal(rule.candleDirection, "bearish");
  }
});

test("吞没形态与文字阈值会被完整编译，不能只执行文字中的一半", () => {
  const compiled = compileConfirmationText("1H 看跌拒绝：上影线≥50%或吞没阴线", { direction: "short", timeframe: "1h" });
  assert.equal(compiled.valid, true);
  assert.equal(compiled.mode, "any");
  assert.deepEqual(compiled.rules.map((rule) => rule.kind), ["rejection_wick", "engulfing"]);
  assert.equal(compiled.rules[0].threshold, 0.5);
  assert.equal(compiled.rules[1].candleDirection, "bearish");
});

test("显式确认规则与给用户看的文字不一致时拒绝武装", () => {
  const db = fixture();
  const result = armTradeSetup(db, {
    plan: db.tradePlans[0], currentPrice: 100,
    trigger: {
      kind: "price_above", level: 101,
      confirmation: "价格回踩4H需求区，出现15m止跌信号（pin bar）后做多",
      confirmations: [{ kind: "rejection_wick", timeframe: "4h", threshold: 0.35 }]
    }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "confirmation_rules_mismatch_text");
});

test("隐藏的额外确认、遗漏的吞没条件和不同阈值都会拒绝登记", () => {
  const cases = [
    {
      confirmation: "仅价格",
      confirmations: [{ kind: "rejection_wick", timeframe: "1h", threshold: 0.35 }]
    },
    {
      confirmation: "1H 上影线≥50%或吞没阴线",
      confirmations: [{ kind: "rejection_wick", timeframe: "1h", threshold: 0.5, candleDirection: "bearish" }]
    },
    {
      confirmation: "1H 上影线≥50%",
      confirmations: [{ kind: "rejection_wick", timeframe: "1h", threshold: 0.35, candleDirection: "bearish" }]
    },
    {
      confirmation: "1H 上影线≥50%或吞没阴线",
      confirmationMode: "all",
      confirmations: [
        { kind: "rejection_wick", timeframe: "1h", threshold: 0.5, candleDirection: "bearish" },
        { kind: "engulfing", timeframe: "1h", candleDirection: "bearish" }
      ]
    }
  ];
  for (const [index, trigger] of cases.entries()) {
    const db = fixture();
    db.tradePlans[0].direction = "short";
    const result = armTradeSetup(db, { plan: db.tradePlans[0], currentPrice: 100, trigger: { kind: "price_above", level: 101, ...trigger } });
    assert.equal(result.error, "confirmation_rules_mismatch_text", `case ${index}`);
  }
});

test("启动校验会迁移旧确认文本并收敛历史重复计划", () => {
  const db = fixture();
  const first = { ...db.tradePlans[0], id: "plan_old_high", status: "armed", max_loss_pct: 10, createdAt: "2026-08-01T00:00:00.000Z" };
  const safer = { ...db.tradePlans[0], id: "plan_old_safe", status: "armed", max_loss_pct: 5, createdAt: "2026-08-02T00:00:00.000Z" };
  db.tradePlans = [first, safer];
  db.armedSetups = [
    { id: "armed_old_high", planId: first.id, symbol: "BTC/USDT", direction: "long", status: "ARMED", createdAt: first.createdAt, updatedAt: first.createdAt, trigger: { kind: "price_above", level: 101, confirmation: "1H 上影拒绝" }, events: [] },
    { id: "armed_old_safe", planId: safer.id, symbol: "BTC/USDT", direction: "long", status: "ARMED", createdAt: safer.createdAt, updatedAt: safer.createdAt, trigger: { kind: "price_above", level: 101, confirmation: "1H 上影拒绝" }, events: [] }
  ];
  const result = reconcileArmedSetupDefinitions(db);
  assert.equal(result.normalized.length, 2);
  assert.equal(result.superseded.length, 1);
  assert.equal(db.armedSetups.find((row) => row.id === "armed_old_high").status, "SUPERSEDED");
  const retained = db.armedSetups.find((row) => row.id === "armed_old_safe");
  assert.equal(retained.status, "ARMED");
  assert.equal(retained.trigger.confirmations[0].kind, "rejection_wick");
});

test("启动恢复会立即停用绑定旧交易权限版本的等待计划", () => {
  const db = fixture();
  const armed = arm(db);
  assert.equal(armed.ok, true);
  db.mandates[0].version = 4;
  const result = reconcileArmedSetupDefinitions(db);
  assert.equal(result.invalidated.length, 1);
  assert.equal(db.armedSetups[0].status, "INVALIDATED");
  assert.equal(db.armedSetups[0].closeReason, "mandate_changed");
  assert.equal(db.tradePlans[0].status, "cancelled");
});

test("价格到达但K线确认未满足时继续等待，确认满足后才进入执行器", async () => {
  const db = fixture();
  db.tradePlans[0].timeframe = "1h";
  const result = armTradeSetup(db, {
    plan: db.tradePlans[0], currentPrice: 100,
    trigger: { kind: "price_above", level: 101, confirmation: "1H 下影拒绝", confirmations: [{ kind: "rejection_wick", timeframe: "1h", threshold: 0.35, candleDirection: "bullish" }] }
  });
  assert.equal(result.ok, true);
  const market = db.markets[0];
  market.price = 101.1; market.lastRealtimeAt = new Date().toISOString();
  market.candlesByTf = { "1h": { syncedAt: new Date().toISOString(), candles: [
    { time: 1, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
    { time: 2, open: 100.5, high: 101.2, low: 100.2, close: 101.1, volume: 10 }
  ] } };
  let executions = 0;
  const options = {
    refreshFacts: async () => ({ ok: true }),
    evaluateTradePlan: () => ({ id: "risk_confirmed", passed: true, summary: "passed" }),
    deriveAutomationState: () => ({ mode: "observe" }),
    executeApprovedPlan: async () => { executions += 1; return { status: "dry_run" }; }
  };
  const pending = await processArmedSetupTick(db, "BTC/USDT", 101.1, options);
  assert.equal(pending.executions[0].status, "CONFIRMATION_PENDING");
  assert.equal(executions, 0);
  assert.equal(db.notifications.filter((row) => row.eventType === "armed_setup_trigger").length, 1);
  // A tick inside the same trigger region must not be misread as another
  // crossing while the setup waits for a future closed confirmation candle.
  market.lastRealtimeAt = new Date().toISOString();
  const duplicateTick = await processArmedSetupTick(db, "BTC/USDT", 101.15, options);
  assert.equal(duplicateTick.triggered.length, 0);
  assert.equal(db.notifications.filter((row) => row.eventType === "armed_setup_trigger").length, 1);
  market.candlesByTf["1h"].candles.push({ time: 3, open: 101.1, high: 101.3, low: 99, close: 101.2, volume: 10 });
  db.armedSetups[0].nextConfirmationCheckAt = new Date(Date.now() - 1).toISOString();
  market.lastRealtimeAt = new Date().toISOString();
  const confirmed = await processArmedSetupTick(db, "BTC/USDT", 101.2, options);
  assert.equal(confirmed.executions[0].status, "DRY_RUN", JSON.stringify(confirmed.executions[0]));
  assert.equal(executions, 1);
});

test("价格触发前已经收盘的旧K线不能冒充本次入场确认", async () => {
  const db = fixture();
  db.tradePlans[0].timeframe = "1h";
  const result = armTradeSetup(db, {
    plan: db.tradePlans[0], currentPrice: 100,
    trigger: { kind: "price_above", level: 101, confirmation: "1H 下影拒绝", confirmations: [{ kind: "rejection_wick", timeframe: "1h", threshold: 0.35, candleDirection: "bullish" }] }
  });
  assert.equal(result.ok, true);
  const oldOpenAt = Date.now() - 2 * 60 * 60 * 1000;
  db.markets[0].price = 101.1;
  db.markets[0].lastRealtimeAt = new Date().toISOString();
  db.markets[0].candlesByTf = { "1h": { syncedAt: new Date().toISOString(), candles: [
    { time: oldOpenAt, open: 100.5, high: 101.2, low: 98, close: 101.1, volume: 10 }
  ] } };
  let executions = 0;
  const pending = await processArmedSetupTick(db, "BTC/USDT", 101.1, {
    refreshFacts: async () => ({ ok: true }),
    evaluateTradePlan: () => ({ id: "must_not_run", passed: true, summary: "passed" }),
    deriveAutomationState: () => ({ mode: "observe" }),
    executeApprovedPlan: async () => { executions += 1; return { status: "dry_run" }; }
  });
  assert.equal(pending.executions[0].status, "CONFIRMATION_PENDING");
  assert.equal(pending.executions[0].confirmation.checks[0].reason, "confirmation_candle_predates_trigger");
  assert.equal(executions, 0);
});

test("吞没确认会由K线事实决定执行，上下影按文字指定方向而不是计划方向猜测", async () => {
  const options = {
    refreshFacts: async () => ({ ok: true }),
    evaluateTradePlan: () => ({ id: "risk_confirmed", passed: true, summary: "passed" }),
    deriveAutomationState: () => ({ mode: "observe" }),
    executeApprovedPlan: async () => ({ status: "dry_run" })
  };
  const engulfDb = fixture();
  engulfDb.tradePlans[0].timeframe = "1h";
  assert.equal(armTradeSetup(engulfDb, {
    plan: engulfDb.tradePlans[0], currentPrice: 100,
    trigger: { kind: "price_above", level: 101, confirmation: "1H 吞没阳线" }
  }).ok, true);
  engulfDb.markets[0].price = 101.2;
  engulfDb.markets[0].lastRealtimeAt = new Date().toISOString();
  engulfDb.markets[0].candlesByTf = { "1h": { syncedAt: new Date().toISOString(), candles: [
    { time: 1, open: 101, high: 101.2, low: 99.8, close: 100, volume: 10 },
    { time: 2, open: 99.8, high: 101.3, low: 99.7, close: 101.2, volume: 10 }
  ] } };
  const engulfed = await processArmedSetupTick(engulfDb, "BTC/USDT", 101.2, options);
  assert.equal(engulfed.executions[0].status, "DRY_RUN", JSON.stringify(engulfed.executions[0]));

  const wickDb = fixture();
  wickDb.tradePlans[0].direction = "long";
  wickDb.tradePlans[0].timeframe = "1h";
  assert.equal(armTradeSetup(wickDb, {
    plan: wickDb.tradePlans[0], currentPrice: 100,
    trigger: { kind: "price_above", level: 101, confirmation: "1H 上影线≥50%" }
  }).ok, true);
  assert.equal(wickDb.armedSetups[0].trigger.confirmations[0].candleDirection, "bearish");
  wickDb.markets[0].price = 101.1;
  wickDb.markets[0].lastRealtimeAt = new Date().toISOString();
  wickDb.markets[0].candlesByTf = { "1h": { syncedAt: new Date().toISOString(), candles: [
    { time: 1, open: 101, high: 103, low: 100, close: 100.5, volume: 10 }
  ] } };
  const rejected = await processArmedSetupTick(wickDb, "BTC/USDT", 101.1, options);
  assert.equal(rejected.executions[0].status, "DRY_RUN", JSON.stringify(rejected.executions[0]));
});

test("事实刷新期间价格失效会在第二次新鲜度检查被拦截", async () => {
  const db = fixture();
  arm(db);
  db.markets[0].price = 101.1;
  db.markets[0].lastRealtimeAt = new Date().toISOString();
  let executions = 0;
  const result = await processArmedSetupTick(db, "BTC/USDT", 101.1, {
    refreshFacts: async () => {
      db.markets[0].price = 110;
      db.markets[0].lastRealtimeAt = new Date().toISOString();
      return { ok: true };
    },
    evaluateTradePlan: () => ({ id: "must_not_run", passed: true }),
    executeApprovedPlan: async () => { executions += 1; }
  });
  assert.equal(result.executions[0].status, "INVALIDATED");
  assert.equal(result.executions[0].reason, "entry_price_moved");
  assert.equal(executions, 0);
});

test("执行租约冲突不会误判失败，后续 tick 可安全重试", async () => {
  const db = fixture();
  arm(db);
  db.markets[0].price = 101.1;
  db.markets[0].lastRealtimeAt = new Date().toISOString();
  let calls = 0;
  let saves = 0;
  const options = {
    saveDb: () => { saves += 1; },
    refreshFacts: async () => ({ ok: true }),
    evaluateTradePlan: () => ({ id: `risk_${calls}`, passed: true, summary: "passed" }),
    deriveAutomationState: () => ({ mode: "observe" }),
    executeApprovedPlan: async (_db) => {
      calls += 1;
      if (calls === 1) return { status: "execution_lease_held" };
      _db.tradePlans[0].status = "dry_run";
      return { status: "dry_run", executionOrder: { id: "exec_retry" } };
    }
  };
  const first = await processArmedSetupTick(db, "BTC/USDT", 101.1, options);
  assert.equal(first.executions[0].status, "TRIGGERED");
  assert.equal(db.tradePlans[0].status, "armed");
  db.armedSetups[0].retryAfter = new Date(Date.now() - 1).toISOString();
  db.markets[0].lastRealtimeAt = new Date().toISOString();
  saves = 0;
  const second = await processArmedSetupTick(db, "BTC/USDT", 101.2, options);
  assert.equal(second.executions[0].status, "DRY_RUN");
  assert.equal(calls, 2);
  assert.ok(saves >= 2, "延迟重试必须同时持久化校验中状态和最终状态");
});

test("执行单终态会收口 armed setup，不会永远显示执行中", () => {
  const db = fixture();
  arm(db);
  const setup = db.armedSetups[0];
  setup.status = "EXECUTING";
  setup.executionOrderId = "exec_closed";
  db.executionOrders.push({ id: "exec_closed", planId: "plan_1", status: "closed" });
  assert.equal(reconcileArmedSetupExecutions(db).length, 1);
  assert.equal(setup.status, "COMPLETED");
  assert.ok(setup.closedAt);
});

test("只在价格穿越时触发，密集 tick 也只执行一次", async () => {
  const db = fixture();
  const armed = arm(db);
  assert.equal(armed.ok, true);
  assert.equal(observeArmedSetupPrice(db, "BTC/USDT", 100.8).triggered.length, 0);

  let executions = 0;
  db.markets[0].price = 101.2;
  db.markets[0].lastRealtimeAt = new Date().toISOString();
  const options = {
    refreshFacts: async () => ({ ok: true }),
    evaluateTradePlan: () => ({ id: "risk_trigger", passed: true, summary: "passed" }),
    deriveAutomationState: () => ({ mode: "observe", blockers: [] }),
    executeApprovedPlan: async (_db, planId) => {
      executions += 1;
      assert.equal(planId, "plan_1");
      _db.tradePlans[0].status = "dry_run";
      return { status: "dry_run", executionOrder: { id: "exec_1" } };
    }
  };
  const first = await processArmedSetupTick(db, "BTC/USDT", 101.2, options);
  const second = await processArmedSetupTick(db, "BTC/USDT", 101.3, options);
  assert.equal(first.triggered.length, 1);
  assert.equal(first.executions[0].status, "DRY_RUN");
  assert.equal(second.triggered.length, 0);
  assert.equal(executions, 1);
});

test("触发后的硬风控失败会终止计划且绝不调用执行器", async () => {
  const db = fixture();
  arm(db);
  db.markets[0].price = 101.1;
  db.markets[0].lastRealtimeAt = new Date().toISOString();
  let executions = 0;
  const result = await processArmedSetupTick(db, "BTC/USDT", 101.1, {
    refreshFacts: async () => ({ ok: true }),
    evaluateTradePlan: () => ({ id: "risk_reject", passed: false, summary: "daily loss blocked" }),
    executeApprovedPlan: async () => { executions += 1; }
  });
  assert.equal(result.executions[0].status, "RISK_REJECTED");
  assert.equal(executions, 0);
  assert.equal(db.tradePlans[0].status, "risk_rejected");
});

test("重启恢复不补下陈旧触发，并能持久化全部新状态", async () => {
  const db = fixture();
  arm(db);
  const setup = db.armedSetups[0];
  setup.status = "TRIGGERED";
  setup.triggeredAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const recovered = await recoverTriggeredSetups(db, { executeApprovedPlan: async () => { throw new Error("must not execute"); } });
  assert.equal(recovered[0].status, "INVALIDATED");
  assert.equal(setup.closeReason, "stale_trigger_after_restart");

  const persisted = seedDatabase();
  persisted.watchTriggers = [{ id: "watch_persist", status: "active", createdAt: new Date().toISOString() }];
  persisted.armedSetups = [{ id: "armed_persist", status: "ARMED", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }];
  persisted.opportunityCandidates = [{ id: "opp_persist", status: "DISCOVERED", createdAt: new Date().toISOString() }];
  persisted.marketFeatureState = { "BTC/USDT": { samples: [{ t: 1, p: 100 }] } };
  saveDb(persisted);
  const loaded = loadDb();
  assert.equal(loaded.watchTriggers.some((row) => row.id === "watch_persist"), true);
  assert.equal(loaded.armedSetups.some((row) => row.id === "armed_persist"), true);
  assert.equal(loaded.opportunityCandidates.some((row) => row.id === "opp_persist"), true);
  assert.equal(loaded.marketFeatureState["BTC/USDT"].samples.length, 1);
});
