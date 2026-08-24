import test from "node:test";
import assert from "node:assert/strict";
import {
  backtestStrategyDraftWithCandles,
  bindPlanToEnabledBlueprint,
  buildStrategyMarketplace,
  compileStrategyPrompt,
  createStrategyDraft,
  createStrategyDraftFromIdea,
  enabledStrategyBlueprints,
  generateStrategyTests,
  publishStrategyDraft,
  runDraftGeneratedTests,
  setStrategyAssignment,
  strategyDefinitionHash,
  validatePublishedStrategyCandidate,
  validatePlanBlueprintGate
} from "../server/strategyStudio.mjs";
import { syncNativeStrategyProducts } from "../server/strategyProducts.mjs";

function state() {
  return {
    user: { id: "owner-1", tenantId: "tenant_owner", isOwner: true },
    tenants: [{ id: "tenant_owner", ownerUserId: "owner-1" }],
    auditLogs: [], traces: [], backtests: [], tradePlans: [], fills: [], executionOrders: [], orders: [],
    strategyVersions: [], strategyDeployments: [], strategyVersionEvents: [],
    strategyStudioDrafts: [], strategyBlueprintVersions: [], strategyStudioBacktests: [],
    strategyMarketplaceListings: [], strategyAssignments: []
  };
}

const ownerPrincipal = { tenantId: "tenant_owner", userId: "owner-1", isOwner: true };

function candles(count = 900) {
  let close = 100;
  return Array.from({ length: count }, (_, index) => {
    const open = close;
    close = Math.max(10, open + Math.sin(index / 5) * 0.8 + Math.sin(index / 19) * 0.3);
    return { ts: index * 3_600_000, open, high: Math.max(open, close) + 0.4, low: Math.min(open, close) - 0.4, close, volume: 1000 + (index % 23) * 40 };
  });
}

test("natural language compiles to a closed deterministic strategy contract", () => {
  const { blueprint } = compileStrategyPrompt("ADA 1小时 RSI 14 从30下方重新站上30做多，止损2%，止盈2.5R");
  assert.equal(blueprint.templateId, "meanrev");
  assert.equal(blueprint.direction, "long");
  assert.equal(blueprint.timeframe, "1h");
  assert.deepEqual(blueprint.symbols, ["ADA/USDT"]);
  assert.equal(blueprint.params.period, 14);
  assert.equal(blueprint.params.oversold, 30);
  assert.equal(blueprint.exitPolicy.stopLossPct, 2);
  assert.equal(blueprint.exitPolicy.takeProfitR, 2.5);
  assert.equal(blueprint.executionPolicy.llmMayBypass, false);
  assert.equal(blueprint.costAssumption.source, "strategy_studio_conservative_defaults");
  assert.deepEqual(blueprint.costAssumption.values, blueprint.costs);
  assert.equal(blueprint.costAssumption.contentHash, strategyDefinitionHash({
    schemaVersion: blueprint.costAssumption.schemaVersion,
    source: blueprint.costAssumption.source,
    values: blueprint.costAssumption.values
  }));

  const contradicted = compileStrategyPrompt("SUI/USDT 4小时10和30均线死叉明确做空，止损3%，目标2R", {
    direction: "long", timeframe: "5m", symbols: ["BTC/USDT"],
    templateId: "trend", exitPolicy: { stopLossPct: 0.2, takeProfitR: 7 }
  }).blueprint;
  assert.equal(contradicted.direction, "short");
  assert.equal(contradicted.timeframe, "4h");
  assert.deepEqual(contradicted.symbols, ["SUI/USDT"]);
  assert.equal(contradicted.exitPolicy.stopLossPct, 3);
  assert.equal(contradicted.exitPolicy.takeProfitR, 2);

  const english = compileStrategyPrompt("Long ADA/USDT on 1h after RSI oversold; stop loss 2%, target 2.5R").blueprint;
  assert.equal(english.exitPolicy.takeProfitR, 2.5);
  assert.match(english.name, /Mean reversion/);
  assert.equal(english.templateNameEn, "Mean reversion (RSI oversold rebound)");

  const percentTarget = compileStrategyPrompt("BTC/USDT 1h 均线金叉做多，止损2%，止盈3%").blueprint;
  assert.equal(percentTarget.exitPolicy.takeProfitR, 1.5, "a percentage target must be normalized against the explicit percentage stop");

  const fifteenMinute = compileStrategyPrompt("SOL/USDT 15m 突破过去20根高点做多，止损2%，止盈2R").blueprint;
  assert.equal(fifteenMinute.timeframe, "15m");
});

