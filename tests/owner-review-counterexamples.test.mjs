import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOwnerReviewLoopSnapshot,
  buildStructuredTradeAssessment,
  ensureDecisionFactSnapshot,
  lessonStatus,
  migrateLegacyOwnerReviewProvenance,
  recordStrategyValidationStage,
  refreshOwnerImprovementRegistry,
  transitionOwnerImprovement
} from "../server/ownerReviewLoop.mjs";
import { retrieveRelevantReviewMemories } from "../server/reviewLearning.mjs";
import { ensureTradeReviewQueued } from "../server/tradeReviewQueue.mjs";
import { createStrategyImprovementCycle, runTradeReflection, storedTradeWindowNews } from "../server/reviewEngine.mjs";
import {
  backtestStrategyDraftWithCandles,
  createStrategyDraft,
  publishStrategyDraft,
  runDraftGeneratedTests,
  strategyDefinitionHash
} from "../server/strategyStudio.mjs";
import { runPaperForward, startOwnerCandidatePaperSession } from "../server/paperTrading.mjs";
import { registerReviewRoutes } from "../server/routes/review.mjs";

function dbFixture() {
  return {
    system: { requestedOperatingMode: "full_auto" },
    user: { id: "owner-1", tenantId: "tenant_owner", isOwner: true },
    mandates: [{ id: "mandate-1", allowedSymbols: ["BTC/USDT"] }],
    tradePlans: [], decisionFactSnapshots: [], reviews: [], memoryItems: [],
    ownerImprovementItems: [], strategyExperiments: [], strategyVersions: [{ id: "trend@1.0.0", productId: "trend", version: "1.0.0", contentHash: "baseline-hash" }],
    strategyBlueprintVersions: [], strategyStudioDrafts: [], strategyStudioBacktests: [],
    paperSessions: [], fills: [], executionOrders: [], riskChecks: [{ id: "risk-1", tradePlanId: "plan-1", passed: true }], riskIncidents: [],
    markets: [], events: [], auditLogs: [], traces: []
  };
}

const ownerPrincipal = { tenantId: "tenant_owner", userId: "owner-1", isOwner: true };

function profitableBreakoutCandles(count = 1200) {
  const rows = [];
  let base = 100;
  let time = 0;
  let cycle = 0;
  while (rows.length < count) {
    for (let index = 0; index < 20 && rows.length < count; index += 1) {
      const close = base + (index % 2) * 0.01;
      rows.push({ time, ts: time, open: close, high: close + 0.05, low: close - 0.05, close, volume: 1000 });
      time += 3_600_000;
    }
    if (rows.length >= count) break;
    const entry = base + 1;
    rows.push({ time, ts: time, open: base, high: entry + 0.04, low: base - 0.02, close: entry, volume: 1800 });
    time += 3_600_000;
    if (rows.length >= count) break;
    const loses = cycle % 9 === 4;
    const stop = entry * 0.99;
    const takeProfit = entry * 1.005;
    rows.push({
      time,
      ts: time,
      open: entry,
      high: loses ? entry + 0.02 : takeProfit + 0.03,
      low: loses ? stop - 0.03 : entry - 0.02,
      close: entry,
      volume: 1400
    });
    time += 3_600_000;
    base = entry + 0.2;
    cycle += 1;
  }
  return rows.slice(0, count);
}

function plan(overrides = {}) {
  return {
    id: "plan-1", mandateId: "mandate-1", symbol: "BTC/USDT", direction: "long",
    tenantId: "tenant_owner", ownerUserId: "owner-1",
    timeframe: "1h", entry: 100, stopLoss: 95, takeProfit: [110], leverage: 2,
    rationale: "1H 趋势保持，15m 回踩确认后重新站上结构位，止损和盈亏比符合授权。",
    strategyProductId: "trend", strategyVersion: "1.0.0",
    lastRiskCheck: { id: "risk-1", passed: true, summary: "passed" },
    ...overrides
  };
}

function lifecycle(overrides = {}) {
  const representative = {
    id: "close-1", kind: "close", tradePlanId: "plan-1", executionOrderId: "exec-1",
    symbol: "BTC/USDT", direction: "long", slippageBps: 2,
    createdAt: "2026-08-18T02:00:00.000Z", ...overrides
  };
  return { key: "exec-1", representative, fills: [representative], financialBasisComplete: true, netRealizedPnl: -2 };
}

