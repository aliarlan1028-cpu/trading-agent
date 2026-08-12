import test from "node:test";
import assert from "node:assert/strict";
import {
  backtestStrategyDraftWithCandles,
  bindPlanToEnabledBlueprint,
  buildStrategyMarketplace,
  compileStrategyPrompt,
  createStrategyDraft,
  generateStrategyTests,
  publishStrategyDraft,
  runDraftGeneratedTests,
  setStrategyAssignment,
  validatePlanBlueprintGate
} from "../server/strategyStudio.mjs";
import { syncNativeStrategyProducts } from "../server/strategyProducts.mjs";

function state() {
  return {
    auditLogs: [], traces: [], backtests: [], tradePlans: [], fills: [], executionOrders: [], orders: [],
    strategyVersions: [], strategyDeployments: [], strategyVersionEvents: [],
    strategyStudioDrafts: [], strategyBlueprintVersions: [], strategyStudioBacktests: [],
    strategyMarketplaceListings: [], strategyAssignments: []
  };
}

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

  const contradicted = compileStrategyPrompt("SUI/USDT 4小时明确做空，止损3%，目标2R", {
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
});

test("generated tests enforce schema, determinism, no-lookahead, costs and hard risk", () => {
  const { blueprint } = compileStrategyPrompt("SUI/USDT 4h 唐奇安过去20根跌破后做空，止损3%，目标2R");
  const suite = generateStrategyTests(blueprint);
  assert.equal(suite.status, "passed");
  assert.deepEqual(suite.tests.map((row) => row.id), ["schema", "executable", "deterministic", "no_lookahead", "cost_model", "risk_contract"]);
  const unsafe = structuredClone(blueprint);
  unsafe.executionPolicy.llmMayBypass = true;
  assert.equal(generateStrategyTests(unsafe).status, "failed");
});

test("studio lifecycle requires tests and OOS evidence before internal publication and AI use", async () => {
  const db = state();
  syncNativeStrategyProducts(db);
  const draft = await createStrategyDraft(db, "BTC/USDT 1h 10和30均线金叉做多，止损2%，止盈2R", {}, "Owner");
  assert.equal(draft.status, "compiled");
  const generated = runDraftGeneratedTests(db, draft.id, "Owner");
  assert.equal(generated.suite.status, "passed");

  const result = backtestStrategyDraftWithCandles(db, draft.id, candles(), { symbol: "BTC/USDT" }, "Owner");
  assert.equal(result.backtest.methodology, "anchored 40% training + 3 purged out-of-sample folds");
  assert.equal(result.backtest.folds.length, 3);
  assert.equal(result.backtest.costs.feePct, 0.05);
  result.backtest.passed = false;
  assert.throws(() => publishStrategyDraft(db, draft.id, { slug: "btc_ma_cross" }, "Owner"), /样本外回测门槛/);

  result.backtest.passed = true;
  const published = publishStrategyDraft(db, draft.id, { slug: "btc_ma_cross" }, "Owner");
  assert.equal(published.version.id, "btc_ma_cross@1");
  assert.equal(published.version.immutable, true);
  assert.equal(published.listing.visibility, "internal");

  const enabled = setStrategyAssignment(db, published.version.id, true, "Owner");
  assert.equal(enabled.assignment.mode, "owner_live_observation");
  db.markets = [{
    symbol: "BTC/USDT",
    candles: Array.from({ length: 40 }, (_, index) => ({ ts: index, open: 100, high: index === 39 ? 121 : 101, low: 99, close: index === 39 ? 120 : 100, volume: 1000 }))
  }];
  const plan = { symbol: "BTC/USDT", direction: "long", timeframe: "1h", strategyRef: { productId: "trend_pullback" } };
  assert.equal(bindPlanToEnabledBlueprint(db, plan, published.version.id).ok, true);
  assert.equal(plan.strategyBlueprintRef.signalEvidence.ready, true);
  assert.equal(validatePlanBlueprintGate(db, plan).allowed, true);

  setStrategyAssignment(db, published.version.id, false, "Owner");
  assert.equal(validatePlanBlueprintGate(db, plan).reason, "strategy_blueprint_disabled");
  assert.equal(buildStrategyMarketplace(db).summary.total, 6);
});
