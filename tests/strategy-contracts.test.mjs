import assert from "node:assert/strict";
import test from "node:test";
import { STRATEGIES, listStrategies, strategyMatchesRegime } from "../server/strategies.mjs";
import { buildNativeStrategyContract, buildStrategyCatalog, deriveStrategyLifecycle, validateStrategyContract } from "../server/strategyContracts.mjs";

test("所有内置策略都有合法、OKX 单一口径且不可绕过风控的策略合同", () => {
  const listed = listStrategies();
  assert.equal(listed.length, Object.keys(STRATEGIES).length);
  for (const strategy of Object.values(STRATEGIES)) {
    const contract = buildNativeStrategyContract(strategy);
    const checked = validateStrategyContract(contract);
    assert.equal(checked.valid, true, `${strategy.id}: ${checked.errors.join("；")}`);
    assert.deepEqual(contract.exchangeScope, ["OKX"]);
    assert.equal(contract.exitPolicy.stopLossRequired, true);
    assert.equal(contract.executionPolicy.llmMayBypassContract, false);
    assert.equal(contract.validationPolicy.paperForwardRequired, true);
  }
});

test("策略生命周期按样本外、纯前向、真实样本逐级晋级且样本不足不冒充 active", () => {
  const db = {
    strategyProfiles: [{ strategyId: "trend", confidence: "validated", oosScore: 0.25, chosenAt: "2026-08-01T00:00:00Z" }],
    paperSessions: [{ strategyId: "trend", status: "passed", metrics: { trades: 25 }, updatedAt: "2026-08-02T00:00:00Z" }],
    tradePlans: Array.from({ length: 3 }, (_, index) => ({ id: `p${index}`, strategy: "trend" })),
    fills: Array.from({ length: 3 }, (_, index) => ({ id: `f${index}`, kind: "close", tradePlanId: `p${index}`, realizedPnl: 1, createdAt: `2026-08-03T0${index}:00:00Z` }))
  };
  const lifecycle = deriveStrategyLifecycle(db, "trend");
  assert.equal(lifecycle.stage, "live_probation");
  assert.equal(lifecycle.executionEligibility, "probation_only");
  assert.equal(lifecycle.live.trades, 3);
});

test("策略目录把验证依据和净记录成本后的真实归因分层展示", () => {
  const db = { strategyProfiles: [], paperSessions: [], tradePlans: [], fills: [] };
  const catalog = buildStrategyCatalog(db, [STRATEGIES.trend]);
  assert.equal(catalog.summary.total, 1);
  assert.equal(catalog.summary.contractValid, 1);
  assert.equal(catalog.strategies[0].lifecycle.stage, "draft");
  assert.equal(catalog.strategies[0].lifecycle.live.basis, "closed_trade_lifecycle/recorded_costs");
});

test("市场状态路由同时校验策略家族和方向", () => {
  assert.equal(strategyMatchesRegime({ family: "trend", direction: "long" }, "温和上行"), true);
  assert.equal(strategyMatchesRegime({ family: "trend", direction: "short" }, "温和上行"), false);
  assert.equal(strategyMatchesRegime({ family: "trend", direction: "short" }, "高波动下行"), true);
  assert.equal(strategyMatchesRegime({ family: "meanrev", direction: "long" }, "震荡"), true);
});