test("a frozen decision snapshot rejects a materially mutated current plan", () => {
  const db = dbFixture();
  const source = plan();
  ensureDecisionFactSnapshot(db, source, { captureMode: "agent_decision_pre_approval" });
  source.entry = 999;
  source.stopLoss = 998;
  const replay = ensureDecisionFactSnapshot(db, source, { captureMode: "execution_preflight" });
  assert.deepEqual({ ok: replay.ok, reason: replay.reason }, {
    ok: false,
    reason: "decision_fact_snapshot_plan_mismatch"
  });
});

test("a failed risk check can never become good merely because it has an id", () => {
  const db = dbFixture();
  const source = plan({ lastRiskCheck: { id: "risk-failed", passed: false, summary: "risk rejected" }, riskCheckId: "risk-failed" });
  db.tradePlans.push(source);
  db.riskChecks.push({ id: "risk-failed", passed: false, decision: "reject" });
  ensureDecisionFactSnapshot(db, source, { captureMode: "agent_decision_pre_approval" });
  const assessment = buildStructuredTradeAssessment(db, lifecycle({ riskCheckId: "risk-failed" }), { plan: source });
  const risk = assessment.axes.find((axis) => axis.key === "risk");
  assert.equal(risk.status, "problem");
  assert.equal(risk.score, 0);
  assert.equal(assessment.rootCauses.some((root) => root.code === "risk_sizing"), true);
});

test("missing or foreign risk checks never score as good", () => {
  for (const mode of ["missing", "foreign", "foreign-owner"]) {
    const db = dbFixture();
    db.system.ownerReviewProvenanceMigrationVersion = 1;
    db.riskChecks = mode === "foreign"
      ? [{ id: "risk-x", tradePlanId: "another-plan", tenantId: "tenant_owner", ownerUserId: "owner-1", passed: true }]
      : mode === "foreign-owner" ? [{ id: "risk-x", tradePlanId: "plan-1", tenantId: "tenant_other", ownerUserId: "other-user", passed: true }] : [];
    const source = plan({ lastRiskCheck: { id: "risk-x", passed: true }, riskCheckId: "risk-x" });
    db.tradePlans.push(source);
    ensureDecisionFactSnapshot(db, source, { captureMode: "agent_decision_pre_approval" });
    const assessment = buildStructuredTradeAssessment(db, lifecycle({ riskCheckId: "risk-x" }), { plan: source });
    assert.notEqual(assessment.axes.find((axis) => axis.key === "risk").status, "good", mode);
  }
});

test("critical execution states and open critical risk incidents surface immediately", () => {
  const db = dbFixture();
  db.executionOrders.push({ id: "exec-protection", symbol: "BTC/USDT", status: "protection_failure_cancel_pending" });
  db.riskIncidents.push({ id: "incident-stop", source: "exec-protection", kind: "entry_stop_unconfirmed", severity: "critical", status: "open" });
  const snapshot = buildOwnerReviewLoopSnapshot(db);
  const issue = snapshot.improvements.find((item) => item.rootCauseCode === "system_control_failure");
  assert.ok(issue);
  assert.equal(issue.state, "pending_owner");
  assert.equal(issue.evidenceRefs.some((ref) => ref.type === "risk_incident" && ref.id === "incident-stop"), true);
});

test("explicit strategy scenario fields reject symbol-only but contradictory lessons", () => {
  const db = dbFixture();
  db.memoryItems.push({
    id: "wrong-scenario", source: "auto_reflection", learningStatus: "active",
    tenantId: "tenant_owner", ownerUserId: "owner-1", title: "wrong", content: "wrong",
    reviewContext: {
      schemaVersion: 2, symbol: "BTC/USDT", timeframe: "1h", setupType: "trend_pullback",
      strategyProductId: "trend", direction: "long", netRealizedPnl: -1,
      financialBasis: "completed_trade_review/net_after_recorded_costs", reviewId: "review-1"
    }
  });
  db.reviews.push({ id: "review-1", memoryItemId: "wrong-scenario", type: "trade", status: "completed", netRealizedPnl: -1 });
  const rows = retrieveRelevantReviewMemories(db, {
    principal: ownerPrincipal,
    symbols: ["BTC/USDT"], timeframe: "5m", setupType: "mean_reversion",
    strategyProductId: "mean_reversion", direction: "short"
  });
  assert.deepEqual(rows, []);
});