test("ambiguous or incomplete natural language fails closed instead of inventing a default strategy", () => {
  for (const prompt of [
    "帮我做一个稳健的加密货币策略，控制风险并争取盈利",
    "BTC/USDT 1小时做多，止损2%，止盈2R",
    "BTC/USDT 1小时均线金叉做多，止盈2R"
  ]) {
    assert.throws(
      () => compileStrategyPrompt(prompt),
      (error) => error?.code === "strategy_needs_clarification"
        && error?.status === 422
        && Array.isArray(error?.details?.missing)
    );
  }
});

test("a single strategy blueprint rejects conflicting directions, timeframes and entry templates", () => {
  for (const prompt of [
    "BTC/USDT 1小时 RSI 跌破30后做多，同时跌破20根低点时做空，止损2%，止盈2R",
    "BTC/USDT 4小时判断趋势、1小时均线金叉做多，止损2%，止盈2R",
    "BTC/USDT 1小时 RSI 从30下方回升并且突破过去20根高点时做多，止损2%，止盈2R"
  ]) {
    assert.throws(
      () => compileStrategyPrompt(prompt),
      (error) => error?.code === "strategy_unsupported_semantics"
        && error?.details?.unsupported?.some((value) => ["multiple_directions", "multiple_timeframes", "multiple_entry_templates"].includes(value))
    );
  }
});

test("explicit stop and target values fail closed when they exceed the executable contract", () => {
  for (const prompt of [
    "BTC/USDT 1小时均线金叉做多，止损20%，止盈2R",
    "BTC/USDT 1小时均线金叉做多，止损0.1%，止盈10%"
  ]) {
    assert.throws(
      () => compileStrategyPrompt(prompt),
      (error) => error?.code === "strategy_parameter_out_of_range"
        && error?.status === 422
        && error?.details?.fields?.length > 0
    );
  }
});

test("unsupported executable concepts fail closed instead of being silently rewritten to a nearby template", () => {
  for (const prompt of [
    "BTC/USDT 1小时，价格突破VWAP且订单簿买盘增强时做多，止损2%，止盈2R",
    "ETH/USDT 4小时，一目均衡表云层突破且链上资金净流入时做多，止损2%，止盈3R"
  ]) {
    assert.throws(
      () => compileStrategyPrompt(prompt),
      (error) => error?.code === "strategy_unsupported_semantics"
        && error?.status === 422
        && error?.details?.unsupported?.length > 0
    );
  }

  assert.throws(
    () => compileStrategyPrompt("BTC/USDT 1小时均线金叉做多，止损2%，止盈价格100000"),
    (error) => error?.code === "strategy_unsupported_semantics"
      && error?.details?.unsupported?.includes("take_profit_unit")
  );

  const divergence = compileStrategyPrompt("BTC/USDT 4小时 RSI 底背离做多，止损2%，止盈2R").blueprint;
  assert.equal(divergence.templateId, "rsi_bull_div");
});

test("a compiled draft discloses compiler provenance, executable mappings, defaults and warnings", async () => {
  const db = state();
  const draft = await createStrategyDraft(db, "BTC/USDT 1h 10和30均线金叉做多，止损2%，止盈2R", {
    principal: ownerPrincipal,
    complete: async () => null
  }, "Owner");
  assert.equal(draft.compiler, "deterministic_fallback");
  assert.equal(draft.compilationReport.status, "compiled_with_fallback");
  assert.deepEqual(draft.compilationReport.mappedFields.sort(), ["direction", "entry", "stopLoss", "symbol", "takeProfit", "timeframe"].sort());
  assert.deepEqual(draft.compilationReport.defaultedFields, []);
  assert.ok(draft.compilationReport.warnings.includes("llm_no_structured_output"));
  assert.equal(draft.compilationReport.unsupported.length, 0);
});

