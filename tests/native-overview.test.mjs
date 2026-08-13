import assert from "node:assert/strict";
import test from "node:test";
import { compactOverviewForNative } from "../server/overviewView.mjs";

const candles = Array.from({ length: 800 }, (_, index) => ({
  time: index,
  open: 60000 + index,
  high: 60100 + index,
  low: 59900 + index,
  close: 60050 + index,
  volume: 1000 + index
}));

test("native overview removes repeated histories while preserving actionable state", () => {
  const full = {
    system: { autonomyEnabled: true },
    markets: [{ symbol: "BTC/USDT", price: 64000, candles, candlesByTf: { "15m": candles, "1h": candles }, opportunitySetup: { facts: candles } }],
    activeMarket: { symbol: "BTC/USDT", price: 64000, candles },
    tradePlans: [
      { id: "active", status: "awaiting_approval", lastRiskCheck: { checks: [{ passed: true }] } },
      ...Array.from({ length: 90 }, (_, index) => ({ id: `old-${index}`, status: "expired", lastRiskCheck: { evidence: candles } }))
    ],
    armedSetups: [{ id: "setup", status: "TRIGGERED", events: candles, strategyInstance: { history: candles }, scenario: { currentStageIndex: 1 } }],
    orders: Array.from({ length: 100 }, (_, index) => ({ id: `order-${index}`, status: index === 99 ? "entry_pending" : "closed" })),
    riskChecks: Array.from({ length: 100 }, (_, id) => ({ id, checks: candles, summary: `check-${id}` })),
    riskIncidents: Array.from({ length: 100 }, (_, id) => ({ id, status: id === 99 ? "open" : "closed" })),
    events: Array.from({ length: 100 }, (_, id) => ({ id, timeline: candles, title: `event-${id}` })),
    newsFeed: Array.from({ length: 80 }, (_, id) => ({ id })),
    notifications: Array.from({ length: 100 }, (_, id) => ({ id })),
    accountSnapshots: Array.from({ length: 10 }, (_, id) => ({ id, balances: candles, totalEquityUsdt: id })),
    agentRuns: [{ id: "run", status: "completed", presentationFacts: candles, capabilityPlan: candles, steps: [{ title: "scan", phase: "observe" }] }],
    analysisBundles: [{ body: candles }],
    evidenceBundles: [{ body: candles }],
    memoryItems: Array.from({ length: 70 }, (_, id) => ({ id })),
    knowledge: { tradingSkills: [{ id: "ks1", status: "compiled", lifecycle: candles, validation: { detail: candles } }] },
    reviews: [{ id: "review", summary: "keep", analyticsSnapshot: candles }],
    executionOrders: [{ id: "execution", status: "closed", strategyInstance: candles, events: candles }],
    reviewAnalytics: { confidence: candles },
    professional: { replayBundles: candles },
    backtestResearch: { historical: candles },
    strategyProfiles: candles,
    decisionCalibration: { rows: candles },
    agentStateFiles: { files: candles },
    marketCalendarEvents: candles,
    dailyMarketBrief: { facts: candles },
    toolExecutions: candles,
    strategyCatalog: { products: [{ id: "p1" }], strategies: [{ history: candles }] }
  };

  const compact = compactOverviewForNative(full, true);
  assert.equal(compact.overviewMode, "native_compact");
  assert.equal(compact.markets[0].candles, undefined);
  assert.equal(compact.markets[0].price, 64000);
  assert.equal(compact.tradePlans[0].id, "active");
  assert.deepEqual(compact.tradePlans[0].lastRiskCheck.checks, [{ passed: true }]);
  assert.ok(compact.tradePlans.length <= 60);
  assert.equal(compact.armedSetups[0].events, undefined);
  assert.equal(compact.armedSetups[0].scenario.currentStageIndex, 1);
  assert.equal(compact.orders[0].id, "order-99");
  assert.equal(compact.agentRuns[0].steps[0].title, "scan");
  assert.equal(compact.agentRuns[0].presentationFacts, undefined);
  assert.equal(compact.riskChecks[0].checks, undefined);
  assert.equal(compact.events[0].timeline, undefined);
  assert.equal(compact.accountSnapshots[0].balances, undefined);
  assert.equal(compact.knowledge.tradingSkills[0].lifecycle, undefined);
  assert.equal(compact.reviews[0].analyticsSnapshot, undefined);
  assert.equal(compact.executionOrders[0].strategyInstance, undefined);
  assert.equal(compact.strategyCatalog.products[0].id, "p1");
  assert.deepEqual(compact.strategyCatalog.strategies, []);
  assert.deepEqual(compact.analysisBundles, []);
  assert.deepEqual(compact.evidenceBundles, []);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length * 0.08);
  assert.equal(full.markets[0].candles, candles, "must not mutate the desktop overview");
});

test("desktop overview remains unchanged", () => {
  const full = { markets: [{ symbol: "BTC/USDT", candles }] };
  assert.equal(compactOverviewForNative(full, false), full);
});

test("native startup overview is a tiny interactive shell", () => {
  const full = {
    user: { id: "u1" }, system: { autonomyEnabled: true }, portfolio: { totalEquityUsdt: 100 },
    agentStatus: { state: "running", timeline: candles, latestAnalysis: { facts: candles }, nextActions: ["wait"] },
    markets: [{ symbol: "BTC/USDT", price: 64000, candles }, { symbol: "SUI/USDT", price: 1, candles }],
    activeMarket: { symbol: "BTC/USDT", price: 64000, candles }, positions: [], mandates: [],
    tradePlans: Array.from({ length: 90 }, (_, id) => ({ id, status: id === 89 ? "armed" : "expired", symbol: "BTC/USDT" })),
    executionOrders: [], armedSetups: [], fills: candles, watchTriggers: [], agentRuns: [{ id: "run", steps: candles }, { id: "run2", steps: candles }],
    notifications: candles, reviews: candles, knowledge: { tradingSkills: candles }, strategyStudio: { drafts: candles }
  };
  const startup = compactOverviewForNative(full, "startup");
  assert.equal(startup.overviewMode, "native_startup");
  assert.equal(startup.tradePlans[0].id, 89);
  assert.equal(startup.markets.length, 1);
  assert.equal(startup.agentStatus.timeline, undefined);
  assert.equal(startup.agentRuns.length, 2);
  assert.deepEqual(startup.reviews, []);
  assert.deepEqual(startup.knowledge, {});
  assert.ok(JSON.stringify(startup).length < 60_000);
});