test("requesting more evidence records a durable evidence threshold", () => {
  const db = dbFixture();
  db.ownerImprovementItems.push({
    id: "improvement-1", dedupKey: "entry_timing|trend|1h|uptrend",
    rootCauseCode: "entry_timing", destination: "strategy", severity: "medium",
    evidenceCount: 3, state: "pending_owner", tenantId: "tenant_owner", ownerUserId: "owner-1"
  });
  const action = transitionOwnerImprovement(db, "improvement-1", "more_evidence", "Owner");
  assert.equal(action.ok, true);
  assert.equal(action.item.state, "evidence_accumulating");
  assert.equal(action.item.requiredEvidenceCount, 4);
  refreshOwnerImprovementRegistry(db);
  assert.equal(action.item.state, "evidence_accumulating");
});

test("bare news booleans cannot self-assert a verified market shock", () => {
  const db = dbFixture();
  const source = plan();
  db.tradePlans.push(source);
  ensureDecisionFactSnapshot(db, source, { captureMode: "agent_decision_pre_approval" });
  const assessment = buildStructuredTradeAssessment(db, lifecycle(), {
    plan: source,
    trajectory: { firstLegFav: true, reachedTpPct: 30, gaveBackFromPeak: 10 },
    newsContext: { verified: true, highImpact: true, source: "unverified_legacy_blob" }
  });
  assert.equal(assessment.rootCauses.some((root) => root.code === "market_shock"), false);
});

test("post-close news and symbol substrings cannot enter causal trade evidence", () => {
  const common = {
    type: "news", category: "news",
    values: { verifiedOrigin: true, trustTier: "verified_official", fakeRisk: "low", impact: 90 }
  };
  const db = dbFixture();
  db.marketIntelligenceFacts = [
    { ...common, id: "post-close", affectedSymbols: ["SOL/USDT"], publishedAt: "2026-08-18T03:01:00.000Z" },
    { ...common, id: "substring", title: "Market consolidation continues", publishedAt: "2026-08-18T02:00:00.000Z" }
  ];
  assert.equal(storedTradeWindowNews(db, "SOL/USDT", "2026-08-18T01:00:00.000Z", "2026-08-18T03:00:00.000Z"), null);
});

test("queued trade reviews inherit tenant and user provenance from the fill", () => {
  const db = dbFixture();
  const review = ensureTradeReviewQueued(db, {
    id: "close-other", kind: "close", executionOrderId: "exec-other", symbol: "ETH/USDT",
    realizedPnl: -1, tenantId: "tenant_other", userId: "other-user"
  });
  assert.equal(review.tenantId, "tenant_other");
  assert.equal(review.ownerUserId, "other-user");
});

test("legacy auto-reflection memories are quarantined until Owner review", () => {
  const db = dbFixture();
  const memory = {
    id: "legacy", source: "auto_reflection", title: "legacy", content: "legacy",
    reviewContext: { symbol: "BTC/USDT", timeframe: "1h", direction: "long", reviewId: "legacy-review", financialBasis: "completed_trade_review/net_after_recorded_costs" }
  };
  db.memoryItems.push(memory);
  db.reviews.push({ id: "legacy-review", type: "trade", status: "completed", netRealizedPnl: -1 });
  assert.equal(lessonStatus(memory), "candidate_legacy");
  assert.deepEqual(retrieveRelevantReviewMemories(db, { principal: ownerPrincipal, symbols: ["BTC/USDT"], timeframe: "1h", direction: "long" }), []);
});

test("legacy provenance migration runs once and never adopts later untagged producer rows", () => {
  const db = dbFixture();
  db.fills.push({ id: "legacy-before", kind: "entry" });
  const first = migrateLegacyOwnerReviewProvenance(db);
  assert.equal(first.alreadyApplied, false);
  assert.equal(db.fills[0].ownerUserId, "owner-1");
  db.fills.push({ id: "unknown-after", kind: "entry" });
  const second = migrateLegacyOwnerReviewProvenance(db);
  assert.equal(second.alreadyApplied, true);
  assert.equal(db.fills[1].ownerUserId, undefined);
  assert.equal(buildOwnerReviewLoopSnapshot(db).scope, "owner_instance_only");
});

