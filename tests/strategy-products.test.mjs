import assert from "node:assert/strict";
import test from "node:test";
import {
  STRATEGY_PRODUCTS,
  assessStrategyProductEvidence,
  bindPlanToStrategyProduct,
  buildStrategyProductCatalog,
  ensurePlanStrategyBinding,
  reconcileStrategyProductHealth,
  strategyProductExecutionGate,
  strategyProductMetrics,
  strategyVersionHash,
  syncNativeStrategyProducts,
  transitionStrategyProduct,
  validateStrategyProduct
} from "../server/strategyProducts.mjs";
import { resetOperationalData, seedDatabase } from "../server/store.mjs";

function db() {
  return {
    strategyVersions: [], strategyDeployments: [], strategyVersionEvents: [],
    tradePlans: [], executionOrders: [], fills: []
  };
}

test("五个 AI 策略产品都有不可绕过风控的合法版本合同", () => {
  const products = Object.values(STRATEGY_PRODUCTS);
  assert.equal(products.length, 5);
  for (const product of products) {
    const checked = validateStrategyProduct(product);
    assert.equal(checked.valid, true, `${product.id}: ${checked.errors.join(",")}`);
    assert.equal(product.executionPolicy.exchange, "OKX");
    assert.equal(product.executionPolicy.llmMayBypassContract, false);
    assert.equal(product.executionPolicy.requiresHardRiskGate, true);
    assert.equal(product.validationPolicy.paperForwardRequired, false);
    assert.equal(product.validationPolicy.ownerAuthorizedLiveObservationAllowed, true);
    assert.match(strategyVersionHash(product), /^[a-f0-9]{64}$/);
  }
});

test("策略版本首次同步后不可被相同版本的不同内容静默覆盖", () => {
  const state = db();
  const first = syncNativeStrategyProducts(state, "2026-08-10T00:00:00.000Z");
  assert.equal(first.created.length, 5);
  const id = "trend_pullback@1.0.0";
  const stored = state.strategyVersions.find((row) => row.id === id);
  const originalDefinition = stored.definition;
  stored.contentHash = "0".repeat(64);
  const second = syncNativeStrategyProducts(state, "2026-08-10T01:00:00.000Z");
  assert.equal(second.drift.length, 1);
  assert.equal(stored.definition, originalDefinition);
  assert.equal(state.strategyVersions.length, 5);
});

test("升级前计划不会被追溯性冒充为新版本策略证据", () => {
  const state = db();
  const legacy = { id: "old", source: "agent_chat", direction: "long", scenarioType: "trend_pullback" };
  state.tradePlans.push(legacy);
  syncNativeStrategyProducts(state, "2026-08-10T00:00:00.000Z");
  assert.equal(legacy.strategyRef.classification, "legacy_pre_product_layer");
  const result = ensurePlanStrategyBinding(state, legacy);
  assert.equal(result.ok, false);
  assert.equal(result.legacyCompatible, true);
  assert.equal(legacy.strategyVersionId, undefined);
});

test("计划按场景和方向钉住策略产品版本，方向不符时拒绝归类", () => {
  const state = db();
  syncNativeStrategyProducts(state);
  const longPlan = { id: "p1", direction: "long", scenarioType: "breakout_retest" };
  const bound = bindPlanToStrategyProduct(state, longPlan, { source: "test" });
  assert.equal(bound.ok, true);
  assert.equal(longPlan.strategyVersionId, "breakout_retest@1.0.0");
  assert.equal(longPlan.strategyRef.contentHash.length, 64);

  const wrongDirection = { id: "p2", direction: "short", scenarioType: "breakout_retest" };
  const rejected = bindPlanToStrategyProduct(state, wrongDirection, { source: "test" });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, "product_direction_mismatch");
  assert.equal(wrongDirection.strategyRef.classification, "legacy_unclassified");
});

test("策略状态真实约束执行：实盘观察可执行，暂停后确定性拒绝", () => {
  const state = db();
  syncNativeStrategyProducts(state);
  const plan = { id: "p1", direction: "short", scenarioType: "breakdown_retest" };
  bindPlanToStrategyProduct(state, plan);
  assert.equal(strategyProductExecutionGate(state, plan).allowed, true);
  transitionStrategyProduct(state, "breakdown_retest", "1.0.0", "paused", { reason: "测试暂停", actor: "Test" });
  const gate = strategyProductExecutionGate(state, plan);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "strategy_state_paused");
  assert.equal(state.strategyVersionEvents[0].from, "owner_live_observation");
});

test("策略实例绑定后修改入场参数会被执行闸识别", () => {
  const state = db();
  syncNativeStrategyProducts(state);
  const plan = { id: "p1", direction: "long", timeframe: "1h", scenarioType: "trend_pullback", entry_range: [100, 101], stopLoss: 98, takeProfit: [105], leverage: 2, max_loss_pct: 1 };
  assert.equal(bindPlanToStrategyProduct(state, plan).ok, true);
  assert.equal(strategyProductExecutionGate(state, plan).allowed, true);
  plan.stopLoss = 99;
  const gate = strategyProductExecutionGate(state, plan);
  assert.equal(gate.allowed, false);
  assert.equal(gate.reason, "strategy_instance_mutated_after_binding");
});