test("LLM compiler output cannot invent executable strategy fields", async () => {
  const prompt = "BTC/USDT 1h 10和30均线金叉做多，止损2%，止盈2R";
  const direct = compileStrategyPrompt(prompt, {
    name: "模型命名",
    description: "模型摘要",
    params: { fast: 2, slow: 300 },
    exitPolicy: { atrStop: true, atrMult: 7, atrPeriod: 99 }
  });
  assert.equal(direct.blueprint.name, "模型命名");
  assert.equal(direct.blueprint.description, "模型摘要");
  assert.deepEqual(direct.blueprint.params, { fast: 10, slow: 30 });
  assert.deepEqual(direct.blueprint.exitPolicy, {
    stopLossPct: 2,
    takeProfitR: 2,
    atrStop: false,
    atrMult: 2,
    atrPeriod: 14
  });

  const db = state();
  const draft = await createStrategyDraft(db, prompt, {
    principal: ownerPrincipal,
    complete: async () => JSON.stringify({
      name: "模型命名",
      params: { fast: 2, slow: 300 },
      exitPolicy: { atrStop: true, atrMult: 7, atrPeriod: 99 }
    })
  }, "Owner");
  assert.equal(draft.compiler, "llm_metadata_only");
  assert.ok(draft.compilationReport.warnings.includes("llm_executable_fields_ignored"));
  assert.deepEqual(draft.blueprint.params, { fast: 10, slow: 30 });
  assert.equal(draft.blueprint.exitPolicy.atrStop, false);
});

test("generated tests enforce schema, determinism, no-lookahead, costs and hard risk", () => {
  const { blueprint } = compileStrategyPrompt("SUI/USDT 4h 唐奇安过去20根跌破后做空，止损3%，目标2R");
  const suite = generateStrategyTests(blueprint);
  assert.equal(suite.status, "passed");
  assert.deepEqual(suite.tests.map((row) => row.id), ["schema", "executable", "deterministic", "no_lookahead", "cost_model", "risk_contract"]);
  const unsafe = structuredClone(blueprint);
  unsafe.executionPolicy.llmMayBypass = true;
  assert.equal(generateStrategyTests(unsafe).status, "failed");

  const legacy = structuredClone(blueprint);
  legacy.compilerRevision = 1;
  delete legacy.costAssumption;
  assert.equal(generateStrategyTests(legacy).status, "passed", "persisted v1 drafts retain their existing generated-test semantics");
});

test("聊天创建策略复用策略工作室草稿与同一自动测试链", () => {
  const db = state();
  const draft = createStrategyDraftFromIdea(db, {
    name: "ADA RSI 回升",
    symbol: "ADA/USDT",
    direction: "long",
    timeframe: "1h",
    entry: "RSI 14 从 30 下方重新站上 30",
    stop: "入场价下方 2%",
    takeProfit: "2.5R",
    templateId: "meanrev"
  }, "用户(经 AI)", { principal: ownerPrincipal });
  assert.equal(db.strategyStudioDrafts.length, 1);
  assert.equal(draft.authoring.channel, "agent_chat");
  assert.equal(draft.authoring.toolName, "create_skill_from_idea");
  assert.equal(draft.compiler, "agent_structured_tool");
  assert.deepEqual(draft.blueprint.symbols, ["ADA/USDT"]);
  assert.equal(draft.blueprint.exitPolicy.stopLossPct, 2);
  assert.equal(draft.blueprint.exitPolicy.takeProfitR, 2.5);
  assert.equal(runDraftGeneratedTests(db, draft.id, "Owner", { principal: ownerPrincipal }).suite.status, "passed");
  assert.equal(db.knowledge?.tradingSkills?.length || 0, 0, "不得再生成第二套知识技能对象");
});

