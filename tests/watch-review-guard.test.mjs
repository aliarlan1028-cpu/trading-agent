import assert from "node:assert/strict";
import test from "node:test";
import {
  canRegisterWatchAfterTrigger,
  deterministicWatchStructureFingerprint,
  evaluateWatchReviewClosure,
  rememberRegisteredWatchLineage,
  validateWatchReviewRecord,
  watchThesisFingerprint,
  watchReviewCorrectionInstruction
} from "../server/watchReviewGuard.mjs";

function structureFact(overrides = {}) {
  const frame = (timeframe, direction, sequence, phase, regime, event = null) => ({
    available: true, timeframe, trend: { direction, sequence }, phase,
    regime: { label: regime, previousLabel: regime, transition: { detected: false, type: "stable" } },
    latestEvent: event
  });
  return {
    evidenceRef: "structure:ada:1", selectedRole: "day_trader", bias: "SHORT", alignment: "aligned", phase: "continuation",
    frames: {
      "1h": frame("1h", "down", "LH/LL", "continuation", "downtrend"),
      "15m": frame("15m", "down", "LH/LL", "continuation", "downtrend", { kind: "BOS", direction: "down", level: 0.1815, breakTime: "2026-08-14T00:00:00.000Z" }),
      "5m": frame("5m", "down", "LH/LL", "continuation", "high_volatility")
    },
    ...overrides
  };
}

function runFixture(overrides = {}) {
  const fact = structureFact();
  const structureFingerprint = deterministicWatchStructureFingerprint(fact, "day_trader");
  const watch = {
    id: "watch_1", symbol: "ADA/USDT", direction: "short", purpose: "confirmation",
    kind: "enter_zone", levelLow: 0.1802, levelHigh: 0.1815, triggerPrice: 0.1804,
    rootWatchId: "watch_root", reviewDepth: 0, lineageVersion: 2,
    lineageStartedAt: "2026-08-14T00:00:00.000Z", createdAt: "2026-08-14T00:00:00.000Z",
    setupType: "breakdown_retest", traderRole: "day_trader",
    structureFingerprint, structureEvidenceRef: fact.evidenceRef,
    thesisFingerprint: watchThesisFingerprint({
      symbol: "ADA/USDT", direction: "short", setupType: "breakdown_retest",
      traderRole: "day_trader", structureFingerprint
    })
  };
  return {
    createdAt: "2026-08-14T01:00:00.000Z",
    decisionContext: { trigger: "watch_trigger" },
    triggeredWatches: [watch],
    evidenceBundleId: "bundle_1",
    evidenceBundle: {
      id: "bundle_1",
      criticalReady: true,
      blockers: [],
      readiness: { "ADA/USDT": { ready: true, blockers: [] } },
      symbols: [{
        symbol: "ADA/USDT",
        microstructure: {
          evidenceId: "ev_micro", status: "fresh", quality: "passed",
          data: { spreadBps: 5.49, depthUsdt: 100000 }
        }
      }]
    },
    structureFacts: { "ADA/USDT": fact },
    toolReceipts: [],
    ...overrides
  };
}

test("真实观察哨触发必须以计划或经验证的拒绝记录闭环", () => {
  const run = runFixture();
  const closure = evaluateWatchReviewClosure(run, []);
  assert.equal(closure.applicable, true);
  assert.equal(closure.ok, false);
  assert.match(watchReviewCorrectionInstruction(run, []), /propose_trade_plan/);

  run.tradePlanId = "plan_1";
  run.tradePlanSymbol = "ADA/USDT";
  assert.deepEqual(evaluateWatchReviewClosure(run, []).outcome, "plan_or_verified_review");
});

