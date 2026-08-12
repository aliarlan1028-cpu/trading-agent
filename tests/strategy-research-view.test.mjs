import assert from "node:assert/strict";
import test from "node:test";
import { buildBacktestResearch } from "../server/strategyResearchView.mjs";

test("回测研究聚合传统回测、自动样本外与工作室证据且不重复", () => {
  const sharedStudio = {
    id: "studio-1", kind: "strategy_blueprint", name: "工作室突破", symbol: "BTC/USDT", timeframe: "1h",
    oos: { trades: 12, expectancyR: 0.2, profitFactor: 1.3, maxDrawdownPct: 4, netReturnPct: 2, equityCurve: [100, 102, 101] },
    createdAt: "2026-08-10T00:00:00Z"
  };
  const result = buildBacktestResearch({
    backtests: [sharedStudio, { id: "legacy-1", symbol: "ETH/USDT", strategy: "趋势", trades: 8, expectancyR: 0.1, equityCurve: [100, 101] }],
    strategyStudioBacktests: [sharedStudio],
    strategyProfiles: [{
      id: "profile-1", symbol: "ADA/USDT", label: "唐奇安", strategyId: "breakout", timeframe: "1h", confidence: "oos_ok",
      oos: { trades: 15, expectancyR: 0.15, profitFactor: 1.2, maxDrawdownPct: 3, netReturnPct: 1.5, equityCurve: [100, 99, 102] },
      folds: [{ trades: 4, expectancyR: 0.1 }, { trades: 4, expectancyR: -0.1 }, { trades: 4, expectancyR: 0.2 }]
    }],
    paperSessions: []
  });
  assert.equal(result.historical.length, 3);
  assert.equal(result.summary.studioOos, 1);
  assert.equal(result.summary.historicalBacktests, 1);
  assert.equal(result.summary.optimizerOos, 1);
  const profile = result.historical.find((row) => row.id === "profile-1");
  assert.equal(profile.activeFolds, 3);
  assert.equal(profile.positiveFolds, 2);
  assert.deepEqual(profile.drawdownCurve, [0, 1, 0]);
});

test("纯前向模拟单独展示，不冒充历史回测", () => {
  const result = buildBacktestResearch({
    paperSessions: [{
      id: "paper-1", symbol: "BTC/USDT", label: "唐奇安20", status: "running", metrics: { trades: 3 },
      paperPosition: { entry: 100, stop: 98, tp: 104 }, startedAt: "2026-08-01T00:00:00Z"
    }]
  });
  assert.equal(result.historical.length, 0);
  assert.equal(result.forward.length, 1);
  assert.equal(result.forward[0].completedTrades, 3);
  assert.equal(result.forward[0].openPosition.entry, 100);
  assert.equal(result.summary.forwardRunning, 1);
});