test("studio lifecycle requires tests and OOS evidence before internal publication and AI use", async () => {
  const db = state();
  syncNativeStrategyProducts(db);
  const draft = await createStrategyDraft(db, "BTC/USDT 1h 10和30均线金叉做多，止损2%，止盈2R", { principal: ownerPrincipal }, "Owner");
  assert.equal(draft.status, "compiled");
  const generated = runDraftGeneratedTests(db, draft.id, "Owner", { principal: ownerPrincipal });
  assert.equal(generated.suite.status, "passed");

  const result = backtestStrategyDraftWithCandles(db, draft.id, candles(), { symbol: "BTC/USDT", principal: ownerPrincipal }, "Owner");
  assert.equal(result.backtest.methodology, "anchored 40% training + 3 purged out-of-sample folds");
  assert.equal(result.backtest.folds.length, 3);
  assert.equal(result.backtest.costs.feePct, 0.05);
  assert.deepEqual(result.backtest.costAssumption, draft.blueprint.costAssumption);
  result.backtest.passed = false;
  assert.throws(() => publishStrategyDraft(db, draft.id, { slug: "btc_ma_cross", principal: ownerPrincipal }, "Owner"), /样本外回测门槛/);

  result.backtest.passed = true;
  const published = publishStrategyDraft(db, draft.id, { slug: "btc_ma_cross", principal: ownerPrincipal }, "Owner");
  assert.equal(published.version.id, "btc_ma_cross@1");
  assert.equal(published.version.immutable, true);
  assert.equal(published.listing.visibility, "internal");
  assert.equal(published.version.validation.costAssumptionHashesBySymbol["BTC/USDT"], result.backtest.costAssumption.contentHash);

  const originalFast = draft.blueprint.params.fast;
  draft.blueprint.params.fast = originalFast + 1;
  assert.equal(validatePublishedStrategyCandidate(db, published.version).error, "candidate_strategy_draft_definition_drift");
  draft.blueprint.params.fast = originalFast;

  const enabled = setStrategyAssignment(db, published.version.id, true, "Owner", { principal: ownerPrincipal });
  assert.equal(enabled.assignment.mode, "owner_live_observation");
  db.markets = [{
    symbol: "BTC/USDT",
    candles: Array.from({ length: 40 }, (_, index) => ({ ts: index, open: 100, high: index === 39 ? 121 : 101, low: 99, close: index === 39 ? 120 : 100, volume: 1000 }))
  }];
  const plan = { symbol: "BTC/USDT", direction: "long", timeframe: "1h", strategyRef: { productId: "trend_pullback" } };
  assert.equal(bindPlanToEnabledBlueprint(db, plan, published.version.id).ok, true);
  assert.equal(plan.strategyBlueprintRef.signalEvidence.ready, true);
  assert.equal(validatePlanBlueprintGate(db, plan).allowed, true);

  setStrategyAssignment(db, published.version.id, false, "Owner", { principal: ownerPrincipal });
  assert.equal(validatePlanBlueprintGate(db, plan).reason, "strategy_blueprint_disabled");
  assert.equal(buildStrategyMarketplace(db).summary.total, 6);

  result.backtest.costs.feePct = 0;
  assert.equal(validatePublishedStrategyCandidate(db, published.version).error, "candidate_strategy_cost_assumption_drift");
});

test("cost evidence drift fails closed at publication, activation, projection and execution binding", async () => {
  const db = state();
  syncNativeStrategyProducts(db);
  const draft = await createStrategyDraft(db, "BTC/USDT 1h 10和30均线金叉做多，止损2%，止盈2R", { principal: ownerPrincipal }, "Owner");
  runDraftGeneratedTests(db, draft.id, "Owner", { principal: ownerPrincipal });
  const result = backtestStrategyDraftWithCandles(db, draft.id, candles(), { symbol: "BTC/USDT", principal: ownerPrincipal }, "Owner");
  result.backtest.passed = true;

  result.backtest.costs.feePct = 0;
  assert.throws(
    () => publishStrategyDraft(db, draft.id, { slug: "cost_guard", principal: ownerPrincipal }, "Owner"),
    (error) => error?.code === "candidate_strategy_cost_assumption_drift"
  );

  result.backtest.costs.feePct = draft.blueprint.costs.feePct;
  const published = publishStrategyDraft(db, draft.id, { slug: "cost_guard", principal: ownerPrincipal }, "Owner");
  setStrategyAssignment(db, published.version.id, true, "Owner", { principal: ownerPrincipal });
  db.markets = [{
    symbol: "BTC/USDT",
    candles: Array.from({ length: 40 }, (_, index) => ({ ts: index, open: 100, high: index === 39 ? 121 : 101, low: 99, close: index === 39 ? 120 : 100, volume: 1000 }))
  }];
  const plan = { symbol: "BTC/USDT", direction: "long", timeframe: "1h", strategyRef: { productId: "trend_pullback" } };
  assert.equal(bindPlanToEnabledBlueprint(db, plan, published.version.id).ok, true);

  result.backtest.costs.feePct = 0;
  assert.equal(enabledStrategyBlueprints(db, { principal: ownerPrincipal }).some((row) => row.id === published.version.id), false);
  assert.equal(validatePlanBlueprintGate(db, plan).reason, "candidate_strategy_cost_assumption_drift");
  assert.equal(bindPlanToEnabledBlueprint(db, { ...plan, strategyBlueprintRef: undefined }, published.version.id).error, "candidate_strategy_cost_assumption_drift");
  assert.throws(
    () => setStrategyAssignment(db, published.version.id, true, "Owner", { principal: ownerPrincipal }),
    (error) => error?.code === "candidate_strategy_cost_assumption_drift"
  );
  assert.equal(setStrategyAssignment(db, published.version.id, false, "Owner", { principal: ownerPrincipal }).assignment.enabled, false);

  result.backtest.costs.feePct = draft.blueprint.costs.feePct;
  assert.equal(setStrategyAssignment(db, published.version.id, true, "Owner", { principal: ownerPrincipal }).assignment.enabled, true);
  assert.equal(enabledStrategyBlueprints(db, { principal: ownerPrincipal }).some((row) => row.id === published.version.id), true);
});