test("不能在确定性结构同向时编造结构冲突", () => {
  const run = runFixture();
  const rejected = validateWatchReviewRecord(run, {
    symbol: "ADA/USDT", outcome: "rejected", reasonCode: "structure_conflict",
    reason: "确定性结构与原触发方向冲突，因此拒绝本次交易。",
    evidenceRefs: ["structure:ada:1"], nextAction: "stop_monitoring"
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /与触发方向一致/);

  run.structureFacts["ADA/USDT"].bias = "LONG";
  const accepted = validateWatchReviewRecord(run, {
    symbol: "ADA/USDT", outcome: "rejected", reasonCode: "structure_conflict",
    reason: "确定性结构已经转为 LONG，与原做空触发方向相冲突。",
    evidenceRefs: ["structure:ada:1"], nextAction: "stop_monitoring"
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.review.verified, true);

  run.structureFacts["ADA/USDT"].bias = "NEUTRAL";
  run.structureFacts["ADA/USDT"].alignment = "mixed";
  const unconfirmedIsNotConflict = validateWatchReviewRecord(run, {
    symbol: "ADA/USDT", outcome: "rejected", reasonCode: "structure_conflict",
    reason: "目前没有足够的同向确认，所以按结构冲突拒绝交易。",
    evidenceRefs: ["structure:ada:1"], nextAction: "stop_monitoring"
  });
  assert.equal(unconfirmedIsNotConflict.ok, false);
  assert.match(unconfirmedIsNotConflict.error, /没有同向确认/);
});

test("流动性拒绝必须由新鲜高点差证据支持", () => {
  const args = {
    symbol: "ADA/USDT", outcome: "rejected", reasonCode: "liquidity_unacceptable",
    reason: "当前点差超过系统硬阈值，预期冲击成本不可接受。",
    evidenceRefs: ["ev_micro"], nextAction: "manual_review"
  };
  assert.equal(validateWatchReviewRecord(runFixture(), args).ok, true);
  const tight = runFixture();
  tight.evidenceBundle.symbols[0].microstructure.data.spreadBps = 1.2;
  const rejected = validateWatchReviewRecord(tight, args);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /至少 5bps/);
});

test("价格失效结论只能来自真实 invalidation 哨", () => {
  const args = {
    symbol: "ADA/USDT", outcome: "invalidated", reasonCode: "invalidation_hit",
    reason: "原判断的结构失效价格已经被真实观察哨命中。",
    evidenceRefs: ["bundle_1"], nextAction: "stop_monitoring"
  };
  assert.equal(validateWatchReviewRecord(runFixture(), args).ok, false);
  const run = runFixture();
  run.triggeredWatches[0].purpose = "invalidation";
  assert.equal(validateWatchReviewRecord(run, args).ok, true);
});

test("触发后不能直接换哨，同方向连续改写有硬上限", () => {
  const run = runFixture();
  const args = {
    symbol: "ADA/USDT", direction: "short", purpose: "confirmation",
    setupType: "breakdown_retest", traderRole: "day_trader"
  };
  assert.equal(canRegisterWatchAfterTrigger(run, args).ok, false);

  run.watchReview = { symbol: "ADA/USDT", verified: true, nextAction: "fresh_thesis", reasonCode: "structure_conflict" };
  const allowed = canRegisterWatchAfterTrigger(run, args);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.lineage.reviewDepth, 1);
  assert.deepEqual(allowed.lineage.reviewOfWatchIds, ["watch_1"]);

  run.triggeredWatches[0].reviewDepth = 2;
  const capped = canRegisterWatchAfterTrigger(run, args);
  assert.equal(capped.ok, false);
  assert.match(capped.error, /防循环上限/);

  const relabeledPurpose = canRegisterWatchAfterTrigger(run, { ...args, purpose: "alternative" });
  assert.equal(relabeledPurpose.ok, false);
  assert.match(relabeledPurpose.error, /改 purpose/);
});

test("只改价格、文案或 setupType 不会伪造新判断链", () => {
  const run = runFixture();
  run.triggeredWatches[0].reviewDepth = 1;
  run.watchReview = { symbol: "ADA/USDT", verified: true, nextAction: "fresh_thesis", reasonCode: "liquidity_unacceptable" };
  const changedLabel = canRegisterWatchAfterTrigger(run, {
    symbol: "ADA/USDT", direction: "short", purpose: "confirmation",
    setupType: "trend_pullback", traderRole: "day_trader",
    levelLow: 0.182, levelHigh: 0.184,
    thesis: "换一种说法继续等待更高位置"
  });
  assert.equal(changedLabel.ok, true);
  assert.equal(changedLabel.reset, false);
  assert.equal(changedLabel.lineage.reviewDepth, 2);
  assert.equal(changedLabel.lineage.rootWatchId, "watch_root");
  assert.equal(changedLabel.lineage.thesisFingerprint, run.triggeredWatches[0].thesisFingerprint);
});

test("带新证据 ID 的确定性结构实质变化会开启新判断链", () => {
  const run = runFixture();
  run.triggeredWatches[0].reviewDepth = 2;
  run.watchReview = { symbol: "ADA/USDT", verified: true, nextAction: "fresh_thesis", reasonCode: "structure_conflict" };
  run.structureFacts["ADA/USDT"] = structureFact({
    evidenceRef: "structure:ada:2",
    bias: "NEUTRAL",
    alignment: "mixed",
    phase: "range",
    frames: {
      ...run.structureFacts["ADA/USDT"].frames,
      "15m": {
        ...run.structureFacts["ADA/USDT"].frames["15m"],
        trend: { direction: "range", sequence: "LH/HL" },
        phase: "range",
        regime: { label: "range", previousLabel: "downtrend", transition: { detected: true, type: "label:downtrend->range" } },
        latestEvent: { kind: "CHoCH", direction: "up", level: 0.183, breakTime: "2026-08-14T01:00:00.000Z" }
      }
    }
  });
  const reset = canRegisterWatchAfterTrigger(run, {
    symbol: "ADA/USDT", direction: "short", purpose: "confirmation",
    setupType: "range_rejection", traderRole: "day_trader"
  });
  assert.equal(reset.ok, true);
  assert.equal(reset.reset, true);
  assert.equal(reset.lineage.reviewDepth, 0);
  assert.equal(reset.lineage.rootWatchId, null);
  assert.equal(reset.lineage.previousRootWatchId, "watch_root");
  assert.equal(reset.lineage.lineageResetReason, "deterministic_structure_changed");
  assert.equal(reset.lineage.lineageResetEvidenceRef, "structure:ada:2");
});