test("fake, live, other-strategy, and free-text-only strategy candidates fail closed", () => {
  const db = dbFixture();
  const item = {
    id: "strategy-improvement", destination: "strategy", state: "accepted", scope: { strategyProductId: "trend" },
    tenantId: "tenant_owner", ownerUserId: "owner-1", evidenceReviewIds: []
  };
  db.ownerImprovementItems.push(item);
  const cycle = createStrategyImprovementCycle(db, { sourceImprovementId: item.id, hypothesis: "test" });
  item.experimentId = cycle.experiment.id;
  transitionOwnerImprovement(db, item.id, "start_validation", "Owner");

  assert.equal(recordStrategyValidationStage(db, item.id, {
    stageName: "backtest", outcome: "passed", evidence: "x", candidateVersionId: "does-not-exist", candidateDefinitionHash: "x"
  }).error, "candidate_strategy_version_not_found");

  const addCandidate = (id, baseProductId) => {
    const draft = { id: `draft-${id}`, tenantId: "tenant_owner", ownerUserId: "owner-1", contentHash: `draft-hash-${id}` };
    const backtest = { id: `bt-${id}`, tenantId: "tenant_owner", ownerUserId: "owner-1", draftId: draft.id, draftHash: draft.contentHash, passed: true, oos: { trades: 30, profitFactor: 1.5, maxDrawdownPct: 2, expectancyR: 0.2 } };
    const definition = { baseProductId, sourceDraftId: draft.id };
    const version = { id, tenantId: "tenant_owner", ownerUserId: "owner-1", immutable: true, contentHash: strategyDefinitionHash(definition), definition, validation: { backtestId: backtest.id } };
    db.strategyStudioDrafts.push(draft); db.strategyStudioBacktests.push(backtest); db.strategyBlueprintVersions.push(version);
    db.strategyMarketplaceListings ||= [];
    db.strategyMarketplaceListings.push({ id: `listing-${id}`, strategyVersionId: id, status: "published" });
    return { version, backtest };
  };
  const other = addCandidate("other@1", "mean-reversion");
  assert.equal(recordStrategyValidationStage(db, item.id, { stageName: "backtest", outcome: "passed", candidateVersionId: other.version.id, candidateDefinitionHash: other.version.contentHash, evidenceId: other.backtest.id }).error, "candidate_strategy_product_mismatch");

  const live = addCandidate("trend-live@1", "trend");
  db.strategyAssignments = [{ strategyVersionId: live.version.id, enabled: true }];
  assert.equal(recordStrategyValidationStage(db, item.id, { stageName: "backtest", outcome: "passed", candidateVersionId: live.version.id, candidateDefinitionHash: live.version.contentHash, evidenceId: live.backtest.id }).error, "candidate_strategy_already_live");

  const valid = addCandidate("trend-candidate@1", "trend");
  assert.equal(recordStrategyValidationStage(db, item.id, { stageName: "backtest", outcome: "passed", evidence: "OOS passed", candidateVersionId: valid.version.id, candidateDefinitionHash: valid.version.contentHash, evidenceId: "made-up" }).error, "authoritative_backtest_evidence_missing");
});

test("a failed strategy candidate can open a distinct versioned v2 attempt", () => {
  const db = dbFixture();
  const item = { id: "retry-item", destination: "strategy", state: "accepted", scope: { strategyProductId: "trend" }, tenantId: "tenant_owner", ownerUserId: "owner-1" };
  db.ownerImprovementItems.push(item);
  const first = createStrategyImprovementCycle(db, { sourceImprovementId: item.id, hypothesis: "v1" });
  item.experimentId = first.experiment.id;
  transitionOwnerImprovement(db, item.id, "start_validation", "Owner");
  recordStrategyValidationStage(db, item.id, { stageName: "backtest", outcome: "failed", note: "OOS failed" });
  assert.equal(item.state, "ineffective");
  assert.equal(transitionOwnerImprovement(db, item.id, "retry_validation", "Owner").ok, true);
  const second = createStrategyImprovementCycle(db, { sourceImprovementId: item.id, hypothesis: "v2" });
  item.experimentId = second.experiment.id;
  assert.equal(second.experiment.attemptNumber, 2);
  assert.notEqual(second.experiment.id, first.experiment.id);
});