test("a multi-symbol version cannot publish until every declared symbol has current passing OOS evidence", async () => {
  const db = state();
  syncNativeStrategyProducts(db);
  const draft = await createStrategyDraft(
    db,
    "BTC/USDT 和 ETH/USDT 1h 10和30均线金叉做多，止损2%，止盈2R",
    { principal: ownerPrincipal },
    "Owner"
  );
  runDraftGeneratedTests(db, draft.id, "Owner", { principal: ownerPrincipal });

  const btc = backtestStrategyDraftWithCandles(db, draft.id, candles(), { symbol: "BTC/USDT", principal: ownerPrincipal }, "Owner");
  btc.backtest.passed = true;
  assert.throws(
    () => publishStrategyDraft(db, draft.id, { slug: "dual_ma_cross", principal: ownerPrincipal }, "Owner"),
    (error) => error?.code === "strategy_oos_symbol_coverage_incomplete"
      && error?.details?.missingSymbols?.includes("ETH/USDT")
  );

  const eth = backtestStrategyDraftWithCandles(db, draft.id, candles(), { symbol: "ETH/USDT", principal: ownerPrincipal }, "Owner");
  eth.backtest.passed = true;
  const published = publishStrategyDraft(db, draft.id, { slug: "dual_ma_cross", principal: ownerPrincipal }, "Owner");
  assert.deepEqual(Object.keys(published.version.validation.backtestIdsBySymbol).sort(), ["BTC/USDT", "ETH/USDT"]);
  assert.equal(validatePublishedStrategyCandidate(db, published.version).ok, true);
});

test("mutating a compiled draft cannot reuse old generated tests or OOS evidence", async () => {
  const db = state();
  syncNativeStrategyProducts(db);
  const draft = await createStrategyDraft(db, "BTC/USDT 1h 10和30均线金叉做多，止损2%，止盈2R", { principal: ownerPrincipal }, "Owner");
  runDraftGeneratedTests(db, draft.id, "Owner", { principal: ownerPrincipal });
  const result = backtestStrategyDraftWithCandles(db, draft.id, candles(), { symbol: "BTC/USDT", principal: ownerPrincipal }, "Owner");
  result.backtest.passed = true;
  draft.blueprint.params.fast = 11;

  assert.throws(
    () => publishStrategyDraft(db, draft.id, { slug: "mutated_draft", principal: ownerPrincipal }, "Owner"),
    (error) => error?.code === "strategy_draft_definition_drift" && error?.status === 409
  );
});

test("a persisted legacy single-symbol draft can still publish from its verified latest backtest", async () => {
  const db = state();
  syncNativeStrategyProducts(db);
  const draft = await createStrategyDraft(db, "BTC/USDT 1h 10和30均线金叉做多，止损2%，止盈2R", { principal: ownerPrincipal }, "Owner");
  runDraftGeneratedTests(db, draft.id, "Owner", { principal: ownerPrincipal });
  const result = backtestStrategyDraftWithCandles(db, draft.id, candles(), { symbol: "BTC/USDT", principal: ownerPrincipal }, "Owner");
  result.backtest.passed = true;
  delete draft.backtestIdsBySymbol;
  const published = publishStrategyDraft(db, draft.id, { slug: "legacy_single", principal: ownerPrincipal }, "Owner");
  assert.equal(published.version.validation.backtestIdsBySymbol["BTC/USDT"], result.backtest.id);
});