test("成交只按钉住的策略版本归因，未记录初始风险时不伪造 R 期望", () => {
  const state = db();
  syncNativeStrategyProducts(state);
  const plan = { id: "p1", direction: "long", scenarioType: "trend_pullback" };
  bindPlanToStrategyProduct(state, plan);
  state.tradePlans.push(plan);
  state.executionOrders.push({ id: "e1", planId: "p1", strategyVersionId: plan.strategyVersionId });
  state.fills.push({ id: "entry", kind: "entry", executionOrderId: "e1", tradePlanId: "p1", feeUsdt: 0.5, createdAt: "2026-08-10T00:00:00Z" });
  state.fills.push({ id: "f1", kind: "close", executionOrderId: "e1", tradePlanId: "p1", realizedPnl: 3, feeUsdt: 0.2, partial: false, createdAt: "2026-08-10T01:00:00Z" });
  state.fills.push({ id: "external", kind: "close", realizedPnl: 99, partial: false, createdAt: "2026-08-10T02:00:00Z" });
  const metrics = strategyProductMetrics(state, "trend_pullback@1.0.0");
  assert.equal(metrics.closedTrades, 1);
  assert.equal(metrics.grossPnlUsdt, 3);
  assert.equal(metrics.recordedEntryFeesUsdt, 0.5);
  assert.equal(metrics.recordedCloseFeesUsdt, 0.2);
  assert.equal(metrics.netPnlUsdt, 2.3);
  assert.equal(metrics.expectancyR, null);
  assert.equal(metrics.rSampleCount, 0);
  const evidence = assessStrategyProductEvidence(STRATEGY_PRODUCTS.trend_pullback, metrics);
  assert.equal(evidence.qualified, false);
  assert.equal(evidence.sampleHonest, false);
  const catalog = buildStrategyProductCatalog(state);
  assert.equal(catalog.summary.validatedActive, 0);
  assert.equal(catalog.summary.liveObservation, 5);
});

test("仅带 executionOrderId 的成交复用同一计划解析并保留 R 与回撤基准", () => {
  const state = db();
  syncNativeStrategyProducts(state);
  const plan = { id: "risk-plan", direction: "long", scenarioType: "trend_pullback", initialRiskUsdt: 2, accountEquityAtEntryUsdt: 100 };
  bindPlanToStrategyProduct(state, plan);
  state.tradePlans.push(plan);
  state.executionOrders.push({ id: "risk-order", planId: plan.id, strategyVersionId: plan.strategyVersionId });
  state.fills.push(
    { id: "risk-entry", kind: "entry", executionOrderId: "risk-order", feeUsdt: 0, createdAt: "2026-08-10T00:00:00Z" },
    { id: "risk-close", kind: "close", executionOrderId: "risk-order", realizedPnl: -1, feeUsdt: 0, createdAt: "2026-08-10T01:00:00Z" }
  );
  const metrics = strategyProductMetrics(state, "trend_pullback@1.0.0");
  assert.equal(metrics.closedTrades, 1);
  assert.equal(metrics.rSampleCount, 1);
  assert.equal(metrics.expectancyR, -0.5);
  assert.equal(metrics.maxDrawdownUsdt, 1);
  assert.equal(metrics.maxDrawdownPct, 1);
  assert.equal(metrics.equityBasisUsdt, 100);
});

test("证据未达标时不能把策略人工改成已验证运行", () => {
  const state = db();
  syncNativeStrategyProducts(state);
  assert.throws(
    () => transitionStrategyProduct(state, "range_rejection", "1.0.0", "validated_active", { reason: "强行晋级", actor: "Test" }),
    /strategy_evidence_not_qualified/
  );
  assert.equal(state.strategyDeployments.find((row) => row.productId === "range_rejection").state, "owner_live_observation");
});

test("清空交易证据时策略验证状态同步重置，不能留下幽灵已验证状态", () => {
  const state = seedDatabase();
  syncNativeStrategyProducts(state);
  state.strategyDeployments[0].state = "validated_active";
  state.strategyDeployments[0].evidenceStatus = "qualified";
  resetOperationalData(state, { actor: "Test" });
  assert.equal(state.strategyDeployments.length, 5);
  assert.equal(state.strategyDeployments.every((row) => row.state === "owner_live_observation"), true);
  assert.equal(state.strategyDeployments.every((row) => row.evidenceStatus === "insufficient"), true);
});

test("已验证策略真实表现恶化后自动降级，不把验证当永久勋章", () => {
  const state = db();
  syncNativeStrategyProducts(state);
  const deployment = state.strategyDeployments.find((row) => row.productId === "trend_pullback");
  deployment.state = "validated_active";
  for (let index = 0; index < 10; index += 1) {
    const plan = { id: `p${index}`, direction: "long", scenarioType: "trend_pullback" };
    bindPlanToStrategyProduct(state, plan);
    state.tradePlans.push(plan);
    state.fills.push({ id: `f${index}`, kind: "close", executionOrderId: `e${index}`, tradePlanId: plan.id, strategyVersionId: plan.strategyVersionId, realizedPnl: -1, initialRiskUsdt: 2, partial: false, createdAt: `2026-08-10T${String(index).padStart(2,"0")}:00:00Z` });
  }
  const result = reconcileStrategyProductHealth(state, "Test");
  assert.equal(result.degraded.length, 1);
  assert.equal(deployment.state, "degraded");
  assert.equal(state.strategyVersionEvents[0].event, "AUTO_DEGRADED");
});