test("strategy baseline resolution uses an explicit current deployment and rejects ambiguous arrays", () => {
  const db = dbFixture();
  db.strategyVersions.push({ id: "trend@2.0.0", productId: "trend", version: "2.0.0", contentHash: "baseline-v2" });
  const item = { id: "baseline-resolution", destination: "strategy", state: "accepted", scope: { strategyProductId: "trend" }, tenantId: "tenant_owner", ownerUserId: "owner-1" };
  db.ownerImprovementItems.push(item);
  assert.throws(() => createStrategyImprovementCycle(db, { sourceImprovementId: item.id }), /strategy_baseline_version_ambiguous/);
  db.strategyDeployments = [{ productId: "trend", versionId: "trend@2.0.0", state: "validated_active", updatedAt: "2026-08-18T00:00:00.000Z" }];
  const cycle = createStrategyImprovementCycle(db, { sourceImprovementId: item.id });
  assert.equal(cycle.experiment.strategyRef.versionId, "trend@2.0.0");
  assert.equal(cycle.experiment.strategyRef.definitionHash, "baseline-v2");
});

test("real compile, OOS publication, route start, and forward bars produce authoritative paper evidence", async () => {
  const db = dbFixture();
  db.strategyVersions = [{ id: "breakout-retest@baseline", productId: "breakout_retest", version: "1.0.0", contentHash: "baseline-breakout-hash" }];
  db.strategyMarketplaceListings = [];
  db.strategyAssignments = [];
  db.backtests = [];
  const item = {
    id: "real-paper-item", tenantId: "tenant_owner", ownerUserId: "owner-1",
    destination: "strategy", state: "accepted", title: "验证突破策略候选",
    proposal: "用不可变候选完成回测与纯前向模拟",
    scope: { strategyProductId: "breakout_retest" }, evidenceReviewIds: []
  };
  db.ownerImprovementItems.push(item);
  const cycle = createStrategyImprovementCycle(db, {
    sourceImprovementId: item.id,
    successCriteria: { minTrades: 20, minSmallLiveTrades: 3, minProfitFactor: 1.2, maxDrawdownPct: 3, requireManualApproval: true }
  });
  item.experimentId = cycle.experiment.id;
  assert.equal(transitionOwnerImprovement(db, item.id, "start_validation", "Owner").ok, true);

  const draft = await createStrategyDraft(db, "BTC/USDT 1h 唐奇安过去20根突破做多，止损1%，止盈0.5R", { principal: ownerPrincipal }, "Owner");
  assert.equal(runDraftGeneratedTests(db, draft.id, "Owner", { principal: ownerPrincipal }).suite.status, "passed");
  const history = profitableBreakoutCandles();
  const tested = backtestStrategyDraftWithCandles(db, draft.id, history, { symbol: "BTC/USDT", principal: ownerPrincipal }, "Owner");
  assert.equal(tested.backtest.passed, true, "the production OOS evaluator must pass without mutating its result");
  assert.ok(tested.backtest.oos.trades >= 20);
  assert.ok(tested.backtest.oos.profitFactor >= 1.2);
  const published = publishStrategyDraft(db, draft.id, { slug: "owner_breakout_candidate", principal: ownerPrincipal }, "Owner");
  assert.equal(published.version.immutable, true);
  assert.equal(recordStrategyValidationStage(db, item.id, {
    stageName: "backtest", outcome: "passed", candidateVersionId: published.version.id,
    candidateDefinitionHash: published.version.contentHash, evidenceId: tested.backtest.id
  }, "Owner").ok, true);

  const routes = new Map();
  const app = {};
  for (const method of ["get", "post", "patch", "delete"]) app[method] = (path, ...handlers) => routes.set(`${method.toUpperCase()} ${path}`, handlers);
  const initialHistory = history.slice(0, 300);
  registerReviewRoutes(app, {
    db,
    requirePermission: () => (_req, _res, next) => next(),
    persist: (res, payload) => res.json(payload),
    id: (prefix) => `${prefix}-test`, nowIso: () => new Date().toISOString(),
    appendAudit: () => {}, appendTrace: () => {}, buildReviewAnalytics: () => ({}), backfillReviewFields: () => ({}),
    createStrategyImprovementCycle, validateStrategyImprovementCycle: () => ({}),
    startOwnerCandidatePaperSession: (database, options, runtime) => startOwnerCandidatePaperSession(database, options, {
      ...runtime, loadCandles: async () => initialHistory
    })
  });
  const handlers = routes.get("POST /api/review/improvements/:id/paper/start");
  const req = { params: { id: item.id }, body: { symbol: "BTC/USDT" }, user: db.user };
  const response = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  await new Promise((resolve, reject) => handlers[0](req, response, () => Promise.resolve(handlers[1](req, response)).then(resolve, reject)));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, "ok");
  assert.equal(response.body.session.status, "running");
  assert.equal(response.body.session.seeded, false);
  assert.equal(response.body.session.strategyVersionId, published.version.id);
  assert.equal(response.body.session.strategyDefinitionHash, published.version.contentHash);
  assert.equal(response.body.session.strategyExperimentId, cycle.experiment.id);

  const forward = await runPaperForward(db, { loadCandles: async () => history });
  assert.equal(forward.results[0].status, "passed");
  assert.ok(response.body.session.metrics.trades >= 20);
  assert.ok(response.body.session.metrics.profitFactor >= 1.2);
  const recorded = recordStrategyValidationStage(db, item.id, { stageName: "paper", outcome: "passed", evidenceId: response.body.session.id }, "Owner");
  assert.equal(recorded.ok, true, JSON.stringify(recorded));
});

