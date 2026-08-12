import assert from "node:assert/strict";
import test from "node:test";
import { anchoredPurgedOosFolds, deflatedSharpeProbability, distributionStats, purgedChronologicalWindows, rollingPurgedWalkForwardFolds } from "../server/validationStatistics.mjs";

test("purged windows leave explicit non-overlapping boundary gaps", () => {
  const windows = purgedChronologicalWindows(100, { purgeBars: 2, embargoBars: 3 });
  assert.deepEqual(windows.train, [0, 38]);
  assert.deepEqual(windows.validation, [43, 68]);
  assert.deepEqual(windows.test, [73, 100]);
  const oos = anchoredPurgedOosFolds(100, { purgeBars: 2, embargoBars: 3, foldCount: 3 });
  assert.deepEqual(oos.train, [0, 38]);
  assert.equal(oos.folds[0][0], 43);
  assert.equal(oos.folds.at(-1)[1], 100);
});

test("deflated Sharpe confidence falls when the same result came from more trials", () => {
  const stats = distributionStats([1.2, 0.8, 1.1, -0.2, 0.7, 1.4, 0.5, 0.9, -0.1, 1.0]);
  const metrics = { trades: stats.n, tradeSharpe: stats.sharpe, skewness: stats.skewness, kurtosis: stats.kurtosis };
  const one = deflatedSharpeProbability(metrics, 1);
  const many = deflatedSharpeProbability(metrics, 100);
  assert.ok(one > many);
  assert.ok(one >= 0 && one <= 1);
  assert.ok(many >= 0 && many <= 1);
});

test("rolling walk-forward repeatedly retrains before disjoint future tests and covers the latest bars", () => {
  const result = rollingPurgedWalkForwardFolds(100, { trainSize: 40, testSize: 15, stepSize: 15, purgeBars: 1, embargoBars: 1 });
  assert.ok(result.folds.length >= 3);
  for (const fold of result.folds) {
    assert.ok(fold.train[1] < fold.test[0]);
    assert.equal(fold.test[1] - fold.test[0], 15);
  }
  assert.equal(result.folds.at(-1).test[1], 100);
  assert.ok(result.folds[1].train[0] > result.folds[0].train[0]);
});