test("判断链按角色时间窗口自然重置，TTL 不能超过角色上限", () => {
  const run = runFixture({ createdAt: "2026-08-14T13:00:00.000Z" });
  run.triggeredWatches[0].reviewDepth = 2;
  run.watchReview = { symbol: "ADA/USDT", verified: true, nextAction: "fresh_thesis", reasonCode: "liquidity_unacceptable" };
  const reset = canRegisterWatchAfterTrigger(run, {
    symbol: "ADA/USDT", direction: "short", purpose: "confirmation",
    setupType: "breakdown_retest", traderRole: "day_trader"
  });
  assert.equal(reset.ok, true);
  assert.equal(reset.lineage.reviewDepth, 0);
  assert.equal(reset.lineage.lineageResetReason, "rearm_window_elapsed");
  assert.equal(reset.lineage.rearmWindowHours, 12);
  assert.equal(reset.lineage.ttlHours, 4);

  const invalidTtl = canRegisterWatchAfterTrigger(run, {
    symbol: "ADA/USDT", direction: "short", purpose: "confirmation",
    setupType: "breakdown_retest", traderRole: "day_trader", ttlHours: 13
  });
  assert.equal(invalidTtl.ok, false);
  assert.match(invalidTtl.error, /最长 12 小时/);
});

test("同一轮的主哨和辅助哨共享同一个新判断链", () => {
  const run = runFixture({ decisionContext: { trigger: "scheduled_patrol" }, triggeredWatches: [] });
  const args = {
    symbol: "ADA/USDT", direction: "short", purpose: "decision",
    setupType: "breakdown_retest", traderRole: "day_trader"
  };
  const first = canRegisterWatchAfterTrigger(run, args);
  assert.equal(first.ok, true);
  const registered = {
    id: "watch_new", ...args, ...first.lineage,
    rootWatchId: "watch_new", createdAt: run.createdAt
  };
  rememberRegisteredWatchLineage(run, registered);
  const secondary = canRegisterWatchAfterTrigger(run, { ...args, purpose: "invalidation" });
  assert.equal(secondary.ok, true);
  assert.equal(secondary.lineage.rootWatchId, "watch_new");
  assert.equal(secondary.lineage.reviewDepth, 0);
  assert.equal(secondary.lineage.thesisFingerprint, first.lineage.thesisFingerprint);
});

test("旧版观察哨首次复核时保守继承旧链并补齐新版审计字段", () => {
  const run = runFixture();
  run.triggeredWatches = [{
    id: "watch_legacy", symbol: "ADA/USDT", direction: "short", purpose: "confirmation",
    kind: "price_below", level: 0.1802, triggerPrice: 0.1801,
    createdAt: "2026-08-14T00:00:00.000Z"
  }];
  run.watchReview = { symbol: "ADA/USDT", verified: true, nextAction: "fresh_thesis", reasonCode: "liquidity_unacceptable" };
  const migrated = canRegisterWatchAfterTrigger(run, {
    symbol: "ADA/USDT", direction: "short", purpose: "confirmation",
    setupType: "breakdown_retest", traderRole: "day_trader"
  });
  assert.equal(migrated.ok, true);
  assert.equal(migrated.reset, false);
  assert.equal(migrated.lineage.lineageVersion, 2);
  assert.equal(migrated.lineage.rootWatchId, "watch_legacy");
  assert.equal(migrated.lineage.reviewDepth, 1);
  assert.ok(migrated.lineage.thesisFingerprint);
  assert.ok(migrated.lineage.structureFingerprint);
});

test("多币触发逐币闭环，且不阻止无关币种的新观察判断", () => {
  const run = runFixture();
  run.triggeredWatches.push({
    id: "watch_btc", symbol: "BTC/USDT", direction: "long", purpose: "decision",
    kind: "price_above", level: 70000, triggerPrice: 70010, rootWatchId: "watch_btc", reviewDepth: 0
  });
  run.watchReviews = {
    "ADA/USDT": { symbol: "ADA/USDT", verified: true, outcome: "rejected", nextAction: "stop_monitoring" }
  };
  const closure = evaluateWatchReviewClosure(run, []);
  assert.equal(closure.ok, false);
  assert.deepEqual(closure.unresolvedSymbols, ["BTC/USDT"]);

  const unrelated = canRegisterWatchAfterTrigger(run, {
    symbol: "SOL/USDT", direction: "long", purpose: "decision",
    setupType: "trend_pullback", traderRole: "day_trader"
  });
  assert.equal(unrelated.ok, true);
  assert.equal(unrelated.lineage.reviewDepth, 0);
});