test("real reflection output preserves immutable candidate refs and powers small-live validation", async () => {
  const db = dbFixture();
  db.system.ownerReviewProvenanceMigrationVersion = 1;
  const draft = { id: "candidate-draft", tenantId: "tenant_owner", ownerUserId: "owner-1", contentHash: "candidate-draft-hash" };
  const backtest = {
    id: "candidate-backtest", tenantId: "tenant_owner", ownerUserId: "owner-1",
    draftId: draft.id, draftHash: draft.contentHash, passed: true,
    oos: { trades: 30, profitFactor: 1.5, maxDrawdownPct: 2, expectancyR: 0.2 }
  };
  const definition = { baseProductId: "trend", sourceDraftId: draft.id };
  const candidate = {
    id: "candidate-v2", tenantId: "tenant_owner", ownerUserId: "owner-1", immutable: true,
    contentHash: strategyDefinitionHash(definition), definition, validation: { backtestId: backtest.id }
  };
  db.strategyStudioDrafts.push(draft);
  db.strategyStudioBacktests.push(backtest);
  db.strategyBlueprintVersions.push(candidate);
  db.strategyMarketplaceListings = [{ id: "listing-candidate-v2", strategyVersionId: candidate.id, status: "published" }];
  db.paperSessions.push({
    id: "candidate-paper", tenantId: "tenant_owner", ownerUserId: "owner-1", seeded: false,
    status: "passed", strategyVersionId: candidate.id,
    metrics: { trades: 30, profitFactor: 1.4, maxDrawdownPct: 2, averageSlippageBps: 3 }
  });
  for (let index = 1; index <= 3; index += 1) {
    const planId = `candidate-plan-${index}`;
    const executionOrderId = `candidate-exec-${index}`;
    const strategyBlueprintRef = {
      versionId: candidate.id,
      contentHash: candidate.contentHash,
      baseProductId: "trend"
    };
    db.tradePlans.push({
      ...plan({ id: planId, riskCheckId: `risk-candidate-${index}`, lastRiskCheck: { id: `risk-candidate-${index}`, passed: true } }),
      tenantId: "tenant_owner", ownerUserId: "owner-1", strategyBlueprintRef
    });
    db.riskChecks.push({ id: `risk-candidate-${index}`, tradePlanId: planId, passed: true });
    db.executionOrders.push({ id: executionOrderId, planId, tenantId: "tenant_owner", ownerUserId: "owner-1", strategyBlueprintRef });
    db.fills.push(
      { id: `candidate-entry-${index}`, kind: "entry", executionOrderId, tradePlanId: planId, symbol: "BTC/USDT", feeUsdt: 0, tenantId: "tenant_owner", ownerUserId: "owner-1", strategyBlueprintRef, createdAt: `2026-08-18T0${index}:00:00.000Z` },
      { id: `candidate-close-${index}`, kind: "close", executionOrderId, tradePlanId: planId, symbol: "BTC/USDT", direction: "long", realizedPnl: 0.5, feeUsdt: 0, fundingFeeUsdt: 0, fundingReconciled: true, tenantId: "tenant_owner", ownerUserId: "owner-1", strategyBlueprintRef, createdAt: `2026-08-18T0${index}:30:00.000Z` }
    );
  }
  const reflection = await runTradeReflection(db);
  assert.equal(reflection.reflected, 3);
  const reviewIds = db.reviews.filter((row) => row.type === "trade" && row.status === "completed").map((row) => row.id);
  assert.equal(reviewIds.length, 3);
  for (const review of db.reviews.filter((row) => reviewIds.includes(row.id))) {
    assert.deepEqual(review.strategyBlueprintRef, {
      schema: "trading.strategy.blueprint.review-ref", schemaVersion: 1,
      versionId: candidate.id, contentHash: candidate.contentHash, productId: "trend"
    });
    assert.equal(review.improvementScope.strategyVersionId, candidate.id);
    assert.equal(review.improvementScope.strategyDefinitionHash, candidate.contentHash);
  }

  const item = { id: "real-small-live", destination: "strategy", state: "accepted", scope: { strategyProductId: "trend" }, tenantId: "tenant_owner", ownerUserId: "owner-1" };
  db.ownerImprovementItems.push(item);
  const cycle = createStrategyImprovementCycle(db, { sourceImprovementId: item.id });
  item.experimentId = cycle.experiment.id;
  const paper = db.paperSessions.find((row) => row.id === "candidate-paper");
  paper.ownerImprovementId = item.id;
  paper.strategyExperimentId = cycle.experiment.id;
  paper.strategyDefinitionHash = candidate.contentHash;
  paper.strategyProductId = "trend";
  transitionOwnerImprovement(db, item.id, "start_validation", "Owner");
  assert.equal(recordStrategyValidationStage(db, item.id, { stageName: "backtest", outcome: "passed", candidateVersionId: candidate.id, candidateDefinitionHash: candidate.contentHash, evidenceId: backtest.id }).ok, true);
  assert.equal(recordStrategyValidationStage(db, item.id, { stageName: "paper", outcome: "passed", evidenceId: "candidate-paper" }).ok, true);
  db.strategyAssignments = [{ strategyVersionId: candidate.id, enabled: true, mode: "owner_live_observation" }];

  const firstReview = db.reviews.find((row) => row.id === reviewIds[0]);
  const validRef = structuredClone(firstReview.strategyBlueprintRef);
  delete firstReview.strategyBlueprintRef.contentHash;
  assert.equal(recordStrategyValidationStage(db, item.id, { stageName: "small_live", outcome: "passed", evidenceReviewIds: reviewIds }).error, "authoritative_small_live_evidence_incomplete");
  firstReview.strategyBlueprintRef = structuredClone(validRef);
  firstReview.ownerUserId = "other-user";
  assert.equal(recordStrategyValidationStage(db, item.id, { stageName: "small_live", outcome: "passed", evidenceReviewIds: reviewIds }).error, "authoritative_small_live_evidence_incomplete");
  firstReview.ownerUserId = "owner-1";
  firstReview.strategyBlueprintRef.versionId = "other-version";
  assert.equal(recordStrategyValidationStage(db, item.id, { stageName: "small_live", outcome: "passed", evidenceReviewIds: reviewIds }).error, "authoritative_small_live_evidence_incomplete");
  firstReview.strategyBlueprintRef = structuredClone(validRef);
  const smallLive = recordStrategyValidationStage(db, item.id, { stageName: "small_live", outcome: "passed", evidenceReviewIds: reviewIds });
  assert.equal(smallLive.ok, true, JSON.stringify(smallLive));
});
