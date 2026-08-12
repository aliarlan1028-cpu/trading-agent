import assert from "node:assert/strict";
import test from "node:test";
import { optimizeSymbol } from "../server/strategyOptimizer.mjs";

function syntheticCandles(length = 500) {
  let close = 100;
  return Array.from({ length }, (_, index) => {
    const open = close;
    const cycle = Math.sin(index / 12) * 0.006;
    close = Math.max(1, close * (1 + 0.0008 + cycle));
    return {
      time: Date.UTC(2025, 0, 1) + index * 60 * 60 * 1000,
      open,
      high: Math.max(open, close) * 1.004,
      low: Math.min(open, close) * 0.996,
      close,
      volume: 1000 + (index % 20) * 10
    };
  });
}

test("strategy optimizer exposes purged, deflated and rolling OOS evidence", () => {
  const result = optimizeSymbol(syntheticCandles(), "1h", {});
  assert.equal(result.rollingValidation.method, "rolling_retrain_purged_walk_forward");
  assert.equal(result.rollingValidation.purgeBars, 1);
  assert.equal(result.rollingValidation.embargoBars, 1);
  assert.ok(result.rollingValidation.folds.length >= 3);
  if (result.best) {
    assert.ok(result.overfitDiagnostics.parameterTrials > 1);
    assert.ok("deflatedSharpeProbability" in result.overfitDiagnostics);
  }
});
