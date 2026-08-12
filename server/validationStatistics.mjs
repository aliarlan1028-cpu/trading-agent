// Statistical diagnostics used by strategy research. These functions are pure,
// deterministic and intentionally dependency-free so production validation does
// not depend on a second Python runtime.

function normalCdf(value) {
  // Abramowitz-Stegun approximation, adequate for probability diagnostics.
  const x = Number(value);
  if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * erf);
}

export function distributionStats(values = []) {
  const rows = values.map(Number).filter(Number.isFinite);
  const n = rows.length;
  if (!n) return { n: 0, mean: null, stdDev: null, sharpe: null, skewness: null, kurtosis: null };
  const mean = rows.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) return { n, mean, stdDev: 0, sharpe: null, skewness: null, kurtosis: null };
  const variance = rows.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  const stdDev = Math.sqrt(variance);
  if (!stdDev) return { n, mean, stdDev: 0, sharpe: null, skewness: null, kurtosis: null };
  const centered = rows.map((value) => (value - mean) / stdDev);
  const skewness = n >= 3 ? centered.reduce((sum, value) => sum + value ** 3, 0) * n / ((n - 1) * (n - 2)) : null;
  // Non-excess kurtosis. Small-sample correction is deliberately omitted below
  // four observations because the estimate is not useful at that size.
  const kurtosis = n >= 4 ? centered.reduce((sum, value) => sum + value ** 4, 0) / n : null;
  return { n, mean, stdDev, sharpe: mean / stdDev, skewness, kurtosis };
}

export function deflatedSharpeProbability(metrics = {}, trialCount = 1) {
  const n = Number(metrics.trades || metrics.n || 0);
  const sharpe = Number(metrics.tradeSharpe ?? metrics.sharpe);
  const skewness = Number(metrics.skewness);
  const kurtosis = Number(metrics.kurtosis);
  const trials = Math.max(1, Number(trialCount || 1));
  if (n < 5 || !Number.isFinite(sharpe)) return null;

  // Conservative expected maximum Sharpe under the null after N trials.
  // sqrt(2 log N) is an upper-tail approximation; using it here avoids
  // overstating confidence when many parameter combinations were searched.
  const nullStd = 1 / Math.sqrt(Math.max(1, n - 1));
  const expectedMaxNullSharpe = trials > 1 ? Math.sqrt(2 * Math.log(trials)) * nullStd : 0;
  const shape = 1
    - (Number.isFinite(skewness) ? skewness : 0) * sharpe
    + (((Number.isFinite(kurtosis) ? kurtosis : 3) - 1) / 4) * sharpe ** 2;
  const standardError = Math.sqrt(Math.max(1e-12, shape) / Math.max(1, n - 1));
  const probability = normalCdf((sharpe - expectedMaxNullSharpe) / standardError);
  return Number(Math.max(0, Math.min(1, probability)).toFixed(4));
}

export function attachDeflatedSharpe(metrics, trialCount = 1) {
  if (!metrics) return metrics;
  return {
    ...metrics,
    parameterTrials: Math.max(1, Number(trialCount || 1)),
    deflatedSharpeProbability: deflatedSharpeProbability(metrics, trialCount)
  };
}

export function purgedChronologicalWindows(length, options = {}) {
  const n = Math.max(0, Math.floor(Number(length || 0)));
  const purgeBars = Math.max(0, Math.floor(Number(options.purgeBars ?? 1)));
  const embargoBars = Math.max(0, Math.floor(Number(options.embargoBars ?? 1)));
  const trainBoundary = Math.floor(n * Number(options.trainFraction || 0.4));
  const validationBoundary = Math.floor(n * Number(options.validationFractionEnd || 0.7));
  const windows = {
    train: [0, Math.max(0, trainBoundary - purgeBars)],
    validation: [Math.min(n, trainBoundary + embargoBars), Math.max(0, validationBoundary - purgeBars)],
    test: [Math.min(n, validationBoundary + embargoBars), n],
    purgeBars,
    embargoBars
  };
  if (windows.train[1] <= windows.train[0]
    || windows.validation[1] <= windows.validation[0]
    || windows.test[1] <= windows.test[0]) {
    throw new Error("Insufficient samples for purged chronological windows");
  }
  return windows;
}

export function anchoredPurgedOosFolds(length, options = {}) {
  const n = Math.max(0, Math.floor(Number(length || 0)));
  const foldCount = Math.max(1, Math.floor(Number(options.foldCount || 3)));
  const purgeBars = Math.max(0, Math.floor(Number(options.purgeBars ?? 1)));
  const embargoBars = Math.max(0, Math.floor(Number(options.embargoBars ?? 1)));
  const trainBoundary = Math.floor(n * Number(options.trainFraction || 0.4));
  const train = [0, Math.max(0, trainBoundary - purgeBars)];
  const oosStart = Math.min(n, trainBoundary + embargoBars);
  if (train[1] <= 0 || n - oosStart < foldCount) throw new Error("Insufficient samples for purged OOS folds");
  const folds = [];
  for (let index = 0; index < foldCount; index += 1) {
    const from = oosStart + Math.floor(((n - oosStart) * index) / foldCount);
    const to = oosStart + Math.floor(((n - oosStart) * (index + 1)) / foldCount);
    if (to > from) folds.push([from, to]);
  }
  return { train, folds, oos: [oosStart, n], purgeBars, embargoBars };
}

export function rollingPurgedWalkForwardFolds(length, options = {}) {
  const n = Math.max(0, Math.floor(Number(length || 0)));
  const purgeBars = Math.max(0, Math.floor(Number(options.purgeBars ?? 1)));
  const embargoBars = Math.max(0, Math.floor(Number(options.embargoBars ?? 1)));
  const trainSize = Math.max(10, Math.floor(Number(options.trainSize || n * 0.4)));
  const testSize = Math.max(1, Math.floor(Number(options.testSize || n * 0.15)));
  const stepSize = Math.max(1, Math.floor(Number(options.stepSize || testSize)));
  const expanding = options.expanding === true;
  if (trainSize + purgeBars + embargoBars + testSize > n) throw new Error("Insufficient samples for rolling walk-forward folds");
  const folds = [];
  for (let offset = 0; ; offset += stepSize) {
    const trainStart = expanding ? 0 : offset;
    const boundary = offset + trainSize;
    const trainEnd = boundary - purgeBars;
    const testStart = boundary + embargoBars;
    const testEnd = testStart + testSize;
    if (testEnd > n) break;
    folds.push({ train: [trainStart, trainEnd], test: [testStart, testEnd] });
  }
  // Add an end-aligned fold when the regular step does not cover the latest bars.
  const finalTestStart = n - testSize;
  const finalBoundary = finalTestStart - embargoBars;
  const finalTrainStart = expanding ? 0 : finalBoundary - trainSize;
  const finalFold = { train: [finalTrainStart, finalBoundary - purgeBars], test: [finalTestStart, n] };
  const last = folds.at(-1);
  if (finalTrainStart >= 0 && (!last || last.test[1] !== n)) folds.push(finalFold);
  return { folds, trainSize, testSize, stepSize, purgeBars, embargoBars, expanding };
}
